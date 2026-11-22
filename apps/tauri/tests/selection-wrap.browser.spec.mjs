import { test, expect } from '@playwright/test'
import { installMockHost } from './mock-host.mjs'

const body = page => page.locator('.ProseMirror:visible')
const source = page => page.getByRole('textbox', { name: 'Markdown 源码', exact: true })
async function boot(page, markdown) {
  await page.addInitScript(installMockHost, { markdown })
  await page.goto('/?testHost=1')
  await expect(page.locator('.loading-state')).toHaveCount(0)
  await expect(body(page)).toBeVisible()
}
async function capture(page) {
  return page.evaluate(() => {
    const value = document.querySelector('.pm-port').__vueParentComponent.exposed.capture()
    const { doc, selection } = value.pm.state
    doc.check()
    return { markdown: value.markdown, doc: doc.toJSON(), selection: selection.toJSON(),
      selected: doc.textBetween(selection.from, selection.to), text: doc.textContent }
  })
}
async function selectParagraph(page, index = 0, reverse = false) {
  await body(page).locator(':scope > p').nth(index).evaluate((el, reverse) => {
    el.closest('.ProseMirror').focus()
    const range = document.createRange(); range.selectNodeContents(el)
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range)
    if (reverse) selection.setBaseAndExtent(range.endContainer, range.endOffset, range.startContainer, range.startOffset)
  }, reverse)
  await expect.poll(async () => (await capture(page)).selection.anchor !== (await capture(page)).selection.head).toBe(true)
}
async function selectBodyText(page, text) {
  await body(page).locator(':scope > p').first().evaluate((el, text) => {
    el.closest('.ProseMirror').focus()
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), parts = []
    let content = ''
    for (let node; (node = walker.nextNode());) {
      if (node.parentElement.closest('.writing-math')) continue
      parts.push({ node, offset: content.length }); content += node.textContent
    }
    const start = content.indexOf(text), end = start + text.length
    if (start < 0) throw Error('Text selection fixture not found')
    const first = parts.find(p => p.offset + p.node.length > start)
    const last = parts.find(p => p.offset < end && p.offset + p.node.length >= end)
    const range = document.createRange()
    range.setStart(first.node, start - first.offset); range.setEnd(last.node, end - last.offset)
    getSelection().removeAllRanges(); getSelection().addRange(range)
  }, text)
  await expect.poll(async () => (await capture(page)).selected).toBe(text)
}
async function reparseInFreshEditor(page) {
  const serialized = await capture(page)
  // A new page creates a new Milkdown parser/schema/session. Ctrl+/ alone can
  // reuse the old PM tree when source text is unchanged and proves no roundtrip.
  const fresh = await page.context().newPage()
  await boot(fresh, serialized.markdown)
  expect((await capture(fresh)).doc).toEqual(serialized.doc)
  return fresh
}
async function selectSource(page, start, end) {
  await source(page).evaluate((el, range) => { el.focus(); el.setSelectionRange(...range) }, [start, end])
}
const sourceRange = page => source(page).evaluate(el => [el.selectionStart, el.selectionEnd])

test.afterEach(async ({ page }) => {
  await expect(page.getByRole('alert').filter({ hasText: '编辑器加载失败' })).toHaveCount(0)
})

for (const spaced of [false, true]) test(`selection dollar renders inline math, keeps outer spaces and undo selection: ${spaced}`, async ({ page }) => {
  // Use inner spaces to avoid Markdown's paragraph-leading whitespace rules.
  const original = spaced ? '前 X + Y = Z 后\n' : 'X + Y = Z\n'
  await boot(page, original)
  await selectParagraph(page)
  if (spaced) {
    await body(page).locator('p').evaluate(el => {
      const range = document.createRange(); range.setStart(el.firstChild, 1); range.setEnd(el.firstChild, el.textContent.length - 1)
      getSelection().removeAllRanges(); getSelection().addRange(range)
    })
    await expect.poll(async () => (await capture(page)).selected).toBe(' X + Y = Z ')
  }
  const before = await capture(page)
  await page.keyboard.press('$')
  await expect(body(page).locator('.writing-math-inline .katex')).toHaveCount(1)
  await expect(body(page).locator('.writing-math-source')).toBeHidden()
  const wrapped = await capture(page)
  expect(wrapped.markdown).toBe(spaced ? '前 $X + Y = Z$ 后\n' : '$X + Y = Z$\n')
  expect(wrapped.selection.anchor).toBe(spaced ? 4 : 2)
  expect(wrapped.selection.head).toBe(wrapped.selection.anchor)
  await page.keyboard.press('Control+z')
  expect(await capture(page)).toMatchObject({ markdown: original, selection: before.selection })
  await page.keyboard.press('Control+y')
  expect((await capture(page)).markdown).toBe(wrapped.markdown)
  const fresh = await reparseInFreshEditor(page)
  await expect(body(fresh).locator('.writing-math-inline .katex')).toHaveCount(1)
  await fresh.close()
})

