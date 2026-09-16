# React API (`@musd-kit/react`)

Thin hooks over the core, in wagmi's exact idiom. They assume a wagmi context (from
Passport's `getConfig` or any wagmi setup) is already present, `musd-kit` consumes
the provider, it does not supply one (decision O4). Read hooks return
`{ data, isLoading, error }` and refetch on new blocks via TanStack Query; write
hooks return a `writeContract`-style function plus status.

**A read hook shows only the answer to the question it is asking (MK-102).** When its inputs change,
or it is disabled because an input is missing, `data` is `undefined` and `status` is `pending` until
the new question is answered; the previous answer is not kept as a placeholder, and nothing is kept
for a key no hook observes. A refetch of the SAME question on a new block keeps the last answer
visible while it runs. A write hook resets its `data`, `hash` and status when the connected account
or chain changes.

A wagmi developer should recognize every signature on sight. Each hook delegates to
`@musd-kit/core`; the React layer adds only the reactive wrapper.

---

## 1. Reading

```tsx
import { useTrove, useHealthFactor, useBorrowingPower } from '@musd-kit/react';

function Position({ address }: { address: `0x${string}` }) {
  const { data: trove, isLoading } = useTrove({ address });
  if (isLoading) return <Spinner />;
  return (
    <div>
      <p>Debt: {formatMusd(trove.entireDebt)}</p>
      <p>Liquidation price: {formatUsd(trove.liquidationPrice)}</p>
      <HealthBadge factor={trove.healthFactor} />
    </div>
  );
}
```

`useTrove` returns the same contract-authoritative object as `core.getTrove`
(`03-core-api` §2), refetched on new blocks. That object now carries `blockNumber` and
`price`, and every field in it comes from that one block (MK-013), so a component rendering
`icr` next to `price` is showing two numbers from the same state rather than two that
happened to arrive together.

```tsx
// A borrowing-power calculator, no live position needed (preview math)
// Pass `account` whenever you have one (MK-067): the borrowing fee is skipped for a fee exempt
// account, so the maximum is LARGER for such a caller than the figure returned without it.
const { data: power } = useBorrowingPower({ collateral: parseBtc('0.05') });
// `data` is core getBorrowingPower's result, { ceiling, ceilingIcr, isRecoveryMode, price }: the
// contract's limit, to display, never to open at (MK-100, MK-240). `account` defaults to the
// connected wallet (MK-106); pass one to ask about another account.
const { data: sized } = useDrawForMargin({
  collateral: parseBtc('0.05'),
  horizonSeconds, // the user's choice, e.g. from a form; undefined keeps the hook disabled
  priceFallBps,   // the user's choice; there is no default
});
// sized.draw survives sized.margin.priceFallBps over sized.margin.horizonSeconds, and nothing more.
// Each margin is part of the query key, so each is its own cached answer.
```

> **There is no recommended draw (MK-240).** Until 0.5.0 `useBorrowingPower`'s `data` was a bare
> `recommended` figure sized for one hour and a 2% fall, presented as the draw to offer; over 86 days of
> Mezo mainnet prices a fall that large followed within a week of 57.6% of sampled start times. The
> ceiling is a limit to display: in normal mode a Trove opened at it is liquidatable within seconds. A
> draw that survives being held needs a horizon and a fall the user chooses, which is `useDrawForMargin`.
> The table for choosing them is in `03-core-api` and on core `drawForMargin`.

> ⚠️ **`useBorrowingPower` sizes an OPEN, not a top-up.** Its name invites use against a
> Trove that already exists; it does not do that. Every Trove carries a
> `maxBorrowingCapacity`, set at the opening price, lowered on a collateral decrease and
> reset from the current price by a refinance (MK-101), and a debt increase is gated on it
> (`BorrowerOperations.sol:1358-1365`). For an existing
> position use `useBorrowPreview` or `useBorrowingCapacity` (MK-002).

```tsx
import { useBorrowPreview, useBorrowingCapacity } from '@musd-kit/react';

const { data: capacity } = useBorrowingCapacity({ owner: address });
// { capacity, entireDebt, remaining }. `remaining` is headroom for draw + fee.

const { data: preview } = useBorrowPreview({ owner: address, amount: parseMusd('5000') });
if (preview && !preview.viable) {
  // preview.bindingConstraint: 'EXCEEDS_BORROWING_CAPACITY' | 'ICR_BELOW_THRESHOLD' | ...
}

const { data: refi } = useRefinancePreview({ owner: address });
// refi.fee is charged and capitalized into principal; refi.viable is false in Recovery Mode.
```

---

## 2. Writing

```tsx
import { useOpenTrove } from '@musd-kit/react';

function OpenForm() {
  const { openTrove, isPending, error } = useOpenTrove();
  return (
    <button
      disabled={isPending}
      onClick={() => openTrove({ collateral: parseBtc('0.05'), debt: parseMusd('2500') })}
    >
      {isPending ? 'Opening…' : 'Open Trove'}
    </button>
  );
}
```

