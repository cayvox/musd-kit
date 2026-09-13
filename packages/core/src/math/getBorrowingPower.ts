import type { Abi, Address } from 'viem'
import {
  borrowerOperationsAbi,
  interestRateManagerAbi,
  priceFeedAbi,
  troveManagerAbi,
} from '../clients'
import { CCR, MCR, MULTICALL3_ADDRESS, MUSD_GAS_COMPENSATION, SECONDS_PER_YEAR } from '../constants'
import { InvalidAmount } from '../errors'
import { withTypedErrors } from '../errors/mapRevert'
import { computeICR } from './compute'
import type { MathDeps } from './deps'
import { isBorrowingFeeCharged } from './fee'
import { evaluateOpen } from './previewOpen'

/**
 * The window, in seconds, {@link BorrowingPower.recommended} is sized to survive (MK-100).
 *
 * It covers the delay between reading the figure and the open landing, which includes a person
 * reading a screen and signing, and the first stretch the position then has to live through.
 *
 * **One hour, chosen from measurement.** `scripts/oracle-moves.ts` read `fetchPrice()` on Mezo
 * mainnet over blocks 11664905 to 11822985 (610589 seconds, one sample every 16 blocks). The worst
 * fall inside a window grows with the window: p99 6.26 bps over 60 seconds, 42.56 bps over 600
 * seconds, 132.56 bps over 3600 seconds. A 60 second window would size the margin to the delay of a
 * script, not of a person, and the fork proof asks the recommended Trove to be healthy an hour after
 * it opens. The interest this window adds is small next to the price part: at a 1% rate, one hour of
 * interest is about 0.0114 bps of the debt.
 */
export const BORROWING_POWER_MARGIN_WINDOW_SECONDS = 3600n

/**
 * The adverse price move, in basis points, {@link BorrowingPower.recommended} absorbs (MK-100).
 *
 * **200 bps (2%), chosen from measurement.** Over the same 610589 seconds of Mezo mainnet
 * `fetchPrice()`, the largest fall from any sampled start to the lowest sampled price in the hour
 * after it was 190.78 bps (9822 windows: p50 13.08, p90 50.22, p99 132.56, p99.9 181.87). 200 is that
 * maximum rounded up, so the recommended figure would have survived the worst hour of that week.
 *
 * **What the measurement cannot show.** It is one week, which is one market regime rather than a
 * distribution of them, and it samples one block in sixteen, so a dip that recovered between two
 * samples is not in it: the figures are a lower bound on the true worst move. A move larger than 2%
 * within the hour happens, and a position opened at the recommended figure does not survive it.
 * Reproduce with `pnpm tsx scripts/oracle-moves.ts --end 11823000 --days 7 --step 16`.
 */
export const BORROWING_POWER_PRICE_MOVE_BPS = 200n

/** Inputs to {@link MusdClient.getBorrowingPower}: the collateral to size a draw against. */
export interface GetBorrowingPowerParams {
  collateral: bigint
  /** Override the price; defaults to `fetchPrice()`. */
  price?: bigint
  /**
   * The account that would open the Trove. Supply it whenever you have it (MK-067, MK-106).
   *
   * The borrowing fee is skipped entirely for a fee exempt account
   * (`BorrowerOperations.sol:637-643`), and the exempt cohort is NOT empty on mainnet, so for
   * such a caller the largest valid draw is LARGER than the one this returns without it.
   * Omitted, the calculation assumes the account is not exempt, exactly as
   * {@link previewOpen} does with the same absence. `useBorrowingPower` supplies the connected
   * wallet when the caller does not.
   *
   * It has no effect in Recovery Mode, where the fee is skipped for everyone and the mode is
   * read from the chain rather than from this parameter.
   */
  account?: Address
  /** Override {@link BORROWING_POWER_MARGIN_WINDOW_SECONDS} for `recommended`. */
  marginWindowSeconds?: bigint
  /** Override {@link BORROWING_POWER_PRICE_MOVE_BPS} for `recommended`. `0n` removes the price part. */
  priceMoveBps?: bigint
}

/** The margin {@link BorrowingPower.recommended} was solved with, reported rather than hidden. */
export interface BorrowingPowerMargin {
  /** The window it is sized for, in seconds. */
  windowSeconds: bigint
  /** The adverse price move it absorbs, in basis points. */
  priceMoveBps: bigint
  /**
   * `interestRateManager.interestRate()`, in basis points: the rate a Trove opened now carries
   * (`BorrowerOperations.sol:668-672`), which is what accrues on it.
   */
  interestRateBps: bigint
  /** Interest over `windowSeconds` at that rate, as a 1e18 fraction of the debt, rounded up. */
  accrualFraction: bigint
  /**
   * The price `recommended` is solved against: `price * (1 - priceMove) / (1 + accrual)`. Every open
   * gate, the individual ratio and the resulting system ratio alike, scales with the price, so
   * clearing them at this price clears them after that fall and that accrual.
   */
  stressedPrice: bigint
}

