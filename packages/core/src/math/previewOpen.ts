import type { Address } from 'viem'
import { borrowerOperationsAbi, priceFeedAbi, troveManagerAbi } from '../clients'
import { CCR, MCR, MUSD_GAS_COMPENSATION } from '../constants'
import { TroveStatus } from '../read/types'
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

/**
 * Why an open would be rejected. Machine readable, stable strings, in CONTRACT CALL ORDER.
 *
 * The order is `_openTrove`'s own, so `bindingConstraint` names the gate the chain would hit
 * first rather than the one this file happens to check first.
 */
export type OpenBlockReason =
  /**
   * `_requireTroveisNotActive` (`BorrowerOperations.sol:633`, `:1140-1149`), the FIRST gate on
   * the open path (MK-047).
   *
   * It blocks only `Status.active`. A Trove closed by the owner, by liquidation or by
   * redemption is not active and CAN be reopened, so this is not "an address that has ever had
   * a Trove", it is "an address whose Trove is open right now".
   */
  'TROVE_ALREADY_ACTIVE' | 'BELOW_MINIMUM_DEBT' | 'ICR_BELOW_THRESHOLD' | 'TCR_BELOW_CCR'

/** Result of {@link MusdClient.previewOpen}: an explicit verdict plus every raw number. */
export interface OpenPreview {
  /**
   * True only when every condition `_openTrove` enforces is satisfied.
   *
   * The four gates, in the order the contract runs them: the Trove is not already active
   * (`:633`), the debt floor (`:645`), the mode correct individual ratio (`:655` or `:657`),
   * and in normal mode the resulting system ratio (`:665`).
   *
   * **This docstring used to make that claim while the code checked three of the four**
   * (MK-047). `_requireTroveisNotActive` was missing, so an owner who already held a Trove got
   * `viable: true` and the contract refused with `BorrowerOps: Trove is active`. The claim and
   * the code now agree, and `open-gates.test.ts` pins the count so they cannot drift apart
   * silently again.
   *
   * `viable` REPLACES `meetsRecoveryRequirement`, which was `true` for every open in normal
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
  /**
   * `TroveManager.getTroveStatus(account)` for the account this preview was run for, or
   * `undefined` when no account was supplied (MK-047).
   *
   * `undefined` is not "no Trove", it is "not asked". Without an account there is nobody to
   * ask about, so the `TROVE_ALREADY_ACTIVE` gate cannot be evaluated and is not reported,
   * exactly as `feeExempt` reports the same absence for the fee gate. **Pass `account`
   * whenever you have it**; a preview rendered from a wallet always has it.
   */
  troveStatus: number | undefined
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
 *   - **The Trove must not already be active** (`:633`, `:1140-1149`), which is the FIRST
 *     gate and was missing entirely until MK-047: an owner who already held a Trove got
 *     `viable: true` while the contract refused with `BorrowerOps: Trove is active`. It is
 *     evaluated only when `account` is supplied, because without one there is nobody to ask.
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
  const [isRecoveryMode, minNetDebt, systemColl, systemDebt, troveStatus] = await Promise.all([
    publicClient.readContract({ ...tm, functionName: 'checkRecoveryMode', args: [price] }),
    deps.getMinNetDebt(),
    publicClient.readContract({ ...tm, functionName: 'getEntireSystemColl' }),
    publicClient.readContract({ ...tm, functionName: 'getEntireSystemDebt' }),
    // MK-047. Read only when an account is supplied, on the same rule as the exemption read
    // below: with no account there is nobody to ask about.
    account !== undefined
      ? publicClient.readContract({ ...tm, functionName: 'getTroveStatus', args: [account] })
      : Promise.resolve(undefined),
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
    troveStatus,
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
  /**
   * `getTroveStatus` for the opening account, or `undefined` when none was supplied (MK-047).
   * `1` is `active` and is the only value the contract refuses (`:1146`).
   */
  troveStatus?: number | undefined
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
    troveStatus,
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
  // In contract call order. `_requireTroveisNotActive` is FIRST (`:633`), and it compares
  // against `Status.active` alone (`:1146`), so a closed Trove does not block a reopen.
  if (troveStatus === TroveStatus.active) reasons.push('TROVE_ALREADY_ACTIVE')
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
    troveStatus,
  }
}
