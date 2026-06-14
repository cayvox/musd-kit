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
}

async function writeSlot(client: TestClient, slot: bigint, value: bigint): Promise<void> {
  await client.setStorageAt({
    address: ORACLE_PRECOMPILE,
    index: numberToHex(slot, { size: 32 }) as Hex,
    value: toHex(value, { size: 32 }),
  })
}

/**
 * Read the REAL `decimals()` + `latestRoundData()` from Mezo's live oracle, then
 * install {@link ORACLE_SHIM_RUNTIME} at the precompile address on the fork and
 * seed it with that real data. After this, `PriceFeed.fetchPrice()` works on the
 * fork and returns the real, seeded BTC/USD price.
 *
 * Timestamps (`startedAt`/`updatedAt`) are seeded to the fork's current block time
 * so the price is never "stale" to the PriceFeed's freshness check; the price
 * itself (`answer`) and `roundId` are the real live values.
 */
export async function installOracleShim(
  testClient: TestClient,
  forkClient: PublicClient,
  liveRpcUrl: string,
): Promise<SeededRoundData> {
  const live = createPublicClient({ chain: mezoTestnet, transport: http(liveRpcUrl) })

  const [decimals, round, block] = await Promise.all([
    live.readContract({ address: ORACLE_PRECOMPILE, abi: aggregatorAbi, functionName: 'decimals' }),
    live.readContract({
      address: ORACLE_PRECOMPILE,
      abi: aggregatorAbi,
      functionName: 'latestRoundData',
    }),
    forkClient.getBlock({ blockTag: 'latest' }),
  ])

  const [roundId, answer] = round
  const now = block.timestamp

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
 * Bump the shim's `startedAt`/`updatedAt` to the current block time WITHOUT changing
 * the price. anvil advances block timestamps by wall-clock, so the seeded oracle
 * eventually trips the PriceFeed's "Oracle is stale" guard during a long run; call
 * this before price-dependent operations to keep it fresh. The answer is untouched.
 */
export async function refreshOracle(
  testClient: TestClient,
  forkClient: PublicClient,
): Promise<void> {
  // Mine first so "latest" reflects the current wall-clock: anvil stamps new blocks
  // with real time, and view-only stretches (e.g. a slow getApproxHint) leave the
  // last block — and thus a naive updatedAt — far in the past, tripping staleness.
  await testClient.mine({ blocks: 1 })
  const block = await forkClient.getBlock({ blockTag: 'latest' })
  await writeSlot(testClient, ORACLE_SLOT.startedAt, block.timestamp)
  await writeSlot(testClient, ORACLE_SLOT.updatedAt, block.timestamp)
}
