// Mezo Testnet ("matsnet"), chainId 31611, BTC (18 decimals) gas — the canonical
// viem `Chain` from `@mezo-org/chains` (decision O10). The harness always points
// its clients at the local anvil fork via an explicit transport, so the chain's
// own rpcUrls are unused here.
export { mezoTestnet } from '@mezo-org/chains'

/**
 * Verified Mezo Testnet addresses used by the Phase-0 smoke gate.
 * Source: `docs/01-ground-truth.md` §4.2. Phase 1 moves the full maps into
 * `src/addresses/`.
 */
export const TESTNET = {
  troveManager: '0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0',
  priceFeed: '0x86bCF0841622a5dAC14A313a15f96A95421b9366',
} as const

/**
 * Mezo's BTC/USD oracle endpoint, exposed at a native precompile address behind a
 * thin Chainlink-style shim. `PriceFeed.fetchPrice()` staticcalls this address's
 * `latestRoundData()`.
 *
 * On the real Mezo node, calls here are intercepted and served by a Cosmos oracle
 * module; the stored EVM bytecode is only a fallback that self-recurses. An anvil
 * EVM fork copies that bytecode but has no native handler, so `fetchPrice()`
 * reverts. The harness replaces this address with {@link ORACLE_SHIM_RUNTIME} and
 * seeds it with the REAL live round data — shimming only the missing external
 * oracle, never any MUSD contract (Law 5). See `docs/01-ground-truth.md` §3 and
 * `test/harness/README.md`.
 */
export const ORACLE_PRECOMPILE = '0x7b7c000000000000000000000000000000000015' as const

/**
 * Runtime bytecode of `OracleShim.sol` (committed alongside this file), compiled
 * with `solc 0.8.35 --optimize --optimize-runs 200 --bin-runtime`. It exposes the
 * exact interface PriceFeed reads — `decimals()` and `latestRoundData()` — reading
 * each field from a fixed storage-slot layout so the harness can seed and drive it
 * deterministically via `setStorageAt`. To regenerate, see `test/harness/README.md`.
 */
export const ORACLE_SHIM_RUNTIME =
  '0x6080604052348015600e575f5ffd5b50600436106030575f3560e01c8063313ce567146034578063feaf968c14604d575b5f5ffd5b5f5460405160ff90911681526020015b60405180910390f35b6001546002546005546040805169ffffffffffffffffffff9485168152602081019390935242908301819052606083015291909116608082015260a001604456fea264697066735822122053221683ccd442d5ea99f045fc6176fd883edcf36d49b8ea6a9bcb118f128b3b64736f6c63430008230033' as const

/**
 * Fixed storage-slot layout the shim reads from (one field per slot). The harness
 * writes these with `anvil_setStorageAt`.
 */
export const ORACLE_SLOT = {
  decimals: 0n,
  roundId: 1n,
  answer: 2n,
  startedAt: 3n,
  updatedAt: 4n,
  answeredInRound: 5n,
} as const

/** Minimal ABI of the oracle shim / live aggregator (Chainlink-style). */
export const aggregatorAbi = [
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'latestRoundData',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
] as const
