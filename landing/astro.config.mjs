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
  // Code highlighting: the custom warm theme shared with the VitePress docs (BRAND §7).
  markdown: {
    shikiConfig: { theme: codeTheme },
  },
})
