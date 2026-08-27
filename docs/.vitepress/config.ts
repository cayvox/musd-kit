import { defineConfig } from 'vitepress'
// The same warm Shiki theme the landing uses, so code reads as one brand.
import { codeTheme } from '../../landing/src/lib/code-theme.mjs'

// VitePress wrapper over the existing docs/*.md + the generated TypeDoc API ref (served from
// public/api). The brand theme lives in .vitepress/theme. `DOCS_BASE=/docs/` serves the docs
// under the landing's /docs subdirectory in the combined deploy; unset, it builds at '/'.
//
// cleanUrls: true makes internal links extensionless (/03-core-api, not /03-core-api.html),
// matching the landing's deep links and the Cloudflare Pages / Vercel deploy target. The combined
// build + scripts/check-links.mjs verify every internal link resolves.
export default defineConfig({
  title: 'musd-kit',
  description: "The typed TypeScript SDK for MUSD, Mezo's Bitcoin-backed stablecoin.",
  base: process.env.DOCS_BASE || '/',
  cleanUrls: true,
  appearance: false, // light only, to match the brand (no dark canvas)
  lastUpdated: true,
  // Cross-references to repo-relative paths are intentional; the build link-check covers routes.
  ignoreDeadLinks: true,
  head: [
    // head hrefs are not base-rewritten by VitePress, so prefix the base explicitly.
    [
      'link',
      { rel: 'icon', type: 'image/svg+xml', href: `${process.env.DOCS_BASE || '/'}logo.svg` },
    ],
    ['meta', { name: 'theme-color', content: '#FBF8F5' }],
  ],
  markdown: {
    theme: { light: codeTheme, dark: codeTheme },
  },
  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'musd-kit',
    nav: [
      { text: 'Guides', link: '/00-overview', activeMatch: '/(0[0-9]|10)-' },
      // The API reference is a static TypeDoc subsite under the VitePress base, so it must be a
      // real browser navigation (target), not a client-side route, or VitePress renders its 404.
      // target links get VitePress's external-link arrow automatically, so the text carries none.
      { text: 'API', link: '/api/', target: '_blank', rel: 'noreferrer' },
      { text: 'npm', link: 'https://www.npmjs.com/package/@musd-kit/core' },
      // External link: VitePress adds its own external arrow, so the text carries none.
      { text: 'musdkit.xyz', link: 'https://musdkit.xyz/' },
    ],
    sidebar: [
      {
        text: 'Get started',
        items: [
          { text: 'Introduction', link: '/00-overview' },
          { text: 'Architecture', link: '/02-architecture' },
        ],
      },
      {
        text: 'Guides',
        items: [
          { text: 'Reads, previews, and the Trove lifecycle', link: '/03-core-api' },
          { text: 'React hooks', link: '/04-react-api' },
          { text: 'Math and insertion hints', link: '/05-math-and-hints' },
          { text: 'Typed errors', link: '/06-errors' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Ground truth (verified facts)', link: '/01-ground-truth' },
          { text: 'API reference', link: '/api/', target: '_blank', rel: 'noreferrer' },
          { text: 'Testing', link: '/07-testing' },
          { text: 'Conventions', link: '/08-conventions' },
          { text: 'Review and validated surface', link: '/09-review-and-validated-surface' },
          { text: 'Migration, 0.1 to 0.2', link: '/11-migration-0.1-to-0.2' },
          { text: 'Release runbook', link: '/12-release-runbook' },
          { text: 'Glossary', link: '/10-glossary' },
        ],
      },
    ],
    outline: { level: [2, 3], label: 'On this page' },
    search: { provider: 'local' },
    editLink: {
      pattern: 'https://github.com/cayvox/musd-kit/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/cayvox/musd-kit' },
      { icon: 'npm', link: 'https://www.npmjs.com/package/@musd-kit/core' },
    ],
    footer: {
      message:
        'Community tooling for Mezo testnet and evaluation. Not affiliated with or endorsed by Mezo or Thesis. MIT licensed.',
      copyright:
        'Built by <a href="https://cayvox.com" target="_blank" rel="noopener noreferrer">Cayvox Labs</a>',
    },
  },
})
