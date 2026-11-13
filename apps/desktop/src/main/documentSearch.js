export function searchDocumentText(document, query) {
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu')
  const match = pattern.exec(document.markdown || '')
  if (!match && !pattern.test(document.title)) return null
  const offset = match?.index ?? 0
  const text = match ? document.markdown : document.title
  const start = Math.max(0, offset - 40)
  const end = Math.min(text.length, offset + (match?.[0].length || query.length) + 80)
  return {
    id: document.id, revision: document.revision, offset,
    length: match?.[0].length ?? 0, matchIn: match ? 'body' : 'title',
    snippet: `${start ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ')}${end < text.length ? '…' : ''}`,
  }
}
