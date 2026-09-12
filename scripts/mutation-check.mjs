#!/usr/bin/env node
/**
 * Mutation evidence for the pins a wave adds: put the defect back, one at a time, and check
 * that the test written for it actually fails.
 *
 * **Why this is a committed script rather than a description of what someone did once.**
 * `docs/08-conventions.md` §10 makes a measurement citable only when the code that produced it
 * is in the repository and someone else can run it. "The test fails without the fix" is a
 * measurement, and it is the one that separates a pin from a test that happens to pass. It is
 * also the measurement most likely to be wrong: this script is what caught that the MK-060
 * write half pin did NOT fail with its fix removed, because the evaluator half refused the same
 * call and the assertion could not tell the two apart. That test now asserts the throw happens
 * before any chain read, and this run is what proves it.
 *
 * Each mutation is an exact string replacement in a source file. If a replacement no longer
 * matches, the run FAILS rather than silently reporting the mutation as ineffective, because a
 * stale mutation and a missing pin look identical in the output otherwise.
 *
 *   node scripts/mutation-check.mjs
 *
 * Exit 0 when every mutation is caught by at least one test, non zero otherwise.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const MUTATIONS = [
  {
    id: 'MK-058',
    what: 'drop the Recovery Mode ICR non-decrease rule',
    file: 'packages/core/src/math/previewAdjust.ts',
    from: "      if (resultingIcr < currentIcr) reasons.push('ICR_NOT_IMPROVED_IN_RECOVERY_MODE')\n",
    to: '',
  },
  {
    id: 'MK-059',
    what: 'apply the TCR gate unconditionally, outside the normal-mode branch',
    file: 'packages/core/src/math/previewAdjust.ts',
    from:
      '  } else {\n' +
      "    if (resultingIcr < icrThreshold) reasons.push('ICR_BELOW_THRESHOLD')\n" +
      "    if (resultingTcr < CCR) reasons.push('TCR_BELOW_CCR')\n" +
      '  }',
    to:
      '  } else {\n' +
      "    if (resultingIcr < icrThreshold) reasons.push('ICR_BELOW_THRESHOLD')\n" +
      '  }\n' +
      "  if (resultingTcr < CCR) reasons.push('TCR_BELOW_CCR')",
  },
  {
    id: 'MK-060 evaluator',
    what: 'derive the debt increase flag from the value again',
    file: 'packages/core/src/math/previewAdjust.ts',
    from: 'const isDebtIncrease = input.isDebtIncrease ?? increaseDebt > 0n',
    to: 'const isDebtIncrease = increaseDebt > 0n',
  },
  {
    id: 'MK-060 write path',
    what: 'drop the borrow-leg amount validation from adjustTrove',
    file: 'packages/core/src/trove/index.ts',
    from: "  if (brw !== undefined) assertPositiveAmount('borrow', brw)\n",
    to: '',
  },
  {
    id: 'MK-065',
    what: 'report the capacity gate before the ratio gates',
    file: 'packages/core/src/math/previewAdjust.ts',
    from: '  if (isRecoveryMode) {',
    to:
      "  if (isDebtIncrease && capacity < resultingEntireDebt) reasons.push('EXCEEDS_BORROWING_CAPACITY')\n" +
      '  if (isRecoveryMode) {',
    also: {
      from:
        "  if (isDebtIncrease && capacity < resultingEntireDebt) reasons.push('EXCEEDS_BORROWING_CAPACITY')\n\n" +
        '  if (!isDebtIncrease && repayDebt > 0n) {',
      to: '  if (!isDebtIncrease && repayDebt > 0n) {',
    },
  },

  // --- P13. One rule implemented five times, and the tests that could only agree. -----------

  {
    id: 'MK-067',
    what: 'charge the borrowing fee unconditionally in getBorrowingPower again',
    file: 'packages/core/src/math/getBorrowingPower.ts',
    from: '  const chargesFee = isBorrowingFeeCharged(isRecoveryMode, feeExempt)',
    to: '  const chargesFee = true',
  },
  {
    id: 'MK-067 exemption',
    what: 'stop reading the exemption, so an exempt account gets the non-exempt maximum',
    file: 'packages/core/src/math/getBorrowingPower.ts',
    from:
      '  const feeExempt =\n' +
      '    !isRecoveryMode && params.account !== undefined\n' +
      '      ? await deps.isAccountFeeExempt(params.account)\n' +
      '      : false',
    to: '  const feeExempt = false',
  },
  {
    id: 'MK-068',
    what: 'send the open path back to the raw fee getter',
    file: 'packages/core/src/trove/index.ts',
    from: '  const fee = await effectiveBorrowingFee(deps, wallet.account.address, debt)',
    to: '  const fee = await getBorrowingFee(deps, debt)',
  },
  {
    id: 'MK-071',
    what: 'restore the 365 day year in the interest formula',
    file: 'packages/core/src/math/compute.ts',
    // Retargeted in the P17 wave: MK-089 moved the formula out of `previewRedeem.ts` into the
    // one copy here, so the divisor this finding is about now lives at a single site.
    from: '  return (principal * rateBps * seconds) / (BPS_DIVISOR * SECONDS_PER_YEAR)',
    to: '  return (principal * rateBps * seconds) / (BPS_DIVISOR * 365n * 24n * 3600n)',
  },
  {
    id: 'MK-074 close',
    what: 'drop the last Trove gate from the close preview',
    file: 'packages/core/src/math/previewClose.ts',
    from: "    reasons.push('LAST_TROVE_IN_SYSTEM')",
    to: '    void 0',
  },
  {
    id: 'MK-074 liquidate',
    what: 'let the last Trove be reported liquidatable again',
    file: 'packages/core/src/math/compute.ts',
    from: '  if (troveOwnersCount !== undefined && troveOwnersCount <= 1n) return false',
    to: '  void troveOwnersCount',
  },
  {
    id: 'MK-075',
    what: 'report the refinance reasons in the order the contract does not use',
    file: 'packages/core/src/math/previewRefinance.ts',
    // Retargeted in the P17 wave: MK-094 replaced the bare `1` with `TroveStatus.active`, so
    // the two lines this swaps no longer read as they did.
    from:
      "  if (isRecoveryMode) reasons.push('RECOVERY_MODE')\n" +
      '  // MK-094. The enum, not the literal. `TroveStatus.active` is `1`\n' +
      '  // (`TroveManager` `Status`), and three evaluators spelled it as a bare number while two\n' +
      '  // others used the enum for the same comparison.\n' +
      "  if (status !== TroveStatus.active) reasons.push('TROVE_NOT_ACTIVE')",
    to:
      "  if (status !== TroveStatus.active) reasons.push('TROVE_NOT_ACTIVE')\n" +
      "  if (isRecoveryMode) reasons.push('RECOVERY_MODE')",
  },
  {
    id: 'MK-076',
    what: 'call every zero withdrawal an ICR limit again',
    file: 'packages/core/src/math/previewAdjust.ts',
    from: "  const limitedBy = byIcr <= bySystem ? 'ICR' : 'TCR'",
    to: "  const limitedBy = amount === 0n || byIcr <= bySystem ? 'ICR' : 'TCR'",
  },
  // --- P16. The gate that decides whether the sweep's red is worth reading. ------------------

  {
    id: 'MK-084 subject (a message must OPEN by naming its version)',
    what: 'accept any message that merely mentions the version, which is the weak check that let 0.1.0 text pass under 0.2.0',
    file: 'scripts/deprecation-message.mjs',
    from: '  if (!message.startsWith(opening)) {',
    to: '  if (!message.includes(version)) {',
  },
  {
    id: 'MK-084 unknown version (an unwritten version must be REFUSED)',
    what: "fall back to some other version's entry instead of refusing, which is the defect itself",
    file: 'scripts/deprecation-message.mjs',
    from: '  const entry = Object.hasOwn(DEPRECATIONS, version) ? DEPRECATIONS[version] : undefined',
    to: '  const entry = DEPRECATIONS[version] ?? Object.values(DEPRECATIONS)[0]',
  },
  {
    id: 'MK-079 swallows (an unexpected mismatch must FAIL)',
    what: 'match every mismatch against the first registry entry, so an unregistered one is swallowed',
    file: 'packages/core/test/differential/expected.ts',
    from: '    const hit = registry.find((e) => e.matches(m))',
    to: '    const hit = registry[0]',
  },
  {
    id: 'MK-079 registry (a registered mismatch must NOT fail)',
    what: 'match nothing, so the registered mismatches go back to failing the run',
    file: 'packages/core/test/differential/expected.ts',
    from: '    const hit = registry.find((e) => e.matches(m))',
    to: '    const hit = undefined',
  },
  // --- P17. The redemption margin, and the interest formula it restated. -------------------

  {
    id: "MK-088 rate (the margin uses the TARGET Trove's rate)",
    what: "size every Trove's margin from the first Trove's rate, which is what one shared rate did",
    file: 'packages/core/src/math/previewRedeem.ts',
    from: '    const consumesWhole = remaining >= trove.netDebt + marginFor(trove)',
    to: '    const consumesWhole = remaining >= trove.netDebt + marginFor(eligible[0] ?? trove)',
  },
  {
    id: 'MK-095 window (the margin is sized ABOVE the window it advertises)',
    what: 'size the margin at the advertised 600 seconds, leaving nothing for the settlement block',
    file: 'packages/core/src/math/previewRedeem.ts',
    from: 'const MARGIN_WINDOW_SECONDS = 900n',
    to: 'const MARGIN_WINDOW_SECONDS = 600n',
  },
  {
    id: 'MK-089 base (interest accrues on the PRINCIPAL)',
    what: 'accrue the margin on the entire debt again, which compounds what the protocol does not',
    file: 'packages/core/src/math/previewRedeem.ts',
    from: '    principal: trove.principal,',
    to: '    principal: trove.entireDebt,',
  },

  // --- P17. The React package, which no gate had ever reached. ---------------------------

  {
    id: 'MK-085 hook (an absent leg must stay absent)',
    what: 'default the debt leg to zero and forward it, so every adjustment is a debt increase',
    file: 'packages/react/src/hooks/reads.ts',
    from: '    ...(params.increaseDebt !== undefined ? { increaseDebt: params.increaseDebt } : {}),',
    to: '    increaseDebt: params.increaseDebt ?? 0n,',
  },
  {
    id: 'MK-085 key (absent and zero must not share a cache entry)',
    what: 'encode an absent leg as zero in the query key, so the two questions collide',
    file: 'packages/react/src/internal/keys.ts',
    from: '      legs.increaseDebt?.toString() ?? null,',
    to: '      (legs.increaseDebt ?? 0n).toString(),',
  },

  {
    id: 'MK-077',
    what: 'silently drop the repayment leg again',
    file: 'packages/core/src/math/previewAdjust.ts',
    from: "  if (increaseDebt > 0n && repayDebt > 0n) reasons.push('DEBT_INCREASE_AND_REPAY')",
    to: '  void 0',
  },
]

/** Run the chain-free unit project and return the failing test names. */
function failingTests() {
  let out = ''
  try {
    out = execFileSync('pnpm', ['exec', 'vitest', 'run', '--project', 'unit'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    out = `${error.stdout ?? ''}${error.stderr ?? ''}`
  }
  return [
    ...new Set(
      out
        .split('\n')
        .filter((l) => l.includes('FAIL |unit|'))
        .map((l) => l.trim()),
    ),
  ]
}

function apply(m) {
  const original = readFileSync(m.file, 'utf8')
  if (!original.includes(m.from)) {
    throw new Error(`${m.id}: the mutation no longer matches ${m.file}. Update this script.`)
  }
  let next = original.replace(m.from, m.to)
  if (m.also) {
    if (!next.includes(m.also.from)) {
      throw new Error(`${m.id}: the second half no longer matches ${m.file}. Update this script.`)
    }
    next = next.replace(m.also.from, m.also.to)
  }
  writeFileSync(m.file, next)
  return () => writeFileSync(m.file, original)
}

const baseline = failingTests()
if (baseline.length > 0) {
  console.error('The suite is already red before any mutation. Fix that first:')
  for (const f of baseline) console.error(`  ${f}`)
  process.exit(1)
}
console.log('baseline: unit project green\n')

let uncaught = 0
for (const m of MUTATIONS) {
  const restore = apply(m)
  try {
    const failed = failingTests()
    if (failed.length === 0) uncaught++
    console.log(`${m.id}: ${m.what}`)
    console.log(`  caught by ${failed.length} test${failed.length === 1 ? '' : 's'}`)
    for (const f of failed) console.log(`    ${f.replace('FAIL |unit|  ', '')}`)
    console.log('')
  } finally {
    restore()
  }
}

if (uncaught > 0) {
  console.error(`${uncaught} mutation(s) were caught by NOTHING. Each is an unpinned fix.`)
  process.exit(1)
}
console.log('every mutation is caught by at least one test')
