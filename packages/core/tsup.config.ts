import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  treeshake: true,
  sourcemap: true,
  clean: true,
  // viem is a peer dependency, never bundle it.
  external: ['viem'],
})
