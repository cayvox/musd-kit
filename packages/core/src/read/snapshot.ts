import type { Abi, PublicClient } from 'viem'
import { priceFeedAbi } from '../clients'
import { MULTICALL3_ADDRESS } from '../constants'
import type { ReadDeps } from './deps'

/**
 * `Multicall3.getBlockNumber()`, the block the aggregate call is executing against.
 *
 * Multicall3 is already the batching contract every read here uses, and it reports its own
 * execution block, so the price and the block number come back from ONE `eth_call` and
 * cannot disagree. Asking `eth_blockNumber` separately would reintroduce exactly the race
 * this exists to remove.
 */
const multicall3BlockAbi = [
  {
    type: 'function',
    name: 'getBlockNumber',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'blockNumber', type: 'uint256' }],
  },
] as const

/** A price, the block it was read at, and any extra reads taken at that same block. */
export interface PriceSnapshot {
  price: bigint
  blockNumber: bigint
  /** Results of `extra`, in order, all executed at `blockNumber`. */
  extra: readonly unknown[]
}

/**
 * Read `fetchPrice()` together with the block it was read at, plus any price INDEPENDENT
 * reads the caller also needs (MK-013).
 *
 * The problem this solves is structural rather than stylistic. Every price dependent getter
 * MUSD exposes takes the price as an argument: `getTCR(uint256)`,
 * `checkRecoveryMode(uint256)`, `getCurrentICR(address,uint256)`. Verified from the ABI,
 * there is no zero argument variant of any of them. So the price cannot be produced and
 * consumed inside one batch: its value has to exist before the call that uses it is encoded.
 *
 * The SDK previously read the price, then ran the dependent calls at whatever block came
 * next. Two round trips, two blocks, and docstrings promising "one consistent price
 * snapshot". On a chain producing blocks while a request is in flight, the ICR and the price
 * it was measured against could genuinely come from different states.
 *
 * The fix is to pin rather than to merge: this call returns the price AND the block number
 * from a single `eth_call`, and the caller runs the dependent reads with
 * `blockNumber` set to it. Still two round trips, the same as before, but now both are
 * evaluated against the same block, so the snapshot claim is true rather than aspirational.
 *
 * The second call reads one block back at most, which every node serves; this is not
 * archival access.
 */
export async function readPriceSnapshot(
  { publicClient, addresses }: ReadDeps,
  extra: readonly {
    address: `0x${string}`
    abi: Abi
    functionName: string
    args?: unknown[]
  }[] = [],
): Promise<PriceSnapshot> {
  const [price, blockNumber, ...rest] = await publicClient.multicall({
    allowFailure: false,
    multicallAddress: MULTICALL3_ADDRESS,
    contracts: [
      { address: addresses.priceFeed, abi: priceFeedAbi as Abi, functionName: 'fetchPrice' },
      {
        address: MULTICALL3_ADDRESS,
        abi: multicall3BlockAbi as Abi,
        functionName: 'getBlockNumber',
      },
      ...extra,
    ],
  })
  return { price: price as bigint, blockNumber: blockNumber as bigint, extra: rest }
}

/** Run price dependent reads pinned to the block a {@link PriceSnapshot} came from. */
export function readAtSnapshot(
  publicClient: PublicClient,
  blockNumber: bigint,
  contracts: readonly {
    address: `0x${string}`
    abi: Abi
    functionName: string
    args?: unknown[]
  }[],
): Promise<unknown[]> {
  return publicClient.multicall({
    allowFailure: false,
    multicallAddress: MULTICALL3_ADDRESS,
    blockNumber,
    contracts,
  }) as Promise<unknown[]>
}
