import { describe, expect, it } from 'vitest'
import {
  BPS_DIVISOR,
  CCR,
  MCR,
  MUSD_GAS_COMPENSATION,
  NICR_PRECISION,
  SECONDS_PER_YEAR,
  computeEntireDebt,
  computeICR,
  computeLiquidationPrice,
  computeNICR,
  getHealthFactor,
} from '../src'

/**
 * Chain-free unit layer for the pure math (MK-016, and the "unit layer runs with no
 * chain" row of MK-015). Runs in the `unit` vitest project: no globalSetup, no anvil,
 * no RPC URL.
 *
 * GROUND TRUTH. Every expected value below is derived from the Solidity, read at
 * `mezo-org/musd` (public repo, `main`), NOT from running the SDK and recording its
 * output. A test that asserts the current output is a snapshot, not a check.
 *
 *   `solidity/contracts/dependencies/LiquityMath.sol`
 *     :15    NICR_PRECISION = 1e20
 *     :28-40 _computeNominalCR(coll, debt) = debt > 0 ? coll * 1e20 / debt : type(uint256).max
 *     :42-57 _computeCR(coll, debt, price) = debt > 0 ? coll * price / debt : type(uint256).max
 *   `solidity/contracts/dependencies/LiquityBase.sol`
 *     :22    MCR = 1.1e18
 *     :25    CCR = 1.5e18
 *     :28    MUSD_GAS_COMPENSATION = 200e18
 *     :103   _getCompositeDebt(debt) = debt + MUSD_GAS_COMPENSATION
 *   `solidity/contracts/dependencies/InterestRateMath.sol`
 *     :9     SECONDS_IN_A_YEAR = 31_556_952
 *     :10    BPS = 10_000
 *     :12-22 calculateInterestOwed = principal * rate * elapsed / (BPS * SECONDS_IN_A_YEAR)
 *   `solidity/contracts/TroveManager.sol`
 *     :1148  the only liquidation gate: `if (vars.ICR < MCR)`. STRICT less-than, and
 *            the file contains no reference to CCR at all.
 *
 * Contract line numbers were read at the time this test was written and may drift as
 * upstream changes; the quoted rule, not the line number, is the anchor.
 *
 * The fork-side cross-checks against the contract's own `pure` helpers (phase3, phase4)
 * are the other half of the pair and are deliberately kept: these tests pin the formula,
 * those prove the formula is the contract's.
 */

/** `type(uint256).max`, the contract's "infinite CR" sentinel for a zero-debt position. */
const UINT256_MAX = (1n << 256n) - 1n

const E18 = 10n ** 18n

describe('computeICR (LiquityMath._computeCR)', () => {
  it('mirrors coll * price / debt, multiply before divide', () => {
    // 0.05 BTC at 100k USD/BTC against 2700 MUSD of entire debt.
    // 5e16 * 1e23 / 2.7e21 = 1851851851851851851 (floor division, one wei of truncation).
    expect(
      computeICR({ collateral: 5n * 10n ** 16n, entireDebt: 2700n * E18, price: 100_000n * E18 }),
    ).toBe(1_851_851_851_851_851_851n)
  })

  it('returns the type(uint256).max sentinel for zero debt', () => {
    // LiquityMath.sol:52-56, the `_debt == 0` branch. Not zero, not a throw.
    expect(computeICR({ collateral: E18, entireDebt: 0n, price: 100_000n * E18 })).toBe(UINT256_MAX)
    // The sentinel does not depend on collateral or price: a zero-collateral, zero-debt
    // position is still "infinite CR" to the contract.
    expect(computeICR({ collateral: 0n, entireDebt: 0n, price: 0n })).toBe(UINT256_MAX)
  })

  it('is exact at MCR and at CCR, and moves one wei at a time across each', () => {
    // With debt = 1e18 and price = 1e18 the formula collapses to `icr === collateral`,
    // so the threshold cases can be constructed exactly rather than approached.
    const at = (collateral: bigint) => computeICR({ collateral, entireDebt: E18, price: E18 })

    expect(at(MCR)).toBe(MCR)
    expect(at(MCR - 1n)).toBe(MCR - 1n)
    expect(at(MCR + 1n)).toBe(MCR + 1n)

    expect(at(CCR)).toBe(CCR)
    expect(at(CCR - 1n)).toBe(CCR - 1n)
    expect(at(CCR + 1n)).toBe(CCR + 1n)
  })

  it('pins the liquidation gate as STRICT `icr < MCR` (TroveManager.sol:1148)', () => {
    // computeICR carries no threshold of its own; this pins the comparison every caller
    // must make. Exactly at MCR a position is NOT liquidatable; one wei below it is.
    const at = (collateral: bigint) => computeICR({ collateral, entireDebt: E18, price: E18 })

    expect(at(MCR) < MCR).toBe(false)
    expect(at(MCR - 1n) < MCR).toBe(true)
    expect(at(MCR + 1n) < MCR).toBe(false)
  })

  it('truncates toward zero, matching Solidity floor division', () => {
    // 1 wei of collateral at price 1e18 against 3 wei of debt: 1e18 / 3 = 333...333.
    expect(computeICR({ collateral: 1n, entireDebt: 3n, price: E18 })).toBe(
      333_333_333_333_333_333n,
    )
    // Below one full unit of ratio the result floors to 0, never to a negative or a throw.
    expect(computeICR({ collateral: 1n, entireDebt: E18 + 1n, price: 1n })).toBe(0n)
  })
})

