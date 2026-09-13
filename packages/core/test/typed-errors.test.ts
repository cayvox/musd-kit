import {
  BaseError,
  ContractFunctionRevertedError,
  HttpRequestError,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { describe, expect, it } from 'vitest'
import {
  ContractCallFailed,
  InvalidAmount,
  MusdError,
  MusdErrorCode,
  OracleStale,
  createMusdClient,
  getAddresses,
  previewOpen,
} from '../src'

/**
 * MK-105. A protocol revert raised OUTSIDE the simulate path must still reach the caller as a
 * typed `MusdError`.
 *
 * `PriceFeed.fetchPrice` reverts with `PriceFeed: Oracle is stale.` when its round is older than 60
 * seconds (`PriceFeed.sol:14`, `:51-54`). Every read, preview and write reads the price, and the
 * reads that run before a write's simulation used to let the raw viem error through. Chain free:
 * the fake client throws the same `BaseError` shape viem throws, which is what `mapRevert` walks.
 */
const ACCOUNT = { address: '0x00000000000000000000000000000000000000a1', type: 'json-rpc' } as const
const T = getAddresses(31611)

function revertError(reason: string): BaseError {
  const inner = new ContractFunctionRevertedError({
    abi: [],
    functionName: 'fetchPrice',
    message: `execution reverted: ${reason}`,
  })
  Object.assign(inner, { reason })
  const outer = new BaseError('The contract function reverted.')
  Object.assign(outer, {
    cause: inner,
    walk: (fn: (e: unknown) => boolean) => (fn(inner) ? inner : fn(outer) ? outer : null),
  })
  return outer
}

function clientThrowing(make: () => unknown) {
  const fail = async () => {
    throw make()
  }
  const publicClient = {
    readContract: fail,
    multicall: fail,
    simulateContract: fail,
    estimateContractGas: fail,
    getCode: fail,
    getBlock: fail,
  } as unknown as PublicClient
  const walletClient = { account: ACCOUNT, writeContract: fail } as unknown as WalletClient
  return createMusdClient({ chainId: 31611, publicClient, walletClient })
}

describe('MK-105, reverts outside the simulate path are typed', () => {
  const stale = () => revertError('PriceFeed: Oracle is stale.')

  it('a stale oracle reaches every entry point as OracleStale, reads, previews and a write alike', async () => {
    const musd = clientThrowing(stale)
    const owner = ACCOUNT.address
    const calls: [string, () => Promise<unknown>][] = [
      ['getTrove', () => musd.getTrove(owner)],
      ['getSystemState', () => musd.getSystemState()],
      ['isLiquidatable', () => musd.isLiquidatable(owner)],
      ['getOraclePrice', () => musd.getOraclePrice()],
      ['previewOpen', () => musd.previewOpen({ collateral: 10n ** 18n, debt: 5000n * 10n ** 18n })],
      ['previewBorrow', () => musd.previewBorrow({ owner, amount: 10n ** 18n })],
      ['previewClose', () => musd.previewClose(owner)],
      ['previewRefinance', () => musd.previewRefinance(owner)],
      ['previewRedeem', () => musd.previewRedeem({ redeemer: owner, amount: 10n ** 18n })],
      ['maxWithdrawableCollateral', () => musd.maxWithdrawableCollateral(owner)],
      ['getBorrowingPower', () => musd.getBorrowingPower({ collateral: 10n ** 18n })],
      // The write the audit used: its fee read runs before `simulateAndSend` ever starts.
      ['openTrove', () => musd.openTrove({ collateral: 10n ** 18n, debt: 5000n * 10n ** 18n })],
    ]
    for (const [name, call] of calls) {
      const error = await call().catch((e: unknown) => e)
      expect(error, `${name} must throw a MusdError`).toBeInstanceOf(MusdError)
      expect(error, `${name} must throw OracleStale specifically`).toBeInstanceOf(OracleStale)
      expect((error as MusdError).code, `${name} code`).toBe(MusdErrorCode.ORACLE_STALE)
    }
  })

  it('a standalone preview, called without the client, is typed the same way', async () => {
    const fail = async () => {
      throw stale()
    }
    const deps = {
      publicClient: { readContract: fail, multicall: fail } as unknown as PublicClient,
      addresses: T,
      getMinNetDebt: async () => 1800n * 10n ** 18n,
      isAccountFeeExempt: async () => false,
    }
    await expect(
      previewOpen(deps, { collateral: 10n ** 18n, debt: 5000n * 10n ** 18n }),
    ).rejects.toBeInstanceOf(OracleStale)
  })

  it('a transport failure is ContractCallFailed and says failed, never reverted', async () => {
    const original = new HttpRequestError({ url: 'http://127.0.0.1:1/', details: 'status 429' })
    const musd = clientThrowing(() => original)
    const error = await musd.getOraclePrice().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ContractCallFailed)
    expect((error as Error).message).toContain('getOraclePrice failed')
    expect((error as Error).message).not.toContain('reverted')
    expect((error as Error).cause).toBe(original)
  })

  it('an error that is already typed passes through, not buried in ContractCallFailed', async () => {
    const musd = clientThrowing(stale)
    await expect(musd.getBorrowingPower({ collateral: 0n })).rejects.toBeInstanceOf(InvalidAmount)
  })
})
