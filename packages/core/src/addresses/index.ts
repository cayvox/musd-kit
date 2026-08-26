import { type Address, getAddress, isAddress, zeroAddress } from 'viem'
import { DEPLOYMENTS, SOURCE_PACKAGE_VERSION } from '../_generated/addresses'
import { InvalidAddressOverride, UnsupportedChain } from '../errors'

export { DEPLOYMENTS, SOURCE_PACKAGE_VERSION }
// `UnsupportedChain` is part of the unified `errors/` taxonomy (a `MusdError`); re-export
// it from here so existing `from './addresses'` imports keep working.
export { UnsupportedChain, InvalidAddressOverride } from '../errors'

/** The dev-facing contract set the SDK wraps (`docs/01-ground-truth.md` §4/§5). */
export type MusdContractName = keyof (typeof DEPLOYMENTS)[31611]

/** Resolved address map for one network. */
export type MusdAddresses = Record<MusdContractName, Address>

/** Chains MUSD is deployed on: 31611 (Mezo Testnet), 31612 (Mezo Mainnet). */
export type SupportedChainId = keyof typeof DEPLOYMENTS

/** The chain IDs MUSD is deployed on (Mezo Testnet `31611`, Mezo Mainnet `31612`). */
export const SUPPORTED_CHAIN_IDS = [31611, 31612] as const satisfies readonly SupportedChainId[]

/**
 * Every contract the SDK resolves, in one place. This is the authority for BOTH the
 * completeness check and the unknown-key rejection, so the two cannot drift apart: a
 * contract added here is immediately required by one and accepted by the other.
 */
export const MUSD_CONTRACT_NAMES = [
  'borrowerOperations',
  'troveManager',
  'sortedTroves',
  'hintHelpers',
  'priceFeed',
  'interestRateManager',
  'musd',
] as const satisfies readonly MusdContractName[]

/** Type guard, is `chainId` one of MUSD's supported chains (31611/31612)? */
export function isSupportedChainId(chainId: number): chainId is SupportedChainId {
  return chainId === 31611 || chainId === 31612
}

const KNOWN = new Set<string>(MUSD_CONTRACT_NAMES)

/**
 * Validate, checksum, and return the overrides (MK-009).
 *
 * The whole of the previous validation was `typeof o[k] === 'string'`, and it ran only on
 * the unsupported-chain path. Neither `isAddress`, nor `getAddress`, nor `zeroAddress`
 * appeared anywhere in the source. So `{ priceFeed: 'not an address' }` was accepted on a
 * supported chain and failed later, as an opaque viem encoding error, at some unrelated
 * call site.
 *
 * Three things are rejected here, each for its own reason:
 *
 *   - **An unknown key.** A typo like `pricefeed` silently did nothing before: the map was
 *     spread over, the bundled `priceFeed` survived, and the caller believed they had
 *     redirected it. Nothing failed, which is the worst outcome of the three.
 *   - **A value that is not an address.** Fail where the mistake is, not at the first
 *     `readContract` that happens to use it.
 *   - **The zero address**, specifically. It is what a partially initialized config
 *     produces, and it is the one wrong address that does not announce itself: a call to
 *     an address with no code returns empty data rather than reverting with a reason.
 *
 * Values are returned checksummed by `getAddress`, so the resolved map is canonical
 * regardless of the case the caller typed.
 */
function validateOverride(override: Partial<MusdAddresses>): Partial<MusdAddresses> {
  const out: Partial<MusdAddresses> = {}
  for (const [key, value] of Object.entries(override)) {
    if (!KNOWN.has(key)) {
      throw new InvalidAddressOverride(
        key,
        value,
        `unknown contract, expected one of ${MUSD_CONTRACT_NAMES.join(', ')}`,
      )
    }
    // An explicit `undefined` is how an optional field is spelled when it is absent, so it
    // is treated as absent rather than as an error.
    if (value === undefined) continue
    if (typeof value !== 'string' || !isAddress(value, { strict: false })) {
      throw new InvalidAddressOverride(key, value, 'not a valid EVM address')
    }
    const checksummed = getAddress(value)
    if (checksummed === zeroAddress) {
      throw new InvalidAddressOverride(key, value, 'the zero address is never a contract')
    }
    out[key as MusdContractName] = checksummed
  }
  return out
}

/**
 * Resolve the MUSD address map for a chain. Values come from
 * `@mezo-org/musd-contracts` (decision O10) and are cross-checked against
 * `docs/01-ground-truth.md` §4 in tests.
 *
 * Overrides are validated and checksummed (MK-009). A **partial** override on a supported
 * chain replaces one contract inside an otherwise trusted map, which is the case worth
 * understanding: nothing here can tell whether the replacement belongs to the same
 * deployment. What catches that is `MusdClient.verifyDeployment`, which asserts the cross
 * wiring pointers between the contracts and runs before the first write on every path
 * (MK-008). Override `sortedTroves` with a foreign address and
 * `TroveManager.sortedTroves()` will not equal it, so verification fails before anything is
 * sent.
 *
 * @param override per-contract overrides; also the escape hatch for a chainId with
 *   no bundled deployment, supplying every contract avoids `UnsupportedChain`.
 * @throws {InvalidAddressOverride} for an unknown key, a non-address value, or zero.
 * @throws {UnsupportedChain} for an unsupported chainId when overrides do not cover it.
 */
export function getAddresses(chainId: number, override?: Partial<MusdAddresses>): MusdAddresses {
  const checked = override ? validateOverride(override) : undefined
  if (isSupportedChainId(chainId)) {
    return { ...DEPLOYMENTS[chainId], ...checked }
  }
  // No bundled deployment: only valid if the caller supplied a full override.
  if (checked && isCompleteAddressMap(checked)) {
    return checked
  }
  throw new UnsupportedChain(chainId)
}

/** Did the caller redirect any contract away from the bundled map? */
export function hasAddressOverride(override?: Partial<MusdAddresses>): boolean {
  return override !== undefined && MUSD_CONTRACT_NAMES.some((k) => override[k] !== undefined)
}

function isCompleteAddressMap(o: Partial<MusdAddresses>): o is MusdAddresses {
  // Values are already validated and checksummed by `validateOverride`, so presence is all
  // that is left to establish here.
  return MUSD_CONTRACT_NAMES.every((k) => o[k] !== undefined)
}
