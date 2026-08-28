# Live testnet ledger

The confirmation a fork cannot give: real signed transactions against the real deployment, the real
native-precompile oracle, real gas, and other people's positions moving underneath. Recorded here so
someone who was not present can read what was exercised, what was not, and what it found.

**Produced by** `scripts/testnet-e2e.ts` and `scripts/testnet-fund.ts`. Re-runnable: see
`docs/12-release-runbook.md` §1.

---

## The run

| | |
|---|---|
| Chain | **Mezo testnet, chain id 31611** |
| Blocks | **15163946 to 15164162** |
| End to end account | `0x18B0Da56B272b4FAAbdd8D60E3797e8cC17d248D` |
| Funding account | `0x7e6D833C6b5DE1e2a740db78899daFBCCfE4D076` |
| Funded | 0.05 BTC each, testnet faucet |
| SDK | `@musd-kit/core` and `@musd-kit/react` at 0.2.0 |

**About those addresses, since the question is reasonable.** They are included rather than omitted,
because the transaction hashes below are only checkable with them and a ledger nobody can check is
decoration. Both are **testnet-only keys generated for this run and nothing else**. Neither is a
project address, neither holds anything on mainnet, and no mainnet address appears anywhere in this
repository. The keys live in a gitignored directory, have never been printed, and appear in no
tracked file and in no commit.

---

## Why there are two accounts

**MUSD only comes into existence by opening a Trove**, so there is no faucet for it. The end to end
account could not close its position, because a Trove cannot be closed with only the MUSD it drew
(MK-045). Rather than transfer MUSD from somewhere, the shortfall was minted **with the SDK itself**,
which makes the funding step another real use of the thing being published.

| Step | | Evidence |
|---|---|---|
| `previewOpen`, funder | ✓ | `viable=true reasons=[]`, entireDebt 2001.8 MUSD, icr 1950000000000000038 |
| `openTrove`, funder | ✓ | `0xa4811028057990dabd2086ef0c82e39e9dc6e4589f3357c261b9d09df1853a44`, block 15163946 |
| parity | ✓ | chain 2001800001903035502288 vs preview 2001800000000000000000, drift **2s of interest** |
| transfer 60 MUSD | ✓ | `0xef1106cb1fc533ca9ea2f0b1eebfffc5c074b7354d305a7beb4de95cf8c5b2cc`, block 15163948. Recipient 1875 -> 1935, **exactly 60** |

---

## What the end to end run exercised

Each row asserts what the differential harness asserts: the preview's **verdict** against what the
chain did, and its **numbers** against what the chain recorded.

| Surface | | Preview verdict vs chain outcome |
|---|---|---|
| `previewOpen` | ✓ | verdict held; entireDebt matched with **0 wei drift** |
| `openTrove` | ✓ | `0x326230c699e2f2e54eec51b237dd679c72553e98d1de854f03c1f2adc940385e`, block 15164067 |
| `getTrove` | ✓ | the parity oracle for every row |
| `getBorrowingCapacity` | ✓ | 2547.712576906164721848 MUSD |
| `getBorrowingPower` | ✓ | 2345.423453431680586229 MUSD |
| `previewAdjustTrove` (add) | ✓ | chain recorded the predicted collateral **to the wei** |
| `addCollateral` | ✓ | `0xab0a3ab269d04aa8c22a613494f60bdad6f24f70c145d5da091456f78b222ed0`, block 15164070 |
| `previewBorrow` | ✓ | chain 2101900015953790467468 vs preview 2101900006977796841722, drift **13s of interest** |
| `borrow` | ✓ | `0xe1e94f7cc7b504db518870db89e36cfdb937a841e407c36db04db770f55c9c3f`, block 15164072 |
| `previewAdjustTrove` (repay) | ✓ | verdict held |
| `repay` | ✓ | `0xaee44359017e5bc6bed18e186d1fbfe039ce6870d0b5b086af0d3961e43aad11`, block 15164075 |
| `maxWithdrawableCollateral` | ✓ | **the reported max was viable and one wei more was not, on the real chain** |
| `previewWithdrawCollateral` | ✓ | chain recorded the predicted collateral **to the wei** |
| `withdrawCollateral` | ✓ | `0x654972014547e60367623c66e5584cb0090f2eed796d0032f4158c2352066bc7`, block 15164078 |
| `previewAdjustTrove` (combined) | ✓ | drift **9s of interest** |
| `adjustTrove` | ✓ | `0x690369800fd906259528a5cea5823f1f55ab78b1622622bd4eae74aeda8c5652`, block 15164081 |
| `previewRefinance` | ✓ | verdict held |
| `refinance` | ✓ | `0x4118e373992a58393557979e23a5b4bcad122f365122b9753cb20dd7dcc05e07`, block 15164084 |
| `redeem` | ✓ | see below |
| `previewClose` | ✓ | `musdRequired` matched `entireDebt - 200` **to the wei**, shortfall 0 |
| `close` | ✓ | `0x8aefd826d87a50ba5fb96cce204de7f752bf1bbab9048e0f29998b3daf70b16c`, block 15164162. `getTrove.exists` is **false** |

