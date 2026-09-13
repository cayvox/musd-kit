// The ONE place revert decoding lives (docs/06 §3). Write/simulate paths call `mapRevert`;
// they never decode inline. It parses the viem error, extracts the require-string reason
// (or a Panic), matches it against the verified corpus (ground-truth §11), and returns the
// precise typed error. Anything unrecognized becomes `ContractCallFailed` with the original
// viem error preserved in `cause`, a revert is NEVER swallowed.
//
// Numeric-context errors (BelowMinimumDebt, InsufficientMusdBalance, MaxFeeExceeded) are
// owned by the pre-send GUARDS, which run before simulate and carry the real numbers; the
// decoder maps their reason strings defensively (cause preserved) for any path a guard
// does not precede.

import { BaseError, ContractFunctionRevertedError } from 'viem'
import {
  BelowMinimumDebt,
  CollateralWithdrawalBlocked,
  ContractCallFailed,
  ExceedsBorrowingCapacity,
  ICRBelowMCR,
  InsufficientMusdBalance,
  LastTroveInSystem,
  MusdError,
  NothingToLiquidate,
  OracleStale,
  RecoveryModeRestriction,
  RedemptionFailed,
  RepayExceedsDebt,
  SystemRatioBelowCCR,
  TroveAlreadyExists,
  TroveNotFound,
  revertReason,
} from './index'

/** Context the caller supplies so the decoder can build a richer typed error. */
export interface RevertContext {
  /** Logical operation (e.g. 'repay', 'liquidate', 'redeem'), disambiguates the Panic case. */
  operation?: string
  /** The address the operation targeted (for Trove-existence reverts). */
  address?: string
  /** For `liquidate`/`batchLiquidate`: the addresses attempted. */
  borrowers?: readonly string[]
}

interface DecodedRevert {
  /** The require-string reason (e.g. "BorrowerOps: ..."), if any. */
  reason: string | undefined
  /** A custom-error / Panic name (e.g. "Panic", "ERC20InsufficientBalance"), if any. */
  errorName: string | undefined
}

/** Pull the structured revert out of a viem error (or fall back to a best-effort reason). */
function decode(error: unknown): DecodedRevert {
  if (error instanceof BaseError) {
    const rev = error.walk((e) => e instanceof ContractFunctionRevertedError)
    if (rev instanceof ContractFunctionRevertedError) {
      return { reason: rev.reason, errorName: rev.data?.errorName }
    }
  }
  return { reason: revertReason(error), errorName: undefined }
}

/**
 * The decoded require-string reason, or `undefined` when the error carries none.
 *
 * Exported for the one caller that has to MATCH a reason rather than map it: `claim`
 * turns exactly one revert into a no-op and must rethrow every other failure (MK-007).
 * It exists so that caller reuses this walk instead of re-implementing it, which is the
 * same reason `mapRevert` is the only decoder in the first place.
 */
export function decodeRevertReason(error: unknown): string | undefined {
  return decode(error).reason
}

/**
 * Map a contract/simulation revert to its typed `MusdError`. Matches on the distinctive
 * substring of each verified reason (ground-truth §11), case-insensitive. Unrecognized →
 * `ContractCallFailed` (raw reason + original error preserved; never swallowed).
 */
