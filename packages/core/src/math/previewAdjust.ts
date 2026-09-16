import type { Address } from 'viem'
import {
  borrowerOperationsAbi,
  interestRateManagerAbi,
  musdAbi,
  priceFeedAbi,
  troveManagerAbi,
} from '../clients'
import { CCR, MCR } from '../constants'
import { withTypedErrors } from '../errors/mapRevert'
import { TroveStatus } from '../read/types'
import { capacityAfterAdjustment, computeICR, netDebtOf, troveAmounts } from './compute'
import type { MathDeps } from './deps'
import { isBorrowingFeeCharged } from './fee'
import { type RefinanceBlockReason, evaluateRefinance } from './previewRefinance'

/**
 * The adjust path, previewed (MK-042). One evaluator, because the contract has one:
 * `addColl`, `withdrawColl`, `withdrawMUSD`, `repayMUSD` and `adjustTrove` all funnel into
 * `_adjustTrove` (`BorrowerOperations.sol:752-761`) and are gated by the same code.
 *
 * **Every gate below was read from `mezo-org/musd` for this file**, not carried forward from
 * the earlier table, because part of that table's reasoning turned out to be wrong (MK-038).
 * In call order inside `_adjustTrove`:
 *
 *   :785-787  `if (_isDebtIncrease) _requireNonZeroDebtChange(_mUSDChange)`   -> :1351
 *   :788      `_requireSingularCollChange(_collWithdrawal, msg.value)`        -> :1367
 *   :789      `_requireNonZeroAdjustment(_collWithdrawal, _mUSDChange, msg.value)` -> :1377
 *   :790      `_requireTroveisActive(...)`                                    -> :1179
 *   :813-818  the borrowing fee, skipped when in Recovery Mode or fee exempt
 *   :837      `assert(_collWithdrawal <= vars.coll)`
 *   :840-845  `_requireValidAdjustmentInCurrentMode(...)`                     -> :1212
 *   :850-852  `if (_isDebtIncrease) _requireHasBorrowingCapacity(vars)`       -> :1358
 *   :855-861  on a repayment: `_requireAtLeastMinNetDebt` :1239,
 *             `_requireValidMUSDRepayment` :1246, `_requireSufficientMUSDBalance` :1229
 *
 * And the mode branch, which is where the surprises live (`:1212-1227`):
 *
 *   normal   `:1197-1210`  `_requireICRisAboveMCR(newICR)` :1201 AND
 *                          `_requireNewTCRisAboveCCR(newTCR)` :1209
 *   recovery `:1265-1275`  `_requireNoCollWithdrawal(_collWithdrawal)` :1270, then
 *                          ONLY IF the debt increases:
 *                          `_requireICRisAboveCCR(newICR)` :1272 AND
 *                          `_requireNewICRisAboveOldICR(newICR, oldICR)` :1273
 *
 * **Read those two side by side, because they are not what a Liquity reader expects.**
 *
 *   - **The individual ratio gate is ABSOLUTE, with no direction condition** (MK-038).
 *     `_requireICRisAboveMCR` is `require(_newICR >= MCR, ...)` (`:1330-1335`). It tests the
 *     RESULTING level, not whether the operation helped. So in normal mode a position that is
 *     ALREADY below MCR cannot be rescued by a partial top-up: the ICR rises and the call
 *     still reverts. That is the case a reasonable integrator gets wrong, and it is why
 *     `icrIsAbsolute` is on the result.
 *   - **Recovery Mode does NOT check TCR here**, and normal mode does. The mode with the
 *     tighter reputation has the shorter list for a pure top-up or a pure repayment: both are
 *     ungated in Recovery Mode, and gated in normal mode.
 */

/**
 * The live borrowing capacity picture for one owner (MK-002).
 *
 * Declared here rather than beside `previewBorrow` since MK-060: the capacity gate
 * (`:850-852`) is an adjust path gate, and borrowing is a point on the adjust path rather than
 * a sibling of it. `previewBorrow` re-exports this type, so the public name is unchanged.
 */
export interface BorrowingCapacity {
  /**
   * `maxBorrowingCapacity` as stored on chain. Set at open, lowered on a collateral decrease, and
   * reset from the current price by every refinance, up or down (MK-101).
   */
  capacity: bigint
  /** The Trove's live entire debt, principal plus accrued interest, as the gate sees it. */
  entireDebt: bigint
  /**
   * `capacity - entireDebt`, floored at zero. The headroom for `draw + fee`, not for the draw.
   *
   * **This is the distance to the liquidation threshold, and it expires in about a second**
   * (MK-072). `_calculateMaxBorrowingCapacity` is `(coll * price) / (110 * 1e16)`
   * (`BorrowerOperations.sol:1323-1328`) and `MCR` is `1.1e18`, so `capacity` is exactly the
   * entire debt at which `_requireICRisAboveMCR` (`:1330-1335`) stops holding, computed at the
   * OPENING price. A draw that consumes this figure in full therefore lands the position at
   * `ICR == MCR`, where one second of accrued interest is enough to make the same call revert
   * with `BorrowerOps: An operation that would result in ICR < MCR is not permitted`. Observed
   * on a fork at 1s, 60s, 600s and 3600s, and pinned by `zz-limit-figures.fork.test.ts`: the exact
   * figure sent one second after the read is refused with `ExceedsBorrowingCapacity`, before gas.
   *
   * **Why it expires loudly, where the open ceiling expired silently (MK-100).** `_adjustTrove`
   * brings interest current before any gate (`BorrowerOperations.sol:769`), so this exact figure is
   * REFUSED a block later rather than accepted at the threshold; the refusal is loud. An open
   * evaluates its gates with no accrual (`:648-657`), which is why the open time ceiling was
   * accepted and needed a margin. A draw just UNDER this figure is still accepted near MCR, which is
   * the reason to size draws with `previewBorrow` and show its `resultingIcr`.
   *
   * Use it to render headroom, not to size a draw. **To size a draw, ask
   * {@link previewBorrow}**, which evaluates the ratio gate as well as this one and correctly
   * returns `viable: false` for a draw sized from this number.
   */
  remaining: bigint
}

