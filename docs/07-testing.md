# 07 — Testing (the correctness gate)

The test strategy *is* the product strategy, because correctness is the product. A
library whose value is "the numbers are right near the liquidation threshold" earns
that claim only by proving its outputs against the **real contracts**, not mocks and
not the prose formula.

---

## 1. The forked-Mezo harness (Phase 0 — built first)

Nothing in `musd-kit` is trusted until CI can run a transaction against a fork of
the *real* MUSD contracts.

- **Fork the chain at a pinned block.** Use an EVM fork (Anvil/Foundry-style, or a
  viem test client against a forked RPC) of Mezo testnet (31611) or mainnet (31612).
  Pin the block so the suite is deterministic across CI runs.
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
| **Post-publish** | `npm install` of the published packages works in a fresh project | CI, after publish |

**No mocks for protocol truth (Law 5).** Mocks are permitted only for wallet-client
plumbing in React tests. Anything asserting protocol behavior runs on the fork.

---

## 3. The boundary corpus (mandatory)

Every release must pass these scenarios — they are the "everyone gets it wrong"
cases:

1. **`minNetDebt` floor** — open with `draw + fee` just under (expect
   `BelowMinimumDebt`) and just over (expect success). (C1/C6/O7)
2. **Near-MCR position** — ICR just above MCR (not liquidatable) and just below
   (liquidatable + a successful liquidation).
3. **Interest-accrued position** — warp the clock, confirm `getTrove.entireDebt`
   grew and matches `getEntireDebtAndColl`, and that `liquidationPrice` rose. (C3)
4. **Recovery Mode** — drive `TCR < CCR`; confirm `getSystemState.isRecoveryMode`
   and that previews/borrowing-power reflect the tightened rules and the right
   reverts fire. (O3)
5. **Redemption truncation** — a redemption large enough to hit the `minNetDebt`
   floor on the last Trove; confirm `truncatedAmount` and the actual redeemed amount
   agree.
6. **Fee-is-zero-for-borrower** — a redeemer who holds a loan pays 0%; one who does
   not pays the current rate.
7. **Full lifecycle** — open → addColl → borrow → repay → withdrawColl → refinance →
   close; assert state at each step and that the 200 gas reserve returns on close.

---

## 4. Coverage gates

- `math/`, `hints/`, `read/`, `errors/` carry the **highest** coverage — target
  near-complete branch coverage. These are the correctness-critical modules.
- A coverage floor is enforced in CI for the `core` package; PRs that drop below it
  fail.
- Coverage is necessary but not sufficient: a line covered by a mock proves nothing
  about protocol truth — the fork tests are what count.

---

## 5. Determinism & CI matrix

- **Determinism:** the fork is pinned to a block; randomized tests (hint trials,
  math grids) use a **fixed seed**; the suite must pass twice identically.
- **CI matrix:** Node LTS (current + previous). For `@musd-kit/react`, build against
  the **verified peer floors** (`wagmi 2.5.12` / `viem 2.22.8` /
  `@tanstack/react-query 5.28.4` / `react 18.2.0`) to catch resolution drift before
  users hit it.
- **Gates wired to phases:** each Roadmap phase (`musd-kit-Roadmap.md` §4) has a
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
