---
# The previous sidebar entry is the static TypeDoc API subsite (opened in a new tab), not a
# VitePress route, so skip it in the pager to avoid a client-side-routed 404. Point at the prior doc.
prev:
  text: Ground truth (verified facts)
  link: /01-ground-truth
---

# Testing (the correctness gate)

The test strategy *is* the product strategy, because correctness is the product. A
library whose value is "the numbers are right near the liquidation threshold" earns
that claim only by proving its outputs against the **real contracts**, not mocks and
not the prose formula.

---

## 1. The forked-Mezo harness (Phase 0, built first)

Nothing in `musd-kit` is trusted until CI can run a transaction against a fork of
the *real* MUSD contracts.

- **Fork the chain at a pinned block.** Use an EVM fork (Anvil/Foundry-style, or a
  viem test client against a forked RPC) of Mezo testnet (31611) or mainnet (31612).
  The harness reads `MEZO_FORK_BLOCK` and passes it to anvil as `--fork-block-number`;
  CI sets it (`.github/workflows/ci.yml`), so the fixture no longer drifts with live
  testnet state. Locally, leaving it unset forks at `latest`.
- **Seed the price at that same block.** Mezo's BTC/USD oracle lives at a native
  precompile served by the node's Cosmos oracle module, not by EVM bytecode, so a fork of
  it reverts and the harness seeds a shim from an upstream read instead. That read is
  anchored to the fork's own block, so the fork block determines the price as well as the
  chain state (MK-020). If the endpoint has pruned that block, the harness falls back to a
  recorded seed for exactly that block and says so loudly, and refuses outright for any
  other block rather than seed a price that does not belong to the forked state.

::: warning What pinning does and does not buy you
Pinning fixes the *starting chain state*, and since MK-020 it fixes the starting price
too. One thing it still does **not** fix, and we should not claim it does.

**It is not order independence.** The whole `fork` project shares ONE anvil instance, and
several files warp the EVM clock forward (phase2 30d, phase4 45d, phase6 1y). Those warps
are cumulative and leak into every later file, so the suite is one stateful sequence held
together by an alphabetical sequencer (`vitest.config.mts`), not a set of independent
tests. When a file's setup fails, later files fail as a consequence rather than on their
own merits, which makes a red run harder to read than it should be.

**It did not used to pin the price, and now it does.** The oracle shim was seeded from a
`latestRoundData()` read at the upstream chain's `latest` rather than at the forked block,
so four runs at the same `MEZO_FORK_BLOCK` saw four different BTC/USD prices. That was
MK-020, and it is fixed: the seed is now read at the fork's own anchor block. The harness
prints the seeded answer **and the block it came from** at startup, so any future
divergence is visible in the log rather than inferred from a failure.

The ordering coupling is a known structural limit, tracked under MK-016. Pinning the
block was one fix, not the fix.
:::
- **Smoke test (the Phase-0 gate):** read `PriceFeed.fetchPrice()` and `MCR` **from
  the fork** (not a mock) and assert a real price and `1.1e18`. If this passes
  twice identically in CI, the harness is real.
- **Clock control:** the harness can warp time forward (to test interest accrual,
  C3) and mine blocks.
- **Funding:** a helper to give a test account BTC (gas + collateral) on the fork so
  it can open Troves.

Addresses come from `01-ground-truth` §4; ABIs are the bundled ones.

---

## 2. The test pyramid

| Layer | What | Where it runs |
|---|---|---|
| **Unit** | pure functions: NICR/ICR/liqPrice formulas, fee arithmetic, error guards, address resolution, unit helpers | in-process, no chain |
| **Fork integration (the binding tests)** | open/adjust/repay/close/redeem/liquidate real Troves; compare SDK output to the contract getters | against the fork |
| **Dual-validation** (`05` §5) | preview math vs actual-on-fork **and** vs the contract `pure` helpers | against the fork |
| **React** | hooks render, read, and write correctly; refetch on new blocks | RTL + a fork-backed wagmi config |
| **Example E2E** | both examples run end-to-end | against the fork/testnet |
| **Pre-publish pack smoke** | the packed tarballs clean-install and import (ESM + CJS + types), and ship only `dist` + README + LICENSE | CI, every push, **before** and without publishing |
| **Post-publish registry check** | `npm install` of the **published** version from the registry into an empty directory, then import it | the release workflow, **after** publish |

