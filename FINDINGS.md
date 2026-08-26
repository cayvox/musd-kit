# Findings register

This file is the public, per finding record of every known correctness gap in `musd-kit`,
the ground truth it was checked against, and what we decided to do about it.

**Origin.** In addition to our own fork harness, the Mezo team performed an external review of
`musd-kit` 0.1.0 as a three way differential: the SDK against the `mezo-org/musd` Solidity
protocol, and the SDK against Mezo's own production dApp. We are grateful for that work. This
register is our response to it. It also carries findings we located ourselves while remediating.
We do not reproduce the reviewers' document or cite non public source paths here; every claim
below is restated in our own words and re-verified against public sources.

**Ground truth.** `mezo-org/musd` Solidity contracts at the revision matching the deployed
implementations, plus live reads recorded in `docs/09-review-and-validated-surface.md`.
Contract line numbers below were verified against the public repository at remediation time and
may drift as upstream changes; the quoted rule, not the line number, is the anchor.

**Stable IDs.** IDs are permanent. Tests and commits cite them (`MK-001`). An ID is never reused
or renumbered, even after the finding is closed.

## Severity classes

| Class | Meaning |
|---|---|
| **S1** | Silently wrong number. The caller or bot acts on a plausible false figure and no error is ever raised. |
| **S2** | Avoidable failed transaction, or a control that is weaker than advertised. Loud, or needs a second failure to matter. |
| **S3** | Hygiene, duplication, and documentation claims. Harmless to funds, corrosive to the correctness claim. |

## Status legend

`open` · `test-written` (a failing test pins the current wrong behavior) · `fixed` ·
`documented-limit` (accepted and stated in the docs) · `claim-corrected` (the code was right, the
claim about it was not).

## Summary

| ID | Title | Class | Status |
|---|---|---|---|
| MK-001 | `isLiquidatable` applies a Recovery Mode rule the protocol does not have | S1 | fixed |
| MK-002 | `maxBorrowingCapacity` is not modeled anywhere in the SDK | S1 | fixed |
| MK-003 | Refinancing fee is not modeled | S1 | fixed |
| MK-004 | Recovery Mode borrowing fee skip is not modeled | S1 | fixed |
| MK-005 | `previewOpen.meetsRecoveryRequirement` is vacuous in normal mode, and no TCR check | S1 | fixed |
| MK-006 | Hint NICR is fed entire debt, and repay ignores interest first ordering | S2 | fixed |
| MK-007 | `claim()` swallows every error | S2 | fixed |
| MK-008 | `verifyDeployment()` is weak and off the critical path | S2 | open |
| MK-009 | Address overrides accept any string | S2 | fixed |
| MK-010 | `getBorrowingPower` performs unbounded RPC iteration | S2 | open |
| MK-011 | `maxFeePercentage` is advisory only | S2 | open |
| MK-012 | Governable constants are cached for the client lifetime | S2 | open |
| MK-013 | Price is read outside the multicall, so price and ICR can straddle blocks | S2 | open |
| MK-014 | `redeem` returns a rate in a field named `fee` | S1 | fixed |
| MK-015 | Documentation claims that overstate reality | S3 | open |
| MK-016 | Test suite is one stateful sequence with unpinned fork and flake mitigations | S3 | open |
| MK-017 | Duplicated derivations and placeholder values | S3 | open |
| MK-018 | Fee exemption is not modeled | S1 | fixed |
| MK-019 | `refinance()` reverts in Recovery Mode, which the SDK neither checks nor documents | S2 | fixed |
| MK-020 | Oracle shim seed is not pinned, so a pinned fork block is not a pinned price | S3 | fixed |
| MK-021 | Phase 3 warm up hook exceeds its fixed budget on a cold fork, skipping the whole file | S3 | fixed |
| MK-022 | `batchLiquidate` phase 6 test intermittently leaves one Trove unliquidated | S3 | open |
| MK-023 | Phase 6 `claim` fixture intermittently leaves the target Trove unredeemed | S3 | open |
| MK-024 | Phase 6 normal mode liquidation intermittently crashes on a missing event | S3 | open |
| MK-025 | React block watching test intermittently sends a write that reverts | S3 | open |
| MK-026 | Phase 5 lifecycle writes fail only under the coverage run, never under a plain fork run | S3 | open |
| MK-027 | Source files sit outside every typecheck and lint configuration | S3 | open |
| MK-028 | The DOM test environment pairs jsdom's `AbortSignal` with Node's `Request`, which Node 24 rejects | S2 | fixed |
| MK-029 | Local evidence and CI evidence were both true, because they ran different runtimes | S2 | fixed |

---

## MK-001 · `isLiquidatable` applies a Recovery Mode rule the protocol does not have

**Class** S1 · **Status** fixed

**Ground truth.** `TroveManager.sol` contains no reference to `CCR` in any liquidation path. The
only gate is `ICR < MCR`, inside the batch liquidation loop (`TroveManager.sol`, the
`if (vars.ICR < MCR)` branch around line 1148). `liquidate(address)` builds a one element array
and calls `batchLiquidateTroves`, which reverts with `TroveManager: nothing to liquidate` when the
loop liquidates nothing. This fork removed stock Liquity's Recovery Mode liquidation branch.

**Reference behavior.** Mezo's production dApp does not treat Recovery Mode as widening
liquidatability.

**SDK location.** `packages/core/src/read/system.ts:51`,
`return icr < (isRecoveryMode ? CCR : MCR)`. The docstring at `read/system.ts:26-31` asserts the
behavior was verified. `packages/core/src/read/getTrove.ts:79` uses the correct `icr < MCR`, so the
same predicate answers differently depending on which API the caller reaches for.

**Why this is the worst one.** A passing test enshrines the wrong rule.
`packages/core/test/phase6.fork.test.ts` asserts `isLiquidatable(B) === true` for a trove with
`MCR <= ICR < CCR`, defends it in a comment with an ICR versus TCR plus Stability Pool cover rule
that does not exist in this fork, and then liquidates a different trove, the under MCR one. The
test never exercises its own claim. The normal review reflex, trust the tested path, actively
misleads here.

**Blast radius.** `isLiquidatable`, and the keeper example built on it. In Recovery Mode every
trove between MCR and CCR is reported liquidatable and every liquidation attempt against one of
them reverts. Wasted gas for keepers, false alarms for position holders.

**Reproduction.** Drive the fork into Recovery Mode, build a trove with `MCR <= ICR < CCR`, assert
that `liquidate()` on it reverts while `isLiquidatable()` returns `true`.

**Decision.** Fix now. Remove the Recovery Mode branch, correct the docstring, invert the phase 6
assertion into a regression test that pins the revert. Breaking behavior change, shipped in 0.2.0
with a migration note.


**Fixed in the P3a wave.** `read/system.ts` now applies a single `icr < MCR` with no mode
branch, and the docstring that claimed the Recovery Mode behavior was verified is corrected to
state the rule and cite `TroveManager.sol:1148`. The phase 6 assertion that enshrined the wrong
rule is inverted and the comment inventing an "ICR versus TCR plus Stability Pool cover" rule is
deleted rather than reworded. A regression test pins that the two read paths,
`isLiquidatable(address)` and `getTrove().isLiquidatable`, agree across the whole band in both
modes, because two APIs disagreeing about one question was the underlying defect. Breaking
behavior change for anyone who consumed the old verdict.
---

## MK-002 · `maxBorrowingCapacity` is not modeled anywhere in the SDK

**Class** S1 · **Status** fixed

**Ground truth.** Every trove carries a `maxBorrowingCapacity`, set at open from the opening price
as `coll * price / (110 * 1e16)` (`BorrowerOperations.sol`, `_calculateMaxBorrowingCapacity`, called
from `openTrove`). It is ratcheted only downward, on collateral decrease, as
`min(current, recalculated)`. Every debt increase is gated by
`maxBorrowingCapacity >= netDebtChange + getTroveDebt(borrower)`, where `netDebtChange` is the draw
plus the borrowing fee, and `getTroveDebt` is current to the block because `_adjustTrove` calls
`updateSystemAndTroveInterest` first. Capacity does not rise when the collateral price rises.

**Reference behavior.** Mezo's production dApp reads the on chain capacity, computes remaining
capacity as capacity minus current debt, gates the borrow on draw plus fee against that remainder,
and routes an over capacity borrow into a refinance first. Their code treats capacity as the hard
gate.

**SDK location.** `packages/core/src/math/getBorrowingPower.ts` solves only the ICR constraint and
never reads `getTroveMaxBorrowingCapacity`. `packages/core/src/trove/index.ts`, `borrow()` has no
capacity precheck. The string `maxBorrowingCapacity` appears in the SDK only inside the generated
ABI.

**Nuance we want to be precise about.** `getBorrowingPower` is documented as an open time
calculator, and at open the capacity is set from the same inputs, so on its documented use it does
not produce a capacity driven wrong number. The finding stands regardless: the concept is absent
from the SDK, `borrow()` has no precheck, the React hook name invites use against an existing
trove, and a seasoned trove after a price rise is the common case, not an edge case.

**Blast radius.** Any integrator sizing a borrow against an existing trove. Failed transactions and
a borrowing figure the contract rejects.

