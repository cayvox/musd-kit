import type { PublicClient, WalletClient } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  type EligibleTrove,
  InsufficientMusdBalance,
  getAddresses,
  partialRedemptionBand,
  previewRedeem,
} from '../src'
import type { WriteDeps } from '../src/internal/write'
import { redeem } from '../src/redemption/redeem'

/**
 * The redemption decisions no test reached: the edges of the partial band, the list walk's inclusive
 * MCR test and its stop, and `redeem()`'s own guards and follow up read. Each block cites its finding.
 *
 * The band's edges are checked against `_redeemCollateralFromTrove`'s cancel condition restated from
 * `TroveManager.sol:1216-1306`, found by bisection over the execution price, never against the SDK's
 * own inversion of it.
 */

const E18 = 10n ** 18n
const MUSD = E18
const BTC = E18
const RATE = 100n
const YEAR = 31_556_952n
const MCR = 11n * 10n ** 17n
const TOLERANCE = 5n * 10n ** 14n
const ZERO = '0x0000000000000000000000000000000000000000'

const interest = (principal: bigint, rateBps: bigint, seconds: bigint) =>
  (principal * rateBps * seconds) / (10_000n * YEAR)
const nicr = (coll: bigint, principal: bigint) => (coll * 10n ** 20n) / principal

/** `TroveManager.sol:1224-1301`: true when the partial CANCELS at `execPrice` with `hint`. */
function cancels(t: EligibleTrove, lot: bigint, execPrice: bigint, hint: bigint) {
  const newColl = t.collateral - (lot * E18) / execPrice
  const newPrincipal = lot > t.interestOwed ? t.principal - (lot - t.interestOwed) : t.principal
  const upperBound = nicr(newColl, newPrincipal - interest(t.principal, RATE, 600n))
  return hint < nicr(newColl, newPrincipal) || hint > upperBound
}

const troveOf = (collateral: bigint, principal: bigint, interestOwed = 0n): EligibleTrove => ({
  owner: '0x00000000000000000000000000000000000000aa',
  collateral,
  principal,
  interestOwed,
  entireDebt: principal + interestOwed,
  netDebt: principal + interestOwed - 200n * MUSD,
  interestRateBps: RATE,
})

const bandOf = (t: EligibleTrove, lot: bigint, price: bigint) =>
  partialRedemptionBand({
    trove: t,
    lot,
    price,
    globalInterestRateBps: RATE,
    revertsCallIfCancelled: true,
  })

describe('MK-118, the partial band reports the contract edges exactly', () => {
  it('the rise and the fall it reports are the last prices at which the contract keeps the partial', () => {
    // Odd wei everywhere, so every rounding in the inversion is exercised.
    const price = 76_750n * MUSD + 3n
    const t = troveOf(BTC + 777n, 30_230n * MUSD + 12_345n)
    const lot = 14_115n * MUSD + 99n
    const band = bandOf(t, lot, price)
    let lo = price
    let hi = 2n * price
    while (lo < hi) {
      const m = (lo + hi + 1n) / 2n
      if (cancels(t, lot, m, band.hintNicr)) hi = m - 1n
      else lo = m
    }
    let lo2 = price / 2n
    let hi2 = price
    while (lo2 < hi2) {
      const m = (lo2 + hi2) / 2n
      if (cancels(t, lot, m, band.hintNicr)) lo2 = m + 1n
      else hi2 = m
    }
    expect(band.priceToleranceUp).toBe(((lo - price) * E18) / price)
    expect(band.priceToleranceDown).toBe(((price - lo2) * E18) / price)
  })
})

