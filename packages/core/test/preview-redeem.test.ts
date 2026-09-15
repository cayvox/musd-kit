import type { PublicClient, WalletClient } from 'viem'
import { describe, expect, it } from 'vitest'
import { MCR, RedemptionBreachesDebtFloor, evaluateRedeem, getAddresses } from '../src'
import type { WriteDeps } from '../src/internal/write'
import { redeem } from '../src/redemption/redeem'

const MUSD = 10n ** 18n
const PRICE = 80_000n * MUSD
const GAS_COMP = 200n * MUSD

/**
 * MK-048. The redeemable set has a GAP, not a cap, and no field expressed it.
 *
 * Derived from `mezo-org/musd`, then verified on a fork to the wei. For the first eligible Trove
 * with net debt `D` at the time of the read, floor `M`, and accrual margin `G`:
 *
 *   A <= D - M          succeeds, a partial inside the headroom
 *   D - M < A < D + G   REVERTS: `TroveManager.sol:1218-1221` hands the whole amount to that
 *                       Trove, `:1299-1306` cancels the partial, `:392` breaks, `:406-408` reverts
 *   A >= D + G          succeeds: the Trove is consumed whole via `:1252`, a branch with no hint
 *                       check and no floor check
 *
 * **The upper edge is `D + G` and not `D`, and that correction cost a sweep to find.** The first
 * derivation put it at `D`, and a fork measurement appeared to confirm it. That measurement used
 * `simulateContract`, which is an `eth_call` at the current block: no block is mined, so no
 * interest accrues, and `mUSDLot = min(A, totalDebt - GAS_COMP)` is an exact equality. A real send
 * mines a block first, `:366` runs `_updateTroveInterest` on the target, `:1218-1221` then sizes
 * the lot against the LARGER debt, and an offer of exactly `D` arrives as a partial leaving dust.
 *
 * Measured on a fork with only the DELAY varied, from one snapshot
 * (`redeem-boundary.fork.test.ts`):
 *
 *   delay   netDebt    netDebt + margin
 *   0s      success    success
 *   1s      REVERTED   success
 *   600s    REVERTED   success
 *   3600s   REVERTED   REVERTED
 *
 * One second of delay is enough to make the bare net debt fail, and the margin holds for exactly
 * the window it is sized for and not an hour. The zero row is why a simulation cannot see this: it
 * evaluates at the current block, and a transaction lands at least one block later.
 *
 * `G` is 600 seconds of interest on the Trove's PRINCIPAL at the Trove's OWN rate, which is the
 * contract's own allowance for accrual where it bounds a partial hint (`:1276-1285`), rather than
 * a number chosen to feel safe. Overshooting is free: the excess spills to the next Trove, and a
 * cancellation there cannot revert the call because the first Trove was already drawn.
 */
const M = 1_800n * MUSD
const D1 = 2_008n * MUSD
const ENTIRE1 = D1 + GAS_COMP
const HEADROOM = D1 - M // 208 MUSD
const RATE_BPS = 100n

/**
 * The margin recomputed here rather than imported, so a change to either side shows up.
 *
 * **MK-071. The divisor is the CONTRACT's**, `InterestRateMath.SECONDS_IN_A_YEAR = 31_556_952`
 * (`InterestRateMath.sol:9`, 365.2425 days), written out as the literal it is rather than
 * imported from `constants.ts`, so this stays an INDEPENDENT statement of the rule rather than
 * a tautology. It used to read `365n * 24n * 3600n`, which is 31_536_000: the very value
 * `constants.ts:22-23` names as the wrong one, and the same wrong value the source carried. Two
 * copies of one mistake agree, so the assertion could only ever confirm the defect. That is
 * MK-070's shape, in a chain free test.
 *
 * **MK-089. The BASE is the principal**, and this helper took `entireDebt` until the P17 wave,
 * which is the same failure one argument over: the source accrued on the entire debt, this
 * restated it on the entire debt, and the two agreed. Every fixture below now carries a
 * `principal` distinct from its `entireDebt` wherever interest exists, so the base is asserted
 * rather than coincidentally equal. `InterestRateMath.calculateInterestOwed` takes `_principal`
 * (`InterestRateMath.sol:12-22`) and is called with `trove.principal` at
 * `TroveManager.sol:788-793` and `:1236-1241`.
 */
