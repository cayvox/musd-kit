import {
  http,
  type Hex,
  type PublicClient,
  type TestClient,
  createPublicClient,
  numberToHex,
  toHex,
} from 'viem'
import {
  ORACLE_PRECOMPILE,
  ORACLE_SHIM_RUNTIME,
  ORACLE_SLOT,
  RECORDED_ORACLE_SEED,
  aggregatorAbi,
  mezoTestnet,
} from './constants'

/** The round data currently seeded into the fork's oracle shim. */
export interface SeededRoundData {
  decimals: number
  roundId: bigint
  /** BTC/USD, scaled by 10**decimals (decimals is 18 on Mezo → this is 1e18-scaled). */
  answer: bigint
  startedAt: bigint
  updatedAt: bigint
  answeredInRound: bigint
  /** Upstream block the round was read at. The price is a function of THIS, not of wall clock. */
  sourceBlock: bigint
  /** `chain` = read from the upstream node at {@link sourceBlock}; `recorded` = the loud fallback. */
  source: 'chain' | 'recorded'
}

async function writeSlot(client: TestClient, slot: bigint, value: bigint): Promise<void> {
  await client.setStorageAt({
    address: ORACLE_PRECOMPILE,
    index: numberToHex(slot, { size: 32 }) as Hex,
    value: toHex(value, { size: 32 }),
  })
}

/**
 * Read the REAL `decimals()` + `latestRoundData()` from Mezo's oracle **at the block the
 * fork is anchored at**, then install {@link ORACLE_SHIM_RUNTIME} at the precompile
 * address on the fork and seed it with that data. After this, `PriceFeed.fetchPrice()`
 * works on the fork and returns the real BTC/USD price as of the forked block.
 *
 * MK-020. This read used to omit the block number, which meant it resolved at the
 * upstream chain's `latest`. Pinning `MEZO_FORK_BLOCK` therefore pinned the chain state
 * and left the price floating: three runs at block 15043414 seeded three different
 * answers, and the keeper test flipped between pass and fail as a result. Anchoring the
 * read to `seedBlock` makes the fork block the single input that determines the price.
 *
 * The oracle at `ORACLE_PRECOMPILE` is served by the node's Cosmos oracle module rather
 * than by EVM bytecode (see `constants.ts`), so it cannot be read from the fork itself,
 * and whether it honours a historical block tag is a property of the endpoint, not
 * something to assume. It was verified to honour it: reads at the pinned block returned
 * one identical round twelve times running, and a read one million blocks earlier
 * returned a genuinely older round. If the endpoint has pruned that state, we fall back
 * to {@link RECORDED_ORACLE_SEED}, but only for its exact block and never quietly.
 *
 * Timestamps (`startedAt`/`updatedAt`) are still seeded to the fork's current block time
 * rather than the round's own, so the price is never "stale" to the PriceFeed's freshness
 * check. Only the price and round id come from the pinned read.
 *
 * @param seedBlock the upstream block to read the round at, normally the fork's anchor.
 */
