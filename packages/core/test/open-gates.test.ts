import { describe, expect, it } from 'vitest'
import { CCR, MCR, TroveStatus, evaluateOpen } from '../src'

const MUSD = 10n ** 18n
const BTC = 10n ** 18n
const PRICE = 80_000n * MUSD

/**
 * MK-047. `previewOpen` claimed to enforce every condition `_openTrove` does and enforced
 * three of the four. The missing one was the FIRST gate on the path.
 *
 * `_openTrove` (`BorrowerOperations.sol:613-666`), read for this file rather than carried
 * forward, runs exactly these gates in this order:
 *
 *   :633  `_requireTroveisNotActive`   -> :1140-1149, `status != Status.active`
 *   :645  `_requireAtLeastMinNetDebt`  -> :1239-1244
 *   :655  `_requireICRisAboveCCR`      -> Recovery Mode only
 *   :657  `_requireICRisAboveMCR`      -> normal mode
 *   :665  `_requireNewTCRisAboveCCR`   -> normal mode only
 *
 * Nothing after `:665` reverts. Four gates, and `OpenBlockReason` now has four values.
 */
const base = {
  collateral: BTC / 10n,
  debt: 2_000n * MUSD,
  fee: 2n * MUSD,
  feeExempt: false,
  minNetDebt: 1_800n * MUSD,
  isRecoveryMode: false,
  price: PRICE,
  systemColl: 1_000n * BTC,
  systemDebt: 20_000_000n * MUSD,
}

describe('MK-047, the gate previewOpen was missing', () => {
  it('an owner whose Trove is ACTIVE is refused, and it binds first', () => {
    // The live testnet run reported `viable=true []` here and the raw contract call reverted
    // with "BorrowerOps: Trove is active". This is that case.
    const p = evaluateOpen({ ...base, troveStatus: TroveStatus.active })
    expect(p.viable).toBe(false)
    expect(p.reasons).toContain('TROVE_ALREADY_ACTIVE')
    expect(
      p.bindingConstraint,
      'it is the FIRST gate on the path (:633), so it must bind first',
    ).toBe('TROVE_ALREADY_ACTIVE')
  })

  it('a CLOSED Trove does not block a reopen, because the contract compares against active', () => {
    // `:1146` is `status != Status.active`, not "has never had a Trove". Closing by the owner,
    // by liquidation or by redemption all leave a status that permits opening again.
    for (const status of [
      TroveStatus.nonExistent,
      TroveStatus.closedByOwner,
      TroveStatus.closedByLiquidation,
      TroveStatus.closedByRedemption,
    ]) {
      const p = evaluateOpen({ ...base, troveStatus: status })
      expect(p.reasons, `status ${status}`).not.toContain('TROVE_ALREADY_ACTIVE')
      expect(p.viable, `status ${status}`).toBe(true)
    }
  })

  it('with no account the gate is NOT evaluated, and the absence is reported rather than guessed', () => {
    // Same rule as `feeExempt`: without an account there is nobody to ask about. Reporting
    // `viable: true` here is correct, because the question was never asked, and
    // `troveStatus: undefined` is how a caller can tell.
    const p = evaluateOpen({ ...base, troveStatus: undefined })
    expect(p.troveStatus).toBeUndefined()
    expect(p.reasons).not.toContain('TROVE_ALREADY_ACTIVE')
  })

  it('the reason list has one entry per contract gate, and they are in call order', () => {
    // The pin that stops the docstring and the code drifting apart again. If a gate is added
    // to `_openTrove`, or one of these is dropped, this fails.
    const everything = evaluateOpen({
      ...base,
      troveStatus: TroveStatus.active,
      debt: 1n, // below the floor
      fee: 0n,
      collateral: 1n, // ICR at essentially zero
      systemColl: 1n,
      systemDebt: 10_000_000n * MUSD, // resulting TCR far below CCR
    })
    expect(everything.reasons).toEqual([
      'TROVE_ALREADY_ACTIVE',
      'BELOW_MINIMUM_DEBT',
      'ICR_BELOW_THRESHOLD',
      'TCR_BELOW_CCR',
    ])
  })

  it('the thresholds stay mode correct with the new gate in place', () => {
    expect(evaluateOpen({ ...base, troveStatus: 0 }).icrThreshold).toBe(MCR)
    expect(evaluateOpen({ ...base, troveStatus: 0, isRecoveryMode: true }).icrThreshold).toBe(CCR)
  })
})
