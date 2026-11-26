import { $nodeSchema, $remark, $prose } from '@milkdown/kit/utils'
import { parserCtx } from '@milkdown/kit/core'
import { Plugin, NodeSelection } from '@milkdown/kit/prose/state'
import { Fragment, Slice } from '@milkdown/kit/prose/model'
import { sliceResources } from './writingResourcePaste.js'
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

function misplacedFrontMatter(doc) {
  const found = []
  doc.descendants((node, pos, parent) => {
    if (node.type.name === name && (pos !== 0 || parent !== doc)) found.push({ node, pos })
  })
  return found
}
const ordinaryContent = (node, parse) => parse('\n' + node.attrs.source).content
function expandFrontMatter(tr, misplaced, parse) {
  for (const { node, pos } of [...misplaced].reverse()) tr.replaceWith(pos, pos + node.nodeSize, ordinaryContent(node, parse))
  return tr
}

// Table fitting must see ordinary nodes before it decides which cells survive.
export function plainFrontMatterSlice(slice, parse) {
  let changed = false
  function expand(fragment) {
    const nodes = []
    fragment.forEach(node => {
      if (node.type.name === name) { changed = true; ordinaryContent(node, parse).forEach(child => nodes.push(child)) }
      else nodes.push(node.isLeaf ? node : node.copy(expand(node.content)))
    })
    return Fragment.fromArray(nodes)
  }
  const content = expand(slice.content)
  return changed ? new Slice(content, slice.openStart, slice.openEnd) : slice
}

// Prepare the actual fitted insertion, including existing metadata displaced by
// a paste before it. Resource checks and commit use this same transaction. The
// mapped inserted ranges exclude untouched resources elsewhere in the document.
export function prepareFrontMatterInsertion(state, slice, parse) {
  let hasMetadata = state.doc.firstChild?.type.name === name
  slice.content.descendants(node => { if (node.type.name === name) hasMetadata = true })
  if (!hasMetadata) return null
  const tr = state.tr.replaceSelection(slice)
  const misplaced = misplacedFrontMatter(tr.doc)
  if (!misplaced.length) return null
  expandFrontMatter(tr, misplaced, parse)
  let content = Fragment.empty
  tr.mapping.maps.forEach((map, index) => map.forEach((_a, _b, start, end) => {
    if (start === end) return
    const remaining = tr.mapping.slice(index + 1)
    const from = remaining.map(start, -1), to = remaining.map(end, 1)
    if (to > from) content = content.append(tr.doc.slice(from, to).content)
  }))
  return { state, transaction: tr.scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'), resourceSlice: new Slice(content, 0, 0) }
}

export function writingFrontMatter(onBlocked) {
  const position = $prose(ctx => new Plugin({
    filterTransaction(tr) {
      if (!tr.docChanged) return true
      // Drag/drop and structural edits have no asynchronous resource-ownership
      // continuation. Reject a hidden-to-active resource transition there. A
      // prepared paste already contains ordinary nodes and never takes this path.
      for (const { node } of misplacedFrontMatter(tr.doc)) {
        let resources
        try { resources = sliceResources(new Slice(ordinaryContent(node, ctx.get(parserCtx)), 0, 0)) }
        catch { resources = [true] }
        if (!resources.length) continue
        onBlocked?.('含资源引用的 YAML 移离文首前需要检查资源，请复制或剪切后粘贴到目标位置。')
        return false
      }
      return true
    },
    appendTransaction(transactions, oldState, state) {
      if (!transactions.some(tr => tr.docChanged)) return null
      const misplaced = misplacedFrontMatter(state.doc)
      return misplaced.length ? expandFrontMatter(state.tr, misplaced, ctx.get(parserCtx)) : null
    },
  }))
  return [syntax, schema, position].flat()
}

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
