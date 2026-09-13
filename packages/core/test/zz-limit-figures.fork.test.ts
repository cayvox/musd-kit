import { http, createWalletClient } from 'viem'
import { describe, expect, it } from 'vitest'
import { MCR, borrowerOperationsAbi, createMusdClient } from '../src'
import { connectFork } from './harness'
import { mezoTestnet } from './harness/constants'
import { testAccount } from './harness/openTroveRaw'

const MUSD = 10n ** 18n
const BTC = 10n ** 18n
const E18 = 10n ** 18n

/**
 * MK-100's shape, checked on every other limit figure the SDK hands out.
 *
 * MK-100 was a figure the contract ACCEPTS a block later and that leaves the position exactly on the
 * liquidation threshold. It reached the chain because `_openTrove` evaluates its ratio gates without
 * accruing anything first (`BorrowerOperations.sol:648-657`). `_adjustTrove` does the opposite: its
 * first statement is `troveManager.updateSystemAndTroveInterest(_borrower)` (`:769`), so every adjust
 * gate, the individual ratio (`:1265-1275`), the capacity (`:1358-1365`) and the system ratio, is
 * evaluated against the debt at EXECUTION. A figure read one block earlier is therefore short by the
 * interest in between, and at the exact limit that makes it refused rather than accepted.
 *
 * That is a claim about the chain, so it is measured: each exact figure is sent one second after it
 * was read, beside a control a little inside it that must succeed, so a fixture that refuses
 * everything cannot pass. What this file pins is the decision recorded on MK-100: these figures FAIL
 * LOUDLY and do not get a recommended twin.
 *
 * `zz-` for order (MK-016): it warps. Each case runs inside its own snapshot.
 */
