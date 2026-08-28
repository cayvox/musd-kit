# Findings register

This file is the public, per finding record of every known correctness gap in `musd-kit`,
the ground truth it was checked against, and what we decided to do about it.

**Origin.** In addition to our own fork harness, the Mezo team performed an external review of
`musd-kit` 0.1.0 as a three way differential: the SDK against the `mezo-org/musd` Solidity
protocol, and the SDK against Mezo's own production dApp. We are grateful for that work. This
register is our response to it. It also carries findings we located ourselves while remediating.
We do not reproduce the reviewers' document or cite non public source paths here; every claim
below is restated in our own words and re-verified against public sources.

**Ground truth.** `mezo-org/musd` Solidity contracts at the revision matching the deployed
implementations, plus live reads recorded in `docs/09-review-and-validated-surface.md`.
Contract line numbers below were verified against the public repository at remediation time and
may drift as upstream changes; the quoted rule, not the line number, is the anchor.

**Stable IDs.** IDs are permanent. Tests and commits cite them (`MK-001`). An ID is never reused
or renumbered, even after the finding is closed.

## Severity classes

| Class | Meaning |
|---|---|
| **S1** | Silently wrong number. The caller or bot acts on a plausible false figure and no error is ever raised. |
| **S2** | Avoidable failed transaction, or a control that is weaker than advertised. Loud, or needs a second failure to matter. |
| **S3** | Hygiene, duplication, and documentation claims. Harmless to funds, corrosive to the correctness claim. |

## Status legend

`open` · `test-written` (a failing test pins the current wrong behavior) · `fixed` ·
`documented-limit` (accepted and stated in the docs) · `claim-corrected` (the code was right, the
claim about it was not).

## Summary

| ID | Title | Class | Status |
|---|---|---|---|
| MK-001 | `isLiquidatable` applies a Recovery Mode rule the protocol does not have | S1 | fixed |
| MK-002 | `maxBorrowingCapacity` is not modeled anywhere in the SDK | S1 | fixed |
| MK-003 | Refinancing fee is not modeled | S1 | fixed |
| MK-004 | Recovery Mode borrowing fee skip is not modeled | S1 | fixed |
| MK-005 | `previewOpen.meetsRecoveryRequirement` is vacuous in normal mode, and no TCR check | S1 | fixed |
| MK-006 | Hint NICR is fed entire debt, and repay ignores interest first ordering | S2 | fixed |
| MK-007 | `claim()` swallows every error | S2 | fixed |
| MK-008 | `verifyDeployment()` is weak and off the critical path | S2 | fixed |
| MK-009 | Address overrides accept any string | S2 | fixed |
| MK-010 | `getBorrowingPower` performs unbounded RPC iteration | S2 | fixed |
| MK-011 | `maxFeePercentage` is advisory only | S2 | documented |
| MK-012 | Governable constants are cached for the client lifetime | S2 | fixed |
| MK-013 | Price is read outside the multicall, so price and ICR can straddle blocks | S2 | fixed |
| MK-014 | `redeem` returns a rate in a field named `fee` | S1 | fixed |
| MK-015 | Documentation claims that overstate reality | S3 | fixed |
| MK-016 | Test suite is one stateful sequence with unpinned fork and flake mitigations | S3 | open |
| MK-017 | Duplicated derivations and placeholder values | S3 | fixed |
| MK-018 | Fee exemption is not modeled | S1 | fixed |
| MK-019 | `refinance()` reverts in Recovery Mode, which the SDK neither checks nor documents | S2 | fixed |
| MK-020 | Oracle shim seed is not pinned, so a pinned fork block is not a pinned price | S3 | fixed |
| MK-021 | Phase 3 warm up hook exceeds its fixed budget on a cold fork, skipping the whole file | S3 | fixed |
| MK-022 | `batchLiquidate` phase 6 test intermittently leaves one Trove unliquidated | S3 | open |
| MK-023 | Phase 6 `claim` fixture intermittently leaves the target Trove unredeemed | S3 | open |
| MK-024 | Phase 6 normal mode liquidation intermittently crashes on a missing event | S3 | open |
| MK-025 | React block watching test intermittently sends a write that reverts | S3 | open |
| MK-026 | Phase 5 lifecycle writes fail only under the coverage run, never under a plain fork run | S3 | open |
| MK-027 | Source files sit outside every typecheck and lint configuration | S3 | fixed |
| MK-028 | The DOM test environment pairs jsdom's `AbortSignal` with Node's `Request`, which Node 24 rejects | S2 | fixed |
| MK-029 | Local evidence and CI evidence were both true, because they ran different runtimes | S2 | fixed |
| MK-030 | `zz-findings` MK-003 refinance fee assertion fails intermittently on a plain fork run | S3 | open |
| MK-031 | Fork failures destroy their own cause: a missing event surfaces as a bare `TypeError` | S3 | fixed |
| MK-032 | The flake mitigations document a mechanism the harness makes impossible | S3 | fixed |
| MK-033 | A passing test logs an uncaught React error into the CI output | S3 | fixed |
| MK-034 | Two DIFFERENT redemption failures, wrongly folded into one entry, now split by evidence | S3 | open |
| MK-035 | A write is sent with a gas margin thinner than its own work varies, so it can revert out of gas after a passing simulate | S2 | fixed |
| MK-036 | The checklist's CI step was executed before the run existed, and reported "no run" as a finding twice | S3 | fixed |
| MK-037 | The MK-035 gas margin is silently dropped, because the estimate caps itself and then fails against its own cap | S2 | fixed |
| MK-038 | `addCollateral` and `repay` ARE ratio gated in normal mode, so an under-MCR position cannot be partly rescued | S2 | fixed, previewed by MK-042 |
| MK-039 | The measurement that sized the default gas margin was never committed, so it could not be re-run, and its description cannot be right | S3 | fixed |
| MK-040 | The published export map never points at the CommonJS type declarations it ships, so a CJS consumer on node16 resolution cannot typecheck | S2 | fixed |
| MK-041 | The Foundry toolchain version was never pinned, so a new anvil stable turned the fork gate red on a docs only commit | S2 | fixed |
| MK-042 | Five exposed writes had no preview, so a caller could only discover the contract's answer by sending | S2 | fixed |
| MK-043 | Two contract reverts mapped to no typed error, and three Recovery Mode reverts shared one wrong message | S2 | fixed |
| MK-044 | Two runtime versions CI executes were still resolved by a moving label, one of them end of life | S3 | fixed |
| MK-045 | A Trove cannot be closed with only the MUSD it drew, so a self funded run cannot end clean | S3 | documented, protocol property |
| MK-046 | The live script compared a preview taken before a write against a read taken after it | S3 | fixed |
| MK-047 | `previewOpen` says viable for an account that already holds a Trove, and the contract refuses | S2 | fixed, and the sweep gap that hid it is closed |
| MK-048 | `redeem` reports an amount as redeemable that the chain then refuses, because the hint helper answers a different question | S2 | **closed.** Previewed, prechecked, and the preview agrees with the chain in both directions across 83 executed redemption cases |
| MK-049 | A redemption's partial hint goes stale when the oracle price moves, so a correct call can still revert | S3 | open, documented, needs retry |
| MK-050 | `previewClose.musdRequired` is a snapshot the chain has already outgrown by the time a close lands, so holding exactly it is refused | S3 | open, documented, deferred to 0.2.1 |
| MK-051 | `maxWithdrawableCollateral` reports a figure that stops being withdrawable one second later, and the ledger recorded a preview-against-preview check as chain verification | S3 | open, documented, deferred to 0.2.1. The provenance claim is corrected |
| MK-052 | The live run's optional redeem step could kill the run and leave a position open, because a reverted receipt reached `process.exit` instead of the `catch` that promised to absorb it | S2 | fixed. It happened, on a real run, and cost a close |
| MK-053 | The post publish verification gate had never executed once, for either release, while being presented as part of the supply chain posture | S2 | fixed and proven by running it. The never executed audit it generalizes to is in the entry |
| MK-054 | The landing page's live widget says it reads through the shipped package; it bundles the workspace build | S3 | **fixed.** The landing now depends on `npm:@musd-kit/core@0.2.0`, so the build resolves the registry copy and fails when the version is not published |
| MK-056 | A deploy workflow that had never run and could not run, sitting beside a site that deploys automatically some other way | S3 | fixed by removing it and establishing how the site actually ships |
| MK-057 | Landing page copy asserted a live keeper event, a test count and a gas figure the repository could not back | S2 | fixed. The keeper claim described a fork run with a moved oracle as if it had happened on chain |
| MK-055 | The runbook tells you to push a `v*` tag after publishing, and the release workflow triggers on `v*` tags, so the documented path re-runs the publish | S3 | fixed in the workflow, and the interaction is named in the runbook |

---

## Provenance of the numbers in this register

Every quantitative claim in this file and in `docs/09-review-and-validated-surface.md` was audited
against step 10 of the wave checklist (`docs/08-conventions.md`): **a measurement is citable only if
the code that produced it is committed and someone else can run it, with the command recorded.**

The audit was run because a number that decided a shipped default turned out not to be checkable
(MK-039). **No number below has been deleted or softened.** Where the evidence is weaker than the
text read, the entry now says which part is evidence and which part is not.

| Class | Count | What it means |
|---|---|---|
| **Reproducible** | 18 | The instrument is committed. The command is named below or in the entry |
| **Observed once** | 5 | One execution, pinned by a run ID. Every one is enumerated below |
| **Observed once, unlinked** | 3 | One execution whose artifact was not preserved. Grandfathered, and the label says it cannot be re-checked |
| **Unestablished** | 8 | Inferred, or the instrument is gone, or the premise turned out to be wrong |

**34 claims, counted as claims rather than as lines**, since several are quoted in more than one
place. A count of numerals would be larger and would mean less.

### The reproducible set, and the command for each

| Measurement | Where | Command |
|---|---|---|
| Flake rates and run windows | MK-016, MK-021, MK-022, MK-023, MK-024, MK-025, MK-026, MK-030 | `pnpm test:fork`, `pnpm test:coverage` |
| Coverage against the ratchet | MK-016, and the floors in `docs/07-testing.md` §4 | `pnpm test:coverage` |
| The 1000 case differential sweep, 0 mismatches, 41 skipped | MK-016, `docs/09` §3 | `MK_DIFF_CASES=1000 MK_DIFF_SEED=20260826 pnpm test:fork` (two slices, see `MK_DIFF_FROM`) |
| Chain constants and the fee exempt scan at both pinned blocks | MK-014, MK-018, `docs/09` §6 | `pnpm facts --stdout` |
| Gas variance across three redemption fixtures, 52 executions | MK-037, MK-039 | `MK_GAS_LAB=1 MK_GAS_LAB_AMOUNT=5000 pnpm test:fork` |
| The zero debt sentinel value | MK-017 | `pnpm test:unit` |
| The estimate is asked with an address, not an `Account` object | MK-037 | `pnpm exec vitest run --project unit packages/core/test/write-gas-fallback.test.ts` |

**One caveat on the flake rates, stated once rather than eight times.** The instrument is committed
and the command is nameable, so these are reproducible in the sense the rule means. They were
measured on trees that have since changed, so re-running today measures today's suite rather than
that window. The window each rate was taken from is named in its own entry, and that naming is what
makes the two comparable at all.

### The observed once set, every one named

