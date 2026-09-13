import type { MusdClient } from '@musd-kit/core'
import { type QueryKey, type UseQueryResult, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useBlockNumber } from 'wagmi'
import { useMusdClient } from './useMusdClient'

/**
 * Shared read-hook engine: a TanStack `useQuery` keyed by (chainId + method + args) that
 * refetches on every new block, the standard wagmi pattern (`useBlockNumber({ watch })` →
 * invalidate the query). Hooks passing the SAME `queryKey` dedupe to one fetch; per-hook
 * `select` projects the shared result. `UnsupportedChain` (from {@link useMusdClient}) is
 * surfaced via `error` without an extra fetch.
 *
 * **Data is only ever the answer to the question currently asked (MK-102).** This engine used to
 * pass `placeholderData: keepPreviousData`, which serves the PREVIOUS key's data while a new key
 * has none, and a disabled query never gets any, so a cleared input kept the verdict for the last
 * amount typed and a disconnected wallet kept the previous account's Trove, all with
 * `status: 'success'`. Three things now hold instead:
 *
 *   - no placeholder data, so a changed key is `pending` with `data: undefined` until it answers;
 *   - `gcTime: 0`, so returning to a key asked earlier cannot serve that key's old answer as
 *     current, since nothing is kept once no hook observes it;
 *   - a DISABLED query (an input missing, or no client) reports `data: undefined` and `pending`
 *     whatever the cache holds, because disabled means nothing was asked.
 *
 * Refetching the SAME key on a new block keeps the last answer visible while it refreshes
 * (`isFetching`), because it is the answer to the same question one block earlier.
 */
export function useMusdQuery<TData, TSelected = TData>(opts: {
  queryKey: QueryKey
  fetch: (client: MusdClient) => Promise<TData>
  enabled?: boolean
  select?: (data: TData) => TSelected
}): UseQueryResult<TSelected, Error> {
  const { client, error: clientError } = useMusdClient()
  const queryClient = useQueryClient()
  const { data: blockNumber } = useBlockNumber({ watch: true })
  const enabled = (opts.enabled ?? true) && client !== null

  const query = useQuery({
    queryKey: opts.queryKey,
    queryFn: () => opts.fetch(client as MusdClient),
    enabled,
    gcTime: 0,
    ...(opts.select ? { select: opts.select } : {}),
  }) as UseQueryResult<TSelected, Error>

  // Refetch on each new block (invalidate the shared key, dedup keeps it to one fetch). The
  // key array is rebuilt each render, so we read it via a ref and depend only on blockNumber
  // (a changed address spawns a new query that fetches on mount on its own).
  const invalidateRef = useRef<() => void>(() => {})
  invalidateRef.current = () => void queryClient.invalidateQueries({ queryKey: opts.queryKey })
  useEffect(() => {
    if (blockNumber !== undefined) invalidateRef.current()
  }, [blockNumber])

  if (!enabled) {
    // Nothing was asked, so nothing is answered, whatever sits under this key (MK-102).
    return {
      ...query,
      data: undefined,
      error: clientError ?? null,
      isError: clientError !== null,
      isSuccess: false,
      isPending: clientError === null,
      isLoadingError: false,
      isRefetchError: false,
      isPlaceholderData: false,
      status: clientError !== null ? 'error' : 'pending',
    } as unknown as UseQueryResult<TSelected, Error>
  }
  return query
}
