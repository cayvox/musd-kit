import type { Abi, Address, PublicClient } from 'viem'
import { zeroAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  CCR,
  DeploymentVerificationFailed,
  MCR,
  MismatchedDeployment,
  type MusdAddresses,
  getAddresses,
} from '../src'
import { verifyDeployment } from '../src/client/verifyDeployment'

const T = getAddresses(31611)

/**
 * A `publicClient` that answers a `multicall` from a lookup table, so a whole deployment can
 * be described in a few lines and one pointer bent at a time.
 *
 * Keyed by `address.toLowerCase()|functionName`, which is enough: no check in the batch
 * takes arguments.
 */
function fakeClient(
  overrides: Record<string, unknown> = {},
  opts: { onGetCode?: (address: Address) => `0x${string}` } = {},
) {
  let multicalls = 0
  const base: Record<string, unknown> = {
    [`${T.troveManager.toLowerCase()}|MCR`]: MCR,
    [`${T.troveManager.toLowerCase()}|CCR`]: CCR,
    [`${T.troveManager.toLowerCase()}|sortedTroves`]: T.sortedTroves,
    [`${T.troveManager.toLowerCase()}|borrowerOperations`]: T.borrowerOperations,
    [`${T.troveManager.toLowerCase()}|interestRateManager`]: T.interestRateManager,
    [`${T.troveManager.toLowerCase()}|priceFeed`]: T.priceFeed,
    [`${T.troveManager.toLowerCase()}|musdToken`]: T.musd,
    [`${T.borrowerOperations.toLowerCase()}|troveManager`]: T.troveManager,
    [`${T.borrowerOperations.toLowerCase()}|interestRateManager`]: T.interestRateManager,
    [`${T.borrowerOperations.toLowerCase()}|priceFeed`]: T.priceFeed,
    [`${T.borrowerOperations.toLowerCase()}|musd`]: T.musd,
    [`${T.hintHelpers.toLowerCase()}|troveManager`]: T.troveManager,
    [`${T.hintHelpers.toLowerCase()}|sortedTroves`]: T.sortedTroves,
    [`${T.hintHelpers.toLowerCase()}|borrowerOperations`]: T.borrowerOperations,
    [`${T.hintHelpers.toLowerCase()}|priceFeed`]: zeroAddress,
    [`${T.sortedTroves.toLowerCase()}|troveManager`]: T.troveManager,
    [`${T.sortedTroves.toLowerCase()}|borrowerOperationsAddress`]: T.borrowerOperations,
    [`${T.priceFeed.toLowerCase()}|oracle`]: '0x7b7C000000000000000000000000000000000015',
    [`${T.musd.toLowerCase()}|decimals`]: 18,
    [`${T.interestRateManager.toLowerCase()}|interestRate`]: 100,
  }
  const table = { ...base, ...overrides }
  const client = {
    multicall: async ({
      contracts,
    }: { contracts: readonly { address: Address; abi: Abi; functionName: string }[] }) => {
      multicalls += 1
      return contracts.map((c) => {
        const key = `${c.address.toLowerCase()}|${c.functionName}`
        const value = table[key]
        if (!(key in table) || value === MISSING) {
          throw new Error(`the contract function "${c.functionName}" returned no data ("0x")`)
        }
        return value
      })
    },
    getCode: async ({ address }: { address: Address }) =>
      opts.onGetCode ? opts.onGetCode(address) : ('0xdeadbeef' as `0x${string}`),
  } as unknown as PublicClient
  return { client, multicalls: () => multicalls }
}

const key = (address: string, fn: string) => `${address.toLowerCase()}|${fn}`

/** Sentinel for "this address has no code", so the fake throws the way viem would. */
const MISSING = Symbol('missing')

/**
 * MK-008. `verifyDeployment` read two constant views, `MCR()` and `CCR()`, on ONE of the
 * seven bundled addresses. A fifteen line contract returning those two constants passed it,
 * and it ran only from `getConstants()`, so every write was otherwise unverified.
 *
 * There was one paired test before this wave, `phase1.fork.test.ts` "verifyDeployment
 * passes", which asserts the happy path on a real deployment. That test passes against the
 * old implementation AND the new one, so it could never have caught the finding. These can,
 * and the lookalike case below is the finding stated as an executable claim.
 */
