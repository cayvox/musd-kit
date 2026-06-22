import { beforeEach, describe, expect, it } from 'vitest'
import { TESTNET, connectFork } from './harness'

// Phase 1 will move these addresses + full ABIs into addresses/ and clients/.

/** Minimal inline ABIs, only the two functions the Phase-0 gate reads. */
const troveManagerAbi = [
  {
    type: 'function',
    name: 'MCR',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const

const priceFeedAbi = [
  {
    type: 'function',
    name: 'fetchPrice',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const

/**
 * THE PHASE-0 GATE.
 *
 * Reads live MUSD contract state from a fork of the REAL contracts (no mocks):
 * `MCR` is a pure EVM constant; `fetchPrice` is served by the harness's
 * oracle shim, which is seeded with Mezo's real live BTC/USD round data (the MUSD
 * contracts themselves are never mocked). If this passes twice identically, the
 * harness is real.
 */
describe('Phase 0 smoke gate (forked Mezo)', () => {
  beforeEach(() => connectFork().refreshOracle())

  it('reads MCR == 1.1e18 from TroveManager on the fork', async () => {
    const { publicClient } = connectFork()

    const mcr = await publicClient.readContract({
      address: TESTNET.troveManager,
      abi: troveManagerAbi,
      functionName: 'MCR',
    })

    expect(mcr).toBe(1_100_000_000_000_000_000n) // 1.1e18
  })

  it('reads a plausible BTC/USD price from PriceFeed on the fork', async () => {
    const { publicClient } = connectFork()

    const price = await publicClient.readContract({
      address: TESTNET.priceFeed,
      abi: priceFeedAbi,
      functionName: 'fetchPrice',
    })

    console.log(`[smoke] PriceFeed.fetchPrice() = ${price} (1e18-scaled BTC/USD)`)

    expect(price).toBeGreaterThan(0n)
    expect(price).toBeLessThan(10n ** 30n) // sanity ceiling
  })
})
