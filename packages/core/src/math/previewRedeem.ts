import type { Address } from 'viem'
import { musdAbi, priceFeedAbi, sortedTrovesAbi, troveManagerAbi } from '../clients'
import { MCR, MUSD_GAS_COMPENSATION } from '../constants'
import type { MathDeps } from './deps'

/**
 * Redemption, previewed by walking the list the way `redeemCollateral` does (MK-048).
 *
 * **Why this exists rather than trusting `getRedemptionHints`.** The protocol's hint helper and
 * the redemption loop do not agree about how much a single call can redeem, and the SDK used to
 * report the helper's figure. Both were read from `mezo-org/musd` for this file:
 *
 * `HintHelpers.sol:138-162` sizes each partial to the target's headroom above the debt floor,
 * `maxRedeemableMUSD = min(remainingMUSD, netDebt - minNetDebt)`, and then CONTINUES to the next
 * trove with what is left. So its `truncatedAmount` answers "how much could be redeemed if every
 * partial were sized per trove", which needs one call per trove.
 *
 * `TroveManager.sol:1218-1221` does no such sizing. It hands the whole remaining amount to the
 * first eligible trove, `mUSDLot = min(_maxMUSDamount, totalDebt - MUSD_GAS_COMPENSATION)`, and if
 * that leaves the trove's net debt below the floor it CANCELS the partial (`:1299-1306`), which
 * breaks the loop (`:392`). If nothing was drawn before the break, the whole call reverts
 * (`:406-408`).
 *
 * **So the redeemable set has a GAP, not a cap.** For the first eligible trove with net debt `D`
 * and floor `M`:
 *
 *   A <= D - M      succeeds, a partial within the headroom
 *   D - M < A < D   REVERTS, the partial breaches the floor and cancels on the first trove
 *   A >= D          succeeds, the trove is consumed WHOLE, which takes a different branch
 *                   (`:1252`) with no hint check and no floor check at all
 *
 * Verified on a fork against the real deployment, to the wei, with the hint helper's answer beside
 * each: headroom exactly SUCCEEDS, headroom+1 REVERTS, half of net debt REVERTS, netDebt-1 REVERTS,
 * netDebt exactly SUCCEEDS, netDebt+1 SUCCEEDS. The helper reported every one of those amounts as
 * fully redeemable, including the three that revert.
 *
 * That gap is what no field in this SDK expressed, and it is why a caller could not foresee the
 * revert: the blocking condition lives in SOMEONE ELSE'S position.
 *
 * **The upper edge is not `D`, it is `D` plus an accrual margin, and that correction came from the
 * sweep rather than from reading.** `_redeemCollateralFromTrove` sizes the lot against
 * `_getTotalDebt` read AFTER `_updateTroveInterest` has run on the target (`:366`, `:1218-1221`),
 * so by the block a transaction executes in, the Trove owes more than this preview read. An offer
 * of exactly `D` is then a partial leaving dust, dust is below the floor, and it cancels.
 *
 * The line above claiming `netDebt exactly SUCCEEDS` was measured with the read and the evaluation
 * at the SAME block, which is a delay no caller can have: a simulation runs at the current block
 * and a transaction lands at least one block later. Measured on a fork with only the delay varied
 * (`test/redeem-boundary.fork.test.ts`), from one snapshot:
 *
 *   delay   netDebt    netDebt + margin
 *   0s      success    success
 *   1s      REVERTED   success
 *   60s     REVERTED   success
 *   600s    REVERTED   success
 *   3600s   REVERTED   REVERTED
 *
 * **One second is enough to make the bare net debt fail**, and the margin holds for exactly the
 * window it is sized for. 600 seconds is the contract's own allowance for accrual where it bounds
 * a partial hint (`:1276-1285`) rather than a number chosen to feel safe.
 *
 * **So {@link RedemptionPreview.nextViableAmount} is good for about ten minutes, and not longer.**
 * Offering more is always safe: the excess spills to the next Trove, and a cancellation there
 * cannot revert the call, because the first Trove was already drawn and `:406-408` only requires
 * that something was. A caller who expects a longer delay should add to it.
 */

