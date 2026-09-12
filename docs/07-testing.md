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
catch a bad publish. The post-publish check is `.github/workflows/verify-published.yml`,
called by the release workflow after the publish step **and** dispatchable on its own
against any published version:

```sh
gh workflow run verify-published.yml --ref main -f version=0.2.0
```

**It is dispatchable because it never ran otherwise** (MK-053). As a job welded to
`needs: publish` it could only execute by publishing, so it went two releases without once
producing a verdict, and its first execution failed in `Setup Node` before any step ran. A
gate that can only run as part of the thing it gates cannot be tested.

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
- **The floor is a ratchet: it only ever moves upward at a fixed scope.** It is set to the
  honestly measured number rounded down, not to an aspiration. Raise it when real coverage
  rises. Never lower it to turn a red build green, that converts the gate into decoration.
- **Widening the scope is the one thing that can move a floor down, and it did in P17.**
  Including `packages/react/src` took the reported figures from 98.65 / 93.20 / 100 / 98.65
  (core alone) to 94.87 / 92.36 / 88.18 / 94.87 (both packages), measured in one run at fork
  block 15043414. The core half did not get worse; it improved. Keeping the glob narrow to
  protect the number is the failure this rule exists to prevent, so the move is recorded
  rather than avoided. Floors are now 94 / 92 / 88 / 94.
- **Scope, stated so the number cannot mislead.** `pnpm test:coverage` runs **both**
  vitest projects, so the fork suite counts toward the measurement, not just the unit
  layer. What is measured is `packages/core/src/**` and `packages/react/src/**`, minus
  `_generated/`, which is ABI and address data rather than logic.
- **`@musd-kit/react` came under the gate in the P17 wave (MK-087), and the reported figure
  went DOWN.** That is the correct outcome and it is reported rather than excluded: the old
  number was high because it was scoped to the half that was tested. Before this, no file
  under `packages/react/src` appeared in the report at all, the mutation check had no React
  mutation, and the differential sweep drives the core client rather than rendering a hook.
  Three controls, one blind spot, and MK-085 was sitting in it: a shipped hook that made every
  adjust preview a debt increase, while a core test asserted the exact distinction it
  violated and passed. **A pin one layer below the defect is not a pin.**
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

**Recovery Mode is reachable, and it was not** (MK-058, MK-059). The generator's `pricePercent` is
applied BEFORE the fixture is seeded, so any multiplier low enough to put the system under CCR was
also a multiplier at which the seeding open was refused: every Recovery Mode case the generator
could express was a case it also skipped. `recoveryDrawdownPercent` is applied AFTER the fixture
exists, which is the whole difference. The sizes are read from the chain rather than picked: at the
pinned block the system TCR is 2.7731, so Recovery Mode needs the price below `CCR / TCR`, a
drawdown of 45.9 percent, and the generator uses 50, 60 and 70.

**And it is COUNTED, not assumed.** `CaseResult.isRecoveryMode` is read from the chain at the moment
the preview is taken, and the sweep reports Recovery Mode cases per operation and, for borrows, per
band. This matters more than it sounds: a 60 case run reached Recovery Mode 13 times and reached a
Recovery Mode BORROW zero times, because one operation in nine times one case in five is about 1.3
expected at that sample size. (That arithmetic was right for the nine operation generator it was
measured on; the P13 wave added a tenth, `borrowingPower`, so the same sample now expects about
1.2.) "The sweep reached Recovery Mode" would have been true and would have
proved nothing about the defect it was added for. Use `MK_DIFF_OP=borrow` over the full generation
to get a usable sample:

```sh
MK_DIFF_OP=borrow MK_DIFF_CASES=1000 MK_DIFF_SEED=20260826 pnpm test:fork
# P14 wave, ten operation generator, 464s, exit 0:
#   ran=81 skipped=3, Recovery Mode reached 20 of 81
#   Recovery Mode BORROWS by band: boundary 8, extreme 9, middle 3
#   FALSE_VIABLE=0 FALSE_BLOCKED=0 NUMBERS=0 threw=0
```

