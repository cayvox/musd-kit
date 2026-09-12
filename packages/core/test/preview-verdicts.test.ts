import { describe, expect, it } from 'vitest'
import {
  CCR,
  type EvaluateBorrowInput,
  type EvaluateOpenInput,
  type EvaluateRefinanceInput,
  MCR,
  MUSD_GAS_COMPENSATION,
  effectiveBorrowingFee,
  estimateCollateralDrawn,
  evaluateBorrow,
  evaluateOpen,
  evaluateRefinance,
  exceedsRateCap,
  isBorrowingFeeCharged,
} from '../src'

/**
 * Chain-free unit tests for the two preview VERDICTS (MK-002, MK-004, MK-005, MK-018).
 *
 * The verdict is the part that was wrong, so it is the part worth testing exhaustively. It
 * is a pure function of values already read from the chain, which means every combination
 * of reasons can be constructed directly instead of hoping a fork produces it. Expected
 * values come from the contract rules, cited in the source of each evaluator, not from
 * running the SDK.
 *
 * Runs in the `unit` project: no globalSetup, no anvil, no RPC URL.
 */

const E18 = 10n ** 18n
const PRICE = 100_000n * E18
const MIN_NET_DEBT = 1_800n * E18

/** A healthy normal-mode open: well over the floor, ICR far above MCR, TCR far above CCR. */
function openInput(over: Partial<EvaluateOpenInput> = {}): EvaluateOpenInput {
  return {
    collateral: E18, // 1 BTC = 100k
    debt: 2_000n * E18,
    fee: 2n * E18,
    feeExempt: false,
    minNetDebt: MIN_NET_DEBT,
    isRecoveryMode: false,
    price: PRICE,
    systemColl: 1_000n * E18,
    systemDebt: 1_000_000n * E18,
    ...over,
  }
}

/** A healthy borrow: inside capacity, ICR above MCR, TCR above CCR, Trove active. */
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

