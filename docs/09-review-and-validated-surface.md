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
| `previewBorrow`, `previewRefinance` | Fork exercised end to end against the contract's own gates, plus exhaustive chain-free tests of the verdict as a pure function | **Verdict and fee validated; not yet compared against a reverting write for every reason** |
| Insertion hints on every existing-trove write path | Pinned on a fork against `getNominalICR` after the write, including a repay at, below and above interest owed | Full for the paths exercised |
| Preview verdict against actual transaction outcome | The differential harness, see below | Being built |
| Borrowing capacity ratchet, `min(current, recalculated)` on a collateral decrease | Reasoned from `BorrowerOperations.sol:879-897`, **not observed executing** | **Owed to the differential harness** (MK-002) |
| Fee exemption on the DEBT INCREASE path, not just on open | Reasoned from `BorrowerOperations.sol:810-818`, **not observed executing** | **Owed to the differential harness** (MK-018) |
| Deployment identity: code at all seven addresses, fourteen cross wiring pointers, `HintHelpers.priceFeed()` unset | Chain-free against a constructed lookalike and a bent pointer, plus the real deployment on a fork, and gated before the first write | Full for the pointer set `docs/09` §6 records; the "has code but is not the one the deployment points at" case is pinned chain free only (MK-008) |
| One block snapshot for `getTrove`, `getSystemState`, `isLiquidatable` | Fork exercised: blocks are mined after the read, then `icr` and `price` are reconciled at the REPORTED block | Full for those three. `previewOpen`, `previewBorrow`, `previewRefinance` and `getBorrowingPower` still read the price separately and make **no** single block claim (MK-013) |
| `getBorrowingPower` closed form against the live fee | Fork exercised: affinity of `getBorrowingFee` asserted at the live rate, the closed form compared to the search to the wei, and the search kept as the fallback | **Full at the CURRENT rate only.** The rate is governable, so affinity is a property of today's implementation, not a guarantee (MK-010) |
| Simulate before send, as a limit on blast radius | Fork exercised on every write; the limits are now MEASURED rather than assumed | **Partial, and the gap is quantified.** It catches every condition true at simulate time. It does NOT catch a condition that becomes true afterwards, nor gas exhaustion, because the limit comes from an estimate taken before the mining block. Measured: the same call's gas varied up to 10.16% across paths and 16.4% in one traced case, against a 1.5% margin (MK-035) |
| Gas margin on writes, 25% over the estimate | Sized from a per path spread table, 12 attempts per path from byte identical state; pinned by a findings test that flipped when the fix landed | Full for the nine measurable paths. `claim` is unmeasured, since it sends no transaction without a surplus. The 0% rows are a small window, not a safe path (MK-035) |
| Telling an out of gas revert from a protocol one | `diagnoseRevertedWrite`, from evidence a consumer has without tracing | **Two of three cases decidable.** `gasUsed === gasLimit` and a still reverting replay are conclusive; everything else is `INDETERMINATE`, because a nested exhaustion leaves gas at the top level and a replay runs against end of block state. Separating those needs `debug_traceTransaction` (MK-035) |
| `@musd-kit/react`, the whole published hook layer | Fork exercised via React Testing Library against a fork-backed wagmi config | **Not measured by the coverage gate at all.** The floor covers `packages/core/src` only, so no number on this page or in CI describes how much of the React package is exercised |

Read the **open path only** row twice. Until the differential harness lands, a preview being green
is not evidence that the corresponding write succeeds.

That row is also the clearest lesson this project has learned about its own testing, so it is worth
stating outright rather than leaving to be inferred:

> **A gate that covers only the case where two quantities coincide cannot tell you which one was
> meant.**

That is exactly why the dual validation gate could never have caught MK-006. Every insertion hint
was computed from the ENTIRE debt, while `SortedTroves` sorts by PRINCIPAL. At open those two
quantities are equal, because no interest has accrued yet, so the one path the gate covered was the
one path where the distinction is invisible. The gate was green, repeatedly, on a value that was
right by coincidence. It stayed green while every write path against an existing Trove placed hints
by a number the contract does not sort by, and it survived into a published release.

