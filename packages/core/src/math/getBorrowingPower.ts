import type { Abi, Address } from 'viem'
import { borrowerOperationsAbi, priceFeedAbi, troveManagerAbi } from '../clients'
import { CCR, MCR, MULTICALL3_ADDRESS, MUSD_GAS_COMPENSATION } from '../constants'
import { InvalidAmount } from '../errors'
import type { MathDeps } from './deps'
import { isBorrowingFeeCharged } from './fee'
import { evaluateOpen } from './previewOpen'

/** Inputs to {@link MusdClient.getBorrowingPower}: the collateral to size a draw against. */
export interface GetBorrowingPowerParams {
  collateral: bigint
  /** Override the price; defaults to `fetchPrice()`. */
  price?: bigint
  /**
   * The account that would open the Trove. Supply it whenever you have it (MK-067).
   *
   * The borrowing fee is skipped entirely for a fee exempt account
   * (`BorrowerOperations.sol:637-643`), and the exempt cohort is NOT empty on mainnet, so for
   * such a caller the largest valid draw is LARGER than the one this returns without it.
   * Omitted, the calculation assumes the account is not exempt, exactly as
   * {@link previewOpen} does with the same absence.
   *
   * It has no effect in Recovery Mode, where the fee is skipped for everyone and the mode is
   * read from the chain rather than from this parameter.
   */
  account?: Address
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
 * **It does not decide anything about the open rules (MK-067, MK-069).** Its feasibility
 * predicate IS {@link evaluateOpen}, called per candidate, so the individual ratio, the mode
 * correct threshold, the resulting system TCR and the debt floor all have exactly one
 * implementation in this package and it is not here.
 *
 * **Why a projection rather than the delegation `previewBorrow` uses.** `previewBorrow` can be
 * `previewAdjustTrove` outright, because on chain a borrow IS an adjustment: one call, one
 * verdict. This function asks a different question, "what is the largest draw for which that
 * verdict is yes", and a maximum cannot be a case of the evaluator that answers a candidate.
 * So it stays a solver, and the thing it solves over is the evaluator. **A reader can check
 * that claim in one place:** every `return` from `solveClosedForm` and `binarySearch` below is
 * gated on `feasibleWith`, and `feasibleWith` is nothing but a call to `evaluateOpen`. The caps
 * inside the solver are search bounds and never verdicts, which is why a wrong cap can only
 * cost round trips.
 *
 * Structurally, drift is refused the way the P12 wave refused it rather than by care:
 * `packages/core/test/borrowing-power-agreement.test.ts` asserts that the answer is viable to
 * `previewOpen` and that one wei more is not, in both modes and for an exempt account.
 *
 * Returns `0n` when even the largest ratio feasible draw is below the debt floor, meaning no
 * valid open exists for this collateral.
 *
 * **Cost (MK-010).** Every chain read happens in ONE `multicall`, then the answer is solved
 * in closed form from the linear fee, and the chain is asked for the real
 * `getBorrowingFee` only to CONFIRM the solution. That is **three round trips**, or four when
 * an `account` is supplied in normal mode and the exemption has to be read, instead of roughly
 * 77 sequential ones. It was two before MK-067 added the mode correct fee: the exemption read
 * is the price of being right for a cohort the protocol actually has, and it is skipped
 * entirely in Recovery Mode, where the mode alone settles the fee. The binary search is still
 * here, bounded, as the fallback for when the fee stops being linear.
 *
 * The premise, that `getBorrowingFee(d)` equals
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

  // MK-067. Read the exemption rather than assuming nobody is exempt, on the same rule
  // `previewOpen` uses: with no account there is nobody to ask, so assume not exempt. The read
  // is skipped in Recovery Mode, where the fee is already zero for everyone and the answer
  // could not change the outcome.
  const feeExempt =
    !isRecoveryMode && params.account !== undefined
      ? await deps.isAccountFeeExempt(params.account)
      : false
  // MK-067, MK-069. THE one rule, from `math/fee.ts`, mirroring
  // `BorrowerOperations.sol:637-643`. This file previously charged the fee unconditionally
  // while separately reading the mode two lines above, which is how a Recovery Mode maximum
  // came back short by the fee.
  const chargesFee = isBorrowingFeeCharged(isRecoveryMode, feeExempt)

  const targetRatio = isRecoveryMode ? CCR : MCR