/**
 * Build a {@link BorrowingCapacity} from the two figures behind it (MK-094).
 *
 * **One copy, because two surfaces publish this field.** `evaluateAdjust` puts it on every
 * adjust and borrow preview, and `getBorrowingCapacity` returns it standalone. Both computed
 * `capacity > entireDebt ? capacity - entireDebt : 0n` separately, which is two implementations
 * of one field on one Trove. They agreed; nothing made them.
 */
export function borrowingCapacityOf(capacity: bigint, entireDebt: bigint): BorrowingCapacity {
  return { capacity, entireDebt, remaining: capacity > entireDebt ? capacity - entireDebt : 0n }
}

/**
 * What a refinance would cost to win back capacity an adjustment removed (MK-242), projected on the state
 * the adjustment leaves, at the price it was previewed at, through {@link evaluateRefinance}.
 *
 * A refinance is the only write that raises stored capacity (`BorrowerOperations.sol:1077-1084`), and it
 * is not free: it charges `getBorrowingFee(refinancingFeePercentage * netDebt / 100)` into principal
 * (`:1029-1040`), moves the Trove to the global interest rate whatever it is (`:1069`, `:1075`), is
 * refused in Recovery Mode (`:1023`), and needs ICR at or above MCR after its fee (`:1058`).
 *
 * **A projection at this block, not a quote.** A refinance sent later is charged on the debt then, at the
 * rate then, and restores capacity from the collateral and the price then.
 */
export interface CapacityRecovery {
  /** The only write that restores capacity. */
  via: 'refinance'
  /** The refinancing fee, in MUSD, added to principal. Zero for a fee exempt account. */
  fee: bigint
  /** The rate the Trove carries now, in basis points. */
  currentInterestRateBps: number
  /** The global rate a refinance moves it to, in basis points. It can be HIGHER than the current one. */
  resultingInterestRateBps: number
  /** The capacity a refinance would write, `resultingCollateral * price / 1.1`, at this price. */
  capacity: bigint
  /** Whether the contract would accept that refinance on the resulting state, at this price. */
  viable: boolean
  /** Why not, in contract call order, from {@link evaluateRefinance}. */
  reasons: RefinanceBlockReason[]
}

/**
 * The borrowing capacity an adjustment leaves behind (MK-242).
 *
 * **A withdrawal can lower capacity permanently.** `_adjustTrove` recomputes it only when collateral
 * decreases, and stores the smaller of the current and recalculated figures (`BorrowerOperations.sol:879-899`);
 * adding collateral never raises it (`:880`). So withdrawing during a price fall and adding the same
 * collateral back later leaves every future borrow gated on the lower figure (`:1358-1365`) until a
 * refinance.
 */
export interface CapacityAfter {
  /** `getTroveMaxBorrowingCapacity` now, before the adjustment. */
  current: bigint
  /** The capacity the adjustment writes: {@link capacityAfterAdjustment}. */
  resulting: bigint
  /** `current - resulting`: capacity this adjustment removes. Zero when it removes none. */
  lost: bigint
  /**
   * Always `false`: a later collateral top up does not restore `lost` (`BorrowerOperations.sol:880`). A
   * literal rather than a boolean a caller could read as conditional.
   */
  restoredByAddingCollateral: false
  /**
   * What winning `lost` back by refinancing would cost, or `null` when nothing is lost. Also `null` from
   * the pure {@link evaluateAdjust}, which reads nothing; {@link previewAdjustTrove} and
   * {@link maxWithdrawableCollateral} fill it whenever `lost` is positive.
   */
  recovery: CapacityRecovery | null
}

/** Why an adjust preview came back not viable. Machine readable, stable strings. */
export type AdjustBlockReason =
  /** `_requireTroveisActive` (`:790`, `:1179-1189`). */
  | 'TROVE_NOT_ACTIVE'
  /** `_requireNonZeroAdjustment` (`:789`, `:1377-1386`): nothing was actually requested. */
  | 'NO_CHANGE_REQUESTED'
  /** `_requireSingularCollChange` (`:788`, `:1367-1375`): one direction of collateral only. */
  | 'COLLATERAL_ADD_AND_WITHDRAW'
  /** `_requireNonZeroDebtChange` (`:786`, `:1351-1356`): a debt increase of zero. */
  | 'ZERO_DEBT_INCREASE'
  /**
   * Both debt legs were supplied (MK-077). **SDK input validation, not a contract gate**, and
   * the asymmetry with `COLLATERAL_ADD_AND_WITHDRAW` is real rather than an oversight:
   * `_adjustTrove` takes ONE debt leg, `_mUSDChange` with a separate `_isDebtIncrease` flag
   * (`BorrowerOperations.sol:757-758`), so "both" is unrepresentable on chain and there is
   * nothing for the contract to refuse. The collateral side needs `_requireSingularCollChange`
   * (`:788`, `:1367-1375`) precisely because `msg.value` and `_collWithdrawal` ARE two
   * parameters.
   *
   * Before this reason existed the evaluator took the increase, dropped the repayment and
   * returned `viable: true`, while `trove/index.ts:523-525` threw `InvalidAdjustment` for the
   * same input. The preview now refuses what the write path refuses.
   */
  | 'DEBT_INCREASE_AND_REPAY'
  /** `assert(_collWithdrawal <= vars.coll)` (`:837`). An assert, so on chain this is a Panic. */
  | 'WITHDRAWAL_EXCEEDS_COLLATERAL'
  /** `_requireNoCollWithdrawal` (`:1270`, `:1388-1393`). Recovery Mode only. */
  | 'COLLATERAL_WITHDRAWAL_IN_RECOVERY_MODE'
  /** `_requireICRisAboveMCR` (`:1201`) or `_requireICRisAboveCCR` (`:1272`). **Absolute.** */
  | 'ICR_BELOW_THRESHOLD'
  /** `_requireNewICRisAboveOldICR` (`:1273`). Recovery Mode, debt increases only. */
  | 'ICR_NOT_IMPROVED_IN_RECOVERY_MODE'
  /** `_requireNewTCRisAboveCCR` (`:1209`). **Normal mode only**; Recovery Mode omits it. */
  | 'TCR_BELOW_CCR'
  /** `_requireHasBorrowingCapacity` (`:851`, `:1358-1365`). Debt increases only. */
  | 'EXCEEDS_BORROWING_CAPACITY'
  /** `_requireAtLeastMinNetDebt` (`:856`, `:1239-1244`). Repayments only. */
  | 'BELOW_MINIMUM_DEBT'
  /** `_requireValidMUSDRepayment` (`:859`, `:1246-1254`). Repayments only. */
  | 'REPAY_EXCEEDS_DEBT'
  /** `_requireSufficientMUSDBalance` (`:860`, `:1229-1237`). Repayments only. */
  | 'INSUFFICIENT_MUSD_BALANCE'

