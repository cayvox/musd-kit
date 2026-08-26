import type { Abi, Address, PublicClient } from 'viem'
import { zeroAddress } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CCR, DEFAULT_CONSTANTS_TTL_MS, MCR, createMusdClient, getAddresses } from '../src'

const T = getAddresses(31611)

/**
 * A client that answers every deployment-verification read consistently, and counts how
 * often the two governable values are read.
 */
function fakeClient(values: { minNetDebt: bigint; interestRate: number }) {
  let governableReads = 0
  const wiring: Record<string, unknown> = {
    [`${T.troveManager.toLowerCase()}|MCR`]: MCR,
    [`${T.troveManager.toLowerCase()}|CCR`]: CCR,
    [`${T.troveManager.toLowerCase()}|sortedTroves`]: T.sortedTroves,
    [`${T.troveManager.toLowerCase()}|borrowerOperations`]: T.borrowerOperations,
    [`${T.troveManager.toLowerCase()}|interestRateManager`]: T.interestRateManager,
    [`${T.troveManager.toLowerCase()}|priceFeed`]: T.priceFeed,
    [`${T.troveManager.toLowerCase()}|musdToken`]: T.musd,
    [`${T.borrowerOperations.toLowerCase()}|troveManager`]: T.troveManager,
    [`${T.borrowerOperations.toLowerCase()}|interestRateManager`]: T.interestRateManager,
    [`${T.borrowerOperations.toLowerCase()}|priceFeed`]: T.priceFeed,
    [`${T.borrowerOperations.toLowerCase()}|musd`]: T.musd,
    [`${T.hintHelpers.toLowerCase()}|troveManager`]: T.troveManager,
    [`${T.hintHelpers.toLowerCase()}|sortedTroves`]: T.sortedTroves,
    [`${T.hintHelpers.toLowerCase()}|borrowerOperations`]: T.borrowerOperations,
    [`${T.hintHelpers.toLowerCase()}|priceFeed`]: zeroAddress,
    [`${T.sortedTroves.toLowerCase()}|troveManager`]: T.troveManager,
    [`${T.sortedTroves.toLowerCase()}|borrowerOperationsAddress`]: T.borrowerOperations,
    [`${T.priceFeed.toLowerCase()}|oracle`]: '0x7b7C000000000000000000000000000000000015',
    [`${T.musd.toLowerCase()}|decimals`]: 18,
    [`${T.interestRateManager.toLowerCase()}|interestRate`]: values.interestRate,
  }
  const publicClient = {
    multicall: async ({
      contracts,
    }: { contracts: readonly { address: Address; abi: Abi; functionName: string }[] }) =>
      contracts.map((c) => wiring[`${c.address.toLowerCase()}|${c.functionName}`]),
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === 'minNetDebt') {
        governableReads += 1
        return values.minNetDebt
      }
      if (functionName === 'interestRate') return values.interestRate
      throw new Error(`unexpected read: ${functionName}`)
    },
  } as unknown as PublicClient
  return { publicClient, governableReads: () => governableReads }
}

/**
 * MK-012. `minNetDebt` and the interest rate are governable and were cached for the lifetime
 * of the client object, so a keeper or a server that builds one client at boot could act on
 * a debt floor that changed hours earlier and never notice.
 *
 * There was no paired findings test. Every case here passes against the old implementation
 * except the two that matter, which is the point of writing them.
 */
describe('MK-012, the governable constants cache expires and can be dropped', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('caches inside the TTL: repeated calls read once', async () => {
    const { publicClient, governableReads } = fakeClient({ minNetDebt: 1800n, interestRate: 100 })
    const musd = createMusdClient({ chainId: 31611, publicClient })
    await musd.getConstants()
    await musd.getConstants()
    vi.advanceTimersByTime(DEFAULT_CONSTANTS_TTL_MS - 1)
    await musd.getConstants()
    expect(governableReads()).toBe(1)
  })

  it('re-reads once the TTL has passed, which is the whole finding', async () => {
    const { publicClient, governableReads } = fakeClient({ minNetDebt: 1800n, interestRate: 100 })
    const musd = createMusdClient({ chainId: 31611, publicClient })
    await musd.getConstants()
    vi.advanceTimersByTime(DEFAULT_CONSTANTS_TTL_MS)
    await musd.getConstants()
    expect(governableReads()).toBe(2)
  })

  it('the default TTL is short enough that no process holds a stale floor for hours', () => {
    expect(DEFAULT_CONSTANTS_TTL_MS).toBeLessThanOrEqual(5 * 60_000)
  })

  it('invalidateConstants drops the cache immediately, without waiting out the TTL', async () => {
    const { publicClient, governableReads } = fakeClient({ minNetDebt: 1800n, interestRate: 100 })
    const musd = createMusdClient({ chainId: 31611, publicClient })
    await musd.getConstants()
    musd.invalidateConstants()
    await musd.getConstants()
    expect(governableReads()).toBe(2)
  })

  it('a governance change is picked up rather than pinned forever', async () => {
    const values = { minNetDebt: 1800n, interestRate: 100 }
    const { publicClient } = fakeClient(values)
    const musd = createMusdClient({ chainId: 31611, publicClient })
    expect((await musd.getConstants()).minNetDebt).toBe(1800n)
    values.minNetDebt = 2500n
    // Still cached, which is correct: the TTL is a bound on staleness, not a promise of
    // freshness on every call.
    expect((await musd.getConstants()).minNetDebt).toBe(1800n)
    vi.advanceTimersByTime(DEFAULT_CONSTANTS_TTL_MS)
    expect((await musd.getConstants()).minNetDebt).toBe(2500n)
  })

  it('constantsTtlMs: 0 re-reads every call', async () => {
    const { publicClient, governableReads } = fakeClient({ minNetDebt: 1800n, interestRate: 100 })
    const musd = createMusdClient({ chainId: 31611, publicClient, constantsTtlMs: 0 })
    await musd.getConstants()
    await musd.getConstants()
    expect(governableReads()).toBe(2)
  })

  it('concurrent callers after an expiry share ONE read, not one each', async () => {
    const { publicClient, governableReads } = fakeClient({ minNetDebt: 1800n, interestRate: 100 })
    const musd = createMusdClient({ chainId: 31611, publicClient })
    await Promise.all([musd.getConstants(), musd.getConstants(), musd.getConstants()])
    expect(governableReads()).toBe(1)
  })
})
