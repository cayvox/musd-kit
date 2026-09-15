import { describe, expect, it } from 'vitest'
import {
  TroveStatus,
  computeMaxWithdrawable,
  evaluateAdjust,
  evaluateClose,
  evaluateOpen,
  evaluateRedeem,
  evaluateRefinance,
} from '../src'

/**
 * Every gate the evaluators restate, pinned AT its boundary and one wei past it.
 *
 * The mutation gate's site pass (`scripts/mutation/sites.mjs`) flips each comparison's inclusivity. A
 * gate tested only well inside and well outside its threshold passes either way, so these mutants
 * survived; the findings they were registered under are cited on each block. Every threshold below is
 * the contract's, read from `mezo-org/musd` at the line cited, and every `require` there is inclusive
 * of the boundary value: `_requireICRisAboveMCR` `newICR >= MCR` (`BorrowerOperations.sol:1330-1335`),
 * `_requireICRisAboveCCR` (`:1337-1342`), `_requireNewTCRisAboveCCR` (`:1344-1349`),
 * `_requireAtLeastMinNetDebt` `netDebt >= minNetDebt` (`:1239-1244`), `_requireSufficientMUSDBalance`
 * `balance >= repayment` (`:1229-1237`), `_requireTCRoverMCR` `TCR >= MCR` (`TroveManager.sol:1470-1475`),
 * `_requireMUSDBalanceCoversRedemption` (`:1477-1486`).
 *
 * The constants are written out rather than imported (`docs/08-conventions.md` §11).
 */

const E18 = 10n ** 18n
const MUSD = E18
const BTC = E18
const MCR = 11n * 10n ** 17n
const CCR = 15n * 10n ** 17n
const PRICE = 80_000n * MUSD

describe('MK-158, evaluateAdjust, the normal mode TCR gate at exactly CCR', () => {
  // (3 BTC x 80,000) / 160,000 MUSD = 1.5 exactly.
  const at = {
    status: TroveStatus.active,
    collateral: 10n * BTC,
    entireDebt: 20_000n * MUSD,
    capacity: 10n ** 30n,
    musdBalance: 0n,
    minNetDebt: 1_800n * MUSD,
    fee: 0n,
    addCollateral: 0n,
    withdrawCollateral: 0n,
    increaseDebt: 10_000n * MUSD,
    repayDebt: 0n,
    isDebtIncrease: true,
    isRecoveryMode: false,
    price: PRICE,
    systemColl: 3n * BTC,
    systemDebt: 150_000n * MUSD,
  }

  it('a borrow landing the system on exactly CCR passes, and one wei more debt does not', () => {
    const p = evaluateAdjust(at)
    expect(p.resultingTcr, 'fixture: exactly CCR').toBe(CCR)
    expect(p.reasons).not.toContain('TCR_BELOW_CCR')
    expect(evaluateAdjust({ ...at, systemDebt: at.systemDebt + 1n }).reasons).toContain(
      'TCR_BELOW_CCR',
    )
  })
})

describe('MK-157, evaluateAdjust, the Recovery Mode ICR gate at exactly CCR', () => {
  // 1 BTC against 60,000 MUSD is 133%; adding 0.5 BTC and drawing 20,000 lands on 1.5 x 80,000 /
  // 80,000 = 1.5 exactly, which also does not lower the ICR, so only the absolute gate is in play.
  const at = {
    status: TroveStatus.active,
    collateral: 1n * BTC,
    entireDebt: 60_000n * MUSD,
    capacity: 10n ** 30n,
    musdBalance: 0n,
    minNetDebt: 1_800n * MUSD,
    fee: 0n,
    addCollateral: BTC / 2n,
    withdrawCollateral: 0n,
    increaseDebt: 20_000n * MUSD,
    repayDebt: 0n,
    isDebtIncrease: true,
    isRecoveryMode: true,
    price: PRICE,
    systemColl: 1_000n * BTC,
    systemDebt: 80_000_000n * MUSD,
  }

  it('a Recovery Mode borrow resulting in exactly CCR passes, and one wei more does not', () => {
    const p = evaluateAdjust(at)
    expect(p.resultingIcr, 'fixture: exactly CCR').toBe(CCR)
    expect(p.reasons).toEqual([])
    expect(evaluateAdjust({ ...at, increaseDebt: at.increaseDebt + 1n }).reasons).toContain(
      'ICR_BELOW_THRESHOLD',
    )
  })
})

