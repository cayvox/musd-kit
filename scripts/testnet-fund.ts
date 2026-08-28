/**
 * Mint MUSD with the SDK and send it to the end to end account.
 *
 * **Why this exists rather than a transfer from somewhere.** MUSD only comes into existence by
 * opening a Trove, so there is no faucet for it. Covering the shortfall the end to end run
 * cannot cover from within itself (MK-045) means opening a second position and sending from
 * it. That makes this script a real use of the SDK we are about to publish, which is worth
 * more than a transfer would have been: it previews an open, opens it, and checks the preview
 * against what the chain recorded, exactly as the differential harness does.
 *
 * **It leaves a position open, and says so.** This account cannot close either, for the same
 * reason the end to end account cannot: the borrowing fee is minted to the PCV
 * (`BorrowerOperations.sol:602-611`) and never handed to the borrower, while closing needs
 * `entireDebt - MUSD_GAS_COMPENSATION` in hand (`:963`). Its collateral is recoverable later
 * if MUSD is obtained from elsewhere. Nothing here pretends otherwise.
 *
 *   Prerequisites
 *   -------------
 *     pnpm tsx scripts/testnet-fund.ts --plan     # figure and arithmetic, no key needed
 *     source .secrets/testnet-funder.env          # exports MEZO_FUNDER_PRIVATE_KEY
 *     export MEZO_TESTNET_RPC_URL=https://rpc.test.mezo.org
 *     pnpm tsx scripts/testnet-fund.ts
 *
 *   The key is read from the ENVIRONMENT, never from a path in this file, and is never echoed,
 *   including on the error path.
 */

