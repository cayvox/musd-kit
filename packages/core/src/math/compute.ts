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
 * The BTC/USD price at which ICR hits MCR = `(MCR × entireDebt) / collateral`.
 * Below this price the position becomes liquidatable. Returns 0 for zero collateral.
 */
export function computeLiquidationPrice({
  collateral,
  entireDebt,
}: ComputeLiquidationPriceParams): bigint {
  if (collateral === 0n) return 0n
  return (MCR * entireDebt) / collateral
}

/**
 * Normalized distance to liquidation: `icr / MCR` as a number (1.0 at MCR). Computed
 * in fixed point first so very large ICRs don't lose precision.
 */
export function getHealthFactor({ icr }: { icr: bigint }): number {
  return Number((icr * 1_000_000n) / MCR) / 1_000_000
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
  const elapsed = BigInt(elapsedSeconds)
  if (elapsed <= 0n) return principal
  const interest = (principal * BigInt(rate) * elapsed) / (BPS_DIVISOR * SECONDS_PER_YEAR)
  return principal + interest
}
