import { describe, expect, it } from 'vitest'
import { MCR, computeICR, computeLiquidationPrice, getHealthFactor } from '../src'

/**
 * MK-017. `read/getTrove.ts` used to write these two derivations out again, so the same
 * formula lived in two files. Single sourcing them is only safe if the value is unchanged,
 * and these feed numbers a user acts on, so it is PROVEN rather than asserted.
 *
 * The old inline expressions are reproduced here verbatim, from `getTrove.ts` before the
 * change, and compared against the pure functions the read path now calls, across a grid that
 * includes the boundaries. If the two ever diverge, this fails.
 */
const oldInlineLiquidationPrice = (coll: bigint, entireDebt: bigint): bigint =>
  (MCR * entireDebt) / coll
const oldInlineHealthFactor = (icr: bigint): number => Number((icr * 1_000_000n) / MCR) / 1_000_000

const BTC = 10n ** 18n
const MUSD = 10n ** 18n

describe('MK-017, the deduplicated derivations are value identical', () => {
  const collaterals = [1n, 1000n, BTC / 100n, BTC / 2n, BTC, 37n * BTC, 5000n * BTC]
  const debts = [1n, 200n * MUSD, 1800n * MUSD, 5_000n * MUSD, 123_456_789n * MUSD]

  it('computeLiquidationPrice matches the expression it replaced, across the grid', () => {
    for (const collateral of collaterals) {
      for (const entireDebt of debts) {
        expect(
          computeLiquidationPrice({ collateral, entireDebt }),
          `collateral=${collateral} entireDebt=${entireDebt}`,
        ).toBe(oldInlineLiquidationPrice(collateral, entireDebt))
      }
    }
  })

  it('getHealthFactor matches the expression it replaced, across real ICRs', () => {
    // Every ICR the grid above can produce at a plausible price, plus the thresholds
    // themselves, so the comparison covers what the read path actually passes in.
    const price = 77_051_107_320_000_000_000_000n
    const icrs = [MCR, MCR - 1n, MCR + 1n, 15n * 10n ** 17n, 0n]
    for (const collateral of collaterals) {
      for (const entireDebt of debts) {
        icrs.push(computeICR({ collateral, entireDebt, price }))
      }
    }
    for (const icr of icrs) {
      expect(getHealthFactor({ icr }), `icr=${icr}`).toBe(oldInlineHealthFactor(icr))
    }
  })

  it('the zero debt sentinel CHANGES value, deliberately, and only here', () => {
    // `computeICR` returns 2^256 - 1 for zero debt, the contract's infinite CR convention.
    const sentinel = computeICR({ collateral: BTC, entireDebt: 0n, price: 1n })
    expect(sentinel).toBe((1n << 256n) - 1n)

    // This is the ONE input where the answer changes, and the change is the finding rather
    // than a side effect of it: MK-017 says the fixed point conversion "loses meaning for a
    // zero debt sentinel ICR". It did. The old expression returned 1.0526553567028745e+59, a
    // finite number with no interpretation, produced by scaling 2^256 - 1 and converting.
    expect(oldInlineHealthFactor(sentinel)).toBe(1.0526553567028745e59)
    expect(oldInlineHealthFactor(sentinel)).not.toBe(Number.POSITIVE_INFINITY)

    // A position with no debt is infinitely far from liquidation. Now it says so.
    expect(getHealthFactor({ icr: sentinel })).toBe(Number.POSITIVE_INFINITY)
  })

  it('the read path never reaches the sentinel, so getTrove is unaffected', () => {
    // `getTrove` returns its zero-Trove early when `entireDebt === 0`, with `healthFactor: 0`,
    // so it never passes an infinite ICR to this function. The behavior change above is
    // therefore confined to callers of the PURE helper, which is what makes deduplicating the
    // read path safe: for every input `getTrove` actually passes, the value is identical, and
    // the grid tests above are the proof.
    const realIcrs = collaterals.flatMap((collateral) =>
      debts.map((entireDebt) =>
        computeICR({ collateral, entireDebt, price: 77_051_107_320_000_000_000_000n }),
      ),
    )
    for (const icr of realIcrs) {
      expect(icr).toBeLessThan((1n << 256n) - 1n)
      expect(getHealthFactor({ icr })).toBe(oldInlineHealthFactor(icr))
    }
  })

  it('a zero collateral position still returns 0 rather than dividing by zero', () => {
    expect(computeLiquidationPrice({ collateral: 0n, entireDebt: 5_000n * MUSD })).toBe(0n)
  })
})
