# examples/keeper — headless MUSD liquidation keeper

A tiny Node script that scans Mezo's `SortedTroves` from the lowest-ICR tail and liquidates
any Trove the protocol considers liquidatable, collecting the liquidation reward (200 MUSD +
0.5% of the Trove's BTC).

**This imports `@musd-kit/core` only — no React, no wagmi, no `@musd-kit/react`. That it
compiles and runs is the proof the core is framework-agnostic** (it is the structural
counterpart to the React hooks: the same core, with no UI runtime in sight). The boundary is
lint-enforced (a Biome `noRestrictedImports` override on this package) **and** asserted in CI
(the dependency graph contains no React/wagmi).

## What it does

1. Builds a viem `publicClient` + `walletClient` (from `KEEPER_PRIVATE_KEY`) and
   `createMusdClient`.
2. Walks `SortedTroves.getLast()` → `getPrev(...)` (lowest ICR first — the most likely
   liquidatable).
3. For each Trove, `isLiquidatable` (mode-aware: `ICR < MCR`, or `< CCR` in Recovery Mode);
   if so, `liquidate` (simulate-before-send — a healthy Trove surfaces `NothingToLiquidate`,
   which is caught and skipped).
4. Logs the actions and the MUSD reward received this pass.

Single pass by default; `--watch` polls every 15s.

## Run

```sh
export KEEPER_PRIVATE_KEY=0x...          # a funded key on Mezo testnet (needs BTC for gas)
export MEZO_RPC_URL=https://rpc.test.mezo.org   # optional; defaults to the public testnet RPC

pnpm install
pnpm --filter @musd-kit/example-keeper build
pnpm --filter @musd-kit/example-keeper start          # one pass, then exit
pnpm --filter @musd-kit/example-keeper start -- --watch   # polling loop
```

> Community tooling for testnet / evaluation. Liquidation is permissionless but
> economically competitive on mainnet; this is a reference implementation, not a
> production keeper.
