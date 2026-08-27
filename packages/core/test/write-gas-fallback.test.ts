import type { PublicClient, WalletClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_GAS_MARGIN_PERCENT, MusdError, getAddresses } from '../src'
import { type WriteDeps, simulateAndSend } from '../src/internal/write'

const T = getAddresses(31611)
const ACCOUNT = { address: '0x000000000000000000000000000000000000dEaD', type: 'json-rpc' } as const

/**
 * MK-035. `simulateAndSend`'s gas handling has three branches and two of them only ever run
 * when something goes wrong, so before this file they were covered ONLY on runs where a flake
 * happened to trigger them. That made the coverage floor depend on whether the suite had a bad
 * day: the cleanest run of a five run window was the one that failed the gate, at 97.45%
 * against a floor of 98%, with every test passing.
 *
 * Covering them from a fake client makes the number deterministic and, more importantly, tests
 * the fallback that silently restores pre-MK-035 behavior.
 */
function deps(over: { estimate?: () => Promise<bigint>; margin?: number } = {}): {
  deps: WriteDeps
  sent: () => { gas?: bigint }
  estimatedWith: () => { account?: unknown }
} {
  let sentRequest: { gas?: bigint } = {}
  // MK-037 needs to see WHAT the estimate was asked, not only what it answered, because the
  // finding is entirely in the shape of the request.
  let estimateParams: { account?: unknown } = {}
  const publicClient = {
    simulateContract: async () => ({
      request: { address: T.borrowerOperations, abi: [], functionName: 'x' },
    }),
    estimateContractGas: async (params: { account?: unknown }) => {
      estimateParams = params
      return over.estimate ? await over.estimate() : 1_000_000n
    },
  } as unknown as PublicClient
  const walletClient = {
    account: ACCOUNT,
    writeContract: async (req: { gas?: bigint }) => {
      sentRequest = req
      return '0xhash'
    },
  } as unknown as WalletClient
  return {
    deps: {
      publicClient,
      walletClient,
      addresses: T,
      ensureVerified: async () => {},
      getMinNetDebt: async () => 1800n * 10n ** 18n,
      isAccountFeeExempt: async () => false,
      gasMarginPercent: over.margin ?? DEFAULT_GAS_MARGIN_PERCENT,
    },
    sent: () => sentRequest,
    estimatedWith: () => estimateParams,
  }
}

const wallet = { walletClient: {} as WalletClient, account: ACCOUNT as never }

describe('MK-035, the gas margin branches in simulateAndSend', () => {
  it('applies the margin to the estimate', async () => {
    const { deps: d, sent } = deps()
    await simulateAndSend(
      { ...d, walletClient: d.walletClient },
      { ...wallet, walletClient: d.walletClient as WalletClient },
      T.borrowerOperations,
      [],
      'openTrove',
      [],
    )
    expect(sent().gas).toBe(1_250_000n)
  })

  it('an explicit gas wins outright, estimate and margin ignored', async () => {
    const { deps: d, sent } = deps()
    await simulateAndSend(
      { ...d },
      { ...wallet, walletClient: d.walletClient as WalletClient },
      T.borrowerOperations,
      [],
      'openTrove',
      [],
      { gas: 42n },
    )
    expect(sent().gas).toBe(42n)
  })

  it('a FAILED estimate falls back to no explicit gas, and WARNS rather than going silent', async () => {
    // The branch that matters. It restores the pre-MK-035 behavior, which is the behavior that
    // produced the reverts, so it must never happen quietly. It did for exactly one wave, and
    // CI caught it with `margin=1.5%` and no explanation anywhere.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { deps: d, sent } = deps({
        estimate: async () => {
          throw new Error('execution reverted')
        },
      })
      await simulateAndSend(
        { ...d },
        { ...wallet, walletClient: d.walletClient as WalletClient },
        T.borrowerOperations,
        [],
        'openTrove',
        [],
      )
      expect(sent().gas).toBeUndefined()
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]?.[0])).toContain('gas estimation failed for openTrove')
      expect(String(warn.mock.calls[0]?.[0])).toContain('MK-035')
    } finally {
      warn.mockRestore()
    }
  })

  it('a zero margin sends the bare estimate, which is the documented opt out', async () => {
    const { deps: d, sent } = deps({ margin: 0 })
    await simulateAndSend(
      { ...d },
      { ...wallet, walletClient: d.walletClient as WalletClient },
      T.borrowerOperations,
      [],
      'openTrove',
      [],
    )
    expect(sent().gas).toBe(1_000_000n)
  })
})