for (const key of ['*', '_']) test(`selection ${key} progresses italic, bold, bold italic and undoes each step`, async ({ page }) => {
  await boot(page, '加粗文字\n'); await selectParagraph(page, 0, true)
  const before = await capture(page)
  await page.keyboard.press(key)
  await expect(body(page).locator('em')).toHaveText('加粗文字')
  expect((await capture(page)).selection).toEqual(before.selection)
  const italic = await capture(page)
  await page.keyboard.press(key)
  await expect(body(page).locator('strong')).toHaveText('加粗文字')
  await expect(body(page).locator('em')).toHaveCount(0)
  expect((await capture(page)).markdown).toBe('**加粗文字**\n')
  expect((await capture(page)).selection).toEqual(before.selection)
  const bold = await capture(page)
  await page.keyboard.press(key)
  await expect(body(page).locator('strong em, em strong')).toHaveText('加粗文字')
  const both = await capture(page)
  await page.keyboard.press(key); expect(await capture(page)).toEqual(both)
  for (const snapshot of [bold, italic, before]) {
    await page.keyboard.press('Control+z')
    expect(await capture(page)).toEqual(snapshot)
  }
  await page.keyboard.press('Control+y'); expect(await capture(page)).toEqual(italic)
})

test('selection backtick creates valid inline code from mixed marks and preserves undo', async ({ page }) => {
  await boot(page, '**粗体** 和普通\n'); await selectParagraph(page)
  const before = await capture(page)
  await page.keyboard.press('`')
  expect((await capture(page)).selected).toBe('粗体 和普通')
  expect((await capture(page)).selection).toEqual(before.selection)
  expect(await body(page).locator('code').allTextContents()).toEqual(['粗体 和普通'])
  await page.keyboard.press('Control+z'); expect(await capture(page)).toEqual(before)
})

test('selection tilde is idempotent across two presses and undo is one step', async ({ page }) => {
  await boot(page, '删除文字\n'); await selectParagraph(page)
  const before = await capture(page)
  await page.keyboard.press('~')
  expect((await capture(page)).markdown).toBe('~~删除文字~~\n')
  expect((await capture(page)).selection).toEqual(before.selection)
  const once = await capture(page)
  await page.keyboard.press('~'); expect(await capture(page)).toEqual(once)
  await page.keyboard.press('Control+z'); expect(await capture(page)).toEqual(before)
})

for (const [left, right] of [['(', ')'], ['[', ']'], ['{', '}'], ['"', '"'], ["'", "'"]]) {
  test(`selection ${left} preserves rich marks and inline atoms`, async ({ page }) => {
    await boot(page, '**粗体** 和 $x$\n'); await selectParagraph(page)
    const before = await capture(page)
    await page.keyboard.press(left)
    await expect(body(page).locator('strong')).toHaveText('粗体')
    await expect(body(page).locator('.writing-math-inline .katex')).toHaveCount(1)
    const wrapped = await capture(page), content = wrapped.doc.content[0].content
    expect(content[0]).toEqual({ type: 'text', text: left })
    expect(content.at(-1)).toEqual({ type: 'text', text: right })
    expect(content.slice(1, -1)).toEqual(before.doc.content[0].content)
    expect(wrapped.selection).toEqual({ type: 'text', anchor: before.selection.anchor + 1, head: before.selection.head + 1 })
    await page.keyboard.press('Control+z'); expect(await capture(page)).toEqual(before)
  })
}

test('body compositionstart and isComposing keydown never wrap a selection', async ({ page }) => {
  await boot(page, '输入中文\n'); await selectParagraph(page)
  const before = await capture(page)
  for (const composing of [false, true]) {
    if (composing) await body(page).dispatchEvent('compositionstart', { data: 'zhong' })
    const prevented = await body(page).evaluate((el, composing) => {
      const event = new KeyboardEvent('keydown', { key: '$', isComposing: !composing, bubbles: true, cancelable: true })
      el.dispatchEvent(event); return event.defaultPrevented
    }, composing)
    expect(prevented).toBe(false)
    expect(await capture(page)).toEqual(before)
    if (composing) await body(page).dispatchEvent('compositionend', { data: '' })
  }
})

