import type { Abi, Hex } from 'viem'
import {
  borrowerOperationsAbi,
  hintHelpersAbi,
  musdAbi,
  priceFeedAbi,
  troveManagerAbi,
} from '../clients'
import { InsufficientMusdBalance, MaxFeeExceeded, assertPositiveAmount } from '../errors'
import { findHintsForNICR } from '../hints'
import { type WriteDeps, requireWallet, simulateAndSend } from '../internal/write'

const TM_ABI = troveManagerAbi as unknown as Abi

/** Sane default trove-scan bound for a redemption (override per call). */
export const DEFAULT_REDEMPTION_MAX_ITERATIONS = 100n

/** Parameters for {@link MusdClient.redeem}. */
export interface RedeemParams {
  /** MUSD to redeem for BTC (burned from the caller). */
  amount: bigint
  /** Cap the number of Troves scanned/redeemed (default {@link DEFAULT_REDEMPTION_MAX_ITERATIONS}). */
  maxIterations?: bigint
  /**
   * SDK-side cap on the redemption RATE, as a 1e18 scaled fraction, compared against
   * `redemptionRate()`. Rate against rate: it is not a cap on the fee amount.
   *
   * **This is advisory and is NOT an on-chain guarantee** (MK-011). `redeemCollateral` takes
   * no fee cap parameter at all (`TroveManager.sol:294-301`), so nothing on chain enforces
   * this. The SDK reads the rate, compares it here, and then sends; the rate can be changed
   * by governance between the read and the transaction, and the transaction will still go
   * through at whatever rate is live when it mines. Treat it as a pre-flight sanity check,
   * never as a protection.
   */
  maxFeePercentage?: bigint
}

/**
 * Result of {@link MusdClient.redeem}. Every field names its unit (MK-014).
 *
 * The protocol's own naming is a trap here, so the SDK does not copy it:
 * `redemptionRate()` returns the RATE, a 1e18 scaled fraction
 * (`BorrowerOperations.sol:129`, initialized to 0.75% at `:151`), while
 * `getRedemptionRate(collateralDrawn)` returns, despite its name, a fee AMOUNT in BTC wei,
 * `redemptionRate * collateralDrawn / DECIMAL_PRECISION` (`:499-508`). At exactly one BTC of
 * collateral drawn the two print the same digits, which is precisely the coincidence that
 * makes a single field named `fee` dangerous.
 */
export interface RedeemResult {
  hash: Hex
  /**
   * Redeemable amount estimated by `getRedemptionHints` given the `minNetDebt` floor +
   * `maxIterations`. The ACTUAL redeemed amount (in the `Redemption` event) can be less
   * when a partial of the last Trove is skipped, surfaced so callers know.
   */
  truncatedAmount: bigint
  /**
   * The redemption RATE, a 1e18 scaled fraction, read live from `redemptionRate()`.
   * Governable. This is a ratio, not an amount of anything.
   */
  redemptionRate: bigint
  /**
   * ESTIMATED fee in BTC wei, from `getRedemptionRate(estimatedCollateralDrawn)`.
   *
   * It is an estimate because the collateral actually drawn is only known once the
   * redemption mines: it is derived here from `truncatedAmount` at the price read for the
   * hint call. The authoritative figure is `collateralFee` on the `Redemption` event.
   */
  estimatedFeeCollateral: bigint
  /**
   * The collateral the fee estimate was computed against, in BTC wei, so a caller can see
   * what the estimate assumed rather than having to reconstruct it.
   */
  estimatedCollateralDrawn: bigint
}

/**
 * Redeem MUSD for BTC against the lowest-ICR Troves. Reads the live redemption rate
 * (verified Phase 6: it applies to ALL redeemers, including loan holders, the
 * "0% for loan holders" rule does not hold in this deployment). The redemption-hint
 * ritual runs immediately before sending and does NOT mine a block in between (interest
 * drift invalidates the partial hint). Simulate-before-send routes any revert through the
 * decoder ({@link mapRevert}): a nothing-redeemable / stale-hint revert ("Unable to redeem
 * any amount") becomes `RedemptionFailed`.
 */
export async function redeem(deps: WriteDeps, params: RedeemParams): Promise<RedeemResult> {
  const wallet = requireWallet(deps)
  const { amount } = params
  assertPositiveAmount('amount', amount)
  const maxIterations = params.maxIterations ?? DEFAULT_REDEMPTION_MAX_ITERATIONS

  const [price, redemptionRate, balance] = await Promise.all([
    deps.publicClient.readContract({
      address: deps.addresses.priceFeed,
      abi: priceFeedAbi,
      functionName: 'fetchPrice',
    }),
    deps.publicClient.readContract({
      address: deps.addresses.borrowerOperations,
      abi: borrowerOperationsAbi,
      functionName: 'redemptionRate',
    }),
    deps.publicClient.readContract({
      address: deps.addresses.musd,
      abi: musdAbi,
      functionName: 'balanceOf',
      args: [wallet.account.address],
    }),
  ])

  // `redeemCollateral` requires the caller to hold the full `amount` (it is burned).
  if (balance < amount) throw new InsufficientMusdBalance(amount, balance)
  // Rate against rate cap: unit consistent, and deliberately left that way. Comparing the
  // fee AMOUNT from `getRedemptionRate` against a 1e18 fraction would be a unit error.
  if (params.maxFeePercentage !== undefined && redemptionRate > params.maxFeePercentage) {
    throw new MaxFeeExceeded(params.maxFeePercentage, redemptionRate, redemptionRate)
  }

  const [firstRedemptionHint, partialNICR, truncatedAmount] = await deps.publicClient.readContract({
    address: deps.addresses.hintHelpers,
    abi: hintHelpersAbi,
    functionName: 'getRedemptionHints',
    args: [amount, price, maxIterations],
  })
  const { upperHint, lowerHint } = await findHintsForNICR(
    { publicClient: deps.publicClient, addresses: deps.addresses },
    partialNICR,
  )

  const { hash } = await simulateAndSend(
    deps,
    wallet,
    deps.addresses.troveManager,
    TM_ABI,
    'redeemCollateral',
    [amount, firstRedemptionHint, upperHint, lowerHint, partialNICR, maxIterations],
    { revert: { operation: 'redeem', address: wallet.account.address } },
  )

  // The fee AMOUNT, estimated. `getRedemptionRate` takes COLLATERAL DRAWN, not a MUSD
  // amount, so convert first: the redemption returns collateral worth `truncatedAmount` of
  // MUSD at the price used for the hints.
  const estimatedCollateralDrawn = price > 0n ? (truncatedAmount * 10n ** 18n) / price : 0n
  const estimatedFeeCollateral =
    estimatedCollateralDrawn > 0n
      ? await deps.publicClient.readContract({
          address: deps.addresses.borrowerOperations,
          abi: borrowerOperationsAbi,
          functionName: 'getRedemptionRate',
          args: [estimatedCollateralDrawn],
        })
      : 0n

  return {
    hash,
    truncatedAmount,
    redemptionRate,
    estimatedFeeCollateral,
    estimatedCollateralDrawn,
  }
}
