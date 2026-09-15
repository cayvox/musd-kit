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

**The previews do NOT get this property, and the list of them was two waves out of date.** Each of
the nine below evaluates against a price read in a separate round trip, then runs the reads that
depend on it in a second, and none of them claims a single block snapshot anywhere. Eight distinct
read sites: two of the nine inherit another's.

| Function | Where the price is read | Note |
|---|---|---|
| `previewOpen` | `math/previewOpen.ts:132-137` | skipped when the caller passes `price` |
| `previewBorrow` | via `previewAdjustTrove`, below | it is a projection of the adjust preview |
| `previewAdjustTrove` | `math/previewAdjust.ts:295-299` | |
| `previewWithdrawCollateral` | via `previewAdjustTrove` | |
| `maxWithdrawableCollateral` | `math/previewAdjust.ts:410-414` | |
| `previewClose` | `math/previewClose.ts:139-143` | |
| `previewRedeem` | `math/previewRedeem.ts:278-282` | |
| `previewRefinance` | `math/previewRefinance.ts:155-159` | |
| `getBorrowingPower` | `math/getBorrowingPower.ts:96-103` | skipped when the caller passes `price` |

**What that costs you.** The oracle can move between the two round trips, so a preview's `price`
and the ratios computed from it are consistent with each other but not pinned to a block the way
`getTrove` is. `price` is on every one of these results for exactly that reason: it is the value
the verdict was computed against, and it is checkable. This was disclosed in the register
(MK-013's scope note) and named four functions here while the real number had grown to nine as
`previewAdjustTrove`, `previewWithdrawCollateral`, `maxWithdrawableCollateral`, `previewClose` and
`previewRedeem` were added.
**Moving them is deliberately not done**, on MK-013's original reasoning: it is a larger change to
the math layer's shape than the finding calls for, and none of them makes a claim it does not
keep. It is stated here so a caller reads the limit where the API is documented.

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

musd.getBorrowingPower({ collateral, account?, price? });
                                                 // → { ceiling, ceilingIcr, isRecoveryMode, price },
                                                 //   for an OPEN only (MK-100, MK-240); a limit,
                                                 //   never an amount to borrow
                                                 //   throws InvalidAmount for collateral <= 0
musd.drawForMargin({ collateral, horizonSeconds, priceFallBps, account?, price? });
                                                 // → { draw, drawIcr, margin, ceiling, ... }
                                                 //   both margin inputs REQUIRED, no default (MK-240)
musd.computeICR({ collateral, entireDebt, price });        // → bigint
musd.computeLiquidationPrice({ collateral, entireDebt });  // → bigint
musd.computeEntireDebt({ draw, rate, elapsedSeconds });    // → bigint (preview accrual; see 05 §2)
musd.getHealthFactor({ icr });                             // → number
```

### The ceiling is a fact about the contract; how much to borrow is the caller's decision (MK-100, MK-240)

**`ceiling` is the largest draw the contract accepts, and that is all it is.** In normal mode it
opens the position at exactly the 110% minimum collateral ratio (`_requireICRisAboveMCR`,
`BorrowerOperations.sol:657`, defined at `:1330-1335`). Liquidation is `ICR < MCR`
(`TroveManager.sol:1146-1148`), and the debt it is measured against accrues interest every second
(`TroveManager.sol:1513-1527`). So a position opened at the ceiling can be liquidated by anyone
within seconds, and a liquidation takes all of the collateral.

**There is no recommended draw, because the library cannot know the two things one depends on**: how
long the position will be held, and how far the price may fall meanwhile. `drawForMargin` takes both as
required inputs, with no default, and returns the largest draw that clears every open gate after that
fall and that horizon of interest, beside the ceiling and the margin it was solved with:

```ts
const sized = await musd.drawForMargin({
  collateral,
  account,
  horizonSeconds: 7n * 86_400n, // your choice
  priceFallBps: 1_000n,         // your choice
});
sized.draw;     // survives that fall over that horizon, and nothing more
sized.drawIcr;  // the ratio it opens at
sized.ceiling;  // the contract's limit, from the same read
sized.margin;   // { horizonSeconds, priceFallBps, interestRateBps, accrualFraction, stressedPrice }
```

A missing input, a negative horizon, or a fall outside `0n <= priceFallBps < 10_000n` throws
`InvalidAmount` before any read. `0n` for both is allowed and returns the ceiling as `draw`, for a caller
who asks for no margin.

**Choosing the inputs.** The share of start times after which Mezo mainnet `fetchPrice()` fell at least
the given amount within the horizon, over blocks 9841930 to 11868955 (86 days, one sample every 225
blocks, about 14 minutes), measured by `MEZO_MAINNET_RPC_URL=<endpoint> pnpm tsx scripts/oracle-moves.ts
--end 11869000 --consecutive 0 --days 90 --step 225 --horizons 3600,86400,259200,604800,2592000 --falls
200,500,1000,2000`:

| Hold for | Fell 2% or more | 5% or more | 10% or more | 20% or more | Worst fall seen |
|---|---|---|---|---|---|
| 1 hour | 0.1% | 0.0% | 0.0% | 0.0% | 4.18% |
| 1 day | 17.4% | 1.0% | 0.0% | 0.0% | 5.70% |
| 3 days | 43.9% | 3.8% | 0.01% | 0.0% | 10.24% |
| 7 days | 57.6% | 6.7% | 0.2% | 0.0% | 10.80% |
| 30 days | 68.2% | 10.4% | 1.1% | 0.0% | 11.64% |

**What that table is not.** It is one stretch of history in one market regime, not a distribution of
regimes. Neighbouring start times share most of their samples, so the shares are not independent
trials. A dip that recovered between two samples is not in it, so every share is a lower bound and the
true worst falls are larger. The 30 day row counts 5917 starts against 9005 for the hour, because a
start counts only when its whole horizon was observed. And price is not the only risk: debt
redistributed from other Troves' liquidations (`TroveManager.sol:980-1047`) raises a position's debt
without its owner acting. Read it as how often a margin of that size would have been crossed recently.

**Why this replaced `recommended`.** Until 0.5.0 `getBorrowingPower` also returned `recommended`, solved
for a 200 bps fall and 3600 seconds of interest, and both READMEs presented it as the draw to offer. That
margin answered how long a figure survives between being read and being mined. The name answered how
much to borrow and hold, which the library cannot answer. By the table above, a 2% fall followed within a
day of 17.4% of start times and within a week of 57.6% (MK-240).

**Proven on a fork**, by `packages/core/test/zz-borrowing-power-boundary.fork.test.ts`: opened at the
ceiling, the Trove is liquidatable after 1, 60, 600 and 3600 seconds and is liquidated. Opened at a
`drawForMargin` figure for a day and a 500 bps fall, it is not liquidatable at any of those delays; a day
later a fall of 499 bps leaves it safe and one of 510 bps makes it liquidatable, so the margin is the one
asked for and no other. In Recovery Mode the ceiling lands on CCR, which is not a liquidation threshold.
When the whole system's ratio binds, the ceiling sent a second later is refused with
`SystemRatioBelowCCR` while a margin draw opens.

**Every other figure the SDK offers as a maximum or an advice, and the horizon each is true for** (MK-240,
MK-247). Each was asked the question MK-240 asked of `recommended`: over what horizon is it true, and does
its name or its documentation imply a longer one.

| Figure | True for | Implies longer? |
|---|---|---|
| `getBorrowingPower().ceiling` | the block it was read at | No: documented as a limit, never an amount |
| `getBorrowingCapacity().remaining`, `previewBorrow` `capacity.remaining` | the block; refused at its exact value a block later (MK-072) | No: documented as headroom, not a draw |
| `maxWithdrawableCollateral().amount` | the block; refused a second later, and accepted only if the price rose, leaving the Trove at MCR | **It did**: the React hook called it the max button's number. Corrected (MK-247) |
| `minimumCollateralToClearIcr` | the block; refused at its exact value a block later | No: documented as a floor, add a margin |
| `previewClose().musdRequired` | the block; the chain requires more a block later (MK-050) | No: documented as a snapshot |
| `previewRedeem().nextViableAmount` | about 600 seconds, sized for 900 (MK-095, MK-104) | No: the window is on the field, and a redeemer does not hold a redemption |
| `computeLiquidationPrice`, `Trove.liquidationPrice` | the block; the threshold rises as debt accrues (MK-109) | No: documented as a threshold near which liquidation begins |

`capacity.remaining`, `maxWithdrawableCollateral().amount` and `minimumCollateralToClearIcr` fail loudly
at their exact value: `_adjustTrove` brings interest current before any gate (`BorrowerOperations.sol:769`),
and `zz-limit-figures.fork.test.ts` sends each one second after the read and pins the refusal beside a
control that succeeds.

### `getBorrowingPower` costs a handful of calls, not eighty

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

**Pass `account` when you have it (MK-067).** The borrowing fee is skipped entirely for a fee
exempt account (`BorrowerOperations.sol:637-643`), so without an account the answer is the not
exempt one and an exempt caller is told their maximum is smaller than it is. Supplying it adds one
read, and only in normal mode: in Recovery Mode the fee is already zero for everyone, so the
exemption cannot change the answer and is not asked for.

**This function used to charge that fee in Recovery Mode too**, which made every Recovery Mode
maximum short by it (MK-067). It no longer decides any open rule at all: its feasibility predicate
is `evaluateOpen`, the same evaluator behind `previewOpen`, so the two cannot disagree about where
the boundary is. `packages/core/test/borrowing-power-agreement.test.ts` is what keeps that true.


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
a `maxBorrowingCapacity`, `coll * price / (110 * 1e16)` (`BorrowerOperations.sol:1323-1328`),
set at the **opening price**, lowered on a collateral decrease (`:879-897`), not raised by a
price rise or a top-up, and **reset from the current price by every refinance**
(`:1077-1084`), which raises it after a price rise and cuts it after a fall (MK-101).
`previewRefinance` reports both `currentCapacity` and `resultingCapacity`. A debt increase is
gated on `maxBorrowingCapacity >= netDebtChange + debt` (`:1358-1365`).

```ts
const { capacity, entireDebt, remaining } = await musd.getBorrowingCapacity(owner);
// `remaining` is headroom for draw + fee, not for the draw alone. It is ALSO the distance to
// ICR == MCR, because `capacity` and the debt at MCR are the same expression, so a draw that
// spends all of it lands on the liquidation threshold and is refused a second later (MK-072).
// Size the draw with previewBorrow, which evaluates the ratio gate as well as this one.

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
p.currentInterestRateBps;   // the rate the Trove carries now
p.resultingInterestRateBps; // the GLOBAL rate it moves to, higher or lower (MK-101)
p.currentCapacity;          // maxBorrowingCapacity now
p.resultingCapacity;        // coll * price / 1.1 at the current price, up or down (MK-101)
```

**A refinance is not always a cheaper rate, and it resets your borrowing capacity (MK-101).**
`_refinance` sets the Trove's rate to `interestRateManager.interestRate()` whatever it is
(`BorrowerOperations.sol:1069`, `:1075`), and sets `maxBorrowingCapacity` from the current price
unconditionally (`:1077-1084`). Read both pairs before offering the button: a Trove opened when the
global rate was lower moves UP, and a refinance after a price fall cuts the capacity every later
borrow is gated on.

Skipping the preview is safe but wasteful: simulate before send still surfaces the Recovery
Mode revert as a typed `RecoveryModeRestriction`. The preview lets you know without sending.

### Redemption returns what it settled, a rate, and an estimate named as one

`RedeemResult.fee` is **gone** (MK-014). It held the rate while its name said amount. And since 0.5.0
`redeem()` resolves once the transaction has mined, with what it did read from its receipt (MK-241):

```ts
const result = await musd.redeem({ amount });
result.settled.redeemedAmount;      // MUSD actually redeemed and burned, `Redemption._actualAmount`
result.settled.unredeemedAmount;    // asked for and not redeemed, still in your balance
result.settled.collateralDrawn;     // `_collateralSent`, which INCLUDES the fee (TroveManager.sol:420-425)
result.settled.collateralFee;       // `_collateralFee`, in BTC wei
result.settled.collateralReceived;  // drawn less the fee, what arrived (:416-418, :444-447)
result.redemptionRate;              // the rate, named as a rate
result.estimatedBeforeSend;         // { redeemable, collateralDrawn, collateralFee }, from previewRedeem's walk
```

Until 0.5.0 the result carried `truncatedAmount` and a fee estimated from it, both the hint helper's
figures. When a later partial cancelled, the chain redeemed far less: on a fork, 1,808.46 MUSD settled
where the helper's figure for the same state was 3,515.14 (`zz-redemption-settled.fork.test.ts`). A
reverted redemption throws `RedemptionFailed`; `settledRedemptionFrom(receipt, troveManager)` reads a
receipt you hold yourself.

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
varied from **610270 to 710023 gas** across 40 attempts, a 16% swing, against a limit that left
only **1.5% over the gas actually used** on a send measured at the time. That 1.5% is a REALISED
headroom, limit over gas used, and it is not the 25% this SDK now requests over the node's
estimate: it was that thin because the requested margin was being dropped before the send
(MK-037, since fixed). Two of the 40 reverted, and the trace named `ActivePool` running out of gas
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

**`nextViableAmount` is good for about ten minutes, through `redeem()` as well as at the contract.**
`G` is 900 seconds of interest (`REDEMPTION_ADVICE_MARGIN_SECONDS`), advertised as 600, because the
accrual runs from the block the figure was read at to the block the transaction settles in.
`redeem()` re-checks the amount with a 60 second sending margin (`REDEMPTION_SEND_MARGIN_SECONDS`),
not with another 900: until 0.4.0 it re-applied the full margin and refused its own advice a block
after giving it (MK-104). Measured on a fork with only the delay varied:

| delay before sending | `netDebt`, raw send | `nextViableAmount`, raw send | `nextViableAmount` through `redeem()` |
|---|---|---|---|
| 1 second | reverts | works | works, the Trove consumed whole |
| 60 seconds | reverts | works | works, the Trove consumed whole |
| 600 seconds | reverts | works | works, the Trove consumed whole |
| 1 hour | reverts | **reverts** | **refused before gas**, `RedemptionBreachesDebtFloor` |

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

**One more whole consumption rule, from `_closeTrove`** (MK-245). A redemption that consumes a Trove whole
closes it (`TroveManager.sol:1252-1261`), and `_closeTrove` requires more than one Trove in the system
whenever BorrowerOperations can mint (`:1397-1399`, `:1488-1496`). Both counts fall with each Trove the
call consumes, so a large enough redemption reaches the last one, and the whole call reverts. The preview
reports it as `LAST_TROVE_IN_SYSTEM` and `redeem` throws `LastTroveInSystem` before gas.

`redeem` prechecks this and throws `RedemptionBreachesDebtFloor` with both edges, so you do not pay
gas to discover it.

**Do not size a redemption from `getRedemptionHints`' truncated amount**, which `RedeemResult` no longer
carries (MK-241). The helper answers a different question: it sizes each partial to
a Trove's headroom and then moves to the next one, which needs one call per Trove
(`HintHelpers.sol:138-162`). It reported `headroom + 1`, `netDebt / 2` and `netDebt - 1` as fully
redeemable on a live chain where all three revert.

### `maxIterations`: zero means no limit, exactly as the contract reads it (MK-114)

`previewRedeem` and `redeem` take `maxIterations`, the number of eligible Troves one call may redeem
from, and `redeem` sends it unchanged to `getRedemptionHints` and `redeemCollateral`.

| value | what the SDK does | why |
|---|---|---|
| omitted | `DEFAULT_REDEMPTION_MAX_ITERATIONS`, `100n`, in the preview and in the write alike | one exported default, so the precheck and the call cannot walk different lists |
| `0n` | **no limit**: the walk continues until the eligible Troves cover `amount`, or the list ends | both contract functions replace zero with `type(uint256).max` (`TroveManager.sol:353-355`, `HintHelpers.sol:107-109`) |
| `1n` and up | at most that many eligible Troves; Troves below MCR are skipped without counting (MK-107) | the contract decrements only inside its loop (`:360-365`) |
| negative, or above the largest `uint256` | throws `InvalidAmount` before any read | the parameter is a `uint256`, so no such value can be sent |

**Zero is accepted rather than refused, and that was a decision.** Refusing it would protect a caller
who typed `0n` meaning "none", at the price of refusing the contract's own meaning of the value the
SDK forwards to it. It is accepted because a `bigint` zero has to be written deliberately (omitting
the field is how a caller gets the default), and because what it asks for is bounded by the request
rather than by the list: the walk stops as soon as the Troves it has read cover `amount`, so a
100 MUSD redemption at zero reads one or two Troves, not every Trove in the system. A request larger
than everything redeemable does walk the whole list, on chain and in the preview alike.

**Until 0.4.1 the preview read zero differently from the chain.** 0.4.0 walked one eligible Trove at
`0n` and reported less than the call redeemed, and `redeem()` prechecked only that Trove; 0.2.0 to
0.3.1 walked none. Measured on the deployed helper at block 15043414: a 400,000 MUSD request is
returned whole at `0` and truncated to 298,067 MUSD at `100`. The register entry has the calls.

### A partial redemption on the first Trove is price fragile, and `redeem()` refuses it by default (MK-103)

**A partial is priced twice.** The hint is computed at the price it was read at, and
`_redeemCollateralFromTrove` recomputes the Trove's resulting NICR at the price when the transaction
MINES (`TroveManager.sol:1224-1230`, `:1287-1290`). It cancels the partial unless the hint lies in
`[newNICR, upperBoundNICR]` (`:1299-1306`), and the upper bound differs from `newNICR` only by 600
seconds of interest at the global rate on the Trove's principal (`:1276-1285`): a relative width of
about 1.9e-7 at a 1% rate. A price rise draws less collateral and lifts `newNICR` over the hint; a
fall lowers the upper bound under it. A cancel on the FIRST Trove drawn reverts the whole call
(`:392`, `:406-408`); a cancel on a later Trove just redeems less.

**What the SDK does.** It sends the CENTRE of the band as the hint, where `getRedemptionHints` returns
its lower edge (`HintHelpers.sol:143-160`), which tolerated no rise at all. And it reports the band:

```ts
const p = await musd.previewRedeem({ redeemer, amount });
p.partial?.revertsCallIfCancelled; // true when the partial is on the first Trove drawn
p.partial?.priceToleranceUp;       // the largest rise it survives, a 1e18 fraction of the price
p.partial?.priceToleranceDown;     // the largest fall it survives
p.partial?.priceFragile;           // either tolerance under REDEMPTION_PRICE_MOVE_TOLERANCE (5 bps)
```

**Measured, so the scale is not a matter of opinion.** On a fork, a partial of 4.23 MUSD against a
Trove with 1808 MUSD of net debt reported tolerances of 0.504 bps each way. Sent with the centred
hint, it succeeded at half the reported tolerance in each direction and reverted at twice it; the
helper's lower edge hint reverted on the same half tolerance rise (`redeem-boundary.fork.test.ts`).
Mezo mainnet's price moved more than 2.26 bps within one block at the 99th percentile over 2000
blocks (`scripts/oracle-moves.ts`). The tolerance scales with `collateral left / collateral drawn`,
so a first Trove partial large enough to be worth sending does not survive an ordinary block.

**So `redeem()` refuses a first Trove partial that is price fragile**, with
`RedemptionPriceFragile`, before gas, carrying both tolerances and `nextViableAmount`. Redeem
`nextViableAmount` or more instead, which consumes the first Trove whole and has no price condition,
or pass `acceptPriceFragilePartial: true` to send it anyway. Retrying a fragile partial is not a
mitigation: each attempt meets a fresh price move and a failed one spends gas. This replaces the
retry advice MK-049 gave here.

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

**Nine of the twelve exposed writes have a preview** (MK-061). Counted from `createMusdClient`'s
own surface rather than from an earlier revision of this table, which carried "ten of eleven" and
could not be reconstructed from the tree. The three without one are in the last three rows.

| Write | Preview | Prechecked before simulate | Gates the contract enforces |
|---|---|---|---|
| `openTrove` | **`previewOpen`** | amounts, fee cap, floor, ratios | not active `:633`; `minNetDebt` `:645`; recovery ICR>=CCR `:655`; normal ICR>=MCR `:657`, TCR>=CCR `:665` |
| `addCollateral` | **`previewAdjustTrove`** | **all of them** | active `:790`; **normal** ICR>=MCR `:1201`, TCR>=CCR `:1209`; **recovery: none** |
| `borrow` | **`previewBorrow`**, which since MK-058 IS `previewAdjustTrove` with a debt increase | **all of them** | active; **normal** ICR>=MCR, TCR>=CCR; **recovery** ICR>=CCR `:1272`, newICR>=oldICR `:1273`, **and no TCR gate**; capacity `:851` |
| `repay` | **`previewAdjustTrove`** | **all of them** | active; **normal** ICR>=MCR, TCR>=CCR; **recovery: none**; `minNetDebt` `:856`; repay <= debt-200 `:859`; balance `:860` |
| `withdrawCollateral` | **`previewWithdrawCollateral`**, **`maxWithdrawableCollateral`** | **all of them** | active; `assert(amt <= coll)` `:837`; **recovery: no withdrawal at all** `:1270`; **normal** ICR>=MCR, TCR>=CCR |
| `adjustTrove` | **`previewAdjustTrove`** | **all of them** | every row above, by combination; singular coll change `:788` |
| `close` | **`previewClose`** | **all of them** | active `:951`; *if `canMint`* not recovery `:954`; balance >= debt-200 `:963`; *if `canMint`* TCR>=CCR `:972` |
| `refinance` | **`previewRefinance`** | Trove active, Recovery Mode | not recovery `:1023`; active `:1024`; ICR>=MCR **after the fee** `:1058`; TCR>=CCR `:1059` |
| `claim` | **`getClaimableCollateral`** reads the one input | matches one revert, rethrows the rest | a surplus to claim: `CollSurplusPool.claimColl` requires one (`CollSurplusPool.sol:90-93`). This row said "none" until MK-246 |
| `redeem` | **`previewRedeem`** | positive, MUSD balance, rate cap, **the debt floor gap and the last Trove** | `TroveManager.sol`: TCR>=MCR `:318`; amount>0 `:319`; balance `:320`; a partial that would leave a Trove under `minNetDebt` `:1299-1306`; a whole consumption of the last Trove `:1397-1399`, `:1488-1496` (MK-245) |
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

**Every withdrawal preview reports the capacity it leaves** (MK-242). `_adjustTrove` stores
`min(current, collateral * price / 1.1)` when collateral decreases (`:879-899`) and never raises it when
collateral is added (`:880`), so a withdrawal during a price fall can cut every later borrow, and depositing
the same BTC again does not undo it. `previewAdjustTrove`, `previewWithdrawCollateral` and
`maxWithdrawableCollateral` return `capacityAfter: { current, resulting, lost, restoredByAddingCollateral:
false, recovery }`, where `recovery` is a refinance projected through `evaluateRefinance` on the resulting
state: its fee, the rate the Trove would move to, the capacity it would write, and whether it is allowed
now. Proven by sending in `zz-capacity-ratchet.fork.test.ts`: the chain stored the previewed capacity to
the wei, a refinance wrote the projected capacity to the wei and charged the projected fee within accrual,
and re-adding the collateral left the capacity where the withdrawal put it.

**`adjustTrove`'s legs are read by value** (MK-244). A zero leg is no leg: `{ addCollateral: 0n,
withdrawCollateral: x }` is a withdrawal and is sent as one, and `{ borrow: 0n, addCollateral: x }` is a
top up. Both collateral legs non zero, or both debt legs non zero, are refused before any read, from the
same helper the preview reports them from. Until 0.5.0 the write path refused zero valued legs by
presence, while the preview judged the same input viable and the contract accepted it.

**One gate, one error** (MK-243). The individual ratio gate throws `ICRBelowMCR` whether the precheck or
the revert decoder reaches it, with the resulting ratio on its context when the precheck does; its
Recovery Mode counterpart throws `RecoveryModeRestriction`. `InsufficientCollateral` now names only a
withdrawal larger than the collateral. And the capacity gate is reported after the ratio gates, as
`_adjustTrove` checks them (`:840-845` before `:850-852`).

**3. A plain `borrow` can never succeed in Recovery Mode.** `withdrawMUSD` sends no collateral, so
`newICR < oldICR` always and `_requireNewICRisAboveOldICR` (`:1273`) cannot be satisfied at any draw
size. Only `adjustTrove` with a collateral leg can clear it. `previewBorrow` and `previewAdjustTrove`
both report `ICR_NOT_IMPROVED_IN_RECOVERY_MODE` rather than sending you to hunt for a smaller draw.

**4. Recovery Mode refuses collateral withdrawal outright, not by amount.** `_requireNoCollWithdrawal`
(`:1270`) permits zero, so no smaller number works. `maxWithdrawableCollateral` returns
`{ amount: 0n, limitedBy: 'RECOVERY_MODE' }`, which is a different message to a user than a ratio.

**5. Two of `close`'s five gates are conditional on a live chain read.** `canMint` is
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
//  01-ground-truth §8), and resolves on the receipt with what settled (MK-241).
await musd.redeem({ amount: parseMusd('1000'), maxIterations: 10n }); // 0n is no limit, as on chain (MK-114)

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
await musd.getOraclePrice();     // BTC/USD from PriceFeed.fetchPrice()
```

There is no `getPeg`. Mezo exposes no MUSD/USD oracle, so a peg read would be a guess, and it is
deliberately not implemented (`packages/core/src/read/system.ts`). This page showed a `getPeg()` call
until MK-109.

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
