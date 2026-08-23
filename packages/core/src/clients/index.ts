import {
  type Address,
  type GetContractReturnType,
  type PublicClient,
  type WalletClient,
  getContract,
} from 'viem'
import {
  borrowerOperationsAbi,
  hintHelpersAbi,
  interestRateManagerAbi,
  musdAbi,
  priceFeedAbi,
  sortedTrovesAbi,
  troveManagerAbi,
} from '../_generated/abis'
import type { MusdAddresses } from '../addresses'

export {
  borrowerOperationsAbi,
  hintHelpersAbi,
  interestRateManagerAbi,
  musdAbi,
  priceFeedAbi,
  sortedTrovesAbi,
  troveManagerAbi,
}

/**
 * The only `GovernableVariables` surface the SDK reads (MK-018): whether an account is
 * exempt from the borrowing fee. Hand-written rather than generated because the contract is
 * not part of the bundled deployment map; its address is read at runtime from
 * `borrowerOperations.governableVariables()` so it always matches the deployment in use.
 *
 * Signature confirmed against the deployed ABI in
 * `@mezo-org/musd-contracts/deployments/*\/GovernableVariables.json`:
 * `isAccountFeeExempt(address _account) view returns (bool)`.
 */
export const governableVariablesAbi = [
  {
    type: 'function',
    name: 'isAccountFeeExempt',
    stateMutability: 'view',
    inputs: [{ name: '_account', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
] as const

/**
 * The typed contract bundle. Reads (`.read.*`) are fully inferred from the official
 * `as const` ABIs. Write methods (`.write.*`) are layered in from Phase 5 once a
 * `walletClient` is threaded through; for now the bundle is typed read-side
 * (`PublicClient`) to keep the declaration output bounded, the full on-chain ABIs
 * are large.
 */
export interface MusdContracts {
  borrowerOperations: GetContractReturnType<typeof borrowerOperationsAbi, PublicClient, Address>
  troveManager: GetContractReturnType<typeof troveManagerAbi, PublicClient, Address>
  sortedTroves: GetContractReturnType<typeof sortedTrovesAbi, PublicClient, Address>
  hintHelpers: GetContractReturnType<typeof hintHelpersAbi, PublicClient, Address>
  priceFeed: GetContractReturnType<typeof priceFeedAbi, PublicClient, Address>
  interestRateManager: GetContractReturnType<typeof interestRateManagerAbi, PublicClient, Address>
  musd: GetContractReturnType<typeof musdAbi, PublicClient, Address>
}

/**
 * Build typed viem contract instances for the dev-facing MUSD set. Reads use the
 * `publicClient`; a `walletClient`, when provided, enables write methods at runtime
 * (typed from Phase 5). ABIs are the official `as const` artifacts (decision O10).
 */
export function createContracts(
  addresses: MusdAddresses,
  publicClient: PublicClient,
  walletClient?: WalletClient,
): MusdContracts {
  const client = walletClient
    ? { public: publicClient, wallet: walletClient }
    : { public: publicClient }

  return {
    borrowerOperations: getContract({
      address: addresses.borrowerOperations,
      abi: borrowerOperationsAbi,
      client,
    }),
    troveManager: getContract({ address: addresses.troveManager, abi: troveManagerAbi, client }),
    sortedTroves: getContract({ address: addresses.sortedTroves, abi: sortedTrovesAbi, client }),
    hintHelpers: getContract({ address: addresses.hintHelpers, abi: hintHelpersAbi, client }),
    priceFeed: getContract({ address: addresses.priceFeed, abi: priceFeedAbi, client }),
    interestRateManager: getContract({
      address: addresses.interestRateManager,
      abi: interestRateManagerAbi,
      client,
    }),
    musd: getContract({ address: addresses.musd, abi: musdAbi, client }),
  } as MusdContracts
}
