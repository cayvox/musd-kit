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

::: warning What pinning does not buy you
Pinning fixes the *starting chain state*. Two things it does **not** fix, and we should
not claim it does.

**It is not order independence.** The whole `fork` project shares ONE anvil instance, and
several files warp the EVM clock forward (phase2 30d, phase4 45d, phase6 1y). Those warps
are cumulative and leak into every later file, so the suite is one stateful sequence held
together by an alphabetical sequencer (`vitest.config.mts`), not a set of independent
tests. When a file's setup fails, later files fail as a consequence rather than on their
own merits, which makes a red run harder to read than it should be.

**It does not pin the price.** The oracle shim is seeded from a live
`latestRoundData()` read against the upstream RPC at `latest`, not at the pinned block
(`packages/core/test/harness/oracle.ts:52-62`). Two runs at the same
`MEZO_FORK_BLOCK` therefore see different BTC/USD prices, which is observable: the
harness logs the seeded answer at startup. Tests that assert against thresholds near MCR
are exposed to this.

Both are known structural limits, tracked under MK-016. Pinning the block was one fix,
not the fix.
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
- Coverage is necessary but not sufficient: a line covered by a mock proves nothing
  about protocol truth, the fork tests are what count. A high floor over
  `previewOpen` would not have caught MK-005 or MK-006, both of which are fully covered
  and wrong.

---

## 5. Determinism & CI matrix

- **Determinism:** the fork is pinned to a block (`MEZO_FORK_BLOCK` in
  `.github/workflows/ci.yml`); randomized tests (hint trials, math grids) use a **fixed
  seed**. Read the warning in §1: pinned is not order independent.
- **CI matrix:** the chain-free half (lint, path guard, build, typecheck, examples, and
  the `unit` project) runs on **Node 20, 22, and 24**, covering the range the packages
  advertise in `engines` (`>=20.11.0`). The fork gate and the coverage floor run once, on
  the pinned toolchain in `.nvmrc`, because that gate is chain-bound rather than
  runtime-bound. For `@musd-kit/react`, the pack smoke installs against the **verified
  peer floors** (`wagmi 2.5.12` / `viem 2.22.8` / `@tanstack/react-query 5.28.4` /
  `react 18.2.0`) to catch resolution drift before users hit it.
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
