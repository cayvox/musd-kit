import { borrowerOperationsAbi, priceFeedAbi, troveManagerAbi } from '../clients'
import { CCR, MCR, MUSD_GAS_COMPENSATION } from '../constants'
import { computeICR } from './compute'
import type { MathDeps } from './deps'

/** Inputs to {@link MusdClient.getBorrowingPower}: the collateral to size a draw against. */
export interface GetBorrowingPowerParams {
  collateral: bigint
  /** Override the price; defaults to `fetchPrice()`. */
  price?: bigint
}

/**
 * The largest draw that OPENS a valid Trove. This is an **open time calculator and nothing
 * else**: it sizes a draw for a position that does not exist yet.
 *
 * It is NOT the right function for a Trove that already exists. Every Trove carries a
 * `maxBorrowingCapacity`, fixed at the OPENING price as `coll * price / (110 * 1e16)`
 * (`BorrowerOperations.sol:1323-1328`), ratcheted only downward on a collateral decrease
 * (`:879-897`), and **never raised**, not by a price rise and not by adding collateral. A
 * debt increase is gated on `maxBorrowingCapacity >= netDebtChange + debt`
 * (`:1358-1365`), which this function does not and should not model. For an existing
 * Trove use `previewBorrow`, which returns a verdict plus the binding constraint (MK-002).
 *
 * What it enforces, matching `_openTrove` (`BorrowerOperations.sol:645-665`):
 *
 *   - the mode correct individual ratio: `ICR >= MCR` normally, `ICR >= CCR` in Recovery
 *     Mode;
 *   - in NORMAL mode only, the resulting system ratio `TCR >= CCR`. The contract checks
 *     this on every normal mode open (`_requireNewTCRisAboveCCR`, `:663-665`) and it can
 *     bind before the individual ratio does on a large draw. In Recovery Mode the contract
 *     checks `ICR >= CCR` instead and imposes no resulting TCR condition, so neither does
 *     this;
 *   - the debt floor, `netDebt >= minNetDebt`, where `netDebt` is the draw plus the fee
 *     the contract will actually charge.
 *
 * Returns `0n` when even the largest feasible draw is below the debt floor, meaning no
 * valid open exists for this collateral.
 *
 * Solved by **monotonic binary search** on the draw, calling the real `getBorrowingFee`
 * each step, assumption-free about the fee shape (ICR is strictly decreasing in draw).
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

  // In normal mode the contract ALSO requires the resulting system TCR to stay at or above
  // CCR (`BorrowerOperations.sol:663-665`), so the open time calculator must respect it too;
  // otherwise it reports a draw the contract rejects. Recovery Mode opens are gated on
  // `ICR >= CCR` instead, with no resulting TCR condition, so this is normal mode only.
  const [systemColl, systemDebt] = isRecoveryMode
    ? [0n, 0n]
    : await Promise.all([
        publicClient.readContract({
          address: addresses.troveManager,
          abi: troveManagerAbi,
          functionName: 'getEntireSystemColl',
        }),
        publicClient.readContract({
          address: addresses.troveManager,
          abi: troveManagerAbi,
          functionName: 'getEntireSystemDebt',
        }),
      ])

  const feasible = async (draw: bigint): Promise<boolean> => {
    const entireDebt = draw + (await feeOf(draw)) + MUSD_GAS_COMPENSATION
    if (computeICR({ collateral, entireDebt, price }) < targetRatio) return false
    if (isRecoveryMode) return true
    const newTcr = computeICR({
      collateral: systemColl + collateral,
      entireDebt: systemDebt + entireDebt,
      price,
    })
    return newTcr >= CCR
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
