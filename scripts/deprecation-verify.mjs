#!/usr/bin/env node
/**
 * Read a deprecation back from the registry and say whether it is the text this tree intended
 * (MK-256).
 *
 * **Why this exists, and why it is a file rather than four lines of shell.** `deprecate.yml`
 * verified its own write with `npm view "@musd-kit/$p@$V" deprecated`, retrying only while the
 * answer was EMPTY. Empty is the state of a version that has never been deprecated. Re-deprecating
 * one that already carries a message has a different intermediate state: the PREVIOUS text, served
 * from npm's read path while the write propagates. The 0.5.0 release hit it the first time anyone
 * re-deprecated a version: `npm deprecate` succeeded for `@musd-kit/core@0.4.0`, the verify step
 * read back the message from 2026-09-14, and the run went red on a write that had worked
 * ([run 35073470096](https://github.com/cayvox/musd-kit/actions/runs/35073470096)).
 *
 * **And the obvious repair made it worse**, which is the part worth keeping: re-dispatching to get
 * a green run failed with `npm error code E422 Unprocessable Entity`, because by then the message
 * was already what it was being set to. A correct deprecation left two red runs and no green one,
 * which teaches a reader to stop believing this workflow's colour. That is the same failure as
 * MK-053, where a job that never produced a verdict looked like a control.
 *
 * Two changes:
 *
 *   - **it reads the registry DOCUMENT**, `https://registry.npmjs.org/@musd-kit%2f<pkg>`, rather
 *     than going through `npm view`, so there is one fewer cache between the write and the check;
 *   - **it retries while the answer is the PREVIOUS text**, not only while it is absent, and says
 *     which state it is in on every attempt, so a slow propagation reads as slow rather than as a
 *     forgery.
 *
 * It holds no credential and writes nothing. Exit 0 means every package carries exactly the text
 * `scripts/deprecation-message.mjs` resolves for that version; exit 1 prints both strings.
 *
 *   node scripts/deprecation-verify.mjs 0.4.0
 *   node scripts/deprecation-verify.mjs 0.4.0 --attempts 12 --interval 10
 */
import { PACKAGES, messageFor } from './deprecation-message.mjs'

/** Where a registry answer stands against the text we mean to see. */
export function verdictFor(onRegistry, intended) {
  if (typeof intended !== 'string' || intended.length === 0) {
    throw new Error('an intended message is required')
  }
  if (onRegistry === intended) return { state: 'matches' }
  if (onRegistry === undefined || onRegistry === null || onRegistry === '')
    return { state: 'absent' }
  return { state: 'different', onRegistry }
}

/** True while it is worth reading again: the write may still be propagating. */
export const worthRetrying = (verdict) => verdict.state !== 'matches'

/** The `deprecated` field the registry document carries for one version, or `''`. */
export function deprecatedIn(doc, version) {
  const entry = doc?.versions?.[version]
  const value = entry?.deprecated
  return typeof value === 'string' ? value : ''
}

/** Fetch one package's registry document. Separated so the polling loop can be tested without it. */
async function fetchDoc(pkg) {
  const response = await fetch(`https://registry.npmjs.org/@musd-kit%2f${pkg}`, {
    headers: { accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`registry answered ${response.status} for @musd-kit/${pkg}`)
  return await response.json()
}

/**
 * Poll one package until the registry serves the intended text, or the attempts run out.
 *
 * `read` is injected so the loop itself is testable: the test drives it through absent, then the
 * previous text, then the intended one, which is the sequence the release actually saw.
 */
export async function pollUntilMatches({
  pkg,
  version,
  intended,
  read,
  attempts = 12,
  intervalMs = 10_000,
  log = console.log,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  let last = { state: 'absent' }
  for (let i = 1; i <= attempts; i++) {
    const onRegistry = await read(pkg)
    last = verdictFor(onRegistry, intended)
    if (!worthRetrying(last)) {
      log(`  @musd-kit/${pkg}@${version} carries the intended text (attempt ${i})`)
      return last
    }
    const why =
      last.state === 'absent'
        ? 'not deprecated yet'
        : 'still serving a different message, which is what a propagating write looks like'
    log(`  attempt ${i}: @musd-kit/${pkg}@${version} ${why}, waiting`)
    if (i < attempts) await sleep(intervalMs)
  }
  return last
}

const option = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : Number(process.argv[i + 1])
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const version = process.argv[2]
  if (!version || version.startsWith('--')) {
    console.error(
      'usage: node scripts/deprecation-verify.mjs <version> [--attempts N] [--interval S]',
    )
    process.exit(2)
  }
  const attempts = option('attempts', 12)
  const intervalMs = option('interval', 10) * 1000
  let failed = false
  for (const pkg of PACKAGES) {
    const intended = messageFor(version, pkg)
    const verdict = await pollUntilMatches({
      pkg,
      version,
      intended,
      attempts,
      intervalMs,
      read: async (p) => deprecatedIn(await fetchDoc(p), version),
    })
    if (verdict.state === 'matches') {
      console.log(`  @musd-kit/${pkg}@${version}: ${intended}`)
      continue
    }
    failed = true
    if (verdict.state === 'absent') {
      console.error(`FAIL: @musd-kit/${pkg}@${version} is not deprecated on the registry`)
    } else {
      console.error(`FAIL: @musd-kit/${pkg}@${version} carries a message this commit did not send.`)
      console.error(`  on the registry: ${verdict.onRegistry}`)
      console.error(`  resolved here:   ${intended}`)
    }
  }
  process.exit(failed ? 1 : 0)
}
