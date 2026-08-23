# scripts/

Maintenance + release scripts. Not shipped in any package.

## `testnet-e2e.ts`, live go-live verification (manual)

A real, signed Trove lifecycle against **Mezo testnet (31611)** through the shipped SDK:
`previewOpen` → `openTrove` → on-chain getter **parity to the wei** → `repay` → `close`.
This is the one gate the internal anvil-fork suite cannot prove, the real deployment, the
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

A clean run prints `GO, live lifecycle verified on Mezo testnet.` and exits 0. It is safe to
re-run (it closes any pre-existing Trove first) and refuses to run without a funded key rather
than do anything destructive. Full details are in the header of `testnet-e2e.ts`.

## `release-smoke.sh`, packaging smoke (CI)

Packs both tarballs, asserts they ship only `dist` + `README` + `LICENSE`, clean-installs into
a throwaway project (ESM `import` + CJS `require` + a `tsc` type check), and runs
`pnpm publish -r --dry-run`. Runs in CI on every push.

## `onchain-facts.ts`, on-chain facts at pinned blocks (manual)

Reads the governable values, the cross wiring, the proxy implementations, and the fee
exemption set from **both** Mezo chains at a **pinned block per chain**, and writes the
result between the markers in `docs/09-review-and-validated-surface.md` §6.

**Read only by construction.** It builds a viem *public* client only, so there is no signing
path to reach: it never sends a transaction, never needs a private key, and never accepts one.
Endpoints come from the environment, are never hardcoded, and are never printed or written to
a tracked file.

```sh
export MEZO_TESTNET_RPC_URL=<a Mezo testnet (31611) endpoint>
export MEZO_MAINNET_RPC_URL=<a Mezo mainnet (31612) endpoint>
pnpm facts            # rewrites the generated block in docs/09
pnpm facts --stdout   # prints it instead, changes nothing
```

Either endpoint may be omitted. A chain whose endpoint is missing or unreachable is reported
as missing in full, never as a partial table, because a partial table reads as complete.

**Not in CI**, on purpose: it needs live endpoints and runs a genesis-to-pin log scan of a few
thousand chunked `eth_getLogs` calls. Run it **before any release** and whenever you are about
to cite one of these values. Output is byte identical across runs at the same pinned block.
See `docs/07-testing.md` §7 and the header of `onchain-facts.ts`.
