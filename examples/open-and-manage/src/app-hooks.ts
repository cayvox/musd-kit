// App-level convenience hooks built on the core client exposed by @musd-kit/react's
// `useMusdClient`. They wrap two core READ methods that don't ship as dedicated hooks
// (`previewOpen`, `getSystemState`) — demonstrating that the framework-agnostic core is
// directly reachable from the React app, not just the prebuilt hooks. No library code.
import type { OpenPreview, SystemState } from '@musd-kit/core'
import { useMusdClient } from '@musd-kit/react'
import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import { useChainId } from 'wagmi'

/** Live `previewOpen` for the entered collateral + debt (fee, ICR, liqPrice, meetsMinimum…). */
export function usePreviewOpen(
  collateral: bigint | undefined,
  debt: bigint | undefined,
): UseQueryResult<OpenPreview, Error> {
  const { client } = useMusdClient()
  const chainId = useChainId()
  return useQuery({
    queryKey: ['previewOpen', chainId, collateral?.toString(), debt?.toString()],
    queryFn: () =>
      (client as NonNullable<typeof client>).previewOpen({
        collateral: collateral as bigint,
        debt: debt as bigint,
      }),
    enabled:
      client !== null &&
      collateral !== undefined &&
      debt !== undefined &&
      collateral > 0n &&
      debt > 0n,
  })
}

/** Protocol-wide state ({ tcr, isRecoveryMode, price }). */
export function useSystemState(): UseQueryResult<SystemState, Error> {
  const { client } = useMusdClient()
  const chainId = useChainId()
  return useQuery({
    queryKey: ['systemState', chainId],
    queryFn: () => (client as NonNullable<typeof client>).getSystemState(),
    enabled: client !== null,
  })
}
