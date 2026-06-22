import { formatUnits, parseUnits } from 'viem'

// Unit helpers (docs/08 §5). BTC and MUSD are both 18-decimal on Mezo, so these are thin,
// well-named aliases over viem's parseUnits/formatUnits, they exist for readable call sites
// (`parseBtc('0.05')` reads better than `parseEther('0.05')` next to an MUSD amount).

/** Parse a BTC amount string into wei (×1e18). e.g. `parseBtc('0.05')`. */
export function parseBtc(value: string): bigint {
  return parseUnits(value as `${number}`, 18)
}

/** Format BTC wei (1e18-scaled) back to a decimal string. */
export function formatBtc(value: bigint): string {
  return formatUnits(value, 18)
}

/** Parse an MUSD amount string into wei (×1e18). e.g. `parseMusd('2500')`. */
export function parseMusd(value: string): bigint {
  return parseUnits(value as `${number}`, 18)
}

/** Format MUSD wei (1e18-scaled) back to a decimal string. */
export function formatMusd(value: bigint): string {
  return formatUnits(value, 18)
}

/**
 * Parse basis points into the 1e18-scaled fraction the fee/rate guards expect
 * (`maxFeePercentage`): `parseBps(100)` = 1% = `1e16`. (100 bps = 1%.)
 */
export function parseBps(bps: number): bigint {
  return (BigInt(bps) * 10n ** 18n) / 10_000n
}
