import type { PublicClient } from 'viem'
import type { MusdAddresses } from '../addresses'

/** What the `read/` functions need. Supplied by `createMusdClient`. */
export interface ReadDeps {
  publicClient: PublicClient
  addresses: MusdAddresses
}
