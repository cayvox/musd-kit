import type { Address } from 'viem'

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
  borrowingPower: (chainId: number, collateral: bigint) =>
    ['musd', chainId, 'borrowingPower', collateral.toString()] as const,
  /** Key for `useBorrowPreview`: one entry per owner and draw (MK-002). */
  borrowPreview: (chainId: number, owner: string, amount: bigint) =>
    ['musd', chainId, 'borrowPreview', owner, amount.toString()] as const,
  /**
   * MK-042. Carries all four legs, because a preview for "add 1 BTC" and one for "add 1 BTC
   * and borrow 500" are different questions with different answers.
   */
  adjustPreview: (
    chainId: number,
    owner: string,
    addCollateral: bigint,
    withdrawCollateral: bigint,
    increaseDebt: bigint,
    repayDebt: bigint,
  ) =>
    [
      'musd',
      chainId,
      'adjustPreview',
      owner,
      addCollateral.toString(),
      withdrawCollateral.toString(),
      increaseDebt.toString(),
      repayDebt.toString(),
    ] as const,
  /** MK-042. A pure collateral withdrawal of `amount`, keyed per owner and per amount. */
  withdrawCollateralPreview: (chainId: number, owner: string, amount: bigint) =>
    ['musd', chainId, 'withdrawCollateralPreview', owner, amount.toString()] as const,
  /** MK-042. The largest withdrawal the contract would accept now, and which gate caps it. */
  maxWithdrawable: (chainId: number, owner: string) =>
    ['musd', chainId, 'maxWithdrawable', owner] as const,
  /** MK-042. Whether closing is permitted, and the MUSD the caller must hold to do it. */
  closePreview: (chainId: number, owner: string) =>
    ['musd', chainId, 'closePreview', owner] as const,
  /** Key for `useRefinancePreview`: one entry per owner (MK-003). */
  refinancePreview: (chainId: number, owner: string) =>
    ['musd', chainId, 'refinancePreview', owner] as const,
  /** Key for `useBorrowingCapacity`: one entry per owner (MK-002). */
  borrowingCapacity: (chainId: number, owner: string) =>
    ['musd', chainId, 'borrowingCapacity', owner] as const,
} as const
