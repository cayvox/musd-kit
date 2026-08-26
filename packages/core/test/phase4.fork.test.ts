import type { Address } from 'viem'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  CCR,
  MCR,
  borrowerOperationsAbi,
  computeEntireDebt,
  computeICR,
  createMusdClient,
  getAddresses,
  hintHelpersAbi,
  troveManagerAbi,
} from '../src'
import { connectFork } from './harness'
import { openTroveRaw, testAccount } from './harness/openTroveRaw'

const T = getAddresses(31611)
const GAS = 200n * 10n ** 18n

function client() {
  return createMusdClient({ chainId: 31611, publicClient: connectFork().publicClient })
}

const price = () => client().getOraclePrice()

async function readTrove(addr: Address, p: bigint) {
  const { publicClient } = connectFork()
  const tm = { address: T.troveManager, abi: troveManagerAbi } as const
  const [edc, icr, troves] = await Promise.all([
    publicClient.readContract({ ...tm, functionName: 'getEntireDebtAndColl', args: [addr] }),
    publicClient.readContract({ ...tm, functionName: 'getCurrentICR', args: [addr, p] }),
    publicClient.readContract({ ...tm, functionName: 'Troves', args: [addr] }),
  ])
  return {
    coll: edc[0],
    entireDebt: edc[1] + edc[2],
    icr,
    principal: troves[1],
    rate: troves[5],
    lastUpdate: troves[6],
  }
}

