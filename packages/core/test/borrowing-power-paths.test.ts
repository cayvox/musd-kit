import type { PublicClient } from 'viem'
import { describe, expect, it } from 'vitest'
import { evaluateOpen, getAddresses, getBorrowingPower } from '../src'
import type { MathDeps } from '../src/math/deps'

/**
 * `getBorrowingPower`'s branches that decide which figure it trusts and what it asks the chain.
 *
 * The closed form is used only when one `getBorrowingFee` read confirms the fee is linear; otherwise
 * the bounded binary search runs, one read a step (MK-010, MK-092). `borrowing-power-agreement.test.ts`
 * pins the answers on the linear path. These pin the other path, and the reads on both, because a
 * branch that changes only what is asked of the chain is still a decision a caller pays for.
 *
 * The expected figures are found here by searching `evaluateOpen` directly with the stub's own fee, not
 * by calling anything in `getBorrowingPower`.
 */

const E18 = 10n ** 18n
const MCR = 11n * 10n ** 17n
const GAS = 200n * E18
const RATE = 10n ** 15n
const MIN_NET_DEBT = 1_800n * E18
const ROOMY = { systemColl: 10_000n * E18, systemDebt: 100_000_000n * E18 }

type Fee = (draw: bigint) => bigint
const linear: Fee = (d) => (RATE * d) / E18
/** Twice the linear fee: the confirmation read disagrees with the local figure, so the search runs. */
const doubled: Fee = (d) => (2n * RATE * d) / E18

function deps(price: bigint, fee: Fee) {
  const feeReads: bigint[] = []
  const answers: Record<string, unknown> = {
    borrowingRate: RATE,
    DECIMAL_PRECISION: E18,
    getEntireSystemColl: ROOMY.systemColl,
    getEntireSystemDebt: ROOMY.systemDebt,
    fetchPrice: price,
    checkRecoveryMode: false,
    interestRate: 100n,
  }
  const publicClient = {
    readContract: async ({
      functionName,
      args,
    }: { functionName: string; args?: readonly unknown[] }) => {
      if (functionName === 'getBorrowingFee') {
        feeReads.push(args?.[0] as bigint)
        return fee(args?.[0] as bigint)
      }
      if (!(functionName in answers)) throw new Error(`unstubbed read: ${functionName}`)
      return answers[functionName]
    },
    multicall: async ({ contracts }: { contracts: { functionName: string }[] }) =>
      contracts.map((c) => answers[c.functionName]),
  } as unknown as PublicClient
  const d: MathDeps = {
    publicClient,
    addresses: getAddresses(31611),
    getMinNetDebt: async () => MIN_NET_DEBT,
    isAccountFeeExempt: async () => false,
  }
  return { deps: d, feeReads }
}

/** The largest draw `evaluateOpen` accepts at `price` with fee `fee`, by bisection over the ICR cap. */
function largestOpen(collateral: bigint, price: bigint, fee: Fee, minNetDebt: bigint): bigint {
  const viable = (d: bigint) =>
    evaluateOpen({
      collateral,
      debt: d,
      fee: fee(d),
      feeExempt: false,
      minNetDebt,
      isRecoveryMode: false,
      price,
      ...ROOMY,
      troveStatus: undefined,
    }).viable
  let lo = 0n
  let hi = (collateral * price) / MCR
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n
    if (viable(mid)) lo = mid
    else hi = mid - 1n
  }
  return viable(lo) ? lo : 0n
}

const bitLength = (x: bigint) => x.toString(2).length

describe('MK-141, MK-145, MK-151, a fee the chain does not charge linearly', () => {
  const price = 100_000n * E18
  const collateral = E18

  it('the ceiling is the searched maximum under the chain fee, not the closed form', async () => {
    const { deps: d } = deps(price, doubled)
    const p = await getBorrowingPower(d, { collateral })
    const expected = largestOpen(collateral, price, doubled, MIN_NET_DEBT)
    const closedForm = largestOpen(collateral, price, linear, MIN_NET_DEBT)
    expect(closedForm, 'fixture: the two fees give different answers').not.toBe(expected)
    expect(p.ceiling).toBe(expected)
  })

  it('and so is the recommended figure, at the stressed price', async () => {
    const { deps: d } = deps(price, doubled)
    const p = await getBorrowingPower(d, { collateral })
    const expected = largestOpen(collateral, p.margin.stressedPrice, doubled, 0n)
    expect(p.recommended).toBe(expected < p.ceiling ? expected : p.ceiling)
  })

  it('each search stops when it has converged, so the reads are bounded by the range and not by the cap', async () => {
    const { deps: d, feeReads } = deps(price, doubled)
    await getBorrowingPower(d, { collateral })
    // Two searches, each at most one step per bit of its range plus one, and three single reads: the
    // confirmation, and the fee of each answer. A search that kept stepping after converging would run
    // to the 256 step backstop.
    const range = (collateral * price) / MCR - GAS
    expect(feeReads.length).toBeLessThanOrEqual(2 * (bitLength(range) + 1) + 3)
  })
})

