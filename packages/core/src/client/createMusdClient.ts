import type { Address, PublicClient, WalletClient } from 'viem'
import { type MusdAddresses, getAddresses } from '../addresses'
import { type MusdContracts, createContracts, governableVariablesAbi } from '../clients'
import {
  CCR as BUNDLED_CCR,
  MCR as BUNDLED_MCR,
  FIXED_CONSTANTS,
  type FixedConstants,
} from '../constants'
import { MismatchedDeployment } from '../errors'
import {
  type ComputeHintsParams,
  type ComputeNICRParams,
  type Hints,
  computeHints,
  computeNICR,
} from '../hints'
import {
  type BorrowPreview,
  type BorrowingCapacity,
  type ComputeEntireDebtParams,
  type ComputeICRParams,
  type ComputeLiquidationPriceParams,
  type GetBorrowingPowerParams,
  type MathDeps,
  type OpenPreview,
  type PreviewBorrowParams,
  type PreviewOpenParams,
  type RefinancePreview,
  computeEntireDebt,
  computeICR,
  computeLiquidationPrice,
  getBorrowingCapacity,
  getBorrowingPower,
  getHealthFactor,
  previewBorrow,
  previewOpen,
  previewRefinance,
} from '../math'
import {
  type ReadDeps,
  type SystemState,
  type Trove,
  balanceOf,
  getClaimableCollateral,
  getOraclePrice,
  getSystemState,
  getTrove,
  isLiquidatable,
} from '../read'
import {
  type RedeemParams,
  type RedeemResult,
  batchLiquidate,
  liquidate,
  redeem,
} from '../redemption'
import {
  type AdjustTroveParams,
  type BorrowParams,
  type ClaimResult,
  type OpenTroveParams,
  type WriteDeps,
  type WriteResult,
  addCollateral,
  adjustTrove,
  borrow,
  claim,
  close,
  openTrove,
  refinance,
  repay,
  withdrawCollateral,
} from '../trove'

// `MismatchedDeployment` now lives in the unified `errors/` taxonomy (a `MusdError`);
// re-exported here so existing `from './client/createMusdClient'` imports keep working.
export { MismatchedDeployment } from '../errors'

/** Governable values read live (never bundled). */
export interface GovernableConstants {
  /** `borrowerOperations.minNetDebt()`, floor on `draw + fee`, 1e18-scaled. */
  minNetDebt: bigint
  /** `interestRateManager.interestRate()`, current global rate, in basis points. */
  interestRate: number
}

/** The bundled fixed constants plus the live-read governable ones. */
export type MusdConstants = FixedConstants & GovernableConstants

/** Inputs to {@link createMusdClient}: the chain, a viem public client, and (for writes) a wallet client; `addresses` overrides the bundled deployment. */
export interface CreateMusdClientParams {
  chainId: number
  publicClient: PublicClient
  /** Optional in Phase 1 (writes arrive in Phase 5); reads use `publicClient`. */
  walletClient?: WalletClient
  /** Per-contract address overrides (also enables an unsupported chainId). */
  addresses?: Partial<MusdAddresses>
}

/** The `createMusdClient` surface: live reads, preview math, hints, lifecycle writes, and the redemption/keeper functions, all bound to one chain + clients. */
export interface MusdClient {
  readonly chainId: number
  readonly addresses: MusdAddresses
  readonly contracts: MusdContracts
  /** The bundled fixed constants (synchronous, no network). */
  readonly fixed: FixedConstants
  /**
   * Read + cache the governable constants on first use, returned together
   * with the fixed ones. Also runs {@link verifyDeployment} once.
   */
  getConstants(): Promise<MusdConstants>
  /** Passthrough to `borrowerOperations.getBorrowingFee(debt)` (parameterized, not cached). */
  getBorrowingFee(debt: bigint): Promise<bigint>
  /**
   * Defense-in-depth: read `MCR`/`CCR` from the chain and assert they equal the
   * bundled fixed constants. Cached after the first success.
   * @throws {MismatchedDeployment}
   */
  verifyDeployment(): Promise<void>

  // --- live reads (contract-authoritative; see `read/`) ---
  /** A fully-typed live position, correct by construction. */
  getTrove(address: Address): Promise<Trove>
  /** Protocol-wide live state ({ tcr, isRecoveryMode, price }). */
  getSystemState(): Promise<SystemState>
  /** Normal-mode liquidatability (`getCurrentICR < MCR`). */
  isLiquidatable(address: Address): Promise<boolean>
  /** BTC/USD from `PriceFeed.fetchPrice()`. */
  getOraclePrice(): Promise<bigint>
  /** MUSD ERC-20 balance. */
  balanceOf(address: Address): Promise<bigint>

