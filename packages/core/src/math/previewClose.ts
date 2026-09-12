import type { Address } from 'viem'
import { musdAbi, priceFeedAbi, sortedTrovesAbi, troveManagerAbi } from '../clients'
import { CCR } from '../constants'
import { TroveStatus } from '../read/types'
import { computeICR, netDebtOf, troveAmounts } from './compute'
import type { MathDeps } from './deps'

/**
 * Closing a Trove, previewed (MK-042). Its gates are NOT the adjust gates, which is why this
 * is a separate evaluator rather than a case of {@link previewAdjustTrove}.
 *
 * Read from `mezo-org/musd`, `BorrowerOperations.sol`, `_closeTrove` at `:939-973`:
 *
 *   :949      `bool canMint = musdTokenCached.mintList(address(this));`
 *   :951      `_requireTroveisActive(...)`                            -> :1179
 *   :953-955  `if (canMint) _requireNotInRecoveryMode(price);`        -> :1133
 *   :963      `_requireSufficientMUSDBalance(_caller, debt - MUSD_GAS_COMPENSATION);` -> :1229
 *   :964-973  `if (canMint) { ... _requireNewTCRisAboveCCR(newTCR); }` -> :1344
 *   :976      `troveManagerCached.closeTrove(_borrower)`, which is `TroveManager.sol:472-475`
 *             and reaches `TroveManager._closeTrove:1390-1399`, where the SAME `canMint` flag
 *             gates `_requireMoreThanOneTroveInSystem` (`TroveManager.sol:1488-1496`)
 *
 * **There are FIVE gates, not four** (MK-074). The fifth lives one contract away, which is why
 * it was missed: it is not in `BorrowerOperations._closeTrove` at all, it is inside the
 * `closeTrove` call on the last line of it.
 *
 * **Three of the five gates are conditional on a runtime chain read**, `canMint`, and that is
 * the part worth stating rather than assuming. `mintList` is a governable mapping on the MUSD
 * token; if BorrowerOperations is not on it, closing is permitted in Recovery Mode, the TCR
 * check does not run at all, and neither does the last Trove check. This preview reads it
 * rather than assuming it is true, because assuming a governable value is exactly the class of
 * defect MK-012 and MK-018 were.
 *
 * **The balance requirement is the whole debt minus the gas compensation** (`:963`), not the
 * net debt and not the principal. A caller who repaid down to the floor still needs that
 * amount in hand to close, and it is the reason closing fails most often.
 */

/** Why a close preview came back not viable. Machine readable, stable strings. */
export type CloseBlockReason =
  /** `_requireTroveisActive` (`:951`). */
  | 'TROVE_NOT_ACTIVE'
  /** `_requireNotInRecoveryMode` (`:954`). Only enforced when `canMint`. */
  | 'RECOVERY_MODE'
  /** `_requireSufficientMUSDBalance` (`:963`). Needs `entireDebt - 200 MUSD` in hand. */
  | 'INSUFFICIENT_MUSD_BALANCE'
  /** `_requireNewTCRisAboveCCR` (`:972`). Only enforced when `canMint`. */
  | 'TCR_BELOW_CCR'
  /**
   * `_requireMoreThanOneTroveInSystem` (`TroveManager.sol:1398`, `:1488-1496`), reached through
   * `closeTrove` at `BorrowerOperations.sol:976` (MK-074).
   *
   * The LAST gate, and conditional on the same `canMint` as the two above. It requires
   * `TroveOwners.length > 1 && sortedTroves.getSize() > 1`, so the final Trove in a system
   * cannot be closed and the chain refuses with "TroveManager: Only one trove in the system".
   */
  | 'LAST_TROVE_IN_SYSTEM'

/** Result of {@link previewClose}. */
export interface ClosePreview {
  viable: boolean
  reasons: CloseBlockReason[]
  bindingConstraint: CloseBlockReason | null
  /**
   * MUSD the caller must hold: `entireDebt - MUSD_GAS_COMPENSATION` (`:963`).
   *
   * **A snapshot the chain outgrows (MK-050).** `_closeTrove` accrues interest on the Trove at
   * `:945` and only then reads the debt at `:958`, so by the block a close executes in the required
   * figure is LARGER than this one. Holding exactly this amount is refused. Acquire a margin above
   * it, or recompute at the point of use. See `FINDINGS.md`, MK-050.
   */
  musdRequired: bigint
  /** What the caller actually holds. */
  musdBalance: bigint
  /**
   * `musdRequired - musdBalance`, floored at zero. What still has to be acquired.
   *
   * Acquiring EXACTLY this is not enough, for the reason on {@link musdRequired} (MK-050).
   */
  musdShortfall: bigint
  /** The Trove's live entire debt. */
  entireDebt: bigint
  /** The Trove's live collateral, returned in full when the close succeeds. */
  collateral: bigint
  /** The system TCR after this Trove is removed. */
  resultingTcr: bigint
  /**
   * `musd.mintList(borrowerOperations)`, read live. **When false, `RECOVERY_MODE`,
   * `TCR_BELOW_CCR` and `LAST_TROVE_IN_SYSTEM` are not enforced at all** (`:953`, `:964`, and
   * `TroveManager.sol:1397`).
   */
  canMint: boolean
  /**
   * The two counts behind `LAST_TROVE_IN_SYSTEM`, or `undefined` when they were not read
   * (MK-091). Surfaced so the typed error the write path throws carries real numbers rather
   * than the placeholder zeros MK-017 exists to refuse.
   */
  troveOwnersCount: bigint | undefined
  sortedTrovesSize: bigint | undefined
  isRecoveryMode: boolean
  price: bigint
}

