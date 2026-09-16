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
}

/**
 * The contract's limit for an open at this collateral, and nothing else (MK-100, MK-240).
 *
 * **There is no amount to borrow on this result, on purpose.** How much to borrow depends on how long
 * the position will be held and how far the price may fall meanwhile, and the library knows neither.
 * Until 0.5.0 this result carried a `recommended` figure sized for one hour and a 2 percent fall, and
 * both READMEs presented it as the draw to offer; over 90 days of Mezo mainnet prices a fall that large
 * followed within a week of 57.6 percent of sampled start times (MK-240, the table on
 * {@link drawForMargin}). For a draw sized to a margin YOU choose, call {@link drawForMargin}, which
 * has no default for either input.
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
   * **Do not open at it.** It is a limit to display, not an amount to borrow, and it holds for the
   * block it was read at.
   */
  ceiling: bigint
  /** The ICR a Trove opened at `ceiling` starts at, at `price`. `0n` when `ceiling` is `0n`. */
  ceilingIcr: bigint
  /** `checkRecoveryMode(price)`, which picks the individual ratio threshold. */
  isRecoveryMode: boolean
  /** BTC/USD the ceiling was solved at. */
  price: bigint
}

/** Inputs to {@link MusdClient.drawForMargin}: the collateral, and the margin the caller chooses. */
export interface DrawForMarginParams extends GetBorrowingPowerParams {
  /**
   * **How long the position must survive, in seconds.** Required, with no default (MK-240): the
   * library cannot know how long a position will be held. Covers the interest the Trove accrues over
   * that time at the rate it would open with. `0n` asks for no interest allowance, which is a choice
   * and is reported as one. The price history for choosing it is on {@link drawForMargin}.
   *
   * @throws {InvalidAmount} when absent or negative.
   */
  horizonSeconds: bigint
  /**
   * **The fall in the BTC price, in basis points of the price at the read, the position must
   * survive.** Required, with no default (MK-240), from `0n` up to but excluding `10_000n`.
   *
   * @throws {InvalidAmount} when absent or outside `0n <= priceFallBps < 10_000n`.
   */
  priceFallBps: bigint
}

/** The margin {@link MarginDraw.draw} was solved with, as the caller supplied it. */
export interface DrawMargin {
  /** The horizon the caller asked for, in seconds. */
  horizonSeconds: bigint
  /** The price fall the caller asked for, in basis points. */
  priceFallBps: bigint
  /**
   * `interestRateManager.interestRate()`, in basis points: the rate a Trove opened now carries
   * (`BorrowerOperations.sol:668-672`), which is what accrues on it.
   */
  interestRateBps: bigint
  /** Interest over `horizonSeconds` at that rate, as a 1e18 fraction of the debt, rounded up. */
  accrualFraction: bigint
  /**
   * The price `draw` is solved against: `price * (1 - priceFall) / (1 + accrual)`. Every open gate,
   * the individual ratio and the resulting system ratio alike, scales with the price, so clearing
   * them at this price clears them after that fall and that accrual.
   */
  stressedPrice: bigint
}

/** Result of {@link MusdClient.drawForMargin}: a draw that answers the caller's margin, beside the ceiling. */
export interface MarginDraw extends BorrowingPower {
  /**
   * **The largest draw that still clears every open gate after `margin.priceFallBps` of price fall and
   * `margin.horizonSeconds` of interest.** A Trove opened at it starts at an ICR of at least the
   * threshold times `price / margin.stressedPrice`, and it is not liquidatable while the price divided
   * by one plus the interest accrued since the open stays at or above `margin.stressedPrice`. `0n` when
   * no open with that margin clears the debt floor.
   *
   * It is an answer to the margin in `margin` and to nothing else. A fall larger than it, a hold longer
   * than it, or debt redistributed to the Trove from another Trove's liquidation
   * (`TroveManager.sol:980-1047`) can still take the position to liquidation.
   */
  draw: bigint
  /** The ICR a Trove opened at `draw` starts at, at `price`. `0n` when `draw` is `0n`. */
  drawIcr: bigint
  /** The margin `draw` was solved with. */
  margin: DrawMargin
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
 * The contract's ceiling for a position opened now (MK-100, MK-240). This is an **open time
 * calculator and nothing else**: it sizes a limit for a position that does not exist yet.
 *
 * **It answers what the contract accepts, not what to borrow.** The ceiling opens a normal mode Trove
 * at exactly MCR, where it is liquidatable within a second (MK-100). A draw sized to survive holding the
 * position is {@link drawForMargin}, which takes the horizon and the price fall as required inputs.
 *
 * It is NOT the right function for a Trove that already exists. Every Trove carries a
 * `maxBorrowingCapacity`, `coll * price / (110 * 1e16)` (`BorrowerOperations.sol:1323-1328`), set at
 * open, lowered on a collateral decrease (`:879-897`) and RESET from the current price on every
 * refinance (`:1077-1084`, MK-101). A debt increase is gated on it (`:1358-1365`), which this function
 * does not model. For an existing Trove use `previewBorrow`, which returns a verdict plus the binding
 * constraint (MK-002).
 *
 * **It does not decide anything about the open rules (MK-067, MK-069).** Its feasibility
 * predicate IS {@link evaluateOpen}, called per candidate, so the individual ratio, the mode correct
 * threshold, the resulting system TCR and the debt floor all have exactly one implementation in this
 * package and it is not here. `borrowing-power-agreement.test.ts` asserts that the ceiling is viable to
 * the evaluator and that one wei more is not.
 *
 * **Cost (MK-010), COUNTED rather than asserted (MK-092).** The price, the fee rate, the interest rate
 * and the system totals ride in one `multicall`; the figure is solved in closed form from the linear
 * fee, and the chain is asked for the real `getBorrowingFee` once, to CONFIRM the solution. Measured
 * with a counting client, the sequential round trips are:
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
  return withTypedErrors(
    async () => {
      const { ceiling, ceilingIcr, isRecoveryMode, price } = await getBorrowingPowerUnchecked(
        deps,
        params,
        undefined,
      )
      return { ceiling, ceilingIcr, isRecoveryMode, price }
    },
    { operation: 'getBorrowingPower' },
  )
}

