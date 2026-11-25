import {test} from 'node:test'
import assert from 'node:assert/strict'
import {unified} from 'unified'
import parse from 'remark-parse'
import stringify from 'remark-stringify'
import math from 'remark-math'
import gfm from 'remark-gfm'
import * as milkdownUtils from '@milkdown/kit/utils'
import {writingHtmlFormattingPlugins} from '../packages/editor/src/writingHtmlFormatting.js'
import {tableBreakVariants, inlineBreakBoundaries, flowBreakBoundaries} from './fixtures/writing-table-breaks.mjs'
import {serializeAlertMarkers} from '../packages/editor/src/writingAlertSerialization.js'
import {createMarkdownRenderer} from '../packages/editor/src/markdown/renderer.js'
import {normalizeBlockMath} from '../packages/editor/src/markdown/normalize/blockMath.js'
import {normalizeInlineMath} from '../packages/editor/src/markdown/normalize/inlineMath.js'
const remark=unified().use(parse).use(math).use(stringify),md=createMarkdownRenderer()
const serialize=source=>serializeAlertMarkers(remark.stringify(remark.parse(source)),value=>remark.parse(value))

function formattingProcessor() {
 let formatting
 writingHtmlFormattingPlugins({...milkdownUtils, $remark: (name, factory) => { formatting = factory(); return [] }})
 return unified().use(parse).use(gfm).use(formatting).use(stringify)
}
const formatting = formattingProcessor()
const formattedTree = source => formatting.runSync(formatting.parse(source))

test('explicit br becomes a break in phrasing content without consuming code, escapes or attributes', () => {
 for (const br of tableBreakVariants) {
  const tree = formattedTree(`| A${br}B |\n| --- |\n| **Stage 1**${br}个人记忆 |`)
  assert.equal(tree.children[0].children[0].children[0].children[1].type, 'break', br)
  assert.equal(tree.children[0].children[1].children[0].children[1].type, 'break', br)
 }
 for (const source of ['A`<br>`B', 'A\\<br>B', 'A<br class="x">B', 'A<br onclick="evil()">B', 'A</br>B', 'A<TEXT>B', '```html\n<br>\n```']) {
  assert.doesNotMatch(JSON.stringify(formattedTree(source)), /"type":"break"/, source)
 }
 assert.match(JSON.stringify(formattedTree('A<u>B<br>C</u><mark>D<br>E</mark>')), /"type":"break"/)
})

test('explicit br leaves empty placeholders to Milkdown even when this remark plugin runs alone', () => {
 for (const br of tableBreakVariants) {
  for (const parent of ['root', 'blockquote', 'listItem', 'paragraph', 'tableCell']) {
   const tree = {type: parent, children: [{type: 'html', value: br}]}
   assert.equal(formatting.runSync(tree).children[0].type, 'html', `${parent}: ${br}`)
  }
 }
})

test('explicit br has HTML trailing semantics, consecutive and leading breaks remain meaningful', () => {
 for (const [source, count] of [['a<br>', 0], ['a<br><br>', 1], ['a<br><br>b', 2], ['<br>b', 1], ['<u>a<br><br></u>', 1], ['a<br><!--hidden-->', 0], ['a<br><br><!--hidden-->', 1]]) {
  const tree = formattedTree(`| h |\n| --- |\n| ${source} |`)
  assert.equal((JSON.stringify(tree).match(/"type":"break"/g) || []).length, count, source)
 }
})

test('explicit break serialization survives table and ATX heading contexts, prose keeps backslash newline', () => {
 const br = {type: 'break'}, text = value => ({type: 'text', value})
 const cell = {type: 'tableCell', children: [text('a'), br, text('b')]}
 const table = {type: 'table', children: [{type: 'tableRow', children: [cell]}, {type: 'tableRow', children: [cell]}]}
 assert.match(formatting.stringify({type: 'root', children: [table]}), /a<br>b/)
 assert.equal(formatting.stringify({type: 'root', children: [{type: 'heading', depth: 3, children: cell.children}]}), '### a<br>b\n')
 assert.equal(formatting.stringify({type: 'root', children: [{type: 'paragraph', children: cell.children}]}), 'a\\\nb\n')
})

test('review hardbreak serializers keep inline container boundaries and adjacent HTML intact', () => {
 const text = value => ({type:'text',value}), br = {type:'break'}
 for (const type of ['strong','emphasis','delete','link','writing_u','writing_mark','writing_kbd']) {
  for (const content of [[br,text('a')],[text('a'),br],[br]]) {
   const mark = {type,children:content,...(type==='link'?{url:'https://example.com',title:null}:{})}
   const source = formatting.stringify({type:'root',children:[{type:'paragraph',children:[mark,text('z')]}]})
   assert.ok(source.includes('<br>'), `${type}: ${source}`)
   assert.doesNotMatch(source,/\\|&#xA;/,`${type}: ${source}`)
  }
 }
 for (const html of ['<!--hidden-->','<span>','<br>']) {
  const source=formatting.stringify({type:'root',children:[{type:'paragraph',children:[text('a'),br,{type:'html',value:html},text('b')]}]})
  assert.equal(source,`a<br>${html}b\n`)
 }
})

test('review break boundary fixtures cover markdown parsing in four flow contexts', () => {
 // The real PM serializer/reparser is covered by the browser matrix below.
 // This unit pass also guards the original source semantics used as its oracle.
 for (const wrap of [s=>s,s=>'> '+s,s=>'- '+s,s=>'[^n]: '+s]) {
  for (const {markdown} of [...inlineBreakBoundaries,...flowBreakBoundaries]) {
   const tree=formattedTree(wrap(markdown))
   assert.ok(JSON.stringify(tree).includes('"type":"break"'),wrap(markdown))
  }
 }
})

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
 for(const space of [' ','   ','\t','\u00a0','\u3000','\u2003','\ufeff']){
  const source=`前文 $${space}$ 后文`
  const formula=remark.parse(source).children[0].children[1]
  assert.equal(formula.type,'inlineMath');assert.equal(formula.value.trim(),'')
  const normalized=normalizeInlineMath(normalizeBlockMath(source))
  assert.equal(normalized,source)
  assert.equal(md.render(normalized),'<p>前文  后文</p>\n')
 }
 for(const source of ['`$ $`','`$\u3000$`','```text\n$ $\n```','\\$ \\$','\\$ $','\\$\u3000$','[x](http://example.com/$%20$)','[$ $](https://example.com/$%20$)']){
  const html=md.render(source)
  if(!source.startsWith('['))assert.ok(html.includes('$'))
  else assert.ok(html.includes('example.com/$%20$'))
 }
 for(const newline of ['\n','\r\n']){
  const tokens=md.parse(`前文 $${newline}$ 后文`,{}).flatMap(token=>token.children||[])
  assert.equal(tokens.filter(token=>token.type==='frowd_empty_math').length,0)
 }
})