The 105 cases with 17 in Recovery Mode this example used to quote were measured on the nine
operation generator. Adding an operation changes the draw, so the counts move; what does not move is
that they are printed.

**A mode that never ran proves nothing**, which is MK-048's rule about bands applied to a mode.

**Set `MEZO_FORK_BLOCK` for every one of these.** Unset, the harness passes no
`--fork-block-number` and anvil forks at `latest` (`test/harness/anvil.ts:83-91`), which makes the
run non reproducible, uncached and slow, and seeds the oracle shim from whatever the chain was
doing at that second (MK-020, MK-082). CI sets it; your shell does not.

```sh
export MEZO_FORK_BLOCK=15043414                   # REQUIRED, see above
pnpm test:fork                                    # the push subset, MK_DIFF_CASES defaults to 24
MK_DIFF_CASES=1000 pnpm test:fork                 # the full sweep; use the four slices below
MK_DIFF_SEED=123 MK_DIFF_CASE=57 pnpm test:fork   # replay exactly one case

# The full sweep, in four slices with a fresh anvil each. One run does not fit.
# Measured P15 on the ten operation generator. Sweep only: 1593s, 1697s, 1719s, 1648s (111 min).
# Wall clock of the four invocations: 1678s, 1768s, 1799s, 1731s (116 min), the difference
# being the rest of the fork suite, which each slice also runs.
# The slices now exit 0: MK-079's ten FALSE_BLOCKED are registered in
# packages/core/test/differential/expected.ts, so they print as EXPECTED MK-079 lines and do
# not fail the run. A non zero exit is a mismatch NO finding explains, and is worth stopping for.
for FROM in 0 250 500 750; do
  MK_DIFF_CASES=1000 MK_DIFF_FROM=$FROM MK_DIFF_TO=$((FROM+250)) pnpm test:fork
done
```

**Why four slices and not one run.** Measured on the 0.2.0 release sweep: cases 1 to 100 took
582s, 5.8 seconds each, and cases 101 to 200 took 882s, 8.8 seconds each. The cost grows with the
LIFE of the anvil process, not with the case index, so a single thousand case run reaches the
test's own 90 minute timeout part way through and takes its results with it. A fresh anvil per
slice holds the per case cost near the first figure. `MK_DIFF_TO` exists for exactly this: without
an upper bound `MK_DIFF_FROM` can only cut a tail.

**And the per case figure depends on the RPC cache far more than on anything else**, which is worth
knowing before quoting one. From the MK-058 wave's five run window, the SAME 24 cases at the same
seed:

```
run 1  differential.fork.test.ts   847329ms    35.3 s/case    cold for the state these cases touch
run 2  differential.fork.test.ts   151759ms     6.3 s/case    warm
```

**`fork state warmed in Nms` does not tell you which side you are on.** That line times globalSetup's
sorted-list traversal (MK-021) and nothing else; it is about 30ms in both rows above. The state a
case touches when it opens a Trove at a price no earlier case used is fetched one slot at a time on
first touch, and that is what the 35 seconds is. A thousand distinct cases stay near the cold figure
throughout, because every one of them is a first touch. The push subset is the same 24 cases every
time and `ci.yml:199` caches the fork state between runs, so CI sits on the run 2 row.

**The seed is printed on every run, passing or failing.** A seed only visible on failure is a
seed nobody has when they need it.

### Placement, decided from the measured cost

Measured on the declared Node at the pinned block, not estimated:

**Every row names its cache state**, because that is the variable that dominates and the one a
figure here is most easily mistaken about (§13, and the correction in commit `949d361`). "Fresh
anvil" names the anvil's age, which is NOT the same thing: the same 24 cases cost 35.3 s/case with
the RPC cache cold for the state they touch and 6.3 s/case warm.

