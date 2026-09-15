/**
 * Every decision site in the shipped packages, found by rule rather than listed by hand (MK-112).
 *
 * **The rule.** A site deserves a mutation when changing it would change something a caller can
 * observe: a verdict, a reason, which error is thrown, a figure's value or rounding direction, what is
 * asked of the chain, or which of two modes applies. A constant that encodes a protocol rule or a
 * measured value is a site too. Code that only moves a value from one place to another, formats a
 * message, or exists for the type checker is not.
 *
 * **How the rule is applied, mechanically, so the count can be reproduced.** Over every `.ts` file in
 * `packages/core/src` and `packages/react/src`, except `_generated/`:
 *
 *   relational   a `<`, `<=`, `>` or `>=`                    mutant: the other inclusivity
 *   equality     a `===`, `!==`, `==` or `!=` on values       mutant: the opposite operator
 *   presence     the same against `undefined` or `null`       mutant: the opposite operator
 *   condition    an `if` or ternary condition, or an operand
 *                of `&&` or `||` inside one, that is not
 *                itself a comparison or connective            mutant: negated
 *   connective   an `&&` or `||` inside such a condition      mutant: the other connective
 *   default      `a ?? b` where `b` is a literal or an
 *                UPPER_CASE constant                          mutant: the default removed
 *   reason       a statement `<list>.push(...)` onto a list
 *                of reasons or failures                       mutant: the statement removed
 *   rounding     a ceiling division, `(a + b - 1n) / b`,
 *                or a call to `ceilDiv`                       mutant: floor division
 *   constant     a module level UPPER_CASE `const` with a
 *                numeric or bigint initialiser               mutant: doubled, or 1 when it is 0
 *
 * **What the mechanical pass excludes, and why, stated here so the exclusion is reviewable.** Nodes
 * inside a template literal, which build messages rather than decisions; and every node in
 * `packages/core/src/errors/index.ts` that sits inside a constructor, where the only expressions are
 * the formatting of the message and context an error carries. Anything else a reviewer judges to be
 * plumbing is not dropped here: it is recorded in `sites.json` as `excluded` with its reason, so the
 * judgment is visible and a wrong one can be argued with.
 *
 * **How a survivor is classified, and the standard each class has to meet.** A mutant nothing catches is
 * recorded in `sites.json` under a finding, in one of three classes:
 *
 *   uncaught      the mutant changes something a caller can observe and no test notices: a test gap.
 *                 Fixed with a test that catches it, after which the site is recorded as caught.
 *   equivalent    NO observable difference exists: not in any value a public function returns or throws,
 *                 not in which chain reads are made or with what arguments, not in what is sent. Matching
 *                 figures are not enough; a mutant that returns the same number after an extra read is
 *                 uncaught, not equivalent. The written reason must show why, for every input in the
 *                 domain below, not for the inputs a test happens to use.
 *   unreachable   the mutated code cannot be reached with an input in the domain, so it is a finding about
 *                 the source (dead or defensive code), and the reason must say why no input reaches it.
 *
 * **The domain those two claims are made over.** For a pure exported function: every argument its type
 * allows whose quantities are non negative and representable as a `uint256`, because every quantity in
 * this SDK is one on chain. For a function that reads the chain: every answer its own code is written to
 * handle, which includes answers today's deployment does not give but the SDK checks for on every call,
 * such as a borrowing fee that is not linear (MK-010): the contracts sit behind upgradeable proxies. A
 * claim that holds only for realistic values is not equivalence; the P23 classification found several
 * that were not.
 *
 * **Identity.** A site's id is its file, the scope path of its enclosing declaration, its kind, its
 * source text with whitespace collapsed, and its ordinal among identical sites in that scope. The id
 * does not move when unrelated code changes, and it does move when the site itself changes, which is
 * what makes `sites.json` fail loudly for a site nobody has reviewed.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { parse, scopePathOf } from './anchor.mjs'

const require = createRequire(join(process.cwd(), 'package.json'))
const ts = require('typescript')
const K = ts.SyntaxKind

/** The files the rule is applied to: tracked shipped source, all depths, no generated data. */
export function siteFiles() {
  return execFileSync('git', ['ls-files', '--', 'packages/core/src', 'packages/react/src'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter((f) => f.endsWith('.ts') && !f.includes('/_generated/') && !f.endsWith('.d.ts'))
}

const RELATIONAL = new Map([
  [K.LessThanToken, '<='],
  [K.LessThanEqualsToken, '<'],
  [K.GreaterThanToken, '>='],
  [K.GreaterThanEqualsToken, '>'],
])
const EQUALITY = new Map([
  [K.EqualsEqualsEqualsToken, '!=='],
  [K.ExclamationEqualsEqualsToken, '==='],
  [K.EqualsEqualsToken, '!='],
  [K.ExclamationEqualsToken, '=='],
])
const COMPARISON = new Set([...RELATIONAL.keys(), ...EQUALITY.keys()])
const CONNECTIVE = new Map([
  [K.AmpersandAmpersandToken, '||'],
  [K.BarBarToken, '&&'],
])

const collapse = (s) => s.replace(/\s+/g, ' ').trim()
const unwrap = (n) => (ts.isParenthesizedExpression(n) ? unwrap(n.expression) : n)
const isNullish = (n) => {
  const u = unwrap(n)
  return u.kind === K.NullKeyword || (ts.isIdentifier(u) && u.text === 'undefined')
}
const isTypeofExpr = (n) => ts.isTypeOfExpression(unwrap(n))

function inTemplate(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isTemplateExpression(n) || ts.isTemplateSpan(n)) return true
  }
  return false
}

