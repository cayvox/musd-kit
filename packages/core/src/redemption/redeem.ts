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

export interface RedeemParams {
  /** MUSD to redeem for BTC (burned from the caller). */
  amount: bigint
  /** Cap the number of Troves scanned/redeemed (default {@link DEFAULT_REDEMPTION_MAX_ITERATIONS}). */
  maxIterations?: bigint
  /** SDK-side fee cap, 1e18-scaled fraction — `redeemCollateral` has NO on-chain maxFee (C5). */
  maxFeePercentage?: bigint
}

export interface RedeemResult {
  hash: Hex
  /**
   * Redeemable amount estimated by `getRedemptionHints` given the `minNetDebt` floor +
   * `maxIterations`. The ACTUAL redeemed amount (in the `Redemption` event) can be less
   * when a partial of the last Trove is skipped — surfaced so callers know.
   */
  truncatedAmount: bigint
  /** Effective redemption rate (1e18-scaled) read live from `redemptionRate()` — governable (C2). */
  fee: bigint
}

/**
 * Redeem MUSD for BTC against the lowest-ICR Troves. Reads the live redemption rate
 * (verified Phase 6: it applies to ALL redeemers, including loan holders — the
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

  const [price, fee, balance] = await Promise.all([
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
  if (params.maxFeePercentage !== undefined && fee > params.maxFeePercentage) {
    throw new MaxFeeExceeded(params.maxFeePercentage, fee, fee)
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

  return { hash, truncatedAmount, fee }
}
