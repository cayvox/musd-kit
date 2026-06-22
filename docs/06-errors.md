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
| `MaxFeeExceeded` | SDK-side fee guard tripped (C5, no on-chain maxFee) | `{ maxFeePercentage, actualFee }` |
| `InsufficientCollateral` | resulting ICR would be < MCR | `{ icr, mcr }` |
| `TroveNotFound` | operating on an address with no open Trove | `{ address }` |
| `TroveAlreadyExists` | opening when one is already open | `{ address }` |
| `InvalidAmount` | zero / negative / nonsensical input | `{ field, value }` |

### 2.2 Protocol reverts (mapped from on-chain revert data)

| Error | Maps from | Notes |
|---|---|---|
| `ICRBelowMCR` | revert when ICR < 110% on open/adjust/withdraw | the dangerous one, surface clearly |
| `RecoveryModeRestriction` | revert under Recovery Mode (TCR < 150%) tightened rules | pair with `getSystemState().isRecoveryMode` |
| `RepayExceedsDebt` | repaying more than owed | n/a |
| `StaleHint` | redemption/insert hint went stale (someone moved the list first) | advise recompute + retry |
| `RedemptionTruncated` | redeemed less than requested due to `minNetDebt` floor | not always an error, may be returned as info; see `05` §6.2 |
| `InsufficientMusdBalance` | not enough MUSD to repay/redeem | `{ required, balance }` |
| `Unauthorized` | caller not permitted (e.g. governance-only path) | n/a |

### 2.3 Infrastructure

| Error | When |
|---|---|
| `UnsupportedChain` | `chainId` not 31611/31612 and no override given |
| `MissingWalletClient` | a write attempted with no `walletClient` |
| `ContractCallFailed` | an unexpected/unmapped revert, wraps the raw cause, never swallowed |

---

## 3. Mapping discipline

- **One place.** Revert-reason decoding lives in `errors/` only; write paths call
  the mapper, they do not decode inline.
- **Never swallow.** An unmapped revert becomes `ContractCallFailed` with the
  original error preserved in `cause`, it is never turned into a generic message
  that hides what happened.
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
import { BelowMinimumDebt, InsufficientCollateral, RecoveryModeRestriction } from '@musd-kit/core';

const { openTrove, error } = useOpenTrove();

// later, branching on a typed error:
if (error instanceof BelowMinimumDebt) {
  show(`Minimum is ${formatMusd(error.context.minNetDebt)} net.`);
} else if (error instanceof InsufficientCollateral) {
  show('Add more BTC, this would fall below the 110% ratio.');
} else if (error instanceof RecoveryModeRestriction) {
  show('The system is in Recovery Mode; borrowing rules are tighter right now.');
}
```
