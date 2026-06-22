import type { Address } from 'viem'
import { musdAbi, priceFeedAbi, troveManagerAbi } from '../clients'
import { CCR, MCR, MULTICALL3_ADDRESS } from '../constants'
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
 * Mode-aware liquidatability (refines the Phase-2 normal-mode-only version, verified
 * Phase 6): in **normal mode** (TCR ≥ CCR) a Trove is liquidatable iff `ICR < MCR`; in
 * **Recovery Mode** (TCR < CCR) iff `ICR < CCR`. (`liquidate` may still revert if the
 * Stability Pool can't absorb a Recovery-Mode liquidation, simulate-before-send catches
 * that; the keeper precheck.)
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
  const tm = { address: addresses.troveManager, abi: troveManagerAbi } as const
  const [icr, isRecoveryMode] = await publicClient.multicall({
    allowFailure: false,
    multicallAddress: MULTICALL3_ADDRESS,
    contracts: [
      { ...tm, functionName: 'getCurrentICR', args: [address, price] },
      { ...tm, functionName: 'checkRecoveryMode', args: [price] },
    ],
  })
  return icr < (isRecoveryMode ? CCR : MCR)
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