**20 exercised, 3 skipped.**

### The redemption, checked field by field

The naming of these fields was itself a finding (MK-014: `redeem` used to return a RATE in a field
called `fee`), so they are checked against the authoritative `Redemption` event rather than trusted.

`0x87e9e47c5be7ee5e2361ace609604f2adcbdf8e5b08e26afef2178e64ac04f88`, block 15164160, 5 MUSD.

| SDK result | value | chain event | value | agreement |
|---|---|---|---|---|
| `truncatedAmount` | 5000000000000000000 | `_actualAmount` | 5000000000000000000 | **exact** |
| `redemptionRate` | 7500000000000000 | (a rate, 0.75%) | | consistent: fee/drawn = 0.0075 |
| `estimatedCollateralDrawn` | 62735062460361 | `_collateralSent` | 62740075368949 | estimate low by **0.0080%** |
| `estimatedFeeCollateral` | 470512968452 | `_collateralFee` | 470550565267 | estimate low by **0.0080%** |

Both estimates are low by the same 0.0080%, which is the price moving between the hint read and the
mining block. **The field names say "estimated" and the docstring names the event as authoritative**,
so this is the SDK being accurate about its own precision rather than a discrepancy.

And the collateral actually received reconciles to the wei:

```
_collateralSent - _collateralFee - gas
  = 62740075368949 - 470550565267 - 59633262
  = 62269465170420        measured balance delta: 62269465170420   EXACT
```

**It touches another account's position, and that is stated rather than glossed.** Redemption acts
on the lowest-ICR Trove above MCR, which belongs to someone else. On testnet this is acceptable:
redemption is a permissionless protocol operation, the counterparty is compensated in collateral at
the oracle price, and no testnet position carries value. It stays behind `E2E_ALLOW_REDEEM` because
it would not be acceptable to do casually on mainnet.

## What it did not exercise, and why

| Surface | Why not |
|---|---|
| `liquidate`, `batchLiquidate` | Need a Trove below MCR to exist. Creating one requires moving the oracle, which is not possible on live testnet |
| `claim` | Pays a surplus that exists only after this account has been liquidated or fully redeemed against. The call was made and correctly reported no surplus |

---

## What the live runs found

Four findings, all registered in [`FINDINGS.md`](../FINDINGS.md), and **none of them reproducible on
a fork**.

**MK-047, S2, fixed.** `previewOpen` returned `viable: true` for an owner who already held a Trove;
`_openTrove` refuses first (`BorrowerOperations.sol:633`). A thousand sweep cases could not reach it,
because every generated open case used a fresh account. **A sweep proves what its generator can
express.**

**MK-048, S2, open.** `truncatedAmount` reports amounts as redeemable that the chain refuses. At head,
with hints computed in the same breath: 50 and 20 MUSD revert, 5 and 1 succeed. The binding quantity
is the target Trove's headroom above the debt floor, measured at 7.516876 MUSD, and
`getRedemptionHints` does not model the cancellation at `TroveManager.sol:1299-1306`. **It needs
another account's Trove to sit within a few MUSD of the floor**, which is a property of a shared
chain with real users.

