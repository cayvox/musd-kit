import type { Address } from 'viem'
import {
  interestRateManagerAbi,
  musdAbi,
  priceFeedAbi,
  sortedTrovesAbi,
  troveManagerAbi,
} from '../clients'
import { MCR } from '../constants'
import { InvalidAmount } from '../errors'
import { withTypedErrors } from '../errors/mapRevert'
import { accruedInterest, netDebtOf, troveAmounts } from './compute'
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
   * **This value has a shelf life of about ten minutes.** The margin is 900 seconds of interest
   * and the claim is 600, and it is measured at both ends: a send at this amount succeeds after a
   * 600 second delay and is refused after an hour. Add to it if you expect to be slower;
   * overshooting cannot cost you the call.
   */
  nextViableAmount: bigint
  /**
   * The interest the first eligible Trove accrues in **900 seconds**, at its OWN rate and on its
   * OWN principal, which is what {@link nextViableAmount} adds on top of the net debt.
   *
   * Sized for 900 while the answer is advertised as good for 600, because the accrual that has to
   * be covered runs from the block this was READ at to the block the transaction SETTLES in, and
   * a caller cannot make those the same block (MK-095). Exposed rather than folded in silently so
   * a caller who needs a different window can scale it: this is 900 seconds of interest, so four
   * times it is an hour of interest.
   */
  accrualMargin: bigint
  /**
   * The partial this redemption ends on, or `null` when every Trove it touches is consumed whole
   * (MK-103). **A partial is priced twice**: when its hint is read and when it mines, and the
   * contract cancels it when the price has moved further than a very narrow band allows. Read
   * {@link PartialRedemption.priceFragile} before sending one.
   */
  partial: PartialRedemption | null
  /** The live `minNetDebt()` floor the cancellation compares against. */
  minNetDebt: bigint
  /** The caller's MUSD balance, which the contract checks at `:320`. */
  musdBalance: bigint
  /** The system TCR, which must be at or above MCR (`:318`). */
  tcr: bigint
  /** BTC/USD used for every number above. */
  price: bigint
}

/**
 * The move, as a 1e18 fraction of the price, a partial redemption has to tolerate in EACH
 * direction before this SDK calls it survivable (MK-103). **5 basis points.**
 *
 * Measured, not chosen: `scripts/oracle-moves.ts --end 11823000 --consecutive 2000` over Mezo
 * mainnet blocks 11821000 to 11823000 put the 99th percentile of a TWO block move at 4.13 bps up
 * and 3.87 bps down. Two blocks, because the hint is read at the head and the transaction mines one
 * or two blocks later at about 3.83 seconds a block. 5 bps covers both, rounded up.
 */
export const REDEMPTION_PRICE_MOVE_TOLERANCE = 5n * 10n ** 14n

/**
 * One partial redemption, and the contract's band for it (MK-103).
 *
 * **What cancels a partial.** `_redeemCollateralFromTrove` computes the Trove's resulting NICR at
 * the price when the transaction MINES (`TroveManager.sol:1224-1230`, `:1287-1290`) and cancels
 * the partial unless `newNICR <= hint <= upperBoundNICR` (`:1299-1306`). The upper bound differs
 * from `newNICR` only by 600 seconds of interest at the GLOBAL rate on the Trove's principal
 * (`:1276-1285`), a relative width of about `rate * 600 / year`, 1.9e-7 at 1%. A price rise lowers
 * the collateral drawn and lifts `newNICR` above the hint; a fall lowers the upper bound under it.
 * A cancel on the FIRST Trove drawn reverts the whole call (`:392`, `:406-408`); a cancel later
 * just redeems less.
 *
 * **What the SDK does about it.** It sends the CENTRE of the band as the hint, where
 * `getRedemptionHints` returns its lower edge (`HintHelpers.sol:143-160`), which tolerated no rise at
 * all. And it reports how far the price can move each way, so a caller can see that the band is
 * narrow by construction: the tolerated move scales with `remaining collateral / collateral drawn`,
 * so only a partial that draws a very small share of the Trove survives an ordinary block move.
 */
