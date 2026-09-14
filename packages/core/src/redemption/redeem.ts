import type { Abi, Hex } from 'viem'
import {
  borrowerOperationsAbi,
  hintHelpersAbi,
  musdAbi,
  priceFeedAbi,
  troveManagerAbi,
} from '../clients'
import {
  InsufficientMusdBalance,
  MaxFeeExceeded,
  RedemptionBreachesDebtFloor,
  RedemptionPriceFragile,
  assertPositiveAmount,
} from '../errors'
import { findHintsForNICR } from '../hints'
import { type GasDecision, type WriteDeps, requireWallet, simulateAndSend } from '../internal/write'
import { estimateCollateralDrawn, exceedsRateCap } from '../math/fee'
import {
  DEFAULT_REDEMPTION_MAX_ITERATIONS,
  type PartialRedemption,
  REDEMPTION_PRICE_MOVE_TOLERANCE,
  REDEMPTION_SEND_MARGIN_SECONDS,
  assertMaxIterations,
  previewRedeem,
} from '../math/previewRedeem'

const TM_ABI: Abi = troveManagerAbi

/**
 * The default walk bound for a redemption (override per call). Defined beside the preview, which
 * reads it too, and re-exported here where it has always been exported from (MK-114).
 */
export { DEFAULT_REDEMPTION_MAX_ITERATIONS }

/** Parameters for {@link MusdClient.redeem}. */
export interface RedeemParams {
  /** MUSD to redeem for BTC (burned from the caller). */
  amount: bigint
  /**
   * Cap on the eligible Troves the call redeems from, sent to `getRedemptionHints` and
   * `redeemCollateral` as their `_maxIterations`. Default {@link DEFAULT_REDEMPTION_MAX_ITERATIONS}.
   *
   * **`0n` means no limit** (MK-114), which is what both contract functions do with zero
   * (`TroveManager.sol:353-355`, `HintHelpers.sol:107-109`), and the precheck walk reads it the same
   * way. It is accepted rather than refused because it is the contract's documented meaning, typing
   * `0n` is a deliberate act, and the work it asks for is bounded by `amount`: the loop stops once the
   * request is covered. Negative values and values above the largest `uint256` throw `InvalidAmount`.
   */
  maxIterations?: bigint
  /**
   * SDK-side cap on the redemption RATE, as a 1e18 scaled fraction, compared against
   * `redemptionRate()`. Rate against rate: it is not a cap on the fee amount.
   *
   * **This is advisory and is NOT an on-chain guarantee** (MK-011). `redeemCollateral` takes
   * no fee cap parameter at all (`TroveManager.sol:294-301`), so nothing on chain enforces
   * this, and no other MUSD write path takes one either: the full signatures in
   * `docs/01-ground-truth.md` §5.1 are `(amount, upperHint, lowerHint)` shaped throughout.
   * There is nothing to pass a cap to.
   *
   * The race, spelled out in the order it happens: the SDK reads the rate; it compares that
   * value against your cap and may throw; it sends. Between the read and the mine the
   * governable rate can change, and the transaction goes through at whatever is live then.
   * Nothing reverts. **A passing check means the rate was within your cap when it was read,
   * and nothing more.** It is opt in and defaults to no cap, so the DEFAULT behavior is to
   * accept any rate the protocol charges.
   *
   * If you need a real bound, the enforcement has to be yours: compare the fee from the
   * `Redemption` event after the receipt, or do not send while the rate is moving.
   */
  maxFeePercentage?: bigint
  /**
   * Send a partial redemption on the first Trove drawn even when it is price fragile (MK-103).
   *
   * Default `false`: `redeem()` throws {@link RedemptionPriceFragile} before spending gas when the
   * partial would cancel, and so revert the call, on a price move smaller than the measured two block
   * move. Set it when you have decided that the chance of a same price block is worth the gas.
   */
  acceptPriceFragilePartial?: boolean
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
   * What `getRedemptionHints` returned. **Do not size a redemption from this number** (MK-048).
   *
   * The old wording here said the actual amount "can be less when a partial of the last Trove is
   * skipped". That understates it in the way that matters: the actual amount is often ZERO and
   * the transaction REVERTS, because the helper and the loop answer different questions.
   * `HintHelpers.sol:143-146` sizes each partial to the target's headroom above the debt floor
   * and then continues to the next Trove, which needs one call per Trove;
   * `TroveManager.sol:1218-1221` hands the whole amount to the first Trove and cancels if that
   * breaches the floor (`:1299-1306`, `:392`, `:406-408`).
   *
   * Verified on a fork to the wei: the helper reported `headroom + 1`, `netDebt / 2` and
   * `netDebt - 1` as fully redeemable, and all three revert.
   *
   * **Use `previewRedeem` instead.** It walks the list the way the loop does and reports what a
   * single call will actually redeem, plus the two edges of the gap. This field is kept because
   * it is what the contract was handed, which is worth being able to see.
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
  /**
   * How the gas limit on this send was chosen (MK-037), the same field every other write
   * result carries.
   *
   * It matters most here. `redeemCollateral` is the write MK-035 was found on: the same call
   * from byte identical state varied from 610270 to 710023 gas, and the one that reverted grew
   * 16.4%. If any send in this SDK is going to lose its margin and run out of gas, it is this
   * one, so `gas.source === 'fallback'` is worth checking on a redemption even if you ignore it
   * everywhere else.
   */
  gas: GasDecision
  /**
   * The partial this redemption was sent with, including the centred hint and its price
   * tolerances, or `null` when every Trove it touches is consumed whole (MK-103).
   */
  partial: PartialRedemption | null
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
  assertMaxIterations(maxIterations)

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
  // MK-048. The gap the debt floor creates, prechecked BEFORE simulate.
  //
  // This is prechecked where a plain revert would have been tolerable elsewhere, and the reason
  // is that the blocking condition is not in the caller's position: it is the headroom of the
  // first eligible Trove in the sorted list, which belongs to someone else, moves without the
  // caller doing anything, and is invisible from every field the SDK used to expose. A caller
  // cannot foresee it, so leaving them to discover it by paying gas is the wrong trade. Every
  // other precheck this SDK has guards a condition the caller can at least inspect.
  const redemption = await previewRedeem(
    {
      publicClient: deps.publicClient,
      addresses: deps.addresses,
      getMinNetDebt: deps.getMinNetDebt,
      isAccountFeeExempt: deps.isAccountFeeExempt,
    },
    // MK-104. The SENDING margin, not the advice margin: `nextViableAmount` already carries 900
    // seconds of accrual from the block it was read at, and adding them again here refused that
    // advice a block after giving it.
    {
      redeemer: wallet.account.address,
      amount,
      maxIterations,
      marginSeconds: REDEMPTION_SEND_MARGIN_SECONDS,
    },
  )
  if (!redemption.viable && redemption.bindingConstraint === 'PARTIAL_BREACHES_DEBT_FLOOR') {
    throw new RedemptionBreachesDebtFloor({
      requested: amount,
      maxWithoutConsuming: redemption.maxWithoutConsuming,
      nextViableAmount: redemption.nextViableAmount,
    })
  }

