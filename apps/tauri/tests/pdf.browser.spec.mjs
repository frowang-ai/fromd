import { test, expect } from '@playwright/test';
import { installMockHost } from './mock-host.mjs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const pdfModule = '/@fs/' + fileURLToPath(new URL('../../../packages/editor/src/markdown/pdfDocument.js', import.meta.url)).replaceAll('\\', '/');

const png = (await readFile(new URL('./fixtures/synthetic-resource.png', import.meta.url))).toString('base64');
const reference = '.frowd-assets/' + 'b'.repeat(64) + '.png';
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="green"/></svg>').toString('base64');

test('exported PDF HTML gives root blank lines the same spacing as historical placeholders', async ({ page }) => {
  const baseline = ['- list\n- item', '## heading', '```text\ncode\n\nbody\n```',
    '$$\nx\n\ny\n$$', '[^note]: Footnote\n\n    Second paragraph', 'tail[^note]'];
  const prefix = '---\nname: test\n---\n\n\n\n';
  const markdown = prefix + baseline.join('\n\n \n\t\n') + '\n\n\n';
  await page.addInitScript(installMockHost, { markdown });
  await page.goto('/?testHost=1');
  const body = page.locator('.ProseMirror:visible');
  await expect(body.locator(':scope > p').filter({ hasText: /^$/ })).toHaveCount(10);
  await page.getByText('文件', { exact: true }).click();
  await page.getByRole('button', { name: '导出 PDF…', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__FROWD_TEST_HOST__.entered.export_pdf)).toBe(1);
  const result = await page.evaluate(async ({ pdfModule, legacy }) => {
    const { renderMarkdown } = await import(pdfModule.replace('pdfDocument.js', 'index.js'));
    const html = window.__FROWD_TEST_HOST__.calls.find(call => call.command === 'export_pdf').args.html;
    const parse = html => new DOMParser().parseFromString(html, 'text/html');
    const document = parse(html);
    return {
      breaks: document.querySelectorAll('br').length,
      historicalBreaks: parse(renderMarkdown(legacy)).querySelectorAll('br').length,
      code: document.querySelector('.language-text').textContent,
    };
  }, { pdfModule, legacy: prefix + baseline.join('\n\n<br />\n\n<br />\n\n') });
  expect(result).toEqual({ breaks: 10, historicalBreaks: 10, code: 'code\n\nbody\n' });
});

test('network images load without CORS or referrer and print as text beside embedded SVG', async ({ page }) => {
  const remote = 'http://127.0.0.1:15765/remote.png';
  const svgReference = 'images/vector.svg';
  const inline = 'data:image/svg+xml;base64,' + svg;
  const requests = [];
  await page.route(remote, async route => {
    requests.push(route.request().headers());
    await route.fulfill({ contentType: 'image/png', body: Buffer.from(png, 'base64') });
  });
  await page.addInitScript(installMockHost, {
    markdown: `![example badge](${remote})\n\n![local](${svgReference})\n\n![inline](${inline})`,
    objects: [[svgReference, { mime: 'image/svg+xml', base64: svg }]],
    bindings: [['a', [svgReference]]],
  });
  await page.goto('/?testHost=1');
  const image = page.locator('.ProseMirror img[alt="example badge"]');
  await expect.poll(() => image.evaluate(img => img.naturalWidth)).toBe(240);
  await expect.poll(() => page.locator('.ProseMirror img[alt="local"]').evaluate(img => img.naturalWidth)).toBe(16);
  expect(await image.getAttribute('crossorigin')).toBeNull();
  await expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
  expect(requests).toHaveLength(1);
  expect(requests[0].referer).toBeUndefined();
  const printed = await page.evaluate(async ({ pdfModule, remote }) => {
    const { renderMarkdown } = await import(pdfModule.replace('pdfDocument.js', 'index.js'));
    const inert = document.createElement('template');
    inert.innerHTML = renderMarkdown(`![default](${remote})`);
    return inert.content.querySelector('img').getAttribute('src');
  }, { pdfModule, remote });
  expect(printed).toBeNull();
  await page.getByText('文件', { exact: true }).click();
  await page.getByRole('button', { name: '导出 PDF…', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__FROWD_TEST_HOST__.entered.export_pdf ?? 0)).toBe(1);
  const result = await page.evaluate(() => {
    const calls = window.__FROWD_TEST_HOST__.calls;
    const html = calls.find(call => call.command === 'export_pdf').args.html;
    const document = new DOMParser().parseFromString(html, 'text/html');
    return {
      references: calls.find(call => call.command === 'pdf_images').args.references,
      images: [...document.images].map(image => image.getAttribute('src')),
      text: document.querySelector('.missing-image').textContent,
    };
  });
  expect(result.references).toEqual([svgReference, inline]);
  expect(result.images).toEqual([inline, inline]);
  expect(result.text).toBe('example badge');
  expect(requests).toHaveLength(1);
});

