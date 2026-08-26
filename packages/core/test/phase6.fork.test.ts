import {
  http,
  type Address,
  type Hex,
  type PrivateKeyAccount,
  createWalletClient,
  parseEventLogs,
} from 'viem'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  CCR,
  MCR,
  NothingToLiquidate,
  type RedeemParams,
  type RedeemResult,
  createMusdClient,
  getAddresses,
  hintHelpersAbi,
  musdAbi,
  priceFeedAbi,
  troveManagerAbi,
} from '../src'
import { connectFork } from './harness'
import { mezoTestnet } from './harness/constants'
import { explainTransaction, reportRedemptionMargin } from './harness/explainReceipt'
import { recordMitigation } from './harness/mitigationLog'
import { openTroveRaw, testAccount } from './harness/openTroveRaw'

const T = getAddresses(31611)
const MUSD = 10n ** 18n
const BTC = 10n ** 18n
function clientFor(account: PrivateKeyAccount) {
  const fork = connectFork()
  const walletClient = createWalletClient({
    account,
    chain: mezoTestnet,
    transport: http(fork.rpcUrl),
  })
  return createMusdClient({ chainId: 31611, publicClient: fork.publicClient, walletClient })
}
const wait = (hash: Hex) => connectFork().publicClient.waitForTransactionReceipt({ hash })
const price = () =>
  connectFork().publicClient.readContract({
    address: T.priceFeed,
    abi: priceFeedAbi,
    functionName: 'fetchPrice',
  })
const statusOf = (a: Address) =>
  connectFork().publicClient.readContract({
    address: T.troveManager,
    abi: troveManagerAbi,
    functionName: 'getTroveStatus',
    args: [a],
  })
const icrAt = async (a: Address) =>
  connectFork().publicClient.readContract({
    address: T.troveManager,
    abi: troveManagerAbi,
    functionName: 'getCurrentICR',
    args: [a, await price()],
  })

async function walletWrite(
  account: PrivateKeyAccount,
  to: Address,
  abi: readonly unknown[],
  fn: string,
  args: readonly unknown[],
) {
  const fork = connectFork()
  // biome-ignore lint/suspicious/noExplicitAny: test helper dynamic dispatch
  const params: any = { account, address: to, abi, functionName: fn, args }
  const { request } = await fork.publicClient.simulateContract(params)
  const wallet = createWalletClient({ account, chain: mezoTestnet, transport: http(fork.rpcUrl) })
  return wait(await wallet.writeContract(request))
}

/**
 * Redeem once, at a fresh block.
 *
 * **The four attempt retry is gone (MK-016).** Measured before removal: 30 invocations over
 * ten `pnpm test:coverage` runs, `attempts=1` on all 30. It never retried in a passing run.
 * Its stated reason was oracle staleness, which MK-032 established the shim makes
 * impossible, so it was a loop with no mechanism, no observed benefit, and the cost that a
 * redemption failing three times before succeeding looked identical to one that worked.
 *
 * The `mineBlocks(1)` is kept and is NOT a retry: it puts the redeem on a fresh block, which
 * is what the call sites around it depend on. It was previously spelled `refreshOracle()`.
 */
async function redeemFresh(
  client: { redeem(p: RedeemParams): Promise<RedeemResult> },
  params: RedeemParams,
): Promise<RedeemResult> {
  await connectFork().mineBlocks(1)
  await reportRedemptionMargin(connectFork().publicClient, 'phase6/redeemFresh', params.amount)
  const result = await client.redeem(params)
  recordMitigation({ name: 'redeemFresh', attempts: 1, outcome: 'ok' })
  return result
}

