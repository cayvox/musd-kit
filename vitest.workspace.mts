import { configDefaults, defineWorkspace } from 'vitest/config'

/**
 * Two projects, split so the chain-free layer is provably chain-free (MK-016).
 *
 * Before this split there was a single project with an unconditional `globalSetup`
 * that booted anvil, so even `units.test.ts` needed an anvil binary and a Mezo RPC
 * URL. `docs/07-testing.md` claimed the unit layer ran "in-process, no chain"; it did
 * not. The split makes the claim true.
 *
 * Root-only options (`fileParallelism`, `sequence.sequencer`, `coverage`) are in
 * `vitest.config.mts`; vitest 2 rejects them in a project config.
 */
export default defineWorkspace([
  {
    test: {
      name: 'unit',
      // Everything EXCEPT the fork files. No globalSetup, so no anvil and no RPC URL.
      include: ['packages/**/test/**/*.test.ts'],
      exclude: [...configDefaults.exclude, '**/*.fork.test.ts'],
      environment: 'node',
      testTimeout: 10_000,
    },
  },
  {
    test: {
      name: 'fork',
      // Only `*.fork.test.ts` files hit the fork.
      include: ['packages/**/test/**/*.fork.test.ts'],
      globalSetup: ['./packages/core/test/harness/globalSetup.ts'],
      // Fork reads are quick, but give anvil headroom on slower CI runners.
      testTimeout: 60_000,
      hookTimeout: 120_000,
      pool: 'forks',
      // The @musd-kit/react hook tests need a DOM (React Testing Library); the core fork
      // tests stay on node. Everything still shares the one anvil fork via globalSetup.
      environmentMatchGlobs: [['**/packages/react/test/**', 'jsdom']],
    },
  },
])
