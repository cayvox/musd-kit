import type { Address, PublicClient, WalletClient } from 'viem'
import { type MusdAddresses, getAddresses } from '../addresses'
import { type MusdContracts, createContracts, governableVariablesAbi } from '../clients'
import { FIXED_CONSTANTS, type FixedConstants } from '../constants'
import {
  type ComputeHintsParams,
  type ComputeNICRParams,
  type Hints,
  computeHints,
  computeNICR,
} from '../hints'
import { DEFAULT_GAS_MARGIN_PERCENT } from '../internal/write'
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
import { verifyDeployment as runVerifyDeployment } from './verifyDeployment'

// `MismatchedDeployment` now lives in the unified `errors/` taxonomy (a `MusdError`);
// re-exported here so existing `from './client/createMusdClient'` imports keep working.
export { MismatchedDeployment, DeploymentVerificationFailed } from '../errors'

/** Governable values read live (never bundled). */
export interface GovernableConstants {
  /** `borrowerOperations.minNetDebt()`, floor on `draw + fee`, 1e18-scaled. */
  minNetDebt: bigint
  /** `interestRateManager.interestRate()`, current global rate, in basis points. */
  interestRate: number
}

/** The bundled fixed constants plus the live-read governable ones. */
export type MusdConstants = FixedConstants & GovernableConstants

/**
 * How long {@link MusdClient.getConstants} may reuse a cached read of the GOVERNABLE
 * values, in milliseconds. 60 seconds (MK-012).
 *
 * The values behind it, `minNetDebt()` and the global interest rate, are governable: they
 * can change under a running process at any time. They were previously cached for the
 * lifetime of the client object, so a keeper or a server that builds one client at boot
 * could act on a debt floor that changed hours earlier, and nothing in the SDK would ever
 * notice.
 *
 * 60 seconds is chosen against the cost of being wrong in each direction. Being stale is
 * unbounded harm: a preview reports a floor the contract no longer enforces, so an open
 * that the SDK says is fine reverts, or one it rejects would have succeeded. Being fresh
 * costs two `eth_call`s a minute per client, which is nothing next to the reads a single
 * `previewOpen` already makes. It is not lower because these are governance parameters,
 * changed by a timelocked process, not a price: sub second freshness would buy nothing real
 * and would turn every preview into an extra round trip.
 *
 * Override it with `constantsTtlMs`, or drop the cache at a moment you choose with
 * {@link MusdClient.invalidateConstants}. `0` re-reads on every call.
 */
export const DEFAULT_CONSTANTS_TTL_MS = 60_000

/** Inputs to {@link createMusdClient}: the chain, a viem public client, and (for writes) a wallet client; `addresses` overrides the bundled deployment. */
export interface CreateMusdClientParams {
  chainId: number
  publicClient: PublicClient
  /** Optional in Phase 1 (writes arrive in Phase 5); reads use `publicClient`. */
  walletClient?: WalletClient
  /** Per-contract address overrides (also enables an unsupported chainId). */
  addresses?: Partial<MusdAddresses>
  /**
   * How long a cached read of the governable constants stays usable, in milliseconds.
   * Defaults to {@link DEFAULT_CONSTANTS_TTL_MS} (60 seconds). `0` re-reads every time
   * (MK-012).
   */
  constantsTtlMs?: number
  /**
   * Percent added to the gas estimate on every write, over 100. Defaults to
   * {@link DEFAULT_GAS_MARGIN_PERCENT} (25), which is a measured number, not a convention:
   * see its docstring for the per path spread it was sized against (MK-035).
   *
   * `0` sends the bare estimate, which is what the SDK did before and is what produced the
   * reverts MK-035 records. Raise it if you send during periods where the chain moves fast
   * between your estimate and your inclusion.
   *
   * Unused gas is refunded, so a larger margin costs no fees. What it does cost is the
   * native balance that must be AVAILABLE: the account must hold `gasLimit * gasPrice +
   * value` or the send is rejected before it reaches the chain.
   */
  gasMarginPercent?: number
}