const SECONDS_IN_A_YEAR = 31_556_952n
// **900, not 600** (MK-095). The margin is sized for the read-to-settlement window and a caller
// is told 600; the 300 second difference is the settlement block, which used to be covered by the
// entire-debt base's accidental over-estimate. Written out here rather than imported, for the same
// independence reason as the year above.
const marginOf = (principal: bigint, rateBps = RATE_BPS) =>
  (principal * rateBps * 900n) / (10_000n * SECONDS_IN_A_YEAR)
// The base fixture carries no accrued interest, so principal and entire debt coincide here. The
// cases that separate them live in their own describe block at the bottom of this file.
const G1 = marginOf(ENTIRE1)

const base = {
  globalInterestRateBps: RATE_BPS,
  troveOwnersCount: 42n,
  sortedTrovesSize: 42n,
  canMint: true, // MK-245: a populated system
  musdBalance: 1_000_000n * MUSD,
  minNetDebt: M,
  tcr: 2n * MUSD,
  price: PRICE,
  eligible: [
    {
      owner: '0xaaa' as `0x${string}`,
      entireDebt: ENTIRE1,
      principal: ENTIRE1,
      netDebt: D1,
      interestRateBps: RATE_BPS,
      collateral: 10n ** 21n,
      interestOwed: 0n,
    },
  ],
}

describe('MK-048, the gap the debt floor creates', () => {
  it('a partial at exactly the headroom is viable, and one wei more is not', () => {
    const at = evaluateRedeem({ ...base, amount: HEADROOM })
    const past = evaluateRedeem({ ...base, amount: HEADROOM + 1n })
    expect(at.viable, 'the headroom itself is redeemable').toBe(true)
    expect(at.redeemable).toBe(HEADROOM)
    expect(past.viable, 'one wei past it is not').toBe(false)
    expect(past.bindingConstraint).toBe('PARTIAL_BREACHES_DEBT_FLOOR')
    expect(past.redeemable, 'and nothing would be redeemed, because the call reverts').toBe(0n)
  })

  it('every amount strictly inside the gap is refused, including the net debt itself', () => {
    // `D1` is in this list, not outside it. That is the whole correction.
    for (const a of [HEADROOM + 1n, D1 / 2n, D1 - 1n, D1, D1 + G1 - 1n]) {
      const p = evaluateRedeem({ ...base, amount: a })
      expect(p.viable, `amount ${a}`).toBe(false)
      expect(p.reasons, `amount ${a}`).toContain('PARTIAL_BREACHES_DEBT_FLOOR')
    }
  })

  it('consuming the Trove WHOLE needs the net debt PLUS the accrual margin', () => {
    // `:1252` closes the Trove by redemption and never reaches the cancellation at `:1299`, but
    // only once the offer covers the debt the contract will read at EXECUTION.
    const short = evaluateRedeem({ ...base, amount: D1 })
    const whole = evaluateRedeem({ ...base, amount: D1 + G1 })
    expect(
      short.viable,
      'exactly the net debt read is NOT enough, it accrues before it lands',
    ).toBe(false)
    expect(whole.viable, 'the net debt plus the margin is').toBe(true)
    expect(whole.redeemable, 'and it draws the Trove, not the overshoot').toBe(D1)
  })

  it('the margin is reported, is positive, and is what separates the two edges', () => {
    const p = evaluateRedeem({ ...base, amount: D1 })
    expect(p.accrualMargin, 'a Trove carrying debt accrues something in 600s').toBeGreaterThan(0n)
    expect(p.accrualMargin).toBe(G1)
    expect(p.nextViableAmount - p.firstTroveNetDebt, 'the margin IS the offset').toBe(
      p.accrualMargin,
    )
  })

  it('the preview reports BOTH edges of the gap, which is what a caller acts on', () => {
    const p = evaluateRedeem({ ...base, amount: D1 / 2n })
    expect(p.maxWithoutConsuming, 'the lower edge').toBe(HEADROOM)
    expect(p.nextViableAmount, 'the upper edge').toBe(D1 + G1)
    // Both edges must themselves be viable, or the advice is wrong. This is the assertion the
    // sweep would have needed: the earlier version passed it only because `nextViableAmount` and
    // the loop shared the same wrong idea of where the upper edge was.
    expect(evaluateRedeem({ ...base, amount: p.maxWithoutConsuming }).viable).toBe(true)
    expect(evaluateRedeem({ ...base, amount: p.nextViableAmount }).viable).toBe(true)
  })

  it('a cancel AFTER the first Trove does not revert, it redeems less', () => {
    // `require(totalCollateralDrawn > 0)` (`:406-408`) only fires when NOTHING was drawn. With
    // the first Trove consumed whole, a cancel on the second leaves a successful call.
    const two = {
      ...base,
      eligible: [
        {
          owner: '0xaaa' as `0x${string}`,
          entireDebt: ENTIRE1,
          principal: ENTIRE1,
          netDebt: D1,
          interestRateBps: RATE_BPS,
          collateral: 10n ** 21n,
          interestOwed: 0n,
        },
        {
          owner: '0xbbb' as `0x${string}`,
          entireDebt: ENTIRE1,
          principal: ENTIRE1,
          netDebt: D1,
          interestRateBps: RATE_BPS,
          collateral: 10n ** 21n,
          interestOwed: 0n,
        },
      ],
    }
    const p = evaluateRedeem({ ...two, amount: D1 + G1 + D1 / 2n })
    expect(p.viable, 'the call goes through').toBe(true)
    expect(p.redeemable, 'but it redeems only the first Trove').toBe(D1)
    expect(p.redeemable, 'which is less than requested').toBeLessThan(D1 + G1 + D1 / 2n)
  })

  it('the three contract gates come first, in call order', () => {
    // `:318` TCR, `:319` amount, `:320` balance.
    expect(evaluateRedeem({ ...base, amount: HEADROOM, tcr: MCR - 1n }).bindingConstraint).toBe(
      'SYSTEM_TCR_BELOW_MCR',
    )
    expect(evaluateRedeem({ ...base, amount: 0n }).reasons).toContain('AMOUNT_ZERO')
    expect(evaluateRedeem({ ...base, amount: HEADROOM, musdBalance: 1n }).reasons).toContain(
      'INSUFFICIENT_MUSD_BALANCE',
    )
  })

  it('no eligible Trove is reported rather than guessed at', () => {
    const p = evaluateRedeem({ ...base, amount: HEADROOM, eligible: [] })
    expect(p.reasons).toContain('NOTHING_REDEEMABLE')
    expect(p.firstEligibleTrove).toBeNull()
    expect(p.maxWithoutConsuming).toBe(0n)
    expect(p.nextViableAmount, 'and no edge is invented for a list that is empty').toBe(0n)
    expect(p.accrualMargin).toBe(0n)
  })

  it('a Trove already at the floor has zero headroom, so only whole consumption works', () => {
    const entire = M + GAS_COMP
    const atFloor = {
      ...base,
      eligible: [
        {
          owner: '0xaaa' as `0x${string}`,
          entireDebt: entire,
          principal: entire,
          netDebt: M,
          interestRateBps: RATE_BPS,
          collateral: 10n ** 21n,
          interestOwed: 0n,
        },
      ],
    }
    const g = marginOf(entire)
    expect(evaluateRedeem({ ...atFloor, amount: 1n }).viable, '1 wei is refused').toBe(false)
    expect(
      evaluateRedeem({ ...atFloor, amount: M }).viable,
      'and so is the net debt, for the same accrual reason',
    ).toBe(false)
    expect(
      evaluateRedeem({ ...atFloor, amount: M + g }).viable,
      'only the net debt plus the margin works',
    ).toBe(true)
    expect(evaluateRedeem({ ...atFloor, amount: 1n }).maxWithoutConsuming).toBe(0n)
  })
})

