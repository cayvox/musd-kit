import type { Abi, Address } from 'viem'
import {
  borrowerOperationsAbi,
  governableVariablesAbi,
  musdAbi,
  priceFeedAbi,
  troveManagerAbi,
} from '../clients'
import { MUSD_GAS_COMPENSATION } from '../constants'
import {
  BelowMinimumDebt,
  ExceedsBorrowingCapacity,
  InsufficientMusdBalance,
  InvalidAdjustment,
  MaxFeeExceeded,
  RepayExceedsDebt,
  TroveAlreadyExists,
  TroveNotFound,
  assertPositiveAmount,
} from '../errors'
import { type RevertContext, decodeRevertReason, mapRevert } from '../errors/mapRevert'
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
/**
 * The live position, carrying principal and interest SEPARATELY (MK-006).
 *
 * `getEntireDebtAndColl` returns `(coll, principal, interest, ...)` and adds live-accrued
 * interest to the stored values, which is what the contract itself sees: every write path
 * calls `updateSystemAndTroveInterest(_borrower)` before reading
 * (`BorrowerOperations.sol:769`). The stored `getTroveDebt` and `getTroveInterestOwed` are
 * stale until something triggers that update, so they are deliberately not used here.
 */
async function currentPosition(
  deps: WriteDeps,
  owner: Address,
): Promise<{ collateral: bigint; entireDebt: bigint; principal: bigint; interestOwed: bigint }> {
  const edc = await deps.publicClient.readContract({
    address: deps.addresses.troveManager,
    abi: troveManagerAbi,
    functionName: 'getEntireDebtAndColl',
    args: [owner],
  })
  return {
    collateral: edc[0],
    entireDebt: edc[1] + edc[2],
    principal: edc[1],
    interestOwed: edc[2],
  }
}

/**
 * The borrowing fee the contract will ACTUALLY charge for a debt increase (MK-004, MK-018).
 *
 * `_adjustTrove` charges it only when `_isDebtIncrease && !isRecoveryMode`, and then only
 * when the account is not fee exempt (`BorrowerOperations.sol:810-818`). Reading both
 * rather than assuming keeps the capacity precheck comparing the same quantity the gate
 * compares, and the exempt cohort is not empty on mainnet.
 */
async function effectiveBorrowingFee(
  deps: WriteDeps,
  owner: Address,
  debt: bigint,
): Promise<bigint> {
  const price = await deps.publicClient.readContract({
    address: deps.addresses.priceFeed,
    abi: priceFeedAbi,
    functionName: 'fetchPrice',
  })
  const [isRecoveryMode, governableVariables] = await Promise.all([
    deps.publicClient.readContract({
      address: deps.addresses.troveManager,
      abi: troveManagerAbi,
      functionName: 'checkRecoveryMode',
      args: [price],
    }),
    deps.publicClient.readContract({
      address: deps.addresses.borrowerOperations,
      abi: borrowerOperationsAbi,
      functionName: 'governableVariables',
    }),
  ])
  if (isRecoveryMode) return 0n
  const exempt = await deps.publicClient.readContract({
    address: governableVariables,
    abi: governableVariablesAbi,
    functionName: 'isAccountFeeExempt',
    args: [owner],
  })
  if (exempt) return 0n
  return getBorrowingFee(deps, debt)
}

/**
 * Fail a debt increase the contract's capacity gate would reject, BEFORE simulate, with the
 * real numbers attached (MK-002).
 *
 * The gate is `maxBorrowingCapacity >= netDebtChange + debt`
 * (`BorrowerOperations.sol:1358-1365`). `debt` there is read after
 * `updateSystemAndTroveInterest` (`:769`), so accrued interest counts; the SDK compares
 * against the live entire debt for the same reason.
 */