Each write hook handles hint computation and the protocol mechanics through the
core; the React layer adds only the reactive wrapper.

---

## 3. The v1 hook set (as shipped, Phase 8)

**Read (15):** `useTrove`, `useBorrowingPower`, `useDrawForMargin`, `useBorrowPreview`, `useBorrowingCapacity`,
`useRefinancePreview`, `useLiquidationPrice`, `useHealthFactor`, `useMusdBalance`,
`useOraclePrice`, `useAdjustTrovePreview`, `useWithdrawCollateralPreview`,
`useMaxWithdrawableCollateral`, `useClosePreview`, `useRedeemPreview`.

> **This list said nine for two waves while the package exported fourteen** (MK-085). The five
> preview hooks from the MK-042 and MK-048 waves were exported from `packages/react/src/index.ts`
> and absent from here, which is part of why nobody exercised `useAdjustTrovePreview` and did not
> notice it refused every adjustment that was not a borrow. The count is in the heading now so a
> stale list is visible rather than merely incomplete.

**An omitted leg means "no such leg", and that is not the same as zero** (MK-085, MK-060).
`useAdjustTrovePreview` takes four optional legs and forwards only the ones you pass.
`_adjustTrove` takes `_isDebtIncrease` as a parameter independent of `_mUSDChange`
(`BorrowerOperations.sol:757-758`) and refuses `(0, true)` at `:785-787`, so
`{ owner, addCollateral }` is an ordinary top-up while `{ owner, addCollateral, increaseDebt: 0n }`
is a debt increase of zero and is correctly refused. Do not fill the legs you are not using.

`useHealthFactor` and `useLiquidationPrice` are selectors over the **same** `useTrove`
query (shared key + `select`), three hooks for one address dedupe to a single fetch. All
read hooks refetch on new blocks (`useBlockNumber({ watch })` → invalidate).

> **`useMusdPeg` is deferred.** The core `getPeg` is unimplemented, Mezo exposes no
> MUSD/USD oracle. Shipping a hook that returns a guessed
> peg would violate the prime directive, so it is **omitted from v1** and will land if/when
> a peg oracle exists.

**Write (1:1 with the core write methods):** `useOpenTrove`, `useAddCollateral`,
`useBorrow`, `useRepay`, `useWithdrawCollateral`, `useAdjustTrove`, `useCloseTrove`,
`useClaimCollateral`, `useRefinance`, `useRedeem`.

We ship the **dedicated single-axis hooks** (`useAddCollateral` → `addColl`, `useBorrow` →
`withdrawMUSD`, `useRepay`, `useWithdrawCollateral`) alongside `useAdjustTrove`, they read
better in a form-per-action UI and each maps to exactly one core method. Each write hook is
a `useMutation` returning the wagmi-style shape `{ <action>, isPending, isSuccess, error,
hash, data }` where `error` is the core's typed `MusdError`; `useRedeem`'s `data` carries
`{ hash, settled, estimatedBeforeSend, redemptionRate, gas, partial }`. After a successful write the caller's `useTrove` /
`useMusdBalance` queries are invalidated so the UI refreshes. Receipt-waiting is left to the
consumer (`useWaitForTransactionReceipt({ hash })`) for every write **except `useRedeem`**, which stays
pending until the redemption mines, because what it redeemed is only known from its receipt (MK-241).

---

## 4. The Passport relationship, concretely

A typical app wires Passport for connection and `musd-kit` for MUSD, side by side:

```tsx
// Passport provides the wagmi config and connection (Mezo's official path)
<WagmiProvider config={getConfig({ appName: 'My MUSD dApp' })}>
  <QueryClientProvider client={queryClient}>
    <RainbowKitProvider initialChain={mezoTestnet}>
      {/* musd-kit hooks work inside this context, no extra provider needed */}
      <YourApp />
    </RainbowKitProvider>
  </QueryClientProvider>
</WagmiProvider>
```

`@musd-kit/react` needs no provider of its own; it reads the wagmi context Passport
already established. The developer uses Passport for what it is good at and
`musd-kit` for what is missing, with zero integration friction.

---

## 5. Peer dependencies (verified, `02-architecture` §4)

Match Passport's own ranges so both resolve to single singletons in a consumer app:

```
wagmi                 ^2.5.12
viem                  ^2.22.8
@tanstack/react-query ^5.28.4
react                 ^18.2.0      // target React 18; widen to ^19 only after testing with Passport
```

`@musd-kit/react` peer-depends on **wagmi, not Passport**, keeping it usable with
any wagmi connection layer.

---

## 6. The one noted risk (stated openly)

The React hooks carry a "medium" collision risk: Passport is React/wagmi and could,
in principle, gain MUSD-specific hooks that overlap this layer. They stay in v1 (a
client SDK without hooks feels half-done), but the hedge is structural, the durable
value is the framework-agnostic core (`math/`, `hints/`, the typed reads), which is
exactly what *any* hooks (Passport's or ours) would have to call. If Passport ever
ships MUSD hooks, the core remains the correct, tested implementation of the hard
parts. This is stated in the docs.
