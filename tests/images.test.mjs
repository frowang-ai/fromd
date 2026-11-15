import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fsPromises from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { DocumentStore } from '../apps/desktop/src/main/documentStore.js'
import { imageSources } from '../apps/desktop/src/main/imageAssets.js'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5E0AAAAASUVORK5CYII=', 'base64')
const image = () => ({ bytes: new Uint8Array(png), mime: 'image/png' })

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'frowd-images-'))
  const profile = join(directory, 'profile'), store = new DocumentStore(profile)
  await store.restore()
  t.after(async () => { await store.dispose(); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) })
  return { directory, profile, store, id: store.activeId }
}

test('草稿图片持久化、重试复用，重启与删除撤销仍可读取', async t => {
  const { store, id, profile } = await fixture(t)
  const [source] = await store.importImages(id, [image()])
  assert.match(source, /^_frowd-assets\/[a-f0-9]{64}\.png$/)
  assert.deepEqual(await store.importImages(id, [image()]), [source])
  assert.deepEqual((await store.readImage(id, source)).bytes, png)
  assert.equal((await readdir(join(profile, '_frowd-assets'))).length, 1)
  await store.update(id, `![截图](${source})`, 1)
  const restored = new DocumentStore(profile)
  try {
    await restored.restore()
    assert.deepEqual((await restored.readImage(id, source)).bytes, png)
    await restored.remove(id)
    const snapshot = await restored.undoRemove()
    const recovered = snapshot.documents[0]
    assert.notEqual(recovered.id, id)
    assert.equal((await restored.read(recovered.id)).markdown, `![截图](${source})`)
    assert.deepEqual((await restored.readImage(recovered.id, source)).bytes, png)
  } finally { await restored.dispose() }
})

test('保存与跨目录另存复制附件，正文与原文件保持稳定', async t => {
  const { directory, store, id } = await fixture(t)
  const [source] = await store.importImages(id, [image()])
  const markdown = `# 图片\n\n![截图](${source})\n`
  await store.update(id, markdown, 1)
  const first = join(directory, 'first'), second = join(directory, 'second')
  await mkdir(first); await mkdir(second)
  const firstNote = join(first, 'note.md'), secondNote = join(second, 'copy.md')
  assert.equal((await store.save(id, firstNote)).saved, true)
  assert.deepEqual(await readFile(join(first, source)), png)
  assert.equal((await store.read(id)).markdown, markdown)
  assert.equal((await store.save(id, secondNote)).saved, true)
  assert.deepEqual(await readFile(join(second, source)), png)
  assert.equal(await readFile(firstNote, 'utf8'), markdown)
  assert.equal(await readFile(secondNote, 'utf8'), markdown)
  assert.equal(store.get(id).revision, 1)
})

test('另存已有相对图片，支持引用式、HTML、空格，忽略代码及远端图片', async t => {
  const { directory, store } = await fixture(t)
  const first = join(directory, 'original'), second = join(directory, 'copy')
  await mkdir(join(first, 'images'), { recursive: true }); await mkdir(second)
  await writeFile(join(first, 'images', 'a b.png'), png)
  await writeFile(join(first, 'images', 'a&b.png'), png)
  const markdown = '![引用][picture]\n\n[picture]: <images/a b.png>\n\n<img alt="x > y" src="images/a&amp;b.png">\n\n`![代码](missing.png)`\n\n```md\n![代码](missing2.png)\n```\n\n![远端](https://example.com/image.png)\n'
  const path = join(first, 'note.md'); await writeFile(path, markdown)
  const doc = (await store.openFile(path)).documents.at(-1)
  await store.save(doc.id, join(second, 'copy.md'))
  assert.deepEqual(await readFile(join(second, 'images', 'a b.png')), png)
  assert.deepEqual(await readFile(join(second, 'images', 'a&b.png')), png)
  assert.equal(await readFile(join(second, 'copy.md'), 'utf8'), markdown)
  assert.deepEqual((await store.readImage(doc.id, 'images/a%20b.png')).bytes, png)
  assert.deepEqual(imageSources('<!-- <img src="hidden.png"> -->\n\n<script><img src="script.png"></script>\n'), [])
})

test('附件重名内容不同时拒绝覆盖，保留原笔记身份及目标正文', async t => {
  const { directory, store } = await fixture(t)
  const first = join(directory, 'original'), second = join(directory, 'copy')
  await mkdir(first); await mkdir(second)
  await writeFile(join(first, 'image.png'), png)
  const existing = Buffer.concat([png, Buffer.from('different')])
  await writeFile(join(second, 'image.png'), existing)
  const original = join(first, 'note.md'), target = join(second, 'copy.md')
  await writeFile(original, '![image](image.png)'); await writeFile(target, '保留目标正文')
  const doc = (await store.openFile(original)).documents.at(-1)
  await assert.rejects(store.save(doc.id, target), /同名且内容不同/)
  assert.equal(store.get(doc.id).path, doc.path)
  assert.equal(await readFile(target, 'utf8'), '保留目标正文')
  assert.deepEqual(await readFile(join(second, 'image.png')), existing)
})

