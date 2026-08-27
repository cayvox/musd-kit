import { http, createWalletClient } from 'viem'
import { describe, expect, it } from 'vitest'
import { createMusdClient } from '../src'
import { connectFork } from './harness'
import { mezoTestnet } from './harness/constants'
import { testAccount } from './harness/openTroveRaw'

/**
 * The gas variance lab (MK-037, MK-039). A MEASUREMENT, not a pin.
 *
 * **Why it is committed.** `DEFAULT_GAS_MARGIN_PERCENT` is 25 because of a measurement: the same
 * `redeemCollateral` call reported as varying from 610270 to 710023 gas across 40 attempts, one
 * of which reverted. That measurement decided a default every write in the SDK carries, and the
 * script that produced it was never committed, so when the next wave was asked to re-run it there
 * was nothing to re-run and it had to be rebuilt from the description (MK-039). A number that
 * justifies a shipped default has to be reproducible by someone who was not there.
 *
 * **Opt in, always.** It sends `MK_GAS_LAB_N` transactions serially against a fork, measured at
 * roughly 45 seconds each, so 40 attempts is about half an hour. That is not a push path job and
 * hiding it behind something nobody runs is the other failure mode, so it is an env flag with its
 * cost written down here.
 *
 *   MK_GAS_LAB=1 pnpm test:fork                              defaults, 40 attempts
 *   MK_GAS_LAB=1 MK_GAS_LAB_AMOUNT=5000 MK_GAS_LAB_MARGIN=0  the reconstruction below
 *
 * **What it reports, and why each column is there.** Per attempt: the receipt status, the
 * `GasDecision` source (MK-037: an attempt that fell back sent NO margin, and a lab that cannot
 * see that is measuring the wrong population), the limit sent, the gas used, and the realised
 * margin. In aggregate: the revert count, the source distribution, and the spread of the margin.
 *
 * **What the reconstruction found, recorded here so the next run has something to compare
 * against.** Three fixtures on a fork of testnet at block 15043414, every attempt from a restored
 * `evm_snapshot`:
 *
 *   amount=100    n=40  margin=0   limit=442640  used=408178   realised 8.4%,  0 reverts
 *   amount=5000   n=6   margin=0   limit=726657  used=615858   realised 17.9%, 0 reverts
 *   amount=20000  n=6   margin=0   limit=2087949 used=1642624  realised 27.1%, 0 reverts
 *
 * `source=estimate` on all 52, `source=fallback` on none.
 *
 * **The gas figure was IDENTICAL within every fixture, to the unit.** The last two ran with
 * `MK_GAS_LAB_STEP=3600`, warping the clock a further hour per attempt out to five hours, and the
 * gas still did not move. Which is what the EVM guarantees: execution is deterministic, so from
 * genuinely byte identical state at a given timestamp the gas CANNOT vary. The 610270 to 710023
 * spread was real, and the transaction that reverted was real, so some input was varying that the
 * original description did not name. Hours of accrued interest are not it. See MK-039.
 */
const ENABLED = process.env.MK_GAS_LAB === '1'
const N = Number(process.env.MK_GAS_LAB_N ?? 40)
const MARGIN = Number(process.env.MK_GAS_LAB_MARGIN ?? 25)
/** MUSD to redeem per attempt, whole units. Traversal depth, and so gas, scales with it. */
const AMOUNT = BigInt(process.env.MK_GAS_LAB_AMOUNT ?? '5000')
/** Seconds to warp before attempt `i`, multiplied by `i`. Zero holds the clock still. */
const STEP = Number(process.env.MK_GAS_LAB_STEP ?? 0)

const MUSD = 10n ** 18n
const BTC = 10n ** 18n

