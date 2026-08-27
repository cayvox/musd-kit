# Migration, 0.1.0 to 0.2.0

**Read this if you have 0.1.0 in production.** 0.1.0 returned wrong numbers on seven surfaces and
could send transactions that revert. Three of those were wrong in ways nothing in your code would
have noticed.

Every claim on this page cites a finding ID in [`FINDINGS.md`](../FINDINGS.md) and, where it is a
protocol fact, a file and line in `mezo-org/musd`.

**How the breaking changes on this page were enumerated**, so you can check the list is complete
rather than trusting it: the published `@musd-kit/core@0.1.0` and `@musd-kit/react@0.1.0` tarballs
were downloaded from npm, their `dist/index.d.ts` was diffed against the 0.2.0 build, and every
removed declaration and removed property was traced back to the finding that removed it. The
register was then walked for fixes that change a returned VALUE without changing a type, because a
type diff cannot see those and they are the dangerous ones. Nothing here comes from memory.

---

## At a glance

| Change | Kind | Finding | Your code breaks how |
|---|---|---|---|
| `OpenPreview.meetsRecoveryRequirement` removed | type | MK-005 | compile error |
| `RedeemResult.fee` removed | type | MK-014 | compile error |
| `WriteResult.gas` and `RedeemResult.gas` added, required | type | MK-037 | compile error **only if you construct these types**, for example in a test double |
| `isLiquidatable` no longer applies a Recovery Mode rule | **behaviour** | MK-001 | **silently different answer** |
| Borrowing fee now models Recovery Mode and fee exemption | **behaviour** | MK-004, MK-018 | **silently different number** |
| Refinancing fee now modeled at all | **behaviour** | MK-003 | **silently different number** |
| `borrow` and `adjustTrove` precheck borrowing capacity | **behaviour** | MK-002 | a throw where you previously got a revert |
| Writes carry a 25% gas margin | **behaviour** | MK-035 | a higher balance requirement |
| Constants re-read on a TTL rather than cached forever | behaviour | MK-012 | none, unless you relied on staleness |
| Hints computed from principal, not entire debt | behaviour | MK-006 | none, hints get better |
| Price read inside the multicall | behaviour | MK-013 | none, values get consistent |

**Nothing was removed from the exported surface**: no function, class, constant or type disappeared
between 0.1.0 and 0.2.0. The type level breaks are all property level, and they are all on results
rather than on parameters, so nothing you PASS needs to change.

---

## 1. `isLiquidatable` no longer invents a Recovery Mode rule (MK-001)

**What 0.1.0 got wrong.** It returned `icr < (isRecoveryMode ? CCR : MCR)`, so in Recovery Mode every
Trove between MCR and CCR was reported liquidatable. **MUSD is a Liquity fork that REMOVED stock
Liquity's Recovery Mode liquidation branch.** The only gate in the liquidation path is `ICR < MCR`
(`TroveManager.sol`, the `if (vars.ICR < MCR)` branch around line 1148, and there is no reference to
`CCR` anywhere in that path).

The same repository disagreed with itself: `getTrove` already used the correct `icr < MCR`, so the
same question got two answers depending on which API you reached for.

**Nothing in your code changes. The answer does.** This is the one to check by hand.

```ts
// 0.1.0 and 0.2.0: identical call, different answer in Recovery Mode
const { isLiquidatable } = await musd.getSystemState /* ... */;
```

If you built a keeper on it, 0.1.0 sent you at liquidations that always reverted. If you showed it to
position holders, you told people between MCR and CCR that they were about to be liquidated when they
were not.

**What to do.** Nothing, mechanically. Re-check any alerting thresholds or keeper filters you tuned
against 0.1.0's output, because you may have tuned them around the false positives.

---

## 2. `redeem()` no longer returns a rate in a field named `fee` (MK-014)

**What 0.1.0 got wrong.** `RedeemResult.fee` held the redemption RATE, a 1e18 scaled fraction, under
a name that reads as an amount. A caller who treated it as an amount of MUSD or of BTC was off by
whatever the price happened to be, in a field they had no reason to doubt.

```ts
// 0.1.0
const { hash, truncatedAmount, fee } = await musd.redeem({ amount });
//                                     ^^^ a RATE, despite the name
```

```ts
// 0.2.0: three fields, each named for what it is
const {
  hash,
  truncatedAmount,
  redemptionRate,           // the rate, 1e18 scaled. This is what `fee` used to hold
  estimatedFeeCollateral,   // the fee AMOUNT, in BTC wei
  estimatedCollateralDrawn, // what that estimate was computed against
  gas,                      // see section 4
} = await musd.redeem({ amount });
```

