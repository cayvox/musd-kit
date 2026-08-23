/**
 * On-chain facts, read at a pinned block per chain and committed to the repository.
 *
 * The principle: a value without a block number is a memory, not a fact. Every value this
 * script records is governable and can change without notice, so each one is recorded with
 * its chain id and the block it was read at.
 *
 * READ ONLY, BY CONSTRUCTION. This script never sends a transaction, never needs a private
 * key, and never accepts one: it builds a viem *public* client only, so there is no signing
 * path to reach. RPC endpoints come from the environment and are never hardcoded, never
 * printed, and never written to a tracked file.
 *
 * It is NOT wired into push CI on purpose: it needs live endpoints and runs a long log scan,
 * so a network hiccup would redden an unrelated pull request. See `docs/07-testing.md` §7.
 *
 *   Run
 *   ---
 *     export MEZO_TESTNET_RPC_URL=<a Mezo testnet (31611) endpoint>
 *     export MEZO_MAINNET_RPC_URL=<a Mezo mainnet (31612) endpoint>
 *     pnpm facts              # writes docs/09-review-and-validated-surface.md in place
 *     pnpm facts --stdout     # prints the block instead, changes nothing
 *
 *   Either endpoint may be omitted. A chain whose endpoint is missing or unreachable is
 *   reported as missing, in full, rather than silently dropped: a partial table that reads
 *   as complete is worse than an absent one.
 *
 *   Bumping a pinned block is a deliberate act, see PINNED_BLOCKS below.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mezoMainnet, mezoTestnet } from '@mezo-org/chains'
import {
  DEPLOYMENTS,
  borrowerOperationsAbi,
  hintHelpersAbi,
  interestRateManagerAbi,
  musdAbi,
  priceFeedAbi,
  sortedTrovesAbi,
  troveManagerAbi,
} from '@musd-kit/core'
import {
  CCR as BUNDLED_CCR,
  MUSD_GAS_COMPENSATION as BUNDLED_GAS_COMPENSATION,
  MCR as BUNDLED_MCR,
} from '@musd-kit/core'
import {
  http,
  type Abi,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  createPublicClient,
  formatUnits,
  getAddress,
  isAddressEqual,
} from 'viem'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require_ = createRequire(import.meta.url)

/**
 * EIP-1967 implementation slot: `keccak256("eip1967.proxy.implementation") - 1`.
 * Derived and checked rather than copied, see `assertImplementationSlot` below.
 */
const EIP1967_IMPLEMENTATION_SLOT =
  '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' as const

/**
 * The block each chain's facts are read at.
 *
 * Testnet reuses the block the fork suite pins (`MEZO_FORK_BLOCK` in
 * `.github/workflows/ci.yml`) so the recorded facts describe exactly the state the fork
 * tests run against, and the repository has one testnet fixture rather than two that can
 * drift apart. Mainnet has no such fixture, so it pins a finalized block chosen when this
 * script was written.
 *
 * HOW TO BUMP: pick a recent FINALIZED block on that chain,
 *   curl -s -X POST -H 'content-type: application/json' \
 *     --data '{"jsonrpc":"2.0","id":1,"method":"eth_getBlockByNumber","params":["finalized",false]}' \
 *     "$MEZO_TESTNET_RPC_URL"
 * replace the number, and re-run. Bumping changes every recorded value, so it belongs in
 * its own commit with the reason stated. Endpoints prune old state, so a pin that is far in
 * the past will eventually stop being readable; that is the signal to bump.
 */
const PINNED_BLOCKS = {
  31611: 15_043_414n,
  31612: 11_330_182n,
} as const

/** Chunk size for `eth_getLogs`. The public endpoints reject a wider window. */
const LOG_CHUNK_SIZE = 10_000n
/** Concurrent `eth_getLogs` chunks. Kept low deliberately; these are shared public endpoints. */
const LOG_CONCURRENCY = 8
/** Attempts per chunk before the whole scan is declared inconclusive. */
const LOG_RETRIES = 5

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Retry a chunk read with exponential backoff. Transient endpoint errors are common. */
async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  let last: unknown
  for (let attempt = 0; attempt < LOG_RETRIES; attempt++) {
    try {
      return await operation()
    } catch (error) {
      last = error
      if (attempt < LOG_RETRIES - 1) await sleep(500 * 2 ** attempt)
    }
  }
  throw last
}

interface ChainSpec {
  key: 'testnet' | 'mainnet'
  label: string
  chain: Chain
  chainId: 31611 | 31612
  /** Directory name inside the contracts package's `deployments/`. */
  deploymentsDir: string
  rpcEnvVar: string
}

const CHAINS: readonly ChainSpec[] = [
  {
    key: 'testnet',
    label: 'Mezo testnet',
    chain: mezoTestnet,
    chainId: 31611,
    deploymentsDir: 'matsnet',
    rpcEnvVar: 'MEZO_TESTNET_RPC_URL',
  },
  {
    key: 'mainnet',
    label: 'Mezo mainnet',
    chain: mezoMainnet,
    chainId: 31612,
    deploymentsDir: 'mainnet',
    rpcEnvVar: 'MEZO_MAINNET_RPC_URL',
  },
]

