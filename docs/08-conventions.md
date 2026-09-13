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
- **Commit identity, a standing rule since 2026-09-13.** Every commit is authored AND committed as
  `Cayvox Labs <info@cayvox.com>` and carries a Developer Certificate of Origin sign-off
  (`git commit -s`, which writes `Signed-off-by: Cayvox Labs <info@cayvox.com>`). **Commits carry
  no AI attribution of any kind**: no `Co-Authored-By` trailer naming a model or a tool, and no
  "generated with" line. Pull request titles and bodies follow the same rule, because a merge can
  carry either into history. The identity is the one GitHub already records for this account's
  merge commits, so a commit made this way is attributed to `cayvox`.

  **History is not rewritten to apply it.** Thirty commits on `main` carry an earlier AI trailer,
  and two of them, `749730b` (tagged `v0.3.0`) and `5b731b2` (tagged `v0.3.1`), are the commits the
  published npm provenance attestations name. Rewriting them would change those hashes and break
  the chain that proves the packages came from this repository. The rule applies forward only.

  **Signed off, not cryptographically signed.** `cayvox` has no SSH or GPG signing key registered on
  GitHub (checked 2026-09-13 through `api.github.com/users/cayvox/ssh_signing_keys` and
  `/gpg_keys`), so a commit cannot carry a signature GitHub would verify as `cayvox`. Registering a
  signing key on the account is what it would take; signing with a key registered to a different
  account would verify as that account, which is the opposite of this rule.

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
  empty directory, imports it, diffs the published file list against the `files` allowlist
  and reads the provenance predicate. See `07-testing` §2.

  **That second check did not work until 2026-08-28, and the claim above was false for two
  releases** (MK-053). It was written as a job inside the release workflow that could only
  run as the tail of a publish, it did not exist at all for 0.1.0, and on its first execution
  it failed before any verification step ran. It is a dispatchable workflow now,
  `.github/workflows/verify-published.yml`, so it can be run against any published version
  without publishing. **A gate that has never executed is a comment.**

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
| 2 | `MEZO_FORK_BLOCK=15043414 pnpm test:fork`, five consecutive runs, **on the Node version the fork gate declares** (`node-version` in `.github/workflows/ci.yml`, currently 24.19.0). **The block is not optional**: unset, anvil forks at `latest` and the byte identity this row demands cannot hold (MK-082) | **All five results, in full**, and **the Node version they ran on** (`node -v`). Every red run attributed to an existing MK ID or registered as a new one. The seeded answer, which must be byte identical across all five |
| 3 | `pnpm test:coverage` | All four metrics against the ratchet. A metric below its floor is fixed with tests, never by lowering the floor |
| 4 | `pnpm typecheck` | Clean |
| 5 | `pnpm -r --filter "./examples/*" typecheck` | Clean |
| 6 | `pnpm lint` | Clean |
| 7 | `pnpm build:site` | Clean, which includes `pnpm check:links` |
| 8 | **Read the CI run for the branch.** `gh run list --branch <branch> --workflow CI` then `gh run view --job <id> --log` for every job that is not green | The run link, its conclusion, and the first real failure in any red job. Local green does not stand in for this |
| 9 | **Read the CI run on `main` after the merge, WAITING for it to exist.** `gh run list --branch main --workflow CI --limit 5 --json conclusion,headSha` and match the `headSha` against `git rev-parse HEAD`. An absent run means **not yet**, not never: poll until it appears, and only report absence as a finding if it persists | The run link, its conclusion, and that its `headSha` is the tip rather than an ancestor. **A red `main` blocks the next wave**: repair it first, and register the cause before fixing it |
| 10 | **Commit the instrument for every measurement you intend to cite**, before citing it. A number quoted in a finding, a pull request body or the documentation is only citable if the code that produced it is in the repository and someone else can run it, and the command is recorded beside the number | The command, verbatim, next to every number. A measurement whose instrument is not committed is not reportable as a measurement; see the labels below |
| 11 | **A boundary that moves with time is established by SENDING, across the delay a caller will actually have, and is reported with that delay.** A simulation evaluates at the current block; a transaction executes in a later one. So a value read at block N and simulated at block N is an exact equality that passes, and the same value sent is refused, because the contract accrues before it reads (`TroveManager.sol:366` then `:1218-1221`). Vary the elapsed time, hold the method constant, and state the window the answer holds for. **A number obtained by simulation is labelled `simulated` wherever it is cited** and cannot be cited as chain behaviour | The ladder: the amount, the delays tried, and the outcome at each. A margin sized for a window is asserted at BOTH ends, the delay it covers and the delay it does not |
| 12 | **When a document tells a reader to run a command, confirm that nothing in the repository already performs it, and point at that instead.** Grep the repository for the command before writing it into a document: a workflow, a script or a CI step that already does the job makes the documented version the worse route and usually the less safe one, and it is the route nobody ever executes (MK-083) | The grep, and either "nothing performs this" or the file that does. A document that names a command a workflow already runs is corrected to name the workflow, keeping one sentence on why the raw command is not the route |

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

