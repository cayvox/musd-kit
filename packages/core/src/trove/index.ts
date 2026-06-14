import type { Account, Address, Hex, PublicClient, WalletClient } from 'viem'
import type { MusdAddresses } from '../addresses'
import { borrowerOperationsAbi, musdAbi, troveManagerAbi } from '../clients'
import { MUSD_GAS_COMPENSATION } from '../constants'
import {
  ContractCallFailed,
  InsufficientMusdBalance,
  InvalidAdjustment,
  MaxFeeExceeded,
  MissingWalletClient,
  revertReason,
} from '../errors'
import { computeHints } from '../hints'

export interface WriteDeps {
  publicClient: PublicClient
  walletClient: WalletClient | undefined
  addresses: MusdAddresses
}

/** Result of a write — wagmi-idiomatic; the caller waits for the receipt. */
export interface WriteResult {
  hash: Hex
}

/** `claim()` is a no-op when there is no surplus → `hash` may be `null`. */
export interface ClaimResult {
  claimed: boolean
  hash: Hex | null
}

const ONE = 10n ** 18n

interface Wallet {
  walletClient: WalletClient
  account: Account
}

function requireWallet(deps: WriteDeps): Wallet {
  const wc = deps.walletClient
  if (!wc || !wc.account) throw new MissingWalletClient()
  return { walletClient: wc, account: wc.account }
}

/** Current (collateral, entireDebt) of `owner`, to-now, from the contract (Law 2). */
async function currentPosition(
  deps: WriteDeps,
  owner: Address,
): Promise<{ collateral: bigint; entireDebt: bigint }> {
  const edc = await deps.publicClient.readContract({
    address: deps.addresses.troveManager,
    abi: troveManagerAbi,
    functionName: 'getEntireDebtAndColl',
    args: [owner],
  })
  return { collateral: edc[0], entireDebt: edc[1] + edc[2] }
}

function getBorrowingFee(deps: WriteDeps, debt: bigint): Promise<bigint> {
  return deps.publicClient.readContract({
    address: deps.addresses.borrowerOperations,
    abi: borrowerOperationsAbi,
    functionName: 'getBorrowingFee',
    args: [debt],
  })
}

/** SDK-side fee guard (C5). `maxFeePercentage` is a 1e18-scaled fraction (1e16 = 1%). */
function assertFeeWithinCap(debtIncrease: bigint, fee: bigint, maxFeePercentage?: bigint): void {
  if (maxFeePercentage === undefined || debtIncrease === 0n) return
  const actualFeePercentage = (fee * ONE) / debtIncrease
  if (actualFeePercentage > maxFeePercentage) {
    throw new MaxFeeExceeded(maxFeePercentage, fee, actualFeePercentage)
  }
}

/** Recompute insertion hints for the RESULTING position (good-enough; affects only gas). */
function hintsFor(deps: WriteDeps, collateral: bigint, entireDebt: bigint) {
  return computeHints(
    { publicClient: deps.publicClient, addresses: deps.addresses },
    { collateral, entireDebt },
  )
}

/** Simulate first (surface reverts), then send. Returns the tx hash (no wait). */
async function simulateAndSend(
  deps: WriteDeps,
  wallet: Wallet,
  functionName: string,
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous write args; the ABI is typed at the call sites.
  args: readonly any[],
  value?: bigint,
): Promise<WriteResult> {
  try {
    // Dynamic dispatch over the BorrowerOperations write set; viem's per-function
    // typing can't be expressed generically here, so the params object is untyped.
    // biome-ignore lint/suspicious/noExplicitAny: see above.
    const sim: any = {
      account: wallet.account,
      address: deps.addresses.borrowerOperations,
      abi: borrowerOperationsAbi,
      functionName,
      args,
    }
    if (value !== undefined) sim.value = value
    const { request } = await deps.publicClient.simulateContract(sim)
    // biome-ignore lint/suspicious/noExplicitAny: request type follows the dynamic dispatch above.
    const hash = await wallet.walletClient.writeContract(request as any)
    return { hash }
  } catch (error) {
    throw new ContractCallFailed(`${functionName} reverted: ${revertReason(error)}`, error)
  }
}

export interface OpenTroveParams {
  collateral: bigint
  debt: bigint
  /** SDK-side fee cap, 1e18-scaled fraction (e.g. `10n ** 16n` = 1%). Throws `MaxFeeExceeded`. */
  maxFeePercentage?: bigint
}

export async function openTrove(deps: WriteDeps, params: OpenTroveParams): Promise<WriteResult> {
  const wallet = requireWallet(deps)
  const { collateral, debt } = params
  const fee = await getBorrowingFee(deps, debt)
  assertFeeWithinCap(debt, fee, params.maxFeePercentage)
  const entireDebt = debt + fee + MUSD_GAS_COMPENSATION
  const { upperHint, lowerHint } = await hintsFor(deps, collateral, entireDebt)
  return simulateAndSend(deps, wallet, 'openTrove', [debt, upperHint, lowerHint], collateral)
}

export async function addCollateral(
  deps: WriteDeps,
  { amount }: { amount: bigint },
): Promise<WriteResult> {
  const wallet = requireWallet(deps)
  const pos = await currentPosition(deps, wallet.account.address)
  const { upperHint, lowerHint } = await hintsFor(deps, pos.collateral + amount, pos.entireDebt)
  return simulateAndSend(deps, wallet, 'addColl', [upperHint, lowerHint], amount)
}

