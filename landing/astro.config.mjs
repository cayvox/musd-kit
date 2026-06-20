import sitemap from '@astrojs/sitemap'
import { defineConfig } from 'astro/config'
import { codeTheme } from './src/lib/code-theme.mjs'

// musdkit.xyz — static landing. The VitePress docs are assembled under /docs at build
// time (see scripts/build-site.sh); the sitemap lists them via customPages.
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
  ],
  build: { inlineStylesheets: 'auto' },
  // Code highlighting: the custom warm theme shared with the VitePress docs (BRAND §7).
  markdown: {
    shikiConfig: { theme: codeTheme },
  },
})
