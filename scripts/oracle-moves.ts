/**
 * How far the Mezo BTC/USD oracle moves, measured from chain history (MK-100, MK-103).
 *
 * Two margins in this SDK are sized from price movement, and a margin sized from a convention is a
 * number chosen to feel safe (`docs/08-conventions.md` §10). This is the instrument both cite:
 *
 *   - **Consecutive block moves.** A partial redemption is priced when its hint is computed and
 *     again when it mines (`TroveManager.sol:1224-1226` against `HintHelpers.sol:148`), so the move
 *     that matters is over one to a few blocks. Reported for gaps of 1, 2 and 3 blocks.
 *   - **Worst adverse move inside a window.** A position opened at a borrowing power figure has to
 *     survive the price falling between the read and the block the open lands in, and for a while
 *     after. Reported, for windows of 60, 600 and 3600 seconds, as the largest fall from each
 *     sampled start to the lowest sampled price inside the window that follows it.
 *   - **How often a fall is reached within a holding horizon** (`--horizons`, MK-240). A position is
 *     not held for the delay between a read and a send, it is held for as long as its owner keeps it.
 *     For each horizon and each fall in `--falls`, the share of sampled start times from which the
 *     price fell at least that far at some sample inside the horizon, and the worst fall seen. This is
 *     the table a caller choosing `drawForMargin`'s `horizonSeconds` and `priceFallBps` is pointed at.
 *     Start times overlap, so neighbouring windows share most of their samples and the shares are not
 *     independent trials: they describe one stretch of history, not a probability.
 *
 * READ ONLY. A public client, no key, no writes. The endpoint comes from the environment and is
 * never printed. The block range is pinned by `--end`, so a re-run against the same range reads the
 * same history and prints the same numbers.
 *
 *   export MEZO_MAINNET_RPC_URL=<a Mezo mainnet (31612) endpoint>
 *   pnpm tsx scripts/oracle-moves.ts --end 11823000 --consecutive 2000 --days 7 --step 16
 *   pnpm tsx scripts/oracle-moves.ts --end <block> --consecutive 0 --days 90 --step 225 \
 *     --horizons 3600,86400,259200,604800,2592000 --falls 200,500,1000,2000
 *
 * One `eth_call` per sample (the price and `Multicall3.getCurrentBlockTimestamp()` pinned at the
 * same block), four at a time by default (`--concurrency`), with backoff on a rate limit.
 *
 * **Resolution, stated rather than implied.** The window figures sample one block in `--step`, so a
 * dip that recovers between two samples is not seen. They are a lower bound on the true worst move
 * at that resolution, and the step is printed beside them.
 */

import { http, type Address, createPublicClient } from 'viem'