The generalisation, which is what makes it worth writing down: when validation is scoped to a
single case, check whether that case is degenerate before trusting the result. A boundary where two
inputs happen to be identical is the worst possible place to test a rule that distinguishes them.

The two rows marked **owed** are obligations on that harness, not footnotes. Both are branches the
P3a wave implemented from the Solidity and could not drive on a fork: the capacity ratchet needs a
collateral withdrawal that lowers the recalculated value below the stored one, and the exempt fee
skip on a debt increase needs an exempt account that already holds a Trove. They are listed here so
the harness is designed to reach them, rather than being built first and pointed at them after.

## 4. Three way divergence matrix

Whether a gap is shared with Mezo's own dApp materially changes how damning it is. We record both
honestly, including the cases that are exculpatory for us.

| Finding | Protocol | Mezo's dApp | musd-kit | Verdict |
|---|---|---|---|---|
| MK-001 Recovery Mode liquidatability | Only `ICR < MCR` liquidates | Correct | Adds a rule the protocol does not have | SDK uniquely wrong |
| MK-002 Borrowing capacity | Hard on chain gate | Models it as load bearing | Absent | SDK uniquely wrong |
| MK-003 Refinancing fee | Charged and capitalized | Modeled | Absent | SDK uniquely wrong |
| MK-004 Recovery Mode fee skip | Fee skipped | Same gap | Same gap | Shared gap, protocol divergence |
| MK-018 Fee exemption | Zeroes the fee | Same gap | Same gap | Shared gap, and **S1**: the exempt set is non empty on mainnet, see §6 |
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

Generated by `scripts/onchain-facts.ts` (`pnpm facts`). Do not edit by hand.

Every value carries the chain id and the block it was read at, because every one of them
is governable and can change without notice. A value without a block number is a memory,
not a fact. Regenerate before any release.

### Mezo testnet (chain id 31611)

Read at block **15043414**. Every value below is governable unless it
is marked as a contract constant, so it is a fact about that block and not a
permanent property of the protocol.

Contracts package pinned by this repository: `1.1.0`.

#### Governable values and constants

| Value | Read at the pinned block | Note |
|---|---|---|
| `minNetDebt()` | `1800000000000000000000` (1800) |  |
| `interestRate()` | `100` bps (1%) |  |
| `borrowingRate()` | `1000000000000000` (0.001) |  |
| `redemptionRate()` | `7500000000000000` (0.0075) |  |
| `getRedemptionRate(0.01 BTC)` | `75000000000000` (0.000075) | returns a fee AMOUNT in BTC wei, not a rate, despite the name |
| `getRedemptionRate(0.1 BTC)` | `750000000000000` (0.00075) | returns a fee AMOUNT in BTC wei, not a rate, despite the name |
| `getRedemptionRate(1 BTC)` | `7500000000000000` (0.0075) | returns a fee AMOUNT in BTC wei, not a rate, despite the name |
| `getBorrowingFee(1,800 MUSD)` | `1800000000000000000` (1.8) |  |
| `getBorrowingFee(10,000 MUSD)` | `10000000000000000000` (10) |  |
| `getBorrowingFee(100,000 MUSD)` | `100000000000000000000` (100) |  |
| `refinancingFeePercentage()` | `20` (20% of the pre-fee debt) |  |
| `MCR()` | `1100000000000000000` (1.1) | matches the SDK bundled constant |
| `CCR()` | `1500000000000000000` (1.5) | matches the SDK bundled constant |
| `MUSD_GAS_COMPENSATION()` | `200000000000000000000` (200) | matches the SDK bundled constant |

Every SDK bundled constant compared here matches its on chain value.

#### Cross wiring

