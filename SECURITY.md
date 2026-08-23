# Security policy

## Maturity, stated plainly

`musd-kit` is an independent, open source SDK. It is not built, endorsed, or operated by Mezo. It is
pre 1.0, it has not been audited, and it is scoped to testnet use and evaluation. Do not put real
money behind it.

Known correctness gaps are public and tracked, with stable IDs, in [`FINDINGS.md`](./FINDINGS.md).
An accurate picture of what is validated and how is in
[`docs/09-review-and-validated-surface.md`](./docs/09-review-and-validated-surface.md).

## What the SDK does and does not touch

The SDK never handles private keys, seed phrases, or secrets of any kind. It signs nothing itself:
it hands a request to a wallet client the integrator supplies. It exposes no token approval flows.
Every write is simulated before it is sent, and the object sent is the simulation's own request, so
the calldata that lands on chain is the calldata that was simulated.

Contract addresses are bundled per chain and can be overridden. An override replaces trusted values,
so treat it as a security relevant action.

## Supported versions

Only the latest published minor version receives fixes. Earlier versions are not patched.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository: Security, then Report a
vulnerability. That channel is preferred over a public issue for anything exploitable.

Please include the affected package and version, the smallest reproduction you can manage, the chain
and block if the behavior is chain dependent, and what you believe the impact is.

Correctness reports are treated with the same seriousness as security reports. A silently wrong
number in a financial SDK is a security problem in every way that matters to a user, even when no
attacker is involved.

## What to expect

We acknowledge reports within three business days and give a first assessment, including a proposed
severity class, within seven. Accepted findings are added to `FINDINGS.md` with a stable ID and a
decision, and that entry is public from the moment it is accepted.

We will not ask you to stay quiet while a finding sits unfixed. If a report is valid and we cannot
fix it quickly, the honest response is to document it as a known limit, publicly, and say so.

There is no bug bounty. We will credit you by name or handle in the register and the release notes
unless you prefer otherwise.

## Out of scope

Findings in the MUSD protocol itself belong to Mezo, not here; please report those to them. Also out
of scope: issues that require a malicious RPC endpoint the integrator chose to trust, and
vulnerabilities in dependencies that have no exploitable path through this SDK, though we still want
to know about them.
