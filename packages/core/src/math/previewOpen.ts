import type { Address } from 'viem'
import { borrowerOperationsAbi, priceFeedAbi, troveManagerAbi } from '../clients'
import { CCR, MCR, MUSD_GAS_COMPENSATION } from '../constants'
import { computeICR, computeLiquidationPrice } from './compute'
import type { MathDeps } from './deps'
import { isBorrowingFeeCharged } from './fee'

/** Inputs to {@link MusdClient.previewOpen}: the collateral + draw to preview. */
export interface PreviewOpenParams {
  collateral: bigint
  /** Requested draw (MUSD received; the borrower owes draw + fee + 200). */
  debt: bigint
  /** Override the price; defaults to `fetchPrice()`. */
  price?: bigint
  /**
   * The account that would open the Trove. Supply it whenever you have it.
   *
   * The borrowing fee is skipped entirely for a fee exempt account
   * (`BorrowerOperations.sol:637-643`), and the exempt cohort is NOT empty on mainnet, so
   * omitting this can produce a fee, a debt, an ICR and a liquidation price that are all
   * wrong for that caller. Omitted, the preview assumes the account is not exempt and says
   * so via {@link OpenPreview.feeExempt} being `false` (MK-018).
   */
  account?: Address
}

/** Why an open would be rejected. Machine readable, stable strings, in a fixed order. */
export type OpenBlockReason = 'BELOW_MINIMUM_DEBT' | 'ICR_BELOW_THRESHOLD' | 'TCR_BELOW_CCR'

/** Result of {@link MusdClient.previewOpen}: an explicit verdict plus every raw number. */
export interface OpenPreview {
  /**
   * True only when every condition `_openTrove` enforces is satisfied: the debt floor, the
   * mode correct individual ratio, and, in normal mode, the resulting system ratio.
   *
   * This REPLACES `meetsRecoveryRequirement`, which was `true` for every open in normal
   * mode and therefore could never warn about anything (MK-005).
   */
  viable: boolean
  /** Every reason it is not viable, in a fixed order. Empty when `viable`. */
  reasons: OpenBlockReason[]
  /** The constraint that binds first, or `null` when viable. */
  bindingConstraint: OpenBlockReason | null
  /** The fee the contract will ACTUALLY charge: zero in Recovery Mode or when exempt. */
  fee: bigint
  /** Whether the account is fee exempt. `false` when no account was supplied. */
  feeExempt: boolean
  /** `debt + fee`, the quantity the `minNetDebt` floor is checked against. */
  netDebt: bigint
  /** `netDebt + 200` gas reserve. */
  entireDebt: bigint
  /** `computeICR(collateral, entireDebt, price)`. */
  icr: bigint
  /** The threshold `icr` is measured against: CCR in Recovery Mode, MCR in normal mode. */
  icrThreshold: bigint
  /** The resulting system TCR if this open went through. */
  resultingTcr: bigint
  /** Price at which the opened position would hit MCR. */
  liquidationPrice: bigint
  /** `netDebt >= minNetDebt()`, the debt floor. */
  meetsMinimum: boolean
  /** `checkRecoveryMode(price)`, always surfaced. */
  isRecoveryMode: boolean
}

/**
 * Preview opening a Trove. Non-throwing: it returns a verdict and numbers, never an error.
 *
 * Mirrors `_openTrove` (`BorrowerOperations.sol:631-665`) rather than approximating it:
 *
 *   - **The fee** is charged only when `!isRecoveryMode && !isAccountFeeExempt(borrower)`
 *     (`:637-643`). In Recovery Mode, or for an exempt account, `netDebt` is the bare draw
 *     and no fee is charged at all. The old version applied `getBorrowingFee`
 *     unconditionally while separately reporting `isRecoveryMode` in the same result
 *     (MK-004, MK-018).
 *   - **The debt floor** is `_requireAtLeastMinNetDebt(vars.netDebt)` (`:645`), checked
 *     against that same `netDebt`. This is the second order effect worth naming: because
 *     the old version added a fee the contract would not charge, in the band where
 *     `draw < minNetDebt <= draw + fee` it reported the floor MET for an open that reverts.
 *     Charging the fee correctly closes that band.
 *   - **The ratios**: in Recovery Mode the contract requires `ICR >= CCR` (`:654-655`); in
 *     normal mode it requires BOTH `ICR >= MCR` and a resulting system `TCR >= CCR`
 *     (`:656-665`). The old `meetsRecoveryRequirement` was `!isRecoveryMode || icr >= CCR`,
 *     which is unconditionally `true` in normal mode, so it never checked the ICR floor and
 *     never projected the TCR at all (MK-005).
 *
 * Every raw number is still returned so a caller can render its own message.
 */
