import type { Hash, PublicClient } from 'viem'

/**
 * What a reverted write was, as far as evidence available to an ordinary consumer allows.
 *
 * `OUT_OF_GAS` and `REVERTED` are the two the caller has to act on differently: the first is
 * retryable as-is with a higher limit, the second is not retryable at all until whatever the
 * contract objected to changes. `INDETERMINATE` exists because those two are NOT always
 * distinguishable without a tracing endpoint, and saying so is better than guessing (MK-035).
 */
export type WriteFailureKind = 'SUCCEEDED' | 'OUT_OF_GAS' | 'REVERTED' | 'INDETERMINATE'

/** The verdict on a mined write, plus the evidence it was reached from. */
export interface WriteDiagnosis {
  kind: WriteFailureKind
  /** The gas limit the transaction carried. */
  gasLimit: bigint
  /** What it actually consumed. */
  gasUsed: bigint
  /** A sentence naming what to do next. */
  advice: string
  /**
   * The revert reason, when the chain gave one back on a re-execution at the mined block.
   * Absent for out of gas, which carries no reason data.
   */
  reason?: string
}

/**
 * Decide whether a reverted write ran out of gas or was refused by the contract (MK-035).
 *
 * **Why this exists.** The SDK returns `{ hash }` without awaiting the receipt, by design, so
 * a revert that happens after a passing simulation is something the caller discovers later
 * and previously had no way to classify. Nothing in the error surface distinguished
 * exhaustion from refusal, and the two call for opposite responses.
 *
 * **What evidence a consumer actually has**, without a tracing endpoint, established rather
 * than assumed:
 *
 *   1. `gasUsed === gasLimit`. Conclusive for exhaustion, but ONLY at the top level. The EVM
 *      forwards at most 63/64 of the remaining gas to a nested call, so an inner frame can
 *      exhaust its allowance while the outer frame keeps the last 1/64. A traced occurrence
 *      of exactly that showed `gasUsed 710023` against `gasLimit 720980`.
 *   2. Re-executing the same call at the mined block. If it reverts WITH a reason, the
 *      contract refused and the reason is the answer. This is the strong case.
 *   3. If the re-execution does NOT revert, that is genuinely ambiguous. `eth_call` at a
 *      block number runs against END of block state, after the failing transaction and
 *      everything else in it, so a condition that was true mid block is invisible to it. It
 *      is consistent with a nested out of gas AND with a race the caller lost.
 *
 * Case 3 returns `INDETERMINATE`, and that is not a hedge: it is the honest boundary of what
 * is knowable here. `debug_traceTransaction` settles it, and most public endpoints do not
 * expose it. The advice for that case says so.
 */
export async function diagnoseRevertedWrite(
  publicClient: PublicClient,
  hash: Hash,
): Promise<WriteDiagnosis> {
  const [receipt, tx] = await Promise.all([
    publicClient.getTransactionReceipt({ hash }),
    publicClient.getTransaction({ hash }),
  ])

  if (receipt.status === 'success') {
    return {
      kind: 'SUCCEEDED',
      gasLimit: tx.gas,
      gasUsed: receipt.gasUsed,
      advice: 'The transaction succeeded; there is nothing to diagnose.',
    }
  }

  if (receipt.gasUsed === tx.gas) {
    return {
      kind: 'OUT_OF_GAS',
      gasLimit: tx.gas,
      gasUsed: receipt.gasUsed,
      advice:
        'Out of gas at the top level: gasUsed equals the limit. Resend with a larger gas limit, either by raising `gasMarginPercent` on the client or by passing an explicit limit. Nothing about the request itself was wrong.',
    }
  }

  try {
    await publicClient.call({
      account: tx.from,
      to: tx.to ?? undefined,
      data: tx.input,
      value: tx.value,
      blockNumber: receipt.blockNumber,
    })
  } catch (error) {
    const e = error as { shortMessage?: string; message?: string }
    const reason = e.shortMessage ?? e.message
    return {
      kind: 'REVERTED',
      gasLimit: tx.gas,
      gasUsed: receipt.gasUsed,
      ...(reason !== undefined ? { reason } : {}),
      advice:
        'The contract refused the call and still refuses it at the block it mined in, so this is not a gas problem and resending unchanged will fail the same way. Fix the condition in the reason.',
    }
  }

  return {
    kind: 'INDETERMINATE',
    gasLimit: tx.gas,
    gasUsed: receipt.gasUsed,
    advice:
      'It reverted, it did not exhaust the top level gas, and the same call does not revert when replayed at the block it mined in. That is consistent with a nested call running out of gas (the outer frame keeps the last 1/64, so gasUsed stays below the limit) and equally with a condition that was true mid block and is no longer. Distinguishing them needs `debug_traceTransaction`, which most public endpoints do not expose. If you can trace, do; otherwise resending with a larger limit is the cheaper of the two things to rule out.',
  }
}
