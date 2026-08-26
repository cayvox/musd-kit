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
  chainId: 31611, // testnet; 31612 mainnet, addresses bundled (01-ground-truth §4)
  publicClient, // viem public client
  walletClient, // viem wallet client (only needed for writes)
  // addresses?: Partial<AddressMap>   // optional override (decision O5)
});
```

`createMusdClient` resolves all contract addresses for the chain, constructs typed
clients, and **reads the governable constants on first use** (`minNetDebt()`, the
global interest rate). The fixed constants (`MCR`, `CCR`, `MUSD_GAS_COMPENSATION`,
`PERCENT_DIVISOR`) are bundled.

### The governable constants are cached for 60 seconds, not forever

`minNetDebt` and the interest rate can change under a running process, and they used to be
held for the lifetime of the client object. A keeper or a server that builds one client at
boot could therefore act on a debt floor that changed hours earlier, and nothing in the SDK
would notice (MK-012).

```ts
createMusdClient({ chainId, publicClient, constantsTtlMs: 60_000 }); // DEFAULT_CONSTANTS_TTL_MS
musd.invalidateConstants(); // drop it now, do not wait out the TTL
```

Sixty seconds is chosen against the cost of being wrong each way. Stale is unbounded harm: a
preview reports a floor the contract no longer enforces, so an open the SDK calls fine
reverts, or one it rejects would have succeeded. Fresh costs two `eth_call`s a minute per
client, less than a single `previewOpen` already makes. It is not lower because these are
timelocked governance parameters, not a price. `constantsTtlMs: 0` re-reads every call.

The TTL is a **bound on staleness, not a promise of freshness**: inside the window you get
the cached value, deliberately. `invalidateConstants()` is the escape hatch for when you know
something changed, for example from a governance event you are already watching. It does not
clear the deployment verification, which is memoized for the client's lifetime on purpose: a
wiring pointer changing is a redeployment, not a governance action.

### `verifyDeployment()`, and when it runs

It asserts that the contracts at the resolved addresses really are a consistent MUSD
deployment, in one `multicall`: code present at all seven bundled addresses, all fourteen
cross wiring pointers resolving to that same map, `HintHelpers.priceFeed()` still unset (it
is inherited and never assigned, so zero is correct), and `MCR`/`CCR` equal to the bundled
fixed constants.

**It runs automatically before the first write, on every path** (MK-008), memoized, so it
costs one multicall for the life of the client and a resolved promise on every send after
that. You only need to call it yourself to choose the moment, for example right after
constructing a client against an overridden address map.

It used to read two constant views on ONE of the seven addresses, and to run only from
`getConstants()`. A fifteen line contract returning `MCR` and `CCR` passed it, and any write
that did not happen to read a constant was unverified. Asserting the wiring is what makes
identity mean something: a lookalike can return `MCR`, but it cannot make the real
`TroveManager` point at it.

`MismatchedDeployment` still means a bundled constant disagrees with the chain.
`DeploymentVerificationFailed` is the new one, carrying `failures: string[]`, and it lists
every check that failed rather than the first, because a wrong deployment is usually wrong in
more than one place.

### `addresses`, and what a partial override actually means

Overrides are validated and checksummed, and three things throw `InvalidAddressOverride`
(MK-009): an unknown contract key, a value that is not a valid EVM address, and the zero
address. The unknown key matters most, because it used to fail silently: `pricefeed` was
spread over a map that already had `priceFeed`, nothing changed, and nothing complained.
Zero is called out separately because it is what a partially initialized config produces and
it is the one wrong address that will not announce itself, since a call to an address with
no code returns empty data rather than reverting with a reason.

A **partial** override on a supported chain replaces one contract inside an otherwise
trusted map, and address validation cannot tell whether the replacement belongs to the same
deployment. What can is `verifyDeployment()`, which asserts the cross wiring pointers
between the contracts and runs before the first write on every path (MK-008). Redirect
`sortedTroves` to a foreign address and `TroveManager.sortedTroves()` will not equal it, so
verification fails before anything is sent.

---

## 2. Reading a live position (contract-authoritative)

```ts
const trove = await musd.getTrove(address);
// {
//   exists: boolean,
//   collateral: bigint, // BTC wei (1e18)
//   principal: bigint, // MUSD borrowed
//   interestOwed: bigint, // accrued to NOW, from getTroveInterestOwed (never the stored value)
//   entireDebt: bigint, // from getEntireDebtAndColl: principal + interest + 200 gas reserve
//   icr: bigint, // from getCurrentICR(address, price), 1e18 fixed point
//   nominalICR: bigint, // from getNominalICR
//   liquidationPrice: bigint, // derived: BTC/USD at which ICR hits MCR
//   healthFactor: number, // normalized distance to liquidation (1.0 = at MCR)
//   isLiquidatable: boolean, // icr < MCR
//   interestRate: bigint, // the rate locked at open (getTroveInterestRate)
//   status: TroveStatus, // from getTroveStatus (enum)
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
//     fee: bigint, // getBorrowingFee(debt), read on-chain
//     netDebt: bigint, // debt + fee
//     entireDebt: bigint, // netDebt + 200
//     icr: bigint, // computeCR(collateral, entireDebt, price)
//     icrThreshold: bigint, // CCR in Recovery Mode, MCR in normal mode
//     resultingTcr: bigint, // the system TCR if this open went through
//     liquidationPrice: bigint,
//     meetsMinimum: boolean, // netDebt >= minNetDebt
//     isRecoveryMode: boolean,
//     feeExempt: boolean, // false when no `account` was supplied
//     viable: boolean, // every condition _openTrove enforces
//     reasons: ('BELOW_MINIMUM_DEBT'|'ICR_BELOW_THRESHOLD'|'TCR_BELOW_CCR')[],
//     bindingConstraint: (typeof reasons)[number] | null,
//   }