| Value | Read at the pinned block | Note |
|---|---|---|
| `TroveManager.sortedTroves()` | `0x722E4D24FD6Ff8b0AC679450F3D91294607268fA` | matches bundled sortedTroves |
| `TroveManager.borrowerOperations()` | `0xCdF7028ceAB81fA0C6971208e83fa7872994beE5` | matches bundled borrowerOperations |
| `TroveManager.interestRateManager()` | `0xD4D6c36A592A2c5e86035A6bca1d57747a567f37` | matches bundled interestRateManager |
| `TroveManager.priceFeed()` | `0x86bCF0841622a5dAC14A313a15f96A95421b9366` | matches bundled priceFeed |
| `TroveManager.musdToken()` | `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` | matches bundled musd |
| `BorrowerOperations.troveManager()` | `0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0` | matches bundled troveManager |
| `BorrowerOperations.interestRateManager()` | `0xD4D6c36A592A2c5e86035A6bca1d57747a567f37` | matches bundled interestRateManager |
| `BorrowerOperations.priceFeed()` | `0x86bCF0841622a5dAC14A313a15f96A95421b9366` | matches bundled priceFeed |
| `BorrowerOperations.musd()` | `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` | matches bundled musd |
| `HintHelpers.troveManager()` | `0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0` | matches bundled troveManager |
| `HintHelpers.sortedTroves()` | `0x722E4D24FD6Ff8b0AC679450F3D91294607268fA` | matches bundled sortedTroves |
| `HintHelpers.borrowerOperations()` | `0xCdF7028ceAB81fA0C6971208e83fa7872994beE5` | matches bundled borrowerOperations |
| `HintHelpers.priceFeed()` | `0x0000000000000000000000000000000000000000` | inherited from LiquityBase and never assigned by `setAddresses`, so zero is correct, not a wiring gap |
| `SortedTroves.troveManager()` | `0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0` | matches bundled troveManager |
| `SortedTroves.borrowerOperationsAddress()` | `0xCdF7028ceAB81fA0C6971208e83fa7872994beE5` | matches bundled borrowerOperations |
| `MUSD.symbol()` | `MUSD` |  |
| `MUSD.decimals()` | `18` |  |
| `PriceFeed.oracle()` | `0x7b7c000000000000000000000000000000000015` | the BTC/USD source, not part of the bundled map |

Every pointer that exists resolves to the bundled address.

#### Code and proxy implementations

| Value | Read at the pinned block | Note |
|---|---|---|
| `borrowerOperations` | `0xCdF7028ceAB81fA0C6971208e83fa7872994beE5` | code present, 1159 bytes |
| `troveManager` | `0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0` | code present, 1159 bytes |
| `sortedTroves` | `0x722E4D24FD6Ff8b0AC679450F3D91294607268fA` | code present, 1159 bytes |
| `hintHelpers` | `0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6` | code present, 1159 bytes |
| `priceFeed` | `0x86bCF0841622a5dAC14A313a15f96A95421b9366` | code present, 1159 bytes |
| `interestRateManager` | `0xD4D6c36A592A2c5e86035A6bca1d57747a567f37` | code present, 1159 bytes |
| `musd` | `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` | code present, 6437 bytes |

| Value | Read at the pinned block | Note |
|---|---|---|
| `borrowerOperations` | `0xc05Bf344BD5b58825784326dD3112fB6cC160dcC` | matches the 1.1.0 record |
| `troveManager` | `0x9aAB567966983e95536FC460C12266FB0Cc10B07` | matches the 1.1.0 record |
| `sortedTroves` | `0x9177DF58A9614b84C8c2F68dF27506AB9a5d0323` | matches the 1.1.0 record |
| `hintHelpers` | `0x8adF3f35dBE4026112bCFc078872bcb967732Ea8` | matches the 1.1.0 record |
| `priceFeed` | `0xec42B37C12b8D73d320f4075A1BCd58B306629c1` | matches the 1.1.0 record |
| `interestRateManager` | `0xAA13B1d9CFFA3F44ab3A8BE0dC8774FB7841459C` | matches the 1.1.0 record |
| `musd` | slot empty | not a transparent proxy of the EIP-1967 shape, so there is no implementation to compare |

Every implementation found matches the pinned package deployment record.

#### Fee exemption (MK-018)

`GovernableVariables` at `0x6552059B6eFc6aA4AE3ea45f28ED4D92acE020cD`.
Events read from the deployed ABI: `FeeExemptAccountAdded`, `FeeExemptAccountRemoved`. Getter: `isAccountFeeExempt`.

Range scanned: blocks **0 to 15043414**, the whole chain up to the pin, in 1505 chunks of 10000. Genesis to the pinned block, so the scan cannot have missed an earlier grant.