/** Result of {@link previewAdjustTrove}. Raw numbers included so callers render their own copy. */
export interface AdjustPreview {
  /** True only when every constraint the contract enforces is satisfied. */
  viable: boolean
  /** Every reason it is not viable, in contract call order. Empty when `viable`. */
  reasons: AdjustBlockReason[]
  /** The single constraint that binds first, or `null` when viable. */
  bindingConstraint: AdjustBlockReason | null
  /**
   * **True whenever `ICR_BELOW_THRESHOLD` is enforced on this call**, which it is in every
   * mode this operation can reach.
   *
   * It is on the result because the gate is an ABSOLUTE test on the resulting ratio and
   * integrators reliably read it as a do-no-harm test (MK-038). When this is true and
   * `resultingIcr < icrThreshold`, the operation is refused **even if it improves the
   * position**. `minimumCollateralToClearIcr` is what would actually clear it.
   */
  icrIsAbsolute: boolean
  /** The borrowing fee the contract would charge, zero when skipped or not a debt increase. */
  fee: bigint
  /** The debt change the gates compare, the draw plus its fee, or the repayment. */
  netDebtChange: bigint
  /**
   * Capacity, live entire debt, and the remaining headroom, so `EXCEEDS_BORROWING_CAPACITY`
   * arrives with the numbers behind it rather than as a bare reason (MK-060). Reported on
   * every adjustment; only enforced when the debt increases (`:850-852`).
   */
  capacity: BorrowingCapacity
  /**
   * The capacity this adjustment LEAVES, what it removes, and what winning it back would cost (MK-242).
   * `capacity` above is the picture before the adjustment; this is the one after.
   */
  capacityAfter: CapacityAfter
  /** The Trove's collateral after this adjustment. */
  resultingCollateral: bigint
  /** The Trove's entire debt after this adjustment. */
  resultingEntireDebt: bigint
  /** The Trove's ICR before this adjustment, at the current price. */
  currentIcr: bigint
  /** The Trove's ICR after this adjustment, at the current price. */
  resultingIcr: bigint
  /** What `resultingIcr` is measured against: MCR in normal mode, CCR in Recovery Mode. */
  icrThreshold: bigint
  /**
   * The collateral that would have to be in the Trove for `resultingIcr` to reach
   * `icrThreshold`, given the resulting debt. `null` when the resulting debt is zero, when
   * the price is zero, or when the gate is already satisfied.
   *
   * This is the number a rescue needs and the reason a partial top-up is refused.
   *
   * **A floor at this block, not a rescue amount** (MK-100 per figure). It clears the gate against
   * the debt READ here, and `_adjustTrove` accrues interest before its gates
   * (`BorrowerOperations.sol:769`), so a top-up of exactly this much is refused a block later with
   * `InsufficientCollateral` and the Trove stays liquidatable (`zz-limit-figures.fork.test.ts`). A
   * rescued Trove that did clear it would sit on MCR. Add a margin above it.
   */
  minimumCollateralToClearIcr: bigint | null
  /** The system TCR after this adjustment. Reported in both modes; enforced only in normal. */
  resultingTcr: bigint
  /** Whether the system is in Recovery Mode right now. */
  isRecoveryMode: boolean
  /** BTC/USD used for every number above. */
  price: bigint
}

/** Inputs to {@link previewAdjustTrove}. All four default to zero. */
export interface PreviewAdjustParams {
  /** The Trove owner. */
  owner: Address
  /** BTC wei to add. Mutually exclusive with `withdrawCollateral` (`:1367-1375`). */
  addCollateral?: bigint
  /** BTC wei to withdraw. Mutually exclusive with `addCollateral`. */
  withdrawCollateral?: bigint
  /** MUSD to draw. Mutually exclusive with `repayDebt`. */
  increaseDebt?: bigint
  /** MUSD to repay. Mutually exclusive with `increaseDebt`. */
  repayDebt?: bigint
}

/** The four legs, resolved the way the contract receives them (MK-244). */
export interface AdjustLegs {
  addCollateral: bigint
  withdrawCollateral: bigint
  increaseDebt: bigint
  repayDebt: bigint
  /** `_adjustTrove`'s `_isDebtIncrease` (`BorrowerOperations.sol:757`): true only for a non zero draw. */
  isDebtIncrease: boolean
}

