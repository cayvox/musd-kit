import { defineConfig } from 'vitest/config'

/**
 * Root Vitest config.
 *
 * A single shared anvil fork of Mezo is booted once for the whole suite by the
 * harness globalSetup (and torn down after), so individual tests just connect to
 * it. See `packages/core/test/harness/`.
 */
export default defineConfig({
  test: {
    // Only `*.fork.test.ts` files hit the fork; keep the include narrow for now.
    include: ['packages/**/test/**/*.test.ts'],
    globalSetup: ['./packages/core/test/harness/globalSetup.ts'],
    // Fork reads are quick, but give anvil headroom on slower CI runners.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // The fork is shared mutable state; run files serially to keep it deterministic.
    fileParallelism: false,
    pool: 'forks',
  },
})
