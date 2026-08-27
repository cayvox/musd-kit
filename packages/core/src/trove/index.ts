import type { Abi, Address } from 'viem'
import {
  borrowerOperationsAbi,
  governableVariablesAbi,
  musdAbi,
  priceFeedAbi,
  troveManagerAbi,
} from '../clients'
import { CCR, MUSD_GAS_COMPENSATION } from '../constants'
import {
  BelowMinimumDebt,
  CollateralWithdrawalBlocked,
  ExceedsBorrowingCapacity,
  InsufficientCollateral,
  InsufficientMusdBalance,
  InvalidAdjustment,
  InvalidAmount,
  MaxFeeExceeded,
  type MusdError,
  RecoveryModeRestriction,
  RepayExceedsDebt,
  SystemRatioBelowCCR,
  TroveAlreadyExists,
  TroveNotFound,
  assertPositiveAmount,
} from '../errors'
import { type RevertContext, decodeRevertReason, mapRevert } from '../errors/mapRevert'
import { computeHints } from '../hints'
import { type WriteDeps, type WriteResult, requireWallet, simulateAndSend } from '../internal/write'
import type { MathDeps } from '../math/deps'
import {
  type AdjustPreview,
  type PreviewAdjustParams,
  previewAdjustTrove,
} from '../math/previewAdjust'
import { previewClose } from '../math/previewClose'

export type { GasDecision, WriteDeps, WriteResult } from '../internal/write'

/** `claim()` is a no-op when there is no surplus → `hash` may be `null`. */
export interface ClaimResult {
  claimed: boolean
  hash: Address | null
}

const ONE = 10n ** 18n
const BO_ABI: Abi = borrowerOperationsAbi

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

/**
 * SDK-side fee guard. `maxFeePercentage` is a 1e18-scaled fraction (1e16 = 1%).
 *
 * **This is a pre-flight sanity check, NOT a protection (MK-011).** The distinction is the
 * whole point of this comment, so it is worth stating without hedging: MUSD's write paths
 * take no fee cap parameter. `openTrove`, `withdrawMUSD`, `adjustTrove` and `refinance` are
 * `(amount, upperHint, lowerHint)` shaped, verified from the full signatures in
 * `docs/01-ground-truth.md` §5.1, and `redeemCollateral` has none either
 * (`TroveManager.sol:294-301`). There is nothing for the SDK to pass a cap to, so there is
 * nothing on chain enforcing one.
 *
 * What that means concretely, in the order it happens:
 *
 *   1. the SDK reads the fee, or the rate, from the chain;
 *   2. it compares that value against your cap HERE, and may throw;
 *   3. it sends the transaction.
 *
 * Between 1 and 3 the governable rate can change, and the transaction still goes through at
 * whatever rate is live when it mines. Nothing reverts. So a passing check means the fee was
 * within your cap when it was read, and nothing more. It is opt in and defaults to no cap,
 * which means the DEFAULT behavior is to accept any fee the protocol charges.
 *
 * If you need a real bound, the enforcement has to be yours: check the fee again after the
 * receipt, or do not send at all when the rate is moving.
 */
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
  /**
   * SDK-side fee cap, 1e18-scaled fraction (e.g. `10n ** 16n` = 1%). Throws
   * `MaxFeeExceeded`.
   *
   * **Advisory, never an on-chain guarantee (MK-011).** No MUSD write path takes a fee cap
   * parameter, so nothing on chain enforces this. The SDK reads the fee, compares it here,
   * then sends; the governable rate can move in between and the transaction still mines at
   * whatever is live. A pre-flight sanity check, not a protection.
   */
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

/**
 * MK-042. The shared ratio precheck for every write that funnels into `_adjustTrove`.
 *
 * Runs the SAME evaluator the caller can run themselves ({@link previewAdjustTrove}) and
 * turns its binding constraint into a typed error carrying the real numbers, BEFORE simulate.
 * One evaluator rather than one guard per path, because the contract has one gate set and
 * duplicating it per write is how the two disagree later.
 *
 * **This is what closes the gap MK-038 documented as a scope limit.** The individual ratio
 * requirement is absolute (`BorrowerOperations.sol:1201`, defined at `:1330-1335`), so an
 * operation that IMPROVES a position can still be refused, and the error says so with the
 * collateral figure that would actually clear it.
 */
async function assertAdjustViable(
  deps: WriteDeps,
  owner: Address,
  params: Omit<PreviewAdjustParams, 'owner'>,
): Promise<void> {
  const preview = await previewAdjustTrove(mathDepsOf(deps), { owner, ...params })
  if (preview.viable) return
  throw adjustReasonToError(preview, owner)
}

/** `WriteDeps` already carries everything the preview calculators need. */
function mathDepsOf(deps: WriteDeps): MathDeps {
  return {
    publicClient: deps.publicClient,
    addresses: deps.addresses,
    getMinNetDebt: deps.getMinNetDebt,
    isAccountFeeExempt: deps.isAccountFeeExempt,
  }
}

/**
 * The binding constraint, as the typed error a caller catches.
 *
 * `bindingConstraint` is used rather than the whole list because it is the one the chain
 * would report first, so the thrown error matches what a revert would have said.
 */
