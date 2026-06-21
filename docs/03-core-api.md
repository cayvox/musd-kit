# Core API (`@musd-kit/core`)

Framework-agnostic, viem-based. Signatures below are **illustrative of intent and
shape**; exact types are finalized in development against the bundled ABIs
(`01-ground-truth` §5). The guiding rule: **the developer expresses intent in human
terms; the SDK handles the protocol mechanics (hints, fees, gas reserve,
validation).**

All amounts are `bigint`. Collateral is BTC wei (1e18). MUSD is 1e18. See
`08-conventions` for the unit helpers (`parseBtc`, `parseMusd`, `parseBps`).

---

## 1. Setup

```ts
import { createMusdClient } from '@musd-kit/core';
import { createPublicClient, createWalletClient, http } from 'viem';

const musd = createMusdClient({
  chainId: 31611,        // testnet; 31612 mainnet, addresses bundled (01-ground-truth §4)
  publicClient,          // viem public client
  walletClient,          // viem wallet client (only needed for writes)
  // addresses?: Partial<AddressMap>   // optional override (decision O5)
});
```

`createMusdClient` resolves all contract addresses for the chain, constructs typed
clients, and **reads the governable constants on first use** (`minNetDebt()`, the
borrowing rate, the global interest rate), caching them per session (Law 3). The
fixed constants (`MCR`, `CCR`, `MUSD_GAS_COMPENSATION`, `PERCENT_DIVISOR`) are
bundled.

---

## 2. Reading a live position (contract-authoritative, Law 2)

```ts
const trove = await musd.getTrove(address);
// {
//   exists: boolean,
//   collateral: bigint,        // BTC wei (1e18)
//   principal: bigint,         // MUSD borrowed
//   interestOwed: bigint,      // accrued to NOW, from getTroveInterestOwed (never the stored value)
//   entireDebt: bigint,        // from getEntireDebtAndColl: principal + interest + 200 gas reserve
//   icr: bigint,               // from getCurrentICR(address, price), 1e18 fixed point
//   nominalICR: bigint,        // from getNominalICR
//   liquidationPrice: bigint,  // derived: BTC/USD at which ICR hits MCR
//   healthFactor: number,      // normalized distance to liquidation (1.0 = at MCR)
//   isLiquidatable: boolean,   // icr < MCR
//   interestRate: bigint,      // the rate locked at open (getTroveInterestRate)
//   status: TroveStatus,       // from getTroveStatus (enum)
// }
```

Every numeric field except `liquidationPrice` and `healthFactor` comes **straight
from a contract getter**, this call is correct by construction. `liquidationPrice`
and `healthFactor` are thin derivations of those authoritative values (see
`05-math-and-hints` §4).

```ts
const sys = await musd.getSystemState();
// { tcr: bigint, isRecoveryMode: boolean, price: bigint }   // getTCR, checkRecoveryMode, fetchPrice
```

---

## 3. Preview compute helpers (the only client-side math, `math/`)

For calculators and "what-if" UIs where no position exists yet. Each is also
exposed standalone.

```ts
musd.previewOpen({ collateral, debt });
// → {
//     fee: bigint,              // getBorrowingFee(debt), read on-chain
//     netDebt: bigint,          // debt + fee
//     entireDebt: bigint,       // debt + fee + 200
//     icr: bigint,              // computeCR(collateral, entireDebt, price)
//     liquidationPrice: bigint,
//     meetsMinimum: boolean,    // (debt + fee) >= minNetDebt
//     isRecoveryMode: boolean,  // and rules reflected if so
//   }

musd.getBorrowingPower({ collateral, price? });   // → bigint: max draw s.t. opening leaves ICR ≥ MCR, ≥ minNetDebt floor
musd.computeICR({ collateral, entireDebt, price });        // → bigint
musd.computeLiquidationPrice({ collateral, entireDebt });  // → bigint
musd.computeEntireDebt({ draw, rate, elapsedSeconds });    // → bigint (preview accrual; see 05 §2)
musd.getHealthFactor({ icr });                             // → number
```

