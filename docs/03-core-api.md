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
//   price: bigint, // fetchPrice() at blockNumber, the price icr was measured against
//   blockNumber: bigint, // the block EVERY field above came from
// }
```

Every numeric field except `liquidationPrice` and `healthFactor` comes **straight
from a contract getter**, this call is correct by construction. `liquidationPrice`
and `healthFactor` are thin derivations of those authoritative values (see
`05-math-and-hints` §4).

```ts
const sys = await musd.getSystemState();
// { tcr, isRecoveryMode, price, blockNumber }   // getTCR, checkRecoveryMode, fetchPrice
```

### One block, and why it takes two calls to get there

`getTrove`, `getSystemState` and `isLiquidatable` are each evaluated against a **single
block**, reported as `blockNumber` (MK-013). It used to be a claim in a docstring rather than
a fact: the price was read in its own round trip, and the price dependent getters ran at
whatever block came next.

It cannot be one call, and the reason is in the ABI rather than in the SDK. Every price
dependent getter takes the price as an **argument**, `getTCR(uint256)`,
`checkRecoveryMode(uint256)`, `getCurrentICR(address,uint256)`, with no zero argument
variant, so the value has to exist before the call that consumes it is encoded. The SDK
therefore pins instead of merging: the first `multicall` returns the price together with
`Multicall3.getBlockNumber()`, so those two cannot disagree, and the second runs the
dependent getters at that block. Two round trips, the same as before, and the snapshot is now
true.

`blockNumber` and `price` are on the result so you can check it rather than take our word:
re-read `getCurrentICR(address, trove.price)` at `trove.blockNumber` and you get `trove.icr`.

The preview functions (`previewOpen`, `previewBorrow`, `previewRefinance`,
`getBorrowingPower`) still read the price in their own round trip and make no single block
claim.

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
                                                 //   throws InvalidAmount for collateral <= 0
musd.computeICR({ collateral, entireDebt, price });        // → bigint
musd.computeLiquidationPrice({ collateral, entireDebt });  // → bigint
musd.computeEntireDebt({ draw, rate, elapsedSeconds });    // → bigint (preview accrual; see 05 §2)
musd.getHealthFactor({ icr });                             // → number
```

### `getBorrowingPower` costs four calls, not eighty

It used to binary search the draw, calling the real `getBorrowingFee` on every step: about 77
sequential round trips for one BTC, over a collateral amount nothing validated. A UI bound to
a text input could aim that at its own RPC endpoint (MK-010).

Now every read happens in one `multicall`, the answer is solved in closed form, and the chain
is asked for a real `getBorrowingFee` only to **confirm** it. The closed form rests on the fee
being linear in the draw, `getBorrowingFee(d) == borrowingRate() * d / DECIMAL_PRECISION()`,
which was established by triggering it against the deployment rather than assumed, and holds
exactly at the live rate (`1e15` against `1e18`, a flat 0.1%).

It stays a premise rather than a fact, because `borrowingRate` is governable
(`proposeBorrowingRate`, `approveBorrowingRate`). So the answer is confirmed against the chain
and a mismatch falls back to the bounded binary search. A closed form that silently disagreed
with the contract would be worse than the loop it replaced.

`collateral <= 0` now throws `InvalidAmount`. `useBorrowingPower` is disabled for it rather
than reporting an error, since an empty input parsing to `0n` is a calculator being typed
into.


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

`maxFeePercentage` still caps the **rate** against the rate, which is unit consistent. See
the section below on what it does and does not give you.

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
  maxFeePercentage: parseBps(100), // OPTIONAL SDK-side guard, NOT an on-chain arg. Throws MaxFeeExceeded.
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

### `maxFeePercentage` is a pre-flight check, not a protection

Worth being blunt about, because the name reads like a guarantee and it is not one (MK-011).

**No MUSD write path takes a fee cap parameter.** `openTrove`, `withdrawMUSD`, `adjustTrove`
and `refinance` are all `(amount, upperHint, lowerHint)` shaped, verified from the full
signatures in `01-ground-truth` §5.1, and `redeemCollateral` has none either
(`TroveManager.sol:294-301`). There is nothing for the SDK to pass a cap to, so nothing on
chain enforces one. The SDK cannot fix that; it can only be honest about it.

