import {
  BelowMinimumDebt,
  MissingWalletClient,
  createMusdClient,
  getAddresses,
  hintHelpersAbi,
  musdAbi,
} from '@musd-kit/core'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { connect } from '@wagmi/core'
import { http, type Address, type PrivateKeyAccount, createWalletClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { useWalletClient } from 'wagmi'
import { connectFork } from '../../core/test/harness'
import { mezoTestnet } from '../../core/test/harness/constants'
import { openTroveRaw, testAccount } from '../../core/test/harness/openTroveRaw'
import {
  useBorrowingPower,
  useCloseTrove,
  useHealthFactor,
  useLiquidationPrice,
  useOpenTrove,
  useOraclePrice,
  useRedeem,
  useRepay,
  useTrove,
} from '../src'
import { makeConfig, makeWrapper, newQueryClient } from './wagmi'

// anvil's first default account, UNLOCKED on the fork, so the mock connector's
// eth_sendTransaction (which omits `from` → anvil uses account[0]) signs as exactly this
// address. Using it as the connected account keeps the wagmi account and the on-chain
// signer identical (no impersonation needed).
const ANVIL_0 = privateKeyToAccount(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
)

const CHAIN_ID = 31611
const BTC = 10n ** 18n
const MUSD = 10n ** 18n
const T = getAddresses(CHAIN_ID)

let rpcUrl: string
let reader: Address // has a Trove (read tests)
let holder: PrivateKeyAccount // funded; the mock-connected account (write tests)
let coreClient: ReturnType<typeof createMusdClient>

/** A core client whose walletClient signs with a real private key (for non-hook fork writes). */
function coreClientFor(account: PrivateKeyAccount) {
  const fork = connectFork()
  const walletClient = createWalletClient({ account, chain: mezoTestnet, transport: http(rpcUrl) })
  return createMusdClient({ chainId: CHAIN_ID, publicClient: fork.publicClient, walletClient })
}

const waitTx = (hash: Address) => connectFork().publicClient.waitForTransactionReceipt({ hash })

/** A fresh wagmi config with the mock connector CONNECTED + an RTL wrapper (per test, a
 *  shared config across tests left a stale block-watch subscription that broke refetch). */
async function connectedWrapper() {
  const config = makeConfig(rpcUrl, [holder.address])
  await connect(config, { connector: config.connectors[0]! })
  return makeWrapper(config, newQueryClient())
}

interface MutationSlice {
  hash: Address | null
  isSuccess: boolean
  isError: boolean
  reset: () => void
}

/**
 * Fire a write-hook action and confirm its tx actually MINED (receipt status `success`),
 * retrying on a silent revert. The core returns `{ hash }` without awaiting the receipt
 * (caller waits), so a revert that happens AFTER a passing simulate, possible on a loaded,
 * wall-clock-stamped shared fork, slips through as `isSuccess`. We check the receipt and,
 * on a revert, refresh the oracle and re-fire. Genuine failures still throw after the retries.
 */
async function ensureWriteMined(fire: () => void, mut: () => MutationSlice): Promise<void> {
  let last: unknown
  for (let attempt = 0; attempt < 4; attempt++) {
    await connectFork().refreshOracle()
    act(() => fire())
    await waitFor(() => expect(mut().isSuccess || mut().isError).toBe(true), { timeout: 60_000 })
    const hash = mut().hash
    if (hash) {
      const receipt = await connectFork().publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status === 'success') return
      last = new Error(`tx ${hash} reverted (attempt ${attempt + 1})`)
    } else {
      last = new Error('mutation errored without a tx hash')
    }
    act(() => mut().reset())
  }
  throw last ?? new Error('write did not mine after retries')
}

beforeAll(async () => {
  const fork = connectFork()
  rpcUrl = fork.rpcUrl
  await fork.refreshOracle()

  // reader: a real Trove to read (signed with its own key); also our MUSD funder.
  const readerAccount = testAccount(800)
  reader = readerAccount.address
  await openTroveRaw(fork, { collateralBtc: BTC, debtMusd: 6_000n * MUSD, account: readerAccount })

  // holder: anvil's default account[0], the address the mock connector actually signs as.
  holder = ANVIL_0
  await fork.fundAccount(holder.address, 50n * BTC)

  coreClient = createMusdClient({ chainId: CHAIN_ID, publicClient: fork.publicClient })
}, 240_000)

afterEach(() => cleanup())

// ── Read hooks ──────────────────────────────────────────────────────────────

