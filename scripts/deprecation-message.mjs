/**
 * The deprecation message for a published version, chosen by version from a reviewed set.
 *
 * **Why this file exists (MK-084).** `.github/workflows/deprecate.yml` took the version as a
 * dispatch input and interpolated it into both `npm deprecate` targets, while the two message
 * strings beside them were literals about `0.1.0`. Dispatching it for any other version would have
 * attached "0.1.0 returns wrong numbers on seven surfaces" to a real package on the public
 * registry, and a deprecation message is read by installers at install time, so the falsehood
 * would have been visible to people who are not us.
 *
 * **Why a chosen set and not a free text input.** The workflow's own header argued that the
 * messages belong in the repository rather than in an input, because an input "would let this
 * deprecate anything with any text, which is a much larger capability than the job needs". That
 * reasoning stands and this file keeps it: the dispatch input remains a version, the text is
 * reviewed in a pull request like any other change, and the job's capability is unchanged. What
 * this file adds is that the text now varies with the version, which is the half that was missing.
 *
 * **Why a module rather than a case statement in the YAML.** Two properties that a shell `case`
 * cannot give. It is importable, so the guarantees below are asserted by a test that runs in the
 * unit project on every push rather than only when someone dispatches a registry write. And the
 * lookup is one implementation, so the message the test checks is the message the workflow sends,
 * which is `docs/08-conventions.md` §11 applied to a string that reaches the public.
 *
 * **The guarantee, enforced at lookup rather than by review.** A message must contain the version
 * it will be attached to, and {@link messageFor} throws when it does not. So the failure mode this
 * finding is about, a message copied from one version and filed under another, cannot reach the
 * registry: it fails in the workflow step that resolves the text, which runs BEFORE any credential
 * is in scope. An unknown version throws for the same reason. **Failing loudly on a version nobody
 * has written a message for is the correct outcome**, and is better than a plausible wrong message.
 */

/** The packages this repository publishes, and therefore deprecates together. */
export const PACKAGES = Object.freeze(['core', 'react'])

/**
 * Version to message, one entry per package.
 *
 * Adding a version here is the whole of "preparing a deprecation". Every string must name its own
 * version, must point at the register and the migration guide for that step, and must say what to
 * upgrade to. `messageFor` enforces the first of those three; the other two are what review is for.
 */
