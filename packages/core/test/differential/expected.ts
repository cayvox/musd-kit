import type { CaseResult } from './harness'

/**
 * Mismatches the sweep is KNOWN to produce, each tied to the finding that explains it.
 *
 * **Why this file exists.** MK-079 is a real defect in the harness's own argument mapping and it
 * is registered and open. Left alone, it makes the full sweep exit 1 every time, and a gate whose
 * red has to be remembered is not a gate: the next person sees a failing sweep, recalls that one
 * of them is expected, and stops reading the rest. That is how MK-053's verification job sat
 * unexecuted for two releases while looking like a control, and this programme has now spent five
 * waves on variations of the same mistake.
 *
 * So the expected set lives HERE, in code, with a finding ID on every entry, and the sweep fails
 * on anything it does not cover. Three properties follow, and all three are the point:
 *
 *   - an UNEXPECTED mismatch fails the run and is named, which is what a gate is for;
 *   - a registered one does not, so the red is real when it appears;
 *   - a registered one that STOPS reproducing is reported, because an expected failure that
 *     quietly disappears means either the defect was fixed and nobody updated this file, or the
 *     generator stopped reaching it, and those need different responses.
 *
 * **Matching is on SHAPE, not on case index.** An index is meaningful only for one seed at one
 * case count, and `generateCases` takes the count as an input to the PRNG rather than as a window
 * onto a fixed sequence, so `MK_DIFF_CASES=400` and `MK_DIFF_CASES=1000` are different tuple sets
 * (MK-069, learned the expensive way in MK-078). A shape survives that; an index does not.
 * `knownAt` records the indices anyway, for the disappearance check alone, and is scoped to the
 * exact seed and count it was measured at.
 */
export interface ExpectedMismatch {
  /** The register entry that explains this mismatch. Required: no anonymous expectations. */
  finding: string
  /** One line on why the sweep produces it, for a reader who has not opened the register. */
  why: string
  /**
   * Whether this finding explains that result. Deliberately narrow: a predicate that matches
   * more than its finding covers would swallow a real defect, which is the one failure mode
   * this whole file is trying to prevent.
   */
  matches: (result: CaseResult) => boolean
  /**
   * Where it reproduced, for the disappearance report only. Scoped to a seed and a case count
   * because indices mean nothing outside them, and never used for matching.
   */
  knownAt?: { seed: number; cases: number; indices: readonly number[] }
}

export const EXPECTED_MISMATCHES: readonly ExpectedMismatch[] = [
  {
    finding: 'MK-079',
    why:
      'adjustCase passes its legs verbatim to previewAdjustTrove but filters them on > 0n before ' +
      'calling adjustTrove, so for an adjust case whose generated debt is under 4 wei the preview ' +
      'is asked about a zero debt increase (correctly ZERO_DEBT_INCREASE) while the chain is asked ' +
      'for a pure collateral top-up (correctly accepted). Both SDK halves are right about their ' +
      'own call; the harness compares two different calls.',
    matches: (r) =>
      r.case.op === 'adjust' &&
      r.mismatch?.direction === 'FALSE_BLOCKED' &&
      // The reason string is what ties it to the defect rather than to "some adjust case failed".
      (r.mismatch?.detail ?? '').includes('ZERO_DEBT_INCREASE') &&
      // `adjustDebt` is `c.debt / 4n`, so this is exactly the band that yields a zero debt leg.
      r.case.debt < 4n,
    knownAt: {
      seed: 20260826,
      cases: 1000,
      indices: [209, 252, 329, 370, 449, 455, 486, 720, 817, 893],
    },
  },
]

/** What {@link partitionMismatches} returns: the two halves, plus the disappearance report. */
export interface MismatchPartition {
  /** Mismatches no registered finding explains. **These fail the run.** */
  unexpected: CaseResult[]
  /** Mismatches a registered finding explains, grouped by finding ID. */
  expected: { finding: string; why: string; results: CaseResult[] }[]
  /**
   * Registered indices that did NOT reproduce, for the seeds and counts this run actually
   * covered. Empty when the run's seed or count does not match any `knownAt`, because absence
   * of evidence is not evidence of absence and reporting it as a disappearance would be a lie.
   */
  didNotReproduce: { finding: string; indices: number[] }[]
}

/**
 * Split the run's mismatches into the registered and the unregistered.
 *
 * Pure, so the mechanism can be mutation tested without a chain. That matters more than usual
 * here: this function decides whether the sweep is a gate or a formality, and it is exercised on
 * a real sweep roughly once a week.
 *
 * The FIRST matching entry wins and a result is never counted twice, so two overlapping
 * predicates cannot make one mismatch disappear from the unexpected list twice over.
 */
export function partitionMismatches(
  mismatches: readonly CaseResult[],
  registry: readonly ExpectedMismatch[] = EXPECTED_MISMATCHES,
  run?: { seed: number; cases: number; coveredIndices: readonly number[] },
): MismatchPartition {
  const unexpected: CaseResult[] = []
  const buckets = new Map<string, CaseResult[]>()

  for (const m of mismatches) {
    const hit = registry.find((e) => e.matches(m))
    if (hit === undefined) {
      unexpected.push(m)
      continue
    }
    const bucket = buckets.get(hit.finding) ?? []
    bucket.push(m)
    buckets.set(hit.finding, bucket)
  }

  const expected = registry
    .filter((e) => buckets.has(e.finding))
    .map((e) => ({
      finding: e.finding,
      why: e.why,
      results: buckets.get(e.finding) as CaseResult[],
    }))

  const didNotReproduce: { finding: string; indices: number[] }[] = []
  if (run !== undefined) {
    const covered = new Set(run.coveredIndices)
    const seen = new Set(mismatches.map((m) => m.case.index))
    for (const e of registry) {
      const k = e.knownAt
      // Only speak about a run whose generation this `knownAt` actually describes.
      if (k === undefined || k.seed !== run.seed || k.cases !== run.cases) continue
      const missing = k.indices.filter((i) => covered.has(i) && !seen.has(i))
      if (missing.length > 0) didNotReproduce.push({ finding: e.finding, indices: missing })
    }
  }

  return { unexpected, expected, didNotReproduce }
}
