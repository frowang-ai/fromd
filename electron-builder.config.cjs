// electron-builder 26.x configuration. No source URL is inferred from the
// private repository and all supplied build commands use --publish never.
const base = require('./package.json').build
const { isAbsolute } = require('node:path')
const testProfile = process.env.FROWANG_UPDATE_TEST_PROFILE
const updateUrl = process.env.FROWANG_UPDATE_URL
const testOnly = process.env.FROWANG_UPDATE_TEST_BUILD === '1'
const publisherName = process.env.FROWANG_UPDATE_PUBLISHER
let feed
if (updateUrl) {
  feed = new URL(updateUrl)
  if (feed.username || feed.password || feed.search || feed.hash) throw new Error('Update URL must not contain credentials, query or fragment')
  if (testOnly) {
    if (feed.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(feed.hostname)) throw new Error('Test builds require an explicit loopback HTTP feed')
  } else if (feed.protocol !== 'https:' || !publisherName) throw new Error('Production updates require HTTPS and FROWANG_UPDATE_PUBLISHER; configure code signing credentials separately')
}
if (testOnly && (!feed || !testProfile || !isAbsolute(testProfile))) throw new Error('Test build requires FROWANG_UPDATE_URL and an absolute FROWANG_UPDATE_TEST_PROFILE')
module.exports = {
  ...base,
  ...(feed ? {
    publish: [{ provider: 'generic', url: feed.href, channel: 'latest' }],
    extraMetadata: { frowangUpdates: { url: feed.href, testOnly, ...(publisherName && !testOnly ? { publisherName } : {}) } },
    ...(!testOnly ? { forceCodeSigning: true, win: { ...base.win, signtoolOptions: { publisherName }, signAndEditExecutable: true, signExecutable: true, verifyUpdateCodeSignature: true } } : {}),
  } : { publish: null, extraMetadata: { frowangUpdates: null } }),
  nsis: {
    oneClick: true, perMachine: false, allowElevation: false,
    createDesktopShortcut: true, createStartMenuShortcut: true,
    deleteAppDataOnUninstall: false,
    artifactName: 'frowd-Setup-${version}-${arch}.exe',
  },
  // Test installers cannot share production identity, shortcuts, or uninstall
  // records. Test versions are overrides, never edits of the source version.
  ...(testOnly ? {
    appId: 'com.frowang.markdown.update-test', productName: 'Frowang Markdown Update Test', executableName: 'Frowang Markdown Update Test',
    files: [...base.files, { from: 'tests/fixtures', to: '.', filter: ['update-test-bootstrap.cjs'] }],
    extraMetadata: { name: 'frowang-markdown-update-test', main: 'update-test-bootstrap.cjs', productName: 'Frowang Markdown Update Test', version: process.env.FROWANG_UPDATE_TEST_VERSION || '0.2.900', frowangUpdates: { url: feed.href, testOnly: true, testProfile } },
    nsis: { oneClick: true, perMachine: false, allowElevation: false, createDesktopShortcut: false, createStartMenuShortcut: false, deleteAppDataOnUninstall: false, runAfterFinish: false, artifactName: 'Frowang-Update-Test-Setup-${version}.exe' },
    directories: { output: `release/update-test-${process.env.FROWANG_UPDATE_TEST_VERSION || '0.2.900'}` },
  } : {}),
}
