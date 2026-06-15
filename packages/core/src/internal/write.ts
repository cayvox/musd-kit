import type { Abi, Account, Address, Hex, PublicClient, WalletClient } from 'viem'
import type { MusdAddresses } from '../addresses'
import { ContractCallFailed, MissingWalletClient, revertReason } from '../errors'

/** Deps every write needs (a `walletClient` is required to send). */
export interface WriteDeps {
  publicClient: PublicClient
  walletClient: WalletClient | undefined
  addresses: MusdAddresses
}

/** Result of a write — wagmi-idiomatic; the caller waits for the receipt. */
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
   * Map a simulation revert to a specific typed error. If it throws, that error
   * propagates; if it returns, the default `ContractCallFailed` is thrown.
   */
  onRevert?: (error: unknown, reason: string) => void
}

/**
 * Simulate first (surfaces reverts — never a silent reverted receipt), then send.
 * Returns the tx hash without waiting (the caller waits for the receipt).
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
    const reason = revertReason(error)
    opts?.onRevert?.(error, reason)
    throw new ContractCallFailed(`${functionName} reverted: ${reason}`, error)
  }
}
