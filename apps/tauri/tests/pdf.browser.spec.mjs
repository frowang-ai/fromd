import { test, expect } from '@playwright/test';
import { installMockHost } from './mock-host.mjs';
import { readFile } from 'node:fs/promises';

const png = (await readFile(new URL('./fixtures/synthetic-resource.png', import.meta.url))).toString('base64');
const reference = '.frowd-assets/' + 'b'.repeat(64) + '.png';
test('PDF menu builds a full self-contained document with exact owner, final input, image and math fonts', async ({ page }) => {
  await page.addInitScript(installMockHost, {
    markdown: `# 中文导出\n\n公式 $E=mc^2$\n\n| 项目 | 数值 |\n| --- | --- |\n| 合成表格 | 42 |\n\n![图片](${reference})`,
    objects: [[reference, { mime: 'image/png', base64: png }]], bindings: [['a', [reference]]],
  });
  await page.goto('/?testHost=1');
  const body = page.locator('.ProseMirror:visible');
  await expect(body).toBeVisible();
  await page.getByText('视图', { exact: true }).click();
  await page.getByRole('button', { name: /^源码/ }).click();
  const source = page.getByRole('textbox', { name: 'Markdown 源码', exact: true });
  await source.press('Control+End');await source.press('Enter');await source.press('Enter');await source.pressSequentially('final input');
  await page.getByText('文件', { exact: true }).click();
  await page.getByRole('button', { name: '导出 PDF…', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__FROWD_TEST_HOST__.entered.export_pdf ?? 0)).toBe(1);
  const result = await page.evaluate(() => {
    const host = window.__FROWD_TEST_HOST__;
    return { call: host.calls.find(call => call.command === 'export_pdf').args, document: host.rows.get('a') };
  });
  expect(result.call.id).toBe('a');expect(result.call.revision).toBe(result.document.revision);
  const parsed = await page.evaluate(html => {
    const document = new DOMParser().parseFromString(html, 'text/html');
    return { text: document.body.textContent, tables: document.querySelectorAll('table').length,
      image: document.querySelector('img').src, styles: [...document.querySelectorAll('style')].map(style => style.textContent).join('') };
  }, result.call.html);
  expect(parsed.text).toContain('中文导出');expect(parsed.text).toContain('final input');expect(parsed.tables).toBe(1);
  expect(parsed.image).toBe('data:image/png;base64,' + png);
  expect(parsed.styles).toContain('@font-face');expect(parsed.styles).toContain('data:font/woff2;base64,');
  expect(parsed.styles).not.toMatch(/url\([^)]*\.woff/);
  expect(result.call.html).not.toContain('应用菜单');
});

test('an unauthorized image fails before the native save or print command', async ({ page }) => {
  await page.addInitScript(installMockHost, { markdown: '# 图片归属\n\n![missing](' + reference + ')' });
  await page.goto('/?testHost=1');await expect(page.locator('.ProseMirror:visible')).toBeVisible();
  await page.getByText('文件', { exact: true }).click();await page.getByRole('button', { name: '导出 PDF…', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('PDF 图片不可用');
  expect(await page.evaluate(() => window.__FROWD_TEST_HOST__.entered.export_pdf ?? 0)).toBe(0);
  await expect(page.locator('.ProseMirror:visible')).toHaveAttribute('contenteditable', 'true');
});
