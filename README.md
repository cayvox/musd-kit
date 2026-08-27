# musd-kit

**The typed SDK for MUSD on Mezo**, the layer between *connected* and *working*.

> ⚠️ **Community tooling, not official.** `musd-kit` is an independent, open-source
> library built by [Cayvox Labs](https://cayvox.com). It is **not
> affiliated with or endorsed by Mezo**. "MUSD" is Mezo's asset; this is an unofficial
> community Mezo MUSD SDK. **Status: pre-1.0, for testnet and evaluation** until it
> carries full test coverage and third-party use.

---

## What it is

Mezo ships [`@mezo-org/passport`](https://www.npmjs.com/package/@mezo-org/passport)
for *connecting a wallet*, and the [`mezo-org/musd`](https://github.com/mezo-org/musd)
repo for *the protocol*. The layer in between, *how an app opens a Trove, reads a
position's health, computes borrowing power, and manages a loan*, is left to every
developer to rebuild from raw contract calls. `musd-kit` is that layer:

- **Typed contract clients** with bundled, verified addresses for Mezo mainnet
  (31612) and testnet (31611).
- **The full Trove lifecycle**, `openTrove`, `adjust`, `repay`, `close`, `claim`,
  `refinance`, `redeem`, with the fiddly **insertion-hint computation handled
  automatically**.
- **The MUSD math, correct and tested**, ICR, liquidation price, borrowing power,
  entire-debt (principal + interest + fees + gas reserve), and position health.
- **A wagmi-idiomatic React layer** (`useTrove`, `useOpenTrove`, `useHealthFactor`,
  …) that sits on top of a Passport/wagmi setup.

**Positioning:** *Passport connects the wallet; musd-kit operates MUSD.* Two
non-overlapping libraries that compose.

---

## Why it exists

The MUSD math is subtle exactly where it's dangerous, near the liquidation
threshold. Mezo's own developer guide hands you ~15 lines of raw hint computation
and points you to a test file; a real Mezo dApp (`pikolo`) hand-built a borrowing-
power calculator and a collateral-health monitor. That work is duplicated,
correctness-sensitive, and shipped by no one as a reusable package. `musd-kit`
writes it once, correctly, validated against the real contracts.

**Correctness is the product.** Live position data comes from the contract's own
authoritative getters, and `getTrove` says exactly which of its fourteen fields are
read and which are derived in TypeScript from them (MK-015):

- **Read from getters (9):** `collateral`, `principal`, `interestOwed`, `icr`,
  `nominalICR`, `interestRate`, `status`, `price`, `blockNumber`.
- **Derived (5):** `entireDebt` is `principal + interestOwed`, `isLiquidatable` is
  `icr < MCR`, `exists` is a status check, and `liquidationPrice` and
  `healthFactor` are the two formulas in `math/`.

None of the five re-implements protocol logic; each is a thin function of values
the contract returned in the same call. What the SDK never does is recompute debt
or interest itself.

Client-side math is confined to previews and calculators for positions that do not
exist yet. What validates it, and what that validation does and does not cover, is
stated per surface in
[the validated surface table](https://github.com/cayvox/musd-kit/blob/main/docs/09-review-and-validated-surface.md).
That page is the claim; this paragraph is a pointer to it.

---

## Before you depend on this

Read [`FINDINGS.md`](FINDINGS.md) first: it is the per finding register of every known
correctness gap, each with a stable ID, the ground truth it was checked against, and the decision
taken. [`docs/09-review-and-validated-surface.md`](docs/09-review-and-validated-surface.md) states
which parts of the surface are actually validated and how, and where the SDK diverges from the
protocol or from Mezo's own dApp. [`SECURITY.md`](SECURITY.md) covers maturity, what the SDK does
and does not touch, and how to report a problem. Known gaps are public and tracked rather than
quietly carried, and a correctness report is treated with the same seriousness as a security report.

**Two open findings change what you can rely on at 0.2.0.** Neither is a bug you will hit by
accident; both are limits you have to design around.

- **MK-011, `maxFeePercentage` is advisory only.** The SDK checks it. It does not bind the contract.
  Do not treat it as slippage protection.
- **MK-038, four of eleven writes are ratio gated with no preview.** `addCollateral`, `repay`,
  `withdrawCollateral` and `adjustTrove` have no verdict you can render before the user commits.
  `addCollateral` and `repay` are gated in a way that surprises people: in normal mode a top-up
  that RAISES a position's ICR still reverts if the result is under MCR
  (`BorrowerOperations.sol:1201`), so an already under-water position cannot be partly rescued.

Both are in the register with their evidence, and the second is stated where the API is documented,
in [`docs/03-core-api.md`](docs/03-core-api.md).

Every other S1 and S2 in the register is closed. There is **no open S1**.

---

## Packages

| Package | Status | Description |
|---|---|---|
| `@musd-kit/core` | **published, 0.2.0** | Framework-agnostic (viem): typed clients, addresses, Trove lifecycle, auto-hints, preview math, redemption, typed errors |
| `@musd-kit/react` | **published, 0.2.0** | wagmi-idiomatic hooks over the core |
| `@musd-kit/ui` | planned, not published | Optional headless/styled components |
| `@musd-kit/testing` | planned, not published | MUSD mock + forked-Mezo test helpers |
| `musd-kit-py` | planned, not published | Python SDK for bots/keepers |

**Two packages exist on npm.** The other three are intent, not artifacts, and nothing in this
repository builds them. Upgrading from 0.1.0? Read
[`docs/11-migration-0.1-to-0.2.md`](docs/11-migration-0.1-to-0.2.md) first: 0.1.0 returned wrong
numbers on seven surfaces, three of them in ways nothing in your code would have noticed.

---

## Quick start

```bash
pnpm add @musd-kit/core @musd-kit/react viem@^2 wagmi@^2 @tanstack/react-query@^5 react@^18
```

> The pinned majors match the Passport ecosystem (wagmi 2.x, React 18). In a Passport app
> they're already present, so `pnpm add @musd-kit/core @musd-kit/react` is enough.

```ts
import { createMusdClient, parseBtc, parseMusd } from '@musd-kit/core';

const musd = createMusdClient({ chainId: 31611, publicClient, walletClient });

// Read a live position, every number from the contract's own getters
const trove = await musd.getTrove(address);
console.log(trove.entireDebt, trove.icr, trove.liquidationPrice, trove.healthFactor);

// Preview before signing
const preview = await musd.previewOpen({ collateral: parseBtc('0.05'), debt: parseMusd('2500') });

// Open, hints, fee, and gas reserve handled for you
await musd.openTrove({ collateral: parseBtc('0.05'), debt: parseMusd('2500') });
```

React, alongside Passport:

```tsx
import { useTrove, useOpenTrove } from '@musd-kit/react';

const { data: trove } = useTrove({ address });
const { openTrove, isPending } = useOpenTrove();
```

`@musd-kit/react` needs no provider of its own, it consumes the wagmi context
Passport (or any wagmi setup) already established.

---

## Examples

- **`examples/open-and-manage/`**, a React app: connect (Passport) → preview → open
  → monitor health → repay.
- **`examples/keeper/`**, a headless Node keeper using `@musd-kit/core` only (no
  React), proof the core is framework-agnostic.

---

## Documentation

- [`docs/00-overview.md`](docs/00-overview.md), orientation and document map
- [`docs/01-ground-truth.md`](docs/01-ground-truth.md), the verified contract reference
- [`docs/02-architecture.md`](docs/02-architecture.md), packages and the two-source correctness model
- [`docs/03-core-api.md`](docs/03-core-api.md) · [`docs/04-react-api.md`](docs/04-react-api.md), API surfaces
- [`docs/05-math-and-hints.md`](docs/05-math-and-hints.md), the correctness-critical core
- [`docs/06-errors.md`](docs/06-errors.md) · [`docs/10-glossary.md`](docs/10-glossary.md), the error taxonomy + terms
- [`docs/07-testing.md`](docs/07-testing.md) · [`docs/08-conventions.md`](docs/08-conventions.md), the test gate + engineering standards
- [`docs/09-review-and-validated-surface.md`](docs/09-review-and-validated-surface.md), what is reviewed, what is validated, and where the SDK diverges

The docs site (VitePress) and the generated **API reference** (TypeDoc) build from these:
`pnpm docs:build` produces `docs/.vitepress/dist` (with the API ref at `/api/`). Per-package
quickstarts: [`@musd-kit/core`](packages/core/README.md), [`@musd-kit/react`](packages/react/README.md).

### Running the site locally (landing + docs)

The marketing landing lives in `landing/` (Astro static); the docs are served under `/docs`.

- **`pnpm preview:site`** (repo root): the full, production-identical combined site (landing at `/`,
  docs at `/docs`, API reference at `/docs/api`), built and served with the same clean-URL resolution
  as the deploy. Use this to verify exactly what ships.
- **`cd landing && pnpm dev`**: the landing with hot reload. It also serves the already-built docs
  under `/docs` (static; the landing hot-reloads, the docs do not). If the docs have never been built,
  it builds them once on first start, so Docs and API resolve rather than 404.
- **`cd landing && pnpm dev:site`**: rebuilds the docs fresh, then starts the landing dev server. Use
  this after editing docs content so `/docs` reflects your changes.

An internal link check (`pnpm check:links`, also run by `pnpm build:site` and CI) fails the build on
any broken `/docs` link, so the landing and docs stay in sync.

---

## License

[MIT](LICENSE), the ecosystem standard for TypeScript developer tooling.

Built from production experience shipping **Cark** (Mezo Hackathon MUSD-track
winner), where this client layer was first written by hand.