/**
 * The bundled address map's keys, in a FIXED order. Output order must never depend on
 * object iteration, or two runs at the same block could differ (see the determinism
 * requirement in `docs/07-testing.md` §7).
 */
const BUNDLED_KEYS = [
  'borrowerOperations',
  'troveManager',
  'sortedTroves',
  'hintHelpers',
  'priceFeed',
  'interestRateManager',
  'musd',
] as const
type BundledKey = (typeof BUNDLED_KEYS)[number]

/** Deployment record name in the contracts package for each bundled address. */
const DEPLOYMENT_RECORD_NAME: Record<BundledKey, string> = {
  borrowerOperations: 'BorrowerOperations',
  troveManager: 'TroveManager',
  sortedTroves: 'SortedTroves',
  hintHelpers: 'HintHelpers',
  priceFeed: 'PriceFeed',
  interestRateManager: 'InterestRateManager',
  musd: 'MUSD',
}

/** Representative collateral amounts (BTC wei) for the redemption fee reads. */
const REDEMPTION_SAMPLES: readonly { label: string; collateralDrawn: bigint }[] = [
  { label: '0.01 BTC', collateralDrawn: 10n ** 16n },
  { label: '0.1 BTC', collateralDrawn: 10n ** 17n },
  { label: '1 BTC', collateralDrawn: 10n ** 18n },
]

/** Representative draws (MUSD wei) for the borrowing fee reads. */
const BORROWING_FEE_SAMPLES: readonly { label: string; debt: bigint }[] = [
  { label: '1,800 MUSD', debt: 1_800n * 10n ** 18n },
  { label: '10,000 MUSD', debt: 10_000n * 10n ** 18n },
  { label: '100,000 MUSD', debt: 100_000n * 10n ** 18n },
]

interface DeploymentRecord {
  address: Address
  abi: Abi
  implementation?: Address
  transactionHash?: Hex
}

function loadDeployment(dir: string, name: string): DeploymentRecord {
  return require_(`@mezo-org/musd-contracts/deployments/${dir}/${name}.json`) as DeploymentRecord
}

/** The `@mezo-org/musd-contracts` version this repository actually pins, read not assumed. */
function pinnedContractsVersion(): string {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'packages/core/package.json'), 'utf8')) as {
    devDependencies?: Record<string, string>
  }
  const pinned = manifest.devDependencies?.['@mezo-org/musd-contracts']
  if (!pinned) throw new Error('packages/core/package.json does not pin @mezo-org/musd-contracts')
  const resolved = (require_('@mezo-org/musd-contracts/package.json') as { version: string })
    .version
  if (resolved !== pinned) {
    throw new Error(
      `@mezo-org/musd-contracts manifest pins ${pinned} but the installed copy is ${resolved}`,
    )
  }
  return pinned
}

/** A single recorded value plus how it was obtained. */
interface Row {
  name: string
  value: string
  note?: string | undefined
}

const NOT_PRESENT = 'not present in the ABI'

/** Read a zero-argument view function, or report that the ABI does not declare it. */
async function readOptional(
  client: PublicClient,
  address: Address,
  abi: Abi,
  functionName: string,
  blockNumber: bigint,
  args: readonly unknown[] = [],
): Promise<{ ok: true; value: unknown } | { ok: false; reason: string }> {
  const declared = abi.some((entry) => entry.type === 'function' && entry.name === functionName)
  if (!declared) return { ok: false, reason: NOT_PRESENT }
  try {
    const value = await client.readContract({
      address,
      abi,
      functionName,
      args,
      blockNumber,
    } as never)
    return { ok: true, value }
  } catch (error) {
    return { ok: false, reason: `read failed: ${shortError(error)}` }
  }
}

function shortError(error: unknown): string {
  const message =
    (error as { shortMessage?: string })?.shortMessage ?? (error as Error)?.message ?? String(error)
  return message.split('\n')[0]?.trim() ?? 'unknown error'
}

/** 1e18-scaled value rendered as both raw wei and a decimal, so neither has to be trusted. */
function fixed18(value: bigint): string {
  return `\`${value}\` (${formatUnits(value, 18)})`
}

/** Derive the EIP-1967 slot rather than trust the constant, and fail loudly on a mismatch. */
async function assertImplementationSlot(): Promise<void> {
  const { keccak256, toBytes } = await import('viem')
  const hashed = keccak256(toBytes('eip1967.proxy.implementation'))
  const derived = `0x${(BigInt(hashed) - 1n).toString(16).padStart(64, '0')}`
  if (derived !== EIP1967_IMPLEMENTATION_SLOT) {
    throw new Error(
      `EIP-1967 slot mismatch: derived ${derived}, constant ${EIP1967_IMPLEMENTATION_SLOT}`,
    )
  }
}

/**
 * Every address the pinned contracts package knows about on a chain, plus every address the
 * SDK bundles: proxy addresses and implementation addresses alike. Used to answer whether an
 * exempt account is protocol plumbing or something else. "Something else" is a legitimate
 * answer to publish; it is NOT evidence of who owns it, and nothing here speculates on that.
 */
