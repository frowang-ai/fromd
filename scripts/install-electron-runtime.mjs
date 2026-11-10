// Development bootstrap when Electron's lazy downloader cannot use the host proxy.
// Fetch only the pinned official archive and verify against npm's checksums.json.
import { spawnSync } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
const root = fileURLToPath(new URL('../', import.meta.url))
const electron = resolve(root, 'node_modules/electron')
const { version } = JSON.parse(await readFile(resolve(electron, 'package.json'), 'utf8'))
const name = `electron-v${version}-win32-x64.zip`, archive = resolve(root, 'output', name)
await mkdir(resolve(root, 'output'), { recursive: true })
const checksums = JSON.parse(await readFile(resolve(electron, 'checksums.json'), 'utf8'))
let existingHash
try { existingHash = createHash('sha256').update(await readFile(archive)).digest('hex') } catch { /* First download. */ }
if (existingHash !== checksums[name]) {
  const result = spawnSync('curl.exe', ['--fail', '--location', '--silent', '--show-error', '--continue-at', '-', '--connect-timeout', '15', '--max-time', '600', '--output', archive, `https://github.com/electron/electron/releases/download/v${version}/${name}`], { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`Download failed: ${result.status}`)
}
const sha = createHash('sha256').update(await readFile(archive)).digest('hex')
if (sha !== checksums[name]) throw new Error('Electron checksum mismatch')
const { extract } = await import('@electron-internal/extract-zip')
await extract(archive, { dir: resolve(electron, 'dist') })
await writeFile(resolve(electron, 'path.txt'), 'electron.exe')
console.log(`Installed verified Electron ${version} (win32-x64)`)
