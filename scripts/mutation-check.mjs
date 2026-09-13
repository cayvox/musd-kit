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
 * **Three runners.** Most pins are chain free and run in the `unit` project. Some defects can only
 * be pinned on a fork (a Trove liquidatable an hour after it opened, a redemption sent after a real
 * delay, a real `PriceFeed` revert), and the packaged quickstart is pinned by the packaging gate.
 * Those mutations name `runner: 'fork'` with the fork `files` that pin them, or `runner: 'gate'`,
 * and run only with `--all`, because they need anvil, an RPC URL and several minutes each. Without
 * `--all` they are LISTED as not run, never counted as caught.
 *
 *   node scripts/mutation-check.mjs          unit mutations
 *   node scripts/mutation-check.mjs --check  only confirm every mutation still matches its file
 *   MEZO_TESTNET_RPC_URL=... MEZO_FORK_BLOCK=15043414 node scripts/mutation-check.mjs --all
 *
 * Exit 0 when every mutation that ran is caught by at least one test, non zero otherwise.
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
    from: '    const consumesWhole = remaining >= trove.netDebt + marginFor(trove, marginSeconds)',
    to: '    const consumesWhole = remaining >= trove.netDebt + marginFor(eligible[0] ?? trove, marginSeconds)',
  },
  {
    id: 'MK-095 window (the margin is sized ABOVE the window it advertises)',
    what: 'size the margin at the advertised 600 seconds, leaving nothing for the settlement block',
    file: 'packages/core/src/math/previewRedeem.ts',
    from: 'export const REDEMPTION_ADVICE_MARGIN_SECONDS = 900n',
    to: 'export const REDEMPTION_ADVICE_MARGIN_SECONDS = 600n',
  },
  {
    id: 'MK-089 base (interest accrues on the PRINCIPAL)',
    what: 'accrue the margin on the entire debt again, which compounds what the protocol does not',
    file: 'packages/core/src/math/previewRedeem.ts',
    // The P21 wave put a second `principal: trove.principal` above the margin's, in the partial
    // band, and this `from` silently moved onto it: the check still "matched" and caught nothing.
    // It names the margin's own line now; the band's base has a mutation of its own below.
    from: '  return accruedInterest({ principal: trove.principal, rateBps: trove.interestRateBps, seconds })',
    to: '  return accruedInterest({ principal: trove.entireDebt, rateBps: trove.interestRateBps, seconds })',
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

  // --- P21. The audit of the published 0.3.1 (MK-100 to MK-109). ----------------------------

  {
    id: 'MK-100 stress',
    what: 'solve the recommended figure at the real price, so it equals the ceiling',
    file: 'packages/core/src/math/getBorrowingPower.ts',
    from: '  const stressedPrice =\n    (price * (10_000n - priceMoveBps) * E18) / (10_000n * (E18 + accrualFraction))',
    to: '  const stressedPrice =\n    price',
  },
  {
    id: 'MK-100 accrual',
    what: 'leave the interest window out of the margin',
    file: 'packages/core/src/math/getBorrowingPower.ts',
    from: '    (interestRateBps * windowSeconds * E18 + accrualDenominator - 1n) / accrualDenominator',
    to: '    0n',
  },
  {
    id: 'MK-100 constant',
    what: 'lower the price move under the measured worst hour',
    file: 'packages/core/src/math/getBorrowingPower.ts',
    from: 'export const BORROWING_POWER_PRICE_MOVE_BPS = 200n',
    to: 'export const BORROWING_POWER_PRICE_MOVE_BPS = 150n',
  },
  {
    id: 'MK-100 hook',
    what: 'return the ceiling from useBorrowingPower again',
    file: 'packages/react/src/hooks/reads.ts',
    from: '  return useBorrowingPowerQuery(params, (power) => power.recommended)',
    to: '  return useBorrowingPowerQuery(params, (power) => power.ceiling)',
  },
  {
    id: 'MK-100 override window',
    what: 'accept a negative margin window, which hands back the ceiling as recommended',
    file: 'packages/core/src/math/getBorrowingPower.ts',
    from: '  if (params.marginWindowSeconds !== undefined && params.marginWindowSeconds < 0n) {',
    to: '  if (false as boolean) {',
  },
  {
    id: 'MK-100 override move',
    what: 'accept a price move outside 0 to 10000 basis points',
    file: 'packages/core/src/math/getBorrowingPower.ts',
    from: '    (params.priceMoveBps < 0n || params.priceMoveBps >= 10_000n)',
    to: '    (false as boolean)',
  },
  {
    id: 'MK-100 override ignored',
    what: 'accept a price move override and solve with the default anyway',
    file: 'packages/core/src/math/getBorrowingPower.ts',
    from: '  const priceMoveBps = params.priceMoveBps ?? BORROWING_POWER_PRICE_MOVE_BPS',
    to: '  const priceMoveBps = BORROWING_POWER_PRICE_MOVE_BPS',
  },
  {
    id: 'MK-100 hook override',
    what: 'drop the margin override between the hook and the core call',
    file: 'packages/react/src/hooks/reads.ts',
    from: '        ...margin,\n',
    to: '',
  },
  {
    id: 'MK-100 hook key',
    what: 'leave the margin out of the query key, so two margins share one answer',
    file: 'packages/react/src/hooks/reads.ts',
    from: '    queryKey: musdQueryKeys.borrowingPower(chainId, collateral ?? 0n, who, margin),',
    to: '    queryKey: musdQueryKeys.borrowingPower(chainId, collateral ?? 0n, who),',
  },
  {
    id: 'MK-101 rate',
    what: 'report the current rate as the rate a refinance moves to',
    file: 'packages/core/src/math/previewRefinance.ts',
    from: '    resultingInterestRateBps: globalInterestRateBps,',
    to: '    resultingInterestRateBps: currentInterestRateBps,',
  },
  {
    id: 'MK-101 capacity',
    what: 'treat the refinance capacity as a ratchet again',
    file: 'packages/core/src/math/previewRefinance.ts',
    from: '    resultingCapacity: maxBorrowingCapacityAt(collateral, price),',
    to: '    resultingCapacity: currentCapacity,',
  },
  {
    id: 'MK-102 disabled',
    what: 'let a disabled query show whatever its cache holds',
    file: 'packages/react/src/internal/useMusdQuery.ts',
    from: '  if (!enabled) {',
    to: '  if (!enabled && clientError !== null) {',
  },
  {
    id: 'MK-102 placeholder',
    what: 'serve the previous key as placeholder data again',
    file: 'packages/react/src/internal/useMusdQuery.ts',
    from: '    gcTime: 0,',
    to: '    gcTime: 0,\n    placeholderData: (previous: unknown) => previous,',
  },
  {
    id: 'MK-102 gcTime',
    what: 'keep an unobserved key in the cache, so returning to it serves its old answer',
    file: 'packages/react/src/internal/useMusdQuery.ts',
    from: '    gcTime: 0,',
    to: '',
  },
  {
    id: 'MK-102 writes',
    what: 'stop resetting a write when the account changes',
    file: 'packages/react/src/hooks/writes.ts',
    from: '      lastIdentity.current = identity\n      reset()',
    to: '      lastIdentity.current = identity',
  },
  {
    id: 'MK-103 hint',
    what: "send the hint helper's lower edge instead of the centre of the band",
    file: 'packages/core/src/math/previewRedeem.ts',
    from: '  const hintNicr = (low + high) / 2n',
    to: '  const hintNicr = low',
  },
  {
    id: 'MK-103 band base',
    what: "size the partial's band on the entire debt instead of the pre-redemption principal",
    file: 'packages/core/src/math/previewRedeem.ts',
    from: '  const band = accruedInterest({\n    principal: trove.principal,',
    to: '  const band = accruedInterest({\n    principal: trove.entireDebt,',
  },
  {
    id: 'MK-103 refusal',
    what: 'send a price fragile first-Trove partial without being told to',
    file: 'packages/core/src/redemption/redeem.ts',
    from: '    partial?.revertsCallIfCancelled &&\n    partial.priceFragile &&\n    !params.acceptPriceFragilePartial',
    to: '    (false as boolean)',
  },
  {
    id: 'MK-104',
    what: 're-apply the advice margin when sending, so redeem() refuses its own advice',
    file: 'packages/core/src/redemption/redeem.ts',
    from: '      marginSeconds: REDEMPTION_SEND_MARGIN_SECONDS,',
    to: '      marginSeconds: REDEMPTION_ADVICE_MARGIN_SECONDS,',
  },
  {
    id: 'MK-105 wrapper',
    what: 'let a revert outside simulate through untyped',
    file: 'packages/core/src/errors/mapRevert.ts',
    from: '  try {\n    return await run()\n  } catch (error) {\n    throw mapRevert(error, context)\n  }',
    to: '  return run()',
  },
  {
    id: 'MK-105 oracle',
    what: 'stop recognising the stale oracle revert',
    file: 'packages/core/src/errors/mapRevert.ts',
    from: '  if (has(/Oracle is stale/i)) return new OracleStale(error)\n',
    to: '',
  },
  {
    id: 'MK-106',
    what: 'stop defaulting the account to the connected wallet',
    file: 'packages/react/src/hooks/reads.ts',
    from: '  const who = account ?? connected',
    to: '  const who = account',
  },
  {
    id: 'MK-107',
    what: 'charge maxIterations for the sub-MCR Troves skipped before the loop',
    file: 'packages/core/src/math/previewRedeem.ts',
    from: '    if (started) i++',
    to: '    i++',
  },

  // Fork and gate pins. Run with --all.
  {
    id: 'MK-100 fork',
    what: 'solve the recommended figure at the real price, then open at it and wait an hour',
    runner: 'fork',
    files: ['packages/core/test/zz-borrowing-power-boundary.fork.test.ts'],
    file: 'packages/core/src/math/getBorrowingPower.ts',
    from: '  const stressedPrice =\n    (price * (10_000n - priceMoveBps) * E18) / (10_000n * (E18 + accrualFraction))',
    to: '  const stressedPrice =\n    price',
  },
  {
    id: 'MK-101 fork',
    what: 'treat the refinance capacity as a ratchet, then refinance after a rise and a fall on chain',
    runner: 'fork',
    files: ['packages/core/test/zz-refinance.fork.test.ts'],
    file: 'packages/core/src/math/previewRefinance.ts',
    from: '    resultingCapacity: maxBorrowingCapacityAt(collateral, price),',
    to: '    resultingCapacity: currentCapacity,',
  },
  {
    id: 'MK-103 fork',
    what: "send the hint helper's lower edge, then move the price inside the tolerance",
    runner: 'fork',
    files: ['packages/core/test/redeem-boundary.fork.test.ts'],
    file: 'packages/core/src/math/previewRedeem.ts',
    from: '  const hintNicr = (low + high) / 2n',
    to: '  const hintNicr = low',
  },
  {
    id: 'MK-104 fork',
    what: 're-apply the advice margin when sending, then send the advice after a delay',
    runner: 'fork',
    files: ['packages/core/test/redeem-boundary.fork.test.ts'],
    file: 'packages/core/src/redemption/redeem.ts',
    from: '      marginSeconds: REDEMPTION_SEND_MARGIN_SECONDS,',
    to: '      marginSeconds: REDEMPTION_ADVICE_MARGIN_SECONDS,',
  },
  {
    id: 'MK-105 fork',
    what: 'let a revert outside simulate through untyped, against the real stale PriceFeed',
    runner: 'fork',
    files: ['packages/core/test/zz-typed-errors.fork.test.ts'],
    file: 'packages/core/src/errors/mapRevert.ts',
    from: '  try {\n    return await run()\n  } catch (error) {\n    throw mapRevert(error, context)\n  }',
    to: '  return run()',
  },
  {
    id: 'MK-108 gate',
    what: 'ship a quickstart that uses parseBtc and parseMusd without importing them',
    runner: 'gate',
    file: 'packages/core/README.md',
    from: "import { createMusdClient, mezoTestnet, parseBtc, parseMusd } from '@musd-kit/core'",
    to: "import { createMusdClient, mezoTestnet } from '@musd-kit/core'",
  },
]

