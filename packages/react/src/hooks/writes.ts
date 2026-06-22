import type {
  AdjustTroveParams,
  BorrowParams,
  ClaimResult,
  MusdClient,
  MusdError,
  OpenTroveParams,
  RedeemParams,
  RedeemResult,
  WriteResult,
} from '@musd-kit/core'
import { MissingWalletClient } from '@musd-kit/core'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Address, Hex } from 'viem'
import { useAccount, useChainId } from 'wagmi'
import { musdQueryKeys } from '../internal/keys'
import { useMusdClient } from '../internal/useMusdClient'

/** Common wagmi-idiomatic write-hook shape. `error` is the core's typed `MusdError`. */
export interface MusdWriteResult<TParams, TData> {
  /** Fire the write (fire-and-forget; track via `isPending`/`isSuccess`/`error`). */
  mutate: (params: TParams) => void
  /** Promise-returning variant (resolves to the result, or rejects with the typed error). */
  mutateAsync: (params: TParams) => Promise<TData>
  /** `true` while the write is in flight. */
  isPending: boolean
  /** `true` once the write has been submitted successfully. */
  isSuccess: boolean
  /** `true` if the write failed (see `error`). */
  isError: boolean
  /** The core's typed `MusdError`, or `null`. */
  error: MusdError | null
  /** The submitted tx hash (once available), or `null`. */
  hash: Hex | null
  /** The full core result (e.g. `RedeemResult` carries `truncatedAmount` + `fee`). */
  data: TData | undefined
  /** Reset the mutation back to idle. */
  reset: () => void
}

/**
 * Shared write engine: a TanStack `useMutation` wrapping a core write method. The core
 * already simulates-before-send, computes hints, and throws typed `MusdError`s, the hook
 * adds only reactive status and (on success) invalidation of the caller's `useTrove` query
 * so the UI refreshes. A missing wallet surfaces `MissingWalletClient` via `error`, never a
 * render-time throw.
 */
function useMusdWrite<TParams, TData extends { hash?: Hex | null }>(
  method: (client: MusdClient, params: TParams) => Promise<TData>,
): MusdWriteResult<TParams, TData> {
  const { client, error: clientError } = useMusdClient()
  const chainId = useChainId()
  const { address } = useAccount()
  const queryClient = useQueryClient()

  const mutation = useMutation<TData, Error, TParams>({
    mutationFn: (params) => {
      if (!client) throw clientError ?? new MissingWalletClient()
      return method(client, params)
    },
    onSuccess: () => {
      if (address) {
        void queryClient.invalidateQueries({ queryKey: musdQueryKeys.trove(chainId, address) })
        void queryClient.invalidateQueries({ queryKey: musdQueryKeys.balance(chainId, address) })
      }
    },
  })

  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: (mutation.error as MusdError | null) ?? null,
    hash: (mutation.data as { hash?: Hex | null } | undefined)?.hash ?? null,
    data: mutation.data,
    reset: mutation.reset,
  }
}

/** Result of {@link useOpenTrove}, the write shape with a named `openTrove` action. */
export interface UseOpenTroveResult extends MusdWriteResult<OpenTroveParams, WriteResult> {
  /** Open a Trove (alias of `mutate`). */
  openTrove: MusdWriteResult<OpenTroveParams, WriteResult>['mutate']
  /** Promise-returning `openTrove` (alias of `mutateAsync`). */
  openTroveAsync: MusdWriteResult<OpenTroveParams, WriteResult>['mutateAsync']
}
/** Open a Trove (core `openTrove`). `openTrove(params)` is the action. */
export function useOpenTrove(): UseOpenTroveResult {
  const w = useMusdWrite<OpenTroveParams, WriteResult>((c, p) => c.openTrove(p))
  return { ...w, openTrove: w.mutate, openTroveAsync: w.mutateAsync }
}

/** Result of {@link useAddCollateral}. */
export interface UseAddCollateralResult extends MusdWriteResult<{ amount: bigint }, WriteResult> {
  /** Top up collateral (alias of `mutate`). */
  addCollateral: MusdWriteResult<{ amount: bigint }, WriteResult>['mutate']
  /** Promise-returning `addCollateral`. */
  addCollateralAsync: MusdWriteResult<{ amount: bigint }, WriteResult>['mutateAsync']
}
/** Top up collateral (core `addCollateral`). */
export function useAddCollateral(): UseAddCollateralResult {
  const w = useMusdWrite<{ amount: bigint }, WriteResult>((c, p) => c.addCollateral(p))
  return { ...w, addCollateral: w.mutate, addCollateralAsync: w.mutateAsync }
}

/** Result of {@link useBorrow}. */
export interface UseBorrowResult extends MusdWriteResult<BorrowParams, WriteResult> {
  /** Borrow more MUSD (alias of `mutate`). */
  borrow: MusdWriteResult<BorrowParams, WriteResult>['mutate']
  /** Promise-returning `borrow`. */
  borrowAsync: MusdWriteResult<BorrowParams, WriteResult>['mutateAsync']
}
/** Borrow more MUSD (core `borrow` → `withdrawMUSD`). */
export function useBorrow(): UseBorrowResult {
  const w = useMusdWrite<BorrowParams, WriteResult>((c, p) => c.borrow(p))
  return { ...w, borrow: w.mutate, borrowAsync: w.mutateAsync }
}

