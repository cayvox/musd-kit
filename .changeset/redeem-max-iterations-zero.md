---
'@musd-kit/core': patch
'@musd-kit/react': patch
---

**`previewRedeem` and `redeem` now read `maxIterations: 0n` as no limit, which is what the contract
does with zero (MK-114, S1).**

`redeemCollateral` and `getRedemptionHints` both replace a zero `_maxIterations` with no limit
(`TroveManager.sol:353-355`, `HintHelpers.sol:107-109`); the deployed helper at the pinned testnet
block returns a 400,000 MUSD request whole at zero and truncates it to 298,067 MUSD at 100. 0.4.0's
preview walked one eligible Trove at `0n`, so it reported less than the call redeemed, and `redeem()`
prechecked only that Trove while sending zero to the chain. 0.2.0 to 0.3.1 walked none.

What changes for a caller:

- `maxIterations: 0n` walks until the eligible Troves cover `amount` or the list ends, in the preview
  and in the write alike. A request covered by two Troves reads two, not the whole list.
- A negative `maxIterations`, or one above the largest `uint256`, throws `InvalidAmount` before any
  read. No such value could be sent to the contract.
- The omitted default is one exported constant, `DEFAULT_REDEMPTION_MAX_ITERATIONS` (`100n`), shared
  by the preview and the write. Its value and its export path are unchanged.

`@musd-kit/react` moves with core: `useRedeem` passes the caller's parameters to `redeem()`, so it
gets the corrected precheck. `usePreviewRedeem` takes no `maxIterations` and was not affected.
