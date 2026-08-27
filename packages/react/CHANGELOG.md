# @musd-kit/react

## 0.2.0

### Minor Changes

- **Purely additive at the hook level, but it re-exports `@musd-kit/core`, where 0.1.0 returned wrong
  numbers on seven surfaces.** Read the `@musd-kit/core` entry and
  `docs/11-migration-0.1-to-0.2.md` before upgrading; the shape changes to `OpenPreview` and
  `RedeemResult` reach you through `useOpenTrove`, `useRedeem` and the preview hooks.

  ### Added

  - **`useBorrowPreview`**, the verdict for a borrow against an existing position, including the
    borrowing capacity gate that 0.1.0 did not model at all (MK-002).
  - **`useBorrowingCapacity`**, the capacity itself. It ratchets DOWN and never rises, which is a
    property of the protocol rather than of this SDK.
  - **`useRefinancePreview`**, which tells you before you send that refinancing reverts in Recovery
    Mode (MK-019).
  - Query keys for all three on `musdQueryKeys`.

  ### Fixed

  - **The export map never pointed at the CommonJS type declarations it ships (MK-040).** A CommonJS
    consumer on `moduleResolution: node16` or `nodenext` got TS1479 and could not typecheck against
    this package. Runtime `require()` was unaffected. This shipped in 0.1.0 too.
  - **A passing test logged an uncaught React error into CI output (MK-033).** No runtime change to
    the hooks; the noise is gone.

### Patch Changes

- Updated dependencies
  - @musd-kit/core@0.2.0

## 0.1.0

### Minor Changes

- Initial public release as **0.1.0**, v1 feature-complete and publish-ready.

  - `@musd-kit/core`: the framework-agnostic SDK, Trove lifecycle, insertion hints, preview math, the live two-source reads, the full discriminated `MusdError` taxonomy, and the redemption + permissionless-liquidate keeper surface. Validated against forked Mezo.
  - `@musd-kit/react`: wagmi-idiomatic hooks over the core (block-watching reads, mutation writes, typed errors), consuming Passport's wagmi context, no provider of its own.

  Pre-1.0 (`0.x`) per the maturity gate: community tooling, for testnet and evaluation. Not affiliated with or endorsed by Mezo.

### Patch Changes

- Updated dependencies
  - @musd-kit/core@0.1.0
