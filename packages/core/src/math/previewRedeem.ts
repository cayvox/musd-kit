import type { Address } from 'viem'
import { musdAbi, priceFeedAbi, sortedTrovesAbi, troveManagerAbi } from '../clients'
import { MCR, MUSD_GAS_COMPENSATION } from '../constants'
import type { MathDeps } from './deps'

/**
 * Redemption, previewed by walking the list the way `redeemCollateral` does (MK-048).
 *
 * **Why this exists rather than trusting `getRedemptionHints`.** The protocol's hint helper and
 * the redemption loop do not agree about how much a single call can redeem, and the SDK used to
 * report the helper's figure. Both were read from `mezo-org/musd` for this file:
 *
 * `HintHelpers.sol:138-162` sizes each partial to the target's headroom above the debt floor,
 * `maxRedeemableMUSD = min(remainingMUSD, netDebt - minNetDebt)`, and then CONTINUES to the next
 * trove with what is left. So its `truncatedAmount` answers "how much could be redeemed if every
 * partial were sized per trove", which needs one call per trove.
 *
 * `TroveManager.sol:1218-1221` does no such sizing. It hands the whole remaining amount to the
 * first eligible trove, `mUSDLot = min(_maxMUSDamount, totalDebt - MUSD_GAS_COMPENSATION)`, and if
 * that leaves the trove's net debt below the floor it CANCELS the partial (`:1299-1306`), which
 * breaks the loop (`:392`). If nothing was drawn before the break, the whole call reverts
 * (`:406-408`).
 *
 * **So the redeemable set has a GAP, not a cap.** For the first eligible trove with net debt `D`
 * and floor `M`:
 *
 *   A <= D - M      succeeds, a partial within the headroom
 *   D - M < A < D   REVERTS, the partial breaches the floor and cancels on the first trove
 *   A >= D          succeeds, the trove is consumed WHOLE, which takes a different branch
 *                   (`:1252`) with no hint check and no floor check at all
 *
 * Verified on a fork against the real deployment, to the wei, with the hint helper's answer beside
 * each: headroom exactly SUCCEEDS, headroom+1 REVERTS, half of net debt REVERTS, netDebt-1 REVERTS,
 * netDebt exactly SUCCEEDS, netDebt+1 SUCCEEDS. The helper reported every one of those amounts as
 * fully redeemable, including the three that revert.
 *
 * That gap is what no field in this SDK expressed, and it is why a caller could not foresee the
 * revert: the blocking condition lives in SOMEONE ELSE'S position.
 */

/** Why a redemption would be refused. Machine readable, in contract call order. */
export type RedeemBlockReason =
  /** `_requireTCRoverMCR` (`TroveManager.sol:318`, `:1470-1475`). A system condition, not yours. */
  | 'SYSTEM_TCR_BELOW_MCR'
  /** `_requireAmountGreaterThanZero` (`:319`, `:1612-1614`). */
  | 'AMOUNT_ZERO'
  /** `_requireMUSDBalanceCoversRedemption` (`:320`, `:1477-1486`). */
  | 'INSUFFICIENT_MUSD_BALANCE'
  /** No Trove is at or above MCR, so the loop finds nothing and draws nothing. */
  | 'NOTHING_REDEEMABLE'
  /**
   * **The one that had no field before MK-048.** The amount falls in the gap: too large to take
   * as a partial without pushing the first eligible Trove's net debt below `minNetDebt`, and too
   * small to consume that Trove whole.
   *
   * Act on it with {@link RedemptionPreview.maxWithoutConsuming} or
   * {@link RedemptionPreview.nextViableAmount}, which are the two edges of the gap.
   */
  | 'PARTIAL_BREACHES_DEBT_FLOOR'

