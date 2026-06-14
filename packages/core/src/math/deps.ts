import type { PublicClient } from 'viem'
import type { MusdAddresses } from '../addresses'

/** What the preview calculators need. Supplied by `createMusdClient`. */
export interface MathDeps {
  publicClient: PublicClient
  addresses: MusdAddresses
  /** Live, session-cached `minNetDebt()` (Law 3) — from `createMusdClient.getConstants`. */
  getMinNetDebt: () => Promise<bigint>
}
