# Overview

`musd-kit` is an open-source, typed TypeScript client SDK for **MUSD**, Mezo's
Bitcoin-backed stablecoin. It sits between *connected* (handled by
`@mezo-org/passport`) and *working*: the Trove lifecycle, the insertion-hint dance,
and the MUSD math, made correct, typed, and reusable, so every MUSD app stops
re-deriving them.

**Positioning, in one line:** *Passport connects the wallet; musd-kit operates
MUSD.* Two non-overlapping libraries that compose, one official (connection), one
community (interaction).

---

## How the documentation fits together

| Guide | Read it for |
|---|---|
| [Architecture](/02-architecture) | The package graph, the two-source correctness model, module responsibilities |
| [Reads, previews, and the Trove lifecycle](/03-core-api) | The framework-agnostic `@musd-kit/core` surface |
| [React hooks](/04-react-api) | The hook set and the Passport relationship |
| [Math and insertion hints](/05-math-and-hints) | The exact formulas, the hint ritual, and how the math is validated |
| [Typed errors](/06-errors) | The discriminated error set and the revert mapping |
| [Ground truth](/01-ground-truth) | Every verified constant, signature, address, and formula, the anti-assumption source |
| [Testing](/07-testing) | The forked-Mezo harness, the test gates, the boundary corpus |
| [Conventions](/08-conventions) | TS config, naming, units, viem patterns, release hygiene |
| [Review and validated surface](/09-review-and-validated-surface) | What has been independently reviewed, what is actually validated and how, and where the SDK diverges from the protocol |
| [Migration, 0.1 to 0.2](/11-migration-0.1-to-0.2) | **Read this if you have 0.1.0 in production.** Every breaking change with before and after code, plus which 0.1.0 behaviours return wrong numbers and which fail transactions |
| [Release runbook](/12-release-runbook) | The ordered steps to publish, verify, deprecate and deploy, and what npm does and does not allow when a release is wrong |
| [Glossary](/10-glossary) | MUSD and Liquity-fork vocabulary, used precisely |

**Reading order for a fresh start:** this overview, then [Ground truth](/01-ground-truth)
carefully, then [Architecture](/02-architecture), then the guide for whatever you are building,
with [Testing](/07-testing) and [Conventions](/08-conventions) open alongside.

---

## The two ideas everything rests on

1. **Correctness is the product.** The reason to use `musd-kit` over hand-writing
   contract calls is that the numbers are *right*, near the liquidation threshold
   where being wrong is most dangerous. This drives the testing strategy (validate
   against forked Mezo, not just the documented formula) and the architecture.

2. **Zero assumptions.** Every contract fact was verified against the live source on
   14 Jun 2026 (see [Ground truth](/01-ground-truth)). Where the verification
   contradicted an earlier assumption, the build follows the verified truth, and the
   delta is recorded (the C-corrections in [Ground truth](/01-ground-truth) §9). When the
   build needs a fact that is not yet verified, the rule is to verify it, not guess.

---

## Verification provenance

The ground truth was established against the MUSD contracts at `mezo-org/musd`
(`main`), the committed deployment artifacts (addresses), `docs/simpleInterest.md`
(interest model), `@mezo-org/passport@0.17.2` on npm (peer ranges), and the Mezo
docs + chain registries (chain IDs, token addresses). See `01-ground-truth` for the
full ledger and the re-verification policy.
