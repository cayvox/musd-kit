import type { Abi, Address } from 'viem'
import { borrowerOperationsAbi, musdAbi, troveManagerAbi } from '../clients'
import { MUSD_GAS_COMPENSATION } from '../constants'
import {
  BelowMinimumDebt,
  InsufficientMusdBalance,
  InvalidAdjustment,
  MaxFeeExceeded,
  RepayExceedsDebt,
  TroveAlreadyExists,
  TroveNotFound,
  assertPositiveAmount,
} from '../errors'
import type { RevertContext } from '../errors/mapRevert'
import { computeHints } from '../hints'
import { type WriteDeps, type WriteResult, requireWallet, simulateAndSend } from '../internal/write'

export type { WriteDeps, WriteResult } from '../internal/write'

/** `claim()` is a no-op when there is no surplus → `hash` may be `null`. */
export interface ClaimResult {
  claimed: boolean
  hash: Address | null
}

const ONE = 10n ** 18n
const BO_ABI = borrowerOperationsAbi as unknown as Abi

/** Current (collateral, entireDebt) of `owner`, to-now, from the contract. */
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

function getMinNetDebt(deps: WriteDeps): Promise<bigint> {
  return deps.publicClient.readContract({
    address: deps.addresses.borrowerOperations,
    abi: borrowerOperationsAbi,
    functionName: 'minNetDebt',
  })
}

function getMusdBalance(deps: WriteDeps, owner: Address): Promise<bigint> {
  return deps.publicClient.readContract({
    address: deps.addresses.musd,
    abi: musdAbi,
    functionName: 'balanceOf',
    args: [owner],
  })
}