/**
 * Resolve the SDK's four optional legs into the call the contract receives, by VALUE (MK-244).
 *
 * **Why value and not presence, reversing the ruling MK-060 made for this path.** The contract takes the
 * collateral legs as two amounts and checks them by value, `_assetAmount == 0 || _collWithdrawal == 0`
 * (`BorrowerOperations.sol:1367-1375`), and the debt as one amount and one flag (`:757-758`). The SDK's
 * two debt legs are not that flag: they are an input the SDK has to ENCODE. A zero leg can be encoded as
 * nothing at all, `(0, false)`, which `_requireNonZeroAdjustment` (`:1377-1386`) accepts beside a collateral
 * change, or as `(0, true)`, which `_requireNonZeroDebtChange` (`:785-787`) refuses. MK-060 chose the refused
 * encoding, and `trove/index.ts` then refused `{ addCollateral: 0n, withdrawCollateral: x }` on presence
 * while the preview, reading values, called it viable and the contract accepted it. A zero leg is no leg.
 *
 * `(0, true)` remains a real input on the one path that sends it unconditionally, `withdrawMUSD`
 * (`:243-257`), which `previewBorrow` states through `EvaluateAdjustInput.isDebtIncrease`.
 */
export function adjustLegsOf(legs: {
  addCollateral?: bigint | undefined
  withdrawCollateral?: bigint | undefined
  increaseDebt?: bigint | undefined
  repayDebt?: bigint | undefined
}): AdjustLegs {
  const increaseDebt = legs.increaseDebt ?? 0n
  return {
    addCollateral: legs.addCollateral ?? 0n,
    withdrawCollateral: legs.withdrawCollateral ?? 0n,
    increaseDebt,
    repayDebt: legs.repayDebt ?? 0n,
    isDebtIncrease: increaseDebt > 0n,
  }
}

/** The reasons an adjustment is refused for its SHAPE alone, which need no chain read. */
export type AdjustShapeReason = Extract<
  AdjustBlockReason,
  | 'ZERO_DEBT_INCREASE'
  | 'COLLATERAL_ADD_AND_WITHDRAW'
  | 'DEBT_INCREASE_AND_REPAY'
  | 'NO_CHANGE_REQUESTED'
>

/**
 * The shape rules of `_adjustTrove`, by value, in contract order (MK-077, MK-244): the one copy that
 * {@link evaluateAdjust} reports from and `adjustTrove` refuses with before it reads the chain.
 *
 *   - `ZERO_DEBT_INCREASE`: `(0, true)`, refused at `BorrowerOperations.sol:785-787`. Reachable only when
 *     the flag is stated true with a zero amount, which `withdrawMUSD` does (`:243-257`).
 *   - `COLLATERAL_ADD_AND_WITHDRAW`: `_requireSingularCollChange` (`:788`, `:1367-1375`), on values.
 *   - `DEBT_INCREASE_AND_REPAY`: both debt legs non zero, which one amount and one flag cannot express
 *     (`:757-758`). SDK input validation, not a contract gate.
 *   - `NO_CHANGE_REQUESTED`: `_requireNonZeroAdjustment` (`:789`, `:1377-1386`), on values.
 */
export function adjustShapeReasons(legs: AdjustLegs): AdjustShapeReason[] {
  const { addCollateral, withdrawCollateral, increaseDebt, repayDebt, isDebtIncrease } = legs
  const reasons: AdjustShapeReason[] = []
  if (isDebtIncrease && increaseDebt === 0n) reasons.push('ZERO_DEBT_INCREASE')
  if (addCollateral > 0n && withdrawCollateral > 0n) reasons.push('COLLATERAL_ADD_AND_WITHDRAW')
  if (increaseDebt > 0n && repayDebt > 0n) reasons.push('DEBT_INCREASE_AND_REPAY')
  if (
    addCollateral === 0n &&
    withdrawCollateral === 0n &&
    increaseDebt === 0n &&
    repayDebt === 0n
  ) {
    reasons.push('NO_CHANGE_REQUESTED')
  }
  return reasons
}

/** Everything {@link evaluateAdjust} needs, already read from the chain. */
export interface EvaluateAdjustInput {
  /** `TroveManager.getTroveStatus`. 1 is active. */
  status: number
  /** Live collateral. */
  collateral: bigint
  /** Live entire debt, principal plus accrued interest. */
  entireDebt: bigint
  /** `getTroveMaxBorrowingCapacity`. */
  capacity: bigint
  /** The caller's MUSD balance, for the repayment gate. */
  musdBalance: bigint
  /** Live `minNetDebt()`. */
  minNetDebt: bigint
  /** The fee the contract will actually charge, already zeroed for Recovery Mode or exemption. */
  fee: bigint
  addCollateral: bigint
  withdrawCollateral: bigint
  increaseDebt: bigint
  repayDebt: bigint
  /**
   * `_adjustTrove`'s own `_isDebtIncrease` parameter (`BorrowerOperations.sol:757`), which the
   * contract takes **independently of `_mUSDChange`** and then reconciles at `:785-787`.
   *
   * MK-060. Deriving it from `increaseDebt > 0n` inside this evaluator would make `(true, 0)`
   * inexpressible, and `(true, 0)` is exactly the input `_requireNonZeroDebtChange` (`:1351-1356`)
   * exists to refuse, so the flag stays a separate parameter as the contract has it.
   *
   * **MK-244, and MK-252 for this comment**: the flag is now derived FROM THE VALUE, by
   * `adjustLegsOf` (`increaseDebt > 0n`), and both `previewAdjustTrove` and the write path in
   * `trove/index.ts` pass what that derivation returns. This comment said both read it from
   * presence until 0.5.0, which was true only until MK-244. The one caller that still states the
   * flag itself is `previewBorrow`, because `withdrawMUSD` sends `(mUSDChange, true)`
   * unconditionally (`:243-257`).
   */
  isDebtIncrease?: boolean
  isRecoveryMode: boolean
  price: bigint
  systemColl: bigint
  systemDebt: bigint
}

