import type { PublicClient, WalletClient } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  BelowMinimumDebt,
  InvalidAdjustment,
  MaxFeeExceeded,
  computeMaxWithdrawable,
  evaluateAdjust,
  evaluateClose,
  evaluateRefinance,
  getAddresses,
  isTroveLiquidatable,
} from '../src'
import type { WriteDeps } from '../src/internal/write'
import { openTrove } from '../src/trove'

/**
 * The P13 wave's gates, pinned as pure functions where they are pure and through the real write
 * function where they are not.
 *
 * Every block below fails if its finding comes back, which `scripts/mutation-check.mjs` proves
 * by putting each one back one at a time rather than by assertion.
 */

const E18 = 10n ** 18n
const MUSD = E18
const BTC = E18
const PRICE = 100_000n * E18
const MCR = 11n * 10n ** 17n
const CCR = 15n * 10n ** 17n
const T = getAddresses(31611)
const OWNER = '0x000000000000000000000000000000000000dEaD' as const

/* -------------------------------------------------------------------------------------------
 * MK-074 · the last Trove can neither be closed nor liquidated
 * ---------------------------------------------------------------------------------------- */

describe('MK-074, the last Trove in the system', () => {
  const closeBase = {
    status: 1,
    collateral: 2n * BTC,
    entireDebt: 10_000n * MUSD,
    musdBalance: 1_000_000n * MUSD,
    canMint: true,
    isRecoveryMode: false,
    price: PRICE,
    systemColl: 1_000n * BTC,
    systemDebt: 20_000_000n * MUSD,
  }

  it('previewClose refuses the last Trove, on the count OR the sorted list size', () => {
    // Both halves, because `_requireMoreThanOneTroveInSystem` (`TroveManager.sol:1488-1496`)
    // requires BOTH to exceed one and they are different structures.
    const byCount = evaluateClose({ ...closeBase, troveOwnersCount: 1n, sortedTrovesSize: 42n })
    expect(byCount.reasons).toContain('LAST_TROVE_IN_SYSTEM')
    expect(byCount.viable).toBe(false)

    const bySize = evaluateClose({ ...closeBase, troveOwnersCount: 42n, sortedTrovesSize: 1n })
    expect(bySize.reasons).toContain('LAST_TROVE_IN_SYSTEM')
    expect(bySize.viable).toBe(false)
  })

  it('and allows it in a populated system, so the gate is about the count and not about closing', () => {
    const ok = evaluateClose({ ...closeBase, troveOwnersCount: 42n, sortedTrovesSize: 42n })
    expect(ok.viable).toBe(true)
    expect(ok.reasons).toEqual([])
  })

  it('the gate is conditional on canMint, exactly as the contract gates it', () => {
    // `TroveManager.sol:1397` wraps the requirement in `if (musdToken.mintList(...))`, the same
    // flag that gates the Recovery Mode and TCR checks in `BorrowerOperations._closeTrove`.
    const p = evaluateClose({
      ...closeBase,
      canMint: false,
      troveOwnersCount: 1n,
      sortedTrovesSize: 1n,
    })
    expect(p.reasons).not.toContain('LAST_TROVE_IN_SYSTEM')
    expect(p.viable).toBe(true)
  })

  it('an unsupplied count is "not asked", not "there is one" (the MK-047 rule)', () => {
    const p = evaluateClose(closeBase)
    expect(p.reasons).not.toContain('LAST_TROVE_IN_SYSTEM')
    expect(p.viable).toBe(true)
  })

  it('it is reported LAST, because the contract reaches it last', () => {
    // `BorrowerOperations.sol:976` calls `closeTrove` only after the balance check at `:963` and
    // the TCR check at `:964-973`, so a caller who is also short of MUSD hits that first.
    const p = evaluateClose({
      ...closeBase,
      musdBalance: 0n,
      troveOwnersCount: 1n,
      sortedTrovesSize: 1n,
    })
    expect(p.reasons).toEqual(['INSUFFICIENT_MUSD_BALANCE', 'LAST_TROVE_IN_SYSTEM'])
    expect(p.bindingConstraint).toBe('INSUFFICIENT_MUSD_BALANCE')
  })

  it('isTroveLiquidatable: the last Trove is never liquidatable, at any ICR', () => {
    // `_liquidate` returns without liquidating when `TroveOwners.length <= 1`
    // (`TroveManager.sol:1058-1060`), so `batchLiquidateTroves` reverts at `:690-693`.
    expect(isTroveLiquidatable({ icr: 0n, troveOwnersCount: 1n })).toBe(false)
    expect(isTroveLiquidatable({ icr: MCR - 1n, troveOwnersCount: 1n })).toBe(false)
    expect(isTroveLiquidatable({ icr: MCR - 1n, troveOwnersCount: 2n })).toBe(true)
  })

  it('isTroveLiquidatable: the ratio gate is ICR < MCR in both modes, and the boundary is exclusive', () => {
    // MK-001. `TroveManager.sol:1148` is `if (vars.ICR < MCR)`, with no mode branch at all.
    expect(isTroveLiquidatable({ icr: MCR, troveOwnersCount: 42n })).toBe(false)
    expect(isTroveLiquidatable({ icr: MCR - 1n, troveOwnersCount: 42n })).toBe(true)
    // And the liquidation path consults the COUNT only, never the sorted list size, unlike the
    // close path. Nothing here takes a size, which is the assertion.
    expect(isTroveLiquidatable({ icr: MCR - 1n })).toBe(true)
  })
})