`estimatedFeeCollateral` is an ESTIMATE and says so in its name: the collateral actually drawn is only
known once the redemption mines. The authoritative figure is `collateralFee` on the `Redemption`
event.

---

## 3. `previewOpen` returns a verdict instead of a vacuous flag (MK-005)

**What 0.1.0 got wrong.** `meetsRecoveryRequirement` was `true` for every normal mode open, so it
carried no information, and **nothing anywhere checked the resulting TCR against CCR**. An open that
would drop the system below CCR previewed as fine and then reverted.

```ts
// 0.1.0
const p = await musd.previewOpen({ collateral, debt });
if (p.meetsMinimum && p.meetsRecoveryRequirement) enableButton();
//                    ^^^ always true in normal mode
```

```ts
// 0.2.0
const p = await musd.previewOpen({ collateral, debt });
if (p.viable) enableButton();
else showReasons(p.reasons, p.bindingConstraint);
```

`OpenPreview` keeps `fee`, `netDebt`, `entireDebt`, `icr`, `liquidationPrice`, `meetsMinimum` and
`isRecoveryMode` unchanged, and adds `viable`, `reasons`, `bindingConstraint`, `feeExempt`,
`icrThreshold` and `resultingTcr`.

`bindingConstraint` is the one to render: with several reasons, it names the one actually stopping
the user, so you can tell them what to change rather than listing everything that is true.

---

## 4. Every write result says how its gas limit was chosen (MK-035, MK-037)

**What 0.1.0 got wrong.** It sent the simulation's own request object unchanged, which carries no
`gas`, so viem estimated internally and sent whatever came back. A traced `redeemCollateral` grew
16% between the estimate and the mining block and ran out of gas inside `ActivePool` at call depth 4.
The receipt showed `gasUsed < gasLimit`, because the EVM forwards at most 63/64 of remaining gas to a
nested call, **so it did not even look like out of gas.**

0.2.0 sends an explicit limit at **25% over the estimate**, and tells you whether it managed to.

```ts
// 0.2.0
const result = await musd.openTrove({ collateral, debt });
if (result.gas.source === 'fallback') {
  // estimation failed; THIS send went out with no margin, which is 0.1.0 behaviour.
  // result.gas.error is the typed MusdError explaining why.
}
```

**What it costs you.** Nothing in fees, unused gas is refunded exactly. The real cost is that the
account must hold `gasLimit * gasPrice + value` **up front**, so a 25% larger limit means 25% more
native balance sitting unspent. Wallets will show a larger maximum, which is not the charge.
`createMusdClient({ gasMarginPercent: 0 })` restores 0.1.0 behaviour, which is the behaviour that
produced the reverts.

**This is a compile error only if you CONSTRUCT a `WriteResult` or `RedeemResult`**, for example in a
test double. Reading one is unaffected.

```ts
// a 0.1.0 test double stops compiling
const fake: WriteResult = { hash: '0x...' };
// 0.2.0
const fake: WriteResult = { hash: '0x...', gas: { source: 'explicit', limit: 500_000n } };
```

---

## 5. Borrowing capacity is modeled, and prechecked (MK-002)

**What 0.1.0 got wrong.** `maxBorrowingCapacity` was not modeled anywhere, so a borrow past the cap
reached the chain and reverted, with nothing to inspect first.

```ts
// 0.2.0
const { capacity } = await musd.getBorrowingCapacity(owner);
const preview = await musd.previewBorrow({ owner, amount });
if (!preview.viable) showReasons(preview.reasons);
```

**Behaviour change to expect:** `borrow` and `adjustTrove` now throw `ExceedsBorrowingCapacity`
BEFORE sending, where 0.1.0 sent the transaction and let it revert. If you catch reverts from the
receipt, you now need to catch a throw from the call instead.

**A protocol property worth knowing, because it surprises people:** capacity is recomputed only when
collateral DECREASES, and stored as `min(current, recalculated)`, so it **ratchets downward and never
rises**. A price rise does not raise it. It is fixed at the price your Trove opened at.

---

## 6. Fees now model Recovery Mode, exemption, and refinancing (MK-003, MK-004, MK-018)

Three separate fee bugs, all producing quotes that were simply wrong.

- **Recovery Mode (MK-004).** The protocol charges no borrowing fee in Recovery Mode. 0.1.0 charged
  one in its quotes.
- **Fee exemption (MK-018).** The protocol charges no borrowing fee to a fee exempt account, on the
  open path AND on the debt increase path. 0.1.0 modeled neither. **Two accounts are fee exempt on
  mainnet** as of the block recorded in `docs/09-review-and-validated-surface.md` §6, so this is not
  hypothetical. `previewOpen.feeExempt` now reports it.
- **Refinancing (MK-003).** The refinancing fee was not modeled at all, so a refinance quote was
  short by the entire fee. `previewRefinance` now exists and reports it.

