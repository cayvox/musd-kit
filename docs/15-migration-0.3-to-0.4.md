# Migration, 0.3 to 0.4.0

**Read this if you call `getBorrowingPower`, render `useBorrowingPower`, redeem, or build preview
inputs by hand.** Two of the changes below alter a value without changing its type, so the compiler
will not find them for you.

Every claim here cites a finding ID in [`FINDINGS.md`](../FINDINGS.md) and, where it is a protocol
fact, a file and line in `mezo-org/musd`. 0.4.0 is a minor on `0.x`, which is where breaking changes
go: `^0.3.1` does not resolve to it (`docs/12-release-runbook.md` §0a).

---

## At a glance

| Change | Kind | Finding | Your code breaks how |
|---|---|---|---|
| `getBorrowingPower` returns `BorrowingPower`, not `bigint` | **type** | MK-100 | compile error wherever the result is used as a number |
| `useBorrowingPower`'s `data` is the recommended draw, not the ceiling | **value, same type** | MK-100 | **no compile error.** The number is smaller by the margin |
| The React hooks default `account` to the connected wallet | **value** | MK-106 | **no compile error.** A fee exempt wallet gets its own, larger answer |
| A read hook with changed or missing inputs shows `data: undefined` and `pending` | **behaviour** | MK-102 | a component that kept rendering the previous answer now renders its loading state |
| A write hook resets when the account or chain changes | behaviour | MK-102 | `hash`, `data` and `isSuccess` clear on a wallet switch |
| `redeem()` refuses a price fragile first-Trove partial | **behaviour** | MK-103 | a throw, `RedemptionPriceFragile`, where it used to send a transaction that mostly reverted |
| `redeem()` accepts its own `nextViableAmount` | behaviour | MK-104 | a send where it used to throw `RedemptionBreachesDebtFloor` |
| Every read, preview and write throws a `MusdError` | **behaviour** | MK-105 | a `catch` that tested for a viem error class now receives `OracleStale` or `ContractCallFailed`, with the viem error in `cause` |
| `MusdErrorCode` gains `ORACLE_STALE` and `REDEMPTION_PRICE_FRAGILE` | type | MK-103, MK-105 | compile error **only if** you `switch` on it exhaustively with no `default` |
| `EvaluateRedeemInput`, `EligibleTrove` and `EvaluateRefinanceInput` gain required fields | type | MK-101, MK-103 | compile error **only if you construct** them, for the pure evaluators or in a test double |
| `RefinancePreview`, `RedemptionPreview` and `RedeemResult` gain fields | type | MK-101, MK-103 | compile error **only if you construct** one |
| `previewRedeem` stops charging `maxIterations` for Troves the contract skips | behaviour | MK-107 | `NOTHING_REDEEMABLE` where the chain accepts the redemption becomes `viable` |
| **0.4.1:** `maxIterations: 0n` is no limit in `previewRedeem` and `redeem`, and a value outside `uint256` throws | **value, same type** | MK-114 | **no compile error.** At `0n` the preview reports the full redeemable amount where 0.4.0 reported one Trove's; a negative value throws `InvalidAmount` |

**Nothing was removed.** No function, class, constant or type disappeared, and no property was
deleted from a result.

---

## 1. `getBorrowingPower` returns two figures (MK-100)

> **Superseded in 0.5.0 (MK-240).** `recommended` was sized for one hour and a 2% fall, and this section
> told you to replace `max` with it. A position held for days did not survive that margin in most of the
> mainnet history measured since. 0.5.0 removes it: offer `drawForMargin` with a horizon and a fall you or
> your user choose. See [`16-migration-0.4-to-0.5.md`](./16-migration-0.4-to-0.5.md).

```ts
// 0.3
const max: bigint = await musd.getBorrowingPower({ collateral, account })

// 0.4
const power = await musd.getBorrowingPower({ collateral, account })
power.recommended  // what to offer
power.ceiling      // what 0.3 returned: a limit to display, never an amount to open at
power.recommendedIcr
power.ceilingIcr
power.margin       // { windowSeconds, priceMoveBps, interestRateBps, accrualFraction, stressedPrice }
```

**Replace `max` with `power.recommended`, not with `power.ceiling`.** The ceiling in normal mode opens
the Trove at exactly MCR (`BorrowerOperations.sol:657`, `:1330-1335`); liquidation is `ICR < MCR`
(`TroveManager.sol:1146-1148`) against a debt that accrues every second (`:1513-1527`). On a fork a
Trove opened at it was liquidatable a second later and was liquidated. A Trove opened at
`recommended` was not liquidatable after 1, 60, 600 or 3600 seconds, and survived a 199 bps price fall
an hour in.

`recommended` is solved at `price * (1 - BORROWING_POWER_PRICE_MOVE_BPS / 10000)` divided by one plus
`BORROWING_POWER_MARGIN_WINDOW_SECONDS` of interest: 200 bps and one hour, measured from Mezo mainnet
by `scripts/oracle-moves.ts`. Override either per call with `priceMoveBps` and
`marginWindowSeconds`, on the function and on both hooks; `0n` for both returns the ceiling under
both names. A negative override, or a price move of `10_000n` or more, throws `InvalidAmount`.

If you had applied your own buffer to the 0.3 number, as its warning asked, remove it or you will
apply two.

## 2. `useBorrowingPower` changed value, not type (MK-100, MK-106)