  // MK-103. Refuse, before gas, a partial whose cancel would revert the call on an ordinary move.
  const partial = redemption.viable ? redemption.partial : null
  if (
    partial?.revertsCallIfCancelled &&
    partial.priceFragile &&
    !params.acceptPriceFragilePartial
  ) {
    throw new RedemptionPriceFragile({
      requested: amount,
      priceToleranceUp: partial.priceToleranceUp,
      priceToleranceDown: partial.priceToleranceDown,
      requiredTolerance: REDEMPTION_PRICE_MOVE_TOLERANCE,
      nextViableAmount: redemption.nextViableAmount,
    })
  }

  if (exceedsRateCap(redemptionRate, params.maxFeePercentage)) {
    throw new MaxFeeExceeded(params.maxFeePercentage as bigint, redemptionRate, redemptionRate)
  }

  // The hints are computed at the price the preview evaluated, so the partial's band and the first
  // hint describe the same state.
  const [firstRedemptionHint, helperNICR, truncatedAmount] = await deps.publicClient.readContract({
    address: deps.addresses.hintHelpers,
    abi: hintHelpersAbi,
    functionName: 'getRedemptionHints',
    args: [amount, redemption.price, maxIterations],
  })
  // MK-103. The CENTRE of the contract's band rather than the helper's lower edge, which tolerated
  // no price rise at all. With no partial there is nothing to hint, and the helper's value stands.
  const partialNICR = partial?.hintNicr ?? helperNICR
  const { upperHint, lowerHint } = await findHintsForNICR(
    { publicClient: deps.publicClient, addresses: deps.addresses },
    partialNICR,
  )

  const { hash, gas } = await simulateAndSend(
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
  const estimatedCollateralDrawn = estimateCollateralDrawn(truncatedAmount, price)
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
    gas,
    partial,
  }
}