test('raw HTML images preview safely and preserve their original Markdown through editing and copy', async ({ page }) => {
  const origin = 'http://127.0.0.1:15765';
  const local = '<img src="images/local.png" alt="local raw" title="Local title">';
  const remote = `<img src='${origin}/raw.png' alt='remote raw' title='Remote title' srcset='${origin}/ignored.png 1x' onload='ignored'>`;
  const markdown = `${local}\n\nBefore ${remote} after.\n`;
  const paths = [];
  await page.route(origin + '/**', async route => {
    paths.push(new URL(route.request().url()).pathname);
    expect(route.request().headers().referer).toBeUndefined();
    await route.fulfill({ contentType: 'image/png', body: Buffer.from(png, 'base64') });
  });
  await page.addInitScript(installMockHost, {
    markdown, objects: [['images/local.png', { mime: 'image/png', base64: png }]],
    bindings: [['a', ['images/local.png']]],
  });
  await page.goto('/?testHost=1');
  const body = page.locator('.ProseMirror:visible');
  const localImage = body.locator('img[alt="local raw"]');
  const remoteImage = body.locator('img[alt="remote raw"]');
  for (const image of [localImage, remoteImage]) {
    await expect.poll(() => image.evaluate(img => img.naturalWidth)).toBe(240);
  }
  await expect(localImage).toHaveAttribute('title', 'Local title');
  await expect(remoteImage).toHaveAttribute('referrerpolicy', 'no-referrer');
  for (const name of ['crossorigin', 'srcset', 'onload']) expect(await remoteImage.getAttribute(name)).toBeNull();
  expect(paths).toEqual(['/raw.png']);
  await body.focus();
  await body.press('Control+End');
  await page.keyboard.insertText(' edited');
  await expect.poll(() => page.evaluate(() => window.__FROWD_TEST_HOST__.rows.get('a').markdown)).toBe(markdown.replace(' after.', ' after. edited'));
  await body.press('Control+a');
  const copied = await body.evaluate(el => {
    const data = new DataTransfer();
    el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
    const html = data.getData('text/html');
    const template = document.createElement('template');
    template.innerHTML = html;
    return {
      html, images: template.content.querySelectorAll('img').length,
      source: [...template.content.querySelectorAll('span[data-type="html"]')].map(node => node.dataset.value),
    };
  });
  expect(copied.source).toEqual([local, remote]);
  expect(copied.images).toBe(0);
  expect(paths).toEqual(['/raw.png']);
  await body.press('Control+End');
  await body.press('Enter');
  await body.evaluate((el, html) => {
    const data = new DataTransfer();
    data.setData('text/html', html);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, copied.html);
  await expect(body.locator('img[alt="local raw"]')).toHaveCount(2);
  await expect.poll(() => page.evaluate(raw => window.__FROWD_TEST_HOST__.rows.get('a').markdown.split(raw).length, remote)).toBe(3);
});

test('protocol-relative images print as alt text without network or local IPC', async ({ page }) => {
  let requests = 0;
  await page.route('**/protocol-relative.png', async route => { requests++; await route.abort(); });
  await page.addInitScript(installMockHost, { markdown: 'Offline print' });
  await page.goto('/?testHost=1');
  await expect(page.locator('.ProseMirror:visible')).toBeVisible();
  await page.getByText('视图', { exact: true }).click();
  await page.getByRole('button', { name: /^源码/ }).click();
  await page.getByRole('textbox', { name: 'Markdown 源码', exact: true }).fill('![protocol-relative badge](//127.0.0.1:15765/protocol-relative.png)');
  await page.getByText('文件', { exact: true }).click();
  await page.getByRole('button', { name: '导出 PDF…', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__FROWD_TEST_HOST__.entered.export_pdf ?? 0)).toBe(1);
  const result = await page.evaluate(() => {
    const host = window.__FROWD_TEST_HOST__;
    const print = host.calls.find(call => call.command === 'export_pdf').args.html;
    const document = new DOMParser().parseFromString(print, 'text/html');
    return [document.querySelector('.missing-image').textContent, host.entered.pdf_images ?? 0, document.images.length];
  });
  expect(result).toEqual(['protocol-relative badge', 0, 0]);
  expect(requests).toBe(0);
});
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
