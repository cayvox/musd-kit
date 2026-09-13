import { http, createWalletClient } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  BORROWING_POWER_MARGIN_WINDOW_SECONDS,
  BORROWING_POWER_PRICE_MOVE_BPS,
  CCR,
  MCR,
  TroveStatus,
  createMusdClient,
  troveManagerAbi,
} from '../src'
import { connectFork } from './harness'
import { mezoTestnet } from './harness/constants'
import { testAccount } from './harness/openTroveRaw'

const MUSD = 10n ** 18n
const BTC = 10n ** 18n

/**
 * `getBorrowingPower`, opened at and then left alone (MK-100).
 *
 * **Why this exists.** Every earlier check of this function asked whether the contract ACCEPTS the
 * number: `borrowing-power-agreement.test.ts` pins that the answer is viable and one wei more is
 * not, `phase4.fork.test.ts` opens at it in Recovery Mode, and the differential sweep compares a
 * verdict against a revert. None of them asks what happens AFTER the open succeeds, and the open
 * does succeed. This file asks.
 *
 * **What it measures.** In normal mode with the individual ratio binding, the reported maximum
 * opens the position at exactly `MCR`. An open accrues no interest before its ratio check
 * (`BorrowerOperations.sol:648-657`), so the figure is still accepted a block later. Liquidation
 * is `ICR < MCR` (`TroveManager.sol:1146-1148`) against a debt that accrues every second
 * (`TroveManager.sol:1513-1527`). The ladder below sends the open, then varies only the delay, and
 * reports the liquidation predicate for the position at the maximum and for a control position at
 * 80% of it. Then a keeper actually liquidates.
 *
 * **Since 0.4.0 the function returns two figures, and this file proves both** (MK-100). The
 * `ceiling` is the figure 0.3.1 returned, and every assertion about it is kept exactly: it still
 * lands on MCR and is still liquidated. The `recommended` figure is opened beside it and must NOT be
 * liquidatable after 1 second, 1 minute and 1 hour, which is the window
 * `BORROWING_POWER_MARGIN_WINDOW_SECONDS` states. Then the price part of the margin is proven the
 * same way from both sides: an hour later, a fall a hair inside `BORROWING_POWER_PRICE_MOVE_BPS`
 * leaves the recommended Trove safe, and a fall a little past it makes it liquidatable, so a margin
 * that silently grew or shrank goes red here.
 *
 * The `zz-` prefix is for ORDER, not for the `it.fails` convention of `zz-findings.fork.test.ts`:
 * the fork project runs files alphabetically on one shared anvil (MK-016), and this file warps the
 * clock, so it runs after every file that assumes a fresh one. Every warp is inside a snapshot and
 * reverted.
 */