/**
 * The largest open draw that survives a margin the CALLER chooses: a price fall and a holding
 * horizon (MK-240). Both are required, and neither has a default, because how much to borrow depends
 * on how long a position will be held and how much of a fall its owner is prepared to absorb, and the
 * library knows neither. The ceiling is returned beside it.
 *
 * `draw` is solved against a stressed price, `price * (1 - priceFallBps / 10000) / (1 + accrual over
 * horizonSeconds)`, with the accrual at the live global rate a new Trove would carry, through the same
 * solver and the same open evaluator as {@link getBorrowingPower}. A Trove opened at it is not
 * liquidatable while the price stays above that fall and the elapsed time stays inside that horizon.
 *
 * **Choosing the inputs: how often a fall was reached, on Mezo mainnet.** The share of start times after
 * which `fetchPrice()` fell at least the given amount at some sample within the horizon, from the
 * committed instrument, over Mezo mainnet blocks 9841930 to 11868955 (86 days, one sample every 225
 * blocks, about 14 minutes):
 *
 * | Horizon | fell 2% or more | 5% or more | 10% or more | 20% or more | worst fall seen |
 * |---|---|---|---|---|---|
 * | 1 hour | 0.1% | 0.0% | 0.0% | 0.0% | 4.18% |
 * | 1 day | 17.4% | 1.0% | 0.0% | 0.0% | 5.70% |
 * | 3 days | 43.9% | 3.8% | 0.01% | 0.0% | 10.24% |
 * | 7 days | 57.6% | 6.7% | 0.2% | 0.0% | 10.80% |
 * | 30 days | 68.2% | 10.4% | 1.1% | 0.0% | 11.64% |
 *
 * Reproduce with `MEZO_MAINNET_RPC_URL=<endpoint> pnpm tsx scripts/oracle-moves.ts --end 11869000
 * --consecutive 0 --days 90 --step 225 --horizons 3600,86400,259200,604800,2592000 --falls
 * 200,500,1000,2000`. The start counts are 9005, 8910, 8709, 8313 and 5917: a start counts only when
 * its whole horizon lies inside the sampled range, so the 30 day row sees fewer, later starts.
 *
 * **What that table is not.** It is one stretch of history in one market regime, not a distribution of
 * regimes. Start times overlap, so neighbouring windows share most of their samples and the shares are
 * not independent trials. It samples one block in 225, so a dip that recovered between two samples is
 * not in it: every share is a lower bound, and the true worst falls are larger. A position is also
 * exposed to more than price: debt redistributed from other Troves' liquidations
 * (`TroveManager.sol:980-1047`) raises its debt without its owner acting. Read it as how often a margin
 * of that size would have been crossed recently, never as a guarantee about the next horizon.
 *
 * @throws {InvalidAmount} for a non-positive collateral, a missing or negative `horizonSeconds`, or a
 *   missing `priceFallBps` or one outside `0n <= priceFallBps < 10_000n`.
 */
export async function drawForMargin(
  deps: MathDeps,
  params: DrawForMarginParams,
): Promise<MarginDraw> {
  return withTypedErrors(
    async () => {
      const solved = await getBorrowingPowerUnchecked(deps, params, {
        horizonSeconds: params.horizonSeconds,
        priceFallBps: params.priceFallBps,
      })
      // The solver fills `marginDraw` on every path that is given a margin and returns; it throws
      // before returning otherwise. The cast states that, rather than a branch no input can reach
      // (which the mutation gate would have to register as unreachable, MK-120's class).
      return solved.marginDraw as MarginDraw
    },
    { operation: 'drawForMargin' },
  )
}

