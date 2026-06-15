# 10 — Glossary

MUSD / Liquity-fork vocabulary, used precisely and consistently across the codebase
and docs. Where a term has a verified on-chain value, it links to
`01-ground-truth`.

- **MUSD** — Mezo's Bitcoin-backed stablecoin; an ERC-20 (18 decimals). Minted by
  opening a Trove against BTC collateral; redeemable 1:1 for $1 of BTC.

- **Trove** — a single user's collateralized debt position (CDP): BTC collateral
  backing borrowed MUSD. The unit `musd-kit` operates on. (Liquity's name for a
  vault/position.)

- **CDP (Collateralized Debt Position)** — the model: lock collateral, mint a
  stablecoin against it, repay to reclaim the collateral.

- **Collateral** — BTC locked in a Trove, sent as `msg.value` (BTC wei, 1e18).

- **Principal** — the MUSD amount recorded as borrowed on a Trove, excluding
  interest.

- **Net debt** — `draw + borrowing fee`. The fee is added to debt; the borrower
  receives the full draw but owes net debt. The `minNetDebt` floor applies here.
  (`01-ground-truth` §6)

- **Entire (composite) debt** — `net debt + 200 MUSD gas reserve` = principal +
  accrued interest + fees + gas reserve. The denominator of ICR. Read live from
  `getEntireDebtAndColl`.

- **Gas reserve / gas compensation** — `MUSD_GAS_COMPENSATION = 200 MUSD`, added to
  debt at open, returned on close; funds the liquidator's gas. (`01-ground-truth`
  §2)

- **ICR (Individual Collateralization Ratio)** — `(collateral × price) / entire
  debt`, 1e18 fixed point. A Trove with ICR < MCR is liquidatable. Read live via
  `getCurrentICR`.

- **NICR (Nominal ICR)** — `collateral × 1e20 / entire debt` (price-independent),
  used to place a Trove in the sorted list for hints. Contract: `computeNominalCR`.

- **MCR (Minimum Collateralization Ratio)** — `1.1e18` (110%). Liquidation trigger.
  Fixed. (`01-ground-truth` §2)

- **CCR (Critical Collateralization Ratio)** — `1.5e18` (150%). System-wide Recovery
  Mode threshold. Fixed.

- **TCR (Total Collateralization Ratio)** — the whole system's collateral/debt ratio.
  When `TCR < CCR`, the system is in Recovery Mode. Read via `getTCR(price)`.

- **Recovery Mode** — protocol state entered when `TCR < CCR`; borrowing rules
  tighten. Surfaced via `checkRecoveryMode(price)`. (`01-ground-truth` §8)

- **Liquidation price** — the BTC/USD price at which a Trove's ICR falls to MCR.
  Derived: `(MCR × entire debt) / collateral`. Rises as interest accrues.

- **Health factor** — a normalized distance-to-liquidation derived from ICR vs MCR
  (1.0 = at threshold, higher = safer). UI/keeper convenience, a `number`.

- **Liquidation** — permissionless force-close of a Trove with ICR < MCR. Reward:
  200 MUSD (gas pool) + 0.5% of the Trove's BTC (`PERCENT_DIVISOR = 200`).
  `liquidate(borrower)` / `batchLiquidateTroves(addrs[])`.

- **Redemption** — any MUSD holder burning MUSD for $1-of-BTC each, taken from the
  lowest-ICR Troves above 110%. Fee = the current `redemptionRate()`, applied to ALL
  redeemers (the "0% for loan holders" rule was disproven on the fork in Phase 6 — see
  `01-ground-truth.md` §8). Uses `getRedemptionHints`; respects the `minNetDebt`
  floor via `truncatedAmount`.

- **Borrowing power** — the maximum MUSD drawable against given collateral at a price
  while staying above MCR, subject to the `minNetDebt` floor. (`05` §3)

- **Borrowing fee** — a governable fee on the draw, added to debt, minted to the PCV.
  Read via `getBorrowingFee(draw)`. (`01-ground-truth` §3)

- **Refinance** — move a Trove from its locked rate to the current global interest
  rate. `refinance(upperHint, lowerHint)`; fee accounting like borrowing.

- **Insertion hints (`upperHint`, `lowerHint`)** — the adjacent list positions a
  Trove should be inserted between, for gas-efficient maintenance of the
  sorted-by-NICR list. Computed via `getApproxHint` → `findInsertPosition`. (`05`
  §6)

- **SortedTroves** — the on-chain list of Troves ordered by NICR. The reason hints
  exist.

- **HintHelpers** — the contract providing `getApproxHint`, `getRedemptionHints`,
  and the `pure` `computeCR`/`computeNominalCR`.

- **PriceFeed** — the oracle wrapper; `fetchPrice()` returns BTC/USD, 1e18-scaled.

- **InterestRateManager** — manages the global interest rate (`interestRate()`,
  bips) and system interest accrual.

- **PCV (Protocol Controlled Value)** — protocol treasury; receives the borrowing
  fee and a share of interest.

- **Stability Pool** — MUSD deposited to absorb liquidated debt (depositors receive
  the liquidated collateral). Protocol-internal for v1.

- **Passport (`@mezo-org/passport`)** — Mezo's official wallet-connection library
  (RainbowKit/wagmi). Connection only. `musd-kit` sits beside it: *Passport
  connects, musd-kit operates.*

- **`@mezo-org/musd`** — the official repo: the Solidity contracts + Mezo's own dApp
  + docs. The protocol `musd-kit` calls; not `musd-kit`'s territory to reimplement.

- **matsnet** — Mezo's testnet (chainId 31611) deployment label in the repo.

- **bips (basis points)** — 1 bip = 0.01%. Interest and fee rates are in bips
  on-chain (`interestRate()` is `uint16`).
