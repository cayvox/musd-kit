import { type Address, zeroAddress } from 'viem'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  computeNICR,
  createMusdClient,
  getAddresses,
  hintHelpersAbi,
  sortedTrovesAbi,
  trialsForSize,
  troveManagerAbi,
} from '../src'
import { connectFork } from './harness'
import { openTroveRaw, testAccount } from './harness/openTroveRaw'

const T = getAddresses(31611)
const GAS = 200n * 10n ** 18n

function client() {
  return createMusdClient({ chainId: 31611, publicClient: connectFork().publicClient })
}

/** Deterministic PRNG so the randomized opens are identical across runs/CI. */
function mulberry32(seed: number) {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const nominalCR = (coll: bigint, debt: bigint) =>
  connectFork().publicClient.readContract({
    address: T.hintHelpers,
    abi: hintHelpersAbi,
    functionName: 'computeNominalCR',
    args: [coll, debt],
  })

const getNICR = (addr: Address) =>
  connectFork().publicClient.readContract({
    address: T.troveManager,
    abi: troveManagerAbi,
    functionName: 'getNominalICR',
    args: [addr],
  })

const getPrev = (addr: Address) =>
  connectFork().publicClient.readContract({
    address: T.sortedTroves,
    abi: sortedTrovesAbi,
    functionName: 'getPrev',
    args: [addr],
  })
const getNext = (addr: Address) =>
  connectFork().publicClient.readContract({
    address: T.sortedTroves,
    abi: sortedTrovesAbi,
    functionName: 'getNext',
    args: [addr],
  })

describe('Phase 3 — hints/ insertion-hint module', () => {
  // Warm the fork's lazy state once: getApproxHint(seed 42, default trials) samples a
  // fixed node set (chosen by the seed, not the NICR), so this single call caches them
  // and every later default computeHints reuses anvil's cache instead of re-fetching.
  beforeAll(async () => {
    await client().computeHints({ collateral: 10n ** 17n, entireDebt: 2202n * 10n ** 18n })
  }, 180_000)

  beforeEach(() => connectFork().refreshOracle())

  it('computeNICR == HintHelpers.computeNominalCR exactly (grid)', async () => {
    const grid: [bigint, bigint][] = [
      [10n ** 17n, 2202n * 10n ** 18n],
      [5n * 10n ** 16n, 2782n * 10n ** 18n],
      [3n * 10n ** 18n, 50_000n * 10n ** 18n],
      [10n ** 18n, 2000n * 10n ** 18n],
      [25n * 10n ** 15n, 1800n * 10n ** 18n], // small coll
      [50n * 10n ** 18n, 2002n * 10n ** 18n], // huge ratio
      [10n ** 16n, 100_000n * 10n ** 18n], // tiny ratio
    ]
    for (const [coll, debt] of grid) {
      expect(computeNICR({ collateral: coll, entireDebt: debt }), `${coll}/${debt}`).toBe(
        await nominalCR(coll, debt),
      )
    }
    expect(() => computeNICR({ collateral: 1n, entireDebt: 0n })).toThrow(RangeError)
  })

  it('trialsForSize follows ceil(15·√size) clamped to [15, 2500]', () => {
    expect(trialsForSize(0n)).toBe(15)
    expect(trialsForSize(1n)).toBe(15)
    expect(trialsForSize(100n)).toBe(150) // 15·10
    expect(trialsForSize(217n)).toBe(Math.ceil(15 * Math.sqrt(217))) // 221
    expect(trialsForSize(10n ** 12n)).toBe(2500) // clamp
  })

  it('computeHints (size-scaled default) returns a contract-valid insert position', async () => {
    const c = client()
    const coll = 10n ** 17n
    const entireDebt = 2202n * 10n ** 18n
    const { upperHint, lowerHint, nicr } = await c.computeHints({ collateral: coll, entireDebt })
    expect(nicr).toBe(await nominalCR(coll, entireDebt))
    const valid = await connectFork().publicClient.readContract({
      address: T.sortedTroves,
      abi: sortedTrovesAbi,
      functionName: 'validInsertPosition',
      args: [nicr, upperHint, lowerHint],
    })
    expect(valid).toBe(true)
  })

  it('≥20 randomized opens land in the correct sorted position', async () => {
    const fork = connectFork()
    const c = client()
    const price = await c.getOraclePrice()
    const rnd = mulberry32(0xc0ffee)
    let opened = 0

    for (let i = 0; i < 22; i++) {
      // ICR ≥ 1.6 (> CCR) on every open so they succeed whether or not the shared,
      // clock-warped fork is in Recovery Mode (which gates opens at ICR ≥ CCR). Coll is
      // large enough that the min-debt clamp can't pull ICR near the MCR/CCR boundary.
      // NICR diversity (what the placement test exercises) is unaffected.
      const collBtc = BigInt(Math.floor((0.15 + rnd() * 0.25) * 1e18)) // 0.15–0.40 BTC
      const targetIcr = BigInt(Math.floor((1.6 + rnd() * 2.1) * 1e18)) // 1.6–3.7
      const entireDebtTarget = (collBtc * price) / targetIcr
      const fee = await c.getBorrowingFee(entireDebtTarget)
      let draw = entireDebtTarget - GAS - fee
      if (draw < 1_900n * 10n ** 18n) draw = 1_900n * 10n ** 18n // clear minNetDebt

      const acct = testAccount(100 + i)
      await openTroveRaw(fork, { collateralBtc: collBtc, debtMusd: draw, account: acct })
      opened++

      // Active + correctly placed: neighbors bracket its NICR (descending list).
      const trove = await c.getTrove(acct.address)
      expect(trove.exists, `trove ${i} active`).toBe(true)
      const nicr = await getNICR(acct.address)
      const [prev, next] = await Promise.all([getPrev(acct.address), getNext(acct.address)])
      if (prev !== zeroAddress) {
        expect(await getNICR(prev), `prev≥nicr @${i}`).toBeGreaterThanOrEqual(nicr)
      }
      if (next !== zeroAddress) {
        expect(nicr, `nicr≥next @${i}`).toBeGreaterThanOrEqual(await getNICR(next))
      }
    }
    expect(opened).toBeGreaterThanOrEqual(22)
  }, 240_000)

  it('SDK-computed hints open within 10% gas of near-exact hints', async () => {
    const fork = connectFork()
    const coll = 12n * 10n ** 16n // 0.12 BTC
    const draw = 2_500n * 10n ** 18n

    // SDK hints (size-scaled default).
    const sdk = await openTroveRaw(fork, {
      collateralBtc: coll,
      debtMusd: draw,
      account: testAccount(200),
    })

    // Near-exact hints: full-traversal findInsertPosition from the head for the same NICR.
    const nicr = computeNICR({ collateral: coll, entireDebt: sdk.entireDebt })
    const [upperHint, lowerHint] = await fork.publicClient.readContract({
      address: T.sortedTroves,
      abi: sortedTrovesAbi,
      functionName: 'findInsertPosition',
      args: [nicr, zeroAddress, zeroAddress],
    })
    const exact = await openTroveRaw(fork, {
      collateralBtc: coll,
      debtMusd: draw,
      account: testAccount(201),
      hintsOverride: { upperHint, lowerHint },
    })

    console.log(
      `[phase3] gas: sdk=${sdk.gasUsed} exact=${exact.gasUsed} (Δ=${sdk.gasUsed - exact.gasUsed})`,
    )
    // Tolerance: within 10% — good hints make the insert traversal near-optimal.
    expect(sdk.gasUsed).toBeLessThanOrEqual((exact.gasUsed * 110n) / 100n)
  }, 120_000)

  it('edge: head (very high NICR) and tail (near-MCR) positions both open', async () => {
    const fork = connectFork()
    // Head: lots of collateral, minimal debt → very high NICR → inserts near the head.
    const head = await openTroveRaw(fork, {
      collateralBtc: 5n * 10n ** 17n, // 0.5 BTC
      debtMusd: 1_900n * 10n ** 18n,
      account: testAccount(210),
    })
    expect((await client().getTrove(head.owner)).exists).toBe(true)

    // Tail: near-MCR (low NICR) → inserts near the tail. Derive draw from price (~1.13 ICR).
    const c = client()
    const price = await c.getOraclePrice()
    const coll = 6n * 10n ** 16n // 0.06 BTC
    const entireDebtTarget = (coll * price) / 1_130_000_000_000_000_000n
    const fee = await c.getBorrowingFee(entireDebtTarget)
    const draw = entireDebtTarget - GAS - fee
    const tail = await openTroveRaw(fork, {
      collateralBtc: coll,
      debtMusd: draw,
      account: testAccount(211),
    })
    const tailTrove = await client().getTrove(tail.owner)
    expect(tailTrove.exists).toBe(true)
    expect(tailTrove.icr).toBeGreaterThan(1_100_000_000_000_000_000n)
  }, 120_000)
})
