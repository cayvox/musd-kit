# @musd-kit/core

**The typed SDK for MUSD on Mezo**, the framework-agnostic core. The layer between
*connected* (handled by [`@mezo-org/passport`](https://www.npmjs.com/package/@mezo-org/passport))
and *working*: the Trove lifecycle, the insertion-hint dance, and the MUSD math, made
typed, reusable, and checked against the contracts rather than against intuition.

> ⚠️ **Community tooling, not official.** Independent, open-source, **not affiliated with or
> endorsed by Mezo**. An unofficial community **Mezo MUSD SDK**. **Status: pre-1.0 (`0.x`),
> for testnet and evaluation.** Every write path documents what it does on-chain and what it
> does not guarantee. License: MIT.

## Borrowing power is two figures, and only one of them is safe to open at (MK-100)

`getBorrowingPower` returns a **`ceiling`** and a **`recommended`** draw. The `ceiling` is the largest
draw the contract accepts, with no margin: in normal mode it opens the position at exactly the 110%
minimum collateral ratio, and interest pushes it below 110% within seconds, where anyone can liquidate
it and take all of the collateral. **Offer `recommended`.** It is solved against a price stressed by a
measured adverse move and an interest window, both reported on the result (`margin`) and both stated
on `BORROWING_POWER_PRICE_MOVE_BPS` and `BORROWING_POWER_MARGIN_WINDOW_SECONDS`.

```ts
const power = await musd.getBorrowingPower({ collateral, account })
power.recommended // the draw to offer
power.ceiling // a limit to display, never an amount to borrow
power.margin // { windowSeconds, priceMoveBps, interestRateBps, accrualFraction, stressedPrice }
```

Until 0.4.0 this function returned the ceiling alone, as a `bigint`. The full record, including the
fork measurement, is MK-100 in [`FINDINGS.md`](https://github.com/cayvox/musd-kit/blob/main/FINDINGS.md).

## Install

```sh
npm install @musd-kit/core viem
```

`viem` is a peer dependency (`^2.22.8`).

## Quickstart

```ts
import { createMusdClient, mezoTestnet, parseBtc, parseMusd } from '@musd-kit/core'
import { http, type Address, createPublicClient, createWalletClient } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const account = privateKeyToAccount(process.env.KEY as `0x${string}`)
const publicClient = createPublicClient({ chain: mezoTestnet, transport: http() })
const walletClient = createWalletClient({ account, chain: mezoTestnet, transport: http() })

const musd = createMusdClient({ chainId: mezoTestnet.id, publicClient, walletClient })

// Read, contract-authoritative: never recomputed client-side.
const trove = await musd.getTrove(account.address)
console.log(trove.entireDebt, trove.icr, trove.healthFactor, trove.liquidationPrice)

// Preview, the only client-side math. `viable` is the verdict: it covers the debt floor, the
// individual ratio, Recovery Mode and the system ratio. `meetsMinimum` is the floor alone.
const collateral = parseBtc('0.05')
const debt = parseMusd('2500')
const preview = await musd.previewOpen({ collateral, debt, account: account.address })
if (preview.viable) {
  await musd.openTrove({ collateral, debt })
}

// Manage, hints + simulate-before-send + typed errors are absorbed.
await musd.borrow({ amount: parseMusd('500') })
await musd.repay({ amount: parseMusd('500') })

// Keeper surface (permissionless).
const borrower: Address = '0x0000000000000000000000000000000000000001'
if (await musd.isLiquidatable(borrower)) await musd.liquidate(borrower)
```

The quickstart above is compiled against the packed tarball on every push by `pnpm gate:packaging`,
so a change that breaks it fails CI (MK-108).

Every error the client raises is a discriminated `MusdError` you can branch on, protocol reverts
included (`BelowMinimumDebt`, `ICRBelowMCR`, `RecoveryModeRestriction`, `OracleStale`, …). A failure
that is not a revert, such as an endpoint refusing the request, arrives as `ContractCallFailed` with
the original error as its `cause` (MK-105).

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

**Most writes you can call, you can ask about first.** The client exposes twelve writes and nine
previews. `addCollateral`, `borrow`, `repay`, `withdrawCollateral` and `adjustTrove` precheck through
the same evaluator `previewAdjustTrove` uses, `close` through `previewClose`, and `redeem` through
`previewRedeem`, so a refusal those previews would report is thrown before any gas is spent.
`openTrove` prechecks the fee cap, the debt floor and an existing Trove, and leaves the ratio gates
to the simulation; ask `previewOpen` first. `refinance` has `previewRefinance` and no precheck of
its own. `liquidate` and `batchLiquidate` have `isLiquidatable` rather than a preview, and `claim`
has nothing to preview because `_claimCollateral` (`BorrowerOperations.sol:1119-1124`) has no
condition. Every write simulates before it sends (MK-109).

**The rule that surprises people, surfaced rather than documented:** the individual ratio
requirement is ABSOLUTE (`BorrowerOperations.sol:1201`, defined at `:1330-1335`). It tests the
resulting ratio, not whether you improved, so a position already under MCR cannot be partly rescued
by adding collateral. `previewAdjustTrove` returns `icrIsAbsolute` and
`minimumCollateralToClearIcr`, the figure that would actually work.

**Closing costs more MUSD than the position gave you (MK-045).** The borrowing fee is minted to the
PCV, not to you (`BorrowerOperations.sol:602-611`), while closing needs `entireDebt` minus the 200
MUSD reserve in hand (`:963`). So you are short by exactly the fee plus accrued interest, and a user
who borrowed the maximum cannot close without acquiring MUSD elsewhere. A protocol property, not a
gap here. `previewClose` reports the exact shortfall before you send.

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