/* -------------------------------------------------------------------------------------------
 * MK-075 · the refinance reason order
 * ---------------------------------------------------------------------------------------- */

describe('MK-075, previewRefinance reports its reasons in contract call order', () => {
  const base = {
    collateral: BTC,
    principal: 2_200n * MUSD,
    interestOwed: 0n,
    refinancingFeePercentage: 20,
    borrowingFeeOnBase: 4n * MUSD,
    feeExempt: false,
    price: PRICE,
    systemColl: 10_000n * BTC,
    systemDebt: 100_000n * MUSD,
    currentInterestRateBps: 100,
    globalInterestRateBps: 100,
    currentCapacity: 90_000n * MUSD,
  }

  it('RECOVERY_MODE binds before TROVE_NOT_ACTIVE, because `:1023` precedes `:1024`', () => {
    const p = evaluateRefinance({
      ...base,
      status: 0,
      isRecoveryMode: true,
      systemColl: 1_000n * BTC,
      systemDebt: 80_000_000n * MUSD,
    })
    expect(p.bindingConstraint).toBe('RECOVERY_MODE')
    expect(p.reasons.indexOf('RECOVERY_MODE')).toBeLessThan(p.reasons.indexOf('TROVE_NOT_ACTIVE'))
  })

  it('and a closed Trove in NORMAL mode still reports TROVE_NOT_ACTIVE', () => {
    const p = evaluateRefinance({ ...base, status: 2, isRecoveryMode: false })
    expect(p.bindingConstraint).toBe('TROVE_NOT_ACTIVE')
  })
})

/* -------------------------------------------------------------------------------------------
 * MK-076 · limitedBy names the gate that actually binds
 * ---------------------------------------------------------------------------------------- */

describe('MK-076, computeMaxWithdrawable.limitedBy', () => {
  it('says TCR when the system ratio is what allows nothing and the position allows plenty', () => {
    const systemDebt = 100_000n * MUSD
    const systemColl = (CCR * systemDebt) / PRICE // exactly CCR, so nothing can leave
    const m = computeMaxWithdrawable({
      collateral: 10n * BTC, // very over collateralised: the ICR gate would allow ~9.98 BTC out
      entireDebt: 2_200n * MUSD,
      isRecoveryMode: false,
      price: PRICE,
      systemColl,
      systemDebt,
    })
    expect(m.amount).toBe(0n)
    expect(m.limitedBy).toBe('TCR')
  })

  it('still says ICR when the position is what binds', () => {
    const m = computeMaxWithdrawable({
      collateral: BTC,
      entireDebt: 80_000n * MUSD, // ICR 125 percent, very little room
      isRecoveryMode: false,
      price: PRICE,
      systemColl: 100_000n * BTC,
      systemDebt: 1_000n * MUSD,
    })
    expect(m.limitedBy).toBe('ICR')
    expect(m.amount).toBeGreaterThan(0n)
  })

  it('and RECOVERY_MODE still wins outright, since no withdrawal is permitted at all', () => {
    const m = computeMaxWithdrawable({
      collateral: 10n * BTC,
      entireDebt: 2_200n * MUSD,
      isRecoveryMode: true,
      price: PRICE,
      systemColl: 1_000n * BTC,
      systemDebt: 80_000_000n * MUSD,
    })
    expect(m.amount).toBe(0n)
    expect(m.limitedBy).toBe('RECOVERY_MODE')
  })
})

