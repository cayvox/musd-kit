import { http, type Address, createWalletClient } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  createMusdClient,
  diagnoseRevertedWrite,
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
 * MK-048's upper edge, established the way `docs/08-conventions.md` §10 step 11 requires.
 *
 * **Every reading starts from the SAME state.** The first attempt at this file let the readings run
 * in sequence, and reading 3 consumed the Trove that readings 4 and after were measuring, so the
 * numbers were not comparable and the conclusion drawn from them would have been wrong. Each
 * reading below reverts to one snapshot first, which is the only way an amount ladder against a
 * moving quantity means anything.
 *
 * The gas limit is deliberately generous and `gasUsed` is reported, because `diagnoseRevertedWrite`
 * exists precisely because a revert and an exhaustion are not distinguishable without it (MK-035),
 * and a boundary test that confuses the two would produce a confidently wrong rule.
 */
describe('MK-048, the redemption upper edge, by sending', () => {
  it('measures simulate against send at the net debt and either side of it', async () => {
    const fork = connectFork()
    const account = testAccount(9648)
    await fork.fundAccount(account.address, 60n * BTC)
    const wallet = createWalletClient({
      account,
      chain: mezoTestnet,
      transport: http(fork.rpcUrl),
    })
    const client = createMusdClient({
      chainId: 31611,
      publicClient: fork.publicClient,
      walletClient: wallet,
    })
    const tm = { address: T.troveManager, abi: troveManagerAbi } as const

    const outer = await fork.testClient.snapshot()
    try {
      // Enough MUSD to consume the first eligible Trove whole, drawn from a position of our own.
      const seed = await fork.publicClient.waitForTransactionReceipt({
        hash: (await client.openTrove({ collateral: 50n * BTC, debt: 400_000n * MUSD })).hash,
      })
      expect(seed.status, 'fixture: the seeding open must succeed').toBe('success')

      const probe = await client.previewRedeem({ redeemer: account.address, amount: 1n })
      const target = probe.firstEligibleTrove as Address
      expect(target, 'fixture: there must be an eligible Trove').not.toBeNull()
      const D = probe.firstTroveNetDebt
      const G = probe.accrualMargin
      const headroom = probe.maxWithoutConsuming
      expect(G, 'fixture: a zero margin would make this vacuous').toBeGreaterThan(0n)

      const argsFor = async (amount: bigint) => {
        const price = await client.getOraclePrice()
        const [first, nicr] = await fork.publicClient.readContract({
          address: T.hintHelpers,
          abi: hintHelpersAbi,
          functionName: 'getRedemptionHints',
          args: [amount, price, 100n],
        })
        const [upper, lower] = await fork.publicClient.readContract({
          address: T.sortedTroves,
          abi: sortedTrovesAbi,
          functionName: 'findInsertPosition',
          args: [nicr, ZERO, ZERO],
        })
        return [amount, first, upper, lower, nicr, 100n] as const
      }

      // The state every reading starts from.
      //
      // **A snapshot id is consumed by the revert that uses it.** anvil's `evm_revert` invalidates
      // the id, so a second revert against the same id silently does nothing and every later
      // reading runs against the state the previous one left. The first version of this file did
      // exactly that, and it was only visible because the target Trove reported `closedByRedemption`
      // after a reading that had reverted. Re-snapshot after every revert.
      let base = await fork.testClient.snapshot()
      const restore = async () => {
        await fork.testClient.revert({ id: base })
        base = await fork.testClient.snapshot()
        const live = await fork.publicClient.readContract({
          ...tm,
          functionName: 'getTroveStatus',
          args: [target],
        })
        expect(live, 'the revert must put the target Trove back to active (status 1)').toBe(1)
      }

      const simulateAt = async (amount: bigint, blockNumber?: bigint) => {
        try {
          await fork.publicClient.simulateContract({
            ...tm,
            account: account.address,
            functionName: 'redeemCollateral',
            args: await argsFor(amount),
            ...(blockNumber !== undefined ? { blockNumber } : {}),
          })
          return 'ACCEPTED' as const
        } catch {
          return 'REFUSED' as const
        }
      }

      const send = async (amount: bigint) => {
        const hash = await wallet.writeContract({
          ...tm,
          account,
          chain: mezoTestnet,
          functionName: 'redeemCollateral',
          args: await argsFor(amount),
          gas: 8_000_000n,
        })
        const receipt = await fork.publicClient.waitForTransactionReceipt({ hash })
        const diagnosis = await diagnoseRevertedWrite(fork.publicClient, hash)
        const status = await fork.publicClient.readContract({
          ...tm,
          functionName: 'getTroveStatus',
          args: [target],
        })
        return {
          status: receipt.status,
          gasUsed: receipt.gasUsed,
          kind: diagnosis.kind,
          troveStatus: status,
        }
      }

      const atHeadroom = await send(headroom)
      await restore()
      const inTheGap = await send(headroom + 1n)
      await restore()

      // **The variable that moves this boundary is the time between the read and the execution.**
      // Simulating and sending are not the two sides of it: a send in the same wall clock second
      // accrues nothing either, and returns the same answer a simulation does. The ladder below
      // varies the elapsed time and holds the method constant, then repeats it with the method
      // varied, which is the only arrangement that can tell the two explanations apart.
      const ladder: string[] = []
      for (const seconds of [0, 1, 60, 600, 3600, 86_400]) {
        for (const [label, amount] of [
          ['netDebt', D],
          ['netDebt + margin', D + G],
          // The LOWER edge moves too, and in the opposite direction. `headroom = D - minNetDebt`
          // and `D` grows, so delay makes the headroom LARGER: an amount at the old edge stays
          // safe, and an amount one wei past it stops being past it. Measured rather than reasoned,
          // because the ledger presents both as chain behaviour and only one of them survives.
          ['headroom', headroom],
          ['headroom + 1 wei', headroom + 1n],
        ] as const) {
          if (seconds > 0) await fork.warpTime(seconds)
          const simulated = await simulateAt(amount)
          const r = await send(amount)
          ladder.push(
            `  warp ${String(seconds).padStart(6)}s  ${label.padEnd(17)} simulate=${simulated.padEnd(8)} send=${r.status.padEnd(8)} targetStatus=${r.troveStatus}`,
          )
          await restore()
        }
      }

      const line = (label: string, r: Awaited<ReturnType<typeof send>>) =>
        `  ${label.padEnd(24)} -> ${r.status.padEnd(8)} gasUsed=${r.gasUsed} kind=${r.kind} targetStatus=${r.troveStatus}`
      console.log(
        [
          `[MK-048 boundary] target=${target}`,
          `  netDebt=${D} margin=${G} headroom=${headroom} minNetDebt=${probe.minNetDebt}`,
          line('SEND headroom', atHeadroom),
          line('SEND headroom + 1 wei', inTheGap),
          '  --- both amounts, elapsed time varied, method varied ---',
          ...ladder,
        ].join('\n'),
      )

      // The lower edge, which the preview reports as `maxWithoutConsuming`.
      expect(atHeadroom.status, 'the headroom is redeemable as a partial').toBe('success')
      expect(atHeadroom.troveStatus, 'and the Trove survives it').toBe(1)
      expect(inTheGap.status, 'one wei past it is not').toBe('reverted')

      // The upper edge, and the reason the margin exists at all.
      //
      // The `warp 0s` row is deliberately NOT asserted on. It is the only row whose answer depends
      // on how many wall clock milliseconds the test itself spends between the read and the send,
      // and it has been observed both ways. That instability is the finding rather than noise: a
      // caller cannot reach zero elapsed time, because a transaction always lands in a block after
      // the one it was priced at, so the amount that works at zero is not an amount anyone can use.
      const row = (seconds: number, label: string) => {
        const found = ladder.find((l) =>
          l.includes(`warp ${String(seconds).padStart(6)}s  ${label.padEnd(17)}`),
        )
        expect(found, `the ladder must have a row for ${seconds}s ${label}`).toBeDefined()
        return found as string
      }

      // The bare net debt is refused at every delay a real caller can have.
      for (const seconds of [1, 60, 600, 3600, 86_400]) {
        expect(
          row(seconds, 'netDebt'),
          `the net debt as read must be refused after ${seconds}s`,
        ).toContain('send=reverted')
      }

      // The margin is 600 seconds of interest, so that is exactly the claim it carries: it holds
      // for the window it is sized for and not beyond it. Both halves are asserted, because a
      // margin whose upper limit is never measured is a number nobody has bounded.
      for (const seconds of [1, 60, 600]) {
        expect(
          row(seconds, 'netDebt + margin'),
          `the margin must cover ${seconds}s, which is inside the 600s it is sized for`,
        ).toContain('send=success')
      }
      for (const seconds of [3600, 86_400]) {
        expect(
          row(seconds, 'netDebt + margin'),
          `the margin must NOT be claimed to cover ${seconds}s`,
        ).toContain('send=reverted')
      }

      // The lower edge under delay, which is the mirror image and is why the ledger's boundary
      // table is labelled `simulated at a block` rather than as chain behaviour.
      expect(
        row(600, 'headroom'),
        'the headroom as read stays redeemable after a delay, because the headroom grows',
      ).toContain('send=success')
      expect(
        row(600, 'headroom + 1 wei'),
        'and one wei past the OLD edge stops being past it once the edge has moved',
      ).toContain('send=success')
    } finally {
      await fork.testClient.revert({ id: outer })
    }
  }, 900_000)
})
