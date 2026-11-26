// Shared synthetic table sample; escaped pipes remain inside inline code.
export const tableBreakVariants = ['<br>', '<br/>', '<br />', '<BR>', '<Br/>', '<BR />']
export const tableBreakMarkdown = [
  '| 阶段<br>说明 | 提交 | 内容 |',
  '| --- | --- | --- |',
  '| **Stage 1**<br>个人记忆无 JSON 层 | `feat/cli-gh-commands-stage1-20261125`<br>`9ef7e51` → `17d5bc1` | • 落地顶层 `recall / search / view`；<br>• `save` 支持 `<TEXT> \\| --body \\| --body-file <FILE\\|->`；代码 `<br>` |',
  ...tableBreakVariants.map((br, i) => `| ${i}前${br}后 | <u>下${br}划</u> | <mark>高${br}亮</mark> |`),
].join('\n')

export const inlineBreakBoundaries = [
  ['strong', s => `**${s}**`], ['emphasis', s => `*${s}*`], ['strike', s => `~~${s}~~`],
  ['link', s => `[${s}](https://example.com)`],
  ...['u','mark','kbd'].map(tag => [tag, s => `<${tag}>${s}</${tag}>`]),
].flatMap(([mark, wrap]) => [
  ['leading','<br>a',''], ['middle','a<br>b',''], ['closing','a<br>','z'],
  ['trailing','a<br><br>',''], ['only','<br>','z'],
].map(([edge, content, suffix]) => ({name:`${mark}-${edge}`,mark,markdown:wrap(content)+suffix})))
export const flowBreakBoundaries = [
  '<!--hidden-->b', '<span>html</span>b', '<u>under</u>b', '- item', '# text',
  '1. item', '> quote', '---', '===',
].map((next,index) => ({name:`next-${index}`,markdown:'a<br>'+next})).concat([
  {name:'trailing-comment',markdown:'a<br><br><!--hidden-->'},
])