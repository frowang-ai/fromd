import { strikethroughSchema } from '@milkdown/kit/preset/gfm'

// Only paired, attribute-free formatting tags and inline br are interpreted.
// Raw HTML is never inserted; DOM output is built from fixed schema tags.
const tags = ['u', 'mark', 'kbd']
const isBreak = node => node.type === 'html' && /^<br\s*\/?\s*>$/i.test(node.value)
const phrasingBlocks = new Set(['paragraph', 'heading', 'tableCell'])
const blockContainers = new Set(['root', 'blockquote', 'listItem', 'footnoteDefinition'])

function transformBreaks(node, parent, explicit = new Set()) {
  // Leave both placeholder shapes to remarkPreserveEmptyLine, independent of
  // plugin order. In particular a block child must never become an inline node.
  if (isBreak(node) && parent && !blockContainers.has(parent.type)
    && !(['paragraph', 'tableCell'].includes(parent.type) && parent.children.length === 1)) {
    const linebreak = { type: 'break' }
    explicit.add(linebreak)
    return linebreak
  }
  if (!node.children) return node
  node.children = node.children.map(child => transformBreaks(child, node, explicit))
  if (phrasingBlocks.has(node.type)) {
    // A final HTML br terminates the current line without starting a visible
    // empty line. PM adds a caret-only trailingBreak, so omit that last br from
    // its content (also through marks). The serializer restores a fixed br when
    // an actual trailing empty line needs one; two source br then mean one PM br.
    const removeLast = container => {
      for (let index = container.children.length - 1; index >= 0; index--) {
        const last = container.children[index]
        if (last.type === 'writing_comment_inline') continue
        if (explicit.has(last)) { container.children.splice(index, 1); return true }
        if (last.children && removeLast(last)) {
          if (!last.children.length) container.children.splice(index, 1)
          return true
        }
        return false
      }
      return false
    }
    removeLast(node)
  }
  return node
}
const isComment = value => typeof value === 'string' && value.startsWith('<!--') && value.endsWith('-->') && !value.slice(4, -3).includes('-->')