**Decision.** Fix now. Add capacity reads and a preview for existing troves, add a precheck to
`borrow()`, and state in the docs that capacity is fixed at the opening price and never rises.


**Fixed in the P3a wave.** Capacity is now a first class concept: `getBorrowingCapacity(owner)`
returns the on-chain capacity, the live entire debt and the remaining headroom;
`previewBorrow({ owner, amount })` returns a verdict, a machine readable reason list and the
binding constraint, covering the capacity gate, the resulting ICR against the mode correct
threshold and the resulting system TCR; `borrow()` and the debt increase path of `adjustTrove()`
precheck the gate and throw the typed `ExceedsBorrowingCapacity` with the real numbers before
simulate. React gains `useBorrowPreview` and `useBorrowingCapacity`. `getBorrowingPower` stays
the open time calculator and now says so, including that capacity is fixed at the opening price
and never rises; it also now enforces the resulting system TCR, which the contract requires on
every normal mode open and which it previously ignored. The precheck compares against the LIVE
entire debt, not the stored `getTroveDebt`, because `_adjustTrove` updates interest first
(`BorrowerOperations.sol:769`) and the gate therefore sees accrued interest.

**Not witnessed, and therefore owed.** The downward ratchet is reasoned from
`BorrowerOperations.sol:879-897` and is NOT observed executing on chain: no test performs a
collateral withdrawal and watches `min(current, recalculated)` take the lower branch. The tests pin
only that capacity does not RISE with price, which is the half the reported defect turned on.
Reaching the ratchet is on the differential harness coverage list in
`docs/09-review-and-validated-surface.md` §3, so the harness is built to exercise it rather than
pointed at it afterwards.
---

## MK-003 · Refinancing fee is not modeled

**Class** S1 · **Status** fixed

**Ground truth.** On refinance the contract charges
`fee = borrowingRate applied to (refinancingFeePercentage / 100) * (getTroveDebt - 200e18)`, adds it
to principal so it begins accruing interest, and skips it entirely for fee exempt accounts
(`BorrowerOperations.sol`, the refinance path). `refinancingFeePercentage` is a governable
`uint8`, initialized to 20.

**SDK location.** `packages/core/src/trove/index.ts:274-284`. The SDK never reads
`refinancingFeePercentage()`, and computes hints from the pre fee debt.

**Reference behavior.** Mezo's production dApp models the refinancing fee and folds it into its
NICR computation.

**Blast radius.** `refinance()` and any UI that shows a post refinance debt. The number is wrong by
the fee, and the hint is computed for a position that will not exist.

**Decision.** Fix now: read the governable percentage, add a `previewRefinance`, and fold the fee
into the hint. If it cannot be shipped correctly, remove `refinance()` from the public surface
rather than ship wrong numbers.


**Fixed in the P3b wave.** `previewRefinance(owner)` returns the fee, the fee base, the live
governable percentage, the resulting principal, entire debt, ICR and TCR, and a verdict with
machine readable reasons. `refinancingFeePercentage` is READ on every call rather than hardcoded,
because it is governable. `refinance()` folds the fee into the hint, so the hint describes the
position that will exist: combined with MK-006 the hint is principal based and fee inclusive,
matching what `BorrowerOperations.sol:1087-1088` re-inserts with. The function was NOT removed from
the public surface: the numbers can be produced correctly, so the fallback of shipping less surface
did not apply.
---

## MK-004 · Recovery Mode borrowing fee skip is not modeled

**Class** S1 · **Status** fixed

**Ground truth.** On open, the borrowing fee is charged only when the system is not in Recovery
Mode and the account is not fee exempt. In Recovery Mode `netDebt` equals the requested draw with
no fee added. The same skip applies to a debt increase in `_adjustTrove`.

**SDK location.** `packages/core/src/math/previewOpen.ts` applies `getBorrowingFee(debt)`
unconditionally while separately reporting `isRecoveryMode` in the same result.

**Second order effect we found while remediating.** Because the SDK adds a fee the contract will
not charge, `meetsMinimum` is also computed against the wrong quantity. In the band where
`debt < minNetDebt <= debt + fee`, the SDK reports the minimum as met for an open the contract
rejects. So this is not only an overstatement, it can be optimistic in the direction that produces
a failed transaction.

**Reference behavior.** Mezo's production dApp shares this gap. This is a divergence from the
protocol, not from Mezo's practice, which materially reduces how damning it is.

**Blast radius.** Every preview taken while the system is stressed, exactly when accuracy matters
most.

**Decision.** Fix now, and record in the divergence matrix that the gap is shared.


**Fixed in the P3a wave.** `previewOpen` charges the fee only when the contract does, that is
when not in Recovery Mode and the account is not fee exempt. The second order effect is closed
with it: because the floor is checked against `netDebt`, removing the phantom fee removes the
band `draw < minNetDebt <= draw + fee` where the preview reported the floor met for an open that
reverts. The findings test that pins that band is kept and now passes.
---

## MK-005 · `previewOpen.meetsRecoveryRequirement` is vacuous in normal mode, and no TCR check

**Class** S1 · **Status** fixed

**Ground truth.** `openTrove` requires, in Recovery Mode, `ICR >= CCR`; and in normal mode, both
`ICR >= MCR` and a resulting system TCR at or above CCR.

**SDK location.** `packages/core/src/math/previewOpen.ts:82`,
`meetsRecoveryRequirement: !isRecoveryMode || icr >= CCR`. In normal mode this is unconditionally
`true`. The preview never checks `ICR >= MCR` and never projects the resulting TCR.

**Blast radius.** A preview can report every requirement met for an open that reverts. This is the
bug class the current test shape cannot catch, because the tests never compare a preview verdict
against an actual attempt.

**Decision.** Fix now. Replace the flag with an explicit verdict plus reasons, covering the debt
floor, the mode correct ICR threshold, and the projected TCR.


**Fixed in the P3a wave.** `meetsRecoveryRequirement` is REMOVED, a breaking change, and
replaced by `viable` plus a machine readable `reasons` list and `bindingConstraint`. The verdict
covers the debt floor, the mode correct ICR threshold (`CCR` in Recovery Mode, `MCR` in normal
mode) and, in normal mode only, the projected system TCR, which the contract enforces on every
normal mode open and which the SDK never projected. The migration note is in
`docs/03-core-api.md`.
---

## MK-006 · Hint NICR is fed entire debt, and repay ignores interest first ordering

**Class** S2 · **Status** fixed

**Ground truth.** `TroveManager.getNominalICR` uses collateral plus pending collateral against
principal plus pending principal, with no interest. Every on chain re insert passes a principal
only NICR. Separately, `InterestRateMath.calculateDebtAdjustment` applies a payment to interest
first: a payment at or below interest owed reduces principal by zero.

**SDK location.** `packages/core/src/trove/index.ts`, `hintsFor` is called with entire debt
(principal plus interest) on `addCollateral`, `borrow`, `repay`, `withdrawCollateral`,
`adjustTrove`, and `refinance`. `repay` models debt as falling by the full payment.

**Reference behavior.** Mezo's production dApp models the interest first split correctly.

**Why it survived.** `openTrove` is accidentally correct, because interest owed is zero at open.
The dual validation gate covers only the open path, so it could never catch this.

**Blast radius.** Gas and latency, not funds. `SortedTroves.reInsert` re validates and traverses,
so a bad hint degrades to a linear scan and, in the worst case, out of gas. The repay projection is
a wrong number shown to the user, which is why this finding sits at the top of S2.

**Decision.** Fix now: principal based hints on every existing trove write, and an interest first
repay projection mirroring the contract helper.


**Fixed in the P3b wave.** Every hint is computed from PRINCIPAL. All seven hint call sites in
`packages/core/src/trove/index.ts` were enumerated from source and corrected: `addCollateral`,
`borrow`, `repay`, `withdrawCollateral`, `adjustTrove` and `refinance`; `openTrove` was already
correct and `close` computes no hint because it removes the node. `hintsFor`'s parameter is renamed
`principal` so the wrong quantity cannot be passed by habit. The repay projection mirrors
`InterestRateMath.calculateDebtAdjustment` exactly through the exported
`principalReductionForRepay`, and is pinned on a fork at three payment sizes against the contract's
own branch boundary: below, exactly equal to, and above interest owed.

**Why the open path was accidentally correct.** At open there is no accrued interest, so the
composite debt IS the principal. The dual validation gate covered the open path only, so it compared
a quantity that happens to be right there and never exercised a path where interest exists. A gate
that only covers the case where two quantities coincide cannot tell you which one you meant. That is
the reason this survived into a published release, and it is why the differential harness must cover
existing trove paths, not only opens.
---

## MK-007 · `claim()` swallows every error

**Class** S2 · **Status** open

**Ground truth for our own policy.** `packages/core/src/errors/mapRevert.ts` states that a revert
is never swallowed and that unrecognized failures surface as a typed error with the original cause
attached.

**SDK location.** `packages/core/src/trove/index.ts:292-306`. Simulate and send are wrapped in a
bare catch that returns a no surplus result. The intent, turning the no surplus revert into a clean
no op, is defensible. The implementation also absorbs RPC failure, user rejection, and genuine
reverts.