function knownProtocolAddresses(deploymentsDir: string): Set<string> {
  const known = new Set<string>()
  const dir = join(
    ROOT,
    'packages/core/node_modules/@mezo-org/musd-contracts/deployments',
    deploymentsDir,
  )
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    const record = JSON.parse(readFileSync(join(dir, file), 'utf8')) as DeploymentRecord
    if (record.address) known.add(record.address.toLowerCase())
    if (record.implementation) known.add(record.implementation.toLowerCase())
  }
  for (const map of Object.values(DEPLOYMENTS)) {
    for (const address of Object.values(map)) known.add(String(address).toLowerCase())
  }
  return known
}

/** The address encoded in the low 20 bytes of a storage word, or null when the word is zero. */
function addressFromSlot(word: Hex): Address | null {
  const value = BigInt(word)
  if (value === 0n) return null
  return getAddress(`0x${value.toString(16).padStart(40, '0').slice(-40)}`)
}

interface ChainFacts {
  spec: ChainSpec
  blockNumber: bigint
  constants: Row[]
  constantDivergences: string[]
  wiring: Row[]
  wiringFailures: string[]
  code: Row[]
  implementations: Row[]
  implementationMismatches: string[]
  feeExempt: FeeExemptResult
}

interface FeeExemptResult {
  governableVariables: Address
  fromBlock: bigint
  toBlock: bigint
  chunkSize: bigint
  chunkCount: number
  added: number
  removed: number
  /** Addresses still exempt at the pinned block, confirmed by a getter call. Sorted. */
  exempt: Address[]
  /** Addresses seen in an Added event but reported not exempt by the getter at the pin. */
  seenButNotExempt: Address[]
  addedEventName: string
  removedEventName: string
  getterName: string
  /** What kind of accounts these are. Populated only when the scan concluded. */
  characterization?: ExemptCharacterization | undefined
  inconclusive?: string
}

/**
 * What KIND of account is exempt, which a reader weighs more heavily than the severity letter.
 * Protocol owned contracts and ordinary external accounts are very different populations.
 */
interface ExemptCharacterization {
  /** Exempt accounts with non empty code at the pinned block. */
  exemptWithCode: number
  /** Exempt accounts with no code, i.e. externally owned, at the pinned block. */
  exemptWithoutCode: number
  /** Exempt accounts matching an address in the pinned package's records or the bundled map. */
  exemptMatchingKnownContract: number
  /** Same three counts across every address ever granted, exempt at the pin or not. */
  grantedWithCode: number
  grantedWithoutCode: number
  grantedMatchingKnownContract: number
  /** How many addresses the known set was built from, so the negative result is checkable. */
  knownAddressCount: number
}

