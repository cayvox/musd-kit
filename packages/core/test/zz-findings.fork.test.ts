/**
 * Failing tests that pin OPEN findings (P2 wave). Fixes nothing.
 *
 * ============================ HOW TO READ THIS FILE ============================
 *
 * Every test body asserts the CONTRACT'S behavior, derived from Solidity read in the
 * session that wrote it, and every body therefore FAILS against the SDK as it stands.
 * Each is wrapped in vitest's `it.fails`, which inverts the result: a body that throws
 * is reported as a pass, and a body that stops throwing is reported as a FAILURE.
 *
 * That mechanism is chosen deliberately over a skip flag:
 *
 *   - The tests RUN. Nothing is skipped, in CI or locally, so a finding cannot quietly
 *     stop being visible. Each one logs the assertion it pinned, so the reason is in the
 *     run output rather than buried in this file.
 *   - The suite's overall signal stays readable: known-wrong behavior does not paint the
 *     run red, so a NEW regression still stands out.
 *   - The day the SDK is corrected, `it.fails` turns red and names the finding. That is
 *     the inversion: delete the `.fails` and the same body is a green regression test.
 *
 * To see the raw assertion failures instead, run with `MUSD_FINDINGS_RAW=1`, which runs
 * them as ordinary tests. That is what the acceptance evidence was captured with.
 *
 * ================================ GROUND TRUTH ================================
 *
 * Read this session at `mezo-org/musd` (public), not recalled:
 *
 *   BorrowerOperations.sol
 *     :631-665   _openTrove: the borrowing fee is charged ONLY when
 *                `!isRecoveryMode && !governableVariables.isAccountFeeExempt(_borrower)`;
 *                `_requireAtLeastMinNetDebt(vars.netDebt)` is checked against the draw
 *                PLUS that fee, so in Recovery Mode and for exempt accounts the floor is
 *                checked against the bare draw. In normal mode the open additionally
 *                requires `ICR >= MCR` AND a resulting `TCR >= CCR`.
 *     :1012-1075 _refinance: `_requireNotInRecoveryMode(price)` first, then
 *                `amount = refinancingFeePercentage * (getTroveDebt - 200e18) / 100`,
 *                `fee = isAccountFeeExempt ? 0 : getBorrowingFee(amount)`, and the fee is
 *                added to the trove's debt with `increaseTroveDebt`.
 *     :1323-1328 _calculateMaxBorrowingCapacity(coll, price) = coll * price / (110 * 1e16)
 *     :1358-1365 _requireHasBorrowingCapacity: `maxBorrowingCapacity >= netDebtChange + debt`
 *     :879-897   the capacity ratchet: recomputed ONLY when collateral decreases, and
 *                stored as `min(current, recalculated)`, so it never rises with price
 *     :499-509   getRedemptionRate(collateralDrawn) returns a fee AMOUNT in BTC wei
 *     :129,:151  redemptionRate is the RATE, a 1e18 fraction, initialized to 0.75%
 *   TroveManager.sol
 *     :1148      the ONLY liquidation gate, `if (vars.ICR < MCR)`. `grep -c CCR` over the
 *                whole file returns 0: there is no Recovery Mode widening to model.
 *     :566-577   getNominalICR uses principal + pendingPrincipal, with NO interest
 *   InterestRateMath.sol
 *     :33-48     calculateDebtAdjustment applies a payment to INTEREST FIRST: a payment at
 *                or below interest owed reduces principal by exactly zero
 *   GovernableVariables.sol
 *     :22-24,:120 addFeeExemptAccount is `onlyGovernance`, meaning council or treasury
 *
 * Contract line numbers were read at the time of writing and may drift upstream; the
 * quoted rule, not the line number, is the anchor.
 *
 * ============================== SELF SUFFICIENCY ==============================
 *
 * Every test builds its own Troves and drives its own conditions, and restores any price
 * shim in `finally`. NOTHING here reads state another file left behind, and nothing here
 * warps the EVM clock: the clock coupling is MK-016 and this file does not add to it.
 * Interest, where a test needs it, comes from anvil's own wall-clock block timestamps.
 */

