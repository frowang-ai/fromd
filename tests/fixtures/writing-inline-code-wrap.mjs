// Synthetic content only; shared by the standalone editor, desktop and PDF checks.
export const inlineCodeWrapMarkdown = [
  '前缀说明 `recall / search / view / list / inspect / compare / export / synthetic_action / recheck / summarize / validate / finish` 后缀文字。',
  '无空格路径 `synthetic_pipeline/stage_v4/audit/very_long_module_check_without_spaces.py::synthetic_identifier` 后文。',
  '| 合成项目 | 检查状态 | `synthetic_namespace::very_long_header_identifier_without_spaces` | 相邻列说明 |',
  '| --- | --- | --- | --- |',
  '| 示例项目文字 | 等待合成检查 | `synthetic_pipeline/stage_v4/audit/very_long_module_check_without_spaces.py` 普通中文 | 右侧合成内容保持清楚 |',
  '| 示例项目文字 | 等待合成检查 | `synthetic_results/very_long_output_directory/summary_without_spaces.json::result_key` | 右侧合成内容保持清楚 |',
  '| 示例项目文字 | 等待合成检查 | <kbd>SyntheticControlWithoutSpaces+SyntheticShiftWithoutSpaces</kbd> | 右侧合成内容保持清楚 |',
  '| 示例项目文字 | 等待合成检查 | synthetic_plain_identifier_without_any_spaces_for_cell_wrapping | 右侧合成内容保持清楚 |',
  '',
  '```js',
  'const syntheticCodeBlock = "keep block presentation";',
  '```',
].join('\n').replace('\n无空格路径', '\n\n无空格路径').replace('\n| 合成项目', '\n\n| 合成项目')

// Runs in the browser so every assertion uses rendered geometry, not CSS text.
export function measureInlineCodeWrap(root) {
  const rect = el => {
    const { left, right, top, bottom, width, height } = el.getBoundingClientRect()
    return { left, right, top, bottom, width, height }
  }
  const fragments = el => [...el.getClientRects()].map(({ left, right, top, bottom }) => ({ left, right, top, bottom }))
  const codeLayout = code => ({ display: getComputedStyle(code).display, fragments: fragments(code),
    decoration: getComputedStyle(code).boxDecorationBreak, radius: getComputedStyle(code).borderRadius })
  const paragraphs = [...root.querySelectorAll('p')].filter(p => /^(前缀说明|无空格路径)/.test(p.textContent)).map(p => {
    const prefix = document.createRange(); prefix.selectNodeContents(p.firstChild)
    const code = p.querySelector('code'), text = document.createRange(); text.selectNodeContents(code)
    return { ...codeLayout(code), textFragments: fragments(text), prefix: rect(prefix), paragraph: rect(p) }
  })
  const table = root.querySelector('table.children') || root.querySelector('table')
  const cells = [...table.rows].map(row => {
    const cell = row.cells[2], next = row.cells[3], inline = cell.querySelector('code,kbd')
    const range = document.createRange(); range.selectNodeContents(cell.querySelector('p') || cell)
    return { cell: rect(cell), next: rect(next), fontSize: parseFloat(getComputedStyle(cell).fontSize),
      inline: inline ? { ...codeLayout(inline), tag: inline.tagName } : null,
      fragments: inline ? fragments(inline) : fragments(range) }
  })
  return { root: rect(root), surface: root.matches('.markdown-body') ? rect(root) : { left: 0, right: innerWidth }, table: rect(table), paragraphs, cells,
    columns: [...table.rows[1].cells].map(cell => ({ ...rect(cell), fontSize: parseFloat(getComputedStyle(cell).fontSize) })) }
}

export function expectInlineCodeWrap(expect, layout) {
  expect(layout.cells).toHaveLength(5)
  expect(layout.columns).toHaveLength(4)
  expect(layout.paragraphs).toHaveLength(2)
  expect.soft(layout.table.right).toBeLessThanOrEqual(layout.root.right + .5)
  for (const cell of layout.cells) {
    if (cell.inline) {
      expect.soft(cell.inline.display).toBe('inline')
      expect.soft(cell.inline.decoration).toBe('clone')
    }
    expect.soft(cell.fragments.length).toBeGreaterThan(cell.inline?.tag === 'CODE' ? 1 : 0)
    for (const fragment of cell.fragments) {
      expect.soft(fragment.right).toBeLessThanOrEqual(cell.cell.right + .5)
      expect.soft(fragment.left).toBeGreaterThanOrEqual(cell.cell.left - .5)
      expect.soft(fragment.left).toBeLessThan(cell.next.left)
    }
  }
  for (const p of layout.paragraphs) {
    expect.soft(p.display).toBe('inline')
    expect.soft(p.fragments.length).toBeGreaterThan(1)
    // Different fonts have different ascenders; sharing a line means vertical overlap.
    if (p === layout.paragraphs[0]) {
      expect.soft(p.fragments[0].top).toBeLessThan(p.prefix.bottom)
      expect.soft(p.fragments[0].bottom).toBeGreaterThan(p.prefix.top)
      expect.soft(p.fragments[0].left).toBeGreaterThanOrEqual(p.prefix.right - .5)
    }
    // Chromium can paint cloned end padding past a soft wrap. Keep glyphs
    // inside the paragraph and the decoration inside the viewport/PDF page.
    for (const text of p.textFragments) expect.soft(text.right).toBeLessThanOrEqual(p.paragraph.right + .5)
    for (const [i, fragment] of p.fragments.entries()) {
      expect.soft(fragment.right).toBeLessThanOrEqual(layout.surface.right + .5)
      if (i) expect.soft(fragment.top).toBeGreaterThanOrEqual(p.fragments[i - 1].bottom - .5)
    }
  }
}
