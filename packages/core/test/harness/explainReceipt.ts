import type { Address, Hash, PublicClient, TransactionReceipt } from 'viem'
import { MCR, getAddresses, hintHelpersAbi, priceFeedAbi, troveManagerAbi } from '../../src'

const T = getAddresses(31611)

/**
 * Say what a transaction actually did, when something expected of it is missing (MK-031).
 *
 * Three times in this programme a fork failure has erased its own cause. `redemptionEv` in
 * `phase6.fork.test.ts` looked up an event with `parseEventLogs(...)[0]!` and read `.args`
 * off it, so a transaction that reverted, or that mined without emitting, surfaced as
 * `TypeError: Cannot read properties of undefined (reading 'args')` and nothing else. That
 * is MK-024's complaint about a sibling test, written down and then not acted on, and it
 * cost a diagnosis from scratch every time.
 *
 * This does not retry, does not soften an assertion and does not change what passes. It only
 * turns "undefined" into the state a reader needs: what the receipt says, what the chain says
 * when the call is replayed, what was emitted instead, and the fork conditions that the
 * suite's own findings say are the usual suspects.
 *
 * `eth_call` at the mined block is what recovers a revert reason: a receipt carries the
 * status but not the reason. It is best effort and its limits are stated in the output rather
 * than assumed away, because getting them wrong costs a wave: the replay runs against END of
 * block state, which is after the failing transaction, so a non-reverting replay does NOT
 * prove the failure was not a `require`.
 *
 * `gasLimit` beside `gasUsed` is the one unambiguous discriminator here. Equal means out of
 * gas. Unequal rules it out, which is exactly what it did the first time it fired (MK-035).
 */
export async function explainTransaction(
  publicClient: PublicClient,
  hash: Hash,
  what: string,
): Promise<string> {
  const lines: string[] = [`MISSING ${what} for tx ${hash}`]

  let receipt: TransactionReceipt | undefined
  try {
    // WAIT rather than fetch: a caller that reaches here has usually already waited, but one
    // that has not would otherwise get "receipt could not be found" and learn nothing, which
    // is the failure mode this whole helper exists to remove.
    receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 30_000 })
  } catch (error) {
    lines.push(`  receipt: could not be read (${(error as Error).message.split('\n')[0]})`)
  }

  if (receipt) {
    lines.push(`  status: ${receipt.status}`)
    // The gas LIMIT, not just what was used. `gasUsed === gas` is the unambiguous signature
    // of out of gas, and it is the difference between "the contract refused" and "the
    // estimate was too small", which read identically in a receipt (MK-035).
    let gasLimit: bigint | undefined
    try {
      gasLimit = (await publicClient.getTransaction({ hash })).gas
    } catch {
      gasLimit = undefined
    }
    lines.push(
      `  block: ${receipt.blockNumber}  gasUsed: ${receipt.gasUsed}  gasLimit: ${gasLimit ?? 'unknown'}`,
    )
    if (gasLimit !== undefined && receipt.gasUsed === gasLimit) {
      lines.push('  OUT OF GAS: gasUsed equals the limit, so the estimate was too small')
    }
    lines.push(`  logs emitted: ${receipt.logs.length}`)
    for (const log of receipt.logs) {
      lines.push(`    from ${log.address} topic0 ${log.topics[0] ?? '(anonymous)'}`)
    }
    if (receipt.status === 'reverted') {
      lines.push(`  revert reason: ${await replayForReason(publicClient, hash, receipt)}`)
    }
  }

  lines.push(await forkConditions(publicClient))
  return lines.join('\n')
}

/**
 * Replay the transaction as an `eth_call` at the block it mined in, to recover the revert
 * reason the receipt does not carry.
 */
