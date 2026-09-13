# @musd-kit/react

**wagmi-idiomatic React hooks for MUSD on Mezo**, over
[`@musd-kit/core`](https://www.npmjs.com/package/@musd-kit/core). **Passport connects the
wallet; musd-kit operates MUSD**, these hooks consume the wagmi context Passport (or any
wagmi setup) already established. There is **no musd-kit provider**.

> ⚠️ **Community tooling, not official.** Independent, open-source, **not affiliated with or
> endorsed by Mezo**. An unofficial community **Mezo MUSD SDK**. **Status: pre-1.0 (`0.x`),
> for testnet and evaluation.** License: MIT.

## `useBorrowingPower` returns the recommended draw, not the ceiling (MK-100)

Since 0.4.0 `data` is the **recommended** draw: the largest open that still clears every gate after
a measured adverse price move and an interest window, both stated on
`BORROWING_POWER_PRICE_MOVE_BPS` and `BORROWING_POWER_MARGIN_WINDOW_SECONDS` in `@musd-kit/core`.
The contract's **ceiling** is available from `useBorrowingPowerDetail`, over the same single fetch.
Show the ceiling as a limit and never open at it: in normal mode it lands the position at exactly
the 110% minimum collateral ratio, and a fork reproduction found it liquidatable one second later.

Until 0.3.1 this hook returned the ceiling. The record is MK-100 in
[`FINDINGS.md`](https://github.com/cayvox/musd-kit/blob/main/FINDINGS.md).

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

## Upgrading

**To 0.4.0.** `useBorrowingPower` returns the recommended draw instead of the ceiling, and an omitted
`account` now means the connected wallet (MK-106). A read hook whose inputs changed, or that is
disabled, reports `data: undefined` and `pending` until the new question is answered, instead of the
previous answer marked as a success (MK-102); a write hook resets when the account or chain changes.
The core changes behind the hooks are listed in `CHANGELOG.md`.

**From 0.1.0.** This package re-exported wrong numbers from `@musd-kit/core` 0.1.0 on seven surfaces;
read `docs/11-migration-0.1-to-0.2.md` first.

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
import { parseBtc, parseMusd } from '@musd-kit/core'
import { useBorrowingPower, useOpenTrove, useTrove } from '@musd-kit/react'

function Position({ address }: { address: `0x${string}` }) {
  const { data: trove, isPending } = useTrove({ address }) // refetched on new blocks
  if (isPending || !trove) return <Spinner />
  return <HealthBadge factor={trove.healthFactor} debt={trove.entireDebt} />
}

function OpenForm() {
  const collateral = parseBtc('0.05')
  const { data: recommended } = useBorrowingPower({ collateral }) // the draw to offer (MK-100)
  const { openTrove, isPending, error } = useOpenTrove() // error is a typed MusdError
  return (
    <button
      disabled={isPending || recommended === undefined}
      onClick={() => openTrove({ collateral, debt: parseMusd('2500') })}
    >
      {isPending ? 'Opening…' : 'Open Trove'}
    </button>
  )
}
```

**Reads** (`useQuery`, refetched on every new block), fifteen: `useTrove`, `useHealthFactor`,
`useLiquidationPrice`, `useBorrowingPower`, `useBorrowingPowerDetail`, `useBorrowPreview`,
`useBorrowingCapacity`, `useRefinancePreview`, `useOraclePrice`, `useMusdBalance`,
`useAdjustTrovePreview`, `useWithdrawCollateralPreview`, `useMaxWithdrawableCollateral`,
`useClosePreview`, `useRedeemPreview`.
**Writes** (`useMutation`, typed errors), ten: `useOpenTrove`, `useAddCollateral`, `useBorrow`,
`useRepay`, `useWithdrawCollateral`, `useAdjustTrove`, `useCloseTrove`, `useClaimCollateral`,
`useRefinance`, `useRedeem`.

**What this package re-exports from `@musd-kit/core`**: every `MusdError` class and `MusdErrorCode`,
`TroveStatus`, and the types the hooks take and return. It does not re-export the core's functions,
constants or unit helpers; import those, `parseBtc` and `parseMusd` among them, from `@musd-kit/core`
(MK-109).

See the [`open-and-manage` example](https://github.com/cayvox/musd-kit/tree/main/examples/open-and-manage)
for a full Passport + musd-kit app, and the
[docs](https://github.com/cayvox/musd-kit/tree/main/docs) for the API reference.
