---
'@musd-kit/core': minor
'@musd-kit/react': minor
---

**Breaking. Two of these change a value without changing its type, so the compiler will not find
them.** Read `docs/15-migration-0.3-to-0.4.md` before upgrading. Fixes the external audit of 0.3.1:
MK-100 to MK-109.

**Changes a value, same type (no compile error):**

- `useBorrowingPower`'s `data` is now the RECOMMENDED draw, not the contract ceiling it returned in
  0.3 (MK-100). A Trove opened at the 0.3 figure starts at exactly MCR and was liquidatable a second
  later on a fork. The ceiling is on `useBorrowingPowerDetail`.
- The React hooks default an omitted `account` to the connected wallet (MK-106), so a fee exempt
  wallet gets its own, larger answer.

**Changes a type (compile error):**

- `getBorrowingPower` returns `BorrowingPower` (`ceiling`, `recommended`, `ceilingIcr`,
  `recommendedIcr`, `margin`, `isRecoveryMode`, `price`) instead of `bigint` (MK-100). `recommended`
  leaves `BORROWING_POWER_PRICE_MOVE_BPS` (200) and `BORROWING_POWER_MARGIN_WINDOW_SECONDS` (3600),
  measured from Mezo mainnet. Replace the old value with `recommended`, not `ceiling`.
- `MusdErrorCode` gains `ORACLE_STALE` and `REDEMPTION_PRICE_FRAGILE`: an exhaustive `switch` with no
  `default` stops compiling (MK-103, MK-105).
- Required input fields for the pure evaluators: `EvaluateRedeemInput.globalInterestRateBps`,
  `EligibleTrove.collateral` and `EligibleTrove.interestOwed` (MK-103);
  `EvaluateRefinanceInput.currentInterestRateBps`, `globalInterestRateBps` and `currentCapacity`
  (MK-101). Only code that constructs these breaks.
- Result fields added, which breaks only code that constructs a result: `RefinancePreview` gains
  `currentInterestRateBps`, `resultingInterestRateBps`, `currentCapacity`, `resultingCapacity`
  (MK-101); `RedemptionPreview` and `RedeemResult` gain `partial` (MK-103).

**Changes behaviour:**

- `redeem()` throws `RedemptionPriceFragile`, before gas, instead of sending a partial on the first
  Trove whose price tolerance is under the measured two block move; pass
  `acceptPriceFragilePartial: true` to send it anyway. The partial hint is now the centre of the
  contract's band rather than the helper's lower edge, and `previewRedeem(...).partial` reports the
  tolerances (MK-103).
- `redeem()` accepts the `nextViableAmount` its preview reported, for the ten minutes it advertises,
  instead of refusing it a block later (MK-104).
- `previewRedeem` no longer charges `maxIterations` for sub-MCR Troves the contract skips before its
  loop (MK-107).
- Every `MusdClient` method and every exported preview throws a `MusdError`, including reverts raised
  outside a write's simulation: `OracleStale` for a stale price feed, `ContractCallFailed` otherwise,
  with the viem error in `cause`. A `catch` that tested for a viem error class no longer matches
  (MK-105).
- A React read hook whose inputs changed, or that is disabled, reports `data: undefined` and `pending`
  instead of the previous answer marked as a success; a write hook resets when the account or chain
  changes (MK-102).

**Added, not breaking:** `useBorrowingPowerDetail`; `marginWindowSeconds` and `priceMoveBps` on
`useBorrowingPower` and `useBorrowingPowerDetail`, forwarded to the core and keyed separately, and
validated in the core, where a negative override or a price move of 10000 bps or more throws
`InvalidAmount` instead of returning the ceiling as `recommended`; `maxBorrowingCapacityAt`,
`partialRedemptionBand` and the margin constants; `OracleStale` and `RedemptionPriceFragile`; the
preview result types re-exported from `@musd-kit/react`. The packaged core README's quickstart now
compiles and is compiled against the packed tarball by `pnpm gate:packaging` (MK-108); documentation
and shipped surfaces are corrected item by item (MK-109).