/** The internal result: the ceiling, and the margin draw when a margin was asked for. */
interface SolvedBorrowingPower extends BorrowingPower {
  marginDraw: MarginDraw | undefined
}

/**
 * Refuse a margin the caller did not give or could not mean (MK-240, and MK-100 before it).
 *
 * `undefined` is refused rather than defaulted, which is the whole of MK-240: a JavaScript caller that
 * omits either input must not be handed an answer to a margin somebody else chose. A negative horizon
 * would lift the stressed price above the real one and hand back the ceiling as `draw`, the defect
 * MK-100 exists to prevent, and a fall of the whole price leaves nothing to solve against.
 */
function assertMargin(margin: { horizonSeconds: unknown; priceFallBps: unknown }): {
  horizonSeconds: bigint
  priceFallBps: bigint
} {
  const { horizonSeconds, priceFallBps } = margin
  if (typeof horizonSeconds !== 'bigint' || horizonSeconds < 0n) {
    throw new InvalidAmount(
      'horizonSeconds',
      // Reported as given, `undefined` included: the message then says exactly what was missing.
      horizonSeconds as bigint,
      'Required: how long the position must survive, in seconds, zero or more. There is no default.',
    )
  }
  if (typeof priceFallBps !== 'bigint' || priceFallBps < 0n || priceFallBps >= 10_000n) {
    throw new InvalidAmount(
      'priceFallBps',
      priceFallBps as bigint,
      'Required: the price fall to survive, at least 0 and below 10000 basis points. There is no default.',
    )
  }
  return { horizonSeconds, priceFallBps }
}

async function getBorrowingPowerUnchecked(
  deps: MathDeps,
  params: GetBorrowingPowerParams,
  requestedMargin: { horizonSeconds: unknown; priceFallBps: unknown } | undefined,
): Promise<SolvedBorrowingPower> {
  const { publicClient, addresses } = deps
  const { collateral } = params

  // Validate the input rather than searching over it. A UI bound to a text input is the
  // caller this protects: a negative or zero collateral is a bug, not a small answer.
  if (collateral <= 0n) throw new InvalidAmount('collateral', collateral)
  // The margin is refused before any read, as the collateral is.
  const chosen = requestedMargin === undefined ? undefined : assertMargin(requestedMargin)

  const tm = { address: addresses.troveManager, abi: troveManagerAbi as Abi } as const
  const bo = { address: addresses.borrowerOperations, abi: borrowerOperationsAbi as Abi } as const

  // One batch for the price INDEPENDENT reads plus the fee RATE, which is what makes the closed
  // form possible at all, and the INTEREST rate a margin draw's accrual is sized at.
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

  // ---- the ceiling: the largest draw the gates accept at the real price ----
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

  const base = { ceiling, ceilingIcr: icrAt(ceiling, ceilingFee), isRecoveryMode, price }
  if (chosen === undefined) return { ...base, marginDraw: undefined }

  // ---- the margin draw (MK-240): the same solver, at the price the CALLER's margin stresses ----
  const { horizonSeconds, priceFallBps } = chosen
  const interestRateBps = BigInt(interestRate)
  const E18 = 10n ** 18n
  const accrualDenominator = 10_000n * SECONDS_PER_YEAR
  // Rounded UP, so the margin is never smaller than the interest it is meant to cover.
  const accrualFraction =
    (interestRateBps * horizonSeconds * E18 + accrualDenominator - 1n) / accrualDenominator
  const stressedPrice =
    (price * (10_000n - priceFallBps) * E18) / (10_000n * (E18 + accrualFraction))
  const margin: DrawMargin = {
    horizonSeconds,
    priceFallBps,
    interestRateBps,
    accrualFraction,
    stressedPrice,
  }

  let draw = 0n
  let drawFee = 0n
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
      // The fee was confirmed linear against the chain for the ceiling a moment ago, and this draw
      // is smaller, so the local fee IS the chain's fee here: no second read.
      draw = solved
      drawFee = localFee(solved, effectiveRate, decimalPrecision)
    } else {
      draw = await binarySearch((collateral * stressedPrice) / targetRatio, feeOf, feasible)
      drawFee = await feeOf(draw)
    }
    if (draw > ceiling) draw = ceiling
    if (!meetsFloor(draw, drawFee)) {
      draw = 0n
      drawFee = 0n
    }
  }

  return {
    ...base,
    marginDraw: { ...base, draw, drawIcr: icrAt(draw, drawFee), margin },
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