  // A SEARCH BOUND, not a verdict: the largest entire debt the individual ratio could allow,
  // which is at or above the true maximum in every mode. `feasibleWith` decides.
  const entireDebtCap = (collateral * price) / targetRatio
  if (entireDebtCap <= MUSD_GAS_COMPENSATION) return 0n

  const feeOf = (draw: bigint): Promise<bigint> =>
    chargesFee
      ? publicClient.readContract({
          address: addresses.borrowerOperations,
          abi: borrowerOperationsAbi,
          functionName: 'getBorrowingFee',
          args: [draw],
        })
      : // The contract charges nothing here, so quoting a fee would be a round trip spent to
        // produce a number that is then not applied.
        Promise.resolve(0n)

  /**
   * Ratio feasibility, decided by {@link evaluateOpen} and by nothing here (MK-067, MK-069).
   *
   * `minNetDebt: 0n` and `troveStatus: undefined` are deliberate: the floor is applied once at
   * the end against the real value, and there is no account whose Trove status could gate a
   * calculation about a position that does not exist. With those two neutralised the only
   * reasons `evaluateOpen` can return are `ICR_BELOW_THRESHOLD` and `TCR_BELOW_CCR`, so
   * `viable` is exactly "the ratios allow this draw", in whichever mode the chain is in.
   */
  const feasibleWith = (draw: bigint, fee: bigint): boolean =>
    evaluateOpen({
      collateral,
      debt: draw,
      fee,
      feeExempt,
      minNetDebt: 0n,
      isRecoveryMode,
      price,
      systemColl,
      systemDebt,
      troveStatus: undefined,
    }).viable

  const solved = solveClosedForm({
    collateral,
    price,
    targetRatio,
    // The EFFECTIVE rate: zero when the contract will not charge, so the closed form solves
    // the same equation the gate evaluates.
    borrowingRate: chargesFee ? borrowingRate : 0n,
    decimalPrecision,
    isRecoveryMode,
    systemColl,
    systemDebt,
    feasibleWith,
  })

  let best: bigint
  if (
    solved !== undefined &&
    (await feeOf(solved)) === localFee(solved, chargesFee ? borrowingRate : 0n, decimalPrecision)
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

  // The debt floor, from the SAME evaluator rather than restated here: `netDebt >= minNetDebt`
  // where `netDebt` is the draw plus the fee the contract will actually charge
  // (`BorrowerOperations.sol:645`). Restating it was how the fee got applied twice over.
  const verdict = evaluateOpen({
    collateral,
    debt: best,
    fee: await feeOf(best),
    feeExempt,
    minNetDebt,
    isRecoveryMode,
    price,
    systemColl,
    systemDebt,
    troveStatus: undefined,
  })
  if (!verdict.meetsMinimum) return 0n
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
  /** The EFFECTIVE rate: zero when the contract will not charge a fee at all (MK-067). */
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
 * **The two caps below are SEARCH BOUNDS and never verdicts (MK-069).** They exist to land the
 * walk within a few wei of the answer instead of iterating from zero. Correctness comes from
 * `feasibleWith`, which is {@link evaluateOpen}: the walk is driven by it, and the two guards
 * before the `return` refuse to answer unless the draw is feasible AND the draw plus one wei is
 * not. So a cap that is wrong costs round trips and cannot produce a wrong maximum.
 * That is what makes it safe for the rules to live in the evaluator while the algebra lives
 * here.
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

  // Walk UP to the exact boundary. Bounded by construction: floor division can only lose one
  // unit per term, so the gap is a handful of wei.
  //
  // **There is no downward walk, because the seed cannot overshoot.** With `fee(d)` linear,
  // `d * (P + rate) / P >= d + fee(d)`, so `draw + fee(draw) <= available` for
  // `draw = floor(available * P / (P + rate))`, which puts the entire debt at or under `cap`.
  // `cap` is the smaller of the two thresholds `feasibleWith` tests, and both are inclusive
  // (`_requireICRisAboveCCR` and `_requireNewTCRisAboveCCR` are `>=`), so a seed at the cap is
  // feasible rather than one wei over. A downward loop sat here until the P13 wave and could
  // not execute; it was 4 statements no test could reach, which is dead weight on the coverage
  // ratchet and, worse, a branch a reader would assume had been exercised.
  //
  // If `feasibleWith` ever grows a condition the caps do not imply, the seed CAN become
  // infeasible, and the guards below already handle it: they refuse to answer and the caller
  // falls back to the bounded binary search, which is the right behaviour and is where a
  // non-linear fee is handled too.
  let steps = 0
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