export function mapRevert(error: unknown, context?: RevertContext): MusdError {
  // Already typed: a guard or an inner call mapped it. Mapping it again would bury the precise
  // error inside a `ContractCallFailed` (MK-105, where every client method now routes here).
  if (error instanceof MusdError) return error
  const { reason, errorName } = decode(error)
  const text = reason ?? ''
  const has = (re: RegExp) => re.test(text)
  const at = context?.address ?? 'unknown'

  //, Recovery Mode before the plain ICR check (its string also concerns ICR/CCR),
  // MK-043. The three Recovery Mode reverts say DIFFERENT things and used to share one
  // message, so a user blocked from withdrawing any collateral was told to satisfy a ratio
  // that would not have helped. Split, most specific first.
  // MK-105. The one revert every path can hit, from the price read itself.
  if (has(/Oracle is stale/i)) return new OracleStale(error)
  if (has(/Collateral withdrawal not permitted/i)) return new CollateralWithdrawalBlocked(error)
  if (has(/ICR >= CCR/i) || has(/recovery mode/i)) return new RecoveryModeRestriction(error)
  if (has(/ICR < MCR is not permitted/i)) return new ICRBelowMCR(error)
  // MK-043. Neither of these matched any pattern, so both arrived as ContractCallFailed.
  if (has(/TCR < CCR is not permitted/i)) return new SystemRatioBelowCCR(error)
  if (has(/exceeds maxBorrowingCapacity/i))
    return new ExceedsBorrowingCapacity(undefined, undefined, undefined, undefined, error)

  // MK-017: no placeholder zeros. The decoder does not know the floor or the net debt, so it
  // says so rather than inventing two numbers the user never encountered.
  if (has(/net debt must be greater than minimum/i)) {
    return new BelowMinimumDebt(undefined, undefined, error)
  }
  if (has(/Trove does not exist or is closed/i)) return new TroveNotFound(at, error)
  if (has(/Trove is active/i)) return new TroveAlreadyExists(at, error)
  if (has(/enough mUSD to make repayment/i) || errorName === 'ERC20InsufficientBalance') {
    return new InsufficientMusdBalance(undefined, undefined, error)
  }
  if (has(/nothing to liquidate/i)) return new NothingToLiquidate(context?.borrowers ?? [], error)
  // MK-091. `TroveManager._closeTrove:1390-1399` reverts here when the system holds one Trove.
  // It matched nothing until the P17 wave, so it arrived as `ContractCallFailed` with a raw
  // string while every neighbouring close reason had a typed error. The decoder does not know
  // the two counts, so it passes none rather than inventing them (MK-017); `close` throws the
  // same error WITH them, from the preview, before this is ever reached.
  if (has(/Only one trove in the system/i)) return new LastTroveInSystem(undefined, error)
  if (has(/Unable to redeem any amount/i)) {
    return new RedemptionFailed(
      'Unable to redeem any amount (nothing redeemable within maxIterations, or a stale hint).',
      error,
    )
  }

  //, Panic(0x11) underflow: on the SDK surface this is only repay-more-than-owed,
  if (errorName === 'Panic' || has(/underflow or overflow/i)) {
    if (context?.operation === 'repay' || context?.operation === 'adjustTrove') {
      return new RepayExceedsDebt(error)
    }
  }

  //, Unrecognized: never swallow,
  const fn = context?.operation ?? 'contract call'
  // MK-105. Not every failure that reaches here is a revert: a rate limited endpoint or a dropped
  // connection arrives too, now that reads route through this function. Say which it was, so
  // "reverted" is only ever printed for something the contract refused.
  const reverted =
    error instanceof BaseError &&
    error.walk((e) => e instanceof ContractFunctionRevertedError) !== null
  return new ContractCallFailed(
    `${fn} ${reverted ? 'reverted' : 'failed'}: ${reason ?? revertReason(error)}`,
    error,
  )
}

/**
 * Run a chain reading operation and route anything it throws through {@link mapRevert} (MK-105).
 *
 * **Why this exists.** `simulateAndSend` always mapped what it caught, and the README promised a
 * typed `MusdError` for every protocol revert. The reads that run BEFORE a simulation, and every
 * preview and read function, did not map anything, so a stale oracle reached the caller as a raw
 * viem `ContractFunctionExecutionError` with no `code`. Every exported async entry point runs
 * through this, and an error that is already a `MusdError` passes through untouched.
 */
export async function withTypedErrors<T>(
  run: () => Promise<T>,
  context: RevertContext,
): Promise<T> {
  try {
    return await run()
  } catch (error) {
    throw mapRevert(error, context)
  }
}