/**
 * The verdict, as a pure function of values already read from the chain.
 *
 * Split out for the same reason `evaluateOpen` and `evaluateBorrow` are: the decision is the
 * part worth testing exhaustively, and as a pure function it can be, chain free, across every
 * combination of reasons rather than only the ones a fork happens to produce.
 */
export function evaluateAdjust(input: EvaluateAdjustInput): AdjustPreview {
  const {
    status,
    collateral,
    entireDebt,
    capacity,
    musdBalance,
    minNetDebt,
    fee,
    addCollateral,
    withdrawCollateral,
    increaseDebt,
    repayDebt,
    isRecoveryMode,
    price,
    systemColl,
    systemDebt,
  } = input

  // MK-244. The caller's stated flag when the path fixes it (`previewBorrow`, for `withdrawMUSD`, which
  // always sends `true`), and otherwise the value, through the one resolver the write path also uses.
  const isDebtIncrease = input.isDebtIncrease ?? adjustLegsOf({ increaseDebt }).isDebtIncrease
  // `netDebtChange` is the draw PLUS its fee on the increase path (`:810-817`), and the bare
  // repayment on the decrease path.
  const netDebtChange = isDebtIncrease ? increaseDebt + fee : repayDebt
  const resultingCollateral = collateral + addCollateral - withdrawCollateral
  const resultingEntireDebt = isDebtIncrease ? entireDebt + netDebtChange : entireDebt - repayDebt

  // MK-094. Through the factory, which `getBorrowingCapacity` also calls, so the standalone
  // read and the field on this preview cannot report the same Trove differently.
  const capacityPicture = borrowingCapacityOf(capacity, entireDebt)
  const currentIcr = computeICR({ collateral, entireDebt, price })
  // Clamp the collateral at zero so a withdrawal larger than the balance produces a number
  // rather than a negative, and let WITHDRAWAL_EXCEEDS_COLLATERAL be the reason reported.
  const safeColl = resultingCollateral > 0n ? resultingCollateral : 0n
  const safeDebt = resultingEntireDebt > 0n ? resultingEntireDebt : 0n
  const resultingIcr = computeICR({ collateral: safeColl, entireDebt: safeDebt, price })
  const icrThreshold = isRecoveryMode ? CCR : MCR
  const resultingTcr = computeICR({
    collateral: systemColl + addCollateral - withdrawCollateral,
    entireDebt: isDebtIncrease ? systemDebt + netDebtChange : systemDebt - repayDebt,
    price,
  })

  // MK-242. Through the one copy of `:879-899`. Reported for every input, viable or not, so a caller
  // deciding on a withdrawal sees the capacity it costs before the verdict matters.
  const resultingCapacity = capacityAfterAdjustment({
    currentCapacity: capacity,
    resultingCollateral: safeColl,
    collateralDecreases: withdrawCollateral > 0n && addCollateral === 0n,
    price,
  })
  const capacityAfter: CapacityAfter = {
    current: capacity,
    resulting: resultingCapacity,
    lost: capacity - resultingCapacity,
    restoredByAddingCollateral: false,
    recovery: null,
  }

  // Reported in the order `_adjustTrove` checks them, so `bindingConstraint` is the one the
  // chain would actually report first. The shape of the call comes first, from the one helper the
  // write path also refuses with before any read (MK-244).
  const reasons: AdjustBlockReason[] = adjustShapeReasons({
    addCollateral,
    withdrawCollateral,
    increaseDebt,
    repayDebt,
    isDebtIncrease,
  })
  // MK-094. The enum, not the literal. `TroveStatus.active` is `1`
  // (`TroveManager` `Status`), and three evaluators spelled it as a bare number while two
  // others used the enum for the same comparison.
  if (status !== TroveStatus.active) reasons.push('TROVE_NOT_ACTIVE')
  if (withdrawCollateral > collateral) reasons.push('WITHDRAWAL_EXCEEDS_COLLATERAL')

  if (isRecoveryMode) {
    if (withdrawCollateral > 0n) reasons.push('COLLATERAL_WITHDRAWAL_IN_RECOVERY_MODE')
    if (isDebtIncrease) {
      if (resultingIcr < icrThreshold) reasons.push('ICR_BELOW_THRESHOLD')
      if (resultingIcr < currentIcr) reasons.push('ICR_NOT_IMPROVED_IN_RECOVERY_MODE')
    }
  } else {
    if (resultingIcr < icrThreshold) reasons.push('ICR_BELOW_THRESHOLD')
    if (resultingTcr < CCR) reasons.push('TCR_BELOW_CCR')
  }

  if (isDebtIncrease && capacity < resultingEntireDebt) reasons.push('EXCEEDS_BORROWING_CAPACITY')

  if (!isDebtIncrease && repayDebt > 0n) {
    // `_getNetDebt(debt)` is the entire debt minus the gas compensation (`:856`), through the
    // one copy rather than restated twice in this block (MK-094).
    const netDebt = netDebtOf(entireDebt)
    if (netDebt - repayDebt < minNetDebt) reasons.push('BELOW_MINIMUM_DEBT')
    if (repayDebt > netDebt) reasons.push('REPAY_EXCEEDS_DEBT')
    if (musdBalance < repayDebt) reasons.push('INSUFFICIENT_MUSD_BALANCE')
  }

  // The individual ratio gate applies on every path this evaluator serves except a Recovery
  // Mode call that does not increase debt, which `:1271` skips entirely.
  const icrIsAbsolute = !isRecoveryMode || isDebtIncrease
  const minimumCollateralToClearIcr =
    icrIsAbsolute && safeDebt > 0n && price > 0n && resultingIcr < icrThreshold
      ? // ceil, so the number returned actually clears the gate rather than landing one wei under
        (icrThreshold * safeDebt + price - 1n) / price
      : null

  return {
    viable: reasons.length === 0,
    reasons,
    bindingConstraint: reasons[0] ?? null,
    icrIsAbsolute,
    fee,
    netDebtChange,
    capacity: capacityPicture,
    capacityAfter,
    resultingCollateral,
    resultingEntireDebt,
    currentIcr,
    resultingIcr,
    icrThreshold,
    minimumCollateralToClearIcr,
    resultingTcr,
    isRecoveryMode,
    price,
  }
}

