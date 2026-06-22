// musd-kit, the custom code theme (BRAND v2 §7). Code blocks are DARK islands on the light
// page; this warm theme is shared by the landing AND the
// VitePress docs so code reads as one brand.
//
//   comment → #8A8077 (italic)   keyword → --red-bright   function → #F0A38A (warm)
//   string  → #7FBF9A            number  → #E8B070         type     → #D8C8B8
//   punctuation/operator → #B8ADA3   variable/plain → --text-on-code   error → --danger

const keyword = '#F26555' // --red-bright
const fn = '#F0A38A'
const string = '#7FBF9A'
const number = '#E8B070'
const type = '#D8C8B8'
const punct = '#B8ADA3'
const text = '#F4EEE8' // --text-on-code
const comment = '#8A8077'
const danger = '#D0463A'
const bg = '#181311' // --code-bg

export const codeTheme = {
  name: 'musd-kit-red',
  type: 'dark',
  colors: {
    'editor.background': bg,
    'editor.foreground': text,
  },
  tokenColors: [
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: comment, fontStyle: 'italic' } },
    {
      scope: ['keyword', 'storage', 'storage.type', 'keyword.control', 'modifier', 'keyword.operator.new', 'keyword.operator.expression'],
      settings: { foreground: keyword },
    },
    { scope: ['entity.name.function', 'support.function', 'meta.function-call entity.name.function'], settings: { foreground: fn } },
    { scope: ['string', 'string.quoted', 'string.template', 'punctuation.definition.string'], settings: { foreground: string } },
    { scope: ['constant.numeric', 'constant.language', 'constant.numeric.bigint'], settings: { foreground: number } },
    {
      scope: ['entity.name.type', 'support.type', 'entity.name.class', 'support.class', 'entity.other.inherited-class', 'meta.type.annotation'],
      settings: { foreground: type },
    },
    { scope: ['punctuation', 'meta.brace', 'keyword.operator', 'meta.delimiter'], settings: { foreground: punct } },
    { scope: ['variable', 'variable.other', 'meta.object-literal.key', 'support.variable', 'variable.parameter'], settings: { foreground: text } },
    { scope: ['entity.name.tag', 'punctuation.definition.tag'], settings: { foreground: keyword } },
    { scope: ['entity.other.attribute-name'], settings: { foreground: fn } },
    { scope: ['invalid', 'invalid.illegal'], settings: { foreground: danger } },
  ],
}

export default codeTheme
