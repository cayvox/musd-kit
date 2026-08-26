import type { Abi, Address, PublicClient } from 'viem'
import { isAddressEqual, zeroAddress } from 'viem'
import type { MusdAddresses, MusdContractName } from '../addresses'
import { MUSD_CONTRACT_NAMES } from '../addresses'
import {
  borrowerOperationsAbi,
  hintHelpersAbi,
  interestRateManagerAbi,
  musdAbi,
  priceFeedAbi,
  sortedTrovesAbi,
  troveManagerAbi,
} from '../clients'
import { CCR as BUNDLED_CCR, MCR as BUNDLED_MCR, MULTICALL3_ADDRESS } from '../constants'
import { DeploymentVerificationFailed, MismatchedDeployment } from '../errors'

/**
 * One cross wiring assertion: contract `holder` should point at the bundled `expected`.
 *
 * The set is NOT invented here. It is exactly the set `scripts/onchain-facts.ts` reads and
 * that `docs/09-review-and-validated-surface.md` §6 records as holding at a pinned block on
 * BOTH chains, testnet 31611 and mainnet 31612. Reusing it rather than deriving a new list
 * is deliberate: a pointer this SDK asserts but has never observed would be a guess, and a
 * guess that fails looks exactly like a compromised deployment.
 */
interface WiringCheck {
  holder: MusdContractName
  abi: Abi
  fn: string
  expected: MusdContractName
}

const WIRING: readonly WiringCheck[] = [
  {
    holder: 'troveManager',
    abi: troveManagerAbi as Abi,
    fn: 'sortedTroves',
    expected: 'sortedTroves',
  },
  {
    holder: 'troveManager',
    abi: troveManagerAbi as Abi,
    fn: 'borrowerOperations',
    expected: 'borrowerOperations',
  },
  {
    holder: 'troveManager',
    abi: troveManagerAbi as Abi,
    fn: 'interestRateManager',
    expected: 'interestRateManager',
  },
  { holder: 'troveManager', abi: troveManagerAbi as Abi, fn: 'priceFeed', expected: 'priceFeed' },
  { holder: 'troveManager', abi: troveManagerAbi as Abi, fn: 'musdToken', expected: 'musd' },
  {
    holder: 'borrowerOperations',
    abi: borrowerOperationsAbi as Abi,
    fn: 'troveManager',
    expected: 'troveManager',
  },
  {
    holder: 'borrowerOperations',
    abi: borrowerOperationsAbi as Abi,
    fn: 'interestRateManager',
    expected: 'interestRateManager',
  },
  {
    holder: 'borrowerOperations',
    abi: borrowerOperationsAbi as Abi,
    fn: 'priceFeed',
    expected: 'priceFeed',
  },
  { holder: 'borrowerOperations', abi: borrowerOperationsAbi as Abi, fn: 'musd', expected: 'musd' },
  {
    holder: 'hintHelpers',
    abi: hintHelpersAbi as Abi,
    fn: 'troveManager',
    expected: 'troveManager',
  },
  {
    holder: 'hintHelpers',
    abi: hintHelpersAbi as Abi,
    fn: 'sortedTroves',
    expected: 'sortedTroves',
  },
  {
    holder: 'hintHelpers',
    abi: hintHelpersAbi as Abi,
    fn: 'borrowerOperations',
    expected: 'borrowerOperations',
  },
  {
    holder: 'sortedTroves',
    abi: sortedTrovesAbi as Abi,
    fn: 'troveManager',
    expected: 'troveManager',
  },
  {
    holder: 'sortedTroves',
    abi: sortedTrovesAbi as Abi,
    fn: 'borrowerOperationsAddress',
    expected: 'borrowerOperations',
  },
]

/**
 * `HintHelpers.priceFeed()` is the one pointer that is CORRECTLY zero, and asserting it
 * against the bundled map would be a false alarm on a healthy deployment.
 *
 * `HintHelpers.setAddresses` (`HintHelpers.sol:40-58`) takes exactly three addresses,
 * borrowerOperations, sortedTroves and troveManager, and never assigns `priceFeed`. The
 * getter exists only because HintHelpers inherits LiquityBase (`HintHelpers.sol:9,18`), and
 * the contract never reads it. Read at the pinned block on both chains it is
 * `0x0000...0000` (`docs/09` §6). What is worth asserting is that it STAYS zero: a non-zero
 * value would mean the contract had gained a price dependency it did not have.
 */
const UNSET: WiringCheck = {
  holder: 'hintHelpers',
  abi: hintHelpersAbi as Abi,
  fn: 'priceFeed',
  expected: 'priceFeed',
}

/**
 * A read on each bundled address that is not already covered by a wiring pointer, so that
 * `allowFailure: false` proves code is present at ALL SEVEN, not just the four that hold
 * pointers. `priceFeed`, `musd` and `interestRateManager` are only ever pointer TARGETS, so
 * without these three a deployment could name an empty address for any of them and pass.
 *
 * These are presence probes and nothing more: their values are deliberately not asserted
 * against anything, because no value for them has been established as invariant. Claiming
 * more than that is how a verification step starts lying.
 */
