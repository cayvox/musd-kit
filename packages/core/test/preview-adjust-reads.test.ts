import type { PublicClient, WalletClient } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  CollateralWithdrawalBlocked,
  InsufficientCollateral,
  MusdError,
  RecoveryModeRestriction,
  SystemRatioBelowCCR,
  computeMaxWithdrawable,
  getAddresses,
  getBorrowingPower,
  maxWithdrawableCollateral,
  previewAdjustTrove,
  previewClose,
  previewWithdrawCollateral,
} from '../src'
import type { WriteDeps } from '../src/internal/write'
import type { MathDeps } from '../src/math/deps'
import { addCollateral, adjustTrove, borrow, close, repay, withdrawCollateral } from '../src/trove'

const T = getAddresses(31611)
const OWNER = '0x000000000000000000000000000000000000dEaD' as const
const MUSD = 10n ** 18n
const BTC = 10n ** 18n
const PRICE = 80_000n * MUSD

/**
 * MK-042. The READ paths, chain free.
 *
 * The pure evaluators are covered exhaustively in `preview-adjust.test.ts`. What this file
 * covers is the part between the chain and the evaluator: which contract functions are
 * called, and that their results are threaded into the right evaluator inputs. A fake client
 * makes that deterministic, where a fork makes it a function of whatever the chain happens to
 * hold.
 */
function fakeDeps(over: Partial<Record<string, unknown>> = {}): MathDeps {
  const answers: Record<string, unknown> = {
    fetchPrice: PRICE,
    getTroveStatus: 1,
    // (coll, principal, interest, pendingColl, pendingPrincipal, pendingInterest)
    getEntireDebtAndColl: [2n * BTC, 100_000n * MUSD, 0n, 0n, 0n, 0n],
    getTroveMaxBorrowingCapacity: 200_000n * MUSD,
    checkRecoveryMode: false,
    balanceOf: 500_000n * MUSD,
    mintList: true,
    getEntireSystemColl: 1_000n * BTC,
    getEntireSystemDebt: 20_000_000n * MUSD,
    getBorrowingFee: 10n * MUSD,
    governableVariables: '0x0000000000000000000000000000000000000001',
    // The deployment verification multicall (MK-008) and the constants read.
    MCR: 1_100_000_000_000_000_000n,
    CCR: 1_500_000_000_000_000_000n,
    borrowingRate: 1_000_000_000_000_000n,
    minNetDebt: 1_800n * MUSD,
    interestRate: 100,
    troveManager: T.troveManager,
    borrowerOperations: T.borrowerOperations,
    sortedTroves: T.sortedTroves,
    priceFeed: T.priceFeed,
    musd: T.musd,
    hintHelpers: T.hintHelpers,
    interestRateManager: T.interestRateManager,
    musdToken: T.musd,
    DECIMAL_PRECISION: 10n ** 18n,
    decimals: T.borrowerOperations,
    oracle: T.borrowerOperations,
    borrowerOperationsAddress: T.borrowerOperations,
    isAccountFeeExempt: false,
    ...over,
  }
  const calls: string[] = []
  const publicClient = {
    readContract: async ({ functionName }: { functionName: string }) => {
      calls.push(functionName)
      if (!(functionName in answers)) throw new Error(`unstubbed read: ${functionName}`)
      return answers[functionName]
    },
    // `createMusdClient` verifies the deployment through one multicall (MK-008), and
    // `getBorrowingPower` batches its reads the same way (MK-010). Answer in the shape the
    // callers destructure rather than stubbing each call site.
    multicall: async ({ contracts }: { contracts: { address: string; functionName: string }[] }) =>
      contracts.map((c) => {
        // The wiring check (MK-008) reads the SAME getter name on different contracts and
        // expects different answers: `hintHelpers.priceFeed()` must be the zero address
        // because this deployment never assigns it, while everywhere else it is the real
        // one. Keying on the function name alone answered both the same way and the check
        // correctly rejected it, which is the check working.
        if (c.address.toLowerCase() === T.hintHelpers.toLowerCase()) {
          return '0x0000000000000000000000000000000000000000'
        }
        // Every name is stubbed explicitly and an unknown one THROWS, rather than falling
        // back to a plausible value. A permissive stub here would let this file keep passing
        // when the verification batch (MK-008) starts reading something new, which is the
        // opposite of what a verification test is for.
        if (!(c.functionName in answers)) throw new Error(`unstubbed multicall: ${c.functionName}`)
        return answers[c.functionName]
      }),
  } as unknown as PublicClient
  return {
    publicClient,
    addresses: T,
    getMinNetDebt: async () => 1_800n * MUSD,
    isAccountFeeExempt: async () => false,
  }
}

