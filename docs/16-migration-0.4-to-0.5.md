# Migration, 0.4 to 0.5.0

**Read this if you render a borrowing figure, redeem, branch on an error code, or send `adjustTrove`
with zero valued legs.** Five of the changes below alter behaviour without changing a type, so the
compiler will not find them for you, and one of them is the reason this release exists: **0.4 told you
to offer a draw that a position held for a week did not survive in most of the history measured.**

Every claim here cites a finding ID in [`FINDINGS.md`](../FINDINGS.md) and, where it is a protocol fact,
a file and line in `mezo-org/musd`. 0.5.0 is a minor on `0.x`, which is where breaking changes go:
`^0.4.1` does not resolve to it (`docs/12-release-runbook.md` §0a).

---

## At a glance

| Change | Kind | Finding | Your code breaks how |
|---|---|---|---|
| `getBorrowingPower` drops `recommended`, `recommendedIcr` and `margin`, and its `marginWindowSeconds` and `priceMoveBps` parameters | **type** | MK-240 | compile error where you read them. **In JavaScript, no error**: `power.recommended` is `undefined`, and bigint arithmetic on it throws `TypeError` |
| `BORROWING_POWER_MARGIN_WINDOW_SECONDS` and `BORROWING_POWER_PRICE_MOVE_BPS` are removed | **type** | MK-240 | import error |
| `drawForMargin({ collateral, horizonSeconds, priceFallBps })` is new, with both margin inputs required | addition | MK-240 | none |
| `useBorrowingPower`'s `data` is the ceiling result object, not a bare `bigint`; `useBorrowingPowerDetail` is removed; `useDrawForMargin` is new | **type** | MK-240 | compile error wherever `data` was used as a number, or the detail hook imported |
| `redeem()` resolves after the transaction MINES, and `RedeemResult` drops `truncatedAmount`, `estimatedFeeCollateral` and `estimatedCollateralDrawn` for `settled` and `estimatedBeforeSend` | **type and behaviour** | MK-241 | compile error on the removed fields; **the promise now waits for the receipt**, and a reverted redemption throws `RedemptionFailed` instead of returning a hash |
| Withdrawal previews carry `capacityAfter`; `computeMaxWithdrawable` requires `capacity` | type | MK-242 | compile error **only if you construct** an input for the pure function or a test double |
| The adjust precheck throws `ICRBelowMCR` (normal mode) or `RecoveryModeRestriction` (Recovery Mode) for the ratio gate, not `InsufficientCollateral` | **value, same type** | MK-243 | **no compile error.** A `catch` testing `instanceof InsufficientCollateral` for an under collateralised borrow, repay, top up or withdrawal no longer matches |
| `InsufficientCollateral` names only a withdrawal larger than the collateral, with `{ withdrawal, collateral }` | **type and meaning** | MK-243 | compile error if you construct it; its `context` keys changed |
| A borrow that fails both the ratio and capacity throws `ICRBelowMCR`, not `ExceedsBorrowingCapacity` | **value** | MK-243 | **no compile error.** The contract checks the ratio first |
| `adjustTrove` and `previewAdjustTrove` read legs by VALUE: a zero leg is no leg | **behaviour** | MK-244 | **no compile error.** `{ addCollateral: 0n, withdrawCollateral: x }` now SENDS a withdrawal where 0.4 threw `InvalidAdjustment`; `{ borrow: 0n, addCollateral: x }` sends a top up where 0.4 threw `InvalidAmount`; a negative leg throws `InvalidAmount` |
| `previewRedeem` can report `LAST_TROVE_IN_SYSTEM`, and `redeem()` throws `LastTroveInSystem` before gas; `EvaluateRedeemInput` requires `troveOwnersCount`, `sortedTrovesSize` and `canMint` | **type and behaviour** | MK-245 | compile error if you construct the input or `switch` exhaustively on `RedeemBlockReason` with no `default` |

