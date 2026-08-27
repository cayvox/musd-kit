import { http, type Address, createWalletClient, parseAbi } from 'viem'
import { describe, expect, it } from 'vitest'
import { createMusdClient, getAddresses, troveManagerAbi } from '../src'
import { connectFork } from './harness'
import { mezoTestnet } from './harness/constants'
import { testAccount } from './harness/openTroveRaw'

const T = getAddresses(31611)
const MUSD = 10n ** 18n
const BTC = 10n ** 18n

const wait = (hash: Address) => connectFork().publicClient.waitForTransactionReceipt({ hash })

function clientFor(account: ReturnType<typeof testAccount>) {
  const fork = connectFork()
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

/**
 * The two obligations the register recorded as owed to the differential harness wave, reached
 * rather than pointed at.
 *
 * Both were REASONED FROM SOURCE and never observed executing, which is the specific thing
 * `docs/09-review-and-validated-surface.md` §3 lists them under. A claim reasoned from Solidity
 * is worth something; it is not worth the same as a claim watched happening, and the whole
 * argument for this harness is that the difference is where the S1s lived.
 */
describe('Obligations owed to the differential harness', () => {
  /**
   * MK-002. `maxBorrowingCapacity` is recomputed ONLY when collateral decreases, and stored as
   * `min(current, recalculated)` (`BorrowerOperations.sol:879-897`), so it ratchets DOWNWARD
   * and never rises.
   *
   * What the existing tests pin is that it does not RISE with price, which is the half the
   * reported defect turned on. What none of them do is perform a collateral withdrawal and
   * watch `min(current, recalculated)` take the LOWER branch. That is this.
   */
  it('MK-002: the downward capacity ratchet takes its lower branch on a collateral decrease', async () => {
    const fork = connectFork()
    const account = testAccount(9500)
    await fork.fundAccount(account.address, 20n * BTC)
    const client = clientFor(account)

    const snapshotId = await fork.testClient.snapshot()
    try {
      // Open at the live price. Capacity is fixed here, from THIS price
      // (`BorrowerOperations.sol:692-698` calling `:1323-1328`).
      // AWAIT THE RECEIPT. The SDK returns `{ hash }` without waiting, by design, so a read
      // taken straight after sees no Trove. I made this exact mistake twice in one wave: the
      // differential harness's seeding did it, and so did this file, and standalone runs hid
      // both because the timing happened to work. In the full suite it reverted three runs out
      // of four.
      await wait((await client.openTrove({ collateral: 2n * BTC, debt: 20_000n * MUSD })).hash)
      const opened = await client.getBorrowingCapacity(account.address)
      expect(
        opened.capacity,
        'fixture: the position must have a capacity to ratchet',
      ).toBeGreaterThan(0n)

      // Raising the price must NOT raise capacity. This half is already covered elsewhere and
      // is repeated here only so the ratchet's direction is established in one place.
      const price = await client.getOraclePrice()
      await fork.setPrice((price * 2n) / 1n)
      await fork.mineBlocks(1)
      const afterPriceRise = await client.getBorrowingCapacity(account.address)
      expect(
        afterPriceRise.capacity,
        'MK-002: capacity must not rise with the price, it is fixed at the opening price',
      ).toBe(opened.capacity)
      await fork.setPrice(price)
      await fork.mineBlocks(1)

      // THE OBLIGATION. Withdraw collateral, which is the only path that recomputes it, and
      // watch the stored value actually fall.
      await wait((await client.withdrawCollateral({ amount: BTC })).hash)
      const afterWithdrawal = await client.getBorrowingCapacity(account.address)

      console.log(
        `[obligation MK-002] capacity opened=${opened.capacity} afterPriceRise=${afterPriceRise.capacity} afterWithdrawal=${afterWithdrawal.capacity}`,
      )
      expect(
        afterWithdrawal.capacity,
        'MK-002: a collateral decrease must take the LOWER branch of min(current, recalculated)',
      ).toBeLessThan(opened.capacity)
    } finally {
      await fork.testClient.revert({ id: snapshotId })
    }
  }, 600_000)

  /**
   * MK-018. The borrowing fee is skipped for a fee exempt account on the DEBT INCREASE branch
   * too, not only at open (`BorrowerOperations.sol:810-818`).
   *
   * The existing fork test grants exemption and exercises the OPEN path. This one grants
   * exemption and then BORROWS against an existing position, which is the branch the register
   * records as reasoned but unobserved.
   */
  it('MK-018: an exempt account is charged no fee on the debt increase branch', async () => {
    const fork = connectFork()
    const exempt = testAccount(9501)
    await fork.fundAccount(exempt.address, 20n * BTC)

    const record = (await import(
      '@mezo-org/musd-contracts/deployments/matsnet/GovernableVariables.json'
    )) as unknown as { default?: { address: Address }; address?: Address }
    const governableVariables = (record.default?.address ?? record.address) as Address
    const gvAbi = parseAbi([
      'function council() view returns (address)',
      'function isAccountFeeExempt(address) view returns (bool)',
      'function addFeeExemptAccount(address)',
    ])

    const snapshotId = await fork.testClient.snapshot()
    try {
      const council = await fork.publicClient.readContract({
        address: governableVariables,
        abi: gvAbi,
        functionName: 'council',
      })
      await fork.testClient.impersonateAccount({ address: council })
      await fork.fundAccount(council, 5n * BTC)
      await wait(
        await createWalletClient({
          account: council,
          chain: mezoTestnet,
          transport: http(fork.rpcUrl),
        }).writeContract({
          account: council,
          chain: mezoTestnet,
          address: governableVariables,
          abi: gvAbi,
          functionName: 'addFeeExemptAccount',
          args: [exempt.address],
        }),
      )
      await fork.testClient.stopImpersonatingAccount({ address: council })
      expect(
        await fork.publicClient.readContract({
          address: governableVariables,
          abi: gvAbi,
          functionName: 'isAccountFeeExempt',
          args: [exempt.address],
        }),
        'fixture: the account must be fee exempt on the fork',
      ).toBe(true)

      const client = clientFor(exempt)
      // Same reason as above: read only after the receipt exists.
      await wait((await client.openTrove({ collateral: 3n * BTC, debt: 10_000n * MUSD })).hash)

      // THE OBLIGATION: the debt increase branch, not the open branch.
      const before = await fork.publicClient.readContract({
        address: T.troveManager,
        abi: troveManagerAbi,
        functionName: 'getEntireDebtAndColl',
        args: [exempt.address],
      })
      const draw = 2_000n * MUSD
      const quoted = await client.getBorrowingFee(draw)
      const preview = await client.previewBorrow({ owner: exempt.address, amount: draw })
      await wait((await client.borrow({ amount: draw })).hash)
      const after = await fork.publicClient.readContract({
        address: T.troveManager,
        abi: troveManagerAbi,
        functionName: 'getEntireDebtAndColl',
        args: [exempt.address],
      })

      // Principal only, so accrued interest between the two reads cannot be mistaken for a fee.
      const principalAdded = after[1] - before[1]
      console.log(
        `[obligation MK-018] draw=${draw} quotedFee=${quoted} preview.fee=${preview.fee} principalAdded=${principalAdded}`,
      )
      expect(
        quoted,
        'fixture: a non exempt account would be charged something here',
      ).toBeGreaterThan(0n)
      expect(preview.fee, 'MK-018: previewBorrow must report zero fee for an exempt account').toBe(
        0n,
      )
      expect(
        principalAdded,
        'MK-018: the debt increase branch must add the draw and NO fee for an exempt account',
      ).toBe(draw)
    } finally {
      await fork.testClient.revert({ id: snapshotId })
    }
  }, 600_000)
})
