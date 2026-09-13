import { http, type Address, createWalletClient, parseAbi } from 'viem'
import { describe, expect, it } from 'vitest'
import { createMusdClient, interestRateManagerAbi, troveManagerAbi } from '../src'
import { connectFork } from './harness'
import { mezoTestnet } from './harness/constants'
import { testAccount } from './harness/openTroveRaw'

const MUSD = 10n ** 18n
const BTC = 10n ** 18n

/**
 * MK-101, measured: what a refinance does to the rate and to the capacity, against what the preview
 * said it would do, read from the chain after the write.
 *
 * `_refinance` sets the Trove's rate to `interestRateManager.interestRate()`, whatever it is
 * (`BorrowerOperations.sol:1069`, `:1075`), and sets `maxBorrowingCapacity` from the current price
 * unconditionally (`:1077-1084`). The audit observed both with a script it did not commit; this is
 * the instrument, as the register promised at filing.
 *
 * The global rate is governable: `proposeInterestRate` then, seven days later, `approveInterestRate`,
 * both `onlyGovernance`, which is `pcv.council()` (`InterestRateManager.sol:62-66`, `:129-153`,
 * `MIN_DELAY` at `:28`). The council is impersonated for exactly those two calls.
 *
 * `zz-` for order (MK-016): it warps seven days. Everything is inside one snapshot and reverted.
 */
describe('MK-101, a refinance moves the rate to the global one and resets capacity from the price', () => {
  it('the preview names the rate and the capacity the chain then holds, after a rise and after a fall', async () => {
    const fork = connectFork()
    const owner = testAccount(10_301)
    await fork.fundAccount(owner.address, 20n * BTC)
    const client = createMusdClient({
      chainId: 31611,
      publicClient: fork.publicClient,
      walletClient: createWalletClient({
        account: owner,
        chain: mezoTestnet,
        transport: http(fork.rpcUrl),
      }),
    })
    const tm = { address: client.addresses.troveManager, abi: troveManagerAbi } as const
    const irm = {
      address: client.addresses.interestRateManager,
      abi: interestRateManagerAbi,
    } as const
    const onChain = async () => ({
      rate: Number(
        await fork.publicClient.readContract({
          ...tm,
          functionName: 'getTroveInterestRate',
          args: [owner.address],
        }),
      ),
      capacity: await fork.publicClient.readContract({
        ...tm,
        functionName: 'getTroveMaxBorrowingCapacity',
        args: [owner.address],
      }),
    })

    const outer = await fork.testClient.snapshot()
    const rows: string[] = []
    try {
      const opened = await client.openTrove({ collateral: 1n * BTC, debt: 20_000n * MUSD })
      await fork.publicClient.waitForTransactionReceipt({ hash: opened.hash })
      const startPrice = await client.getOraclePrice()
      const globalBefore = Number(
        await fork.publicClient.readContract({ ...irm, functionName: 'interestRate' }),
      )
      const atOpen = await onChain()
      expect(atOpen.rate, 'fixture: a new Trove carries the global rate').toBe(globalBefore)

      // Governance moves the global rate up by 400 bps.
      const target = globalBefore + 400
      const record = (await import(
        '@mezo-org/musd-contracts/deployments/matsnet/PCV.json'
      )) as unknown as {
        default?: { address: Address }
        address?: Address
      }
      const pcv = (record.default?.address ?? record.address) as Address
      const council = await fork.publicClient.readContract({
        address: pcv,
        abi: parseAbi(['function council() view returns (address)']),
        functionName: 'council',
      })
      await fork.testClient.impersonateAccount({ address: council })
      await fork.fundAccount(council, 5n * BTC)
      const governance = createWalletClient({
        account: council,
        chain: mezoTestnet,
        transport: http(fork.rpcUrl),
      })
      const send = async (
        functionName: 'proposeInterestRate' | 'approveInterestRate',
        args: readonly unknown[],
      ) => {
        const hash = await governance.writeContract({
          account: council,
          chain: mezoTestnet,
          ...irm,
          functionName,
          args,
        } as never)
        const receipt = await fork.publicClient.waitForTransactionReceipt({ hash })
        expect(receipt.status, `fixture: ${functionName} as the council`).toBe('success')
      }
      await send('proposeInterestRate', [target])
      await fork.warpTime(7 * 24 * 60 * 60 + 1)
      await send('approveInterestRate', [])
      await fork.testClient.stopImpersonatingAccount({ address: council })
      expect(
        Number(await fork.publicClient.readContract({ ...irm, functionName: 'interestRate' })),
      ).toBe(target)

      // ---- a price RISE, then refinance: the rate goes UP and the capacity goes UP ----
      await fork.setPrice((startPrice * 120n) / 100n)
      const up = await client.previewRefinance(owner.address)
      const beforeUp = await onChain()
      await fork.publicClient.waitForTransactionReceipt({ hash: (await client.refinance()).hash })
      const afterUp = await onChain()
      rows.push(
        `  after a 20% rise: preview rate ${up.currentInterestRateBps} -> ${up.resultingInterestRateBps}, capacity ${up.currentCapacity} -> ${up.resultingCapacity}; chain rate ${beforeUp.rate} -> ${afterUp.rate}, capacity ${beforeUp.capacity} -> ${afterUp.capacity}`,
      )

      // ---- a price FALL, then refinance again: the capacity goes DOWN ----
      await fork.setPrice((startPrice * 90n) / 100n)
      const down = await client.previewRefinance(owner.address)
      const beforeDown = await onChain()
      await fork.publicClient.waitForTransactionReceipt({ hash: (await client.refinance()).hash })
      const afterDown = await onChain()
      rows.push(
        `  after a fall to 90%: preview rate ${down.currentInterestRateBps} -> ${down.resultingInterestRateBps}, capacity ${down.currentCapacity} -> ${down.resultingCapacity}; chain rate ${beforeDown.rate} -> ${afterDown.rate}, capacity ${beforeDown.capacity} -> ${afterDown.capacity}`,
      )

      expect(up.viable, 'fixture: the refinance after the rise is viable').toBe(true)
      expect(up.currentInterestRateBps, 'the rate the Trove carries now').toBe(beforeUp.rate)
      expect(up.resultingInterestRateBps, 'the rate the chain then sets').toBe(afterUp.rate)
      expect(afterUp.rate, 'and it is the new global rate, higher than before').toBe(target)
      expect(up.currentCapacity).toBe(beforeUp.capacity)
      expect(up.resultingCapacity, 'the capacity the chain then sets').toBe(afterUp.capacity)
      expect(afterUp.capacity, 'a refinance after a rise RAISES capacity').toBeGreaterThan(
        beforeUp.capacity,
      )

      expect(down.viable, 'fixture: the refinance after the fall is viable').toBe(true)
      expect(down.resultingCapacity, 'the capacity the chain then sets').toBe(afterDown.capacity)
      expect(afterDown.capacity, 'a refinance after a fall CUTS capacity').toBeLessThan(
        beforeDown.capacity,
      )
      expect(down.resultingInterestRateBps).toBe(afterDown.rate)
    } finally {
      console.log(['[MK-101] refinance, preview against the chain', ...rows].join('\n'))
      await fork.testClient.revert({ id: outer })
    }
  }, 600_000)
})