import {
  http,
  type Address,
  type Hex,
  type PrivateKeyAccount,
  createWalletClient,
  parseAbi,
} from 'viem'
import { describe, expect, it } from 'vitest'
import {
  CCR,
  MCR,
  MUSD_GAS_COMPENSATION,
  borrowerOperationsAbi,
  createMusdClient,
  getAddresses,
  priceFeedAbi,
  troveManagerAbi,
} from '../src'
import { connectFork } from './harness'
import { mezoTestnet } from './harness/constants'
import { openTroveRaw, testAccount } from './harness/openTroveRaw'

const T = getAddresses(31611)
const MUSD = 10n ** 18n
const BTC = 10n ** 18n

/**
 * Let real time pass, then mine, so the Trove accrues interest.
 *
 * Measured on this harness: `mine` alone does NOT advance the block timestamp within the
 * same wall-clock second, so mining in a tight loop yields elapsed 0 and interest 0. A
 * real sleep does advance it. This is deliberately NOT `warpTime`: an EVM warp is
 * cumulative and leaks into every later file, which is the MK-016 coupling this file
 * refuses to add to. A few seconds of wall clock leaks nothing.
 */
async function accrueInterest(seconds = 3): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
  await connectFork().mineBlocks(1)
}

/**
 * `it.fails` by default, see the header. `MUSD_FINDINGS_RAW=1` runs them as ordinary
 * tests so the raw assertion output can be read; it never skips anything either way.
 */
const pins = process.env.MUSD_FINDINGS_RAW ? it : it.fails

function clientFor(account: PrivateKeyAccount) {
  const fork = connectFork()
  const walletClient = createWalletClient({
    account,
    chain: mezoTestnet,
    transport: http(fork.rpcUrl),
  })
  return createMusdClient({ chainId: 31611, publicClient: fork.publicClient, walletClient })
}
const reader = () => createMusdClient({ chainId: 31611, publicClient: connectFork().publicClient })
const wait = (hash: Hex) => connectFork().publicClient.waitForTransactionReceipt({ hash })
const livePrice = () =>
  connectFork().publicClient.readContract({
    address: T.priceFeed,
    abi: priceFeedAbi,
    functionName: 'fetchPrice',
  })
const troveDebt = (a: Address) =>
  connectFork().publicClient.readContract({
    address: T.troveManager,
    abi: troveManagerAbi,
    functionName: 'getTroveDebt',
    args: [a],
  })
const nominalICR = (a: Address) =>
  connectFork().publicClient.readContract({
    address: T.troveManager,
    abi: troveManagerAbi,
    functionName: 'getNominalICR',
    args: [a],
  })
const entireDebtAndColl = (a: Address) =>
  connectFork().publicClient.readContract({
    address: T.troveManager,
    abi: troveManagerAbi,
    functionName: 'getEntireDebtAndColl',
    args: [a],
  })

/** Open a Trove at a target ICR against the CURRENT price, using the raw harness helper. */
async function openAtIcr(
  account: PrivateKeyAccount,
  targetIcrE18: bigint,
  drawMusd = 2_000n * MUSD,
): Promise<{ collateral: bigint; entireDebt: bigint }> {
  const fork = connectFork()
  const price = await livePrice()
  const fee = await reader().getBorrowingFee(drawMusd)
  const entireDebt = drawMusd + fee + MUSD_GAS_COMPENSATION
  const collateral = (targetIcrE18 * entireDebt) / price
  await openTroveRaw(fork, {
    collateralBtc: collateral,
    debtMusd: drawMusd,
    account,
    numTrials: 15,
  })
  return { collateral, entireDebt }
}

