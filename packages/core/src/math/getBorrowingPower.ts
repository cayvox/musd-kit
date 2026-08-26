import type { Abi } from 'viem'
import { borrowerOperationsAbi, priceFeedAbi, troveManagerAbi } from '../clients'
import { CCR, MCR, MULTICALL3_ADDRESS, MUSD_GAS_COMPENSATION } from '../constants'
import { InvalidAmount } from '../errors'
import { computeICR } from './compute'
import type { MathDeps } from './deps'

/** Inputs to {@link MusdClient.getBorrowingPower}: the collateral to size a draw against. */
export interface GetBorrowingPowerParams {
  collateral: bigint
  /** Override the price; defaults to `fetchPrice()`. */
  price?: bigint
}

/**
 * Hard ceiling on binary search steps, for the fallback path only (MK-010).
 *
 * The search used to be unbounded in the sense that nothing named a limit: it ran until
 * `lo` met `hi` over a caller supplied, unvalidated collateral amount, issuing one
 * `getBorrowingFee` call per step. That is about 77 sequential calls for one BTC and grows
 * with the log of the input, so a UI bound to a text input could point it at an absurd
 * number and inflict hundreds of round trips on its own RPC endpoint.
 *
 * 256 is the number of halvings a 256 bit range can survive, so a search that has not
 * converged by then cannot converge at all and is a bug rather than a slow case. It is a
 * backstop, not a budget: the normal path does not binary search.
 */
export const MAX_BORROWING_POWER_ITERATIONS = 256

/**
 * The largest draw that OPENS a valid Trove. This is an **open time calculator and nothing
 * else**: it sizes a draw for a position that does not exist yet.
 *
 * It is NOT the right function for a Trove that already exists. Every Trove carries a
 * `maxBorrowingCapacity`, fixed at the OPENING price as `coll * price / (110 * 1e16)`
 * (`BorrowerOperations.sol:1323-1328`), ratcheted only downward on a collateral decrease
 * (`:879-897`), and **never raised**, not by a price rise and not by adding collateral. A
 * debt increase is gated on `maxBorrowingCapacity >= netDebtChange + debt`
 * (`:1358-1365`), which this function does not and should not model. For an existing
 * Trove use `previewBorrow`, which returns a verdict plus the binding constraint (MK-002).
 *
 * What it enforces, matching `_openTrove` (`BorrowerOperations.sol:645-665`):
 *
 *   - the mode correct individual ratio: `ICR >= MCR` normally, `ICR >= CCR` in Recovery
 *     Mode;
 *   - in NORMAL mode only, the resulting system ratio `TCR >= CCR`. The contract checks
 *     this on every normal mode open (`_requireNewTCRisAboveCCR`, `:663-665`) and it can
 *     bind before the individual ratio does on a large draw. In Recovery Mode the contract
 *     checks `ICR >= CCR` instead and imposes no resulting TCR condition, so neither does
 *     this;
 *   - the debt floor, `netDebt >= minNetDebt`, where `netDebt` is the draw plus the fee
 *     the contract will actually charge.
 *
 * Returns `0n` when even the largest feasible draw is below the debt floor, meaning no
 * valid open exists for this collateral.
 *
 * **Cost (MK-010).** Every chain read happens in ONE `multicall`, then the answer is solved
 * in closed form from the linear fee, and the chain is asked for the real
 * `getBorrowingFee` only to CONFIRM the solution. That is two round trips in total instead
 * of roughly 77 sequential ones. The binary search is still here, bounded, as the fallback
 * for when the fee stops being linear. The premise, that `getBorrowingFee(d)` equals
 * `borrowingRate() * d / DECIMAL_PRECISION()`, was established by triggering it against the
 * deployment rather than assumed, and is confirmed on every call before the closed form's
 * answer is trusted, because `borrowingRate` is governable.
 *
 * @throws {InvalidAmount} for a non-positive collateral.
 */
