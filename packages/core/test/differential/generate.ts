import { CCR, MCR, MUSD_GAS_COMPENSATION } from '../../src'

/**
 * Seeded case generation for the differential harness (MK-016's successor obligation).
 *
 * **Why weighted rather than uniform.** A uniform sweep over collateral and debt spends almost
 * all of its budget in the middle of the space, where every verdict is obvious and nothing has
 * ever been wrong. Every S1 in this programme lived at a boundary: MK-004's sub-floor band
 * where the fee lifted a draw over `minNetDebt`, MK-005's vacuous flag that was true for every
 * normal mode open, MK-006's hint basis that only differs once interest exists. So the bands
 * below are weighted deliberately and the weights are stated rather than tuned quietly.
 */
export const BAND_WEIGHTS = {
  /** At a threshold, and one wei either side of it. Where the verdicts actually disagree. */
  boundary: 60,
  /** Dust and absurd values, which is where arithmetic overflows or truncates. */
  extreme: 20,
  /** Ordinary positions, which is what a user actually has. */
  middle: 20,
} as const

export type Band = keyof typeof BAND_WEIGHTS

/** The operations the harness exercises. Read off the SDK's preview surface, not invented. */
export type CaseOp =
  | 'open'
  | 'borrow'
  | 'refinance'
  | 'addCollateral'
  | 'repay'
  | 'withdrawCollateral'
  | 'adjust'
  | 'close'

/**
 * The ACCOUNT STATE a case runs against (MK-047, and the larger finding behind it).
 *
 * Until this existed the generator could not express one, and that is why a thousand cases
 * missed a preview verdict that disagreed with the contract. `openCase` used a fresh account
 * for every case, so `previewOpen` was never asked about an owner who already held a Trove;
 * every other case seeded a position first, so no preview was ever asked about an owner who
 * held none. **Both status gates were unreachable, in opposite directions.**
 *
 * A sweep proves what its generator can express. The count of cases says nothing about that.
 */
export type Precondition =
  /** No Trove. The only state `open` could reach before, and the only one the others could not. */
  | 'FRESH'
  /** A Trove is open. What `open` must be refused against, and what the others need. */
  | 'OCCUPIED'

/** One generated case. Every field is part of its reproduction. */
export interface DiffCase {
  index: number
  seed: number
  band: Band
  op: CaseOp
  /** BTC wei. */
  collateral: bigint
  /** MUSD wei, the requested draw. Unused by `refinance`. */
  debt: bigint
  /** Multiplier on the fork's live price, as a percentage of 100. */
  pricePercent: number
  /** EVM seconds to warp before the operation, so interest owed spans zero to large. */
  elapsedSeconds: number
  /**
   * The account state to construct before the operation runs (MK-047).
   *
   * Weighted rather than uniform: the state that matches the operation is the ordinary case
   * and the mismatched one is the boundary, so most cases keep the shape the sweep already
   * had and a minority probe the gate that had never been reached.
   */
  precondition: Precondition
}

/**
 * Deterministic PRNG (mulberry32). Chosen because it is four lines, has no dependency, and is
 * exactly reproducible from a 32 bit seed, which is the whole requirement: a failure this
 * harness reports must be replayable from the seed printed beside it.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const BTC = 10n ** 18n
const MUSD = 10n ** 18n

/** Pick a band by weight. */
function pickBand(rnd: () => number): Band {
  const total = BAND_WEIGHTS.boundary + BAND_WEIGHTS.extreme + BAND_WEIGHTS.middle
  const roll = rnd() * total
  if (roll < BAND_WEIGHTS.boundary) return 'boundary'
  if (roll < BAND_WEIGHTS.boundary + BAND_WEIGHTS.extreme) return 'extreme'
  return 'middle'
}

/** One wei either side of a value, or the value itself, chosen at random. */
function jitterOneWei(value: bigint, rnd: () => number): bigint {
  const roll = Math.floor(rnd() * 3)
  if (roll === 0) return value > 0n ? value - 1n : value
  if (roll === 1) return value
  return value + 1n
}

/**
 * The draw that puts a position exactly at `targetRatio`, for the given collateral and price.
 *
 * `entireDebt = draw + fee + 200`, and `ICR = collateral * price / entireDebt`, so the debt at
 * the threshold is `collateral * price / targetRatio` and the draw is that minus the gas
 * reserve, minus the fee. The fee is left out here on purpose: including it needs the live
 * rate, and the point of this value is to land NEAR the threshold so the one wei jitter
 * straddles it, not to be exact to the wei. Cases that land on the wrong side are still valid
 * cases; the harness asserts the verdict matches the outcome either way.
 */
function drawAtRatio(collateral: bigint, price: bigint, targetRatio: bigint): bigint {
  const debtAtThreshold = (collateral * price) / targetRatio
  return debtAtThreshold > MUSD_GAS_COMPENSATION ? debtAtThreshold - MUSD_GAS_COMPENSATION : 0n
}

