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
    what: 'derive the debt increase flag from the value again',
    file: 'packages/core/src/math/previewAdjust.ts',
    scope: 'evaluateAdjust',
    fingerprint: '6d9a5cfe4fb39cf6',
    from: 'const isDebtIncrease = input.isDebtIncrease ?? increaseDebt > 0n',
    to: 'const isDebtIncrease = increaseDebt > 0n',
  },
  {
    id: 'MK-060 write path',
    what: 'drop the borrow-leg amount validation from adjustTrove',
    file: 'packages/core/src/trove/index.ts',
    scope: 'adjustTrove',
    fingerprint: '314d55b6731659b2',
    from: "  if (brw !== undefined) assertPositiveAmount('borrow', brw)\n",
    to: '',
  },
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
      fingerprint: '0d66c1c9849f10e6',
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

  {
    id: 'MK-085 hook (an absent leg must stay absent)',
    what: 'default the debt leg to zero and forward it, so every adjustment is a debt increase',
    file: 'packages/react/src/hooks/reads.ts',
    scope: 'useAdjustTrovePreview.legs',
    fingerprint: 'bb3247416bc54d27',
    from: '    ...(params.increaseDebt !== undefined ? { increaseDebt: params.increaseDebt } : {}),',
    to: '    increaseDebt: params.increaseDebt ?? 0n,',
  },
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
    scope: 'evaluateAdjust',
    fingerprint: 'c9113f746abc129f',
    from: "  if (increaseDebt > 0n && repayDebt > 0n) reasons.push('DEBT_INCREASE_AND_REPAY')",
    to: '  void 0',
  },

  // --- P21. The audit of the published 0.3.1 (MK-100 to MK-109). ----------------------------

  {
    id: 'MK-100 stress',
    what: 'solve the recommended figure at the real price, so it equals the ceiling',
    file: 'packages/core/src/math/getBorrowingPower.ts',
    scope: 'getBorrowingPowerUnchecked',
    fingerprint: 'e5f7a40ca3392a20',
    from: '  const stressedPrice =\n    (price * (10_000n - priceMoveBps) * E18) / (10_000n * (E18 + accrualFraction))',
    to: '  const stressedPrice =\n    price',
  },
  {
    id: 'MK-100 accrual',
    what: 'leave the interest window out of the margin',
    file: 'packages/core/src/math/getBorrowingPower.ts',
    scope: 'getBorrowingPowerUnchecked.accrualFraction',
    fingerprint: 'b0d67ea7c0792612',
    from: '    (interestRateBps * windowSeconds * E18 + accrualDenominator - 1n) / accrualDenominator',
    to: '    0n',
  },
  {
    id: 'MK-100 constant',
    what: 'lower the price move under the measured worst hour',
    file: 'packages/core/src/math/getBorrowingPower.ts',
    scope: '',
    fingerprint: 'd458c258be8bc7fb',
    from: 'export const BORROWING_POWER_PRICE_MOVE_BPS = 200n',
    to: 'export const BORROWING_POWER_PRICE_MOVE_BPS = 150n',
  },
  {
    id: 'MK-100 hook',
    what: 'return the ceiling from useBorrowingPower again',
    file: 'packages/react/src/hooks/reads.ts',
    scope: 'useBorrowingPower',
    fingerprint: '2250da1a9068a5dc',
    from: '  return useBorrowingPowerQuery(params, (power) => power.recommended)',
    to: '  return useBorrowingPowerQuery(params, (power) => power.ceiling)',
  },
  {
    id: 'MK-100 override window',
    what: 'accept a negative margin window, which hands back the ceiling as recommended',
    file: 'packages/core/src/math/getBorrowingPower.ts',
    scope: 'getBorrowingPowerUnchecked',
    fingerprint: '574e8b20783a96b6',
    from: '  if (params.marginWindowSeconds !== undefined && params.marginWindowSeconds < 0n) {',
    to: '  if (false as boolean) {',
  },
  {
    id: 'MK-100 override move',
    what: 'accept a price move outside 0 to 10000 basis points',
    file: 'packages/core/src/math/getBorrowingPower.ts',
    scope: 'getBorrowingPowerUnchecked',
    fingerprint: 'e8cd2e816284eed4',
    from: '    (params.priceMoveBps < 0n || params.priceMoveBps >= 10_000n)',
    to: '    (false as boolean)',
  },
  {
    id: 'MK-100 override ignored',
    what: 'accept a price move override and solve with the default anyway',
    file: 'packages/core/src/math/getBorrowingPower.ts',
    scope: 'getBorrowingPowerUnchecked',
    fingerprint: 'ccf381b070a647d4',
    from: '  const priceMoveBps = params.priceMoveBps ?? BORROWING_POWER_PRICE_MOVE_BPS',
    to: '  const priceMoveBps = BORROWING_POWER_PRICE_MOVE_BPS',
  },
  {
    id: 'MK-100 hook override',
    what: 'drop the margin override between the hook and the core call',
    file: 'packages/react/src/hooks/reads.ts',
    scope: 'useBorrowingPowerQuery.fetch',
    fingerprint: '276fdb1ee22bb17d',
    from: '        ...margin,\n',
    to: '',
  },
  {
    id: 'MK-100 hook key',
    what: 'leave the margin out of the query key, so two margins share one answer',
    file: 'packages/react/src/hooks/reads.ts',
    scope: 'useBorrowingPowerQuery',
    fingerprint: '31b3cd428724c916',
    from: '    queryKey: musdQueryKeys.borrowingPower(chainId, collateral ?? 0n, who, margin),',
    to: '    queryKey: musdQueryKeys.borrowingPower(chainId, collateral ?? 0n, who),',
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
    scope: 'useBorrowingPowerQuery',
    fingerprint: '4a45af63b2f4688e',
    from: '  const who = account ?? connected',
    to: '  const who = account',
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
    id: 'MK-100 fork',
    what: 'solve the recommended figure at the real price, then open at it and wait an hour',
    runner: 'fork',
    files: ['packages/core/test/zz-borrowing-power-boundary.fork.test.ts'],
    file: 'packages/core/src/math/getBorrowingPower.ts',
    scope: 'getBorrowingPowerUnchecked',
    fingerprint: 'e5f7a40ca3392a20',
    from: '  const stressedPrice =\n    (price * (10_000n - priceMoveBps) * E18) / (10_000n * (E18 + accrualFraction))',
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
