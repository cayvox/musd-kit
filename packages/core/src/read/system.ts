import type { Address } from 'viem'
import { musdAbi, priceFeedAbi, troveManagerAbi } from '../clients'
import { MCR, MULTICALL3_ADDRESS } from '../constants'
import type { ReadDeps } from './deps'
import type { SystemState } from './types'

/** Protocol-wide live state from one price snapshot. */
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

/**
 * Liquidatability: `ICR < MCR`. There is no mode branch, because the protocol has none.
 *
 * MK-001. This used to widen the predicate to `ICR < CCR` in Recovery Mode and its
 * docstring claimed that behavior had been verified. It had not. `TroveManager.sol`
 * contains **no reference to `CCR` at all**, in the liquidation path or anywhere else, and
 * the only gate is `if (vars.ICR < MCR)` inside the `batchLiquidateTroves` loop
 * (`TroveManager.sol:1148`). `liquidate(address)` builds a one element array and funnels
 * into that same loop (`TroveManager.sol:265-271`), which reverts with
 * `TroveManager: nothing to liquidate` when the loop liquidates nothing. This fork removed
 * stock Liquity's Recovery Mode liquidation branch; we modeled a rule that does not exist.
 *
 * The consequence of the old behavior was that in Recovery Mode every Trove between MCR
 * and CCR was reported liquidatable, and every liquidation attempt against one of them
 * reverted: wasted gas for keepers, false alarms for position holders.
 *
 * This is the same predicate `getTrove().isLiquidatable` applies, deliberately. Two APIs
 * answering one question differently was the underlying defect; a fork test pins that they
 * agree so they cannot drift apart again.
 */
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

const collSurplusPoolAbi = [
  {
    type: 'function',
    name: 'getCollateral',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const

/**
 * BTC surplus claimable by `address` via `claim()`, left in the CollSurplusPool after a
 * redemption (fully-redeemed Trove) or a Recovery-Mode liquidation of an above-MCR Trove.
 * The pool address is read from `TroveManager.collSurplusPool()` (works on both networks).
 */
export async function getClaimableCollateral(
  { publicClient, addresses }: ReadDeps,
  address: Address,
): Promise<bigint> {
  const pool = await publicClient.readContract({
    address: addresses.troveManager,
    abi: troveManagerAbi,
    functionName: 'collSurplusPool',
  })
  return publicClient.readContract({
    address: pool,
    abi: collSurplusPoolAbi,
    functionName: 'getCollateral',
    args: [address],
  })
}

// getPeg (MUSD/USD) is intentionally NOT implemented: the PriceFeed is BTC/USD and
// MUSD exposes no MUSD/USD oracle path.