  // --- insertion hints (see `hints/`) ---
  /** Nominal collateral ratio `(collateral × 1e20) / entireDebt` (pure, no network). */
  computeNICR(params: ComputeNICRParams): bigint
  /** The insertion-hint ritual → `{ upperHint, lowerHint, nicr }` for a position of the given shape. */
  computeHints(params: ComputeHintsParams): Promise<Hints>

  // --- preview math (see `math/`; preview side, non-throwing) ---
  /** `(collateral × price) / entireDebt` (== contract `computeCR`). Pure. */
  computeICR(params: ComputeICRParams): bigint
  /** Price at which a position hits MCR = `(MCR × entireDebt) / collateral`. Pure. */
  computeLiquidationPrice(params: ComputeLiquidationPriceParams): bigint
  /** `icr / MCR` as a number (1.0 at MCR). Pure. */
  getHealthFactor(params: { icr: bigint }): number
  /** Project entire debt with simple time-based interest. Pure. */
  computeEntireDebt(params: ComputeEntireDebtParams): bigint
  /** Preview opening a Trove: an explicit verdict plus fee, debt, ICR, and liquidation price. */
  previewOpen(params: PreviewOpenParams): Promise<OpenPreview>
  /**
   * Preview borrowing against an EXISTING Trove (MK-002): verdict, binding constraint, the
   * capacity picture, and the resulting ratios. Use this rather than `getBorrowingPower`,
   * which is an open time calculator.
   */
  previewBorrow(params: PreviewBorrowParams): Promise<BorrowPreview>
  /**
   * Preview refinancing (MK-003, MK-019): the fee, the resulting principal and ICR, and a
   * verdict that is false when the contract would refuse, Recovery Mode included.
   */
  previewRefinance(owner: Address): Promise<RefinancePreview>
  /** Live `maxBorrowingCapacity`, live entire debt, and the remaining headroom (MK-002). */
  getBorrowingCapacity(owner: Address): Promise<BorrowingCapacity>
  /** Largest valid draw (ICR ≥ binding ratio, netDebt ≥ minNetDebt). */
  getBorrowingPower(params: GetBorrowingPowerParams): Promise<bigint>

  // --- lifecycle writes (see `trove/`; require a walletClient; simulate-before-send) ---
  /** `openTrove(debt, hints)` payable, opens a Trove with hints absorbed. */
  openTrove(params: OpenTroveParams): Promise<WriteResult>
  /** `addColl(hints)` payable, top up collateral. */
  addCollateral(params: { amount: bigint }): Promise<WriteResult>
  /** `withdrawMUSD(amount, hints)`, borrow more (mint). */
  borrow(params: BorrowParams): Promise<WriteResult>
  /** `repayMUSD(amount, hints)`, reduce debt (no approval needed). */
  repay(params: { amount: bigint }): Promise<WriteResult>
  /** `withdrawColl(amount, hints)`, take collateral out. */
  withdrawCollateral(params: { amount: bigint }): Promise<WriteResult>
  /** `adjustTrove(...)`, combined collateral ± and/or debt ± (validated). */
  adjustTrove(params: AdjustTroveParams): Promise<WriteResult>
  /** `closeTrove()`, full payoff (needs `entireDebt − 200` MUSD; returns 200 + collateral). */
  close(): Promise<WriteResult>
  /** `refinance(hints)`, move to the current global rate (adds a refinancing fee). */
  refinance(): Promise<WriteResult>
  /** `claimCollateral()`, claim surplus; a safe no-op when there is none. */
  claim(): Promise<ClaimResult>

  // --- redemption + permissionless keeper surface (see `redemption/`) ---
  /** Redeem MUSD for BTC (hints + governable fee + truncation surfaced). */
  redeem(params: RedeemParams): Promise<RedeemResult>
  /** Liquidate one Trove; throws `NothingToLiquidate` if it isn't liquidatable. */
  liquidate(borrower: Address): Promise<WriteResult>
  /** Liquidate several Troves in one call. */
  batchLiquidate(borrowers: readonly Address[]): Promise<WriteResult>
  /** BTC surplus claimable by `address` (CollSurplusPool), pair with `claim()`. */
  getClaimableCollateral(address: Address): Promise<bigint>
}

/**
 * The entry point: resolve addresses, build typed clients, and lazily read+cache
 * the governable constants. `walletClient` is optional until writes (Phase 5).
 *
 * @throws {UnsupportedChain} for a chainId with no bundled deployment and no full override.
 */
