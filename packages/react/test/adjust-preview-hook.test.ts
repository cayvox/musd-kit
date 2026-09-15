import { type MusdClient, getAddresses, previewAdjustTrove } from '@musd-kit/core'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { type PublicClient, custom } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createConfig } from 'wagmi'
import { mezoTestnet } from '../../core/test/harness/constants'
import { makeWrapper, newQueryClient } from './wagmi'

/**
 * MK-085, RENDERED. The hook is exercised through React, not called as a function.
 *
 * **Why a rendered test and not another core test.** The defect was never in the core: it was
 * in the four arguments the hook handed it. `packages/core/test/preview-adjust-reads.test.ts`
 * already asserts, in as many words, that `increaseDebt: 0n` and an omitted `increaseDebt` are
 * different inputs and produce different verdicts. That test passed throughout, because it
 * tests the core. Nothing rendered the hook, so nothing saw that the hook could only ever
 * construct the first shape. **A pin one layer below the defect is not a pin** (MK-087).
 *
 * **What is real here and what is not.** React, TanStack Query, the wagmi context, the hook,
 * the query key, the core's `previewAdjustTrove` and the `evaluateAdjust` rules are all real.
 * Only two things are replaced: `useMusdClient`, so no deployment verification or constants
 * multicall is needed, and the viem transport under it, so the render needs no chain. This
 * file therefore runs in the `unit` project with no anvil and no RPC URL, exactly as
 * `abort-signal.test.ts` does.
 */

const CHAIN_ID = 31611
const T = getAddresses(CHAIN_ID)
const BTC = 10n ** 18n
const MUSD = 10n ** 18n
const GAS = 200n * MUSD
const PRICE = 100_000n * MUSD
const OWNER = '0x000000000000000000000000000000000000dEaD' as const

/** A healthy Trove: 1 BTC at 100,000 USD against an entire debt of 10,200 MUSD. */
const answers: Record<string, unknown> = {
  fetchPrice: PRICE,
  getTroveStatus: 1,
  // (coll, principal, interest, pendingColl, pendingPrincipal, pendingInterest)
  getEntireDebtAndColl: [BTC, 10_000n * MUSD + GAS, 0n, 0n, 0n, 0n],
  getTroveMaxBorrowingCapacity: 90_000n * MUSD,
  checkRecoveryMode: false,
  balanceOf: 50_000n * MUSD,
  getEntireSystemColl: 1_000n * BTC,
  getEntireSystemDebt: 1_000_000n * MUSD,
  getBorrowingFee: 0n,
}

/** Every call the preview makes, in order, so the assertions can name what was asked. */
const calls: string[] = []

const stubPublicClient = {
  readContract: async ({ functionName }: { functionName: string }) => {
    calls.push(functionName)
    if (!(functionName in answers)) throw new Error(`unstubbed read: ${functionName}`)
    return answers[functionName]
  },
} as unknown as PublicClient

/**
 * The REAL core preview, bound to the stub transport. `previewAdjustTrove` is exported from
 * `@musd-kit/core`, so the hook's arguments travel through the same code a consumer's would.
 */
const stubClient = {
  previewAdjustTrove: (params: Parameters<MusdClient['previewAdjustTrove']>[0]) =>
    previewAdjustTrove(
      {
        publicClient: stubPublicClient,
        addresses: T,
        getMinNetDebt: async () => 1_800n * MUSD,
        isAccountFeeExempt: async () => false,
      },
      params,
    ),
} as unknown as MusdClient

vi.mock('../src/internal/useMusdClient', () => ({
  useMusdClient: () => ({ client: stubClient, error: null }),
}))

// Imported AFTER the mock declaration so the hook picks up the stubbed client builder.
const { useAdjustTrovePreview } = await import('../src/hooks/reads')
const { musdQueryKeys } = await import('../src/internal/keys')

/** A wagmi context that needs no network: the two calls `useMusdQuery` makes are answered. */
function makeOfflineConfig() {
  return createConfig({
    chains: [mezoTestnet],
    transports: {
      [mezoTestnet.id]: custom({
        request: async ({ method }: { method: string }) => {
          if (method === 'eth_chainId') return `0x${CHAIN_ID.toString(16)}`
          if (method === 'eth_blockNumber') return '0x1'
          throw new Error(`offline config: unexpected ${method}`)
        },
      }),
    },
  })
}

function renderPreview(params: Parameters<typeof useAdjustTrovePreview>[0]) {
  const wrapper = makeWrapper(makeOfflineConfig(), newQueryClient())
  return renderHook(() => useAdjustTrovePreview(params), { wrapper })
}

afterEach(() => {
  cleanup()
  calls.length = 0
})