**Two projects, and the unit layer really is chain-free.** `vitest.workspace.mts` defines
a `unit` project (no `globalSetup`, no anvil, no RPC URL) and a `fork` project (the
`*.fork.test.ts` files against the shared anvil fork). Run them with `pnpm test:unit`,
`pnpm test:fork`, or both with `pnpm test`. CI runs `pnpm test:unit` before Foundry is
installed and with no RPC secret in scope, so the claim in the Unit row above is
enforced rather than asserted.

**Pre-publish is not post-publish.** `scripts/release-smoke.sh` installs from locally
packed tarballs and never contacts the registry; it says so in its own header. It cannot
catch a bad publish. The post-publish row above is a separate job in
`.github/workflows/release.yml` that runs only after the publish step.

**No mocks for protocol truth.** Mocks are permitted only for wallet-client
plumbing in React tests. Anything asserting protocol behavior runs on the fork.

---

## 3. The boundary corpus (mandatory)

Every release must pass these scenarios, they are the "everyone gets it wrong"
cases:

1. **`minNetDebt` floor**, open with `draw + fee` just under (expect
   `BelowMinimumDebt`) and just over (expect success). (C1/C6/O7)
2. **Near-MCR position**, ICR just above MCR (not liquidatable) and just below
   (liquidatable + a successful liquidation).
3. **Interest-accrued position**, warp the clock, confirm `getTrove.entireDebt`
   grew and matches `getEntireDebtAndColl`, and that `liquidationPrice` rose. (C3)
4. **Recovery Mode**, drive `TCR < CCR`; confirm `getSystemState.isRecoveryMode`
   and that previews/borrowing-power reflect the tightened rules and the right
   reverts fire. (O3)
5. **Redemption truncation**, a redemption large enough to hit the `minNetDebt`
   floor on the last Trove; confirm `truncatedAmount` and the actual redeemed amount
   agree.
6. **Redemption fee**, confirm a loan-holder and a no-loan redeemer BOTH pay the live
   `redemptionRate()` (the "0% for loan holders" rule was disproven on the fork in Phase 6;
   see `01-ground-truth.md` §8).
7. **Full lifecycle**, open → addColl → borrow → repay → withdrawColl → refinance →
   close; assert state at each step and that the 200 gas reserve returns on close.

---

## 4. Coverage gates

- `math/`, `hints/`, `read/`, `errors/` carry the **highest** coverage, target
  near-complete branch coverage. These are the correctness-critical modules.
- A coverage floor is enforced in CI for the `core` package; PRs that drop below it
  fail. It is configured in `vitest.config.mts` (`coverage.thresholds`, v8 provider over
  `packages/core/src/**`, excluding `_generated/` which is ABI and address data rather
  than logic) and run by `pnpm test:coverage` in the fork-gate job.
- **The floor is a ratchet: it only ever moves upward.** It was set to the honestly
  measured number rounded down, not to an aspiration. Raise it when real coverage rises.
  Never lower it to turn a red build green, that converts the gate into decoration.
- **Scope, stated so the number cannot mislead.** `pnpm test:coverage` runs **both**
  vitest projects, so the fork suite counts toward the measurement, not just the unit
  layer. What is measured is `packages/core/src/**` minus `_generated/`.
  **`@musd-kit/react` is not measured at all**, even though it is a published package: no
  file under `packages/react/src` appears in the coverage report, so the floor says
  nothing about the hook layer. Its fork tests do run and must pass; they simply do not
  contribute to, or get graded by, the gate. Bringing it under the gate needs its own
  measured floor and is not done yet.
- Coverage is necessary but not sufficient: a line covered by a mock proves nothing
  about protocol truth, the fork tests are what count. A high floor over
  `previewOpen` would not have caught MK-005 or MK-006, both of which are fully covered
  and wrong.

---

## 4a. The differential harness (verdict against chain outcome)

`packages/core/test/differential.fork.test.ts`. For each generated case it runs the SDK
preview, then **actually attempts the operation on the fork**, then asserts the verdict matches
whether the transaction succeeded.

**Why it exists, and why it is not more formula checks.** The formula level cross checks against
the contract's own `pure` helpers already exist and are green (`09-review-and-validated-surface`
§3). They could not have caught MK-004, MK-005 or MK-006, because all three were preview
**verdicts** that disagreed with the chain while every formula agreed.

**Two failure directions, always reported separately**, because they are not equally bad:

