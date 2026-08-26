import type { Abi, Address } from 'viem'
import { troveManagerAbi } from '../clients'
import { MCR } from '../constants'
import type { ReadDeps } from './deps'
import { readAtSnapshot, readPriceSnapshot } from './snapshot'
import { type Trove, TroveStatus } from './types'

const zeroTrove = (status: TroveStatus, price: bigint, blockNumber: bigint): Trove => ({
  exists: false,
  price,
  blockNumber,
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
 * Read a live Trove, contract-authoritative, from ONE block (MK-013).
 *
 * The price cannot join the batch that consumes it: `getCurrentICR(address, uint256)` takes
 * the price as an argument, so its value has to exist before the call is encoded, and MUSD
 * exposes no zero argument variant. This used to mean a separate price read followed by a
 * multicall at whatever block came next, while the docstring claimed one snapshot.
 *
 * So the price is pinned rather than merged. The first `multicall` returns the price, the
 * block it executed at, and every price INDEPENDENT getter; the second runs `getCurrentICR`
 * with `blockNumber` set to that block. Two round trips, the same as before, and now
 * genuinely one state. Never recomputes live debt or interest client-side.
 */
export async function getTrove(deps: ReadDeps, address: Address): Promise<Trove> {
  const { publicClient, addresses } = deps
  const tm = { address: addresses.troveManager, abi: troveManagerAbi as Abi } as const
  const snapshot = await readPriceSnapshot(deps, [
    { ...tm, functionName: 'getEntireDebtAndColl', args: [address] },
    { ...tm, functionName: 'getNominalICR', args: [address] },
    { ...tm, functionName: 'getTroveInterestRate', args: [address] },
    { ...tm, functionName: 'getTroveStatus', args: [address] },
  ])
  const { price, blockNumber } = snapshot
  // `multicall` with `allowFailure: false` returns results positionally; the tuple shape
  // comes from the `contracts` array above, which is why the cast is narrow and local.
  const [edc, nominalICR, rate, statusRaw] = snapshot.extra as [
    readonly [bigint, bigint, bigint, bigint, bigint, bigint],
    bigint,
    number,
    number,
  ]
  const [icr] = (await readAtSnapshot(publicClient, blockNumber, [
    { ...tm, functionName: 'getCurrentICR', args: [address, price] },
  ])) as [bigint]

  // getEntireDebtAndColl → (coll, principal, interest, pendingColl, pendingPrincipal, pendingInterest).
  // Everything here is computed TO NOW (C3): we deliberately do NOT use
  // getTroveInterestOwed/getTroveDebt, those return the STORED (stale) snapshot, which
  // does not advance until the Trove is touched (verified on the fork: after a 30-day
  // warp, getTroveInterestOwed stayed 0 while getEntireDebtAndColl.interest grew).
  // entireDebt = principal + interest == the debt getCurrentICR uses (proven via computeCR).
  const [coll, principal, interestOwed] = edc
  const entireDebt = principal + interestOwed
  const status = statusRaw as TroveStatus

  if (status !== TroveStatus.active || entireDebt === 0n) {
    return zeroTrove(status, price, blockNumber)
  }

  const liquidationPrice = (MCR * entireDebt) / coll
  // Fixed-point first, then to number, so huge ICRs don't lose precision.
  const healthFactor = Number((icr * 1_000_000n) / MCR) / 1_000_000

  return {
    exists: true,
    price,
    blockNumber,
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