/**
 * Generate `count` cases from `seed`.
 *
 * `minNetDebt` and `price` are passed in rather than read here so generation stays pure and a
 * seed reproduces the same tuples for the same chain conditions.
 */
export function generateCases(
  seed: number,
  count: number,
  chain: { minNetDebt: bigint; price: bigint },
): DiffCase[] {
  const rnd = mulberry32(seed)
  const cases: DiffCase[] = []
  // MK-042. Every preview the SDK exposes is in the sweep. A preview that is not swept is
  // not validated, whatever the documentation says, and five of these eight did not exist
  // when this generator was written.
  const ops: CaseOp[] = [
    'open',
    'borrow',
    'refinance',
    'addCollateral',
    'repay',
    'withdrawCollateral',
    'adjust',
    'close',
  ]

  for (let index = 0; index < count; index++) {
    const band = pickBand(rnd)
    const op = ops[Math.floor(rnd() * ops.length)] as CaseOp

    // Collateral first: every debt boundary is relative to it.
    let collateral: bigint
    if (band === 'extreme') {
      collateral =
        rnd() < 0.5
          ? BigInt(1 + Math.floor(rnd() * 1000))
          : BTC * BigInt(1 + Math.floor(rnd() * 5000))
    } else if (band === 'boundary') {
      // Sizes where the debt floor and the ratio thresholds are close together, which is the
      // band MK-004 lived in.
      collateral = (BTC * BigInt(2 + Math.floor(rnd() * 60))) / 100n
    } else {
      collateral = (BTC * BigInt(5 + Math.floor(rnd() * 500))) / 100n
    }

    const pricePercent =
      band === 'boundary'
        ? ([100, 100, 100, 66, 150][Math.floor(rnd() * 5)] ?? 100)
        : band === 'extreme'
          ? ([25, 50, 200, 400][Math.floor(rnd() * 4)] ?? 100)
          : 80 + Math.floor(rnd() * 60)
    const price = (chain.price * BigInt(pricePercent)) / 100n

    let debt: bigint
    if (band === 'boundary') {
      // The four boundaries that matter, each jittered by one wei so both sides are covered:
      // the debt floor, the MCR threshold, the CCR threshold, and zero.
      const which = Math.floor(rnd() * 4)
      const candidate =
        which === 0
          ? chain.minNetDebt
          : which === 1
            ? drawAtRatio(collateral, price, MCR)
            : which === 2
              ? drawAtRatio(collateral, price, CCR)
              : 0n
      debt = jitterOneWei(candidate, rnd)
    } else if (band === 'extreme') {
      debt =
        rnd() < 0.5
          ? BigInt(Math.floor(rnd() * 1000))
          : MUSD * BigInt(10 ** 6 + Math.floor(rnd() * 10 ** 6))
    } else {
      debt = MUSD * BigInt(1800 + Math.floor(rnd() * 40_000))
    }
    if (debt < 0n) debt = 0n

    // Elapsed time spans zero against large, so interest owed spans zero against large. A year
    // is chosen as the upper end because the suite's own phase 6 warps that far, so it is a
    // range the fixtures are known to survive.
    const elapsedSeconds =
      band === 'boundary'
        ? ([0, 0, 1, 86_400][Math.floor(rnd() * 4)] ?? 0)
        : band === 'extreme'
          ? ([0, 31_536_000, 3 * 31_536_000][Math.floor(rnd() * 3)] ?? 0)
          : Math.floor(rnd() * 2_592_000)

    // MK-047. One case in five runs against the OPPOSITE account state to the one the
    // operation expects, which is the only way a status gate is ever exercised. One in five
    // rather than one in two: the mismatched state short circuits every later gate, so a
    // higher rate would spend the sweep proving one reason over and over and stop probing
    // the ratio and capacity boundaries the bands were weighted for.
    const mismatched = rnd() < 0.2
    const precondition: Precondition =
      op === 'open' ? (mismatched ? 'OCCUPIED' : 'FRESH') : mismatched ? 'FRESH' : 'OCCUPIED'
    cases.push({
      index,
      seed,
      band,
      op,
      collateral,
      debt,
      pricePercent,
      elapsedSeconds,
      precondition,
    })
  }
  return cases
}

/** One line that fully identifies a case, so a failure can be replayed from the log. */
export function describeCase(c: DiffCase): string {
  return [
    `seed=${c.seed}`,
    `case=${c.index}`,
    `band=${c.band}`,
    `op=${c.op}`,
    `collateral=${c.collateral}`,
    `debt=${c.debt}`,
    `pricePercent=${c.pricePercent}`,
    `elapsedSeconds=${c.elapsedSeconds}`,
    `precondition=${c.precondition}`,
  ].join(' ')
}
