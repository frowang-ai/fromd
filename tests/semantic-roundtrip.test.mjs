import {test} from 'node:test'
import assert from 'node:assert/strict'
import {unified} from 'unified'
import parse from 'remark-parse'
import stringify from 'remark-stringify'
import math from 'remark-math'
import {serializeAlertMarkers} from '../packages/editor/src/writingAlertSerialization.js'
import {createMarkdownRenderer} from '../packages/editor/src/markdown/renderer.js'
import {normalizeBlockMath} from '../packages/editor/src/markdown/normalize/blockMath.js'
import {normalizeInlineMath} from '../packages/editor/src/markdown/normalize/inlineMath.js'
const remark=unified().use(parse).use(math).use(stringify),md=createMarkdownRenderer()
const serialize=source=>serializeAlertMarkers(remark.stringify(remark.parse(source)),value=>remark.parse(value))
test('Alert canonical serialization is scoped to first plain blockquote markers',()=>{
 for(const kind of ['NOTE','TIP','IMPORTANT','WARNING','CAUTION']){
  const source=`> [!${kind}]\n> body **bold**\n\nbody`
  assert.ok(serialize(source).startsWith(`> [!${kind}]\n`))
  const legacy=`> \\[!${kind}]\n> body`
  assert.ok(serialize(legacy).startsWith(`> [!${kind}]\n`))
  assert.match(md.render(legacy),new RegExp(`data-alert="${kind}"`))
 }
 assert.match(serialize('> > [!NOTE]\n> > nested'),/> > \[!NOTE\]/)
})
test('Alert formatting, body literals, later quote paragraphs and code remain ordinary content',()=>{
 for(const source of ['> [!*NOTE*]\n> text','> **[!NOTE]**\n> text','> `[!NOTE]`\n> text','> [!NOTE]**not a break**\n> text','> intro\n>\n> [!NOTE]\n> text']){
  assert.doesNotMatch(md.render(source),/data-alert=/)
  assert.doesNotMatch(md.render(serialize(source)),/data-alert=/)
 }
 for(const source of ['\\[!NOTE]\nbody','```md\n> \\[!NOTE]\n```','> ```md\n> \\[!NOTE]\n> ```','`> \\[!NOTE]`']){
  const normalized=remark.stringify(remark.parse(source))
  assert.equal(serializeAlertMarkers(normalized,s=>remark.parse(s)),normalized)
 }
})
test('locked remark accepts whitespace inline math and print ignores it without splitting paragraphs',()=>{
 for(const space of [' ','   ','\t']){
  const source=`前文 $${space}$ 后文`
  const formula=remark.parse(source).children[0].children[1]
  assert.equal(formula.type,'inlineMath');assert.equal(formula.value.trim(),'')
  const normalized=normalizeInlineMath(normalizeBlockMath(source))
  assert.equal(normalized,source)
  assert.equal(md.render(normalized),'<p>前文  后文</p>\n')
 }
 for(const source of ['`$ $`','```text\n$ $\n```','\\$ \\$','[$ $](https://example.com/$%20$)']){
  const html=md.render(source)
  if(!source.startsWith('['))assert.ok(html.includes('$'))
  else assert.ok(html.includes('https://example.com/$%20$'))
 }
})
