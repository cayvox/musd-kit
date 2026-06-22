# Forked-Mezo test harness

The correctness gate for `musd-kit`. Nothing is trusted until CI can read and
transact against a fork of the **real** MUSD contracts (no mocks for
protocol truth). This directory boots that fork and exposes typed viem clients.

## RPC URL (never hardcoded)

The harness reads the upstream Mezo RPC from the env var **`MEZO_TESTNET_RPC_URL`**
(Mezo Testnet, chainId **31611**). It is never hardcoded. The URL is obtained from
the public Mezo testnet RPC listings / chain registries (chainId 31611); the public
endpoint is `https://rpc.test.mezo.org`. Optionally pin a block with
**`MEZO_FORK_BLOCK`** for stronger determinism; if unset, the fork uses the latest
block and the harness **logs the block number used**.

```bash
export MEZO_TESTNET_RPC_URL="https://rpc.test.mezo.org"   # or your own provider
# optional:
export MEZO_FORK_BLOCK=13681500
pnpm test
```

## What's here

| File | Role |
|---|---|
| `anvil.ts` | `startFork()`, spawn anvil on a free port, wait until ready, install the oracle shim, return `publicClient` + `testClient` + helpers (`mineBlocks`, `warpTime`, `fundAccount`, `setPrice`, `stopFork`). |
| `oracle.ts` | Install + seed the BTC/USD oracle shim from real live data; `setPrice()` to drive it. |
| `constants.ts` | Mezo testnet chain, the smoke-gate addresses, and the oracle shim bytecode + slot layout. |
| `OracleShim.sol` | Source for the shim bytecode (see "the oracle finding"). |
| `globalSetup.ts` | Vitest globalSetup: boot ONE shared fork for the suite, expose its RPC via `MUSD_FORK_RPC_URL`, tear it down after. |
| `index.ts` | `connectFork()`, clients + helpers bound to the shared fork (used by tests). |

## The oracle finding (why there is a shim)

**Anvil can fork Mezo for everything pure-EVM**, `TroveManager.MCR()`, addresses,
Trove storage, the CR helpers, **but cannot serve `PriceFeed.fetchPrice()` out of
the box.** Traced on 14 Jun 2026:

```
PriceFeed.fetchPrice()
  └─ delegatecall impl 0xec42…629c1
       └─ staticcall 0x7b7c000000000000000000000000000000000015 :: latestRoundData()
            └─ … self-recurses → Revert
```

`0x7b7c…0015` is a **Mezo-native precompile** (the `0x7b7c…` system range). Its
deeper target `0x15 + (0x1edf << 0x92)` resolves to **the same address**, on the
real Mezo node, calls there are intercepted and served by a Cosmos oracle module;
the stored EVM bytecode is only a fallback that self-recurses. An anvil EVM fork
copies that bytecode but has **no native handler**, so the call recurses and
reverts.

### The fix (decided with the maintainer, option 1)

At fork boot the harness:

1. Reads the **real** `decimals()` + `latestRoundData()` from Mezo's live oracle.
2. `anvil_setCode`s a minimal Chainlink-style aggregator (`OracleShim.sol`) at
   `0x7b7c…0015`.
3. Seeds it via `anvil_setStorageAt` with that real round data (price = the live
   `answer`; timestamps refreshed to the fork's block time so the price is never
   "stale" to PriceFeed's freshness check).

After this, `fetchPrice()` works on the fork and returns the **real, seeded** price.
`setPrice(usdPerBtc1e18)` then drives it deterministically for near-MCR /
liquidation / Recovery-Mode tests in later phases.

**Boundary (important):** only the **external oracle precompile** is shimmed, and it
is shimmed with **real data**. **No MUSD contract is mocked**, `TroveManager`,
`BorrowerOperations`, `PriceFeed`, etc. run exactly as deployed. The protocol truth is never faked; we only supply the oracle input the L1 node
normally provides natively.

### Regenerating the shim bytecode

`ORACLE_SHIM_RUNTIME` in `constants.ts` is the compiled runtime of `OracleShim.sol`:

```bash
solc 0.8.35 --optimize --optimize-runs 200 --bin-runtime OracleShim.sol
```

The slot layout (`decimals=0, roundId=1, answer=2, startedAt=3, updatedAt=4,
answeredInRound=5`) is part of the contract's ABI contract with the harness, keep
them in sync.