/**
 * Two figures for one question, named so neither can be taken for the other (MK-100).
 *
 * `ceiling` is what the contract accepts. `recommended` is what to offer. They differ by exactly the
 * margin in {@link margin}, and neither is ever returned under the other's name.
 */
export interface BorrowingPower {
  /**
   * **The absolute ceiling: the largest draw the contract accepts right now, with NO margin.**
   *
   * In normal mode, with the individual ratio binding, it opens the position at exactly the 110%
   * minimum collateral ratio. Liquidation is `ICR < MCR` (`TroveManager.sol:1146-1148`) and the debt
   * accrues every second (`TroveManager.sol:1513-1527`), so a Trove opened here is liquidatable
   * within a second (MK-100, measured in `zz-borrowing-power-boundary.fork.test.ts`). In Recovery
   * Mode it opens at exactly 150%. With the system ratio binding, the open is refused a block later.
   * **Do not open at it.** It is a limit to display, not an amount to borrow.
   */
  ceiling: bigint
  /**
   * **The recommended draw: the largest draw that still clears every open gate after the margin.**
   * Opened at this figure, a Trove starts at an ICR of at least the threshold times
   * `price / margin.stressedPrice`, and it stays liquidation free while the price divided by one
   * plus the interest accrued since the open stays at or above `margin.stressedPrice`. That holds
   * for a fall of up to `margin.priceMoveBps` together with up to `margin.windowSeconds` of
   * interest, and for a larger share of either when the other is smaller. `0n` when no open with
   * that margin clears the debt floor.
   */
  recommended: bigint
  /** The ICR a Trove opened at `ceiling` starts at, at `price`. `0n` when `ceiling` is `0n`. */
  ceilingIcr: bigint
  /** The ICR a Trove opened at `recommended` starts at, at `price`. `0n` when `recommended` is `0n`. */
  recommendedIcr: bigint
  /** How `recommended` was sized. */
  margin: BorrowingPowerMargin
  /** `checkRecoveryMode(price)`, which picks the individual ratio threshold for both figures. */
  isRecoveryMode: boolean
  /** BTC/USD both figures were solved at. */
  price: bigint
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
 * How much a position opened now can borrow, as two figures: the contract's {@link BorrowingPower.ceiling}
 * and a {@link BorrowingPower.recommended} draw that leaves a measured margin (MK-100). This is an
 * **open time calculator and nothing else**: it sizes a draw for a position that does not exist yet.
 *
 * **Offer `recommended`. Never open at `ceiling`.** Until 0.4.0 this function returned only the
 * ceiling, as a bare `bigint`, which in normal mode opens a Trove at exactly the liquidation threshold.
 * The external audit that reported MK-100 opened at it on a fork, found it liquidatable a second later,
 * and a keeper liquidated it. `recommended` is solved against a stressed price,
 * `price * (1 - priceMoveBps / 10000) / (1 + accrual over windowSeconds)`, with the accrual at the
 * live global rate a new Trove would carry. It therefore clears every open gate after that fall and
 * that accrual, and a Trove opened at it is not liquidatable within that window at a steady price.
 * The window and the move are {@link BORROWING_POWER_MARGIN_WINDOW_SECONDS} and
 * {@link BORROWING_POWER_PRICE_MOVE_BPS}, and how each was measured is stated on them. Both are
 * reported on the result, and both can be overridden per call.
 *
 * **What it does not promise.** A price that falls further than the margin, faster than the window,
 * can still take the position to liquidation. That is the market, not this function; the margin
 * makes a Trove opened at the recommended figure survive an ordinary interval, not every one.
 *
 * It is NOT the right function for a Trove that already exists. Every Trove carries a
 * `maxBorrowingCapacity`, `coll * price / (110 * 1e16)` (`BorrowerOperations.sol:1323-1328`), set at
 * open, lowered on a collateral decrease (`:879-897`) and RESET from the current price on every
 * refinance (`:1077-1084`, MK-101). A debt increase is gated on it (`:1358-1365`), which this function
 * does not model. For an existing Trove use `previewBorrow`, which returns a verdict plus the binding
 * constraint (MK-002).
 *
 * **It does not decide anything about the open rules (MK-067, MK-069).** Its feasibility
 * predicate IS {@link evaluateOpen}, called per candidate, for both figures, so the individual ratio,
 * the mode correct threshold, the resulting system TCR and the debt floor all have exactly one
 * implementation in this package and it is not here. Every `return` from `solveClosedForm` and
 * `binarySearch` below is gated on `feasibleWith`, and `feasibleWith` is nothing but a call to
 * `evaluateOpen`. `borrowing-power-agreement.test.ts` asserts that each figure is viable to the
 * evaluator at its own price and that one wei more is not.
 *
 * **Cost (MK-010), COUNTED rather than asserted (MK-092).** The price, the fee rate, the interest rate
 * and the system totals ride in one `multicall`; each figure is solved in closed form from the linear
 * fee, and the chain is asked for the real `getBorrowingFee` once, to CONFIRM the ceiling's solution,
 * which also confirms the linearity the recommended figure reuses. Measured with a counting client,
 * the sequential round trips are:
 *
 *   normal mode, no account      4
 *   normal mode, with account    5
 *   Recovery Mode, no account    3
 *
 * **What this function does NOT promise: a single block snapshot** (MK-093). `price` and
 * `checkRecoveryMode(price)` are separate round trips after the batch, so the system totals the
 * resulting TCR gate uses can come from an earlier block than the price they are measured against.
 *
 * @throws {InvalidAmount} for a non-positive collateral.
 */
export async function getBorrowingPower(
  deps: MathDeps,
  params: GetBorrowingPowerParams,
): Promise<BorrowingPower> {
  return withTypedErrors(() => getBorrowingPowerUnchecked(deps, params), {
    operation: 'getBorrowingPower',
  })
}

async function getBorrowingPowerUnchecked(
  deps: MathDeps,
  params: GetBorrowingPowerParams,
): Promise<BorrowingPower> {
  const { publicClient, addresses } = deps
  const { collateral } = params

  // Validate the input rather than searching over it. A UI bound to a text input is the
  // caller this protects: a negative or zero collateral is a bug, not a small answer.
  if (collateral <= 0n) throw new InvalidAmount('collateral', collateral)

  const tm = { address: addresses.troveManager, abi: troveManagerAbi as Abi } as const
  const bo = { address: addresses.borrowerOperations, abi: borrowerOperationsAbi as Abi } as const

  // One batch for the price INDEPENDENT reads plus the fee RATE, which is what makes the closed
  // form possible at all, and the INTEREST rate the recommended figure's accrual is sized at.
  // `fetchPrice` joins it when the caller supplied no price. `checkRecoveryMode` CANNOT: it takes the
  // price as an argument, and inside this batch the price does not exist yet.
  const needsPrice = params.price === undefined
  const contracts: { address: Address; abi: Abi; functionName: string }[] = [
    { ...bo, functionName: 'borrowingRate' },
    { ...bo, functionName: 'DECIMAL_PRECISION' },
    { ...tm, functionName: 'getEntireSystemColl' },
    { ...tm, functionName: 'getEntireSystemDebt' },
    {
      address: addresses.interestRateManager,
      abi: interestRateManagerAbi as Abi,
      functionName: 'interestRate',
    },
  ]
  if (needsPrice) {
    contracts.push({
      address: addresses.priceFeed,
      abi: priceFeedAbi as Abi,
      functionName: 'fetchPrice',
    })
  }
  const batched = (await publicClient.multicall({
    allowFailure: false,
    multicallAddress: MULTICALL3_ADDRESS,
    contracts,
  })) as [bigint, bigint, bigint, bigint, bigint | number, bigint?]
  const [borrowingRate, decimalPrecision, systemColl, systemDebt, interestRate] = batched
  const price = params.price ?? (batched[5] as bigint)

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
  // MK-067, MK-069. THE one rule, from `math/fee.ts`, mirroring `BorrowerOperations.sol:637-643`.
  const chargesFee = isBorrowingFeeCharged(isRecoveryMode, feeExempt)
  const effectiveRate = chargesFee ? borrowingRate : 0n

  // ---- the margin (MK-100) ----
  const windowSeconds = params.marginWindowSeconds ?? BORROWING_POWER_MARGIN_WINDOW_SECONDS
  const priceMoveBps = params.priceMoveBps ?? BORROWING_POWER_PRICE_MOVE_BPS
  const interestRateBps = BigInt(interestRate)
  const E18 = 10n ** 18n
  const accrualDenominator = 10_000n * SECONDS_PER_YEAR
  // Rounded UP, so the margin is never smaller than the interest it is meant to cover.
  const accrualFraction =
    (interestRateBps * windowSeconds * E18 + accrualDenominator - 1n) / accrualDenominator
  const stressedPrice =
    (price * (10_000n - priceMoveBps) * E18) / (10_000n * (E18 + accrualFraction))
  const margin: BorrowingPowerMargin = {
    windowSeconds,
    priceMoveBps,
    interestRateBps,
    accrualFraction,
    stressedPrice,
  }

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
   * Ratio feasibility at a given price, decided by {@link evaluateOpen} and by nothing here
   * (MK-067, MK-069). `minNetDebt: 0n` and `troveStatus: undefined` are deliberate: the floor is
   * applied once at the end, and no Trove exists yet whose status could gate the calculation. The
   * mode stays the one read at the real price for both figures.
   */
  const feasibleAt =
    (atPrice: bigint) =>
    (draw: bigint, fee: bigint): boolean =>
      evaluateOpen({
        collateral,
        debt: draw,
        fee,
        feeExempt,
        minNetDebt: 0n,
        isRecoveryMode,
        price: atPrice,
        systemColl,
        systemDebt,
        troveStatus: undefined,
      }).viable

  const targetRatio = isRecoveryMode ? CCR : MCR
  const meetsFloor = (draw: bigint, fee: bigint) =>
    evaluateOpen({
      collateral,
      debt: draw,
      fee,
      feeExempt,
      minNetDebt,
      isRecoveryMode,
      price,
      systemColl,
      systemDebt,
      troveStatus: undefined,
    }).meetsMinimum
  const icrAt = (draw: bigint, fee: bigint) =>
    draw === 0n
      ? 0n
      : computeICR({ collateral, entireDebt: draw + fee + MUSD_GAS_COMPENSATION, price })

  // ---- the ceiling, exactly as before: the largest draw the gates accept at the real price ----
  let ceiling = 0n
  let ceilingFee = 0n
  let linearConfirmed = !chargesFee
  if ((collateral * price) / targetRatio > MUSD_GAS_COMPENSATION) {
    const feasible = feasibleAt(price)
    const solved = solveClosedForm({
      collateral,
      price,
      targetRatio,
      borrowingRate: effectiveRate,
      decimalPrecision,
      isRecoveryMode,
      systemColl,
      systemDebt,
      feasibleWith: feasible,
    })
    // MK-092. The confirmation fee is KEPT rather than re-read.
    const solvedFee = solved === undefined ? undefined : await feeOf(solved)
    if (solved !== undefined && solvedFee === localFee(solved, effectiveRate, decimalPrecision)) {
      ceiling = solved
      ceilingFee = solvedFee
      linearConfirmed = true
    } else {
      // The premise did not hold, so the search is what it was there for: bounded, one call a step.
      ceiling = await binarySearch((collateral * price) / targetRatio, feeOf, feasible)
      ceilingFee = await feeOf(ceiling)
    }
    if (!meetsFloor(ceiling, ceilingFee)) {
      ceiling = 0n
      ceilingFee = 0n
    }
  }

  // ---- the recommended figure: the same solver, at the stressed price ----
  let recommended = 0n
  let recommendedFee = 0n
  if (ceiling > 0n && (collateral * stressedPrice) / targetRatio > MUSD_GAS_COMPENSATION) {
    const feasible = feasibleAt(stressedPrice)
    const solved = solveClosedForm({
      collateral,
      price: stressedPrice,
      targetRatio,
      borrowingRate: effectiveRate,
      decimalPrecision,
      isRecoveryMode,
      systemColl,
      systemDebt,
      feasibleWith: feasible,
    })
    if (solved !== undefined && linearConfirmed) {
      // The fee was confirmed linear against the chain for the ceiling a moment ago, and the
      // recommended draw is smaller, so the local fee IS the chain's fee here: no second read.
      recommended = solved
      recommendedFee = localFee(solved, effectiveRate, decimalPrecision)
    } else {
      recommended = await binarySearch((collateral * stressedPrice) / targetRatio, feeOf, feasible)
      recommendedFee = await feeOf(recommended)
    }
    if (recommended > ceiling) recommended = ceiling
    if (!meetsFloor(recommended, recommendedFee)) {
      recommended = 0n
      recommendedFee = 0n
    }
  }

  return {
    ceiling,
    recommended,
    ceilingIcr: icrAt(ceiling, ceilingFee),
    recommendedIcr: icrAt(recommended, recommendedFee),
    margin,
    isRecoveryMode,
    price,
  }
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
