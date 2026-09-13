import type { PublicClient } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  BORROWING_POWER_MARGIN_WINDOW_SECONDS,
  BORROWING_POWER_PRICE_MOVE_BPS,
  CCR,
  InvalidAmount,
  MCR,
  evaluateOpen,
  getAddresses,
  getBorrowingPower,
} from '../src'
import type { MathDeps } from '../src/math/deps'

/**
 * `getBorrowingPower` and `previewOpen` must agree, in both modes and for an exempt account.
 *
 * **This is the pin `docs/08-conventions.md` §11 asks for and nobody wrote** (MK-067, MK-069).
 * The two answer the same question from opposite ends: `previewOpen` says whether a candidate
 * draw opens, `getBorrowingPower` says which draw is the largest that does. So for any state,
 * the maximum must be viable and one wei more must not, and any disagreement is a defect in one
 * of them. MK-067 was exactly that disagreement: `getBorrowingPower` subtracted a borrowing fee
 * the contract skips in Recovery Mode and for an exempt account, so its answer came back short
 * by the fee while `previewOpen` called the larger draw viable.
 *
 * `previewBorrow` could be fixed by projecting `previewAdjustTrove` outright, because a borrow
 * IS an adjustment. A maximum is not a case of the evaluator that answers a candidate, so this
 * pair cannot be collapsed the same way. **What replaces the collapse is this file**: the
 * solver's feasibility predicate is now `evaluateOpen`, and the assertion below is what keeps
 * it that way. It fails the moment anyone puts an open rule back into `getBorrowingPower`.
 *
 * The expected side deliberately restates the CONTRACT's fee condition,
 * `!isRecoveryMode && !isAccountFeeExempt(borrower)` (`BorrowerOperations.sol:637-643`), rather
 * than importing `isBorrowingFeeCharged`. Importing it would make the fee half of this test a
 * tautology, which is the mistake `phase4.fork.test.ts` made with the whole rule (MK-070).
 *
 * Runs in the `unit` project: no globalSetup, no anvil, no RPC URL.
 */

const E18 = 10n ** 18n
const T = getAddresses(31611)
const RATE = 10n ** 15n // borrowingRate, 0.1 percent, the live value
const MIN_NET_DEBT = 1_800n * E18
const ACCOUNT = '0x000000000000000000000000000000000000dEaD' as const
/** `interestRateManager.interestRate()`, in basis points, as the stub answers it. */
const INTEREST_RATE_BPS = 100n
/** `InterestRateMath.SECONDS_IN_A_YEAR` (`InterestRateMath.sol:9`), written out rather than imported. */
const SECONDS_PER_YEAR = 31_556_952n

interface Scenario {
  label: string
  price: bigint
  collateral: bigint
  systemColl: bigint
  systemDebt: bigint
  isRecoveryMode: boolean
  feeExempt: boolean
}

/** A client that answers only what `getBorrowingPower` asks, and throws on anything else. */
function fakeDeps(s: Scenario): MathDeps {
  const answers: Record<string, unknown> = {
    borrowingRate: RATE,
    DECIMAL_PRECISION: E18,
    getEntireSystemColl: s.systemColl,
    getEntireSystemDebt: s.systemDebt,
    fetchPrice: s.price,
    checkRecoveryMode: s.isRecoveryMode,
    interestRate: INTEREST_RATE_BPS,
  }
  const publicClient = {
    readContract: async ({
      functionName,
      args,
    }: { functionName: string; args?: readonly unknown[] }) => {
      // The contract's own fee, linear at the live rate, floored. Asked for unconditionally
      // here: whether it is APPLIED is the thing under test, so the stub must not decide it.
      if (functionName === 'getBorrowingFee') return (RATE * (args?.[0] as bigint)) / E18
      if (!(functionName in answers)) throw new Error(`unstubbed read: ${functionName}`)
      return answers[functionName]
    },
    multicall: async ({ contracts }: { contracts: { functionName: string }[] }) =>
      contracts.map((c) => {
        if (!(c.functionName in answers)) throw new Error(`unstubbed multicall: ${c.functionName}`)
        return answers[c.functionName]
      }),
  } as unknown as PublicClient
  return {
    publicClient,
    addresses: T,
    getMinNetDebt: async () => MIN_NET_DEBT,
    isAccountFeeExempt: async () => s.feeExempt,
  }
}

