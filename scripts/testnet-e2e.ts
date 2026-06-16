/**
 * Task E — LIVE LIFECYCLE on REAL Mezo testnet (chainId 31611), through the shipped SDK.
 *
 * This is the go-live verification that the *internal fork suite cannot* prove: a real
 * signed open → on-chain getter parity (to the wei) → repay → close, against the real
 * deployment, the real native-precompile oracle, and real gas — no anvil, no shim, no mock.
 *
 * It is intentionally NOT wired into CI: it spends real testnet BTC and requires a funded
 * key, so it is a MANUAL gate Anıl runs once before publishing. It is written to be safe to
 * re-run (it closes any pre-existing Trove first) and to abort loudly rather than do anything
 * destructive on bad input.
 *
 *   Prerequisites
 *   -------------
 *   1. A testnet account with a little BTC. Fund it from the Mezo testnet faucet.
 *      ~0.05 BTC covers the default open (collateral) + gas; the draw is returned to you.
 *   2. Export the key + (optionally) an RPC URL:
 *        export MEZO_TESTNET_PRIVATE_KEY=0x<64-hex>
 *        export MEZO_TESTNET_RPC_URL=https://rpc.test.mezo.org   # default if unset
 *      Optional overrides (defaults shown):
 *        export E2E_COLLATERAL_BTC=0.05     # collateral to deposit
 *        export E2E_DEBT_MUSD=2500          # MUSD to draw (must clear minNetDebt: 1,800 net)
 *
 *   Run
 *   ---
 *     pnpm tsx scripts/testnet-e2e.ts
 *
 *   A clean run prints "GO — live lifecycle verified on Mezo testnet." and exits 0.
 *   Any parity mismatch or unexpected revert exits non-zero with the detail.
 */

