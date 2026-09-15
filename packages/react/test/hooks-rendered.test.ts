import {
  InsufficientMusdBalance,
  MissingWalletClient,
  type MusdClient,
  UnsupportedChain,
} from '@musd-kit/core'
import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { custom } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createConfig } from 'wagmi'
import { mezoTestnet } from '../../core/test/harness/constants'
import { makeWrapper, newQueryClient } from './wagmi'

/**
 * The React package, RENDERED, with no chain (MK-102, MK-106, MK-100).
 *
 * **What is real and what is not.** React, TanStack Query, the wagmi context, every hook, the query
 * keys and `useMusdQuery` are real. Four things are replaced: `useMusdClient`, so the hooks receive
 * a recording client instead of building one over a transport; `useAccount`, so a test can connect,
 * switch and disconnect a wallet; `useBlockNumber`, so a new block arrives when a test says so and
 * not on a timer; and the transport under the wagmi config, so nothing reaches a network. The
 * recording client returns an answer derived from its arguments, so a hook that forwards the wrong
 * argument, or serves the answer to a different question, shows up as the wrong data.
 *
 * **Why this file exists.** The React layer's defects have all been in what a hook hands the core or
 * what it shows while the core has not answered: MK-085 was the arguments, MK-102 was stale data
 * under `status: 'success'`. A core test cannot see either (MK-087). Runs in the `unit` project.
 */

const CHAIN_ID = 31611
const OWNER = '0x000000000000000000000000000000000000dEaD' as const
const OTHER = '0x000000000000000000000000000000000000bEEF' as const
const CONNECTED = '0x00000000000000000000000000000000000000c1' as const
const EXPLICIT = '0x00000000000000000000000000000000000000e1' as const
const BTC = 10n ** 18n
const MUSD = 10n ** 18n

const state: {
  account: `0x${string}` | undefined
  client: MusdClient | null
  clientError: Error | null
  blockNumber: bigint | undefined
} = {
  account: undefined,
  client: null,
  clientError: null,
  blockNumber: undefined,
}

/** Every call the hooks made, with its arguments, in order. */
const calls: { method: string; args: unknown[] }[] = []
/** Methods whose next answers are held until {@link release} is called. */
const held = new Map<string, (() => void)[]>()

function hold(method: string) {
  if (!held.has(method)) held.set(method, [])
}
function release(method: string) {
  for (const resume of held.get(method) ?? []) resume()
  held.delete(method)
}

function recorded<T>(method: string, answer: (...args: never[]) => T) {
  return (...args: unknown[]) => {
    calls.push({ method, args })
    const value = (answer as (...a: unknown[]) => T)(...args)
    const waiters = held.get(method)
    if (waiters) return new Promise<T>((resolve) => waiters.push(() => resolve(value)))
    return Promise.resolve(value)
  }
}

const countOf = (method: string) => calls.filter((c) => c.method === method).length

