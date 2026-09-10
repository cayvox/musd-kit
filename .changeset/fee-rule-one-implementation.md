---
'@musd-kit/core': minor
'@musd-kit/react': minor
---

**One protocol rule was implemented in eight places and four of them were wrong the same way. Every
place that decides whether the borrowing fee applies now goes through the one exported rule**
(MK-067, MK-068, MK-069, MK-070).

`BorrowerOperations.sol:637-643` charges the borrowing fee only when
`!isRecoveryMode && !isAccountFeeExempt(borrower)`, and `:813-818` repeats the same condition on a
debt increase. `math/fee.ts` has exported that condition as `isBorrowingFeeCharged` since MK-004,
and its own docstring says the rule is kept in one place so it "cannot drift between the preview and
the write path". It had drifted, in four places.

### Breaking behaviour, even though no signature is removed

- **`getBorrowingPower` returns a LARGER number in Recovery Mode, and for a fee exempt account.**
  It subtracted a borrowing fee the contract does not charge, so the reported maximum was short by
  roughly 0.0999 percent of the draw at the live rate. Proven against the real contracts on a fork:
  the excluded draw opened, at ICR exactly CCR. A caller who stored or compared the old figure will
  see it move. **S1: the old value was silently wrong, with no error raised.**
- **`getBorrowingPower` takes an optional `account`.** Additive, so existing calls compile
  unchanged, but exemption is not modelled without it. Pass the connected address whenever you have
  one, exactly as `previewOpen` already asks. `useBorrowingPower` takes it too, and it is part of
  the React query key, so an exempt and a non exempt caller no longer share a cached answer.
- **`openTrove` accepts calls it used to refuse and refuses calls it used to accept.** It called the
  raw fee getter while `borrow` and `adjustTrove` used the effective one. A `maxFeePercentage: 0n`
  open in Recovery Mode was refused with `MaxFeeExceeded` naming a fee that would never be charged,
  and is now sent. A draw in the band `draw < minNetDebt <= draw + fee` was sent and reverted on
  chain, and is now refused up front with `BelowMinimumDebt`.
- **`AdjustBlockReason` gains `DEBT_INCREASE_AND_REPAY`** (MK-077). A `previewAdjustTrove` call with
  both debt legs used to drop the repayment and return `viable: true`, describing an operation
  `_adjustTrove` cannot perform. An exhaustive `switch` over the union needs a new arm.
- **`CloseBlockReason` gains `LAST_TROVE_IN_SYSTEM`** (MK-074). The last Trove in a system cannot be
  closed (`TroveManager.sol:1390-1399`) or liquidated (`:1058-1060`), and neither `previewClose` nor
  `isLiquidatable` knew. `EvaluateCloseInput` gains two optional counts; supplying them is what
  enables the gate.
- **`RefinanceBlockReason` members are reordered** (MK-075). `RECOVERY_MODE` now precedes
  `TROVE_NOT_ACTIVE`, which is the order `_refinance` checks them in (`:1023` then `:1024`).
  `viable` is unchanged; `bindingConstraint` and the order of `reasons` are not.
- **`computeMaxWithdrawable.limitedBy` reports `TCR` in a case it used to call `ICR`** (MK-076): a
  zero maximum caused by the system ratio rather than by the position.

### Also fixed

- **`previewRedeem`'s accrual margin was 0.0664 percent too large** (MK-071). The file shadowed
  `SECONDS_PER_YEAR` with `365 * 24 * 3600`, the value `constants.ts` explicitly names as the wrong
  one; the protocol uses 31,556,952 (`InterestRateMath.sol:9`). `nextViableAmount` moves slightly.
- **New export `isTroveLiquidatable`**, so `getTrove().isLiquidatable` and `isLiquidatable()` are
  one implementation rather than two that agreed by coincidence.
- **Staleness is now on the fields TypeDoc publishes**, not only in the register:
  `BorrowingCapacity.remaining` is the headroom to exactly the liquidation threshold and expires in
  about a second (MK-072), and `MaxWithdrawable.amount` is good for the block it was computed at
  (MK-073, the clause MK-051 named as its own acceptance condition).

### And the controls that let this happen

`getBorrowingPower`'s feasibility predicate IS `evaluateOpen` now, so the open rules have one
implementation. `borrowing-power-agreement.test.ts` pins the two against each other in both modes
and for an exempt account. The differential sweep gains a `borrowingPower` operation, closing a gap
`docs/09` described as validated while the sweep did not reach it. The Recovery Mode fork assertion
opens on chain instead of restating the implementation's arithmetic, which is what let MK-067
survive: it passed because of the defect and would have failed once the defect was removed
(MK-070). `docs/08-conventions.md` §12 now requires enumerating every place a rule is decided before
a finding can be closed.
