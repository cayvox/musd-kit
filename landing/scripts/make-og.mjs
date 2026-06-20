// Generate the 1200×630 OG image (BRAND §8): warm --canvas, faint constellation in a
// corner, the wordmark large, the tagline in --text-muted, a Geist-Mono badge in --warn.
// Fonts are embedded as base64 @font-face so the raster matches the brand type.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const fontDir = resolve(here, '../public/fonts')
const b64 = (f) => readFileSync(resolve(fontDir, f)).toString('base64')
const satoshi = b64('satoshi-variable.woff2')
const geist = b64('geist-mono-400.woff2')

// faint constellation nodes (corner)
const nodes = [
  [60, 470],
  [150, 410],
  [230, 500],
  [320, 360],
  [400, 450],
  [120, 540],
]
const lines = [
  [0, 1],
  [1, 2],
  [1, 3],
  [3, 4],
  [0, 5],
]

const svg = `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      @font-face { font-family: 'Satoshi'; src: url(data:font/woff2;base64,${satoshi}) format('woff2'); font-weight: 300 900; }
      @font-face { font-family: 'Geist Mono'; src: url(data:font/woff2;base64,${geist}) format('woff2'); font-weight: 400; }
    </style>
  </defs>
  <rect width="1200" height="630" fill="#0B0A09"/>
  <g opacity="0.9">
    ${lines.map(([a, b]) => `<line x1="${nodes[a][0]}" y1="${nodes[a][1]}" x2="${nodes[b][0]}" y2="${nodes[b][1]}" stroke="#E0703A" stroke-opacity="0.16" stroke-width="1.5"/>`).join('')}
    ${nodes.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i === 3 ? 7 : 4}" fill="#E0703A" fill-opacity="${i === 3 ? 0.55 : 0.22}"/>`).join('')}
  </g>
  <text x="84" y="250" font-family="Satoshi" font-weight="600" font-size="104" letter-spacing="-3" fill="#F6F2ED">musd<tspan fill="#E0703A">-</tspan>kit</text>
  <text x="88" y="320" font-family="Satoshi" font-weight="400" font-size="36" fill="#A79E96">The typed SDK for MUSD on Mezo</text>
  <g>
    <rect x="86" y="372" width="334" height="44" rx="22" fill="none" stroke="#D9A441" stroke-opacity="0.5"/>
    <text x="110" y="401" font-family="Geist Mono" font-weight="400" font-size="22" letter-spacing="1" fill="#D9A441">community · testnet · pre-1.0</text>
  </g>
  <text x="84" y="566" font-family="Geist Mono" font-weight="400" font-size="22" fill="#6E665E">github.com/cayvox/musd-kit</text>
</svg>`

await sharp(Buffer.from(svg)).png().toFile(resolve(here, '../public/og.png'))
console.log('wrote public/og.png')
