# @musd-kit/core

## 0.5.0

### Minor Changes

- 54e6778: **Breaking. Five of these change behaviour without changing a type, so the compiler will not find
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

## 0.4.1

### Patch Changes

- dda8296: **`previewRedeem` and `redeem` now read `maxIterations: 0n` as no limit, which is what the contract
  does with zero (MK-114, S1).**

  `redeemCollateral` and `getRedemptionHints` both replace a zero `_maxIterations` with no limit
  (`TroveManager.sol:353-355`, `HintHelpers.sol:107-109`); the deployed helper at the pinned testnet
  block returns a 400,000 MUSD request whole at zero and truncates it to 298,067 MUSD at 100. 0.4.0's
  preview walked one eligible Trove at `0n`, so it reported less than the call redeemed, and `redeem()`
  prechecked only that Trove while sending zero to the chain. 0.2.0 to 0.3.1 walked none.

  What changes for a caller:

  - `maxIterations: 0n` walks until the eligible Troves cover `amount` or the list ends, in the preview
    and in the write alike. A request covered by two Troves reads two, not the whole list.
  - A negative `maxIterations`, or one above the largest `uint256`, throws `InvalidAmount` before any
    read. No such value could be sent to the contract.
  - The omitted default is one exported constant, `DEFAULT_REDEMPTION_MAX_ITERATIONS` (`100n`), shared
    by the preview and the write. Its value and its export path are unchanged.

  `@musd-kit/react` moves with core: `useRedeem` passes the caller's parameters to `redeem()`, so it
  gets the corrected precheck. `usePreviewRedeem` takes no `maxIterations` and was not affected.

## 0.4.0

### Minor Changes

- 5b12250: **Breaking. Two of these change a value without changing its type, so the compiler will not find
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

## 0.3.1

### Patch Changes

- 02a2a70: **Warning: `getBorrowingPower` and `useBorrowingPower` have no safety margin. Do not open a Trove at
  the number they return (MK-100, S1).** Documentation only: no behaviour change and no API change.

  The number is the largest draw the contract will accept. In normal mode that opens the position at
  exactly the 110% minimum collateral ratio, and interest is added to the debt every second, so a
  Trove opened at it can be liquidated by anyone within seconds of opening. A liquidation takes all of
  the collateral; the borrower keeps only the MUSD they drew. Reproduced on a fork: opened at the
  reported number, liquidatable one second later, and liquidated
  (`packages/core/test/zz-borrowing-power-boundary.fork.test.ts`). **Callers must apply their own
  buffer** and check the ratio they would open at with `previewOpen` before sending.

  In Recovery Mode the number opens at exactly 150%, which is not liquidatable but has no margin
  either. When the system's ratio is what limits it, the open is refused a block later.

  The warning is now on the function's docstring, `MusdClient.getBorrowingPower`, the
  `useBorrowingPower` docstring, and both package READMEs. The returned value is deliberately
  unchanged: changing what a published function returns is an open design decision.

## 0.3.0

### Minor Changes

- a426775: **`previewBorrow` was wrong in Recovery Mode, in both directions. It is now a projection of
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

