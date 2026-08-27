import { describe, expect, it } from 'vitest'
import {
  CCR,
  MCR,
  MUSD_GAS_COMPENSATION,
  computeMaxWithdrawable,
  evaluateAdjust,
  evaluateClose,
} from '../src'

const MUSD = 10n ** 18n
const BTC = 10n ** 18n
const PRICE = 80_000n * MUSD

/** A healthy fixture: 2 BTC against 100k MUSD is an ICR of 160%. */
const base = {
  status: 1,
  collateral: 2n * BTC,
  entireDebt: 100_000n * MUSD,
  capacity: 200_000n * MUSD,
  musdBalance: 500_000n * MUSD,
  minNetDebt: 1_800n * MUSD,
  fee: 0n,
  addCollateral: 0n,
  withdrawCollateral: 0n,
  increaseDebt: 0n,
  repayDebt: 0n,
  isRecoveryMode: false,
  price: PRICE,
  systemColl: 1_000n * BTC,
  systemDebt: 20_000_000n * MUSD,
}

describe('MK-042, the adjust preview against the gates the contract actually runs', () => {
  it('MK-038: a top-up that RAISES ICR is still refused when the result is under MCR', () => {
    // The case the earlier scope limit got wrong. `_requireICRisAboveMCR` is
    // `require(_newICR >= MCR)` (BorrowerOperations.sol:1201, :1330-1335): it tests the
    // RESULTING level, not the direction. So an improving operation can be refused.
    const sunk = { ...base, collateral: BTC, entireDebt: 100_000n * MUSD } // ICR 80%
    const before = evaluateAdjust(sunk)
    const after = evaluateAdjust({ ...sunk, addCollateral: BTC / 100n })

    expect(after.resultingIcr, 'the top-up genuinely improves the position').toBeGreaterThan(
      before.currentIcr,
    )
    expect(after.viable, 'and it is still refused').toBe(false)
    expect(after.bindingConstraint).toBe('ICR_BELOW_THRESHOLD')
    expect(after.icrIsAbsolute, 'the flag that tells an integrator why').toBe(true)
    // And the preview says what WOULD clear it, which is the number a rescue needs.
    expect(after.minimumCollateralToClearIcr).not.toBeNull()
    const rescued = evaluateAdjust({
      ...sunk,
      addCollateral: (after.minimumCollateralToClearIcr as bigint) - sunk.collateral,
    })
    expect(rescued.resultingIcr, 'and that number actually clears MCR').toBeGreaterThanOrEqual(MCR)
  })

  it('MK-042: Recovery Mode refuses a collateral withdrawal OUTRIGHT, not by amount', () => {
    // `_requireNoCollWithdrawal` (:1270) permits zero, so there is no smaller amount that
    // works. A preview that reported a ratio here would send a user hunting for a number
    // that does not exist.
    const rm = { ...base, isRecoveryMode: true }
    for (const amount of [1n, BTC / 1000n, BTC]) {
      const p = evaluateAdjust({ ...rm, withdrawCollateral: amount })
      expect(p.viable).toBe(false)
      expect(p.reasons).toContain('COLLATERAL_WITHDRAWAL_IN_RECOVERY_MODE')
    }
    expect(computeMaxWithdrawable({ ...rm }).amount, 'and the max is zero').toBe(0n)
    expect(computeMaxWithdrawable({ ...rm }).limitedBy).toBe('RECOVERY_MODE')
  })

  it('MK-042: Recovery Mode does NOT check TCR, and normal mode does', () => {
    // The mode with the tighter reputation has the SHORTER list for a pure top-up:
    // :1265-1275 puts both ICR requirements behind `if (_isDebtIncrease)` and never looks
    // at TCR, while :1197-1210 checks ICR and TCR on every adjustment.
    const thin = { ...base, systemColl: BTC, systemDebt: 10_000_000n * MUSD }
    const normal = evaluateAdjust({ ...thin, addCollateral: BTC })
    const recovery = evaluateAdjust({ ...thin, isRecoveryMode: true, addCollateral: BTC })

    expect(normal.reasons, 'normal mode enforces the system ratio').toContain('TCR_BELOW_CCR')
    expect(recovery.reasons, 'Recovery Mode does not').not.toContain('TCR_BELOW_CCR')
    expect(recovery.viable, 'so a pure top-up is ungated there').toBe(true)
  })

  it('MK-042: a plain borrow can NEVER succeed in Recovery Mode', () => {
    // withdrawMUSD sends no collateral, so newICR < oldICR always, and
    // `_requireNewICRisAboveOldICR` (:1273) cannot be satisfied at any draw size.
    for (const amount of [1n, 100n * MUSD, 10_000n * MUSD]) {
      const p = evaluateAdjust({ ...base, isRecoveryMode: true, increaseDebt: amount })
      expect(p.viable, `draw ${amount}`).toBe(false)
      expect(p.reasons).toContain('ICR_NOT_IMPROVED_IN_RECOVERY_MODE')
    }
  })

  it('MK-042: the repayment gates are the three the contract runs, with the gas reserve', () => {
    // `_requireValidMUSDRepayment` (:1246-1254) compares against `debt - 200 MUSD`, not
    // against the entire debt, so the reserve is not repayable.
    const netDebt = base.entireDebt - MUSD_GAS_COMPENSATION
    expect(evaluateAdjust({ ...base, repayDebt: netDebt }).reasons).not.toContain(
      'REPAY_EXCEEDS_DEBT',
    )
    expect(evaluateAdjust({ ...base, repayDebt: netDebt + 1n }).reasons).toContain(
      'REPAY_EXCEEDS_DEBT',
    )
    expect(evaluateAdjust({ ...base, repayDebt: 100n * MUSD, musdBalance: 1n }).reasons).toContain(
      'INSUFFICIENT_MUSD_BALANCE',
    )
    expect(evaluateAdjust({ ...base, repayDebt: netDebt - 1n }).reasons).toContain(
      'BELOW_MINIMUM_DEBT',
    )
  })

  it('MK-042: maxWithdrawableCollateral lands exactly on the gate, not one wei past it', () => {
    const max = computeMaxWithdrawable(base)
    expect(max.amount).toBeGreaterThan(0n)
    const at = evaluateAdjust({ ...base, withdrawCollateral: max.amount })
    const past = evaluateAdjust({ ...base, withdrawCollateral: max.amount + 1n })
    expect(at.viable, 'the reported max is accepted').toBe(true)
    expect(past.viable, 'and one wei more is not').toBe(false)
  })
})

