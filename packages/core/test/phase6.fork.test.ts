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
  createMusdClient,
  getAddresses,
  hintHelpersAbi,
  musdAbi,
  priceFeedAbi,
  troveManagerAbi,
} from '../src'
import { connectFork } from './harness'
import { mezoTestnet } from './harness/constants'
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

describe('Phase 6 — redemption + liquidation keeper surface', () => {
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
    // Warp forward ~1 year: the lowest-ICR redeemable Trove on this fork sits right at
    // MCR and interest-drifts below it during the redeem (razor-edge). Aging the system
    // pushes those marginal Troves clearly under MCR so the firstRedemptionHint is a
    // comfortable Trove that survives the sub-second drift to the redeem block.
    await fork.warpTime(31_556_952)
    expect((await musdR.getSystemState()).isRecoveryMode).toBe(false) // redemption needs TCR ≥ MCR
    const res = await musdR.redeem({ amount: 2_000n * MUSD })
    expect(res.fee).toBe(rate)
    expect(res.truncatedAmount).toBeGreaterThan(0n)
    const redemptionEv = async (hash: Hex) => {
      const ev = parseEventLogs({
        abi: troveManagerAbi,
        logs: (await wait(hash)).logs,
        eventName: 'Redemption',
      })[0]!
      return ev.args
    }
    const evR = await redemptionEv(res.hash)
    const feeFracR = Number(evR._collateralFee) / Number(evR._collateralSent + evR._collateralFee)
    console.log(
      `[phase6] LOAN-HOLDER feeFrac=${feeFracR} (rate=${Number(rate) / 1e16}%) actual=${evR._actualAmount}`,
    )
    expect(evR._actualAmount).toBeGreaterThan(0n)
    expect(Math.abs(feeFracR - Number(rate) / 1e18)).toBeLessThan(0.001)

    // No-loan redeemer
    const N = testAccount(1001)
    await fork.fundAccount(N.address, 5n * BTC)
    await walletWrite(R, T.musd, musdAbi, 'transfer', [N.address, 5_000n * MUSD])
    const resN = await clientFor(N).redeem({ amount: 2_000n * MUSD })
    const evN = await redemptionEv(resN.hash)
    const feeFracN = Number(evN._collateralFee) / Number(evN._collateralSent + evN._collateralFee)
    console.log(`[phase6] NO-LOAN feeFrac=${feeFracN}`)
    expect(Math.abs(feeFracN - feeFracR)).toBeLessThan(0.0005) // same rate → 0%-loan-holder rule disproven

    // Truncation: redeemCollateral requires requested ≤ caller's balance, so request all
    // of R's balance but cap iterations → only a few Troves redeemable → truncated < requested.
    const rBal = await fork.publicClient.readContract({
      address: T.musd,
      abi: musdAbi,
      functionName: 'balanceOf',
      args: [R.address],
    })
    const resT = await musdR.redeem({ amount: rBal, maxIterations: 2n })
    expect(resT.truncatedAmount).toBeLessThan(rBal)
    console.log(`[phase6] TRUNCATION: requested=${rBal} truncated=${resT.truncatedAmount}`)
    await wait(resT.hash)
  }, 300_000)

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
      const liqEv = parseEventLogs({
        abi: troveManagerAbi,
        logs: (await wait(lq.hash)).logs,
        eventName: 'Liquidation',
      })[0]!.args
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

  it('Recovery Mode: detection + isLiquidatable rule (CCR ceiling) + a real RM liquidation', async () => {
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
      // Mode-aware isLiquidatable: under-MCR and MCR≤ICR<CCR are flagged in RM; ICR≥CCR is not.
      // (The single-Trove liquidate of a MCR≤ICR<CCR Trove also needs ICR<TCR + SP cover —
      // simulate-before-send is the real gate; isLiquidatable is the optimistic precheck.)
      expect(await musdLQ.isLiquidatable(U.address)).toBe(true)
      expect(await musdLQ.isLiquidatable(B.address)).toBe(true)
      expect(await musdLQ.isLiquidatable(C.address)).toBe(false)

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