describe('evaluateOpen, the open verdict (MK-004, MK-005, MK-018)', () => {
  it('is viable with no reasons when every condition holds', () => {
    const p = evaluateOpen(openInput())
    expect(p.viable).toBe(true)
    expect(p.reasons).toEqual([])
    expect(p.bindingConstraint).toBeNull()
  })

  it('computes netDebt as draw plus fee, and entireDebt as netDebt plus the gas reserve', () => {
    const p = evaluateOpen(openInput({ debt: 2_000n * E18, fee: 2n * E18 }))
    expect(p.netDebt).toBe(2_002n * E18)
    expect(p.entireDebt).toBe(2_002n * E18 + MUSD_GAS_COMPENSATION)
  })

  it('flags BELOW_MINIMUM_DEBT against netDebt, not the bare draw', () => {
    // Exactly at the floor is fine; one wei under is not.
    const at = evaluateOpen(openInput({ debt: MIN_NET_DEBT, fee: 0n }))
    expect(at.meetsMinimum).toBe(true)
    expect(at.reasons).not.toContain('BELOW_MINIMUM_DEBT')

    const under = evaluateOpen(openInput({ debt: MIN_NET_DEBT - 1n, fee: 0n }))
    expect(under.meetsMinimum).toBe(false)
    expect(under.reasons).toContain('BELOW_MINIMUM_DEBT')
    expect(under.bindingConstraint).toBe('BELOW_MINIMUM_DEBT')
  })

  it('MK-004: with the fee zeroed, a sub-floor draw is NOT lifted over the floor', () => {
    // The band that used to report the floor met for an open that reverts: the draw is
    // below the floor, and a fee would have carried it over. In Recovery Mode, and for an
    // exempt account, the contract charges no fee, so the floor sees the bare draw.
    const draw = MIN_NET_DEBT - 1n
    const withPhantomFee = evaluateOpen(openInput({ debt: draw, fee: 10n * E18 }))
    expect(withPhantomFee.meetsMinimum).toBe(true) // what the OLD behavior produced

    const recovery = evaluateOpen(
      openInput({ debt: draw, fee: 0n, isRecoveryMode: true, collateral: 10n * E18 }),
    )
    expect(recovery.meetsMinimum).toBe(false)
    expect(recovery.reasons).toContain('BELOW_MINIMUM_DEBT')

    const exempt = evaluateOpen(openInput({ debt: draw, fee: 0n, feeExempt: true }))
    expect(exempt.meetsMinimum).toBe(false)
    expect(exempt.feeExempt).toBe(true)
  })

  it('MK-005: uses MCR in normal mode and CCR in Recovery Mode', () => {
    expect(evaluateOpen(openInput()).icrThreshold).toBe(MCR)
    expect(evaluateOpen(openInput({ isRecoveryMode: true })).icrThreshold).toBe(CCR)
  })

  it('MK-005: flags ICR_BELOW_THRESHOLD in normal mode, which the old flag never did', () => {
    // Collateral sized so ICR lands just under MCR for this debt.
    const debt = 2_000n * E18
    const fee = 0n
    const entireDebt = debt + fee + MUSD_GAS_COMPENSATION
    const collateral = (MCR * entireDebt) / PRICE - 1n
    const p = evaluateOpen(openInput({ collateral, debt, fee }))
    expect(p.icr).toBeLessThan(MCR)
    expect(p.viable).toBe(false)
    expect(p.reasons).toContain('ICR_BELOW_THRESHOLD')
  })

  it('MK-005: an ICR between MCR and CCR passes in normal mode and fails in Recovery Mode', () => {
    const debt = 2_000n * E18
    const entireDebt = debt + MUSD_GAS_COMPENSATION
    // ICR of exactly 1.3: above MCR (1.1), below CCR (1.5).
    const collateral = (1_300_000_000_000_000_000n * entireDebt) / PRICE
    const normal = evaluateOpen(openInput({ collateral, debt, fee: 0n }))
    expect(normal.reasons).not.toContain('ICR_BELOW_THRESHOLD')

    const recovery = evaluateOpen(openInput({ collateral, debt, fee: 0n, isRecoveryMode: true }))
    expect(recovery.reasons).toContain('ICR_BELOW_THRESHOLD')
    expect(recovery.viable).toBe(false)
  })

  it('MK-005: projects the resulting TCR and flags it, in normal mode only', () => {
    // A system already near CCR, plus a large debt-heavy open, pushes TCR under CCR.
    const strained = { systemColl: 20n * E18, systemDebt: 1_400_000n * E18 }
    const p = evaluateOpen(openInput({ ...strained, collateral: E18, debt: 60_000n * E18 }))
    expect(p.resultingTcr).toBeLessThan(CCR)
    expect(p.reasons).toContain('TCR_BELOW_CCR')

    // The same shape in Recovery Mode carries no resulting-TCR condition.
    const rm = evaluateOpen(
      openInput({ ...strained, collateral: E18, debt: 60_000n * E18, isRecoveryMode: true }),
    )
    expect(rm.reasons).not.toContain('TCR_BELOW_CCR')
  })

  it('lists every reason and names the first as the binding constraint', () => {
    // Below the floor AND below MCR at once.
    const p = evaluateOpen(openInput({ collateral: 1n, debt: 1n, fee: 0n }))
    expect(p.reasons).toContain('BELOW_MINIMUM_DEBT')
    expect(p.reasons).toContain('ICR_BELOW_THRESHOLD')
    expect(p.bindingConstraint).toBe(p.reasons[0])
    expect(p.viable).toBe(false)
  })
})