const PRESENCE: readonly { holder: MusdContractName; abi: Abi; fn: string }[] = [
  { holder: 'priceFeed', abi: priceFeedAbi as Abi, fn: 'oracle' },
  { holder: 'musd', abi: musdAbi as Abi, fn: 'decimals' },
  { holder: 'interestRateManager', abi: interestRateManagerAbi as Abi, fn: 'interestRate' },
]

/**
 * Assert this is really the MUSD deployment the SDK thinks it is (MK-008).
 *
 * What it used to be: two constant views, `MCR()` and `CCR()`, on ONE of the seven bundled
 * addresses. A fifteen line contract returning those two constants passed it. There was no
 * code presence check and no cross wiring assertion, even though the pointer getters exist
 * and are free to call.
 *
 * What it asserts now, in a single `multicall`:
 *
 *   - **Code at every bundled address.** Not as a separate `eth_getCode` sweep: every one of
 *     the seven has at least one read in the batch, and `allowFailure: false` means a read
 *     against an address with no code fails the whole call. The sweep is run only on
 *     failure, to name WHICH address is empty rather than leaving a decode error.
 *   - **The cross wiring**, all fourteen pointers, each against the bundled map. This is the
 *     assertion that makes identity mean something: a lookalike contract can return `MCR`,
 *     but it cannot make the real `TroveManager` point at it.
 *   - **`HintHelpers.priceFeed()` stays unset**, which is the one pointer that is correctly
 *     zero and would be a false alarm if asserted against the map.
 *   - **`MCR` and `CCR`** equal the bundled fixed constants, as before, and still throwing
 *     `MismatchedDeployment` so that existing branch is unchanged.
 *
 * Every failure is collected before throwing, rather than stopping at the first. A
 * deployment that is wrong is usually wrong in more than one place, and one assertion at a
 * time turns that into several round trips of guessing.
 */
export async function verifyDeployment(
  publicClient: PublicClient,
  addresses: MusdAddresses,
): Promise<void> {
  const contracts = [
    { address: addresses.troveManager, abi: troveManagerAbi as Abi, functionName: 'MCR' },
    { address: addresses.troveManager, abi: troveManagerAbi as Abi, functionName: 'CCR' },
    ...WIRING.map((c) => ({ address: addresses[c.holder], abi: c.abi, functionName: c.fn })),
    { address: addresses[UNSET.holder], abi: UNSET.abi, functionName: UNSET.fn },
    ...PRESENCE.map((c) => ({ address: addresses[c.holder], abi: c.abi, functionName: c.fn })),
  ]

  let results: readonly unknown[]
  try {
    results = await publicClient.multicall({
      allowFailure: false,
      multicallAddress: MULTICALL3_ADDRESS,
      contracts,
    })
  } catch (error) {
    throw await explainMulticallFailure(publicClient, addresses, error)
  }

  const [onchainMcr, onchainCcr] = results as [bigint, bigint]
  if (onchainMcr !== BUNDLED_MCR) throw new MismatchedDeployment('MCR', BUNDLED_MCR, onchainMcr)
  if (onchainCcr !== BUNDLED_CCR) throw new MismatchedDeployment('CCR', BUNDLED_CCR, onchainCcr)

  const failures: string[] = []
  WIRING.forEach((check, i) => {
    const actual = results[2 + i] as Address
    const expected = addresses[check.expected]
    if (!isAddressEqual(actual, expected)) {
      failures.push(
        `${check.holder}.${check.fn}() is ${actual}, but the resolved ${check.expected} is ${expected}`,
      )
    }
  })

  const unsetActual = results[2 + WIRING.length] as Address
  if (!isAddressEqual(unsetActual, zeroAddress)) {
    failures.push(
      `${UNSET.holder}.${UNSET.fn}() is ${unsetActual}, but this deployment never assigns it, so it should be the zero address`,
    )
  }

  if (failures.length > 0) throw new DeploymentVerificationFailed(failures)
}

/**
 * Turn a failed batch into a message that names the problem.
 *
 * `allowFailure: false` gives one opaque error for the whole call, and the most likely cause
 * by far is an address with no code at it, which is precisely what an unvalidated override
 * or a wrong chain produces. Reading the code costs seven calls, and it is worth them here
 * because this path runs once and only when something is already wrong.
 */
async function explainMulticallFailure(
  publicClient: PublicClient,
  addresses: MusdAddresses,
  cause: unknown,
): Promise<Error> {
  let empty: MusdContractName[] = []
  try {
    const codes = await Promise.all(
      MUSD_CONTRACT_NAMES.map((name) => publicClient.getCode({ address: addresses[name] })),
    )
    empty = MUSD_CONTRACT_NAMES.filter((_, i) => {
      const code = codes[i]
      return code === undefined || code === '0x'
    })
  } catch {
    // The code sweep itself failed, so the transport is the problem, not the deployment.
    // Fall through with no `empty` entries and let the message say what is actually known.
  }

  if (empty.length > 0) {
    return new DeploymentVerificationFailed(
      empty.map((name) => `no contract code at the ${name} address (${addresses[name]})`),
      cause,
    )
  }
  return new DeploymentVerificationFailed(
    ['the deployment verification batch could not be read; see `cause` for the underlying error'],
    cause,
  )
}