/** Result of {@link useRepay}. */
export interface UseRepayResult extends MusdWriteResult<{ amount: bigint }, WriteResult> {
  /** Repay debt (alias of `mutate`). */
  repay: MusdWriteResult<{ amount: bigint }, WriteResult>['mutate']
  /** Promise-returning `repay`. */
  repayAsync: MusdWriteResult<{ amount: bigint }, WriteResult>['mutateAsync']
}
/** Repay debt (core `repay`; no approval needed). */
export function useRepay(): UseRepayResult {
  const w = useMusdWrite<{ amount: bigint }, WriteResult>((c, p) => c.repay(p))
  return { ...w, repay: w.mutate, repayAsync: w.mutateAsync }
}

/** Result of {@link useWithdrawCollateral}. */
export interface UseWithdrawCollateralResult
  extends MusdWriteResult<{ amount: bigint }, WriteResult> {
  /** Withdraw collateral (alias of `mutate`). */
  withdrawCollateral: MusdWriteResult<{ amount: bigint }, WriteResult>['mutate']
  /** Promise-returning `withdrawCollateral`. */
  withdrawCollateralAsync: MusdWriteResult<{ amount: bigint }, WriteResult>['mutateAsync']
}
/** Withdraw collateral (core `withdrawCollateral`). */
export function useWithdrawCollateral(): UseWithdrawCollateralResult {
  const w = useMusdWrite<{ amount: bigint }, WriteResult>((c, p) => c.withdrawCollateral(p))
  return { ...w, withdrawCollateral: w.mutate, withdrawCollateralAsync: w.mutateAsync }
}

/** Result of {@link useAdjustTrove}. */
export interface UseAdjustTroveResult extends MusdWriteResult<AdjustTroveParams, WriteResult> {
  /** Adjust the Trove (alias of `mutate`). */
  adjustTrove: MusdWriteResult<AdjustTroveParams, WriteResult>['mutate']
  /** Promise-returning `adjustTrove`. */
  adjustTroveAsync: MusdWriteResult<AdjustTroveParams, WriteResult>['mutateAsync']
}
/** Combined collateral ± and/or debt ± in one call (core `adjustTrove`). */
export function useAdjustTrove(): UseAdjustTroveResult {
  const w = useMusdWrite<AdjustTroveParams, WriteResult>((c, p) => c.adjustTrove(p))
  return { ...w, adjustTrove: w.mutate, adjustTroveAsync: w.mutateAsync }
}

/** Result of {@link useCloseTrove}, no params. */
export interface UseCloseTroveResult extends MusdWriteResult<void, WriteResult> {
  /** Close the Trove (full payoff). */
  closeTrove: () => void
  /** Promise-returning `closeTrove`. */
  closeTroveAsync: () => Promise<WriteResult>
}
/** Close the Trove, full payoff (core `close`). No params. */
export function useCloseTrove(): UseCloseTroveResult {
  const w = useMusdWrite<void, WriteResult>((c) => c.close())
  return { ...w, closeTrove: () => w.mutate(), closeTroveAsync: () => w.mutateAsync() }
}

/** Result of {@link useClaimCollateral}, no params. */
export interface UseClaimCollateralResult extends MusdWriteResult<void, ClaimResult> {
  /** Claim collateral surplus. */
  claim: () => void
  /** Promise-returning `claim`. */
  claimAsync: () => Promise<ClaimResult>
}
/** Claim collateral surplus (core `claim`; a safe no-op when there is none). No params. */
export function useClaimCollateral(): UseClaimCollateralResult {
  const w = useMusdWrite<void, ClaimResult>((c) => c.claim())
  return { ...w, claim: () => w.mutate(), claimAsync: () => w.mutateAsync() }
}

/** Result of {@link useRefinance}, no params. */
export interface UseRefinanceResult extends MusdWriteResult<void, WriteResult> {
  /** Refinance to the current global rate. */
  refinance: () => void
  /** Promise-returning `refinance`. */
  refinanceAsync: () => Promise<WriteResult>
}
/** Move the Trove to the current global rate (core `refinance`). No params. */
export function useRefinance(): UseRefinanceResult {
  const w = useMusdWrite<void, WriteResult>((c) => c.refinance())
  return { ...w, refinance: () => w.mutate(), refinanceAsync: () => w.mutateAsync() }
}

/** Result of {@link useRedeem}. `data` is the `RedeemResult` (`{ hash, truncatedAmount, fee }`). */
export interface UseRedeemResult extends MusdWriteResult<RedeemParams, RedeemResult> {
  /** Redeem MUSD for BTC (alias of `mutate`). */
  redeem: MusdWriteResult<RedeemParams, RedeemResult>['mutate']
  /** Promise-returning `redeem`. */
  redeemAsync: MusdWriteResult<RedeemParams, RedeemResult>['mutateAsync']
}
/** Redeem MUSD for BTC (core `redeem`). */
export function useRedeem(): UseRedeemResult {
  const w = useMusdWrite<RedeemParams, RedeemResult>((c, p) => c.redeem(p))
  return { ...w, redeem: w.mutate, redeemAsync: w.mutateAsync }
}

export type { Address }