export async function getBorrowingPower(
  deps: MathDeps,
  params: GetBorrowingPowerParams,
): Promise<bigint> {
  const { publicClient, addresses } = deps
  const { collateral } = params

  // Validate the input rather than searching over it. A UI bound to a text input is the
  // caller this protects: a negative or zero collateral is a bug, not a small answer.
  if (collateral <= 0n) throw new InvalidAmount('collateral', collateral)

  const tm = { address: addresses.troveManager, abi: troveManagerAbi as Abi } as const
  const bo = { address: addresses.borrowerOperations, abi: borrowerOperationsAbi as Abi } as const

  // One batch for everything the calculation needs, including the fee RATE, which is what
  // makes the closed form possible at all. `fetchPrice` is included only when the caller did
  // not supply a price; `checkRecoveryMode` takes the price as an argument, so with a
  // supplied price it joins this batch and otherwise needs the caller's price anyway.
  const [borrowingRate, decimalPrecision, systemColl, systemDebt] = (await publicClient.multicall({
    allowFailure: false,
    multicallAddress: MULTICALL3_ADDRESS,
    contracts: [
      { ...bo, functionName: 'borrowingRate' },
      { ...bo, functionName: 'DECIMAL_PRECISION' },
      { ...tm, functionName: 'getEntireSystemColl' },
      { ...tm, functionName: 'getEntireSystemDebt' },
    ],
  })) as [bigint, bigint, bigint, bigint]

  const price =
    params.price ??
    (await publicClient.readContract({
      address: addresses.priceFeed,
      abi: priceFeedAbi,
      functionName: 'fetchPrice',
    }))

  const [isRecoveryMode, minNetDebt] = await Promise.all([
    publicClient.readContract({
      address: addresses.troveManager,
      abi: troveManagerAbi,
      functionName: 'checkRecoveryMode',
      args: [price],
    }),
    deps.getMinNetDebt(),
  ])

  const targetRatio = isRecoveryMode ? CCR : MCR

  // Max entire debt for ICR == targetRatio; the draw is below this (fee + 200 eat into it).
  const entireDebtCap = (collateral * price) / targetRatio
  if (entireDebtCap <= MUSD_GAS_COMPENSATION) return 0n

  const feeOf = (draw: bigint) =>
    publicClient.readContract({
      address: addresses.borrowerOperations,
      abi: borrowerOperationsAbi,
      functionName: 'getBorrowingFee',
      args: [draw],
    })

  const feasibleWith = (draw: bigint, fee: bigint): boolean => {
    const entireDebt = draw + fee + MUSD_GAS_COMPENSATION
    if (computeICR({ collateral, entireDebt, price }) < targetRatio) return false
    if (isRecoveryMode) return true
    // In normal mode the contract ALSO requires the resulting system TCR to stay at or above
    // CCR (`BorrowerOperations.sol:663-665`), so the open time calculator must respect it
    // too; otherwise it reports a draw the contract rejects.
    const newTcr = computeICR({
      collateral: systemColl + collateral,
      entireDebt: systemDebt + entireDebt,
      price,
    })
    return newTcr >= CCR
  }

  const solved = solveClosedForm({
    collateral,
    price,
    targetRatio,
    borrowingRate,
    decimalPrecision,
    isRecoveryMode,
    systemColl,
    systemDebt,
    feasibleWith,
  })

  let best: bigint
  if (
    solved !== undefined &&
    (await feeOf(solved)) === localFee(solved, borrowingRate, decimalPrecision)
  ) {
    // The closed form's premise held: the chain charges exactly the linear fee at the
    // answer. Two reads total, and no search.
    best = solved
  } else {
    // The premise did not hold, so the shape assumption is wrong for this deployment and
    // the search is what it was there for. This is the only path that costs one call per
    // step, and it is bounded.
    best = await binarySearch(entireDebtCap, feeOf, feasibleWith)
  }

  // Enforce the minNetDebt floor: if even the max ICR-feasible draw is below it, no open.
  if (best + (await feeOf(best)) < minNetDebt) return 0n
  return best
}

/** `getBorrowingFee(draw)` as the contract computes it WHEN the fee is linear. */
function localFee(draw: bigint, borrowingRate: bigint, decimalPrecision: bigint): bigint {
  if (decimalPrecision === 0n) return 0n
  return (borrowingRate * draw) / decimalPrecision
}

interface SolveInput {
  collateral: bigint
  price: bigint
  targetRatio: bigint
  borrowingRate: bigint
  decimalPrecision: bigint
  isRecoveryMode: boolean
  systemColl: bigint
  systemDebt: bigint
  feasibleWith: (draw: bigint, fee: bigint) => boolean
}