describe('MK-161, MK-162, MK-159, MK-160, evaluateAdjust, the repayment gates', () => {
  // Net debt 19,800 MUSD.
  const repay = {
    status: TroveStatus.active,
    collateral: 10n * BTC,
    entireDebt: 20_000n * MUSD,
    capacity: 10n ** 30n,
    musdBalance: 18_000n * MUSD,
    minNetDebt: 1_800n * MUSD,
    fee: 0n,
    addCollateral: 0n,
    withdrawCollateral: 0n,
    increaseDebt: 0n,
    repayDebt: 18_000n * MUSD,
    isDebtIncrease: false,
    isRecoveryMode: false,
    price: PRICE,
    systemColl: 1_000n * BTC,
    systemDebt: 20_000_000n * MUSD,
  }

  it('a repayment leaving exactly the floor passes, and one wei more does not', () => {
    expect(evaluateAdjust(repay).reasons, '19,800 less 18,000 is exactly 1,800').toEqual([])
    const past = evaluateAdjust({
      ...repay,
      repayDebt: repay.repayDebt + 1n,
      musdBalance: repay.musdBalance + 1n,
    })
    expect(past.reasons).toEqual(['BELOW_MINIMUM_DEBT'])
  })

  it('a balance of exactly the repayment passes, and one wei less does not', () => {
    expect(evaluateAdjust(repay).reasons).not.toContain('INSUFFICIENT_MUSD_BALANCE')
    expect(evaluateAdjust({ ...repay, musdBalance: repay.musdBalance - 1n }).reasons).toContain(
      'INSUFFICIENT_MUSD_BALANCE',
    )
  })

  it('the repayment gates apply to a repayment only, as `:855` scopes them', () => {
    // `if (!_isDebtIncrease && _mUSDChange > 0)` (`BorrowerOperations.sol:855-861`). A Trove whose net
    // debt is under a floor governance has since raised can still take a collateral top up.
    const topUp = evaluateAdjust({
      ...repay,
      entireDebt: 1_200n * MUSD,
      repayDebt: 0n,
      musdBalance: 0n,
      addCollateral: BTC,
    })
    expect(topUp.reasons, 'no repayment, so no floor, balance or excess gate').toEqual([])
    // And a debt increase does not reach them either, even when a repayment leg is also present,
    // which the evaluator refuses as an input on its own terms (MK-077).
    const both = evaluateAdjust({
      ...repay,
      increaseDebt: 100n * MUSD,
      repayDebt: 100_000n * MUSD,
      musdBalance: 0n,
      isDebtIncrease: true,
    })
    expect(both.reasons).toEqual(['DEBT_INCREASE_AND_REPAY'])
  })
})

describe('MK-156, evaluateAdjust, adding and withdrawing collateral at once', () => {
  it('is refused by name, as `_requireSingularCollChange` refuses it (`:1366-1374`)', () => {
    const p = evaluateAdjust({
      status: TroveStatus.active,
      collateral: 10n * BTC,
      entireDebt: 20_000n * MUSD,
      capacity: 10n ** 30n,
      musdBalance: 0n,
      minNetDebt: 1_800n * MUSD,
      fee: 0n,
      addCollateral: 1n,
      withdrawCollateral: 1n,
      increaseDebt: 0n,
      repayDebt: 0n,
      isDebtIncrease: false,
      isRecoveryMode: false,
      price: PRICE,
      systemColl: 1_000n * BTC,
      systemDebt: 20_000_000n * MUSD,
    })
    expect(p.reasons).toEqual(['COLLATERAL_ADD_AND_WITHDRAW'])
  })
})

