import type { PublicClient } from 'viem'
import { describe, expect, it } from 'vitest'
import { getAddresses, previewAdjustTrove, previewOpen } from '../src'
import type { MathDeps } from '../src/math/deps'

/**
 * What the previews ask the chain, and what they conclude from nothing asked. A read that is made
 * for nobody, or skipped for somebody, changes either a caller's round trips or the answer.
 * Each block cites its finding.
 */

const E18 = 10n ** 18n
const MUSD = E18
const BTC = E18
const OWNER = '0x000000000000000000000000000000000000dEaD' as const

function deps(opts: { isRecoveryMode?: boolean } = {}) {
  const calls: string[] = []
  const publicClient = {
    readContract: async ({
      functionName,
      args,
    }: { functionName: string; args?: readonly unknown[] }) => {
      calls.push(functionName)
      switch (functionName) {
        case 'fetchPrice':
          return 80_000n * MUSD
        case 'checkRecoveryMode':
          return opts.isRecoveryMode ?? false
        case 'getEntireSystemColl':
          return 1_000_000n * BTC
        case 'getEntireSystemDebt':
          return 20_000_000n * MUSD
        case 'getTroveStatus':
          return 1
        case 'getEntireDebtAndColl':
          return [10n * BTC, 20_000n * MUSD, 0n, 0n, 0n, 0n]
        case 'getTroveMaxBorrowingCapacity':
          return 10n ** 30n
        case 'balanceOf':
          return 10n ** 30n
        case 'getBorrowingFee':
          return (10n ** 15n * (args?.[0] as bigint)) / E18
        default:
          throw new Error(`unstubbed read: ${functionName}`)
      }
    },
  } as unknown as PublicClient
  const d: MathDeps = {
    publicClient,
    addresses: getAddresses(31611),
    getMinNetDebt: async () => 1_800n * MUSD,
    isAccountFeeExempt: async () => {
      calls.push('isAccountFeeExempt')
      return false
    },
  }
  return { deps: d, calls }
}

describe('MK-118, previewAdjustTrove', () => {
  it('with no leg at all reports that nothing was requested', async () => {
    const { deps: d } = deps()
    const p = await previewAdjustTrove(d, { owner: OWNER })
    expect(p.reasons).toContain('NO_CHANGE_REQUESTED')
  })

  it('asks about fee exemption only when there is a debt increase to charge', async () => {
    const add = deps()
    await previewAdjustTrove(add.deps, { owner: OWNER, addCollateral: BTC })
    expect(add.calls).not.toContain('isAccountFeeExempt')
    expect(add.calls).not.toContain('getBorrowingFee')
    const draw = deps()
    await previewAdjustTrove(draw.deps, { owner: OWNER, increaseDebt: 1_000n * MUSD })
    expect(draw.calls).toContain('isAccountFeeExempt')
  })
})

describe('MK-112, previewOpen, what it reads for an account and a mode', () => {
  it('reads the Trove status and the exemption for an account, and neither without one', async () => {
    const withAccount = deps()
    const p = await previewOpen(withAccount.deps, {
      collateral: BTC,
      debt: 2_000n * MUSD,
      account: OWNER,
    })
    expect(withAccount.calls).toContain('getTroveStatus')
    expect(withAccount.calls).toContain('isAccountFeeExempt')
    expect(p.reasons, 'the status read is what refuses an owner with a Trove').toContain(
      'TROVE_ALREADY_ACTIVE',
    )
    const without = deps()
    await previewOpen(without.deps, { collateral: BTC, debt: 2_000n * MUSD })
    expect(without.calls).not.toContain('getTroveStatus')
    expect(without.calls).not.toContain('isAccountFeeExempt')
  })

  it('quotes no fee in Recovery Mode, where none is charged, and quotes one in normal mode', async () => {
    const rm = deps({ isRecoveryMode: true })
    const inRm = await previewOpen(rm.deps, { collateral: BTC, debt: 2_000n * MUSD })
    expect(rm.calls).not.toContain('getBorrowingFee')
    expect(inRm.fee).toBe(0n)
    const normal = deps()
    const inNormal = await previewOpen(normal.deps, { collateral: BTC, debt: 2_000n * MUSD })
    expect(normal.calls).toContain('getBorrowingFee')
    expect(inNormal.fee).toBe(2n * MUSD)
  })
})