export const DEPRECATIONS = Object.freeze({
  /**
   * Already applied. `gh run list --workflow deprecate.yml` shows one run, 33180504234, a
   * `workflow_dispatch` on 2026-08-28, and these two strings are live on the registry today.
   * **They are reproduced here byte for byte on purpose**: this file has to be able to reproduce
   * what was already sent, or a re-run would silently rewrite history.
   */
  '0.1.0': Object.freeze({
    core: '0.1.0 returns wrong numbers on seven surfaces, three of them silently. See FINDINGS.md and docs/11-migration-0.1-to-0.2.md. Upgrade to 0.2.0.',
    react:
      'Depends on @musd-kit/core@0.1.0, which returns wrong numbers on seven surfaces. See docs/11-migration-0.1-to-0.2.md. Upgrade to 0.2.0.',
  }),

  /**
   * Not yet applied, and it cannot be until 0.3.0 is `latest`: the workflow refuses to deprecate
   * whichever version a package currently points `latest` at.
   *
   * Every claim in it is a register row. `previewBorrow` omitted the Recovery Mode rule that a
   * debt increase must not lower the Trove's ICR, so it returned viable for borrows the contract
   * accepts none of (MK-058), and applied a TCR gate on a path where the contract has none
   * (MK-059). `getBorrowingPower` subtracted a borrowing fee the contract skips in Recovery Mode
   * and for a fee exempt account (MK-067). All three are S1, all three land after `v0.2.0`
   * (`git merge-base --is-ancestor` against the tag says so), and all three are fixed in 0.3.0.
   * Two surfaces, because MK-058 and MK-059 are both `previewBorrow`.
   */
  '0.2.0': Object.freeze({
    core: '0.2.0 is wrong on two Recovery Mode surfaces. previewBorrow returns viable for a borrow the contract refuses (MK-058) and reports a TCR block the contract does not apply (MK-059). getBorrowingPower subtracts a borrowing fee the contract does not charge in Recovery Mode or for a fee exempt account (MK-067). See FINDINGS.md and docs/14-migration-0.2-to-0.3.md. Upgrade to 0.3.0.',
    react:
      'Depends on @musd-kit/core@0.2.0, which is wrong on two Recovery Mode surfaces (MK-058, MK-059, MK-067), reachable through useBorrowPreview and useBorrowingPower. See docs/14-migration-0.2-to-0.3.md. Upgrade to 0.3.0.',
  }),

  /**
   * Not yet applied: it can be once 0.4.0 is `latest`.
   *
   * Every claim is a register row and was checked in the PUBLISHED 0.3.0 tarballs rather than in the
   * source: core's `getBorrowingPower` is the single ceiling search with no margin (MK-100), core has
   * no refinance rate or capacity fields (MK-101), and react's `useMusdQuery` still passes
   * `keepPreviousData` (MK-102). All three are fixed in 0.4.0.
   */
  '0.3.0': Object.freeze({
    core: "0.3.0 returns the liquidation threshold as the amount to borrow: a Trove opened at getBorrowingPower's figure is liquidatable within seconds (MK-100), and previewRefinance omits the rate and capacity a refinance moves to (MK-101). See FINDINGS.md and docs/15-migration-0.3-to-0.4.md. Upgrade to 0.4.0.",
    react:
      'Depends on @musd-kit/core@0.3.0, whose borrowing power figure is the liquidation threshold (MK-100), shown by useBorrowingPower as the amount to borrow. Its read hooks also report a previous query as current (MK-102). See docs/15-migration-0.3-to-0.4.md. Upgrade to 0.4.0.',
  }),

  /**
   * Not yet applied: it can be once 0.4.0 is `latest`.
   *
   * 0.3.1 is 0.3.0's code with MK-100's warning added to the documentation, and nothing else
   * (`node scripts/compare-published.mjs --base 0.3.0 --head 0.3.1`), so it carries the same
   * defects, and the message says that it warned rather than fixed, which is what distinguishes it.
   */
  '0.3.1': Object.freeze({
    core: "0.3.1 warns about but does not fix MK-100: a Trove opened at getBorrowingPower's figure is liquidatable within seconds. previewRefinance still omits the rate and capacity a refinance moves to (MK-101). See FINDINGS.md and docs/15-migration-0.3-to-0.4.md. Upgrade to 0.4.0.",
    react:
      'Depends on @musd-kit/core@0.3.1, which warns about but does not fix MK-100: useBorrowingPower shows the liquidation threshold as the amount to borrow. Its read hooks also report a previous query as current (MK-102). See docs/15-migration-0.3-to-0.4.md. Upgrade to 0.4.0.',
  }),

  /**
   * **Applied twice, and the first text is preserved below because this file has to be able to
   * reproduce what was already sent.** The first was dispatched on 2026-09-14, after 0.4.1 became
   * `latest`, and read:
   *
   *   core:  '0.4.0 previewRedeem reads maxIterations 0n as one eligible Trove where the contract
   *           reads zero as no limit, so it reports less than the redemption redeems, and redeem()
   *           prechecks only that Trove (MK-114). See FINDINGS.md and
   *           docs/15-migration-0.3-to-0.4.md. Upgrade to 0.4.1.'
   *   react: 'Depends on @musd-kit/core@0.4.0, whose redeem() prechecks only the first eligible
   *           Trove when maxIterations is 0n, which the contract reads as no limit (MK-114),
   *           reachable through useRedeem. See docs/15-migration-0.3-to-0.4.md. Upgrade to 0.4.1.'
   *
   * **It had to be rewritten, and not for tidiness: its upgrade target is now deprecated too.** A
   * message that sends a reader from 0.4.0 to 0.4.1 sends them to the same MK-240 defect they are
   * leaving, which is the registry telling them something false at install time. The rewrite keeps
   * MK-114, adds MK-240, and points at 0.5.0.
   *
   * MK-114, checked in the PUBLISHED 0.4.0 tarballs: core's `previewRedeem` walks
   * `(!started || i < maxIterations)` with `maxIterations = params.maxIterations ?? 100n`, so `0n`
   * stops after the first eligible Trove, where `redeemCollateral` reads zero as no limit. MK-240,
   * in the same tarballs: `getBorrowingPower` returns `recommended`, solved for one hour and a 2%
   * fall, and the READMEs present it as the draw to offer.
   */
  '0.4.0': Object.freeze({
    core: '0.4.0 getBorrowingPower returns a recommended draw sized for one hour and a 2% fall, presented as the amount to borrow and hold: over 86 days of Mezo mainnet prices that margin was crossed within a week of 57.6% of sampled start times (MK-240). previewRedeem also reads maxIterations 0n as one eligible Trove where the contract reads zero as no limit (MK-114). See FINDINGS.md and docs/16-migration-0.4-to-0.5.md. Upgrade to 0.5.0.',
    react:
      'Depends on @musd-kit/core@0.4.0, whose useBorrowingPower serves a draw sized for one hour as the amount to hold (MK-240) and whose redeem() prechecks only the first eligible Trove when maxIterations is 0n (MK-114). See docs/16-migration-0.4-to-0.5.md. Upgrade to 0.5.0.',
  }),

  /**
   * Not yet applied when written: it can be once 0.5.0 is `latest`, which the workflow enforces.
   *
   * **Both claims were checked in the PUBLISHED 0.4.1 tarballs, not in the repository.** MK-240:
   * `dist/index.js` solves `recommended` against a price stressed by `BORROWING_POWER_PRICE_MOVE_BPS`
   * over `BORROWING_POWER_MARGIN_WINDOW_SECONDS`, 200 bps and 3600 seconds, and both READMEs say
   * "Offer `recommended`". The horizon table this release measured is in `docs/03-core-api.md`: over
   * blocks 9841930 to 11868955 of Mezo mainnet, 57.6% of start times saw a 2% fall within seven days,
   * and the worst hour fell 418.47 bps, more than twice the 200 the default was sized on. MK-241:
   * `RedeemResult` carries `truncatedAmount`, `estimatedFeeCollateral` and `estimatedCollateralDrawn`,
   * all read from `getRedemptionHints` before the send, and the fork proof for the gap is
   * `zz-redemption-settled.fork.test.ts`, where the helper said 3,515.14 MUSD and 1,808.46 settled.
   */
  '0.4.1': Object.freeze({
    core: '0.4.1 getBorrowingPower returns a recommended draw sized for one hour and a 2% fall, presented as the amount to borrow and hold: over 86 days of Mezo mainnet prices that margin was crossed within a week of 57.6% of sampled start times (MK-240). RedeemResult also reports the hint helper figures rather than what the redemption settled (MK-241). See FINDINGS.md and docs/16-migration-0.4-to-0.5.md. Upgrade to 0.5.0.',
    react:
      'Depends on @musd-kit/core@0.4.1, whose useBorrowingPower serves a draw sized for one hour as the amount to hold (MK-240) and whose useRedeem reports figures estimated before sending as what settled (MK-241). See docs/16-migration-0.4-to-0.5.md. Upgrade to 0.5.0.',
  }),
})

