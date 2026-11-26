import { $nodeSchema, $remark, $prose } from '@milkdown/kit/utils'
import { parserCtx } from '@milkdown/kit/core'
import { Plugin, NodeSelection } from '@milkdown/kit/prose/state'
import { leadingFrontMatter, remarkFrontMatter } from './markdown/frontmatter.js'

const name = 'yaml_frontmatter'
const syntax = $remark('writingFrontMatter', () => remarkFrontMatter)
const schema = $nodeSchema(name, () => ({
  group: 'block', atom: true, isolating: true,
  attrs: { source: { default: '', validate: 'string' } },
  // Text is always a DOM text node, including tags, URLs and YAML directives.
  toDOM: node => ['pre', { class: 'writing-frontmatter', 'data-writing-frontmatter': node.attrs.source },
    ['code', leadingFrontMatter(node.attrs.source)?.raw.replace(/^\uFEFF/, '') ?? node.attrs.source]],
  parseDOM: [{ tag: 'pre[data-writing-frontmatter]', priority: 60, getAttrs: dom => {
    const source = dom.getAttribute('data-writing-frontmatter')
    return leadingFrontMatter(source)?.prefix === source ? { source } : false
  } }],
  parseMarkdown: { match: node => node.type === 'yaml', runner: (state, node, type) => state.addNode(type, { source: node.value }) },
  toMarkdown: { match: node => node.type.name === name, runner: (state, node) => state.addNode('yaml', undefined, node.attrs.source) },
}))

// Pasted/moved metadata is special only at the document start. At another
// position parse it as ordinary Markdown, just as reopening that file would.
const position = $prose(ctx => new Plugin({
  appendTransaction(transactions, oldState, state) {
    if (!transactions.some(tr => tr.docChanged)) return null
    const misplaced = []
    state.doc.descendants((node, pos, parent) => {
      if (node.type.name === name && (pos !== 0 || parent !== state.doc)) misplaced.push({ node, pos })
    })
    if (!misplaced.length) return null
    let tr = state.tr
    for (const { node, pos } of misplaced.reverse()) {
      const ordinary = ctx.get(parserCtx)('\n' + node.attrs.source)
      tr = tr.replaceWith(pos, pos + node.nodeSize, ordinary.content)
    }
    return tr
  },
}))
export const writingFrontMatter = [syntax, schema, position].flat()

export function serializeFrontMatter(doc, serialize) {
  if (doc.firstChild?.type.name !== name) return serialize(doc)
  const source = doc.firstChild.attrs.source
  const body = doc.copy(doc.content.cut(doc.firstChild.nodeSize))
  if (!body.childCount) return source
  const separator = /(?:\r\n|\n|\r)$/.test(source) ? '' : '\n\n'
  return source + separator + serialize(body)
}

export function installFrontMatterView(view, onEdit) {
  const previous = view.props.nodeViews || {}
  view.setProps({ nodeViews: { ...previous, [name](node, editor, getPos) {
    const dom = document.createElement('div'); dom.className = 'writing-frontmatter-block'; dom.contentEditable = 'false'
    const pre = document.createElement('pre'); pre.className = 'writing-frontmatter'
    pre.textContent = leadingFrontMatter(node.attrs.source)?.raw.replace(/^\uFEFF/, '') ?? node.attrs.source
    const button = document.createElement('button'); button.type = 'button'; button.className = 'writing-frontmatter-edit'
    button.textContent = '编辑 YAML 源码'
    button.addEventListener('click', () => {
      if (!editor.editable || getPos() !== 0) return
      onEdit()
    })
    dom.append(pre, button)
    return { dom, stopEvent: event => button.contains(event.target), ignoreMutation: () => true }
  } } })
}

export function frontMatterSelection(doc, offset) {
  const node = doc.firstChild
  return node?.type.name === name && offset < node.attrs.source.length ? NodeSelection.create(doc, 0) : null
}
