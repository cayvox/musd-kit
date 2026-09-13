import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The deprecation messages, and the refusals that keep a wrong one off the registry.
 *
 * **Why this is a unit test of a workflow.** `.github/workflows/deprecate.yml` writes to the
 * public npm registry, so the one thing it must never do is attach a message that describes a
 * different release (MK-084). That guarantee cannot be checked by dispatching the workflow,
 * because dispatching it IS the write. It is checkable here because the resolver the workflow
 * calls is an ordinary module, and this file asserts the same function the workflow shells out
 * to, which is `docs/08-conventions.md` §11 applied to a string that reaches the public.
 *
 * The import is a URL import rather than a package path because the module lives in `scripts/`,
 * outside any package, and is loaded by Node in CI exactly the same way.
 */

const MODULE_URL = new URL('../../../scripts/deprecation-message.mjs', import.meta.url)
const SCRIPT_PATH = fileURLToPath(MODULE_URL)

const { DEPRECATIONS, PACKAGES, messageFor, assertMessageDescribes } = (await import(
  MODULE_URL.href
)) as {
  DEPRECATIONS: Record<string, Record<string, string>>
  PACKAGES: readonly string[]
  messageFor: (version: string, pkg: string) => string
  assertMessageDescribes: (version: string, pkg: string, message: string) => string
}