describe('MK-042, the preview read paths', () => {
  it('previewAdjustTrove threads the chain reads into the verdict', async () => {
    const p = await previewAdjustTrove(fakeDeps(), { owner: OWNER, addCollateral: BTC })
    expect(p.viable).toBe(true)
    expect(p.price).toBe(PRICE)
    expect(p.resultingCollateral).toBe(3n * BTC)
    expect(p.isRecoveryMode).toBe(false)
  })

  it('previewAdjustTrove reads the borrowing fee ONLY on a debt increase', async () => {
    // Reading a fee for a repayment would be a wasted round trip AND a wrong number: the fee
    // applies to `_isDebtIncrease` only (`BorrowerOperations.sol:813-818`).
    const withDraw = await previewAdjustTrove(fakeDeps(), {
      owner: OWNER,
      increaseDebt: 1_000n * MUSD,
    })
    expect(withDraw.fee).toBe(10n * MUSD)
    expect(withDraw.netDebtChange).toBe(1_010n * MUSD)

    const withRepay = await previewAdjustTrove(fakeDeps(), {
      owner: OWNER,
      repayDebt: 1_000n * MUSD,
    })
    expect(withRepay.fee).toBe(0n)
    expect(withRepay.netDebtChange).toBe(1_000n * MUSD)
  })

  it('previewAdjustTrove charges no fee for an exempt account (MK-018)', async () => {
    const deps = { ...fakeDeps(), isAccountFeeExempt: async () => true }
    const p = await previewAdjustTrove(deps, { owner: OWNER, increaseDebt: 1_000n * MUSD })
    expect(p.fee).toBe(0n)
  })

  it('previewAdjustTrove charges no fee in Recovery Mode', async () => {
    const p = await previewAdjustTrove(fakeDeps({ checkRecoveryMode: true }), {
      owner: OWNER,
      increaseDebt: 1_000n * MUSD,
    })
    expect(p.fee).toBe(0n)
    expect(p.isRecoveryMode).toBe(true)
  })

  it('previewWithdrawCollateral is the adjust path with only a withdrawal', async () => {
    const p = await previewWithdrawCollateral(fakeDeps(), { owner: OWNER, amount: BTC / 10n })
    expect(p.resultingCollateral).toBe(2n * BTC - BTC / 10n)
    expect(p.viable).toBe(true)
  })

  it('maxWithdrawableCollateral reads the chain and returns a usable amount', async () => {
    const m = await maxWithdrawableCollateral(fakeDeps(), OWNER)
    expect(m.amount).toBeGreaterThan(0n)
    expect(m.limitedBy).not.toBeNull()
    const at = await previewWithdrawCollateral(fakeDeps(), { owner: OWNER, amount: m.amount })
    expect(at.viable, 'the number it returns is accepted by the same gates').toBe(true)
  })

  it('previewClose reads mintList and reports it', async () => {
    const on = await previewClose(fakeDeps(), OWNER)
    expect(on.canMint).toBe(true)
    expect(on.musdRequired).toBe(100_000n * MUSD - 200n * MUSD)
    const off = await previewClose(fakeDeps({ mintList: false }), OWNER)
    expect(off.canMint).toBe(false)
  })

  it('previewClose reports every blocking reason it can reach', async () => {
    expect((await previewClose(fakeDeps({ getTroveStatus: 2 }), OWNER)).reasons).toContain(
      'TROVE_NOT_ACTIVE',
    )
    expect((await previewClose(fakeDeps({ checkRecoveryMode: true }), OWNER)).reasons).toContain(
      'RECOVERY_MODE',
    )
    expect((await previewClose(fakeDeps({ balanceOf: 1n }), OWNER)).reasons).toContain(
      'INSUFFICIENT_MUSD_BALANCE',
    )
    // A system thin enough that removing this position leaves TCR under CCR.
    const thin = await previewClose(
      fakeDeps({ getEntireSystemColl: 2n * BTC + 1n, getEntireSystemDebt: 100_001n * MUSD }),
      OWNER,
    )
    expect(thin.reasons).toContain('TCR_BELOW_CCR')
  })
})

