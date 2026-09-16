import { type Abi, type Hex, type TransactionReceipt, parseEventLogs } from 'viem'
import { borrowerOperationsAbi, hintHelpersAbi, musdAbi, troveManagerAbi } from '../clients'
import { DECIMAL_PRECISION } from '../constants'
import {
  InsufficientMusdBalance,
  LastTroveInSystem,
  MaxFeeExceeded,
  RedemptionBreachesDebtFloor,
  RedemptionFailed,
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
 * What a redemption SETTLED, read from the `Redemption` event in its receipt (MK-241).
 *
 * `TroveManager.redeemCollateral` emits `Redemption(_attemptedAmount, _actualAmount, _collateralSent,
 * _collateralFee)` once, after the loop (`TroveManager.sol:420-425`, declared at
 * `ITroveManager.sol:48-53`). **The contract's own names are a trap here, as they were for the rate
 * (MK-014)**: `_collateralSent` is passed `totals.totalCollateralDrawn`, which INCLUDES the fee, and
 * the redeemer is sent `totalCollateralDrawn - collateralFee` (`:416-418`, `:444-447`). So the fields
 * below are named for what each quantity is, and the one the redeemer receives is derived.
 */
export interface SettledRedemption {
  /** The block the redemption mined in. */
  blockNumber: bigint
  /** `_attemptedAmount`: the MUSD the call asked to redeem, the `amount` sent. */
  attemptedAmount: bigint
  /**
   * `_actualAmount`: the MUSD actually redeemed and burned from the caller (`TroveManager.sol:428-431`).
   * **Can be far less than `attemptedAmount`**: the loop stops at the first cancelled partial
   * (`:392`, `:1299-1306`), and a call succeeds as long as something was drawn (`:406-408`).
   */
  redeemedAmount: bigint
  /** `attemptedAmount - redeemedAmount`: MUSD asked for and not redeemed, still in the caller's balance. */
  unredeemedAmount: bigint
  /** `_collateralSent`, which is collateral DRAWN from the Troves, fee included, in BTC wei. */
  collateralDrawn: bigint
  /** `_collateralFee`, the redemption fee in BTC wei, sent to the PCV (`:433-437`). */
  collateralFee: bigint
  /** `collateralDrawn - collateralFee`: the BTC wei the redeemer actually received (`:444-447`). */
  collateralReceived: bigint
}

/**
 * Figures computed BEFORE the transaction was sent (MK-241). An estimate is all they are, and the name
 * says so: the redemption settles against the chain at inclusion, and {@link SettledRedemption} is
 * what it did.
 */
export interface RedemptionEstimateBeforeSend {
  /**
   * `previewRedeem(...).redeemable` at the send margin: what the SDK's walk of the sorted list expected
   * one call to redeem. **Not** `getRedemptionHints`'s `truncatedAmount`, which answers a different
   * question and over-reports whenever a later partial cancels (MK-048, MK-241).
   */
  redeemable: bigint
  /** `redeemable` converted to collateral at the preview's price, in BTC wei, fee included. */
  collateralDrawn: bigint
  /**
   * The fee on that collateral at the live rate, `redemptionRate * collateralDrawn / 1e18`, the
   * contract's own formula (`BorrowerOperations.sol:499-508`), in BTC wei.
   */
  collateralFee: bigint
}

/**
 * Result of {@link MusdClient.redeem}. Every field names its unit (MK-014), and what settled is kept
 * apart from what was expected (MK-241).
 *
 * **`redeem()` resolves once the transaction has MINED**, because what a redemption does is not
 * determined by its inputs: the amount it redeems depends on the sorted list and the price at
 * inclusion. A result returned at send time could only restate an estimate, and until 0.5.0 it did,
 * reporting the hint helper's figures as if they were the outcome (MK-241).
 */
export interface RedeemResult {
  hash: Hex
  /** What the redemption did, from its receipt. */
  settled: SettledRedemption
  /** What the SDK expected before sending. Kept for comparison; never the outcome. */
  estimatedBeforeSend: RedemptionEstimateBeforeSend
  /**
   * The redemption RATE, a 1e18 scaled fraction, read live from `redemptionRate()` before sending.
   * Governable. This is a ratio, not an amount of anything.
   */
  redemptionRate: bigint
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
 * Read what a mined redemption settled from its receipt (MK-241).
 *
 * Exported so a caller holding a receipt of their own, for a redemption sent some other way, reads it
 * the same way. Throws {@link RedemptionFailed} for a reverted receipt, which redeemed nothing, and for
 * a successful receipt with no `Redemption` event from `troveManager`, which is not a redemption.
 */
export function settledRedemptionFrom(
  receipt: Pick<TransactionReceipt, 'status' | 'logs' | 'blockNumber' | 'transactionHash'>,
  troveManager: `0x${string}`,
): SettledRedemption {
  if (receipt.status !== 'success') {
    throw new RedemptionFailed(
      `The redemption ${receipt.transactionHash} mined and reverted, so nothing was redeemed. diagnoseRevertedWrite(publicClient, hash) says whether it ran out of gas or was refused.`,
      receipt,
    )
  }
  const [event] = parseEventLogs({
    abi: troveManagerAbi,
    eventName: 'Redemption',
    logs: receipt.logs.filter((log) => log.address.toLowerCase() === troveManager.toLowerCase()),
  })
  if (event === undefined) {
    throw new RedemptionFailed(
      `The transaction ${receipt.transactionHash} succeeded but emitted no Redemption event from ${troveManager}, so it is not a redemption this client can read.`,
      receipt,
    )
  }
  const { _attemptedAmount, _actualAmount, _collateralSent, _collateralFee } = event.args
  return {
    blockNumber: receipt.blockNumber,
    attemptedAmount: _attemptedAmount,
    redeemedAmount: _actualAmount,
    unredeemedAmount: _attemptedAmount - _actualAmount,
    collateralDrawn: _collateralSent,
    collateralFee: _collateralFee,
    collateralReceived: _collateralSent - _collateralFee,
  }
}

/**
 * Redeem MUSD for BTC against the lowest-ICR Troves. Reads the live redemption rate
 * (verified Phase 6: it applies to ALL redeemers, including loan holders, the
 * "0% for loan holders" rule does not hold in this deployment). The redemption-hint
 * ritual runs immediately before sending and does NOT mine a block in between (interest
 * drift invalidates the partial hint). Simulate-before-send routes any revert through the
 * decoder ({@link mapRevert}): a nothing-redeemable / stale-hint revert ("Unable to redeem
 * any amount") becomes `RedemptionFailed`.
 *
 * **Resolves after the transaction mines**, with what it settled read from the receipt (MK-241). A
 * receipt that reverted throws `RedemptionFailed`.
 */
export async function redeem(deps: WriteDeps, params: RedeemParams): Promise<RedeemResult> {
  const wallet = requireWallet(deps)
  const { amount } = params
  assertPositiveAmount('amount', amount)
  const maxIterations = params.maxIterations ?? DEFAULT_REDEMPTION_MAX_ITERATIONS
  assertMaxIterations(maxIterations)

  const [redemptionRate, balance] = await Promise.all([
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
  // MK-245. A whole consumption of the last Trove reverts the call, and the reason is someone else's
  // position, so it is refused before gas for the same reason the floor gap is.
  if (!redemption.viable && redemption.bindingConstraint === 'LAST_TROVE_IN_SYSTEM') {
    throw new LastTroveInSystem()
  }
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
  const [firstRedemptionHint, helperNICR] = await deps.publicClient.readContract({
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

  // MK-241. Wait for the transaction and read what it did, rather than returning a restatement of an
  // estimate. The receipt is the only place the settled amount exists.
  const receipt = await deps.publicClient.waitForTransactionReceipt({ hash })
  const settled = settledRedemptionFrom(receipt, deps.addresses.troveManager)

  // The estimate, from the SDK's own walk and named as one. `getRedemptionRate` takes COLLATERAL
  // DRAWN, not MUSD (MK-014), and its formula is restated rather than read so the estimate cannot
  // revert on the `fee < collateralDrawn` require (`BorrowerOperations.sol:503-506`) after the send.
  const estimatedDrawn = estimateCollateralDrawn(redemption.redeemable, redemption.price)
  const estimatedBeforeSend: RedemptionEstimateBeforeSend = {
    redeemable: redemption.redeemable,
    collateralDrawn: estimatedDrawn,
    collateralFee: (redemptionRate * estimatedDrawn) / DECIMAL_PRECISION,
  }

  return {
    hash,
    settled,
    estimatedBeforeSend,
    redemptionRate,
    gas,
    partial,
  }
}