describe('MK-085, useAdjustTrovePreview keeps an omitted leg omitted', () => {
  it('a pure collateral top-up is VIABLE through the hook', async () => {
    const { result } = renderPreview({ owner: OWNER, addCollateral: BTC })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    // Before the fix this was `false` with `ZERO_DEBT_INCREASE`, because the hook defaulted
    // `increaseDebt` to `0n` and `previewAdjustTrove` reads the flag from presence (MK-060).
    expect(result.current.data?.viable, 'addColl is an ordinary operation').toBe(true)
    expect(result.current.data?.reasons).toEqual([])
    expect(result.current.data?.bindingConstraint).toBeNull()
  })

  it('a pure repayment is viable AND its numbers carry the repayment', async () => {
    const { result } = renderPreview({ owner: OWNER, repayDebt: 5_000n * MUSD })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const p = result.current.data

    expect(p?.viable).toBe(true)
    expect(p?.netDebtChange, 'the repayment is the debt change').toBe(5_000n * MUSD)
    // 10,200 entire debt less 5,000 repaid. The defect reported this UNCHANGED at 10,200,
    // which is the silent half: a refusal a caller can see beside a ratio they cannot.
    expect(p?.resultingEntireDebt).toBe(5_200n * MUSD)
    // 1 BTC at 100,000 against 5,200 of debt. The defect reported 9.803921568627450980.
    expect(p?.resultingIcr).toBe((BTC * PRICE) / (5_200n * MUSD))
  })

  it('MK-244: a zero debt leg beside a top up is no debt leg, as the write path sends it', async () => {
    const { result } = renderPreview({ owner: OWNER, addCollateral: BTC, increaseDebt: 0n })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    // `_adjustTrove` takes `_isDebtIncrease` independently of `_mUSDChange`
    // (`BorrowerOperations.sol:757-758`), so a zero leg has two encodings: `(0, true)`, refused at
    // `:785-787`, and `(0, false)`, accepted beside a collateral change (`:1377-1386`). Until 0.5.0 the
    // preview chose the refused one on presence (MK-060); it reads values now, as `adjustTrove` sends.
    expect(result.current.data?.viable).toBe(true)
    expect(result.current.data?.reasons).toEqual([])
  })

  it('the repayment gates run, which they cannot when every call is a debt increase', async () => {
    // Repaying more than the net debt. `_requireValidMUSDRepayment` (`:859`, `:1246-1254`)
    // and `_requireAtLeastMinNetDebt` (`:856`) both live behind `!isDebtIncrease`, so before
    // the fix neither could ever be reached from this hook.
    const { result } = renderPreview({ owner: OWNER, repayDebt: 9_999n * MUSD })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data?.viable).toBe(false)
    expect(result.current.data?.reasons).toContain('BELOW_MINIMUM_DEBT')
  })

  it('the exemption read is skipped when there is no debt increase, so the hook costs one read less', async () => {
    const { result } = renderPreview({ owner: OWNER, addCollateral: BTC })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    // `previewAdjustTrove` guards both on `increaseDebt > 0n`. With the leg defaulted to `0n`
    // this was already true, so this is not what the defect cost; it is here so the read set
    // a top-up makes is pinned rather than assumed.
    expect(calls).not.toContain('getBorrowingFee')
  })
})

describe('MK-085, the query key distinguishes an absent leg from a leg of zero', () => {
  it('absent and zero are different cache entries', () => {
    const absent = musdQueryKeys.adjustPreview(CHAIN_ID, OWNER, { addCollateral: BTC })
    const zero = musdQueryKeys.adjustPreview(CHAIN_ID, OWNER, {
      addCollateral: BTC,
      increaseDebt: 0n,
    })

    // They are different questions with different answers, so they must not share an entry.
    expect(absent).not.toEqual(zero)
    expect(absent).toContain(null)
    expect(zero).toContain('0')
  })

  it('the key is built from the same object the fetch sends', async () => {
    // One object drives both, so a key that says "no debt leg" cannot sit over a call that
    // asked about one. This is the structural half of the fix; the render above is the
    // behavioural half.
    const { result } = renderPreview({ owner: OWNER, repayDebt: 5_000n * MUSD })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(musdQueryKeys.adjustPreview(CHAIN_ID, OWNER, { repayDebt: 5_000n * MUSD })).toEqual([
      'musd',
      CHAIN_ID,
      'adjustPreview',
      OWNER,
      null,
      null,
      null,
      '5000000000000000000000',
    ])
  })
})

/**
 * MK-085, MK-087. The package-wide sweep, as a check rather than as a claim in a document.
 *
 * The rule the wave established: **a hook must never substitute a value for an absent optional
 * before forwarding it.** `exactOptionalPropertyTypes` makes the compiler enforce the shape of
 * a forwarded object, but it cannot see a default applied in the destructuring, which is
 * exactly how MK-085 arrived. This is a habit guard for that one pattern, not a proof, and it
 * is worth having because the pattern reads as tidy and the compiler is silent on it.
 */
describe('MK-085, no read hook fills an absent optional before forwarding it', () => {
  it('no hook destructures a parameter with a value default', async () => {
    const { readFileSync } = await import('node:fs')
    const offenders: string[] = []
    for (const file of ['reads.ts', 'writes.ts']) {
      const src = readFileSync(`packages/react/src/hooks/${file}`, 'utf8')
      for (const [i, line] of src.split('\n').entries()) {
        // A destructuring default: `addCollateral = 0n,` and friends. Comments are excluded so
        // the prose above a fixed hook can still describe the defect it no longer has.
        const code = line.trim()
        if (code.startsWith('*') || code.startsWith('//')) continue
        if (/^\w+\s*=\s*(0n|0|false|true|'0x')\s*,?$/.test(code)) {
          offenders.push(`${file}:${i + 1}  ${code}`)
        }
      }
    }
    expect(offenders, 'an absent optional must stay absent (MK-085)').toEqual([])
  })
})
