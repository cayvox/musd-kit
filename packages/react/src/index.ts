// @musd-kit/react, wagmi-idiomatic hooks over @musd-kit/core.
//
// This package ships NO provider of its own: it consumes the wagmi context (WagmiProvider +
// QueryClientProvider) that Passport's `getConfig`, or any wagmi setup, already
// established (decision O4). It peer-depends on wagmi, not Passport. Each hook is a thin
// reactive wrapper that delegates to the core; no protocol logic lives here.

// Read hooks (TanStack useQuery, block-watching refetch).
export {
  useTrove,
  useHealthFactor,
  useLiquidationPrice,
  useBorrowingPower,
  useAdjustTrovePreview,
  useBorrowPreview,
  useClosePreview,
  useMaxWithdrawableCollateral,
  useRedeemPreview,
  useWithdrawCollateralPreview,
  useBorrowingCapacity,
  useRefinancePreview,
  useOraclePrice,
  useMusdBalance,
} from './hooks/reads'

// Write hooks (TanStack useMutation over the core write methods).
export {
  useOpenTrove,
  useAddCollateral,
  useBorrow,
  useRepay,
  useWithdrawCollateral,
  useAdjustTrove,
  useCloseTrove,
  useClaimCollateral,
  useRefinance,
  useRedeem,
  type MusdWriteResult,
  type UseOpenTroveResult,
  type UseAddCollateralResult,
  type UseBorrowResult,
  type UseRepayResult,
  type UseWithdrawCollateralResult,
  type UseAdjustTroveResult,
  type UseCloseTroveResult,
  type UseClaimCollateralResult,
  type UseRefinanceResult,
  type UseRedeemResult,
} from './hooks/writes'

// The internal client builder, exported for advanced consumers who want the core client
// bound to the ambient wagmi context.
export { useMusdClient } from './internal/useMusdClient'
export { musdQueryKeys } from './internal/keys'

// Re-export the core's typed errors + the key types consumers branch on, so a React app can
// import everything it needs from one place.
export {
  // errors (the full discriminated taxonomy)
  MusdError,
  MusdErrorCode,
  BelowMinimumDebt,
  MaxFeeExceeded,
  InsufficientCollateral,
  TroveNotFound,
  TroveAlreadyExists,
  InvalidAmount,
  InvalidAdjustment,
  ICRBelowMCR,
  RecoveryModeRestriction,
  RepayExceedsDebt,
  StaleHint,
  InsufficientMusdBalance,
  NothingToLiquidate,
  RedemptionFailed,
  Unauthorized,
  UnsupportedChain,
  MismatchedDeployment,
  MissingWalletClient,
  ContractCallFailed,
  // live-read + preview types
  TroveStatus,
  type Trove,
  type SystemState,
  type OpenPreview,
  // write param/result types
  type OpenTroveParams,
  type BorrowParams,
  type AdjustTroveParams,
  type RedeemParams,
  type RedeemResult,
  type WriteResult,
  type ClaimResult,
} from '@musd-kit/core'
