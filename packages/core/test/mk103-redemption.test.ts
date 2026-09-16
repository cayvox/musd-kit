import type { PublicClient, WalletClient } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  type EligibleTrove,
  REDEMPTION_ADVICE_MARGIN_SECONDS,
  REDEMPTION_PRICE_MOVE_TOLERANCE,
  REDEMPTION_SEND_MARGIN_SECONDS,
  RedemptionPriceFragile,
  evaluateRedeem,
  getAddresses,
  partialRedemptionBand,
  previewRedeem,
} from '../src'
import type { WriteDeps } from '../src/internal/write'
import { redeem } from '../src/redemption/redeem'

const E18 = 10n ** 18n
const MUSD = E18
const BTC = E18
const GAS = 200n * MUSD
const M = 1_800n * MUSD
const PRICE = 76_750n * MUSD
const RATE = 100n
const YEAR = 31_556_952n

// Written out from `InterestRateMath.sol:12-22`, not imported (`docs/08-conventions.md` §11).
const interest = (principal: bigint, rateBps: bigint, seconds: bigint) =>
  (principal * rateBps * seconds) / (10_000n * YEAR)
const nicr = (coll: bigint, principal: bigint) => (coll * 10n ** 20n) / principal

/**
 * `_redeemCollateralFromTrove`'s partial branch, restated from `TroveManager.sol:1216-1306` for a
 * Trove whose interest was just brought current. Returns `true` when the partial CANCELS.
 */
function contractCancelsPartial(t: EligibleTrove, lot: bigint, execPrice: bigint, hint: bigint) {
  const collateralLot = (lot * E18) / execPrice // :1224-1226
  const newColl = t.collateral - collateralLot // :1230
  const newPrincipal = lot > t.interestOwed ? t.principal - (lot - t.interestOwed) : t.principal // :1244-1247
  const upperBound = nicr(newColl, newPrincipal - interest(t.principal, RATE, 600n)) // :1276-1285
  const newNicr = nicr(newColl, newPrincipal) // :1287-1290
  return hint < newNicr || hint > upperBound // :1299-1301
}

const trove = (over: Partial<EligibleTrove> = {}): EligibleTrove => {
  const principal = over.principal ?? 30_230n * MUSD
  const interestOwed = over.interestOwed ?? 0n
  return {
    owner: '0x00000000000000000000000000000000000000aa',
    collateral: 1n * BTC,
    principal,
    interestOwed,
    entireDebt: principal + interestOwed,
    netDebt: principal + interestOwed - GAS,
    interestRateBps: RATE,
    ...over,
  }
}