Events found: 0 add, 0 remove. Every address ever added was then re-checked with `isAccountFeeExempt` at the pinned block, so a removal is confirmed by the contract rather than inferred from event pairing.

**The fee exempt set is empty at this block.** No address is fee exempt on this chain as of block 15043414.

**Single provider result.** `MEZO_TESTNET_RPC_URL_SECOND` is not set, so the result rests on one provider. No account was ever granted exemption on this chain, so there were no getter answers to confirm; what rests on the single provider here is the log scan itself.

### Mezo mainnet (chain id 31612)

Read at block **11330182**. Every value below is governable unless it
is marked as a contract constant, so it is a fact about that block and not a
permanent property of the protocol.

Contracts package pinned by this repository: `1.1.0`.

#### Governable values and constants

| Value | Read at the pinned block | Note |
|---|---|---|
| `minNetDebt()` | `1800000000000000000000` (1800) |  |
| `interestRate()` | `100` bps (1%) |  |
| `borrowingRate()` | `1000000000000000` (0.001) |  |
| `redemptionRate()` | `7500000000000000` (0.0075) |  |
| `getRedemptionRate(0.01 BTC)` | `75000000000000` (0.000075) | returns a fee AMOUNT in BTC wei, not a rate, despite the name |
| `getRedemptionRate(0.1 BTC)` | `750000000000000` (0.00075) | returns a fee AMOUNT in BTC wei, not a rate, despite the name |
| `getRedemptionRate(1 BTC)` | `7500000000000000` (0.0075) | returns a fee AMOUNT in BTC wei, not a rate, despite the name |
| `getBorrowingFee(1,800 MUSD)` | `1800000000000000000` (1.8) |  |
| `getBorrowingFee(10,000 MUSD)` | `10000000000000000000` (10) |  |
| `getBorrowingFee(100,000 MUSD)` | `100000000000000000000` (100) |  |
| `refinancingFeePercentage()` | `20` (20% of the pre-fee debt) |  |
| `MCR()` | `1100000000000000000` (1.1) | matches the SDK bundled constant |
| `CCR()` | `1500000000000000000` (1.5) | matches the SDK bundled constant |
| `MUSD_GAS_COMPENSATION()` | `200000000000000000000` (200) | matches the SDK bundled constant |

Every SDK bundled constant compared here matches its on chain value.

#### Cross wiring

| Value | Read at the pinned block | Note |
|---|---|---|
| `TroveManager.sortedTroves()` | `0x8C5DB4C62BF29c1C4564390d10c20a47E0b2749f` | matches bundled sortedTroves |
| `TroveManager.borrowerOperations()` | `0x44b1bac67dDA612a41a58AAf779143B181dEe031` | matches bundled borrowerOperations |
| `TroveManager.interestRateManager()` | `0x4a453700d157717Fe02fB62E7700ED7845048285` | matches bundled interestRateManager |
| `TroveManager.priceFeed()` | `0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88` | matches bundled priceFeed |
| `TroveManager.musdToken()` | `0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186` | matches bundled musd |
| `BorrowerOperations.troveManager()` | `0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193` | matches bundled troveManager |
| `BorrowerOperations.interestRateManager()` | `0x4a453700d157717Fe02fB62E7700ED7845048285` | matches bundled interestRateManager |
| `BorrowerOperations.priceFeed()` | `0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88` | matches bundled priceFeed |
| `BorrowerOperations.musd()` | `0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186` | matches bundled musd |
| `HintHelpers.troveManager()` | `0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193` | matches bundled troveManager |
| `HintHelpers.sortedTroves()` | `0x8C5DB4C62BF29c1C4564390d10c20a47E0b2749f` | matches bundled sortedTroves |
| `HintHelpers.borrowerOperations()` | `0x44b1bac67dDA612a41a58AAf779143B181dEe031` | matches bundled borrowerOperations |
| `HintHelpers.priceFeed()` | `0x0000000000000000000000000000000000000000` | inherited from LiquityBase and never assigned by `setAddresses`, so zero is correct, not a wiring gap |
| `SortedTroves.troveManager()` | `0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193` | matches bundled troveManager |
| `SortedTroves.borrowerOperationsAddress()` | `0x44b1bac67dDA612a41a58AAf779143B181dEe031` | matches bundled borrowerOperations |
| `MUSD.symbol()` | `MUSD` |  |
| `MUSD.decimals()` | `18` |  |
| `PriceFeed.oracle()` | `0x7b7c000000000000000000000000000000000015` | the BTC/USD source, not part of the bundled map |

