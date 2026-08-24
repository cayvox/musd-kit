import type { Address } from 'viem'
import { borrowerOperationsAbi, priceFeedAbi, troveManagerAbi } from '../clients'
import { CCR, MCR, MUSD_GAS_COMPENSATION } from '../constants'
import { computeICR } from './compute'
import type { MathDeps } from './deps'

/**
 * MK-003 and MK-019. Refinancing moves a Trove to the current global interest rate, and the
 * contract charges for it. The SDK modeled neither the charge nor the restriction.
 *
 * Rules read from `_refinance` (`BorrowerOperations.sol:1012-1075`), in the order the
 * contract applies them:
 *
 *   1. `updateSystemAndTroveInterest(_borrower)` first (`:1021`), so every debt figure below
 *      is current to the block and includes accrued interest.
 *   2. `_requireNotInRecoveryMode(price)` (`:1024`), which reverts with
 *      `BorrowerOps: Operation not permitted during Recovery Mode` (`:1133-1138`). This is
 *      the very first requirement: a refinance in Recovery Mode ALWAYS reverts (MK-019).
 *   3. The fee base is the NET debt, `getTroveDebt - 200e18` (`:1030-1032`), scaled by the
 *      governable `refinancingFeePercentage` over 100 (`:1033`).
 *   4. The fee itself is `getBorrowingFee(base)`, and is ZERO for a fee exempt account
 *      (`:1034-1036`).
 *   5. It is added to PRINCIPAL via `increaseTroveDebt` (`:1038`, and
 *      `TroveManager.sol:529-530`), so it begins accruing interest immediately and it moves
 *      the Trove's sort key.
 *   6. The result must satisfy `ICR >= MCR` and a system `TCR >= CCR` (`:1054-1059`).
 *
 * `refinancingFeePercentage` is read from the chain on every preview rather than hardcoded.
 * It is governable, and a hardcoded value is a stale fact waiting to happen.
 */

/** Why a refinance would be refused. Machine readable, stable strings, in a fixed order. */
export type RefinanceBlockReason =
  | 'TROVE_NOT_ACTIVE'
  | 'RECOVERY_MODE'
  | 'ICR_BELOW_MCR'
  | 'TCR_BELOW_CCR'

/** Result of {@link previewRefinance}: a verdict plus every raw number behind it. */
export interface RefinancePreview {
  /** True only when the contract would let the refinance through. */
  viable: boolean
  /** Every reason it would be refused, in a fixed order. Empty when `viable`. */
  reasons: RefinanceBlockReason[]
  /** The reason that binds first, or `null` when viable. */
  bindingConstraint: RefinanceBlockReason | null
  /** The governable `refinancingFeePercentage`, read live, as a whole percent. */
  refinancingFeePercentage: number
  /** The quantity the percentage is applied to: the current NET debt, entire debt minus 200. */
  feeBase: bigint
  /** The refinancing fee in MUSD. Zero for a fee exempt account. */
  fee: bigint
  /** Whether the account is fee exempt. */
  feeExempt: boolean
  /** Principal before the refinance. */
  principal: bigint
  /** Principal after: the fee is capitalized, so it grows by exactly the fee. */
  resultingPrincipal: bigint
  /** Entire debt after the refinance. */
  resultingEntireDebt: bigint
  /** The Trove's ICR after the refinance, at the current price. */
  resultingIcr: bigint
  /** The system TCR the contract checks, which already includes the capitalized fee. */
  resultingTcr: bigint
  /** Whether the system is in Recovery Mode right now. */
  isRecoveryMode: boolean
  /** BTC/USD used for every number above. */
  price: bigint
}

/** Everything {@link evaluateRefinance} needs, already read from the chain. */
export interface EvaluateRefinanceInput {
  /** `TroveManager.getTroveStatus`. 1 is active. */
  status: number
  collateral: bigint
  principal: bigint
  interestOwed: bigint
  /** The governable percentage, read live. */
  refinancingFeePercentage: number
  /** `getBorrowingFee(feeBase)`, already computed by the caller, before exemption. */
  borrowingFeeOnBase: bigint
  feeExempt: boolean
  isRecoveryMode: boolean
  price: bigint
  systemColl: bigint
  systemDebt: bigint
}

/**
 * The refinance verdict, as a pure function of values already read from the chain. Split out
 * so it can be covered exhaustively in the chain-free unit project.
 */
