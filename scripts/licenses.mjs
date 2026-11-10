import { readFile, writeFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'))
const sections = ['# Third-party notices\n\nGenerated from the pinned npm lockfile. Original editor extraction: frowang-ai/web-lunwen commit 647efc6. No Typora code or assets are included.\n\nApplication code is MIT; dependencies and bundled fonts retain their own licenses. Electron also ships its own LICENSE and LICENSES.chromium.html in the application distribution.\n']
for (const [path, entry] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
  if (!path.includes('node_modules/') || entry.dev || entry.link) continue
  const folder = resolve(root, path)
  let pkg
  try { pkg = JSON.parse(await readFile(resolve(folder, 'package.json'), 'utf8')) } catch { continue }
  sections.push(`\n## ${pkg.name} ${pkg.version}\n\nLicense: ${typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license || pkg.licenses || 'See package distribution')}\n`)
  const names = await readdir(folder)
  for (const name of names.filter(name => /^(licen[cs]e|copying|notice)(\.[a-z]+)?$/i.test(name))) {
    try { sections.push(`\n### ${name}\n\n\x60\x60\x60text\n${await readFile(resolve(folder, name), 'utf8')}\n\x60\x60\x60\n`) } catch { /* optional directory */ }
  }
}
await writeFile(resolve(root, 'THIRD_PARTY_NOTICES.md'), sections.join(''))
console.log('Third-party notices written')
