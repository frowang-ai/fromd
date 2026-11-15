import { Plugin, PluginKey, TextSelection, NodeSelection } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { closeHistory } from '@milkdown/kit/prose/history'

export const MAX_SEARCH_MATCHES = 10000
export const writingSearchKey = new PluginKey('writing-search')

// A literal RegExp keeps UTF-16 offsets stable for Unicode case folding.
export function findTextMatches(text, query, matchCase = false, limit = MAX_SEARCH_MATCHES) {
  const matches = []
  if (!query) return { matches, truncated: false }
  const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'gu' : 'giu')
  for (const match of text.matchAll(expression)) {
    if (matches.length === limit) return { matches, truncated: true }
    matches.push({ from: match.index, to: match.index + match[0].length })
  }
  return { matches, truncated: false }
}

export function findDocumentMatches(doc, query, matchCase = false) {
  const matches = []
  if (!query) return { matches, truncated: false }
  let truncated = false
  function append(text, start, kind) {
    const result = findTextMatches(text, query, matchCase, MAX_SEARCH_MATCHES - matches.length)
    for (const match of result.matches) matches.push(kind === 'math'
      ? { kind, from: start, to: start + 1, offset: match.from, length: match.to - match.from }
      : { kind, from: start + match.from, to: start + match.to })
    truncated ||= result.truncated
  }
  doc.descendants((node, position) => {
    if (truncated) return false
    if (!node.isTextblock) return true
    let text = '', start = position + 1
    function flush() { if (text) append(text, start, 'text'); text = '' }
    node.forEach((child, offset) => {
      if (truncated) return
      if (child.isText) {
        if (!text) start = position + 1 + offset
        text += child.text
      } else {
        flush()
        if (child.type.name === 'math_inline') append(child.attrs.value, position + 1 + offset, 'math')
      }
    })
    flush()
    return false
  })
  return { matches, truncated }
}

function searchState(doc, query = '', matchCase = false, index = 0) {
  const result = findDocumentMatches(doc, query, matchCase)
  const count = result.matches.length
  return { ...result, query, matchCase, count, index: count ? ((index % count) + count) % count : -1 }
}
function summary(state) { return { count: state.count, index: state.index, truncated: state.truncated } }

export const writingSearchPlugin = new Plugin({
  key: writingSearchKey,
  state: {
    init: (_, state) => searchState(state.doc),
    apply(transaction, previous) {
      const request = transaction.getMeta(writingSearchKey)
      if (!request && !transaction.docChanged) return previous
      const { query, matchCase, index } = request || previous
      return searchState(transaction.doc, query, matchCase, index)
    },
  },
  props: {
    decorations(state) {
      const result = writingSearchKey.getState(state)
      const seenMath = new Set()
      return DecorationSet.create(state.doc, result.matches.flatMap((match, index) => {
        const attributes = { class: index === result.index ? 'writing-search-match writing-search-current' : 'writing-search-match' }
        if (match.kind !== 'math') return [Decoration.inline(match.from, match.to, attributes)]
        if (seenMath.has(match.from)) return []
        seenMath.add(match.from)
        if (result.matches[result.index]?.from === match.from) attributes.class = 'writing-search-match writing-search-current'
        return [Decoration.node(match.from, match.to, attributes)]
      }))
    },
  },
})

export function findInView(view, query, matchCase = false, index = 0, select = true) {
  const result = searchState(view.state.doc, query, matchCase, index)
  let transaction = view.state.tr.setMeta(writingSearchKey, result).setMeta('addToHistory', false)
  const match = result.matches[result.index]
  if (match && select) {
    const selection = match.kind === 'math' ? NodeSelection.create(transaction.doc, match.from)
      : TextSelection.create(transaction.doc, match.from, match.to)
    transaction = transaction.setSelection(selection).scrollIntoView()
  }
  view.dispatch(transaction)
  return summary(result)
}

export function clearViewSearch(view) {
  view.dispatch(view.state.tr.setMeta(writingSearchKey, { query: '', matchCase: false, index: 0 }).setMeta('addToHistory', false))
}

export function replaceInView(view, query, replacement, matchCase = false, index = 0, all = false) {
  const result = searchState(view.state.doc, query, matchCase, index)
  if (all && result.truncated) throw new Error('匹配超过 10,000 处，请缩小查找范围后再全部替换。')
  const matches = all ? result.matches : result.matches.slice(result.index, result.index + 1)
  if (!matches.length) return { ...summary(result), replaced: 0 }
  const transaction = closeHistory(view.state.tr)
  for (const match of matches.toReversed()) {
    if (match.kind === 'math') {
      const node = transaction.doc.nodeAt(match.from)
      const value = node.attrs.value.slice(0, match.offset) + replacement + node.attrs.value.slice(match.offset + match.length)
      transaction.setNodeMarkup(match.from, undefined, { ...node.attrs, value })
    } else transaction.insertText(replacement, match.from, match.to)
  }
  view.dispatch(transaction)
  view.dispatch(closeHistory(view.state.tr))
  let nextIndex = 0
  if (!all) {
    const replaced = matches[0], next = findDocumentMatches(view.state.doc, query, matchCase)
    nextIndex = next.matches.findIndex(match => replaced.kind === 'math'
      ? match.from > replaced.from || (match.from === replaced.from && match.offset >= replaced.offset + replacement.length)
      : match.from >= replaced.from + replacement.length)
    if (nextIndex < 0) nextIndex = 0
  }
  return { ...findInView(view, query, matchCase, nextIndex), replaced: matches.length }
}