// Existing Trove? These, not getBorrowingPower (MK-002).
musd.getBorrowingCapacity(owner);                 // → { capacity, entireDebt, remaining }
musd.previewBorrow({ owner, amount });            // → verdict + binding constraint + numbers
musd.previewRefinance(owner);                     // → fee, resulting principal/ICR, verdict

musd.getBorrowingPower({ collateral, price? });   // → bigint: max draw for an OPEN only
musd.computeICR({ collateral, entireDebt, price });        // → bigint
musd.computeLiquidationPrice({ collateral, entireDebt });  // → bigint
musd.computeEntireDebt({ draw, rate, elapsedSeconds });    // → bigint (preview accrual; see 05 §2)
musd.getHealthFactor({ icr });                             // → number
```

`previewOpen` powers a "Borrowing Power Calculator": give it intended collateral and
debt, get the resulting ICR, liquidation price, fee, total debt, and an explicit
**verdict** before the user signs anything.

**Pass `account` whenever you have it.** The borrowing fee is skipped entirely for a
fee exempt account (`BorrowerOperations.sol:637-643`), and the exempt cohort is not
empty on mainnet. Without an account the preview assumes not exempt and says so via
`feeExempt: false` (MK-018).

**`viable` replaced `meetsRecoveryRequirement`** (MK-005). The old flag was
`!isRecoveryMode || icr >= CCR`, unconditionally `true` in normal mode, so the only
viability flag the preview carried could never be false for the mode most opens happen
in. `viable` covers every condition `_openTrove` enforces: the debt floor, the mode
correct ICR threshold, and, in normal mode, the resulting system TCR. `reasons` is a
machine readable list and `bindingConstraint` is the one that binds first.

```ts
// before
if (!preview.meetsRecoveryRequirement) show('recovery mode blocks this');
// after
if (!preview.viable) show(preview.reasons); // or preview.bindingConstraint
```

**In Recovery Mode the fee is zero** (MK-004). The contract charges no borrowing fee
on a Recovery Mode open, and the preview no longer invents one. That also fixes a
second order bug: the debt floor is checked against `draw + fee`, so a preview that
added a phantom fee reported the floor met in the band
`draw < minNetDebt <= draw + fee`, for an open that reverts.

### Borrowing against an existing Trove

`getBorrowingPower` is an **open time calculator** and nothing else. Every Trove carries
a `maxBorrowingCapacity`, fixed at the **opening price**
(`BorrowerOperations.sol:1323-1328`), ratcheted only downward on a collateral decrease
(`:879-897`), and **never raised**, not by a price rise and not by adding collateral. A
debt increase is gated on `maxBorrowingCapacity >= netDebtChange + debt` (`:1358-1365`).

```ts
const { capacity, entireDebt, remaining } = await musd.getBorrowingCapacity(owner);
// `remaining` is headroom for draw + fee, not for the draw alone.

