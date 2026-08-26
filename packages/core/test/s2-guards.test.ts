import {
  BaseError,
  ContractFunctionRevertedError,
  HttpRequestError,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { describe, expect, it } from 'vitest'
import { ContractCallFailed, InvalidAmount, MCR, getAddresses } from '../src'
import { getBorrowingPower } from '../src/math'
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
    // MK-008 makes verification a required dep on every write path, so it cannot be
    // skipped by accident. These tests are about the revert handling, so it resolves.
    ensureVerified: async () => {},
    getMinNetDebt: async () => 1800n * 10n ** 18n,
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

/**
 * MK-010. `getBorrowingPower` binary searched over a caller supplied, unvalidated
 * collateral, issuing one `getBorrowingFee` call per step. Roughly 77 sequential calls for
 * one BTC, more for adversarial inputs, and a UI bound to a text input could point it at
 * any number.
 *
 * The chain-free half is here: input validation and the round trip count. The half that
 * needs a real deployment, that the fee really is linear and that the closed form agrees
 * with the search to the wei, is in `phase4.fork.test.ts`, because a claim about the
 * contract belongs against the contract.
 */
describe('MK-010, getBorrowingPower validates its input and stops iterating', () => {
  const PRICE = 77_051_107_320_000_000_000_000n
  const RATE = 10n ** 15n
  const PRECISION = 10n ** 18n

  function mathDeps() {
    let feeCalls = 0
    let multicalls = 0
    const publicClient = {
      multicall: async () => {
        multicalls += 1
        return [RATE, PRECISION, 5_000n * 10n ** 18n, 100_000n * 10n ** 18n]
      },
      readContract: async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
        if (functionName === 'fetchPrice') return PRICE
        if (functionName === 'checkRecoveryMode') return false
        if (functionName === 'getBorrowingFee') {
          feeCalls += 1
          return (RATE * (args?.[0] as bigint)) / PRECISION
        }
        throw new Error(`unexpected read: ${functionName}`)
      },
    } as unknown as PublicClient
    return {
      deps: {
        publicClient,
        addresses: T,
        getMinNetDebt: async () => 1_800n * 10n ** 18n,
        isAccountFeeExempt: async () => false,
      },
      feeCalls: () => feeCalls,
      multicalls: () => multicalls,
    }
  }

  it('rejects a non-positive collateral instead of searching over it', async () => {
    const { deps } = mathDeps()
    await expect(getBorrowingPower(deps, { collateral: 0n })).rejects.toBeInstanceOf(InvalidAmount)
    await expect(getBorrowingPower(deps, { collateral: -1n })).rejects.toBeInstanceOf(InvalidAmount)
  })

  it('costs a handful of calls, not one per binary search step', async () => {
    const { deps, feeCalls, multicalls } = mathDeps()
    const answer = await getBorrowingPower(deps, { collateral: 10n ** 18n })
    expect(answer).toBeGreaterThan(0n)
    // The old implementation needed roughly 77 getBorrowingFee calls for one BTC. Two here:
    // one to confirm the closed form's premise, one for the minNetDebt floor check.
    expect(feeCalls()).toBeLessThanOrEqual(4)
    expect(multicalls()).toBe(1)
  })

  it('the answer is exactly the boundary: feasible, and one wei more is not', async () => {
    const { deps } = mathDeps()
    const coll = 10n ** 18n
    const d = await getBorrowingPower(deps, { collateral: coll })
    const icr = (draw: bigint) => {
      const entireDebt = draw + (RATE * draw) / PRECISION + 200n * 10n ** 18n
      return (coll * PRICE) / entireDebt
    }
    expect(icr(d)).toBeGreaterThanOrEqual(MCR)
    expect(icr(d + 1n)).toBeLessThan(MCR)
  })

  it('returns 0 when the collateral cannot reach the debt floor at all', async () => {
    const { deps } = mathDeps()
    // Dust: the ICR cap is below the 200 gas reserve, so no open exists.
    await expect(getBorrowingPower(deps, { collateral: 1n })).resolves.toBe(0n)
  })
})
