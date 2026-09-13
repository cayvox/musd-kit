import { http, type Address, createWalletClient } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  RedemptionBreachesDebtFloor,
  RedemptionPriceFragile,
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

  /**
   * MK-104 and MK-103, through `redeem()` and at the contract, from one snapshot.
   *
   * **MK-104.** `nextViableAmount` carries 900 seconds of accrual from the block it is read at
   * (`REDEMPTION_ADVICE_MARGIN_SECONDS`), and `redeem()` used to re-check it with ANOTHER 900 on top,
   * so it refused its own advice a block later. It now checks with the 60 second sending margin, so
   * the advice must be accepted by the client AND by the chain after 1, 60 and 600 seconds, the
   * window it advertises. After an hour it has expired: the lot is a sub-floor partial on the first
   * Trove, and the client must refuse it, typed and before gas, rather than send it to revert.
   *
   * **MK-103.** A partial on the first Trove is cancelled unless the hint lies in
   * `[newNICR, upperBoundNICR]` at the EXECUTION price (`TroveManager.sol:1224-1230`, `:1276-1306`), and
   * a cancel there reverts the call (`:392`, `:406-408`). The preview reports how far the price may
   * move each way with the centred hint the SDK sends. This measures both claims from both sides:
   * half the reported tolerance survives and twice it cancels, in each direction; and the helper's
   * lower-edge hint, which `redeem()` used to send, cancels on the same half-tolerance rise the
   * centred hint survives.
   */
  it('MK-104: redeem() accepts its own nextViableAmount inside the window; MK-103: the partial band is what the preview reports', async () => {
    const fork = connectFork()
    const account = testAccount(9649)
    await fork.fundAccount(account.address, 60n * BTC)
    const wallet = createWalletClient({ account, chain: mezoTestnet, transport: http(fork.rpcUrl) })
    const client = createMusdClient({
      chainId: 31611,
      publicClient: fork.publicClient,
      walletClient: wallet,
    })
    const tm = { address: T.troveManager, abi: troveManagerAbi } as const

    const outer = await fork.testClient.snapshot()
    const rows: string[] = []
    try {
      const seed = await fork.publicClient.waitForTransactionReceipt({
        hash: (await client.openTrove({ collateral: 50n * BTC, debt: 400_000n * MUSD })).hash,
      })
      expect(seed.status, 'fixture: the seeding open must succeed').toBe('success')

      const probe = await client.previewRedeem({ redeemer: account.address, amount: 1n })
      const target = probe.firstEligibleTrove as Address
      expect(target, 'fixture: there must be an eligible Trove').not.toBeNull()
      const advice = probe.nextViableAmount
      const statusOf = () =>
        fork.publicClient.readContract({ ...tm, functionName: 'getTroveStatus', args: [target] })

      let base = await fork.testClient.snapshot()
      const restore = async () => {
        await fork.testClient.revert({ id: base })
        base = await fork.testClient.snapshot()
        expect(await statusOf(), 'the revert must put the target back to active').toBe(1)
      }

      // ---- MK-104: the advice, sent through the client after a delay ----
      const adviceOutcome = new Map<number, string>()
      for (const seconds of [1, 60, 600, 3600]) {
        await fork.warpTime(seconds)
        let outcome: string
        try {
          const { hash } = await client.redeem({ amount: advice })
          const receipt = await fork.publicClient.waitForTransactionReceipt({ hash })
          outcome = `${receipt.status} targetStatus=${await statusOf()}`
        } catch (error) {
          outcome = `threw(${(error as Error).name})`
        }
        adviceOutcome.set(seconds, outcome)
        rows.push(
          `  MK-104 warp ${String(seconds).padStart(5)}s  redeem(nextViableAmount) -> ${outcome}`,
        )
        await restore()
      }

      // ---- MK-103: a partial on the first Trove, its band measured by moving the price ----
      const amount = probe.maxWithoutConsuming / 2n
      const preview = await client.previewRedeem({ redeemer: account.address, amount })
      const partial = preview.partial
      expect(partial, 'fixture: half the headroom is a partial').not.toBeNull()
      if (partial === null) throw new Error('unreachable')
      expect(partial.trove).toBe(target)
      expect(partial.revertsCallIfCancelled, 'fixture: it is the first Trove drawn').toBe(true)
      const up = partial.priceToleranceUp
      const down = partial.priceToleranceDown
      expect(up, 'fixture: a zero tolerance would make the ladder vacuous').toBeGreaterThan(0n)
      expect(down, 'fixture: a zero tolerance would make the ladder vacuous').toBeGreaterThan(0n)
      const price = preview.price
      const E18 = 10n ** 18n

      const [first, helperNicr] = await fork.publicClient.readContract({
        address: T.hintHelpers,
        abi: hintHelpersAbi,
        functionName: 'getRedemptionHints',
        args: [amount, price, 100n],
      })
      const sendWithHint = async (nicr: bigint) => {
        const [upper, lower] = await fork.publicClient.readContract({
          address: T.sortedTroves,
          abi: sortedTrovesAbi,
          functionName: 'findInsertPosition',
          args: [nicr, ZERO, ZERO],
        })
        const hash = await wallet.writeContract({
          ...tm,
          account,
          chain: mezoTestnet,
          functionName: 'redeemCollateral',
          args: [amount, first, upper, lower, nicr, 100n],
          gas: 8_000_000n,
        })
        return (await fork.publicClient.waitForTransactionReceipt({ hash })).status
      }
      const cases: [string, bigint, 'centre' | 'helper'][] = [
        ['no move', price, 'centre'],
        ['rise of half the up tolerance', (price * (E18 + up / 2n)) / E18, 'centre'],
        ['rise of half the up tolerance', (price * (E18 + up / 2n)) / E18, 'helper'],
        ['rise of twice the up tolerance', (price * (E18 + up * 2n)) / E18, 'centre'],
        ['fall of half the down tolerance', (price * (E18 - down / 2n)) / E18, 'centre'],
        ['fall of twice the down tolerance', (price * (E18 - down * 2n)) / E18, 'centre'],
      ]
      const band = new Map<string, string>()
      for (const [label, movedPrice, hint] of cases) {
        await fork.setPrice(movedPrice)
        const status = await sendWithHint(hint === 'centre' ? partial.hintNicr : helperNicr)
        band.set(`${label}/${hint}`, status)
        rows.push(`  MK-103 ${label.padEnd(32)} hint=${hint.padEnd(6)} -> ${status}`)
        await restore()
      }

      // ---- MK-103: the client's refusal, and the explicit opt in ----
      let refused: unknown
      try {
        await client.redeem({ amount })
      } catch (error) {
        refused = error
      }
      let optedIn: string
      try {
        const { hash } = await client.redeem({ amount, acceptPriceFragilePartial: true })
        optedIn = (await fork.publicClient.waitForTransactionReceipt({ hash })).status
      } catch (error) {
        optedIn = `threw(${(error as Error).name})`
      }
      rows.push(
        `  MK-103 redeem(partial) priceFragile=${partial.priceFragile} -> ${(refused as Error | undefined)?.name ?? 'sent'}; with acceptPriceFragilePartial -> ${optedIn}`,
      )
      await restore()

      console.log(
        [
          `[MK-103, MK-104] target=${target} nextViableAmount=${advice} netDebt=${probe.firstTroveNetDebt}`,
          `  partial lot=${partial.lot} hint=${partial.hintNicr} helperHint=${helperNicr} toleranceUp=${up} toleranceDown=${down} (1e18 fractions)`,
          ...rows,
        ].join('\n'),
      )

      for (const seconds of [1, 60, 600]) {
        expect(
          adviceOutcome.get(seconds),
          `the client and the chain accept the advice after ${seconds}s, and the Trove is consumed whole`,
        ).toBe('success targetStatus=4')
      }
      expect(
        adviceOutcome.get(3600),
        'an hour later the advice has expired and is refused, typed',
      ).toBe(`threw(${RedemptionBreachesDebtFloor.name})`)

      expect(band.get('no move/centre')).toBe('success')
      expect(band.get('rise of half the up tolerance/centre'), 'inside the up tolerance').toBe(
        'success',
      )
      expect(
        band.get('rise of half the up tolerance/helper'),
        "the helper's lower edge cancels on the same rise",
      ).toBe('reverted')
      expect(band.get('rise of twice the up tolerance/centre'), 'outside the up tolerance').toBe(
        'reverted',
      )
      expect(band.get('fall of half the down tolerance/centre'), 'inside the down tolerance').toBe(
        'success',
      )
      expect(
        band.get('fall of twice the down tolerance/centre'),
        'outside the down tolerance',
      ).toBe('reverted')

      expect(partial.priceFragile, 'fixture: at this size the partial is fragile').toBe(true)
      expect(refused, 'redeem() refuses a fragile first-Trove partial by default').toBeInstanceOf(
        RedemptionPriceFragile,
      )
      expect(optedIn, 'and sends it when told to, at an unmoved price').toBe('success')
    } finally {
      await fork.testClient.revert({ id: outer })
    }
  }, 900_000)
})