export interface BorrowParams {
  amount: bigint
  maxFeePercentage?: bigint
}

export async function borrow(deps: WriteDeps, params: BorrowParams): Promise<WriteResult> {
  const wallet = requireWallet(deps)
  const { amount } = params
  const fee = await getBorrowingFee(deps, amount)
  assertFeeWithinCap(amount, fee, params.maxFeePercentage)
  const pos = await currentPosition(deps, wallet.account.address)
  const { upperHint, lowerHint } = await hintsFor(
    deps,
    pos.collateral,
    pos.entireDebt + amount + fee,
  )
  return simulateAndSend(deps, wallet, 'withdrawMUSD', [amount, upperHint, lowerHint])
}

export async function repay(deps: WriteDeps, { amount }: { amount: bigint }): Promise<WriteResult> {
  const wallet = requireWallet(deps)
  const pos = await currentPosition(deps, wallet.account.address)
  const { upperHint, lowerHint } = await hintsFor(deps, pos.collateral, pos.entireDebt - amount)
  return simulateAndSend(deps, wallet, 'repayMUSD', [amount, upperHint, lowerHint])
}

export async function withdrawCollateral(
  deps: WriteDeps,
  { amount }: { amount: bigint },
): Promise<WriteResult> {
  const wallet = requireWallet(deps)
  const pos = await currentPosition(deps, wallet.account.address)
  const { upperHint, lowerHint } = await hintsFor(deps, pos.collateral - amount, pos.entireDebt)
  return simulateAndSend(deps, wallet, 'withdrawColl', [amount, upperHint, lowerHint])
}

export interface AdjustTroveParams {
  addCollateral?: bigint
  withdrawCollateral?: bigint
  borrow?: bigint
  repay?: bigint
  maxFeePercentage?: bigint
}

export async function adjustTrove(
  deps: WriteDeps,
  params: AdjustTroveParams,
): Promise<WriteResult> {
  const wallet = requireWallet(deps)
  const { addCollateral: add, withdrawCollateral: wd, borrow: brw, repay: rpy } = params
  if (add !== undefined && wd !== undefined) {
    throw new InvalidAdjustment('adjustTrove: cannot add and withdraw collateral in one call.')
  }
  if (brw !== undefined && rpy !== undefined) {
    throw new InvalidAdjustment('adjustTrove: cannot borrow and repay in one call.')
  }

  const collWithdrawal = wd ?? 0n
  const collAdd = add ?? 0n
  const isDebtIncrease = brw !== undefined
  const debtChange = brw ?? rpy ?? 0n

  let fee = 0n
  if (brw !== undefined) {
    fee = await getBorrowingFee(deps, brw)
    assertFeeWithinCap(brw, fee, params.maxFeePercentage)
  }

  const pos = await currentPosition(deps, wallet.account.address)
  const resultingColl = pos.collateral + collAdd - collWithdrawal
  const resultingDebt = pos.entireDebt + (brw !== undefined ? brw + fee : 0n) - (rpy ?? 0n)
  const { upperHint, lowerHint } = await hintsFor(deps, resultingColl, resultingDebt)

  return simulateAndSend(
    deps,
    wallet,
    'adjustTrove',
    [collWithdrawal, debtChange, isDebtIncrease, upperHint, lowerHint],
    collAdd > 0n ? collAdd : undefined,
  )
}

export async function close(deps: WriteDeps): Promise<WriteResult> {
  const wallet = requireWallet(deps)
  const owner = wallet.account.address
  const pos = await currentPosition(deps, owner)
  // Close burns the net debt (entireDebt − 200); the 200 gas reserve is returned (verified).
  const required = pos.entireDebt - MUSD_GAS_COMPENSATION
  const balance = await deps.publicClient.readContract({
    address: deps.addresses.musd,
    abi: musdAbi,
    functionName: 'balanceOf',
    args: [owner],
  })
  if (balance < required) throw new InsufficientMusdBalance(required, balance)
  return simulateAndSend(deps, wallet, 'closeTrove', [])
}

export async function refinance(deps: WriteDeps): Promise<WriteResult> {
  const wallet = requireWallet(deps)
  // Refinance adds a small fee and moves to the global rate; hints from the current
  // position are good enough (placement is contract-guaranteed — hints only affect gas).
  const pos = await currentPosition(deps, wallet.account.address)
  const { upperHint, lowerHint } = await hintsFor(deps, pos.collateral, pos.entireDebt)
  return simulateAndSend(deps, wallet, 'refinance', [upperHint, lowerHint])
}

/**
 * Claim collateral surplus (after a redemption/liquidation left some). With no surplus
 * `claimCollateral` reverts, so this simulates first and returns a clean no-op
 * (`{ claimed: false, hash: null }`) instead of throwing. Full claim-after-redemption
 * validation is Phase 6.
 */
export async function claim(deps: WriteDeps): Promise<ClaimResult> {
  const wallet = requireWallet(deps)
  try {
    const { request } = await deps.publicClient.simulateContract({
      account: wallet.account,
      address: deps.addresses.borrowerOperations,
      abi: borrowerOperationsAbi,
      functionName: 'claimCollateral',
    })
    const hash = await wallet.walletClient.writeContract(request)
    return { claimed: true, hash }
  } catch {
    return { claimed: false, hash: null }
  }
}
