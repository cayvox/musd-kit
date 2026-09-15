import type { MusdClient } from '@musd-kit/core'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { custom } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createConfig } from 'wagmi'
import { mezoTestnet } from '../../core/test/harness/constants'
import { musdQueryKeys } from '../src'
import { makeWrapper, newQueryClient } from './wagmi'

/**
 * What a hook with no owner leaves in the query cache, what it reports, and what the adjust preview
 * hands the core for a withdrawal leg. Rendered and chain free, with the same replacements as
 * `hooks-rendered.test.ts`. Each block cites its finding.
 *
 * **Why a disabled query's key is pinned.** The keys are public (`musdQueryKeys`), and an app that
 * reads or invalidates the cache finds a disconnected hook's query under the key built with `'0x'`.
 * A key built with `undefined` would sit under a different cache entry, so the difference is visible
 * to anyone holding the `QueryClient`.
 */

const CHAIN_ID = 31611
const OWNER = '0x000000000000000000000000000000000000dEaD' as const

const state: { client: MusdClient | null; clientError: Error | null } = {
  client: null,
  clientError: null,
}
const calls: { method: string; args: unknown[] }[] = []

vi.mock('../src/internal/useMusdClient', () => ({
  useMusdClient: () => ({ client: state.client, error: state.clientError }),
}))
vi.mock('wagmi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('wagmi')>()
  return {
    ...actual,
    useAccount: () => ({ address: undefined }),
    useBlockNumber: () => ({ data: undefined }),
  }
})

const reads = await import('../src/hooks/reads')

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

function setup() {
  state.client = new Proxy({} as MusdClient, {
    get:
      (_, method: string) =>
      (...args: unknown[]) => {
        calls.push({ method, args })
        return Promise.resolve({ method })
      },
  })
  const queryClient = newQueryClient()
  return { queryClient, wrapper: makeWrapper(offlineConfig(), queryClient) }
}

afterEach(() => {
  cleanup()
  calls.length = 0
  state.client = null
  state.clientError = null
})

const keysIn = (q: ReturnType<typeof newQueryClient>) =>
  q
    .getQueryCache()
    .getAll()
    .map((x) => JSON.stringify(x.queryKey))

describe('MK-118, a hook with no owner', () => {
  const cases: [string, () => unknown, readonly unknown[]][] = [
    [
      'useBorrowPreview',
      () => reads.useBorrowPreview({ owner: undefined, amount: undefined }),
      musdQueryKeys.borrowPreview(CHAIN_ID, '0x', undefined),
    ],
    [
      'useBorrowingCapacity',
      () => reads.useBorrowingCapacity({ owner: undefined }),
      musdQueryKeys.borrowingCapacity(CHAIN_ID, '0x'),
    ],
    [
      'useRefinancePreview',
      () => reads.useRefinancePreview({ owner: undefined }),
      musdQueryKeys.refinancePreview(CHAIN_ID, '0x'),
    ],
    [
      'useAdjustTrovePreview',
      () => reads.useAdjustTrovePreview({ owner: undefined }),
      musdQueryKeys.adjustPreview(CHAIN_ID, '0x', {}),
    ],
    [
      'useWithdrawCollateralPreview',
      () => reads.useWithdrawCollateralPreview({ owner: undefined, amount: undefined }),
      musdQueryKeys.withdrawCollateralPreview(CHAIN_ID, '0x', undefined),
    ],
    [
      'useMaxWithdrawableCollateral',
      () => reads.useMaxWithdrawableCollateral({ owner: undefined }),
      musdQueryKeys.maxWithdrawable(CHAIN_ID, '0x'),
    ],
    [
      'useClosePreview',
      () => reads.useClosePreview({ owner: undefined }),
      musdQueryKeys.closePreview(CHAIN_ID, '0x'),
    ],
    [
      'useRedeemPreview',
      () => reads.useRedeemPreview({ redeemer: undefined, amount: undefined }),
      musdQueryKeys.redeemPreview(CHAIN_ID, '0x', undefined),
    ],
  ]

  for (const [name, hook, key] of cases) {
    it(`${name} registers its query under the documented key with '0x', and asks the core nothing`, () => {
      const { queryClient, wrapper } = setup()
      renderHook(hook, { wrapper })
      expect(keysIn(queryClient)).toContain(JSON.stringify(key))
      expect(calls).toEqual([])
    })
  }
})

describe('MK-118, a disabled query', () => {
  it('is pending with no client error, and not pending once the client has failed', () => {
    const { wrapper } = setup()
    const idle = renderHook(() => reads.useClosePreview({ owner: undefined }), { wrapper })
    expect(idle.result.current.isPending).toBe(true)
    cleanup()
    const second = setup()
    state.client = null
    state.clientError = new Error('unsupported chain')
    const failed = renderHook(() => reads.useClosePreview({ owner: OWNER }), {
      wrapper: second.wrapper,
    })
    expect(failed.result.current.isPending).toBe(false)
  })
})

describe('MK-118, useAdjustTrovePreview', () => {
  it('hands the core a withdrawal leg it was given, and none it was not', async () => {
    const { wrapper } = setup()
    renderHook(() => reads.useAdjustTrovePreview({ owner: OWNER, withdrawCollateral: 5n }), {
      wrapper,
    })
    await waitFor(() => expect(calls.some((c) => c.method === 'previewAdjustTrove')).toBe(true))
    expect(calls.find((c) => c.method === 'previewAdjustTrove')?.args[0]).toEqual({
      owner: OWNER,
      withdrawCollateral: 5n,
    })
    cleanup()
    calls.length = 0
    renderHook(() => reads.useAdjustTrovePreview({ owner: OWNER, addCollateral: 1n }), {
      wrapper: setup().wrapper,
    })
    await waitFor(() => expect(calls.some((c) => c.method === 'previewAdjustTrove')).toBe(true))
    expect(calls.find((c) => c.method === 'previewAdjustTrove')?.args[0]).toEqual({
      owner: OWNER,
      addCollateral: 1n,
    })
  })
})
