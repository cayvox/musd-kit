// musd-kit — the custom warm Shiki theme (BRAND.md §7). Default themes are cold; this
// retunes to the ember palette so code reads as one brand on the landing AND in the
// VitePress docs (both import this single source).
//
//   comment   → --text-dim (italic)     keyword   → --ember
//   function  → --ember-bright          string    → --verified (muted)
//   number    → warm gold               type      → warm neutral
//   punctuation/operator → --text-muted  variable/plain → --text   error → --danger

const ember = '#E0703A'
const emberBright = '#F2925A'
const verified = '#5FB08A'
const gold = '#E0B070'
const typeNeutral = '#C9B8A8'
const textMuted = '#A79E96'
const text = '#F6F2ED'
const textDim = '#8E847A' // AA-readable dim for code comments on --surface-2
const danger = '#D06A5A'
const bg = '#1A1714' // --surface-2

export const codeTheme = {
  name: 'musd-kit-ember',
  type: 'dark',
  colors: {
    'editor.background': bg,
    'editor.foreground': text,
  },
  tokenColors: [
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: textDim, fontStyle: 'italic' } },
    {
      scope: ['keyword', 'storage', 'storage.type', 'keyword.control', 'modifier', 'keyword.operator.new', 'keyword.operator.expression'],
      settings: { foreground: ember },
    },
    { scope: ['entity.name.function', 'support.function', 'meta.function-call entity.name.function'], settings: { foreground: emberBright } },
    { scope: ['string', 'string.quoted', 'string.template', 'punctuation.definition.string'], settings: { foreground: verified } },
    { scope: ['constant.numeric', 'constant.language', 'constant.numeric.bigint'], settings: { foreground: gold } },
    {
      scope: ['entity.name.type', 'support.type', 'entity.name.class', 'support.class', 'entity.other.inherited-class', 'meta.type.annotation'],
      settings: { foreground: typeNeutral },
    },
    { scope: ['punctuation', 'meta.brace', 'keyword.operator', 'meta.delimiter'], settings: { foreground: textMuted } },
    { scope: ['variable', 'variable.other', 'meta.object-literal.key', 'support.variable', 'variable.parameter'], settings: { foreground: text } },
    { scope: ['entity.name.tag', 'punctuation.definition.tag'], settings: { foreground: ember } },
    { scope: ['entity.other.attribute-name'], settings: { foreground: emberBright } },
    { scope: ['invalid', 'invalid.illegal'], settings: { foreground: danger } },
  ],
}

export default codeTheme