| Direction | What it means | What it costs a user |
|---|---|---|
| `FALSE_VIABLE` | the preview said go, the chain refused | a failed transaction, gas spent |
| `FALSE_BLOCKED` | the preview said no, the chain would have accepted | access to their own position, silently |
| `NUMBERS` | verdicts agreed, a predicted number missed | a wrong figure in the UI |

**Generation is seeded and boundary weighted**, 60% boundary / 20% extreme / 20% middle, stated
in `BAND_WEIGHTS` rather than tuned quietly. A uniform sweep spends its budget in the middle of
the space where nothing has ever been wrong; every S1 in this repository lived at a boundary.
The boundary band targets the debt floor, the MCR and CCR thresholds and zero, each jittered one
wei either side.

**Every case runs in its own `evm_snapshot` and reverts.** Cases must not see each other, or a
failure becomes a function of everything before it and the seed stops reproducing it.

```sh
pnpm test:fork                                    # the push subset, MK_DIFF_CASES defaults to 24
MK_DIFF_CASES=1000 pnpm test:fork                 # the full sweep
MK_DIFF_SEED=123 MK_DIFF_CASE=57 pnpm test:fork   # replay exactly one case
```

**The seed is printed on every run, passing or failing.** A seed only visible on failure is a
seed nobody has when they need it.

### Placement, decided from the measured cost

Measured on the declared Node at the pinned block, not estimated:

| | |
|---|---|
| per case, fresh anvil | **about 3 seconds** |
| per case, late in a long run | **about 20 seconds** |
| 1000 cases | **about 96 minutes**, across two slices |

**The degradation is the interesting number.** The first 800 cases of a sweep ran at 3 to 4
seconds each; the next hundred took 2008 seconds, about 20 seconds each. A separate run of 120
cases against a fresh anvil came back to 3 seconds each. So the cost grows with the LIFE of the
anvil process, not with the case index, which is why `MK_DIFF_FROM` exists: it slices the same
generated set across runs rather than generating a different set.

**The split, and the reasoning.**

- **On every push: 24 cases**, the default, about 90 seconds on a fresh fork. It is deterministic
  from a fixed seed, so it is a gate rather than a lottery, and it is small enough to sit beside
  a fork suite that already takes about 50 seconds.
- **The full 1000 case sweep: on demand and on a schedule, never on push.** A ninety minute job
  on the push path would make every merge wait for it, and people would start skipping it.
- **It is not hidden either**, which is the other failure mode. `docs/08-conventions.md` §10 is
  where a wave's obligations live, and the sweep belongs in a wave's acceptance when preview or
  math code changed, with the seed reported.

**The fork state cache applies**, verified rather than assumed: these runs used
`~/.foundry/cache/rpc/31611/15043414` like every other fork test, and the harness warm up
reported the usual `fork state warmed in 5xms (230 sorted Troves)` rather than a cold refetch.

## 5. Determinism & CI matrix

- **Determinism:** the fork is pinned to a block (`MEZO_FORK_BLOCK` in
  `.github/workflows/ci.yml`) and the oracle seed is read at that same block, so the price
  is pinned with it; randomized tests (hint trials, math grids) use a **fixed seed**. Read
  the warning in §1: pinned is not order independent.
- **Fork state caching.** anvil lazily fetches upstream state on first access and persists
  it per pinned block under `~/.foundry/cache/rpc/<chainId>/<block>/`. The harness stops
  anvil with `SIGTERM` so that cache is actually written; it used to `SIGKILL`, so every
  run refetched everything and the first hint computation cost 849 sequential
  `eth_getStorageAt` round trips (MK-021). CI restores that directory keyed on the block.
  The key and the path both carry the block number and there is no prefix fallback, on
  purpose: replaying one block's state at another block would undo MK-020.
