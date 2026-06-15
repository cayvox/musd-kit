import { http, type Address, type PrivateKeyAccount, createWalletClient, zeroAddress } from 'viem'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  InvalidAdjustment,
  MaxFeeExceeded,
  MissingWalletClient,
  createMusdClient,
  getAddresses,
  musdAbi,
  sortedTrovesAbi,
  troveManagerAbi,
} from '../src'
import { connectFork } from './harness'
import { mezoTestnet } from './harness/constants'
import { openTroveRaw, testAccount } from './harness/openTroveRaw'

const T = getAddresses(31611)
const BTC = 10n ** 18n
const MUSD = 10n ** 18n
const GAS = 200n * MUSD

function clientFor(account: PrivateKeyAccount) {
  const fork = connectFork()
  const walletClient = createWalletClient({
    account,
    chain: mezoTestnet,
    transport: http(fork.rpcUrl),
  })
  return createMusdClient({ chainId: 31611, publicClient: fork.publicClient, walletClient })
}

const wait = (hash: Address) => connectFork().publicClient.waitForTransactionReceipt({ hash })
const fundBtc = (a: Address, v: bigint) => connectFork().fundAccount(a, v)

/**
 * Refresh the oracle, then run an SDK write and wait for its receipt. These lifecycle tests
 * issue many sequential writes; the shared anvil fork stamps blocks with wall-clock time, so
 * across several slow steps a later write's price-dependent simulate can pass while the tx
 * mines against a now-stale oracle and reverts (a silent reverted receipt — the debt simply
 * doesn't change). Refreshing immediately before each write keeps the price fresh.
 */
const sent = async (call: () => Promise<{ hash: Address }>) => {
  await connectFork().refreshOracle()
  return wait((await call()).hash)
}

const balanceMusd = (a: Address) =>
  connectFork().publicClient.readContract({
    address: T.musd,
    abi: musdAbi,
    functionName: 'balanceOf',
    args: [a],
  })

const nicrOf = (a: Address) =>
  connectFork().publicClient.readContract({
    address: T.troveManager,
    abi: troveManagerAbi,
    functionName: 'getNominalICR',
    args: [a],
  })

const near = (a: bigint, b: bigint, tol = 10n ** 16n) => {
  const d = a > b ? a - b : b - a
  expect(d, `${a} vs ${b}`).toBeLessThanOrEqual(tol)
}

/** Verify `addr` sits in the correct SortedTroves position (descending NICR). */
async function assertPlaced(addr: Address) {
  const { publicClient } = connectFork()
  const st = { address: T.sortedTroves, abi: sortedTrovesAbi } as const
  const [prev, next] = await Promise.all([
    publicClient.readContract({ ...st, functionName: 'getPrev', args: [addr] }),
    publicClient.readContract({ ...st, functionName: 'getNext', args: [addr] }),
  ])
  const nicr = await nicrOf(addr)
  if (prev !== zeroAddress) expect(await nicrOf(prev)).toBeGreaterThanOrEqual(nicr)
  if (next !== zeroAddress) expect(nicr).toBeGreaterThanOrEqual(await nicrOf(next))
}

let funder: PrivateKeyAccount

/** Send MUSD from the funder (who borrowed a big pile) to `to`. */
async function fundMusd(to: Address, amount: bigint) {
  const fork = connectFork()
  const wallet = createWalletClient({
    account: funder,
    chain: mezoTestnet,
    transport: http(fork.rpcUrl),
  })
  const { request } = await fork.publicClient.simulateContract({
    account: funder,
    address: T.musd,
    abi: musdAbi,
    functionName: 'transfer',
    args: [to, amount],
  })
  await wait(await wallet.writeContract(request))
}

