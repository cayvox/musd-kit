import {
  BelowMinimumDebt,
  ICRBelowMCR,
  InsufficientMusdBalance,
  MaxFeeExceeded,
  MissingWalletClient,
  MusdError,
  RecoveryModeRestriction,
  RepayExceedsDebt,
  useBorrowingPower,
  useHealthFactor,
  useLiquidationPrice,
  useOpenTrove,
  useOraclePrice,
  useRepay,
  useTrove,
} from '@musd-kit/react'
import { type ReactNode, useState } from 'react'
import type { Address } from 'viem'
import { useAccount } from 'wagmi'
import { usePreviewOpen, useSystemState } from './app-hooks'
import { fmt, parse18, pct } from './format'

/** Turn any error coming out of a hook into a readable, branchable message (typed errors). */
function describeError(error: unknown): string | null {
  if (!error) return null
  if (error instanceof BelowMinimumDebt)
    return `Below the minimum: net debt must be ≥ ${fmt(error.context?.minNetDebt as bigint)} MUSD.`
  if (error instanceof ICRBelowMCR)
    return 'This would leave the Trove below the 110% minimum collateral ratio (MCR).'
  if (error instanceof RecoveryModeRestriction)
    return 'The system is in Recovery Mode; this operation must keep ICR ≥ 150% (CCR).'
  if (error instanceof MaxFeeExceeded) return 'The borrowing fee exceeded your cap.'
  if (error instanceof RepayExceedsDebt) return 'Repay amount exceeds the outstanding debt.'
  if (error instanceof InsufficientMusdBalance) return 'Not enough MUSD held for this operation.'
  if (error instanceof MissingWalletClient) return 'Connect a wallet first.'
  if (error instanceof MusdError) return error.message
  return (error as Error)?.message ?? String(error)
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
      <span style={{ color: '#666' }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{children}</span>
    </div>
  )
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ border: '1px solid #ddd', borderRadius: 10, padding: 16, marginBottom: 16 }}>
      <h2 style={{ fontSize: 16, margin: '0 0 12px' }}>{title}</h2>
      {children}
    </section>
  )
}

function ErrorNote({ error }: { error: unknown }) {
  const msg = describeError(error)
  if (!msg) return null
  return (
    <p role="alert" style={{ color: '#b00020', fontSize: 13, marginTop: 8 }}>
      {msg}
    </p>
  )
}

function SystemBar() {
  const { data: price } = useOraclePrice()
  const { data: system } = useSystemState()
  return (
    <div style={{ fontSize: 13, color: '#555', marginBottom: 16 }}>
      BTC/USD <strong>${fmt(price, 0)}</strong> ·{' '}
      {system?.isRecoveryMode ? (
        <strong style={{ color: '#b00020' }}>Recovery Mode</strong>
      ) : (
        'Normal mode'
      )}
    </div>
  )
}

function OpenCard() {
  const [coll, setColl] = useState('0.05')
  const [debt, setDebt] = useState('2500')
  const collateral = parse18(coll)
  const draw = parse18(debt)

  const { data: maxBorrowable } = useBorrowingPower({ collateral })
  const { data: preview } = usePreviewOpen(collateral, draw)
  const { openTrove, isPending, error, hash } = useOpenTrove()

  // `viable` replaced `meetsRecoveryRequirement` (MK-005) and already covers the debt floor,
  // the mode correct ICR threshold and the projected system TCR, so it subsumes both of the
  // flags this used to combine.
  const canOpen = Boolean(preview?.viable && !isPending)

  return (
    <Card title="Open a Trove">
      <label style={{ display: 'block', marginBottom: 8 }}>
        Collateral (BTC)
        <input value={coll} onChange={(e) => setColl(e.target.value)} style={{ width: '100%' }} />
      </label>
      <label style={{ display: 'block', marginBottom: 8 }}>
        Borrow (MUSD)
        <input value={debt} onChange={(e) => setDebt(e.target.value)} style={{ width: '100%' }} />
      </label>

      <Row label="Borrowing power">{fmt(maxBorrowable)} MUSD</Row>
      <Row label="Borrowing fee">{fmt(preview?.fee)} MUSD</Row>
      <Row label="Total debt (incl. 200 reserve)">{fmt(preview?.entireDebt)} MUSD</Row>
      <Row label="Resulting ICR">{pct(preview?.icr)}</Row>
      <Row label="Liquidation price">${fmt(preview?.liquidationPrice, 0)}</Row>
      <Row label="Meets minimum debt">{preview ? (preview.meetsMinimum ? 'yes' : 'no') : ', '}</Row>

      <button
        type="button"
        disabled={!canOpen || !collateral || !draw}
        onClick={() =>
          collateral && draw && openTrove({ collateral, debt: draw, maxFeePercentage: 10n ** 16n })
        }
        style={{ marginTop: 12, width: '100%', padding: 8 }}
      >
        {isPending ? 'Opening…' : 'Open Trove'}
      </button>
      {hash && <p style={{ fontSize: 12, color: '#0a0' }}>Sent: {hash.slice(0, 14)}…</p>}
      <ErrorNote error={error} />
    </Card>
  )
}

function PositionCard({ address }: { address: Address }) {
  const { data: trove, isLoading } = useTrove({ address })
  const { data: health } = useHealthFactor({ address })
  const { data: liqPrice } = useLiquidationPrice({ address })
  const [amount, setAmount] = useState('100')
  const { repay, isPending, error } = useRepay()

  if (isLoading) return <Card title="Your position">Loading…</Card>
  if (!trove?.exists) return <Card title="Your position">No open Trove yet.</Card>

  const repayAmount = parse18(amount)
  return (
    <Card title="Your position">
      <Row label="Collateral">{fmt(trove.collateral)} BTC</Row>
      <Row label="Entire debt">{fmt(trove.entireDebt)} MUSD</Row>
      <Row label="ICR">{pct(trove.icr)}</Row>
      <Row label="Health factor">
        <strong style={{ color: (health ?? 0) < 1.1 ? '#b00020' : '#0a0' }}>
          {health?.toFixed(3) ?? ', '}
        </strong>
      </Row>
      <Row label="Liquidation price">${fmt(liqPrice, 0)}</Row>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} style={{ flex: 1 }} />
        <button
          type="button"
          disabled={isPending || !repayAmount}
          onClick={() => repayAmount && repay({ amount: repayAmount })}
        >
          {isPending ? 'Repaying…' : 'Repay MUSD'}
        </button>
      </div>
      <ErrorNote error={error} />
    </Card>
  )
}

export function App() {
  const { address, isConnected } = useAccount()

  return (
    <main style={{ maxWidth: 460, margin: '24px auto', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ marginBottom: 12 }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>musd-kit · open & manage</h1>
        <p style={{ fontSize: 12, color: '#888', margin: '4px 0 0' }}>
          Passport connects the wallet; musd-kit operates MUSD. (No musd-kit provider, the hooks
          consume Passport's wagmi context.)
        </p>
      </header>

      {!isConnected || !address ? (
        <Card title="Connect">Connect your wallet (top-right) to begin.</Card>
      ) : (
        <>
          <SystemBar />
          <OpenCard />
          <PositionCard address={address} />
        </>
      )}

      <footer style={{ fontSize: 11, color: '#aaa', marginTop: 24, textAlign: 'center' }}>
        Community tooling for Mezo testnet / evaluation, not audited, not financial advice.
      </footer>
    </main>
  )
}
