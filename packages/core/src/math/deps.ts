import type { Address, PublicClient } from 'viem'
import type { MusdAddresses } from '../addresses'

/**
 * What the preview calculators need. Supplied by `createMusdClient`.
 *
 * **The block boundary every function taking this shares, stated once (MK-013, MK-093).**
 * MUSD exposes no price independent variant of any price dependent getter: `getTCR(uint256)`,
 * `checkRecoveryMode(uint256)` and `getCurrentICR(address,uint256)` all take the price as an
 * argument, so the price cannot be produced and consumed inside one `multicall`. `read/` solves
 * that by PINNING: `readPriceSnapshot` returns the price with `Multicall3.getBlockNumber()` from
 * one `eth_call` and the dependent reads run at that block.
 *
 * **Nothing under `math/` does that, deliberately.** Every preview here reads the price and then
 * runs the dependent reads at whatever block comes next, so a resulting TCR can mix system totals
 * from one block with a price from another. The window is one block and closing it would add a
 * round trip to eight functions; MK-013 weighed that and declined. It is recorded on each of those
 * functions rather than in a register entry alone, because MK-093 was exactly the failure of
 * leaving it in the entry: the exemption was phrased as "none of them claims a single block
 * snapshot in its docstring", one of them then claimed it, and nothing noticed.
 */
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
