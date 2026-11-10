<template>
  <div class="writing-editor">
    <p v-if="loading" role="status">正在准备编辑器…</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <div ref="root" />
  </div>
</template>
<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { Crepe } from '@milkdown/crepe'
import * as core from '@milkdown/kit/core'
import { createTimer } from '@milkdown/kit/ctx'
import { InputRule } from '@milkdown/kit/prose/inputrules'
import { TextSelection } from '@milkdown/kit/prose/state'
import { imageSchema, syncListOrderPlugin } from '@milkdown/kit/preset/commonmark'
import * as utils from '@milkdown/kit/utils'
import { noteScriptPlugins } from './compatibility/noteScriptMarks.js'
import { writingHtmlFormattingPlugins, preservePastedComments } from './writingHtmlFormatting.js'
import { serializeNoteNestedMath, replaceNoteMathInputRules } from './compatibility/noteEditorCompatibility.js'
import { normalizeWritingPastedMath } from './writingMathCompatibility.js'
import { normalizeWritingMarkdown } from './writingMarkdownCompatibility.js'
import { isAllowedResourceUrl } from './markdown/sanitize.js'
import { installWritingMathViews, writingMathPlugins } from './writingMath.js'
import { installWritingListKeys, writingListLabels } from './writingListKeys.js'
import { installWritingListViews } from './writingListView.js'
import { describeWritingDocument, installWritingClipboard } from './writingClipboard.js'
import { logWritingEvent } from './writingDiagnostics.js'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/classic.css'
import 'katex/dist/katex.min.css'
import './writingLists.css'
import './writingTextStyles.css'

