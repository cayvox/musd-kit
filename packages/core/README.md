# @musd-kit/core

**The typed SDK for MUSD on Mezo**, the framework-agnostic core. The layer between
*connected* (handled by [`@mezo-org/passport`](https://www.npmjs.com/package/@mezo-org/passport))
and *working*: the Trove lifecycle, the insertion-hint dance, and the MUSD math, made
correct, typed, and reusable.

> ⚠️ **Community tooling, not official.** Independent, open-source, **not affiliated with or
> endorsed by Mezo**. An unofficial community **Mezo MUSD SDK**. **Status: pre-1.0 (`0.x`),
> for testnet and evaluation.** Every write path documents what it does on-chain and what it
> does not guarantee. License: MIT.

## Install

```sh
npm install @musd-kit/core viem
```

`viem` is a peer dependency (`^2.22.8`).

## Quickstart

```ts
import { createMusdClient } from '@musd-kit/core'
import { mezoTestnet } from '@mezo-org/chains'
import { http, createPublicClient, createWalletClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const publicClient = createPublicClient({ chain: mezoTestnet, transport: http() })
const walletClient = createWalletClient({
  account: privateKeyToAccount(process.env.KEY as `0x${string}`),
  chain: mezoTestnet,
  transport: http(),
})

const musd = createMusdClient({ chainId: mezoTestnet.id, publicClient, walletClient })

// Read, contract-authoritative: never recomputed client-side.
const trove = await musd.getTrove(account.address)
// trove.entireDebt, trove.icr, trove.healthFactor, trove.liquidationPrice, …

// Preview, the only client-side math. See docs/09 for what its validation covers.
const preview = await musd.previewOpen({ collateral: parseBtc('0.05'), debt: parseMusd('2500') })
if (preview.meetsMinimum) {
  await musd.openTrove({ collateral: parseBtc('0.05'), debt: parseMusd('2500') })
}

// Manage, hints + simulate-before-send + typed errors are absorbed.
await musd.borrow({ amount: parseMusd('500') })
await musd.repay({ amount: parseMusd('500') })

// Keeper surface (permissionless).
if (await musd.isLiquidatable(borrower)) await musd.liquidate(borrower)
```

Every protocol revert maps to a discriminated `MusdError` you can branch on
(`BelowMinimumDebt`, `ICRBelowMCR`, `RecoveryModeRestriction`, `NothingToLiquidate`, …).

## Design (two rules)

- **Live position data → the contract's own getters** (`getEntireDebtAndColl`,
  `getCurrentICR`, `getTCR`, …). Never recomputed client-side, no interest-drift by
  construction.
- **Previews of positions that don't exist yet → client math.** Validated against
  forked-Mezo behavior, against the contract's `pure` helpers, and since P8 against
  actual transaction outcomes by the differential harness. Coverage is stated per
  surface in `docs/09-review-and-validated-surface.md` §3, including what it does
  not cover (MK-015).

## Upgrading from 0.1.0

**Read `docs/11-migration-0.1-to-0.2.md` before you upgrade, and before you decide not to.** 0.1.0
returned wrong numbers on seven surfaces. Three of them were wrong silently: `isLiquidatable`
reported Recovery Mode liquidations this protocol does not have (MK-001), `redeem()` returned the
redemption RATE in a field named `fee` (MK-014), and `previewOpen.meetsRecoveryRequirement` was
`true` for every normal mode open while nothing checked TCR against CCR (MK-005). That page lists
which 0.1.0 behaviours return wrong numbers and which fail transactions, so you can judge your own
exposure.

## Two limits at 0.2.0

- **`maxFeePercentage` is advisory only (MK-011).** Checked here, not binding on the contract.
- **Four of eleven writes are ratio gated with no preview (MK-038).** `addCollateral`, `repay`,
  `withdrawCollateral` and `adjustTrove`. For the first two this surprises people: in normal mode a
  top-up that RAISES ICR still reverts if the result is under MCR
  (`BorrowerOperations.sol:1201`), so an under-water position cannot be partly rescued. Compute the
  resulting ratio from `getTrove` plus `computeICR` and compare it against `MCR` yourself.

## React?

For wagmi-idiomatic hooks over this core, use
[`@musd-kit/react`](https://www.npmjs.com/package/@musd-kit/react). For a headless example
(this core only, no React), see [`examples/keeper`](https://github.com/cayvox/musd-kit/tree/main/examples/keeper).

## Docs

Full guides, the ground-truth contract reference, and the generated API reference live in the
[repository docs](https://github.com/cayvox/musd-kit/tree/main/docs).
