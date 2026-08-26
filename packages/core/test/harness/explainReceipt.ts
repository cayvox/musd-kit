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
/** The RPC URL a viem client is bound to, for the raw `debug_` call viem does not expose. */
function rpcUrlOf(publicClient: PublicClient): string {
  const url = (publicClient as unknown as { transport?: { url?: string } }).transport?.url
  return url ?? (process.env.MUSD_FORK_RPC_URL as string)
}

const indent = (text: string, spaces: number): string =>
  text
    .split('\n')
    .map((line) => `${' '.repeat(spaces)}${line}`)
    .join('\n')

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
      lines.push('  OUT OF GAS at the TOP level: gasUsed equals the limit')
    }
    lines.push(`  logs emitted: ${receipt.logs.length}`)
    for (const log of receipt.logs) {
      lines.push(`    from ${log.address} topic0 ${log.topics[0] ?? '(anonymous)'}`)
    }
    if (receipt.status === 'reverted') {
      // The trace FIRST, because it is a record of what executed rather than an inference
      // from state that has since moved (MK-035).
      const traced = await traceRevert(rpcUrlOf(publicClient), hash)
      if (traced) {
        // MK-035. The top level check above is NOT sufficient and saying so here is the
        // point: the EVM forwards at most 63/64 of the remaining gas to a nested call, so an
        // inner frame can exhaust its allowance while the outer frame still holds the last
        // 1/64. The receipt then shows `gasUsed < gasLimit` and looks like an ordinary
        // revert. That is exactly how out of gas was wrongly ruled out for this finding.
        if (traced.outOfGas) {
          lines.push(
            `  OUT OF GAS in a NESTED call at depth ${traced.depth}. The receipt cannot show this: the outer frame keeps the last 1/64 of the gas, so gasUsed < gasLimit even though a callee ran out.`,
          )
        }
        lines.push(`  reverted in: ${traced.address ?? 'unknown'} at call depth ${traced.depth}`)
        lines.push(`  revert reason (from trace): ${traced.reason ?? '(no Error(string) data)'}`)
        if (traced.tree) lines.push(`  failing call path:\n${indent(traced.tree, 4)}`)
      } else {
        lines.push('  trace: debug_traceTransaction returned nothing for this hash')
      }
      lines.push(`  replay at end of block: ${await replayForReason(publicClient, hash, receipt)}`)
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

/**
 * One frame of a `callTracer` trace. Only the fields this harness reads are declared.
 */
interface CallFrame {
  from?: string
  to?: string
  input?: string
  output?: string
  error?: string
  revertReason?: string
  calls?: CallFrame[]
}

/**
 * The innermost call that reverted, and the reason string it carried (MK-035).
 *
 * A receipt says `reverted` and nothing else, and the `eth_call` replay this file already
 * does runs against END of block state, so it cannot see a condition that was false mid
 * block. A transaction level trace can, because it is a record of what actually executed.
 *
 * Tracing support was established against the harness's own anvil (1.5.1) rather than
 * assumed: `debug_traceTransaction` works both with default struct logs and with
 * `tracer: 'callTracer'`, `trace_transaction` works, and `trace_replayTransaction` returns
 * "Method not found". `callTracer` is used because it gives the call TREE, so the deepest
 * frame carrying an `error` names the contract that actually reverted rather than the one
 * the transaction was addressed to.
 */
export async function traceRevert(
  rpcUrl: string,
  hash: Hash,
): Promise<
  { address?: string; reason?: string; depth: number; tree: string; outOfGas: boolean } | undefined
> {
  let frame: CallFrame
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'debug_traceTransaction',
        params: [hash, { tracer: 'callTracer' }],
      }),
    })
    const body = (await response.json()) as { result?: CallFrame; error?: { message: string } }
    if (!body.result) return undefined
    frame = body.result
  } catch {
    return undefined
  }

  // Walk to the DEEPEST frame that failed. The outer frames all report an error too, since a
  // revert propagates, so the outermost one names the entry point rather than the culprit.
  const lines: string[] = []
  let deepest: { frame: CallFrame; depth: number } | undefined
  // The reason and the deepest frame are tracked SEPARATELY, and that is not fussiness. These
  // contracts are proxies: `BorrowerOperations` at the bundled address delegates, so the
  // deepest failing frame is the implementation, and `callTracer` leaves the `Error(string)`
  // data on whichever frame carries it, not necessarily the innermost. Taking the reason from
  // the deepest frame alone reports "(no Error(string) data)" on a revert that plainly has
  // one, which it did the first time this was written.
  let reason: string | undefined
  let outOfGas = false
  const walk = (f: CallFrame, depth: number): void => {
    if (f.error) {
      if (/out of gas/i.test(f.error)) outOfGas = true
      lines.push(`${'  '.repeat(depth)}${f.to ?? '?'} ${f.input?.slice(0, 10) ?? ''} -> ${f.error}`)
      deepest = { frame: f, depth }
      const decoded = readReason(f)
      if (decoded !== undefined && decoded !== '(empty revert, no reason data)') reason = decoded
      else if (decoded !== undefined && reason === undefined) reason = decoded
    }
    for (const child of f.calls ?? []) walk(child, depth + 1)
  }
  walk(frame, 0)
  if (!deepest) return undefined

  return {
    ...(deepest.frame.to !== undefined ? { address: deepest.frame.to } : {}),
    ...(reason !== undefined ? { reason } : {}),
    depth: deepest.depth,
    tree: lines.join('\n'),
    outOfGas,
  }
}

/**
 * The reason a frame carries, from either shape anvil uses.
 *
 * `callTracer` populates `revertReason` as a PLAIN STRING and `output` as the ABI encoded
 * `Error(string)`. Feeding the plain string to the hex decoder returns nothing, which is what
 * made the first version of this report say "(no Error(string) data)" about a revert that
 * plainly had one. Both shapes are read.
 */
function readReason(frame: CallFrame): string | undefined {
  const direct = frame.revertReason
  if (typeof direct === 'string' && direct.length > 0 && !direct.startsWith('0x')) return direct
  return decodeErrorString(direct ?? frame.output)
}

/**
 * Decode `Error(string)` returndata. Selector `0x08c379a0`, then an ABI encoded string.
 * Anything else, including an empty revert or a custom error, comes back undefined rather
 * than as a guess.
 */
function decodeErrorString(data: string | undefined): string | undefined {
  if (!data) return undefined
  if (!data.startsWith('0x08c379a0')) {
    return data === '0x' ? '(empty revert, no reason data)' : undefined
  }
  try {
    const hex = data.slice(10)
    const length = Number(BigInt(`0x${hex.slice(64, 128)}`))
    const bytes = hex.slice(128, 128 + length * 2)
    return Buffer.from(bytes, 'hex').toString('utf8')
  } catch {
    return undefined
  }
}
