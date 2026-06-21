---
layout: home

hero:
  name: musd-kit
  text: The typed SDK for MUSD on Mezo
  tagline: The layer between connected and working, the Trove lifecycle, the insertion-hint dance, and the MUSD math, made correct, typed, and reusable.
  actions:
    - theme: brand
      text: Get started
      link: /00-overview
    - theme: alt
      text: API Reference ↗
      link: /api/
      target: _blank
      rel: noreferrer
    - theme: alt
      text: GitHub
      link: https://github.com/cayvox/musd-kit

features:
  - title: Correct by construction
    details: Live position data is read from the contract's own getters (never recomputed client-side); previews are dual-validated against forked Mezo and the contract's pure helpers.
  - title: Framework-agnostic core + React hooks
    details: "@musd-kit/core has no UI runtime; @musd-kit/react adds wagmi-idiomatic hooks that consume Passport's context, no provider of its own."
  - title: Typed errors
    details: Every protocol revert maps to a discriminated MusdError you can branch on, BelowMinimumDebt, ICRBelowMCR, RecoveryModeRestriction, and more.
---

> ⚠️ **Community tooling, not official.** `musd-kit` is independent, open-source, and **not
> affiliated with or endorsed by Mezo**. An unofficial community **Mezo MUSD SDK**.
> **Status: pre-1.0, for testnet and evaluation.** License: MIT.

**Passport connects the wallet; musd-kit operates MUSD.** Mezo ships
[`@mezo-org/passport`](https://www.npmjs.com/package/@mezo-org/passport) for connecting a
wallet; `musd-kit` is the layer in between, how an app opens a Trove, reads a position's
health, computes borrowing power, and manages a loan.

```sh
npm install @musd-kit/core viem
# React (pinned to the Passport ecosystem, wagmi 2.x / React 18):
npm install @musd-kit/react wagmi@^2 @tanstack/react-query@^5 react@^18
```
