import type { Address, PublicClient, WalletClient } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONSTANTS_TTL_MS,
  DeploymentVerificationFailed,
  createContracts,
  getAddresses,
} from '../src'
import { verifyDeployment } from '../src/client/verifyDeployment'
import { getTrove } from '../src/read'

/**
 * The client's own plumbing where a branch decides what a caller sees: why a deployment failed to
 * verify, how long governable values are trusted, and whether contract instances can write. Each block
 * cites its finding.
 */

const T = getAddresses(31611)

describe('MK-119, a verification batch that cannot be read', () => {
  const failing = (codeOf: (a: Address) => `0x${string}` | undefined) =>
    ({
      multicall: async () => {
        throw new Error('the contract function returned no data ("0x")')
      },
      getCode: async ({ address }: { address: Address }) => codeOf(address),
    }) as unknown as PublicClient

  it('names exactly the addresses with no code, whether viem reports it as undefined or as 0x', async () => {
    const empty = new Set([T.musd.toLowerCase(), T.priceFeed.toLowerCase()])
    const client = failing((a) =>
      a.toLowerCase() === T.musd.toLowerCase()
        ? undefined
        : empty.has(a.toLowerCase())
          ? '0x'
          : '0xdeadbeef',
    )
    const error = await verifyDeployment(client, T).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DeploymentVerificationFailed)
    const failures = (error as DeploymentVerificationFailed).failures
    expect(failures).toHaveLength(2)
    expect(failures.join('\n')).toContain(T.musd)
    expect(failures.join('\n')).toContain(T.priceFeed)
  })

  it('says the batch could not be read when every address has code, rather than naming none', async () => {
    const error = await verifyDeployment(
      failing(() => '0xdeadbeef'),
      T,
    ).catch((e: unknown) => e)
    expect((error as DeploymentVerificationFailed).failures).toEqual([
      'the deployment verification batch could not be read; see `cause` for the underlying error',
    ])
  })
})

describe('MK-118, the governable constants TTL', () => {
  it('is 60 seconds, the value its docstring argues for', () => {
    expect(DEFAULT_CONSTANTS_TTL_MS).toBe(60_000)
  })
})

describe('MK-120, contract instances', () => {
  it('can write when a wallet client is given, and cannot without one', () => {
    const publicClient = {} as PublicClient
    const walletClient = { account: undefined } as unknown as WalletClient
    expect(createContracts(T, publicClient, walletClient).borrowerOperations).toHaveProperty(
      'write',
    )
    expect(createContracts(T, publicClient).borrowerOperations).not.toHaveProperty('write')
  })
})

describe('MK-206, getTrove reports a Trove only when it is active AND carries debt', () => {
  const clientFor = (status: number, principal: bigint) =>
    ({
      multicall: async ({ contracts }: { contracts: readonly { functionName: string }[] }) =>
        contracts.map((c) => {
          switch (c.functionName) {
            case 'fetchPrice':
              return 80_000n * 10n ** 18n
            case 'getBlockNumber':
              return 100n
            case 'getEntireDebtAndColl':
              return [10n ** 19n, principal, 0n, 0n, 0n, 0n]
            case 'getNominalICR':
              return 1n
            case 'getTroveInterestRate':
              return 100
            case 'getTroveStatus':
              return status
            case 'getTroveOwnersCount':
              return 5n
            case 'getCurrentICR':
              return 4n * 10n ** 18n
            default:
              throw new Error(`unstubbed multicall read: ${c.functionName}`)
          }
        }),
    }) as unknown as PublicClient

  it('an active Trove with debt exists; a closed one, or one with no debt, does not', async () => {
    const read = (status: number, principal: bigint) =>
      getTrove({ publicClient: clientFor(status, principal), addresses: T }, T.troveManager)
    expect((await read(1, 20_000n * 10n ** 18n)).exists).toBe(true)
    expect((await read(2, 20_000n * 10n ** 18n)).exists, 'closed, whatever the debt reads').toBe(
      false,
    )
    expect((await read(1, 0n)).exists, 'active status, but no debt').toBe(false)
  })
})
