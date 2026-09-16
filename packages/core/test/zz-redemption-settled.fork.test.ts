import { http, type Address, createWalletClient, parseEventLogs } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  MCR,
  MUSD_GAS_COMPENSATION,
  createMusdClient,
  getAddresses,
  hintHelpersAbi,
  sortedTrovesAbi,
  troveManagerAbi,
} from '../src'
import { connectFork } from './harness'
import { mezoTestnet } from './harness/constants'
import { testAccount } from './harness/openTroveRaw'

const T = getAddresses(31611)
const MUSD = 10n ** 18n
const BTC = 10n ** 18n
const ZERO = '0x0000000000000000000000000000000000000000' as const

/**
 * MK-241, by sending: a redemption whose result used to report the hint helper's figures.
 *
 * **The shape.** The amount consumes the first eligible Trove whole and then falls in the SECOND
 * Trove's floor gap: too large for a partial that leaves that Trove at or above `minNetDebt`, too small
 * to consume it. The loop consumes the first (`TroveManager.sol:1252`), cancels the partial on the
 * second (`:1299-1306`), stops (`:392`), and succeeds because something was drawn (`:406-408`). The
 * hint helper sizes the second Trove's partial to its headroom and carries on (`HintHelpers.sol:138-162`),
 * so its `truncatedAmount` is far above what settles. Until 0.5.0 `redeem()` returned that figure, and a
 * fee estimated from it.
 *
 * **What is asserted.** `settled` equals the `Redemption` event field for field, with `_collateralSent`
 * read as collateral drawn including the fee (`:420-425`); `settled.redeemedAmount` is the MUSD that left
 * the caller's balance; `settled.collateralReceived` is the BTC that arrived, net of the gas the send
 * paid; and the helper's figure for the same amount at the same state is larger than what settled, which
 * is the defect the result no longer carries.
 *
 * `zz-` for order: it moves nothing but it consumes a Trove, and every reading reverts to a snapshot.
 */
