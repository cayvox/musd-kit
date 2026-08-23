/**
 * When the borrowing fee is actually charged, in one place (MK-004, MK-018).
 *
 * The contract applies the same two conditions everywhere it charges the fee:
 *
 *   - on open, `!isRecoveryMode && !isAccountFeeExempt(borrower)`
 *     (`BorrowerOperations.sol:637-643`);
 *   - on a debt increase, the same pair (`:810-818`);
 *   - on refinance, exemption alone, because the whole path already requires normal mode
 *     (`:1024`, `:1034-1036`).
 *
 * Kept as one exported pure function so the rule lives in a single place, is testable
 * without a chain, and cannot drift between the preview and the write path.
 */
export function isBorrowingFeeCharged(isRecoveryMode: boolean, feeExempt: boolean): boolean {
  return !isRecoveryMode && !feeExempt
}

/**
 * The fee the contract will actually charge: `quotedFee` when it applies, otherwise zero.
 *
 * `quotedFee` is whatever `getBorrowingFee` returned for the amount in question. Callers
 * that would rather not pay for that read at all can check
 * {@link isBorrowingFeeCharged} first.
 */
export function effectiveBorrowingFee(
  quotedFee: bigint,
  isRecoveryMode: boolean,
  feeExempt: boolean,
): bigint {
  return isBorrowingFeeCharged(isRecoveryMode, feeExempt) ? quotedFee : 0n
}

/**
 * Collateral a redemption is expected to draw, in BTC wei, from the MUSD it will actually
 * redeem (MK-014).
 *
 * `getRedemptionRate` takes COLLATERAL DRAWN, not a MUSD amount
 * (`BorrowerOperations.sol:499-508`), so the MUSD figure has to be converted before the fee
 * amount can be estimated. Returns zero for a zero or missing price rather than dividing by
 * it; an estimate of zero is honest, a division by zero is a crash.
 */
export function estimateCollateralDrawn(truncatedAmount: bigint, price: bigint): bigint {
  if (price <= 0n) return 0n
  return (truncatedAmount * 10n ** 18n) / price
}

/**
 * Whether an SDK side redemption rate cap is breached.
 *
 * Rate against rate, deliberately: comparing the fee AMOUNT from `getRedemptionRate` against
 * a 1e18 scaled fraction would be a unit error. Returns false when no cap was supplied.
 *
 * This is advisory only. `redeemCollateral` takes no fee cap parameter at all
 * (`TroveManager.sol:294-301`), so nothing on chain enforces it (MK-011).
 */
export function exceedsRateCap(rate: bigint, maxFeePercentage: bigint | undefined): boolean {
  return maxFeePercentage !== undefined && rate > maxFeePercentage
}
