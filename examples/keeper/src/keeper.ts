// Headless MUSD liquidation keeper — depends on @musd-kit/core + viem + @mezo-org/chains
// ONLY. No React, no wagmi, no @musd-kit/react (lint-enforced; see biome override). That
// this file compiles and runs is the structural proof the core is framework-agnostic.
import { mezoTestnet } from '@mezo-org/chains'
import { createMusdClient } from '@musd-kit/core'
import { http, createPublicClient, createWalletClient, formatEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { scanAndLiquidate } from './scan'

const RPC_URL = process.env.MEZO_RPC_URL ?? mezoTestnet.rpcUrls.default.http[0]
const PRIVATE_KEY = process.env.KEEPER_PRIVATE_KEY

if (!PRIVATE_KEY) {
  console.error('Set KEEPER_PRIVATE_KEY (a 0x-prefixed private key) and optionally MEZO_RPC_URL.')
  process.exit(1)
}

const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`)
const publicClient = createPublicClient({ chain: mezoTestnet, transport: http(RPC_URL) })
const walletClient = createWalletClient({ account, chain: mezoTestnet, transport: http(RPC_URL) })
const musd = createMusdClient({ chainId: mezoTestnet.id, publicClient, walletClient })

async function pass(): Promise<void> {
  const before = await musd.balanceOf(account.address)
  const sys = await musd.getSystemState()
  console.log(
    `[keeper] price=${formatEther(sys.price)} recoveryMode=${sys.isRecoveryMode} keeper=${account.address}`,
  )

  const result = await scanAndLiquidate(musd, {
    maxScan: 100,
    log: (m) => console.log(`[keeper] ${m}`),
  })

  const after = await musd.balanceOf(account.address)
  console.log(
    `[keeper] scanned=${result.scanned} liquidatable=${result.liquidatable.length} ` +
      `liquidated=${result.liquidated.length} rewardMUSD=${formatEther(after - before)}`,
  )
}

const watch = process.argv.includes('--watch')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

if (watch) {
  console.log('[keeper] watch mode — polling every 15s (Ctrl-C to stop)')
  for (;;) {
    await pass().catch((e) => console.error('[keeper] pass failed:', (e as Error).message))
    await sleep(15_000)
  }
} else {
  await pass()
}
