import type { Address } from 'viem'
import { musdAbi, priceFeedAbi, troveManagerAbi } from '../clients'
import { MCR, MULTICALL3_ADDRESS } from '../constants'
import type { ReadDeps } from './deps'
import type { SystemState } from './types'

/** Protocol-wide live state from one price snapshot (Law 2). */
export async function getSystemState({ publicClient, addresses }: ReadDeps): Promise<SystemState> {
  const price = await publicClient.readContract({
    address: addresses.priceFeed,
    abi: priceFeedAbi,
    functionName: 'fetchPrice',
  })
  const tm = { address: addresses.troveManager, abi: troveManagerAbi } as const
  const [tcr, isRecoveryMode] = await publicClient.multicall({
    allowFailure: false,
    multicallAddress: MULTICALL3_ADDRESS,
    contracts: [
      { ...tm, functionName: 'getTCR', args: [price] },
      { ...tm, functionName: 'checkRecoveryMode', args: [price] },
    ],
  })
  return { tcr, isRecoveryMode, price }
}

/** Normal-mode liquidatability: `getCurrentICR(address, price) < MCR`. */
export async function isLiquidatable(
  { publicClient, addresses }: ReadDeps,
  address: Address,
): Promise<boolean> {
  const price = await publicClient.readContract({
    address: addresses.priceFeed,
    abi: priceFeedAbi,
    functionName: 'fetchPrice',
  })
  const icr = await publicClient.readContract({
    address: addresses.troveManager,
    abi: troveManagerAbi,
    functionName: 'getCurrentICR',
    args: [address, price],
  })
  return icr < MCR
}

/** BTC/USD from `PriceFeed.fetchPrice()` (1e18-scaled). */
export function getOraclePrice({ publicClient, addresses }: ReadDeps): Promise<bigint> {
  return publicClient.readContract({
    address: addresses.priceFeed,
    abi: priceFeedAbi,
    functionName: 'fetchPrice',
  })
}

/** MUSD ERC-20 balance of `address`. */
export function balanceOf(
  { publicClient, addresses }: ReadDeps,
  address: Address,
): Promise<bigint> {
  return publicClient.readContract({
    address: addresses.musd,
    abi: musdAbi,
    functionName: 'balanceOf',
    args: [address],
  })
}

// getPeg (MUSD/USD) is intentionally NOT implemented: the PriceFeed is BTC/USD and
// MUSD exposes no MUSD/USD oracle path. See docs/09-open-questions.md (peg watch item).