function makeClient(): MusdClient {
  return {
    getTrove: recorded('getTrove', (a: string) => ({
      owner: a,
      healthFactor: a === OWNER ? 1.5 : 2.5,
      liquidationPrice: a === OWNER ? 1n : 2n,
    })),
    getBorrowingPower: recorded('getBorrowingPower', (p: { collateral: bigint }) => ({
      ceiling: p.collateral * 100n,
    })),
    drawForMargin: recorded(
      'drawForMargin',
      (p: { collateral: bigint; priceFallBps: bigint; horizonSeconds: bigint }) => ({
        ceiling: p.collateral * 100n,
        draw: p.collateral * (100n - p.priceFallBps / 100n),
        margin: { priceFallBps: p.priceFallBps, horizonSeconds: p.horizonSeconds },
      }),
    ),
    previewBorrow: recorded('previewBorrow', (p: { amount: bigint }) => ({
      amount: p.amount,
      viable: p.amount < 1_000n * MUSD,
    })),
    getBorrowingCapacity: recorded('getBorrowingCapacity', (o: string) => ({
      owner: o,
      remaining: 7n,
    })),
    previewRefinance: recorded('previewRefinance', (o: string) => ({ owner: o, viable: true })),
    getOraclePrice: recorded('getOraclePrice', () => 77_000n * MUSD),
    balanceOf: recorded('balanceOf', (a: string) => (a === OWNER ? 5n : 6n)),
    previewAdjustTrove: recorded('previewAdjustTrove', (p: unknown) => ({ params: p })),
    previewWithdrawCollateral: recorded('previewWithdrawCollateral', (p: { amount: bigint }) => ({
      amount: p.amount,
    })),
    maxWithdrawableCollateral: recorded('maxWithdrawableCollateral', (o: string) => ({
      owner: o,
      amount: 3n,
    })),
    previewClose: recorded('previewClose', (o: string) => ({ owner: o, viable: false })),
    previewRedeem: recorded('previewRedeem', (p: { amount: bigint }) => ({ amount: p.amount })),
    openTrove: recorded('openTrove', () => ({ hash: '0x01' })),
    addCollateral: recorded('addCollateral', () => ({ hash: '0x02' })),
    borrow: recorded('borrow', () => ({ hash: '0x03' })),
    repay: recorded('repay', () => ({ hash: '0x04' })),
    withdrawCollateral: recorded('withdrawCollateral', () => ({ hash: '0x05' })),
    adjustTrove: recorded('adjustTrove', () => ({ hash: '0x06' })),
    close: recorded('close', () => ({ hash: '0x07' })),
    claim: recorded('claim', () => ({ hash: null })),
    refinance: recorded('refinance', () => ({ hash: '0x09' })),
    redeem: recorded('redeem', () => ({ hash: '0x0a', truncatedAmount: 1n })),
  } as unknown as MusdClient
}

vi.mock('../src/internal/useMusdClient', () => ({
  useMusdClient: () => ({ client: state.client, error: state.clientError }),
}))
vi.mock('wagmi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('wagmi')>()
  return {
    ...actual,
    useAccount: () => ({ address: state.account }),
    useBlockNumber: () => ({ data: state.blockNumber }),
  }
})

// Imported AFTER the mocks so the hooks bind to them.
const reads = await import('../src/hooks/reads')
const writes = await import('../src/hooks/writes')

function offlineConfig() {
  return createConfig({
    chains: [mezoTestnet],
    transports: {
      [mezoTestnet.id]: custom({
        request: async ({ method }: { method: string }) => {
          if (method === 'eth_chainId') return `0x${CHAIN_ID.toString(16)}`
          if (method === 'eth_blockNumber') return '0x1'
          throw new Error(`offline config: unexpected ${method}`)
        },
      }),
    },
  })
}

function setup(queryClient: QueryClient = newQueryClient()) {
  state.client = makeClient()
  return { wrapper: makeWrapper(offlineConfig(), queryClient), queryClient }
}

afterEach(() => {
  cleanup()
  calls.length = 0
  held.clear()
  state.account = undefined
  state.client = null
  state.clientError = null
  state.blockNumber = undefined
})