export function evaluateRefinance(input: EvaluateRefinanceInput): RefinancePreview {
  const {
    status,
    collateral,
    principal,
    interestOwed,
    refinancingFeePercentage,
    borrowingFeeOnBase,
    feeExempt,
    isRecoveryMode,
    price,
    systemColl,
    systemDebt,
  } = input

  const entireDebt = principal + interestOwed
  // `_getNetDebt(getTroveDebt)` is entire debt minus the gas reserve (`LiquityBase.sol:107-109`).
  const feeBase = entireDebt > MUSD_GAS_COMPENSATION ? entireDebt - MUSD_GAS_COMPENSATION : 0n
  const fee = feeExempt ? 0n : borrowingFeeOnBase

  const resultingPrincipal = principal + fee
  const resultingEntireDebt = entireDebt + fee
  const resultingIcr = computeICR({ collateral, entireDebt: resultingEntireDebt, price })
  const resultingTcr = computeICR({
    collateral: systemColl,
    entireDebt: systemDebt + fee,
    price,
  })

  const reasons: RefinanceBlockReason[] = []
  if (status !== 1) reasons.push('TROVE_NOT_ACTIVE')
  // The mode check is the contract's FIRST requirement, so it is reported even when other
  // constraints would also fail: it is what the caller actually hits.
  if (isRecoveryMode) reasons.push('RECOVERY_MODE')
  if (resultingIcr < MCR) reasons.push('ICR_BELOW_MCR')
  if (resultingTcr < CCR) reasons.push('TCR_BELOW_CCR')

  return {
    viable: reasons.length === 0,
    reasons,
    bindingConstraint: reasons[0] ?? null,
    refinancingFeePercentage,
    feeBase,
    fee,
    feeExempt,
    principal,
    resultingPrincipal,
    resultingEntireDebt,
    resultingIcr,
    resultingTcr,
    isRecoveryMode,
    price,
  }
}

/**
 * Preview refinancing an existing Trove (MK-003, MK-019): the fee, the resulting principal,
 * the resulting individual ratio, and a verdict that is false whenever the contract would
 * refuse the operation, Recovery Mode included.
 */
export async function previewRefinance(deps: MathDeps, owner: Address): Promise<RefinancePreview> {
  const { publicClient, addresses } = deps
  const price = await publicClient.readContract({
    address: addresses.priceFeed,
    abi: priceFeedAbi,
    functionName: 'fetchPrice',
  })
  const tm = { address: addresses.troveManager, abi: troveManagerAbi } as const

  const [status, entire, isRecoveryMode, systemColl, systemDebt, percentage] = await Promise.all([
    publicClient.readContract({ ...tm, functionName: 'getTroveStatus', args: [owner] }),
    publicClient.readContract({ ...tm, functionName: 'getEntireDebtAndColl', args: [owner] }),
    publicClient.readContract({ ...tm, functionName: 'checkRecoveryMode', args: [price] }),
    publicClient.readContract({ ...tm, functionName: 'getEntireSystemColl' }),
    publicClient.readContract({ ...tm, functionName: 'getEntireSystemDebt' }),
    // Governable, so read it. Never hardcode it, even though its value is currently known.
    publicClient.readContract({
      address: addresses.borrowerOperations,
      abi: borrowerOperationsAbi,
      functionName: 'refinancingFeePercentage',
    }),
  ])

  const principal = entire[1]
  const interestOwed = entire[2]
  const entireDebt = principal + interestOwed
  const feeBase = entireDebt > MUSD_GAS_COMPENSATION ? entireDebt - MUSD_GAS_COMPENSATION : 0n
  const scaledBase = (BigInt(percentage) * feeBase) / 100n

  const [feeExempt, borrowingFeeOnBase] = await Promise.all([
    deps.isAccountFeeExempt(owner),
    publicClient.readContract({
      address: addresses.borrowerOperations,
      abi: borrowerOperationsAbi,
      functionName: 'getBorrowingFee',
      args: [scaledBase],
    }),
  ])

  return evaluateRefinance({
    status,
    collateral: entire[0],
    principal,
    interestOwed,
    refinancingFeePercentage: Number(percentage),
    borrowingFeeOnBase,
    feeExempt,
    isRecoveryMode,
    price,
    systemColl,
    systemDebt,
  })
}
