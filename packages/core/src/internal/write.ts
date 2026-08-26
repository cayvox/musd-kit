import type { Abi, Account, Address, Hex, PublicClient, WalletClient } from 'viem'
import type { MusdAddresses } from '../addresses'
import { MissingWalletClient } from '../errors'
import { type RevertContext, mapRevert } from '../errors/mapRevert'

/**
 * Percent ADDED to the gas estimate on every write, over 100. `25` means the limit sent is
 * 1.25 times the estimate (MK-035).
 *
 * **Measured, not conventional.** Every write path the SDK exposes was run 12 times from a
 * byte identical `evm_snapshot`, so nothing but the block timestamp differed between
 * attempts. The gas the SAME call consumed varied by:
 *
 *   addCollateral 10.16%, withdrawCollateral 9.84%, borrow 7.97%, refinance 7.88%,
 *   adjustTrove 7.66%, repay 3.35%, liquidate 2.74%, openTrove and redeem 0% in that window
 *
 * against margins viem's own estimate happened to leave of 1.51% (openTrove) to 18.14%
 * (redeem), with five of the nine measured paths having a SMALLER margin than their own
 * spread. Separately, one `redeemCollateral` tail case grew from 610270 to 710023 gas, 16.4%,
 * and that is the one that reverted.
 *
 * 25 is roughly 1.5 times the worst growth observed (16.4%) and 2.5 times the worst typical
 * spread (10.16%). It is not a round number chosen because buffers are usually round; it is
 * the worst measurement with a factor on top, and if the measurements move it should move.
 *
 * **What it costs the caller**, established on the fork rather than assumed:
 *
 *   - **Nothing in fees.** Unused gas is refunded exactly: a send with a 5000000 limit that
 *     used 351910 charged `gasUsed * effectiveGasPrice` to the wei.
 *   - **A higher balance requirement.** The account must hold `gasLimit * gasPrice + value`
 *     up front or the send is rejected outright ("The total cost (gas * gas fee + value) ...
 *     exceeds the balance of the account"). A 25% larger limit means 25% more native balance
 *     must be sitting there, unspent.
 *   - **A higher number in the wallet's confirmation screen**, which is the maximum, not the
 *     charge.
 *   - **Latency: none added.** viem skips its own estimation when `gas` is set, so this is
 *     the same count of `eth_estimateGas` calls as before, and the estimate runs in parallel
 *     with the simulation rather than after it.
 *
 * **What it does NOT do.** It does not close the window. The estimate is still taken before
 * the block the transaction mines in, so a large enough jump still exhausts it. See
 * `diagnoseRevertedWrite` for what a caller can learn when that happens.
 */
export const DEFAULT_GAS_MARGIN_PERCENT = 25

/** Apply a percentage margin to a gas estimate. Rounds down; a zero margin is the estimate. */
export function withGasMargin(estimate: bigint, marginPercent: number): bigint {
  if (!Number.isFinite(marginPercent) || marginPercent <= 0) return estimate
  return (estimate * BigInt(Math.round(100 + marginPercent))) / 100n
}

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
   * Percent added to the gas estimate before sending, over 100 (MK-035). Supplied by
   * `createMusdClient`; see {@link DEFAULT_GAS_MARGIN_PERCENT} for the measurement behind
   * the default.
   */
  gasMarginPercent: number
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
  /** An explicit gas limit, bypassing the estimate and the margin entirely (MK-035). */
  gas?: bigint
  /**
   * Context handed to the revert decoder ({@link mapRevert}) so a simulation revert maps
   * to the precise typed error (operation disambiguates the Panic case; address/borrowers
   * fill in error context). Defaults `operation` to `functionName`.
   */
  revert?: RevertContext
}

/**
 * Verify the deployment, simulate, then send.
 *
 * **This used to say the simulation means "never a silent reverted receipt". That is not
 * true, and MK-035 is the counterexample.** Simulating catches a revert whose condition is
 * already true at simulate time. It cannot catch one that becomes true afterwards, and it
 * cannot catch the transaction running out of gas, because the gas limit is derived from an
 * estimate taken before the block the transaction mines in. Traced on a fork: the same
 * `redeemCollateral` call from byte identical state varied from 610270 to 710023 gas across
 * 40 attempts, against a limit that carried a 1.5% margin, and `ActivePool` ran out of gas at
 * call depth 4. The receipt showed `gasUsed < gasLimit`, so it did not even look like out of
 * gas.
 *
 * What simulating DOES give you is the typed error for every condition that holds at simulate
 * time, which is most of them and is worth having. It is not a guarantee that the send
 * succeeds, and callers should still check the receipt. Returns the tx hash without waiting (the caller waits for the receipt). Any
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
    // MK-035. `simulateContract` returns a request with NO `gas` field, verified rather than
    // assumed, so without an explicit limit `writeContract` estimates internally and sends
    // whatever came back. That estimate is taken before the block the transaction mines in,
    // and the work can grow in between.
    //
    // The two calls run in PARALLEL, and that is not a micro optimisation. Running the
    // estimate after the simulation adds a second state dependent round trip, so the state
    // can move between them and the estimate reverts where the simulation passed. That was
    // measured, not imagined: sequencing them cost three red runs in a ten run window, with
    // `docsPath: '/docs/contract/estimateContractGas'` on the error. In parallel they see
    // the same head, and the write costs no more latency than it did before.
    const [{ request }, estimate] = await Promise.all([
      deps.publicClient.simulateContract(sim),
      // A failed estimate must NOT fail the write. If the state really has moved,
      // `writeContract` estimates internally and surfaces it exactly as it did before this
      // change; falling back is never worse than the behavior being replaced.
      deps.publicClient
        .estimateContractGas(sim)
        .catch(() => undefined),
    ])

    // A caller supplied `gas` wins outright: an explicit limit is a decision, not a default.
    // biome-ignore lint/suspicious/noExplicitAny: same dynamic dispatch as above.
    const req: any = { ...(request as any) }
    if (opts?.gas !== undefined) {
      req.gas = opts.gas
    } else if (estimate !== undefined) {
      req.gas = withGasMargin(estimate, deps.gasMarginPercent)
    }

    const hash = await wallet.walletClient.writeContract(req)
    return { hash }
  } catch (error) {
    throw mapRevert(error, { operation: functionName, ...opts?.revert })
  }
}
