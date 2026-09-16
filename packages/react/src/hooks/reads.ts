import type {
  AdjustPreview,
  BorrowPreview,
  BorrowingCapacity,
  BorrowingPower,
  ClosePreview,
  MarginDraw,
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
}

/** {@link useDrawForMargin}'s parameters: the collateral and account, and the margin the caller chooses. */
export interface DrawForMarginHookParams extends BorrowingPowerHookParams {
  /**
   * Core's `horizonSeconds`: how long the position must survive. **Required, with no default**
   * (MK-240). `undefined` keeps the hook disabled rather than substituting a horizon: a form whose
   * horizon field is empty has not asked the question yet.
   */
  horizonSeconds: bigint | undefined
  /**
   * Core's `priceFallBps`: the price fall the position must survive, from `0n` up to but excluding
   * `10_000n`. **Required, with no default** (MK-240), and `undefined` keeps the hook disabled.
   */
  priceFallBps: bigint | undefined
}

/** The account a borrowing power hook asks for: the caller's, else the connected wallet (MK-106). */
function useOpenerAccount(account: Address | undefined): Address | undefined {
  // MK-106. The hook runs inside a wagmi context that knows the connected wallet, so an omitted
  // `account` means that wallet rather than "not fee exempt". An explicit account still wins.
  const { address: connected } = useAccount()
  return account ?? connected
}

/**
 * **The contract's ceiling** for an **open** at a given collateral: core `getBorrowingPower`'s whole
 * result, `{ ceiling, ceilingIcr, isRecoveryMode, price }` (MK-100, MK-240).
 *
 * **There is no amount to borrow in `data`, and that is deliberate.** Until 0.5.0 `data` was a bare
 * `recommended` draw sized for one hour and a 2 percent fall, and the README presented it as the draw
 * to offer; a position held for days was likely to be liquidated at it (MK-240). The ceiling is a
 * limit to DISPLAY: a Trove opened at it in normal mode is liquidatable within seconds. For a draw
 * sized to a margin the user chooses, use {@link useDrawForMargin}.
 *
 * `account` defaults to the connected wallet (MK-106), because the borrowing fee is skipped for a fee
 * exempt account (`BorrowerOperations.sol:637-643`) and the answer differs for it.
 *
 * It sizes an OPEN, not a top-up: an existing Trove is gated on its `maxBorrowingCapacity`
 * (`BorrowerOperations.sol:1358-1365`), which is set at open, lowered on a collateral decrease and
 * reset by a refinance (MK-101). For a Trove that already exists use {@link useBorrowPreview} or
 * {@link useBorrowingCapacity} (MK-002).
 *
 * Refetches on new blocks (the binding ratio, the price and the system TCR can all move).
 */
export function useBorrowingPower(
  params: BorrowingPowerHookParams,
): UseQueryResult<BorrowingPower, Error> {
  const chainId = useChainId()
  const { collateral } = params
  const who = useOpenerAccount(params.account)
  return useMusdQuery<BorrowingPower>({
    queryKey: musdQueryKeys.borrowingPower(chainId, collateral ?? 0n, who),
    fetch: (client) =>
      client.getBorrowingPower({
        collateral: collateral as bigint,
        ...(who !== undefined ? { account: who } : {}),
      }),
    // Zero is disabled rather than queried: `getBorrowingPower` rejects a non-positive collateral
    // with `InvalidAmount` (MK-010), and an empty input parsing to `0n` is the ordinary state of a
    // calculator being typed into, not an error to render.
    enabled: collateral !== undefined && collateral > 0n,
  })
}

/**
 * **A draw sized to a margin the caller chooses** (core `drawForMargin`, MK-240): the largest open that
 * survives `priceFallBps` of price fall and `horizonSeconds` of interest, with the ceiling beside it and
 * the margin it was solved with.
 *
 * **Both inputs are required and neither has a default.** How long a position will be held and how far
 * the price may fall are the user's decisions; the library cannot make them. The hook stays disabled,
 * `data: undefined`, until both are supplied. The price history that helps choose them is in
 * `docs/03-core-api.md` and on core `drawForMargin`.
 *
 * `data.draw` answers the margin in `data.margin` and nothing else: a larger fall, a longer hold, or
 * debt redistributed from another Trove's liquidation can still take the position to liquidation.
 * Render the margin beside the figure, never the figure alone.
 */