describe('MK-139, MK-152, the search backstop', () => {
  it('stops each search at exactly 256 steps when its range needs more', async () => {
    // A range wider than 2^256 cannot converge in 256 halvings. The collateral is a uint256 the caller
    // passes; the fee is the non linear one, so both figures are searched rather than solved.
    const collateral = 10n ** 73n
    const price = 80_000n * E18
    expect((collateral * price) / MCR - GAS > 1n << 256n, 'fixture: wider than 2^256').toBe(true)
    const { deps: d, feeReads } = deps(price, doubled)
    await getBorrowingPower(d, { collateral })
    // One confirmation read, two searches of 256 steps each, and the fee of each answer.
    expect(feeReads.length).toBe(1 + 256 + 1 + 256 + 1)
  })
})

describe('MK-140, MK-142, MK-143, MK-144, no fee is asked for a figure that cannot exceed the reserve', () => {
  const price = 100_000n * E18

  it('a collateral whose ICR cap is exactly the gas reserve reads no fee', async () => {
    // 0.0022 BTC x 100,000 / 1.1 = 200 MUSD exactly, which leaves nothing to draw.
    const { deps: d, feeReads } = deps(price, linear)
    const p = await getBorrowingPower(d, { collateral: 22n * 10n ** 14n })
    expect([p.ceiling, p.recommended]).toEqual([0n, 0n])
    expect(feeReads, 'nothing to quote a fee for').toEqual([])
  })

  it('a ceiling under the floor asks nothing more for the recommended figure', async () => {
    // 0.011 BTC caps the debt at 1,000 MUSD, under the 1,800 floor, so the ceiling is zero. On the search
    // path the recommended figure could cost a second search; with a zero ceiling it must not run.
    const small = 11n * 10n ** 15n
    const { deps: d, feeReads } = deps(price, doubled)
    const p = await getBorrowingPower(d, { collateral: small })
    expect(p.ceiling).toBe(0n)
    // The same call with a stressed price whose cap cannot clear the reserve at all: the recommended
    // leg is skipped there for that reason, so any difference in reads is the recommended search.
    const { deps: d2, feeReads: reads2 } = deps(price, doubled)
    await getBorrowingPower(d2, {
      collateral: small,
      priceMoveBps: 9_999n,
      marginWindowSeconds: 0n,
    })
    expect(feeReads.length).toBe(reads2.length)
  })

  it('a stressed cap of exactly the reserve reads no fee for the recommended figure', async () => {
    // 0.1 BTC at 100,000 with a 97.8% move and no window stresses the price to exactly 2,200, and
    // 0.1 x 2,200 / 1.1 = 200 MUSD, the reserve. One basis point more moves it below. Neither may cost
    // a read beyond the ceiling's.
    const collateral = 10n ** 17n
    const at = deps(price, doubled)
    const p = await getBorrowingPower(at.deps, {
      collateral,
      priceMoveBps: 9_780n,
      marginWindowSeconds: 0n,
    })
    expect(p.margin.stressedPrice, 'fixture: exactly 2,200').toBe(2_200n * E18)
    expect((collateral * p.margin.stressedPrice) / MCR, 'fixture: exactly the reserve').toBe(GAS)
    expect(p.ceiling, 'fixture: the ceiling itself is positive').toBeGreaterThan(0n)
    const below = deps(price, doubled)
    await getBorrowingPower(below.deps, {
      collateral,
      priceMoveBps: 9_781n,
      marginWindowSeconds: 0n,
    })
    expect(at.feeReads.length).toBe(below.feeReads.length)
  })
})
