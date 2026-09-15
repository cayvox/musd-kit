/**
 * Where a mutation lands, resolved so it cannot land anywhere else (MK-112, MK-110).
 *
 * **What the gate did before this file.** `scripts/mutation-check.mjs` checked that a mutation's
 * `from` text occurred somewhere in its file (`original.includes(m.from)`) and then applied
 * `original.replace(m.from, m.to)`, which rewrites the FIRST occurrence in the file. Nothing tied a
 * mutation to the code it was written for. MK-110's first case is what that allowed: the MK-089
 * entry's `from` stopped occurring in `marginFor` and began occurring, exactly once, in
 * `partialRedemptionBand`, so the check still passed and the gate mutated the wrong computation while
 * reporting a result about the right one.
 *
 * **What a mutation must now satisfy, each checked before anything is applied, each failing loudly.**
 *
 *   1. `scope` names the declaration the mutation was written for, as a dotted path of enclosing
 *      named declarations (`evaluateAdjust`, `musdQueryKeys.borrowingPower`). It must resolve to
 *      EXACTLY ONE node in the file: absent and ambiguous are both refusals. The empty scope `''`
 *      means the whole file, for a top level statement such as an exported constant; rule 2 and
 *      rule 3 still apply to it.
 *   2. `from` must occur EXACTLY ONCE inside that node's text. Absent means the code moved or changed;
 *      twice means the mutation cannot say which one it means.
 *   3. `fingerprint` is a hash of the smallest statement enclosing `from`, printed by the TypeScript
 *      printer with comments removed, so formatting and comments do not move it and code does. It
 *      must equal the recorded value: a mismatch means the code around the mutation is no longer the
 *      code it was written against, and a person has to look before the gate says anything about it.
 *   4. The edit is spliced at the resolved offset. It is never a search and replace.
 *
 * Markdown targets (the packaged README) use a heading as `scope` and fingerprint the covered lines
 * with whitespace collapsed, since there is no syntax tree to print.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(join(process.cwd(), 'package.json'))
const ts = require('typescript')

export class AnchorError extends Error {}

const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16)

const isMarkdown = (file) => file.endsWith('.md')

/** Parse a TypeScript or JavaScript file with parent pointers, which scope resolution needs. */
export function parse(file, text) {
  const kind = /\.(c|m)?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
}

/** The name a node contributes to a scope path, or `undefined` when it names nothing. */
export function nameOf(node) {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertyAssignment(node) ||
    ts.isVariableDeclaration(node)
  ) {
    const n = node.name
    if (!n) return undefined
    if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) return n.text
    if (ts.isStringLiteral(n) || ts.isNumericLiteral(n)) return n.text
  }
  return undefined
}

/** The dotted path of named declarations enclosing `node`, outermost first. */
export function scopePathOf(node) {
  const names = []
  for (let n = node; n; n = n.parent) {
    const name = nameOf(n)
    if (name !== undefined) names.unshift(name)
  }
  return names.join('.')
}

/** Every node whose own scope path is exactly `path`. */
function nodesAtPath(sf, path) {
  const hits = []
  const visit = (n) => {
    if (nameOf(n) !== undefined && scopePathOf(n) === path) hits.push(n)
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return hits
}

/** The smallest statement-like node whose span contains [start, end). */
function enclosingStatement(sf, start, end) {
  let best = sf
  const visit = (n) => {
    if (n.kind === ts.SyntaxKind.EndOfFileToken) return
    if (n.getStart(sf) <= start && n.getEnd() >= end) {
      if (
        ts.isStatement(n) ||
        ts.isPropertyAssignment(n) ||
        ts.isClassElement(n) ||
        ts.isVariableDeclaration(n)
      ) {
        best = n
      }
      ts.forEachChild(n, visit)
    }
  }
  visit(sf)
  return best
}

function printNoComments(sf, node) {
  const printer = ts.createPrinter({ removeComments: true })
  return printer.printNode(ts.EmitHint.Unspecified, node, sf)
}

/** Every index at which `needle` occurs in `hay`, overlapping occurrences included. */
function occurrences(hay, needle) {
  const out = []
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + 1)) out.push(i)
  return out
}

/**
 * Resolve one edit (`from` inside `scope`) to absolute offsets in `text`, and its fingerprint.
 * Throws {@link AnchorError} for every way the edit could land somewhere it was not written for.
 */
