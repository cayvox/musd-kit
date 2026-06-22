// Fork-backed wagmi test config (docs/07 §2): a `mock` connector bound to anvil's default
// account[0] so writes actually sign + send on the shared fork. The mock connector forwards
// JSON-RPC (incl. eth_sendTransaction, which omits `from`) to `chain.rpcUrls.default.http[0]`,
// so we point that at anvil; anvil signs with its unlocked account[0]. The contracts are
// real; only the wallet plumbing is mocked (docs/07 permits this).
import { MULTICALL3_ADDRESS } from '@musd-kit/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode, createElement } from 'react'
import type { Address, Chain } from 'viem'
import { http, WagmiProvider, createConfig } from 'wagmi'
import { mock } from 'wagmi/connectors'
import { mezoTestnet } from '../../core/test/harness/constants'

/** mezoTestnet pointed at the anvil fork, with Multicall3 declared (core passes it too). */
export function forkChain(rpcUrl: string): Chain {
  return {
    ...mezoTestnet,
    rpcUrls: { default: { http: [rpcUrl] }, public: { http: [rpcUrl] } },
    contracts: { ...mezoTestnet.contracts, multicall3: { address: MULTICALL3_ADDRESS } },
  } as Chain
}

/** A wagmi config over the fork. Pass `accounts` to wire a mock connector (omit → no wallet). */
export function makeConfig(rpcUrl: string, accounts: readonly Address[] = []) {
  const chain = forkChain(rpcUrl)
  return createConfig({
    chains: [chain],
    connectors:
      accounts.length > 0
        ? [mock({ accounts: accounts as [Address, ...Address[]], features: { reconnect: true } })]
        : [],
    transports: { [chain.id]: http(rpcUrl) },
    // anvil only mines on tx; poll quickly so block-watch refetch is snappy in tests.
    pollingInterval: 250,
  })
}

export function newQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
}

/** RTL wrapper providing WagmiProvider + QueryClientProvider (no JSX, keep tooling minimal). */
export function makeWrapper(config: ReturnType<typeof makeConfig>, queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(
      WagmiProvider,
      { config },
      createElement(QueryClientProvider, { client: queryClient }, children),
    )
}
