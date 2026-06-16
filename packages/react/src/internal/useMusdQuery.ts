import type { MusdClient } from '@musd-kit/core'
import {
  type QueryKey,
  type UseQueryResult,
  keepPreviousData,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useBlockNumber } from 'wagmi'
import { useMusdClient } from './useMusdClient'

/**
 * Shared read-hook engine: a TanStack `useQuery` keyed by (chainId + method + args) that
 * refetches on every new block — the standard wagmi pattern (`useBlockNumber({ watch })` →
 * invalidate the query). Hooks passing the SAME `queryKey` dedupe to one fetch; per-hook
 * `select` projects the shared result. `UnsupportedChain` (from {@link useMusdClient}) is
 * surfaced via `error` without an extra fetch.
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

  const query = useQuery({
    queryKey: opts.queryKey,
    queryFn: () => opts.fetch(client as MusdClient),
    enabled: (opts.enabled ?? true) && client !== null,
    placeholderData: keepPreviousData,
    ...(opts.select ? { select: opts.select } : {}),
  }) as UseQueryResult<TSelected, Error>

  // Refetch on each new block (invalidate the shared key — dedup keeps it to one fetch). The
  // key array is rebuilt each render, so we read it via a ref and depend only on blockNumber
  // (a changed address spawns a new query that fetches on mount on its own).
  const invalidateRef = useRef<() => void>(() => {})
  invalidateRef.current = () => void queryClient.invalidateQueries({ queryKey: opts.queryKey })
  useEffect(() => {
    if (blockNumber !== undefined) invalidateRef.current()
  }, [blockNumber])

  if (clientError && !query.error) {
    return {
      ...query,
      error: clientError,
      isError: true,
    } as unknown as UseQueryResult<TSelected, Error>
  }
  return query
}