describe('MK-008, deployment verification asserts identity, not two constants', () => {
  it('passes on a consistent deployment, in exactly one multicall', async () => {
    const { client, multicalls } = fakeClient()
    await expect(verifyDeployment(client, T)).resolves.toBeUndefined()
    expect(multicalls()).toBe(1)
  })

  it('REJECTS the lookalike that used to pass: right constants, no wiring', async () => {
    // A contract that returns MCR and CCR and nothing else. Under the old implementation
    // this was indistinguishable from the real TroveManager.
    const lookalike = '0x000000000000000000000000000000000000BEEF' as Address
    const addresses: MusdAddresses = { ...T, troveManager: lookalike }
    const { client } = fakeClient({
      [key(lookalike, 'MCR')]: MCR,
      [key(lookalike, 'CCR')]: CCR,
      [key(lookalike, 'sortedTroves')]: zeroAddress,
      [key(lookalike, 'borrowerOperations')]: zeroAddress,
      [key(lookalike, 'interestRateManager')]: zeroAddress,
      [key(lookalike, 'priceFeed')]: zeroAddress,
      [key(lookalike, 'musdToken')]: zeroAddress,
    })
    const err = await verifyDeployment(client, addresses).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DeploymentVerificationFailed)
    // Every failure at once, not the first: a wrong deployment is usually wrong in several
    // places, and one per round trip turns diagnosis into guessing.
    const failures = (err as DeploymentVerificationFailed).failures
    expect(failures.length).toBeGreaterThan(1)
    expect(failures.join('\n')).toContain('troveManager.sortedTroves()')
  })

  it('catches a single bent pointer, which is what a partial override produces', async () => {
    // Exactly the MK-009 case: one contract swapped inside an otherwise trusted map. The
    // substitute is a WELL FORMED SortedTroves: real code, and its own pointers aimed back
    // at the genuine contracts, so nothing about reading it fails. It is caught anyway,
    // because the real TroveManager and HintHelpers do not point at it. That is the whole
    // argument for asserting wiring rather than values.
    const foreign = '0x000000000000000000000000000000000000CAFE' as Address
    const { client } = fakeClient({
      [key(foreign, 'troveManager')]: T.troveManager,
      [key(foreign, 'borrowerOperationsAddress')]: T.borrowerOperations,
    })
    const err = await verifyDeployment(client, { ...T, sortedTroves: foreign }).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(DeploymentVerificationFailed)
    const text = (err as DeploymentVerificationFailed).failures.join('\n')
    expect(text).toContain('troveManager.sortedTroves()')
    expect(text).toContain('hintHelpers.sortedTroves()')
    expect(text).toContain(foreign)
  })

  it('names the address with no code instead of surfacing a decode error', async () => {
    const { client } = fakeClient(
      { [`${T.musd.toLowerCase()}|decimals`]: MISSING },
      { onGetCode: (a) => (a.toLowerCase() === T.musd.toLowerCase() ? '0x' : '0xdeadbeef') },
    )
    // `decimals` is a PRESENCE probe: musd holds no wiring pointer, so without it an empty
    // address there would satisfy every other assertion in the batch.
    const err = await verifyDeployment(client, T).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DeploymentVerificationFailed)
    expect((err as DeploymentVerificationFailed).failures.join('\n')).toContain('no contract code')
    expect((err as DeploymentVerificationFailed).failures.join('\n')).toContain('musd')
  })

  it('a non-zero HintHelpers.priceFeed() is a failure, and zero is not', async () => {
    const { client: healthy } = fakeClient()
    await expect(verifyDeployment(healthy, T)).resolves.toBeUndefined()

    const { client: changed } = fakeClient({
      [key(T.hintHelpers, 'priceFeed')]: T.priceFeed,
    })
    const err = await verifyDeployment(changed, T).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DeploymentVerificationFailed)
    expect((err as DeploymentVerificationFailed).failures.join('\n')).toContain(
      'should be the zero address',
    )
  })

  it('still throws MismatchedDeployment for a constant, so that branch is unchanged', async () => {
    const { client } = fakeClient({ [key(T.troveManager, 'MCR')]: MCR + 1n })
    await expect(verifyDeployment(client, T)).rejects.toBeInstanceOf(MismatchedDeployment)
  })
})