What actually happens, in order:

1. the SDK reads the fee, or the rate, from the chain;
2. it compares that value against your cap, and may throw `MaxFeeExceeded`;
3. it sends the transaction.

**Between 1 and 3 the governable rate can change, and the transaction still mines at whatever
rate is live then.** Nothing reverts. A passing check means the fee was within your cap *when
it was read*, and nothing more. It is opt in and defaults to no cap, so the default behavior
is to accept whatever the protocol charges.

If you need a real bound, the enforcement has to be yours: read the fee again after the
receipt (`redeem` documents the `Redemption` event's `collateralFee` as the authoritative
number), or do not send while the rate is moving.

### What simulate before send does and does not guarantee

Every write simulates first, and every condition that holds at simulate time comes back as a
typed `MusdError` rather than as a reverted receipt you have to decode. That is most of them
and it is worth having.

**It is not a guarantee that the send succeeds, and MK-035 is the counterexample.** Two things
it cannot catch:

- a condition that becomes true AFTER the simulation, because the chain moved;
- the transaction running out of gas, because the gas limit comes from an estimate taken
  before the block the transaction mines in.

Traced on a fork of live Mezo: the same `redeemCollateral` call, from byte identical state,
varied from **610270 to 710023 gas** across 40 attempts, a 16% swing, against a limit carrying
a **1.5%** margin. Two of the 40 reverted, and the trace named `ActivePool` running out of gas
at call depth 4. The receipt showed `gasUsed < gasLimit`, so it did not even look like out of
gas: the EVM forwards at most 63/64 of the remaining gas to a nested call, so an inner frame
can exhaust its allowance while the outer frame keeps the last 1/64.

**So check the receipt.** The SDK returns `{ hash }` without waiting, by design, and a
reverted receipt is a real outcome you have to handle.

### The gas margin, and what it costs you

Every write is sent with **25% over the estimate** (`DEFAULT_GAS_MARGIN_PERCENT`), because the
estimate is taken before the block the transaction mines in and the work can grow in between.
That number is measured, not conventional: across all nine measurable write paths, 12 attempts
each from byte-identical state, the same call's gas varied by up to **10.16%**
(`addCollateral`), and one traced `redeem` grew **16.4%** and reverted. 25 is about 1.5 times
the worst growth observed.

```ts
createMusdClient({ chainId, publicClient, gasMarginPercent: 25 }); // the default
```

What it costs you, measured on a fork rather than assumed:

| | |
|---|---|
| **Fees** | nothing. Unused gas is refunded exactly |
| **Balance** | the real cost. Your account must hold `gasLimit * gasPrice + value` **up front**, or the send is rejected before it reaches the chain |
| **Wallet display** | a larger maximum, which is not the charge |
| **Latency** | none added. `simulateContract` returns no `gas`, so viem was already estimating internally |

`gasMarginPercent: 0` restores the old behavior, which is what produced the reverts.

### Knowing whether the margin was actually applied (MK-037)

Every write result carries a `gas` field saying how its limit was chosen. This exists because
for one release the margin could be dropped on any send and the only trace was a
`console.warn`, which a library consumer cannot assert on, cannot route to their own telemetry,
and does not see in a console they have filtered.

```ts
const result = await musd.openTrove({ collateral, debt });

switch (result.gas.source) {
  case 'estimate':  // the normal case
    result.gas.limit;         // what was sent
    result.gas.estimate;      // what the node answered
    result.gas.marginPercent; // what was added
    break;
  case 'explicit':  // a gas limit was set explicitly; the estimate was not consulted.
    break;            // NOT reachable from the public write methods today: none of them
                      // takes a `gas` parameter. The branch exists on the internal write
                      // path and is covered by its tests; it is documented here so the
                      // union is complete, not because you can currently produce it
  case 'fallback':  // estimation FAILED. This send carried no margin at all
    result.gas.error; // the typed MusdError explaining why
    break;
}
```

