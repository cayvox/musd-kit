# Migration, 0.2.0 to 0.3.0

**Read this if you switch on `BorrowBlockReason`.** That is the whole breaking surface. Everything
else on this page is a behaviour change that makes a wrong answer right, and none of it needs a
code change on your side.

Every claim here cites a finding ID in [`FINDINGS.md`](../FINDINGS.md) and, where it is a protocol
fact, a file and line in `mezo-org/musd`.

---

## At a glance

| Change | Kind | Finding | Your code breaks how |
|---|---|---|---|
| `BorrowBlockReason` gains three members | type | MK-058, MK-060 | compile error **only if** you `switch` on it exhaustively with no `default` |
| `BorrowPreview.currentIcr` added | type | MK-058 | compile error **only if you construct** a `BorrowPreview`, for example in a test double |
| `AdjustPreview.capacity` added | type | MK-060 | the same, only if you construct one |
| `previewBorrow` reports the Recovery Mode ICR rule | **behaviour** | MK-058 | **a verdict that used to be `true` and was wrong** |
| `previewBorrow` no longer applies a TCR gate in Recovery Mode | **behaviour** | MK-059 | **a reason that used to appear and should not have** |
| `previewBorrow` orders `reasons` the way the chain checks them | **behaviour** | MK-065 | `bindingConstraint` can now name a different gate |
| `adjustTrove({ borrow: 0n })` throws instead of reverting | **behaviour** | MK-060 | a throw where you previously paid gas for a revert |
| `previewBorrow` performs two extra reads | behaviour | MK-058 | none, they ride in the same batch |

**Nothing was removed.** No function, class, constant or type disappeared, and no property was
deleted from a result.

---

## 1. The breaking one: `BorrowBlockReason` has three more members (MK-058, MK-060)

```ts
// 0.2.0
type BorrowBlockReason =
  | 'TROVE_NOT_ACTIVE'
  | 'EXCEEDS_BORROWING_CAPACITY'
  | 'ICR_BELOW_THRESHOLD'
  | 'TCR_BELOW_CCR'

// 0.3.0, and it is now expressed as a subset of AdjustBlockReason so the two cannot drift
type BorrowBlockReason =
  | 'TROVE_NOT_ACTIVE'
  | 'ZERO_DEBT_INCREASE'                  // new
  | 'NO_CHANGE_REQUESTED'                 // new
  | 'ICR_BELOW_THRESHOLD'
  | 'ICR_NOT_IMPROVED_IN_RECOVERY_MODE'   // new
  | 'TCR_BELOW_CCR'
  | 'EXCEEDS_BORROWING_CAPACITY'
```

An exhaustive `switch` with no `default` stops compiling. Add the three arms, or a `default`.

**Why the union could not stay as it was.** `_requireNewICRisAboveOldICR`
(`BorrowerOperations.sol:1273`, defined `:1395-1403`) is a rule the contract has and the old union
had no member for. Reporting it as `ICR_BELOW_THRESHOLD` would have named the wrong gate, which is
the class of defect this SDK's register exists to refuse.

---

## 2. A Recovery Mode borrow is not viable, and 0.2.0 said it was (MK-058)

**This is the reason to upgrade.** In 0.2.0, `previewBorrow` returned `viable: true` for Recovery
Mode borrows that the contract refuses without exception.

`withdrawMUSD(amount, upper, lower)` calls `_adjustTrove` with `_collWithdrawal = 0` and no
`msg.value` (`BorrowerOperations.sol:243-257`), so a borrow adds debt and adds no collateral. In
Recovery Mode `_requireValidAdjustmentInRecoveryMode` (`:1265-1275`) requires
`newICR >= oldICR` on a debt increase. With collateral fixed and debt rising the ratio cannot rise,
so there is no amount that clears it.

```ts
const p = await musd.previewBorrow({ owner, amount });
// 0.2.0, in Recovery Mode:  { viable: true,  reasons: [] }               <- wrong
// 0.3.0, in Recovery Mode:  { viable: false, reasons: ['ICR_NOT_IMPROVED_IN_RECOVERY_MODE'] }
```