/**
 * `previewOpen`'s verdict for one candidate draw in this scenario.
 *
 * The fee is the contract's condition written out, not imported, for the reason in the file
 * header.
 */
function opens(s: Scenario, draw: bigint, atPrice = s.price): ReturnType<typeof evaluateOpen> {
  const chargesFee = !s.isRecoveryMode && !s.feeExempt
  return evaluateOpen({
    collateral: s.collateral,
    debt: draw,
    fee: chargesFee ? (RATE * draw) / E18 : 0n,
    feeExempt: s.feeExempt,
    minNetDebt: MIN_NET_DEBT,
    isRecoveryMode: s.isRecoveryMode,
    price: atPrice,
    systemColl: s.systemColl,
    systemDebt: s.systemDebt,
    troveStatus: undefined,
  })
}

/**
 * The stressed price the recommended figure must clear, restated from its definition rather than
 * read off the result (MK-100): the price after a fall of `BORROWING_POWER_PRICE_MOVE_BPS`, divided
 * by one plus `BORROWING_POWER_MARGIN_WINDOW_SECONDS` of interest at the rate, rounded up.
 */
function stressedPrice(
  price: bigint,
  priceMoveBps = BORROWING_POWER_PRICE_MOVE_BPS,
  windowSeconds = BORROWING_POWER_MARGIN_WINDOW_SECONDS,
): bigint {
  const denominator = 10_000n * SECONDS_PER_YEAR
  const accrual = (INTEREST_RATE_BPS * windowSeconds * E18 + denominator - 1n) / denominator
  return (price * (10_000n - priceMoveBps) * E18) / (10_000n * (E18 + accrual))
}

/**
 * A roomy system, so the individual ratio binds, and a tight one, so the resulting TCR does.
 * Both matter: the TCR condition exists only in normal mode (`BorrowerOperations.sol:656-665`),
 * and a maximum solved against the wrong one of the two is wrong in only one of them.
 */
const ROOMY = { systemColl: 10_000n * E18, systemDebt: 100_000_000n * E18 }
/** TCR just above CCR at 100k, so a large new open pulls the system down to the boundary. */
const TIGHT = { systemColl: 1_600n * E18, systemDebt: 100_000_000n * E18 }
/** TCR below CCR at 100k, which is what Recovery Mode IS. */
const UNDER_CCR = { systemColl: 1_000n * E18, systemDebt: 100_000_000n * E18 }

const scenarios: Scenario[] = [
  {
    label: 'normal mode, ICR binds',
    price: 100_000n * E18,
    collateral: E18,
    ...ROOMY,
    isRecoveryMode: false,
    feeExempt: false,
  },
  {
    label: 'normal mode, resulting TCR binds',
    price: 100_000n * E18,
    collateral: 500n * E18,
    ...TIGHT,
    isRecoveryMode: false,
    feeExempt: false,
  },
  {
    label: 'normal mode, FEE EXEMPT account',
    price: 100_000n * E18,
    collateral: E18,
    ...ROOMY,
    isRecoveryMode: false,
    feeExempt: true,
  },
  {
    label: 'normal mode, fee exempt AND the TCR binds',
    price: 100_000n * E18,
    collateral: 500n * E18,
    ...TIGHT,
    isRecoveryMode: false,
    feeExempt: true,
  },
  {
    label: 'RECOVERY MODE, the CCR threshold binds',
    price: 100_000n * E18,
    collateral: E18,
    ...UNDER_CCR,
    isRecoveryMode: true,
    feeExempt: false,
  },
  {
    label: 'RECOVERY MODE, exempt account, which changes nothing because the fee is already zero',
    price: 100_000n * E18,
    collateral: E18,
    ...UNDER_CCR,
    isRecoveryMode: true,
    feeExempt: true,
  },
  {
    label: 'normal mode, an awkward price and a small position',
    price: 77_051_107_320_000_000_000_000n,
    collateral: 5n * 10n ** 16n,
    ...ROOMY,
    isRecoveryMode: false,
    feeExempt: false,
  },
  {
    label: 'RECOVERY MODE, an awkward price',
    price: 77_051_107_320_000_000_000_000n,
    collateral: 3n * 10n ** 17n,
    ...UNDER_CCR,
    isRecoveryMode: true,
    feeExempt: false,
  },
]