export interface PartialRedemption {
  /** The Trove the partial lands on. */
  trove: Address
  /** MUSD the partial takes from it. */
  lot: bigint
  /** `true` when it is the first Trove drawn, where a cancel reverts the whole call. */
  revertsCallIfCancelled: boolean
  /** The NICR hint the SDK sends: the centre of `[newNICR, upperBoundNICR]` at `price`. */
  hintNicr: bigint
  /** The largest price RISE, as a 1e18 fraction of `price`, the partial survives with that hint. */
  priceToleranceUp: bigint
  /** The largest price FALL, as a 1e18 fraction of `price`, the partial survives with that hint. */
  priceToleranceDown: bigint
  /**
   * `true` when either tolerance is below {@link REDEMPTION_PRICE_MOVE_TOLERANCE}, the measured
   * two block move. **A fragile partial that `revertsCallIfCancelled` mostly reverts**, and
   * `redeem()` refuses to send it unless told to (`acceptPriceFragilePartial`).
   */
  priceFragile: boolean
}

/** Inputs to {@link previewRedeem}. */
export interface PreviewRedeemParams {
  /** The account that would redeem. Its MUSD balance is the gate at `:320`. */
  redeemer: Address
  /** MUSD to redeem. */
  amount: bigint
  /**
   * Cap on the eligible Troves the walk visits, read exactly as the contract reads its own
   * `_maxIterations`. Default {@link DEFAULT_REDEMPTION_MAX_ITERATIONS}, 100.
   *
   * **`0n` means no limit** (MK-114), because that is what `redeemCollateral` and
   * `getRedemptionHints` do with zero (`TroveManager.sol:353-355`, `HintHelpers.sol:107-109`). The
   * walk still stops as soon as the eligible Troves it has read cover `amount`, or at the end of
   * the list, so no limit costs as many reads as the request needs and no more. Troves below MCR
   * are skipped without counting, as the contract skips them (MK-107).
   *
   * @throws {InvalidAmount} when negative or above the largest `uint256`: the contract takes a `uint256`, so
   *   no such value can be sent.
   */
  maxIterations?: bigint
  /**
   * The accrual window, in seconds, a WHOLE consumption is sized for. Default
   * {@link REDEMPTION_ADVICE_MARGIN_SECONDS}, 900, which is what {@link RedemptionPreview.nextViableAmount}
   * carries. `redeem()` checks with {@link REDEMPTION_SEND_MARGIN_SECONDS}, 60, so advice read here
   * is not refused by the client that acts on it (MK-104).
   */
  marginSeconds?: bigint
}

/** One eligible Trove, as the walk found it. */
export interface EligibleTrove {
  owner: Address
  /** Live entire debt, principal plus accrued interest. */
  entireDebt: bigint
  /**
   * The stored principal, which is the base the protocol accrues interest on (MK-088).
   *
   * `_redeemCollateralFromTrove` sizes its lot against `_getTotalDebt(_borrower)` read at
   * EXECUTION (`TroveManager.sol:1218-1221`), and the growth between this read and that block
   * is `calculateInterestOwed(trove.principal, trove.interestRate, ...)` (`:1236-1241`). Both
   * arguments belong to THIS Trove, so both are carried here.
   */
  principal: bigint
  /** Entire debt minus the 200 MUSD gas reserve. */
  netDebt: bigint
  /** Collateral with pending redistribution folded in, as `getEntireDebtAndColl` returns it (MK-103). */
  collateral: bigint
  /** Interest owed with live accrual and pending interest, the second debt component (MK-103). */
  interestOwed: bigint
  /**
   * `getTroveInterestRate(owner)`, in basis points. **This Trove's rate, not a global and not
   * the redeemer's** (MK-088).
   *
   * A Trove's rate is frozen at open (`BorrowerOperations.sol:668-672`) and at refinance
   * (`:1075`) from the governable `interestRateManager.interestRate()`, so two Troves in one
   * system carry different rates whenever governance has moved it between their opens.
   */
  interestRateBps: bigint
}