for (const key of ['$', '*']) test(`code block selection ${key} stays literal`, async ({ page }) => {
  await boot(page, '```js\nX + Y\n```\n')
  const code = page.locator('.cm-content'); await code.click(); await code.press('Control+a'); await code.press(key)
  await expect(code).toHaveText(key)
  await expect(body(page).locator('.writing-math-inline, em, strong')).toHaveCount(0)
  expect((await capture(page)).markdown).toContain('```js\n' + key + '\n```')
})

for (const [left, right] of [['$', '$'], ['*', '*'], ['_', '_'], ['`', '`'], ['~', '~'], ['(', ')'], ['[', ']'], ['{', '}'], ['"', '"'], ["'", "'"]]) {
  test(`source selection ${left} wraps and undo/redo restores text and range`, async ({ page }) => {
    const original = '前 X + Y 后\n'; await boot(page, original)
    await body(page).press('Control+/'); await expect(source(page)).toBeVisible()
    await selectSource(page, 2, 7)
    await page.keyboard.press(left)
    const once = `前 ${left}X + Y${right} 后\n`
    await expect(source(page)).toHaveValue(once)
    expect(await sourceRange(page)).toEqual([3, 8])
    if (['*', '~'].includes(left)) {
      await page.keyboard.press(left)
      await expect(source(page)).toHaveValue(`前 ${left}${left}X + Y${right}${right} 后\n`)
      expect(await sourceRange(page)).toEqual([4, 9])
      await page.keyboard.press('Control+z'); await expect(source(page)).toHaveValue(once)
      expect(await sourceRange(page)).toEqual([3, 8])
    }
    await page.keyboard.press('Control+z'); await expect(source(page)).toHaveValue(original)
    expect(await sourceRange(page)).toEqual([2, 7])
    await page.keyboard.press('Control+y'); await expect(source(page)).toHaveValue(once)
    expect(await sourceRange(page)).toEqual([3, 8])
    await expect.poll(() => page.evaluate(() => window.__FROWD_TEST_HOST__.rows.get('a').markdown)).toBe(once)
  })
}

for (const markdown of ['x$y$\n', '$y$x\n']) test(`review adjacent math is protected without replacing the selected text: ${markdown.trim()}`, async ({ page }) => {
  await boot(page, markdown); await selectBodyText(page, 'x')
  const before = await capture(page)
  await page.keyboard.press('$')
  expect(await capture(page)).toEqual(before)
  const fresh = await reparseInFreshEditor(page); await fresh.close()
})

for (const [label, markdown] of [['image', 'a ![image](synthetic.png) b\n'], ['code', '`code`\n'], ['formula', 'a $x$ b\n']]) test(`review unsafe ${label} selections are preserved on actual keypress`, async ({ page }) => {
  await boot(page, markdown); await selectParagraph(page)
  const before = await capture(page)
  for (const key of ['$', '*', '`']) {
    await page.keyboard.press(key)
    expect(await capture(page)).toEqual(before)
  }
})

for (const [label, markdown] of [
  ['link', '[x+y](https://example.com "title")\n'], ['strong', '**x+y**\n'], ['emphasis', '*x+y*\n'],
  ['strike', '~~x+y~~\n'], ['sub', '<sub>x+y</sub>\n'], ['sup', '<sup>x+y</sup>\n'],
  ['underline', '<u>x+y</u>\n'], ['highlight', '<mark>x+y</mark>\n'],
  ['combined', '**[x+y](https://example.com)**\n'],
]) test(`review math retains uniform ${label} marks through a fresh parser`, async ({ page }) => {
  await boot(page, markdown); await selectParagraph(page)
  const before = await capture(page)
  await page.keyboard.press('$')
  const after = await capture(page), math = after.doc.content[0].content[0]
  expect(math.type).toBe('math_inline')
  expect(math.marks).toEqual(before.doc.content[0].content[0].marks)
  const fresh = await reparseInFreshEditor(page); await fresh.close()
})