describe('evaluateBorrow, the borrow verdict (MK-002)', () => {
  it('is viable with no reasons when every condition holds', () => {
    const p = evaluateBorrow(borrowInput())
    expect(p.viable).toBe(true)
    expect(p.reasons).toEqual([])
    expect(p.bindingConstraint).toBeNull()
  })

  it('netDebtChange is the draw plus the fee, which is what the capacity gate compares', () => {
    const p = evaluateBorrow(borrowInput({ amount: 5_000n * E18, fee: 5n * E18 }))
    expect(p.netDebtChange).toBe(5_005n * E18)
    expect(p.resultingEntireDebt).toBe(2_200n * E18 + 5_005n * E18)
  })

  it('remaining is capacity minus entire debt, floored at zero', () => {
    expect(evaluateBorrow(borrowInput({ capacity: 10_000n * E18 })).capacity.remaining).toBe(
      10_000n * E18 - 2_200n * E18,
    )
    // Underwater against capacity: no headroom, never a negative.
    expect(evaluateBorrow(borrowInput({ capacity: 100n * E18 })).capacity.remaining).toBe(0n)
  })

  it('flags EXCEEDS_BORROWING_CAPACITY exactly at the boundary', () => {
    // The gate is `capacity >= netDebtChange + debt`, so equality is allowed.
    const base = borrowInput({ fee: 0n, amount: 1_000n * E18, entireDebt: 2_200n * E18 })
    const exact = evaluateBorrow({ ...base, capacity: 3_200n * E18 })
    expect(exact.reasons).not.toContain('EXCEEDS_BORROWING_CAPACITY')

    const oneWeiShort = evaluateBorrow({ ...base, capacity: 3_200n * E18 - 1n })
    expect(oneWeiShort.reasons).toContain('EXCEEDS_BORROWING_CAPACITY')
    expect(oneWeiShort.viable).toBe(false)
  })

  it('flags TROVE_NOT_ACTIVE for any status other than active', () => {
    for (const status of [0, 2, 3, 4]) {
      const p = evaluateBorrow(borrowInput({ status }))
      expect(p.reasons, `status ${status}`).toContain('TROVE_NOT_ACTIVE')
      expect(p.bindingConstraint).toBe('TROVE_NOT_ACTIVE')
    }
    expect(evaluateBorrow(borrowInput({ status: 1 })).reasons).not.toContain('TROVE_NOT_ACTIVE')
  })

  it('uses MCR in normal mode and CCR in Recovery Mode, and flags a breach', () => {
    expect(evaluateBorrow(borrowInput()).icrThreshold).toBe(MCR)
    const rm = evaluateBorrow(borrowInput({ isRecoveryMode: true }))
    expect(rm.icrThreshold).toBe(CCR)

    const breach = evaluateBorrow(borrowInput({ amount: 95_000n * E18, capacity: 10n ** 30n }))
    expect(breach.resultingIcr).toBeLessThan(MCR)
    expect(breach.reasons).toContain('ICR_BELOW_THRESHOLD')
  })

  it('flags TCR_BELOW_CCR when the borrow pushes the system under CCR', () => {
    const p = evaluateBorrow(
      borrowInput({
        systemColl: 20n * E18,
        systemDebt: 1_300_000n * E18,
        amount: 60_000n * E18,
        capacity: 10n ** 30n,
        collateral: 100n * E18,
      }),
    )
    expect(p.resultingTcr).toBeLessThan(CCR)
    expect(p.reasons).toContain('TCR_BELOW_CCR')
  })

  it('MK-065: reasons come back in the order `_adjustTrove` checks them, capacity LAST', () => {
    // REGRESSION. This assertion used to read
    // ['TROVE_NOT_ACTIVE', 'EXCEEDS_BORROWING_CAPACITY', 'ICR_BELOW_THRESHOLD', 'TCR_BELOW_CCR']
    // and it passed, which is why the wrong order survived. The contract checks
    // `_requireTroveisActive` (:790), then `_requireValidAdjustmentInCurrentMode` (:840-845,
    // so ICR at :1201 then TCR at :1209), and only then `_requireHasBorrowingCapacity`
    // (:850-852). `bindingConstraint` is documented as the one the chain reports first, so the
    // order is load bearing rather than cosmetic.
    const p = evaluateBorrow(
      borrowInput({
        status: 3,
        capacity: 0n,
        amount: 10n ** 24n,
        collateral: 1n,
        systemColl: 20n * E18,
        systemDebt: 1_300_000n * E18,
      }),
    )
    expect(p.reasons).toEqual([
      'TROVE_NOT_ACTIVE',
      'ICR_BELOW_THRESHOLD',
      'TCR_BELOW_CCR',
      'EXCEEDS_BORROWING_CAPACITY',
    ])
    expect(p.bindingConstraint).toBe('TROVE_NOT_ACTIVE')
    expect(p.viable).toBe(false)

    // And with the status gate cleared, the ratio binds rather than capacity. This is the
    // case a caller actually sees: they are told to fix the ratio, which they can, rather
    // than to raise capacity, which never rises (`BorrowerOperations.sol:879-897`).
    const active = evaluateBorrow(
      borrowInput({
        capacity: 0n,
        amount: 10n ** 24n,
        collateral: 1n,
        systemColl: 20n * E18,
        systemDebt: 1_300_000n * E18,
      }),
    )
    expect(active.bindingConstraint).toBe('ICR_BELOW_THRESHOLD')
  })

  /**
   * MK-058 and MK-059. The Recovery Mode combination the whole suite never exercised.
   *
   * Before this block the only Recovery Mode borrow assertion in the repository was that
   * `icrThreshold` switches from MCR to CCR, which is true of both the right evaluator and
   * the wrong one. Two rules were wrong underneath it for the life of the file.
   */
  describe('MK-058, MK-059: the Recovery Mode rules', () => {
    // The fee is skipped in Recovery Mode on chain (`:813-818`), so the fixture says so.
    const rm = (over: Partial<EvaluateBorrowInput> = {}) =>
      borrowInput({ isRecoveryMode: true, fee: 0n, capacity: 10n ** 30n, ...over })

    it('MK-058: no Recovery Mode borrow of any usable size is viable, because ICR must fall', () => {
      // `withdrawMUSD` sends no collateral (`:243-257`), so `ICR = coll * price / debt` with
      // coll fixed and debt rising cannot rise. `_requireNewICRisAboveOldICR` (`:1273`,
      // defined `:1395-1403`) is `newICR >= oldICR`, so no draw that moves the ratio clears
      // it. The preview used to say `viable: true` for all of these.
      for (const amount of [E18 / 1_000_000n, E18, 1_000n * E18, 20_000n * E18]) {
        const p = evaluateBorrow(rm({ amount }))
        expect(p.resultingIcr, `amount ${amount}`).toBeLessThan(p.currentIcr)
        expect(p.reasons, `amount ${amount}`).toContain('ICR_NOT_IMPROVED_IN_RECOVERY_MODE')
        expect(p.viable, `amount ${amount}`).toBe(false)
      }
    })

    it('MK-058: and the exception is truncation, which the SDK inherits rather than invents', () => {
      // The rule is NOT "every non-zero draw is refused", and saying so would be a claim the
      // contract does not make. `LiquityMath._computeCR` is integer `coll * price / debt`, so
      // a draw small enough to leave the quotient unchanged satisfies `newICR >= oldICR` on
      // equality. For this fixture, 1 BTC of collateral at 100k against 2,200 MUSD of debt,
      // the first draw that moves the quotient is 23 wei, which is 2.3e-17 MUSD.
      //
      //   measured with:
      //     node -e 'const E=10n**18n,P=100000n*E,C=E,D=2200n*E,f=d=>(C*P)/d;
      //              let lo=1n,hi=10n**6n; while(lo<hi){const m=(lo+hi)/2n;
      //              if(f(D+m)<f(D))hi=m; else lo=m+1n;} console.log(lo)'
      //
      // The SDK uses the same integer form, so it agrees with the chain on BOTH sides of that
      // boundary. That agreement is the property worth pinning; the 23 is a consequence.
      const below = evaluateBorrow(rm({ amount: 22n }))
      expect(below.resultingIcr, 'truncates to the same ratio').toBe(below.currentIcr)
      expect(below.reasons).not.toContain('ICR_NOT_IMPROVED_IN_RECOVERY_MODE')

      const at = evaluateBorrow(rm({ amount: 23n }))
      expect(at.resultingIcr).toBeLessThan(at.currentIcr)
      expect(at.reasons).toContain('ICR_NOT_IMPROVED_IN_RECOVERY_MODE')
    })

    it('MK-058: the ICR gate is still ABSOLUTE against CCR as well, and both can fire', () => {
      // `:1272` and `:1273` are two separate requires, not one. A borrow that drops the
      // resulting ICR below CCR breaches both, and the preview reports both.
      const p = evaluateBorrow(rm({ amount: 80_000n * E18 }))
      expect(p.resultingIcr).toBeLessThan(CCR)
      expect(p.reasons).toContain('ICR_BELOW_THRESHOLD')
      expect(p.reasons).toContain('ICR_NOT_IMPROVED_IN_RECOVERY_MODE')
      expect(p.icrThreshold).toBe(CCR)
    })

    it('MK-058: the identical borrow in NORMAL mode is viable, so it is the mode not the numbers', () => {
      const amount = 1_000n * E18
      expect(evaluateBorrow(borrowInput({ amount, fee: 0n })).viable).toBe(true)
      expect(evaluateBorrow(rm({ amount })).viable).toBe(false)
    })

    it('MK-059: there is NO TCR gate in Recovery Mode, and there is one in normal mode', () => {
      // `_requireNewTCRisAboveCCR` (`:1344-1349`) has exactly four call sites: `:665` inside
      // `_openTrove`'s NORMAL mode branch, `:972` on the close path, `:1059` on refinance,
      // and `:1209` inside `_requireValidAdjustmentInNormalMode`. The Recovery Mode arm
      // (`:1265-1275`) calls none of them. Since Recovery Mode is DEFINED as `TCR < CCR`, an
      // unconditional gate fires on essentially every Recovery Mode borrow.
      const strained = { systemColl: 20n * E18, systemDebt: 1_400_000n * E18 }
      const normal = evaluateBorrow(borrowInput({ ...strained, amount: 1_000n * E18, fee: 0n }))
      expect(normal.resultingTcr).toBeLessThan(CCR)
      expect(normal.reasons).toContain('TCR_BELOW_CCR')

      const recovery = evaluateBorrow(rm({ ...strained, amount: 1_000n * E18 }))
      expect(recovery.resultingTcr, 'still REPORTED, because a caller wants it').toBeLessThan(CCR)
      expect(recovery.reasons, 'and it is not a reason').not.toContain('TCR_BELOW_CCR')
    })

    it('MK-059: TCR is reported in Recovery Mode across the CCR boundary and never gates', () => {
      // Both sides of the boundary, so the assertion is about the absence of a gate rather
      // than about one fixture happening to sit clear of it.
      for (const systemDebt of [600_000n * E18, 1_333_333n * E18, 1_400_000n * E18]) {
        const p = evaluateBorrow(rm({ systemColl: 20n * E18, systemDebt, amount: 1n }))
        expect(p.reasons, `systemDebt ${systemDebt}`).not.toContain('TCR_BELOW_CCR')
      }
    })

    it('MK-060: a draw of zero is refused, and names the gate the chain reaches first', () => {
      // `:785-787` refuses `(_isDebtIncrease = true, _mUSDChange = 0)` before every other
      // gate. `:789` would refuse it too, and both are reported, in that order.
      const p = evaluateBorrow(borrowInput({ amount: 0n, fee: 0n }))
      expect(p.reasons).toEqual(['ZERO_DEBT_INCREASE', 'NO_CHANGE_REQUESTED'])
      expect(p.bindingConstraint).toBe('ZERO_DEBT_INCREASE')
      expect(p.viable).toBe(false)
    })
  })
})

