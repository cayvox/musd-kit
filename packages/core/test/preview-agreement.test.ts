import type { PublicClient } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  CCR,
  type EvaluateAdjustInput,
  type EvaluateBorrowInput,
  MCR,
  evaluateAdjust,
  evaluateBorrow,
  getAddresses,
  previewAdjustTrove,
  previewBorrow,
} from '../src'
import type { MathDeps } from '../src/math/deps'

/**
 * The two previews of one operation must agree, in both modes, across every boundary.
 *
 * **This is the pin MK-001 asked for and nobody wrote** (MK-058, MK-059, MK-060, MK-065). A
 * borrow IS an adjustment on chain: `withdrawMUSD` calls `_adjustTrove` with
 * `_collWithdrawal = 0`, no `msg.value` and `_isDebtIncrease = true`
 * (`BorrowerOperations.sol:243-257`). So `previewBorrow` and `previewAdjustTrove` are two
 * questions about the same call, and any answer they give differently is a defect in one of
 * them. Three such differences shipped before this file existed, and each of them would have
 * failed on the first case below.
 *
 * The delegation makes agreement structural rather than coincidental, and this file is what
 * keeps it structural: it fails the moment anyone puts a decision back into `previewBorrow`.
 *
 * Runs in the `unit` project: no globalSetup, no anvil, no RPC URL.
 */

const E18 = 10n ** 18n
const PRICE = 100_000n * E18
const OWNER = '0x000000000000000000000000000000000000dEaD' as const

/** A healthy borrow, the same fixture shape `preview-verdicts.test.ts` uses. */
function borrowInput(over: Partial<EvaluateBorrowInput> = {}): EvaluateBorrowInput {
  return {
    status: 1,
    collateral: E18,
    entireDebt: 2_200n * E18,
    capacity: 50_000n * E18,
    fee: 5n * E18,
    amount: 5_000n * E18,
    isRecoveryMode: false,
    price: PRICE,
    systemColl: 1_000n * E18,
    systemDebt: 1_000_000n * E18,
    ...over,
  }
}

/**
 * The same call, expressed as an adjustment.
 *
 * Written out here rather than imported from the source on purpose: if this mapping and the
 * one inside `evaluateBorrow` are the same object, the test proves nothing. This is the
 * mapping read off `withdrawMUSD` in the contract, and the test asserts the SDK's mapping
 * produces the same verdict as it.
 */
function asAdjust(b: EvaluateBorrowInput): EvaluateAdjustInput {
  return {
    status: b.status,
    collateral: b.collateral,
    entireDebt: b.entireDebt,
    capacity: b.capacity,
    // Unreachable on a debt increase (`:855-861` is guarded by `!_isDebtIncrease`).
    musdBalance: 0n,
    minNetDebt: 0n,
    fee: b.fee,
    addCollateral: 0n,
    withdrawCollateral: 0n,
    increaseDebt: b.amount,
    repayDebt: 0n,
    isDebtIncrease: true,
    isRecoveryMode: b.isRecoveryMode,
    price: b.price,
    systemColl: b.systemColl,
    systemDebt: b.systemDebt,
  }
}

/**
 * Every reason a call with no collateral leg and no repayment leg can reach.
 *
 * Hard coded rather than derived, so that widening the adjust evaluator with a reason a borrow
 * CAN reach fails here loudly instead of arriving on `previewBorrow` unannounced.
 */
const REACHABLE = new Set([
  'TROVE_NOT_ACTIVE',
  'ZERO_DEBT_INCREASE',
  'NO_CHANGE_REQUESTED',
  'ICR_BELOW_THRESHOLD',
  'ICR_NOT_IMPROVED_IN_RECOVERY_MODE',
  'TCR_BELOW_CCR',
  'EXCEEDS_BORROWING_CAPACITY',
])

/** The amount that lands the resulting ICR exactly on `threshold`, ignoring rounding. */
function amountAtIcr(b: EvaluateBorrowInput, threshold: bigint): bigint {
  const debtAtThreshold = (b.collateral * b.price) / threshold
  return debtAtThreshold - b.entireDebt - b.fee
}

/** The amount that lands the resulting TCR exactly on CCR. */
function amountAtTcr(b: EvaluateBorrowInput): bigint {
  return (b.systemColl * b.price) / CCR - b.systemDebt - b.fee
}

