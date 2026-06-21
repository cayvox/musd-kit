// Astro dev integration: serve the built VitePress docs (and the TypeDoc API reference) under
// /docs/* on the landing's dev server, so `pnpm dev` matches production. The VitePress output is
// built with DOCS_BASE=/docs/ into docs/.vitepress/dist; this middleware maps /docs/foo to that
// output using the SAME Cloudflare-Pages-style clean-URL resolution as serve-site.mjs and
// production (/foo -> foo.html -> foo/index.html). The landing keeps its hot reload; docs content
// is static here (rebuild with `pnpm docs:build` or `pnpm dev:site` to refresh it).
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const DOCS_DIST = join(REPO_ROOT, 'docs/.vitepress/dist')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

// Resolve a /docs/* request to a file in the VitePress dist, mimicking Pages clean URLs.
function resolveDocsFile(urlPath) {
  let rel = urlPath.slice('/docs'.length)
  if (rel === '') rel = '/'
  const candidates = rel.endsWith('/')
    ? [`${rel}index.html`]
    : [rel, `${rel}.html`, `${rel}/index.html`]
  for (const c of candidates) {
    const fp = join(DOCS_DIST, c)
    if (existsSync(fp) && statSync(fp).isFile()) return fp
  }
  return null
}

export function docsDev() {
  return {
    name: 'musd-docs-dev',
    hooks: {
      'astro:server:setup': ({ server, logger }) => {
        if (!existsSync(join(DOCS_DIST, 'index.html'))) {
          logger.warn('built docs not found, building once with DOCS_BASE=/docs/ (this is a one-time step)')
          try {
            execSync('pnpm docs:build', {
              cwd: REPO_ROOT,
              stdio: 'inherit',
              env: { ...process.env, DOCS_BASE: '/docs/' },
            })
          } catch {
            logger.warn('could not build docs automatically. Run: DOCS_BASE=/docs/ pnpm docs:build')
          }
        }

        server.middlewares.use((req, res, next) => {
          const url = (req.url || '').split('?')[0]
          if (url !== '/docs' && !url.startsWith('/docs/')) return next()
          let fp
          try {
            fp = resolveDocsFile(decodeURIComponent(url))
          } catch {
            return next()
          }
          if (!fp) return next()
          res.setHeader('Content-Type', TYPES[extname(fp)] || 'application/octet-stream')
          res.end(readFileSync(fp))
        })

        const ok = existsSync(join(DOCS_DIST, 'index.html'))
        logger.info(
          ok
            ? 'docs served at /docs and /docs/api (static; run "pnpm dev:site" to rebuild + serve)'
            : 'docs not built; /docs will 404 until you run "pnpm dev:site" or "pnpm docs:build"',
        )
      },
    },
  }
}
