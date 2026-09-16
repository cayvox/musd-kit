# Review, validated surface, and honest limits

This page answers three questions an integrator should ask before depending on `musd-kit`:
what has been independently checked, what exactly is validated and how, and where the SDK
diverges from the protocol or from how Mezo itself uses it.

It exists because 0.1.0 shipped under the banner "correctness is the product" while carrying
claims about its own testing that were aspirations rather than facts. Correcting that is part of
the fix, not a footnote to it.

## 1. What happened

The Mezo team reviewed `musd-kit` 0.1.0 as a three way differential: the SDK against the
`mezo-org/musd` Solidity protocol, and the SDK against Mezo's own production dApp, which has no
dependency on this SDK and is therefore an independent second opinion on the same math. We thank
them for the time. Their review found no fund loss path, no supply chain problem, and no error in
the core formulas. It found that the constraints and the inputs around those correct formulas were
incomplete, and that several statements this project made about its own testing were not true.

We accepted the findings, re-verified every one of them ourselves against public sources, added
findings we located during remediation, and recorded the result in
[`FINDINGS.md`](https://github.com/cayvox/musd-kit/blob/main/FINDINGS.md) with stable IDs. Tests
and commits cite those IDs.

We do not reproduce the reviewers' document here, and we do not cite non public source paths.
Everything in the register is restated in our own words against public ground truth.

## 2. Fitness for purpose

Stated plainly, and kept current. **This is the verdict at 0.4.1, which is published**: both packages
went to npm on **2026-09-14** from commit `ae93edd2644ea2a52963c5063d6596f7532f207f`, tagged `v0.4.1`,
by [release run 34863299631](https://github.com/cayvox/musd-kit/actions/runs/34863299631), with SLSA
provenance naming this repository and that commit. **0.4.0 is deprecated**
([run 34865168674](https://github.com/cayvox/musd-kit/actions/runs/34865168674)): its `previewRedeem`
read `maxIterations: 0n` as one eligible Trove while the contract reads zero as no limit, so it reported
less than a redemption redeems (MK-114). **0.3.0 and 0.3.1 remain deprecated**
([run 34820204101](https://github.com/cayvox/musd-kit/actions/runs/34820204101),
[run 34820259978](https://github.com/cayvox/musd-kit/actions/runs/34820259978)) for MK-100. Every S1 in
the register is closed at the released commit.

**The history this paragraph replaces, kept short.** The 0.3.0 verdict was written on a pull request
that was never merged and said every S1 was closed, which 0.3.1 falsified the same afternoon by
shipping with MK-100 open (MK-111). Since 0.4.0 the record is written in the release's own record pull
request. The 0.4.0 verdict said every S1 was closed, and that was true of the register: MK-114 was not
yet found. It was found by the mutation gate the wave after, which is the reason this paragraph names
what was known rather than what was true.

**The post publish gate ran twice for 0.4.1, and it is the check this verdict rests on.**
`verify-published` installs from npm into a clean project, imports both packages as ESM and CJS, checks
the file lists and the provenance. It passed in the release run and again when the `v0.4.1` tag push
re-entered the workflow ([run 34865250958](https://github.com/cayvox/musd-kit/actions/runs/34865250958)),
where the MK-055 guard skipped the publish. The artifacts were also verified from a clean directory
outside the repository; the record is `docs/12-release-runbook.md`, the 0.4.1 section.

| Use | Verdict |
|---|---|
| Reading positions and system state on testnet | Suitable |
| Previews and calculators for a position that does not exist yet | **Suitable for `previewOpen`, and for `drawForMargin` at a margin the caller chooses; never for opening at `getBorrowingPower`'s `ceiling`** (MK-100, MK-240). A Trove opened at `ceiling` was liquidatable within a second on a fork. **This row said `recommended` was suitable, from 0.4.0 to 0.5.0, and that verdict is withdrawn** (MK-240): its evidence was survival for an hour, and the name implied holding; over 86 days of mainnet prices its 2% margin was crossed within a week of 57.6% of sampled start times. `drawForMargin` is validated to survive the margin it is given, not any other. Every other S1 this verdict was waiting on is closed: MK-001, MK-002, MK-003, MK-004, MK-005, MK-006, MK-018, MK-019. A 1000 case differential sweep against real transaction outcomes, run end to end on this tree, found **zero FALSE_VIABLE**, which is the direction that costs a caller a failed transaction. Its ten FALSE_BLOCKED are one defect in the harness's own argument mapping (MK-079). **That row used to add "and implicate no `packages/*/src` file", which was false and is withdrawn** (MK-086): the same mis-mapping was in the shipped React adjust preview hook, which is MK-085, fixed in 0.3.0. The sweep could not have seen it, because it drives the core client and never renders a hook |
| Managing an existing trove: borrow, repay, adjust, refinance | **Suitable.** Every exposed write with a condition a preview can evaluate now has one, and prechecks it before sending (MK-042). That closes the limit this row carried through three revisions: it named two writes, then four, and now none. `claim` has no preview because `_claimCollateral` has no condition. The remaining limit is the fee cap, which is a protocol property rather than a gap here (MK-011) |
| Liquidation keepers | **Suitable on testnet.** MK-001 is closed: `isLiquidatable` is `ICR < MCR` with no Recovery Mode widening, which is what the protocol does |
| Real money on mainnet | **No.** Single author, unaudited, pre 1.0. Use it to evaluate, read, and prototype |
| Upgrading from 0.1.0 | **Do it, and read `docs/11-migration-0.1-to-0.2.md` first.** 0.1.0 returned wrong numbers on seven surfaces, three of them silently: `isLiquidatable` in Recovery Mode (MK-001), `redeem().fee` holding a rate (MK-014), and `previewOpen.meetsRecoveryRequirement` (MK-005). That page splits 0.1.0's defects into the ones that return wrong numbers and the ones that fail transactions |

**One open finding an integrator has to know about**, S2, and it is a protocol property rather than
something this SDK can fix. Stated where the API is documented, in `docs/03-core-api.md`:

- **MK-011, `maxFeePercentage` is advisory only.** The SDK checks it; it does not bind the contract.
  It is not slippage protection.
**And one closed in the same wave it was found, worth reading anyway.** MK-047: `previewOpen`
returned `viable: true` for an owner who already held a Trove, where the contract refuses with
`BorrowerOps: Trove is active` (`BorrowerOperations.sol:633`, `:1140-1149`). Fixed, along with the
generator hole that made a thousand sweep cases unable to reach it. Read it for what it says about
what a sweep proves, not for the defect.

- **MK-038 is now closed by MK-042**, and what it established remains true and is the thing to
  read: in normal mode a top-up that RAISES a position's ICR still reverts if the result is under
  MCR (`BorrowerOperations.sol:1201`, defined at `:1330-1335`), so an already under-water position
  cannot be partly rescued. The difference is that a caller can now ask before sending, and the
  answer carries `minimumCollateralToClearIcr`.

Every other open finding is S3 and is about this repository's own test suite, not about what the
SDK returns: MK-016, MK-022, MK-023, MK-024, MK-025, MK-026, MK-030, MK-034. **What carrying them
costs is a fork gate that is not reliably green on the first attempt**, which costs a contributor
re-runs and costs a reader some confidence in the signal. None of them changes an answer the SDK
gives.

What limits the blast radius, and is true today: the SDK has no approval flows at all, never
handles a key, and simulates every write before sending.

**What simulate before send does NOT limit, measured rather than assumed (MK-035):** it cannot
catch a condition that becomes true after the simulation, and it cannot catch the transaction
running out of gas, because the limit comes from an estimate taken before the mining block. The
same call's gas grew 16% in one traced execution. That growth is **observed once** and its log was
not preserved; the earlier wording, "varied 16% from identical state", read as a spread across a
sample and the sample's instrument was never committed (MK-039). Writes now ship a 25% margin and
`diagnoseRevertedWrite` classifies what still fails. The SDK no longer sends the simulation's own
request object unchanged: it sets an explicit gas limit on it, and nothing else.

## 3. Validated surface

The precise statement, replacing the earlier "validated twice" shorthand. A green suite is only
evidence for what it actually exercises.

**What the mutation gate adds to this table, and what it does not** (MK-112, `docs/07-testing.md` §4d).
A green full gate proves that every decision site in both packages has a reviewed status, that each
site's one generated mutant is caught by the project the register names, that every hand written
entry still mutates the code it was written for and is caught by a test that cites its finding, and
that every registered survivor is still not caught. **It proves nothing about the contract**: a test
asserting the wrong rule catches the mutant of the right rule just as well, which is MK-070's shape.
The rows below rest on the fork suite, the sweep and the live run, never on the gate. **It does not
prove every defect is caught**, only the one mutant each site gets. And the push path runs only the
unit mutants a change selects, so a green push is not a green full gate.

| Surface | How it is validated | Coverage |
|---|---|---|
| `computeICR`, `computeNICR` | Cross checked to the wei against the contract's own pure helpers on a fork of live Mezo | Full |
| `computeEntireDebt` | Cross checked against the contract's interest form | Full |
| `previewOpen` | Dual validated: against a fork of the real contracts, and against the contracts' pure helpers, and swept against real transaction outcomes | **Open path only** |
| `getBorrowingPower` | **This row used to be merged with `previewOpen`'s and claimed the same "dual validated", and that was not true of this half** (MK-067, MK-069). It was absent from the differential sweep, and its one fork check compared it against a reference implementation carrying the same defect, so the comparison could only agree (MK-070). Now: the solver's feasibility predicate IS `evaluateOpen`, so there is one implementation of the open rules rather than two; `borrowing-power-agreement.test.ts` pins the maximum viable and the maximum plus one wei not, in both modes and for an exempt account; `phase4` opens at the reported maximum ON CHAIN in Recovery Mode and asserts one wei more reverts; and the sweep now carries a `borrowingPower` op | **Validated that the contract accepts `ceiling`, and that a Trove opened at `drawForMargin`'s `draw` survives the margin it was asked for.** Every earlier check asked only whether the open succeeds; in normal mode a Trove at the ceiling is liquidatable within seconds (MK-100). `zz-borrowing-power-boundary.fork.test.ts` measures both after the open, and a price fall either side of the chosen margin at the end of the chosen horizon, a day; `borrowing-power-agreement.test.ts` pins `draw` as the boundary at the stressed price for each margin. **Until 0.5.0 this row validated `recommended` for "the stated window", an hour, which was true and was not the question a caller holding a position asks** (MK-240). **The previous claim is corrected rather than extended.** The rate is still governable, so the closed form's linearity premise is a property of today's deployment and is confirmed against a real `getBorrowingFee` on every call (MK-010) |
| `addCollateral`, `borrow`, `repay`, `withdrawCollateral`, `adjustTrove`, `refinance` | Fork exercised, not dual validated | **No preview validation.** For `addCollateral` and `repay`, MK-038 pins the gate they were documented as not having |
| `previewBorrow`, `previewRefinance` | Fork exercised end to end against the contract's own gates, plus exhaustive chain-free tests of the verdict as a pure function. **`previewBorrow` is now a projection of `previewAdjustTrove`** (MK-058), and the two are pinned to agree on verdict, reasons, binding constraint and every shared number in both modes across the MCR, CCR, TCR and capacity boundaries | **Verdict and fee validated; not yet compared against a reverting write for every reason.** Recovery Mode borrows were unreachable for the sweep until this wave, which is how MK-058, MK-059 and MK-065 survived a thousand cases |
| Insertion hints on every existing-trove write path | Pinned on a fork against `getNominalICR` after the write, including a repay at, below and above interest owed | Full for the paths exercised |
| The PACKAGED artifact, not the workspace | The packed tarball is installed into a scratch project and a consumer file is typechecked against it under four module configurations, plus ESM and CJS runtime imports | **Automated since the P17 wave**, as a CI step in the fork gate job (`pnpm gate:packaging`). This is what found MK-040, a broken `exports` map that a workspace typecheck cannot see because path mapping hides it. It was manual until MK-096, which is when the cost of that showed up: the gate's own consumer probe is a template literal, so no typecheck compiles it, and a breaking public shape change left it stale through an entire wave with every other gate green |
| Live testnet lifecycle, end to end | `scripts/testnet-e2e.ts`, **run against live Mezo testnet**, chain 31611, blocks 15163946 to 15164162. **20 surfaces exercised, 3 skipped**, each asserting the preview's verdict and numbers against what the chain did, and the redemption checked field by field against the authoritative `Redemption` event. The full ledger is `docs/13-live-testnet-ledger.md` | **It found MK-045, MK-046, MK-047 and MK-048**, none of which a fork can produce. Not reached: `liquidate` and `batchLiquidate` (need a Trove below MCR, uncreatable on live testnet) and `claim` (needs a surplus) |

| **`@musd-kit/react`, the hook layer** | Fork exercised (`hooks.fork.test.ts`, `phase9-app.fork.test.ts`) and, since the P17 wave, one RENDERED chain free test over `useAdjustTrovePreview` (`adjust-preview-hook.test.ts`) plus two mutations and a package wide guard against filling an absent optional | **Newly measured, and it was not measured before.** Until P17 no file under `packages/react/src` appeared in the coverage report, the mutation check had no React mutation, and the sweep never rendered a hook. MK-085 lived in that gap: a shipped hook that made every adjust preview a debt increase. Coverage now includes the package (MK-087) |

**The differential sweep does NOT cover the React hooks, and that is a property of what a
differential case is, not an oversight.** A case compares a preview's verdict against the outcome
of an executed transaction; the harness therefore drives `client.*` directly, because a hook adds
a React render and a TanStack cache between the two without changing either side of the
comparison. **The validated surface of the sweep is the core client.** The React layer is covered
by the fork hook tests and by the rendered unit test above, and by nothing else. This was implied
rather than stated until MK-087.

**The fork sweep and the live run prove different things, and the table lists them separately for
that reason.**

The sweep proves **breadth**: a thousand generated cases across **ten** operations, boundary
weighted, each snapshot isolated, comparing each swept preview's verdict against the chain outcome.
What it cannot prove is anything that depends on wall clock time passing, because anvil mines on
demand, anything its generator cannot construct, and anything not in the list.

**It runs, and the figures below were measured on this tree** (P15 wave, four slices, 116 minutes
of wall clock, 111 of it inside the sweep).
The P14 wave emptied this section on the strength of MK-078, which claimed the sweep could not be
run at all. **MK-078 is withdrawn**: it was a single unrepeated measurement taken while the upstream
RPC was failing, and anvil forks lazily from that RPC, so a degraded link looks exactly like a slow
harness. The same commands now complete in the documented time.

What the run DID find is MK-079, ten `FALSE_BLOCKED` from one defect in the harness's own argument
mapping. That is reported in the row below rather than smoothed away, because a sweep that reports
its own bugs as product bugs is worth less than one that reports nothing.

This line read "eight operations" for two waves after the list held nine, and the list held nine
while this section described `getBorrowingPower` as validated (MK-067, MK-069). A count that drifts
from the list it describes is MK-062's defect; a claim that covers a surface the list does not is
worse; and emptying a table on a finding that turned out to be a network fault is worse again, which
is what MK-078 cost.

The live run proves **reality**: one ordered lifecycle against the real deployment, the real oracle,
real gas, and other people's positions moving underneath. It is one path, not a thousand, and its
value is that the path is real.

**Every finding a fork structurally could not produce came from it**, and each names a different
thing a fork cannot be:

| Finding | What a fork cannot reproduce |
|---|---|
| MK-046 | **Elapsed time.** anvil mines on demand, so no wall clock passes between a write and the read after it, and the interest drift is always zero |
| MK-047 | **A state the generator could not build.** Every generated open case used a fresh account |
| MK-048 | **Other people's positions.** It needs a third party's Trove sitting within a few MUSD of the debt floor |
| MK-049 | **A moving oracle, on its own.** anvil holds the price still unless a test writes it, so no run met a hint gone stale by accident. MK-103 has since moved it deliberately between the hint and the send (`redeem-boundary.fork.test.ts`), which is what measured the band |
| MK-045 | Reproducible on a fork once looked for, and nobody looked until a real run had to leave an account clean |

That is the case for keeping the live run as a release gate rather than treating the sweep as
sufficient. A thousand cases against a fork and one ordered path against a real chain are not the
same evidence, and the second found four things the first could not.

**What the sweep's generator can and cannot construct**, which is the honest boundary of what a
thousand cases prove (MK-047):

| Precondition | Expressible? |
|---|---|
| No Trove, and no Trove, for every operation | **Yes, since MK-047.** `precondition: 'FRESH'` |
| A Trove is already open, for every operation | **Yes, since MK-047.** `precondition: 'OCCUPIED'` |
| Debt floor, ratio and capacity boundaries | Yes, the boundary band targets each threshold and jitters one wei either side |
| Recovery Mode | Yes, via the extreme band's price multipliers |
| Repay above the debt, withdrawal above the balance | Yes, via the extreme band |
| **Adding and withdrawing collateral in one call** | **No.** `adjustCase` never passes both legs, so `COLLATERAL_ADD_AND_WITHDRAW` is unreachable |
| **An adjustment that requests nothing** | **No.** `NO_CHANGE_REQUESTED` is unreachable |
| **A debt increase of zero** | **No.** `ZERO_DEBT_INCREASE` is unreachable |
| **A Trove closed rather than never opened** | **No.** Blocked by MK-045: the harness cannot close a seeded position, because it cannot obtain the fee |
| A redemption on either side of a Trove's headroom above the debt floor | **Yes, since MK-048.** `RedeemBand`: `WITHIN_HEADROOM`, `AT_HEADROOM`, `IN_THE_GAP`, `AT_NET_DEBT`, `WHOLE_TROVE`, computed from the REAL first eligible Trove at run time. `AT_NET_DEBT` was added after the sweep caught the preview putting the upper edge one accrual too low |
| **A moving oracle between a hint and a block** | **Not in the generator.** This row said it could not be expressed on a fork at all, and that was wrong: the oracle is a shim whose answer the harness writes (`test/harness/oracle.ts`), and MK-103's fork proof moves it by fractions of the reported tolerance between the hint and the send. The sweep's generator still does not |
| **A preview figure that accrues between the read and the block it lands in** | **Yes for redemption, since the MK-048 correction.** `AT_NET_DEBT` offers exactly the figure as read, which the chain refuses. **No for `previewClose.musdRequired`**: `closeCase` funds an account from the seeding open, so it has never held exactly the reported figure, which is how MK-050 survived. Repayment was checked from source and is not exposed |

**This list is a work queue, not a disclaimer.** It has produced two findings, MK-047 and MK-048,
and each was closed by teaching the generator the state FIRST and fixing the code second. The rows
still marked **No** are the next candidates.

The first three are input validation the SDK also prechecks. The fourth is blocked by a protocol
property rather than an oversight. The oracle row said it cannot be closed at all, because the fork's
oracle does not move on its own; it does not need to, because a test can move it, and MK-103 did. **Any
operation whose precondition the generator cannot construct is untested no matter how many cases
run.**

**The last row is the newest and the one that cost the most.** MK-048's upper edge was derived from
source, then measured with `simulateContract`, and the measurement agreed. It agreed because an
`eth_call` mines no block, so no interest accrues, so a figure read at the head is still exact when
the call runs. A real send accrues first and then reads. **A simulation and a send are not the same
experiment against a contract that mutates state before it reads it**, and every quantity this SDK
reports which a caller then hands back to the chain is exposed to that difference. Redemption is
now covered by a band; the two named above are not, and that is a live entry rather than a closed
one.
| Preview verdict against actual transaction outcome, swept | **Reproducible:** `MK_DIFF_CASES=1000 MK_DIFF_SEED=20260826 pnpm test:fork`, four slices of 250 via `MK_DIFF_FROM` and `MK_DIFF_TO`, a fresh anvil each at pinned block 15043414. Measured on THIS tree in the P15 wave, ten operations, **116 minutes of wall clock across the four slices, 111 of it inside the sweep** (each invocation also runs the rest of the fork suite). Sweep durations: `0..250` 1593s ran=250 skipped=20; `250..500` 1697s ran=250 skipped=25; `500..750` 1719s ran=250 skipped=26; `750..1000` 1648s ran=250 skipped=26. **Totals: 1000 ran, 97 skipped, FALSE_VIABLE=0, FALSE_BLOCKED=10, NUMBERS=0, threw=0.** Bands boundary=580 extreme=214 middle=206, which is the 60/20/20 weighting. Recovery Mode reached 254 of 1000; per operation, executions in Recovery Mode were open=39, refinance=28, adjust=28, addCollateral=25, withdrawCollateral=24, repay=22, borrow=20, close=20, borrowingPower=15, **redeem=0 (26 skipped)**. Recovery Mode BORROWS by band: boundary=8, extreme=9, middle=3. Redemption bands ran/skipped: AT_NET_DEBT 13/12, WITHIN_HEADROOM 11/11, WHOLE_TROVE 11/9, AT_HEADROOM 9/10, IN_THE_GAP 8/5. It does NOT reach liquidation or claim, which have no preview to compare | **The four slices exited 1 when this was measured, and the reason is the harness rather than the SDK (MK-079).** They exit 0 as of the P16 wave, which did not fix the defect: MK-079 is registered in `packages/core/test/differential/expected.ts`, so those ten print as `EXPECTED MK-079` lines and only a mismatch no finding explains fails the run. All ten FALSE_BLOCKED are one defect: `adjustCase` passes its legs verbatim to the preview and filters them on `> 0n` before the write, so for an `adjust` case whose generated debt is under 4 wei the preview is asked about a zero debt increase (correctly `ZERO_DEBT_INCREASE`) while the chain is asked for a pure collateral top-up (correctly accepted). Ten tuples, one cause, no `packages/*/src` file implicated. **`FALSE_VIABLE=0` is the direction that would cost a user a failed transaction, and it is zero across all 1000.** **A band that never ran proves nothing**, so every count above is printed rather than summarised: `redeem` executed in Recovery Mode zero times out of 26 such cases, so this sweep says nothing about that combination. `threw=0` matters too, since throws are counted and never fatal, so a sweep can exit 0 with cases that never reached the chain |
| Borrowing capacity ratchet, `min(current, recalculated)` on a collateral decrease | **Observed executing**, P8: capacity `140092922400000000000000` at open, unchanged after a price rise, `70046461200000000000000` after withdrawing half the collateral | Full. The obligation is discharged (MK-002) |
| Fee exemption on the DEBT INCREASE path, not just on open | **Observed executing**, P8: an exempt account borrowing against an existing position, `quotedFee=2000000000000000000`, `preview.fee=0`, principal added exactly the draw | Full. The obligation is discharged (MK-018) |
| Preview verdict against actual transaction outcome | The differential harness: generated cases run the preview, then attempt the operation, then compare. Seeded, boundary weighted, snapshot isolated per case | See the sweep row below. This is the gate the "open path only" row above was waiting for |
| Deployment identity: code at all seven addresses, fourteen cross wiring pointers, `HintHelpers.priceFeed()` unset | Chain-free against a constructed lookalike and a bent pointer, plus the real deployment on a fork, and gated before the first write | Full for the pointer set `docs/09` §6 records; the "has code but is not the one the deployment points at" case is pinned chain free only (MK-008) |
| One block snapshot for `getTrove`, `getSystemState`, `isLiquidatable` | Fork exercised: blocks are mined after the read, then `icr` and `price` are reconciled at the REPORTED block | Full for those three. **Nine public functions evaluate against a price read in a separate round trip, and make no single block claim** (MK-013): eight distinct read sites, since `previewBorrow` and `previewWithdrawCollateral` inherit `previewAdjustTrove`'s. This row said four for two waves after `previewAdjustTrove`, `maxWithdrawableCollateral`, `previewClose` and `previewRedeem` were added; the full list, with the line of each read, is now in `docs/03-core-api.md` §2 |
| `getBorrowingPower` closed form against the live fee | Fork exercised: affinity of `getBorrowingFee` asserted at the live rate, the closed form compared to the search to the wei, and the search kept as the fallback. **The search it is compared against carried MK-067's defect until the P13 wave**, so that comparison agreed by construction; it now states the contract's fee condition itself | **Full at the CURRENT rate only.** The rate is governable, so affinity is a property of today's implementation, not a guarantee (MK-010) |
| Simulate before send, as a limit on blast radius | Fork exercised on every write; the limits are now MEASURED rather than assumed | **Partial, and the gap is quantified.** It catches every condition true at simulate time. It does NOT catch a condition that becomes true afterwards, nor gas exhaustion, because the limit comes from an estimate taken before the mining block. Measured: 16.4% growth in one traced case against a limit that realised only 1.5% over the gas it used, **observed once** (a realised headroom, not the 25% requested over the estimate; it was thin because MK-037 was dropping the request); and up to 10.16% across paths, which is **unestablished**, its instrument having never been committed (MK-035, MK-039) |
| Gas margin on writes, 25% over the estimate | **Provenance split.** The traced 16.4% growth that justifies it is **observed once, unlinked**. The per path spread table it was cross checked against is **unestablished**: 12 attempts per path, instrument never committed (MK-039). Pinned by a findings test that flipped when the fix landed, and by `MK_GAS_LAB=1 pnpm test:fork` | The margin stands on the traced growth alone, which clears it by half again. The nine path table is kept for the derivation, not as evidence. `claim` is unmeasured, it sends no transaction without a surplus (MK-035) |
| Telling an out of gas revert from a protocol one | `diagnoseRevertedWrite`, from evidence a consumer has without tracing | **Two of three cases decidable.** `gasUsed === gasLimit` and a still reverting replay are conclusive; everything else is `INDETERMINATE`, because a nested exhaustion leaves gas at the top level and a replay runs against end of block state. Separating those needs `debug_traceTransaction` (MK-035) |
| `@musd-kit/react`, the whole published hook layer | Rendered chain free with React Testing Library for every read and write hook (`hooks-rendered.test.ts`, `adjust-preview-hook.test.ts`): the arguments each forwards, the stale data behaviour (MK-102), the account default (MK-106) and the write reset; plus fork exercised against a fork-backed wagmi config | **Measured by the coverage gate since MK-087, with its own floor since this wave** (`vitest.config.mts`). This row said the React package was not measured at all for two waves after it was (MK-109) |

Read the **open path only** row twice. Until the differential harness lands, a preview being green
is not evidence that the corresponding write succeeds.

That row is also the clearest lesson this project has learned about its own testing, so it is worth
stating outright rather than leaving to be inferred:

> **A gate that covers only the case where two quantities coincide cannot tell you which one was
> meant.**

That is exactly why the dual validation gate could never have caught MK-006. Every insertion hint
was computed from the ENTIRE debt, while `SortedTroves` sorts by PRINCIPAL. At open those two
quantities are equal, because no interest has accrued yet, so the one path the gate covered was the
one path where the distinction is invisible. The gate was green, repeatedly, on a value that was
right by coincidence. It stayed green while every write path against an existing Trove placed hints
by a number the contract does not sort by, and it survived into a published release.

The generalisation, which is what makes it worth writing down: when validation is scoped to a
single case, check whether that case is degenerate before trusting the result. A boundary where two
inputs happen to be identical is the worst possible place to test a rule that distinguishes them.

The two rows marked **owed** are obligations on that harness, not footnotes. Both are branches the
P3a wave implemented from the Solidity and could not drive on a fork: the capacity ratchet needs a
collateral withdrawal that lowers the recalculated value below the stored one, and the exempt fee
skip on a debt increase needs an exempt account that already holds a Trove. They are listed here so
the harness is designed to reach them, rather than being built first and pointed at them after.

### Provenance of every number on this page

Audited against step 10 of the wave checklist (`docs/08-conventions.md`): **a measurement is citable
only if the code that produced it is committed and someone else can run it, with the command
recorded.** The audit covered this page and `FINDINGS.md` together; the full classification, with
every claim named, is under **Provenance of the numbers in this register** at the top of
`FINDINGS.md`.

| Class | Count | On this page |
|---|---|---|
| **Reproducible** | 18 | the 1000 case sweep, the per operation sweeps, the coverage floors, every §6 on chain fact, the gas variance fixtures. The 1000 case sweep left this class in the P14 wave and **returns to it in P15**, having been run end to end on this tree; MK-078, which removed it, is withdrawn |
| **Observed once** | 5 | CI runs, each pinned by its run ID |
| **Observed once, unlinked** | 3 | the traced redemption growth, and two probes from the MK-037 wave |
| **Unestablished** | 8 | led by MK-035's nine path spread table, whose instrument was never committed |

**No number was deleted and no finding was softened.** Where the evidence turned out weaker than the
text read, the entry now says which part is evidence and which part is not. The clearest case is the
gas margin: the traced growth that justifies it is real and unrepeatable, the isolation rate built on
top of it is not established, and the two now carry different labels in the same entry.

**Every §6 fact on this page is machine written** by `pnpm facts --stdout` at the block named beside
it, which is why that whole section is reproducible without qualification. **Re-run at 0.2.0 release
preparation, it regenerated byte identically**, second provider confirmation included: no governable
value moved, so nothing on this page invalidates a test expectation or a documented number.

## 4. Three way divergence matrix

Whether a gap is shared with Mezo's own dApp materially changes how damning it is. We record both
honestly, including the cases that are exculpatory for us.

| Finding | Protocol | Mezo's dApp | musd-kit | Verdict |
|---|---|---|---|---|
| MK-001 Recovery Mode liquidatability | Only `ICR < MCR` liquidates | Correct | Adds a rule the protocol does not have | SDK uniquely wrong |
| MK-002 Borrowing capacity | Hard on chain gate | Models it as load bearing | Absent | SDK uniquely wrong |
| MK-003 Refinancing fee | Charged and capitalized | Modeled | Absent | SDK uniquely wrong |
| MK-004 Recovery Mode fee skip | Fee skipped | Gap **as reported to us**, see the caveat below | **Modeled everywhere the SDK decides it**, since the P13 wave: `previewOpen`, `previewAdjustTrove`, `getBorrowingPower`, and all four write paths, each through the one exported rule in `math/fee.ts`. **Before P13 this row said "Modeled" and meant `previewOpen` alone**, while `getBorrowingPower` (MK-067) and `openTrove` (MK-068) still charged it | **No longer shared, and now true of the whole surface rather than of one function** |
| MK-018 Fee exemption | Zeroes the fee | Gap **as reported to us**, see the caveat below | **Modeled** on open, on the debt increase branch, on refinance, and, since the P13 wave, in `getBorrowingPower`, which previously took no account and so could not express exemption at all (MK-067) | **No longer shared**, with the same correction as the row above: it was true of two surfaces and stated as if it were true of the SDK |
| MK-005 Open time TCR constraint | Enforced | Enforced in practice by the contract | **Previewed.** `previewOpen` returns `resultingTcr` and a `TCR_BELOW_CCR` reason | Closed |

**A caveat on the middle column, and it matters.** Everything this table says about Mezo's own dApp
comes from the external review, not from us reading their code. We have never opened it. The two
rows above changed from "shared gap" to "no longer shared" because **our** side changed and is
verified on a fork; whether their side has since changed we do not know and cannot claim. Read that
column as "as reported to us at review time", not as a current statement about their software.

## 5. Claims and reality

Every claim this project makes about itself, with its status. A row moves to "true" only when a
check in CI makes it true.

Every row ends at **true** or **corrected**. None points at an open finding: the point of this
table is that a reader can trust it without cross referencing the register.

| Claim | Status |
|---|---|
| Coverage floor enforced in CI | **True.** `vitest.config.mts` `coverage.thresholds`, enforced on every push by the fork gate. Floors are **94 statements / 92 branches / 88 functions / 94 lines**, over **both published packages**. This row read `98 / 91 / 99 / 98` until the P17 wave, which was stale on the branch metric and, more importantly, was measuring `packages/core/src` alone: `packages/react/src` was outside the glob (MK-087). Widening it moved three floors down, which is a wider scope and not a lowered ratchet; the core half measured 98.65 / 93.20 / 100 / 98.65 in the same run |
| Fork pinned to a block for determinism | **True.** `MEZO_FORK_BLOCK` in `.github/workflows/ci.yml`, read by the harness. **With a stated limit:** pinning is not order independence, and the fork project is still one stateful sequence (MK-016) |
| Fork price pinned with the block | **True.** The oracle shim is seeded from the pinned block, and the seeded answer is byte identical across runs |
| CI matrix across Node versions | **True.** 20, 22 and 24, resolving to v20.20.2, v22.23.2 and v24.19.0, measured from a run rather than assumed |
| Post publish install verification | **True, and it was corrected the other way first.** This row read "not verified, publishing is out of bounds for this programme" for two revisions after both of its clauses stopped being true: 0.2.0 was published on 2026-08-28, and `verify-published.yml` was repaired and RUN against it, passing on every axis (MK-053). The row outlived its own premise, which is the defect MK-061 is filed for |
| Unit layer runs with no chain | **True**, and proven in process on every wave: `anvil` off `PATH` and `MEZO_TESTNET_RPC_URL` unset. **16 files, 256 tests** as of the MK-058 wave. The count is stated as of a wave rather than as a standing fact, because the previous wording said 8 and was two waves out of date (MK-061) |
| Live data never re-derived | **Corrected.** Five of `getTrove`'s fourteen fields are derived in TypeScript from contract getters: `entireDebt`, `isLiquidatable`, `exists`, `liquidationPrice`, `healthFactor`. Nine are read. The README lists both sides. None re-implements protocol logic, and the SDK never recomputes debt or interest itself (MK-015) |
| Validated twice | **Corrected.** Replaced by §3, which states coverage per surface including what it does not cover |
| Simulate before send prevents failed writes | **Corrected.** It prevents every failure whose condition holds at simulate time, and neither a race nor gas exhaustion (MK-035). §2 states the limit with the measurement |
| Previews cover the trove lifecycle | **True since MK-042, after being corrected three times while it was false.** It first read as covering the lifecycle when three writes had a preview; the first correction named `withdrawCollateral` and `adjustTrove` as the gap; MK-038 showed the gap was four writes; and the "ten of eleven" it then carried could not be reconstructed from the tree at all, which is the third correction (MK-061). Counted from `createMusdClient`'s own surface: **nine of the twelve exposed writes have a preview.** The three that do not are `claim`, which has no condition to preview, and `liquidate` and `batchLiquidate`, which are permissionless and whose predicate is `isLiquidatable` rather than a preview. The history is kept because a table that hides its own revisions is the thing this page exists to avoid |

## 6. On chain facts

Ground truth is not a memory of a value, it is a value read at a known block. This section is
generated by `scripts/onchain-facts.ts` and regenerated whenever it is cited. Values are recorded
with chain id and block number, because every one of them is governable and can change.

<!-- BEGIN ONCHAIN FACTS: generated, do not edit by hand -->

Generated by `scripts/onchain-facts.ts` (`pnpm facts`). Do not edit by hand.

Every value carries the chain id and the block it was read at, because every one of them
is governable and can change without notice. A value without a block number is a memory,
not a fact. Regenerate before any release.

### Mezo testnet (chain id 31611)

Read at block **15043414**. Every value below is governable unless it
is marked as a contract constant, so it is a fact about that block and not a
permanent property of the protocol.

Contracts package pinned by this repository: `1.1.0`.

#### Governable values and constants

| Value | Read at the pinned block | Note |
|---|---|---|
| `minNetDebt()` | `1800000000000000000000` (1800) |  |
| `interestRate()` | `100` bps (1%) |  |
| `borrowingRate()` | `1000000000000000` (0.001) |  |
| `redemptionRate()` | `7500000000000000` (0.0075) |  |
| `getRedemptionRate(0.01 BTC)` | `75000000000000` (0.000075) | returns a fee AMOUNT in BTC wei, not a rate, despite the name |
| `getRedemptionRate(0.1 BTC)` | `750000000000000` (0.00075) | returns a fee AMOUNT in BTC wei, not a rate, despite the name |
| `getRedemptionRate(1 BTC)` | `7500000000000000` (0.0075) | returns a fee AMOUNT in BTC wei, not a rate, despite the name |
| `getBorrowingFee(1,800 MUSD)` | `1800000000000000000` (1.8) |  |
| `getBorrowingFee(10,000 MUSD)` | `10000000000000000000` (10) |  |
| `getBorrowingFee(100,000 MUSD)` | `100000000000000000000` (100) |  |
| `refinancingFeePercentage()` | `20` (20% of the pre-fee debt) |  |
| `MCR()` | `1100000000000000000` (1.1) | matches the SDK bundled constant |
| `CCR()` | `1500000000000000000` (1.5) | matches the SDK bundled constant |
| `MUSD_GAS_COMPENSATION()` | `200000000000000000000` (200) | matches the SDK bundled constant |

Every SDK bundled constant compared here matches its on chain value.

#### Cross wiring

| Value | Read at the pinned block | Note |
|---|---|---|
| `TroveManager.sortedTroves()` | `0x722E4D24FD6Ff8b0AC679450F3D91294607268fA` | matches bundled sortedTroves |
| `TroveManager.borrowerOperations()` | `0xCdF7028ceAB81fA0C6971208e83fa7872994beE5` | matches bundled borrowerOperations |
| `TroveManager.interestRateManager()` | `0xD4D6c36A592A2c5e86035A6bca1d57747a567f37` | matches bundled interestRateManager |
| `TroveManager.priceFeed()` | `0x86bCF0841622a5dAC14A313a15f96A95421b9366` | matches bundled priceFeed |
| `TroveManager.musdToken()` | `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` | matches bundled musd |
| `BorrowerOperations.troveManager()` | `0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0` | matches bundled troveManager |
| `BorrowerOperations.interestRateManager()` | `0xD4D6c36A592A2c5e86035A6bca1d57747a567f37` | matches bundled interestRateManager |
| `BorrowerOperations.priceFeed()` | `0x86bCF0841622a5dAC14A313a15f96A95421b9366` | matches bundled priceFeed |
| `BorrowerOperations.musd()` | `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` | matches bundled musd |
| `HintHelpers.troveManager()` | `0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0` | matches bundled troveManager |
| `HintHelpers.sortedTroves()` | `0x722E4D24FD6Ff8b0AC679450F3D91294607268fA` | matches bundled sortedTroves |
| `HintHelpers.borrowerOperations()` | `0xCdF7028ceAB81fA0C6971208e83fa7872994beE5` | matches bundled borrowerOperations |
| `HintHelpers.priceFeed()` | `0x0000000000000000000000000000000000000000` | inherited from LiquityBase and never assigned by `setAddresses`, so zero is correct, not a wiring gap |
| `SortedTroves.troveManager()` | `0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0` | matches bundled troveManager |
| `SortedTroves.borrowerOperationsAddress()` | `0xCdF7028ceAB81fA0C6971208e83fa7872994beE5` | matches bundled borrowerOperations |
| `MUSD.symbol()` | `MUSD` |  |
| `MUSD.decimals()` | `18` |  |
| `PriceFeed.oracle()` | `0x7b7c000000000000000000000000000000000015` | the BTC/USD source, not part of the bundled map |

Every pointer that exists resolves to the bundled address.

#### Code and proxy implementations

| Value | Read at the pinned block | Note |
|---|---|---|
| `borrowerOperations` | `0xCdF7028ceAB81fA0C6971208e83fa7872994beE5` | code present, 1159 bytes |
| `troveManager` | `0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0` | code present, 1159 bytes |
| `sortedTroves` | `0x722E4D24FD6Ff8b0AC679450F3D91294607268fA` | code present, 1159 bytes |
| `hintHelpers` | `0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6` | code present, 1159 bytes |
| `priceFeed` | `0x86bCF0841622a5dAC14A313a15f96A95421b9366` | code present, 1159 bytes |
| `interestRateManager` | `0xD4D6c36A592A2c5e86035A6bca1d57747a567f37` | code present, 1159 bytes |
| `musd` | `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` | code present, 6437 bytes |

| Value | Read at the pinned block | Note |
|---|---|---|
| `borrowerOperations` | `0xc05Bf344BD5b58825784326dD3112fB6cC160dcC` | matches the 1.1.0 record |
| `troveManager` | `0x9aAB567966983e95536FC460C12266FB0Cc10B07` | matches the 1.1.0 record |
| `sortedTroves` | `0x9177DF58A9614b84C8c2F68dF27506AB9a5d0323` | matches the 1.1.0 record |
| `hintHelpers` | `0x8adF3f35dBE4026112bCFc078872bcb967732Ea8` | matches the 1.1.0 record |
| `priceFeed` | `0xec42B37C12b8D73d320f4075A1BCd58B306629c1` | matches the 1.1.0 record |
| `interestRateManager` | `0xAA13B1d9CFFA3F44ab3A8BE0dC8774FB7841459C` | matches the 1.1.0 record |
| `musd` | slot empty | not a transparent proxy of the EIP-1967 shape, so there is no implementation to compare |

Every implementation found matches the pinned package deployment record.

#### Fee exemption (MK-018)

`GovernableVariables` at `0x6552059B6eFc6aA4AE3ea45f28ED4D92acE020cD`.
Events read from the deployed ABI: `FeeExemptAccountAdded`, `FeeExemptAccountRemoved`. Getter: `isAccountFeeExempt`.

Range scanned: blocks **0 to 15043414**, the whole chain up to the pin, in 1505 chunks of 10000. Genesis to the pinned block, so the scan cannot have missed an earlier grant.

Events found: 0 add, 0 remove. Every address ever added was then re-checked with `isAccountFeeExempt` at the pinned block, so a removal is confirmed by the contract rather than inferred from event pairing.

**The fee exempt set is empty at this block.** No address is fee exempt on this chain as of block 15043414.

**Single provider result.** `MEZO_TESTNET_RPC_URL_SECOND` is not set, so the result rests on one provider. No account was ever granted exemption on this chain, so there were no getter answers to confirm; what rests on the single provider here is the log scan itself.

### Mezo mainnet (chain id 31612)

Read at block **11330182**. Every value below is governable unless it
is marked as a contract constant, so it is a fact about that block and not a
permanent property of the protocol.

Contracts package pinned by this repository: `1.1.0`.

#### Governable values and constants

| Value | Read at the pinned block | Note |
|---|---|---|
| `minNetDebt()` | `1800000000000000000000` (1800) |  |
| `interestRate()` | `100` bps (1%) |  |
| `borrowingRate()` | `1000000000000000` (0.001) |  |
| `redemptionRate()` | `7500000000000000` (0.0075) |  |
| `getRedemptionRate(0.01 BTC)` | `75000000000000` (0.000075) | returns a fee AMOUNT in BTC wei, not a rate, despite the name |
| `getRedemptionRate(0.1 BTC)` | `750000000000000` (0.00075) | returns a fee AMOUNT in BTC wei, not a rate, despite the name |
| `getRedemptionRate(1 BTC)` | `7500000000000000` (0.0075) | returns a fee AMOUNT in BTC wei, not a rate, despite the name |
| `getBorrowingFee(1,800 MUSD)` | `1800000000000000000` (1.8) |  |
| `getBorrowingFee(10,000 MUSD)` | `10000000000000000000` (10) |  |
| `getBorrowingFee(100,000 MUSD)` | `100000000000000000000` (100) |  |
| `refinancingFeePercentage()` | `20` (20% of the pre-fee debt) |  |
| `MCR()` | `1100000000000000000` (1.1) | matches the SDK bundled constant |
| `CCR()` | `1500000000000000000` (1.5) | matches the SDK bundled constant |
| `MUSD_GAS_COMPENSATION()` | `200000000000000000000` (200) | matches the SDK bundled constant |

Every SDK bundled constant compared here matches its on chain value.

#### Cross wiring

| Value | Read at the pinned block | Note |
|---|---|---|
| `TroveManager.sortedTroves()` | `0x8C5DB4C62BF29c1C4564390d10c20a47E0b2749f` | matches bundled sortedTroves |
| `TroveManager.borrowerOperations()` | `0x44b1bac67dDA612a41a58AAf779143B181dEe031` | matches bundled borrowerOperations |
| `TroveManager.interestRateManager()` | `0x4a453700d157717Fe02fB62E7700ED7845048285` | matches bundled interestRateManager |
| `TroveManager.priceFeed()` | `0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88` | matches bundled priceFeed |
| `TroveManager.musdToken()` | `0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186` | matches bundled musd |
| `BorrowerOperations.troveManager()` | `0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193` | matches bundled troveManager |
| `BorrowerOperations.interestRateManager()` | `0x4a453700d157717Fe02fB62E7700ED7845048285` | matches bundled interestRateManager |
| `BorrowerOperations.priceFeed()` | `0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88` | matches bundled priceFeed |
| `BorrowerOperations.musd()` | `0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186` | matches bundled musd |
| `HintHelpers.troveManager()` | `0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193` | matches bundled troveManager |
| `HintHelpers.sortedTroves()` | `0x8C5DB4C62BF29c1C4564390d10c20a47E0b2749f` | matches bundled sortedTroves |
| `HintHelpers.borrowerOperations()` | `0x44b1bac67dDA612a41a58AAf779143B181dEe031` | matches bundled borrowerOperations |
| `HintHelpers.priceFeed()` | `0x0000000000000000000000000000000000000000` | inherited from LiquityBase and never assigned by `setAddresses`, so zero is correct, not a wiring gap |
| `SortedTroves.troveManager()` | `0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193` | matches bundled troveManager |
| `SortedTroves.borrowerOperationsAddress()` | `0x44b1bac67dDA612a41a58AAf779143B181dEe031` | matches bundled borrowerOperations |
| `MUSD.symbol()` | `MUSD` |  |
| `MUSD.decimals()` | `18` |  |
| `PriceFeed.oracle()` | `0x7b7c000000000000000000000000000000000015` | the BTC/USD source, not part of the bundled map |

Every pointer that exists resolves to the bundled address.

#### Code and proxy implementations

| Value | Read at the pinned block | Note |
|---|---|---|
| `borrowerOperations` | `0x44b1bac67dDA612a41a58AAf779143B181dEe031` | code present, 1159 bytes |
| `troveManager` | `0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193` | code present, 1159 bytes |
| `sortedTroves` | `0x8C5DB4C62BF29c1C4564390d10c20a47E0b2749f` | code present, 1159 bytes |
| `hintHelpers` | `0xD267b3bE2514375A075fd03C3D9CBa6b95317DC3` | code present, 1159 bytes |
| `priceFeed` | `0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88` | code present, 1159 bytes |
| `interestRateManager` | `0x4a453700d157717Fe02fB62E7700ED7845048285` | code present, 1159 bytes |
| `musd` | `0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186` | code present, 6436 bytes |

| Value | Read at the pinned block | Note |
|---|---|---|
| `borrowerOperations` | `0x501670bBBE2EC8c11449C28C0C9e6677D5eA9B61` | matches the 1.1.0 record |
| `troveManager` | `0xdcFdAB0dEA52e5EFc8400283D46Fd0D122a519e9` | matches the 1.1.0 record |
| `sortedTroves` | `0x19868D388668A8e248784E78b0C644b517feBaAE` | matches the 1.1.0 record |
| `hintHelpers` | `0x82AB5F02993bF312d9acA03157f26FeBEBc76108` | matches the 1.1.0 record |
| `priceFeed` | `0xE9cA1ABe343515312Eb6D13178C5A2DCE3c036fA` | matches the 1.1.0 record |
| `interestRateManager` | `0xF83B2E2F8Cd39Df2fB71e5dC5297A6Fc3C0B2dd3` | matches the 1.1.0 record |
| `musd` | slot empty | not a transparent proxy of the EIP-1967 shape, so there is no implementation to compare |

Every implementation found matches the pinned package deployment record.

#### Fee exemption (MK-018)

`GovernableVariables` at `0x560AC4Ea44Fb7EB2D4d3c00608CB1CAb2613d389`.
Events read from the deployed ABI: `FeeExemptAccountAdded`, `FeeExemptAccountRemoved`. Getter: `isAccountFeeExempt`.

Range scanned: blocks **0 to 11330182**, the whole chain up to the pin, in 1134 chunks of 10000. Genesis to the pinned block, so the scan cannot have missed an earlier grant.

Events found: 4 add, 2 remove. Every address ever added was then re-checked with `isAccountFeeExempt` at the pinned block, so a removal is confirmed by the contract rather than inferred from event pairing.

**The fee exempt set is NOT empty: 2 account(s).**

2 further account(s) were granted exemption at some point and are not exempt at the pin, so the mechanism is actively administered rather than merely deployed.

**What kind of accounts these are.** Of the 2 exempt at this block, 0 have non empty code and 2 have none, and 0 match an address known to the protocol, checked against 37 addresses drawn from every deployment record in the pinned contracts package, proxies and implementations alike, plus every address the SDK bundles. Across all 4 accounts ever granted: 0 with code, 4 without, 0 matching a known protocol address. Unmatched means only that: it is not evidence of who owns an account, and nothing here infers ownership.

The individual addresses are deliberately not listed here. The count, the scanned range and the characterization above are what the severity rests on, and anyone can reproduce the addresses themselves by running `pnpm facts` against the same pinned block.

**Confirmed against a second, independent provider.** All 4 historically granted account(s) were re-read with `isAccountFeeExempt` at the same pinned block through a different endpoint, and every answer agreed.

<!-- END ONCHAIN FACTS -->

## 7. Reporting a problem

Correctness reports are as welcome as security reports. See
[`SECURITY.md`](https://github.com/cayvox/musd-kit/blob/main/SECURITY.md). If you
find something this page or the register does not cover, that gap is itself the finding, and we
want to hear about it.
