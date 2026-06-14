import type { Address, PublicClient, WalletClient } from 'viem'
import { type MusdAddresses, getAddresses } from '../addresses'
import { type MusdContracts, createContracts } from '../clients'
import {
  CCR as BUNDLED_CCR,
  MCR as BUNDLED_MCR,
  FIXED_CONSTANTS,
  type FixedConstants,
} from '../constants'
import {
  type ComputeHintsParams,
  type ComputeNICRParams,
  type Hints,
  computeHints,
  computeNICR,
} from '../hints'
import {
  type ComputeEntireDebtParams,
  type ComputeICRParams,
  type ComputeLiquidationPriceParams,
  type GetBorrowingPowerParams,
  type MathDeps,
  type OpenPreview,
  type PreviewOpenParams,
  computeEntireDebt,
  computeICR,
  computeLiquidationPrice,
  getBorrowingPower,
  getHealthFactor,
  previewOpen,
} from '../math'
import {
  type ReadDeps,
  type SystemState,
  type Trove,
  balanceOf,
  getOraclePrice,
  getSystemState,
  getTrove,
  isLiquidatable,
} from '../read'

/**
 * Thrown when an on-chain fixed constant disagrees with the value bundled in the
 * SDK — i.e. the deployment is not the one this SDK version was built against.
 * Surfacing it early prevents silently trusting a stale bundled constant.
 */
export class MismatchedDeployment extends Error {
  override readonly name = 'MismatchedDeployment'
  readonly code = 'MISMATCHED_DEPLOYMENT' as const
  constructor(
    readonly constantName: string,
    readonly bundled: bigint,
    readonly onchain: bigint,
  ) {
    super(
      `On-chain ${constantName} (${onchain}) does not match the bundled ${constantName} (${bundled}). The MUSD deployment may have changed — do not trust the bundled fixed constants for this chain.`,
    )
  }
}

/** Governable values read live (never bundled — Law 3). */
export interface GovernableConstants {
  /** `borrowerOperations.minNetDebt()` — floor on `draw + fee`, 1e18-scaled. */
  minNetDebt: bigint
  /** `interestRateManager.interestRate()` — current global rate, in basis points. */
  interestRate: number
}

/** The bundled fixed constants plus the live-read governable ones. */
export type MusdConstants = FixedConstants & GovernableConstants

export interface CreateMusdClientParams {
  chainId: number
  publicClient: PublicClient
  /** Optional in Phase 1 (writes arrive in Phase 5); reads use `publicClient`. */
  walletClient?: WalletClient
  /** Per-contract address overrides (also enables an unsupported chainId). */
  addresses?: Partial<MusdAddresses>
}

export interface MusdClient {
  readonly chainId: number
  readonly addresses: MusdAddresses
  readonly contracts: MusdContracts
  /** The bundled fixed constants (synchronous, no network). */
  readonly fixed: FixedConstants
  /**
   * Read + cache the governable constants on first use (Law 3), returned together
   * with the fixed ones. Also runs {@link verifyDeployment} once.
   */
  getConstants(): Promise<MusdConstants>
  /** Passthrough to `borrowerOperations.getBorrowingFee(debt)` (parameterized — not cached). */
  getBorrowingFee(debt: bigint): Promise<bigint>
  /**
   * Defense-in-depth: read `MCR`/`CCR` from the chain and assert they equal the
   * bundled fixed constants. Cached after the first success.
   * @throws {MismatchedDeployment}
   */
  verifyDeployment(): Promise<void>

  // --- live reads (Law 2 — contract-authoritative; see `read/`) ---
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

  // --- preview math (see `math/`; preview side of Law 2 — non-throwing) ---
  /** `(collateral × price) / entireDebt` (== contract `computeCR`). Pure. */
  computeICR(params: ComputeICRParams): bigint
  /** Price at which a position hits MCR = `(MCR × entireDebt) / collateral`. Pure. */
  computeLiquidationPrice(params: ComputeLiquidationPriceParams): bigint
  /** `icr / MCR` as a number (1.0 at MCR). Pure. */
  getHealthFactor(params: { icr: bigint }): number
  /** Project entire debt with simple time-based interest. Pure. */
  computeEntireDebt(params: ComputeEntireDebtParams): bigint
  /** Preview opening a Trove: fee, debt, ICR, liquidation price, and the floor/RM flags. */
  previewOpen(params: PreviewOpenParams): Promise<OpenPreview>
  /** Largest valid draw (ICR ≥ binding ratio, netDebt ≥ minNetDebt). */
  getBorrowingPower(params: GetBorrowingPowerParams): Promise<bigint>
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

  const readDeps: ReadDeps = { publicClient, addresses }
  const mathDeps: MathDeps = {
    publicClient,
    addresses,
    getMinNetDebt: () => getConstants().then((c) => c.minNetDebt),
  }

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
    getBorrowingPower: (params) => getBorrowingPower(mathDeps, params),
  }
}
