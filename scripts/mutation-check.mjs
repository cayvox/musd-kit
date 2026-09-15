#!/usr/bin/env node
/**
 * The mutation gate: put each defect back, and check that a test fails (MK-058 onward, MK-112).
 *
 * **What it runs.** Two sets of mutants over the shipped packages.
 *
 *   - The hand written entries in `scripts/mutation/entries.mjs`: each a specific defect a finding
 *     named, put back to prove its pin still catches it.
 *   - One generated mutant per DECISION SITE, found by the rule in `scripts/mutation/sites.mjs`. The
 *     reviewed status of every site lives in `scripts/mutation/sites.json` (the statuses are defined
 *     at `STATUSES` below): caught by the unit project, caught only by the fork project, or not caught
 *     and registered under a finding as a test gap, an equivalent mutant or unreachable code.
 *
 * **Why both.** A hand written entry answers "does the pin for THIS finding still work". A site mutant
 * answers "is this decision pinned at all", which no list of findings can, because the decisions
 * nobody has written a finding about are exactly the ones nobody has checked (MK-112).
 *
 * **What a green run proves, and what it does not.** It proves that every mutant listed here is
 * caught by the project the register names, and that every registered survivor is still not caught.
 * It does not prove the tests are right about the contract: a test that asserts the wrong rule
 * catches the mutant of the right one just as well. And it covers only the decisions the rule in
 * `sites.mjs` finds, with the one mutant per site that rule generates.
 *
 * **What makes it fail, loudly.**
 *   - An entry whose anchor no longer resolves: its scope is absent or ambiguous, its `from` is absent
 *     or occurs twice, or its fingerprint says the code changed (`scripts/mutation/anchor.mjs`).
 *   - A decision site in the code that `sites.json` does not know, or a `sites.json` site the code no
 *     longer has. Either way a person has to look: the first is an unreviewed decision, the second a
 *     review of code that is gone.
 *   - A survivor without a finding, or citing a finding `FINDINGS.md` does not register.
 *   - A mutant the register says is caught that nothing catches, and a registered survivor that
 *     something now catches, so the register cannot go stale silently.
 *   - A mutant that breaks module loading rather than an assertion, which is a broken mutant and not a
 *     catch.
 *
 * **How it runs.** Mutants are served from memory by `scripts/mutation/patch-plugin.mjs`, so several
 * vitest processes run at once over one tree and no source mutant is ever written to disk. A fork
 * process boots its own anvil on a free port, so fork mutants run in parallel too, each stopping at
 * its first failing test. The packaging gate reads the packed tarball from disk, so its one mutant is
 * written and restored.
 *
 *   node scripts/mutation-check.mjs --check                 anchors and the register, in seconds
 *   node scripts/mutation-check.mjs                         the unit pass: entries and unit sites
 *   node scripts/mutation-check.mjs --changed origin/main   the unit pass, for files changed since a ref
 *   node scripts/mutation-check.mjs --all                   also the fork pass and the fork and gate entries
 *   node scripts/mutation-check.mjs --record                write observed statuses for NEW sites
 *
 * Options: `--jobs N` (default: half the CPUs, at most 6), `--shard k/n` to run one of n disjoint
 * slices, `--report <path>` for a JSON record of every mutant, its duration and the tests that caught
 * it, and `--sites <file>` to run only the site ids listed one per line.
 *
 * `--record` never registers a survivor on its own: a new uncaught site is written without a finding,
 * and `--check` fails until someone gives it one.
 */
