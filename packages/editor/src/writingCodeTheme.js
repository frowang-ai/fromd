import { defaultHighlightStyle, HighlightStyle, syntaxHighlighting } from '@codemirror/language'

// Keep CodeMirror's default tags and light colors. Only color declarations gain
// a CSS variable so switching the desktop theme preserves the live editor state.
const colorVariables = {
  '#404740': '--writing-code-comment',
  '#708': '--writing-code-string',
  '#219': '--writing-code-operator',
  '#164': '--writing-code-keyword',
  '#a11': '--writing-code-string',
  '#e40': '--writing-code-number',
  '#00f': '--writing-code-operator',
  '#30a': '--writing-code-string',
  '#085': '--writing-code-keyword',
  '#167': '--writing-code-operator',
  '#256': '--writing-code-keyword',
  '#00c': '--writing-code-operator',
  '#940': '--writing-code-comment',
  '#f00': '--writing-code-error',
}

export const writingCodeTheme = syntaxHighlighting(HighlightStyle.define(defaultHighlightStyle.specs.map(style => {
  const variable = colorVariables[style.color]
  return variable ? { ...style, color: `var(${variable}, ${style.color})` } : style
})))