**Blast radius.** A user with real claimable collateral surplus on a degraded RPC is told,
indistinguishably from the truth, that they have nothing.

**Decision.** Fix now. Match only the no surplus revert, route everything else through `mapRevert`
and rethrow.

**Fixed, P4 wave.** The contract's behavior was established by triggering it rather than assumed,
which mattered: `claimCollateral()` does NOT return zero when there is nothing to claim. Called
from an account with no surplus on the fork it reverts with the classic Liquity require string
`CollSurplusPool: No collateral available to claim`, decoded by viem as `Error(string)`. That is
now a row in `docs/01-ground-truth.md` §11, marked as the one reason matched but deliberately not
mapped to a typed error.

`claim` matches that reason through a new `decodeRevertReason` export from
`errors/mapRevert.ts`, so it reuses the one decoder's walk rather than re-implementing it, and
rethrows everything else through `mapRevert`. Pinned chain free by
`packages/core/test/s2-guards.test.ts`, which had no predecessor: there was no paired findings test
for MK-007 before this wave. Three of its four cases fail against the old bare `catch {}`, verified
by putting the old body back and running them; the fourth, the no surplus no-op, passes both ways,
which is the point.

---

## MK-008 · `verifyDeployment()` is weak and off the critical path

**Class** S2 · **Status** open

**SDK location.** `packages/core/src/client/createMusdClient.ts:192-201`. It reads two constant
views on one of seven addresses. A fifteen line contract returning those two constants passes it.
There is no code presence check, no cross wiring assertion, despite the pointer getters existing and
being free to call. It runs only from `getConstants()`, so every read and every write is otherwise
unverified, and `trove/index.ts` re reads `minNetDebt` directly, bypassing the hook entirely.

**Decision.** Fix now. Assert the cross wiring pointers, run it once before the first write, and
route the direct `minNetDebt` read through the same path.

---

## MK-009 · Address overrides accept any string

**Class** S2 · **Status** open

**SDK location.** `packages/core/src/addresses/index.ts:57`. The whole validation is
`typeof o[k] === 'string'`. Neither `isAddress`, nor `getAddress`, nor `zeroAddress` appears
anywhere in the source. On a supported chain, a partial override silently replaces one contract
inside an otherwise trusted map, with no verification before a value bearing send.

**Decision.** Fix now. Validate and checksum every override, reject the zero address, and require
deployment verification when any override is present.

**Fixed, P4 wave.** `validateOverride` rejects an unknown contract key, a value that is not a valid
EVM address, and the zero address, and returns every value through `getAddress` so the resolved map
is canonical. Validation now runs on BOTH paths; before, the little that existed ran only on the
unsupported-chain branch, so a bad value on a supported chain was spread straight into the map.

The unknown-key case is the one that had no failure at all: `pricefeed` was spread over a map that
already had `priceFeed`, so the bundled address survived and the caller believed they had redirected
it. `MUSD_CONTRACT_NAMES` is now the single list behind both the completeness check and the
unknown-key rejection, so the two cannot drift.

**On requiring verification when an override is present:** it is required, but not conditionally.
MK-008 makes `verifyDeployment` run before the first write on every path, which is strictly
stronger than making it conditional on an override, and a conditional rule invites someone to narrow
the condition later. The reasoning is in the pull request body. What makes it an answer to this
finding rather than a coincidence is WHICH assertions verification now makes: the cross wiring
pointers. Address validation cannot tell whether a replacement belongs to the same deployment;
`TroveManager.sortedTroves()` can.

**Pinned by** the MK-009 block in `packages/core/test/addresses.test.ts`, chain free. There was no
paired findings test before. Six of its cases fail with the validation removed, verified by removing
it.

---

## MK-010 · `getBorrowingPower` performs unbounded RPC iteration

**Class** S2 · **Status** open

**SDK location.** `packages/core/src/math/getBorrowingPower.ts`. The binary search issues one
`getBorrowingFee` call per iteration over a caller supplied, unvalidated collateral amount. Roughly
77 sequential calls for one BTC, and far more for adversarial inputs. A UI bound to a text input can
inflict this on its own RPC endpoint.

**Decision.** Fix now. Validate the input, bound the iteration count, and cut the per iteration
round trips.

---

## MK-011 · `maxFeePercentage` is advisory only

**Class** S2 · **Status** open

**Ground truth.** The protocol exposes no fee cap parameter on the write paths, so the SDK cannot
enforce one on chain. This is already documented honestly in `redemption/redeem.ts`.

**Residual risk.** It is opt in, defaults to no cap, and there is a read then send race: the rate
can move between the check and the transaction.

**Decision.** Documented limit, with the wording strengthened so no integrator reads it as an on
chain guarantee.

---

## MK-012 · Governable constants are cached for the client lifetime

**Class** S2 · **Status** open

**SDK location.** `packages/core/src/client/createMusdClient.ts:203-211`. `minNetDebt` and the
interest rate are governable, and are cached for as long as the client object lives. A long lived
process, a keeper for example, can act on a stale floor indefinitely.

**Decision.** Fix now. Add a time to live and a way to invalidate.

---

## MK-013 · Price is read outside the multicall

**Class** S2 · **Status** open

**SDK location.** `packages/core/src/read/system.ts` and `packages/core/src/read/getTrove.ts` fetch
the price in a separate round trip, then run the multicall with it. Price and ICR can therefore
straddle blocks, which contradicts the one consistent price snapshot wording in the docstrings.

**Decision.** Fix now, or correct the docstring where a single call is not achievable.

---

## MK-014 · `redeem` returns a rate in a field named `fee`

**Class** S1 · **Status** fixed

**Ground truth, corrected.** An earlier version of this entry described the two redemption getters
wrongly, and its fix instruction would have introduced a unit error. Both getters live on
**`BorrowerOperations`**, not on `TroveManager`:

| Getter | Argument | Returns | Source |
|---|---|---|---|
| `redemptionRate()` | none | the **rate**, a 1e18 scaled fraction. Declared `uint256 public redemptionRate; // expressed as a percentage in 1e18 precision`, initialized to `(DECIMAL_PRECISION * 3) / 400`, that is 0.75% | `BorrowerOperations.sol:129`, initialized `:151` |
| `getRedemptionRate(uint256 _collateralDrawn)` | **collateral drawn, in BTC wei**, not a MUSD amount | despite the name, a fee **AMOUNT** in BTC wei: `fee = redemptionRate * _collateralDrawn / DECIMAL_PRECISION`, with `require(fee < _collateralDrawn)` | `BorrowerOperations.sol:499-509` |

Read at mainnet block 11330182 and testnet block 15043414, `redemptionRate()` is
`7500000000000000`, and `getRedemptionRate(1 BTC)` returns `7500000000000000` BTC wei of fee. The
two happen to print the same digits at exactly one BTC, which is precisely the coincidence that
makes the naming dangerous.

**What is actually wrong in the SDK.** `packages/core/src/redemption/redeem.ts:38` returns a field
named `fee` that holds the **rate**, read from `redemptionRate()` at `redeem.ts:65`. Its own
docstring says "Effective redemption rate (1e18-scaled)", so the type is documented and the **name
contradicts it**. A caller who trusts the field name and reads `fee` as an amount of BTC is wrong
by the size of the redemption.

**What is NOT wrong, contrary to the earlier text.** The cap at `redeem.ts:77` compares the rate
against `maxFeePercentage`, documented at `redeem.ts:24` as a "1e18-scaled fraction". Rate against
rate cap is unit consistent and correct. Swapping in `getRedemptionRate(collateralDrawn)` as the
earlier fix instruction proposed would compare a BTC wei **amount** against a 1e18 scaled
**fraction**, which is a unit error this entry would have caused rather than prevented.

**Blast radius.** A caller reading `fee` as an amount is off by orders of magnitude. Classed S1
because it is a silently wrong number in a field whose name asserts otherwise. Unchanged.

**Decision.** Fix now, but narrower than previously written. Rename the field so the unit is
explicit, and additionally return the estimated fee amount, computed with
`getRedemptionRate(collateralDrawn)` for the collateral actually drawn, as a separate field.
Leave the cap comparing rate against rate.


**Fixed in the P3b wave.** `RedeemResult.fee` is removed, a breaking change. The result now carries
`redemptionRate`, the rate named as a rate, `estimatedFeeCollateral`, the fee AMOUNT in BTC wei from
`getRedemptionRate(collateralDrawn)`, and `estimatedCollateralDrawn`, so a caller can see what the
estimate assumed. The amount is labelled an estimate because the collateral actually drawn is only
known once the redemption mines; the docstring points at the `Redemption` event's `collateralFee`
as authoritative. The cap is deliberately unchanged and still compares rate against rate, which was
already consistent; MK-011's note that no on chain fee cap exists is kept and strengthened with the
citation `TroveManager.sol:294-301` and the read-then-send race spelled out.
---

## MK-015 · Documentation claims that overstate reality

**Class** S3 · **Status** open

For a library whose stated product is correctness, an inflated claim is what persuades an integrator
to skip their own validation. These are findings, not cosmetics.