function splitHtmlComments(node) {
  const source = node.value, pieces = []
  const opaqueTags = new Set(['script', 'style', 'textarea', 'title', 'pre', 'code', 'kbd', 'samp', 'math'])
  let cursor = 0, offset = 0, opaque = null
  while ((offset = source.indexOf('<', offset)) !== -1) {
    if (!opaque && source.startsWith('<!--', offset)) {
      const end = source.indexOf('-->', offset + 4)
      if (end === -1) break
      if (offset > cursor) pieces.push({ type: 'html', value: source.slice(cursor, offset) })
      pieces.push({ type: 'html', value: source.slice(offset, end + 3) })
      cursor = offset = end + 3
      continue
    }
    // Skip quoted tag attributes and raw/literal element content. Remaining
    // chunks stay inert HTML nodes; they are never re-parsed as active HTML.
    const tag = /^<(\/?)([a-z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/i.exec(source.slice(offset))
    if (tag) {
      const name = tag[2].toLowerCase()
      if (opaque === name && tag[1]) opaque = null
      else if (!opaque && !tag[1] && opaqueTags.has(name) && !tag[0].endsWith('/>')) opaque = name
      offset += tag[0].length
    } else offset++
  }
  if (!pieces.length) return [node]
  if (cursor < source.length) pieces.push({ type: 'html', value: source.slice(cursor) })
  return pieces
}

// PM marks are sets, not nested scopes. Flatten redundant same-style wrappers
// (even across another style) before parsing so an inner close cannot end its
// still-active outer mark. Different styles and all text remain intact.
function flattenRepeatedMarks(node, active = new Set()) {
  if (!node.children) return
  node.children = node.children.flatMap(child => {
    const ownMark = tags.some(tag => child.type === `writing_${tag}`)
    const next = ownMark ? new Set([...active, child.type]) : active
    flattenRepeatedMarks(child, next)
    return ownMark && active.has(child.type) ? child.children : [child]
  })
}

function commentNode(value, inline) {
  return { type: inline ? 'writing_comment_inline' : 'writing_comment_block', value }
}
function transformFormatting(node, parent, index = 0) {
  // Commonmark's HTML transformer wraps block comments in paragraphs before
  // this plugin runs. Only lift a whole comment paragraph in block containers.
  if (node.type === 'paragraph' && node.children?.length === 1 && node.children[0].type === 'html' && isComment(node.children[0].value)
    && (['root', 'blockquote'].includes(parent?.type) || (parent?.type === 'listItem' && index > 0))) {
    return commentNode(node.children[0].value, false)
  }
  if (node.type === 'html' && isComment(node.value)) {
    return commentNode(node.value, !['root', 'blockquote', 'listItem'].includes(parent?.type))
  }
  if (!node.children) return node
  const frames = [{ children: [] }]
  const inputs = node.children.flatMap(child => child.type === 'html' ? splitHtmlComments(child) : [child])
  inputs.forEach((input, i) => {
    const child = transformFormatting(input, node, i)
    const match = child.type === 'html' ? /^<(\/?)(u|mark|kbd)\s*>$/i.exec(child.value) : null
    const name = match?.[2].toLowerCase()
    if (match && !match[1]) frames.push({ name, opening: child, children: [] })
    else if (match && frames.at(-1).name === name) {
      const frame = frames.pop()
      frames.at(-1).children.push({ type: `writing_${name}`, children: frame.children })
    } else frames.at(-1).children.push(child)
  })
  while (frames.length > 1) {
    const frame = frames.pop(); frames.at(-1).children.push(frame.opening, ...frame.children)
  }
  node.children = frames[0].children
  return node
}

function commentDOM(value, inline) {
  return [inline ? 'span' : 'div', {
    'data-writing-comment': value,
    'data-writing-comment-kind': inline ? 'inline' : 'block',
    class: 'writing-html-comment', hidden: '', 'aria-hidden': 'true', contenteditable: 'false',
  }]
}

export function writingHtmlFormattingPlugins({ $mark, $remark, $nodeSchema }) {
  const handlers = Object.fromEntries(tags.map(tag => [`writing_${tag}`, (node, _, state, info) => {
    const tracker = state.createTracker(info)
    let value = tracker.move(`<${tag}>`)
    value += tracker.move(state.containerPhrasing(node, { ...tracker.current(), before: '>', after: '<' }))
    return value + `</${tag}>`
  }]))
  handlers.break = (node, parent, state, info) => {
    const next = parent?.children?.[parent.children.indexOf(node) + 1]
    // A backslash/newline at an inline mark boundary can be escaped as text.
    // Before HTML (notably comments), containerPhrasing can turn that newline
    // into a space to avoid opening an HTML block, leaving a literal backslash.
    // Fixed br is safe in both cases; ordinary unmarked prose keeps its syntax.
    // Keep potential block openers (and indentation) on the same source line:
    // extra line-start escapes can also change PDF typographer substitutions.
    const startsBlock = next?.type === 'text' && /^(?:[ \t]|[#>*+`~=-]|\d{1,9}[.)](?:[ \t]|$))/.test(next.value)
    const needsHtml = (parent && !phrasingBlocks.has(parent.type))
      || state.stack.includes('tableCell') || state.stack.includes('headingAtx')
      || next?.type === 'html' || info.after.startsWith('<') || startsBlock
    return state.createTracker(info).move(needsHtml ? '<br>' : '\\\n')
  }
  const remark = $remark('writingHtmlFormatting', () => function () {
    const data = this.data()
    data.toMarkdownExtensions = [...(data.toMarkdownExtensions || []), { handlers }]
    return tree => { transformFormatting(tree); flattenRepeatedMarks(tree); transformBreaks(tree) }
  })
  const marks = tags.map(tag => $mark(`writing_${tag}`, () => ({
    // Like strong/emphasis, replacing the whole marked range keeps the style.
    inclusive: true,
    parseDOM: [{ tag }],
    toDOM: () => [tag, 0],
    parseMarkdown: {
      match: node => node.type === `writing_${tag}`,
      runner: (state, node, type) => { state.openMark(type); state.next(node.children); state.closeMark(type) },
    },
    toMarkdown: {
      match: mark => mark.type.name === `writing_${tag}`,
      runner: (state, mark) => { state.withMark(mark, `writing_${tag}`) },
    },
  })))
  const comments = [true, false].map(inline => {
    const kind = inline ? 'inline' : 'block', name = `writing_comment_${kind}`
    return $nodeSchema(name, () => ({
      inline, group: kind, atom: true, selectable: false,
      attrs: { value: { default: '', validate: 'string' } },
      toDOM: node => commentDOM(node.attrs.value, inline),
      parseDOM: [{ tag: `[data-writing-comment-kind="${kind}"]`, getAttrs: dom => {
        const value = dom.getAttribute('data-writing-comment')
        return isComment(value) ? { value } : false
      } }],
      parseMarkdown: { match: node => node.type === name, runner: (state, node, type) => state.addNode(type, { value: node.value }) },
      toMarkdown: { match: node => node.type.name === name, runner: (state, node) => state.addNode('html', undefined, node.attrs.value) },
    }))
  })
  const strikePaste = strikethroughSchema.extendSchema(previous => ctx => {
    const schema = previous(ctx)
    return { ...schema, parseDOM: [...schema.parseDOM, { tag: 's' }] }
  })
  return [remark, ...marks, ...comments, strikePaste].flat()
}

// HTML clipboard comments are otherwise ignored by ProseMirror's DOM parser.
// Convert them to inert schema carriers before paste; no comment payload is
// interpreted as markup. Skip code samples and clipboard transport sentinels.
export function preservePastedComments(html, document) {
  if (!html.includes('<!--')) return html
  const template = document.createElement('template'); template.innerHTML = html
  const walker = document.createTreeWalker(template.content, 128), comments = []
  while (walker.nextNode()) comments.push(walker.currentNode)
  for (const comment of comments) {
    if (comment.parentElement?.closest('pre,code,kbd,samp,script,style,math') || /^(StartFragment|EndFragment)$/.test(comment.data.trim())) continue
    const value = `<!--${comment.data}-->`
    if (!isComment(value)) continue
    const inline = Boolean(comment.parentElement?.closest('p,h1,h2,h3,h4,h5,h6,td,th,a,u,mark,em,strong,span'))
      || comment.parentElement?.tagName === 'LI'
    const [tag, attrs] = commentDOM(value, inline), element = document.createElement(tag)
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value)
    comment.replaceWith(element)
  }
  return template.innerHTML
}