async function collectFeeExempt(
  client: PublicClient,
  spec: ChainSpec,
  blockNumber: bigint,
): Promise<FeeExemptResult> {
  const record = loadDeployment(spec.deploymentsDir, 'GovernableVariables')
  const abi = record.abi

  // Names verified against the deployed ABI, never assumed.
  const events = abi.filter((e) => e.type === 'event') as { type: 'event'; name: string }[]
  const addedEvent = events.find((e) => /FeeExempt.*Added/i.test(e.name))
  const removedEvent = events.find((e) => /FeeExempt.*Removed/i.test(e.name))
  const getter = abi.find(
    (f) => f.type === 'function' && /^isAccountFeeExempt$/.test(f.name ?? ''),
  ) as { name: string } | undefined

  const base: Omit<FeeExemptResult, 'inconclusive'> = {
    governableVariables: getAddress(record.address),
    fromBlock: 0n,
    toBlock: blockNumber,
    chunkSize: LOG_CHUNK_SIZE,
    chunkCount: 0,
    added: 0,
    removed: 0,
    exempt: [],
    seenButNotExempt: [],
    addedEventName: addedEvent?.name ?? NOT_PRESENT,
    removedEventName: removedEvent?.name ?? NOT_PRESENT,
    getterName: getter?.name ?? NOT_PRESENT,
  }

  if (!addedEvent || !removedEvent || !getter) {
    return {
      ...base,
      inconclusive:
        'the deployed GovernableVariables ABI does not declare the expected fee exemption ' +
        'events or getter, so no scan was attempted',
    }
  }

  // Scan the WHOLE chain, genesis to the pinned block. Starting at the contract's
  // deployment block would also be sound, but it would rest on the deployment record's
  // transactionHash meaning what we think it means. Genesis rests on nothing.
  const ranges: { from: bigint; to: bigint }[] = []
  for (let from = 0n; from <= blockNumber; from += LOG_CHUNK_SIZE) {
    const to = from + LOG_CHUNK_SIZE - 1n
    ranges.push({ from, to: to > blockNumber ? blockNumber : to })
  }

  const addedByChunk: Address[][] = new Array(ranges.length).fill(null).map(() => [])
  const removedByChunk: Address[][] = new Array(ranges.length).fill(null).map(() => [])

  let cursor = 0
  let failure: string | undefined
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++
      if (index >= ranges.length || failure) return
      const range = ranges[index]
      if (!range) return
      try {
        // Public endpoints return transient errors under load. Observed directly: a chunk
        // that failed with "Requested resource not available" served the identical request
        // fine moments later. Retry with backoff, because giving up on one flaky chunk
        // would downgrade a complete scan to inconclusive for no real reason. Exhausting
        // the retries still fails the whole scan rather than silently leaving a hole.
        const logs = await withRetry(() =>
          client.getLogs({
            address: getAddress(record.address),
            fromBlock: range.from,
            toBlock: range.to,
          }),
        )
        for (const log of logs) {
          const topic = log.topics[0]
          if (!topic) continue
          if (topic === eventTopic(addedEvent.name)) {
            const account = decodeAccount(log.data, log.topics)
            if (account) addedByChunk[index]?.push(account)
          } else if (topic === eventTopic(removedEvent.name)) {
            const account = decodeAccount(log.data, log.topics)
            if (account) removedByChunk[index]?.push(account)
          }
        }
      } catch (error) {
        failure = `chunk ${range.from}-${range.to} failed after ${LOG_RETRIES} attempts: ${shortError(error)}`
        return
      }
    }
  }
  await Promise.all(Array.from({ length: LOG_CONCURRENCY }, worker))

  if (failure) {
    return {
      ...base,
      chunkCount: ranges.length,
      inconclusive: `the log scan did not complete: ${failure}`,
    }
  }

  const added = addedByChunk.flat()
  const removed = removedByChunk.flat()

  // Candidates are every address ever added. Whether each is exempt AT THE PINNED BLOCK is
  // then read from the contract, so a removal we mis-parsed cannot produce a false positive.
  const candidates = [...new Set(added.map((a) => getAddress(a)))].sort()
  const exempt: Address[] = []
  const seenButNotExempt: Address[] = []
  for (const account of candidates) {
    const result = await readOptional(
      client,
      getAddress(record.address),
      abi,
      getter.name,
      blockNumber,
      [account],
    )
    if (!result.ok) {
      return {
        ...base,
        chunkCount: ranges.length,
        added: added.length,
        removed: removed.length,
        inconclusive: `${getter.name}(${account}) could not be read: ${result.reason}`,
      }
    }
    if (result.value === true) exempt.push(account)
    else seenButNotExempt.push(account)
  }

  // Characterize the cohort. A reader weighs "ordinary external accounts" very differently
  // from "protocol owned contracts", and more heavily than the severity letter.
  const known = knownProtocolAddresses(spec.deploymentsDir)
  const characterization: ExemptCharacterization = {
    exemptWithCode: 0,
    exemptWithoutCode: 0,
    exemptMatchingKnownContract: 0,
    grantedWithCode: 0,
    grantedWithoutCode: 0,
    grantedMatchingKnownContract: 0,
    knownAddressCount: known.size,
  }
  for (const account of candidates) {
    const bytecode = await client.getCode({ address: account, blockNumber })
    const hasCode = Boolean(bytecode && bytecode !== '0x')
    const isKnown = known.has(account.toLowerCase())
    if (hasCode) characterization.grantedWithCode++
    else characterization.grantedWithoutCode++
    if (isKnown) characterization.grantedMatchingKnownContract++
    if (exempt.includes(account)) {
      if (hasCode) characterization.exemptWithCode++
      else characterization.exemptWithoutCode++
      if (isKnown) characterization.exemptMatchingKnownContract++
    }
  }

  return {
    ...base,
    chunkCount: ranges.length,
    added: added.length,
    removed: removed.length,
    exempt,
    seenButNotExempt,
    characterization,
  }
}

const topicCache = new Map<string, Hex>()
function eventTopic(name: string): Hex {
  const cached = topicCache.get(name)
  if (cached) return cached
  // Both fee exemption events have the signature `(address)`, verified against the ABI.
  const { keccak256, toBytes } = require_('viem') as typeof import('viem')
  const topic = keccak256(toBytes(`${name}(address)`))
  topicCache.set(name, topic)
  return topic
}

/** The account for a `(address)` event, whether it is indexed (topic) or not (data). */
function decodeAccount(data: Hex, topics: readonly Hex[]): Address | null {
  const source = topics.length > 1 ? topics[1] : data
  if (!source || source === '0x') return null
  const value = BigInt(source)
  if (value === 0n) return getAddress('0x0000000000000000000000000000000000000000')
  return getAddress(`0x${value.toString(16).padStart(40, '0').slice(-40)}`)
}