/**
 * Solve the largest feasible draw directly, on the premise that the fee is linear in it.
 *
 * **The premise, established on chain rather than assumed.** Probed against the forked
 * deployment at the pinned block, `getBorrowingFee(d)` equals
 * `borrowingRate() * d / DECIMAL_PRECISION()` EXACTLY, for `d` at 1, 7, 1000 (where the
 * truncation is visible), 1e18, an odd 1.23e18, 5000e18 and 1e30. At the live rate,
 * `borrowingRate() = 1e15` against `DECIMAL_PRECISION() = 1e18`, that is a flat 0.1% with
 * floor division and no intercept, no tier and no minimum.
 *
 * **Why it is still only a premise.** `borrowingRate` is GOVERNABLE
 * (`proposeBorrowingRate`/`approveBorrowingRate` are both on the ABI), and linearity is a
 * property of the current implementation, not a guarantee the protocol makes. So the caller
 * CONFIRMS this solution against a real `getBorrowingFee` call and falls back to the search
 * when the confirmation fails. A closed form that silently disagrees with the chain would be
 * worse than the slow loop it replaced.
 *
 * The algebra: the binding constraint is on entire debt,
 * `draw + fee(draw) + 200 <= cap`, where `cap` is the ICR cap and, in normal mode, also the
 * resulting TCR cap. With `fee(d) = floor(rate * d / P)`,
 * `d * (P + rate) / P >= d + fee(d)`, so `floor(available * P / (P + rate))` is always
 * feasible and is at most a couple of units under the true maximum. The local walk closes
 * that gap; it is bounded because floor division can only lose one unit per term.
 *
 * Returns `undefined` when the premise cannot even be evaluated (a zero
 * `DECIMAL_PRECISION`, which no real deployment has) so the caller searches instead.
 */
function solveClosedForm(input: SolveInput): bigint | undefined {
  const {
    collateral,
    price,
    targetRatio,
    borrowingRate,
    decimalPrecision,
    isRecoveryMode,
    systemColl,
    systemDebt,
    feasibleWith,
  } = input
  if (decimalPrecision === 0n) return undefined

  const icrCap = (collateral * price) / targetRatio
  // The resulting TCR cap, in the same units (entire debt of the NEW position).
  const tcrCap = isRecoveryMode ? icrCap : ((systemColl + collateral) * price) / CCR - systemDebt
  const cap = tcrCap < icrCap ? tcrCap : icrCap
  if (cap <= MUSD_GAS_COMPENSATION) return 0n

  const available = cap - MUSD_GAS_COMPENSATION
  let draw = (available * decimalPrecision) / (decimalPrecision + borrowingRate)

  const fee = (d: bigint) => localFee(d, borrowingRate, decimalPrecision)

  // Walk to the exact boundary. Both loops are bounded by construction: floor division can
  // only lose one unit per term, so the gap is a handful of wei, and the caps stop a
  // pathological rate from turning this into a second unbounded loop.
  let steps = 0
  while (steps < 64 && !feasibleWith(draw, fee(draw))) {
    if (draw === 0n) break
    draw -= 1n
    steps += 1
  }
  steps = 0
  while (steps < 64 && feasibleWith(draw + 1n, fee(draw + 1n))) {
    draw += 1n
    steps += 1
  }
  if (!feasibleWith(draw, fee(draw)) && draw !== 0n) return undefined
  if (feasibleWith(draw + 1n, fee(draw + 1n))) return undefined
  return draw
}

/**
 * The original monotonic binary search, kept as the fallback and now explicitly bounded
 * (MK-010). One `getBorrowingFee` call per step, which is exactly why it is no longer the
 * primary path.
 */
async function binarySearch(
  entireDebtCap: bigint,
  feeOf: (draw: bigint) => Promise<bigint>,
  feasibleWith: (draw: bigint, fee: bigint) => boolean,
): Promise<bigint> {
  let lo = 0n
  let hi = entireDebtCap - MUSD_GAS_COMPENSATION
  let steps = 0
  while (lo < hi) {
    if (steps >= MAX_BORROWING_POWER_ITERATIONS) break
    steps += 1
    const mid = (lo + hi + 1n) / 2n
    if (feasibleWith(mid, await feeOf(mid))) lo = mid
    else hi = mid - 1n
  }
  return lo
}