/** A healthy normal-mode refinance: active, out of Recovery Mode, ratios comfortable. */
function refinanceInput(over: Partial<EvaluateRefinanceInput> = {}): EvaluateRefinanceInput {
  return {
    status: 1,
    collateral: E18,
    principal: 2_200n * E18,
    interestOwed: 5n * E18,
    refinancingFeePercentage: 20,
    borrowingFeeOnBase: 401n * 10n ** 15n, // ~0.401 MUSD
    feeExempt: false,
    isRecoveryMode: false,
    price: PRICE,
    systemColl: 1_000n * E18,
    systemDebt: 1_000_000n * E18,
    ...over,
  }
}

describe('evaluateRefinance, the refinance verdict (MK-003, MK-019)', () => {
  it('is viable with no reasons when every condition holds', () => {
    const p = evaluateRefinance(refinanceInput())
    expect(p.viable).toBe(true)
    expect(p.reasons).toEqual([])
    expect(p.bindingConstraint).toBeNull()
  })

  it('the fee base is the NET debt, entire debt minus the gas reserve', () => {
    const p = evaluateRefinance(refinanceInput({ principal: 2_200n * E18, interestOwed: 5n * E18 }))
    expect(p.feeBase).toBe(2_205n * E18 - MUSD_GAS_COMPENSATION)
  })

  it('a Trove at or below the gas reserve has a zero fee base rather than underflowing', () => {
    const p = evaluateRefinance(
      refinanceInput({ principal: MUSD_GAS_COMPENSATION, interestOwed: 0n }),
    )
    expect(p.feeBase).toBe(0n)
  })

  it('MK-003: the fee is capitalized into principal', () => {
    const fee = 401n * 10n ** 15n
    const p = evaluateRefinance(refinanceInput({ borrowingFeeOnBase: fee }))
    expect(p.fee).toBe(fee)
    expect(p.resultingPrincipal).toBe(2_200n * E18 + fee)
    expect(p.resultingEntireDebt).toBe(2_205n * E18 + fee)
  })

  it('MK-003: a fee exempt account is charged nothing and its principal does not move', () => {
    const p = evaluateRefinance(refinanceInput({ feeExempt: true }))
    expect(p.fee).toBe(0n)
    expect(p.feeExempt).toBe(true)
    expect(p.resultingPrincipal).toBe(p.principal)
  })

  it('MK-003: the governable percentage is carried through, not assumed', () => {
    expect(
      evaluateRefinance(refinanceInput({ refinancingFeePercentage: 20 })).refinancingFeePercentage,
    ).toBe(20)
    expect(
      evaluateRefinance(refinanceInput({ refinancingFeePercentage: 35 })).refinancingFeePercentage,
    ).toBe(35)
  })

  it('MK-019: Recovery Mode makes it not viable and binds FIRST', () => {
    const p = evaluateRefinance(refinanceInput({ isRecoveryMode: true }))
    expect(p.viable).toBe(false)
    expect(p.reasons).toContain('RECOVERY_MODE')
    expect(p.bindingConstraint).toBe('RECOVERY_MODE')
  })

  it('MK-019: Recovery Mode still binds first when other constraints also fail', () => {
    // `_requireNotInRecoveryMode` is the contract's first requirement
    // (BorrowerOperations.sol:1024), so it is what the caller actually hits.
    const p = evaluateRefinance(
      refinanceInput({ isRecoveryMode: true, collateral: 1n, systemColl: 1n }),
    )
    expect(p.reasons[0]).toBe('RECOVERY_MODE')
    expect(p.reasons).toContain('ICR_BELOW_MCR')
  })

  it('flags TROVE_NOT_ACTIVE for any status other than active, ahead of everything', () => {
    for (const status of [0, 2, 3, 4]) {
      const p = evaluateRefinance(refinanceInput({ status }))
      expect(p.reasons, `status ${status}`).toContain('TROVE_NOT_ACTIVE')
      expect(p.bindingConstraint).toBe('TROVE_NOT_ACTIVE')
    }
  })

  it('flags ICR_BELOW_MCR on the resulting position, which includes the fee', () => {
    // Collateral sized so the pre-fee ICR clears MCR and the post-fee ICR does not.
    const principal = 2_200n * E18
    const interestOwed = 0n
    const fee = 100n * E18
    const preFee = principal + interestOwed
    const collateral = (MCR * (preFee + fee)) / PRICE - 1n
    const p = evaluateRefinance(
      refinanceInput({ collateral, principal, interestOwed, borrowingFeeOnBase: fee }),
    )
    expect(computeIcrOf(collateral, preFee)).toBeGreaterThanOrEqual(MCR)
    expect(p.resultingIcr).toBeLessThan(MCR)
    expect(p.reasons).toContain('ICR_BELOW_MCR')
  })

  it('flags TCR_BELOW_CCR when the system is already strained', () => {
    const p = evaluateRefinance(
      refinanceInput({ systemColl: 20n * E18, systemDebt: 1_400_000n * E18 }),
    )
    expect(p.resultingTcr).toBeLessThan(CCR)
    expect(p.reasons).toContain('TCR_BELOW_CCR')
  })
})