describe('MK-163, MK-165, evaluateAdjust, the collateral that clears the ICR gate', () => {
  const base = {
    status: TroveStatus.active,
    collateral: 1n * BTC,
    entireDebt: 0n,
    capacity: 10n ** 30n,
    musdBalance: 0n,
    minNetDebt: 1_800n * MUSD,
    fee: 0n,
    addCollateral: 0n,
    withdrawCollateral: 0n,
    increaseDebt: 0n,
    repayDebt: 0n,
    isDebtIncrease: false,
    isRecoveryMode: false,
    price: PRICE,
    systemColl: 1_000n * BTC,
    systemDebt: 20_000_000n * MUSD,
  }

  it('is null for a Trove exactly at MCR, which already clears it', () => {
    // 1.1 BTC x 80,000 / 80,000 MUSD = 1.1 exactly.
    const p = evaluateAdjust({ ...base, collateral: (11n * BTC) / 10n, entireDebt: 80_000n * MUSD })
    expect(p.resultingIcr, 'fixture: exactly MCR').toBe(MCR)
    expect(p.minimumCollateralToClearIcr).toBeNull()
  })

  it('rounds UP, so the figure clears the gate and one wei less does not', () => {
    // An odd wei on both sides, so MCR x debt is not a multiple of the price and floor and ceiling differ.
    const debt = 70_001n * MUSD + 7n
    const price = PRICE + 1n
    const p = evaluateAdjust({ ...base, collateral: 1n, entireDebt: debt, price })
    const min = p.minimumCollateralToClearIcr as bigint
    expect((MCR * debt) % price, 'fixture: not a multiple').not.toBe(0n)
    expect((min * price) / debt >= MCR, 'the figure clears MCR').toBe(true)
    expect(((min - 1n) * price) / debt >= MCR, 'one wei less does not').toBe(false)
  })
})

describe('MK-168, MK-171, MK-175, MK-176, computeMaxWithdrawable', () => {
  // An odd wei in the debt and the price, so every ceiling below differs from its floor.
  const ODD_PRICE = PRICE + 1n
  const normal = {
    collateral: 10n * BTC,
    entireDebt: 70_001n * MUSD + 7n,
    isRecoveryMode: false,
    price: ODD_PRICE,
    systemColl: 1_000_000n * BTC,
    systemDebt: 20_000_000n * MUSD,
  }

  it('in Recovery Mode allows nothing, and in normal mode it does not report Recovery Mode', () => {
    // `_requireNoCollWithdrawal` in Recovery Mode (`BorrowerOperations.sol:1388-1393`).
    const rm = computeMaxWithdrawable({ ...normal, isRecoveryMode: true })
    expect(rm.amount).toBe(0n)
    expect(rm.limitedBy).toBe('RECOVERY_MODE')
    expect(computeMaxWithdrawable(normal).limitedBy).not.toBe('RECOVERY_MODE')
    // And the threshold it reports is the mode's: CCR in Recovery Mode, MCR otherwise.
    expect(rm.icrThreshold).toBe(CCR)
    expect(computeMaxWithdrawable(normal).icrThreshold).toBe(MCR)
  })

  it('keeps the ICR collateral rounded UP, so the answer is withdrawable and one wei more is not', () => {
    const p = computeMaxWithdrawable(normal)
    expect((MCR * normal.entireDebt) % ODD_PRICE, 'fixture: not a multiple').not.toBe(0n)
    expect(p.limitedBy).toBe('ICR')
    const icrAfter = (x: bigint) => ((normal.collateral - x) * ODD_PRICE) / normal.entireDebt
    expect(icrAfter(p.amount) >= MCR, 'the amount leaves the Trove at or above MCR').toBe(true)
    expect(icrAfter(p.amount + 1n) >= MCR, 'one wei more does not').toBe(false)
  })

  it('keeps the SYSTEM collateral rounded UP when the system binds', () => {
    const sys = {
      ...normal,
      collateral: 1_000n * BTC,
      systemColl: 400n * BTC,
      systemDebt: 20_000_001n * MUSD + 7n,
    }
    const p = computeMaxWithdrawable(sys)
    expect((CCR * sys.systemDebt) % ODD_PRICE, 'fixture: not a multiple').not.toBe(0n)
    expect(p.limitedBy).toBe('TCR')
    const tcrAfter = (x: bigint) => ((sys.systemColl - x) * ODD_PRICE) / sys.systemDebt
    expect(tcrAfter(p.amount) >= CCR, 'the amount leaves the system at or above CCR').toBe(true)
    expect(tcrAfter(p.amount + 1n) >= CCR, 'one wei more does not').toBe(false)
  })

  it('names ICR on a tie, as MK-076 decided, and names a limit whenever there is any debt', () => {
    // Each side keeps exactly what its gate needs and has 5 BTC above it, so the two allowances tie.
    const keepIcr = (MCR * 80_000n * MUSD + PRICE - 1n) / PRICE
    const keepTcr = (CCR * 1_000_000n * MUSD + PRICE - 1n) / PRICE
    const tie = computeMaxWithdrawable({
      collateral: keepIcr + 5n * BTC,
      entireDebt: 80_000n * MUSD,
      isRecoveryMode: false,
      price: PRICE,
      systemColl: keepTcr + 5n * BTC,
      systemDebt: 1_000_000n * MUSD,
    })
    expect(tie.amount, 'fixture: both allow exactly 5 BTC').toBe(5n * BTC)
    expect(tie.limitedBy).toBe('ICR')
    const noOwnDebt = computeMaxWithdrawable({ ...normal, entireDebt: 0n })
    expect(
      noOwnDebt.limitedBy,
      'the system still limits a Trove with no debt of its own',
    ).not.toBeNull()
  })
})