import { mezoTestnet } from '@mezo-org/chains'
import {
  BelowMinimumDebt,
  MusdError,
  createMusdClient,
  formatBtc,
  formatMusd,
  parseBtc,
  parseMusd,
} from '@musd-kit/core'
import { http, createPublicClient, createWalletClient, formatEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const RPC = process.env.MEZO_TESTNET_RPC_URL ?? 'https://rpc.test.mezo.org'
const COLLATERAL = parseBtc(process.env.E2E_COLLATERAL_BTC ?? '0.05')
const DEBT = parseMusd(process.env.E2E_DEBT_MUSD ?? '2500')

function die(msg: string): never {
  console.error(`\n✗ ${msg}`)
  process.exit(1)
}

async function main(): Promise<void> {
  const pk = process.env.MEZO_TESTNET_PRIVATE_KEY
  if (!pk) {
    die(
      'MEZO_TESTNET_PRIVATE_KEY is not set. This script spends real testnet BTC; export a\n  funded testnet key first (see the header of this file). Refusing to run without one.',
    )
  }

  const account = privateKeyToAccount(pk as `0x${string}`)
  const publicClient = createPublicClient({ chain: mezoTestnet, transport: http(RPC) })
  const walletClient = createWalletClient({ account, chain: mezoTestnet, transport: http(RPC) })
  const musd = createMusdClient({ chainId: 31611, publicClient, walletClient })

  // Wait for a receipt and assert it mined successfully (the SDK returns {hash} without awaiting).
  const waitOk = async (hash: `0x${string}`, label: string): Promise<void> => {
    console.log(`  ${label}: ${hash}`)
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') die(`${label} reverted (status=${receipt.status}) in ${hash}`)
    console.log(`  ${label}: mined ✓ (block ${receipt.blockNumber})`)
  }

  console.log(`account     ${account.address}`)
  const balance = await publicClient.getBalance({ address: account.address })
  console.log(`balance     ${formatEther(balance)} BTC`)
  if (balance < COLLATERAL) {
    die(
      `balance ${formatEther(balance)} BTC < collateral ${formatBtc(COLLATERAL)} BTC. Fund the account from the Mezo testnet faucet and retry.`,
    )
  }

  // Safe re-run: close any pre-existing Trove so the open below is a clean first open.
  const existing = await musd.getTrove(account.address)
  if (existing.exists) {
    console.log(
      `\nexisting Trove found (debt ${formatMusd(existing.entireDebt)} MUSD) — closing first…`,
    )
    const { hash } = await musd.close()
    await waitOk(hash, 'close (pre-existing)')
  }

  // 1) Preview (client math) — capture what we PROMISE the position will be.
  const preview = await musd.previewOpen({ collateral: COLLATERAL, debt: DEBT })
  console.log('\n--- previewOpen ---')
  console.log(`  entireDebt   ${formatMusd(preview.entireDebt)} MUSD`)
  console.log(`  icr          ${(Number(formatEther(preview.icr)) * 100).toFixed(2)}%`)
  console.log(`  liqPrice     $${Number(formatEther(preview.liquidationPrice)).toFixed(2)}`)
  console.log(`  meetsMinimum ${preview.meetsMinimum}`)
  if (!preview.meetsMinimum) {
    die(
      `preview.meetsMinimum is false for a ${formatMusd(DEBT)} MUSD draw — raise E2E_DEBT_MUSD above the minNetDebt floor.`,
    )
  }

  // 2) Open for real.
  console.log('\n--- openTrove (signing) ---')
  let openHash: `0x${string}`
  try {
    const res = await musd.openTrove({ collateral: COLLATERAL, debt: DEBT })
    openHash = res.hash
  } catch (e) {
    if (e instanceof BelowMinimumDebt)
      die(`BelowMinimumDebt: min ${formatMusd(e.context?.minNetDebt as bigint)} net`)
    throw e
  }
  await waitOk(openHash, 'openTrove')

  // 3) Parity — the live getter must match the preview to the wei. This is the whole point.
  const live = await musd.getTrove(account.address)
  console.log('\n--- getTrove (live getter) ---')
  console.log(`  exists       ${live.exists}`)
  console.log(`  collateral   ${formatBtc(live.collateral)} BTC`)
  console.log(`  entireDebt   ${formatMusd(live.entireDebt)} MUSD`)
  console.log(`  icr          ${(Number(formatEther(live.icr)) * 100).toFixed(2)}%`)

  if (!live.exists) die('post-open getTrove says the Trove does not exist')
  if (live.collateral !== COLLATERAL) {
    die(`collateral mismatch: live ${live.collateral} !== sent ${COLLATERAL}`)
  }
  // entireDebt is read at a later timestamp than the preview, so a few seconds of interest may
  // have accrued. Require the live debt to be >= preview and within a tight band (1 bps).
  if (live.entireDebt < preview.entireDebt) {
    die(`live entireDebt ${live.entireDebt} < preview ${preview.entireDebt} (should never shrink)`)
  }
  const drift = live.entireDebt - preview.entireDebt
  const band = preview.entireDebt / 10_000n // 1 bps
  if (drift > band) {
    die(
      `entireDebt drift ${formatMusd(drift)} MUSD exceeds 1 bps band — preview math is off, not interest accrual`,
    )
  }
  console.log(
    `\n  parity OK — live entireDebt within ${formatMusd(drift)} MUSD of preview (interest accrual).`,
  )

  // 4) Repay a slice, then 5) close (which repays the remainder + returns collateral to claim).
  console.log('\n--- repay 100 MUSD ---')
  const { hash: repayHash } = await musd.repay({ amount: parseMusd('100') })
  await waitOk(repayHash, 'repay')

  console.log('\n--- close ---')
  const { hash: closeHash } = await musd.close()
  await waitOk(closeHash, 'close')

  const after = await musd.getTrove(account.address)
  if (after.exists) die('Trove still exists after close()')
  console.log('\n  closed — getTrove.exists is false.')

  console.log('\n✓ GO — live lifecycle verified on Mezo testnet.')
}

main().catch((e) => {
  if (e instanceof MusdError) die(`${e.name} [${e.code}]: ${e.message}`)
  die(e instanceof Error ? (e.stack ?? e.message) : String(e))
})
