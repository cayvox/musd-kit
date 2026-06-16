import type { Address } from 'viem'

/**
 * Stable TanStack query keys (chainId + method + args). Hooks that share a key dedupe to a
 * single fetch (e.g. `useTrove` / `useHealthFactor` / `useLiquidationPrice` for one address
 * differ only by `select`). bigints are stringified — TanStack hashes keys with
 * `JSON.stringify`, which throws on bigint.
 */
export const musdQueryKeys = {
  /** Query key for a Trove read (shared by `useTrove`/`useHealthFactor`/`useLiquidationPrice`). */
  trove: (chainId: number, address: Address) => ['musd', chainId, 'trove', address] as const,
  /** Query key for the oracle BTC/USD price. */
  oraclePrice: (chainId: number) => ['musd', chainId, 'oraclePrice'] as const,
  /** Query key for an MUSD balance read. */
  balance: (chainId: number, address: Address) => ['musd', chainId, 'balance', address] as const,
  /** Query key for a borrowing-power preview (collateral stringified — keys are JSON-hashed). */
  borrowingPower: (chainId: number, collateral: bigint) =>
    ['musd', chainId, 'borrowingPower', collateral.toString()] as const,
} as const