/** The amount that lands the resulting entire debt exactly on capacity. */
function amountAtCapacity(b: EvaluateBorrowInput): bigint {
  return b.capacity - b.entireDebt - b.fee
}

/** Every generated case, named so a failure says which boundary and which side of it. */
function cases(): { name: string; input: EvaluateBorrowInput }[] {
  const out: { name: string; input: EvaluateBorrowInput }[] = []
  for (const isRecoveryMode of [false, true]) {
    // The fee is zero in Recovery Mode on chain (`:813-818`), so the fixtures say so too.
    const fee = isRecoveryMode ? 0n : 5n * E18
    for (const status of [1, 3]) {
      const base = borrowInput({ isRecoveryMode, fee, status, capacity: 10n ** 30n })
      const boundaries: [string, bigint][] = [
        ['MCR', amountAtIcr(base, MCR)],
        ['CCR', amountAtIcr(base, CCR)],
        ['TCR=CCR', amountAtTcr(borrowInput({ isRecoveryMode, fee, status }))],
        ['capacity', amountAtCapacity(borrowInput({ isRecoveryMode, fee, status }))],
      ]
      for (const [label, at] of boundaries) {
        for (const [side, delta] of [
          ['under', -1n],
          ['exact', 0n],
          ['over', 1n],
        ] as const) {
          const amount = at + delta
          if (amount < 0n) continue
          const input =
            label === 'capacity' || label === 'TCR=CCR'
              ? borrowInput({ isRecoveryMode, fee, status, amount })
              : borrowInput({ isRecoveryMode, fee, status, amount, capacity: 10n ** 30n })
          out.push({
            name: `${isRecoveryMode ? 'recovery' : 'normal'} status=${status} ${label} ${side}`,
            input,
          })
        }
      }
      // The degenerate ends, which is where the two evaluators disagreed about the flag.
      out.push({
        name: `${isRecoveryMode} status=${status} amount=0`,
        input: { ...base, amount: 0n },
      })
      out.push({
        name: `${isRecoveryMode} status=${status} amount=1wei`,
        input: { ...base, amount: 1n },
      })
      out.push({
        name: `${isRecoveryMode} status=${status} no collateral`,
        input: { ...base, collateral: 0n },
      })
      out.push({
        name: `${isRecoveryMode} status=${status} price=0`,
        input: { ...base, price: 0n },
      })
      out.push({
        name: `${isRecoveryMode} status=${status} absurd amount`,
        input: { ...base, amount: 10n ** 30n },
      })
    }
  }
  return out
}

describe('previewBorrow and previewAdjustTrove answer the same question the same way', () => {
  const all = cases()

  it('generates cases on both sides of every boundary, in both modes', () => {
    // A guard on the guard: a matrix that silently shrank would make every assertion below
    // pass while proving less, which is MK-047's lesson about what a case count means.
    expect(all.length).toBeGreaterThanOrEqual(48)
    expect(all.some((c) => c.name.startsWith('recovery'))).toBe(true)
    expect(all.some((c) => c.name.startsWith('normal'))).toBe(true)
  })

  it.each(all)('$name: identical verdict, reasons and numbers', ({ input }) => {
    const b = evaluateBorrow(input)
    const a = evaluateAdjust(asAdjust(input))

    expect(b.viable).toBe(a.viable)
    expect(b.reasons).toEqual(a.reasons)
    expect(b.bindingConstraint).toBe(a.bindingConstraint)
    expect(b.fee).toBe(a.fee)
    expect(b.netDebtChange).toBe(a.netDebtChange)
    expect(b.capacity).toEqual(a.capacity)
    expect(b.resultingEntireDebt).toBe(a.resultingEntireDebt)
    expect(b.currentIcr).toBe(a.currentIcr)
    expect(b.resultingIcr).toBe(a.resultingIcr)
    expect(b.icrThreshold).toBe(a.icrThreshold)
    expect(b.resultingTcr).toBe(a.resultingTcr)
    expect(b.isRecoveryMode).toBe(a.isRecoveryMode)
    expect(b.price).toBe(a.price)
  })

  it('never reports a reason a borrow cannot reach', () => {
    for (const { name, input } of all) {
      for (const reason of evaluateBorrow(input).reasons) {
        expect(REACHABLE.has(reason), `${name} produced ${reason}`).toBe(true)
      }
    }
  })

  it('and the matrix actually reaches every reason a borrow CAN reach except one', () => {
    const seen = new Set(all.flatMap((c) => evaluateBorrow(c.input).reasons as string[]))
    for (const reason of REACHABLE) {
      // `NO_CHANGE_REQUESTED` only accompanies a zero draw, which the matrix does generate.
      expect(seen.has(reason), `no case produced ${reason}`).toBe(true)
    }
  })
})