export function locate(entry, text, from = entry.from) {
  const label = `${entry.id} (${entry.file})`
  if (typeof from !== 'string' || from.length === 0) {
    throw new AnchorError(`${label}: has no \`from\` text`)
  }
  if (isMarkdown(entry.file)) {
    const at = text.indexOf(`\n${entry.scope}\n`)
    if (at === -1 || text.indexOf(`\n${entry.scope}\n`, at + 1) !== -1) {
      throw new AnchorError(
        `${label}: markdown scope ${JSON.stringify(entry.scope)} is absent or not unique`,
      )
    }
    const sectionStart = at + 1
    const next = text.indexOf('\n## ', sectionStart + entry.scope.length)
    const sectionEnd = next === -1 ? text.length : next
    const section = text.slice(sectionStart, sectionEnd)
    const hits = occurrences(section, from)
    if (hits.length !== 1) {
      throw new AnchorError(
        `${label}: \`from\` occurs ${hits.length} times inside ${entry.scope}; a mutation must name exactly one place`,
      )
    }
    const start = sectionStart + hits[0]
    const end = start + from.length
    const lineStart = text.lastIndexOf('\n', start) + 1
    const lineEnd = text.indexOf('\n', end)
    const covered = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd)
    return { start, end, fingerprint: sha(covered.replace(/\s+/g, ' ').trim()) }
  }
  const sf = parse(entry.file, text)
  if (typeof entry.scope !== 'string') throw new AnchorError(`${label}: has no \`scope\``)
  const nodes = entry.scope === '' ? [sf] : nodesAtPath(sf, entry.scope)
  if (nodes.length === 0) {
    throw new AnchorError(`${label}: scope \`${entry.scope}\` does not exist in the file`)
  }
  if (nodes.length > 1) {
    throw new AnchorError(
      `${label}: scope \`${entry.scope}\` resolves to ${nodes.length} declarations; name a longer path`,
    )
  }
  const node = nodes[0]
  const nodeStart = node.getStart(sf)
  const nodeText = text.slice(nodeStart, node.getEnd())
  const hits = occurrences(nodeText, from)
  if (hits.length !== 1) {
    throw new AnchorError(
      `${label}: \`from\` occurs ${hits.length} times inside \`${entry.scope}\`; a mutation must name exactly one place`,
    )
  }
  const start = nodeStart + hits[0]
  const end = start + from.length
  // The statement is found from the range WITHOUT its surrounding whitespace: a `from` usually
  // begins with indentation, which lies before the statement's own start, and measuring from there
  // would make the enclosing block, often the whole function, the fingerprinted unit.
  const lead = from.length - from.trimStart().length
  const trail = from.length - from.trimEnd().length
  const statement = enclosingStatement(sf, start + lead, end - trail)
  return { start, end, fingerprint: sha(printNoComments(sf, statement)) }
}

/**
 * Apply every edit of `entry` to `text` and return the mutated text, after checking each edit's
 * anchor and fingerprint against the UNMUTATED text. Edits must not overlap.
 */
export function applyEntry(entry, text) {
  const edits = [{ from: entry.from, to: entry.to, fingerprint: entry.fingerprint }]
  if (entry.also) edits.push(entry.also)
  const resolved = edits.map((e) => {
    const where = locate(entry, text, e.from)
    if (e.fingerprint === undefined) {
      throw new AnchorError(
        `${entry.id} (${entry.file}): no fingerprint is recorded; the current one is ${where.fingerprint}. Read the code, then record it`,
      )
    }
    if (where.fingerprint !== e.fingerprint) {
      throw new AnchorError(
        `${entry.id} (${entry.file}): the code around this mutation is no longer the code it was written against (fingerprint ${where.fingerprint}, recorded ${e.fingerprint}). Re-read \`${entry.scope}\` and confirm the mutation still means what its \`what\` says before recording the new value`,
      )
    }
    return { ...where, to: e.to }
  })
  resolved.sort((a, b) => b.start - a.start)
  for (let i = 1; i < resolved.length; i++) {
    if (resolved[i].end > resolved[i - 1].start) {
      throw new AnchorError(`${entry.id} (${entry.file}): its edits overlap`)
    }
  }
  let out = text
  for (const r of resolved) out = out.slice(0, r.start) + r.to + out.slice(r.end)
  return out
}

/** The fingerprint an edit would record today, for writing a new entry after reading the code. */
export function currentFingerprint(entry, from = entry.from) {
  return locate(entry, readFileSync(entry.file, 'utf8'), from).fingerprint
}