describe('@musd-kit/react, read hooks (fork)', () => {
  it('useTrove resolves to the same object as core.getTrove; HF/liqPrice share ONE fetch', async () => {
    const qc = newQueryClient()
    const wrapper = makeWrapper(makeConfig(rpcUrl, [holder.address]), qc)
    const { result } = renderHook(
      () => ({
        trove: useTrove({ address: reader }),
        hf: useHealthFactor({ address: reader }),
        liq: useLiquidationPrice({ address: reader }),
      }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.trove.isLoading).toBe(false), { timeout: 30_000 })
    const core = await coreClient.getTrove(reader)

    expect(result.current.trove.data).toEqual(core)
    expect(result.current.hf.data).toBe(core.healthFactor)
    expect(result.current.liq.data).toBe(core.liquidationPrice)

    // Dedup: the three hooks share one query key → exactly one cached query for the Trove.
    const troveQueries = qc
      .getQueryCache()
      .getAll()
      .filter((q) => q.queryKey[2] === 'trove' && q.queryKey[3] === reader)
    expect(troveQueries.length).toBe(1)
  }, 60_000)

  it('useBorrowingPower returns the same value as core.getBorrowingPower (preview, no position)', async () => {
    const qc = newQueryClient()
    const wrapper = makeWrapper(makeConfig(rpcUrl, [holder.address]), qc)
    const collateral = (5n * BTC) / 100n
    const { result } = renderHook(() => useBorrowingPower({ collateral }), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 30_000 })
    expect(result.current.data).toBe(await coreClient.getBorrowingPower({ collateral }))
  }, 60_000)

  it('useTrove refetches on a new block (block-watching)', async () => {
    const qc = newQueryClient()
    const wrapper = makeWrapper(makeConfig(rpcUrl, [holder.address]), qc)
    const { result } = renderHook(() => useTrove({ address: reader }), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 30_000 })
    const before = result.current.data?.collateral as bigint

    // Change reader's position OUT OF BAND (its own signer), then expect block-watch refetch.
    // Warm the hint traversal + refresh the oracle so the addColl mines cleanly: a cold
    // computeHints on a loaded CI runner would let the oracle go stale and the addColl would
    // mine-revert (a silent reverted receipt), leaving the position unchanged and making
    // this look like a block-watch miss when it isn't. We assert the receipt succeeded.
    const fork = connectFork()
    const rdebt = (await coreClient.getTrove(reader)).entireDebt
    await coreClient.computeHints({ collateral: before + BTC / 10n, entireDebt: rdebt })
    await fork.refreshOracle()
    const rc = await waitTx(
      (await coreClientFor(testAccount(800)).addCollateral({ amount: BTC / 10n })).hash,
    )
    expect(rc.status).toBe('success')

    await waitFor(() => expect(result.current.data?.collateral).toBe(before + BTC / 10n), {
      timeout: 30_000,
    })
  }, 60_000)
})

// ── Write hooks ─────────────────────────────────────────────────────────────

