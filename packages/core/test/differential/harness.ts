import { http, type Address, type PrivateKeyAccount, createWalletClient } from 'viem'
import { type MusdClient, createMusdClient } from '../../src'
import type { ForkConnection } from '../harness'
import { mezoTestnet } from '../harness/constants'
import { explainTransaction } from '../harness/explainReceipt'
import { testAccount } from '../harness/openTroveRaw'
import { type DiffCase, describeCase } from './generate'

/**
 * The two directions a preview can be wrong, reported separately because they are not equally
 * bad and collapsing them hides which one you have.
 *
 * `FALSE_VIABLE` reaches a user as a failed transaction: the SDK said go, the chain refused,
 * and gas is spent. `FALSE_BLOCKED` costs a user access to their own position silently: the
 * SDK said no, the chain would have said yes, and nothing anywhere records that it happened.
 * The second is the harder one to find by any other means, which is most of why this exists.
 */
export type MismatchDirection = 'FALSE_VIABLE' | 'FALSE_BLOCKED' | 'NUMBERS'

export interface CaseResult {
  case: DiffCase
  /** What the preview said. */
  previewViable: boolean
  /** What the chain did. */
  chainSucceeded: boolean
  /** Set when the two disagree, or when a predicted number missed. */
  mismatch?: { direction: MismatchDirection; detail: string }
  /** Set when the case could not be run at all, which is not a mismatch. */
  skipped?: string
  /** Set when the case threw where nothing should throw. Counted, never fatal. */
  threw?: string
}

export function clientFor(fork: ForkConnection, account: PrivateKeyAccount): MusdClient {
  return createMusdClient({
    chainId: 31611,
    publicClient: fork.publicClient,
    walletClient: createWalletClient({
      account,
      chain: mezoTestnet,
      transport: http(fork.rpcUrl),
    }),
  })
}

const MUSD = 10n ** 18n

/**
 * Run one generated case: preview, attempt, compare.
 *
 * **The whole case runs inside an `evm_snapshot`.** Cases must not see each other, or a
 * failure is a function of everything before it and the seed stops reproducing it. That is
 * MK-016's disease, and a harness that generates a thousand mutations of shared state would be
 * the worst possible carrier of it.
 *
 * The comparison is deliberately verdict against OUTCOME rather than formula against formula.
 * The formula level cross checks against the contract's own `pure` helpers already exist and
 * are green (`docs/09` §3), and they are the checks that could not have caught MK-004, MK-005
 * or MK-006, because all three were preview verdicts that disagreed with the chain while every
 * formula agreed.
 */
export async function runCase(fork: ForkConnection, c: DiffCase): Promise<CaseResult> {
  const snapshotId = await fork.testClient.snapshot()
  try {
    return await runCaseInner(fork, c)
  } catch (error) {
    // A case that throws is RECORDED, never fatal. The first sweep of a thousand died on case
    // N when `previewRefinance` propagated a chain `Panic(0x11)`, and twelve minutes of work
    // went with it. A harness whose whole value is a large sample cannot let one sample end
    // the run, and a thrown case is itself a result worth counting (MK-037).
    const e = error as Error
    return {
      case: c,
      previewViable: false,
      chainSucceeded: false,
      threw: `${e.name}: ${e.message.split('\n')[0]}`,
    }
  } finally {
    await fork.testClient.revert({ id: snapshotId })
  }
}

async function runCaseInner(fork: ForkConnection, c: DiffCase): Promise<CaseResult> {
  // A distinct account per case index so a case never inherits a position from another.
  const account = testAccount(500_000 + c.index)
  await fork.fundAccount(account.address, 10_000n * 10n ** 18n)
  const client = clientFor(fork, account)

  const basePrice = await client.getOraclePrice()
  if (c.pricePercent !== 100) {
    await fork.setPrice((basePrice * BigInt(c.pricePercent)) / 100n)
  }
  if (c.elapsedSeconds > 0) await fork.warpTime(c.elapsedSeconds)
  await fork.mineBlocks(1)

  if (c.op === 'open') return await openCase(fork, client, account, c)
  // `borrow` and `refinance` need a position first. Opening one is a fixture step, not the
  // case: if it fails, the case is skipped rather than counted as a mismatch, because the
  // thing under test never ran.
  const seeded = await seedPosition(client, c)
  if (seeded !== undefined)
    return { case: c, previewViable: false, chainSucceeded: false, skipped: seeded }
  return c.op === 'borrow'
    ? await borrowCase(fork, client, account, c)
    : await refinanceCase(fork, client, account, c)
}

/** Open a modest, always-viable position so borrow and refinance have something to act on. */
async function seedPosition(client: MusdClient, c: DiffCase): Promise<string | undefined> {
  try {
    const collateral = c.collateral > 10n ** 17n ? c.collateral : 10n ** 17n
    const preview = await client.previewOpen({ collateral, debt: 5_000n * MUSD })
    if (!preview.viable) return `fixture: seed open not viable (${preview.reasons.join(',')})`
    await client.openTrove({ collateral, debt: 5_000n * MUSD })
    return undefined
  } catch (error) {
    return `fixture: seed open threw ${(error as Error).name}`
  }
}