| Claim | Reality at 0.1.0 | Decision |
|---|---|---|
| A coverage floor is enforced in CI | The coverage package is installed but never configured or invoked. No thresholds, no coverage run anywhere. | Implement the gate, floor set at the honest measured number, then ratchet |
| The fork is pinned to a block for determinism | The environment variable is supported by the harness but set in no workflow. CI forks at latest and drifts against live testnet. | Pin it in CI |
| CI matrix: Node LTS, current and previous | Single Node version from `.nvmrc`. | Add the matrix, or correct the claim |
| Post publish install verification | The smoke test runs before publish, from packed tarballs. The script itself says it does not publish. | Correct the wording, and add a genuine post publish check |
| The unit layer is in process with no chain | `globalSetup` boots anvil unconditionally, so even the unit file needs an RPC URL and an anvil binary. | Split the test projects so the claim becomes true |
| Live data is never re-derived | Entire debt, liquidation price, and health factor are derived in TypeScript from authoritative getters. | Correct the claim to say exactly which values are read and which are derived |
| Validated twice | True, but only on the open path, which is why MK-006 survived. | Replace with an explicit validated surface statement |

**Progress.** The testing rows above were made true in the P0 remediation wave. A row is
marked done only when a check in CI enforces it, never when a document merely describes it.

| Claim | Status | What makes it true |
|---|---|---|
| A coverage floor is enforced in CI | **done** | `coverage.thresholds` in `vitest.config.mts`, run by `pnpm test:coverage` in the fork gate job. The floor is the measured number rounded down, and it is a ratchet: upward only |
| The fork is pinned to a block for determinism | **done** | `MEZO_FORK_BLOCK` set in `.github/workflows/ci.yml`, read by the harness at `packages/core/test/harness/anvil.ts:83`, and the oracle seed is read at that same block so the price is pinned with it (MK-020). Pinning is still not order independence, see MK-016 |
| CI matrix: Node LTS, current and previous | **done, claim narrowed** | The chain-free half runs on Node 20, 22, and 24; the fork gate runs once on the `.nvmrc` toolchain. `docs/07-testing.md` §5 now names the concrete versions instead of a category that goes stale |
| Post publish install verification | **done, wording corrected** | The pack smoke is now described as pre publish everywhere, because that is what it is. A genuine post publish job installs the published version from the registry into an empty directory and imports it, in `.github/workflows/release.yml`, after publish and never on push |
| The unit layer is in process with no chain | **done** | Two vitest projects in `vitest.workspace.mts`. CI runs `pnpm test:unit` before Foundry is installed and with no RPC secret in scope, so the claim fails loudly if it stops being true |

The two remaining rows, live data never re-derived and validated twice, are untouched and
belong to a later wave.

---

## MK-016 · Test suite is one stateful sequence with unpinned fork and flake mitigations

**Class** S3 · **Status** open

The suite runs serially in alphabetical order with cumulative EVM clock warps leaking between
phases, against an unpinned fork, and carries flake mitigations including retry loops, a fixed gas
limit, and repeated oracle refreshes. Flake mitigation is a signal: some of what it hides may be a
real finding rather than test infrastructure noise.

**Decision.** Fix now, first, because nothing else can be trusted until it is done. Split unit and
fork projects, pin the fork block in CI, then remove each mitigation one at a time and treat
whatever still fails as a finding. Note honestly that pinning does not make the suite order
independent; the clock coupling is a separate structural limit.

**Landed in the P0 wave.**

- The suite is split into two vitest projects (`vitest.workspace.mts`). The `unit` project has no
  `globalSetup`, so it needs neither an anvil binary nor an RPC URL, and CI runs it before Foundry
  is installed to keep that honest. `pnpm test:unit`, `pnpm test:fork`, `pnpm test` runs both.
- The chain free math has real unit tests derived from the Solidity, not from the SDK's own output:
  `packages/core/test/math.test.ts`. The fork side cross checks against the contract's `pure`
  helpers are deliberately kept, they are the other half of the pair.
- The fork block is pinned in CI via `MEZO_FORK_BLOCK`, with a comment stating how to bump it.
- The coverage gate is configured and enforced, at the honest measured floor.

**What remains open, and why this stays `open`.** Two of the three problems in this finding's
title are untouched. The flake mitigations are all still in place, deliberately: they come out one
at a time in a later wave, with the block pinned, and whatever then fails becomes its own finding.
And the suite is still one stateful sequence: the `fork` project shares one anvil instance and the
cumulative EVM clock warps couple the phases, which the alphabetical sequencer orders but does not
decouple. That coupling is now stated as a known structural limit in `docs/07-testing.md` §1
rather than left implied, but stating a limit is not removing it.

**The pin alone did not resolve this finding**, because the oracle shim seeded itself from a
`latest` read rather than from the forked block, so the fork block determined the chain state but
not the price; that half is now MK-020, fixed, and the ordering coupling above is what still keeps
MK-016 open.

---

## MK-017 · Duplicated derivations and placeholder values

**Class** S3 · **Status** open

Liquidation price and health factor are implemented twice, once as pure functions in `math/` and
once inline in `read/getTrove.ts`. `errors/mapRevert.ts` constructs two numeric errors with
placeholder zeros. `getHealthFactor` converts through a fixed point scale that loses meaning for a
zero debt sentinel ICR. Three `as unknown as Abi` casts and one `any` remain in the write path.

**Decision.** Fix now. Single source each derivation, remove the placeholders, handle the sentinel,
and type the write path properly.

---

## MK-018 · Fee exemption is not modeled

**Class** S1 · **Status** fixed · **Severity assigned from evidence, not assumption**

`GovernableVariables.isAccountFeeExempt` zeroes the borrowing fee on open, on debt increase, and on
refinance. The SDK does not model it. Neither does Mezo's production dApp.

**The exempt set is NOT empty on mainnet.** That is what decides this, and it is now measured
rather than guessed. At mainnet block 11330182, two accounts are fee exempt. Four accounts have
been granted exemption over the chain's history and two of those have since had it removed, so the
mechanism is not merely deployed, it is actively administered. On testnet, at block 15043414, the
set is empty.

**Blast radius: these are ordinary accounts, not protocol plumbing.** Both accounts exempt at
mainnet block 11330182 have **no code**, and neither matches any address the protocol is known to
own: they were checked against 37 addresses drawn from every deployment record in the pinned
contracts package, proxy and implementation addresses alike, plus every address the SDK bundles.
The same holds for all four accounts ever granted. That distinction matters more than the severity
letter. Had the exempt set been protocol owned contracts, the wrong number would surface inside
Mezo's own tooling; instead it surfaces for external accounts, which is exactly the population that
reaches for an SDK. Unmatched and code free is all that is claimed here: it is not evidence of who
owns those accounts, and nothing in this register infers ownership.

The individual addresses are deliberately not listed, here or in the generated block. They are
public chain data and `pnpm facts` reproduces them against the same pinned block, so withholding
them costs a reader nothing they cannot recompute; printing them would attach a durable "fee
exempt" label to specific accounts in a public register without adding anything the count and the
characterization above do not already carry.

**How that was established.** A genesis to pinned block scan of `FeeExemptAccountAdded` and
`FeeExemptAccountRemoved` on `GovernableVariables`, event and getter names read from the deployed
ABI rather than assumed, in 1134 chunks of 10000 blocks on mainnet and 1505 on testnet, with every
address ever granted then re-checked against `isAccountFeeExempt` at the pinned block so a removal
is confirmed by the contract rather than inferred from event pairing. No address was guessed or
probed. Recorded in full in `docs/09-review-and-validated-surface.md` §6.

**Why S1.** For an exempt account the contract charges no borrowing fee, while
`packages/core/src/math/previewOpen.ts` applies `getBorrowingFee(debt)` unconditionally. The
caller is shown a debt, an ICR and a liquidation price computed from a fee that will not be
charged. It is a silently wrong number with no error raised, which is the S1 definition, and the
cohort it is wrong for exists on mainnet today.

**Scope of the claim.** Both statements above are facts about specific blocks, not permanent
properties: the set is governable and can change without notice in either direction. The empty
testnet result in particular must not be read as "fee exemption is unused"; it was empty at block
15043414 and nothing more.

**Decision.** Fix, in the same wave as MK-004, since both are the borrowing fee being applied when
the contract will not charge it. Read `isAccountFeeExempt` for the account being previewed and
skip the fee when it returns true.


**Fixed in the P3a wave.** `previewOpen` takes an optional `account` and consults
`GovernableVariables.isAccountFeeExempt` through the new `MathDeps.isAccountFeeExempt`, so it
charges what the contract charges for that caller. The GovernableVariables address is read from
`borrowerOperations.governableVariables()` rather than added to the bundled map, so it cannot
disagree with the BorrowerOperations already in use. With no account supplied the preview assumes
not exempt and reports that via `feeExempt: false`, making the assumption visible rather than
silent. The same rule is applied on the debt increase path, where the fee is likewise skipped.

**Not witnessed, and therefore owed.** The exempt branch on the DEBT INCREASE path,
`effectiveBorrowingFee` in `packages/core/src/trove/index.ts` mirroring
`BorrowerOperations.sol:810-818`, is reasoned from source and NOT observed: the fork test grants
exemption and exercises the OPEN path only. Reaching the exempt debt increase is on the
differential harness coverage list in `docs/09-review-and-validated-surface.md` §3.
---