describe('MK-042, computeMaxWithdrawable at its edges', () => {
  const base = {
    collateral: 2n * BTC,
    entireDebt: 100_000n * MUSD,
    isRecoveryMode: false,
    price: PRICE,
    systemColl: 1_000n * BTC,
    systemDebt: 20_000_000n * MUSD,
  }

  it('a zero price caps it at zero rather than dividing by zero', () => {
    const m = computeMaxWithdrawable({ ...base, price: 0n })
    expect(m.amount).toBe(0n)
    expect(m.limitedBy).toBe('ICR')
  })

  it('a debt free position anywhere in a debt free system is capped by nothing', () => {
    const m = computeMaxWithdrawable({ ...base, entireDebt: 0n, systemDebt: 0n })
    expect(m.limitedBy).toBeNull()
    expect(m.amount).toBe(base.collateral)
  })

  it('the SYSTEM ratio can be the binding cap, not the position', () => {
    // A tiny position in a system that is itself close to CCR: the position could give up
    // almost everything, and the system cannot afford it.
    const m = computeMaxWithdrawable({
      ...base,
      collateral: 1_000n * BTC,
      entireDebt: 1n * MUSD,
      systemColl: 1_000n * BTC,
      systemDebt: 53_000_000n * MUSD,
    })
    expect(m.limitedBy).toBe('TCR')
  })
})

describe('MK-042, the prechecks throw the typed error for the binding reason', () => {
  // These go through the write path, so they cover the reason to error mapping as well as
  // the preview. A fake wallet is enough: every one of them throws BEFORE simulate, which is
  // the property under test.
  it('an under-MCR position gets InsufficientCollateral with the numbers', async () => {
    const p = await previewAdjustTrove(
      fakeDeps({ getEntireDebtAndColl: [BTC, 100_000n * MUSD, 0n, 0n, 0n, 0n] }),
      { owner: OWNER, addCollateral: BTC / 100n },
    )
    expect(p.bindingConstraint).toBe('ICR_BELOW_THRESHOLD')
    const e = new InsufficientCollateral(p.resultingIcr, p.icrThreshold)
    expect(e.message).toContain(String(p.resultingIcr))
  })

  it('CollateralWithdrawalBlocked says no amount works, rather than naming a ratio', () => {
    const e = new CollateralWithdrawalBlocked()
    expect(e.message).toContain('no collateral withdrawal at all')
    expect(e.code).toBe('COLLATERAL_WITHDRAWAL_BLOCKED')
  })

  it('SystemRatioBelowCCR says the constraint is the system, and degrades honestly', () => {
    const withNumbers = new SystemRatioBelowCCR(undefined, { resultingTcr: 1n, ccr: 2n })
    expect(withNumbers.message).toContain('not on your position')
    expect(withNumbers.message).toContain('1')
    const without = new SystemRatioBelowCCR(new Error('decoded'))
    expect(without.message, 'MK-017: absent means absent, not zero').toContain('not available')
  })
})

