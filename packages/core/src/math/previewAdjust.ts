import type { Address } from 'viem'
import { borrowerOperationsAbi, musdAbi, priceFeedAbi, troveManagerAbi } from '../clients'
import { CCR, MCR, MUSD_GAS_COMPENSATION } from '../constants'
import { computeICR } from './compute'
import type { MathDeps } from './deps'
import { isBorrowingFeeCharged } from './fee'

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

  const isDebtIncrease = increaseDebt > 0n
  // `netDebtChange` is the draw PLUS its fee on the increase path (`:810-817`), and the bare
  // repayment on the decrease path.
  const netDebtChange = isDebtIncrease ? increaseDebt + fee : repayDebt
  const resultingCollateral = collateral + addCollateral - withdrawCollateral
  const resultingEntireDebt = isDebtIncrease ? entireDebt + netDebtChange : entireDebt - repayDebt

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

  const reasons: AdjustBlockReason[] = []
  // Reported in the order `_adjustTrove` checks them, so `bindingConstraint` is the one the
  // chain would actually report first.
  if (isDebtIncrease && increaseDebt === 0n) reasons.push('ZERO_DEBT_INCREASE')
  if (addCollateral > 0n && withdrawCollateral > 0n) reasons.push('COLLATERAL_ADD_AND_WITHDRAW')
  if (
    addCollateral === 0n &&
    withdrawCollateral === 0n &&
    increaseDebt === 0n &&
    repayDebt === 0n
  ) {
    reasons.push('NO_CHANGE_REQUESTED')
  }
  if (status !== 1) reasons.push('TROVE_NOT_ACTIVE')
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
    // `_getNetDebt(debt)` is the entire debt minus the gas compensation (`:856`).
    const netDebtAfter =
      entireDebt > MUSD_GAS_COMPENSATION ? entireDebt - MUSD_GAS_COMPENSATION - repayDebt : 0n
    if (netDebtAfter < minNetDebt) reasons.push('BELOW_MINIMUM_DEBT')
    if (
      repayDebt > (entireDebt > MUSD_GAS_COMPENSATION ? entireDebt - MUSD_GAS_COMPENSATION : 0n)
    ) {
      reasons.push('REPAY_EXCEEDS_DEBT')
    }
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

/** Read everything {@link evaluateAdjust} needs, then decide. */
export async function previewAdjustTrove(
  deps: MathDeps,
  params: PreviewAdjustParams,
): Promise<AdjustPreview> {
  const { publicClient, addresses } = deps
  const owner = params.owner
  const addCollateral = params.addCollateral ?? 0n
  const withdrawCollateral = params.withdrawCollateral ?? 0n
  const increaseDebt = params.increaseDebt ?? 0n
  const repayDebt = params.repayDebt ?? 0n

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
  const exempt = increaseDebt > 0n ? await deps.isAccountFeeExempt(owner) : false
  const fee =
    increaseDebt > 0n && isBorrowingFeeCharged(isRecoveryMode, exempt)
      ? await publicClient.readContract({
          address: addresses.borrowerOperations,
          abi: borrowerOperationsAbi,
          functionName: 'getBorrowingFee',
          args: [increaseDebt],
        })
      : 0n

  return evaluateAdjust({
    status,
    collateral: entire[0],
    entireDebt: entire[1] + entire[2],
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
  })
}

/** Preview withdrawing collateral. The adjust path with only a withdrawal (`:225-240`). */
export function previewWithdrawCollateral(
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
   */
  amount: bigint
  /** Which gate caps it, or `null` when nothing does and the whole balance can come out. */
  limitedBy: 'RECOVERY_MODE' | 'ICR' | 'TCR' | null
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
 */
export async function maxWithdrawableCollateral(
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
  const [entire, isRecoveryMode, systemColl, systemDebt] = await Promise.all([
    publicClient.readContract({ ...tm, functionName: 'getEntireDebtAndColl', args: [owner] }),
    publicClient.readContract({ ...tm, functionName: 'checkRecoveryMode', args: [price] }),
    publicClient.readContract({ ...tm, functionName: 'getEntireSystemColl' }),
    publicClient.readContract({ ...tm, functionName: 'getEntireSystemDebt' }),
  ])
  return computeMaxWithdrawable({
    collateral: entire[0],
    entireDebt: entire[1] + entire[2],
    isRecoveryMode,
    price,
    systemColl,
    systemDebt,
  })
}

/** The closed form behind {@link maxWithdrawableCollateral}, as a pure function. */
export function computeMaxWithdrawable(input: {
  collateral: bigint
  entireDebt: bigint
  isRecoveryMode: boolean
  price: bigint
  systemColl: bigint
  systemDebt: bigint
}): MaxWithdrawable {
  const { collateral, entireDebt, isRecoveryMode, price, systemColl, systemDebt } = input
  const icrThreshold = isRecoveryMode ? CCR : MCR

  if (isRecoveryMode) {
    return {
      amount: 0n,
      limitedBy: 'RECOVERY_MODE',
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
  const limitedBy = amount === 0n || byIcr <= bySystem ? 'ICR' : 'TCR'

  return {
    amount,
    // Nothing caps it only when the position carries no debt at all, so the whole balance
    // clears both gates.
    limitedBy: entireDebt === 0n && systemDebt === 0n ? null : limitedBy,
    collateral,
    resultingIcr: computeICR({ collateral: collateral - amount, entireDebt, price }),
    icrThreshold,
    isRecoveryMode,
    price,
  }
}
