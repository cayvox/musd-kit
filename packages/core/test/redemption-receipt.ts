import { type TransactionReceipt, encodeAbiParameters, encodeEventTopics } from 'viem'
import { troveManagerAbi } from '../src'

/**
 * A mined redemption receipt for the chain free tests (MK-241), built from the real event ABI so the
 * log decodes the way `settledRedemptionFrom` decodes a chain receipt.
 *
 * `collateralDrawn` is what the contract passes in the `_collateralSent` position
 * (`TroveManager.sol:420-425`), fee included.
 */
export function redemptionReceipt(p: {
  troveManager: `0x${string}`
  attempted: bigint
  actual: bigint
  collateralDrawn: bigint
  collateralFee: bigint
  status?: 'success' | 'reverted'
  /** Emit the event from this address instead, to model a log that is not the Trove manager's. */
  emitter?: `0x${string}`
  /** Leave the Redemption log out entirely. */
  noEvent?: boolean
}): TransactionReceipt {
  const topics = encodeEventTopics({ abi: troveManagerAbi, eventName: 'Redemption' })
  const data = encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
    [p.attempted, p.actual, p.collateralDrawn, p.collateralFee],
  )
  const logs = p.noEvent
    ? []
    : [
        {
          address: p.emitter ?? p.troveManager,
          topics,
          data,
          blockNumber: 7n,
          blockHash: `0x${'11'.repeat(32)}`,
          logIndex: 0,
          transactionHash: `0x${'22'.repeat(32)}`,
          transactionIndex: 0,
          removed: false,
        },
      ]
  return {
    status: p.status ?? 'success',
    logs,
    blockNumber: 7n,
    transactionHash: `0x${'22'.repeat(32)}`,
  } as unknown as TransactionReceipt
}