/** Everything {@link evaluateRedeem} needs, already read from the chain. */
export interface EvaluateRedeemInput {
  amount: bigint
  musdBalance: bigint
  minNetDebt: bigint
  tcr: bigint
  price: bigint
  /**
   * Eligible Troves in the order the loop visits them, lowest ICR first, with those below MCR
   * already skipped exactly as `:341-349` and `:375-378` skip them.
   */
  eligible: EligibleTrove[]
  /** `interestRateManager.interestRate()`, which the contract's hint band uses (`:358`, `:1281`). */
  globalInterestRateBps: bigint
  /** Whole consumption margin in seconds. Default {@link REDEMPTION_ADVICE_MARGIN_SECONDS} (MK-104). */
  marginSeconds?: bigint
}

// MK-071, then MK-089. The formula is not restated here AT ALL any more. It used to shadow
// `SECONDS_PER_YEAR` with 31_536_000 (MK-071), and after that was fixed it still carried its
// own copy of the arithmetic on the wrong base: `entireDebt` where the protocol accrues on
// `trove.principal` (`InterestRateMath.sol:12-22`, called with `trove.principal` at
// `TroveManager.sol:788-793` and `:1236-1241`). One copy now, in `math/compute.ts`.
/**
 * The window {@link RedemptionPreview.nextViableAmount} is sized for, in seconds (MK-095).
 *
 * **The advertised window is 600 seconds and the margin is sized for 900**, and the 300 second
 * difference is deliberate rather than a number chosen to feel safe. The quantity the margin has
 * to cover is the accrual between the block the preview READ at and the block the transaction
 * SETTLES in. A caller cannot make that second block the first one: a transaction is always mined
 * after it is priced. Sizing the margin for exactly the advertised window therefore leaves zero
 * slack for the settlement block itself, and the amount is short by whatever the Trove accrued in
 * it.
 *
 * **Measured, on the fork, at the moment the base was corrected.** Until MK-089 this margin
 * accrued on the entire debt where the protocol accrues on the principal
 * (`InterestRateMath.sol:12-22`), which over-stated it by the interest already owed. On the
 * `redeem-boundary.fork.test.ts` fixture that was about 1 percent, worth roughly 6 seconds of
 * accrual, and **that accident was what had been covering the settlement block**: correcting the
 * base to the contract's quantity turned the 600 second row of the ladder from `send=success` to
 * `send=reverted` with nothing else changed. A guarantee resting on an over-estimate nobody had
 * named is not a guarantee.
 *
 * 900 covers the advertised 600 plus five minutes of settlement. The upper bound is still
 * asserted: the ladder requires the margin to FAIL at 3600 seconds, so this is a bounded claim
 * and not an ever growing cushion.
 *
 * The contract's own 600 (`TroveManager.sol:1276-1285`) bounds the staleness of a partial
 * redemption HINT, which is a different quantity from a caller's settlement delay. Reading one as
 * the other is what produced the original figure.
 */
export const REDEMPTION_ADVICE_MARGIN_SECONDS = 900n

/**
 * The whole consumption margin `redeem()` checks with, in seconds (MK-104).
 *
 * **Why it is not the advice margin.** `nextViableAmount` already carries 900 seconds of accrual
 * from the block it was READ at. `redeem()` re-reads the Trove one block or more later and used to
 * add the full 900 again, on a net debt that had grown in between, so it refused its own advice a
 * block after giving it while the chain accepted the amount. The sending check only has to cover
 * the gap between ITS read and inclusion. 60 seconds is fifteen blocks at the measured 3.83 seconds
 * a block (`scripts/oracle-moves.ts`). The advice therefore stays acceptable to `redeem()` for
 * 900 minus 60, 840 seconds, which covers the 600 it is advertised for.
 */
export const REDEMPTION_SEND_MARGIN_SECONDS = 60n

