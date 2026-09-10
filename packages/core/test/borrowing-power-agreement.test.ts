import type { PublicClient } from 'viem'
import { describe, expect, it } from 'vitest'
import { CCR, MCR, evaluateOpen, getAddresses, getBorrowingPower } from '../src'
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
function opens(s: Scenario, draw: bigint): ReturnType<typeof evaluateOpen> {
  const chargesFee = !s.isRecoveryMode && !s.feeExempt
  return evaluateOpen({
    collateral: s.collateral,
    debt: draw,
    fee: chargesFee ? (RATE * draw) / E18 : 0n,
    feeExempt: s.feeExempt,
    minNetDebt: MIN_NET_DEBT,
    isRecoveryMode: s.isRecoveryMode,
    price: s.price,
    systemColl: s.systemColl,
    systemDebt: s.systemDebt,
    troveStatus: undefined,
  })
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
    it(`${s.label}: the maximum opens, and one wei more does not`, async () => {
      const account = s.feeExempt ? ACCOUNT : undefined
      const max = await getBorrowingPower(fakeDeps(s), {
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
  }

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
    const max = await getBorrowingPower(fakeDeps(s), {
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
    const max = await getBorrowingPower(fakeDeps(s), {
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
    const max = await getBorrowingPower(withCount, { collateral: s.collateral, price: s.price })
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