export function createMusdClient(params: CreateMusdClientParams): MusdClient {
  const { chainId, publicClient, walletClient, addresses: override } = params
  const addresses = getAddresses(chainId, override)
  const contracts = createContracts(addresses, publicClient, walletClient)

  let cachedConstants: MusdConstants | undefined
  let verified = false

  async function verifyDeployment(): Promise<void> {
    if (verified) return
    const [onchainMcr, onchainCcr] = await Promise.all([
      contracts.troveManager.read.MCR(),
      contracts.troveManager.read.CCR(),
    ])
    if (onchainMcr !== BUNDLED_MCR) throw new MismatchedDeployment('MCR', BUNDLED_MCR, onchainMcr)
    if (onchainCcr !== BUNDLED_CCR) throw new MismatchedDeployment('CCR', BUNDLED_CCR, onchainCcr)
    verified = true
  }

  async function getConstants(): Promise<MusdConstants> {
    if (cachedConstants) return cachedConstants
    await verifyDeployment()
    const [minNetDebt, interestRate] = await Promise.all([
      contracts.borrowerOperations.read.minNetDebt(),
      contracts.interestRateManager.read.interestRate(),
    ])
    cachedConstants = { ...FIXED_CONSTANTS, minNetDebt, interestRate: Number(interestRate) }
    return cachedConstants
  }

  function getBorrowingFee(debt: bigint): Promise<bigint> {
    return contracts.borrowerOperations.read.getBorrowingFee([debt])
  }

  /**
   * `GovernableVariables.isAccountFeeExempt` (MK-018). The contract is NOT in the bundled
   * address map, and deliberately stays out of it: its address is read from the deployment
   * itself, `borrowerOperations.governableVariables()`, so it cannot disagree with the
   * BorrowerOperations the SDK is already talking to. Cached for the client lifetime like
   * the other wiring pointers; unlike a governable VALUE, a wiring pointer changing is a
   * redeployment, not a governance action.
   */
  let cachedGovernableVariables: Address | undefined
  async function isAccountFeeExempt(account: Address): Promise<boolean> {
    if (!cachedGovernableVariables) {
      cachedGovernableVariables = await contracts.borrowerOperations.read.governableVariables()
    }
    return publicClient.readContract({
      address: cachedGovernableVariables,
      abi: governableVariablesAbi,
      functionName: 'isAccountFeeExempt',
      args: [account],
    })
  }

  const readDeps: ReadDeps = { publicClient, addresses }
  const mathDeps: MathDeps = {
    publicClient,
    addresses,
    getMinNetDebt: () => getConstants().then((c) => c.minNetDebt),
    isAccountFeeExempt,
  }
  const writeDeps: WriteDeps = { publicClient, walletClient, addresses }

  return {
    chainId,
    addresses,
    contracts,
    fixed: FIXED_CONSTANTS,
    getConstants,
    getBorrowingFee,
    verifyDeployment,
    getTrove: (address) => getTrove(readDeps, address),
    getSystemState: () => getSystemState(readDeps),
    isLiquidatable: (address) => isLiquidatable(readDeps, address),
    getOraclePrice: () => getOraclePrice(readDeps),
    balanceOf: (address) => balanceOf(readDeps, address),
    computeNICR,
    computeHints: (params) => computeHints(readDeps, params),
    computeICR,
    computeLiquidationPrice,
    getHealthFactor,
    computeEntireDebt,
    previewOpen: (params) => previewOpen(mathDeps, params),
    previewBorrow: (params) => previewBorrow(mathDeps, params),
    previewRefinance: (owner) => previewRefinance(mathDeps, owner),
    getBorrowingCapacity: (owner) => getBorrowingCapacity(mathDeps, owner),
    getBorrowingPower: (params) => getBorrowingPower(mathDeps, params),
    openTrove: (params) => openTrove(writeDeps, params),
    addCollateral: (params) => addCollateral(writeDeps, params),
    borrow: (params) => borrow(writeDeps, params),
    repay: (params) => repay(writeDeps, params),
    withdrawCollateral: (params) => withdrawCollateral(writeDeps, params),
    adjustTrove: (params) => adjustTrove(writeDeps, params),
    close: () => close(writeDeps),
    refinance: () => refinance(writeDeps),
    claim: () => claim(writeDeps),
    redeem: (params) => redeem(writeDeps, params),
    liquidate: (borrower) => liquidate(writeDeps, borrower),
    batchLiquidate: (borrowers) => batchLiquidate(writeDeps, borrowers),
    getClaimableCollateral: (address) => getClaimableCollateral(readDeps, address),
  }
}