/** Why a redemption would be refused. Machine readable, in contract call order. */
export type RedeemBlockReason =
  /** `_requireTCRoverMCR` (`TroveManager.sol:318`, `:1470-1475`). A system condition, not yours. */
  | 'SYSTEM_TCR_BELOW_MCR'
  /** `_requireAmountGreaterThanZero` (`:319`, `:1612-1614`). */
  | 'AMOUNT_ZERO'
  /** `_requireMUSDBalanceCoversRedemption` (`:320`, `:1477-1486`). */
  | 'INSUFFICIENT_MUSD_BALANCE'
  /** No Trove is at or above MCR, so the loop finds nothing and draws nothing. */
  | 'NOTHING_REDEEMABLE'
  /**
   * **The one that had no field before MK-048.** The amount falls in the gap: too large to take
   * as a partial without pushing the first eligible Trove's net debt below `minNetDebt`, and too
   * small to consume that Trove whole.
   *
   * Act on it with {@link RedemptionPreview.maxWithoutConsuming} or
   * {@link RedemptionPreview.nextViableAmount}, which are the two edges of the gap.
   */
  | 'PARTIAL_BREACHES_DEBT_FLOOR'

/** Result of {@link previewRedeem}. Raw numbers included so callers render their own copy. */
export interface RedemptionPreview {
  /** True only when a single `redeemCollateral` call would go through. */
  viable: boolean
  /** Every reason it would not, in contract call order. Empty when `viable`. */
  reasons: RedeemBlockReason[]
  /** The constraint that binds first, or `null` when viable. */
  bindingConstraint: RedeemBlockReason | null
  /**
   * What a single call would ACTUALLY redeem, computed by walking the list the way the loop
   * does. Zero when the call would revert.
   *
   * This is NOT `getRedemptionHints`'s `truncatedAmount`, which answers a different question and
   * over-reports in the gap (MK-048).
   */
  redeemable: bigint
  /** The first Trove at or above MCR, which is where the loop starts. `null` when there is none. */
  firstEligibleTrove: Address | null
  /** That Trove's net debt, its entire debt minus the 200 MUSD gas reserve. */
  firstTroveNetDebt: bigint
  /**
   * `firstTroveNetDebt - minNetDebt`, floored at zero. **The largest partial the contract accepts
   * without consuming the Trove**, and the lower edge of the gap.
   */
  maxWithoutConsuming: bigint
  /**
   * **The smallest amount above the gap that works**, which is `firstTroveNetDebt` PLUS
   * {@link accrualMargin} and NOT the net debt itself.
   *
   * At this amount the Trove is consumed whole, which takes a branch with no hint check and no
   * floor check (`TroveManager.sol:1252`). The margin is there because the contract sizes the lot
   * against the debt at EXECUTION, after interest accrues (`:366`, `:1218-1221`), so an offer of
   * exactly the net debt read here arrives as a partial and cancels.
   *
   * **This value has a shelf life of about ten minutes.** The margin is 600 seconds of interest,
   * and it was measured at both ends: a send at this amount succeeds after a 600 second delay and
   * is refused after an hour. Add to it if you expect to be slower; overshooting cannot cost you
   * the call.
   */
  nextViableAmount: bigint
  /**
   * The interest the first eligible Trove accrues in 600 seconds, which is what
   * {@link nextViableAmount} adds on top of the net debt.
   *
   * 600 is the contract's own staleness window for accrual (`TroveManager.sol:1276-1285`). Exposed
   * rather than folded in silently so a caller who needs a different window can scale it: this is
   * 600 seconds of interest, so ten times it is 6000 seconds of interest.
   */
  accrualMargin: bigint
  /** The live `minNetDebt()` floor the cancellation compares against. */
  minNetDebt: bigint
  /** The caller's MUSD balance, which the contract checks at `:320`. */
  musdBalance: bigint
  /** The system TCR, which must be at or above MCR (`:318`). */
  tcr: bigint
  /** BTC/USD used for every number above. */
  price: bigint
}

/** Inputs to {@link previewRedeem}. */
export interface PreviewRedeemParams {
  /** The account that would redeem. Its MUSD balance is the gate at `:320`. */
  redeemer: Address
  /** MUSD to redeem. */
  amount: bigint
  /** Cap on the list walk, matching the contract's own parameter. Default 100. */
  maxIterations?: bigint
}