for (const key of ['*', '_']) test(`review spaced ${key} upgrades consistently after real serialization and parsing`, async ({ page }) => {
  await boot(page, '前 abc 后\n'); await selectBodyText(page, ' abc ')
  const before = await capture(page)
  await page.keyboard.press(key)
  const after = await capture(page)
  expect(after.selection).toEqual(before.selection)
  const fresh = await reparseInFreshEditor(page)
  await selectBodyText(fresh, ' abc '); await fresh.keyboard.press(key)
  expect((await capture(fresh)).markdown).toBe('前 **abc** 后\n')
  const bold = await reparseInFreshEditor(fresh)
  await selectBodyText(bold, ' abc '); await bold.keyboard.press(key)
  await expect(body(bold).locator('strong em, em strong')).toHaveText('abc')
  await bold.close(); await fresh.close()
})

for (const [label, markdown] of [
  ['partial link', '[x](https://example.com) + y\n'], ['partial strong', '**x** + y\n'],
  ['kbd', '<kbd>x+y</kbd>\n'], ['literal dollar', 'x \\$ y\n'], ['line break', 'x  \ny\n'],
]) test(`review math protects ${label} without deleting content or marks`, async ({ page }) => {
  await boot(page, markdown); await selectParagraph(page)
  const before = await capture(page)
  await page.keyboard.press('$'); expect(await capture(page)).toEqual(before)
})

for (const markdown of ['\\$x\n', 'x\\$\n', '\\$x\\$\n', 'x $y$\n', '$y$ x\n']) {
  test(`review safe math neighbors survive a real Markdown roundtrip: ${markdown.trim()}`, async ({ page }) => {
    await boot(page, markdown); await selectBodyText(page, 'x')
    await page.keyboard.press('$')
    const transformed = await capture(page)
    expect(transformed.doc.content[0].content.some(node => node.type === 'math_inline' && node.attrs.value === 'x')).toBe(true)
    const fresh = await reparseInFreshEditor(page); await fresh.close()
  })
}

for (const [key, mark] of [['~', 'strike_through'], ['`', 'inlineCode']]) test(`review ${key} trims formatting whitespace and roundtrips`, async ({ page }) => {
  await boot(page, '前 abc 后\n'); await selectBodyText(page, ' abc ')
  const before = await capture(page)
  await page.keyboard.press(key)
  const after = await capture(page)
  expect(after.selection).toEqual(before.selection)
  expect(after.doc.content[0].content).toEqual([
    { type: 'text', text: '前 ' }, { type: 'text', text: 'abc', marks: [{ type: mark }] }, { type: 'text', text: ' 后' },
  ])
  const fresh = await reparseInFreshEditor(page); await fresh.close()
})

test('review cross-paragraph selections are protected and whitespace-only selections pass through', async ({ page }) => {
  await boot(page, 'first\n\nsecond\n')
  await body(page).evaluate(el => {
    el.focus(); const range = document.createRange(); range.selectNodeContents(el)
    getSelection().removeAllRanges(); getSelection().addRange(range)
  })
  await expect.poll(async () => (await capture(page)).selected).toBe('firstsecond')
  const before = await capture(page)
  for (const key of ['$', '*', '`', '(']) {
    await page.keyboard.press(key); expect(await capture(page)).toEqual(before)
  }
  const fresh = await page.context().newPage()
  await boot(fresh, '前   后\n'); await selectBodyText(fresh, '   ')
  await fresh.keyboard.press('$')
  expect((await capture(fresh)).text).toBe('前$后')
  await expect(body(fresh).locator('.writing-math-inline')).toHaveCount(0)
  await fresh.close()
})

test('source composition and readonly guards leave wrapping to native input', async ({ page }) => {
  await boot(page, '中文\n'); await body(page).press('Control+/'); await selectSource(page, 0, 2)
  for (const guard of ['event', 'composition', 'readonly', 'modifier']) {
    if (guard === 'composition') await source(page).dispatchEvent('compositionstart', { data: 'zhong' })
    const prevented = await source(page).evaluate((el, guard) => {
      if (guard === 'readonly') el.readOnly = true
      const event = new KeyboardEvent('keydown', { key: '$', isComposing: guard === 'event', altKey: guard === 'modifier', bubbles: true, cancelable: true })
      el.dispatchEvent(event)
      if (guard === 'readonly') el.readOnly = false
      return event.defaultPrevented
    }, guard)
    expect(prevented).toBe(false); await expect(source(page)).toHaveValue('中文\n')
    if (guard === 'composition') await source(page).dispatchEvent('compositionend', { data: '' })
  }
})
