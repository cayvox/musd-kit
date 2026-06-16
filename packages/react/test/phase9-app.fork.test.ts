import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { connect } from '@wagmi/core'
import { createElement } from 'react'
import { privateKeyToAccount } from 'viem/accounts'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from '../../../examples/open-and-manage/src/App'
import { connectFork } from '../../core/test/harness'
import { makeConfig, makeWrapper, newQueryClient } from './wagmi'

// anvil's unlocked default account[0] — the address the mock connector signs as (Phase 8).
const ANVIL_0 = privateKeyToAccount(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
)

afterEach(() => cleanup())

describe('Phase 9 — examples/open-and-manage (smoke render)', () => {
  it('mounts inside the (fork-backed) wagmi provider stack and a useTrove-driven render resolves', async () => {
    const rpcUrl = connectFork().rpcUrl
    const config = makeConfig(rpcUrl, [ANVIL_0.address])
    await connect(config, { connector: config.connectors[0]! })
    const wrapper = makeWrapper(config, newQueryClient())

    render(createElement(App), { wrapper })

    // Mounted without crashing — the header renders.
    expect(screen.getByText(/open & manage/i)).toBeTruthy()

    // Connected → the dashboard cards render; the position card is driven by `useTrove`,
    // which must resolve (no longer "Loading…") for the connected address.
    await waitFor(() => expect(screen.queryByText('Your position')).not.toBeNull(), {
      timeout: 30_000,
    })
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull(), { timeout: 30_000 })

    // And the preview hook (useBorrowingPower) rendered its row.
    expect(screen.getByText('Borrowing power')).toBeTruthy()
  }, 60_000)
})
