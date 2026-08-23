import type { Address } from 'viem'
import { borrowerOperationsAbi, priceFeedAbi, troveManagerAbi } from '../clients'
import { CCR, MCR } from '../constants'
import { computeICR } from './compute'
import type { MathDeps } from './deps'

/**
 * MK-002. Borrowing against an EXISTING Trove, which `getBorrowingPower` never modeled.
 *
 * The contract's rules, read from `mezo-org/musd`:
 *
 *   - Capacity is set ONCE, at open, from the OPENING price:
 *     `maxBorrowingCapacity = coll * price / (110 * 1e16)`
 *     (`BorrowerOperations.sol:692-698` calling `:1323-1328`).
 *   - It is recomputed ONLY when collateral DECREASES, and stored as
 *     `min(current, recalculated)` (`BorrowerOperations.sol:879-897`). So it ratchets
 *     downward and **never rises**, not when the price rises and not when collateral is
 *     added.
 *   - A debt increase requires `maxBorrowingCapacity >= netDebtChange + debt`
 *     (`BorrowerOperations.sol:1358-1365`, called at `:851` only when `_isDebtIncrease`).
 *   - `netDebtChange` is the draw PLUS its borrowing fee, and the fee is skipped in
 *     Recovery Mode and for fee exempt accounts (`:810-818`).
 *   - `debt` in that comparison is read AFTER `updateSystemAndTroveInterest(_borrower)`
 *     (`:769`), so it is current to the block and INCLUDES accrued interest. The SDK
 *     therefore compares against the live entire debt from `getEntireDebtAndColl`, not the
 *     stored `getTroveDebt`, which is stale until someone triggers an update.
 *   - A debt increase is additionally gated on the resulting ratios by
 *     `_requireValidAdjustmentInCurrentMode` (`:840-845`).
 */

/** The live borrowing capacity picture for one owner. */
export interface BorrowingCapacity {
  /** `maxBorrowingCapacity` as stored on chain. Fixed at open, ratchets only downward. */
  capacity: bigint
  /** The Trove's live entire debt, principal plus accrued interest, as the gate sees it. */
  entireDebt: bigint
  /** `capacity - entireDebt`, floored at zero. The headroom for `draw + fee`, not for the draw. */
  remaining: bigint
}

/** Why a borrow preview came back not viable. Machine readable, stable strings. */
export type BorrowBlockReason =
  | 'TROVE_NOT_ACTIVE'
  | 'EXCEEDS_BORROWING_CAPACITY'
  | 'ICR_BELOW_THRESHOLD'
  | 'TCR_BELOW_CCR'

/** Result of {@link previewBorrow}. Raw numbers included so callers render their own copy. */
export interface BorrowPreview {
  /** True only when every constraint the contract enforces is satisfied. */
  viable: boolean
  /** Every reason it is not viable, in a fixed order. Empty when `viable`. */
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
  /** The Trove's ICR after this borrow, at the current price. */
  resultingIcr: bigint
  /** The threshold `resultingIcr` is measured against: MCR normally, CCR in Recovery Mode. */
  icrThreshold: bigint
  /** The system TCR after this borrow. */
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
  // getEntireDebtAndColl returns (coll, principal, interest, pendingColl, pendingPrincipal,
  // pendingInterest) and adds live-accrued interest to the stored value, which is exactly
  // what `_adjustTrove` compares against after its own interest update.
  const entireDebt = entire[1] + entire[2]
  return { capacity, entireDebt, remaining: capacity > entireDebt ? capacity - entireDebt : 0n }
}

/**
 * Preview borrowing `amount` against an existing Trove, returning a verdict, the binding
 * constraint, and every raw number behind it (MK-002).
 *
 * Covers the three things the contract actually checks on a debt increase: the borrowing
 * capacity gate, the resulting individual ratio against the mode correct threshold, and
 * the resulting system ratio where the contract enforces it.
 *
 * This is the counterpart to `getBorrowingPower`, which is an OPEN time calculator and is
 * documented as such. Use this one for a Trove that already exists.
 */