- **CI matrix:** the chain-free half (lint, path guard, build, typecheck, examples, and
  the `unit` project) runs on **Node 20, 22, and 24**. Against the official
  `nodejs/Release` schedule, checked rather than assumed: **24 is Active LTS**, **22 is
  Maintenance LTS**, and **20 reached end of life on 30 Apr 2026**. So the matrix covers
  current and previous LTS, and keeps Node 20 because users are still on it. `engines.node`
  is set to the lowest version the matrix actually runs (`>=20.20.2`, the final Node 20
  release, which that leg resolves to), and `.nvmrc` tracks the Active LTS: **`engines`
  states what we test, `.nvmrc` states what we develop on** (`08-conventions` §1). The fork
  gate and the coverage floor run once, on the `.nvmrc` toolchain, because that gate is
  chain-bound rather than runtime-bound. **That last clause has since been falsified and is
  kept here so the correction is visible where the claim was made**: the fork gate broke on a
  purely runtime-bound difference, jsdom's `AbortSignal` against Node 24's undici, and stayed
  broken for four runs because the one Node it pins was not the Node anyone ran locally
  (MK-028, MK-029). Whether that gate should be matrixed, or pinned to the lowest supported
  Node rather than the newest, is an open decision. For
  `@musd-kit/react`, the pack smoke installs against the **verified peer floors**
  (`wagmi 2.5.12` / `viem 2.22.8` / `@tanstack/react-query 5.28.4` / `react 18.2.0`) to
  catch resolution drift before users hit it.
- **A separate Node question, recorded and NOT acted on here.** Every CI run currently emits
  this warning four times, verbatim:

  > Node 20 is being deprecated. This workflow is running with Node 24 by default. If you need
  > to temporarily use Node 20, you can set the `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION=true`
  > environment variable. For more information see
  > `https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/`

  Read it carefully, because it is easy to mistake for a statement about our matrix and it is
  not one. It is about the Node runtime GitHub uses to execute a JavaScript **action**, and it
  fires only on the actions still declaring `node20`: `pnpm/action-setup@v4` (twice, main and
  post), `actions/cache@v4`, and `actions/upload-artifact@v4`. `actions/checkout@v5` and
  `actions/setup-node@v5` do not warn. Nothing in the message concerns the Node versions our
  code is tested against, and the runner is already forcing those actions onto Node 24
  regardless. No action taken in this pull request, deliberately: the matrix question and the
  action-version question are separate decisions and are worth taking separately.
- **Gates wired to phases:** each build phase has a
  named test gate; CI does not let a phase's PR merge unless its gate is green.

---

## 6. What a passing build asserts (the headline invariants)

- `getCurrentICR(addr, price) == computeCR(coll, getEntireDebtAndColl.debt, price)`
  for every opened position.
- `previewOpen(x).entireDebt == getEntireDebtAndColl(addr).debt` after opening `x`.
- `previewOpen(x).meetsMinimum == false` ⟺ `openTrove(x)` reverts `BelowMinimumDebt`.
- SDK NICR `== computeNominalCR(coll, entireDebt)` exactly.
- Every mapped error is reachable by a real revert on the fork.
- Both examples build and run; the keeper imports no React.

---

## 7. On-chain facts (`pnpm facts`, manual)

`scripts/onchain-facts.ts` reads the governable values, the cross wiring, the proxy
implementations, and the fee exemption set from **both** chains at a **pinned block per
chain**, and writes the result between the markers in
[`09-review-and-validated-surface`](/09-review-and-validated-surface) §6. It is read only:
it builds a viem *public* client only, so it has no signing path, needs no private key, and
never accepts one. Endpoints come from the environment and are never printed or committed.

```sh
export MEZO_TESTNET_RPC_URL=<a Mezo testnet (31611) endpoint>
export MEZO_MAINNET_RPC_URL=<a Mezo mainnet (31612) endpoint>
# Optional per chain, and worth setting: a SECOND, independent endpoint. The fee exemption
# answers behind MK-018 are re-read through it at the same pinned block and confirmed.
export MEZO_MAINNET_RPC_URL_SECOND=<a different Mezo mainnet endpoint>
pnpm facts            # rewrites the generated block in docs/09
pnpm facts --stdout   # prints it instead, changes nothing
```

Either endpoint may be omitted; a chain without one is reported as missing in full rather
than as a partial table, because a partial table reads as complete.

**It is deliberately NOT in push CI.** It needs live endpoints and runs a genesis-to-pin log
scan of a few thousand chunked `eth_getLogs` calls, so a network hiccup would redden an
unrelated pull request. It is a manual gate.

**When to run it.** Regenerate **before any release**, and whenever you are about to cite one
of those values. The values are governable and can change without notice, which is the whole
reason each is recorded with its block: a value without a block number is a memory, not a
fact. Bumping a pinned block changes every recorded value, so it belongs in its own commit
with the reason stated.

The output is **byte identical across runs at the same pinned block**: no wall clock, no run
id, and every table ordered by an explicit list rather than by map iteration. If two runs
ever differ, that is a defect in the script or a reorg at the pin, not noise to be ignored.