import { execFileSync, spawn } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { availableParallelism, homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { AnchorError, applyEntry, locate, parse } from './mutation/anchor.mjs'
import { ENTRIES } from './mutation/entries.mjs'
import { allSites } from './mutation/sites.mjs'

const MANIFEST = 'scripts/mutation/sites.json'
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const option = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const JOBS = Number(
  option('jobs') ?? Math.min(6, Math.max(1, Math.floor(availableParallelism() / 2))),
)
const WORK = mkdtempSync(join(tmpdir(), 'musd-mutation-'))
process.on('exit', () => rmSync(WORK, { recursive: true, force: true }))

const readManifest = () => (existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {})

/** The generated mutant for one site, checked to still sit exactly where the site says. */
function siteMutant(site) {
  const text = readFileSync(site.file, 'utf8')
  if (text.slice(site.start, site.end) !== site.from) {
    throw new AnchorError(`site ${site.id}: its text moved while the gate was running`)
  }
  return text.slice(0, site.start) + site.to + text.slice(site.end)
}

/** A mutated TypeScript file must still parse, or the mutant tests the parser rather than a pin. */
function assertParses(file, content, label) {
  const sf = parse(file, content)
  if (sf.parseDiagnostics?.length) {
    throw new AnchorError(
      `${label}: the mutant does not parse (${sf.parseDiagnostics[0].messageText})`,
    )
  }
}

// ---------------------------------------------------------------------------- the register
/**
 * What each reviewed status means, and what the runner then demands of the site's mutant.
 *
 *   caught        the unit project catches it. The unit pass fails if it stops.
 *   caught-fork   only the fork project catches it. The fork pass (`--all`) fails if it stops.
 *   uncaught      nothing catches it and it is observable: a test gap, under `finding`.
 *   equivalent    nothing can catch it, because the mutant computes the same result for every input:
 *                 under `finding`, with the proof in `reason`.
 *   unreachable   nothing can catch it, because no input reaches the difference: a source finding,
 *                 under `finding`, with the proof in `reason`.
 *   excluded      not run: plumbing the rule's mechanical pass could not tell apart, with `reason`.
 *
 * The three statuses nobody catches are all still RUN, so a register that went stale (a mutant
 * that some test now catches) fails the gate instead of sitting there.
 */
const STATUSES = ['caught', 'caught-fork', 'uncaught', 'equivalent', 'unreachable', 'excluded']
const NEEDS_FINDING = new Set(['uncaught', 'equivalent', 'unreachable'])
const NEEDS_REASON = new Set(['equivalent', 'unreachable', 'excluded'])

/** The IDs `FINDINGS.md` has a summary row for. A site may only cite a finding that is registered. */
function registeredIds() {
  const ids = new Set()
  for (const m of readFileSync('FINDINGS.md', 'utf8').matchAll(/^\| (MK-\d+) \|/gm)) ids.add(m[1])
  return ids
}

// ---------------------------------------------------------------------------- --check
function check() {
  const problems = []
  for (const e of ENTRIES) {
    try {
      const content = applyEntry(e, readFileSync(e.file, 'utf8'))
      if (!e.file.endsWith('.md')) assertParses(e.file, content, e.id)
    } catch (error) {
      problems.push(error instanceof AnchorError ? error.message : `${e.id}: ${error}`)
    }
  }
  const sites = allSites()
  const manifest = readManifest()
  const registered = registeredIds()
  const inCode = new Set()
  for (const s of sites) {
    inCode.add(s.id)
    const m = manifest[s.id]
    const where = `${s.file}:${s.line} [${s.kind}] ${s.text}`
    try {
      assertParses(s.file, siteMutant(s), s.id)
    } catch (error) {
      problems.push(error.message)
    }
    if (!m) {
      problems.push(`unreviewed decision site ${where}`)
      continue
    }
    if (!STATUSES.includes(m.status)) {
      problems.push(`site ${where} has an unknown status ${m.status}`)
      continue
    }
    // A caught site may keep the finding it was once registered under, as a test gap since pinned; a
    // finding it cites must still be registered.
    if (NEEDS_FINDING.has(m.status) || m.finding != null) {
      if (!/^MK-\d+$/.test(m.finding ?? '')) {
        problems.push(`${m.status} site ${where} has no registered finding`)
      } else if (!registered.has(m.finding)) {
        problems.push(
          `${m.status} site ${where} cites ${m.finding}, which FINDINGS.md does not register`,
        )
      }
    }
    if (NEEDS_REASON.has(m.status) && !(m.reason ?? '').trim()) {
      problems.push(`${m.status} site ${where} has no reason`)
    }
  }
  for (const id of Object.keys(manifest)) {
    if (!inCode.has(id)) problems.push(`sites.json names a site the code no longer has: ${id}`)
  }
  const counts = Object.fromEntries(STATUSES.map((k) => [k, 0]))
  for (const s of sites) if (manifest[s.id]) counts[manifest[s.id].status]++
  // The honest coverage measure (MK-112): how many decision sites a hand written entry mutates at all.
  const spans = []
  for (const e of ENTRIES.filter((x) => !x.file.endsWith('.md'))) {
    try {
      const text = readFileSync(e.file, 'utf8')
      for (const from of [e.from, e.also?.from].filter(Boolean)) {
        const { start, end } = locate(e, text, from)
        spans.push({ file: e.file, start, end })
      }
    } catch {
      // An entry that no longer resolves is already reported above.
    }
  }
  const covered = sites.filter((s) =>
    spans.some((x) => x.file === s.file && x.start < s.end && s.start < x.end),
  ).length
  console.log(
    `entries ${ENTRIES.length}, decision sites ${sites.length}, of which hand written entries mutate ${covered} (${STATUSES.map((k) => `${k} ${counts[k]}`).join(', ')})`,
  )
  for (const p of problems) console.log(`  FAIL ${p}`)
  return problems.length
}

if (flag('check')) {
  const n = check()
  console.log(n === 0 ? 'mutation check passed' : `${n} problem(s)`)
  process.exit(n === 0 ? 0 : 1)
}

// ---------------------------------------------------------------------------- running mutants
const VITEST = resolve('node_modules/vitest/vitest.mjs')
const UNIT_RUN_LIMIT_MS = 15 * 60_000
const FORK_RUN_LIMIT_MS = 45 * 60_000
const FORK_BLOCK = process.env.MEZO_FORK_BLOCK ?? 'latest'
/**
 * The fork cache as it was when the gate started, if it exists and parses; copied into each fork run.
 * anvil 1.5.1 writes `storage.json` as JSON and anvil 1.7.1, the version CI declares, writes it
 * Zstandard compressed under the same name (MK-238), so a compressed file is decompressed before it is
 * parsed, and copied as it is.
 */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const FORK_CACHE_SNAPSHOT = (() => {
  const shared = join(homedir(), '.foundry/cache/rpc/31611', FORK_BLOCK, 'storage.json')
  if (!existsSync(shared)) return undefined
  try {
    const bytes = readFileSync(shared)
    const text = bytes.subarray(0, 4).equals(ZSTD_MAGIC) ? zstdDecompressSync(bytes) : bytes
    JSON.parse(text.toString('utf8'))
  } catch {
    console.log(`the fork cache at ${shared} does not parse, so fork runs start cold`)
    return undefined
  }
  const copy = join(WORK, 'fork-cache.json')
  copyFileSync(shared, copy)
  return copy
})()
/**
 * A failure that says the CHAIN LINK failed rather than an assertion. anvil forks lazily from the
 * upstream RPC, and when that link degrades, reads throw `InternalRpcError` and receipts time out
 * (MK-078's correction describes the mechanism; the 0.4.1 checklist met it again). A fork mutant that
 * fails only this way has not been caught by anything, so these are never counted as catches.
 */
const ENVIRONMENT_FAILURE =
  /InternalRpcError|Timed out while waiting for transaction|Test timed out in|HTTP request failed|fetch failed|ECONNREFUSED|ECONNRESET|dns error/
let slot = 0
function runVitest({ project, files = [], patch, bail = false }) {
  const id = slot++
  const out = join(WORK, `r${id}.json`)
  // A parent's own MUSD_MUTATION_PATCH must never leak into a baseline run, so it is filtered out.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k !== 'MUSD_MUTATION_PATCH'),
  )
  if (patch) {
    const patchFile = join(WORK, `p${id}.json`)
    writeFileSync(patchFile, JSON.stringify(patch))
    env.MUSD_MUTATION_PATCH = patchFile
  }
  // A fork run gets its own HOME, holding a copy of the fork cache taken before the pass. anvil persists
  // the cache it fetched to `$HOME/.foundry/cache/rpc/<chain>/<block>/storage.json` when it exits, and
  // several anvils ending at once corrupted the one shared file in the P23 wave: it stopped parsing, and
  // runs started against it cold and stalled for an hour. With a private copy no run can do that to
  // another, or to the developer's own cache.
  if (project === 'fork' && FORK_CACHE_SNAPSHOT) {
    const home = join(WORK, `home${id}`)
    const dir = join(home, '.foundry/cache/rpc/31611', FORK_BLOCK)
    mkdirSync(dir, { recursive: true })
    copyFileSync(FORK_CACHE_SNAPSHOT, join(dir, 'storage.json'))
    env.HOME = home
  }
  // vitest is started with this process's own node rather than through pnpm, which does work of its own
  // under a changed HOME, and so the Node version is the one the gate itself runs on.
  const args = [
    VITEST,
    'run',
    '--project',
    project,
    '--reporter=json',
    `--outputFile=${out}`,
    ...(bail ? ['--bail=1'] : []),
    ...files,
  ]
  const began = Date.now()
  return new Promise((done) => {
    // Its own process group, so a timeout can stop vitest AND the workers and anvil it started. A fork
    // run once sat an hour at zero CPU with vitest and anvil each waiting on the other.
    const child = spawn(process.execPath, args, {
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: true,
    })
    let stderr = ''
    let timedOut = false
    const limit = project === 'fork' ? FORK_RUN_LIMIT_MS : UNIT_RUN_LIMIT_MS
    const timer = setTimeout(() => {
      timedOut = true
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        // Already gone.
      }
    }, limit)
    child.stderr.on('data', (d) => {
      stderr += d
    })
    child.on('close', () => {
      clearTimeout(timer)
      try {
        // Anything the run left behind, workers or anvil, goes with it.
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        // The group is already empty.
      }
      const seconds = Math.round((Date.now() - began) / 100) / 10
      if (timedOut) {
        done({ error: `timed out after ${Math.round(limit / 60_000)} minutes`, seconds })
        return
      }
      if (!existsSync(out)) {
        done({
          error: `vitest produced no report: ${stderr.split('\n').slice(-5).join(' ')}`,
          seconds,
        })
        return
      }
      const report = JSON.parse(readFileSync(out, 'utf8'))
      const failedTests = []
      const failedFiles = new Set()
      const environmentFailures = []
      const loadErrors = []
      for (const file of report.testResults) {
        const failed = file.assertionResults.filter((a) => a.status === 'failed')
        for (const a of failed) {
          const message = (a.failureMessages ?? []).join('\n')
          // Only on the fork: a unit test that times out was stopped by the mutant, which is a catch.
          if (project === 'fork' && ENVIRONMENT_FAILURE.test(message))
            environmentFailures.push(a.fullName)
          else {
            failedTests.push(a.fullName)
            failedFiles.add(file.name.replace(`${process.cwd()}/`, ''))
          }
        }
        if (file.status === 'failed' && failed.length === 0) {
          loadErrors.push(
            `${file.name.replace(`${process.cwd()}/`, '')}: ${(file.message ?? '').split('\n')[0]}`,
          )
        }
      }
      done({
        failedTests,
        failedFiles: [...failedFiles].sort(),
        environmentFailures,
        loadErrors,
        total: report.numTotalTests,
        seconds,
      })
    })
  })
}

