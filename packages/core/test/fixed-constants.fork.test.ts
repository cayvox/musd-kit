import type { Abi } from 'viem'
import { describe, expect, it } from 'vitest'
import { FIXED_CONSTANTS, borrowerOperationsAbi, getAddresses, troveManagerAbi } from '../src'
import { connectFork } from './harness'

/**
 * The bundled fixed constants against the deployed contracts' own getters, at the pinned block.
 *
 * `decision-pins.test.ts` pins them to the literals in the Solidity source. This is the other half: the
 * deployment answers the same values, so a bundled constant cannot be right about the source and wrong
 * about the chain. `_100pct` has a getter too (`LiquityBase.sol:19`, `public constant`). `MCR` and `CCR`
 * are compared by `verifyDeployment` on every client (MK-008) and are included here for completeness.
 */
const T = getAddresses(31611)

describe('the bundled fixed constants are the deployed constants', () => {
  it('BorrowerOperations and TroveManager answer every one of them', async () => {
    const { publicClient } = connectFork()
    const read = (address: `0x${string}`, abi: Abi, functionName: string) =>
      publicClient.readContract({ address, abi, functionName }) as Promise<bigint>
    const bo = borrowerOperationsAbi as Abi
    const tm = troveManagerAbi as Abi
    expect(await read(T.borrowerOperations, bo, '_100pct')).toBe(FIXED_CONSTANTS.ONE_HUNDRED_PCT)
    expect(await read(T.borrowerOperations, bo, 'MCR')).toBe(FIXED_CONSTANTS.MCR)
    expect(await read(T.borrowerOperations, bo, 'CCR')).toBe(FIXED_CONSTANTS.CCR)
    expect(await read(T.borrowerOperations, bo, 'MUSD_GAS_COMPENSATION')).toBe(
      FIXED_CONSTANTS.MUSD_GAS_COMPENSATION,
    )
    expect(await read(T.troveManager, tm, 'PERCENT_DIVISOR')).toBe(FIXED_CONSTANTS.PERCENT_DIVISOR)
    expect(await read(T.borrowerOperations, bo, 'DECIMAL_PRECISION')).toBe(
      FIXED_CONSTANTS.DECIMAL_PRECISION,
    )
    expect(await read(T.borrowerOperations, bo, 'MIN_NET_DEBT_MIN')).toBe(
      FIXED_CONSTANTS.MIN_NET_DEBT_MIN,
    )
  })
})
