import { test, expect } from '@playwright/test'
import { installMockHost } from './mock-host.mjs'

const body = page => page.locator('.ProseMirror:visible')
const markdown = '# 合成引用光标回归\n\n' + Array.from({ length: 28 }, (_, index) => `> 引用第 ${index + 1} 段：普通文字应当能够落下可见光标并继续输入，保留字面量 \\citep{synthetic${index}}。`).join('\n>\n') + '\n\n> 公式段落包含 $T_i = \\frac{N_i}{S_i}$，公式仍可打开编辑。\n\n结尾正文。\n'

async function pointForText(page, locator, needle, offset = 2) {
  return locator.evaluate((element, { needle, offset }) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const text = walker.currentNode
      const start = text.textContent.indexOf(needle)
      if (start < 0) continue
      const range = document.createRange()
      range.setStart(text, start + offset)
      range.setEnd(text, start + offset + 1)
      const rect = range.getBoundingClientRect()
      return { x: rect.left + Math.max(1, rect.width / 2), y: rect.top + rect.height / 2 }
    }
    throw new Error(`text not found: ${needle}`)
  }, { needle, offset })
}

async function caretState(page, point) {
  return page.evaluate(point => {
    const editor = document.querySelector('.ProseMirror')
    const virtual = editor?.querySelector('.prosemirror-virtual-cursor')
    const dom = getSelection()
    const node = dom?.anchorNode
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement
    const range = dom?.rangeCount ? dom.getRangeAt(0).getBoundingClientRect() : null
    const pm = document.querySelector('.pm-port').__vueParentComponent.exposed.capture().pm.state.selection
    return {
      contenteditable: editor?.getAttribute('contenteditable'),
      inert: document.querySelector('.pm-port').inert,
      domInQuote: Boolean(element?.closest('blockquote')),
      domRect: range?.toJSON(),
      pm: { type: pm.constructor.name.replace(/^_/, ''), parent: pm.$from.parent.type.name },
      nativeCaret: getComputedStyle(editor).caretColor,
      virtualCaret: virtual ? { display: getComputedStyle(virtual).display, rect: virtual.getBoundingClientRect().toJSON() } : null,
      point,
    }
  }, point)
}

test('引用块普通文字在滚动和缩放后仍有可见原生光标，行内公式仍可编辑', async ({ page }) => {
  await page.addInitScript(installMockHost, { markdown })
  await page.goto('/?testHost=1')
  await expect(body(page)).toHaveAttribute('contenteditable', 'true')
  const quotes = body(page).locator('blockquote')
  await expect(quotes).toHaveCount(2)
  const quote = quotes.first()
  const formulaQuote = quotes.nth(1)
  const target = quote.locator('p').nth(20)
  const observations = []
  for (const zoom of [100, 120]) {
    await page.keyboard.press('Control+0')
    if (zoom === 120) { await page.keyboard.press('Control+='); await page.keyboard.press('Control+=') }
    await expect(page.locator('.app-shell')).toHaveAttribute('data-zoom', String(zoom))
    await target.scrollIntoViewIfNeeded()
    const point = await pointForText(page, target, '引用第 21 段')
    await page.mouse.click(point.x, point.y)
    await expect.poll(async () => (await caretState(page, point)).pm).toEqual({ type: 'TextSelection', parent: 'paragraph' })
    const state = await caretState(page, point)
    observations.push({ zoom, state })
    expect(state.contenteditable).toBe('true')
    expect(state.inert).toBe(false)
    expect(state.domInQuote).toBe(true)
    expect(state.nativeCaret).not.toBe('rgba(0, 0, 0, 0)')
    expect(state.virtualCaret?.display).toBe('none')
    expect(Math.abs(state.domRect.y - point.y)).toBeLessThan(30)
    expect(Math.abs(state.domRect.x - point.x)).toBeLessThan(30)
    await page.keyboard.insertText(`输入${zoom}`)
    await expect(target).toContainText(`输入${zoom}`)
    await page.keyboard.press('Control+z')
    await expect(target).not.toContainText(`输入${zoom}`)
  }
  await expect(formulaQuote.locator('.writing-math-inline .writing-math-preview')).toHaveCount(1)
  await formulaQuote.locator('.writing-math-inline .writing-math-preview').click()
  await expect(page.getByRole('textbox', { name: '行内公式 LaTeX', exact: true })).toBeVisible()
  expect(observations.map(({ zoom }) => zoom)).toEqual([100, 120])
})
