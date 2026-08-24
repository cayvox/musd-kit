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
      // Except the @musd-kit/react tests, which need a DOM. `abort-signal.test.ts` pins
      // MK-028 chain free, so it has to run under the same environment the fork tests use,
      // on every Node in the matrix rather than only the one the fork gate pins.
      environmentMatchGlobs: [
        ['**/packages/react/test/**', './packages/react/test/harness/jsdom-node-abort.ts'],
      ],
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
      //
      // Not plain `jsdom`: from Node 24 on, jsdom's AbortSignal paired with Node's Request
      // makes every viem RPC call throw before a single assertion runs (MK-028). The custom
      // environment is jsdom with Node's AbortController and AbortSignal left in place, and
      // nothing else changed. See `./packages/react/test/harness/jsdom-node-abort.ts`.
      environmentMatchGlobs: [
        ['**/packages/react/test/**', './packages/react/test/harness/jsdom-node-abort.ts'],
      ],
    },
  },
])
