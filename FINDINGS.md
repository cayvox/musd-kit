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
| MK-001 | `isLiquidatable` applies a Recovery Mode rule the protocol does not have | S1 | open |
| MK-002 | `maxBorrowingCapacity` is not modeled anywhere in the SDK | S1 | open |
| MK-003 | Refinancing fee is not modeled | S1 | open |
| MK-004 | Recovery Mode borrowing fee skip is not modeled | S1 | open |
| MK-005 | `previewOpen.meetsRecoveryRequirement` is vacuous in normal mode, and no TCR check | S1 | open |
| MK-006 | Hint NICR is fed entire debt, and repay ignores interest first ordering | S2 | open |
| MK-007 | `claim()` swallows every error | S2 | open |
| MK-008 | `verifyDeployment()` is weak and off the critical path | S2 | open |
| MK-009 | Address overrides accept any string | S2 | open |
| MK-010 | `getBorrowingPower` performs unbounded RPC iteration | S2 | open |
| MK-011 | `maxFeePercentage` is advisory only | S2 | open |
| MK-012 | Governable constants are cached for the client lifetime | S2 | open |
| MK-013 | Price is read outside the multicall, so price and ICR can straddle blocks | S2 | open |
| MK-014 | `redeem` returns a rate in a field named `fee`, and caps against the wrong getter | S1 | open |
| MK-015 | Documentation claims that overstate reality | S3 | open |
| MK-016 | Test suite is one stateful sequence with unpinned fork and flake mitigations | S3 | open |
| MK-017 | Duplicated derivations and placeholder values | S3 | open |
| MK-018 | Fee exemption is not modeled | TBD | open |
| MK-019 | `refinance()` reverts in Recovery Mode, which the SDK neither checks nor documents | S2 | open |
| MK-020 | Oracle shim seed is not pinned, so a pinned fork block is not a pinned price | S3 | fixed |
| MK-021 | Phase 3 warm up hook exceeds its fixed budget on a cold fork, skipping the whole file | S3 | fixed |

---

## MK-001 · `isLiquidatable` applies a Recovery Mode rule the protocol does not have

**Class** S1 · **Status** open

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

---

## MK-002 · `maxBorrowingCapacity` is not modeled anywhere in the SDK

**Class** S1 · **Status** open

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

---

## MK-003 · Refinancing fee is not modeled

**Class** S1 · **Status** open

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

---

## MK-004 · Recovery Mode borrowing fee skip is not modeled

**Class** S1 · **Status** open

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

---

## MK-005 · `previewOpen.meetsRecoveryRequirement` is vacuous in normal mode, and no TCR check

**Class** S1 · **Status** open

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

---

## MK-006 · Hint NICR is fed entire debt, and repay ignores interest first ordering

**Class** S2 · **Status** open

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

## MK-014 · `redeem` returns a rate in a field named `fee`, and caps against the wrong getter

**Class** S1 · **Status** open

**SDK location.** `packages/core/src/redemption/redeem.ts`. The returned `fee` is a rate, not an
amount, and the cap compares the no argument `redemptionRate()` rather than the amount aware
`getRedemptionRate(collateralDrawn)`.

**Blast radius.** A caller reading `fee` as an amount is off by orders of magnitude. Classed S1
because it is a silently wrong number in a field whose name asserts otherwise.

**Decision.** Fix now. Rename to make the unit explicit, return both the rate and the estimated
amount, and cap against the amount aware getter.

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
| The fork is pinned to a block for determinism | **done** | `MEZO_FORK_BLOCK` set in `.github/workflows/ci.yml`, read by the harness at `packages/core/test/harness/anvil.ts:81`, and the oracle seed is read at that same block so the price is pinned with it (MK-020). Pinning is still not order independence, see MK-016 |
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

**Class** to be decided by the live read · **Status** open

`GovernableVariables.isAccountFeeExempt` zeroes the borrowing fee on open, on debt increase, and on
refinance. The SDK does not model it. Neither does Mezo's production dApp.

Severity depends on whether the exempt set is non empty on chain, which is answered by the event
scan recorded in `docs/09-review-and-validated-surface.md`. Empty set means a documented limit.
Non empty means a wrong number for that cohort.

---

## MK-019 · `refinance()` reverts in Recovery Mode, unchecked and undocumented

**Class** S2 · **Status** open · **Found by us during remediation**

**Ground truth.** The refinance path calls `_requireNotInRecoveryMode(price)` before anything else,
so a refinance attempted in Recovery Mode always reverts.

**SDK location.** `packages/core/src/trove/index.ts:274-284`. No mode check, and the docstring for
`refinance()` does not mention the restriction. Simulate before send catches it, so the user sees a
mapped revert rather than a bad transaction, which is why this is S2 and not S1.

**Decision.** Fix now, alongside MK-003: surface the restriction in the preview and in the
docstring.

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

## Open questions and their answers

| # | Question | Answer |
|---|---|---|
| Q1 | Does the contracts package version we pin differ from the one Mezo's dApp resolves? | Closed. Across both testnet and mainnet deployment sets, no contract address changed between the two versions, including the hint helpers, sorted troves, and interest rate manager. What changed: proxy implementation targets behind three contracts, one removed function and one changed event signature on the trove manager, and a set of new functions on the PCV. The SDK touches none of those surfaces. |
| Q2 | Is the fee exempt set non empty on chain? | Pending the event scan. Decides MK-018. |
| Q3 | Which contract revision is ground truth? | Reframed. The right question is which implementation sits behind each proxy on chain. Answered by reading the proxy implementation slot at a pinned block and comparing it to the pinned package. Recorded in `docs/09`. |
| Q4 | Does the SDK bundle a mainnet interest rate manager? | Yes. It is present in the source and in the published package, and matches both the contracts package deployment record and Mezo's own literal. No gap here. |