/* -------------------------------------------------------------------------------------------
 * MK-077 · both debt legs
 * ---------------------------------------------------------------------------------------- */

describe('MK-077, the adjust evaluator refuses both debt legs instead of dropping one', () => {
  const base = {
    status: 1,
    collateral: BTC,
    entireDebt: 2_200n * MUSD,
    capacity: 90_000n * MUSD,
    musdBalance: 0n,
    minNetDebt: 1_800n * MUSD,
    fee: 1n * MUSD,
    addCollateral: 0n,
    withdrawCollateral: 0n,
    isRecoveryMode: false,
    price: PRICE,
    systemColl: 10_000n * BTC,
    systemDebt: 1_000_000n * MUSD,
  }

  it('reports DEBT_INCREASE_AND_REPAY rather than silently taking the increase', () => {
    const p = evaluateAdjust({
      ...base,
      increaseDebt: 1_000n * MUSD,
      repayDebt: 500n * MUSD,
      isDebtIncrease: true,
    })
    expect(p.reasons).toContain('DEBT_INCREASE_AND_REPAY')
    expect(p.viable).toBe(false)
  })

  it('and a single leg is untouched, so the gate is about the pair', () => {
    const draw = evaluateAdjust({
      ...base,
      increaseDebt: 1_000n * MUSD,
      repayDebt: 0n,
      isDebtIncrease: true,
    })
    expect(draw.reasons).not.toContain('DEBT_INCREASE_AND_REPAY')
    expect(draw.viable).toBe(true)
  })

  it('a zero increase beside a repayment is left to ZERO_DEBT_INCREASE, which already refuses it', () => {
    // Value based, matching `_requireSingularCollChange`'s shape on the collateral side. The
    // input is refused either way; this pins WHICH reason names it.
    const p = evaluateAdjust({
      ...base,
      increaseDebt: 0n,
      repayDebt: 500n * MUSD,
      isDebtIncrease: true,
      musdBalance: 1_000_000n * MUSD,
    })
    expect(p.reasons).toContain('ZERO_DEBT_INCREASE')
    expect(p.reasons).not.toContain('DEBT_INCREASE_AND_REPAY')
  })
})

/* -------------------------------------------------------------------------------------------
 * MK-068 · the open write path uses the fee the contract will actually charge
 * ---------------------------------------------------------------------------------------- */

/**
 * Driven through the real `openTrove` rather than a reimplementation, so the fee helper it
 * actually calls is the thing under test.
 *
 * `simulateContract` records instead of throwing here, because two of the three cases are about
 * a precheck that must NOT fire and one is about a precheck that must.
 */