describe('MK-103, a partial redemption is priced against a band, and the SDK says how narrow', () => {
  const t = trove()
  const lot = 14_115n * MUSD // half the headroom above the floor, the external audit's example

  it('the centred hint survives a rise and a fall exactly as far as the reported tolerances', () => {
    const band = partialRedemptionBand({
      trove: t,
      lot,
      price: PRICE,
      globalInterestRateBps: RATE,
      revertsCallIfCancelled: true,
    })
    const up = PRICE + (PRICE * band.priceToleranceUp) / E18
    const down = PRICE - (PRICE * band.priceToleranceDown) / E18
    expect(contractCancelsPartial(t, lot, PRICE, band.hintNicr), 'at the read price').toBe(false)
    expect(contractCancelsPartial(t, lot, up, band.hintNicr), 'at the reported rise').toBe(false)
    expect(contractCancelsPartial(t, lot, down, band.hintNicr), 'at the reported fall').toBe(false)
    // One part in a million past each edge, far above the rounding of the edges themselves.
    expect(contractCancelsPartial(t, lot, up + PRICE / 1_000_000n, band.hintNicr)).toBe(true)
    expect(contractCancelsPartial(t, lot, down - PRICE / 1_000_000n, band.hintNicr)).toBe(true)
    // Both directions are tolerated, which the helper's lower edge hint never was.
    expect(band.priceToleranceUp).toBeGreaterThan(0n)
    expect(band.priceToleranceDown).toBeGreaterThan(0n)
  })

  it('the band is sized on the PRE-redemption PRINCIPAL, which differs from the entire debt once interest is owed', () => {
    // `TroveManager.sol:1278-1283` accrues the 600 seconds on `trove.principal`. With no interest
    // owed the principal IS the entire debt and a band sized on the wrong one looks right, which is
    // how this went unpinned: every fixture above has `interestOwed: 0n`.
    const owed = trove({ interestOwed: 3_000n * MUSD })
    const band = partialRedemptionBand({
      trove: owed,
      lot,
      price: PRICE,
      globalInterestRateBps: RATE,
      revertsCallIfCancelled: true,
    })
    const up = PRICE + (PRICE * band.priceToleranceUp) / E18
    const down = PRICE - (PRICE * band.priceToleranceDown) / E18
    expect(contractCancelsPartial(owed, lot, PRICE, band.hintNicr)).toBe(false)
    expect(contractCancelsPartial(owed, lot, up, band.hintNicr), 'at the reported rise').toBe(false)
    expect(contractCancelsPartial(owed, lot, down, band.hintNicr), 'at the reported fall').toBe(
      false,
    )
    expect(contractCancelsPartial(owed, lot, up + PRICE / 1_000_000n, band.hintNicr)).toBe(true)
    expect(contractCancelsPartial(owed, lot, down - PRICE / 1_000_000n, band.hintNicr)).toBe(true)
  })

  it("the hint getRedemptionHints returns, the band's LOWER edge, cancels on any rise at all", () => {
    const newColl = t.collateral - (lot * E18) / PRICE
    const lowerEdge = nicr(newColl, t.principal - lot) // HintHelpers.sol:143-160 at the read price
    expect(contractCancelsPartial(t, lot, PRICE, lowerEdge)).toBe(false)
    expect(contractCancelsPartial(t, lot, PRICE + PRICE / 10_000_000n, lowerEdge)).toBe(true)
  })

  it('an ordinary partial is price fragile against the measured two block move', () => {
    const band = partialRedemptionBand({
      trove: t,
      lot,
      price: PRICE,
      globalInterestRateBps: RATE,
      revertsCallIfCancelled: true,
    })
    expect(band.priceToleranceUp).toBeLessThan(REDEMPTION_PRICE_MOVE_TOLERANCE)
    expect(band.priceFragile).toBe(true)
  })

  it('and only a partial that draws a tiny share of the Trove is not', () => {
    const big = trove({ collateral: 100_000n * BTC })
    const band = partialRedemptionBand({
      trove: big,
      lot: 2n * MUSD,
      price: PRICE,
      globalInterestRateBps: RATE,
      revertsCallIfCancelled: true,
    })
    expect(band.priceToleranceUp).toBeGreaterThanOrEqual(REDEMPTION_PRICE_MOVE_TOLERANCE)
    expect(band.priceToleranceDown).toBeGreaterThanOrEqual(REDEMPTION_PRICE_MOVE_TOLERANCE)
    expect(band.priceFragile).toBe(false)
  })
})

describe('MK-104, the client does not refuse the advice its own preview gave', () => {
  it('advice read at t0 is still a whole consumption to the SENDING check 600 seconds later', () => {
    const t0 = trove()
    const advice = evaluateRedeem({
      amount: 1n,
      musdBalance: 10n ** 30n,
      minNetDebt: M,
      tcr: 2n * E18,
      price: PRICE,
      eligible: [t0],
      globalInterestRateBps: RATE,
      troveOwnersCount: 42n,
      sortedTrovesSize: 42n,
      canMint: true, // MK-245: a populated system
    }).nextViableAmount
    expect(advice).toBe(t0.netDebt + interest(t0.principal, RATE, REDEMPTION_ADVICE_MARGIN_SECONDS))

    // 600 seconds later the Trove owes its principal's interest for those seconds.
    const accrued = interest(t0.principal, RATE, 600n)
    const t600 = trove({ interestOwed: accrued })
    const input = {
      amount: advice,
      musdBalance: 10n ** 30n,
      minNetDebt: M,
      tcr: 2n * E18,
      price: PRICE,
      eligible: [t600],
      globalInterestRateBps: RATE,
      troveOwnersCount: 42n,
      sortedTrovesSize: 42n,
      canMint: true,
    }
    const sending = evaluateRedeem({ ...input, marginSeconds: REDEMPTION_SEND_MARGIN_SECONDS })
    expect(sending.viable, 'the sending check accepts it').toBe(true)
    expect(sending.redeemable).toBe(t600.netDebt)
    // The chain's own condition (`TroveManager.sol:1218-1221`, `:1252`) at that moment:
    expect(advice >= t600.netDebt, 'and the contract would consume the Trove whole').toBe(true)
    // What 0.3.1 did: the full advice margin again, on the grown debt, which refuses it.
    const readvised = evaluateRedeem({ ...input, marginSeconds: REDEMPTION_ADVICE_MARGIN_SECONDS })
    expect(readvised.bindingConstraint).toBe('PARTIAL_BREACHES_DEBT_FLOOR')
  })

  it('redeem() sends that advice rather than throwing, through the real write path', async () => {
    const accrued = interest(30_230n * MUSD, RATE, 600n)
    const advice = 30_030n * MUSD + interest(30_230n * MUSD, RATE, REDEMPTION_ADVICE_MARGIN_SECONDS)
    const deps = stubWriteDeps({
      getEntireDebtAndColl: [1n * BTC, 30_230n * MUSD, accrued, 0n, 0n, 0n],
    })
    const error = await redeem(deps, { amount: advice }).catch((e: unknown) => e)
    expect((error as Error).message).toContain('reached simulate')
  })
})