describe('MK-102, a hook shows only the answer to the question currently asked', () => {
  it('a changed key is pending with no data until it answers, rather than showing the last answer', async () => {
    const { wrapper } = setup()
    const { result, rerender } = renderHook(
      (p: { amount: bigint | undefined }) =>
        reads.useBorrowPreview({ owner: OWNER, amount: p.amount }),
      {
        wrapper,
        initialProps: { amount: 10n * MUSD },
      },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect((result.current.data as unknown as { amount: bigint }).amount).toBe(10n * MUSD)

    hold('previewBorrow')
    rerender({ amount: 5_000n * MUSD })
    await waitFor(() => expect(countOf('previewBorrow')).toBe(2))
    // Before the fix `placeholderData: keepPreviousData` served the verdict for 10 MUSD here, with
    // `status: 'success'`, under a question about 5,000.
    expect(result.current.data, 'no answer to the new question yet').toBeUndefined()
    expect(result.current.isSuccess).toBe(false)
    expect(result.current.isPending).toBe(true)
    expect(result.current.isPlaceholderData).toBe(false)

    act(() => release('previewBorrow'))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect((result.current.data as unknown as { amount: bigint; viable: boolean }).viable).toBe(
      false,
    )
  })

  it('a disabled query reports nothing, whatever sits under its key', async () => {
    const { wrapper } = setup()
    const { result, rerender } = renderHook(
      (p: { amount: bigint | undefined }) =>
        reads.useBorrowPreview({ owner: OWNER, amount: p.amount }),
      {
        wrapper,
        initialProps: { amount: (10n * MUSD) as bigint | undefined },
      },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    // The input was cleared.
    rerender({ amount: undefined })
    expect(result.current.data).toBeUndefined()
    expect(result.current.isSuccess).toBe(false)
    expect(result.current.status).toBe('pending')
    expect(result.current.error).toBeNull()
    expect(countOf('previewBorrow'), 'and nothing was asked').toBe(1)
  })

  it('returning to a key asked earlier does not serve its old answer as current (gcTime 0)', async () => {
    // A client WITHOUT the test default `gcTime: 0`, so the only thing that can drop the old entry is
    // the hook's own setting.
    const { wrapper } = setup(new QueryClient({ defaultOptions: { queries: { retry: false } } }))
    const { result, rerender } = renderHook(
      (p: { amount: bigint }) => reads.useRedeemPreview({ redeemer: OWNER, amount: p.amount }),
      {
        wrapper,
        initialProps: { amount: 1n },
      },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    rerender({ amount: 2n })
    await waitFor(() =>
      expect((result.current.data as unknown as { amount: bigint } | undefined)?.amount).toBe(2n),
    )
    await new Promise((resolve) => setTimeout(resolve, 20))

    hold('previewRedeem')
    rerender({ amount: 1n })
    await waitFor(() => expect(countOf('previewRedeem')).toBe(3))
    expect(result.current.data, 'the answer for 1 from before is not current').toBeUndefined()
    expect(result.current.isSuccess).toBe(false)
    act(() => release('previewRedeem'))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('a query disabled under the SAME key, because the client went away, shows nothing', async () => {
    // Every other disabled case also changes the key, and a new key has no data anyway. This one
    // keeps the key and loses the client, so the cache still holds an answer under it, and only the
    // disabled override stands between that answer and the screen.
    const { wrapper } = setup()
    const { result, rerender } = renderHook(() => reads.useOraclePrice(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    state.client = null
    rerender()
    expect(result.current.data).toBeUndefined()
    expect(result.current.isSuccess).toBe(false)
    expect(result.current.status).toBe('pending')
  })

  it("a disconnected wallet does not keep the previous account's Trove", async () => {
    const { wrapper } = setup()
    const { result, rerender } = renderHook(
      (p: { address: `0x${string}` | undefined }) => reads.useTrove(p),
      {
        wrapper,
        initialProps: { address: OWNER as `0x${string}` | undefined },
      },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    rerender({ address: undefined })
    expect(result.current.data).toBeUndefined()
    expect(result.current.isSuccess).toBe(false)
  })

  it('a client error is the error, with no data and no fetch', async () => {
    setup()
    state.client = null
    state.clientError = new UnsupportedChain(1)
    const { result } = renderHook(() => reads.useOraclePrice(), {
      wrapper: makeWrapper(offlineConfig(), newQueryClient()),
    })
    expect(result.current.status).toBe('error')
    expect(result.current.isError).toBe(true)
    expect(result.current.error).toBeInstanceOf(UnsupportedChain)
    expect(result.current.data).toBeUndefined()
    expect(calls).toEqual([])
  })

  it('a new block refetches the SAME key and keeps its answer visible while it does', async () => {
    const { wrapper } = setup()
    // The fields are read DURING render, as a component would read them. TanStack re-renders only
    // for the result properties that have been read, so reading `isFetching` for the first time
    // after it changed would observe a render that never happened.
    const { result, rerender } = renderHook(
      () => {
        const q = reads.useMusdBalance({ address: OWNER })
        return { data: q.data, isFetching: q.isFetching, isSuccess: q.isSuccess }
      },
      { wrapper },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(countOf('balanceOf')).toBe(1)
    hold('balanceOf')
    state.blockNumber = 2n
    rerender()
    await waitFor(() => expect(countOf('balanceOf')).toBe(2))
    await waitFor(() => expect(result.current.isFetching).toBe(true))
    expect(
      result.current.data,
      'the same question one block earlier is still an answer to it',
    ).toBe(5n)
    expect(result.current.isSuccess).toBe(true)
    act(() => release('balanceOf'))
  })
})

describe('the read hooks, rendered: each asks the core exactly its question', () => {
  const cases: {
    name: string
    render: () => { data?: unknown; isSuccess: boolean }
    method: string
    args: unknown[]
    data: unknown
  }[] = [
    {
      name: 'useTrove',
      render: () => reads.useTrove({ address: OWNER }),
      method: 'getTrove',
      args: [OWNER],
      data: { owner: OWNER, healthFactor: 1.5, liquidationPrice: 1n },
    },
    {
      name: 'useHealthFactor',
      render: () => reads.useHealthFactor({ address: OWNER }),
      method: 'getTrove',
      args: [OWNER],
      data: 1.5,
    },
    {
      name: 'useLiquidationPrice',
      render: () => reads.useLiquidationPrice({ address: OWNER }),
      method: 'getTrove',
      args: [OWNER],
      data: 1n,
    },
    {
      name: 'useBorrowPreview',
      render: () => reads.useBorrowPreview({ owner: OWNER, amount: 7n }),
      method: 'previewBorrow',
      args: [{ owner: OWNER, amount: 7n }],
      data: { amount: 7n, viable: true },
    },
    {
      name: 'useBorrowingCapacity',
      render: () => reads.useBorrowingCapacity({ owner: OWNER }),
      method: 'getBorrowingCapacity',
      args: [OWNER],
      data: { owner: OWNER, remaining: 7n },
    },
    {
      name: 'useRefinancePreview',
      render: () => reads.useRefinancePreview({ owner: OWNER }),
      method: 'previewRefinance',
      args: [OWNER],
      data: { owner: OWNER, viable: true },
    },
    {
      name: 'useOraclePrice',
      render: () => reads.useOraclePrice(),
      method: 'getOraclePrice',
      args: [],
      data: 77_000n * MUSD,
    },
    {
      name: 'useMusdBalance',
      render: () => reads.useMusdBalance({ address: OTHER }),
      method: 'balanceOf',
      args: [OTHER],
      data: 6n,
    },
    {
      name: 'useAdjustTrovePreview',
      render: () => reads.useAdjustTrovePreview({ owner: OWNER, repayDebt: 9n }),
      method: 'previewAdjustTrove',
      args: [{ owner: OWNER, repayDebt: 9n }],
      data: { params: { owner: OWNER, repayDebt: 9n } },
    },
    {
      name: 'useWithdrawCollateralPreview',
      render: () => reads.useWithdrawCollateralPreview({ owner: OWNER, amount: 4n }),
      method: 'previewWithdrawCollateral',
      args: [{ owner: OWNER, amount: 4n }],
      data: { amount: 4n },
    },
    {
      name: 'useMaxWithdrawableCollateral',
      render: () => reads.useMaxWithdrawableCollateral({ owner: OWNER }),
      method: 'maxWithdrawableCollateral',
      args: [OWNER],
      data: { owner: OWNER, amount: 3n },
    },
    {
      name: 'useClosePreview',
      render: () => reads.useClosePreview({ owner: OWNER }),
      method: 'previewClose',
      args: [OWNER],
      data: { owner: OWNER, viable: false },
    },
    {
      name: 'useRedeemPreview',
      render: () => reads.useRedeemPreview({ redeemer: OWNER, amount: 11n }),
      method: 'previewRedeem',
      args: [{ redeemer: OWNER, amount: 11n }],
      data: { amount: 11n },
    },
  ]
  for (const c of cases) {
    it(`${c.name} forwards its arguments and returns the answer`, async () => {
      const { wrapper } = setup()
      const { result } = renderHook(c.render, { wrapper })
      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(calls).toEqual([{ method: c.method, args: c.args }])
      expect(result.current.data).toEqual(c.data)
    })
  }

  const disabled: { name: string; render: () => { data?: unknown; status?: string } }[] = [
    { name: 'useTrove without an address', render: () => reads.useTrove({ address: undefined }) },
    {
      name: 'useBorrowPreview without an amount',
      render: () => reads.useBorrowPreview({ owner: OWNER, amount: undefined }),
    },
    {
      name: 'useBorrowPreview without an owner',
      render: () => reads.useBorrowPreview({ owner: undefined, amount: 1n }),
    },
    {
      name: 'useBorrowingCapacity without an owner',
      render: () => reads.useBorrowingCapacity({ owner: undefined }),
    },
    {
      name: 'useRefinancePreview without an owner',
      render: () => reads.useRefinancePreview({ owner: undefined }),
    },
    {
      name: 'useMusdBalance without an address',
      render: () => reads.useMusdBalance({ address: undefined }),
    },
    {
      name: 'useAdjustTrovePreview without an owner',
      render: () => reads.useAdjustTrovePreview({ owner: undefined, addCollateral: 1n }),
    },
    {
      name: 'useWithdrawCollateralPreview without an amount',
      render: () => reads.useWithdrawCollateralPreview({ owner: OWNER, amount: undefined }),
    },
    {
      name: 'useMaxWithdrawableCollateral without an owner',
      render: () => reads.useMaxWithdrawableCollateral({ owner: undefined }),
    },
    {
      name: 'useClosePreview without an owner',
      render: () => reads.useClosePreview({ owner: undefined }),
    },
    {
      name: 'useRedeemPreview without an amount',
      render: () => reads.useRedeemPreview({ redeemer: OWNER, amount: undefined }),
    },
    {
      name: 'useBorrowingPower at zero collateral',
      render: () => reads.useBorrowingPower({ collateral: 0n }),
    },
    {
      name: 'useBorrowingPower without collateral',
      render: () => reads.useBorrowingPower({ collateral: undefined }),
    },
    {
      name: 'MK-240 useDrawForMargin without a horizon',
      render: () =>
        reads.useDrawForMargin({ collateral: BTC, horizonSeconds: undefined, priceFallBps: 200n }),
    },
    {
      name: 'MK-240 useDrawForMargin without a price fall',
      render: () =>
        reads.useDrawForMargin({ collateral: BTC, horizonSeconds: 3600n, priceFallBps: undefined }),
    },
    {
      name: 'MK-240 useDrawForMargin without collateral',
      render: () =>
        reads.useDrawForMargin({
          collateral: undefined,
          horizonSeconds: 3600n,
          priceFallBps: 200n,
        }),
    },
    {
      name: 'MK-240 useDrawForMargin at zero collateral',
      render: () =>
        reads.useDrawForMargin({ collateral: 0n, horizonSeconds: 3600n, priceFallBps: 200n }),
    },
  ]
  for (const d of disabled) {
    it(`${d.name} asks nothing and shows nothing`, async () => {
      const { wrapper } = setup()
      const { result } = renderHook(d.render, { wrapper })
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(calls).toEqual([])
      expect(result.current.data).toBeUndefined()
      expect(result.current.status).toBe('pending')
    })
  }

  it('useTrove, useHealthFactor and useLiquidationPrice for one address share ONE fetch', async () => {
    const { wrapper } = setup()
    const { result } = renderHook(
      () => ({
        trove: reads.useTrove({ address: OWNER }),
        hf: reads.useHealthFactor({ address: OWNER }),
        liq: reads.useLiquidationPrice({ address: OWNER }),
      }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.liq.isSuccess).toBe(true))
    expect(countOf('getTrove')).toBe(1)
  })
})

describe('MK-100, MK-106, MK-240: the borrowing power hooks, rendered', () => {
  it('MK-240: useBorrowingPower data is the ceiling result, never a bare amount to borrow', async () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => reads.useBorrowingPower({ collateral: BTC }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(typeof result.current.data, 'a bare number reads as an answer').toBe('object')
    expect(result.current.data).toEqual({ ceiling: BTC * 100n })
    expect(calls.map((c) => c.method)).toEqual(['getBorrowingPower'])
  })

  it('MK-240: useDrawForMargin forwards the margin the caller chose, and each margin is its own question', async () => {
    const { wrapper } = setup()
    const { result } = renderHook(
      () => ({
        day: reads.useDrawForMargin({
          collateral: BTC,
          horizonSeconds: 86_400n,
          priceFallBps: 500n,
        }),
        week: reads.useDrawForMargin({
          collateral: BTC,
          horizonSeconds: 604_800n,
          priceFallBps: 1_000n,
        }),
        none: reads.useDrawForMargin({ collateral: BTC, horizonSeconds: 0n, priceFallBps: 0n }),
      }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.day.isSuccess).toBe(true))
    await waitFor(() => expect(result.current.week.isSuccess).toBe(true))
    await waitFor(() => expect(result.current.none.isSuccess).toBe(true))
    const asked = calls.filter((c) => c.method === 'drawForMargin').map((c) => c.args[0])
    // Three margins, three fetches: sharing one would show one margin's answer as another's. A zero
    // margin is a margin, and is asked, not treated as absent.
    expect(asked).toHaveLength(3)
    expect(asked).toContainEqual({ collateral: BTC, horizonSeconds: 86_400n, priceFallBps: 500n })
    expect(asked).toContainEqual({
      collateral: BTC,
      horizonSeconds: 604_800n,
      priceFallBps: 1_000n,
    })
    expect(asked).toContainEqual({ collateral: BTC, horizonSeconds: 0n, priceFallBps: 0n })
    expect(result.current.day.data?.margin).toEqual({ horizonSeconds: 86_400n, priceFallBps: 500n })
  })

  it('an omitted account is the CONNECTED wallet, not "not exempt" (MK-106)', async () => {
    state.account = CONNECTED
    const { wrapper } = setup()
    const { result } = renderHook(() => reads.useBorrowingPower({ collateral: BTC }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(calls).toEqual([
      { method: 'getBorrowingPower', args: [{ collateral: BTC, account: CONNECTED }] },
    ])
  })

  it('MK-106: useDrawForMargin also defaults the account to the connected wallet', async () => {
    state.account = CONNECTED
    const { wrapper } = setup()
    const { result } = renderHook(
      () => reads.useDrawForMargin({ collateral: BTC, horizonSeconds: 3600n, priceFallBps: 200n }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(calls).toEqual([
      {
        method: 'drawForMargin',
        args: [{ collateral: BTC, horizonSeconds: 3600n, priceFallBps: 200n, account: CONNECTED }],
      },
    ])
  })

  it('an explicit account wins over the connected wallet', async () => {
    state.account = CONNECTED
    const { wrapper } = setup()
    const { result } = renderHook(
      () => reads.useBorrowingPower({ collateral: BTC, account: EXPLICIT }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(calls).toEqual([
      { method: 'getBorrowingPower', args: [{ collateral: BTC, account: EXPLICIT }] },
    ])
  })

  it('with no wallet and no account, the account is absent rather than undefined', async () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => reads.useBorrowingPower({ collateral: BTC }), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(calls[0]?.args[0]).toEqual({ collateral: BTC })
    expect(Object.keys(calls[0]?.args[0] as object)).toEqual(['collateral'])
  })

  it('switching the wallet asks again for the new account instead of showing the old answer', async () => {
    state.account = CONNECTED
    const { wrapper } = setup()
    const { result, rerender } = renderHook(() => reads.useBorrowingPower({ collateral: BTC }), {
      wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    hold('getBorrowingPower')
    state.account = EXPLICIT
    rerender()
    await waitFor(() => expect(countOf('getBorrowingPower')).toBe(2))
    expect(result.current.data).toBeUndefined()
    expect(calls[1]?.args[0]).toEqual({ collateral: BTC, account: EXPLICIT })
    act(() => release('getBorrowingPower'))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })
})

describe('the write hooks, rendered', () => {
  const actions: {
    name: string
    run: (h: never) => Promise<unknown>
    use: () => unknown
    method: string
    args: unknown[]
    hash: string | null
  }[] = [
    {
      name: 'useOpenTrove',
      use: writes.useOpenTrove,
      run: (h: ReturnType<typeof writes.useOpenTrove>) =>
        h.openTroveAsync({ collateral: BTC, debt: 2_000n * MUSD }),
      method: 'openTrove',
      args: [{ collateral: BTC, debt: 2_000n * MUSD }],
      hash: '0x01',
    },
    {
      name: 'useAddCollateral',
      use: writes.useAddCollateral,
      run: (h: ReturnType<typeof writes.useAddCollateral>) => h.addCollateralAsync({ amount: 1n }),
      method: 'addCollateral',
      args: [{ amount: 1n }],
      hash: '0x02',
    },
    {
      name: 'useBorrow',
      use: writes.useBorrow,
      run: (h: ReturnType<typeof writes.useBorrow>) => h.borrowAsync({ amount: 2n }),
      method: 'borrow',
      args: [{ amount: 2n }],
      hash: '0x03',
    },
    {
      name: 'useRepay',
      use: writes.useRepay,
      run: (h: ReturnType<typeof writes.useRepay>) => h.repayAsync({ amount: 3n }),
      method: 'repay',
      args: [{ amount: 3n }],
      hash: '0x04',
    },
    {
      name: 'useWithdrawCollateral',
      use: writes.useWithdrawCollateral,
      run: (h: ReturnType<typeof writes.useWithdrawCollateral>) =>
        h.withdrawCollateralAsync({ amount: 4n }),
      method: 'withdrawCollateral',
      args: [{ amount: 4n }],
      hash: '0x05',
    },
    {
      name: 'useAdjustTrove',
      use: writes.useAdjustTrove,
      run: (h: ReturnType<typeof writes.useAdjustTrove>) => h.adjustTroveAsync({ repay: 5n }),
      method: 'adjustTrove',
      args: [{ repay: 5n }],
      hash: '0x06',
    },
    {
      name: 'useCloseTrove',
      use: writes.useCloseTrove,
      run: (h: ReturnType<typeof writes.useCloseTrove>) => h.closeTroveAsync(),
      method: 'close',
      args: [],
      hash: '0x07',
    },
    {
      name: 'useClaimCollateral',
      use: writes.useClaimCollateral,
      run: (h: ReturnType<typeof writes.useClaimCollateral>) => h.claimAsync(),
      method: 'claim',
      args: [],
      hash: null,
    },
    {
      name: 'useRefinance',
      use: writes.useRefinance,
      run: (h: ReturnType<typeof writes.useRefinance>) => h.refinanceAsync(),
      method: 'refinance',
      args: [],
      hash: '0x09',
    },
    {
      name: 'useRedeem',
      use: writes.useRedeem,
      run: (h: ReturnType<typeof writes.useRedeem>) => h.redeemAsync({ amount: 6n }),
      method: 'redeem',
      args: [{ amount: 6n }],
      hash: '0x0a',
    },
  ] as never
  for (const a of actions) {
    it(`${a.name} sends exactly its parameters to core ${a.method} and exposes the result`, async () => {
      const { wrapper } = setup()
      const { result } = renderHook(a.use, { wrapper })
      await act(async () => {
        await a.run(result.current as never)
      })
      await waitFor(() => expect((result.current as { isSuccess: boolean }).isSuccess).toBe(true))
      // `close`, `claim` and `refinance` take no parameters; TanStack hands `mutationFn` an
      // `undefined` variable for them, which the hook must not forward as an argument.
      const call = calls.find((c) => c.method === a.method)
      expect(call?.args.filter((x) => x !== undefined)).toEqual(a.args)
      expect((result.current as { hash: string | null }).hash).toBe(a.hash)
    })
  }

  it('the named fire-and-forget actions send too', async () => {
    const { wrapper } = setup()
    const { result } = renderHook(
      () => ({
        close: writes.useCloseTrove(),
        claim: writes.useClaimCollateral(),
        refi: writes.useRefinance(),
      }),
      { wrapper },
    )
    act(() => {
      result.current.close.closeTrove()
      result.current.claim.claim()
      result.current.refi.refinance()
    })
    await waitFor(() => expect(result.current.refi.isSuccess).toBe(true))
    expect(countOf('close') + countOf('claim') + countOf('refinance')).toBe(3)
  })

  it("a core refusal arrives as the core's typed error", async () => {
    const { wrapper } = setup()
    const refusal = new InsufficientMusdBalance(10n, 1n)
    ;(state.client as unknown as { repay: () => Promise<never> }).repay = () =>
      Promise.reject(refusal)
    const { result } = renderHook(() => writes.useRepay(), { wrapper })
    act(() => result.current.repay({ amount: 10n }))
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBe(refusal)
    expect(result.current.hash).toBeNull()
  })

  it('with no client, a write reports MissingWalletClient through error rather than throwing on render', async () => {
    const wrapper = makeWrapper(offlineConfig(), newQueryClient())
    const { result } = renderHook(() => writes.useBorrow(), { wrapper })
    act(() => result.current.borrow({ amount: 1n }))
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(MissingWalletClient)
  })

  it('MK-102: switching the account clears the previous account’s hash and success, and a re-render does not', async () => {
    state.account = CONNECTED
    const { wrapper } = setup()
    const { result, rerender } = renderHook(() => writes.useBorrow(), { wrapper })
    await act(async () => {
      await result.current.borrowAsync({ amount: 1n })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    rerender()
    expect(result.current.hash, 'the same account re-rendering keeps its own result').toBe('0x03')

    state.account = OTHER
    rerender()
    await waitFor(() => expect(result.current.isSuccess).toBe(false))
    expect(result.current.hash).toBeNull()
    expect(result.current.data).toBeUndefined()
  })

  it("a successful write refreshes the sender's Trove and balance", async () => {
    state.account = OWNER
    const { wrapper } = setup()
    const { result } = renderHook(
      () => ({
        trove: reads.useTrove({ address: OWNER }),
        balance: reads.useMusdBalance({ address: OWNER }),
        repay: writes.useRepay(),
      }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.balance.isSuccess).toBe(true))
    await waitFor(() => expect(result.current.trove.isSuccess).toBe(true))
    const troves = countOf('getTrove')
    const balances = countOf('balanceOf')
    await act(async () => {
      await result.current.repay.repayAsync({ amount: 1n })
    })
    await waitFor(() => expect(countOf('getTrove')).toBeGreaterThan(troves))
    await waitFor(() => expect(countOf('balanceOf')).toBeGreaterThan(balances))
  })
})