const ALL = process.argv.includes('--all')

/**
 * Run the pins for one mutation and return what failed.
 *
 * `unit` runs the chain-free project. `fork` runs only the named fork files, since the full fork
 * project takes many minutes. `gate` runs the packaging gate, and a non zero exit is its failure.
 * The fork files import `../src`, so a fork mutation needs no build; the gate runs its own build.
 */
function failingTests(m = { runner: 'unit' }) {
  const runner = m.runner ?? 'unit'
  let out = ''
  let exitCode = 0
  const exec = (cmd, args) => {
    try {
      return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      exitCode = error.status ?? 1
      return `${error.stdout ?? ''}${error.stderr ?? ''}`
    }
  }
  if (runner === 'gate') {
    out = exec('node', ['scripts/packaging-gate.mjs'])
    return exitCode === 0
      ? []
      : out
          .split('\n')
          .filter((l) => /FAIL|first error/.test(l))
          .map((l) => l.trim())
  }
  if (runner === 'fork') {
    out = exec('pnpm', ['exec', 'vitest', 'run', '--project', 'fork', ...m.files])
  } else {
    out = exec('pnpm', ['exec', 'vitest', 'run', '--project', 'unit'])
  }
  const tag = runner === 'fork' ? 'FAIL |fork|' : 'FAIL |unit|'
  return [
    ...new Set(
      out
        .split('\n')
        .filter((l) => l.includes(tag))
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

// `--check` confirms every mutation still matches its file, without running a single test, so a
// stale entry is found in a second rather than an hour into a run.
if (process.argv.includes('--check')) {
  let stale = 0
  for (const m of MUTATIONS) {
    const src = readFileSync(m.file, 'utf8')
    const ok = src.includes(m.from) && (!m.also || src.replace(m.from, m.to).includes(m.also.from))
    if (!ok) {
      stale++
      console.log(`STALE ${m.id}: ${m.file}`)
    }
  }
  console.log(`${MUTATIONS.length - stale} of ${MUTATIONS.length} mutations match their files`)
  process.exit(stale === 0 ? 0 : 1)
}

const baseline = failingTests()
if (baseline.length > 0) {
  console.error('The suite is already red before any mutation. Fix that first:')
  for (const f of baseline) console.error(`  ${f}`)
  process.exit(1)
}
console.log('baseline: unit project green\n')

let uncaught = 0
const notRun = []
for (const m of MUTATIONS) {
  const runner = m.runner ?? 'unit'
  if (runner !== 'unit' && !ALL) {
    notRun.push(m)
    continue
  }
  const restore = apply(m)
  try {
    const failed = failingTests(m)
    if (failed.length === 0) uncaught++
    console.log(`${m.id} [${runner}]: ${m.what}`)
    console.log(
      `  caught by ${failed.length} ${runner === 'gate' ? 'gate line' : 'test'}${failed.length === 1 ? '' : 's'}`,
    )
    for (const f of failed) console.log(`    ${f.replace(/FAIL \|(unit|fork)\|\s+/, '')}`)
    console.log('')
  } finally {
    restore()
  }
}
for (const m of notRun) console.log(`${m.id} [${m.runner}]: NOT RUN, pass --all (${m.what})`)

if (uncaught > 0) {
  console.error(`${uncaught} mutation(s) were caught by NOTHING. Each is an unpinned fix.`)
  process.exit(1)
}
console.log('every mutation is caught by at least one test')
