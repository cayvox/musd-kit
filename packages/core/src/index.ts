// @musd-kit/core — public surface.
//
// Phase 1: address maps, typed viem clients, and `createMusdClient` (resolves
// addresses + reads/caches the governable constants). Reads (`getTrove`), preview
// math, hints, writes, redemption, and errors arrive in later phases.

// Fixed constants (bundled — Law 3 keeps governable values off this list).
export * from './constants'

// Address resolution.
export {
  getAddresses,
  isSupportedChainId,
  UnsupportedChain,
  SUPPORTED_CHAIN_IDS,
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

// The entry point.
export {
  createMusdClient,
  MismatchedDeployment,
  type MusdClient,
  type CreateMusdClientParams,
  type MusdConstants,
  type GovernableConstants,
} from './client/createMusdClient'

// Live-read types (Law 2 — contract-authoritative).
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

// Preview math (the only client-side compute — Law 2 preview side; non-throwing).
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
  type GetBorrowingPowerParams,
} from './math'

// Chain config (decision O10) — re-exported from `@mezo-org/chains` so consumers
// and examples get the canonical viem `Chain` objects from one place.
export { mezoMainnet, mezoTestnet } from '@mezo-org/chains'