describe('MK-042, the close preview and its two conditional gates', () => {
  const closeBase = {
    status: 1,
    collateral: 2n * BTC,
    entireDebt: 100_000n * MUSD,
    musdBalance: 100_000n * MUSD,
    canMint: true,
    isRecoveryMode: false,
    price: PRICE,
    systemColl: 1_000n * BTC,
    systemDebt: 20_000_000n * MUSD,
  }

  it('the balance requirement is entireDebt minus the gas compensation', () => {
    // `:963` compares against `debt - MUSD_GAS_COMPENSATION`, not the net debt.
    const required = closeBase.entireDebt - MUSD_GAS_COMPENSATION
    expect(evaluateClose({ ...closeBase, musdBalance: required }).viable).toBe(true)
    const short = evaluateClose({ ...closeBase, musdBalance: required - 1n })
    expect(short.viable).toBe(false)
    expect(short.musdShortfall).toBe(1n)
  })

  it('canMint gates BOTH the Recovery Mode check and the TCR check', () => {
    // `:953` and `:964` are both `if (canMint)`. With BorrowerOperations off the mint list,
    // closing is permitted in Recovery Mode and the TCR check does not run at all.
    const rm = { ...closeBase, isRecoveryMode: true }
    expect(evaluateClose({ ...rm, canMint: true }).reasons).toContain('RECOVERY_MODE')
    expect(evaluateClose({ ...rm, canMint: false }).reasons).not.toContain('RECOVERY_MODE')
    expect(evaluateClose({ ...rm, canMint: false }).viable).toBe(true)
  })

  it('closing removes the whole position from the system ratio', () => {
    const thin = { ...closeBase, systemColl: 3n * BTC, systemDebt: 150_000n * MUSD }
    const p = evaluateClose(thin)
    expect(p.resultingTcr).toBe(
      ((thin.systemColl - thin.collateral) * PRICE) / (thin.systemDebt - thin.entireDebt),
    )
  })
})

