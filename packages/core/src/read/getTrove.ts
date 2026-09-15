import type { Abi, Address } from 'viem'
import { troveManagerAbi } from '../clients'
import { computeLiquidationPrice, getHealthFactor, isTroveLiquidatable } from '../math/compute'
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
    // MK-074. Price independent, so it rides in the first batch with the rest.
    { ...tm, functionName: 'getTroveOwnersCount' },
  ])
  const { price, blockNumber } = snapshot
  // `multicall` with `allowFailure: false` returns results positionally; the tuple shape
  // comes from the `contracts` array above, which is why the cast is narrow and local.
  const [edc, nominalICR, rate, statusRaw, troveOwnersCount] = snapshot.extra as [
    readonly [bigint, bigint, bigint, bigint, bigint, bigint],
    bigint,
    number,
    number,
    bigint,
  ]
  const [icr] = (await readAtSnapshot(publicClient, blockNumber, [
    { ...tm, functionName: 'getCurrentICR', args: [address, price] },
  ])) as [bigint]

  // getEntireDebtAndColl → (coll, principal, interest, pendingColl, pendingPrincipal, pendingInterest).
  // Everything here is computed TO NOW (C3): we deliberately do NOT use
  // getTroveInterestOwed, which returns the STORED interest and does not advance until the Trove
  // is touched (`TroveManager.sol:613-617`; verified on the fork: after a 30-day warp it stayed 0
  // while getEntireDebtAndColl.interest grew). getTroveDebt DOES accrue to the block
  // (`:591-595` into `_getTotalDebt`, `:1513-1527`), and until MK-246 this comment said it did not;
  // what it omits is pending redistribution, which getEntireDebtAndColl folds in (`:796-801`).
  // entireDebt = principal + interest == the debt getCurrentICR uses (proven via computeCR).
  const [coll, principal, interestOwed] = edc
  const entireDebt = principal + interestOwed
  const status = statusRaw as TroveStatus

  if (status !== TroveStatus.active || entireDebt === 0n) {
    return zeroTrove(status, price, blockNumber)
  }

  // MK-017: single sourced. These two derivations used to be written out again here, so the
  // same formula lived in `math/compute.ts` and in this file, and a correction to one would
  // have silently missed the other. They feed numbers a user acts on, which is why the pure
  // functions are the only copy now.
  const liquidationPrice = computeLiquidationPrice({ collateral: coll, entireDebt })
  const healthFactor = getHealthFactor({ icr })

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
    // MK-001 and MK-074, through the one predicate rather than inlined here. `getTrove` and
    // `isLiquidatable` are two APIs answering one question and this is what keeps the answer one.
    isLiquidatable: isTroveLiquidatable({ icr, troveOwnersCount }),
    interestRate: rate,
    status,
  }
}
