import { DOMParser, DOMSerializer } from '@milkdown/kit/prose/model'
import { logWritingEvent } from './writingDiagnostics.js'

export function describeWritingDocument(doc) {
  const counts = { displayMath: 0, inlineMath: 0, headings: 0, tables: 0 }
  doc.descendants(node => {
    if (node.type.name === 'math_inline') counts.inlineMath++
    if (node.type.name === 'code_block' && String(node.attrs.language).toLowerCase() === 'latex') counts.displayMath++
    if (node.type.name === 'heading') counts.headings++
    if (node.type.name === 'table') counts.tables++
  })
  return counts
}
function richFeatures(doc) {
  const features = {}
  const add = key => { features[key] = (features[key] || 0) + 1 }
  doc.descendants(node => {
    if (['table', 'table_row', 'table_cell', 'table_header', 'image', 'bullet_list', 'ordered_list', 'list_item', 'blockquote'].includes(node.type.name)) add(node.type.name)
    if (['writing_comment_inline', 'writing_comment_block'].includes(node.type.name)) add('html_comment')
    if (node.type.name === 'code_block' && String(node.attrs.language).toLowerCase() !== 'latex') add('code_block')
    for (const mark of node.marks) add(`mark:${mark.type.name}`)
  })
  return features
}

// HTML is ordinarily authoritative. Only use explicit Markdown math from the
// same clipboard when HTML lost formulas and doing so preserves rich features.
export function installWritingClipboard(view, { parse, normalize, editorId }) {
  const previous = view.props.handlePaste
  let serial = 0
  view.setProps({
    handlePaste(editorView, event, slice) {
      const data = event.clipboardData
      if (!data) return previous?.(editorView, event, slice) || false
      const text = data.getData('text/plain'), html = data.getData('text/html')
      const pasteId = `${editorId}-${++serial}`
      const metadata = {
        editorId, pasteId, textLength: text.length, htmlLength: html.length,
        types: [...new Set(Array.from(data.types).map(type => ['text/plain', 'text/html', 'Files', 'vscode-editor-data'].includes(type) ? type : 'other'))],
      }
      let route = html ? 'html' : 'markdown', reason = 'default', normalized = false
      let htmlCounts = describeWritingDocument(slice.content), convertedDisplay = 0, convertedInline = 0
      logWritingEvent('paste-received', { ...metadata, htmlDisplayMath: htmlCounts.displayMath, htmlInlineMath: htmlCounts.inlineMath })
      const result = () => queueMicrotask(() => {
        if (!editorView.isDestroyed) logWritingEvent('paste-result', { editorId, pasteId, route, reason, convertedDisplay, convertedInline, ...describeWritingDocument(editorView.state.doc) })
      })
      try {
        const selection = editorView.state.selection
        const literal = selection.$from.parent.type.spec.code || selection.$from.marks().some(mark => mark.type.spec.code)
        if (!editorView.editable || literal || data.getData('vscode-editor-data')) {
          route = 'native'; reason = 'literal-or-special-context'
        } else if (text) {
          const fixed = normalize(text)
          normalized = fixed !== text
          if (html && normalized) {
            const doc = parse(fixed)
            if (doc) {
              const fragment = DOMSerializer.fromSchema(editorView.state.schema).serializeFragment(doc.content)
              let candidate = DOMParser.fromSchema(editorView.state.schema).parseSlice(fragment)
              editorView.someProp('transformPasted', transform => { candidate = transform(candidate, editorView, false) })
              const counts = describeWritingDocument(candidate.content)
              const missingMath = counts.displayMath > htmlCounts.displayMath || counts.inlineMath > htmlCounts.inlineMath
              const before = richFeatures(slice.content), after = richFeatures(candidate.content)
              const preservesRichContent = Object.entries(before).every(([key, count]) => (after[key] || 0) >= count)
              const missingStrong = (after['mark:strong'] || 0) > (before['mark:strong'] || 0)
              const preservesMath = counts.inlineMath >= htmlCounts.inlineMath && counts.displayMath >= htmlCounts.displayMath
              if ((missingMath || missingStrong) && preservesRichContent && preservesMath) {
                route = missingMath ? 'markdown-math-recovery' : 'markdown-format-recovery'
                reason = missingMath ? 'html-lost-explicit-math' : 'html-lost-explicit-strong'
                convertedDisplay = Math.max(0, counts.displayMath - htmlCounts.displayMath)
                convertedInline = Math.max(0, counts.inlineMath - htmlCounts.inlineMath)
                logWritingEvent('paste-route', { ...metadata, route, reason, normalized, convertedDisplay, convertedInline })
                editorView.dispatch(editorView.state.tr.replaceSelection(candidate).scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'))
                result(); return true
              }
              if (missingMath || missingStrong) reason = preservesMath ? 'html-has-additional-rich-content' : 'html-preserves-math'
              else reason = 'html-format-already-preserved'
            }
          }
        }
      } catch (error) {
        route = html ? 'html' : 'markdown'
        reason = 'recovery-error-fallback'
        logWritingEvent('paste-error', { editorId, pasteId, errorType: error instanceof TypeError ? 'TypeError' : 'Error' })
      }
      logWritingEvent('paste-route', { ...metadata, route, reason, normalized })
      result()
      return previous?.(editorView, event, slice) || false
    },
  })
}
