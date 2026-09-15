import type { Address } from 'viem'
import { troveManagerAbi } from '../clients'
import { withTypedErrors } from '../errors/mapRevert'
import { troveAmounts } from './compute'
import type { MathDeps } from './deps'
import {
  type AdjustBlockReason,
  type AdjustPreview,
  type BorrowingCapacity,
  borrowingCapacityOf,
  evaluateAdjust,
  previewAdjustTrove,
} from './previewAdjust'

/**
 * MK-002. Borrowing against an EXISTING Trove, which `getBorrowingPower` never modeled.
 *
 * **This file no longer decides anything (MK-058, MK-059, MK-060, MK-065).** It projects the
 * adjust preview onto the borrow shape, because on chain a borrow IS an adjustment:
 *
 * ```solidity
 * function withdrawMUSD(uint256 _amount, address _upperHint, address _lowerHint) external {
 *     _adjustTrove(msg.sender, msg.sender, msg.sender, 0, _amount, true, _upperHint, _lowerHint);
 * }                                        // BorrowerOperations.sol:243-257
 * ```
 *
 * `_collWithdrawal = 0`, no `msg.value`, `_isDebtIncrease = true`. Every gate a borrow meets is
 * an `_adjustTrove` gate, and there is no gate a borrow meets that an adjustment does not.
 *
 * **Why it is written this way rather than as a second evaluator with the missing rules added.**
 * It WAS a second evaluator, and it drifted from the first on three rules at once: it omitted
 * `_requireNewICRisAboveOldICR` (`:1273`), which no non zero Recovery Mode borrow can satisfy
 * because this path sends no collateral; it applied `_requireNewTCRisAboveCCR` in Recovery Mode,
 * where the contract has exactly four call sites for it (`:665`, `:972`, `:1059`, `:1209`) and
 * none is on this path; and it reported the capacity gate (`:850-852`) ahead of the ratio gates
 * (`:840-845`), which is not the order the chain checks them in. Two implementations of one rule
 * set diverge. MK-001 was the same defect and its lesson is now in `docs/08-conventions.md` §11.
 *
 * The contract facts that made this preview necessary at all are unchanged and still hold:
 *
 *   - Capacity is first set at open, from the OPENING price:
 *     `maxBorrowingCapacity = coll * price / (110 * 1e16)`
 *     (`BorrowerOperations.sol:692-698` calling `:1323-1328`).
 *   - On the adjust path it is recomputed ONLY when collateral DECREASES, and stored as
 *     `min(current, recalculated)` (`BorrowerOperations.sol:879-897`), so a price rise or a
 *     top-up does not raise it. **A refinance RESETS it** from the current price
 *     (`:1077-1084`), unconditionally, which can raise or cut it (MK-101).
 *   - A debt increase requires `maxBorrowingCapacity >= netDebtChange + debt`
 *     (`BorrowerOperations.sol:1358-1365`, called at `:851` only when `_isDebtIncrease`).
 *   - `netDebtChange` is the draw PLUS its borrowing fee, and the fee is skipped in
 *     Recovery Mode and for fee exempt accounts (`:810-818`).
 *   - `debt` in that comparison is read AFTER `updateSystemAndTroveInterest(_borrower)`
 *     (`:769`), so it is current to the block and INCLUDES accrued interest. The SDK
 *     therefore compares against the live entire debt from `getEntireDebtAndColl`, which folds in
 *     pending redistribution as that update does (`TroveManager.sol:796-801`). `getTroveDebt` accrues to
 *     the block but omits it (`:591-595`, `:1513-1527`), which is what makes it the wrong read (MK-246).
 */

/**
 * The live borrowing capacity picture for one owner.
 *
 * Re-exported. The declaration moved to `previewAdjust.ts` with MK-060, since the gate it
 * describes is an adjust path gate; the public name and shape are unchanged.
 */
export type { BorrowingCapacity }

/**
 * Why a borrow preview came back not viable. Machine readable, stable strings.
 *
 * **Widened by MK-058, MK-059 and MK-060**, and deliberately expressed as a subset of
 * {@link AdjustBlockReason} rather than as a free standing union: `Extract` makes the compiler
 * reject any member that stops existing on the adjust side, so the two cannot drift apart
 * silently again. The members listed are exactly the ones a call with
 * `_collWithdrawal = 0`, no `msg.value` and `_isDebtIncrease = true` can reach.
 *
 * The three that were not here before 0.2.1:
 *
 *   - `ICR_NOT_IMPROVED_IN_RECOVERY_MODE` (`:1273`), which is reported for **every** non zero
 *     Recovery Mode borrow, because this path adds debt and adds no collateral.
 *   - `ZERO_DEBT_INCREASE` (`:786`), a draw of zero.
 *   - `NO_CHANGE_REQUESTED` (`:789`), which a draw of zero also satisfies. Both are reported;
 *     `bindingConstraint` is `ZERO_DEBT_INCREASE`, which is the one the chain reaches first.
 *
 * `TCR_BELOW_CCR` remains, and is now reported **only in normal mode**, which is the only mode
 * the contract checks it in on this path.
 */