import { mezoTestnet } from '@mezo-org/chains'
import {
  MUSD_GAS_COMPENSATION,
  type MusdClient,
  MusdError,
  createMusdClient,
  formatBtc,
  formatMusd,
  musdAbi,
  parseMusd,
} from '@musd-kit/core'
import { http, type Address, createPublicClient, createWalletClient, formatEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const RPC = process.env.MEZO_TESTNET_RPC_URL ?? 'https://rpc.test.mezo.org'
/** Where the MUSD goes. The end to end account, whose shortfall this covers. */
const RECIPIENT = (process.env.E2E_RECIPIENT ??
  '0x18B0Da56B272b4FAAbdd8D60E3797e8cC17d248D') as Address
/** How much to send. 60 covers the close shortfall and a 50 MUSD redemption with headroom. */
const SEND = parseMusd(process.env.FUND_SEND_MUSD ?? '60')
/**
 * Target ratio for the funding position.
 *
 * **195, not 200, and the reason is a measurement rather than a preference.** At the price and
 * floor read on 2026-08-28, a 200% position needs 0.051247349613048978 BTC, which does NOT fit
 * inside a single 0.05 BTC faucet grant. 195% uses the whole grant less a gas reserve and
 * still lets the price fall 43.6% before the position reaches MCR, which is comfortable rather
 * than marginal. If the price moves enough that this no longer fits, `--plan` says so before
 * anything is sent.
 */
const TARGET_ICR_PCT = BigInt(process.env.FUND_TARGET_ICR ?? '195')
/**
 * The lowest ratio this script will open at, whatever the balance turns out to be.
 *
 * The plan targets {@link TARGET_ICR_PCT}, and the run sizes against the balance that ACTUALLY
 * arrived, because a fixed target is fragile: at the price read on 2026-08-28 a 195% position
 * fits one grant with 0.000009 BTC to spare, and a 1% fall in the price would take 0.0005 BTC
 * more than that. Sizing at run time turns a plan that might not fit into one that adapts,
 * and this floor is what stops it adapting all the way down to a marginal position.
 */
const MIN_ICR_PCT = BigInt(process.env.FUND_MIN_ICR ?? '150')
const PLAN_ONLY = process.argv.includes('--plan')

function die(msg: string): never {
  console.error(`\n✗ ${msg}`)
  process.exit(1)
}

async function plan(musd: MusdClient, publicClient: ReturnType<typeof createPublicClient>) {
  const [price, constants, gasPrice] = await Promise.all([
    musd.getOraclePrice(),
    musd.getConstants(),
    publicClient.getGasPrice(),
  ])
  // The draw is the floor. It is far above what must be sent, and it cannot be lower:
  // `_requireAtLeastMinNetDebt` (`BorrowerOperations.sol:645`) applies to draw plus fee.
  const draw = constants.minNetDebt
  const fee = await musd.getBorrowingFee(draw)
  const entireDebt = draw + fee + MUSD_GAS_COMPENSATION
  const collateral = (TARGET_ICR_PCT * 10n ** 16n * entireDebt + price - 1n) / price

  // Two sends: the open and one ERC20 transfer. The reserve is orders of magnitude above the
  // need, on the same reasoning as the end to end script: a gas price read once can be wrong,
  // and a floor costs a fraction of a grant.
  const GAS_RESERVE = 1_000_000_000_000_000n
  const total = collateral + GAS_RESERVE
  const GRANT = 50_000_000_000_000_000n

  console.log('\n=== funding plan, computed from live chain values ===')
  console.log(`  price               ${formatMusd(price)} USD/BTC`)
  console.log(`  minNetDebt          ${formatMusd(constants.minNetDebt)} MUSD  <- the floor`)
  console.log(`  borrowing fee       ${formatMusd(fee)} MUSD on that draw`)
  console.log(
    `  gas compensation    ${formatMusd(MUSD_GAS_COMPENSATION)} MUSD  <- contract constant`,
  )
  console.log(`  entireDebt at open  ${formatMusd(entireDebt)} MUSD  = draw + fee + reserve`)
  console.log(`  gasPrice            ${gasPrice} wei`)
  console.log('  ---')
  console.log(
    `  collateral          ${formatBtc(collateral)} BTC  (${TARGET_ICR_PCT}% of entireDebt)`,
  )
  console.log(`  gas reserve         ${formatBtc(GAS_RESERVE)} BTC`)
  console.log(`  TOTAL TO FUND       ${formatBtc(total)} BTC`)
  console.log(`  one faucet grant    ${formatBtc(GRANT)} BTC`)
  if (total > GRANT) {
    die(
      `the plan does NOT fit one faucet grant: ${formatBtc(total)} needed against ${formatBtc(GRANT)}.
  Lower FUND_TARGET_ICR, or fund across two days. Refusing to proceed on a plan that cannot be funded.`,
    )
  }
  console.log(`  FITS, headroom      ${formatBtc(GRANT - total)} BTC`)
  console.log(
    `\n  It will draw ${formatMusd(draw)} MUSD, send ${formatMusd(SEND)}, and keep the rest.`,
  )
  return { total, collateral, draw, fee, entireDebt, price }
}

async function main(): Promise<void> {
  const publicClient = createPublicClient({ chain: mezoTestnet, transport: http(RPC) })

  if (PLAN_ONLY) {
    await plan(createMusdClient({ chainId: 31611, publicClient }), publicClient)
    return
  }

  const pk = process.env.MEZO_FUNDER_PRIVATE_KEY
  if (!pk) {
    die(
      'MEZO_FUNDER_PRIVATE_KEY is not set. This script spends real testnet BTC; export a funded\n' +
        '  testnet key first. Run with --plan to compute the figure without a key.',
    )
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    // Never echoed, here or on any other path: an error that prints a key to a log is the same
    // leak as committing it.
    die('MEZO_FUNDER_PRIVATE_KEY is not a 0x-prefixed 32 byte hex key. Value not shown.')
  }

  const account = privateKeyToAccount(pk as `0x${string}`)
  const walletClient = createWalletClient({ account, chain: mezoTestnet, transport: http(RPC) })
  const musd = createMusdClient({ chainId: 31611, publicClient, walletClient })
  const owner: Address = account.address

  const waitOk = async (hash: `0x${string}`, label: string): Promise<void> => {
    console.log(`  ${label}: ${hash}`)
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') die(`${label} reverted in ${hash}`)
    console.log(`  ${label}: mined ✓ (block ${receipt.blockNumber})`)
  }

  console.log(`funder      ${owner}`)
  console.log(`recipient   ${RECIPIENT}`)
  const sizing = await plan(musd, publicClient)
  const balance = await publicClient.getBalance({ address: owner })
  console.log(`\nbalance     ${formatEther(balance)} BTC`)

  // Size against the balance that actually arrived rather than against the plan's target, and
  // refuse below MIN_ICR_PCT. The plan is what to ask the faucet for; this is what to do with
  // what turned up.
  const GAS_RESERVE = 1_000_000_000_000_000n
  if (balance <= GAS_RESERVE) {
    die(`balance ${formatEther(balance)} BTC does not even cover the gas reserve. Nothing to do.`)
  }
  const available = balance - GAS_RESERVE
  const collateral = available < sizing.collateral ? available : sizing.collateral
  const actualIcrPct = (collateral * sizing.price * 100n) / sizing.entireDebt / 10n ** 18n
  console.log(
    `  sizing against the balance: collateral ${formatBtc(collateral)} BTC, ICR ${actualIcrPct}%`,
  )
  if (actualIcrPct < MIN_ICR_PCT) {
    die(
      `the balance only supports a ${actualIcrPct}% position, below the ${MIN_ICR_PCT}% floor.
  Fund more, or lower FUND_MIN_ICR deliberately. Refusing to open a marginal position.`,
    )
  }

  const existing = await musd.getTrove(owner)
  if (existing.exists) {
    console.log(
      `\nthis account already holds a Trove (debt ${formatMusd(existing.entireDebt)} MUSD), skipping the open`,
    )
  } else {
    // ---- previewOpen, then open, then parity. The differential harness's own comparison.
    console.log('\n--- previewOpen ---')
    const preview = await musd.previewOpen({
      collateral,
      debt: sizing.draw,
      account: owner,
    })
    console.log(
      `  viable=${preview.viable} reasons=[${preview.reasons.join(',')}] entireDebt=${formatMusd(preview.entireDebt)} icr=${preview.icr}`,
    )
    if (!preview.viable) {
      die(`previewOpen says NOT viable [${preview.reasons.join(',')}]. Nothing sent.`)
    }
    console.log('\n--- openTrove ---')
    await waitOk((await musd.openTrove({ collateral, debt: sizing.draw })).hash, 'openTrove')
    const opened = await musd.getTrove(owner)
    // The chain read includes interest accrued since the preview, so the comparison bounds the
    // drift rather than demanding equality (MK-046).
    const drift = opened.entireDebt - preview.entireDebt
    if (drift < 0n)
      die(`entireDebt ${opened.entireDebt} is BELOW the preview's ${preview.entireDebt}`)
    const perYear = (preview.entireDebt * 100n) / 10_000n
    const maxDrift = (perYear * 120n) / (365n * 24n * 3600n)
    if (drift > maxDrift) {
      die(
        `entireDebt drifted ${drift} wei from the preview, beyond 120s of interest (${maxDrift}). Not accrual.`,
      )
    }
    const seconds = perYear > 0n ? (drift * 365n * 24n * 3600n) / perYear : 0n
    console.log(
      `  entireDebt ${opened.entireDebt} ✓ preview ${preview.entireDebt}, drift ${drift} wei = ${seconds}s of interest`,
    )
  }

  // ---- transfer, and verify it landed
  console.log(`\n--- transfer ${formatMusd(SEND)} MUSD ---`)
  const held = await musd.balanceOf(owner)
  if (held < SEND)
    die(`funder holds ${formatMusd(held)} MUSD, less than the ${formatMusd(SEND)} to send`)
  const before = await musd.balanceOf(RECIPIENT)
  const hash = await walletClient.writeContract({
    account,
    chain: mezoTestnet,
    address: musd.addresses.musd,
    abi: musdAbi,
    functionName: 'transfer',
    args: [RECIPIENT, SEND],
  })
  await waitOk(hash, 'transfer')
  const after = await musd.balanceOf(RECIPIENT)
  if (after - before !== SEND) {
    die(`recipient balance moved by ${after - before}, expected ${SEND}`)
  }
  console.log(
    `  recipient balance ${formatMusd(before)} -> ${formatMusd(after)} ✓ moved exactly ${formatMusd(SEND)}`,
  )

  // ---- what this account is left holding, stated rather than hidden
  const finalTrove = await musd.getTrove(owner)
  const finalMusd = await musd.balanceOf(owner)
  const finalBtc = await publicClient.getBalance({ address: owner })
  const close = await musd.previewClose(owner)
  console.log('\n=== what the funder is left holding ===')
  console.log(`  BTC balance    ${formatEther(finalBtc)}`)
  console.log(`  MUSD balance   ${formatMusd(finalMusd)}`)
  console.log(`  Trove open     ${finalTrove.exists}`)
  if (finalTrove.exists) {
    console.log(
      `    collateral   ${formatBtc(finalTrove.collateral)} BTC, entireDebt ${formatMusd(finalTrove.entireDebt)} MUSD, icr ${finalTrove.icr}`,
    )
    console.log(
      `  previewClose   viable=${close.viable} shortfall=${formatMusd(close.musdShortfall)} MUSD [${close.reasons.join(',')}]`,
    )
    console.log(`
  This account CANNOT close from within itself, for the same reason the end to end
  account cannot (MK-045): the borrowing fee is minted to the PCV and never handed to
  the borrower, so the position always owes more MUSD than it delivered. Its
  ${formatBtc(finalTrove.collateral)} BTC of collateral is NOT lost; it is recoverable
  whenever ${formatMusd(close.musdShortfall)} MUSD is obtained from elsewhere.`)
  }
  console.log('\n✓ funding complete.')
}

main().catch((e) => {
  if (e instanceof MusdError) die(`${e.name} [${e.code}]: ${e.message}`)
  die(String(e instanceof Error ? e.message : e))
})
