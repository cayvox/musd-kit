import type { PublicClient, WalletClient } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REDEMPTION_MAX_ITERATIONS,
  InvalidAmount,
  REDEMPTION_SEND_MARGIN_SECONDS,
  getAddresses,
  previewRedeem,
} from '../src'
import type { WriteDeps } from '../src/internal/write'
import { redeem } from '../src/redemption/redeem'

/**
 * MK-114. `maxIterations: 0n` means NO LIMIT to the contract.
 *
 * `HintHelpers.getRedemptionHints` and `TroveManager.redeemCollateral` both replace a zero
 * `_maxIterations` with `type(uint256).max` (`HintHelpers.sol:107-109`, `TroveManager.sol:353-355`),
 * and the deployed helper answers that way at the pinned block: a 400,000 MUSD request is truncated
 * to 298,067 MUSD at 100 iterations and returned whole at 0 (the calls are in the register entry).
 * The preview is the SDK's restatement of that walk, so it has to read zero the same way.
 *
 * The chain side of the same question is `redeem-max-iterations.fork.test.ts`, which sends at zero
 * and compares what the chain redeemed against the preview.
 */

const E18 = 10n ** 18n
const MUSD = E18
const BTC = E18
const M = 1_800n * MUSD
const PRICE = 76_750n * MUSD
const RATE = 100n
const ZERO = '0x0000000000000000000000000000000000000000'
const HELPER_NICR = 123n

/** Every Trove in the list is eligible and carries 30,030 MUSD of net debt. */
const NET_DEBT = 30_030n * MUSD

function listOf(size: number) {
  const troves = Array.from(
    { length: size },
    (_, i) => `0x${(0xb1 + i).toString(16).padStart(40, '0')}` as `0x${string}`,
  )
  const reads: string[] = []
  const sent: { args?: readonly unknown[] }[] = []
  const answer = (functionName: string, args?: readonly unknown[]) => {
    reads.push(functionName)
    const who = (args?.[0] ?? '') as string
    switch (functionName) {
      case 'fetchPrice':
        return PRICE
      case 'getTCR':
        return 2n * E18
      case 'balanceOf':
        return 10n ** 30n
      case 'interestRate':
        return Number(RATE)
      case 'redemptionRate':
        return 7_500_000_000_000_000n
      case 'getLast':
        return troves[0]
      case 'getPrev': {
        const i = troves.indexOf(who as `0x${string}`)
        return troves[i + 1] ?? ZERO
      }
      case 'getCurrentICR':
        return 2n * E18
      case 'getEntireDebtAndColl':
        // 30,230 MUSD of entire debt is 30,030 of net debt once the 200 MUSD reserve is taken off.
        return [1n * BTC, 30_230n * MUSD, 0n, 0n, 0n, 0n]
      case 'getTroveInterestRate':
        return Number(RATE)
      case 'getRedemptionHints':
        return [troves[0], HELPER_NICR, 0n]
      case 'getSize':
        return BigInt(size)
      case 'getApproxHint':
        return [ZERO, 0n, 0n]
      case 'findInsertPosition':
        return [ZERO, ZERO]
      default:
        throw new Error(`unstubbed read: ${functionName}`)
    }
  }
  const publicClient = {
    readContract: async ({ functionName, args }: { functionName: string; args?: unknown[] }) =>
      answer(functionName, args),
    simulateContract: async (request: { args?: readonly unknown[] }) => {
      sent.push(request)
      throw new Error('reached simulate')
    },
    estimateContractGas: async () => 1n,
  } as unknown as PublicClient
  const deps = {
    publicClient,
    addresses: getAddresses(31611),
    getMinNetDebt: async () => M,
    isAccountFeeExempt: async () => false,
  }
  const writeDeps: WriteDeps = {
    ...deps,
    walletClient: {
      account: { address: '0x000000000000000000000000000000000000dEaD', type: 'json-rpc' },
      writeContract: async () => '0xhash',
    } as unknown as WalletClient,
    ensureVerified: async () => {},
    gasMarginPercent: 0,
  }
  const visited = () => reads.filter((r) => r === 'getCurrentICR').length
  return { troves, deps, writeDeps, visited, reads, sent }
}

