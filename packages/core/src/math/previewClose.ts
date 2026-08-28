import type { Address } from 'viem'
import { musdAbi, priceFeedAbi, troveManagerAbi } from '../clients'
import { CCR, MUSD_GAS_COMPENSATION } from '../constants'
import { computeICR } from './compute'
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
 *
 * **Two of the four gates are conditional on a runtime chain read**, `canMint`, and that is
 * the part worth stating rather than assuming. `mintList` is a governable mapping on the MUSD
 * token; if BorrowerOperations is not on it, closing is permitted in Recovery Mode and the
 * TCR check does not run at all. This preview reads it rather than assuming it is true,
 * because assuming a governable value is exactly the class of defect MK-012 and MK-018 were.
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
   * `musd.mintList(borrowerOperations)`, read live. **When false, `RECOVERY_MODE` and
   * `TCR_BELOW_CCR` are not enforced at all** (`:953`, `:964`).
   */
  canMint: boolean
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
  } = input

  const musdRequired = entireDebt > MUSD_GAS_COMPENSATION ? entireDebt - MUSD_GAS_COMPENSATION : 0n
  const musdShortfall = musdRequired > musdBalance ? musdRequired - musdBalance : 0n
  // Closing removes this Trove's collateral AND its whole debt from the system (`:965-971`).
  const resultingTcr = computeICR({
    collateral: systemColl > collateral ? systemColl - collateral : 0n,
    entireDebt: systemDebt > entireDebt ? systemDebt - entireDebt : 0n,
    price,
  })

  const reasons: CloseBlockReason[] = []
  if (status !== 1) reasons.push('TROVE_NOT_ACTIVE')
  if (canMint && isRecoveryMode) reasons.push('RECOVERY_MODE')
  if (musdShortfall > 0n) reasons.push('INSUFFICIENT_MUSD_BALANCE')
  if (canMint && resultingTcr < CCR) reasons.push('TCR_BELOW_CCR')

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
    isRecoveryMode,
    price,
  }
}

/** Read everything {@link evaluateClose} needs, then decide. */
export async function previewClose(deps: MathDeps, owner: Address): Promise<ClosePreview> {
  const { publicClient, addresses } = deps
  const price = await publicClient.readContract({
    address: addresses.priceFeed,
    abi: priceFeedAbi,
    functionName: 'fetchPrice',
  })
  const tm = { address: addresses.troveManager, abi: troveManagerAbi } as const
  const musd = { address: addresses.musd, abi: musdAbi } as const

  const [status, entire, isRecoveryMode, musdBalance, canMint, systemColl, systemDebt] =
    await Promise.all([
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
    ])

  return evaluateClose({
    status,
    collateral: entire[0],
    entireDebt: entire[1] + entire[2],
    musdBalance,
    canMint,
    isRecoveryMode,
    price,
    systemColl,
    systemDebt,
  })
}
