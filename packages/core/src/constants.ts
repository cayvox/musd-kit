// Fixed MUSD constants — bundled because no on-chain setter exists for them
// (`docs/01-ground-truth.md` §2). Everything governable/dynamic (minNetDebt, the
// borrowing/redemption/interest rates, the oracle price) is read on-chain, never
// bundled (Law 3) — see `client/createMusdClient.ts`.

/** 100%, 1e18-scaled. */
export const ONE_HUNDRED_PCT = 1_000_000_000_000_000_000n
/** Minimum Collateral Ratio — individual liquidation trigger (ICR < MCR). 110%. */
export const MCR = 1_100_000_000_000_000_000n
/** Critical Collateral Ratio — Recovery Mode threshold (TCR < CCR). 150%. */
export const CCR = 1_500_000_000_000_000_000n
/** Gas compensation reserve added at open, returned on close. 200 MUSD. */
export const MUSD_GAS_COMPENSATION = 200_000_000_000_000_000_000n
/** Liquidator collateral reward divisor: coll / 200 = 0.5%. */
export const PERCENT_DIVISOR = 200n
/** Fixed-point precision (1e18) for MUSD, BTC, and the oracle price. */
export const DECIMAL_PRECISION = 1_000_000_000_000_000_000n
/** Hard floor governance cannot set `minNetDebt` below. 50 MUSD. */
export const MIN_NET_DEBT_MIN = 50_000_000_000_000_000_000n

/**
 * Seconds per year used by the interest model = 365.2425 days × 86400 (the Gregorian
 * year). Verified on the fork (Phase 4) — NOT 365 (31_536_000) nor 365.25 (31_557_600).
 * Fixed in the contract (no setter), so it is bundled. See `docs/01-ground-truth.md` §7.
 */
export const SECONDS_PER_YEAR = 31_556_952n

/** Basis-point denominator (10_000 bps = 100%). */
export const BPS_DIVISOR = 10_000n

/**
 * Canonical Multicall3, verified deployed on Mezo (14 Jun 2026, Phase 2) at the
 * standard cross-chain address. Used to batch live reads into a single same-block
 * snapshot. Note: `@mezo-org/chains` does NOT declare `contracts.multicall3`, so we
 * pass this address to viem `multicall` explicitly. See `docs/01-ground-truth.md` §4.
 */
export const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11' as const

/** The bundled fixed constants as one immutable record. */
export const FIXED_CONSTANTS = {
  ONE_HUNDRED_PCT,
  MCR,
  CCR,
  MUSD_GAS_COMPENSATION,
  PERCENT_DIVISOR,
  DECIMAL_PRECISION,
  MIN_NET_DEBT_MIN,
} as const

export type FixedConstants = typeof FIXED_CONSTANTS