/**
 * The walk bound a redemption uses when the caller names none, shared by {@link previewRedeem} and
 * `redeem()` so the preview and the write cannot default to different walks (MK-114).
 */
export const DEFAULT_REDEMPTION_MAX_ITERATIONS = 100n

const MAX_UINT256 = (1n << 256n) - 1n

/**
 * Refuse a `maxIterations` the contract cannot be sent (MK-114). Zero is NOT refused: it is the
 * contract's own spelling of no limit, and both the preview and the write read it that way.
 */
export function assertMaxIterations(maxIterations: bigint): void {
  if (maxIterations < 0n || maxIterations > MAX_UINT256) {
    throw new InvalidAmount(
      'maxIterations',
      maxIterations,
      'Must be a uint256: 0 for no limit, or the number of eligible Troves to visit.',
    )
  }
}

/** The window a caller is told the answer holds for, which is shorter than it is sized for. */
export const REDEMPTION_MARGIN_WINDOW_SECONDS = 600n

/**
 * Interest ONE Trove accrues over the margin window, at ITS OWN rate (MK-088, MK-089).
 *
 * Both arguments come from the Trove the lot is sized against. Before MK-088 this took a
 * single rate read off the REDEEMER's Trove, applied to every Trove in the walk, with a
 * hardcoded `100n` when the redeemer held no Trove, which is the ordinary case for the
 * arbitrageur this preview exists for.
 */
function marginFor(
  trove: Pick<EligibleTrove, 'principal' | 'interestRateBps'>,
  seconds: bigint,
): bigint {
  return accruedInterest({ principal: trove.principal, rateBps: trove.interestRateBps, seconds })
}

const NICR_PRECISION = 10n ** 20n
const E18 = 10n ** 18n
const nominalCr = (coll: bigint, principal: bigint) =>
  principal > 0n ? (coll * NICR_PRECISION) / principal : (1n << 256n) - 1n
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b

/**
 * The contract's band for one partial, restated term for term from `_redeemCollateralFromTrove`
 * (`TroveManager.sol:1216-1290`) at the state the preview read, with the Trove's interest already
 * brought current, which is what `_updateTroveInterest` does first (`:366`).
 *
 * Exported for the unit pins, which check it against an independent restatement.
 */
export function partialRedemptionBand(input: {
  trove: EligibleTrove
  lot: bigint
  price: bigint
  globalInterestRateBps: bigint
  revertsCallIfCancelled: boolean
}): PartialRedemption {
  const { trove, lot, price, globalInterestRateBps, revertsCallIfCancelled } = input
  // `:1224-1226`, `:1230`
  const collateralLot = (lot * E18) / price
  const newColl = trove.collateral - collateralLot
  // `:1234-1247`: the lot pays interest first, then principal.
  const newPrincipal =
    lot > trove.interestOwed ? trove.principal - (lot - trove.interestOwed) : trove.principal
  // `:1276-1285`: 600 seconds at the GLOBAL rate on the PRE redemption principal.
  const band = accruedInterest({
    principal: trove.principal,
    rateBps: globalInterestRateBps,
    seconds: 600n,
  })
  const low = nominalCr(newColl, newPrincipal)
  const high = nominalCr(newColl, newPrincipal - band)
  const hintNicr = (low + high) / 2n

  // Invert both inequalities for the collateral drawn at an unknown execution price `p`:
  //   floor(newColl' * 1e20 / newPrincipal) <= hint   <=>  newColl' <= ceil((hint + 1) * P / 1e20) - 1
  //   floor(newColl' * 1e20 / (P - band)) >= hint     <=>  newColl' >= ceil(hint * (P - band) / 1e20)
  // and `collateralLot' = floor(lot * 1e18 / p)` falls as `p` rises.
  const maxColl = ceilDiv((hintNicr + 1n) * newPrincipal, NICR_PRECISION) - 1n
  const minColl = ceilDiv(hintNicr * (newPrincipal - band), NICR_PRECISION)
  const lotAtLeast = trove.collateral - maxColl
  const lotAtMost = trove.collateral - minColl
  const priceHigh = lotAtLeast > 0n ? (lot * E18) / lotAtLeast : (1n << 256n) - 1n
  const priceLow = (lot * E18) / (lotAtMost + 1n) + 1n
  const priceToleranceUp = priceHigh > price ? ((priceHigh - price) * E18) / price : 0n
  const priceToleranceDown = price > priceLow ? ((price - priceLow) * E18) / price : 0n

  return {
    trove: trove.owner,
    lot,
    revertsCallIfCancelled,
    hintNicr,
    priceToleranceUp,
    priceToleranceDown,
    priceFragile:
      priceToleranceUp < REDEMPTION_PRICE_MOVE_TOLERANCE ||
      priceToleranceDown < REDEMPTION_PRICE_MOVE_TOLERANCE,
  }
}