`previewOpen` powers a "Borrowing Power Calculator": give it intended collateral and
debt, get the resulting ICR, liquidation price, fee, total debt, and whether it
satisfies the minimum, before the user signs anything. It implements the verified
arithmetic of `01-ground-truth` §6 and is dual-validated (`05` §5).

---

## 4. The Trove lifecycle (writes, hints absorbed, mapped to the real ABI)

Human-intent names; each maps to the exact ABI function in `01-ground-truth` §5.1.
Every write that changes the position recomputes the correct insertion hints
internally (`hints/`).

```ts
const { hash } = await musd.openTrove({
  collateral: parseBtc('0.05'),       // BTC sent as msg.value
  debt: parseMusd('2500'),            // requested draw (user receives this; owes draw + fee)
  maxFeePercentage: parseBps(100),    // OPTIONAL SDK-side guard, NOT an on-chain arg (C5). Throws MaxFeeExceeded.
});
// → openTrove(debt, upperHint, lowerHint) with value: collateral

await musd.addCollateral({ amount: parseBtc('0.01') });    // → addColl(upper, lower) payable
await musd.borrow({ amount: parseMusd('500') });           // → withdrawMUSD(...)   (borrow more)
await musd.repay({ amount: parseMusd('300') });            // → repayMUSD(...)      (snapshots interest first)
await musd.withdrawCollateral({ amount: parseBtc('0.005') }); // → withdrawColl(...)
await musd.adjustTrove({ addCollateral, increaseDebt });   // → adjustTrove(...)    (combined axes)
await musd.close();                                        // → closeTrove()        (exact payoff = entireDebt; recovers 200 reserve)
await musd.claim();                                        // → claimCollateral()
await musd.refinance();                                    // → refinance(upper, lower)  (move to current global rate)
```

**Single-axis vs combined:** route single-axis intents to the dedicated functions
(`addColl`, `withdrawColl`, `withdrawMUSD`, `repayMUSD`); use `adjustTrove` only for
combined collateral-and-debt changes.

---

## 5. Redemption and liquidation (permissionless)

```ts
// Redeem MUSD for BTC, uses getRedemptionHints, applies the live redemptionRate()
// (to ALL redeemers, the "0% for loan holders" rule was disproven in Phase 6, see
//  01-ground-truth §8), handles truncatedAmount.
await musd.redeem({ amount: parseMusd('1000'), maxIterations: 10n });

// Keeper surface, typed, with a precheck
if (await musd.isLiquidatable(borrower)) {
  await musd.liquidate(borrower);            // → TroveManager.liquidate(borrower)
}
await musd.batchLiquidate([addrA, addrB]);   // → TroveManager.batchLiquidateTroves([...])
```

The automation/strategy of *running* a keeper is the application's concern;
`musd-kit` provides the typed functions, not the bot.

---

## 6. MUSD token and price

```ts
await musd.balanceOf(address);   // MUSD balance
await musd.getPeg();             // current MUSD/USD via the protocol's oracle path
await musd.getOraclePrice();     // BTC/USD from PriceFeed.fetchPrice()
```

---

## 7. Errors

Typed, discriminated, never thrown strings. Protocol reverts map to named errors a
developer can branch on (`BelowMinimumDebt`, `ICRBelowMCR`, `InsufficientCollateral`,
`TroveNotFound`, `RecoveryModeRestriction`, `MaxFeeExceeded`, …). Full taxonomy and
mapping in `06-errors`.

```ts
import { MusdError, BelowMinimumDebt } from '@musd-kit/core';
try {
  await musd.openTrove({ collateral, debt });
} catch (e) {
  if (e instanceof BelowMinimumDebt) { /* show the minNetDebt floor */ }
}
```
