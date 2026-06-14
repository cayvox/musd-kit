import type { Address } from 'viem'
import { priceFeedAbi, troveManagerAbi } from '../clients'
import { MCR, MULTICALL3_ADDRESS } from '../constants'
import type { ReadDeps } from './deps'
import { type Trove, TroveStatus } from './types'

const zeroTrove = (status: TroveStatus): Trove => ({
  exists: false,
  collateral: 0n,
  principal: 0n,
  interestOwed: 0n,
  entireDebt: 0n,
  icr: 0n,
  nominalICR: 0n,
  liquidationPrice: 0n,
  healthFactor: 0,
  isLiquidatable: false,
  interestRate: 0,
  status,
})

/**
 * Read a live Trove, contract-authoritative (Law 2). Fetches the price ONCE and
 * passes that same snapshot to every price-dependent getter; batches the rest into
 * a single same-block `multicall` (Multicall3 is present on Mezo — see
 * {@link MULTICALL3_ADDRESS}). Never recomputes live debt/interest client-side.
 */
export async function getTrove(
  { publicClient, addresses }: ReadDeps,
  address: Address,
): Promise<Trove> {
  const price = await publicClient.readContract({
    address: addresses.priceFeed,
    abi: priceFeedAbi,
    functionName: 'fetchPrice',
  })

  const tm = { address: addresses.troveManager, abi: troveManagerAbi } as const
  const [edc, icr, nominalICR, rate, statusRaw] = await publicClient.multicall({
    allowFailure: false,
    multicallAddress: MULTICALL3_ADDRESS,
    contracts: [
      { ...tm, functionName: 'getEntireDebtAndColl', args: [address] },
      { ...tm, functionName: 'getCurrentICR', args: [address, price] },
      { ...tm, functionName: 'getNominalICR', args: [address] },
      { ...tm, functionName: 'getTroveInterestRate', args: [address] },
      { ...tm, functionName: 'getTroveStatus', args: [address] },
    ],
  })

  // getEntireDebtAndColl → (coll, principal, interest, pendingColl, pendingPrincipal, pendingInterest).
  // Everything here is computed TO NOW (Law 2 / C3): we deliberately do NOT use
  // getTroveInterestOwed/getTroveDebt — those return the STORED (stale) snapshot, which
  // does not advance until the Trove is touched (verified on the fork: after a 30-day
  // warp, getTroveInterestOwed stayed 0 while getEntireDebtAndColl.interest grew).
  // entireDebt = principal + interest == the debt getCurrentICR uses (proven via computeCR).
  const [coll, principal, interestOwed] = edc
  const entireDebt = principal + interestOwed
  const status = statusRaw as TroveStatus

  if (status !== TroveStatus.active || entireDebt === 0n) {
    return zeroTrove(status)
  }

  const liquidationPrice = (MCR * entireDebt) / coll
  // Fixed-point first, then to number, so huge ICRs don't lose precision.
  const healthFactor = Number((icr * 1_000_000n) / MCR) / 1_000_000

  return {
    exists: true,
    collateral: coll,
    principal,
    interestOwed,
    entireDebt,
    icr,
    nominalICR,
    liquidationPrice,
    healthFactor,
    isLiquidatable: icr < MCR,
    interestRate: rate,
    status,
  }
}
