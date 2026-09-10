---
'@musd-kit/core': minor
---

**`previewBorrow` was wrong in Recovery Mode, in both directions. It is now a projection of
`previewAdjustTrove` rather than a second evaluator** (MK-058, MK-059, MK-060, MK-065).

On chain, `withdrawMUSD` calls `_adjustTrove` with `_collWithdrawal = 0` and
`_isDebtIncrease = true` (`BorrowerOperations.sol:243-257`), so a borrow is a point on the adjust
path and not a sibling of it. The SDK had two evaluators for that one gate set, and they diverged on
three rules:

- **S1, MK-058.** The Recovery Mode requirement that a debt increase must not lower the Trove's ICR
  (`:1273`) was missing. A borrow sends no collateral, so no usable draw can satisfy it, and
  `previewBorrow` returned `viable: true` for operations the contract refuses.
- **S1, MK-059.** A TCR gate was applied in Recovery Mode, where `_requireNewTCRisAboveCCR` has no
  call site on this path. Recovery Mode is defined as `TCR < CCR`, so the reason fired on nearly
  every Recovery Mode borrow.
- **S2, MK-065.** The capacity gate was reported before the ratio gates, so `bindingConstraint`
  named a gate the chain checks later than the one that actually binds.

**No write path was affected.** `borrow()` has always prechecked through the adjust evaluator, which
had every rule right.

**MK-060, separately:** `_isDebtIncrease` is read from presence on both sides now, matching the
contract's own parameter, so `ZERO_DEBT_INCREASE` is reachable and `adjustTrove` refuses a zero
borrow leg instead of sending `(0, true)` for the chain to reject.

**Breaking:** `BorrowBlockReason` gains `ZERO_DEBT_INCREASE`, `NO_CHANGE_REQUESTED` and
`ICR_NOT_IMPROVED_IN_RECOVERY_MODE`. An exhaustive `switch` with no `default` stops compiling.
`BorrowPreview.currentIcr` and `AdjustPreview.capacity` are added. See
`docs/14-migration-0.2-to-0.3.md`.