async function assertWithinBorrowingCapacity(
  deps: WriteDeps,
  owner: Address,
  entireDebt: bigint,
  netDebtChange: bigint,
): Promise<void> {
  const capacity = await deps.publicClient.readContract({
    address: deps.addresses.troveManager,
    abi: troveManagerAbi,
    functionName: 'getTroveMaxBorrowingCapacity',
    args: [owner],
  })
  if (capacity >= entireDebt + netDebtChange) return
  throw new ExceedsBorrowingCapacity(
    capacity,
    entireDebt,
    netDebtChange,
    capacity > entireDebt ? capacity - entireDebt : 0n,
  )
}

function getBorrowingFee(deps: WriteDeps, debt: bigint): Promise<bigint> {
  return deps.publicClient.readContract({
    address: deps.addresses.borrowerOperations,
    abi: borrowerOperationsAbi,
    functionName: 'getBorrowingFee',
    args: [debt],
  })
}

/**
 * The debt floor, from the client's cached governable constants rather than a direct read
 * (MK-008, MK-012).
 *
 * This used to call `borrowerOperations.minNetDebt()` straight through, which is how the
 * open path bypassed `verifyDeployment` entirely: verification hung off `getConstants()`,
 * and this never called it. Routing it through the same accessor gives the pre-send floor
 * check the same verified, TTL bounded value every other caller gets, and removes one round
 * trip from every `openTrove`.
 */