export function useDrawForMargin(
  params: DrawForMarginHookParams,
): UseQueryResult<MarginDraw, Error> {
  const chainId = useChainId()
  const { collateral, horizonSeconds, priceFallBps } = params
  const who = useOpenerAccount(params.account)
  return useMusdQuery<MarginDraw>({
    queryKey: musdQueryKeys.drawForMargin(
      chainId,
      collateral ?? 0n,
      who,
      horizonSeconds,
      priceFallBps,
    ),
    fetch: (client) =>
      client.drawForMargin({
        collateral: collateral as bigint,
        horizonSeconds: horizonSeconds as bigint,
        priceFallBps: priceFallBps as bigint,
        ...(who !== undefined ? { account: who } : {}),
      }),
    // PRESENCE for the margin, VALUE for the collateral, and each for a reason (MK-244's enumeration):
    // `0n` is a meaningful horizon and a meaningful fall, a margin of nothing, so only an absent one
    // disables; a zero collateral is refused by core and is the empty state of an input.
    enabled:
      collateral !== undefined &&
      collateral > 0n &&
      horizonSeconds !== undefined &&
      priceFallBps !== undefined,
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
 * and forward them, which made `increaseDebt` present on every call. `previewAdjustTrove` then
 * read `_isDebtIncrease` from PRESENCE, mirroring `_adjustTrove`'s own separate
 * `_isDebtIncrease` parameter (`BorrowerOperations.sol:757-758`), so through this hook every
 * adjustment was evaluated as a debt increase: a pure top-up came back
 * `ZERO_DEBT_INCREASE` (`:785-787`, `:1351-1356`) and a pure repayment came back refused with
 * `resultingEntireDebt` and `resultingIcr` computed as though nothing had been repaid.
 *
 * **Since 0.5.0 the flag is derived from the VALUE (MK-244; this comment is MK-252).** A leg of
 * `0n` is no leg, in this hook, in `previewAdjustTrove` and in `adjustTrove`, so
 * `{ addCollateral: 0n, withdrawCollateral: x }` is a withdrawal rather than a refusal. Absence
 * still matters here for a different reason: an absent leg is kept out of the query key, so two
 * different questions cannot share one cache entry.
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
  // MK-085. Built ONCE, keeping an absent leg absent, and handed to both the key and the call, so
  // the two cannot describe different questions. The evaluator reads the legs by VALUE since
  // MK-244; what absence decides here is the cache key, not the verdict (MK-252).
  // `exactOptionalPropertyTypes` is on, so a conditional
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
 *
 * **Render `capacityAfter` beside the verdict** (MK-242): a withdrawal can permanently lower the Trove's
 * borrowing capacity, adding the collateral back does not restore it, and `capacityAfter.recovery` is
 * the refinance fee and rate change that would.
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
 * **A limit to display, not an amount to withdraw** (MK-247). When the individual ratio caps it, a
 * withdrawal of exactly `amount` leaves the Trove at the 110% liquidation threshold
 * (`TroveManager.sol:1146-1148`): refused a second later as interest accrues (MK-051), and if the price
 * rises first, accepted and left at MCR, where the next fall liquidates it. Do not wire it to a "max"
 * button that sends it. It also removes borrowing capacity that adding the collateral back does not
 * restore, reported with the refinance that would win it back in `capacityAfter` (MK-242).
 *
 * `limitedBy` says whether the cap is the position's own ratio, the system ratio, or Recovery Mode
 * refusing withdrawal entirely, which are three different things to tell a user.
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
 * **Do not size a redemption from `getRedemptionHints`.** Its truncated amount answers a different
 * question, and `RedeemResult` no longer carries it (MK-241): the helper sizes each
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