describe('MK-241, a redemption result reports what settled', () => {
  it('a redemption that cancels a later partial reports the amount and fee from its receipt', async () => {
    const fork = connectFork()
    const account = testAccount(24_101)
    await fork.fundAccount(account.address, 80n * BTC)
    const client = createMusdClient({
      chainId: 31611,
      publicClient: fork.publicClient,
      walletClient: createWalletClient({
        account,
        chain: mezoTestnet,
        transport: http(fork.rpcUrl),
      }),
    })
    const tm = { address: T.troveManager, abi: troveManagerAbi } as const

    const outer = await fork.testClient.snapshot()
    try {
      // MUSD to redeem with, drawn from a position of our own whose ratio keeps it off the tail.
      const seed = await fork.publicClient.waitForTransactionReceipt({
        hash: (await client.openTrove({ collateral: 60n * BTC, debt: 400_000n * MUSD })).hash,
      })
      expect(seed.status, 'fixture: the seeding open must succeed').toBe('success')

      const price = await client.getOraclePrice()
      // The first two eligible Troves, walked the way the loop walks them: from the tail, skipping
      // anything under MCR (`TroveManager.sol:338-350`, `:374-378`).
      const eligible: { owner: Address; netDebt: bigint }[] = []
      let cursor = (await fork.publicClient.readContract({
        address: T.sortedTroves,
        abi: sortedTrovesAbi,
        functionName: 'getLast',
      })) as Address
      while (cursor !== ZERO && eligible.length < 2) {
        const icr = await fork.publicClient.readContract({
          ...tm,
          functionName: 'getCurrentICR',
          args: [cursor, price],
        })
        if (icr >= MCR) {
          const [, principal, interest] = await fork.publicClient.readContract({
            ...tm,
            functionName: 'getEntireDebtAndColl',
            args: [cursor],
          })
          eligible.push({ owner: cursor, netDebt: principal + interest - MUSD_GAS_COMPENSATION })
        }
        cursor = (await fork.publicClient.readContract({
          address: T.sortedTroves,
          abi: sortedTrovesAbi,
          functionName: 'getPrev',
          args: [cursor],
        })) as Address
      }
      const [first, second] = eligible as [
        { owner: Address; netDebt: bigint },
        { owner: Address; netDebt: bigint },
      ]
      const minNetDebt = (await client.getConstants()).minNetDebt
      expect(second, 'fixture: two eligible Troves').toBeDefined()
      // The second Trove's partial breaches the floor when what is left for it, its net debt less the
      // offset, would leave less than `minNetDebt` behind: the offset must be under the floor, and under
      // the Trove's net debt so the amount is not a whole consumption.
      const OFFSET = 100n * MUSD
      expect(OFFSET, 'fixture: the offset leaves the second Trove under the floor').toBeLessThan(
        minNetDebt,
      )
      expect(second.netDebt, 'fixture: the offset is less than a whole Trove').toBeGreaterThan(
        OFFSET,
      )

      // Consume the first whole with room for accrual, then land OFFSET short of the second's net debt.
      const probe = await client.previewRedeem({ redeemer: account.address, amount: 1n })
      expect(probe.firstEligibleTrove, 'fixture: the walk agrees on the first Trove').toBe(
        first.owner,
      )
      const amount = probe.nextViableAmount + second.netDebt - OFFSET
      const preview = await client.previewRedeem({ redeemer: account.address, amount })
      expect(preview.viable, `fixture: viable, ${JSON.stringify(preview.reasons)}`).toBe(true)
      expect(preview.partial, 'fixture: the second partial cancels, so none is sent').toBeNull()

      const [, , helperTruncated] = await fork.publicClient.readContract({
        address: T.hintHelpers,
        abi: hintHelpersAbi,
        functionName: 'getRedemptionHints',
        args: [amount, price, 100n],
      })

      const musdBefore = await client.balanceOf(account.address)
      const btcBefore = await fork.publicClient.getBalance({ address: account.address })
      const result = await client.redeem({ amount })
      const receipt = await fork.publicClient.getTransactionReceipt({ hash: result.hash })
      const musdAfter = await client.balanceOf(account.address)
      const btcAfter = await fork.publicClient.getBalance({ address: account.address })
      const [event] = parseEventLogs({
        abi: troveManagerAbi,
        eventName: 'Redemption',
        logs: receipt.logs,
      })
      const firstStatus = await fork.publicClient.readContract({
        ...tm,
        functionName: 'getTroveStatus',
        args: [first.owner],
      })
      const secondStatus = await fork.publicClient.readContract({
        ...tm,
        functionName: 'getTroveStatus',
        args: [second.owner],
      })
      const gasPaid = receipt.gasUsed * receipt.effectiveGasPrice

      console.log(
        [
          `[MK-241] amount=${amount} first.netDebt=${first.netDebt} second.netDebt=${second.netDebt} minNetDebt=${minNetDebt}`,
          `  hint helper truncatedAmount=${helperTruncated} (what 0.4.x returned)`,
          `  estimatedBeforeSend redeemable=${result.estimatedBeforeSend.redeemable} collateralFee=${result.estimatedBeforeSend.collateralFee}`,
          `  settled redeemed=${result.settled.redeemedAmount} unredeemed=${result.settled.unredeemedAmount} drawn=${result.settled.collateralDrawn} fee=${result.settled.collateralFee} received=${result.settled.collateralReceived}`,
          `  measured MUSD burned=${musdBefore - musdAfter} BTC in, net of gas=${btcAfter - btcBefore + gasPaid}`,
          `  status first=${firstStatus} second=${secondStatus}`,
        ].join('\n'),
      )

      expect(event, 'the receipt carries the Redemption event').toBeDefined()
      const e = event?.args as NonNullable<typeof event>['args']
      expect(result.settled.attemptedAmount).toBe(e._attemptedAmount)
      expect(result.settled.redeemedAmount).toBe(e._actualAmount)
      expect(result.settled.collateralDrawn).toBe(e._collateralSent)
      expect(result.settled.collateralFee).toBe(e._collateralFee)
      expect(result.settled.blockNumber).toBe(receipt.blockNumber)

      // Against balances, not against the event again.
      expect(musdBefore - musdAfter, 'the MUSD that left the caller is what was redeemed').toBe(
        result.settled.redeemedAmount,
      )
      expect(
        btcAfter - btcBefore + gasPaid,
        'the BTC that arrived is collateral drawn less the fee',
      ).toBe(result.settled.collateralReceived)

      // The shape, and the defect the result no longer carries.
      expect(firstStatus, 'the first Trove was consumed whole (closedByRedemption)').toBe(4)
      expect(secondStatus, 'the second Trove was not touched: its partial cancelled').toBe(1)
      expect(result.settled.redeemedAmount).toBeLessThan(amount)
      expect(result.settled.unredeemedAmount).toBe(amount - result.settled.redeemedAmount)
      expect(
        helperTruncated,
        "the helper's figure for the same amount is larger than what settled",
      ).toBeGreaterThan(result.settled.redeemedAmount)
      // The SDK's own walk expected about what settled: short by the first Trove's accrual since the
      // read, never by a whole Trove.
      expect(
        result.settled.redeemedAmount - result.estimatedBeforeSend.redeemable,
      ).toBeGreaterThanOrEqual(0n)
      expect(result.settled.redeemedAmount - result.estimatedBeforeSend.redeemable).toBeLessThan(
        MUSD,
      )
    } finally {
      await fork.testClient.revert({ id: outer })
    }
  }, 600_000)
})
