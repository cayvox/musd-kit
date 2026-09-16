import { describe, expect, it } from 'vitest'
import {
  deprecatedIn,
  pollUntilMatches,
  verdictFor,
  worthRetrying,
} from '../../../scripts/deprecation-verify.mjs'

/**
 * MK-256, reading a deprecation back without believing a cache.
 *
 * The 0.5.0 release deprecated `@musd-kit/core@0.4.0` for the second time. The write succeeded and
 * the workflow went red, because it read the message back with `npm view`, retried only while the
 * answer was EMPTY, and the answer was not empty: it was the message from 2026-09-14, still being
 * served while the new one propagated. Then the re-dispatch that would have produced a green run
 * failed with `E422`, since by then there was nothing left to change.
 *
 * So the sequence below is the one that actually happened, and the loop has to survive it: absent,
 * then the PREVIOUS text, then the intended text. The old rule stopped at the second step and
 * called a correct deprecation a forgery.
 */
const INTENDED =
  '0.4.0 getBorrowingPower returns a recommended draw sized for one hour and a 2% fall (MK-240). Upgrade to 0.5.0.'
const PREVIOUS =
  '0.4.0 previewRedeem reads maxIterations 0n as one eligible Trove (MK-114). Upgrade to 0.4.1.'

describe('MK-256, the deprecation read distinguishes propagating from wrong', () => {
  it('a matching text is the only state that stops the loop', () => {
    expect(verdictFor(INTENDED, INTENDED)).toEqual({ state: 'matches' })
    expect(worthRetrying(verdictFor(INTENDED, INTENDED))).toBe(false)
  })

  it('an absent message and a PREVIOUS message are both worth reading again', () => {
    expect(verdictFor('', INTENDED)).toEqual({ state: 'absent' })
    expect(verdictFor(undefined, INTENDED)).toEqual({ state: 'absent' })
    expect(verdictFor(PREVIOUS, INTENDED)).toEqual({ state: 'different', onRegistry: PREVIOUS })
    expect(worthRetrying(verdictFor('', INTENDED))).toBe(true)
    // The line that cost a red run: the old step treated any non empty answer as final.
    expect(worthRetrying(verdictFor(PREVIOUS, INTENDED))).toBe(true)
  })

  it('the sequence the release saw, absent then the previous text then the intended one, passes', async () => {
    const answers = ['', PREVIOUS, PREVIOUS, INTENDED]
    let reads = 0
    const verdict = await pollUntilMatches({
      pkg: 'core',
      version: '0.4.0',
      intended: INTENDED,
      read: async () => answers[reads++] ?? INTENDED,
      attempts: 6,
      intervalMs: 0,
      log: () => {},
      sleep: async () => {},
    })
    expect(verdict).toEqual({ state: 'matches' })
    expect(reads, 'it kept reading until the registry served the new text').toBe(4)
  })

  it('a message that never becomes the intended one still FAILS, with what was there', async () => {
    const verdict = await pollUntilMatches({
      pkg: 'core',
      version: '0.4.0',
      intended: INTENDED,
      read: async () => PREVIOUS,
      attempts: 3,
      intervalMs: 0,
      log: () => {},
      sleep: async () => {},
    })
    expect(verdict).toEqual({ state: 'different', onRegistry: PREVIOUS })
  })

  it('a version that is never deprecated FAILS as absent rather than passing quietly', async () => {
    const verdict = await pollUntilMatches({
      pkg: 'react',
      version: '0.9.9',
      intended: INTENDED,
      read: async () => '',
      attempts: 2,
      intervalMs: 0,
      log: () => {},
      sleep: async () => {},
    })
    expect(verdict).toEqual({ state: 'absent' })
  })

  it('reads the deprecated field out of a registry document, and treats a missing one as absent', () => {
    const doc = {
      versions: {
        '0.4.0': { deprecated: INTENDED },
        '0.5.0': {},
      },
    }
    expect(deprecatedIn(doc, '0.4.0')).toBe(INTENDED)
    expect(deprecatedIn(doc, '0.5.0')).toBe('')
    expect(deprecatedIn(doc, '9.9.9')).toBe('')
    expect(deprecatedIn(undefined, '0.4.0')).toBe('')
  })

  it('an empty intended message is refused rather than matched against nothing', () => {
    expect(() => verdictFor('', '')).toThrow(/intended message is required/)
  })
})