describe('getBorrowingPower and previewOpen answer the same question the same way', () => {
  for (const s of scenarios) {
    it(`${s.label}: the ceiling opens, and one wei more does not`, async () => {
      const account = s.feeExempt ? ACCOUNT : undefined
      const { ceiling: max } = await getBorrowingPower(fakeDeps(s), {
        collateral: s.collateral,
        price: s.price,
        ...(account !== undefined ? { account } : {}),
      })
      expect(max, 'a maximum of zero would make the boundary assertions vacuous').toBeGreaterThan(
        0n,
      )

      const at = opens(s, max)
      expect(
        at.viable,
        `previewOpen refuses the reported maximum: ${JSON.stringify(at.reasons)}`,
      ).toBe(true)

      const over = opens(s, max + 1n)
      expect(over.viable, 'one wei above the maximum must NOT open').toBe(false)
    })

    /**
     * MK-100. The recommended figure is the same boundary, at the stressed price: it clears every
     * open gate AFTER the stated fall and accrual, and one wei more does not. That is the whole
     * content of the margin, so it is pinned as a boundary rather than as "smaller than the ceiling",
     * which a margin of any size would satisfy.
     */
    it(`${s.label}: the recommended figure is the boundary at the stressed price`, async () => {
      const account = s.feeExempt ? ACCOUNT : undefined
      const power = await getBorrowingPower(fakeDeps(s), {
        collateral: s.collateral,
        price: s.price,
        ...(account !== undefined ? { account } : {}),
      })
      const stressed = stressedPrice(s.price)
      expect(power.margin.stressedPrice, 'the reported stressed price').toBe(stressed)
      expect(power.margin.windowSeconds).toBe(BORROWING_POWER_MARGIN_WINDOW_SECONDS)
      expect(power.margin.priceMoveBps).toBe(BORROWING_POWER_PRICE_MOVE_BPS)
      expect(power.margin.interestRateBps).toBe(INTEREST_RATE_BPS)
      expect(power.recommended, 'a zero would make this vacuous').toBeGreaterThan(0n)
      expect(power.recommended).toBeLessThan(power.ceiling)
      const at = opens(s, power.recommended, stressed)
      expect(at.viable, `refused at the stressed price: ${JSON.stringify(at.reasons)}`).toBe(true)
      expect(opens(s, power.recommended + 1n, stressed).viable, 'one wei more at stress').toBe(
        false,
      )
      // And the ICR it reports is the one a Trove opened at it starts at, at the real price.
      expect(power.recommendedIcr).toBe(opens(s, power.recommended).icr)
      expect(power.ceilingIcr).toBe(opens(s, power.ceiling).icr)
    })
  }

  /**
   * The constants are a measurement, and this is the floor the measurement sets (MK-100).
   *
   * `scripts/oracle-moves.ts --end 11823000 --days 7 --step 16` over Mezo mainnet put the worst fall
   * inside any sampled hour at 190.78 bps. A price move constant under that no longer covers the
   * measured week, and a window under an hour no longer covers the delay the fork proof asserts, so
   * either change must come with a new measurement rather than slip in as an edit. Every other test
   * here imports the constants, so without this one they could be lowered with nothing going red.
   */
  /**
   * The margin is the caller's to widen or narrow, and the result always says which margin it holds:
   * a flow slower than the measured hour needs more, an immediate send may take less. Each override
   * is pinned as the same boundary the default is pinned as, at ITS stressed price, so an override
   * that was accepted and then ignored, or applied to one half of the stress and not the other, goes
   * red rather than returning the default under the caller's numbers.
   */
  it('MK-100: an overridden margin is reported, and recommended is the boundary at its stressed price', async () => {
    const s = scenarios[0] as Scenario
    const base = await getBorrowingPower(fakeDeps(s), { collateral: s.collateral, price: s.price })
    for (const [priceMoveBps, marginWindowSeconds] of [
      [500n, 86_400n],
      [50n, 60n],
      [0n, 3600n],
      [200n, 0n],
    ] as const) {
      const label = `priceMoveBps=${priceMoveBps} marginWindowSeconds=${marginWindowSeconds}`
      const power = await getBorrowingPower(fakeDeps(s), {
        collateral: s.collateral,
        price: s.price,
        priceMoveBps,
        marginWindowSeconds,
      })
      const stressed = stressedPrice(s.price, priceMoveBps, marginWindowSeconds)
      expect(power.margin.priceMoveBps, label).toBe(priceMoveBps)
      expect(power.margin.windowSeconds, label).toBe(marginWindowSeconds)
      expect(power.margin.stressedPrice, label).toBe(stressed)
      expect(power.ceiling, `${label}: the ceiling does not depend on the margin`).toBe(
        base.ceiling,
      )
      expect(opens(s, power.recommended, stressed).viable, label).toBe(true)
      expect(opens(s, power.recommended + 1n, stressed).viable, label).toBe(false)
    }
    const wider = await getBorrowingPower(fakeDeps(s), {
      collateral: s.collateral,
      price: s.price,
      priceMoveBps: 500n,
    })
    const narrower = await getBorrowingPower(fakeDeps(s), {
      collateral: s.collateral,
      price: s.price,
      priceMoveBps: 50n,
    })
    expect(wider.recommended, 'a wider margin offers less').toBeLessThan(base.recommended)
    expect(narrower.recommended, 'a narrower margin offers more').toBeGreaterThan(base.recommended)
    expect(narrower.recommended).toBeLessThan(base.ceiling)
  })

  /**
   * An override outside its range is refused before any read. A negative one would lift the stressed
   * price above the real one, and the clamp to the ceiling would then return the liquidation
   * threshold under the name `recommended`, which is the defect MK-100 exists to prevent.
   */
  it('MK-100: an override outside its range is refused before the chain is asked anything', async () => {
    const s = scenarios[0] as Scenario
    for (const bad of [
      { priceMoveBps: -1n },
      { priceMoveBps: 10_000n },
      { priceMoveBps: 20_000n },
      { marginWindowSeconds: -1n },
    ]) {
      const { deps, calls } = countingDeps(s)
      const error = await getBorrowingPower(deps, { collateral: s.collateral, ...bad }).catch(
        (e: unknown) => e,
      )
      expect(
        error,
        JSON.stringify(bad, (_, v) => (typeof v === 'bigint' ? `${v}` : v)),
      ).toBeInstanceOf(InvalidAmount)
      expect(calls, 'no read before the refusal').toEqual([])
    }
  })

  it('MK-100: the margin constants cover the measured worst hour', () => {
    expect(BORROWING_POWER_PRICE_MOVE_BPS).toBeGreaterThanOrEqual(191n)
    expect(BORROWING_POWER_MARGIN_WINDOW_SECONDS).toBeGreaterThanOrEqual(3600n)
  })

  /**
   * With no price move and no window the stressed price IS the price, so the two figures must be
   * the same number. A recommended figure that differed here would carry a margin nobody asked for.
   */
  it('MK-100: a zero margin makes recommended equal to the ceiling', async () => {
    for (const s of scenarios) {
      const power = await getBorrowingPower(fakeDeps(s), {
        collateral: s.collateral,
        price: s.price,
        priceMoveBps: 0n,
        marginWindowSeconds: 0n,
        ...(s.feeExempt ? { account: ACCOUNT } : {}),
      })
      expect(power.margin.stressedPrice, s.label).toBe(s.price)
      expect(power.recommended, s.label).toBe(power.ceiling)
    }
  })

  /**
   * The margin in ICR terms, at the live constants: a Trove opened at the recommended figure in
   * normal mode, with the individual ratio binding, starts at least `MCR * price / stressedPrice`,
   * which is MCR plus roughly the price move. Stated as a band so a margin that grew or shrank
   * without the constant changing goes red.
   */
  it('MK-100: in normal mode the recommended figure opens about BORROWING_POWER_PRICE_MOVE_BPS above MCR', async () => {
    const s = scenarios[0] as Scenario
    const power = await getBorrowingPower(fakeDeps(s), { collateral: s.collateral, price: s.price })
    const floor = (MCR * s.price) / stressedPrice(s.price)
    expect(power.recommendedIcr).toBeGreaterThanOrEqual(floor)
    // One percent of MCR above the floor is far more than the few wei the solver lands within.
    expect(power.recommendedIcr - floor).toBeLessThan(MCR / 10_000n)
    expect(power.ceilingIcr - MCR).toBeLessThan(10n ** 6n)
  })

  /**
   * MK-067 directly: the Recovery Mode answer must not have a fee subtracted from it.
   *
   * Stated as an equality against the closed form the contract implies rather than as an
   * inequality, because "larger than it used to be" would pass for any change in the right
   * direction. In Recovery Mode the contract charges nothing, so the entire debt is
   * `draw + 200` and the ceiling is `coll * price / CCR`.
   */
  it('MK-067: in Recovery Mode the maximum is the full CCR ceiling, with no fee taken out', async () => {
    const s = scenarios.find((x) => x.isRecoveryMode && !x.feeExempt) as Scenario
    const { ceiling: max } = await getBorrowingPower(fakeDeps(s), {
      collateral: s.collateral,
      price: s.price,
    })
    expect(max).toBe((s.collateral * s.price) / CCR - 200n * E18)
  })

  /**
   * And the same for an exempt account in NORMAL mode, which is the half of MK-067 that a mode
   * check alone would not have fixed: the ceiling there is MCR rather than CCR, and the fee is
   * skipped for the account rather than for the system.
   */
  it('MK-067: for a fee exempt account in normal mode the maximum is the full MCR ceiling', async () => {
    const s: Scenario = {
      label: 'exempt, roomy',
      price: 100_000n * E18,
      collateral: E18,
      ...ROOMY,
      isRecoveryMode: false,
      feeExempt: true,
    }
    const { ceiling: max } = await getBorrowingPower(fakeDeps(s), {
      collateral: s.collateral,
      price: s.price,
      account: ACCOUNT,
    })
    expect(max).toBe((s.collateral * s.price) / MCR - 200n * E18)
  })

  /**
   * Exemption is only asked about when there is an account to ask about, matching
   * `previewOpen`'s rule (MK-018): with none, the answer assumes not exempt and is the same
   * number a non exempt caller gets.
   */
  it('MK-067: with no account the answer is the not-exempt answer, and the read is skipped', async () => {
    const s: Scenario = {
      label: 'exempt on chain, but nobody asked',
      price: 100_000n * E18,
      collateral: E18,
      ...ROOMY,
      isRecoveryMode: false,
      feeExempt: true,
    }
    let exemptReads = 0
    const deps = fakeDeps(s)
    const withCount: MathDeps = {
      ...deps,
      isAccountFeeExempt: async () => {
        exemptReads += 1
        return true
      },
    }
    const { ceiling: max } = await getBorrowingPower(withCount, {
      collateral: s.collateral,
      price: s.price,
    })
    expect(exemptReads, 'nobody to ask about, so nothing is asked').toBe(0)
    // The not-exempt maximum: the fee is charged, so it eats into the same MCR ceiling.
    const notExempt: Scenario = { ...s, feeExempt: false }
    expect(opens(notExempt, max).viable).toBe(true)
    expect(opens(notExempt, max + 1n).viable).toBe(false)
  })

  /**
   * In Recovery Mode the mode alone settles the fee, so the exemption read is a round trip that
   * cannot change the answer and is not made.
   */
  it('MK-067: in Recovery Mode the exemption is not read, because the mode already settles it', async () => {
    const s = scenarios.find((x) => x.isRecoveryMode && !x.feeExempt) as Scenario
    let exemptReads = 0
    const deps = fakeDeps(s)
    const withCount: MathDeps = {
      ...deps,
      isAccountFeeExempt: async () => {
        exemptReads += 1
        return false
      },
    }
    await getBorrowingPower(withCount, {
      collateral: s.collateral,
      price: s.price,
      account: ACCOUNT,
    })
    expect(exemptReads).toBe(0)
  })
})

