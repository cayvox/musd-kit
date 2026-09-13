#!/usr/bin/env node
/**
 * The packaged artifact gate (MK-040), as an instrument rather than a procedure.
 *
 * **Why this is a script now.** The gate lived in `docs/07-testing.md` §4c as a list of commands,
 * and it said "all four configurations must exit 0" without naming the configuration they ran
 * under. They ran under `skipLibCheck: true`, and the CommonJS rows do not pass without it. A gate
 * that reports a verdict but not the settings that produced it claims more than it checked, which
 * is the same defect as citing a simulated number as chain behaviour (`docs/08-conventions.md` §10
 * step 11). So this prints every setting beside every result.
 *
 * **It also compiles the quickstart that npm renders** (MK-108). The `## Quickstart` block is read out
 * of `package/README.md` INSIDE the packed core tarball, which is the file npm displays, and
 * typechecked against the same install under the two ESM rows. It uses top level `await`, which a
 * CommonJS module cannot contain, so the CommonJS rows do not compile it and say so. The block
 * shipped in 0.3.0 used three undeclared names and gated on the wrong field, and nothing compiled it.
 *
 * It packs the real tarballs and typechecks a consumer against them from OUTSIDE the workspace,
 * because a workspace typecheck resolves `@musd-kit/core` through path mapping and never reads the
 * `exports` map, which is exactly where MK-040 lived for a whole release.
 *
 *   node scripts/packaging-gate.mjs              the four documented rows
 *   node scripts/packaging-gate.mjs --strict     the same, plus skipLibCheck:false, reported
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const STRICT = process.argv.includes('--strict')
const ROOT = process.cwd()
const WORK = join(tmpdir(), 'musd-kit-packaging-gate')
const PACK = join(WORK, 'pack')
const CONSUMER = join(WORK, 'consumer')

const run = (cmd, args, cwd, quiet = true) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: quiet ? 'pipe' : 'inherit' })

/**
 * The consumer file. Touches a value, a type and a hook from each package, plus the fields the
 * most recent waves added, so a new export that is not actually reachable fails here.
 *
 * **This string is source that NO typecheck in the repository compiles** (MK-096). It is a
 * template literal to `tsc`'s eyes, so `pnpm typecheck` cannot see it, and the only thing that
 * compiles it is this gate, which CI does not run. A breaking change to the public surface
 * therefore leaves it stale and silent until somebody reaches step 6 of the release runbook. It
 * went stale in the P17 wave exactly that way: MK-088 removed
 * `EvaluateRedeemInput.interestRateBps` and all four rows failed on a probe nobody had compiled
 * since. Keep it updated with any public shape change, and read the failure as "the probe is
 * stale" before reading it as "the package is broken".
 */