**Pinned by an identifier (5).** MK-034's
[32962767819](https://github.com/cayvox/musd-kit/actions/runs/32962767819) on `main` at `e7f77f4`;
MK-035's [32983444134](https://github.com/cayvox/musd-kit/actions/runs/32983444134), the `useRedeem`
revert; MK-029's six run table showing five consecutive red merges, `32628458775` through
`32703530387`; MK-036's `3aca53b` run `32990919057`, which was **failure** and had been reported
twice as not existing; MK-037's `margin=1.5%`, in
[33041778521](https://github.com/cayvox/musd-kit/actions/runs/33041778521),
[33042756192](https://github.com/cayvox/musd-kit/actions/runs/33042756192) and
[33043038071](https://github.com/cayvox/musd-kit/actions/runs/33043038071).

**Artifact not preserved (3).** MK-035's traced redemption, 610270 to 710023 gas ending in
`ActivePool` out of gas at call depth 4; MK-037's payload diff and its two against one request
counts; MK-037's balance threshold refutation. All three were local probes, deleted once they had
answered their question, and all three are load bearing. They are grandfathered by the rule that the
audit itself produced, and that clause does not extend forward.

### The unestablished set

MK-035's nine path spread table and everything derived from its 10.16%; MK-035's 2 in 40 and 0 in 80
isolation rates; MK-035's 610270 to 710023 spread read as a spread across 40 attempts rather than as
one traced growth; MK-016's 670 opens at 576469 to 605443 gas; MK-010's seven point fee shape probe;
MK-010's roughly 77 sequential calls, which is inferred from the search's bit width rather than
counted; MK-020's twelve `latestRoundData()` reads.

**Seven of the eight are the same defect**, which is why MK-039 is filed as a process finding rather
than a numerical one: the instrument was ad hoc, it answered its question, and it was thrown away.

---

## MK-001 · `isLiquidatable` applies a Recovery Mode rule the protocol does not have

**Class** S1 · **Status** fixed

**Ground truth.** `TroveManager.sol` contains no reference to `CCR` in any liquidation path. The
only gate is `ICR < MCR`, inside the batch liquidation loop (`TroveManager.sol`, the
`if (vars.ICR < MCR)` branch around line 1148). `liquidate(address)` builds a one element array
and calls `batchLiquidateTroves`, which reverts with `TroveManager: nothing to liquidate` when the
loop liquidates nothing. This fork removed stock Liquity's Recovery Mode liquidation branch.

**Reference behavior.** Mezo's production dApp does not treat Recovery Mode as widening
liquidatability.

**SDK location.** `packages/core/src/read/system.ts:51`,
`return icr < (isRecoveryMode ? CCR : MCR)`. The docstring at `read/system.ts:26-31` asserts the
behavior was verified. `packages/core/src/read/getTrove.ts:79` uses the correct `icr < MCR`, so the
same predicate answers differently depending on which API the caller reaches for.

**Why this is the worst one.** A passing test enshrines the wrong rule.
`packages/core/test/phase6.fork.test.ts` asserts `isLiquidatable(B) === true` for a trove with
`MCR <= ICR < CCR`, defends it in a comment with an ICR versus TCR plus Stability Pool cover rule
that does not exist in this fork, and then liquidates a different trove, the under MCR one. The
test never exercises its own claim. The normal review reflex, trust the tested path, actively
misleads here.

**Blast radius.** `isLiquidatable`, and the keeper example built on it. In Recovery Mode every
trove between MCR and CCR is reported liquidatable and every liquidation attempt against one of
them reverts. Wasted gas for keepers, false alarms for position holders.

**Reproduction.** Drive the fork into Recovery Mode, build a trove with `MCR <= ICR < CCR`, assert
that `liquidate()` on it reverts while `isLiquidatable()` returns `true`.

**Decision.** Fix now. Remove the Recovery Mode branch, correct the docstring, invert the phase 6
assertion into a regression test that pins the revert. Breaking behavior change, shipped in 0.2.0
with a migration note.


**Fixed in the P3a wave.** `read/system.ts` now applies a single `icr < MCR` with no mode
branch, and the docstring that claimed the Recovery Mode behavior was verified is corrected to
state the rule and cite `TroveManager.sol:1148`. The phase 6 assertion that enshrined the wrong
rule is inverted and the comment inventing an "ICR versus TCR plus Stability Pool cover" rule is
deleted rather than reworded. A regression test pins that the two read paths,
`isLiquidatable(address)` and `getTrove().isLiquidatable`, agree across the whole band in both
modes, because two APIs disagreeing about one question was the underlying defect. Breaking
behavior change for anyone who consumed the old verdict.
---

## MK-002 · `maxBorrowingCapacity` is not modeled anywhere in the SDK

**Class** S1 · **Status** fixed

**Ground truth.** Every trove carries a `maxBorrowingCapacity`, set at open from the opening price
as `coll * price / (110 * 1e16)` (`BorrowerOperations.sol`, `_calculateMaxBorrowingCapacity`, called
from `openTrove`). It is ratcheted only downward, on collateral decrease, as
`min(current, recalculated)`. Every debt increase is gated by
`maxBorrowingCapacity >= netDebtChange + getTroveDebt(borrower)`, where `netDebtChange` is the draw
plus the borrowing fee, and `getTroveDebt` is current to the block because `_adjustTrove` calls
`updateSystemAndTroveInterest` first. Capacity does not rise when the collateral price rises.

**Reference behavior.** Mezo's production dApp reads the on chain capacity, computes remaining
capacity as capacity minus current debt, gates the borrow on draw plus fee against that remainder,
and routes an over capacity borrow into a refinance first. Their code treats capacity as the hard
gate.

**SDK location.** `packages/core/src/math/getBorrowingPower.ts` solves only the ICR constraint and
never reads `getTroveMaxBorrowingCapacity`. `packages/core/src/trove/index.ts`, `borrow()` has no
capacity precheck. The string `maxBorrowingCapacity` appears in the SDK only inside the generated
ABI.

**Nuance we want to be precise about.** `getBorrowingPower` is documented as an open time
calculator, and at open the capacity is set from the same inputs, so on its documented use it does
not produce a capacity driven wrong number. The finding stands regardless: the concept is absent
from the SDK, `borrow()` has no precheck, the React hook name invites use against an existing
trove, and a seasoned trove after a price rise is the common case, not an edge case.

**Blast radius.** Any integrator sizing a borrow against an existing trove. Failed transactions and
a borrowing figure the contract rejects.

**Decision.** Fix now. Add capacity reads and a preview for existing troves, add a precheck to
`borrow()`, and state in the docs that capacity is fixed at the opening price and never rises.


**Fixed in the P3a wave.** Capacity is now a first class concept: `getBorrowingCapacity(owner)`
returns the on-chain capacity, the live entire debt and the remaining headroom;
`previewBorrow({ owner, amount })` returns a verdict, a machine readable reason list and the
binding constraint, covering the capacity gate, the resulting ICR against the mode correct
threshold and the resulting system TCR; `borrow()` and the debt increase path of `adjustTrove()`
precheck the gate and throw the typed `ExceedsBorrowingCapacity` with the real numbers before
simulate. React gains `useBorrowPreview` and `useBorrowingCapacity`. `getBorrowingPower` stays
the open time calculator and now says so, including that capacity is fixed at the opening price
and never rises; it also now enforces the resulting system TCR, which the contract requires on
every normal mode open and which it previously ignored. The precheck compares against the LIVE
entire debt, not the stored `getTroveDebt`, because `_adjustTrove` updates interest first
(`BorrowerOperations.sol:769`) and the gate therefore sees accrued interest.

**Discharged, P8 wave: the ratchet was watched taking its lower branch.**
`packages/core/test/obligations.fork.test.ts` opens a position, confirms capacity does not rise
when the price doubles, then withdraws half the collateral and reads it again:

    capacity opened          140092922400000000000000
    after the price doubled  140092922400000000000000   unchanged
    after withdrawing half    70046461200000000000000   exactly half

That is `min(current, recalculated)` taking the LOWER branch on chain, which no test had done.

**Previously not witnessed, which is why it was owed.** The downward ratchet is reasoned from
`BorrowerOperations.sol:879-897` and is NOT observed executing on chain: no test performs a
collateral withdrawal and watches `min(current, recalculated)` take the lower branch. The tests pin
only that capacity does not RISE with price, which is the half the reported defect turned on.
Reaching the ratchet is on the differential harness coverage list in
`docs/09-review-and-validated-surface.md` §3, so the harness is built to exercise it rather than
pointed at it afterwards.
---

## MK-003 · Refinancing fee is not modeled

**Class** S1 · **Status** fixed

**Ground truth.** On refinance the contract charges
`fee = borrowingRate applied to (refinancingFeePercentage / 100) * (getTroveDebt - 200e18)`, adds it
to principal so it begins accruing interest, and skips it entirely for fee exempt accounts
(`BorrowerOperations.sol`, the refinance path). `refinancingFeePercentage` is a governable
`uint8`, initialized to 20.

**SDK location.** `packages/core/src/trove/index.ts:274-284`. The SDK never reads
`refinancingFeePercentage()`, and computes hints from the pre fee debt.

**Reference behavior.** Mezo's production dApp models the refinancing fee and folds it into its
NICR computation.

**Blast radius.** `refinance()` and any UI that shows a post refinance debt. The number is wrong by
the fee, and the hint is computed for a position that will not exist.

**Decision.** Fix now: read the governable percentage, add a `previewRefinance`, and fold the fee
into the hint. If it cannot be shipped correctly, remove `refinance()` from the public surface
rather than ship wrong numbers.


**Fixed in the P3b wave.** `previewRefinance(owner)` returns the fee, the fee base, the live
governable percentage, the resulting principal, entire debt, ICR and TCR, and a verdict with
machine readable reasons. `refinancingFeePercentage` is READ on every call rather than hardcoded,
because it is governable. `refinance()` folds the fee into the hint, so the hint describes the
position that will exist: combined with MK-006 the hint is principal based and fee inclusive,
matching what `BorrowerOperations.sol:1087-1088` re-inserts with. The function was NOT removed from
the public surface: the numbers can be produced correctly, so the fallback of shipping less surface
did not apply.
---

## MK-004 · Recovery Mode borrowing fee skip is not modeled

**Class** S1 · **Status** fixed

**Ground truth.** On open, the borrowing fee is charged only when the system is not in Recovery
Mode and the account is not fee exempt. In Recovery Mode `netDebt` equals the requested draw with
no fee added. The same skip applies to a debt increase in `_adjustTrove`.

**SDK location.** `packages/core/src/math/previewOpen.ts` applies `getBorrowingFee(debt)`
unconditionally while separately reporting `isRecoveryMode` in the same result.

**Second order effect we found while remediating.** Because the SDK adds a fee the contract will
not charge, `meetsMinimum` is also computed against the wrong quantity. In the band where
`debt < minNetDebt <= debt + fee`, the SDK reports the minimum as met for an open the contract
rejects. So this is not only an overstatement, it can be optimistic in the direction that produces
a failed transaction.

**Reference behavior.** Mezo's production dApp shares this gap. This is a divergence from the
protocol, not from Mezo's practice, which materially reduces how damning it is.

**Blast radius.** Every preview taken while the system is stressed, exactly when accuracy matters
most.

**Decision.** Fix now, and record in the divergence matrix that the gap is shared.


**Fixed in the P3a wave.** `previewOpen` charges the fee only when the contract does, that is
when not in Recovery Mode and the account is not fee exempt. The second order effect is closed
with it: because the floor is checked against `netDebt`, removing the phantom fee removes the
band `draw < minNetDebt <= draw + fee` where the preview reported the floor met for an open that
reverts. The findings test that pins that band is kept and now passes.
---

## MK-005 · `previewOpen.meetsRecoveryRequirement` is vacuous in normal mode, and no TCR check

**Class** S1 · **Status** fixed

**Ground truth.** `openTrove` requires, in Recovery Mode, `ICR >= CCR`; and in normal mode, both
`ICR >= MCR` and a resulting system TCR at or above CCR.

**SDK location.** `packages/core/src/math/previewOpen.ts:82`,
`meetsRecoveryRequirement: !isRecoveryMode || icr >= CCR`. In normal mode this is unconditionally
`true`. The preview never checks `ICR >= MCR` and never projects the resulting TCR.

**Blast radius.** A preview can report every requirement met for an open that reverts. This is the
bug class the current test shape cannot catch, because the tests never compare a preview verdict
against an actual attempt.

**Decision.** Fix now. Replace the flag with an explicit verdict plus reasons, covering the debt
floor, the mode correct ICR threshold, and the projected TCR.


**Fixed in the P3a wave.** `meetsRecoveryRequirement` is REMOVED, a breaking change, and
replaced by `viable` plus a machine readable `reasons` list and `bindingConstraint`. The verdict
covers the debt floor, the mode correct ICR threshold (`CCR` in Recovery Mode, `MCR` in normal
mode) and, in normal mode only, the projected system TCR, which the contract enforces on every
normal mode open and which the SDK never projected. The migration note is in
`docs/03-core-api.md`.
---

## MK-006 · Hint NICR is fed entire debt, and repay ignores interest first ordering

**Class** S2 · **Status** fixed

**Ground truth.** `TroveManager.getNominalICR` uses collateral plus pending collateral against
principal plus pending principal, with no interest. Every on chain re insert passes a principal
only NICR. Separately, `InterestRateMath.calculateDebtAdjustment` applies a payment to interest
first: a payment at or below interest owed reduces principal by zero.

**SDK location.** `packages/core/src/trove/index.ts`, `hintsFor` is called with entire debt
(principal plus interest) on `addCollateral`, `borrow`, `repay`, `withdrawCollateral`,
`adjustTrove`, and `refinance`. `repay` models debt as falling by the full payment.

**Reference behavior.** Mezo's production dApp models the interest first split correctly.

**Why it survived.** `openTrove` is accidentally correct, because interest owed is zero at open.
The dual validation gate covers only the open path, so it could never catch this.

**Blast radius.** Gas and latency, not funds. `SortedTroves.reInsert` re validates and traverses,
so a bad hint degrades to a linear scan and, in the worst case, out of gas. The repay projection is
a wrong number shown to the user, which is why this finding sits at the top of S2.

**Decision.** Fix now: principal based hints on every existing trove write, and an interest first
repay projection mirroring the contract helper.


**Fixed in the P3b wave.** Every hint is computed from PRINCIPAL. All seven hint call sites in
`packages/core/src/trove/index.ts` were enumerated from source and corrected: `addCollateral`,
`borrow`, `repay`, `withdrawCollateral`, `adjustTrove` and `refinance`; `openTrove` was already
correct and `close` computes no hint because it removes the node. `hintsFor`'s parameter is renamed
`principal` so the wrong quantity cannot be passed by habit. The repay projection mirrors
`InterestRateMath.calculateDebtAdjustment` exactly through the exported
`principalReductionForRepay`, and is pinned on a fork at three payment sizes against the contract's
own branch boundary: below, exactly equal to, and above interest owed.

**Why the open path was accidentally correct.** At open there is no accrued interest, so the
composite debt IS the principal. The dual validation gate covered the open path only, so it compared
a quantity that happens to be right there and never exercised a path where interest exists. A gate
that only covers the case where two quantities coincide cannot tell you which one you meant. That is
the reason this survived into a published release, and it is why the differential harness must cover
existing trove paths, not only opens.
---

## MK-007 · `claim()` swallows every error

**Class** S2 · **Status** open

**Ground truth for our own policy.** `packages/core/src/errors/mapRevert.ts` states that a revert
is never swallowed and that unrecognized failures surface as a typed error with the original cause
attached.

**SDK location.** `packages/core/src/trove/index.ts:292-306`. Simulate and send are wrapped in a
bare catch that returns a no surplus result. The intent, turning the no surplus revert into a clean
no op, is defensible. The implementation also absorbs RPC failure, user rejection, and genuine
reverts.

**Blast radius.** A user with real claimable collateral surplus on a degraded RPC is told,
indistinguishably from the truth, that they have nothing.

**Decision.** Fix now. Match only the no surplus revert, route everything else through `mapRevert`
and rethrow.

**Fixed, P4 wave.** The contract's behavior was established by triggering it rather than assumed,
which mattered: `claimCollateral()` does NOT return zero when there is nothing to claim. Called
from an account with no surplus on the fork it reverts with the classic Liquity require string
`CollSurplusPool: No collateral available to claim`, decoded by viem as `Error(string)`. That is
now a row in `docs/01-ground-truth.md` §11, marked as the one reason matched but deliberately not
mapped to a typed error.

`claim` matches that reason through a new `decodeRevertReason` export from
`errors/mapRevert.ts`, so it reuses the one decoder's walk rather than re-implementing it, and
rethrows everything else through `mapRevert`. Pinned chain free by
`packages/core/test/s2-guards.test.ts`, which had no predecessor: there was no paired findings test
for MK-007 before this wave. Three of its four cases fail against the old bare `catch {}`, verified
by putting the old body back and running them; the fourth, the no surplus no-op, passes both ways,
which is the point.

---

## MK-008 · `verifyDeployment()` is weak and off the critical path

**Class** S2 · **Status** open

**SDK location.** `packages/core/src/client/createMusdClient.ts:192-201`. It reads two constant
views on one of seven addresses. A fifteen line contract returning those two constants passes it.
There is no code presence check, no cross wiring assertion, despite the pointer getters existing and
being free to call. It runs only from `getConstants()`, so every read and every write is otherwise
unverified, and `trove/index.ts` re reads `minNetDebt` directly, bypassing the hook entirely.

**Decision.** Fix now. Assert the cross wiring pointers, run it once before the first write, and
route the direct `minNetDebt` read through the same path.

**Fixed, P4 wave.** `packages/core/src/client/verifyDeployment.ts` asserts, in ONE `multicall`:

- **Code at all seven bundled addresses.** Not as a separate sweep. Every one of the seven has at
  least one read in the batch, and `allowFailure: false` means an address with no code fails the
  whole call. Three of them, `priceFeed`, `musd` and `interestRateManager`, hold no wiring pointer,
  so they carry a presence probe each; without those, an empty address at any of the three would
  have satisfied every other assertion. The `eth_getCode` sweep runs only ON failure, to name which
  address is empty instead of leaving an opaque decode error.
- **All fourteen cross wiring pointers**, each against the resolved address map.
- **`HintHelpers.priceFeed()` still unset**, the one pointer that is correctly zero.
- **`MCR` and `CCR`**, as before, still throwing `MismatchedDeployment` so that branch is unchanged.

The pointer set is the set `scripts/onchain-facts.ts` reads and `docs/09` §6 records as holding at
a pinned block on BOTH chains, reused rather than re-derived. A pointer asserted but never observed
would be a guess, and a guess that fails looks exactly like a compromised deployment. The presence
probes assert PRESENCE only: no value has been established as invariant for them, and claiming more
is how a verification step starts lying.

**On the critical path.** `WriteDeps` gained a REQUIRED `ensureVerified`, awaited by
`simulateAndSend` before simulate and by `claim`, which simulates itself. Required rather than
optional on purpose: optional would let a future write path skip it silently, which is the shape of
this very finding. The compiler found every construction site. `createMusdClient` memoizes it as a
PROMISE, not a boolean, so concurrent first writes share one batch instead of racing into several,
and clears it on failure so a transient transport error does not poison an otherwise healthy client.

**The direct read is gone.** `trove/index.ts`'s `getMinNetDebt` called
`borrowerOperations.minNetDebt()` straight through, which is precisely how `openTrove` bypassed
verification. It now goes through the client's cached accessor, which also removes a round trip from
every open.

**Pinned by** `packages/core/test/s2-verify-deployment.test.ts`, chain free, and three fork tests in
`phase1.fork.test.ts`. Four of the six chain free cases fail against the old two constant
implementation, verified by putting it back. The one pre existing test, "verifyDeployment passes",
passes against both implementations, which is exactly why it never caught this.

**A limit worth stating.** The fork test for a wrong address asserts the NO CODE shape, because on a
real chain a wrong address either has no code or lacks the function. The other shape, a substitute
that has code and answers correctly but is not the one the deployment points at, is pinned chain
free; constructing it on the fork would mean deploying a lookalike contract.

---

## MK-009 · Address overrides accept any string

**Class** S2 · **Status** open

**SDK location.** `packages/core/src/addresses/index.ts:57`. The whole validation is
`typeof o[k] === 'string'`. Neither `isAddress`, nor `getAddress`, nor `zeroAddress` appears
anywhere in the source. On a supported chain, a partial override silently replaces one contract
inside an otherwise trusted map, with no verification before a value bearing send.

**Decision.** Fix now. Validate and checksum every override, reject the zero address, and require
deployment verification when any override is present.

**Fixed, P4 wave.** `validateOverride` rejects an unknown contract key, a value that is not a valid
EVM address, and the zero address, and returns every value through `getAddress` so the resolved map
is canonical. Validation now runs on BOTH paths; before, the little that existed ran only on the
unsupported-chain branch, so a bad value on a supported chain was spread straight into the map.

The unknown-key case is the one that had no failure at all: `pricefeed` was spread over a map that
already had `priceFeed`, so the bundled address survived and the caller believed they had redirected
it. `MUSD_CONTRACT_NAMES` is now the single list behind both the completeness check and the
unknown-key rejection, so the two cannot drift.

**On requiring verification when an override is present:** it is required, but not conditionally.
MK-008 makes `verifyDeployment` run before the first write on every path, which is strictly
stronger than making it conditional on an override, and a conditional rule invites someone to narrow
the condition later. The reasoning is in the pull request body. What makes it an answer to this
finding rather than a coincidence is WHICH assertions verification now makes: the cross wiring
pointers. Address validation cannot tell whether a replacement belongs to the same deployment;
`TroveManager.sortedTroves()` can.

**Pinned by** the MK-009 block in `packages/core/test/addresses.test.ts`, chain free. There was no
paired findings test before. Six of its cases fail with the validation removed, verified by removing
it.

---

## MK-010 · `getBorrowingPower` performs unbounded RPC iteration

**Class** S2 · **Status** open

**SDK location.** `packages/core/src/math/getBorrowingPower.ts`. The binary search issues one
`getBorrowingFee` call per iteration over a caller supplied, unvalidated collateral amount. Roughly
77 sequential calls for one BTC (**inferred**, from the search's bit width rather than counted), and
far more for adversarial inputs. A UI bound to a text input can
inflict this on its own RPC endpoint.

**Decision.** Fix now. Validate the input, bound the iteration count, and cut the per iteration
round trips.

**Fixed, P4 wave.** Three things, and the third depended on establishing a fact first.

1. **The input is validated.** A non-positive collateral throws `InvalidAmount` rather than being
   searched over. The React `useBorrowingPower` hook is now `enabled` only for a positive
   collateral, because an empty text input parsing to `0n` is a calculator being typed into, not an
   error to render.
2. **The search is bounded**, `MAX_BORROWING_POWER_ITERATIONS = 256`. That is the number of halvings
   a 256 bit range can survive, so a search that has not converged by then cannot: it is a backstop
   against a bug, not a budget.
3. **The search is no longer the primary path.** Every chain read happens in one `multicall`, the
   answer is solved in closed form, and the chain is asked for a real `getBorrowingFee` only to
   CONFIRM it. Roughly 77 sequential calls becomes about four.

**The fee shape was established, not assumed.** **Provenance: UNESTABLISHED.** The probe was
ad hoc and was not committed, so the seven point check below cannot be re-run. It is load bearing
only as a premise, and the code does not rely on it: the closed form's answer is confirmed against a
real `getBorrowingFee` call on every invocation and falls back to the bounded search on a mismatch,
which is why this stays a premise rather than a guarantee. Probed against the forked deployment at
the pinned block, `getBorrowingFee(d)` equals `borrowingRate() * d / DECIMAL_PRECISION()` EXACTLY, at
`d` = 1, 7, 1000, 1e18, 1.234...e18, 5000e18 and 1e30. 1000 matters: at the live rate it is the
smallest sample where the floor division is visible. Live values are `borrowingRate() = 1e15`
against `DECIMAL_PRECISION() = 1e18`, a flat 0.1% with no intercept, no tier and no minimum.

**And it is still only a premise, which is why the fallback stays.** `borrowingRate` is governable:
`proposeBorrowingRate` and `approveBorrowingRate` are both on the ABI. Linearity is a property of
today's implementation, not a guarantee. So the closed form's answer is confirmed against a real
`getBorrowingFee` call, and a mismatch falls back to the bounded search. A closed form that silently
disagreed with the chain would be worse than the slow loop it replaced.

**Pinned by** four chain-free cases in `packages/core/test/s2-guards.test.ts` (validation, the call
count, the exact boundary, and the dust case) and two fork tests in `phase4.fork.test.ts`: linearity
asserted directly against the contract, and the closed form compared to a locally reimplemented
binary search, to the wei, at four collateral sizes. The reference search is written out in the test
rather than shared with `src`, so the comparison is against the implementation that was replaced
rather than against a helper that could drift with it. There was no paired findings test before.

---

## MK-011 · `maxFeePercentage` is advisory only

**Class** S2 · **Status** open

**Ground truth.** The protocol exposes no fee cap parameter on the write paths, so the SDK cannot
enforce one on chain. This is already documented honestly in `redemption/redeem.ts`.

**Residual risk.** It is opt in, defaults to no cap, and there is a read then send race: the rate
can move between the check and the transaction.

**Decision.** Documented limit, with the wording strengthened so no integrator reads it as an on
chain guarantee.

**Done, P4 wave. No code change, by design: there is nothing to change.** The scope was widened
after checking: it is not only `redeemCollateral` that takes no fee cap. The full signatures in
`docs/01-ground-truth.md` §5.1 show `openTrove`, `withdrawMUSD`, `adjustTrove` and `refinance` are
all `(amount, upperHint, lowerHint)` shaped, so NO MUSD write path takes one. There is nothing for
the SDK to pass a cap to.

The existing honest note in `redemption/redeem.ts` is kept and extended rather than replaced. The
same statement now also sits on `assertFeeWithinCap`, on all three `maxFeePercentage` fields in
`trove/index.ts`, in `docs/03-core-api.md` under its own heading, and on the `MaxFeeExceeded` row in
`docs/06-errors.md`.

The read then send race is stated as a sequence rather than as an adjective, because "advisory" is
easy to skim past: the SDK reads the fee, compares it, then sends, and between the read and the mine
the governable rate can change while the transaction goes through anyway. Nothing reverts. **A
passing check means the fee was within the cap when it was read, and nothing more.** It is opt in
and defaults to no cap, so the default behavior is to accept whatever the protocol charges. Where a
real bound is needed, the doc says the enforcement has to be the caller's.

**No test.** This is the one item in the P4 sweep with none, and deliberately: there is no behavior
to pin. The guard's arithmetic is already covered by `exceedsRateCap` in `math/fee.ts` and by the
`MaxFeeExceeded` fork test in phase 5. A test asserting that a docstring contains a sentence would
be theatre.

---

## MK-012 · Governable constants are cached for the client lifetime

**Class** S2 · **Status** open

**SDK location.** `packages/core/src/client/createMusdClient.ts:203-211`. `minNetDebt` and the
interest rate are governable, and are cached for as long as the client object lives. A long lived
process, a keeper for example, can act on a stale floor indefinitely.

**Decision.** Fix now. Add a time to live and a way to invalidate.

**Fixed, P4 wave.** `DEFAULT_CONSTANTS_TTL_MS` is 60 seconds, overridable per client with
`constantsTtlMs`, and `MusdClient.invalidateConstants()` drops the cache without waiting the TTL
out. `0` re-reads on every call.

**Why 60 seconds**, since a default nobody can justify is a default nobody should trust. Stale is
unbounded harm: a preview reports a floor the contract no longer enforces, so an open the SDK calls
viable reverts, or one it rejects would have succeeded. Fresh costs two `eth_call`s a minute per
client, less than a single `previewOpen` already makes. It is not lower because these are timelocked
governance parameters rather than a price, so sub second freshness would buy nothing real and would
add a round trip to every preview.

An in-flight read is shared, so a burst of concurrent callers after an expiry issues one pair of
reads rather than one pair each. `invalidateConstants` deliberately does NOT clear the deployment
verification: a wiring pointer changing is a redeployment, not a governance action, which is the same
reasoning already applied to the cached `governableVariables` pointer.

**Pinned by** `packages/core/test/s2-constants-ttl.test.ts`, chain free with fake timers. There was
no paired findings test. Three of its seven cases fail against the lifetime cache, verified by
restoring it.

---

## MK-013 · Price is read outside the multicall

**Class** S2 · **Status** open

**SDK location.** `packages/core/src/read/system.ts` and `packages/core/src/read/getTrove.ts` fetch
the price in a separate round trip, then run the multicall with it. Price and ICR can therefore
straddle blocks, which contradicts the one consistent price snapshot wording in the docstrings.

**Decision.** Fix now, or correct the docstring where a single call is not achievable.

**Fixed, P4 wave: fixed, not documented away.** Establishing WHY it could not be one call was the
part that mattered. Every price dependent getter MUSD exposes takes the price as an ARGUMENT:
`getTCR(uint256)`, `checkRecoveryMode(uint256)`, `getCurrentICR(address,uint256)`. Read from the
generated ABI rather than assumed, there is no zero argument variant of any of them. So the price
genuinely cannot be produced and consumed inside one `multicall`: its value must exist before the
call that uses it is encoded.

The answer is to PIN rather than to merge. `read/snapshot.ts` returns the price together with
`Multicall3.getBlockNumber()` from a single `eth_call`, so the two cannot disagree, and the caller
runs the dependent reads with `blockNumber` set to it. Two round trips, exactly as before, and now
both evaluated against one block. The second call reads at most one block back, which every node
serves; this is not archival access.

Applied to `getSystemState`, `getTrove` and `isLiquidatable`. `isLiquidatable` was two sequential
`readContract` calls, which for a predicate a keeper acts on is the difference between a liquidation
that lands and one that reverts. `SystemState` and `Trove` now carry `blockNumber`, and `Trove` also
carries the `price` its `icr` was measured against, so the snapshot is checkable by the caller
rather than merely asserted by a docstring.

**What is NOT changed, stated rather than left to be discovered.** `previewOpen`, `previewBorrow`,
`previewRefinance` and `getBorrowingPower` still read the price in their own round trip. None of
them claims a single block snapshot in its docstring, and moving them is a larger change to the
math layer's shape than this finding calls for. They remain as they are, deliberately.

**Pinned by** two fork tests in `phase2.fork.test.ts`. The second mines blocks after the read and
then reconciles `icr` and `price` at the REPORTED block, which is the property that was previously
untrue. There was no paired findings test before.

---

## MK-014 · `redeem` returns a rate in a field named `fee`

**Class** S1 · **Status** fixed

**Ground truth, corrected.** An earlier version of this entry described the two redemption getters
wrongly, and its fix instruction would have introduced a unit error. Both getters live on
**`BorrowerOperations`**, not on `TroveManager`:

| Getter | Argument | Returns | Source |
|---|---|---|---|
| `redemptionRate()` | none | the **rate**, a 1e18 scaled fraction. Declared `uint256 public redemptionRate; // expressed as a percentage in 1e18 precision`, initialized to `(DECIMAL_PRECISION * 3) / 400`, that is 0.75% | `BorrowerOperations.sol:129`, initialized `:151` |
| `getRedemptionRate(uint256 _collateralDrawn)` | **collateral drawn, in BTC wei**, not a MUSD amount | despite the name, a fee **AMOUNT** in BTC wei: `fee = redemptionRate * _collateralDrawn / DECIMAL_PRECISION`, with `require(fee < _collateralDrawn)` | `BorrowerOperations.sol:499-509` |

Read at mainnet block 11330182 and testnet block 15043414, `redemptionRate()` is
`7500000000000000`, and `getRedemptionRate(1 BTC)` returns `7500000000000000` BTC wei of fee. The
two happen to print the same digits at exactly one BTC, which is precisely the coincidence that
makes the naming dangerous.

**What is actually wrong in the SDK.** `packages/core/src/redemption/redeem.ts:38` returns a field
named `fee` that holds the **rate**, read from `redemptionRate()` at `redeem.ts:65`. Its own
docstring says "Effective redemption rate (1e18-scaled)", so the type is documented and the **name
contradicts it**. A caller who trusts the field name and reads `fee` as an amount of BTC is wrong
by the size of the redemption.

**What is NOT wrong, contrary to the earlier text.** The cap at `redeem.ts:77` compares the rate
against `maxFeePercentage`, documented at `redeem.ts:24` as a "1e18-scaled fraction". Rate against
rate cap is unit consistent and correct. Swapping in `getRedemptionRate(collateralDrawn)` as the
earlier fix instruction proposed would compare a BTC wei **amount** against a 1e18 scaled
**fraction**, which is a unit error this entry would have caused rather than prevented.

**Blast radius.** A caller reading `fee` as an amount is off by orders of magnitude. Classed S1
because it is a silently wrong number in a field whose name asserts otherwise. Unchanged.

**Decision.** Fix now, but narrower than previously written. Rename the field so the unit is
explicit, and additionally return the estimated fee amount, computed with
`getRedemptionRate(collateralDrawn)` for the collateral actually drawn, as a separate field.
Leave the cap comparing rate against rate.


**Fixed in the P3b wave.** `RedeemResult.fee` is removed, a breaking change. The result now carries
`redemptionRate`, the rate named as a rate, `estimatedFeeCollateral`, the fee AMOUNT in BTC wei from
`getRedemptionRate(collateralDrawn)`, and `estimatedCollateralDrawn`, so a caller can see what the
estimate assumed. The amount is labelled an estimate because the collateral actually drawn is only
known once the redemption mines; the docstring points at the `Redemption` event's `collateralFee`
as authoritative. The cap is deliberately unchanged and still compares rate against rate, which was
already consistent; MK-011's note that no on chain fee cap exists is kept and strengthened with the
citation `TroveManager.sol:294-301` and the read-then-send race spelled out.
---

## MK-015 · Documentation claims that overstate reality

**Class** S3 · **Status** open

For a library whose stated product is correctness, an inflated claim is what persuades an integrator
to skip their own validation. These are findings, not cosmetics.

| Claim | Reality at 0.1.0 | Decision |
|---|---|---|
| A coverage floor is enforced in CI | The coverage package is installed but never configured or invoked. No thresholds, no coverage run anywhere. | Implement the gate, floor set at the honest measured number, then ratchet |
| The fork is pinned to a block for determinism | The environment variable is supported by the harness but set in no workflow. CI forks at latest and drifts against live testnet. | Pin it in CI |
| CI matrix: Node LTS, current and previous | Single Node version from `.nvmrc`. | Add the matrix, or correct the claim |
| Post publish install verification | The smoke test runs before publish, from packed tarballs. The script itself says it does not publish. | Correct the wording, and add a genuine post publish check |
| The unit layer is in process with no chain | `globalSetup` boots anvil unconditionally, so even the unit file needs an RPC URL and an anvil binary. | Split the test projects so the claim becomes true |
| Live data is never re-derived | Entire debt, liquidation price, and health factor are derived in TypeScript from authoritative getters. | Correct the claim to say exactly which values are read and which are derived |
| Validated twice | True, but only on the open path, which is why MK-006 survived. | Replace with an explicit validated surface statement |

**Progress.** The testing rows above were made true in the P0 remediation wave. A row is
marked done only when a check in CI enforces it, never when a document merely describes it.

| Claim | Status | What makes it true |
|---|---|---|
| A coverage floor is enforced in CI | **done** | `coverage.thresholds` in `vitest.config.mts`, run by `pnpm test:coverage` in the fork gate job. The floor is the measured number rounded down, and it is a ratchet: upward only |
| The fork is pinned to a block for determinism | **done** | `MEZO_FORK_BLOCK` set in `.github/workflows/ci.yml`, read by the harness at `packages/core/test/harness/anvil.ts:83`, and the oracle seed is read at that same block so the price is pinned with it (MK-020). Pinning is still not order independence, see MK-016 |
| CI matrix: Node LTS, current and previous | **done, claim narrowed** | The chain-free half runs on Node 20, 22, and 24; the fork gate runs once on the `.nvmrc` toolchain. `docs/07-testing.md` §5 now names the concrete versions instead of a category that goes stale |
| Post publish install verification | **done, wording corrected** | The pack smoke is now described as pre publish everywhere, because that is what it is. A genuine post publish job installs the published version from the registry into an empty directory and imports it, in `.github/workflows/release.yml`, after publish and never on push |
| The unit layer is in process with no chain | **done** | Two vitest projects in `vitest.workspace.mts`. CI runs `pnpm test:unit` before Foundry is installed and with no RPC secret in scope, so the claim fails loudly if it stops being true |

The two remaining rows, live data never re-derived and validated twice, are untouched and
belong to a later wave.

**Fixed, P9 wave. Every occurrence reconciled, by file and line, not the first one found.**

| File | What it said | What it says now |
|---|---|---|
| `README.md:45-48` | "never re-derived", "validated twice" | names the two derived fields, and points at `docs/09` §3 |
| `packages/core/README.md:42` | "dual-validated against the fork + pure helpers" | points at `docs/09` |
| `packages/core/README.md:64` | "client math, dual-validated" | names all three validations including the differential harness, and points at §3 for what is NOT covered |
| `docs/00-overview.md:22` | "the dual-validation method" | "how the math is validated" |
| `docs/02-architecture.md:15` | "PREVIEW-only, dual-validated" | "PREVIEW-only, see docs/09 §3" |
| `docs/02-architecture.md:47` | "validated twice" | "validated as docs/09 §3 states" |
| `docs/02-architecture.md:64` | "dual-validated" | "validation per docs/09 §3" |
| `landing/src/components/Architecture.astro:44` | "dual-validated against a fork and the contracts' own pure helpers" | names the third validation and points at the table |

**On "never re-derived", the honest answer, and a correction I nearly shipped.** It was not true.
My first correction said "eleven fields, two derived", which was ALSO not true, and counting them
against `read/types.ts` rather than from memory is what caught it. `getTrove` returns **fourteen**
fields:

| Read from a getter (9) | Derived in TypeScript (5) |
|---|---|
| `collateral`, `principal`, `interestOwed`, `icr`, `nominalICR`, `interestRate`, `status`, `price`, `blockNumber` | `entireDebt` = `principal + interestOwed`; `isLiquidatable` = `icr < MCR`; `exists` from `status`; `liquidationPrice` and `healthFactor` from `math/` |

None of the five re-implements protocol logic; each is a thin function of values the contract
returned in the same call, and after MK-017 the two formulas live in exactly one place. What the SDK
never does is recompute debt or interest itself, which is the true claim the false one was reaching
for. Writing "two" when the answer was "five", inside the wave whose subject is claims that overstate
reality, is worth recording rather than quietly fixing.

**On "validated twice", it is replaced rather than reworded.** Two was never the number and is now
three: forked contracts, the contracts' own `pure` helpers, and actual transaction outcomes via the
differential harness. Rather than update a count that will go stale again, every occurrence now
points at `docs/09` §3, which states coverage per surface INCLUDING what it does not cover.


---

## MK-016 · Test suite is one stateful sequence with unpinned fork and flake mitigations

**Class** S3 · **Status** open

The suite runs serially in alphabetical order with cumulative EVM clock warps leaking between
phases, against an unpinned fork, and carries flake mitigations including retry loops, a fixed gas
limit, and repeated oracle refreshes. Flake mitigation is a signal: some of what it hides may be a
real finding rather than test infrastructure noise.

**Decision.** Fix now, first, because nothing else can be trusted until it is done. Split unit and
fork projects, pin the fork block in CI, then remove each mitigation one at a time and treat
whatever still fails as a finding. Note honestly that pinning does not make the suite order
independent; the clock coupling is a separate structural limit.

**Landed in the P0 wave.**

- The suite is split into two vitest projects (`vitest.workspace.mts`). The `unit` project has no
  `globalSetup`, so it needs neither an anvil binary nor an RPC URL, and CI runs it before Foundry
  is installed to keep that honest. `pnpm test:unit`, `pnpm test:fork`, `pnpm test` runs both.
- The chain free math has real unit tests derived from the Solidity, not from the SDK's own output:
  `packages/core/test/math.test.ts`. The fork side cross checks against the contract's `pure`
  helpers are deliberately kept, they are the other half of the pair.
- The fork block is pinned in CI via `MEZO_FORK_BLOCK`, with a comment stating how to bump it.
- The coverage gate is configured and enforced, at the honest measured floor.

**Landed in the P5b wave: the mitigations were measured, then three of four came out.**

Measured first, because nobody knew whether they fired. Ten `pnpm test:coverage` runs, Node
24.19.0, pinned block 15043414, all ten green:

| Mitigation | Invocations | `attempts=1` | Ever retried |
|---|---|---|---|
| `ensureWriteMined` (react writes) | 40 | 40 | **no** |
| `redeemFresh` (phase 6) | 30 | 30 | **no** |
| `zzFindingsRedeemRetry` | 10 | 10 | **no** |
| `openTroveRawFixedGas` | 670 opens | n/a | gasUsed 576469 to 605443 against a 6000000 cap |

**Not one retry fired in 80 retry-loop invocations.** In the two runs where `ensureWriteMined`
ever did fire it ran to exhaustion and failed anyway (MK-025, MK-034). They were not protecting the
suite, they were making its stability unmeasurable.

Removed, one per commit with a window after each: the react write refire, then both redemption
retries. `refreshOracle` went too, as MK-032 rather than as a mitigation, and its 50 call sites now
say `mineBlocks(1)`, which is what it always did.

**The fixed 6M gas cap in `openTroveRaw` is DEFERRED, not removed**, and the reason is evidence
gathered later in the same wave. **Provenance: UNESTABLISHED**, no instrument was committed for it
and none exists now. 670 opens used 576469 to 605443 gas against a 6000000 cap, roughly
a tenfold headroom never approached, which argues the cap does nothing. Against that, the phase 6
redemption failure this wave finally read reverted with `gasUsed: 710023`, zero logs, and a replay
at the mined block that did NOT revert, which is the signature of a gas or state dependence rather
than a protocol rule. Removing a gas cap blind, at the end of a wave, while that is live and
unexplained, is the wrong order to do things in.

**Landed in the P8 wave: the differential harness exists.** `docs/09` §3 has carried a row saying
"the differential harness, see below: being built" since P0. It is built:
`packages/core/test/differential.fork.test.ts`, seeded, boundary weighted 60/20/20, every case
snapshot isolated, both failure directions reported separately. A 1000 case sweep from seed
`20260826` found **nothing**, which is a fact about the sweep rather than proof of correctness,
and `docs/09` states what it does not cover.

**What it did find is three false findings of its own**, all from one bug in its fixture, and
that is the part worth remembering. `seedPosition` did not await the seed open's receipt, so the
preview ran before the Trove existed. It produced two `FALSE_BLOCKED` mismatches, the direction
this harness exists to find and therefore the one nobody would have questioned, plus two thrown
cases. All four disappeared when the receipt was awaited. A harness that manufactures the
findings it was built to detect is worse than no harness, and the only thing that caught it was
reading `TROVE_NOT_ACTIVE` in the reasons and asking why a freshly opened Trove was not active.

**What remains open, and why this stays `open`.** The suite is still one stateful sequence: the
`fork` project shares one anvil instance, the cumulative EVM clock warps couple the phases, and the
alphabetical sequencer orders that coupling without decoupling it. That was always going to outlive
the pin. `docs/07-testing.md` §1 states it as a known structural limit.

**The observed red rate after this wave is not zero, and pretending otherwise would defeat the
point of measuring.** Two red in eighteen `pnpm test:coverage` runs after the retries came out,
against zero in eighteen before, at counts where that difference is not distinguishable and where
the retries provably never fired in the eighteen runs that had them. The honest reading is that the
suite is not stable either way and the retries were never the variable.

**The pin alone did not resolve this finding**, because the oracle shim seeded itself from a
`latest` read rather than from the forked block, so the fork block determined the chain state but
not the price; that half is now MK-020, fixed, and the ordering coupling above is what still keeps
MK-016 open.

---

## MK-017 · Duplicated derivations and placeholder values

**Class** S3 · **Status** open

Liquidation price and health factor are implemented twice, once as pure functions in `math/` and
once inline in `read/getTrove.ts`. `errors/mapRevert.ts` constructs two numeric errors with
placeholder zeros. `getHealthFactor` converts through a fixed point scale that loses meaning for a
zero debt sentinel ICR. Three `as unknown as Abi` casts and one `any` remain in the write path.

**Decision.** Fix now. Single source each derivation, remove the placeholders, handle the sentinel,
and type the write path properly.

**Fixed, P9 wave.**

- **Single sourced.** `read/getTrove.ts` calls `computeLiquidationPrice` and `getHealthFactor`
  rather than writing the formulas out again. Proven value identical rather than asserted:
  `packages/core/test/mk-017-dedup.test.ts` reproduces the OLD inline expressions verbatim and
  compares them against the pure functions across a grid of seven collaterals by five debts, plus
  the MCR and CCR thresholds and one wei either side.
- **The placeholders are gone, and the shape changed rather than the values being invented.**
  `BelowMinimumDebt` and `InsufficientMusdBalance` now take their numbers as OPTIONAL. The pre-send
  guard knows them and passes them; `mapRevert` decodes a revert string and does not, so it passes
  nothing and the message says the figures are unavailable and why. Previously a user who tried to
  draw 1700 against a floor of 1800 was told their net debt was 0 and the minimum was 0.
- **The sentinel is handled, and it CHANGES a value.** This is stated because it is true rather than
  hidden because it is inconvenient: `getHealthFactor` on the zero debt sentinel used to return
  `1.0526553567028745e59`, a finite number with no interpretation. It returns `Infinity`. The read
  path is unaffected, because `getTrove` returns its zero-Trove early with `healthFactor: 0` and
  never passes an infinite ICR, and a test pins that. The existing `math.test.ts` case that PINNED
  the old limitation, with a comment saying it "is expected to change when the sentinel is handled",
  was flipped to assert the new behavior.
- **The casts.** All three `as unknown as Abi` are gone: a plain `: Abi` annotation is sufficient,
  which means they were never needed. Both `any` declarations in `internal/write.ts` are gone,
  replaced by a `satisfies DynamicWriteParams` on the literal, so a misspelled field is a compile
  error again. **Three casts remain, at dependency boundaries, and are kept with the specific
  reason** rather than to make a count go down: `simulateContract`, `estimateContractGas` and
  `writeContract` each take a different parameter type, all generic over the ABI and the function
  name, and both are runtime values on this path. Typing the object as
  `SimulateContractParameters<Abi, string, readonly unknown[]>` compiles and then fails at all three
  call sites with `Type 'Account' is not assignable to type 'null | undefined'`, not assignable to
  `EstimateContractGasParameters`, and `WriteContractParameters<readonly [never], ...>`. That was
  tried and reverted, not assumed.

**A correction to the prompt that asked for this.** It said "five casts of the form `as unknown as`
plus one `any`". The source had **three** `as unknown as Abi` and **two** `any` declarations, which
is what this entry itself said. The count in the request was wrong; the work was done against the
source.

---

## MK-018 · Fee exemption is not modeled

**Class** S1 · **Status** fixed · **Severity assigned from evidence, not assumption**

`GovernableVariables.isAccountFeeExempt` zeroes the borrowing fee on open, on debt increase, and on
refinance. The SDK does not model it. Neither does Mezo's production dApp.

**The exempt set is NOT empty on mainnet.** That is what decides this, and it is now measured
rather than guessed. At mainnet block 11330182, two accounts are fee exempt. Four accounts have
been granted exemption over the chain's history and two of those have since had it removed, so the
mechanism is not merely deployed, it is actively administered. On testnet, at block 15043414, the
set is empty.

**Blast radius: these are ordinary accounts, not protocol plumbing.** Both accounts exempt at
mainnet block 11330182 have **no code**, and neither matches any address the protocol is known to
own: they were checked against 37 addresses drawn from every deployment record in the pinned
contracts package, proxy and implementation addresses alike, plus every address the SDK bundles.
The same holds for all four accounts ever granted. That distinction matters more than the severity
letter. Had the exempt set been protocol owned contracts, the wrong number would surface inside
Mezo's own tooling; instead it surfaces for external accounts, which is exactly the population that
reaches for an SDK. Unmatched and code free is all that is claimed here: it is not evidence of who
owns those accounts, and nothing in this register infers ownership.

The individual addresses are deliberately not listed, here or in the generated block. They are
public chain data and `pnpm facts` reproduces them against the same pinned block, so withholding
them costs a reader nothing they cannot recompute; printing them would attach a durable "fee
exempt" label to specific accounts in a public register without adding anything the count and the
characterization above do not already carry.

**How that was established.** A genesis to pinned block scan of `FeeExemptAccountAdded` and
`FeeExemptAccountRemoved` on `GovernableVariables`, event and getter names read from the deployed
ABI rather than assumed, in 1134 chunks of 10000 blocks on mainnet and 1505 on testnet, with every
address ever granted then re-checked against `isAccountFeeExempt` at the pinned block so a removal
is confirmed by the contract rather than inferred from event pairing. No address was guessed or
probed. Recorded in full in `docs/09-review-and-validated-surface.md` §6.

**Why S1.** For an exempt account the contract charges no borrowing fee, while
`packages/core/src/math/previewOpen.ts` applies `getBorrowingFee(debt)` unconditionally. The
caller is shown a debt, an ICR and a liquidation price computed from a fee that will not be
charged. It is a silently wrong number with no error raised, which is the S1 definition, and the
cohort it is wrong for exists on mainnet today.

**Scope of the claim.** Both statements above are facts about specific blocks, not permanent
properties: the set is governable and can change without notice in either direction. The empty
testnet result in particular must not be read as "fee exemption is unused"; it was empty at block
15043414 and nothing more.

**Decision.** Fix, in the same wave as MK-004, since both are the borrowing fee being applied when
the contract will not charge it. Read `isAccountFeeExempt` for the account being previewed and
skip the fee when it returns true.


**Fixed in the P3a wave.** `previewOpen` takes an optional `account` and consults
`GovernableVariables.isAccountFeeExempt` through the new `MathDeps.isAccountFeeExempt`, so it
charges what the contract charges for that caller. The GovernableVariables address is read from
`borrowerOperations.governableVariables()` rather than added to the bundled map, so it cannot
disagree with the BorrowerOperations already in use. With no account supplied the preview assumes
not exempt and reports that via `feeExempt: false`, making the assumption visible rather than
silent. The same rule is applied on the debt increase path, where the fee is likewise skipped.

**Not witnessed, and therefore owed.** The exempt branch on the DEBT INCREASE path,
`effectiveBorrowingFee` in `packages/core/src/trove/index.ts` mirroring
`BorrowerOperations.sol:810-818`.

**Discharged, P8 wave: the exempt DEBT INCREASE branch was watched executing.**
`packages/core/test/obligations.fork.test.ts` grants exemption by impersonating the council,
opens a position, then BORROWS against it:

    draw            2000000000000000000000
    quotedFee       2000000000000000000      what a non exempt account would pay
    preview.fee     0                        previewBorrow reports the waiver
    principalAdded  2000000000000000000000   exactly the draw, no fee

Principal rather than entire debt, so accrued interest between the two reads cannot be mistaken
for a fee.

**Previously reasoned from source and NOT observed:** the fork test granted
exemption and exercised the OPEN path only. Reaching the exempt debt increase is on the
differential harness coverage list in `docs/09-review-and-validated-surface.md` §3.
---

## MK-019 · `refinance()` reverts in Recovery Mode, unchecked and undocumented

**Class** S2 · **Status** fixed

**Ground truth.** The refinance path calls `_requireNotInRecoveryMode(price)` before anything else,
so a refinance attempted in Recovery Mode always reverts.

**SDK location.** `packages/core/src/trove/index.ts:274-284`. No mode check, and the docstring for
`refinance()` does not mention the restriction. Simulate before send catches it, so the user sees a
mapped revert rather than a bad transaction, which is why this is S2 and not S1.

**Decision.** Fix now, alongside MK-003: surface the restriction in the preview and in the
docstring.


**Fixed in the P3b wave, and the record corrected.** This was never a safety gap. Simulate before
send already surfaced the revert as a typed `RECOVERY_MODE_RESTRICTION`, which a test written in the
P2 wave asserted and which still passes: the SDK behavior a caller could observe was already
correct. What was missing is that the restriction could not be learned WITHOUT sending, and was
documented nowhere. `previewRefinance` reports it, and reports it as the FIRST binding reason
because `_requireNotInRecoveryMode` is the first requirement `_refinance` applies
(`BorrowerOperations.sol:1024`), and the `refinance()` docstring now states it.
---

## MK-020 · Oracle shim seed is not pinned, so a pinned fork block is not a pinned price

**Class** S3, harness · **Status** fixed · **Found by us while remediating MK-016**

**What was wrong.** The fork harness cannot read Mezo's BTC/USD oracle from the fork itself: the
address is a native precompile served by the node's Cosmos oracle module, and the stored EVM
bytecode only self-recurses, so an anvil fork of it reverts. The harness works around that by
reading the real round from the upstream node and seeding a shim
(`packages/core/test/harness/oracle.ts`, `installOracleShim`). That read passed no block number,
so it resolved at the upstream chain's `latest`. Pinning `MEZO_FORK_BLOCK` therefore pinned the
chain state and left the price floating with wall clock time.

The consequence is narrow to state and wide in effect: the fork suite had two independent inputs,
one pinned and one not, while the documentation claimed determinism from the pin alone.

**Reproduction.** Four full suite runs, all at fork block 15043414, seeded four different answers:

| Run | Fork block | Seeded answer (BTC/USD, 1e18) |
|---|---|---|
| 1 | 15043414 | `77226724770000000000000` |
| 2 | 15043414 | `77005799990000000000000` |
| 3 | 15043414 | `77090810000000000000000` |
| 4 | 15043414 | `77011376590000000000000` |

The observable failure was `packages/core/test/phase9-keeper.fork.test.ts`, which asserted that
the fork's lowest ICR tail was still under MCR. Whether that held depended on the seeded price and
on how much of that tail phase 6 had already liquidated. It failed with `liquidated.length === 0`
on runs 1 and 3, and passed on runs 2 and 4: a coin flip, not a check. That failure is a symptom of
this finding combined with the ordering coupling that remains in MK-016, and is deliberately not
given an ID of its own.

**Ground truth for the fix.** Whether the endpoint honours a historical block tag on a precompile
served outside the EVM is a property of the endpoint, not something to assume, so it was measured.

> **Provenance: UNESTABLISHED.** The probe was ad hoc and was not committed, so the reads below
> cannot be re-run as they were, though a chain read at a pinned block is cheap to redo from
> scratch. The conclusion is separately pinned by the shim itself, which throws for any block other
> than the one its seed was recorded at.

Twelve consecutive `eth_call` reads of `latestRoundData()` pinned to block 15043414 returned one
identical round (`roundId 13948341`, answer `77051107320000000000000`), a read pinned one million
blocks earlier returned a genuinely older round (`roundId 12899794`), and a read at block 4096
returned `header not found`, which is the endpoint's pruning boundary rather than a silent wrong
answer.

**Fix.** `installOracleShim` now takes the block to read at and receives the fork's own anchor
block (`packages/core/test/harness/anvil.ts`), so the fork block is the single input that
determines the price. When the endpoint can no longer serve that block, the harness falls back to
`RECORDED_ORACLE_SEED` in `packages/core/test/harness/constants.ts`, but only for the exact block
that seed was recorded at, and never quietly: it warns loudly, and for any other block it throws
rather than seed a price that does not belong to the forked state. The seeded answer and the block
it came from are printed at suite startup, so a future divergence is readable in the log instead of
being reconstructed from a failure.

Note what is unchanged: `startedAt` and `updatedAt` are still stamped with the fork's own block
time, not the round's, because the PriceFeed freshness check would otherwise reject a historical
round outright. Only the price and the round id come from the pinned read.

---

## MK-021 · Phase 3 warm up hook exceeds its fixed budget on a cold fork

**Class** S3, harness · **Status** fixed · **Found by us while proving MK-020**

**Ground truth for our own policy.** `docs/07-testing.md` §5 states the suite must pass twice
identically. It does not, and the remaining reason is this one.

**What happens.** `packages/core/test/phase3.fork.test.ts:67-69` runs a `beforeAll` whose only job
is to warm anvil's lazy state cache, with a hard 180 second budget:

```ts
beforeAll(async () => {
  await client().computeHints({ collateral: 10n ** 17n, entireDebt: 2202n * 10n ** 18n })
}, 180_000)
```

It asserts nothing. When it exceeds the budget, vitest fails the suite and **skips all six phase 3
tests**, so a latency event is reported as if the insertion hint module were untested.

**Reproduction.** Five consecutive full suite runs at pinned block 15043414: runs 1 and 3 failed
with `Hook timed out in 180000ms` and `97 passed | 6 skipped`; runs 2, 4 and 5 passed 103 of 103.
An earlier wave saw the same hook time out once in four runs, so three of nine observed full runs.
Nothing else failed in any of the nine.

**Why we think it is latency and not a defect in the code under test.** The warm up calls
`computeHints`, whose `getApproxHint` samples many SortedTroves nodes, and every sampled node on a
cold anvil fork is a lazy state fetch to the upstream RPC. Measured directly: the same cold fork
hint ritual inside an isolated `openTrove` took 271 seconds, comfortably past this hook's 180
second budget, while the identical call once the cache is warm takes about 4 seconds. So the budget
sits inside the range the cold path actually occupies, rather than above it.

That is a hypothesis about the cause, not a verified root cause. What is verified is the timing
spread and that the hook asserts nothing.

**Root cause, measured rather than reasoned about.** The 60x cold-to-warm gap is not computation,
it is upstream state fetching, and the reason it recurred on every run is that the cache which was
supposed to prevent it was never written. anvil lazily fetches upstream state on first access and,
when the fork block is pinned, persists it to `~/.foundry/cache/rpc/<chainId>/<block>/storage.json`.
It writes that file only on a graceful shutdown. `packages/core/test/harness/anvil.ts` sent
`SIGKILL`, so it never did.

A counting proxy placed between anvil and the upstream RPC, measuring one warm up call:

| | Cold (no cache) | Warm (cache present) |
|---|---|---|
| Warm up duration | 168997 ms | 130 ms |
| Upstream JSON-RPC calls | 913 | 3 |
| of which `eth_getStorageAt` | 849 | 0 |
| Bytes from upstream | 163743 | 1514 |
| Hints returned | `0xd151..02d, 0xCB0a..9Cd` | identical |

849 sequential storage reads at public endpoint latency is the entire cost. Isolating the shutdown
signal confirmed the cause directly: forking, touching state, then `SIGTERM` writes a 52 KB
`storage.json`; the identical sequence with `SIGKILL` writes nothing.

**Fix.**

- `stopFork` now sends `SIGTERM` and only escalates to `SIGKILL` after a 15 second grace period, so
  anvil flushes its fork cache and a wedged process still cannot outlive the suite.
- The warm up moved from `phase3.fork.test.ts` into `harness/globalSetup.ts`. The cost is paid once
  for the suite, is attributed to the harness rather than to one phase, and is logged.
- That warm up now traverses the WHOLE sorted list, via one `findInsertPosition` call with a
  near zero NICR and no hints, which walks from head to tail and touches every node. The first
  attempt warmed a single `computeHints` position instead and a cold run still failed, in a
  different phase 3 test, at the ordinary 60 second timeout. The reason is worth recording: phases
  that open Troves grow the list, `trialsForSize` then returns a different trial count, and
  `getApproxHint` therefore samples a different node set which was never warmed. Traversing the
  whole list is a superset of any later sample or traversal, so it is immune to that. Troves opened
  during the run are local anvil state and need no upstream fetch.
- CI caches `~/.foundry/cache/rpc/31611/<block>` keyed on the block, so a cold fetch happens once
  per pinned block rather than once per push. Both the path and the key carry the block number and
  there is deliberately no `restore-keys` prefix fallback, because replaying one block's state at
  another block would reintroduce precisely the nondeterminism MK-020 removed.

**The budget is gone, not raised.** The 180 second `beforeAll` timeout was deleted rather than
enlarged. vitest imposes no timeout on `globalSetup`, so a cold run is now slow instead of red, and
the phase 3 tests run under the ordinary `testTimeout`. That the old number was the flake is not a
guess: measured end to end through the real harness, the cold warm up took 181335 ms, which
overshoots the 180000 ms budget by 1.3 seconds. The same call on the next run took 42 ms.

---

## MK-022 · `batchLiquidate` phase 6 test intermittently leaves one Trove unliquidated

**Class** S3, harness · **Status** open · **Found by us while verifying the MK-020 and MK-021
merge into `main`**

**What happens.** `packages/core/test/phase6.fork.test.ts:270` opens two Troves at a target ICR of
about 1.12, drops the price to `originalPrice * 100 / 113` so both sit well under MCR, calls
`batchLiquidate` on the pair, and asserts both reach status 3, closed by liquidation. On one run in
six it failed with `expected 1 to be 3`: one of the two was still status 1, active, after the batch
call returned and the receipt was awaited.

**Reproduction and rate.** Six full runs of `pnpm test:coverage` at pinned block 15043414, one red.
Three additional `pnpm test:fork` runs on the same tree were green. The seeded oracle answer was
byte identical, `77051107320000000000000`, in every one of those runs, so this is not MK-020
resurfacing.

**Observed rate, measured in the P3a wave: one in twenty.** Twenty full `pnpm test:fork` runs at
the same pinned block produced four red runs, and exactly ONE of those was this finding's location,
`phase6.fork.test.ts:245`, again with `expected 1 to be 3`. The seed was byte identical in all
twenty. The other three red runs failed elsewhere and are registered separately as MK-023, MK-024
and MK-025 rather than folded in here: a flake without its own entry is indistinguishable from a
real regression when it surfaces in a later wave. So the phase 6 file is not one flaky test, it is
at least three distinct ones plus this.

**Not caused by the merge that surfaced it.** `git diff` between `chore/p0.2-cold-fork-warmup` and
`main` after the restore merge is empty, so the tree that produced the failure is byte identical to
the tree that ran five consecutive green earlier. The merge introduced nothing. It follows that the
same flake was latent in those five green runs and simply did not fire.

**What we do NOT claim.** No root cause. The obvious candidates were not confirmed and some are
already contradicted: interest accrual between open and liquidation lowers ICR further, so it makes
liquidation more likely rather than less, and both Troves are constructed identically from the same
captured `originalPrice`. Whether the Stability Pool balance at that moment, the ordering coupling
in MK-016, or something in the batch path is responsible is unestablished, and this entry
deliberately stops short of guessing.

**Why it matters more than a flaky test usually would.** The assertion is about liquidation
completing, which is the same surface MK-001 concerns. A test that passes five times in six is not
evidence about the sixth, and this one sits next to a finding we already know is wrong about
liquidation rules. It should be diagnosed before anyone reads the phase 6 file as confirmation of
liquidation behavior.

**P5b wave: not reproduced once in 46 coverage runs.** Across this wave's four windows,
`batchLiquidate` did not fail. It last fired in the P4 baseline, one run in ten. That is not
evidence it is fixed, nothing in this wave touched it, and the entry stays open at the same rate it
always had: the windows are simply too small to distinguish a one-in-ten event from a one-in-forty
one.

What did change around it is MK-031: the sibling liquidation event lookup in this same file no
longer crashes on a missing event, so if this test's liquidation ever fails by not emitting, the
report will say what the transaction did.

**Decision.** Diagnose alongside MK-016. Do not raise a timeout or add a retry: nothing here timed
out, and a retry would hide exactly the signal worth keeping.

---

## MK-023 · Phase 6 `claim` fixture intermittently leaves the target Trove unredeemed

**Class** S3, harness · **Status** open · **Found by us in the P3a wave, attributing red runs**

**What happens.** `packages/core/test/phase6.fork.test.ts:334` opens a Trove at the very bottom of
the redeemable list, redeems past it so that it is FULLY consumed, and asserts its status reaches
4, closed by redemption, leaving a collateral surplus for its owner to claim. Intermittently the
status is still 1, active: `expected 1 to be 4`. The redemption did not consume the Trove it was
sized to consume.

**Reproduction and rate.** Two in twenty. Twenty full `pnpm test:fork` runs at pinned block
15043414 on the P3a branch, red on runs 3 and C, both with the identical assertion. The seeded
oracle answer was byte identical, `77051107320000000000000`, in all twenty, so the price is not the
variable.

**Why it is NOT MK-022.** Different test, different line, different assertion, different operation.
MK-022 is `batchLiquidate` at `:245` asserting status 3. This is a redemption at `:334` asserting
status 4. They share a file and a suspected family, the shared mutable fork, and nothing else.

**What we do NOT claim.** No root cause. The redeemable tail is mutated by every earlier file that
opens, liquidates or redeems, so how much of it survives to this test is a function of everything
before it, which is the MK-016 ordering coupling. Whether that alone explains it, or whether the
truncation arithmetic in `getRedemptionHints` is also involved, is unestablished.

**P5b wave: reproduced twice with the margin now measured, and the tail is NOT the cause.** This
test's redemption target sits `1016833685396814` above MCR, and that number is BYTE IDENTICAL across
all ten runs of the measurement window, failing runs included. So whatever decides this, it is not
how much margin the marginal Trove has when the redemption starts. The redeemable amount reported
immediately before is also the full requested amount every time.

That removes the ordering hypothesis this entry has carried since P3a, at least in the form
"how much of the tail survives to this test". Something else decides whether the redemption
consumes the Trove it was sized to consume.

**Decision.** Still open, still not retried: the assertion is about a redemption completing and a
retry would hide precisely the signal. What has changed is that the next occurrence arrives with the
margin, the redeemable amount and the block timestamp already logged.

---

## MK-024 · Phase 6 normal mode liquidation intermittently crashes on a missing event

**Class** S3, harness · **Status** open · **Found by us in the P3a wave, attributing red runs**

**What happens.** `packages/core/test/phase6.fork.test.ts:198` fails with
`TypeError: Cannot read properties of undefined (reading 'args')`. It is a CRASH, not an assertion:
the test looks up an expected event in the receipt's logs and the lookup returns `undefined`, so
the property read throws before any assertion runs.

**Reproduction and rate.** One in twenty, run 10 of the twenty P3a fork runs at pinned block
15043414, seed byte identical.

**Why it is NOT MK-022, and why it is worth its own entry more than the others.** Different test and
different line, but the reason to separate it is the failure MODE. A `TypeError` on a missing event
tells you nothing about what actually went wrong on chain: the liquidation may have reverted,
liquidated nothing, or emitted a different event, and the crash hides which. Folded into another
entry it would read as the same symptom as an assertion failure, which it is not. The test should
be made to fail with the on-chain reason rather than a property access on `undefined`; until it
does, every occurrence of this costs a diagnosis from scratch.

**P5b wave: the failure MODE this entry complained about is fixed, and it immediately answered the
entry's own open question.** MK-024 asked that "the test should be made to fail with the on-chain
reason rather than a property access on `undefined`", and listed three possibilities it could not
distinguish: the liquidation may have reverted, liquidated nothing, or emitted a different event.

MK-031 did that, and this test then reproduced with the answer attached:

```
status: reverted
block: 15043617  gasUsed: 455529
logs emitted: 0
revert reason: the replay did NOT revert, so the failure was state or gas dependent
               rather than a require
```

**It reverted.** Not "liquidated nothing", not "emitted something else". And it reverted for a
non-`require` reason, which is the same signature as two redemption failures in the same wave. That
moves this entry out of the phase 6 flake family and into **MK-035**, which is an SDK write path
question rather than a test one. This stays open pending that.

**What we do NOT claim.** No root cause, and deliberately no guess about which of the three
possibilities above it is, because the crash removed the evidence that would have told us.

**Decision.** Diagnose in the mitigation removal wave. The first fix is to the test's own error
handling, so that the next occurrence reports what the chain did.

---

## MK-025 · React block watching test intermittently sends a write that reverts

**Class** S3, harness · **Status** open · **Found by us in the P3a wave, attributing red runs**

**What happens.** `packages/react/test/hooks.fork.test.ts:157`, the hook refetch on a new block,
fails with `expected 'reverted' to be 'success'`. A transaction the test sends to produce a new
block reverted instead of mining successfully.

**Reproduction and rate.** One in twenty, run F of the twenty P3a fork runs at pinned block
15043414, seed byte identical. Notably run F was the only run with TWO failures: this and MK-022.

**Why it is NOT MK-022.** Different package entirely, `@musd-kit/react` rather than
`@musd-kit/core`, a different mechanism, a write reverting rather than a liquidation not taking
effect, and a different failure surface. It is also the only observed failure outside
`phase6.fork.test.ts`, which matters: it shows the intermittency is not confined to one file.

**Relationship to an existing mitigation.** `hooks.fork.test.ts` already carries `ensureWriteMined`,
the four attempt refire loop listed as mitigation 2 in the P0 flake inventory, precisely because
writes on the shared fork revert after a passing simulate. This failure means the mitigation did
not save this particular write, which is information about the mitigation as much as about the
test. The P0 inventory flagged that loop as the most suspicious of the set, because a simulate that
passes followed by a revert is the MK-005 bug class; MK-005 is now fixed, and this still happened.

**What we do NOT claim.** No root cause, and specifically not that MK-005's fix should have
prevented it. The revert reason was not captured.

**Decision.** Diagnose in the mitigation removal wave, when `ensureWriteMined` is removed and
whatever then fails becomes a finding. Capture the revert reason first.

---

## MK-026 · Phase 5 lifecycle writes fail only under the coverage run, never under a plain fork run

**Class** S3, harness · **Status** open · **Found by us in the P3a wave, and PROVEN pre existing**

**What happens.** `packages/core/test/phase5.fork.test.ts` fails intermittently, far more often
under `pnpm test:coverage` than under `pnpm test:fork`. Four symptoms have been seen in the same
file, all of them a write that did not take effect:

| Where | Symptom |
|---|---|
| `phase5.fork.test.ts:191` `adjustTrove combined` | `expected 600000000000000000n to be 550000000000000000n`, the collateral withdrawal did not apply |
| `phase5.fork.test.ts:191` `adjustTrove combined` | `No open Trove for 0xEB41...`, the `openTrove` that starts the test did not take effect at all |
| `phase5.fork.test.ts:114` `full lifecycle via the SDK` | `expected 500000000000000000n to be 600000000000000000n`, likewise a collateral step |
| `phase5.fork.test.ts` `simulate-before-send surfaces reverts` | `expected false to be true`, the Trove the test opened does not exist at the end |
| `phase5.fork.test.ts:176` `full lifecycle` | `expected 'reverted' to be 'success'`, the `close()` receipt came back reverted. Added in the P5a wave, the first symptom in this family where a receipt STATUS is the assertion that fails rather than a downstream read |

**It is NOT ours, and that was proven rather than argued.** This first appeared while landing the
P3a changes, in `adjustTrove`, code that wave modified, so it had every appearance of a regression.
Two checks settled it:

1. **Reproduced on unchanged `main`.** `main` was checked out and `pnpm test:coverage` run twice at
   pinned block 15043414: one green, one red, in the same `phase5.fork.test.ts`. No P3a change is
   present on that tree.
2. **The changed code is not on the failing path.** The failing step in the `adjustTrove` case is
   `withdrawCollateral + repay`, where `brw` is undefined, so the borrowing capacity precheck added
   in P3a never runs and the effective fee stays zero. The remaining P3a edit to that function is
   hoisting a `const owner` declaration, which changes no behavior.

**Reproduction and rate.** Two red in three `pnpm test:coverage` runs on the P3a branch, and one
red in two on `main`. Against that, ZERO red in twenty `pnpm test:fork` runs on the same branch at
the same block, where the four failures that did occur were MK-022, MK-023, MK-024 and MK-025, none
of them in phase 5. That asymmetry is the finding.

**Rate under coverage, P5a wave.** Five `pnpm test:coverage` runs on the P5a branch, Node 24.19.0,
pinned block 15043414: three green, two red, both in this test. Run 1 was
`expected false to be true` at `:123`, the opening write not taking effect, which is the second row
of the table above. Run 2 was the new `:176` row. Two in five is the worst rate observed for this
entry so far, against two in three on the P3a branch and one in two on `main`, so the spread across
windows remains wide and no stable rate can be quoted.

**Correction, P3b wave: the asymmetry is not absolute.** This entry originally said phase 5 fails
under coverage and "so far never under a plain fork run". That is now falsified. One of five plain
`pnpm test:fork` runs on the P3b branch went red at
`phase5.fork.test.ts` `simulate-before-send surfaces reverts`, with
`expected false to be true`: the Trove the test opened did not exist by the end, so the opening
write did not take effect, which is the same symptom as the three under coverage. Coverage
instrumentation therefore makes it much MORE likely, not uniquely possible, which weakens the
timing hypothesis below from "the instrumentation causes it" to "the instrumentation widens a
window that is already there". The rate under a plain fork run is one in five on that branch,
against zero in twenty on the previous one, so it is not a stable rate either.

  MEZO_TESTNET_RPC_URL=<a Mezo testnet endpoint> MEZO_FORK_BLOCK=15043414 pnpm test:coverage

**The condition traced, and what we do NOT claim.** The only difference between the two commands is
the v8 coverage instrumentation and the extra unit project, so the working hypothesis is that
instrumentation slows execution enough to widen the window between simulate and mine on the shared
fork, which is the same window `openTroveRaw` already carries two `refreshOracle` calls and a fixed
gas limit to defend against. That is a hypothesis about the mechanism, not a verified root cause:
the reverts were not captured with their on chain reason, and no timing was measured. What IS
verified is the asymmetry, that it predates P3a, and that the P3a changes are off the failing path.

**Why it matters.** CI runs `pnpm test:coverage`, not `pnpm test:fork`. So this is the flake that
actually reddens the pipeline, and it is the one least visible to anyone running the fork suite
locally. It also means the coverage number itself is only obtainable on a green run, which cost
three attempts in the P3a wave.

**P5b wave: not reproduced once in 46 coverage runs, which is itself the news.** Across the four
windows this wave ran, ten before any change, five after the oracle helper went, eight after the
write refire went and eighteen after the redemption retries went, `phase5.fork.test.ts` did not fail
once. It failed two in five in the P5a window on the immediately preceding commit.

Nothing in this wave touched phase 5, so this is not a fix and must not be read as one. What
changed around it: `refreshOracle` became `mineBlocks(1)` at four sites in that file, which is the
same operation under an honest name, and the write refire it never used came out. The most likely
reading is that the rate genuinely varies this widely between windows, which is what this entry
already says about its own numbers.

**On its two symptoms sharing a cause**, which P5b was asked to establish: not established, because
neither symptom appeared. Both rows describe a write that did not take effect, one inferred from a
later read and one from a receipt status, and that is a shared shape rather than a shared cause.

**Decision.** Not fixed here. Diagnose alongside MK-016: capture the revert reason first, which
MK-031 now does automatically, then measure whether the simulate to mine window is really the
variable. Do not paper over it by disabling coverage in CI, which would trade a visible flake for an
invisible gap.

---

## MK-027 · Source files sit outside every typecheck and lint configuration

**Class** S3 · **Status** open, partially closed · **Found by us in the P3b wave, after it cost a
false green and a broken example**

**What was uncovered, and what it cost.** `packages/react/tsconfig.json` had
`"include": ["src"]`, so the whole of `packages/react/test` was outside every typecheck
configuration in the repository. This is not a one off oversight in a scratch directory: it is a
PUBLISHED package whose tests nothing typechecked. It produced two consequences, both observed
rather than hypothesised:

1. **A false green on a rename.** The P3b wave renamed `RedeemResult.fee` (MK-014).
   `pnpm typecheck` passed clean, because the only file still referencing the removed field was
   `packages/react/test/hooks.fork.test.ts`. The suite then failed FIVE out of five fork runs on
   that file. A rename that a compiler should have caught in a second cost five full fork runs to
   discover, at roughly four minutes each.
2. **A broken example reaching `main`.** `examples/open-and-manage/src/App.tsx:94` still read
   `preview.meetsRecoveryRequirement`, removed in the P3a wave, so
   `pnpm -r --filter "./examples/*" typecheck` FAILS on `main`. That is a step CI actually runs, so
   CI on PR 7 would have been red. It reached `main` because nobody, including us, ran that step
   locally and the acceptance criteria for that wave did not list it. That second half is addressed
   separately by the standing checklist in `docs/08-conventions.md` §10.

**What now covers it.** `packages/react/tsconfig.test.json` typechecks `src` and `test` together.
It is a separate config rather than an edit to the package tsconfig because that one also drives
the `tsup` build, and widening its `rootDir` would move the emitted layout. `packages/react`'s
`typecheck` script runs both. Adding that config is what surfaced the broken example, which is the
argument for it.

**What the audit found still outside, measured not guessed.** Every typecheck configuration the
repository runs was asked, with `tsc --listFilesOnly`, which files it actually visits, and the
result diffed against `git ls-files '*.ts' '*.tsx' '*.mts'`. Of 76 tracked TypeScript files, EIGHT
are visited by no configuration at all:

| File | Why it is outside |
|---|---|
| `packages/core/test/phase9-keeper.fork.test.ts` | Explicitly excluded at `packages/core/tsconfig.json:9` |
| `docs/.vitepress/config.ts` | `docs` has no `typecheck` script and no tsconfig covering it |
| `docs/.vitepress/theme/index.ts` | Same |
| `examples/open-and-manage/vite.config.ts` | The example tsconfig includes `src` only |
| `packages/core/tsup.config.ts` | Build config, in no `include` |
| `packages/react/tsup.config.ts` | Build config, in no `include` |
| `vitest.config.mts` | Root config, in no `include` |
| `vitest.workspace.mts` | Root config, in no `include` |

The first row is the sharpest: a fork test is excluded BY NAME, so it has exactly the property that
just cost five red runs, and it is the test that exercises the keeper example.

**The landing site is outside both gates.** `landing/` carries 27 tracked source files and is
listed in `biome.json`'s `files.ignore`, so none of them are linted. It has a `check` script,
`astro check`, but nothing runs it: not CI, not `pnpm build:site`. It also cannot run as configured,
because `@astrojs/check` is not installed; invoking it prompts to add the dependency. So the site
that fronts the project is neither linted nor typechecked, and the command that would typecheck it
is not installed.

**Why this is S3 and not lower.** Nothing here is a wrong number for a user. But this class of gap
produces exactly the failure the register exists to prevent: a green signal that means less than a
reader assumes. Someone reading "typecheck: Done" reasonably concludes the TypeScript in this
repository compiles. For eight files and an entire site, it does not say that.

**P5b wave: eight uncovered files down to TWO, and the gap was hiding a real error.**
`packages/core/tsconfig.test.json` brings the excluded fork test in, and `tsconfig.tools.json`
brings both vitest configs, both `tsup.config.ts` files and the example's `vite.config.ts`. Both are
wired into `pnpm typecheck`, so they cannot rot.

The exclusion of `phase9-keeper.fork.test.ts` had a real reason and a false claim attached. Commit
`6ae5058` said it "imports examples/ across the package rootDir, so it is excluded from core's tsc
and type-checked via vitest". The first half still holds. The second half was never true: vitest
transpiles with esbuild and does not typecheck, so that file had been checked by nothing. It passes
once included, so the exclusion was costing coverage without hiding an error.

`vitest.config.mts` did NOT pass, which is the point of doing this:

    vitest.config.mts(1,15): error TS2305: Module '"vitest/config.js"' has no exported member
    'TestSpecification'.

`TestSpecification` is exported from `vitest/node`, and `BaseSequencer.sort` is declared over
`WorkspaceSpec`. The sequencer that orders the entire fork suite, whose order MK-016 makes load
bearing, had an override typed against a name that did not resolve. Fixed to the real type, and the
`?? ''` fallback removed rather than kept: returning an empty path for every spec would sort them all
equal and silently destroy the ordering, so it throws with the reason instead.

**P9: zero tracked TypeScript files are now outside typecheck.** `docs/tsconfig.json` brings
`.vitepress/config.ts` and `.vitepress/theme/index.ts` in, and it is wired into `pnpm typecheck` so
it cannot rot. Re-audited with `tsc --listFilesOnly` against `git ls-files`: nothing left.

Including them surfaced a real error, twice over, which is the point of doing it. First
`docs/.vitepress/config.ts:3` imports `landing/src/lib/code-theme.mjs`, a plain ES module with no
types, so it was an implicit `any`. Then, once `allowJs` let TypeScript read the object, it failed
against shiki's `ThemeRegistrationResolved`, which requires `settings`, `fg` and `bg`.

**The mismatch has no runtime consequence** and that was checked rather than assumed: it is a valid
raw TextMate theme, shiki accepts it, and `pnpm build:site` renders both the landing site and the
docs with it. What was wrong was the DECLARATION, not the theme, so `landing/src/lib/code-theme.d.mts`
declares it as `ThemeRegistrationRaw`, the arm of shiki's union it actually belongs to. It was not
silenced with a cast to make the count go down.

**The landing site: a deliberate limit, narrowed rather than closed.** It stays out of `biome.json`
lint and out of typecheck, and the reason is proportion rather than laziness. It ships no code to
any consumer: it is a marketing and documentation site whose failure mode is a broken page, and that
IS gated, by `pnpm build:site` running on every push (`ci.yml:204`), which builds all 27 sources and
runs the link check.

**What was NOT defensible was the `check` script**, and it is removed. `landing/package.json` carried
`"check": "astro check"`, run by nothing and unable to run at all, because `@astrojs/check` is not
installed. A script that names a gate which does not exist is the same defect as a document that
implies coverage it does not have, which is the subject of this whole wave. Removing it is more
honest than leaving it as an aspiration.

**Decision.** The hole that caused both observed consequences is closed. The eight files and the
landing site are recorded here and NOT fixed in this wave, because closing them means touching build
configuration and adding a dependency, which does not belong in a bookkeeping commit. Closing them
is cheap and specific: add the root configs and the two `tsup.config.ts` files to
`scripts/tsconfig.json`, drop the `phase9-keeper` exclusion and fix whatever it then reports, give
`docs` a tsconfig covering `.vitepress`, and either install `@astrojs/check` and run it in CI or
remove the `check` script so it stops implying a gate that does not exist. This entry stays open
until that is done.

---

## MK-028 · The DOM test environment pairs jsdom's `AbortSignal` with Node's `Request`

**Class** S2, harness · **Status** fixed · **Found by us reading the first CI run anyone in this
programme had looked at**

**What happens.** The whole of `packages/react/test/hooks.fork.test.ts` fails at suite level, before
a single assertion runs. All ten of its tests are reported skipped:

```
 FAIL |fork|  packages/react/test/hooks.fork.test.ts [ packages/react/test/hooks.fork.test.ts ]
HttpRequestError: HTTP request failed.
URL: http://127.0.0.1:39709
Request body: {"method":"anvil_mine","params":["0x1","0x0"]}
Details: RequestInit: Expected signal ("AbortSignal {}") to be an instance of AbortSignal.
Caused by: TypeError: RequestInit: Expected signal ("AbortSignal {}") to be an instance of AbortSignal.
 at Object.webidl.errors.exception node:internal/deps/undici/undici:4859:14
 at Object.AbortSignal node:internal/deps/undici/undici:5118:31
```

`packages/react/test/phase9-app.fork.test.ts` is reported as passing but leaks the same error as an
unhandled rejection on `eth_accounts` through the wagmi mock connector, so vitest also reports
`Errors 1 error`. Both files, not one.

**What it is NOT.** Not a test assertion, not a timeout, not the coverage gate, not an RPC problem,
and not the fork cache. Coverage never ran at all: the failing job's log contains zero coverage
output lines, because `vitest run --coverage` exits non zero before printing the table. The URL in
the error is the local anvil endpoint, not an upstream one.

**Mechanism, measured rather than assumed.** viem's HTTP transport builds
`new Request(url, { signal })` from an `AbortController` it constructs itself
(`viem/utils/rpc/http.ts:118`, reached from `clients/transports/http.ts:125`). jsdom supplies its
own `AbortController` and `AbortSignal` but supplies neither `fetch` nor `Request`, and vitest's
jsdom environment copies the jsdom window over `globalThis`. A test file therefore holds jsdom's
signal and Node's `Request`. From Node 24 on, undici brand checks `RequestInit.signal` against its
own class and throws.

Probed directly, on Node 24, in this repository:

| Environment | `String(globalThis.AbortSignal)` starts | `new Request(url, { signal })` |
|---|---|---|
| `node` | `class AbortSignal extends EventTarget` | ACCEPTED |
| `jsdom` | `class AbortSignal extends globalObject.E` | REJECTED |

The same probe on Node 20.20.1 and Node 22.23.1 under `jsdom` returns ACCEPTED, which is the entire
reason this was never seen locally.

**A wrong turn worth recording.** An earlier probe compared `globalThis.AbortSignal` with
`global.AbortSignal` inside the jsdom environment, found them identical, and briefly concluded jsdom
was not shadowing anything. That comparison proves nothing: inside the jsdom environment `global`
and `globalThis` are the same jsdom window, so the test compared jsdom's class with itself. The
question is whether it matches undici's class, and only building a `Request` answers it.

**Why CI and never locally.** The fork gate takes its Node from `.nvmrc`
(`.github/workflows/ci.yml:116`, `node-version-file: .nvmrc`). Commit `a22299f` changed `.nvmrc`
from `20.18.1` to `24.19.0`. Every local run in this programme was on Node 20.20.1. See MK-029: the
version split is the finding, this is only its first casualty.

**Rate.** Not a flake. Four fork gate runs on `main` since that commit, four identical failures:
runs `32633970784`, `32640501671`, `32648091286`, `32703530387`. Reproduced locally on Node 24 at
the same pinned block, byte identical error. Zero failures on Node 20 and Node 22.

**Blast radius.** No SDK source is wrong. A browser pairs its own `AbortSignal` with its own
`fetch`, and a Node process pairs Node's with Node's; only the mixed pair a DOM test environment
creates is broken. The cost was real anyway: the react hooks were unverified on every merge since
`a22299f`, and the fork cache was never saved once, because the `actions/cache` post step is skipped
when the job fails, so every run re-warmed from cold at 85 to 122 seconds.

**Fix.** `packages/react/test/harness/jsdom-node-abort.ts`, a custom vitest environment that runs
the built in jsdom environment and then puts Node's `AbortController` and `AbortSignal` back. It
captures them at module load, which is before vitest populates the jsdom globals; reading them
inside `setup` would read jsdom's and restore nothing. Wired through `environmentMatchGlobs` in
`vitest.workspace.mts` for BOTH projects.

**Pinned by** `packages/react/test/abort-signal.test.ts`, chain free and in the `unit` project, so
it runs on all three matrix Nodes in the fast `Checks` jobs rather than only on the one Node the
fork gate pins. Verified by mutation: pointing the glob back at plain `jsdom` makes it fail on Node
24 with the exact error above and pass on Node 20 and 22.

**Note for anyone adding a DOM test.** The `@vitest-environment` docblock cannot name this
environment. Vitest 2 parses it with `/@(?:vitest|jest)-environment\s+([\w-]+)\b/`
(`vitest/dist/chunks/resolveConfig.RxKrDli4.js:6558`), which cannot express a path, and a path
written there is silently ignored: the file runs on the project default and nothing warns. Use
`environmentMatchGlobs`.

---

## MK-029 · Local evidence and CI evidence were both true, because they ran different runtimes

**Class** S2, process · **Status** fixed · **Found by us when asked to look at a CI run for the
first time**

**What it actually was, in one sentence.** Every wave's local acceptance and every CI run were both
reporting honestly, and they never contradicted each other, because they were never running the
same thing: the fork gate resolved its Node from `.nvmrc` while every local run used the Node the
author happened to have. Five merges landed on a red trunk and nobody noticed, not because anyone
overlooked a red X, but because nothing in the process ever put the two sources of evidence in the
same room.

That is the part worth carrying forward. A green local run was not a false claim. It was a true
claim about a different system, presented as though it settled the question, and no rule required
anyone to check whether it did.

**What happens.** Two separate things that combine into one hole.

1. **Nobody read CI.** The `CI` workflow on `main` has been red on every merge since
   `2026-08-23T10:31`. Measured from the run list, oldest first:

   | Run | Merge | Failing job | Cause |
   |---|---|---|---|
   | `32628458775` | PR 1 | none, green | the last green run on `main` |
   | `32633970784` | PR 5 | Fork gate + coverage | MK-028 |
   | `32640501671` | PR 4 | Fork gate + coverage | MK-028 |
   | `32648091286` | PR 6 | Fork gate + coverage | MK-028 |
   | `32657938617` | PR 7 | Checks, all three Nodes | MK-027, the broken example |
   | `32703530387` | PR 8 | Fork gate + coverage | MK-028 |

   Five consecutive red merges. Every wave reported acceptance as met on local evidence, and the
   PR 8 report even said in as many words that CI had not been checked. Saying so is not the same
   as looking.

2. **The fork gate ran a Node that no local run used.** That job read
   `node-version-file: .nvmrc`, and commit `a22299f`, a housekeeping change about the DEVELOPMENT
   runtime, moved `.nvmrc` from `20.18.1` to `24.19.0`. Every local acceptance run in this
   programme was on Node 20.20.1. So five green local runs and four red CI runs were true at the
   same time and never in contradiction. Neither number was wrong. The pair was meaningless,
   because a change to what a contributor develops on had quietly become a change to what CI
   executes.

**Why this is a finding and not a footnote.** The standing checklist added in
`docs/08-conventions.md` §10 lists seven commands and does not list "read the CI run". It was
written the day before this, specifically to stop a wave being called done on partial evidence, and
it would not have caught any of the five. A checklist whose green means less than a reader assumes
is exactly the failure MK-006 taught, one level up.

**Consequence beyond the tests, now fixed.** Because the fork gate never reached its post step,
the `actions/cache` save was skipped on all four runs, so `anvil-fork-31611-15043414` was never
written once and every run paid a cold warm up of 85 to 122 seconds. That is self perpetuating: red
job, no save, cold next run. `actions/cache` is now split into an `actions/cache/restore@v4` step
before the tests and an `actions/cache/save@v4` step guarded by
`if: always() && steps.anvil-fork-cache.outputs.cache-hit != 'true'` after them, so a failed run
still keeps the state it fetched. `continue-on-error: true` on the save, because a cache problem
must never be the reason a green run reports red.

**Fixed, in three parts, one per cause.**

1. **The coupling is gone.** No job in any workflow reads `node-version-file` any more. All three
   that did (`ci.yml` `fork-gate`, `release.yml` `publish` and `verify-published`) declare
   `node-version: 24.19.0` explicitly, with the reason in a comment beside each. The other two jobs
   already declared their own and were checked, not assumed. The rule is stated in
   `docs/08-conventions.md` §1: **CI runtime versions are declared in the workflow, never inherited
   from the development pin.** `.nvmrc` still says 24.19.0, so nothing about CI moved; what changed
   is that the next edit to `.nvmrc` cannot move it either.

2. **The two evidence sources are required to meet.** `docs/08-conventions.md` §10 gains two rules
   rather than two suggestions. Step 2 now requires the fork suite to be run locally on the Node
   version the fork gate DECLARES, and to report that version. Step 9 requires the CI run on `main`
   to be read after a merge, and makes a red trunk block the next wave. Those two are exactly the
   absences that produced this finding: without the first, local and CI cannot be compared; without
   the second, five red merges accumulate unremarked.

3. **The failure surfaces sooner.** MK-028's pin runs in the `unit` project across the whole
   `Checks` matrix, so a Node that breaks the react environment fails in a job of about 80 seconds
   rather than only in the fork gate.

**Deliberately NOT done, and why it is not "still open" here.** Whether the fork gate should be
matrixed across 20, 22 and 24 rather than run on one declared version is a real question, and it is
recorded in `docs/07-testing.md` §5 next to the falsified claim that motivated it. It is not part of
this finding: MK-029 is about a silent coupling and an unenforced comparison, and both are closed.
Matrixing is a scope decision about cost, and a decision that is not blocked on anything here.
Separately, the note on GitHub's Node 20 ACTION runtime deprecation in the same section is a
different subject entirely, about the runtime GitHub uses to execute a JavaScript action, and must
not be conflated with either.

---

## MK-030 · `zz-findings` MK-003 refinance fee assertion fails intermittently on a plain fork run

**Class** S3, harness · **Status** open · **Found by us in the P4 wave, taking the baseline before
touching anything**

**Why it exists at all.** This wave's scope is MK-007 through MK-013, and the flake family belongs
to the next one. It is registered anyway because the standing rule in `docs/08-conventions.md` §10
is that every failure is attributed to an ID before it is called a flake, and this one matched none
of MK-021 through MK-026. An unattributed red run is indistinguishable from a regression the next
time it appears.

**What happens.** `packages/core/test/zz-findings.fork.test.ts`, the case
"MK-003 (fixed): previewRefinance reports the fee the contract actually charges", fails. Run 3 of
ten `pnpm test:fork` runs on Node 24.19.0 at pinned block 15043414, on `main` at `af04519`, before
any change in this wave.

**Why it is NOT one of the existing entries.** MK-022, MK-023 and MK-024 are all inside
`phase6.fork.test.ts`. MK-025 is `@musd-kit/react`. MK-026 is `phase5.fork.test.ts`, and although it
is the closest in character, it is a different file and a different assertion. MK-021 is a warm up
budget on a cold fork and the warm up succeeded.

**What we do NOT have, stated rather than glossed.** The assertion text. That run's output was
filtered to the summary lines while capturing a ten run baseline, and the failure did not recur in
the five subsequent runs whose full output WAS captured. So this entry records that the case failed
once in ten and nothing about why. Capturing the assertion is the first task when it is diagnosed;
running the file alone will not reproduce the conditions, because the alphabetical sequencer puts
`zz-findings` last, after every clock warp the earlier phases perform.

**Observed rate.** 1 in 10 on the P4 baseline. The other two reds in that window were MK-022 (run 2)
and MK-026 (run 7), leaving 7 green.

**Decision.** Not diagnosed here, and not fixed. It joins MK-016 and MK-022 through MK-026 for the
mitigation removal wave. Capture the assertion with full output before anything else.

---

## MK-031 · Fork failures destroy their own cause

**Class** S3, harness · **Status** fixed · **Found by us reading the CI run that reddened `main`
after PR 10, and previously written down as a complaint inside MK-024 without being acted on**

**What happens.** Three separate call sites turned a diagnosable failure into an undiagnosable one.

| Site | What it threw | What it destroyed |
|---|---|---|
| `phase6.fork.test.ts` `redemptionEv` | `TypeError: Cannot read properties of undefined (reading 'args')` | Whether the redeem reverted, redeemed nothing, or emitted something else |
| `phase6.fork.test.ts` liquidation event lookup | the same `TypeError` | the same, for a liquidation. This is the exact line MK-024 asked to be fixed |
| `hooks.fork.test.ts` `ensureWriteMined` | `Error: mutation errored without a tx hash` | The mutation's OWN typed error, which the hook already exposed |

The third is the sharpest. Four attempts each discarding a `RedemptionFailed` read identically to
four attempts each discarding an `InsufficientMusdBalance`, and those mean opposite things: one is
the fork's state, the other is the test's own setup being wrong.

**Why it is its own finding rather than a line in each flake entry.** Because it is what makes the
flake entries expensive. MK-024 already said "the test should be made to fail with the on-chain
reason rather than a property access on `undefined`; until it does, every occurrence of this costs a
diagnosis from scratch". It then cost exactly that, twice more.

**Fix.** `packages/core/test/harness/explainReceipt.ts`. When an expected event is absent, the
thrown error carries the receipt status, the block and gas used, every log that WAS emitted with its
emitter and topic, the revert reason recovered by replaying the call at the mined block, and the
fork conditions the suite's own findings keep pointing at: head block, block timestamp, `fetchPrice()`,
Recovery Mode and `MEZO_FORK_BLOCK`.

It does not retry, does not soften an assertion, and does not change what passes. The failing test
still fails; it just says why.

**Also added, and worth as much:** the two redemption tests now log the redeemable margin BEFORE
every redeem, passing or failing. A rate cannot be attributed from failures alone, and it was that
logging which established that the redeemable tail is NOT the variable, see MK-034.

**Pinned by** `packages/core/test/harness-explain.fork.test.ts`, two cases: a mined transaction with
no such event, and a transaction that reverts, where the assertion is on the recovered REASON
(`Trove does not exist or is closed`) rather than on the status alone. A diagnostic that silently
stops reporting is worse than none, because the next failure then looks like it had nothing to say.

---

## MK-032 · The flake mitigations document a mechanism the harness makes impossible

**Class** S3, harness · **Status** fixed as documentation, the mitigations deliberately left in
place · **Found by us in the P5a wave, checking a comment instead of believing it**

**The claim, repeated in four places.** `redeemFresh` in `phase6.fork.test.ts`,
`ensureWriteMined` in `hooks.fork.test.ts`, the +50% price manoeuvre in both files, and
`refreshOracle` in `harness/oracle.ts` all say the same thing: `getRedemptionHints` is slow, the
latency lets the seeded oracle go stale before the write mines, `PriceFeed` then reads a stale or
lower price, and the marginal Trove falls under MCR.

**It cannot happen.** `packages/core/test/harness/OracleShim.sol:24-29` returns `timestamp()` for
BOTH `startedAt` and `updatedAt`, so the shim reports itself fresh at every block and no freshness
guard can trip. The shim's own header says so in as many words. `ORACLE_SLOT.startedAt` and
`.updatedAt` are slots 3 and 4 (`harness/constants.ts:71-72`) and `latestRoundData` reads only slots
0, 1, 2 and 5, so the two writes `refreshOracle` performs land in **dead storage**.

Verified on the fork rather than argued: warping 30 days forward with NO call to `refreshOracle`
leaves `fetchPrice()` returning `77051107320000000000000`, unchanged, throwing nothing.

**So `refreshOracle` has exactly one real effect: it mines a block.** That is not nothing, a fresh
block advances the timestamp every subsequent `eth_call` is evaluated at, but it is a different
thing from what its name and every caller's comment claim.

**And interest drift is not the mechanism either**, at least not where it was measured. The first
redemption hint sits at ICR `1118410742529159124` against an MCR of `1.1e18`, a margin of
`1.84e16`. Thirty seconds of accrued interest moves it by `1.06e10` wei, about one fifty thousandth
of that margin. Crossing MCR by interest drift alone would take on the order of fifteen hours.

**What this changes.** Every past diagnosis of this family started from a mechanism that is false,
which is worse than starting from none. The comments are corrected in place, and each says what was
wrong rather than being quietly rewritten.

**What is deliberately NOT done.** The mitigations stay. Removing them is the mitigation removal
wave (MK-016), and pulling one out while its siblings remain would make the next failure harder to
attribute, not easier. What changed is that they no longer claim to know why they are there.

---

## MK-033 · A passing test logs an uncaught React error into the CI output

**Class** S3, harness · **Status** fixed · **Found by us reading the CI run that reddened `main`**

**What happens.** `packages/react/test/hooks.fork.test.ts` renders `useOraclePrice` with no
provider and asserts that it throws. It does throw, and the test passes. React's development build
then prints an uncaught-error block for the render throw, `WagmiProviderNotFoundError` with a full
component stack and "Consider adding an error boundary", straight into the CI log.

**It is NOT an SDK defect, and that was checked rather than assumed.** `useOraclePrice` reaches
wagmi through `useMusdQuery` (`packages/react/src/internal/useMusdQuery.ts`) and `useChainId`, which
is how EVERY hook in the package reaches it. A consumer rendering any of them outside a
`WagmiProvider` gets the same throw, and that is correct, desirable, and exactly what this test
exists to pin. The hook is being used deliberately incorrectly by a negative test.

**The defect is the signal.** In a run that is already red for other reasons, an uncaught
`WagmiProviderNotFoundError` in the log is indistinguishable from a real one. That is the condition
`docs/08-conventions.md` §10 forbids in as many words: a green signal that does not mean what a
reader assumes.

**Fix.** The render's `console.error` output is CAPTURED rather than silenced, and then asserted to
contain the expected provider error. If React stops logging, or logs something else, the test fails
instead of hiding a genuine uncaught error. The throw itself is now asserted against
`WagmiProviderNotFoundError` rather than `toThrow()` with no argument, so the test pins which error
it means.

---

## MK-034 · Two different redemption failures, wrongly folded into one entry

**Class** S3, harness · **Status** open, not fixed in this wave · **Found by us in the P5a wave**

**What happened.** Run
[32962767819](https://github.com/cayvox/musd-kit/actions/runs/32962767819) on `main` at `e7f77f4`,
fork gate, two failures in one run, both on the redemption path:

- `phase6.fork.test.ts:175` (the no-loan redeemer), `TypeError: Cannot read properties of undefined
  (reading 'args')` from `redemptionEv` at `:138`. The redeem mined without emitting `Redemption`.
- `hooks.fork.test.ts:261` (`useRedeem`), `Error: mutation errored without a tx hash` from
  `ensureWriteMined` at `:92` after four attempts.

**It is NOT a regression from PR 10, and that was the first question asked.** Eight
`pnpm test:coverage` runs at the merge commit `e7f77f4` and eight at its first parent `af04519`,
Node 24.19.0, pinned block 15043414:

| Commit | Green | Red | Which |
|---|---|---|---|
| `af04519`, the parent | 7 | 1 | MK-023, the phase 6 claim fixture |
| `e7f77f4`, the merge | 6 | 2 | one phase 6 RM liquidation, one MK-026 |

The parent is **not clean over the window**, so the condition for calling this a regression is not
met. Neither arm reproduced the CI pair. A further twelve runs at the branch produced ten green and
two red, again neither of them the CI pair. Twenty runs at or after the merge commit, zero
reproductions.

**Why it is not MK-024, MK-025 or MK-023, decided rather than assumed.** MK-024 is the normal mode
LIQUIDATION crash at `:198`: it shares the failure MODE, a crash on a missing event, and that mode is
now fixed for both by MK-031, but it is a different test and a different operation. MK-025 is the
react block WATCHING test at `hooks:157`, a write that mined and reverted; this is `useRedeem` at
`:261`, erroring before any send. MK-023 is the phase 6 CLAIM fixture at `:400` asserting status 4.
Different tests, different operations, different failure modes.

**Why the two were made ONE entry, and why that was wrong.** The P5a wave put them together on
co-occurrence: they fired in a single run, both are redemption, and a later run reproduced the
pairing in different tests. That reasoning was reasonable and the conclusion was not.

**Corrected, P5b wave, on evidence the retry removal finally exposed.** With no retry in the way the
first failure is the one you read, and the two failures read completely differently:

| | What it actually is |
|---|---|
| phase 6 no-loan redemption | `status: reverted`, `gasUsed: 710023`, `logs emitted: 0`, and **the replay at the mined block did NOT revert**. A `require` reproduces on replay; this did not. That is a gas or state dependence, not a protocol rule |
| `zz-findings` MK-014 | `RedemptionFailed` raised at SIMULATE time, `TroveManager: Unable to redeem any amount`, so **it never sent a transaction at all** |

One is a mined transaction that failed for a non-`require` reason. The other never left the client.
They are not the same failure and folding them cost a wave of treating them as one.

**The mined half now has a candidate cause, and it is not a flake.** See MK-035: the same signature,
a revert with no logs whose replay does not revert, appeared in CI on the react `useRedeem` write,
and it points at the gas estimate being a block stale rather than at anything in the test. That
diagnosis reaches `packages/core/src`, so it was reported rather than fixed.

**Also ruled out, with numbers.** The razor-thin-margin explanation carried in these tests is wrong.
`reportRedemptionMargin` now logs the first redemption hint's ICR before every redemption, on
passing runs too, and over ten runs the margin above MCR was 0.46e18 to 1.31e18, not a hair. The
only genuinely thin site is the claim fixture at 1.016e15, and that value is byte identical across
all ten runs, so it is not the variable either.

**What was ruled OUT, with numbers.** The redeemable tail is not exhausted and is not the variable.
Both redemption sites now log the margin before every attempt, and across all twelve runs it was
byte identical and ample every time: phase 6 no-loan requested `5000e18` with `5000e18` redeemable,
hooks requested `3000e18` with `3000e18` redeemable and a holder balance of
`5346042498991720800205`. Oracle staleness is impossible, see MK-032. Interest drift on the marginal
hint is four orders of magnitude too small, also MK-032.

**What we do NOT claim.** A root cause. Two stated mechanisms are now disproven and no third is
established, which is progress of a kind but is not a fix.

**Cost of carrying it.** The fork gate is intermittent at roughly two runs in twelve locally under
coverage, across a family of tests, of which this pair is one member. That is a `main` that goes red
without a regression, roughly one merge in six, and under the standing rule each of those blocks the
next wave until someone reads the run. The mitigations make the rate look better than the underlying
stability is, which is MK-016's point.

**Decision.** Diagnose in the mitigation removal wave with MK-016 and MK-021 through MK-030. It is
now much cheaper to diagnose than it was: MK-031 means the next occurrence arrives with the receipt
status, the revert reason, the emitted logs and the fork conditions attached, instead of a
`TypeError`.

---

## MK-035 · A write ships a gas margin thinner than its own work varies

**Class** S2 · **Status** open, NOT fixed, and the reason it is not fixed is that the diagnosis
reaches `packages/core/src` · **Found by us in the P5b wave, from the CI run on that branch**

**Why this entry stops the wave rather than joining the flake family.** P5b's scope was the flake
family with an explicit rule: if a diagnosis leads into `packages/*/src`, stop and report, because
that would mean a flake was a real defect. It did, so this is reported and not fixed.

**What was observed.** CI run
[32983444134](https://github.com/cayvox/musd-kit/actions/runs/32983444134), `useRedeem` in
`packages/react/test/hooks.fork.test.ts:307`. With the retry removed this wave, the first failure is
the one you read, and it reads:

```
status: reverted
block: 15043754  gasUsed: 582036
logs emitted: 0
revert reason: the replay did NOT revert, so the failure was state or gas dependent
               rather than a require
```

Two facts make that unusual. **The replay at the mined block did not revert**, and a `require`
failure always reproduces on replay. And `gasUsed` of `582036` sits just BELOW the `582707` and
`588307` that successful `useRedeem` writes recorded in the same wave's mitigation log, rather than
far below as a `require` revert would.

**Three different tests, one signature, and it is NOT redemption specific.** All three are
`status: reverted`, zero logs, and a replay at the mined block that does not revert:

| Where | Operation | gasUsed |
|---|---|---|
| `hooks.fork.test.ts:307` `useRedeem` (CI) | `redeemCollateral` | 582036 |
| `phase6.fork.test.ts:174` no-loan redemption | `redeemCollateral` | 710023 |
| `phase6.fork.test.ts:258` normal-mode liquidation | `liquidate` | 455529 |

The third is what widens this from a redemption problem to a write path problem. `liquidate` and
`redeemCollateral` share only one thing: both go through `simulateAndSend`, and both traverse
`SortedTroves` by an amount that depends on state at mine time.

**The mechanism, and it is already written down in this repository.** `openTroveRaw`
(`packages/core/test/harness/openTroveRaw.ts:96-101`) carries a comment describing exactly this:

> The estimate is taken one block before the tx mines; one block of accrued interest shifts the
> SortedTroves insert traversal, so on a loaded CI runner the real insert can need more gas than
> estimated and the tx reverts out-of-gas (re-simulating with a high cap then "passes", the
> tell-tale of OOG, not a logic revert).

"Re-simulating with a high cap then passes" is precisely what the explainer reports as "the replay
did NOT revert". That comment was written about `openTrove` and the fix applied there was a fixed
6,000,000 gas cap, in the TEST HARNESS. Nothing equivalent protects any other write, and
`redeemCollateral` walks `SortedTroves` the same way.

**Why it is an SDK question and not a test one.** `simulateAndSend`
(`packages/core/src/internal/write.ts`) simulates and then sends viem's `request`, which carries the
gas estimate from that simulation. Every SDK write goes through it. If that estimate can be too
tight for a traversal whose cost depends on state that moves between estimate and mine, then a real
consumer redeeming on a busy chain hits the same revert, with gas spent and nothing to show. The
harness is not what makes this happen; it is only where it was noticed, because the harness is the
only place that re-simulates afterwards and looks.

## Fixed, P7 wave

**The measurement that sized the fix.** Every write path the SDK exposes, 12 attempts each from a
byte identical `evm_snapshot` so nothing but the block timestamp differed:

> **Provenance: UNESTABLISHED.** The script that produced this table was never committed, so no one
> can re-run it (MK-039, and the rule is now step 10 of the wave checklist in
> `docs/08-conventions.md`). The committed successor,
> `packages/core/test/gas-variance.fork.test.ts`, measures `redeemCollateral` only, not all nine
> paths. The table is kept rather than deleted because it is what the default was derived from and a
> reader has to be able to see that; it is not evidence anyone can check.

| Path | gas used, min to max | spread | margin viem's estimate left |
|---|---|---|---|
| `openTrove` | 605419 to 605419 | 0% | 1.51% |
| `addCollateral` | 331872 to 365602 | **10.16%** | 5.35 to 5.73% |
| `withdrawCollateral` | 342631 to 376361 | **9.84%** | 5.93 to 6.36% |
| `borrow` | 355043 to 383343 | 7.97% | 5.17 to 5.46% |
| `refinance` | 358701 to 387001 | 7.88% | 5.14 to 5.42% |
| `adjustTrove` | 369112 to 397412 | 7.66% | 5.04 to 5.31% |
| `repay` | 334293 to 345493 | 3.35% | 5.7 to 11.42% |
| `liquidate` | 407850 to 419050 | 2.74% | 9.26 to 13.88% |
| `redeem` | 610270 to 610270 | 0% | 18.14% |
| `claim` | not measured | | no transaction is sent without a surplus |

**Two things this settles, and one it corrects.** The variance is NOT confined to the traversal
paths where it was found: `addCollateral` and `withdrawCollateral` have the widest spreads of all
nine, wider than `redeem` or `liquidate`. And in **five of the nine**, the spread exceeds the margin
viem's own estimate happened to leave. What it corrects is the shape of the fix: a per path
multiplier keyed to "the sorted list paths" would have missed the two worst.

The 0% rows are the window being small, not the path being safe. `redeem` showed 0% across these 12
and 16.4% across the 40 that produced the traced failure. **The spread here is a lower bound.**

That last sentence has since been undercut by its own successor. The committed lab, run at three
redemption sizes, produced gas figures **identical to the unit** within every fixture, including
across five hours of warped clock (MK-039). From byte identical state at a given timestamp the EVM
cannot produce a spread, so the 0% rows are what the description predicts and the seven non zero
rows are what it does not. Something was varying that "nothing but the block timestamp differed"
does not account for, and with the instrument gone there is no way to find out what.

**The default: 25%, and it is not a round number chosen because buffers are round.** It is roughly
1.5 times the worst growth ever traced (16.4%) and 2.5 times the worst typical spread (10.16%).

> **Provenance of the derivation, one leg each.** The 16.4% is **observed once, unlinked**: a real
> transaction that really reverted, traced to `ActivePool` out of gas at call depth 4, whose log was
> not preserved. The 10.16% is **unestablished**, resting on the table above. **The default is not
> being softened.** One leg standing is enough to justify a margin, and 25 clears the traced growth
> by half again on that leg alone. What changes is that the record now says which leg is which.
`DEFAULT_GAS_MARGIN_PERCENT` carries that derivation, and `createMusdClient({ gasMarginPercent })`
overrides it. `0` restores the old behavior.

**What it costs the caller, established on the fork rather than assumed:**

- **No fees.** Unused gas is refunded exactly: a send with a 5000000 limit that used 351910 was
  charged `gasUsed * effectiveGasPrice` to the wei.
- **A higher balance requirement**, which is the real cost. The account must hold
  `gasLimit * gasPrice + value` up front or the send is rejected before reaching the chain, verified
  by funding an account to half the limit and watching it refuse: "The total cost (gas * gas fee +
  value) of executing this transaction exceeds the balance of the account."
- **A larger number on the wallet's confirmation screen**, which is the maximum, not the charge.
- **No added latency.** `simulateContract`'s request carries no `gas` field, verified, so viem was
  already estimating internally; doing it here and multiplying is the same count of
  `eth_estimateGas` calls.

**The result, same lab and same attempt count as the diagnosis.**

| | Mined reverts | Simulate failures |
|---|---|---|
| before, 40 attempts | **2** | 0 |
| after, 40 + 40 attempts | **0** | 2 |

The two simulate failures never send, so no gas is spent and the caller gets a typed error, which is
the SDK working. They are `ContractCallFailed` and are **unexplained**: they appeared in the first
run of 40 and not in the second, and the run that had them did not capture the message.

**It does not close the window, and the docs now say so.** The estimate is still taken before the
block the transaction mines in.

**For the case that remains, `diagnoseRevertedWrite`** classifies a mined revert from evidence a
consumer has without a tracing endpoint: `OUT_OF_GAS` when `gasUsed === gasLimit`, `REVERTED` with
the reason when re-executing at the mined block still reverts, and **`INDETERMINATE`** otherwise.
The third is the honest boundary rather than a hedge: a nested exhaustion leaves gas at the top
level, and `eth_call` at a block number runs against end of block state, so those two cases are not
separable without `debug_traceTransaction`, which most public endpoints do not expose. The advice
string says exactly that.

---

## Diagnosed, P6 wave, with a trace

**It IS out of gas, in a NESTED call, which is why the receipt says otherwise.** Reproduced in
isolation and traced. The failing path inside `redeemCollateral`:

```
0xe47c80e8...  TroveManager        0x3db23605 redeemCollateral -> execution reverted
  0x9aab5679...  TroveManager impl  0x3db23605                 -> execution reverted
    0x143a063f...  ActivePool       0x62502169                 -> execution reverted
      0xbfc82017...  ActivePool impl 0x62502169                -> OUT OF GAS
```

`0x143A063F...` is `ActivePool`, confirmed by reading `TroveManager.activePool()` on the fork
rather than by guessing. The two upper frames are proxies delegating to implementations.

**Why the receipt cannot show it.** The EVM forwards at most 63/64 of the remaining gas to a
nested call. The inner frame exhausted its allowance while the outer frame still held the last
1/64, so the receipt reported `gasUsed: 710023` against `gasLimit: 720980` and looked like an
ordinary revert with no reason. **That is what made the P5b wave rule out of gas OUT**, and that
conclusion was wrong: `gasUsed === gasLimit` only ever detects exhaustion at the TOP level.

**The measurement.** 40 attempts of the same `redeemCollateral` call, each from a byte identical
`evm_snapshot`, so nothing but timing differs between them:

| | |
|---|---|
| successes | 38 |
| mined reverts | **2**, both `ActivePool` out of gas at depth 4 |
| gas used, successful | 610270 |
| gas used, failing | 710023 |
| **work swing for the identical call** | **16%** |
| gas limit sent | 720980, fixed |
| **margin the SDK ships** | **1.5%** over actual, measured separately on `openTrove` |

The work varies by ten times the margin. That is the finding in one line.

**Where the variance comes from.** The block timestamp differs between attempts because anvil
stamps blocks with wall clock, so interest accrual differs, so the redemption's traversal and
partial arithmetic differ. The harness makes this easy to hit; it does not create it. On any chain
the estimate is taken before the block the transaction mines in.

> **Provenance: the trace is UNESTABLISHED as a rate and OBSERVED ONCE as a growth.** Read the two
> apart. That one `redeemCollateral` grew to 710023 and reverted with `ActivePool` out of gas at
> call depth 4 is an observation of a real transaction; its log was not preserved, so it is
> **observed once, unlinked**. That 2 of 40 attempts did so is a claim about a population, it needed
> an instrument, the instrument was never committed, and the rebuilt one produces no variance at all
> across 52 executions (MK-039). **The growth still justifies the margin. The rate is not evidence.**

**The isolation rate against the suite rate.** 2 in 40 operations in isolation, roughly 5%. In the
full suite the same class of failure appeared in roughly 1 run in 5, and a run performs about six
redemptions, so the per-operation rates are the same order. The failure reproduces OUTSIDE the full
suite, which rules out accumulated suite state as a necessary condition.

**On the zero logs question, which the P6 prompt asked to be checked rather than assumed.** It is a
property of reverting, not a clue about where. The trace shows sub-calls at depths 2 through 7
completing successfully, including a call to the MUSD token returning `0x...01`, before the
top-level revert. Any logs those emitted were discarded with the state. Zero logs on a reverted
receipt carries no information about the failure point.

### Verdict: an SDK defect, and a documentation one

Not a test defect: the SDK chooses the gas limit. Not a harness artifact a consumer cannot hit: a
consumer calling `musd.redeem()` while interest accrues between estimate and mine gets the same
reverted transaction, with gas spent and no reason to show.

**And it makes a documented guarantee weaker than it reads.** `internal/write.ts` said simulating
means "never a silent reverted receipt". That is exactly what MK-035 produces. Corrected in place,
in the docstring and in `docs/03-core-api.md`, both saying what simulate does and does not cover.

**Pinned by** `zz-findings.fork.test.ts`, "MK-035 (open): a write ships a gas margin thinner than
its own work varies". It deliberately does NOT assert the revert, because a 5% event is not
something to assert on; it asserts the cause, which is deterministic, and flips when the SDK sizes
the limit for a moving target.

**Fix is its own wave**, per the classification rule: changing gas handling in `simulateAndSend`
affects every write path in the SDK and needs its own acceptance.

---

### The superseded hypotheses, kept because the corrections are the record

**IT IS NOT OUT OF GAS, and this entry's own first hypothesis is the thing that got falsified.**
The `gasLimit` field was added to the explainer precisely so the next occurrence would settle it
without anyone reasoning. It fired on the very next CI run
([32985118789](https://github.com/cayvox/musd-kit/actions/runs/32985118789)) and said:

```
status: reverted
block: 15043607  gasUsed: 710023  gasLimit: 720980
logs emitted: 0
```

`710023` against a limit of `720980`. The transaction had **10957 gas left** and reverted anyway.
Out of gas requires `gasUsed === gasLimit`. So the mechanism borrowed from `openTroveRaw`'s comment,
which is what this entry was originally built on, does NOT explain it.

**And the replay evidence is weaker than it was first written.** `eth_call` at a block number
executes against the state at the END of that block, which is AFTER the failing transaction and
everything else in it. So "the replay did not revert" rules out a condition still true at end of
block; it does NOT rule out a `require` that was true mid block. The explainer's own wording is
corrected to say so, because a diagnostic that overstates its evidence is worse than one that says
less.

**What is actually established, after both corrections.** The transaction reverted, emitted nothing,
was not out of gas, and did not reproduce at end of block state. Three different tests across two
operations show it. That is a real and narrow fact, and it is not a cause.

**What it costs to carry.** MK-034's two halves and this entry are plausibly one thing. Until it is
settled, every redemption failure in this suite has two candidate explanations, and a consumer
facing it has none, because nothing in the SDK's error surface distinguishes an out of gas revert
from a protocol one.

**Decision.** Report, do not fix. A change to `simulateAndSend`'s gas handling is an SDK behavior
change affecting every write path, and it needs its own wave with its own acceptance rather than
being slipped into a harness cleanup.

---

## MK-036 · The checklist's CI step was executed before the run existed

**Class** S3, process · **Status** fixed · **Found by us in the P8 wave, checking a claim we had
made twice**

**What happened.** `docs/08-conventions.md` §10 step 9 says to read the CI run on `main` after a
merge, and treats a red trunk as blocking. The P6 and P7 reports both executed it, found no run at
the tip, and reported "current `main` has no CI run" as a finding about merges not triggering CI.

**Both reports were wrong.** Every merge commit on `main` does have a run:

| Commit | Run | Result |
|---|---|---|
| `bed0dda` | 32967009339 | success |
| `6596640` | 32987085286 | success |
| `3aca53b` | 32990919057 | **failure** |
| `03d5aae` | 33004697927 | success |

The run for `3aca53b` was created at `16:52:44Z`, within seconds of the merge. The check simply ran
before it appeared in the listing. Nothing is wrong with the workflow triggers.

**What it cost, which is the reason this is a finding rather than a note.** `3aca53b` was RED, with
MK-035's nested out of gas signature, and two consecutive reports said it had no run instead of
saying the trunk was red. The standing rule is that a red trunk blocks the next wave. It did not
block anything, because the check reported the wrong thing and nobody went back to look.

**The defect is in the rule's wording, not in anyone's diligence.** "Read the CI run" has no answer
for "there is no run yet", and the natural reading of an empty listing is that no run is coming. A
check whose failure mode is indistinguishable from its not-yet mode is not a check.

**Fix.** §10 step 9 now says to WAIT for the run to exist, and that an absent run means not yet
rather than never: it is only a finding if it persists. It also names the command with the commit
pinned, so the answer cannot come from an ancestor.

---

---

## MK-037 · The gas margin is silently dropped, because the estimate caps itself

**Class** S2 · **Status** fixed · **Found by us in the P9 wave, by the warning added in the same
wave**

**What happens.** `simulateAndSend` estimates gas and multiplies by
`DEFAULT_GAS_MARGIN_PERCENT` (MK-035). When that estimate throws, it falls back to sending with no
explicit gas, which is the pre-MK-035 behavior, which is the behavior that produced the reverts.

It throws more often than anyone knew. From one CI run, with the warning that made it visible:

```
gas estimation failed for openTrove, sending without a margin (MK-035).
  ContractFunctionExecutionError: The total cost (gas * gas fee + value) of executing
  this transaction exceeds the balance of the account.
gas estimation failed for refinance ... Transaction creation failed.
gas estimation failed for withdrawMUSD ... Transaction creation failed.
```

**The mechanism. Established, and it is not what this entry first said.**

This entry originally recorded the cause as a balance check: `eth_estimateGas` comparing the
sender's balance against `gas * gasPrice + value` with the node assuming a large `gas`. **That was a
hypothesis and it is wrong.** It was tested directly, by funding an account both below and above the
computed `blockGasLimit * maxFeePerGas + value` threshold and probing each side: both sides reported
`estimateOk=true` and `writeOk=true`. The hypothesis is not merely unproven, it is refuted.

> **Provenance: OBSERVED ONCE, linked.** The margin=1.5% line appears in three CI runs on the P9
> branch, recovered from the logs rather than recalled:
> [33041778521](https://github.com/cayvox/musd-kit/actions/runs/33041778521),
> [33042756192](https://github.com/cayvox/musd-kit/actions/runs/33042756192) and
> [33043038071](https://github.com/cayvox/musd-kit/actions/runs/33043038071), all three reading
> `[MK-035] sentGasLimit=614550 gasUsed=605407 margin=1.5%`. This entry cited the number for a wave
> with no way to reach it; the links were added by the provenance audit.

The second hypothesis, that the CI failures were all balance errors, is also wrong. Correlating the
CI log line by line, the warning immediately preceding `[MK-035] margin=1.5%` was
`The contract function "openTrove" reverted.`, not a balance error. The balance errors in that log
came from the differential harness's extreme band, which generates collateral up to 5000 BTC against
a funded balance far below it, and are expected there.

The actual cause was found by diffing the raw JSON-RPC payloads of our estimate against the one viem
sends internally during `writeContract`:

```
ours    {"data":"0x2f3a6d98...","gas":"0xa1c58","nonce":"0x0","to":"0xCdF7028c...",...}
viem's  {"data":"0x2f3a6d98...","to":"0xCdF7028c...",...}            no gas, no nonce
```

`simulateAndSend` passed the `Account` OBJECT to `estimateContractGas`. viem responds to an account
object by running `prepareTransactionRequest` first, which fills in a nonce and a gas figure, and
then sends `eth_estimateGas` **with that gas field set**. A node treats a supplied gas field as the
upper bound of its search, so the estimate fails as soon as the real work exceeds a cap the estimate
itself invented. `writeContract`, which sends no gas field, is uncapped and succeeds. Measured both
ways against the same call:

```
Account object: estimateGasRequests=2  gasFieldSent="0xa1c58"  nonceSent="0x0"  result=662616
address only:   estimateGasRequests=1  gasFieldSent=undefined  nonceSent=undefined  result=662616
```

Identical answer, one fewer round trip, and no self imposed cap. **This is MK-035's own mechanism, a
gas limit set too low from a stale estimate, reappearing one level up inside the fix for MK-035.**

> **Provenance of the figures above: OBSERVED ONCE, UNLINKED.** The payload diff, the two against
> one request counts, the `0xa1c58` cap and the 662616 result all came from throwaway fork probes
> that were deleted after they answered the question, and the balance threshold refutation
> (`estimateOk=true` and `writeOk=true` on both sides) came from another. Written before step 10 of
> the checklist existed, and by that rule they would not be citable today.
>
> **What IS reproducible is the conclusion, which is the part that matters.**
> `packages/core/test/write-gas-fallback.test.ts` asserts that the estimate is asked with an address
> and not an `Account` object, chain free, and fails when the object is put back:
> `pnpm exec vitest run --project unit packages/core/test/write-gas-fallback.test.ts`. The
> illustrative numbers are not checkable; the behaviour they illustrate is pinned.

**How far this generalises.** The two halves generalise differently and the distinction matters.
The node half is standard: `eth_estimateGas` bounding its search by a supplied `gas` field is
ordinary behavior, not an anvil quirk. The client half is viem specific: whether handing a library
an account object makes it prepare and cap the request is that library's choice, and nothing here
establishes what ethers, web3.py or a raw JSON-RPC caller would do. A consumer on another client
should assume nothing from this entry beyond the node half, which is why the fix pins the REQUEST
shape rather than the outcome.

**The fix.** Pass `wallet.account.address` to the estimate and keep the `Account` object on the
simulation. `packages/core/src/internal/write.ts`. Cost to a consumer: none. Same estimate, one
fewer `eth_estimateGas` round trip, no change to fees, latency, or any typed error.

**And the fallback is no longer trace free.** Even fixed, the estimate can still fail for real
reasons, and losing the margin then would still be invisible. `WriteResult` now carries a
`GasDecision`: `{source:'estimate'}` with the estimate and margin used, `{source:'explicit'}`, or
`{source:'fallback'}` carrying the typed error from `mapRevert`. The `console.warn` stays, but it is
no longer the only trace. A library consumer cannot assert on a console line, cannot route it to
their own telemetry, and does not see it in a console they have filtered.

**How it was found, which is the part worth keeping.** The fallback was added in P7 with
`.catch(() => undefined)` and no logging. It was invisible for a wave. The MK-035 pin caught it in
CI as `margin=1.5%` with no explanation anywhere, and the warning added in P9 named it on the next
run. A fallback that restores the behavior a finding was raised about must never be silent, and this
is the second time in this programme that a silent catch cost a diagnosis (see MK-007).

**Its cost while it was carried.** The MK-035 pin failed whenever this fired, so the fork gate was
red in those runs. That was the pin working: it asserts the margin is applied, and the margin was
not applied. **It was deliberately not weakened to make CI green**, because an assertion that passes
when the thing it asserts is untrue is worth less than a red build. It now passes for the right
reason.

**Was the P7 window running without the margin?** The wave that fixed this was asked to re-measure
the isolation rate P7 reported, 2 in 40 before and 0 in 80 after, on the suspicion that part of that
window had silently lost the margin. It cannot be answered for that window and it never will be:
nothing recorded, at the time, which sends carried a margin and which did not. That is the finding.
Going forward it is answerable from the SDK itself, on every send, without a lab: `gas.source`. In
52 redemptions across three fixtures on the rebuilt lab, every one reported `source: 'estimate'` and
none reported `source: 'fallback'`. Separately, the rebuilt lab does not reproduce P7's variance at
all, which is MK-039.

**Pinned by** `packages/core/test/write-gas-fallback.test.ts`, two independent assertions that fail
for different reasons: one on the SHAPE of the estimate request, so the mechanism cannot return, and
one on the RESULT, so a future fallback cannot go trace free again. Both proved by mutation: putting
the `Account` object back fails the first, and restoring `return undefined` with a bare `{ hash }`
fails the second.

---

## MK-038 · `addCollateral` and `repay` ARE ratio gated, and a sinking position cannot be partly rescued

**Class** S2 · **Status** fixed, the gap is previewed and prechecked by MK-042 · **Found by reading the contract to check a claim this
repository had made from reasoning**

**What the claim was.** `docs/03-core-api.md` justified shipping no preview for `addCollateral` and
`repay` like this: they "need no ratio gate, and that is a property of the operation rather than an
omission: adding collateral raises ICR and repaying lowers debt, so neither can move a valid
position below MCR."

Every sentence of that is true. The conclusion drawn from it is false, and the word carrying the
weight is **valid**.

**Ground truth.** `mezo-org/musd`, `solidity/contracts/BorrowerOperations.sol`, main branch.

Both writes reach the same gate. `addColl` (`:189-203`) calls
`_adjustTrove(_collWithdrawal = 0, _mUSDChange = 0, _isDebtIncrease = false)`; `repayMUSD`
(`:261-276`) calls `_adjustTrove(_collWithdrawal = 0, _mUSDChange = _amount,
_isDebtIncrease = false)`, against the signature at `:752-761`. `_adjustTrove` calls
`_requireValidAdjustmentInCurrentMode` unconditionally at `:840-845`, which branches on mode at
`:1212-1227`.

**Normal mode, `:1197-1210`.** Every adjustment, in either direction, runs:

```solidity
1201:        _requireICRisAboveMCR(_vars.newICR);
1209:        _requireNewTCRisAboveCCR(_vars.newTCR);
```

There is no `if (_isDebtIncrease)` around either one. `_requireICRisAboveMCR` (`:1330-1335`) is
`require(_newICR >= MCR, "BorrowerOps: An operation that would result in ICR < MCR is not
permitted")`. It is an **absolute** test on the resulting ICR, not a test that the operation did not
make things worse.

So for a position already **below** MCR, a partial top-up or a partial repayment raises the ICR and
still reverts, because the raised ICR is still under the floor. The exact case a user hits after a
price drop, doing the exactly correct thing, is refused, and this SDK gives them no verdict before
they spend the gas and no number telling them how much would be enough.

`_requireNewTCRisAboveCCR` (`:1344-1349`) cannot bite for these two: both raise TCR, and being in
normal mode means TCR was already at or above CCR.

**Recovery Mode, `:1265-1275`.** Here the original claim holds exactly:

```solidity
1270:        _requireNoCollWithdrawal(_collWithdrawal);
1271:        if (_isDebtIncrease) {
1272:            _requireICRisAboveCCR(_vars.newICR);
1273:            _requireNewICRisAboveOldICR(_vars.newICR, _vars.oldICR);
1274:        }
```

`_requireNoCollWithdrawal` passes trivially, both paths send zero, and both ICR requirements sit
behind `if (_isDebtIncrease)`, which is false for both. A pure top-up and a pure repayment really
are ungated in Recovery Mode.

**Which is the opposite of what the claim predicted.** The documentation said Recovery Mode "adds
restrictions to other operations, not to these two", and treated normal mode as the safe case. The
contract does the reverse: Recovery Mode is where these two are ungated, and normal mode is where
they are gated.

**Why the reasoning failed, which is the part worth keeping.** The claim reasoned about the
DIRECTION of the operation and the contract tests the RESULTING LEVEL. Monotone improvement and
"passes an absolute floor" are different properties, and no amount of reasoning about the first
tells you anything about the second. This is the third time in this programme that a claim reasoned
from an operation's semantics disagreed with the line of Solidity that enforces it (MK-004, MK-005,
MK-006 were all of this shape), and the standing rule that produced this entry, read the contract
rather than reason about it, is the only thing that caught it.

**Blast radius.** Any consumer holding an under-MCR position. `addCollateral` and `repay` revert
with `ICRBelowMCR`, which the SDK maps correctly, so nothing is silently wrong; what is missing is
anything that lets a caller know BEFORE sending, or that tells them the minimum that would work.

**Reproduction.** `packages/core/test/zz-findings.fork.test.ts`, the MK-038 case: open a Trove, drop
the oracle price until ICR is under MCR, then `addCollateral` a small amount and watch it revert.

**Decision, as taken at the time.** Documented, not fixed. The fix is a preview, and it is the same
missing preview `withdrawCollateral` and `adjustTrove` need; building four of them is its own wave
with its own acceptance, and grafting one onto a wave scoped to MK-037 is how scope creep enters
this programme. What changed then was the false claim: `docs/03-core-api.md` was corrected to say
these two ARE gated in normal mode, with the citations above, and the scope limit was restated to
cover four writes rather than two.

**Decision, revised. The gap is CLOSED rather than documented (MK-042).**

The earlier decision is left standing above rather than rewritten, because it was the right call for
the wave it was made in and the reasoning is worth keeping: a preview built as a rider on a gas
handling wave would have had no sweep behind it, and an unswept preview is not a validated one.

What changed is that the limit stopped being a scope boundary and started being the thing the
documentation had to keep apologising for. Three separate documents carried a paragraph explaining
which writes a caller must not trust, and each one was a place the explanation could drift from the
Solidity, which is exactly how the false claim this entry corrects got in. A limit that has to be
restated in three places to stay true is more expensive to carry than to fix.

**Closed by MK-042**, which builds `previewAdjustTrove`, `previewWithdrawCollateral`,
`previewClose` and `maxWithdrawableCollateral`, prechecks every affected write, and puts all five
new paths into the differential sweep. The absolute nature of the ratio requirement, which is this
entry's whole subject, is surfaced as `icrIsAbsolute` and `minimumCollateralToClearIcr` on the
preview result rather than left in prose.

---

## MK-039 · The measurement behind the gas margin was not reproducible

**Class** S3 · **Status** fixed · **Found by being asked to re-run it**

**What happened.** `DEFAULT_GAS_MARGIN_PERCENT` is 25 because of a measurement: the same
`redeemCollateral` call varying from 610270 to 710023 gas across 40 attempts, 2 of which reverted,
against a limit carrying a 1.5% margin. That number decided a default every write in this SDK
carries. The script that produced it was never committed. When the next wave was asked to re-run
it, there was nothing to re-run, and it had to be rebuilt from a prose description.

**And the description cannot be right.** Rebuilt, the lab is now committed as
`packages/core/test/gas-variance.fork.test.ts`, and across three fixtures on a fork of testnet at
block 15043414, every attempt restored from the same `evm_snapshot`:

| redeem | attempts | gas limit | gas used | realised margin | reverts | fallbacks |
|---|---|---|---|---|---|---|
| 100 MUSD | 40 | 442640 | 408178 | 8.4% | 0 | 0 |
| 5000 MUSD | 6 | 726657 | 615858 | 17.9% | 0 | 0 |
| 20000 MUSD | 6 | 2087949 | 1642624 | 27.1% | 0 | 0 |

**The gas used was identical to the unit within every fixture.** The last two ran with an extra
hour warped onto the clock per attempt, out to five hours, and the figure still did not move.

That is not a surprising result, it is the only possible one. **EVM execution is deterministic.**
From byte identical state at a given timestamp the same call consumes the same gas, necessarily.
So a 16% spread across 40 attempts proves that something was varying which the description did not
name, and the description said the state was byte identical. Hours of accrued interest are ruled
out by the two fixtures above. What is NOT ruled out, and what this entry does not claim to have
established: a deeper traversal in which a partial redemption flips between troves, a fixture
mutated by other tests in the same run, or attempts that were not snapshot isolated at all.

**What this does not overturn.** The 610270 to 710023 growth was observed on a real transaction and
the revert it ended in was traced to `ActivePool` running out of gas at call depth 4. That happened.
The margin is still justified: at the 100 MUSD fixture the node's own estimate leaves only 8.4%
headroom, well under the 16.4% growth traced, which is exactly the gap the margin closes. What is
not established is the "2 in 40" RATE, because the lab that produced it cannot be reproduced and
the rebuilt one produces no variance at all.

**Why it is S3 rather than S2.** No consumer is affected. The default is defensible on the traced
growth alone. What was lost is the ability to check a number that decided a default, which is a
process defect, and the kind that compounds: the P7 window also ran with the margin silently
dropped on an unknown fraction of its sends (MK-037), and there is now no way to find out which.

**Fixed by** committing the lab, opt in behind `MK_GAS_LAB=1` so it costs CI nothing, with its
runtime, its knobs and the reconstruction's numbers written at the top of the file so the next run
has something to disagree with.

---

## MK-040 · The export map ships CommonJS types and never points at them

**Class** S2 · **Status** fixed · **Found in release preparation, by typechecking a consumer against
the packed tarball rather than against the workspace**

**What happens.** Both packages declare `"type": "module"` and build BOTH declaration files,
`dist/index.d.ts` and `dist/index.d.cts`. `dist/index.d.cts` is in the published tarball. **Nothing
in `package.json` ever refers to it.** The export map carried one top level `types` condition:

```json
"exports": { ".": {
  "types": "./dist/index.d.ts",
  "import": "./dist/index.js",
  "require": "./dist/index.cjs"
} }
```

One `types` for both conditions means a CommonJS consumer resolving `require` gets `index.cjs` at
runtime and `index.d.ts` at type level. In a `"type": "module"` package `index.d.ts` describes an ES
module, so TypeScript refuses it:

```
error TS1479: The current file is a CommonJS module whose imports will produce 'require'
calls; however, the referenced file is an ECMAScript module and cannot be imported with
'require'.
```

**Blast radius, measured rather than reasoned.** A consumer project was created, the packed 0.2.0
tarballs installed into it, and one probe file typechecked under four configurations:

| Consumer | `module` | `moduleResolution` | Before | After |
|---|---|---|---|---|
| CommonJS | `node16` | `node16` | **exit 2, TS1479** | exit 0 |
| CommonJS | `esnext` | `bundler` | exit 0 | exit 0 |
| ESM | `node16` | `node16` | exit 0 | exit 0 |
| ESM | `esnext` | `bundler` | exit 0 | exit 0 |

So it is **one configuration of four**, and it is types only: `require('@musd-kit/core')` returns all
88 exports at runtime in every case, before and after. A CJS consumer on Node16 or NodeNext
resolution could run the package and could not typecheck against it.

**It shipped in 0.1.0.** The published `@musd-kit/core@0.1.0` tarball carries the identical export
map, so this is not a 0.2.0 regression. It was found now because release preparation typechecked
against the PACKED TARBALL rather than against the workspace, where path mapping hides it. A
workspace typecheck is green either way, which is why every previous wave missed it.

**Fix.** Nest the `types` condition inside each of `import` and `require`, which is what a dual
package has to do:

```json
"exports": { ".": {
  "import":  { "types": "./dist/index.d.ts",  "default": "./dist/index.js"  },
  "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
} }
```

`main`, `module` and `types` stay at the top level for resolvers that do not read `exports`.

**Pinned by** the four way matrix above, re-run against the repacked tarballs. It is not pinned by an
automated test: doing that needs a pack, an install into a scratch project and a `tsc` run, which is
its own job rather than a unit test. **That is a gap, and it is stated here rather than left
implied.** The check is written down in this entry and in the release preconditions of the pull
request that fixed it.

---

## MK-041 · The Foundry version floated, so a new anvil release reddened the gate

**Class** S2 · **Status** fixed · **Found in release preparation, on a commit that changed one
markdown file**

**What happened, in the order it was established.** The fork gate failed on `15cd44e`, a commit
whose entire diff is 54 added lines in `docs/07-testing.md`. The failure is not a test failure:

```
Test Files  no tests
ERROR: Coverage for lines (0%) does not meet global threshold (98%)
Serialized Error: { details: 'Excess blob gas not set.', code: -32602,
  Request body: {"method":"eth_call", ... }, URL: http://127.0.0.1:36979 }
```

`eth_call` against the local anvil fails before a single test runs, so the suite reports **no
tests**, and the coverage gate then reports 0% and fails for a second, downstream reason.

**Three candidates, eliminated by evidence rather than by argument.**

1. **The commit.** Ruled out: `git show --stat` is one markdown file, and its parent `e97f0d2`
   passed the same job.
2. **A flake.** Ruled out: `gh run rerun --failed` reproduced it exactly.
3. **The anvil fork cache** (which MK-029 made survive failures, so a poisoned entry could
   persist). Ruled out: **both** runs logged `Cache hit for: anvil-fork-31611-15043414` and
   restored the identical key.

What was left was the toolchain, and it is decisive:

| Run | Time | anvil | Fork gate |
|---|---|---|---|
| [33065186347](https://github.com/cayvox/musd-kit/actions/runs/33065186347) | 10:56 | **1.7.1** | success |
| [33074977978](https://github.com/cayvox/musd-kit/actions/runs/33074977978) | 13:08 | **1.8.0** | failure |

`foundry-rs/foundry-toolchain@v1` was configured with `version: stable`, which **floats**. Foundry
released 1.8.0 between those two runs, and anvil 1.8.0 rejects this fork's `eth_call` with
`Excess blob gas not set`. Nothing in the repository changed. The build changed underneath it.

**This is MK-029 one level over.** MK-029 was local evidence and CI evidence both being true because
they ran different Node runtimes, and its fix was to pin the Node version in the workflow rather
than inherit it. The Foundry version was left floating in the same workflow, so the same class of
defect was still live, and it took a docs only commit to expose it. The lesson from MK-029 was
recorded as being about Node; it is about **every** unpinned input to the build.

**Fix.** Pin `version: 1.7.1` in both `ci.yml` and `release.yml`, chosen because it is the last
version this repository's own CI proved green, not because it is the newest. Bumping it is a
deliberate act in its own commit, with the run read afterwards, exactly as the Node pin says.

**What is NOT established, and is left open rather than guessed:** whether anvil 1.8.0 is wrong here
or whether this fork's block headers genuinely lack `excessBlobGas` and 1.7.1 was lenient about it.
Answering that needs reading anvil's changelog and the Mezo block header, which is a wave rather
than a paragraph. The pin makes the gate honest in the meantime, and it does **not** mean the SDK is
incompatible with anvil 1.8.0: nothing here tested the SDK against it, only the test harness.

---

## MK-042 · Five exposed writes had no preview, so the only way to ask was to send

**Class** S2 · **Status** fixed · **Closes the gap MK-038 documented as a scope limit**

**What was missing.** Eleven writes are exposed; three had a preview. For the other eight a caller
could not ask "would this work" without sending a transaction and reading the revert, and five of
those eight have real constraints a preview can evaluate.

**The gate table, rebuilt from the contract for this wave** rather than carried forward, because
part of the earlier table's reasoning was wrong (MK-038). `mezo-org/musd`, main branch, with
`BorrowerOperations.sol` line numbers unless noted.

| SDK write | Contract path | Gates it must pass |
|---|---|---|
| `openTrove` | `:180` -> `_openTrove` | not active `:633`; `minNetDebt` `:645`; **recovery** ICR>=CCR `:655`; **normal** ICR>=MCR `:657` and TCR>=CCR `:665` |
| `addCollateral` | `:189` -> `_adjustTrove(0,0,false)` | active `:790`; non zero `:789`; **normal** ICR>=MCR `:1201` and TCR>=CCR `:1209`; **recovery** none |
| `borrow` | `:243` -> `_adjustTrove(0,amt,true)` | active `:790`; non zero debt `:786`; **normal** ICR>=MCR, TCR>=CCR; **recovery** ICR>=CCR `:1272` and newICR>=oldICR `:1273`; capacity `:851` |
| `repay` | `:261` -> `_adjustTrove(0,amt,false)` | active; **normal** ICR>=MCR, TCR>=CCR; **recovery** none; `minNetDebt` `:856`; repayment <= debt-200 `:859`; balance `:860` |
| `withdrawCollateral` | `:225` -> `_adjustTrove(amt,0,false)` | active; `assert(amt <= coll)` `:837`; **recovery** NO withdrawal at all `:1270`; **normal** ICR>=MCR, TCR>=CCR |
| `adjustTrove` | `:296` -> `_adjustTrove(...)` | every row above, by combination; plus singular coll change `:788` |
| `close` | `:278` -> `_closeTrove` | active `:951`; **if `canMint`** not recovery `:954`; balance >= debt-200 `:963`; **if `canMint`** TCR>=CCR `:972` |
| `refinance` | `:282` -> `_refinance` | not recovery `:1023`; active `:1024`; ICR>=MCR **after the fee** `:1058`; TCR>=CCR `:1059` |
| `claim` | `:316` -> `_claimCollateral` `:1119-1124` | **none.** It reads the surplus pool and sends. No preview is possible because there is no condition |
| `redeem` | `TroveManager.sol:294` | TCR>=MCR `:318`; amount>0 `:319`; balance `:320` |
| `liquidate` | `TroveManager.sol:265` | trove active `:266`, then the batch path |
| `batchLiquidate` | `TroveManager.sol:654` | non empty array `:657`; something actually liquidatable `:690` |

**Four things in that table are not what a Liquity reader expects**, and each is now expressed in a
preview rather than in prose:

1. **The individual ratio gate is absolute** (`:1330-1335`). It tests the resulting level, not the
   direction, so an improving operation is refused when the result is still under the floor. This is
   MK-038 and it is why `AdjustPreview` carries `icrIsAbsolute` and `minimumCollateralToClearIcr`.
2. **Recovery Mode does not check TCR and normal mode does.** `:1265-1275` never looks at TCR;
   `:1197-1210` checks it on every adjustment. The mode with the tighter reputation has the shorter
   list for a pure top-up or a pure repayment.
3. **A plain borrow can never succeed in Recovery Mode.** `withdrawMUSD` sends no collateral, so
   `newICR < oldICR` always and `_requireNewICRisAboveOldICR` (`:1273`) cannot be satisfied at any
   draw size. Only `adjustTrove` with a collateral leg can clear it.
4. **Two of `close`'s four gates are conditional on a live chain read**, `musd.mintList(address(this))`
   (`:949`). With BorrowerOperations off the mint list, closing is permitted in Recovery Mode and the
   TCR check does not run. `ClosePreview.canMint` reports it rather than assuming it.

**What was built.** `previewAdjustTrove`, `previewWithdrawCollateral`, `previewClose` and
`maxWithdrawableCollateral`, in the shape the existing previews use: a `viable` verdict, machine
readable `reasons`, a `bindingConstraint`, and the raw numbers. **One evaluator for the adjust
family**, because the contract has one: five entry points funnel into `_adjustTrove` and are gated by
the same code, and a guard per write is how the guards disagree with each other later. Prechecks on
`addCollateral`, `borrow`, `repay`, `withdrawCollateral`, `adjustTrove` and `close`, each throwing a
typed error carrying the real numbers before simulate. Four React hooks.

**`claim` deliberately has no preview**, and the table says so rather than adding ceremony to make
the surface look symmetrical: `_claimCollateral` (`:1119-1124`) has no require of any kind.

**Proved by** the differential harness, extended from three operations to eight so every preview is
swept: verdict against outcome, both directions reported separately, boundary weighted, each case
snapshot isolated. Plus ten chain free tests of the pure evaluators, four of them proved by mutation.

**Cost.** A preview is a read, and these read more than the old ones: the adjust preview issues eight
concurrent reads plus a conditional fee read. That is the price of answering before sending, and it
is paid only when a caller asks.

---

## MK-043 · Two reverts had no typed error, and three shared one that was wrong

**Class** S2 · **Status** fixed · **Found while wiring MK-042's prechecks, by checking which reverts
the new typed errors would collide with**

**What was wrong.** Every revert string in `BorrowerOperations.sol` and `TroveManager.sol` was
extracted and checked against `mapRevert`'s patterns. Two consumer reachable reverts matched nothing
and arrived as a generic `ContractCallFailed`:

- `"BorrowerOps: An operation that would result in TCR < CCR is not permitted"` (`:1344-1349`), which
  gates `openTrove`, every normal mode adjustment, `closeTrove` and `refinance`.
- `"BorrowerOps: An operation that exceeds maxBorrowingCapacity is not permitted"` (`:1358-1365`).
  `ExceedsBorrowingCapacity` existed and was thrown by the precheck; the revert path never reached it.

And three DIFFERENT Recovery Mode reverts all matched `/recovery mode/i` and returned the same
`RecoveryModeRestriction`, whose message is "this operation must leave the Trove with ICR >= CCR":

- `"Operation not permitted during Recovery Mode"` (`:1136`), where nothing about ICR helps.
- `"Cannot decrease your Trove's ICR in Recovery Mode"` (`:1401`), which is about the OLD ratio.
- `"Collateral withdrawal not permitted Recovery Mode"` (`:1391`), where **no amount is permitted**.

**The third is the one that costs a user something.** Told to reach ICR >= CCR, they go looking for a
smaller withdrawal that satisfies it. There isn't one: `_requireNoCollWithdrawal` permits zero.

**Fix.** `SystemRatioBelowCCR` and `CollateralWithdrawalBlocked` added, the capacity revert mapped,
and the withdrawal case matched before the general Recovery Mode pattern. `ExceedsBorrowingCapacity`
now takes its four numbers as OPTIONAL, for the same reason `BelowMinimumDebt` does since MK-017: the
decode path knows none of them, and constructing it with four zeros would print four numbers the user
never encountered.

**Not fixed, and stated rather than implied:** seven further revert strings remain unmapped, all of
them conditions the SDK's own prechecks catch first (`Cannot withdraw and add coll`,
`There must be either a collateral change or a debt change`, `Debt increase requires non-zero
debtChange`, `Amount must be greater than zero`, `Calldata address array must not be empty`,
`Cannot redeem when TCR < MCR`, `Only one trove in the system`). They are reachable only by racing
the precheck, and mapping them is a separate, smaller wave.

---

## MK-044 · Two runtimes were still on moving labels, one of them end of life

**Class** S3 · **Status** fixed · **Found by auditing every workflow rather than assuming MK-041's
fix had covered the class**

**What MK-041 fixed and what it did not.** MK-041 pinned Foundry after a new anvil stable turned the
fork gate red on a commit that changed one markdown file. It fixed the instance. This is the sweep,
and it found two more:

| Where | Was | Problem |
|---|---|---|
| `ci.yml`, the checks matrix | `node: ['20', '22', '24']` | **Three moving labels.** Run 32706407738 resolved them to v20.20.2, v22.23.2 and v24.19.0; the day a patch ships, CI silently moves |
| `deploy-site.yml` | `node-version: 20` | **Moving, AND end of life.** Node 20 reached EOL on 2026-04-30. An earlier wave flagged both in a comment and deliberately left the decision open |

**Fixed.** The matrix is pinned to exactly the versions the run above resolved, so the pin changes
nothing today and stops the change happening tomorrow without a commit. `deploy-site.yml` moves to
24.19.0, the version the fork gate declares, so the site is built on the runtime the tests ran on
rather than on an unsupported one. `actions/checkout` and `actions/setup-node` were on v4 in some
workflows and v5 in others, and are normalised.

**What is deliberately left floating, and why**, because a pin audit that pins everything is not a
judgment, it is a reflex:

**The `uses:` action majors stay floating.** The line drawn is **what executes the project's code**.
Node, pnpm and Foundry are pinned because a change to any of them changes what the suite measures,
which is exactly how MK-029 and MK-041 happened. Action majors are workflow infrastructure: a float
can break a run loudly, and it cannot silently change a test result, which is the failure mode the
pins exist to stop. Pinning them means commit SHAs. That is a real supply chain protection against a
tag being re-pointed, and a real ongoing cost: every action needs a manual bump forever, in a single
maintainer repository, and a stale action is its own failure. Revisit if this repository grows more
maintainers, or the first time an action does change a result.

**The cost of pinning, stated because it is not free.** Pins go stale. A pinned runtime stops
receiving fixes until someone bumps it, and nothing here will remind you. That is the trade, taken
deliberately: **a stale pin fails visibly when you bump it; a floating label fails invisibly under a
commit that changed nothing.** Recorded in the checklist beside the runtime rule.

---

## MK-045 · A Trove cannot be closed with only the MUSD it drew

**Class** S3 · **Status** documented. **This is a property of the protocol, not a defect in this
SDK** · **Found by preparing the live testnet run**

**What happens.** The borrowing fee is added to the debt and minted to the PCV, never handed to the
borrower (`BorrowerOperations.sol:637-643` on open, `:813-818` on a debt increase). Closing requires
`entireDebt - MUSD_GAS_COMPENSATION` in hand (`:963`). So a borrower who spends nothing and holds
every MUSD they drew is still short by **exactly the accumulated fees plus accrued interest**.

**Measured on a fork, not reasoned:**

```
draw=2000 MUSD  ->  musdHeld=2000  entireDebt=2202  (2000 draw + 2 fee + 200 reserve)
previewClose: viable=false required=2002 held=2000 shortfall=2  [INSUFFICIENT_MUSD_BALANCE]
```

The shortfall is the 2 MUSD fee, to the wei. Confirmed again on **live testnet**, where after a full
lifecycle the position reported a shortfall of `2.300590672576505785` MUSD.

**And the position cannot repay its way out.** `_requireAtLeastMinNetDebt` (`:856`, `:1239-1244`)
forbids taking the net debt below the floor, so a Trove opened at the floor can repay almost nothing.
At the live run's position the repayable amount was under 2 MUSD.

**What it means, and what it does not.** `previewClose` reports it correctly, with the exact number,
which is the SDK behaving as designed: this entry is not a bug report against the SDK. What it means
is operational: **a self funded testnet account cannot end a lifecycle run with no Trove.** It needs
MUSD from outside the position, and on testnet there is no source but another funded party.

**What changed because of it.** `scripts/testnet-e2e.ts` no longer promises to leave the account
closed. It attempts the close, reports the exact shortfall, records `close` as skipped with the
reason, and states plainly at the end that the account holds an open Trove. It also continues
against a carried position rather than dying, because otherwise the script is single use: the second
invocation on any account always finds a Trove it cannot close.

---

## MK-046 · The live script compared a preview to a read taken later

**Class** S3 · **Status** fixed · **Found on the first live run, which failed on it**

**What happened.** The first live invocation died here:

```
✗ entireDebt after open: chain says 2001800001903035502288, the preview said 2001800000000000000000
```

A difference of `1903035502288` wei. At 100 bps on 2001.8 MUSD that is **3.00 seconds** of interest,
computed rather than eyeballed:

```
per year = 2001.8 * 0.01      = 20.018 MUSD
per second                    = 6.3477e-7 MUSD
1.903035502288e-6 / 6.3477e-7 = 3.00 seconds
```

**The preview was right.** It predicts the debt at the moment the operation lands. The assertion
compared it against `getTrove` read afterwards, which includes interest accrued since. Those are two
different quantities, and on a live chain the gap is never zero.

**Why no fork test caught it.** anvil mines on demand, so no wall clock time passes between a write
and the read after it, and the same assertion is exactly true there. The differential harness makes
the identical comparison in `openCase` and found zero mismatches in 1000 cases. **A fork cannot
surface a defect whose cause is the passage of time**, which is a limit of fork testing worth naming
rather than a gap in the sweep.

**Fixed** by `assertDebtEq`, which requires the drift to be positive, since debt only grows with
time, and no larger than 120 seconds of interest at the live rate. It prints the drift and its
equivalent in seconds, so a reader sees the number rather than a pass. The completed run reported
9 seconds on two steps.

---

## MK-047 · `previewOpen` says viable for an account that already has a Trove

**Class** S2 · **Status** fixed, in the preview AND in the generator that could not express it ·
**Found by the live testnet run, which is the only place it could have been found**

**A preview verdict that disagrees with the contract.** `previewOpen` returns
`viable: true, reasons: []` for an owner who already holds an active Trove. The contract refuses:

```
PROBE trove exists=true entireDebt=2202000000000000000000
PROBE previewOpen viable=true reasons=[] binding=null
PROBE raw openTrove simulate REVERTED: BorrowerOps: Trove is active
```

Observed first on live testnet, in the completed run, as
`previewOpen on an account that already has a Trove: viable=true []`, then reproduced on a fork with
the raw contract call above so the revert string is on the record.

**Ground truth.** `_openTrove` calls `_requireTroveisNotActive` at `BorrowerOperations.sol:633`,
defined at `:1140-1149` as `require(status != Status.active, "BorrowerOps: Trove is active")`. It is
the FIRST gate on the open path.

**What the SDK models.** `OpenBlockReason` is three values (`packages/core/src/math/previewOpen.ts:28`):
`BELOW_MINIMUM_DEBT`, `ICR_BELOW_THRESHOLD`, `TCR_BELOW_CCR`. The module never reads
`getTroveStatus`: a grep for it returns zero. Its own docstring at `:33-35` claims the verdict is
"True only when every condition `_openTrove` enforces is satisfied", and that is not true.

**Every other preview reads the status.** `previewBorrow`, `previewAdjustTrove` and `previewClose`
all emit `TROVE_NOT_ACTIVE`. `previewOpen` is the only one missing its status gate, and it is the
INVERSE gate: the Trove must NOT be active.

**Why the 1000 case sweep never caught it.** `openCase` in
`packages/core/test/differential/harness.ts` uses `testAccount(500_000 + c.index)`, a fresh account
per case. **No generated case has ever previewed an open against an account that already holds a
Trove**, so the sweep's coverage of `previewOpen` has a hole exactly the shape of this defect. That
is the finding behind the finding: a sweep proves what its generator can express.

**Blast radius.** The write path is protected: `openTrove` prechecks with
`if (pos.entireDebt > 0n) throw new TroveAlreadyExists(...)`
(`packages/core/src/trove/index.ts:296`), so no gas is wasted and no transaction reverts. What is
wrong is the **verdict a UI renders**: an interface that enables its open button from
`previewOpen.viable` shows "you can open a position" to someone who already has one, and the call
then throws. That is the same class as MK-005, and it is why this is S2 rather than S3.

**The fix, and the order it was done in.** The generator first, then the preview, because shipping a
preview change without the coverage that would have caught it is the mistake this programme has spent
waves removing.

`previewOpen` now reads `getTroveStatus` when an account is supplied and emits
`TROVE_ALREADY_ACTIVE`. The reason is named for what the contract actually tests: `:1146` compares
against `Status.active`, so a Trove closed by the owner, by liquidation or by redemption does NOT
block a reopen. Calling it `TROVE_ALREADY_EXISTS`, which was the obvious name, would have been wrong.

**With no account supplied the gate is not evaluated and the absence is reported**, via
`troveStatus: undefined`, on exactly the rule `feeExempt` already used: without an account there is
nobody to ask about, and guessing is worse than saying so.

**The docstring was corrected too**, and that is not cosmetic. It claimed the verdict was "true only
when every condition `_openTrove` enforces is satisfied" while the code checked three of four. A test
now pins the reason list against the contract's gate list in call order, so the claim and the code
cannot drift apart silently again.

**Proved by mutation**, three ways, each failing a different test: removing the gate, blocking on any
non zero status instead of `active`, and moving the gate out of call order.

### The larger finding: what the generator could not express

Fixing the preview would have left the hole that hid it. The generator now carries a `precondition`
of `FRESH` or `OCCUPIED`, and one case in five runs against the state OPPOSITE to the one its
operation expects. One in five rather than one in two, because a mismatched state short circuits
every later gate, so a higher rate would spend the sweep proving one reason repeatedly instead of
probing the boundaries the bands were weighted for.

**The same blind spot existed in the other direction, for four more previews.** Every non open case
called `seedPosition` first, so `previewBorrow`, `previewRefinance`, `previewAdjustTrove` and
`previewClose` all list `TROVE_NOT_ACTIVE` and no generated case could ever produce it. Both status
gates were unreachable, in opposite directions, and only one of them happened to be wrong.

**What the generator still cannot construct** is recorded in
`docs/09-review-and-validated-surface.md` §3 rather than left implied: adding and withdrawing
collateral in one call, an adjustment that requests nothing, a debt increase of zero, and a Trove
that was closed rather than never opened. The first three are input validation the SDK prechecks
separately; the fourth is blocked by MK-045, because the harness cannot obtain the fee needed to
close a seeded position.

---

## MK-048 · `truncatedAmount` reports redeemable amounts the chain refuses

**Class** S2 · **Status** CLOSED. Previewed by `previewRedeem`, prechecked on the write path,
verified live at the lower edge, and confirmed in both directions by a sweep that first proved the
upper edge wrong · **Found by the live testnet run, on the only chain where another account's Trove
sits near the debt floor**

**The bar for closing it was that the preview agrees with the chain in both directions, and it now
does**: across 83 executed redemption cases from seed `20260826`, zero FALSE_VIABLE and zero
FALSE_BLOCKED, including 19 that offer exactly the net debt as read and are refused. The numbers are
in full at the end of this entry.

**What happens.** `redeem` reports `truncatedAmount`, taken from the protocol's own
`getRedemptionHints`, as the amount that will be redeemed. On live Mezo testnet that number is wrong
for anything above a few MUSD, and the transaction reverts.

Measured at head, with hints computed fresh for each amount immediately before simulating:

| requested | `truncatedAmount` says | chain |
|---|---|---|
| 50 MUSD | 50.00 | **`TroveManager: Unable to redeem any amount`** |
| 20 MUSD | 20.00 | **`TroveManager: Unable to redeem any amount`** |
| 5 MUSD | 5.00 | succeeds |
| 1 MUSD | 1.00 | succeeds |

**Not a race, and that was the first hypothesis.** It reverts in `eth_call` at head with hints
computed in the same breath, deterministically, and it reproduced across two live runs and a
simulation sweep.

**The mechanism, from `mezo-org/musd`, `TroveManager.sol`.** A redemption that does not consume a
whole Trove is a PARTIAL against the first eligible one, and `_redeemCollateralFromTrove` cancels a
partial when any of three conditions holds (`:1299-1306`):

```solidity
if (
    _partialRedemptionHintNICR < vars.newNICR ||
    _partialRedemptionHintNICR > vars.upperBoundNICR ||
    _getNetDebt(vars.newDebt) < redeemCollateralVars.minNetDebt    // <- this one
) {
    singleRedemption.cancelledPartial = true;
    return singleRedemption;
}
```

A cancelled partial `break`s the redemption loop (`:392`), which leaves `totalCollateralDrawn` at
zero, which fails `require(totals.totalCollateralDrawn > 0, "TroveManager: Unable to redeem any
amount")` (`:406-408`). **So the whole redemption reverts, rather than redeeming less.**

The binding quantity is the target Trove's headroom above the debt floor. Measured on the trove the
hints pointed at, `0x4799e9fB361Fb6a85473bB08dA00A4012E02Cf08`:

```
entireDebt   2007.516876 MUSD
netDebt      1807.516876 MUSD   (entireDebt - 200 reserve)
minNetDebt   1800.000000 MUSD
HEADROOM        7.516876 MUSD   <- the most that can be partially redeemed from it
```

7.52 sits exactly between the 5 that works and the 20 that does not.

**`getRedemptionHints` does not model that cancellation.** It reported the full amount as
redeemable at every size tested, including sizes the same block refuses.

**Whose defect is it.** The over-reporting is the protocol's hint helper, not arithmetic this SDK
performs. What is ours is that the SDK **passes that number through as a result field** and its
docstring understates the consequence: `RedeemResult.truncatedAmount` says "the ACTUAL redeemed
amount can be less when a partial of the last Trove is skipped". The actual amount is not less here,
it is **zero, and the transaction reverts**. A caller who sizes a redemption from `truncatedAmount`
pays gas for a revert.

**Why no fork case caught it.** The differential harness has no redemption case at all: `redeem` is
one of the three surfaces with no preview to compare a verdict against, which `docs/09` §3 already
records. And the condition needs another account's Trove to be sitting within a few MUSD of the debt
floor, which is a property of a shared chain with real users rather than of a seeded fixture.

**Blast radius.** A reverted transaction and its gas. Nothing is silently wrong: `mapRevert` turns it
into `RedemptionFailed` with an accurate message, and no number reaches a user as money. It is S2
rather than S3 because the SDK returns a figure the chain contradicts, which is the same class as
MK-014 and MK-047 even though the source of the wrong number is upstream.

### The complete rule, derived from source and verified to the wei

Reading the whole path rather than the two lines first cited changes the shape of the answer. **It is
a GAP, not a cap.** For the first eligible Trove with net debt `D` **as read**, floor `M`, and the
interest `G` that Trove accrues between the read and the block the transaction lands in:

| amount | outcome | why |
|---|---|---|
| `A <= D - M` | succeeds | a partial inside the headroom |
| `D - M < A < D + G` | **REVERTS** | `:1218-1221` hands the whole amount to that Trove, `:1299-1306` cancels, `:392` breaks, `:406-408` reverts |
| `A >= D + G` | succeeds | the Trove is consumed WHOLE via `:1252`, a branch with **no hint check and no floor check at all** |

The `G` in that table is the correction the sweep forced, and it is recorded in full below. The
first version of this table said the upper edge was `D`, and that was wrong.

**Full consumption behaving differently was the open question, and this is the answer.** `:1252` is
`if (vars.newDebt == MUSD_GAS_COMPENSATION)`, which holds exactly when the offered amount covers the
Trove's entire net debt. That branch calls `_redeemCloseTrove` and `_closeTrove(Status.closedByRedemption)`
and never reaches the cancellation. A whole consumption can never be cancelled.

Simulated on a fork against the real deployment, with the helper's answer beside each:

```
headroom exactly  208463779941643739864   hint said the same   SUCCEEDS
headroom + 1 wei                          hint said the same   REVERT
netDebt / 2                               hint said the same   REVERT
netDebt - 1 wei                           hint said the same   REVERT
netDebt exactly  2008463779941643739864   hint said the same   SUCCEEDS   <- ARTEFACT, see below
netDebt + 1 wei                           hint said the same   SUCCEEDS   <- ARTEFACT, see below
```

The three REVERT rows and the headroom row were later reconfirmed by sending. The last two were
taken with the read and the evaluation at the SAME block, which is a delay no caller can have; why
that matters is the next section.

And again on LIVE testnet at pinned block 15164949, where `edge - 1` and `edge` succeed while
`edge + 1 wei` and `edge + 1 MUSD` revert.

### The correction the sweep forced: the upper edge is `D + G`, not `D`

The rule above was derived from source and then measured, and the measurement of the upper edge was
**wrong because of how it was taken**. The fork evidence used `simulateContract`, which is an
`eth_call` at the current block: no block is mined, so no time passes, so no interest accrues, and
`mUSDLot = min(A, totalDebt - GAS_COMP)` at `A = D` is an exact equality that consumes the Trove.

A real send does not work that way. `:366` runs `_updateTroveInterest(currentBorrower)` before the
lot is sized, and `:1218-1221` then reads `_getTotalDebt` on the UPDATED Trove. By the block a
transaction executes in, the Trove owes more than the preview read, so an offer of exactly `D`
arrives as a **partial** leaving dust, dust is far below `minNetDebt`, and it cancels.

The 1000 case sweep found it as two `FALSE_VIABLE` mismatches, both `redeemBand=WHOLE_TROVE`, which
is exactly the band added in this wave to cover full consumption. The first probe of it went through
`client.redeem`, which simulates before it sends, so it could not separate a refusal by the
simulation from a refusal by the chain, and the explanation first written from it was too broad.

**The instrument is committed**: `packages/core/test/redeem-boundary.fork.test.ts`, run with
`pnpm test:fork packages/core/test/redeem-boundary.fork.test.ts`. Every row starts from the same
snapshot and varies only the delay between reading the net debt and executing:

```
                                  simulate  send
warp      0s  netDebt             ACCEPTED  success
warp      0s  netDebt + margin    ACCEPTED  success
warp      1s  netDebt             REFUSED   reverted
warp      1s  netDebt + margin    ACCEPTED  success
warp     60s  netDebt             REFUSED   reverted
warp     60s  netDebt + margin    ACCEPTED  success
warp    600s  netDebt             REFUSED   reverted
warp    600s  netDebt + margin    ACCEPTED  success
warp   3600s  netDebt             REFUSED   reverted
warp   3600s  netDebt + margin    REFUSED   reverted
warp  86400s  netDebt             REFUSED   reverted
warp  86400s  netDebt + margin    REFUSED   reverted
```

**One second of delay is enough to make the bare net debt fail.** That is why `nextViableAmount`
carries `G`, sized as 600 seconds of interest on the Trove's entire debt at its rate. 600 is the
contract's own allowance for accrual where it bounds a partial hint (`:1276-1285`), and the ladder
bounds the claim at both ends: **the margin holds to 600 seconds and does NOT hold at an hour.** A
caller who expects a longer delay should offer more, and overshooting costs nothing, because the
excess spills to the next Trove and a cancellation there cannot revert the call once the first Trove
has been drawn (`:406-408`).

The `warp 0s` row is reported and deliberately not asserted on: it depends on how many milliseconds
the harness spends between the read and the send, and it has been observed both ways. **That
instability is the finding rather than noise. A caller cannot reach zero elapsed time**, so the
amount that works there is not an amount anyone can use.

**The methodological finding is the durable one, and its first version was too broad.** It is not
that a simulation and a send are different experiments: at one second they agree, and at zero they
agree the other way. It is that **a simulation evaluates at the current block and a transaction
cannot**, so a boundary measured by simulating at the block the value was read at answers a question
no caller can ask. `docs/08-conventions.md` §10 step 11 is the rule this produced, and the
`simulated` evidence label is what makes it visible in review.

### Is the helper wrong, or only our use of it

**Neither, exactly, and the distinction is the finding.** `HintHelpers.sol:138-162` sizes each
partial to `min(remainingMUSD, netDebt - minNetDebt)` and then CONTINUES to the next Trove. So
`truncatedAmount` answers **"how much could be redeemed if every partial were sized per Trove"**,
which needs one call per Trove. `TroveManager.sol:1218-1221` does no such sizing: it hands the whole
remaining amount to the first Trove and cancels if that breaches the floor.

The helper is internally correct and answers a question nobody asked. **What is entirely ours is
passing its answer through as `RedeemResult.truncatedAmount` and describing it as the redeemable
amount.** So the fix is ours entirely, and it is not a workaround for a protocol bug.

### The fix

`previewRedeem` walks the sorted list the way the LOOP does, and reports what a single call will
actually redeem, with both edges of the gap named so a caller can move to either side:
`maxWithoutConsuming` is `D - M` and `nextViableAmount` is `D + G`. `PARTIAL_BREACHES_DEBT_FLOOR` is
the reason that had no field before, and `accrualMargin` reports `G` so the offset is inspectable
rather than folded silently into a total.

**The write path prechecks it**, which is a deliberate exception to the usual judgment. Everywhere
else a revert the caller could have inspected is tolerable. Here **the blocking condition lives in
someone else's position**: it is the headroom of the first eligible Trove in the sorted list, it
moves without the caller doing anything, and no field the SDK exposed could see it. Charging a
caller gas to discover a number they cannot look up is the wrong trade.

`RedeemResult.truncatedAmount` keeps its value and loses its claim: the docstring now says what it
is, that the actual result is often zero and a revert rather than "less", and points at
`previewRedeem`.

**Verified live in both directions**, on Mezo testnet:

```
preview said redeemable 1259575681295202401
chain burned            1259575681295202401   EXACT
  0xbb205c5b2482d12c2eb949d9c322580b6cc2aa965debc98c7a192c7e9e7f7f13, block 15165003

edge + 1 MUSD: RedemptionBreachesDebtFloor, nonce 37 before and after
  -> no transaction was sent, no gas spent
```

**And the generator can now construct the state**, which is the rule since MK-042: cases carry a
`RedeemBand` of `WITHIN_HEADROOM`, `AT_HEADROOM`, `IN_THE_GAP`, `AT_NET_DEBT` or `WHOLE_TROVE`,
computed from the REAL first eligible Trove at run time rather than a seeded fixture, because a
redemption targets the lowest ICR Trove system wide and a fixture cannot reliably be that one.
`AT_NET_DEBT` exists only because of the correction above: it offers exactly the net debt as read,
which must be refused, and keeps that pinned against the chain rather than against the evaluator's
own arithmetic.

### The sweep that closes it

**Seed `20260826`, 1000 cases, four slices of 250, a fresh anvil per slice at pinned block
15043414.** Reported by direction, because a preview that says go when the chain refuses and one
that says stop when the chain would accept are different defects:

| slice | ran | skipped | FALSE_VIABLE | FALSE_BLOCKED | NUMBERS | threw | exit |
|---|---|---|---|---|---|---|---|
| 0..250 | 250 | 21 | 0 | 0 | 0 | 0 | 0 |
| 250..500 | 250 | 22 | 0 | 0 | 0 | 0 | 0 |
| 500..750 | 250 | 27 | 0 | 0 | 0 | 0 | 0 |
| 750..1000 | 250 | 19 | 0 | 0 | 0 | 0 | 0 |

**And a fifth run over the redemption cases alone, from the same generated set**, because the
headline count could not answer the question that mattered. A skip carries a reason and not an
operation, so "1000 cases, 89 skipped" does not say how many REDEMPTIONS reached the chain, and a
band that never ran proves nothing:

```
MK_DIFF_OP=redeem MK_DIFF_CASES=1000 MK_DIFF_SEED=20260826 pnpm test:fork

ran=123  skipped=40   FALSE_VIABLE=0  FALSE_BLOCKED=0  NUMBERS=0  threw=0  exit=0
  AT_NET_DEBT      ran=19  skipped=10
  AT_HEADROOM      ran=19  skipped=6
  WITHIN_HEADROOM  ran=17  skipped=12
  WHOLE_TROVE      ran=17  skipped=6
  IN_THE_GAP       ran=11  skipped=6
```

**The 19 in the `AT_NET_DEBT` row is the evidence that closes this.** Nineteen times the preview
said the net debt as read is NOT redeemable and nineteen times the chain agreed, on a chain where
the previous version of this preview would have said the opposite.

**Why 40 of 123 skipped, which is a high rate and is not hidden.** Redemption skips for a reason no
other operation has. At the extreme band's price multipliers of 25 and 50 percent, and at the
boundary band's 66, every Trove in the fork's list falls below MCR, so the loop finds nothing, there
is no first eligible Trove, and there is no headroom for a band to sit either side of. The rest are
the ordinary fixture skips the whole sweep has: a seeding open that was not itself viable, or an
account that does not hold what the band needs.

---

## MK-055 · The runbook's tag step re-triggers the release it just finished

**Class** S3 · **Status** fixed in the workflow; the residual constraint is named in the runbook ·
**Found while carrying out the runbook**, at the step that had never been carried out

`docs/12-release-runbook.md` §1 says the release workflow triggers on a manual dispatch "or push a
`v*` tag; the workflow triggers on either." §6 then says, for a release published by dispatch: "The
tag ... `git tag v0.2.0 <sha> && git push origin v0.2.0`."

**Following both in order publishes, then pushes a tag that starts the publish again.** The second
run reaches `pnpm publish` on a version that already exists and fails. Nothing reaches the registry
twice, npm refuses that, so the cost is a red release run in the history of a release that
succeeded, which is the kind of artifact nobody reads twice and everybody misreads once.

**It had never been exercised.** `gh api repos/cayvox/musd-kit/tags` returned 0 before this wave, so
no `v*` tag had ever existed and the trigger had never fired. It is on MK-053's never executed list
for that reason.

**The fix**: the publish job now asks the registry whether the version exists and skips the publish
step if it does, while the verification job still runs. A tag push on an already published version
therefore becomes a **re-verification of what shipped**, which is a useful thing for a tag to do.

**The residual constraint, which the fix cannot remove.** A tag push runs the workflow file *at the
tag's commit*, not the one on `main`. So tagging a commit from before the guard still attempts a
republish. For `v0.2.0`, whose commit `371d5d9953f7f305cba0b4cfd2599e451f91aea8` predates the guard,
the workflow was disabled for the duration of the push and re-enabled immediately after:

```
gh workflow disable release.yml     -> disabled_manually
git push origin v0.2.0              -> refs/tags/v0.2.0 -> 371d5d99...
gh run list --workflow release.yml  -> no new run
gh workflow enable release.yml      -> active
```

Recorded because it is a manual step taken against a live repository, and a reader deserves to know
the workflow was briefly off and why.

---

## MK-057 · The page claimed a keeper liquidated real Troves

**Class** S2 · **Status** fixed · **Found by auditing the landing copy against the tree it describes**

**The claim.** `landing/src/components/Proof.astro:33-34` rendered, under the heading "WHY TRUST
IT":

> **A headless keeper liquidated real Troves.** Core-only, no React. It closed two
> under-collateralized positions and collected the **400 MUSD** reward.

That is a specific factual assertion about an event. It has no transaction hashes on the page and
none in the repository, because the event it describes never happened on any public chain.

**What actually exists**, `packages/core/test/phase9-keeper.fork.test.ts`:

- `:63` the test opens the position it later liquidates, `testAccount(901)`, on a **fork**
- `:80` it then moves the oracle: `fork.setPrice((origPrice * 75n) / 100n)`, a 25 percent drop, to
  push that position under MCR
- `:100-103` it scans with `maxLiquidations: 2`
- `:109` it asserts `result.liquidated.length` is **at least 1**, not two
- `:113` it asserts only that the keeper's balance grew, not that it grew by 400

So: not real Troves, not a real chain, not necessarily two, and the reward is not asserted. The
transaction hashes in the run output are anvil-local and resolve nowhere.

**And the event could not be reproduced live, which the record already said.** The live ledger lists
`liquidate` and `batchLiquidate` as unreachable: "Need a Trove below MCR to exist. Creating one
requires moving the oracle, which is not possible on live testnet"
(`docs/13-live-testnet-ledger.md:164`). The page was claiming, on the strength of a fork fixture,
something the ledger three clicks away says cannot be done.

**Resolution: the claim is rewritten rather than deleted**, because what the test does is genuinely
worth showing. It now says the keeper runs end to end **on a fork**, that the oracle is moved
deliberately to create the precondition, that the protocol pays 200 MUSD of gas compensation per
liquidation, and that it is not reproducible on live testnet. Reproducing it live was considered and
rejected on the evidence: it needs oracle control that testnet does not offer.

### Two more tiles in the same block, same class

**The test count.** The tile read `80+ tests across a forked-Mezo suite`. Measured on this tree: 168
unit tests and 104 fork tests with 1 skipped. The number was stale, and any number there will go
stale again, so it is replaced with something that does not drift: the differential sweep's
**1000 generated cases**, which is a pinned parameter with a pinned seed rather than a count that
grows.

**The gas figure.** The tile read `Δ 0 gas versus near-exact insertion hints on the live sorted
list`. **No instrument for that comparison exists in the repository**, which by
`docs/08-conventions.md` §10 step 10 makes it uncitable. It also predates the gas work: every write
now goes out with a margin. Replaced with the **25 percent margin**, whose derivation and whose
limits are both recorded under MK-035, including which leg of it is `observed once, unlinked` and
which is `unestablished`.

**And a rendering bug found while reading that component.** `landing/src/components/Nav.astro:25`
guarded the star badge with `stars === null`, so a repository the GitHub API reported at 0 stars
rendered a literal `star 0`. Zero is falsy as a number and truthy as a string, so the later
`{starLabel && ...}` checks did not catch it either. An empty social proof is worse than none. The
guard is now `stars === null || stars <= 0`.

---

## MK-056 · A deploy workflow that had never run, beside a site that deploys itself

**Class** S3 · **Status** fixed by removal, with the real mechanism established as far as evidence
from outside the Cloudflare panel allows · **Found by MK-053's never executed audit, then chased**

`.github/workflows/deploy-site.yml` had **zero runs** in its history and could not have run: it
needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, and `gh secret list` shows only
`MEZO_TESTNET_RPC_URL` and `NPM_TOKEN`. `docs/12-release-runbook.md` §4 told a maintainer to run it.

**Meanwhile the site is live and current.** PR 29 merged at `2026-08-28T14:51:02Z` and touched five
files under `docs/`. The live page `musdkit.xyz/docs/12-release-runbook` carries strings that exist
only in that commit: the SHA `371d5d9953f7f305cba0b4cfd2599e451f91aea8`, the run id `33176886491`,
and `MK-055`. Nobody deployed it.

**What is established:**

| | |
|---|---|
| DNS | `musdkit.xyz` NS is `tani.ns.cloudflare.com`, `kayden.ns.cloudflare.com`; A records are Cloudflare anycast |
| Serving | `server: cloudflare`, HTML `cache-control: public, max-age=0, must-revalidate`, `/_astro/` assets `max-age=14400`, which is the Cloudflare Pages static shape |
| Repository | no `wrangler.toml`, no `netlify.toml`, no `vercel.json`, no `_headers`; the build config is not here |
| GitHub | `gh api repos/cayvox/musd-kit/deployments` returns 0, no Environments, no Pages site |

**What is NOT established**, and stated as such: that the mechanism is specifically a Cloudflare
Pages git integration. It is the only explanation consistent with every row above, and confirming it
needs the panel. The `musdkit.pages.dev` probe is worthless in both directions here: the resolver on
this network answers every nonexistent name with `213.14.227.50`, and `1.1.1.1` was unreachable.

**Removed rather than wired**, because wiring it means putting Cloudflare credentials into CI so
GitHub can do a build Cloudflare already does on the same push. Two mechanisms for one deploy drift,
and the one that drifts is the one nobody runs. The ordering the workflow existed to enforce, publish
before deploy, is now enforced by the dependency itself (MK-054).

---

## MK-054 · The site says it reads the published package, and it bundles the local build

**Class** S3 · **Status** open, documented. The claims are corrected where they are made; the build
is not changed here · **Found while verifying the site during the 0.2.0 release**

`.github/workflows/deploy-site.yml`'s header said the deploy happens after the publish "so the hero
`npm install` is real and the live widget reads through the published package." The second half is
false by construction.

`landing/package.json:16` declares:

```json
"@musd-kit/core": "workspace:*"
```

so Astro bundles the LOCAL build into the page. Measured against the deployed site: the widget
bundle at `musdkit.xyz/_astro/PreviewWidget.astro_astro_type_script_index_0_lang.efXbo55R.js` is
3969 bytes, contains SDK symbols inline, and the only external origin it references is
`https://rpc.test.mezo.org`. **It fetches nothing from npm and cannot, because nothing in the page
resolves a registry version.**

The same overstatement is in the user-facing copy. `landing/src/components/PreviewWidget.astro:48`
renders "Read-only via the shipped `@musd-kit/core`."

**Why S3 rather than higher.** The code the widget runs IS the code that was published, byte for
byte, because both are built from the same commit by the same build. Nobody is shown a wrong number.
What is wrong is the claim about provenance: a reader is told the page is exercising the artifact on
the registry, and it is exercising a local build that happens to be identical. That is the same
class as MK-053, one layer up: a property asserted rather than arranged.

### Fixed

`landing/package.json:16` now reads `"@musd-kit/core": "npm:@musd-kit/core@0.2.0"`. The `npm:` alias
forces registry resolution regardless of pnpm's `link-workspace-packages` default, which a bare
`0.2.0` would not: pnpm would have linked the workspace copy anyway and the fix would have been
cosmetic.

Verified rather than assumed. `pnpm-lock.yaml:1971` now carries a tarball integrity hash,
`sha512-V63rwFHlh+sYFSkL6JCC54UjBdIPrN5mBEmOOMApY9HY2DgL22irCMNVmRo4dQreeY0RM6DDFksKukQdDiy50A==`,
which exists only for a registry download. Resolving from inside `landing/`:

`require.resolve('@musd-kit/core')` from inside `landing/` now lands in pnpm's content addressed
store, in the directory keyed `@musd-kit+core@0.2.0`, rather than in `packages/core`. The path is
described rather than pasted because `pnpm check:paths` forbids that literal form in tracked files,
and the guardrail is right to: it cannot tell a quoted path from an import, and weakening it to
quote one would be the wrong trade.

The widget's exact data path, run against the same public RPC the deployed page uses, through that
copy:

```
getOraclePrice -> 77469.065 USD/BTC
previewOpen(1 BTC, 30000 MUSD)
  fee 30   entireDebt 30230   icr 2.562655143896791266   liq 33253   meetsMinimum true
  computeICR and computeLiquidationPrice agree with the client: true, true
```

**The property this buys is not that the bytes changed.** It is that the site can no longer advertise
a version that does not exist: if the version named in `landing/package.json` is not on the registry,
the install fails and the deploy fails with it. The claim is arranged now instead of asserted.

---

## MK-053 · A gate that was trusted because it existed

**Class** S2 · **Status** fixed, and proven by executing it rather than by reading it · **Found by
running the release**, which is the only thing that could have found it

**What was claimed.** `release.yml` carried a `verify-published` job with a comment calling it "the
genuinely POST-publish check", distinguished from `scripts/release-smoke.sh` which "is a PRE-publish
check ... so it cannot catch a bad publish. This job can." `docs/12-release-runbook.md` and the
release reporting treated it as the thing that decides whether a release stands.

**What happened.** On 2026-08-28 the 0.2.0 release ran it for the first time, in
[run 33176886491](https://github.com/cayvox/musd-kit/actions/runs/33176886491). The `publish` job
succeeded. The verification job failed in `Setup Node`, step 3 of 8:

```
Unable to locate executable file: pnpm. Please verify either the file path exists or the file
can be found within a directory specified by the PATH environment variable.
```

All six substantive steps reported `skipped`. **The job produced no verdict about the artifact at
all.**

**Why it could not start.** `actions/setup-node@v5` defaults `package-manager-cache` to true. It
detects the repository's pnpm lockfile, tries to run pnpm to locate the cache directory, and fails
because this job never installs pnpm. The `publish` job installs it at `release.yml:39`, before
`setup-node` at `:46`. The verification job called `setup-node` with no pnpm anywhere.

**And it had never run for the previous release either.** The 0.1.0 release,
[run 27951952166](https://github.com/cayvox/musd-kit/actions/runs/27951952166), has exactly one job,
`publish`. The verification job was added later, during the 0.2.0 preparation. So across the whole
life of this package **two releases shipped behind a post publish gate that had never once produced
a verdict**, and the second one is the first time anybody found out.

**What actually covered this release.** The independent verification run by hand: install from the
registry into a clean directory outside the repository, import under ESM and CJS, typecheck the
registry copy under all four consumer configurations, diff the published file list against the
allowlist, and read the provenance predicate. It passed on every axis, and the provenance attests to
`cayvox/musd-kit`, `.github/workflows/release.yml`, `refs/heads/main`, commit
`371d5d9953f7f305cba0b4cfd2599e451f91aea8`.

**That is worth less than the same checks in CI, and the difference is worth naming.** It ran on
macOS with a locally managed Node, against npm 11.x from that toolchain, in a shell that had this
repository's environment. CI would have run it on `ubuntu-latest` with Node 24.19.0 and npm 11.17.0
in a container that had never seen the workspace. A check that passes on the maintainer's machine is
the weaker of the two, which is the whole reason the job exists.

**The class.** This is not a bug in a formula. It is a gate believed because it was written down,
which is the same class this programme opened with when documentation claimed behaviour the code did
not have, moved one level out: from claims about the product to claims about the machinery that
verifies the product. **A gate that has never executed is a comment.**

### The fix, and why this shape rather than the fast one

The fast fix is one line: add `pnpm/action-setup@v4` to the job. That was rejected. **The value of
this job is that it resolves nothing through the workspace**: it installs from the registry with npm
into an empty directory outside the checkout. Installing pnpm to satisfy a cache probe would add a
tool the job must not use, in order to silence a feature it does not want. `package-manager-cache:
false` says the true thing instead.

The larger change is that it is now a reusable workflow, `.github/workflows/verify-published.yml`,
called by `release.yml` with `needs: publish` and also dispatchable on its own against any published
version. **A gate that can only run as part of the thing it gates cannot be tested**, and that
property is what let this survive two releases. The `publish` job now exposes the version it
published as an output, so the verification checks that version rather than re-deriving it from a
checkout that could have moved.

Two checks were added while it was open, because the original job proved the package imports and
nothing else: the published **file list** against the `files` allowlist, and the **provenance
predicate** against this repository.

**Proven by execution**, which is the point of the entry:
[run 33179723315](https://github.com/cayvox/musd-kit/actions/runs/33179723315), dispatched against
the already published 0.2.0, every step green:

```
verifying the version passed in: 0.2.0
both packages visible at 0.2.0
added 662 packages in 36s
  published ESM ok
  published CJS ok
post-publish verification PASSED at 0.2.0
  @musd-kit/core@0.2.0 file list matches the allowlist
  @musd-kit/core@0.2.0 provenance attests to https://github.com/cayvox/musd-kit
  @musd-kit/react@0.2.0 file list matches the allowlist
  @musd-kit/react@0.2.0 provenance attests to https://github.com/cayvox/musd-kit
```

**What running it standalone does NOT cover** is the wiring in the release path: that
`needs: publish` fires it, with the version the publish job output, after a real publish. Only the
next release exercises that, and it is recorded as owed here rather than assumed.

### The audit this generalizes to: every job and step that has never executed

The same question, asked of every workflow. Counted from the Actions API rather than from reading
the files.

| Workflow | Never executed | Evidence |
|---|---|---|
| `release.yml` | the `verify-published` job | 2 runs total, both `workflow_dispatch`. Absent in the 0.1.0 run; all six steps `skipped` in the 0.2.0 run |
| `release.yml` | the `push: tags: v*` trigger | Both runs are `event=workflow_dispatch`. `gh api repos/cayvox/musd-kit/tags` returns 0 tags, so no `v*` tag has ever existed to fire it |
| `deploy-site.yml` | **the entire workflow** | `gh run list --workflow deploy-site.yml` returns 0 runs. Its `deploy` job, its `confirm == 'deploy'` input gate and its Cloudflare Pages step have never executed |
| `deploy-site.yml` | it could not have run | It needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. `gh secret list` returns only `MEZO_TESTNET_RPC_URL` and `NPM_TOKEN` |
| `ci.yml` | the `Save anvil fork state` step | `skipped` in all 35 runs where the step exists, including run 32706412379 at commit `349c5c2`, the commit that added it. Its condition is `cache-hit != 'true'` and the pinned block has not changed, so the cache has always hit |

**Two of these carry a false claim in the repository, and that is the part that matters.**

`deploy-site.yml`'s header says "0.1.0 shipped this way; 0.2.0 follows the same order." The workflow
has zero runs, so 0.1.0 did not ship that way. `musdkit.xyz` answers HTTP 200 and is served by
Cloudflare, so the site was deployed by some other route, most likely the Pages git integration.
**The comment describes a procedure nobody has used.**

`ci.yml`'s `Save anvil fork state` is MK-029's fix, added so a failed fork gate would still populate
the cache. It has never populated anything. That is not a defect, it is a fallback that has not been
needed, and it is listed because an untested fallback in the release path is exactly what this audit
is for.

**What is NOT on this list**, checked rather than assumed: `ci.yml`'s `checks` matrix and
`fork-gate` job both run on every push; `Upload coverage report` is `if: always()` and runs; the
`Restore anvil fork state`, `Pre-publish smoke` and `Build combined site + check links` steps run
unconditionally.

---

## MK-052 · The live run's "not fatal" redeem step was fatal, and it left a Trove open

**Class** S2 · **Status** fixed · **Found by running it**, on the live testnet run that this wave
was asked to redo

**The promise.** `scripts/testnet-e2e.ts` wraps its optional redemption in a `try` and says so in
capitals: a failure there is "RECORDED, NOT FATAL", because redemption is the one step that races
other participants on a shared chain, and "an optional, flag gated step must never cost the close."

**The mechanism that broke it.** `waitOk` called `die()` on a reverted receipt, and `die()` calls
`process.exit`. **`process.exit` is not an exception, so the `catch` never ran.** The comment
described an intent the code could not carry out, and nothing tested the path, because until this
wave the redemption step had never actually reverted mid-run.

**It is not hypothetical.** It happened, on run 2 of 3 in this wave:

```
--- redeem ---
  redeeming 1.269631779139279519 MUSD
  redeem: 0x53da91c25b894fbec18561e58b7c19af8ef640d123caea8f4b9e7913b08fa7b9
✗ redeem reverted (status=reverted) in 0x53da91c25b894fbec18561e58b7c19af8ef640d123caea8f4b9e7913b08fa7b9
E2E_EXIT=1
```

The run ended there with a Trove open, carrying `2377.660551680821364149` MUSD of debt and
`0.043515238411514662` BTC of collateral. It was recoverable, because the account happened to hold
more MUSD than the close required, and run 3 closed it first
(`0xd7dfb2725df0f86d813966eb7108c0d689dc95c71765069e2969c0843ef94ea5`, block 15168917). **Had the
balance been tighter it would not have been**, because MK-045 means a Trove cannot be closed with
only the MUSD it drew.

**Why S2.** No money was lost and nothing was silently wrong. But this script is a release
precondition, its whole design goal is that a run never strands a position, and it stranded one. A
gate that fails in the specific way it advertises it cannot fail is worth more than an S3.

**The fix.** `waitFor(hash, label, { fatal: false })` returns the outcome instead of exiting, and
the redeem step uses it. `die()` is unchanged for every required step: a failed `openTrove` should
still stop the run.

Two things were fixed alongside it, both found while fixing this one:

- **The step retries once**, with the amount and the hints recomputed, which is MK-049's documented
  mitigation rather than a new idea. Never a loop.
- **The `catch` must not `return`.** The first draft of the fix returned from the catch, which sits
  in the main flow, so it would have skipped the close and reproduced this finding in a new place.
  Caught before it ran; the code now carries a comment saying why.

**And the redemption was sized wrongly, which is why the step had never exercised.** It asked for a
tenth of the account's balance, which is a number about this account, when what a redemption can
take is a number about someone else's Trove. On run 1 that was 221 MUSD against a headroom of 1.27,
so the MK-048 precheck refused it and the step recorded a skip. It now sizes from
`previewRedeem.maxWithoutConsuming`, and run 3 exercised a real redemption for the first time.

---

## MK-051 · The withdrawable maximum expires in a second, and the ledger overstated how it was checked

**Class** S3 · **Status** open, documented, deferred to 0.2.1. The false provenance claim is
corrected now · **Found by the provenance audit that followed MK-048**, asking which numbers in the
record were established by simulation and cited as chain behaviour

**Two defects, and the smaller one is the reason the larger one went unnoticed.**

### The provenance claim was wrong

`scripts/testnet-e2e.ts:426-431` calls this "the strongest single assertion in this script: the
maximum the SDK reports must be ACCEPTED and one wei more must be REFUSED, on the real chain ...
checked against the contract rather than against each other."

`:435-439` then calls `previewWithdrawCollateral` twice, at the max and at the max plus one wei, and
checks the verdicts. **Both are the SDK's own evaluator.** The chain saw neither amount: what was
actually sent, at `:441`, is `max.amount / 4n`. The record at `:456` said "max accepted, max+1
refused, on chain" and `docs/13-live-testnet-ledger.md` repeated it.

The check is worth something. It is the closed form and the evaluator agreeing, which is what
catches a closed form that drifts from its own preview. It is not the contract agreeing with either.

### The quantity expires, which is MK-048's shape with the sign flipped

The max is bounded by ICR against a debt that GROWS with interest, so unlike a redemption headroom,
which grows and therefore only gets safer, this figure SHRINKS. Sent rather than previewed, from one
snapshot, with only the delay varied
(`packages/core/test/withdraw-max-boundary.fork.test.ts`, `pnpm test:fork`):

```
reported max=1711334453538389459 limitedBy=ICR

warp      0s  half=success  max=success                        max+1wei=threw(InsufficientCollateral)
warp      1s  half=success  max=threw(InsufficientCollateral)  max+1wei=threw(InsufficientCollateral)
warp     60s  half=success  max=threw(InsufficientCollateral)  max+1wei=threw(InsufficientCollateral)
warp    600s  half=success  max=threw(InsufficientCollateral)  max+1wei=threw(InsufficientCollateral)
warp   3600s  half=success  max=threw(InsufficientCollateral)  max+1wei=threw(InsufficientCollateral)
warp  86400s  half=success  max=threw(InsufficientCollateral)  max+1wei=threw(InsufficientCollateral)
```

The `half` column is a control, so a column of refusals cannot be read as a boundary when it is
really the fixture failing. **One second is enough.** The reported maximum is accurate for the block
it was computed at and for no block a caller can reach.

**Why S3 rather than S2, and this is the material difference from MK-048.** The SDK refuses it
BEFORE sending: the row says `threw(InsufficientCollateral)`, which is a typed error from the
simulate-before-send path, not a mined revert. **No gas is spent and nothing is silently wrong.** A
caller who offers the reported max gets an error naming the reason. MK-048 was S2 because the
blocking condition lived in a Trove the caller could not inspect and the SDK had no field for it;
here the caller's own position is the constraint and the error is accurate.

**What would close it.** The same treatment MK-048's upper edge got, with the sign reversed: report
the figure alongside the window it is good for, or subtract a margin so the reported number survives
a stated delay. `maxWithdrawableCollateral` returning a number good for one block is defensible only
if the docstring says so.

**Deferred to 0.2.1 with MK-050**, and on the same corrected reasoning: not because the field is
published, since it is not (see MK-050, `maxWithdrawableCollateral` is absent from the 0.1.0
tarball), but because the SDK already refuses the amount before sending, so the caller loses
nothing, and because a margin plus its tests and a sweep is a wave rather than a release
preparation edit.

**Corrected now, because it is a false claim rather than a design choice**: the script's comment and
its record, and the ledger's row, say what was actually checked.

---

## MK-050 · `previewClose.musdRequired` is short by the interest that accrues before the close lands

**Class** S3 · **Status** open, documented. **Registered rather than fixed**, because it is outside
MK-048's scope and changing a shipped field's value is not a release prep edit · **Found by asking
whether MK-048's mechanism has siblings, then reading `BorrowerOperations.sol`**

**The same shape as MK-048, in a different method.** MK-048's defect was a figure read at one block
and handed back to a contract that accrues interest before it reads the same figure. `_closeTrove`
does exactly that, in the same order:

```solidity
function _closeTrove(address _borrower, address _caller, address _recipient) internal {
    ITroveManager troveManagerCached = troveManager;
    troveManagerCached.updateSystemAndTroveInterest(_borrower);          // :945  accrues FIRST
    ...
    uint256 debt = troveManagerCached.getTroveDebt(_borrower);           // :958  reads AFTER
    _requireSufficientMUSDBalance(_caller, debt - MUSD_GAS_COMPENSATION); // :963
    ...
    musdTokenCached.burn(_caller, debt - MUSD_GAS_COMPENSATION);         // :997
}
```

`previewClose` reports `musdRequired = entireDebt - MUSD_GAS_COMPENSATION` at the block it reads
(`previewClose.ts:94`). By the block the close executes in, `debt` at `:958` is larger. **A caller
who acquires exactly `musdShortfall` and then closes is refused at `:963`.**

**Why it is S3 and not higher.** It is a revert, not a loss: `:963` fails before anything is burned
or removed, so the position is untouched and the cost is gas. The overwhelming case is a caller who
holds comfortably more than the figure, for whom nothing is wrong. It bites the caller who mints or
buys the exact shortfall, which is a narrow path.

**It is not hypothetical on this programme.** The live funding run in `docs/13-live-testnet-ledger.md`
minted MUSD to cover a computed shortfall for exactly this operation. It succeeded because the
figure was recomputed at the point of use rather than reused, which is the right habit and not a
property of the API.

**Why the sweep did not find it.** `closeCase` seeds a position and the account keeps whatever the
open drew, which is far more than the shortfall, so the harness has never held exactly
`musdRequired`. `docs/09-review-and-validated-surface.md` now carries this as a row in the
generator's work queue rather than as prose.

**What would close it, and when.** The same treatment MK-048 got: a margin field alongside
`musdRequired` rather than a change to it, plus a `closeBand` in the generator that funds an account
to exactly the reported figure and expects a refusal.

**Deferred to 0.2.1, deliberately, and the reasoning is recorded here so the next wave does not have
to rediscover it.**

**One earlier reason given for the deferral was wrong, and is withdrawn.** It said that changing a
published field's value is not a release preparation edit, because `musdRequired` shipped in 0.2.0.
It did not ship. npm carries `@musd-kit/core@0.1.0` and nothing else, and the 0.1.0 tarball's
`dist/index.d.ts` contains no `previewClose`, no `musdRequired` and no `maxWithdrawableCollateral`:
all three are new in 0.2.0, which is unpublished. **Changing any of them before the publish would
break no consumer, because there are none.** Checked by unpacking the published tarball rather than
by remembering.

The reasons that survive:

- It is derived from source and **not yet observed executing**. Nothing has been measured failing.
- It affects only a close funded to **exactly** the edge, which is a narrow path, and the docstring
  already warns about it, so a caller reading the API today is not misled.
- Closing it properly is a wave, not an edit: a new field, its tests, a `closeBand` in the
  generator, and a sweep to prove it. Doing that between a green tip and a publish is how a release
  acquires an unmeasured change.

**Repayment is NOT affected, and that was checked rather than assumed.** `_adjustTrove:769` accrues
first as well, but the checks that follow move in the safe direction: `:859`
`_requireValidMUSDRepayment(vars.debt, vars.netDebtChange)` compares against a debt that has grown,
so a repay sized from a stale read is still valid, and `:860` checks the balance against the
caller's own chosen amount rather than against a re-read total. A stale read makes a repay smaller
relative to the debt, never larger.

---

## MK-049 · A redemption's partial hint goes stale when the price moves

**Class** S3 · **Status** open, documented. **Retry is the mitigation** · **Found while verifying
MK-048's fix live, and separated from it deliberately**

**What happens.** A redemption that `previewRedeem` says is viable, and that `eth_call` accepts at
head with hints computed in the same breath, can still mine and revert with
`TroveManager: Unable to redeem any amount`.

**It is NOT MK-048.** Measured: at 90% of the headroom the floor has roughly 190,000 seconds of
interest as margin, so the floor condition cannot be what fires. And a repeat of the identical
amount succeeds:

```
attempt 1: RedemptionFailed
attempt 2: SUCCESS  0xbb205c5b2482d12c2eb949d9c322580b6cc2aa965debc98c7a192c7e9e7f7f13
```

**The mechanism.** `_redeemCollateralFromTrove` cancels a partial on three conditions
(`TroveManager.sol:1299-1306`), and only the third is the debt floor. The other two compare the
supplied `_partialRedemptionHintNICR` against the NICR the trove will actually have:

```solidity
_partialRedemptionHintNICR < vars.newNICR ||
_partialRedemptionHintNICR > vars.upperBoundNICR ||
```

`HintHelpers` computes that NICR from the collateral remaining after the redemption, which it derives
at the price it read (`:148`). The contract derives it at the price when the transaction MINES
(`:1224-1226`). **If the price moves in between, the two NICRs differ and the partial cancels.** The
contract allows a band for interest, `upperBoundNICR` using `block.timestamp - 600` (`:1276-1285`),
but that band is for accrual, not for the oracle.

**Why a fork cannot show it.** anvil holds the price still unless a test moves it, so the hint price
and the mining price are always identical. This needs a live oracle.

**Not a preview defect, and not fixable by a preview.** Whether the price moves between the hint and
the block is not a function of any state a preview can read. `RedemptionFailed`'s docstring already
named "a stale hint" as one of its two causes; what is new is the live evidence and the measurement
that separates it from MK-048.

**Mitigation, and its cost.** Retry: the second attempt succeeded at the identical amount. The SDK
does NOT retry automatically, deliberately, because a retry is a second transaction and spending a
caller's gas without asking is not the SDK's decision to make. This is documented on `redeem` in
`docs/03-core-api.md` so a caller builds the retry rather than discovering the need for it.



---

## Open questions and their answers

| # | Question | Answer |
|---|---|---|
| Q1 | Does the contracts package version we pin differ from the one Mezo's dApp resolves? | Closed. Across both testnet and mainnet deployment sets, no contract address changed between the two versions, including the hint helpers, sorted troves, and interest rate manager. What changed: proxy implementation targets behind three contracts, one removed function and one changed event signature on the trove manager, and a set of new functions on the PCV. The SDK touches none of those surfaces. |
| Q2 | Is the fee exempt set non empty on chain? | Closed. **Yes on mainnet, no on testnet.** At mainnet block 11330182 two accounts are fee exempt, out of four granted over the chain's history with two since removed; both are code free and neither matches any address the protocol is known to own. At testnet block 15043414 the set is empty. Established by a genesis to pin scan of `FeeExemptAccountAdded` and `FeeExemptAccountRemoved`, every granted address then re-checked against `isAccountFeeExempt` at the pinned block. This assigns MK-018 its class, S1. Recorded in `docs/09-review-and-validated-surface.md` §6. |
| Q3 | Which contract revision is ground truth? | Closed. The right question is which implementation sits behind each proxy on chain, and it now has an answer: at testnet block 15043414 and mainnet block 11330182, the EIP-1967 implementation behind every bundled proxy matches the deployment record in `@mezo-org/musd-contracts@1.1.0`, the version `packages/core/package.json` actually pins, on both chains. Six of the seven bundled addresses are proxies of that shape; `musd` has an empty implementation slot, so it is not a transparent proxy of that shape and there is nothing to compare. So the pinned package IS ground truth for the deployed code at those blocks. Recorded in `docs/09-review-and-validated-surface.md` §6. |
| Q4 | Does the SDK bundle a mainnet interest rate manager? | Yes. It is present in the source and in the published package, and matches both the contracts package deployment record and Mezo's own literal. No gap here. |