- **Every version the build depends on is PINNED in the workflow, not floated** (MK-029 for Node,
  MK-041 for Foundry, MK-044 for the rest). `stable`, `latest` and a bare major like `20` are not
  versions, they are subscriptions to someone else's release schedule. MK-041 is what that costs:
  `foundry-rs/foundry-toolchain` was set to `version: stable`, Foundry shipped anvil 1.8.0 mid
  afternoon, and the fork gate went from green to red about two hours later on a commit that changed
  one markdown file. Bumping a pinned version is a deliberate act, in its own commit, with the run
  read afterwards.

  **The line is what EXECUTES the project's code.** Node, pnpm and Foundry are pinned to exact
  versions because a change to any of them changes what the suite measures. Workflow action majors
  (`actions/checkout@v5`) are left floating, because a major float can break a run loudly but cannot
  silently change a test result, and pinning them means commit SHAs that a single maintainer has to
  bump forever. That judgment is written into `ci.yml` beside the pins so it can be argued with.

  **And the cost, because pinning is not free: pins go stale.** A pinned runtime stops receiving
  fixes until someone bumps it, and nothing will remind you. That is the trade, taken deliberately:
  a stale pin fails visibly when you bump it, a floating label fails invisibly under a commit that
  changed nothing.
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

**Step 10, and the three labels every number must carry.**

Step 10 exists because a number that decided a shipped default could not be checked. The gas
margin every write in this SDK carries was set to 25 from a measured isolation rate, 2 reverts in
40 attempts before and 0 in 80 after. The script that produced it was never committed. When a later
wave was asked to re-run it there was nothing to re-run, it had to be rebuilt from a prose
description, and the rebuilt instrument produced **no variance at all** across 52 executions, which
means the description of the original cannot have been right (MK-039).

Nothing was dishonest at any point. The number was measured, reported in good faith, and acted on.
It was simply never checkable, and by the time anyone tried, the evidence was gone. **Every
measurement this programme has acted on came from a tool nobody else could run**, and that is the
gap step 10 closes.

So every quantitative claim in the public record carries exactly one of three labels, and the label
is written down rather than left to the reader:

| Label | What it means | What it must carry |
|---|---|---|
| **Reproducible** | The instrument is committed and anyone can re-run it | The exact command, next to the number. `MK_GAS_LAB=1 pnpm test:fork` is a command; "measured on a fork" is not |
| **Observed once** | A specific execution that by its nature cannot be repeated: a CI run, a traced transaction, a chain read at a block | A link or an identifier that pins it. A run URL, a transaction hash, a block number. The words **observed once** appear in the text |
| **Observed once, unlinked** | The same, but the artifact was never preserved: a local run whose log is gone, a trace nobody saved | Say that it cannot be re-checked, in place. **Admissible only for observations recorded before this rule existed.** A new observation is preserved when it is made, or it is not citable |
| **Simulated** | Produced by `simulateContract`, `eth_call`, `estimateGas` or any other read that mines no block | The word **simulated**, in the same sentence as the number, and the block it ran at. Admissible for what a call returns at a block; **not** admissible as chain behaviour for anything the contract mutates before it reads (step 11) |
| **Unestablished** | Inferred, or its instrument is gone, or its premise turned out to be wrong | Say so, in place, and keep the number rather than deleting it. A reader has to be able to see what was believed and why it is not evidence |

