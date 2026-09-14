# Release runbook

For someone who was not in the waves that produced this repository. Every step says **what to
check** so you can tell it worked, rather than assuming it did.

**Nothing here runs automatically.** Publishing and deploying are manual, credentialed acts.

---

## The 0.3.1 release, as it actually ran

**Published 2026-09-13T14:14:30Z** (`npm view @musd-kit/core time`). `@musd-kit/core@0.3.1` and
`@musd-kit/react@0.3.1`, from commit `5b731b21d9de98a846369209301391bb9d9f4bf7`, by
[release run 34761476541](https://github.com/cayvox/musd-kit/actions/runs/34761476541), with
provenance published to the transparency log for both (`logIndex` 2818486149 for core and 2818486736
for react, printed by that run). Tagged `v0.3.1`, which is a lightweight tag, where `v0.2.0` and
`v0.3.0` are annotated (`git for-each-ref refs/tags`).

**Written on 2026-09-14, a day late, from the evidence below rather than from memory** (MK-111). Every
row was read back from GitHub, the registry or git when this section was written.

| Precondition | Evidence at the time of publishing |
|---|---|
| 1, `main` green at its tip | [run 34761132217](https://github.com/cayvox/musd-kit/actions/runs/34761132217) at `5b731b2`, all four jobs `success` |
| 2, no open S1 | **Not met, knowingly.** MK-100 was open. The release existed to document it, under an exception stated only in that wave's instructions; §0b, which now states it, was written afterwards in the P21 wave |
| 3, versions intended | core and react at 0.3.1; the registry held 0.1.0, 0.2.0 and 0.3.0 |
| 4, changelogs | top entry `## 0.3.1` in both, read at `5b731b2` |
| 5, live testnet run | **None.** By §0b it falls away for a release whose runtime is byte identical to the previous one, and transfers nothing: the only live evidence about this code is 0.3.0's run |
| 6, packaged artifact | the fork gate job of run 34761132217 printed `GATE PASSED` at `packages@0.3.1`. Whether it was also run locally is not recorded |
| 7, sweep against THIS tree | **None at `5b731b2`.** The most recent sweep was [run 34746081139](https://github.com/cayvox/musd-kit/actions/runs/34746081139), at `749730b`, the 0.3.0 commit. §0b lets this fall away under the proof below |

**The proof that nothing but documentation changed**, reproduced when this was written:
`node scripts/compare-published.mjs --base 0.3.0 --head 0.3.1` prints `identical` for both runtime
builds of both packages, `comments only` for the declarations, and `NO BEHAVIOUR CHANGE`.

**After publishing.** `verify-published` passed in the release run. The `v0.3.1` tag push re-entered
the workflow ([run 34762232559](https://github.com/cayvox/musd-kit/actions/runs/34762232559)), whose
publish step printed `@musd-kit/core@0.3.1 is already published, skipping the publish step`, and whose
`verify-published` passed again. The README npm serves for 0.3.1 carries the MK-100 warning for both
packages (`npm view @musd-kit/core@0.3.1 readme`). **0.3.0 was not deprecated**, and the registry still
stores no message for it: its code is 0.3.1's, so a deprecation would have claimed a difference the
tarballs do not have.

---

## The 0.3.0 release, as it actually ran

**Published 2026-09-13.** `@musd-kit/core@0.3.0` and `@musd-kit/react@0.3.0`, from commit
`749730b855a24bf88fa64a57c0136a84a8cfa4d2`, by
[release run 34752401058](https://github.com/cayvox/musd-kit/actions/runs/34752401058), tagged
`v0.3.0`, with SLSA provenance naming this repository and that commit.

| Precondition | Evidence at the time of publishing |
|---|---|
| 1, `main` green at its tip | [run 34707799518](https://github.com/cayvox/musd-kit/actions/runs/34707799518), all four jobs, `headSha` equal to the tip |
| 2, no open S1 | twelve S1 rows in the index table, every one `fixed` |
| 3, versions intended | core and react at 0.3.0; the registry held 0.1.0 and 0.2.0 only |
| 4, changelogs | top entry `## 0.3.0` in both, read at the released commit |
| 5, live testnet run | `GO`, exit 0, **19 exercised, 4 skipped each with a reason**, position closed. `docs/13-live-testnet-ledger.md` |
| 6, packaged artifact | `pnpm gate:packaging`, `GATE PASSED` on all four rows at `packages@0.3.0`, 105 exports each way |
| 7, sweep against THIS tree | [run 34746081139](https://github.com/cayvox/musd-kit/actions/runs/34746081139), head equal to the released commit, 1000 cases, **0 FALSE_VIABLE, 0 unexpected**, ten FALSE_BLOCKED all registered to MK-079 |

**Three things went wrong, and none of them was the artifact.**

**The version commit turned `main` red** (MK-097). `changeset version` reformatted the `files` array
in both manifests and `biome check` rejected it; §0a's verification list had no row for the checks
the commit has to pass. Repaired in `749730b`, formatting only. **That repair moved the released
commit**, so the sweep already dispatched against `1cfb263` no longer measured the released tree and
precondition 7 had to be met again.

**Precondition 7 was then satisfied by the weekly scheduled run rather than a dispatch** (MK-099).
It landed on `749730b` by timing. Its parameters were checked from the run rather than inferred:
`seed=20260826 cases=1000`, fork block `15043414`, four slices covering `0..1000` with no gap, which
is what a default dispatch produces.

**The first two publish attempts failed on authentication**
([34749832323](https://github.com/cayvox/musd-kit/actions/runs/34749832323),
[34750705753](https://github.com/cayvox/musd-kit/actions/runs/34750705753)), both with
`npm error code E404` on `PUT .../@musd-kit%2fcore`. **A 404 on publish is npm's permission mask,
not a missing package**: the package is publicly readable, and npm declines to disclose existence to
an unauthorised caller. Nothing was published by either attempt and the registry was unchanged, so
there was nothing to roll back. Resolved by replacing the `NPM_TOKEN` secret.

**Deprecation and the tag.** `0.2.0` was deprecated by
[run 34753101330](https://github.com/cayvox/musd-kit/actions/runs/34753101330) and the stored
registry text was compared to the text the lookup produces **by sha256 rather than by eye**: 378
bytes matching for core, 216 for react. The `v0.3.0` tag push re-entered `release.yml` as MK-055
predicted, and the guard skipped the publish step and ran the verification instead
([run 34753169030](https://github.com/cayvox/musd-kit/actions/runs/34753169030)).

---

## The 0.2.0 release, as it actually ran

**Published 2026-08-28.** `@musd-kit/core@0.2.0` and `@musd-kit/react@0.2.0`, from commit
`371d5d9953f7f305cba0b4cfd2599e451f91aea8`, by
[release run 33176886491](https://github.com/cayvox/musd-kit/actions/runs/33176886491), tagged
`v0.2.0`, with SLSA provenance naming this repository and that commit.

| Precondition | Evidence at the time of publishing |
|---|---|
| 1, `main` green at its tip | [run 33175435351](https://github.com/cayvox/musd-kit/actions/runs/33175435351), `headSha` equal to the tip |
| 2, no open S1 | MK-001, 002, 003, 004, 005, 014, 018, all `fixed` |
| 3, versions intended | core and react at 0.2.0; the registry held only 0.1.0 |
| 4, changelogs | top entry `## 0.2.0` in both |
| 5, live testnet run | `GO`, exit 0, 20 surfaces, position closed. `docs/13-live-testnet-ledger.md` |
| 6, packaged artifact | `pnpm gate:packaging`, `GATE PASSED` under `skipLibCheck: true` |

**What went wrong, and it was the gate rather than the artifact.** The post publish verification job
failed before running a single check, and had never run for either release (MK-053). It was
repaired and then executed against the already published 0.2.0:
[run 33179723315](https://github.com/cayvox/musd-kit/actions/runs/33179723315), every step green.
0.1.0 was deprecated by [run 33180504234](https://github.com/cayvox/musd-kit/actions/runs/33180504234).

---

## 0. Preconditions

Each of these is a gate. If one fails, stop: the next step assumes it passed.

| # | Check | How | What "passed" looks like |
|---|---|---|---|
| 1 | `main` is green **at its tip** | `gh run list --branch main --limit 5 --json conclusion,headSha` then `git rev-parse origin/main` | A run whose `headSha` **equals** the tip, `conclusion: success`. A run on an ancestor is not this check (MK-036) |
| 2 | No open S1 | `FINDINGS.md`, the index table | No row with class `S1` and a status other than `fixed`. **The one exception, a release that changes no behaviour and exists to document an open S1, is §0b, and it has conditions of its own** |
| 3 | Versions are what you intend to publish | `packages/core/package.json`, `packages/react/package.json`. **These do not become correct by themselves: §0a is the action that sets them** | Both at the same version, and it is not already on npm |
| 4 | The changelogs describe this release | `packages/*/CHANGELOG.md`. **Written by the same command as step 3, see §0a** | The top entry is the version from step 3 |
| 5 | **The live testnet run passed** | `pnpm tsx scripts/testnet-e2e.ts` | `GO, live lifecycle verified on Mezo testnet.` and exit 0. See §1 |
| 6 | The packaged artifact is sound | `pnpm gate:packaging` (see `docs/07-testing.md` §4c) | `GATE PASSED`, and the configuration it prints is the one you intend to claim. All four rows exit 0 under `skipLibCheck: true`; `--strict` reports the `node16` rows without it, which fail for an upstream reason and are not gated (MK-040) |
| 7 | **A full sweep has run against THIS tree** | Usually `gh workflow run sweep.yml --ref main` with `main` already at the commit you intend to release, then `gh run list --workflow sweep.yml --limit 3 --json headSha,conclusion,status`. A dispatch is the usual route only because a release almost never sits on the commit the last Sunday run saw | A sweep run whose `headSha` **equals the commit being released**, whose parameters are the defaults (`seed=20260826`, `cases=1000`, fork block `15043414`, read from the run's own `[differential]` lines rather than from the workflow file), whose four slices cover `0..1000` with no gap, and `conclusion: success`. **The trigger event is not part of the condition** (MK-099): a scheduled run that lands on the release commit satisfies it, and a dispatch that lands on an earlier commit does not |
| 8 | **The previous release's record is on `main`, and no release since the ledger began lacks one** | `docs/13-live-testnet-ledger.md` and the `as it actually ran` sections at the top of this file, read on `origin/main`, not on a branch | Both files carry a section for the version `npm view @musd-kit/core dist-tags` shows as `latest` before this release, and for every version published since 2026-08-27, when both files were created. A version released without a live run has a section that says so and why. A record that exists only on an open pull request does not count. **Versions that predate the ledger are not required to have one, and are named below rather than back filled** (MK-111) |

**Versions that predate the ledger have no record, and this runbook does not invent one.** The ledger
and this runbook were both created on 2026-08-27 (`docs/13` in `b4e7f15`, this file in `0533bd5`,
`git log --diff-filter=A`). One published version is older: **0.1.0**, published 2026-06-22 by release
run 27951952166. `scripts/testnet-e2e.ts` existed from 2026-06-16 (`4b8915a`), but no output from a run
against 0.1.0 is committed anywhere, so whether it ran is unknown and 0.1.0 has no record. That list is
closed: a version published after 2026-08-27 cannot be added to it, and precondition 8 fails for one
missing a record.

**Step 5 is the one that is easy to skip and should not be.** The fork suite proves the SDK against
a fork; nothing but this proves it against the real deployment, the real oracle and real gas.

**Step 7 cites a sweep against the tree being released, never an earlier one, and that is not
pedantry.** `generateCases` takes the case count as an input to its PRNG and the operation list
feeds the same stream, so **changing the set of operations changes which tuples the same seed
draws** (MK-069). The P13 wave added a tenth operation; nobody ran the full sweep against the new
stream for two waves; when someone finally did, it surfaced MK-079, which had been reachable from
the moment the operation landed. A sweep against an earlier tree is evidence about that tree.

**`--ref` takes a branch or a tag, never a commit SHA**, so you cannot point a dispatch at an
arbitrary commit. In practice: merge everything first, let `main` settle at the commit you intend to
release, dispatch against `main`, and then check the run's `headSha` rather than assuming it. If
anything lands on `main` between the dispatch and the release, the sweep is about a different tree
and precondition 7 is not met. Tagging first and dispatching `--ref <tag>` is the alternative when
`main` cannot be held still, at the cost of a tag that exists before the release does.

**The workflow must already be on the default branch** for `workflow_dispatch` to be offered at all,
which is why a dispatch attempted before `sweep.yml` reaches `main` returns `404 Not Found`.

The weekly scheduled run (`.github/workflows/sweep.yml`, Sundays 03:00 UTC) exists so this is
usually a recent green rather than a two hour wait, but a release almost never sits on the exact
commit the last Sunday run saw, so **expect to dispatch it**. Budget it: about 116 minutes of wall
clock, of which 111 is the sweep itself (`docs/07-testing.md` §4a).

**What "success" means here has changed (MK-079).** The sweep exits non zero only for a mismatch
that no register entry explains. Mismatches a finding covers are listed in
`packages/core/test/differential/expected.ts`, printed as `EXPECTED <finding>` lines, and do not
fail the run. So a red sweep is always a real finding, and **a green one is not a claim that the
sweep found nothing**: read the `EXPECTED` lines, and read `EXPECTED-BUT-ABSENT`, which means a
registered mismatch stopped reproducing and the registry may be stale.

---

## 0a. Version the packages, which is what makes preconditions 3 and 4 true

**This step had no home in this runbook until now, and that is the gap it closes.** Preconditions 3
and 4 assert that the versions and the changelogs are right, and nothing said how they get that way.
A check asserted without the action that satisfies it is the same shape as MK-080, where the sweep
was documented as scheduled for 85 commits and a release while no schedule existed.

**Where it goes in the order.** After every pull request for the release has merged, so that all of
their changesets are on `main` at once, and **before preconditions 3, 4 and 7**. Before 3 and 4
because it is what makes them pass. Before 7 because this step produces a commit, and precondition
7 wants a sweep whose `headSha` equals the commit being released: sweep first and you have measured
the tree one commit before the one you ship.

The changesets themselves are not written here. Each is written during the wave that makes the
change, with `pnpm changeset`, and lands in `.changeset/` as part of that wave's pull request. This
step only consumes them.

```sh
pnpm changeset status        # read only: prints the plan without touching anything
pnpm changeset version       # applies it
```

`.changeset/config.json` sets `"commit": false`, so **the command does not commit.** Review the diff
and commit it yourself, then push to `main`.

### What it does, for this release

Computed by `pnpm changeset status` against the three changesets on the branch, rather than
predicted:

| package | from | to | bump | published? |
|---|---|---|---|---|
| `@musd-kit/core` | 0.2.0 | **0.3.0** | minor | yes |
| `@musd-kit/react` | 0.2.0 | **0.3.0** | minor | yes |
| `@musd-kit/example-keeper` | 0.0.2 | 0.0.3 | patch | no, `private` |
| `@musd-kit/example-open-and-manage` | 0.0.2 | 0.0.3 | patch | no, `private` |

**The changesets consumed are whatever `pnpm changeset status` lists, and this document does not
copy that list** (MK-098). It used to name three by filename; the P17 wave added a fourth and the
sentence went stale without anything noticing. Read the command's output instead: it is the tool's
own answer and it cannot drift from the tree.

**The two examples move and that is expected.** They are `"private": true`, so `pnpm publish -r`
skips them and nothing reaches the registry: `npm view @musd-kit/example-keeper` returns `E404`.
Their version moving is noise in the diff, not a second release.

### A minor here is a BREAKING release, and this is the thing a reader will get wrong

**Both packages are on `0.x`.** `docs/08-conventions.md` §7 says so as policy: `0.x` while the
surface stabilizes, `1.0` only when the maturity gate is met. On `0.x` there is no major slot to
bump, **so the minor slot is where breaking changes go**, and all three changesets for this release
describe breaking changes in so many words: a widened `BorrowBlockReason` union, a widened
`AdjustBlockReason`, `CloseBlockReason` and reordered `RefinanceBlockReason`, and a
`getBorrowingPower` that returns a different number in Recovery Mode. `docs/14-migration-0.2-to-0.3.md`
is the guide, and it exists because this is a breaking release.

**Do not read "minor" as "safe to pick up automatically".** The opposite is true on `0.x`, and it
cuts both ways. Checked against the `semver` resolver this repository already installs, version
7.8.4:

```
^0.2.0   ->  >=0.2.0 <0.3.0-0     0.3.0 satisfies it: false
~0.2.0   ->  >=0.2.0 <0.3.0-0     0.3.0 satisfies it: false
^1.2.0   ->  >=1.2.0 <2.0.0-0     1.3.0 satisfies it: true
```

So on `0.x` a caret behaves like a tilde. **Nobody on `^0.2.0` is upgraded by this release**, which
is the correct outcome for a breaking change, and it also means the migration reaches people only if
they are told: the version number will not push it to them.

### What to verify after it

| | |
|---|---|
| both versions | `grep '"version"' packages/core/package.json packages/react/package.json` reads `0.3.0` twice |
| both changelogs | the top entry under the package heading is `## 0.3.0`, followed by `### Minor Changes` |
| the changesets are consumed | the three `.md` files named above are gone from `.changeset/`; `README.md` and `config.json` stay |
| nothing else moved | the diff touches only `package.json`, `CHANGELOG.md` and `.changeset/`. No source file, no lockfile |
| the version is free | `npm view @musd-kit/core version` returns the PREVIOUS version, not the one you are about to publish |
| **the commit passes the gates it has to pass** | The standing checklist in `docs/08-conventions.md`, at minimum `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm -r --filter "./examples/*" typecheck`, `pnpm build:site`. **Run them before you push, not after** |

**That last row is not decoration and it was added because its absence cost a red `main`**
(MK-097). `changeset version` is a code generator that rewrites tracked files: for 0.3.0 it expanded
the `files` array in both manifests from one line to four and `biome check` refused it, so CI failed
on `Lint` at the tip of `main` with the fork gate skipped. The five rows above all passed on that
commit, because they check what the command produced semantically and say nothing about what the
commit has to survive. A generated file is subject to the same gates as a hand written one.

Then commit, push, and let CI go green at the tip before continuing: that is precondition 1, and
this commit is now the tip.

**The internal dependency resolves at publish time, not here.** `packages/react/package.json`
declares `"@musd-kit/core": "workspace:*"`, which pnpm replaces with the exact version when it packs.
Verified on what actually shipped: `npm view @musd-kit/react@0.2.0 dependencies` returns
`{ '@musd-kit/core': '0.2.0' }`. So `react@0.3.0` will depend on `core@0.3.0` exactly, and the two
packages must publish together.

---

## 0b. Releasing with an open S1, and what a release that changes no behaviour may skip

**Precondition 2 is absolute for any release that changes behaviour.** A fix for something else does
not get to ship beside a known S1, because the version number would tell consumers to upgrade into
it. This section was written after 0.3.1, which shipped with MK-100 open and was the first release to
need an exception; until now the exception existed only in that wave's instructions.

### When an open S1 does not block

All of these, not some:

| # | Condition | How it is checked |
|---|---|---|
| a | **The release changes no behaviour, proven** | `node scripts/compare-published.mjs --base <previous version>` exits 0 and prints `NO BEHAVIOUR CHANGE` against the working tree you are about to version. Method below |
| b | **Every open S1 is the subject of the release** | For each open S1 row, the release puts a warning on every surface a consumer reads for that surface: the function's docstring (what TypeDoc publishes and an editor shows on hover), the README of each affected package (what npm renders), the docs site pages, every example that uses it, and the landing page if it shows it |
| c | **The S1 is registered first, with its reproduction committed** | Its `FINDINGS.md` entry exists before the release commit, and names a command someone else can run |
| d | **The register cannot be read as fixed** | The index row's status reads `open, documented` and names the release that carries the warning |
| e | **The changelog says what it is** | The changeset says documentation only, no behaviour and no API change, and names the S1 |

**And do not deprecate the previous version for it.** Its code is the new version's code, byte for
byte, so a deprecation message would claim a difference the tarballs do not have. Deprecation belongs
to the release that fixes the S1.

### The proof, and why it has the shape it has

`scripts/compare-published.mjs` packs both packages (from npm for a published version, from a fresh
build for the working tree) and compares them file by file:

| File | Must be | Why |
|---|---|---|
| `dist/index.js`, `dist/index.cjs` | byte identical | this is the code a consumer runs |
| `dist/index.d.ts`, `dist/index.d.cts` | identical once the TypeScript printer removes comments | the comments ARE the documentation being released, so byte identity is impossible and would be the wrong test; the types themselves may not move |
| `package.json` | identical apart from `version` and the pinned `@musd-kit/core` | the pin moves with the version (§0a) |
| `README.md`, `LICENSE`, `*.map` | reported, not gated | prose, and source maps that embed the source's comments |
| the file list | identical | a file added or removed is a change |

Reproduced for the release that needed it: `node scripts/compare-published.mjs --base 0.3.0 --head
0.3.1` prints `identical` for both runtime builds of both packages, `comments only` for the four
declaration files, `version only` for both manifests, and `NO BEHAVIOUR CHANGE`.

### Which preconditions fall away when the proof holds

| # | Precondition | For a no behaviour release | Why |
|---|---|---|---|
| 1 | `main` green at its tip | **Stays** | lint, typecheck, the docs build and the link check all read the files the release changes |
| 2 | No open S1 | **Replaced** by a to e above | |
| 3 | Versions | **Stays**, and the bump is a patch | nothing in the API moved |
| 4 | Changelogs | **Stays**, and must carry e | |
| 5 | Live testnet run | **Falls away, and transfers nothing** | the run exercises the runtime code, which is the previous version's. It carries forward only evidence the previous version actually had: if the previous version has no live run on record, neither does this one, and nothing may imply otherwise. At the time of writing `docs/13-live-testnet-ledger.md` records a run for 0.2.0 only, so 0.3.0 and 0.3.1 have none on record |
| 6 | Packaging gate | **Stays** | the README and the declarations inside the tarball are exactly what changed, and the gate compiles the packaged quickstart (MK-108) |
| 7 | Sweep against this tree | **Falls away** | the sweep compares verdicts against transaction outcomes, and both are functions of the runtime code, which is identical. For the record: 0.3.1 was released from `5b731b2` by [run 34761476541](https://github.com/cayvox/musd-kit/actions/runs/34761476541); the most recent sweep then had run against `749730b`, the 0.3.0 commit |

**After publishing, check the surface the release was for.** `npm view @musd-kit/core readme` and the
same for react must contain the warning, because the registry, not the repository, is what a
consumer reads, and `verify-published` checks imports rather than prose.

**A release that changes behaviour is never this exception**, however small the change. If the proof
exits 1, precondition 2 applies in full and the release waits for the fix.

---

## 1. The live testnet run

It needs a funded testnet account, and **this runbook used to open by sourcing a file it never told
you how to make** (MK-083's sibling in the same audit). So: the account first, then the funding,
then the run.

### 1a. The key file, which nothing in the repository can create for you

`scripts/testnet-e2e.ts` reads `MEZO_TESTNET_PRIVATE_KEY` **from the environment and from nowhere
else**, by deliberate design: no path to a key file appears anywhere in that script. The convention
this project uses is a one line shell file that exports it.

| | |
|---|---|
| path | `.secrets/testnet-e2e.env`, at the repository root |
| contents | exactly one line, `export MEZO_TESTNET_PRIVATE_KEY=0x<64 hex characters>` |
| tracked? | **no.** `.gitignore:25` ignores `.secrets/` as a whole directory, confirmed with `git check-ignore -v .secrets/testnet-e2e.env` |
| mode | `0600`. The directory holds a spendable key and nothing else should read it |

**Generating it without the key ever reaching your scrollback or a tracked file.** `cast wallet new`
prints the private key to stdout, which puts it in terminal history and in any transcript; the
pipeline below writes it straight to the file and prints **only the address**, which is public:

```sh
mkdir -p .secrets
( umask 077
  cast wallet new --json | python3 -c '
import json, sys
w = json.load(sys.stdin)[0]
open(".secrets/testnet-e2e.env", "w").write("export MEZO_TESTNET_PRIVATE_KEY=" + w["private_key"] + "\n")
print(w["address"])
' )
```

`umask 077` inside the subshell is what makes the file `0600`, and it is scoped to the subshell so
it does not follow you around. Check with `stat -f '%Sp' .secrets/testnet-e2e.env`.

**It will overwrite an existing file without asking.** If `.secrets/testnet-e2e.env` is already
there it is probably a funded account from a previous release, and replacing it strands those funds.
Check before you run the above: `ls -l .secrets/`.

### 1b. Fund it

**The faucet is [faucet.test.mezo.org](https://faucet.test.mezo.org/).** Checked while writing this:
it resolves to a Cloudflare address, answers `200`, and serves a page headed "BTC MEZO" with a
"Request Tokens" control. It was not verified by requesting funds.

**Do not take an amount from this page.** The price, the debt floor, the fee rate and the gas price
are all governable, so any number written here goes stale. Compute it:

```sh
pnpm tsx scripts/testnet-e2e.ts --plan
```

That needs **no key** and prints the required balance with its arithmetic. `scripts/README.md` and
the header of `scripts/testnet-e2e.ts` carry the shape of the answer and the constraint that decides
it: the grant is capped per day, and the script sizes the position from the chain rather than from a
constant for exactly that reason (MK-045). If `--plan` asks for more than one grant, that is the
signal to read `scripts/testnet-fund.ts`, which exists because MUSD has no faucet at all.

### 1c. Run it

```sh
source .secrets/testnet-e2e.env      # exports MEZO_TESTNET_PRIVATE_KEY
pnpm tsx scripts/testnet-e2e.ts      # or: pnpm testnet:e2e
```

**What to check:** the final ledger lists every write and preview the SDK exposes, each marked
exercised or skipped **with a reason**. A skip with no reason is a bug in the script, not a pass.
The run ends with the account holding no Trove.

**If it dies halfway** the account is left with an open position. Re-running closes it first, which
is why the script does that before anything else.

**The key never appears in output.** It is read from the environment, is validated by shape without
being echoed, and the error path says "Value not shown" rather than printing it. Keep it that way.

---

## 2. Publish

```sh
gh workflow run release.yml
```

Or push a `v*` tag; the workflow triggers on either. It builds, lints, typechecks, runs the fork
gate against **current** testnet state (deliberately unpinned, unlike CI: a release wants to know
the SDK still works against the chain as it is now), then runs:

```sh
pnpm publish -r --access public --provenance --no-git-checks
```

**Prerequisites:** the repository is public (npm provenance signs via OIDC and needs it), and the
`NPM_TOKEN` secret is an automation token with publish rights to the `@musd-kit` scope.

**What to check:** the `publish` job is green, and the `verify-published` job that follows it is
green too. That second job is the real check: it polls the registry until the version is visible,
installs from **npm** into a clean project, and imports both packages as ESM and CJS. A missing
`dist`, a broken `exports` map, or a tarball that never reached the registry all fail there and
nowhere earlier.

**What to check by hand afterwards:**

```sh
npm view @musd-kit/core version        # the version you intended
npm view @musd-kit/react version       # the same version
npm view @musd-kit/core dist-tags      # `latest` points at it
```

---

## 3. Deprecate the previous version

Only if the previous version returns wrong numbers, which 0.1.0 does. **Deprecating is not
unpublishing:** the version stays installable for anyone already pinned to it and everyone else
sees a warning, which is the point, and it is reversible.

**This section used to carry two `npm deprecate` shell commands. It does not any more, and they
must not come back** (MK-083). `npm deprecate` writes to the registry, so it needs a publish
capable credential, and the only one this project keeps is the `NPM_TOKEN` repository secret;
running it from a maintainer's shell means that credential lives somewhere untracked, unrotated
with the secret and invisible in any log. `.github/workflows/deprecate.yml` exists specifically to
replace them and states that reasoning in its own header.

### Run it

```sh
gh workflow run deprecate.yml -f version=0.1.0 -f confirm=deprecate
```

| input | | |
|---|---|---|
| `version` | required | the version to deprecate, for example `0.1.0`. **Both packages are deprecated at that version**, `@musd-kit/core` and `@musd-kit/react` together |
| `confirm` | required, default empty | the literal string `deprecate`. Anything else and the job is **skipped, not failed**, so read the job's status rather than the run's colour |

Three guards are in the workflow rather than in your memory. It **resolves the message before any
credential is in scope** and fails there if the version has none (see below). It **refuses to
deprecate whichever version is currently `latest`**, per package, so the release you just shipped
cannot be marked broken by a typo in the version input. And the write is not the result: a final
step with **no credential in its environment** reads both packages back from the registry, polling
up to twelve times at ten second intervals, and fails unless the text on the registry **equals**
the text this run resolved. An equality rather than a non empty check, because a non empty check
passes on a version that was already deprecated with somebody else's message (MK-084).

### What to check afterwards

The workflow proves it, and you should still read it from the registry yourself, because that is
the only surface an installer sees:

```sh
npm view @musd-kit/core@0.1.0 deprecated
npm view @musd-kit/react@0.1.0 deprecated
npm view @musd-kit/core dist-tags          # `latest` must NOT be the version you deprecated
```

Each of the first two prints the message, and the messages differ per package. To clear one, the
same hazard applies: it is a registry write, so it belongs in a workflow, and none exists for
clearing. Today, on the live registry, both `@musd-kit/core@0.1.0` and `@musd-kit/react@0.1.0`
report their messages and `latest` is `0.2.0`.

**The workflow has run exactly once**,
[run 33180504234](https://github.com/cayvox/musd-kit/actions/runs/33180504234), a
`workflow_dispatch` on 2026-08-28 that produced the two deprecations above. The shell commands this
section used to carry never ran at all, which is the whole of MK-083.

### Where the message comes from, and why you cannot send a wrong one

**The messages live in `scripts/deprecation-message.mjs`, chosen by version** (MK-084). They are not
a dispatch input: an input would let this job write any text onto any version, which is a much
larger capability than it needs. They are not literals in the workflow either, which is what they
used to be, with `version` parameterised and the text not, so a dispatch for anything but 0.1.0
would have attached 0.1.0's sentence to a real package.

Three things follow, and the third is the one that makes this safe rather than merely tidy:

- **An unknown version is refused**, by name, listing the versions that do have a message. Nothing
  is written. Preparing a deprecation means adding an entry in a pull request.
- **A message that does not describe its version is refused.** It must OPEN by naming the version,
  and must not tell the reader to upgrade to the version it deprecates. A substring check would not
  do: 0.1.0's message ends "Upgrade to 0.2.0.", so it CONTAINS "0.2.0" while being entirely about
  0.1.0, and a weaker rule would have let exactly the forged pair through.
- **Both refusals happen in the first step, which holds no credential.** `NODE_AUTH_TOKEN` only
  enters scope in the step after, so a bad dispatch cannot reach the registry even in principle.

`packages/core/test/deprecation-message.test.ts` asserts all of this in the unit project, so it runs
on every push rather than only when someone dispatches a registry write, and two entries in
`scripts/mutation-check.mjs` break the two guarantees to prove the tests catch them.

Check the text yourself before dispatching, without running anything that writes:

```sh
node scripts/deprecation-message.mjs 0.2.0 core
node scripts/deprecation-message.mjs 0.2.0 react
node scripts/deprecation-message.mjs 0.3.0 core   # expect exit 1, no message written
```

### Before dispatching for 0.2.0, which is the next real use

0.2.0 carries three S1 findings, all fixed in 0.3.0: `previewBorrow` returned viable for a Recovery
Mode borrow the contract refuses (MK-058) and reported a TCR block the contract does not apply
(MK-059), and `getBorrowingPower` subtracted a borrowing fee the contract does not charge in
Recovery Mode or for a fee exempt account (MK-067). The message says so and points at
`docs/14-migration-0.2-to-0.3.md`.

| check | how | what you want |
|---|---|---|
| 0.3.0 is published and is `latest` | `npm view @musd-kit/core dist-tags` | `{ latest: '0.3.0' }`. **The workflow refuses to deprecate the current `latest`**, so dispatching this before 0.3.0 ships fails at that guard, which is the interlock that stops a premature deprecation |
| the message is the one you mean | `node scripts/deprecation-message.mjs 0.2.0 core` and the same for `react` | exit 0, and text that names 0.2.0 and sends readers to 0.3.0 |
| you are dispatching the right commit | `gh workflow run deprecate.yml --ref main` after the entry is merged | the run's `headSha` carries the entry. A dispatch from a ref without it is refused as an unknown version, loudly |

Then:

```sh
gh workflow run deprecate.yml --ref main -f version=0.2.0 -f confirm=deprecate
```

**Re-dispatching 0.1.0 is safe.** Its two strings are reproduced in the module byte for byte, and
checked against the live registry, so a re-run rewrites nothing.

---

## 4. The site deploys itself, and there is nothing to run here

**There used to be a `gh workflow run deploy-site.yml` command here. It never worked and it has been
removed (MK-056).** That workflow had zero runs in its entire history, and it could not have run: it
needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, and neither secret exists on the
repository. Meanwhile musdkit.xyz has been live the whole time and is current.

**What actually happens: a build connected to this repository publishes the site automatically after
a push to `main`.** Established rather than assumed:

- PR 29 merged at `2026-08-28T14:51:02Z` and changed five files under `docs/`. The live page
  `musdkit.xyz/docs/12-release-runbook` now contains strings that exist only in that commit,
  including the commit SHA `371d5d9953f7f305cba0b4cfd2599e451f91aea8`, the release run id
  `33176886491` and the identifier `MK-055`. **Nobody deployed it, so something did.**
- `dig musdkit.xyz NS` returns `tani.ns.cloudflare.com` and `kayden.ns.cloudflare.com`, the A records
  are Cloudflare anycast, and the responses carry `server: cloudflare` with
  `cache-control: public, max-age=0, must-revalidate` on HTML and `max-age=14400` on
  `/_astro/` assets, which is the Cloudflare Pages static shape.
- The repository contains no `wrangler.toml`, no `netlify.toml`, no `vercel.json` and no
  `_headers`, so the build configuration lives outside this repository.
- `gh api repos/cayvox/musd-kit/deployments` returns **0**, there are no Environments, and there is
  no GitHub Pages site. So whatever builds it does not record GitHub Deployments.

**A Cloudflare Pages git integration is the only mechanism consistent with all of the above, and it
is not confirmed.** Confirming it needs the Cloudflare panel, which is not reachable from here.
`musdkit.pages.dev` could not be resolved either, because the network used for this check has an ISP
resolver that answers every nonexistent name with `213.14.227.50`, and `1.1.1.1` was unreachable, so
that probe proves nothing in both directions.

**Three things to read off the Cloudflare Pages panel, once, and write into this section:**

1. the **connected repository and branch** (expected: `cayvox/musd-kit`, `main`)
2. the **build command and output directory** (expected: `bash scripts/build-site.sh` and
   `landing/dist`, matching `scripts/build-site.sh`)
3. the **commit and timestamp of the last build** (expected: at or after `31fbccc`)

**Why removed rather than wired to the real mechanism.** Wiring it would mean putting Cloudflare
credentials into CI so that GitHub can do a build Cloudflare already does on the same push. Two
mechanisms for one deploy is a thing that drifts, and the one that drifts is always the one nobody
runs. A workflow that has never run, cannot run, and sits beside a site that deploys another way is
the same false artifact as MK-053's gate: **it was believed because it existed.**

**The ordering the old section existed to enforce still matters, and is now enforced somewhere
better.** The landing declares `"@musd-kit/core": "npm:@musd-kit/core@0.2.0"`, so the build resolves
the PUBLISHED package. If the version named there is not on the registry, the install fails and the
deploy fails with it. Publish first, then bump that dependency: the site can no longer advertise a
version that does not exist, because it cannot build against one (MK-054).

**What to check after a deploy**, by fetching the served page rather than reading a build log: the
docs at `/docs/` carry the newest commit's text, the hero install command names the published
version, and the live widget returns a price rather than its static fallback.

---

## 5. Rollback

**Read this before you need it, because npm's rules are narrower than people expect.**

### What npm allows

- **Deprecate**, at any time, on any version. This is the honest recovery for a bad release: the
  version stays installable for anyone pinned to it, and everyone else sees a warning. Reversible.
- **Change `dist-tags`.** `npm dist-tag add @musd-kit/core@0.1.0 latest` makes the previous version
  the default install again. Immediate, reversible, and it does not remove anything.
- **Unpublish, within 72 hours of publishing**, and only if no other package depends on it. After
  72 hours npm will not unpublish without contacting support, and support declines routinely.

### What npm does not allow

- **Republishing the same version.** Once `0.2.0` exists, that number is spent forever, even if you
  unpublish it. There is no "fix and re-push".
- **Editing a published tarball.** The contents are immutable.

### So the honest recovery is

1. **Deprecate the bad version** with a message naming what is wrong and pointing at the register.
2. **Point `latest` back** at the last good version, so new installs stop picking up the bad one.
3. **Fix forward**, in a new patch version. This is the actual repair; the two steps above only stop
   the bleeding.
4. **Register the defect** in `FINDINGS.md` with the next free MK ID, including what shipped and to
   whom. A defect that reached a registry is a finding whether or not anyone reports it.

**Unpublishing is the wrong reflex**, even inside the 72 hour window. It breaks every lockfile that
already resolved the version, and it hides the evidence of what happened. Deprecating tells the
truth; unpublishing pretends the release did not occur.

---

## 6. After

- The tag, if you published from a manual dispatch rather than a tag, so the commit that produced
  the artifact is findable: `git tag v0.2.0 <sha> && git push origin v0.2.0`.

  **Read this before you do it (MK-055).** §1 says the release workflow triggers on a `v*` tag, and
  this step tells you to push one after publishing by dispatch. Those two instructions contradict
  each other: the tag push fires the release workflow again, which tries to publish a version that
  already exists. The workflow now refuses that case rather than failing on it, but **a tag push
  runs the workflow file at the TAG's commit, not the one on `main`**, so tagging a commit from
  before that guard still attempts a republish. For `v0.2.0` the workflow was disabled for the
  duration of the push (`gh workflow disable release.yml`, tag, `gh workflow enable release.yml`)
  and confirmed re-enabled afterwards. For a future release, tag a commit that carries the guard and
  none of this applies.
- **Open the record pull request, and merge it before the next release begins.** It carries the
  `as it actually ran` section at the top of this file and the version's section in
  `docs/13-live-testnet-ledger.md`. **The ledger is kept per release, not per script change**: every
  version that reaches npm gets a section, whether or not a live run happened for it, and a version
  released without one says so and cites the §0b proof that let it. Changing `scripts/testnet-e2e.ts`
  does not by itself earn a section; a release does. Precondition 8 checks this on `main` for the
  previous version, because 0.3.0's record sat on an unmerged pull request while two releases went
  out (MK-111).
- Announce, if you are announcing. The migration guide is the link that matters to anyone already
  running the previous version: `docs/11-migration-0.1-to-0.2.md`.
