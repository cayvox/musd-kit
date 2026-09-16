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

## What is open right now

**Read this first, and the history below only if you need it.** As of **0.5.0, published 2026-09-16 from
`92d8067`**, this register holds **142 entries** and **20 of them are not closed**. This section is an
INDEX of that state, not a revision of it: every line points at the entry, which is where the evidence,
the class and the wording live, and none of them is restated or reclassified here.

**No S1 is open.** All 19 silently wrong number findings are fixed. **Three of them closed in 0.5.0**:
MK-240, MK-241 and MK-242. The S1 before those was MK-114, fixed in 0.4.1. **MK-247 came from the same
audit and is S2, not S1**, which an earlier wording of this line obscured by counting four.

**S2, two.**

| ID | One line | Where it stands |
|---|---|---|
| MK-011 | `maxFeePercentage` is advisory only, so a fee cap does not cap what the protocol charges | documented, a protocol property rather than an SDK defect |
| MK-079 | The sweep's harness compared a preview of one call against execution of another whenever a debt leg was zero | open in the harness. The filter that caused it is gone with MK-254, and the entry stays open until a full sweep at a tip carrying that change reports the shape absent |

**S3, eighteen.** Grouped by what a reader would do about them.

| ID | One line | Where it stands |
|---|---|---|
| MK-016 | The suite was one stateful sequence with an unpinned fork | open, superseded in practice by the pinned block and the project split; the entry says what remains |
| MK-022, MK-023, MK-024, MK-025, MK-026, MK-030 | Six intermittent fork and coverage failures from the phase 5 and 6 waves | open, each with its observed signature; none has reproduced since the harness was pinned |
| MK-034 | Two different redemption failures were folded into one entry, now split by evidence | open, kept as the record of the split |
| MK-045 | A Trove cannot be closed with only the MUSD it drew | documented, a protocol property; it is why the live script funds a margin |
| MK-050 | `previewClose.musdRequired` is a snapshot the chain has outgrown by the time a close lands | open, documented, deferred |
| MK-051 | `maxWithdrawableCollateral` reports a figure that stops being withdrawable a second later | open, documented, deferred. MK-253 is the release gate's version of the same knife edge, and is fixed |
| MK-120 | The closed form solver's 64 step bound and its infeasible seed guard are unreachable | open, left in place and stated |
| MK-121 | `REDEMPTION_MARGIN_WINDOW_SECONDS` names a window nothing reads | open, left in place and stated |
| MK-248 | `GasDecision` documents an `explicit` branch no public write can reach | open |
| MK-249 | `StaleHint` and `Unauthorized` are exported and never thrown | **open in the source, and 0.5.0 ships it.** The entry states why that pair shipped and what would close it |
| MK-250 | A write whose simulation reverts still logs that it is sending without a margin | open |
| MK-251 | Two React claims are stronger than the rendered behaviour | open |
| MK-255 | Three of the five deprecation messages send a reader to a version that is itself deprecated | **open, carried deliberately.** The entry states what it costs a consumer on each version, and closing it is eight registry writes |

**What closed most recently, counted from the table.** **0.5.0 closed nine entries**: MK-240 to MK-247,
which is eight, and MK-252, found while verifying the release and fixed before it published. **The release
itself produced five more**: MK-253, MK-254, MK-256 and MK-257, all four fixed in the closing wave, and
MK-255, carried and still open.

**How to read an ID.** IDs are permanent and never reused, and the numbering is not dense. **Three
stretches are used: 1 to 121, 237 to 239, and 240 to 257.** 1 to 121 are the waves up to 0.4.1; 237, 238
and 239 came from the review of pull request 42 and the re-runs it forced, about the tools the checklist
declares, the fork cache anvil 1.7.1 writes, and a fork window that passed with half its differential
cases thrown; 240 to 257 are the 0.4.1 consumer audit and everything it produced. **The single gap is 122
to 236, 115 numbers, and nothing is missing from it.** An earlier wording of this line put the gap at 122
to 239, which denied three entries that exist.

## What the next release must contain

**This list is the register's own closing conditions, gathered, not a new plan.** Each item names the
finding it closes and quotes what that finding says closing it requires. It exists because the previous
version of this list lived in a pull request body and a chat, and this programme has three entries about
exactly that shape: MK-053, a post publish gate that had never executed once across two releases while
being presented as part of the posture; MK-080, a sweep documented as scheduled while no `schedule:`
trigger existed anywhere; and MK-083, a runbook that told a reader to run two commands a workflow already
performed. **A thing that is true only in a conversation stops being true when the conversation ends**, and
a list of what the next release owes is exactly that kind of thing.

**Five of the twenty open findings state what would close them. Fifteen do not, and that is said here
rather than filled in.**

| Finding | Class | What closing it requires, from the register |
|---|---|---|
| MK-079 | S2 | A full sweep at a tip carrying MK-254's change that reports no mismatch of the zero debt leg shape and no `EXPECTED-BUT-ABSENT` line. Stated in MK-254's entry, which also says why the 0.5.0 sweep is not that evidence: its ten disappearances were measured BEFORE the harness filter was removed, so they are evidence about MK-244 |
| MK-249 | S3, source | Either a path that throws `StaleHint` and `Unauthorized`, which for `StaleHint` needs a distinct revert reason the protocol does not give (`TroveManager.sol:406-409` is one reason for both an empty redemption and a stale hint), or their removal together with `STALE_HINT` and `UNAUTHORIZED` from `MusdErrorCode`, registered in the next breaking release's migration guide BEFORE that release's checklist is run, with `phase7.fork.test.ts:174-177` updated in the same change |
| MK-255 | S3, registry | Rewrite the 0.1.0, 0.2.0, 0.3.0 and 0.3.1 deprecation entries to point at a version that is not itself deprecated, preserving each previous text in `scripts/deprecation-message.mjs` as 0.4.0's is, dispatch `deprecate.yml` once per version, verify each with `scripts/deprecation-verify.mjs`, then widen `deprecation-message.test.ts` from the two entries it covers to every entry |
| MK-050 | S3 | The treatment MK-048 got: a margin field alongside `previewClose.musdRequired` rather than a change to it, plus a `closeBand` in the generator that funds an account to exactly the reported figure and expects a refusal |
| MK-051 | S3 | The same treatment with the sign reversed: report `maxWithdrawableCollateral`'s figure alongside the window it is good for, or subtract a margin so the reported number survives a stated delay. A number good for one block is defensible only if the docstring says so |

**The fifteen with no written closing condition**, listed so nobody reads their absence as nothing to do:
MK-011 and MK-045 are recorded protocol properties rather than defects to fix; MK-016, MK-022, MK-023,
MK-024, MK-025, MK-026, MK-030 and MK-034 are the phase 5 and 6 harness entries, none of which has
reproduced since the fork block was pinned; MK-120, MK-121, MK-248, MK-250 and MK-251 are small source
and documentation gaps left in place and stated. **Writing a closing condition for any of them is itself
work a wave has to do, and inventing one here would be the same error this section exists to prevent.**

**Two things this list deliberately does not contain.** A release date, because nothing here is
scheduled. And the fork half of the mutation gate, which has never run in CI on a release commit: it runs
on the Sunday schedule or a dispatch (`.github/workflows/mutation.yml:120`), so it is a precondition to
execute, `docs/12-release-runbook.md` precondition 9, not a finding to close.

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
| MK-049 | A redemption's partial hint goes stale when the oracle price moves, so a correct call can still revert | S3 | **reclassified by MK-103.** The class understated it and retry is not a mitigation at the measured survival rate |
| MK-050 | `previewClose.musdRequired` is a snapshot the chain has already outgrown by the time a close lands, so holding exactly it is refused | S3 | open, documented, deferred to 0.2.1 |
| MK-051 | `maxWithdrawableCollateral` reports a figure that stops being withdrawable one second later, and the ledger recorded a preview-against-preview check as chain verification | S3 | open, documented, deferred to 0.2.1. The provenance claim is corrected |
| MK-052 | The live run's optional redeem step could kill the run and leave a position open, because a reverted receipt reached `process.exit` instead of the `catch` that promised to absorb it | S2 | fixed. It happened, on a real run, and cost a close |
| MK-053 | The post publish verification gate had never executed once, for either release, while being presented as part of the supply chain posture | S2 | fixed and proven by running it. The never executed audit it generalizes to is in the entry |
| MK-054 | The landing page's live widget says it reads through the shipped package; it bundles the workspace build | S3 | **fixed.** The landing now depends on `npm:@musd-kit/core@0.2.0`, so the build resolves the registry copy and fails when the version is not published |
| MK-056 | A deploy workflow that had never run and could not run, sitting beside a site that deploys automatically some other way | S3 | fixed by removing it and establishing how the site actually ships |
| MK-057 | Landing page copy asserted a live keeper event, a test count and a gas figure the repository could not back | S2 | fixed. The keeper claim described a fork run with a moved oracle as if it had happened on chain |
| MK-055 | The runbook tells you to push a `v*` tag after publishing, and the release workflow triggers on `v*` tags, so the documented path re-runs the publish | S3 | fixed in the workflow, and the interaction is named in the runbook |
| MK-058 | `evaluateBorrow` omits the Recovery Mode rule that a debt increase must not lower the Trove's ICR, so a Recovery Mode borrow previews as viable when the contract accepts none | S1 | **fixed at the cause.** `previewBorrow` is now a projection of the adjust preview, and the two are pinned to agree in both modes across every boundary |
| MK-059 | `evaluateBorrow` applies a TCR gate unconditionally, and the contract has no TCR gate on the Recovery Mode adjust path | S1 | fixed by the same delegation as MK-058 |
| MK-060 | The debt increase flag is read from presence in the write path and from value in the evaluator, so `ZERO_DEBT_INCREASE` is unreachable and a zero borrow reaches the contract as a debt increase | S2 | fixed by making both halves agree, and `adjustTrove` validates its borrow leg. **Amended by MK-244**: they agreed on PRESENCE until 0.5.0 and agree on VALUE now, derived once by `adjustLegsOf`, so a zero leg is no leg on both sides; `previewBorrow` is the one caller that still states the flag itself |
| MK-061 | The claims table says the post publish gate has never run, and MK-053 and the same document's own verdict say it has | S3 | fixed, **and two more rows in the same table were stale the same way** |
| MK-062 | The provenance index's differential sweep row misreports the skip count and the slice count | S3 | fixed, and the third copy of the stale slice count is corrected too |
| MK-063 | Six S2 entries read `open` in their own header and `fixed` in the summary table | S3 | fixed for the ten entries whose body settles it. Two more contradict in the other direction and are named rather than rewritten |
| MK-064 | An untracked agent settings directory turns `pnpm lint` red on a clean checkout, invisibly to `git status` | S3 | fixed, and the fix is verified by reproducing the failure and then removing it |
| MK-065 | `evaluateBorrow` orders its reasons so `bindingConstraint` names a gate the contract checks later than the one that actually binds | S2 | fixed by the same delegation, and the test that pinned the wrong order is corrected |
| MK-066 | Two error paths were covered only by whichever cases the sweep's generator happened to draw, so an unrelated dimension moved the coverage ratchet | S3 | fixed by covering them deterministically |
| MK-067 | `getBorrowingPower` adds a borrowing fee the contract skips in Recovery Mode and for an exempt account, and takes no account so exemption is inexpressible | S1 | fixed. The predicate is now the open evaluator, so the rule has one implementation rather than two |
| MK-068 | The `openTrove` write path calls the raw fee getter while its own file defines and uses an effective one on every other write | S2 | fixed. Three consequences, the debt floor, the fee cap and the hint, closed together |
| MK-069 | One rule decided in eight places, four of them wrong the same way, with nothing structural preventing it | S2 | **fixed at the cause.** Every decision site routes through `isBorrowingFeeCharged`, and the two surfaces that answer one question are pinned to agree |
| MK-070 | The Recovery Mode borrowing power assertion reconstructs the implementation's own arithmetic, so it proves self consistency and FAILS when the defect is fixed | S2 | fixed. It now opens on chain at the reported maximum and refuses one wei more |
| MK-071 | `previewRedeem` shadows `SECONDS_PER_YEAR` with 31_536_000, the value `constants.ts` explicitly names as wrong | S3 | fixed by deleting the shadow and importing the canonical constant |
| MK-072 | `BorrowingCapacity.remaining` is the headroom to exactly the liquidation threshold, published with no window and no margin | S3 | fixed on the field, where TypeDoc publishes it |
| MK-073 | MK-051 names the docstring as its acceptance condition and the docstring never said it | S3 | fixed |
| MK-074 | The last Trove in the system can neither be closed nor liquidated, and `previewClose` and `isLiquidatable` both say it can | S3 | fixed |
| MK-075 | `previewRefinance` reports its reasons in an order its own adjacent comment says it does not use | S3 | fixed, and given the mutation MK-065 never got |
| MK-076 | `computeMaxWithdrawable.limitedBy` reports `ICR` whenever the answer is zero, including when the system ratio is what binds | S3 | fixed |
| MK-077 | `previewAdjustTrove` silently drops a repayment leg that the write path rejects | S3 | fixed with a reason, labelled as SDK input validation rather than a contract gate |
| MK-078 | ~~The tenth sweep operation costs 245s per case, so no slice of the documented sweep finishes~~ | S2 | **claim-corrected, WITHDRAWN.** The sweep runs: 4 slices, 1000 cases, 116 minutes of wall clock. The 245s was a measurement of a degraded upstream RPC, and it was never repeated before being published |
| MK-083 | The runbook documented two shell commands for an action a workflow already performed, built to replace them for a stated security reason. The documented version never ran | S2, process | fixed. §3 is the workflow now, and the conventions checklist gained the check that detects the family |
| MK-084 | `deprecate.yml` takes the version as an input but hardcodes 0.1.0's message text, so dispatching it for any other version writes a false message to the registry | S2 | **fixed.** The message is chosen by version from a reviewed set in `scripts/deprecation-message.mjs`, still not an input. An unknown version, and a message that does not describe its version, are both refused before any credential is in scope |
| MK-081 | The push subset's warm cost was published as CI's, from a measurement taken on a developer machine. CI is 2.4 times faster | S3 | fixed. Both figures published, each naming the machine it was measured on |
| MK-082 | The wave checklist's five run command does not pin the fork, and the same checklist requires the five answers to be byte identical | S3 | fixed. The checklist row and the recipe both carry `MEZO_FORK_BLOCK` now |
| MK-080 | `docs/07-testing.md` has said since 2026-08-27 that the full sweep runs "on demand and on a schedule". No `schedule:` trigger has ever existed in any workflow, on any branch | S2 | fixed. `.github/workflows/sweep.yml` wires it weekly, and a full sweep against the released tree is now precondition 7 in the release runbook |
| MK-079 | The sweep compares a preview of one call against execution of a different one whenever a debt leg is zero, so it reports 10 FALSE_BLOCKED that are its own defect | S2 | **open** in the harness. **Amended by MK-254**: this row said the mismatch is registered in `packages/core/test/differential/expected.ts` and prints as `EXPECTED MK-079`, and that stopped being true when MK-254 emptied that list and removed the filter in `adjustCase` that made the two calls differ, so the sweep now fails on ANY mismatch including this shape. The entry stays open until a full sweep at a tip carrying that change reports no mismatch of the shape and no `EXPECTED-BUT-ABSENT` line. **The claim that no `packages/*/src` file is implicated was FALSE and is withdrawn**: the same mis-mapping was in the React adjust preview hook, which is MK-085, and why nobody looked is MK-086 |
| MK-085 | `useAdjustTrovePreview` defaults all four legs to `0n` and forwards them, so through the hook every adjustment is a debt increase: a pure top-up is refused and a pure repayment is refused with its debt and ICR reported as though nothing were repaid | S1 | **fixed at the cause.** The legs are built once, keeping an absent leg absent, and drive both the query key and the call, pinned by the repository's first rendered hook test. **Amended by MK-244**: the verdict now reads the legs by value, so what absence decides here is the cache key rather than the answer, and the two mutations this row cited were withdrawn with the presence behaviour (MK-252) |
| MK-086 | The decision-site enumeration MK-069 established was applied to `packages/core` only, so MK-079 and the README assert that this mapping defect implicates no source file, and it does | S2, process | fixed. The claim is withdrawn in both places, and an enumeration is now scoped to the rule rather than to the directory the defect was found in |
| MK-087 | The coverage gate, the mutation check and the differential sweep all stop at the core boundary, which is why eighty four findings contain nothing about the React package | S2, process | fixed. React is inside coverage and the mutation check, the floor is re-measured at the honest lower number, and the sweep's exclusion is stated rather than implied |
| MK-088 | `previewRedeem` sizes its accrual margin from the REDEEMER's Trove rate, with a hardcoded `100n` when the redeemer holds none, and swallows a failed read into the same default | S1 | **fixed.** Each Trove in the walk carries its own principal and rate, read in the batch that already fetches its debt; the fallback and the `catch` are gone |
| MK-089 | The protocol's interest formula is implemented twice and the copies disagree about the base, one on principal and one on entire debt | S2 | fixed. One `accruedInterest`, two callers, and the test that pinned the constant no longer reuses the wrong base |
| MK-090 | The public `computeNICR` and `computeHints` instruct the caller to pass the entire debt, which is the quantity MK-006 was filed about; every internal call site was already correct | S2 | fixed. The parameter is `principal` at the public boundary too, and the rename turned fourteen stale call sites into compile errors |
| MK-091 | `close()` computes `LAST_TROVE_IN_SYSTEM` and sends anyway, and the revert maps to no typed error | S2 | fixed. A typed `LastTroveInSystem` from the precheck with the two counts on it, and from the decoder for a caller who skipped the preview |
| MK-092 | `getBorrowingPower` published "one batch, three round trips" and issued six reads, with `getBorrowingFee` called twice on the same argument | S3 | fixed. The price joins the batch, the confirmation fee is reused, and the counts are pinned by five tests |
| MK-093 | MK-013's exemption is conditional on these functions making no single block snapshot claim, and `getBorrowingPower`'s docstring made one; the exemption list is also two waves stale | S2 | fixed. The claim is gone, the straddle is disclosed at every affected function, and MK-013 names all eight |
| MK-094 | Nine protocol rules decided more than once, two of them already diverged | S2 | fixed for seven by single sourcing; two are prose with no compiler and are labelled as the weaker control they are |
| MK-095 | The redemption accrual margin was sized for exactly the window it advertises, so it covered the read but not the block the transaction settles in. It only ever worked because the wrong base over-stated it by about 6 seconds of accrual | S2 | **fixed.** Sized for 900 seconds against an advertised 600, with the reason named and both ends of the claim still asserted on chain |
| MK-096 | The packaging gate's consumer probe is a template literal, so no typecheck in the repository compiles it, and the only thing that does is a gate CI does not run | S2, process | **fixed.** The probe is updated and `pnpm gate:packaging` is a CI step, so a breaking public shape change fails on the commit rather than at release time by hand |
| MK-097 | The version step's verification list checks what the command produced and not what the commit must pass, so `changeset version`'s reformatting of the manifests turned `main` red at the commit the release was about to ship | S2, process | fixed. The list gains the standing checklist, and the repair is recorded with its cost: a red `main`, a repair commit, and a second sweep requirement |
| MK-098 | The version step's changeset table names three entries against the four actually consumed | S3 | fixed by naming the command that produces the list instead of copying the list |
| MK-099 | Precondition 7's How column says dispatch while its What passed column says head plus success, and a scheduled run on the release commit satisfies the second | S3 | fixed. The condition is stated in full as head, parameters, coverage and green; the trigger event is not part of it |
| MK-100 | `getBorrowingPower` returns the liquidation threshold as the amount to borrow: in normal mode a Trove opened at it is liquidatable within seconds, and every earlier check asked only whether the open is accepted | S1 | **fixed** in 0.4.0, published 2026-09-14 from `252af4b`; 0.3.0 and 0.3.1 deprecated. Two named figures, `ceiling` and a `recommended` draw with a measured margin; `useBorrowingPower` returns `recommended`. Proven on a fork after the open, not only at it. 0.3.1 carried the warning **Superseded by MK-240**: the margin answered the delay before a send, and was published as the amount to hold |
| MK-101 | `previewRefinance` omits the interest rate a refinance moves the Trove to and the borrowing capacity it resets, and five surfaces say capacity only ever ratchets downward | S1 | **fixed.** The preview reports both rates and both capacities; every ratchet claim corrected |
| MK-102 | The React read hooks present the previous query's data as a success after the key changes or the query is disabled, so a cleared input or a disconnected wallet keeps showing the old verdict | S1 | **fixed.** No placeholder, `gcTime: 0`, a disabled query reports nothing, writes reset on an account change; rendered tests for every hook |
| MK-103 | A partial redemption sent through `redeem()` cancels on almost any price move before inclusion, and `previewRedeem` reports it viable with no price condition. Supersedes MK-049's class and its retry mitigation | S2 | **fixed as far as the contract allows.** Centred hint, tolerances reported, a fragile first-Trove partial refused by default. Sizing a partial to survive is not practical, measured |
| MK-104 | `redeem()` refuses the `nextViableAmount` that `previewRedeem` reported one block earlier, because it re-applies the accrual margin to a figure that already includes it | S2 | **fixed.** A 60 second sending margin; the advice is accepted through `redeem()` after 1, 60 and 600 seconds |
| MK-105 | Protocol reverts raised outside the simulate path, a stale oracle among them, reach the caller as untyped viem errors while the README and the React types promise a `MusdError` | S2 | **fixed.** Every client method and exported preview maps; pinned against the real stale `PriceFeed` revert on thirteen surfaces |
| MK-106 | Omitting `account` makes the open preview and the borrowing power calculator assume the caller is not fee exempt, and the React hooks never default it to the connected wallet | S2 | **fixed** in the React hooks. The core default stays documented: a core call has no wallet context to default from |
| MK-107 | `previewRedeem` charges `maxIterations` for the sub-MCR Troves the contract skips for free before its loop, so it reports `NOTHING_REDEEMABLE` for redemptions the chain accepts | S2 | **fixed** |
| MK-108 | The quickstart npm renders does not compile, and gates the open on `meetsMinimum` instead of `viable` | S2 | **fixed.** The packaging gate compiles the quickstart out of the packed tarball |
| MK-109 | Documentation and shipped surface disagree: a documented `getPeg` that does not exist, a write count and precheck claim in the packaged README that are false, stale React docs and types, and missing React re-exports | S3 | **fixed**, item by item, with `liquidationPrice`'s rounding documented |
| MK-110 | Three pins in the P21 wave checked nothing while green: a mutation entry that drifted onto a different line, a test that could not see the defect it was named for, and a computation no fixture could tell apart from its defect. The mutation gate runs only the mutations it lists, and nothing runs it but a person | S2 | **fixed for the three**, and a mutation row added to the wave checklist. **The class can recur**: see the entry |
| MK-111 | The 0.3.0 release record, including three registered findings, sat on a pull request that was never merged, so `main` showed a live run for 0.2.0 only and a register that skipped from MK-096 to MK-100 while 0.3.0 and 0.3.1 were published | S3, process | **fixed.** The record is carried onto `main`; the runbook keeps the ledger per release and checks the previous record on `main` as precondition 8 |
| MK-112 | The mutation gate checked only the mutations it listed, so a decision with no entry was never put to it, and no workflow ran it. Its own measure of the gap, entries against test call sites, was the wrong one: the honest measure is decision sites against the sites a mutation reaches, 58 of 474 at `870b76f` | S2, process | **fixed.** One generated mutant per decision site in both packages, each with a reviewed status in `scripts/mutation/sites.json`; the survivors registered under MK-118 to MK-121; CI runs it on every push and weekly, and the full gate is release precondition 9 |
| MK-113 | The live run's close parity check demanded exact equality between `previewClose` and a `getTrove` read taken after it, so it failed whenever the two landed in different blocks, and the 0.4.0 run died with a Trove open while both figures were right | S3, instrument | **fixed.** It uses MK-046's accrual bound, as the other debt checks already did |
| MK-114 | `previewRedeem` treats `maxIterations: 0n` as a walk of one eligible Trove, while the deployed contract treats zero as no limit, so the preview reports less than the chain redeems and `redeem()` prechecks only the first Trove of a call the chain walks without limit | S1 | **fixed, published in 0.4.1**, and 0.4.0 deprecated for it. Zero is no limit in the preview and the write, matching the contract; a value outside `uint256` throws. The same question was asked of every sentinel the SDK forwards, and this was the only one it restates |
| MK-115 | `main` went red at the 0.4.1 version commit twice, both times before any test, because `foundryup` could not download the pinned Foundry's attestation (HTTP 504); nothing in the repository was implicated | S3, CI infrastructure | **fixed by re-running** the failed job; the third attempt passed all four jobs. Registered after the re-run, in the release record, and the entry says why |
| MK-116 | The hand written entry for MK-071 was caught only by tests whose names do not cite MK-071, so a red run could not be traced to the finding it guards | S3 | **fixed.** A test named for it, and the gate fails any entry caught only by tests that do not cite it |
| MK-117 | The hand written entry for MK-095 was caught only by tests whose names do not cite MK-095 | S3 | **fixed**, as MK-116 |
| MK-118 | 474 decision sites, of which the hand written mutation entries reached 58 before the P25 wave; the first run of one mutant per site found 119 caught by nothing, and after the wave none is uncaught | S3 | **fixed.** 85 test gaps pinned, 29 equivalent mutants proven, 5 unreachable sites stated; no survivor was a shipped defect |
| MK-119 | The fallback that protects `getBorrowingPower` from a non linear fee, which MK-010 asked for and `docs/09` relies on, had no test: the closed form's answer could be accepted under any fee and nothing noticed | S3 | **fixed.** A test with a fee that is not linear |
| MK-120 | The closed form solver's 64 step bound and its infeasible seed guard are unreachable: the walk takes at most one step and the seed is always feasible | S3, source | **open**, left in place and stated |
| MK-121 | `REDEMPTION_MARGIN_WINDOW_SECONDS`, the constant that names the 600 second window a redemption answer is advertised for, is used nowhere, so the window exists only in prose | S3, source | **open**, left in place and stated |
| MK-237 | The standing checklist required the fork gate's Node version and none of its other tools, so the P25 fork evidence was taken on anvil 1.5.1 against a gate that declares 1.7.1, and the rule allowed it | S3, process | **fixed.** Row 2 names every declared tool version; the evidence was re-run on 1.7.1 |
| MK-238 | anvil 1.7.1 writes the fork cache Zstandard compressed under the same name, and the mutation gate rejected it as unparseable, so on the version CI declares every fork mutant would have started cold | S3, instrument | **fixed.** The gate decompresses a compressed snapshot before parsing it |
| MK-239 | The differential fork test passed with 12 of its 24 cases thrown on an RPC failure, because a thrown case is recorded and nothing asserted afterwards that none threw | S2 | **fixed.** The test asserts no case threw, after every case has run |
| MK-240 | `recommended` is sized for the delay before a send, and `useBorrowingPower` and both READMEs publish it as the amount to borrow and hold; a Trove opened at it is liquidated by a 2 percent fall | S1 | **fixed.** No default: `getBorrowingPower` is the ceiling alone, and `drawForMargin` requires a horizon and a fall; the horizon table is reproduced from a committed instrument and published where a caller chooses |
| MK-241 | `RedeemResult` reports the hint helper's figures rather than what settled, so a redemption that cancels a later partial reports an amount and a fee it did not have | S1 | **fixed.** `redeem()` resolves on the receipt with `settled` from the `Redemption` event; the estimate is named as taken before sending, from the walk |
| MK-242 | A collateral withdrawal permanently lowers borrowing capacity, adding the collateral back does not restore it, and no preview discloses the change | S1 | **fixed.** `capacityAfter` on every withdrawal preview, with the refinance that would restore it, proven to the wei by sending |
| MK-243 | One contract ratio gate reaches the caller as `InsufficientCollateral` from the precheck and `ICRBelowMCR` from the decoder, and the register names the one the precheck does not throw | S2 | **fixed.** `ICRBelowMCR` and `RecoveryModeRestriction` from both paths; `InsufficientCollateral` names only an over-withdrawal; the register line is annotated |
| MK-244 | `adjustTrove` refuses zero valued legs by presence while the contract checks values and the preview calls the same input viable | S2 | **fixed.** Legs by value through one resolver and one shape helper; MK-060's presence ruling for this path reversed with its reason; every absent against zero site enumerated |
| MK-245 | `previewRedeem` omits the last Trove rule a whole consumption reaches, so a redemption the chain reverts previews as viable | S2 | **fixed.** The walk carries both counts and the mint list flag; `redeem()` refuses before gas |
| MK-246 | Claims retired by closed findings survive in the published declarations and in this register, and no gate reads the artifact for them | S3 | **fixed.** Corrected in what ships, a whole declaration review found seven more, and `scripts/retired-claims.mjs` reads the packed artifact in the packaging gate |
| MK-247 | `useMaxWithdrawableCollateral` is documented as the max button's number, a figure that leaves the Trove at the liquidation threshold | S2 | **fixed.** Documented as a limit, not a withdrawal to send |
| MK-248 | `GasDecision` documents an `explicit` branch no public write can reach | S3, source | open |
| MK-249 | `StaleHint` and `Unauthorized` are exported and never thrown | S3, source | **open in the source, and 0.5.0 ships it**: both classes and their `MusdErrorCode` members remain, nothing throws either, and the declarations and both docs now say never thrown. The entry states why that pair ships and what would close it |
| MK-250 | A write whose simulation reverts still logs that it is sending without a margin | S3 | open |
| MK-251 | Two React claims are stronger than the rendered behaviour: a same tick restore serves the old answer, and a wallet switch reports a missing wallet client | S3 | open |
| MK-252 | Two shipped TSDoc comments still say the preview and the write path read the debt flag from PRESENCE, which MK-244 retired in the same release, and the MK-246 check had no entry for that wording | S3, docs | **fixed** before 0.5.0 was published: both comments corrected and the claim added to `RETIRED_CLAIMS`, so the shipped artifact is checked for it |
| MK-253 | The live release gate asserts `maxWithdrawableCollateral` against its own preview across two reads, a boundary with 0.349 bps of margin on a chain that moves 1.08 bps between blocks, and a lost race exits before the close and leaves a position open | S2, process | **fixed.** The price is read either side and a move is attributed and retried; a fatal mismatch is recorded and fails the run AFTER the close |
| MK-254 | The sweep's expected set still registers the ten MK-079 mismatches, which MK-244 made impossible: the 0.5.0 sweep reported all ten as EXPECTED-BUT-ABSENT | S3, tests | **fixed.** The list is empty, so every mismatch fails the sweep, and the harness filter that produced the shape is gone; the mechanism stays pinned against a fixture |
| MK-255 | Three of the five deprecation messages send a reader to a version that is itself deprecated, 0.1.0 to 0.2.0 and 0.2.0 to 0.3.0 among them | S3, registry | **open, carried deliberately.** Closing it is eight registry writes and this wave deprecates nothing; the entry states what carrying it costs a consumer on each version and what would close it |
| MK-256 | The deprecation workflow verifies its write by reading `npm view`, retries only an EMPTY answer, and so fails a successful re-deprecation; the re-dispatch that would fix the colour then fails with E422 because nothing is left to change | S2, process | **fixed.** `scripts/deprecation-verify.mjs` reads the registry document and retries the previous text too, the write tolerates a no-op whose text already matches, and both are pinned |
| MK-257 | Three post publish checks ran only because a person remembered them: the retired claims check over the published tarball, the provenance statement beyond its repository line, and the README npm serves against the one shipped | S2, process | **fixed.** All three are steps in `verify-published.yml`, each failing the job, and the job was proven against the published 0.5.0 |

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
| **Reproducible** | 34 | The instrument is committed. The command is named below or in the entry |
| **Observed once** | 5 | One execution, pinned by a run ID. Every one is enumerated below |
| **Observed once, unlinked** | 3 | One execution whose artifact was not preserved. Grandfathered, and the label says it cannot be re-checked |
| **Unestablished** | 11 | Inferred, or the instrument is gone, or the premise turned out to be wrong |

**53 claims, counted as claims rather than as lines**, since several are quoted in more than one
place. MK-110 added one. The P21 wave added six, all reproducible, and turned two of MK-100's unestablished same-shape
rows into reproducible ones inside that entry. MK-114 added one, reproducible. The P25 wave added two, both reproducible: the decision site statuses before and after it, and the gate's cost. The P27 wave added five reproducible (the horizon table, and the MK-240, MK-241 and MK-242 fork proofs, and the retired claims count over the published 0.4.1) and three unestablished (the consumer audit's own price shares and its two mainnet fork figures, measured outside this repository and superseded by the reproducible ones). A count of numerals would be larger and would mean less.

### The reproducible set, and the command for each

| Measurement | Where | Command |
|---|---|---|
| Flake rates and run windows | MK-016, MK-021, MK-022, MK-023, MK-024, MK-025, MK-026, MK-030 | `pnpm test:fork`, `pnpm test:coverage` |
| Coverage against the ratchet | MK-016, and the floors in `docs/07-testing.md` §4 | `pnpm test:coverage` |
| The 1000 case differential sweep on the TEN operation generator: **1000 ran, 97 skipped, 0 FALSE_VIABLE, 10 FALSE_BLOCKED (all MK-079), 0 NUMBERS, 0 throws**, 116 minutes of wall clock (111 inside the sweep) | MK-016, MK-048, MK-079, `docs/09` §3 | `MK_DIFF_CASES=1000 MK_DIFF_SEED=20260826 pnpm test:fork` in four slices of 250 via `MK_DIFF_FROM` and `MK_DIFF_TO`, fresh anvil each, block 15043414. Measured in the P15 wave. **The four slices exited 1 when this was measured**, on the 10 FALSE_BLOCKED, which are one
harness defect and not ten. They exit 0 as of the P16 wave, which did not fix the defect: it
registered it, so those ten print as `EXPECTED MK-079` and only an unexplained mismatch fails. The previous 89 and its four slice breakdown were the NINE operation generator and stay inside MK-048's evidence block as history |
| Chain constants and the fee exempt scan at both pinned blocks | MK-014, MK-018, `docs/09` §6 | `pnpm facts --stdout` |
| Gas variance across three redemption fixtures, 52 executions | MK-037, MK-039 | `MK_GAS_LAB=1 MK_GAS_LAB_AMOUNT=5000 pnpm test:fork` |
| The zero debt sentinel value | MK-017 | `pnpm test:unit` |
| Every pin added for MK-058, MK-059, MK-060 and MK-065 fails with its fix removed, and every pin for MK-100 to MK-108 | MK-058 through MK-065, MK-100 through MK-108 | `node scripts/mutation-check.mjs` for the chain free pins; `node scripts/mutation-check.mjs --all` adds the fork and packaging gate pins |
| Recovery Mode borrows in the sweep, **20 of 81**, per band, 0 mismatches, 0 throws | MK-058, MK-059 | `MK_DIFF_OP=borrow MK_DIFF_CASES=1000 MK_DIFF_SEED=20260826 pnpm test:fork`, **re-measured on the ten operation generator in the P14 wave**, 464s, exit 0. It replaces the 17 of 105 measured on the nine operation one. It was measured with an op filter, which is a narrower instrument than the full sweep; the full sweep's own Recovery Mode borrow counts, measured in P15, are boundary 8, extreme 9, middle 3 |
| Redemption bands in the sweep, **99 ran, 47 skipped**, per band, 0 mismatches, 0 throws | MK-048 | `MK_DIFF_OP=redeem MK_DIFF_CASES=1000 MK_DIFF_SEED=20260826 pnpm test:fork`, re-measured in the P14 wave, 1823s, exit 0 |
| The Recovery Mode threshold at the pinned block, TCR 2.7731, so 45.9 percent | MK-059 | `cast call 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0 "getEntireSystemColl()" --rpc-url https://rpc.test.mezo.org --block 15043414`, and the same for `getEntireSystemDebt()` |
| The estimate is asked with an address, not an `Account` object | MK-037 | `pnpm exec vitest run --project unit packages/core/test/write-gas-fallback.test.ts` |
| The borrowing power ceiling opens at exactly MCR, is liquidatable after 1, 60, 600 and 3600 seconds while a control at 80% is not, and is liquidated; **the recommended figure opens at 112.245% and is not liquidatable at any of those delays, survives a 199 bps fall an hour later and does not survive 210 bps**; in Recovery Mode the ceiling opens at exactly CCR; with the system ratio binding the ceiling is refused a second later and the recommended figure opens | MK-100 | `MEZO_FORK_BLOCK=15043414 pnpm exec vitest run --project fork packages/core/test/zz-borrowing-power-boundary.fork.test.ts` |
| Mezo mainnet `fetchPrice()` moves: over 2000 consecutive blocks, the absolute one block move p99 2.26 bps and max 8.02, two blocks p99 3.76 (up 4.13, down 3.87); over 610589 seconds sampled every 16 blocks, the worst fall inside an hour p99 132.56 bps and max 190.78, inside ten minutes max 163.43 | MK-100, MK-103 | `MEZO_MAINNET_RPC_URL=https://jsonrpc-mezo.boar.network pnpm tsx scripts/oracle-moves.ts --end 11823000 --consecutive 2000 --days 7 --step 16`. The window figures are a lower bound: a dip between two samples is not seen |
| `redeem(nextViableAmount)` succeeds after 1, 60 and 600 seconds and is refused before gas after 3600; a 4.23 MUSD first-Trove partial reports 0.504 bps of tolerance each way, succeeds at half of it in both directions, reverts at twice it, and the helper's lower edge hint reverts at half the up tolerance | MK-103, MK-104 | `MEZO_FORK_BLOCK=15043414 pnpm exec vitest run --project fork packages/core/test/redeem-boundary.fork.test.ts` |
| A refinance after a governance rate change and a 20% price rise moves the Trove from 100 to 500 bps and its capacity from 70046.46 to 84055.75 MUSD, and after a fall to 90% cuts it to 63041.82, each equal to the preview to the wei | MK-101 | `MEZO_FORK_BLOCK=15043414 pnpm exec vitest run --project fork packages/core/test/zz-refinance.fork.test.ts` |
| The three pins MK-110 names checked nothing: the old MK-089 mutation string matches once, inside `partialRedemptionBand`; the first MK-107 test passes with its mutation applied; every unit test but the new band test passes with the band base mutated, 423 passed | MK-110 | The three commands in the MK-110 entry |
| The deployed `HintHelpers` reads `maxIterations` 0 as no limit: a 400,000 MUSD request at block 15043414 is returned whole at 0, 229, 230 and 231 and truncated to 298,067 MUSD at 100; and on a fork `Redemption._actualAmount` at `maxIterations: 0n` equals `previewRedeem`'s `redeemable` to the wei while one iteration redeems less | MK-114 | `cast call 0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6 "getRedemptionHints(uint256,uint256,uint256)(address,uint256,uint256)" 400000000000000000000000 77051107320000000000000 <n> --rpc-url https://rpc.test.mezo.org --block 15043414`; `MEZO_FORK_BLOCK=15043414 pnpm exec vitest run --project fork packages/core/test/redeem-max-iterations.fork.test.ts` |
| With the oracle stale, thirteen surfaces (four reads, the borrowing power calculator, three previews, four writes and `liquidate`) each reject with `OracleStale` and keep the viem error in `cause` | MK-105 | `MEZO_FORK_BLOCK=15043414 pnpm exec vitest run --project fork packages/core/test/zz-typed-errors.fork.test.ts` |
| `capacity.remaining`, `maxWithdrawableCollateral().amount` and `minimumCollateralToClearIcr`, each sent one second after the read, are refused (`ExceedsBorrowingCapacity`, `InsufficientCollateral`, `InsufficientCollateral`) while a control inside each succeeds | MK-100 | `MEZO_FORK_BLOCK=15043414 pnpm exec vitest run --project fork packages/core/test/zz-limit-figures.fork.test.ts` |
| 0.3.1 against 0.3.0, both packages: runtime builds byte identical, declarations identical without comments, manifests differ only in version | MK-100, `docs/12-release-runbook.md` §0b | `node scripts/compare-published.mjs --base 0.3.0 --head 0.3.1` |
| Decision sites by status: at `870b76f`, 474 sites, 319 caught by the unit project, 36 by the fork project only, 119 by nothing; after the P25 wave, 437, 3, and 34 registered survivors (29 equivalent, 5 unreachable); every hand written entry caught by a test citing it | MK-112, MK-116 to MK-121 | `MEZO_TESTNET_RPC_URL=https://rpc.test.mezo.org MEZO_FORK_BLOCK=15043414 node scripts/mutation-check.mjs --record --all --jobs 3 --report <file>`, run on the P25 tree for the after figures; the before figures are the same command with `scripts/mutation/sites.json` absent, run on this wave's gate before any of its pin tests were written, so on `870b76f`'s tests. **They were measured in three runs, not one**: a unit pass, and two fork passes, because the first stopped at 121 of 155 mutants when the machine slept |
| How often Mezo mainnet `fetchPrice()` fell 2, 5, 10 and 20 percent within an hour, a day, three days, a week and thirty days, over blocks 9841930 to 11868955 | MK-240, `docs/03-core-api.md`, both READMEs | `MEZO_MAINNET_RPC_URL=https://jsonrpc-mezo.boar.network pnpm tsx scripts/oracle-moves.ts --end 11869000 --consecutive 0 --days 90 --step 225 --horizons 3600,86400,259200,604800,2592000 --falls 200,500,1000,2000`. A lower bound at one sample in 225 blocks |
| A draw for a day and 500 bps survives 1 to 3600 seconds, a 499 bps fall a day later, and not a 510 bps one, beside a ceiling liquidated after one second | MK-240 | `MEZO_FORK_BLOCK=15043414 pnpm exec vitest run --project fork packages/core/test/zz-borrowing-power-boundary.fork.test.ts` |
| A redemption through a cancelled later partial settles 1,808.46 MUSD where the helper reports 3,515.14, and `settled` equals the event, the balance change and the BTC received | MK-241 | `MEZO_FORK_BLOCK=15043414 pnpm exec vitest run --project fork packages/core/test/zz-redemption-settled.fork.test.ts` |
| A withdrawal after a 30 percent fall leaves the previewed capacity to the wei, a refinance writes the projected capacity and charges the projected fee within accrual, and re-adding the collateral restores nothing | MK-242 | `MEZO_FORK_BLOCK=15043414 pnpm exec vitest run --project fork packages/core/test/zz-capacity-ratchet.fork.test.ts` |
| 119 retired claims in the published 0.4.1 packages, none in this tree | MK-246 | `npm pack @musd-kit/core@0.4.1 @musd-kit/react@0.4.1`, extract each tarball, then `node scripts/retired-claims.mjs <core package dir> <react package dir>`; `node scripts/retired-claims.mjs packages/core packages/react` after `pnpm build` |
| The gate's cost: `--check` 0.66 s; the unit pass 2714 s for 524 mutants; the fork pass 4890 s for 37; 7759 s in all, three jobs, one laptop. On CI the push path's worst case, every unit mutant, about 32 minutes in four shards | MK-112, `docs/07-testing.md` §4d | the same command, timed by the lines it prints, on an Apple M5 with 10 cores under `caffeinate -ims`; on CI, `Mutation gate` run 34937019525, its job times and `mutants in` lines |

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
counted; MK-020's twelve `latestRoundData()` reads; the consumer audit's 29 day price shares and its two mainnet fork figures for MK-241 and MK-242, whose scripts were outside this repository.

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

**Scope note, P13 wave.** This entry's remediation touched `getBorrowingPower` and improved it: it
added the resulting TCR condition. It did not ask what ELSE that file got wrong, and the answer was
the borrowing fee in Recovery Mode and for an exempt account (MK-067). So this is not quite the
shape of MK-004's and MK-018's corrections, which fixed the file the entry named and left the other
copies standing; here the named file WAS edited and a second rule inside it was left. Both are the
same omission, which `docs/08-conventions.md` §12 now names: enumerate the rule, not the defect.

**And one claim above is now sharper.** `remaining` is not merely headroom, it is the distance to
`ICR == MCR`: `_calculateMaxBorrowingCapacity` (`:1323-1328`) and the entire debt at MCR are the
same expression, verified numerically. MK-072 carries the measurement, and the field says so now.
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

**Scope correction, P13 wave. This entry was too narrow, and the narrowness is the interesting
part.** The **SDK location** field above names `previewOpen.ts`, the remediation fixed
`previewOpen.ts`, and the entry then read as closed. The rule was decided in four other places
and three of them were still wrong, including `trove/index.ts`'s own `openTrove` (MK-068) and
`getBorrowingPower` (MK-067), which reproduced this exact band for two more releases. The band
was closed in the preview and open in the write path the preview exists to describe.

**Nothing above is rewritten**, because the record of what was believed at the time is the point.
What changed is the process: `docs/08-conventions.md` §12 now requires enumerating every place a
rule is decided before a finding can be closed, which is the step that was missing here. The full
enumeration for this rule is in MK-069.
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

**Class** S2 · **Status** fixed, P4 wave  <!-- MK-063: header was `open` while the body recorded the fix -->

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

**Class** S2 · **Status** fixed, P4 wave  <!-- MK-063: header was `open` while the body recorded the fix -->

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

**Class** S2 · **Status** fixed, P4 wave  <!-- MK-063: header was `open` while the body recorded the fix -->

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

**Class** S2 · **Status** fixed, P4 wave  <!-- MK-063: header was `open` while the body recorded the fix -->

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

**Class** S2 · **Status** documented, P4 wave. No code change, by design  <!-- MK-063: header was `open` while the body recorded the fix -->

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

**Class** S2 · **Status** fixed, P4 wave  <!-- MK-063: header was `open` while the body recorded the fix -->

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

**Class** S2 · **Status** fixed, P4 wave  <!-- MK-063: header was `open` while the body recorded the fix -->

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

**What is NOT changed, stated rather than left to be discovered.** Every preview and calculator
under `math/` still reads the price outside the batch that uses it, so the system totals a
resulting TCR gate compares can come from an earlier block than the price they are measured
against. Moving them is a larger change to the math layer's shape than this finding calls for.
They remain as they are, deliberately.

**The full list, corrected in the P17 wave (MK-093).** This entry named four functions and the
list was two waves stale: `previewAdjustTrove`, `previewClose`, `maxWithdrawableCollateral` and
`previewRedeem` arrived with MK-042 and MK-048 and have the same shape. All eight:

| Function | Reads the price separately |
|---|---|
| `previewOpen` | yes |
| `previewBorrow` | yes, through `previewAdjustTrove` |
| `previewAdjustTrove` | yes |
| `previewRefinance` | yes |
| `previewClose` | yes |
| `maxWithdrawableCollateral` | yes |
| `previewRedeem` | yes |
| `getBorrowingPower` | the price is IN the batch since MK-092, but `checkRecoveryMode(price)` cannot be and is a later round trip |

**And the exemption was originally phrased against a condition that did not hold.** It read "None
of them claims a single block snapshot in its docstring", which made the exemption conditional on
prose nobody was checking. `getBorrowingPower`'s docstring then acquired "Every chain read happens
in ONE `multicall`" and the condition was broken without anything noticing (MK-093). The exemption
now rests on the engineering judgment alone, which is what it was always doing: pinning eight
functions to a snapshot costs a round trip each for a window of one block. **What changed is that
the gap is disclosed at each of the eight rather than in this entry only.**

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

**Class** S3 · **Status** fixed, P9 wave  <!-- MK-063: header was `open` while the body recorded the fix -->

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

**Class** S3 · **Status** fixed, P9 wave  <!-- MK-063: header was `open` while the body recorded the fix -->

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

**Scope correction, P13 wave.** "Single sourced" was true of the two derivations this entry
names and of nothing else. `previewRedeem.ts:183` declared its OWN `SECONDS_PER_YEAR`, shadowing
the canonical one and holding 31_536_000, the value `constants.ts:22-23` explicitly names as
wrong (MK-071). `read/getTrove.ts` and `read/system.ts` each inlined `icr < MCR` rather than
sharing a predicate, which is why MK-074's condition had to be added twice before
`isTroveLiquidatable` existed. And the redemption test carried a third copy of the same wrong
divisor, so the assertion could only confirm the source's error. A dedup entry that enumerates
two derivations and closes is the same defect one level up, which is what
`docs/08-conventions.md` §12 now exists to prevent.

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

**Scope correction, P13 wave, the same shape as MK-004's.** "Fixed" covered `previewOpen` and the
debt increase path. It did not cover `getBorrowingPower`, which could not express exemption at
all because it took no account (MK-067), nor `openTrove`, which quoted the fee for an exempt
account and then measured the debt floor against it (MK-068). An exempt account was therefore
shown a smaller maximum than the protocol allows, and refused an open the protocol accepts, for
two releases after this entry read fixed. Both now take an account and both route through
`isBorrowingFeeCharged`. MK-069 enumerates every decision site.
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
| **margin the send REALISED**, limit over gas used | **1.5%**, measured separately on `openTrove`. Not a setting: it is what one send's limit left over its gas used, and MK-037 is why it was that thin. The SDK now REQUESTS 25% over the node's estimate, which is a different quantity (§13) |

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
| `claim` | `:316` -> `_claimCollateral` `:1119-1124` | a surplus to claim: `CollSurplusPool.claimColl` requires one (`CollSurplusPool.sol:90-93`). **This cell said "none", and that no preview was possible because there was no condition, until MK-246**: the condition lives one contract away, and `claim()` has handled its revert since MK-007 |
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

**Re-measured in the P14 wave on the ten operation generator**, because the block above describes a
tuple stream this tree no longer produces (MK-069). Same seed, same command, 1823s, exit 0:

```
ran=99  skipped=47  FALSE_VIABLE=0  FALSE_BLOCKED=0  NUMBERS=0  threw=0
  AT_NET_DEBT      ran=13  skipped=12
  WITHIN_HEADROOM  ran=11  skipped=11
  AT_HEADROOM      ran= 9  skipped=10
  IN_THE_GAP       ran= 8  skipped= 5
  WHOLE_TROVE      ran=11  skipped= 9
```

**Thirteen `AT_NET_DEBT` executions rather than nineteen, and the conclusion is unchanged**: every
band still ran, the band this finding turns on still ran, and the chain still agreed with the preview
in both directions every time. The counts are smaller because the draw moved, not because anything
got worse. The block above is kept as the record of what closed the finding at the time.

**Why 40 of 123 skipped, which is a high rate and is not hidden.** Redemption skips for a reason no
other operation has. At the extreme band's price multipliers of 25 and 50 percent, and at the
boundary band's 66, every Trove in the fork's list falls below MCR, so the loop finds nothing, there
is no first eligible Trove, and there is no headroom for a band to sit either side of. The rest are
the ordinary fixture skips the whole sweep has: a seeding open that was not itself viable, or an
account that does not hold what the band needs.

---

## MK-058 · `evaluateBorrow` omits the Recovery Mode rule that a debt increase must not lower ICR

**Class** S1 · **Status** fixed · **Found by the external reviewers verifying the MK-042 remediation**

**Ground truth.** `_adjustTrove` routes every mode decision through
`_requireValidAdjustmentInCurrentMode` (`BorrowerOperations.sol:840-845`, defined `:1212-1227`). The
Recovery Mode arm is `_requireValidAdjustmentInRecoveryMode` (`:1265-1275`):

```solidity
_requireNoCollWithdrawal(_collWithdrawal);      // :1270
if (_isDebtIncrease) {
    _requireICRisAboveCCR(_vars.newICR);                          // :1272
    _requireNewICRisAboveOldICR(_vars.newICR, _vars.oldICR);      // :1273
}
```

and `_requireNewICRisAboveOldICR` (`:1395-1403`) is `require(_newICR >= _oldICR, "BorrowerOps:
Cannot decrease your Trove's ICR in Recovery Mode")`.

**SDK location.** `packages/core/src/math/previewBorrow.ts:236-240`. `evaluateBorrow` pushes four
reasons and none of them is this one. `BorrowBlockReason`
(`packages/core/src/math/previewBorrow.ts:43-47`) has no member that could carry it.

**Why every Recovery Mode borrow is affected, not a corner of them.** `withdrawMUSD(amount, upper,
lower)` (`BorrowerOperations.sol:243-257`) calls `_adjustTrove` with `_collWithdrawal = 0` and no
`msg.value`, so a borrow adds debt and adds no collateral. `ICR = coll * price / debt` with `coll`
held constant and `debt` strictly increasing gives `newICR < oldICR` for every `amount > 0`. The
requirement is `>=`, so the only borrow that could satisfy it is one of zero, which `:786` refuses
separately. **In Recovery Mode there is no borrow amount the contract will accept**, and the preview
reports `viable: true` for the whole range whenever capacity and CCR happen to clear.

**Blast radius.** A wrong verdict on a read only API. `previewBorrow` is exported from
`packages/core/src/index.ts:93` and reachable as `client.previewBorrow`
(`packages/core/src/client/createMusdClient.ts:414`). **No write path consumes it**: `borrow`
(`packages/core/src/trove/index.ts:441`) prechecks through `assertAdjustViable`, which runs
`evaluateAdjust`, and that evaluator does model the rule
(`packages/core/src/math/previewAdjust.ts:233`). So a caller who sends through the SDK is refused
correctly with `RecoveryModeRestriction`; a caller who asks the preview and then acts on it, or
renders it, is told the opposite of what the contract will do.

**Why it is S1 rather than S2.** Nothing reverts and nothing is loud. The caller is handed a
`viable: true` with a full set of plausible numbers behind it, and every one of those numbers is
correct except the verdict.

**Same shape as MK-001, in the other direction.** MK-001 was a Recovery Mode rule the protocol does
not have. This is a Recovery Mode rule the protocol does have and the evaluator does not, in code
written after MK-001 closed.

**Reproduction.** Call `evaluateBorrow` with `isRecoveryMode: true` and any collateral and debt that
clear CCR after the draw. The verdict is `viable: true`; `evaluateAdjust` on the same position with
`increaseDebt` set returns `ICR_NOT_IMPROVED_IN_RECOVERY_MODE`.

**Decision.** Fix now, and not by adding a fifth `if`. See MK-059: the two defects have one cause.

### Fixed

`previewBorrow` no longer decides anything. It is a projection of the adjust preview, and
`evaluateBorrow` is a projection of `evaluateAdjust`, which had this rule right all along
(`packages/core/src/math/previewAdjust.ts:233`). The full reasoning, and the other two defects it
closes, are under MK-060's decision block, because they are one fix.

**One thing the reviewers' description, and this entry's first draft, both got slightly wrong**, and
it is worth keeping rather than quietly correcting. "Every non zero Recovery Mode borrow decreases
ICR" is not exactly true. `LiquityMath._computeCR` is integer `coll * price / debt`, so a draw small
enough to leave the quotient unchanged satisfies `newICR >= oldICR` on equality and the gate passes.
For a position of 1 BTC at 100k USD against 2,200 MUSD, the first draw that moves the quotient is
**23 wei**, which is 2.3e-17 MUSD. Reproducible:

```
node -e 'const E=10n**18n,P=100000n*E,C=E,D=2200n*E,f=d=>(C*P)/d;
         let lo=1n,hi=10n**6n; while(lo<hi){const m=(lo+hi)/2n;
         if(f(D+m)<f(D))hi=m; else lo=m+1n;} console.log(lo)'
```

The SDK uses the same integer form, so it AGREES with the chain on both sides of that boundary,
which is the property that matters. The correction changes nothing about the defect: every draw a
person would make is refused, and 0.2.0 said otherwise. It is recorded because a rule stated more
absolutely than it holds is how the next reader gets it wrong. Pinned by
`preview-verdicts.test.ts`, "the exception is truncation, which the SDK inherits rather than
invents".

**And one thing this fix newly depends on, checked rather than assumed.** The rule is
`newICR >= oldICR`, so the fix is only right if the SDK's `currentIcr` is the contract's `oldICR`.
The contract computes `oldICR` from `getTroveColl` and `getTroveDebt` (`BorrowerOperations.sol:816-817`,
`:827`), which are the STORED values; the SDK computes it from `getEntireDebtAndColl`, which adds
pending redistribution on top (`TroveManager.sol:796-801`). Those are different numbers in general.

They are the same here, and the reason is one line up the call chain: `_adjustTrove` calls
`updateSystemAndTroveInterest(_borrower)` at `:769`, which is `TroveManager.sol:641-644`, whose
`_updateTroveInterest` ends with `_applyPendingRewards(activePool, defaultPool, _borrower)`
(`TroveManager.sol:884`). So by the time `:816` reads the stored values, the pending redistribution
has been folded into them. **The SDK's basis and the contract's basis agree**, and they agree
because of a call the contract makes rather than by coincidence.

**Pinned by** `packages/core/test/preview-verdicts.test.ts`, the `MK-058, MK-059: the Recovery Mode
rules` block, and `packages/core/test/preview-agreement.test.ts`. **And by the sweep**, which
could not construct a Recovery Mode borrow at all until this wave: see MK-059's entry.

---

## MK-059 · `evaluateBorrow` applies a TCR gate the contract does not apply in Recovery Mode

**Class** S1 · **Status** fixed · **Found by the external reviewers verifying the MK-042 remediation**

**Ground truth.** `_requireNewTCRisAboveCCR` is defined at `BorrowerOperations.sol:1344-1349` and
called from **exactly four sites**, counted in the source rather than recalled:

| Line | Path | Condition |
|---|---|---|
| `:665` | `_openTrove` | inside the `else` of `if (isRecoveryMode)`, so **normal mode only** |
| `:972` | the close path | inside `if (canMint)` |
| `:1059` | `refinance` | unconditional on that path |
| `:1209` | `_requireValidAdjustmentInNormalMode` | **normal mode only**, by definition of the arm |

`_requireValidAdjustmentInRecoveryMode` (`:1265-1275`) does not call it, and neither does anything
it calls. **The adjust path has no TCR gate in Recovery Mode.**

**SDK location.** `packages/core/src/math/previewBorrow.ts:240`,
`if (resultingTcr < CCR) reasons.push('TCR_BELOW_CCR')`, outside any mode branch.

**Why it fires on nearly every Recovery Mode borrow rather than rarely.** Recovery Mode is *defined*
as `TCR < CCR` (`checkRecoveryMode`). So in Recovery Mode `resultingTcr < CCR` is true before the
borrow is even considered, and adding debt cannot raise it. The reason is therefore reported for
essentially every Recovery Mode borrow, and it is not a rule the contract has.

**Blast radius.** The same read only surface as MK-058, and the two are opposite errors that partly
mask each other: MK-059 makes the preview say no where the contract has no such rule, MK-058 makes
it say yes where the contract does. Which one a caller sees depends on the numbers. `reasons` and
`bindingConstraint` are wrong in both cases.

**This is MK-001's shape, reintroduced after MK-001 closed.** MK-001 was `isLiquidatable` applying
`CCR` where the protocol only has `MCR`. This is a Recovery Mode constraint the protocol does not
have, written into a file created during the MK-002 remediation, months after MK-001 was fixed and
its lesson recorded. The adjust evaluator gets it right and says so in its own docstring
(`packages/core/src/math/previewAdjust.ts:45-47`); the borrow evaluator, written first and never
reconciled, does not.

**Reproduction.** `evaluateBorrow({ isRecoveryMode: true, ... })` with any system state.
`resultingTcr < CCR` holds by construction, so `TCR_BELOW_CCR` appears in `reasons`.
`evaluateAdjust` on the same inputs does not report it (`previewAdjust.ts:235-238`).

**Decision.** Fix now, at the cause rather than at the symptom. See MK-060's decision block.

### Fixed

Closed by the same delegation as MK-058. `evaluateAdjust` puts the TCR gate inside the normal mode
branch (`packages/core/src/math/previewAdjust.ts:235-238`) and states why in its own docstring, so a
projection of it inherits the correct behaviour rather than restating it.

### And the coverage gap that let both of them through

**The sweep could not construct a Recovery Mode borrow, and the count of cases said nothing about
that.** The generator applied its price multiplier BEFORE seeding the position
(`differential/harness.ts`, the `setPrice` at the top of `runCaseInner`), so a multiplier low enough
to put the system under CCR was also a multiplier at which the seeding open was refused, and the
case was skipped before the operation under test ran. Every Recovery Mode case the generator could
express was a case it also skipped. This is MK-047's lesson exactly, one dimension over: a sweep
proves what its generator can express.

`DiffCase` now carries `recoveryDrawdownPercent`, applied AFTER the fixture exists, and
`CaseResult` carries `isRecoveryMode` READ from the chain at the moment the preview was taken rather
than inferred from the tuple. The sweep reports Recovery Mode counts per operation and, for borrows,
per band, on the same reasoning as MK-048's redemption bands: a mode that never ran proves nothing.

**The drawdown sizes are measured rather than guessed, and the reviewers' figure is about a
different chain.** They measured that mainnet needs roughly a seventy percent drawdown. The sweep
runs against testnet at pinned block 15043414, where `getEntireSystemColl` is
15413255840429888850496 wei against `getEntireSystemDebt` 428255179495157716095502713 wei at
77051.10732 USD/BTC, a TCR of **2.7731**. Recovery Mode needs the price below `CCR / TCR`, which is
**54.09%**, a drawdown of at least **45.9 percent**, not seventy. Read at the pinned block with:

```
cast call 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0 "getEntireSystemColl()" \
  --rpc-url https://rpc.test.mezo.org --block 15043414
cast call 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0 "getEntireSystemDebt()" \
  --rpc-url https://rpc.test.mezo.org --block 15043414
```

The generator uses 50, 60 and 70 percent, all of which clear that threshold with room, since the
seeded position moves the system TCR slightly.

### And the sweep now reaches them, counted

Two runs, both from the wave's tree, both **0 FALSE_VIABLE, 0 FALSE_BLOCKED, 0 NUMBERS, 0 threw,
exit 0**. Seed `20260826`, pinned block 15043414, oracle seeded from chain at
`answer=77051107320000000000000`.

```
MK_DIFF_CASES=60 pnpm test:fork          (differential.fork.test.ts only)
  ran=60 skipped=6  bands: boundary=33 extreme=16 middle=11
  recovery mode: reached=13 of 60   asked for a drawdown=11
  recovery mode by op: addCollateral 2  adjust 2  refinance 3  repay 3  withdrawCollateral 2
  recovery mode BORROWS by band: NONE

MK_DIFF_OP=borrow MK_DIFF_CASES=1000 pnpm test:fork
  ran=105 skipped=6  bands: boundary=62 extreme=17 middle=26
  recovery mode: reached=17 of 105  asked for a drawdown=14
  recovery mode BORROWS by band: boundary ran=7  extreme ran=7  middle ran=3
```

**Re-measured in the P14 wave on the ten operation generator**, because the two blocks above describe
a tuple stream this tree no longer produces (MK-069). Same seed, same command, 464s, exit 0:

```
MK_DIFF_OP=borrow MK_DIFF_CASES=1000 MK_DIFF_SEED=20260826 pnpm test:fork
  ran=81 skipped=3  bands: boundary=47 extreme=22 middle=12
  recovery mode: reached=20 of 81  asked for a drawdown=15
  recovery mode BORROWS by band: boundary ran=8  extreme ran=9  middle ran=3
  FALSE_VIABLE=0  FALSE_BLOCKED=0  NUMBERS=0  threw=0
```

**Twenty Recovery Mode borrows across all three bands rather than seventeen, and none of them
mismatched.** The argument this entry makes is unchanged and is if anything better served: the point
was never the size of the number, it was that the count is REPORTED so a reader can tell "the sweep
reached Recovery Mode" from "the sweep reached a Recovery Mode borrow". Both blocks are kept, the
first as the record of what closed the finding at the time.

**The first run is why the second exists, and it is the point of counting rather than assuming.**
Sixty mixed cases reached Recovery Mode thirteen times and reached a Recovery Mode BORROW zero
times, because one operation in nine times one case in five is about 1.3 expected at that sample
size. A run that says "the sweep reached Recovery Mode" would have been true and would have proved
nothing about the defect. The `MK_DIFF_OP=borrow` slice over the full thousand case generation, the
same instrument MK-048 added for redemption bands, gives 17 Recovery Mode borrows across all three
bands.

`reached` exceeds `asked for a drawdown` in both runs because the pre-seed `pricePercent` can also
land the system under CCR on its own, which is read from the chain rather than inferred.

**Cost, and the first explanation offered for it was wrong.** These two runs came in at **36.7 and
32.4 seconds per case**, against the 3 to 4 seconds `docs/07-testing.md` documents. The first
reading of that was that the drawdown had made the sweep expensive, and the evidence offered
against the cold cache was the harness line `fork state warmed in 33ms`.

**That line does not mean what it was read to mean.** It times globalSetup's `findInsertPosition`
traversal of the sorted list (MK-021) and nothing else. It says the LIST is cached. It says nothing
about the state a generated case touches when it opens a Trove at a price no earlier case used, and
that state is fetched from upstream one slot at a time the first time any case reaches it.

Settled by the five run window, which runs the SAME 24 cases five times:

```
run 1  differential.fork.test.ts   847329ms    35.3 s/case
run 2  differential.fork.test.ts   151759ms     6.3 s/case
```

Both runs report `fork state warmed in` about 30ms. Identical cases, identical seed, **5.6x apart**,
and the only thing that changed between them is anvil's on disk RPC cache for the state those cases
touch. So the per case figure in a fresh sweep is dominated by cold upstream fetches for state that
case is the first to reach, which is also why a thousand distinct cases stay slow throughout: every
one of them is a first touch.

**What this means for the push path, which is the part that matters.** `ci.yml:199` caches
`~/.foundry/cache/rpc/31611/$MEZO_FORK_BLOCK` between runs, and the push subset is the same 24 cases
every time, so CI is on the run 2 side of that table rather than the run 1 side.

**And the drawdown itself costs nothing measurable**, which is the question the per case figure
raised. Measured with `scratchpad`'s A against B, 12 cases each side, the SAME tuples on both sides
because the override keeps every `rnd()` draw, and each side run twice so only the warm rows are
compared:

```
with the drawdown,    warm    114629ms    recovery mode: reached=3 of 12
drawdown neutralised, warm    119341ms    recovery mode: reached=2 of 12
```

The version carrying the drawdown is the FASTER of the two by 4 percent, which is to say the
difference is noise and the dimension is free. The `reached=2` on the neutralised side is the
pre-seed `pricePercent` landing the system under CCR on its own, which is why the mode is read from
the chain rather than inferred from the tuple.

### And the one Recovery Mode borrow test that existed

`preview-verdicts.test.ts` had exactly one, and it asserted only that `icrThreshold` switches from
MCR to CCR. That is true of the right evaluator and of the wrong one, which is why it passed for the
life of the file. It is kept, and the block beside it now asserts the two rules underneath it.

---

## MK-060 · The debt increase flag is read from presence in the write path and from value in the evaluator

**Class** S2 · **Status** fixed · **Found by the external reviewers verifying the MK-042 remediation**

**Ground truth.** `_adjustTrove` takes `_isDebtIncrease` as a `bool` parameter independent of
`_mUSDChange`, and refuses the contradictory combination explicitly
(`BorrowerOperations.sol:785-787`):

```solidity
if (_isDebtIncrease) {
    _requireNonZeroDebtChange(_mUSDChange);   // :1351-1356, require(_debtChange > 0)
}
```

So `(_isDebtIncrease = true, _mUSDChange = 0)` is a reachable, refused input, and it is refused
before every other gate.

**SDK location, both halves.**

- Write path, `packages/core/src/trove/index.ts:529`: `const isDebtIncrease = brw !== undefined`.
  **Presence.**
- Evaluator, `packages/core/src/math/previewAdjust.ts:193`: `const isDebtIncrease = increaseDebt > 0n`.
  **Value.**

**Two consequences, and they point in opposite directions.**

1. **`ZERO_DEBT_INCREASE` is unreachable.** The guard is
   `if (isDebtIncrease && increaseDebt === 0n)` (`previewAdjust.ts:216`), and `isDebtIncrease` is
   *defined* as `increaseDebt > 0n`. The two conditions are mutually exclusive, so the branch is
   dead. The reason is declared (`previewAdjust.ts:59`), documented against `:1351-1356`, mapped to
   a typed error (`trove/index.ts:372-373`), and can never be produced.
2. **A zero borrow reaches the contract as a debt increase.** `adjustTrove({ borrow: 0n, addCollateral: x })`
   passes `brw !== undefined`, so `isDebtIncrease` is `true` and `debtChange` is `0n`
   (`trove/index.ts:529-530`). The precheck at `trove/index.ts:554-559` forwards `increaseDebt: 0n`,
   the evaluator sees `isDebtIncrease === false`, treats the call as a pure top-up, finds it viable,
   and the send at `trove/index.ts:566-572` puts `(0, true)` on the wire, where `:786` refuses it.
   `adjustTrove` also never validates the borrow leg: `borrow` does
   (`trove/index.ts:430`, `assertPositiveAmount`), `adjustTrove` does not.

**Blast radius.** An avoidable failed transaction on `adjustTrove` with an explicit zero borrow leg,
and a declared reason that no input can ever produce. Neither is a wrong number, which is why this
is S2 and MK-058 and MK-059 are S1.

**Reproduction.** `previewAdjustTrove({ owner, increaseDebt: 0n, addCollateral: 1n })` returns
`viable: true`; `adjustTrove({ borrow: 0n, addCollateral: 1n })` sends and reverts with
`BorrowerOps: Debt increase requires non-zero debtChange`.

**Decision, covering MK-058, MK-059, MK-060 and MK-065 together.** These are one defect wearing four
faces: **one question has two evaluators.** That is exactly what MK-001 was, and patching the
missing rules into `evaluateBorrow` would leave the second copy free to drift again. `withdrawMUSD`
IS `_adjustTrove` with `_collWithdrawal = 0` and `_isDebtIncrease = true`
(`BorrowerOperations.sol:243-257`), so borrowing is not a sibling of the adjust path, it is a point
on it. `previewBorrow` becomes a projection of the adjust preview and `evaluateBorrow` becomes a
projection of `evaluateAdjust`, with the reason set narrowed to the ones a borrow can actually
reach. The flag is made consistent by deriving it from presence on both sides, which is what the
contract's parameter means, and `adjustTrove` validates its borrow leg the way `borrow` does.

### Fixed

**The shape, in four changes.**

1. `EvaluateAdjustInput` gains an optional `isDebtIncrease`
   (`packages/core/src/math/previewAdjust.ts`), which is `_adjustTrove`'s own parameter rather than
   a derivation of `increaseDebt`. Optional, so an input built before the field existed still
   evaluates the way it did; `previewAdjustTrove` passes `params.increaseDebt !== undefined`, which
   is exactly what `trove/index.ts:529` passes to the contract.
2. `adjustTrove` calls `assertPositiveAmount('borrow', brw)` when a borrow leg is present, which is
   what `borrow` has always done and this path never did.
3. `previewBorrow` and `evaluateBorrow` become projections of the adjust preview and evaluator.
   `BorrowBlockReason` is now `Extract<AdjustBlockReason, ...>` rather than a free standing union,
   so a member that stops existing on the adjust side is a compile error rather than a drift.
4. `AdjustPreview` gains `capacity`, so `EXCEEDS_BORROWING_CAPACITY` arrives with the same numbers
   on both previews instead of only on one.

**What the delegation costs, stated rather than hidden.** `previewAdjustTrove` reads the caller's
MUSD balance and `minNetDebt()`, which only the repayment gates use and a borrow never reaches. Both
ride in the same `Promise.all`, so this is two reads and no extra round trip. The alternative is a
second copy of the read set to go with the second copy of the rules, which is the thing being fixed.

**And it is a breaking change**, because the reason union widens. `docs/14-migration-0.2-to-0.3.md`
is the migration note. Reporting `ICR_NOT_IMPROVED_IN_RECOVERY_MODE` as `ICR_BELOW_THRESHOLD` would
have kept the union stable and named the wrong gate, which is not a trade this register can make.

**Pinned by** `packages/core/test/preview-agreement.test.ts`, which asserts the two previews agree
on verdict, reasons, binding constraint and every shared number across both modes and both sides of
the MCR, CCR, TCR and capacity boundaries, and then again end to end through the reads. That is the
test MK-001 implied and nobody wrote. Also `preview-adjust.test.ts`, "`_isDebtIncrease` is a
parameter, not a function of the amount", and `preview-adjust-reads.test.ts` for the write half.


**Revisited by MK-244, for `adjustTrove`.** This entry chose presence for the SDK's debt legs because the
contract takes a separate flag. The legs are not that flag, and presence made the SDK encode a zero leg as the
`(0, true)` the contract refuses where `(0, false)` is accepted. MK-244 reads the legs by value; the flag this
entry protects survives where the contract receives it, `withdrawMUSD` through `previewBorrow`.

---

## MK-061 · The claims table still says the post publish gate has never run, and MK-053 says it has

**Class** S3 · **Status** fixed · **Found by the external reviewers auditing the record**

**What is wrong.** `docs/09-review-and-validated-surface.md` §5 carries the row:

> | Post publish install verification | **Corrected: not verified.** `release.yml` `verify-published` exists and has never run, because publishing is out of bounds for this programme. It is verified by reading, not by execution |

Three places in the current tree contradict it:

- `FINDINGS.md` MK-053's summary row: "**fixed and proven by running it**".
- `docs/09-review-and-validated-surface.md` §2, twenty three lines above the table: "It was
  repaired and then run against the already published 0.2.0, which passed on every axis. So the
  verdict below rests on a check that now exists in fact and not only in a workflow file."
- The premise "publishing is out of bounds for this programme" is itself no longer true: 0.2.0 was
  published on 2026-08-28, as §2 states in the same document.

**Why it matters more than a stale sentence normally would.** The table's own preamble is:

> Every row ends at **true** or **corrected**. None points at an open finding: the point of this
> table is that a reader can trust it without cross referencing the register.

A table that promises to be trustworthy standalone, and then contradicts the register on the one row
about whether a supply chain gate has ever executed, is worse than no table. It is the exact defect
MK-053 is about, one layer up: a property asserted rather than checked.

**Decision.** Correct the row, and audit every other row in the table against the tree rather than
fixing only the one that was reported.

### Fixed, and the audit found two more

The audit was the point of the decision, and it was not empty. Three of the eleven rows were wrong:

| Row | What it said | What the tree says |
|---|---|---|
| Post publish install verification | "exists and has never run, publishing is out of bounds for this programme" | It ran, against the published 0.2.0, and passed (MK-053). 0.2.0 was published on 2026-08-28 |
| Unit layer runs with no chain | "8 files passing" | **16 files, 256 tests**, `anvil` off `PATH` and `MEZO_TESTNET_RPC_URL` unset. Two waves stale |
| Previews cover the trove lifecycle | "ten of eleven writes" | Not reconstructible from the tree. Counted from `createMusdClient`: **nine of twelve**. `redeem` gained `previewRedeem` under MK-048 and the row was never moved; `liquidate` and `batchLiquidate` have `isLiquidatable` rather than a preview |

The third had **two** more copies, found by searching the tree for the claim rather than for the
row: `docs/03-core-api.md`'s writes table, whose `redeem` row still read "none" in the preview
column and whose headline said "ten of eleven", and `README.md`'s "What this SDK does", which said
the same. All three are corrected, and `redeem`'s gate row now cites `TroveManager.sol:1299-1306`,
the partial that would leave a Trove under `minNetDebt`.

**The unit file count is now stated as of a wave rather than as a standing fact**, because a bare
number in a table that promises to be trustworthy standalone is a claim with an expiry date and no
label saying so.

The other eight rows were checked against the tree and are true: the coverage floors against
`vitest.config.mts:93-98`, the fork block against `ci.yml:31`, the Node matrix against
`ci.yml:79`, and the five corrected rows against the findings they cite.

---

## MK-062 · The provenance index's sweep row is two waves stale

**Class** S3 · **Status** fixed · **Found by the external reviewers auditing the record**

**What is wrong.** `FINDINGS.md`, "The reproducible set, and the command for each", carries:

> | The 1000 case differential sweep, 0 mismatches, 41 skipped | MK-016, `docs/09` §3 | `MK_DIFF_CASES=1000 MK_DIFF_SEED=20260826 pnpm test:fork` (two slices, see `MK_DIFF_FROM`) |

Two numbers in that row are wrong against the current record:

| Field | Provenance index | `docs/09` §3 and MK-048 | 
|---|---|---|
| Skipped | 41 | **89** |
| Slices | two | **four**, of 250 |

`docs/09-review-and-validated-surface.md:165` and `FINDINGS.md`'s MK-048 entry both say "four slices
of 250" and "89 of the 1000 skipped". The index row was written when the sweep covered fewer
operations and was never updated when MK-042 added five and MK-048 added redemption.

**Why it matters.** This row is the entry in the register that exists specifically so a reader can
re-run a number. A provenance index that misreports the number it is indexing fails at the one job
it has, and the failure is invisible because the number looks like a number.

**Decision.** Correct both fields, and check whether either figure is repeated anywhere else in the
tree before assuming this is the only copy.

### Fixed, and there was a third copy

The row now reads 89 skipped and four slices of 250, matching `docs/09` §3 and MK-048.

Searching the tree for both figures rather than assuming: `41` appeared only in that row, but "two
slices" had a **third copy**, in `docs/07-testing.md`'s measured cost table, which said "1000 cases,
about 96 minutes, across two slices". Corrected there too, along with the paragraph beside it, which
named `MK_DIFF_FROM` alone and predates `MK_DIFF_TO` existing. The 96 minutes is unchanged: it is
the measured wall clock and the slicing does not change it.

---

## MK-063 · Six S2 entries say `open` in their own header and `fixed` in the summary table

**Class** S3 · **Status** fixed for the ten the body settles; two named and left · **Found by the external reviewers auditing the record**

**What is wrong.** `FINDINGS.md` states its own rule at the top: statuses are the record, and the
summary table is the index into it. Six S2 entries contradict themselves across those two places.

| ID | Summary table | Section header | Body |
|---|---|---|---|
| MK-007 | `fixed` | `**Status** open` | "**Fixed, P4 wave.**" |
| MK-008 | `fixed` | `**Status** open` | "**Fixed, P4 wave.**" |
| MK-009 | `fixed` | `**Status** open` | "**Fixed, P4 wave.**" |
| MK-010 | `fixed` | `**Status** open` | "**Fixed, P4 wave.**" |
| MK-012 | `fixed` | `**Status** open` | "**Fixed, P4 wave.**" |
| MK-013 | `fixed` | `**Status** open` | "**Fixed, P4 wave.**" |

In all six the body records the fix and the header was never moved off its original value.

**What the same audit found beyond the six reported.** Auditing every entry rather than the six
named, by comparing each section's `**Status**` against its summary row:

- **MK-011** (S2): summary `documented`, header `open`, body "**Done, P4 wave. No code change, by
  design.**" Same defect, different target value.
- **MK-015** and **MK-017** (S3): summary `fixed`, header `open`, bodies "**Fixed, P9 wave.**"
- **MK-054** (S3): summary `fixed`, header `open, documented`, body carries a `### Fixed` section.
  The summary was corrected in `109c435` and the header was not.
- **MK-027** (S3) and **MK-035** (S2) contradict in the other direction: the summary says `fixed`
  and the body argues it is not. MK-027's body ends "This entry stays open until that is done" and
  the work it names is not all done. MK-035's body ends "**Decision.** Report, do not fix", and the
  gas margin it is about was fixed later under MK-037 without this entry being revisited. **These
  two are not stale headers and are not fixed here**: deciding which side is right is a judgment
  about the work, not a bookkeeping correction, and doing it inside a bookkeeping commit is how the
  six above happened.

**Decision.** Move the header to match the body for the ten entries where the body settles it
(MK-007, MK-008, MK-009, MK-010, MK-011, MK-012, MK-013, MK-015, MK-017, MK-054). Leave MK-027 and
MK-035 and record here that they are open contradictions with a named reason.

### Fixed for ten, and two are left standing on purpose

Each of the ten headers carries an HTML comment saying what it used to read, so the correction is
visible in the file rather than only in this entry.

**MK-027 and MK-035 are still contradictions and are deliberately not resolved here.** In both the
summary says `fixed` and the BODY argues it is not, which is the opposite direction from the ten
above and cannot be settled by moving a header:

- **MK-027** ends "This entry stays open until that is done", naming specific work: the root configs
  and the two `tsup.config.ts` files added to `scripts/tsconfig.json`, the `phase9-keeper` exclusion
  dropped, a tsconfig for `docs/.vitepress`. That work is not all done, so the summary row is the
  half that is wrong.
- **MK-035** ends "**Decision.** Report, do not fix", and the gas margin it is about WAS fixed
  later, under MK-037, without this entry being revisited. So the body is the half that is stale,
  and correcting it means deciding what MK-035 now claims, which is a judgment about the work.

Doing either inside a bookkeeping commit is exactly how the ten above happened. They are named here
so the next reader finds them as known contradictions rather than as new ones.

---

## MK-064 · An untracked agent settings directory turns `pnpm lint` red on a clean checkout

**Class** S3 · **Status** fixed · **Found by the external reviewers on a fresh clone**

**What is wrong.** `.gitignore` has no entry for `.claude/`. `biome.json` sets
`"vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true }`, and biome's
`useIgnoreFile` reads the **repository's** `.gitignore` only. It does not read the user's global
excludes file. So any contributor whose tooling writes `.claude/settings.local.json` into the
working tree has `pnpm lint` descend into it.

**Reproduced, not reasoned about.** A fresh `git clone` of `main` at `e0e9d43`, with a
`.claude/settings.local.json` of the ordinary shape written into it, and the repository's own biome
1.9.4:

```
$ biome check .
./.claude/settings.local.json format ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  × Formatter would have printed the following content:
    3   │ - ····"allow":·[
    4   │ - ······"Bash(pnpm·test:*)"
    5   │ - ····],
      3 │ + ····"allow":·["Bash(pnpm·test:*)"],

Checked 132 files in 48ms.
Found 1 error.
```

Against the same checkout with the directory absent: `Checked 131 files in 38ms. No fixes applied.`

**Why nobody saw it.** This machine's global excludes file, `~/.config/git/ignore`, contains
`**/.claude/settings.local.json`, confirmed with `git check-ignore -v`. So `git status` is clean
locally and the directory is invisible, while biome, which does not consult that file, lints it. The
defect is therefore **only** visible to someone whose git configuration differs from the author's,
which is every contributor and every CI runner that ever writes such a file.

**Blast radius.** `pnpm lint` is `ci.yml:99` and `release.yml:61`. A red gate on a working tree that
`git status` calls clean is the worst shape a gate failure can have, because the first thing anyone
does is look at `git status`.

**Decision.** Ignore the directory in the repository's own `.gitignore`, following the `.secrets/`
precedent already in that file: ignore the whole directory rather than one filename, with the reason
written beside it.

### Fixed, and the fix is verified by removing the failure it reproduced

`.gitignore` now carries `.claude/`. Verified in the working tree by writing the file, running
`biome check .` with and without the line, and comparing:

```
without the line:  Checked 133 files ...  Found 1 error.
with the line:     Checked 132 files ...  No fixes applied.
```

`git -c core.excludesFile=/dev/null check-ignore -v .claude/settings.local.json` now answers
`.gitignore:38:.claude/`, so the exclusion comes from the repository rather than from one
contributor's machine. The 132 against the earlier 131 baseline is this wave's new test file.

---

## MK-065 · `evaluateBorrow` reports its reasons in an order the contract does not use

**Class** S2 · **Status** fixed · **Found by us while fixing MK-058 and MK-059**

**Ground truth.** `_adjustTrove` checks in this order:

| Line | Gate |
|---|---|
| `:790` | `_requireTroveisActive` |
| `:840-845` | `_requireValidAdjustmentInCurrentMode`, which is `_requireICRisAboveMCR` (`:1201`) then `_requireNewTCRisAboveCCR` (`:1209`) in normal mode |
| `:850-852` | `_requireHasBorrowingCapacity` |

So the capacity gate is checked **after** the ratio gates, and a revert names the ratio first.

**SDK location.** `packages/core/src/math/previewBorrow.ts:236-240` pushes
`TROVE_NOT_ACTIVE`, `EXCEEDS_BORROWING_CAPACITY`, `ICR_BELOW_THRESHOLD`, `TCR_BELOW_CCR`, putting
capacity second.

**Why it is wrong rather than merely different.** `bindingConstraint` is documented as "The single
constraint that binds first" (`previewBorrow.ts:55-56`), and the adjust evaluator states the
contract's ordering as the reason its own list is ordered the way it is
(`previewAdjust.ts:214-215`): "so `bindingConstraint` is the one the chain would actually report
first". For a borrow that breaches both capacity and the ratio, `previewBorrow` names capacity and
the chain names the ratio. A caller who renders `bindingConstraint` as the single thing to fix is
told to add capacity, which is impossible: `maxBorrowingCapacity` never rises
(`BorrowerOperations.sol:879-897`).

**Pinned wrong by a passing test.** `packages/core/test/preview-verdicts.test.ts:240-245` asserts
the incorrect order exactly, which is why it survived. Same failure mode as MK-001, where a passing
test enshrined the wrong rule.

**Blast radius.** `bindingConstraint` and the order of `reasons` on `previewBorrow` only. `viable`
is unaffected, since it is `reasons.length === 0`. The adjust evaluator, and therefore every write
precheck, already has the correct order.

**Decision.** Fixed by the same delegation as MK-058, MK-059 and MK-060: the adjust evaluator's
ordering is the contract's, so a projection of it inherits the ordering for free. The test that
pinned the wrong order is corrected rather than deleted.

### Fixed

`reasons` now come back as `TROVE_NOT_ACTIVE`, then the mode's ratio gates, then capacity, which is
`_adjustTrove`'s own order. `preview-verdicts.test.ts` keeps the case and asserts the corrected
order, with the old assertion quoted in a comment above it so the regression is legible: this is the
same failure mode as MK-001, where a passing test enshrined the wrong rule, and deleting the
evidence of that would be the wrong repair.

**The mutation evidence is the cleanest in this wave.** The delegation was written first and the
test was not touched; the only unit test in the repository that failed was this one, on exactly the
assertion that pinned the wrong order. Nothing else moved.

**Scope correction, P13 wave.** This was fixed for `evaluateBorrow`, by delegation, and the entry
did not ask which OTHER evaluator reports reasons in an order. `previewRefinance` had the same
defect, and worse: its reason list contradicted a comment printed two lines above it claiming the
mode check came first (MK-075). Delegation could not reach it, because refinance has no evaluator
to project onto, so it needed the fix written out and a mutation of its own, which
`scripts/mutation-check.mjs` now carries.

A second assertion was added beside it for the case a caller actually meets: with the status gate
cleared and both capacity and the ratio breached, `bindingConstraint` is now the ratio. That matters
because capacity never rises (`BorrowerOperations.sol:879-897`), so naming it as the single thing to
fix tells a user to do something impossible.

---

## MK-066 · Coverage rested on which cases the generator happened to draw

**Class** S3, harness · **Status** fixed · **Found by us, by breaking it, while fixing MK-058**

**What happened.** Adding `recoveryDrawdownPercent` to the differential generator shifted its PRNG
stream, which is unavoidable when a dimension is added: the same seed produces different tuples
afterwards. The coverage ratchet then went **from 98.50 to 97.83** on lines and statements, and
functions from 100 to 96.42, with **no change to either file that lost coverage**.

Measured on both sides rather than inferred, `pnpm test:coverage`:

| | `main` at `e0e9d43` | this branch, before the fix |
|---|---|---|
| `src/errors/index.ts` | 99.33 lines, 100 funcs, uncovered `106,300` | 95.68 lines, 96.42 funcs, uncovered `106,293-304` |
| `src/redemption/redeem.ts` | 96.42 lines, uncovered `181-182,217` | 89.28 lines, uncovered `...78,181-182,217` |
| All files | **98.50** | **97.83**, below the 98 floor |

**The mechanism.** `redeem`'s precheck throw (`redemption/redeem.ts:172-178`) and
`RedemptionBreachesDebtFloor`'s populated message (`errors/index.ts:288-304`) had **no test of
their own**. They were reached only when the 24 case push subset happened to draw a redemption case
in the `IN_THE_GAP` band. After the shift it drew `AT_NET_DEBT` twice, both skipped for want of an
eligible Trove, and `WITHIN_HEADROOM` once, which does not reach the throw. The run 1 log says so
directly: `redeem bands: AT_NET_DEBT ran=0 skipped=2  WITHIN_HEADROOM ran=1 skipped=0`.

**Why this is a finding and not a chore.** The gate was green for two releases on a path nothing
tested, and the only reason anyone found out is that an unrelated change moved the dice. **Coverage
that depends on which cases a seeded generator draws is a lottery ticket, not a gate**, and it fails
in the direction that looks like someone else's fault: the files that lost coverage were untouched.
It is the same shape as MK-047 one level up, where the count of cases said nothing about what the
generator could express; here the coverage percentage said nothing about what was deliberately
tested.

**Decision.** Do NOT restore the draw, and do not lower the floor, which
`docs/08-conventions.md` §10 forbids anyway. Cover both paths deterministically and let the sweep go
on proving what only a sweep can prove.

### Fixed

`packages/core/test/preview-redeem.test.ts` gains a chain free block driving `redeem` into the
precheck against a fake chain holding one eligible Trove: the gap amount throws
`RedemptionBreachesDebtFloor` before simulate with both edges on the error, the bare constructor arm
is exercised, and an amount inside the headroom is asserted NOT to be refused, so the test is about
the gap rather than about the precheck firing on everything.

```
before  All files  97.83 stmts  92.57 branch  99.37 funcs  97.83 lines   FAILS the 98 floor
after   All files  98.55 stmts  92.83 branch   100 funcs   98.55 lines   exit 0
main    All files  98.50 stmts  91.76 branch   100 funcs   98.50 lines
```

Every metric now sits at or above `main`'s, which is what the ratchet requires: it is not enough to
climb back over the floor if the wave still left the number lower than it found it.

---

<!-- P13 wave: MK-067 through MK-077 -->

> **A note on the line numbers in the eleven entries below.** Every `packages/core/src/...` line
> range cites the tree **as the defect was found**, before the wave's own changes moved them.
> Contract citations into `mezo-org/musd` are at `43ef441` and are stable. This is the register's
> existing convention and it is stated here because eleven entries land at once and every one of
> them names a file the wave then edited. Where an entry needs to point at the CURRENT tree, it
> names the symbol rather than the line.

## MK-067 · `getBorrowingPower` charges a fee the contract skips, and cannot express exemption

**Class** S1 · **Status** fixed · **Found by an external correctness audit of the 0.3.0 tree, and
re-derived from the contract here before it was filed**

**Ground truth.** `BorrowerOperations.sol:637-643` charges the borrowing fee on an open only when
`!isRecoveryMode && !governableVariables.isAccountFeeExempt(_borrower)`. In Recovery Mode, and for
an exempt account, `vars.netDebt` is the bare draw, so the entire debt is `draw + 200` and the
binding ceiling is `draw + 200 <= coll * price / CCR` via `_requireICRisAboveCCR` (`:1337-1342`,
inclusive at `>=`).

**SDK location.** `packages/core/src/math/getBorrowingPower.ts`. It reads
`checkRecoveryMode` and uses it twice, at `:115` to pick the ratio threshold and at `:132` to skip
the resulting TCR condition, and then adds the fee unconditionally anyway: `feeOf` (`:121-127`)
calls `getBorrowingFee` with no mode branch, `feasibleWith` (`:129-142`) folds that into
`draw + fee + MUSD_GAS_COMPENSATION`, `:172` checks the `minNetDebt` floor against `best + feeOf`,
and `solveClosedForm` (`:221-263`) solves against the same premise. The file never imports
`isBorrowingFeeCharged` from `math/fee.ts:15-17`, which exists precisely to be the one copy of this
rule.

**And exemption is not merely unmodelled, it is inexpressible.** `GetBorrowingPowerParams`
(`:9-13`) is `{ collateral, price? }`. There is no account, so there is nothing to ask
`isAccountFeeExempt` about, even though `MathDeps.isAccountFeeExempt` (`math/deps.ts:17`) is already
wired and every other preview uses it.

**How this was established.** Not by reading. The excluded draw was sent to the real contracts on
an anvil fork of Mezo testnet at the pinned block 15043414, on phase 4's own Recovery Mode fixture
of 0.1 BTC at 40,000 USD:

```
getBorrowingPower = 2464202464202464202464
contract max      = 2466666666666666666666
under-report      = 2464202464202464202 wei   (2.4642 MUSD)
previewOpen(contractMax).viable=true fee=0 reasons=[]
OPENED ON CHAIN entireDebt=2666666666666666666666
resulting ICR=1500000000000000000  CCR=1500000000000000000  icr>=CCR? true
```

The draw the calculator excluded opened, and landed at ICR exactly equal to CCR. `previewOpen`, the
SDK's own evaluator for the same question, calls that draw viable with `fee: 0`. **Two surfaces, one
question, different answers**, which is the shape `docs/08-conventions.md` §11 exists to refuse.

**Blast radius.** The reported maximum is short by the fee: roughly 0.0999 percent of the draw at
the live 0.1 percent rate, in Recovery Mode for every caller, and in every mode for the exempt
cohort MK-018 measured as non empty on mainnet. No error is raised. A UI sizing a "max" button is
wrong by that amount exactly when the system is stressed, which is when it is most consulted.

**Why S1 and not S2.** Nothing reverts. The number is simply small, plausible, and silently wrong,
which is this register's own S1 definition.

**Decision.** Fix, and fix at the cause rather than by adding a mode branch here. See MK-069.

### Fixed

**The feasibility predicate IS `evaluateOpen` now.** `getBorrowingPower` no longer decides any open
rule: `feasibleWith` builds an `evaluateOpen` input and returns its `viable`, with `minNetDebt: 0n`
and `troveStatus: undefined` so the only reasons it can produce are the two ratio ones, and the debt
floor is applied once at the end through the same evaluator. The individual ratio, the mode correct
threshold and the resulting TCR therefore have one implementation in this package and it is not in
this file.

**Why a projection rather than the delegation `previewBorrow` uses**, stated in the source in one
sentence a reader can check: `previewBorrow` can BE `previewAdjustTrove` because a borrow is one
call with one verdict, while a maximum is not a case of the evaluator that judges a candidate. So it
stays a solver, and what it solves over is the evaluator. The caps inside `solveClosedForm` are
search bounds, never verdicts, and the two guards before its `return` refuse to answer unless the
draw is feasible and the draw plus one wei is not, so a wrong cap costs round trips and cannot
produce a wrong maximum.

**Exemption is expressible.** `GetBorrowingPowerParams` takes an optional `account`, and the
exemption is read through the `MathDeps.isAccountFeeExempt` that was already wired. The read is
skipped in Recovery Mode, where the mode alone settles the conjunction, and skipped when no account
is supplied, matching `previewOpen`'s rule that with nobody to ask about, nothing is asked.
`useBorrowingPower` threads it, and the query key carries it, because the answer differs per account.

**Proven on chain, not argued.** `phase4.fork.test.ts` now opens at the reported maximum in Recovery
Mode against the real contracts and asserts one wei more reverts:

```
[phase4] borrowingPower(RM, 100000000000000000) = 2466666666666666666666
[phase4] RM open at max: entireDebt=2666666666666666666666 icr=1500000000000000000
```

2466666666666666666666 against the 2464202464202464202464 this returned before, which is the whole
CCR ceiling with no fee taken out of it, landing at ICR exactly CCR. **Pinned by**
`packages/core/test/borrowing-power-agreement.test.ts`, twelve cases across both modes, an exempt
account, a TCR bound scenario and two awkward prices, and by two mutations in
`scripts/mutation-check.mjs`.

**And four statements of dead code came out with it, found by the ratchet rather than by reading.**
`solveClosedForm` carried a downward walk beside its upward one, and coverage showed it had never
executed. It cannot: with a linear fee, `draw = floor(available * P / (P + rate))` gives
`draw + fee(draw) <= available`, so the seed's entire debt is at or under `cap`, and both thresholds
`feasibleWith` tests are inclusive, so a seed exactly at the cap is feasible rather than one wei
over. Checked over 32 combinations of rate, from zero to 300 percent, against five caps including
an odd one and 1e30: no seed exceeded its cap. Removing it is safe because the guards that follow
already refuse to answer on an infeasible draw and fall back to the bounded binary search, which is
also where a non-linear fee is handled. A branch no test can reach is worse than absent: a reader
assumes it was exercised.

---

---

## MK-068 · The `openTrove` write path reaches past the effective fee helper defined in its own file

**Class** S2 · **Status** fixed · **Same audit, same root cause as MK-067**

**Ground truth.** `BorrowerOperations.sol:637-643` again, plus the three places the resulting
`netDebt` is used on the open path: `_requireAtLeastMinNetDebt(vars.netDebt)` (`:645`), the composite
debt `_getCompositeDebt(vars.netDebt)` (`:648`), and the sort key
`_computeNominalCR(msg.value, compositeDebt)` (`:652`).

**SDK location.** `packages/core/src/trove/index.ts` defines `effectiveBorrowingFee` at `:85-117`,
which reads the mode and the exemption and returns zero when either applies. `borrow` uses it at
`:432`. `adjustTrove` uses it at `:543`. `openTrove` at `:300` calls the raw `getBorrowingFee`
(`:149-156`) instead, two hundred lines below the correct helper in the same file.

**Three consequences, recorded separately because they fail differently.**

**(a) The debt floor precheck is computed against the wrong quantity.** `:307` forms
`netDebt = debt + fee` and `:308` throws `BelowMinimumDebt` when it is under the floor. In Recovery
Mode or for an exempt account the contract's `netDebt` is the bare draw, so in the band
`draw < minNetDebt <= draw + fee` the precheck passes and the chain reverts at `:645`. **This is
exactly the second order effect MK-004's own entry names and records as closed.** It is closed in
`previewOpen` and was still open here. Reproduced against a stubbed client at draw 1799 MUSD against
a 1800 MUSD floor: `openTrove(RM)` and `openTrove(exempt)` both proceeded to send, while
`previewOpen` on the same inputs returned `viable=false reasons=["BELOW_MINIMUM_DEBT"]`.

**(b) The fee cap refuses a call the contract accepts.** `:301` calls `assertFeeWithinCap(debt, fee,
maxFeePercentage)` with the quoted fee. A caller passing `maxFeePercentage: 0n`, meaning "open only
if there is no fee", is refused with `MaxFeeExceeded` in precisely the state where the protocol
charges nothing. Nothing reaches the chain. Reproduced: `MaxFeeExceeded: Borrowing fee
(1000000000000000 of 1e18) exceeds the supplied cap (0 of 1e18)`. This is the loudest of the three
and the only one that blocks a valid operation outright.

**(c) The insertion hint names a position that will not exist.** `:314` computes the hint from
`debt + fee + MUSD_GAS_COMPENSATION` while the contract inserts at `_computeNominalCR(msg.value,
netDebt + 200)` with no fee in the term (`:648`, `:652`). `SortedTroves.reInsert` re-validates and
traverses, so the cost is gas and latency rather than a wrong number. This is MK-006's class, on the
one path MK-006's own note says was "accidentally correct" and therefore never exercised the defect.

**Blast radius.** (a) and (c) are recoverable: simulate catches (a) and the chain corrects (c). (b)
is not, and it is silent from the caller's side in the sense that the error names a fee that will
never be charged.

**Decision.** Route the open through the same effective fee every other write uses. See MK-069.

### Fixed

`openTrove` calls `effectiveBorrowingFee`, the helper defined at `trove/index.ts:85-117` that
`borrow` and `adjustTrove` already used, and that helper now makes its decision through
`isBorrowingFeeCharged` rather than re-deriving the conjunction. All three consequences close
together, because all three read the same variable: the floor is measured against the contract's
`netDebt`, the cap compares a fee that will actually be charged, and the hint is computed from the
composite debt the contract will insert by.

`refinancingFee` and `previewRefinance` route through the rule too, passing `false` for the mode
with the reason stated: `_requireNotInRecoveryMode` (`:1023`) is the first thing `_refinance` does,
so a refinance that reaches the fee is a refinance in normal mode. That is a contract guarantee, not
an assumption, and saying which it is was the point.

**Pinned by** `packages/core/test/p13-gates.test.ts`, driven through the real `openTrove` against a
stubbed client so the helper it actually calls is what is under test: the floor refuses the band in
Recovery Mode and for an exempt account, the same draw passes when the fee IS charged so the band is
demonstrably real, a zero fee cap is honoured in Recovery Mode, and the cap still bites in normal
mode so it was not simply disabled.

---

---

## MK-069 · One rule, eight places, and the four wrong ones agree with each other

**Class** S2 · **Status** fixed · **The root cause behind MK-067, MK-068 and MK-070**

`docs/08-conventions.md:309-325` §11 is unambiguous: "A rule the protocol has once is implemented
here once ... it has now happened twice with the same root cause." MK-001 was the first occurrence.
MK-058, MK-059 and MK-065 were the second. **This is the third, and it is wider than either**,
because the copies are not two but four.

**The rule.** Whether the borrowing fee applies at all. The contract decides it in two places, and
they are the same condition: `BorrowerOperations.sol:637-643` on open, and `:813-818` on a debt
increase. On refinance the mode half is already guaranteed, because `_requireNotInRecoveryMode`
(`:1023`) is the first requirement on that path, so only the exemption half is live (`:1033-1035`).

**Every place the SDK decides it**, enumerated rather than sampled, which is the point of this
entry:

| Location | Role | Decides the rule how | Correct? |
|---|---|---|---|
| `math/fee.ts:15-17` | `isBorrowingFeeCharged`, the canonical rule | `!isRecoveryMode && !feeExempt` | yes, by definition |
| `math/previewOpen.ts:154-163` | open preview | calls `isBorrowingFeeCharged` | yes |
| `math/previewAdjust.ts:375-384` | adjust preview | calls `isBorrowingFeeCharged` | yes |
| `trove/index.ts:85-117` | `effectiveBorrowingFee`, write path | re-derives inline | yes, and duplicated |
| `trove/index.ts:654-678` | `refinancingFee`, write path | re-derives the exemption half | yes, and duplicated |
| `math/previewRefinance.ts:111` | refinance preview | re-derives the exemption half | yes, and duplicated |
| `math/getBorrowingPower.ts:121-127` | open time calculator | **always charges** | **no, MK-067** |
| `trove/index.ts:300` | write path, open | **always charges** | **no, MK-068** |
| `test/phase4.fork.test.ts:184-190` | the reference search `getBorrowingPower` is compared against | **always charges** | **no, MK-070** |
| `test/harness/openTroveRaw.ts:62-69` | the fixture every fork test opens with | **always charges** | **no, MK-070** |

**What structurally prevented the four from drifting: nothing.**
`packages/core/test/preview-agreement.test.ts` is exactly the instrument §11 asks for, and it pins
`previewBorrow` against `previewAdjustTrove` in both modes across every boundary. No equivalent
existed for `getBorrowingPower` against `evaluateOpen`, and `getBorrowingPower` is not one of the
nine operations `test/differential/generate.ts:202-211` sweeps. **The two surfaces answer the same
question and had never been compared to each other, once.**

**The harness copy has an effect of its own, observed rather than argued.**
`openTroveRaw` returns an `entireDebt` it computes locally at `:69` as `draw + fee + 200`, under the
comment "Composite (entire) debt the contract will insert by". In Recovery Mode that comment is
false. Read back off the chain on the same fork run:

```
openTroveRaw REPORTED entireDebt = 2669133333333333333332
chain ACTUAL          entireDebt = 2666666666666666666666
overstates by                    = 2466666666666666666 wei   (exactly the skipped fee)
```

So any fork assertion comparing against the harness's reported figure in Recovery Mode is comparing
against a wrong number, and the hint the helper computes is for a position that does not exist.

**What makes this a finding rather than a tidy up.** Four independent copies of one condition all
got it wrong the same way, and each one passes its own tests. The 120 case differential sweep run
while auditing this reached Recovery Mode 27 times across eight operations and reported zero
mismatches, which is a real result for the surface it covers and also the shape of the blind spot:
the sweep exercises `previewOpen`, which is right, and never asks `getBorrowingPower` anything.

**Decision.** Every place that decides whether the fee applies goes through the one exported rule,
and the two surfaces that answer the same question get the pin that §11 requires. Adding a mode
check to `getBorrowingPower` and stopping there would leave four copies where there should be one.

### Fixed

Every row in the table above now reads through `isBorrowingFeeCharged`, and the two test copies
state the CONTRACT's condition rather than importing the SDK's, so they remain independent checks
rather than becoming tautologies. That distinction is the one MK-070 turns on and it is written into
both files.

**And the rule that would have caught it is now in the conventions**, as
`docs/08-conventions.md` §12: closing a finding requires enumerating every place the rule it
concerns is decided, not only the location where the defect was observed. MK-004, MK-017, MK-018 and
MK-065 were each remediated exactly where they were seen and each left live copies behind; those
four entries now carry a scope correction saying so.

**The sweep reaches it now.** `borrowingPower` is a generated operation
(`test/differential/generate.ts`), swept inverted because a maximum has no verdict: the SDK supplies
the amount and the chain supplies the verdict, so the case attempts the maximum plus one wei first,
which must revert and changes no state, then the maximum itself, which must open.

**Measured against the present generator**, which is the number `docs/09` §3 points here for, since
adding a tenth operation shifts the PRNG stream and the recorded 1000 case figures describe the nine
operation one. `MK_DIFF_OP=borrowingPower MK_DIFF_CASES=400 MK_DIFF_SEED=20260826 pnpm test:fork`,
one fresh anvil at pinned block 15043414, 176 seconds, exit 0:

```
ran=33 skipped=2  bands: boundary=19 extreme=3 middle=11
mismatches: FALSE_VIABLE=0 FALSE_BLOCKED=0 NUMBERS=0
recovery mode: reached=8 of 33
recovery mode by op: borrowingPower ran=6 skipped=2
threw=0
```

**Six of them executed in Recovery Mode against the real contracts**, each opening at the reported
maximum and being refused one wei above it. That is the count that matters rather than the total:
MK-048 established that a band which never ran proves nothing, and Recovery Mode is the mode this
finding lived in. The 2 skips are a maximum of zero, which means no valid open exists for that
collateral at all.

### The wave's fork window

Five consecutive `pnpm test:fork` runs at pinned block 15043414 followed by one
`pnpm test:coverage`, recorded by exit code, with the code tree hashed before the first and after
the last so the window is provably over ONE tree (`a5a5d56bb9611cb399cd4f51d38ecf83` at both ends):

| Run | Exit | Tests | Sweep |
|---|---|---|---|
| 1 | 0 | 104 passed, 1 skipped | 0 FALSE_VIABLE, 0 FALSE_BLOCKED, 0 NUMBERS |
| 2 | 0 | 104 passed, 1 skipped | same |
| 3 | 0 | 104 passed, 1 skipped | same |
| 4 | 0 | 104 passed, 1 skipped | same |
| 5 | 0 | 104 passed, 1 skipped | same |
| coverage | 0 | 396 passed, 1 skipped | 98.62 stmts, 92.96 branch, 100 funcs, 98.62 lines |

Against `main`'s 98.50 / 91.76 / 100 / 98.50 and the previous wave's 98.55 / 92.83 / 100 / 98.55,
so the wave leaves every metric at or above where it found it, which MK-066 established is the bar
rather than merely clearing the floor. **The branch floor moves 91 to 92**; functions is left at 99
although it measures 100, because a floor of 100 is a sharper control than this ratchet and deserves
its own argument rather than being slipped in beside eleven findings.

**The hash is recorded because two earlier attempts at this window were invalidated by edits that
landed mid-window**, both of them comment only: a docstring line in `read/system.ts`, and then two
`{@link}` references to private helpers that turned the TypeDoc build red. A window over a moving
tree is not a window, and "the change was only a comment" is exactly the reasoning this register
exists to refuse. Both were stopped and re-run from the start. The third attempt was preceded by
running every static gate to completion first, which is the order this should have been done in.

**A third copy surfaced while fixing MK-071**, which is the entry's own argument working:
`preview-redeem.test.ts` carried the same wrong divisor as the source, so its assertion could only
confirm the defect. Found by fixing the source and watching the test go red.

---

---

## MK-070 · A Recovery Mode test that passes because of the defect, and fails when it is fixed

**Class** S2, harness · **Status** fixed · **The second occurrence of the phase 6 pattern**

MK-030 and the phase 6 wave established the shape: a test whose assertion is reconstructed from the
implementation's own arithmetic proves self consistency and nothing else. This is that, in the one
place it costs the most, and it is worse than the first occurrence because it does not merely fail
to catch the defect. **It fails when the defect is removed.**

**The assertion.** `packages/core/test/phase4.fork.test.ts:327-331`:

```ts
const bpRM = await c.getBorrowingPower({ collateral: coll, price: p })
const entireAtBp = bpRM + (await c.getBorrowingFee(bpRM)) + GAS
expect(
  computeICR({ collateral: coll, entireDebt: entireAtBp, price: p }),
).toBeGreaterThanOrEqual(CCR - 1n)
```

It rebuilds the projected debt with the same unconditional `+ getBorrowingFee` the implementation
uses, so it can only ever agree with it. It never opens a Trove at `bpRM` in Recovery Mode, which is
the one thing that would have settled it.

**Evaluated both ways on its own fixture**, arithmetic rather than assertion, because mutating the
source to check would have been a fix:

```
coll = 0.1 BTC, price = 40,000 USD, rate = 0.1%, CCR = 1.5e18

today (fee subtracted)      entireAtBp=2666666666666666666666  ICR=1500000000000000000  passes=true
fixed (fee skipped in RM)   entireAtBp=2669133333333333333332  ICR=1498613782251417438  passes=false
```

Correcting the fee raises `bpRM` by the fee, the test then adds the fee back on top of a value that
already consumed the whole ceiling, its reconstructed debt overshoots the CCR cap, and the assertion
breaks. **Anyone fixing MK-067 sees this test go red and has every reason to read that as the fix
being wrong.** That is the cost, and it is why this is filed at S2 rather than as hygiene.

**The comparison above it has the same defect.** `phase4.fork.test.ts:160-215` validates
`getBorrowingPower` against a binary search written out in the test file, under the comment "Kept
here rather than in src so the comparison is against the implementation this replaced, not against a
shared helper that could drift with it". That reference calls `feeOf(draw)` unconditionally at
`:184-190`, so it is a copy of the defect and the comparison can only agree. The intent of the
comment was right and the execution reproduced the thing it was guarding against.

**And the chain free tests cannot see the branch at all.** Every unit test that drives
`getBorrowingPower` stubs `checkRecoveryMode` to `false`: `s2-guards.test.ts:135` and
`preview-adjust-reads.test.ts` through `fakeDeps`. The coverage gate reports the Recovery Mode
branch as covered, because phase 4 executes it. **Coverage measured that the line ran. Nothing
measured that it was right**, which is MK-053's lesson one level down: a gate that cannot fail is a
claim.

**Decision.** The Recovery Mode assertion compares against the chain. The reference search stops
being a copy. The agreement pin §11 asks for gets written. Every new pin gets a mutation.

### Fixed

**The assertion sends transactions.** `phase4.fork.test.ts` attempts the maximum plus one wei first,
asserts `previewOpen` refuses it AND the chain reverts, then opens at the maximum, then reads the
Trove back and asserts it exists, that its ICR is at or above CCR, and that its entire debt is
exactly `draw + 200`, which is the assertion that no fee was charged. The refusal goes first because
it changes no state and so cannot move the system out of Recovery Mode before the acceptance is
tried.

**The reference search states the contract's condition.** It stays out of `src`, which was always
the right instinct, but its fee is now gated on `!isRecoveryMode && !feeExempt` written out, with
the exemption half a named constant and the reason it is constant stated. Importing
`isBorrowingFeeCharged` there would have made the comparison agree by construction, which is the
defect rather than the fix.

**The fixture stopped lying about what it opened.** `test/harness/openTroveRaw.ts` reads
`checkRecoveryMode` and applies the same condition, so its returned `entireDebt` is what the chain
stored and its hint is for a position that exists.

**And the chain free blind spot is closed.** `borrowing-power-agreement.test.ts` exercises Recovery
Mode without a chain, so the branch every unit test used to stub to `false` is now covered by
assertions about its behaviour rather than only by a coverage percentage.

---

---

## MK-071 · A shadowed seconds per year, holding the value its own canonical file names as wrong

**Class** S3 · **Status** fixed · **The third instance of MK-017's class**

**Ground truth.** `solidity/contracts/dependencies/InterestRateMath.sol:9` is
`SECONDS_IN_A_YEAR = 31_556_952`, the Gregorian year, and `calculateInterestOwed` (`:12-22`) divides
by it.

**SDK location, two values under one name.** `packages/core/src/constants.ts:26` is
`SECONDS_PER_YEAR = 31_556_952n`, and its docstring at `:22-23` says it was verified on the fork and
is explicitly "NOT 365 (31_536_000)". `packages/core/src/math/previewRedeem.ts:183` then declares a
module local `const SECONDS_PER_YEAR = 365n * 24n * 3600n`, which is 31_536_000, under the docstring
"The divisor the protocol's interest accrual uses". **It is the exact value the canonical file
singles out as incorrect, asserted to be the protocol's.** The name is shadowed, so nothing in the
file reads as a conflict.

**What it feeds.** Only `marginFor` (`:188-190`), which sizes `accrualMargin` and
`nextViableAmount`, and which decides at `:230` whether an offer consumes a Trove whole.

```
constants.ts SECONDS_PER_YEAR     = 31556952n
previewRedeem.ts SECONDS_PER_YEAR = 31536000n   equal? false

debt=2000 MUSD   sdkMargin=380517503805175    trueMargin=380264862081737    +0.0664%
debt=10000 MUSD  sdkMargin=1902587519025875   trueMargin=1901324310408685   +0.0664%
```

**Consequence, in both directions.** On `nextViableAmount` a margin 0.0664 percent too large is
conservative and harmless, and the field's own docstring says overshooting cannot cost the call. On
the `consumesWhole` classification it is not: in a band roughly one micro MUSD wide the SDK treats
an offer as a partial, finds it breaches the floor, and reports `PARTIAL_BREACHES_DEBT_FLOOR` for an
amount the chain would accept. `redemption/redeem.ts:172-178` turns that reason into a thrown
`RedemptionBreachesDebtFloor` before simulate, so the call never reaches the chain.

**Why S3 and why it is filed at all.** The band is narrow enough that no realistic caller lands in
it. It is filed because MK-048's entire correction turns on this figure, because MK-017,
"Duplicated derivations and placeholder values", is marked fixed, and because a constant whose
docstring asserts a provenance it does not have is how the next reader gets it wrong.

### Fixed, and there was a third copy

`previewRedeem.ts` imports `SECONDS_PER_YEAR` from `constants.ts` and declares nothing. The shadow
is gone.

**The test carried the same wrong value**, which is why nothing caught it:
`preview-redeem.test.ts:56` computed its expected margin with `365n * 24n * 3600n` under a comment
saying it was "recomputed here rather than imported, so a change to either side shows up". The
instinct was right and the value was the source's own mistake, so the two agreed and the assertion
proved nothing. It now uses the CONTRACT's `31_556_952` as a named literal, which keeps it an
independent statement while making it a true one. Found by fixing the source and watching five
assertions go red, which is the evidence that the pin is now real.

---

---

## MK-072 · The borrowing capacity headroom is the distance to liquidation, published as spendable

**Class** S3 · **Status** fixed · **A class this register had no entry for**

MK-050 files a figure the chain outgrows against `previewClose.musdRequired`. MK-051 files the same
shape with the sign flipped against `maxWithdrawableCollateral.amount`. **This is the third
instance, and the interesting part is not the staleness. It is what the number turns out to be.**

**Ground truth.** `_calculateMaxBorrowingCapacity` (`BorrowerOperations.sol:1323-1328`) is
`(_coll * _price) / (110 * 1e16)`. `_requireICRisAboveMCR` (`:1330-1335`) is `_newICR >= MCR` with
`MCR = 1.1e18` (`LiquityBase.sol:22`). **Those are the same expression.** Checked numerically at the
fork's live price rather than asserted: `coll * price / (110 * 1e16)` and `coll * price / MCR` both
give `70046461200000000000000` for 1 BTC at 77051.10732 USD.

So `maxBorrowingCapacity` is exactly the entire debt at which the position is liquidatable, computed
at the opening price, and `capacity - entireDebt` is the distance to that point.

**SDK location.** `packages/core/src/math/previewAdjust.ts:57-64`. `BorrowingCapacity.remaining` is
documented as "`capacity - entireDebt`, floored at zero. The headroom for `draw + fee`, not for the
draw." That sentence invites a caller to size a draw from it. There is no window, no margin, and no
mention that the ICR gate binds at the same point.

**Observed on a fork**, open 1 BTC against 2000 MUSD, then warp with only the delay varied:

```
t0 capacity=70046461200000000000000 entireDebt=2202000000000000000000
   remaining=67844461200000000000000
   largest draw that fits the reported headroom = 67776684515484515484515

warp    0s  previewBorrow.viable=true   reasons=[]
warp    1s  preview.viable=false  chain=REVERTED (BorrowerOps: An operation that would result in ICR < MCR)
warp   60s  preview.viable=false  chain=REVERTED (same)
warp  600s  preview.viable=false  chain=REVERTED (same)
warp 3600s  preview.viable=false  chain=REVERTED (same)
```

**One second is enough**, the same finding MK-051 records for the withdrawal maximum, and for the
same reason: the debt in the comparison accrues.

**Who is exposed and who is not, stated precisely.** A caller who then runs `previewBorrow` is safe:
it correctly returns `viable: false` at one second, so the SDK is self consistent and this is not a
wrong verdict. The exposure is a caller who sizes from `getBorrowingCapacity` alone, which is a
separately exported function (`src/index.ts:94`) and a React hook (`useBorrowingCapacity`).

**Decision.** Say it on the field, where TypeDoc publishes it, the way `previewClose` and
`previewRedeem` already do. Not a margin: unlike a redemption headroom, a caller who wants to spend
the whole thing has a live evaluator two lines away, and inventing a window here would be a number
chosen to feel safe rather than one the contract names.

### Fixed

`BorrowingCapacity.remaining` carries the whole thing on the field: that `capacity` and the entire
debt at `ICR == MCR` are the same expression, that a draw consuming it lands at the liquidation
threshold, that one second of interest is enough to make the same call revert, and that the way to
size a draw is `previewBorrow` rather than this number.

**No pin, and that is stated rather than glossed.** This change is a docstring: it alters no
behaviour, so there is nothing for a test to assert and nothing for `mutation-check.mjs` to mutate.
The measurement behind it is in this entry and is reproducible on a fork by opening a position,
reading `getBorrowingCapacity`, warping, and attempting a draw sized from the reported headroom.

---

---

## MK-073 · MK-051 names the docstring as its acceptance condition, and the docstring is silent

**Class** S3 · **Status** fixed · **Found by checking whether an open entry's own stated remedy was met**

MK-051 closes with: "`maxWithdrawableCollateral` returning a number good for one block is defensible
only if the docstring says so." Its status is `open, documented`.

`packages/core/src/math/previewAdjust.ts:419-423`, the docstring on `MaxWithdrawable.amount`, in
full: "BTC wei that can be withdrawn in a single `withdrawCollateral` call. **Zero in Recovery
Mode**, where `_requireNoCollWithdrawal` (`:1270`) refuses any withdrawal at all." There is no
mention of expiry.

**"Documented" meant documented here, not on the API**, and the distinction matters because this
register is not what a consumer reads. TypeDoc publishes the docstring. `previewClose.ts:49-52` and
`previewRedeem.ts:122-125` both carry their staleness warning on the field where a caller meets it.
This one does not, and MK-051 is the entry that says it should.

**Why it is filed separately rather than folded into MK-051.** MK-051's own remedy is a margin plus
its tests, deferred deliberately. This is the half that was already agreed and simply not done, and
folding it in would let the deferral cover it.

### Fixed

`MaxWithdrawable.amount` now carries the expiry, with MK-051's own measured table behind it: accepted
at 0 seconds, refused at 1, 60, 600, 3600 and 86400, with half the maximum succeeding throughout as
the control. It also says what a caller should do instead, and that the refusal is a typed error
before sending rather than a failed transaction, which is the material difference from MK-048.

**MK-051 stays open**, deliberately. Its remedy is a margin plus tests plus a sweep, and that is a
wave. What is closed is the clause MK-051 itself named as the acceptance condition for shipping
without one. Like MK-072, this is a docstring change with no behaviour to pin.

---

---

## MK-074 · The last Trove in the system can neither be closed nor liquidated, and neither predicate knows

**Class** S3 · **Status** fixed · **Direction: the preview says yes and the chain refuses**

**Ground truth, close.** `TroveManager._closeTrove` (`:1390-1399`) gates on the same `canMint` flag
the close preview already reads:

```solidity
uint256 TroveOwnersArrayLength = TroveOwners.length;
if (musdToken.mintList(address(borrowerOperations))) {
    _requireMoreThanOneTroveInSystem(TroveOwnersArrayLength);
}
```

and `_requireMoreThanOneTroveInSystem` (`:1488-1496`) requires
`TroveOwnersArrayLength > 1 && sortedTroves.getSize() > 1`, reverting with "TroveManager: Only one
trove in the system". `BorrowerOperations._closeTrove` reaches it through
`troveManagerCached.closeTrove(_borrower)` (`:976`), which is `TroveManager:472-475`.

**Ground truth, liquidate.** `_liquidate` (`TroveManager.sol:1058-1060`) returns an empty
`singleLiquidation` when `TroveOwners.length <= 1`, so `batchLiquidateTroves` accumulates nothing
and reverts at `:690-693` with "TroveManager: nothing to liquidate".

**SDK locations.** `packages/core/src/math/previewClose.ts:114-118` pushes four reasons; the fifth is
absent, even though `canMint` is already in hand at `:153-157`. `packages/core/src/read/system.ts:61`
and `packages/core/src/read/getTrove.ts:94` both return `icr < MCR`, which is the complete
liquidation predicate for every Trove but one.

**Likelihood, stated honestly: low.** The pinned testnet fork carries 230 sorted Troves. This is
reachable on a fresh deployment, in a test fixture, and in a system in terminal decline, and nowhere
else. It is filed because it is a contract condition the SDK does not enforce while claiming to
enumerate them, and because the read that satisfies the close half is already being paid for.

### Fixed, and it forced a dedup on the way

`previewClose` gains `LAST_TROVE_IN_SYSTEM`, reported LAST because `BorrowerOperations.sol:976`
reaches it last, gated on the same `canMint` the contract gates it on, and evaluated from
`getTroveOwnersCount()` and `SortedTroves.getSize()` read together. Both are read rather than one
inferred from the other, because the contract requires both to exceed one and they are different
structures. They are optional on `EvaluateCloseInput` under MK-047's rule: `undefined` is "not
asked", not "there is one".

**The liquidation half could not be fixed in one place, because there was no one place.**
`read/getTrove.ts` and `read/system.ts` each inlined `icr < MCR`, so MK-074's condition would have
had to be written twice, which is §11's defect being introduced while fixing something else. Both
now call `isTroveLiquidatable` in `math/compute.ts`, and the docstring on `read/system.ts` no longer
claims a fork test is what keeps them agreeing. **Note the two paths differ**: the close gate
consults the sorted list size as well as the count, the liquidation gate consults only the count
(`TroveManager.sol:1058-1060`), and the predicate takes only the count for that reason.

**Pinned by** `p13-gates.test.ts`, including the `canMint` conditionality, the "not asked" case, the
ordering, and both halves of the count-or-size condition. Two mutations.

---

---

## MK-075 · `previewRefinance` orders its reasons against the comment printed directly above them

**Class** S3 · **Status** fixed · **MK-065's defect, in the evaluator MK-065 did not touch**

**Ground truth.** `_refinance` runs `_requireNotInRecoveryMode(vars.price)` at
`BorrowerOperations.sol:1023` and `_requireTroveisActive` at `:1024`. The mode check is genuinely
first, before the Trove is checked for existing at all.

**SDK location.** `packages/core/src/math/previewRefinance.ts:122-128` pushes `TROVE_NOT_ACTIVE`
first. The comment at `:124-125`, immediately above the mode check, reads: "The mode check is the
contract's FIRST requirement, so it is reported even when other constraints would also fail: it is
what the caller actually hits." **The code does the opposite of what the comment claims two lines
later**, and the file's own header at `:11-12` says the rules are listed "in the order the contract
applies them".

Reproduced on a closed Trove while the system is under CCR:

```
SDK reasons          : [ 'TROVE_NOT_ACTIVE', 'RECOVERY_MODE', 'TCR_BELOW_CCR' ]
SDK bindingConstraint: TROVE_NOT_ACTIVE
chain reverts with   : "BorrowerOps: Operation not permitted during Recovery Mode"
```

`viable` is correct either way. Only `bindingConstraint` misnames the gate, which is precisely
MK-065's finding, "reports its reasons in an order the contract does not use", marked fixed for
`evaluateBorrow` by delegation. This evaluator has no evaluator to delegate to, so it was not
reached, and `scripts/mutation-check.mjs` has no mutation covering it.

### Fixed

`RECOVERY_MODE` is pushed first, the `RefinanceBlockReason` union is reordered to match with a
contract line on each member, the header's numbered list says the mode check precedes
`_requireTroveisActive`, and the field docstring says "in contract call order" rather than "in a
fixed order". **The header also cited `:1024` for `_requireNotInRecoveryMode` and that was wrong:
`:1023` is the mode check and `:1024` is the status check.** A citation off by one line is how the
next reader reproduces the ordering mistake, so it is corrected rather than left.

**And it has the mutation MK-065 never got**, which is the part that stops this recurring: swapping
the two pushes back turns `p13-gates.test.ts` red.

---

---

## MK-076 · `limitedBy` reports the individual ratio whenever the answer is zero, including when the system ratio is what binds

**Class** S3 · **Status** fixed

**SDK location.** `packages/core/src/math/previewAdjust.ts:520`:

```ts
const limitedBy = amount === 0n || byIcr <= bySystem ? 'ICR' : 'TCR'
```

The `amount === 0n` clause swallows the case where the ICR gate would allow a large withdrawal and
the system TCR gate allows none. Reproduced with an over collateralised Trove in a system sitting at
exactly CCR:

```
ICR gate alone would allow : 9975800000000000000 wei
TCR gate allows            : 0 wei
amount                     = 0
limitedBy                  = ICR   (TCR is what binds)
```

**The docstring makes the argument against the code.** `:448-449` says the field exists because "you
can withdraw 0" and "you can withdraw 0 because the system is in Recovery Mode" are different
messages to a user. The same is true of the system ratio, and a caller renders "your position is too
thin" when the correct message is "the system is at its floor". Nothing is wrong with `amount`; the
label attached to it is.

### Fixed

`const limitedBy = byIcr <= bySystem ? 'ICR' : 'TCR'`. The `amount === 0n` clause is gone, so the
label names whichever allowance is smaller regardless of what that allowance happens to be. Ties go
to ICR, which is the gate a caller can act on. `RECOVERY_MODE` still short circuits ahead of both,
and the `entireDebt === 0n && systemDebt === 0n` case still reports `null`.

**Pinned by** three cases in `p13-gates.test.ts`: the system at exactly CCR with a heavily over
collateralised position, which is the case that was mislabelled; a thin position in a roomy system,
which must still say ICR; and Recovery Mode, which must still say neither.

---

---

## MK-077 · The adjust evaluator silently drops a repayment leg the write path refuses

**Class** S3 · **Status** fixed · **Preview and write disagree about the same input**

**Ground truth.** `_adjustTrove` takes ONE debt leg: `_mUSDChange` with a separate `_isDebtIncrease`
flag (`BorrowerOperations.sol:757-758`). There is no contract gate for "both", because the parameter
shape makes it unrepresentable. This is the asymmetry worth naming: the collateral side DOES have a
gate, `_requireSingularCollChange` (`:788`, `:1367-1375`), because `msg.value` and `_collWithdrawal`
are separate parameters and both can be non zero.

**SDK location.** `PreviewAdjustParams` (`packages/core/src/math/previewAdjust.ts:149-161`) offers
`increaseDebt` and `repayDebt` as independent optional fields. Given both, `evaluateAdjust` at
`:229-232` takes `isDebtIncrease` from the presence of the first and computes
`netDebtChange = increaseDebt + fee`. The repayment is dropped, and no reason names it:

```
evaluateAdjust({ increaseDebt: 1000 MUSD, repayDebt: 500 MUSD, ... })
  viable = true  reasons = []
  netDebtChange = 1001000000000000000000
```

`trove/index.ts:523-525` throws `InvalidAdjustment` for the same input, so **the write path is right
and the preview returns a confident verdict about an operation nobody can perform.** The evaluator
already has `COLLATERAL_ADD_AND_WITHDRAW` for the symmetric case on the collateral side.

**Scope of the claim.** This is an SDK input validation gap, not an unenforced contract rule. Filing
it as the latter would be the mistake MK-001 made in the other direction.

### Fixed

`AdjustBlockReason` gains `DEBT_INCREASE_AND_REPAY`, whose docstring says in its first line that it
is SDK input validation and not a contract gate, and explains why the collateral side has one and
the debt side does not. `adjustReasonToError` maps it to `InvalidAdjustment` with a message carrying
no contract citation, deliberately, since there is no line to cite.

The test is value based, matching `_requireSingularCollChange`'s shape on the collateral side, so
`(0, n)` is left to `ZERO_DEBT_INCREASE`, which already refuses it. `trove/index.ts` refuses the same
shape earlier and on PRESENCE, which is stricter and safe: a write it rejects never reaches the
chain. Both halves are pinned, the evaluator in `p13-gates.test.ts` and the write path beside it.


**Since MK-244** the write path refuses both debt legs on VALUE, from the same `adjustShapeReasons` the
evaluator reports `DEBT_INCREASE_AND_REPAY` from, before any read.

---

## MK-078 · The tenth sweep operation makes the documented sweep unable to finish, so the thousand case figures cannot be re-measured at all

**Class** S2, harness · **Status** **claim-corrected in the P15 wave: this finding is WITHDRAWN.**
The run it rests on was a measurement of a failing network, not of this repository. Read the
correction at the end of the entry before anything above it · **Found by running the documented
recipe on the P13 tree, which is the first time anyone has**

**What was attempted.** MK-069 left `docs/09` §3 carrying 1000 case figures measured on the NINE
operation generator, labelled as describing a stream this tree no longer produces. The P14 wave's
single purpose was to replace them: run the sweep at the documented scale, in the documented slices,
and put the current numbers in the table. **The run does not complete. There are no current numbers
to put there.**

**Every slice failed.** Seed `20260826`, 1000 cases, four slices of 250 via `MK_DIFF_FROM` and
`MK_DIFF_TO`, `pnpm test:fork` per slice at pinned block 15043414, a fresh anvil each, exactly as
`docs/07-testing.md` §4a documents:

| slice | exit | reached | outcome |
|---|---|---|---|
| 0..250 | **1** | 200 of 250 at 5373s | `Test timed out in 5400000ms`, no summary emitted |
| 250..500 | **1** | under 100 | `Test timed out in 5400000ms`, no summary emitted |
| 500..750 | **1** | under 100 | `Test timed out in 5400000ms`, no summary emitted |
| 750..1000 | **1** | under 100 | `Test timed out in 5400000ms`, no summary emitted |

Not one slice reached its `done in` line, so not one produced a ran count, a skip count, a direction
breakdown or a band count. **The table's own reproduction command produces nothing.**

**The cost is the tenth operation, and that is measured rather than inferred.** The first slice
timed 100 cases at 730s and 200 at 5373s, so cases 101 to 200 averaged 46.4s each against the 3 to
4s `docs/07` §4a documents for early cases. Every harness throw in all four slices was
`op=borrowingPower`, the operation MK-067 added, and every one was a
`WaitForTransactionReceiptTimeoutError`. Isolating that operation over the same index window settles
it, on a FRESH anvil so the documented "cost grows with the life of the anvil process" cannot be the
explanation:

```
MK_DIFF_OP=borrowingPower MK_DIFF_CASES=1000 MK_DIFF_SEED=20260826 MK_DIFF_FROM=0 MK_DIFF_TO=250

[differential] done in 4412710ms  ran=18 skipped=0  bands: boundary=10 extreme=1 middle=7
[differential] mismatches: FALSE_VIABLE=0 FALSE_BLOCKED=0 NUMBERS=0
[differential] threw=4
```

**Eighteen cases, 4413 seconds, 245 seconds each**, with four of the eighteen throwing. A 250 case
slice holds roughly that many of them, so one operation consumes about 73 of the 90 minutes the test
allows itself before the other nine operations have run at all. That is the whole failure.

**And the control, on the same tree and the same generation, with the operation excluded.** Filtering
to a single other operation drops `borrowingPower` from the case list entirely, and everything runs
at the documented cost:

```
MK_DIFF_OP=borrow  MK_DIFF_CASES=1000 MK_DIFF_SEED=20260826 pnpm test:fork
  exit 0, 464s wall.  ran=81 skipped=3, 4.9s per case, threw=0, and the whole fork suite green

MK_DIFF_OP=redeem  MK_DIFF_CASES=1000 MK_DIFF_SEED=20260826 pnpm test:fork
  exit 0, 1823s wall. ran=99 skipped=47, threw=0, and the whole fork suite green
```

4.9 seconds per case against 245. **Same tree, same seed, same generation, same anvil recipe**: the
only variable is whether the operation MK-067 added is in the case list. That is as close to a
controlled comparison as this harness allows, and it is why this entry attributes the failure to that
operation rather than to machine load or to the RPC.

The four that threw, with their tuples, so each is reproducible by index:

```
case=169 band=extreme   collateral=4645000000000000000000 debt=524                     pricePercent=25
case=220 band=middle    collateral=2000000000000000000    debt=23295000000000000000000 pricePercent=127
case=222 band=boundary  collateral=610000000000000000     debt=42528341332000000000000 pricePercent=100
case=230 band=middle    collateral=540000000000000000     debt=30474000000000000000000 pricePercent=123
```

**Why P13 did not catch it, which is the part worth carrying forward.** MK-069 measured the new
operation with `MK_DIFF_OP=borrowingPower MK_DIFF_CASES=400` and recorded 33 cases in 176 seconds,
exit 0, zero mismatches. That is 5.3s per case against the 245s measured here, and the two are not
in conflict: `MK_DIFF_CASES=400` generates a **different tuple set** from indices 0 to 250 of a 1000
case generation, because the count is an input to the generator and not a window onto a fixed
sequence. **The P13 measurement was real and it exercised cases that happen not to hang.** The
default 24 case sweep that CI runs, and that the P13 five run window ran five times, draws few enough
of them to stay inside the budget, which is why the wave went green five times over a defect that
makes the full scale run impossible.

**So the defect is latent at every scale anyone had run, and appears only at the scale the
documentation promises.** That is the same shape as MK-053, a gate nobody had executed, and MK-066,
coverage that rested on which cases the generator happened to draw.

**A second property, named because it bears on what the table can ever claim.** The isolated probe
above **exited 0** with `threw=4`. Throws are counted and never fatal by design
(`differential.fork.test.ts`), so a sweep can report exit 0 and `0 FALSE_VIABLE, 0 FALSE_BLOCKED,
0 NUMBERS` while a fifth of its cases never reached the chain. Past runs recorded `threw=0`, so this
has not yet made a published figure wrong, but a headline of zero mismatches is a statement about the
cases that RAN and the throw count is what says how many that was. Any replacement figure has to
carry it.

**Not diagnosed, deliberately.** Why those four transactions are sent and never confirmed is not
established here. The tuples are extreme (4645 BTC of collateral against 524 wei of debt; 0.61 BTC
against 42528 MUSD), which points at either the fixture's funding step or a send the SDK's precheck
and simulate both accept and the chain then never mines, but that is a hypothesis and this entry does
not assert it. **This wave registers and stops rather than fixing**, on instruction, so the next wave
owns the diagnosis.

**Blast radius.** No shipped code is implicated: `borrowingPower` is a test operation and every
production path it exercises is covered by the chain free
`borrowing-power-agreement.test.ts` and by the Recovery Mode fork assertion in `phase4`. What is
implicated is **the evidence base**. The thousand case sweep is the instrument `docs/09` §3 leans on
for "preview verdict against actual transaction outcome", and it cannot currently be run to
completion, so that row is supported by a measurement of a previous tree and by nothing on this one.

**What the documents say now.** Every figure that described the nine operation stream has been
removed rather than relabelled, and the rows that carried them say the sweep cannot currently be run
at the documented scale and name this entry. A number a reader cannot reproduce is worse in that
table than an absent one, which is the whole reason the P14 wave was called.

---

### Corrected in the P15 wave: this finding is WRONG, and the process failure that produced it matters more than the finding did

**Status changes from `open` to `claim-corrected`.** Everything above describes a real run that
really happened. The conclusion drawn from it does not hold, and every number in it is a measurement
of a degraded network rather than of this repository.

**What the re-measurement found**, on the same tree, same seed, same commands, with nothing else
running:

| measurement | P14 recorded | P15 measured |
|---|---|---|
| `MK_DIFF_OP=borrowingPower` over index 0..250, 18 cases | 4413s, `threw=4` | **103s, `threw=0`** |
| Those same 18 cases through `runCase` in sequence | not measured | **110s total, 6.1s mean, 0 throws, no growth** |
| One `borrowingPower` case, RPC counted | "245s per case" | **3.0s, 32 RPCs, solver 0.2s and 9 `eth_call`** |
| One `borrow` case, same tree, same method | the control, 4.9s | **7.0s, 27 RPCs** |
| Slice 0..250, full `pnpm test:fork` | exit 1 at the 90 minute timeout, no summary | **completed, 1593s, 250 ran, `threw=0`, flat 6.4s per case** |

**A `borrowingPower` case is CHEAPER than a `borrow` case**, because a borrow case has to seed a
position first and this one does not. The solver makes nine chain calls, not hundreds: the closed
form answers and the bounded binary search never runs. The 245 was not a per case cost at all; it
was a mean over a bimodal distribution in which four cases each burned a receipt timeout, which is
exactly the shape `docs/08-conventions.md` §10 warns about.

**What was actually wrong with the machine, established by watching it fail again.** anvil forks
LAZILY from the upstream RPC, so any state the fork has not cached is fetched from
`rpc.test.mezo.org` mid execution. When that link degrades, every uncached read stalls, transactions
cannot be executed or mined, and `waitForTransactionReceipt` reaches its timeout. The P15 run caught
the whole progression in one sitting: slice 250..500 finished but with `threw=19`, **every one an
`InternalRpcError`** and all of them clustered in the last cases; slices 500..750 and 750..1000 then
failed in `startFork` itself with

```
- Error #2: dns error
- Error #3: failed to lookup address information: nodename nor servname provided, or not known
```

and exited in one and two seconds. The network recovered a few minutes later
(`dns=0.065s http=200`) and the slices were re-run.

**So the four transactions that "never confirm" are not four transactions and not a defect.** Cases
169, 220, 222 and 230 run in 2.7s, 2.9s, 7.2s and 6.9s, and in the single case probe the `max + 1`
attempt is refused by the SDK's own precheck (`ICRBelowMCR`, `RecoveryModeRestriction`) so no
transaction is sent at all. **Corrected by MK-243**: those attempts were opens, and `openTrove` has no ratio
precheck, so what refused them was the simulation, whose revert decoder throws those two codes. For the same
gate on the adjust path, the precheck that runs first threw `InsufficientCollateral` until 0.5.0, so "the
precheck gives `ICRBelowMCR`" was true of no path. Since 0.5.0 both paths throw `ICRBelowMCR`.

**The process failure, which is the part worth keeping.** The P14 entry was written from a single
run, taken immediately after four slices had hit test level timeouts, without checking what else was
on the machine and without re-running the measurement once. `docs/08-conventions.md` §10 requires a
measurement to be reproducible and the command to be recorded; the command was recorded and the
measurement was never repeated, so the rule was met in letter and missed in substance. **A single
run of a number that decides a release is not a measurement, it is an observation**, and this
register already has a class for that: observed once. This entry claimed reproducible and was not.

**What this cost.** The P14 wave removed correct figures from `docs/09` §3, `docs/07`, the provenance
index and the README on the strength of a false finding, and told a reader the sweep could not be
run. It can. The figures are restored in this wave from a run of the real thing, and what the real
run found instead is MK-079.

**Kept, not deleted.** The original entry stands above so the reasoning that produced a wrong
conclusion is legible, which is the same treatment MK-034 and MK-036 got.

---

## MK-079 · The sweep compares a preview of one call against execution of a different one whenever a debt leg is zero

**Class** S2, harness · **Status** open. NOT fixed. Registered as an expected mismatch in the
P16 wave so the sweep stops failing on it · **Found by the first clean run of the documented
sweep, which is also the run that refuted MK-078**

**The mismatch, verbatim from the run that produced it:**

```
DIFFERENTIAL MISMATCH [FALSE_BLOCKED]
  seed=20260826 case=209 band=boundary op=adjust collateral=340000000000000000 debt=0
  pricePercent=66 elapsedSeconds=1 precondition=OCCUPIED redeemBand=AT_NET_DEBT
  recoveryDrawdownPercent=60
  replay with: MK_DIFF_SEED=20260826 MK_DIFF_CASE=209
  preview.viable=false  chainSucceeded=true
  the preview said NOT VIABLE and the chain accepted it. reasons=[ZERO_DEBT_INCREASE]
```

**Both halves of the SDK are correct. The harness asked them different questions.**

`adjustCase` (`packages/core/test/differential/harness.ts`) passes its `legs` object to the preview
**verbatim**:

```ts
const preview = await client.previewAdjustTrove({ owner: account.address, ...legs })
```

and then to the write **filtered on `> 0n`**:

```ts
...(legs.increaseDebt !== undefined && legs.increaseDebt > 0n ? { borrow: legs.increaseDebt } : {}),
```

The case is generated with `debt=0`, and `adjustDebt(c)` is `c.debt / 4n`, so `increaseDebt` is
`0n`. On the preview side that is PRESENT, so `previewAdjustTrove` sets
`isDebtIncrease = params.increaseDebt !== undefined` and reports `ZERO_DEBT_INCREASE`, which is
exactly right: `_adjustTrove` with `(_mUSDChange = 0, _isDebtIncrease = true)` is refused by
`_requireNonZeroDebtChange` (`BorrowerOperations.sol:786`, `:1351-1356`). On the write side the leg
is dropped entirely, so `adjustTrove` sends a pure collateral top-up, which the contract accepts.

**A preview of "add collateral and increase debt by zero" was compared against an execution of "add
collateral".** Neither answer is wrong. The comparison is.

**This is MK-060's distinction, never applied to the harness.** MK-060 established that
`_isDebtIncrease` is a parameter the contract takes independently of `_mUSDChange`, and that
presence and value are different inputs; it fixed `trove/index.ts` and `previewAdjust.ts` to both
read presence. The harness's own mapping still reads presence on one side and value on the other,
which is the same defect one level out, in the instrument that exists to catch defects.

**Why it surfaced only now.** The tenth operation added in MK-067 shifts the generator's PRNG
stream, so the same seed draws different tuples. `debt=0` on an `adjust` case at index 209 is a
tuple this seed did not previously produce. That is MK-066's lesson repeating: coverage, and now
correctness of the comparison itself, resting on which cases the generator happens to draw.

**Blast radius: the instrument, not the SDK.** No `packages/*/src` file is implicated. The
consequence is that the sweep reports a mismatch that is not a product defect, which is the worst
thing a differential harness can do short of missing a real one: it costs the credibility of every
zero it has ever reported. Any `adjust` case whose `debt` is under `4` wei produces
`adjustDebt(c) === 0n` and reaches this path.

**Not fixed here, on instruction.** The obvious shapes are to filter the preview legs the same way
the write legs are filtered, or to stop filtering the write legs and let `adjustTrove` refuse the
zero leg as MK-060 made it do. **They are not equivalent** and the choice decides what the case
tests, so it belongs to a wave that can weigh it rather than to this one.

**What the P16 wave did instead, and why it is not a silencing.** Left alone, an open finding that
fails the sweep every time makes the sweep useless as a gate: the next person sees red, remembers
that one of them is expected, and stops reading. That is exactly the shape of MK-053, where a
verification job sat unexecuted for two releases while looking like a control. So MK-079 is now a
row in `packages/core/test/differential/expected.ts`, carrying this finding ID and the reason
above, and `partitionMismatches` splits a run's mismatches into the registered and the
unregistered. **Three properties, each proved by a test in
`packages/core/test/expected-mismatches.test.ts` and two of them by a mutation in
`scripts/mutation-check.mjs`:** an unregistered mismatch still fails the run and is named; a
registered one does not, so red is real; and a registered one that stops reproducing is reported as
`EXPECTED-BUT-ABSENT`, because a defect that quietly stops appearing means either somebody fixed it
without updating the registry or the generator stopped reaching it.

**The predicate matches a SHAPE, not a case index**, and that is not a stylistic choice.
`generateCases` takes the case count as an input to its PRNG, so index 209 at
`MK_DIFF_CASES=1000` and index 209 at `MK_DIFF_CASES=400` are different tuples (MK-069). The
indices are recorded in `knownAt`, scoped to the seed and count they were measured at, and used
only for the disappearance report. The predicate itself requires an `adjust` op, a `FALSE_BLOCKED`
direction, `ZERO_DEBT_INCREASE` in the reason, and `case.debt < 4n`, which is precisely the band
where `adjustDebt` yields a zero leg. **Nothing about registering it makes this finding less open.**

---

## MK-083 · A document described an action that a workflow already performed, and the documented version never ran

**Class** S2, process · **Status** fixed · **Found by auditing this runbook for preconditions
asserted without an action**, which is a different question that kept turning up the same answer

`docs/12-release-runbook.md` §3 carried two literal `npm deprecate` shell commands.
`.github/workflows/deprecate.yml` exists to replace exactly those two commands and says so in its
own header, in its own words:

> `npm deprecate` writes to the registry, so it needs a publish-capable token. The one place this
> project keeps one is the `NPM_TOKEN` repository secret; putting it in a maintainer's shell to run
> two commands means a publish credential living somewhere it is not tracked, not rotated with the
> secret, and not visible in any log. `docs/12-release-runbook.md` §3 recorded the two commands and
> nothing ran them.

**The workflow was written, it was run, and the document was never updated.** Checked rather than
assumed:

```
gh run list --workflow deprecate.yml        ->  33180504234  success  workflow_dispatch  2026-08-28
npm view @musd-kit/core@0.1.0 deprecated    ->  "0.1.0 returns wrong numbers on seven surfaces..."
npm view @musd-kit/react@0.1.0 deprecated   ->  "Depends on @musd-kit/core@0.1.0, which returns..."
```

So the deprecation happened, through the workflow, while the runbook went on instructing a reader to
obtain a publish credential and paste it into a shell. **A reader following the documentation would
have taken the exact risk the workflow was built to remove**, and would have had no way to know,
because the document does not mention the workflow at all: `git grep "deprecate.yml" -- docs`
returned nothing.

### What makes this family detectable, now that it has appeared three times

| | the document said | where the action actually lived | what had executed |
|---|---|---|---|
| MK-053 | the release posture includes a post publish verification gate | a job inside `release.yml`, reachable only as the tail of a real publish | **nothing**, across two releases |
| MK-080 | the full sweep runs "on demand and on a schedule" | the on demand half only; no `schedule:` trigger existed anywhere | the on demand half, by hand, twice in 85 commits |
| MK-083 | run these two `npm deprecate` commands | `.github/workflows/deprecate.yml`, written to replace them | **the workflow**, once; the documented commands never |

**The three share one shape and it is mechanically checkable: a document names a command, and
something in the repository already performs that command.** That divergence is the signal, and it
is visible without knowing anything about intent, by grepping the repository for the command a
document tells you to run and asking what else already runs it.

**The execution counts differ and that difference matters, so do not flatten it.** In MK-053 and
MK-080 nobody ran anything, and the gap was a gate that did not exist. Here the real mechanism ran
and worked; the gap is that the document pointed somewhere worse. **A working alternative makes the
family harder to notice, not easier**, because nothing is failing: the deprecation is live on the
registry, the runbook looks satisfied, and only reading both side by side reveals that the thing
described and the thing that happened were different things.

**Why S2 rather than S3.** The documented route is not merely redundant, it is the insecure one. A
maintainer following §3 puts a publish capable npm token into their shell and their shell history,
and this repository has already recorded what an untracked credential costs to reason about
afterwards (MK-037's window, where the margin was silently dropped on an unknown fraction of sends
and there is now no way to find out which).

**Fixed by** replacing §3 with the workflow, its dispatch command, its two inputs, its two guards,
and how to read the result back from the registry, keeping one sentence that says why the shell
commands are not the route so nobody restores them. The conventions checklist gains the check that
detects the family, `docs/08-conventions.md` §10 row 12.

**Audited for other instances in the same pass, and reported rather than fixed.** `ci.yml` is not
one: the checklist deliberately requires both the local run and the CI run, and says so. `release.yml`
is not one: §2 dispatches the workflow and the `pnpm publish` line beneath it describes what the
workflow does rather than instructing you. `sweep.yml` is not one: precondition 7 dispatches it and
`docs/07-testing.md` gives the local four slice recipe for local use, with the relationship stated.
`pnpm gate:packaging` is not one: CI does not run it, so precondition 6 is a genuinely manual gate.
Two near misses are recorded in the wave's report: the runbook names the `verify-published` job
without mentioning that `verify-published.yml` is dispatchable on its own, which
`docs/07-testing.md:90-95` documents with a command; and §5 still tells you to run
`npm dist-tag add` by hand, which carries the identical credential hazard with **no** workflow to
supersede it, so it is an unclosed instance of the principle rather than a supersession.

---

## MK-084 · The deprecation workflow takes a version input and hardcodes one version's message

**Class** S2 · **Status** fixed · **Found while documenting the workflow
as the route**, by reading it rather than describing it from its header

`.github/workflows/deprecate.yml` accepts `version` as a required dispatch input and interpolates it
into both `npm deprecate` targets. **The message strings beside them are literals about 0.1.0:**

```
npm deprecate "@musd-kit/core@$V"  "0.1.0 returns wrong numbers on seven surfaces, three of them
                                    silently. See FINDINGS.md and docs/11-migration-0.1-to-0.2.md.
                                    Upgrade to 0.2.0."
npm deprecate "@musd-kit/react@$V" "Depends on @musd-kit/core@0.1.0, which returns wrong numbers on
                                    seven surfaces. See docs/11-migration-0.1-to-0.2.md.
                                    Upgrade to 0.2.0."
```

So a dispatch with `version=0.2.0` attaches the sentence "0.1.0 returns wrong numbers on seven
surfaces" to 0.2.0 and sends the reader to the wrong migration guide. **The registry is the one
surface where this is visible to people who are not us**, and a deprecation message is read by
installers at install time.

**The workflow's own reasoning is right and is not what is wrong here.** Its header argues that the
messages belong in the workflow rather than in an input, because an input "would let this deprecate
anything with any text, which is a much larger capability than the job needs". That is sound. The
defect is that the version was parameterised and the text was not, so the two disagree for every
input except the one they were written for.

### The fix, and why this shape

**The message is chosen by version from a set that lives in the repository**,
`scripts/deprecation-message.mjs`, and the dispatch input stays a version. **The header's argument
against a free text input is untouched:** an input would let this job write any text onto any
version, and it still cannot. What changes is that the text now varies with the version, which is
the half that was missing.

A module rather than a `case` in the YAML, for two properties a shell branch cannot give. It is
**importable**, so the guarantees are asserted by `packages/core/test/deprecation-message.test.ts`
in the unit project on every push, rather than only when somebody dispatches a registry write. And
the lookup is **one implementation**, so the string the test checks is the string the workflow
sends, which is §11 applied to text that reaches the public.

**Two refusals, both before `NODE_AUTH_TOKEN` enters any environment.** The workflow's first step
resolves the messages by shelling out to the module; the credential appears only in the step after
it. So a bad dispatch cannot reach the registry even in principle, rather than being caught by a
later check:

```
node scripts/deprecation-message.mjs 0.3.0 core
  -> exit 1: no deprecation message is written for 0.3.0. Refusing to deprecate it: a version
     without a reviewed message would get another version's text. ... Known versions: 0.1.0, 0.2.0
```

**Failing loudly on an unknown version is the correct outcome**, and better than a plausible wrong
message. Preparing a deprecation is now exactly "add an entry in a pull request".

### The first version of the guarantee was too weak, and the test caught it before it shipped

The check began as "the message must contain its version". **It does not hold.** 0.1.0's message
ends `Upgrade to 0.2.0.`, so 0.1.0's text filed under 0.2.0 CONTAINS "0.2.0" and passed, which is
precisely the forgery this finding is about. Recorded because the near miss is the useful part: a
containment check on a string that legitimately names two versions is not a check at all.

The guarantee is now two conditions. The message must **open** by naming the version, per package
(`0.2.0 ` for core, `Depends on @musd-kit/core@0.2.0,` for react), so the version is the sentence's
subject rather than an incidental mention. And its `Upgrade to X.Y.Z.` target must be a **different**
version, because no message tells a reader to upgrade to the release it deprecates, which catches a
message whose subject was updated and whose tail was not.

### Verified without writing to the registry

By dry run, and by test. The dry run is the CLI the workflow actually invokes:

```
0.1.0 core   exit 0   0.1.0 returns wrong numbers on seven surfaces, ...
0.2.0 core   exit 0   0.2.0 is wrong on two Recovery Mode surfaces. ...
0.3.0 core   exit 1   no deprecation message is written for 0.3.0 ...
0.2.1 core   exit 1   ... Known versions: 0.1.0, 0.2.0
''    core   exit 1   a version is required
0.2.0 landing exit 1  unknown package "landing"; expected one of core, react
```

**And the 0.1.0 strings are byte identical to what is live**, checked by reading the registry rather
than by inspection: `npm view @musd-kit/core@0.1.0 deprecated` and the react equivalent both compare
equal to what the module produces, so a re-dispatch of 0.1.0 rewrites nothing.

14 tests, and two mutations in `scripts/mutation-check.mjs` proving the two guarantees are load
bearing rather than decorative:

```
MK-084 subject          startsWith(opening) -> includes(version)        caught by 1 test
MK-084 unknown version  refuse -> fall back to the first entry          caught by 2 tests
18 mutations, all caught
```

**What is NOT proven, and cannot be without a registry write.** That `npm deprecate` accepts a
message of this length, that the equality check in the verify step passes against what npm actually
stores, and that npm does not normalise the text. The 0.1.0 comparison is evidence for all three at
141 and 134 characters, since those strings made the round trip intact; 0.2.0's core message is 378
characters and has not. The next real dispatch is the first execution of that path.

---

## MK-081 · A developer machine's warm figure was published as CI's, one commit after the rule against it

**Class** S3 · **Status** fixed · **Found by the CI run that proved the commit which introduced
it**, which is the only reason it was caught at all

Commit `c3e1b6b` added `docs/08-conventions.md` §13, the rule that a published measurement names
what it measured, and in the same commit rewrote the push subset's cost as:

> **About 158 seconds with the RPC cache warm**, which is what CI sits on because `ci.yml` caches
> the fork state between runs

The 158 seconds is real and the cache state is correctly named. **The machine is not.** It is the
mean of a five run window on a developer laptop. The CI runs of that very commit, all three with
`Cache hit for: anvil-fork-31611-15043414` in the log, so genuinely warm:

```
34599589828   [differential] done in 50690ms    24 cases    2.1 s/case
34595233656   [differential] done in 62539ms    24 cases    2.6 s/case
34599594210   [differential] done in 65412ms    24 cases    2.7 s/case
```

**Mean 59.5 seconds, against the 158 published as CI's. A factor of 2.4.** A reader budgeting the
push path from that sentence would have been wrong by more than the figure itself.

**The register was careful where the documentation was not.** MK-058's entry says only that "CI is
on the run 2 side of that table rather than the run 1 side", which is a claim about the cache state
and says nothing about the duration. The documentation turned a qualitative claim into a
quantitative one across a machine boundary.

**This is §13's own failure mode, one commit after §13.** The rule says to name a plausible
neighbouring quantity and check the wording rules it out. The neighbour here is not a different
cache state, which the sentence handles; it is the same measurement on a different machine. Cache
state was the variable that had burned this programme before (`949d361`), so it was the one that
got named, and the machine went unexamined.

**And the laptop figure is a range, not a point.** The P16 five run window, same laptop, same
seed, same pinned block, all five exit 0 and all five reporting the identical seeded price:

```
113630ms  117440ms  113792ms  123305ms  117880ms     mean 117.2s, 4.9 s/case
```

against P15's mean of 158s, 6.6 s/case. **One machine varies by a third between windows**, so a
single window's mean published as "the laptop figure" is the same error one scale down. The
documentation now carries the range and both windows.

**Fixed by** publishing every figure with its machine and as a range where two windows disagree,
and by adding the machine to §13's list of things a figure has to name.

---

## MK-082 · The checklist demands five byte identical answers from a command that does not pin the fork

**Class** S3, process · **Status** fixed · **Found by following the checklist literally**, which
cost a 53 minute run

`docs/08-conventions.md` §10 row 2 requires:

> `pnpm test:fork`, five consecutive runs ... The seeded answer, which must be byte identical
> across all five

**Run exactly as written, it cannot be.** The harness reads `MEZO_FORK_BLOCK` and passes it to
anvil as `--fork-block-number` (`packages/core/test/harness/anvil.ts:83-91`); with the variable
unset there is no `--fork-block-number` and anvil forks at `latest`. The oracle shim is then seeded
from the fork's own block (MK-020), so the seeded price is whatever the chain was doing at that
second. `docs/07-testing.md:27` says so plainly, "Locally, leaving it unset forks at `latest`", but
the checklist row that demands the identity does not carry the variable, and neither does the recipe
block at `docs/07-testing.md:219-221`.

**Observed, not reasoned.** A window started without it reported
`[harness] anvil fork ready at http://127.0.0.1:57114, block 15465775` against the pinned
`15043414`, took 3187 seconds for 24 cases because no cached state existed for a block nothing had
ever forked at, and ended in a viem `TimeoutError`. The four runs after it failed in `startFork`.

**Why it matters beyond the wasted hour.** CI sets the block (`ci.yml`), so CI is pinned and green
while a local window is measuring a different chain state. Every figure taken from an unpinned
window is a figure about one moment on testnet, and MK-078 is what that costs when it reaches the
register.

**Fixed by** putting `MEZO_FORK_BLOCK` in the checklist row and in the recipe, with the consequence
of omitting it stated where the command is, rather than a section earlier.

---

## MK-080 · The sweep was described as scheduled for 85 commits and a release, and no schedule existed

**Class** S2, process · **Status** fixed · **Found while carrying out the P16 instruction to
schedule the sweep**, by checking whether it was already scheduled before writing a workflow

`docs/07-testing.md` §4a has read "**The full 1000 case sweep: on demand and on a schedule, never
on push**" since commit `622bbe4`, dated 2026-08-27. The on demand half is true and documented with
a recipe. **The other half was never built.**

```
git log --all -S "schedule:" -- .github/workflows/   ->  (no commits)
grep -rl "schedule:" .github/workflows/              ->  (nothing, before this wave)
git rev-list --count 622bbe4..HEAD                   ->  85
git tag --contains 622bbe4                           ->  v0.2.0
```

**85 commits and one published release sat under a sentence describing a control that did not
exist.** In that window the push path ran the 24 case subset and nothing ran the other 976.

**This is MK-053's shape, and that is the reason it is filed rather than quietly wired.** MK-053
was a post publish verification job that had never executed across two releases while being
presented as part of the release posture. The failure mode is identical: a gate that is described
but not scheduled is a claim about diligence, and a reader cannot tell the two apart from the
documentation alone.

**It was not harmless.** The tenth operation added in MK-067 shifts the generator's PRNG stream,
so the same seed draws different tuples. Nobody ran the full sweep against the new stream for two
waves. When the P15 wave finally did, the first clean run surfaced MK-079, which had been reachable
from the moment the operation landed. A weekly run would have surfaced it within seven days of the
merge instead of two waves later.

**The fix, and what it deliberately does not do.** `.github/workflows/sweep.yml` runs the four
slices on `schedule` (Sundays 03:00 UTC) and on `workflow_dispatch`. It does **not** move the sweep
onto the push path: 116 minutes of wall clock on every merge would get skipped, and a gate people
route around is worse than one they budget for. The fast 24 case subset stays on push in `ci.yml`,
unchanged by this wave. The release runbook now carries the other half of the answer, since a
weekly run is almost never against the commit being released: precondition 7 requires a sweep whose
`headSha` equals the released commit (`docs/12-release-runbook.md` §0).

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

**Class** S3 · **Status** fixed · **Found while verifying the site during the 0.2.0 release**
<!-- MK-063: this read `open, documented ... the build is not changed here` after `109c435`
     made the build change and added the `### Fixed` section below. -->

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

The same overstatement was in the user-facing copy. `landing/src/components/PreviewWidget.astro:48`
renders "Read-only via the shipped `@musd-kit/core`." **That caption needed no edit in the end: the
fix below made it true rather than aspirational**, which is the better of the two ways to resolve a
claim that outran its evidence.

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

## MK-085 · The React adjust preview defaults every leg, so through the hook every adjustment is a debt increase

**Class** S1 · **Status** fixed · **Found by an external correctness audit of the
`4c8227e..004ace9` range, and re-derived from the contract here before it was filed**

**Ground truth.** `_adjustTrove` takes `uint256 _mUSDChange` and `bool _isDebtIncrease` as two
INDEPENDENT parameters (`BorrowerOperations.sol:757-758`) and reconciles them at `:785-787`:
`if (_isDebtIncrease) _requireNonZeroDebtChange(_mUSDChange)`, which is
`require(_debtChange > 0)` (`:1351-1356`). So `(0, true)` is refused and `(0, false)` is an
ordinary collateral operation. The single axis entry points pass the flag as a constant:
`addColl` (`:193`) and `repayMUSD` (`:266`) pass `false`, `withdrawMUSD` (`:248`) passes `true`.

**SDK location.** `packages/react/src/hooks/reads.ts`, `useAdjustTrovePreview`. It destructured
all four legs with `= 0n` defaults and forwarded them unconditionally. `previewAdjustTrove`
reads the flag from PRESENCE, `isDebtIncrease: params.increaseDebt !== undefined`
(`packages/core/src/math/previewAdjust.ts`), which is what MK-060 changed it to. Through this
hook `increaseDebt` was never `undefined`, so **every** adjustment was evaluated as a debt
increase.

**What that produced, measured chain free before the fix:**

```
// Healthy Trove: 1 BTC at 100,000 USD, entire debt 10,200 MUSD, normal mode.
previewAdjustTrove(deps, { owner, addCollateral: 1e18 })
  -> { viable: true,  reasons: [] }                        // legs OMITTED
previewAdjustTrove(deps, { owner, addCollateral: 1e18,
                           withdrawCollateral: 0n, increaseDebt: 0n, repayDebt: 0n })
  -> { viable: false, reasons: ['ZERO_DEBT_INCREASE'] }    // legs DEFAULTED

// Pure repayment of 5,000 MUSD, the silent half:
omitted   -> netDebtChange 5000e18  resultingEntireDebt 5200e18  resultingIcr 19.230769...
defaulted -> netDebtChange 0        resultingEntireDebt 10200e18 resultingIcr  9.803921...
```

**Two failure modes, not one.** The verdict fails LOUDLY and wrongly: a pure top-up, a pure
withdrawal and a pure repayment all come back `viable: false` with `ZERO_DEBT_INCREASE`, which
the contract accepts. The numbers beside it fail SILENTLY: `netDebtChange`,
`resultingEntireDebt`, `resultingIcr` and `resultingTcr` are all computed from the increase
branch, so a repayment leg is dropped from every figure. A panel rendering "your ICR after this
change" showed 9.80 where the answer was 19.23. The repayment gates at `:855-861` are guarded by
`!isDebtIncrease` and could never run from this hook at all.

**The only shape it got right was a non zero `increaseDebt`**, which is a minority of the surface
the hook exists for.

**Why nothing caught it.** `packages/core/test/preview-adjust-reads.test.ts` asserts the exact
distinction, in as many words: "`increaseDebt: 0n` is a debt increase OF ZERO, which is a
different input from no debt leg at all", with one call viable and the other not. That test
passed throughout, because it tests the core. Nothing rendered the hook. See MK-087.

**A second, smaller half: the query key.** `musdQueryKeys.adjustPreview` encoded an absent leg
and a leg of zero identically as `"0"`, so "no debt leg" and "a debt increase of zero" shared a
cache entry. `borrowPreview`, `withdrawCollateralPreview` and `redeemPreview` had the same shape
for `amount`: the hook disables itself without one, and a disabled TanStack query still reads
whatever sits at its key, so an empty input box could render the verdict computed for a draw of
zero.

### Fixed

**The legs are built ONCE, from presence, and handed to both the key and the call.** A single
`AdjustPreviewLegs` object drives `musdQueryKeys.adjustPreview` and
`client.previewAdjustTrove`, so the key cannot describe a different question from the one asked.
`exactOptionalPropertyTypes` is on, so a conditional spread is the only way to keep an absent leg
absent rather than present-and-undefined, and the compiler enforces the resulting shape. An
absent leg is `null` in the key and a leg of `0n` is `"0"`; the three amount keys follow the same
rule.

**Pinned by a RENDERED test**, `packages/react/test/adjust-preview-hook.test.ts`, which is the
first of its kind in this repository. React, TanStack Query, the wagmi context, the hook, the key,
the core's `previewAdjustTrove` and the `evaluateAdjust` rules are all real; only `useMusdClient`
and the transport under it are replaced, so it runs in the `unit` project with no anvil and no RPC
URL. **Proved by mutation**: restoring the default fails three of its tests, and collapsing the
key's absent case to zero fails a fourth. Both are in `scripts/mutation-check.mjs`.

**And a package-wide guard.** A test reads `packages/react/src/hooks/*.ts` and fails on any
destructuring default of a value, because the compiler cannot see one and it reads as tidy. The
full hook audit is in MK-087.

---

## MK-086 · The decision-site enumeration was applied to one package, so the register asserted a defect implicated no source file

**Class** S2, process · **Status** fixed · **Found by the same audit, as the finding behind
MK-085 rather than beside it**

**What was asserted.** MK-079 found this exact argument mis-mapping in the differential harness
and concluded: "**Blast radius: the instrument, not the SDK.** No `packages/*/src` file is
implicated." The summary table repeated it, and `README.md` repeated it twice, including under
"**No S1 is open.**"

**Every one of those statements was false when it was written.** The identical mis-mapping was in
`packages/react/src/hooks/reads.ts`, in shipped source, where it is not a comparison artefact but
the answer the hook returns. MK-085 is that defect.

**Why the assertion was made, which is the part worth keeping.** MK-069 established the rule that
a protocol rule decided in more than one place gets its decision sites ENUMERATED rather than
patched where they happen to be noticed, and MK-069 did exactly that for the borrowing fee: eight
sites, listed, all routed through `isBorrowingFeeCharged`. MK-079 inherited the rule and applied
it to `packages/core`. The enumeration stopped at a package boundary that has no meaning to the
defect: presence versus value is a property of every caller of `previewAdjustTrove`, and
`packages/react` is one.

**The correction, stated as a rule rather than as an apology.** An enumeration is scoped to the
RULE, not to the directory the defect was found in. `docs/08-conventions.md` §11 now says so, and
the conventions checklist asks, for any finding whose cause is an argument shape or a shared rule,
which packages call it, naming them.

### Fixed

MK-079's entry and its summary row no longer claim the SDK is unimplicated; they point at MK-085.
`README.md`'s maturity section is corrected in both places, and "No S1 is open" is gone: it was
true of what the sweep could express and not of the tree.

---

## MK-087 · Eighty four findings and nothing about the React package, because no gate reached it

**Class** S2, process · **Status** fixed · **Found by asking why MK-085 survived rather than how
it was written**

**The measurement, not the impression.** Before this wave:

| Control | Scope | React reached? |
|---|---|---|
| Coverage ratchet | `include: ['packages/core/src/**/*.ts']` (`vitest.config.mts`) | No. 36 files in the report, 0 under `packages/react/src` |
| `scripts/mutation-check.mjs` | 18 mutations, every one in `packages/core` or `scripts` | No |
| Differential sweep | calls `client.previewAdjustTrove` directly (`test/differential/harness.ts`) | No, it never renders a hook |
| Unit project | 3 React tests, all about an `AbortSignal` shim (MK-028) | Barely |
| Fork project | `hooks.fork.test.ts`, `phase9-app.fork.test.ts` | Yes, but chain bound and never coverage measured |

The prior external audit stated in writing that it read the React package for hook names only. So
did every control in the repository, in effect. MK-085 was sitting in that hole.

### The full hook audit, negative results included

**Every exported hook, and what it does with an optional parameter.** The rule applied: a hook must
never substitute a value for an absent optional before forwarding it, because `previewAdjustTrove`,
`previewOpen` and `getBorrowingPower` all read meaning from PRESENCE. Enumerated mechanically from
`packages/react/src/hooks/*.ts` rather than by eye, and the negative results are listed because
"one was wrong" is only a claim if the other twenty three were checked.

| Hook | Optionals it forwards | Verdict |
|---|---|---|
| `useAdjustTrovePreview` | four legs | **WAS WRONG.** Defaulted all four to `0n`. MK-085 |
| `useBorrowingPower` | `account` | Clean. Already spread conditionally, `...(account !== undefined ? { account } : {})`, and the key carries `account ?? null` |
| `useTrove`, `useHealthFactor`, `useLiquidationPrice` | none | Clean. `address` is required-or-disabled, never defaulted into a call |
| `useMusdBalance`, `useOraclePrice` | none | Clean |
| `useBorrowPreview`, `useWithdrawCollateralPreview`, `useRedeemPreview` | none forwarded | Clean on the call. **The KEY had the weaker form of the same defect**: `amount ?? 0n` made "not asked yet" and "a draw of zero" one cache entry, and a disabled TanStack query still reads whatever sits at its key. Absent is `null` now |
| `useBorrowingCapacity`, `useRefinancePreview`, `useMaxWithdrawableCollateral`, `useClosePreview` | none | Clean. The `owner ?? '0x'` key placeholder cannot collide with a real owner, since no address is two characters |
| All ten write hooks | none at the hook | Clean **by construction**: `useMusdWrite` takes the params object at `mutate` time and hands it to the core method verbatim. No hook in `writes.ts` destructures or defaults anything |

**Fourteen read hooks and ten write hooks. One was wrong, three more had the key-only form, and
twenty were clean.** The guard that keeps it that way is a test reading the hook sources and
failing on any destructuring default of a value, because the compiler cannot see one and it reads
as tidy.

### Fixed

**Coverage now measures both published packages.** `include` is
`['packages/core/src/**/*.ts', 'packages/react/src/**/*.ts']`. **This DROPPED the reported
figure**, which is the point and is reported rather than excluded: the old number was high because
it was scoped to the half that was tested. The floor is re-measured below and the ratchet resumes
from the honest number.

**The mutation check reaches React.** Two mutations in `packages/react/src`, both caught.

**A rendered test exists**, `packages/react/test/adjust-preview-hook.test.ts`, chain free, in the
`unit` project. It is the minimum pin rather than a suite; what it establishes is that rendering a
hook needs no chain, so the next one is cheap.

**The sweep still does not reach hooks, and that is now stated rather than implied.** One
sentence a reader can check: the harness drives `client.*` directly because a differential case
compares a preview against an executed transaction, and a React hook adds a render and a cache
between the two without changing either side of the comparison. `docs/09-review-and-validated-surface.md`
records that the validated surface is the core client, and that the React layer is covered by the
fork hook tests and the rendered unit test, not by the sweep.

---

## MK-088 · `previewRedeem` sizes its accrual margin from the redeemer's Trove, and bundles a governable rate when there is none

**Class** S1 · **Status** fixed · **Found by the same audit, verified against the contract here**

**Ground truth.** The quantity the margin models is the growth of the TARGET Trove's debt between
the preview read and execution. `_redeemCollateralFromTrove` accrues it with that Trove's own
stored rate and its own principal (`TroveManager.sol:1234-1241`):

```solidity
vars.interestPayment =
    trove.interestOwed +
    InterestRateMath.calculateInterestOwed(
        trove.principal,
        trove.interestRate,        // the TARGET's rate
        trove.lastInterestUpdateTime,
        block.timestamp
    );
```

A Trove's rate is frozen at open (`BorrowerOperations.sol:668-672`) and at refinance (`:1075`),
each time from `interestRateManager.interestRate()`. That global is GOVERNABLE: initialised to
`100` (`InterestRateManager.sol:88`), changed through `proposeInterestRate` (`:129`) and
`approveInterestRate` (`:145`, assigning at `:225`). **So two Troves in one system carry different
rates whenever governance has moved it between their opens.**

**SDK location.** `packages/core/src/math/previewRedeem.ts` read
`getTroveInterestRate(redeemer)`, coerced a zero to `100n`, wrapped the read in
`.catch(() => 100n)`, and applied that one rate to every Trove in the walk. A redeemer is
typically an arbitrageur or keeper with NO Trove, so the getter returns `0` and the hardcoded
`100n` is what shipped.

**Three defects in four lines:**

1. **The wrong Trove.** The redeemer's rate has nothing to do with the target's accrual.
2. **A bundled governable value.** `constants.ts:1-4` states the rule this breaks: "Everything
   governable/dynamic (minNetDebt, the borrowing/redemption/interest rates, the oracle price) is
   read on-chain, never bundled." The `interestRateManager` address is already in the SDK's
   address map and `createMusdClient` already reads `interestRate()` into its TTL cache.
3. **A swallowed read failure.** `.catch(() => 100n)` turned an RPC error into a plausible number,
   which is the class MK-007 and MK-012 closed twice already.

**Measured, chain free, before the fix.** Target Trove with entire debt 2,208 MUSD, net debt
2,008, floor 1,800, target rate 500 bps, redeemer holding no Trove:

```
reported accrualMargin        419812407738237       // computed at the hardcoded 100 bps
margin the target accrues    2099062038691189       // 500 bps, per :1236-1241
reported nextViableAmount  2008000419812407738237
amount that would work     2008002099062038691189
shortfall                    1679249630952952 wei
```

**Under-sizing is the dangerous direction**, and it reproduces the exact failure the field exists
to prevent: the offer arrives as a partial, `:1218-1221` sizes the lot against the larger debt,
the remainder is under the floor, `:1299-1306` cancels, `:392` breaks, and `:406-408` reverts
because nothing was drawn. That is MK-048.

**Why it was not wrong today, which is not the same as being right.** The live global rate is 100
bps on both chains (`docs/09-review-and-validated-surface.md` §6), every Trove was opened at it,
and the hardcoded fallback happened to match. The number was correct by coincidence; the rule was
wrong. `docs/01-ground-truth.md` records the governable band as 1 to 5 percent, so the margin could
be understated by up to five times on the first rate change.

### Fixed

**`EligibleTrove` carries its own `principal` and `interestRateBps`**, read per Trove in the walk.
`getTroveInterestRate(cursor)` rides in the `Promise.all` that already fetches that Trove's ICR and
debt, so it costs one request and **no extra round trip**. `marginFor(trove)` takes the Trove, not
a shared rate, so each step of the walk is sized by its own numbers.

**`EvaluateRedeemInput.interestRateBps` is REMOVED rather than kept as a fallback**, which is a
breaking change to an exported interface and is the right one: a fallback is an assumed governable
value wearing a different hat. **There is no `catch`**: a failed read fails the preview.

**Pinned by five chain free cases** in `packages/core/test/preview-redeem.test.ts`: the base is the
principal and not the entire debt, a five times rate is a five times margin, an amount sized at 100
bps is REFUSED against a Trove carrying 500, each Trove in a mixed walk gets its own margin, and a
zero rate accrues nothing. **Proved by mutation**, one for the rate and one for the base.

**What it costs, stated rather than discovered.** The rate is read for every Trove the walk visits,
including the sub-MCR ones it skips, because it rides in the same `Promise.all` as that Trove's ICR
and debt. Three requests per iteration where there were two, and **no additional round trip**, since
they are concurrent. The walk is bounded by `maxIterations` and breaks as soon as the accumulated
net debt covers the request, so the iteration count is unchanged; what grew is requests per
iteration, by half. The alternative, reading the rate only for eligible Troves, costs a sequential
round trip per eligible Trove instead, and round trips are what MK-010 is about.

---

## MK-089 · The interest formula was implemented twice and the copies disagreed about the base

**Class** S2 · **Status** fixed · **Found by the same audit**

**Ground truth.** `InterestRateMath.calculateInterestOwed` takes `_principal`
(`InterestRateMath.sol:12-22`) and every call site passes `trove.principal`:
`getEntireDebtAndColl` at `TroveManager.sol:788-793` and `_redeemCollateralFromTrove` at
`:1236-1241`. **Accrued interest is not part of the base**, so interest does not compound.

**SDK location.** Two copies. `math/compute.ts`'s `computeEntireDebt` accrued on the principal,
correctly, with `BPS_DIVISOR` and `SECONDS_PER_YEAR` imported. `math/previewRedeem.ts`'s
`marginFor` accrued on the ENTIRE debt and wrote the basis point divisor as a literal `10_000n`.

**Measured**, same Trove, principal 2,200 MUSD with 8 MUSD of interest already owed:

```
margin on entireDebt (2,208)             419812407738237
contract accrues on principal (2,200)    418291348289910
difference                                 1521059448327 wei
```

The divergence was conservative, so no caller was harmed: the margin was overstated and
overshooting a redemption is free. **It is reported because it is two copies of one protocol rule,
not because the number was dangerous.** MK-071 had already fixed a different divergence in the same
four lines, the shadowed 365 day year, and left the base alone.

**The test could not see it.** `packages/core/test/preview-redeem.test.ts` restated the formula
with an independently written `31_556_952n`, which is genuinely independent about the constant and
is why MK-071 stayed fixed. It then reused `entireDebt` as the base, so the source could accrue on
either quantity and the test would agree. Every fixture in the file also carried
`principal === entireDebt`, so the two were never separable.

### Fixed

**One function, `accruedInterest`, in `math/compute.ts`**, mirroring
`InterestRateMath.calculateInterestOwed` term for term and taking `{ principal, rateBps, seconds }`.
`computeEntireDebt` and `previewRedeem.marginFor` both call it. `previewRedeem` no longer contains
the arithmetic at all, which is what stops the base drifting again: there is nothing left there to
drift.

**The test is fixed too.** `marginOf` takes a principal, and the new cases carry a principal that
differs from the entire debt, so the base is asserted rather than coincidentally equal.

**And correcting it broke something, which is MK-095.** The over-estimate this removed was about 1
percent on the fork fixture, worth roughly 6 seconds of accrual, and that was what had been
covering the block a redemption settles in. The fork gate caught it on the next run. Two defects
were cancelling; fixing one exposed the other.

---

## MK-090 · The public hint helpers instructed the caller to pass the quantity MK-006 was filed about

**Class** S2 · **Status** fixed · **Found by the same audit**

**Ground truth.** The SortedTroves key is the PRINCIPAL on every operation except an open.
`_computeNominalCR(vars.newColl, vars.newPrincipal)` on the adjust path
(`BorrowerOperations.sol:902-905`), the same on refinance (`:1087`), the same on a partial
redemption (`TroveManager.sol:1287-1290`), and `getNominalICR` itself reads
`Troves[b].principal + pendingPrincipal` (`TroveManager.sol:569-576`). Only `:652`, the open path,
passes `compositeDebt`, and at an open there is no accrued interest so the two coincide.

**SDK location.** `packages/core/src/hints/computeNICR.ts` named the parameter `entireDebt` and
documented it as "The position's ENTIRE debt". `computeHints.ts` repeated it: "The caller supplies
the RESULTING entire debt". Both are on the public client
(`createMusdClient.ts`, `computeNICR` and `computeHints`).

**Every internal call site was correct.** `trove/index.ts`'s `hintsFor` names its own parameter
`principal` and all nine call sites pass principal. MK-006's remediation says the rename was made
"so the wrong quantity cannot be passed by habit". **It stopped one line short**: `hintsFor` took
`principal` and handed it straight back as `entireDebt: principal`, because the public helper still
asked for the entire debt. The adapter line was where the correct name was translated into the
wrong one, and the public signature is what an integrator building their own write path reads.

**Blast radius.** Gas and latency, not funds, exactly as MK-006 records: a NICR below the node's
real key lands the hint in the wrong neighbourhood, `reInsert` re-validates and traverses, and on a
long list that can run out of gas.

### Fixed

`ComputeNICRParams.principal` and `ComputeHintsParams.principal`, with the docstrings stating which
quantity and why the open path makes the two look interchangeable. `hintsFor` has nothing left to
translate.

**The rename was the test.** Excess property checking turned every stale call site into a compile
error: **fourteen in `@musd-kit/core`** (`math.test.ts` 5, `phase3.fork.test.ts` 4,
`zz-findings.fork.test.ts` 4, `harness/openTroveRaw.ts` 1) and **two more in
`@musd-kit/react`** (`hooks.fork.test.ts`), sixteen in total. Twelve were already passing a
principal under the wrong key name, with local variables literally called `principalAfter` and
`expectedFromPrincipal` beside a key called `entireDebt`; two were passing a live Trove's
`entireDebt` and are corrected. **The test suite knew which quantity it meant and the public
signature said the other one.**

**The sweep of the rest of the public surface**, which the wave was asked for: no other exported
docstring instructs a caller into a closed finding. `RedeemResult.truncatedAmount`,
`BorrowingCapacity.remaining`, `ClosePreview.musdRequired` and `MaxWithdrawable.amount` each carry a
warning pointing AT their finding rather than into it.

---

## MK-091 · `close()` computed the last Trove reason and sent anyway, and the revert had no typed error

**Class** S2 · **Status** fixed · **Found by the same audit**

**Ground truth.** `BorrowerOperations._closeTrove` finishes at `:976` with
`troveManagerCached.closeTrove(_borrower)`, which is `TroveManager.sol:472-475` and reaches
`_closeTrove` at `:1390`. There, gated on the same `musdToken.mintList(borrowerOperations)` flag as
the Recovery Mode and TCR checks (`:1395-1399`), it requires
`TroveOwners.length > 1 && sortedTroves.getSize() > 1` (`:1488-1496`) and reverts with
"TroveManager: Only one trove in the system".

**SDK location.** `packages/core/src/math/previewClose.ts` has reported this correctly as
`LAST_TROVE_IN_SYSTEM` since MK-074. `packages/core/src/trove/index.ts`'s `close()` mapped three of
the five block reasons to typed errors and let this one fall through to the send.
`errors/mapRevert.ts` had no pattern for the revert either, so it arrived as `ContractCallFailed`
carrying a raw string, which is precisely what MK-043 existed to remove.

**The preview computed the answer and the write path threw it away.**

**Blast radius.** No gas: the simulation refuses it. The cost is an untyped error where every
neighbouring reason has a typed one, for the holder of the last Trove in a system, which is the
state a fresh deployment and a quiet testnet spend most of their time in. This package's own README
says it is for testnet and evaluation.

**A stale count in the same file.** `trove/index.ts` still read "two of its four gates are
conditional on a live chain read" where MK-074 had made it three of five. MK-074 updated
`previewClose.ts` and not this copy, which is MK-094's shape in prose.

### Fixed

`close()` throws `LastTroveInSystem`, a new typed error, and `mapRevert` maps the revert string to
the same class for a caller who skipped the preview. `ClosePreview` now carries
`troveOwnersCount` and `sortedTrovesSize`, so the error thrown from the preview carries the real
counts rather than the placeholder zeros MK-017 refuses; the decoder, which cannot know them,
passes none. Four chain free tests, and the MK-074 close mutation now fails four tests instead of
two.

---

## MK-092 · `getBorrowingPower` published a cost that was never counted

**Class** S3 · **Status** fixed · **Found by the same audit, which counted it**

**What was claimed.** "Every chain read happens in ONE `multicall` ... That is **three round
trips**, or four when an `account` is supplied in normal mode." An inline comment added that
`fetchPrice` was "included only when the caller did not supply a price" and that
`checkRecoveryMode` "joins this batch" with a supplied price.

**What the code did.** The batch carried four contracts and never any other. `fetchPrice` was a
separate `readContract`, `checkRecoveryMode` another, `isAccountFeeExempt` another, and
`getBorrowingFee` was called TWICE with the same argument on the happy path. Counted with a
counting client:

```
normal mode, no account       6 reads, claimed 3
normal mode, with account     7 reads, claimed 4
Recovery Mode, no account     4 reads
normal mode, price supplied   5 reads, and checkRecoveryMode STILL outside the batch
```

**This is MK-039's shape and MK-081's shape**: a published figure with nothing in the repository
executing it. `docs/08-conventions.md` §10 makes a measurement citable only when the code that
produced it is committed and someone else can run it.

### Fixed

**The code now does what the comment always said.** `fetchPrice` joins the batch when the caller
supplied no price. `checkRecoveryMode` cannot join it and the comment says why rather than
claiming it does: it takes the price as an argument and inside that batch the price does not exist
yet. The confirmation fee is KEPT and reused for the debt floor check instead of being re-read with
the same argument.

**Re-counted, and pinned**: 4 round trips in normal mode with no account, 5 with an account, 3 in
Recovery Mode, 4 with a supplied price, and `getBorrowingFee` at most once on the closed form path.
Five tests in `packages/core/test/borrowing-power-agreement.test.ts` assert the exact call
sequence, so the docstring cannot drift from the code again.

**One stub was wrong for the same reason and is fixed:** `s2-guards.test.ts` returned a fixed
four element tuple from `multicall` regardless of what was asked, so a fifth batched read came back
`undefined`. It answers by function name now.

---

## MK-093 · MK-013's exemption rested on a condition `getBorrowingPower` had broken, and its list was two waves stale

**Class** S2 · **Status** fixed · **Found by reading MK-013 against the tree it exempts**

**What MK-013 says.** It fixed the price/state straddle in `read/` by PINNING rather than merging:
`read/snapshot.ts` returns the price with `Multicall3.getBlockNumber()` from one `eth_call` and the
caller runs the dependent reads at that block. It then states, exactly:

> **What is NOT changed, stated rather than left to be discovered.** `previewOpen`,
> `previewBorrow`, `previewRefinance` and `getBorrowingPower` still read the price in their own
> round trip. **None of them claims a single block snapshot in its docstring**, and moving them is
> a larger change to the math layer's shape than this finding calls for.

**The exemption is conditional, and the condition was broken.** `getBorrowingPower`'s docstring
said "Every chain read happens in ONE `multicall`", which is a single block snapshot claim in a
docstring. The exemption did not cover the tree it was written about.

**The gap is real, not only rhetorical.** The system totals the resulting TCR gate uses come from
the batch; `price` and `checkRecoveryMode(price)` are later round trips. So the TCR gate can mix
system totals from one block with a price from another. Nothing under `math/` uses
`read/snapshot.ts`.

**And the list is stale.** It names four functions. `previewAdjustTrove`, `previewClose`,
`maxWithdrawableCollateral` and `previewRedeem` have the same shape and landed in the MK-042 and
MK-048 waves, after MK-013 was written. None was named.

### Fixed

The false claim is gone from `getBorrowingPower` and replaced by an explicit statement of what the
function does NOT promise, naming MK-013 and `read/snapshot.ts`. MK-013's entry is brought up to
date: it lists all eight preview and calculator functions that read the price in their own round
trip, restates the exemption as a decision about the math layer's shape rather than as a fact about
docstrings, and records that the condition it was originally phrased against is not a durable one.

**Not closed by pinning the snapshot**, deliberately and with the cost stated: moving `math/` onto
`readAtSnapshot` is the larger change MK-013 declined, it would add a round trip to eight
functions, and the window is one block. What changed is that it is now disclosed at every one of
those functions rather than at four of them in a register entry.

---

## MK-094 · Nine protocol rules decided more than once, two of them already diverged

**Class** S2 · **Status** fixed for seven, two named as deliberate · **Found by the same audit,
which produced the table**

**This is the fifth time duplication has produced a defect here**: MK-001 (two liquidatability
predicates), MK-006 (hint basis), MK-017 (duplicated derivations), MK-069 (one fee rule, eight
places, four wrong). The audit's table was treated as a work queue rather than an observation, and
every row is settled below.

| Rule | Sites before | State | Resolution |
|---|---|---|---|
| Borrowing fee applies | 1 (`math/fee.ts`), 6 callers | one copy | Unchanged. MK-069 holds; verified by grep that no site re-derives the conjunction |
| Interest accrual formula | 2 | **DIVERGED** on the base | MK-089. One copy, `accruedInterest` |
| `capacity - entireDebt` headroom | 3 | agreed | `borrowingCapacityOf`, called by `evaluateAdjust`, `getBorrowingCapacity` and `assertWithinBorrowingCapacity` |
| `entire[1] + entire[2]` | 6 | agreed | `troveAmounts(edc)`, a named accessor over the six-tuple |
| Net debt (`entireDebt - 200`) | 10, in **two different shapes** | agreed on active Troves | `netDebtOf`, mirroring `LiquityBase._getNetDebt` (`:107-109`) |
| Trove-is-active test | 5, three as `status !== 1` | agreed | `TroveStatus.active` at all five |
| Basis point divisor | `BPS_DIVISOR` plus 2 literals | agreed | Both literals replaced |
| `_requireNotInRecoveryMode` citation | 2 | **DIVERGED**, `:1023` and `:1024` | `:1023` is correct; `:1024` is `_requireTroveisActive`. MK-075 fixed one copy |
| Close path gate count | 2 | **DIVERGED**, "four" and "five" | MK-091. Both say five, three conditional |

**The net debt row was worse than "ten copies", and the enumeration is what showed it.** Seven
sites floored at zero (`entireDebt > 200 ? entireDebt - 200 : 0n`) and three subtracted
unguarded (`pos.entireDebt - MUSD_GAS_COMPENSATION`, `trove/index.ts` at the repay, adjust and
close paths). On an active Trove the two agree, because the gas reserve is always part of the
debt, so nothing was wrong. **They are still two different implementations of one line of
Solidity**, and which one a future caller copied would have been decided by which file they had
open. The counts in this table were also wrong in the first draft of this entry, at 7, 2 and 8
against the real 6, 3 and 10; they are the output of the grep now rather than a recollection of
it, which is the same discipline §12 asks for and the same one this row is about.

**What prevents divergence now, per row, rather than "they agree".** The first seven are one
function or one constant with callers, so a change lands in one place by construction and a
disagreement is not expressible. `troveAmounts` in particular closes a case that was worse than it
looked: a positional index into a generated six-tuple would have moved all seven sites silently and
identically on a regeneration.

**Two are prose, and prose has no compiler.** The contract citation and the gate count were
comments that drifted from their pair. Nothing structural prevents a comment from going stale; what
is added instead is a check in the conventions checklist for a finding that edits one copy of a
cited rule, asking where else that citation appears. That is a weaker control and it is labelled as
one.

**Deliberate duplication, named rather than removed.** Two remain and both are load bearing:
`packages/core/test/borrowing-power-agreement.test.ts` and `phase4.fork.test.ts` restate the
contract's fee condition instead of importing `isBorrowingFeeCharged`, and
`preview-redeem.test.ts` restates the interest formula with the constant written out. Importing
would make each assertion a tautology, which is MK-070's defect. **A test that restates the
CONTRACT is independent; a test that restates the IMPLEMENTATION is not**, and that is the line.

---

## MK-095 · The redemption margin was sized for exactly the window it advertises, and only worked because a different defect over-stated it

**Class** S2 · **Status** fixed · **Found by the fork gate, on the run that verified MK-089**

**This is the wave's own regression, caught by the gate that exists for it.** MK-089 corrected the
accrual base from the entire debt to the principal, which is what
`InterestRateMath.calculateInterestOwed` takes (`InterestRateMath.sol:12-22`) and what
`TroveManager.sol:1236-1241` passes. Nothing else changed. `redeem-boundary.fork.test.ts` then went
red on one row:

```
  warp    600s  netDebt + margin  simulate=ACCEPTED send=reverted targetStatus=1
```

with `netDebt=2358261948990159125633` and `margin=481740441852559`.

**What the correction removed was not an error, it was the slack.** The entire-debt base
over-stated the margin by the interest already owed, about 1 percent on that fixture, which is
roughly **6 seconds of accrual**. The quantity the margin actually has to cover is the accrual
between the block the preview READ at and the block the transaction SETTLES in, and a caller
cannot make those the same block: a transaction is always mined after it is priced. Sizing the
margin for exactly the advertised 600 seconds leaves **zero** for the settlement block, so the
amount is short by whatever the Trove accrued in it. The old figure covered that block by accident,
from a defect, and nobody had named it.

**The conflation underneath.** `600` came from `TroveManager.sol:1276-1285`, where the contract
allows ten minutes of accrual when it bounds a partial redemption HINT. That is a different
quantity from a caller's settlement delay, and the original docstring presented it as "the
contract's own allowance for accrual ... rather than a number chosen to feel safe". It was the
contract's allowance for something else.

### Fixed

`MARGIN_WINDOW_SECONDS = 900n`, with the advertised window still 600 and the 300 second difference
stated as what it is: room for settlement, not a cushion. **Both ends of the claim are still
asserted on chain**, which is what keeps this bounded rather than an ever growing safety factor:
the ladder requires `send=success` at 1, 60 and 600 seconds and `send=reverted` at 3600 and 86400.
Re-measured after the change, on the same fork at the same block:

```
  warp    600s  netDebt + margin  simulate=ACCEPTED send=success  targetStatus=4
  warp   3600s  netDebt + margin  simulate=REFUSED  send=reverted targetStatus=1
```

**Pinned chain free as well as on the fork**, because the fork test is the slow gate and the
mutation check runs the unit project: `preview-redeem.test.ts` asserts the exact margin against an
independently written 900, so shrinking the window back to 600 fails it. That mutation is in
`scripts/mutation-check.mjs`.

**The lesson, which is the part worth keeping.** Two defects were cancelling: a wrong base and an
unsized settlement window. Fixing one exposed the other, and the gate that showed it was the fork
suite rather than any reasoning about the contract, because the settlement block is not visible in
the Solidity. **A guarantee that only holds because of a defect elsewhere is not a guarantee**, and
the only way this was ever going to be found was by sending across a delay, which is step 11 of the
wave checklist.

---

## The P17 sweep, run against this tree

**1000 cases, four slices, seed 20260826, fork block 15043414, Node v24.19.0.** Run after every
change in this wave, against the tree at `327949a`, with the commands the sweep workflow uses:

```
MK_DIFF_SEED=20260826 MK_DIFF_CASES=1000 MK_DIFF_FROM=<from> MK_DIFF_TO=<to> pnpm test:fork
```

| Slice | Exit | Wall clock | FALSE_VIABLE | FALSE_BLOCKED | NUMBERS | unexpected |
|---|---|---|---|---|---|---|
| 0..250 | 0 | 15m19s | 0 | 1 | 0 | **0** |
| 250..500 | 0 | 17m12s | 0 | 6 | 0 | **0** |
| 500..750 | 0 | 17m10s | 0 | 1 | 0 | **0** |
| 750..1000 | 0 | 16m49s | 0 | 2 | 0 | **0** |
| **total** | | **66m30s** | **0** | **10** | **0** | **0** |

**Zero FALSE_VIABLE across a thousand cases**, which is the claim the README makes and is the one
worth having: no preview said go where the chain refused.

**All ten FALSE_BLOCKED are MK-079, and they land on exactly the indices its `knownAt` records**:
209, 252, 329, 370, 449, 455, 486, 720, 817, 893. That is the registry mechanism working in both
directions at once. It is also an independent confirmation that the recorded indices are right, at
the seed and case count they are scoped to, which nothing had re-checked since they were written.

**66 minutes, not the 116 the runbook cites, and the difference is the machine.** The 116 figure
was measured in the P15 wave and is labelled there; this one is an Apple silicon laptop against the
public `rpc.test.mezo.org` with a warm anvil cache. **Neither number is CI's**, and per the rule
MK-081 established a published duration names the machine it was measured on. The runbook's figure
is left as it is, because replacing a figure measured elsewhere with one measured here is the
mistake MK-081 was.

**What the sweep does NOT cover, restated because this wave is about exactly that**: it drives
`client.*` and never renders a React hook, so MK-085 was outside it by construction. See MK-087.

---

## MK-096 · The packaging gate's probe is source nothing compiles, guarded by a gate CI does not run

**Class** S2, process · **Status** fixed · **Found by running `pnpm gate:packaging` after the
public surface changed, which nothing asked for**

**What happened.** MK-088 removed `EvaluateRedeemInput.interestRateBps`. `pnpm typecheck` was
clean, `pnpm lint` was clean, the full fork gate was green, the 1000 case sweep was clean, and CI
was green on all four jobs across three Node versions. Then `pnpm gate:packaging` failed **4 of 4
rows**:

```
  (absent, CommonJS)  node16  node16  FAIL
      first error: probe.ts(10,3): error TS2353: Object literal may only specify known
      properties, and 'interestRateBps' does not exist in type 'EvaluateRedeemInput'.
```

**The package was fine. The probe was stale**, and nothing could have told anyone.

**Two controls stopping short of each other.** `scripts/packaging-gate.mjs` holds its consumer file
in a `PROBE` template literal, so to `tsc` it is a string: `pnpm typecheck` cannot see it, and
neither can lint. The only thing that compiles it is the gate itself, and the gate is not in CI. It
is step 6 of the release runbook, run by hand, at release time. So the window between a breaking
public shape change and anyone learning the probe had gone stale was **the whole wave**, and the
place it would have surfaced is the last place anybody wants a surprise.

**This is MK-053's shape and MK-080's shape.** A control that exists, is cited, and does not
execute. It is also MK-040's own lesson turned one notch: MK-040 exists because a workspace
typecheck cannot see an export map defect, and the instrument built to see it was itself placed
where no typecheck could see it.

### Fixed

The probe is updated to the current surface and widened deliberately: it now touches
`accruedInterest` and `netDebtOf` (MK-089, MK-094), `LastTroveInSystem` (MK-091),
`AdjustPreviewLegs` and `useAdjustTrovePreview` (MK-085), and constructs an `EligibleTrove` with
its own `principal` and `interestRateBps` (MK-088). Re-run: **GATE PASSED, four of four rows, 105
exports by `require` and 105 by `import`.**

**And `pnpm gate:packaging` is a CI step now**, in the fork gate job beside `release-smoke.sh`. It
packs, installs into a scratch consumer and runs `tsc` four times, which is the reason it was left
manual; the cost of leaving it manual turned out to be higher. `docs/09-review-and-validated-surface.md`
said this row was "**Manual, at release preparation, not automated**" and that automating it "needs
a pack, an install and a `tsc` run, which is its own job". It is automated now and that row says so.

---

## MK-097 · The version step's verification list omits the checks its own output must pass, and it turned `main` red

**Class** S2, process · **Status** fixed · **Found during the 0.3.0 release, by precondition 1
failing at the commit the release was about to ship**

**What happened.** `pnpm changeset version` ran on `main` as §0a documents. Its "What to verify
after it" table has five rows and every one of them passed: both versions read `0.3.0`, both
changelogs opened with `## 0.3.0`, all four changesets were consumed, the diff touched only
manifests, changelogs and `.changeset/`, and `npm view` still returned `0.2.0` so the number was
free. The commit was pushed on that evidence.

**CI then went red at `main`'s tip**
([run 34704441456](https://github.com/cayvox/musd-kit/actions/runs/34704441456)), on step 6, `Lint`,
in all three Node legs, with the fork gate skipped because it `needs: checks`:

```
-  "files": ["dist", "README.md", "LICENSE"],
+  "files": [
+    "dist",
+    "README.md",
+    "LICENSE"
+  ],
```

`changeset version` rewrites the manifests with its own JSON writer, which expanded the `files`
array, and `biome check` rejects that formatting. **The generated output was never checked against
the formatter the repository enforces**, because §0a's list does not include `pnpm lint`, or
`pnpm typecheck`, or anything else from the standing wave checklist in `docs/08-conventions.md`.

**Why the earlier release did not hit it.** `ae1785e`, the 0.2.0 version commit, changed one line
(`1 insertion, 1 deletion`) and did not touch `files`. The array was already single-line and
changeset had no reason to rewrite it. So there was no prior red release commit to learn from, and
the gap sat unexercised.

**This is the family named in MK-083 and MK-080: a document describing its neighbour rather than
itself.** §0a's list verifies what the command *produced* semantically and says nothing about what
the commit has to *pass*. A generator that writes tracked files is code, and its output is subject
to the same gates as hand written code.

### Fixed

§0a's verification table gains a final row: run the standing checklist before pushing, naming lint,
typecheck, unit, examples, site and links at minimum, with the reason stated. The repair for 0.3.0
was `749730b`, formatting only, verified by parsing both manifests and comparing them to the
previous commit as JSON (`IDENTICAL as JSON` for each) rather than by reading the diff.

**Cost, recorded because it is the argument for the row.** One red commit on `main`, one repair
commit, and a **second sweep requirement**: the sweep dispatched against `1cfb263` no longer
measured the released tree once `749730b` existed, so precondition 7 had to be satisfied again.

---

## MK-098 · The version step's changeset table names three entries and there are four

**Class** S3 · **Status** fixed · **Found while running §0a for 0.3.0**

§0a's "What it does, for this release" closes with: "The three changesets consumed are
`borrow-evaluator-delegation`, `fee-rule-one-implementation` and `react-borrow-preview-union`."

There were **four**. The P17 wave added `react-preview-presence-and-redemption-rate` for MK-085 and
MK-088, and the tree at the version commit shows all four consumed with only `README.md` and
`config.json` left in `.changeset/`.

**The predicted bumps were unaffected**, which is why this is S3 rather than S2:
`pnpm changeset status` run read only before the step listed core and react at minor and the two
private examples at patch, exactly as the table predicts. What was wrong was the count and the file
list, which is the part a reader uses to check that nothing was lost.

**Same family as MK-097 and MK-062.** A table describing a specific release, left in place while
the release it describes moved underneath it.

### Fixed

The section no longer enumerates that wave's changesets at all. It names the command that produces
the list, `pnpm changeset status`, and says to read its output, because a list of file names in a
document is a copy of something the tool already knows and will go stale on the next wave exactly
as it did on this one.

---

## MK-099 · Precondition 7 states its condition as a dispatch when what it means is the head and the parameters

**Class** S3 · **Status** fixed · **Found when the weekly scheduled sweep landed on the release
commit**

**What the runbook said.** Precondition 7's **How** column is
`gh workflow run sweep.yml --ref main`, and its **What passed looks like** column is "A run whose
`headSha` equals the commit being released, `conclusion: success`". The two columns state different
conditions, and only the second is the one that matters.

**What happened.** After the MK-097 repair, `main` settled at `749730b` and the weekly scheduled
sweep fired at 07:47Z and ran against exactly that commit
([run 34746081139](https://github.com/cayvox/musd-kit/actions/runs/34746081139)). Read literally,
the **How** column would have required a second two hour dispatch producing duplicate evidence
about an identical tree.

**Checked rather than assumed, because a schedule taking different parameters would not be the same
evidence.** The harness echoes its parameters into the run, and the scheduled run printed
`seed=20260826 cases=1000` in all four slices, at fork block `15043414`. The workflow resolves
`MK_DIFF_SEED: ${{ github.event.inputs.seed || '20260826' }}` and the same shape for `cases`, and a
`schedule` event carries no `inputs`, so the `||` fallback hands a schedule precisely the values a
default dispatch would use. The four slices covered `0..250`, `250..500`, `500..750`, `750..1000`
with `ran=250` in each: 1000 cases, contiguous, no gap.

### Fixed

Precondition 7's **What passed looks like** column now states the condition in full: a sweep run
whose head equals the commit being released, whose seed, case count and fork block match the
defaults, whose slices cover the range without a gap, and which is green. The **How** column keeps
the dispatch with one sentence explaining why it is the usual route: a release almost never sits on
the commit the last Sunday run saw, **not** that a scheduled trigger is weaker evidence. The
trigger event is not part of the condition.

---

## MK-100 · `getBorrowingPower` returns the liquidation threshold as the amount to borrow

**Class** S1 · **Status** fixed, in the P21 wave, for 0.4.0. The warning shipped in 0.3.1 with the
value unchanged; the fix changes the return type · **Found by an external audit of the published
0.3.0, reproduced end to end here before it was filed**

**The sentence to carry forward.** Every previous examination of this function asked whether the
contract would accept the number, and none asked what happens after acceptance. The differential
sweep cannot see it either, because its assertion is verdict against revert, and here the
transaction succeeds.

**Why S1.** The figure is exactly right as a statement about the open gate, and that is what makes
it dangerous rather than harmless. It is published as the amount a caller may borrow ("the largest
draw that OPENS a valid Trove", and, until this wave, `const { data: max } = useBorrowingPower(...)`
on the landing page), it is plausible, and acting on it raises no error at any step: the open succeeds. The loss
arrives afterwards, from someone else's transaction.

**Ground truth, read from `mezo-org/musd` in this wave.**

- `BorrowerOperations.sol:648-651`: at open the ratio is `_computeCR(msg.value, compositeDebt,
  price)` on `draw + fee + 200`, with no interest in it, because the Trove has none yet.
- `:654-657`: Recovery Mode requires `_requireICRisAboveCCR`, normal mode `_requireICRisAboveMCR`,
  which is `require(_newICR >= MCR)` (`:1330-1335`). Normal mode also needs a resulting
  `TCR >= CCR` (`:658-665`).
- `TroveManager.sol:1146-1148`: liquidation is `if (vars.ICR < MCR)`, against `getCurrentICR`,
  whose debt is `_getTotalDebt` (`:1513-1527`), which adds `calculateInterestOwed(principal,
  interestRate, lastInterestUpdateTime, block.timestamp)`. The debt grows every second.
- `ActivePool.sol:134-144`: the system debt the TCR gate reads adds
  `interestRateManager.getAccruedInterest()`, so it grows every second too.
- What a liquidation does to the borrower: `_liquidate` closes the Trove
  (`TroveManager.sol:1101`, `_closeTrove(_borrower, Status.closedByLiquidation)`) and
  `_closeTrove` zeroes its collateral (`:1409`). The collateral goes to the Stability Pool offset
  or to redistribution (`:1087-1099`), less 0.5% and 200 MUSD to the liquidator (`:1080-1083`).
  The borrower keeps the MUSD they drew and owes nothing.

**SDK location.** `packages/core/src/math/getBorrowingPower.ts`: `solveClosedForm` (`:357`) caps at
`min(icrCap, tcrCap)` (`:371-374`) with `targetRatio = isRecoveryMode ? CCR : MCR` (`:206`), walks
up to the largest feasible draw, and returns it. Surfaced as `MusdClient.getBorrowingPower`
(`packages/core/src/client/createMusdClient.ts:259`) and `useBorrowingPower`
(`packages/react/src/hooks/reads.ts:78`). Callers of the rule, enumerated by package (§12): core
(the function and the client method), react (the hook), `examples/open-and-manage/src/App.tsx`
(displays it beside the draw input), `landing/src/components/Architecture.astro` (the snippet
above), and `scripts/testnet-e2e.ts:411` (logs it, opens nothing at it).

**Measured, reproducible:** `MEZO_FORK_BLOCK=15043414 pnpm exec vitest run --project fork
packages/core/test/zz-borrowing-power-boundary.fork.test.ts`. Every open is sent one second after
the number was read, because a real chain cannot include it in the block it was read at:

```
[MK-100] getBorrowingPower(1 BTC)=69776684515484515484516 at price=77051107320000000000000
  at open: max icr=1100000000000000000 (MCR=1100000000000000000)  control icr=1374019206948458342
  warp     1s  max liquidatable=true   control(80%) liquidatable=false
  warp    60s  max liquidatable=true   control(80%) liquidatable=false
  warp   600s  max liquidatable=true   control(80%) liquidatable=false
  warp  3600s  max liquidatable=true   control(80%) liquidatable=false
  liquidate(max) after 1s: receipt=success status=3 opener MUSD kept=69776684515484515484516
[MK-100] the regimes that do not land on MCR
  Recovery Mode (tcr=1401587067735672135): power=25761865282310469314079 icr at open=1500000000000000000 (CCR=1500000000000000000) liquidatable after 3600s=false
  System ratio binding (collateral=2828504838638170249926, tcr=1551757110707351293): power=95981723398357339243098024 vs the ICR-only cap 110865151397908058678040520; open sent 1s later: threw(SystemRatioBelowCCR)
```

That output is the file run alone. Inside the full fork suite (five consecutive runs on Node
24.19.0 at block 15043414, all green) the normal mode rows print the same figures to the wei; the
Recovery Mode and system ratio rows print slightly different `tcr`, `power` and `collateral`,
because they depend on the system state earlier files leave behind and on wall clock accrual.
Those two rows are asserted as bounds, not as exact values.

In that run the borrower gave up 1 BTC, worth 77051.10732 MUSD at the fork's price, and kept
69776.68 MUSD: about 9.4% of the collateral's value, arithmetic on the two printed numbers.

**So the scope is precise, and narrower than "every answer".**

| Regime | Where the maximum lands | What happens after |
|---|---|---|
| Normal mode, individual ratio binds (the ordinary case: TCR 2.77 at the pinned testnet block) | ICR exactly `MCR` | Accepted a block later, liquidatable within a second, liquidated. **This is the finding** |
| Recovery Mode | ICR exactly `CCR` | Not liquidatable after an hour. No margin, but not this loss |
| Normal mode, system ratio binds | System TCR exactly `CCR` | Refused a block later with `SystemRatioBelowCCR`, because the system debt accrued. Loud, no collateral at risk |

**Why it survived, entry by entry.** MK-010 asked how many calls it makes. MK-067 and MK-069 asked
whether it charges the fee the contract charges. MK-070 opened at it on chain in Recovery Mode and
asserted one wei more reverts. MK-092 and MK-093 asked about round trips and block snapshots.
`borrowing-power-agreement.test.ts` pins that the answer is viable and one wei more is not. The
sweep's `borrowingPower` op compares a verdict against a revert. `docs/09` §3 marked the row
**Validated**. Every one of those is a question about acceptance, and every one is correct.

**And the class was already known.** MK-072 established that `maxBorrowingCapacity` and the entire
debt at `ICR == MCR` are the same expression, and fixed it **on that field only**. The same
equality is the definition of this function's normal mode answer. That is §12's defect: the
enumeration was scoped to the field the finding was found on, not to the rule.

### The same shape elsewhere, reported in 0.3.1 and decided in P21

The table below is the 0.3.1 record. The decision for each figure, and the evidence that replaced the
two unestablished rows, follow it under **Decided per figure**.

The question: which figure the SDK reports as a maximum or a limit lands the caller on a threshold
the contract accepts and then leaves them exposed.

| Figure | Lands on | Evidence | What a caller meets |
|---|---|---|---|
| `getBorrowingPower`, normal mode | `ICR == MCR` | Reproducible, above | Accepted a block later, then liquidatable. **The only one accepted by default** |
| `BorrowingCapacity.remaining` | `ICR == MCR` at the opening price | MK-072, from source (`BorrowerOperations.sol:1323-1328` against `:1330-1335`); its fork ladder is recorded in that entry but, as the entry says, has no committed instrument | The exact figure is refused one second later. A draw a hair under it is accepted and lands a hair above MCR |
| `maxWithdrawableCollateral.amount`, `limitedBy: 'ICR'` | `ICR == MCR`, rounded up to clear it (`packages/core/src/math/previewAdjust.ts:575`) | MK-051's committed ladder, `withdraw-max-boundary.fork.test.ts` | Refused one second later at the exact figure; a hair under is accepted near MCR |
| `AdjustPreview.minimumCollateralToClearIcr`, normal mode | `ICR == MCR`, rounded up (`previewAdjust.ts:342-345`) | **Unestablished here**: derived from source; an uncommitted external script observed it accepted and liquidatable one second later only in a block sharing the read's timestamp, which a real chain does not produce | A rescue sized from it either reverts a block later or, if accepted, leaves the rescued Trove at the liquidation threshold |
| `maxWithdrawableCollateral.amount`, `limitedBy: 'TCR'` | System `TCR == CCR` (`previewAdjust.ts:576`) | **Unestablished here**, same caveat | Exposure is the whole system entering Recovery Mode, not a liquidation |
| `Trove.liquidationPrice` | `floor(MCR * entireDebt / collateral)` (`packages/core/src/math/compute.ts:36-42`) | Derived from source: flooring puts the reported price at or below the true threshold | At exactly the reported price the Trove can already be liquidatable, and the figure moves with accrual. Adjacent, not the same shape |

Redemption's `maxWithoutConsuming` and `nextViableAmount` and `previewClose.musdRequired` were
checked and are not this shape: their failure mode is a refusal (MK-048, MK-050), and the exposure
of an accepted redemption falls on other people's Troves, not the caller's.

### Documented, not fixed

0.3.1 changes no behaviour and no API. It adds the warning to the function's own docstring (what
TypeDoc publishes and an editor shows on hover), `MusdClient.getBorrowingPower`, `useBorrowingPower`,
both package READMEs, `docs/03-core-api.md`, `docs/04-react-api.md`, `docs/05-math-and-hints.md`,
`docs/09-review-and-validated-surface.md`, the example app and the landing snippet. The warning
says what the number is, that it leaves no margin, that a Trove opened at it can be liquidated
within seconds, and that the caller must apply their own buffer.

**What closes this.** A decision about what the function returns: a maximum with a margin built in,
a maximum plus the ratio it lands at, or a function that takes the target ratio as an input. Any of
them changes a published return value, which is why it is not in a warning release.
`zz-borrowing-power-boundary.fork.test.ts` pins today's behaviour, so the change goes red there and
names this entry.

### Fixed: two named figures, and a margin chosen from measurement (P21)

**The shape.** `getBorrowingPower` returns `BorrowingPower`: `ceiling` (what 0.3 returned),
`recommended`, the ICR each opens at, the `margin` they differ by, the mode and the price. Neither is
ever returned under the other's name. `useBorrowingPower` returns `recommended`;
`useBorrowingPowerDetail` returns the whole record over the same query.

**The margin.** `recommended` is the same solver, with the same `evaluateOpen` feasibility predicate,
at `stressedPrice = price * (10000 - priceMoveBps) / 10000 / (1 + accrual)`, where `accrual` is
`windowSeconds` of interest at `interestRateManager.interestRate()`, the rate a new Trove carries
(`BorrowerOperations.sol:668-672`), rounded up. Every open gate compares `collateral * price` with a
multiple of the debt, so clearing them at the stressed price is clearing them after that fall together
with that accrual. The fee's linearity, confirmed against the chain for the ceiling, is reused, so the
round trips are unchanged: four, five with an account, three in Recovery Mode.

**The constants, from measurement.** `scripts/oracle-moves.ts` over Mezo mainnet: across 610589
seconds sampled every 16 blocks, the worst fall inside a window was p99 6.26 bps and max 80.68 over 60
seconds, p99 42.56 and max 163.43 over 600, p99 132.56 and max 190.78 over 3600.
`BORROWING_POWER_MARGIN_WINDOW_SECONDS = 3600n`, because the proof asks for an hour and a person, not
a script, sits between the read and the send. `BORROWING_POWER_PRICE_MOVE_BPS = 200n`, the hour's
maximum rounded up. Both docstrings state the window and say what the measurement cannot show: one
week is one regime, and one sample in sixteen blocks misses a dip that recovers between samples.
`borrowing-power-agreement.test.ts` fails if either is lowered under what the measurement supports.

**Proven after the open, which is what every earlier check missed.** From
`zz-borrowing-power-boundary.fork.test.ts`, the existing assertions about the ceiling kept unchanged:

```
[MK-100] getBorrowingPower(1 BTC) ceiling=69776684515484515484516 recommended=68377076589049038800632 at price=77051107320000000000000
  margin: 200 bps, 3600s at 100 bps interest, stressedPrice=75509999032201896623376
  at open: ceiling icr=1100000000000000000 (MCR=1100000000000000000)  recommended icr=1122450258652794681 (reported 1122450260075555990)  control icr=1374019205206820932
  warp     1s  ceiling liquidatable=true   recommended liquidatable=false  control(80%) liquidatable=false
  warp    60s  ceiling liquidatable=true   recommended liquidatable=false  control(80%) liquidatable=false
  warp   600s  ceiling liquidatable=true   recommended liquidatable=false  control(80%) liquidatable=false
  warp  3600s  ceiling liquidatable=true   recommended liquidatable=false  control(80%) liquidatable=false
  warp 3600s and a 199 bps fall  recommended liquidatable=false
  warp 3600s and a 210 bps fall  recommended liquidatable=true
  System ratio binding: recommended=85504975290114418897309247; open sent 1s later: success
```

The observed ICR sits under the reported `recommendedIcr` by the seconds of interest between the open
and the read, which the test bounds rather than equates.

**The margin is the caller's to change, and never ambiguous.** `marginWindowSeconds` and
`priceMoveBps` override the defaults per call, on `getBorrowingPower` and on both React hooks, which
forward them and key each margin separately. The result's `margin` always carries the values used.
An override outside `0 <= priceMoveBps < 10000` or a negative window throws `InvalidAmount` before any
read: accepted, a negative value lifts the stressed price above the real one and the solver's clamp
returns the ceiling as `recommended`. Pinned as the same boundary at the override's own stressed
price (`borrowing-power-agreement.test.ts`) and rendered (`hooks-rendered.test.ts`); mutation ids
`MK-100 override window`, `override move`, `override ignored`, `hook override`, `hook key`.

### Decided per figure

The rule the decision follows: **the same treatment is owed where the SDK's figure is ACCEPTED at the
threshold, and not where it is refused.** `_openTrove` evaluates its gates with no accrual
(`BorrowerOperations.sol:648-657`), which is why the ceiling is accepted a block later. `_adjustTrove`
first calls `updateSystemAndTroveInterest` (`:769`), so every adjust gate sees the debt at execution
and an exact figure read a block earlier is refused.

| Figure | Decision | Why, and the evidence |
|---|---|---|
| `getBorrowingPower`, normal mode | **Same treatment**: `ceiling` plus `recommended` | Accepted a block later at MCR, then liquidatable. Fixed above |
| `getBorrowingPower`, Recovery Mode | Covered by the same fix | The ceiling lands on CCR, not a liquidation threshold; `recommended` sits under it by the margin |
| `getBorrowingPower`, system ratio binding | Covered; fails loudly without it | The ceiling is refused a second later with `SystemRatioBelowCCR`; `recommended` opens. Both measured |
| `BorrowingCapacity.remaining` | **Fails loudly. No second figure** | Refused one second after the read with `ExceedsBorrowingCapacity`, before gas, with a 99% control accepted (`zz-limit-figures.fork.test.ts`). This row was "no committed instrument"; it has one now. The docstring says a draw just under it is still accepted near MCR and points at `previewBorrow`'s `resultingIcr` |
| `maxWithdrawableCollateral.amount`, `limitedBy: 'ICR'` | **Fails loudly** | Refused one second later with `InsufficientCollateral`, 99% control accepted, in the same file, alongside MK-051's ladder |
| `AdjustPreview.minimumCollateralToClearIcr` | **Fails loudly** | **Was unestablished; now measured**: on a Trove interest took under MCR, a top-up of exactly the figure sent one second later is refused with `InsufficientCollateral`, the Trove stays liquidatable, and twice the figure is accepted. The docstring now says to add a margin above it |
| `maxWithdrawableCollateral.amount`, `limitedBy: 'TCR'` | **Fails loudly, by the same mechanism; not separately measured** | System debt accrues too (`ActivePool.sol:134-144`), as the open-time system ratio case measures. A fixture that makes the system ratio bind a single withdrawal was not built in this wave, so the row stays unestablished |
| `Trove.liquidationPrice` | **Documented, not changed** | A display threshold, not an amount anyone sends. The floor puts it at most one wei under the true threshold, and accrual moves the true threshold up every second by far more; the docstring now says both (MK-109) |

Redemption's `maxWithoutConsuming` and `previewClose.musdRequired` stay as recorded above: their
failure is a refusal. `nextViableAmount` carries its own margin and is proven through `redeem()`
under MK-104.


**Superseded by MK-240.** This entry fixed "liquidatable in one second" with a margin sized for an hour, and
published the result under a name, `recommended`, that answered how much to borrow and hold. Nobody asked for
how long. 0.5.0 removes the default: the ceiling stays, and a draw is sized to a horizon and a fall the caller
supplies. The 200 bps default did not cover this entry's own quantity once measured over a longer range: the
worst hour over 86 days was 418.47 bps.

---

## MK-101 · `previewRefinance` omits the new rate and the capacity reset, and capacity is documented as ratchet only

**Class** S1 · **Status** fixed (P21) · **Found by an external audit of the published 0.3.0, re-read
from the contract here before it was filed**

**Ground truth.** `_refinance` sets the Trove's rate to the global rate, whatever it is:
`vars.newRate = vars.interestRateManagerCached.interestRate()` (`BorrowerOperations.sol:1069`) and
`setTroveInterestRate(_borrower, vars.newRate)` (`:1075`). It then sets
`maxBorrowingCapacity = _calculateMaxBorrowingCapacity(getTroveColl(_borrower), vars.price)`
(`:1077-1084`) **unconditionally**, at the current price. The adjust path is the only place the
capacity is `min(current, recalculated)` (`:879-897`), so a refinance can raise the capacity when the
price has risen and cut it when the price has fallen, with no collateral change.

**SDK location.** `RefinancePreview` (`packages/core/src/math/previewRefinance.ts:52-80`) carries
the fee, the principal and the ratios, and no field for the rate the Trove carries now, the rate it
will carry, or the capacity after. The ratchet only claim is made in
`packages/core/src/errors/index.ts:78` and `:106`, `packages/core/src/math/getBorrowingPower.ts:71-72`,
`packages/core/src/math/previewAdjust.ts:59`, `packages/core/src/math/previewBorrow.ts:45`,
`packages/react/src/hooks/reads.ts:72`, `docs/03-core-api.md:317-318`, `docs/04-react-api.md:59`,
`docs/05-math-and-hints.md:120` and `docs/14-migration-0.2-to-0.3.md:113`, and in test comments
(`obligations.fork.test.ts:40`, `preview-verdicts.test.ts:261`, `zz-findings.fork.test.ts:42`, `:273`).

**Why S1.** The preview says `viable: true` and reports a fee. It does not say that the operation
moves the Trove to a different rate, which is the one number a refinance decision turns on, or that
it can cut the capacity every later borrow is gated on. Acting on it raises no error.

**Evidence at registration: observed by the external audit with an uncommitted script**, so not yet
citable as a measurement here: on a mainnet fork the preview returned `viable: true` while the
refinance moved a Trove from 100 to 500 bps, and capacity went 69772 to 90704 to 54545 across two
refinances at different prices. The instrument is committed in the wave that fixes it.

**Fixed.** `RefinancePreview` carries `currentInterestRateBps` (`getTroveInterestRate`),
`resultingInterestRateBps` (`interestRateManager.interestRate()`, what `:1069` reads),
`currentCapacity` (`getTroveMaxBorrowingCapacity`) and `resultingCapacity`, computed by
`maxBorrowingCapacityAt(collateral, price)`, the one copy of `:1323-1328`. Every ratchet only claim
listed above now says what a refinance does.

**Measured, and the instrument is committed** (`zz-refinance.fork.test.ts`). The council is
impersonated to propose 500 bps and approve it seven days later (`InterestRateManager.sol:129-153`),
then the owner refinances after a price rise and again after a fall, and the preview is compared with
what the chain holds after each write:

```
  after a 20% rise: preview rate 100 -> 500, capacity 70046461200000000000000 -> 84055753440000000000000; chain rate 100 -> 500, capacity 70046461200000000000000 -> 84055753440000000000000
  after a fall to 90%: preview rate 500 -> 500, capacity 84055753440000000000000 -> 63041815080000000000000; chain rate 500 -> 500, capacity 84055753440000000000000 -> 63041815080000000000000
```

Equal to the wei, both directions. A `viable: true` refinance that quintuples the rate and one that
cuts the capacity by a quarter are now both visible before the write. Mutation ids `MK-101 rate`,
`MK-101 capacity`, and `MK-101 fork` under `--all`.

---

## MK-102 · The React read hooks keep the previous query's data and report it as a success

**Class** S1 · **Status** fixed (P21) · **Found by an external audit that rendered the hooks**

**Ground truth, the library rather than the contract.** `useMusdQuery` passes
`placeholderData: keepPreviousData` (`packages/react/src/internal/useMusdQuery.ts:34`). In TanStack
Query v5 placeholder data is served while a query has no data of its own, and a query whose key
changed, or which is disabled, has none. A disabled query never fetches, so the placeholder stays.

**What that produces.** A cleared amount keeps the verdict for the last amount typed, a wallet that
disconnects keeps showing the previous account's Trove, and a switched account first renders the
other account's position. `status` reads `success` throughout; only `isPlaceholderData` tells them
apart, and no example in the repository reads it.

**Why S1.** A dashboard or a form renders a plausible wrong number as current, with no error. Writes
still precheck before sending, so the loss is in what a user decides from the screen.

**Evidence at registration: observed by the external audit** with React Testing Library against a
fork; the rendered tests are committed with the fix. MK-085 fixed the query KEY for absent legs and
its comment states the empty input concern; the placeholder is how the concern survived that fix.

**Fixed.** `packages/react/src/internal/useMusdQuery.ts` passes no placeholder, sets `gcTime: 0` so a
key no hook observes keeps nothing to serve on return, and reports a disabled query as
`data: undefined`, `pending`, whatever its cache holds. A refetch of the same key on a new block still
keeps the last answer visible, which is pinned too, so the fix cannot overcorrect silently. The write
hooks reset `data`, `hash` and status when the account or chain changes.

**Rendered, chain free, every hook** (`packages/react/test/hooks-rendered.test.ts`): a changed key is
pending with no data; a cleared input shows nothing; a disabled query under the SAME key, whose cache
still holds an answer, shows nothing; returning to an earlier key under a client with the default
five minute `gcTime` does not serve its old answer; a disconnect clears the Trove; every read hook
forwards exactly its arguments; every write hook sends exactly its parameters; a write resets on an
account switch and not on a re-render. Mutation evidence: restoring the placeholder, removing
`gcTime: 0`, narrowing the disabled override and removing the write reset are each caught
(`node scripts/mutation-check.mjs`, ids `MK-102 *`).

---

## MK-103 · Partial redemptions through `redeem()` cancel on almost any price move before inclusion

**Class** S2 · **Status** fixed as far as the contract allows (P21) · **Supersedes MK-049's class and
its mitigation**

**Ground truth.** A partial is priced twice. `HintHelpers.getRedemptionHints` computes the resulting
NICR from collateral less `maxRedeemableMUSD * DECIMAL_PRECISION / _price` at the price it was given
(`HintHelpers.sol:143-160`). `_redeemCollateralFromTrove` computes it at the price when the
transaction mines (`TroveManager.sol:1224-1230`, `:1287-1290`) and cancels the partial when
`_partialRedemptionHintNICR < vars.newNICR` or `> vars.upperBoundNICR` (`:1299-1306`), where the
upper bound differs from `newNICR` only by `calculateInterestOwed(trove.principal, interestRate,
block.timestamp - 600, block.timestamp)` at the GLOBAL rate (`:1276-1285`). A cancelled first partial
breaks the loop (`:392`) and, with nothing drawn, reverts the call (`:406-408`).

So the hint must land inside a band whose relative width is about 600 seconds of interest on the
principal, while any price move shifts both edges. A price rise lowers the collateral drawn, raises
`newNICR` above a hint computed at the lower price, and cancels.

**SDK location.** `packages/core/src/redemption/redeem.ts:185-195` passes the helper's NICR, which
sits on the LOWER edge of that band at the read price, so there is no tolerance for a rise at all.
`previewRedeem` reports the partial `viable` with no price condition.

**Evidence at registration: observed by the external audit, uncommitted.** On a mainnet fork a half
headroom partial sent through `redeem()` reverted with `TroveManager: Unable to redeem any amount`
after a price change of +$0.01, +$2 and -$2 between the send and the mine, and succeeded unchanged.
Over 120 consecutive live mainnet blocks the audit counted 46 flat, 33 up and 41 down, about 44% of
one block windows inside the band its example tolerated. `scripts/oracle-moves.ts` is committed in
this wave as the instrument for the price side.

**Why MK-049's retry is not a mitigation.** Each attempt faces a fresh block move, and a failed
attempt spends gas. At the measured rate most attempts revert.

### The cancel condition, established from the contract, then measured

A partial on a Trove survives exactly when, at the execution price `P'`,
`newNICR(P') <= hint <= upperBoundNICR(P')`, with `newNICR = floor(newColl * 1e20 / newPrincipal)`,
`newColl = coll - lot * 1e18 / P'` (`TroveManager.sol:1224-1230`), `newPrincipal` the principal less
the part of the lot above the interest owed, and the upper bound the same NICR against
`newPrincipal - calculateInterestOwed(principal, globalRate, 600 seconds)` (`:1276-1285`). Solving for
`P'` gives the band of prices a given hint survives. The band's width in NICR terms is
`rate * 600 / year`, about 1.9e-7 at 1%, and a price move `x` moves `newNICR` by about
`x * collateralLot / newColl`. So the tolerated move is roughly `(newColl / collateralLot) * 0.95e-7`
each way with the hint at the centre: a partial drawing one part in ten thousand of a Trove's
collateral tolerates about 0.1%, and one drawing a meaningful share tolerates nothing an ordinary
block does not exceed.

**Sizing a partial to survive is therefore not practical, and the SDK does not pretend to.** It sends
the centre of the band, which doubles the rise tolerance from zero, reports the tolerance each way,
and refuses by default the one case where a cancel costs the whole call.

**Measured on Mezo mainnet** (`scripts/oracle-moves.ts`, 2000 consecutive blocks): the absolute one
block move was p50 0.08 bps, p99 2.26, max 8.02; two blocks p99 3.76, 4.13 up and 3.87 down.
`REDEMPTION_PRICE_MOVE_TOLERANCE` is 5 bps, the two block 99th percentile rounded up.

**Measured on a fork** (`redeem-boundary.fork.test.ts`): a 4.23 MUSD partial on a Trove with 1808
MUSD of net debt reported `priceToleranceUp` 50443821429528 and `priceToleranceDown` 50438723659688
(1e18 fractions, 0.504 bps), and with the price moved by the harness between the hint and the send:

```
  MK-103 no move                          hint=centre -> success
  MK-103 rise of half the up tolerance    hint=centre -> success
  MK-103 rise of half the up tolerance    hint=helper -> reverted
  MK-103 rise of twice the up tolerance   hint=centre -> reverted
  MK-103 fall of half the down tolerance  hint=centre -> success
  MK-103 fall of twice the down tolerance hint=centre -> reverted
  MK-103 redeem(partial) priceFragile=true -> RedemptionPriceFragile; with acceptPriceFragilePartial -> success
```

So the reported band is the contract's band from both sides, the helper's hint had no rise tolerance
at all, and this partial, 0.23% of the Trove's debt, is fragile against the one block p99.

**Fixed.** `PartialRedemption` on `RedemptionPreview.partial` and `RedeemResult.partial`: the Trove, the
lot, `revertsCallIfCancelled`, the centred `hintNicr`, both tolerances and `priceFragile`.
`partialRedemptionBand` is exported. `redeem()` sends the centred hint and throws
`RedemptionPriceFragile` before gas for a fragile partial on the first Trove, unless
`acceptPriceFragilePartial: true`. A fragile partial on a LATER Trove is sent, because its cancel only
redeems less (`:392`). Unit pins in `mk103-redemption.test.ts` restate the contract's cancel branch
independently; mutation ids `MK-103 hint` and `MK-103 refusal`, and `MK-103 fork` under `--all`.

---

## MK-104 · `redeem()` refuses the `nextViableAmount` its own preview reported a block earlier

**Class** S2 · **Status** fixed (P21)

**Ground truth.** Consuming the first eligible Trove whole needs only
`amount >= _getTotalDebt(_borrower) - MUSD_GAS_COMPENSATION` at execution
(`TroveManager.sol:1218-1221`, `:1252`), where the debt is read after `_updateTroveInterest` (`:366`).

**SDK location.** `evaluateRedeem` requires `remaining >= trove.netDebt + marginFor(trove)` for a
whole consumption (`packages/core/src/math/previewRedeem.ts:293`), with a 900 second margin
(`:234`). `previewRedeem` reports `nextViableAmount = netDebt + margin`. `redeem()` re-runs the same
preview before sending (`packages/core/src/redemption/redeem.ts:172`), one block or more later, against
a net debt that has grown, and adds the full margin again. The advertised figure is therefore short
by the accrual since it was read, and `redeem()` throws `RedemptionBreachesDebtFloor` for an amount
the chain accepts.

**Evidence at registration: observed by the external audit, uncommitted.** Reading the figure and
calling `redeem()` at the same instant succeeded; after 4, 60 and 300 seconds `redeem()` threw while
`simulateContract` of the same amount succeeded. The docstring promises about ten minutes.

**Fixed.** Two margins, named for what each is for. `REDEMPTION_ADVICE_MARGIN_SECONDS = 900n` is what
`nextViableAmount` carries from the block it was read at. `REDEMPTION_SEND_MARGIN_SECONDS = 60n` is what
`redeem()` re-checks with, covering only the settlement block after its own read. The advice is good
while `900 - elapsed >= 60`, so for 840 seconds, which clears the 600 it advertises.

**Measured through `redeem()`, not only at the contract** (`redeem-boundary.fork.test.ts`):

```
  MK-104 warp     1s  redeem(nextViableAmount) -> success targetStatus=4
  MK-104 warp    60s  redeem(nextViableAmount) -> success targetStatus=4
  MK-104 warp   600s  redeem(nextViableAmount) -> success targetStatus=4
  MK-104 warp  3600s  redeem(nextViableAmount) -> threw(RedemptionBreachesDebtFloor)
```

Status 4 is `closedByRedemption`: the first Trove consumed whole, as the advice intends. After an hour
the client refuses before gas rather than sending a revert. Mutation ids `MK-104` and `MK-104 fork`.

---

## MK-105 · Protocol reverts outside the simulate path arrive untyped

**Class** S2 · **Status** open

**Ground truth.** `PriceFeed.fetchPrice` reverts with `PriceFeed: Oracle is stale.` when the round is
older than 60 seconds (`PriceFeed.sol:14`, `:51-54`). Every preview, read and write reads the price.

**SDK location.** `simulateAndSend` maps what it catches through `mapRevert`
(`packages/core/src/internal/write.ts:196-208` and its `catch`), but the reads that run before it do
not: `effectiveBorrowingFee` (`packages/core/src/trove/index.ts:87`) and `currentPosition` (`:65`)
among them, and every preview and read function. `previewOpen` is documented as "Non-throwing: it
returns a verdict and numbers, never an error" (`packages/core/src/math/previewOpen.ts:101`); the
core README says every protocol revert maps to a `MusdError` (`packages/core/README.md:80`); the React
write hooks type `error` as `MusdError | null`.

**Evidence at registration: observed by the external audit, uncommitted.** With a stale oracle shim,
`previewOpen`, `openTrove` and `getTrove` each threw a viem `ContractFunctionExecutionError` that is
not `instanceof MusdError` and has no `code`.

**Fixed.** `withTypedErrors` (`packages/core/src/errors/mapRevert.ts`) wraps every `MusdClient` method
and every exported preview, hint and calculator. `mapRevert` recognises `Oracle is stale` as
`OracleStale`, passes an already typed `MusdError` through unchanged instead of burying it, and says
"reverted" only when a revert was found in the cause; a transport failure reads "failed". `previewOpen`
no longer claims never to throw: a refusal is a verdict, a failed read throws typed.

**Measured against the real revert**, not a fake client. The harness oracle reports the block clock as
`updatedAt`, so the revert was unreachable on the fork; `StaleOracleShim.sol`, committed with its
bytecode, keeps `updatedAt` in storage. With it installed and the clock warped 120 seconds
(`zz-typed-errors.fork.test.ts`):

```
  getOraclePrice     OracleStale code=ORACLE_STALE
  getSystemState     OracleStale code=ORACLE_STALE
  getTrove           OracleStale code=ORACLE_STALE
  isLiquidatable     OracleStale code=ORACLE_STALE
  getBorrowingPower  OracleStale code=ORACLE_STALE
  previewOpen        OracleStale code=ORACLE_STALE
  previewBorrow      OracleStale code=ORACLE_STALE
  previewRedeem      OracleStale code=ORACLE_STALE
  openTrove          OracleStale code=ORACLE_STALE
  borrow             OracleStale code=ORACLE_STALE
  repay              OracleStale code=ORACLE_STALE
  redeem             OracleStale code=ORACLE_STALE
  liquidate          OracleStale code=ORACLE_STALE
```

each with the original error in `cause`. Chain free pins in `typed-errors.test.ts`. Mutation ids
`MK-105 wrapper`, `MK-105 oracle`, and `MK-105 fork` under `--all`.

---

## MK-106 · An omitted `account` silently means "not fee exempt", and the React hooks never supply one

**Class** S2 · **Status** open

**Ground truth.** The borrowing fee is skipped for an exempt account
(`BorrowerOperations.sol:637-643`), and the floor is checked against the draw plus whatever fee is
charged (`:645`). The exempt set on mainnet is not empty (Q2).

**SDK location.** `previewOpen` and `getBorrowingPower` take an optional `account` and assume not
exempt without it, which is documented. `useBorrowingPower` forwards `account` only when the caller
passes one (`packages/react/src/hooks/reads.ts`), though the hook runs inside a wagmi context that
knows the connected address. The landing snippet omitted it until 0.3.1.

**Consequence.** For an exempt caller the open preview can say `viable` for a draw the floor refuses,
and the calculator understates the maximum. Loud, and confined to the exempt cohort.

**Fixed where a default exists to take.** `useBorrowingPower` and `useBorrowingPowerDetail` use
`account ?? useAccount().address`, and the account is in the query key, so a wallet switch asks again.
The core functions keep the documented "assume not exempt" for an omitted account: a core call has no
connected wallet to default to, and inventing one would be the silent guess this finding is about.
Rendered pins: the connected wallet is sent, an explicit account wins, no wallet leaves the field
absent rather than `undefined`, and a switch refetches. Mutation id `MK-106`.

---

## MK-107 · `previewRedeem` charges `maxIterations` for Troves the contract skips for free

**Class** S2 · **Status** open

**Ground truth.** When the first redemption hint is not valid, `redeemCollateral` walks up from the
last Trove past every Trove below MCR BEFORE its loop, without touching `_maxIterations`
(`TroveManager.sol:338-350`). `_maxIterations` is decremented only inside the loop (`:360-365`).
`HintHelpers.getRedemptionHints` does the same (`HintHelpers.sol:98-103` before `:113-118`).

**SDK location.** The walk in `previewRedeem` counts every Trove it visits, including the sub-MCR
ones at the bottom (`packages/core/src/math/previewRedeem.ts:367`).

**Evidence at registration: observed by the external audit on live testnet, read only, uncommitted.**
With three sub-MCR Troves at the bottom, `maxIterations` of 1 to 4 made `previewRedeem` report
`NOTHING_REDEEMABLE` while `simulateContract` of the same redemption succeeded. `redeem()` itself
still sends in that case; a UI gated on the preview blocks a valid redemption.

**Fixed.** The walk starts counting iterations at the first Trove at or above MCR, which is where the
contract's loop begins, and walks past the sub-MCR Troves below it for free, as `:338-350` does. Pinned
chain free in `mk103-redemption.test.ts` with three sub-MCR Troves under `maxIterations` of 1. Mutation
id `MK-107`. Not re-measured on live testnet in this wave.

---

## MK-108 · The quickstart npm renders does not compile, and gates the open on the wrong field

**Class** S2 · **Status** open

**SDK location.** `packages/core/README.md:52-78`, which ships in the tarball and is what npm renders.
It uses `account.address` (`:63`) and `borrower` (`:77`), neither declared, and `parseBtc` and
`parseMusd`, never imported. It opens when `preview.meetsMinimum` (`:68`), which is only the debt
floor; `viable` is the verdict that covers the ratio and system gates (`previewOpen.ts:45-58`).

**Evidence at registration: observed by the external audit** by pasting the block into a TypeScript
file against the published package. A reader who fixes the compile errors and keeps the gate sends
opens the ratio gates refuse.

**Fixed.** The quickstart declares every name it uses, imports `parseBtc` and `parseMusd`, and opens
only when `preview.viable`. **And it is compiled where npm reads it:** `pnpm gate:packaging` extracts
the `## Quickstart` block from `package/README.md` inside the packed core tarball and typechecks it
under both ESM rows; the CommonJS rows say they do not, because the block uses top level `await`. The
gate refuses to run if the block is missing. Mutation id `MK-108 gate` under `--all`, which removes the
unit helper imports from the README and requires the gate to fail.

---

## MK-109 · Documentation and the shipped surface disagree

**Class** S3 · **Status** open

Each item re-read in this wave:

- `docs/03-core-api.md:744` shows `await musd.getPeg()`. It does not exist, and
  `packages/core/src/read/system.ts:133` says it is intentionally not implemented.
- `packages/core/README.md:106-108` says "Ten of eleven exposed writes have a preview ... and each
  prechecks the same conditions before sending". `MusdClient` exposes twelve writes and nine
  previews; `openTrove` prechecks only the fee cap, the floor and an existing Trove, and `refinance`
  prechecks nothing (`packages/core/src/trove/index.ts`). MK-061 corrected the root README; the
  packaged one kept the claim.
- `packages/react/README.md:85-89` lists the hooks from 0.1.0 and omits six that ship. `:46` says the
  package re-exports `@musd-kit/core`; it re-exports only some error classes and types, missing
  `SystemRatioBelowCCR`, `CollateralWithdrawalBlocked`, `ExceedsBorrowingCapacity`,
  `RedemptionBreachesDebtFloor`, `DeploymentVerificationFailed` and `InvalidAddressOverride`, which its
  hooks can surface. Its usage example calls `parseBtc` and `parseMusd` without importing them.
- `packages/react/src/hooks/writes.ts:35` and `:200` describe a `fee` field on `RedeemResult` that
  MK-014 removed.
- `packages/core/src/math/compute.ts:120` says pending redistribution collateral is not folded into
  `collateral`; `getEntireDebtAndColl` folds it in (`TroveManager.sol:799`).
- `docs/03-core-api.md:676` says close has four gates; MK-074 made it five.
- `docs/09-review-and-validated-surface.md:203` says the React package is not measured by the coverage
  gate at all; `vitest.config.mts:82` has included it since MK-087.
- `examples/open-and-manage/README.md:18` says the open is guarded on `meetsMinimum`; the code has
  guarded on `viable` since MK-005.

**Fixed, item by item.** `getPeg` removed from `docs/03` §6 with the reason it does not exist. The
packaged core README now counts twelve writes and nine previews and says which writes precheck what.
The React README lists all fifteen read hooks and ten writes, imports what its example uses, and says
exactly what it re-exports: every `MusdError` class (all 29 checked against `errors/index.ts`),
`TroveStatus`, and the types the hooks take and return, the preview result types added in this wave.
The write hook docs name `RedeemResult`'s real fields. `TroveAmounts` says pending redistribution is
folded in (`TroveManager.sol:797-801`). `docs/03` says close has five gates. `docs/09`'s React row says
it is measured and has its own floor. The example README says the open is guarded on `viable`.

**Found while fixing it, and folded in rather than filed apart:** `computeLiquidationPrice` floors
`MCR * entireDebt / collateral` (`packages/core/src/math/compute.ts`), and its docstring said the
position becomes liquidatable BELOW that price. When the division is inexact the Trove is already
liquidatable AT it, and accrual raises the true threshold every second after the read. The value is
unchanged, since it is at most one wei under the threshold; the docstring now says both things.
`docs/09`'s claim that a moving oracle cannot be expressed on a fork at all was also wrong: the
harness writes the oracle, and MK-103's proof does exactly that.

---

## MK-110 · Three pins checked nothing while green, and the mutation gate only checks what it is pointed at

**Class** S2, a control weaker than advertised · **Status** fixed for the three; the gate's scope is
unchanged and stated below · **Found by `node scripts/mutation-check.mjs` during the P21 wave, before
the pull request, not by a reviewer**

**The claim it undercut.** The P21 wave's first mutation run printed `2 mutation(s) were caught by
NOTHING`, while the wave was about to report that every pin for MK-100 to MK-108 fails with its fix
removed. None of the three states below reached `main`: all were repaired in `8f2258e`, the commit
that introduced them. The failing run's log was a local file and is not preserved; each state is
reproduced below against the current tree instead, with the command.

### The three, and how each stopped checking

**1. The MK-089 mutation drifted onto a line it was not written for.** Its entry replaces the first
occurrence of `    principal: trove.principal,` (`scripts/mutation-check.mjs`, id `MK-089 base`). On
`main` that string occurs once, in `marginFor` (`git show origin/main:packages/core/src/math/previewRedeem.ts`,
line 249). P21 rewrote `marginFor` onto one line (`previewRedeem.ts:343`) and added
`partialRedemptionBand`, whose band base is written exactly that way (`:375`). So the string still
matched, exactly once, and the script's stale entry guard, which checks only that the string is
present, passed; but the mutation now altered the partial band, not the margin. The margin's own pins
in `preview-redeem.test.ts` were intact and caught nothing only because nothing touched the margin.
Reproduce the match: `grep -c '^    principal: trove.principal,$' packages/core/src/math/previewRedeem.ts`
prints `1`, and the line it finds is inside `partialRedemptionBand`. **A uniqueness guard would not
have caught this**, since the match was unique.

**2. The first MK-107 test could not see the defect it is named for.** `three sub-MCR Troves at the
tail, then an eligible one, with maxIterations 1` (`packages/core/test/mk103-redemption.test.ts`) stops
at the first eligible Trove, whose net debt covers the amount. The walk's loop condition,
`!started || i < maxIterations` (`previewRedeem.ts`), already walks the sub-MCR tail for free, so
charging those Troves (`if (started) i++` mutated to `i++`) changes nothing until a SECOND eligible
Trove is needed. The test was green with the fix and green without it. Reproduce: apply that mutation
and run `pnpm exec vitest run --project unit packages/core/test/mk103-redemption.test.ts -t "three
sub-MCR Troves at the tail"`, which prints `1 passed`.

**3. The partial band's base had no fixture that could tell principal from entire debt.**
`TroveManager.sol:1278-1283` accrues the 600 second band on `trove.principal`. Every `EligibleTrove`
fixture had `interestOwed: 0n`, so principal and entire debt were equal and a band sized on the wrong
one produced the same numbers. Reproduce: mutate `partialRedemptionBand`'s `principal: trove.principal`
to `trove.entireDebt` and run every unit test except the one added for it,
`pnpm exec vitest run --project unit -t "^(?!.*PRE-redemption PRINCIPAL)"`, which prints
`423 passed | 1 skipped`.

**The repairs, each now caught** (`node scripts/mutation-check.mjs`): the MK-089 entry names the
margin's own line; a second MK-107 case needs two eligible Troves under `maxIterations: 2`; a band
test uses `interestOwed: 3_000n * MUSD`, with its own mutation, `MK-103 band base`.

### What would have caught them earlier

- **The drift (1)**: running the unit mutation gate on the commit that edited `previewRedeem.ts`. The
  gate did fail the first time it ran; the gap was that nothing runs it. No workflow invokes
  `scripts/mutation-check.mjs` (`grep -n mutation .github/workflows/*.yml` finds nothing), and the
  standing wave checklist in `docs/08-conventions.md` §10 had no row for it, so mutation evidence was
  produced when a prompt asked for it and not otherwise.
- **The blind test (2)**: writing the mutation in the same sitting as the test and running it before
  calling the test a pin. A test is a pin only once its defect has been put back and the test has gone
  red; until then it is a test that passes.
- **The indistinguishable fixture (3)**: the rule MK-089 had already established, that interest
  accrues on the principal and not on the entire debt, applied to every computation using that
  quantity rather than to the one it was found in. It is `docs/08-conventions.md` §12's defect again,
  the same one MK-100 names: the enumeration was scoped to the field, not to the rule.

### Does the gate now run over every pin, or only the ones it was pointed at

**Only the ones it was pointed at, and this can recur.** `scripts/mutation-check.mjs` applies the 47
mutations listed in its `MUTATIONS` array (`:35`). Each one is judged against the whole unit project,
or against named fork files and the packaging gate under `--all`, so a mutation is caught by any test
that notices it. But a test with no mutation entry is never put to the question, and a computation
with no mutation entry is never mutated: the repository has about 437 `it(` call sites
(`git grep -n "it(\|it.fails(" -- 'packages/*/test/*.ts' 'packages/*/test/**/*.ts' | wc -l`, a
static count that undercounts looped cases) against 47 mutations. The band base in (3) was found only
because the drifted entry in (1) happened to land on it.

**What changed in this commit, and what did not.** `docs/08-conventions.md` §10 gains row 13: every
pin a wave adds names its mutation in the script, and the wave reports the gate's output, `--all`
when a fork or gate pin changed. That closes the absence that let (1) and (2) sit unrun. It does not
make the gate exhaustive, and it does not put it in CI; a mutation per changed line would be a
different instrument, and CI time for the unit gate was not measured in this wave. **So a new
computation added without a mutation entry is exactly as unchecked as (3) was.** That open half is
tracked as MK-112.

---

## MK-111 · A release record lived on an unmerged pull request, and two releases went out without it

**Class** S3, process · **Status** fixed · **Found by** the P22 instruction that the ledger held a run
for 0.2.0 only, then traced here

**What happened, verified rather than recalled.** 0.3.0 was published on 2026-09-13 from `749730b`
(release run 34752401058, `workflow_dispatch`, success). Its record, written the same day in
`376b9f3`, is on `origin/docs/p18-release-0.3.0` and pull request 36, which `gh pr list --state all`
shows as still `OPEN`. That commit added the `The 0.3.0 release, as it actually ran` section to
`docs/12`, the 0.3.0 live run to `docs/13` (`GO`, 19 exercised, 4 skipped), the 0.3.0 fitness verdict
to `docs/09`, and three register entries, MK-097, MK-098 and MK-099. None of it reached `main`.
0.3.1 was then published from `5b731b2` (run 34761476541), and the P21 wave numbered its findings from
MK-100 on a `main` whose register ended at MK-096.

**What it cost.** For as long as it lasted, `main`'s ledger said the only live run was for 0.2.0, its
register had a gap of three IDs with no entries, and the runbook lacked MK-097's own lesson, the lint
and typecheck row for the version commit, which is exactly the omission that turned `main` red for
0.3.0. The P21 report repeated the ledger's gap as "0.3.0 and 0.3.1 have none on record", which was
true of `main` and false of the repository.

**Why nothing caught it.** Precondition 2 reads the register on whatever tree is being released, and
nothing asked whether the previous release's record had landed. A record pull request is the last
step of a release, so its absence is visible only at the start of the next one, where nothing looked.

**Fixed.** `376b9f3`'s content is carried onto this branch in a new commit, with its claims re-checked
first: the run IDs it cites resolve to the workflows, commits and conclusions it states; the
registry stores both 0.2.0 deprecation messages; and the 0.3.0 run's account holds the recorded
closing balance with its Trove closed. One sentence was not carried as written: `docs/09`'s "every S1
in the register is closed", false since 0.3.1 shipped with MK-100 open. And one correction `main` had
also been missing is carried in with it: MK-086 withdrew `docs/09`'s claim that the sweep's ten
FALSE_BLOCKED "implicate no `packages/*/src` file", and `main` still printed the withdrawn clause. `docs/13` gains a 0.3.1 section that says
no live run was made and why. The runbook gains precondition 8, the previous release's record on
`main`, and states the ledger is kept per release rather than per script change. The original commit
is left where it is: history is not rewritten, and pull request 36 is closed as superseded, pointing
here.

**Precondition 8 then failed on its first use, as written, and that was the rule working.** At the
0.4.0 version commit `26ff61b` its pass condition demanded a record for every version on npm, and
`docs/12` had no `as it actually ran` section for 0.3.1, the previous release, while neither file had
one for 0.1.0. The release stopped there rather than waiving it. The 0.3.1 section was then written
from evidence read back from GitHub, the registry and git, and the row was reworded to what that
evidence supports: the previous release, and every release since both files were created on
2026-08-27. **0.1.0 has no record and none is back filled**: it was published on 2026-06-22, before
the ledger and the runbook existed, and although `scripts/testnet-e2e.ts` existed from 2026-06-16, no
output from a run against 0.1.0 is committed, so whether one happened is unknown. The runbook names it
as the only version exempt, and the list is closed.

---

## MK-112 · The mutation gate checks only its listed entries, and nothing runs it

**Class** S2, process, a control weaker than it reads · **Status** fixed in the P25 wave · **Established
in** MK-110

**What was established, with the evidence.**

- **It checked only the mutations it listed.** `scripts/mutation-check.mjs` applied the entries of its
  `MUTATIONS` array, 52 at `26ff61b`, one at a time. Each was judged against the whole unit project, or
  named fork files and the packaging gate under `--all`, so any test that noticed a listed mutation
  caught it. What was never asked is whether a computation with no entry is pinned.
- **Nothing ran it.** `grep -n mutation .github/workflows/*.yml` matched nothing, so the gate ran when a
  person ran it.

**A correction to how this entry measured the gap.** It set 52 entries against 440 `it(` call sites.
That is the wrong measure: a test is not a thing that needs a mutation, and an entry does not cover a
test. **The honest measure is decision sites against the sites a mutation reaches**, where a decision
site is a place whose change a caller can observe (the rule is written at the top of
`scripts/mutation/sites.mjs`). Measured that way at `c345c07`, the 52 entries mutated **54 of 469**
decision sites; at `870b76f`, 57 entries mutated **58 of 474**. The brief for the wave carried this
entry's figures, 52 listed mutations against roughly 440 test call sites, and they were wrong the same
way; and the 52 was every entry, the six fork and packaging gate entries among them. And an
earlier report of this wave said 58 entries at `c345c07` where there were 52.

**Fixed.**

- **Every decision site now has a mutant and a reviewed status.** `scripts/mutation/sites.mjs` finds
  the sites in both packages; `scripts/mutation/sites.json` records each one as `caught`, `caught-fork`,
  or not caught and registered under a finding as `uncaught`, `equivalent` or `unreachable`.
  `--check` fails on a site the register does not know, a register row the code no longer has, and a
  survivor with no registered finding.
- **The first full run, at `870b76f`**: 474 sites, 319 caught by the unit project, 36 by the fork project
  only, **119 caught by nothing**, registered as MK-118 with three entries of their own, MK-119 to MK-121: 85 test gaps, 29 equivalent
  mutants, 5 unreachable. All 57 hand written entries were caught; two were caught only by tests whose
  names do not cite them (MK-116, MK-117).
- **After this wave, at the tree it merges**: 474 sites, **437 caught by the unit project, 3 by the fork project only, 29 equivalent, 5 unreachable, 0 uncaught**, and all 57 hand written entries caught, each by at least one test that cites its finding. 33 of the 36 sites only the fork project caught before are now caught by a unit test. Measured by `node scripts/mutation-check.mjs --record --all --jobs 3`, exit 0, 7759 seconds (`docs/07-testing.md` §4d); the hand written entries still mutate 58 of the 474
- **An entry cannot drift** (MK-110): it names its declaration, text that occurs exactly once inside
  it, and a fingerprint of the statement, and `packages/core/test/mutation-anchor.test.ts` moves a
  target each way and shows the refusal.
- **CI runs it.** `.github/workflows/mutation.yml`: `--check` and the unit mutants a change selects run on every push; the full gate, the fork pass included, runs weekly and on dispatch, and is precondition 9 of a release. Placement, cost and what a
  green gate proves are in `docs/07-testing.md` §4d.

**What stays open.** The five unreachable sites are left in the source and stated (MK-118, the unreachable table,
and MK-120 and MK-121). The rule generates one mutant per site, so a site whose mutant is caught can
still hide a different defect beside it; `docs/07-testing.md` §4d says what a green gate does not prove.

---

## MK-113 · The live run's close check was MK-046's defect, in the one place MK-046's fix did not reach

**Class** S3, a defect in a release instrument, not in either package · **Status** fixed · **Found by**
the first 0.4.0 live run, at `f36dc99`, which exited 1

**What happened.** `scripts/testnet-e2e.ts` reads `previewClose(owner)`, then `getTrove(owner)`, and
required `closePreview.musdRequired === beforeClose.entireDebt - 200 MUSD` with `assertEq`. The run
died there after a successful redemption:

```
  requires 1877.300435679083402139 MUSD, shortfall 0, canMint true

✗ previewClose.musdRequired: chain says 1877300435679083402139, the preview said 1877300438312164573762
```

The labels are the wrong way round for this call: `assertEq` names its first argument the chain and
its second the preview, and the call passed the preview first. So the preview was the lower figure,
by 2,633,081,171 wei.

**Established from the chain, not inferred.** `getEntireDebtAndColl` for the run's account, read at
each block (`cast call ... --block`): principal `2077300403625422453695` throughout; interest
`32053660948444` at block 15523288 and `34686742120067` at 15523289, four seconds later. Principal
plus interest, less the 200 MUSD reserve, is `1877300435679083402139` at 15523288 and
`1877300438312164573762` at 15523289: the two printed figures, exactly. **So each read matched the
chain at its own block to the wei**, the two reads landed one block apart, and the difference is that
block's interest. The SDK was right; the check compared two moments.

**Why it had passed before.** On the 0.3.0 and 26ff61b runs both reads happened to land in one block.
An equality between two reads of a quantity that grows with time is true only when no block passes
between them, which a live chain does not promise.

**Why nothing caught it.** MK-046 found exactly this for `entireDebt after open` and introduced
`assertDebtEq` (`scripts/testnet-e2e.ts`), which accepts a drift that is positive and at most
`MAX_DRIFT_SECONDS` of interest. It was applied to the three debt checks MK-046's wave touched and not
to the close check, which compares the same kind of quantity. That is `docs/08-conventions.md` §12's
defect again: the fix was scoped to the call sites it was found at, not to the rule.

**Fixed.** The close check uses `assertDebtEq` with the Trove's own rate, the later read as the actual
and the preview as the expected. The two remaining `assertEq` calls compare collateral, which does
not accrue with time. **What the failed run left behind:** the account's Trove open, status `1`, on
testnet; the script closes a pre-existing Trove first when it can, which is what the next run does.
Since the script changed, the release commit changed with it, and the sweep dispatched against
`f36dc99` (run 34811442500) was cancelled rather than left to measure a tree that would not ship.

---

## MK-114 · `maxIterations: 0n` means no limit to the contract and one eligible Trove to the preview

**Class** S1, a silently wrong number · **Status** fixed in 0.4.1 · **Found by** the P23 mutation wave, while
classifying a mutant of the walk bound that no unit test caught: `i < maxIterations` changed to
`i <= maxIterations` at `packages/core/src/math/previewRedeem.ts:552`

**What the deployed contract does with zero, established on chain rather than from source.**
`HintHelpers.getRedemptionHints` at the bundled testnet address, read at the pinned fork block
15043414 with the price `fetchPrice()` returns there, `77051107320000000000000`:

```sh
cast call 0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6 \
  "getRedemptionHints(uint256,uint256,uint256)(address,uint256,uint256)" \
  400000000000000000000000 77051107320000000000000 <maxIterations> \
  --rpc-url https://rpc.test.mezo.org --block 15043414
```

| `maxIterations` | `partialRedemptionHintNICR` | `truncatedAmount` |
|---|---|---|
| 0 | 1957108775441742 | 400000000000000000000000, the whole request |
| 100 | 0 | 298067201277553214220198 |
| 229, 230, 231 | 1957108775441742 | 400000000000000000000000 |

The same call for a request of `1e26` MUSD returned `truncatedAmount` `1e26` at 0, and 1808.458,
3615.138, 5421.815 and 298067.201 MUSD at 1, 2, 3 and 100. `getSize()` on `SortedTroves` is 230 and
`getEntireSystemDebt()` is 428254028132726879581940337 at that block. **So zero behaves as no limit
and not as zero iterations**: it reaches what 229 reaches, where 100 stops short. The source says
the same (`HintHelpers.sol:107-109`, and `TroveManager.sol:353-355` for `redeemCollateral`, both
replacing zero with `type(uint256).max`), but the calls above are the evidence, since they are
answered by the deployed code.

**What the SDK does with zero.** `previewRedeem` takes `params.maxIterations ?? 100n`
(`previewRedeem.ts:516`), so `0n` passes through, and walks while `!started || i < maxIterations`
(`:552`) with `i` incremented once the first eligible Trove is found (`:573-574`). At zero the walk takes
the first eligible Trove and stops. Reproduced chain free with three eligible Troves of 30,030 MUSD
net debt each and a request of 40,000 MUSD: `maxIterations` `0n` and `1n` report `redeemable`
30,030 MUSD after one `getCurrentICR` read; `2n` and `100n` report 40,000 MUSD.

**What that costs.**

- `previewRedeem({ maxIterations: 0n })` reports `redeemable` short of what the chain redeems,
  whenever the request needs more than one eligible Trove. No error is raised.
- `redeem({ maxIterations: 0n })` sends zero to both `getRedemptionHints` (`redeem.ts:233`) and
  `redeemCollateral` (`redeem.ts:249`), so the transaction itself walks without limit. Its prechecks
  come from the preview, which saw one Trove: a partial on a later Trove gets no band, so the call
  falls back to the helper's lower edge hint that MK-103 replaced, and the result reports
  `partial: null` for a call that redeemed partially.

**Which versions.** 0.1.0 has no `previewRedeem` (its tarball's `dist/index.js` has no occurrence).
0.2.0 to 0.3.1 walk `i < maxIterations && cursor !== ZERO` from `i = 0n` (read at each tag), so at
zero they visit nothing and report `NOTHING_REDEEMABLE`. 0.4.0 has the one Trove walk above, since
MK-107 moved the increment. None of these was executed against the older tags.

**Why nothing caught it.** Nothing in the SDK validates the value, no document says what zero means,
and no test passes zero. The walk's docstring says it is bounded "matching the contract's own
parameter" (`previewRedeem.ts:496`), which is true for every value except the one the contract gives
a meaning of its own.

**Pinned before the fix.** `packages/core/test/mk114-max-iterations.test.ts` states the contract's
reading as `it.fails`, so the suite stays green while the defect is present and turns red the
moment the preview reads zero the way the chain does:
`pnpm exec vitest run --project unit packages/core/test/mk114-max-iterations.test.ts`.

### The whole path, point by point

| Point | Found | Now |
|---|---|---|
| The preview's default | `params.maxIterations ?? 100n`, a literal (`previewRedeem.ts:516` before this fix), while `redeem()` used the exported `DEFAULT_REDEMPTION_MAX_ITERATIONS` (`redeem.ts:29`, `:149`). Equal, and two copies of one default | one constant, defined beside the preview and re-exported from `redemption/redeem.ts`, where the public export has always come from |
| The walk bound | `(!started || i < maxIterations)`, so zero stopped after the first eligible Trove | `(!started || unbounded || i < maxIterations)` with `unbounded = maxIterations === 0n` |
| What the client sends | `redeem.ts:233` and `:249` pass the value unchanged to `getRedemptionHints` and `redeemCollateral`; `MusdClient.redeem` and `previewRedeem` forward the caller's object (`createMusdClient.ts:454-455`, `:479`) | unchanged: zero reaches the chain as zero, which is right |
| Validation | none: `git grep maxIterations -- packages/core/src/client packages/react/src` finds nothing, and a negative value reached the walk | `assertMaxIterations` refuses a negative value or one above the largest `uint256` with `InvalidAmount`, in the preview and in `redeem()`, before any read |
| The documentation | neither docstring said what zero means (`PreviewRedeemParams`, "Cap on the list walk, matching the contract's own parameter"; `RedeemParams`, "Cap the number of Troves scanned/redeemed"), and no page did (`git grep -n maxIterations -- docs`) | both docstrings, `docs/03-core-api.md` under `maxIterations`, and `docs/15-migration-0.3-to-0.4.md` §7 |
| React | `usePreviewRedeem` passes `{ redeemer, amount }` only (`packages/react/src/hooks/reads.ts:359`), so it always walks the default; `useRedeem` passes the caller's `RedeemParams` to `redeem()` | unchanged, and stated in the changeset: the hook cannot be given zero, so it was never affected |

### Zero is accepted, not refused, and why

Refusing zero would protect a caller who typed `0n` meaning "none", at the price of refusing the
contract's own meaning of a value the SDK forwards to it unchanged. It is accepted because typing
`0n` is deliberate (omitting the field is how a caller gets the default), and because what it asks
for is bounded by the request rather than by the list: the walk stops as soon as the Troves it has
read cover `amount` (`previewRedeem.ts`, the `total >= amount` break), so no limit costs the reads the
request needs. A request larger than everything redeemable walks the whole list, on chain and in the
preview alike. Both docstrings and `docs/03-core-api.md` say so.

### The class: every sentinel the SDK forwards to a contract

The defect was a value that means one thing to the contract and another to the SDK's restatement of
it. Every argument the SDK passes to a contract was listed (`git grep -n "args: \[\|simulateAndSend(" --
packages/core/src`), and every parameter check against zero, the maximum or the empty address was
read in the contracts it reaches (`grep -n "_[a-zA-Z]* == 0\b\|== address(0)\|type(uint256).max"` over
`TroveManager.sol`, `BorrowerOperations.sol`, `HintHelpers.sol`, `SortedTroves.sol`):

| Parameter | What the contract does with the sentinel | What the SDK does | Verdict |
|---|---|---|---|
| `_maxIterations` of `redeemCollateral`, `getRedemptionHints` | zero is no limit (`TroveManager.sol:353-355`, `HintHelpers.sol:107-109`) | restated in the preview walk | **this finding**, fixed |
| `_numTrials` of `getApproxHint` | no sentinel: the loop starts at 1 (`HintHelpers.sol:206-209`), so 0 and 1 both mean the tail alone | forwards the caller's `numTrials` (`computeHints.ts:98`) and computes nothing from it | agree |
| `_inputRandomSeed` of `getApproxHint` | no sentinel, zero is a seed like any other (`:204-212`) | forwards | agree |
| `_prevId`, `_nextId` of `findInsertPosition` and every write's hints | the empty address means "start from that end" (`SortedTroves.sol:461-477`) | never taken from a caller: computed by `hintsFor` from the helper | nothing to disagree about |
| `_firstRedemptionHint` of `redeemCollateral` | the empty address is not a valid hint (`TroveManager.sol:1457-1462`), and the call starts from the tail instead (`:330-350`) | the helper's own answer, forwarded | agree |
| `_collWithdrawal` and `msg.value` of `adjustTrove` | zero on either side is "no change on that side"; both non zero is refused (`BorrowerOperations.sol:1366-1374`) | refuses a present `withdrawCollateral` beside a present `addCollateral` even when one is `0n` (`trove/index.ts:549-551`) | **stricter, in the refusing direction**, already recorded by MK-077 as a deliberate choice; loud, before gas, and no number is wrong |
| `_debtAmount`, `_amount`, `_collWithdrawal` of the single leg writes | zero is refused on chain (`_requireNonZeroDebtChange` `:1351-1356`, `_requireNonZeroAdjustment`) | refused earlier with `InvalidAmount` (`assertPositiveAmount`) | agree, same direction |
| `_troveArray` of `batchLiquidateTroves`, `_borrower` of `liquidate` | an empty array and an inactive borrower revert (`TroveManager.sol:657-660`, `:1554-1559`) | forwarded; the revert is mapped | agree, loud |

**Only `_maxIterations` is a sentinel the SDK restates**, so this is the one place the two could say
different things about the same value, and they did.

### Pinned both ways

- **Chain free**, `mk114-max-iterations.test.ts`: zero reaches the second Trove and stops there; one
  stops at one, which is the mutant that surfaced this; zero with a request larger than the list walks
  to its end and terminates; the default is the exported constant; `redeem()` at zero prechecks the
  partial on the second Trove and sends its centred hint with zero unchanged; a negative value and
  `2^256` are refused before any read, in both.
- **On chain**, `redeem-max-iterations.fork.test.ts`: from one snapshot, `redeem({ maxIterations: 0n })`
  and `redeem({ maxIterations: 1n })` are sent for a request that consumes three Troves whole and takes
  a 10 MUSD partial from a fourth. The `Redemption` event's `_actualAmount` at zero equals the
  preview's `redeemable` to the wei, 5431815369041595825047, and at one the chain redeemed
  1808458116273153173982. The first three Troves at the pinned block sit at the debt floor, so the
  fixture asks the deployed helper what k Troves consumed whole come to and takes the first k whose next
  Trove can take the partial; it found k = 3.
- **Mutation evidence**, `node scripts/mutation-check.mjs --all` on this branch: 57 of 57 caught,
  exit 0. The five added for this finding: `MK-114 zero` (the walk without the zero clause) caught by
  3 tests; `MK-114 bound` (`i <= maxIterations`, the mutant that surfaced this) caught by 2;
  `MK-114 range` and `MK-114 write range` (no range check, and `redeem()` reading before refusing) by 1
  each; `MK-114 fork` by the fork test.

---

## MK-115 · `main` went red at the 0.4.1 version commit because the pinned Foundry could not be downloaded

**Class** S3, CI infrastructure · **Status** fixed by re-running, no repository change · **Found by**
precondition 1 of the 0.4.1 release, on push run 34856420392 at `ae93edd`

**What happened, read from the run rather than inferred.** Attempt 1 of the `Fork gate + coverage`
job failed in `Install Foundry (anvil)` at 14:36:39 UTC, before any test ran:
`foundryup --install 1.7.1` reported `failed to download
https://github.com/foundry-rs/foundry/releases/download/v1.7.1/foundry_v1.7.1_linux_amd64.attestation.txt:
HTTP 504 Gateway Timeout`. The three `Checks` jobs passed. Attempt 2, re-run at 14:42:22 UTC, failed
at the same step on a different URL of the same download, `.../attestations/26850510/download: HTTP 504
Gateway Timeout`. Attempt 3, re-run at 14:44:34 UTC after both URLs were fetched locally with HTTP 200,
passed all four jobs: 48 test files passed and 1 skipped, coverage 98.67 / 94 / 100 / 98.67, `GATE
PASSED`, 563 internal links and 0 broken. The sweep dispatched against the same commit at 14:34 UTC,
run 34856435271, installed the same Foundry version without error. `githubstatus.com` reported all
systems operational when checked at 14:43 UTC.

**Nothing in the repository was implicated.** The step that failed downloads a pinned tool, and its
input is the version string MK-041 pinned, which did not change. The failure was a gateway timeout from
the host serving the download.

**Why it is registered at all.** `docs/08-conventions.md` §10 row 9 says a red `main` is repaired first
and its cause registered before the fix. The cause was known before the re-run, and the re-run is the
whole fix. **It is committed after the fact, in the release record pull request, and that is a
deviation stated rather than hidden**: a commit to `main` before the re-run would have moved the
release commit away from `ae93edd`, and with it every precondition already evidenced there.

**What a future reader should take from it.** A red `Install Foundry (anvil)` step with an HTTP 5xx from
`github.com` is not a test result. Read the step log, re-run the failed job, and record the attempts;
a re-run that passes on the same `headSha` meets precondition 1, because the condition is the commit
and its checks, not the attempt number.

---

## MK-116 · The MK-071 pin was caught only by tests whose names do not cite MK-071

**Class** S3, a pin its label does not reach · **Status** fixed · **Found by** the P23 mutation wave, reading
which tests catch each hand written entry

**What was established.** The entry `MK-071` puts the 365 day year back into `accruedInterest`
(`scripts/mutation/entries.mjs`, scope `accruedInterest`). Run against the unit project at `870b76f` it
was caught by 13 tests (`MK-071: caught by 13`), and none of their names contains `MK-071`: the two
closest are `computeEntireDebt (InterestRateMath.calculateInterestOwed) accrues simple interest over
exactly one contract year` and `... floors sub-second-scale interest exactly as the contract does`, and
the rest are named for MK-103, MK-104, MK-048, MK-088 and MK-089. The ID appears in the tests only in a
comment, `packages/core/test/preview-redeem.test.ts:57`, and a comment is not what fails.

**Why it matters though the defect is caught.** The guard exists, and nothing a run prints ties it to
the finding. A wave that renames or rewrites those tests for their own findings can remove MK-071's only
guard without any failing test naming MK-071, and nobody reading a red run can find its pin.

**Fixed.** `packages/core/test/decision-pins.test.ts` gains `MK-116, MK-071, interest accrues over the
contract year`: a full year at 10,000 bps over 31,556,952 seconds owes exactly the principal
(`InterestRateMath.sol:9`, `:12-22`). And the gate now fails any hand written entry caught only by tests
whose names cite none of its IDs (`untracedCatch` in `scripts/mutation-check.mjs`), so the state cannot
recur silently. In the after run, the only two of the 50 unit entries whose catching tests would cite none of their IDs, once the tests this wave adds are set aside by their names, are this one and MK-117's. That is derived from one run's test names, not from a run at `870b76f`

---

## MK-117 · The MK-095 pin was caught only by tests whose names do not cite MK-095

**Class** S3, a pin its label does not reach · **Status** fixed · **Found by** the same reading as MK-116

**What was established.** The entry `MK-095 window` sizes the redemption advice margin at 600 seconds
instead of 900 (`scripts/mutation/entries.mjs`, scope `''`, `REDEMPTION_ADVICE_MARGIN_SECONDS`). At
`870b76f` it was caught by 8 tests, named for MK-104, MK-048, MK-088 and MK-089, and none for MK-095.
The ID appears only in a comment, `packages/core/test/preview-redeem.test.ts:74`.

**Fixed** as MK-116 was: `MK-117, MK-095, the redemption advice margin covers more than the window it
advertises` pins the constant at 900 and the margin `evaluateRedeem` reports at 900 seconds of the
Trove's own principal at its own rate, and the traceability rule covers it from now on.

---

## MK-118 · 474 decision sites, 58 reached by a mutation before the P25 wave, none uncaught after it

**Class** S3, test coverage of decisions · **Status** fixed, with 29 equivalent mutants documented and two
unreachable sites left in the source (MK-120 and MK-121 are the other three) · **Found by** the first run of
the decision site rule, `node scripts/mutation-check.mjs --record --all` over `870b76f` (MK-112)

**The result.** `scripts/mutation/sites.mjs` finds **474 decision sites** in the two packages: places where
a change would alter something a caller can observe. Before this wave the hand written entries mutated
**58** of them, and nothing asked about the other 416. The first run of one generated mutant per site found
**119 caught by nothing**. After this wave **none is uncaught**: every one is caught, or is proven unable to
be caught, below.

| Status | At `870b76f` | After the wave | Where it is accounted for |
|---|---|---|---|
| Caught by the unit project | 319 | **437** | 118 more: the 85 test gaps below, and 33 sites the fork project alone used to catch |
| Caught by the fork project only | 36 | **3** | confirmed by two failing fork runs each |
| Caught by nothing, observable: a test gap | 85 of the 119 | **0** | fixed: the groups below, and MK-119 |
| Caught by nothing, equivalent | 29 of the 119 | **29** | the proofs below |
| Caught by nothing, unreachable | 5 of the 119 | **5** | MK-120 (2 sites), MK-121 (1), and 2 below |

**No survivor was a defect in shipped behaviour.** Each of the 85 new pins asserts the rule it pins, a
contract line where the decision restates the contract and the documented behaviour where it is the SDK's
own, and every one passed against `packages/*/src` unchanged from `870b76f`. Every site's own record, with
the tests that catch it, is in `scripts/mutation/sites.json`, which cites this finding.

**Why one finding and not 119.** This wave first registered one ID per surviving mutant. A row that says a
decision was unpinned and now is teaches a reader nothing the gate's register does not already hold, so
they were consolidated before the pull request merged. A survivor kept its own entry only where the row
is worth opening on its own: MK-119, MK-120 and MK-121. **IDs MK-122 to MK-236 were used for those rows on
the unmerged branch of pull request 42, and are retired rather than reused**: the next finding is MK-237,
so an ID a reader saw on that branch never comes to mean something else. MK-118 to MK-121 keep a meaning
close to the one they had there, which is the one place the rule against renumbering was bent, stated
here rather than hidden; no ID that reached `main` changed.

**A correction made while classifying.** Several survivors first read as equivalent because the figures
matched. They were not: a mutant that reads the chain more often, or returns a different value from a
public function, is observable. Those are among the 85 test gaps, not the 29. The standard is written at
the top of `scripts/mutation/sites.mjs`.

### The 85 test gaps, fixed, by what was unpinned

| What no test pinned | Sites | Pinned by |
|---|---|---|
| A protocol gate at exactly its boundary, in a preview. Every gate the contract applies is inclusive (`BorrowerOperations.sol:1330-1349`, `:1239-1253`, `TroveManager.sol:1470-1486`), and no test put a preview at the equality (16) | `core/math/previewAdjust.ts:338`, `core/math/previewAdjust.ts:343`, `core/math/previewAdjust.ts:348`, `core/math/previewAdjust.ts:352`, `core/math/previewAdjust.ts:354`, `core/math/previewAdjust.ts:361`, `core/math/previewAdjust.ts:633`, `core/math/previewClose.ts:159`, `core/math/previewOpen.ts:254`, `core/math/previewRedeem.ts:468`, `core/math/previewRedeem.ts:470`, `core/math/previewRedeem.ts:614`, `core/math/previewRedeem.ts:616`, `core/math/previewRedeem.ts:632`, `core/math/previewRefinance.ts:191`, `core/math/previewRefinance.ts:192` | `borrowing-power-paths.test.ts`, `decision-boundaries.test.ts`, `redemption-edges.test.ts`, `write-guards.test.ts` |
| The same gates in a write's precheck, and what a write sends (13) | `core/redemption/redeem.ts:214`, `core/redemption/redeem.ts:273`, `core/trove/index.ts:147`, `core/trove/index.ts:290`, `core/trove/index.ts:329`, `core/trove/index.ts:494`, `core/trove/index.ts:495`, `core/trove/index.ts:582`, `core/trove/index.ts:584`, `core/trove/index.ts:591`, `core/trove/index.ts:601`, `core/trove/index.ts:623`, `core/trove/index.ts:720` | `redemption-edges.test.ts`, `write-guards.test.ts` |
| A ceiling division that must round up to match the contract (3) | `core/math/previewAdjust.ts:363`, `core/math/previewAdjust.ts:621`, `core/math/previewRedeem.ts:422` | `decision-boundaries.test.ts`, `redemption-edges.test.ts`, `use-musd-client.test.ts` |
| A bundled constant or a measured margin, against the protocol literal or the measurement it came from (12) | `core/client/createMusdClient.ts:121`, `core/constants.ts:7`, `core/constants.ts:15`, `core/constants.ts:17`, `core/constants.ts:19`, `core/hints/computeHints.ts:8`, `core/math/getBorrowingPower.ts:30`, `core/math/getBorrowingPower.ts:46`, `core/math/getBorrowingPower.ts:161`, `core/math/previewRedeem.ts:174`, `core/math/previewRedeem.ts:339`, `core/trove/index.ts:52` | `borrowing-power-paths.test.ts`, `client-plumbing.test.ts`, `decision-pins.test.ts`, `redemption-edges.test.ts`, `write-guards.test.ts` |
| `getBorrowingPower`: the read bound, the backstop, and when it asks the chain for a fee (6) | `core/math/getBorrowingPower.ts:387`, `core/math/getBorrowingPower.ts:420`, `core/math/getBorrowingPower.ts:420`, `core/math/getBorrowingPower.ts:420`, `core/math/getBorrowingPower.ts:578`, `core/math/getBorrowingPower.ts:579` | `borrowing-power-paths.test.ts` |
| `previewRedeem`: the edges of a partial, the first Trove, and the walk (7) | `core/math/previewRedeem.ts:384`, `core/math/previewRedeem.ts:426`, `core/math/previewRedeem.ts:439`, `core/math/previewRedeem.ts:440`, `core/math/previewRedeem.ts:456`, `core/math/previewRedeem.ts:463`, `core/math/previewRedeem.ts:479` | `decision-boundaries.test.ts`, `redemption-edges.test.ts` |
| `previewAdjustTrove`: defaults, the mode switch and the reasons (6) | `core/math/previewAdjust.ts:316`, `core/math/previewAdjust.ts:348`, `core/math/previewAdjust.ts:407`, `core/math/previewAdjust.ts:448`, `core/math/previewAdjust.ts:594`, `core/math/previewAdjust.ts:639` | `decision-boundaries.test.ts`, `preview-reads.test.ts`, `use-musd-client.test.ts` |
| Errors: which alternative matched, and the context a message carries (4) | `core/errors/index.ts:580`, `core/errors/mapRevert.ts:85`, `core/errors/mapRevert.ts:126`, `core/errors/mapRevert.ts:133` | `decision-pins.test.ts` |
| Hints: what is asked of `HintHelpers`, and the zero principal (3) | `core/hints/computeHints.ts:68`, `core/hints/computeHints.ts:69`, `core/hints/computeNICR.ts:42` | `decision-pins.test.ts` |
| Client plumbing: the constants cache lifetime, a verification read that fails, a wallet, and when a Trove exists (3) | `core/client/verifyDeployment.ts:240`, `core/clients/index.ts:76`, `core/read/getTrove.ts:73` | `client-plumbing.test.ts` |
| React: a hook with no owner or redeemer, a leg left undefined, and a client error (10) | `react/hooks/reads.ts:161`, `react/hooks/reads.ts:177`, `react/hooks/reads.ts:196`, `react/hooks/reads.ts:258`, `react/hooks/reads.ts:265`, `react/hooks/reads.ts:287`, `react/hooks/reads.ts:307`, `react/hooks/reads.ts:327`, `react/hooks/reads.ts:357`, `react/internal/useMusdQuery.ts:65` | `hooks-keys.test.ts` |
| `getBorrowingPower` accepting the closed form when the chain's fee is not linear (2) | `core/math/getBorrowingPower.ts:402`, `core/math/getBorrowingPower.ts:433` | MK-119 |

### The 29 equivalent mutants, and why nothing can catch each

The domain every proof is claimed over: for a pure function, every argument whose quantities are
non negative and representable as `uint256`; for a function that reads the chain, every answer the code is
written to handle, a non linear fee (MK-010) and an upgraded proxy included.

| Site | Mutant | Why no observable difference exists |
|---|---|---|
| `core/errors/mapRevert.ts:83` `reason ?? ''` | default removed | With no reason the mutant tests the patterns against the string 'undefined', which none of the fifteen patterns in mapRevert matches, and the fallback message at :141 reads reason, not text. |
| `core/internal/write.ts:58` `marginPercent <= 0` | inclusivity flipped | At a margin of 0 or -0 the mutant computes estimate * BigInt(Math.round(100 + 0)) / 100n, which is the estimate the guard returns; every negative margin still returns early in both. |
| `core/math/compute.ts:174` `entireDebt > MUSD_GAS_COMPENSATION` | inclusivity flipped | At entireDebt equal to the reserve both branches give 0n: entireDebt - MUSD_GAS_COMPENSATION is 0n there. Every other input takes the same branch in both. |
| `core/math/compute.ts:215` `seconds <= 0n` | inclusivity flipped | At seconds equal to 0n the formula returns principal * rateBps * 0 / divisor, which is 0n, the value the guard returns. Every other input takes the same branch in both. |
| `core/math/getBorrowingPower.ts:442` `recommended > ceiling` | inclusivity flipped | When recommended equals ceiling the assignment writes the value it already holds. |
| `core/math/getBorrowingPower.ts:531` `tcrCap < icrCap` | inclusivity flipped | When the two caps are equal either choice is the same value. |
| `core/math/getBorrowingPower.ts:532` `cap <= MUSD_GAS_COMPENSATION` | inclusivity flipped | At cap equal to the reserve the mutant continues with available 0n, so the seed is 0n; a draw of 1 wei needs an entire debt of reserve plus 1 wei, above a cap that is the floor of the same ratio, so the walk takes no step and the function returns 0n, the value the guard returns. solveClosedForm reads nothing from the chain, so no read differs. |
| `core/math/previewAdjust.ts:103` `capacity > entireDebt` | inclusivity flipped | When capacity equals entireDebt both branches report 0n remaining. |
| `core/math/previewAdjust.ts:302` `resultingCollateral > 0n` | inclusivity flipped | At a resulting collateral of 0n both branches give 0n. |
| `core/math/previewAdjust.ts:303` `resultingEntireDebt > 0n` | inclusivity flipped | At a resulting entire debt of 0n both branches give 0n. |
| `core/math/previewAdjust.ts:361` `safeDebt > 0n` | inclusivity flipped | At safeDebt 0n computeICR returns the maximum uint256 (compute.ts:22), so resultingIcr < icrThreshold is false and the figure is null in both. |
| `core/math/previewAdjust.ts:620` `entireDebt > 0n` | inclusivity flipped | At entireDebt 0n the ceiling is (price - 1n) / price, which is 0n for every price of at least 1; a price of 0n returns before this line (previewAdjust.ts:607). |
| `core/math/previewAdjust.ts:621` `systemDebt > 0n` | inclusivity flipped | At systemDebt 0n the ceiling is (price - 1n) / price, 0n for every price of at least 1; a price of 0n returns earlier. |
| `core/math/previewAdjust.ts:623` `collateral > keepForIcr` | inclusivity flipped | When collateral equals keepForIcr both branches give 0n. |
| `core/math/previewAdjust.ts:624` `systemColl > keepForTcr` | inclusivity flipped | When systemColl equals keepForTcr both branches give 0n. |
| `core/math/previewAdjust.ts:625` `byIcr < bySystem` | inclusivity flipped | When the two allowances are equal either choice is the same value; limitedBy is decided separately at :633. |
| `core/math/previewClose.ts:144` `musdRequired > musdBalance` | inclusivity flipped | When musdRequired equals musdBalance both branches report a 0n shortfall. |
| `core/math/previewClose.ts:147` `systemColl > collateral` | inclusivity flipped | When systemColl equals collateral both branches give 0n. |
| `core/math/previewClose.ts:148` `systemDebt > entireDebt` | inclusivity flipped | When systemDebt equals entireDebt both branches give 0n. |
| `core/math/previewRedeem.ts:407` `lot > trove.interestOwed` | inclusivity flipped | When lot equals interestOwed the first branch is principal - 0n, the principal the second branch returns. |
| `core/math/previewRedeem.ts:428` `priceHigh > price` | inclusivity flipped | When priceHigh equals price the first branch computes 0n * E18 / price, the 0n the second returns. |
| `core/math/previewRedeem.ts:429` `price > priceLow` | inclusivity flipped | When price equals priceLow the first branch computes 0n, the value the second returns. |
| `core/math/previewRedeem.ts:457` `firstTroveNetDebt > minNetDebt` | inclusivity flipped | When the first net debt equals the floor both branches give 0n. |
| `core/math/previewRedeem.ts:479` `i < eligible.length` | inclusivity flipped | At i equal to eligible.length the next line reads eligible[i] as undefined and breaks (previewRedeem.ts:481), before anything is computed or recorded. |
| `core/trove/index.ts:278` `payment >= interestOwed` | inclusivity flipped | When payment equals interestOwed the first branch is payment - interestOwed, 0n, the value the second returns. |
| `core/trove/index.ts:589` `collAdd > 0n` | inclusivity flipped | With collAdd 0n the mutant passes addCollateral: 0n to the preview, which reads params.addCollateral ?? 0n (previewAdjust.ts:405-406) and evaluates the same input; nothing it reads changes. |
| `core/trove/index.ts:590` `collWithdrawal > 0n` | inclusivity flipped | With collWithdrawal 0n the mutant passes withdrawCollateral: 0n, which the preview reads as the same 0n it defaults to. |
| `core/trove/index.ts:609` `collAdd > 0n` | inclusivity flipped | With collAdd 0n the mutant sends value: 0n where the original omits value; both are a call carrying no BTC, and the contract reads msg.value as 0 either way. |
| `core/trove/index.ts:777` `decodeRevertReason(error) ?? ''` | default removed | With no decoded reason the mutant tests the pattern against 'undefined', which does not match /No collateral available to claim/i, the same outcome as testing ''. |

### The 5 unreachable sites

| Site | Mutant | Why no input reaches it | Status |
|---|---|---|---|
| `core/math/getBorrowingPower.ts:556` `steps < 64` | inclusivity flipped | The walk cannot reach 64 steps. The seed is floor(available * P / (P + rate)); the largest draw d with d + floor(rate * d / P) <= available satisfies d * (P + rate) / P < available + 1, so d < seed + 2, and feasibleWith accepts exactly the entire debts at or under the cap the seed is sized from. The walk takes at most one step. | MK-120 |
| `core/math/getBorrowingPower.ts:560` `draw !== 0n` | equality negated | draw !== 0n is evaluated only when !feasibleWith(draw, fee(draw)) is true, and it never is: the seed and at most one step above it keep draw + fee + reserve at or under the cap, which is exactly what feasibleWith accepts (both inclusive, BorrowerOperations.sol:1337-1349). | MK-120 |
| `core/math/previewRedeem.ts:364` `600n` | value doubled | REDEMPTION_MARGIN_WINDOW_SECONDS is referenced nowhere (git grep finds only its declaration), is not re-exported by either package entry, and does not appear in dist/index.js, dist/index.cjs or dist/index.d.ts. Dead code. | MK-121 |
| `core/math/previewRedeem.ts:507` `amount > 0n` | inclusivity flipped | amount > 0n is evaluated only when cancelledOnFirst is true, which the loop sets only after entering with remaining, initialised to amount (previewRedeem.ts:475), above 0n at :479; it is set at :488. The operand is never false when reached. | open, left in place: a defensive guard, and removing it is a source change this wave does not make |
| `core/trove/index.ts:220` `maxFeePercentage === undefined \|\| debtIncrease === 0n` | connective swapped | Every caller of the unexported assertFeeWithinCap passes a debt increase already checked positive (openTrove :314, borrow :460, adjustTrove :567), so debtIncrease === 0n is never true; the alternatives differ only when maxFeePercentage is undefined, where the mutant goes on to compare against undefined, which is false, and throws nothing, as the original does. | open, left in place: a defensive guard, and removing it is a source change this wave does not make |

---

## MK-119 · The fallback that protects `getBorrowingPower` from a non linear fee had no test

**Class** S3, a documented safeguard nothing exercised · **Status** fixed · **Found by** MK-118's run: two
survivors at `packages/core/src/math/getBorrowingPower.ts:402` and `:433`

**What was established.** `getBorrowingPower` solves the ceiling in closed form on the premise that the
chain's fee is `floor(rate * draw / DECIMAL_PRECISION)` (`BorrowerOperations.sol:510-512`), and confirms
the premise with one real `getBorrowingFee` read: `solved !== undefined && solvedFee === localFee(...)`
(`:402`). When the read disagrees, it falls back to the bounded binary search, one fee read a step; the
recommended figure reuses the confirmation (`solved !== undefined && linearConfirmed`, `:433`). This is
the protection MK-010 asked for, and `docs/09-review-and-validated-surface.md` §3 relies on it: the
premise "is confirmed against a real `getBorrowingFee` on every call".

**Nothing tested the other side of that confirmation.** With either `&&` swapped for `||`, the function
returns the closed form's answer whatever the chain's fee is, and at `870b76f` no test noticed. `phase4.fork.test.ts` shows the deployed fee is
linear at today's rate (MK-010), which is the premise, not the fallback.

**Why it matters though nothing is wrong today.** The rate is governable, and a fee that stops being
linear is exactly when the fallback runs for the first time. A defect in it would have reached callers as a
ceiling the contract refuses, on the day it mattered, with every test green.

**Fixed.** `packages/core/test/borrowing-power-paths.test.ts`, `MK-119, MK-118, a fee the chain does not
charge linearly`: with a fee that doubles the linear one, the ceiling and the recommended figure are the
searched maxima under that fee, which differ from the closed form's, and each search's reads stay bounded
by its range.

---

## MK-120 · The closed form solver's step bound and its infeasible seed guard are unreachable

**Class** S3, source · **Status** open, left in place and stated · **Found by** MK-118's run: two
survivors at `packages/core/src/math/getBorrowingPower.ts:556` and `:560`

**What was established.** `solveClosedForm` seeds `draw = floor(available * P / (P + rate))` and walks up
`while (steps < 64 && feasibleWith(draw + 1n, ...))` (`:556`), then returns `undefined` if
`!feasibleWith(draw, ...) && draw !== 0n` (`:560`). The largest feasible draw `d` satisfies
`d * (P + rate) / P < available + 1`, so it is under `seed + 2`: **the walk takes at most one step**, and
the bound of 64 never binds. And `feasibleWith` accepts exactly the entire debts at or under the cap the
seed is sized from, both gates inclusive (`BorrowerOperations.sol:1337-1349`), so the seed is always
feasible and `draw !== 0n` is never evaluated. Neither mutant can change a result.

**Why it has its own entry.** The comment above the walk records that a downward loop "sat here until the
P13 wave and could not execute; it was 4 statements no test could reach, which is dead weight on the
coverage ratchet and, worse, a branch a reader would assume had been exercised". The two guards that
remain are the same shape. The same comment keeps them on purpose, for a `feasibleWith` that might one day
accept less than the cap implies, so the choice is between a guard for a future condition and a branch no
test can reach. This wave registers it and does not make it.

---

## MK-121 · `REDEMPTION_MARGIN_WINDOW_SECONDS` names the advertised window and nothing uses it

**Class** S3, source · **Status** open, left in place and stated · **Found by** MK-118's run: the survivor
at `packages/core/src/math/previewRedeem.ts:364`

**What was established.** `export const REDEMPTION_MARGIN_WINDOW_SECONDS = 600n`, documented as "the
window a caller is told the answer holds for", was added in `327949a` (the MK-095 fix) and is referenced
nowhere: not in `packages/*/src`, not re-exported from either package entry, not in the built `dist`.
Doubling it changes nothing.

**Why it has its own entry.** MK-095's rule is that the advice margin, 900 seconds, covers more than the
window the caller is told, 600. The 900 is a constant the code uses (`REDEMPTION_ADVICE_MARGIN_SECONDS`,
`:326`). The 600 exists only in prose, in the docstrings at `:132-141` and `:301-337`, and in the MK-117
test's name (the `600n` at `:412` is the contract's own allowance, `TroveManager.sol:1276-1285`, a
different quantity), while the one constant that names it drives nothing. A reader who changes the window by
editing that constant changes nothing, and nothing would tell them. This wave registers it and does not
change the source.

---

## MK-237 · The standing checklist required the fork gate's Node version and none of its other tools

**Class** S3, process · **Status** fixed · **Found by** review of pull request 42, whose fork evidence was
taken on anvil 1.5.1 while every workflow that runs the fork suite declares Foundry 1.7.1

**What was established.** `docs/08-conventions.md` §10 row 2 required the five fork runs "on the Node version
the fork gate declares" and asked for `node -v`. The fork gate declares three tool versions that execute the
suite: Node 24.19.0, pnpm 9.15.9 and Foundry 1.7.1 (`.github/workflows/ci.yml`, the `Fork gate + coverage`
job; `mutation.yml` declares the same three). The P25 wave ran its five fork windows and its fork mutation
pass on anvil 1.5.1 (`anvil --version`: `1.5.1-stable`, `b0a9dd9`), and the rule it was checked against
allowed that. That is MK-029's shape exactly: a local run and a CI run, both honest, not comparable.

**Why the rule was narrow.** It was written from MK-029 on 2026-08-24 (`40ff7db`), when Node was the one input
that had differed and CI still floated Foundry at `stable` (`git show 40ff7db:.github/workflows/ci.yml`), so
there was no declared anvil to name. MK-041 pinned Foundry three days later (`e187c66`) and generalised the
pinning rule, and nobody went back to row 2.

**Fixed.** Row 2 now names every tool version the gate declares and asks for each one's version output, equal
to the workflow's. The P25 evidence was re-run on the declared versions: on Node 24.19.0, pnpm 9.15.9 and anvil 1.7.1 (`4072e48`), five fork windows passed 112 tests and skipped 1 each, in 359 to 446 seconds, and printed the same differential summary lines and the same list of passing files as the five on 1.5.1, identical after removing durations; the fork mutation pass over the 37 sites the unit project does not catch gave every site the verdict it had on 1.5.1, and the six fork entries and the packaging gate entry were caught. **The results did not differ between the two versions. Two other things did**, and each is a finding: the cache format (MK-238), and a window that passed with half its cases never compared, which was the RPC link and not the version (MK-239)

---

## MK-238 · anvil 1.7.1 compresses the fork cache, so the mutation gate's fork pass would always start cold on CI

**Class** S3, a gate that did not work as measured on the version CI declares · **Status** fixed · **Found by**
the MK-237 re-run, whose fork mutation pass printed `the fork cache ... does not parse, so fork runs start cold`

**What was established.** anvil 1.5.1 persists the fork cache as JSON. anvil 1.7.1 writes the same path,
`~/.foundry/cache/rpc/31611/15043414/storage.json`, as Zstandard compressed data (`file` reports `Zstandard
compressed data (v0.8+)`; the first bytes are `28 b5 2f fd`), and decompressed it is the same four keys,
`meta`, `accounts`, `storage` and `block_hashes`. `scripts/mutation-check.mjs` validated the snapshot with
`JSON.parse` before copying it into each fork run's private HOME, so on 1.7.1 it rejected every cache and
every fork mutant started cold. The fork suite itself is unaffected: anvil 1.7.1 reads its own file, and the
five windows on it ran in 359 to 396 seconds.

**Why it matters.** The gate's full job has not run on CI yet (it needs the workflow on the default branch).
When it does, it restores the cache CI's 1.7.1 wrote, so every fork mutant would have fetched its state from
the public RPC: 849 sequential storage reads for one warm up, where the warm cache needs none (MK-021's
proxy measurement), and far more exposure to the link failures `ENVIRONMENT_FAILURE` exists for. The cost
`docs/07-testing.md` §4d states was measured on 1.5.1 with the cache warm, so it did not describe what CI
would have run.

**Fixed.** A snapshot that starts with the Zstandard magic number is decompressed with `node:zlib` before it
is parsed, and copied as it is. The re-run's fork pass started warm: 37 fork mutants in 5341 seconds with three jobs, 389 seconds mean per run, against 4890 seconds on 1.5.1, both with the cache warm

---

## MK-239 · The differential fork test passed with half its cases never compared

**Class** S2, a gate weaker than it reads · **Status** fixed · **Found by** the MK-237 re-run: the third of
five fork windows took 2975 seconds instead of about 370, and passed

**What was established.** In that window `differential.fork.test.ts` printed `[differential] threw=12`: cases
12 to 23 of 24 each threw `InternalRpcError: An internal error was received.`, the upstream RPC link
failing (MK-078's mechanism). The test was green, 112 passed and 1 skipped, the same as a window in which
all 24 cases were compared. `differential/harness.ts` records a thrown case rather than failing on it, on
purpose, so one bad sample cannot end a thousand case sweep; but nothing asserted afterwards that no case
threw, although the test's own comment says every thrown case "is worth a finding". The other four windows
of that batch, and all five of the batch after it, threw nothing.

**Why it matters.** A green fork window is what row 2 of the wave checklist counts, and what the weekly
sweep's slices report. A run that compared half its cases read the same as one that compared all of them,
and only someone reading the log line would know. It also weakened the mutation gate: a mutant that only the
differential test catches would have read as not caught, conclusively, during a degraded link, rather than
as an inconclusive run the gate retries.

**Fixed.** After every case has run and printed, the test asserts that no case threw, and the message names
the likely cause and what to do. A degraded link now fails the run with `InternalRpcError` in its message,
which the mutation gate's `ENVIRONMENT_FAILURE` treats as inconclusive. The five windows on the final tree
each report `threw=0`.

**The first version of this fix was wrong, and the gate found it.** Its failure message named the RPC error
class in words. The gate classifies a fork failure by matching error names in the whole failure message, so
every failure of this assertion read as the chain link failing, whatever the cases had thrown. On the 1.7.1
fork pass, the mutant at `createMusdClient.ts:379`, which the fork project catches, made differential cases
throw, was judged inconclusive four times, and the gate exited 1 with `the register says caught-fork, and now
NOTHING catches it`. The message now names no error class, with a comment saying why, and only the thrown
errors themselves can mark a run as the link failing. Re-run on 1.7.1 after the change, the three caught-fork sites were each caught and confirmed by two runs, and the gate exited 0 in 647 seconds.

---

## MK-240 · `recommended` is sized for the delay before a send, and is published as the amount to hold

**Class** S1 · **Status** fixed · **Found by** an external consumer audit of the published 0.4.1, working
from the npm tarball rather than this repository

**What was established, from the contract.** Liquidation is `ICR < MCR` in both modes: the only ratio test
in `batchLiquidateTroves` is `if (vars.ICR < MCR)` (`TroveManager.sol:1146-1148`), MCR is `1.1e18`
(`LiquityBase.sol:22`), and a liquidated Trove's collateral is taken whole (`TroveManager.sol:1084-1101`,
`:1409`). Nothing in the protocol refers to how long a position has been held.

**What the SDK does.** `getBorrowingPower` returns `recommended`, solved against
`price * (1 - BORROWING_POWER_PRICE_MOVE_BPS / 10000) / (1 + accrual over BORROWING_POWER_MARGIN_WINDOW_SECONDS)`
with those constants at 200 bps and 3600 seconds (`packages/core/src/math/getBorrowingPower.ts:30`, `:46`,
`:417-447`). `useBorrowingPower` returns it as `data` (`packages/react/src/hooks/reads.ts:131-133`). Both
READMEs call it the draw to offer. A Trove opened at it starts at an ICR of 112.245 percent and is
liquidatable after a fall of 2 percent.

**Why MK-100 did not close this.** MK-100 asked whether a figure survives the interval between being read
and being mined, found that the ceiling did not survive one second, and sized a margin for an hour. The
name `recommended`, the hook's default and the README all answer a different question: how much to borrow
and then hold. The horizon a position is held for is its owner's choice and is not an input anywhere in
the calculation, so any single default stands in for a choice the library cannot make.

**Measured by the audit, and what that measurement is.** Over 2820 samples of mainnet `fetchPrice()`
about 14 minutes apart, from 2026-08-17 to 2026-09-15, the audit reported the share of start times after
which the price fell at least 2 percent: 0.2 percent within an hour, 14.8 within a day, 41.8 within three
days, 55.2 within seven, worst hour 2.96 percent. **Unestablished here**: its instrument was a script
outside this repository. The committed instrument is `scripts/oracle-moves.ts --horizons`, and the figures
this register cites are the ones it produces, recorded when this entry is closed. The audit also opened a
Trove at `recommended` on a mainnet fork, moved the price down 2.01 percent and liquidated it; the committed
equivalent is `zz-borrowing-power-boundary.fork.test.ts`, whose existing pin already shows a 210 bps fall an
hour later liquidates it.

**Who it affects.** Every consumer that renders `useBorrowingPower().data` or `recommended` as an amount to
borrow, which is the use both READMEs show.


**Fixed, by removing the answer rather than re-sizing it.** The ruling was that the SDK should stop answering
a question it cannot answer, and this entry could not show it wrong: every margin a library could pick is a
holding period and a fall tolerance chosen for a caller it has never met. `getBorrowingPower` returns
`{ ceiling, ceilingIcr, isRecoveryMode, price }` and nothing that reads as an amount to borrow.
`drawForMargin({ collateral, horizonSeconds, priceFallBps })` takes both margin inputs as REQUIRED, refuses a
missing one with `InvalidAmount` before any read rather than defaulting it, and reports the margin it was
given. `recommended`, `recommendedIcr`, `margin`, the two override parameters and the
`BORROWING_POWER_MARGIN_WINDOW_SECONDS` and `BORROWING_POWER_PRICE_MOVE_BPS` constants are removed. In React
`useBorrowingPower` returns the ceiling result object, `useBorrowingPowerDetail` is removed, and
`useDrawForMargin` stays disabled until both inputs are supplied. The solver is unchanged, one implementation
of the open rules (`docs/08-conventions.md` §11), projected twice.

**The horizon table, reproducible, from this wave's own run.**
`MEZO_MAINNET_RPC_URL=https://jsonrpc-mezo.boar.network pnpm tsx scripts/oracle-moves.ts --end 11869000
--consecutive 0 --days 90 --step 225 --horizons 3600,86400,259200,604800,2592000 --falls 200,500,1000,2000`,
the instrument extended with `--horizons` in this wave, over blocks 9841930 to 11868955, 9010 samples,
7454138 seconds:

| Horizon | starts | fell 2% or more | 5% or more | 10% or more | 20% or more | worst fall |
|---|---|---|---|---|---|---|
| 1 hour | 9005 | 11 (0.1%) | 0 | 0 | 0 | 418.47 bps |
| 1 day | 8910 | 1552 (17.4%) | 91 (1.0%) | 0 | 0 | 569.74 bps |
| 3 days | 8709 | 3820 (43.9%) | 334 (3.8%) | 1 (0.01%) | 0 | 1023.77 bps |
| 7 days | 8313 | 4791 (57.6%) | 560 (6.7%) | 15 (0.2%) | 0 | 1079.82 bps |
| 30 days | 5917 | 4036 (68.2%) | 613 (10.4%) | 64 (1.1%) | 0 | 1164.16 bps |

It agrees in shape with the audit's unestablished 29 day figures (14.8% in a day, 55.2% in a week) and
replaces them. Its limits are stated where a caller meets it, on `drawForMargin`, both READMEs,
`docs/03-core-api.md` and `docs/16-migration-0.4-to-0.5.md`: one stretch of history, overlapping start
times that are not independent trials, a lower bound at one sample in 225 blocks, and no model of debt
redistributed from other liquidations. **The worst hour in this range, 418.47 bps, is more than twice the
190.78 bps worst hour MK-100 sized its 200 bps default on**, so the default did not cover the measurement it
cited once the range was longer than a week.

**Proven by sending**, `MEZO_FORK_BLOCK=15043414 pnpm exec vitest run --project fork
packages/core/test/zz-borrowing-power-boundary.fork.test.ts`: at a margin of one day and 500 bps, the draw
(66,276.04 MUSD for 1 BTC at 77,051.11) is not liquidatable after 1, 60, 600 or 3600 seconds, a 499 bps fall a
day later leaves it safe and a 510 bps fall makes it liquidatable, while the ceiling beside it is
liquidatable after each delay and is liquidated.

**The same question, asked of every other figure the SDK offers as a maximum or an advice.** The table is in
`docs/03-core-api.md`. `ceiling`, `capacity.remaining`, `minimumCollateralToClearIcr` and
`previewClose().musdRequired` are true for the block and documented as limits or snapshots.
`previewRedeem().nextViableAmount` is true for about 600 seconds and says so, and a redemption is not a
position anyone holds. `liquidationPrice` is documented as a threshold near which liquidation begins.
**One implied a longer horizon than it has, and is MK-247.**

---

## MK-241 · `RedeemResult` reports the hint helper's figures, not what the redemption settled

**Class** S1 · **Status** fixed · **Found by** the same external audit

**What was established, from the contract.** `redeemCollateral` hands the whole remaining amount to each
Trove it visits and stops at the first cancelled partial (`TroveManager.sol:1218-1221`, `:392`,
`:1299-1306`); `getRedemptionHints` sizes a partial per Trove and continues (`HintHelpers.sol:138-162`),
which MK-048 already records as a different question. What settled is emitted once:
`Redemption(_attemptedAmount, _actualAmount, _collateralSent, _collateralFee)`
(`ITroveManager.sol:48-53`), emitted at `TroveManager.sol:420-425` with `totalCollateralDrawn` in the
`_collateralSent` position. **That argument includes the fee**: the redeemer is sent
`totalCollateralDrawn - collateralFee` (`:416-418`, `:444-447`), and the MUSD burned is `_actualAmount`
(`:428-431`).

**What the SDK does.** `redeem()` returns `truncatedAmount` straight from `getRedemptionHints`
(`packages/core/src/redemption/redeem.ts:244-249`, `:284`) and computes `estimatedCollateralDrawn` and
`estimatedFeeCollateral` from that helper figure (`:271-280`). It returns before the transaction mines, so
no field can say what was redeemed.

**Measured by the audit.** On a mainnet fork, a redemption of 66,819.7 MUSD that consumed the first Trove
whole and cancelled a partial on the second returned `truncatedAmount` 66,819.7 and
`estimatedFeeCollateral` 0.006556 BTC, while the `Redemption` event recorded `_actualAmount` 16,864.7 and
`_collateralFee` 0.001655 BTC. **Unestablished here** until the fork test this wave adds reproduces the
shape at the pinned block. The audit's report labelled the event's `_collateralSent` as collateral sent;
it is collateral drawn, fee included.

**Who it affects.** Any redeemer, bot or accounting view that reads the result object, whenever a
redemption ends in a cancelled partial after the first Trove.


**Fixed.** `redeem()` waits for the receipt and reports `settled`, read by `settledRedemptionFrom` from the
`Redemption` event emitted by the Trove manager: `attemptedAmount`, `redeemedAmount` (`_actualAmount`),
`unredeemedAmount`, `collateralDrawn` (`_collateralSent`, fee included), `collateralFee` and
`collateralReceived` (drawn less fee). A reverted receipt, or a successful one with no such event from that
address, throws `RedemptionFailed`. The pre-send figures survive only as `estimatedBeforeSend`, from
`previewRedeem`'s walk rather than the helper, with the fee from the contract's own formula applied locally,
so the estimate cannot revert on `fee < collateralDrawn` after the send. `truncatedAmount`,
`estimatedFeeCollateral` and `estimatedCollateralDrawn` are removed. `useRedeem` stays pending until the
redemption mines.

**Proven by sending**, `MEZO_FORK_BLOCK=15043414 pnpm exec vitest run --project fork
packages/core/test/zz-redemption-settled.fork.test.ts`: an amount that consumes the first eligible Trove whole
and cancels a partial on the second. The hint helper's `truncatedAmount` for that state is 3,515.14 MUSD;
`settled.redeemedAmount` is 1,808.46, equal to `_actualAmount`, to the MUSD that left the redeemer's balance,
and to `estimatedBeforeSend.redeemable`; `settled.collateralReceived` equals the BTC that arrived net of the
gas paid, to the wei; the first Trove is `closedByRedemption` and the second untouched.

**The misreading, enumerated.** The audit report called `_collateralSent` collateral sent. Two places in this
repository read it as net of the fee too: `docs/01-ground-truth.md` computed the fee fraction as
`_collateralFee / (_collateralSent + _collateralFee)` and reported 0.744%, which is exactly 0.75% divided by
1.0075; and `phase6.fork.test.ts` used the same formula for both redeemers, passing because the error, about
5.6e-5, sits inside its 0.001 tolerance. Both now divide by `_collateralSent`. `docs/13-live-testnet-ledger.md`
compares an estimate of collateral drawn against `_collateralSent`, which was already the right pairing.

---

## MK-242 · A collateral withdrawal permanently lowers borrowing capacity, and no preview discloses it

**Class** S1 · **Status** fixed · **Found by** the same external audit

**What was established, from the contract.** On the adjust path the stored capacity changes only when
collateral decreases, to `min(current, _calculateMaxBorrowingCapacity(newColl, price))`
(`BorrowerOperations.sol:879-899`). A collateral increase does not touch it: the branch is guarded by
`!vars.isCollIncrease && vars.collChange > 0` (`:880`). Every debt increase is gated on it
(`:850-852`, `:1358-1365`). The only other writer is `_refinance`, which resets it unconditionally from the
current price (`:1077-1084`), and a refinance is refused in Recovery Mode (`:1023`), requires ICR at or
above MCR after its fee (`:1058`), charges `getBorrowingFee(refinancingFeePercentage * netDebt / 100)`
into principal (`:1029-1040`) and moves the Trove to the global rate (`:1069`, `:1075`).

**What the SDK does.** `AdjustPreview.capacity` is built from the stored capacity before the change
(`packages/core/src/math/previewAdjust.ts:176`, `:298`). `MaxWithdrawable` has no capacity field
(`:501-527`). `RefinancePreview` alone reports a resulting capacity (MK-101).

**Measured by the audit.** On a mainnet fork, a withdrawal of half the reported maximum during a 30 percent
price fall, then the same collateral added back at the original price, left the capacity at 58,754 MUSD from
138,982, and a 60,000 MUSD borrow on a Trove at ICR 756 percent was refused with
`ExceedsBorrowingCapacity`. **Unestablished here** until the fork test this wave adds reproduces it.

**Who it affects.** Anyone who withdraws collateral, most of all during a price fall. Silent at the moment
of the withdrawal, loud at the next borrow, and undone only by a refinance that costs a fee and a rate.

**Class note.** This is an irreversible state change the library helps a caller make without saying so.
No earlier entry is of that kind.


**Fixed.** `capacityAfterAdjustment` in `math/compute.ts` is the one copy of `:879-899`. `evaluateAdjust`
returns `capacityAfter: { current, resulting, lost, restoredByAddingCollateral: false, recovery }` for every
input, and `computeMaxWithdrawable` returns it at its own amount. `previewAdjustTrove`,
`previewWithdrawCollateral` and `maxWithdrawableCollateral` fill `recovery` whenever capacity is lost, by
projecting a refinance on the resulting state through `evaluateRefinance`, the one implementation of
`_refinance`'s rules: its fee, the current and resulting interest rates, the capacity it would write, and its
verdict and reasons. The write path's precheck uses `previewAdjustVerdict`, which reads no projection. The
hooks return the previews whole, and the withdrawal hooks' documentation says to render `capacityAfter`.

**Proven by sending**, `MEZO_FORK_BLOCK=15043414 pnpm exec vitest run --project fork
packages/core/test/zz-capacity-ratchet.fork.test.ts`: a 2 BTC Trove with capacity 140,092.92 MUSD; after a 30
percent fall, a withdrawal of half the maximum was previewed to leave 59,142.52, and the chain stored exactly
that; a refinance at that state wrote 59,142.52 as projected and charged 4.004000005 MUSD against a projected
4.004, the difference being interest accrued between the preview and the send; the price restored and the
collateral added back, the capacity stayed at 59,142.52, and a 60,000 MUSD borrow that fitted before the
withdrawal was refused before gas with `ExceedsBorrowingCapacity`.

**Where a caller decides to withdraw, enumerated**: `previewAdjustTrove`, `previewWithdrawCollateral`,
`maxWithdrawableCollateral`, their three hooks, and `adjustTrove` and `withdrawCollateral`, which send without
reporting and whose previews now do. Both READMEs and `docs/03-core-api.md` state the mechanism.

---

## MK-243 · One contract gate reaches the caller as two error codes, and the register names the one the precheck does not throw

**Class** S2 · **Status** fixed · **Found by** the same external audit

**What was established, from the contract.** `_requireICRisAboveMCR` (`BorrowerOperations.sol:1330-1335`)
is one gate, reached by open (`:657`), every normal mode adjustment (`:1201`) and refinance (`:1058`).
`_requireICRisAboveCCR` (`:1337-1342`) is its Recovery Mode counterpart (`:655`, `:1272`).

**What the SDK does.** The adjust precheck turns `ICR_BELOW_THRESHOLD` into `InsufficientCollateral`
(`packages/core/src/trove/index.ts:407-408`) in either mode, with a message that says MCR even when the
threshold is CCR. The revert decoder turns the MCR gate into `ICRBelowMCR`
(`packages/core/src/errors/mapRevert.ts:95`) and the CCR gate into `RecoveryModeRestriction` (`:94`). So
`borrow()` refused by the ratio reports `INSUFFICIENT_COLLATERAL` and `openTrove()` refused by the same gate
reports `ICR_BELOW_MCR`. The README lists `ICRBelowMCR` as the protocol revert. The register's MK-079 era
text (line 5031 of this file at `8a156dc`) says the precheck refuses with `ICRBelowMCR`; at 0.4.1 it does not.

**A second instance of the ordering shape.** `borrow()` runs its capacity precheck before the adjust
evaluator (`packages/core/src/trove/index.ts:466-470`), so when both fail it throws
`ExceedsBorrowingCapacity` while the contract checks the ratio first (`:840-845` before `:850-852`) and
`previewBorrow` names the ratio as binding. `adjustTrove` does the same (`:579-593`).

**Who it affects.** Any consumer branching on `code`.


**Fixed, by choosing the gate's contract authoritative code.** `ICRBelowMCR` for `_requireICRisAboveMCR`, and
`RecoveryModeRestriction` for `_requireICRisAboveCCR`, from the precheck and from the decoder alike; the
precheck adds `{ resultingIcr, mcr }` or `{ resultingIcr, ccr }` as optional context, so the constructors stay
compatible. `InsufficientCollateral` now names only a withdrawal larger than the collateral, with
`{ withdrawal, collateral }`, and its message no longer says MCR where the threshold was CCR. The separate
capacity guard in `borrow` and `adjustTrove`, which ran before the ratio gates, is removed: the evaluator's
`EXCEEDS_BORROWING_CAPACITY` comes after them as `:840-852` has it, and its error carries the four numbers.
The register line that named the wrong code is annotated in place.

**Every place the ratio gate becomes an error, enumerated**: `chainReasonToError` in `trove/index.ts` (the
precheck of `addCollateral`, `borrow`, `repay`, `withdrawCollateral` and `adjustTrove`), `mapRevert` in
`errors/mapRevert.ts` (`openTrove`, `refinance`, and any precheck the chain moves past), the React write hooks,
which pass core's errors through, and the documentation in `docs/01-ground-truth.md`, `docs/03-core-api.md`
and `docs/06-errors.md`, which also listed a `RedemptionTruncated` error that does not exist.

---

## MK-244 · `adjustTrove` refuses zero valued legs by presence, which the contract accepts and the preview calls viable

**Class** S2 · **Status** fixed · **Found by** the same external audit

**What was established, from the contract.** The collateral rule is on values:
`require(_assetAmount == 0 || _collWithdrawal == 0)` (`BorrowerOperations.sol:1367-1375`). The debt side
is one amount and one flag (`:757-758`); `(0, true)` is refused (`:785-787`, `:1351-1356`), and `(0, false)`
with a collateral change is accepted (`:1377-1386`).

**What the SDK does.** `adjustTrove` throws `InvalidAdjustment` when both collateral keys are present or both
debt keys are present, whatever their values (`packages/core/src/trove/index.ts:549-554`), while
`previewAdjustTrove` evaluates collateral by value (`packages/core/src/math/previewAdjust.ts:316`) and so
returns `viable: true` for `{ addCollateral: 0n, withdrawCollateral: x }`. The audit sent that input through
the published client, got `InvalidAdjustment`, and simulated the same call directly against the contract,
which accepted it.

**The third time.** MK-060 and MK-085 were presence against value on the debt increase flag. This entry is
closed only with an enumeration of every place the SDK distinguishes an absent argument from a zero one.


**Fixed, and MK-060's ruling for this path is reversed with its reason.** MK-060 read the SDK's debt legs as
the contract's flag and chose presence. They are not the flag; they are an input the SDK must encode, and a
zero leg has two encodings, `(0, false)`, which the contract accepts beside a collateral change, and
`(0, true)`, which it refuses. Choosing the refused one for an input the contract can accept is the defect.
`adjustLegsOf` resolves the four legs by value, and `adjustShapeReasons` holds the shape rules, by value, in
contract order: `evaluateAdjust` reports from it, and `adjustTrove` refuses from it before any read. A negative
leg throws `InvalidAmount`. `(0, true)` stays reachable where the contract receives it unconditionally,
`withdrawMUSD`, which `previewBorrow` states through `EvaluateAdjustInput.isDebtIncrease`. The mutation entry
'MK-060 write path' is withdrawn with a comment saying why, and 'MK-060 evaluator' now puts back ignoring that
stated flag.

**Every place an absent argument is distinguished from a zero one, both packages, enumerated.**

| Site | Absent | Zero | Correct? |
|---|---|---|---|
| `adjustTrove` legs, `previewAdjustTrove` legs, `useAdjustTrovePreview` legs | no leg | no leg | **fixed here**; the hook's query key still tells `0n` from absent, which costs a duplicate cache entry for an identical call and no wrong answer |
| `EvaluateAdjustInput.isDebtIncrease` | decided by value | the stated flag | yes: `previewBorrow` states `true`, as `withdrawMUSD` sends it |
| `borrow`, `repay`, `addCollateral`, `withdrawCollateral` `amount` | a type error | `InvalidAmount` | yes |
| `maxFeePercentage` on `openTrove`, `borrow`, `adjustTrove`, `redeem` | no cap | a cap of zero, refusing any fee | yes: both are meaningful and documented |
| `maxIterations` on `previewRedeem`, `redeem` | 100 | no limit | yes: zero is the contract's own meaning (MK-114) |
| `marginSeconds` on `previewRedeem` | the advice margin | no margin | yes |
| `drawForMargin` and `useDrawForMargin` `horizonSeconds`, `priceFallBps` | refused, or the hook disabled | a margin of nothing, asked for | yes, by MK-240 |
| `account` on `previewOpen`, `getBorrowingPower`, `drawForMargin` | assumed not exempt, reported | not a value | documented (MK-106); the hooks default it to the wallet |
| `price` on `previewOpen`, `getBorrowingPower`, `drawForMargin` | `fetchPrice()` | a price of zero, used as given | the caller's input; not a defect |
| `constantsTtlMs`, `gasMarginPercent` | the measured defaults | re-read every time, the bare estimate | yes, documented |
| `useBorrowPreview`, `useWithdrawCollateralPreview`, `useRedeemPreview` `amount` | disabled | asked | yes: zero reaches the reason the contract gives it |
| `useBorrowingPower`, `useDrawForMargin` `collateral` | disabled | disabled | yes: core refuses a zero collateral |

---

## MK-245 · `previewRedeem` omits the last Trove rule that a whole consumption reaches

**Class** S2 · **Status** fixed · **Found by** the same external audit

**What was established, from the contract.** Consuming a Trove whole (`TroveManager.sol:1252`) calls
`_closeTrove(_borrower, Status.closedByRedemption)` (`:1261`), which, when BorrowerOperations is on the
MUSD mint list, requires `TroveOwners.length > 1 && sortedTroves.getSize() > 1` (`:1397-1399`,
`:1488-1496`). A failing `require` reverts the whole redemption; unlike a cancelled partial it does not
stop the loop quietly.

**What the SDK does.** `EvaluateRedeemInput` carries no count (`packages/core/src/math/previewRedeem.ts:276-291`)
and `evaluateRedeem` has no such reason (`:451-526`). Run through the published package, a one Trove system
consumed whole returns `viable: true`, while `evaluateClose` on the same state returns
`LAST_TROVE_IN_SYSTEM` (MK-074 covered close and liquidation, not redemption).

**Likelihood.** Low on the live deployments, which hold 19 Troves on mainnet and 232 on testnet at the
audit's reads. Loud when it happens: the simulation reverts.


**Fixed.** `EvaluateRedeemInput` requires `troveOwnersCount`, `sortedTrovesSize` and `canMint`, and
`previewRedeem` reads them in its existing batch. The walk compares both counts before each whole consumption,
as `_closeTrove` does before removing the Trove (`:1395-1399`), decrements both after it, and reports
`LAST_TROVE_IN_SYSTEM` and stops. `redeem()` throws `LastTroveInSystem` before gas. **An existing test asserted
the omission**: `mk114-max-iterations.test.ts` redeemed every Trove of a four Trove system and expected all four
redeemed; it now expects the refusal, beside a control with BorrowerOperations off the mint list. No fork proof
was added: it needs a deployment reduced to one Trove, which the pinned testnet state cannot give without
closing every other Trove on it, and it is listed as not verified by sending.

---

## MK-246 · Corrected claims survive in the published declarations and in this register, and nothing checks for the class

**Class** S3 · **Status** fixed · **Found by** the same external audit, from `dist/index.d.ts`

**What was established.**

- `MusdClient.computeNICR` is documented as `(collateral × 1e20) / entireDebt`
  (`packages/core/src/client/createMusdClient.ts:209`, shipped at `dist/index.d.ts:7247` in 0.4.1). MK-090
  made the parameter `principal`.
- `MusdClient.isLiquidatable` is documented as normal mode liquidatability (`:201`, shipped at `:7241`).
  MK-001 removed the mode distinction.
- `getClaimableCollateral` says surplus is left by a Recovery Mode liquidation of an above MCR Trove
  (`packages/core/src/read/system.ts:112-113`, shipped in the source map). The only writer of surplus is a
  redemption that closes a Trove (`TroveManager.sol:1195`), and MK-001 records that this protocol has no
  Recovery Mode liquidation.
- The core README says `claim` has nothing to preview because `_claimCollateral` has no condition
  (`packages/core/README.md:116`), and this register's gate table says the same. `CollSurplusPool.claimColl`
  reverts with `No collateral available to claim` when there is no surplus (`CollSurplusPool.sol:90-93`), and
  `claim()` handles exactly that revert (`packages/core/src/trove/index.ts:741-781`, MK-007).

**Why a class.** Each closed finding corrected the claim where it was found. None of those corrections
searched the shipped artifact for the same claim elsewhere, and no gate reads the artifact for claims a
finding retired.


**Fixed where it ships, and checked where it ships.** Every claim above is corrected in the source the
declarations and source maps are built from. **Reviewing the whole built declaration file and the embedded
sources against the closed findings, not only the two the audit caught, found more**:
`BorrowingCapacity.remaining` explained why it had "no recommended twin"; `useRedeemPreview` pointed at
`RedeemResult.truncatedAmount`; `CreateMusdClientParams.walletClient` and `createMusdClient` said writes arrive
in Phase 5, and the contract bundle said its writes were typed from Phase 5 while it is typed read side only;
`previewBorrow` said capacity is set ONCE at open, against MK-101; `estimateCollateralDrawn` named its parameter
`truncatedAmount`. **And one claim that no finding had retired, and was simply false**: three comments, in
`read/getTrove.ts`, `trove/index.ts` and `math/previewBorrow.ts`, said `getTroveDebt` returns a stale stored
value. It accrues to the block (`TroveManager.sol:591-595` into `_getTotalDebt`, `:1513-1527`); what it omits is
pending redistribution, which is the real reason `getEntireDebtAndColl` is read. The same review of the docs
corrected `docs/01-ground-truth.md`'s surplus from a Recovery Mode liquidation and its fee formula (MK-241),
and `docs/06-errors.md`'s `RedemptionTruncated` and its reachable `StaleHint` and `Unauthorized` rows (MK-249).

**The check.** `scripts/retired-claims.mjs` holds each retired claim as the claim was worded, tied to its
finding, and reads what a package ships: the README, the manifest description, every declaration file and
every source map's embedded sources. The packaging gate runs it over the packages it installed from the packed
tarballs, and fails on any hit; `pnpm gate:packaging` is a CI step (MK-096). Run over the published 0.4.1
from outside the repository it reports 119 hits, including `index.d.ts:7241` (MK-001) and `:7247` (MK-090);
over this tree it reports none. `retired-claims.test.ts` pins each entry against its original line and its
correction, so an entry that matched a correction, or missed its claim, goes red.

---

## MK-247 · `useMaxWithdrawableCollateral` is documented as the max button's number

**Class** S2 · **Status** fixed · **Found by** this wave's enumeration for MK-240, asking each figure the SDK
offers as a maximum over what horizon it is true

**What was established.** `maxWithdrawableCollateral().amount` is bounded by `ICR >= MCR` at the read block
(`packages/core/src/math/previewAdjust.ts:619-625`). Accepted, it leaves the Trove at the liquidation
threshold (`TroveManager.sol:1146-1148`), the shape MK-100 found in the ceiling. MK-051 records that it is
refused a second later when the debt has accrued; if the price rises first it is accepted and the Trove sits
at MCR. The hook's TSDoc calls it "the max button's number" (`packages/react/src/hooks/reads.ts:298`), which
implies a position a user will hold.


**Fixed.** `useMaxWithdrawableCollateral` and `MaxWithdrawable.amount` say it is a limit to display, that at it
the Trove sits at the liquidation threshold, and that it removes capacity (MK-242). The retired claims check
carries the old sentence.

---

## MK-248 · `GasDecision` has an `explicit` branch no public write can reach

**Class** S3, source · **Status** open · **Found by** the external audit

`simulateAndSend` returns `source: 'explicit'` when `opts.gas` is set (`packages/core/src/internal/write.ts:286-288`),
and no caller passes `gas`: `send` in `packages/core/src/trove/index.ts:281-292`, `redeem` and both liquidation
writes forward `value` and `revert` only. The type documents a caller supplied limit the API does not accept.

---

## MK-249 · `StaleHint` and `Unauthorized` are exported error classes nothing throws

**Class** S3, source · **Status** open · **Found by** the external audit

**What the code does, at the 0.5.0 tree.** `packages/core/src/errors/index.ts:401-411` defines `StaleHint`
and `:496-504` defines `Unauthorized` (the entry first cited `:373` and `:468`, which the MK-243 and MK-245
error changes moved; corrected here). Both are exported by both packages
(`packages/core/src/index.ts:202`, `:207`; `packages/react/src/index.ts:85`, `:90`), and their codes
`STALE_HINT` and `UNAUTHORIZED` are members of `MusdErrorCode` (`packages/core/src/errors/codes.ts:26`,
`:30`). **No SDK path constructs either**: `new StaleHint(` and `new Unauthorized(` appear nowhere in
`packages/*/src`, `scripts/` or `examples/`, only in `packages/core/test/phase7.fork.test.ts:174` and `:177`,
which construct them directly to assert the code mapping. A stale redemption partial hint reaches the caller
as `RedemptionFailed` from the decoder (`packages/core/src/errors/mapRevert.ts:118-123`), and the SDK calls
no permission gated function, so `Unauthorized` has no revert to map. A consumer branching on `STALE_HINT`
or `UNAUTHORIZED` never takes that branch, and no error tells them so at runtime.

**What the documentation now says.** `docs/06-errors.md:48` and `:50` say **never thrown** with this finding
ID and where the condition does surface; `docs/01-ground-truth.md:446-453` records both as unreachable and
retained for compatibility. The TSDoc on each class, which is what ships in `dist/index.d.ts` and what a
consumer reads at the call site, says the same (`errors/index.ts:395-400`, `:491-495`). One line contradicted
this and is corrected in the same commit as this entry: `docs/06-errors.md:88-90` still gave "redeem against
a stale hint → assert `StaleHint`" as the fork gate's example, which is the behaviour this finding says does
not exist.

**Why the pair is acceptable in 0.5.0, stated without hedging.** 0.5.0 IS a breaking release, so the removal
could have ridden in it, and it does not. The earlier wording here ("stays open for a release that is
breaking anyway") was therefore self refuting and is withdrawn. The reasons it is acceptable to ship as it
stands: nothing a consumer can call behaves wrongly, because no path throws either class, so this changes no
result, no revert mapping and no gas; the claim a consumer reads, in the declarations and in both docs, now
matches the code exactly, which is the property this programme keeps failing on and the one that is met here;
and removing two classes plus two `MusdErrorCode` members is a public API removal that belongs in a migration
guide as its own row, registered before the release's acceptance evidence is measured rather than added after
it. It was not registered before this wave's evidence was measured at `32e8c59`. What is NOT a reason: that
0.5.0 is not breaking, or that the defect is documented away. It is an open source defect shipping with an
accurate description of itself.

**What would close it.** Either a path that throws them, which for `StaleHint` means the decoder
distinguishing a stale hint from an empty redemption and `TroveManager` giving it a distinct revert reason to
distinguish (it has one, `require(totals.totalCollateralDrawn > 0, "TroveManager: Unable to redeem any
amount")`, `TroveManager.sol:406-409`, which a stale hint and a genuinely empty redemption both reach), or
their removal
with `STALE_HINT` and `UNAUTHORIZED` from `MusdErrorCode`, registered in the next breaking release's
migration guide before that release's checklist is run, with the fork mapping test at
`phase7.fork.test.ts:174-177` updated in the same change. Until one of those, the entry stays open and the
status line in the register says open in the source, not fixed.

---

## MK-250 · A write whose simulation reverts logs that it is sending without a margin

**Class** S3 · **Status** open · **Found by** the external audit

The estimate runs in parallel with the simulation and warns `sending without a margin` when it fails
(`packages/core/src/internal/write.ts:269-282`). When the simulation also reverts, nothing is sent, but the
warning has already been printed. Observed by the audit on a refused `openTrove`.

---

## MK-251 · Two React claims are stronger than the rendered behaviour

**Class** S3 · **Status** open · **Found by** the external audit, rendering the published hooks

- `useMusdQuery` says `gcTime: 0` means returning to an earlier key cannot serve its old answer
  (`packages/react/src/internal/useMusdQuery.ts:21-22`). Clearing an input and restoring the same value in
  the same tick served the earlier answer as `success` with `isFetching: true`, because the collection runs
  on a timer. A separate event loop tick does not show it.
- A write fired in the render after a wallet switch, before `useWalletClient` resolves, throws
  `MissingWalletClient`, whose message says `createMusdClient` was called without a wallet
  (`packages/core/src/errors/index.ts:482-486`). No transaction is sent from the previous account.

---

## MK-252 · The claim MK-244 retired is still in two comments the packages ship

**Class** S3, docs · **Status** fixed · **Found by** checking precondition 2 before the 0.5.0 release,
reading the S1 closing texts rather than the index column

MK-244 made both the preview and the write path read adjustment legs by VALUE: `adjustLegsOf`
(`packages/core/src/math/previewAdjust.ts:318-332`) derives `isDebtIncrease` as `increaseDebt > 0n`, and
`adjustTrove` builds its legs through it (`packages/core/src/trove/index.ts:562`, `:581-582`). Two comments
still described the behaviour it replaced, and **both ship**: TSDoc reaches `dist/index.d.ts`, and every
comment reaches the published source maps, which is how the audit read 0.4.1 in the first place.

- `packages/core/src/math/previewAdjust.ts:398-399`: "`trove/index.ts` reads the flag from PRESENCE" and
  "`previewAdjustTrove` passes presence, which is what the write path passes". Neither is true after MK-244.
- `packages/react/src/hooks/reads.ts:268`: "`previewAdjustTrove` reads `_isDebtIncrease` from PRESENCE
  (MK-060)", in the TSDoc of `useAdjustTrovePreview`, where a consumer reads it at the call site.

The MK-085 row's closing text has the same shape, "The legs are built once from presence", and is corrected
with them: presence is still what the hook preserves for an ABSENT leg in the query key, which is the part
MK-085 fixed, but the flag the preview derives is a value test now.

**Why the MK-246 check did not catch it.** `RETIRED_CLAIMS` holds the claims the audit found plus the seven
the wave found; nobody wrote an entry for the wording MK-244 retired, in the same wave that retired it. That
is the standing hole in that check: **it only knows the claims someone remembered to add**. The entry is
added here, and the closing rule is written into `scripts/retired-claims.mjs`: a wave that changes behaviour
adds the sentence its change retires, in the same commit.

**What was verified.** `grep -rn "from PRESENCE\|by presence\|from presence" packages/*/src` returns these
two sites and no others, and `adjustLegsOf` is the one derivation both paths use. The class is S3: no
behaviour is wrong, only the description a consumer reads, which is MK-246's class exactly.

---

## MK-253 · The live gate asserts a knife edge across two reads, and a lost race costs the close

**Class** S2, process · **Status** fixed · **Found by** the 0.5.0 release run, on the second of three

`scripts/testnet-e2e.ts` reads `maxWithdrawableCollateral`, then previews a withdrawal AT that amount and
calls `die()` when the preview refuses. The maximum is by definition the amount that leaves the Trove at
MCR, so it carries almost no margin: at the failing moment `resultingIcr` was 1100038345703729110 against
an MCR of 1.1e18, **0.349 bps**. Between the two calls the oracle moves. Sampled at the same hour on the
same chain, consecutive blocks moved by up to **1.08 bps**, and 3 of 11 samples were negative. So a fall
of 0.349 bps in the time of one RPC round trip refuses an amount that was correct when it was read, and
the same pair of calls returned viable a minute later.

**This is checklist row 11 broken by the tool that gates a release**: a boundary that moves with time,
asserted as an exact equality across a delay, with no margin and no attribution. Run 1 and run 3 passed,
run 2 failed, on identical code and an unchanged SDK.

**The second half is worse than the flake.** `die()` exits the process, and this assertion sits before the
close, so the lost race left an open Trove on the account, which is the outcome the script's own redeem
step is carefully written to avoid ("an optional, flag gated step must never cost the close", MK-052). The
next run recovered it, because the script closes a pre-existing position first, but recovery by luck is
not the property that was claimed.

**Decided and fixed, not carried.** The reading that settled it: a flake in a release gate is not a flake,
it is a gate that teaches a reader to re-run until green, and the next person to see this red will have a
true instance of "the SDK reports a maximum its own preview refuses" in front of them and will re-run. That
is the same failure as an expectation nothing can trip (MK-254) and a verification reading its own cache
(MK-256), and this programme has now paid for that class three times in one release.

**What changed**, `scripts/testnet-e2e.ts`:

- the oracle price is read either side of the pair, and when it moved the step says by how many bps and
  reads the pair again, up to three times. Only a refusal at an UNCHANGED price fails the run, which is the
  claim worth making and the one `withdraw-max-boundary.fork.test.ts` pins on a fork where no time passes.
  Three consecutive moves records a skip with that reason rather than a pass;
- a fatal mismatch is now recorded through `recordFatal` instead of `die()`, and `main` exits 1 after the
  ledger, so the run is still red and the position is still closed. `die()` before the close traded one
  assertion for an open position on a real chain, which is what MK-052 is about.

**What is still true and deliberately not fixed**: the maximum carries no margin, by definition. This wave
did not add one, because a maximum that is not the maximum is a different defect (MK-051).

---

## MK-254 · The sweep's expected set still registers ten mismatches this release made impossible

**Class** S3, tests · **Status** fixed · **Found by** reading the 0.5.0 sweep's EXPECTED-BUT-ABSENT lines
rather than its exit code

[sweep run 35065490890](https://github.com/cayvox/musd-kit/actions/runs/35065490890) at the release commit
passed with `FALSE_VIABLE=0 FALSE_BLOCKED=0 NUMBERS=0` and `expected=0 unexpected=0`, and printed
`EXPECTED-BUT-ABSENT MK-079` for all ten registered indices: 209, 252, 329, 370, 449, 455, 486, 720, 817,
893. The 0.4.1 sweep reported those same ten as `EXPECTED MK-079`.

**Why they stopped reproducing, from the matcher rather than by inference.**
`packages/core/test/differential/expected.ts:56-63` matches an adjust case whose mismatch is
`FALSE_BLOCKED`, whose detail contains `ZERO_DEBT_INCREASE`, and whose generated debt is under 4 wei, so
that `adjustDebt = c.debt / 4n` is zero. The harness passed its legs verbatim to the preview and filtered
them on `> 0n` before sending, so the preview was asked about a zero debt increase while the chain was
asked for a pure top up. **MK-244 removed the disagreement**: a zero leg is no leg in the preview too, so
both halves now answer the same question and there is no mismatch to expect.

**Decided and fixed, not carried.** A registered expectation that cannot fire is not neutral: it is a
matcher that would absorb a future real `FALSE_BLOCKED` of that shape, and `expected.ts`'s own header says
that is the failure mode it exists to prevent. Carrying it would have been carrying a silencer.

**What changed.** `EXPECTED_MISMATCHES` is empty, so ANY mismatch now fails the sweep. The harness filter
that made the two calls differ is gone with it: `adjustCase` passed its legs verbatim to the preview and
filtered them on `> 0n` before sending, because the write path read PRESENCE until MK-244; both read values
now, so the legs are passed through unchanged and the shape cannot arise from that path at all. That is
MK-079 fixed at its cause rather than expected.

**The mechanism stays pinned.** `expected-mismatches.test.ts` drives `partitionMismatches` through a
FIXTURE copy of the retired entry, so "a registered mismatch does not fail the run, an unregistered one
does, and neither masks the other" is still asserted for the day someone registers the next one, and a new
test asserts the live list is empty and that the MK-079 shape now fails like anything else. Both mutation
entries on `partitionMismatches` still apply.

**MK-079's own row is left as it is**, open in the harness, until a full sweep at a tip carrying this change
reports no mismatch of that shape and no `EXPECTED-BUT-ABSENT` line. Ten indices disappearing from a sweep
that ran BEFORE the filter was removed is evidence about MK-244, not about this change.

---

## MK-255 · The deprecation chain sends readers to deprecated versions

**Class** S3, registry · **Status** open · **Found by** writing 0.4.0's second message for the 0.5.0
release

`npm deprecate` messages are served at install time, and each of ours ends by naming an upgrade target.
Three of the five targets are themselves deprecated: 0.1.0 points at 0.2.0, 0.2.0 at 0.3.0, and 0.3.0 and
0.3.1 at 0.4.0. Each was true when it was sent, and none was rewritten as the next release deprecated its
target, so a reader on 0.1.0 is walked to a version that warns at install and, since 0.4.0, to the same
MK-240 default draw they would be leaving 0.4.x to escape.

**0.4.0 is the one that was rewritten, and the reason it could not be left** is that its target, 0.4.1,
carries the identical MK-240 defect: the message would have moved a reader between two builds of the same
wrong figure. The rest of the chain is older and points at versions with different defects, which is
weaker but still wrong.

`packages/core/test/deprecation-message.test.ts` asserts that a message written now cannot name a
deprecated target, scoped to the 0.4.0 and 0.4.1 entries, and the comment says this finding is why it is
scoped rather than universal.

**CARRIED, deliberately, and this is what carrying it costs.** Closing it is eight registry writes, four
versions times two packages, and the wave that found it was told to publish nothing, tag nothing and
deprecate nothing. So it stays open with its cost stated rather than being done quietly against that
instruction.

The cost, precisely: a consumer installing `@musd-kit/core@0.1.0` today is told to upgrade to 0.2.0, which
warns at install and is wrong on two Recovery Mode surfaces (MK-058, MK-059); one on 0.2.0 is sent to
0.3.0, which is deprecated for MK-100; one on 0.3.0 or 0.3.1 is sent to 0.4.0, which carries the MK-240
default draw this release exists to remove. **Nobody is sent to a version that is not deprecated except
from 0.4.x.** It misleads rather than breaks: every message still names real defects in the version it is
attached to, and the register and the migration guides are correct.

**What would close it**: rewrite the 0.1.0, 0.2.0, 0.3.0 and 0.3.1 entries to point at 0.5.0, preserving
each previous text in the file as 0.4.0's is, then dispatch `deprecate.yml` once per version and verify each
with `scripts/deprecation-verify.mjs`, which MK-256's fix makes a re-deprecation safe to run. Then widen the
test from those two entries to every entry, which is the assertion that stops it recurring.

---

## MK-256 · The deprecation workflow reads its own write back through a cache, and calls a success a failure

**Class** S2, process · **Status** fixed · **Found by** deprecating 0.4.0 for the second time, during the
0.5.0 release

`.github/workflows/deprecate.yml` writes with `npm deprecate` and then verifies by reading
`npm view "@musd-kit/$p@$V" deprecated` and comparing it to the text it resolved. The read loop retries
twelve times for an EMPTY answer, which is the case where the version was not deprecated before, and does
not retry a NON EMPTY answer that is still the previous message. Re-deprecating a version that already
carries a message is exactly that case, and it happened for the first time here:
[run 35073470096](https://github.com/cayvox/musd-kit/actions/runs/35073470096) wrote 0.4.0's new message,
read back the MK-114 message it had carried since 2026-09-14, and exited 1.

**The write had succeeded.** Fetching `https://registry.npmjs.org/@musd-kit/core` directly, rather than
through `npm view`, returned the new text for both packages within a minute, matching
`node scripts/deprecation-message.mjs 0.4.0 <pkg>` byte for byte.

**And the obvious repair makes it worse.** Re-dispatching to get a green run
([run 35073568874](https://github.com/cayvox/musd-kit/actions/runs/35073568874)) failed with
`npm error code E422 Unprocessable Entity` from the registry, because the message was already what it was
being set to. So a correct deprecation can leave two red runs behind it and no green one, which is the
shape that teaches a reader to ignore this workflow's colour.

**Decided and fixed, not carried.** This is a verification that reads its own write through a cache and
then calls a success a failure; the next person's repair is to weaken the comparison, and a weakened
comparison here passes a version deprecated with someone else's text, which is MK-084 restored.

**What changed.** `scripts/deprecation-verify.mjs` reads the registry DOCUMENT rather than going through
`npm view`, and retries while the answer is the PREVIOUS text as well as while it is absent, saying which
state it is in on each attempt. `deprecate.yml` calls it instead of inlining the comparison, and its write
step now treats a failed `npm deprecate` as fatal ONLY when the registry does not already carry the exact
text being sent, which is the E422 case. `packages/core/test/deprecation-verify.test.ts` drives the loop
through the sequence the release actually saw, absent then the previous text then the intended one, and
`MK-256 retry` in `scripts/mutation/entries.mjs` puts the old rule back and watches two tests go red.

**Proven against the live registry, read only**: `node scripts/deprecation-verify.mjs 0.4.0` and `0.4.1`
both exit 0, matching on the first attempt, against the same state the workflow called a forgery.

---

## MK-257 · The post publish checks that only ran because someone remembered them

**Class** S2, process · **Status** fixed · **Found by** reporting the 0.5.0 release: the checks were run,
by hand, and the report said so

`verify-published.yml` proved that the published packages install and import, that the installed version is
the published one, that the file list matches the allowlist, and that the provenance names this repository.
Three further checks were run against 0.5.0 and none of them was in the job:

- the retired claims check over the PUBLISHED tarballs (MK-246), which reports 119 hits over published
  0.4.1 and 0 over 0.5.0;
- the provenance statement past its repository line: the workflow that built it, the ref, the subject and
  the commit;
- the README the registry SERVES against the README the tarball ships, which is what a person reads on
  npmjs.com before installing.

**Why that is a finding rather than a chore.** This repository has the same failure written down twice
already: MK-053, a verification job that existed for two releases without ever producing a verdict, and
MK-083, a runbook that documented commands nobody ran. A check that depends on someone remembering is a
habit, and a habit is not a gate. The 0.5.0 record itself says these three were run by hand, which makes
the next release's evidence depend on the next person reading that sentence.

**What changed.** Three steps in `.github/workflows/verify-published.yml`, each exiting non zero with a
`FAIL:` line rather than warning:

- `Check the provenance statement in full, against the registry` asserts the repository, the workflow path
  `.github/workflows/release.yml`, the ref `refs/heads/main` and the subject `pkg:npm/%40musd-kit/<pkg>@<version>`,
  and asserts the build commit when one is passed. `release.yml` now passes `${{ github.sha }}`, so a real
  release asserts it; a manual dispatch may omit it and the step reports the attested commit instead.
- `Compare the README the registry serves with the one in the tarball` fails on a sha256 difference and on
  a `latest` that is not the version being verified.
- `Check the published tarballs for claims a finding retired` runs `scripts/retired-claims.mjs` over both
  extracted tarballs.

**One consequence, stated rather than discovered later.** The retired claims entries come from the
checkout, so dispatching this job against a version published before a claim was retired fails, correctly:
over 0.4.1 the check reports 119 hits. The question the step asks is whether the artifact carries a
sentence this tree has since retired, and for an old release the answer is yes.

**Proven, not described**: dispatched against the published 0.5.0, run recorded in `docs/12-release-runbook.md`.

---

## Open questions and their answers

| # | Question | Answer |
|---|---|---|
| Q1 | Does the contracts package version we pin differ from the one Mezo's dApp resolves? | Closed. Across both testnet and mainnet deployment sets, no contract address changed between the two versions, including the hint helpers, sorted troves, and interest rate manager. What changed: proxy implementation targets behind three contracts, one removed function and one changed event signature on the trove manager, and a set of new functions on the PCV. The SDK touches none of those surfaces. |
| Q2 | Is the fee exempt set non empty on chain? | Closed. **Yes on mainnet, no on testnet.** At mainnet block 11330182 two accounts are fee exempt, out of four granted over the chain's history with two since removed; both are code free and neither matches any address the protocol is known to own. At testnet block 15043414 the set is empty. Established by a genesis to pin scan of `FeeExemptAccountAdded` and `FeeExemptAccountRemoved`, every granted address then re-checked against `isAccountFeeExempt` at the pinned block. This assigns MK-018 its class, S1. Recorded in `docs/09-review-and-validated-surface.md` §6. |
| Q3 | Which contract revision is ground truth? | Closed. The right question is which implementation sits behind each proxy on chain, and it now has an answer: at testnet block 15043414 and mainnet block 11330182, the EIP-1967 implementation behind every bundled proxy matches the deployment record in `@mezo-org/musd-contracts@1.1.0`, the version `packages/core/package.json` actually pins, on both chains. Six of the seven bundled addresses are proxies of that shape; `musd` has an empty implementation slot, so it is not a transparent proxy of that shape and there is nothing to compare. So the pinned package IS ground truth for the deployed code at those blocks. Recorded in `docs/09-review-and-validated-surface.md` §6. |
| Q4 | Does the SDK bundle a mainnet interest rate manager? | Yes. It is present in the source and in the published package, and matches both the contracts package deployment record and Mezo's own literal. No gap here. |