No code change is required for any of the three. The numbers change.

---

## 7. Smaller behaviour changes, no action needed

- **Governable constants re-read on a TTL (MK-012).** 0.1.0 cached `minNetDebt` and the interest rate
  for the life of the client object. Both are governable and could be arbitrarily stale.
- **Price read inside the multicall (MK-013).** In 0.1.0 `icr` and `price` in one result could come
  from different blocks. `getTrove`, `getSystemState` and `isLiquidatable` now take a single block
  snapshot. The preview family still reads the price separately and makes no single block claim.
- **Hints from principal, not entire debt (MK-006).** 0.1.0 fed entire debt to the NICR used for
  insertion hints, so hints were wrong once any interest existed, and repay ignored the interest
  first ordering.
- **`claim()` no longer swallows every error (MK-007).** 0.1.0 wrapped simulate and send in a bare
  `catch {}`, so a failed claim was indistinguishable from nothing to claim. It now matches exactly
  one revert, "no collateral available to claim", and rethrows everything else typed.
- **`verifyDeployment()` gates every write (MK-008).** In 0.1.0 it ran only from `getConstants()`, so
  any write that did not happen to read a constant went unverified against a possible lookalike
  contract. One memoized multicall per client.
- **Address overrides are validated (MK-009).**
- **`getBorrowingPower` no longer does unbounded RPC iteration (MK-010).** Roughly 77 sequential
  calls became about four.

---

## If you cannot upgrade immediately

Judge your exposure by which of these you actually touch. **The first group is the dangerous one**,
because nothing fails: you get a number, it is wrong, and your code has no way to tell.

### 0.1.0 behaviours that produce WRONG NUMBERS, silently

| Surface | What you get on 0.1.0 | Finding |
|---|---|---|
| `isLiquidatable`, in Recovery Mode | `true` for every Trove between MCR and CCR. This protocol cannot liquidate those | MK-001 |
| `redeem().fee` | the redemption RATE, 1e18 scaled, not an amount of anything | MK-014 |
| any refinance quote | short by the entire refinancing fee | MK-003 |
| any borrowing fee quote, in Recovery Mode | too high; the protocol charges none | MK-004 |
| any borrowing fee quote, for a fee exempt account | too high; the protocol charges none. Two such accounts exist on mainnet | MK-018 |
| `previewOpen.meetsRecoveryRequirement` | `true` always, in normal mode. It never meant anything | MK-005 |
| `icr` against `price` in the same result | possibly from different blocks | MK-013 |
| `minNetDebt`, interest rate | possibly stale by the age of your client object | MK-012 |

**If you use `redeem().fee` or `isLiquidatable` in Recovery Mode, treat upgrading as urgent.** Those
two are wrong in ways that reach a user as money or as a false alarm.

**Interim mitigation without upgrading**, if you must: read `redemptionRate()` and
`getRedemptionRate(collateralDrawn)` from `BorrowerOperations` yourself rather than using
`result.fee`, and compare `icr` against `MCR` yourself rather than calling `isLiquidatable`. Both are
a few lines. Everything else in this table needs the fix.

### 0.1.0 behaviours that produce FAILED TRANSACTIONS

These cost gas and annoy users, and they are loud, so you already know if they are happening.

| Surface | What happens on 0.1.0 | Finding |
|---|---|---|
| any write, under load | can run out of gas after a passing simulation, and the receipt does not look like out of gas | MK-035, MK-037 |
| `borrow` past the capacity cap | reaches the chain and reverts, with nothing to check first | MK-002 |
| `refinance()` in Recovery Mode | reverts, undocumented and unchecked | MK-019 |
| `claim()` when anything is wrong | returns as though there was nothing to claim | MK-007 |
| any write, against a lookalike deployment | sends unverified | MK-008 |
| an open that would drop TCR below CCR | previews as fine, then reverts | MK-005 |

### What 0.2.0 does NOT fix

Both are documented rather than fixed, and both are in the register.

- **`maxFeePercentage` is advisory only (MK-011).** It is checked in the SDK, it does not bind the
  contract. Do not treat it as slippage protection.
- **`addCollateral`, `repay`, `withdrawCollateral` and `adjustTrove` have no preview (MK-038).** And
  the first two ARE gated by the contract, which this repository documented incorrectly until
  MK-038: in normal mode `_requireICRisAboveMCR` (`BorrowerOperations.sol:1201`, defined at
  `:1330-1335`) tests the RESULTING ICR absolutely, not the direction of the change, so **a
  position already under MCR cannot be rescued by a partial top-up.** The ICR rises and the call
  still reverts. Compute the resulting ratio yourself from `getTrove` plus `computeICR` and compare
  it against `MCR`.