describe('computeNICR (LiquityMath._computeNominalCR)', () => {
  it('mirrors coll * 1e20 / debt and is price-independent', () => {
    // 5e16 * 1e20 / 2.7e21 = 1851851851851851.
    expect(computeNICR({ collateral: 5n * 10n ** 16n, entireDebt: 2700n * E18 })).toBe(
      1_851_851_851_851_851n,
    )
  })

  it('uses 1e20 precision, exactly (LiquityMath.sol:15)', () => {
    expect(NICR_PRECISION).toBe(100n * E18)
    // coll == debt collapses the formula to the precision constant itself.
    expect(computeNICR({ collateral: 7n * E18, entireDebt: 7n * E18 })).toBe(NICR_PRECISION)
  })

  it('THROWS on zero debt instead of returning the contract sentinel', () => {
    // Deliberate, documented divergence: the contract returns type(uint256).max
    // (LiquityMath.sol:35-39), which is meaningless as a SortedTroves insertion hint,
    // so the SDK refuses the input rather than emitting an unusable hint.
    expect(() => computeNICR({ collateral: E18, entireDebt: 0n })).toThrow(RangeError)
    expect(() => computeNICR({ collateral: E18, entireDebt: -1n })).toThrow(RangeError)
    // One wei of debt is enough to be valid: the guard is on zero, not on smallness.
    expect(computeNICR({ collateral: E18, entireDebt: 1n })).toBe(E18 * NICR_PRECISION)
  })
})

describe('computeLiquidationPrice', () => {
  it('is the price at which ICR lands exactly on MCR', () => {
    // Derived from _computeCR: solving coll * price / debt == MCR for price gives
    // price = MCR * debt / coll. 1.1e18 * 2.7e21 / 5e16 = 5.94e22.
    const collateral = 5n * 10n ** 16n
    const entireDebt = 2700n * E18
    const liquidationPrice = computeLiquidationPrice({ collateral, entireDebt })

    expect(liquidationPrice).toBe(59_400n * E18)
    // Round-trip against the ICR formula: at that price ICR is MCR to the wei, so the
    // position is NOT yet liquidatable (the gate is strict `<`).
    expect(computeICR({ collateral, entireDebt, price: liquidationPrice })).toBe(MCR)
    // One wei of price lower and it crosses.
    expect(computeICR({ collateral, entireDebt, price: liquidationPrice - 1n })).toBe(MCR - 1n)
  })

  it('returns 0 for zero collateral rather than dividing by zero', () => {
    expect(computeLiquidationPrice({ collateral: 0n, entireDebt: 2700n * E18 })).toBe(0n)
  })

  it('returns 0 for zero debt, the price floor below which nothing can liquidate', () => {
    expect(computeLiquidationPrice({ collateral: E18, entireDebt: 0n })).toBe(0n)
  })

  it('floors, so the returned price can be a wei under the exact threshold', () => {
    // MCR * 7 / 3 = 7.7e18 / 3 = 2566666666666666666.66..., floored.
    expect(computeLiquidationPrice({ collateral: 3n, entireDebt: 7n })).toBe(
      2_566_666_666_666_666_666n,
    )
  })
})