## MK-019 · `refinance()` reverts in Recovery Mode, unchecked and undocumented

**Class** S2 · **Status** fixed

**Ground truth.** The refinance path calls `_requireNotInRecoveryMode(price)` before anything else,
so a refinance attempted in Recovery Mode always reverts.

**SDK location.** `packages/core/src/trove/index.ts:274-284`. No mode check, and the docstring for
`refinance()` does not mention the restriction. Simulate before send catches it, so the user sees a
mapped revert rather than a bad transaction, which is why this is S2 and not S1.

**Decision.** Fix now, alongside MK-003: surface the restriction in the preview and in the
docstring.


**Fixed in the P3b wave, and the record corrected.** This was never a safety gap. Simulate before
send already surfaced the revert as a typed `RECOVERY_MODE_RESTRICTION`, which a test written in the
P2 wave asserted and which still passes: the SDK behavior a caller could observe was already
correct. What was missing is that the restriction could not be learned WITHOUT sending, and was
documented nowhere. `previewRefinance` reports it, and reports it as the FIRST binding reason
because `_requireNotInRecoveryMode` is the first requirement `_refinance` applies
(`BorrowerOperations.sol:1024`), and the `refinance()` docstring now states it.
---

## MK-020 · Oracle shim seed is not pinned, so a pinned fork block is not a pinned price

**Class** S3, harness · **Status** fixed · **Found by us while remediating MK-016**

**What was wrong.** The fork harness cannot read Mezo's BTC/USD oracle from the fork itself: the
address is a native precompile served by the node's Cosmos oracle module, and the stored EVM
bytecode only self-recurses, so an anvil fork of it reverts. The harness works around that by
reading the real round from the upstream node and seeding a shim
(`packages/core/test/harness/oracle.ts`, `installOracleShim`). That read passed no block number,
so it resolved at the upstream chain's `latest`. Pinning `MEZO_FORK_BLOCK` therefore pinned the
chain state and left the price floating with wall clock time.

The consequence is narrow to state and wide in effect: the fork suite had two independent inputs,
one pinned and one not, while the documentation claimed determinism from the pin alone.

**Reproduction.** Four full suite runs, all at fork block 15043414, seeded four different answers:

| Run | Fork block | Seeded answer (BTC/USD, 1e18) |
|---|---|---|
| 1 | 15043414 | `77226724770000000000000` |
| 2 | 15043414 | `77005799990000000000000` |
| 3 | 15043414 | `77090810000000000000000` |
| 4 | 15043414 | `77011376590000000000000` |

The observable failure was `packages/core/test/phase9-keeper.fork.test.ts`, which asserted that
the fork's lowest ICR tail was still under MCR. Whether that held depended on the seeded price and
on how much of that tail phase 6 had already liquidated. It failed with `liquidated.length === 0`
on runs 1 and 3, and passed on runs 2 and 4: a coin flip, not a check. That failure is a symptom of
this finding combined with the ordering coupling that remains in MK-016, and is deliberately not
given an ID of its own.

**Ground truth for the fix.** Whether the endpoint honours a historical block tag on a precompile
served outside the EVM is a property of the endpoint, not something to assume, so it was measured:
twelve consecutive `eth_call` reads of `latestRoundData()` pinned to block 15043414 returned one
identical round (`roundId 13948341`, answer `77051107320000000000000`), a read pinned one million
blocks earlier returned a genuinely older round (`roundId 12899794`), and a read at block 4096
returned `header not found`, which is the endpoint's pruning boundary rather than a silent wrong
answer.

**Fix.** `installOracleShim` now takes the block to read at and receives the fork's own anchor
block (`packages/core/test/harness/anvil.ts`), so the fork block is the single input that
determines the price. When the endpoint can no longer serve that block, the harness falls back to
`RECORDED_ORACLE_SEED` in `packages/core/test/harness/constants.ts`, but only for the exact block
that seed was recorded at, and never quietly: it warns loudly, and for any other block it throws
rather than seed a price that does not belong to the forked state. The seeded answer and the block
it came from are printed at suite startup, so a future divergence is readable in the log instead of
being reconstructed from a failure.

Note what is unchanged: `startedAt` and `updatedAt` are still stamped with the fork's own block
time, not the round's, because the PriceFeed freshness check would otherwise reject a historical
round outright. Only the price and the round id come from the pinned read.

---

## MK-021 · Phase 3 warm up hook exceeds its fixed budget on a cold fork

**Class** S3, harness · **Status** fixed · **Found by us while proving MK-020**

**Ground truth for our own policy.** `docs/07-testing.md` §5 states the suite must pass twice
identically. It does not, and the remaining reason is this one.

**What happens.** `packages/core/test/phase3.fork.test.ts:67-69` runs a `beforeAll` whose only job
is to warm anvil's lazy state cache, with a hard 180 second budget:

```ts
beforeAll(async () => {
  await client().computeHints({ collateral: 10n ** 17n, entireDebt: 2202n * 10n ** 18n })
}, 180_000)
```

It asserts nothing. When it exceeds the budget, vitest fails the suite and **skips all six phase 3
tests**, so a latency event is reported as if the insertion hint module were untested.

**Reproduction.** Five consecutive full suite runs at pinned block 15043414: runs 1 and 3 failed
with `Hook timed out in 180000ms` and `97 passed | 6 skipped`; runs 2, 4 and 5 passed 103 of 103.
An earlier wave saw the same hook time out once in four runs, so three of nine observed full runs.
Nothing else failed in any of the nine.

**Why we think it is latency and not a defect in the code under test.** The warm up calls
`computeHints`, whose `getApproxHint` samples many SortedTroves nodes, and every sampled node on a
cold anvil fork is a lazy state fetch to the upstream RPC. Measured directly: the same cold fork
hint ritual inside an isolated `openTrove` took 271 seconds, comfortably past this hook's 180
second budget, while the identical call once the cache is warm takes about 4 seconds. So the budget
sits inside the range the cold path actually occupies, rather than above it.

That is a hypothesis about the cause, not a verified root cause. What is verified is the timing
spread and that the hook asserts nothing.

**Root cause, measured rather than reasoned about.** The 60x cold-to-warm gap is not computation,
it is upstream state fetching, and the reason it recurred on every run is that the cache which was
supposed to prevent it was never written. anvil lazily fetches upstream state on first access and,
when the fork block is pinned, persists it to `~/.foundry/cache/rpc/<chainId>/<block>/storage.json`.
It writes that file only on a graceful shutdown. `packages/core/test/harness/anvil.ts` sent
`SIGKILL`, so it never did.

A counting proxy placed between anvil and the upstream RPC, measuring one warm up call:

| | Cold (no cache) | Warm (cache present) |
|---|---|---|
| Warm up duration | 168997 ms | 130 ms |
| Upstream JSON-RPC calls | 913 | 3 |
| of which `eth_getStorageAt` | 849 | 0 |
| Bytes from upstream | 163743 | 1514 |
| Hints returned | `0xd151..02d, 0xCB0a..9Cd` | identical |

849 sequential storage reads at public endpoint latency is the entire cost. Isolating the shutdown
signal confirmed the cause directly: forking, touching state, then `SIGTERM` writes a 52 KB
`storage.json`; the identical sequence with `SIGKILL` writes nothing.

**Fix.**

- `stopFork` now sends `SIGTERM` and only escalates to `SIGKILL` after a 15 second grace period, so
  anvil flushes its fork cache and a wedged process still cannot outlive the suite.
- The warm up moved from `phase3.fork.test.ts` into `harness/globalSetup.ts`. The cost is paid once
  for the suite, is attributed to the harness rather than to one phase, and is logged.
- That warm up now traverses the WHOLE sorted list, via one `findInsertPosition` call with a
  near zero NICR and no hints, which walks from head to tail and touches every node. The first
  attempt warmed a single `computeHints` position instead and a cold run still failed, in a
  different phase 3 test, at the ordinary 60 second timeout. The reason is worth recording: phases
  that open Troves grow the list, `trialsForSize` then returns a different trial count, and
  `getApproxHint` therefore samples a different node set which was never warmed. Traversing the
  whole list is a superset of any later sample or traversal, so it is immune to that. Troves opened
  during the run are local anvil state and need no upstream fetch.
- CI caches `~/.foundry/cache/rpc/31611/<block>` keyed on the block, so a cold fetch happens once
  per pinned block rather than once per push. Both the path and the key carry the block number and
  there is deliberately no `restore-keys` prefix fallback, because replaying one block's state at
  another block would reintroduce precisely the nondeterminism MK-020 removed.

**The budget is gone, not raised.** The 180 second `beforeAll` timeout was deleted rather than
enlarged. vitest imposes no timeout on `globalSetup`, so a cold run is now slow instead of red, and
the phase 3 tests run under the ordinary `testTimeout`. That the old number was the flake is not a
guess: measured end to end through the real harness, the cold warm up took 181335 ms, which
overshoots the 180000 ms budget by 1.3 seconds. The same call on the next run took 42 ms.

---

## MK-022 · `batchLiquidate` phase 6 test intermittently leaves one Trove unliquidated

**Class** S3, harness · **Status** open · **Found by us while verifying the MK-020 and MK-021
merge into `main`**