/** One eligible Trove, as the walk found it. */
export interface EligibleTrove {
  owner: Address
  /** Live entire debt, principal plus accrued interest. Sizes the accrual margin. */
  entireDebt: bigint
  /** Entire debt minus the 200 MUSD gas reserve. */
  netDebt: bigint
}

/** Everything {@link evaluateRedeem} needs, already read from the chain. */
export interface EvaluateRedeemInput {
  amount: bigint
  musdBalance: bigint
  minNetDebt: bigint
  tcr: bigint
  price: bigint
  /** The redeemer's interest rate in basis points, used only to size the accrual margin. */
  interestRateBps: bigint
  /**
   * Eligible Troves in the order the loop visits them, lowest ICR first, with those below MCR
   * already skipped exactly as `:341-349` and `:375-378` skip them.
   */
  eligible: EligibleTrove[]
}

/** The divisor the protocol's interest accrual uses. */
const SECONDS_PER_YEAR = 365n * 24n * 3600n
/** The contract's own allowance for accrual when it bounds a partial hint (`:1276-1285`). */
const ACCRUAL_WINDOW_SECONDS = 600n

/** Interest a Trove accrues over the margin window, at the given rate. */
function marginFor(entireDebt: bigint, interestRateBps: bigint): bigint {
  return (entireDebt * interestRateBps * ACCRUAL_WINDOW_SECONDS) / (10_000n * SECONDS_PER_YEAR)
}

/**
 * The verdict, as a pure function of values already read from the chain.
 *
 * Split out for the same reason every other evaluator is: the decision is the part worth testing
 * exhaustively, and as a pure function it can be, chain free, across the whole gap rather than
 * only the amounts a fork happens to produce.
 */
export function evaluateRedeem(input: EvaluateRedeemInput): RedemptionPreview {
  const { amount, musdBalance, minNetDebt, tcr, price, interestRateBps, eligible } = input

  const first = eligible[0]
  const firstTroveNetDebt = first?.netDebt ?? 0n
  const maxWithoutConsuming = firstTroveNetDebt > minNetDebt ? firstTroveNetDebt - minNetDebt : 0n
  // The Trove owes more by the block this lands in, so consuming it whole costs more than the net
  // debt read here. Without this the upper edge is off by exactly the accrual, and the sweep
  // caught it as a FALSE_VIABLE twice in a thousand cases.
  const accrualMargin = marginFor(first?.entireDebt ?? 0n, interestRateBps)
  const nextViableAmount = firstTroveNetDebt > 0n ? firstTroveNetDebt + accrualMargin : 0n

  const reasons: RedeemBlockReason[] = []
  // In the order `redeemCollateral` checks them (`:318`, `:319`, `:320`), so the binding
  // constraint is the one the chain would report first.
  if (tcr < MCR) reasons.push('SYSTEM_TCR_BELOW_MCR')
  if (amount <= 0n) reasons.push('AMOUNT_ZERO')
  if (musdBalance < amount) reasons.push('INSUFFICIENT_MUSD_BALANCE')
  if (first === undefined) reasons.push('NOTHING_REDEEMABLE')

  // Walk the loop. `mUSDLot = min(remaining, netDebt)` per trove (`:1218-1221`), and a partial
  // that would leave net debt below the floor cancels and BREAKS (`:1299-1306`, `:392`).
  let remaining = amount
  let redeemed = 0n
  let cancelledOnFirst = false
  for (let i = 0; i < eligible.length && remaining > 0n; i++) {
    const trove = eligible[i]
    if (trove === undefined) break
    // Consuming a Trove whole needs its net debt PLUS the margin, because the contract compares
    // against the debt at execution rather than the debt read here. Anything short of that is a
    // partial, and a partial that leaves less than the floor cancels and BREAKS.
    const consumesWhole = remaining >= trove.netDebt + marginFor(trove.entireDebt, interestRateBps)
    const lot = consumesWhole ? trove.netDebt : remaining
    if (!consumesWhole && trove.netDebt - lot < minNetDebt) {
      if (i === 0) cancelledOnFirst = true
      break
    }
    redeemed += lot
    remaining -= lot
  }

  // `require(totals.totalCollateralDrawn > 0)` (`:406-408`): the call reverts only when NOTHING
  // was drawn. A cancel after at least one Trove was redeemed leaves a successful call that
  // simply redeems less, which is why this is checked on the first Trove specifically.
  if (cancelledOnFirst && amount > 0n) reasons.push('PARTIAL_BREACHES_DEBT_FLOOR')

  const viable = reasons.length === 0
  return {
    viable,
    reasons,
    bindingConstraint: reasons[0] ?? null,
    redeemable: viable ? redeemed : 0n,
    firstEligibleTrove: first?.owner ?? null,
    firstTroveNetDebt,
    maxWithoutConsuming,
    nextViableAmount,
    accrualMargin,
    minNetDebt,
    musdBalance,
    tcr,
    price,
  }
}

