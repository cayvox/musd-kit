// RAW TEST HELPER, NOT the SDK API. Exists only to create real Trove positions on
// the fork so the Phase-2 read tests have something to read. The SDK's `openTrove`
// (with the hint ritual absorbed) is Phase 5; this also de-risks Phases 3/5 by
// exercising the raw hint dance against the real contracts.
import { http, type Address, type Hex, type PrivateKeyAccount, createWalletClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { MUSD_GAS_COMPENSATION, borrowerOperationsAbi, computeHints, getAddresses } from '../../src'
import { mezoTestnet } from './constants'
import type { ForkConnection } from './index'
import { recordMitigation } from './mitigationLog'

const TESTNET = getAddresses(31611)

/**
 * The fixed gas cap this helper sends opens with, instead of the simulate's estimate
 * (MK-016). Named rather than inline so the mitigation log can report the headroom against
 * it, which is the number that says whether the cap is doing anything.
 */
const FIXED_OPEN_GAS = 6_000_000n

/** Deterministic, distinct test accounts (one Trove per address). */
export function testAccount(index: number): PrivateKeyAccount {
  const key = `0x${(index + 1).toString(16).padStart(64, '0')}` as Hex
  return privateKeyToAccount(key)
}

export interface OpenTroveRawParams {
  collateralBtc: bigint
  /** The requested draw (the borrower receives this; owes draw + fee + 200). */
  debtMusd: bigint
  account: PrivateKeyAccount
  /** Override the hint trial count; omit to use the size-scaled default. */
  numTrials?: number
  seed?: bigint
  /** Bypass `computeHints` and use these exact hints (for the gas-comparison gate). */
  hintsOverride?: { upperHint: Address; lowerHint: Address }
}

export interface OpenTroveRawResult {
  owner: Address
  txHash: Hex
  gasUsed: bigint
  /** The composite/entire debt the trove was opened with (draw + fee + 200). */
  entireDebt: bigint
}

/**
 * Fund `account`, run the raw insertion-hint ritual (getApproxHint →
 * findInsertPosition), and call `BorrowerOperations.openTrove`. Real contracts on
 * the fork, no mocks.
 */
export async function openTroveRaw(
  fork: ForkConnection,
  { collateralBtc, debtMusd, account, numTrials, seed = 42n, hintsOverride }: OpenTroveRawParams,
): Promise<OpenTroveRawResult> {
  const { publicClient } = fork
  const wallet = createWalletClient({ account, chain: mezoTestnet, transport: http(fork.rpcUrl) })

  // Fund the account with collateral + a generous BTC gas buffer.
  await fork.fundAccount(account.address, collateralBtc + 5n * 10n ** 18n)

  // Composite (entire) debt the contract will insert by: draw + borrowingFee + 200.
  const fee = await publicClient.readContract({
    address: TESTNET.borrowerOperations,
    abi: borrowerOperationsAbi,
    functionName: 'getBorrowingFee',
    args: [debtMusd],
  })
  const compositeDebt = debtMusd + fee + MUSD_GAS_COMPENSATION

  // Dogfood the SDK's insertion-hint module (Phase 3) instead of hand-writing the ritual.
  const { upperHint, lowerHint } =
    hintsOverride ??
    (await computeHints(
      { publicClient, addresses: TESTNET },
      {
        collateral: collateralBtc,
        entireDebt: compositeDebt,
        randomSeed: seed,
        ...(numTrials !== undefined ? { numTrials } : {}),
      },
    ))

  // Refresh the oracle RIGHT BEFORE the tx, the hint ritual above can take many
  // seconds on a fork (lazy state loading), and openTrove reverts on a stale price.
  await fork.refreshOracle()

  // Simulate first so any revert surfaces with its reason (a reverted tx otherwise
  // produces a receipt with status:'reverted' and no throw).
  await publicClient.simulateContract({
    account,
    address: TESTNET.borrowerOperations,
    abi: borrowerOperationsAbi,
    functionName: 'openTrove',
    args: [debtMusd, upperHint, lowerHint],
    value: collateralBtc,
  })
  // Refresh AGAIN right before sending. anvil stamps each block with wall-clock time,
  // and the staleness window is measured to the block where the tx actually MINES, not
  // where it simulated. The (slow, cold-fork) simulateContract above can open a gap large
  // enough to trip "oracle is stale" on a loaded CI runner even though the simulate
  // passed. This second bump closes that gap to ~one block. (Verified flake fix: phase3.)
  await fork.refreshOracle()
  // Send with a generous FIXED gas limit rather than the simulate's estimate. The estimate
  // is taken one block before the tx mines; one block of accrued interest shifts the
  // SortedTroves insert traversal, so on a loaded CI runner the real insert can need more
  // gas than estimated and the tx reverts out-of-gas (re-simulating with a high cap then
  // "passes", the tell-tale of OOG, not a logic revert). A fixed 6M cap removes the
  // estimate-vs-execute mismatch; openTrove inserts cost well under this. (Flake fix: phase3.)
  const txHash = await wallet.writeContract({
    account,
    chain: mezoTestnet,
    address: TESTNET.borrowerOperations,
    abi: borrowerOperationsAbi,
    functionName: 'openTrove',
    args: [debtMusd, upperHint, lowerHint],
    value: collateralBtc,
    gas: FIXED_OPEN_GAS,
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
  // MK-016. The fixed cap is a mitigation and it never reported anything, so nobody knew
  // whether it was saving opens or simply sitting there. `headroom` is what settles it: the
  // cap minus what the transaction actually used. A headroom that never gets small means the
  // cap is not the thing keeping these opens alive.
  recordMitigation({
    name: 'openTroveRawFixedGas',
    attempts: 1,
    outcome: receipt.status === 'success' ? 'ok' : 'exhausted',
    extra: {
      gasUsed: receipt.gasUsed,
      cap: FIXED_OPEN_GAS,
      headroom: FIXED_OPEN_GAS - receipt.gasUsed,
    },
  })
  if (receipt.status !== 'success') {
    // Reverted AFTER a passing simulate (shared-fork state drift). Re-simulate at the
    // post-mine state to surface the on-chain reason instead of an opaque "reverted".
    let reason = 'reason unavailable (state changed since revert)'
    try {
      await publicClient.simulateContract({
        account,
        address: TESTNET.borrowerOperations,
        abi: borrowerOperationsAbi,
        functionName: 'openTrove',
        args: [debtMusd, upperHint, lowerHint],
        value: collateralBtc,
      })
    } catch (e) {
      reason = (e as { shortMessage?: string }).shortMessage ?? String(e)
    }
    throw new Error(`openTrove tx reverted for ${account.address}: ${reason}`)
  }

  return { owner: account.address, txHash, gasUsed: receipt.gasUsed, entireDebt: compositeDebt }
}
