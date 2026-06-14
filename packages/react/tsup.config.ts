import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  treeshake: true,
  sourcemap: true,
  clean: true,
  // Everything below is provided by the host app; never bundle.
  external: ['react', 'viem', 'wagmi', '@tanstack/react-query', '@musd-kit/core'],
})