describe('MK-180, evaluateClose, the TCR gate at exactly CCR', () => {
  // Removing 1 BTC and 20,000 MUSD leaves 1.5 BTC x 80,000 / 80,000 MUSD = 1.5 exactly.
  const at = {
    status: TroveStatus.active,
    collateral: 1n * BTC,
    entireDebt: 20_000n * MUSD,
    musdBalance: 10n ** 30n,
    canMint: true,
    isRecoveryMode: false,
    price: PRICE,
    systemColl: (25n * BTC) / 10n,
    systemDebt: 100_000n * MUSD,
  }

  it('a close leaving the system on exactly CCR passes, and one wei more system debt does not', () => {
    const p = evaluateClose(at)
    expect(p.resultingTcr, 'fixture: exactly CCR').toBe(CCR)
    expect(p.reasons).not.toContain('TCR_BELOW_CCR')
    expect(evaluateClose({ ...at, systemDebt: at.systemDebt + 1n }).reasons).toContain(
      'TCR_BELOW_CCR',
    )
  })
})

describe('MK-181, evaluateOpen, the TCR gate at exactly CCR', () => {
  // 3 BTC x 80,000 / (140,000 + 20,000) MUSD = 1.5 exactly.
  const at = {
    collateral: 1n * BTC,
    debt: 19_800n * MUSD,
    fee: 0n,
    feeExempt: true,
    minNetDebt: 1_800n * MUSD,
    isRecoveryMode: false,
    price: PRICE,
    systemColl: 2n * BTC,
    systemDebt: 140_000n * MUSD,
  }

  it('an open landing the system on exactly CCR passes, and one wei more does not', () => {
    const p = evaluateOpen(at)
    expect(p.resultingTcr, 'fixture: exactly CCR').toBe(CCR)
    expect(p.reasons).toEqual([])
    expect(evaluateOpen({ ...at, debt: at.debt + 1n }).reasons).toContain('TCR_BELOW_CCR')
  })
})

