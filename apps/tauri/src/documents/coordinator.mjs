
/** frowd document ownership and persistence. Editor buffers are not a second store. */
export class DocumentCoordinator {
  constructor(api, port, state, { autosaveMs = 220 } = {}) {
    this.api = api; this.port = port; this.state = state; this.autosaveMs = autosaveMs;
    this.buffers = new Map(); this.saves = new Map(); this.names = new Map(); this.nameSaves = new Map();
    this.sessions = new Map(); this.timers = new Map(); this.tail = Promise.resolve(); this.generation = 0; this.disposed = false;
    Object.assign(state, { documents: [], activeId: null, markdown: '', busy: false, loaded: false, error: '', saveState: '已保存', undoRemoval: null, removalSequence: 0 });
  }
  metadata(snapshot, selection = false) {
    this.state.documents = snapshot.documents.map(doc => {
      const name = this.names.get(doc.id);
      return name?.version !== name?.ack ? { ...doc, title: name.title } : doc;
    });
    if (selection) this.state.activeId = snapshot.activeId;
    this.state.undoRemoval = snapshot.undoRemoval ?? null;
    if (snapshot.warning) this.state.error = snapshot.warning;
  }
  report(error) { this.state.error = String(error?.message ?? error); this.state.saveState = '保存失败'; }
  run(action) {
    const next = this.tail.catch(() => {}).then(async () => {
      if(this.initializing) await this.initializing;
      if(!this.state.loaded) throw Error("页面仍在恢复，请稍候再试。");
      this.state.busy = true;
      let release;
      try {
        // Freeze is a real EditorPort operation, performed only after composition completes.
        release = await this.port.freeze?.();
        return await action();
      } catch (error) { this.report(error); throw error; }
      finally { release?.(); this.state.busy = false; }
    });
    this.tail = next; return next;
  }
  boot() {
    if(!this.initializing)this.initializing=this.initialize();
    return this.initializing;
  }
  async initialize() {
    await this.port.ready();
    let snapshot = await this.api.list();
    if (!snapshot.documents.length) snapshot = await this.api.create();
    this.metadata(snapshot, true); await this.loadActive(); this.state.loaded = true;
  }
  current() { return this.state.documents.find(doc => doc.id === this.state.activeId) ?? null; }
  async loadActive(preloaded = null) {
    const id = this.state.activeId;
    if (!id) { this.port.clear(); this.state.markdown = ''; return; }
    let read;
    try { read = preloaded ?? await this.api.read(id); }
    catch(error) { this.port.clear(); this.state.markdown=''; throw error; }
    this.buffers.set(id, { markdown: read.markdown, persisted: read.markdown, revision: read.revision });
    this.state.markdown = read.markdown;
    const generation = ++this.generation;
    const session=this.sessions.get(id);
    await this.port.ready();
    await this.port.activate({ ...read, generation, session: session?.markdown === read.markdown ? session : null });
  }
  capture() {
    const snapshot = this.port.capture();
    if (!snapshot || snapshot.id !== this.state.activeId || snapshot.generation !== this.generation) return;
    const buffer = this.buffers.get(snapshot.id);
    if (!buffer) return;
    buffer.markdown = snapshot.markdown; this.state.markdown = snapshot.markdown;
    this.sessions.set(snapshot.id, snapshot);
    return snapshot;
  }
  changed({ id, generation, markdown }) {
    if (id !== this.state.activeId || generation !== this.generation || !this.buffers.has(id)) return;
    this.buffers.get(id).markdown = markdown; this.state.markdown = markdown; this.state.saveState = '保存中…';
    this.schedule('body', () => this.flush());
  }
  schedule(key, work) {
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key); if (!this.disposed) work().catch(error => this.report(error));
    }, this.autosaveMs));
  }
  async flushBody(id) {
    if (this.saves.has(id)) return this.saves.get(id);
    const promise = (async () => {
      const buffer = this.buffers.get(id); if (!buffer) return;
      for (;;) {
        if (id === this.state.activeId) this.capture();
        const markdown = buffer.markdown;
        if (markdown === buffer.persisted) break;
        // Reusing the revision after a lost acknowledgement is idempotent in SQLite.
        const revision = buffer.revision + 1;
        const reply = await this.api.update(id, markdown, revision);
        buffer.persisted = markdown; buffer.revision = revision;
        const confirmed=reply.documents.find(doc=>doc.id===id);
        if(confirmed)this.state.documents=this.state.documents.map(doc=>doc.id===id?{...doc,revision,dirty:confirmed.dirty,conflict:confirmed.conflict,preview:confirmed.preview}:doc);
        if (id === this.state.activeId) this.capture();
      }
    })();
    this.saves.set(id, promise);
    try { await promise; } finally { if (this.saves.get(id) === promise) this.saves.delete(id); }
  }
  nameChanged(id, title) {
    const doc = this.state.documents.find(doc => doc.id === id);
    if (!doc || doc.path) return;
    const previous = this.names.get(id) ?? { version: 0, ack: 0, title: doc.title };
    this.names.set(id, { ...previous, title, version: previous.version + 1 });
    doc.title = title; this.state.saveState = '保存中…';
    this.schedule('name:' + id, () => this.flushName(id));
  }
  async flushName(id) {
    if (this.nameSaves.has(id)) return this.nameSaves.get(id);
    const promise = (async () => {
      for (;;) {
        const name = this.names.get(id);
        if (!name || name.version === name.ack) return;
        const version = name.version;
        const reply = await this.api.rename(id, name.title);
        if (!this.state.documents.some(doc => doc.id === id)) return;
        const latest = this.names.get(id);
        if (latest.version === version) latest.ack = version;
        const confirmed=reply.documents.find(doc=>doc.id===id);
        if(confirmed&&latest.version===version)this.state.documents=this.state.documents.map(doc=>doc.id===id?{...doc,title:confirmed.title}:doc);
        // Never adopt unrelated documents, layout or selection from a rename acknowledgement.
        if (latest.version === version) return;
      }
    })();
    this.nameSaves.set(id, promise);
    try { await promise; } finally { if (this.nameSaves.get(id) === promise) this.nameSaves.delete(id); }
  }
  async flush() {
    if (this.flushing) return this.flushing;
    const work = (async () => {
      for (;;) {
        await this.port.waitComposition();
        const before = this.capture();
        const id = this.state.activeId;
        if (id) await this.flushBody(id);
        await Promise.all([...this.names.keys()].map(id => this.flushName(id)));
        const snapshot = this.capture();
        if (snapshot?.viewState && this.api.view) await this.api.view(snapshot.id, snapshot.viewState);
        // Name/view acknowledgements may take time while autosave leaves editing enabled.
        await this.port.waitComposition();
        const latest = this.capture();
        const buffer = this.buffers.get(id);
        const namesPending = [...this.names.values()].some(name => name.version !== name.ack);
        const sameView = JSON.stringify(snapshot?.viewState) === JSON.stringify(latest?.viewState);
        if (id === this.state.activeId && (!buffer || buffer.markdown === buffer.persisted) && !namesPending && sameView) break;
        if (!id && !before && !namesPending) break;
      }
      this.state.saveState = '已保存';
    })();
    this.flushing=work;
    try { await work; } finally { if(this.flushing===work)this.flushing=null; }
  }
  activate(id) {
    return this.run(async () => {
      if (!this.state.documents.some(doc => doc.id === id)) throw Error('页面已移除。');
      await this.flush();
      // Reading can fail without changing activeId or expanding a shelved target.
      const read=await this.api.read(id);
      const snapshot=await this.api.activate(id);
      this.metadata(snapshot, true);
      await this.loadActive(read);
    });
  }
  create() {
    return this.run(async () => {
      await this.flush(); this.metadata(await this.api.create(), true); await this.loadActive();
    });
  }
  layout(action, id) {
    return this.run(async () => {
      await this.flush();
      const previousId = this.state.activeId;
      this.metadata(await this.api[action](id), true);
      // Preserve the live editor/history/selection for unrelated layout changes.
      if (previousId !== this.state.activeId) await this.loadActive();
    });
  }
  save(id = this.state.activeId, saveAs = false) {
    return this.run(async () => {
      await this.flush();
      const result = await this.api.save(id, saveAs);
      if (result.snapshot) this.metadata(result.snapshot);
      return result;
    });
  }
  open() {
    return this.run(async () => {
      await this.flush(); const result = await this.api.open();
      if (!result.cancelled) { this.metadata(result.snapshot, true); await this.loadActive(); }
    });
  }
  remove(id, ask) {
    return this.run(async () => {
      await this.flush();
      const doc = this.state.documents.find(doc => doc.id === id); if (!doc) return;
      const read = await this.api.read(id);
      const requiresDecision = doc.path ? read.dirty : read.markdown.trim().length > 0;
      const decision = requiresDecision ? await ask(doc) : 'discard';
      if (decision === 'cancel') return;
      if (decision === 'save') {
        const saved = await this.api.save(id, false);
        if (saved.cancelled) return;
        this.metadata(saved.snapshot);
      }
      const previousId = this.state.activeId;
      this.metadata(await this.api.remove(id, decision === 'save' ? 'saved' : 'discard'), true);
      this.state.removalSequence++;
      this.buffers.delete(id); this.sessions.delete(id); this.names.delete(id);
      clearTimeout(this.timers.get('name:' + id)); this.timers.delete('name:' + id);
      if (previousId !== this.state.activeId) await this.loadActive();
    });
  }
  undoRemove() {
    return this.run(async () => { await this.flush(); const old = this.state.activeId; this.metadata(await this.api.undo(), true); if (old !== this.state.activeId) await this.loadActive(); });
  }
  drain() { return this.run(async () => { await this.flush(); await Promise.all(this.saves.values()); await this.api.checkpoint(); }); }
  close() { return this.run(async () => { await this.flush(); await this.api.checkpoint(); await this.api.closeReady(); }); }
  dispose() { this.disposed = true; this.timers.forEach(clearTimeout); this.timers.clear(); }
}
