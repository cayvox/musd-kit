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

## What it does, and the one thing it cannot

**Every write you can call, you can ask about first.** Ten of eleven exposed writes have a preview
returning a verdict, machine readable reasons, the binding constraint and the raw numbers, and each
prechecks the same conditions before sending. `claim` is the eleventh and has no preview because
`_claimCollateral` (`BorrowerOperations.sol:1119-1124`) has no condition to check.

**The rule that surprises people, surfaced rather than documented:** the individual ratio
requirement is ABSOLUTE (`BorrowerOperations.sol:1201`, defined at `:1330-1335`). It tests the
resulting ratio, not whether you improved, so a position already under MCR cannot be partly rescued
by adding collateral. `previewAdjustTrove` returns `icrIsAbsolute` and
`minimumCollateralToClearIcr`, the figure that would actually work.

**The one thing it cannot do: enforce a fee cap on chain (MK-011).** No MUSD write path takes a fee
cap parameter, so `maxFeePercentage` is read, compared and then the transaction is sent. That is a
property of the protocol, not a gap here, and no SDK can close it.

## React?

For wagmi-idiomatic hooks over this core, use
[`@musd-kit/react`](https://www.npmjs.com/package/@musd-kit/react). For a headless example
(this core only, no React), see [`examples/keeper`](https://github.com/cayvox/musd-kit/tree/main/examples/keeper).

## Docs

Full guides, the ground-truth contract reference, and the generated API reference live in the
[repository docs](https://github.com/cayvox/musd-kit/tree/main/docs).
