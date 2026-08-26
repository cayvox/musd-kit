import {
  BaseError,
  ContractFunctionRevertedError,
  HttpRequestError,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { describe, expect, it } from 'vitest'
import { ContractCallFailed, getAddresses } from '../src'
// `claim` is reached through `createMusdClient` on the public surface; imported directly
// here because these are white box tests of the guard inside it, not of the wiring.
import { type WriteDeps, claim } from '../src/trove'

const T = getAddresses(31611)
const ACCOUNT = { address: '0x000000000000000000000000000000000000dEaD', type: 'json-rpc' } as const

/**
 * Build a viem error shaped exactly like a real simulation revert, so the SDK's decoder
 * walks it the same way it walks the genuine article. `walk` is what
 * `errors/mapRevert.ts` uses; a hand rolled `{ message }` would take the fallback path and
 * prove nothing about the branch under test.
 */
function revertError(reason: string): BaseError {
  const inner = new ContractFunctionRevertedError({
    abi: [],
    functionName: 'claimCollateral',
    message: `execution reverted: ${reason}`,
  })
  // viem builds `reason` from decoded revert data; the constructor above cannot be handed
  // raw data without an ABI, so set the field the decoder actually reads.
  Object.assign(inner, { reason })
  const outer = new BaseError('The contract function reverted.')
  Object.assign(outer, {
    cause: inner,
    walk: (fn: (e: unknown) => boolean) => (fn(inner) ? inner : fn(outer) ? outer : null),
  })
  return outer
}

function writeDeps(simulate: () => Promise<unknown>): WriteDeps {
  return {
    publicClient: { simulateContract: simulate } as unknown as PublicClient,
    walletClient: {
      account: ACCOUNT,
      writeContract: async () => '0xhash',
    } as unknown as WalletClient,
    addresses: T,
  }
}

/**
 * MK-007. `claim()` used to wrap simulate and send in a bare `catch {}` and report every
 * failure as `{ claimed: false }`. That was the single violation of the policy stated at the
 * top of `errors/mapRevert.ts`: a revert is never swallowed, and anything unrecognized
 * surfaces as a typed error with its cause attached.
 *
 * The dangerous case is not the revert, it is everything else. A user with real claimable
 * surplus on a degraded RPC was told, indistinguishably from the truth, that they had
 * nothing. These tests would have caught that: the first two are the shape that used to
 * pass while lying, and they are chain free because the defect has nothing to do with the
 * chain.
 */
describe('MK-007, claim() swallows exactly one revert and nothing else', () => {
  it('the no surplus revert is still a clean no-op', async () => {
    const deps = writeDeps(async () => {
      throw revertError('CollSurplusPool: No collateral available to claim')
    })
    await expect(claim(deps)).resolves.toEqual({ claimed: false, hash: null })
  })

  it('an RPC failure reaches the caller instead of being reported as nothing to claim', async () => {
    const deps = writeDeps(async () => {
      throw new HttpRequestError({ url: 'http://127.0.0.1:1/', details: 'connect ECONNREFUSED' })
    })
    // The old implementation resolved `{ claimed: false, hash: null }` here, which is the
    // exact lie: a transport failure rendered as a fact about the user's balance.
    await expect(claim(deps)).rejects.toThrow(ContractCallFailed)
  })

  it('a DIFFERENT revert is not mistaken for the no surplus one', async () => {
    const deps = writeDeps(async () => {
      throw revertError('BorrowerOps: Trove does not exist or is closed')
    })
    await expect(claim(deps)).rejects.toThrow()
    await expect(claim(deps)).rejects.not.toBeInstanceOf(TypeError)
  })

  it('the rethrown error keeps the original failure as its cause', async () => {
    const original = new HttpRequestError({ url: 'http://127.0.0.1:1/', details: 'timeout' })
    const deps = writeDeps(async () => {
      throw original
    })
    const err = await claim(deps).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ContractCallFailed)
    expect((err as Error).cause).toBe(original)
  })
})