/** Thrown for anything that would otherwise send a message that does not describe its version. */
export class DeprecationMessageError extends Error {}

/**
 * How each package's message must OPEN, so that the version is the message's subject.
 *
 * **A substring check is not enough, and the test caught that before this shipped.** The first
 * version of this guarantee asked only that the message contain its version. It does not hold:
 * 0.1.0's message ends "Upgrade to 0.2.0.", so 0.1.0's text filed under 0.2.0 contains "0.2.0"
 * and would have passed, which is precisely the forgery MK-084 is about. The version has to be
 * what the sentence is ABOUT, and for these two packages that is a fixed opening.
 */
const SUBJECT = Object.freeze({
  core: (version) => `${version} `,
  react: (version) => `Depends on @musd-kit/core@${version},`,
})

/** `Upgrade to X.` at the end of every message, so the target can be compared with the subject. */
const UPGRADE_TARGET = /Upgrade to (\d+\.\d+\.\d+)\.\s*$/

/**
 * The guarantee, on its own so it can be tested with a forged pair.
 *
 * {@link messageFor} can only ever be called with the data in this file, so these checks are
 * unreachable through it once every entry is correct. Exporting it is what makes the invariant
 * assertable rather than merely asserted: a test hands it 0.1.0's text under 0.2.0, which is the
 * exact mistake MK-084 is about, and watches it refuse.
 *
 * Two conditions, and both are needed. The message must OPEN by naming the version, so the version
 * is its subject rather than an incidental mention. And the upgrade target must be a DIFFERENT
 * version, because no message ever tells a reader to upgrade to the release it is deprecating; that
 * is what catches a message whose subject was updated and whose tail was not.
 */