**No write path was affected**, in either version: `borrow()` has always prechecked through the
adjust evaluator, which had the rule (`packages/core/src/math/previewAdjust.ts:233`). If you called
`musd.borrow(...)` you were refused correctly with `RecoveryModeRestriction`. If you rendered
`previewBorrow` or branched on it, you were told the opposite of what the contract does.

`currentIcr` is on the result now, because `newICR >= oldICR` cannot be interpreted without
`oldICR`.

**The one exception, and it is arithmetic rather than policy.** `LiquityMath._computeCR` is integer
`coll * price / debt`, so a draw small enough to leave the quotient unchanged satisfies the rule on
equality. For a position of 1 BTC at 100k against 2,200 MUSD that is any draw below 23 wei. The SDK
uses the same integer form, so it agrees with the chain on both sides of that boundary.

---

## 3. Recovery Mode has no TCR gate on this path, and 0.2.0 applied one (MK-059)

`_requireNewTCRisAboveCCR` (`:1344-1349`) has exactly four call sites: `:665` inside `_openTrove`'s
normal mode branch, `:972` on the close path, `:1059` on refinance, and `:1209` inside
`_requireValidAdjustmentInNormalMode`. None is on the Recovery Mode adjust path.

Since Recovery Mode is defined as `TCR < CCR`, 0.2.0's unconditional gate reported
`TCR_BELOW_CCR` for essentially every Recovery Mode borrow. `resultingTcr` is still on the result
in both modes, because a caller wants the number; it is simply no longer a reason in the mode where
the contract does not check it.

---

## 4. `reasons` are ordered the way `_adjustTrove` checks them (MK-065)

0.2.0 put `EXCEEDS_BORROWING_CAPACITY` second. The contract checks `_requireTroveisActive` (`:790`),
then the mode's ratio gates (`:840-845`), and only then `_requireHasBorrowingCapacity`
(`:850-852`).

`bindingConstraint` is documented as the constraint the chain would report first, so for a borrow
that breaches both capacity and a ratio it now names the ratio. That matters in practice: the adjust
path never raises capacity (`:879-897`), so telling a user their binding constraint is capacity
sends them to the one gate a top-up cannot move. **Correction (MK-101):** this guide said capacity
never rises. A refinance resets it from the current price (`:1077-1084`), so after a price rise it
does rise, and after a fall a refinance cuts it.

---

## 5. `adjustTrove({ borrow: 0n })` throws instead of sending (MK-060)

`_adjustTrove` takes `_isDebtIncrease` as a parameter independent of `_mUSDChange` and refuses the
pair `(true, 0)` at `:785-787`. The SDK read that flag from PRESENCE in the write path and from
VALUE in the evaluator, so a zero draw previewed as an ordinary top-up and then reverted on chain.

Now `adjustTrove` validates its borrow leg the way `borrow` always did, and throws `InvalidAmount`
before sending. If you were passing `borrow: 0n` to mean "no borrow", pass nothing instead.

The evaluator half is visible too: `previewAdjustTrove({ increaseDebt: 0n })` returns
`ZERO_DEBT_INCREASE`, which in 0.2.0 was a declared reason no input could produce.

---

## 6. `previewBorrow` is now a projection of `previewAdjustTrove`

Both previews answer one question, because on chain there is one gate set. `previewBorrow` reads
what `previewAdjustTrove` reads, which is two reads more than it needs: the caller's MUSD balance
and `minNetDebt()`, both used only by the repayment gates a borrow never reaches. They ride in the
same batch, so this costs no extra round trip.

The agreement is asserted rather than assumed, in `packages/core/test/preview-agreement.test.ts`,
across both modes and both sides of every boundary. See `docs/08-conventions.md` §11 for the rule
this is an instance of.

---

## If you cannot upgrade immediately

**The one thing to do without upgrading:** do not act on `previewBorrow` when
`isRecoveryMode` is true. The verdict is wrong in that mode in 0.2.0, in both directions, and the
result carries `isRecoveryMode` so you can branch on it. `musd.borrow(...)` itself is safe in both
versions; it has always been prechecked by the correct evaluator.