/** Read everything {@link evaluateAdjust} needs, then decide.
 * **Not a single block snapshot**: the price is read outside the batch that uses it. The full
 * statement is on `MathDeps` in `math/deps.ts` (MK-013, MK-093).
 */
export async function previewAdjustTrove(
  deps: MathDeps,
  params: PreviewAdjustParams,
): Promise<AdjustPreview> {
  return withTypedErrors(() => previewAdjustTroveUnchecked(deps, params, true), {
    operation: 'previewAdjustTrove',
  })
}

/**
 * The adjust VERDICT the write path prechecks with: {@link previewAdjustTrove}'s reads and evaluator,
 * without the refinance projection, which a precheck never reads. `capacityAfter.recovery` is `null` on
 * what this returns. Not exported from the package; the write path is its only caller (MK-242).
 */
export function previewAdjustVerdict(
  deps: MathDeps,
  params: PreviewAdjustParams,
): Promise<AdjustPreview> {
  return previewAdjustTroveUnchecked(deps, params, false)
}

async function previewAdjustTroveUnchecked(
  deps: MathDeps,
  params: PreviewAdjustParams,
  projectRecovery: boolean,
): Promise<AdjustPreview> {
  const { publicClient, addresses } = deps
  const owner = params.owner
  // MK-244. By value, through the resolver `adjustTrove` sends with, so the preview and the write
  // describe one call.
  const { addCollateral, withdrawCollateral, increaseDebt, repayDebt, isDebtIncrease } =
    adjustLegsOf(params)

  const price = await publicClient.readContract({
    address: addresses.priceFeed,
    abi: priceFeedAbi,
    functionName: 'fetchPrice',
  })
  const tm = { address: addresses.troveManager, abi: troveManagerAbi } as const

  const [
    status,
    entire,
    capacity,
    isRecoveryMode,
    musdBalance,
    systemColl,
    systemDebt,
    minNetDebt,
  ] = await Promise.all([
    publicClient.readContract({ ...tm, functionName: 'getTroveStatus', args: [owner] }),
    publicClient.readContract({ ...tm, functionName: 'getEntireDebtAndColl', args: [owner] }),
    publicClient.readContract({
      ...tm,
      functionName: 'getTroveMaxBorrowingCapacity',
      args: [owner],
    }),
    publicClient.readContract({ ...tm, functionName: 'checkRecoveryMode', args: [price] }),
    publicClient.readContract({
      address: addresses.musd,
      abi: musdAbi,
      functionName: 'balanceOf',
      args: [owner],
    }),
    publicClient.readContract({ ...tm, functionName: 'getEntireSystemColl' }),
    publicClient.readContract({ ...tm, functionName: 'getEntireSystemDebt' }),
    deps.getMinNetDebt(),
  ])

  // Read exemption rather than assuming nobody is exempt (MK-018): the cohort is non empty
  // on mainnet, and the fee is what the capacity and ratio gates compare against.
  const exempt = isDebtIncrease ? await deps.isAccountFeeExempt(owner) : false
  const fee =
    isDebtIncrease && isBorrowingFeeCharged(isRecoveryMode, exempt)
      ? await publicClient.readContract({
          address: addresses.borrowerOperations,
          abi: borrowerOperationsAbi,
          functionName: 'getBorrowingFee',
          args: [increaseDebt],
        })
      : 0n

  const amounts = troveAmounts(entire)
  const preview = evaluateAdjust({
    status,
    collateral: amounts.collateral,
    entireDebt: amounts.entireDebt,
    capacity,
    musdBalance,
    minNetDebt,
    fee,
    addCollateral,
    withdrawCollateral,
    increaseDebt,
    repayDebt,
    isDebtIncrease,
    isRecoveryMode,
    price,
    systemColl,
    systemDebt,
  })
  if (!projectRecovery) return preview
  const capacityAfter = await withCapacityRecovery(deps, owner, preview.capacityAfter, {
    collateral: preview.resultingCollateral,
    entireDebt: preview.resultingEntireDebt,
    price,
    isRecoveryMode,
    systemColl: systemColl + addCollateral - withdrawCollateral,
    systemDebt: systemDebt + preview.resultingEntireDebt - amounts.entireDebt,
  })
  return { ...preview, capacityAfter }
}

/**
 * Fill {@link CapacityAfter.recovery} when an adjustment removes capacity (MK-242): read what a refinance
 * needs and project one on the state the adjustment leaves, through {@link evaluateRefinance}, the one
 * implementation of `_refinance`'s rules. Reads nothing when nothing is lost.
 *
 * The projected Trove is the resulting one: its collateral and entire debt, carried as principal with no
 * separate interest, which is what `_refinance` reads after bringing interest current (`:1021`, `:1050`).
 * The system totals are the resulting ones, passed in by the caller that knows them.
 */
