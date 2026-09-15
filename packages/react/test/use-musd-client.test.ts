import { MissingWalletClient } from '@musd-kit/core'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { custom } from 'viem'
import { afterEach, describe, expect, it } from 'vitest'
import { createConfig } from 'wagmi'
import { connect } from 'wagmi/actions'
import { mock } from 'wagmi/connectors'
import { mezoTestnet } from '../../core/test/harness/constants'
import { useMusdClient } from '../src/internal/useMusdClient'
import { makeWrapper, newQueryClient } from './wagmi'

/**
 * `useMusdClient` over a real wagmi context, chain free. The other rendered tests replace it, so its two
 * decisions, whether there is a public client to build on and whether a connected wallet is passed to the
 * core, were exercised by nothing that runs without a chain. Each block cites its finding.
 */

const ACCOUNT = '0x00000000000000000000000000000000000000c1' as const

function config(withWallet: boolean) {
  return createConfig({
    chains: [mezoTestnet],
    connectors: withWallet ? [mock({ accounts: [ACCOUNT] })] : [],
    transports: {
      [mezoTestnet.id]: custom({
        request: async ({ method }: { method: string }) => {
          if (method === 'eth_chainId') return `0x${mezoTestnet.id.toString(16)}`
          if (method === 'eth_blockNumber') return '0x1'
          throw new Error(`offline config: unexpected ${method}`)
        },
      }),
    },
  })
}

afterEach(() => cleanup())

describe('MK-112, useMusdClient', () => {
  it('builds a client when wagmi has a public client, with no wallet when none is connected', async () => {
    const { result } = renderHook(() => useMusdClient(), {
      wrapper: makeWrapper(config(false), newQueryClient()),
    })
    expect(result.current.error).toBeNull()
    expect(result.current.client).not.toBeNull()
    await expect(
      result.current.client?.addCollateral({ amount: 1n }) ?? Promise.resolve(),
    ).rejects.toBeInstanceOf(MissingWalletClient)
  })

  it('passes a connected wallet to the core, so the client can write', async () => {
    const c = config(true)
    const { result } = renderHook(() => useMusdClient(), {
      wrapper: makeWrapper(c, newQueryClient()),
    })
    await act(async () => {
      await connect(c, { connector: c.connectors[0] as NonNullable<(typeof c.connectors)[0]> })
    })
    await waitFor(() =>
      expect(result.current.client?.contracts.borrowerOperations).toHaveProperty('write'),
    )
  })
})