| | |
|---|---|
| per case, **RPC cache warm, developer laptop** | **4.9 to 6.6 seconds**, the means of two five run windows, 24 cases each: 6.6 (P15) and 4.9 (P16). One machine, one seed, one block |
| per case, **RPC cache warm, CI** | **2.5 seconds**, mean of three `ubuntu-latest` runs of `c3e1b6b`, cache hit confirmed in each log (MK-081) |
| per case, **RPC cache cold** | **35.3 seconds** (`949d361`); a thousand distinct cases stay near this, since each is a first touch |
| per case, late in a long run, cache warm | **about 20 seconds** |
| per case, `borrowingPower`, RPC counted | **3.0s, 32 JSON-RPC requests**, of which the solver accounts for 0.2s and 9 of them, all `eth_call` |
| per case, `borrow`, same method | **7.0s, 27 JSON-RPC requests** (the seeding open is 6.6s of it) |
| 1000 cases | **116 minutes of wall clock**, across four slices of 250, of which 111 is the sweep itself and the rest is the fork suite each slice also runs. Measured P15 |

**The degradation is the interesting number, and it has two causes that are easy to conflate.**
The first 800 cases of a sweep ran at 3 to 4 seconds each; the next hundred took 2008 seconds,
about 20 seconds each. A separate run of 120 cases against a fresh anvil came back to 3 seconds
each. That is anvil LIFE. Separately and larger, the RPC cache state moves the same 24 cases
between 6.3 and 35.3 seconds each (`949d361`). **Quote neither figure without saying which of the
two you are describing.** Anvil life is why `MK_DIFF_FROM` and `MK_DIFF_TO` exist: they
slice the same generated set across runs rather than generating a different set. `MK_DIFF_FROM`
alone could only cut a tail, so the slice needs a bound at both ends and the sweep is run as four
slices of 250.

**The slice size still works on the ten operation generator**, measured in the P15 wave: the four
slices took 1593s, 1697s, 1719s and 1648s, none close to the test's own 90 minute budget.

**MK-078 claimed otherwise and was withdrawn.** It reported 245 seconds per `borrowingPower` case
from a single run that was never repeated. Re-measured with the RPC counted, such a case costs 3.0
seconds and nine chain calls, which is CHEAPER than a `borrow` case, because a borrow case has to
seed a position first and this one does not. **anvil forks lazily from the upstream RPC**, so when
that link degrades every uncached read stalls and the harness looks slow; the run that produced the
245 was taken while it was failing, and the failure was caught in the act during P15 when two slices
died inside `startFork` with a DNS error and a third finished with 19 `InternalRpcError` throws. If
a sweep suddenly costs an order of magnitude more, **check the network before blaming the tree.**

**The split, and the reasoning.**

- **On every push: 24 cases**, the default. **On CI, about 60 seconds**, mean of three runs of
  commit `c3e1b6b`, each with `Cache hit for: anvil-fork-31611-15043414` in the log: 50.7s, 62.5s,
  65.4s. **On a developer machine with the cache warm, between about 115 and 160 seconds**: two five
  run windows on the SAME laptop at the same seed and block gave means of 158s (P15) and 117s
  (P16: 113.6, 117.4, 113.8, 123.3, 117.9). About 847 seconds cold (`949d361`). **The machine is
  part of the figure, CI is roughly 2 to 2.6 times faster than the laptop, and one laptop varies
  by a third between windows** (MK-081), so quote the row you mean and prefer a range. It is deterministic from
  a fixed seed, so it is a gate rather than a lottery, and it sits beside **about 62 seconds** of
  fork suite on the laptop, which is the suite with the differential test taken out.
- **The full 1000 case sweep: weekly and on demand, never on push.**
  `.github/workflows/sweep.yml` runs the four slices every Sunday at 03:00 UTC and on
  `workflow_dispatch`. It costs **about 116 minutes of wall clock, of which 111 is the sweep
  itself** (P15, ten operation generator), which is why it is not on the push path: a two hour wait
  on every merge would get routed around, and a gate people skip is worse than one they budget for.
  **This bullet claimed the schedule for 85 commits and a release before one existed** (MK-080).
- **A release cites a sweep against the tree being released**, not the last Sunday's.
  `docs/12-release-runbook.md` §0 precondition 7 requires a run whose `headSha` equals the released
  commit, because the operation set feeds the generator's stream and a sweep of a different tree is
  evidence about that tree (MK-069, learned through MK-079).
