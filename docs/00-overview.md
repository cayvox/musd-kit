# 00 — Overview

`musd-kit` is an open-source, typed TypeScript client SDK for **MUSD**, Mezo's
Bitcoin-backed stablecoin. It sits between *connected* (handled by
`@mezo-org/passport`) and *working*: the Trove lifecycle, the insertion-hint dance,
and the MUSD math — made correct, typed, and reusable, so every MUSD app stops
re-deriving them.

**Positioning, in one line:** *Passport connects the wallet; musd-kit operates
MUSD.* Two non-overlapping libraries that compose — one official (connection), one
community (interaction).

---

## How the documentation fits together

| Document | Role | Read it for |
|---|---|---|
| `musd-kit-handbook.md` | The **specification** — the *why* and the *what* | Motivation, the gap analysis, scope (v1/v2/out), positioning, grant framing |
| `musd-kit-Roadmap.md` | The **build plan** — the *how* — plus the zero-assumption verification ledger | The phased build order, acceptance criteria, the corrections to the handbook |
| `CLAUDE.md` | The **operating manual** for the build | The Laws, the workflow, the gotchas — read before coding |
| `docs/01-ground-truth.md` | The **verified contract reference** | Every constant, signature, address, and formula — the anti-assumption source |
| `docs/02-architecture.md` | Structure | The package graph, the two-source correctness model, module responsibilities |
| `docs/03-core-api.md` | `@musd-kit/core` surface | The framework-agnostic API |
| `docs/04-react-api.md` | `@musd-kit/react` surface | The hook set + the Passport relationship |
| `docs/05-math-and-hints.md` | Correctness-critical deep spec | The exact formulas, the hint ritual, the dual-validation method |
| `docs/06-errors.md` | Error taxonomy | The discriminated error set + revert mapping |
| `docs/07-testing.md` | Correctness gate | The forked-Mezo harness, the test gates, the boundary corpus |
| `docs/08-conventions.md` | Engineering standards | TS config, naming, units, viem patterns, release hygiene |
| `docs/09-open-questions.md` | Decision log | Resolved decisions (O1–O7) and still-open items (F1/F3) |
| `docs/10-glossary.md` | Terms | MUSD / Liquity-fork vocabulary used precisely |

**Reading order for a fresh start:** Handbook (skim for the *why*) → this overview →
`01-ground-truth` (carefully) → `02-architecture` → `CLAUDE.md` → then the spec for
whatever you're building, with `07-testing` and `08-conventions` open alongside.

---

## The two ideas everything rests on

1. **Correctness is the product.** The reason to use `musd-kit` over hand-writing
   contract calls is that the numbers are *right*, near the liquidation threshold
   where being wrong is most dangerous. This drives the testing strategy (validate
   against forked Mezo, not just the documented formula) and the architecture.

2. **Zero assumptions.** Every contract fact was verified against the live source on
   14 Jun 2026 (`01-ground-truth`). Where the verification contradicted the
   handbook, the build follows the verified truth, and the delta is recorded (the
   C-corrections in `01-ground-truth` §9 and the Roadmap §1.2). When the build needs
   a fact that is not yet verified, the rule is to verify it, not guess.

---

## Verification provenance

The ground truth was established against the MUSD contracts at `mezo-org/musd`
(`main`), the committed deployment artifacts (addresses), `docs/simpleInterest.md`
(interest model), `@mezo-org/passport@0.17.2` on npm (peer ranges), and the Mezo
docs + chain registries (chain IDs, token addresses). See `01-ground-truth` for the
full ledger and the re-verification policy.