const p = await musd.previewBorrow({ owner, amount: parseMusd('5000') });
if (!p.viable) console.log(p.bindingConstraint); // EXCEEDS_BORROWING_CAPACITY | ...
```

### Refinancing costs money and is not always available

`refinance()` moves a Trove to the current global interest rate. Two things the SDK used to
model neither of (MK-003, MK-019):

- **The contract charges a fee and capitalizes it into principal.** It is
  `getBorrowingFee((refinancingFeePercentage * netDebt) / 100)`, added with
  `increaseTroveDebt` (`BorrowerOperations.sol:1033-1038`), so the debt grows and the fee
  starts accruing interest immediately. The percentage is **governable** and is read live.
- **It always reverts in Recovery Mode.** `_requireNotInRecoveryMode(price)` is the first
  requirement `_refinance` applies (`:1024`), ahead of the trove-is-active check.

```ts
const p = await musd.previewRefinance(owner);
if (!p.viable) console.log(p.bindingConstraint); // RECOVERY_MODE | ICR_BELOW_MCR | ...
p.fee;                 // what will be charged, 0 for a fee exempt account
p.resultingPrincipal;  // principal + fee, because the fee is capitalized
```

Skipping the preview is safe but wasteful: simulate before send still surfaces the Recovery
Mode revert as a typed `RecoveryModeRestriction`. The preview lets you know without sending.

### Redemption returns a rate AND an amount

`RedeemResult.fee` is **gone** (MK-014). It held the rate while its name said amount.

```ts
// before
result.fee                       // actually the RATE, a 1e18 fraction
// after
result.redemptionRate            // the rate, named as a rate
result.estimatedFeeCollateral    // the fee AMOUNT, in BTC wei
result.estimatedCollateralDrawn  // what that estimate was computed against
```

The protocol's own naming is the trap: `redemptionRate()` is a rate
(`BorrowerOperations.sol:129`), while `getRedemptionRate(collateralDrawn)` returns a fee
**amount** (`:499-508`). At exactly one BTC drawn the two print the same digits.

`maxFeePercentage` still caps the **rate** against the rate, which is unit consistent. It is
**advisory only**: `redeemCollateral` takes no fee cap parameter at all
(`TroveManager.sol:294-301`), so nothing on chain enforces it and governance can move the
rate between the read and the mine (MK-011).

`borrow()` and the debt increase path of `adjustTrove()` precheck the same gate and
throw `ExceedsBorrowingCapacity` **before** simulate, with capacity, entire debt,
netDebtChange and remaining attached (MK-002).

---

## 4. The Trove lifecycle (writes, hints absorbed, mapped to the real ABI)

Human-intent names; each maps to the exact ABI function in `01-ground-truth` §5.1.
Every write that changes the position recomputes the correct insertion hints
internally (`hints/`).

```ts
const { hash } = await musd.openTrove({
  collateral: parseBtc('0.05'), // BTC sent as msg.value
  debt: parseMusd('2500'), // requested draw (user receives this; owes draw + fee)
  maxFeePercentage: parseBps(100), // OPTIONAL SDK-side guard, NOT an on-chain arg (C5). Throws MaxFeeExceeded.
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

**`claim()` returns `{ claimed: false, hash: null }` for exactly one condition, and throws
for every other.** `claimCollateral()` does not return zero when there is nothing to claim,
it reverts with `CollSurplusPool: No collateral available to claim`, verified by triggering
it on the fork. That one reason is matched and turned into the no-op. An RPC failure, a
rejected signature, or any other revert now reaches you as a typed `MusdError` with the
original error in `cause` (MK-007). Before this, every failure returned
`{ claimed: false }`, so a user with real claimable surplus on a degraded endpoint was told,
indistinguishably from the truth, that they had none. If you were branching on
`claimed === false` alone, that branch no longer means "nothing to claim"; it means it, and
an error means something went wrong.

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