describe('MK-100 per-figure: the adjust limit figures are refused at their exact value', () => {
  const fork = () => connectFork()
  const clientFor = (seed: number) => {
    const account = testAccount(seed)
    const client = createMusdClient({
      chainId: 31611,
      publicClient: fork().publicClient,
      walletClient: createWalletClient({
        account,
        chain: mezoTestnet,
        transport: http(fork().rpcUrl),
      }),
    })
    return { account, client }
  }
  const outcome = async (send: () => Promise<{ hash: `0x${string}` }>) => {
    try {
      const { hash } = await send()
      return (await fork().publicClient.waitForTransactionReceipt({ hash })).status
    } catch (error) {
      return `threw(${(error as Error).name})`
    }
  }

  it('getBorrowingCapacity().remaining, maxWithdrawableCollateral().amount and minimumCollateralToClearIcr', async () => {
    const f = fork()
    const rows: string[] = []
    const outer = await f.testClient.snapshot()
    try {
      // ---- capacity.remaining, spent as draw + fee ----
      let base = await f.testClient.snapshot()
      {
        const { account, client } = clientFor(10_201)
        await f.fundAccount(account.address, 20n * BTC)
        const opened = await client.openTrove({ collateral: 1n * BTC, debt: 20_000n * MUSD })
        await f.publicClient.waitForTransactionReceipt({ hash: opened.hash })
        const cap = await client.getBorrowingCapacity(account.address)
        const rate = await f.publicClient.readContract({
          address: client.addresses.borrowerOperations,
          abi: borrowerOperationsAbi,
          functionName: 'borrowingRate',
        })
        // `remaining` is headroom for draw + fee, and the fee is linear at this rate.
        const exact = (cap.remaining * E18) / (E18 + rate)
        const inner = await f.testClient.snapshot()
        await f.warpTime(1)
        const atExact = await outcome(() => client.borrow({ amount: exact }))
        await f.testClient.revert({ id: inner })
        await f.warpTime(1)
        const atControl = await outcome(() => client.borrow({ amount: (exact * 99n) / 100n }))
        rows.push(
          `  capacity.remaining=${cap.remaining} draw=${exact}: exact 1s later -> ${atExact}; 99% -> ${atControl}`,
        )
        expect(atExact, 'the exact remaining capacity is refused a block later').not.toBe('success')
        expect(atControl, 'control: a draw inside it is accepted').toBe('success')
      }
      await f.testClient.revert({ id: base })
      base = await f.testClient.snapshot()

      // ---- maxWithdrawableCollateral().amount, limited by the individual ratio ----
      {
        const { account, client } = clientFor(10_202)
        await f.fundAccount(account.address, 20n * BTC)
        const opened = await client.openTrove({ collateral: 1n * BTC, debt: 20_000n * MUSD })
        await f.publicClient.waitForTransactionReceipt({ hash: opened.hash })
        const max = await client.maxWithdrawableCollateral(account.address)
        expect(max.limitedBy, 'fixture: the individual ratio binds').toBe('ICR')
        const inner = await f.testClient.snapshot()
        await f.warpTime(1)
        const atExact = await outcome(() => client.withdrawCollateral({ amount: max.amount }))
        await f.testClient.revert({ id: inner })
        await f.warpTime(1)
        const atControl = await outcome(() =>
          client.withdrawCollateral({ amount: (max.amount * 99n) / 100n }),
        )
        rows.push(
          `  maxWithdrawable=${max.amount} (limitedBy ${max.limitedBy}): exact 1s later -> ${atExact}; 99% -> ${atControl}`,
        )
        expect(atExact, 'the exact maximum withdrawal is refused a block later').not.toBe('success')
        expect(atControl, 'control: a withdrawal inside it is accepted').toBe('success')
      }
      await f.testClient.revert({ id: base })
      base = await f.testClient.snapshot()

      // ---- minimumCollateralToClearIcr, on a Trove interest has taken under MCR ----
      {
        const { account, client } = clientFor(10_203)
        await f.fundAccount(account.address, 20n * BTC)
        const { ceiling } = await client.getBorrowingPower({
          collateral: 1n * BTC,
          account: account.address,
        })
        await f.warpTime(1)
        const opened = await client.openTrove({ collateral: 1n * BTC, debt: ceiling })
        await f.publicClient.waitForTransactionReceipt({ hash: opened.hash })
        await f.warpTime(60)
        const sunk = await client.getTrove(account.address)
        expect(sunk.icr, 'fixture: interest has taken it under MCR').toBeLessThan(MCR)
        expect((await client.getSystemState()).isRecoveryMode, 'fixture: normal mode').toBe(false)
        const preview = await client.previewAdjustTrove({
          owner: account.address,
          addCollateral: 1n,
        })
        const needed = (preview.minimumCollateralToClearIcr as bigint) - sunk.collateral
        expect(needed, 'fixture: a rescue needs a positive top-up').toBeGreaterThan(0n)
        const inner = await f.testClient.snapshot()
        await f.warpTime(1)
        const atExact = await outcome(() => client.addCollateral({ amount: needed }))
        const stillUnder = await client.isLiquidatable(account.address)
        await f.testClient.revert({ id: inner })
        await f.warpTime(1)
        const atControl = await outcome(() => client.addCollateral({ amount: needed * 2n }))
        rows.push(
          `  minimumCollateralToClearIcr top-up=${needed}: exact 1s later -> ${atExact} (still liquidatable=${stillUnder}); 2x -> ${atControl}`,
        )
        expect(atExact, 'the exact rescue top-up is refused a block later').not.toBe('success')
        expect(stillUnder, 'and nothing was silently accepted at the threshold').toBe(true)
        expect(atControl, 'control: a larger top-up is accepted').toBe('success')
      }
      await f.testClient.revert({ id: base })
    } finally {
      console.log(
        ['[MK-100 per-figure] exact limit figures, sent one second after the read', ...rows].join(
          '\n',
        ),
      )
      await f.testClient.revert({ id: outer })
    }
  }, 900_000)
})