/** The `createMusdClient` surface: live reads, preview math, hints, lifecycle writes, and the redemption/keeper functions, all bound to one chain + clients. */
export interface MusdClient {
  readonly chainId: number
  readonly addresses: MusdAddresses
  readonly contracts: MusdContracts
  /** The bundled fixed constants (synchronous, no network). */
  readonly fixed: FixedConstants
  /**
   * Read the governable constants, returned together with the fixed ones, cached for
   * `constantsTtlMs` (default {@link DEFAULT_CONSTANTS_TTL_MS}, 60 seconds). Also runs
   * {@link verifyDeployment} once.
   *
   * The cache is time bounded because `minNetDebt` and the interest rate are governable and
   * used to be held for the lifetime of the client, so a long lived process could act on a
   * stale floor indefinitely (MK-012).
   */
  getConstants(): Promise<MusdConstants>
  /**
   * Drop the cached governable constants, so the next {@link getConstants} re-reads them
   * (MK-012).
   *
   * For when you know something changed and do not want to wait out the TTL: a governance
   * event observed in a log subscription, or a test that wants a deterministic re-read. It
   * does NOT clear the deployment verification, which is memoized for the client's lifetime
   * on purpose: a wiring pointer changing is a redeployment, not a governance action.
   */
  invalidateConstants(): void
  /** Passthrough to `borrowerOperations.getBorrowingFee(debt)` (parameterized, not cached). */
  getBorrowingFee(debt: bigint): Promise<bigint>
  /**
   * Assert the contracts at the resolved addresses really are a consistent MUSD deployment
   * (MK-008): code present at all seven bundled addresses, all fourteen cross wiring
   * pointers resolving to that same map, `HintHelpers.priceFeed()` still unset, and
   * `MCR`/`CCR` equal to the bundled fixed constants. One `multicall`, memoized after the
   * first success, and awaited automatically before the first write.
   *
   * Calling it yourself is only necessary if you want the check to happen at a moment you
   * choose, for example right after constructing a client against an overridden address map.
   * @throws {MismatchedDeployment} a bundled constant disagrees with the chain.
   * @throws {DeploymentVerificationFailed} missing code, or wiring that does not resolve.
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
  const ttlMs = params.constantsTtlMs ?? DEFAULT_CONSTANTS_TTL_MS
  const addresses = getAddresses(chainId, override)
  const contracts = createContracts(addresses, publicClient, walletClient)

  let cachedConstants: MusdConstants | undefined

  /**
   * The in-flight or completed verification (MK-008).
   *
   * A promise rather than a boolean, so that concurrent first writes share ONE multicall
   * instead of racing into several. It is cleared on failure so a transient transport error
   * does not permanently poison a client that is otherwise fine.
   */
  let verification: Promise<void> | undefined

  function verifyDeployment(): Promise<void> {
    if (!verification) {
      verification = runVerifyDeployment(publicClient, addresses).catch((error: unknown) => {
        verification = undefined
        throw error
      })
    }
    return verification
  }

  /**
   * MK-012. `cachedConstants` alone had no expiry, so `minNetDebt` and the interest rate,
   * both governable, were pinned for as long as the client object lived. `readAt` is what
   * bounds that. An in-flight read is shared through `constantsInFlight` so a burst of
   * concurrent callers after an expiry issues one pair of reads, not one pair each.
   */
  let constantsReadAt = 0
  let constantsInFlight: Promise<MusdConstants> | undefined

  function invalidateConstants(): void {
    cachedConstants = undefined
    constantsInFlight = undefined
    constantsReadAt = 0
  }

  async function getConstants(): Promise<MusdConstants> {
    if (cachedConstants && Date.now() - constantsReadAt < ttlMs) return cachedConstants
    if (!constantsInFlight) {
      constantsInFlight = (async () => {
        await verifyDeployment()
        const [minNetDebt, interestRate] = await Promise.all([
          contracts.borrowerOperations.read.minNetDebt(),
          contracts.interestRateManager.read.interestRate(),
        ])
        cachedConstants = { ...FIXED_CONSTANTS, minNetDebt, interestRate: Number(interestRate) }
        constantsReadAt = Date.now()
        return cachedConstants
      })().finally(() => {
        constantsInFlight = undefined
      })
    }
    return constantsInFlight
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
  const writeDeps: WriteDeps = {
    publicClient,
    walletClient,
    addresses,
    ensureVerified: verifyDeployment,
    getMinNetDebt: () => getConstants().then((c) => c.minNetDebt),
    gasMarginPercent: params.gasMarginPercent ?? DEFAULT_GAS_MARGIN_PERCENT,
  }

  return {
    chainId,
    addresses,
    contracts,
    fixed: FIXED_CONSTANTS,
    getConstants,
    invalidateConstants,
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