/**
 * Read the sorted list the way the loop reads it, then decide (MK-048).
 *
 * The walk is bounded by `maxIterations`, matching the contract's own parameter, so a long list
 * cannot turn a preview into an unbounded read. That bound is the same reason `getBorrowingPower`
 * carries one (MK-010).
 */
export async function previewRedeem(
  deps: MathDeps,
  params: PreviewRedeemParams,
): Promise<RedemptionPreview> {
  const { publicClient, addresses } = deps
  const { redeemer, amount } = params
  const maxIterations = params.maxIterations ?? 100n

  const price = await publicClient.readContract({
    address: addresses.priceFeed,
    abi: priceFeedAbi,
    functionName: 'fetchPrice',
  })
  const tm = { address: addresses.troveManager, abi: troveManagerAbi } as const
  const st = { address: addresses.sortedTroves, abi: sortedTrovesAbi } as const

  const [tcr, musdBalance, minNetDebt, interestRateBps] = await Promise.all([
    publicClient.readContract({ ...tm, functionName: 'getTCR', args: [price] }),
    publicClient.readContract({
      address: addresses.musd,
      abi: musdAbi,
      functionName: 'balanceOf',
      args: [redeemer],
    }),
    deps.getMinNetDebt(),
    // The system rate, read off the redeemer's own Trove when there is one. Every Trove in this
    // deployment carries the same rate; this only sizes a safety margin, so the fallback below is
    // the protocol default rather than a computation that could fail the whole preview.
    publicClient
      .readContract({ ...tm, functionName: 'getTroveInterestRate', args: [redeemer] })
      // `uint16` on the ABI, so it arrives as a number and has to be widened deliberately.
      .then((rate) => (BigInt(rate) > 0n ? BigInt(rate) : 100n))
      .catch(() => 100n),
  ])

  // Start at the tail, the lowest ICR, and skip everything under MCR exactly as `:341-349` does.
  let cursor = await publicClient.readContract({ ...st, functionName: 'getLast' })
  const eligible: EligibleTrove[] = []
  const ZERO = '0x0000000000000000000000000000000000000000'
  for (let i = 0n; i < maxIterations && cursor !== ZERO; i++) {
    const [icr, entire] = await Promise.all([
      publicClient.readContract({ ...tm, functionName: 'getCurrentICR', args: [cursor, price] }),
      publicClient.readContract({ ...tm, functionName: 'getEntireDebtAndColl', args: [cursor] }),
    ])
    // `getEntireDebtAndColl` returns (coll, principal, interest, ...), and the loop compares the
    // LIVE entire debt, so principal plus accrued interest is the right quantity here.
    const entireDebt = entire[1] + entire[2]
    if (icr >= MCR) {
      eligible.push({
        owner: cursor,
        entireDebt,
        netDebt: entireDebt > MUSD_GAS_COMPENSATION ? entireDebt - MUSD_GAS_COMPENSATION : 0n,
      })
      // Stop as soon as the accumulated net debt covers the request: nothing beyond it can
      // change the verdict, and every extra step is two more chain reads.
      const total = eligible.reduce((sum, t) => sum + t.netDebt, 0n)
      if (total >= amount) break
    }
    cursor = await publicClient.readContract({ ...st, functionName: 'getPrev', args: [cursor] })
  }

  return evaluateRedeem({
    amount,
    musdBalance,
    minNetDebt,
    tcr,
    price,
    interestRateBps,
    eligible,
  })
}
