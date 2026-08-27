# @musd-kit/core

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
