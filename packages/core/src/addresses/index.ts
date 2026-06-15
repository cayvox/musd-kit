import type { Address } from 'viem'
import { DEPLOYMENTS, SOURCE_PACKAGE_VERSION } from '../_generated/addresses'
import { UnsupportedChain } from '../errors'

export { DEPLOYMENTS, SOURCE_PACKAGE_VERSION }
// `UnsupportedChain` is part of the unified `errors/` taxonomy (a `MusdError`); re-export
// it from here so existing `from './addresses'` imports keep working.
export { UnsupportedChain } from '../errors'

/** The dev-facing contract set the SDK wraps (`docs/01-ground-truth.md` §4/§5). */
export type MusdContractName = keyof (typeof DEPLOYMENTS)[31611]

/** Resolved address map for one network. */
export type MusdAddresses = Record<MusdContractName, Address>

/** Chains MUSD is deployed on: 31611 (Mezo Testnet), 31612 (Mezo Mainnet). */
export type SupportedChainId = keyof typeof DEPLOYMENTS

export const SUPPORTED_CHAIN_IDS = [31611, 31612] as const satisfies readonly SupportedChainId[]

export function isSupportedChainId(chainId: number): chainId is SupportedChainId {
  return chainId === 31611 || chainId === 31612
}

/**
 * Resolve the MUSD address map for a chain. Values come from
 * `@mezo-org/musd-contracts` (decision O10) and are cross-checked against
 * `docs/01-ground-truth.md` §4 in tests.
 *
 * @param override per-contract overrides; also the escape hatch for a chainId with
 *   no bundled deployment — supplying every contract avoids `UnsupportedChain`.
 * @throws {UnsupportedChain} for an unsupported chainId when overrides do not cover it.
 */
export function getAddresses(chainId: number, override?: Partial<MusdAddresses>): MusdAddresses {
  if (isSupportedChainId(chainId)) {
    return { ...DEPLOYMENTS[chainId], ...override }
  }
  // No bundled deployment: only valid if the caller supplied a full override.
  if (override && isCompleteAddressMap(override)) {
    return override
  }
  throw new UnsupportedChain(chainId)
}

function isCompleteAddressMap(o: Partial<MusdAddresses>): o is MusdAddresses {
  const keys: MusdContractName[] = [
    'borrowerOperations',
    'troveManager',
    'sortedTroves',
    'hintHelpers',
    'priceFeed',
    'interestRateManager',
    'musd',
  ]
  return keys.every((k) => typeof o[k] === 'string')
}
