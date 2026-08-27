export type { MathDeps } from './deps'
export {
  computeICR,
  computeLiquidationPrice,
  getHealthFactor,
  computeEntireDebt,
  type ComputeICRParams,
  type ComputeLiquidationPriceParams,
  type ComputeEntireDebtParams,
} from './compute'
export {
  previewOpen,
  type PreviewOpenParams,
  type OpenPreview,
  type OpenBlockReason,
  evaluateOpen,
  type EvaluateOpenInput,
} from './previewOpen'
export {
  previewBorrow,
  getBorrowingCapacity,
  type PreviewBorrowParams,
  type BorrowPreview,
  type BorrowBlockReason,
  type BorrowingCapacity,
  evaluateBorrow,
  type EvaluateBorrowInput,
} from './previewBorrow'
export { getBorrowingPower, type GetBorrowingPowerParams } from './getBorrowingPower'
export {
  previewRefinance,
  evaluateRefinance,
  type RefinancePreview,
  type RefinanceBlockReason,
  type EvaluateRefinanceInput,
} from './previewRefinance'
export {
  isBorrowingFeeCharged,
  effectiveBorrowingFee,
  estimateCollateralDrawn,
  exceedsRateCap,
} from './fee'

// MK-042. The adjust family, previewed. One evaluator because the contract has one:
// addColl, withdrawColl, withdrawMUSD, repayMUSD and adjustTrove all funnel into
// `_adjustTrove` (`BorrowerOperations.sol:752-761`) and are gated by the same code.
export {
  previewAdjustTrove,
  previewWithdrawCollateral,
  maxWithdrawableCollateral,
  computeMaxWithdrawable,
  evaluateAdjust,
  type PreviewAdjustParams,
  type AdjustPreview,
  type AdjustBlockReason,
  type EvaluateAdjustInput,
  type MaxWithdrawable,
} from './previewAdjust'

// MK-042. Closing has its own gate set, two of them conditional on a live chain read.
export {
  previewClose,
  evaluateClose,
  type ClosePreview,
  type CloseBlockReason,
  type EvaluateCloseInput,
} from './previewClose'