describe('Gas variance lab, redeemCollateral', () => {
  it.skipIf(!ENABLED)(
    `measures ${N} redemptions of ${AMOUNT} MUSD at margin=${MARGIN}`,
    async () => {
      const fork = connectFork()
      const account = testAccount(2037)
      await fork.fundAccount(account.address, 2_000n * BTC)
      const client = createMusdClient({
        chainId: 31611,
        gasMarginPercent: MARGIN,
        publicClient: fork.publicClient,
        walletClient: createWalletClient({
          account,
          chain: mezoTestnet,
          transport: http(fork.rpcUrl),
        }),
      })

      const outer = await fork.testClient.snapshot()
      try {
        // Mint the MUSD to redeem, then raise the price so the lowest redeemable Trove keeps
        // margin over MCR. Without the raise `redeemCollateral` reverts with "Unable to redeem
        // any amount" and the lab measures nothing. Same setup the redemption tests use.
        const price = await client.getOraclePrice()
        const open = await client.openTrove({
          collateral: 400n * BTC,
          debt: 1_000_000n * MUSD,
        })
        await fork.publicClient.waitForTransactionReceipt({ hash: open.hash })
        await fork.setPrice(price * 2n)
        await fork.mineBlocks(1)

        let reverted = 0
        let fallback = 0
        let estimated = 0
        const margins: number[] = []
        const used: bigint[] = []

        for (let i = 0; i < N; i++) {
          // Every attempt starts from the SAME state. Cases that see each other measure the
          // order they ran in, which is MK-016's disease.
          const snapshotId = await fork.testClient.snapshot()
          try {
            if (STEP > 0) {
              await fork.warpTime(i * STEP)
              await fork.mineBlocks(1)
            }
            const result = await client.redeem({ amount: AMOUNT * MUSD })
            if (result.gas.source === 'fallback') fallback++
            else if (result.gas.source === 'estimate') estimated++
            const [tx, receipt] = await Promise.all([
              fork.publicClient.getTransaction({ hash: result.hash }),
              fork.publicClient.waitForTransactionReceipt({ hash: result.hash }),
            ])
            if (receipt.status !== 'success') reverted++
            used.push(receipt.gasUsed)
            const realised = Number(((tx.gas - receipt.gasUsed) * 1000n) / receipt.gasUsed) / 10
            margins.push(realised)
            console.log(
              `[gas-lab] ${i} status=${receipt.status} source=${result.gas.source} ` +
                `limit=${tx.gas} used=${receipt.gasUsed} margin=${realised}%`,
            )
          } catch (error) {
            // Counted, never fatal. A lab that dies on attempt 7 of 40 has measured nothing,
            // and a throw here is itself a data point about the fixture.
            const e = error as Error
            console.log(`[gas-lab] ${i} THREW ${e.name}: ${e.message.split('\n')[0]}`)
          } finally {
            await fork.testClient.revert({ id: snapshotId })
          }
        }

        const sortedMargins = [...margins].sort((a, b) => a - b)
        const sortedUsed = [...used].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        const low = sortedUsed[0] ?? 0n
        const high = sortedUsed[sortedUsed.length - 1] ?? 0n
        const spread = low > 0n ? Number(((high - low) * 1000n) / low) / 10 : 0
        console.log(
          `[gas-lab] RESULT amount=${AMOUNT} margin=${MARGIN} n=${N} step=${STEP} ` +
            `completed=${margins.length} reverted=${reverted} ` +
            `source_estimate=${estimated} source_fallback=${fallback} ` +
            `gasUsed=${low}..${high} spread=${spread}% ` +
            `realisedMargin=${sortedMargins[0]}%..${sortedMargins[sortedMargins.length - 1]}%`,
        )

        // The lab asserts almost nothing on purpose: it exists to produce numbers, and a
        // measurement that fails the build when the number moves is a pin wearing a lab coat.
        // The one thing it does assert is that it measured SOMETHING, so a fixture that
        // silently stopped redeeming cannot be reported as a clean window.
        expect(margins.length, 'the lab must have completed at least one attempt').toBeGreaterThan(
          0,
        )
      } finally {
        await fork.testClient.revert({ id: outer })
      }
    },
    5_400_000,
  )
})