/**
 * The WRITE half of MK-048's precheck, chain free.
 *
 * **Why this exists is worth reading, because it is a coverage lesson rather than a new rule.**
 * `redeem`'s throw at `redemption/redeem.ts:172-178` and `RedemptionBreachesDebtFloor`'s populated
 * message at `errors/index.ts:288-304` were covered only by the differential sweep, and only when
 * its generator happened to produce a redemption case in the `IN_THE_GAP` band inside the 24 case
 * push subset. Adding the Recovery Mode dimension (MK-058) shifted the generator's PRNG stream,
 * that case stopped being drawn, and the coverage ratchet went from 98.5 to 97.83 with no change
 * to either file.
 *
 * **Coverage that depends on which cases a seeded generator happens to draw is a lottery ticket,
 * not a gate.** The fix is not to restore the draw. It is to cover the path deterministically here
 * and let the sweep go on proving what only a sweep can prove.
 */
describe('MK-048, the precheck as a typed throw rather than a revert', () => {
  const ZERO = '0x0000000000000000000000000000000000000000' as const
  const OWNER = '0x000000000000000000000000000000000000dEaD' as const
  const T = getAddresses(31611)

  /** A chain holding exactly one eligible Trove, the fixture the evaluator tests above use. */
  function writeDeps(): WriteDeps {
    const answers: Record<string, unknown> = {
      fetchPrice: PRICE,
      getTCR: 2n * MUSD,
      balanceOf: 1_000_000n * MUSD,
      getTroveInterestRate: Number(RATE_BPS),
      // MK-103. The global rate the contract's partial hint band uses.
      interestRate: Number(RATE_BPS),
      getLast: '0x00000000000000000000000000000000000000aa',
      getPrev: ZERO,
      getCurrentICR: 2n * MUSD,
      getEntireDebtAndColl: [10n * MUSD, ENTIRE1, 0n, 0n, 0n, 0n],
      redemptionRate: 7_500_000_000_000_000n,
      // MK-245. The last Trove rule's counts and flag: a populated system.
      getTroveOwnersCount: 42n,
      getSize: 42n,
      mintList: true,
    }
    const publicClient = {
      readContract: async ({ functionName }: { functionName: string }) => {
        if (!(functionName in answers)) throw new Error(`unstubbed read: ${functionName}`)
        return answers[functionName]
      },
      simulateContract: async () => {
        throw new Error('reached simulate: the precheck did not fire')
      },
    } as unknown as PublicClient
    return {
      publicClient,
      walletClient: {
        account: { address: OWNER, type: 'json-rpc' },
        writeContract: async () => '0xhash',
      } as unknown as WalletClient,
      addresses: T,
      ensureVerified: async () => {},
      getMinNetDebt: async () => M,
      isAccountFeeExempt: async () => false,
      gasMarginPercent: 0,
    }
  }

  it('an amount in the gap is refused BEFORE simulate, with the two edges on the error', async () => {
    // One wei past the headroom is the first amount in the gap (`TroveManager.sol:1299-1306`).
    const error = await redeem(writeDeps(), { amount: HEADROOM + 1n }).catch((e) => e)
    expect(error).toBeInstanceOf(RedemptionBreachesDebtFloor)
    expect(error.code).toBe('REDEMPTION_BREACHES_DEBT_FLOOR')
    // The populated message, not the bare one: both edges are known here, and a caller needs
    // them because the gap has no smaller amount that works, only a larger one.
    expect(error.message).toContain(String(HEADROOM))
    expect(error.message).toContain(String(D1 + G1))
    expect(error.context).toMatchObject({
      requested: HEADROOM + 1n,
      maxWithoutConsuming: HEADROOM,
      nextViableAmount: D1 + G1,
    })
  })

  it('and the bare message is what you get when the edges are not known', () => {
    // The other arm of the same constructor: a caller who builds this error without the figures
    // still gets a sentence that says what happened rather than an empty one.
    const bare = new RedemptionBreachesDebtFloor()
    expect(bare.message).toContain('minimum net debt')
    expect(bare.message).not.toContain('undefined')
    expect(bare.context).toBeUndefined()
  })

  it('an amount inside the headroom is NOT refused by this precheck', async () => {
    // The negative case, so the assertion above is about the gap and not about the precheck
    // firing on everything. It reaches simulate, which the fake refuses loudly.
    const error = await redeem(writeDeps(), { amount: HEADROOM / 2n }).catch((e) => e)
    expect(error).not.toBeInstanceOf(RedemptionBreachesDebtFloor)
  })
})