describe('Phase 6, redemption + liquidation keeper surface', () => {
  let originalPrice: bigint
  beforeAll(async () => {
    const fork = connectFork()
    originalPrice = await price()
    // Warm the redeemable tail so getRedemptionHints/redeem are fast.
    await fork.publicClient.readContract({
      address: T.hintHelpers,
      abi: hintHelpersAbi,
      functionName: 'getRedemptionHints',
      args: [3_000n * MUSD, originalPrice, 100n],
    })
  }, 240_000)

  it('redemption: fee = redemptionRate for loan-holder AND no-loan (0%-loan-holder rule does NOT hold); truncation surfaced', async () => {
    const fork = connectFork()
    const rate = await fork.publicClient.readContract({
      address: T.borrowerOperations,
      abi: (await import('../src')).borrowerOperationsAbi,
      functionName: 'redemptionRate',
    })

    const R = testAccount(1000)
    await openTroveRaw(fork, {
      collateralBtc: 2n * BTC,
      debtMusd: 50_000n * MUSD,
      account: R,
      numTrials: 15,
    })
    const musdR = clientFor(R)
    const redemptionEv = async (hash: Hex) => {
      const ev = parseEventLogs({
        abi: troveManagerAbi,
        logs: (await wait(hash)).logs,
        eventName: 'Redemption',
      })[0]
      // MK-031. This used to be `[0]!` followed by `.args`, so a redeem that reverted, or
      // mined without emitting, surfaced as `TypeError: Cannot read properties of undefined
      // (reading 'args')` and destroyed its own cause. That is exactly MK-024's complaint
      // about the sibling liquidation test. Failing with what the chain did is not a softer
      // assertion: the test still fails, it just says why.
      if (!ev) {
        throw new Error(
          await explainTransaction(connectFork().publicClient, hash, 'Redemption event'),
        )
      }
      return ev.args
    }

    // The fork's lowest ~12 Troves are underwater (ICR 0.89-1.03 < MCR) and the first
    // redeemable Trove sits at a thin margin above MCR, so this redeems at a +50% price to
    // give it comfortable headroom (≈1.35). The redemption fee is a price-INDEPENDENT
    // fraction (collateralFee / collateralSent = redemptionRate), so every rate assertion
    // still holds, and the price is restored in `finally` so later files are unaffected.
    //
    // MK-032: this comment used to explain the +50% as a defence against the oracle going
    // stale between the hint and the mine. It cannot: `OracleShim.sol:24-29` reports
    // `timestamp()` as `updatedAt`, so the staleness guard never trips, verified by warping
    // 30 days with no refresh. The manoeuvre still works, and the honest description of why
    // is simply that a higher price lifts every ICR away from MCR, which makes the marginal
    // Trove robust to whatever the real variable turns out to be.
    const origPrice = await musdR.getOraclePrice()
    try {
      await fork.setPrice((origPrice * 3n) / 2n)
      await fork.mineBlocks(1)
      expect((await musdR.getSystemState()).isRecoveryMode).toBe(false) // redemption needs TCR ≥ MCR

      // Redeem 5,000: enough to fully close the lowest one or two Troves (each ~2,200 debt)
      // rather than leave one below minNetDebt (an invalid partial → "Unable to redeem any
      // amount"). truncatedAmount is whatever those whole Troves sum to.
      const res = await redeemFresh(musdR, { amount: 5_000n * MUSD })
      expect(res.redemptionRate).toBe(rate) // MK-014: the RATE field, named as a rate
      expect(res.truncatedAmount).toBeGreaterThan(0n)
      const evR = await redemptionEv(res.hash)
      const feeFracR = Number(evR._collateralFee) / Number(evR._collateralSent + evR._collateralFee)
      console.log(
        `[phase6] LOAN-HOLDER feeFrac=${feeFracR} (rate=${Number(rate) / 1e16}%) actual=${evR._actualAmount}`,
      )
      expect(evR._actualAmount).toBeGreaterThan(0n)
      expect(Math.abs(feeFracR - Number(rate) / 1e18)).toBeLessThan(0.001)

      // No-loan redeemer pays the SAME rate (disproving the "0% for loan holders" rule).
      const N = testAccount(1001)
      await fork.fundAccount(N.address, 5n * BTC)
      await walletWrite(R, T.musd, musdAbi, 'transfer', [N.address, 8_000n * MUSD])
      // MK-032. Same reasoning as the hooks file: report the redeemable margin before each
      // redeem, on every run. The loan holder redeem above has just consumed part of the
      // tail, so this is the quantity that decides whether the no-loan redeem can do
      // anything, and it is the number missing from every past diagnosis of this test.
      const [, , redeemableN] = await fork.publicClient.readContract({
        address: T.hintHelpers,
        abi: hintHelpersAbi,
        functionName: 'getRedemptionHints',
        args: [5_000n * MUSD, await price(), 100n],
      })
      console.log(`[phase6] NO-LOAN pre-redeem margin: requested=5000e18 redeemable=${redeemableN}`)
      const resN = await redeemFresh(clientFor(N), { amount: 5_000n * MUSD })
      const evN = await redemptionEv(resN.hash)
      const feeFracN = Number(evN._collateralFee) / Number(evN._collateralSent + evN._collateralFee)
      console.log(`[phase6] NO-LOAN feeFrac=${feeFracN}`)
      expect(Math.abs(feeFracN - feeFracR)).toBeLessThan(0.0005)

      // Truncation: redeemCollateral requires requested ≤ caller's balance, so request all
      // of R's balance but cap iterations → only a few Troves redeemable → truncated < requested.
      const rBal = await fork.publicClient.readContract({
        address: T.musd,
        abi: musdAbi,
        functionName: 'balanceOf',
        args: [R.address],
      })
      const resT = await redeemFresh(musdR, { amount: rBal, maxIterations: 2n })
      expect(resT.truncatedAmount).toBeLessThan(rBal)
      console.log(`[phase6] TRUNCATION: requested=${rBal} truncated=${resT.truncatedAmount}`)
      await wait(resT.hash)
    } finally {
      await fork.setPrice(origPrice)
      await fork.mineBlocks(1)
    }
  }, 600_000)

  it('normal-mode liquidation: isLiquidatable transitions, reward (200 + 0.5%), status → 3', async () => {
    const fork = connectFork()
    try {
      const B = testAccount(1003)
      const coll = BTC / 10n
      const entireDebtTarget = (coll * originalPrice) / 1_130_000_000_000_000_000n
      const fee = await fork.publicClient.readContract({
        address: T.borrowerOperations,
        abi: (await import('../src')).borrowerOperationsAbi,
        functionName: 'getBorrowingFee',
        args: [entireDebtTarget],
      })
      await openTroveRaw(fork, {
        collateralBtc: coll,
        debtMusd: entireDebtTarget - 200n * MUSD - fee,
        account: B,
        numTrials: 15,
      })

      const LQ = testAccount(1004)
      await fork.fundAccount(LQ.address, 5n * BTC)
      const musdLQ = clientFor(LQ)

      expect(await musdLQ.isLiquidatable(B.address)).toBe(false) // ICR ~1.13 > MCR
      await fork.setPrice((originalPrice * 100n) / 113n) // B's ICR ~1.0 < MCR
      expect(await musdLQ.isLiquidatable(B.address)).toBe(true)

      const lq = await musdLQ.liquidate(B.address)
      const liqEvent = parseEventLogs({
        abi: troveManagerAbi,
        logs: (await wait(lq.hash)).logs,
        eventName: 'Liquidation',
      })[0]
      // MK-031, the same repair as `redemptionEv` above and the one MK-024 asked for by
      // name: this is the exact line whose `[0]!.args` produced a bare TypeError and hid
      // whether the liquidation reverted, liquidated nothing, or emitted something else.
      if (!liqEvent) {
        throw new Error(await explainTransaction(fork.publicClient, lq.hash, 'Liquidation event'))
      }
      const liqEv = liqEvent.args
      console.log(
        `[phase6] liquidation reward: gasComp=${liqEv._gasCompensation} collGasComp=${liqEv._collGasCompensation} (coll=${liqEv._liquidatedColl})`,
      )
      expect(liqEv._gasCompensation).toBe(200n * MUSD) // 200 MUSD
      // 0.5% of the ORIGINAL coll; _liquidatedColl is the remainder (coll − comp).
      expect(liqEv._collGasCompensation).toBe(
        (liqEv._liquidatedColl + liqEv._collGasCompensation) / 200n,
      )
      expect(await statusOf(B.address)).toBe(3) // closedByLiquidation
    } finally {
      await fork.setPrice(originalPrice)
    }
  }, 180_000)

  it('batchLiquidate: two under-MCR Troves closed in one call', async () => {
    const fork = connectFork()
    try {
      const accts = [testAccount(1005), testAccount(1006)]
      for (const a of accts) {
        const coll = BTC / 10n
        const edt = (coll * originalPrice) / 1_120_000_000_000_000_000n
        const fee = await fork.publicClient.readContract({
          address: T.borrowerOperations,
          abi: (await import('../src')).borrowerOperationsAbi,
          functionName: 'getBorrowingFee',
          args: [edt],
        })
        await openTroveRaw(fork, {
          collateralBtc: coll,
          debtMusd: edt - 200n * MUSD - fee,
          account: a,
          numTrials: 15,
        })
      }
      const LQ = testAccount(1007)
      await fork.fundAccount(LQ.address, 5n * BTC)
      await fork.setPrice((originalPrice * 100n) / 113n)
      const r = await clientFor(LQ).batchLiquidate(accts.map((a) => a.address))
      await wait(r.hash)
      for (const a of accts) expect(await statusOf(a.address)).toBe(3)
    } finally {
      await fork.setPrice(originalPrice)
    }
  }, 180_000)

  it('Recovery Mode: detection + isLiquidatable has NO CCR widening (MK-001) + a real RM liquidation', async () => {
    const fork = connectFork()
    try {
      const open = async (acct: PrivateKeyAccount, coll: bigint, icrAtOrig: bigint) => {
        const edt = (coll * originalPrice) / icrAtOrig
        const fee = await fork.publicClient.readContract({
          address: T.borrowerOperations,
          abi: (await import('../src')).borrowerOperationsAbi,
          functionName: 'getBorrowingFee',
          args: [edt],
        })
        await openTroveRaw(fork, {
          collateralBtc: coll,
          debtMusd: edt - 200n * MUSD - fee,
          account: acct,
          numTrials: 15,
        })
      }
      // U: under-MCR in RM (liquidatable via redistribution). B: MCR≤ICR<CCR. C: ICR≥CCR.
      const U = testAccount(1010)
      const B = testAccount(1011)
      const C = testAccount(1012)
      await open(U, BTC / 10n, 1_130_000_000_000_000_000n) // 1.13 → ~0.56 in RM
      await open(B, (2n * BTC) / 10n, 2_400_000_000_000_000_000n) // 2.4 → ~1.2 in RM
      await open(C, (3n * BTC) / 10n, 3_400_000_000_000_000_000n) // 3.4 → ~1.7 in RM
      const LQ = testAccount(1013)
      await fork.fundAccount(LQ.address, 5n * BTC)
      const musdLQ = clientFor(LQ)

      await fork.setPrice(originalPrice / 2n) // drive RM
      expect((await musdLQ.getSystemState()).isRecoveryMode).toBe(true)
      const icrB = await icrAt(B.address)
      console.log(`[phase6] RM: icrB=${icrB} (MCR=${MCR} CCR=${CCR})`)
      expect(icrB).toBeGreaterThanOrEqual(MCR)
      expect(icrB).toBeLessThan(CCR)
      // REGRESSION, MK-001. This block used to assert `isLiquidatable(B) === true` and
      // defended it with an invented "ICR < TCR plus Stability Pool cover" rule that does
      // not exist in this fork. That comment is deleted rather than reworded: it was the
      // reason the wrong rule survived review. `TroveManager.sol` contains no reference to
      // `CCR`, and the only gate is `if (vars.ICR < MCR)` at `TroveManager.sol:1148`, so
      // Recovery Mode widens nothing. B sits at MCR <= ICR < CCR and is NOT liquidatable.
      expect(await musdLQ.isLiquidatable(U.address)).toBe(true)
      expect(await musdLQ.isLiquidatable(B.address)).toBe(false)
      expect(await musdLQ.isLiquidatable(C.address)).toBe(false)

      // And the protocol agrees: liquidating B reverts. The old test never exercised its
      // own claim, it liquidated a different Trove, the under-MCR one.
      await expect(musdLQ.liquidate(B.address)).rejects.toThrow()
      expect(await statusOf(B.address)).toBe(1) // still active

      // A real RM liquidation: the under-MCR Trove liquidates (redistribution) in RM.
      await wait((await musdLQ.liquidate(U.address)).hash)
      expect(await statusOf(U.address)).toBe(3)
    } finally {
      await fork.setPrice(originalPrice)
    }
  }, 180_000)

  it('claim: a fully-redeemed Trove leaves surplus its owner claims', async () => {
    const fork = connectFork()
    // M opens at the very bottom of the redeemable list → a redemption fully consumes it
    // (status 4, closedByRedemption) and its leftover collateral is claimable.
    const M = testAccount(1015)
    const p = await price()
    const coll = (2n * BTC) / 10n // 0.2 BTC
    const edt = (coll * p) / 1_101_000_000_000_000_000n // ICR ~1.101 (just above MCR)
    const feeM = await fork.publicClient.readContract({
      address: T.borrowerOperations,
      abi: (await import('../src')).borrowerOperationsAbi,
      functionName: 'getBorrowingFee',
      args: [edt],
    })
    await openTroveRaw(fork, {
      collateralBtc: coll,
      debtMusd: edt - 200n * MUSD - feeM,
      account: M,
      numTrials: 15,
    })
    const mEdc = await fork.publicClient.readContract({
      address: T.troveManager,
      abi: troveManagerAbi,
      functionName: 'getEntireDebtAndColl',
      args: [M.address],
    })
    const mEntireDebt = mEdc[1] + mEdc[2]

    const G = testAccount(1016)
    await openTroveRaw(fork, {
      collateralBtc: 3n * BTC,
      debtMusd: 100_000n * MUSD,
      account: G,
      numTrials: 15,
    })
    // Redeem past M so M is FULLY redeemed (the partial falls on a later Trove, not M).
    await reportRedemptionMargin(
      fork.publicClient,
      'phase6/claimFixture',
      mEntireDebt + 30_000n * MUSD,
    )
    await wait((await clientFor(G).redeem({ amount: mEntireDebt + 30_000n * MUSD })).hash)
    expect(await statusOf(M.address)).toBe(4) // closedByRedemption

    const surplus = await clientFor(M).getClaimableCollateral(M.address)
    console.log(`[phase6] M surplus = ${surplus}`)
    expect(surplus).toBeGreaterThan(0n)
    const btc0 = await fork.publicClient.getBalance({ address: M.address })
    const claimRes = await clientFor(M).claim()
    expect(claimRes.claimed).toBe(true)
    if (claimRes.hash) await wait(claimRes.hash)
    expect(await fork.publicClient.getBalance({ address: M.address })).toBeGreaterThan(btc0)
  }, 240_000)

  it('guards: liquidate healthy → NothingToLiquidate; MissingWalletClient; claim no-op', async () => {
    const fork = connectFork()
    const H = testAccount(1020)
    await openTroveRaw(fork, {
      collateralBtc: (5n * BTC) / 10n,
      debtMusd: 5_000n * MUSD,
      account: H,
      numTrials: 15,
    })
    const LQ = testAccount(1021)
    await fork.fundAccount(LQ.address, 5n * BTC)
    await expect(clientFor(LQ).liquidate(H.address)).rejects.toThrow(NothingToLiquidate)

    const readOnly = createMusdClient({ chainId: 31611, publicClient: fork.publicClient })
    await expect(readOnly.redeem({ amount: MUSD })).rejects.toThrow()
    const claim = await clientFor(LQ).claim()
    expect(claim.claimed).toBe(false)
  }, 120_000)
})
