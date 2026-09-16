import type { Abi, Address } from 'viem'
import { musdAbi, priceFeedAbi, troveManagerAbi } from '../clients'
import { isTroveLiquidatable } from '../math/compute'
import type { ReadDeps } from './deps'
import { readAtSnapshot, readPriceSnapshot } from './snapshot'
import type { SystemState } from './types'

/**
 * Protocol-wide live state, from ONE block (MK-013).
 *
 * `getTCR` and `checkRecoveryMode` both take the price as an argument, so it cannot be
 * produced inside the batch that consumes it. It is pinned instead: the first call returns
 * the price and the block it executed at, the second runs both dependent getters at that
 * block. Two round trips either way, but the snapshot is now a fact rather than a claim.
 */
export async function getSystemState(deps: ReadDeps): Promise<SystemState> {
  const { publicClient, addresses } = deps
  const { price, blockNumber } = await readPriceSnapshot(deps)
  const tm = { address: addresses.troveManager, abi: troveManagerAbi as Abi } as const
  const [tcr, isRecoveryMode] = (await readAtSnapshot(publicClient, blockNumber, [
    { ...tm, functionName: 'getTCR', args: [price] },
    { ...tm, functionName: 'checkRecoveryMode', args: [price] },
  ])) as [bigint, boolean]
  return { tcr, isRecoveryMode, price, blockNumber }
}

/**
 * Liquidatability: `ICR < MCR`, **and not the last Trove in the system**. There is no mode
 * branch, because the protocol has none.
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
 * This is the same predicate `getTrove().isLiquidatable` applies, and since MK-074 it is
 * literally the same function, `isTroveLiquidatable` in `math/compute.ts`. Two APIs answering
 * one question differently was the underlying defect, and until now they agreed only because
 * both files happened to inline `icr < MCR`; a fork test pinned the agreement without making it
 * structural, which `docs/08-conventions.md` §11 asks for.
 *
 * **MK-074 added the second condition.** The last Trove in the system cannot be liquidated at
 * any ICR: `_liquidate` returns without liquidating when `TroveOwners.length <= 1`
 * (`TroveManager.sol:1058-1060`) and `batchLiquidateTroves` then reverts at `:690-693`. That is
 * why the count is read here, in the same pinned block batch as the ICR.
 */
export async function isLiquidatable(deps: ReadDeps, address: Address): Promise<boolean> {
  const { publicClient, addresses } = deps
  // Two sequential reads before MK-013, so the ICR could be measured against a price from an
  // earlier block. For a predicate a keeper acts on, that is the difference between a
  // liquidation that lands and one that reverts.
  const { price, blockNumber } = await readPriceSnapshot(deps)
  const [icr, troveOwnersCount] = (await readAtSnapshot(publicClient, blockNumber, [
    {
      address: addresses.troveManager,
      abi: troveManagerAbi as Abi,
      functionName: 'getCurrentICR',
      args: [address, price],
    },
    // MK-074, and in the SAME batch so the count cannot come from a different block than the
    // ratio it qualifies.
    {
      address: addresses.troveManager,
      abi: troveManagerAbi as Abi,
      functionName: 'getTroveOwnersCount',
    },
  ])) as [bigint, bigint]
  return isTroveLiquidatable({ icr, troveOwnersCount })
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
 * BTC surplus claimable by `address` via `claim()`, left in the CollSurplusPool when a redemption
 * consumes the owner's Trove whole (`TroveManager.sol:1195`), the only writer of surplus. This
 * protocol has no Recovery Mode liquidation (MK-001), which this comment claimed until MK-246.
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
