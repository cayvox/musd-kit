// Minimal write-error subset for Phase 5. The FULL discriminated taxonomy +
// revert→error mapping is Phase 7 (`docs/06-errors.md`); these are shaped to be
// EXTENDED there, not rewritten. (The existing `UnsupportedChain` /
// `MismatchedDeployment` will be migrated onto `MusdError` in Phase 7.)

/**
 * Base for every SDK error: a discriminated `code`, the original cause preserved,
 * and optional structured context. Branch by `instanceof` or by `code` (Law 6).
 */
export class MusdError extends Error {
  readonly code: string
  readonly context: Record<string, unknown> | undefined

  constructor(
    code: string,
    message: string,
    options?: { cause?: unknown; context?: Record<string, unknown> },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'MusdError'
    this.code = code
    this.context = options?.context
  }
}

/** A write was attempted but `createMusdClient` was given no `walletClient`. */
export class MissingWalletClient extends MusdError {
  constructor() {
    super(
      'MISSING_WALLET_CLIENT',
      'This operation sends a transaction and requires a walletClient; createMusdClient was called without one (or without an account).',
    )
    this.name = 'MissingWalletClient'
  }
}

/** The SDK-side fee guard (C5 — there is no on-chain `maxFeePercentage`). */
export class MaxFeeExceeded extends MusdError {
  constructor(maxFeePercentage: bigint, actualFee: bigint, actualFeePercentage: bigint) {
    super(
      'MAX_FEE_EXCEEDED',
      `Borrowing fee (${actualFeePercentage} of 1e18) exceeds the supplied cap (${maxFeePercentage} of 1e18).`,
      { context: { maxFeePercentage, actualFee, actualFeePercentage } },
    )
    this.name = 'MaxFeeExceeded'
  }
}

/** Not enough MUSD held to repay/close (close needs `entireDebt − 200`). */
export class InsufficientMusdBalance extends MusdError {
  constructor(required: bigint, balance: bigint) {
    super(
      'INSUFFICIENT_MUSD_BALANCE',
      `Operation needs ${required} MUSD but the account holds ${balance}.`,
      {
        context: { required, balance },
      },
    )
    this.name = 'InsufficientMusdBalance'
  }
}

/** `adjustTrove` was given a contradictory combination of deltas. */
export class InvalidAdjustment extends MusdError {
  constructor(message: string) {
    super('INVALID_ADJUSTMENT', message)
    this.name = 'InvalidAdjustment'
  }
}

/**
 * A simulated write reverted. Phase 5 surfaces a readable, typed-ish wrapper with the
 * revert reason and the original viem error in `cause`; Phase 7 maps specific reverts
 * (`ICRBelowMCR`, `RepayExceedsDebt`, …) to their own subclasses.
 */
export class ContractCallFailed extends MusdError {
  constructor(message: string, cause: unknown) {
    super('CONTRACT_CALL_FAILED', message, { cause })
    this.name = 'ContractCallFailed'
  }
}

/** Best-effort revert reason from a viem error (without re-implementing Phase 7). */
export function revertReason(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { shortMessage?: string; details?: string; message?: string }
    return e.shortMessage ?? e.details ?? e.message ?? String(error)
  }
  return String(error)
}
