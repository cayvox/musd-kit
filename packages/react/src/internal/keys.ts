import type { Address } from 'viem'

/**
 * The four legs of an adjustment, with ABSENCE preserved (MK-085).
 *
 * Every field is optional and `undefined` means "no such leg", which is a different input from
 * a leg of zero. `previewAdjustTrove` reads `_isDebtIncrease` from the PRESENCE of
 * `increaseDebt` (`packages/core/src/math/previewAdjust.ts`, MK-060), mirroring the contract's
 * separate `_isDebtIncrease` parameter, so a caller that fills an absent leg with `0n` asks a
 * question the caller did not mean.
 */
export interface AdjustPreviewLegs {
  addCollateral?: bigint
  withdrawCollateral?: bigint
  increaseDebt?: bigint
  repayDebt?: bigint
}

/**
 * Stable TanStack query keys (chainId + method + args). Hooks that share a key dedupe to a
 * single fetch (e.g. `useTrove` / `useHealthFactor` / `useLiquidationPrice` for one address
 * differ only by `select`). bigints are stringified, TanStack hashes keys with
 * `JSON.stringify`, which throws on bigint.
 */
export const musdQueryKeys = {
  /** Query key for a Trove read (shared by `useTrove`/`useHealthFactor`/`useLiquidationPrice`). */
  trove: (chainId: number, address: Address) => ['musd', chainId, 'trove', address] as const,
  /** Query key for the oracle BTC/USD price. */
  oraclePrice: (chainId: number) => ['musd', chainId, 'oraclePrice'] as const,
  /** Query key for an MUSD balance read. */
  balance: (chainId: number, address: Address) => ['musd', chainId, 'balance', address] as const,
  /** Query key for a borrowing-power preview (collateral stringified, keys are JSON-hashed). */
  // MK-067. The account is part of the key: the answer differs for a fee exempt account,
  // because the contract charges it no borrowing fee (`BorrowerOperations.sol:637-643`).
  //
  // MK-100. The margin overrides are part of it too, because a different margin is a different
  // `recommended`. An ABSENT override is `null`, the measured default, and never the default's
  // value written out, so a change to the default cannot leave an old answer under the new key.
  borrowingPower: (
    chainId: number,
    collateral: bigint,
    account?: string,
    margin?: { marginWindowSeconds?: bigint; priceMoveBps?: bigint },
  ) =>
    [
      'musd',
      chainId,
      'borrowingPower',
      collateral.toString(),
      account ?? null,
      margin?.marginWindowSeconds?.toString() ?? null,
      margin?.priceMoveBps?.toString() ?? null,
    ] as const,
  /**
   * Key for `useBorrowPreview`: one entry per owner and draw (MK-002).
   *
   * MK-085. `amount` is optional and an ABSENT amount is `null`, not `"0"`. The hook disables
   * itself without one, and a disabled TanStack query still reads whatever sits at its key, so
   * encoding "not asked yet" as `0` let an empty input box render the verdict computed for a
   * draw of zero. Every amount-carrying key below follows the same rule.
   */
  borrowPreview: (chainId: number, owner: string, amount: bigint | undefined) =>
    ['musd', chainId, 'borrowPreview', owner, amount?.toString() ?? null] as const,
  /**
   * MK-042. Carries all four legs, because a preview for "add 1 BTC" and one for "add 1 BTC
   * and borrow 500" are different questions with different answers.
   *
   * **MK-085. The legs arrive as the same object the fetch sends**, not as four positional
   * values assembled a second time, so the key cannot describe a different call from the one
   * that was made. An ABSENT leg is `null` here and a leg of `0n` is `"0"`, because on chain
   * those are different inputs: `_adjustTrove` takes `_isDebtIncrease` independently of
   * `_mUSDChange` (`BorrowerOperations.sol:757-758`) and refuses `(0, true)` at `:785-787`.
   * Encoding both as `0` made "no debt leg" and "a debt increase of zero" share a cache entry.
   */
  adjustPreview: (chainId: number, owner: string, legs: AdjustPreviewLegs) =>
    [
      'musd',
      chainId,
      'adjustPreview',
      owner,
      legs.addCollateral?.toString() ?? null,
      legs.withdrawCollateral?.toString() ?? null,
      legs.increaseDebt?.toString() ?? null,
      legs.repayDebt?.toString() ?? null,
    ] as const,
  /** MK-042. A pure collateral withdrawal of `amount`, keyed per owner and per amount. */
  withdrawCollateralPreview: (chainId: number, owner: string, amount: bigint | undefined) =>
    ['musd', chainId, 'withdrawCollateralPreview', owner, amount?.toString() ?? null] as const,
  /** MK-042. The largest withdrawal the contract would accept now, and which gate caps it. */
  maxWithdrawable: (chainId: number, owner: string) =>
    ['musd', chainId, 'maxWithdrawable', owner] as const,
  /** MK-042. Whether closing is permitted, and the MUSD the caller must hold to do it. */
  closePreview: (chainId: number, owner: string) =>
    ['musd', chainId, 'closePreview', owner] as const,
  /** MK-048. What a single redeemCollateral call will actually redeem, per redeemer and amount. */
  redeemPreview: (chainId: number, redeemer: string, amount: bigint | undefined) =>
    ['musd', chainId, 'redeemPreview', redeemer, amount?.toString() ?? null] as const,
  /** Key for `useRefinancePreview`: one entry per owner (MK-003). */
  refinancePreview: (chainId: number, owner: string) =>
    ['musd', chainId, 'refinancePreview', owner] as const,
  /** Key for `useBorrowingCapacity`: one entry per owner (MK-002). */
  borrowingCapacity: (chainId: number, owner: string) =>
    ['musd', chainId, 'borrowingCapacity', owner] as const,
} as const
