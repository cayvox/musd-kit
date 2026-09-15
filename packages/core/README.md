# @musd-kit/core

**The typed SDK for MUSD on Mezo**, the framework-agnostic core. The layer between
*connected* (handled by [`@mezo-org/passport`](https://www.npmjs.com/package/@mezo-org/passport))
and *working*: the Trove lifecycle, the insertion-hint dance, and the MUSD math, made
typed, reusable, and checked against the contracts rather than against intuition.

> ⚠️ **Community tooling, not official.** Independent, open-source, **not affiliated with or
> endorsed by Mezo**. An unofficial community **Mezo MUSD SDK**. **Status: pre-1.0 (`0.x`),
> for testnet and evaluation.** Every write path documents what it does on-chain and what it
> does not guarantee. License: MIT.

## How much to borrow is your decision, and the SDK will not make it for you (MK-240)

`getBorrowingPower` returns the **`ceiling`**: the largest draw the contract accepts right now, with no
margin. In normal mode it opens the position at exactly the 110% minimum collateral ratio, where
interest pushes it under 110% within seconds and anyone can liquidate it and take all of the
collateral. **It is a limit to display, never an amount to borrow.**

A draw that survives being held depends on how long it will be held and how far the price may fall
meanwhile, and the library knows neither. So `drawForMargin` takes both, and neither has a default:

```ts
const { ceiling } = await musd.getBorrowingPower({ collateral, account })
const sized = await musd.drawForMargin({
  collateral,
  account,
  horizonSeconds: 7n * 86_400n, // how long the position must survive, your choice
  priceFallBps: 1_000n, // the BTC fall it must survive, your choice
})
sized.draw // survives that fall over that horizon, and nothing more
sized.margin // { horizonSeconds, priceFallBps, interestRateBps, accrualFraction, stressedPrice }
```

**How often a fall was reached, on Mezo mainnet.** The share of start times after which `fetchPrice()`
fell at least that far within the horizon, over blocks 9841930 to 11868955 (86 days, one sample every
225 blocks, about 14 minutes):

| Hold for | Fell 2% or more | 5% or more | 10% or more | 20% or more | Worst fall seen |
|---|---|---|---|---|---|
| 1 hour | 0.1% | 0.0% | 0.0% | 0.0% | 4.18% |
| 1 day | 17.4% | 1.0% | 0.0% | 0.0% | 5.70% |
| 3 days | 43.9% | 3.8% | 0.01% | 0.0% | 10.24% |
| 7 days | 57.6% | 6.7% | 0.2% | 0.0% | 10.80% |
| 30 days | 68.2% | 10.4% | 1.1% | 0.0% | 11.64% |

It is one stretch of history in one market regime, not a probability. Neighbouring start times share
most of their samples, and a dip that recovered between two samples is not in it, so every share is a
lower bound. Debt redistributed from other Troves' liquidations can also raise a position's debt
without its owner acting. Reproduce with `pnpm tsx scripts/oracle-moves.ts --end 11869000 --consecutive 0
--days 90 --step 225 --horizons 3600,86400,259200,604800,2592000 --falls 200,500,1000,2000` in the
repository, with `MEZO_MAINNET_RPC_URL` set.

Until 0.5.0 this function returned a `recommended` draw sized for one hour and a 2% fall, and this
README told you to offer it. By the table above, a fall that large followed within a week of 57.6% of start
times. The record is MK-240 in [`FINDINGS.md`](https://github.com/cayvox/musd-kit/blob/main/FINDINGS.md),
and `docs/16-migration-0.4-to-0.5.md` says what to change.

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
its own. `liquidate` and `batchLiquidate` have `isLiquidatable` rather than a preview. `claim` has
one condition, a surplus to claim (`CollSurplusPool.sol:90-93`): `getClaimableCollateral` reads it, and
`claim()` returns `{ claimed: false }` when there is none rather than sending a revert (MK-007, MK-246).
Every write simulates before it sends (MK-109).

**A redemption reports what it settled.** `redeem()` resolves once the transaction has mined, with
`settled` read from its `Redemption` event: the MUSD actually redeemed, the collateral drawn, the fee and
the collateral received. What the SDK expected is kept apart, as `estimatedBeforeSend` (MK-241).

**A withdrawal can cost borrowing capacity you do not get back by re-depositing.** Withdrawing collateral
stores the lower of the current capacity and one recomputed at today's price
(`BorrowerOperations.sol:879-899`); adding the collateral back never raises it. Every withdrawal preview
reports `capacityAfter`, with what a refinance would cost to win it back (MK-242).

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
