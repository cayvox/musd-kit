---
'@musd-kit/core': patch
'@musd-kit/react': patch
---

**Warning: `getBorrowingPower` and `useBorrowingPower` have no safety margin. Do not open a Trove at
the number they return (MK-100, S1).** Documentation only: no behaviour change and no API change.

The number is the largest draw the contract will accept. In normal mode that opens the position at
exactly the 110% minimum collateral ratio, and interest is added to the debt every second, so a
Trove opened at it can be liquidated by anyone within seconds of opening. A liquidation takes all of
the collateral; the borrower keeps only the MUSD they drew. Reproduced on a fork: opened at the
reported number, liquidatable one second later, and liquidated
(`packages/core/test/zz-borrowing-power-boundary.fork.test.ts`). **Callers must apply their own
buffer** and check the ratio they would open at with `previewOpen` before sending.

In Recovery Mode the number opens at exactly 150%, which is not liquidatable but has no margin
either. When the system's ratio is what limits it, the open is refused a block later.

The warning is now on the function's docstring, `MusdClient.getBorrowingPower`, the
`useBorrowingPower` docstring, and both package READMEs. The returned value is deliberately
unchanged: changing what a published function returns is an open design decision.
