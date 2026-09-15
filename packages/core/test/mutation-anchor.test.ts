import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error: a plain ESM module under scripts/, imported for its behaviour, typed loosely
import { AnchorError, applyEntry, locate } from '../../../scripts/mutation/anchor.mjs'

/**
 * MK-112. A mutation cannot land anywhere other than where it was written for.
 *
 * The gate before this wave matched with `text.includes(from)` and applied `text.replace(from, to)`,
 * which rewrites the first occurrence in the file, wherever it is. MK-110's first case is the result:
 * the MK-089 entry's text stopped occurring in `marginFor` and began occurring, once, in
 * `partialRedemptionBand`, and the gate went on reporting on the wrong computation.
 *
 * Each case below moves a target deliberately, in memory, and shows the anchor REFUSES, where the old
 * matching would have applied the mutation somewhere. Runs in the `unit` project; nothing touches disk.
 */

const FILE = 'packages/core/src/example.ts'

const SOURCE = `export function marginFor(principal: bigint, rate: bigint): bigint {
  const base = principal
  return base * rate
}

export function band(principal: bigint, debt: bigint): bigint {
  const width = debt
  return width * 2n
}
`

/** What the gate did until this wave: the first occurrence anywhere in the file. */
const oldApply = (text: string, from: string, to: string) =>
  text.includes(from) ? text.replace(from, to) : undefined

const entryFor = (over: Record<string, unknown>) => {
  const base = {
    id: 'example',
    file: FILE,
    scope: 'marginFor',
    from: '  const base = principal',
    to: '  const base = debt',
  }
  const e = { ...base, ...over }
  return { ...e, fingerprint: locate(e, SOURCE).fingerprint }
}

describe('MK-112, a mutation anchored to its scope, its text and its fingerprint', () => {
  it('applies where it was written for, and nowhere else', () => {
    const e = entryFor({})
    const out = applyEntry(e, SOURCE)
    expect(out).toContain('  const base = debt')
    expect(out).toContain('  const width = debt')
    expect(out.indexOf('const base = debt')).toBeLessThan(out.indexOf('export function band'))
  })

  it('REFUSES when the target moved to another declaration, where the old matcher still applied it', () => {
    const e = entryFor({})
    // The target line now lives in `band`, and `marginFor` no longer has it: the MK-089 shape.
    const moved = SOURCE.replace(
      '  const base = principal\n  return base * rate',
      '  return principal * rate',
    ).replace('  const width = debt', '  const base = principal\n  const width = debt')
    expect(
      oldApply(moved, e.from, e.to),
      'the old matcher applies it, inside the wrong function',
    ).toContain('const base = debt\n  const width')
    expect(() => applyEntry(e, moved)).toThrow(AnchorError)
    expect(() => applyEntry(e, moved)).toThrow(/occurs 0 times inside `marginFor`/)
  })

  it('REFUSES when its text occurs twice inside its scope, rather than choosing one', () => {
    const e = entryFor({})
    const twice = SOURCE.replace(
      '  const base = principal\n',
      '  const base = principal\n  const base = principal\n',
    )
    expect(oldApply(twice, e.from, e.to), 'the old matcher picks the first').toBeDefined()
    expect(() => applyEntry(e, twice)).toThrow(/occurs 2 times inside `marginFor`/)
  })

  it('REFUSES when the code around it changed, even though its text is still there once', () => {
    // Anchored on a prefix of the statement, so the text still matches after the statement changes.
    const e = entryFor({ from: 'const base = principal', to: 'const base = debt' })
    const around = SOURCE.replace('  const base = principal', '  const base = principal * 2n')
    expect(oldApply(around, e.from, e.to), 'the old matcher still matches the prefix').toBeDefined()
    expect(locate(e, around).start, 'and the text is still found exactly once').toBeGreaterThan(0)
    expect(() => applyEntry(e, around)).toThrow(/no longer the code it was written against/)
  })

  it('REFUSES an ambiguous or absent scope', () => {
    const e = entryFor({})
    const two = `${SOURCE}\nexport namespace other { export function marginFor() { const base = principal } }\n`
    expect(() => locate({ ...e, scope: 'nope' }, SOURCE)).toThrow(/does not exist/)
    expect(() =>
      locate(e, two.replace('export namespace other {', 'export function marginFor2() {')),
    ).not.toThrow()
    const duplicateScope = `${SOURCE}\nexport function marginFor(): void {}\n`
    expect(() => locate(e, duplicateScope)).toThrow(/resolves to 2 declarations/)
  })

  it('REFUSES a missing fingerprint instead of trusting it', () => {
    const { fingerprint, ...noPrint } = entryFor({})
    void fingerprint
    expect(() => applyEntry(noPrint, SOURCE)).toThrow(/no fingerprint is recorded/)
  })

  it('does not move for a comment or formatting change, which is not a change of code', () => {
    const e = entryFor({})
    const reformatted = SOURCE.replace(
      '  const base = principal',
      '  // the base\n  const base =   principal',
    )
    // The `from` text itself changed spacing, so it is re-read from the reformatted source.
    const again = { ...e, from: '  const base =   principal' }
    expect(locate(again, reformatted).fingerprint).toBe(e.fingerprint)
  })

  it('the real MK-089 drift: the entry as it was written no longer resolves in the current tree', () => {
    const text = readFileSync('packages/core/src/math/previewRedeem.ts', 'utf8')
    const asWritten = {
      id: 'MK-089 as written',
      file: 'packages/core/src/math/previewRedeem.ts',
      scope: 'marginFor',
      from: '    principal: trove.principal,',
    }
    expect(
      oldApply(text, asWritten.from, '    principal: trove.entireDebt,'),
      'the old matcher found it, in partialRedemptionBand',
    ).toContain('principal: trove.entireDebt')
    expect(() => locate(asWritten, text)).toThrow(/occurs 0 times inside `marginFor`/)
  })
})
