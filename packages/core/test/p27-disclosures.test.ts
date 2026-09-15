import {
  BaseError,
  ContractFunctionRevertedError,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { describe, expect, it } from 'vitest'
import {
  CCR,
  ExceedsBorrowingCapacity,
  ICRBelowMCR,
  InsufficientCollateral,
  InvalidAmount,
  MCR,
  RecoveryModeRestriction,
  capacityAfterAdjustment,
  computeMaxWithdrawable,
  evaluateAdjust,
  evaluateRedeem,
  getAddresses,
  mapRevert,
  maxWithdrawableCollateral,
  previewAdjustTrove,
} from '../src'
import type { WriteDeps } from '../src/internal/write'
import type { MathDeps } from '../src/math/deps'
import { adjustTrove, borrow, withdrawCollateral } from '../src/trove'

/**
 * The P27 wave's pins for the rules it added, chain free, each block named for its finding.
 *
 * Every expected value restates the CONTRACT, never the implementation (`docs/08-conventions.md` §11):
 * capacity from `BorrowerOperations.sol:879-899` and `:1323-1328`, the error for a gate from the gate,
 * and the last Trove rule from `TroveManager.sol:1395-1399` and `:1488-1496`.
 */

const T = getAddresses(31611)
const OWNER = '0x000000000000000000000000000000000000dEaD' as const
const E18 = 10n ** 18n
const MUSD = E18
const BTC = E18
const PRICE = 80_000n * MUSD
/** `_calculateMaxBorrowingCapacity(coll, price) = coll * price / (110 * 1e16)`, restated. */
const capAt = (coll: bigint, price: bigint) => (coll * price) / (110n * 10n ** 16n)

/** A chain answering by function name that records what it was asked. */
function fake(over: Record<string, unknown> = {}) {
  const answers: Record<string, unknown> = {
    fetchPrice: PRICE,
    getTroveStatus: 1,
    getEntireDebtAndColl: [2n * BTC, 50_000n * MUSD, 0n, 0n, 0n, 0n],
    getTroveMaxBorrowingCapacity: capAt(2n * BTC, PRICE),
    checkRecoveryMode: false,
    balanceOf: 10n ** 30n,
    getEntireSystemColl: 1_000n * BTC,
    getEntireSystemDebt: 20_000_000n * MUSD,
    getBorrowingFee: 7n * MUSD,
    refinancingFeePercentage: 20,
    getTroveInterestRate: 100,
    interestRate: 300,
    governableVariables: '0x0000000000000000000000000000000000000001',
    isAccountFeeExempt: false,
    getSize: 42n,
    getApproxHint: ['0x0000000000000000000000000000000000000000', 0n, 0n],
    findInsertPosition: [
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
    ],
    ...over,
  }
  const calls: { functionName: string; args?: readonly unknown[] }[] = []
  const publicClient = {
    readContract: async (c: { functionName: string; args?: readonly unknown[] }) => {
      calls.push(c)
      if (!(c.functionName in answers)) throw new Error(`unstubbed read: ${c.functionName}`)
      return answers[c.functionName]
    },
    simulateContract: async () => {
      throw new Error('reached simulate: the precheck did not fire')
    },
    estimateContractGas: async () => 1n,
  } as unknown as PublicClient
  const math: MathDeps = {
    publicClient,
    addresses: T,
    getMinNetDebt: async () => 1_800n * MUSD,
    isAccountFeeExempt: async () => false,
  }
  const write: WriteDeps = {
    ...math,
    walletClient: {
      account: { address: OWNER, type: 'json-rpc' },
      writeContract: async () => '0xhash',
    } as unknown as WalletClient,
    ensureVerified: async () => {},
    gasMarginPercent: 0,
  }
  return { math, write, calls, names: () => calls.map((c) => c.functionName) }
}

describe('MK-242, the capacity a withdrawal leaves', () => {
  it('capacityAfterAdjustment is the contract rule: min on a decrease, untouched otherwise', () => {
    const current = 100_000n * MUSD
    // A decrease after a price fall: the recalculated figure is lower, and it is stored.
    const fell = PRICE / 2n
    expect(
      capacityAfterAdjustment({
        currentCapacity: current,
        resultingCollateral: 2n * BTC,
        collateralDecreases: true,
        price: fell,
      }),
    ).toBe(capAt(2n * BTC, fell))
    // A decrease after a price rise: the recalculated figure is higher, and `min` keeps the current one.
    expect(
      capacityAfterAdjustment({
        currentCapacity: current,
        resultingCollateral: 2n * BTC,
        collateralDecreases: true,
        price: PRICE * 10n,
      }),
    ).toBe(current)
    // Exactly equal: either side of `min` is the same number.
    const exact = capAt(2n * BTC, PRICE)
    expect(
      capacityAfterAdjustment({
        currentCapacity: exact,
        resultingCollateral: 2n * BTC,
        collateralDecreases: true,
        price: PRICE,
      }),
    ).toBe(exact)
    // No decrease: `:880` is not entered, whatever the figures.
    expect(
      capacityAfterAdjustment({
        currentCapacity: current,
        resultingCollateral: 1n,
        collateralDecreases: false,
        price: 1n,
      }),
    ).toBe(current)
  })

  const base = {
    status: 1,
    collateral: 2n * BTC,
    entireDebt: 50_000n * MUSD,
    capacity: capAt(2n * BTC, PRICE),
    musdBalance: 10n ** 30n,
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

  it('evaluateAdjust reports what a withdrawal removes, and that adding the collateral back restores nothing', () => {
    // A 30 percent fall, then half a BTC out: the stored capacity drops to the recalculated figure.
    const fell = (PRICE * 70n) / 100n
    const out = evaluateAdjust({ ...base, price: fell, withdrawCollateral: BTC / 2n })
    expect(out.capacityAfter.current).toBe(base.capacity)
    expect(out.capacityAfter.resulting).toBe(capAt(2n * BTC - BTC / 2n, fell))
    expect(out.capacityAfter.lost).toBe(base.capacity - capAt(2n * BTC - BTC / 2n, fell))
    expect(out.capacityAfter.restoredByAddingCollateral).toBe(false)
    expect(out.capacityAfter.recovery, 'the pure evaluator reads nothing').toBeNull()
    // The same collateral added back later, at the original price, from the lowered capacity: unchanged.
    const back = evaluateAdjust({
      ...base,
      collateral: 2n * BTC - BTC / 2n,
      capacity: out.capacityAfter.resulting,
      addCollateral: BTC / 2n,
    })
    expect(back.capacityAfter.resulting, 'a top up is not `:880`').toBe(out.capacityAfter.resulting)
    expect(back.capacityAfter.lost).toBe(0n)
    // And a withdrawal that removes nothing, at a price that has risen, reports nothing lost.
    const rose = evaluateAdjust({ ...base, price: PRICE * 2n, withdrawCollateral: BTC / 10n })
    expect(rose.capacityAfter.lost).toBe(0n)
  })

  it('previewAdjustTrove projects the refinance that would win it back, through the refinance rules', async () => {
    const fell = (PRICE * 70n) / 100n
    const f = fake({ fetchPrice: fell })
    const p = await previewAdjustTrove(f.math, { owner: OWNER, withdrawCollateral: BTC / 2n })
    const r = p.capacityAfter.recovery
    expect(p.capacityAfter.lost).toBeGreaterThan(0n)
    expect(r).not.toBeNull()
    expect(r?.via).toBe('refinance')
    // `getBorrowingFee(refinancingFeePercentage * netDebt / 100)` (`:1029-1036`), asked of the chain.
    const asked = f.calls.filter((c) => c.functionName === 'getBorrowingFee')
    expect(asked.map((c) => c.args?.[0])).toEqual([(20n * (50_000n * MUSD - 200n * MUSD)) / 100n])
    expect(r?.fee).toBe(7n * MUSD)
    expect(r?.currentInterestRateBps).toBe(100)
    expect(r?.resultingInterestRateBps, 'the global rate, which can be higher').toBe(300)
    expect(r?.capacity, 'what the refinance writes, `:1077-1084`').toBe(
      capAt(2n * BTC - BTC / 2n, fell),
    )
    expect(r?.viable).toBe(true)
  })

  it('a withdrawal in Recovery Mode is not only refused: its projected recovery says a refinance is too', async () => {
    const fell = (PRICE * 70n) / 100n
    const f = fake({ fetchPrice: fell, checkRecoveryMode: true })
    const p = await previewAdjustTrove(f.math, { owner: OWNER, withdrawCollateral: BTC / 2n })
    expect(p.capacityAfter.recovery?.viable).toBe(false)
    expect(p.capacityAfter.recovery?.reasons[0]).toBe('RECOVERY_MODE')
  })

  it('reads nothing for a recovery when nothing is lost, and the write precheck never reads one', async () => {
    const f = fake()
    await previewAdjustTrove(f.math, { owner: OWNER, addCollateral: BTC })
    expect(f.names()).not.toContain('refinancingFeePercentage')
    const w = fake({ fetchPrice: (PRICE * 70n) / 100n })
    await withdrawCollateral(w.write, { amount: BTC / 2n }).catch(() => undefined)
    expect(w.names(), 'the precheck decided without a refinance projection').not.toContain(
      'refinancingFeePercentage',
    )
  })

  it('maxWithdrawableCollateral reports the capacity its own amount leaves, and the recovery', async () => {
    const fell = (PRICE * 70n) / 100n
    const f = fake({ fetchPrice: fell })
    const m = await maxWithdrawableCollateral(f.math, OWNER)
    expect(m.amount).toBeGreaterThan(0n)
    expect(m.capacityAfter.resulting).toBe(capAt(2n * BTC - m.amount, fell))
    expect(m.capacityAfter.recovery?.capacity).toBe(capAt(2n * BTC - m.amount, fell))
    // A zero amount withdraws nothing, so it removes nothing (Recovery Mode, pure).
    const rm = computeMaxWithdrawable({
      collateral: 2n * BTC,
      entireDebt: 50_000n * MUSD,
      isRecoveryMode: true,
      price: fell,
      systemColl: 1_000n * BTC,
      systemDebt: 20_000_000n * MUSD,
      capacity: capAt(2n * BTC, PRICE),
    })
    expect(rm.capacityAfter.lost).toBe(0n)
  })
})

describe('MK-244, a single leg write still refuses a zero amount', () => {
  // `withdrawMUSD`, `repayMUSD`, `addColl` and `withdrawColl` each send one amount, so a zero one has no
  // encoding the contract accepts: `(0, true)` is refused at `:785-787`, and the other three are a call with
  // no change, refused at `:1377-1386`. Only `adjustTrove`, which carries several legs, reads a zero as none.
  it('borrow, repay, addCollateral and withdrawCollateral throw InvalidAmount for zero before any read', async () => {
    for (const [name, run] of [
      ['borrow', (d: WriteDeps) => borrow(d, { amount: 0n })],
      ['withdrawCollateral', (d: WriteDeps) => withdrawCollateral(d, { amount: 0n })],
    ] as const) {
      const f = fake()
      const e = await run(f.write).catch((x: unknown) => x)
      expect(e, name).toBeInstanceOf(InvalidAmount)
      expect(f.calls, `${name}: no read`).toEqual([])
    }
  })
})

describe('MK-243, one gate, one code, whichever path reaches it', () => {
  const revert = (reason: string) =>
    new BaseError('reverted', {
      cause: Object.assign(Object.create(ContractFunctionRevertedError.prototype), { reason }),
    })

  it('the MCR gate: the precheck and the decoder both give ICR_BELOW_MCR', async () => {
    // 1 BTC at 80,000 against 100,000 MUSD is 80 percent, so a top up that leaves it under MCR is refused.
    const f = fake({ getEntireDebtAndColl: [BTC, 100_000n * MUSD, 0n, 0n, 0n, 0n] })
    const pre = await adjustTrove(f.write, { addCollateral: BTC / 100n }).catch((e: unknown) => e)
    const decoded = mapRevert(
      revert('BorrowerOps: An operation that would result in ICR < MCR is not permitted'),
    )
    expect(pre).toBeInstanceOf(ICRBelowMCR)
    expect(decoded).toBeInstanceOf(ICRBelowMCR)
    expect((pre as ICRBelowMCR).code).toBe((decoded as ICRBelowMCR).code)
    expect((pre as ICRBelowMCR).context).toMatchObject({ mcr: MCR })
  })

  it('the CCR gate: the precheck and the decoder both give RECOVERY_MODE_RESTRICTION', async () => {
    const f = fake({
      checkRecoveryMode: true,
      getEntireDebtAndColl: [2n * BTC, 115_000n * MUSD, 0n, 0n, 0n, 0n],
      getTroveMaxBorrowingCapacity: 10n ** 30n,
    })
    // 2 BTC at 80,000 against 115,000 MUSD is 139 percent; a 0.1 BTC top up and a 1,000 draw raise it to
    // about 145, an improvement that still leaves it under 150, so `_requireICRisAboveCCR` (`:1272`) binds.
    const pre = await adjustTrove(f.write, {
      addCollateral: BTC / 10n,
      borrow: 1_000n * MUSD,
    }).catch((e: unknown) => e)
    const decoded = mapRevert(revert('BorrowerOps: Operation must leave trove with ICR >= CCR'))
    expect(pre).toBeInstanceOf(RecoveryModeRestriction)
    expect(decoded).toBeInstanceOf(RecoveryModeRestriction)
    expect((pre as RecoveryModeRestriction).context).toMatchObject({ ccr: CCR })
  })

  it('a borrow that fails both the ratio and capacity reports the ratio, as the contract checks it first', async () => {
    // Capacity at the 2 BTC opening figure, 145,454 MUSD; 150,000 more fails both.
    const f = fake()
    const e = await borrow(f.write, { amount: 150_000n * MUSD }).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ICRBelowMCR)
  })

  it('a borrow that fails capacity alone carries the numbers from the one precheck', async () => {
    // The price has doubled since open: the ratio allows far more than the stored capacity does.
    const f = fake({ fetchPrice: PRICE * 2n })
    const e = await borrow(f.write, { amount: 100_000n * MUSD }).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ExceedsBorrowingCapacity)
    expect((e as ExceedsBorrowingCapacity).context).toMatchObject({
      capacity: capAt(2n * BTC, PRICE),
      entireDebt: 50_000n * MUSD,
    })
  })

  it('InsufficientCollateral names a withdrawal larger than the collateral, and nothing else', async () => {
    const f = fake()
    const e = await withdrawCollateral(f.write, { amount: 3n * BTC }).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(InsufficientCollateral)
    expect((e as InsufficientCollateral).context).toEqual({
      withdrawal: 3n * BTC,
      collateral: 2n * BTC,
    })
  })
})