const PROBE = `import { createMusdClient, evaluateRedeem, accruedInterest, netDebtOf, LastTroveInSystem, MCR, BORROWING_POWER_MARGIN_WINDOW_SECONDS, BORROWING_POWER_PRICE_MOVE_BPS, OracleStale, RedemptionPriceFragile, type BorrowingPower, type GasDecision, type OpenPreview, type RedeemResult, type RedemptionPreview, type RefinancePreview, type ClosePreview, type WriteResult } from '@musd-kit/core'
import { useAdjustTrovePreview, useBorrowPreview, useBorrowingCapacity, useBorrowingPowerDetail, useRefinancePreview, type AdjustPreviewLegs, type BorrowPreview } from '@musd-kit/react'
const d: GasDecision = { source: 'explicit', limit: 1n }
const w: WriteResult = { hash: '0x00', gas: d }
declare const p: OpenPreview
declare const r: RedeemResult
declare const c: ClosePreview
// MK-088. Each eligible Trove carries its OWN principal and rate; there is no shared rate.
const rp: RedemptionPreview = evaluateRedeem({
  amount: 1n, musdBalance: 1n, minNetDebt: 1n, tcr: MCR, price: 1n, globalInterestRateBps: 100n,
  eligible: [{ owner: '0x00', entireDebt: 1n, principal: 1n, netDebt: 1n, interestRateBps: 100n, collateral: 1n, interestOwed: 0n }],
})
// MK-103. The partial a redemption ends on, with its price tolerances.
const fragile: boolean | undefined = rp.partial?.priceFragile
// MK-100. Two figures, named, and the margin they differ by.
declare const power: BorrowingPower
const figures: [bigint, bigint, bigint, bigint] = [power.ceiling, power.recommended, power.margin.stressedPrice, BORROWING_POWER_PRICE_MOVE_BPS * BORROWING_POWER_MARGIN_WINDOW_SECONDS]
// MK-101. The rate a refinance moves to and the capacity it resets.
declare const refi: RefinancePreview
const refiFigures: [number, bigint] = [refi.resultingInterestRateBps, refi.resultingCapacity]
declare const borrowPreview: BorrowPreview
// MK-085. An absent leg stays absent, which is what the shape exists to express.
const legs: AdjustPreviewLegs = { addCollateral: 1n }
// MK-089, MK-094. The single-sourced protocol helpers, reachable from the package.
const i: bigint = accruedInterest({ principal: 1n, rateBps: 100n, seconds: 600n }) + netDebtOf(1n)
const check: [boolean, bigint, bigint, bigint, bigint, bigint, bigint, bigint] = [
  p.viable, p.resultingTcr, r.redemptionRate, MCR, rp.accrualMargin, rp.nextViableAmount, c.musdRequired, i,
]
void [createMusdClient, useAdjustTrovePreview, useBorrowPreview, useBorrowingCapacity, useBorrowingPowerDetail, useRefinancePreview, LastTroveInSystem, OracleStale, RedemptionPriceFragile, legs, w, check, figures, refiFigures, borrowPreview]
`

const ROWS = [
  { type: undefined, module: 'node16', moduleResolution: 'node16' },
  { type: undefined, module: 'esnext', moduleResolution: 'bundler' },
  { type: 'module', module: 'node16', moduleResolution: 'node16' },
  { type: 'module', module: 'esnext', moduleResolution: 'bundler' },
]

console.log('Packaging gate (MK-040). Building and packing the real tarballs.\n')
rmSync(WORK, { recursive: true, force: true })
mkdirSync(PACK, { recursive: true })
mkdirSync(CONSUMER, { recursive: true })

run('pnpm', ['-s', 'build'], ROOT)
for (const pkg of ['core', 'react']) {
  run('pnpm', ['-s', 'pack', '--pack-destination', PACK], join(ROOT, 'packages', pkg))
}
const version = JSON.parse(readFileSync(join(ROOT, 'packages/core/package.json'), 'utf8')).version
const tarballs = [`musd-kit-core-${version}.tgz`, `musd-kit-react-${version}.tgz`].map((f) =>
  join(PACK, f),
)
for (const t of tarballs) {
  if (!existsSync(t)) throw new Error(`expected tarball missing: ${t}`)
}

run('npm', ['init', '-y'], CONSUMER)
run(
  'npm',
  ['i', '--silent', ...tarballs, 'viem@^2', 'react@^18', 'wagmi@^2', '@tanstack/react-query@^5'],
  CONSUMER,
)
run('npm', ['i', '--silent', '-D', 'typescript@5', '@types/react@18', '@types/node@20'], CONSUMER)
writeFileSync(join(CONSUMER, 'probe.ts'), PROBE)

// MK-108. The quickstart, exactly as the packed README carries it.
const README_DIR = join(WORK, 'readme')
mkdirSync(README_DIR, { recursive: true })
run('tar', ['xzf', tarballs[0], '-C', README_DIR, 'package/README.md'], ROOT)
const packedReadme = readFileSync(join(README_DIR, 'package/README.md'), 'utf8')
const quickstartSection = packedReadme.split('\n## Quickstart\n')[1]?.split('\n## ')[0] ?? ''
const QUICKSTART = /```ts\n([\s\S]*?)\n```/.exec(quickstartSection)?.[1]
if (!QUICKSTART) {
  throw new Error(
    'the packed core README has no ```ts block under "## Quickstart"; the gate would be vacuous',
  )
}
// `export {}` makes the file a module, so its top level `await` is legal where modules allow it.
writeFileSync(join(CONSUMER, 'quickstart.ts'), `${QUICKSTART}\nexport {}\n`)