/**
 * MK-092. The published COST, counted rather than asserted.
 *
 * `getBorrowingPower`'s docstring names a number of round trips, and that number was wrong for
 * two waves: it said "three round trips, or four when an `account` is supplied" and claimed
 * "Every chain read happens in ONE `multicall`", while the code issued six reads and had
 * `fetchPrice` and `checkRecoveryMode` outside the batch. `docs/08-conventions.md` §10 makes a
 * measurement citable only when the code that produced it is in the repository, and a published
 * figure with nothing executing it is exactly the shape MK-039 and MK-081 were.
 *
 * A round trip here is one `multicall` or one `readContract`. `getMinNetDebt` counts as one. A
 * real client serves it from the TTL cache (`createMusdClient.ts`), so a warm client pays less
 * than these figures; a COLD client pays more, because its first `getConstants` also runs the
 * deployment verification multicall and the two constants reads. Those are shared across every
 * call the SDK makes and are deliberately not attributed to this function.
 */
function countingDeps(s: Scenario): { deps: MathDeps; calls: string[] } {
  const calls: string[] = []
  const inner = fakeDeps(s)
  const publicClient = {
    readContract: (args: { functionName: string; args?: readonly unknown[] }) => {
      calls.push(args.functionName)
      return (
        inner.publicClient as unknown as { readContract: (a: unknown) => Promise<unknown> }
      ).readContract(args)
    },
    multicall: (args: { contracts: { functionName: string }[] }) => {
      calls.push(`multicall(${args.contracts.map((c) => c.functionName).join(',')})`)
      return (
        inner.publicClient as unknown as { multicall: (a: unknown) => Promise<unknown> }
      ).multicall(args)
    },
  } as unknown as PublicClient
  return {
    calls,
    deps: {
      ...inner,
      publicClient,
      getMinNetDebt: async () => {
        calls.push('minNetDebt')
        return MIN_NET_DEBT
      },
      isAccountFeeExempt: async (a) => {
        calls.push('isAccountFeeExempt')
        return inner.isAccountFeeExempt(a)
      },
    },
  }
}