/** Result of {@link previewRedeem}. Raw numbers included so callers render their own copy. */
export interface RedemptionPreview {
  /** True only when a single `redeemCollateral` call would go through. */
  viable: boolean
  /** Every reason it would not, in contract call order. Empty when `viable`. */
  reasons: RedeemBlockReason[]
  /** The constraint that binds first, or `null` when viable. */
  bindingConstraint: RedeemBlockReason | null
  /**
   * What a single call would ACTUALLY redeem, computed by walking the list the way the loop
   * does. Zero when the call would revert.
   *
   * This is NOT `getRedemptionHints`'s `truncatedAmount`, which answers a different question and
   * over-reports in the gap (MK-048).
   */
  redeemable: bigint
  /** The first Trove at or above MCR, which is where the loop starts. `null` when there is none. */
  firstEligibleTrove: Address | null
  /** That Trove's net debt, its entire debt minus the 200 MUSD gas reserve. */
  firstTroveNetDebt: bigint
  /**
   * `firstTroveNetDebt - minNetDebt`, floored at zero. **The largest partial the contract accepts
   * without consuming the Trove**, and the lower edge of the gap.
   */
  maxWithoutConsuming: bigint
  /**
   * `firstTroveNetDebt`. **The smallest amount above the gap that works**, because at exactly this
   * the Trove is consumed whole and the floor check does not run (`TroveManager.sol:1252`).
   */
  nextViableAmount: bigint
  /** The live `minNetDebt()` floor the cancellation compares against. */
  minNetDebt: bigint
  /** The caller's MUSD balance, which the contract checks at `:320`. */
  musdBalance: bigint
  /** The system TCR, which must be at or above MCR (`:318`). */
  tcr: bigint
  /** BTC/USD used for every number above. */
  price: bigint
}

/** Inputs to {@link previewRedeem}. */
export interface PreviewRedeemParams {
  /** The account that would redeem. Its MUSD balance is the gate at `:320`. */
  redeemer: Address
  /** MUSD to redeem. */
  amount: bigint
  /** Cap on the list walk, matching the contract's own parameter. Default 100. */
  maxIterations?: bigint
}

/** One eligible Trove, as the walk found it. */
export interface EligibleTrove {
  owner: Address
  /** Entire debt minus the 200 MUSD gas reserve. */
  netDebt: bigint
}

/** Everything {@link evaluateRedeem} needs, already read from the chain. */
export interface EvaluateRedeemInput {
  amount: bigint
  musdBalance: bigint
  minNetDebt: bigint
  tcr: bigint
  price: bigint
  /**
   * Eligible Troves in the order the loop visits them, lowest ICR first, with those below MCR
   * already skipped exactly as `:341-349` and `:375-378` skip them.
   */
  eligible: EligibleTrove[]
}

/**
 * The verdict, as a pure function of values already read from the chain.
 *
 * Split out for the same reason every other evaluator is: the decision is the part worth testing
 * exhaustively, and as a pure function it can be, chain free, across the whole gap rather than
 * only the amounts a fork happens to produce.
 */
export function evaluateRedeem(input: EvaluateRedeemInput): RedemptionPreview {
  const { amount, musdBalance, minNetDebt, tcr, price, eligible } = input

  const first = eligible[0]
  const firstTroveNetDebt = first?.netDebt ?? 0n
  const maxWithoutConsuming = firstTroveNetDebt > minNetDebt ? firstTroveNetDebt - minNetDebt : 0n

  const reasons: RedeemBlockReason[] = []
  // In the order `redeemCollateral` checks them (`:318`, `:319`, `:320`), so the binding
  // constraint is the one the chain would report first.
  if (tcr < MCR) reasons.push('SYSTEM_TCR_BELOW_MCR')
  if (amount <= 0n) reasons.push('AMOUNT_ZERO')
  if (musdBalance < amount) reasons.push('INSUFFICIENT_MUSD_BALANCE')
  if (first === undefined) reasons.push('NOTHING_REDEEMABLE')

  // Walk the loop. `mUSDLot = min(remaining, netDebt)` per trove (`:1218-1221`), and a partial
  // that would leave net debt below the floor cancels and BREAKS (`:1299-1306`, `:392`).
  let remaining = amount
  let redeemed = 0n
  let cancelledOnFirst = false
  for (let i = 0; i < eligible.length && remaining > 0n; i++) {
    const trove = eligible[i]
    if (trove === undefined) break
    const lot = remaining < trove.netDebt ? remaining : trove.netDebt
    if (lot < trove.netDebt) {
      // A partial. It cancels when the resulting net debt falls below the floor.
      if (trove.netDebt - lot < minNetDebt) {
        if (i === 0) cancelledOnFirst = true
        break
      }
    }
    redeemed += lot
    remaining -= lot
  }

  // `require(totals.totalCollateralDrawn > 0)` (`:406-408`): the call reverts only when NOTHING
  // was drawn. A cancel after at least one Trove was redeemed leaves a successful call that
  // simply redeems less, which is why this is checked on the first Trove specifically.
  if (cancelledOnFirst && amount > 0n) reasons.push('PARTIAL_BREACHES_DEBT_FLOOR')

  const viable = reasons.length === 0
  return {
    viable,
    reasons,
    bindingConstraint: reasons[0] ?? null,
    redeemable: viable ? redeemed : 0n,
    firstEligibleTrove: first?.owner ?? null,
    firstTroveNetDebt,
    maxWithoutConsuming,
    nextViableAmount: firstTroveNetDebt,
    minNetDebt,
    musdBalance,
    tcr,
    price,
  }
}

