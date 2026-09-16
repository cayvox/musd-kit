import { http, createWalletClient, parseEventLogs } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  ExceedsBorrowingCapacity,
  borrowerOperationsAbi,
  createMusdClient,
  troveManagerAbi,
} from '../src'
import { connectFork } from './harness'
import { mezoTestnet } from './harness/constants'
import { testAccount } from './harness/openTroveRaw'

const MUSD = 10n ** 18n
const BTC = 10n ** 18n
const capAt = (coll: bigint, price: bigint) => (coll * price) / (110n * 10n ** 16n)

/**
 * MK-242, by sending: the capacity a withdrawal removes, disclosed before it is sent, and what winning it
 * back costs.
 *
 * **The mechanism, from the contract.** A collateral decrease stores `min(current, coll * price / 1.1)`
 * (`BorrowerOperations.sol:879-899`); a collateral increase never enters that branch (`:880`); only a
 * refinance writes capacity upward (`:1077-1084`), and it charges a fee into principal (`:1029-1040`).
 *
 * **What is asserted, each against the chain.** The capacity the withdrawal preview reports is the
 * capacity the chain stores after the withdrawal mines, to the wei. Adding the same collateral back at the
 * original price leaves it there, to the wei, and a borrow that fitted before the withdrawal is refused
 * before gas with `ExceedsBorrowingCapacity`. The projected recovery is what a refinance sent at that state
 * then does: the capacity it writes to the wei, and the fee it charges within the interest accrued between
 * the preview and the send.
 *
 * `zz-` for order: it moves the oracle price, and every step runs inside a snapshot that is reverted.
 */
describe('MK-242, a withdrawal discloses the capacity it removes', () => {
  it('the preview names the capacity the chain stores, re-adding does not restore it, and a refinance does at the projected cost', async () => {
    const fork = connectFork()
    const owner = testAccount(24_201)
    await fork.fundAccount(owner.address, 20n * BTC)
    const client = createMusdClient({
      chainId: 31611,
      publicClient: fork.publicClient,
      walletClient: createWalletClient({
        account: owner,
        chain: mezoTestnet,
        transport: http(fork.rpcUrl),
      }),
    })
    const tm = { address: client.addresses.troveManager, abi: troveManagerAbi } as const
    const storedCapacity = () =>
      fork.publicClient.readContract({
        ...tm,
        functionName: 'getTroveMaxBorrowingCapacity',
        args: [owner.address],
      })
    const mined = async (hash: `0x${string}`) => {
      const receipt = await fork.publicClient.waitForTransactionReceipt({ hash })
      expect(receipt.status, 'fixture: the send must succeed').toBe('success')
      return receipt
    }

    const outer = await fork.testClient.snapshot()
    const rows: string[] = []
    try {
      const collateral = 2n * BTC
      await mined((await client.openTrove({ collateral, debt: 20_000n * MUSD })).hash)
      const openPrice = await client.getOraclePrice()
      const atOpen = await storedCapacity()
      expect(atOpen, 'fixture: capacity set at the opening price').toBe(
        capAt(collateral, openPrice),
      )
      const draw = 60_000n * MUSD
      expect(
        (await client.previewBorrow({ owner: owner.address, amount: draw })).viable,
        'fixture: the draw fits before the withdrawal',
      ).toBe(true)

      // A 30 percent fall, then half of what the Trove may withdraw.
      const fell = (openPrice * 70n) / 100n
      await fork.setPrice(fell)
      const max = await client.maxWithdrawableCollateral(owner.address)
      const amount = max.amount / 2n
      const preview = await client.previewWithdrawCollateral({ owner: owner.address, amount })
      expect(preview.viable).toBe(true)
      expect(
        preview.capacityAfter.lost,
        'fixture: the fall makes the withdrawal cost capacity',
      ).toBeGreaterThan(0n)
      expect(max.capacityAfter.current).toBe(atOpen)
      await mined((await client.withdrawCollateral({ amount })).hash)
      const afterWithdrawal = await storedCapacity()
      rows.push(
        `  open capacity=${atOpen} at price=${openPrice}; withdraw ${amount} at price=${fell}: preview resulting=${preview.capacityAfter.resulting} lost=${preview.capacityAfter.lost}; chain=${afterWithdrawal}`,
      )
      expect(
        afterWithdrawal,
        'the capacity the preview named is the capacity the chain stores',
      ).toBe(preview.capacityAfter.resulting)

      // The projected recovery, sent at that same state inside its own snapshot.
      const recovery = preview.capacityAfter.recovery
      expect(recovery, 'a recovery is projected whenever capacity is lost').not.toBeNull()
      let base = await fork.testClient.snapshot()
      const refi = await mined((await client.refinance()).hash)
      const [paid] = parseEventLogs({
        abi: borrowerOperationsAbi,
        eventName: 'RefinancingFeePaid',
        logs: refi.logs,
      })
      const afterRefinance = await storedCapacity()
      rows.push(
        `  refinance at that state: projected fee=${recovery?.fee} capacity=${recovery?.capacity}; chain fee=${paid?.args._fee} capacity=${afterRefinance}`,
      )
      expect(afterRefinance, 'a refinance writes the capacity the recovery projected').toBe(
        recovery?.capacity,
      )
      const paidFee = paid?.args._fee as bigint
      expect(paidFee, 'the fee charged is not below the projection').toBeGreaterThanOrEqual(
        recovery?.fee as bigint,
      )
      // The base grows by a few seconds of interest between the preview and the send: 20,000 MUSD at a
      // few hundred bps for under a minute moves a 20 percent, 0.1 percent fee by far less than a MUSD.
      expect(paidFee - (recovery?.fee as bigint)).toBeLessThan(MUSD / 1_000n)
      await fork.testClient.revert({ id: base })
      base = await fork.testClient.snapshot()

      // Back to the opening price, and the same collateral added back.
      await fork.setPrice(openPrice)
      await mined((await client.addCollateral({ amount })).hash)
      const afterReAdd = await storedCapacity()
      const borrowAfter = await client.previewBorrow({ owner: owner.address, amount: draw })
      const refused = await client.borrow({ amount: draw }).catch((e: unknown) => e)
      rows.push(
        `  re-add ${amount} at price=${openPrice}: chain capacity=${afterReAdd}; previewBorrow(${draw}) reasons=${JSON.stringify(borrowAfter.reasons)}; borrow threw ${(refused as Error).name}`,
      )
      expect(afterReAdd, 'adding the collateral back does not restore capacity').toBe(
        afterWithdrawal,
      )
      expect(borrowAfter.reasons).toContain('EXCEEDS_BORROWING_CAPACITY')
      expect(refused, 'refused before gas, with the capacity gate named').toBeInstanceOf(
        ExceedsBorrowingCapacity,
      )
      await fork.testClient.revert({ id: base })
    } finally {
      console.log(['[MK-242] the capacity a withdrawal removes', ...rows].join('\n'))
      await fork.testClient.revert({ id: outer })
    }
  }, 600_000)
})