**What happens.** `packages/core/test/phase6.fork.test.ts:270` opens two Troves at a target ICR of
about 1.12, drops the price to `originalPrice * 100 / 113` so both sit well under MCR, calls
`batchLiquidate` on the pair, and asserts both reach status 3, closed by liquidation. On one run in
six it failed with `expected 1 to be 3`: one of the two was still status 1, active, after the batch
call returned and the receipt was awaited.

**Reproduction and rate.** Six full runs of `pnpm test:coverage` at pinned block 15043414, one red.
Three additional `pnpm test:fork` runs on the same tree were green. The seeded oracle answer was
byte identical, `77051107320000000000000`, in every one of those runs, so this is not MK-020
resurfacing.

**Observed rate, measured in the P3a wave: one in twenty.** Twenty full `pnpm test:fork` runs at
the same pinned block produced four red runs, and exactly ONE of those was this finding's location,
`phase6.fork.test.ts:245`, again with `expected 1 to be 3`. The seed was byte identical in all
twenty. The other three red runs failed elsewhere and are registered separately as MK-023, MK-024
and MK-025 rather than folded in here: a flake without its own entry is indistinguishable from a
real regression when it surfaces in a later wave. So the phase 6 file is not one flaky test, it is
at least three distinct ones plus this.

**Not caused by the merge that surfaced it.** `git diff` between `chore/p0.2-cold-fork-warmup` and
`main` after the restore merge is empty, so the tree that produced the failure is byte identical to
the tree that ran five consecutive green earlier. The merge introduced nothing. It follows that the
same flake was latent in those five green runs and simply did not fire.

**What we do NOT claim.** No root cause. The obvious candidates were not confirmed and some are
already contradicted: interest accrual between open and liquidation lowers ICR further, so it makes
liquidation more likely rather than less, and both Troves are constructed identically from the same
captured `originalPrice`. Whether the Stability Pool balance at that moment, the ordering coupling
in MK-016, or something in the batch path is responsible is unestablished, and this entry
deliberately stops short of guessing.

**Why it matters more than a flaky test usually would.** The assertion is about liquidation
completing, which is the same surface MK-001 concerns. A test that passes five times in six is not
evidence about the sixth, and this one sits next to a finding we already know is wrong about
liquidation rules. It should be diagnosed before anyone reads the phase 6 file as confirmation of
liquidation behavior.

**Decision.** Diagnose in the mitigation removal wave, alongside MK-016. Do not raise a timeout or
add a retry: nothing here timed out, and a retry would hide exactly the signal worth keeping.

---

## MK-023 · Phase 6 `claim` fixture intermittently leaves the target Trove unredeemed

**Class** S3, harness · **Status** open · **Found by us in the P3a wave, attributing red runs**

**What happens.** `packages/core/test/phase6.fork.test.ts:334` opens a Trove at the very bottom of
the redeemable list, redeems past it so that it is FULLY consumed, and asserts its status reaches
4, closed by redemption, leaving a collateral surplus for its owner to claim. Intermittently the
status is still 1, active: `expected 1 to be 4`. The redemption did not consume the Trove it was
sized to consume.

**Reproduction and rate.** Two in twenty. Twenty full `pnpm test:fork` runs at pinned block
15043414 on the P3a branch, red on runs 3 and C, both with the identical assertion. The seeded
oracle answer was byte identical, `77051107320000000000000`, in all twenty, so the price is not the
variable.

**Why it is NOT MK-022.** Different test, different line, different assertion, different operation.
MK-022 is `batchLiquidate` at `:245` asserting status 3. This is a redemption at `:334` asserting
status 4. They share a file and a suspected family, the shared mutable fork, and nothing else.

**What we do NOT claim.** No root cause. The redeemable tail is mutated by every earlier file that
opens, liquidates or redeems, so how much of it survives to this test is a function of everything
before it, which is the MK-016 ordering coupling. Whether that alone explains it, or whether the
truncation arithmetic in `getRedemptionHints` is also involved, is unestablished.

**Decision.** Diagnose in the mitigation removal wave alongside MK-016 and MK-022. Do not add a
retry: the assertion is about a redemption completing, and a retry would hide precisely the signal.

---

## MK-024 · Phase 6 normal mode liquidation intermittently crashes on a missing event

**Class** S3, harness · **Status** open · **Found by us in the P3a wave, attributing red runs**

**What happens.** `packages/core/test/phase6.fork.test.ts:198` fails with
`TypeError: Cannot read properties of undefined (reading 'args')`. It is a CRASH, not an assertion:
the test looks up an expected event in the receipt's logs and the lookup returns `undefined`, so
the property read throws before any assertion runs.

**Reproduction and rate.** One in twenty, run 10 of the twenty P3a fork runs at pinned block
15043414, seed byte identical.

**Why it is NOT MK-022, and why it is worth its own entry more than the others.** Different test and
different line, but the reason to separate it is the failure MODE. A `TypeError` on a missing event
tells you nothing about what actually went wrong on chain: the liquidation may have reverted,
liquidated nothing, or emitted a different event, and the crash hides which. Folded into another
entry it would read as the same symptom as an assertion failure, which it is not. The test should
be made to fail with the on-chain reason rather than a property access on `undefined`; until it
does, every occurrence of this costs a diagnosis from scratch.

**What we do NOT claim.** No root cause, and deliberately no guess about which of the three
possibilities above it is, because the crash removed the evidence that would have told us.

**Decision.** Diagnose in the mitigation removal wave. The first fix is to the test's own error
handling, so that the next occurrence reports what the chain did.

---

## MK-025 · React block watching test intermittently sends a write that reverts

**Class** S3, harness · **Status** open · **Found by us in the P3a wave, attributing red runs**

**What happens.** `packages/react/test/hooks.fork.test.ts:157`, the hook refetch on a new block,
fails with `expected 'reverted' to be 'success'`. A transaction the test sends to produce a new
block reverted instead of mining successfully.

**Reproduction and rate.** One in twenty, run F of the twenty P3a fork runs at pinned block
15043414, seed byte identical. Notably run F was the only run with TWO failures: this and MK-022.

**Why it is NOT MK-022.** Different package entirely, `@musd-kit/react` rather than
`@musd-kit/core`, a different mechanism, a write reverting rather than a liquidation not taking
effect, and a different failure surface. It is also the only observed failure outside
`phase6.fork.test.ts`, which matters: it shows the intermittency is not confined to one file.

**Relationship to an existing mitigation.** `hooks.fork.test.ts` already carries `ensureWriteMined`,
the four attempt refire loop listed as mitigation 2 in the P0 flake inventory, precisely because
writes on the shared fork revert after a passing simulate. This failure means the mitigation did
not save this particular write, which is information about the mitigation as much as about the
test. The P0 inventory flagged that loop as the most suspicious of the set, because a simulate that
passes followed by a revert is the MK-005 bug class; MK-005 is now fixed, and this still happened.

**What we do NOT claim.** No root cause, and specifically not that MK-005's fix should have
prevented it. The revert reason was not captured.

**Decision.** Diagnose in the mitigation removal wave, when `ensureWriteMined` is removed and
whatever then fails becomes a finding. Capture the revert reason first.

---

## MK-026 · Phase 5 lifecycle writes fail only under the coverage run, never under a plain fork run

**Class** S3, harness · **Status** open · **Found by us in the P3a wave, and PROVEN pre existing**

**What happens.** `packages/core/test/phase5.fork.test.ts` fails intermittently, far more often
under `pnpm test:coverage` than under `pnpm test:fork`. Four symptoms have been seen in the same
file, all of them a write that did not take effect:

| Where | Symptom |
|---|---|
| `phase5.fork.test.ts:191` `adjustTrove combined` | `expected 600000000000000000n to be 550000000000000000n`, the collateral withdrawal did not apply |
| `phase5.fork.test.ts:191` `adjustTrove combined` | `No open Trove for 0xEB41...`, the `openTrove` that starts the test did not take effect at all |
| `phase5.fork.test.ts:114` `full lifecycle via the SDK` | `expected 500000000000000000n to be 600000000000000000n`, likewise a collateral step |
| `phase5.fork.test.ts` `simulate-before-send surfaces reverts` | `expected false to be true`, the Trove the test opened does not exist at the end |

**It is NOT ours, and that was proven rather than argued.** This first appeared while landing the
P3a changes, in `adjustTrove`, code that wave modified, so it had every appearance of a regression.
Two checks settled it:

1. **Reproduced on unchanged `main`.** `main` was checked out and `pnpm test:coverage` run twice at
   pinned block 15043414: one green, one red, in the same `phase5.fork.test.ts`. No P3a change is
   present on that tree.
2. **The changed code is not on the failing path.** The failing step in the `adjustTrove` case is
   `withdrawCollateral + repay`, where `brw` is undefined, so the borrowing capacity precheck added
   in P3a never runs and the effective fee stays zero. The remaining P3a edit to that function is
   hoisting a `const owner` declaration, which changes no behavior.

**Reproduction and rate.** Two red in three `pnpm test:coverage` runs on the P3a branch, and one
red in two on `main`. Against that, ZERO red in twenty `pnpm test:fork` runs on the same branch at
the same block, where the four failures that did occur were MK-022, MK-023, MK-024 and MK-025, none
of them in phase 5. That asymmetry is the finding.

