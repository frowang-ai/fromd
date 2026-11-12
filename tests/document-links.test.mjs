import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, normalize } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveDocumentLink, openDocumentLink } from '../apps/desktop/src/main/documentLinks.js'

test('HTTP(S)交给浏览器，查询与片段保留', () => {
  assert.deepEqual(resolveDocumentLink('https://example.com/a?q=1#part', null), { kind: 'web', url: 'https://example.com/a?q=1#part' })
  assert.equal(resolveDocumentLink('HTTP://example.com', null).url, 'http://example.com/')
})
test('文件URL、绝对路径和相对链接解析到笔记位置，编码只解码一次', () => {
  const doc = join(tmpdir(), 'notes', '笔记.md'), file = join(tmpdir(), 'notes', '附件', '方案 #1 100%.docx')
  assert.equal(resolveDocumentLink(pathToFileURL(file).href, null).path, file)
  assert.equal(resolveDocumentLink('./附件/方案%20%231%20100%25.docx#preview', doc).path, file)
  assert.equal(resolveDocumentLink('./附件/name%2520.docx', doc).path, join(tmpdir(), 'notes', '附件', 'name%20.docx'))
  assert.equal(resolveDocumentLink('../同级.pdf', doc).path, join(tmpdir(), '同级.pdf'))
  if (process.platform === 'win32') {
    assert.equal(resolveDocumentLink('F:/资料/方案.docx', null).path, normalize('F:/资料/方案.docx'))
    assert.equal(resolveDocumentLink('/F:/资料/方案.docx', null).path, normalize('F:/资料/方案.docx'))
    assert.equal(resolveDocumentLink(String.raw`F:\资料\方案.docx`, null).path, normalize('F:/资料/方案.docx'))
  }
})
test('草稿的相对链接明确要求保存，不用cwd或其他笔记的位置', () => {
  assert.throws(() => resolveDocumentLink('./附件/计划.docx', null), /先保存为 Markdown.*绝对路径/)
  assert.throws(() => resolveDocumentLink('../计划.docx', 'relative.md'), /先保存为 Markdown/)
})
test('不把未知协议、设备地址、网络共享或歧义路径交给系统', () => {
  for (const href of ['javascript:alert(1)', 'data:text/html,hi', 'ms-word:ofe|u|https://example.com', 'mailto:a@example.com', 'file://server/share/a.docx', '//server/share/a.docx', String.raw`\\?\C:\file`, 'java\tscript:alert(1)', './bad%00.docx', './bad%.docx', '#heading', '', null])
    assert.throws(() => resolveDocumentLink(href, join(tmpdir(), 'note.md')), undefined, String(href))
  if (process.platform === 'win32') for (const href of ['C:relative.docx', '/root/file', 'C:/file.txt:stream'])
    assert.throws(() => resolveDocumentLink(href, join(tmpdir(), 'note.md')))
})
test('文件只定位，目录才openPath；不存在和系统错误返回可读提示', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'frowd-link-unit-'))
  try {
    const folder = join(directory, '附件'); await mkdir(folder)
    const calls = [], shell = {
      openExternal: async target => { calls.push(['web', target]) },
      openPath: async target => { calls.push(['folder', target]); return '' },
      showItemInFolder: target => { calls.push(['reveal', target]) },
    }
    for (const name of ['计划.docx', '计划.pdf', 'application.exe', 'shortcut.lnk', 'website.url']) {
      const file = join(folder, name); await writeFile(file, 'synthetic')
      assert.deepEqual(await openDocumentLink(pathToFileURL(file).href, null, shell), { action: 'reveal' })
      assert.deepEqual(calls.pop(), ['reveal', await realpath(file)])
    }
    assert.deepEqual(await openDocumentLink('./附件', join(directory, 'note.md'), shell), { action: 'folder' })
    assert.deepEqual(calls.pop(), ['folder', await realpath(folder)])
    assert.deepEqual(await openDocumentLink('https://example.com', null, shell), { action: 'browser' })
    assert.deepEqual(calls.pop(), ['web', 'https://example.com/'])
    await assert.rejects(openDocumentLink('./missing.pdf', join(directory, 'note.md'), shell), /不存在/)
    assert.deepEqual(calls, [])
    await assert.rejects(openDocumentLink(folder, null, { ...shell, openPath: async () => 'controlled failure' }), /无法打开文件夹/)
    await assert.rejects(openDocumentLink('https://example.com', null, { ...shell, openExternal: async () => { throw new Error('fail') } }), /默认浏览器/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