/** Everything {@link evaluateClose} needs, already read from the chain. */
export interface EvaluateCloseInput {
  status: number
  collateral: bigint
  entireDebt: bigint
  musdBalance: bigint
  canMint: boolean
  isRecoveryMode: boolean
  price: bigint
  systemColl: bigint
  systemDebt: bigint
  /**
   * `TroveManager.getTroveOwnersCount()` and `SortedTroves.getSize()`, for the last Trove gate
   * (MK-074). Both optional on the same rule `previewOpen.troveStatus` follows (MK-047):
   * `undefined` is "not asked", not "there is one", so the gate is simply not evaluated and
   * not reported. `previewClose` always supplies them.
   */
  troveOwnersCount?: bigint | undefined
  sortedTrovesSize?: bigint | undefined
}

/** The verdict, as a pure function of values already read from the chain. */
export function evaluateClose(input: EvaluateCloseInput): ClosePreview {
  const {
    status,
    collateral,
    entireDebt,
    musdBalance,
    canMint,
    isRecoveryMode,
    price,
    systemColl,
    systemDebt,
    troveOwnersCount,
    sortedTrovesSize,
  } = input

  // MK-094. `_getNetDebt` (`LiquityBase.sol:107-109`), through the one copy.
  const musdRequired = netDebtOf(entireDebt)
  const musdShortfall = musdRequired > musdBalance ? musdRequired - musdBalance : 0n
  // Closing removes this Trove's collateral AND its whole debt from the system (`:965-971`).
  const resultingTcr = computeICR({
    collateral: systemColl > collateral ? systemColl - collateral : 0n,
    entireDebt: systemDebt > entireDebt ? systemDebt - entireDebt : 0n,
    price,
  })

  const reasons: CloseBlockReason[] = []
  // MK-094. The enum, not the literal. `TroveStatus.active` is `1`
  // (`TroveManager` `Status`), and three evaluators spelled it as a bare number while two
  // others used the enum for the same comparison.
  if (status !== TroveStatus.active) reasons.push('TROVE_NOT_ACTIVE')
  if (canMint && isRecoveryMode) reasons.push('RECOVERY_MODE')
  if (musdShortfall > 0n) reasons.push('INSUFFICIENT_MUSD_BALANCE')
  if (canMint && resultingTcr < CCR) reasons.push('TCR_BELOW_CCR')
  // MK-074. LAST, because the contract reaches it last: `BorrowerOperations.sol:976` calls
  // `closeTrove` only after the balance and TCR checks have passed. Evaluated only when both
  // counts were supplied, and only when `canMint`, which is the flag the contract gates it on.
  if (
    canMint &&
    troveOwnersCount !== undefined &&
    sortedTrovesSize !== undefined &&
    (troveOwnersCount <= 1n || sortedTrovesSize <= 1n)
  ) {
    reasons.push('LAST_TROVE_IN_SYSTEM')
  }

  return {
    viable: reasons.length === 0,
    reasons,
    bindingConstraint: reasons[0] ?? null,
    musdRequired,
    musdBalance,
    musdShortfall,
    entireDebt,
    collateral,
    resultingTcr,
    canMint,
    troveOwnersCount,
    sortedTrovesSize,
    isRecoveryMode,
    price,
  }
}

/** Read everything {@link evaluateClose} needs, then decide.
 * **Not a single block snapshot**: the price is read outside the batch that uses it. See
 * {@link MathDeps} (MK-013, MK-093).
 */
export async function previewClose(deps: MathDeps, owner: Address): Promise<ClosePreview> {
  const { publicClient, addresses } = deps
  const price = await publicClient.readContract({
    address: addresses.priceFeed,
    abi: priceFeedAbi,
    functionName: 'fetchPrice',
  })
  const tm = { address: addresses.troveManager, abi: troveManagerAbi } as const
  const musd = { address: addresses.musd, abi: musdAbi } as const

  const [
    status,
    entire,
    isRecoveryMode,
    musdBalance,
    canMint,
    systemColl,
    systemDebt,
    troveOwnersCount,
    sortedTrovesSize,
  ] = await Promise.all([
    publicClient.readContract({ ...tm, functionName: 'getTroveStatus', args: [owner] }),
    publicClient.readContract({ ...tm, functionName: 'getEntireDebtAndColl', args: [owner] }),
    publicClient.readContract({ ...tm, functionName: 'checkRecoveryMode', args: [price] }),
    publicClient.readContract({ ...musd, functionName: 'balanceOf', args: [owner] }),
    publicClient.readContract({
      ...musd,
      functionName: 'mintList',
      args: [addresses.borrowerOperations],
    }),
    publicClient.readContract({ ...tm, functionName: 'getEntireSystemColl' }),
    publicClient.readContract({ ...tm, functionName: 'getEntireSystemDebt' }),
    // MK-074. Both halves of `_requireMoreThanOneTroveInSystem`, read rather than inferred from
    // each other: the contract requires BOTH to exceed one and they are different structures.
    publicClient.readContract({ ...tm, functionName: 'getTroveOwnersCount' }),
    publicClient.readContract({
      address: addresses.sortedTroves,
      abi: sortedTrovesAbi,
      functionName: 'getSize',
    }),
  ])

  return evaluateClose({
    status,
    collateral: entire[0],
    entireDebt: troveAmounts(entire).entireDebt,
    musdBalance,
    canMint,
    isRecoveryMode,
    price,
    systemColl,
    systemDebt,
    troveOwnersCount,
    sortedTrovesSize,
  })
}