**Correction, P3b wave: the asymmetry is not absolute.** This entry originally said phase 5 fails
under coverage and "so far never under a plain fork run". That is now falsified. One of five plain
`pnpm test:fork` runs on the P3b branch went red at
`phase5.fork.test.ts` `simulate-before-send surfaces reverts`, with
`expected false to be true`: the Trove the test opened did not exist by the end, so the opening
write did not take effect, which is the same symptom as the three under coverage. Coverage
instrumentation therefore makes it much MORE likely, not uniquely possible, which weakens the
timing hypothesis below from "the instrumentation causes it" to "the instrumentation widens a
window that is already there". The rate under a plain fork run is one in five on that branch,
against zero in twenty on the previous one, so it is not a stable rate either.

  MEZO_TESTNET_RPC_URL=<a Mezo testnet endpoint> MEZO_FORK_BLOCK=15043414 pnpm test:coverage

**The condition traced, and what we do NOT claim.** The only difference between the two commands is
the v8 coverage instrumentation and the extra unit project, so the working hypothesis is that
instrumentation slows execution enough to widen the window between simulate and mine on the shared
fork, which is the same window `openTroveRaw` already carries two `refreshOracle` calls and a fixed
gas limit to defend against. That is a hypothesis about the mechanism, not a verified root cause:
the reverts were not captured with their on chain reason, and no timing was measured. What IS
verified is the asymmetry, that it predates P3a, and that the P3a changes are off the failing path.

**Why it matters.** CI runs `pnpm test:coverage`, not `pnpm test:fork`. So this is the flake that
actually reddens the pipeline, and it is the one least visible to anyone running the fork suite
locally. It also means the coverage number itself is only obtainable on a green run, which cost
three attempts in the P3a wave.

**Decision.** Not fixed here. Diagnose in the mitigation removal wave alongside MK-016: capture the
revert reason first, then measure whether the simulate to mine window is really the variable. Do
not paper over it by disabling coverage in CI, which would trade a visible flake for an invisible
gap.

---

## MK-027 · Source files sit outside every typecheck and lint configuration

**Class** S3 · **Status** open, partially closed · **Found by us in the P3b wave, after it cost a
false green and a broken example**

**What was uncovered, and what it cost.** `packages/react/tsconfig.json` had
`"include": ["src"]`, so the whole of `packages/react/test` was outside every typecheck
configuration in the repository. This is not a one off oversight in a scratch directory: it is a
PUBLISHED package whose tests nothing typechecked. It produced two consequences, both observed
rather than hypothesised:

1. **A false green on a rename.** The P3b wave renamed `RedeemResult.fee` (MK-014).
   `pnpm typecheck` passed clean, because the only file still referencing the removed field was
   `packages/react/test/hooks.fork.test.ts`. The suite then failed FIVE out of five fork runs on
   that file. A rename that a compiler should have caught in a second cost five full fork runs to
   discover, at roughly four minutes each.
2. **A broken example reaching `main`.** `examples/open-and-manage/src/App.tsx:94` still read
   `preview.meetsRecoveryRequirement`, removed in the P3a wave, so
   `pnpm -r --filter "./examples/*" typecheck` FAILS on `main`. That is a step CI actually runs, so
   CI on PR 7 would have been red. It reached `main` because nobody, including us, ran that step
   locally and the acceptance criteria for that wave did not list it. That second half is addressed
   separately by the standing checklist in `docs/08-conventions.md` §10.

**What now covers it.** `packages/react/tsconfig.test.json` typechecks `src` and `test` together.
It is a separate config rather than an edit to the package tsconfig because that one also drives
the `tsup` build, and widening its `rootDir` would move the emitted layout. `packages/react`'s
`typecheck` script runs both. Adding that config is what surfaced the broken example, which is the
argument for it.

**What the audit found still outside, measured not guessed.** Every typecheck configuration the
repository runs was asked, with `tsc --listFilesOnly`, which files it actually visits, and the
result diffed against `git ls-files '*.ts' '*.tsx' '*.mts'`. Of 76 tracked TypeScript files, EIGHT
are visited by no configuration at all:

| File | Why it is outside |
|---|---|
| `packages/core/test/phase9-keeper.fork.test.ts` | Explicitly excluded at `packages/core/tsconfig.json:9` |
| `docs/.vitepress/config.ts` | `docs` has no `typecheck` script and no tsconfig covering it |
| `docs/.vitepress/theme/index.ts` | Same |
| `examples/open-and-manage/vite.config.ts` | The example tsconfig includes `src` only |
| `packages/core/tsup.config.ts` | Build config, in no `include` |
| `packages/react/tsup.config.ts` | Build config, in no `include` |
| `vitest.config.mts` | Root config, in no `include` |
| `vitest.workspace.mts` | Root config, in no `include` |

The first row is the sharpest: a fork test is excluded BY NAME, so it has exactly the property that
just cost five red runs, and it is the test that exercises the keeper example.

**The landing site is outside both gates.** `landing/` carries 27 tracked source files and is
listed in `biome.json`'s `files.ignore`, so none of them are linted. It has a `check` script,
`astro check`, but nothing runs it: not CI, not `pnpm build:site`. It also cannot run as configured,
because `@astrojs/check` is not installed; invoking it prompts to add the dependency. So the site
that fronts the project is neither linted nor typechecked, and the command that would typecheck it
is not installed.

**Why this is S3 and not lower.** Nothing here is a wrong number for a user. But this class of gap
produces exactly the failure the register exists to prevent: a green signal that means less than a
reader assumes. Someone reading "typecheck: Done" reasonably concludes the TypeScript in this
repository compiles. For eight files and an entire site, it does not say that.

**Decision.** The hole that caused both observed consequences is closed. The eight files and the
landing site are recorded here and NOT fixed in this wave, because closing them means touching build
configuration and adding a dependency, which does not belong in a bookkeeping commit. Closing them
is cheap and specific: add the root configs and the two `tsup.config.ts` files to
`scripts/tsconfig.json`, drop the `phase9-keeper` exclusion and fix whatever it then reports, give
`docs` a tsconfig covering `.vitepress`, and either install `@astrojs/check` and run it in CI or
remove the `check` script so it stops implying a gate that does not exist. This entry stays open
until that is done.

---

## MK-028 · The DOM test environment pairs jsdom's `AbortSignal` with Node's `Request`

**Class** S2, harness · **Status** fixed · **Found by us reading the first CI run anyone in this
programme had looked at**

**What happens.** The whole of `packages/react/test/hooks.fork.test.ts` fails at suite level, before
a single assertion runs. All ten of its tests are reported skipped:

```
 FAIL |fork|  packages/react/test/hooks.fork.test.ts [ packages/react/test/hooks.fork.test.ts ]
HttpRequestError: HTTP request failed.
URL: http://127.0.0.1:39709
Request body: {"method":"anvil_mine","params":["0x1","0x0"]}
Details: RequestInit: Expected signal ("AbortSignal {}") to be an instance of AbortSignal.
Caused by: TypeError: RequestInit: Expected signal ("AbortSignal {}") to be an instance of AbortSignal.
 at Object.webidl.errors.exception node:internal/deps/undici/undici:4859:14
 at Object.AbortSignal node:internal/deps/undici/undici:5118:31
```

`packages/react/test/phase9-app.fork.test.ts` is reported as passing but leaks the same error as an
unhandled rejection on `eth_accounts` through the wagmi mock connector, so vitest also reports
`Errors 1 error`. Both files, not one.

**What it is NOT.** Not a test assertion, not a timeout, not the coverage gate, not an RPC problem,
and not the fork cache. Coverage never ran at all: the failing job's log contains zero coverage
output lines, because `vitest run --coverage` exits non zero before printing the table. The URL in
the error is the local anvil endpoint, not an upstream one.

**Mechanism, measured rather than assumed.** viem's HTTP transport builds
`new Request(url, { signal })` from an `AbortController` it constructs itself
(`viem/utils/rpc/http.ts:118`, reached from `clients/transports/http.ts:125`). jsdom supplies its
own `AbortController` and `AbortSignal` but supplies neither `fetch` nor `Request`, and vitest's
jsdom environment copies the jsdom window over `globalThis`. A test file therefore holds jsdom's
signal and Node's `Request`. From Node 24 on, undici brand checks `RequestInit.signal` against its
own class and throws.

Probed directly, on Node 24, in this repository:

| Environment | `String(globalThis.AbortSignal)` starts | `new Request(url, { signal })` |
|---|---|---|
| `node` | `class AbortSignal extends EventTarget` | ACCEPTED |
| `jsdom` | `class AbortSignal extends globalObject.E` | REJECTED |

The same probe on Node 20.20.1 and Node 22.23.1 under `jsdom` returns ACCEPTED, which is the entire
reason this was never seen locally.

**A wrong turn worth recording.** An earlier probe compared `globalThis.AbortSignal` with
`global.AbortSignal` inside the jsdom environment, found them identical, and briefly concluded jsdom
was not shadowing anything. That comparison proves nothing: inside the jsdom environment `global`
and `globalThis` are the same jsdom window, so the test compared jsdom's class with itself. The
question is whether it matches undici's class, and only building a `Request` answers it.