The fourth label exists because the audit that first applied this rule found real, load bearing
evidence with no surviving artifact, and deleting those numbers would have removed the grounds a
finding actually stands on. It is a grandfather clause, deliberately, and it does not extend
forward: **preserve the artifact when you make the observation.** Save the log, record the run URL,
record the transaction hash. An observation is cheap to pin at the moment it happens and impossible
to pin a wave later, which is the whole lesson of MK-039.

**The exception is "observed once", and it is a real one, not a loophole.** A revert that happened
in one CI run cannot be re-executed on demand, and refusing to cite it would throw away the best
evidence this programme has produced. MK-035's traced growth, 610270 to 710023 gas ending in
`ActivePool` out of gas at call depth 4, is exactly that: unrepeatable, and decisive. What the label
buys is that a reader can tell it apart from a rate, which is a claim about a population and needs
an instrument. In MK-035 the traced growth is **observed once** and still justifies the margin,
while the 2 in 40 rate built on top of it is **unestablished**. One entry, two labels, and the
difference is the whole point.

**The fifth label is MK-048's, and it cost a whole wave.** The redemption gap's upper edge was
derived from `TroveManager.sol:1252`, measured on a fork with `simulateContract`, and the
measurement agreed. `packages/core/test/redeem-boundary.fork.test.ts` is the instrument that shows
why, and it was built because the first explanation offered for the failure was too broad to be
useful. Every row starts from the same snapshot, with only the delay between the read and the
execution varied:

```
warp      0s  netDebt           simulate=ACCEPTED send=success
warp      1s  netDebt           simulate=REFUSED  send=reverted
warp     60s  netDebt           simulate=REFUSED  send=reverted
warp    600s  netDebt           simulate=REFUSED  send=reverted
warp   3600s  netDebt           simulate=REFUSED  send=reverted
```

**The first framing of this rule said a simulation and a send are not the same experiment, and the
ladder shows that is not quite it.** At one second they agree: both refuse. At zero they agree the
other way: both accept. The variable is the elapsed time, not the method.

What makes the method matter is structural rather than semantic. **A simulation evaluates at the
current block, and a transaction cannot.** It lands at least one block later, so the delay a
simulation reports on is a delay no caller can have. That is why a boundary measured by simulating
at the block the value was read at is not wrong about anything except the only question worth
asking.

The label is what makes this survive review: a reader who sees `simulated` beside a boundary knows
to ask what happens a block later, and a reader who sees a bare number does not.

**Do not soften a finding because its number turned out to be weaker than it read.** The finding
stands on the evidence that remains. The record only has to say what that evidence is.

## 11. One rule, one implementation

**A rule the protocol has once is implemented here once.** When two functions answer the same
question, they will diverge, and the divergence will be invisible because both of them pass their
own tests. That is not a prediction: it has now happened twice with the same root cause. MK-001
was `isLiquidatable` applying a Recovery Mode widening the protocol does not have while
`getTrove` applied the correct rule, so the same predicate answered differently depending on which
API you reached for. MK-058, MK-059 and MK-065 were `evaluateBorrow` and `evaluateAdjust`
disagreeing on three separate rules about the same call, in a file written months **after** MK-001
closed and its lesson was recorded.

So the fix is one implementation, never two that agree today. If a second surface needs the same
answer in a different shape, it projects the first rather than restating it: `previewBorrow` is
`previewAdjustTrove` with a debt increase, because on chain `withdrawMUSD` is `_adjustTrove` with
a debt increase. **And where a projection is not possible, the agreement is a test**, asserted
across both modes and both sides of every boundary, not left to review. Two implementations with
no such test is the shape this rule exists to refuse, whatever the tests on each half say.

