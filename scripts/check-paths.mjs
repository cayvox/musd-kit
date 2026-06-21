#!/usr/bin/env node
// Guardrail: fail if any tracked source/config/script contains an absolute, machine-specific path
// (a developer's home dir or a Windows drive) or a brittle pnpm-internal reference. These break on
// other machines and in CI, and pnpm rewrites its hashed .pnpm/ paths on every reinstall. Import
// packages by name (with the dep in package.json), never by an absolute or .pnpm path.
//
// The forbidden patterns are assembled from fragments so this guardrail does not trip its own check.
//   node scripts/check-paths.mjs
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const TAIL = '[^\\s"\'`]+'
const FORBIDDEN = [
  { name: 'absolute macOS path', re: new RegExp(`/${'Users'}/${TAIL}`) },
  { name: 'absolute Linux home path', re: new RegExp(`/${'home'}/[a-z]${TAIL}`) },
  // Word boundary before the drive letter so a string escape like `pages:\n` is not a false hit.
  { name: 'absolute Windows path', re: new RegExp(`${'\\b'}[A-Za-z]:${'\\\\'}${TAIL}`) },
  { name: 'pnpm-internal path', re: new RegExp(`node_modules/${'\\.'}pnpm/`) },
]

// Scan tracked text files of these kinds; the lockfile legitimately contains .pnpm paths, and built
// output (dist, the generated API) is not source, so both are skipped.
const EXTS = /\.(mjs|cjs|js|jsx|ts|tsx|astro|vue|json|sh|ya?ml|css|md)$/
const SKIP =
  /(^pnpm-lock\.yaml$|(^|\/)node_modules\/|\/dist\/|^landing\/dist\/|^docs\/\.vitepress\/dist\/|^docs\/public\/api\/)/

const files = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
const hits = []
let scanned = 0
for (const f of files) {
  if (!EXTS.test(f) || SKIP.test(f)) continue
  scanned++
  const lines = readFileSync(join(ROOT, f), 'utf8').split('\n')
  lines.forEach((line, i) => {
    for (const { name, re } of FORBIDDEN) {
      const m = line.match(re)
      if (m) hits.push(`${f}:${i + 1}  ${name}: ${m[0].slice(0, 80)}`)
    }
  })
}

if (hits.length === 0) {
  console.log(
    `✓ path guardrail: no absolute machine paths or pnpm-internal references in ${scanned} tracked files.`,
  )
  process.exit(0)
}
console.error(`✗ path guardrail: ${hits.length} forbidden path(s) found:\n`)
for (const h of hits) console.error(`  ${h}`)
console.error(
  '\n  Import packages by name (add the dep to package.json), not by an absolute or node_modules/.pnpm path.',
)
process.exit(1)
