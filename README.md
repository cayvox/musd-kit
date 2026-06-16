# musd-kit

**The typed SDK for MUSD on Mezo** — the layer between *connected* and *working*.

> ⚠️ **Community tooling, not official.** `musd-kit` is an independent, open-source
> library built by [Cayvox Labs](https://github.com/anilkaracay). It is **not
> affiliated with or endorsed by Mezo**. "MUSD" is Mezo's asset; this is an unofficial
> community Mezo MUSD SDK. **Status: pre-1.0 — for testnet and evaluation** until it
> carries full test coverage and third-party use.

---

## What it is

Mezo ships [`@mezo-org/passport`](https://www.npmjs.com/package/@mezo-org/passport)
for *connecting a wallet*, and the [`mezo-org/musd`](https://github.com/mezo-org/musd)
repo for *the protocol*. The layer in between — *how an app opens a Trove, reads a
position's health, computes borrowing power, and manages a loan* — is left to every
developer to rebuild from raw contract calls. `musd-kit` is that layer:

- **Typed contract clients** with bundled, verified addresses for Mezo mainnet
  (31612) and testnet (31611).
- **The full Trove lifecycle** — `openTrove`, `adjust`, `repay`, `close`, `claim`,
  `refinance`, `redeem` — with the fiddly **insertion-hint computation handled
  automatically**.
- **The MUSD math, correct and tested** — ICR, liquidation price, borrowing power,
  entire-debt (principal + interest + fees + gas reserve), and position health.
- **A wagmi-idiomatic React layer** (`useTrove`, `useOpenTrove`, `useHealthFactor`,
  …) that sits on top of a Passport/wagmi setup.

**Positioning:** *Passport connects the wallet; musd-kit operates MUSD.* Two
non-overlapping libraries that compose.

---

## Why it exists

The MUSD math is subtle exactly where it's dangerous — near the liquidation
threshold. Mezo's own developer guide hands you ~15 lines of raw hint computation
and points you to a test file; a real Mezo dApp (`pikolo`) hand-built a borrowing-
power calculator and a collateral-health monitor. That work is duplicated,
correctness-sensitive, and shipped by no one as a reusable package. `musd-kit`
writes it once, correctly, validated against the real contracts.

**Correctness is the product.** Live position data is read from the contract's own
authoritative getters (never re-derived); the only client-side math —
previews/calculators for positions that don't exist yet — is validated twice:
against a fork of the real Mezo contracts and against the contracts' own `pure`
helpers.

---

## Packages

| Package | Status | Description |
|---|---|---|
| `@musd-kit/core` | v1 | Framework-agnostic (viem): typed clients, addresses, Trove lifecycle, auto-hints, preview math, redemption, typed errors |
| `@musd-kit/react` | v1 | wagmi-idiomatic hooks over the core |
| `@musd-kit/ui` | v2 | Optional headless/styled components |
| `@musd-kit/testing` | v2 | MUSD mock + forked-Mezo test helpers |
| `musd-kit-py` | v2 | Python SDK for bots/keepers |

---

## Quick start

```bash
pnpm add @musd-kit/core @musd-kit/react viem wagmi @tanstack/react-query
```

```ts
import { createMusdClient, parseBtc, parseMusd } from '@musd-kit/core';

const musd = createMusdClient({ chainId: 31611, publicClient, walletClient });

// Read a live position — every number from the contract's own getters
const trove = await musd.getTrove(address);
console.log(trove.entireDebt, trove.icr, trove.liquidationPrice, trove.healthFactor);

// Preview before signing
const preview = await musd.previewOpen({ collateral: parseBtc('0.05'), debt: parseMusd('2500') });

// Open — hints, fee, and gas reserve handled for you
await musd.openTrove({ collateral: parseBtc('0.05'), debt: parseMusd('2500') });
```

React, alongside Passport:

```tsx
import { useTrove, useOpenTrove } from '@musd-kit/react';

const { data: trove } = useTrove({ address });
const { openTrove, isPending } = useOpenTrove();
```

`@musd-kit/react` needs no provider of its own — it consumes the wagmi context
Passport (or any wagmi setup) already established.

---

## Examples

- **`examples/open-and-manage/`** — a React app: connect (Passport) → preview → open
  → monitor health → repay.
- **`examples/keeper/`** — a headless Node keeper using `@musd-kit/core` only (no
  React) — proof the core is framework-agnostic.

---

## Documentation

- [`docs/00-overview.md`](docs/00-overview.md) — orientation and document map
- [`docs/01-ground-truth.md`](docs/01-ground-truth.md) — the verified contract reference
- [`docs/02-architecture.md`](docs/02-architecture.md) — packages and the two-source correctness model
- [`docs/03-core-api.md`](docs/03-core-api.md) · [`docs/04-react-api.md`](docs/04-react-api.md) — API surfaces
- [`docs/05-math-and-hints.md`](docs/05-math-and-hints.md) — the correctness-critical core
- [`docs/06-errors.md`](docs/06-errors.md) · [`docs/10-glossary.md`](docs/10-glossary.md) — the error taxonomy + terms
- [`docs/musd-kit-handbook-v0.2.md`](docs/musd-kit-handbook-v0.2.md) — the full specification

The docs site (Vitepress) and the generated **API reference** (TypeDoc) build from these:
`pnpm docs:build` → `docs/.vitepress/dist` (with the API ref at `/api/`). Per-package
quickstarts: [`@musd-kit/core`](packages/core/README.md) · [`@musd-kit/react`](packages/react/README.md).

---

## License

[MIT](LICENSE) — the ecosystem standard for TypeScript developer tooling.

Built from production experience shipping **Cark** (Mezo Hackathon MUSD-track
winner), where this client layer was first written by hand.
