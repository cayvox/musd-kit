import { beforeEach, describe, expect, it } from 'vitest'
import { DEPLOYMENTS, MCR, MIN_NET_DEBT_MIN, UnsupportedChain, createMusdClient } from '../src'
import { connectFork } from './harness'

// The pure address cross-check vs ground-truth §4 lives in `addresses.test.ts`.

describe('Phase 1 — createMusdClient on the fork (31611)', () => {
  beforeEach(() => connectFork().refreshOracle())

  it('resolves every dev-facing address', () => {
    const { publicClient } = connectFork()
    const musd = createMusdClient({ chainId: 31611, publicClient })
    expect(musd.addresses).toEqual(DEPLOYMENTS[31611])
  })

  it('reads minNetDebt live and caches it (≈ 1800e18), matching a direct read', async () => {
    const { publicClient } = connectFork()
    const musd = createMusdClient({ chainId: 31611, publicClient })

    const direct = await musd.contracts.borrowerOperations.read.minNetDebt()
    const { minNetDebt } = await musd.getConstants()

    console.log(`[phase1] minNetDebt() live = ${minNetDebt} (${minNetDebt / 10n ** 18n} MUSD)`)
    expect(minNetDebt).toBe(direct)
    // Governable (Law 3) — assert a sane band around the current 1,800, not a hardcode.
    expect(minNetDebt).toBeGreaterThanOrEqual(MIN_NET_DEBT_MIN)
    expect(minNetDebt).toBeGreaterThanOrEqual(1_000n * 10n ** 18n)
    expect(minNetDebt).toBeLessThanOrEqual(10_000n * 10n ** 18n)
  })

  it('each typed client makes a successful read', async () => {
    const { publicClient } = connectFork()
    const musd = createMusdClient({ chainId: 31611, publicClient })

    const [mcr, price, minNetDebt, rate, decimals] = await Promise.all([
      musd.contracts.troveManager.read.MCR(),
      musd.contracts.priceFeed.read.fetchPrice(),
      musd.contracts.borrowerOperations.read.minNetDebt(),
      musd.contracts.interestRateManager.read.interestRate(),
      musd.contracts.musd.read.decimals(),
    ])

    console.log(`[phase1] MCR=${mcr} price=${price} interestRate=${rate}bps decimals=${decimals}`)
    expect(mcr).toBe(MCR)
    expect(price).toBeGreaterThan(0n)
    expect(price).toBeLessThan(10n ** 30n)
    expect(minNetDebt).toBeGreaterThan(0n)
    expect(Number.isInteger(rate)).toBe(true)
    expect(rate).toBeGreaterThanOrEqual(0)
    expect(rate).toBeLessThanOrEqual(10_000) // ≤ 100% in bps — sane band
    expect(decimals).toBe(18)
  })

  it('getBorrowingFee passes through to the contract', async () => {
    const { publicClient } = connectFork()
    const musd = createMusdClient({ chainId: 31611, publicClient })
    const draw = 2_000n * 10n ** 18n
    const fee = await musd.getBorrowingFee(draw)
    console.log(`[phase1] getBorrowingFee(2000 MUSD) = ${fee}`)
    expect(fee).toBeGreaterThanOrEqual(0n)
    expect(fee).toBeLessThan(draw) // fee is a small fraction of the draw
  })

  it('verifyDeployment passes — bundled MCR/CCR match the chain (defense-in-depth)', async () => {
    const { publicClient } = connectFork()
    const musd = createMusdClient({ chainId: 31611, publicClient })
    await expect(musd.verifyDeployment()).resolves.toBeUndefined()
  })

  it('throws UnsupportedChain for a chainId with no deployment', () => {
    const { publicClient } = connectFork()
    expect(() => createMusdClient({ chainId: 1, publicClient })).toThrow(UnsupportedChain)
  })
})
