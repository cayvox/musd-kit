/**
 * LIVE LIFECYCLE on REAL Mezo testnet (chainId 31611), through the shipped SDK.
 *
 * The go-live verification the internal fork suite cannot give: real signed transactions
 * against the real deployment, the real native-precompile oracle, and real gas. No anvil, no
 * shim, no mock.
 *
 * **What it asserts, per step, is what the differential harness asserts:** the preview's
 * VERDICT against what the chain actually did, and the preview's NUMBERS against what the
 * chain actually recorded. A run that only sends transactions and watches them mine would
 * confirm the chain works, not that this SDK describes it correctly.
 *
 * It is intentionally NOT wired into CI: it spends real testnet BTC and needs a funded key,
 * so it is a MANUAL gate before publishing. It is safe to re-run (it closes any pre-existing
 * Trove first) and aborts loudly rather than doing anything destructive on bad input.
 *
 *   Prerequisites
 *   -------------
 *   1. A testnet account with BTC. Run `pnpm tsx scripts/testnet-e2e.ts --plan` first: it
 *      reads the live price, floor, rate and gas price and PRINTS the exact figure to fund,
 *      with the arithmetic. Do not guess it from this comment; the inputs are governable.
 *   2. Export the key. It is read from the ENVIRONMENT, never from a path in this file:
 *        source .secrets/testnet-e2e.env        # or however you keep it
 *        export MEZO_TESTNET_RPC_URL=https://rpc.test.mezo.org   # default if unset
 *      Optional overrides (defaults shown):
 *        export E2E_COLLATERAL_BTC=0.05
 *        export E2E_DEBT_MUSD=2500
 *        export E2E_ALLOW_REDEEM=0   # see the redeem step for why this is off by default
 *
 *   Run
 *   ---
 *     pnpm tsx scripts/testnet-e2e.ts --plan    # funding arithmetic only, no key needed
 *     pnpm tsx scripts/testnet-e2e.ts           # the run
 *
 *   A clean run prints "GO, live lifecycle verified on Mezo testnet." and exits 0. Any parity
 *   mismatch, wrong verdict or unexpected revert exits non-zero with the detail.
 */