/** Throw {@link TroveNotFound} if `owner` has no active Trove (entireDebt is 0). */
function assertTroveActive(entireDebt: bigint, owner: Address): void {
  if (entireDebt === 0n) throw new TroveNotFound(owner)
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

const send = (
  deps: WriteDeps,
  fn: string,
  args: readonly unknown[],
  opts?: { value?: bigint; revert?: RevertContext },
) => {
  const wallet = requireWallet(deps)
  return simulateAndSend(deps, wallet, deps.addresses.borrowerOperations, BO_ABI, fn, args, {
    ...(opts?.value !== undefined ? { value: opts.value } : {}),
    ...(opts?.revert ? { revert: opts.revert } : {}),
  })
}

/** Parameters for {@link MusdClient.openTrove}: the BTC collateral + MUSD draw (+ optional fee cap). */
export interface OpenTroveParams {
  collateral: bigint
  debt: bigint
  /** SDK-side fee cap, 1e18-scaled fraction (e.g. `10n ** 16n` = 1%). Throws `MaxFeeExceeded`. */
  maxFeePercentage?: bigint
}

export async function openTrove(deps: WriteDeps, params: OpenTroveParams): Promise<WriteResult> {
  const wallet = requireWallet(deps)
  const { collateral, debt } = params
  assertPositiveAmount('collateral', collateral)
  assertPositiveAmount('debt', debt)
  const fee = await getBorrowingFee(deps, debt)
  assertFeeWithinCap(debt, fee, params.maxFeePercentage)
  // Pre-send guards (fail fast, fully-typed): min-net-debt floor + no existing Trove.
  const [minNetDebt, pos] = await Promise.all([
    getMinNetDebt(deps),
    currentPosition(deps, wallet.account.address),
  ])
  const netDebt = debt + fee
  if (netDebt < minNetDebt) throw new BelowMinimumDebt(minNetDebt, netDebt)
  if (pos.entireDebt > 0n) throw new TroveAlreadyExists(wallet.account.address)
  const entireDebt = debt + fee + MUSD_GAS_COMPENSATION
  const { upperHint, lowerHint } = await hintsFor(deps, collateral, entireDebt)
  return send(deps, 'openTrove', [debt, upperHint, lowerHint], {
    value: collateral,
    revert: { operation: 'openTrove', address: wallet.account.address },
  })
}

export async function addCollateral(
  deps: WriteDeps,
  { amount }: { amount: bigint },
): Promise<WriteResult> {
  const wallet = requireWallet(deps)
  assertPositiveAmount('amount', amount)
  const pos = await currentPosition(deps, wallet.account.address)
  assertTroveActive(pos.entireDebt, wallet.account.address)
  const { upperHint, lowerHint } = await hintsFor(deps, pos.collateral + amount, pos.entireDebt)
  return send(deps, 'addColl', [upperHint, lowerHint], {
    value: amount,
    revert: { operation: 'addCollateral', address: wallet.account.address },
  })
}

/** Parameters for {@link MusdClient.borrow}: the MUSD to draw (+ optional fee cap). */
export interface BorrowParams {
  amount: bigint
  maxFeePercentage?: bigint
}

export async function borrow(deps: WriteDeps, params: BorrowParams): Promise<WriteResult> {
  const wallet = requireWallet(deps)
  const { amount } = params
  assertPositiveAmount('amount', amount)
  const fee = await getBorrowingFee(deps, amount)
  assertFeeWithinCap(amount, fee, params.maxFeePercentage)
  const pos = await currentPosition(deps, wallet.account.address)
  assertTroveActive(pos.entireDebt, wallet.account.address)
  const { upperHint, lowerHint } = await hintsFor(
    deps,
    pos.collateral,
    pos.entireDebt + amount + fee,
  )
  return send(deps, 'withdrawMUSD', [amount, upperHint, lowerHint], {
    revert: { operation: 'borrow', address: wallet.account.address },
  })
}

export async function repay(deps: WriteDeps, { amount }: { amount: bigint }): Promise<WriteResult> {
  const wallet = requireWallet(deps)
  const owner = wallet.account.address
  assertPositiveAmount('amount', amount)
  const [pos, balance] = await Promise.all([
    currentPosition(deps, owner),
    getMusdBalance(deps, owner),
  ])
  assertTroveActive(pos.entireDebt, owner)
  // Repaying more than the net debt would underflow on-chain (Panic) → typed up front.
  const netDebt = pos.entireDebt - MUSD_GAS_COMPENSATION
  if (amount > netDebt) throw new RepayExceedsDebt(undefined, { repay: amount, netDebt })
  if (balance < amount) throw new InsufficientMusdBalance(amount, balance)
  const { upperHint, lowerHint } = await hintsFor(deps, pos.collateral, pos.entireDebt - amount)
  return send(deps, 'repayMUSD', [amount, upperHint, lowerHint], {
    revert: { operation: 'repay', address: owner },
  })
}

export async function withdrawCollateral(
  deps: WriteDeps,
  { amount }: { amount: bigint },
): Promise<WriteResult> {
  const wallet = requireWallet(deps)
  assertPositiveAmount('amount', amount)
  const pos = await currentPosition(deps, wallet.account.address)
  assertTroveActive(pos.entireDebt, wallet.account.address)
  const { upperHint, lowerHint } = await hintsFor(deps, pos.collateral - amount, pos.entireDebt)
  return send(deps, 'withdrawColl', [amount, upperHint, lowerHint], {
    revert: { operation: 'withdrawCollateral', address: wallet.account.address },
  })
}

/** Parameters for {@link MusdClient.adjustTrove}: a combined collateral ± and/or debt ± change (validated). */
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

  const owner = wallet.account.address
  const pos = await currentPosition(deps, owner)
  assertTroveActive(pos.entireDebt, owner)
  if (rpy !== undefined) {
    const netDebt = pos.entireDebt - MUSD_GAS_COMPENSATION
    if (rpy > netDebt) throw new RepayExceedsDebt(undefined, { repay: rpy, netDebt })
  }
  const resultingColl = pos.collateral + collAdd - collWithdrawal
  const resultingDebt = pos.entireDebt + (brw !== undefined ? brw + fee : 0n) - (rpy ?? 0n)
  const { upperHint, lowerHint } = await hintsFor(deps, resultingColl, resultingDebt)

  return send(
    deps,
    'adjustTrove',
    [collWithdrawal, debtChange, isDebtIncrease, upperHint, lowerHint],
    {
      ...(collAdd > 0n ? { value: collAdd } : {}),
      revert: { operation: 'adjustTrove', address: owner },
    },
  )
}

export async function close(deps: WriteDeps): Promise<WriteResult> {
  const wallet = requireWallet(deps)
  const owner = wallet.account.address
  const pos = await currentPosition(deps, owner)
  assertTroveActive(pos.entireDebt, owner)
  // Close burns the net debt (entireDebt − 200); the 200 gas reserve is returned (verified).
  const required = pos.entireDebt - MUSD_GAS_COMPENSATION
  const balance = await getMusdBalance(deps, owner)
  if (balance < required) throw new InsufficientMusdBalance(required, balance)
  return send(deps, 'closeTrove', [], { revert: { operation: 'close', address: owner } })
}

export async function refinance(deps: WriteDeps): Promise<WriteResult> {
  const wallet = requireWallet(deps)
  const owner = wallet.account.address
  // Refinance adds a small fee and moves to the global rate; hints from the current
  // position are good enough (placement is contract-guaranteed, hints only affect gas).
  const pos = await currentPosition(deps, owner)
  assertTroveActive(pos.entireDebt, owner)
  const { upperHint, lowerHint } = await hintsFor(deps, pos.collateral, pos.entireDebt)
  return send(deps, 'refinance', [upperHint, lowerHint], {
    revert: { operation: 'refinance', address: owner },
  })
}

/**
 * Claim collateral surplus (after a redemption/liquidation left some). With no surplus
 * `claimCollateral` reverts, so this simulates first and returns a clean no-op instead
 * of throwing.
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