**Removed**, and nothing else: `BorrowingPower.recommended`, `.recommendedIcr`, `.margin`; the type
`BorrowingPowerMargin`; `GetBorrowingPowerParams.marginWindowSeconds` and `.priceMoveBps`; the two
`BORROWING_POWER_*` constants; `useBorrowingPowerDetail`; `BorrowingPowerHookParams.marginWindowSeconds`
and `.priceMoveBps`; `RedeemResult.truncatedAmount`, `.estimatedFeeCollateral` and
`.estimatedCollateralDrawn`.

---

## 1. There is no recommended draw (MK-240)

```ts
// 0.4
const power = await musd.getBorrowingPower({ collateral, account })
power.recommended  // one hour and a 2% fall, presented as the draw to offer

// 0.5
const { ceiling } = await musd.getBorrowingPower({ collateral, account }) // a limit, never an amount
const sized = await musd.drawForMargin({
  collateral,
  account,
  horizonSeconds: 7n * 86_400n, // how long the position must survive: YOUR choice
  priceFallBps: 1_000n,         // the BTC fall it must survive: YOUR choice
})
sized.draw   // survives that fall over that horizon, and nothing more
sized.margin // the margin it was solved with
```

**Why it was removed rather than re-sized.** 0.4's `recommended` answered how long a figure survives
between being read and being mined, an hour. Its name, the hook's default and both READMEs answered a
different question: how much to borrow and hold. How long a position is held and how far a price may fall
meanwhile are the holder's decisions, so any default the library picks is wrong for someone. Over 86 days
of Mezo mainnet `fetchPrice()`, the share of start times after which the price fell at least the given
amount within the horizon:

| Hold for | Fell 2% or more | 5% or more | 10% or more | 20% or more | Worst fall seen |
|---|---|---|---|---|---|
| 1 hour | 0.1% | 0.0% | 0.0% | 0.0% | 4.18% |
| 1 day | 17.4% | 1.0% | 0.0% | 0.0% | 5.70% |
| 3 days | 43.9% | 3.8% | 0.01% | 0.0% | 10.24% |
| 7 days | 57.6% | 6.7% | 0.2% | 0.0% | 10.80% |
| 30 days | 68.2% | 10.4% | 1.1% | 0.0% | 11.64% |

Blocks 9841930 to 11868955, one sample every 225 blocks, by `MEZO_MAINNET_RPC_URL=<endpoint> pnpm tsx
scripts/oracle-moves.ts --end 11869000 --consecutive 0 --days 90 --step 225 --horizons
3600,86400,259200,604800,2592000 --falls 200,500,1000,2000`. It is one stretch of history, the shares
overlap and are lower bounds, and redistribution from other liquidations is not in it; `03-core-api` states
the limits in full. **0.4's worst measured hour was 190.78 bps and it shipped 200; this range's worst hour
is 418.47 bps.**

**What to change.** If you displayed `recommended` as an amount, stop. Ask the user for a holding period
and a fall they want to absorb, or choose them in your product and say so on screen, and call
`drawForMargin`. Show the ceiling only as a limit.

**React.**

```tsx
// 0.4
const { data: recommended } = useBorrowingPower({ collateral })
const { data: detail } = useBorrowingPowerDetail({ collateral })

// 0.5
const { data: power } = useBorrowingPower({ collateral }) // power.ceiling
const { data: sized } = useDrawForMargin({ collateral, horizonSeconds, priceFallBps })
// disabled, data undefined, until both margin inputs are supplied
```

A margin input that is `0n` is a margin, and is asked for; only `undefined` disables the hook.

---

## 2. A redemption reports what it settled (MK-241)

```ts
// 0.4
const r = await musd.redeem({ amount })  // resolved at send
r.truncatedAmount                        // the hint helper's figure
r.estimatedFeeCollateral                 // a fee estimated from that figure

// 0.5
const r = await musd.redeem({ amount })  // resolves once MINED
r.settled.redeemedAmount                 // Redemption._actualAmount, the MUSD burned
r.settled.unredeemedAmount               // asked for, not redeemed, still yours
r.settled.collateralDrawn                // _collateralSent, fee INCLUDED (TroveManager.sol:420-425)
r.settled.collateralFee                  // _collateralFee
r.settled.collateralReceived             // drawn less fee, what arrived (:416-418, :444-447)
r.estimatedBeforeSend                    // { redeemable, collateralDrawn, collateralFee }, from previewRedeem
```

