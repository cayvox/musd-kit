# Architecture

## 1. The layered picture

```
        @mezo-org/passport                 @musd-kit/react   (v1)
        (connection, Mezo's official)     wagmi-idiomatic hooks, TanStack Query
        wallet, session, wagmi config            │ calls
                │ provides connected               ▼
                │ wagmi/viem client      ┌────────────────────────────────────┐
                └───────────────────────►│  @musd-kit/core   (v1)              │
                                         │  clients/    typed viem clients     │
                                         │  addresses/  31611 / 31612 (+override)
                                         │  read/       getTrove via CONTRACT getters
                                         │  math/       PREVIEW-only, dual-validated
                                         │  hints/      getApproxHint + findInsertPosition
                                         │  trove/      lifecycle writes → real ABI
                                         │  redemption/ redeem + getRedemptionHints + fee
                                         │  errors/     discriminated revert mapping
                                         └───────────────────┬──────────────────┘
                                                             │ viem calls
                                                             ▼
                                          MUSD CONTRACTS (mezo-org/musd, the protocol)
                                          BorrowerOperations · TroveManager · SortedTroves ·
                                          HintHelpers · PriceFeed · InterestRateManager · MUSD
```

`@musd-kit/core` is the brain; `@musd-kit/react` is a thin reactive layer over it;
Passport sits *beside* `musd-kit`, providing the connected client. The two do not
overlap. The contracts are Mezo's.

---

## 2. The two-source correctness model (the central design rule)

This is the most important architectural decision, and it follows directly from the
verification (`01-ground-truth` C8): the protocol already exposes authoritative
getters, so the SDK does not re-derive what the chain will tell it.

| Concern | Source | Where in the code | Why |
|---|---|---|---|
| **Live position** (an existing Trove) | the contract's own getters | `read/` | `getEntireDebtAndColl`, `getCurrentICR`, `getTroveInterestOwed`, `getTCR`, `checkRecoveryMode`, `fetchPrice` are authoritative; reading them removes interest-drift risk entirely |
| **Preview** (a position that doesn't exist yet) | client-side math | `math/` | There is no on-chain object to read for a hypothetical position; this is the *only* place the SDK computes |

`read/` and `math/` are deliberately **separate modules**. A live `getTrove`
**never** calls `math/` for its core numbers, it reads the contract. `previewOpen`
and `getBorrowingPower` live in `math/` and are validated twice (against forked-Mezo
behavior and against the contract's `pure` helpers `computeCR`/`computeNominalCR`/
`getBorrowingFee`). See `05-math-and-hints` for the method.

This relocates the correctness risk to exactly one bounded place (preview math),
where the dual-validation gate proves it, instead of spreading re-derivation
across every read.

---

## 3. Module responsibilities (`@musd-kit/core`)

| Module | Owns | Key surface |
|---|---|---|
| `clients/` | typed viem contract instances from bundled ABIs | internal, consumed by every other module |
| `addresses/` | per-network address maps (31611/31612) + override | resolve-by-chainId; values from `01-ground-truth` §4 |
| `read/` | **live** position + system reads (contract-authoritative) | `getTrove`, `getSystemState`, `isLiquidatable`, balances, peg, price |
| `math/` | **preview** compute only, dual-validated | `previewOpen`, `getBorrowingPower`, `computeICR`, `computeLiquidationPrice`, `computeEntireDebt`, `getHealthFactor` |
| `hints/` | the insertion-hint ritual | `computeHints({ collateral, entireDebt })` → `{ upperHint, lowerHint }` |
| `trove/` | lifecycle writes, mapped to the real ABI | `openTrove`, `addCollateral`, `borrow`, `repay`, `withdrawCollateral`, `adjustTrove`, `close`, `claim`, `refinance` |
| `redemption/` | redemption + the permissionless keeper surface | `redeem`, `isLiquidatable`, `liquidate`, `batchLiquidate` |
| `errors/` | revert → discriminated error mapping | the typed error set + decoder |

`createMusdClient({ chainId, publicClient, walletClient })` is the entry point: it
resolves addresses, builds the typed clients, and reads + caches the governable
constants on first use.

---

## 4. Packages and dependencies

| Package | Version | Depends on | Role |
|---|---|---|---|
| `@musd-kit/core` | v1 | `viem` (peer) | typed clients, addresses, reads, preview math, hints, lifecycle, redemption, errors, framework-agnostic |
| `@musd-kit/react` | v1 | peer: `wagmi`, `viem`, `@tanstack/react-query`, `react`; dep: `@musd-kit/core` | wagmi-idiomatic hooks over core |
| `@musd-kit/ui` | v2 | `react`, `@musd-kit/core` | optional headless/styled components |
| `@musd-kit/testing` | v2 | `@musd-kit/core` | MUSD mock + forked-Mezo test helpers (as a public package) |
| `musd-kit-py` | v2 | n/a | Python SDK for bots/keepers |

### Peer-dependency alignment (verified, not guessed)

`@musd-kit/react` peer ranges match `@mezo-org/passport@0.17.2`'s own
`peerDependencies` so the two resolve to one set of singletons in a consumer app:

```
wagmi                 ^2.5.12
viem                  ^2.22.8
@tanstack/react-query ^5.28.4
react                 ^18.2.0      // target React 18; add ^19 only after testing with Passport
```

`@musd-kit/react` provides **no provider of its own**, it consumes the wagmi
context Passport (or any wagmi setup) already established. It peer-depends on
**wagmi, not Passport** (decision O4), keeping it usable with any connection layer.

---

## 5. Why MIT

A client SDK is maximally adoption-driven; MIT is the ecosystem standard for
TypeScript developer tooling (viem, wagmi) and removes friction for integrators. A
thin client wrapper over an existing protocol has no novel-mechanism surface to
protect (unlike a contract-side primitive, which might choose Apache-2.0 for its
patent grant). Final choice confirmed at repo creation; name is provisional pending
a trademark/availability check (see `09-open-questions` / Handbook §11.4).

---

## 6. Framework-agnostic core, proven by the keeper example

The core has **no React import**. The two examples prove it: `open-and-manage` (React
app) and `keeper` (headless Node, core only). The keeper compiling without React is
the structural proof that the intelligence lives in the core and the framework
layers are adapters, so a future Vue/Svelte layer is additive, never a rewrite.