`data` is still a `bigint`, so this compiles unchanged and shows a different number. It is now
`recommended`. For the ceiling, the margin and the ratios, use `useBorrowingPowerDetail`, which shares
the same single fetch.

An omitted `account` now means the connected wallet rather than "not fee exempt". The borrowing fee is
skipped for an exempt account (`BorrowerOperations.sol:637-643`), so an exempt wallet sees a larger
figure than before. Pass `account` explicitly to ask about someone else.

## 3. Read hooks no longer show the previous answer (MK-102)

0.3 passed `placeholderData: keepPreviousData`, so a cleared input kept the verdict for the last
amount, a disconnected wallet kept the previous account's Trove, and `status` said `success`
throughout. In 0.4 a hook whose inputs changed, or that is disabled because an input is missing,
reports `data: undefined` and `status: 'pending'` until the new question is answered. A refetch of
the SAME question on a new block still keeps the last answer visible.

If a component rendered `data` without checking it, it now renders its empty state in those moments,
which is correct: there was no answer to show.

## 4. Redemption (MK-103, MK-104, MK-107)

**`redeem()` refuses a partial on the first Trove that the price is likely to cancel.** The contract
cancels a partial unless its hint lies in a band about 1.9e-7 wide at a 1% rate
(`TroveManager.sol:1276-1306`), recomputed at the price when the transaction mines, and a cancel on
the first Trove reverts the call (`:392`, `:406-408`). Measured on a fork, a 4.23 MUSD partial on an
1808 MUSD Trove tolerated 0.504 bps each way. So `redeem()` now throws `RedemptionPriceFragile`,
before gas, carrying both tolerances and `nextViableAmount`:

```ts
try {
  await musd.redeem({ amount })
} catch (e) {
  if (e instanceof RedemptionPriceFragile) {
    // Redeem e.context.nextViableAmount or more, which consumes the first Trove whole, or
    await musd.redeem({ amount, acceptPriceFragilePartial: true })
  }
}
```

The hint it sends is now the centre of the band rather than the helper's lower edge, and
`previewRedeem(...).partial` reports the tolerances before you call.

**`nextViableAmount` is accepted by `redeem()` for the ten minutes it advertises.** 0.3 re-applied the
900 second margin when sending, so it refused the advice a block after giving it. Measured through
`redeem()` on a fork: accepted after 1, 60 and 600 seconds, refused before gas after an hour.

**`previewRedeem` counts iterations the way the contract does**: the sub-MCR Troves skipped before the
loop (`TroveManager.sol:338-350`) no longer use up `maxIterations`.

**If you call `evaluateRedeem` directly**, add `globalInterestRateBps` to the input and `collateral`
and `interestOwed` to each `EligibleTrove`; `previewRedeem` reads all three for you.

## 5. Refinance reports the rate and the capacity it moves to (MK-101)

`RefinancePreview` gains `currentInterestRateBps`, `resultingInterestRateBps`, `currentCapacity` and
`resultingCapacity`. A refinance sets the Trove to the GLOBAL rate, higher or lower
(`BorrowerOperations.sol:1069`, `:1075`), and resets capacity from the current price unconditionally
(`:1077-1084`). If you call `evaluateRefinance` directly, supply `currentInterestRateBps`,
`globalInterestRateBps` and `currentCapacity`.

## 6. Errors are typed on every path (MK-105)

In 0.3 only a failure inside a write's simulation was mapped; a read, a preview, or the reads a write
makes before simulating let the raw viem error through. A stale oracle, `PriceFeed: Oracle is stale.`
(`PriceFeed.sol:14`, `:51-54`), is the common case. In 0.4 every `MusdClient` method and every exported
preview throws a `MusdError`: `OracleStale` for that revert, `ContractCallFailed` for anything
unrecognised or for a call that failed without reverting, with the original error in `cause`.

```ts
// 0.3, and no longer reached
catch (e) { if (e instanceof ContractFunctionExecutionError) retryLater() }

// 0.4
catch (e) { if (e instanceof OracleStale) retryLater() }
```

`previewOpen` was documented as never throwing. A refusal is still a verdict, never an error; a
failure to read the state the verdict needs throws, typed.

## 7. 0.4.1: `maxIterations: 0n` means no limit (MK-114)

A patch within 0.4, with no API change, so it lives here rather than in a guide of its own.
`redeemCollateral` and `getRedemptionHints` read a zero `_maxIterations` as no limit
(`TroveManager.sol:353-355`, `HintHelpers.sol:107-109`), and the deployed helper answers that way. 0.4.0's
`previewRedeem` walked one eligible Trove at `0n`, so it reported less than the call redeemed, and
`redeem()` prechecked only that Trove while sending zero to the chain.

```ts
// 0.4.0: one eligible Trove, whatever the request
await musd.previewRedeem({ redeemer, amount, maxIterations: 0n })

// 0.4.1: as far as the request needs, as on chain; omit the field for the default of 100
await musd.previewRedeem({ redeemer, amount, maxIterations: 0n })
```

**If you passed `0n` meaning "do not walk"**, there was never such a call on chain: the contract has
always read it as no limit. Pass a positive bound instead. **If you passed a negative value**, it now
throws `InvalidAmount` before any read; before, the preview returned a figure for a value no
transaction could carry. The full table is in `docs/03-core-api.md`, under `maxIterations`.

