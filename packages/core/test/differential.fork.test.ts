import { describe, expect, it } from 'vitest'
import { type DiffCase, describeCase, generateCases } from './differential/generate'
import { type CaseResult, reportFailure, runCase } from './differential/harness'
import { connectFork } from './harness'

/**
 * The differential harness: preview verdict against what the chain actually does.
 *
 * **Why this and not more formula checks.** The formula level cross checks against the
 * contract's own `pure` helpers exist and are green (`docs/09-review-and-validated-surface.md`
 * §3). They could not have caught MK-004, MK-005 or MK-006, because all three were preview
 * VERDICTS that disagreed with the chain while every formula agreed. The existing gate is also
 * single point and open path only, which is the row that page tells you to read twice.
 *
 * **Placement.** `MK_DIFF_CASES` sets the count. The default is small and deterministic so it
 * can sit on the push path; the full sweep is opt in, because a thousand cases against a fork
 * is not a per push job and hiding it behind something nobody runs is the other failure mode.
 * The measured cost and the split are in `docs/07-testing.md`.
 *
 *   pnpm test:fork                                  the push subset
 *   MK_DIFF_CASES=1000 pnpm test:fork               the full sweep
 *   MK_DIFF_SEED=123 MK_DIFF_CASE=57 pnpm test:fork replay exactly one case
 */
const CASES = Number(process.env.MK_DIFF_CASES ?? 24)
const SEED = Number(process.env.MK_DIFF_SEED ?? 20260826)
const ONLY_CASE =
  process.env.MK_DIFF_CASE !== undefined ? Number(process.env.MK_DIFF_CASE) : undefined

describe('Differential harness, preview verdict against chain outcome', () => {
  it(`sweeps ${CASES} generated cases`, async () => {
    const fork = connectFork()
    const client = (await import('../src')).createMusdClient({
      chainId: 31611,
      publicClient: fork.publicClient,
    })
    const [{ minNetDebt }, price] = await Promise.all([
      client.getConstants(),
      client.getOraclePrice(),
    ])

    // The seed is printed on EVERY run, passing or failing. A failure this harness reports has
    // to be replayable, and a seed only visible on failure is a seed nobody has when they need
    // it.
    console.log(
      `[differential] seed=${SEED} cases=${CASES} minNetDebt=${minNetDebt} price=${price}` +
        (ONLY_CASE !== undefined ? ` ONLY_CASE=${ONLY_CASE}` : ''),
    )

    let cases: DiffCase[] = generateCases(SEED, CASES, { minNetDebt, price })
    if (ONLY_CASE !== undefined) cases = cases.filter((c) => c.index === ONLY_CASE)

    const results: CaseResult[] = []
    const started = Date.now()
    for (const c of cases) {
      results.push(await runCase(fork, c))
    }
    const elapsedMs = Date.now() - started

    const mismatches = results.filter((r) => r.mismatch !== undefined)
    const falseViable = mismatches.filter((r) => r.mismatch?.direction === 'FALSE_VIABLE')
    const falseBlocked = mismatches.filter((r) => r.mismatch?.direction === 'FALSE_BLOCKED')
    const numbers = mismatches.filter((r) => r.mismatch?.direction === 'NUMBERS')
    const skipped = results.filter((r) => r.skipped !== undefined)
    const byBand = (band: string) => results.filter((r) => r.case.band === band).length

    // Reported by DIRECTION, always, because a preview that says go when the chain refuses and
    // one that says stop when the chain would accept are different defects with different
    // costs, and one number hides which you have.
    console.log(
      `[differential] done in ${elapsedMs}ms  ran=${results.length} skipped=${skipped.length}` +
        `  bands: boundary=${byBand('boundary')} extreme=${byBand('extreme')} middle=${byBand('middle')}`,
    )
    console.log(
      `[differential] mismatches: FALSE_VIABLE=${falseViable.length} FALSE_BLOCKED=${falseBlocked.length} NUMBERS=${numbers.length}`,
    )
    for (const s of skipped.slice(0, 5)) {
      console.log(`[differential] skipped ${describeCase(s.case)} :: ${s.skipped}`)
    }
    for (const m of mismatches) console.log(reportFailure(m))

    expect(
      mismatches.map((m) => `${m.mismatch?.direction} @ case ${m.case.index}`),
      'every mismatch is a finding: register it with the seed and the tuple as its reproduction',
    ).toEqual([])
  }, 3_000_000)
})
