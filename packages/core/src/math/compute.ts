import { BPS_DIVISOR, MCR, MUSD_GAS_COMPENSATION, SECONDS_PER_YEAR } from '../constants'

// Preview-only client-side math: for positions that do NOT exist yet. For a
// live position, read the contract getters via `read/getTrove`. These are pure and
// NON-throwing, they return values/flags, never protocol errors. Every formula is
// dual-validated against forked-Mezo behavior and the contract's pure helpers.

/** Inputs to {@link computeICR}: collateral, entire debt, and a BTC/USD price. */
export interface ComputeICRParams {
  collateral: bigint
  entireDebt: bigint
  /** BTC/USD, 1e18-scaled. */
  price: bigint
}

/**
 * Individual collateral ratio `(collateral × price) / entireDebt` (1e18 fixed point).
 * Mirrors the contract's pure `computeCR` exactly (multiply before divide).
 * Returns `2^256 − 1` for zero debt, matching the contract's "infinite CR" convention.
 */
export function computeICR({ collateral, entireDebt, price }: ComputeICRParams): bigint {
  if (entireDebt === 0n) return (1n << 256n) - 1n
  return (collateral * price) / entireDebt
}

/** Inputs to {@link computeLiquidationPrice}: a position's collateral + entire debt. */
export interface ComputeLiquidationPriceParams {
  collateral: bigint
  entireDebt: bigint
}

/**
 * The BTC/USD price at which ICR hits MCR = `(MCR × entireDebt) / collateral`, floored. Returns 0 for
 * zero collateral.
 *
 * **A threshold to display, read at one block, and not a promise about the price you see** (MK-100,
 * MK-109). Liquidation is `ICR < MCR` (`TroveManager.sol:1146-1148`). When the division is exact the
 * position is not liquidatable at this price and is one wei of price below it. When it is inexact,
 * the floor puts this figure a fraction of a wei under the true threshold, so at exactly this price
 * the position can already be liquidatable. And the entire debt grows every second
 * (`TroveManager.sol:1513-1527`), so the true threshold rises after the read. Show it as the price
 * near which liquidation begins, with the health factor beside it, not as a floor a user may wait for.
 */
export function computeLiquidationPrice({
  collateral,
  entireDebt,
}: ComputeLiquidationPriceParams): bigint {
  if (collateral === 0n) return 0n
  return (MCR * entireDebt) / collateral
}

/** Inputs to {@link isTroveLiquidatable}: a live ICR and, optionally, the system's Trove count. */
export interface IsTroveLiquidatableParams {
  /** `TroveManager.getCurrentICR(borrower, price)`. */
  icr: bigint
  /**
   * `TroveManager.getTroveOwnersCount()`, or `undefined` when it was not read (MK-074).
   *
   * `_liquidate` returns an empty result without liquidating when `TroveOwners.length <= 1`
   * (`TroveManager.sol:1058-1060`), so `batchLiquidateTroves` accumulates nothing and reverts
   * at `:690-693` with "TroveManager: nothing to liquidate". **The last Trove in a system is
   * never liquidatable, whatever its ICR.** Note this is the count ALONE: unlike the close
   * path's `_requireMoreThanOneTroveInSystem` (`:1488-1496`), the liquidation path does not
   * also consult `sortedTroves.getSize()`.
   *
   * `undefined` is "not asked", not "there is more than one", so the condition is skipped.
   */
  troveOwnersCount?: bigint | undefined
}

/**
 * Whether a Trove can actually be liquidated right now (MK-001, MK-074).
 *
 * **One implementation, because two callers ask it**: `read/getTrove.ts` for the `isLiquidatable`
 * field and `read/system.ts` for the standalone predicate. MK-001 was those two disagreeing, and
 * `docs/08-conventions.md` §11 is the rule that says the fix is one copy rather than two that
 * agree today. They both used to inline `icr < MCR`, which is why MK-074's condition had to be
 * added in two places before this existed.
 *
 * `ICR < MCR` in BOTH modes: `TroveManager.sol:1148` is the only ratio gate, and this fork
 * removed stock Liquity's Recovery Mode widening entirely.
 */
export function isTroveLiquidatable({ icr, troveOwnersCount }: IsTroveLiquidatableParams): boolean {
  if (icr >= MCR) return false
  // The last Trove cannot be liquidated even at an ICR of zero.
  if (troveOwnersCount !== undefined && troveOwnersCount <= 1n) return false
  return true
}

/**
 * The ICR {@link computeICR} returns for a position with no debt: the contract's own
 * "infinite CR" convention, `2^256 - 1`.
 */
const INFINITE_ICR = (1n << 256n) - 1n