function getMinNetDebt(deps: WriteDeps): Promise<bigint> {
  return deps.getMinNetDebt()
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

/**
 * Insertion hints for the RESULTING position, computed from PRINCIPAL (MK-006).
 *
 * `SortedTroves` is ordered by the nominal collateral ratio, and every quantity the protocol
 * sorts by excludes interest:
 *
 *   - `TroveManager.getNominalICR` is `_computeNominalCR(coll + pending, principal + pending)`
 *     (`TroveManager.sol:566-577`), with no interest term;
 *   - every on-chain re-insert passes `_computeNominalCR(coll, PRINCIPAL)`:
 *     `BorrowerOperations.sol:902-906` (adjust), `:1087-1088` (refinance) and
 *     `TroveManager.sol:1287-1290` (partial redemption).
 *
 * This used to be fed the ENTIRE debt, principal plus accrued interest, so the hint named a
 * position that does not exist in the list. `SortedTroves.reInsert` re-validates and
 * traverses from a bad hint, so the cost was gas and latency rather than a wrong number, and
 * in the worst case an out-of-gas insert.
 *
 * The parameter is named `principal` on purpose: the previous name, `entireDebt`, is exactly
 * the quantity that must NOT be passed.
 */
function hintsFor(deps: WriteDeps, collateral: bigint, principal: bigint) {
  return computeHints(
    { publicClient: deps.publicClient, addresses: deps.addresses },
    { collateral, entireDebt: principal },
  )
}

/**
 * How much of `payment` reduces PRINCIPAL, mirroring the contract's split exactly (MK-006).
 *
 * `InterestRateMath.calculateDebtAdjustment` (`InterestRateMath.sol:33-48`) branches on
 * `payment >= interestOwed`:
 *
 *   - `payment >= interestOwed` reduces principal by `payment - interestOwed`, which is ZERO
 *     at exact equality, since the boundary is inclusive on this side;
 *   - `payment < interestOwed` reduces principal by exactly zero and applies the whole
 *     payment to interest.
 *
 * `TroveManager._updateTroveDebt` then applies that split to storage
 * (`TroveManager.sol:854-869`). A repay at or below interest owed therefore does not move
 * the Trove's sort key at all, which is why modeling debt as falling by the full payment
 * produced a hint for a position that never exists.
 */
export function principalReductionForRepay(interestOwed: bigint, payment: bigint): bigint {
  return payment >= interestOwed ? payment - interestOwed : 0n
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
  // At open there is no accrued interest yet, so the composite debt IS the principal. This
  // call was accidentally correct, which is why the open-only validation gate could never
  // have caught MK-006 on any of the other paths.
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
  // Adding collateral does not touch principal.
  const { upperHint, lowerHint } = await hintsFor(deps, pos.collateral + amount, pos.principal)
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
  const fee = await effectiveBorrowingFee(deps, wallet.account.address, amount)
  assertFeeWithinCap(amount, fee, params.maxFeePercentage)
  const pos = await currentPosition(deps, wallet.account.address)
  assertTroveActive(pos.entireDebt, wallet.account.address)
  // MK-002: the capacity gate, checked before simulate rather than surfaced as a revert.
  await assertWithinBorrowingCapacity(deps, wallet.account.address, pos.entireDebt, amount + fee)
  // `increaseTroveDebt` adds the whole draw plus fee to PRINCIPAL
  // (`TroveManager.sol:529-530`), so the resulting sort key grows by exactly that.
  const { upperHint, lowerHint } = await hintsFor(
    deps,
    pos.collateral,
    pos.principal + amount + fee,
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
  // Interest first: a payment at or below interest owed moves principal by zero.
  const { upperHint, lowerHint } = await hintsFor(
    deps,
    pos.collateral,
    pos.principal - principalReductionForRepay(pos.interestOwed, amount),
  )
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
  // Withdrawing collateral does not touch principal.
  const { upperHint, lowerHint } = await hintsFor(deps, pos.collateral - amount, pos.principal)
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

  const owner = wallet.account.address
  let fee = 0n
  if (brw !== undefined) {
    fee = await effectiveBorrowingFee(deps, owner, brw)
    assertFeeWithinCap(brw, fee, params.maxFeePercentage)
  }

  const pos = await currentPosition(deps, owner)
  assertTroveActive(pos.entireDebt, owner)
  // MK-002: the capacity gate applies to the debt increase path of adjust too.
  if (brw !== undefined) {
    await assertWithinBorrowingCapacity(deps, owner, pos.entireDebt, brw + fee)
  }
  if (rpy !== undefined) {
    const netDebt = pos.entireDebt - MUSD_GAS_COMPENSATION
    if (rpy > netDebt) throw new RepayExceedsDebt(undefined, { repay: rpy, netDebt })
  }
  const resultingColl = pos.collateral + collAdd - collWithdrawal
  // The sort key moves by the PRINCIPAL change on both legs: a debt increase adds draw plus
  // fee to principal, and a repayment reduces principal only by whatever is left after
  // interest is paid off first (MK-006).
  const resultingPrincipal =
    pos.principal +
    (brw !== undefined ? brw + fee : 0n) -
    (rpy !== undefined ? principalReductionForRepay(pos.interestOwed, rpy) : 0n)
  const { upperHint, lowerHint } = await hintsFor(deps, resultingColl, resultingPrincipal)

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

/**
 * Move a Trove to the current global interest rate.
 *
 * **The contract charges a refinancing fee and capitalizes it into principal** (MK-003):
 * `getBorrowingFee((refinancingFeePercentage * netDebt) / 100)`, added via
 * `increaseTroveDebt` (`BorrowerOperations.sol:1033-1038`). The debt therefore grows, and
 * the fee begins accruing interest immediately. Call `previewRefinance(owner)` first to see
 * the fee and the resulting position before signing.
 *
 * **It always reverts in Recovery Mode** (MK-019): `_requireNotInRecoveryMode(price)` is the
 * first requirement `_refinance` applies (`BorrowerOperations.sol:1024`), before the trove
 * is even checked for being active. `previewRefinance` reports that as a
 * `RECOVERY_MODE` reason, and simulate-before-send surfaces it as a typed
 * `RecoveryModeRestriction` if you skip the preview.
 */
export async function refinance(deps: WriteDeps): Promise<WriteResult> {
  const wallet = requireWallet(deps)
  const owner = wallet.account.address
  const pos = await currentPosition(deps, owner)
  assertTroveActive(pos.entireDebt, owner)
  // MK-003: fold the fee into the hint, so it describes the position that WILL exist rather
  // than the one that does. The fee is capitalized into principal, which is the sort key.
  const fee = await refinancingFee(deps, owner, pos.entireDebt)
  const { upperHint, lowerHint } = await hintsFor(deps, pos.collateral, pos.principal + fee)
  return send(deps, 'refinance', [upperHint, lowerHint], {
    revert: { operation: 'refinance', address: owner },
  })
}

/**
 * The refinancing fee the contract will charge, computed the way it computes it (MK-003).
 *
 * `amount = (refinancingFeePercentage * _getNetDebt(getTroveDebt)) / 100`, then
 * `getBorrowingFee(amount)`, and zero for a fee exempt account
 * (`BorrowerOperations.sol:1030-1036`). The percentage is READ, never hardcoded: it is
 * governable, and a hardcoded value is a stale fact waiting to happen.
 */
async function refinancingFee(
  deps: WriteDeps,
  owner: Address,
  entireDebt: bigint,
): Promise<bigint> {
  const governableVariables = await deps.publicClient.readContract({
    address: deps.addresses.borrowerOperations,
    abi: borrowerOperationsAbi,
    functionName: 'governableVariables',
  })
  const exempt = await deps.publicClient.readContract({
    address: governableVariables,
    abi: governableVariablesAbi,
    functionName: 'isAccountFeeExempt',
    args: [owner],
  })
  if (exempt) return 0n
  const percentage = await deps.publicClient.readContract({
    address: deps.addresses.borrowerOperations,
    abi: borrowerOperationsAbi,
    functionName: 'refinancingFeePercentage',
  })
  const netDebt = entireDebt > MUSD_GAS_COMPENSATION ? entireDebt - MUSD_GAS_COMPENSATION : 0n
  return getBorrowingFee(deps, (BigInt(percentage) * netDebt) / 100n)
}

/**
 * The ONE revert `claim` is allowed to treat as a no-op (MK-007).
 *
 * Established by triggering it against the forked contracts rather than assumed:
 * `claimCollateral()` from an account with no surplus does NOT return zero, it reverts,
 * with the classic Liquity require string
 *
 *   CollSurplusPool: No collateral available to claim
 *
 * decoded by viem as `Error(string)` (`errorName: 'Error'`). Recorded in
 * `docs/01-ground-truth.md` §11 with the rest of the verified corpus.
 */
const NO_SURPLUS_TO_CLAIM = /No collateral available to claim/i

/**
 * Claim collateral surplus (after a redemption or liquidation left some). With no surplus
 * `claimCollateral` reverts, so this simulates first and returns a clean no-op for THAT
 * revert and only that one.
 *
 * MK-007. This used to wrap simulate and send in a bare `catch {}` that returned
 * `{ claimed: false }` for every failure. It was the single violation of the policy stated
 * at the top of `errors/mapRevert.ts`, that a revert is never swallowed and that anything
 * unrecognized surfaces as a typed error with the original cause attached. The intent was
 * defensible; the blast radius was not. A user holding real claimable surplus on a degraded
 * RPC was told, indistinguishably from the truth, that they had nothing, and a rejected
 * wallet signature reported the same thing.
 *
 * Now the no surplus revert is matched BY REASON through {@link decodeRevertReason}, so it
 * is the reason that decides, not the mere fact that something threw. Every other failure,
 * an RPC error, a user rejection, a different revert, goes through {@link mapRevert} and is
 * rethrown as a typed `MusdError` with the original error preserved in `cause`.
 */
export async function claim(deps: WriteDeps): Promise<ClaimResult> {
  const wallet = requireWallet(deps)
  // `claim` does its own simulate rather than going through `simulateAndSend`, because it
  // has to inspect the revert. That means it also has to gate on verification itself; it is
  // the one write path where forgetting this would be silent (MK-008).
  await deps.ensureVerified()
  try {
    const { request } = await deps.publicClient.simulateContract({
      account: wallet.account,
      address: deps.addresses.borrowerOperations,
      abi: borrowerOperationsAbi,
      functionName: 'claimCollateral',
    })
    const hash = await wallet.walletClient.writeContract(request)
    return { claimed: true, hash }
  } catch (error) {
    if (NO_SURPLUS_TO_CLAIM.test(decodeRevertReason(error) ?? '')) {
      return { claimed: false, hash: null }
    }
    throw mapRevert(error, { operation: 'claim', address: wallet.account.address })
  }
}
