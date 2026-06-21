#!/usr/bin/env node
// Internal link checker for the combined site (landing/dist). Crawls every built HTML page,
// extracts internal links (href/src), and verifies each resolves using the SAME rules the deploy
// host (Cloudflare Pages / Vercel) uses: a clean URL /foo resolves to foo.html or foo/index.html.
// Exits non-zero if any internal link 404s, so a broken docs link fails the build and CI.
//
//   node scripts/check-links.mjs            # checks landing/dist
//   node scripts/check-links.mjs <distDir>
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = process.argv[2] ? join(ROOT, process.argv[2]) : join(ROOT, 'landing/dist')

if (!existsSync(DIST)) {
  console.error(`✗ dist not found: ${DIST}\n  Run the combined build first (pnpm build:site).`)
  process.exit(1)
}

/** Recursively list every .html file under dir. */
function htmlFiles(dir) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...htmlFiles(p))
    else if (e.name.endsWith('.html')) out.push(p)
  }
  return out
}

/** Resolve an absolute site path to a real file, mimicking Cloudflare Pages clean URLs. */
function resolve(urlPath) {
  const p = decodeURIComponent(urlPath.split('#')[0].split('?')[0])
  if (p === '') return true
  const candidates = p.endsWith('/') ? [`${p}index.html`] : [p, `${p}.html`, `${p}/index.html`]
  return candidates.some((c) => {
    const fp = join(DIST, c)
    return existsSync(fp) && statSync(fp).isFile()
  })
}

const LINK_RE = /(?:href|src)\s*=\s*"([^"]+)"/gi
const broken = new Map() // link -> Set(pages)
let linkCount = 0

for (const file of htmlFiles(DIST)) {
  const rel = `/${posix.relative(DIST.split(/[/\\]/).join('/'), file.split(/[/\\]/).join('/'))}`
  const html = readFileSync(file, 'utf8')
  for (const match of html.matchAll(LINK_RE)) {
    const raw = match[1].trim()
    // Skip external, anchors, and non-navigable schemes.
    if (/^(https?:|mailto:|tel:|data:|javascript:|#)/i.test(raw)) continue
    if (raw === '' || raw.startsWith('//')) continue
    // Only validate absolute, site-rooted links (what the landing + VitePress emit).
    if (!raw.startsWith('/')) continue
    linkCount++
    if (!resolve(raw)) {
      if (!broken.has(raw)) broken.set(raw, new Set())
      broken.get(raw).add(rel)
    }
  }
}

const pages = htmlFiles(DIST).length

// The GET-only check above cannot catch the API-reference SPA hijack: /docs/api/ is a static TypeDoc
// subsite under the VitePress base, so a 200 file can still be unreachable by an in-app CLICK if the
// VitePress link is client-side-routed (VitePress renders its own 404). Assert two things:
//   1. /docs/api/index.html is the real TypeDoc index (not a VitePress 404 page), and
//   2. every link to /docs/api from inside a VitePress docs page is a real navigation (has target),
//      so clicking it does a full load instead of being SPA-routed into the VitePress 404.
const apiProblems = []
const apiIndexPath = join(DIST, 'docs/api/index.html')
if (!existsSync(apiIndexPath)) {
  apiProblems.push('docs/api/index.html is missing (the TypeDoc API reference was not assembled).')
} else {
  const apiHtml = readFileSync(apiIndexPath, 'utf8')
  const isTypedoc = /tsd-page-toolbar|tsd-navigation|API reference/i.test(apiHtml)
  const isVitepress404 = /VPContent|vp-doc|PAGE NOT FOUND/i.test(apiHtml)
  if (!isTypedoc || isVitepress404) {
    apiProblems.push(
      'docs/api/index.html is not the TypeDoc index (looks like a VitePress page/404).',
    )
  }
}
// A VitePress page is any docs/*.html that is NOT under docs/api/ (the TypeDoc subsite) and NOT an asset.
const API_ANCHOR_RE = /<a\b[^>]*\bhref="\/docs\/api\/?(?:[#?][^"]*)?"[^>]*>/gi
for (const file of htmlFiles(DIST)) {
  const relPath = posix.relative(DIST.split(/[/\\]/).join('/'), file.split(/[/\\]/).join('/'))
  if (!relPath.startsWith('docs/') || relPath.startsWith('docs/api/')) continue
  const html = readFileSync(file, 'utf8')
  for (const m of html.matchAll(API_ANCHOR_RE)) {
    if (!/\btarget=/.test(m[0])) {
      apiProblems.push(
        `/${relPath}: an API-reference link is client-side-routed (no target), so clicking it hits the VitePress 404. Add target: '_blank' to the /api/ link in the VitePress config.`,
      )
      break
    }
  }
}

const ok = broken.size === 0 && apiProblems.length === 0
if (ok) {
  console.log(
    `✓ link check: ${linkCount} internal links across ${pages} pages, 0 broken; API reference reachable (TypeDoc index + real-navigation links).`,
  )
  process.exit(0)
}

if (broken.size > 0) {
  console.error(`✗ link check: ${broken.size} broken internal link(s) across ${pages} pages:\n`)
  for (const [link, onPages] of broken) {
    const list = [...onPages].slice(0, 4).join(', ')
    console.error(
      `  ${link}\n      on: ${list}${onPages.size > 4 ? ` (+${onPages.size - 4} more)` : ''}`,
    )
  }
}
if (apiProblems.length > 0) {
  console.error(`✗ API reference reachability: ${apiProblems.length} problem(s):\n`)
  for (const p of [...new Set(apiProblems)]) console.error(`  ${p}`)
}
process.exit(1)
