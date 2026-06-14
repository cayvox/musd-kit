import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import {
  http,
  type Address,
  type PublicClient,
  type TestClient,
  createPublicClient,
  createTestClient,
} from 'viem'
import { mezoTestnet } from './constants'
import { type SeededRoundData, installOracleShim, setPrice as setOraclePrice } from './oracle'

export interface StartForkOptions {
  /** Upstream Mezo RPC to fork. Defaults to `process.env.MEZO_TESTNET_RPC_URL`. */
  rpcUrl?: string
  /** Optional block to pin for determinism. Defaults to `process.env.MEZO_FORK_BLOCK`. */
  forkBlock?: bigint
}

export interface ForkHandle {
  /** Local anvil RPC URL (e.g. `http://127.0.0.1:54321`). */
  rpcUrl: string
  port: number
  /** The block the fork is anchored at. */
  forkBlockNumber: bigint
  /** The real round data seeded into the oracle shim. */
  seededPrice: SeededRoundData
  publicClient: PublicClient
  testClient: TestClient
  /** Mine `n` empty blocks. */
  mineBlocks(n: number): Promise<void>
  /** Advance the EVM clock by `seconds` and mine a block (for interest-accrual tests). */
  warpTime(seconds: number | bigint): Promise<void>
  /** Give an account BTC (gas + collateral) on the fork. */
  fundAccount(address: Address, btcWei: bigint): Promise<void>
  /** Drive the BTC/USD price (1e18-scaled) on the fork's oracle shim. */
  setPrice(usdPerBtc1e18: bigint): Promise<void>
  /** Kill anvil. Idempotent. */
  stopFork(): Promise<void>
}

const READY_TIMEOUT_MS = 60_000
const POLL_INTERVAL_MS = 250

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      if (addr && typeof addr === 'object') {
        const { port } = addr
        srv.close(() => resolve(port))
      } else {
        srv.close(() => reject(new Error('could not acquire a free port')))
      }
    })
  })
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Boot an anvil fork of Mezo, install the oracle shim (seeded with the real live
 * price), and return typed viem clients plus harness helpers.
 *
 * Throws — loudly, with anvil's own stderr — if the fork cannot start or is not
 * chainId 31611. Per Phase 0 we surface fork incompatibilities, never paper over
 * them with a mock (Law 5).
 */
export async function startFork(opts: StartForkOptions = {}): Promise<ForkHandle> {
  const upstream = opts.rpcUrl ?? process.env.MEZO_TESTNET_RPC_URL
  if (!upstream) {
    throw new Error(
      'MEZO_TESTNET_RPC_URL is not set. Provide a Mezo testnet RPC (chainId 31611); ' +
        'the harness must never hardcode one. See test/harness/README.md.',
    )
  }

  const envBlock = process.env.MEZO_FORK_BLOCK
  const forkBlock = opts.forkBlock ?? (envBlock ? BigInt(envBlock) : undefined)

  const port = await getFreePort()
  const rpcUrl = `http://127.0.0.1:${port}`

  const args = ['--fork-url', upstream, '--port', String(port), '--host', '127.0.0.1', '--silent']
  if (forkBlock !== undefined) {
    args.push('--fork-block-number', String(forkBlock))
  }

  const child: ChildProcess = spawn('anvil', args, { stdio: ['ignore', 'ignore', 'pipe'] })

  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })

  let exited = false
  let exitInfo = ''
  child.on('exit', (code, signal) => {
    exited = true
    exitInfo = `anvil exited (code=${code}, signal=${signal})`
  })

  const kill = (): Promise<void> =>
    new Promise((resolve) => {
      if (exited || child.killed) return resolve()
      child.once('exit', () => resolve())
      child.kill('SIGKILL')
    })

  // Ensure no orphan anvil if the test process dies unexpectedly.
  const onProcessExit = () => {
    if (!exited) child.kill('SIGKILL')
  }
  process.once('exit', onProcessExit)

  const publicClient = createPublicClient({ chain: mezoTestnet, transport: http(rpcUrl) })
  const testClient = createTestClient({
    chain: mezoTestnet,
    mode: 'anvil',
    transport: http(rpcUrl),
  })

  // Wait until anvil answers, or fail with its stderr.
  const deadline = Date.now() + READY_TIMEOUT_MS
  let ready = false
  let lastErr: unknown
  while (Date.now() < deadline) {
    if (exited) {
      process.removeListener('exit', onProcessExit)
      throw new Error(`Failed to start anvil. ${exitInfo}\n${stderr.trim()}`)
    }
    try {
      await publicClient.getBlockNumber({ cacheTime: 0 })
      ready = true
      break
    } catch (e) {
      lastErr = e
      await delay(POLL_INTERVAL_MS)
    }
  }
  if (!ready) {
    await kill()
    process.removeListener('exit', onProcessExit)
    throw new Error(
      `anvil did not become ready within ${READY_TIMEOUT_MS}ms.\nstderr: ${stderr.trim()}\nlast error: ${String(lastErr)}`,
    )
  }

  const chainId = await publicClient.getChainId()
  if (chainId !== mezoTestnet.id) {
    await kill()
    process.removeListener('exit', onProcessExit)
    throw new Error(`Forked chainId is ${chainId}, expected ${mezoTestnet.id} (Mezo testnet).`)
  }

  const forkBlockNumber = await publicClient.getBlockNumber({ cacheTime: 0 })
  const seededPrice = await installOracleShim(testClient, publicClient, upstream)

  let stopped = false
  const stopFork = async (): Promise<void> => {
    if (stopped) return
    stopped = true
    process.removeListener('exit', onProcessExit)
    await kill()
  }

  return {
    rpcUrl,
    port,
    forkBlockNumber,
    seededPrice,
    publicClient,
    testClient,
    mineBlocks: (n) => testClient.mine({ blocks: n }),
    warpTime: async (seconds) => {
      await testClient.increaseTime({ seconds: Number(seconds) })
      await testClient.mine({ blocks: 1 })
    },
    fundAccount: (address, btcWei) => testClient.setBalance({ address, value: btcWei }),
    setPrice: (usdPerBtc1e18) => setOraclePrice(testClient, publicClient, usdPerBtc1e18),
    stopFork,
  }
}
