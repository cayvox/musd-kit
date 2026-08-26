import { http, createWalletClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEPLOYMENTS,
  DeploymentVerificationFailed,
  MCR,
  MIN_NET_DEBT_MIN,
  UnsupportedChain,
  createMusdClient,
  getAddresses,
} from '../src'
import { connectFork } from './harness'
import { mezoTestnet } from './harness/constants'

// The pure address cross-check vs ground-truth §4 lives in `addresses.test.ts`.

describe('Phase 1, createMusdClient on the fork (31611)', () => {
  beforeEach(() => connectFork().mineBlocks(1))

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
    // Governable, assert a sane band around the current 1,800, not a hardcode.
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
    expect(rate).toBeLessThanOrEqual(10_000) // ≤ 100% in bps, sane band
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

  it('verifyDeployment passes on the real deployment: code, wiring and constants (MK-008)', async () => {
    const { publicClient } = connectFork()
    const musd = createMusdClient({ chainId: 31611, publicClient })
    // Every assertion at once, against the genuine article: code at all seven bundled
    // addresses, the fourteen cross wiring pointers, HintHelpers.priceFeed() still unset,
    // and MCR/CCR. This is the half a fake cannot give: that the real deployment satisfies
    // the stricter check and does not now fail it.
    await expect(musd.verifyDeployment()).resolves.toBeUndefined()
  })

  it('a foreign address in the map is rejected BEFORE anything is sent (MK-008, MK-009)', async () => {
    const { publicClient } = connectFork()
    // The MAINNET SortedTroves, on a testnet fork: a well formed address, a real deployment,
    // simply the wrong one. This is the shape a real misconfiguration takes, and note what
    // the OLD check would have done with it: nothing at all, because it only ever read
    // MCR/CCR on troveManager, which this override does not touch.
    const musd = createMusdClient({
      chainId: 31611,
      publicClient,
      addresses: { sortedTroves: getAddresses(31612).sortedTroves },
    })
    const err = await musd.verifyDeployment().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DeploymentVerificationFailed)
    // On a real chain a wrong address has no code, so the batch fails and the code sweep
    // names it rather than leaving an opaque decode error. The other shape, a substitute
    // that HAS code and answers correctly but is not the one the deployment points at, is
    // pinned chain free in `s2-verify-deployment.test.ts`; constructing it here would mean
    // deploying a lookalike contract onto the fork.
    expect((err as DeploymentVerificationFailed).failures.join('\n')).toContain(
      'no contract code at the sortedTroves address',
    )
  })

  it('every write is gated on verification, not only getConstants (MK-008)', async () => {
    const fork = connectFork()
    const account = privateKeyToAccount(
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    )
    const musd = createMusdClient({
      chainId: 31611,
      publicClient: fork.publicClient,
      walletClient: createWalletClient({
        account,
        chain: mezoTestnet,
        transport: http(fork.rpcUrl),
      }),
      addresses: { sortedTroves: getAddresses(31612).sortedTroves },
    })
    // Before this wave, this map reached simulate untouched: verifyDeployment hung off
    // getConstants(), and openTrove read minNetDebt with a direct readContract that never
    // went near it. The write now fails on the deployment, not on a hint computed against a
    // SortedTroves from another network.
    const err = await musd
      .openTrove({ collateral: 10n ** 17n, debt: 2_000n * 10n ** 18n })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DeploymentVerificationFailed)
  })

  it('verification is memoized, so it is one multicall for the life of the client', async () => {
    const { publicClient } = connectFork()
    const musd = createMusdClient({ chainId: 31611, publicClient })
    const first = musd.verifyDeployment()
    const second = musd.verifyDeployment()
    // Same promise identity: concurrent first writes share one batch rather than racing
    // into several.
    expect(second).toBe(first)
    await expect(first).resolves.toBeUndefined()
  })

  it('throws UnsupportedChain for a chainId with no deployment', () => {
    const { publicClient } = connectFork()
    expect(() => createMusdClient({ chainId: 1, publicClient })).toThrow(UnsupportedChain)
  })
})