async function collectChain(spec: ChainSpec, rpcUrl: string): Promise<ChainFacts> {
  const client = createPublicClient({
    chain: spec.chain,
    transport: http(rpcUrl, { timeout: 120_000, retryCount: 3 }),
  }) as PublicClient

  const actualChainId = await client.getChainId()
  if (actualChainId !== spec.chainId) {
    throw new Error(`${spec.rpcEnvVar} points at chain ${actualChainId}, expected ${spec.chainId}`)
  }

  const blockNumber = PINNED_BLOCKS[spec.chainId]
  const addresses = DEPLOYMENTS[spec.chainId]

  const bo = addresses.borrowerOperations
  const tm = addresses.troveManager
  const irm = addresses.interestRateManager
  const hh = addresses.hintHelpers
  const st = addresses.sortedTroves

  // ---- governable and constant values -------------------------------------------------
  const constants: Row[] = []
  const constantDivergences: string[] = []

  const push = async (
    name: string,
    address: Address,
    abi: Abi,
    fn: string,
    render: (value: unknown) => string,
    args: readonly unknown[] = [],
    note?: string,
  ): Promise<unknown> => {
    const result = await readOptional(client, address, abi, fn, blockNumber, args)
    if (!result.ok) {
      constants.push({ name, value: `**${result.reason}**`, note })
      return undefined
    }
    constants.push({ name, value: render(result.value), note })
    return result.value
  }

  await push('`minNetDebt()`', bo, borrowerOperationsAbi as Abi, 'minNetDebt', (v) =>
    fixed18(v as bigint),
  )
  await push(
    '`interestRate()`',
    irm,
    interestRateManagerAbi as Abi,
    'interestRate',
    (v) => `\`${v}\` bps (${Number(v as number) / 100}%)`,
  )
  await push('`borrowingRate()`', bo, borrowerOperationsAbi as Abi, 'borrowingRate', (v) =>
    fixed18(v as bigint),
  )
  await push('`redemptionRate()`', bo, borrowerOperationsAbi as Abi, 'redemptionRate', (v) =>
    fixed18(v as bigint),
  )
  for (const sample of REDEMPTION_SAMPLES) {
    await push(
      `\`getRedemptionRate(${sample.label})\``,
      bo,
      borrowerOperationsAbi as Abi,
      'getRedemptionRate',
      (v) => fixed18(v as bigint),
      [sample.collateralDrawn],
      'returns a fee AMOUNT in BTC wei, not a rate, despite the name',
    )
  }
  for (const sample of BORROWING_FEE_SAMPLES) {
    await push(
      `\`getBorrowingFee(${sample.label})\``,
      bo,
      borrowerOperationsAbi as Abi,
      'getBorrowingFee',
      (v) => fixed18(v as bigint),
      [sample.debt],
    )
  }
  await push(
    '`refinancingFeePercentage()`',
    bo,
    borrowerOperationsAbi as Abi,
    'refinancingFeePercentage',
    (v) => `\`${v}\` (${v}% of the pre-fee debt)`,
  )

  // MCR, CCR and the gas compensation are read from chain and compared against the values
  // the SDK bundles as constants. A divergence means one of the two is wrong, and we do not
  // get to pick which, so it is reported rather than resolved here.
  const onChainConstants: { name: string; fn: string; bundled: bigint }[] = [
    { name: '`MCR()`', fn: 'MCR', bundled: BUNDLED_MCR },
    { name: '`CCR()`', fn: 'CCR', bundled: BUNDLED_CCR },
    {
      name: '`MUSD_GAS_COMPENSATION()`',
      fn: 'MUSD_GAS_COMPENSATION',
      bundled: BUNDLED_GAS_COMPENSATION,
    },
  ]
  for (const entry of onChainConstants) {
    const result = await readOptional(client, tm, troveManagerAbi as Abi, entry.fn, blockNumber)
    if (!result.ok) {
      constants.push({ name: entry.name, value: `**${result.reason}**` })
      constantDivergences.push(`${entry.name} could not be read on chain: ${result.reason}`)
      continue
    }
    const onChain = result.value as bigint
    const matches = onChain === entry.bundled
    constants.push({
      name: entry.name,
      value: fixed18(onChain),
      note: matches
        ? 'matches the SDK bundled constant'
        : `**DIVERGES from the SDK bundled constant \`${entry.bundled}\`**`,
    })
    if (!matches) {
      constantDivergences.push(
        `${entry.name}: on chain \`${onChain}\`, SDK bundles \`${entry.bundled}\``,
      )
    }
  }

  // ---- cross wiring -------------------------------------------------------------------
  const wiring: Row[] = []
  const wiringFailures: string[] = []

  const checkPointer = async (
    holderLabel: string,
    holder: Address,
    abi: Abi,
    fn: string,
    expected: Address,
    expectedLabel: string,
  ): Promise<void> => {
    const result = await readOptional(client, holder, abi, fn, blockNumber)
    const name = `\`${holderLabel}.${fn}()\``
    if (!result.ok) {
      wiring.push({ name, value: `**${result.reason}**`, note: `expected ${expectedLabel}` })
      if (result.reason !== NOT_PRESENT) wiringFailures.push(`${name}: ${result.reason}`)
      return
    }
    const actual = getAddress(result.value as Address)
    const ok = isAddressEqual(actual, expected)
    wiring.push({
      name,
      value: `\`${actual}\``,
      note: ok
        ? `matches bundled ${expectedLabel}`
        : `**MISMATCH, bundled ${expectedLabel} is \`${expected}\`**`,
    })
    if (!ok) {
      wiringFailures.push(`${name} is \`${actual}\`, bundled ${expectedLabel} is \`${expected}\``)
    }
  }

  /**
   * A getter that exists only because the contract inherits it, and that the contract never
   * assigns. The zero address is the correct value; a NON-zero one is the anomaly, because
   * it would mean the contract gained a dependency it did not have.
   */
  const checkUnsetPointer = async (
    holderLabel: string,
    holder: Address,
    abi: Abi,
    fn: string,
  ): Promise<void> => {
    const result = await readOptional(client, holder, abi, fn, blockNumber)
    const name = `\`${holderLabel}.${fn}()\``
    if (!result.ok) {
      wiring.push({ name, value: `**${result.reason}**`, note: 'expected to be unset' })
      if (result.reason !== NOT_PRESENT) wiringFailures.push(`${name}: ${result.reason}`)
      return
    }
    const actual = getAddress(result.value as Address)
    const unset = BigInt(actual) === 0n
    wiring.push({
      name,
      value: `\`${actual}\``,
      note: unset
        ? 'inherited from LiquityBase and never assigned by `setAddresses`, so zero is correct, not a wiring gap'
        : '**UNEXPECTED, this field is never assigned by the contract yet is non zero**',
    })
    if (!unset) {
      wiringFailures.push(`${name} is \`${actual}\`, but the contract never assigns this field`)
    }
  }

  await checkPointer('TroveManager', tm, troveManagerAbi as Abi, 'sortedTroves', st, 'sortedTroves')
  await checkPointer(
    'TroveManager',
    tm,
    troveManagerAbi as Abi,
    'borrowerOperations',
    bo,
    'borrowerOperations',
  )
  await checkPointer(
    'TroveManager',
    tm,
    troveManagerAbi as Abi,
    'interestRateManager',
    irm,
    'interestRateManager',
  )
  await checkPointer(
    'TroveManager',
    tm,
    troveManagerAbi as Abi,
    'priceFeed',
    addresses.priceFeed,
    'priceFeed',
  )
  await checkPointer(
    'TroveManager',
    tm,
    troveManagerAbi as Abi,
    'musdToken',
    addresses.musd,
    'musd',
  )
  await checkPointer(
    'BorrowerOperations',
    bo,
    borrowerOperationsAbi as Abi,
    'troveManager',
    tm,
    'troveManager',
  )
  await checkPointer(
    'BorrowerOperations',
    bo,
    borrowerOperationsAbi as Abi,
    'interestRateManager',
    irm,
    'interestRateManager',
  )
  await checkPointer(
    'BorrowerOperations',
    bo,
    borrowerOperationsAbi as Abi,
    'priceFeed',
    addresses.priceFeed,
    'priceFeed',
  )
  await checkPointer(
    'BorrowerOperations',
    bo,
    borrowerOperationsAbi as Abi,
    'musd',
    addresses.musd,
    'musd',
  )
  await checkPointer('HintHelpers', hh, hintHelpersAbi as Abi, 'troveManager', tm, 'troveManager')
  await checkPointer('HintHelpers', hh, hintHelpersAbi as Abi, 'sortedTroves', st, 'sortedTroves')
  await checkPointer(
    'HintHelpers',
    hh,
    hintHelpersAbi as Abi,
    'borrowerOperations',
    bo,
    'borrowerOperations',
  )
  // NOT a wiring pointer, and asserting it against the bundled map would be a false alarm.
  // `HintHelpers.setAddresses` (`HintHelpers.sol:40-58`) takes exactly three addresses,
  // borrowerOperations, sortedTroves and troveManager, and never assigns `priceFeed`. The
  // getter exists only because HintHelpers inherits LiquityBase (`HintHelpers.sol:9,18`),
  // and the contract never reads it: the file contains no other reference to it. So the
  // zero address is the CORRECT value. What is worth asserting is that it stays zero, since
  // a non-zero value would mean the contract had gained a price dependency.
  await checkUnsetPointer('HintHelpers', hh, hintHelpersAbi as Abi, 'priceFeed')
  await checkPointer('SortedTroves', st, sortedTrovesAbi as Abi, 'troveManager', tm, 'troveManager')
  await checkPointer(
    'SortedTroves',
    st,
    sortedTrovesAbi as Abi,
    'borrowerOperationsAddress',
    bo,
    'borrowerOperations',
  )

  const symbol = await readOptional(client, addresses.musd, musdAbi as Abi, 'symbol', blockNumber)
  wiring.push({
    name: '`MUSD.symbol()`',
    value: symbol.ok ? `\`${symbol.value}\`` : `**${symbol.reason}**`,
  })
  const decimals = await readOptional(
    client,
    addresses.musd,
    musdAbi as Abi,
    'decimals',
    blockNumber,
  )
  wiring.push({
    name: '`MUSD.decimals()`',
    value: decimals.ok ? `\`${decimals.value}\`` : `**${decimals.reason}**`,
  })
  const oracle = await readOptional(
    client,
    addresses.priceFeed,
    priceFeedAbi as Abi,
    'oracle',
    blockNumber,
  )
  wiring.push({
    name: '`PriceFeed.oracle()`',
    value: oracle.ok ? `\`${getAddress(oracle.value as Address)}\`` : `**${oracle.reason}**`,
    note: 'the BTC/USD source, not part of the bundled map',
  })

  // ---- code and implementations -------------------------------------------------------
  const code: Row[] = []
  const implementations: Row[] = []
  const implementationMismatches: string[] = []
  const pinnedVersion = pinnedContractsVersion()

  for (const key of BUNDLED_KEYS) {
    const address = addresses[key]
    const bytecode = await client.getCode({ address, blockNumber })
    const hasCode = Boolean(bytecode && bytecode !== '0x')
    code.push({
      name: `\`${key}\``,
      value: `\`${address}\``,
      note: hasCode ? `code present, ${(bytecode as string).length / 2 - 1} bytes` : '**NO CODE**',
    })

    const slot = await client.getStorageAt({
      address,
      slot: EIP1967_IMPLEMENTATION_SLOT,
      blockNumber,
    })
    const implementation = slot ? addressFromSlot(slot) : null
    const record = loadDeployment(spec.deploymentsDir, DEPLOYMENT_RECORD_NAME[key])
    const recorded = record.implementation ? getAddress(record.implementation) : null

    if (!implementation) {
      implementations.push({
        name: `\`${key}\``,
        value: 'slot empty',
        note: 'not a transparent proxy of the EIP-1967 shape, so there is no implementation to compare',
      })
      continue
    }
    if (!recorded) {
      implementations.push({
        name: `\`${key}\``,
        value: `\`${implementation}\``,
        note: `the ${pinnedVersion} deployment record has no \`implementation\` field to compare against`,
      })
      continue
    }
    const matches = isAddressEqual(implementation, recorded)
    implementations.push({
      name: `\`${key}\``,
      value: `\`${implementation}\``,
      note: matches
        ? `matches the ${pinnedVersion} record`
        : `**MISMATCH, the ${pinnedVersion} record says \`${recorded}\`**`,
    })
    if (!matches) {
      implementationMismatches.push(
        `${key}: live \`${implementation}\`, ${pinnedVersion} record \`${recorded}\``,
      )
    }
  }

  const feeExempt = await collectFeeExempt(client, spec, blockNumber)

  return {
    spec,
    blockNumber,
    constants,
    constantDivergences,
    wiring,
    wiringFailures,
    code,
    implementations,
    implementationMismatches,
    feeExempt,
  }
}

