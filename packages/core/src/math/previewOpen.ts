import { borrowerOperationsAbi, priceFeedAbi, troveManagerAbi } from '../clients'
import { CCR, MUSD_GAS_COMPENSATION } from '../constants'
import { computeICR, computeLiquidationPrice } from './compute'
import type { MathDeps } from './deps'

export interface PreviewOpenParams {
  collateral: bigint
  /** Requested draw (MUSD received; the borrower owes draw + fee + 200). */
  debt: bigint
  /** Override the price; defaults to `fetchPrice()`. */
  price?: bigint
}

export interface OpenPreview {
  /** `getBorrowingFee(debt)` — read on-chain (governable). */
  fee: bigint
  /** `debt + fee` — the value the `minNetDebt` floor is checked against (C6). */
  netDebt: bigint
  /** `netDebt + 200` gas reserve. */
  entireDebt: bigint
  /** `computeICR(collateral, entireDebt, price)`. */
  icr: bigint
  /** Price at which the opened position would hit MCR. */
  liquidationPrice: bigint
  /** `netDebt >= minNetDebt()` — the debt floor (C6). */
  meetsMinimum: boolean
  /** `checkRecoveryMode(price)` — always surfaced. */
  isRecoveryMode: boolean
  /** In Recovery Mode an open must keep `ICR >= CCR` (150%); `true` in normal mode. */
  meetsRecoveryRequirement: boolean
}

/**
 * Preview opening a Trove — the "Borrowing Power Calculator" core (non-throwing; Law 2
 * preview side). Implements the verified open math (`docs/01-ground-truth.md` §6):
 * `entireDebt = debt + getBorrowingFee(debt) + 200`; the `minNetDebt` floor is on
 * `debt + fee`. Reads the governable values live (fee, minNetDebt, price, recovery mode).
 */
export async function previewOpen(deps: MathDeps, params: PreviewOpenParams): Promise<OpenPreview> {
  const { publicClient, addresses } = deps
  const { collateral, debt } = params

  const price =
    params.price ??
    (await publicClient.readContract({
      address: addresses.priceFeed,
      abi: priceFeedAbi,
      functionName: 'fetchPrice',
    }))

  const [fee, isRecoveryMode, minNetDebt] = await Promise.all([
    publicClient.readContract({
      address: addresses.borrowerOperations,
      abi: borrowerOperationsAbi,
      functionName: 'getBorrowingFee',
      args: [debt],
    }),
    publicClient.readContract({
      address: addresses.troveManager,
      abi: troveManagerAbi,
      functionName: 'checkRecoveryMode',
      args: [price],
    }),
    deps.getMinNetDebt(),
  ])

  const netDebt = debt + fee
  const entireDebt = netDebt + MUSD_GAS_COMPENSATION
  const icr = computeICR({ collateral, entireDebt, price })
  const liquidationPrice = computeLiquidationPrice({ collateral, entireDebt })

  return {
    fee,
    netDebt,
    entireDebt,
    icr,
    liquidationPrice,
    meetsMinimum: netDebt >= minNetDebt,
    isRecoveryMode,
    meetsRecoveryRequirement: !isRecoveryMode || icr >= CCR,
  }
}
