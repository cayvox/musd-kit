import type { PublicClient } from 'viem'
import { describe, expect, it } from 'vitest'
import { getAddresses, previewRedeem } from '../src'

/**
 * MK-114. `maxIterations: 0n` means NO LIMIT to the contract.
 *
 * `HintHelpers.getRedemptionHints` and `TroveManager.redeemCollateral` both replace a zero
 * `_maxIterations` with `type(uint256).max` (`HintHelpers.sol:107-109`, `TroveManager.sol:353-355`),
 * and the deployed helper answers that way at the pinned block: a 400,000 MUSD request is truncated
 * to 298,067 MUSD at 100 iterations and returned whole at 0 (the calls are in the register entry).
 * The preview is the SDK's restatement of that walk, so it has to read zero the same way.
 */

const E18 = 10n ** 18n
const MUSD = E18
const BTC = E18
const M = 1_800n * MUSD
const PRICE = 76_750n * MUSD
const RATE = 100n
const ZERO = '0x0000000000000000000000000000000000000000'

/** Every Trove in the list is eligible and carries 30,030 MUSD of net debt. */
const NET_DEBT = 30_030n * MUSD

function listOf(size: number) {
  const troves = Array.from(
    { length: size },
    (_, i) => `0x${(0xb1 + i).toString(16).padStart(40, '0')}` as `0x${string}`,
  )
  const reads: string[] = []
  const publicClient = {
    readContract: async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
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
        default:
          throw new Error(`unstubbed read: ${functionName}`)
      }
    },
  } as unknown as PublicClient
  const deps = {
    publicClient,
    addresses: getAddresses(31611),
    getMinNetDebt: async () => M,
    isAccountFeeExempt: async () => false,
  }
  const visited = () => reads.filter((r) => r === 'getCurrentICR').length
  return { troves, deps, visited }
}

describe('MK-114, maxIterations 0n is no limit, as the contract reads it', () => {
  // More than one Trove's net debt and well inside two, so the answer depends on reaching the second.
  const amount = 40_000n * MUSD

  it.fails('zero walks as far as the request needs, which is what the chain redeems', async () => {
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
})