function renderTable(rows: Row[]): string {
  const lines = ['| Value | Read at the pinned block | Note |', '|---|---|---|']
  for (const row of rows) lines.push(`| ${row.name} | ${row.value} | ${row.note ?? ''} |`)
  return lines.join('\n')
}

function renderChain(facts: ChainFacts): string {
  const { spec, feeExempt } = facts
  const out: string[] = []
  out.push(`### ${spec.label} (chain id ${spec.chainId})`)
  out.push('')
  out.push(`Read at block **${facts.blockNumber}**. Every value below is governable unless it`)
  out.push('is marked as a contract constant, so it is a fact about that block and not a')
  out.push('permanent property of the protocol.')
  out.push('')
  out.push(`Contracts package pinned by this repository: \`${pinnedContractsVersion()}\`.`)
  out.push('')
  out.push('#### Governable values and constants')
  out.push('')
  out.push(renderTable(facts.constants))
  out.push('')
  if (facts.constantDivergences.length > 0) {
    out.push('**Bundled constants diverge from chain:**')
    out.push('')
    for (const line of facts.constantDivergences) out.push(`- ${line}`)
    out.push('')
  } else {
    out.push('Every SDK bundled constant compared here matches its on chain value.')
    out.push('')
  }
  out.push('#### Cross wiring')
  out.push('')
  out.push(renderTable(facts.wiring))
  out.push('')
  if (facts.wiringFailures.length > 0) {
    out.push('**Cross wiring assertions that did not hold:**')
    out.push('')
    for (const line of facts.wiringFailures) out.push(`- ${line}`)
    out.push('')
  } else {
    out.push('Every pointer that exists resolves to the bundled address.')
    out.push('')
  }
  out.push('#### Code and proxy implementations')
  out.push('')
  out.push(renderTable(facts.code))
  out.push('')
  out.push(renderTable(facts.implementations))
  out.push('')
  if (facts.implementationMismatches.length > 0) {
    out.push('**Live implementations that differ from the pinned package record:**')
    out.push('')
    for (const line of facts.implementationMismatches) out.push(`- ${line}`)
    out.push('')
  } else {
    out.push('Every implementation found matches the pinned package deployment record.')
    out.push('')
  }
  out.push('#### Fee exemption (MK-018)')
  out.push('')
  out.push(`\`GovernableVariables\` at \`${feeExempt.governableVariables}\`.`)
  out.push(
    `Events read from the deployed ABI: \`${feeExempt.addedEventName}\`, ` +
      `\`${feeExempt.removedEventName}\`. Getter: \`${feeExempt.getterName}\`.`,
  )
  out.push('')
  if (feeExempt.inconclusive) {
    out.push(`**Inconclusive.** ${feeExempt.inconclusive}`)
    out.push('')
    out.push('No claim is made about the fee exempt set at this block.')
  } else {
    out.push(
      `Range scanned: blocks **${feeExempt.fromBlock} to ${feeExempt.toBlock}**, the whole chain up to the pin, in ${feeExempt.chunkCount} chunks of ${feeExempt.chunkSize}. Genesis to the pinned block, so the scan cannot have missed an earlier grant.`,
    )
    out.push('')
    out.push(
      `Events found: ${feeExempt.added} add, ${feeExempt.removed} remove. Every address ever added was then re-checked with \`${feeExempt.getterName}\` at the pinned block, so a removal is confirmed by the contract rather than inferred from event pairing.`,
    )
    out.push('')
    if (feeExempt.exempt.length === 0) {
      out.push(
        `**The fee exempt set is empty at this block.** No address is fee exempt on this chain as of block ${feeExempt.toBlock}.`,
      )
    } else {
      out.push(`**The fee exempt set is NOT empty: ${feeExempt.exempt.length} account(s).**`)
      out.push('')
      out.push(
        `${feeExempt.seenButNotExempt.length} further account(s) were granted exemption at some point and are not exempt at the pin, so the mechanism is actively administered rather than merely deployed.`,
      )
    }
    const traits = feeExempt.characterization
    if (traits && feeExempt.exempt.length > 0) {
      out.push('')
      out.push(
        `**What kind of accounts these are.** Of the ${feeExempt.exempt.length} exempt at this block, ${traits.exemptWithCode} have non empty code and ${traits.exemptWithoutCode} have none, and ${traits.exemptMatchingKnownContract} match an address known to the protocol, checked against ${traits.knownAddressCount} addresses drawn from every deployment record in the pinned contracts package, proxies and implementations alike, plus every address the SDK bundles. Across all ${traits.grantedWithCode + traits.grantedWithoutCode} accounts ever granted: ${traits.grantedWithCode} with code, ${traits.grantedWithoutCode} without, ${traits.grantedMatchingKnownContract} matching a known protocol address. Unmatched means only that: it is not evidence of who owns an account, and nothing here infers ownership.`,
      )
    }
    // Editorial: the count, the range and the characterization are published; the individual
    // addresses are not. They are public chain data and `pnpm facts` reproduces them on demand,
    // so withholding them costs a reader nothing they cannot recompute. Printing them would
    // attach a durable, indexed "fee exempt" label to specific accounts in a public register,
    // which adds no evidentiary weight to the severity argument that the count already carries.
    // Only meaningful when there is a set to redact. On a chain with no exempt accounts this
    // paragraph would be answering a question nobody asked.
    if (feeExempt.exempt.length > 0 || feeExempt.seenButNotExempt.length > 0) {
      out.push('')
      out.push(
        'The individual addresses are deliberately not listed here. The count, the scanned range ' +
          'and the characterization above are what the severity rests on, and anyone can reproduce ' +
          'the addresses themselves by running `pnpm facts` against the same pinned block.',
      )
    }
  }
  return out.join('\n')
}

