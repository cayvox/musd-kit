import { readFileSync } from 'node:fs'
import { http, type PrivateKeyAccount, createWalletClient } from 'viem'
import { describe, expect, it } from 'vitest'
import { scanAndLiquidate } from '../../../examples/keeper/src/scan'
import { MCR, MUSD_GAS_COMPENSATION, createMusdClient } from '../src'
import { connectFork } from './harness'
import { mezoTestnet } from './harness/constants'
import { openTroveRaw, testAccount } from './harness/openTroveRaw'

const BTC = 10n ** 18n
const MUSD = 10n ** 18n

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

    // ---- Fixture: this test builds its own liquidatable Trove (MK-020) -----------------
    // It used to assert that the fork's pre-existing low-ICR tail was still under MCR.
    // That depended on the seeded price (unpinned before MK-020) AND on how much of that
    // tail phase 6 had already liquidated, so it failed with zero liquidations on two of
    // four runs. Now the precondition is created here and asserted before the scan.
    const origPrice = await client.getOraclePrice()
    const victim: PrivateKeyAccount = testAccount(901)

    // Open at ICR ~1.35: comfortably clear of MCR (1.1) so the open itself is never at
    // risk, and small enough that a 25% price drop puts it decisively under MCR. In normal
    // mode `openTrove` needs ICR >= MCR plus a resulting system TCR >= CCR, so an ICR below
    // CCR is fine here; one Trove of this size does not move the system TCR materially.
    const draw = 2_000n * MUSD
    const fee = await client.getBorrowingFee(draw)
    const entireDebt = draw + fee + MUSD_GAS_COMPENSATION
    const collateral = (135n * entireDebt * BTC) / (100n * origPrice)
    const tOpen = Date.now()
    await openTroveRaw(fork, { collateralBtc: collateral, debtMusd: draw, account: victim })
    console.log(`[keeper-test] victim opened in ${Date.now() - tOpen}ms`)

    try {
      // Drop 25%: our Trove's ICR goes to ~1.0125, under MCR. Everything at or below its
      // position in SortedTroves has a lower NICR, so the tail the keeper walks from is
      // liquidatable too. The drop is restored in `finally`, as phases 5, 6 and 7 do.
      await fork.setPrice((origPrice * 75n) / 100n)
      await fork.refreshOracle()

      // The ONLY liquidation gate in the protocol is `ICR < MCR`: `TroveManager.sol:1148`,
      // inside the `batchLiquidateTroves` loop that `liquidate(address)` funnels into
      // (`TroveManager.sol:265-271`). The file contains no reference to CCR at all, so
      // there is no Recovery Mode widening to encode here. Assert we are in normal mode
      // anyway: in Recovery Mode the SDK's `isLiquidatable` applies a CCR ceiling the
      // protocol does not have (MK-001, open, NOT addressed in this PR), and this test
      // must exercise the mode-correct rule rather than that bug.
      const state = await client.getSystemState()
      expect(state.isRecoveryMode, 'fixture must run in normal mode, see MK-001').toBe(false)

      // Precondition, read from the contract's own getter, not assumed.
      const trove = await client.getTrove(victim.address)
      expect(trove.exists).toBe(true)
      expect(trove.icr).toBeLessThan(MCR)

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
      console.log(
        `[keeper-test] victimIcr=${trove.icr} liquidated=${result.liquidated.length} ` +
          `rewardMUSD=${after - before}`,
      )
    } finally {
      await fork.setPrice(origPrice)
      await fork.refreshOracle()
    }
    // Generous, because building the fixture means a real `openTrove`, and the insertion
    // hint ritual is the single most latency-bound thing in the suite on a cold fork: run
    // in isolation this test takes ~290s, almost all of it inside `computeHints`. In the
    // full suite phase 3 has already warmed anvil's lazy state cache, so it is far quicker.
    // That is a PERFORMANCE coupling to file order, not a correctness one: the fixture this
    // test asserts on is now entirely its own (MK-020).
  }, 600_000)
})