describe('@musd-kit/react, write hooks (fork, mock connector)', () => {
  it('useOpenTrove sends via the mock wallet, reports status + hash, and invalidates useTrove', async () => {
    const wrapper = await connectedWrapper()
    const { result } = renderHook(
      () => ({
        open: useOpenTrove(),
        trove: useTrove({ address: holder.address }),
        wallet: useWalletClient(),
      }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.wallet.data).toBeTruthy(), { timeout: 30_000 })
    await waitFor(() => expect(result.current.trove.isLoading).toBe(false), { timeout: 30_000 })
    expect(result.current.trove.data?.exists).toBe(false)
    expect(result.current.open.isPending).toBe(false)

    // Warm the insertion-hint traversal so the SDK's openTrove is fast; ensureWriteMined
    // confirms the open actually mined (retrying any silent revert). The warm cache + holder's
    // Trove then cover the later write tests.
    await coreClient.computeHints({ collateral: (5n * BTC) / 10n, entireDebt: 5_205n * MUSD })
    await ensureWriteMined(
      () => result.current.open.openTrove({ collateral: (5n * BTC) / 10n, debt: 5_000n * MUSD }),
      () => result.current.open,
    )
    expect(result.current.open.hash).toMatch(/^0x[0-9a-fA-F]+$/)
    // Post-write invalidation + block-watch → useTrove reflects the new position.
    await waitFor(() => expect(result.current.trove.data?.exists).toBe(true), { timeout: 30_000 })
  }, 120_000)

  it('useRepay sends and the debt decreases', async () => {
    const wrapper = await connectedWrapper()
    const { result } = renderHook(
      () => ({
        repay: useRepay(),
        trove: useTrove({ address: holder.address }),
        wallet: useWalletClient(),
      }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.wallet.data).toBeTruthy(), { timeout: 30_000 })
    await waitFor(() => expect(result.current.trove.data?.exists).toBe(true), { timeout: 30_000 })
    const before = result.current.trove.data?.entireDebt as bigint

    await ensureWriteMined(
      () => result.current.repay.repay({ amount: 500n * MUSD }),
      () => result.current.repay,
    )
    await waitFor(
      () => expect((result.current.trove.data?.entireDebt as bigint) < before).toBe(true),
      { timeout: 30_000 },
    )
  }, 120_000)

  it('useRedeem sends and returns { hash, truncatedAmount, fee }', async () => {
    // Same razor-edge handling as the Phase-6 redemption gate: redeem at a +50% price (so the
    // lowest redeemable Trove has comfortable margin), warm the slow getRedemptionHints
    // traversal at that price, and refresh the oracle immediately before the redeem so it
    // mines fresh. Redeem 3,000, enough to close whole Troves. Price restored after.
    const wrapper = await connectedWrapper()
    const fork = connectFork()
    const orig = await coreClient.getOraclePrice()
    const high = (orig * 3n) / 2n
    try {
      await fork.setPrice(high)
      await fork.refreshOracle()
      await fork.publicClient.readContract({
        address: T.hintHelpers,
        abi: hintHelpersAbi,
        functionName: 'getRedemptionHints',
        args: [3_000n * MUSD, high, 100n],
      })
      const { result } = renderHook(() => ({ redeem: useRedeem(), wallet: useWalletClient() }), {
        wrapper,
      })
      await waitFor(() => expect(result.current.wallet.data).toBeTruthy(), { timeout: 30_000 })
      await ensureWriteMined(
        () => result.current.redeem.redeem({ amount: 3_000n * MUSD }),
        () => result.current.redeem,
      )
      expect(result.current.redeem.hash).toMatch(/^0x/)
      expect(result.current.redeem.data?.truncatedAmount).toBeGreaterThan(0n)
      expect(result.current.redeem.data?.fee).toBeGreaterThan(0n)
    } finally {
      await fork.setPrice(orig)
      await fork.refreshOracle()
    }
  }, 150_000)

  it('useCloseTrove sends and the Trove is gone', async () => {
    const wrapper = await connectedWrapper()
    const fork = connectFork()
    await fork.refreshOracle()
    const pos = await coreClient.getTrove(holder.address)
    // Fund holder the net debt (+ margin) from reader's MUSD pile so the close can burn it.
    const funder = testAccount(800)
    const fwallet = createWalletClient({
      account: funder,
      chain: mezoTestnet,
      transport: http(rpcUrl),
    })
    const { request } = await fork.publicClient.simulateContract({
      account: funder,
      address: T.musd,
      abi: musdAbi,
      functionName: 'transfer',
      args: [holder.address, pos.entireDebt + 50n * MUSD],
    })
    await waitTx(await fwallet.writeContract(request))

    // closeTrove reads the price and is blocked in Recovery Mode, lift +20% so the system is
    // clearly normal-mode (price restored after; the "Trove is gone" assertion is price-free).
    const origPrice = await coreClient.getOraclePrice()
    try {
      await fork.setPrice((origPrice * 12n) / 10n)
      await fork.refreshOracle()
      const { result } = renderHook(
        () => ({
          close: useCloseTrove(),
          trove: useTrove({ address: holder.address }),
          wallet: useWalletClient(),
        }),
        { wrapper },
      )
      await waitFor(() => expect(result.current.wallet.data).toBeTruthy(), { timeout: 30_000 })
      await waitFor(() => expect(result.current.trove.data?.exists).toBe(true), { timeout: 30_000 })
      await ensureWriteMined(
        () => result.current.close.closeTrove(),
        () => result.current.close,
      )
      await waitFor(() => expect(result.current.trove.data?.exists).toBe(false), {
        timeout: 30_000,
      })
    } finally {
      await fork.setPrice(origPrice)
      await fork.refreshOracle()
    }
  }, 150_000)
})

// ── Typed errors + no-provider ────────────────────────────────────────────────

describe('@musd-kit/react, typed errors + provider guard', () => {
  it('useOpenTrove surfaces BelowMinimumDebt (a MusdError) for a sub-minimum draw', async () => {
    const config = makeConfig(rpcUrl, [holder.address])
    const wrapper = makeWrapper(config, newQueryClient())
    await connect(config, { connector: config.connectors[0]! })
    await connectFork().refreshOracle()
    const { result } = renderHook(() => ({ open: useOpenTrove(), wallet: useWalletClient() }), {
      wrapper,
    })
    await waitFor(() => expect(result.current.wallet.data).toBeTruthy(), { timeout: 30_000 })
    act(() => result.current.open.openTrove({ collateral: BTC, debt: 100n * MUSD }))
    await waitFor(() => expect(result.current.open.isError).toBe(true), { timeout: 30_000 })
    expect(result.current.open.error).toBeInstanceOf(BelowMinimumDebt)
  }, 60_000)

  it('a write with no connected wallet surfaces MissingWalletClient (not a render throw)', async () => {
    // A config with the connector present but NOT connected → no walletClient.
    const wrapper = makeWrapper(makeConfig(rpcUrl, [holder.address]), newQueryClient())
    const { result } = renderHook(() => useOpenTrove(), { wrapper })
    act(() => result.current.openTrove({ collateral: BTC, debt: 5_000n * MUSD }))
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 30_000 })
    expect(result.current.error).toBeInstanceOf(MissingWalletClient)
  }, 60_000)

  it('a hook outside WagmiProvider/QueryClientProvider fails clearly (wagmi native throw)', () => {
    // No wrapper → wagmi's useConfig throws synchronously on render.
    expect(() => renderHook(() => useOraclePrice())).toThrow()
  })
})
