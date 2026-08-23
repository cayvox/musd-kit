// errors/, the full discriminated taxonomy (docs/06-errors.md), consolidating the
// minimal subsets shipped in Phases 1/5/6. `musd-kit` never throws raw strings: every
// protocol revert and every SDK-side guard is a named `MusdError` with a stable `code`,
// the original viem/contract error preserved in `cause`, and structured `context`
//. Branch by `instanceof` or by `code`.
//
// The revert→error mapping (the ONE decoder) lives in `./mapRevert`; the corpus of real
// revert strings it matches is `docs/01-ground-truth.md` §11.

import { MusdErrorCode as Codes, type MusdErrorCode } from './codes'

export { MusdErrorCode, ALL_MUSD_ERROR_CODES } from './codes'
export { mapRevert } from './mapRevert'

/**
 * Base for every SDK error: a discriminated `code`, the original cause preserved, and
 * optional structured context. Branch by `instanceof` or by `code`.
 */
export class MusdError extends Error {
  readonly code: MusdErrorCode
  readonly context: Record<string, unknown> | undefined

  constructor(
    code: MusdErrorCode,
    message: string,
    options?: { cause?: unknown; context?: Record<string, unknown> },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'MusdError'
    this.code = code
    this.context = options?.context
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Validation / preview-time (thrown before sending, fail fast)
// ─────────────────────────────────────────────────────────────────────────────

/** `draw + borrowingFee` is below the (governable) `minNetDebt` floor. */
export class BelowMinimumDebt extends MusdError {
  constructor(minNetDebt: bigint, netDebt: bigint, cause?: unknown) {
    super(
      Codes.BELOW_MINIMUM_DEBT,
      `Net debt (${netDebt}) is below the minimum (${minNetDebt}). The floor applies to draw + borrowing fee.`,
      { context: { minNetDebt, netDebt }, ...(cause !== undefined ? { cause } : {}) },
    )
    this.name = 'BelowMinimumDebt'
  }
}

/**
 * A debt increase the contract's borrowing capacity gate would reject (MK-002).
 *
 * Every Trove carries a `maxBorrowingCapacity`, fixed at open from the OPENING price as
 * `coll * price / (110 * 1e16)` (`BorrowerOperations.sol:1323-1328`), ratcheted only
 * DOWNWARD on a collateral decrease (`:879-897`), and never raised when the price rises.
 * A debt increase requires `maxBorrowingCapacity >= netDebtChange + debt`
 * (`:1358-1365`), where `netDebtChange` is the draw plus its borrowing fee and `debt` is
 * the Trove's debt AFTER `updateSystemAndTroveInterest`, so accrued interest counts.
 */
export class ExceedsBorrowingCapacity extends MusdError {
  constructor(
    capacity: bigint,
    entireDebt: bigint,
    netDebtChange: bigint,
    remaining: bigint,
    cause?: unknown,
  ) {
    super(
      Codes.EXCEEDS_BORROWING_CAPACITY,
      `Borrowing ${netDebtChange} (draw plus fee) against a debt of ${entireDebt} would need ${entireDebt + netDebtChange} of capacity, but the Trove's maxBorrowingCapacity is ${capacity}, leaving ${remaining}. Capacity is fixed at the opening price and never rises, so a higher collateral price does not raise it.`,
      {
        context: { capacity, entireDebt, netDebtChange, remaining },
        ...(cause !== undefined ? { cause } : {}),
      },
    )
    this.name = 'ExceedsBorrowingCapacity'
  }
}

/** The SDK-side fee guard (C5, there is no on-chain `maxFeePercentage`). */
export class MaxFeeExceeded extends MusdError {
  constructor(maxFeePercentage: bigint, actualFee: bigint, actualFeePercentage: bigint) {
    super(
      Codes.MAX_FEE_EXCEEDED,
      `Borrowing fee (${actualFeePercentage} of 1e18) exceeds the supplied cap (${maxFeePercentage} of 1e18).`,
      { context: { maxFeePercentage, actualFee, actualFeePercentage } },
    )
    this.name = 'MaxFeeExceeded'
  }
}

/**
 * The resulting ICR would fall below MCR. Preview-time sibling of {@link ICRBelowMCR}:
 * the on-chain write path surfaces `ICRBelowMCR` (contract-authoritative); this is
 * for the math/React preview layer, which knows the ICR before sending.
 */
export class InsufficientCollateral extends MusdError {
  constructor(icr: bigint, mcr: bigint) {
    super(
      Codes.INSUFFICIENT_COLLATERAL,
      `Resulting ICR (${icr}) would be below MCR (${mcr}), add collateral or reduce debt.`,
      { context: { icr, mcr } },
    )
    this.name = 'InsufficientCollateral'
  }
}

/** Operating on an address with no open Trove. */
export class TroveNotFound extends MusdError {
  constructor(address: string, cause?: unknown) {
    super(Codes.TROVE_NOT_FOUND, `No open Trove for ${address}.`, {
      context: { address },
      ...(cause !== undefined ? { cause } : {}),
    })
    this.name = 'TroveNotFound'
  }
}

/** Opening a Trove when one is already open for the address. */
export class TroveAlreadyExists extends MusdError {
  constructor(address: string, cause?: unknown) {
    super(Codes.TROVE_ALREADY_EXISTS, `A Trove is already open for ${address}.`, {
      context: { address },
      ...(cause !== undefined ? { cause } : {}),
    })
    this.name = 'TroveAlreadyExists'
  }
}

/** A zero / negative / nonsensical numeric input. */
export class InvalidAmount extends MusdError {
  constructor(field: string, value: bigint) {
    super(Codes.INVALID_AMOUNT, `Invalid ${field}: ${value}. Must be a positive amount.`, {
      context: { field, value },
    })
    this.name = 'InvalidAmount'
  }
}

/** `adjustTrove` was given a contradictory combination of deltas. */
export class InvalidAdjustment extends MusdError {
  constructor(message: string) {
    super(Codes.INVALID_ADJUSTMENT, message)
    this.name = 'InvalidAdjustment'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Protocol reverts (mapped from on-chain revert data, ground-truth §11)
// ─────────────────────────────────────────────────────────────────────────────

/** The dangerous one: an operation would leave ICR below MCR (110%). */
export class ICRBelowMCR extends MusdError {
  constructor(cause: unknown) {
    super(
      Codes.ICR_BELOW_MCR,
      'This operation would leave the Trove below the 110% minimum collateral ratio (MCR).',
      { cause },
    )
    this.name = 'ICRBelowMCR'
  }
}

/** Blocked by Recovery Mode (TCR < CCR): tightened rules require ICR ≥ CCR. */
export class RecoveryModeRestriction extends MusdError {
  constructor(cause: unknown) {
    super(
      Codes.RECOVERY_MODE_RESTRICTION,
      'The system is in Recovery Mode; this operation must leave the Trove with ICR ≥ CCR (150%).',
      { cause },
    )
    this.name = 'RecoveryModeRestriction'
  }
}

/** Repaying more MUSD than the Trove owes (on-chain: arithmetic underflow / Panic). */
export class RepayExceedsDebt extends MusdError {
  constructor(cause: unknown, context?: { repay?: bigint; netDebt?: bigint }) {
    super(Codes.REPAY_EXCEEDS_DEBT, 'Repay amount exceeds the Trove’s outstanding debt.', {
      cause,
      ...(context ? { context } : {}),
    })
    this.name = 'RepayExceedsDebt'
  }
}

/**
 * A redemption (or insertion) hint went stale, recompute and retry. NOTE (ground-truth
 * §11): not distinctly reachable from the SDK surface, a stale redemption partial hint
 * surfaces as {@link RedemptionFailed} ("Unable to redeem any amount"); insertion hints
 * never revert. Retained as stable public API (shipped Phase 6).
 */
export class StaleHint extends MusdError {
  constructor(cause: unknown) {
    super(
      Codes.STALE_HINT,
      'A redemption hint went stale (the Trove list moved first). Recompute and retry.',
      { cause },
    )
    this.name = 'StaleHint'
  }
}

/** A redemption could not redeem any amount (nothing redeemable, or a stale hint). */
export class RedemptionFailed extends MusdError {
  constructor(message: string, cause: unknown) {
    super(Codes.REDEMPTION_FAILED, message, { cause })
    this.name = 'RedemptionFailed'
  }
}

/** Not enough MUSD held to repay/close/redeem. */
export class InsufficientMusdBalance extends MusdError {
  constructor(required: bigint, balance: bigint, cause?: unknown) {
    super(
      Codes.INSUFFICIENT_MUSD_BALANCE,
      `Operation needs ${required} MUSD but the account holds ${balance}.`,
      { context: { required, balance }, ...(cause !== undefined ? { cause } : {}) },
    )
    this.name = 'InsufficientMusdBalance'
  }
}

/** `liquidate`/`batchLiquidate` found nothing liquidatable (the simulation reverted). */
export class NothingToLiquidate extends MusdError {
  constructor(borrowers: readonly string[], cause?: unknown) {
    super(
      Codes.NOTHING_TO_LIQUIDATE,
      `None of the given Trove(s) are liquidatable: ${borrowers.join(', ')}.`,
      { context: { borrowers: [...borrowers] }, ...(cause !== undefined ? { cause } : {}) },
    )
    this.name = 'NothingToLiquidate'
  }
}

/**
 * The caller is not permitted (e.g. a governance-only path). NOTE (ground-truth §11): not
 * reachable from the SDK surface, which calls no permission-gated function. Defined for
 * completeness / future surface.
 */
export class Unauthorized extends MusdError {
  constructor(cause?: unknown) {
    super(Codes.UNAUTHORIZED, 'Caller is not authorized for this operation.', {
      ...(cause !== undefined ? { cause } : {}),
    })
    this.name = 'Unauthorized'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Infrastructure
// ─────────────────────────────────────────────────────────────────────────────

/** A write was attempted but `createMusdClient` was given no `walletClient`. */
export class MissingWalletClient extends MusdError {
  constructor() {
    super(
      Codes.MISSING_WALLET_CLIENT,
      'This operation sends a transaction and requires a walletClient; createMusdClient was called without one (or without an account).',
    )
    this.name = 'MissingWalletClient'
  }
}

/** `chainId` is not 31611/31612 and no full address override was supplied. */
export class UnsupportedChain extends MusdError {
  readonly chainId: number
  constructor(chainId: number) {
    super(
      Codes.UNSUPPORTED_CHAIN,
      `Unsupported chainId ${chainId}. MUSD is deployed on 31611 (Mezo Testnet) and 31612 (Mezo Mainnet). Pass \`addresses\` to override for a custom deployment.`,
      { context: { chainId } },
    )
    this.name = 'UnsupportedChain'
    this.chainId = chainId
  }
}

/** An on-chain fixed constant disagrees with the value bundled in the SDK. */
export class MismatchedDeployment extends MusdError {
  readonly constantName: string
  readonly bundled: bigint
  readonly onchain: bigint
  constructor(constantName: string, bundled: bigint, onchain: bigint) {
    super(
      Codes.MISMATCHED_DEPLOYMENT,
      `On-chain ${constantName} (${onchain}) does not match the bundled ${constantName} (${bundled}). The MUSD deployment may have changed, do not trust the bundled fixed constants for this chain.`,
      { context: { constantName, bundled, onchain } },
    )
    this.name = 'MismatchedDeployment'
    this.constantName = constantName
    this.bundled = bundled
    this.onchain = onchain
  }
}

/** An unexpected / unmapped revert, wraps the raw cause, never swallowed. */
export class ContractCallFailed extends MusdError {
  constructor(message: string, cause: unknown) {
    super(Codes.CONTRACT_CALL_FAILED, message, { cause })
    this.name = 'ContractCallFailed'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Best-effort human revert reason from a viem error (for messages / the decoder). */
export function revertReason(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { shortMessage?: string; details?: string; message?: string }
    return e.shortMessage ?? e.details ?? e.message ?? String(error)
  }
  return String(error)
}

/** Guard: throw {@link InvalidAmount} for a non-positive input. */
export function assertPositiveAmount(field: string, value: bigint): void {
  if (value <= 0n) throw new InvalidAmount(field, value)
}

// NOTE: `RedemptionTruncated` is intentionally NOT a thrown error, `redeem` surfaces
// `truncatedAmount` as DATA on its result (Phase 6 decision). `ApprovalRequired` is not
// shipped, Phase 5 verified repay/close need no approval, so it would be unreachable.