describe('MK-103, redeem() refuses a fragile partial on the first Trove unless told otherwise', () => {
  it('throws RedemptionPriceFragile before simulate', async () => {
    const deps = stubWriteDeps({ getEntireDebtAndColl: [1n * BTC, 30_230n * MUSD, 0n, 0n, 0n, 0n] })
    const error = await redeem(deps, { amount: 14_115n * MUSD }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RedemptionPriceFragile)
    expect((error as RedemptionPriceFragile).code).toBe('REDEMPTION_PRICE_FRAGILE')
  })

  it('and sends it when acceptPriceFragilePartial is set, with the centred hint', async () => {
    const deps = stubWriteDeps({ getEntireDebtAndColl: [1n * BTC, 30_230n * MUSD, 0n, 0n, 0n, 0n] })
    const error = await redeem(deps, {
      amount: 14_115n * MUSD,
      acceptPriceFragilePartial: true,
    }).catch((e: unknown) => e)
    expect((error as Error).message).toContain('reached simulate')
  })
})

describe('MK-107, maxIterations is not charged for the Troves the contract skips before its loop', () => {
  it('three sub-MCR Troves at the tail, then an eligible one, with maxIterations 1', async () => {
    const tail = ['0x...a1', '0x...a2', '0x...a3', '0x...b1'].map(
      (_, i) => `0x${(0xa1 + i).toString(16).padStart(40, '0')}` as `0x${string}`,
    )
    const ZERO = '0x0000000000000000000000000000000000000000'
    const icr: Record<string, bigint> = {
      [tail[0] as string]: E18,
      [tail[1] as string]: E18,
      [tail[2] as string]: E18,
      [tail[3] as string]: 2n * E18,
    }
    const publicClient = {
      readContract: async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
        const who = (args?.[0] ?? '') as string
        switch (functionName) {
          case 'fetchPrice':
            return PRICE
          case 'getTCR':
            return 2n * E18
          case 'balanceOf':
            return 10n ** 30n
          case 'interestRate':
            return Number(RATE)
          case 'getLast':
            return tail[0]
          case 'getPrev': {
            const i = tail.indexOf(who as `0x${string}`)
            return tail[i + 1] ?? ZERO
          }
          case 'getCurrentICR':
            return icr[who]
          case 'getEntireDebtAndColl':
            return [1n * BTC, 30_230n * MUSD, 0n, 0n, 0n, 0n]
          // MK-245. The last Trove rule's counts and flag: a populated system unless a test says otherwise.
          case 'getTroveOwnersCount':
            return 42n
          case 'mintList':
            return true
          case 'getTroveInterestRate':
            return Number(RATE)
          case 'getSize':
            return 42n
          default:
            throw new Error(`unstubbed read: ${functionName}`)
        }
      },
    } as unknown as PublicClient
    const p = await previewRedeem(
      {
        publicClient,
        addresses: getAddresses(31611),
        getMinNetDebt: async () => M,
        isAccountFeeExempt: async () => false,
      },
      { redeemer: tail[3] as `0x${string}`, amount: 1_000n * MUSD, maxIterations: 1n },
    )
    expect(p.reasons).not.toContain('NOTHING_REDEEMABLE')
    expect(p.firstEligibleTrove).toBe(tail[3])
  })

  it('and the budget, once the loop starts, reaches as many eligible Troves as maxIterations says', async () => {
    // The first case stops at the first eligible Trove, so it cannot tell a walk that charged the
    // skipped tail from one that did not: the mutation that charges it was caught by nothing. Here
    // the amount needs TWO eligible Troves and `maxIterations` is 2. The contract spends nothing on
    // the three below MCR (`:338-350`) and one iteration on each eligible Trove (`:360-365`), so both
    // are reached. A walk that charged the tail would have spent its budget before the second.
    const tail = [0xa1, 0xa2, 0xa3, 0xb1, 0xb2].map(
      (n) => `0x${n.toString(16).padStart(40, '0')}` as `0x${string}`,
    )
    const ZERO = '0x0000000000000000000000000000000000000000'
    const icr = (who: string) => (tail.indexOf(who as `0x${string}`) < 3 ? E18 : 2n * E18)
    const publicClient = {
      readContract: async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
        const who = (args?.[0] ?? '') as string
        switch (functionName) {
          case 'fetchPrice':
            return PRICE
          case 'getTCR':
            return 2n * E18
          case 'balanceOf':
            return 10n ** 30n
          case 'interestRate':
            return Number(RATE)
          case 'getLast':
            return tail[0]
          case 'getPrev': {
            const i = tail.indexOf(who as `0x${string}`)
            return tail[i + 1] ?? ZERO
          }
          case 'getCurrentICR':
            return icr(who)
          case 'getEntireDebtAndColl':
            return [1n * BTC, 30_230n * MUSD, 0n, 0n, 0n, 0n]
          // MK-245. The last Trove rule's counts and flag: a populated system unless a test says otherwise.
          case 'getTroveOwnersCount':
            return 42n
          case 'mintList':
            return true
          case 'getTroveInterestRate':
            return Number(RATE)
          case 'getSize':
            return 42n
          default:
            throw new Error(`unstubbed read: ${functionName}`)
        }
      },
    } as unknown as PublicClient
    // More than one Trove's 30,030 MUSD of net debt, and well inside two.
    const amount = 40_000n * MUSD
    const p = await previewRedeem(
      {
        publicClient,
        addresses: getAddresses(31611),
        getMinNetDebt: async () => M,
        isAccountFeeExempt: async () => false,
      },
      { redeemer: tail[4] as `0x${string}`, amount, maxIterations: 2n },
    )
    expect(p.viable, JSON.stringify(p.reasons)).toBe(true)
    expect(p.redeemable, 'both eligible Troves were reached').toBe(amount)
  })
})

