// Real connection layer: Passport supplies the wagmi config + RainbowKit connect UI; the
// @musd-kit/react hooks work inside this context with NO provider of their own (the whole
// point — decision O4). chain = Mezo testnet (31611).
import { mezoTestnet } from '@mezo-org/chains'
import { getConfig } from '@mezo-org/passport'
import { ConnectButton, RainbowKitProvider } from '@rainbow-me/rainbowkit'
import '@rainbow-me/rainbowkit/styles.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WagmiProvider } from 'wagmi'
import { App } from './App'

// A WalletConnect project id is required by Passport's getConfig. Supply your own via
// VITE_WALLETCONNECT_PROJECT_ID; the placeholder lets the app build/run for evaluation.
const config = getConfig({
  appName: 'musd-kit · open & manage',
  mezoNetwork: 'testnet',
  walletConnectProjectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? 'musd-kit-demo',
})
const queryClient = new QueryClient()

const root = document.getElementById('root')
if (!root) throw new Error('missing #root')

createRoot(root).render(
  <StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider initialChain={mezoTestnet}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 12 }}>
            <ConnectButton />
          </div>
          <App />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
)
