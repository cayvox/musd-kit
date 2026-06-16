# 04 — React API (`@musd-kit/react`)

Thin hooks over the core, in wagmi's exact idiom. They assume a wagmi context (from
Passport's `getConfig` or any wagmi setup) is already present — `musd-kit` consumes
the provider, it does not supply one (decision O4). Read hooks return
`{ data, isLoading, error }` and refetch on new blocks via TanStack Query; write
hooks return a `writeContract`-style function plus status.

A wagmi developer should recognize every signature on sight. Each hook delegates to
`@musd-kit/core`; the React layer adds only the reactive wrapper.

---

## 1. Reading

```tsx
import { useTrove, useHealthFactor, useBorrowingPower } from '@musd-kit/react';

function Position({ address }: { address: `0x${string}` }) {
  const { data: trove, isLoading } = useTrove({ address });
  if (isLoading) return <Spinner />;
  return (
    <div>
      <p>Debt: {formatMusd(trove.entireDebt)}</p>
      <p>Liquidation price: {formatUsd(trove.liquidationPrice)}</p>
      <HealthBadge factor={trove.healthFactor} />
    </div>
  );
}
```

`useTrove` returns the same contract-authoritative object as `core.getTrove`
(`03-core-api` §2) — refetched on new blocks.

```tsx
// A borrowing-power calculator — no live position needed (preview math)
const { data } = useBorrowingPower({ collateral: parseBtc('0.05') });
// data.maxBorrowable, data.atICR, data.liquidationPrice
```

---

## 2. Writing

```tsx
import { useOpenTrove } from '@musd-kit/react';

function OpenForm() {
  const { openTrove, isPending, error } = useOpenTrove();
  return (
    <button
      disabled={isPending}
      onClick={() => openTrove({ collateral: parseBtc('0.05'), debt: parseMusd('2500') })}
    >
      {isPending ? 'Opening…' : 'Open Trove'}
    </button>
  );
}
```

Each write hook handles hint computation and the protocol mechanics through the
core; the React layer adds only the reactive wrapper.

---

## 3. The v1 hook set (as shipped, Phase 8)

**Read:** `useTrove`, `useBorrowingPower`, `useLiquidationPrice`, `useHealthFactor`,
`useMusdBalance`, `useOraclePrice`.

`useHealthFactor` and `useLiquidationPrice` are selectors over the **same** `useTrove`
query (shared key + `select`) — three hooks for one address dedupe to a single fetch. All
read hooks refetch on new blocks (`useBlockNumber({ watch })` → invalidate).

> **`useMusdPeg` is deferred.** The core `getPeg` is unimplemented — Mezo exposes no
> MUSD/USD oracle (Phase 2 / `09-open-questions`). Shipping a hook that returns a guessed
> peg would violate the prime directive, so it is **omitted from v1** and will land if/when
> a peg oracle exists.

**Write (1:1 with the core write methods):** `useOpenTrove`, `useAddCollateral`,
`useBorrow`, `useRepay`, `useWithdrawCollateral`, `useAdjustTrove`, `useCloseTrove`,
`useClaimCollateral`, `useRefinance`, `useRedeem`.

We ship the **dedicated single-axis hooks** (`useAddCollateral` → `addColl`, `useBorrow` →
`withdrawMUSD`, `useRepay`, `useWithdrawCollateral`) alongside `useAdjustTrove` — they read
better in a form-per-action UI and each maps to exactly one core method. Each write hook is
a `useMutation` returning the wagmi-style shape `{ <action>, isPending, isSuccess, error,
hash, data }` where `error` is the core's typed `MusdError`; `useRedeem`'s `data` carries
`{ hash, truncatedAmount, fee }`. After a successful write the caller's `useTrove` /
`useMusdBalance` queries are invalidated so the UI refreshes. Receipt-waiting is left to the
consumer (`useWaitForTransactionReceipt({ hash })`); v1 does not block the mutation on
confirmation.

---

## 4. The Passport relationship, concretely

A typical app wires Passport for connection and `musd-kit` for MUSD, side by side:

```tsx
// Passport provides the wagmi config and connection (Mezo's official path)
<WagmiProvider config={getConfig({ appName: 'My MUSD dApp' })}>
  <QueryClientProvider client={queryClient}>
    <RainbowKitProvider initialChain={mezoTestnet}>
      {/* musd-kit hooks work inside this context — no extra provider needed */}
      <YourApp />
    </RainbowKitProvider>
  </QueryClientProvider>
</WagmiProvider>
```

`@musd-kit/react` needs no provider of its own; it reads the wagmi context Passport
already established. The developer uses Passport for what it is good at and
`musd-kit` for what is missing, with zero integration friction.

---

## 5. Peer dependencies (verified — `02-architecture` §4)

Match Passport's own ranges so both resolve to single singletons in a consumer app:

```
wagmi                 ^2.5.12
viem                  ^2.22.8
@tanstack/react-query ^5.28.4
react                 ^18.2.0      // target React 18; widen to ^19 only after testing with Passport
```

`@musd-kit/react` peer-depends on **wagmi, not Passport** — keeping it usable with
any wagmi connection layer.

---

## 6. The one noted risk (stated openly)

The React hooks carry a "medium" collision risk: Passport is React/wagmi and could,
in principle, gain MUSD-specific hooks that overlap this layer. They stay in v1 (a
client SDK without hooks feels half-done), but the hedge is structural — the durable
value is the framework-agnostic core (`math/`, `hints/`, the typed reads), which is
exactly what *any* hooks (Passport's or ours) would have to call. If Passport ever
ships MUSD hooks, the core remains the correct, tested implementation of the hard
parts. This is stated in the docs and the grant, per `09-open-questions` and
Handbook §11.3.
