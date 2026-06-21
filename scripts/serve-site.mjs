#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs'
// Serve the combined site (landing/dist) locally with Cloudflare-Pages-style clean-URL
// resolution, so a local preview behaves exactly like production. This is how you preview the
// docs locally: the Astro dev server (pnpm dev) does NOT contain /docs (the VitePress docs are
// only assembled into landing/dist by scripts/build-site.sh), so use this after a combined build.
//
//   pnpm build:site && pnpm serve:site      # or: pnpm preview:site (does both)
//   PORT=4477 node scripts/serve-site.mjs
import { createServer } from 'node:http'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'landing/dist')
const PORT = Number(process.env.PORT) || 4477

if (!existsSync(DIST)) {
  console.error('✗ landing/dist not found. Build first: pnpm build:site')
  process.exit(1)
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
}

/** Mimic Cloudflare Pages: /foo resolves to foo, foo.html, or foo/index.html. */
function resolveFile(urlPath) {
  const p = decodeURIComponent(urlPath.split('?')[0])
  const candidates = p.endsWith('/') ? [`${p}index.html`] : [p, `${p}.html`, `${p}/index.html`]
  for (const c of candidates) {
    const fp = join(DIST, c)
    if (existsSync(fp) && statSync(fp).isFile()) return fp
  }
  return null
}

createServer((req, res) => {
  const fp = resolveFile(req.url || '/')
  if (!fp) {
    const notFound = join(DIST, '404.html')
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(existsSync(notFound) ? readFileSync(notFound) : 'Not found')
    return
  }
  const type = TYPES[extname(fp)] || 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': type })
  res.end(readFileSync(fp))
}).listen(PORT, () => {
  console.log(`Combined site at http://localhost:${PORT}  (landing at /, docs at /docs/)`)
})
