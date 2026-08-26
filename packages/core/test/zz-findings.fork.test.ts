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
import { principalReductionForRepay } from '../src/trove'
import { connectFork } from './harness'
import { mezoTestnet } from './harness/constants'
import { reportRedemptionMargin } from './harness/explainReceipt'
import { recordMitigation } from './harness/mitigationLog'
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
 * NOTHING IN THIS FILE IS PINNED ANY MORE, as of the P3b wave.
 *
 * Every finding this file was written to pin has been fixed, so the `pins` helper that
 * wrapped each body in `it.fails` has nothing left to wrap and is removed rather than left
 * as dead code. No test was deleted: each one became an ordinary passing assertion in the
 * same commit as its fix, and together they are now the regression suite for MK-001 through
 * MK-006, MK-014, MK-018 and MK-019.
 *
 * To pin a new finding, restore one line and wrap the failing body with it:
 *
 *   const pins = process.env.MUSD_FINDINGS_RAW ? it : it.fails
 *
 * The mechanism and why it is preferred over a skip flag are documented in the header above.
 */

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
      await fork.mineBlocks(1)

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
      await fork.mineBlocks(1)
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
          await fork.mineBlocks(1)
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
      await fork.mineBlocks(1)
    }
  }, 300_000)

  // ---------------------------------------------------------------- MK-002 ----
  it('MK-002 (fixed): previewBorrow respects maxBorrowingCapacity, which never rises with price', async () => {
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
      await fork.mineBlocks(1)

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

      // FIXED. `getBorrowingPower` stays the OPEN time calculator it is documented to be,
      // so it is still allowed to exceed the capacity of an existing Trove. What is new is
      // `previewBorrow`, which models the gate the contract actually applies.
      const client = reader()
      const capacityView = await client.getBorrowingCapacity(borrower.address)
      expect(capacityView.capacity, 'the capacity read must match the chain').toBe(capacity)
      expect(capacityView.remaining, 'remaining must be capacity minus live entire debt').toBe(
        remaining,
      )

      // A draw inside the remaining headroom is viable; one beyond it is not, and names
      // the capacity gate as the binding constraint.
      const withinHeadroom = remaining / 2n
      const okPreview = await client.previewBorrow({
        owner: borrower.address,
        amount: withinHeadroom,
      })
      expect(okPreview.viable, 'a draw inside the headroom must be viable').toBe(true)

      const overPreview = await client.previewBorrow({
        owner: borrower.address,
        amount: remaining + 10n ** 18n,
      })
      expect(
        overPreview.viable,
        'MK-002: a draw beyond the remaining capacity must not be viable',
      ).toBe(false)
      expect(overPreview.reasons).toContain('EXCEEDS_BORROWING_CAPACITY')
      expect(overPreview.bindingConstraint).toBe('EXCEEDS_BORROWING_CAPACITY')

      // And the write path refuses it BEFORE simulate, with the real numbers attached.
      await expect(
        clientFor(borrower).borrow({ amount: remaining + 10n ** 18n }),
        'MK-002: borrow must precheck the capacity gate',
      ).rejects.toMatchObject({ code: 'EXCEEDS_BORROWING_CAPACITY' })
    } finally {
      await fork.setPrice(original)
      await fork.mineBlocks(1)
    }
  }, 240_000)

  // ---------------------------------------------------------------- MK-003 ----
  it('MK-003 (fixed): previewRefinance reports the fee the contract actually charges', async () => {
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

    // The preview, taken BEFORE the write, must name the same fee and the same resulting
    // principal the contract then produces.
    const preview = await client.previewRefinance(borrower.address)
    expect(preview.viable, 'fixture: a normal mode refinance must be viable').toBe(true)
    expect(preview.reasons).toEqual([])
    expect(
      preview.refinancingFeePercentage,
      'the percentage must be READ from the chain, not hardcoded',
    ).toBe(Number(percentage))
    expect(preview.fee, 'MK-003: the previewed fee must equal the contract formula').toBe(
      expectedFee,
    )
    const principalBefore = (await entireDebtAndColl(borrower.address))[1]
    expect(preview.resultingPrincipal, 'MK-003: the fee is capitalized into principal').toBe(
      principalBefore + expectedFee,
    )

    await wait((await client.refinance()).hash)

    const debtAfter = await troveDebt(borrower.address)
    expect(
      debtAfter - debtBefore,
      'fixture: the contract must have capitalized at least the computed fee',
    ).toBeGreaterThanOrEqual(expectedFee)

    // And the hint the SDK placed by describes the position that NOW exists: the sort key
    // includes the capitalized fee.
    const [collAfter, principalAfter] = await entireDebtAndColl(borrower.address)
    expect(
      reader().computeNICR({ collateral: collAfter, entireDebt: principalAfter }),
      'MK-003: the post-refinance sort key must match what the SDK computed hints from',
    ).toBe(await nominalICR(borrower.address))

    // FIXED. The preview reports the fee, and the numbers match the contract's own.
    expect(
      typeof (client as unknown as Record<string, unknown>).previewRefinance,
      'MK-003: the SDK must expose the refinancing fee before the write',
    ).toBe('function')
  }, 240_000)

  // ---------------------------------------------------------------- MK-019 ----
  /**
   * MK-019 closes here. It was never a safety gap: simulate before send already surfaced the
   * revert as a typed `RECOVERY_MODE_RESTRICTION`, which this test asserted and which still
   * holds. What was missing was that the restriction could not be learned WITHOUT sending,
   * and was documented nowhere. `previewRefinance` and the `refinance()` docstring close
   * both, so the test now asserts the preview as well as the typed error.
   */
  it('MK-019 (fixed): refinance in Recovery Mode is previewable AND typed', async () => {
    const fork = connectFork()
    const borrower = testAccount(2005)
    const original = await livePrice()
    try {
      await openAtIcr(borrower, 2_600_000_000_000_000_000n)
      await fork.setPrice((original * 50n) / 100n)
      await fork.mineBlocks(1)

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

      // The typed error already reached the caller before this wave, and still does.
      expect(
        (caught as { code?: string }).code,
        'MK-019: the Recovery Mode restriction reaches the caller as a typed error',
      ).toBe('RECOVERY_MODE_RESTRICTION')

      // FIXED. What was missing is now present: the restriction is PREVIEWABLE, so a caller
      // can learn it without sending anything and paying for a failed simulate.
      const preview = await client.previewRefinance(borrower.address)
      expect(preview.viable, 'MK-019: a Recovery Mode refinance must not be viable').toBe(false)
      expect(preview.reasons).toContain('RECOVERY_MODE')
      expect(
        preview.bindingConstraint,
        'MK-019: Recovery Mode is the contract FIRST requirement, so it binds first',
      ).toBe('RECOVERY_MODE')
    } finally {
      await fork.setPrice(original)
      await fork.mineBlocks(1)
    }
  }, 240_000)

  // ---------------------------------------------------------------- MK-004 ----
  it('MK-004 (fixed): previewOpen charges no borrowing fee in Recovery Mode', async () => {
    const fork = connectFork()
    const anchor = testAccount(2006)
    const original = await livePrice()
    try {
      await openAtIcr(anchor, 2_600_000_000_000_000_000n)
      await fork.setPrice((original * 50n) / 100n)
      await fork.mineBlocks(1)

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
      await fork.mineBlocks(1)
    }
  }, 240_000)

  it('MK-004 (fixed): the sub-floor band is closed, the preview no longer lifts a draw over the floor', async () => {
    const fork = connectFork()
    const anchor = testAccount(2007)
    const original = await livePrice()
    try {
      await openAtIcr(anchor, 2_600_000_000_000_000_000n)
      await fork.setPrice((original * 50n) / 100n)
      await fork.mineBlocks(1)

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

      // FIXED. `meetsMinimum` is computed against the netDebt the CONTRACT will see. In
      // Recovery Mode that is the bare draw, so the band where draw < floor <= draw + fee
      // no longer reports the floor met for an open that reverts.
      expect(
        preview.meetsMinimum,
        'MK-004: in Recovery Mode the floor applies to the bare draw, so this must not meet the minimum',
      ).toBe(false)
      expect(preview.viable).toBe(false)
      expect(preview.reasons).toContain('BELOW_MINIMUM_DEBT')
    } finally {
      await fork.setPrice(original)
      await fork.mineBlocks(1)
    }
  }, 240_000)

  // ---------------------------------------------------------------- MK-005 ----
  it('MK-005 (fixed): the open preview reports a verdict plus reasons, not a vacuous flag', async () => {
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

    // FIXED. `meetsRecoveryRequirement` is gone; the preview carries an explicit verdict
    // plus machine readable reasons, and it says no to an open the contract rejects.
    expect(
      preview.viable,
      'MK-005: the preview verdict must be false for an open the contract rejects',
    ).toBe(false)
    expect(preview.reasons).toContain('ICR_BELOW_THRESHOLD')
    expect(preview.bindingConstraint).toBe('ICR_BELOW_THRESHOLD')
  }, 240_000)

  // ---------------------------------------------------------------- MK-006 ----
  it('MK-006 (fixed): the SDK hint basis equals the contract sort key, which excludes interest', async () => {
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

    // FIXED. `hintsFor` is now fed PRINCIPAL, so the NICR the SDK places by is the NICR the
    // contract sorts by. Every on-chain re-insert passes `_computeNominalCR(coll, principal)`:
    // BorrowerOperations.sol:902-906, :1087-1088, and TroveManager.sol:1287-1290.
    expect(
      reader().computeNICR({ collateral, entireDebt: principal }),
      'MK-006: the hint NICR must equal the contract nominal ICR',
    ).toBe(contractNicr)

    // And the distinction is real on this fixture, not a coincidence: the old basis differs.
    expect(
      reader().computeNICR({ collateral, entireDebt: principal + interest }),
      'the entire-debt basis must NOT equal the sort key, or this test proves nothing',
    ).not.toBe(contractNicr)
  }, 240_000)

  it('MK-006 (fixed): the repay projection mirrors the contract split at, below and above interest owed', async () => {
    // Three payment sizes against the SAME boundary the contract branches on,
    // `payment >= interestOwed` (InterestRateMath.sol:41-47): strictly below, exactly
    // equal, and strictly above. Each is compared against the CONTRACT's actual principal
    // after the repay, never against the SDK's own earlier output.
    const cases = [
      { label: 'below interest owed', account: testAccount(2010), size: 'below' as const },
      { label: 'exactly interest owed', account: testAccount(2017), size: 'equal' as const },
      { label: 'above interest owed', account: testAccount(2018), size: 'above' as const },
    ]

    for (const { label, account, size } of cases) {
      await openAtIcr(account, 2_400_000_000_000_000_000n)
      const client = clientFor(account)
      await accrueInterest()

      const [collBefore, principalBefore, interestBefore] = await entireDebtAndColl(account.address)
      expect(interestBefore, `${label}: fixture, some interest must be owed`).toBeGreaterThan(0n)

      const payment =
        size === 'below'
          ? interestBefore / 2n
          : size === 'equal'
            ? interestBefore
            : interestBefore + 50n * MUSD

      // The SDK's projection, from the exported helper the write paths use.
      const projectedPrincipal =
        principalBefore - principalReductionForRepay(interestBefore, payment)

      await wait((await client.repay({ amount: payment })).hash)
      const [collAfter, principalAfter] = await entireDebtAndColl(account.address)

      // Interest keeps accruing between the read and the mine, so the contract's actual
      // principal can only be LOWER than or equal to the projection when more interest had
      // accrued by mine time, never higher: principal falls by `payment - interestOwed` and
      // interestOwed only grows. Assert the direction and the exact zero case.
      if (size === 'below' || size === 'equal') {
        expect(
          principalAfter,
          `${label}: principal must not move (InterestRateMath.sol:41-47)`,
        ).toBe(principalBefore)
        expect(projectedPrincipal, `${label}: the SDK must project no principal change`).toBe(
          principalBefore,
        )
      } else {
        expect(principalAfter, `${label}: principal must fall`).toBeLessThan(principalBefore)
        // Direction DERIVED, not guessed: the first version of this assertion had it
        // backwards and the fork caught it on a later run.
        //   principalAfter = principalBefore - (payment - interestOwedAtMine)
        //   projected      = principalBefore - (payment - interestOwedAtRead)
        //   principalAfter - projected = interestOwedAtMine - interestOwedAtRead >= 0
        // because interest only accrues between the read and the mine. So the contract's
        // principal is at or ABOVE the projection, and the gap is that accrual.
        expect(
          principalAfter,
          `${label}: the contract principal must be at or above the projection`,
        ).toBeGreaterThanOrEqual(projectedPrincipal)
        expect(
          principalAfter - projectedPrincipal,
          `${label}: the read-to-mine gap must be bounded by the payment, or the split is wrong`,
        ).toBeLessThan(payment)
      }

      // The hint the SDK would place by must be the contract's post-repay sort key.
      expect(collAfter, `${label}: collateral must not move on a repay`).toBe(collBefore)
      expect(
        reader().computeNICR({ collateral: collAfter, entireDebt: principalAfter }),
        `${label}: MK-006, the SDK hint basis must equal the contract sort key after the repay`,
      ).toBe(await nominalICR(account.address))
    }
  }, 420_000)

  // ---------------------------------------------------------------- MK-014 ----
  it('MK-014 (fixed): the redemption result names its units, rate and amount separately', async () => {
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
    expect(amountForTenthBtc, 'fixture: away from one BTC the amount and the rate differ').not.toBe(
      rate,
    )

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
      // MK-016: the four attempt retry is gone. Measured before removal, 10 invocations over
      // ten coverage runs, `attempts=1` on all 10, and its stated reason (oracle staleness)
      // is impossible per MK-032. The `mineBlocks(1)` stays: it puts the redeem on a fresh
      // block, which is a real dependency, and it was previously spelled `refreshOracle()`.
      await fork.mineBlocks(1)
      await reportRedemptionMargin(fork.publicClient, 'zz-findings/MK-014', 100n * MUSD)
      const result = await client.redeem({ amount: 100n * MUSD })
      recordMitigation({ name: 'zzFindingsRedeemRetry', attempts: 1, outcome: 'ok' })
      await wait(result.hash)

      // FIXED. There is no field named `fee` any more. The rate is named as a rate, and
      // the fee AMOUNT is returned separately, in BTC wei, alongside the collateral it was
      // estimated against.
      expect(
        (result as unknown as Record<string, unknown>).fee,
        'MK-014: the ambiguous `fee` field must be gone',
      ).toBeUndefined()
      expect(
        result.redemptionRate,
        'MK-014: the rate field carries the rate, and is named for it',
      ).toBe(rate)

      // The amount is a genuinely different number from the rate, computed by the contract
      // from the collateral drawn (BorrowerOperations.sol:499-508), not a relabelling.
      expect(result.estimatedCollateralDrawn).toBeGreaterThan(0n)
      const expectedAmount = await connectFork().publicClient.readContract({
        address: T.borrowerOperations,
        abi: borrowerOperationsAbi,
        functionName: 'getRedemptionRate',
        args: [result.estimatedCollateralDrawn],
      })
      expect(
        result.estimatedFeeCollateral,
        'MK-014: the fee amount must come from getRedemptionRate(collateralDrawn)',
      ).toBe(expectedAmount)
      expect(
        result.estimatedFeeCollateral,
        'MK-014: at this size the amount and the rate must not coincide',
      ).not.toBe(result.redemptionRate)
    } finally {
      await fork.setPrice(original)
      await fork.mineBlocks(1)
    }
  }, 300_000)

  // ---------------------------------------------------------------- MK-018 ----
  it('MK-018 (fixed): previewOpen waives the fee for a fee exempt account', async () => {
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
    const preview = await client.previewOpen({
      collateral: 2n * BTC,
      debt: draw,
      account: exempt.address,
    })

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

    // FIXED. `previewOpen` now takes the account and reads
    // `GovernableVariables.isAccountFeeExempt`, so it charges what the contract charges.
    expect(
      preview.entireDebt,
      'MK-018: the preview must match the debt an exempt account actually incurs',
    ).toBe(actualDebt)
    expect(preview.feeExempt, 'MK-018: the preview must report the exemption').toBe(true)
    expect(preview.fee, 'MK-018: an exempt account is charged no fee').toBe(0n)
  }, 300_000)

  // A cheap, chain-free companion to the fork test above: the SDK has no concept of fee
  // exemption anywhere in its public surface. Kept because it states the gap structurally
  // rather than by observation.
  it('MK-018 (fixed): the open preview surfaces fee exemption', async () => {
    // The concept now exists on the public surface: `previewOpen` accepts an `account` and
    // reports `feeExempt`. A non exempt account reports false and is charged the fee.
    const client = reader()
    const preview = await client.previewOpen({
      collateral: BTC,
      debt: 2_000n * MUSD,
      account: testAccount(2016).address,
    })
    expect(preview.feeExempt, 'a non exempt account must report feeExempt false').toBe(false)
    expect(preview.fee, 'a non exempt account in normal mode pays a fee').toBeGreaterThan(0n)
  })

  /**
   * MK-035, OPEN. The paired findings test for an SDK defect, not a harness one.
   *
   * `simulateAndSend` (`packages/core/src/internal/write.ts`) simulates, then sends the
   * request viem builds. The gas limit on that transaction comes from an `eth_estimateGas`
   * taken BEFORE the block the transaction mines in. For a call whose cost depends on state
   * that keeps moving, that estimate can be too small by the time it executes, and the
   * failure is invisible in the receipt: the EVM forwards at most 63/64 of the remaining gas
   * to a nested call, so an inner frame exhausts its allowance while the outer frame keeps
   * the last 1/64 and the receipt reports `gasUsed < gasLimit`.
   *
   * Measured on this fork, same call from byte identical snapshot state, 40 attempts:
   * the work ranged from 610270 to 710023 gas, a 16% swing, against a fixed limit of 720980.
   * Two of the 40 reverted, and the trace named `ActivePool` running out of gas at call
   * depth 4 inside `redeemCollateral`.
   *
   * This test does NOT reproduce the revert, deliberately: a 5% event is not something to
   * assert on. It pins the CAUSE instead, which is deterministic. When the SDK adds headroom
   * over the estimate, this flips, and that is the signal the finding is addressed.
   */
  it('MK-035 (fixed): a write ships a gas margin sized to the measured variance', async () => {
    const fork = connectFork()
    const account = testAccount(2035)
    await fork.fundAccount(account.address, 5n * BTC)
    const client = clientFor(account)

    // Snapshot and revert around the write. This test OPENS a Trove, which mutates the
    // SortedTroves list every later file redeems and liquidates against, and this file runs
    // before the react ones. Leaving that behind is the fixture coupling MK-016 is about, and
    // it was measured: adding this test without the snapshot took a ten run window from two
    // red to five.
    const snapshotId = await fork.testClient.snapshot()
    let sent: Awaited<ReturnType<typeof fork.publicClient.getTransaction>>
    let receipt: Awaited<ReturnType<typeof fork.publicClient.waitForTransactionReceipt>>
    try {
      const { hash } = await client.openTrove({ collateral: (5n * BTC) / 10n, debt: 5_000n * MUSD })
      ;[sent, receipt] = await Promise.all([
        fork.publicClient.getTransaction({ hash }),
        fork.publicClient.waitForTransactionReceipt({ hash }),
      ])
    } finally {
      await fork.testClient.revert({ id: snapshotId })
    }
    const marginPercent = Number(((sent.gas - receipt.gasUsed) * 1000n) / receipt.gasUsed) / 10
    console.log(
      `[MK-035] sentGasLimit=${sent.gas} gasUsed=${receipt.gasUsed} margin=${marginPercent}%`,
    )

    // This assertion was the INVERSE of itself until the fix landed: it asserted the margin
    // was under 25%, and it was 1.5%. It is kept pointing the same way round so the flip is
    // visible in the history rather than described in a comment.
    //
    // The bar is the measurement that sized the default. Worst typical spread across all nine
    // measurable write paths was 10.16% (addCollateral); the worst tail growth traced was
    // 16.4% (a redeem that grew 610270 to 710023 and reverted). The margin must clear both.
    expect(
      marginPercent,
      'MK-035: the shipped margin must exceed the worst tail growth measured (16.4%)',
    ).toBeGreaterThan(16.4)

    // And it must not be extravagant: the caller has to hold gasLimit * gasPrice up front,
    // so an unbounded buffer is a real cost even though unused gas is refunded.
    expect(marginPercent, 'MK-035: the margin is bounded, not a blank cheque').toBeLessThan(40)
  }, 300_000)
})
