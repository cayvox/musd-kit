import { zeroAddress } from 'viem'
import { getAddresses, sortedTrovesAbi } from '../../src'
import type { ForkHandle } from './anvil'
import { startFork } from './anvil'

/**
 * Vitest globalSetup: boot ONE shared anvil fork of Mezo for the whole suite,
 * expose its RPC URL to tests via `process.env.MUSD_FORK_RPC_URL` (read by
 * {@link ./index.ts `connectFork`}), and tear it down cleanly afterwards so no
 * anvil process is orphaned.
 */
let fork: ForkHandle | undefined

/**
 * Pull EVERY SortedTroves node's upstream state into anvil's fork cache, once, for the
 * whole suite (MK-021).
 *
 * `findInsertPosition` with a near-zero NICR and no hints starts at the list head and
 * descends until it runs out of list, comparing `getNominalICR` at each step. So this one
 * `eth_call` walks the entire list and touches both the SortedTroves node structs and the
 * TroveManager trove data behind them. On a cold fork each first touch is a separate
 * `eth_getStorageAt` to the upstream RPC, measured at ~849 of them, sequential, for a
 * single hint computation; once cached the same work is milliseconds.
 *
 * Warming the WHOLE list rather than one position is deliberate. An earlier attempt warmed
 * a single `computeHints` call and a cold run still timed out, because the list is mutated
 * by the phases that open Troves: `getSize()` grows, `trialsForSize` returns a different
 * trial count, `getApproxHint` therefore samples a DIFFERENT node set, and those nodes were
 * still cold. Traversing everything is immune to that, because it is a superset of any
 * sample or traversal a later phase can produce. Troves opened during the run are local
 * anvil state and need no upstream fetch at all.
 *
 * This used to live in a `beforeAll` inside `phase3.fork.test.ts` under a fixed 180s
 * budget. Latency is not a per-file concern and that budget sat inside the range the cold
 * path actually occupies, so overruns skipped all six phase 3 tests and reported a slow
 * network as an untested hint module. Here the cost is paid once, is attributed to the
 * harness rather than to one phase, is visible in the log, and is bounded by nothing:
 * vitest does not impose a timeout on globalSetup, so a slow cold run is slow instead of
 * red. anvil's on-disk cache (see `stopFork` in `anvil.ts`) makes every subsequent run on
 * the same machine and block warm.
 */
async function warmForkState(handle: ForkHandle): Promise<void> {
  const started = Date.now()
  const { sortedTroves } = getAddresses(31611)

  const size = await handle.publicClient.readContract({
    address: sortedTroves,
    abi: sortedTrovesAbi,
    functionName: 'getSize',
  })
  // NICR 1 is below every real position, so the walk cannot stop early.
  await handle.publicClient.readContract({
    address: sortedTroves,
    abi: sortedTrovesAbi,
    functionName: 'findInsertPosition',
    args: [1n, zeroAddress, zeroAddress],
  })

  console.log(`[harness] fork state warmed in ${Date.now() - started}ms (${size} sorted Troves)`)
}

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

  await warmForkState(fork)
}

export async function teardown(): Promise<void> {
  await fork?.stopFork()
  fork = undefined
}
