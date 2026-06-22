import { type MusdClient, createMusdClient } from '@musd-kit/core'
import { useMemo } from 'react'
import { useChainId, usePublicClient, useWalletClient } from 'wagmi'

/**
 * Build the framework-agnostic core client from the ambient wagmi context, the React
 * layer adds NO provider of its own (decision O4). Memoized so it is stable across renders
 * (all hooks share it). When the chain has no MUSD deployment, `createMusdClient` throws
 * `UnsupportedChain`; that is captured and returned in `error` rather than thrown on render,
 * so hooks can surface it the wagmi way.
 *
 * @returns `{ client, error }`, `client` is `null` until a public client is available or
 *   when the chain is unsupported (`error` then holds the `UnsupportedChain`).
 */
export function useMusdClient(): { client: MusdClient | null; error: Error | null } {
  const chainId = useChainId()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()

  return useMemo(() => {
    if (!publicClient) return { client: null, error: null }
    try {
      const client = createMusdClient({
        chainId,
        publicClient,
        ...(walletClient ? { walletClient } : {}),
      })
      return { client, error: null }
    } catch (err) {
      return { client: null, error: err as Error }
    }
  }, [chainId, publicClient, walletClient])
}