describe('MK-118, a tolerance of exactly the threshold is not fragile', () => {
  // Found by search: at a price of 1e18 the tolerance is exact in wei, so each fixture lands one side on
  // exactly 5 bps while the other side is above it. The comparison is strict (`REDEMPTION_PRICE_MOVE_TOLERANCE`
  // is the move a partial must TOLERATE), so exactly the threshold is enough.
  it('the rise at exactly 5 bps, with the fall above it', () => {
    const band = bandOf(troveOf(10_520_985n, 10n ** 20n + 2_001n), 2_001n, E18)
    expect(band.priceToleranceUp, 'fixture').toBe(TOLERANCE)
    expect(band.priceToleranceDown, 'fixture').toBeGreaterThanOrEqual(TOLERANCE)
    expect(band.priceFragile).toBe(false)
  })

  it('the fall at exactly 5 bps, with the rise above it', () => {
    const lot = 1_999n * 10n ** 15n - 1n
    const band = bandOf(troveOf(10_314_829_517_946_534_247_511n, 10n ** 20n + lot), lot, E18)
    expect(band.priceToleranceDown, 'fixture').toBe(TOLERANCE)
    expect(band.priceToleranceUp, 'fixture').toBeGreaterThanOrEqual(TOLERANCE)
    expect(band.priceFragile).toBe(false)
  })
})

describe('MK-118, the band is defined for every lot', () => {
  it('a lot that pays off the whole principal still returns a band', () => {
    const t = troveOf(10n * BTC, 1_000n * MUSD, 5n * MUSD)
    expect(() => bandOf(t, 1_005n * MUSD, 80_000n * MUSD)).not.toThrow()
  })

  it('a band whose lower lot bound is exactly zero reports an unbounded rise', () => {
    // Found by search, restated here so the fixture cannot drift: the collateral the hint allows at most
    // equals the whole collateral, so no price rise can cancel.
    const t = troveOf(10_518_984n, 10n ** 20n + 1n)
    const newPrincipal = t.principal - 1n
    const newColl = t.collateral - 1n
    const band = interest(t.principal, RATE, 600n)
    const hint = (nicr(newColl, newPrincipal) + nicr(newColl, newPrincipal - band)) / 2n
    const maxColl = ((hint + 1n) * newPrincipal + 10n ** 20n - 1n) / 10n ** 20n - 1n
    expect(t.collateral - maxColl, 'fixture: exactly zero').toBe(0n)
    const b = bandOf(t, 1n, E18)
    expect(b.priceToleranceUp).toBeGreaterThan(10n ** 70n)
  })
})

/** A sorted list of Troves, each with its own ICR, answering what the walk and `redeem()` read. */
function chain(icrs: bigint[], opts: { balance?: bigint; truncated?: bigint } = {}) {
  const troves = icrs.map(
    (_, i) => `0x${(0xc1 + i).toString(16).padStart(40, '0')}` as `0x${string}`,
  )
  const reads: { functionName: string; args?: readonly unknown[] }[] = []
  const simulated: { args?: readonly unknown[] }[] = []
  const publicClient = {
    readContract: async (c: { functionName: string; args?: readonly unknown[] }) => {
      reads.push(c)
      const who = (c.args?.[0] ?? '') as string
      switch (c.functionName) {
        case 'fetchPrice':
          return 76_750n * MUSD
        case 'getTCR':
          return 2n * E18
        case 'balanceOf':
          return opts.balance ?? 10n ** 30n
        case 'interestRate':
          return Number(RATE)
        case 'redemptionRate':
          return 7_500_000_000_000_000n
        case 'getLast':
          return troves[0]
        case 'getPrev':
          return troves[troves.indexOf(who as `0x${string}`) + 1] ?? ZERO
        case 'getCurrentICR':
          return icrs[troves.indexOf(who as `0x${string}`)]
        case 'getEntireDebtAndColl':
          return [BTC, 30_230n * MUSD, 0n, 0n, 0n, 0n]
        case 'getTroveInterestRate':
          return Number(RATE)
        case 'getRedemptionHints':
          return [troves[0], 0n, opts.truncated ?? 30_030n * MUSD]
        case 'getSize':
          return BigInt(troves.length)
        case 'getApproxHint':
          return [ZERO, 0n, 0n]
        case 'findInsertPosition':
          return [ZERO, ZERO]
        case 'getRedemptionRate':
          return 123n
        default:
          throw new Error(`unstubbed read: ${c.functionName}`)
      }
    },
    simulateContract: async (request: { args?: readonly unknown[] }) => {
      simulated.push(request)
      return { request: {} }
    },
    estimateContractGas: async () => 1n,
  } as unknown as PublicClient
  const writeDeps: WriteDeps = {
    publicClient,
    walletClient: {
      account: { address: '0x000000000000000000000000000000000000dEaD', type: 'json-rpc' },
      writeContract: async () => '0xhash',
    } as unknown as WalletClient,
    addresses: getAddresses(31611),
    ensureVerified: async () => {},
    getMinNetDebt: async () => 1_800n * MUSD,
    isAccountFeeExempt: async () => false,
    gasMarginPercent: 0,
  }
  const visited = () => reads.filter((r) => r.functionName === 'getCurrentICR').length
  return { troves, reads, simulated, writeDeps, visited }
}

