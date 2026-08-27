import type { Abi, Address } from 'viem'
import { troveManagerAbi } from '../clients'
import { type WriteDeps, type WriteResult, requireWallet, simulateAndSend } from '../internal/write'

const TM_ABI: Abi = troveManagerAbi

/**
 * Liquidate an under-collateralized Trove (permissionless keeper surface). Simulates
 * first: if the Trove is not liquidatable the simulation reverts ("TroveManager: nothing
 * to liquidate") and the decoder throws `NothingToLiquidate` (nothing is sent). On success
 * the caller receives the reward (200 MUSD + 0.5% of the Trove's BTC).
 */
export function liquidate(deps: WriteDeps, borrower: Address): Promise<WriteResult> {
  const wallet = requireWallet(deps)
  return simulateAndSend(
    deps,
    wallet,
    deps.addresses.troveManager,
    TM_ABI,
    'liquidate',
    [borrower],
    {
      revert: { operation: 'liquidate', borrowers: [borrower] },
    },
  )
}

/** Liquidate several Troves in one call (`batchLiquidateTroves`). */
export function batchLiquidate(
  deps: WriteDeps,
  borrowers: readonly Address[],
): Promise<WriteResult> {
  const wallet = requireWallet(deps)
  return simulateAndSend(
    deps,
    wallet,
    deps.addresses.troveManager,
    TM_ABI,
    'batchLiquidateTroves',
    [borrowers],
    { revert: { operation: 'batchLiquidateTroves', borrowers } },
  )
}
