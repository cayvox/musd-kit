# Release runbook

For someone who was not in the waves that produced this repository. Every step says **what to
check** so you can tell it worked, rather than assuming it did.

**Nothing here runs automatically.** Publishing and deploying are manual, credentialed acts.

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
| 6 | The packaged artifact is sound | `docs/07-testing.md` §4c, the four way typecheck | All four configurations exit 0 (MK-040) |

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

## 4. Deploy the site, AFTER publishing

```sh
gh workflow run deploy-site.yml -f confirm=deploy
```

**Why after, and not before:** the landing page's hero shows an `npm install` command and its live
widget reads through the published package. Deploying first means the site tells a visitor to
install a version that does not exist yet, and the widget reads an older one. The order is the whole
reason this workflow is manual.

**Prerequisites:** the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets, and a Cloudflare
Pages project mapped to the domain. `PUBLIC_MEZO_TESTNET_RPC_URL` is optional.

**What to check:** the site loads, the hero install command names the new version, the docs are at
`/docs/`, and the live widget returns a price rather than a fallback. Locally you can preview the
identical build with `pnpm preview:site`.

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
- Announce, if you are announcing. The migration guide is the link that matters to anyone already
  running the previous version: `docs/11-migration-0.1-to-0.2.md`.
