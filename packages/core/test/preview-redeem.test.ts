import { describe, expect, it } from 'vitest'
import { MCR, evaluateRedeem } from '../src'

const MUSD = 10n ** 18n
const PRICE = 80_000n * MUSD
const GAS_COMP = 200n * MUSD

/**
 * MK-048. The redeemable set has a GAP, not a cap, and no field expressed it.
 *
 * Derived from `mezo-org/musd`, then verified on a fork to the wei. For the first eligible Trove
 * with net debt `D` at the time of the read, floor `M`, and accrual margin `G`:
 *
 *   A <= D - M          succeeds, a partial inside the headroom
 *   D - M < A < D + G   REVERTS: `TroveManager.sol:1218-1221` hands the whole amount to that
 *                       Trove, `:1299-1306` cancels the partial, `:392` breaks, `:406-408` reverts
 *   A >= D + G          succeeds: the Trove is consumed whole via `:1252`, a branch with no hint
 *                       check and no floor check
 *
 * **The upper edge is `D + G` and not `D`, and that correction cost a sweep to find.** The first
 * derivation put it at `D`, and a fork measurement appeared to confirm it. That measurement used
 * `simulateContract`, which is an `eth_call` at the current block: no block is mined, so no
 * interest accrues, and `mUSDLot = min(A, totalDebt - GAS_COMP)` is an exact equality. A real send
 * mines a block first, `:366` runs `_updateTroveInterest` on the target, `:1218-1221` then sizes
 * the lot against the LARGER debt, and an offer of exactly `D` arrives as a partial leaving dust.
 *
 * Measured on a fork by SENDING rather than simulating:
 *
 *   netDebt exactly   2008463782732775139373   THREW RedemptionFailed
 *   netDebt + 1 MUSD                           status=success
 *
 * `G` is 600 seconds of interest on the Trove's entire debt, which is the contract's own allowance
 * for accrual where it bounds a partial hint (`:1276-1285`), rather than a number chosen to feel
 * safe. Overshooting is free: the excess spills to the next Trove, and a cancellation there cannot
 * revert the call because the first Trove was already drawn.
 */
const M = 1_800n * MUSD
const D1 = 2_008n * MUSD
const ENTIRE1 = D1 + GAS_COMP
const HEADROOM = D1 - M // 208 MUSD
const RATE_BPS = 100n

/** The margin recomputed here rather than imported, so a change to either side shows up. */
const marginOf = (entireDebt: bigint) =>
  (entireDebt * RATE_BPS * 600n) / (10_000n * 365n * 24n * 3600n)
const G1 = marginOf(ENTIRE1)

const base = {
  musdBalance: 1_000_000n * MUSD,
  minNetDebt: M,
  tcr: 2n * MUSD,
  price: PRICE,
  interestRateBps: RATE_BPS,
  eligible: [{ owner: '0xaaa' as `0x${string}`, entireDebt: ENTIRE1, netDebt: D1 }],
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

  it('every amount strictly inside the gap is refused, including the net debt itself', () => {
    // `D1` is in this list, not outside it. That is the whole correction.
    for (const a of [HEADROOM + 1n, D1 / 2n, D1 - 1n, D1, D1 + G1 - 1n]) {
      const p = evaluateRedeem({ ...base, amount: a })
      expect(p.viable, `amount ${a}`).toBe(false)
      expect(p.reasons, `amount ${a}`).toContain('PARTIAL_BREACHES_DEBT_FLOOR')
    }
  })

  it('consuming the Trove WHOLE needs the net debt PLUS the accrual margin', () => {
    // `:1252` closes the Trove by redemption and never reaches the cancellation at `:1299`, but
    // only once the offer covers the debt the contract will read at EXECUTION.
    const short = evaluateRedeem({ ...base, amount: D1 })
    const whole = evaluateRedeem({ ...base, amount: D1 + G1 })
    expect(
      short.viable,
      'exactly the net debt read is NOT enough, it accrues before it lands',
    ).toBe(false)
    expect(whole.viable, 'the net debt plus the margin is').toBe(true)
    expect(whole.redeemable, 'and it draws the Trove, not the overshoot').toBe(D1)
  })

  it('the margin is reported, is positive, and is what separates the two edges', () => {
    const p = evaluateRedeem({ ...base, amount: D1 })
    expect(p.accrualMargin, 'a Trove carrying debt accrues something in 600s').toBeGreaterThan(0n)
    expect(p.accrualMargin).toBe(G1)
    expect(p.nextViableAmount - p.firstTroveNetDebt, 'the margin IS the offset').toBe(
      p.accrualMargin,
    )
  })

  it('the preview reports BOTH edges of the gap, which is what a caller acts on', () => {
    const p = evaluateRedeem({ ...base, amount: D1 / 2n })
    expect(p.maxWithoutConsuming, 'the lower edge').toBe(HEADROOM)
    expect(p.nextViableAmount, 'the upper edge').toBe(D1 + G1)
    // Both edges must themselves be viable, or the advice is wrong. This is the assertion the
    // sweep would have needed: the earlier version passed it only because `nextViableAmount` and
    // the loop shared the same wrong idea of where the upper edge was.
    expect(evaluateRedeem({ ...base, amount: p.maxWithoutConsuming }).viable).toBe(true)
    expect(evaluateRedeem({ ...base, amount: p.nextViableAmount }).viable).toBe(true)
  })

  it('a cancel AFTER the first Trove does not revert, it redeems less', () => {
    // `require(totalCollateralDrawn > 0)` (`:406-408`) only fires when NOTHING was drawn. With
    // the first Trove consumed whole, a cancel on the second leaves a successful call.
    const two = {
      ...base,
      eligible: [
        { owner: '0xaaa' as `0x${string}`, entireDebt: ENTIRE1, netDebt: D1 },
        { owner: '0xbbb' as `0x${string}`, entireDebt: ENTIRE1, netDebt: D1 },
      ],
    }
    const p = evaluateRedeem({ ...two, amount: D1 + G1 + D1 / 2n })
    expect(p.viable, 'the call goes through').toBe(true)
    expect(p.redeemable, 'but it redeems only the first Trove').toBe(D1)
    expect(p.redeemable, 'which is less than requested').toBeLessThan(D1 + G1 + D1 / 2n)
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
    expect(p.nextViableAmount, 'and no edge is invented for a list that is empty').toBe(0n)
    expect(p.accrualMargin).toBe(0n)
  })

  it('a Trove already at the floor has zero headroom, so only whole consumption works', () => {
    const entire = M + GAS_COMP
    const atFloor = {
      ...base,
      eligible: [{ owner: '0xaaa' as `0x${string}`, entireDebt: entire, netDebt: M }],
    }
    const g = marginOf(entire)
    expect(evaluateRedeem({ ...atFloor, amount: 1n }).viable, '1 wei is refused').toBe(false)
    expect(
      evaluateRedeem({ ...atFloor, amount: M }).viable,
      'and so is the net debt, for the same accrual reason',
    ).toBe(false)
    expect(
      evaluateRedeem({ ...atFloor, amount: M + g }).viable,
      'only the net debt plus the margin works',
    ).toBe(true)
    expect(evaluateRedeem({ ...atFloor, amount: 1n }).maxWithoutConsuming).toBe(0n)
  })
})
