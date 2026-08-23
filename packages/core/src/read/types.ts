/**
 * MUSD `TroveManager` Status enum (`getTroveStatus` returns `uint8`).
 * `nonExistent` (0) and `active` (1) verified on the fork (Phase 2); the closed
 * ordinals follow the MUSD source ordering and become reachable in Phases 5/6
 * (close / liquidate / redeem).
 */
export const TroveStatus = {
  nonExistent: 0,
  active: 1,
  closedByOwner: 2,
  closedByLiquidation: 3,
  closedByRedemption: 4,
} as const
/** A `TroveManager` status ordinal (0-4); see {@link TroveStatus}. */
export type TroveStatus = (typeof TroveStatus)[keyof typeof TroveStatus]

/**
 * A live Trove position. Every numeric field except `liquidationPrice` and
 * `healthFactor` comes straight from a contract getter, correct by
 * construction. The two derived fields are thin transforms of those authoritative
 * values (see `docs/05-math-and-hints.md` §4), proven against `computeCR`.
 */
export interface Trove {
  /** True only for an active position with debt. */
  exists: boolean
  /** Entire collateral incl. pending redistribution, `getEntireDebtAndColl.coll` (BTC wei). */
  collateral: bigint
  /** Principal component of the debt (draw + fee + 200 gas reserve, + any pending), excl. interest, `getEntireDebtAndColl.principal`. */
  principal: bigint
  /** Interest accrued to NOW, `getEntireDebtAndColl.interest` (NOT `getTroveInterestOwed`, which is the stale stored value; C3). */
  interestOwed: bigint
  /** Live entire debt = principal + interest from `getEntireDebtAndColl` (the value ICR uses). */
  entireDebt: bigint
  /** `getCurrentICR(address, price)`, 1e18 fixed point. */
  icr: bigint
  /** `getNominalICR(address)`. */
  nominalICR: bigint
  /** Derived: BTC/USD price at which ICR hits MCR = (MCR × entireDebt) / collateral. */
  liquidationPrice: bigint
  /** Derived: icr / MCR as a number (1.0 at MCR). */
  healthFactor: number
  /**
   * `icr < MCR`, the protocol's ONLY liquidation gate (`TroveManager.sol:1148`). There is
   * no Recovery Mode widening: `TroveManager.sol` contains no reference to `CCR`. Always
   * equal to `isLiquidatable(address)`; a fork test pins that the two agree (MK-001).
   */
  isLiquidatable: boolean
  /** The fixed rate locked at open, in basis points, `getTroveInterestRate`. */
  interestRate: number
  /** `getTroveStatus`. */
  status: TroveStatus
}

/** Protocol-wide live state, one consistent price snapshot. */
export interface SystemState {
  /** `getTCR(price)`, total collateral ratio, 1e18 fixed point. */
  tcr: bigint
  /** `checkRecoveryMode(price)`, system TCR < CCR. */
  isRecoveryMode: boolean
  /** `fetchPrice()`, BTC/USD, 1e18-scaled. */
  price: bigint
}
