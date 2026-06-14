import type { Address, PublicClient } from 'viem'
import type { MusdAddresses } from '../addresses'
import { hintHelpersAbi, sortedTrovesAbi } from '../clients'
import { type ComputeNICRParams, computeNICR } from './computeNICR'

/** Default deterministic sampling seed for `getApproxHint` (tests rely on this). */
export const DEFAULT_HINT_RANDOM_SEED = 42n

/** Liquity hint heuristic: numTrials = ceil(K · √size). */
const TRIALS_K = 15
const MIN_TRIALS = 15
const MAX_TRIALS = 2500

/**
 * numTrials for `getApproxHint`, scaled with the SortedTroves size (the Liquity
 * heuristic `ceil(15·√size)`, clamped to `[15, 2500]`). A flat 15 oversamples a
 * tiny list and undersamples a large one; more trials → a closer approximate hint
 * → fewer on-chain traversal steps at insert (cheaper gas), at the cost of more
 * view work. The contract always places correctly regardless — trials only buy gas.
 */
export function trialsForSize(size: bigint): number {
  const trials = Math.ceil(TRIALS_K * Math.sqrt(Number(size)))
  return Math.min(MAX_TRIALS, Math.max(MIN_TRIALS, trials))
}

export interface ComputeHintsParams extends ComputeNICRParams {
  /** Override the auto-scaled trial count (skips the `getSize()` read). */
  numTrials?: number
  /** Override the sampling seed (default {@link DEFAULT_HINT_RANDOM_SEED}). */
  randomSeed?: bigint
}

export interface Hints {
  /** SortedTroves neighbor with NICR ≥ this position's (descending list). */
  upperHint: Address
  /** SortedTroves neighbor with NICR ≤ this position's. */
  lowerHint: Address
  /** The computed nominal collateral ratio. */
  nicr: bigint
}

export interface HintsDeps {
  publicClient: PublicClient
  addresses: MusdAddresses
}

/**
 * The insertion-hint ritual, wrapped once (Appendix A): compute the NICR, pick
 * `numTrials` from the list size, get an approximate hint, then refine it to the
 * exact `{ upperHint, lowerHint }` via `findInsertPosition`. The caller supplies the
 * RESULTING entire debt (for an open: `draw + getBorrowingFee(draw) + 200`); this
 * does not compute the debt itself.
 */
export async function computeHints(
  { publicClient, addresses }: HintsDeps,
  params: ComputeHintsParams,
): Promise<Hints> {
  const { collateral, entireDebt, randomSeed = DEFAULT_HINT_RANDOM_SEED } = params
  const nicr = computeNICR({ collateral, entireDebt })

  let numTrials = params.numTrials
  if (numTrials === undefined) {
    const size = await publicClient.readContract({
      address: addresses.sortedTroves,
      abi: sortedTrovesAbi,
      functionName: 'getSize',
    })
    numTrials = trialsForSize(size)
  }

  const [approxHint] = await publicClient.readContract({
    address: addresses.hintHelpers,
    abi: hintHelpersAbi,
    functionName: 'getApproxHint',
    args: [nicr, BigInt(numTrials), randomSeed],
  })

  const [upperHint, lowerHint] = await publicClient.readContract({
    address: addresses.sortedTroves,
    abi: sortedTrovesAbi,
    functionName: 'findInsertPosition',
    args: [nicr, approxHint, approxHint],
  })

  return { upperHint, lowerHint, nicr }
}