export function assertMessageDescribes(version, pkg, message) {
  if (typeof message !== 'string' || message.length === 0) {
    throw new DeprecationMessageError(`the ${version} entry has no message for ${pkg}`)
  }
  const opening = SUBJECT[pkg]?.(version)
  if (opening === undefined) {
    throw new DeprecationMessageError(`no message shape is defined for ${pkg}`)
  }
  if (!message.startsWith(opening)) {
    throw new DeprecationMessageError(
      `the ${pkg} message filed under ${version} does not open by naming ${version}, so it describes a different release. Expected it to start with ${JSON.stringify(opening)}. Refusing it.`,
    )
  }
  const target = UPGRADE_TARGET.exec(message)
  if (target === null) {
    throw new DeprecationMessageError(
      `the ${pkg} message filed under ${version} does not end by naming an upgrade target ("Upgrade to X.Y.Z."). Refusing it.`,
    )
  }
  if (target[1] === version) {
    throw new DeprecationMessageError(
      `the ${pkg} message filed under ${version} tells the reader to upgrade to ${version}, the very version it deprecates. Refusing it.`,
    )
  }
  return message
}

/**
 * The message for one package at one version.
 *
 * Throws, never guesses, on: a version with no entry, a package outside {@link PACKAGES}, and a
 * message that does not contain its own version. The last one is the point of the whole file.
 */
export function messageFor(version, pkg) {
  if (typeof version !== 'string' || version.length === 0) {
    throw new DeprecationMessageError('a version is required')
  }
  if (!PACKAGES.includes(pkg)) {
    throw new DeprecationMessageError(
      `unknown package ${JSON.stringify(pkg)}; expected one of ${PACKAGES.join(', ')}`,
    )
  }
  const entry = Object.hasOwn(DEPRECATIONS, version) ? DEPRECATIONS[version] : undefined
  if (entry === undefined) {
    throw new DeprecationMessageError(
      `no deprecation message is written for ${version}. Refusing to deprecate it: a version without a reviewed message would get another version's text. Add an entry to scripts/deprecation-message.mjs in a pull request, then dispatch from that commit. Known versions: ${Object.keys(DEPRECATIONS).join(', ')}`,
    )
  }
  return assertMessageDescribes(version, pkg, entry[pkg])
}

/* CLI: `node scripts/deprecation-message.mjs <version> <core|react>`. Prints the message on
 * stdout and exits 0, or prints the reason on stderr and exits 1. The workflow calls it once per
 * package in a step that holds no registry credential. */
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  const [version, pkg] = process.argv.slice(2)
  try {
    process.stdout.write(`${messageFor(version, pkg)}\n`)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}