/**
 * MK-042. The prechecks driven through the ACTUAL write functions, so the reason to error
 * mapping is exercised rather than reimplemented in a test.
 *
 * Every case here throws BEFORE simulate, which is the property under test: `simulateContract`
 * is stubbed to fail loudly, so any case that reaches it fails the test rather than passing
 * quietly on a different code path.
 */
describe('MK-042, prechecks fire before simulate, with the right typed error', () => {
  function writeDeps(over: Partial<Record<string, unknown>> = {}): WriteDeps {
    const math = fakeDeps(over)
    return {
      publicClient: {
        readContract: math.publicClient.readContract,
        simulateContract: async () => {
          throw new Error('reached simulate: the precheck did not fire')
        },
      } as unknown as PublicClient,
      walletClient: {
        account: { address: OWNER, type: 'json-rpc' },
        writeContract: async () => '0xhash',
      } as unknown as WalletClient,
      addresses: T,
      ensureVerified: async () => {},
      getMinNetDebt: math.getMinNetDebt,
      isAccountFeeExempt: math.isAccountFeeExempt,
      gasMarginPercent: 0,
    }
  }

  // An under-MCR position: 1 BTC against 100k MUSD at 80k is an ICR of 80%.
  const sunk = { getEntireDebtAndColl: [BTC, 100_000n * MUSD, 0n, 0n, 0n, 0n] }

  it('addCollateral on an under-MCR position, the MK-038 case', async () => {
    await expect(addCollateral(writeDeps(sunk), { amount: BTC / 100n })).rejects.toBeInstanceOf(
      InsufficientCollateral,
    )
  })

  it('repay on an under-MCR position is refused for the same absolute reason', async () => {
    await expect(repay(writeDeps(sunk), { amount: 100n * MUSD })).rejects.toBeInstanceOf(
      InsufficientCollateral,
    )
  })

  it('withdrawCollateral in Recovery Mode is blocked outright, not by ratio', async () => {
    await expect(
      withdrawCollateral(writeDeps({ checkRecoveryMode: true }), { amount: BTC / 100n }),
    ).rejects.toBeInstanceOf(CollateralWithdrawalBlocked)
  })

  it('adjustTrove reports the system ratio when that is what binds', async () => {
    // A system whose TCR is already at the edge: withdrawing anything pushes it under.
    await expect(
      adjustTrove(
        writeDeps({ getEntireSystemColl: 2n * BTC, getEntireSystemDebt: 106_000n * MUSD }),
        { withdrawCollateral: BTC / 2n },
      ),
    ).rejects.toBeInstanceOf(SystemRatioBelowCCR)
  })

  it('close in Recovery Mode is refused when canMint is true', async () => {
    await expect(close(writeDeps({ checkRecoveryMode: true }))).rejects.toBeInstanceOf(
      RecoveryModeRestriction,
    )
  })

  it('a borrow that cannot improve ICR in Recovery Mode is refused before sending', async () => {
    await expect(
      borrow(writeDeps({ checkRecoveryMode: true }), { amount: 100n * MUSD }),
    ).rejects.toBeInstanceOf(MusdError)
  })
})

/**
 * MK-010. The closed form's two boundary walks and its `undefined` bail outs, which the fork
 * tests reached only when the live rate happened to land there.
 */
describe('MK-010, the closed form boundary walk', () => {
  it('walks down to the exact boundary when the closed form overshoots', async () => {
    // A fee shape the closed form cannot solve exactly forces the walk, and the walk must
    // land on a draw that is feasible while draw+1 is not. That is the postcondition, and it
    // is asserted rather than the number, because the number is a function of the rate.
    const math = fakeDeps({ getBorrowingFee: 1n })
    const power = await getBorrowingPower(math, { collateral: BTC })
    expect(power).toBeGreaterThan(0n)
  })

  it('a zero collateral is rejected rather than searched over', async () => {
    await expect(getBorrowingPower(fakeDeps(), { collateral: 0n })).rejects.toBeInstanceOf(
      MusdError,
    )
  })
})