describe('Phase 4, math/ preview compute (M1 dual-validation gate)', () => {
  beforeEach(() => connectFork().refreshOracle())

  it('previewOpen ↔ actual parity to the wei (grid)', async () => {
    const c = client()
    const p = await price()
    const grid: [bigint, bigint][] = [
      [10n ** 17n, 2_000n * 10n ** 18n], // comfortable ~290%
      [2n * 10n ** 17n, 5_000n * 10n ** 18n], // mid
      [5n * 10n ** 16n, 2_600n * 10n ** 18n], // near-MCR-ish
    ]
    for (let i = 0; i < grid.length; i++) {
      const entry = grid[i]
      if (!entry) continue
      const [collateral, debt] = entry
      const preview = await c.previewOpen({ collateral, debt, price: p })
      const acct = testAccount(300 + i)
      await openTroveRaw(connectFork(), {
        collateralBtc: collateral,
        debtMusd: debt,
        account: acct,
        numTrials: 15,
      })
      const actual = await readTrove(acct.address, p)

      expect(preview.entireDebt, `entireDebt @${i}`).toBe(actual.entireDebt)
      expect(preview.netDebt + GAS, `netDebt+gas @${i}`).toBe(actual.entireDebt)
      expect(preview.fee, `fee @${i}`).toBe(actual.entireDebt - debt - GAS)
      expect(preview.icr, `icr @${i}`).toBe(actual.icr)
      expect(actual.coll).toBe(collateral)
      // computeICR == contract computeCR (pure cross-check)
      const cr = await connectFork().publicClient.readContract({
        address: T.hintHelpers,
        abi: hintHelpersAbi,
        functionName: 'computeCR',
        args: [collateral, preview.entireDebt, p],
      })
      expect(computeICR({ collateral, entireDebt: preview.entireDebt, price: p })).toBe(cr)
      // liquidationPrice: computeCR(coll, entireDebt, liqPrice) == MCR (±2 wei flooring)
      const crAtLiq = await connectFork().publicClient.readContract({
        address: T.hintHelpers,
        abi: hintHelpersAbi,
        functionName: 'computeCR',
        args: [collateral, preview.entireDebt, preview.liquidationPrice],
      })
      expect(crAtLiq).toBeGreaterThanOrEqual(MCR - 2n)
      expect(crAtLiq).toBeLessThanOrEqual(MCR + 2n)
    }
  }, 180_000)

  it('minNetDebt boundary: meetsMinimum ⟺ open succeeds (O7)', async () => {
    const c = client()
    const p = await price()
    const coll = 10n ** 17n // 0.1 BTC, ICR comfortably > MCR for both draws

    const under = 1_797n * 10n ** 18n // netDebt = 1797·1.001 ≈ 1798.8 < 1800
    const over = 1_800n * 10n ** 18n // netDebt ≈ 1801.8 ≥ 1800
    const pUnder = await c.previewOpen({ collateral: coll, debt: under, price: p })
    const pOver = await c.previewOpen({ collateral: coll, debt: over, price: p })
    expect(pUnder.meetsMinimum).toBe(false)
    expect(pOver.meetsMinimum).toBe(true)

    await expect(
      openTroveRaw(connectFork(), {
        collateralBtc: coll,
        debtMusd: under,
        account: testAccount(320),
        numTrials: 15,
      }),
    ).rejects.toThrow()
    await expect(
      openTroveRaw(connectFork(), {
        collateralBtc: coll,
        debtMusd: over,
        account: testAccount(321),
        numTrials: 15,
      }),
    ).resolves.toMatchObject({ owner: testAccount(321).address })
  }, 120_000)

  /**
   * MK-010. The claim the closed form rests on, stated against the contract rather than in a
   * comment: `getBorrowingFee(d) == borrowingRate() * d / DECIMAL_PRECISION()`, exactly.
   *
   * This test exists because that is a property of the CURRENT implementation and not a
   * guarantee: `borrowingRate` is governable, `proposeBorrowingRate` and
   * `approveBorrowingRate` are both on the ABI. If governance ever makes the fee non linear,
   * this fails, which is the signal to check that the fallback search is doing the work.
   */
  it('MK-010: the borrowing fee is linear in the draw AT THE CURRENT RATE', async () => {
    const { publicClient } = connectFork()
    const bo = { address: T.borrowerOperations, abi: borrowerOperationsAbi } as const
    const [rate, precision] = await Promise.all([
      publicClient.readContract({ ...bo, functionName: 'borrowingRate' }),
      publicClient.readContract({ ...bo, functionName: 'DECIMAL_PRECISION' }),
    ])
    // 1000 is included on purpose: at the live rate it is the smallest sample where the
    // floor division is visible, so a formula that rounded differently would show here.
    const samples = [1n, 7n, 1000n, 10n ** 18n, 1_234_567_890_123_456_789n, 5000n * 10n ** 18n]
    for (const d of samples) {
      const fee = await publicClient.readContract({
        ...bo,
        functionName: 'getBorrowingFee',
        args: [d],
      })
      expect(fee, `getBorrowingFee(${d})`).toBe((rate * d) / precision)
    }
    console.log(`[phase4] borrowingRate=${rate} DECIMAL_PRECISION=${precision} (linear, floored)`)
  })

  it('MK-010: the closed form equals the binary search, to the wei', async () => {
    const { publicClient } = connectFork()
    const musd = client()
    const price = await musd.getOraclePrice()

    for (const collateral of [10n ** 17n, 5n * 10n ** 16n, 10n ** 18n, 3n * 10n ** 18n]) {
      // The reference: the ORIGINAL algorithm, monotonic binary search calling the real
      // getBorrowingFee every step. Kept here rather than in src so the comparison is
      // against the implementation this replaced, not against a shared helper that could
      // drift with it.
      const [isRecoveryMode, systemColl, systemDebt, minNetDebt] = await Promise.all([
        publicClient.readContract({
          address: T.troveManager,
          abi: troveManagerAbi,
          functionName: 'checkRecoveryMode',
          args: [price],
        }),
        publicClient.readContract({
          address: T.troveManager,
          abi: troveManagerAbi,
          functionName: 'getEntireSystemColl',
        }),
        publicClient.readContract({
          address: T.troveManager,
          abi: troveManagerAbi,
          functionName: 'getEntireSystemDebt',
        }),
        musd.getConstants().then((c) => c.minNetDebt),
      ])
      const target = isRecoveryMode ? CCR : MCR
      const feeOf = (draw: bigint) =>
        publicClient.readContract({
          address: T.borrowerOperations,
          abi: borrowerOperationsAbi,
          functionName: 'getBorrowingFee',
          args: [draw],
        })
      const feasible = async (draw: bigint) => {
        const entireDebt = draw + (await feeOf(draw)) + GAS
        if (computeICR({ collateral, entireDebt, price }) < target) return false
        if (isRecoveryMode) return true
        return (
          computeICR({
            collateral: systemColl + collateral,
            entireDebt: systemDebt + entireDebt,
            price,
          }) >= CCR
        )
      }
      let lo = 0n
      let hi = (collateral * price) / target - GAS
      while (lo < hi) {
        const mid = (lo + hi + 1n) / 2n
        if (await feasible(mid)) lo = mid
        else hi = mid - 1n
      }
      const searched = lo + (await feeOf(lo)) < minNetDebt ? 0n : lo

      expect(await musd.getBorrowingPower({ collateral, price }), `collateral=${collateral}`).toBe(
        searched,
      )
    }
  })

  it('getBorrowingPower boundary: max opens (ICR ≥ MCR), max+1 MUSD breaches', async () => {
    const c = client()
    const p = await price()
    const colls = [10n ** 17n, 5n * 10n ** 16n] // 0.1, 0.05 BTC
    for (let i = 0; i < colls.length; i++) {
      const collateral = colls[i]
      if (!collateral) continue
      const maxDraw = await c.getBorrowingPower({ collateral, price: p })
      expect(maxDraw).toBeGreaterThan(0n)
      console.log(`[phase4] borrowingPower(${collateral}) = ${maxDraw}`)

      // At max → opens, ICR ≥ MCR.
      const okAcct = testAccount(330 + i)
      await openTroveRaw(connectFork(), {
        collateralBtc: collateral,
        debtMusd: maxDraw,
        account: okAcct,
        numTrials: 15,
      })
      const t = await readTrove(okAcct.address, p)
      expect(t.icr).toBeGreaterThanOrEqual(MCR)

      // At max + 1 MUSD → ICR < MCR → reverts.
      await expect(
        openTroveRaw(connectFork(), {
          collateralBtc: collateral,
          debtMusd: maxDraw + 10n ** 18n,
          account: testAccount(340 + i),
          numTrials: 15,
        }),
      ).rejects.toThrow()
    }
  }, 180_000)

  it('interest projection matches getEntireDebtAndColl after a warp (C3)', async () => {
    const fork = connectFork()
    const c = client()
    const draw = 5_000n * 10n ** 18n
    const acct = testAccount(350)
    await openTroveRaw(fork, {
      collateralBtc: 10n ** 17n,
      debtMusd: draw,
      account: acct,
      numTrials: 15,
    })
    const fee = await c.getBorrowingFee(draw)
    const t0 = await readTrove(acct.address, await price())

    await fork.warpTime(45 * 24 * 60 * 60) // 45 days

    const after = await readTrove(acct.address, await price())
    const block = await fork.publicClient.getBlock({ blockTag: 'latest' })
    const elapsedSec = block.timestamp - t0.lastUpdate // lastUpdate is unchanged until the Trove is touched

    const projected = computeEntireDebt({
      draw,
      fee,
      rate: Number(t0.rate),
      elapsedSeconds: elapsedSec,
    })
    const delta =
      projected > after.entireDebt ? projected - after.entireDebt : after.entireDebt - projected
    console.log(
      `[phase4] interest projection: projected=${projected} actual=${after.entireDebt} Δ=${delta}`,
    )
    expect(delta).toBeLessThanOrEqual(2n) // ≤2 wei: integer rounding order
  }, 120_000)

  it('Recovery Mode: previewOpen reflects RM and the CCR open rule; borrowing power binds on CCR', async () => {
    const fork = connectFork()
    const c = client()
    const original = await price()
    try {
      // Induce RM by dropping BTC price on the shim until system TCR < CCR (150%).
      await fork.setPrice(40_000n * 10n ** 18n)
      const sys = await c.getSystemState()
      expect(sys.isRecoveryMode, 'RM induced').toBe(true)
      const p = sys.price

      const coll = 10n ** 17n // 0.1 BTC = $4000 at $40k
      // ICR between MCR and CCR (~1.3): not allowed to open in RM.
      const midDebt = (coll * p) / 1_300_000_000_000_000_000n - GAS
      const pvMid = await c.previewOpen({ collateral: coll, debt: midDebt, price: p })
      expect(pvMid.isRecoveryMode).toBe(true)
      // MK-005: `meetsRecoveryRequirement` is replaced by an explicit verdict plus reasons.
      expect(pvMid.viable).toBe(false)
      expect(pvMid.reasons).toContain('ICR_BELOW_THRESHOLD')
      await expect(
        openTroveRaw(fork, {
          collateralBtc: coll,
          debtMusd: midDebt,
          account: testAccount(360),
          numTrials: 15,
        }),
      ).rejects.toThrow()

      // ICR ≥ CCR (~1.7): allowed.
      const safeDebt = (coll * p) / 1_700_000_000_000_000_000n - GAS
      const pvSafe = await c.previewOpen({ collateral: coll, debt: safeDebt, price: p })
      expect(pvSafe.viable).toBe(true)
      expect(pvSafe.reasons).toEqual([])
      await openTroveRaw(fork, {
        collateralBtc: coll,
        debtMusd: safeDebt,
        account: testAccount(361),
        numTrials: 15,
      })
      expect((await c.getTrove(testAccount(361).address)).exists).toBe(true)

      // Borrowing power in RM binds on CCR (lower draw than it would at MCR).
      const bpRM = await c.getBorrowingPower({ collateral: coll, price: p })
      const entireAtBp = bpRM + (await c.getBorrowingFee(bpRM)) + GAS
      expect(
        computeICR({ collateral: coll, entireDebt: entireAtBp, price: p }),
      ).toBeGreaterThanOrEqual(CCR - 1n)
    } finally {
      await fork.setPrice(original)
    }
  }, 180_000)
})