`source: 'fallback'` is the one worth branching on. That send went out with pre-margin
behavior, so it is the send most likely to run out of gas, and now you can tell.

The cause of nearly every historic `fallback` was in this SDK rather than in your node. The
estimate was made with the account OBJECT, which makes viem prepare the request and put a `gas`
field on `eth_estimateGas`; the node then treats that as the ceiling of its search and the
estimate fails against a cap it supplied itself, while the write succeeds. It now estimates
with the address. Same answer, one fewer round trip, no self imposed cap. Full mechanism and
the payload diff that established it: `FINDINGS.md`, MK-037.

### Sizing a redemption: use `previewRedeem`, not `truncatedAmount` (MK-048)

**The amounts a redemption accepts are not an interval. There is a gap.** For the first eligible
Trove, the one with the lowest ICR at or above MCR, with net debt `D` as read, the live floor `M`,
and the interest `G` that Trove accrues before your transaction lands:

| amount | outcome |
|---|---|
| `A <= D - M` | **works.** A partial inside that Trove's headroom |
| `D - M < A < D + G` | **reverts.** The whole call, not a smaller redemption |
| `A >= D + G` | **works.** The Trove is consumed whole, a branch with no floor check |

**`D` itself is inside the gap, not above it.** The contract accrues interest on that Trove before
it sizes your lot (`:366`, then `:1218-1221`), so by the time your transaction executes the Trove
owes more than you read, and an offer of exactly `D` arrives as a partial that leaves dust. Use
`nextViableAmount`, which already carries `G`, rather than computing the net debt yourself.

**`nextViableAmount` is good for about ten minutes.** `G` is 600 seconds of interest, and that
window was measured at both ends on a fork with only the delay varied:

| delay before the transaction lands | `netDebt` | `nextViableAmount` |
|---|---|---|
| 1 second | reverts | works |
| 60 seconds | reverts | works |
| 600 seconds | reverts | works |
| 1 hour | reverts | **reverts** |

One second is enough to make the bare net debt fail. If you expect to be slower than ten minutes,
add to the figure: overshooting spills to the next Trove and cannot cost you the call, because
`:406-408` only requires that something was drawn.

**The binding quantity is another account's headroom, not your balance**, which is why no amount of
inspecting your own position tells you the answer. From `mezo-org/musd`, `TroveManager.sol`:
`:1218-1221` hands the whole requested amount to that Trove, `:1299-1306` cancels the partial if the
result would fall below `minNetDebt`, `:392` breaks the loop, and `:406-408` reverts because nothing
was drawn. Consuming the Trove whole takes `:1252` instead, which never reaches the cancellation.

```ts
const p = await musd.previewRedeem({ redeemer, amount });
if (!p.viable && p.bindingConstraint === 'PARTIAL_BREACHES_DEBT_FLOOR') {
  p.maxWithoutConsuming; // the largest amount below the gap
  p.nextViableAmount;    // the smallest amount above it: net debt PLUS the accrual margin
  p.accrualMargin;       // the margin itself, if you want to see the offset
}
p.redeemable;            // what a single call will ACTUALLY redeem
```

`redeem` prechecks this and throws `RedemptionBreachesDebtFloor` with both edges, so you do not pay
gas to discover it.

**Do not size a redemption from `RedeemResult.truncatedAmount`.** That is what
`getRedemptionHints` returned, and the helper answers a different question: it sizes each partial to
a Trove's headroom and then moves to the next one, which needs one call per Trove
(`HintHelpers.sol:138-162`). It reported `headroom + 1`, `netDebt / 2` and `netDebt - 1` as fully
redeemable on a live chain where all three revert.

### A redemption can revert even when the preview is right (MK-049)

**Retry is part of using `redeem` correctly.** The partial hint carries an NICR computed from the
collateral remaining after the redemption, derived at the price the hint was read at
(`HintHelpers.sol:148`), and the contract derives the same quantity at the price when the
transaction MINES (`TroveManager.sol:1224-1226`). **If the oracle moves in between, the two differ
and the partial cancels** (`:1299-1301`). The contract allows a band for interest accrual
(`:1276-1285`) but not for the oracle.