const T = getAddresses(31611)

/**
 * A fake chain that answers exactly the reads these two previews perform.
 *
 * Deliberately small and local: this is a fixture, not a second copy of a rule. Its job is to
 * make the READ layer deterministic so the agreement can be asserted end to end rather than
 * only at the evaluator, which is where a divergence in which getters each preview calls would
 * hide.
 */
function fakeDeps(over: Record<string, unknown> = {}): MathDeps {
  const answers: Record<string, unknown> = {
    fetchPrice: PRICE,
    getTroveStatus: 1,
    getEntireDebtAndColl: [E18, 2_200n * E18, 0n, 0n, 0n, 0n],
    getTroveMaxBorrowingCapacity: 50_000n * E18,
    checkRecoveryMode: false,
    balanceOf: 500_000n * E18,
    getEntireSystemColl: 1_000n * E18,
    getEntireSystemDebt: 1_000_000n * E18,
    getBorrowingFee: 5n * E18,
    ...over,
  }
  const publicClient = {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (!(functionName in answers)) throw new Error(`unstubbed read: ${functionName}`)
      return answers[functionName]
    },
  } as unknown as PublicClient
  return {
    publicClient,
    addresses: T,
    getMinNetDebt: async () => 1_800n * E18,
    isAccountFeeExempt: async () => false,
  }
}

describe('and they agree end to end, through the reads as well as the rules', () => {
  for (const [label, over] of [
    ['normal mode', {}],
    ['recovery mode', { checkRecoveryMode: true, getBorrowingFee: 0n }],
    ['inactive trove', { getTroveStatus: 3 }],
    ['at capacity', { getTroveMaxBorrowingCapacity: 7_205n * E18 }],
    ['strained system', { getEntireSystemDebt: 70_000n * E18, getEntireSystemColl: E18 }],
  ] as const) {
    it(`${label}: previewBorrow is previewAdjustTrove with a debt increase`, async () => {
      const deps = fakeDeps(over)
      const amount = 5_000n * E18
      const b = await previewBorrow(deps, { owner: OWNER, amount })
      const a = await previewAdjustTrove(deps, { owner: OWNER, increaseDebt: amount })

      expect(b.viable).toBe(a.viable)
      expect(b.reasons).toEqual(a.reasons)
      expect(b.bindingConstraint).toBe(a.bindingConstraint)
      expect(b.fee).toBe(a.fee)
      expect(b.netDebtChange).toBe(a.netDebtChange)
      expect(b.capacity).toEqual(a.capacity)
      expect(b.resultingEntireDebt).toBe(a.resultingEntireDebt)
      expect(b.currentIcr).toBe(a.currentIcr)
      expect(b.resultingIcr).toBe(a.resultingIcr)
      expect(b.icrThreshold).toBe(a.icrThreshold)
      expect(b.resultingTcr).toBe(a.resultingTcr)
      expect(b.price).toBe(a.price)
    })
  }

  it('MK-058: through the reads too, a Recovery Mode borrow of usable size is never viable', async () => {
    const deps = fakeDeps({ checkRecoveryMode: true, getBorrowingFee: 0n })
    // Sizes that move the truncated ratio. The sub-wei-quotient exception is pinned in
    // `preview-verdicts.test.ts`; it is a property of integer division that the SDK and the
    // contract share, not a disagreement between them.
    for (const amount of [E18 / 1_000_000n, E18, 1_000n * E18]) {
      const b = await previewBorrow(deps, { owner: OWNER, amount })
      expect(b.viable, `amount ${amount}`).toBe(false)
      expect(b.reasons).toContain('ICR_NOT_IMPROVED_IN_RECOVERY_MODE')
    }
  })
})