const PRICE_FEED: Address = '0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88'
const MULTICALL3: Address = '0xcA11bde05977b3631167028862bE2a173976CA11'
const FETCH_PRICE = [
  {
    type: 'function',
    name: 'fetchPrice',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const
const BLOCK_TIMESTAMP = [
  {
    type: 'function',
    name: 'getCurrentBlockTimestamp',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] !== undefined ? (process.argv[i + 1] as string) : fallback
}

const rpc = process.env.MEZO_MAINNET_RPC_URL
if (!rpc) {
  console.error('MEZO_MAINNET_RPC_URL is not set.')
  process.exit(2)
}
const client = createPublicClient({ transport: http(rpc, { retryCount: 0 }) })

const end = BigInt(arg('end', '0'))
const consecutive = Number(arg('consecutive', '2000'))
const days = Number(arg('days', '7'))
const step = Number(arg('step', '16'))
const concurrency = Number(arg('concurrency', '4'))
const horizons = arg('horizons', '')
  .split(',')
  .filter((x) => x !== '')
  .map((x) => BigInt(x))
const falls = arg('falls', '200,500,1000,2000')
  .split(',')
  .filter((x) => x !== '')
  .map((x) => Number(x))
if (end === 0n) {
  console.error('--end <block> is required, so the measured range is pinned and reproducible.')
  process.exit(2)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** The price and the block's own timestamp, in ONE `eth_call` pinned at `block`. */
async function priceAt(block: bigint): Promise<{ block: bigint; price: bigint; ts: bigint }> {
  for (let attempt = 0; ; attempt++) {
    try {
      const [price, ts] = await client.multicall({
        allowFailure: false,
        multicallAddress: MULTICALL3,
        blockNumber: block,
        contracts: [
          { address: PRICE_FEED, abi: FETCH_PRICE, functionName: 'fetchPrice' },
          { address: MULTICALL3, abi: BLOCK_TIMESTAMP, functionName: 'getCurrentBlockTimestamp' },
        ],
      })
      return { block, price, ts }
    } catch (error) {
      // Public endpoints rate limit. Back off rather than fail a long read on a transient 429.
      if (attempt >= 12) throw error
      await sleep(Math.min(30_000, 500 * 2 ** attempt))
    }
  }
}

async function collect(blocks: bigint[]) {
  const out: { block: bigint; price: bigint; ts: bigint }[] = new Array(blocks.length)
  let next = 0
  const worker = async () => {
    while (next < blocks.length) {
      const i = next++
      out[i] = await priceAt(blocks[i] as bigint)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return out
}

/** Relative move in basis points, 1e-4 of the starting price. */
const bps = (from: bigint, to: bigint) =>
  (Number(((to - from) * 1_000_000n) / from) / 1_000_000) * 10_000
const quantile = (sorted: number[], q: number) =>
  sorted.length === 0
    ? Number.NaN
    : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number)
const fmt = (x: number) => x.toFixed(3)

async function main() {
  // ---- consecutive block moves ----
  // `--consecutive 0` skips the block move report. The window span below still needs a block time,
  // so it is then measured from the two ends of a 1000 block stretch before `--end`.
  const cBlocks = Array.from(
    { length: Math.max(consecutive, 1) + 1 },
    (_, i) => end - BigInt(Math.max(consecutive, 1) - i),
  )
  const series = consecutive > 0 ? await collect(cBlocks) : await collect([end - 1000n, end])
  const gaps = consecutive > 0 ? consecutive : 1000
  const seconds = Number((series.at(-1)?.ts ?? 0n) - (series[0]?.ts ?? 0n))
  console.log(
    `consecutive: blocks ${end - BigInt(gaps)}..${end} (${gaps} gaps, ${seconds}s, ${(seconds / gaps).toFixed(2)} s/block)${consecutive > 0 ? '' : ', block time only'}`,
  )
  for (const gap of consecutive > 0 ? [1, 2, 3] : []) {
    const moves: number[] = []
    for (let i = gap; i < series.length; i++) {
      moves.push(
        bps((series[i - gap] as { price: bigint }).price, (series[i] as { price: bigint }).price),
      )
    }
    const up = moves.filter((m) => m > 0).length
    const down = moves.filter((m) => m < 0).length
    const flat = moves.length - up - down
    const absSorted = moves.map(Math.abs).sort((a, b) => a - b)
    const upSorted = moves.filter((m) => m > 0).sort((a, b) => a - b)
    const downSorted = moves
      .filter((m) => m < 0)
      .map((m) => -m)
      .sort((a, b) => a - b)
    console.log(
      `  gap ${gap} block(s): n=${moves.length} up=${up} flat=${flat} down=${down} | |move| bps p50=${fmt(quantile(absSorted, 0.5))} p90=${fmt(quantile(absSorted, 0.9))} p99=${fmt(quantile(absSorted, 0.99))} max=${fmt(absSorted.at(-1) ?? Number.NaN)} | up p99=${fmt(quantile(upSorted, 0.99))} down p99=${fmt(quantile(downSorted, 0.99))}`,
    )
  }

  // ---- worst adverse move inside a window ----
  const approxBlocksPerDay = Math.round(86_400 / (seconds / gaps))
  const span = approxBlocksPerDay * days
  const wBlocks: bigint[] = []
  for (let b = end - BigInt(span); b <= end; b += BigInt(step)) wBlocks.push(b)
  const samples = await collect(wBlocks)
  const first = samples[0] as { block: bigint; ts: bigint }
  const last = samples.at(-1) as { block: bigint; ts: bigint }
  console.log(
    `windows: blocks ${first.block}..${last.block} (${samples.length} samples, one every ${step} blocks, ${Number(last.ts - first.ts)}s)`,
  )
  for (const window of [60n, 600n, 3600n]) {
    const drops: number[] = []
    for (let i = 0; i < samples.length; i++) {
      const start = samples[i] as { price: bigint; ts: bigint }
      if (start.ts + window > last.ts) break
      let low = start.price
      for (
        let k = i + 1;
        k < samples.length && (samples[k] as { ts: bigint }).ts <= start.ts + window;
        k++
      ) {
        const p = (samples[k] as { price: bigint }).price
        if (p < low) low = p
      }
      drops.push(-bps(start.price, low))
    }
    const sorted = drops.sort((a, b) => a - b)
    console.log(
      `  window ${window}s: starts=${sorted.length} worst fall bps p50=${fmt(quantile(sorted, 0.5))} p90=${fmt(quantile(sorted, 0.9))} p99=${fmt(quantile(sorted, 0.99))} p99.9=${fmt(quantile(sorted, 0.999))} max=${fmt(sorted.at(-1) ?? Number.NaN)}`,
    )
  }

  // ---- how often a fall is reached within a holding horizon (MK-240) ----
  for (const horizon of horizons) {
    const worst: number[] = []
    for (let i = 0; i < samples.length; i++) {
      const start = samples[i] as { price: bigint; ts: bigint }
      // Only starts whose whole horizon lies inside the sampled range, so every share has the same
      // denominator meaning: the horizon was fully observed.
      if (start.ts + horizon > last.ts) break
      let low = start.price
      for (
        let k = i + 1;
        k < samples.length && (samples[k] as { ts: bigint }).ts <= start.ts + horizon;
        k++
      ) {
        const p = (samples[k] as { price: bigint }).price
        if (p < low) low = p
      }
      worst.push(-bps(start.price, low))
    }
    const shares = falls.map((f) => {
      const reached = worst.filter((w) => w >= f).length
      return `fall>=${f}bps ${reached} (${((100 * reached) / Math.max(worst.length, 1)).toFixed(1)}%)`
    })
    const max = worst.reduce((a, b) => (b > a ? b : a), Number.NEGATIVE_INFINITY)
    console.log(
      `  horizon ${horizon}s: starts=${worst.length} | ${shares.join(' | ')} | worst fall bps ${fmt(max)}`,
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
