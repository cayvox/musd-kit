import {
  BaseError,
  ContractFunctionRevertedError,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { describe, expect, it } from 'vitest'
import {
  BelowMinimumDebt,
  ExceedsBorrowingCapacity,
  InsufficientCollateral,
  InsufficientMusdBalance,
  MissingWalletClient,
  RepayExceedsDebt,
  TroveNotFound,
  getAddresses,
} from '../src'
import type { WriteDeps } from '../src/internal/write'
import {
  addCollateral,
  adjustTrove,
  borrow,
  close,
  openTrove,
  refinance,
  repay,
} from '../src/trove'

/**
 * The write layer's own prechecks and the arguments it sends, at their boundaries.
 *
 * Every threshold is the contract's and inclusive, as in `decision-boundaries.test.ts`:
 * `_requireAtLeastMinNetDebt` (`BorrowerOperations.sol:1239-1244`), the capacity gate
 * `maxBorrowingCapacity >= netDebtChange + debt` (`:1361-1364`), `_requireValidMUSDRepayment`
 * `repayment <= debt - gas compensation` (`:1246-1253`), `_requireSufficientMUSDBalance` (`:1229-1237`)
 * and the close's `balanceOf >= debt - gas compensation` (`:963`). Each block cites its finding.
 */

const E18 = 10n ** 18n
const MUSD = E18
const BTC = E18
const PRICE = 80_000n * MUSD
const RATE = 10n ** 15n
const OWNER = '0x000000000000000000000000000000000000dEaD' as const
const GOVERNABLE = '0x0000000000000000000000000000000000000001'

interface State {
  collateral: bigint
  principal: bigint
  interestOwed: bigint
  balance: bigint
  capacity: bigint
  feeExempt: boolean
  minNetDebt: bigint
}

const ACTIVE: State = {
  collateral: 10n * BTC,
  principal: 20_000n * MUSD,
  interestOwed: 0n,
  balance: 10n ** 30n,
  capacity: 10n ** 30n,
  feeExempt: false,
  minNetDebt: 1_800n * MUSD,
}

function revert(reason: string): BaseError {
  const inner = new ContractFunctionRevertedError({
    abi: [],
    functionName: 'x',
    message: 'reverted',
  })
  Object.assign(inner, { reason })
  const outer = new BaseError('The contract function reverted.')
  Object.assign(outer, {
    cause: inner,
    walk: (fn: (e: unknown) => boolean) => (fn(inner) ? inner : fn(outer) ? outer : null),
  })
  return outer
}

function chain(
  state: State,
  opts: { simulateRevert?: string; wallet?: 'none' | 'no-account' } = {},
) {
  const reads: { functionName: string; args?: readonly unknown[] }[] = []
  const simulated: { functionName: string; args: readonly unknown[]; value?: bigint }[] = []
  const exists = state.principal > 0n
  const publicClient = {
    readContract: async (c: { functionName: string; args?: readonly unknown[] }) => {
      reads.push(c)
      switch (c.functionName) {
        case 'fetchPrice':
          return PRICE
        case 'checkRecoveryMode':
          return false
        case 'governableVariables':
          return GOVERNABLE
        case 'isAccountFeeExempt':
          return state.feeExempt
        case 'getBorrowingFee':
          return (RATE * (c.args?.[0] as bigint)) / E18
        case 'getEntireDebtAndColl':
          return exists
            ? [state.collateral, state.principal, state.interestOwed, 0n, 0n, 0n]
            : [0n, 0n, 0n, 0n, 0n, 0n]
        case 'getTroveStatus':
          return exists ? 1 : 0
        case 'getTroveMaxBorrowingCapacity':
          return state.capacity
        case 'balanceOf':
          return state.balance
        case 'getEntireSystemColl':
          return 1_000_000n * BTC
        case 'getEntireSystemDebt':
          return 20_000_000n * MUSD
        case 'mintList':
          return true
        case 'getTroveOwnersCount':
          return 50n
        case 'getSize':
          return 50n
        case 'getApproxHint':
          return [OWNER, 0n, 0n]
        case 'findInsertPosition':
          return [OWNER, OWNER]
        case 'refinancingFeePercentage':
          return 20
        default:
          throw new Error(`unstubbed read: ${c.functionName}`)
      }
    },
    simulateContract: async (request: {
      functionName: string
      args: readonly unknown[]
      value?: bigint
    }) => {
      simulated.push(request)
      if (opts.simulateRevert) throw revert(opts.simulateRevert)
      return { request: {} }
    },
    estimateContractGas: async () => 500_000n,
  } as unknown as PublicClient
  const walletClient =
    opts.wallet === 'none'
      ? undefined
      : ({
          account: opts.wallet === 'no-account' ? undefined : { address: OWNER, type: 'json-rpc' },
          writeContract: async () => '0xhash',
        } as unknown as WalletClient)
  const deps: WriteDeps = {
    publicClient,
    walletClient,
    addresses: getAddresses(31611),
    ensureVerified: async () => {},
    gasMarginPercent: 0,
    getMinNetDebt: async () => state.minNetDebt,
    isAccountFeeExempt: async () => state.feeExempt,
  }
  const nicrSent = () =>
    reads.filter((r) => r.functionName === 'findInsertPosition').map((r) => r.args?.[0])
  return { deps, reads, simulated, nicrSent }
}

const NICR = (coll: bigint, principal: bigint) => (coll * 10n ** 20n) / principal

describe('MK-214, openTrove, the floor at exactly the minimum net debt', () => {
  const fresh = { ...ACTIVE, principal: 0n, collateral: 0n, feeExempt: true }
  it('an open of exactly the floor is sent, and one wei less is refused before gas', async () => {
    const at = chain(fresh)
    await openTrove(at.deps, { collateral: BTC, debt: 1_800n * MUSD })
    expect(at.simulated).toHaveLength(1)
    await expect(
      openTrove(chain(fresh).deps, { collateral: BTC, debt: 1_800n * MUSD - 1n }),
    ).rejects.toBeInstanceOf(BelowMinimumDebt)
  })
})

describe('MK-210, MK-209, borrow, the capacity and fee cap at their boundary', () => {
  it('a borrow that fills the capacity exactly is sent, and one wei of capacity less is refused', async () => {
    const amount = 1_000n * MUSD
    const fee = (RATE * amount) / E18
    const capacity = ACTIVE.principal + amount + fee
    const at = chain({ ...ACTIVE, capacity })
    await borrow(at.deps, { amount })
    expect(at.simulated).toHaveLength(1)
    await expect(
      borrow(chain({ ...ACTIVE, capacity: capacity - 1n }).deps, { amount }),
    ).rejects.toBeInstanceOf(ExceedsBorrowingCapacity)
  })

  it('a fee cap of exactly the charged rate passes, as a 1e18 fraction', async () => {
    const at = chain(ACTIVE)
    await borrow(at.deps, { amount: 1_000n * MUSD, maxFeePercentage: RATE })
    expect(at.simulated).toHaveLength(1)
  })
})

describe('MK-215, MK-216, repay, the excess and balance gates', () => {
  it('repaying exactly the net debt is refused for the floor, not as an excess', async () => {
    // Net debt 19,800 MUSD. Repaying all of it is not more than owed (`:1251`), but it leaves 0 under the floor.
    await expect(repay(chain(ACTIVE).deps, { amount: 19_800n * MUSD })).rejects.toBeInstanceOf(
      BelowMinimumDebt,
    )
    await expect(repay(chain(ACTIVE).deps, { amount: 19_800n * MUSD + 1n })).rejects.toBeInstanceOf(
      RepayExceedsDebt,
    )
  })

  it('a balance of exactly the repayment is enough', async () => {
    const amount = 1_000n * MUSD
    const at = chain({ ...ACTIVE, balance: amount })
    await repay(at.deps, { amount })
    expect(at.simulated).toHaveLength(1)
  })
})

describe('MK-224, close, the balance at exactly the net debt', () => {
  it('a balance of exactly the net debt closes, and one wei less is refused', async () => {
    const at = chain({ ...ACTIVE, balance: 19_800n * MUSD })
    await close(at.deps)
    expect(at.simulated).toHaveLength(1)
    await expect(
      close(chain({ ...ACTIVE, balance: 19_800n * MUSD - 1n }).deps),
    ).rejects.toBeInstanceOf(InsufficientMusdBalance)
  })
})

describe('MK-217, MK-218, MK-221, MK-222, adjustTrove, what it sends and what it refuses', () => {
  it('a collateral top up sends no withdrawal, no debt change, not an increase, and the value', async () => {
    const at = chain(ACTIVE)
    await adjustTrove(at.deps, { addCollateral: BTC })
    const [sent] = at.simulated
    expect(sent?.args.slice(0, 3)).toEqual([0n, 0n, false])
    expect(sent?.value).toBe(BTC)
    expect(
      at.reads.map((r) => r.functionName),
      'no fee is asked for without a borrow',
    ).not.toContain('getBorrowingFee')
  })

  it('a withdrawal sends the withdrawal', async () => {
    // Whether a zero `value` is spelled out or omitted is not asserted: both are a call carrying no BTC.
    const at = chain(ACTIVE)
    await adjustTrove(at.deps, { withdrawCollateral: BTC })
    expect(at.simulated[0]?.args.slice(0, 3)).toEqual([BTC, 0n, false])
  })

  it('a borrow sends the draw as an increase, with hints for the principal plus draw plus fee', async () => {
    const amount = 1_000n * MUSD
    const at = chain(ACTIVE)
    await adjustTrove(at.deps, { borrow: amount })
    expect(at.simulated[0]?.args.slice(0, 3)).toEqual([0n, amount, true])
    const fee = (RATE * amount) / E18
    expect(at.nicrSent()).toEqual([NICR(ACTIVE.collateral, ACTIVE.principal + amount + fee)])
  })

  it('a repayment sends the repayment as a decrease, with hints for the principal it leaves', async () => {
    const owed = { ...ACTIVE, interestOwed: 100n * MUSD }
    const at = chain(owed)
    await adjustTrove(at.deps, { repay: 1_000n * MUSD })
    expect(at.simulated[0]?.args.slice(0, 3)).toEqual([0n, 1_000n * MUSD, false])
    // Interest first (`InterestRateMath.sol:33-48`): 1,000 repaid against 100 owed takes 900 off principal.
    expect(at.nicrSent()).toEqual([NICR(owed.collateral, owed.principal - 900n * MUSD)])
  })

  it('refuses a repayment of more than the net debt with the net debt on the error, and exactly all of it for the floor', async () => {
    const excess = await adjustTrove(chain(ACTIVE).deps, { repay: 19_800n * MUSD + 1n }).catch(
      (e: unknown) => e,
    )
    expect(excess).toBeInstanceOf(RepayExceedsDebt)
    expect((excess as RepayExceedsDebt).context).toMatchObject({ netDebt: 19_800n * MUSD })
    await expect(adjustTrove(chain(ACTIVE).deps, { repay: 19_800n * MUSD })).rejects.toBeInstanceOf(
      BelowMinimumDebt,
    )
  })

  it('asks the preview about the borrow it will send, so an undercollateralised draw is refused before gas', async () => {
    // 10 BTC at 80,000 is 800,000 USD; drawing 800,000 MUSD more is far under MCR.
    await expect(
      adjustTrove(chain(ACTIVE).deps, { borrow: 800_000n * MUSD }),
    ).rejects.toBeInstanceOf(InsufficientCollateral)
  })

  it('asks the preview about the repayment it will send, so a short balance is refused before gas', async () => {
    await expect(
      adjustTrove(chain({ ...ACTIVE, balance: 0n }).deps, { repay: 1_000n * MUSD }),
    ).rejects.toBeInstanceOf(InsufficientMusdBalance)
  })
})

describe('MK-225, refinance for a fee exempt account', () => {
  it('reads no refinancing fee and hints for the unchanged principal', async () => {
    const exempt = { ...ACTIVE, feeExempt: true }
    const at = chain(exempt)
    await refinance(at.deps)
    expect(at.reads.map((r) => r.functionName)).not.toContain('refinancingFeePercentage')
    expect(at.nicrSent()).toEqual([NICR(exempt.collateral, exempt.principal)])
  })
})

describe('MK-213, what every send carries', () => {
  it('a collateral add sends its value', async () => {
    const at = chain(ACTIVE)
    await addCollateral(at.deps, { amount: BTC })
    expect(at.simulated[0]?.value).toBe(BTC)
  })

  it('a revert names the account the write was for', async () => {
    const at = chain(ACTIVE, { simulateRevert: 'TroveManager: Trove does not exist or is closed' })
    const error = await addCollateral(at.deps, { amount: BTC }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TroveNotFound)
    expect((error as TroveNotFound).message).toContain(OWNER)
  })

  it('a missing wallet, or a wallet with no account, is refused by name', async () => {
    await expect(
      addCollateral(chain(ACTIVE, { wallet: 'none' }).deps, { amount: BTC }),
    ).rejects.toBeInstanceOf(MissingWalletClient)
    await expect(
      addCollateral(chain(ACTIVE, { wallet: 'no-account' }).deps, { amount: BTC }),
    ).rejects.toBeInstanceOf(MissingWalletClient)
  })
})
