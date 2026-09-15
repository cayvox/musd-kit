# Errors

`musd-kit` never throws raw strings. Every protocol revert and every SDK-side guard
maps to a **named, discriminated error** a developer can branch on. This is
a direct quality-of-life win over raw contract reverts, which surface as opaque
messages.

---

## 1. The base type

```ts
class MusdError extends Error {
  readonly code: MusdErrorCode;     // discriminant
  readonly cause?: unknown;         // original viem/contract error, preserved
  readonly context?: Record<string, unknown>;  // e.g. { minNetDebt, netDebt }
}
```

All specific errors extend `MusdError` and set a unique `code`, so consumers can
branch by `instanceof` or by `code` in a switch.

---

## 2. The taxonomy

### 2.1 Validation / preview-time (thrown before sending, fail fast)

| Error | When | Carries |
|---|---|---|
| `BelowMinimumDebt` | `draw + fee < minNetDebt` | `{ minNetDebt, netDebt }` |
| `MaxFeeExceeded` | The SDK-side fee guard tripped. **Advisory**: no MUSD write path takes a fee cap, so a passing check means the fee was within your cap WHEN IT WAS READ, and the rate can move before the transaction mines (MK-011) | `{ maxFeePercentage, actualFee, actualFeePercentage }` |
| `InsufficientCollateral` | a collateral withdrawal larger than the collateral the Trove holds. **Only that** since 0.5.0: until then the adjust precheck also threw it for the ratio gate, which the decoder reported as `ICRBelowMCR` (MK-243) | `{ withdrawal, collateral }` |
| `LastTroveInSystem` | closing the last Trove, or a redemption that would consume it (MK-074, MK-245) | `{ troveOwnersCount?, sortedTrovesSize? }` |
| `TroveNotFound` | operating on an address with no open Trove | `{ address }` |
| `TroveAlreadyExists` | opening when one is already open | `{ address }` |
| `InvalidAmount` | zero / negative / nonsensical input | `{ field, value }` |
| `InvalidAddressOverride` | an `addresses` override with an unknown key, a non-address value, or the zero address (MK-009) | `{ contractName, value, why }` |
| `RedemptionPriceFragile` | `redeem()` would end on a partial of the FIRST Trove whose price tolerance is under the measured two block move, so a cancel would revert the call (MK-103). Pass `acceptPriceFragilePartial: true` to send it anyway | `{ requested, priceToleranceUp, priceToleranceDown, requiredTolerance, nextViableAmount }` |

### 2.2 Protocol reverts (mapped from on-chain revert data)

| Error | Maps from | Notes |
|---|---|---|
| `ICRBelowMCR` | the individual ratio gate, `_requireICRisAboveMCR` (`BorrowerOperations.sol:1330-1335`), on open, adjust, withdraw and refinance. **One code whichever path reaches it** (MK-243): the precheck throws it with `{ resultingIcr, mcr }`, the decoder without | the dangerous one, surface clearly |
| `RecoveryModeRestriction` | Recovery Mode's own gates: `ICR >= CCR` (`:1337-1342`), no ICR decrease (`:1395-1403`), no refinance (`:1133-1138`), from either path; the precheck adds `{ resultingIcr, ccr }` | pair with `getSystemState().isRecoveryMode` |
| `RepayExceedsDebt` | repaying more than owed | n/a |
| `StaleHint` | **never thrown** (MK-249): a stale redemption hint surfaces as `RedemptionFailed`, see `01-ground-truth` | exported for compatibility only |
| `InsufficientMusdBalance` | not enough MUSD to repay/redeem | `{ required, balance }` |
| `Unauthorized` | **never thrown** (MK-249): the SDK calls no permission-gated function | exported for compatibility only |

A redemption that redeems less than it asked is not an error: `RedeemResult.settled.unredeemedAmount`
reports it (MK-241). This table listed a `RedemptionTruncated` error until MK-246; no such error exists.
| `OracleStale` | `PriceFeed: Oracle is stale.`, the round is older than `MAX_PRICE_DELAY = 60` seconds (`PriceFeed.sol:14`, `:51-54`). Raised from ANY read, preview or write, since every one reads the price (MK-105) | the original error in `cause` |

### 2.3 Infrastructure

| Error | When |
|---|---|
| `UnsupportedChain` | `chainId` not 31611/31612 and no override given |
| `MissingWalletClient` | a write attempted with no `walletClient` |
| `DeploymentVerificationFailed` | the contracts at the resolved addresses are not a consistent MUSD deployment: missing code, or cross wiring that does not resolve (MK-008). Carries `failures: string[]`, all of them, not the first |
| `ContractCallFailed` | an unexpected/unmapped revert, or a call that failed without reverting (an endpoint refusing the request), wraps the raw cause, never swallowed. The message says "reverted" only when a revert was actually found in the cause |

---

## 3. Mapping discipline

- **One place.** Revert-reason decoding lives in `errors/` only; write paths call
  the mapper, they do not decode inline.
- **Every path, not only the simulation (MK-105).** Every `MusdClient` method and every exported
  preview runs inside `withTypedErrors`, so a revert raised by a read before a write's simulation, a
  stale oracle among them, arrives as a `MusdError` like one raised inside it. A `MusdError` thrown by
  a guard passes through unchanged. `zz-typed-errors.fork.test.ts` pins it against the real
  `PriceFeed` revert on thirteen surfaces.
- **Never swallow.** An unmapped revert becomes `ContractCallFailed` with the
  original error preserved in `cause`, it is never turned into a generic message
  that hides what happened.
- **Exactly one revert is turned into data instead of an error, and it is matched by
  reason.** `claim()` returns `{ claimed: false, hash: null }` when, and only when, the
  revert reason is `CollSurplusPool: No collateral available to claim`. Everything else it
  catches goes through the mapper and is rethrown. `claim()` was the one function violating
  the rule above: it caught everything and reported it as nothing to claim, so an RPC
  failure and an empty surplus were indistinguishable to the caller (MK-007). If you write
  another function that converts a revert into a value, match the reason. A bare `catch` is
  the defect, not the shape.
- **Test each with a real revert.** `06`'s test gate: every mapped protocol
  error is triggered on the fork (e.g. open below `minNetDebt` → assert
  `BelowMinimumDebt`; redeem against a stale hint → assert `StaleHint`) and the
  mapping asserted. Validation errors are unit-tested against their guards.
- **Stable codes.** `MusdErrorCode` values are part of the public API, adding is
  fine, renaming/removing is a breaking change (semver).

---

## 4. Example

```ts
import { useOpenTrove } from '@musd-kit/react';
import { BelowMinimumDebt, ICRBelowMCR, RecoveryModeRestriction } from '@musd-kit/core';

const { openTrove, error } = useOpenTrove();

// later, branching on a typed error:
if (error instanceof BelowMinimumDebt) {
  show(`Minimum is ${formatMusd(error.context.minNetDebt)} net.`);
} else if (error instanceof ICRBelowMCR) {
  show('Add more BTC, this would fall below the 110% ratio.');
} else if (error instanceof RecoveryModeRestriction) {
  show('The system is in Recovery Mode; borrowing rules are tighter right now.');
}
```