async function withCapacityRecovery(
  deps: MathDeps,
  owner: Address,
  capacityAfter: CapacityAfter,
  projected: {
    collateral: bigint
    entireDebt: bigint
    price: bigint
    isRecoveryMode: boolean
    systemColl: bigint
    systemDebt: bigint
  },
): Promise<CapacityAfter> {
  if (capacityAfter.lost === 0n) return capacityAfter
  const { publicClient, addresses } = deps
  const [percentage, currentRate, globalRate, feeExempt] = await Promise.all([
    publicClient.readContract({
      address: addresses.borrowerOperations,
      abi: borrowerOperationsAbi,
      functionName: 'refinancingFeePercentage',
    }),
    publicClient.readContract({
      address: addresses.troveManager,
      abi: troveManagerAbi,
      functionName: 'getTroveInterestRate',
      args: [owner],
    }),
    publicClient.readContract({
      address: addresses.interestRateManager,
      abi: interestRateManagerAbi,
      functionName: 'interestRate',
    }),
    deps.isAccountFeeExempt(owner),
  ])
  // `_refinance`'s fee base, `refinancingFeePercentage * _getNetDebt(debt) / 100` (`:1029-1032`), on the
  // resulting debt, priced by the chain's own getter.
  const borrowingFeeOnBase = await publicClient.readContract({
    address: addresses.borrowerOperations,
    abi: borrowerOperationsAbi,
    functionName: 'getBorrowingFee',
    args: [(BigInt(percentage) * netDebtOf(projected.entireDebt)) / 100n],
  })
  const refinance = evaluateRefinance({
    status: TroveStatus.active,
    collateral: projected.collateral,
    principal: projected.entireDebt,
    interestOwed: 0n,
    refinancingFeePercentage: Number(percentage),
    borrowingFeeOnBase,
    feeExempt,
    isRecoveryMode: projected.isRecoveryMode,
    price: projected.price,
    systemColl: projected.systemColl,
    systemDebt: projected.systemDebt,
    currentInterestRateBps: Number(currentRate),
    globalInterestRateBps: Number(globalRate),
    currentCapacity: capacityAfter.resulting,
  })
  return {
    ...capacityAfter,
    recovery: {
      via: 'refinance',
      fee: refinance.fee,
      currentInterestRateBps: refinance.currentInterestRateBps,
      resultingInterestRateBps: refinance.resultingInterestRateBps,
      capacity: refinance.resultingCapacity,
      viable: refinance.viable,
      reasons: refinance.reasons,
    },
  }
}

/** Preview withdrawing collateral. The adjust path with only a withdrawal (`:225-240`). */
export async function previewWithdrawCollateral(
  deps: MathDeps,
  params: { owner: Address; amount: bigint },
): Promise<AdjustPreview> {
  return withTypedErrors(() => previewWithdrawCollateralUnchecked(deps, params), {
    operation: 'previewWithdrawCollateral',
  })
}

function previewWithdrawCollateralUnchecked(
  deps: MathDeps,
  params: { owner: Address; amount: bigint },
): Promise<AdjustPreview> {
  return previewAdjustTrove(deps, { owner: params.owner, withdrawCollateral: params.amount })
}

/** How much collateral can be withdrawn right now, and what stops more. */
export interface MaxWithdrawable {
  /**
   * BTC wei that can be withdrawn in a single `withdrawCollateral` call. **Zero in Recovery
   * Mode**, where `_requireNoCollWithdrawal` (`:1270`) refuses any withdrawal at all.
   *
   * **Good for the block it was computed at and no block a caller can reach** (MK-051,
   * MK-073). The cap is bounded by `ICR >= MCR` against a debt that GROWS with accrued
   * interest, so this figure SHRINKS: measured on a fork with only the delay varied, the
   * reported maximum was accepted at 0s and refused with `InsufficientCollateral` at 1s, 60s,
   * 600s, 3600s and 86400s, with half the maximum succeeding throughout as the control.
   *
   * The SDK refuses it before sending rather than spending gas on it, so the cost is a typed
   * error and not a failed transaction. Withdraw less than this, or recompute at the point of
   * use. MK-051 carries the measurement.
   *
   * **A limit, not an amount to withdraw** (MK-247): when the individual ratio caps it, a withdrawal
   * that is accepted at it leaves the Trove at MCR, where liquidation begins (`TroveManager.sol:1146-1148`).
   */
  amount: bigint
  /** Which gate caps it, or `null` when nothing does and the whole balance can come out. */
  limitedBy: 'RECOVERY_MODE' | 'ICR' | 'TCR' | null
  /**
   * The borrowing capacity a withdrawal of `amount` leaves, and what it removes (MK-242). A withdrawal
   * stores `min(current, (collateral - amount) * price / 1.1)` (`BorrowerOperations.sol:879-899`) and adding
   * the collateral back never raises it (`:880`), so withdrawing the maximum during a price fall can cut
   * every later borrow until a refinance, whose cost is in `recovery`.
   */
  capacityAfter: CapacityAfter
  /** The collateral the Trove holds now. */
  collateral: bigint
  /** The ICR the Trove would have at `amount`, which is `icrThreshold` when ICR is the cap. */
  resultingIcr: bigint
  /** MCR normally, CCR in Recovery Mode. */
  icrThreshold: bigint
  isRecoveryMode: boolean
  price: bigint
}

/**
 * The largest withdrawal the contract would accept right now (MK-042).
 *
 * Closed form, from the two gates that bind a pure withdrawal in normal mode
 * (`:1197-1210`). Debt does not change, so:
 *
 *   ICR gate: `(coll - x) * price / debt >= MCR`   ->  `x <= coll - MCR * debt / price`
 *   TCR gate: `(sysColl - x) * price / sysDebt >= CCR` -> `x <= sysColl - CCR * sysDebt / price`
 *
 * The binding cap is the smaller, floored at zero. **In Recovery Mode the answer is zero**,
 * not a smaller positive number: withdrawal is refused outright rather than limited.
 *
 * Reported alongside `limitedBy` because "you can withdraw 0" and "you can withdraw 0 because
 * the system is in Recovery Mode" are different messages to a user.
 *
 * **Not a single block snapshot**: the price is read outside the batch that uses it. The full
 * statement is on `MathDeps` in `math/deps.ts` (MK-013, MK-093).
 */