export async function previewBorrow(
  deps: MathDeps,
  params: PreviewBorrowParams,
): Promise<BorrowPreview> {
  const { publicClient, addresses } = deps
  const { owner, amount } = params

  const price = await publicClient.readContract({
    address: addresses.priceFeed,
    abi: priceFeedAbi,
    functionName: 'fetchPrice',
  })
  const tm = { address: addresses.troveManager, abi: troveManagerAbi } as const

  const [status, entire, capacityRaw, isRecoveryMode] = await Promise.all([
    publicClient.readContract({ ...tm, functionName: 'getTroveStatus', args: [owner] }),
    publicClient.readContract({ ...tm, functionName: 'getEntireDebtAndColl', args: [owner] }),
    publicClient.readContract({
      ...tm,
      functionName: 'getTroveMaxBorrowingCapacity',
      args: [owner],
    }),
    publicClient.readContract({ ...tm, functionName: 'checkRecoveryMode', args: [price] }),
  ])

  const collateral = entire[0]
  const entireDebt = entire[1] + entire[2]

  // The fee is skipped in Recovery Mode and for fee exempt accounts, exactly as on open
  // (`BorrowerOperations.sol:810-818`). Reading exemption rather than assuming nobody is
  // exempt is MK-018's rule applied here too: the exempt cohort is non empty on mainnet.
  const exempt = await deps.isAccountFeeExempt(owner)
  const fee =
    isRecoveryMode || exempt
      ? 0n
      : await publicClient.readContract({
          address: addresses.borrowerOperations,
          abi: borrowerOperationsAbi,
          functionName: 'getBorrowingFee',
          args: [amount],
        })

  const [systemColl, systemDebt] = await Promise.all([
    publicClient.readContract({ ...tm, functionName: 'getEntireSystemColl' }),
    publicClient.readContract({ ...tm, functionName: 'getEntireSystemDebt' }),
  ])

  return evaluateBorrow({
    status,
    collateral,
    entireDebt,
    capacity: capacityRaw,
    fee,
    amount,
    isRecoveryMode,
    price,
    systemColl,
    systemDebt,
  })
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
 * Split out from {@link previewBorrow} deliberately: the verdict is the part worth testing
 * exhaustively, and as a pure function it can be, in the chain-free unit project, across
 * every combination of reasons rather than only the combinations a fork happens to produce.
 */
export function evaluateBorrow(input: EvaluateBorrowInput): BorrowPreview {
  const {
    status,
    collateral,
    entireDebt,
    capacity: capacityRaw,
    fee,
    amount,
    isRecoveryMode,
    price,
    systemColl,
    systemDebt,
  } = input

  const netDebtChange = amount + fee
  const capacity: BorrowingCapacity = {
    capacity: capacityRaw,
    entireDebt,
    remaining: capacityRaw > entireDebt ? capacityRaw - entireDebt : 0n,
  }
  const resultingEntireDebt = entireDebt + netDebtChange
  const resultingIcr = computeICR({ collateral, entireDebt: resultingEntireDebt, price })
  const icrThreshold = isRecoveryMode ? CCR : MCR
  const resultingTcr = computeICR({
    collateral: systemColl,
    entireDebt: systemDebt + netDebtChange,
    price,
  })

  const reasons: BorrowBlockReason[] = []
  if (status !== 1) reasons.push('TROVE_NOT_ACTIVE')
  if (capacityRaw < resultingEntireDebt) reasons.push('EXCEEDS_BORROWING_CAPACITY')
  if (resultingIcr < icrThreshold) reasons.push('ICR_BELOW_THRESHOLD')
  if (resultingTcr < CCR) reasons.push('TCR_BELOW_CCR')

  return {
    viable: reasons.length === 0,
    reasons,
    bindingConstraint: reasons[0] ?? null,
    fee,
    netDebtChange,
    capacity,
    resultingEntireDebt,
    resultingIcr,
    icrThreshold,
    resultingTcr,
    isRecoveryMode,
    price,
  }
}
