/** Types for `deprecation-verify.mjs`, so the unit pins that import it typecheck (MK-256). */
export type DeprecationVerdict =
  | { state: 'matches' }
  | { state: 'absent' }
  | { state: 'different'; onRegistry: string }

export declare function verdictFor(
  onRegistry: string | undefined | null,
  intended: string,
): DeprecationVerdict
export declare const worthRetrying: (verdict: DeprecationVerdict) => boolean
export declare function deprecatedIn(doc: unknown, version: string): string
export declare function pollUntilMatches(params: {
  pkg: string
  version: string
  intended: string
  read: (pkg: string) => Promise<string>
  attempts?: number
  intervalMs?: number
  log?: (line: string) => void
  sleep?: (ms: number) => Promise<void>
}): Promise<DeprecationVerdict>
