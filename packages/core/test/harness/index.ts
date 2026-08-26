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
  /**
   * Mine `n` blocks.
   *
   * MK-032. This replaced `refreshOracle()` at all 50 call sites, which is a rename of a
   * misunderstanding rather than a change of behavior. That helper was named for keeping the
   * seeded oracle fresh and could not do it: `OracleShim.sol:24-29` returns `timestamp()`
   * for both `startedAt` and `updatedAt`, so the shim is fresh at every block by
   * construction, and the two slots it wrote (`ORACLE_SLOT.startedAt`/`.updatedAt`, slots 3
   * and 4 in `constants.ts:71-72`) are never read by `latestRoundData`. Its one real effect
   * was `testClient.mine`, which is this.
   *
   * The call sites now say what they depend on. Several of them genuinely do depend on a
   * fresh block, because a new block advances the timestamp every subsequent `eth_call` is
   * evaluated at, and that dependency was previously hidden behind a name that described
   * something else.
   */
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
      'MUSD_FORK_RPC_URL is unset, is the harness globalSetup configured in vitest.config.ts?',
    )
  }

  // Generous request timeout: a single getApproxHint() eth_call can trigger many
  // lazy upstream-state fetches inside anvil and take tens of seconds on a cold fork.
  const transport = http(rpcUrl, { timeout: 180_000 })
  const publicClient = createPublicClient({ chain: mezoTestnet, transport })
  const testClient = createTestClient({ chain: mezoTestnet, mode: 'anvil', transport })

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