describe('Phase 5 — trove/ lifecycle writes (the SDK sends txs)', () => {
  beforeEach(() => connectFork().refreshOracle())

  beforeAll(async () => {
    funder = testAccount(401)
    await openTroveRaw(connectFork(), {
      collateralBtc: 3n * BTC,
      debtMusd: 120_000n * MUSD,
      account: funder,
      numTrials: 15,
    })
  }, 120_000)

  it('full lifecycle via the SDK: open → addColl → borrow → repay → withdrawColl → refinance → close', async () => {
    const L = testAccount(400)
    await fundBtc(L.address, 20n * BTC)
    const musd = clientFor(L)

    // open
    await sent(() => musd.openTrove({ collateral: (5n * BTC) / 10n, debt: 5_000n * MUSD })) // 0.5 BTC
    let t = await musd.getTrove(L.address)
    const fee = await musd.getBorrowingFee(5_000n * MUSD)
    expect(t.exists).toBe(true)
    expect(t.collateral).toBe((5n * BTC) / 10n)
    near(t.entireDebt, 5_000n * MUSD + fee + GAS)
    await assertPlaced(L.address)

    // addCollateral 0.1
    await sent(() => musd.addCollateral({ amount: BTC / 10n }))
    t = await musd.getTrove(L.address)
    expect(t.collateral).toBe((6n * BTC) / 10n)
    await assertPlaced(L.address)

    // borrow 1000
    const dbefore = (await musd.getTrove(L.address)).entireDebt
    await sent(() => musd.borrow({ amount: 1_000n * MUSD }))
    t = await musd.getTrove(L.address)
    near(t.entireDebt, dbefore + 1_000n * MUSD + (await musd.getBorrowingFee(1_000n * MUSD)))
    await assertPlaced(L.address)

    // repay 500
    const beforeRepay = (await musd.getTrove(L.address)).entireDebt
    await sent(() => musd.repay({ amount: 500n * MUSD }))
    t = await musd.getTrove(L.address)
    near(t.entireDebt, beforeRepay - 500n * MUSD)
    await assertPlaced(L.address)

    // withdrawCollateral 0.05
    await sent(() => musd.withdrawCollateral({ amount: (5n * BTC) / 100n }))
    t = await musd.getTrove(L.address)
    expect(t.collateral).toBe((6n * BTC) / 10n - (5n * BTC) / 100n) // 0.55
    await assertPlaced(L.address)

    // refinance
    await sent(() => musd.refinance())
    t = await musd.getTrove(L.address)
    expect(t.exists).toBe(true)
    await assertPlaced(L.address)

    // close: fund L with the net debt + a little, then close
    const required = t.entireDebt - GAS
    await fundMusd(L.address, required + 5n * MUSD)
    const musdBefore = await balanceMusd(L.address)
    const btcBefore = await connectFork().publicClient.getBalance({ address: L.address })
    const collAtClose = t.collateral
    await sent(() => musd.close())

    const closed = await musd.getTrove(L.address)
    expect(closed.exists).toBe(false)
    // close payoff: burned ~ entireDebt − 200; collateral (+200 reserve) returned.
    near(musdBefore - (await balanceMusd(L.address)), required, 10n ** 16n)
    const btcDelta =
      (await connectFork().publicClient.getBalance({ address: L.address })) - btcBefore
    expect(btcDelta).toBeGreaterThan(collAtClose - BTC / 100n) // ~collateral back, minus gas
  }, 300_000)

  it('adjustTrove combined + mutual-exclusion validation', async () => {
    const A = testAccount(410)
    await fundBtc(A.address, 20n * BTC)
    const musd = clientFor(A)
    await sent(() => musd.openTrove({ collateral: (5n * BTC) / 10n, debt: 5_000n * MUSD }))

    // (a) add collateral + borrow in one call
    const before = await musd.getTrove(A.address)
    await sent(() => musd.adjustTrove({ addCollateral: BTC / 10n, borrow: 1_000n * MUSD }))
    let t = await musd.getTrove(A.address)
    expect(t.collateral).toBe(before.collateral + BTC / 10n)
    near(
      t.entireDebt,
      before.entireDebt + 1_000n * MUSD + (await musd.getBorrowingFee(1_000n * MUSD)),
    )
    await assertPlaced(A.address)

    // (b) withdraw collateral + repay in one call
    const before2 = await musd.getTrove(A.address)
    await sent(() =>
      musd.adjustTrove({ withdrawCollateral: (5n * BTC) / 100n, repay: 500n * MUSD }),
    )
    t = await musd.getTrove(A.address)
    expect(t.collateral).toBe(before2.collateral - (5n * BTC) / 100n)
    near(t.entireDebt, before2.entireDebt - 500n * MUSD)

    // validation
    await expect(musd.adjustTrove({ addCollateral: BTC, withdrawCollateral: BTC })).rejects.toThrow(
      InvalidAdjustment,
    )
    await expect(musd.adjustTrove({ borrow: MUSD, repay: MUSD })).rejects.toThrow(InvalidAdjustment)
  }, 240_000)

  it('maxFeePercentage guard throws MaxFeeExceeded and sends nothing', async () => {
    const G = testAccount(420)
    await fundBtc(G.address, 20n * BTC)
    const musd = clientFor(G)
    // Real fee is 0.1% (1e15 of 1e18). Cap at 0.01% (1e14) → must throw.
    await expect(
      musd.openTrove({
        collateral: (5n * BTC) / 10n,
        debt: 5_000n * MUSD,
        maxFeePercentage: 10n ** 14n,
      }),
    ).rejects.toThrow(MaxFeeExceeded)
    // nothing sent → no trove
    expect((await musd.getTrove(G.address)).exists).toBe(false)
  }, 120_000)

  it('simulate-before-send surfaces reverts (no silent reverted receipt)', async () => {
    const R = testAccount(421)
    await fundBtc(R.address, 20n * BTC)
    const musd = clientFor(R)
    await sent(() => musd.openTrove({ collateral: (5n * BTC) / 10n, debt: 5_000n * MUSD }))

    // withdraw almost all collateral → ICR < MCR → revert surfaced
    await expect(musd.withdrawCollateral({ amount: (49n * BTC) / 100n })).rejects.toThrow()
    // repay more than owed → revert surfaced
    await expect(musd.repay({ amount: 1_000_000n * MUSD })).rejects.toThrow()
    // trove still intact (nothing landed)
    expect((await musd.getTrove(R.address)).exists).toBe(true)
  }, 180_000)

  it('claim with no surplus is a safe no-op; writes need a walletClient', async () => {
    const C = testAccount(430)
    await fundBtc(C.address, 20n * BTC)
    const musd = clientFor(C)
    await sent(() => musd.openTrove({ collateral: (5n * BTC) / 10n, debt: 5_000n * MUSD }))

    const res = await musd.claim()
    expect(res.claimed).toBe(false)
    expect(res.hash).toBeNull()

    // No walletClient → write throws MissingWalletClient.
    const readOnly = createMusdClient({ chainId: 31611, publicClient: connectFork().publicClient })
    await expect(readOnly.openTrove({ collateral: BTC, debt: 5_000n * MUSD })).rejects.toThrow(
      MissingWalletClient,
    )
  }, 120_000)
})
