# Release runbook

For someone who was not in the waves that produced this repository. Every step says **what to
check** so you can tell it worked, rather than assuming it did.

**Nothing here runs automatically.** Publishing and deploying are manual, credentialed acts.

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
| 2 | No open S1 | `FINDINGS.md`, the index table | No row with class `S1` and a status other than `fixed` |
| 3 | Versions are what you intend to publish | `packages/core/package.json`, `packages/react/package.json` | Both at the same version, and it is not already on npm |
| 4 | The changelogs describe this release | `packages/*/CHANGELOG.md` | The top entry is the version from step 3 |
| 5 | **The live testnet run passed** | `pnpm tsx scripts/testnet-e2e.ts` | `GO, live lifecycle verified on Mezo testnet.` and exit 0. See §1 |
| 6 | The packaged artifact is sound | `pnpm gate:packaging` (see `docs/07-testing.md` §4c) | `GATE PASSED`, and the configuration it prints is the one you intend to claim. All four rows exit 0 under `skipLibCheck: true`; `--strict` reports the `node16` rows without it, which fail for an upstream reason and are not gated (MK-040) |

**Step 5 is the one that is easy to skip and should not be.** The fork suite proves the SDK against
a fork; nothing but this proves it against the real deployment, the real oracle and real gas.

---

## 1. The live testnet run

It needs a funded testnet account. **Compute the figure rather than guessing it**, because the
price, the debt floor, the fee rate and the gas price are all governable:

```sh
pnpm tsx scripts/testnet-e2e.ts --plan
```

That needs no key and prints the required balance with its arithmetic. Fund the address from the
Mezo testnet faucet, then:

```sh
source .secrets/testnet-e2e.env      # exports MEZO_TESTNET_PRIVATE_KEY
pnpm tsx scripts/testnet-e2e.ts
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

Only if the previous version returns wrong numbers, which 0.1.0 does:

```sh
npm deprecate @musd-kit/core@0.1.0 "0.1.0 returns wrong numbers on seven surfaces, three of them silently. See FINDINGS.md and docs/11-migration-0.1-to-0.2.md. Upgrade to 0.2.0."
npm deprecate @musd-kit/react@0.1.0 "Depends on @musd-kit/core@0.1.0, which returns wrong numbers on seven surfaces. See docs/11-migration-0.1-to-0.2.md. Upgrade to 0.2.0."
```

**What to check:** `npm view @musd-kit/core@0.1.0 deprecated` prints the message. Installers now see
a warning; the version stays installable, which is the point. Deprecation is reversible:
`npm deprecate <pkg>@<version> ""` clears it.

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
- Announce, if you are announcing. The migration guide is the link that matters to anyone already
  running the previous version: `docs/11-migration-0.1-to-0.2.md`.
