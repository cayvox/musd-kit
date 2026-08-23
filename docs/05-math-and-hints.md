# Math & Hints (the correctness-critical core)

This is the heart of the library. The math here is the *only* client-side
computation in `musd-kit`, and it is held to the highest test bar
(`07-testing`). Everything is verified against `01-ground-truth` §6-§7; this
document is the implementation-level spec.

**The boundary, restated:** for a **live** position, do not use anything here, read
the contract getters (`read/`, `03-core-api` §2). The formulas below are for
**previews** of positions that do not exist yet, and for the thin derivations
(`liquidationPrice`, `healthFactor`) layered on authoritative live values.

All quantities are `bigint` in 1e18 fixed point unless noted. Rates are basis
points (`uint16` on-chain).

---

## 1. The verified quantities

| Quantity | Formula | Notes |
|---|---|---|
| Borrowing fee | `fee = getBorrowingFee(draw)` | **read on-chain**; governable (C2) |
| Net debt | `netDebt = draw + fee` | the fee is added to debt (C6) |
| Entire (composite) debt | `entireDebt = netDebt + 200e18` | + gas compensation |
| ICR | `icr = (collateral × price) / entireDebt` | 1e18 fixed point; = contract `computeCR` |
| Nominal ICR (for hints) | `nicr = (collateral × 1e20) / entireDebt` | = contract `computeNominalCR` (1e20 = 100·1e18) |
| Liquidation price | `liqPrice = (MCR × entireDebt) / collateral` | MCR = 1.1e18; price at which ICR == MCR |
| Min-debt check | `netDebt ≥ minNetDebt` | **read `minNetDebt()`**; floor on draw+fee (C1, C6) |
| Health factor | normalize `icr / MCR` → distance-to-liquidation | 1.0 at MCR, higher = safer (UI/keeper) |

`1e20` for NICR is exact: nominal CR uses `collateral × 100e18 / entireDebt`, and
`100e18 == 1e20`. Cross-check the SDK's NICR against `HintHelpers.computeNominalCR`
on the fork; they must be identical.

---

## 2. Entire-debt for a PREVIEW (no live position)

A live Trove's entire debt is read from `getEntireDebtAndColl`, never computed.
For a *preview* (e.g. "what will my debt be in 30 days?"), use the verified interest
model (`01-ground-truth` §7):

```
interest_accrued = principal × rate_bips / 10_000 × elapsedSeconds / SECONDS_PER_YEAR   // linear, simple
entireDebt_preview = principal + interest_accrued + fees + 200e18
```

- **Linear, non-compounding, time-based (seconds)**, not blocks (C3).
- `SECONDS_PER_YEAR` must match the contract's constant exactly (verify on the fork;
  do not assume 31_536_000 vs 31_557_600, read/confirm what the contract uses).
- **Subtlety (C4):** a Trove's fixed rate is set at open from its 110%-CR *maximum
  borrowing capacity*, not the initial draw. `previewOpen` must compute the rate the
  way the contract will, then validate that the predicted rate matches the rate the
  contract assigns when the position is actually opened on the fork.

This preview accrual is the single most error-prone formula in the library;
its fork validation (§5) is the M1 correctness gate.

---

## 3. Borrowing power

The maximum MUSD a user can draw against `collateral` at `price`, staying above MCR:

```
find the largest `draw` such that:
    (collateral × price) / (draw + getBorrowingFee(draw) + 200e18) ≥ MCR
  AND
    (draw + getBorrowingFee(draw)) ≥ minNetDebt      // read minNetDebt()
```

Because the fee depends on `draw` (and may be a percentage), solve for `draw`
analytically if the fee is linear, or by monotonic search otherwise, then **verify
the boundary on the fork** by actually opening a Trove at the computed max and
confirming its ICR is ≥ MCR (and that one wei more would breach it). In Recovery
Mode (`TCR < CCR`), the effective constraint tightens, surface it (O3) and reflect
it in the returned power.

Do **not** use a "≥ 2,000 net" floor, the floor is `minNetDebt`
(currently 1,800), read on-chain (C1/C6).

---

## 4. Live-position derivations (thin, over authoritative values)

For `getTrove` on a *live* position, `icr`, `entireDebt`, `interestOwed`,
`nominalICR` come from contract getters. Only two fields are derived, and they are
derived from those authoritative values, not recomputed from scratch:

```
liquidationPrice = (MCR × entireDebt_fromContract) / collateral_fromContract
healthFactor     = f(icr_fromContract / MCR)        // monotonic; 1.0 at MCR
```

`liquidationPrice` rises over time as interest accrues (entire debt grows) unless
the user repays, a subtlety a naive static calculation misses. Because
`entireDebt` here is read live (accrued to now), the derived `liquidationPrice` is
correct at read time.

---

## 4b. What the open preview actually models

`previewOpen` mirrors `_openTrove` (`BorrowerOperations.sol:631-665`) rather than
approximating it. Three rules that the earlier version got wrong, each now enforced:

| Rule | Source | Consequence |
|---|---|---|
| The fee is charged **only** when `!isRecoveryMode && !isAccountFeeExempt(borrower)` | `:637-643` | In Recovery Mode, or for an exempt account, `netDebt` is the bare draw and the fee is **zero** (MK-004, MK-018) |
| The debt floor is checked against that same `netDebt` | `:645` | Adding a phantom fee made the floor look met in the band `draw < minNetDebt <= draw + fee`, for an open that reverts. Charging the fee correctly closes it |
| Recovery Mode requires `ICR >= CCR`; normal mode requires **both** `ICR >= MCR` and a resulting system `TCR >= CCR` | `:654-665` | `viable` covers all three; the old `meetsRecoveryRequirement` covered none of them in normal mode (MK-005) |