/**
 * MK-037. The margin from MK-035 could be dropped on any send with no trace a consumer could
 * reach, and it was being dropped for a reason that was itself a gas cap.
 *
 * Two independent things are pinned here and they fail for different reasons, deliberately:
 * the REQUEST that goes out (so the mechanism cannot come back), and the RESULT that comes
 * back (so a future silent fallback cannot hide again).
 */
describe('MK-037, the margin cannot be lost without the caller knowing', () => {
  it('MK-037: the estimate is asked with an ADDRESS, never with the Account object', async () => {
    // THE MECHANISM. Passing the `Account` object makes viem run `prepareTransactionRequest`,
    // which puts a `gas` field on the `eth_estimateGas` request; the node then treats that as
    // the ceiling of its own search and the estimate reverts as soon as the real work grows
    // past a cap the estimate itself invented. The write, which sends no gas field, succeeds.
    // Measured on the fork: 2 estimate calls with the second capped, against 1 uncapped call,
    // both returning 662616.
    //
    // Mutation proof: restore `estimateContractGas(sim ...)` in `internal/write.ts` and this
    // assertion fails, because `sim.account` is the object.
    const { deps: d, estimatedWith } = deps()
    await simulateAndSend(
      { ...d },
      { ...wallet, walletClient: d.walletClient as WalletClient },
      T.borrowerOperations,
      [],
      'openTrove',
      [],
    )
    expect(
      typeof estimatedWith().account,
      'MK-037: an Account object here re-imposes the self cap that broke the estimate',
    ).toBe('string')
    expect(estimatedWith().account).toBe(ACCOUNT.address)
  })

  it('MK-037: a successful estimate is reported on the result with its inputs', async () => {
    const { deps: d } = deps()
    const result = await simulateAndSend(
      { ...d },
      { ...wallet, walletClient: d.walletClient as WalletClient },
      T.borrowerOperations,
      [],
      'openTrove',
      [],
    )
    expect(result.gas).toEqual({
      source: 'estimate',
      limit: 1_250_000n,
      estimate: 1_000_000n,
      marginPercent: DEFAULT_GAS_MARGIN_PERCENT,
    })
  })

  it('MK-037: a FAILED estimate is reported on the result, with the typed error', async () => {
    // THE POINT OF THE FINDING. Before this, the only trace was `console.warn`, which a library
    // consumer cannot assert on, cannot route to telemetry, and does not see in a filtered
    // console. The send still goes out with pre-MK-035 behavior; the difference is that the
    // caller can now tell that it did.
    //
    // Mutation proof: change the catch back to `return undefined` and drop `gas` from the
    // returned object, and this test fails on `result.gas` being undefined.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { deps: d, sent } = deps({
        estimate: async () => {
          throw new Error('execution reverted: out of gas')
        },
      })
      const result = await simulateAndSend(
        { ...d },
        { ...wallet, walletClient: d.walletClient as WalletClient },
        T.borrowerOperations,
        [],
        'openTrove',
        [],
      )
      expect(
        sent().gas,
        'the send still carries no explicit limit, that half is unchanged',
      ).toBeUndefined()
      expect(result.gas.source).toBe('fallback')
      expect(result.gas.limit).toBeUndefined()
      const error = result.gas.source === 'fallback' ? result.gas.error : undefined
      expect(
        error,
        'MK-037: the reason must reach the caller, not only the console',
      ).toBeInstanceOf(MusdError)
      expect(String(error?.message)).toContain('out of gas')
    } finally {
      warn.mockRestore()
    }
  })

  it('MK-037: an explicit gas is reported as the explicit decision it is', async () => {
    const { deps: d } = deps()
    const result = await simulateAndSend(
      { ...d },
      { ...wallet, walletClient: d.walletClient as WalletClient },
      T.borrowerOperations,
      [],
      'openTrove',
      [],
      { gas: 42n },
    )
    expect(result.gas).toEqual({ source: 'explicit', limit: 42n })
  })
})
