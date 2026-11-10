// Only paired, attribute-free sub/sup tags become editor marks. Other HTML
// remains Milkdown's inert text; escaped tags and code are never interpreted.
function scriptTag(node) {
  return node.type === 'html' ? /^<(\/?)(sub|sup)\s*>$/i.exec(node.value) : null
}

function transformScripts(node) {
  if (!node.children) return
  const frames = [{ children: [] }]
  for (const child of node.children) {
    transformScripts(child)
    const tag = scriptTag(child), name = tag?.[2].toLowerCase()
    if (tag && !tag[1]) {
      frames.push({ name, opening: child, children: [] })
    } else if (tag && frames.at(-1).name === name) {
      const frame = frames.pop()
      frames.at(-1).children.push({ type: `note_${name}`, children: frame.children })
    } else {
      frames.at(-1).children.push(child)
    }
  }
  // Unclosed tags retain their original content without scanning ahead again.
  while (frames.length > 1) {
    const frame = frames.pop()
    frames.at(-1).children.push(frame.opening, ...frame.children)
  }
  node.children = frames[0].children
}

export function noteScriptPlugins({ $mark, $remark }) {
  const handlers = Object.fromEntries(['sub', 'sup'].map(tag => [`note_${tag}`, (node, _, state, info) => {
    const tracker = state.createTracker(info)
    let value = tracker.move(`<${tag}>`)
    value += tracker.move(state.containerPhrasing(node, { ...tracker.current(), before: '>', after: '<' }))
    return value + `</${tag}>`
  }]))
  const remark = $remark('noteScripts', () => function () {
    const data = this.data()
    data.toMarkdownExtensions = [...(data.toMarkdownExtensions || []), { handlers }]
    return transformScripts
  })
  const marks = ['sub', 'sup'].map(tag => $mark(`note_${tag}`, () => ({
    inclusive: false,
    parseDOM: [{ tag }],
    toDOM: () => [tag, 0],
    parseMarkdown: {
      match: node => node.type === `note_${tag}`,
      runner: (state, node, type) => { state.openMark(type); state.next(node.children); state.closeMark(type) },
    },
    toMarkdown: {
      match: mark => mark.type.name === `note_${tag}`,
      runner: (state, mark) => { state.withMark(mark, `note_${tag}`) },
    },
  })))
  return [remark, ...marks].flat()
}