**MK-046, S3, fixed.** The first invocation compared a preview taken before a write against a read
taken after it and failed by `1903035502288` wei, which is exactly **3.00 seconds** of interest.
**A fork cannot surface this** because anvil mines on demand and no wall clock time passes.

**MK-045, S3, a property of the protocol.** Documented in `docs/03-core-api.md` where an integrator
building a close button will meet it.

---

## The MK-048 verification, live

Added after the lifecycle run, once `previewRedeem` existed. **Both directions, on Mezo testnet.**

**The boundary, at pinned block 15164949**, with `getRedemptionHints`'s answer beside each. The
first eligible Trove was `0x4799e9fB361Fb6a85473bB08dA00A4012E02Cf08` with net debt
`1802519016881414909779` against a floor of `1800000000000000000000`, so the edge was
`2519016881414909779`:

| amount | hint said | chain |
|---|---|---|
| edge - 1 wei | the same | **SUCCEEDS** |
| edge exactly | the same | **SUCCEEDS** |
| edge + 1 wei | the same | **REVERT** `TroveManager: Unable to redeem any amount` |
| edge + 1 MUSD | the same | **REVERT** |

**The success direction, as a real transaction:**

```
previewRedeem said redeemable  1259575681295202401
chain burned                   1259575681295202401     EXACT
0xbb205c5b2482d12c2eb949d9c322580b6cc2aa965debc98c7a192c7e9e7f7f13, block 15165003, success
```

**The refusal direction, as a precheck:**

```
amount = edge + 1 MUSD = 2259601684480781131
previewRedeem   viable=false  binding=PARTIAL_BREACHES_DEBT_FLOOR  redeemable=0
musd.redeem()   RedemptionBreachesDebtFloor [REDEMPTION_BREACHES_DEBT_FLOOR]
                "Redeem at most 1259606123698194478, or at least 1801259606123698194478
                 to consume that Trove whole. The limit is that Trove's headroom above the
                 debt floor, not your balance."
nonce before 37, after 37   ->  NO TRANSACTION WAS SENT, no gas spent
```

There is no transaction hash for the refusal, and that is the point of the precheck rather than a
gap in the evidence: the chain's own refusal is the pinned-block simulation above.

### MK-049, found while verifying MK-048

The first attempt at the success direction **mined and reverted**. Investigated rather than retried
blindly: at 90% of the headroom the floor has roughly 190,000 seconds of interest as margin, so the
floor condition cannot be what fired, and the identical amount succeeded on the next attempt.

The partial hint carries an NICR derived at the price the hint was read at
(`HintHelpers.sol:148`); the contract derives the same quantity at the price when the transaction
MINES (`TroveManager.sol:1224-1226`). **When the oracle moves in between, the partial cancels**
(`:1299-1301`). The 600 second band at `:1276-1285` covers interest accrual, not the oracle.

**Registered separately rather than folded into MK-048**, because they are different things: one is
a state a preview can read, the other is a race a preview cannot. Retry is the mitigation and the
SDK deliberately does not do it for you.

## Final state of both accounts

At block 15164178:

| Account | BTC | MUSD | Trove |
|---|---|---|---|
| end to end | 0.050062267550891274 | 43.9704 | **none** |
| funder | 0.001087717436999878 | 1740.0000 | **open**, debt 2001.80 MUSD, ICR 194.70% |

**The funder's position is left open, deliberately and on the record.** It cannot close from within
itself for the same reason the end to end account could not: it is short `61.8006` MUSD, which is its
own borrowing fee plus the 60 it sent away. **Its 0.0489 BTC of collateral is not lost**; it is
recoverable whenever that MUSD is obtained from elsewhere.

**Two independent demonstrations of MK-045, which is the point.** The end to end account was short by
exactly its fee. The funder is short by its fee plus what it gave away. Neither could be resolved
from within the position, and both needed MUSD from outside. **That is the case an integrator hits
the first time a user asks to close a position they borrowed the maximum against.**
