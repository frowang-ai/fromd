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
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import { Fragment, Slice } from '@milkdown/kit/prose/model'
import { closeHistory } from '@milkdown/kit/prose/history'
import { captureEmbeddedViews, restoreEmbeddedViews, focusEmbeddedView } from './writingViewState.js'
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
import { describeWritingDocument, installWritingClipboard, snapshotPasteEvent } from './writingClipboard.js'
import { logWritingEvent } from './writingDiagnostics.js'
import { installWritingLinks } from './writingLinks.js'
import { configureWritingTables } from './writingTableSelection.js'
import {sliceResources,markdownResources,markdownPasteResources} from './writingResourcePaste.js'
import { markdownRange } from './writingMarkdownLocation.js'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/classic.css'
import 'katex/dist/katex.min.css'
import './writingLists.css'
import './writingTextStyles.css'

const props = defineProps({ modelValue: { type: String, default: '' }, resolveImage: { type: Function, default: null }, linkNavigation: Boolean, resourceImport: Boolean })
const emit = defineEmits(['update:modelValue', 'ready', 'session-change', 'open-link', 'view-change', 'resource-files', 'resource-paste'])
const root = ref(null), loading = ref(true), error = ref('')
const editorId = crypto.randomUUID()
let clipboard, editor, initialDoc, initialSerialized, original = props.modelValue, disposed = false, created = false
let activeSession = null, sessionResolver = null, allPlugins, switching = false, updateTimer, rememberedViews = null, restoredViews = []
let resolveReady, disposeLinks
const initialized = new Promise(resolve => { resolveReady = resolve })
const view = () => editor?.editor.action(ctx => ctx.get(core.editorViewCtx))
function serializePreservingOriginal(doc, baseline = initialDoc, normalized = initialSerialized, raw = original) {
  if (doc.eq(baseline)) return raw
  const text = editor.editor.ctx.get(core.serializerCtx)(doc)
  // Derived heading/list attributes can change without a Markdown edit.
  return text === normalized ? raw : text
}
function getMarkdown() { return created ? serializePreservingOriginal(view().state.doc) : original }
function replaceMarkdown(markdown) {
  if (!editor) return
  view().dispatch(closeHistory(view().state.tr))
  editor.editor.action(utils.replaceAll(markdown))
  original = markdown; initialDoc = view().state.doc; initialSerialized = editor.getMarkdown(); clearTimeout(updateTimer); rememberedViews = null
  emit('update:modelValue', markdown)
}
async function settleComposition() {
  if (!created) return
  for (let frame = 0; view().composing && frame < 120; frame++) await new Promise(resolve => requestAnimationFrame(resolve))
  if (view().composing) throw new Error('请先完成输入法组合输入。')
}
async function whenReady() { if (!await initialized) throw new Error(error.value || '编辑器已关闭。') }
function rememberView() { if (created && activeSession) rememberedViews = captureEmbeddedViews(view()) }
function captureSession() {
  if (!created || !activeSession) return null
  const v = view(), embedded = rememberedViews ?? captureEmbeddedViews(v)
  return { original, initialDoc, initialSerialized, state: v.state.reconfigure({ plugins: allPlugins.filter(plugin => plugin.key === 'history$') }), embedded }
}
function selection() { const s = view()?.state.selection; return s ? { anchor: s.anchor, head: s.head } : undefined }
function setState(state) { editor.editor.ctx.set(core.editorStateCtx, state); view().updateState(state) }
function activateSession({ id, generation, snapshot, markdown = '', viewState, resolveImage }) {
  if (!created || disposed) throw new Error('编辑器尚未就绪。')
  if (view().composing) throw new Error('请先完成输入法组合输入。')
  switching = true; clearTimeout(updateTimer); activeSession = null; rememberedViews = null
  try {
    sessionResolver = resolveImage
    // Even identical documents must release node views (relative images, formula
    // UI and nested CM). The schema/context stays alive for every history step.
    setState(EditorState.create({ schema: view().state.schema, plugins: allPlugins }))
    original = snapshot?.original ?? markdown
    let state = snapshot ? snapshot.state.reconfigure({ plugins: allPlugins }) : EditorState.create({
      schema: view().state.schema, doc: editor.editor.ctx.get(core.parserCtx)(markdown), plugins: allPlugins,
    })
    initialDoc = snapshot?.initialDoc ?? state.doc
    initialSerialized = snapshot?.initialSerialized ?? editor.editor.ctx.get(core.serializerCtx)(initialDoc)
    if (!snapshot && viewState?.selection) {
      const { anchor, head } = viewState.selection, limit = state.doc.content.size
      state = state.apply(state.tr.setSelection(TextSelection.between(state.doc.resolve(Math.min(anchor, limit)), state.doc.resolve(Math.min(head, limit)))))
    }
    setState(state); activeSession = { id, generation }; restoredViews = snapshot?.embedded || []
  } finally { switching = false }
}
function restoreSessionView() {
  if (!created || !activeSession) return
  switching = true
  try { restoreEmbeddedViews(view(), restoredViews) }
  finally { switching = false }
}
function focusSessionView() {
  if (!created || !activeSession) return
  focusEmbeddedView(view(), restoredViews); restoredViews = []
}
function clearSession() {
  if (!created) return
  switching = true; clearTimeout(updateTimer); activeSession = null; rememberedViews = null; restoredViews = []; sessionResolver = null
  try { setState(EditorState.create({ schema: view().state.schema, plugins: allPlugins })); original = ''; initialDoc = view().state.doc; initialSerialized = editor.getMarkdown() }
  finally { switching = false }
}
function setEditable(value) { editor?.setReadonly(!value) }
function revealMarkdown(offset, needle = '') {
  if (!created || !activeSession) return false
  const v = view(), markdown = getMarkdown()
  const range = markdownRange(v.state.doc, editor.editor.ctx.get(core.remarkCtx).parse(markdown), markdown, offset, needle)
  if (!range) return false
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, range.from, range.to)).scrollIntoView())
  const dom = v.domAtPos(range.from).node
  const element = dom.nodeType === Node.ELEMENT_NODE ? dom : dom.parentElement
  element?.scrollIntoView({ block: 'start' })
  return range.exact
}
// Host registers immutable references first. One transaction preserves history.
function insertResources(items) {
  if (!created || !activeSession || view().composing) throw Error('资源插入时编辑会话不可用。')
  const v = view(), {schema} = v.state, nodes = []
  for (const item of items) {
    if (!/^\.frowd-assets\/[a-f0-9]{64}\.[a-z0-9]{1,8}$/.test(item.reference)) throw Error('资源引用无效。')
    if (nodes.length) nodes.push(schema.text(' '))
    if (item.image) nodes.push(schema.nodes.image.create({src:item.reference,alt:item.name,title:''}))
    else nodes.push(schema.text(item.name || '附件', [schema.marks.link.create({href:item.reference,title:null})]))
  }
  if (!nodes.length) return
  v.dispatch(closeHistory(v.state.tr))
  const plan=clipboard.prepare(v,{clipboardData:null},new Slice(Fragment.fromArray(nodes),0,0),{authorized:true})
  clipboard.commit(v,plan,{authorized:true})
  v.dispatch(closeHistory(v.state.tr))
}
function resourceMarkdownReferences(markdown,range,before) {
  const remark=editor.editor.ctx.get(core.remarkCtx),tree=remark.parse(markdown)
  return before===undefined?markdownResources(tree,range):markdownPasteResources(remark.parse(before),tree,range)
}
function prepareResourcePaste(payload) {
  if (!created || !activeSession) throw Error('编辑会话不可用。')
  if (payload.error) throw Error(payload.error)
  const v=view(),plan=payload.preparedState===v.state?{...payload.plan,event:payload.event}:clipboard.prepare(v,payload.event,payload.slice,{authorized:true})
  return {state:v.state,plan,references:plan.literal?[]:sliceResources(plan.slice)}
}
function commitResourcePaste(prepared) {
  const v=view()
  if(v.state!==prepared.state)throw Error('正文或选区已变化，请重新粘贴。')
  v.dispatch(closeHistory(v.state.tr))
  if(prepared.plan.literal)v.dispatch(v.state.tr.insertText(prepared.plan.event.clipboardData.getData('text/plain')).scrollIntoView())
  else clipboard.commit(v,prepared.plan,{authorized:true})
  v.dispatch(closeHistory(v.state.tr))
}
function focus() { if (created) view().focus() }
defineExpose({ resourceMarkdownReferences, prepareResourcePaste, commitResourcePaste, insertResources, setEditable, revealMarkdown, focus, getMarkdown, replaceMarkdown, whenReady, captureSession, activateSession, clearSession, rememberView, selection, settleComposition, restoreSessionView, focusSessionView })
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
    await configureWritingTables(editor.editor)
    if (disposed) return
    editor.editor.use(writingMathPlugins).use(noteScriptPlugins(utils)).use(writingHtmlFormattingPlugins(utils)).use(writingListLabels(utils))
    editor.editor.use(imageSchema.extendSchema(previous => ctx => {
      const schema = previous(ctx)
      return { ...schema, parseDOM: schema.parseDOM.map(rule => rule.tag === 'img[src]' ? {
        ...rule, tag: 'img', getAttrs(dom) { return { ...rule.getAttrs(dom), src: dom.getAttribute('data-editor-image-src') ?? dom.getAttribute('src') ?? '' } },
      } : rule), toDOM(node) {
        const dom = schema.toDOM(node), attrs = { ...dom[1], 'data-editor-image-src': node.attrs.src }
        const originalSrc = attrs.src
        const resolver = sessionResolver || props.resolveImage
        const safeSrc = resolver ? resolver(originalSrc) : (isAllowedResourceUrl(originalSrc) ? originalSrc : null)
        if (safeSrc) { attrs.src = safeSrc; if (props.resourceImport) attrs.crossorigin = 'anonymous' }
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
    editor.on(listener => listener.markdownUpdated(() => { if (initialDoc && !disposed && !activeSession && !switching) emit('update:modelValue', getMarkdown()) }))
    await editor.create()
    if (disposed) { await editor.destroy(); return }
    created = true; initialDoc = view().state.doc; initialSerialized = editor.getMarkdown(); allPlugins = view().state.plugins
    const v = view()
    v.setProps({ dispatchTransaction(transaction) {
      const owner = activeSession, next = v.state.apply(transaction)
      v.updateState(next)
      if (owner && !switching && (transaction.selectionSet || transaction.docChanged)) emit('view-change', { ...owner })
      if (!owner || switching || !transaction.docChanged) return
      rememberedViews = null
      const doc = next.doc, baseline = initialDoc, normalized = initialSerialized, raw = original
      clearTimeout(updateTimer)
      updateTimer = setTimeout(() => {
        if (disposed || activeSession !== owner || switching) return
        emit('session-change', { ...owner, markdown: serializePreservingOriginal(doc, baseline, normalized, raw) })
      }, 150)
    } })
    if (props.linkNavigation) disposeLinks = installWritingLinks(v, { root: root.value, ctx: editor.editor.ctx, getOwner: () => activeSession, onOpen: value => emit('open-link', value) })
    v.dom.addEventListener('pointerdown', () => { rememberedViews = null })
    installWritingMathViews(view())
    installWritingListViews(view())
    installWritingListKeys(view())
    clipboard=installWritingClipboard(view(), {
      deferPaste:props.resourceImport?(editorView,event,plan)=>{
        if(!activeSession||!editorView.editable||switching||plan.literal)return false
        let references,error
        try{references=sliceResources(plan.slice)}catch(cause){error=cause.message}
        if(!error&&!references.length)return false
        event.preventDefault()
        emit('resource-paste',{...activeSession,payload:{mode:'rendered',slice:plan.inputSlice,preparedState:editorView.state,plan,event:snapshotPasteEvent(event),error}})
        return true
      }:undefined,
      parsePlain:props.resourceImport,
      editorId,
      parse: markdown => editor.editor.action(ctx => ctx.get(core.parserCtx)(markdown)),
      normalize: markdown => editor.editor.action(ctx => normalizeWritingMarkdown(markdown, text => ctx.get(core.remarkCtx).parse(text))),
    })
    if (props.resourceImport) {
      const handlers = v.props.handleDOMEvents || {}
      v.setProps({handleDOMEvents:{...handlers,paste(editorView,event) {
        const files = Array.from(event.clipboardData?.files || [])
        if (!files.length) return handlers.paste?.(editorView,event) || false
        event.preventDefault()
        if (activeSession && editorView.editable && !switching) emit('resource-files',{...activeSession,files})
        return true
      }}})
    }
    logWritingEvent('editor-ready', { editorId, ...describeWritingDocument(view().state.doc) })
    view().dom.setAttribute('role', 'textbox')
    view().dom.setAttribute('aria-label', 'Markdown 正文')
    view().dom.setAttribute('aria-multiline', 'true')
    emit('ready', true); resolveReady(true)
  } catch (cause) {
    logWritingEvent('editor-error', { editorId, errorType: cause instanceof TypeError ? 'TypeError' : 'Error' })
    error.value = `编辑器加载失败：${cause.message}`; resolveReady(false)
  }
  finally { loading.value = false }
})
onBeforeUnmount(() => { disposed = true; disposeLinks?.(); clearTimeout(updateTimer); resolveReady(false); if (created) editor?.destroy().catch(() => {}) })
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
.writing-editor .writing-link-open { border: 0; border-left: 1px solid #e1e5e1; border-radius: 0; background: transparent; color: #3c7161; font: inherit; white-space: nowrap; padding: 3px 8px; cursor: pointer; }
.writing-editor .writing-link-open:hover { background: #eef2ed; }
.writing-editor .writing-link-open:focus-visible { outline: 2px solid #59927e; outline-offset: 1px; }
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