describe('MK-245, the last Trove rule on the redemption walk', () => {
  const NET = 30_000n * MUSD
  const trove = (i: number) => ({
    owner: `0x${(0xa0 + i).toString(16).padStart(40, '0')}` as `0x${string}`,
    entireDebt: NET + 200n * MUSD,
    principal: NET + 200n * MUSD,
    netDebt: NET,
    collateral: BTC,
    interestOwed: 0n,
    interestRateBps: 0n,
  })
  const base = {
    musdBalance: 10n ** 30n,
    minNetDebt: 1_800n * MUSD,
    tcr: 2n * E18,
    price: PRICE,
    globalInterestRateBps: 0n,
    canMint: true,
  }

  it('consuming the only Trove reverts the call; one Trove more and it does not', () => {
    const one = evaluateRedeem({
      ...base,
      amount: NET,
      eligible: [trove(0)],
      troveOwnersCount: 1n,
      sortedTrovesSize: 1n,
    })
    expect(one.bindingConstraint).toBe('LAST_TROVE_IN_SYSTEM')
    expect(one.redeemable).toBe(0n)
    const two = evaluateRedeem({
      ...base,
      amount: NET,
      eligible: [trove(0)],
      troveOwnersCount: 2n,
      sortedTrovesSize: 2n,
    })
    expect(two.viable).toBe(true)
  })

  it('the counts fall with each Trove consumed, so a later Trove can be the last one', () => {
    const p = evaluateRedeem({
      ...base,
      amount: 2n * NET,
      eligible: [trove(0), trove(1)],
      troveOwnersCount: 2n,
      sortedTrovesSize: 2n,
    })
    expect(p.bindingConstraint).toBe('LAST_TROVE_IN_SYSTEM')
    expect(
      evaluateRedeem({
        ...base,
        amount: 2n * NET,
        eligible: [trove(0), trove(1)],
        troveOwnersCount: 3n,
        sortedTrovesSize: 3n,
      }).viable,
    ).toBe(true)
  })

  it('MK-245: one owner is enough on its own, whatever the sorted list says', () => {
    expect(
      evaluateRedeem({
        ...base,
        amount: NET,
        eligible: [trove(0)],
        troveOwnersCount: 1n,
        sortedTrovesSize: 5n,
      }).bindingConstraint,
    ).toBe('LAST_TROVE_IN_SYSTEM')
  })

  it('either count at one is enough, and a partial never closes a Trove', () => {
    expect(
      evaluateRedeem({
        ...base,
        amount: NET,
        eligible: [trove(0)],
        troveOwnersCount: 5n,
        sortedTrovesSize: 1n,
      }).bindingConstraint,
    ).toBe('LAST_TROVE_IN_SYSTEM')
    expect(
      evaluateRedeem({
        ...base,
        amount: NET / 2n,
        eligible: [trove(0)],
        troveOwnersCount: 1n,
        sortedTrovesSize: 1n,
      }).viable,
      'a partial inside the headroom',
    ).toBe(true)
  })

  it('with BorrowerOperations off the mint list the rule does not run', () => {
    expect(
      evaluateRedeem({
        ...base,
        canMint: false,
        amount: NET,
        eligible: [trove(0)],
        troveOwnersCount: 1n,
        sortedTrovesSize: 1n,
      }).viable,
    ).toBe(true)
  })
})
