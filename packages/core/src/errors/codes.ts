/**
 * The discriminant for every SDK error. These string values are a STABLE PUBLIC API:
 * adding a code is a minor change; renaming or removing one is a breaking change (semver).
 * Consumers branch on `error.code` in a switch, or on `error instanceof <Subclass>`.
 */
export const MusdErrorCode = {
  //, Validation / preview-time (thrown before sending, fail fast),
  BELOW_MINIMUM_DEBT: 'BELOW_MINIMUM_DEBT',
  MAX_FEE_EXCEEDED: 'MAX_FEE_EXCEEDED',
  INSUFFICIENT_COLLATERAL: 'INSUFFICIENT_COLLATERAL',
  TROVE_NOT_FOUND: 'TROVE_NOT_FOUND',
  TROVE_ALREADY_EXISTS: 'TROVE_ALREADY_EXISTS',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  INVALID_ADJUSTMENT: 'INVALID_ADJUSTMENT',
  EXCEEDS_BORROWING_CAPACITY: 'EXCEEDS_BORROWING_CAPACITY',
  SYSTEM_RATIO_BELOW_CCR: 'SYSTEM_RATIO_BELOW_CCR',
  COLLATERAL_WITHDRAWAL_BLOCKED: 'COLLATERAL_WITHDRAWAL_BLOCKED',
  REDEMPTION_BREACHES_DEBT_FLOOR: 'REDEMPTION_BREACHES_DEBT_FLOOR',

  //, Protocol reverts (mapped from on-chain revert data, see ground-truth §11),
  ICR_BELOW_MCR: 'ICR_BELOW_MCR',
  RECOVERY_MODE_RESTRICTION: 'RECOVERY_MODE_RESTRICTION',
  REPAY_EXCEEDS_DEBT: 'REPAY_EXCEEDS_DEBT',
  STALE_HINT: 'STALE_HINT',
  INSUFFICIENT_MUSD_BALANCE: 'INSUFFICIENT_MUSD_BALANCE',
  NOTHING_TO_LIQUIDATE: 'NOTHING_TO_LIQUIDATE',
  REDEMPTION_FAILED: 'REDEMPTION_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',

  //, Infrastructure,
  UNSUPPORTED_CHAIN: 'UNSUPPORTED_CHAIN',
  INVALID_ADDRESS_OVERRIDE: 'INVALID_ADDRESS_OVERRIDE',
  MISMATCHED_DEPLOYMENT: 'MISMATCHED_DEPLOYMENT',
  DEPLOYMENT_VERIFICATION_FAILED: 'DEPLOYMENT_VERIFICATION_FAILED',
  MISSING_WALLET_CLIENT: 'MISSING_WALLET_CLIENT',
  CONTRACT_CALL_FAILED: 'CONTRACT_CALL_FAILED',
} as const

/** Union of every stable error code. */
export type MusdErrorCode = (typeof MusdErrorCode)[keyof typeof MusdErrorCode]

/** Every code value, for exhaustive tests / consumers that enumerate the taxonomy. */
export const ALL_MUSD_ERROR_CODES = Object.values(MusdErrorCode) as readonly MusdErrorCode[]
