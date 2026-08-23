import type { Address, PublicClient } from 'viem'
import type { MusdAddresses } from '../addresses'

/** What the preview calculators need. Supplied by `createMusdClient`. */
export interface MathDeps {
  publicClient: PublicClient
  addresses: MusdAddresses
  /** Live, session-cached `minNetDebt()`, from `createMusdClient.getConstants`. */
  getMinNetDebt: () => Promise<bigint>
  /**
   * `GovernableVariables.isAccountFeeExempt(account)` (MK-018). The borrowing fee is
   * skipped entirely for an exempt account, on open, on a debt increase and on refinance
   * (`BorrowerOperations.sol:637-643`, `:810-818`, `:1034-1036`), so a preview that assumes
   * nobody is exempt reports a fee the contract will not charge. The exempt cohort is NOT
   * empty on mainnet, so this is not a theoretical branch.
   */
  isAccountFeeExempt: (account: Address) => Promise<boolean>
}
