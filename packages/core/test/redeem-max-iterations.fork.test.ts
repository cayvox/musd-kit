import { http, type Address, type Hex, createWalletClient, parseEventLogs } from 'viem'
import { describe, expect, it } from 'vitest'
import { createMusdClient, getAddresses, hintHelpersAbi, troveManagerAbi } from '../src'
import { connectFork } from './harness'
import { mezoTestnet } from './harness/constants'
import { explainTransaction } from './harness/explainReceipt'
import { testAccount } from './harness/openTroveRaw'

const T = getAddresses(31611)
const MUSD = 10n ** 18n
const BTC = 10n ** 18n

/**
 * MK-114, on chain. `redeemCollateral` reads `_maxIterations == 0` as no limit
 * (`TroveManager.sol:353-355`), and `previewRedeem` has to report what that call redeems.
 *
 * The amount consumes the first k eligible Troves whole and takes a 10 MUSD partial from the next one,
 * so the answer at zero depends on reaching past the first Trove. k is found rather than assumed: at the
 * pinned block the Troves at the bottom of the list sit at the debt floor, where no partial is allowed,
 * so the fixture asks the deployed helper what k Troves consumed whole come to and takes the first k
 * whose next Trove can take the partial. Both sends start from one snapshot. At zero
 * the chain's `Redemption` event must report exactly the preview's `redeemable`; at one it must report
 * less, which is what makes the first comparison mean something.
 */
describe('MK-114, maxIterations 0n against what the chain redeems', () => {
  it('the preview at zero equals the amount the chain redeems at zero, and one redeems less', async () => {
    const fork = connectFork()
    const account = testAccount(11_401)
    await fork.fundAccount(account.address, 60n * BTC)
    const wallet = createWalletClient({ account, chain: mezoTestnet, transport: http(fork.rpcUrl) })
    const client = createMusdClient({
      chainId: 31611,
      publicClient: fork.publicClient,
      walletClient: wallet,
    })

    const actualAmount = async (hash: Hex) => {
      const receipt = await fork.publicClient.waitForTransactionReceipt({ hash })
      const ev = parseEventLogs({
        abi: troveManagerAbi,
        logs: receipt.logs,
        eventName: 'Redemption',
      })[0]
      if (!ev) {
        throw new Error(await explainTransaction(fork.publicClient, hash, 'Redemption event'))
      }
      return ev.args._actualAmount
    }

    const outer = await fork.testClient.snapshot()
    try {
      const seed = await fork.publicClient.waitForTransactionReceipt({
        hash: (await client.openTrove({ collateral: 50n * BTC, debt: 400_000n * MUSD })).hash,
      })
      expect(seed.status, 'fixture: the seeding open must succeed').toBe('success')

      const probe = await client.previewRedeem({ redeemer: account.address, amount: 1n })
      const first = probe.firstEligibleTrove as Address
      expect(first, 'fixture: there must be an eligible Trove').not.toBeNull()

      // What k Troves consumed whole come to, from the deployed helper: with a request larger than the
      // whole system every Trove it reaches is consumed whole (`HintHelpers.sol:138-162`).
      let amount = 0n
      let atZero = probe
      let k = 0n
      for (k = 1n; k <= 16n; k++) {
        const [, , wholeK] = await fork.publicClient.readContract({
          address: T.hintHelpers,
          abi: hintHelpersAbi,
          functionName: 'getRedemptionHints',
          args: [10n ** 30n, probe.price, k],
        })
        amount = wholeK + 10n * MUSD
        atZero = await client.previewRedeem({
          redeemer: account.address,
          amount,
          maxIterations: 0n,
        })
        if (atZero.viable && atZero.partial !== null && atZero.redeemable === amount) break
      }
      const atOne = await client.previewRedeem({
        redeemer: account.address,
        amount,
        maxIterations: 1n,
      })
      expect(atZero.viable, `fixture: viable at zero, ${JSON.stringify(atZero.reasons)}`).toBe(true)
      expect(atZero.partial?.trove, 'fixture: the partial is on a later Trove').not.toBe(first)
      expect(atOne.redeemable, 'fixture: one iteration stops at the first Trove').toBeLessThan(
        atZero.redeemable,
      )
      expect(atZero.musdBalance, 'fixture: the account holds the amount').toBeGreaterThanOrEqual(
        amount,
      )

      let base = await fork.testClient.snapshot()
      const sentAtZero = await client.redeem({ amount, maxIterations: 0n })
      const redeemedAtZero = await actualAmount(sentAtZero.hash)
      await fork.testClient.revert({ id: base })
      base = await fork.testClient.snapshot()
      const sentAtOne = await client.redeem({ amount, maxIterations: 1n })
      const redeemedAtOne = await actualAmount(sentAtOne.hash)
      await fork.testClient.revert({ id: base })

      console.log(
        [
          `[MK-114] amount=${amount} first=${first} troves consumed whole before the partial=${k}`,
          `  preview maxIterations 0: redeemable=${atZero.redeemable} partial=${atZero.partial?.trove}`,
          `  preview maxIterations 1: redeemable=${atOne.redeemable}`,
          `  chain   maxIterations 0: Redemption._actualAmount=${redeemedAtZero} redeem().partial=${sentAtZero.partial?.trove ?? null}`,
          `  chain   maxIterations 1: Redemption._actualAmount=${redeemedAtOne}`,
        ].join('\n'),
      )

      expect(redeemedAtZero, 'the chain redeems what the preview reported at zero').toBe(
        atZero.redeemable,
      )
      expect(redeemedAtOne, 'and one iteration redeems less on chain too').toBeLessThan(
        redeemedAtZero,
      )
      expect(
        sentAtZero.partial?.trove,
        'redeem() at zero prechecked the partial the chain made',
      ).toBe(atZero.partial?.trove)
    } finally {
      await fork.testClient.revert({ id: outer })
    }
  }, 300_000)
})
