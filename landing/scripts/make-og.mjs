// Generate the 1200×630 OG image (BRAND v2 §9): warm-white --canvas, the node motif faint
// in a corner, the wordmark large (red hyphen), the tagline in --text-muted, a Geist-Mono
// maturity badge "community · testnet · pre-1.0" in --warn, a --red accent. Fonts embedded.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const fontDir = resolve(here, '../public/fonts')
const b64 = (f) => readFileSync(resolve(fontDir, f)).toString('base64')
const satoshi = b64('satoshi-variable.woff2')
const geist = b64('geist-mono-400.woff2')

// faint constellation in the lower-right corner
const nodes = [
  [770, 470],
  [850, 405],
  [930, 500],
  [1010, 360],
  [1090, 455],
  [905, 545],
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
  <rect width="1200" height="630" fill="#FBF8F5"/>
  <g>
    ${lines.map(([a, b]) => `<line x1="${nodes[a][0]}" y1="${nodes[a][1]}" x2="${nodes[b][0]}" y2="${nodes[b][1]}" stroke="#E5483D" stroke-opacity="0.16" stroke-width="1.5"/>`).join('')}
    ${nodes.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i === 3 ? 7 : 4}" fill="#E5483D" fill-opacity="${i === 3 ? 0.55 : 0.22}"/>`).join('')}
  </g>
  <text x="84" y="250" font-family="Satoshi" font-weight="600" font-size="104" letter-spacing="-3" fill="#1A1513">musd<tspan fill="#E5483D">-</tspan>kit</text>
  <text x="88" y="320" font-family="Satoshi" font-weight="400" font-size="36" fill="#6B635C">The typed SDK for MUSD on Mezo</text>
  <g>
    <rect x="86" y="372" width="336" height="44" rx="22" fill="#F6ECD8" stroke="#8A5B10" stroke-opacity="0.4"/>
    <text x="110" y="401" font-family="Geist Mono" font-weight="400" font-size="22" letter-spacing="1" fill="#8A5B10">community · testnet · pre-1.0</text>
  </g>
  <text x="84" y="566" font-family="Geist Mono" font-weight="400" font-size="22" fill="#756B61">github.com/cayvox/musd-kit</text>
</svg>`

await sharp(Buffer.from(svg)).png().toFile(resolve(here, '../public/og.png'))
console.log('wrote public/og.png (v2 light)')
