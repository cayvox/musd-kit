import { BaseError, ContractFunctionRevertedError, type PublicClient } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  BORROWING_POWER_MARGIN_WINDOW_SECONDS,
  BORROWING_POWER_PRICE_MOVE_BPS,
  ContractCallFailed,
  DECIMAL_PRECISION,
  DEFAULT_HINT_RANDOM_SEED,
  FIXED_CONSTANTS,
  InsufficientMusdBalance,
  MIN_NET_DEBT_MIN,
  ONE_HUNDRED_PCT,
  PERCENT_DIVISOR,
  REDEMPTION_ADVICE_MARGIN_SECONDS,
  REDEMPTION_PRICE_MOVE_TOLERANCE,
  REDEMPTION_SEND_MARGIN_SECONDS,
  RecoveryModeRestriction,
  RepayExceedsDebt,
  TroveNotFound,
  accruedInterest,
  computeHints,
  computeNICR,
  evaluateRedeem,
  getAddresses,
  mapRevert,
  revertReason,
  trialsForSize,
} from '../src'

/**
 * Pins for decisions that were either unpinned values or branches no test reached, found by the
 * mutation gate's site pass. Each block cites the finding it closes.
 */

describe('MK-121, MK-122, MK-123, MK-124, the bundled fixed constants are the protocol literals', () => {
  it('equal the constants the contracts declare, written out from the source', () => {
    // `LiquityBase.sol:19` `_100pct = 1e18`, `:30` `PERCENT_DIVISOR = 200`; `BaseMath.sol:5`
    // `DECIMAL_PRECISION = 1e18`; `BorrowerOperations.sol:97` `MIN_NET_DEBT_MIN = 50e18`. The
    // deployed getters are compared on the fork in `fixed-constants.fork.test.ts`.
    expect(ONE_HUNDRED_PCT).toBe(10n ** 18n)
    expect(PERCENT_DIVISOR).toBe(200n)
    expect(DECIMAL_PRECISION).toBe(10n ** 18n)
    expect(MIN_NET_DEBT_MIN).toBe(50n * 10n ** 18n)
    expect(FIXED_CONSTANTS).toMatchObject({
      ONE_HUNDRED_PCT: 10n ** 18n,
      PERCENT_DIVISOR: 200n,
      DECIMAL_PRECISION: 10n ** 18n,
      MIN_NET_DEBT_MIN: 50n * 10n ** 18n,
    })
  })
})

describe('MK-137, MK-138, MK-182, MK-183, the measured margins are the measured values', () => {
  it('carry the figures their measurements produced, so a change has to be a decision', () => {
    // MK-100: one hour and 200 bps, from `scripts/oracle-moves.ts` over Mezo mainnet blocks 11664905 to
    // 11822985 (worst hourly fall 190.78 bps). MK-103: 5 bps, the two block p99 rounded up. MK-104: 60
    // seconds of sending margin, fifteen blocks at 3.83 seconds. Each is documented where it is declared.
    expect(BORROWING_POWER_MARGIN_WINDOW_SECONDS).toBe(3600n)
    expect(BORROWING_POWER_PRICE_MOVE_BPS).toBe(200n)
    expect(REDEMPTION_PRICE_MOVE_TOLERANCE).toBe(5n * 10n ** 14n)
    expect(REDEMPTION_SEND_MARGIN_SECONDS).toBe(60n)
  })
})

describe('MK-116, MK-071, interest accrues over the contract year', () => {
  it('a full year at 100% owes exactly the principal, over the Gregorian 31,556,952 seconds', () => {
    // `InterestRateMath.sol:9` `SECONDS_IN_A_YEAR = 31_556_952`, divided by in `calculateInterestOwed`
    // (`:12-22`). A 365 day year is 31,536,000 seconds, which would owe more than the principal here.
    const principal = 1_000_000n * 10n ** 18n
    expect(accruedInterest({ principal, rateBps: 10_000n, seconds: 31_556_952n })).toBe(principal)
  })
})

describe('MK-117, MK-095, the redemption advice margin covers more than the window it advertises', () => {
  it('is 900 seconds of the Trove principal at its own rate, above the 600 a caller is told', () => {
    // The 300 second difference is the settlement block the accrual runs to (MK-095).
    expect(REDEMPTION_ADVICE_MARGIN_SECONDS).toBe(900n)
    const principal = 2_208n * 10n ** 18n
    const p = evaluateRedeem({
      amount: 1n,
      globalInterestRateBps: 100n,
      musdBalance: 10n ** 30n,
      minNetDebt: 1_800n * 10n ** 18n,
      tcr: 2n * 10n ** 18n,
      price: 80_000n * 10n ** 18n,
      eligible: [
        {
          owner: '0x00000000000000000000000000000000000000aa',
          entireDebt: principal,
          principal,
          netDebt: principal - 200n * 10n ** 18n,
          interestRateBps: 100n,
          collateral: 10n ** 21n,
          interestOwed: 0n,
        },
      ],
    })
    expect(p.accrualMargin).toBe((principal * 100n * 900n) / (10_000n * 31_556_952n))
  })
})

describe('MK-133, computeNICR refuses a zero principal with its own message', () => {
  it('throws the stated RangeError, not a division by zero', () => {
    // A division by zero is also a RangeError, so the class alone does not tell the two apart.
    expect(() => computeNICR({ collateral: 1n, principal: 0n })).toThrow(
      'computeNICR: principal must be > 0',
    )
  })
})