describe('MK-114, maxIterations 0n is no limit, as the contract reads it', () => {
  // More than one Trove's net debt and well inside two, so the answer depends on reaching the second.
  const amount = 40_000n * MUSD

  it('zero walks as far as the request needs, which is what the chain redeems', async () => {
    const { troves, deps, visited } = listOf(3)
    const p = await previewRedeem(deps, {
      redeemer: troves[2] as `0x${string}`,
      amount,
      maxIterations: 0n,
    })
    expect(p.viable, JSON.stringify(p.reasons)).toBe(true)
    expect(p.redeemable, 'the request is covered by the first two Troves').toBe(amount)
    expect(visited(), 'and the walk stops once they cover it').toBe(2)
  })

  it('the fixture tells the two apart: 2n reaches the second Trove', async () => {
    const { troves, deps } = listOf(3)
    const p = await previewRedeem(deps, {
      redeemer: troves[2] as `0x${string}`,
      amount,
      maxIterations: 2n,
    })
    expect(p.redeemable).toBe(amount)
    expect(NET_DEBT < amount && amount < 2n * NET_DEBT, 'fixture: the request spans two').toBe(true)
  })

  it('one is still a bound of ONE eligible Trove, so zero is not simply read as a large number', async () => {
    // This is the mutant that surfaced MK-114: `i < maxIterations` widened to `i <= maxIterations`
    // walks one Trove further than the contract's `_maxIterations--` loop (`TroveManager.sol:360-365`).
    const { troves, deps, visited } = listOf(3)
    const p = await previewRedeem(deps, {
      redeemer: troves[2] as `0x${string}`,
      amount,
      maxIterations: 1n,
    })
    expect(p.redeemable, 'one Trove consumed whole, and the call stops there').toBe(NET_DEBT)
    expect(visited()).toBe(1)
  })

  it('zero with a request larger than the whole list walks to its end and stops', async () => {
    const { troves, deps, visited } = listOf(4)
    const p = await previewRedeem(deps, {
      redeemer: troves[3] as `0x${string}`,
      amount: 1_000_000n * MUSD,
      maxIterations: 0n,
    })
    expect(p.redeemable, 'every Trove, consumed whole').toBe(4n * NET_DEBT)
    expect(visited(), 'one read per Trove in the list, and the walk terminates').toBe(4)
  })

  it('the preview and redeem() default to one shared bound', async () => {
    const { troves, deps, visited } = listOf(120)
    const p = await previewRedeem(deps, {
      redeemer: troves[0] as `0x${string}`,
      amount: 10_000_000n * MUSD,
    })
    expect(DEFAULT_REDEMPTION_MAX_ITERATIONS).toBe(100n)
    expect(visited(), 'the omitted bound is the exported default').toBe(100)
    expect(p.redeemable).toBe(100n * NET_DEBT)
  })

  it('redeem() at zero prechecks the partial on the SECOND Trove and sends its centred hint', async () => {
    // Before the fix the precheck walk saw one Trove, found no partial, and the call fell back to the
    // helper's lower edge hint (MK-103) for a partial the chain then made on the second Trove.
    const { troves, deps, writeDeps, sent } = listOf(3)
    const expected = await previewRedeem(deps, {
      redeemer: '0x000000000000000000000000000000000000dEaD',
      amount,
      maxIterations: 0n,
      marginSeconds: REDEMPTION_SEND_MARGIN_SECONDS,
    })
    expect(expected.partial?.trove, 'fixture: the partial lands on the second Trove').toBe(
      troves[1],
    )
    const error = await redeem(writeDeps, { amount, maxIterations: 0n }).catch((e: unknown) => e)
    expect((error as Error).message).toContain('reached simulate')
    const args = sent[0]?.args ?? []
    expect(args[4], 'the centred hint of the partial the preview found').toBe(
      expected.partial?.hintNicr,
    )
    expect(args[4]).not.toBe(HELPER_NICR)
    expect(args[5], 'and zero reaches the contract unchanged').toBe(0n)
  })

  it('refuses a value no uint256 can hold, in the preview and in the write, before any read', async () => {
    for (const bad of [-1n, 1n << 256n]) {
      const preview = listOf(3)
      const p = await previewRedeem(preview.deps, {
        redeemer: preview.troves[2] as `0x${string}`,
        amount,
        maxIterations: bad,
      }).catch((e: unknown) => e)
      expect(p, `previewRedeem ${bad}`).toBeInstanceOf(InvalidAmount)
      expect(preview.reads, 'nothing is read for a value that cannot be sent').toEqual([])

      const write = listOf(3)
      const w = await redeem(write.writeDeps, { amount, maxIterations: bad }).catch(
        (e: unknown) => e,
      )
      expect(w, `redeem ${bad}`).toBeInstanceOf(InvalidAmount)
      expect(write.reads, 'redeem() refuses it before its own reads').toEqual([])
    }
    const max = listOf(3)
    const atMax = await previewRedeem(max.deps, {
      redeemer: max.troves[2] as `0x${string}`,
      amount,
      maxIterations: (1n << 256n) - 1n,
    })
    expect(atMax.redeemable, 'the largest uint256 is accepted, and is as good as no limit').toBe(
      amount,
    )
  })
})