Observed live: an amount at 50% of the headroom failed on the first attempt and succeeded on the
second, unchanged. **The SDK does not retry for you**, deliberately: a retry is a second
transaction, and spending your gas without asking is not its decision. Catch `RedemptionFailed` and
retry with a freshly computed amount.

### Closing costs more MUSD than the position ever gave you (MK-045)

**A Trove cannot be closed with only the MUSD it drew.** This is a property of the protocol, not of
this SDK, and it surprises people, so plan for it before you build a "close position" button.

Read from `mezo-org/musd`, `BorrowerOperations.sol`:

- The borrowing fee is **minted to the PCV**, not to you: `_triggerBorrowingFee` is
  `_musd.mint(pcvAddress, fee)` (`:602-611`).
- You receive the bare draw: `_withdrawMUSD(..., _recipient, _debtAmount, ...)` (`:716-720`).
- Closing requires `entireDebt - MUSD_GAS_COMPENSATION` in your hands (`:963`).

So you receive `draw`, you owe `draw + fee + 200`, and you must hold `draw + fee` to close. **You are
short by exactly the fee, plus whatever interest has accrued since.**

Measured on a fork: a 2000 MUSD draw delivered 2000 and required 2002 to close. Measured on live
Mezo testnet after a full lifecycle: a shortfall of `2.300590672576505785` MUSD.

**And a position at the debt floor cannot repay its way out.** `_requireAtLeastMinNetDebt` (`:856`)
forbids taking the net debt below `minNetDebt`, so a Trove opened at the floor can repay only the
few MUSD of headroom above it.

**What this means for a user who borrowed the maximum:** they cannot close without acquiring MUSD
from somewhere else. Their collateral is not lost, it is just not retrievable through `close` until
they hold the fee.

`previewClose` tells you before you send, with the exact number:

```ts
const p = await musd.previewClose(owner);
if (!p.viable && p.bindingConstraint === 'INSUFFICIENT_MUSD_BALANCE') {
  // p.musdShortfall is what the user must acquire. p.musdRequired is the full amount.
}
```

### Which writes have a preview, which have prechecks, and which have neither

Read from the contract for the 0.2.x preview wave, not carried forward: part of an earlier version
of this table was reasoned rather than read, and was wrong (MK-038). Line numbers are
`mezo-org/musd`, `BorrowerOperations.sol` unless stated.

**Ten of eleven writes have a preview. The eleventh has no condition to preview.**

| Write | Preview | Prechecked before simulate | Gates the contract enforces |
|---|---|---|---|
| `openTrove` | **`previewOpen`** | amounts, fee cap, floor, ratios | not active `:633`; `minNetDebt` `:645`; recovery ICR>=CCR `:655`; normal ICR>=MCR `:657`, TCR>=CCR `:665` |
| `addCollateral` | **`previewAdjustTrove`** | **all of them** | active `:790`; **normal** ICR>=MCR `:1201`, TCR>=CCR `:1209`; **recovery: none** |
| `borrow` | **`previewBorrow`**, **`previewAdjustTrove`** | **all of them** | active; **normal** ICR>=MCR, TCR>=CCR; **recovery** ICR>=CCR `:1272`, newICR>=oldICR `:1273`; capacity `:851` |
| `repay` | **`previewAdjustTrove`** | **all of them** | active; **normal** ICR>=MCR, TCR>=CCR; **recovery: none**; `minNetDebt` `:856`; repay <= debt-200 `:859`; balance `:860` |
| `withdrawCollateral` | **`previewWithdrawCollateral`**, **`maxWithdrawableCollateral`** | **all of them** | active; `assert(amt <= coll)` `:837`; **recovery: no withdrawal at all** `:1270`; **normal** ICR>=MCR, TCR>=CCR |
| `adjustTrove` | **`previewAdjustTrove`** | **all of them** | every row above, by combination; singular coll change `:788` |
| `close` | **`previewClose`** | **all of them** | active `:951`; *if `canMint`* not recovery `:954`; balance >= debt-200 `:963`; *if `canMint`* TCR>=CCR `:972` |
| `refinance` | **`previewRefinance`** | Trove active, Recovery Mode | not recovery `:1023`; active `:1024`; ICR>=MCR **after the fee** `:1058`; TCR>=CCR `:1059` |
| `claim` | **none, and none is possible** | matches one revert, rethrows the rest | **none.** `_claimCollateral` (`:1119-1124`) reads the surplus pool and sends |
| `redeem` | none | positive, MUSD balance, rate cap | `TroveManager.sol`: TCR>=MCR `:318`; amount>0 `:319`; balance `:320` |
| `liquidate`, `batchLiquidate` | none, permissionless by design | none | `TroveManager.sol`: non empty `:657`; something liquidatable `:690` |