async function openCase(
  fork: ForkConnection,
  client: MusdClient,
  account: PrivateKeyAccount,
  c: DiffCase,
): Promise<CaseResult> {
  const preview = await client.previewOpen({
    collateral: c.collateral,
    debt: c.debt,
    account: account.address,
  })
  const attempt = await attemptWrite(fork, () =>
    client.openTrove({ collateral: c.collateral, debt: c.debt }),
  )

  const mismatch = compare(preview.viable, attempt, `reasons=[${preview.reasons.join(',')}]`)
  if (mismatch)
    return { case: c, previewViable: preview.viable, chainSucceeded: attempt.ok, mismatch }

  // Numbers, only when both agree it went through: the preview's entire debt must be what the
  // chain actually recorded. This is the half a verdict check alone would miss.
  if (attempt.ok) {
    const trove = await client.getTrove(account.address)
    if (trove.entireDebt !== preview.entireDebt) {
      return {
        case: c,
        previewViable: true,
        chainSucceeded: true,
        mismatch: {
          direction: 'NUMBERS',
          detail: `previewOpen.entireDebt=${preview.entireDebt} but the chain recorded ${trove.entireDebt}`,
        },
      }
    }
  }
  return { case: c, previewViable: preview.viable, chainSucceeded: attempt.ok }
}

async function borrowCase(
  fork: ForkConnection,
  client: MusdClient,
  account: PrivateKeyAccount,
  c: DiffCase,
): Promise<CaseResult> {
  const amount = c.debt > 0n ? c.debt : 1n
  const preview = await client.previewBorrow({ owner: account.address, amount })
  const attempt = await attemptWrite(fork, () => client.borrow({ amount }))
  const mismatch = compare(preview.viable, attempt, `reasons=[${preview.reasons.join(',')}]`)
  return {
    case: c,
    previewViable: preview.viable,
    chainSucceeded: attempt.ok,
    ...(mismatch ? { mismatch } : {}),
  }
}

async function refinanceCase(
  fork: ForkConnection,
  client: MusdClient,
  account: PrivateKeyAccount,
  c: DiffCase,
): Promise<CaseResult> {
  const preview = await client.previewRefinance(account.address)
  const attempt = await attemptWrite(fork, () => client.refinance())
  const mismatch = compare(preview.viable, attempt, `reasons=[${preview.reasons.join(',')}]`)
  return {
    case: c,
    previewViable: preview.viable,
    chainSucceeded: attempt.ok,
    ...(mismatch ? { mismatch } : {}),
  }
}

interface Attempt {
  ok: boolean
  /** Why it did not go through: a thrown typed error, or a reverted receipt with its report. */
  why: string
}

/**
 * Attempt the write and report the outcome. A throw before sending and a reverted receipt are
 * both "the chain refused"; they differ only in where the refusal surfaced, and the report says
 * which. The receipt explainer from MK-031 is reused rather than reimplemented, so a mismatch
 * arrives with the trace already attached.
 */
async function attemptWrite(
  fork: ForkConnection,
  send: () => Promise<{ hash: Address }>,
): Promise<Attempt> {
  let hash: Address
  try {
    ;({ hash } = await send())
  } catch (error) {
    const e = error as Error
    return { ok: false, why: `threw before sending: ${e.name}: ${e.message.split('\n')[0]}` }
  }
  const receipt = await fork.publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status === 'success') return { ok: true, why: 'mined' }
  return {
    ok: false,
    why: `mined but REVERTED\n${await explainTransaction(fork.publicClient, hash, 'a successful receipt')}`,
  }
}

function compare(
  previewViable: boolean,
  attempt: Attempt,
  context: string,
): { direction: MismatchDirection; detail: string } | undefined {
  if (previewViable && !attempt.ok) {
    return {
      direction: 'FALSE_VIABLE',
      detail: `the preview said VIABLE and the chain refused. ${context}. ${attempt.why}`,
    }
  }
  if (!previewViable && attempt.ok) {
    return {
      direction: 'FALSE_BLOCKED',
      detail: `the preview said NOT VIABLE and the chain accepted it. ${context}`,
    }
  }
  return undefined
}

/** The full failure report for one case: tuple, seed, verdict, outcome, fork conditions. */
export function reportFailure(result: CaseResult): string {
  return [
    `DIFFERENTIAL MISMATCH [${result.mismatch?.direction}]`,
    `  ${describeCase(result.case)}`,
    `  replay with: MK_DIFF_SEED=${result.case.seed} MK_DIFF_CASE=${result.case.index}`,
    `  preview.viable=${result.previewViable}  chainSucceeded=${result.chainSucceeded}`,
    `  ${result.mismatch?.detail ?? ''}`,
  ].join('\n')
}