/** Run the CLI the workflow actually invokes, and report its exit code with its output. */
function cli(version: string, pkg: string): { code: number; out: string } {
  try {
    return {
      code: 0,
      out: execFileSync('node', [SCRIPT_PATH, version, pkg], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim(),
    }
  } catch (error) {
    const e = error as { status?: number; stderr?: string }
    return { code: e.status ?? 1, out: (e.stderr ?? '').trim() }
  }
}

describe('MK-084, a deprecation message describes the version it is attached to', () => {
  it('a known version produces its OWN message, per package', () => {
    expect(messageFor('0.1.0', 'core')).toContain('0.1.0 returns wrong numbers on seven surfaces')
    expect(messageFor('0.1.0', 'core')).toContain('docs/11-migration-0.1-to-0.2.md')

    expect(messageFor('0.2.0', 'core')).toContain('0.2.0 is wrong on two Recovery Mode surfaces')
    expect(messageFor('0.2.0', 'core')).toContain('docs/14-migration-0.2-to-0.3.md')
    // The two releases 0.4.0 supersedes. 0.3.1's text must say it WARNED, since that is the only
    // thing that tells it apart from 0.3.0, whose runtime code it shares byte for byte.
    expect(messageFor('0.3.0', 'core')).toContain('(MK-100)')
    expect(messageFor('0.3.0', 'core')).toContain('docs/15-migration-0.3-to-0.4.md')
    expect(messageFor('0.3.1', 'core')).toContain('warns about but does not fix MK-100')
    expect(messageFor('0.3.1', 'react')).toContain('warns about but does not fix MK-100')
    expect(messageFor('0.3.0', 'react')).not.toContain('warns')
  })

  it('and the two packages get DIFFERENT messages, because react is a dependant', () => {
    for (const v of Object.keys(DEPRECATIONS)) {
      expect(messageFor(v, 'core')).not.toBe(messageFor(v, 'react'))
      expect(messageFor(v, 'react')).toContain(`Depends on @musd-kit/core@${v}`)
    }
  })

  it('every entry in the registry satisfies the guarantee, not just the ones tested above', () => {
    // Whatever gets added later is covered by this: the loop is over the data, so a new version
    // whose message was copied from an old one fails here, on every push, in the unit project.
    for (const [version, entry] of Object.entries(DEPRECATIONS)) {
      for (const pkg of PACKAGES) {
        expect(entry[pkg], `${version} has no ${pkg} message`).toBeTypeOf('string')
        expect(() => assertMessageDescribes(version, pkg, entry[pkg] as string)).not.toThrow()
      }
    }
  })

  it('refuses 0.1.0 text filed under 0.2.0, which is the exact mistake MK-084 was', () => {
    // The forged pair this whole file exists to reject. `messageFor` cannot be made to produce
    // it while the data is correct, which is why the check is exported and exercised directly.
    for (const pkg of PACKAGES) {
      expect(() => assertMessageDescribes('0.2.0', pkg, messageFor('0.1.0', pkg))).toThrow(
        /does not open by naming 0.2.0/,
      )
    }

    // And it accepts the correct pairing, so the assertion is not simply always throwing.
    expect(assertMessageDescribes('0.2.0', 'core', messageFor('0.2.0', 'core'))).toContain('0.2.0')
  })

  it('a mere MENTION of the version is not enough, which a substring check would have allowed', () => {
    // This is the hole the first version of the guarantee had, caught by this file before it
    // shipped: 0.1.0's message ends "Upgrade to 0.2.0.", so it CONTAINS "0.2.0" while being
    // entirely about 0.1.0. The version has to be the subject, not an incidental mention.
    expect(messageFor('0.1.0', 'core')).toContain('0.2.0')
    expect(() => assertMessageDescribes('0.2.0', 'core', messageFor('0.1.0', 'core'))).toThrow()
  })

  it('refuses a message that tells the reader to upgrade to the version it deprecates', () => {
    expect(() =>
      assertMessageDescribes('0.2.0', 'core', '0.2.0 is wrong. Upgrade to 0.2.0.'),
    ).toThrow(/upgrade to 0.2.0, the very version it deprecates/)
  })

  it('refuses a message with no upgrade target at all', () => {
    expect(() => assertMessageDescribes('0.2.0', 'core', '0.2.0 is wrong. Sorry.')).toThrow(
      /does not end by naming an upgrade target/,
    )
  })

  it('refuses an empty or missing message for a package', () => {
    expect(() => assertMessageDescribes('0.2.0', 'core', '')).toThrow(/has no message for core/)
  })

  /* --- the refusals. A loud failure is the correct outcome, per MK-084 --- */

  it('refuses an unknown version, and names the versions it does know', () => {
    // 0.3.0 was the example of an unknown version until its message was written, so the example is
    // a version nobody will publish.
    expect(() => messageFor('9.9.9', 'core')).toThrow(/no deprecation message is written for 9.9.9/)
    expect(() => messageFor('9.9.9', 'core')).toThrow(/Known versions: 0.1.0, 0.2.0, 0.3.0, 0.3.1/)
  })

  it('refuses an empty version and an unknown package', () => {
    expect(() => messageFor('', 'core')).toThrow(/a version is required/)
    expect(() => messageFor('0.2.0', 'landing')).toThrow(/unknown package/)
  })

  /* --- the CLI, which is the surface the workflow actually uses --- */

  it('the CLI exits 0 and prints the message for a known version', () => {
    const r = cli('0.2.0', 'core')
    expect(r.code).toBe(0)
    expect(r.out).toBe(messageFor('0.2.0', 'core'))
  })

  it('the CLI exits NON ZERO for an unknown version, so the workflow step fails', () => {
    const r = cli('9.9.9', 'core')
    expect(r.code).not.toBe(0)
    expect(r.out).toMatch(/no deprecation message is written for 9.9.9/)
  })

  /* --- what is already on the registry must stay reproducible --- */

  it('0.1.0 is reproduced byte for byte, so a re-run cannot rewrite what was sent', () => {
    // Checked against the live registry when this was written: `npm view @musd-kit/core@0.1.0
    // deprecated` returns exactly this, and the same for react. A re-dispatch of 0.1.0 is
    // therefore a no-op rather than a silent edit.
    expect(messageFor('0.1.0', 'core')).toBe(
      '0.1.0 returns wrong numbers on seven surfaces, three of them silently. See FINDINGS.md and docs/11-migration-0.1-to-0.2.md. Upgrade to 0.2.0.',
    )
    expect(messageFor('0.1.0', 'react')).toBe(
      'Depends on @musd-kit/core@0.1.0, which returns wrong numbers on seven surfaces. See docs/11-migration-0.1-to-0.2.md. Upgrade to 0.2.0.',
    )
  })

  it('every message points at a migration guide and names an upgrade target', () => {
    for (const version of Object.keys(DEPRECATIONS)) {
      for (const pkg of PACKAGES) {
        const m = messageFor(version, pkg)
        expect(m, `${version} ${pkg} must cite a migration guide`).toMatch(/docs\/\d+-migration-/)
        expect(m, `${version} ${pkg} must say what to upgrade to`).toMatch(
          /Upgrade to \d+\.\d+\.\d+\./,
        )
      }
    }
  })
})