/** Local mirror of the contract's `_computeCR`, for the pre-fee comparison above. */
function computeIcrOf(collateral: bigint, entireDebt: bigint): bigint {
  return entireDebt === 0n ? (1n << 256n) - 1n : (collateral * PRICE) / entireDebt
}

describe('the fee and redemption rules, as pure functions (MK-004, MK-011, MK-014, MK-018)', () => {
  it('isBorrowingFeeCharged: only in normal mode AND only when not exempt', () => {
    // The contract's condition verbatim: `!isRecoveryMode && !isAccountFeeExempt`
    // (BorrowerOperations.sol:637-643 on open, :810-818 on a debt increase).
    expect(isBorrowingFeeCharged(false, false)).toBe(true)
    expect(isBorrowingFeeCharged(true, false)).toBe(false)
    expect(isBorrowingFeeCharged(false, true)).toBe(false)
    expect(isBorrowingFeeCharged(true, true)).toBe(false)
  })

  it('effectiveBorrowingFee: the quote survives only when the fee applies', () => {
    const quoted = 2n * E18
    expect(effectiveBorrowingFee(quoted, false, false)).toBe(quoted)
    expect(effectiveBorrowingFee(quoted, true, false)).toBe(0n)
    expect(effectiveBorrowingFee(quoted, false, true)).toBe(0n)
    expect(effectiveBorrowingFee(quoted, true, true)).toBe(0n)
  })

  it('estimateCollateralDrawn: converts MUSD to BTC wei at the given price', () => {
    // 100k MUSD at 100k per BTC is one BTC.
    expect(estimateCollateralDrawn(100_000n * E18, PRICE)).toBe(E18)
    expect(estimateCollateralDrawn(50_000n * E18, PRICE)).toBe(E18 / 2n)
    expect(estimateCollateralDrawn(0n, PRICE)).toBe(0n)
  })

  it('estimateCollateralDrawn: returns zero rather than dividing by a zero price', () => {
    expect(estimateCollateralDrawn(100_000n * E18, 0n)).toBe(0n)
    expect(estimateCollateralDrawn(100_000n * E18, -1n)).toBe(0n)
  })

  it('exceedsRateCap: rate against rate, and no cap means no breach', () => {
    const rate = 75n * 10n ** 14n // 0.75%
    expect(exceedsRateCap(rate, undefined)).toBe(false)
    expect(exceedsRateCap(rate, rate)).toBe(false) // equality is within the cap
    expect(exceedsRateCap(rate, rate - 1n)).toBe(true)
    expect(exceedsRateCap(rate, rate + 1n)).toBe(false)
  })
})
