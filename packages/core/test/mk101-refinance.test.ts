import { describe, expect, it } from 'vitest'
import { MCR, evaluateRefinance, maxBorrowingCapacityAt } from '../src'
import type { EvaluateRefinanceInput } from '../src/math/previewRefinance'

/**
 * MK-101. A refinance moves the Trove to the GLOBAL rate and RESETS its borrowing capacity from the
 * current price, and the preview reported neither.
 *
 * Restated from the contract rather than from the implementation (`docs/08-conventions.md` §11):
 *
 *   `vars.newRate = interestRateManager.interestRate()`                 BorrowerOperations.sol:1069
 *   `setTroveInterestRate(_borrower, vars.newRate)`                      :1075
 *   `setTroveMaxBorrowingCapacity(_borrower,
 *        _calculateMaxBorrowingCapacity(getTroveColl(_borrower), price))` :1077-1084
 *   `_calculateMaxBorrowingCapacity(c, p) = (c * p) / (110 * 1e16)`      :1323-1328
 */
const E18 = 10n ** 18n
const contractCapacity = (coll: bigint, price: bigint) => (coll * price) / (110n * 10n ** 16n)

function input(over: Partial<EvaluateRefinanceInput> = {}): EvaluateRefinanceInput {
  return {
    status: 1,
    collateral: E18,
    principal: 30_000n * E18,
    interestOwed: 0n,
    refinancingFeePercentage: 20,
    borrowingFeeOnBase: 6n * E18,
    feeExempt: false,
    isRecoveryMode: false,
    price: 76_750n * E18,
    systemColl: 1_000n * E18,
    systemDebt: 1_000_000n * E18,
    currentInterestRateBps: 100,
    globalInterestRateBps: 500,
    currentCapacity: 69_772n * E18,
    ...over,
  }
}

describe('MK-101, the refinance preview reports the rate it moves to and the capacity it writes', () => {
  it('reports the global rate as the resulting rate, including when it is HIGHER than the current one', () => {
    const p = evaluateRefinance(input())
    expect(p.currentInterestRateBps).toBe(100)
    expect(p.resultingInterestRateBps).toBe(500)
    // The contract does not refuse a refinance that raises the rate, so neither does the preview.
    expect(p.viable).toBe(true)
  })

  it('writes the capacity from the CURRENT price, below the stored one after a fall', () => {
    const fallen = 60_000n * E18
    const p = evaluateRefinance(input({ price: fallen, currentCapacity: 90_704n * E18 }))
    expect(p.resultingCapacity).toBe(contractCapacity(E18, fallen))
    expect(p.resultingCapacity).toBeLessThan(p.currentCapacity)
  })

  it('and above the stored one after a rise, which the ratchet only description said never happens', () => {
    const risen = 99_775n * E18
    const p = evaluateRefinance(input({ price: risen }))
    expect(p.resultingCapacity).toBe(contractCapacity(E18, risen))
    expect(p.resultingCapacity).toBeGreaterThan(p.currentCapacity)
  })

  it('maxBorrowingCapacityAt is the contract expression, and is the entire debt at ICR == MCR', () => {
    for (const [coll, price] of [
      [E18, 76_750n * E18],
      [3n * E18 + 7n, 77_051_107_320_000_000_000_000n],
      [123_456_789n, 1n],
    ] as const) {
      expect(maxBorrowingCapacityAt(coll, price)).toBe(contractCapacity(coll, price))
      const cap = maxBorrowingCapacityAt(coll, price)
      if (cap > 0n) expect((coll * price) / cap).toBeGreaterThanOrEqual(MCR)
    }
  })
})
