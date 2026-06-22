# Conventions

Engineering standards for `musd-kit`. The goal is a codebase that reads as one
author's, where the boring decisions are already made so attention goes to
correctness.

---

## 1. Toolchain (pinned)

- **Node:** LTS, pinned via `.nvmrc` / `engines`.
- **Package manager:** `pnpm` workspaces. Lockfile committed. (Matches the Mezo/wagmi
  ecosystem.)
- **Language:** TypeScript, `strict: true` (and `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes` where practical). No `any` in shipped code; `unknown`
  + narrowing instead.
- **Build:** `tsup` (or equivalent) → ESM + CJS + `.d.ts`. `sideEffects: false`.
- **Lint/format:** ESLint + Prettier (or Biome), one config at the root, enforced in
  CI.
- **Target:** the core targets a broad runtime (Node + browser, ES2020+); no
  Node-only APIs in `@musd-kit/core`.

---

## 2. Numbers, units, and precision

- **All on-chain amounts are `bigint`.** Never `number` for money. `number` is used
  only for `healthFactor` (a UI ratio) and trial counts.
- **Decimals:** BTC (native gas/collateral) and MUSD are both **18 decimals**. The
  oracle price is 1e18-scaled USD per BTC.
- **Unit helpers (export from core):**
  - `parseBtc('0.05') → bigint` (×1e18), `formatBtc(bigint) → string`
  - `parseMusd('2500') → bigint` (×1e18), `formatMusd(bigint) → string`
  - `parseBps(100) → bigint` (100 bps = 1%), for fee/rate inputs
- **Fixed-point math:** multiply before divide; mirror the contract's order of
  operations exactly where reproducing a contract computation, to avoid off-by-one
  rounding (the dual-validation in `05` §5 catches divergence).
- **Constants:** the fixed ones (`MCR`, `CCR`, `GAS_COMPENSATION = 200e18`,
  `PERCENT_DIVISOR`, `DECIMAL_PRECISION`) live in one `constants.ts`. Governable ones
  are **never** constants, they are read.

---

## 3. viem patterns

- The core uses **viem's actions style** (`readContract`/`simulateContract`/
  `writeContract`), typed against the bundled ABIs.
- **Reads:** `publicClient.readContract({ address, abi, functionName, args })`.
- **Writes:** simulate then write where the simulation adds safety; surface the
  mapped error on revert (`06-errors`).
- **No ethers.** The whole point over Mezo's raw-ethers docs is a typed viem layer;
  do not introduce ethers.
- **ABIs** are `as const` for full type inference. Bundle from the repo
  interfaces/artifacts; do not hand-transcribe signatures (transcription is an
  assumption).

---

## 4. Naming & file layout

- **Public SDK names are human-intent** (`openTrove`, `borrow`, `repay`,
  `addCollateral`); the mapping to ABI functions (`withdrawMUSD`, `repayMUSD`, …)
  lives in `trove/` and is documented inline with the ABI name. (`03-core-api` §4.)
- **Files:** one concern per file; `index.ts` re-exports the public surface of each
  module. Internal helpers are not exported from the package root.
- **Hooks:** `useXxx`, one per file under `react/src/hooks/`.
- **Errors:** `PascalCase` classes; `MusdErrorCode` enum values `SCREAMING_SNAKE`.

---

## 5. Documentation in code

- Every exported function has a TSDoc comment: what it does, the on-chain function
  it maps to (if any), units, and what it does **not** guarantee. The API reference
  (`10` / Phase 10) is generated from these (TypeDoc).
- Any place that reproduces a contract computation cites the source
  (`// see 01-ground-truth §6` / the contract function) so the reasoning is
  traceable.

---

## 6. Git, commits, PRs

- **Conventional Commits** (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`).
- **Small, focused PRs**, ideally one module/phase per PR, with its tests. A PR for
  a correctness module includes its fork-validated tests in the same PR.
- **CI must be green to merge** (lint + typecheck + unit + the relevant fork gate).
- **Changesets** (or equivalent) for versioning; every user-facing change has a
  changelog entry.

---

## 7. Release & provenance

- **SemVer.** `0.x` while the surface stabilizes; `1.0` only when v1 scope ships and
  the maturity gate (§8) is met. `MusdErrorCode` and exported types are part of the
  public contract, renames are breaking.
- **npm publish with provenance.** Tag every release; sign the build provenance.
- **Reproducible builds:** committed lockfile, pinned toolchain.
- **Two packages publish together** at v1: `@musd-kit/core`, `@musd-kit/react`. A
  post-publish install smoke test runs in CI.

---

## 8. The honesty gate (maturity)

Until (a) the fork suite is green at the coverage floor and (b) ideally one
third-party trial exists, the README and npm description state plainly: **community
(not official) tooling, for testnet and evaluation.** Every write path documents
what it does on-chain and what it does not guarantee. Only then does the language
soften and 1.0 ship. An SDK that oversells its maturity is dangerous because
applications trust it.

---

## 9. Naming the package

`musd-kit` is **provisional**, a trademark/availability check precedes any public
launch. "MUSD" is Mezo's asset, so the README must frame the package explicitly as
unofficial community tooling to avoid implying endorsement. Candidate alternates if
the check fails: `musd-sdk`, `use-musd`, `trovekit`, `mezofi-kit`. The npm scope and
identifiers track whatever survives the check.
