import { describe, expect, it } from 'vitest'
import { MCR, evaluateRedeem } from '../src'

const MUSD = 10n ** 18n
const PRICE = 80_000n * MUSD

/**
 * MK-048. The redeemable set has a GAP, not a cap, and no field expressed it.
 *
 * Derived from `mezo-org/musd` and then verified on a fork to the wei. For the first eligible
 * Trove with net debt `D` and floor `M`:
 *
 *   A <= D - M      succeeds, a partial inside the headroom
 *   D - M < A < D   REVERTS: `TroveManager.sol:1218-1221` hands the whole amount to that Trove,
 *                   `:1299-1306` cancels the partial, `:392` breaks, `:406-408` reverts
 *   A >= D          succeeds: the Trove is consumed whole via `:1252`, a branch with no hint
 *                   check and no floor check
 *
 * The fork measurement, with `getRedemptionHints`'s answer beside each:
 *
 *   headroom exactly  208463779941643739864  hint said the same  SUCCEEDS
 *   headroom + 1 wei                         hint said the same  REVERT
 *   netDebt / 2                              hint said the same  REVERT
 *   netDebt - 1 wei                          hint said the same  REVERT
 *   netDebt exactly  2008463779941643739864  hint said the same  SUCCEEDS
 *   netDebt + 1 wei                          hint said the same  SUCCEEDS
 */
const M = 1_800n * MUSD
const D1 = 2_008n * MUSD
const HEADROOM = D1 - M // 208 MUSD

const base = {
  musdBalance: 1_000_000n * MUSD,
  minNetDebt: M,
  tcr: 2n * MUSD,
  price: PRICE,
  eligible: [{ owner: '0xaaa' as `0x${string}`, netDebt: D1 }],
}

describe('MK-048, the gap the debt floor creates', () => {
  it('a partial at exactly the headroom is viable, and one wei more is not', () => {
    const at = evaluateRedeem({ ...base, amount: HEADROOM })
    const past = evaluateRedeem({ ...base, amount: HEADROOM + 1n })
    expect(at.viable, 'the headroom itself is redeemable').toBe(true)
    expect(at.redeemable).toBe(HEADROOM)
    expect(past.viable, 'one wei past it is not').toBe(false)
    expect(past.bindingConstraint).toBe('PARTIAL_BREACHES_DEBT_FLOOR')
    expect(past.redeemable, 'and nothing would be redeemed, because the call reverts').toBe(0n)
  })

  it('every amount strictly inside the gap is refused', () => {
    for (const a of [HEADROOM + 1n, D1 / 2n, D1 - 1n]) {
      const p = evaluateRedeem({ ...base, amount: a })
      expect(p.viable, `amount ${a}`).toBe(false)
      expect(p.reasons, `amount ${a}`).toContain('PARTIAL_BREACHES_DEBT_FLOOR')
    }
  })

  it('consuming the Trove WHOLE is viable, because that branch has no floor check', () => {
    // `:1252` closes the Trove by redemption and never reaches the cancellation at `:1299`.
    const exact = evaluateRedeem({ ...base, amount: D1 })
    expect(exact.viable).toBe(true)
    expect(exact.redeemable).toBe(D1)
  })

  it('the preview reports BOTH edges of the gap, which is what a caller acts on', () => {
    const p = evaluateRedeem({ ...base, amount: D1 / 2n })
    expect(p.maxWithoutConsuming, 'the lower edge').toBe(HEADROOM)
    expect(p.nextViableAmount, 'the upper edge').toBe(D1)
    // Both edges must themselves be viable, or the advice is wrong.
    expect(evaluateRedeem({ ...base, amount: p.maxWithoutConsuming }).viable).toBe(true)
    expect(evaluateRedeem({ ...base, amount: p.nextViableAmount }).viable).toBe(true)
  })

  it('a cancel AFTER the first Trove does not revert, it redeems less', () => {
    // `require(totalCollateralDrawn > 0)` (`:406-408`) only fires when NOTHING was drawn. With
    // the first Trove consumed whole, a cancel on the second leaves a successful call.
    const two = {
      ...base,
      eligible: [
        { owner: '0xaaa' as `0x${string}`, netDebt: D1 },
        { owner: '0xbbb' as `0x${string}`, netDebt: D1 },
      ],
    }
    const p = evaluateRedeem({ ...two, amount: D1 + D1 / 2n })
    expect(p.viable, 'the call goes through').toBe(true)
    expect(p.redeemable, 'but it redeems only the first Trove').toBe(D1)
    expect(p.redeemable, 'which is less than requested').toBeLessThan(D1 + D1 / 2n)
  })

  it('the three contract gates come first, in call order', () => {
    // `:318` TCR, `:319` amount, `:320` balance.
    expect(evaluateRedeem({ ...base, amount: HEADROOM, tcr: MCR - 1n }).bindingConstraint).toBe(
      'SYSTEM_TCR_BELOW_MCR',
    )
    expect(evaluateRedeem({ ...base, amount: 0n }).reasons).toContain('AMOUNT_ZERO')
    expect(evaluateRedeem({ ...base, amount: HEADROOM, musdBalance: 1n }).reasons).toContain(
      'INSUFFICIENT_MUSD_BALANCE',
    )
  })

  it('no eligible Trove is reported rather than guessed at', () => {
    const p = evaluateRedeem({ ...base, amount: HEADROOM, eligible: [] })
    expect(p.reasons).toContain('NOTHING_REDEEMABLE')
    expect(p.firstEligibleTrove).toBeNull()
    expect(p.maxWithoutConsuming).toBe(0n)
  })

  it('a Trove already at the floor has zero headroom, so only whole consumption works', () => {
    const atFloor = { ...base, eligible: [{ owner: '0xaaa' as `0x${string}`, netDebt: M }] }
    expect(evaluateRedeem({ ...atFloor, amount: 1n }).viable, '1 wei is refused').toBe(false)
    expect(evaluateRedeem({ ...atFloor, amount: M }).viable, 'the whole net debt works').toBe(true)
    expect(evaluateRedeem({ ...atFloor, amount: 1n }).maxWithoutConsuming).toBe(0n)
  })
})
