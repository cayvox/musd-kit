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
    what: 'restore the shadowed 365 day year in the redemption margin',
    file: 'packages/core/src/math/previewRedeem.ts',
    from: '  return (entireDebt * interestRateBps * ACCRUAL_WINDOW_SECONDS) / (10_000n * SECONDS_PER_YEAR)',
    to: '  return (entireDebt * interestRateBps * ACCRUAL_WINDOW_SECONDS) / (10_000n * 365n * 24n * 3600n)',
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
    from:
      "  if (isRecoveryMode) reasons.push('RECOVERY_MODE')\n" +
      "  if (status !== 1) reasons.push('TROVE_NOT_ACTIVE')",
    to:
      "  if (status !== 1) reasons.push('TROVE_NOT_ACTIVE')\n" +
      "  if (isRecoveryMode) reasons.push('RECOVERY_MODE')",
  },
  {
    id: 'MK-076',
    what: 'call every zero withdrawal an ICR limit again',
    file: 'packages/core/src/math/previewAdjust.ts',
    from: "  const limitedBy = byIcr <= bySystem ? 'ICR' : 'TCR'",
    to: "  const limitedBy = amount === 0n || byIcr <= bySystem ? 'ICR' : 'TCR'",
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
