# Live testnet ledger

The confirmation a fork cannot give: real signed transactions against the real deployment, the real
native-precompile oracle and real gas. Recorded here so someone who was not present can read what was
actually exercised, and what was not.

**Produced by** `scripts/testnet-e2e.ts`. Re-runnable: see `docs/12-release-runbook.md` §1.

---

## The run

| | |
|---|---|
| Chain | **Mezo testnet, chain id 31611** |
| Blocks | **15153708 to 15153787** |
| Account | `0x18B0Da56B272b4FAAbdd8D60E3797e8cC17d248D` |
| Funded | 0.05 BTC, testnet faucet |
| SDK | `@musd-kit/core` and `@musd-kit/react` at 0.2.0 |

**About that address, since the question is reasonable.** It is included rather than omitted, because
the transaction hashes below are only checkable with it and a ledger nobody can check is decoration.
It is a **testnet-only key generated for this run and nothing else**. It is not a project address, it
holds nothing on mainnet, and no mainnet address appears anywhere in this repository. The key lives
in a gitignored directory, has never been printed, and appears in no tracked file and in no commit.

---

## What it exercised

Each row asserts what the differential harness asserts: the preview's **verdict** against what the
chain did, and its **numbers** against what the chain recorded.

| Surface | | Preview verdict vs chain outcome |
|---|---|---|
| `previewOpen` | ✓ | **Found MK-047.** Said `viable=true []` for an owner who already held a Trove; the contract refuses with `BorrowerOps: Trove is active` |
| `openTrove` | ✓ | `0xc497bc8168bda9db0ee30fe1e20d573660fd86363274dfb3fbe1d41a50dff95b`, block 15153708 |
| `getTrove` | ✓ | the parity oracle for every row below |
| `getBorrowingCapacity` | ✓ | capacity 2547.885141498034898134 MUSD, remaining 546.084973396565529356 |
| `getBorrowingPower` | ✓ | 2345.400054490963642057 MUSD |
| `previewAdjustTrove` (add) | ✓ | predicted `resultingCollateral`; chain recorded `38355271423872701` **to the wei** |
| `addCollateral` | ✓ | `0x10cd0d7e2d4976a4761a94aa472ce9998da02e011d555a57763b19e04a7f5624`, block 15153775 |
| `previewBorrow` | ✓ | predicted `2101900175713611377930`; chain `2101900182057063052223`, drift **9s of interest** |
| `borrow` | ✓ | `0x16620896c61b4ac22d4ce1c239e18cf4a7b0f772d19601bf5176b692c77e16c3`, block 15153778 |
| `previewAdjustTrove` (repay) | ✓ | verdict held |
| `repay` | ✓ | `0xcac984fa7c6d6e9280e3f9177d52abff9f4e24fac1b9ff11e0dd358aa34140bf`, block 15153780 |
| `maxWithdrawableCollateral` | ✓ | 0.010282254652922436 BTC, `limitedBy ICR`. **The reported max was viable and one wei more was not, on the real chain** |
| `previewWithdrawCollateral` | ✓ | chain recorded `35784707760642092` **to the wei** |
| `withdrawCollateral` | ✓ | `0x47d71db752e325537c59d2c628ba4244096baa3f53112c28136efcf9c28e2f53`, block 15153782 |
| `previewAdjustTrove` (combined) | ✓ | drift **9s of interest** |
| `adjustTrove` | ✓ | `0x92696346e55bd806279a1b8cbb4cc7d0e6019bcff4bb7dc4f2468d87f831367a`, block 15153785 |
| `previewRefinance` | ✓ | verdict held |
| `refinance` | ✓ | `0xcdfa10553540063b17e1f3bcaf2ca3c70701daad29dd3d2a55918647e3c9212b`, block 15153787 |
| `previewClose` | ✓ | `musdRequired` matched `entireDebt - 200` **to the wei**; reported the exact shortfall |

## What it did not exercise, and why

| Surface | Why not |
|---|---|
| `close` | **MK-045.** A Trove cannot be closed with only the MUSD it drew: the borrowing fee is minted to the PCV (`BorrowerOperations.sol:602-611`) and never paid out, while closing needs `entireDebt - 200` in hand (`:963`). Shortfall measured at 2.301986205710419533 MUSD |
| `liquidate`, `batchLiquidate` | Need a Trove below MCR to exist. Creating one requires moving the oracle, which is not possible on live testnet |
| `claim` | Pays a surplus that exists only after this account has been liquidated or fully redeemed against. Unreachable in a self-contained run. The call was made and correctly reported no surplus |

---

## What the run found

Three findings, all registered in [`FINDINGS.md`](../FINDINGS.md).

**MK-047, S2.** `previewOpen` returned `viable: true` for an owner who already held an active Trove.
`_openTrove` calls `_requireTroveisNotActive` first (`:633`, `:1140-1149`) and the SDK never read the
status. **A thousand fork sweep cases could not have caught it**, because every generated open case
used a fresh account, so no case could express the state. That is the finding behind the finding: a
sweep proves what its generator can express, and the case count says nothing about that.

**MK-046, S3.** The first invocation failed comparing a preview taken before a write against a read
taken after it, by `1903035502288` wei, which is exactly **3.00 seconds** of interest at 100 bps on
2001.8 MUSD. The preview was right. **A fork cannot surface this** because anvil mines on demand and
no wall clock time passes.

**MK-045, S3, a property of the protocol.** Documented in `docs/03-core-api.md` where an integrator
building a close button will meet it.

---

## What the numbers cost

```
funded            0.05 BTC
gas consumed      0.000000000413540182 BTC     (the entire lifecycle, at 146 wei)
```

Gas is four orders of magnitude below even the floored reserve the plan sets aside. **The constraint
on a live run is collateral, not gas**, which is why `--plan` sizes the position from the chain
rather than from a constant.