function inErrorConstructor(file, node) {
  if (!file.endsWith('packages/core/src/errors/index.ts')) return false
  for (let n = node.parent; n; n = n.parent) if (ts.isConstructorDeclaration(n)) return true
  return false
}

/** Is `node` the condition, or inside the condition, of an `if` or a ternary? */
function inCondition(node) {
  let child = node
  for (let n = node.parent; n; child = n, n = n.parent) {
    if (ts.isIfStatement(n)) return n.expression === child
    if (ts.isConditionalExpression(n)) return n.condition === child
    if (
      ts.isBinaryExpression(n) &&
      (CONNECTIVE.has(n.operatorToken.kind) || n.operatorToken.kind === K.QuestionQuestionToken)
    ) {
      continue
    }
    if (ts.isParenthesizedExpression(n) || ts.isPrefixUnaryExpression(n)) continue
    return false
  }
  return false
}

/** Replace the source text of `inner` inside `outer`'s text, both nodes of the same file. */
function spliceWithin(sf, outer, inner, replacement) {
  const text = sf.text
  const oStart = outer.getStart(sf)
  const iStart = inner.getStart(sf)
  return text.slice(oStart, iStart) + replacement + text.slice(inner.getEnd(), outer.getEnd())
}

/**
 * The decision sites of one file, each with its generated mutant as a `{ from, to }` pair over the
 * site's own node text, plus the `start` offset the runner splices at.
 */
