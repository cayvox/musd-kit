import { describe, expect, it } from 'vitest'
import {
  EXPECTED_MISMATCHES,
  type ExpectedMismatch,
  partitionMismatches,
} from './differential/expected'
import type { CaseOp, DiffCase } from './differential/generate'
import type { CaseResult } from './differential/harness'

/**
 * The mechanism that decides whether the sweep's red is worth reading.
 *
 * **Why this is a chain free test of a chain bound gate.** The full sweep runs for about two
 * hours and, after this wave, weekly. The question "does an unregistered mismatch still fail the
 * run" cannot wait two hours for an answer, and a gate nobody can cheaply verify is the shape
 * MK-053 and MK-078 were both about. `partitionMismatches` is pure precisely so this file can
 * exist, and `scripts/mutation-check.mjs` breaks it in both directions to prove the assertions
 * below are load bearing.
 */

const E18 = 10n ** 18n

function mkCase(over: Partial<DiffCase> = {}): DiffCase {
  return {
    index: 0,
    seed: 20260826,
    band: 'boundary',
    op: 'adjust' as CaseOp,
    collateral: 340_000_000_000_000_000n,
    debt: 0n,
    pricePercent: 100,
    elapsedSeconds: 0,
    precondition: 'OCCUPIED',
    redeemBand: 'AT_NET_DEBT',
    recoveryDrawdownPercent: 0,
    ...over,
  } as DiffCase
}

/** The MK-079 shape: an adjust case with a zero debt leg, blocked on ZERO_DEBT_INCREASE. */
function mk079(index: number, debt = 0n): CaseResult {
  return {
    case: mkCase({ index, debt }),
    previewViable: false,
    chainSucceeded: true,
    mismatch: {
      direction: 'FALSE_BLOCKED',
      detail: 'the preview said NOT VIABLE and the chain accepted it. reasons=[ZERO_DEBT_INCREASE]',
    },
  }
}

/** Anything the registry does not cover. This is what the gate exists to catch. */
function unregistered(over: Partial<CaseResult> = {}): CaseResult {
  return {
    case: mkCase({ index: 77, op: 'borrow' as CaseOp, debt: 5_000n * E18 }),
    previewViable: true,
    chainSucceeded: false,
    mismatch: {
      direction: 'FALSE_VIABLE',
      detail: 'the preview said VIABLE and the chain refused it. reasons=[]',
    },
    ...over,
  }
}

describe('MK-079, the registered mismatch mechanism', () => {
  it('a registered mismatch does NOT fail the run, and is reported with its finding ID', () => {
    const p = partitionMismatches([mk079(209), mk079(252, 1n)])
    expect(p.unexpected, 'registered mismatches must not fail the sweep').toEqual([])
    expect(p.expected).toHaveLength(1)
    expect(p.expected[0]?.finding).toBe('MK-079')
    expect(p.expected[0]?.results.map((r) => r.case.index)).toEqual([209, 252])
  })

  it('an UNREGISTERED mismatch fails the run', () => {
    const p = partitionMismatches([unregistered()])
    expect(p.unexpected).toHaveLength(1)
    expect(p.unexpected[0]?.case.index).toBe(77)
    expect(p.expected).toEqual([])
  })

  it('and the two do not mask each other in the same run', () => {
    // The case that matters most: a real defect arriving alongside the known one. The known one
    // must not make the run green.
    const p = partitionMismatches([mk079(209), unregistered(), mk079(893)])
    expect(p.unexpected).toHaveLength(1)
    expect(p.unexpected[0]?.mismatch?.direction).toBe('FALSE_VIABLE')
    expect(p.expected[0]?.results).toHaveLength(2)
  })

  /* --- the predicate is narrow, which is the property that keeps this honest --- */

  it('MK-079 does not swallow an adjust FALSE_BLOCKED with a different reason', () => {
    const other = mk079(300)
    other.mismatch = { direction: 'FALSE_BLOCKED', detail: 'reasons=[TCR_BELOW_CCR]' }
    expect(partitionMismatches([other]).unexpected).toHaveLength(1)
  })

  it('MK-079 does not swallow a ZERO_DEBT_INCREASE block on a case with a real debt leg', () => {
    // `adjustDebt` is `c.debt / 4n`, so a debt of 4 or more produces a NON zero leg and the
    // defect cannot be the explanation.
    expect(partitionMismatches([mk079(301, 4n)]).unexpected).toHaveLength(1)
    expect(partitionMismatches([mk079(302, 3n)]).unexpected).toEqual([])
  })

  it('MK-079 does not swallow the other direction', () => {
    const flipped = mk079(303)
    flipped.mismatch = { direction: 'FALSE_VIABLE', detail: 'reasons=[ZERO_DEBT_INCREASE]' }
    expect(partitionMismatches([flipped]).unexpected).toHaveLength(1)
  })

  it('MK-079 does not swallow a different operation', () => {
    const borrowed = mk079(304)
    borrowed.case = mkCase({ index: 304, op: 'borrow' as CaseOp, debt: 0n })
    expect(partitionMismatches([borrowed]).unexpected).toHaveLength(1)
  })

  /* --- disappearance is information, not a pass and not a failure --- */

  it('reports a registered mismatch that stopped reproducing, for a run that covered it', () => {
    const p = partitionMismatches([mk079(209)], EXPECTED_MISMATCHES, {
      seed: 20260826,
      cases: 1000,
      coveredIndices: [209, 252, 329],
    })
    expect(p.unexpected, 'a disappearance is reported, never failed').toEqual([])
    expect(p.didNotReproduce).toHaveLength(1)
    expect(p.didNotReproduce[0]?.finding).toBe('MK-079')
    expect(p.didNotReproduce[0]?.indices).toEqual([252, 329])
  })

  it('says nothing about indices the run did not cover', () => {
    // A slice that never reached case 893 has no evidence about it. Claiming a disappearance
    // there would be the same error as reporting a band that never ran as a pass.
    const p = partitionMismatches([mk079(209)], EXPECTED_MISMATCHES, {
      seed: 20260826,
      cases: 1000,
      coveredIndices: [209],
    })
    expect(p.didNotReproduce).toEqual([])
  })

  it('says nothing when the run is a different generation from the one knownAt describes', () => {
    // `generateCases` takes the count as an input to the PRNG, so indices from a 1000 case run
    // mean nothing in a 400 case one (MK-069).
    const p = partitionMismatches([], EXPECTED_MISMATCHES, {
      seed: 20260826,
      cases: 400,
      coveredIndices: [209, 252, 329, 370, 449, 455, 486, 720, 817, 893],
    })
    expect(p.didNotReproduce).toEqual([])
  })

  /* --- the registry itself --- */

  it('every entry carries a finding ID and a reason, so nothing is expected anonymously', () => {
    expect(EXPECTED_MISMATCHES.length).toBeGreaterThan(0)
    for (const e of EXPECTED_MISMATCHES) {
      expect(e.finding, 'an expected mismatch without a finding ID is a silenced one').toMatch(
        /^MK-\d{3}$/,
      )
      expect(e.why.length, `${e.finding} needs a reason a reader can check`).toBeGreaterThan(40)
    }
  })

  it('an empty registry makes every mismatch unexpected, which is the safe default', () => {
    const empty: ExpectedMismatch[] = []
    expect(partitionMismatches([mk079(209), unregistered()], empty).unexpected).toHaveLength(2)
  })
})
