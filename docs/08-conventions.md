# Conventions

Engineering standards for `musd-kit`. The goal is a codebase that reads as one
author's, where the boring decisions are already made so attention goes to
correctness.

---

## 1. Toolchain (pinned)

- **Node:** `engines` states what we **test**, `.nvmrc` states what we **develop on**. So
  `engines.node` is the lowest version the CI matrix actually runs (`>=20.20.2`, the final
  Node 20 release, which the matrix's oldest leg resolves to), and `.nvmrc` tracks the
  Active LTS (24.19.0). Checked against the `nodejs/Release` schedule rather than assumed:
  Node 24 is Active LTS, 22 is Maintenance LTS, and 20 reached end of life on 30 Apr 2026.
  Node 20 stays in the matrix because users are still on it; developing on it is a
  different question from supporting it, which is exactly what the two files separate.
  **CI runtime versions are declared in the workflow, never inherited from the development
  pin:** no job reads `node-version-file: .nvmrc`, because a change to the version a
  contributor develops on must never silently change what CI executes. It did once, and the
  fork gate stayed red for four runs on a Node no local run had used (MK-029).
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
- **Two packages publish together** at v1: `@musd-kit/core`, `@musd-kit/react`. Two
  distinct install checks guard that, and they are not the same thing: CI runs a
  **pre-publish** pack smoke on every push (`scripts/release-smoke.sh`, from locally
  packed tarballs, no registry contact), and the release workflow runs a
  **post-publish** check that installs the published version from the registry into an
  empty directory and imports it. See `07-testing` §2.

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

---

## 10. The wave checklist (standing, not advice)

A wave is not done until every line below has been **run and reported**. Reported means the
actual output, in the pull request body. "It passed" is not a report, and neither is a
selected window.

| # | Command | What must be reported |
|---|---|---|
| 1 | `pnpm test:unit`, with `MEZO_TESTNET_RPC_URL` unset and `anvil` off `PATH` | The pass count, and evidence the chain was genuinely absent |
| 2 | `pnpm test:fork`, five consecutive runs, **on the Node version the fork gate declares** (`node-version` in `.github/workflows/ci.yml`, currently 24.19.0) | **All five results, in full**, and **the Node version they ran on** (`node -v`). Every red run attributed to an existing MK ID or registered as a new one. The seeded answer, which must be byte identical across all five |
| 3 | `pnpm test:coverage` | All four metrics against the ratchet. A metric below its floor is fixed with tests, never by lowering the floor |
| 4 | `pnpm typecheck` | Clean |
| 5 | `pnpm -r --filter "./examples/*" typecheck` | Clean |
| 6 | `pnpm lint` | Clean |
| 7 | `pnpm build:site` | Clean, which includes `pnpm check:links` |
| 8 | **Read the CI run for the branch.** `gh run list --branch <branch> --workflow CI` then `gh run view --job <id> --log` for every job that is not green | The run link, its conclusion, and the first real failure in any red job. Local green does not stand in for this |
| 9 | **Read the CI run on `main` after the merge, WAITING for it to exist.** `gh run list --branch main --workflow CI --limit 5 --json conclusion,headSha` and match the `headSha` against `git rev-parse HEAD`. An absent run means **not yet**, not never: poll until it appears, and only report absence as a finding if it persists | The run link, its conclusion, and that its `headSha` is the tip rather than an ancestor. **A red `main` blocks the next wave**: repair it first, and register the cause before fixing it |

**Why this list exists, and why it is written as a rule rather than a suggestion.** Steps 5
and 7 were absent from two waves' acceptance criteria. A broken example consequently reached
`main` through step 5, which CI runs, so CI was red on a merged pull request and nobody
noticed, because nobody ran the step locally and nothing asked them to (MK-027).

Steps 8 and 9, and the Node version requirement in step 2, were added after the first version
of this list, and the reason is worth keeping. This section was written the day before anyone
read a CI run, and it did not survive contact with one: `main` had been red on five
consecutive merges. Steps 1 through 7 would not have caught a single one of them. A checklist
that can be completed in full while the repository's own gate is red is not a checklist, and
the fix is more lines, not a stronger adjective on the ones already there.

Each of the three closes one specific absence that produced MK-029.

- **Step 2's Node requirement** exists because local and CI evidence cannot be compared unless
  they ran the same runtime. Five green local runs on Node 20.20.1 and four red fork gate runs
  on 24.19.0 were all reporting honestly and were never in contradiction. Running the fork
  suite on the version the gate declares is what turns "it passed here" into evidence about
  the build rather than about a laptop.
- **Step 8** exists because nothing pointed at CI at all. The PR 8 report even said in as many
  words that CI had not been checked. Saying so is not the same as looking.
- **Step 9** exists because a branch being green does not make `main` green, and because five
  red merges accumulated with no rule anywhere that treated the second one as a reason to
  stop. A red trunk is not a backlog item; it is the next wave.

  It was then executed wrongly twice, which is MK-036. The wording said "read the CI run" and
  had no answer for "the run does not exist yet", so two reports read an empty listing seconds
  after a merge and concluded that merges were not triggering CI. One of those merges was RED.
  A check whose failure mode is indistinguishable from its not-yet mode is not a check, which
  is why the step now says to wait, and to match the run's `headSha` against the tip so the
  answer cannot come from an ancestor.

**Local green is evidence about your machine, not about the build.** The `Checks` jobs run a
Node matrix; the fork gate runs the single Node its workflow declares, and that is not
necessarily one you have. When local and CI disagree, the first question is which Node, which
`environment`, and which cache state each of them used, not which one is lying (MK-028).

**The pass rules.**

- **Report the whole window, never the best one.** Five runs with one red is a five run
  window with one red. Quoting the four green ones misrepresents the suite's reliability, and
  the reliability is itself a tracked finding (MK-016, MK-022 through MK-026).
- **Attribute every failure before calling it a flake.** A consistent failure is a
  regression, not noise: five out of five identical failures is the signal that something
  landed broken. If a failure does not match an existing finding, it gets its own ID, because
  a flake without an entry is indistinguishable from a regression when it reappears.
- **Coverage floors only ever move up.** They are a ratchet.
- **A green signal must mean what a reader will assume it means.** If a gate does not cover
  something, say so where the gate is claimed, rather than letting the word "clean" carry more
  than it earned.