const props = defineProps({ modelValue: { type: String, default: '' }, resolveImage: { type: Function, default: null } })
const emit = defineEmits(['update:modelValue', 'ready'])
const root = ref(null), loading = ref(true), error = ref('')
const editorId = crypto.randomUUID()
let editor, initialDoc, original = props.modelValue, disposed = false
const view = () => editor?.editor.action(ctx => ctx.get(core.editorViewCtx))
function getMarkdown() { return !initialDoc || view().state.doc.eq(initialDoc) ? original : editor.getMarkdown() }
function replaceMarkdown(markdown) {
  if (!editor) return
  editor.editor.action(utils.replaceAll(markdown))
  original = markdown; initialDoc = view().state.doc
  emit('update:modelValue', markdown)
}
defineExpose({ getMarkdown, replaceMarkdown })
onMounted(async () => {
  try {
    editor = new Crepe({
      root: root.value, defaultValue: original,
      features: {
        [Crepe.Feature.BlockEdit]: false, [Crepe.Feature.Toolbar]: false,
        [Crepe.Feature.TopBar]: false, [Crepe.Feature.AI]: false,
        [Crepe.Feature.ImageBlock]: false, [Crepe.Feature.Latex]: false,
        [Crepe.Feature.ListItem]: false,
      },
      featureConfigs: {
        [Crepe.Feature.Placeholder]: { text: '从这里开始写…', mode: 'doc' },
        [Crepe.Feature.CodeMirror]: { copyText: '复制', searchPlaceholder: '代码语言', noResultText: '无匹配语言' },
      },
    })
    // Replace the generic-transaction-only synchronizer; input rules carry
    // metadata and must still receive correct labels before the DOM renders.
    await editor.editor.remove(syncListOrderPlugin)
    if (disposed) return
    editor.editor.use(writingMathPlugins).use(noteScriptPlugins(utils)).use(writingHtmlFormattingPlugins(utils)).use(writingListLabels(utils))
    editor.editor.use(imageSchema.extendSchema(previous => ctx => {
      const schema = previous(ctx)
      return { ...schema, parseDOM: schema.parseDOM.map(rule => rule.tag === 'img[src]' ? {
        ...rule, tag: 'img', getAttrs(dom) { return { ...rule.getAttrs(dom), src: dom.getAttribute('data-editor-image-src') ?? dom.getAttribute('src') ?? '' } },
      } : rule), toDOM(node) {
        const dom = schema.toDOM(node), attrs = { ...dom[1], 'data-editor-image-src': node.attrs.src }
        const originalSrc = attrs.src
        const safeSrc = props.resolveImage ? props.resolveImage(originalSrc) : (isAllowedResourceUrl(originalSrc) ? originalSrc : null)
        if (safeSrc) attrs.src = safeSrc
        else { delete attrs.src; attrs.alt = `${attrs.alt || ''} [图片暂不可用]` }
        return [dom[0], attrs]
      } }
    }))
    editor.editor.use(ctx => {
      const ready = createTimer('WritingMathReady')
      ctx.record(ready); ctx.update(core.editorStateTimerCtx, timers => [...timers, ready])
      return async () => {
        await Promise.all([ctx.wait(core.ParserReady), ctx.wait(core.SerializerReady)])
        const parser = ctx.get(core.parserCtx), remark = ctx.get(core.remarkCtx), serializer = ctx.get(core.serializerCtx)
        ctx.set(core.parserCtx, markdown => {
          const normalized = normalizeWritingMarkdown(markdown, text => remark.parse(text))
          const doc = parser(normalized)
          logWritingEvent('markdown-parsed', { editorId, textLength: markdown.length, normalized: normalized !== markdown, ...(doc ? describeWritingDocument(doc) : {}) })
          return doc
        })
        ctx.set(core.serializerCtx, doc => serializeNoteNestedMath(serializer(doc), remark))
        // Reuse the website's tested dollar-delimiter rules; this demo owns the
        // math UI and intentionally does not load Crepe's tooltip feature.
        const seed = new InputRule(/(?:\$)([^$]+)(?:\$)$/, () => null)
        ctx.update(core.inputRulesCtx, rules => [...rules, ...replaceNoteMathInputRules([seed], { InputRule, TextSelection }, ctx.get(core.schemaCtx))])
        ctx.update(core.editorViewOptionsCtx, options => ({ ...options,
          transformPastedHTML: (html, editorView) => normalizeWritingPastedMath(preservePastedComments(options.transformPastedHTML?.(html, editorView) ?? html, document), remark, document,
            counts => logWritingEvent('paste-html-recovered', { editorId, reason: 'explicit-html-math', ...counts })),
        }))
        ctx.done(ready)
        return () => ctx.clearTimer(ready)
      }
    })
    editor.on(listener => listener.markdownUpdated(() => { if (initialDoc && !disposed) emit('update:modelValue', getMarkdown()) }))
    await editor.create()
    if (disposed) { await editor.destroy(); return }
    initialDoc = view().state.doc
    installWritingMathViews(view())
    installWritingListViews(view())
    installWritingListKeys(view())
    installWritingClipboard(view(), {
      editorId,
      parse: markdown => editor.editor.action(ctx => ctx.get(core.parserCtx)(markdown)),
      normalize: markdown => editor.editor.action(ctx => normalizeWritingMarkdown(markdown, text => ctx.get(core.remarkCtx).parse(text))),
    })
    logWritingEvent('editor-ready', { editorId, ...describeWritingDocument(view().state.doc) })
    view().dom.setAttribute('role', 'textbox')
    view().dom.setAttribute('aria-label', 'Markdown 正文')
    view().dom.setAttribute('aria-multiline', 'true')
    emit('ready', true)
  } catch (cause) {
    logWritingEvent('editor-error', { editorId, errorType: cause instanceof TypeError ? 'TypeError' : 'Error' })
    error.value = `编辑器加载失败：${cause.message}`
  }
  finally { loading.value = false }
})
onBeforeUnmount(() => { disposed = true; if (initialDoc) editor?.destroy().catch(() => {}) })
</script>
<style>
.writing-editor .milkdown {
  --crepe-color-background: #fffefa; --crepe-color-surface: #fffefa;
  --crepe-color-on-background: #333b38; --crepe-color-on-surface: #333b38;
  --crepe-color-primary: #3c7161; --crepe-color-secondary: #e4eee8;
  --crepe-color-hover: #eef2ed; --crepe-color-selected: #dceae1;
  --crepe-font-default: 'Microsoft YaHei', 'PingFang SC', sans-serif;
  --crepe-font-title: 'Microsoft YaHei', 'PingFang SC', sans-serif;
}
.writing-editor .milkdown > .ProseMirror { padding: 0; min-height: 65vh; font-size: 16px; line-height: 1.9; outline: none; overflow-wrap: anywhere; }
.writing-editor .milkdown > .ProseMirror h1 { font-size: 2em; font-weight: 650; letter-spacing: -.03em; line-height: 1.4; margin: 0 0 1em; }
.writing-editor .milkdown > .ProseMirror h2 { font-size: 1.4em; font-weight: 600; margin: 1.8em 0 .6em; }
.writing-editor .milkdown > .ProseMirror h3 { font-size: 1.15em; }
.writing-editor .milkdown > .ProseMirror p { margin: .8em 0; }
.writing-editor .milkdown-table-block { overflow-x: auto; max-width: 100%; }
.writing-editor img { max-width: 100%; }
.writing-editor .writing-math { cursor: text; }
.writing-editor .writing-math-preview { border-radius: 3px; }
.writing-editor .writing-math-preview:hover { background: #edf3ed; }
.writing-editor .writing-math-preview:focus-visible { outline: 2px solid #59927e; }
.writing-editor .writing-math-inline { display: inline; }
.writing-editor .writing-math-block { margin: 1.3em 0; padding: 0; border: 1px solid transparent; border-radius: 6px; }
.writing-editor .writing-math-block.is-editing { border-color: #d8e0e6; }
.writing-editor .writing-math-block > .writing-math-preview { padding: 12px; overflow-x: auto; }
.writing-editor .writing-math-block > .writing-math-preview:hover { background: transparent; }
.writing-editor .writing-block-source { background: #f4f6f8; border-bottom: 1px solid #d8e0e6; }
.writing-editor .writing-block-source[hidden] { display: none; }
.writing-editor .writing-block-header { display: flex; justify-content: space-between; align-items: center; padding: 4px 12px 0; }
.writing-editor .writing-block-fence { color: #8b94a2; font: 14px/1.6 Consolas, monospace; }
.writing-editor .writing-block-fence.is-ending { display: block; padding: 0 12px 6px; }
.writing-editor .writing-block-done { padding: 2px 6px; font-size: 12px; color: #64717d; }
.writing-editor .writing-block-done:focus-visible { outline: 2px solid #376ba8; }
.writing-editor .writing-math-source { font: 14px/1.65 Consolas, monospace; color: #275b4a; border: 1px solid #aac3b5; border-radius: 4px; background: #f3f8f0; padding: 3px 6px; max-width: 100%; outline-color: #59927e; box-sizing: border-box; }
.writing-editor .writing-math .writing-math-source[hidden], .writing-editor .writing-math-preview[hidden], .writing-editor .writing-math-source-wrap[hidden] { display: none; }
.writing-editor .writing-math-source-wrap { display: inline-flex; align-items: baseline; vertical-align: baseline; max-width: 100%; line-height: inherit; }
.writing-editor .writing-math-delimiter { color: #b3b3b0; user-select: none; font: inherit; }
.writing-editor .writing-math-inline .writing-math-source {
  font: inherit; font-size: 1em; line-height: 1.5; color: #8b37a0; caret-color: #8b37a0;
  border: 0; border-radius: 0; background: transparent; padding: 0; margin: 0; outline: none;
  min-width: 8px; width: 1ch; max-width: 100%; height: 24px; box-shadow: none; vertical-align: baseline;
  resize: none; overflow-x: hidden; overflow-y: auto; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-all;
}
.writing-math-live-preview {
  position: fixed; z-index: 1000; padding: 8px 12px; border-radius: 5px; box-sizing: border-box;
  background: #252724; color: #fffef8; box-shadow: 0 3px 10px #0002;
  font-size: 18px; line-height: 1.5; overflow: auto; overscroll-behavior: contain;
}
.writing-math-live-preview.is-incomplete { font: 12px/1.5 'Microsoft YaHei', sans-serif; color: #e2e1d8; }
.writing-editor .katex-display { margin: .5em 0; }
</style>