function adjustReasonToError(p: AdjustPreview, owner: Address): MusdError {
  switch (p.bindingConstraint) {
    case 'TROVE_NOT_ACTIVE':
      return new TroveNotFound(owner)
    case 'NO_CHANGE_REQUESTED':
      return new InvalidAdjustment(
        'No change requested: the contract requires a collateral change or a debt change (BorrowerOperations.sol:1377-1386).',
      )
    case 'COLLATERAL_ADD_AND_WITHDRAW':
      return new InvalidAdjustment(
        'Cannot add and withdraw collateral in one call (BorrowerOperations.sol:1367-1375).',
      )
    case 'ZERO_DEBT_INCREASE':
      return new InvalidAmount('increaseDebt', 0n)
    case 'WITHDRAWAL_EXCEEDS_COLLATERAL':
      return new InsufficientCollateral(p.resultingIcr, p.icrThreshold)
    case 'COLLATERAL_WITHDRAWAL_IN_RECOVERY_MODE':
      return new CollateralWithdrawalBlocked()
    case 'ICR_BELOW_THRESHOLD':
      return new InsufficientCollateral(p.resultingIcr, p.icrThreshold)
    case 'ICR_NOT_IMPROVED_IN_RECOVERY_MODE':
      return new RecoveryModeRestriction(undefined)
    case 'TCR_BELOW_CCR':
      return new SystemRatioBelowCCR(undefined, { resultingTcr: p.resultingTcr, ccr: CCR })
    case 'EXCEEDS_BORROWING_CAPACITY':
      return new ExceedsBorrowingCapacity(undefined, undefined, p.netDebtChange, undefined)
    case 'BELOW_MINIMUM_DEBT':
      return new BelowMinimumDebt()
    case 'REPAY_EXCEEDS_DEBT':
      return new RepayExceedsDebt(undefined, { repay: p.netDebtChange })
    case 'INSUFFICIENT_MUSD_BALANCE':
      return new InsufficientMusdBalance(p.netDebtChange, 0n)
    default:
      return new InvalidAdjustment('The adjustment is not viable.')
  }
}

export async function addCollateral(
  deps: WriteDeps,
  { amount }: { amount: bigint },
): Promise<WriteResult> {
  const wallet = requireWallet(deps)
  assertPositiveAmount('amount', amount)
  const pos = await currentPosition(deps, wallet.account.address)
  assertTroveActive(pos.entireDebt, wallet.account.address)
  // MK-042. The ratio gate applies to a pure top-up in NORMAL mode and is ABSOLUTE
  // (`BorrowerOperations.sol:1201`), so a position already under MCR is refused even though
  // this improves it. MK-038 is the entry that established it; this is the precheck.
  await assertAdjustViable(deps, wallet.account.address, { addCollateral: amount })
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
  /**
   * SDK-side fee cap, 1e18-scaled fraction. **Advisory, never an on-chain guarantee**: no
   * MUSD write path takes a fee cap parameter, so the SDK reads, compares, then sends, and
   * the governable rate can move in between (MK-011). See `docs/03-core-api.md` §4.
   */
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
  // MK-042. And the ratio gates, which capacity alone never covered. In Recovery Mode this
  // is what reports that a plain borrow can NEVER succeed: `withdrawMUSD` sends no
  // collateral, so `_requireNewICRisAboveOldICR` (`:1273`) cannot be satisfied.
  await assertAdjustViable(deps, wallet.account.address, { increaseDebt: amount })
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
  // MK-042. The ratio gate applies to a pure repayment in NORMAL mode too, and it is
  // ABSOLUTE (`BorrowerOperations.sol:1201`): a position already under MCR is refused even
  // though repaying improves it. MK-038 is the entry; this is the precheck.
  await assertAdjustViable(deps, owner, { repayDebt: amount })
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
  // MK-042. Withdrawal is refused OUTRIGHT in Recovery Mode (`:1270`), and gated on the
  // absolute resulting ICR and on the system TCR in normal mode (`:1201`, `:1209`).
  await assertAdjustViable(deps, wallet.account.address, { withdrawCollateral: amount })
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
  /**
   * SDK-side fee cap, 1e18-scaled fraction. **Advisory, never an on-chain guarantee**: no
   * MUSD write path takes a fee cap parameter, so the SDK reads, compares, then sends, and
   * the governable rate can move in between (MK-011). See `docs/03-core-api.md` §4.
   */
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
  // MK-042. Every ratio and mode gate on the combined path, in one place. This is the write
  // the earlier scope limit named as having no verdict at all.
  await assertAdjustViable(deps, owner, {
    ...(collAdd > 0n ? { addCollateral: collAdd } : {}),
    ...(collWithdrawal > 0n ? { withdrawCollateral: collWithdrawal } : {}),
    ...(brw !== undefined ? { increaseDebt: brw } : {}),
    ...(rpy !== undefined ? { repayDebt: rpy } : {}),
  })
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
  // MK-042. Close has its own gate set, and two of its four gates are conditional on a live
  // chain read, `musd.mintList(borrowerOperations)` (`BorrowerOperations.sol:949`). When
  // that is true, closing is refused in Recovery Mode (`:954`) and gated on the resulting
  // system TCR (`:972`). Neither was checked before this.
  const closePreview = await previewClose(mathDepsOf(deps), owner)
  if (!closePreview.viable) {
    if (closePreview.bindingConstraint === 'RECOVERY_MODE') {
      throw new RecoveryModeRestriction(undefined)
    }
    if (closePreview.bindingConstraint === 'TCR_BELOW_CCR') {
      throw new SystemRatioBelowCCR(undefined, {
        resultingTcr: closePreview.resultingTcr,
        ccr: CCR,
      })
    }
    if (closePreview.bindingConstraint === 'INSUFFICIENT_MUSD_BALANCE') {
      throw new InsufficientMusdBalance(closePreview.musdRequired, closePreview.musdBalance)
    }
  }
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
