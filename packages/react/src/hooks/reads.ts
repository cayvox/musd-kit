import type {
  AdjustPreview,
  BorrowPreview,
  BorrowingCapacity,
  ClosePreview,
  MaxWithdrawable,
  RedemptionPreview,
  RefinancePreview,
  Trove,
} from '@musd-kit/core'
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

/**
 * Preview a combined adjustment (core `previewAdjustTrove`, MK-042): every ratio and mode
 * gate the contract enforces on `_adjustTrove`, with the raw numbers behind the verdict.
 *
 * **Read `icrIsAbsolute` before rendering a message.** The individual ratio requirement is an
 * absolute test on the RESULTING ratio, not a do-no-harm test, so an adjustment that improves
 * a position can still be refused (MK-038). `minimumCollateralToClearIcr` is the figure that
 * would actually clear it.
 */
export function useAdjustTrovePreview(params: {
  owner: Address | undefined
  addCollateral?: bigint
  withdrawCollateral?: bigint
  increaseDebt?: bigint
  repayDebt?: bigint
}): UseQueryResult<AdjustPreview, Error> {
  const chainId = useChainId()
  const {
    owner,
    addCollateral = 0n,
    withdrawCollateral = 0n,
    increaseDebt = 0n,
    repayDebt = 0n,
  } = params
  return useMusdQuery<AdjustPreview>({
    queryKey: musdQueryKeys.adjustPreview(
      chainId,
      owner ?? '0x',
      addCollateral,
      withdrawCollateral,
      increaseDebt,
      repayDebt,
    ),
    fetch: (client) =>
      client.previewAdjustTrove({
        owner: owner as Address,
        addCollateral,
        withdrawCollateral,
        increaseDebt,
        repayDebt,
      }),
    enabled: owner !== undefined,
  })
}

/**
 * Preview withdrawing collateral (core `previewWithdrawCollateral`, MK-042).
 *
 * **Refused outright in Recovery Mode**, not merely limited: `_requireNoCollWithdrawal`
 * (`BorrowerOperations.sol:1270`) permits no amount at all, so there is no smaller number
 * that works. The reason is `COLLATERAL_WITHDRAWAL_IN_RECOVERY_MODE` rather than a ratio.
 */
export function useWithdrawCollateralPreview({
  owner,
  amount,
}: {
  owner: Address | undefined
  amount: bigint | undefined
}): UseQueryResult<AdjustPreview, Error> {
  const chainId = useChainId()
  return useMusdQuery<AdjustPreview>({
    queryKey: musdQueryKeys.withdrawCollateralPreview(chainId, owner ?? '0x', amount ?? 0n),
    fetch: (client) =>
      client.previewWithdrawCollateral({ owner: owner as Address, amount: amount as bigint }),
    enabled: owner !== undefined && amount !== undefined,
  })
}

/**
 * The largest collateral withdrawal the contract would accept right now, and which gate caps
 * it (core `maxWithdrawableCollateral`, MK-042).
 *
 * This is the "max" button's number. `limitedBy` says whether the cap is the position's own
 * ratio, the system ratio, or Recovery Mode refusing withdrawal entirely, which are three
 * different things to tell a user.
 */
export function useMaxWithdrawableCollateral({
  owner,
}: { owner: Address | undefined }): UseQueryResult<MaxWithdrawable, Error> {
  const chainId = useChainId()
  return useMusdQuery<MaxWithdrawable>({
    queryKey: musdQueryKeys.maxWithdrawable(chainId, owner ?? '0x'),
    fetch: (client) => client.maxWithdrawableCollateral(owner as Address),
    enabled: owner !== undefined,
  })
}

/**
 * Preview closing a Trove (core `previewClose`, MK-042): whether it is permitted, the MUSD
 * the caller must hold, and the shortfall if they do not.
 *
 * The balance requirement is the whole entire debt minus the 200 MUSD gas compensation
 * (`BorrowerOperations.sol:963`), which is the reason closing fails most often.
 * `canMint` reports whether the Recovery Mode and TCR gates are enforced at all: both are
 * conditional on `musd.mintList(borrowerOperations)`, read live rather than assumed.
 */
export function useClosePreview({
  owner,
}: { owner: Address | undefined }): UseQueryResult<ClosePreview, Error> {
  const chainId = useChainId()
  return useMusdQuery<ClosePreview>({
    queryKey: musdQueryKeys.closePreview(chainId, owner ?? '0x'),
    fetch: (client) => client.previewClose(owner as Address),
    enabled: owner !== undefined,
  })
}

/**
 * Preview a redemption (core `previewRedeem`, MK-048): what a single `redeemCollateral` call will
 * ACTUALLY redeem, by walking the sorted list the way the contract's loop does.
 *
 * **Do not size a redemption from `RedeemResult.truncatedAmount`.** That is what
 * `getRedemptionHints` returned, and the helper answers a different question: it sizes each
 * partial to a Trove's headroom above the debt floor and then moves on, which needs one call per
 * Trove. A single call hands the whole amount to the first eligible Trove and reverts if that
 * breaches the floor.
 *
 * So the amounts that work are not an interval. Render `maxWithoutConsuming` and
 * `nextViableAmount` as the two edges when `bindingConstraint` is
 * `PARTIAL_BREACHES_DEBT_FLOOR`: the limit is another account's headroom, not the user's balance,
 * which is exactly the thing a user cannot be expected to guess.
 */
export function useRedeemPreview({
  redeemer,
  amount,
}: {
  redeemer: Address | undefined
  amount: bigint | undefined
}): UseQueryResult<RedemptionPreview, Error> {
  const chainId = useChainId()
  return useMusdQuery<RedemptionPreview>({
    queryKey: musdQueryKeys.redeemPreview(chainId, redeemer ?? '0x', amount ?? 0n),
    fetch: (client) =>
      client.previewRedeem({ redeemer: redeemer as Address, amount: amount as bigint }),
    enabled: redeemer !== undefined && amount !== undefined,
  })
}
