// @musd-kit/core, public surface.
//
// Phase 1: address maps, typed viem clients, and `createMusdClient` (resolves
// addresses + reads/caches the governable constants). Reads (`getTrove`), preview
// math, hints, writes, redemption, and errors arrive in later phases.

// Fixed constants (bundled keeps governable values off this list).
export * from './constants'

// Unit helpers (docs/08 §5), readable 18-decimal parse/format for BTC + MUSD, and bps.
export { parseBtc, formatBtc, parseMusd, formatMusd, parseBps } from './units'

// Address resolution.
export {
  getAddresses,
  isSupportedChainId,
  hasAddressOverride,
  UnsupportedChain,
  InvalidAddressOverride,
  SUPPORTED_CHAIN_IDS,
  MUSD_CONTRACT_NAMES,
  DEPLOYMENTS,
  SOURCE_PACKAGE_VERSION,
  type MusdAddresses,
  type MusdContractName,
  type SupportedChainId,
} from './addresses'

// Typed contract clients + the official `as const` ABIs.
export {
  createContracts,
  type MusdContracts,
  borrowerOperationsAbi,
  troveManagerAbi,
  sortedTrovesAbi,
  hintHelpersAbi,
  priceFeedAbi,
  interestRateManagerAbi,
  musdAbi,
} from './clients'

// Gas margin on every write, and diagnosing a write that reverted anyway (MK-035).
export { DEFAULT_GAS_MARGIN_PERCENT, withGasMargin } from './internal/write'
export {
  diagnoseRevertedWrite,
  type WriteDiagnosis,
  type WriteFailureKind,
} from './diagnose'

// The entry point.
export {
  createMusdClient,
  DEFAULT_CONSTANTS_TTL_MS,
  MismatchedDeployment,
  DeploymentVerificationFailed,
  type MusdClient,
  type CreateMusdClientParams,
  type MusdConstants,
  type GovernableConstants,
} from './client/createMusdClient'

// Live-read types (contract-authoritative).
export { TroveStatus, type Trove, type SystemState } from './read'

// Insertion-hint module.
export {
  computeNICR,
  computeHints,
  trialsForSize,
  NICR_PRECISION,
  DEFAULT_HINT_RANDOM_SEED,
  type ComputeNICRParams,
  type ComputeHintsParams,
  type Hints,
} from './hints'

// Preview math (the only client-side compute, preview side; non-throwing).
export {
  computeICR,
  computeLiquidationPrice,
  getHealthFactor,
  computeEntireDebt,
  previewOpen,
  getBorrowingPower,
  type ComputeICRParams,
  type ComputeLiquidationPriceParams,
  type ComputeEntireDebtParams,
  type PreviewOpenParams,
  type OpenPreview,
  type OpenBlockReason,
  evaluateOpen,
  type EvaluateOpenInput,
  previewBorrow,
  getBorrowingCapacity,
  type PreviewBorrowParams,
  type BorrowPreview,
  type BorrowBlockReason,
  type BorrowingCapacity,
  evaluateBorrow,
  type EvaluateBorrowInput,
  previewRefinance,
  evaluateRefinance,
  type RefinancePreview,
  type RefinanceBlockReason,
  type EvaluateRefinanceInput,
  isBorrowingFeeCharged,
  effectiveBorrowingFee,
  estimateCollateralDrawn,
  exceedsRateCap,
  type GetBorrowingPowerParams,
} from './math'

// Lifecycle write types (the methods live on the client; require a walletClient).
export type {
  OpenTroveParams,
  BorrowParams,
  AdjustTroveParams,
  GasDecision,
  WriteResult,
  ClaimResult,
} from './trove'

// Redemption + keeper surface types.
export {
  DEFAULT_REDEMPTION_MAX_ITERATIONS,
  type RedeemParams,
  type RedeemResult,
} from './redemption'

// Errors, the full discriminated taxonomy (docs/06). `UnsupportedChain` and
// `MismatchedDeployment` are also `MusdError`s but re-exported from their original modules
// above to avoid duplicate exports.
export {
  MusdError,
  MusdErrorCode,
  ALL_MUSD_ERROR_CODES,
  mapRevert,
  revertReason,
  // validation / preview-time
  BelowMinimumDebt,
  ExceedsBorrowingCapacity,
  MaxFeeExceeded,
  InsufficientCollateral,
  TroveNotFound,
  TroveAlreadyExists,
  InvalidAmount,
  InvalidAdjustment,
  // protocol reverts
  ICRBelowMCR,
  RecoveryModeRestriction,
  RepayExceedsDebt,
  StaleHint,
  InsufficientMusdBalance,
  NothingToLiquidate,
  RedemptionFailed,
  Unauthorized,
  // infrastructure
  MissingWalletClient,
  ContractCallFailed,
} from './errors'

// Chain config (decision O10), re-exported from `@mezo-org/chains` so consumers
// and examples get the canonical viem `Chain` objects from one place.
export { mezoMainnet, mezoTestnet } from '@mezo-org/chains'