export async function installOracleShim(
  testClient: TestClient,
  forkClient: PublicClient,
  liveRpcUrl: string,
  seedBlock: bigint,
): Promise<SeededRoundData> {
  const live = createPublicClient({ chain: mezoTestnet, transport: http(liveRpcUrl) })

  const block = await forkClient.getBlock({ blockTag: 'latest' })
  const now = block.timestamp

  let decimals: number
  let roundId: bigint
  let answer: bigint
  let source: SeededRoundData['source']

  try {
    const [liveDecimals, round] = await Promise.all([
      live.readContract({
        address: ORACLE_PRECOMPILE,
        abi: aggregatorAbi,
        functionName: 'decimals',
        blockNumber: seedBlock,
      }),
      live.readContract({
        address: ORACLE_PRECOMPILE,
        abi: aggregatorAbi,
        functionName: 'latestRoundData',
        blockNumber: seedBlock,
      }),
    ])
    decimals = liveDecimals
    roundId = round[0]
    answer = round[1]
    source = 'chain'
  } catch (cause) {
    // Only the recorded block may be substituted, and only out loud. Substituting a
    // recorded price for a DIFFERENT block would be a fabricated number, so that throws.
    if (seedBlock !== RECORDED_ORACLE_SEED.block) {
      throw new Error(
        [
          `Could not read the oracle round at block ${seedBlock} from the upstream RPC,`,
          `and no recorded seed exists for that block (only ${RECORDED_ORACLE_SEED.block}).`,
          'Point MEZO_FORK_BLOCK at a block the endpoint still serves, or use an archive',
          'endpoint. Refusing to seed a price that does not belong to the forked block.',
        ].join(' '),
        { cause },
      )
    }
    decimals = RECORDED_ORACLE_SEED.decimals
    roundId = RECORDED_ORACLE_SEED.roundId
    answer = RECORDED_ORACLE_SEED.answer
    source = 'recorded'
    console.warn(
      [
        `[harness] WARNING: the upstream RPC could not serve the oracle round at block ${seedBlock};`,
        'falling back to the RECORDED seed for that block. The suite is still deterministic, but the',
        'price is a snapshot rather than a fresh chain read. Bump MEZO_FORK_BLOCK and re-record.',
        `Cause: ${String(cause)}`,
      ].join(' '),
    )
  }

  await testClient.setCode({ address: ORACLE_PRECOMPILE, bytecode: ORACLE_SHIM_RUNTIME })

  await writeSlot(testClient, ORACLE_SLOT.decimals, BigInt(decimals))
  await writeSlot(testClient, ORACLE_SLOT.roundId, roundId)
  await writeSlot(testClient, ORACLE_SLOT.answer, answer)
  await writeSlot(testClient, ORACLE_SLOT.startedAt, now)
  await writeSlot(testClient, ORACLE_SLOT.updatedAt, now)
  // answeredInRound >= roundId keeps any monotonicity check happy.
  await writeSlot(testClient, ORACLE_SLOT.answeredInRound, roundId)

  return {
    decimals,
    roundId,
    answer,
    startedAt: now,
    updatedAt: now,
    answeredInRound: roundId,
    sourceBlock: seedBlock,
    source,
  }
}

/**
 * Drive the fork's BTC/USD price deterministically. Used by later phases to put a
 * Trove just above / below MCR, into Recovery Mode, etc.
 *
 * @param usdPerBtc1e18 the new price, 1e18-scaled (e.g. `30_000n * 10n ** 18n` for $30k).
 */
export async function setPrice(
  testClient: TestClient,
  forkClient: PublicClient,
  usdPerBtc1e18: bigint,
): Promise<void> {
  const block = await forkClient.getBlock({ blockTag: 'latest' })
  await writeSlot(testClient, ORACLE_SLOT.answer, usdPerBtc1e18)
  await writeSlot(testClient, ORACLE_SLOT.startedAt, block.timestamp)
  await writeSlot(testClient, ORACLE_SLOT.updatedAt, block.timestamp)
}

/**
 * Mine a block, and write two slots the shim does not read. The answer is untouched.
 *
 * **MK-032. Read the name and the history together, because they disagree.** This was
 * written to keep the seeded oracle from tripping the PriceFeed's staleness guard, and that
 * is no longer what it does. `OracleShim.sol:24-29` returns `timestamp()` for BOTH
 * `startedAt` and `updatedAt`, so the shim reports itself fresh at every block and the guard
 * can never trip. `ORACLE_SLOT.startedAt` and `.updatedAt` are slots 3 and 4
 * (`constants.ts:71-72`), and `latestRoundData` reads only slots 0, 1, 2 and 5. The two
 * writes below land in dead storage.
 *
 * Verified on the fork rather than reasoned about: warping 30 days forward with NO call to
 * this function leaves `fetchPrice()` returning the same answer and throwing nothing.
 *
 * So its ONE remaining effect is `testClient.mine`. That is not nothing, a fresh block
 * advances the timestamp every subsequent `eth_call` is evaluated at, but it is a different
 * thing from what every caller's comment says it is doing. Those comments are corrected
 * where they appear. This function is left in place rather than removed because pulling
 * flake mitigations out is its own wave (MK-016), and removing one while its siblings stay
 * would make the next failure harder to attribute, not easier.
 */
export async function refreshOracle(
  testClient: TestClient,
  forkClient: PublicClient,
): Promise<void> {
  // Mine first so "latest" reflects the current wall-clock: anvil stamps new blocks
  // with real time, and view-only stretches (e.g. a slow getApproxHint) leave the
  // last block, and thus a naive updatedAt, far in the past, tripping staleness.
  await testClient.mine({ blocks: 1 })
  const block = await forkClient.getBlock({ blockTag: 'latest' })
  await writeSlot(testClient, ORACLE_SLOT.startedAt, block.timestamp)
  await writeSlot(testClient, ORACLE_SLOT.updatedAt, block.timestamp)
}
