import MarkdownIt from 'markdown-it'

// Faithful payload-only replica of Paseo Desktop 0.17.3's message copy button.
// Installed bundle index-d8ecc6c9cf6f392f0e564e87de8e929b.js:
// 5495 createMarkdownClipboardContent -> 5068 createAssistantMarkdownParser
// -> 5069 createMarkdownParser -> MarkdownIt, with no math plugin.
// A bounded local probe executes those extracted factories and compares these
// payloads byte-for-byte. This fixture needs neither Paseo nor the OS clipboard.
const parser = new MarkdownIt({ html: false, linkify: true })
const validateLink = parser.validateLink.bind(parser)
parser.validateLink = href => href.trim().toLowerCase().startsWith('file://') || validateLink(href)
export function createPaseoMarkdownClipboardContent(text) {
  return { plainText: text, html: '<meta charset="utf-8">' + parser.render(text) }
}
