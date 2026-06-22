import { readFileSync } from 'node:fs'
import { http, type PrivateKeyAccount, createWalletClient } from 'viem'
import { describe, expect, it } from 'vitest'
import { scanAndLiquidate } from '../../../examples/keeper/src/scan'
import { createMusdClient } from '../src'
import { connectFork } from './harness'
import { mezoTestnet } from './harness/constants'
import { testAccount } from './harness/openTroveRaw'

const BTC = 10n ** 18n

describe('Phase 9, examples/keeper (core-only)', () => {
  it('the keeper imports no React/wagmi and depends only on the framework-agnostic core', () => {
    // 1. No forbidden import statements in the keeper source (the boundary the lint enforces).
    const forbidden =
      /\b(from|import)\s+['"](react|react-dom|@musd-kit\/react|wagmi|@tanstack\/react-query)['"]/
    for (const f of ['examples/keeper/src/scan.ts', 'examples/keeper/src/keeper.ts']) {
      expect(readFileSync(f, 'utf8'), `${f} imports a forbidden module`).not.toMatch(forbidden)
    }

    // 2. No React/wagmi anywhere in the keeper's declared dependency set.
    const pkg = JSON.parse(readFileSync('examples/keeper/package.json', 'utf8'))
    const keeperDeps = { ...pkg.dependencies, ...pkg.devDependencies }
    for (const m of ['react', 'react-dom', '@musd-kit/react', 'wagmi', '@tanstack/react-query']) {
      expect(m in keeperDeps, `keeper declares ${m}`).toBe(false)
    }

    // 3. The keeper's only library dependency (@musd-kit/core) is itself React-free.
    const core = JSON.parse(readFileSync('packages/core/package.json', 'utf8'))
    const coreDeps = { ...core.dependencies, ...core.peerDependencies, ...core.devDependencies }
    for (const m of ['react', 'react-dom', '@musd-kit/react', 'wagmi', '@tanstack/react-query']) {
      expect(m in coreDeps, `@musd-kit/core declares ${m}`).toBe(false)
    }
  })

  it('scans SortedTroves and liquidates an under-MCR Trove on the fork, receiving the reward', async () => {
    const fork = connectFork()
    await fork.refreshOracle()

    // A funded keeper account, it holds NO MUSD until it earns liquidation rewards.
    const keeper: PrivateKeyAccount = testAccount(900)
    await fork.fundAccount(keeper.address, 10n * BTC) // BTC for gas only
    const walletClient = createWalletClient({
      account: keeper,
      chain: mezoTestnet,
      transport: http(fork.rpcUrl),
    })
    const client = createMusdClient({
      chainId: 31611,
      publicClient: fork.publicClient,
      walletClient,
    })

    const before = await client.balanceOf(keeper.address)
    expect(before).toBe(0n)

    // The fork's lowest-ICR tail Troves sit well under MCR (verified in Phase 6), so the
    // keeper's single pass finds + liquidates them. Cap at 2 to keep the smoke fast.
    const result = await scanAndLiquidate(client, {
      maxScan: 50,
      maxLiquidations: 2,
      log: (m) => console.log(`[keeper-test] ${m}`),
    })

    expect(result.scanned).toBeGreaterThan(0)
    expect(result.liquidated.length).toBeGreaterThanOrEqual(1)

    // Each liquidation pays the caller the 200 MUSD gas compensation → balance grows from 0.
    const after = await client.balanceOf(keeper.address)
    expect(after).toBeGreaterThan(before)
    console.log(`[keeper-test] liquidated=${result.liquidated.length} rewardMUSD=${after - before}`)
  }, 180_000)
})