export type BorrowBlockReason = Extract<
  AdjustBlockReason,
  | 'TROVE_NOT_ACTIVE'
  | 'ZERO_DEBT_INCREASE'
  | 'NO_CHANGE_REQUESTED'
  | 'ICR_BELOW_THRESHOLD'
  | 'ICR_NOT_IMPROVED_IN_RECOVERY_MODE'
  | 'TCR_BELOW_CCR'
  | 'EXCEEDS_BORROWING_CAPACITY'
>

/** Result of {@link previewBorrow}. Raw numbers included so callers render their own copy. */
export interface BorrowPreview {
  /** True only when every constraint the contract enforces is satisfied. */
  viable: boolean
  /** Every reason it is not viable, **in the order `_adjustTrove` checks them**. Empty when `viable`. */
  reasons: BorrowBlockReason[]
  /** The single constraint that binds first, or `null` when viable. */
  bindingConstraint: BorrowBlockReason | null
  /** The borrowing fee the contract would charge for this draw, zero when it is skipped. */
  fee: bigint
  /** `draw + fee`, the quantity the capacity gate compares. */
  netDebtChange: bigint
  /** Capacity, live entire debt, and the remaining headroom. */
  capacity: BorrowingCapacity
  /** The Trove's entire debt after this borrow. */
  resultingEntireDebt: bigint
  /**
   * The Trove's ICR BEFORE this borrow, at the current price.
   *
   * Added with MK-058, because `ICR_NOT_IMPROVED_IN_RECOVERY_MODE` cannot be interpreted
   * without it: the gate is `newICR >= oldICR` and this is `oldICR`.
   */
  currentIcr: bigint
  /** The Trove's ICR after this borrow, at the current price. */
  resultingIcr: bigint
  /** The threshold `resultingIcr` is measured against: MCR normally, CCR in Recovery Mode. */
  icrThreshold: bigint
  /**
   * The system TCR after this borrow. **Reported in both modes, enforced only in normal mode**
   * (MK-059): `_requireNewTCRisAboveCCR` has no call site on the Recovery Mode adjust path.
   */
  resultingTcr: bigint
  /** Whether the system is in Recovery Mode right now. */
  isRecoveryMode: boolean
  /** BTC/USD used for every number above. */
  price: bigint
}

/** Inputs to {@link previewBorrow}. */
export interface PreviewBorrowParams {
  /** The Trove owner borrowing against their position. */
  owner: Address
  /** The MUSD draw requested. The fee is added on top by the contract. */
  amount: bigint
}

/**
 * Read the live borrowing capacity picture for `owner` (MK-002).
 *
 * `remaining` is headroom for `draw + fee`, NOT for the draw alone: the gate compares
 * `netDebtChange + debt`, and `netDebtChange` already includes the fee.
 */
export async function getBorrowingCapacity(
  deps: MathDeps,
  owner: Address,
): Promise<BorrowingCapacity> {
  return withTypedErrors(() => getBorrowingCapacityUnchecked(deps, owner), {
    operation: 'getBorrowingCapacity',
  })
}

async function getBorrowingCapacityUnchecked(
  { publicClient, addresses }: MathDeps,
  owner: Address,
): Promise<BorrowingCapacity> {
  const tm = { address: addresses.troveManager, abi: troveManagerAbi } as const
  const [capacity, entire] = await Promise.all([
    publicClient.readContract({
      ...tm,
      functionName: 'getTroveMaxBorrowingCapacity',
      args: [owner],
    }),
    publicClient.readContract({ ...tm, functionName: 'getEntireDebtAndColl', args: [owner] }),
  ])
  // MK-094. Through the named accessor and the one capacity factory. `getEntireDebtAndColl`
  // adds live-accrued interest to the stored value (`TroveManager.sol:788-793`), which is
  // exactly what `_adjustTrove` compares against after its own interest update; and this
  // standalone read and the `capacity` field on an adjust preview are now one implementation,
  // so they cannot describe the same Trove differently.
  return borrowingCapacityOf(capacity, troveAmounts(entire).entireDebt)
}

