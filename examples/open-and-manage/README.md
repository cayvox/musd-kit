# examples/open-and-manage, a React MUSD dApp (Passport + @musd-kit/react)

A minimal Vite + React 18 reference app: **connect → preview → open → monitor health →
repay**, built on `@musd-kit/react` over `@musd-kit/core`.

**Passport connects the wallet; musd-kit operates MUSD, note there is no musd-kit provider,
the hooks consume Passport's wagmi context.** `main.tsx` wires `@mezo-org/passport`'s
`getConfig()` into `WagmiProvider` + `QueryClientProvider` + RainbowKit's
`RainbowKitProvider`; every `useTrove`/`useOpenTrove`/… call in `App.tsx` works inside that
context with no extra provider (decision O4).

## What it shows

- **Preview / open** (`OpenCard`): collateral + debt inputs; live `useBorrowingPower` and a
  `previewOpen` readout (fee, total debt, resulting ICR, liquidation price, `meetsMinimum`);
  `useOpenTrove`, guarded on `meetsMinimum` / Recovery-Mode rules.
- **Monitor / manage** (`PositionCard`): `useTrove` for the connected address, collateral,
  entire debt, ICR, `useHealthFactor`, `useLiquidationPrice`, plus `useRepay`. A
  `SystemBar` shows `useOraclePrice` and Recovery-Mode status.
- Typed `MusdError`s from the hooks (`BelowMinimumDebt`, `ICRBelowMCR`, `MaxFeeExceeded`, …)
  rendered as readable messages.

`app-hooks.ts` shows the framework-agnostic core is directly reachable from the app
(`useMusdClient` → `previewOpen` / `getSystemState`), not just the prebuilt hooks.

## Run

```sh
pnpm install
pnpm --filter @musd-kit/example-open-and-manage dev      # http://localhost:5173
pnpm --filter @musd-kit/example-open-and-manage build    # production build
```

Connect a wallet on **Mezo testnet (31611)** and fund it with BTC for gas.

> Community tooling for testnet / evaluation, not audited, not financial advice.
