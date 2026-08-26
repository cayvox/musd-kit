import { type TestSpecification, defineConfig } from 'vitest/config'
import { BaseSequencer } from 'vitest/node'

/** Path of a spec across vitest versions (object `.moduleId` or `[project, file]` tuple). */
function specPath(spec: TestSpecification): string {
  const s = spec as unknown as { moduleId?: string } & [unknown, string?]
  return s.moduleId ?? (Array.isArray(spec) ? (s[1] ?? '') : '')
}

/**
 * Deterministic, alphabetical file order. The `fork` project shares ONE anvil fork
 * (globalSetup), and some files warp the EVM clock forward (phase2 30d, phase4 45d,
 * phase6 1y). With vitest's default size/timing-based sequencer the order differs
 * between environments, so a big warp could run before a file that assumes a fresh
 * clock (this broke CI when phase6 ran before phase5). Sorting by path keeps the
 * phase order stable: each warp only affects strictly-later phases (and `smoke`,
 * which reads only constants/price and is warp-robust).
 *
 * `sequence.sequencer` and `fileParallelism` are root-only options in vitest 2 (they
 * are in `NonProjectOptions`), so they live here and apply to BOTH projects. That is
 * harmless for `unit`, which is chain-free and finishes in well under a second.
 */
class AlphabeticalSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return [...files].sort((a, b) => specPath(a).localeCompare(specPath(b)))
  }
}

/**
 * Root Vitest config. The suite is split into two projects, defined in
 * `vitest.workspace.mts` (MK-016):
 *
 *   - `unit`: pure, in-process, NO globalSetup, no anvil, no RPC URL. `pnpm test:unit`
 *     runs on a machine with neither, which is what makes the "the unit layer runs with
 *     no chain" claim in `docs/07-testing.md` true rather than aspirational.
 *   - `fork`: the `*.fork.test.ts` files, against one shared anvil fork of Mezo booted
 *     by the harness globalSetup. `pnpm test:fork`. See `packages/core/test/harness/`.
 *
 * Coverage is a root-only option, so the gate for `@musd-kit/core` is configured here.
 */
export default defineConfig({
  test: {
    // The fork is shared mutable state; run files serially in a STABLE order.
    fileParallelism: false,
    sequence: { sequencer: AlphabeticalSequencer },
    coverage: {
      provider: 'v8',
      // The gate is on the hand-written core surface. `_generated/` is ABI and address
      // data emitted from the contracts package, not logic, and would dilute the floor.
      include: ['packages/core/src/**/*.ts'],
      exclude: ['packages/core/src/_generated/**'],
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
      /**
       * The floor is the honestly MEASURED number, rounded down, not an aspiration.
       * It is a RATCHET: it only ever moves up. Raise it when real coverage rises;
       * never lower it to make a red build green. Measured on the full suite
       * (`pnpm test:coverage`, both projects), which is what CI runs.
       *
       * Measured at the time this gate was wired, at fork block 15043414:
       *   statements 95.32 · branches 91.28 · functions 99.02 · lines 95.32
       * Re-measured after the P4 S2 sweep (MK-007 through MK-013), same block:
       *   statements 98.20 · branches 91.72 · functions 99.27 · lines 98.20
       *
       * Statements and lines move up to 98, the measured number rounded down. Branches
       * stays at 91 rather than following 91.72 up: the branch metric is the one that sits
       * closest to its floor, several of its remaining branches are fork-path dependent,
       * and a ratchet that has to be argued down later was set too tight. Functions stays
       * at 99 for the same reason, the measured 99.27 rounds down to 99.
       */
      thresholds: {
        lines: 98,
        functions: 99,
        branches: 91,
        statements: 98,
      },
    },
  },
})
