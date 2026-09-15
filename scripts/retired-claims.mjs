#!/usr/bin/env node
/**
 * Claims a closed finding retired, looked for in what the packages SHIP (MK-246).
 *
 * **Why this exists.** A finding that corrects a claim corrects it where it was found. The published
 * declarations of 0.4.1 still documented `computeNICR` against the entire debt after MK-090 made it the
 * principal, and `isLiquidatable` as normal mode only after MK-001 removed the distinction, while the
 * repository's copies of the same sentences had been read and closed. Nothing read the artifact for a
 * sentence a finding had retired. This does, for the package a consumer installs rather than the tree
 * that built it.
 *
 * **What it reads**, per package directory: `README.md`, the `description` in `package.json`, every
 * `dist/*.d.ts` and `dist/*.d.cts`, and the `sourcesContent` embedded in every `dist/*.map`, since the
 * source maps ship the original comments too. Pointed at an installed package
 * (`node_modules/@musd-kit/core`) it reads exactly what npm delivered; pointed at `packages/core` after a
 * build, the same files before packing.
 *
 * **Each entry is the retired CLAIM, worded as the claim was, not the name it was about.** A sentence
 * that explains what used to be true ("until 0.5.0 this result carried a `recommended` figure") is the
 * correction, and must not match. When a claim cannot be matched without also matching its correction,
 * it is not listed, and the entry that would have been is named in the finding instead.
 *
 *   node scripts/retired-claims.mjs packages/core packages/react
 *   node scripts/retired-claims.mjs <consumer>/node_modules/@musd-kit/core <consumer>/node_modules/@musd-kit/react
 *
 * Exits 1 on any hit, printing the finding, the file, the line and the text.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** @type {{ finding: string, claim: RegExp, correct: string }[]} */
export const RETIRED_CLAIMS = [
  {
    finding: 'MK-001',
    claim: /Normal-mode liquidatab/i,
    correct: 'Liquidation is ICR < MCR in both modes (TroveManager.sol:1146-1148).',
  },
  {
    finding: 'MK-001',
    claim: /Recovery[- ]Mode liquidation of an above[- ]MCR/i,
    correct:
      'This protocol has no Recovery Mode liquidation; surplus comes from a redemption (TroveManager.sol:1195).',
  },
  {
    finding: 'MK-090',
    claim: /1e20\) \/ entireDebt/,
    correct: 'The nominal ratio divides by the PRINCIPAL.',
  },
  {
    finding: 'MK-101',
    claim: /capacity only ever ratchets|set ONCE, at open/i,
    correct:
      'A refinance resets capacity from the current price, up or down (BorrowerOperations.sol:1077-1084).',
  },
  {
    finding: 'MK-240',
    claim:
      /Offer `recommended`|power\.recommended|returns the recommended draw|The recommended draw\*\*|no recommended twin/,
    correct:
      'There is no recommended draw: drawForMargin takes the horizon and the fall as required inputs.',
  },
  {
    finding: 'MK-240',
    claim: /BORROWING_POWER_(MARGIN_WINDOW_SECONDS|PRICE_MOVE_BPS)/,
    correct: 'The margin constants were removed with the default they supplied.',
  },
  {
    finding: 'MK-241',
    claim:
      /RedeemResult\.truncatedAmount|RedeemResult` carries `truncatedAmount`|estimatedFeeCollateral/,
    correct:
      'RedeemResult reports what settled, from the receipt, and names its estimate as taken before sending.',
  },
  {
    finding: 'MK-243',
    claim: /Preview-time sibling of \{@link ICRBelowMCR\}/,
    correct: 'One code per gate: ICRBelowMCR for the MCR gate, whichever path reaches it.',
  },
  {
    finding: 'MK-246',
    claim: /has no\s+condition|nothing to preview because/,
    correct: 'claimCollateral reverts with no surplus (CollSurplusPool.sol:90-93).',
  },
  {
    finding: 'MK-246',
    claim: /getTroveDebt`?,? (?:which is|those return the) (?:stale|STORED)/i,
    correct:
      'getTroveDebt accrues to the block (TroveManager.sol:591-595, :1513-1527); it omits pending redistribution.',
  },
  {
    finding: 'MK-246',
    claim: /writes arrive in Phase 5|typed from Phase 5|layered in from Phase 5/,
    correct: 'The contract bundle is typed read side only; writes are the client methods.',
  },
  {
    finding: 'MK-247',
    claim: /"max" button's number/,
    correct: 'maxWithdrawableCollateral is a limit to display: at it the Trove sits at MCR.',
  },
]

/** The texts a package directory ships, each with the path a hit is reported against. */
export function shippedTexts(dir) {
  const texts = []
  const readme = join(dir, 'README.md')
  if (existsSync(readme)) texts.push({ path: readme, text: readFileSync(readme, 'utf8') })
  const manifest = join(dir, 'package.json')
  if (existsSync(manifest)) {
    const { description = '' } = JSON.parse(readFileSync(manifest, 'utf8'))
    texts.push({ path: `${manifest} (description)`, text: description })
  }
  const dist = join(dir, 'dist')
  if (!existsSync(dist)) return texts
  for (const name of readdirSync(dist)) {
    const path = join(dist, name)
    if (name.endsWith('.d.ts') || name.endsWith('.d.cts')) {
      texts.push({ path, text: readFileSync(path, 'utf8') })
    } else if (name.endsWith('.map')) {
      const map = JSON.parse(readFileSync(path, 'utf8'))
      ;(map.sourcesContent ?? []).forEach((content, i) => {
        if (typeof content === 'string') {
          texts.push({ path: `${path} -> ${map.sources?.[i] ?? i}`, text: content })
        }
      })
    }
  }
  return texts
}

/** Every retired claim found in the given texts, with its line. */
export function findRetiredClaims(texts, claims = RETIRED_CLAIMS) {
  const hits = []
  for (const { path, text } of texts) {
    const lines = text.split('\n')
    for (const entry of claims) {
      lines.forEach((line, i) => {
        if (entry.claim.test(line)) {
          hits.push({
            finding: entry.finding,
            path,
            line: i + 1,
            text: line.trim(),
            correct: entry.correct,
          })
        }
      })
    }
  }
  return hits
}

const invokedDirectly =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (invokedDirectly) {
  const dirs = process.argv.slice(2)
  if (dirs.length === 0) {
    console.error('usage: node scripts/retired-claims.mjs <package dir>...')
    process.exit(2)
  }
  const texts = dirs.flatMap(shippedTexts)
  const hits = findRetiredClaims(texts)
  for (const h of hits) {
    console.log(`  ${h.finding} ${h.path}:${h.line}\n    ${h.text}\n    retired: ${h.correct}`)
  }
  console.log(
    `retired claims: ${RETIRED_CLAIMS.length} checked across ${texts.length} shipped texts in ${dirs.length} package(s), ${hits.length} found`,
  )
  process.exit(hits.length === 0 ? 0 : 1)
}