describe('Open findings, pinned by failing tests (P2)', () => {
  // ---------------------------------------------------------------- MK-001 ----
  // FIXED in the P3a wave: this is now an ordinary passing assertion, not a pin.
  it('MK-001 (fixed): isLiquidatable follows ICR < MCR with no Recovery Mode widening', async () => {
    const fork = connectFork()
    const victim = testAccount(2001)
    const keeper = testAccount(2002)
    const original = await livePrice()
    await fork.fundAccount(keeper.address, 5n * BTC)
    try {
      // Open comfortably, then crash the price so the system enters Recovery Mode and
      // this Trove lands in the band MCR <= ICR < CCR.
      await openAtIcr(victim, 2_600_000_000_000_000_000n)
      await fork.setPrice((original * 50n) / 100n)
      await fork.refreshOracle()

      const state = await reader().getSystemState()
      expect(state.isRecoveryMode, 'fixture: system must be in Recovery Mode').toBe(true)
      const trove = await reader().getTrove(victim.address)
      expect(trove.icr, 'fixture: ICR must be at or above MCR').toBeGreaterThanOrEqual(MCR)
      expect(trove.icr, 'fixture: ICR must be below CCR').toBeLessThan(CCR)

      // The protocol's answer, from TroveManager.sol:1148: the only gate is ICR < MCR,
      // and this Trove is at or above MCR, so liquidation must be refused.
      await expect(
        clientFor(keeper).liquidate(victim.address),
        'fixture: the protocol must refuse this liquidation',
      ).rejects.toThrow()

      // FIXED. `read/system.ts` no longer widens the predicate in Recovery Mode: there is
      // no mode branch at all, because `TroveManager.sol` contains no reference to CCR.
      expect(
        await reader().isLiquidatable(victim.address),
        'MK-001: isLiquidatable must follow the protocol rule ICR < MCR, with no CCR widening',
      ).toBe(false)
    } finally {
      await fork.setPrice(original)
      await fork.refreshOracle()
    }
  }, 240_000)

  /**
   * MK-001's underlying defect was not the mode branch, it was that TWO APIs answered one
   * question differently: `isLiquidatable(address)` and `getTrove(address).isLiquidatable`.
   * This pins that they agree, across the whole band that matters, so they cannot drift
   * apart again. If a future change reintroduces a branch in one of them, this fails.
   */
  it('MK-001 (regression): both liquidatability read paths agree, in normal mode and in Recovery Mode', async () => {
    const fork = connectFork()
    const below = testAccount(2013)
    const between = testAccount(2014)
    const above = testAccount(2015)
    const original = await livePrice()
    try {
      // Three Troves that, after a 50% price crash, straddle the band: under MCR,
      // between MCR and CCR, and above CCR.
      await openAtIcr(below, 2_100_000_000_000_000_000n)
      await openAtIcr(between, 2_600_000_000_000_000_000n)
      await openAtIcr(above, 3_400_000_000_000_000_000n)

      const client = reader()
      for (const mode of ['normal', 'recovery'] as const) {
        if (mode === 'recovery') {
          await fork.setPrice((original * 50n) / 100n)
          await fork.refreshOracle()
        }
        const inRecovery = (await client.getSystemState()).isRecoveryMode
        expect(inRecovery, `fixture: expected ${mode} mode`).toBe(mode === 'recovery')

        for (const account of [below, between, above]) {
          const trove = await client.getTrove(account.address)
          const direct = await client.isLiquidatable(account.address)
          expect(
            direct,
            `MK-001: the two read paths disagree for ${account.address} in ${mode} mode`,
          ).toBe(trove.isLiquidatable)
          // And both equal the protocol's own rule at the same price.
          expect(direct, `MK-001: ${mode} mode verdict must be icr < MCR`).toBe(trove.icr < MCR)
        }
      }
    } finally {
      await fork.setPrice(original)
      await fork.refreshOracle()
    }
  }, 300_000)

  // ---------------------------------------------------------------- MK-002 ----
  pins(
    'MK-002: getBorrowingPower ignores maxBorrowingCapacity, which never rises with price',
    async () => {
      const fork = connectFork()
      const borrower = testAccount(2003)
      const original = await livePrice()
      try {
        const { collateral } = await openAtIcr(borrower, 2_000_000_000_000_000_000n)

        // Capacity is fixed at OPEN from the opening price (BorrowerOperations.sol:692-698
        // via :1323-1328) and never recomputed upward, so a price rise cannot raise it.
        const capacity = await connectFork().publicClient.readContract({
          address: T.troveManager,
          abi: troveManagerAbi,
          functionName: 'getTroveMaxBorrowingCapacity',
          args: [borrower.address],
        })
        const expectedCapacity = (collateral * original) / (110n * 10n ** 16n)
        expect(capacity, 'fixture: capacity must equal the contract formula at open').toBe(
          expectedCapacity,
        )

        await fork.setPrice(original * 2n)
        await fork.refreshOracle()

        const capacityAfterRise = await connectFork().publicClient.readContract({
          address: T.troveManager,
          abi: troveManagerAbi,
          functionName: 'getTroveMaxBorrowingCapacity',
          args: [borrower.address],
        })
        expect(capacityAfterRise, 'fixture: capacity must not rise with price').toBe(capacity)

        // The contract gates a debt increase on `capacity >= netDebtChange + debt`
        // (BorrowerOperations.sol:1358-1365), so the largest additional draw is bounded by
        // the remainder, not by the ICR alone.
        const debtNow = await troveDebt(borrower.address)
        const remaining = capacity > debtNow ? capacity - debtNow : 0n

        // THE FINDING. `math/getBorrowingPower.ts` solves only the ICR constraint and never
        // reads the capacity, so at the raised price it reports a draw the contract rejects.
        const power = await reader().getBorrowingPower({ collateral })
        expect(
          power,
          'MK-002: getBorrowingPower must not exceed the remaining on-chain borrowing capacity',
        ).toBeLessThanOrEqual(remaining)
      } finally {
        await fork.setPrice(original)
        await fork.refreshOracle()
      }
    },
    240_000,
  )

  // ---------------------------------------------------------------- MK-003 ----
  pins(
    'MK-003: the refinancing fee is charged on chain and modeled nowhere in the SDK',
    async () => {
      const borrower = testAccount(2004)
      await openAtIcr(borrower, 2_400_000_000_000_000_000n)
      const client = clientFor(borrower)

      // Compute the fee the contract WILL charge, independently, from the formula at
      // BorrowerOperations.sol:1033-1036 and the live governable percentage.
      const percentage = await connectFork().publicClient.readContract({
        address: T.borrowerOperations,
        abi: borrowerOperationsAbi,
        functionName: 'refinancingFeePercentage',
      })
      const debtBefore = await troveDebt(borrower.address)
      const netDebtBefore = debtBefore - MUSD_GAS_COMPENSATION
      const feeBase = (BigInt(percentage) * netDebtBefore) / 100n
      const expectedFee = await client.getBorrowingFee(feeBase)
      expect(
        expectedFee,
        'fixture: the refinancing fee must be non zero to be worth pinning',
      ).toBeGreaterThan(0n)

      await wait((await client.refinance()).hash)

      const debtAfter = await troveDebt(borrower.address)
      expect(
        debtAfter - debtBefore,
        'fixture: the contract must have capitalized at least the computed fee',
      ).toBeGreaterThanOrEqual(expectedFee)

      // THE FINDING. The SDK never reads `refinancingFeePercentage` and offers no way to
      // learn the fee before signing, so a caller cannot know their debt is about to grow.
      expect(
        typeof (client as unknown as Record<string, unknown>).previewRefinance,
        'MK-003: the SDK must expose the refinancing fee before the write, e.g. previewRefinance',
      ).toBe('function')
    },
    240_000,
  )

  // ---------------------------------------------------------------- MK-019 ----
  /**
   * Deliberately NOT a `pins` test. It was written as one, asserting that the Recovery Mode
   * restriction surfaces as the typed error, and it PASSED: the SDK already does that,
   * because simulate precedes send and `mapRevert` recognises the revert. The gap MK-019
   * still names, no up front mode check and no mention in the docstring, is not expressible
   * as a runtime assertion distinct from MK-003's missing preview. Recorded here as
   * verified behavior rather than dressed up as a failure.
   */
  it('MK-019 (verified correct today): refinance in Recovery Mode surfaces the typed error', async () => {
    const fork = connectFork()
    const borrower = testAccount(2005)
    const original = await livePrice()
    try {
      await openAtIcr(borrower, 2_600_000_000_000_000_000n)
      await fork.setPrice((original * 50n) / 100n)
      await fork.refreshOracle()

      const client = clientFor(borrower)
      expect(
        (await reader().getSystemState()).isRecoveryMode,
        'fixture: system must be in Recovery Mode',
      ).toBe(true)

      // `_refinance` calls `_requireNotInRecoveryMode` before anything else
      // (BorrowerOperations.sol:1024), so this always reverts. The SDK finds out only
      // because simulate precedes send.
      let caught: unknown
      try {
        await client.refinance()
      } catch (error) {
        caught = error
      }
      expect(caught, 'fixture: refinance must revert in Recovery Mode').toBeDefined()

      // VERIFIED, not pinned: the restriction DOES reach the caller as a typed error, so
      // a caller can branch on it. What MK-019 still names is the absence of an up front
      // mode check and of any mention in the `refinance()` docstring, neither of which a
      // runtime assertion can distinguish from MK-003's missing preview.
      expect(
        (caught as { code?: string }).code,
        'MK-019: the Recovery Mode restriction reaches the caller as a typed error',
      ).toBe('RECOVERY_MODE_RESTRICTION')
    } finally {
      await fork.setPrice(original)
      await fork.refreshOracle()
    }
  }, 240_000)

  // ---------------------------------------------------------------- MK-004 ----
  pins(
    'MK-004: previewOpen charges a borrowing fee Recovery Mode does not',
    async () => {
      const fork = connectFork()
      const anchor = testAccount(2006)
      const original = await livePrice()
      try {
        await openAtIcr(anchor, 2_600_000_000_000_000_000n)
        await fork.setPrice((original * 50n) / 100n)
        await fork.refreshOracle()

        const client = reader()
        const state = await client.getSystemState()
        expect(state.isRecoveryMode, 'fixture: system must be in Recovery Mode').toBe(true)

        const draw = 2_000n * MUSD
        const preview = await client.previewOpen({ collateral: BTC, debt: draw })
        expect(preview.isRecoveryMode, 'fixture: the preview must see Recovery Mode').toBe(true)

        // THE FINDING. In Recovery Mode `_openTrove` skips `_triggerBorrowingFee` entirely
        // (BorrowerOperations.sol:637-643), so the fee the contract charges is zero.
        expect(
          preview.fee,
          'MK-004: in Recovery Mode the contract charges no borrowing fee, so the preview must report none',
        ).toBe(0n)
      } finally {
        await fork.setPrice(original)
        await fork.refreshOracle()
      }
    },
    240_000,
  )

  pins(
    'MK-004: the phantom fee lifts a sub-floor draw over minNetDebt in the preview only',
    async () => {
      const fork = connectFork()
      const anchor = testAccount(2007)
      const original = await livePrice()
      try {
        await openAtIcr(anchor, 2_600_000_000_000_000_000n)
        await fork.setPrice((original * 50n) / 100n)
        await fork.refreshOracle()

        const client = reader()
        expect(
          (await client.getSystemState()).isRecoveryMode,
          'fixture: system must be in Recovery Mode',
        ).toBe(true)

        // Construct the band: draw < minNetDebt <= draw + fee. In Recovery Mode the
        // contract checks the floor against the bare draw (BorrowerOperations.sol:635-645),
        // so an open at this draw reverts, while the SDK adds a fee that lifts it over.
        const { minNetDebt } = await client.getConstants()
        const rate = await connectFork().publicClient.readContract({
          address: T.borrowerOperations,
          abi: borrowerOperationsAbi,
          functionName: 'borrowingRate',
        })
        // Largest draw strictly below the floor whose fee still carries it to the floor.
        const draw = minNetDebt - 1n
        const feeOnDraw = (draw * rate) / 10n ** 18n
        expect(draw, 'fixture: draw must be below the floor').toBeLessThan(minNetDebt)
        expect(
          draw + feeOnDraw,
          'fixture: draw plus fee must reach the floor for the band to exist',
        ).toBeGreaterThanOrEqual(minNetDebt)

        const preview = await client.previewOpen({ collateral: 5n * BTC, debt: draw })

        // THE FINDING. `meetsMinimum` is computed against draw + fee, but the contract in
        // Recovery Mode compares the bare draw, so the preview says yes to a reverting open.
        expect(
          preview.meetsMinimum,
          'MK-004: in Recovery Mode the floor applies to the bare draw, so this must not meet the minimum',
        ).toBe(false)
      } finally {
        await fork.setPrice(original)
        await fork.refreshOracle()
      }
    },
    240_000,
  )

  // ---------------------------------------------------------------- MK-005 ----
  pins(
    'MK-005: meetsRecoveryRequirement is true in normal mode for an open that reverts on ICR',
    async () => {
      const client = reader()
      const state = await client.getSystemState()
      expect(state.isRecoveryMode, 'fixture: system must be in NORMAL mode').toBe(false)

      // An open whose ICR is below MCR. Normal mode requires `ICR >= MCR`
      // (BorrowerOperations.sol:656-657), so this open reverts.
      const draw = 2_000n * MUSD
      const fee = await client.getBorrowingFee(draw)
      const entireDebt = draw + fee + MUSD_GAS_COMPENSATION
      const price = await livePrice()
      const collateral = (1_000_000_000_000_000_000n * entireDebt) / price // ICR ~1.0

      const preview = await client.previewOpen({ collateral, debt: draw })
      expect(preview.icr, 'fixture: the previewed ICR must be below MCR').toBeLessThan(MCR)

      const opener = testAccount(2008)
      await connectFork().fundAccount(opener.address, collateral + 5n * BTC)
      await expect(
        clientFor(opener).openTrove({ collateral, debt: draw }),
        'fixture: the contract must reject an open below MCR',
      ).rejects.toThrow()

      // THE FINDING. The only viability flag the preview carries is vacuously true in
      // normal mode, so it reports a requirement met for an open that cannot succeed.
      expect(
        preview.meetsRecoveryRequirement,
        'MK-005: the preview verdict must be false for an open the contract rejects',
      ).toBe(false)
    },
    240_000,
  )

  // ---------------------------------------------------------------- MK-006 ----
  pins(
    'MK-006: the SDK hint NICR uses entire debt where the contract uses principal',
    async () => {
      const borrower = testAccount(2009)
      const { collateral } = await openAtIcr(borrower, 2_400_000_000_000_000_000n)

      await accrueInterest()
      const [, principal, interest] = await entireDebtAndColl(borrower.address)
      expect(interest, 'fixture: some interest must be owed').toBeGreaterThan(0n)

      const contractNicr = await nominalICR(borrower.address)
      const expectedFromPrincipal = (collateral * 100n * 10n ** 18n) / principal
      expect(
        contractNicr,
        'fixture: the contract nominal ICR must be principal based (TroveManager.sol:566-577)',
      ).toBe(expectedFromPrincipal)

      // THE FINDING. `trove/index.ts` feeds `hintsFor` the ENTIRE debt, so the NICR it uses
      // for placement is not the NICR the contract sorts by.
      const sdkNicr = reader().computeNICR({ collateral, entireDebt: principal + interest })
      expect(
        sdkNicr,
        'MK-006: the hint NICR must equal the contract nominal ICR, which excludes interest',
      ).toBe(contractNicr)
    },
    240_000,
  )

  pins(
    'MK-006: a repay below interest owed moves principal by zero',
    async () => {
      const borrower = testAccount(2010)
      await openAtIcr(borrower, 2_400_000_000_000_000_000n)
      const client = clientFor(borrower)

      await accrueInterest()
      const [, principalBefore, interestBefore] = await entireDebtAndColl(borrower.address)
      expect(interestBefore, 'fixture: some interest must be owed').toBeGreaterThan(0n)

      const [collBefore] = await entireDebtAndColl(borrower.address)
      const entireDebtBefore = principalBefore + interestBefore
      const payment = interestBefore / 2n
      expect(payment, 'fixture: the payment must be strictly below interest owed').toBeLessThan(
        interestBefore,
      )
      expect(payment, 'fixture: the payment must be non zero').toBeGreaterThan(0n)

      await wait((await client.repay({ amount: payment })).hash)

      const [, principalAfter] = await entireDebtAndColl(borrower.address)
      // `calculateDebtAdjustment` applies the payment to interest first
      // (InterestRateMath.sol:33-48), so principal cannot fall.
      expect(
        principalAfter,
        'fixture: principal must not fall for a payment below interest owed',
      ).toBeGreaterThanOrEqual(principalBefore)
      const contractNicrAfter = await nominalICR(borrower.address)

      // THE FINDING. `repay` models debt as falling by the full payment and feeds that entire
      // debt to the hint, so the placement it computes is for a position that does not exist.
      // The contract's sort key is principal based and barely moved.
      const sdkProjectedNicr = reader().computeNICR({
        collateral: collBefore,
        entireDebt: entireDebtBefore - payment,
      })
      expect(
        sdkProjectedNicr,
        'MK-006: the NICR the SDK computes after a sub-interest repay must equal the contract sort key',
      ).toBe(contractNicrAfter)
    },
    240_000,
  )

  // ---------------------------------------------------------------- MK-014 ----
  pins(
    'MK-014: redeem returns the RATE in a field named fee',
    async () => {
      const fork = connectFork()
      const original = await livePrice()
      const redeemer = testAccount(2011)
      // Open a Trove to obtain MUSD to redeem with.
      await openAtIcr(redeemer, 3_000_000_000_000_000_000n, 3_000n * MUSD)
      const client = clientFor(redeemer)

      // The two getters, from BorrowerOperations.sol. `redemptionRate()` is the rate
      // (:129, :151); `getRedemptionRate(collateralDrawn)` is a fee AMOUNT (:499-509).
      const rate = await connectFork().publicClient.readContract({
        address: T.borrowerOperations,
        abi: borrowerOperationsAbi,
        functionName: 'redemptionRate',
      })
      const amountForOneBtc = await connectFork().publicClient.readContract({
        address: T.borrowerOperations,
        abi: borrowerOperationsAbi,
        functionName: 'getRedemptionRate',
        args: [BTC],
      })
      const amountForTenthBtc = await connectFork().publicClient.readContract({
        address: T.borrowerOperations,
        abi: borrowerOperationsAbi,
        functionName: 'getRedemptionRate',
        args: [BTC / 10n],
      })
      expect(amountForOneBtc, 'fixture: at one BTC the amount coincides with the rate').toBe(rate)
      expect(
        amountForTenthBtc,
        'fixture: away from one BTC the amount and the rate differ',
      ).not.toBe(rate)

      // Redeem at a raised price so the lowest redeemable Trove keeps comfortable margin
      // above MCR; otherwise `redeemCollateral` reverts with "Unable to redeem any amount"
      // and the assertion is never reached. The redemption fee is a price INDEPENDENT
      // fraction of the collateral drawn (BorrowerOperations.sol:499-509), so the rate this
      // test compares against is unaffected by the shim. Restored in `finally`.
      try {
        // Redeem at a doubled price so the lowest redeemable Trove keeps a wide margin over
        // MCR, and refresh-and-retry exactly as `phase6.fork.test.ts` does: a cold
        // `getRedemptionHints` traversal is slow enough that the oracle can go stale before
        // `redeemCollateral` mines. That mitigation is reused here, not invented, and no
        // existing mitigation is removed. The redemption fee is a price INDEPENDENT
        // fraction of the collateral drawn (BorrowerOperations.sol:499-509), so the rate
        // this test compares against is unaffected by the shim.
        await fork.setPrice(original * 2n)
        let result: Awaited<ReturnType<typeof client.redeem>> | undefined
        let lastError: unknown
        for (let attempt = 0; attempt < 4 && !result; attempt++) {
          await fork.refreshOracle()
          try {
            result = await client.redeem({ amount: 100n * MUSD })
          } catch (error) {
            lastError = error
          }
        }
        expect(result, `fixture: redemption did not mine: ${String(lastError)}`).toBeDefined()
        if (!result) throw new Error('unreachable')
        await wait(result.hash)

        // THE FINDING. The field named `fee` carries the rate verbatim, not an amount of
        // BTC. This fails the moment the field is renamed or its content corrected.
        expect(result.fee, 'MK-014: a field named fee must not be the raw redemptionRate').not.toBe(
          rate,
        )
      } finally {
        await fork.setPrice(original)
        await fork.refreshOracle()
      }
    },
    300_000,
  )

  // ---------------------------------------------------------------- MK-018 ----
  pins(
    'MK-018: previewOpen charges a fee the contract waives for a fee exempt account',
    async () => {
      const fork = connectFork()
      const exempt = testAccount(2012)

      // GovernableVariables is not in the SDK's bundled surface, which is part of the point:
      // the SDK has no concept of exemption. Load its address and ABI from the deployment
      // record, and act as governance by impersonation (`onlyGovernance` is council or
      // treasury, GovernableVariables.sol:22-24, :120).
      const record = (await import(
        '@mezo-org/musd-contracts/deployments/matsnet/GovernableVariables.json'
      )) as unknown as { default?: { address: Address }; address?: Address }
      const governableVariables = (record.default?.address ?? record.address) as Address
      const gvAbi = parseAbi([
        'function council() view returns (address)',
        'function isAccountFeeExempt(address) view returns (bool)',
        'function addFeeExemptAccount(address)',
      ])
      const council = await fork.publicClient.readContract({
        address: governableVariables,
        abi: gvAbi,
        functionName: 'council',
      })

      await fork.testClient.impersonateAccount({ address: council })
      await fork.fundAccount(council, 5n * BTC)
      const governance = createWalletClient({
        account: council,
        chain: mezoTestnet,
        transport: http(fork.rpcUrl),
      })
      const grant = await governance.writeContract({
        account: council,
        chain: mezoTestnet,
        address: governableVariables,
        abi: gvAbi,
        functionName: 'addFeeExemptAccount',
        args: [exempt.address],
      })
      await wait(grant)
      await fork.testClient.stopImpersonatingAccount({ address: council })

      expect(
        await fork.publicClient.readContract({
          address: governableVariables,
          abi: gvAbi,
          functionName: 'isAccountFeeExempt',
          args: [exempt.address],
        }),
        'fixture: the test account must be fee exempt on the fork',
      ).toBe(true)

      const client = reader()
      const draw = 2_000n * MUSD
      const preview = await client.previewOpen({ collateral: 2n * BTC, debt: draw })

      await openTroveRaw(fork, {
        collateralBtc: 2n * BTC,
        debtMusd: draw,
        account: exempt,
        numTrials: 15,
      })
      const actualDebt = await troveDebt(exempt.address)
      expect(
        actualDebt,
        'fixture: an exempt open must be charged no fee, so debt is draw plus the gas reserve',
      ).toBe(draw + MUSD_GAS_COMPENSATION)

      // THE FINDING. `previewOpen` applies `getBorrowingFee` unconditionally and takes no
      // account argument at all, so it cannot model exemption even in principle.
      expect(
        preview.entireDebt,
        'MK-018: the preview must match the debt an exempt account actually incurs',
      ).toBe(actualDebt)
    },
    300_000,
  )

  // A cheap, chain-free companion to the fork test above: the SDK has no concept of fee
  // exemption anywhere in its public surface. Kept because it states the gap structurally
  // rather than by observation.
  pins('MK-018: the SDK surface has no concept of fee exemption', async () => {
    const client = reader()
    const surface = Object.keys(client)
    expect(
      surface.some((key) => /exempt/i.test(key)),
      'MK-018: the client surface must expose fee exemption in some form',
    ).toBe(true)
  })
})