test('附件已复制而正文写入失败时保留草稿并可重试', async t => {
  const { directory, store, id } = await fixture(t)
  const [source] = await store.importImages(id, [image()])
  const markdown = `![image](${source})`
  await store.update(id, markdown, 1)
  const target = join(directory, 'blocked.md'); await mkdir(target)
  await assert.rejects(store.save(id, target))
  assert.equal(store.get(id).path, null)
  assert.equal((await store.read(id)).markdown, markdown)
  assert.deepEqual(await readFile(join(directory, source)), png)
  assert.equal((await store.save(id, join(directory, 'retry.md'))).saved, true)
})

test('图片入口拒绝伪类型、超限、未知页面和路径逃逸', async t => {
  const { directory, store, id } = await fixture(t)
  await assert.rejects(store.importImages(id, [{ bytes: png, mime: 'image/jpeg' }]), /类型不一致/)
  await assert.rejects(store.importImages(id, [{ bytes: Buffer.from('not an image'), mime: 'image/png' }]), /仅支持/)
  await assert.rejects(store.importImages(id, [{ bytes: new Uint8Array(10 * 1024 * 1024 + 1), mime: 'image/png' }]), /10 MB/)
  await assert.rejects(store.importImages(id, []), /1–20/)
  await assert.rejects(store.importImages('missing', [image()]), /已经关闭/)
  await assert.rejects(store.readImage(id, '../outside.png'), /路径无效/)
  await assert.rejects(store.readImage(id, 'file:///outside.png'), /路径无效/)
  const [source] = await store.importImages(id, [image()])
  await assert.rejects(store.readImage(id, `_frowd-assets/../../${source}`), /路径无效/)
  // A hand-authored relative link in an unsaved document remains saveable.
  await store.update(id, '![稍后补图](future.png)', 1)
  assert.equal((await store.save(id, join(directory, 'handwritten.md'))).saved, true)
})

test('图片读取和另存拒绝跳出文档根目录的目录联接', async t => {
  const { directory, store } = await fixture(t)
  const original = join(directory, 'original'), outside = join(directory, 'outside'), target = join(directory, 'target')
  await mkdir(original); await mkdir(outside); await mkdir(target)
  await writeFile(join(outside, 'image.png'), png)
  await symlink(outside, join(original, 'images'), 'junction')
  const path = join(original, 'note.md'); await writeFile(path, '![image](images/image.png)')
  const doc = (await store.openFile(path)).documents.at(-1)
  await assert.rejects(store.readImage(doc.id, 'images/image.png'), /文档目录内/)
  await assert.rejects(store.save(doc.id, join(target, 'copy.md')), /文档目录内/)

  const safe = join(directory, 'safe'); await mkdir(join(safe, 'images'), { recursive: true })
  await writeFile(join(safe, 'images', 'image.png'), png)
  const safeNote = join(safe, 'note.md'); await writeFile(safeNote, '![image](images/image.png)')
  const safeDoc = (await store.openFile(safeNote)).documents.at(-1)
  await symlink(outside, join(target, 'images'), 'junction')
  await assert.rejects(store.save(safeDoc.id, join(target, 'copy.md')), /保存目录之外/)
  assert.deepEqual(await readFile(join(outside, 'image.png')), png)
})

test('无硬链接支持时独占复制附件，重复可复用且同名异内容仍拒绝', async t => {
  const { directory, profile, store, id } = await fixture(t)
  const link = t.mock.method(fsPromises, 'link', async () => { throw Object.assign(new Error('Unsupported filesystem'), { code: 'ENOTSUP' }) })
  syncBuiltinESMExports()
  t.after(() => { link.mock.restore(); syncBuiltinESMExports() })
  const [source] = await store.importImages(id, [image()])
  assert.deepEqual(await store.importImages(id, [image()]), [source])
  await store.update(id, `![截图](${source})`, 1)
  assert.equal((await store.save(id, join(directory, 'note.md'))).saved, true)
  assert.deepEqual(await readFile(join(directory, source)), png)
  const changed = Buffer.concat([png, Buffer.from('different')])
  await writeFile(join(profile, source), changed)
  await assert.rejects(store.importImages(id, [image()]), /同名且内容不同/)
  assert.deepEqual(await readFile(join(profile, source)), changed)
})