async function pool(label, items, worker) {
  const results = new Array(items.length)
  let next = 0
  let finished = 0
  const began = Date.now()
  await Promise.all(
    Array.from({ length: Math.min(JOBS, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        results[i] = await worker(items[i])
        finished++
        if (finished % 25 === 0 || finished === items.length) {
          const s = Math.round((Date.now() - began) / 1000)
          console.log(`  ${label}: ${finished}/${items.length} mutants in ${s}s`)
        }
      }
    }),
  )
  return results
}

const changedRef = option('changed')
const changedFiles = changedRef
  ? new Set(
      execFileSync('git', ['diff', '--name-only', `${changedRef}...HEAD`], { encoding: 'utf8' })
        .split('\n')
        .filter(Boolean),
    )
  : undefined
/**
 * `--changed <ref>` is the push path's selection (see `docs/07-testing.md` §4d). A mutant is run when its
 * own source file changed, OR when a test file that caught it last time changed, which is what catches a
 * pin weakened by an edit to the test alone. Unit entries run whenever any test file changed, since their
 * catching files are not recorded. A change to the gate itself selects everything.
 */
const GATE_FILES = /^(scripts\/mutation-check\.mjs|scripts\/mutation\/|vitest\.workspace\.mts)/
const changedTests = changedFiles
  ? [...changedFiles].filter((f) => /^packages\/[^/]+\/test\//.test(f))
  : []
const changedGate = changedFiles ? [...changedFiles].some((f) => GATE_FILES.test(f)) : false
const wanted = (file) => !changedFiles || changedGate || changedFiles.has(file)
const wantedSite = (s, m) => wanted(s.file) || (m?.by ?? []).some((f) => changedFiles?.has(f))
const wantedEntry = (e) => wanted(e.file) || changedTests.length > 0

/**
 * `--shard k/n` keeps every n-th mutant starting at the k-th, so n machines together run each mutant
 * exactly once. The hand written fork and packaging gate entries run on shard 1 only.
 */
const shardOption = option('shard')
const [shardK, shardN] = shardOption ? shardOption.split('/').map(Number) : [1, 1]
if (!(shardN >= 1 && shardK >= 1 && shardK <= shardN)) {
  console.error(`--shard must be k/n with 1 <= k <= n, got ${shardOption}`)
  process.exit(1)
}
const inShard = (_, i) => i % shardN === shardK - 1

const started = Date.now()
const anchorProblems = check()
if (anchorProblems > 0 && !flag('record')) {
  console.error('The anchors or the site review are not clean. Fix `--check` first.')
  process.exit(1)
}

const manifest = readManifest()
const onlyIds = option('sites')
  ? new Set(
      readFileSync(option('sites'), 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    )
  : undefined
const status = (s) => manifest[s.id]?.status
const allRunnable = allSites().filter(
  (s) =>
    wantedSite(s, manifest[s.id]) && status(s) !== 'excluded' && (!onlyIds || onlyIds.has(s.id)),
)

const failures = []
const record = {}
const results = []
const describe = (s) => `${s.file}:${s.line} [${s.kind}] ${s.text}`

/** Judge one site mutant's result against what the register says about it. */
function judge(project, site, result) {
  const { failedTests = [], loadErrors = [], error } = result
  const caught = failedTests.length > 0
  const m = manifest[site.id]
  const line = `${describe(site)} (${project})`
  if (error) failures.push(`${line}: ${error}`)
  if (!caught && loadErrors.length) {
    failures.push(`${line}: the mutant broke module loading, not an assertion: ${loadErrors[0]}`)
  }
  record[site.id] = {
    ...(record[site.id] ?? {}),
    [project]: { caught, failedTests, failedFiles: result.failedFiles ?? [] },
  }
  if (!m) return
  const expected = project === 'unit' ? 'caught' : 'caught-fork'
  if (m.status === expected && !caught) {
    failures.push(`${line}: the register says ${m.status}, and now NOTHING catches it`)
  }
  if (NEEDS_FINDING.has(m.status) && caught) {
    failures.push(
      `${line}: registered ${m.status} under ${m.finding}, but ${failedTests[0]} now catches it; update the register and sites.json`,
    )
  }
}

/**
 * A hand written entry is a pin FOR a finding, so at least one test that catches it has to say which
 * finding it pins. A pin caught only by tests named for other findings is a pin nobody can trace: remove
 * or rename those tests and the finding loses its guard without anything saying so (MK-071 and MK-095
 * were both in that state). Returns the failure text, or undefined when a catching test cites the id.
 */
function untracedCatch(label, failedTests) {
  const ids = label.match(/MK-\d+/g) ?? []
  if (ids.length === 0 || failedTests.length === 0) return undefined
  if (failedTests.some((t) => ids.some((id) => t.includes(id)))) return undefined
  return `${label}: caught only by tests that do not cite ${ids.join(' or ')}, so nothing traces the pin to its finding: ${failedTests[0]}`
}

// ---- the unit pass: entries, and every site the register does not place in the fork project
const unitEntries = onlyIds
  ? []
  : ENTRIES.filter((e) => (e.runner ?? 'unit') === 'unit' && wantedEntry(e))
const unitJobs = [
  ...unitEntries.map((e) => ({
    kind: 'entry',
    label: e.id,
    file: e.file,
    content: applyEntry(e, readFileSync(e.file, 'utf8')),
  })),
  ...allRunnable
    .filter((s) => status(s) !== 'caught-fork')
    .map((s) => ({ kind: 'site', label: s.id, site: s, file: s.file, content: siteMutant(s) })),
].filter(inShard)

if (unitJobs.length > 0) {
  const baseline = await runVitest({ project: 'unit' })
  if (baseline.error || baseline.failedTests.length || baseline.loadErrors.length) {
    console.error(
      'The unit project is not green before any mutation:',
      baseline.error ?? [...baseline.failedTests, ...baseline.loadErrors],
    )
    process.exit(1)
  }
  console.log(`baseline: ${baseline.total} unit tests green in ${baseline.seconds}s; ${JOBS} jobs`)
  const unitResults = await pool('unit', unitJobs, async (j) => ({
    ...j,
    content: undefined,
    project: 'unit',
    result: await runVitest({
      project: 'unit',
      patch: { file: resolve(j.file), content: j.content },
    }),
  }))
  for (const r of unitResults) {
    results.push(r)
    if (r.kind === 'site') {
      judge('unit', r.site, r.result)
      continue
    }
    const { failedTests = [], loadErrors = [], error } = r.result
    if (error) failures.push(`${r.label}: ${error}`)
    if (failedTests.length === 0) {
      failures.push(
        `${r.label}: caught by NOTHING, so its pin does not check its defect${loadErrors.length ? ` (the mutant broke module loading: ${loadErrors[0]})` : ''}`,
      )
    }
    const untraced = untracedCatch(r.label, failedTests)
    if (untraced) failures.push(untraced)
    console.log(`${r.label}: caught by ${failedTests.length}`)
  }
}

// ---- the fork pass, under --all: every site the unit project does not catch, each with its own anvil
if (flag('all') && !changedRef) {
  const unitCaught = (s) => record[s.id]?.unit?.caught === true
  const forkJobs = allRunnable
    .filter((s) =>
      manifest[s.id] ? status(s) !== 'caught' : record[s.id] !== undefined && !unitCaught(s),
    )
    .filter(inShard)
  // A fork catch is CONFIRMED before it counts: two runs, each failing on an assertion rather than on
  // the chain link, at most four attempts. One flaky fork failure would otherwise register a decision
  // as pinned when nothing pins it, which is the most expensive mistake this gate can make.
  const forkResults = await pool('fork', forkJobs, async (s) => {
    const patch = { file: resolve(s.file), content: siteMutant(s) }
    const attempts = []
    let conclusive = 0
    let caughtRuns = 0
    while (attempts.length < 4 && conclusive < 2) {
      const r = await runVitest({ project: 'fork', bail: true, patch })
      attempts.push(r)
      const inconclusive =
        r.error || (r.failedTests.length === 0 && r.environmentFailures.length > 0)
      if (inconclusive) continue
      conclusive++
      if (r.failedTests.length > 0) caughtRuns++
      else break
    }
    const last = attempts[attempts.length - 1]
    const confirmed = caughtRuns >= 2
    return {
      kind: 'site',
      label: s.id,
      site: s,
      project: 'fork',
      attempts: attempts.length,
      result: {
        ...last,
        failedTests: confirmed ? last.failedTests : [],
        error:
          conclusive === 0
            ? `no conclusive fork run in ${attempts.length} attempts: ${last.error ?? last.environmentFailures[0]}`
            : undefined,
      },
    }
  })
  for (const r of forkResults) {
    results.push(r)
    judge('fork', r.site, r.result)
  }

  if (shardK === 1) {
    for (const e of ENTRIES.filter((x) => x.runner === 'fork')) {
      const r = await runVitest({
        project: 'fork',
        files: e.files,
        patch: { file: resolve(e.file), content: applyEntry(e, readFileSync(e.file, 'utf8')) },
      })
      const caught = (r.failedTests ?? []).length > 0
      console.log(`${e.id} [fork]: caught by ${(r.failedTests ?? []).length}`)
      if (!caught)
        failures.push(`${e.id} [fork]: caught by NOTHING${r.error ? ` (${r.error})` : ''}`)
      const untraced = caught ? untracedCatch(`${e.id} [fork]`, r.failedTests) : undefined
      if (untraced) failures.push(untraced)
    }
    for (const e of ENTRIES.filter((x) => x.runner === 'gate')) {
      const original = readFileSync(e.file, 'utf8')
      writeFileSync(e.file, applyEntry(e, original))
      let gateFailed = false
      try {
        execFileSync('node', ['scripts/packaging-gate.mjs'], { stdio: 'ignore' })
      } catch {
        gateFailed = true
      } finally {
        writeFileSync(e.file, original)
      }
      console.log(`${e.id} [gate]: ${gateFailed ? 'the gate failed, caught' : 'the gate PASSED'}`)
      if (!gateFailed)
        failures.push(`${e.id} [gate]: the packaging gate passed with the defect in place`)
    }
  }
} else {
  const skipped = ENTRIES.filter((x) => x.runner === 'fork' || x.runner === 'gate').length
  const forkSites = allRunnable.filter((s) => status(s) === 'caught-fork').length
  console.log(
    `NOT RUN without --all: ${skipped} fork and packaging gate entries, ${forkSites} caught-fork sites`,
  )
}

if (flag('record')) {
  const next = { ...manifest }
  for (const [id, r] of Object.entries(record)) {
    const s = allRunnable.find((x) => x.id === id)
    const observed = r.unit?.caught ? 'caught' : r.fork?.caught ? 'caught-fork' : 'uncaught'
    const by =
      (r.unit?.caught ? r.unit.failedFiles : r.fork?.caught ? r.fork.failedFiles : []) ?? []
    // A reviewed site keeps its status, finding and reason; its location and catching files are
    // refreshed, because those are observations and go stale with every edit. A new site is written as
    // observed, and an uncaught one without a finding, which `--check` refuses until someone gives it one.
    const kept = next[id]
      ? { status: next[id].status, finding: next[id].finding, reason: next[id].reason }
      : { status: observed, ...(observed === 'uncaught' ? { finding: null } : {}) }
    next[id] = Object.fromEntries(
      Object.entries({
        file: s.file,
        line: s.line,
        kind: s.kind,
        text: s.text,
        ...kept,
        ...(by.length ? { by } : {}),
      }).filter(([, v]) => v !== undefined),
    )
  }
  const ordered = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(MANIFEST, `${JSON.stringify(ordered, null, 2)}\n`)
  // In the layout `pnpm lint` checks, so a recorded register does not turn lint red.
  execFileSync('node_modules/.bin/biome', ['format', '--write', MANIFEST], { stdio: 'ignore' })
  console.log(`recorded ${Object.keys(ordered).length} sites in ${MANIFEST}`)
}

const reportPath = option('report')
if (reportPath) {
  writeFileSync(
    reportPath,
    JSON.stringify(
      results.map((r) => ({
        kind: r.kind,
        project: r.project,
        id: r.label,
        ...(r.site
          ? {
              file: r.site.file,
              line: r.site.line,
              siteKind: r.site.kind,
              text: r.site.text,
              scope: r.site.scope,
            }
          : {}),
        caught: (r.result.failedTests ?? []).length > 0,
        seconds: r.result.seconds,
        ...(r.attempts ? { attempts: r.attempts } : {}),
        environmentFailures: r.result.environmentFailures ?? [],
        failedTests: r.result.failedTests ?? [],
        loadErrors: r.result.loadErrors ?? [],
      })),
      null,
      2,
    ),
  )
}

const seconds = Math.round((Date.now() - started) / 1000)
const survivors = results.filter((r) => (r.result.failedTests ?? []).length === 0).length
console.log(
  `${results.length} mutants${shardN > 1 ? ` (shard ${shardK}/${shardN})` : ''} in ${seconds}s with ${JOBS} jobs; ${survivors} not caught by the project they ran in`,
)
for (const f of failures) console.log(`  FAIL ${f}`)
process.exit(failures.length === 0 ? 0 : 1)
