#!/usr/bin/env node
// Brand the TypeDoc kind-icon sprite. The icons are an external SVG referenced via <use href=...>,
// so the page's CSS custom properties never reach it and the chips fall back to a dark square. Bake
// the brand values into the sprite: a light warm chip, a dark glyph, and a hairline border, so the
// kind icons read on the warm-white page instead of as black blobs. Runs after `typedoc`.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const file = join(ROOT, 'docs/public/api/assets/icons.svg')

if (!existsSync(file)) {
  console.error('icons.svg not found; run `typedoc` first.')
  process.exit(0)
}

const original = readFileSync(file, 'utf8')
const branded = original
  .replace(/var\(--color-icon-background\)/g, '#ffffff') // the chip
  .replace(/var\(--color-icon-text\)/g, '#1a1513') // the glyph (dark, readable)
  .replace(/var\(--color-ts-[a-z-]+\)/g, '#ded5cb') // kind borders -> warm hairline
  .replace(/var\(--color-document\)/g, '#ded5cb')

if (branded !== original) {
  writeFileSync(file, branded)
  console.log('✓ branded API kind-icons (light warm chip, dark glyph, hairline border)')
} else {
  console.log('API kind-icons already branded (no var references found).')
}