- 58d8cea: **One protocol rule was implemented in eight places and four of them were wrong the same way. Every
  place that decides whether the borrowing fee applies now goes through the one exported rule**
  (MK-067, MK-068, MK-069, MK-070).

  `BorrowerOperations.sol:637-643` charges the borrowing fee only when
  `!isRecoveryMode && !isAccountFeeExempt(borrower)`, and `:813-818` repeats the same condition on a
  debt increase. `math/fee.ts` has exported that condition as `isBorrowingFeeCharged` since MK-004,
  and its own docstring says the rule is kept in one place so it "cannot drift between the preview and
  the write path". It had drifted, in four places.

  ### Breaking behaviour, even though no signature is removed

  - **`getBorrowingPower` returns a LARGER number in Recovery Mode, and for a fee exempt account.**
    It subtracted a borrowing fee the contract does not charge, so the reported maximum was short by
    roughly 0.0999 percent of the draw at the live rate. Proven against the real contracts on a fork:
    the excluded draw opened, at ICR exactly CCR. A caller who stored or compared the old figure will
    see it move. **S1: the old value was silently wrong, with no error raised.**
  - **`getBorrowingPower` takes an optional `account`.** Additive, so existing calls compile
    unchanged, but exemption is not modelled without it. Pass the connected address whenever you have
    one, exactly as `previewOpen` already asks. `useBorrowingPower` takes it too, and it is part of
    the React query key, so an exempt and a non exempt caller no longer share a cached answer.
  - **`openTrove` accepts calls it used to refuse and refuses calls it used to accept.** It called the
    raw fee getter while `borrow` and `adjustTrove` used the effective one. A `maxFeePercentage: 0n`
    open in Recovery Mode was refused with `MaxFeeExceeded` naming a fee that would never be charged,
    and is now sent. A draw in the band `draw < minNetDebt <= draw + fee` was sent and reverted on
    chain, and is now refused up front with `BelowMinimumDebt`.
  - **`AdjustBlockReason` gains `DEBT_INCREASE_AND_REPAY`** (MK-077). A `previewAdjustTrove` call with
    both debt legs used to drop the repayment and return `viable: true`, describing an operation
    `_adjustTrove` cannot perform. An exhaustive `switch` over the union needs a new arm.
  - **`CloseBlockReason` gains `LAST_TROVE_IN_SYSTEM`** (MK-074). The last Trove in a system cannot be
    closed (`TroveManager.sol:1390-1399`) or liquidated (`:1058-1060`), and neither `previewClose` nor
    `isLiquidatable` knew. `EvaluateCloseInput` gains two optional counts; supplying them is what
    enables the gate.
  - **`RefinanceBlockReason` members are reordered** (MK-075). `RECOVERY_MODE` now precedes
    `TROVE_NOT_ACTIVE`, which is the order `_refinance` checks them in (`:1023` then `:1024`).
    `viable` is unchanged; `bindingConstraint` and the order of `reasons` are not.
  - **`computeMaxWithdrawable.limitedBy` reports `TCR` in a case it used to call `ICR`** (MK-076): a
    zero maximum caused by the system ratio rather than by the position.

  ### Also fixed

  - **`previewRedeem`'s accrual margin was 0.0664 percent too large** (MK-071). The file shadowed
    `SECONDS_PER_YEAR` with `365 * 24 * 3600`, the value `constants.ts` explicitly names as the wrong
    one; the protocol uses 31,556,952 (`InterestRateMath.sol:9`). `nextViableAmount` moves slightly.
  - **New export `isTroveLiquidatable`**, so `getTrove().isLiquidatable` and `isLiquidatable()` are
    one implementation rather than two that agreed by coincidence.
  - **Staleness is now on the fields TypeDoc publishes**, not only in the register:
    `BorrowingCapacity.remaining` is the headroom to exactly the liquidation threshold and expires in
    about a second (MK-072), and `MaxWithdrawable.amount` is good for the block it was computed at
    (MK-073, the clause MK-051 named as its own acceptance condition).

  ### And the controls that let this happen

  `getBorrowingPower`'s feasibility predicate IS `evaluateOpen` now, so the open rules have one
  implementation. `borrowing-power-agreement.test.ts` pins the two against each other in both modes
  and for an exempt account. The differential sweep gains a `borrowingPower` operation, closing a gap
  `docs/09` described as validated while the sweep did not reach it. The Recovery Mode fork assertion
  opens on chain instead of restating the implementation's arithmetic, which is what let MK-067
  survive: it passed because of the defect and would have failed once the defect was removed
  (MK-070). `docs/08-conventions.md` §12 now requires enumerating every place a rule is decided before
  a finding can be closed.

- 327949a: **`useAdjustTrovePreview` refused every adjustment that was not a borrow, and reported a repayment's
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

## 0.2.0

### Minor Changes