describe('MK-068, openTrove charges what the contract charges', () => {
  const RATE = 10n ** 15n // 0.1 percent
  const MIN_NET_DEBT = 1_800n * MUSD

  function writeDeps(opts: { isRecoveryMode: boolean; feeExempt: boolean }) {
    const sent: bigint[] = []
    const publicClient = {
      readContract: async ({
        functionName,
        args,
      }: { functionName: string; args?: readonly unknown[] }) => {
        switch (functionName) {
          case 'getBorrowingFee':
            return (RATE * (args?.[0] as bigint)) / E18
          case 'fetchPrice':
            return PRICE
          case 'checkRecoveryMode':
            return opts.isRecoveryMode
          case 'governableVariables':
            return '0x0000000000000000000000000000000000000001'
          case 'isAccountFeeExempt':
            return opts.feeExempt
          case 'getEntireDebtAndColl':
            return [0n, 0n, 0n, 0n, 0n, 0n] // a fresh account
          case 'getSize':
            return 5n
          case 'getApproxHint':
            return [OWNER, 0n, 0n]
          case 'findInsertPosition':
            return [OWNER, OWNER]
          default:
            throw new Error(`unstubbed read: ${functionName}`)
        }
      },
      simulateContract: async ({ args }: { args: readonly unknown[] }) => {
        sent.push(args[0] as bigint)
        return { request: {} }
      },
      estimateContractGas: async () => 500_000n,
    } as unknown as PublicClient
    const deps: WriteDeps = {
      publicClient,
      walletClient: {
        account: { address: OWNER, type: 'json-rpc' },
        writeContract: async () => '0xhash',
      } as unknown as WalletClient,
      addresses: T,
      ensureVerified: async () => {},
      gasMarginPercent: 0,
      getMinNetDebt: async () => MIN_NET_DEBT,
      isAccountFeeExempt: async () => opts.feeExempt,
    }
    return { deps, sent }
  }

  // The band the contract refuses when it charges no fee: `draw < minNetDebt <= draw + fee`.
  const IN_THE_BAND = 1_799n * MUSD

  it('the debt floor is measured against the contract`s netDebt, in Recovery Mode', async () => {
    // No fee in Recovery Mode, so `netDebt` is 1799 and `_requireAtLeastMinNetDebt` (`:645`)
    // refuses. Before MK-068 the SDK formed `1799 + 1.799` and sent.
    const { deps, sent } = writeDeps({ isRecoveryMode: true, feeExempt: false })
    await expect(openTrove(deps, { collateral: BTC, debt: IN_THE_BAND })).rejects.toBeInstanceOf(
      BelowMinimumDebt,
    )
    expect(sent, 'nothing may reach simulate').toEqual([])
  })

  it('and for a fee exempt account in normal mode, which the mode check alone would miss', async () => {
    const { deps, sent } = writeDeps({ isRecoveryMode: false, feeExempt: true })
    await expect(openTrove(deps, { collateral: BTC, debt: IN_THE_BAND })).rejects.toBeInstanceOf(
      BelowMinimumDebt,
    )
    expect(sent).toEqual([])
  })

  it('the same draw is fine when the contract DOES charge the fee, so the band is real', async () => {
    const { deps, sent } = writeDeps({ isRecoveryMode: false, feeExempt: false })
    await openTrove(deps, { collateral: BTC, debt: IN_THE_BAND })
    expect(sent).toEqual([IN_THE_BAND])
  })

  it('a zero fee cap is honoured in Recovery Mode, where the protocol charges nothing', async () => {
    // Before MK-068 this threw `MaxFeeExceeded` naming a fee that would never be charged, which
    // refused an open the chain accepts.
    const { deps, sent } = writeDeps({ isRecoveryMode: true, feeExempt: false })
    await openTrove(deps, { collateral: BTC, debt: 5_000n * MUSD, maxFeePercentage: 0n })
    expect(sent).toEqual([5_000n * MUSD])
  })

  it('and the cap still bites in normal mode, so it was not simply disabled', async () => {
    const { deps } = writeDeps({ isRecoveryMode: false, feeExempt: false })
    await expect(
      openTrove(deps, { collateral: BTC, debt: 5_000n * MUSD, maxFeePercentage: 0n }),
    ).rejects.toBeInstanceOf(MaxFeeExceeded)
  })
})

/* -------------------------------------------------------------------------------------------
 * A guard on the type, so a new reason cannot be added without a mapped error
 * ---------------------------------------------------------------------------------------- */

describe('MK-077, the write path maps the new reason rather than falling through', () => {
  it('adjustTrove refuses both debt legs with InvalidAdjustment', async () => {
    const deps = {
      publicClient: {
        readContract: async () => {
          throw new Error('reached the chain: the argument check did not fire')
        },
        simulateContract: async () => {
          throw new Error('reached simulate')
        },
      } as unknown as PublicClient,
      walletClient: {
        account: { address: OWNER, type: 'json-rpc' },
        writeContract: async () => '0xhash',
      } as unknown as WalletClient,
      addresses: T,
      ensureVerified: async () => {},
      gasMarginPercent: 0,
      getMinNetDebt: async () => 1_800n * MUSD,
      isAccountFeeExempt: async () => false,
    } as WriteDeps
    const { adjustTrove } = await import('../src/trove')
    await expect(
      adjustTrove(deps, { borrow: 1_000n * MUSD, repay: 500n * MUSD }),
    ).rejects.toBeInstanceOf(InvalidAdjustment)
  })
})
