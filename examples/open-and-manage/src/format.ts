import { formatUnits, parseUnits } from 'viem'

/** Format an 18-decimal bigint (BTC or MUSD) for display. */
export function fmt(v: bigint | undefined, dp = 4): string {
  if (v === undefined) return '—'
  return Number(formatUnits(v, 18)).toLocaleString(undefined, { maximumFractionDigits: dp })
}

/** ICR / liquidation-health as a percent string. */
export function pct(v: bigint | undefined): string {
  if (v === undefined) return '—'
  return `${(Number(formatUnits(v, 18)) * 100).toFixed(1)}%`
}

/** Parse a user string into an 18-decimal bigint, or undefined if invalid/empty. */
export function parse18(s: string): bigint | undefined {
  if (!s.trim()) return undefined
  try {
    return parseUnits(s as `${number}`, 18)
  } catch {
    return undefined
  }
}
