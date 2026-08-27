# @musd-kit/react

**wagmi-idiomatic React hooks for MUSD on Mezo**, over
[`@musd-kit/core`](https://www.npmjs.com/package/@musd-kit/core). **Passport connects the
wallet; musd-kit operates MUSD**, these hooks consume the wagmi context Passport (or any
wagmi setup) already established. There is **no musd-kit provider**.

> ⚠️ **Community tooling, not official.** Independent, open-source, **not affiliated with or
> endorsed by Mezo**. An unofficial community **Mezo MUSD SDK**. **Status: pre-1.0 (`0.x`),
> for testnet and evaluation.** License: MIT.

## Install

```sh
npm install @musd-kit/react @musd-kit/core wagmi@^2 viem@^2 @tanstack/react-query@^5 react@^18
```

Peer deps (match Passport's ranges so both resolve to single singletons): `wagmi ^2.5.12`,
`viem ^2.22.8`, `@tanstack/react-query ^5.28.4`, `react ^18.2.0`. Peer-depends on **wagmi,
not Passport**, usable with any wagmi connection layer.

> **In a Passport app these are already satisfied**, `@mezo-org/passport` pins wagmi 2.x and
> React 18, so you only need `npm install @musd-kit/react @musd-kit/core`. The pinned
> majors above (`wagmi@^2`, `react@^18`) are for a standalone install: wagmi 3.x / React 19
> are not yet validated against the Passport ecosystem (see the React-19 note in
> `docs/04-react-api.md`), so install latest of those unpinned and the peer ranges won't match.

## Upgrading from 0.1.0

**The hooks are purely additive at 0.2.0**: `useBorrowPreview`, `useBorrowingCapacity` and
`useRefinancePreview` are new, nothing was removed or renamed. **But this package re-exports
`@musd-kit/core`, where 0.1.0 returned wrong numbers on seven surfaces**, and the shape changes to
`OpenPreview` and `RedeemResult` reach you through `useOpenTrove` and `useRedeem`. Read
`docs/11-migration-0.1-to-0.2.md` before upgrading.

## Usage

The hooks work inside the wagmi context Passport sets up, no extra provider:

```tsx
// Passport provides the wagmi config + connection (Mezo's official path)
<WagmiProvider config={getConfig({ appName: 'My MUSD dApp' })}>
  <QueryClientProvider client={queryClient}>
    <RainbowKitProvider initialChain={mezoTestnet}>
      <YourApp /> {/* musd-kit hooks work here, no extra provider */}
    </RainbowKitProvider>
  </QueryClientProvider>
</WagmiProvider>
```

```tsx
import { useTrove, useBorrowingPower, useOpenTrove } from '@musd-kit/react'

function Position({ address }: { address: `0x${string}` }) {
  const { data: trove, isLoading } = useTrove({ address }) // refetched on new blocks
  if (isLoading) return <Spinner />
  return <HealthBadge factor={trove.healthFactor} debt={trove.entireDebt} />
}

function OpenForm() {
  const { openTrove, isPending, error } = useOpenTrove() // error is a typed MusdError
  return (
    <button disabled={isPending} onClick={() => openTrove({ collateral: parseBtc('0.05'), debt: parseMusd('2500') })}>
      {isPending ? 'Opening…' : 'Open Trove'}
    </button>
  )
}
```

**Reads** (`useQuery`, block-watching refetch): `useTrove`, `useHealthFactor`,
`useLiquidationPrice`, `useBorrowingPower`, `useOraclePrice`, `useMusdBalance`.
**Writes** (`useMutation`, typed errors): `useOpenTrove`, `useAddCollateral`, `useBorrow`,
`useRepay`, `useWithdrawCollateral`, `useAdjustTrove`, `useCloseTrove`, `useClaimCollateral`,
`useRefinance`, `useRedeem`.

See the [`open-and-manage` example](https://github.com/cayvox/musd-kit/tree/main/examples/open-and-manage)
for a full Passport + musd-kit app, and the
[docs](https://github.com/cayvox/musd-kit/tree/main/docs) for the API reference.
