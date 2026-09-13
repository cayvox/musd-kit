import type {
  AdjustPreview,
  BorrowPreview,
  BorrowingCapacity,
  BorrowingPower,
  ClosePreview,
  MaxWithdrawable,
  RedemptionPreview,
  RefinancePreview,
  Trove,
} from '@musd-kit/core'
import type { UseQueryResult } from '@tanstack/react-query'
import type { Address } from 'viem'
import { useAccount, useChainId } from 'wagmi'
import { type AdjustPreviewLegs, musdQueryKeys } from '../internal/keys'
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

/** The borrowing power hooks' parameters, shared so the two cannot drift apart. */
export interface BorrowingPowerHookParams {
  collateral: bigint | undefined
  /** The account that would open. Defaults to the connected wallet (MK-106). */
  account?: Address | undefined
  /**
   * Core's `marginWindowSeconds`: a larger window for a slower flow, a smaller one for an immediate
   * send. Omitted, the measured default applies. The value used is on the detail's `margin`.
   */
  marginWindowSeconds?: bigint | undefined
  /** Core's `priceMoveBps`, from `0n` up to but excluding `10_000n`. Omitted, the measured default. */
  priceMoveBps?: bigint | undefined
}

/** Shared query for {@link useBorrowingPower} and {@link useBorrowingPowerDetail}: one fetch. */
function useBorrowingPowerQuery<TSelected>(
  params: BorrowingPowerHookParams,
  select: (power: BorrowingPower) => TSelected,
): UseQueryResult<TSelected, Error> {
  const chainId = useChainId()
  const { collateral, account } = params
  // MK-106. The hook runs inside a wagmi context that knows the connected wallet, so an omitted
  // `account` means that wallet rather than "not fee exempt". An explicit account still wins.
  const { address: connected } = useAccount()
  const who = account ?? connected
  // MK-100, MK-085. Built once from presence and handed to both the key and the call, so an omitted
  // override stays omitted and means the measured default in both places.
  const margin = {
    ...(params.marginWindowSeconds !== undefined
      ? { marginWindowSeconds: params.marginWindowSeconds }
      : {}),
    ...(params.priceMoveBps !== undefined ? { priceMoveBps: params.priceMoveBps } : {}),
  }
  return useMusdQuery<BorrowingPower, TSelected>({
    queryKey: musdQueryKeys.borrowingPower(chainId, collateral ?? 0n, who, margin),
    fetch: (client) =>
      client.getBorrowingPower({
        collateral: collateral as bigint,
        ...(who !== undefined ? { account: who } : {}),
        ...margin,
      }),
    // Zero is disabled rather than queried: `getBorrowingPower` rejects a non-positive collateral
    // with `InvalidAmount` (MK-010), and an empty input parsing to `0n` is the ordinary state of a
    // calculator being typed into, not an error to render.
    enabled: collateral !== undefined && collateral > 0n,
    select,
  })
}

/**
 * **The recommended draw** for an **open** at a given collateral: core `getBorrowingPower`'s
 * `recommended`, never its `ceiling` (MK-100).
 *
 * This is the figure to offer, and it is what `data` holds, so a consumer who uses the hook the way
 * the documentation shows cannot open a Trove at the liquidation threshold. It leaves the margin
 * `getBorrowingPower` reports: a Trove opened at it survives the measured adverse price move and
 * interest window stated on `BORROWING_POWER_PRICE_MOVE_BPS` and
 * `BORROWING_POWER_MARGIN_WINDOW_SECONDS`. Until 0.4.0 this hook returned the ceiling, which in
 * normal mode opens at exactly 110% and was liquidated a second later on a fork. For the ceiling,
 * the margin and both starting ratios, use {@link useBorrowingPowerDetail}.
 *
 * `account` defaults to the connected wallet (MK-106), because the borrowing fee is skipped for a
 * fee exempt account (`BorrowerOperations.sol:637-643`) and the answer differs for it.
 *
 * It sizes an OPEN, not a top-up: an existing Trove is gated on its `maxBorrowingCapacity`
 * (`BorrowerOperations.sol:1358-1365`), which is set at open, lowered on a collateral decrease and
 * reset by a refinance (MK-101). For a Trove that already exists use {@link useBorrowPreview} or
 * {@link useBorrowingCapacity} (MK-002).
 *
 * Refetches on new blocks (the binding ratio, the price and the system TCR can all move).
 */
export function useBorrowingPower(params: BorrowingPowerHookParams): UseQueryResult<bigint, Error> {
  return useBorrowingPowerQuery(params, (power) => power.recommended)
}

/**
 * Both borrowing power figures, the margin between them and the ratios each opens at (MK-100):
 * core `getBorrowingPower`'s whole result. `ceiling` is a limit to DISPLAY, and a Trove opened at
 * it is liquidatable within seconds in normal mode; offer `recommended`. Shares one fetch with
 * {@link useBorrowingPower}.
 */
export function useBorrowingPowerDetail(
  params: BorrowingPowerHookParams,
): UseQueryResult<BorrowingPower, Error> {
  return useBorrowingPowerQuery(params, (power) => power)
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
    queryKey: musdQueryKeys.borrowPreview(chainId, owner ?? '0x', amount),
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
 *
 * **An omitted leg stays omitted (MK-085).** This hook used to default all four legs to `0n`
 * and forward them, which made `increaseDebt` present on every call. `previewAdjustTrove`
 * reads `_isDebtIncrease` from PRESENCE (MK-060), mirroring `_adjustTrove`'s own separate
 * `_isDebtIncrease` parameter (`BorrowerOperations.sol:757-758`), so through this hook every
 * adjustment was evaluated as a debt increase: a pure top-up came back
 * `ZERO_DEBT_INCREASE` (`:785-787`, `:1351-1356`) and a pure repayment came back refused with
 * `resultingEntireDebt` and `resultingIcr` computed as though nothing had been repaid.
 */
export function useAdjustTrovePreview(params: {
  owner: Address | undefined
  addCollateral?: bigint | undefined
  withdrawCollateral?: bigint | undefined
  increaseDebt?: bigint | undefined
  repayDebt?: bigint | undefined
}): UseQueryResult<AdjustPreview, Error> {
  const chainId = useChainId()
  const { owner } = params
  // MK-085. Built ONCE, from presence, and handed to both the key and the call, so the two
  // cannot describe different questions. `exactOptionalPropertyTypes` is on, so a conditional
  // spread is the only way to keep an absent leg absent rather than present-and-undefined.
  const legs: AdjustPreviewLegs = {
    ...(params.addCollateral !== undefined ? { addCollateral: params.addCollateral } : {}),
    ...(params.withdrawCollateral !== undefined
      ? { withdrawCollateral: params.withdrawCollateral }
      : {}),
    ...(params.increaseDebt !== undefined ? { increaseDebt: params.increaseDebt } : {}),
    ...(params.repayDebt !== undefined ? { repayDebt: params.repayDebt } : {}),
  }
  return useMusdQuery<AdjustPreview>({
    queryKey: musdQueryKeys.adjustPreview(chainId, owner ?? '0x', legs),
    fetch: (client) => client.previewAdjustTrove({ owner: owner as Address, ...legs }),
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
    queryKey: musdQueryKeys.withdrawCollateralPreview(chainId, owner ?? '0x', amount),
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
    queryKey: musdQueryKeys.redeemPreview(chainId, redeemer ?? '0x', amount),
    fetch: (client) =>
      client.previewRedeem({ redeemer: redeemer as Address, amount: amount as bigint }),
    enabled: redeemer !== undefined && amount !== undefined,
  })
}
