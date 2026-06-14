// RAW TEST HELPER — NOT the SDK API. Exists only to create real Trove positions on
// the fork so the Phase-2 read tests have something to read. The SDK's `openTrove`
// (with the hint ritual absorbed) is Phase 5; this also de-risks Phases 3/5 by
// exercising the raw hint dance against the real contracts.
import { http, type Address, type Hex, type PrivateKeyAccount, createWalletClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  MUSD_GAS_COMPENSATION,
  borrowerOperationsAbi,
  getAddresses,
  hintHelpersAbi,
  sortedTrovesAbi,
} from '../../src'
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
  numTrials?: bigint
  seed?: bigint
}

export interface OpenTroveRawResult {
  owner: Address
  txHash: Hex
}

/**
 * Fund `account`, run the raw insertion-hint ritual (getApproxHint →
 * findInsertPosition), and call `BorrowerOperations.openTrove`. Real contracts on
 * the fork (Law 5) — no mocks.
 */
export async function openTroveRaw(
  fork: ForkConnection,
  { collateralBtc, debtMusd, account, numTrials = 15n, seed = 42n }: OpenTroveRawParams,
): Promise<OpenTroveRawResult> {
  const { publicClient } = fork
  const wallet = createWalletClient({ account, chain: mezoTestnet, transport: http(fork.rpcUrl) })

  // Keep the oracle fresh — openTrove reads fetchPrice and reverts if it is stale.
  await fork.refreshOracle()

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

  // NICR of the new position, then the hint ritual.
  const nicr = await publicClient.readContract({
    address: TESTNET.hintHelpers,
    abi: hintHelpersAbi,
    functionName: 'computeNominalCR',
    args: [collateralBtc, compositeDebt],
  })
  const [approxHint] = await publicClient.readContract({
    address: TESTNET.hintHelpers,
    abi: hintHelpersAbi,
    functionName: 'getApproxHint',
    args: [nicr, numTrials, seed],
  })
  const [upperHint, lowerHint] = await publicClient.readContract({
    address: TESTNET.sortedTroves,
    abi: sortedTrovesAbi,
    functionName: 'findInsertPosition',
    args: [nicr, approxHint, approxHint],
  })

  const txHash = await wallet.writeContract({
    address: TESTNET.borrowerOperations,
    abi: borrowerOperationsAbi,
    functionName: 'openTrove',
    args: [debtMusd, upperHint, lowerHint],
    value: collateralBtc,
  })
  await publicClient.waitForTransactionReceipt({ hash: txHash })

  return { owner: account.address, txHash }
}
