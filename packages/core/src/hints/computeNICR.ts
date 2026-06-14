/**
 * NICR fixed-point precision = 1e20 (100 × 1e18). Verified on the fork:
 * `HintHelpers.computeNominalCR(coll, debt) == coll * 1e20 / debt` exactly.
 */
export const NICR_PRECISION = 100_000_000_000_000_000_000n

export interface ComputeNICRParams {
  /** Collateral in BTC wei (1e18). */
  collateral: bigint
  /** The position's ENTIRE debt (e.g. for an open: draw + fee + 200). */
  entireDebt: bigint
}

/**
 * Nominal collateral ratio used for SortedTroves placement (price-independent):
 * `(collateral × 1e20) / entireDebt`. Mirrors the contract's pure
 * `computeNominalCR` byte-for-byte (cross-checked in the Phase-3 gate).
 *
 * @throws {RangeError} if `entireDebt <= 0` (no position has zero debt; the
 *   contract would return max-uint, which is meaningless for a hint).
 */
export function computeNICR({ collateral, entireDebt }: ComputeNICRParams): bigint {
  if (entireDebt <= 0n) {
    throw new RangeError('computeNICR: entireDebt must be > 0')
  }
  return (collateral * NICR_PRECISION) / entireDebt
}
