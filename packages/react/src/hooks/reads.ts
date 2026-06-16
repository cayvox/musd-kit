import type { Trove } from '@musd-kit/core'
import type { UseQueryResult } from '@tanstack/react-query'
import type { Address } from 'viem'
import { useChainId } from 'wagmi'
import { musdQueryKeys } from '../internal/keys'
import { useMusdQuery } from '../internal/useMusdQuery'

/**
 * The live, contract-authoritative Trove for `address` (core `getTrove`), refetched on new
 * blocks. `useHealthFactor` and `useLiquidationPrice` read the SAME query (shared key +
 * `select`) so they add no extra fetch.
 */
export function useTrove({
  address,
}: { address: Address | undefined }): UseQueryResult<Trove, Error> {
  const chainId = useChainId()
  return useMusdQuery<Trove>({
    queryKey: musdQueryKeys.trove(chainId, address as Address),
    fetch: (client) => client.getTrove(address as Address),
    enabled: Boolean(address),
  })
}

/** `icr / MCR` (1.0 at MCR) for `address` — a selector over the shared `useTrove` query. */
export function useHealthFactor({
  address,
}: { address: Address | undefined }): UseQueryResult<number, Error> {
  const chainId = useChainId()
  return useMusdQuery<Trove, number>({
    queryKey: musdQueryKeys.trove(chainId, address as Address),
    fetch: (client) => client.getTrove(address as Address),
    enabled: Boolean(address),
    select: (t) => t.healthFactor,
  })
}

/** BTC/USD price at which `address` hits MCR — a selector over the shared `useTrove` query. */
export function useLiquidationPrice({
  address,
}: { address: Address | undefined }): UseQueryResult<bigint, Error> {
  const chainId = useChainId()
  return useMusdQuery<Trove, bigint>({
    queryKey: musdQueryKeys.trove(chainId, address as Address),
    fetch: (client) => client.getTrove(address as Address),
    enabled: Boolean(address),
    select: (t) => t.liquidationPrice,
  })
}

/**
 * Largest valid draw for a given collateral (core `getBorrowingPower`) — a preview; no live
 * position needed. Refetches on new blocks (the binding ratio / price can move).
 */
export function useBorrowingPower({
  collateral,
}: { collateral: bigint | undefined }): UseQueryResult<bigint, Error> {
  const chainId = useChainId()
  return useMusdQuery<bigint>({
    queryKey: musdQueryKeys.borrowingPower(chainId, collateral ?? 0n),
    fetch: (client) => client.getBorrowingPower({ collateral: collateral as bigint }),
    enabled: collateral !== undefined,
  })
}

/** BTC/USD from `PriceFeed.fetchPrice()` (core `getOraclePrice`), refetched on new blocks. */
export function useOraclePrice(): UseQueryResult<bigint, Error> {
  const chainId = useChainId()
  return useMusdQuery<bigint>({
    queryKey: musdQueryKeys.oraclePrice(chainId),
    fetch: (client) => client.getOraclePrice(),
  })
}

/** MUSD ERC-20 balance of `address` (core `balanceOf`), refetched on new blocks. */
export function useMusdBalance({
  address,
}: { address: Address | undefined }): UseQueryResult<bigint, Error> {
  const chainId = useChainId()
  return useMusdQuery<bigint>({
    queryKey: musdQueryKeys.balance(chainId, address as Address),
    fetch: (client) => client.balanceOf(address as Address),
    enabled: Boolean(address),
  })
}

// NOTE: `useMusdPeg` is intentionally NOT shipped in v1. The core `getPeg` is unimplemented
// because Mezo exposes no MUSD/USD oracle (Phase 2 / docs/09) — a hook returning a guessed
// peg would violate the prime directive. It will land if/when a peg oracle exists.
