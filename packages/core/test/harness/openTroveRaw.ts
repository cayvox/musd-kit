// RAW TEST HELPER — NOT the SDK API. Exists only to create real Trove positions on
// the fork so the Phase-2 read tests have something to read. The SDK's `openTrove`
// (with the hint ritual absorbed) is Phase 5; this also de-risks Phases 3/5 by
// exercising the raw hint dance against the real contracts.
import { http, type Address, type Hex, type PrivateKeyAccount, createWalletClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { MUSD_GAS_COMPENSATION, borrowerOperationsAbi, computeHints, getAddresses } from '../../src'
import { mezoTestnet } from './constants'
import type { ForkConnection } from './index'

const TESTNET = getAddresses(31611)

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
 * the fork (Law 5) — no mocks.
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

  // Refresh the oracle RIGHT BEFORE the tx — the hint ritual above can take many
  // seconds on a fork (lazy state loading), and openTrove reverts on a stale price.
  await fork.refreshOracle()

  // Simulate first so any revert surfaces with its reason (a reverted tx otherwise
  // produces a receipt with status:'reverted' and no throw).
  const { request } = await publicClient.simulateContract({
    account,
    address: TESTNET.borrowerOperations,
    abi: borrowerOperationsAbi,
    functionName: 'openTrove',
    args: [debtMusd, upperHint, lowerHint],
    value: collateralBtc,
  })
  const txHash = await wallet.writeContract(request)
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
  if (receipt.status !== 'success') {
    throw new Error(`openTrove tx reverted for ${account.address}`)
  }

  return { owner: account.address, txHash, gasUsed: receipt.gasUsed, entireDebt: compositeDebt }
}