describe('MK-204, MK-205, evaluateRefinance, both ratio gates at their boundary', () => {
  const base = {
    status: TroveStatus.active,
    collateral: (11n * BTC) / 10n,
    principal: 79_000n * MUSD,
    interestOwed: 0n,
    refinancingFeePercentage: 20,
    borrowingFeeOnBase: 1_000n * MUSD,
    feeExempt: false,
    isRecoveryMode: false,
    price: PRICE,
    systemColl: 1_000n * BTC,
    systemDebt: 20_000_000n * MUSD,
    currentInterestRateBps: 100,
    globalInterestRateBps: 100,
    currentCapacity: 0n,
  }

  it('a refinance leaving the Trove on exactly MCR passes, and one wei more principal does not', () => {
    // 1.1 BTC x 80,000 / (79,000 + 1,000 fee) MUSD = 1.1 exactly. `_requireICRisAboveMCR` (`:1058`).
    const p = evaluateRefinance(base)
    expect(p.resultingIcr, 'fixture: exactly MCR').toBe(MCR)
    expect(p.reasons).toEqual([])
    expect(evaluateRefinance({ ...base, principal: base.principal + 1n }).reasons).toContain(
      'ICR_BELOW_MCR',
    )
  })

  it('a refinance leaving the system on exactly CCR passes, and one wei more does not', () => {
    // 3 BTC x 80,000 / (159,000 + 1,000 fee) MUSD = 1.5 exactly. `_requireNewTCRisAboveCCR` (`:1059`).
    const sys = {
      ...base,
      collateral: 10n * BTC,
      principal: 1_000n * MUSD,
      systemColl: 3n * BTC,
      systemDebt: 159_000n * MUSD,
    }
    const p = evaluateRefinance(sys)
    expect(p.resultingTcr, 'fixture: exactly CCR').toBe(CCR)
    expect(p.reasons).toEqual([])
    expect(evaluateRefinance({ ...sys, systemDebt: sys.systemDebt + 1n }).reasons).toContain(
      'TCR_BELOW_CCR',
    )
  })
})

describe('evaluateRedeem, its gates and edges at their boundary', () => {
  const trove = (owner: string, rateBps = 100n) => ({
    owner: owner as `0x${string}`,
    entireDebt: 2_208n * MUSD,
    principal: 2_208n * MUSD,
    netDebt: 2_008n * MUSD,
    interestRateBps: rateBps,
    collateral: 10n ** 21n,
    interestOwed: 0n,
  })
  const base = {
    amount: 100n * MUSD,
    globalInterestRateBps: 100n,
    musdBalance: 100n * MUSD,
    minNetDebt: 1_800n * MUSD,
    tcr: MCR,
    price: PRICE,
    eligible: [trove('0xaaa')],
  }

  it('MK-196, a system at exactly MCR can be redeemed against, and one wei under cannot', () => {
    expect(evaluateRedeem(base).reasons).not.toContain('SYSTEM_TCR_BELOW_MCR')
    expect(evaluateRedeem({ ...base, tcr: MCR - 1n }).reasons).toContain('SYSTEM_TCR_BELOW_MCR')
  })

  it('MK-197, a balance of exactly the amount passes, and one wei less does not', () => {
    expect(evaluateRedeem(base).reasons).not.toContain('INSUFFICIENT_MUSD_BALANCE')
    expect(evaluateRedeem({ ...base, musdBalance: base.amount - 1n }).reasons).toContain(
      'INSUFFICIENT_MUSD_BALANCE',
    )
  })

  it('MK-193, with nothing redeemable the first Trove net debt is reported as 0n, not left undefined', () => {
    const p = evaluateRedeem({ ...base, eligible: [] })
    expect(p.firstTroveNetDebt).toBe(0n)
    expect(p.nextViableAmount).toBe(0n)
  })

  it('MK-195, a first Trove with no net debt has no next viable amount, whatever its margin', () => {
    const empty = {
      ...trove('0xaaa'),
      netDebt: 0n,
      entireDebt: 200n * MUSD,
      principal: 10_000n * MUSD,
    }
    const p = evaluateRedeem({ ...base, eligible: [empty] })
    expect(p.accrualMargin, 'fixture: the margin itself is not zero').toBeGreaterThan(0n)
    expect(p.nextViableAmount).toBe(0n)
  })

  it('MK-199, a request consumed exactly by whole Troves takes no partial from the next one', () => {
    // At a zero rate the accrual margin is zero, so an amount of exactly the first net debt consumes
    // it whole with nothing left over, and the loop ends at `remaining > 0` (`TroveManager.sol:360-363`).
    const p = evaluateRedeem({
      ...base,
      amount: 2_008n * MUSD,
      musdBalance: 10n ** 30n,
      eligible: [trove('0xaaa', 0n), trove('0xbbb', 0n)],
    })
    expect(p.viable).toBe(true)
    expect(p.redeemable).toBe(2_008n * MUSD)
    expect(p.partial, 'no lot of zero on the second Trove').toBeNull()
  })
})