/**
 * Read the sorted list the way the loop reads it, then decide (MK-048).
 *
 * The walk is bounded by `maxIterations`, matching the contract's own parameter, so a long list
 * cannot turn a preview into an unbounded read. That bound is the same reason `getBorrowingPower`
 * carries one (MK-010).
 */
export async function previewRedeem(
  deps: MathDeps,
  params: PreviewRedeemParams,
): Promise<RedemptionPreview> {
  const { publicClient, addresses } = deps
  const { redeemer, amount } = params
  const maxIterations = params.maxIterations ?? 100n

  const price = await publicClient.readContract({
    address: addresses.priceFeed,
    abi: priceFeedAbi,
    functionName: 'fetchPrice',
  })
  const tm = { address: addresses.troveManager, abi: troveManagerAbi } as const
  const st = { address: addresses.sortedTroves, abi: sortedTrovesAbi } as const

  const [tcr, musdBalance, minNetDebt] = await Promise.all([
    publicClient.readContract({ ...tm, functionName: 'getTCR', args: [price] }),
    publicClient.readContract({
      address: addresses.musd,
      abi: musdAbi,
      functionName: 'balanceOf',
      args: [redeemer],
    }),
    deps.getMinNetDebt(),
  ])

  // Start at the tail, the lowest ICR, and skip everything under MCR exactly as `:341-349` does.
  let cursor = await publicClient.readContract({ ...st, functionName: 'getLast' })
  const eligible: EligibleTrove[] = []
  const ZERO = '0x0000000000000000000000000000000000000000'
  for (let i = 0n; i < maxIterations && cursor !== ZERO; i++) {
    const [icr, entire] = await Promise.all([
      publicClient.readContract({ ...tm, functionName: 'getCurrentICR', args: [cursor, price] }),
      publicClient.readContract({ ...tm, functionName: 'getEntireDebtAndColl', args: [cursor] }),
    ])
    // `getEntireDebtAndColl` returns (coll, principal, interest, ...), and the loop compares the
    // LIVE entire debt, so principal plus accrued interest is the right quantity here.
    const entireDebt = entire[1] + entire[2]
    if (icr >= MCR) {
      eligible.push({
        owner: cursor,
        netDebt: entireDebt > MUSD_GAS_COMPENSATION ? entireDebt - MUSD_GAS_COMPENSATION : 0n,
      })
      // Stop as soon as the accumulated net debt covers the request: nothing beyond it can
      // change the verdict, and every extra step is two more chain reads.
      const total = eligible.reduce((sum, t) => sum + t.netDebt, 0n)
      if (total >= amount) break
    }
    cursor = await publicClient.readContract({ ...st, functionName: 'getPrev', args: [cursor] })
  }

  return evaluateRedeem({ amount, musdBalance, minNetDebt, tcr, price, eligible })
}
