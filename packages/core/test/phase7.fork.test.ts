import { http, type Address, type PrivateKeyAccount, createWalletClient } from 'viem'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  ALL_MUSD_ERROR_CODES,
  BelowMinimumDebt,
  ContractCallFailed,
  ICRBelowMCR,
  InsufficientCollateral,
  InsufficientMusdBalance,
  InvalidAmount,
  MismatchedDeployment,
  MusdError,
  MusdErrorCode,
  NothingToLiquidate,
  RecoveryModeRestriction,
  RedemptionFailed,
  RepayExceedsDebt,
  StaleHint,
  TroveAlreadyExists,
  TroveNotFound,
  Unauthorized,
  UnsupportedChain,
  createMusdClient,
  getAddresses,
  mapRevert,
  musdAbi,
  revertReason,
} from '../src'
import { connectFork } from './harness'
import { mezoTestnet } from './harness/constants'
import { openTroveRaw, testAccount } from './harness/openTroveRaw'

const T = getAddresses(31611)
const BTC = 10n ** 18n
const MUSD = 10n ** 18n

function clientFor(account: PrivateKeyAccount) {
  const fork = connectFork()
  const walletClient = createWalletClient({
    account,
    chain: mezoTestnet,
    transport: http(fork.rpcUrl),
  })
  return createMusdClient({ chainId: 31611, publicClient: fork.publicClient, walletClient })
}

const readOnly = () =>
  createMusdClient({ chainId: 31611, publicClient: connectFork().publicClient })

const wait = (hash: Address) => connectFork().publicClient.waitForTransactionReceipt({ hash })

const balanceMusd = (a: Address) =>
  connectFork().publicClient.readContract({
    address: T.musd,
    abi: musdAbi,
    functionName: 'balanceOf',
    args: [a],
  })

/** Send `account`'s entire MUSD balance away so a later repay/redeem must fund from nothing. */
async function drainMusd(account: PrivateKeyAccount, to: Address) {
  const fork = connectFork()
  const bal = await balanceMusd(account.address)
  if (bal === 0n) return
  const w = createWalletClient({ account, chain: mezoTestnet, transport: http(fork.rpcUrl) })
  const { request } = await fork.publicClient.simulateContract({
    account,
    address: T.musd,
    abi: musdAbi,
    functionName: 'transfer',
    args: [to, bal],
  })
  await wait(await w.writeContract(request))
}

// ───────────────────────────────────────────────────────────────────────────
// Unit: decoder + codes + fail-fast guards (no fork — fast, full branch coverage)
// ───────────────────────────────────────────────────────────────────────────