describe('MK-042, the thresholds are the contract constants', () => {
  it('MCR normally, CCR in Recovery Mode', () => {
    expect(evaluateAdjust(base).icrThreshold).toBe(MCR)
    expect(evaluateAdjust({ ...base, isRecoveryMode: true }).icrThreshold).toBe(CCR)
  })
})

describe('MK-042, the clamping branches, which only fire on degenerate inputs', () => {
  it('a Trove whose debt is at or below the gas compensation clamps rather than underflowing', () => {
    // `_getNetDebt` (`:856`) subtracts the 200 MUSD reserve. A Trove cannot normally hold less
    // than that, but the evaluator must not produce a negative if one somehow does: the
    // clamp is why a preview returns a verdict instead of throwing.
    const dust = { ...base, entireDebt: MUSD_GAS_COMPENSATION }
    const p = evaluateAdjust({ ...dust, repayDebt: 1n })
    expect(p.reasons).toContain('REPAY_EXCEEDS_DEBT')
    expect(p.reasons).toContain('BELOW_MINIMUM_DEBT')
  })

  it('a withdrawal larger than the balance reports the reason rather than a negative ratio', () => {
    const p = evaluateAdjust({ ...base, withdrawCollateral: base.collateral * 2n })
    expect(p.reasons).toContain('WITHDRAWAL_EXCEEDS_COLLATERAL')
    expect(p.resultingIcr, 'clamped at zero, not negative').toBe(0n)
  })

  it('close clamps when this Trove is the whole system', () => {
    const only = evaluateClose({
      status: 1,
      collateral: 2n * BTC,
      entireDebt: 100_000n * MUSD,
      musdBalance: 500_000n * MUSD,
      canMint: false,
      isRecoveryMode: false,
      price: PRICE,
      systemColl: 2n * BTC,
      systemDebt: 100_000n * MUSD,
    })
    // Removing the only position leaves an empty system: no division by zero, and with
    // canMint false the TCR gate does not run at all (`:964`).
    expect(only.reasons).not.toContain('TCR_BELOW_CCR')
    expect(only.viable).toBe(true)
  })

  it('close with canMint false skips the TCR gate even when TCR would fail', () => {
    const thin = {
      status: 1,
      collateral: 2n * BTC,
      entireDebt: 100_000n * MUSD,
      musdBalance: 500_000n * MUSD,
      isRecoveryMode: false,
      price: PRICE,
      systemColl: 2n * BTC + 1n,
      systemDebt: 100_001n * MUSD,
    }
    expect(evaluateClose({ ...thin, canMint: true }).reasons).toContain('TCR_BELOW_CCR')
    expect(evaluateClose({ ...thin, canMint: false }).reasons).not.toContain('TCR_BELOW_CCR')
  })

  it('maxWithdrawable handles a system with no collateral to give', () => {
    const m = computeMaxWithdrawable({
      collateral: 0n,
      entireDebt: 100_000n * MUSD,
      isRecoveryMode: false,
      price: PRICE,
      systemColl: 0n,
      systemDebt: 20_000_000n * MUSD,
    })
    expect(m.amount).toBe(0n)
  })
})
