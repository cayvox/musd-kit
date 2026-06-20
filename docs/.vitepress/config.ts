import { defineConfig } from 'vitepress'
// The same warm Shiki theme the landing uses (BRAND §7) — so code reads as one brand.
import { codeTheme } from '../../landing/src/lib/code-theme.mjs'

// Thin Vitepress wrapper over the existing docs/*.md + the generated TypeDoc API ref
// (served from public/api). Content is NOT rewritten — this only adds nav + theme.
// `DOCS_BASE=/docs/` serves the docs under the landing's /docs subdirectory in the
// combined deploy; unset, it builds standalone at '/'.
export default defineConfig({
  title: 'musd-kit',
  description: 'The typed SDK for MUSD on Mezo',
  base: process.env.DOCS_BASE || '/',
  // The docs cross-link with repo-relative paths; don't fail the build on those.
  ignoreDeadLinks: true,
  markdown: {
    theme: { light: codeTheme, dark: codeTheme },
  },
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/00-overview' },
      { text: 'API Reference', link: '/api/' },
      { text: 'GitHub', link: 'https://github.com/cayvox/musd-kit' },
    ],
    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'Overview', link: '/00-overview' },
          { text: 'Architecture', link: '/02-architecture' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Core API', link: '/03-core-api' },
          { text: 'React API', link: '/04-react-api' },
          { text: 'Math & hints', link: '/05-math-and-hints' },
          { text: 'Errors', link: '/06-errors' },
          { text: 'Glossary', link: '/10-glossary' },
          { text: 'Generated API ↗', link: '/api/' },
        ],
      },
      {
        text: 'Internals',
        items: [
          { text: 'Ground truth (verified)', link: '/01-ground-truth' },
          { text: 'Testing', link: '/07-testing' },
          { text: 'Conventions', link: '/08-conventions' },
          { text: 'Open questions', link: '/09-open-questions' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/cayvox/musd-kit' }],
    footer: {
      message:
        'Community tooling for Mezo testnet / evaluation — not affiliated with or endorsed by Mezo. MIT.',
    },
  },
})
