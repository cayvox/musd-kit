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

  const { answer, roundId, decimals, sourceBlock, source } = fork.seededPrice
  console.log(`[harness] anvil fork ready at ${fork.rpcUrl}, block ${fork.forkBlockNumber}`)
  // Print the seed AND the block it came from. Both are inputs to every price-dependent
  // assertion in the fork suite, so a future divergence should be readable straight off
  // the log rather than reconstructed from a failure (MK-020).
  console.log(
    `[harness] oracle shim seeded from ${source} at block ${sourceBlock}: answer=${answer} ` +
      `(decimals=${decimals}, roundId=${roundId})`,
  )
  if (sourceBlock !== fork.forkBlockNumber) {
    console.warn(
      `[harness] WARNING: oracle seed block ${sourceBlock} differs from the fork block ` +
        `${fork.forkBlockNumber}; the price does not correspond to the forked state.`,
    )
  }
}

export async function teardown(): Promise<void> {
  await fork?.stopFork()
  fork = undefined
}
