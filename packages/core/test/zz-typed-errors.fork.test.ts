import { http, type Hex, createWalletClient, numberToHex, toHex } from 'viem'
import { describe, expect, it } from 'vitest'
import { MusdErrorCode, OracleStale, createMusdClient } from '../src'
import { connectFork } from './harness'
import {
  ORACLE_PRECOMPILE,
  ORACLE_SLOT,
  STALE_ORACLE_SHIM_RUNTIME,
  mezoTestnet,
} from './harness/constants'
import { testAccount } from './harness/openTroveRaw'

const MUSD = 10n ** 18n
const BTC = 10n ** 18n

/**
 * MK-105, against the real `PriceFeed` revert rather than a fake client.
 *
 * `PriceFeed.fetchPrice` requires `block.timestamp - updatedAt <= MAX_PRICE_DELAY` with
 * `MAX_PRICE_DELAY = 60` (`PriceFeed.sol:14`, `:51-54`). The harness shim reports the block clock as
 * `updatedAt` (`OracleShim.sol`), so the revert is unreachable on the fork as the suite normally runs
 * it. This file swaps in `StaleOracleShim.sol`, which keeps `updatedAt` in storage, pins it, warps
 * past the delay, and asks every kind of surface for an answer: a read, a preview, the borrowing power
 * calculator, a write whose failure lands in the reads BEFORE its simulation, and a keeper call. Each
 * must reject with `OracleStale`, which before this wave only a failure inside `simulateContract`
 * would have produced.
 *
 * `zz-` for order (MK-016): it warps the clock. Everything is inside a snapshot and reverted, the
 * installed bytecode included.
 */
describe('MK-105, a stale oracle is typed on every path, not only inside simulate', () => {
  it('reads, previews, writes and keeper calls all reject with OracleStale', async () => {
    const fork = connectFork()
    const owner = testAccount(10_101)
    const other = testAccount(10_102)
    for (const a of [owner, other]) await fork.fundAccount(a.address, 20n * BTC)
    const clientFor = (account: typeof owner) =>
      createMusdClient({
        chainId: 31611,
        publicClient: fork.publicClient,
        walletClient: createWalletClient({
          account,
          chain: mezoTestnet,
          transport: http(fork.rpcUrl),
        }),
      })
    const ownerClient = clientFor(owner)
    const otherClient = clientFor(other)

    const outer = await fork.testClient.snapshot()
    try {
      // A Trove to act on, and some MUSD, opened while the feed is fresh.
      const opened = await ownerClient.openTrove({ collateral: 1n * BTC, debt: 5_000n * MUSD })
      expect(
        (await fork.publicClient.waitForTransactionReceipt({ hash: opened.hash })).status,
      ).toBe('success')
      const freshPrice = await ownerClient.getOraclePrice()

      const writeSlot = (slot: bigint, value: bigint) =>
        fork.testClient.setStorageAt({
          address: ORACLE_PRECOMPILE,
          index: numberToHex(slot, { size: 32 }) as Hex,
          value: toHex(value, { size: 32 }),
        })
      const now = (await fork.publicClient.getBlock({ blockTag: 'latest' })).timestamp
      await fork.testClient.setCode({
        address: ORACLE_PRECOMPILE,
        bytecode: STALE_ORACLE_SHIM_RUNTIME,
      })
      await writeSlot(ORACLE_SLOT.startedAt, now)
      await writeSlot(ORACLE_SLOT.updatedAt, now)
      // Still fresh: the swap alone changes nothing, so what follows is the delay and nothing else.
      expect(await ownerClient.getOraclePrice(), 'the swapped shim serves the same price').toBe(
        freshPrice,
      )

      await fork.warpTime(120)

      const surfaces: [string, () => Promise<unknown>][] = [
        ['getOraclePrice', () => ownerClient.getOraclePrice()],
        ['getSystemState', () => ownerClient.getSystemState()],
        ['getTrove', () => ownerClient.getTrove(owner.address)],
        ['isLiquidatable', () => ownerClient.isLiquidatable(owner.address)],
        ['getBorrowingPower', () => otherClient.getBorrowingPower({ collateral: 1n * BTC })],
        [
          'previewOpen',
          () => otherClient.previewOpen({ collateral: 1n * BTC, debt: 2_000n * MUSD }),
        ],
        ['previewBorrow', () => ownerClient.previewBorrow({ owner: owner.address, amount: MUSD })],
        [
          'previewRedeem',
          () => ownerClient.previewRedeem({ redeemer: owner.address, amount: MUSD }),
        ],
        ['openTrove', () => otherClient.openTrove({ collateral: 1n * BTC, debt: 2_000n * MUSD })],
        ['borrow', () => ownerClient.borrow({ amount: MUSD })],
        ['repay', () => ownerClient.repay({ amount: MUSD })],
        ['redeem', () => ownerClient.redeem({ amount: 100n * MUSD })],
        ['liquidate', () => ownerClient.liquidate(owner.address)],
      ]
      const rows: string[] = []
      const outcomes = new Map<string, unknown>()
      for (const [name, call] of surfaces) {
        try {
          await call()
          outcomes.set(name, 'resolved')
          rows.push(`  ${name.padEnd(18)} resolved`)
        } catch (error) {
          outcomes.set(name, error)
          const e = error as { name?: string; code?: string }
          rows.push(`  ${name.padEnd(18)} ${e.name} code=${e.code}`)
        }
      }
      console.log(['[MK-105] after a 120s warp with updatedAt pinned', ...rows].join('\n'))

      for (const [name] of surfaces) {
        const error = outcomes.get(name)
        expect(error, `${name} must reject with OracleStale`).toBeInstanceOf(OracleStale)
        expect((error as OracleStale).code, name).toBe(MusdErrorCode.ORACLE_STALE)
        expect((error as OracleStale).cause, `${name} keeps the original error`).toBeDefined()
      }
    } finally {
      await fork.testClient.revert({ id: outer })
    }
  }, 600_000)
})