Every pointer that exists resolves to the bundled address.

#### Code and proxy implementations

| Value | Read at the pinned block | Note |
|---|---|---|
| `borrowerOperations` | `0x44b1bac67dDA612a41a58AAf779143B181dEe031` | code present, 1159 bytes |
| `troveManager` | `0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193` | code present, 1159 bytes |
| `sortedTroves` | `0x8C5DB4C62BF29c1C4564390d10c20a47E0b2749f` | code present, 1159 bytes |
| `hintHelpers` | `0xD267b3bE2514375A075fd03C3D9CBa6b95317DC3` | code present, 1159 bytes |
| `priceFeed` | `0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88` | code present, 1159 bytes |
| `interestRateManager` | `0x4a453700d157717Fe02fB62E7700ED7845048285` | code present, 1159 bytes |
| `musd` | `0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186` | code present, 6436 bytes |

| Value | Read at the pinned block | Note |
|---|---|---|
| `borrowerOperations` | `0x501670bBBE2EC8c11449C28C0C9e6677D5eA9B61` | matches the 1.1.0 record |
| `troveManager` | `0xdcFdAB0dEA52e5EFc8400283D46Fd0D122a519e9` | matches the 1.1.0 record |
| `sortedTroves` | `0x19868D388668A8e248784E78b0C644b517feBaAE` | matches the 1.1.0 record |
| `hintHelpers` | `0x82AB5F02993bF312d9acA03157f26FeBEBc76108` | matches the 1.1.0 record |
| `priceFeed` | `0xE9cA1ABe343515312Eb6D13178C5A2DCE3c036fA` | matches the 1.1.0 record |
| `interestRateManager` | `0xF83B2E2F8Cd39Df2fB71e5dC5297A6Fc3C0B2dd3` | matches the 1.1.0 record |
| `musd` | slot empty | not a transparent proxy of the EIP-1967 shape, so there is no implementation to compare |

Every implementation found matches the pinned package deployment record.

#### Fee exemption (MK-018)

`GovernableVariables` at `0x560AC4Ea44Fb7EB2D4d3c00608CB1CAb2613d389`.
Events read from the deployed ABI: `FeeExemptAccountAdded`, `FeeExemptAccountRemoved`. Getter: `isAccountFeeExempt`.

Range scanned: blocks **0 to 11330182**, the whole chain up to the pin, in 1134 chunks of 10000. Genesis to the pinned block, so the scan cannot have missed an earlier grant.

Events found: 4 add, 2 remove. Every address ever added was then re-checked with `isAccountFeeExempt` at the pinned block, so a removal is confirmed by the contract rather than inferred from event pairing.

**The fee exempt set is NOT empty: 2 account(s).**

2 further account(s) were granted exemption at some point and are not exempt at the pin, so the mechanism is actively administered rather than merely deployed.

**What kind of accounts these are.** Of the 2 exempt at this block, 0 have non empty code and 2 have none, and 0 match an address known to the protocol, checked against 37 addresses drawn from every deployment record in the pinned contracts package, proxies and implementations alike, plus every address the SDK bundles. Across all 4 accounts ever granted: 0 with code, 4 without, 0 matching a known protocol address. Unmatched means only that: it is not evidence of who owns an account, and nothing here infers ownership.

The individual addresses are deliberately not listed here. The count, the scanned range and the characterization above are what the severity rests on, and anyone can reproduce the addresses themselves by running `pnpm facts` against the same pinned block.

**Confirmed against a second, independent provider.** All 4 historically granted account(s) were re-read with `isAccountFeeExempt` at the same pinned block through a different endpoint, and every answer agreed.

<!-- END ONCHAIN FACTS -->

## 7. Reporting a problem

Correctness reports are as welcome as security reports. See
[`SECURITY.md`](https://github.com/cayvox/musd-kit/blob/main/SECURITY.md). If you
find something this page or the register does not cover, that gap is itself the finding, and we
want to hear about it.