/** A one Trove chain for the write path, ending in a simulate that says it was reached. */
function stubWriteDeps(over: Record<string, unknown>): WriteDeps {
  const ZERO = '0x0000000000000000000000000000000000000000'
  const answers: Record<string, unknown> = {
    fetchPrice: PRICE,
    getTCR: 2n * E18,
    balanceOf: 10n ** 30n,
    interestRate: Number(RATE),
    getTroveInterestRate: Number(RATE),
    getLast: '0x00000000000000000000000000000000000000aa',
    getPrev: ZERO,
    getCurrentICR: 2n * E18,
    redemptionRate: 7_500_000_000_000_000n,
    getRedemptionHints: ['0x00000000000000000000000000000000000000aa', 0n, 0n],
    getSize: 42n,
    // MK-245. The last Trove rule's counts and flag: a populated system.
    getTroveOwnersCount: 42n,
    mintList: true,
    getApproxHint: [ZERO, 0n, 0n],
    findInsertPosition: [ZERO, ZERO],
    ...over,
  }
  return {
    publicClient: {
      readContract: async ({ functionName }: { functionName: string }) => {
        if (!(functionName in answers)) throw new Error(`unstubbed read: ${functionName}`)
        return answers[functionName]
      },
      simulateContract: async () => {
        throw new Error('reached simulate')
      },
      estimateContractGas: async () => 1n,
    } as unknown as PublicClient,
    walletClient: {
      account: { address: '0x000000000000000000000000000000000000dEaD', type: 'json-rpc' },
      writeContract: async () => '0xhash',
    } as unknown as WalletClient,
    addresses: getAddresses(31611),
    ensureVerified: async () => {},
    getMinNetDebt: async () => M,
    isAccountFeeExempt: async () => false,
    gasMarginPercent: 0,
  }
}
