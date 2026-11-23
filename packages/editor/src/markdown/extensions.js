// Shared syntax rules. Keep the editable blockquote marker in the document so
// typing, copying and serialization all use GitHub's existing spelling.
export const alertKinds = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']
export function alertKind(text) {
  const match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\n|$)/.exec(text)
  return match?.[1] ?? null
}

export function markdownAlerts(md) {
  md.core.ruler.after('text_join', 'frowd-alerts', state => {
    const stack = []
    state.tokens.forEach((token, index) => {
      if (token.type === 'blockquote_open') stack.push(index)
      if (token.type !== 'blockquote_close') return
      const start = stack.pop(), inline = state.tokens[start + 2]
      if (state.tokens[start + 1]?.type !== 'paragraph_open' || inline?.type !== 'inline') return
      // Parsed inline tokens decode legacy escaped brackets but retain marks.
      // Only a plain first text token followed by a line break/end is a marker.
      const first = inline.children?.[0], next = inline.children?.[1]
      const kind = first?.type === 'text' && (!next || ['softbreak', 'hardbreak'].includes(next.type)) ? alertKind(first.content) : null
      if (kind) {
        state.tokens[start].attrJoin('class', 'writing-alert')
        state.tokens[start].attrSet('data-alert', kind)
      }
    })
  })
}

// Both body and print documents use the same semantic classes. No font/network
// resources are needed, and the alert kind remains readable in monochrome.
export const extensionCss = `
  .writing-alert { --alert-color: #356ca5; border-left: 3px solid var(--alert-color); padding: .1em 1em; margin: 1em 0; color: inherit; background: color-mix(in srgb, var(--alert-color) 5%, transparent); }
  .writing-alert[data-alert="TIP"] { --alert-color: #34764d; }
  .writing-alert[data-alert="IMPORTANT"] { --alert-color: #8256ac; }
  .writing-alert[data-alert="WARNING"] { --alert-color: #966617; }
  .writing-alert[data-alert="CAUTION"] { --alert-color: #b74444; }
  .writing-alert > p:first-child { margin-top: .4em; }
  .writing-alert-marker { color: var(--alert-color); font-weight: 650; }
  .writing-mermaid-svg { display: block; max-width: 100%; height: auto; margin: .7em auto; background: #fff; color: #222; }
  .writing-mermaid-figure { margin: 1em 0; overflow: auto; break-inside: avoid; }
  .footnotes { font-size: .9em; border-top: 1px solid #ccc; margin-top: 2em; }
  .footnote-ref { font-size: .8em; }
`
