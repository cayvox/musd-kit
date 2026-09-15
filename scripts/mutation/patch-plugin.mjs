/**
 * Serve one mutated source file to vitest without writing it to disk (MK-112).
 *
 * The mutation gate used to write each mutant into the working tree, run the suite, and write the
 * original back. That is safe only one mutant at a time, so a gate over every decision site would
 * have run serially for about an hour. With `MUSD_MUTATION_PATCH` pointing at a JSON file
 * `{ "file": "<path>", "content": "<mutated source>" }`, this plugin answers vite's `load` for that
 * one path with the mutated source, so several vitest processes can each test a different mutant of
 * the same tree at once, and nothing on disk ever holds a mutant.
 *
 * With the variable unset the plugin is inert: it has no hooks, and a normal test run is unchanged.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function mutationPatch() {
  const patchFile = process.env.MUSD_MUTATION_PATCH
  if (!patchFile) return { name: 'musd-mutation-patch-inert' }
  const patch = JSON.parse(readFileSync(patchFile, 'utf8'))
  const target = resolve(patch.file)
  return {
    name: 'musd-mutation-patch',
    enforce: 'pre',
    load(id) {
      return id.split('?')[0] === target ? patch.content : null
    },
  }
}
