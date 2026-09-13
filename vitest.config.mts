import { defineConfig } from 'vitest/config'
import { BaseSequencer, type WorkspaceSpec } from 'vitest/node'

/**
 * Path of a spec.
 *
 * MK-027. This file had never been typechecked by anything, and the first thing typechecking
 * it found was that `TestSpecification` is not exported from `vitest/config` at all: it lives
 * in `vitest/node`, and `BaseSequencer.sort` is declared over `WorkspaceSpec`, not over it.
 * The override below was typed against a name that did not resolve, so it degraded to `any`
 * and every shape passed silently.
 *
 * With the real type the dual handling is explained rather than guessed at:
 * `type WorkspaceSpec = TestSpecification & [...]` is an INTERSECTION of the object and the
 * tuple, so both accesses were always valid. The defensive code was right; nothing had ever
 * confirmed it.
 *
 * The `??` fallback is deliberately NOT kept. Returning `''` for every spec would sort them
 * all equal and silently destroy the ordering this suite depends on (MK-016), which is the
 * worst possible failure for a sequencer. If a future vitest changes the shape, this throws.
 */
function specPath(spec: WorkspaceSpec): string {
  const path = spec.moduleId
  if (typeof path !== 'string' || path === '') {
    throw new Error(
      `AlphabeticalSequencer: a spec has no moduleId (${JSON.stringify(spec)}). The fork project shares one anvil instance and depends on a stable file order, so guessing here would reorder it silently.`,
    )
  }
  return path
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
  override async sort(files: WorkspaceSpec[]): Promise<WorkspaceSpec[]> {
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
      /**
       * BOTH published packages (MK-087). `_generated/` is ABI and address data emitted from
       * the contracts package, not logic, and would dilute the floor.
       *
       * **`packages/react/src` was outside this glob until the P17 wave**, and that is the
       * structural reason MK-085 shipped. The coverage gate, the mutation check and the
       * differential sweep all stopped at the core boundary, so eighty four findings contained
       * nothing about the React package, and the one control that could have caught MK-085
       * measured the wrong directory. Including it DROPPED the reported figure, which is the
       * point: the old number was high because it was scoped to the half that was tested.
       * The floor below is the honest measurement of the wider scope.
       */
      include: ['packages/core/src/**/*.ts', 'packages/react/src/**/*.ts'],
      exclude: ['packages/core/src/_generated/**'],
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
      /**
       * The floor is the honestly MEASURED number, rounded down, not an aspiration.
       * It is a RATCHET: it only ever moves up. Raise it when real coverage rises;
       * never lower it to make a red build green. Measured on the full suite
       * (`pnpm test:coverage`, both projects), which is what CI runs.
       *
       * **The P17 wave moved three of these DOWN, and that is not a lowered ratchet: it is a
       * WIDENED SCOPE** (MK-087). `packages/react/src` was outside the `include` glob above until
       * this wave, so the old figures graded half of what the repository publishes. Including the
       * other half cannot be done without the number moving, and hiding the move by keeping the
       * glob narrow is the thing the ratchet exists to prevent. The two measurements, same suite,
       * same fork block 15043414, same run:
       *
       *   core only, the old scope   statements 98.65 · branches 93.20 · functions 100   · lines 98.65
       *   both packages, the new one statements 94.87 · branches 92.36 · functions  88.18 · lines 94.87
       *
       * The core half did not get worse. It improved on every metric (98.62 to 98.65 statements,
       * 92.98 to 93.20 branches). What changed is that six React files now count, and they are
       * thin:
       *
       *   hooks/reads.ts            statements 50.00  branches 80.95  functions 50.00
       *   hooks/writes.ts           statements 75.00  branches 93.75  functions 53.33
       *   internal/keys.ts          statements 78.12  branches 90.90  functions 33.33
       *   internal/useMusdQuery.ts  statements 77.77  branches 70.00  functions 100
       *   internal/useMusdClient.ts statements 89.47  branches 66.66  functions 100
       *   index.ts                  statements 100    branches 100    functions 100
       *
       * `functions` is the metric that fell furthest, 100 to 88.18, and the reason is visible in
       * that table: every unrendered hook is an uncovered function. One rendered test landed in
       * this wave (`adjust-preview-hook.test.ts`); the rest of the surface is exercised only by
       * the fork hook tests, which reach a fraction of it. **That gap is the finding, not the
       * floor**, and the floor now makes it visible on every run instead of hiding it behind a
       * glob.
       *
       * History of the core-only figures, kept because the ratchet's argument is its history:
       * statements 95.32 at wiring, 98.20 after the P4 S2 sweep, 98.62 after P13.
       *
       * **P21 raised both floors, and gave the React package one of its own** (MK-102, MK-109). The
       * table above was the finding: every unrendered hook was an uncovered function. The rendered
       * chain free tests (`hooks-rendered.test.ts`) now reach every hook, so the React figure is
       * measured on its own glob, where a React regression cannot hide inside the much larger core.
       * Same suite, same fork block 15043414, one run:
       *
       *   both packages   statements 98.65 · branches 93.86 · functions 100 · lines 98.65
       *   react/src only  statements 99.12 · branches 95.68 · functions 100 · lines 99.12 (337 of 340)
       *
       * The React line floor has no slack at 99: one uncovered line is 98.82. That is the honest
       * number rounded down, which is the rule; if a line is found to flicker between runs, the fix is
       * to make its test deterministic, not to lower the floor.
       */
      thresholds: {
        // Measured 98.65 / 93.86 / 100 / 98.65 over BOTH packages, rounded down.
        lines: 98,
        functions: 100,
        branches: 93,
        statements: 98,
        // Measured 99.12 / 95.68 / 100 / 99.12 over `packages/react/src` alone, rounded down.
        'packages/react/src/**/*.ts': {
          lines: 99,
          functions: 100,
          branches: 95,
          statements: 99,
        },
      },
    },
  },
})