/** The ESM rows compile the quickstart too; top level `await` cannot exist in a CommonJS module. */
const compilesQuickstart = (row) => row.type === 'module'

const tscFor = (row, skipLibCheck) => {
  const pkgPath = join(CONSUMER, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  // `undefined` rather than `delete`: JSON.stringify omits undefined values, so the key is absent
  // in the written file either way, and biome's noDelete rule is satisfied.
  pkg.type = row.type ?? undefined
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))
  writeFileSync(
    join(CONSUMER, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: row.module,
        moduleResolution: row.moduleResolution,
        target: 'es2022',
        strict: true,
        noEmit: true,
        skipLibCheck,
        jsx: 'react-jsx',
        lib: ['es2022', 'dom'],
      },
      include: compilesQuickstart(row) ? ['probe.ts', 'quickstart.ts'] : ['probe.ts'],
    }),
  )
  try {
    run(join(CONSUMER, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.json'], CONSUMER)
    return { ok: true, first: '' }
  } catch (error) {
    const out = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim()
    return { ok: false, first: out.split('\n')[0] ?? 'no output' }
  }
}

let failed = 0
const report = (skipLibCheck) => {
  console.log(`\nconfiguration: skipLibCheck=${skipLibCheck}, strict=true, target=es2022`)
  console.log(
    `  package.json "type"      module            moduleResolution   result   files                    packages@${version}`,
  )
  for (const row of ROWS) {
    const r = tscFor(row, skipLibCheck)
    const label = row.type ?? '(absent, CommonJS)'
    const files = compilesQuickstart(row) ? 'probe + README quickstart' : 'probe only'
    console.log(
      `  ${label.padEnd(24)} ${row.module.padEnd(17)} ${row.moduleResolution.padEnd(18)} ${
        r.ok ? 'PASS' : 'FAIL'
      }     ${files}`,
    )
    if (!r.first) continue
    console.log(`      first error: ${r.first}`)
    if (skipLibCheck) failed++
  }
}

report(true)
if (STRICT) {
  report(false)
  console.log(
    '\nThe skipLibCheck=false rows are REPORTED, not gated, and what fails is BOTH node16 rows\n' +
      'rather than the CommonJS ones. The cause is a dependency: @mezo-org/chains ships no "type"\n' +
      'and no exports map, so node16 resolves its types as CommonJS, and they import from viem,\n' +
      'which is ESM only. That is TS1542, and it happens whatever the consumer sets "type" to.\n' +
      'This package contributes TS1479 from its own dist/index.d.cts for the same upstream reason.\n' +
      'None of it is fixable here, and dropping the CommonJS build would not turn a single one of\n' +
      'these rows green, because the failing axis is moduleResolution and not our output format.',
  )
}

// Both runtimes must still resolve, since a types fix must not break them.
const cjsKeys = run(
  'node',
  ['-e', "console.log(Object.keys(require('@musd-kit/core')).length)"],
  CONSUMER,
).trim()
const esmKeys = run(
  'node',
  [
    '--input-type=module',
    '-e',
    "import * as m from '@musd-kit/core'; console.log(Object.keys(m).length)",
  ],
  CONSUMER,
).trim()
console.log(`\nruntime resolution: require=${cjsKeys} exports, import=${esmKeys} exports`)

const files = run('tar', ['tzf', tarballs[0]], ROOT).trim().split('\n').sort()
console.log(`tarball contents (core, ${files.length} entries):`)
for (const f of files) console.log(`  ${f}`)

console.log(
  failed === 0
    ? '\nGATE PASSED, under the configuration printed above.'
    : `\nGATE FAILED: ${failed} of ${ROWS.length} gated rows.`,
)
process.exit(failed === 0 ? 0 : 1)