function renderMissing(spec: ChainSpec, reason: string): string {
  return [
    `### ${spec.label} (chain id ${spec.chainId})`,
    '',
    `**Not recorded.** ${reason}`,
    '',
    'No values are shown for this chain rather than a partial table, because a partial table',
    `reads as complete. Set \`${spec.rpcEnvVar}\` and re-run \`pnpm facts\` to fill it in.`,
  ].join('\n')
}

async function main(): Promise<void> {
  await assertImplementationSlot()

  const sections: string[] = []
  for (const spec of CHAINS) {
    const rpcUrl = process.env[spec.rpcEnvVar]
    if (!rpcUrl) {
      sections.push(renderMissing(spec, `\`${spec.rpcEnvVar}\` is not set.`))
      continue
    }
    try {
      sections.push(renderChain(await collectChain(spec, rpcUrl)))
    } catch (error) {
      // Never echo the endpoint: it can carry an API key.
      sections.push(renderMissing(spec, `the endpoint could not be read: ${shortError(error)}`))
    }
  }

  const body = [
    'Generated by `scripts/onchain-facts.ts` (`pnpm facts`). Do not edit by hand.',
    '',
    'Every value carries the chain id and the block it was read at, because every one of them',
    'is governable and can change without notice. A value without a block number is a memory,',
    'not a fact. Regenerate before any release.',
    '',
    sections.join('\n\n'),
  ].join('\n')

  if (process.argv.includes('--stdout')) {
    process.stdout.write(`${body}\n`)
    return
  }

  const docPath = join(ROOT, 'docs/09-review-and-validated-surface.md')
  const doc = readFileSync(docPath, 'utf8')
  const begin = '<!-- BEGIN ONCHAIN FACTS: generated, do not edit by hand -->'
  const end = '<!-- END ONCHAIN FACTS -->'
  const beginIndex = doc.indexOf(begin)
  const endIndex = doc.indexOf(end)
  if (beginIndex === -1 || endIndex === -1 || endIndex < beginIndex) {
    throw new Error(`markers not found in ${docPath}; refusing to write`)
  }
  const next = `${doc.slice(0, beginIndex + begin.length)}\n\n${body}\n\n${doc.slice(endIndex)}`
  writeFileSync(docPath, next)
  process.stdout.write(`wrote on-chain facts into ${docPath}\n`)
}

main().catch((error) => {
  process.stderr.write(`${shortError(error)}\n`)
  process.exit(1)
})