describe('MK-100, the borrowing power ceiling is the liquidation threshold, and the recommended figure is not', () => {
  it('the ceiling is liquidatable a second later and is liquidated; the recommended figure survives the window', async () => {
    const fork = connectFork()
    const opener = testAccount(10_001)
    const control = testAccount(10_002)
    const keeper = testAccount(10_003)
    const safe = testAccount(10_005)
    for (const a of [opener, control, keeper, safe]) await fork.fundAccount(a.address, 20n * BTC)
    const clientFor = (account: typeof opener) =>
      createMusdClient({
        chainId: 31611,
        publicClient: fork.publicClient,
        walletClient: createWalletClient({
          account,
          chain: mezoTestnet,
          transport: http(fork.rpcUrl),
        }),
      })
    const openerClient = clientFor(opener)
    const controlClient = clientFor(control)
    const keeperClient = clientFor(keeper)
    const safeClient = clientFor(safe)

    const outer = await fork.testClient.snapshot()
    try {
      const system = await openerClient.getSystemState()
      expect(system.isRecoveryMode, 'fixture: the finding is about normal mode').toBe(false)

      const collateral = 1n * BTC
      const detail = await openerClient.getBorrowingPower({ collateral, account: opener.address })
      const power = detail.ceiling
      const safeDetail = await safeClient.getBorrowingPower({ collateral, account: safe.address })
      const recommended = safeDetail.recommended
      expect(safeDetail.ceiling, 'fixture: neither account is fee exempt').toBe(power)
      expect(safeDetail.margin.windowSeconds).toBe(BORROWING_POWER_MARGIN_WINDOW_SECONDS)
      expect(safeDetail.margin.priceMoveBps).toBe(BORROWING_POWER_PRICE_MOVE_BPS)
      expect(recommended, 'fixture: recommended is under the ceiling').toBeLessThan(power)
      const controlDraw = (power * 80n) / 100n
      expect(controlDraw, 'fixture: the control draw must clear the debt floor').toBeGreaterThan(
        1_800n * MUSD,
      )

      // Routed through the SDK, exactly as an integrator would: the reported number handed
      // straight to the write that consumes it. The control opens FIRST and the position at the
      // maximum LAST, and the maximum is read before anything else mines: `getTrove` reads the
      // latest block, and the first draft of this file read it one block after the open, where
      // the ratio had already fallen under MCR. That observation is the finding, but it is not
      // the at-open measurement, so it is not asserted as one.
      //
      // Each open is sent one second AFTER the number was read. A real chain cannot include a
      // transaction in the block the number was read at, and the harness would otherwise mine
      // in the same wall clock second some of the time (MK-051's `warp 0s` lesson).
      for (const [client, draw] of [
        [controlClient, controlDraw],
        [safeClient, recommended],
        [openerClient, power],
      ] as const) {
        await fork.warpTime(1)
        const { hash } = await client.openTrove({ collateral, debt: draw })
        const receipt = await fork.publicClient.waitForTransactionReceipt({ hash })
        expect(receipt.status, 'the open at the reported figure must succeed').toBe('success')
      }

      const atOpen = await openerClient.getTrove(opener.address)
      const controlAtOpen = await controlClient.getTrove(control.address)
      const safeAtOpen = await safeClient.getTrove(safe.address)

      let base = await fork.testClient.snapshot()
      const rows: string[] = []
      const liquidatableAfter = new Map<number, [boolean, boolean, boolean]>()
      for (const seconds of [1, 60, 600, 3600]) {
        await fork.warpTime(seconds)
        const atMax = await keeperClient.isLiquidatable(opener.address)
        const atControl = await keeperClient.isLiquidatable(control.address)
        const atRecommended = await keeperClient.isLiquidatable(safe.address)
        liquidatableAfter.set(seconds, [atMax, atControl, atRecommended])
        rows.push(
          `  warp ${String(seconds).padStart(5)}s  ceiling liquidatable=${String(atMax).padEnd(5)}  recommended liquidatable=${String(atRecommended).padEnd(5)}  control(80%) liquidatable=${atControl}`,
        )
        await fork.testClient.revert({ id: base })
        base = await fork.testClient.snapshot()
      }

      // The price part of the margin, an hour in, from both sides. 199 bps is inside the stated
      // move and 210 bps is outside it; the recommended Trove must be safe at the first and
      // liquidatable at the second, which is what makes the margin the stated one and no other.
      const inside = BORROWING_POWER_PRICE_MOVE_BPS - 1n
      const outside = BORROWING_POWER_PRICE_MOVE_BPS + 10n
      const stress = new Map<bigint, boolean>()
      for (const bps of [inside, outside]) {
        await fork.warpTime(Number(BORROWING_POWER_MARGIN_WINDOW_SECONDS))
        await fork.setPrice((atOpen.price * (10_000n - bps)) / 10_000n)
        stress.set(bps, await keeperClient.isLiquidatable(safe.address))
        rows.push(
          `  warp ${BORROWING_POWER_MARGIN_WINDOW_SECONDS}s and a ${bps} bps fall  recommended liquidatable=${stress.get(bps)}`,
        )
        await fork.testClient.revert({ id: base })
        base = await fork.testClient.snapshot()
      }

      await fork.warpTime(1)
      const { hash: liquidationHash } = await keeperClient.liquidate(opener.address)
      const liquidation = await fork.publicClient.waitForTransactionReceipt({
        hash: liquidationHash,
      })
      const after = await openerClient.getTrove(opener.address)
      const keptMusd = await openerClient.balanceOf(opener.address)

      console.log(
        [
          `[MK-100] getBorrowingPower(1 BTC) ceiling=${power} recommended=${recommended} at price=${atOpen.price}`,
          `  margin: ${safeDetail.margin.priceMoveBps} bps, ${safeDetail.margin.windowSeconds}s at ${safeDetail.margin.interestRateBps} bps interest, stressedPrice=${safeDetail.margin.stressedPrice}`,
          `  at open: ceiling icr=${atOpen.icr} (MCR=${MCR})  recommended icr=${safeAtOpen.icr} (reported ${safeDetail.recommendedIcr})  control icr=${controlAtOpen.icr}`,
          ...rows,
          `  liquidate(max) after 1s: receipt=${liquidation.status} status=${after.status} opener MUSD kept=${keptMusd}`,
        ].join('\n'),
      )

      // The reported maximum lands on the threshold itself, not near it.
      expect(atOpen.icr, 'the maximum opens at or above MCR').toBeGreaterThanOrEqual(MCR)
      expect(
        atOpen.icr - MCR,
        'and within a few wei of MCR: there is no margin to speak of',
      ).toBeLessThanOrEqual(1_000n)

      for (const seconds of [1, 60, 600, 3600]) {
        const [atMax, atControl, atRecommended] = liquidatableAfter.get(seconds) as [
          boolean,
          boolean,
          boolean,
        ]
        expect(atMax, `the position at the ceiling is liquidatable after ${seconds}s`).toBe(true)
        expect(atControl, `the control at 80% is not liquidatable after ${seconds}s`).toBe(false)
        expect(
          atRecommended,
          `the position at the recommended figure is NOT liquidatable after ${seconds}s`,
        ).toBe(false)
      }

      // The recommended Trove opens where the result said it would. `getTrove` reads it after the
      // ceiling's open has mined, a few seconds of interest later, so the observed ratio sits under
      // the at-open projection by that accrual (about 3e-10 of the ratio a second at 1%) and never
      // above it. The margin itself, `recommendedIcr >= MCR * price / stressedPrice`, is pinned
      // exactly in `borrowing-power-agreement.test.ts`.
      expect(safeAtOpen.icr, 'no higher than the projected at-open ICR').toBeLessThanOrEqual(
        safeDetail.recommendedIcr,
      )
      expect(
        safeDetail.recommendedIcr - safeAtOpen.icr,
        'and under it by interest, not by a different draw',
      ).toBeLessThan(safeDetail.recommendedIcr / 10n ** 8n)
      expect(safeDetail.recommendedIcr).toBeGreaterThanOrEqual(
        (MCR * safeDetail.price) / safeDetail.margin.stressedPrice,
      )
      expect(stress.get(inside), `a ${inside} bps fall an hour later leaves it safe`).toBe(false)
      expect(stress.get(outside), `a ${outside} bps fall an hour later does not`).toBe(true)

      expect(liquidation.status, 'a keeper can liquidate it').toBe('success')
      expect(after.status, 'and the Trove is closed by liquidation').toBe(
        TroveStatus.closedByLiquidation,
      )
      expect(keptMusd, 'the borrower keeps only the MUSD drawn; the collateral is gone').toBe(power)
    } finally {
      await fork.testClient.revert({ id: outer })
    }
  }, 900_000)

  /**
   * The two regimes where the maximum does NOT land on MCR, measured so the warning can say
   * exactly what they are rather than widening or narrowing the claim by assumption.
   *
   *   Recovery Mode: the open gate is `ICR >= CCR` (`BorrowerOperations.sol:654-655`), so the
   *     maximum lands on CCR, which is not a liquidation threshold (`TroveManager.sol:1146-1148`).
   *   System ratio binding: in normal mode the open also needs a resulting `TCR >= CCR`
   *     (`:658-665`), against a system debt that accrues every second (`ActivePool.sol:134-144`
   *     adds `interestRateManager.getAccruedInterest()`). So the exact TCR maximum does not
   *     survive to the next block: the open is REFUSED, loudly, rather than accepted and exposed.
   *     The first draft of this test assumed the opposite from an uncommitted script whose open
   *     happened to mine in the same wall clock second; this is the measurement that replaced it.
   */
  it('lands on CCR in Recovery Mode, and is refused a block later when the system ratio binds', async () => {
    const fork = connectFork()
    const opener = testAccount(10_004)
    const client = createMusdClient({
      chainId: 31611,
      publicClient: fork.publicClient,
      walletClient: createWalletClient({
        account: opener,
        chain: mezoTestnet,
        transport: http(fork.rpcUrl),
      }),
    })
    const open = async (collateral: bigint, debt: bigint) => {
      const { hash } = await client.openTrove({ collateral, debt })
      const receipt = await fork.publicClient.waitForTransactionReceipt({ hash })
      expect(receipt.status, 'the open at the reported figure must succeed').toBe('success')
    }

    const outer = await fork.testClient.snapshot()
    const rows: string[] = []
    try {
      const start = await client.getSystemState()

      // Recovery Mode: move the price so the system TCR is 1.40.
      let base = await fork.testClient.snapshot()
      await fork.setPrice((start.price * 140n) / ((start.tcr * 100n) / 10n ** 18n))
      const rm = await client.getSystemState()
      expect(rm.isRecoveryMode, 'fixture: Recovery Mode').toBe(true)
      await fork.fundAccount(opener.address, 20n * BTC)
      const { ceiling: rmPower } = await client.getBorrowingPower({ collateral: 1n * BTC })
      await fork.warpTime(1)
      await open(1n * BTC, rmPower)
      const rmTrove = await client.getTrove(opener.address)
      await fork.warpTime(3600)
      const rmLiquidatable = await client.isLiquidatable(opener.address)
      rows.push(
        `  Recovery Mode (tcr=${rm.tcr}): power=${rmPower} icr at open=${rmTrove.icr} (CCR=${CCR}) liquidatable after 3600s=${rmLiquidatable}`,
      )
      expect(rmTrove.icr, 'Recovery Mode: lands at or above CCR').toBeGreaterThanOrEqual(CCR)
      expect(rmTrove.icr - CCR, 'Recovery Mode: and within a few wei of CCR').toBeLessThanOrEqual(
        1_000n,
      )
      expect(rmLiquidatable, 'Recovery Mode: CCR is not a liquidation threshold').toBe(false)
      await fork.testClient.revert({ id: base })

      // System ratio binding: price so TCR is 1.55, and enough collateral that the TCR cap is
      // the smaller one. From the two caps in `solveClosedForm`, that needs
      // collateral > (systemColl * price / CCR - systemDebt) / (price / MCR - price / CCR).
      base = await fork.testClient.snapshot()
      await fork.setPrice((start.price * 155n) / ((start.tcr * 100n) / 10n ** 18n))
      const near = await client.getSystemState()
      expect(near.isRecoveryMode, 'fixture: normal mode near CCR').toBe(false)
      const systemColl = (await fork.publicClient.readContract({
        address: client.addresses.troveManager,
        abi: troveManagerAbi,
        functionName: 'getEntireSystemColl',
      })) as bigint
      const systemDebt = (await fork.publicClient.readContract({
        address: client.addresses.troveManager,
        abi: troveManagerAbi,
        functionName: 'getEntireSystemDebt',
      })) as bigint
      const p = near.price
      const numerator = (systemColl * p) / CCR - systemDebt
      const perBtc = (BTC * p) / MCR - (BTC * p) / CCR
      const collateral = ((numerator * BTC) / perBtc) * 2n + BTC
      await fork.fundAccount(opener.address, collateral + 10n * BTC)
      const tcrDetail = await client.getBorrowingPower({ collateral })
      const tcrPower = tcrDetail.ceiling
      const icrOnlyCap = (collateral * p) / MCR
      await fork.warpTime(1)
      let sent: string
      try {
        const { hash } = await client.openTrove({ collateral, debt: tcrPower })
        sent = (await fork.publicClient.waitForTransactionReceipt({ hash })).status
      } catch (error) {
        sent = `threw(${(error as Error).name})`
      }
      rows.push(
        `  System ratio binding (collateral=${collateral}, tcr=${near.tcr}): power=${tcrPower} vs the ICR-only cap ${icrOnlyCap}; open sent 1s later: ${sent}`,
      )
      expect(
        tcrPower + 10n ** 21n,
        'fixture: the system ratio, not the ICR, must be what binds',
      ).toBeLessThan(icrOnlyCap)
      expect(sent, 'system ratio binding: the exact maximum is refused a block later').toBe(
        'threw(SystemRatioBelowCCR)',
      )
      // The recommended figure is solved at the stressed price, where the system ratio cap is
      // lower by the margin, so it is ACCEPTED a block later where the ceiling was refused (MK-100).
      await fork.warpTime(1)
      let recommendedSent: string
      try {
        const { hash } = await client.openTrove({ collateral, debt: tcrDetail.recommended })
        recommendedSent = (await fork.publicClient.waitForTransactionReceipt({ hash })).status
      } catch (error) {
        recommendedSent = `threw(${(error as Error).name})`
      }
      rows.push(
        `  System ratio binding: recommended=${tcrDetail.recommended}; open sent 1s later: ${recommendedSent}`,
      )
      expect(recommendedSent, 'system ratio binding: the recommended figure opens').toBe('success')
      await fork.testClient.revert({ id: base })
    } finally {
      console.log(['[MK-100] the regimes that do not land on MCR', ...rows].join('\n'))
      await fork.testClient.revert({ id: outer })
    }
  }, 900_000)
})