The helper's figure over-reports whenever a partial on a later Trove cancels (MK-048). On a fork at the
pinned block, a redemption the helper sized at 3,515.14 MUSD settled 1,808.46, which equalled the MUSD that
left the redeemer's balance (`zz-redemption-settled.fork.test.ts`).

**What to change.** Remove your own `waitForTransactionReceipt` after `redeem()` if it only existed to learn
the outcome; the result has it. A redemption that mines and reverts throws `RedemptionFailed`. If you send a
redemption some other way, `settledRedemptionFrom(receipt, troveManagerAddress)` reads the same fields. **In
React, `useRedeem`'s `isPending` now lasts until the redemption mines.**

---

## 3. A withdrawal discloses the capacity it removes (MK-242)

`previewAdjustTrove`, `previewWithdrawCollateral` and `maxWithdrawableCollateral` return
`capacityAfter: { current, resulting, lost, restoredByAddingCollateral: false, recovery }`. A collateral
decrease stores `min(current, collateral * price / 1.1)` (`BorrowerOperations.sol:879-899`) and adding
collateral back never raises it (`:880`), so render `lost` before a user withdraws during a price fall.
`recovery` is the refinance that would win it back, projected on the resulting state: its fee, the global
rate the Trove would move to, the capacity it would write, and whether it is allowed now (a refinance is
refused in Recovery Mode, `:1023`).

`computeMaxWithdrawable` takes `capacity`, the stored `getTroveMaxBorrowingCapacity`. And
`useMaxWithdrawableCollateral` is no longer documented as a max button's number (MK-247): at that amount the
Trove sits at the liquidation threshold.

---

## 4. One gate, one error code (MK-243)

```ts
// 0.4: the SAME contract gate, two codes depending on which path caught it
catch (e) { if (e instanceof InsufficientCollateral) /* borrow, repay, top up, withdraw */ }
catch (e) { if (e instanceof ICRBelowMCR) /* openTrove, refinance, a raced precheck */ }

// 0.5: one
catch (e) {
  if (e instanceof ICRBelowMCR) { /* the MCR gate, from any path; e.context.resultingIcr when prechecked */ }
  if (e instanceof RecoveryModeRestriction) { /* the CCR gate and the other Recovery Mode gates */ }
  if (e instanceof InsufficientCollateral) { /* only: withdrawing more collateral than the Trove holds */ }
}
```

---

## 5. Adjustment legs are read by value (MK-244)

A zero leg is no leg, in `adjustTrove`, in `previewAdjustTrove` and in `useAdjustTrovePreview`. A form that
holds every field as `0n` now sends what the non zero fields describe, as the contract accepts
(`BorrowerOperations.sol:1367-1386`). Both collateral legs non zero, or both debt legs non zero, are still
refused before any read. `previewBorrow` is unchanged: `withdrawMUSD` always sends a debt increase, so a
zero draw there is still `ZERO_DEBT_INCREASE`.

---

## 6. The last Trove, on the redemption path (MK-245)

A redemption that consumes the last Trove in the system reverts (`TroveManager.sol:1252-1261`,
`:1397-1399`, `:1488-1496`). `previewRedeem` reports `LAST_TROVE_IN_SYSTEM`, `redeem()` throws
`LastTroveInSystem` before gas, and `previewRedeem` reads `getTroveOwnersCount`, `getSize` and
`mintList` to know it. Live deployments hold many Troves, so this is rare, and it was a revert either way.

---

## 7. Cost

`previewRedeem` makes three more reads, in its existing parallel batch. `previewAdjustTrove`,
`previewWithdrawCollateral` and `maxWithdrawableCollateral` make up to five more when a withdrawal
removes capacity, and none when it does not; the write path's precheck makes none of them.