export async function previewOpen(deps: MathDeps, params: PreviewOpenParams): Promise<OpenPreview> {
  const { publicClient, addresses } = deps
  const { collateral, debt, account } = params

  const price =
    params.price ??
    (await publicClient.readContract({
      address: addresses.priceFeed,
      abi: priceFeedAbi,
      functionName: 'fetchPrice',
    }))

  const tm = { address: addresses.troveManager, abi: troveManagerAbi } as const
  const [isRecoveryMode, minNetDebt, systemColl, systemDebt] = await Promise.all([
    publicClient.readContract({ ...tm, functionName: 'checkRecoveryMode', args: [price] }),
    deps.getMinNetDebt(),
    publicClient.readContract({ ...tm, functionName: 'getEntireSystemColl' }),
    publicClient.readContract({ ...tm, functionName: 'getEntireSystemDebt' }),
  ])

  // Exemption is read only when an account is supplied. With no account there is nobody to
  // ask about, so the preview assumes not exempt and reports that assumption.
  const feeExempt = account !== undefined ? await deps.isAccountFeeExempt(account) : false

  const fee = !isBorrowingFeeCharged(isRecoveryMode, feeExempt)
    ? 0n
    : await publicClient.readContract({
        address: addresses.borrowerOperations,
        abi: borrowerOperationsAbi,
        functionName: 'getBorrowingFee',
        args: [debt],
      })

  return evaluateOpen({
    collateral,
    debt,
    fee,
    feeExempt,
    minNetDebt,
    isRecoveryMode,
    price,
    systemColl,
    systemDebt,
  })
}

/** Everything {@link evaluateOpen} needs, already read from the chain. */
export interface EvaluateOpenInput {
  collateral: bigint
  /** The requested draw. */
  debt: bigint
  /** The fee the contract will actually charge, already zeroed for Recovery Mode or exemption. */
  fee: bigint
  feeExempt: boolean
  minNetDebt: bigint
  isRecoveryMode: boolean
  price: bigint
  systemColl: bigint
  systemDebt: bigint
}

/**
 * The open verdict itself, as a pure function of values already read from the chain.
 *
 * Split out from {@link previewOpen} so the decision, which is the part that was wrong in
 * MK-004 and MK-005, can be tested exhaustively in the chain-free unit project across every
 * combination of reasons rather than only those a fork happens to produce.
 */
export function evaluateOpen(input: EvaluateOpenInput): OpenPreview {
  const {
    collateral,
    debt,
    fee,
    feeExempt,
    minNetDebt,
    isRecoveryMode,
    price,
    systemColl,
    systemDebt,
  } = input

  const netDebt = debt + fee
  const entireDebt = netDebt + MUSD_GAS_COMPENSATION
  const icr = computeICR({ collateral, entireDebt, price })
  const liquidationPrice = computeLiquidationPrice({ collateral, entireDebt })
  const icrThreshold = isRecoveryMode ? CCR : MCR
  const resultingTcr = computeICR({
    collateral: systemColl + collateral,
    entireDebt: systemDebt + entireDebt,
    price,
  })

  const meetsMinimum = netDebt >= minNetDebt
  const reasons: OpenBlockReason[] = []
  if (!meetsMinimum) reasons.push('BELOW_MINIMUM_DEBT')
  if (icr < icrThreshold) reasons.push('ICR_BELOW_THRESHOLD')
  // The resulting TCR condition is a NORMAL mode rule only; a Recovery Mode open is gated
  // on `ICR >= CCR` instead and imposes no resulting TCR condition (`:653-665`).
  if (!isRecoveryMode && resultingTcr < CCR) reasons.push('TCR_BELOW_CCR')

  return {
    viable: reasons.length === 0,
    reasons,
    bindingConstraint: reasons[0] ?? null,
    fee,
    feeExempt,
    netDebt,
    entireDebt,
    icr,
    icrThreshold,
    resultingTcr,
    liquidationPrice,
    meetsMinimum,
    isRecoveryMode,
  }
}
