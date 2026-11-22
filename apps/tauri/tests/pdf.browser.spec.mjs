import { test, expect } from '@playwright/test';
import { installMockHost } from './mock-host.mjs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const pdfModule = '/@fs/' + fileURLToPath(new URL('../../../packages/editor/src/markdown/pdfDocument.js', import.meta.url)).replaceAll('\\', '/');

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
  expect(parsed.styles).not.toMatch(/@page\b/); // Both native backends own A4 and 18mm margins.
  expect(parsed.styles).toContain('11pt/1.75');
  expect(parsed.styles).toContain('width: auto; max-width: none; margin: 0; padding: 0;');
  expect(parsed.styles).toContain('@font-face');expect(parsed.styles).toContain('data:font/woff2;base64,');
  expect(parsed.styles).not.toMatch(/url\([^)]*\.woff/);
  expect(result.call.html).not.toContain('应用菜单');
});

test('shared PDF default keeps CSS A4/18mm while native layout has no second page margin', async ({ page }) => {
  await page.addInitScript(installMockHost, { markdown: 'page layout probe' });
  await page.goto('/?testHost=1');await expect(page.locator('.ProseMirror:visible')).toBeVisible();
  const documents = await page.evaluate(async pdfModule => {
    const { buildPdfDocument } = await import(pdfModule);
    const markdown = '# A4\n\n中文正文';
    return { css: await buildPdfDocument({ markdown }), native: await buildPdfDocument({ markdown, pageLayout: 'native' }) };
  }, pdfModule);
  expect(documents.css).toContain('@page { size: A4; margin: 18mm; }');
  expect(documents.native).not.toMatch(/@page\b/);
  for (const html of Object.values(documents)) { expect(html).toContain('11pt/1.75');expect(html).toContain('中文正文'); }
});

test('an unauthorized image fails before the native save or print command', async ({ page }) => {
  await page.addInitScript(installMockHost, { markdown: '# 图片归属\n\n![missing](' + reference + ')' });
  await page.goto('/?testHost=1');await expect(page.locator('.ProseMirror:visible')).toBeVisible();
  await page.getByText('文件', { exact: true }).click();await page.getByRole('button', { name: '导出 PDF…', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('PDF 图片不可用');
  expect(await page.evaluate(() => window.__FROWD_TEST_HOST__.entered.export_pdf ?? 0)).toBe(0);
  await expect(page.locator('.ProseMirror:visible')).toHaveAttribute('contenteditable', 'true');
});

test('source inline PNG renders normally and stays embedded through the PDF menu', async ({ page }) => {
  await page.addInitScript(installMockHost, { markdown: '# 原文内嵌图片' });
  await page.goto('/?testHost=1');await expect(page.locator('.ProseMirror:visible')).toBeVisible();
  await page.getByText('视图', { exact: true }).click();await page.getByRole('button', { name: /^源码/ }).click();
  const data = 'data:image/png;base64,' + png;
  await page.getByRole('textbox', { name: 'Markdown 源码', exact: true }).fill(`# 原文内嵌图片\n\n![inline](${data})`);
  await page.getByText('视图', { exact: true }).click();await page.getByRole('button', { name: /^正文/ }).click();
  await expect.poll(() => page.locator('.ProseMirror img[src^="data:image/png;base64,"]').evaluate(image => image.naturalWidth)).toBe(240);
  await page.getByText('文件', { exact: true }).click();await page.getByRole('button', { name: '导出 PDF…', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__FROWD_TEST_HOST__.entered.export_pdf ?? 0)).toBe(1);
  const html = await page.evaluate(() => window.__FROWD_TEST_HOST__.calls.find(call => call.command === 'export_pdf').args.html);
  expect(await page.evaluate(html => new DOMParser().parseFromString(html, 'text/html').querySelector('img').getAttribute('src'), html)).toBe(data);
});
