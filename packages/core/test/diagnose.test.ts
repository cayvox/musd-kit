import type { Hash, PublicClient } from 'viem'
import { describe, expect, it } from 'vitest'
import { DEFAULT_GAS_MARGIN_PERCENT, diagnoseRevertedWrite, withGasMargin } from '../src'

const HASH = '0xfeed' as Hash

/**
 * A `publicClient` that answers the three reads `diagnoseRevertedWrite` makes. Chain free on
 * purpose: the function is a decision procedure over a receipt, a transaction and one replay,
 * and the interesting part is which verdict it reaches, not what a chain returns.
 */
function fakeClient(opts: {
  status: 'success' | 'reverted'
  gasUsed: bigint
  gas: bigint
  replayThrows?: Error
}) {
  return {
    getTransactionReceipt: async () => ({
      status: opts.status,
      gasUsed: opts.gasUsed,
      blockNumber: 100n,
    }),
    getTransaction: async () => ({
      gas: opts.gas,
      from: '0x0000000000000000000000000000000000000001',
      to: '0x0000000000000000000000000000000000000002',
      input: '0xdeadbeef',
      value: 0n,
    }),
    call: async () => {
      if (opts.replayThrows) throw opts.replayThrows
      return { data: '0x' }
    },
  } as unknown as PublicClient
}

/**
 * MK-035. The SDK returns `{ hash }` without awaiting the receipt, so a revert after a passing
 * simulation is something the caller finds later and previously could not classify. Out of gas
 * and a protocol refusal call for opposite responses, and nothing distinguished them.
 */
describe('MK-035, diagnoseRevertedWrite tells exhaustion from refusal', () => {
  it('a successful receipt is not a failure to diagnose', async () => {
    const d = await diagnoseRevertedWrite(
      fakeClient({ status: 'success', gasUsed: 1n, gas: 2n }),
      HASH,
    )
    expect(d.kind).toBe('SUCCEEDED')
    expect(d.gasUsed).toBe(1n)
    expect(d.gasLimit).toBe(2n)
  })

  it('gasUsed equal to the limit is conclusive: OUT_OF_GAS', async () => {
    const d = await diagnoseRevertedWrite(
      fakeClient({ status: 'reverted', gasUsed: 500n, gas: 500n }),
      HASH,
    )
    expect(d.kind).toBe('OUT_OF_GAS')
    expect(d.advice).toContain('larger gas limit')
  })

  it('a replay that still reverts is conclusive the other way: REVERTED, with the reason', async () => {
    const err = Object.assign(new Error('long form'), {
      shortMessage: 'BorrowerOps: Trove does not exist or is closed',
    })
    const d = await diagnoseRevertedWrite(
      fakeClient({ status: 'reverted', gasUsed: 400n, gas: 500n, replayThrows: err }),
      HASH,
    )
    expect(d.kind).toBe('REVERTED')
    expect(d.reason).toBe('BorrowerOps: Trove does not exist or is closed')
    expect(d.advice).toContain('resending unchanged will fail')
  })

  it('falls back to `message` when the error carries no shortMessage', async () => {
    const d = await diagnoseRevertedWrite(
      fakeClient({ status: 'reverted', gasUsed: 400n, gas: 500n, replayThrows: new Error('bare') }),
      HASH,
    )
    expect(d.kind).toBe('REVERTED')
    expect(d.reason).toBe('bare')
  })

  it('reverted, gas left, and a replay that passes is INDETERMINATE, not a guess', async () => {
    // This is the case that matters. A nested call can exhaust its allowance while the outer
    // frame keeps the last 1/64, so `gasUsed < gasLimit`; and `eth_call` at a block number
    // runs against end of block state, so a mid block condition is invisible to it. Claiming
    // either verdict here would be inventing evidence.
    const d = await diagnoseRevertedWrite(
      fakeClient({ status: 'reverted', gasUsed: 710023n, gas: 720980n }),
      HASH,
    )
    expect(d.kind).toBe('INDETERMINATE')
    expect(d.reason).toBeUndefined()
    expect(d.advice).toContain('debug_traceTransaction')
    // The real traced numbers, so the case this exists for is the case that is pinned.
    expect(d.gasUsed).toBe(710023n)
    expect(d.gasLimit).toBe(720980n)
  })
})

/**
 * MK-035. The margin arithmetic itself, chain free. `withGasMargin` is the one line every SDK
 * write now passes through, so its degenerate inputs are worth pinning rather than assuming.
 */
describe('MK-035, withGasMargin', () => {
  it('applies the default: 25 percent over the estimate', () => {
    expect(withGasMargin(1_000_000n, DEFAULT_GAS_MARGIN_PERCENT)).toBe(1_250_000n)
    expect(DEFAULT_GAS_MARGIN_PERCENT).toBe(25)
  })

  it('a zero or negative margin returns the estimate untouched', () => {
    // `0` is the documented way to restore the pre-MK-035 behavior, so it must be exact
    // rather than approximately the estimate.
    expect(withGasMargin(1_000_000n, 0)).toBe(1_000_000n)
    expect(withGasMargin(1_000_000n, -10)).toBe(1_000_000n)
  })

  it('a non finite margin returns the estimate rather than NaN gas', () => {
    expect(withGasMargin(1_000_000n, Number.NaN)).toBe(1_000_000n)
    expect(withGasMargin(1_000_000n, Number.POSITIVE_INFINITY)).toBe(1_000_000n)
  })

  it('rounds the percentage rather than throwing on a fractional one', () => {
    expect(withGasMargin(1_000_000n, 12.4)).toBe(1_120_000n)
  })

  it('the margin clears the worst growth ever traced for this SDK', () => {
    // 610270 to 710023 gas is the redeem that reverted (MK-035). The default must cover it.
    const worstObserved = 710023n
    expect(withGasMargin(610_270n, DEFAULT_GAS_MARGIN_PERCENT)).toBeGreaterThan(worstObserved)
  })
})