### Four rules that are not what a Liquity reader expects

Each is expressed on a preview result rather than left in prose, because prose in three documents is
how the earlier version of this table drifted from the Solidity.

**1. The individual ratio requirement is ABSOLUTE.** `_requireICRisAboveMCR` is
`require(_newICR >= MCR, ...)` (`:1330-1335`). It tests the resulting level, not whether you
improved. **A position already under MCR cannot be partly rescued by adding collateral:** the ICR
rises and the call still reverts.

```ts
const p = await musd.previewAdjustTrove({ owner, addCollateral: parseBtc('0.01') });
if (!p.viable && p.bindingConstraint === 'ICR_BELOW_THRESHOLD' && p.icrIsAbsolute) {
  // p.minimumCollateralToClearIcr is the collateral that WOULD clear it.
}
```

**2. Recovery Mode does not check TCR; normal mode does.** `_requireValidAdjustmentInRecoveryMode`
(`:1265-1275`) never looks at TCR, and `_requireValidAdjustmentInNormalMode` (`:1197-1210`) checks it
on every adjustment. So a pure top-up and a pure repayment are **ungated in Recovery Mode** and gated
in normal mode, which is the opposite of the intuition.

**3. A plain `borrow` can never succeed in Recovery Mode.** `withdrawMUSD` sends no collateral, so
`newICR < oldICR` always and `_requireNewICRisAboveOldICR` (`:1273`) cannot be satisfied at any draw
size. Only `adjustTrove` with a collateral leg can clear it. `previewBorrow` and `previewAdjustTrove`
both report `ICR_NOT_IMPROVED_IN_RECOVERY_MODE` rather than sending you to hunt for a smaller draw.

**4. Recovery Mode refuses collateral withdrawal outright, not by amount.** `_requireNoCollWithdrawal`
(`:1270`) permits zero, so no smaller number works. `maxWithdrawableCollateral` returns
`{ amount: 0n, limitedBy: 'RECOVERY_MODE' }`, which is a different message to a user than a ratio.

**5. Two of `close`'s four gates are conditional on a live chain read.** `canMint` is
`musd.mintList(borrowerOperations)` (`:949`), a governable mapping. When it is false, closing is
permitted in Recovery Mode and the TCR check does not run at all. `ClosePreview.canMint` reports what
was read rather than assuming.

### The one limit that remains, and where it comes from

**`maxFeePercentage` cannot be enforced on chain.** No MUSD write path takes a fee cap parameter, so
the SDK reads the rate, compares, and sends; the governable rate can move in between. **This is a
property of the protocol, not of this SDK**, and no SDK can close it. Treat it as a local guard
(MK-011).

### When a write reverts anyway

```ts
const d = await diagnoseRevertedWrite(publicClient, hash);
// d.kind: 'SUCCEEDED' | 'OUT_OF_GAS' | 'REVERTED' | 'INDETERMINATE'
// d.advice: a sentence naming what to do next
```

`OUT_OF_GAS` and `REVERTED` call for opposite responses: resend with more gas, or fix the
condition in `d.reason`. **`INDETERMINATE` is not a hedge**, it is the boundary of what is
knowable without a tracing endpoint. A nested call can exhaust its gas while the outer frame
keeps the last 1/64, so `gasUsed < gasLimit`; and `eth_call` at a block number runs against
end-of-block state, so a condition that was true mid-block is invisible to it. Those two cases
are only separable with `debug_traceTransaction`, which most public endpoints do not expose.

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
