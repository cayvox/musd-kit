import { http, createWalletClient } from 'viem'
import { describe, expect, it } from 'vitest'
import { createMusdClient, getAddresses, troveManagerAbi } from '../src'
import { connectFork } from './harness'
import { mezoTestnet } from './harness/constants'
import { testAccount } from './harness/openTroveRaw'

const T = getAddresses(31611)
const MUSD = 10n ** 18n
const BTC = 10n ** 18n

/**
 * `maxWithdrawableCollateral`, sent rather than previewed, and across a delay (MK-051).
 *
 * **Why this exists.** `scripts/testnet-e2e.ts:435-439` established the max by calling
 * `previewWithdrawCollateral` twice, at the max and at the max plus one wei, and recorded the
 * result as "max accepted, max+1 refused, on chain". The chain never saw either amount: what was
 * actually sent was a quarter of the max. That is the SDK's evaluator agreeing with itself, which
 * is worth something and is not what the record claimed.
 *
 * **And the quantity moves in the dangerous direction.** The max is bounded by ICR against a debt
 * that GROWS with interest, so unlike a redemption headroom it SHRINKS. If it shrinks fast enough
 * to matter, an integrator who offers the reported max is refused, which is MK-048's shape with the
 * sign flipped. Measured here rather than reasoned about.
 */
describe('MK-051, the withdrawable maximum against the chain and against time', () => {
  it('sends the reported max, one wei more, and the max again after delays', async () => {
    const fork = connectFork()
    const account = testAccount(9651)
    await fork.fundAccount(account.address, 20n * BTC)
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
      const seed = await fork.publicClient.waitForTransactionReceipt({
        hash: (await client.openTrove({ collateral: 2n * BTC, debt: 20_000n * MUSD })).hash,
      })
      expect(seed.status, 'fixture: the seeding open must succeed').toBe('success')

      const max = await client.maxWithdrawableCollateral(account.address)
      expect(max.amount, 'fixture: there must be headroom to withdraw').toBeGreaterThan(0n)

      // A snapshot id is consumed by the revert that uses it, so re-snapshot every time.
      let base = await fork.testClient.snapshot()
      const restore = async () => {
        await fork.testClient.revert({ id: base })
        base = await fork.testClient.snapshot()
      }

      // Routed through the SDK so the insertion hints are the ones it computes, rather than hand
      // rolled ones that could fail for a reason unrelated to the boundary under test. The SDK
      // simulates before it sends, so a refusal here is reported as `threw` and distinguished from
      // a mined revert: the two are different evidence and collapsing them is how MK-048's first
      // explanation went wrong.
      const send = async (amount: bigint) => {
        let hash: `0x${string}`
        try {
          ;({ hash } = await client.withdrawCollateral({ amount }))
        } catch (error) {
          return `threw(${(error as Error).name})`
        }
        const receipt = await fork.publicClient.waitForTransactionReceipt({ hash })
        return receipt.status
      }

      const rows: string[] = []
      for (const seconds of [0, 1, 60, 600, 3600, 86_400]) {
        // A control at half the max, so a row of reverts cannot be mistaken for the boundary when
        // it is really the fixture or the call shape failing.
        if (seconds > 0) await fork.warpTime(seconds)
        const half = await send(max.amount / 2n)
        await restore()
        if (seconds > 0) await fork.warpTime(seconds)
        const atMax = await send(max.amount)
        await restore()
        if (seconds > 0) await fork.warpTime(seconds)
        const pastMax = await send(max.amount + 1n)
        await restore()
        rows.push(
          `  warp ${String(seconds).padStart(6)}s  half=${half.padEnd(24)} max=${atMax.padEnd(24)} max+1wei=${pastMax}`,
        )
      }

      console.log(
        [`[MK-051] reported max=${max.amount} limitedBy=${max.limitedBy}`, ...rows].join('\n'),
      )

      // What the ledger claimed, now actually sent: at zero delay the max is accepted and one wei
      // more is refused.
      const row = (seconds: number) => {
        const found = rows.find((r) => r.includes(`warp ${String(seconds).padStart(6)}s`))
        expect(found, `the ladder must have a row for ${seconds}s`).toBeDefined()
        return found as string
      }

      // The control, so a row of refusals cannot be read as the boundary when it is the fixture.
      for (const seconds of [0, 1, 600, 86_400]) {
        expect(row(seconds), 'half the max must go through at every delay').toContain(
          'half=success',
        )
      }

      // The `warp 0s` row is REPORTED and not asserted on, for the same reason as the redemption
      // ladder's: it depends on how many wall clock seconds the harness itself spends between
      // reading the max and sending, and it has been observed both ways. It failed exactly once in
      // six full suite runs before this exclusion, which is precisely the flake such a row
      // produces. **A caller cannot reach zero elapsed time either**, so the row is a curiosity
      // rather than a claim, and the claim is in the rows below it.

      // The max is bounded by ICR against a debt that GROWS, so the figure SHRINKS. One second is
      // enough to make the reported max unusable, and that is stable.
      for (const seconds of [1, 60, 600, 3600, 86_400]) {
        expect(
          row(seconds),
          `the reported max must be refused after ${seconds}s, because the max has shrunk`,
        ).toContain('max=threw')
        expect(row(seconds), `and one wei past it must be refused after ${seconds}s too`).toContain(
          'max+1wei=threw',
        )
      }
    } finally {
      await fork.testClient.revert({ id: outer })
    }
  }, 900_000)
})
