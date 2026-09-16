/**
 * The hand written mutations: each one a specific defect a finding named, put back to prove its pin
 * still catches it (MK-058 onward). Moved here from `scripts/mutation-check.mjs` in the MK-112 wave.
 *
 * **Every entry is anchored** (`anchor.mjs`): `scope` is the declaration it was written for,
 * `from` must occur exactly once inside it, and `fingerprint` is the enclosing statement as it was
 * when the mutation was written. The scopes and fingerprints below were derived from the tree at
 * `c345c07`, where every entry had last been run and caught (`node scripts/mutation-check.mjs --all`
 * in the P22 wave), and each scope was read against the entry's `what` before it was recorded.
 *
 * When `node scripts/mutation-check.mjs --check` reports a fingerprint mismatch, the code around the
 * mutation changed. Read the scope, confirm the mutation still puts back the defect its `what`
 * describes, and only then record the fingerprint it prints. Updating the value without reading the
 * code is exactly the drift MK-110 describes, done by hand.
 *
 * `runner: 'fork'` entries run their named fork files; `runner: 'gate'` runs the packaging gate.
 */
export const ENTRIES = [
  {
    id: 'MK-058',
    what: 'drop the Recovery Mode ICR non-decrease rule',
    file: 'packages/core/src/math/previewAdjust.ts',
    scope: 'evaluateAdjust',
    fingerprint: 'c56695320f250e3c',
    from: "      if (resultingIcr < currentIcr) reasons.push('ICR_NOT_IMPROVED_IN_RECOVERY_MODE')\n",
    to: '',
  },
  {
    id: 'MK-059',
    what: 'apply the TCR gate unconditionally, outside the normal-mode branch',
    file: 'packages/core/src/math/previewAdjust.ts',
    scope: 'evaluateAdjust',
    fingerprint: 'aa140304896f1467',
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
    what: 'ignore the debt increase flag a path states, so previewBorrow(0) is a no change instead of (0, true)',
    file: 'packages/core/src/math/previewAdjust.ts',
    scope: 'evaluateAdjust',
    fingerprint: '68934227abfb07bd',
    from: 'const isDebtIncrease = input.isDebtIncrease ?? adjustLegsOf({ increaseDebt }).isDebtIncrease',
    to: 'const isDebtIncrease = adjustLegsOf({ increaseDebt }).isDebtIncrease',
  },
  // 'MK-060 write path' is withdrawn by MK-244. It put back the removal of `adjustTrove`'s refusal of a zero
  // borrow leg; MK-244 removed that refusal on purpose, because a zero leg is encoded as no leg, which the
  // contract accepts (`BorrowerOperations.sol:1377-1386`). Its successors are 'MK-244 presence' and
  // 'MK-244 early'.
  {
    id: 'MK-065',
    what: 'report the capacity gate before the ratio gates',
    file: 'packages/core/src/math/previewAdjust.ts',
    scope: 'evaluateAdjust',
    fingerprint: 'aa140304896f1467',
    from: '  if (isRecoveryMode) {',
    to:
      "  if (isDebtIncrease && capacity < resultingEntireDebt) reasons.push('EXCEEDS_BORROWING_CAPACITY')\n" +
      '  if (isRecoveryMode) {',
    also: {
      fingerprint: 'ba47e0a288f1f773',
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
    scope: 'getBorrowingPowerUnchecked',
    fingerprint: '4f2e3f77feaca476',
    from: '  const chargesFee = isBorrowingFeeCharged(isRecoveryMode, feeExempt)',
    to: '  const chargesFee = true',
  },
  {
    id: 'MK-067 exemption',
    what: 'stop reading the exemption, so an exempt account gets the non-exempt maximum',
    file: 'packages/core/src/math/getBorrowingPower.ts',
    scope: 'getBorrowingPowerUnchecked',
    fingerprint: '56f5bbafaf814af3',
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
    scope: 'openTrove',
    fingerprint: '2717e89254ed549e',
    from: '  const fee = await effectiveBorrowingFee(deps, wallet.account.address, debt)',
    to: '  const fee = await getBorrowingFee(deps, debt)',
  },
  {
    id: 'MK-071',
    what: 'restore the 365 day year in the interest formula',
    file: 'packages/core/src/math/compute.ts',
    scope: 'accruedInterest',
    fingerprint: '6e4210eab805d430',
    // Retargeted in the P17 wave: MK-089 moved the formula out of `previewRedeem.ts` into the
    // one copy here, so the divisor this finding is about now lives at a single site.
    from: '  return (principal * rateBps * seconds) / (BPS_DIVISOR * SECONDS_PER_YEAR)',
    to: '  return (principal * rateBps * seconds) / (BPS_DIVISOR * 365n * 24n * 3600n)',
  },
  {
    id: 'MK-074 close',
    what: 'drop the last Trove gate from the close preview',
    file: 'packages/core/src/math/previewClose.ts',
    scope: 'evaluateClose',
    fingerprint: '0a8138a612965e89',
    from: "    reasons.push('LAST_TROVE_IN_SYSTEM')",
    to: '    void 0',
  },
  {
    id: 'MK-074 liquidate',
    what: 'let the last Trove be reported liquidatable again',
    file: 'packages/core/src/math/compute.ts',
    scope: 'isTroveLiquidatable',
    fingerprint: 'd68022715c46930f',
    from: '  if (troveOwnersCount !== undefined && troveOwnersCount <= 1n) return false',
    to: '  void troveOwnersCount',
  },
  {
    id: 'MK-075',
    what: 'report the refinance reasons in the order the contract does not use',
    file: 'packages/core/src/math/previewRefinance.ts',
    scope: 'evaluateRefinance',
    fingerprint: 'fc52bcbeb052a724',
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
    scope: 'computeMaxWithdrawable',
    fingerprint: 'f64df702e5bbda1e',
    from: "  const limitedBy = byIcr <= bySystem ? 'ICR' : 'TCR'",
    to: "  const limitedBy = amount === 0n || byIcr <= bySystem ? 'ICR' : 'TCR'",
  },
  // --- P16. The gate that decides whether the sweep's red is worth reading. ------------------

  {
    id: 'MK-084 subject (a message must OPEN by naming its version)',
    what: 'accept any message that merely mentions the version, which is the weak check that let 0.1.0 text pass under 0.2.0',
    file: 'scripts/deprecation-message.mjs',
    scope: 'assertMessageDescribes',
    fingerprint: 'c2b8f667edff3534',
    from: '  if (!message.startsWith(opening)) {',
    to: '  if (!message.includes(version)) {',
  },
  {
    id: 'MK-084 unknown version (an unwritten version must be REFUSED)',
    what: "fall back to some other version's entry instead of refusing, which is the defect itself",
    file: 'scripts/deprecation-message.mjs',
    scope: 'messageFor',
    fingerprint: 'ae29689632bf4e37',
    from: '  const entry = Object.hasOwn(DEPRECATIONS, version) ? DEPRECATIONS[version] : undefined',
    to: '  const entry = DEPRECATIONS[version] ?? Object.values(DEPRECATIONS)[0]',
  },
  {
    id: 'MK-079 swallows (an unexpected mismatch must FAIL)',
    what: 'match every mismatch against the first registry entry, so an unregistered one is swallowed',
    file: 'packages/core/test/differential/expected.ts',
    scope: 'partitionMismatches',
    fingerprint: 'a5957113613302f7',
    from: '    const hit = registry.find((e) => e.matches(m))',
    to: '    const hit = registry[0]',
  },
  {
    id: 'MK-079 registry (a registered mismatch must NOT fail)',
    what: 'match nothing, so the registered mismatches go back to failing the run',
    file: 'packages/core/test/differential/expected.ts',
    scope: 'partitionMismatches',
    fingerprint: 'a5957113613302f7',
    from: '    const hit = registry.find((e) => e.matches(m))',
    to: '    const hit = undefined',
  },
  // --- P17. The redemption margin, and the interest formula it restated. -------------------

  {
    id: "MK-088 rate (the margin uses the TARGET Trove's rate)",
    what: "size every Trove's margin from the first Trove's rate, which is what one shared rate did",
    file: 'packages/core/src/math/previewRedeem.ts',
    scope: 'evaluateRedeem',
    fingerprint: '9591ac88dd15881c',
    from: '    const consumesWhole = remaining >= trove.netDebt + marginFor(trove, marginSeconds)',
    to: '    const consumesWhole = remaining >= trove.netDebt + marginFor(eligible[0] ?? trove, marginSeconds)',
  },
  {
    id: 'MK-095 window (the margin is sized ABOVE the window it advertises)',
    what: 'size the margin at the advertised 600 seconds, leaving nothing for the settlement block',
    file: 'packages/core/src/math/previewRedeem.ts',
    scope: '',
    fingerprint: '4adf33cb61f74100',
    from: 'export const REDEMPTION_ADVICE_MARGIN_SECONDS = 900n',
    to: 'export const REDEMPTION_ADVICE_MARGIN_SECONDS = 600n',
  },
  {
    id: 'MK-089 base (interest accrues on the PRINCIPAL)',
    what: 'accrue the margin on the entire debt again, which compounds what the protocol does not',
    file: 'packages/core/src/math/previewRedeem.ts',
    scope: 'marginFor',
    fingerprint: '7b05e43550dc0656',
    // The P21 wave put a second `principal: trove.principal` above the margin's, in the partial
    // band, and this `from` silently moved onto it: the check still "matched" and caught nothing.
    // It names the margin's own line now; the band's base has a mutation of its own below.
    from: '  return accruedInterest({ principal: trove.principal, rateBps: trove.interestRateBps, seconds })',
    to: '  return accruedInterest({ principal: trove.entireDebt, rateBps: trove.interestRateBps, seconds })',
  },

  // --- P17. The React package, which no gate had ever reached. ---------------------------

  // 'MK-085 hook (an absent leg must stay absent)' is withdrawn by MK-244. It forwarded an absent debt leg as
  // `0n`, which made every adjustment a debt increase while the core read the flag from presence. Since
  // MK-244 the core reads legs by value, so `0n` and absent are the same call and the mutant puts back no
  // defect; the gate found it caught only by a key test that does not cite MK-085. What the hook must still
  // do, forward a non zero draw, is the decision site at `useAdjustTrovePreview.legs`, pinned by
  // 'MK-085, MK-244: a non zero draw reaches the core as a draw'.
  {
    id: 'MK-085 key (absent and zero must not share a cache entry)',
    what: 'encode an absent leg as zero in the query key, so the two questions collide',
    file: 'packages/react/src/internal/keys.ts',
    scope: 'musdQueryKeys.adjustPreview',
    fingerprint: 'e938dcef5f4351c6',
    from: '      legs.increaseDebt?.toString() ?? null,',
    to: '      (legs.increaseDebt ?? 0n).toString(),',
  },

  {
    id: 'MK-077',
    what: 'silently drop the repayment leg again',
    file: 'packages/core/src/math/previewAdjust.ts',
    scope: 'adjustShapeReasons',
    fingerprint: 'c9113f746abc129f',
    from: "  if (increaseDebt > 0n && repayDebt > 0n) reasons.push('DEBT_INCREASE_AND_REPAY')",
    to: '  void 0',
  },

  // --- P21. The audit of the published 0.3.1 (MK-100 to MK-109). ----------------------------

  {
    id: 'MK-240 stress',
    what: 'solve the margin draw at the real price, so it equals the ceiling whatever margin was asked',
    file: 'packages/core/src/math/getBorrowingPower.ts',
    scope: 'getBorrowingPowerUnchecked',
    fingerprint: '8486c9fc0044acaa',
    from: '  const stressedPrice =\n    (price * (10_000n - priceFallBps) * E18) / (10_000n * (E18 + accrualFraction))',
    to: '  const stressedPrice =\n    price',
  },
  {
    id: 'MK-240 accrual',
    what: 'leave the horizon out of the margin, so the draw answers the fall and not the hold',
    file: 'packages/core/src/math/getBorrowingPower.ts',
    scope: 'getBorrowingPowerUnchecked.accrualFraction',
    fingerprint: 'b6b1624ab38b5fb1',
    from: '    (interestRateBps * horizonSeconds * E18 + accrualDenominator - 1n) / accrualDenominator',
    to: '    0n',
  },
  {
    id: 'MK-240 default',
    what: 'default a missing horizon and fall to the one hour and 200 bps 0.4.x chose for the caller',
    file: 'packages/core/src/math/getBorrowingPower.ts',
    scope: 'assertMargin',
    fingerprint: '0d0d0d9a9a2a13e6',
    from: '  const { horizonSeconds, priceFallBps } = margin',
    to: '  const { horizonSeconds = 3600n, priceFallBps = 200n } = margin',
  },
  {
    id: 'MK-240 hook',
    what: 'return a bare number from useBorrowingPower again, one that reads as an amount to borrow',
    file: 'packages/react/src/hooks/reads.ts',
    scope: 'useBorrowingPower',
    fingerprint: 'cfc586d6bf656448',
    from: '    enabled: collateral !== undefined && collateral > 0n,\n  })',
    to: '    enabled: collateral !== undefined && collateral > 0n,\n    select: (p: BorrowingPower) => p.ceiling,\n  } as never)',
  },
  {
    id: 'MK-240 horizon range',
    what: 'accept a negative horizon, which hands back the ceiling as the margin draw',
    file: 'packages/core/src/math/getBorrowingPower.ts',
    scope: 'assertMargin',
    fingerprint: '737075e8abc5bf46',
    from: "  if (typeof horizonSeconds !== 'bigint' || horizonSeconds < 0n) {",
    to: "  if (typeof horizonSeconds !== 'bigint') {",
  },
  {
    id: 'MK-240 fall range',
    what: 'accept a price fall outside 0 to 10000 basis points',
    file: 'packages/core/src/math/getBorrowingPower.ts',
    scope: 'assertMargin',
    fingerprint: '21def0f4268a6ccd',
    from: "  if (typeof priceFallBps !== 'bigint' || priceFallBps < 0n || priceFallBps >= 10_000n) {",
    to: "  if (typeof priceFallBps !== 'bigint') {",
  },
  {
    id: 'MK-240 fall ignored',
    what: "accept the caller's fall and solve with a fixed one anyway",
    file: 'packages/core/src/math/getBorrowingPower.ts',
    scope: 'getBorrowingPowerUnchecked',
    fingerprint: 'd05406af231e3237',
    from: '    (price * (10_000n - priceFallBps) * E18) / (10_000n * (E18 + accrualFraction))',
    to: '    (price * (10_000n - 200n) * E18) / (10_000n * (E18 + accrualFraction))',
  },
  {
    id: 'MK-240 hook margin',
    what: "drop the caller's fall between the hook and the core call",
    file: 'packages/react/src/hooks/reads.ts',
    scope: 'useDrawForMargin.fetch',
    fingerprint: 'cf58702c81de1da1',
    from: '        priceFallBps: priceFallBps as bigint,\n',
    to: '        priceFallBps: 200n,\n',
  },
  {
    id: 'MK-240 hook key',
    what: 'leave the margin out of the query key, so two margins share one answer',
    file: 'packages/react/src/hooks/reads.ts',
    scope: 'useDrawForMargin',
    fingerprint: 'f8b044e05182dba6',
    from: '      horizonSeconds,\n      priceFallBps,\n    ),',
    to: '      undefined,\n      undefined,\n    ),',
  },
  {
    id: 'MK-101 rate',
    what: 'report the current rate as the rate a refinance moves to',
    file: 'packages/core/src/math/previewRefinance.ts',
    scope: 'evaluateRefinance',
    fingerprint: '14507e11ff980357',
    from: '    resultingInterestRateBps: globalInterestRateBps,',
    to: '    resultingInterestRateBps: currentInterestRateBps,',
  },
  {
    id: 'MK-101 capacity',
    what: 'treat the refinance capacity as a ratchet again',
    file: 'packages/core/src/math/previewRefinance.ts',
    scope: 'evaluateRefinance',
    fingerprint: '14507e11ff980357',
    from: '    resultingCapacity: maxBorrowingCapacityAt(collateral, price),',
    to: '    resultingCapacity: currentCapacity,',
  },
  {
    id: 'MK-102 disabled',
    what: 'let a disabled query show whatever its cache holds',
    file: 'packages/react/src/internal/useMusdQuery.ts',
    scope: 'useMusdQuery',
    fingerprint: '8f32c37e2d9467f0',
    from: '  if (!enabled) {',
    to: '  if (!enabled && clientError !== null) {',
  },
  {
    id: 'MK-102 placeholder',
    what: 'serve the previous key as placeholder data again',
    file: 'packages/react/src/internal/useMusdQuery.ts',
    scope: 'useMusdQuery.query',
    fingerprint: 'fa1ae1e227e33078',
    from: '    gcTime: 0,',
    to: '    gcTime: 0,\n    placeholderData: (previous: unknown) => previous,',
  },
  {
    id: 'MK-102 gcTime',
    what: 'keep an unobserved key in the cache, so returning to it serves its old answer',
    file: 'packages/react/src/internal/useMusdQuery.ts',
    scope: 'useMusdQuery.query',
    fingerprint: 'fa1ae1e227e33078',
    from: '    gcTime: 0,',
    to: '',
  },
  {
    id: 'MK-102 writes',
    what: 'stop resetting a write when the account changes',
    file: 'packages/react/src/hooks/writes.ts',
    scope: 'useMusdWrite',
    fingerprint: 'e63982b93c60277f',
    from: '      lastIdentity.current = identity\n      reset()',
    to: '      lastIdentity.current = identity',
  },
  {
    id: 'MK-103 hint',
    what: "send the hint helper's lower edge instead of the centre of the band",
    file: 'packages/core/src/math/previewRedeem.ts',
    scope: 'partialRedemptionBand',
    fingerprint: '4cc38cf634fddf46',
    from: '  const hintNicr = (low + high) / 2n',
    to: '  const hintNicr = low',
  },
  {
    id: 'MK-103 band base',
    what: "size the partial's band on the entire debt instead of the pre-redemption principal",
    file: 'packages/core/src/math/previewRedeem.ts',
    scope: 'partialRedemptionBand',
    fingerprint: '8ee29b19a3483e91',
    from: '  const band = accruedInterest({\n    principal: trove.principal,',
    to: '  const band = accruedInterest({\n    principal: trove.entireDebt,',
  },
  {
    id: 'MK-103 refusal',
    what: 'send a price fragile first-Trove partial without being told to',
    file: 'packages/core/src/redemption/redeem.ts',
    scope: 'redeem',
    fingerprint: 'ee92d711a6be2b7b',
    from: '    partial?.revertsCallIfCancelled &&\n    partial.priceFragile &&\n    !params.acceptPriceFragilePartial',
    to: '    (false as boolean)',
  },
  {
    id: 'MK-104',
    what: 're-apply the advice margin when sending, so redeem() refuses its own advice',
    file: 'packages/core/src/redemption/redeem.ts',
    scope: 'redeem.redemption',
    fingerprint: '5df8675f019fea28',
    from: '      marginSeconds: REDEMPTION_SEND_MARGIN_SECONDS,',
    to: '      marginSeconds: REDEMPTION_ADVICE_MARGIN_SECONDS,',
  },
  {
    id: 'MK-105 wrapper',
    what: 'let a revert outside simulate through untyped',
    file: 'packages/core/src/errors/mapRevert.ts',
    scope: 'withTypedErrors',
    fingerprint: '8ac29fe169cdfa5f',
    from: '  try {\n    return await run()\n  } catch (error) {\n    throw mapRevert(error, context)\n  }',
    to: '  return run()',
  },
  {
    id: 'MK-105 oracle',
    what: 'stop recognising the stale oracle revert',
    file: 'packages/core/src/errors/mapRevert.ts',
    scope: 'mapRevert',
    fingerprint: '773606afdbdada02',
    from: '  if (has(/Oracle is stale/i)) return new OracleStale(error)\n',
    to: '',
  },
  {
    id: 'MK-106',
    what: 'stop defaulting the account to the connected wallet',
    file: 'packages/react/src/hooks/reads.ts',
    scope: 'useOpenerAccount',
    fingerprint: '6fc4cb1814aaf2f5',
    from: '  return account ?? connected',
    to: '  return account',
  },
  {
    id: 'MK-107',
    what: 'charge maxIterations for the sub-MCR Troves skipped before the loop',
    file: 'packages/core/src/math/previewRedeem.ts',
    scope: 'previewRedeemUnchecked',
    fingerprint: '4b17f00bfeb7a2f6',
    from: '    if (started) i++',
    to: '    i++',
  },
  {
    id: 'MK-114 zero',
    what: 'read maxIterations 0n as a bound of zero eligible Troves again, instead of no limit',
    file: 'packages/core/src/math/previewRedeem.ts',
    scope: 'previewRedeemUnchecked',
    fingerprint: 'fcea3cf492b40246',
    from: '(!started || unbounded || i < maxIterations)',
    to: '(!started || i < maxIterations)',
  },
  {
    id: 'MK-114 bound',
    what: 'the mutant that surfaced MK-114: walk one eligible Trove past the bound',
    file: 'packages/core/src/math/previewRedeem.ts',
    scope: 'previewRedeemUnchecked',
    fingerprint: 'fcea3cf492b40246',
    from: 'unbounded || i < maxIterations)',
    to: 'unbounded || i <= maxIterations)',
  },
  {
    id: 'MK-114 range',
    what: 'accept a maxIterations no uint256 can hold',
    file: 'packages/core/src/math/previewRedeem.ts',
    scope: 'assertMaxIterations',
    fingerprint: '632f11e87ba568a8',
    from: '  if (maxIterations < 0n || maxIterations > MAX_UINT256) {',
    to: '  if (false) {',
  },
  {
    id: 'MK-114 write range',
    what: 'let redeem() read the chain before refusing a maxIterations no uint256 can hold',
    file: 'packages/core/src/redemption/redeem.ts',
    scope: 'redeem',
    fingerprint: '56b2d9c11d3cdeaf',
    from: '  assertMaxIterations(maxIterations)\n',
    to: '',
  },

  // Fork and gate pins. Run with --all.
  {
    id: 'MK-114 fork',
    what: 'read maxIterations 0n as one eligible Trove, then redeem at zero on chain',
    runner: 'fork',
    files: ['packages/core/test/redeem-max-iterations.fork.test.ts'],
    file: 'packages/core/src/math/previewRedeem.ts',
    scope: 'previewRedeemUnchecked',
    fingerprint: 'fcea3cf492b40246',
    from: '(!started || unbounded || i < maxIterations)',
    to: '(!started || i < maxIterations)',
  },
  {
    id: 'MK-241 settled',
    what: 'report the amount the call asked for as the amount it redeemed',
    file: 'packages/core/src/redemption/redeem.ts',
    scope: 'settledRedemptionFrom',
    fingerprint: 'a73f16fe5a0578fd',
    from: '    redeemedAmount: _actualAmount,',
    to: '    redeemedAmount: _attemptedAmount,',
  },
  {
    id: 'MK-241 received',
    what: "read the event's collateral sent as net of the fee, the misreading the ground truth doc carried",
    file: 'packages/core/src/redemption/redeem.ts',
    scope: 'settledRedemptionFrom',
    fingerprint: 'a73f16fe5a0578fd',
    from: '    collateralReceived: _collateralSent - _collateralFee,',
    to: '    collateralReceived: _collateralSent,',
  },
  {
    id: 'MK-241 estimate',
    what: 'estimate the redemption from the amount asked for rather than from the walk',
    file: 'packages/core/src/redemption/redeem.ts',
    scope: 'redeem',
    fingerprint: 'e6a9e4131326f00d',
    from: '  const estimatedDrawn = estimateCollateralDrawn(redemption.redeemable, redemption.price)',
    to: '  const estimatedDrawn = estimateCollateralDrawn(amount, redemption.price)',
  },
  {
    id: 'MK-242 rule',
    what: 'store the recalculated capacity on a decrease without the min, so a withdrawal after a rise raises it',
    file: 'packages/core/src/math/compute.ts',
    scope: 'capacityAfterAdjustment',
    fingerprint: 'd6d5f669742e93f2',
    from: '  return recalculated < input.currentCapacity ? recalculated : input.currentCapacity',
    to: '  return recalculated',
  },
  {
    id: 'MK-242 evaluator',
    what: 'report the capacity before the withdrawal as the capacity after it, as 0.4.1 did',
    file: 'packages/core/src/math/previewAdjust.ts',
    scope: 'evaluateAdjust.resultingCapacity',
    fingerprint: 'd3ed5941fc490a95',
    from: '    collateralDecreases: withdrawCollateral > 0n && addCollateral === 0n,',
    to: '    collateralDecreases: false,',
  },
  {
    id: 'MK-242 recovery',
    what: 'never project the refinance that would win lost capacity back',
    file: 'packages/core/src/math/previewAdjust.ts',
    scope: 'withCapacityRecovery',
    fingerprint: '7833ed6ab9c0c546',
    from: '  if (capacityAfter.lost === 0n) return capacityAfter',
    to: '  return capacityAfter',
  },
  {
    id: 'MK-243 precheck',
    what: 'throw InsufficientCollateral from the precheck for the MCR gate the decoder reports as ICRBelowMCR',
    file: 'packages/core/src/trove/index.ts',
    scope: 'chainReasonToError',
    fingerprint: 'e151b379a85fd3bb',
    from: '        : new ICRBelowMCR(undefined, { resultingIcr: p.resultingIcr, mcr: p.icrThreshold })',
    to: '        : new InsufficientCollateral(0n, 0n)',
  },
  {
    id: 'MK-244 presence',
    what: 'read the debt increase flag from the presence of the leg again, so a zero borrow is sent as (0, true)',
    file: 'packages/core/src/math/previewAdjust.ts',
    scope: 'adjustLegsOf',
    fingerprint: '475d39a57b1d02bb',
    from: '    isDebtIncrease: increaseDebt > 0n,',
    to: '    isDebtIncrease: legs.increaseDebt !== undefined,',
  },
  {
    id: 'MK-244 early',
    what: 'drop the shape refusal before the first read, so a call that cannot be sent reads the chain first',
    file: 'packages/core/src/trove/index.ts',
    scope: 'adjustTrove',
    fingerprint: '4ab5d0ea14efeb25',
    from: '  if (shape !== undefined) throw shapeReasonToError(shape)\n',
    to: '',
  },
  {
    id: 'MK-244 negative',
    what: 'let a negative leg through to the chain reads',
    file: 'packages/core/src/trove/index.ts',
    scope: 'adjustTrove',
    fingerprint: '513d5f0dd447c60a',
    from: "    if (value < 0n) throw new InvalidAmount(field, value, 'Must be zero or more.')\n",
    to: '',
  },
  {
    id: 'MK-245 walk',
    what: 'drop the last Trove rule from the redemption walk, as 0.4.1 had it',
    file: 'packages/core/src/math/previewRedeem.ts',
    scope: 'evaluateRedeem',
    fingerprint: '46d0f48c80e60c59',
    from: '      if (canMint && (owners <= 1n || size <= 1n)) {',
    to: '      if (false as boolean) {',
  },
  {
    id: 'MK-245 counts',
    what: 'stop the counts falling with each Trove consumed, so only the first can be the last',
    file: 'packages/core/src/math/previewRedeem.ts',
    scope: 'evaluateRedeem',
    fingerprint: '8ee3d13aeffe67de',
    from: '      owners -= 1n\n      size -= 1n\n',
    to: '',
  },
  {
    id: 'MK-245 write',
    what: 'send a redemption that consumes the last Trove, and let the chain revert it',
    file: 'packages/core/src/redemption/redeem.ts',
    scope: 'redeem',
    fingerprint: '9b5c420dd57f5cea',
    from: "  if (!redemption.viable && redemption.bindingConstraint === 'LAST_TROVE_IN_SYSTEM') {\n    throw new LastTroveInSystem()\n  }\n",
    to: '',
  },
  {
    id: 'MK-246 claims',
    what: 'stop recognising the normal mode liquidatability claim MK-001 retired',
    file: 'scripts/retired-claims.mjs',
    scope: 'RETIRED_CLAIMS',
    fingerprint: 'ad5a2e6a0073c042',
    from: '    claim: /Normal-mode liquidatab/i,',
    to: '    claim: /a sentence nobody wrote/i,',
  },
  {
    // MK-256. The old rule read `npm view` and retried only an EMPTY answer, so the PREVIOUS
    // message, served while a re-deprecation propagated, was taken as final and failed a run whose
    // write had succeeded. This is that rule put back.
    id: 'MK-256 retry',
    what: 'stop retrying when the registry still serves the PREVIOUS deprecation message',
    file: 'scripts/deprecation-verify.mjs',
    scope: 'worthRetrying',
    fingerprint: '218a0d374838328c',
    from: "verdict.state !== 'matches'",
    to: "verdict.state === 'absent'",
  },
  {
    // MK-252. The entry MK-244's own wave should have added: the check only knows the claims someone
    // wrote into it, so the claim added after the fact is pinned like every other one.
    id: 'MK-252 claims',
    what: 'stop recognising the presence wording MK-244 retired, which two shipped comments still carried',
    file: 'scripts/retired-claims.mjs',
    scope: 'RETIRED_CLAIMS',
    fingerprint: 'ad5a2e6a0073c042',
    from: '      /reads the flag from PRESENCE|reads `_isDebtIncrease` from PRESENCE|passes presence, which is what the write path passes/,',
    to: '      /a sentence nobody wrote/,',
  },
  {
    id: 'MK-240 fork',
    what: 'solve the margin draw at the real price, then open at it and hold it for the horizon it was asked for',
    runner: 'fork',
    files: ['packages/core/test/zz-borrowing-power-boundary.fork.test.ts'],
    file: 'packages/core/src/math/getBorrowingPower.ts',
    scope: 'getBorrowingPowerUnchecked',
    fingerprint: '8486c9fc0044acaa',
    from: '  const stressedPrice =\n    (price * (10_000n - priceFallBps) * E18) / (10_000n * (E18 + accrualFraction))',
    to: '  const stressedPrice =\n    price',
  },
  {
    id: 'MK-101 fork',
    what: 'treat the refinance capacity as a ratchet, then refinance after a rise and a fall on chain',
    runner: 'fork',
    files: ['packages/core/test/zz-refinance.fork.test.ts'],
    file: 'packages/core/src/math/previewRefinance.ts',
    scope: 'evaluateRefinance',
    fingerprint: '14507e11ff980357',
    from: '    resultingCapacity: maxBorrowingCapacityAt(collateral, price),',
    to: '    resultingCapacity: currentCapacity,',
  },
  {
    id: 'MK-103 fork',
    what: "send the hint helper's lower edge, then move the price inside the tolerance",
    runner: 'fork',
    files: ['packages/core/test/redeem-boundary.fork.test.ts'],
    file: 'packages/core/src/math/previewRedeem.ts',
    scope: 'partialRedemptionBand',
    fingerprint: '4cc38cf634fddf46',
    from: '  const hintNicr = (low + high) / 2n',
    to: '  const hintNicr = low',
  },
  {
    id: 'MK-104 fork',
    what: 're-apply the advice margin when sending, then send the advice after a delay',
    runner: 'fork',
    files: ['packages/core/test/redeem-boundary.fork.test.ts'],
    file: 'packages/core/src/redemption/redeem.ts',
    scope: 'redeem.redemption',
    fingerprint: '5df8675f019fea28',
    from: '      marginSeconds: REDEMPTION_SEND_MARGIN_SECONDS,',
    to: '      marginSeconds: REDEMPTION_ADVICE_MARGIN_SECONDS,',
  },
  {
    id: 'MK-105 fork',
    what: 'let a revert outside simulate through untyped, against the real stale PriceFeed',
    runner: 'fork',
    files: ['packages/core/test/zz-typed-errors.fork.test.ts'],
    file: 'packages/core/src/errors/mapRevert.ts',
    scope: 'withTypedErrors',
    fingerprint: '8ac29fe169cdfa5f',
    from: '  try {\n    return await run()\n  } catch (error) {\n    throw mapRevert(error, context)\n  }',
    to: '  return run()',
  },
  {
    id: 'MK-241 fork',
    what: 'report the amount asked for as the amount redeemed, then redeem through a cancelled partial on chain',
    runner: 'fork',
    files: ['packages/core/test/zz-redemption-settled.fork.test.ts'],
    file: 'packages/core/src/redemption/redeem.ts',
    scope: 'settledRedemptionFrom',
    fingerprint: 'a73f16fe5a0578fd',
    from: '    redeemedAmount: _actualAmount,',
    to: '    redeemedAmount: _attemptedAmount,',
  },
  {
    id: 'MK-242 fork',
    what: 'report the capacity before a withdrawal as the capacity after it, then withdraw on chain',
    runner: 'fork',
    files: ['packages/core/test/zz-capacity-ratchet.fork.test.ts'],
    file: 'packages/core/src/math/previewAdjust.ts',
    scope: 'evaluateAdjust.resultingCapacity',
    fingerprint: 'd3ed5941fc490a95',
    from: '    collateralDecreases: withdrawCollateral > 0n && addCollateral === 0n,',
    to: '    collateralDecreases: false,',
  },
  {
    id: 'MK-246 gate',
    what: 'ship the normal mode liquidatability claim MK-001 retired, in the packed declarations',
    runner: 'gate',
    file: 'packages/core/src/client/createMusdClient.ts',
    scope: 'MusdClient',
    fingerprint: 'ed96262214aca0de',
    from: '   * Whether `liquidate(address)` would liquidate the Trove now: `getCurrentICR < MCR` in BOTH modes, and',
    to: '   * Normal-mode liquidatability (`getCurrentICR < MCR`). Whether `liquidate(address)` would liquidate the Trove now, and',
  },
  {
    id: 'MK-108 gate',
    what: 'ship a quickstart that uses parseBtc and parseMusd without importing them',
    runner: 'gate',
    file: 'packages/core/README.md',
    scope: '## Quickstart',
    fingerprint: '1941370908eba6e3',
    from: "import { createMusdClient, mezoTestnet, parseBtc, parseMusd } from '@musd-kit/core'",
    to: "import { createMusdClient, mezoTestnet } from '@musd-kit/core'",
  },
]
