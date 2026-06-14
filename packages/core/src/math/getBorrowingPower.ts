import { borrowerOperationsAbi, priceFeedAbi, troveManagerAbi } from '../clients'
import { CCR, MCR, MUSD_GAS_COMPENSATION } from '../constants'
import { computeICR } from './compute'
import type { MathDeps } from './deps'

export interface GetBorrowingPowerParams {
  collateral: bigint
  /** Override the price; defaults to `fetchPrice()`. */
  price?: bigint
}

/**
 * The largest draw that opens a valid Trove: ICR ≥ the binding ratio (MCR normally,
 * CCR in Recovery Mode) AND `netDebt ≥ minNetDebt`. Returns `0n` if even the
 * ICR-feasible maximum is below the debt floor (no valid open).
 *
 * Solved by **monotonic binary search** on the draw, calling the real
 * `getBorrowingFee` each step — assumption-free about the fee shape (ICR is strictly
 * decreasing in draw). The fee read only touches the cached borrowing-rate slot, so
 * the search is cheap.
 */
export async function getBorrowingPower(
  deps: MathDeps,
  params: GetBorrowingPowerParams,
): Promise<bigint> {
  const { publicClient, addresses } = deps
  const { collateral } = params

  const price =
    params.price ??
    (await publicClient.readContract({
      address: addresses.priceFeed,
      abi: priceFeedAbi,
      functionName: 'fetchPrice',
    }))

  const [isRecoveryMode, minNetDebt] = await Promise.all([
    publicClient.readContract({
      address: addresses.troveManager,
      abi: troveManagerAbi,
      functionName: 'checkRecoveryMode',
      args: [price],
    }),
    deps.getMinNetDebt(),
  ])

  const targetRatio = isRecoveryMode ? CCR : MCR

  // Max entire debt for ICR == targetRatio; the draw is below this (fee + 200 eat into it).
  const entireDebtCap = (collateral * price) / targetRatio
  if (entireDebtCap <= MUSD_GAS_COMPENSATION) return 0n

  const feeOf = (draw: bigint) =>
    publicClient.readContract({
      address: addresses.borrowerOperations,
      abi: borrowerOperationsAbi,
      functionName: 'getBorrowingFee',
      args: [draw],
    })

  const feasible = async (draw: bigint): Promise<boolean> => {
    const entireDebt = draw + (await feeOf(draw)) + MUSD_GAS_COMPENSATION
    return computeICR({ collateral, entireDebt, price }) >= targetRatio
  }

  // Binary search the largest feasible draw in [0, entireDebtCap - 200].
  let lo = 0n
  let hi = entireDebtCap - MUSD_GAS_COMPENSATION
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n
    if (await feasible(mid)) lo = mid
    else hi = mid - 1n
  }

  // Enforce the minNetDebt floor: if even the max ICR-feasible draw is below it, no open.
  if (lo + (await feeOf(lo)) < minNetDebt) return 0n
  return lo
}
