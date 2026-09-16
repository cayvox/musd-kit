import { describe, expect, it } from 'vitest'
import { RETIRED_CLAIMS, findRetiredClaims } from '../../../scripts/retired-claims.mjs'

/**
 * MK-246, the retired claims check: each entry catches the claim as it was worded, and does not catch the
 * sentence that corrects it.
 *
 * The texts under "was" are the lines 0.4.1 shipped, copied from its published `dist/index.d.ts`, source
 * maps and READMEs (the two the consumer audit found first). The texts under "now" are the corrections
 * this wave ships in their place. A check that matched a correction would fail every build, and one that
 * missed a claim would pass the artifact MK-246 is about, so both directions are pinned.
 */
const CASES: { finding: string; was: string; now: string }[] = [
  {
    finding: 'MK-001',
    was: '    /** Normal-mode liquidatability (`getCurrentICR < MCR`). */',
    now: '   * not the last Trove in the system (MK-001, MK-074). The protocol has no Recovery Mode widening',
  },
  {
    finding: 'MK-001',
    was: ' * redemption (fully-redeemed Trove) or a Recovery-Mode liquidation of an above-MCR Trove.',
    now: ' * protocol has no Recovery Mode liquidation (MK-001), which this comment claimed until MK-246.',
  },
  {
    finding: 'MK-090',
    was: '    /** Nominal collateral ratio `(collateral × 1e20) / entireDebt` (pure, no network). */',
    now: '   * Nominal collateral ratio `(collateral × 1e20) / principal` (pure, no network). The sorted list is',
  },
  {
    finding: 'MK-101',
    was: ' *   - Capacity is set ONCE, at open, from the OPENING price:',
    now: ' *   - Capacity is first set at open, from the OPENING price:',
  },
  {
    finding: 'MK-240',
    was: 'it and take all of the collateral. **Offer `recommended`.** It is solved against a price stressed by a',
    now: 'Until 0.5.0 this function returned a `recommended` draw sized for one hour and a 2% fall, and this',
  },
  {
    finding: 'MK-240',
    was: 'on `BORROWING_POWER_PRICE_MOVE_BPS` and `BORROWING_POWER_MARGIN_WINDOW_SECONDS`.',
    now: "accrual. **Both inputs are the caller's, with no default**: until 0.5.0 a `recommended` figure used",
  },
  {
    finding: 'MK-241',
    was: ' * **Do not size a redemption from `RedeemResult.truncatedAmount`.** That is what',
    now: ' * **Do not size a redemption from `getRedemptionHints`.** Its truncated amount answers a different',
  },
  {
    finding: 'MK-241',
    was: '// `truncatedAmount` as DATA on its result (Phase 6 decision). `ApprovalRequired` is not',
    now: '// asked reports it as DATA, `RedeemResult.settled.unredeemedAmount` since MK-241, where it was the hint',
  },
  {
    finding: 'MK-243',
    was: ' * The resulting ICR would fall below MCR. Preview-time sibling of {@link ICRBelowMCR}:',
    now: ' * The individual ratio gate, `_requireICRisAboveMCR` (`BorrowerOperations.sol:1330-1335`): an operation',
  },
  {
    finding: 'MK-246',
    was: 'has nothing to preview because `_claimCollateral` (`BorrowerOperations.sol:1119-1124`) has no',
    now: 'one condition, a surplus to claim (`CollSurplusPool.sol:90-93`): `getClaimableCollateral` reads it, and',
  },
  {
    finding: 'MK-246',
    was: '  // getTroveInterestOwed/getTroveDebt, those return the STORED (stale) snapshot, which',
    now: ' *     pending redistribution as that update does (`TroveManager.sol:796-801`). `getTroveDebt` accrues to',
  },
  {
    finding: 'MK-246',
    was: '    /** Optional in Phase 1 (writes arrive in Phase 5); reads use `publicClient`. */',
    now: '  /** Required for the write methods, which throw `MissingWalletClient` without one; reads use `publicClient`. */',
  },
  {
    finding: 'MK-252',
    was: '   * `trove/index.ts` reads the flag from PRESENCE. Optional so existing callers keep the old',
    now: '   * **MK-244, and MK-252 for this comment**: the flag is now derived FROM THE VALUE, by',
  },
  {
    finding: 'MK-252',
    was: " * reads `_isDebtIncrease` from PRESENCE (MK-060), mirroring `_adjustTrove`'s own separate",
    now: ' * **Since 0.5.0 the flag is derived from the VALUE (MK-244; this comment is MK-252).** A leg of',
  },
  {
    finding: 'MK-247',
    was: ' * This is the "max" button\'s number. `limitedBy` says whether the cap is the position\'s own',
    now: ' * rises first, accepted and left at MCR, where the next fall liquidates it. Do not wire it to a "max"',
  },
]

describe('MK-246, the retired claims check reads the claim and not its correction', () => {
  for (const c of CASES) {
    it(`${c.finding}: catches "${c.was.trim().slice(0, 60)}" and not the line that replaced it`, () => {
      const was = findRetiredClaims([{ path: 'was', text: c.was }])
      expect(
        was.map((h) => h.finding),
        'the retired claim is found',
      ).toContain(c.finding)
      expect(findRetiredClaims([{ path: 'now', text: c.now }]), 'the correction is not').toEqual([])
    })
  }

  it('MK-246: every entry names a finding and is exercised by a case above', () => {
    for (const entry of RETIRED_CLAIMS) {
      expect(entry.finding).toMatch(/^MK-\d{3}$/)
      expect(
        CASES.some((c) => entry.claim.test(c.was)),
        `no case exercises ${entry.claim}`,
      ).toBe(true)
    }
  })

  it('MK-246: a hit reports its finding, file and line', () => {
    const hits = findRetiredClaims([
      {
        path: 'dist/index.d.ts',
        text: 'first line\n    /** Normal-mode liquidatability (`getCurrentICR < MCR`). */',
      },
    ])
    expect(hits).toEqual([
      expect.objectContaining({ finding: 'MK-001', path: 'dist/index.d.ts', line: 2 }),
    ])
  })
})
