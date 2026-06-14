import {
  http,
  type Address,
  type PublicClient,
  type TestClient,
  createPublicClient,
  createTestClient,
} from 'viem'
import { mezoTestnet } from './constants'
import { setPrice as setOraclePrice } from './oracle'

export { startFork } from './anvil'
export type { ForkHandle, StartForkOptions } from './anvil'
export type { SeededRoundData } from './oracle'
export {
  mezoTestnet,
  TESTNET,
  ORACLE_PRECOMPILE,
  aggregatorAbi,
} from './constants'

/** Clients + helpers bound to the shared fork booted by globalSetup. */
export interface ForkConnection {
  rpcUrl: string
  publicClient: PublicClient
  testClient: TestClient
  mineBlocks(n: number): Promise<void>
  warpTime(seconds: number | bigint): Promise<void>
  fundAccount(address: Address, btcWei: bigint): Promise<void>
  setPrice(usdPerBtc1e18: bigint): Promise<void>
}

/**
 * Connect to the single shared anvil fork that `globalSetup` booted for the suite.
 * The oracle shim is already installed and seeded on it.
 */
export function connectFork(): ForkConnection {
  const rpcUrl = process.env.MUSD_FORK_RPC_URL
  if (!rpcUrl) {
    throw new Error(
      'MUSD_FORK_RPC_URL is unset — is the harness globalSetup configured in vitest.config.ts?',
    )
  }

  const publicClient = createPublicClient({ chain: mezoTestnet, transport: http(rpcUrl) })
  const testClient = createTestClient({
    chain: mezoTestnet,
    mode: 'anvil',
    transport: http(rpcUrl),
  })

  return {
    rpcUrl,
    publicClient,
    testClient,
    mineBlocks: (n) => testClient.mine({ blocks: n }),
    warpTime: async (seconds) => {
      await testClient.increaseTime({ seconds: Number(seconds) })
      await testClient.mine({ blocks: 1 })
    },
    fundAccount: (address, btcWei) => testClient.setBalance({ address, value: btcWei }),
    setPrice: (usdPerBtc1e18) => setOraclePrice(testClient, publicClient, usdPerBtc1e18),
  }
}