/**
 * Normalized distance to liquidation: `icr / MCR` as a number (1.0 at MCR). Computed
 * in fixed point first so very large ICRs don't lose precision.
 *
 * MK-017: the zero debt sentinel is handled EXPLICITLY, and this CHANGES the value it returns.
 * `computeICR` returns `2^256 - 1` for zero debt, matching the contract's infinite CR
 * convention. Scaling that by `1_000_000n` and converting to `Number` used to produce
 * `1.0526553567028745e59`, a finite number with no interpretation, which is exactly what the
 * finding means by "loses meaning for a zero debt sentinel ICR". A position with no debt is
 * infinitely far from liquidation, so that is what it says now.
 *
 * The change is confined to callers of this pure helper. `read/getTrove.ts` returns its
 * zero-Trove early when `entireDebt === 0`, with `healthFactor: 0`, so it never passes an
 * infinite ICR here and its output is unaffected.
 */
export function getHealthFactor({ icr }: { icr: bigint }): number {
  if (icr >= INFINITE_ICR) return Number.POSITIVE_INFINITY
  return Number((icr * 1_000_000n) / MCR) / 1_000_000
}

/**
 * The six-tuple `TroveManager.getEntireDebtAndColl` returns, named (MK-094).
 *
 * `(coll, principal, interest, pendingCollateral, pendingPrincipal, pendingInterest)`, read from
 * `TroveManager.sol:767-796`. The stored `interest` already carries live accrual: the getter adds
 * `calculateInterestOwed(principal, trove.interestRate, lastInterestUpdateTime, block.timestamp)`
 * at `:788-793` before returning, which is why every write path can compare against it directly.
 */
export type EntireDebtAndColl = readonly [bigint, bigint, bigint, bigint, bigint, bigint]

/** A Trove's live amounts, with each component named rather than indexed. */
export interface TroveAmounts {
  /**
   * `trove.coll` WITH pending redistribution collateral folded in: the getter adds
   * `getPendingCollateral` before returning (`TroveManager.sol:797`, `:799`). The separate
   * `pendingCollateral` element is the part of this already included, not an addition to it (MK-109).
   */
  collateral: bigint
  /**
   * `trove.principal` with pending redistribution principal folded in (`TroveManager.sol:798`,
   * `:800`). That sum is what `getNominalICR` sorts on (`:566-577`).
   */
  principal: bigint
  /** Stored interest, plus live accrual to this block (`:788-793`), plus pending interest (`:801`). */
  interestOwed: bigint
  /** `principal + interestOwed`, the quantity every ratio gate compares. */
  entireDebt: bigint
}

/**
 * Name the tuple once (MK-094).
 *
 * `entire[1] + entire[2]` appeared at six call sites across `math/` and `trove/`, each
 * one a positional index into a six-tuple with no accessor. They agreed, and nothing made them
 * agree: an upstream reorder of `getEntireDebtAndColl`'s return would have moved all seven
 * silently and identically, which is the failure mode `docs/08-conventions.md` §11 exists to
 * refuse. The ABI is generated, so a reorder is a regeneration away.
 */
export function troveAmounts(edc: EntireDebtAndColl): TroveAmounts {
  const [collateral, principal, interestOwed] = edc
  return { collateral, principal, interestOwed, entireDebt: principal + interestOwed }
}

/**
 * `LiquityBase._getNetDebt`: the entire debt less the gas compensation reserve (MK-094).
 *
 * `_getNetDebt(uint256 _debt) => _debt - MUSD_GAS_COMPENSATION` (`LiquityBase.sol:107-109`). The
 * contract subtracts unchecked and would revert on a Trove holding less than the reserve, which
 * cannot happen for an active Trove; this floors at zero instead, so a preview of an impossible
 * position returns a number rather than throwing.
 *
 * **One copy, because it had ten, in two shapes.** Seven sites floored at zero the way this one
 * does; three in `trove/index.ts` subtracted unguarded. On an active Trove the two agree, since
 * the gas reserve is always part of the debt, so nothing was wrong. They were still two
 * implementations of one line of Solidity, and the only thing keeping them agreeing was that
 * nobody had edited one of them.
 */
export function netDebtOf(entireDebt: bigint): bigint {
  return entireDebt > MUSD_GAS_COMPENSATION ? entireDebt - MUSD_GAS_COMPENSATION : 0n
}