/**
 * The verdict, as a pure function of values already read from the chain.
 *
 * Split out for the same reason every other evaluator is: the decision is the part worth testing
 * exhaustively, and as a pure function it can be, chain free, across the whole gap rather than
 * only the amounts a fork happens to produce.
 */
export function evaluateRedeem(input: EvaluateRedeemInput): RedemptionPreview {
  const { amount, musdBalance, minNetDebt, tcr, price, eligible } = input
  const marginSeconds = input.marginSeconds ?? REDEMPTION_ADVICE_MARGIN_SECONDS

  const first = eligible[0]
  const firstTroveNetDebt = first?.netDebt ?? 0n
  const maxWithoutConsuming = firstTroveNetDebt > minNetDebt ? firstTroveNetDebt - minNetDebt : 0n
  // The Trove owes more by the block this lands in, so consuming it whole costs more than the net
  // debt read here. Without this the upper edge is off by exactly the accrual, and the sweep
  // caught it as a FALSE_VIABLE twice in a thousand cases.
  const accrualMargin =
    first === undefined ? 0n : marginFor(first, REDEMPTION_ADVICE_MARGIN_SECONDS)
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
  let partial: PartialRedemption | null = null
  for (let i = 0; i < eligible.length && remaining > 0n; i++) {
    const trove = eligible[i]
    if (trove === undefined) break
    // Consuming a Trove whole needs its net debt PLUS the margin, because the contract compares
    // against the debt at execution rather than the debt read here. Anything short of that is a
    // partial, and a partial that leaves less than the floor cancels and BREAKS.
    const consumesWhole = remaining >= trove.netDebt + marginFor(trove, marginSeconds)
    const lot = consumesWhole ? trove.netDebt : remaining
    if (!consumesWhole && trove.netDebt - lot < minNetDebt) {
      if (i === 0) cancelledOnFirst = true
      break
    }
    if (!consumesWhole) {
      partial = partialRedemptionBand({
        trove,
        lot,
        price,
        globalInterestRateBps: input.globalInterestRateBps,
        revertsCallIfCancelled: i === 0,
      })
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
    partial: viable ? partial : null,
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
 *
 * **Not a single block snapshot**: the price is read outside the batch that uses it. The full
 * statement is on `MathDeps` in `math/deps.ts` (MK-013, MK-093).
 */
export async function previewRedeem(
  deps: MathDeps,
  params: PreviewRedeemParams,
): Promise<RedemptionPreview> {
  return withTypedErrors(() => previewRedeemUnchecked(deps, params), { operation: 'previewRedeem' })
}

async function previewRedeemUnchecked(
  deps: MathDeps,
  params: PreviewRedeemParams,
): Promise<RedemptionPreview> {
  const { publicClient, addresses } = deps
  const { redeemer, amount } = params
  const maxIterations = params.maxIterations ?? DEFAULT_REDEMPTION_MAX_ITERATIONS
  assertMaxIterations(maxIterations)

  const price = await publicClient.readContract({
    address: addresses.priceFeed,
    abi: priceFeedAbi,
    functionName: 'fetchPrice',
  })
  const tm = { address: addresses.troveManager, abi: troveManagerAbi } as const
  const st = { address: addresses.sortedTroves, abi: sortedTrovesAbi } as const

  const [tcr, musdBalance, minNetDebt, globalRate] = await Promise.all([
    publicClient.readContract({ ...tm, functionName: 'getTCR', args: [price] }),
    publicClient.readContract({
      address: addresses.musd,
      abi: musdAbi,
      functionName: 'balanceOf',
      args: [redeemer],
    }),
    deps.getMinNetDebt(),
    // MK-103. The hint band is 600 seconds of interest at the GLOBAL rate (`TroveManager.sol:358`).
    publicClient.readContract({
      address: addresses.interestRateManager,
      abi: interestRateManagerAbi,
      functionName: 'interestRate',
    }),
  ])

  // Start at the tail, the lowest ICR, and skip everything under MCR exactly as `:341-349` does.
  let cursor = await publicClient.readContract({ ...st, functionName: 'getLast' })
  const eligible: EligibleTrove[] = []
  const ZERO = '0x0000000000000000000000000000000000000000'
  // MK-107. The contract skips the sub-MCR Troves at the tail BEFORE its loop and without touching
  // `_maxIterations` (`TroveManager.sol:338-350`); only iterations inside the loop count (`:360-365`).
  // This walk used to count them, so a small `maxIterations` reported NOTHING_REDEEMABLE for a
  // redemption the chain accepts. `started` is false until the first eligible Trove is found.
  //
  // MK-114. Zero is no limit, because the contract replaces it with `type(uint256).max` before its
  // loop (`TroveManager.sol:353-355`). This walk used to compare `i < 0n`, so it stopped after the
  // first eligible Trove and reported less than the chain redeems.
  let started = false
  const unbounded = maxIterations === 0n
  for (let i = 0n; (!started || unbounded || i < maxIterations) && cursor !== ZERO; ) {
    const [icr, entire, rate] = await Promise.all([
      publicClient.readContract({ ...tm, functionName: 'getCurrentICR', args: [cursor, price] }),
      publicClient.readContract({ ...tm, functionName: 'getEntireDebtAndColl', args: [cursor] }),
      // MK-088. THIS Trove's rate, in the SAME batch as its debt, because the margin is that
      // Trove's own accrual.
      //
      // The cost, stated rather than left to be discovered: this fires for every Trove the walk
      // VISITS, including the sub-MCR ones it skips, so it is three requests per iteration where
      // there were two and **no additional round trip**, since they are concurrent. Reading it
      // only for eligible Troves would trade that for a sequential round trip per eligible
      // Trove, and round trips are the quantity MK-010 is about.
      //
      // It is deliberately NOT wrapped in a `catch`: a read that fails must fail the preview
      // rather than become a plausible default (MK-012's lesson, and the rule `constants.ts:1-4`
      // states for every governable value).
      publicClient.readContract({ ...tm, functionName: 'getTroveInterestRate', args: [cursor] }),
    ])
    // `getEntireDebtAndColl` returns (coll, principal, interest, ...), and the loop compares the
    // LIVE entire debt, so principal plus accrued interest is the right quantity here.
    const { collateral, principal, interestOwed, entireDebt } = troveAmounts(entire)
    if (icr >= MCR) started = true
    if (started) i++
    if (icr >= MCR) {
      eligible.push({
        owner: cursor,
        entireDebt,
        collateral,
        interestOwed,
        // The base the protocol accrues on (`InterestRateMath.sol:12-22`), which is the stored
        // principal alone and never the entire debt.
        principal,
        netDebt: netDebtOf(entireDebt),
        // `uint16` on the ABI, so it arrives as a number and is widened deliberately.
        interestRateBps: BigInt(rate),
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
    eligible,
    globalInterestRateBps: BigInt(globalRate),
    ...(params.marginSeconds !== undefined ? { marginSeconds: params.marginSeconds } : {}),
  })
}
