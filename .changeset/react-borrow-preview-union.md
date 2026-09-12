---
'@musd-kit/react': minor
---

**`useBorrowPreview` returns the widened `BorrowBlockReason` union** (MK-058, MK-059, MK-060).

No source in this package changed. Its public TYPE surface did: `useBorrowPreview` is declared as
`UseQueryResult<BorrowPreview, Error>` and `BorrowPreview` is re-exported from `@musd-kit/core`, so
a React consumer who exhaustively switches on `data.reasons` or `data.bindingConstraint` sees the
three new members and stops compiling.

Marked **minor rather than the automatic dependency patch**, because `updateInternalDependencies`
is set to `patch` and would otherwise ship a breaking type change under a patch version. See
`docs/14-migration-0.2-to-0.3.md`.
