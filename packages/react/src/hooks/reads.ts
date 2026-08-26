import type { BorrowPreview, BorrowingCapacity, RefinancePreview, Trove } from '@musd-kit/core'
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

/** `icr / MCR` (1.0 at MCR) for `address`, a selector over the shared `useTrove` query. */
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

/** BTC/USD price at which `address` hits MCR, a selector over the shared `useTrove` query. */
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
 * Largest valid draw for an **open**, for a given collateral (core `getBorrowingPower`).
 *
 * This is an OPEN time calculator and its name is easy to misread: it does NOT tell you how
 * much an EXISTING Trove can still borrow. Every Trove carries a `maxBorrowingCapacity`
 * fixed at the opening price, which never rises afterwards, and a debt increase is gated on
 * it (`BorrowerOperations.sol:1358-1365`). For a Trove that already exists use
 * {@link useBorrowPreview} or {@link useBorrowingCapacity} (MK-002).
 *
 * Refetches on new blocks (the binding ratio, the price and the system TCR can all move).
 */
export function useBorrowingPower({
  collateral,
}: { collateral: bigint | undefined }): UseQueryResult<bigint, Error> {
  const chainId = useChainId()
  return useMusdQuery<bigint>({
    queryKey: musdQueryKeys.borrowingPower(chainId, collateral ?? 0n),
    fetch: (client) => client.getBorrowingPower({ collateral: collateral as bigint }),
    // Zero is disabled rather than queried: `getBorrowingPower` now rejects a non-positive
    // collateral with `InvalidAmount` instead of searching over it (MK-010), and an empty
    // text input parsing to `0n` is the ordinary state of a calculator being typed into, not
    // an error to render.
    enabled: collateral !== undefined && collateral > 0n,
  })
}

/**
 * Preview borrowing against an EXISTING Trove (core `previewBorrow`, MK-002): a verdict, the
 * binding constraint, the capacity picture, and the resulting ratios. This is the hook to
 * reach for when a position already exists; `useBorrowingPower` is for sizing an open.
 */
export function useBorrowPreview({
  owner,
  amount,
}: {
  owner: Address | undefined
  amount: bigint | undefined
}): UseQueryResult<BorrowPreview, Error> {
  const chainId = useChainId()
  return useMusdQuery<BorrowPreview>({
    queryKey: musdQueryKeys.borrowPreview(chainId, owner ?? '0x', amount ?? 0n),
    fetch: (client) => client.previewBorrow({ owner: owner as Address, amount: amount as bigint }),
    enabled: owner !== undefined && amount !== undefined,
  })
}

/**
 * The live borrowing capacity picture for an owner (core `getBorrowingCapacity`, MK-002):
 * the on-chain `maxBorrowingCapacity`, the live entire debt, and the remaining headroom.
 * The headroom is for `draw + fee`, not for the draw alone.
 */
export function useBorrowingCapacity({
  owner,
}: { owner: Address | undefined }): UseQueryResult<BorrowingCapacity, Error> {
  const chainId = useChainId()
  return useMusdQuery<BorrowingCapacity>({
    queryKey: musdQueryKeys.borrowingCapacity(chainId, owner ?? '0x'),
    fetch: (client) => client.getBorrowingCapacity(owner as Address),
    enabled: owner !== undefined,
  })
}

/**
 * Preview refinancing an existing Trove (core `previewRefinance`, MK-003 and MK-019): the
 * fee the contract will charge and capitalize, the resulting principal and ICR, and a
 * verdict that is false when the contract would refuse.
 *
 * Refinancing is NOT free and it is NOT always available: the fee is added to principal, and
 * the operation reverts outright while the system is in Recovery Mode. Both show up here.
 */
export function useRefinancePreview({
  owner,
}: { owner: Address | undefined }): UseQueryResult<RefinancePreview, Error> {
  const chainId = useChainId()
  return useMusdQuery<RefinancePreview>({
    queryKey: musdQueryKeys.refinancePreview(chainId, owner ?? '0x'),
    fetch: (client) => client.previewRefinance(owner as Address),
    enabled: owner !== undefined,
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
// because Mezo exposes no MUSD/USD oracle (Phase 2 / docs/09), a hook returning a guessed
// peg would violate the prime directive. It will land if/when a peg oracle exists.