export async function maxWithdrawableCollateral(
  deps: MathDeps,
  owner: Address,
): Promise<MaxWithdrawable> {
  return withTypedErrors(() => maxWithdrawableCollateralUnchecked(deps, owner), {
    operation: 'maxWithdrawableCollateral',
  })
}

async function maxWithdrawableCollateralUnchecked(
  deps: MathDeps,
  owner: Address,
): Promise<MaxWithdrawable> {
  const { publicClient, addresses } = deps
  const price = await publicClient.readContract({
    address: addresses.priceFeed,
    abi: priceFeedAbi,
    functionName: 'fetchPrice',
  })
  const tm = { address: addresses.troveManager, abi: troveManagerAbi } as const
  const [entire, isRecoveryMode, systemColl, systemDebt, currentCapacity] = await Promise.all([
    publicClient.readContract({ ...tm, functionName: 'getEntireDebtAndColl', args: [owner] }),
    publicClient.readContract({ ...tm, functionName: 'checkRecoveryMode', args: [price] }),
    publicClient.readContract({ ...tm, functionName: 'getEntireSystemColl' }),
    publicClient.readContract({ ...tm, functionName: 'getEntireSystemDebt' }),
    // MK-242. The capacity the maximum withdrawal would leave is part of deciding to withdraw it.
    publicClient.readContract({
      ...tm,
      functionName: 'getTroveMaxBorrowingCapacity',
      args: [owner],
    }),
  ])
  const amounts = troveAmounts(entire)
  const max = computeMaxWithdrawable({
    collateral: amounts.collateral,
    entireDebt: amounts.entireDebt,
    isRecoveryMode,
    price,
    systemColl,
    systemDebt,
    capacity: currentCapacity,
  })
  const capacityAfter = await withCapacityRecovery(deps, owner, max.capacityAfter, {
    collateral: amounts.collateral - max.amount,
    entireDebt: amounts.entireDebt,
    price,
    isRecoveryMode,
    systemColl: systemColl - max.amount,
    systemDebt,
  })
  return { ...max, capacityAfter }
}

/** The closed form behind {@link maxWithdrawableCollateral}, as a pure function. */
export function computeMaxWithdrawable(input: {
  collateral: bigint
  entireDebt: bigint
  isRecoveryMode: boolean
  price: bigint
  systemColl: bigint
  systemDebt: bigint
  /** `getTroveMaxBorrowingCapacity`, for the capacity the withdrawal leaves (MK-242). */
  capacity: bigint
}): MaxWithdrawable {
  const { collateral, entireDebt, isRecoveryMode, price, systemColl, systemDebt } = input
  const icrThreshold = isRecoveryMode ? CCR : MCR
  // MK-242. Through the one copy of `:879-899`, at the amount this returns. A zero amount withdraws
  // nothing and leaves capacity where it is.
  const capacityAt = (amount: bigint): CapacityAfter => {
    const resulting = capacityAfterAdjustment({
      currentCapacity: input.capacity,
      resultingCollateral: collateral - amount,
      collateralDecreases: amount > 0n,
      price,
    })
    return {
      current: input.capacity,
      resulting,
      lost: input.capacity - resulting,
      restoredByAddingCollateral: false,
      recovery: null,
    }
  }

  if (isRecoveryMode) {
    return {
      amount: 0n,
      limitedBy: 'RECOVERY_MODE',
      capacityAfter: capacityAt(0n),
      collateral,
      resultingIcr: computeICR({ collateral, entireDebt, price }),
      icrThreshold,
      isRecoveryMode,
      price,
    }
  }
  if (price === 0n) {
    return {
      amount: 0n,
      limitedBy: 'ICR',
      capacityAfter: capacityAt(0n),
      collateral,
      resultingIcr: 0n,
      icrThreshold,
      isRecoveryMode,
      price,
    }
  }

  // Collateral that must STAY for each gate. Ceil, so the remainder actually clears the gate.
  const keepForIcr = entireDebt > 0n ? (MCR * entireDebt + price - 1n) / price : 0n
  const keepForTcr = systemDebt > 0n ? (CCR * systemDebt + price - 1n) / price : 0n

  const byIcr = collateral > keepForIcr ? collateral - keepForIcr : 0n
  const bySystem = systemColl > keepForTcr ? systemColl - keepForTcr : 0n
  const amount = byIcr < bySystem ? byIcr : bySystem
  // MK-076. The gate that actually binds, which is the smaller allowance, whatever the answer
  // happens to be. The old form was `amount === 0n || byIcr <= bySystem ? 'ICR' : 'TCR'`, whose
  // first clause reported `ICR` for every zero answer including the ones where the individual
  // ratio allowed a large withdrawal and the SYSTEM ratio allowed none. That is the case this
  // field exists to distinguish: the docstring below argues that "you can withdraw 0" and "you
  // can withdraw 0 because of the system" are different messages, and the code did not honour
  // it. Ties go to ICR, which is the gate a caller can act on.
  const limitedBy = byIcr <= bySystem ? 'ICR' : 'TCR'

  return {
    amount,
    // Nothing caps it only when the position carries no debt at all, so the whole balance
    // clears both gates.
    limitedBy: entireDebt === 0n && systemDebt === 0n ? null : limitedBy,
    capacityAfter: capacityAt(amount),
    collateral,
    resultingIcr: computeICR({ collateral: collateral - amount, entireDebt, price }),
    icrThreshold,
    isRecoveryMode,
    price,
  }
}
