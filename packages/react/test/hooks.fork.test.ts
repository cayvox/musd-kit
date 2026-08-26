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
import { WagmiProviderNotFoundError, useWalletClient } from 'wagmi'
import { connectFork } from '../../core/test/harness'
import { mezoTestnet } from '../../core/test/harness/constants'
import { explainTransaction } from '../../core/test/harness/explainReceipt'
import { recordMitigation } from '../../core/test/harness/mitigationLog'
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
  /**
   * The typed `MusdError` the mutation failed with (MK-031). Every write hook already
   * exposes it; this helper simply never looked, so a failure was reported as "mutation
   * errored without a tx hash" with the actual reason discarded.
   */
  error: Error | null
  reset: () => void
}

/**
 * Fire a write-hook action and assert its tx actually MINED (receipt status `success`).
 *
 * **The four attempt refire is gone (MK-016).** It was measured before it was removed: over
 * ten `pnpm test:coverage` runs it was invoked 40 times and consumed `attempts=1` on all 40,
 * so it never once retried in a passing run. In the two runs where it DID fire it ran to
 * exhaustion and failed anyway, at `:157` (MK-025) and at `:261` (MK-034). A loop that never
 * helps when things are fine and never saves them when they are not is not protecting this
 * suite; it is making its stability unmeasurable, which is MK-016's whole complaint.
 *
 * What is KEPT is the receipt check, and that is not a mitigation. The core returns `{ hash }`
 * without awaiting the receipt, by design, so a revert that happens AFTER a passing simulate
 * would otherwise slip through as `isSuccess`. Asserting the receipt is the test doing its
 * job. What is gone is re-firing when that assertion fails.
 *
 * The failure report from MK-031 stays, and matters more now: with no retry, the first
 * failure is the one you read.
 */
async function ensureWriteMined(fire: () => void, mut: () => MutationSlice): Promise<void> {
  await connectFork().mineBlocks(1)
  act(() => fire())
  await waitFor(() => expect(mut().isSuccess || mut().isError).toBe(true), { timeout: 60_000 })

  const hash = mut().hash
  if (!hash) {
    const err = mut().error
    throw new Error(
      `the mutation errored before sending, no tx hash. ${
        err ? `${err.name}: ${err.message}` : 'and the hook exposed no error either'
      }`,
      err ? { cause: err } : undefined,
    )
  }

  const receipt = await connectFork().publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') {
    throw new Error(
      `tx mined but REVERTED\n${await explainTransaction(
        connectFork().publicClient,
        hash,
        'a successful receipt',
      )}`,
    )
  }
  recordMitigation({
    name: 'ensureWriteMined',
    attempts: 1,
    outcome: 'ok',
    extra: { gasUsed: receipt.gasUsed },
  })
}

beforeAll(async () => {
  const fork = connectFork()
  rpcUrl = fork.rpcUrl
  await fork.mineBlocks(1)

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
    await fork.mineBlocks(1)
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

  it('useRedeem sends and returns { hash, truncatedAmount, redemptionRate, fee amount }', async () => {
    // Same handling as the Phase-6 redemption gate: redeem at a +50% price so the lowest
    // redeemable Trove has comfortable margin, warm the slow getRedemptionHints traversal at
    // that price, and redeem 3,000, enough to close whole Troves. Price restored after.
    // MK-032: the "so it mines fresh" part of this comment is removed rather than kept, the
    // shim cannot go stale.
    const wrapper = await connectedWrapper()
    const fork = connectFork()
    const orig = await coreClient.getOraclePrice()
    const high = (orig * 3n) / 2n
    try {
      await fork.setPrice(high)
      await fork.mineBlocks(1)
      // MK-032. Report the redeemable margin BEFORE attempting the redeem, on every run,
      // passing or failing. `getRedemptionHints` returns the truncated amount actually
      // reachable, so this is the quantity that decides whether `redeemCollateral` can do
      // anything at all. This file runs LAST in the alphabetical order the sequencer imposes
      // and redeems from a tail that `phase6.fork.test.ts` has already consumed, so a run
      // where the margin is thin is the run where this test is about to fail. Logging it
      // when it passes is the point: a rate cannot be attributed from failures alone.
      const [, , redeemableNow] = await fork.publicClient.readContract({
        address: T.hintHelpers,
        abi: hintHelpersAbi,
        functionName: 'getRedemptionHints',
        args: [3_000n * MUSD, high, 100n],
      })
      const holderMusd = await coreClient.balanceOf(holder.address)
      console.log(
        `[hooks] pre-redeem margin: requested=3000e18 redeemable=${redeemableNow} holderMUSD=${holderMusd} price=${high}`,
      )
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
      // MK-014: `fee` is gone. The rate and the fee AMOUNT are separate, named fields.
      expect(result.current.redeem.data?.redemptionRate).toBeGreaterThan(0n)
      expect(result.current.redeem.data?.estimatedFeeCollateral).toBeGreaterThan(0n)
      expect(result.current.redeem.data?.estimatedCollateralDrawn).toBeGreaterThan(0n)
    } finally {
      await fork.setPrice(orig)
      await fork.mineBlocks(1)
    }
  }, 150_000)

  it('useCloseTrove sends and the Trove is gone', async () => {
    const wrapper = await connectedWrapper()
    const fork = connectFork()
    await fork.mineBlocks(1)
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
      await fork.mineBlocks(1)
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
      await fork.mineBlocks(1)
    }
  }, 150_000)
})

// ── Typed errors + no-provider ────────────────────────────────────────────────

describe('@musd-kit/react, typed errors + provider guard', () => {
  it('useOpenTrove surfaces BelowMinimumDebt (a MusdError) for a sub-minimum draw', async () => {
    const config = makeConfig(rpcUrl, [holder.address])
    const wrapper = makeWrapper(config, newQueryClient())
    await connect(config, { connector: config.connectors[0]! })
    await connectFork().mineBlocks(1)
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
    // No wrapper → wagmi's useConfig throws synchronously on render. That is the CORRECT
    // behavior and this test exists to pin it: every `@musd-kit/react` hook reaches wagmi
    // through `useMusdQuery` → `useChainId`, so a consumer rendering any of them outside a
    // provider gets this same throw. There is no SDK defect here.
    //
    // MK-033: what there WAS is a logging defect. React's development build prints an
    // "The above error occurred in the <TestComponent> component" block for an uncaught
    // render throw, and with no error boundary that block landed in the CI log from a test
    // that reported as PASSING. In a run that is already red for other reasons, an uncaught
    // WagmiProviderNotFoundError is indistinguishable from a real one, which is precisely
    // the green-signal-that-means-less condition `docs/08-conventions.md` §10 forbids.
    //
    // So the output is captured rather than silenced: if React stops logging, or logs
    // something other than the expected provider error, the assertion below fails instead of
    // quietly hiding a genuine uncaught error.
    const captured: string[] = []
    const originalError = console.error
    console.error = (...args: unknown[]) => {
      captured.push(args.map(String).join(' '))
    }
    try {
      expect(() => renderHook(() => useOraclePrice())).toThrow(WagmiProviderNotFoundError)
    } finally {
      console.error = originalError
    }
    expect(captured.join('\n')).toContain('WagmiProvider')
  })
})
