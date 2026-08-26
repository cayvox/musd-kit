import { http, createWalletClient, parseEther } from 'viem'
import { describe, expect, it } from 'vitest'
import { borrowerOperationsAbi, getAddresses } from '../src'
import { connectFork } from './harness'
import { mezoTestnet } from './harness/constants'
import { explainTransaction } from './harness/explainReceipt'
import { testAccount } from './harness/openTroveRaw'

const T = getAddresses(31611)

/**
 * MK-031. Three fork failures in this programme have arrived as
 * `TypeError: Cannot read properties of undefined (reading 'args')`, which says nothing about
 * what the chain did. `explainTransaction` is what those call sites throw instead, so it has
 * to keep working: a diagnostic that silently stops reporting is worse than none, because the
 * next failure looks like it had nothing to say.
 *
 * This file is deliberately near the FRONT of the alphabetical order the sequencer imposes
 * (`vitest.config.mts`), before any file that warps the clock or mutates the sorted list, so
 * it cannot be perturbed by them and cannot perturb them: it sends one self transfer and one
 * transaction that is meant to revert.
 */
describe('MK-031, the diagnostic that replaces a bare TypeError', () => {
  it('reports status, logs and fork conditions for a tx that simply lacks the event', async () => {
    const fork = connectFork()
    const account = testAccount(9001)
    await fork.fundAccount(account.address, parseEther('2'))
    const wallet = createWalletClient({
      account,
      chain: mezoTestnet,
      transport: http(fork.rpcUrl),
    })
    const hash = await wallet.sendTransaction({ to: account.address, value: 1n })
    const report = await explainTransaction(fork.publicClient, hash, 'Redemption event')

    expect(report).toContain('MISSING Redemption event')
    expect(report).toContain('status: success')
    expect(report).toContain('logs emitted: 0')
    // The conditions the suite's own findings keep pointing at (MK-016, MK-020).
    expect(report).toContain('fetchPrice():')
    expect(report).toContain('recovery mode:')
    expect(report).toContain('MEZO_FORK_BLOCK:')
  }, 120_000)

  it('recovers the revert REASON, which the receipt does not carry', async () => {
    const fork = connectFork()
    const account = testAccount(9002)
    await fork.fundAccount(account.address, parseEther('2'))
    const wallet = createWalletClient({
      account,
      chain: mezoTestnet,
      transport: http(fork.rpcUrl),
    })
    // A guaranteed revert: `closeTrove()` from an address with no Trove. Sent with an
    // explicit gas limit so it is broadcast rather than rejected at estimation, which is
    // exactly the shape of the silent revert this suite keeps hitting.
    const hash = await wallet.writeContract({
      address: T.borrowerOperations,
      abi: borrowerOperationsAbi,
      functionName: 'closeTrove',
      gas: 300_000n,
      chain: mezoTestnet,
    })
    const report = await explainTransaction(fork.publicClient, hash, 'Redemption event')

    expect(report).toContain('status: reverted')
    // The whole point: the reason, recovered by replaying the call at the mined block.
    expect(report).toContain('Trove does not exist or is closed')
  }, 120_000)
})
