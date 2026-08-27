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
  /**
   * MK-017. Both numbers are OPTIONAL, and that is the fix rather than a weakening.
   *
   * The pre-send guard knows them and passes them. `mapRevert` does not: it decodes a revert
   * string and has no access to the floor or the net debt, so it used to construct this with
   * `0n, 0n`. A user who tried to draw 1700 against a floor of 1800 was then told their net
   * debt was 0 and the minimum was 0, which is not a rounding of the truth, it is two invented
   * numbers. This programme has spent nine waves closing exactly that defect class in larger
   * form; leaving a small one in the error surface would be inconsistent.
   *
   * Absent now means absent: the message says the values are unavailable rather than printing
   * a zero the user never encountered.
   */
  constructor(minNetDebt?: bigint, netDebt?: bigint, cause?: unknown) {
    const known = minNetDebt !== undefined && netDebt !== undefined
    super(
      Codes.BELOW_MINIMUM_DEBT,
      known
        ? `Net debt (${netDebt}) is below the minimum (${minNetDebt}). The floor applies to draw + borrowing fee.`
        : 'Net debt is below the minimum. The floor applies to draw + borrowing fee. The exact figures are not available here: this was decoded from a contract revert rather than caught by the pre-send guard, which is the path that carries them.',
      {
        context: {
          ...(minNetDebt !== undefined ? { minNetDebt } : {}),
          ...(netDebt !== undefined ? { netDebt } : {}),
        },
        ...(cause !== undefined ? { cause } : {}),
      },
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
  /**
   * MK-043. The four numbers are OPTIONAL, for the same reason {@link BelowMinimumDebt}'s
   * are (MK-017): the pre-send guard knows them and passes them, and `mapRevert` decodes a
   * revert string and knows none of them. Constructing this with four zeros from the decode
   * path would print four numbers the user never encountered. Absent means absent.
   */
  constructor(
    capacity?: bigint,
    entireDebt?: bigint,
    netDebtChange?: bigint,
    remaining?: bigint,
    cause?: unknown,
  ) {
    const known =
      capacity !== undefined &&
      entireDebt !== undefined &&
      netDebtChange !== undefined &&
      remaining !== undefined
    super(
      Codes.EXCEEDS_BORROWING_CAPACITY,
      known
        ? `Borrowing ${netDebtChange} (draw plus fee) against a debt of ${entireDebt} would need ${entireDebt + netDebtChange} of capacity, but the Trove's maxBorrowingCapacity is ${capacity}, leaving ${remaining}. Capacity is fixed at the opening price and never rises, so a higher collateral price does not raise it.`
        : "This operation exceeds the Trove's maxBorrowingCapacity. Capacity is fixed at the opening price and never rises, so a higher collateral price does not raise it. The exact figures are not available here: this was decoded from a contract revert rather than caught by the pre-send guard, which is the path that carries them.",
      {
        ...(known ? { context: { capacity, entireDebt, netDebtChange, remaining } } : {}),
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

/**
 * An `addresses` override entry that cannot be a contract address (MK-009).
 *
 * Thrown for an unknown contract key, a value that is not a valid EVM address, and for the
 * zero address specifically. Zero is called out separately because it is the value a
 * partially initialized config produces, and it is the one wrong address that will not
 * announce itself: reads against it return empty data rather than reverting with a reason.
 */
export class InvalidAddressOverride extends MusdError {
  readonly contractName: string
  constructor(contractName: string, value: unknown, why: string) {
    super(
      Codes.INVALID_ADDRESS_OVERRIDE,
      `Invalid \`addresses\` override for "${contractName}": ${why}. Received ${JSON.stringify(value)}.`,
      { context: { contractName, value, why } },
    )
    this.name = 'InvalidAddressOverride'
    this.contractName = contractName
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

/**
 * The SYSTEM ratio gate, `_requireNewTCRisAboveCCR` (`BorrowerOperations.sol:1344-1349`).
 *
 * Distinct from {@link ICRBelowMCR} and from {@link RecoveryModeRestriction}, and it had no
 * typed error at all before MK-043: the revert string "An operation that would result in
 * TCR < CCR is not permitted" matched no pattern in `mapRevert` and arrived as a generic
 * `ContractCallFailed`.
 *
 * **It is a normal mode gate.** `_requireValidAdjustmentInNormalMode` (`:1197-1210`) runs it
 * on every adjustment; `_requireValidAdjustmentInRecoveryMode` (`:1265-1275`) does not run it
 * at all. It also gates `openTrove` (`:665`), `closeTrove` (`:972`) and `refinance` (`:1059`).
 *
 * Your own position can be perfectly healthy and this still refuses you: the constraint is
 * about the system, so what has to change is usually not yours to change.
 */
export class SystemRatioBelowCCR extends MusdError {
  constructor(cause?: unknown, context?: { resultingTcr?: bigint; ccr?: bigint }) {
    const known = context?.resultingTcr !== undefined && context?.ccr !== undefined
    super(
      Codes.SYSTEM_RATIO_BELOW_CCR,
      known
        ? `This operation would take the system total collateral ratio to ${context.resultingTcr}, below the ${context.ccr} minimum (CCR). The constraint is on the system, not on your position.`
        : 'This operation would take the system total collateral ratio below CCR. The constraint is on the system, not on your position. The exact figures are not available here: this was decoded from a contract revert rather than caught by the pre-send guard, which is the path that carries them.',
      { ...(cause !== undefined ? { cause } : {}), ...(context ? { context } : {}) },
    )
    this.name = 'SystemRatioBelowCCR'
  }
}

/**
 * Recovery Mode refuses collateral withdrawal OUTRIGHT, `_requireNoCollWithdrawal`
 * (`BorrowerOperations.sol:1270`, `:1388-1393`).
 *
 * Separate from {@link RecoveryModeRestriction} because the two say different things and the
 * difference is actionable (MK-043). `RecoveryModeRestriction` means "leave the Trove at
 * ICR >= CCR and you may proceed"; this one means **no amount is permitted**, so there is no
 * number a user can adjust to. Both reverts previously mapped to the first message, which
 * told a user to satisfy a ratio that would not have helped.
 */
export class CollateralWithdrawalBlocked extends MusdError {
  constructor(cause?: unknown) {
    super(
      Codes.COLLATERAL_WITHDRAWAL_BLOCKED,
      'The system is in Recovery Mode, which permits no collateral withdrawal at all. This is not a ratio you can satisfy with a smaller amount; withdrawal resumes when the system leaves Recovery Mode.',
      cause !== undefined ? { cause } : {},
    )
    this.name = 'CollateralWithdrawalBlocked'
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
  /** MK-017. Optional for the same reason as {@link BelowMinimumDebt}: the decoder does not
   * know the required amount or the balance, and reporting `0` for both told the user their
   * account holds nothing and the operation needs nothing. */
  constructor(required?: bigint, balance?: bigint, cause?: unknown) {
    const known = required !== undefined && balance !== undefined
    super(
      Codes.INSUFFICIENT_MUSD_BALANCE,
      known
        ? `Operation needs ${required} MUSD but the account holds ${balance}.`
        : 'The account does not hold enough MUSD for this operation. The exact figures are not available here: this was decoded from a contract revert rather than caught by the pre-send guard, which is the path that carries them.',
      {
        context: {
          ...(required !== undefined ? { required } : {}),
          ...(balance !== undefined ? { balance } : {}),
        },
        ...(cause !== undefined ? { cause } : {}),
      },
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
/**
 * Deployment verification failed on something other than a constant (MK-008).
 *
 * `MismatchedDeployment` stays what it always was, a bundled numeric constant disagreeing
 * with the chain, so that branch is unchanged for anyone already handling it. This one
 * carries the assertions that are not numbers: missing contract code, and cross wiring
 * pointers that do not resolve to the resolved address map. Every failure found in the pass
 * is listed, because a deployment that is wrong is usually wrong in more than one place.
 */
export class DeploymentVerificationFailed extends MusdError {
  readonly failures: readonly string[]
  constructor(failures: readonly string[], cause?: unknown) {
    super(
      Codes.DEPLOYMENT_VERIFICATION_FAILED,
      `The contracts at the resolved addresses are not a consistent MUSD deployment. Do not send transactions to them. ${failures.length} check(s) failed:\n  ${failures.join('\n  ')}`,
      { context: { failures }, ...(cause !== undefined ? { cause } : {}) },
    )
    this.name = 'DeploymentVerificationFailed'
    this.failures = failures
  }
}

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