describe('computeEntireDebt (InterestRateMath.calculateInterestOwed)', () => {
  // draw 2500 + fee 12.5 + the 200 gas reserve. LiquityBase.sol:103 makes the gas
  // reserve part of the stored debt, and the fork gate (phase4) confirmed interest
  // accrues on that composite, not on the net draw.
  const draw = 2500n * E18
  const fee = 125n * 10n ** 17n
  const principal = draw + fee + MUSD_GAS_COMPENSATION

  it('returns the bare principal at zero elapsed time (the at-open case)', () => {
    expect(principal).toBe(2712n * E18 + 5n * 10n ** 17n)
    expect(computeEntireDebt({ draw, fee, rate: 500, elapsedSeconds: 0 })).toBe(principal)
    // The rate is irrelevant when no time has passed.
    expect(computeEntireDebt({ draw, fee, rate: 10_000, elapsedSeconds: 0n })).toBe(principal)
  })

  it('accrues simple interest over exactly one contract year', () => {
    // elapsed == SECONDS_IN_A_YEAR cancels the denominator: interest = principal * 500 / 10000
    // = 5% = 135.625e18. Non-compounding, so entireDebt = principal + interest.
    const interest = 135n * E18 + 625n * 10n ** 15n
    expect(interest).toBe((principal * 500n) / BPS_DIVISOR)
    expect(computeEntireDebt({ draw, fee, rate: 500, elapsedSeconds: SECONDS_PER_YEAR })).toBe(
      principal + interest,
    )
  })

  it('floors sub-second-scale interest exactly as the contract does', () => {
    // 2712.5e18 * 500 * 1 / (10000 * 31556952), floored: 4297785159986 wei.
    expect(computeEntireDebt({ draw, fee, rate: 500, elapsedSeconds: 1 })).toBe(
      principal + 4_297_785_159_986n,
    )
  })

  it('uses the Gregorian year 31_556_952, not 365 or 365.25 days', () => {
    // A one-second-per-year difference in the divisor changes the floored result, so
    // this pins the constant rather than merely restating it.
    expect(SECONDS_PER_YEAR).toBe(31_556_952n)
    const withWrongYear = (principal * 500n * SECONDS_PER_YEAR) / (BPS_DIVISOR * 31_536_000n)
    expect(withWrongYear).not.toBe((principal * 500n) / BPS_DIVISOR)
  })

  it('treats negative elapsed time as zero rather than reducing the debt', () => {
    expect(computeEntireDebt({ draw, fee, rate: 500, elapsedSeconds: -1 })).toBe(principal)
  })

  it('accrues nothing at a zero interest rate', () => {
    expect(computeEntireDebt({ draw, fee, rate: 0, elapsedSeconds: SECONDS_PER_YEAR })).toBe(
      principal,
    )
  })
})

describe('getHealthFactor', () => {
  it('is exactly 1 when ICR sits on MCR', () => {
    expect(getHealthFactor({ icr: MCR })).toBe(1)
  })

  it('drops below 1 one wei under MCR, and rises above it one wei over', () => {
    // The 1e6 fixed-point step means one wei below MCR floors to 0.999999, not to 1.
    expect(getHealthFactor({ icr: MCR - 1n })).toBe(0.999999)
    expect(getHealthFactor({ icr: MCR - 1n }) < 1).toBe(true)
    // One wei above MCR is inside the same 1e-6 bucket, so it still reads as 1.0. This
    // is a rounding limit of a UI ratio, not a threshold test: never gate a liquidation
    // decision on healthFactor, compare `icr < MCR` (TroveManager.sol:1148).
    expect(getHealthFactor({ icr: MCR + 1n })).toBe(1)
  })

  it('reports CCR as 1.363636, the ratio CCR / MCR', () => {
    // 1.5e18 * 1e6 / 1.1e18 = 1363636 (floored) / 1e6.
    expect(getHealthFactor({ icr: CCR })).toBe(1.363636)
    expect(getHealthFactor({ icr: CCR - 1n })).toBe(1.363636)
    expect(getHealthFactor({ icr: CCR + 1n })).toBe(1.363636)
  })

  it('is 0 at zero ICR', () => {
    expect(getHealthFactor({ icr: 0n })).toBe(0)
  })

  it('loses its meaning on the zero-debt sentinel (MK-017, known limit)', () => {
    // computeICR returns type(uint256).max for a zero-debt position. Pushed through the
    // 1e6 fixed-point scale it does NOT overflow to Infinity, which would at least be a
    // legible "no debt" signal; it converts to a finite float of roughly
    // 2^256 / 1.1e18 = 1.05e59, past Number.MAX_SAFE_INTEGER by 44 orders of magnitude
    // and renderable by no UI. Pinned as current behavior, NOT endorsed: MK-017 is open
    // and this assertion is expected to change when the sentinel is handled.
    const healthFactor = getHealthFactor({ icr: UINT256_MAX })
    expect(Number.isFinite(healthFactor)).toBe(true)
    expect(healthFactor).toBeGreaterThan(1e58)
    expect(healthFactor).toBeGreaterThan(Number.MAX_SAFE_INTEGER)
  })
})
