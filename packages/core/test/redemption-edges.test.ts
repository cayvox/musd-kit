import type { PublicClient, WalletClient } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  type EligibleTrove,
  InsufficientMusdBalance,
  RedemptionFailed,
  getAddresses,
  partialRedemptionBand,
  previewRedeem,
  settledRedemptionFrom,
} from '../src'
import type { WriteDeps } from '../src/internal/write'
import { redeem } from '../src/redemption/redeem'
import { redemptionReceipt } from './redemption-receipt'

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
        // MK-245. The last Trove rule's counts and flag: a populated system unless a test says otherwise.
        case 'getTroveOwnersCount':
          return 42n
        case 'mintList':
          return true
        case 'getSize':
          return 42n
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
    // MK-241. `redeem()` resolves on the mined receipt and reads what settled from its event.
    waitForTransactionReceipt: async () =>
      redemptionReceipt({
        troveManager: getAddresses(31611).troveManager,
        attempted: 1_000n * MUSD,
        actual: 1_000n * MUSD,
        collateralDrawn: BTC / 100n,
        collateralFee: BTC / 10_000n,
      }),
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

  it('MK-241: the estimate comes from the walk, not the hint helper, and asks the chain for no fee', async () => {
    // The helper reports 5,000 MUSD more than the walk expects, the MK-048 shape. The estimate must be
    // the walk's figure, and its fee the contract's formula applied locally.
    const c = chain([2n * E18, 2n * E18], { truncated: 65_060n * MUSD })
    const result = await redeem(c.writeDeps, { amount: 40_000n * MUSD })
    const walk = await previewRedeem(c.writeDeps, {
      redeemer: '0x000000000000000000000000000000000000dEaD',
      amount: 40_000n * MUSD,
      marginSeconds: 60n,
    })
    expect(result.estimatedBeforeSend.redeemable).toBe(walk.redeemable)
    const drawn = (walk.redeemable * E18) / (76_750n * MUSD)
    expect(result.estimatedBeforeSend.collateralDrawn).toBe(drawn)
    expect(result.estimatedBeforeSend.collateralFee).toBe((7_500_000_000_000_000n * drawn) / E18)
    expect(c.reads.map((r) => r.functionName)).not.toContain('getRedemptionRate')
  })
})

describe('MK-241, what a redemption settled, read from its receipt', () => {
  const TM = getAddresses(31611).troveManager
  // A redemption that asked for 66,819.7 MUSD and redeemed 16,864.7, the shape the audit found: the
  // first Trove consumed whole and a later partial cancelled. Collateral drawn includes the fee.
  const receipt = redemptionReceipt({
    troveManager: TM,
    attempted: 66_819_700n * 10n ** 15n,
    actual: 16_864_700n * 10n ** 15n,
    collateralDrawn: 220_626_907_348_902_294n,
    collateralFee: 1_654_701_805_116_767n,
  })

  it('reports the event figures by what each IS, and derives what the redeemer received', () => {
    const settled = settledRedemptionFrom(receipt, TM)
    expect(settled.attemptedAmount).toBe(66_819_700n * 10n ** 15n)
    expect(settled.redeemedAmount, '_actualAmount, not the amount asked for').toBe(
      16_864_700n * 10n ** 15n,
    )
    expect(settled.unredeemedAmount).toBe(49_955_000n * 10n ** 15n)
    expect(settled.collateralDrawn, '_collateralSent is collateral drawn, fee included').toBe(
      220_626_907_348_902_294n,
    )
    expect(settled.collateralFee).toBe(1_654_701_805_116_767n)
    // `TroveManager.sol:416-418`: the redeemer is sent the drawn collateral less the fee.
    expect(settled.collateralReceived).toBe(220_626_907_348_902_294n - 1_654_701_805_116_767n)
    expect(settled.blockNumber).toBe(7n)
  })

  it('a reverted receipt redeemed nothing, and says so as RedemptionFailed', () => {
    const reverted = redemptionReceipt({
      troveManager: TM,
      attempted: 1n,
      actual: 1n,
      collateralDrawn: 1n,
      collateralFee: 0n,
      status: 'reverted',
    })
    expect(() => settledRedemptionFrom(reverted, TM)).toThrow(RedemptionFailed)
  })

  it('a receipt with no Redemption event from the Trove manager is not read as one', () => {
    const none = redemptionReceipt({
      troveManager: TM,
      attempted: 1n,
      actual: 1n,
      collateralDrawn: 1n,
      collateralFee: 0n,
      noEvent: true,
    })
    expect(() => settledRedemptionFrom(none, TM)).toThrow(RedemptionFailed)
    const elsewhere = redemptionReceipt({
      troveManager: TM,
      attempted: 1n,
      actual: 1n,
      collateralDrawn: 1n,
      collateralFee: 0n,
      emitter: '0x00000000000000000000000000000000000000ee',
    })
    expect(() => settledRedemptionFrom(elsewhere, TM), 'another contract').toThrow(RedemptionFailed)
    // The address comparison ignores case, as addresses do.
    expect(settledRedemptionFrom(receipt, TM.toLowerCase() as `0x${string}`).redeemedAmount).toBe(
      16_864_700n * 10n ** 15n,
    )
  })

  it('redeem() resolves with what its receipt settled, not with the estimate', async () => {
    const c = chain([2n * E18, 2n * E18])
    let waitedFor: unknown
    const publicClient = c.writeDeps.publicClient as unknown as {
      waitForTransactionReceipt: (a: { hash: string }) => Promise<unknown>
    }
    publicClient.waitForTransactionReceipt = async (a) => {
      waitedFor = a.hash
      return receipt
    }
    const result = await redeem(c.writeDeps, { amount: 40_000n * MUSD })
    expect(waitedFor, 'the receipt of the hash it sent').toBe('0xhash')
    expect(result.settled).toEqual(settledRedemptionFrom(receipt, TM))
    expect(result.settled.redeemedAmount).not.toBe(result.estimatedBeforeSend.redeemable)
    expect(Object.keys(result)).not.toContain('truncatedAmount')
  })
})