/**
 * Preview borrowing `amount` against an existing Trove, returning a verdict, the binding
 * constraint, and every raw number behind it (MK-002).
 *
 * A thin wrapper over {@link previewAdjustTrove} with a debt increase and nothing else, so the
 * two previews cannot disagree about the same call (MK-058, MK-059, MK-060, MK-065). The
 * agreement is asserted rather than assumed, in `packages/core/test/preview-agreement.test.ts`.
 *
 * **The one cost of delegating, stated rather than hidden.** `previewAdjustTrove` also reads the
 * caller's MUSD balance and `minNetDebt()`, which only the repayment gates use and a borrow never
 * reaches. Both ride in the same `Promise.all`, so this adds two reads and no round trip, and the
 * alternative is a second copy of the read set to go with the second copy of the rules.
 *
 * This is the counterpart to `getBorrowingPower`, which is an OPEN time calculator and is
 * documented as such. Use this one for a Trove that already exists.
 *
 * **Not a single block snapshot**: the price is read outside the batch that uses it. The full
 * statement is on `MathDeps` in `math/deps.ts` (MK-013, MK-093).
 */
export async function previewBorrow(
  deps: MathDeps,
  params: PreviewBorrowParams,
): Promise<BorrowPreview> {
  return withTypedErrors(() => previewBorrowUnchecked(deps, params), { operation: 'previewBorrow' })
}

async function previewBorrowUnchecked(
  deps: MathDeps,
  params: PreviewBorrowParams,
): Promise<BorrowPreview> {
  return projectBorrow(
    await previewAdjustTrove(deps, { owner: params.owner, increaseDebt: params.amount }),
  )
}

/** Everything {@link evaluateBorrow} needs, already read from the chain. */
export interface EvaluateBorrowInput {
  /** `TroveManager.getTroveStatus`. 1 is active; anything else cannot be adjusted. */
  status: number
  collateral: bigint
  /** Live entire debt, principal plus accrued interest. */
  entireDebt: bigint
  /** `getTroveMaxBorrowingCapacity`. */
  capacity: bigint
  /** The fee the contract will actually charge, already zeroed for Recovery Mode or exemption. */
  fee: bigint
  amount: bigint
  isRecoveryMode: boolean
  price: bigint
  systemColl: bigint
  systemDebt: bigint
}

/**
 * The decision itself, as a pure function of values already read from the chain.
 *
 * **Delegates to {@link evaluateAdjust} rather than deciding** (MK-058, MK-059, MK-060, MK-065).
 * The input shape is unchanged, so an existing caller is unaffected; what changed is that the
 * rules behind it are now the adjust path's rules, which are the contract's.
 */
export function evaluateBorrow(input: EvaluateBorrowInput): BorrowPreview {
  return projectBorrow(
    evaluateAdjust({
      status: input.status,
      collateral: input.collateral,
      entireDebt: input.entireDebt,
      capacity: input.capacity,
      // The repayment gates (`:855-861`) are guarded by `!isDebtIncrease && repayDebt > 0n` and
      // this call satisfies neither half, so neither of these two is ever read. They are passed
      // as zero rather than made optional so the adjust input keeps one shape.
      musdBalance: 0n,
      minNetDebt: 0n,
      fee: input.fee,
      addCollateral: 0n,
      // `withdrawMUSD` passes `_collWithdrawal = 0` and no `msg.value` (`:243-257`). That is
      // exactly why no Recovery Mode borrow can clear `_requireNewICRisAboveOldICR` (`:1273`).
      withdrawCollateral: 0n,
      increaseDebt: input.amount,
      repayDebt: 0n,
      // `withdrawMUSD` passes `true` unconditionally, whatever `_amount` is, which is what makes
      // a draw of zero reachable and refused at `:786` rather than silently a no-op (MK-060).
      isDebtIncrease: true,
      isRecoveryMode: input.isRecoveryMode,
      price: input.price,
      systemColl: input.systemColl,
      systemDebt: input.systemDebt,
    }),
  )
}

/**
 * The adjust verdict, narrowed to the borrow shape.
 *
 * The narrowing is a projection and never a decision: `viable`, `reasons` and their order come
 * through untouched. The cast is safe by construction, since a call with no collateral leg and
 * no repayment leg cannot produce any of the reasons `BorrowBlockReason` leaves out, and the
 * assertion below is what keeps that true if the adjust evaluator ever changes.
 */
function projectBorrow(p: AdjustPreview): BorrowPreview {
  return {
    viable: p.viable,
    reasons: p.reasons as BorrowBlockReason[],
    bindingConstraint: p.bindingConstraint as BorrowBlockReason | null,
    fee: p.fee,
    netDebtChange: p.netDebtChange,
    capacity: p.capacity,
    resultingEntireDebt: p.resultingEntireDebt,
    currentIcr: p.currentIcr,
    resultingIcr: p.resultingIcr,
    icrThreshold: p.icrThreshold,
    resultingTcr: p.resultingTcr,
    isRecoveryMode: p.isRecoveryMode,
    price: p.price,
  }
}