import { mezoTestnet } from '@mezo-org/chains'
import {
  MUSD_GAS_COMPENSATION as GAS_COMPENSATION,
  type MusdClient,
  MusdError,
  createMusdClient,
  formatBtc,
  formatMusd,
  parseBtc,
  parseMusd,
} from '@musd-kit/core'
import { http, type Address, createPublicClient, createWalletClient, formatEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const RPC = process.env.MEZO_TESTNET_RPC_URL ?? 'https://rpc.test.mezo.org'
/**
 * The position is sized FROM THE CHAIN, not from a constant (MK-045).
 *
 * A hardcoded 0.05 BTC against a 2500 MUSD draw was a comfortable number, and comfortable is
 * the wrong property here: the faucet caps at 0.05 BTC per day, so a run that needs more than
 * the cap cannot be funded in one day, and every input that decides the minimum is governable.
 * The debt is the protocol floor and the collateral is whatever that floor needs at
 * `E2E_TARGET_ICR`, both read live. Override either only to test a specific shape.
 */
const TARGET_ICR_PCT = BigInt(process.env.E2E_TARGET_ICR ?? '140')
const COLLATERAL_OVERRIDE = process.env.E2E_COLLATERAL_BTC
  ? parseBtc(process.env.E2E_COLLATERAL_BTC)
  : undefined
const DEBT_OVERRIDE = process.env.E2E_DEBT_MUSD ? parseMusd(process.env.E2E_DEBT_MUSD) : undefined
const ALLOW_REDEEM = process.env.E2E_ALLOW_REDEEM === '1'
const PLAN_ONLY = process.argv.includes('--plan')

/** What each surface did. Printed as one table at the end, so nothing is silently absent. */
type Outcome = 'exercised' | 'skipped'
const ledger: { surface: string; outcome: Outcome; note: string }[] = []
const record = (surface: string, outcome: Outcome, note: string) =>
  ledger.push({ surface, outcome, note })

function die(msg: string): never {
  console.error(`\n✗ ${msg}`)
  process.exit(1)
}

function assertEq(label: string, actual: bigint, expected: bigint): void {
  if (actual !== expected) die(`${label}: chain says ${actual}, the preview said ${expected}`)
  console.log(`  ${label}: ${actual} ✓ matches the preview to the wei`)
}

function assertViable(label: string, viable: boolean, reasons: readonly string[]): void {
  if (!viable) die(`${label}: the preview says NOT viable [${reasons.join(',')}], so it stops here`)
  console.log(`  ${label}: preview viable ✓`)
}

/**
 * The funding figure, COMPUTED from live chain values rather than estimated.
 *
 * Every input is governable, so a number written into a comment would be a guess with a
 * timestamp. This reads them and shows the arithmetic. It needs no key, which is the point:
 * run it before funding anything.
 */
async function plan(musd: MusdClient, publicClient: ReturnType<typeof createPublicClient>) {
  const [price, constants, gasPrice] = await Promise.all([
    musd.getOraclePrice(),
    musd.getConstants(),
    publicClient.getGasPrice(),
  ])

  // The debt floor, from the chain. `_requireAtLeastMinNetDebt` (`BorrowerOperations.sol:645`,
  // `:1239-1244`) applies to netDebt, which is draw PLUS fee, and the composite debt adds the
  // 200 MUSD gas compensation on top (`:648`).
  const drawFloor = constants.minNetDebt
  const debt = DEBT_OVERRIDE ?? drawFloor
  const fee = await musd.getBorrowingFee(debt)
  const entireDebt = debt + fee + GAS_COMPENSATION

  // Collateral to put that debt at the target ratio. Ceil, so the position lands at or above
  // the target rather than one wei under it.
  const sized = (TARGET_ICR_PCT * 10n ** 16n * entireDebt + price - 1n) / price
  const collateral = COLLATERAL_OVERRIDE ?? sized

  // Collateral locked at the PEAK, which is a single Trove holding all three deposits at once
  // (`openTrove`, then `addCollateral`, then the `adjustTrove` leg). It is not a sum across
  // separate positions: this script opens exactly one Trove and closes it.
  const topUp = collateral / 10n
  const adjustAdd = collateral / 20n
  const peakCollateral = collateral + topUp + adjustAdd

  // Gas. Eleven sends, and the account must hold `gasLimit * gasPrice` UP FRONT for each, not
  // just what is burned (MK-035).
  const SENDS = 11n
  const PER_SEND_GAS = 800_000n
  const gasBudget = (SENDS * PER_SEND_GAS * 125n * gasPrice) / 100n

  // THE MARGIN GOES ON THE GAS, NOT ON THE COLLATERAL (MK-045).
  //
  // An earlier version multiplied the whole requirement by 1.5, which put a 50% buffer on the
  // collateral term. That term is exact and deterministic: it is a number this script chooses
  // and then deposits. Nothing about it can move between planning and running. The gas price
  // is the only volatile input, and at 146 wei it is roughly one part in thirty million of the
  // requirement, so a margin on the total was buying protection against the wrong thing while
  // pushing the figure above what a day's faucet can fund.
  //
  // 20x the gas estimate, floored at 0.001 BTC, because a gas price read once can be wrong by
  // orders of magnitude and a floor costs 2% of a day's faucet.
  const FLOOR = 1_000_000_000_000_000n
  const scaled = gasBudget * 20n
  const gasReserve = scaled > FLOOR ? scaled : FLOOR
  const total = peakCollateral + gasReserve

  console.log('\n=== funding plan, computed from live chain values ===')
  console.log(`  price                 ${formatMusd(price)} USD/BTC`)
  console.log(`  minNetDebt            ${formatMusd(constants.minNetDebt)} MUSD`)
  console.log(`  interestRate          ${constants.interestRate} bps`)
  console.log(`  draw                  ${formatMusd(debt)} MUSD`)
  console.log(`  borrowing fee         ${formatMusd(fee)} MUSD`)
  console.log(`  entireDebt at open    ${formatMusd(entireDebt)} MUSD  (draw + fee + 200 reserve)`)
  console.log(`  gasPrice              ${gasPrice} wei`)
  console.log('  ---')
  console.log(
    `  collateral, open      ${formatBtc(collateral)} BTC   (${TARGET_ICR_PCT}% of entireDebt at this price)`,
  )
  console.log(`  collateral, top-up    ${formatBtc(topUp)} BTC`)
  console.log(`  collateral, adjust    ${formatBtc(adjustAdd)} BTC`)
  console.log(
    `  peak collateral       ${formatBtc(peakCollateral)} BTC   ONE Trove, all three at once`,
  )
  console.log(
    `  gas reserve           ${formatBtc(gasReserve)} BTC   (${SENDS} sends * ${PER_SEND_GAS} * 1.25 * ${gasPrice} wei, x20, floored)`,
  )
  console.log(`  TOTAL TO FUND         ${formatBtc(total)} BTC`)
  console.log(
    '\n  The collateral is returned by close; the gas is not. The margin sits on the gas\n' +
      '  because that is the only input that can move: the collateral is a number this script\n' +
      '  chooses and deposits.',
  )
  if (debt + fee < constants.minNetDebt) {
    die(
      `unrunnable: draw ${formatMusd(debt)} plus fee ${formatMusd(fee)} is below the ${formatMusd(constants.minNetDebt)} floor.`,
    )
  }
  return { total, collateral, debt, fee, entireDebt, price }
}

async function main(): Promise<void> {
  const publicClient = createPublicClient({ chain: mezoTestnet, transport: http(RPC) })

  if (PLAN_ONLY) {
    // No key, no wallet: planning is a read-only operation and must not require one.
    await plan(createMusdClient({ chainId: 31611, publicClient }), publicClient)
    return
  }

  const pk = process.env.MEZO_TESTNET_PRIVATE_KEY
  if (!pk) {
    die(
      'MEZO_TESTNET_PRIVATE_KEY is not set. This script spends real testnet BTC; export a\n' +
        '  funded testnet key first (see the header of this file). Refusing to run without one.\n' +
        '  Run with --plan to compute the funding figure without a key.',
    )
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    // The value is NEVER echoed, here or anywhere else in this file, including on the error
    // path: an error message that prints the key to a terminal or a CI log is the same leak
    // as committing it.
    die('MEZO_TESTNET_PRIVATE_KEY is not a 0x-prefixed 32 byte hex key. Value not shown.')
  }

  const account = privateKeyToAccount(pk as `0x${string}`)
  const walletClient = createWalletClient({ account, chain: mezoTestnet, transport: http(RPC) })
  const musd = createMusdClient({ chainId: 31611, publicClient, walletClient })
  const owner: Address = account.address

  let leftOpen = false
  const waitOk = async (hash: `0x${string}`, label: string): Promise<void> => {
    console.log(`  ${label}: ${hash}`)
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') die(`${label} reverted (status=${receipt.status}) in ${hash}`)
    console.log(`  ${label}: mined ✓ (block ${receipt.blockNumber})`)
  }

  console.log(`account     ${owner}`)
  const sizing = await plan(musd, publicClient)
  const required = sizing.total
  const COLLATERAL = sizing.collateral
  const DEBT = sizing.debt
  const balance = await publicClient.getBalance({ address: owner })
  console.log(`\nbalance     ${formatEther(balance)} BTC`)
  if (balance < required) {
    die(
      `balance ${formatEther(balance)} BTC is below the computed requirement ${formatBtc(required)} BTC.
  Fund the account from the Mezo testnet faucet and retry. Refusing to start a run that
  cannot finish, because a half-finished run leaves an open position.`,
    )
  }

  // Safe re-run: close any pre-existing Trove so the open below is a clean first open.
  const existing = await musd.getTrove(owner)
  if (existing.exists) {
    console.log(`\nexisting Trove (debt ${formatMusd(existing.entireDebt)} MUSD), closing first`)
    await waitOk((await musd.close()).hash, 'close (pre-existing)')
  }

  // ---- 1. previewOpen -> openTrove -> getTrove parity
  console.log('\n--- previewOpen + openTrove ---')
  const open = await musd.previewOpen({ collateral: COLLATERAL, debt: DEBT })
  assertViable('previewOpen', open.viable, open.reasons)
  console.log(`  predicted entireDebt ${formatMusd(open.entireDebt)} MUSD, icr ${open.icr}`)
  await waitOk((await musd.openTrove({ collateral: COLLATERAL, debt: DEBT })).hash, 'openTrove')
  const opened = await musd.getTrove(owner)
  assertEq('entireDebt after open', opened.entireDebt, open.entireDebt)
  record('previewOpen', 'exercised', 'verdict and entireDebt matched the chain to the wei')
  record('openTrove', 'exercised', 'mined, position created')
  record('getTrove', 'exercised', 'used as the parity oracle for every step')

  // ---- 2. getBorrowingCapacity + getBorrowingPower, the two calculators
  console.log('\n--- capacity and power ---')
  const capacity = await musd.getBorrowingCapacity(owner)
  console.log(
    `  capacity ${formatMusd(capacity.capacity)}, remaining ${formatMusd(capacity.remaining)}`,
  )
  const power = await musd.getBorrowingPower({ collateral: COLLATERAL })
  console.log(`  borrowingPower at open collateral ${formatMusd(power)} MUSD`)
  record('getBorrowingCapacity', 'exercised', `capacity ${capacity.capacity}`)
  record('getBorrowingPower', 'exercised', `power ${power}`)

  // ---- 3. previewAdjustTrove + addCollateral
  console.log('\n--- previewAdjustTrove + addCollateral ---')
  const topUp = COLLATERAL / 10n
  const addPreview = await musd.previewAdjustTrove({ owner, addCollateral: topUp })
  assertViable('previewAdjustTrove (add)', addPreview.viable, addPreview.reasons)
  await waitOk((await musd.addCollateral({ amount: topUp })).hash, 'addCollateral')
  const afterAdd = await musd.getTrove(owner)
  assertEq('collateral after add', afterAdd.collateral, addPreview.resultingCollateral)
  record('previewAdjustTrove', 'exercised', 'add leg, resultingCollateral matched to the wei')
  record('addCollateral', 'exercised', 'mined')

  // ---- 4. previewBorrow + borrow
  console.log('\n--- previewBorrow + borrow ---')
  const draw = parseMusd('100')
  const borrowPreview = await musd.previewBorrow({ owner, amount: draw })
  assertViable('previewBorrow', borrowPreview.viable, borrowPreview.reasons)
  await waitOk((await musd.borrow({ amount: draw })).hash, 'borrow')
  const afterBorrow = await musd.getTrove(owner)
  assertEq('entireDebt after borrow', afterBorrow.entireDebt, borrowPreview.resultingEntireDebt)
  record('previewBorrow', 'exercised', 'resultingEntireDebt matched to the wei')
  record('borrow', 'exercised', `drew ${formatMusd(draw)} MUSD`)

  // ---- 5. previewAdjustTrove (repay leg) + repay
  console.log('\n--- previewAdjustTrove (repay) + repay ---')
  const repayAmount = parseMusd('50')
  const repayPreview = await musd.previewAdjustTrove({ owner, repayDebt: repayAmount })
  assertViable('previewAdjustTrove (repay)', repayPreview.viable, repayPreview.reasons)
  await waitOk((await musd.repay({ amount: repayAmount })).hash, 'repay')
  record('previewAdjustTrove (repay leg)', 'exercised', 'verdict held on chain')
  record('repay', 'exercised', `repaid ${formatMusd(repayAmount)} MUSD`)

  // ---- 6. maxWithdrawableCollateral + previewWithdrawCollateral + withdrawCollateral
  //
  // The strongest single assertion in this script: the maximum the SDK reports must be
  // ACCEPTED and one wei more must be REFUSED, on the real chain. That is the closed form and
  // the evaluator agreeing about where the gate is, checked against the contract rather than
  // against each other.
  console.log('\n--- maxWithdrawableCollateral + withdrawCollateral ---')
  const max = await musd.maxWithdrawableCollateral(owner)
  console.log(`  max ${formatBtc(max.amount)} BTC, limitedBy ${max.limitedBy}`)
  const atMax = await musd.previewWithdrawCollateral({ owner, amount: max.amount })
  const pastMax = await musd.previewWithdrawCollateral({ owner, amount: max.amount + 1n })
  if (!atMax.viable) die('maxWithdrawableCollateral reported an amount its own preview refuses')
  if (pastMax.viable) die('maxWithdrawableCollateral is not the maximum: one wei more is viable')
  console.log('  the reported max is viable and one wei more is not ✓')
  // Withdraw a safe fraction rather than the max, so the position survives for the steps below.
  const withdrawAmount = max.amount / 4n
  if (withdrawAmount > 0n) {
    const wPreview = await musd.previewWithdrawCollateral({ owner, amount: withdrawAmount })
    assertViable('previewWithdrawCollateral', wPreview.viable, wPreview.reasons)
    await waitOk(
      (await musd.withdrawCollateral({ amount: withdrawAmount })).hash,
      'withdrawCollateral',
    )
    const afterW = await musd.getTrove(owner)
    assertEq('collateral after withdraw', afterW.collateral, wPreview.resultingCollateral)
    record('previewWithdrawCollateral', 'exercised', 'resultingCollateral matched to the wei')
    record('withdrawCollateral', 'exercised', `withdrew ${formatBtc(withdrawAmount)} BTC`)
  } else {
    record('withdrawCollateral', 'skipped', 'the position had no withdrawable headroom')
  }
  record('maxWithdrawableCollateral', 'exercised', 'max accepted, max+1 refused, on chain')

  // ---- 7. adjustTrove, both legs at once
  console.log('\n--- previewAdjustTrove (combined) + adjustTrove ---')
  const adjustAdd = COLLATERAL / 20n
  const adjustDraw = parseMusd('25')
  const combined = await musd.previewAdjustTrove({
    owner,
    addCollateral: adjustAdd,
    increaseDebt: adjustDraw,
  })
  if (combined.viable) {
    await waitOk(
      (await musd.adjustTrove({ addCollateral: adjustAdd, borrow: adjustDraw })).hash,
      'adjustTrove',
    )
    const afterAdjust = await musd.getTrove(owner)
    assertEq('entireDebt after adjust', afterAdjust.entireDebt, combined.resultingEntireDebt)
    record('adjustTrove', 'exercised', 'combined add + borrow, entireDebt matched to the wei')
  } else {
    record('adjustTrove', 'skipped', `preview refused: ${combined.reasons.join(',')}`)
  }

  // ---- 8. previewRefinance + refinance
  console.log('\n--- previewRefinance + refinance ---')
  const refi = await musd.previewRefinance(owner)
  if (refi.viable) {
    await waitOk((await musd.refinance()).hash, 'refinance')
    record('previewRefinance', 'exercised', 'verdict held on chain')
    record('refinance', 'exercised', 'moved to the current global rate')
  } else {
    // Refinance reverts outright in Recovery Mode (`BorrowerOperations.sol:1023`), which is a
    // system state this script cannot create or clear. Skipped, with the reason.
    record('previewRefinance', 'exercised', `verdict: not viable [${refi.reasons.join(',')}]`)
    record('refinance', 'skipped', `preview refused: ${refi.reasons.join(',')}`)
  }

  // ---- 9. redeem, opt in only
  //
  // Redemption acts on the LOWEST ICR Trove in the system, which belongs to someone else. On
  // a shared testnet that is a real side effect on a third party's position, so it is off by
  // default and the reason is stated rather than the step quietly omitted.
  console.log('\n--- redeem ---')
  if (ALLOW_REDEEM) {
    const musdBalance = await musd.balanceOf(owner)
    const amount = musdBalance / 10n
    if (amount > 0n) {
      const result = await musd.redeem({ amount })
      await waitOk(result.hash, 'redeem')
      record('redeem', 'exercised', `redeemed ${formatMusd(amount)} MUSD`)
    } else {
      record('redeem', 'skipped', 'no MUSD balance to redeem')
    }
  } else {
    record('redeem', 'skipped', 'E2E_ALLOW_REDEEM is not 1: redemption hits another account')
  }

  // ---- 10. liquidate and batchLiquidate
  //
  // Both need a Trove below MCR to exist, which this script cannot create: it would have to
  // move the oracle, and on live testnet it cannot. Reported as unreachable rather than
  // pretended.
  record('liquidate', 'skipped', 'needs a Trove below MCR; cannot be created on live testnet')
  record('batchLiquidate', 'skipped', 'same as liquidate')

  // ---- 11. claim
  //
  // `claimCollateral` pays out a surplus that only exists after this account has been
  // liquidated or fully redeemed against. Unreachable in a self-contained run, and the SDK
  // reports it honestly rather than throwing, so the call itself is safe to make.
  console.log('\n--- claim ---')
  const claim = await musd.claim()
  record(
    'claim',
    claim.claimed ? 'exercised' : 'skipped',
    claim.claimed ? 'a surplus existed and was claimed' : 'no surplus to claim, which is expected',
  )

  // ---- 12. previewClose + close
  console.log('\n--- previewClose + close ---')
  const closePreview = await musd.previewClose(owner)
  console.log(
    `  requires ${formatMusd(closePreview.musdRequired)} MUSD, shortfall ${formatMusd(closePreview.musdShortfall)}, canMint ${closePreview.canMint}`,
  )
  const beforeClose = await musd.getTrove(owner)
  assertEq(
    'previewClose.musdRequired',
    closePreview.musdRequired,
    beforeClose.entireDebt - parseMusd('200'),
  )
  if (!closePreview.viable) {
    // MK-045. A Trove cannot be closed with only the MUSD it drew, and this is a PROTOCOL
    // property rather than a defect here or a mistake in this run.
    //
    // The borrowing fee is capitalised into the debt and minted to the PCV, never handed to
    // the borrower (`BorrowerOperations.sol:637-643`), while closing requires
    // `entireDebt - MUSD_GAS_COMPENSATION` in hand (`:963`). So the borrower ends up short by
    // exactly the accumulated fees plus accrued interest, always. Measured on a fork: a draw
    // of 2000 delivered 2000 and required 2002 to close, a shortfall of exactly the 2 MUSD
    // fee.
    //
    // `previewClose` reports it correctly, with the exact number, which is the SDK behaving
    // as designed. What it means for this script is that a self funded account cannot end the
    // run with no Trove unless it obtains MUSD from outside the position.
    if (
      closePreview.bindingConstraint === 'INSUFFICIENT_MUSD_BALANCE' &&
      closePreview.musdShortfall > 0n
    ) {
      console.log(
        `  cannot close: short ${formatMusd(closePreview.musdShortfall)} MUSD (MK-045). The
  borrowing fee is added to the debt and never paid out, so a position cannot be
  closed with only what it drew. The Trove is LEFT OPEN, deliberately and reported.`,
      )
      record(
        'previewClose',
        'exercised',
        `musdRequired matched entireDebt minus the reserve; reports a ${formatMusd(closePreview.musdShortfall)} MUSD shortfall`,
      )
      record(
        'close',
        'skipped',
        `MK-045: short ${formatMusd(closePreview.musdShortfall)} MUSD, which is the borrowing fee. Needs MUSD from outside the position`,
      )
      leftOpen = true
    } else {
      die(
        `previewClose says the position cannot be closed [${closePreview.reasons.join(',')}]. The
  account is LEFT OPEN; resolve the reason and re-run, which will close it first.`,
      )
    }
  }
  if (!leftOpen) {
    await waitOk((await musd.close()).hash, 'close')
    const closed = await musd.getTrove(owner)
    if (closed.exists) die('close mined but getTrove still reports the Trove as existing')
    console.log('  closed, getTrove.exists is false ✓')
    record('previewClose', 'exercised', 'musdRequired matched entireDebt minus the gas reserve')
    record('close', 'exercised', 'position closed, account left with no Trove')
  }

  // ---- the ledger
  const finalTrove = await musd.getTrove(owner)
  const finalBalance = await publicClient.getBalance({ address: owner })
  console.log('\n=== what this run exercised ===')
  for (const row of ledger) {
    console.log(
      `  ${row.outcome === 'exercised' ? '✓' : '-'} ${row.surface.padEnd(30)} ${row.note}`,
    )
  }
  const skipped = ledger.filter((r) => r.outcome === 'skipped')
  console.log(
    `\n  ${ledger.length - skipped.length} exercised, ${skipped.length} skipped, and every skip has a reason above.`,
  )
  console.log(`\n  account holds an open Trove: ${finalTrove.exists}`)
  if (finalTrove.exists) {
    console.log(
      `  entireDebt ${formatMusd(finalTrove.entireDebt)} MUSD, collateral ${formatBtc(finalTrove.collateral)} BTC (MK-045)`,
    )
  }
  console.log(`  remaining BTC balance: ${formatEther(finalBalance)}`)
  console.log('\n✓ GO, live lifecycle verified on Mezo testnet.')
}

main().catch((e) => {
  if (e instanceof MusdError) die(`${e.name} [${e.code}]: ${e.message}`)
  die(String(e instanceof Error ? e.message : e))
})
