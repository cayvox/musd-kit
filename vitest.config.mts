import { type TestSpecification, defineConfig } from 'vitest/config'
import { BaseSequencer } from 'vitest/node'

/** Path of a spec across vitest versions (object `.moduleId` or `[project, file]` tuple). */
function specPath(spec: TestSpecification): string {
  const s = spec as unknown as { moduleId?: string } & [unknown, string?]
  return s.moduleId ?? (Array.isArray(spec) ? (s[1] ?? '') : '')
}

/**
 * Deterministic, alphabetical file order. The whole suite shares ONE anvil fork
 * (globalSetup), and some files warp the EVM clock forward (phase2 30d, phase4 45d,
 * phase6 1y). With vitest's default size/timing-based sequencer the order differs
 * between environments, so a big warp could run before a file that assumes a fresh
 * clock (this broke CI when phase6 ran before phase5). Sorting by path keeps the
 * phase order stable: each warp only affects strictly-later phases (and `smoke`,
 * which reads only constants/price and is warp-robust).
 */
class AlphabeticalSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return [...files].sort((a, b) => specPath(a).localeCompare(specPath(b)))
  }
}

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
    // The fork is shared mutable state; run files serially in a STABLE order.
    fileParallelism: false,
    pool: 'forks',
    sequence: { sequencer: AlphabeticalSequencer },
  },
})
