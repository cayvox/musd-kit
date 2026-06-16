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
  isPending: boolean
  isSuccess: boolean
  isError: boolean
  error: MusdError | null
  /** The submitted tx hash (once available), or `null`. */
  hash: Hex | null
  /** The full core result (e.g. `RedeemResult` carries `truncatedAmount` + `fee`). */
  data: TData | undefined
  reset: () => void
}

/**
 * Shared write engine: a TanStack `useMutation` wrapping a core write method. The core
 * already simulates-before-send, computes hints, and throws typed `MusdError`s — the hook
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

/** Open a Trove (core `openTrove`). `openTrove(params)` is the action. */
export function useOpenTrove() {
  const w = useMusdWrite<OpenTroveParams, WriteResult>((c, p) => c.openTrove(p))
  return { ...w, openTrove: w.mutate, openTroveAsync: w.mutateAsync }
}

/** Top up collateral (core `addCollateral`). */
export function useAddCollateral() {
  const w = useMusdWrite<{ amount: bigint }, WriteResult>((c, p) => c.addCollateral(p))
  return { ...w, addCollateral: w.mutate, addCollateralAsync: w.mutateAsync }
}

/** Borrow more MUSD (core `borrow` → `withdrawMUSD`). */
export function useBorrow() {
  const w = useMusdWrite<BorrowParams, WriteResult>((c, p) => c.borrow(p))
  return { ...w, borrow: w.mutate, borrowAsync: w.mutateAsync }
}

/** Repay debt (core `repay`; no approval needed). */
export function useRepay() {
  const w = useMusdWrite<{ amount: bigint }, WriteResult>((c, p) => c.repay(p))
  return { ...w, repay: w.mutate, repayAsync: w.mutateAsync }
}

/** Withdraw collateral (core `withdrawCollateral`). */
export function useWithdrawCollateral() {
  const w = useMusdWrite<{ amount: bigint }, WriteResult>((c, p) => c.withdrawCollateral(p))
  return { ...w, withdrawCollateral: w.mutate, withdrawCollateralAsync: w.mutateAsync }
}

/** Combined collateral ± and/or debt ± in one call (core `adjustTrove`). */
export function useAdjustTrove() {
  const w = useMusdWrite<AdjustTroveParams, WriteResult>((c, p) => c.adjustTrove(p))
  return { ...w, adjustTrove: w.mutate, adjustTroveAsync: w.mutateAsync }
}

/** Close the Trove — full payoff (core `close`). No params. */
export function useCloseTrove() {
  const w = useMusdWrite<void, WriteResult>((c) => c.close())
  return { ...w, closeTrove: () => w.mutate(), closeTroveAsync: () => w.mutateAsync() }
}

/** Claim collateral surplus (core `claim`; a safe no-op when there is none). No params. */
export function useClaimCollateral() {
  const w = useMusdWrite<void, ClaimResult>((c) => c.claim())
  return { ...w, claim: () => w.mutate(), claimAsync: () => w.mutateAsync() }
}

/** Move the Trove to the current global rate (core `refinance`). No params. */
export function useRefinance() {
  const w = useMusdWrite<void, WriteResult>((c) => c.refinance())
  return { ...w, refinance: () => w.mutate(), refinanceAsync: () => w.mutateAsync() }
}

/**
 * Redeem MUSD for BTC (core `redeem`). `data` is the `RedeemResult`
 * (`{ hash, truncatedAmount, fee }`).
 */
export function useRedeem() {
  const w = useMusdWrite<RedeemParams, RedeemResult>((c, p) => c.redeem(p))
  return { ...w, redeem: w.mutate, redeemAsync: w.mutateAsync }
}

export type { Address }
