import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Reference app, Vite + React 18. The musd-kit hooks run on Passport's wagmi context.
export default defineConfig({ plugins: [react()] })
