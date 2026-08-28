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
/**
 * Run only cases at or after this index, from the SAME generated set.
 *
 * A thousand cases does not fit one run. Per case cost degrades late in a long sweep, measured
 * at roughly 3 to 4 seconds each for the first 800 and about 20 seconds each after that, so the
 * run reaches its own timeout with the last hundred unswept. Slicing covers the full tuple set
 * from one seed across two runs, which is NOT the same as generating two different sets, and is
 * why this is an index into the same generation rather than a second seed.
 */
const FROM_CASE = Number(process.env.MK_DIFF_FROM ?? 0)
/**
 * Run only cases BELOW this index, from the same generated set. The upper half of a slice.
 *
 * `MK_DIFF_FROM` alone could only ever cut a tail, so a thousand cases had to be either one
 * run or a series of overlapping ones. Measured on the 0.2.0 release sweep: cases 1 to 100
 * took 582s (5.8s each) and cases 101 to 200 took 882s (8.8s each), because the cost grows
 * with the LIFE of the anvil process rather than with the case index. A single thousand case
 * run therefore reaches this test's own timeout part way through, and the fix is a fresh
 * anvil per slice, which needs a bound at both ends.
 */
const TO_CASE = process.env.MK_DIFF_TO !== undefined ? Number(process.env.MK_DIFF_TO) : undefined
/**
 * Run only cases whose operation matches, from the same generated set.
 *
 * Added while closing MK-048. The sweep reports how many cases RAN and how many were skipped, but
 * a skip carries a reason and not an operation, so after a thousand cases nobody could say how many
 * REDEMPTIONS had actually reached the chain. A redemption case skips for a reason no other case
 * has: at the extreme band's low price multipliers every Trove falls below MCR, so the loop finds
 * nothing and there is no first eligible Trove to have a headroom. **A band that never ran proves
 * nothing, and the count is the only thing that distinguishes the two.**
 *
 *   MK_DIFF_OP=redeem MK_DIFF_CASES=1000 pnpm test:fork
 */
const ONLY_OP = process.env.MK_DIFF_OP

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
      `[differential] seed=${SEED} cases=${CASES} minNetDebt=${minNetDebt} price=${price}${FROM_CASE > 0 ? ` FROM_CASE=${FROM_CASE}` : ''}${TO_CASE !== undefined ? ` TO_CASE=${TO_CASE}` : ''}${ONLY_CASE !== undefined ? ` ONLY_CASE=${ONLY_CASE}` : ''}`,
    )

    let cases: DiffCase[] = generateCases(SEED, CASES, { minNetDebt, price })
    if (FROM_CASE > 0) cases = cases.filter((c) => c.index >= FROM_CASE)
    if (TO_CASE !== undefined) cases = cases.filter((c) => c.index < TO_CASE)
    if (ONLY_CASE !== undefined) cases = cases.filter((c) => c.index === ONLY_CASE)
    if (ONLY_OP !== undefined) cases = cases.filter((c) => c.op === ONLY_OP)

    const results: CaseResult[] = []
    const started = Date.now()
    for (const c of cases) {
      const result = await runCase(fork, c)
      results.push(result)
      // Print a mismatch THE MOMENT it happens, not in a summary at the end. A thousand case
      // sweep hit the test timeout at case ~700 and every mismatch it had already found went
      // with it, because they were only printed after the loop. A finding this harness
      // produces has to survive the run that produced it.
      if (result.mismatch !== undefined) console.log(reportFailure(result))
      if (result.threw !== undefined) {
        console.log(`[differential] THREW ${describeCase(result.case)} :: ${result.threw}`)
      }
      // Progress on a long sweep, so a run that is working is distinguishable from one that
      // has hung. A thousand cases is twenty minutes of silence otherwise.
      if ((c.index + 1) % 100 === 0) {
        const so_far = results.filter((r) => r.mismatch !== undefined).length
        console.log(
          `[differential] ${c.index + 1}/${cases.length} done, ${Math.round((Date.now() - started) / 1000)}s elapsed, mismatches so far=${so_far}`,
        )
      }
    }
    const elapsedMs = Date.now() - started

    const mismatches = results.filter((r) => r.mismatch !== undefined)
    const falseViable = mismatches.filter((r) => r.mismatch?.direction === 'FALSE_VIABLE')
    const falseBlocked = mismatches.filter((r) => r.mismatch?.direction === 'FALSE_BLOCKED')
    const numbers = mismatches.filter((r) => r.mismatch?.direction === 'NUMBERS')
    const skipped = results.filter((r) => r.skipped !== undefined)
    const threw = results.filter((r) => r.threw !== undefined)
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
    // Redemption coverage by band, ran against skipped. A band with a zero in the ran column is a
    // band the sweep did not exercise, whatever the headline case count says.
    const redeemCases = results.filter((r) => r.case.op === 'redeem')
    if (redeemCases.length > 0) {
      const tally = new Map<string, { ran: number; skipped: number }>()
      for (const r of redeemCases) {
        const row = tally.get(r.case.redeemBand) ?? { ran: 0, skipped: 0 }
        if (r.skipped !== undefined) row.skipped++
        else row.ran++
        tally.set(r.case.redeemBand, row)
      }
      console.log(
        `[differential] redeem bands: ${[...tally.entries()]
          .map(([band, row]) => `${band} ran=${row.ran} skipped=${row.skipped}`)
          .join('  ')}`,
      )
    }
    for (const s of skipped.slice(0, 5)) {
      console.log(`[differential] skipped ${describeCase(s.case)} :: ${s.skipped}`)
    }
    // Thrown cases are reported IN FULL, never truncated: a preview is documented as
    // returning a verdict rather than throwing, so every one of these is worth a finding.
    console.log(`[differential] threw=${threw.length}`)
    // Repeated at the end as a digest; each one was already printed when it happened.
    for (const m of mismatches) console.log(reportFailure(m))

    expect(
      mismatches.map((m) => `${m.mismatch?.direction} @ case ${m.case.index}`),
      'every mismatch is a finding: register it with the seed and the tuple as its reproduction',
    ).toEqual([])
    // The timeout is sized for the job rather than for a guess. Measured at roughly 4.3
    // seconds per case, a thousand cases is about 72 minutes, and the first attempt at this
    // sweep was killed at 3000s with 700 cases done. 90 minutes leaves room on a loaded
    // machine. This is a long job by design, which is why it is opt in and not on the push
    // path; see `docs/07-testing.md` §4a.
  }, 5_400_000)
})
