import type { Abi, Account, Address, Hex, PublicClient, WalletClient } from 'viem'
import type { MusdAddresses } from '../addresses'
import { MissingWalletClient } from '../errors'
import { type RevertContext, mapRevert } from '../errors/mapRevert'

/** Deps every write needs (a `walletClient` is required to send). */
export interface WriteDeps {
  publicClient: PublicClient
  walletClient: WalletClient | undefined
  addresses: MusdAddresses
  /**
   * Assert the contracts at these addresses really are a consistent MUSD deployment,
   * resolving on success and throwing otherwise (MK-008).
   *
   * REQUIRED rather than optional, and deliberately so. Optional would mean a write path
   * could be built that quietly skips verification, which is the shape of the defect being
   * fixed: `verifyDeployment` existed but ran only from `getConstants()`, so every write
   * that did not happen to read a constant went unverified. `createMusdClient` supplies a
   * memoized implementation, so this costs one multicall per client, not one per send.
   */
  ensureVerified: () => Promise<void>
  /**
   * The live, cached `minNetDebt()` floor, from the same accessor every other caller uses
   * (MK-008, MK-012). The open path used to read it directly, which is precisely how it
   * bypassed verification.
   */
  getMinNetDebt: () => Promise<bigint>
}

/** Result of a write, wagmi-idiomatic; the caller waits for the receipt. */
export interface WriteResult {
  hash: Hex
}

export interface Wallet {
  walletClient: WalletClient
  account: Account
}

export function requireWallet(deps: WriteDeps): Wallet {
  const wc = deps.walletClient
  if (!wc || !wc.account) throw new MissingWalletClient()
  return { walletClient: wc, account: wc.account }
}

export interface SimulateSendOptions {
  value?: bigint
  /**
   * Context handed to the revert decoder ({@link mapRevert}) so a simulation revert maps
   * to the precise typed error (operation disambiguates the Panic case; address/borrowers
   * fill in error context). Defaults `operation` to `functionName`.
   */
  revert?: RevertContext
}

/**
 * Verify the deployment, simulate (surfaces reverts, never a silent reverted receipt),
 * then send. Returns the tx hash without waiting (the caller waits for the receipt). Any
 * simulation revert is decoded by {@link mapRevert} into a typed `MusdError` (unmapped →
 * `ContractCallFailed`, original error preserved, never swallowed).
 *
 * Verification runs FIRST, before simulate, because a simulation against a lookalike
 * contract can succeed. Being on this path is what makes `verifyDeployment` a gate rather
 * than a function nobody calls (MK-008).
 */
export async function simulateAndSend(
  deps: WriteDeps,
  wallet: Wallet,
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[],
  opts?: SimulateSendOptions,
): Promise<WriteResult> {
  // Before the first value bearing send, not after it, and not only when a constant
  // happens to be read (MK-008). Memoized by the client, so this is one multicall for the
  // life of the client and a resolved promise on every send after that.
  await deps.ensureVerified()
  try {
    // Dynamic dispatch over a write set; viem's per-function typing can't be expressed
    // generically here, so the params object is untyped.
    // biome-ignore lint/suspicious/noExplicitAny: dynamic write dispatch (ABI typed at call sites).
    const sim: any = { account: wallet.account, address, abi, functionName, args }
    if (opts?.value !== undefined) sim.value = opts.value
    const { request } = await deps.publicClient.simulateContract(sim)
    // biome-ignore lint/suspicious/noExplicitAny: request type follows the dynamic dispatch above.
    const hash = await wallet.walletClient.writeContract(request as any)
    return { hash }
  } catch (error) {
    throw mapRevert(error, { operation: functionName, ...opts?.revert })
  }
}
