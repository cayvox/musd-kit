---
'@musd-kit/react': minor
'@musd-kit/core': minor
---

**`useAdjustTrovePreview` refused every adjustment that was not a borrow, and reported a repayment's
numbers as though nothing were repaid** (MK-085).

The hook destructured all four legs with `= 0n` defaults and forwarded them. `previewAdjustTrove`
reads `_isDebtIncrease` from the PRESENCE of `increaseDebt`, mirroring `_adjustTrove`'s own separate
`_isDebtIncrease` parameter (`BorrowerOperations.sol:757-758`), so through the hook every adjustment
was a debt increase. A pure collateral top-up came back `viable: false` with `ZERO_DEBT_INCREASE`,
which `:785-787` applies only when the flag is set; a pure repayment came back refused AND with
`netDebtChange`, `resultingEntireDebt`, `resultingIcr` and `resultingTcr` computed from the increase
branch, so the repayment leg was dropped from every figure. On a 1 BTC Trove at 100,000 USD repaying
5,000 MUSD, `resultingIcr` was reported as 9.80 where the answer is 19.23.

**Breaking, both small.** `musdQueryKeys.adjustPreview` now takes the four legs as one
`AdjustPreviewLegs` object rather than four positional values, so the key is built from the same
object the fetch sends and cannot describe a different call. `borrowPreview`,
`withdrawCollateralPreview` and `redeemPreview` accept `bigint | undefined` and encode an absent
amount as `null` rather than `"0"`, because a disabled query still reads whatever sits at its key.

**`previewRedeem` sized its accrual margin from the wrong Trove** (MK-088).

It read `getTroveInterestRate(redeemer)` and applied that one rate to every Trove in the walk, with
a hardcoded `100n` when the redeemer held no Trove, which is the ordinary case for an arbitrageur.
The contract accrues each Trove's interest at that Trove's own stored rate and on its own principal
(`TroveManager.sol:1234-1241`), and a Trove's rate is frozen at open or refinance from a governable
global (`BorrowerOperations.sol:668-672`, `:1075`). Against a Trove carrying 500 bps the margin was
five times too small, and under-sizing `nextViableAmount` reproduces exactly the revert the field
exists to prevent. Each `EligibleTrove` now carries its own `principal` and `interestRateBps`, read
in the batch that already fetches its debt.

**Breaking.** `EvaluateRedeemInput.interestRateBps` is removed and `EligibleTrove` gains `principal`
and `interestRateBps`. A fallback was not kept, deliberately: a fallback is an assumed governable
value, which `constants.ts` says this SDK never bundles.

**`computeNICR` and `computeHints` take `principal`, not `entireDebt`** (MK-090).

The SortedTroves key is the principal on every operation except an open
(`BorrowerOperations.sol:902-905`, `:1087`, `TroveManager.sol:1287-1290`). Every internal call site
was already correct; the public signature asked for the quantity MK-006 was filed about, which is
what an integrator building their own write path reads. **Breaking**: the parameter is renamed.

Also in this release: `close()` throws a typed `LastTroveInSystem` instead of sending a call the
preview already knew would revert (MK-091); the protocol's interest formula has one implementation,
`accruedInterest` (MK-089); `getBorrowingPower` batches the price and stops re-reading the
confirmation fee, and its published round trip count is measured rather than asserted (MK-092); and
nine rules that were decided in more than one place are single sourced (MK-094).
