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
    // A case that throws is RECORDED, never fatal. The first sweep of a thousand died when
    // `previewRefinance` propagated a chain `Panic(0x11)`, and twelve minutes of work went
    // with it. A harness whose whole value is a large sample cannot let one sample end the
    // run. That particular throw turned out to be this file's own seeding bug, fixed below,
    // and the full sweep threw nothing afterwards; the catch stays because the next one might
    // be real.
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

  // MK-047. The account state is now part of the case, so a status gate can be reached at all.
  // `open` against OCCUPIED and everything else against FRESH are the two states no generated
  // case could construct before, and the first of them is where MK-047 lived.
  if (c.op === 'open') {
    if (c.precondition === 'OCCUPIED') {
      const seeded = await seedPosition(fork, client, c)
      if (seeded !== undefined)
        return { case: c, previewViable: false, chainSucceeded: false, skipped: seeded }
    }
    return await openCase(fork, client, account, c)
  }
  // Every other op is previewed against a position. Opening one is a fixture step, not the
  // case: if it fails, the case is skipped rather than counted as a mismatch, because the
  // thing under test never ran. A FRESH case deliberately skips the seeding, so the preview is
  // asked about an owner with no Trove and the TROVE_NOT_ACTIVE gate is exercised.
  // A redeem case ALWAYS seeds, whatever the precondition: the redeemer needs MUSD, and the only
  // way to hold MUSD is to have opened a position. The precondition dimension is about the
  // account's Trove, and redemption does not care about the redeemer's own Trove.
  if (c.precondition === 'OCCUPIED' || c.op === 'redeem') {
    const seeded = await seedPosition(fork, client, c)
    if (seeded !== undefined)
      return { case: c, previewViable: false, chainSucceeded: false, skipped: seeded }
  }
  switch (c.op) {
    case 'borrow':
      return await borrowCase(fork, client, account, c)
    case 'refinance':
      return await refinanceCase(fork, client, account, c)
    // MK-042. The five that had no preview to compare against until this wave.
    case 'addCollateral':
      return await adjustCase(fork, client, account, c, { addCollateral: adjustCollateral(c) })
    case 'repay':
      return await adjustCase(fork, client, account, c, { repayDebt: adjustDebt(c) })
    case 'withdrawCollateral':
      return await adjustCase(fork, client, account, c, {
        withdrawCollateral: adjustCollateral(c),
      })
    case 'adjust':
      return await adjustCase(fork, client, account, c, {
        addCollateral: adjustCollateral(c),
        increaseDebt: adjustDebt(c),
      })
    case 'redeem':
      return await redeemCase(fork, client, account, c)
    default:
      return await closeCase(fork, client, account, c)
  }
}

/**
 * One redemption case (MK-048).
 *
 * The amount is computed from the REAL first eligible Trove's headroom at run time, not from a
 * seeded fixture, because a redemption targets the lowest ICR Trove system wide and a fixture
 * cannot reliably be that one. That makes the case a test of the preview against whatever the
 * chain actually holds, which is the only way the gap gets exercised at all.
 *
 * The preview is the thing under test, so the amount comes from ITS reported edges. If the
 * preview's `maxWithoutConsuming` and `nextViableAmount` are wrong, the bands land in the wrong
 * places and the comparison against the chain catches it.
 */
async function redeemCase(
  fork: ForkConnection,
  client: MusdClient,
  account: PrivateKeyAccount,
  c: DiffCase,
): Promise<CaseResult> {
  // A probe preview at one wei tells us where the edges are without committing to an amount.
  const probe = await client.previewRedeem({ redeemer: account.address, amount: 1n })
  if (probe.firstEligibleTrove === null) {
    return { case: c, previewViable: false, chainSucceeded: false, skipped: 'no eligible Trove' }
  }
  const headroom = probe.maxWithoutConsuming
  const whole = probe.nextViableAmount
  const amount =
    c.redeemBand === 'WITHIN_HEADROOM'
      ? headroom / 2n
      : c.redeemBand === 'AT_HEADROOM'
        ? headroom
        : c.redeemBand === 'IN_THE_GAP'
          ? headroom + 1n
          : c.redeemBand === 'AT_NET_DEBT'
            ? probe.firstTroveNetDebt
            : whole
  if (amount <= 0n) {
    return {
      case: c,
      previewViable: false,
      chainSucceeded: false,
      skipped: 'band resolves to zero',
    }
  }
  const balance = await client.balanceOf(account.address)
  if (balance < amount) {
    return {
      case: c,
      previewViable: false,
      chainSucceeded: false,
      skipped: `fixture: holds ${balance}, band needs ${amount}`,
    }
  }

  const preview = await client.previewRedeem({ redeemer: account.address, amount })
  const attempt = await attemptWrite(fork, () => client.redeem({ amount }))
  const mismatch = compare(
    preview.viable,
    attempt,
    `band=${c.redeemBand} amount=${amount} headroom=${headroom} netDebt=${probe.firstTroveNetDebt} whole=${whole} margin=${probe.accrualMargin} reasons=[${preview.reasons.join(',')}]`,
  )
  return {
    case: c,
    previewViable: preview.viable,
    chainSucceeded: attempt.ok,
    ...(mismatch ? { mismatch } : {}),
  }
}

