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

// Preview, the only client-side math (dual-validated against the fork + pure helpers).
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
- **Previews of positions that don't exist yet → client math, dual-validated** against
  forked-Mezo behavior *and* the contract's `pure` helpers.

## React?

For wagmi-idiomatic hooks over this core, use
[`@musd-kit/react`](https://www.npmjs.com/package/@musd-kit/react). For a headless example
(this core only, no React), see [`examples/keeper`](https://github.com/cayvox/musd-kit/tree/main/examples/keeper).

## Docs

Full guides, the ground-truth contract reference, and the generated API reference live in the
[repository docs](https://github.com/cayvox/musd-kit/tree/main/docs).