Pass `account` whenever you have it: exemption is read, not assumed, and the exempt
cohort is non empty on mainnet.

**Borrowing against an existing Trove is a different calculation.** `getBorrowingPower`
solves the OPEN constraints only. An existing Trove is additionally gated by
`maxBorrowingCapacity >= netDebtChange + debt` (`:1358-1365`), where capacity was fixed at
the **opening price** (`:1323-1328`), ratchets only downward (`:879-897`), and never rises.
That is `previewBorrow` (MK-002). Note the `debt` in that comparison is read after
`updateSystemAndTroveInterest` (`:769`), so it includes accrued interest, which is why the
SDK compares against the live entire debt rather than the stored `getTroveDebt`.

`getBorrowingPower` also enforces the resulting system TCR in normal mode, which the
contract requires on every normal mode open and which it previously ignored.

---

## 5. The dual-validation method (how preview math earns trust)

Every formula in `math/` is validated **twice**. This is the mechanism behind
"correctness is the product."

1. **Against forked-Mezo behavior (the primary gate).** For a grid of inputs:
   compute the preview, then actually perform the operation on the fork, then read
   the contract's getter and assert **equality to the wei** (or within a documented,
   justified tolerance for any rounding the contract itself does).
   - `previewOpen(x)` → `openTrove(x)` on the fork → `getEntireDebtAndColl` /
     `getCurrentICR` must match `previewOpen`'s `entireDebt` / `icr`.
   - `getBorrowingPower` → open at the boundary → ICR ≥ MCR, and boundary+1 wei
     breaches (or the open reverts).
   - preview interest accrual → warp the fork clock → compare to
     `getTroveInterestOwed`.

2. **Against the contract's `pure` helpers (the cheap cross-check).** Where the
   contract exposes the same computation as a `pure` function, call it and assert
   the SDK matches:
   - SDK `computeICR` vs `HintHelpers.computeCR(coll, entireDebt, price)`
   - SDK NICR vs `HintHelpers.computeNominalCR(coll, entireDebt)`
   - SDK fee usage vs `getBorrowingFee(draw)`

If (1) and (2) ever disagree, the contract is right and the SDK is wrong, fix the
SDK, add the failing case to the boundary corpus (`07-testing`).

---

## 6. The hint module (`hints/`), the insertion-hint ritual

MUSD is a Liquity-fork CDP: every Trove lives in a list sorted by nominal CR, and
opening/adjusting one requires supplying correct insertion hints
(`upperHint`, `lowerHint`) for gas efficiency. The SDK wraps this once.

### 6.1 Insertion hints (open / adjust / withdrawColl / refinance)

```
1. Determine entireDebt for the resulting position (draw + fee + 200), see §1.
2. nicr = computeNominalCR(collateral, entireDebt)          // contract pure, or the §1 formula cross-checked
3. (approxHint ) = HintHelpers.getApproxHint(nicr, numTrials, randomSeed)
4. (upperHint, lowerHint) = SortedTroves.findInsertPosition(nicr, approxHint, approxHint)
5. → pass upperHint, lowerHint to the write call
```

- **Defaults (O2):** start `numTrials ≈ 15`, `randomSeed ≈ 42` (Mezo's example
  values); expose both as overridable options; document the gas/accuracy trade-off.
  Tune `numTrials` empirically against the fork (higher = better placement, more
  gas).
- **Re-run on every position-changing write**, `adjustTrove`, `withdrawColl`,
  `withdrawMUSD` (borrow more), and `refinance` each change the position's place in
  the list, so each recomputes hints.
- **Validation:** randomized `(collateral, draw)` pairs must produce a successful
  `openTrove` on the fork with the Trove landing in the correct sorted position and
  gas within tolerance of optimal.

### 6.2 Redemption hints (`redemption/`)

```
(firstRedemptionHint, partialRedemptionHintNICR, truncatedAmount)
    = HintHelpers.getRedemptionHints(amount, price, maxIterations)
→ pass these to TroveManager.redeemCollateral(...)
```

- **`truncatedAmount`** is the amount actually redeemable given the `minNetDebt`
  floor on the last touched Trove, surface it to the caller (they may redeem less
  than requested).
- **Hints go stale** if someone redeems before the tx lands → compute immediately
  before sending; document the stale-hint revert path and a retry.
- **Fee:** the current `redemptionRate()` (read on-chain, C2), applied to ALL redeemers
  including loan holders. (The "0% for loan holders" rule was disproven on the fork in
  Phase 6, see `01-ground-truth.md` §8.)

---

## 7. Invariants the tests assert (non-exhaustive)

- For any opened position: `getCurrentICR(addr, price) == computeCR(coll,
  getEntireDebtAndColl.debt, price)`.
- `previewOpen(x).entireDebt == getEntireDebtAndColl(addr).debt` after opening `x`.
- `previewOpen(x).meetsMinimum == false` ⟺ `openTrove(x)` reverts `BelowMinimumDebt`.
- `previewOpen(x).viable == false` ⟹ `openTrove(x)` reverts, with the reason named in
  `reasons` (MK-005).
- `liquidationPrice` such that `computeCR(coll, entireDebt, liquidationPrice) == MCR`.
- NICR from the SDK `== computeNominalCR(coll, entireDebt)` exactly.
- A position with ICR just below MCR is `isLiquidatable`; just above is not, and a
  liquidation attempt reverts.