/**
 * The collateral leg for an adjust style case, derived from the generated tuple.
 *
 * The generator sizes `collateral` for an OPEN, which is the whole position. An adjustment is
 * a delta against a seeded position, so using it unscaled would put every case far outside
 * the band the generator was aiming at. A fraction keeps the boundary weighting meaningful:
 * a withdrawal near the ICR cap is a boundary case, a withdrawal of ten times the balance is
 * just an arithmetic check, and the extreme band already covers those.
 */
function adjustCollateral(c: DiffCase): bigint {
  return c.collateral / 4n
}

/** The debt leg for an adjust style case, on the same reasoning as {@link adjustCollateral}. */
function adjustDebt(c: DiffCase): bigint {
  return c.debt / 4n
}

/**
 * One adjust style case: preview the exact legs, attempt the exact same legs, compare.
 *
 * Routed through `adjustTrove` for every shape rather than through the single leg helpers,
 * so the preview under test and the write under test take the same path through the contract
 * and a mismatch cannot be an artefact of the SDK picking a different entry point.
 */
async function adjustCase(
  fork: ForkConnection,
  client: MusdClient,
  account: PrivateKeyAccount,
  c: DiffCase,
  legs: {
    addCollateral?: bigint
    withdrawCollateral?: bigint
    increaseDebt?: bigint
    repayDebt?: bigint
  },
): Promise<CaseResult> {
  const preview = await client.previewAdjustTrove({ owner: account.address, ...legs })
  const attempt = await attemptWrite(fork, () =>
    client.adjustTrove({
      ...(legs.addCollateral !== undefined && legs.addCollateral > 0n
        ? { addCollateral: legs.addCollateral }
        : {}),
      ...(legs.withdrawCollateral !== undefined && legs.withdrawCollateral > 0n
        ? { withdrawCollateral: legs.withdrawCollateral }
        : {}),
      ...(legs.increaseDebt !== undefined && legs.increaseDebt > 0n
        ? { borrow: legs.increaseDebt }
        : {}),
      ...(legs.repayDebt !== undefined && legs.repayDebt > 0n ? { repay: legs.repayDebt } : {}),
    }),
  )
  const mismatch = compare(preview.viable, attempt, `reasons=[${preview.reasons.join(',')}]`)
  return {
    case: c,
    previewViable: preview.viable,
    chainSucceeded: attempt.ok,
    ...(mismatch ? { mismatch } : {}),
  }
}

/** One close case. Close has its own gate set, so it has its own preview and its own case. */
async function closeCase(
  fork: ForkConnection,
  client: MusdClient,
  account: PrivateKeyAccount,
  c: DiffCase,
): Promise<CaseResult> {
  const preview = await client.previewClose(account.address)
  const attempt = await attemptWrite(fork, () => client.close())
  const mismatch = compare(preview.viable, attempt, `reasons=[${preview.reasons.join(',')}]`)
  return {
    case: c,
    previewViable: preview.viable,
    chainSucceeded: attempt.ok,
    ...(mismatch ? { mismatch } : {}),
  }
}

/** Open a modest, always-viable position so borrow and refinance have something to act on. */
async function seedPosition(
  fork: ForkConnection,
  client: MusdClient,
  c: DiffCase,
): Promise<string | undefined> {
  try {
    const collateral = c.collateral > 10n ** 17n ? c.collateral : 10n ** 17n
    const preview = await client.previewOpen({ collateral, debt: 5_000n * MUSD })
    if (!preview.viable) return `fixture: seed open not viable (${preview.reasons.join(',')})`
    const { hash } = await client.openTrove({ collateral, debt: 5_000n * MUSD })
    // AWAIT THE RECEIPT. The SDK returns `{ hash }` without waiting, by design, and the first
    // sweep to get this far reported two FALSE_BLOCKED mismatches that were entirely this bug:
    // the preview ran before the seed open had mined, reported TROVE_NOT_ACTIVE, and the write
    // then succeeded because by then it had. Registering those as SDK findings would have been
    // inventing two defects out of a harness mistake.
    const receipt = await fork.publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') return 'fixture: seed open mined but reverted'
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
  // `account` is passed so the preview can evaluate the fee exemption AND, since MK-047, the
  // TROVE_ALREADY_ACTIVE gate. Without it the preview is asked a question it cannot answer.
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