**Why CI and never locally.** The fork gate takes its Node from `.nvmrc`
(`.github/workflows/ci.yml:116`, `node-version-file: .nvmrc`). Commit `a22299f` changed `.nvmrc`
from `20.18.1` to `24.19.0`. Every local run in this programme was on Node 20.20.1. See MK-029: the
version split is the finding, this is only its first casualty.

**Rate.** Not a flake. Four fork gate runs on `main` since that commit, four identical failures:
runs `32633970784`, `32640501671`, `32648091286`, `32703530387`. Reproduced locally on Node 24 at
the same pinned block, byte identical error. Zero failures on Node 20 and Node 22.

**Blast radius.** No SDK source is wrong. A browser pairs its own `AbortSignal` with its own
`fetch`, and a Node process pairs Node's with Node's; only the mixed pair a DOM test environment
creates is broken. The cost was real anyway: the react hooks were unverified on every merge since
`a22299f`, and the fork cache was never saved once, because the `actions/cache` post step is skipped
when the job fails, so every run re-warmed from cold at 85 to 122 seconds.

**Fix.** `packages/react/test/harness/jsdom-node-abort.ts`, a custom vitest environment that runs
the built in jsdom environment and then puts Node's `AbortController` and `AbortSignal` back. It
captures them at module load, which is before vitest populates the jsdom globals; reading them
inside `setup` would read jsdom's and restore nothing. Wired through `environmentMatchGlobs` in
`vitest.workspace.mts` for BOTH projects.

**Pinned by** `packages/react/test/abort-signal.test.ts`, chain free and in the `unit` project, so
it runs on all three matrix Nodes in the fast `Checks` jobs rather than only on the one Node the
fork gate pins. Verified by mutation: pointing the glob back at plain `jsdom` makes it fail on Node
24 with the exact error above and pass on Node 20 and 22.

**Note for anyone adding a DOM test.** The `@vitest-environment` docblock cannot name this
environment. Vitest 2 parses it with `/@(?:vitest|jest)-environment\s+([\w-]+)\b/`
(`vitest/dist/chunks/resolveConfig.RxKrDli4.js:6558`), which cannot express a path, and a path
written there is silently ignored: the file runs on the project default and nothing warns. Use
`environmentMatchGlobs`.

---

## MK-029 · Local evidence and CI evidence were both true, because they ran different runtimes

**Class** S2, process · **Status** fixed · **Found by us when asked to look at a CI run for the
first time**

**What it actually was, in one sentence.** Every wave's local acceptance and every CI run were both
reporting honestly, and they never contradicted each other, because they were never running the
same thing: the fork gate resolved its Node from `.nvmrc` while every local run used the Node the
author happened to have. Five merges landed on a red trunk and nobody noticed, not because anyone
overlooked a red X, but because nothing in the process ever put the two sources of evidence in the
same room.

That is the part worth carrying forward. A green local run was not a false claim. It was a true
claim about a different system, presented as though it settled the question, and no rule required
anyone to check whether it did.

**What happens.** Two separate things that combine into one hole.

1. **Nobody read CI.** The `CI` workflow on `main` has been red on every merge since
   `2026-08-23T10:31`. Measured from the run list, oldest first:

   | Run | Merge | Failing job | Cause |
   |---|---|---|---|
   | `32628458775` | PR 1 | none, green | the last green run on `main` |
   | `32633970784` | PR 5 | Fork gate + coverage | MK-028 |
   | `32640501671` | PR 4 | Fork gate + coverage | MK-028 |
   | `32648091286` | PR 6 | Fork gate + coverage | MK-028 |
   | `32657938617` | PR 7 | Checks, all three Nodes | MK-027, the broken example |
   | `32703530387` | PR 8 | Fork gate + coverage | MK-028 |

   Five consecutive red merges. Every wave reported acceptance as met on local evidence, and the
   PR 8 report even said in as many words that CI had not been checked. Saying so is not the same
   as looking.

2. **The fork gate ran a Node that no local run used.** That job read
   `node-version-file: .nvmrc`, and commit `a22299f`, a housekeeping change about the DEVELOPMENT
   runtime, moved `.nvmrc` from `20.18.1` to `24.19.0`. Every local acceptance run in this
   programme was on Node 20.20.1. So five green local runs and four red CI runs were true at the
   same time and never in contradiction. Neither number was wrong. The pair was meaningless,
   because a change to what a contributor develops on had quietly become a change to what CI
   executes.

**Why this is a finding and not a footnote.** The standing checklist added in
`docs/08-conventions.md` §10 lists seven commands and does not list "read the CI run". It was
written the day before this, specifically to stop a wave being called done on partial evidence, and
it would not have caught any of the five. A checklist whose green means less than a reader assumes
is exactly the failure MK-006 taught, one level up.

**Consequence beyond the tests, now fixed.** Because the fork gate never reached its post step,
the `actions/cache` save was skipped on all four runs, so `anvil-fork-31611-15043414` was never
written once and every run paid a cold warm up of 85 to 122 seconds. That is self perpetuating: red
job, no save, cold next run. `actions/cache` is now split into an `actions/cache/restore@v4` step
before the tests and an `actions/cache/save@v4` step guarded by
`if: always() && steps.anvil-fork-cache.outputs.cache-hit != 'true'` after them, so a failed run
still keeps the state it fetched. `continue-on-error: true` on the save, because a cache problem
must never be the reason a green run reports red.

**Fixed, in three parts, one per cause.**

1. **The coupling is gone.** No job in any workflow reads `node-version-file` any more. All three
   that did (`ci.yml` `fork-gate`, `release.yml` `publish` and `verify-published`) declare
   `node-version: 24.19.0` explicitly, with the reason in a comment beside each. The other two jobs
   already declared their own and were checked, not assumed. The rule is stated in
   `docs/08-conventions.md` §1: **CI runtime versions are declared in the workflow, never inherited
   from the development pin.** `.nvmrc` still says 24.19.0, so nothing about CI moved; what changed
   is that the next edit to `.nvmrc` cannot move it either.

2. **The two evidence sources are required to meet.** `docs/08-conventions.md` §10 gains two rules
   rather than two suggestions. Step 2 now requires the fork suite to be run locally on the Node
   version the fork gate DECLARES, and to report that version. Step 9 requires the CI run on `main`
   to be read after a merge, and makes a red trunk block the next wave. Those two are exactly the
   absences that produced this finding: without the first, local and CI cannot be compared; without
   the second, five red merges accumulate unremarked.

3. **The failure surfaces sooner.** MK-028's pin runs in the `unit` project across the whole
   `Checks` matrix, so a Node that breaks the react environment fails in a job of about 80 seconds
   rather than only in the fork gate.

**Deliberately NOT done, and why it is not "still open" here.** Whether the fork gate should be
matrixed across 20, 22 and 24 rather than run on one declared version is a real question, and it is
recorded in `docs/07-testing.md` §5 next to the falsified claim that motivated it. It is not part of
this finding: MK-029 is about a silent coupling and an unenforced comparison, and both are closed.
Matrixing is a scope decision about cost, and a decision that is not blocked on anything here.
Separately, the note on GitHub's Node 20 ACTION runtime deprecation in the same section is a
different subject entirely, about the runtime GitHub uses to execute a JavaScript action, and must
not be conflated with either.

---

## Open questions and their answers

| # | Question | Answer |
|---|---|---|
| Q1 | Does the contracts package version we pin differ from the one Mezo's dApp resolves? | Closed. Across both testnet and mainnet deployment sets, no contract address changed between the two versions, including the hint helpers, sorted troves, and interest rate manager. What changed: proxy implementation targets behind three contracts, one removed function and one changed event signature on the trove manager, and a set of new functions on the PCV. The SDK touches none of those surfaces. |
| Q2 | Is the fee exempt set non empty on chain? | Closed. **Yes on mainnet, no on testnet.** At mainnet block 11330182 two accounts are fee exempt, out of four granted over the chain's history with two since removed; both are code free and neither matches any address the protocol is known to own. At testnet block 15043414 the set is empty. Established by a genesis to pin scan of `FeeExemptAccountAdded` and `FeeExemptAccountRemoved`, every granted address then re-checked against `isAccountFeeExempt` at the pinned block. This assigns MK-018 its class, S1. Recorded in `docs/09-review-and-validated-surface.md` §6. |
| Q3 | Which contract revision is ground truth? | Closed. The right question is which implementation sits behind each proxy on chain, and it now has an answer: at testnet block 15043414 and mainnet block 11330182, the EIP-1967 implementation behind every bundled proxy matches the deployment record in `@mezo-org/musd-contracts@1.1.0`, the version `packages/core/package.json` actually pins, on both chains. Six of the seven bundled addresses are proxies of that shape; `musd` has an empty implementation slot, so it is not a transparent proxy of that shape and there is nothing to compare. So the pinned package IS ground truth for the deployed code at those blocks. Recorded in `docs/09-review-and-validated-surface.md` §6. |
| Q4 | Does the SDK bundle a mainnet interest rate manager? | Yes. It is present in the source and in the published package, and matches both the contracts package deployment record and Mezo's own literal. No gap here. |