- **It is not hidden either**, which is the other failure mode. `docs/08-conventions.md` §10 is
  where a wave's obligations live, and the sweep belongs in a wave's acceptance when preview or
  math code changed, with the seed reported.

**The fork state cache applies**, verified rather than assumed: these runs used
`~/.foundry/cache/rpc/31611/15043414` like every other fork test, and the harness warm up
reported the usual `fork state warmed in 5xms (230 sorted Troves)` rather than a cold refetch.

## 4a-bis. Agreement tests, where one question has two answers

`packages/core/test/preview-agreement.test.ts`. Chain free, and it exists because a rule
implemented twice diverges (`08-conventions` §11).

`previewBorrow` and `previewAdjustTrove` are two questions about the same call: on chain
`withdrawMUSD` IS `_adjustTrove` with `_collWithdrawal = 0` and `_isDebtIncrease = true`
(`BorrowerOperations.sol:243-257`). This file asserts they agree on the verdict, on `reasons` in
order, on `bindingConstraint` and on every shared number, **in both modes and on both sides of the
MCR, CCR, TCR and capacity boundaries**, and then again end to end through the reads against a fake
chain.

The delegation makes agreement structural. This file is what keeps it structural: it fails the
moment anyone puts a decision back into `previewBorrow`. Three rules had already drifted before it
existed (MK-058, MK-059, MK-065), and each of them fails on the first case in the matrix.

**It also guards its own matrix**, with an assertion that the generated case count has not silently
shrunk and that every reason a borrow can reach is actually produced by some case. A matrix that
quietly got smaller would make every other assertion in the file pass while proving less, which is
MK-047's lesson about what a case count means.

## 4b. The gas variance lab (MK-039)

`packages/core/test/gas-variance.fork.test.ts`. Opt in, skipped unless `MK_GAS_LAB=1`.

```sh
MK_GAS_LAB=1 pnpm test:fork                                       # 40 redemptions, margin 25
MK_GAS_LAB=1 MK_GAS_LAB_AMOUNT=5000 MK_GAS_LAB_MARGIN=0 \
  MK_GAS_LAB_N=6 MK_GAS_LAB_STEP=3600 pnpm test:fork              # a small fixture, no margin
```

| knob | default | what it changes |
|---|---|---|
| `MK_GAS_LAB_N` | 40 | attempts, each a real transaction at about 45 seconds |
| `MK_GAS_LAB_MARGIN` | 25 | `gasMarginPercent` on the client under test |
| `MK_GAS_LAB_AMOUNT` | 5000 | MUSD redeemed per attempt; traversal depth, and so gas, scales with it |
| `MK_GAS_LAB_STEP` | 0 | seconds warped before attempt `i`, times `i`. Zero holds the clock still |

**Why it is committed at all.** `DEFAULT_GAS_MARGIN_PERCENT` is 25 because of a measurement, and
the script that produced that measurement was never committed, so it could not be re-run when a
later wave was asked to. A number that decides a default has to be checkable by someone who was not
there. The reconstruction's own numbers are at the top of the file, so the next run has something
to disagree with, and what they show is in `FINDINGS.md` under MK-039.

**It reports the `GasDecision` source per attempt**, not just the gas. An attempt that fell back
(MK-037) sent no margin at all, and a lab that cannot see which of its attempts those were is
measuring a population it has not identified. That is the specific hole MK-039 records.

## 4c. The packaged artifact check (MK-040), manual, before every publish

**A workspace typecheck cannot see a broken `exports` map**, because path mapping resolves
`@musd-kit/core` to `packages/core/src` and never reads `package.json`. MK-040 lived there for a
whole release: the published tarball shipped `dist/index.d.cts` and the export map never pointed at
it, so a CommonJS consumer on `moduleResolution: node16` got `TS1479` and could not typecheck
against the package, while `pnpm typecheck` was green the entire time.

This check exists because that is only findable from OUTSIDE the workspace.