describe('MK-092, the round trips getBorrowingPower actually makes', () => {
  const NORMAL: Scenario = {
    label: 'normal',
    price: 100_000n * E18,
    collateral: E18,
    ...ROOMY,
    isRecoveryMode: false,
    feeExempt: false,
  }

  it('normal mode, no account: FOUR, and the price rides in the batch', async () => {
    const { deps, calls } = countingDeps(NORMAL)
    await getBorrowingPower(deps, { collateral: E18 })
    expect(calls).toEqual([
      'multicall(borrowingRate,DECIMAL_PRECISION,getEntireSystemColl,getEntireSystemDebt,interestRate,fetchPrice)',
      'checkRecoveryMode',
      'minNetDebt',
      // ONE fee read, not two: the confirmation figure is kept rather than re-fetched, and the
      // recommended figure reuses the linearity that one read confirmed (MK-100).
      'getBorrowingFee',
    ])
  })

  it('normal mode, with an account: FIVE, the extra one being the exemption', async () => {
    const { deps, calls } = countingDeps(NORMAL)
    await getBorrowingPower(deps, { collateral: E18, account: ACCOUNT })
    expect(calls).toContain('isAccountFeeExempt')
    expect(calls.filter((c) => c.startsWith('multicall'))).toHaveLength(1)
    expect(calls).toHaveLength(5)
  })

  it('Recovery Mode, no account: THREE, because no fee is charged so none is quoted', async () => {
    const { deps, calls } = countingDeps({ ...NORMAL, isRecoveryMode: true })
    await getBorrowingPower(deps, { collateral: E18 })
    expect(calls).not.toContain('getBorrowingFee')
    expect(calls).not.toContain('isAccountFeeExempt')
    expect(calls).toHaveLength(3)
  })

  it('a supplied price keeps fetchPrice out of the batch and costs nothing extra', async () => {
    const { deps, calls } = countingDeps(NORMAL)
    await getBorrowingPower(deps, { collateral: E18, price: NORMAL.price })
    expect(calls[0]).toBe(
      'multicall(borrowingRate,DECIMAL_PRECISION,getEntireSystemColl,getEntireSystemDebt,interestRate)',
    )
    expect(calls).toHaveLength(4)
  })

  it('getBorrowingFee is asked at most ONCE on the closed form path', async () => {
    const { deps, calls } = countingDeps(NORMAL)
    await getBorrowingPower(deps, { collateral: E18 })
    expect(calls.filter((c) => c === 'getBorrowingFee')).toHaveLength(1)
  })
})
