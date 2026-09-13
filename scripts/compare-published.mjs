#!/usr/bin/env node
/**
 * Prove, rather than assert, that a release changes no behaviour (`docs/12-release-runbook.md` §0b).
 *
 * A documentation release may ship with an open S1 only when the code a consumer runs is the code
 * they already had. This compares both published packages file by file:
 *
 *   dist/*.js, dist/*.cjs      byte identical, or the release changes behaviour
 *   dist/*.d.ts, dist/*.d.cts  identical once the TypeScript printer removes comments; the comments
 *                              are the documentation the release exists to change
 *   package.json               identical apart from `version` and the pinned internal dependency
 *   README.md, LICENSE, *.map  reported, not gated: prose, and source maps that embed that prose
 *   the file list              identical, since a file added or removed is a change in itself
 *
 * **Why it is committed.** The 0.3.1 release made this claim in its commit message from scratch
 * scripts nobody else could run, which `docs/08-conventions.md` §10 does not allow to be cited.
 *
 *   node scripts/compare-published.mjs --base 0.3.0 --head 0.3.1   two published versions
 *   node scripts/compare-published.mjs --base 0.3.1                 the working tree, built and packed
 *
 * Exit 0 for NO BEHAVIOUR CHANGE, 1 for a change, 2 for a usage or network failure.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const require = createRequire(join(ROOT, 'package.json'))
const ts = require('typescript')

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const base = arg('base')
const head = arg('head')
if (!base) {
  console.error('usage: node scripts/compare-published.mjs --base <version> [--head <version>]')
  process.exit(2)
}

const WORK = join(tmpdir(), 'musd-kit-compare-published')
rmSync(WORK, { recursive: true, force: true })
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe' })

/** Pack one package at one version into `dir/<label>` and return the extracted `package/` root. */
function unpack(pkg, version, label) {
  const dest = join(WORK, label, pkg)
  mkdirSync(dest, { recursive: true })
  if (version === undefined) {
    run('pnpm', ['-s', 'pack', '--pack-destination', dest], join(ROOT, 'packages', pkg))
  } else {
    run(
      'npm',
      ['pack', `@musd-kit/${pkg}@${version}`, '--pack-destination', dest, '--silent'],
      ROOT,
    )
  }
  const tgz = readdirSync(dest).find((f) => f.endsWith('.tgz'))
  if (!tgz) throw new Error(`no tarball for ${pkg}@${version ?? 'working tree'}`)
  run('tar', ['xzf', join(dest, tgz), '-C', dest], ROOT)
  return join(dest, 'package')
}

function files(dir) {
  const out = []
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else out.push(relative(dir, p))
    }
  }
  walk(dir)
  return out.sort()
}

const stripComments = (path) => {
  const src = readFileSync(path, 'utf8')
  const sf = ts.createSourceFile(path, src, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
  return ts.createPrinter({ removeComments: true }).printFile(sf)
}

const manifest = (path) => {
  const m = JSON.parse(readFileSync(path, 'utf8'))
  m.version = undefined
  if (m.dependencies?.['@musd-kit/core']) m.dependencies['@musd-kit/core'] = undefined
  return JSON.stringify(m)
}

if (head === undefined) run('pnpm', ['-s', 'build'], ROOT)

let changed = 0
for (const pkg of ['core', 'react']) {
  const a = unpack(pkg, base, 'base')
  const b = unpack(pkg, head, 'head')
  console.log(`\n@musd-kit/${pkg}: ${base} -> ${head ?? 'working tree'}`)
  const fa = files(a)
  const fb = files(b)
  for (const f of fa.filter((x) => !fb.includes(x))) {
    console.log(`  CHANGE     ${f} removed`)
    changed++
  }
  for (const f of fb.filter((x) => !fa.includes(x))) {
    console.log(`  CHANGE     ${f} added`)
    changed++
  }
  for (const f of fa.filter((x) => fb.includes(x))) {
    const pa = join(a, f)
    const pb = join(b, f)
    let verdict
    if (/\.(c?js)$/.test(f)) {
      verdict = readFileSync(pa).equals(readFileSync(pb)) ? 'identical' : 'CHANGE'
    } else if (/\.d\.c?ts$/.test(f)) {
      if (readFileSync(pa).equals(readFileSync(pb))) verdict = 'identical'
      else verdict = stripComments(pa) === stripComments(pb) ? 'comments only' : 'CHANGE'
    } else if (f === 'package.json') {
      verdict = manifest(pa) === manifest(pb) ? 'version only' : 'CHANGE'
    } else {
      verdict = readFileSync(pa).equals(readFileSync(pb)) ? 'identical' : 'prose, not gated'
    }
    if (verdict === 'CHANGE') changed++
    console.log(`  ${verdict.padEnd(16)} ${f}`)
  }
}

console.log(
  changed === 0
    ? '\nNO BEHAVIOUR CHANGE: runtime byte identical, declarations identical without comments.'
    : `\nBEHAVIOUR OR SURFACE CHANGED: ${changed} file(s). This is not a documentation-only release.`,
)
process.exit(changed === 0 ? 0 : 1)