**And it happened a fourth and fifth time, in the same wave.** MK-089: the protocol's interest
formula was implemented twice, once accruing on the principal and once on the entire debt, and the
test that pinned one of its constants restated the wrong base, so the source could accrue on
either quantity and the test agreed. MK-094 then worked the whole table rather than the row the
defect was found on: nine rules decided more than once, seven single sourced, two left as prose
and labelled as the weaker control they are. **The line on test duplication is this**: a test that
restates the CONTRACT is an independent second opinion, and a test that restates the
IMPLEMENTATION is a tautology. Both look identical on the page.

**It happened a third time, and the third one was wider.** MK-067 through MK-070: the borrowing
fee rule was decided in eight places and four of them were wrong the same way, including a test
reference implementation and the fixture every fork test opens with. A projection was not
available, because `getBorrowingPower` solves for a maximum while `evaluateOpen` judges a
candidate, so it took the other half of this rule: the solver's predicate IS the evaluator, and
`borrowing-power-agreement.test.ts` is the pin. **Test code counts.** A reference implementation
that carries the same defect as the thing it references is not a second opinion, and the fixture
that opens every position is production code for the purposes of this section.

## 12. Closing a finding means enumerating the rule, not the defect

**Before a finding can be marked fixed, list every place the rule it concerns is decided, and
say for each whether it is correct.** The list goes in the entry. Fixing the location the entry's
own **SDK location** field names is not closing the finding; it is closing one instance of it.

This is mechanical on purpose: grep for the rule's inputs across `packages/`, `scripts/` and
`examples/`, including tests and harnesses, and account for every hit. MK-004, MK-017, MK-018 and
MK-065 were each remediated exactly where they were observed and each left live copies behind,
which is how one fee rule survived four releases in four wrong implementations.

**The enumeration is scoped to the RULE, never to the package the defect was found in** (MK-086).
MK-079 found an argument mis-mapping in the differential harness, enumerated it across
`packages/core`, and concluded in the register that no source file was implicated. The same
mis-mapping was in `packages/react/src/hooks/reads.ts`, in shipped code, and stayed there for two
waves while the register said it did not exist. A package boundary has no meaning to a rule:
presence versus value is a property of every caller of `previewAdjustTrove`, and the React package
is one.

So when a finding's cause is an **argument shape** or a **shared rule**, the entry names which
packages call it. "I checked the package the defect was in" is not an enumeration, and neither is
a grep that stops at a directory the rule does not respect.

## 13. A published measurement names what it measured, and its unit

**State the quantity, the unit, and the machine precisely enough that a reader can tell the figure
apart from the adjacent quantity it could be mistaken for.** Where two nearby quantities both have a claim on
the name, publish both and label each; where only one is published, the label says which it is.

The test is mechanical: for any number about to be published, name one plausible neighbouring
quantity a reader might take it for, and check the wording rules that reading out. This has gone
wrong three times, each time producing a figure that was true of something NEXT TO what it
claimed:

- **MK-051.** `scripts/testnet-e2e.ts` called a check "the maximum the SDK reports must be
  ACCEPTED and one wei more must be REFUSED, on the real chain, checked against the contract
  rather than against each other", and then called `previewWithdrawCollateral` twice. The chain
  saw neither amount. **Evaluator agreement, published as chain agreement.**
- **The per case sweep cost** (commit `949d361`). A figure was quoted without saying whether the
  RPC cache was cold or warm, which is the difference between 35.3 and 6.3 seconds per case on
  the same 24 cases at the same seed. `fork state warmed in Nms` was offered as evidence it was
  warm; that line times globalSetup's sorted list traversal (MK-021) and nothing else, and reads
  about 30ms on both sides. **One warm-up's duration, published as the fork's cache state.**
- **The push subset's warm cost** (MK-081, one commit after this rule was written). 158 seconds
  was published as what CI sits on. It is the mean of a developer laptop's five run window; CI runs
  the same 24 cases in about 60. Cache state was named because cache state was the variable that
  had burned us before, and the machine went unexamined. **A laptop's duration, published as CI's.**
- **The full sweep duration** (P15, corrected in P16). 111 minutes was published; that is the sum
  of the four `[differential] done in` values, and the recipe a person runs takes 116, the
  difference being the fork suite each slice also runs. **The sweep's own duration, published as
  the cost of the sweep.**