/**
 * MK-088 and MK-089. The two inputs the margin was getting from the wrong place.
 *
 * Neither could be seen from the fixtures above, and that is the point of putting them here.
 * Every fixture in this file carried `principal === entireDebt` (no accrued interest) and one
 * rate for the whole walk, so the source could read either quantity and agree with the test.
 * Two copies of one mistake agree; the cases below separate the quantities so they cannot.
 */
describe('MK-088, MK-089, the accrual margin is sized per Trove and on the principal', () => {
  const RATE_500 = 500n

  /** Principal 2,000 + 200 gas, with 8 MUSD of interest already accrued on top. */
  const PRINCIPAL = 2_200n * MUSD
  const INTEREST = 8n * MUSD
  const ENTIRE = PRINCIPAL + INTEREST
  const NET = ENTIRE - GAS_COMP

  const troveAt = (rateBps: bigint) => ({
    owner: '0xaaa' as `0x${string}`,
    entireDebt: ENTIRE,
    principal: PRINCIPAL,
    netDebt: NET,
    interestRateBps: rateBps,
    collateral: 10n ** 21n,
    interestOwed: 0n,
  })

  it('the base is the PRINCIPAL, not the entire debt', () => {
    const p = evaluateRedeem({ ...base, amount: 1n, eligible: [troveAt(RATE_BPS)] })
    // `InterestRateMath.calculateInterestOwed(trove.principal, ...)`, `:1236-1241`. Accrued
    // interest is not part of the base, so interest does not compound.
    expect(p.accrualMargin).toBe(marginOf(PRINCIPAL))
    expect(p.accrualMargin, 'and it is NOT the entire debt figure').not.toBe(marginOf(ENTIRE))
  })

  it("the rate is the TARGET Trove's, so a five times rate is a five times margin", () => {
    const slow = evaluateRedeem({ ...base, amount: 1n, eligible: [troveAt(RATE_BPS)] })
    const fast = evaluateRedeem({ ...base, amount: 1n, eligible: [troveAt(RATE_500)] })

    expect(slow.accrualMargin).toBe(marginOf(PRINCIPAL, RATE_BPS))
    expect(fast.accrualMargin).toBe(marginOf(PRINCIPAL, RATE_500))
    // The old shape read one rate off the REDEEMER's Trove and applied it to every target, with
    // a hardcoded 100 when the redeemer held none. Under-sizing is the dangerous direction: the
    // offer arrives as a partial, `:1299-1306` cancels it, `:392` breaks and `:406-408` reverts.
    expect(fast.accrualMargin).toBeGreaterThan(slow.accrualMargin)
    expect(fast.nextViableAmount).toBeGreaterThan(slow.nextViableAmount)
  })

  it('an amount sized at 100 bps is REFUSED against a Trove that carries 500', () => {
    // This is the defect's consequence, stated as a single call. The old shape read one rate off
    // the REDEEMER's Trove, or fell back to a hardcoded 100 when the redeemer held none, which is
    // the ordinary case for an arbitrageur. Offer the upper edge that rate produces against a
    // Trove accruing five times faster and it arrives as a partial: `:1218-1221` sizes the lot
    // against the larger debt, the remainder is under the floor, `:1299-1306` cancels, `:392`
    // breaks and `:406-408` reverts because nothing was drawn.
    const sizedAt100 = NET + marginOf(PRINCIPAL, RATE_BPS)
    const against500 = evaluateRedeem({
      ...base,
      amount: sizedAt100,
      eligible: [troveAt(RATE_500)],
    })

    expect(against500.viable, 'the under-sized offer is refused').toBe(false)
    expect(against500.bindingConstraint).toBe('PARTIAL_BREACHES_DEBT_FLOOR')
    // And the figure the preview now reports for that Trove does work.
    expect(
      evaluateRedeem({
        ...base,
        amount: against500.nextViableAmount,
        eligible: [troveAt(RATE_500)],
      }).viable,
    ).toBe(true)
  })

  it('each Trove in the walk gets its OWN margin, not the first one applied to all', () => {
    // A cheap first Trove and an expensive second. The `consumesWhole` split at each step uses
    // that step's own numbers, so the overshoot left by the first spills into the second as an
    // ordinary partial rather than being measured against the wrong margin.
    const mixed = {
      ...base,
      eligible: [troveAt(RATE_BPS), { ...troveAt(RATE_500), owner: '0xbbb' as `0x${string}` }],
    }
    const firstWhole = NET + marginOf(PRINCIPAL, RATE_BPS)
    const bothWhole = firstWhole + NET + marginOf(PRINCIPAL, RATE_500)

    // The first Trove is consumed whole and the leftover margin is a valid partial on the second,
    // so the whole offer is drawn.
    expect(evaluateRedeem({ ...mixed, amount: firstWhole }).redeemable).toBe(firstWhole)
    // Enough for both, and the overshoot beyond the second Trove is simply not drawn.
    expect(evaluateRedeem({ ...mixed, amount: bothWhole }).redeemable).toBe(2n * NET)

    // **The discriminating case.** Enough to consume the first Trove whole and then offer the
    // second its bare net debt plus the FIRST Trove's margin, which is a fifth of what the
    // second actually accrues. The second must arrive as a partial and cancel, drawing nothing,
    // so only the first Trove is redeemed. Sizing the second step from the first Trove's rate,
    // which is what one shared rate did, would consume both.
    const sizedWithTheWrongMargin = firstWhole + NET
    expect(evaluateRedeem({ ...mixed, amount: sizedWithTheWrongMargin }).redeemable).toBe(NET)
  })

  it('a zero rate accrues nothing, so the upper edge is the bare net debt', () => {
    const p = evaluateRedeem({ ...base, amount: 1n, eligible: [troveAt(0n)] })
    expect(p.accrualMargin).toBe(0n)
    expect(p.nextViableAmount).toBe(NET)
  })
})
