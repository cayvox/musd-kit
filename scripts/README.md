# scripts/

Maintenance + release scripts. Not shipped in any package.

## `testnet-e2e.ts` — live go-live verification (manual)

A real, signed Trove lifecycle against **Mezo testnet (31611)** through the shipped SDK:
`previewOpen` → `openTrove` → on-chain getter **parity to the wei** → `repay` → `close`.
This is the one gate the internal anvil-fork suite cannot prove — the real deployment, the
real native-precompile oracle, real gas. It is **not** in CI (it spends real testnet BTC); it
is a manual step run once before publishing.

```sh
# 1. Fund a testnet account from the Mezo faucet (~0.05 BTC covers collateral + gas).
# 2. Export the key (and optionally an RPC URL / amounts):
export MEZO_TESTNET_PRIVATE_KEY=0x<64-hex>
export MEZO_TESTNET_RPC_URL=https://rpc.test.mezo.org   # default if unset
# export E2E_COLLATERAL_BTC=0.05   E2E_DEBT_MUSD=2500    # optional overrides
# 3. Run:
pnpm testnet:e2e
```

A clean run prints `GO — live lifecycle verified on Mezo testnet.` and exits 0. It is safe to
re-run (it closes any pre-existing Trove first) and refuses to run without a funded key rather
than do anything destructive. Full details are in the header of `testnet-e2e.ts`.

## `release-smoke.sh` — packaging smoke (CI)

Packs both tarballs, asserts they ship only `dist` + `README` + `LICENSE`, clean-installs into
a throwaway project (ESM `import` + CJS `require` + a `tsc` type check), and runs
`pnpm publish -r --dry-run`. Runs in CI on every push.