/** Inputs to {@link accruedInterest}: a principal, its rate in bips, and a window. */
export interface AccruedInterestParams {
  /**
   * The stored PRINCIPAL the interest accrues on, not the entire debt.
   *
   * This is the whole point of the function (MK-089). `InterestRateMath.calculateInterestOwed`
   * takes `_principal` (`InterestRateMath.sol:12-22`) and every call site passes
   * `trove.principal`: `TroveManager.getEntireDebtAndColl` at `:788-793` and
   * `_redeemCollateralFromTrove` at `:1236-1241`. Accrued interest is NOT part of the base, so
   * interest does not compound.
   */
  principal: bigint
  /** The rate this position carries, in basis points. Per Trove, never a global. */
  rateBps: bigint
  /** The window, in seconds. Zero or negative accrues nothing. */
  seconds: bigint
}

/**
 * Interest a position accrues over a window, as the protocol computes it (MK-089).
 *
 * `(principal * rateBps * seconds) / (10_000 * SECONDS_PER_YEAR)`, floor divided, mirroring
 * `InterestRateMath.calculateInterestOwed` (`InterestRateMath.sol:12-22`) term for term.
 *
 * **One implementation, because two callers ask it.** {@link computeEntireDebt} projects a
 * position's debt forward, and `math/previewRedeem.ts` sizes the accrual margin that separates
 * the two edges of the redemption gap. Those two used to carry the formula separately and had
 * DIVERGED on the base: one accrued on the principal, the other on the entire debt, which
 * over-states the margin by the interest already owed. `docs/08-conventions.md` §11 is the rule
 * that says the fix is one copy rather than two that agree today; this is that copy, and it is
 * the same shape as {@link isBorrowingFeeCharged} for the fee rule (MK-069).
 *
 * The rate is per Trove. `setTroveInterestRate` is called only at open
 * (`BorrowerOperations.sol:668-672`) and at refinance (`:1075`), each time from the governable
 * `interestRateManager.interestRate()`, so a Trove keeps whatever the global was when it last
 * touched one and two Troves in the same system can carry different rates.
 */
export function accruedInterest({ principal, rateBps, seconds }: AccruedInterestParams): bigint {
  if (seconds <= 0n) return 0n
  return (principal * rateBps * seconds) / (BPS_DIVISOR * SECONDS_PER_YEAR)
}

/** Inputs to {@link computeEntireDebt}: the draw, fee, rate, and elapsed time. */
export interface ComputeEntireDebtParams {
  /** Requested draw (MUSD the borrower receives). */
  draw: bigint
  /** Borrowing fee for the draw (caller reads `getBorrowingFee`; governable). */
  fee: bigint
  /** The Trove's interest rate, in basis points. */
  rate: number
  /** Seconds since the principal was last touched (0 = at open). */
  elapsedSeconds: number | bigint
}

/**
 * Project a position's entire debt with simple (non-compounding), time-based interest
 * (C3). The interest base is the full stored principal `draw + fee + 200` gas reserve,
 * verified on the fork that interest accrues on the composite, not the net draw.
 *
 * `interest = principal · rateBips · elapsed / (10_000 · SECONDS_PER_YEAR)`;
 * `entireDebt = principal + interest`. At open (`elapsedSeconds = 0`) → `draw + fee + 200`.
 *
 * The rate is caller-supplied (the global rate for a new position, or
 * `getTroveInterestRate` for an existing one). The at-open rate-prediction rule
 * (110%-CR max capacity, C4) is out of scope for v1.
 */
export function computeEntireDebt({
  draw,
  fee,
  rate,
  elapsedSeconds,
}: ComputeEntireDebtParams): bigint {
  const principal = draw + fee + MUSD_GAS_COMPENSATION
  // MK-089. Through {@link accruedInterest}, the one copy of the protocol's formula, rather
  // than restating it here. The restatement is how the redemption margin drifted onto a
  // different base without anything noticing.
  return (
    principal +
    accruedInterest({ principal, rateBps: BigInt(rate), seconds: BigInt(elapsedSeconds) })
  )
}

/**
 * `_calculateMaxBorrowingCapacity(coll, price) = coll * price / (110 * 1e16)`
 * (`BorrowerOperations.sol:1323-1328`), the one copy of it (MK-101, `docs/08-conventions.md` §11).
 *
 * **Where the contract WRITES it, which is the part the documentation got wrong.** At open, from the
 * opening price (`:692-699`). On a collateral decrease, as `min(current, recalculated)`
 * (`:879-897`), the only place it ratchets. And on EVERY refinance, unconditionally, from the price
 * at the refinance (`:1077-1084`): a refinance after a price rise raises it, and after a fall cuts
 * it, with no collateral change at all.
 */
export function maxBorrowingCapacityAt(collateral: bigint, price: bigint): bigint {
  return (collateral * price) / (110n * 10n ** 16n)
}
