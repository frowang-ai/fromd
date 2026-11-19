import test from 'node:test'
import assert from 'node:assert/strict'
import { validateMermaid } from '../packages/editor/src/markdown/mermaid.js'

test('Mermaid accepts attribute-free br variants without changing author source', () => {
  for (const br of ['<br>', '<br/>', '<br />', '<BR>', '<Br/>', '<BR />']) {
    const source = `flowchart LR\n A[本机后端${br}随桌面程序运行] --> B[Rust CLI]`
    assert.equal(validateMermaid(source), source, br)
  }
})

test('Mermaid br compatibility preserves HTML, configuration, action and resource restrictions', () => {
  for (const syntax of [
    '<br class="line">', '<br style="color:red"/>', '<br onload="alert(1)">',
    '<br / >', '</br>', '<br><img src="https://evil.example/x">',
    '<svg><text>label</text></svg>', '<foreignObject>label</foreignObject>', '<script>alert(1)</script>',
    '&lt;br&gt;', '&#60;br&#62;',
    '%%{init: {"securityLevel":"loose"}}%%', '---\nconfig:\n  securityLevel: loose\n---',
    '\nclick A "https://evil.example/x"', 'url(https://evil.example/x)',
    '@import "https://evil.example/x"', 'image: "https://evil.example/x"',
  ]) {
    assert.throws(() => validateMermaid(`flowchart LR\n A[before<br/>${syntax}after]`), /图表不支持/, syntax)
  }
})