async function replayForReason(
  publicClient: PublicClient,
  hash: Hash,
  receipt: TransactionReceipt,
): Promise<string> {
  try {
    const tx = await publicClient.getTransaction({ hash })
    await publicClient.call({
      account: tx.from,
      to: tx.to as Address,
      data: tx.input,
      value: tx.value,
      blockNumber: receipt.blockNumber,
    })
    return (
      'the replay did NOT revert. Read this carefully: `eth_call` at a block number executes ' +
      'against the state at the END of that block, which is AFTER the failing transaction and ' +
      'everything else in it. So this is not a faithful reproduction, and it is weaker evidence ' +
      'than it looks. It rules out a condition that is still true at end of block; it does not ' +
      'rule out a require that was true mid block.'
    )
  } catch (error) {
    const e = error as { shortMessage?: string; message?: string }
    return e.shortMessage ?? e.message ?? String(error)
  }
}

/**
 * The fork conditions this suite's own findings keep pointing at: the seeded oracle answer
 * and its age, the block, and whether the system is in Recovery Mode. MK-016 and MK-020
 * between them establish that ordering and oracle staleness are the two variables that move.
 */
async function forkConditions(publicClient: PublicClient): Promise<string> {
  const out: string[] = ['  fork conditions:']
  try {
    const blockNumber = await publicClient.getBlockNumber()
    const [price, isRecoveryMode] = await Promise.all([
      publicClient.readContract({
        address: T.priceFeed,
        abi: priceFeedAbi,
        functionName: 'fetchPrice',
      }),
      publicClient
        .readContract({
          address: T.priceFeed,
          abi: priceFeedAbi,
          functionName: 'fetchPrice',
        })
        .then((p) =>
          publicClient.readContract({
            address: T.troveManager,
            abi: troveManagerAbi,
            functionName: 'checkRecoveryMode',
            args: [p],
          }),
        ),
    ])
    const block = await publicClient.getBlock({ blockNumber })
    out.push(`    head block: ${blockNumber}  timestamp: ${block.timestamp}`)
    out.push(`    fetchPrice(): ${price}`)
    out.push(`    recovery mode: ${isRecoveryMode}`)
    out.push(`    MEZO_FORK_BLOCK: ${process.env.MEZO_FORK_BLOCK ?? '(unset)'}`)
  } catch (error) {
    out.push(`    could not be read (${(error as Error).message})`)
  }
  return out.join('\n')
}

/**
 * The redemption tail's margin above MCR, at this instant (MK-016).
 *
 * `redeemCollateral` walks `SortedTroves` from the lowest NICR and skips anything under MCR,
 * so the FIRST redemption hint's ICR is the number that decides whether a redemption can do
 * anything at all. When it drops below MCR the contract reverts
 * `TroveManager: Unable to redeem any amount`, whatever the requested size.
 *
 * Logged before every redemption in the suite, on passing runs too, because a margin that is
 * only ever printed when a test fails cannot show you it was already thin on the runs that
 * passed.
 */
export async function reportRedemptionMargin(
  publicClient: PublicClient,
  label: string,
  amount: bigint,
): Promise<void> {
  try {
    const price = await publicClient.readContract({
      address: T.priceFeed,
      abi: priceFeedAbi,
      functionName: 'fetchPrice',
    })
    const [firstHint, , truncated] = await publicClient.readContract({
      address: T.hintHelpers,
      abi: hintHelpersAbi,
      functionName: 'getRedemptionHints',
      args: [amount, price, 100n],
    })
    const icr = await publicClient.readContract({
      address: T.troveManager,
      abi: troveManagerAbi,
      functionName: 'getCurrentICR',
      args: [firstHint, price],
    })
    const block = await publicClient.getBlock({ blockTag: 'latest' })
    console.log(
      `[margin] ${label} requested=${amount} redeemable=${truncated} firstHint=${firstHint} ` +
        `icr=${icr} mcr=${MCR} marginAboveMcr=${icr - MCR} timestamp=${block.timestamp}`,
    )
  } catch (error) {
    console.log(`[margin] ${label} could not be read (${(error as Error).message.split('\n')[0]})`)
  }
}