- **0.1.0 returned wrong numbers on seven surfaces and could send transactions that revert. If you
  have 0.1.0 in production, read this before deciding.** Every item below is a finding with a
  permanent ID in `FINDINGS.md`; the migration steps, with before and after code, are in
  `docs/11-migration-0.1-to-0.2.md`.

  ### Wrong numbers, returned silently

  - **`isLiquidatable` reported Recovery Mode liquidations that this protocol does not have
    (MK-001).** In Recovery Mode it returned `true` for every Trove between MCR and CCR. MUSD removed
    stock Liquity's Recovery Mode liquidation branch: the only gate is `ICR < MCR`. Keepers acting on
    it wasted gas on reverting liquidations, and position holders saw false alarms.
  - **`redeem()` returned the redemption RATE in a field named `fee` (MK-014).** A caller reading
    `result.fee` as an amount of anything got a 1e18 scaled ratio. **`fee` is gone**; the rate, the
    estimated fee in BTC wei, and the collateral it was estimated against are now three separate,
    correctly named fields.
  - **The refinancing fee was not modeled at all (MK-003)**, so any quote for a refinance was short by
    the whole fee.
  - **The borrowing fee ignored Recovery Mode (MK-004)** and **ignored fee exemption (MK-018)**. The
    protocol charges no borrowing fee in Recovery Mode, and none to a fee exempt account. Two accounts
    are fee exempt on mainnet. Quotes for either case were too high.
  - **`previewOpen.meetsRecoveryRequirement` was vacuous (MK-005).** It was true for every normal mode
    open, so it never told you anything, and nothing checked the resulting TCR against CCR. **The
    field is gone.** `previewOpen` now returns a `viable` verdict, the `reasons` behind it, the
    binding constraint, and `resultingTcr`.
  - **Price was read outside the multicall (MK-013)**, so `icr` and `price` in one result could come
    from different blocks.
  - **Governable constants were cached for the life of the client (MK-012)**, so `minNetDebt` and the
    interest rate could be arbitrarily stale.
  - **Insertion hints were computed from entire debt rather than principal (MK-006)**, and repay
    ignored the interest first ordering, so hints were wrong once any interest existed.

  ### Transactions that fail

  - **Writes shipped a gas limit thinner than their own work varies (MK-035, MK-037).** A traced
    `redeemCollateral` grew 16% and ran out of gas at call depth 4, and the receipt showed
    `gasUsed < gasLimit`, so it did not even look like out of gas. Writes now carry a **25% margin**
    over the estimate, and every write result carries a `gas` field saying whether that margin was
    actually applied.
  - **`maxBorrowingCapacity` was not modeled (MK-002)**, so a borrow past the cap reached the chain
    and reverted. `getBorrowingCapacity` and `previewBorrow` now exist, and `borrow` prechecks.
  - **`refinance()` reverted in Recovery Mode with nothing checking or documenting it (MK-019).**
    `previewRefinance` now exists.
  - **`claim()` swallowed every error (MK-007)**, so a failed claim was indistinguishable from nothing
    to claim.
  - **`verifyDeployment()` was off the critical path (MK-008)**, so writes could go to a lookalike
    contract unverified. It now gates every write, memoized to one multicall per client.
  - **Address overrides accepted any string (MK-009).**

  ### Fixed for TypeScript consumers

  - **The export map never pointed at the CommonJS type declarations it ships (MK-040).** Both
    packages build and publish `dist/index.d.cts`, and the map referred only to `dist/index.d.ts`.
    Because the package is `"type": "module"`, a CommonJS consumer on `moduleResolution: node16` or
    `nodenext` got **TS1479** and could not typecheck against the package, even though `require()`
    worked at runtime and returned every export. This shipped in 0.1.0 too, and needs no change on
    your side.

  ### Added

  `previewBorrow`, `previewRefinance`, `getBorrowingCapacity`, `diagnoseRevertedWrite`, a
  `GasDecision` on every write result, `ExceedsBorrowingCapacity`, and `gasMarginPercent` on
  `createMusdClient`.

  ### Known limits at 0.2.0, both documented rather than fixed

  - **`maxFeePercentage` is advisory only (MK-011).** It does not bind the contract.
  - **`addCollateral` and `repay` have no preview, and the contract DOES gate them (MK-038).** In
    normal mode a top-up that raises ICR still reverts if the result is under MCR, so an already
    under-water position cannot be partly rescued. `withdrawCollateral` and `adjustTrove` have no
    preview either. Four of eleven writes are ratio gated with no verdict you can render first.

## 0.1.0

### Minor Changes

- Initial public release as **0.1.0**, v1 feature-complete and publish-ready.

  - `@musd-kit/core`: the framework-agnostic SDK, Trove lifecycle, insertion hints, preview math, the live two-source reads, the full discriminated `MusdError` taxonomy, and the redemption + permissionless-liquidate keeper surface. Validated against forked Mezo.
  - `@musd-kit/react`: wagmi-idiomatic hooks over the core (block-watching reads, mutation writes, typed errors), consuming Passport's wagmi context, no provider of its own.

  Pre-1.0 (`0.x`) per the maturity gate: community tooling, for testnet and evaluation. Not affiliated with or endorsed by Mezo.
