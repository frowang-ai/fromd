import {resourcePacket,relativeImage} from './resources.mjs';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { preparePdfDocument } from './pdf.mjs';

// Only a loopback Vite development test can inject the in-memory IPC double.
// Release bundles tree-shake this branch. No browser document authority is used.
const testHost = import.meta.env.DEV && location.hostname === '127.0.0.1' &&
  new URLSearchParams(location.search).get('testHost') === '1' ? window.__FROWD_TEST_HOST__ : null;
const call = (command, args = {}) => testHost ? testHost.invoke(command, args) : invoke(command, args);
export const browserTestHost = Boolean(testHost);
export const captureMainViewport = () => call('capture_main_viewport');
export const documentsApi = {
  chooseImport:()=>call('choose_document_import'),
  prepareImportResources:(token,references)=>call('prepare_document_import_resources',{token,references}),
  commitImport:(token,markdown)=>call('commit_document_import',{token,markdown}),
  reuseResources:(id,references,purpose)=>call('reuse_resources',{id,references,purpose}),
  list: () => call('list_metadata'),
  importResources: async(id,files,kind)=>{
    const {metadata,payload}=await resourcePacket(files,kind);
    if(testHost)return call('import_resources',{id,metadata,payload:Array.from(payload)});
    return invoke('import_resources',payload,{headers:{'x-frowd-doc-id':encodeURIComponent(id),'x-frowd-resources':encodeURIComponent(JSON.stringify(metadata))}});
  },
  chooseResources:(id,kind)=>call('choose_resources',{id,kind}),
  search: query => call('search_documents', { query }),
  read: id => call('read_document', { id }),
  create: () => call('create_document', { markdown: '', title: '未命名笔记' }),
  update: (id, markdown, revision) => call('update_document', { id, markdown, revision }),
  rename: (id, title) => call('rename_document', { id, title }),
  view: (id, viewState) => call('set_view_state', { id, viewState }),
  activate: id => call('activate_document', { id }),
  shelve: id => call('shelve_document', { id }),
  expand: () => call('expand_all'),
  shelveOthers: id => call('shelve_others', { id }),
  shelveAll: () => call('shelve_all'),
  reorder: (ids, layoutRevision) => call('reorder_documents', { ids, layoutRevision }),
  open: () => call('open_document'),
  save: (id, saveAs = false) => call('save_document', { id, saveAs }),
  exportPdf: async snapshot => {
    const html = await preparePdfDocument(snapshot, (id, revision, references) => call('pdf_images', { id, revision, references }));
    return call('export_pdf', { id: snapshot.id, revision: snapshot.revision, html });
  },
  remove: (id, decision) => call('remove_document', { id, decision }),
  undo: () => call('undo_remove'),
  checkpoint: () => call('checkpoint'),
  closeReady: () => call('close_ready'),
  cancelClose: () => call('cancel_close'),
};
export const onHostClose = callback => testHost ? Promise.resolve(testHost.onClose(callback)) :
  listen('frowd:close-requested', callback);
export function openDocumentLink(id, href) { return call('open_document_link', { id, href }); }

export function resourceImageUrl(id,reference){
 if(!id||!relativeImage(reference))return null;
 return testHost?testHost.resourceUrl?.(id,reference)??null:convertFileSrc('image','frowd-resource')+'?id='+encodeURIComponent(id)+'&ref='+encodeURIComponent(reference);
}
