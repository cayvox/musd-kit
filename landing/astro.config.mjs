import sitemap from '@astrojs/sitemap'
import { defineConfig } from 'astro/config'
import { docsDev } from './integrations/docs-dev.mjs'
import { codeTheme } from './src/lib/code-theme.mjs'

// musdkit.xyz, the static landing. The VitePress docs are assembled under /docs at build
// time (see scripts/build-site.sh); the sitemap lists them via customPages. In dev, the
// docsDev integration serves the built docs under /docs so `pnpm dev` matches production.
export default defineConfig({
  site: 'https://musdkit.xyz',
  trailingSlash: 'ignore',
  integrations: [
    sitemap({
      customPages: [
        'https://musdkit.xyz/docs/',
        'https://musdkit.xyz/docs/03-core-api',
        'https://musdkit.xyz/docs/04-react-api',
        'https://musdkit.xyz/docs/api/',
      ],
    }),
    docsDev(),
  ],
  build: { inlineStylesheets: 'auto' },
  // The live widget lazy-imports the SDK (@musd-kit/core), viem and @mezo-org/chains. In dev,
  // Vite re-optimizes these heavy deps on the first dynamic import and the in-flight dep chunks
  // 504, so the import rejects and the widget falls back instead of reading live. Pre-bundling
  // them at server start makes the dynamic import resolve, so `pnpm dev` reads real testnet too.
  vite: {
    optimizeDeps: {
      include: ['@musd-kit/core', '@mezo-org/chains', 'viem'],
    },
  },
  // Code highlighting: the custom warm theme shared with the VitePress docs.
  markdown: {
    shikiConfig: { theme: codeTheme },
  },
})
