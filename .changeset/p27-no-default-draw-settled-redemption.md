---
'@musd-kit/core': minor
'@musd-kit/react': minor
---

**Breaking. Five of these change behaviour without changing a type, so the compiler will not find
them.** Read `docs/16-migration-0.4-to-0.5.md` before upgrading. Fixes the consumer audit of 0.4.1:
MK-240 to MK-247.

**The borrowing figure you were told to offer is gone (MK-240, S1).** `getBorrowingPower` returns the
contract ceiling alone, `{ ceiling, ceilingIcr, isRecoveryMode, price }`. `recommended`, `recommendedIcr`,
`margin`, the `marginWindowSeconds` and `priceMoveBps` parameters and the two `BORROWING_POWER_*`
constants are removed. `drawForMargin({ collateral, horizonSeconds, priceFallBps })` sizes a draw to a
margin the caller chooses, with no default for either input. In React, `useBorrowingPower`'s `data` is the
ceiling result object, `useBorrowingPowerDetail` is removed, and `useDrawForMargin` is disabled until both
inputs are supplied. 0.4's `recommended` survived an hour; over 86 days of Mezo mainnet prices its 2% margin
was crossed within a week of 57.6% of sampled start times, and the table for choosing a margin is in the
READMEs and `docs/03-core-api.md`.

**A redemption reports what settled (MK-241, S1).** `redeem()` resolves once mined, with `settled` read from
the `Redemption` event and `estimatedBeforeSend` from `previewRedeem`'s walk. `truncatedAmount`,
`estimatedFeeCollateral` and `estimatedCollateralDrawn` are removed. A reverted redemption throws
`RedemptionFailed`. `settledRedemptionFrom` reads a receipt you hold. `useRedeem` stays pending until mined.

**Withdrawals disclose the capacity they remove (MK-242, S1).** `AdjustPreview` and `MaxWithdrawable` carry
`capacityAfter`, with the refinance that would restore it. `computeMaxWithdrawable` requires `capacity`.

**One gate, one error code (MK-243).** The adjust precheck throws `ICRBelowMCR` or
`RecoveryModeRestriction` for the ratio gate, as the revert decoder does, not `InsufficientCollateral`,
which now names only a withdrawal larger than the collateral. A borrow failing ratio and capacity reports
the ratio, as the contract checks it first.

**Adjustment legs by value (MK-244).** `{ addCollateral: 0n, withdrawCollateral: x }` sends a withdrawal,
and `{ borrow: 0n, addCollateral: x }` a top up, where 0.4 threw; a negative leg throws `InvalidAmount`.

**The last Trove rule on redemption (MK-245).** `previewRedeem` reports `LAST_TROVE_IN_SYSTEM` and `redeem()`
throws `LastTroveInSystem` before gas. `EvaluateRedeemInput` requires `troveOwnersCount`, `sortedTrovesSize`
and `canMint`.

**Shipped documentation (MK-246, MK-247).** Claims closed findings retired are corrected in the declarations,
source maps and READMEs, and `scripts/retired-claims.mjs` now reads the packed artifact for them in the
packaging gate. `useMaxWithdrawableCollateral` is no longer described as a max button's number.
