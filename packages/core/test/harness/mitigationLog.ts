/**
 * Count what the flake mitigations actually do (MK-016).
 *
 * Every mitigation in this suite retries, refreshes or over-provisions, and none of them
 * ever counted. So "the retry loop protects us" and "the retry loop has never fired" were
 * indistinguishable for three waves, and both were being asserted at different times. A
 * mitigation that never fires is dead code; one that fires often is hiding something. There
 * was no way to tell which.
 *
 * The output is one line per invocation, deliberately: the `fork` project runs each file in
 * its own child process (`pool: 'forks'` in `vitest.workspace.mts`), so a module level
 * counter cannot aggregate across files. A greppable line in the run log can, and the run
 * log is already captured for every acceptance window.
 *
 * Format is fixed and machine readable, `key=value` pairs after a stable prefix, so a window
 * of runs can be summed with `grep` and `awk` rather than by eye:
 *
 *   [mitigation] name=redeemFresh attempts=1 outcome=ok
 *
 * `attempts` is ALWAYS the number consumed including the successful one, so `attempts=1`
 * means the mitigation did not fire and anything above 1 means it did.
 */
export const MITIGATION_PREFIX = '[mitigation]'

/** One mitigation invocation: what it is, how many attempts it took, how it ended. */
export interface MitigationRecord {
  /** Stable identifier for the mitigation, matching the name in `FINDINGS.md`. */
  name: string
  /** Attempts consumed INCLUDING the one that succeeded. 1 means it never fired. */
  attempts: number
  /** `ok` when it eventually succeeded, `exhausted` when it ran out. */
  outcome: 'ok' | 'exhausted'
  /** Anything else worth summing over a window, e.g. `gasUsed`. */
  extra?: Record<string, string | number | bigint>
}

/** Emit one greppable line. Never throws, and never changes what a test asserts. */
export function recordMitigation(record: MitigationRecord): void {
  const parts = [`name=${record.name}`, `attempts=${record.attempts}`, `outcome=${record.outcome}`]
  for (const [key, value] of Object.entries(record.extra ?? {})) {
    parts.push(`${key}=${value}`)
  }
  console.log(`${MITIGATION_PREFIX} ${parts.join(' ')}`)
}
