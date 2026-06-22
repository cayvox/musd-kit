import type { MusdClient } from '@musd-kit/core'
import type { Address, Hex } from 'viem'

const ZERO = '0x0000000000000000000000000000000000000000' as const

export interface ScanOptions {
  /** How many Troves to walk up from the lowest-ICR tail (default 100). */
  maxScan?: number
  /** Stop after this many successful liquidations (default: unbounded). */
  maxLiquidations?: number
  /** Liquidate one-by-one (default) or accumulate and `batchLiquidate` in one tx. */
  batch?: boolean
  log?: (message: string) => void
}

export interface ScanResult {
  scanned: number
  /** Addresses that `isLiquidatable` returned true for. */
  liquidatable: Address[]
  /** Troves actually liquidated (with the tx hash). */
  liquidated: { borrower: Address; hash: Hex }[]
}

/**
 * Walk `SortedTroves` from the tail (LOWEST ICR, the most likely liquidatable) toward the
 * head via `getPrev`, and liquidate any Trove the contract considers liquidatable. The
 * mode-aware check (`isLiquidatable`) and simulate-before-send both come from
 * `@musd-kit/core`; a Trove that is not actually liquidatable surfaces `NothingToLiquidate`,
 * which we catch and skip (state can drift between the read and the send). Single pass.
 *
 * This module imports `@musd-kit/core` and `viem` ONLY, no React, no wagmi. That it
 * compiles and runs is the structural proof the core is framework-agnostic.
 */
export async function scanAndLiquidate(
  client: MusdClient,
  opts: ScanOptions = {},
): Promise<ScanResult> {
  const log = opts.log ?? (() => {})
  const maxScan = opts.maxScan ?? 100
  const maxLiquidations = opts.maxLiquidations ?? Number.POSITIVE_INFINITY

  const liquidatable: Address[] = []
  const liquidated: { borrower: Address; hash: Hex }[] = []

  let cursor = (await client.contracts.sortedTroves.read.getLast()) as Address
  let scanned = 0

  while (cursor !== ZERO && scanned < maxScan && liquidated.length < maxLiquidations) {
    scanned++
    // Read the next node BEFORE liquidating, liquidating removes `cursor` from the list.
    const next = (await client.contracts.sortedTroves.read.getPrev([cursor])) as Address

    if (await client.isLiquidatable(cursor)) {
      liquidatable.push(cursor)
      // In non-batch mode, liquidate now; otherwise accumulate for one batch call below.
      if (!opts.batch) {
        try {
          const { hash } = await client.liquidate(cursor)
          liquidated.push({ borrower: cursor, hash })
          log(`liquidated ${cursor} → ${hash}`)
        } catch (err) {
          // NothingToLiquidate (Recovery-Mode single-Trove rules / state drift), skip.
          log(`skip ${cursor}: ${(err as Error).message}`)
        }
      }
    }
    cursor = next
  }

  if (opts.batch && liquidatable.length > 0) {
    const targets = liquidatable.slice(
      0,
      Number.isFinite(maxLiquidations) ? maxLiquidations : undefined,
    )
    try {
      const { hash } = await client.batchLiquidate(targets)
      for (const borrower of targets) liquidated.push({ borrower, hash })
      log(`batchLiquidated ${targets.length} → ${hash}`)
    } catch (err) {
      log(`batch skipped: ${(err as Error).message}`)
    }
  }

  return { scanned, liquidatable, liquidated }
}