describe('MK-130, MK-131, MK-132, the approximate hint request', () => {
  it('scales trials as ceil(15 x sqrt(size)), clamped to [15, 2500], as documented', () => {
    expect(trialsForSize(0n)).toBe(15)
    expect(trialsForSize(1n)).toBe(15)
    expect(trialsForSize(4n)).toBe(30)
    expect(trialsForSize(10_000n)).toBe(1500)
    expect(trialsForSize(100_000n)).toBe(2500)
    expect(DEFAULT_HINT_RANDOM_SEED).toBe(42n)
  })

  const recording = () => {
    const calls: { functionName: string; args?: readonly unknown[] }[] = []
    const ZERO = '0x0000000000000000000000000000000000000000'
    const publicClient = {
      readContract: async (c: { functionName: string; args?: readonly unknown[] }) => {
        calls.push(c)
        if (c.functionName === 'getSize') return 4n
        if (c.functionName === 'getApproxHint') return [ZERO, 0n, 0n]
        if (c.functionName === 'findInsertPosition') return [ZERO, ZERO]
        throw new Error(`unstubbed read: ${c.functionName}`)
      },
    } as unknown as PublicClient
    return { calls, deps: { publicClient, addresses: getAddresses(31611) } }
  }

  it('sends trials and a seed the caller supplies as given, and reads no list size', async () => {
    const { calls, deps } = recording()
    await computeHints(deps, {
      collateral: 10n ** 18n,
      principal: 10n ** 21n,
      numTrials: 7,
      randomSeed: 9n,
    })
    expect(calls.map((c) => c.functionName)).toEqual(['getApproxHint', 'findInsertPosition'])
    expect(calls[0]?.args?.slice(1)).toEqual([7n, 9n])
  })

  it('without them, sizes trials from the list and uses the default seed', async () => {
    const { calls, deps } = recording()
    await computeHints(deps, { collateral: 10n ** 18n, principal: 10n ** 21n })
    expect(calls.map((c) => c.functionName)).toEqual([
      'getSize',
      'getApproxHint',
      'findInsertPosition',
    ])
    expect(calls[1]?.args?.slice(1)).toEqual([30n, 42n])
  })
})

/** The shape viem throws for a revert, which is what `mapRevert` walks. */
function revert(reason: string | undefined, errorName?: string): BaseError {
  const inner = new ContractFunctionRevertedError({
    abi: [],
    functionName: 'x',
    message: 'reverted',
  })
  Object.assign(inner, { reason, ...(errorName ? { data: { errorName } } : {}) })
  const outer = new BaseError('The contract function reverted.')
  Object.assign(outer, {
    cause: inner,
    walk: (fn: (e: unknown) => boolean) => (fn(inner) ? inner : fn(outer) ? outer : null),
  })
  return outer
}

describe('MK-127, MK-128, MK-129, mapRevert, each alternative on its own', () => {
  it('maps either Recovery Mode revert string by itself', () => {
    // `BorrowerOperations.sol:1339-1340` and `:1136`.
    expect(
      mapRevert(revert('BorrowerOps: Operation must leave trove with ICR >= CCR')),
    ).toBeInstanceOf(RecoveryModeRestriction)
    expect(
      mapRevert(revert('BorrowerOps: Operation not permitted during Recovery Mode')),
    ).toBeInstanceOf(RecoveryModeRestriction)
  })

  it('maps an insufficient balance by the require string alone and by the custom error alone', () => {
    expect(
      mapRevert(revert('BorrowerOps: Caller doesnt have enough mUSD to make repayment')),
    ).toBeInstanceOf(InsufficientMusdBalance)
    expect(mapRevert(revert(undefined, 'ERC20InsufficientBalance'))).toBeInstanceOf(
      InsufficientMusdBalance,
    )
  })

  it('maps an arithmetic panic to RepayExceedsDebt for repay and adjustTrove only, by name or by text', () => {
    for (const operation of ['repay', 'adjustTrove']) {
      expect(mapRevert(revert(undefined, 'Panic'), { operation }), operation).toBeInstanceOf(
        RepayExceedsDebt,
      )
      expect(
        mapRevert(revert('Arithmetic operation resulted in underflow or overflow'), { operation }),
        operation,
      ).toBeInstanceOf(RepayExceedsDebt)
    }
    expect(mapRevert(revert(undefined, 'Panic'), { operation: 'borrow' })).toBeInstanceOf(
      ContractCallFailed,
    )
    expect(mapRevert(revert(undefined, 'SomethingElse'), { operation: 'repay' })).toBeInstanceOf(
      ContractCallFailed,
    )
  })

  it('names what it can: an unknown address and an unnamed operation say so', () => {
    const notFound = mapRevert(revert('TroveManager: Trove does not exist or is closed'))
    expect(notFound).toBeInstanceOf(TroveNotFound)
    expect(notFound.message).toContain('unknown')
    expect(mapRevert(revert('Something the decoder does not know')).message).toMatch(
      /^contract call reverted/,
    )
  })
})

describe('MK-125, revertReason', () => {
  it('reads the message fields of an object, and stringifies anything else', () => {
    expect(revertReason({ shortMessage: 'short', message: 'long' })).toBe('short')
    expect(revertReason({ details: 'details' })).toBe('details')
    expect(revertReason(null)).toBe('null')
    expect(revertReason('plain')).toBe('plain')
    // A function is not an object to `typeof`, so its fields are not read even when it has one.
    const fn = Object.assign(() => undefined, { message: 'not read' })
    expect(revertReason(fn)).toBe(String(fn))
  })
})
