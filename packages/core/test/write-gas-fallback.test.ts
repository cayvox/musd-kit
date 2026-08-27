import type { PublicClient, WalletClient } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_GAS_MARGIN_PERCENT, getAddresses } from '../src'
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
} {
  let sentRequest: { gas?: bigint } = {}
  const publicClient = {
    simulateContract: async () => ({
      request: { address: T.borrowerOperations, abi: [], functionName: 'x' },
    }),
    estimateContractGas: over.estimate ?? (async () => 1_000_000n),
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
      gasMarginPercent: over.margin ?? DEFAULT_GAS_MARGIN_PERCENT,
    },
    sent: () => sentRequest,
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