describe('MK-118, the list walk', () => {
  const NET = 30_030n * MUSD

  it('a Trove at exactly MCR is redeemable and is charged an iteration, as `:341-349` and `:374-375` treat it', () => {
    // The contract skips a Trove only when `getCurrentICR(...) < MCR`, so exactly MCR is in.
    const c = chain([MCR, MCR, MCR])
    return previewRedeem(c.writeDeps, {
      redeemer: c.troves[2] as `0x${string}`,
      amount: 40_000n * MUSD,
      maxIterations: 1n,
    }).then((p) => {
      expect(p.firstEligibleTrove).toBe(c.troves[0])
      expect(p.redeemable, 'one iteration, one Trove').toBe(NET)
    })
  })

  it('stops reading as soon as the Troves read cover the amount exactly', async () => {
    const c = chain([2n * E18, 2n * E18, 2n * E18])
    await previewRedeem(c.writeDeps, { redeemer: c.troves[2] as `0x${string}`, amount: NET })
    expect(c.visited()).toBe(1)
  })
})

describe('MK-118, redeem()', () => {
  it('sends the default bound when none is given, to the helper and to the call', async () => {
    const c = chain([2n * E18, 2n * E18])
    await redeem(c.writeDeps, { amount: 1_000n * MUSD, acceptPriceFragilePartial: true })
    const hints = c.reads.find((r) => r.functionName === 'getRedemptionHints')
    expect(hints?.args?.[2]).toBe(100n)
    expect(c.simulated[0]?.args?.[5]).toBe(100n)
  })

  it('a balance of exactly the amount is enough, as `_requireMUSDBalanceCoversRedemption` allows', async () => {
    const amount = 1_000n * MUSD
    const c = chain([2n * E18, 2n * E18], { balance: amount })
    const result = await redeem(c.writeDeps, { amount, acceptPriceFragilePartial: true })
    expect(result.hash).toBe('0xhash')
    const short = chain([2n * E18, 2n * E18], { balance: amount - 1n })
    await expect(
      redeem(short.writeDeps, { amount, acceptPriceFragilePartial: true }),
    ).rejects.toBeInstanceOf(InsufficientMusdBalance)
  })

  it('a viable redemption is sent, not refused as a floor breach', async () => {
    const c = chain([2n * E18, 2n * E18])
    const result = await redeem(c.writeDeps, { amount: 40_000n * MUSD })
    expect(result.hash).toBe('0xhash')
  })

  it('refuses before gas only for the floor gap, and leaves any other refusal to the simulation', async () => {
    // Every Trove under MCR: the preview says NOTHING_REDEEMABLE, which is not the debt floor gap, so
    // `redeem()` does not name it one. It reaches the simulation, whose revert is decoded (MK-048).
    const c = chain([E18, E18])
    const result = await redeem(c.writeDeps, { amount: 1_000n * MUSD })
    expect(c.simulated, 'the simulation decides').toHaveLength(1)
    expect(result.hash).toBe('0xhash')
  })

  it('asks for no redemption rate when the call is estimated to draw no collateral', async () => {
    const c = chain([2n * E18, 2n * E18], { truncated: 0n })
    const result = await redeem(c.writeDeps, { amount: 40_000n * MUSD })
    expect(result.estimatedCollateralDrawn).toBe(0n)
    expect(result.estimatedFeeCollateral).toBe(0n)
    expect(c.reads.map((r) => r.functionName)).not.toContain('getRedemptionRate')
  })
})
