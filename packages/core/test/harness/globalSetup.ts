import type { ForkHandle } from './anvil'
import { startFork } from './anvil'

/**
 * Vitest globalSetup: boot ONE shared anvil fork of Mezo for the whole suite,
 * expose its RPC URL to tests via `process.env.MUSD_FORK_RPC_URL` (read by
 * {@link ./index.ts `connectFork`}), and tear it down cleanly afterwards so no
 * anvil process is orphaned.
 */
let fork: ForkHandle | undefined

export async function setup(): Promise<void> {
  fork = await startFork()
  process.env.MUSD_FORK_RPC_URL = fork.rpcUrl

  const { answer, roundId, decimals } = fork.seededPrice
  console.log(`[harness] anvil fork ready at ${fork.rpcUrl}, block ${fork.forkBlockNumber}`)
  console.log(
    `[harness] oracle shim seeded with real round data: answer=${answer} ` +
      `(decimals=${decimals}, roundId=${roundId})`,
  )
}

export async function teardown(): Promise<void> {
  await fork?.stopFork()
  fork = undefined
}
