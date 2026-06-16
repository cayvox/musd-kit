import type { Address } from 'viem'

/**
 * Stable TanStack query keys (chainId + method + args). Hooks that share a key dedupe to a
 * single fetch (e.g. `useTrove` / `useHealthFactor` / `useLiquidationPrice` for one address
 * differ only by `select`). bigints are stringified — TanStack hashes keys with
 * `JSON.stringify`, which throws on bigint.
 */
export const musdQueryKeys = {
  trove: (chainId: number, address: Address) => ['musd', chainId, 'trove', address] as const,
  oraclePrice: (chainId: number) => ['musd', chainId, 'oraclePrice'] as const,
  balance: (chainId: number, address: Address) => ['musd', chainId, 'balance', address] as const,
  borrowingPower: (chainId: number, collateral: bigint) =>
    ['musd', chainId, 'borrowingPower', collateral.toString()] as const,
} as const