export function sitesOf(file, text = readFileSync(file, 'utf8')) {
  const sf = parse(file, text)
  const sites = []
  const add = (node, kind, to) => {
    if (inTemplate(node) || inErrorConstructor(file, node)) return
    sites.push({
      file,
      scope: scopePathOf(node.parent ?? node),
      kind,
      text: collapse(node.getText(sf)),
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      start: node.getStart(sf),
      end: node.getEnd(),
      from: node.getText(sf),
      to,
    })
  }

  const visit = (node) => {
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind
      if (RELATIONAL.has(op)) {
        add(node, 'relational', spliceWithin(sf, node, node.operatorToken, RELATIONAL.get(op)))
      } else if (EQUALITY.has(op)) {
        const presence =
          isNullish(node.left) ||
          isNullish(node.right) ||
          isTypeofExpr(node.left) ||
          isTypeofExpr(node.right)
        add(
          node,
          presence ? 'presence' : 'equality',
          spliceWithin(sf, node, node.operatorToken, EQUALITY.get(op)),
        )
      } else if (CONNECTIVE.has(op) && inCondition(node)) {
        add(node, 'connective', spliceWithin(sf, node, node.operatorToken, CONNECTIVE.get(op)))
      } else if (op === K.QuestionQuestionToken) {
        const r = unwrap(node.right)
        const literal =
          ts.isNumericLiteral(r) ||
          ts.isBigIntLiteral(r) ||
          ts.isStringLiteral(r) ||
          r.kind === K.TrueKeyword ||
          r.kind === K.FalseKeyword ||
          (ts.isIdentifier(r) && /^[A-Z][A-Z0-9_]+$/.test(r.text))
        if (literal) add(node, 'default', `(${node.left.getText(sf)})`)
      } else if (op === K.SlashToken) {
        const l = unwrap(node.left)
        if (
          ts.isBinaryExpression(l) &&
          l.operatorToken.kind === K.MinusToken &&
          /^1n?$/.test(unwrap(l.right).getText(sf)) &&
          ts.isBinaryExpression(unwrap(l.left)) &&
          unwrap(l.left).operatorToken.kind === K.PlusToken
        ) {
          add(
            node,
            'rounding',
            `(${unwrap(l.left).left.getText(sf)}) / (${node.right.getText(sf)})`,
          )
        }
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'ceilDiv'
    ) {
      const [a, b] = node.arguments
      if (a && b) add(node, 'rounding', `(${a.getText(sf)}) / (${b.getText(sf)})`)
    }
    if (
      ts.isExpressionStatement(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      node.expression.expression.name.text === 'push' &&
      /reasons|failures|problems/i.test(node.expression.expression.expression.getText(sf))
    ) {
      add(node, 'reason', 'void 0')
    }
    if (inCondition(node) && isConditionLeaf(node)) {
      const u = node
      const negated = ts.isPrefixUnaryExpression(u) && u.operator === K.ExclamationToken
      add(u, 'condition', negated ? `(${u.operand.getText(sf)})` : `!(${u.getText(sf)})`)
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /^[A-Z][A-Z0-9_]+$/.test(node.name.text) &&
      node.initializer &&
      ts.isVariableStatement(node.parent?.parent) &&
      ts.isSourceFile(node.parent.parent.parent) &&
      isNumericInit(node.initializer)
    ) {
      const init = node.initializer
      const big = /\d_?\d*n\b|\dn\b/.test(init.getText(sf))
      const zero = /^0n?$/.test(init.getText(sf))
      add(
        init,
        'constant',
        zero ? (big ? '1n' : '1') : `(${init.getText(sf)}) * ${big ? '2n' : '2'}`,
      )
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  // Ordinals among identical (scope, kind, text), in source order, complete the identity.
  const seen = new Map()
  for (const s of sites.sort((a, b) => a.start - b.start)) {
    const key = `${s.scope}|${s.kind}|${s.text}`
    const k = seen.get(key) ?? 0
    seen.set(key, k + 1)
    s.ordinal = k
    s.id = `${file}#${s.scope}#${s.kind}#${createHash('sha256').update(`${s.text}|${k}`).digest('hex').slice(0, 10)}`
  }
  return sites
}

/** A condition operand that is not itself a comparison, a connective, or a wrapper around one. */
function isConditionLeaf(node) {
  if (ts.isParenthesizedExpression(node)) return false
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind
    if (COMPARISON.has(op) || CONNECTIVE.has(op) || op === K.QuestionQuestionToken) return false
  }
  if (ts.isPrefixUnaryExpression(node) && node.operator === K.ExclamationToken) {
    const inner = unwrap(node.operand)
    if (ts.isBinaryExpression(inner)) return false
    return true
  }
  // A leaf directly under `!` is counted once, at the `!`.
  if (
    node.parent &&
    ts.isPrefixUnaryExpression(node.parent) &&
    node.parent.operator === K.ExclamationToken
  ) {
    return false
  }
  return (
    ts.isIdentifier(node) ||
    ts.isPropertyAccessExpression(node) ||
    ts.isCallExpression(node) ||
    ts.isElementAccessExpression(node) ||
    ts.isPrefixUnaryExpression(node)
  )
}

function isNumericInit(init) {
  const u = unwrap(init)
  if (ts.isNumericLiteral(u) || ts.isBigIntLiteral(u)) return true
  if (ts.isBinaryExpression(u)) return isNumericInit(u.left) && isNumericInit(u.right)
  if (ts.isPrefixUnaryExpression(u)) return isNumericInit(u.operand)
  return false
}

/** Every decision site in the shipped packages, in file then source order. */
export function allSites() {
  return siteFiles().flatMap((f) => sitesOf(f))
}
