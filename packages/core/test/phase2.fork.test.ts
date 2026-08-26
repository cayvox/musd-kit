import { type Address, zeroAddress } from 'viem'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  MCR,
  MULTICALL3_ADDRESS,
  MUSD_GAS_COMPENSATION,
  TroveStatus,
  createMusdClient,
  getAddresses,
  hintHelpersAbi,
  priceFeedAbi,
  sortedTrovesAbi,
  troveManagerAbi,
} from '../src'
import { connectFork } from './harness'
import { openTroveRaw, testAccount } from './harness/openTroveRaw'

const T = getAddresses(31611)

function client() {
  return createMusdClient({ chainId: 31611, publicClient: connectFork().publicClient })
}

/** Read every field straight from the contract getters for an independent comparison. */
async function directRead(addr: Address) {
  const { publicClient } = connectFork()
  const price = await publicClient.readContract({
    address: T.priceFeed,
    abi: priceFeedAbi,
    functionName: 'fetchPrice',
  })
  const tm = { address: T.troveManager, abi: troveManagerAbi } as const
  const [edc, icr, nicr, storedInterest, rate, status] = await Promise.all([
    publicClient.readContract({ ...tm, functionName: 'getEntireDebtAndColl', args: [addr] }),
    publicClient.readContract({ ...tm, functionName: 'getCurrentICR', args: [addr, price] }),
    publicClient.readContract({ ...tm, functionName: 'getNominalICR', args: [addr] }),
    publicClient.readContract({ ...tm, functionName: 'getTroveInterestOwed', args: [addr] }),
    publicClient.readContract({ ...tm, functionName: 'getTroveInterestRate', args: [addr] }),
    publicClient.readContract({ ...tm, functionName: 'getTroveStatus', args: [addr] }),
  ])
  return {
    price,
    coll: edc[0],
    principal: edc[1],
    interest: edc[2],
    entireDebt: edc[1] + edc[2],
    icr,
    nicr,
    storedInterest, // getTroveInterestOwed, the STALE stored value (C3)
    rate,
    status,
  }
}

function computeCR(coll: bigint, debt: bigint, price: bigint) {
  return connectFork().publicClient.readContract({
    address: T.hintHelpers,
    abi: hintHelpersAbi,
    functionName: 'computeCR',
    args: [coll, debt, price],
  })
}

let freshAddr: Address
let nearAddr: Address

