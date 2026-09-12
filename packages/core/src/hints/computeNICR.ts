/**
 * NICR fixed-point precision = 1e20 (100 × 1e18). Verified on the fork:
 * `HintHelpers.computeNominalCR(coll, debt) == coll * 1e20 / debt` exactly.
 */
export const NICR_PRECISION = 100_000_000_000_000_000_000n

/** Inputs to {@link computeNICR}: a position's collateral + PRINCIPAL. */
export interface ComputeNICRParams {
  /** Collateral in BTC wei (1e18). */
  collateral: bigint
  /**
   * The position's PRINCIPAL, which is the quantity the sorted list is keyed on. **Not the
   * entire debt** (MK-006, MK-090).
   *
   * Every on-chain insert and re-insert passes a principal-only figure:
   * `_computeNominalCR(vars.newColl, vars.newPrincipal)` on the adjust path
   * (`BorrowerOperations.sol:902-905`) and on refinance (`:1087`), the same on a partial
   * redemption (`TroveManager.sol:1287-1290`), and `getNominalICR` itself reads
   * `Troves[b].principal + pendingPrincipal` (`TroveManager.sol:569-576`). Accrued interest is
   * never part of the key.
   *
   * **At an OPEN the two coincide**, because a new Trove owes no interest yet, so
   * `compositeDebt = draw + fee + 200` IS the principal and `:652` passes it. That coincidence
   * is why the old name here was `entireDebt` and why it read as correct: MK-006 was the same
   * mistake in the write path, and it survived a release because the only gate covering hints
   * covered opens. Passing a live Trove's entire debt produces a NICR below the node's real
   * key, so the hint lands in the wrong neighbourhood and `reInsert` traverses to correct it,
   * which costs gas and on a long list can run out of it.
   */
  principal: bigint
}

/**
 * Nominal collateral ratio used for SortedTroves placement (price-independent):
 * `(collateral × 1e20) / principal`. Mirrors the contract's pure
 * `computeNominalCR` byte-for-byte (`LiquityMath.sol:28-39`, cross-checked in the Phase-3 gate).
 *
 * @throws {RangeError} if `principal <= 0` (no position has zero principal; the
 *   contract would return max-uint, which is meaningless for a hint).
 */
export function computeNICR({ collateral, principal }: ComputeNICRParams): bigint {
  if (principal <= 0n) {
    throw new RangeError('computeNICR: principal must be > 0')
  }
  return (collateral * NICR_PRECISION) / principal
}