describe('Phase 7 — errors/ taxonomy + decoder (unit)', () => {
  it('every MusdErrorCode value is present and unique (stable public API)', () => {
    const expected = [
      'BELOW_MINIMUM_DEBT',
      'MAX_FEE_EXCEEDED',
      'INSUFFICIENT_COLLATERAL',
      'TROVE_NOT_FOUND',
      'TROVE_ALREADY_EXISTS',
      'INVALID_AMOUNT',
      'INVALID_ADJUSTMENT',
      'ICR_BELOW_MCR',
      'RECOVERY_MODE_RESTRICTION',
      'REPAY_EXCEEDS_DEBT',
      'STALE_HINT',
      'INSUFFICIENT_MUSD_BALANCE',
      'NOTHING_TO_LIQUIDATE',
      'REDEMPTION_FAILED',
      'UNAUTHORIZED',
      'UNSUPPORTED_CHAIN',
      'MISMATCHED_DEPLOYMENT',
      'MISSING_WALLET_CLIENT',
      'CONTRACT_CALL_FAILED',
    ]
    for (const code of expected) expect(ALL_MUSD_ERROR_CODES).toContain(code)
    expect(new Set(ALL_MUSD_ERROR_CODES).size).toBe(ALL_MUSD_ERROR_CODES.length)
    // Enum object and the value list agree.
    expect([...ALL_MUSD_ERROR_CODES].sort()).toEqual(Object.values(MusdErrorCode).sort())
  })

  // The verified revert corpus (ground-truth §11): each reason → its typed error.
  const cases: [string, string, new (...a: never[]) => MusdError][] = [
    [
      'BorrowerOps: An operation that would result in ICR < MCR is not permitted',
      'openTrove',
      ICRBelowMCR,
    ],
    [
      'BorrowerOps: Operation must leave trove with ICR >= CCR',
      'openTrove',
      RecoveryModeRestriction,
    ],
    ['BorrowerOps: Trove does not exist or is closed', 'withdrawCollateral', TroveNotFound],
    ['BorrowerOps: Trove is active', 'openTrove', TroveAlreadyExists],
    [
      'BorrowerOps: Caller doesnt have enough mUSD to make repayment',
      'repay',
      InsufficientMusdBalance,
    ],
    ["BorrowerOps: Trove's net debt must be greater than minimum", 'openTrove', BelowMinimumDebt],
    ['TroveManager: nothing to liquidate', 'liquidate', NothingToLiquidate],
    ['TroveManager: Unable to redeem any amount', 'redeem', RedemptionFailed],
    ['Arithmetic operation resulted in underflow or overflow.', 'repay', RepayExceedsDebt],
  ]
  for (const [reason, operation, Type] of cases) {
    it(`mapRevert: "${reason.slice(0, 38)}…" → ${Type.name}`, () => {
      const raw = new Error(reason)
      const mapped = mapRevert(raw, { operation, borrowers: ['0xabc'], address: '0xdef' })
      expect(mapped).toBeInstanceOf(Type)
      expect((mapped as MusdError).cause).toBe(raw)
    })
  }

  it('mapRevert: an UNRECOGNIZED revert → ContractCallFailed, original preserved in cause (never swallowed)', () => {
    const raw = new Error('CustomThing: some brand-new revert nobody mapped')
    const mapped = mapRevert(raw, { operation: 'openTrove' })
    expect(mapped).toBeInstanceOf(ContractCallFailed)
    expect((mapped as ContractCallFailed).cause).toBe(raw)
    expect((mapped as ContractCallFailed).message).toContain('some brand-new revert')
  })

  it('mapRevert: a bare Panic underflow only maps to RepayExceedsDebt under a repay/adjust op', () => {
    const raw = new Error('Arithmetic operation resulted in underflow or overflow.')
    expect(mapRevert(raw, { operation: 'redeem' })).toBeInstanceOf(ContractCallFailed)
    expect(mapRevert(raw, { operation: 'repay' })).toBeInstanceOf(RepayExceedsDebt)
    expect(mapRevert(raw, { operation: 'adjustTrove' })).toBeInstanceOf(RepayExceedsDebt)
  })

  it('every error subclass carries its code + structured context (incl. the not-reachable ones)', () => {
    const a = '0x000000000000000000000000000000000000dEaD'
    const checks: [MusdError, MusdErrorCode][] = [
      [new BelowMinimumDebt(1800n, 100n), MusdErrorCode.BELOW_MINIMUM_DEBT],
      [
        new InsufficientCollateral(1_050_000_000_000_000_000n, 1_100_000_000_000_000_000n),
        MusdErrorCode.INSUFFICIENT_COLLATERAL,
      ],
      [new TroveNotFound(a), MusdErrorCode.TROVE_NOT_FOUND],
      [new TroveAlreadyExists(a), MusdErrorCode.TROVE_ALREADY_EXISTS],
      [new InvalidAmount('amount', -1n), MusdErrorCode.INVALID_AMOUNT],
      [new ICRBelowMCR(new Error('x')), MusdErrorCode.ICR_BELOW_MCR],
      [new RecoveryModeRestriction(new Error('x')), MusdErrorCode.RECOVERY_MODE_RESTRICTION],
      [
        new RepayExceedsDebt(undefined, { repay: 5n, netDebt: 1n }),
        MusdErrorCode.REPAY_EXCEEDS_DEBT,
      ],
      [new StaleHint(new Error('x')), MusdErrorCode.STALE_HINT],
      [new RedemptionFailed('m', new Error('x')), MusdErrorCode.REDEMPTION_FAILED],
      [new NothingToLiquidate([a]), MusdErrorCode.NOTHING_TO_LIQUIDATE],
      [new Unauthorized(), MusdErrorCode.UNAUTHORIZED],
      [new UnsupportedChain(1), MusdErrorCode.UNSUPPORTED_CHAIN],
      [new MismatchedDeployment('MCR', 1n, 2n), MusdErrorCode.MISMATCHED_DEPLOYMENT],
    ]
    for (const [err, code] of checks) {
      expect(err).toBeInstanceOf(MusdError)
      expect(err.code).toBe(code)
      expect(err.name).not.toBe('MusdError') // each subclass sets its own name
    }
    expect(new UnsupportedChain(42).chainId).toBe(42)
    expect(new MismatchedDeployment('CCR', 1n, 2n).onchain).toBe(2n)
  })

  it('revertReason extracts the best message and tolerates non-objects', () => {
    expect(revertReason({ shortMessage: 'short', message: 'long' })).toBe('short')
    expect(revertReason({ message: 'only message' })).toBe('only message')
    expect(revertReason('a bare string')).toBe('a bare string')
    expect(revertReason(42)).toBe('42')
  })

  it('guards fail fast: a zero amount throws InvalidAmount before ANY client call (nothing read or broadcast)', async () => {
    let touched = false
    const trap = new Proxy(
      {},
      {
        get() {
          touched = true
          throw new Error('client should not be touched when a guard fails fast')
        },
      },
    )
    // Build a client whose clients would throw if used; the InvalidAmount guard must
    // short-circuit before reaching them.
    const client = createMusdClient({
      chainId: 31611,
      // biome-ignore lint/suspicious/noExplicitAny: intentional trap to prove no I/O happens.
      publicClient: trap as any,
      // biome-ignore lint/suspicious/noExplicitAny: intentional trap to prove nothing is broadcast.
      walletClient: { account: { address: '0x0000000000000000000000000000000000000001' } } as any,
    })
    await expect(client.openTrove({ collateral: 0n, debt: 5_000n * MUSD })).rejects.toBeInstanceOf(
      InvalidAmount,
    )
    await expect(client.repay({ amount: 0n })).rejects.toBeInstanceOf(InvalidAmount)
    expect(touched).toBe(false)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Fork: one REAL revert per mapped error (Law 5)
// ───────────────────────────────────────────────────────────────────────────

let funder: PrivateKeyAccount

describe('Phase 7 — every mapped error proven by a real fork revert', () => {
  beforeAll(async () => {
    funder = testAccount(720)
    const fork = connectFork()
    await fork.refreshOracle()
    await openTroveRaw(fork, {
      collateralBtc: 5n * BTC,
      debtMusd: 200_000n * MUSD,
      account: funder,
    })
  }, 480_000)

  it('BelowMinimumDebt — guard, with real minNetDebt context', async () => {
    const a = testAccount(721)
    await connectFork().fundAccount(a.address, 5n * BTC)
    await connectFork().refreshOracle()
    try {
      await clientFor(a).openTrove({ collateral: BTC, debt: 100n * MUSD })
      throw new Error('expected BelowMinimumDebt')
    } catch (e) {
      expect(e).toBeInstanceOf(BelowMinimumDebt)
      const err = e as BelowMinimumDebt
      expect(err.code).toBe(MusdErrorCode.BELOW_MINIMUM_DEBT)
      // Guard-thrown (not the decoder): real minNetDebt in context (≈ 1800e18, > 0).
      expect(err.context?.minNetDebt as bigint).toBeGreaterThan(0n)
    }
  }, 120_000)

  it('TroveAlreadyExists — guard, opening when one is already open', async () => {
    await connectFork().refreshOracle()
    try {
      await clientFor(funder).openTrove({ collateral: BTC, debt: 5_000n * MUSD })
      throw new Error('expected TroveAlreadyExists')
    } catch (e) {
      expect(e).toBeInstanceOf(TroveAlreadyExists)
      expect((e as TroveAlreadyExists).context?.address).toBe(funder.address)
    }
  }, 120_000)

  it('ICRBelowMCR — decoder, open below the 110% ratio (passes guards, reverts on simulate)', async () => {
    const a = testAccount(722)
    await connectFork().fundAccount(a.address, 5n * BTC)
    await connectFork().refreshOracle()
    // 0.05 BTC collateral, 50k draw → ICR well under MCR; debt clears minNetDebt so the
    // guards pass and the contract revert is what surfaces.
    await expect(
      clientFor(a).openTrove({ collateral: (5n * BTC) / 100n, debt: 50_000n * MUSD }),
    ).rejects.toBeInstanceOf(ICRBelowMCR)
  }, 120_000)

  it('TroveNotFound — guard, operating on an address with no Trove', async () => {
    const a = testAccount(723)
    await connectFork().fundAccount(a.address, 5n * BTC)
    await expect(clientFor(a).withdrawCollateral({ amount: MUSD })).rejects.toBeInstanceOf(
      TroveNotFound,
    )
    await expect(clientFor(a).borrow({ amount: 1_000n * MUSD })).rejects.toBeInstanceOf(
      TroveNotFound,
    )
  }, 120_000)

  it('RepayExceedsDebt — guard, repaying more than owed', async () => {
    await connectFork().refreshOracle()
    try {
      await clientFor(funder).repay({ amount: 10_000_000n * MUSD })
      throw new Error('expected RepayExceedsDebt')
    } catch (e) {
      expect(e).toBeInstanceOf(RepayExceedsDebt)
      expect((e as RepayExceedsDebt).context?.netDebt as bigint).toBeGreaterThan(0n)
    }
  }, 120_000)

  it('InsufficientMusdBalance — guard, repay with no MUSD held', async () => {
    const a = testAccount(724)
    await connectFork().fundAccount(a.address, 10n * BTC)
    await connectFork().refreshOracle()
    await openTroveRaw(connectFork(), {
      collateralBtc: 2n * BTC,
      debtMusd: 5_000n * MUSD,
      account: a,
    })
    await drainMusd(a, funder.address)
    await connectFork().refreshOracle()
    try {
      await clientFor(a).repay({ amount: 1_000n * MUSD })
      throw new Error('expected InsufficientMusdBalance')
    } catch (e) {
      expect(e).toBeInstanceOf(InsufficientMusdBalance)
      expect((e as InsufficientMusdBalance).context?.required).toBe(1_000n * MUSD)
    }
  }, 180_000)

  it('NothingToLiquidate — decoder, liquidating a healthy Trove', async () => {
    await connectFork().refreshOracle()
    const a = testAccount(725)
    await connectFork().fundAccount(a.address, 1n * BTC)
    try {
      await clientFor(a).liquidate(funder.address)
      throw new Error('expected NothingToLiquidate')
    } catch (e) {
      expect(e).toBeInstanceOf(NothingToLiquidate)
      expect((e as NothingToLiquidate).context?.borrowers).toEqual([funder.address])
    }
  }, 120_000)

  // NOTE: StaleHint is NOT distinctly reachable (ground-truth §11) — a stale/incorrect
  // redemption partial hint surfaces as "TroveManager: Unable to redeem any amount", which
  // the decoder maps to RedemptionFailed. That mapping is proven in the unit decoder test
  // above; there is no distinct fork revert to assert here.

  it('RecoveryModeRestriction — decoder, open ICR<CCR while the system is in Recovery Mode', async () => {
    const fork = connectFork()
    const original = await readOnly().getOraclePrice()
    try {
      await fork.setPrice(20_000n * MUSD) // crash price → system-wide TCR < CCR
      await fork.refreshOracle()
      expect((await readOnly().getSystemState()).isRecoveryMode).toBe(true)
      const a = testAccount(727)
      await fork.fundAccount(a.address, 10n * BTC)
      // 1 BTC @ $20k = $20k coll, 15k draw → ICR ≈ 1.32 ∈ [MCR, CCR) → blocked by RM.
      await expect(
        clientFor(a).openTrove({ collateral: BTC, debt: 15_000n * MUSD }),
      ).rejects.toBeInstanceOf(RecoveryModeRestriction)
    } finally {
      // Restore the shared fork's price so later files (smoke) are unaffected.
      await fork.setPrice(original)
      await fork.refreshOracle()
    }
  }, 180_000)

  it('decoder works on a REAL viem error (custom error) — ERC20InsufficientBalance → InsufficientMusdBalance', async () => {
    // The unit tests feed plain Errors; this proves mapRevert's BaseError.walk path against
    // a genuine on-chain revert that viem decodes as a custom error (errorName), not a
    // require-string. A wallet with no MUSD transferring MUSD trips ERC20InsufficientBalance.
    const a = testAccount(728)
    await connectFork().fundAccount(a.address, BTC)
    let raw: unknown
    try {
      await connectFork().publicClient.simulateContract({
        account: a,
        address: T.musd,
        abi: musdAbi,
        functionName: 'transfer',
        args: [funder.address, 1_000n * MUSD],
      })
    } catch (e) {
      raw = e
    }
    expect(raw).toBeDefined()
    const mapped = mapRevert(raw, { operation: 'erc20Transfer' })
    expect(mapped).toBeInstanceOf(InsufficientMusdBalance)
    expect((mapped as MusdError).cause).toBe(raw)
  }, 120_000)
})