describe('Phase 2, read/ live position via contract getters', () => {
  // Keep the oracle fresh before every test (anvil advances block time by wall-clock).
  beforeEach(() => connectFork().mineBlocks(1))

  beforeAll(async () => {
    const fork = connectFork()
    // Fresh, comfortable position (~290% ICR).
    const fresh = testAccount(11)
    // numTrials:15 keeps these opens fast, Phase 2 only needs troves to read; hint
    // quality/heuristic is Phase 3's concern.
    await openTroveRaw(fork, {
      collateralBtc: 10n ** 17n, // 0.1 BTC
      debtMusd: 2_000n * 10n ** 18n,
      account: fresh,
      numTrials: 15,
    })
    freshAddr = fresh.address

    // Near-MCR position: derive the draw from the live price to land ~115% ICR.
    const price = await connectFork().publicClient.readContract({
      address: T.priceFeed,
      abi: priceFeedAbi,
      functionName: 'fetchPrice',
    })
    const coll = 5n * 10n ** 16n // 0.05 BTC
    const targetIcr = 1_150_000_000_000_000_000n // 1.15
    const entireDebtTarget = (coll * price) / targetIcr
    const c = client()
    const approxFee = await c.getBorrowingFee(entireDebtTarget)
    const draw = entireDebtTarget - MUSD_GAS_COMPENSATION - approxFee
    const near = testAccount(12)
    await openTroveRaw(fork, { collateralBtc: coll, debtMusd: draw, account: near, numTrials: 15 })
    nearAddr = near.address
  }, 180_000)

  it('fresh position: every field equals the contract getters (to the wei)', async () => {
    const trove = await client().getTrove(freshAddr)
    const d = await directRead(freshAddr)

    expect(trove.exists).toBe(true)
    expect(trove.status).toBe(TroveStatus.active)
    expect(trove.collateral).toBe(d.coll)
    expect(trove.entireDebt).toBe(d.entireDebt)
    expect(trove.principal).toBe(d.principal)
    expect(trove.interestOwed).toBe(d.interest)
    expect(trove.icr).toBe(d.icr)
    expect(trove.nominalICR).toBe(d.nicr)
    expect(trove.interestRate).toBe(d.rate)
    // entireDebt is exactly the debt getCurrentICR uses:
    expect(await computeCR(trove.collateral, trove.entireDebt, d.price)).toBe(d.icr)
  })

  it('near-MCR position: ICR just above MCR, liquidationPrice validated via computeCR', async () => {
    const trove = await client().getTrove(nearAddr)
    const d = await directRead(nearAddr)

    console.log(
      `[phase2] near-MCR icr=${trove.icr} liqPrice=${trove.liquidationPrice} hf=${trove.healthFactor}`,
    )
    expect(trove.icr).toBeGreaterThan(MCR) // not liquidatable
    expect(trove.icr).toBeLessThan(1_300_000_000_000_000_000n) // genuinely near MCR
    expect(trove.isLiquidatable).toBe(false)

    // liquidationPrice is the price at which ICR == MCR: computeCR(coll, entireDebt, liqPrice) == MCR.
    const crAtLiq = await computeCR(trove.collateral, trove.entireDebt, trove.liquidationPrice)
    expect(crAtLiq).toBeGreaterThanOrEqual(MCR - 2n) // ≤2 wei: double integer-flooring
    expect(crAtLiq).toBeLessThanOrEqual(MCR + 2n)

    // healthFactor == icr / MCR (float tolerance).
    expect(Math.abs(trove.healthFactor - Number(d.icr) / Number(MCR))).toBeLessThan(1e-5)
  })

  it('nonexistent trove returns { exists: false } without throwing', async () => {
    const trove = await client().getTrove('0x00000000000000000000000000000000DeaDBeef')
    expect(trove.exists).toBe(false)
    expect(trove.status).toBe(TroveStatus.nonExistent)
    expect(trove.entireDebt).toBe(0n)
    expect(trove.liquidationPrice).toBe(0n)
    expect(trove.isLiquidatable).toBe(false)
  })

  /**
   * MK-013. The price used to be read in its own round trip, then the dependent getters ran
   * at whatever block came next, while the docstrings promised "one consistent price
   * snapshot". These pin that the snapshot is now a fact.
   *
   * The price cannot simply join the batch that consumes it, and that is the reason this
   * shape exists rather than a simpler one: `getTCR(uint256)`, `checkRecoveryMode(uint256)`
   * and `getCurrentICR(address,uint256)` all take the price as an ARGUMENT, verified from
   * the ABI, with no zero argument variant. So the value has to exist before the call using
   * it is encoded. Pinning the second call to the first one's block is what makes the two
   * agree.
   */
  it('MK-013: getSystemState reports the block, and every field is from it', async () => {
    const fork = connectFork()
    const sys = await client().getSystemState()
    const head = await fork.publicClient.getBlockNumber()
    expect(sys.blockNumber).toBeGreaterThan(0n)
    expect(sys.blockNumber).toBeLessThanOrEqual(head)

    // Re-read both dependent getters AT the reported block. If the SDK had taken them at a
    // different block from the price, these would not have to agree.
    const [tcr, rm] = await fork.publicClient.multicall({
      allowFailure: false,
      multicallAddress: MULTICALL3_ADDRESS,
      blockNumber: sys.blockNumber,
      contracts: [
        {
          address: T.troveManager,
          abi: troveManagerAbi,
          functionName: 'getTCR',
          args: [sys.price],
        },
        {
          address: T.troveManager,
          abi: troveManagerAbi,
          functionName: 'checkRecoveryMode',
          args: [sys.price],
        },
      ],
    })
    expect(sys.tcr).toBe(tcr)
    expect(sys.isRecoveryMode).toBe(rm)

    // And the price really is that block's price.
    const priceAtBlock = await fork.publicClient.readContract({
      address: T.priceFeed,
      abi: priceFeedAbi,
      functionName: 'fetchPrice',
      blockNumber: sys.blockNumber,
    })
    expect(sys.price).toBe(priceAtBlock)
  })

  it('MK-013: getTrove pins icr and price to the same block, across a block boundary', async () => {
    const fork = connectFork()
    const first = await fork.publicClient.readContract({
      address: T.sortedTroves,
      abi: sortedTrovesAbi,
      functionName: 'getFirst',
    })
    const trove = await client().getTrove(first)
    expect(trove.exists).toBe(true)

    // Mine, so "latest" is now a different block from the one the read used. The values
    // must still reconcile at the REPORTED block, which is the property being pinned.
    await fork.mineBlocks(2)
    expect(await fork.publicClient.getBlockNumber()).toBeGreaterThan(trove.blockNumber)

    const [icrAtBlock, priceAtBlock] = await Promise.all([
      fork.publicClient.readContract({
        address: T.troveManager,
        abi: troveManagerAbi,
        functionName: 'getCurrentICR',
        args: [first, trove.price],
        blockNumber: trove.blockNumber,
      }),
      fork.publicClient.readContract({
        address: T.priceFeed,
        abi: priceFeedAbi,
        functionName: 'fetchPrice',
        blockNumber: trove.blockNumber,
      }),
    ])
    expect(trove.icr).toBe(icrAtBlock)
    expect(trove.price).toBe(priceAtBlock)
  })

  it('getSystemState matches getTCR/checkRecoveryMode at one price snapshot', async () => {
    const sys = await client().getSystemState()
    const { publicClient } = connectFork()
    const tcr = await publicClient.readContract({
      address: T.troveManager,
      abi: troveManagerAbi,
      functionName: 'getTCR',
      args: [sys.price],
    })
    const rm = await publicClient.readContract({
      address: T.troveManager,
      abi: troveManagerAbi,
      functionName: 'checkRecoveryMode',
      args: [sys.price],
    })
    console.log(
      `[phase2] system tcr=${sys.tcr} recoveryMode=${sys.isRecoveryMode} price=${sys.price}`,
    )
    expect(sys.tcr).toBe(tcr)
    expect(sys.isRecoveryMode).toBe(rm)
    expect(sys.price).toBeGreaterThan(0n)
  })

  it('isLiquidatable, getOraclePrice, balanceOf', async () => {
    const c = client()
    expect(await c.isLiquidatable(freshAddr)).toBe(false)
    expect(await c.getOraclePrice()).toBeGreaterThan(0n)
    // The borrower received their MUSD draw.
    expect(await c.balanceOf(freshAddr)).toBeGreaterThan(0n)
  })

  it('reads a real existing trove from SortedTroves (sanity)', async () => {
    const { publicClient } = connectFork()
    const first = await publicClient.readContract({
      address: T.sortedTroves,
      abi: sortedTrovesAbi,
      functionName: 'getFirst',
    })
    if (first === zeroAddress) return // empty list, nothing to read
    const trove = await client().getTrove(first)
    console.log(`[phase2] SortedTroves.first=${first} exists=${trove.exists} icr=${trove.icr}`)
    expect(trove.collateral).toBeGreaterThanOrEqual(0n)
    expect(typeof trove.healthFactor).toBe('number')
  })

  it('interest accrues: warp the clock → entireDebt grows, read live (not stale), liqPrice rises', async () => {
    const fork = connectFork()
    const acct = testAccount(13)
    await openTroveRaw(fork, {
      collateralBtc: 10n ** 17n,
      debtMusd: 2_000n * 10n ** 18n,
      account: acct,
      numTrials: 15,
    })
    const addr = acct.address

    const before = await client().getTrove(addr)
    const priceBefore = await client().getOraclePrice()

    await fork.warpTime(30 * 24 * 60 * 60) // 30 days
    // Refresh the oracle's updatedAt past the warp so fetchPrice isn't "stale".
    await fork.setPrice(priceBefore)

    const after = await client().getTrove(addr)
    const d = await directRead(addr)

    console.log(
      `[phase2] interest: entireDebt ${before.entireDebt} -> ${after.entireDebt}, ` +
        `interestOwed(to-now)=${after.interestOwed}, getTroveInterestOwed(stored)=${d.storedInterest}`,
    )
    expect(after.entireDebt).toBeGreaterThan(before.entireDebt)
    expect(after.interestOwed).toBeGreaterThan(0n)
    expect(after.entireDebt).toBe(d.entireDebt) // read accrued-to-now, not the stale stored value
    expect(after.liquidationPrice).toBeGreaterThan(before.liquidationPrice)
    // C3 proof: the stored getter is stale (still 0) while we report the to-now interest.
    expect(d.storedInterest).toBe(0n)
    expect(after.interestOwed).toBe(d.interest)
  }, 120_000)
})