```sh
pnpm build
(cd packages/core  && pnpm pack --pack-destination /tmp/pack)
(cd packages/react && pnpm pack --pack-destination /tmp/pack)

mkdir -p /tmp/installcheck && cd /tmp/installcheck && npm init -y
npm i /tmp/pack/musd-kit-core-*.tgz /tmp/pack/musd-kit-react-*.tgz \
      viem@^2 react@^18 wagmi@^2 @tanstack/react-query@^5
npm i -D typescript@5 @types/react@18
```

Then write one file importing a value, a type and a hook from each package, and typecheck it under
**four** configurations. All four must exit 0:

| Consumer `package.json` | `module` | `moduleResolution` |
|---|---|---|
| no `type` field (CommonJS) | `node16` | `node16` |
| no `type` field (CommonJS) | `esnext` | `bundler` |
| `"type": "module"` | `node16` | `node16` |
| `"type": "module"` | `esnext` | `bundler` |

**The first row is the one that matters**, and it is the only one MK-040 failed.

**The gate is a script now, and it prints the configuration it ran under beside every result.**

```sh
pnpm gate:packaging                        # the four gated rows
node scripts/packaging-gate.mjs --strict   # the same, plus skipLibCheck:false, reported not gated
```

It builds, packs the real tarballs, installs them into a throwaway consumer outside the workspace,
typechecks a probe that touches a value, a type and a hook from each package, then reports runtime
resolution and the tarball contents. Measured on the 0.2.0 tarballs:

```
configuration: skipLibCheck=true, strict=true, target=es2022
  (absent, CommonJS)  node16  node16    PASS
  (absent, CommonJS)  esnext  bundler   PASS
  module              node16  node16    PASS
  module              esnext  bundler   PASS
GATE PASSED, under the configuration printed above.

configuration: skipLibCheck=false, strict=true, target=es2022
  (absent, CommonJS)  node16  node16    FAIL   TS1542 from @mezo-org/chains
  (absent, CommonJS)  esnext  bundler   PASS
  module              node16  node16    FAIL   TS1542 from @mezo-org/chains
  module              esnext  bundler   PASS
```

**All four gated rows assume `skipLibCheck: true`, and that was an unstated precondition until the
script was written to print it.** A gate that says "all four exit 0" without naming the
configuration claims more than it checked.

**What fails without it is both `node16` rows, not the CommonJS ones**, and that distinction decides
the question below. `@mezo-org/chains@0.0.1` ships no `type` field and no `exports` map, so
`moduleResolution: node16` resolves its types as CommonJS, and they import from `viem`, which is ESM
only. That is `TS1542`, and it happens whatever the consumer sets `type` to. This package
contributes `TS1479` from its own `dist/index.d.cts` for the same upstream reason.

**The CommonJS build is worth keeping, and the reason is that it is not what fails.** `require()`
resolves and exports 100 names. The failing axis is `moduleResolution`, not output format, so
dropping the CommonJS build would not turn a single failing row green and would break every
`require()` consumer. The upstream fix is `@mezo-org/chains` shipping dual types, or viem's types
becoming resolvable under `node16`, and neither is ours. **Decision recorded, not acted on.**

Also confirm both runtimes resolve, which the script does for you:

```sh
node -e "console.log(Object.keys(require('@musd-kit/core')).length)"
node --input-type=module -e "import * as m from '@musd-kit/core'; console.log(Object.keys(m).length)"
```

**And inspect what is actually in the tarball**, because the `files` allowlist is what stops source,
tests and stray dotfiles from shipping:

```sh
tar tzf /tmp/pack/musd-kit-core-*.tgz | sort
```

Expected, and unchanged since 0.1.0: `LICENSE`, `README.md`, `package.json`, and six `dist/` files.
Nothing else.

**This is not automated, and that is a stated gap rather than an oversight.** Automating it needs a
build, a pack, an install into a scratch project and a `tsc` run, which is its own CI job rather
than a unit test. Until it is one, it is a manual gate here, written down so someone other than its
author can run it.

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
