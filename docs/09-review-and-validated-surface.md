# Review, validated surface, and honest limits

This page answers three questions an integrator should ask before depending on `musd-kit`:
what has been independently checked, what exactly is validated and how, and where the SDK
diverges from the protocol or from how Mezo itself uses it.

It exists because 0.1.0 shipped under the banner "correctness is the product" while carrying
claims about its own testing that were aspirations rather than facts. Correcting that is part of
the fix, not a footnote to it.

## 1. What happened

The Mezo team reviewed `musd-kit` 0.1.0 as a three way differential: the SDK against the
`mezo-org/musd` Solidity protocol, and the SDK against Mezo's own production dApp, which has no
dependency on this SDK and is therefore an independent second opinion on the same math. We thank
them for the time. Their review found no fund loss path, no supply chain problem, and no error in
the core formulas. It found that the constraints and the inputs around those correct formulas were
incomplete, and that several statements this project made about its own testing were not true.

We accepted the findings, re-verified every one of them ourselves against public sources, added
findings we located during remediation, and recorded the result in
[`FINDINGS.md`](https://github.com/cayvox/musd-kit/blob/main/FINDINGS.md) with stable IDs. Tests
and commits cite those IDs.

We do not reproduce the reviewers' document here, and we do not cite non public source paths.
Everything in the register is restated in our own words against public ground truth.

## 2. Fitness for purpose

Stated plainly, and kept current.

| Use | Verdict |
|---|---|
| Reading positions and system state on testnet | Suitable |
| Previews and calculators for a position that does not exist yet | Suitable once the S1 findings are closed, see the register for current status |
| Managing an existing trove: borrow, repay, adjust, refinance | Not yet. The existing trove paths are the ones the open only validation gate never covered |
| Liquidation keepers | Not yet. See MK-001 |
| Real money on mainnet | No. Single author, unaudited, pre 1.0. Use it to evaluate, read, and prototype |

What limits the blast radius, and is true today: the SDK has no approval flows at all, never
handles a key, simulates every write before sending, and sends the simulation's own request object
so the calldata sent is exactly the calldata simulated.

## 3. Validated surface

The precise statement, replacing the earlier "validated twice" shorthand. A green suite is only
evidence for what it actually exercises.

| Surface | How it is validated | Coverage |
|---|---|---|
| `computeICR`, `computeNICR` | Cross checked to the wei against the contract's own pure helpers on a fork of live Mezo | Full |
| `computeEntireDebt` | Cross checked against the contract's interest form | Full |
| `previewOpen`, `getBorrowingPower` | Dual validated: against a fork of the real contracts, and against the contracts' pure helpers | **Open path only** |
| `addCollateral`, `borrow`, `repay`, `withdrawCollateral`, `adjustTrove`, `refinance` | Fork exercised, not dual validated | **No preview validation** |
| Preview verdict against actual transaction outcome | The differential harness, see below | Being built |

Read the middle row twice. Until the differential harness lands, a preview being green is not
evidence that the corresponding write succeeds. The open only gate is exactly why MK-006 survived
into a published release.

## 4. Three way divergence matrix

Whether a gap is shared with Mezo's own dApp materially changes how damning it is. We record both
honestly, including the cases that are exculpatory for us.

| Finding | Protocol | Mezo's dApp | musd-kit | Verdict |
|---|---|---|---|---|
| MK-001 Recovery Mode liquidatability | Only `ICR < MCR` liquidates | Correct | Adds a rule the protocol does not have | SDK uniquely wrong |
| MK-002 Borrowing capacity | Hard on chain gate | Models it as load bearing | Absent | SDK uniquely wrong |
| MK-003 Refinancing fee | Charged and capitalized | Modeled | Absent | SDK uniquely wrong |
| MK-004 Recovery Mode fee skip | Fee skipped | Same gap | Same gap | Shared gap, protocol divergence |
| MK-018 Fee exemption | Zeroes the fee | Same gap | Same gap | Shared gap, severity pending the live read |
| MK-005 Open time TCR constraint | Enforced | Enforced in practice by the contract | Not previewed | SDK gap |

## 5. Claims and reality

Every claim this project makes about itself, with its status. A row moves to "true" only when a
check in CI makes it true.

| Claim | Status |
|---|---|
| Coverage floor enforced in CI | See MK-015 |
| Fork pinned to a block for determinism | See MK-016 and MK-020 |
| Fork price pinned with the block | See MK-020 |
| CI matrix across Node versions | See MK-015 |
| Post publish install verification | See MK-015 |
| Unit layer runs with no chain | See MK-015 |
| Live data never re-derived | See MK-015 |
| Validated twice | Replaced by section 3 |

## 6. On chain facts

Ground truth is not a memory of a value, it is a value read at a known block. This section is
generated by `scripts/onchain-facts.ts` and regenerated whenever it is cited. Values are recorded
with chain id and block number, because every one of them is governable and can change.

<!-- BEGIN ONCHAIN FACTS: generated, do not edit by hand -->

_Not yet generated. Run `pnpm facts` and commit the output._

<!-- END ONCHAIN FACTS -->

## 7. Reporting a problem

Correctness reports are as welcome as security reports. See
[`SECURITY.md`](https://github.com/cayvox/musd-kit/blob/main/SECURITY.md). If you
find something this page or the register does not cover, that gap is itself the finding, and we
want to hear about it.
