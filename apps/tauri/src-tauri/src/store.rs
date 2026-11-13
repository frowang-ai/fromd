//! Port of `apps/desktop/src/main/documentStore.js`. Behaviour and messages are kept
//! identical so the shared renderer sees the same contract.
use crate::storage::{digest, Change, Storage};
use indexmap::IndexMap;
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::io::Write;
use std::path::{Path, PathBuf};

pub const MAX_BYTES: usize = 10 * 1024 * 1024;
const MAX_SESSION_BYTES: i64 = 100 * 1024 * 1024;
const UNTITLED: &str = "未命名笔记";
const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

fn err<E: std::fmt::Display>(error: E) -> String { error.to_string() }
fn path_key(path: &str) -> String { if cfg!(windows) { path.to_lowercase() } else { path.to_string() } }
fn preview(markdown: &str) -> String { markdown.chars().take(1200).collect() }
fn basename(path: &Path) -> String { path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default() }
fn new_id() -> String { uuid::Uuid::new_v4().to_string() }

pub fn canonical_path(path: &Path) -> Result<PathBuf, String> {
  match dunce::canonicalize(path) {
    Ok(path) => Ok(path),
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
      let parent = path.parent().ok_or("路径无效。")?;
      let name = path.file_name().ok_or("路径无效。")?;
      Ok(dunce::canonicalize(parent).map_err(err)?.join(name))
    }
    Err(error) => Err(err(error)),
  }
}

/// Same-directory temporary file, fsync, then rename over the destination.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
  let directory = path.parent().ok_or("路径无效。")?;
  let temporary = directory.join(format!(".{}.{}.tmp", basename(path), new_id()));
  let result = (|| {
    let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(err)?;
    file.write_all(bytes).map_err(err)?;
    file.sync_all().map_err(err)?;
    drop(file);
    std::fs::rename(&temporary, path).map_err(err)
  })();
  let _ = std::fs::remove_file(&temporary);
  result
}

fn file_bytes(path: &Path) -> Result<Vec<u8>, String> {
  let too_large = || "首版支持 10 MB 以内的文本文件。".to_string();
  let info = std::fs::metadata(path).map_err(err)?;
  if !info.is_file() || info.len() as usize > MAX_BYTES {
    return Err(too_large());
  }
  let bytes = std::fs::read(path).map_err(err)?;
  if bytes.len() > MAX_BYTES {
    return Err(too_large());
  }
  Ok(bytes)
}

struct Decoded { markdown: String, bom: bool, eol: &'static str }

fn decode(bytes: &[u8]) -> Result<Decoded, String> {
  let bom = bytes.starts_with(&[0xEF, 0xBB, 0xBF]);
  let text = std::str::from_utf8(bytes).map_err(|_| "文件不是 UTF-8 编码。请先以 UTF-8 保存，再打开。".to_string())?;
  let text = if bom { &text[3..] } else { text };
  if text.contains('\0') {
    return Err("不能打开二进制文件。".into());
  }
  let eol = if text.contains("\r\n") { "\r\n" } else { "\n" };
  Ok(Decoded { markdown: text.replace("\r\n", "\n").replace('\r', "\n"), bom, eol })
}

pub fn suggested_filename(title: &str, extension: &str) -> String {
  let trim_tail = |name: &str| name.trim_end_matches(['.', ' ']).to_string();
  let replaced: String = title.chars().map(|c| if "<>:\"/\\|?*".contains(c) || (c as u32) < 0x20 { '_' } else { c }).collect();
  let mut name = trim_tail(&replaced).trim().to_string();
  let lower = name.to_lowercase();
  for suffix in [".md", ".markdown", ".txt"] {
    if lower.ends_with(suffix) {
      name.truncate(name.len() - suffix.len());
      break;
    }
  }
  name = trim_tail(&name.chars().take(120).collect::<String>());
  if name.is_empty() {
    name = UNTITLED.into();
  }
  let stem = name.split('.').next().unwrap_or_default().to_lowercase();
  let reserved = ["con", "prn", "aux", "nul"].contains(&stem.as_str())
    || ((stem.starts_with("com") || stem.starts_with("lpt")) && {
      let rest: Vec<char> = stem.chars().skip(3).collect();
      rest.len() == 1 && "123456789¹²³".contains(rest[0])
    });
  if reserved {
    name = format!("_{name}");
  }
  format!("{name}.{extension}")
}

fn safe_number(value: &Value) -> Option<f64> {
  value.as_f64().filter(|number| number.is_finite() && *number >= 0.0 && *number <= MAX_SAFE_INTEGER as f64)
}

fn view_state(state: &Value) -> Result<Value, String> {
  let invalid = || "阅读状态无效。".to_string();
  let object = state.as_object().ok_or_else(invalid)?;
  if object.keys().any(|key| !["mode", "scrollTop", "selection", "sourceSelection", "sourceScrollTop"].contains(&key.as_str())) {
    return Err(invalid());
  }
  let mode = object.get("mode").and_then(Value::as_str).filter(|mode| ["rendered", "source"].contains(mode)).ok_or_else(invalid)?;
  let scroll_top = object.get("scrollTop").and_then(safe_number).ok_or_else(invalid)?;
  let mut result = Map::new();
  result.insert("mode".into(), mode.into());
  result.insert("scrollTop".into(), json!(scroll_top));
  if let Some(value) = object.get("sourceScrollTop") {
    result.insert("sourceScrollTop".into(), json!(safe_number(value).ok_or_else(invalid)?));
  }
  for (key, names) in [("selection", ["anchor", "head"]), ("sourceSelection", ["start", "end"])] {
    let Some(value) = object.get(key) else { continue };
    let inner = value.as_object().ok_or_else(invalid)?;
    if inner.keys().any(|name| !names.contains(&name.as_str())) {
      return Err(invalid());
    }
    let mut clean = Map::new();
    for name in names {
      let number = inner.get(name).and_then(Value::as_i64).filter(|number| (0..=MAX_SAFE_INTEGER).contains(number)).ok_or_else(invalid)?;
      clean.insert(name.into(), number.into());
    }
    result.insert(key.into(), Value::Object(clean));
  }
  Ok(Value::Object(result))
}

#[derive(Clone)]
pub struct Doc {
  pub id: String,
  pub title: String,
  pub path: Option<String>,
  saved_hash: String,
  content_hash: String,
  baseline: Option<String>,
  bom: bool,
  eol: String,
  revision: i64,
  conflict: bool,
  view_state: Value,
  position: i64,
  shelved: bool,
  preview: String,
}

impl Doc {
  fn from_row(row: &Map<String, Value>) -> Doc {
    let text = |key: &str| row.get(key).and_then(Value::as_str).map(str::to_string);
    Doc {
      id: text("id").unwrap_or_default(),
      title: text("title").unwrap_or_default(),
      path: text("path"),
      saved_hash: text("savedHash").unwrap_or_default(),
      content_hash: text("contentHash").unwrap_or_default(),
      baseline: text("baseline"),
      bom: row.get("bom").and_then(Value::as_bool).unwrap_or(false),
      eol: text("eol").unwrap_or_else(|| "\n".into()),
      revision: row.get("revision").and_then(Value::as_i64).unwrap_or(0),
      conflict: row.get("conflict").and_then(Value::as_bool).unwrap_or(false),
      view_state: row.get("viewState").cloned().unwrap_or(Value::Null),
      position: row.get("position").and_then(Value::as_i64).unwrap_or(0),
      shelved: row.get("shelved").and_then(Value::as_bool).unwrap_or(false),
      preview: text("preview").unwrap_or_default(),
    }
  }
  fn row(&self) -> Map<String, Value> {
    let Value::Object(map) = json!({
      "id": self.id, "title": self.title, "path": self.path, "savedHash": self.saved_hash, "contentHash": self.content_hash,
      "baseline": self.baseline, "bom": self.bom, "eol": self.eol, "revision": self.revision, "conflict": self.conflict,
      "viewState": self.view_state, "position": self.position, "shelved": self.shelved,
    }) else { unreachable!() };
    map
  }
}

#[derive(Clone)]
struct Pending { insert: bool, fields: Map<String, Value> }

struct Removed { doc: Doc, markdown: String, index: usize, was_active: bool }

#[derive(Clone)]
struct Layout { documents: Vec<Doc>, active_id: Option<String>, pending: IndexMap<String, Pending>, deleted: Vec<String> }

pub struct DocumentStore {
  storage: Option<Storage>,
  pub documents: Vec<Doc>,
  active_id: Option<String>,
  warning: String,
  recovery_writable: bool,
  pending: IndexMap<String, Pending>,
  deleted: Vec<String>,
  persisted_ids: HashSet<String>,
  position: i64,
  last_removed: Option<Removed>,
}

impl DocumentStore {
  /// Opens (or migrates) the SQLite recovery store; a broken store keeps the app usable.
  pub fn restore(directory: &Path) -> DocumentStore {
    let mut store = DocumentStore {
      storage: None, documents: vec![], active_id: None, warning: String::new(), recovery_writable: true,
      pending: IndexMap::new(), deleted: vec![], persisted_ids: HashSet::new(), position: 0, last_removed: None,
    };
    match Storage::open(directory, MAX_SESSION_BYTES) {
      Ok((storage, initial)) => {
        store.storage = Some(storage);
        store.documents = initial.documents.iter().map(Doc::from_row).collect();
        store.persisted_ids = store.documents.iter().map(|doc| doc.id.clone()).collect();
        store.position = store.documents.iter().map(|doc| doc.position).max().unwrap_or(-1) + 1;
        let visible = |id: &str| store.documents.iter().any(|doc| doc.id == id && !doc.shelved);
        store.active_id = match initial.active_id {
          Some(id) if visible(&id) => Some(id),
          _ => store.documents.iter().find(|doc| !doc.shelved).map(|doc| doc.id.clone()),
        };
      }
      Err(_) => {
        store.warning = "恢复文件无法读取，原文件已保留。本次会话不能自动备份，请用保存或另存为保留内容。".into();
        store.recovery_writable = false;
      }
    }
    if store.documents.is_empty() {
      store.new_document("", UNTITLED);
    } else {
      store.try_persist();
    }
    store
  }

  fn index(&self, id: &str) -> Result<usize, String> {
    self.documents.iter().position(|doc| doc.id == id).ok_or_else(|| "笔记已经关闭。".into())
  }
  pub fn get(&self, id: &str) -> Result<&Doc, String> { Ok(&self.documents[self.index(id)?]) }
  pub fn is_dirty(doc: &Doc) -> bool { doc.content_hash != doc.saved_hash }
  fn needs_recovery(&self, doc: &Doc) -> bool {
    Self::is_dirty(doc)
      || (doc.path.is_none() && (doc.title != UNTITLED || (self.persisted_ids.contains(&doc.id) && self.pending.contains_key(&doc.id))))
  }
  pub fn can_exit_without_recovery(&self) -> bool {
    self.deleted.is_empty() && !self.documents.iter().any(|doc| self.needs_recovery(doc))
  }
  fn metadata(doc: &Doc) -> Value {
    json!({ "id": doc.id, "title": doc.title, "path": doc.path, "revision": doc.revision, "dirty": Self::is_dirty(doc),
      "conflict": doc.conflict, "viewState": doc.view_state, "shelved": doc.shelved, "preview": doc.preview })
  }
  pub fn snapshot(&self) -> Value {
    json!({ "documents": self.documents.iter().map(Self::metadata).collect::<Vec<_>>(), "activeId": self.active_id,
      "warning": self.warning, "undoRemoval": self.last_removed.as_ref().map(|removed| removed.doc.title.clone()) })
  }
  fn body(&self, id: &str) -> Result<String, String> {
    self.get(id)?;
    if let Some(markdown) = self.pending.get(id).and_then(|pending| pending.fields.get("markdown")).and_then(Value::as_str) {
      return Ok(markdown.to_string());
    }
    self.storage.as_ref().ok_or("草稿备份不可用。")?.read(id)
  }
  pub fn read(&mut self, id: &str) -> Result<Value, String> {
    let index = self.index(id)?;
    self.check_external(index);
    let markdown = self.body(id)?;
    let mut value = Self::metadata(&self.documents[self.index(id)?]);
    value["markdown"] = markdown.into();
    value["warning"] = self.warning.clone().into();
    Ok(value)
  }
  fn mark(&mut self, id: &str, fields: Map<String, Value>, insert: bool) {
    let entry = self.pending.entry(id.to_string()).or_insert(Pending { insert, fields: Map::new() });
    entry.insert |= insert;
    entry.fields.extend(fields);
  }
  fn check_external(&mut self, index: usize) {
    let Some(path) = self.documents[index].path.clone() else { return };
    let outcome = file_bytes(Path::new(&path)).and_then(|bytes| Ok((digest(&bytes), decode(&bytes)?)));
    let id = self.documents[index].id.clone();
    match outcome {
      Ok((baseline, format)) => {
        let doc = &mut self.documents[index];
        let changed = doc.baseline.as_deref() != Some(&baseline);
        if !Self::is_dirty(doc) && changed {
          let hash = digest(format.markdown.as_bytes());
          doc.bom = format.bom;
          doc.eol = format.eol.into();
          doc.baseline = Some(baseline.clone());
          doc.saved_hash = hash.clone();
          doc.content_hash = hash.clone();
          doc.conflict = false;
          doc.revision += 1;
          doc.preview = preview(&format.markdown);
          let fields = json!({ "bom": format.bom, "eol": format.eol, "baseline": baseline, "savedHash": hash, "contentHash": hash,
            "conflict": false, "revision": doc.revision, "markdown": format.markdown });
          self.mark(&id, fields.as_object().cloned().unwrap_or_default(), false);
        } else if doc.conflict != changed {
          doc.conflict = changed;
          self.mark(&id, json!({ "conflict": changed }).as_object().cloned().unwrap_or_default(), false);
        }
      }
      Err(_) => {
        if !self.documents[index].conflict {
          self.documents[index].conflict = true;
          self.mark(&id, json!({ "conflict": true }).as_object().cloned().unwrap_or_default(), false);
        }
      }
    }
    if self.pending.contains_key(&id) {
      self.try_persist();
    }
  }

  fn persist(&mut self) -> Result<bool, String> {
    if !self.recovery_writable {
      return Ok(false);
    }
    // Only modified columns are written; a rename/activation never transfers other bodies.
    let mut changes = vec![];
    for (id, change) in &self.pending {
      if change.insert {
        let mut row = self.get(id)?.row();
        row.extend(change.fields.clone());
        changes.push(Change::Insert(row));
      } else {
        changes.push(Change::Update { id: id.clone(), fields: change.fields.clone() });
      }
    }
    let storage = self.storage.as_ref().ok_or("草稿备份不可用。")?;
    match storage.apply(&changes, &self.deleted, self.active_id.as_deref()) {
      Ok(()) => {
        for (id, change) in self.pending.drain(..) {
          if change.insert {
            self.persisted_ids.insert(id);
          }
        }
        for id in self.deleted.drain(..) {
          self.persisted_ids.remove(&id);
        }
        self.warning.clear();
        Ok(true)
      }
      Err(error) => {
        self.warning = if error.contains("容量上限") { error } else { "草稿备份失败。请保存到文件；当前页面内容仍保留。".into() };
        Err(self.warning.clone())
      }
    }
  }
  pub fn try_persist(&mut self) -> bool { self.persist().unwrap_or(false) }

  pub fn new_document(&mut self, markdown: &str, title: &str) -> Value {
    let doc = Doc {
      id: new_id(), title: title.into(), path: None, saved_hash: digest(b""), content_hash: digest(markdown.as_bytes()), baseline: None,
      bom: false, eol: "\n".into(), revision: 0, conflict: false, view_state: Value::Null, position: self.position, shelved: false,
      preview: preview(markdown),
    };
    self.position += 1;
    let id = doc.id.clone();
    self.documents.push(doc);
    self.active_id = Some(id.clone());
    self.mark(&id, json!({ "markdown": markdown }).as_object().cloned().unwrap_or_default(), true);
    self.try_persist();
    self.snapshot()
  }

  fn find_path(&self, path: &str) -> Option<usize> {
    let key = path_key(path);
    self.documents.iter().position(|doc| doc.path.as_deref().is_some_and(|other| path_key(other) == key))
  }

  pub fn open_file(&mut self, path: &Path) -> Result<Value, String> {
    let canonical = canonical_path(path)?;
    let text = canonical.to_string_lossy().into_owned();
    if let Some(index) = self.find_path(&text) {
      let id = self.documents[index].id.clone();
      self.activate(&id)?;
      return Ok(self.snapshot());
    }
    let bytes = file_bytes(&canonical)?;
    let format = decode(&bytes)?;
    let hash = digest(format.markdown.as_bytes());
    let doc = Doc {
      id: new_id(), title: basename(&canonical), path: Some(text), saved_hash: hash.clone(), content_hash: hash, baseline: Some(digest(&bytes)),
      bom: format.bom, eol: format.eol.into(), revision: 0, conflict: false, view_state: Value::Null, position: self.position, shelved: false,
      preview: preview(&format.markdown),
    };
    self.position += 1;
    let id = doc.id.clone();
    self.documents.push(doc);
    self.active_id = Some(id.clone());
    self.mark(&id, json!({ "markdown": format.markdown }).as_object().cloned().unwrap_or_default(), true);
    self.try_persist();
    Ok(self.snapshot())
  }

  pub fn update(&mut self, id: &str, markdown: &str, revision: &Value) -> Result<Value, String> {
    let revision = revision.as_i64().filter(|value| (0..=MAX_SAFE_INTEGER).contains(value));
    let (Some(revision), true) = (revision, markdown.len() <= MAX_BYTES) else { return Err("笔记内容或版本无效。".into()) };
    let index = self.index(id)?;
    let doc = &mut self.documents[index];
    if revision < doc.revision {
      return Ok(json!({ "backedUp": false, "stale": true }));
    }
    let content_hash = digest(markdown.as_bytes());
    if revision == doc.revision && content_hash != doc.content_hash {
      return Err("笔记版本冲突，请先另存当前内容。".into());
    }
    if content_hash != doc.content_hash || revision != doc.revision {
      doc.revision = revision;
      doc.content_hash = content_hash.clone();
      doc.preview = preview(markdown);
      self.mark(id, json!({ "markdown": markdown, "revision": revision, "contentHash": content_hash }).as_object().cloned().unwrap_or_default(), false);
    }
    let backed_up = self.try_persist();
    let dirty = Self::is_dirty(&self.documents[self.index(id)?]);
    Ok(json!({ "backedUp": backed_up, "dirty": dirty, "warning": if backed_up { String::new() } else { self.warning.clone() } }))
  }

  pub fn rename(&mut self, id: &str, title: &str) -> Result<Value, String> {
    let index = self.index(id)?;
    if self.documents[index].path.is_some() {
      return Err("只能命名未关联文件的草稿。".into());
    }
    if title.len() > 1024 {
      return Err("笔记名称无效或过长。".into());
    }
    let title = if title.trim().is_empty() { UNTITLED.to_string() } else { title.trim().to_string() };
    self.documents[index].title = title.clone();
    self.mark(id, json!({ "title": title }).as_object().cloned().unwrap_or_default(), false);
    let backed_up = self.try_persist();
    Ok(json!({ "id": id, "title": title, "backedUp": backed_up, "warning": if backed_up { String::new() } else { self.warning.clone() } }))
  }

  pub fn set_view_state(&mut self, id: &str, state: &Value) -> Result<Value, String> {
    let index = self.index(id)?;
    let clean = view_state(state)?;
    self.documents[index].view_state = clean.clone();
    self.mark(id, json!({ "viewState": clean }).as_object().cloned().unwrap_or_default(), false);
    let saved = self.try_persist();
    Ok(json!({ "saved": saved, "warning": if saved { String::new() } else { self.warning.clone() } }))
  }

  /// Shelf/removal changes become visible only after a confirmed commit; failures restore everything.
  fn change_layout(&mut self, change: impl FnOnce(&mut DocumentStore)) -> Result<(), String> {
    let previous = Layout { documents: self.documents.clone(), active_id: self.active_id.clone(), pending: self.pending.clone(), deleted: self.deleted.clone() };
    change(self);
    let outcome = match self.persist() {
      Ok(true) => Ok(()),
      Ok(false) => Err(if self.warning.is_empty() { "页面状态无法保存，请恢复备份后重试。".to_string() } else { self.warning.clone() }),
      Err(error) => Err(error),
    };
    if outcome.is_err() {
      self.documents = previous.documents;
      self.active_id = previous.active_id;
      self.pending = previous.pending;
      self.deleted = previous.deleted;
    }
    outcome
  }

  pub fn activate(&mut self, id: &str) -> Result<bool, String> {
    let index = self.index(id)?;
    if self.documents[index].shelved {
      let id = id.to_string();
      self.change_layout(|store| {
        store.documents[index].shelved = false;
        store.mark(&id, json!({ "shelved": false }).as_object().cloned().unwrap_or_default(), false);
        store.active_id = Some(id.clone());
      })?;
    } else {
      self.active_id = Some(id.to_string());
      self.try_persist();
    }
    Ok(true)
  }

  pub fn shelve(&mut self, id: &str) -> Result<Value, String> {
    let index = self.index(id)?;
    let id = id.to_string();
    self.change_layout(|store| {
      store.documents[index].shelved = true;
      store.mark(&id, json!({ "shelved": true }).as_object().cloned().unwrap_or_default(), false);
      if store.active_id.as_deref() == Some(&id) {
        let next = store.documents.iter().enumerate().find(|(other, doc)| !doc.shelved && *other > index).map(|(_, doc)| doc.id.clone());
        store.active_id = next.or_else(|| store.documents.iter().rev().find(|doc| !doc.shelved).map(|doc| doc.id.clone()));
      }
    })?;
    Ok(self.snapshot())
  }

  pub fn remove(&mut self, id: &str) -> Result<Value, String> {
    let index = self.index(id)?;
    let markdown = self.body(id)?;
    let removed = Removed { doc: self.documents[index].clone(), markdown, index, was_active: self.active_id.as_deref() == Some(id) };
    let id = id.to_string();
    self.change_layout(|store| {
      store.documents.remove(index);
      store.pending.shift_remove(&id);
      if store.persisted_ids.contains(&id) {
        store.deleted.push(id.clone());
      }
      if store.active_id.as_deref() == Some(&id) {
        let next = store.documents[index..].iter().find(|doc| !doc.shelved).map(|doc| doc.id.clone());
        store.active_id = next.or_else(|| store.documents.iter().rev().find(|doc| !doc.shelved).map(|doc| doc.id.clone()));
      }
    })?;
    self.last_removed = Some(removed);
    Ok(self.snapshot())
  }

  pub fn undo_remove(&mut self) -> Result<Value, String> {
    let Some(removed) = self.last_removed.take() else { return Ok(self.snapshot()) };
    let reopened = removed.doc.path.as_deref().is_some_and(|path| self.find_path(path).is_some());
    // A fresh ID prevents pre-deletion replies/updates from targeting the restored page.
    let mut doc = Doc { id: new_id(), ..removed.doc.clone() };
    if reopened {
      doc.path = None;
      doc.title = format!("{}（恢复的草稿）", doc.title);
      doc.baseline = None;
      doc.saved_hash = digest(b"");
      doc.conflict = false;
    }
    let (markdown, index, was_active) = (removed.markdown.clone(), removed.index, removed.was_active);
    let outcome = self.change_layout(|store| {
      let id = doc.id.clone();
      let shelved = doc.shelved;
      let at = index.min(store.documents.len());
      store.documents.insert(at, doc);
      store.mark(&id, json!({ "markdown": markdown }).as_object().cloned().unwrap_or_default(), true);
      if was_active || (store.active_id.is_none() && !shelved) {
        store.active_id = Some(id);
      }
    });
    if let Err(error) = outcome {
      self.last_removed = Some(removed);
      return Err(error);
    }
    let mut snapshot = self.snapshot();
    if reopened {
      snapshot["info"] = "文件已经重新打开，旧内容已恢复为独立草稿。".into();
    }
    Ok(snapshot)
  }

  pub fn save(&mut self, id: &str, target: Option<&Path>) -> Result<Value, String> {
    let index = self.index(id)?;
    let current = self.documents[index].path.clone();
    let requested = target.map(Path::to_path_buf).or_else(|| current.as_ref().map(PathBuf::from)).ok_or("没有保存位置。")?;
    let path = canonical_path(&requested)?;
    let text = path.to_string_lossy().into_owned();
    let key = path_key(&text);
    if self.documents.iter().any(|other| other.id != id && other.path.as_deref().is_some_and(|other| path_key(other) == key)) {
      return Err("该文件已经在另一标签中打开，请切到那一篇保存。".into());
    }
    let same_file = current.as_deref().is_some_and(|current| path_key(current) == key);
    self.check_external(index);
    let index = self.index(id)?;
    if same_file {
      if self.documents[index].conflict {
        return Ok(json!({ "conflict": true, "snapshot": self.snapshot() }));
      }
      if !Self::is_dirty(&self.documents[index]) {
        return Ok(json!({ "saved": true, "warning": self.warning, "snapshot": self.snapshot() }));
      }
    }
    let markdown = self.body(id)?;
    let doc = &self.documents[index];
    let normalized = markdown.replace("\r\n", "\n").replace('\r', "\n").replace('\n', &doc.eol);
    let mut bytes = Vec::with_capacity(normalized.len() + 3);
    if doc.bom {
      bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
    }
    bytes.extend_from_slice(normalized.as_bytes());
    if bytes.len() > MAX_BYTES {
      return Err("保存后的文件超过 10 MB（包括换行和 BOM），请精简或拆分。原文件未修改。".into());
    }
    atomic_write(&path, &bytes)?;
    let doc = &mut self.documents[index];
    doc.path = Some(text.clone());
    doc.title = basename(&path);
    doc.baseline = Some(digest(&bytes));
    doc.saved_hash = doc.content_hash.clone();
    doc.conflict = false;
    let fields = json!({ "path": text, "title": doc.title, "baseline": doc.baseline, "savedHash": doc.saved_hash, "conflict": false });
    self.mark(id, fields.as_object().cloned().unwrap_or_default(), false);
    // Successful external writes stay usable even when SQLite is unavailable.
    let backed_up = self.try_persist();
    Ok(json!({ "saved": true, "warning": if backed_up { String::new() } else { self.warning.clone() }, "snapshot": self.snapshot() }))
  }

  pub fn reload(&mut self, id: &str) -> Result<Value, String> {
    let index = self.index(id)?;
    let path = self.documents[index].path.clone().ok_or("未命名笔记没有磁盘文件。")?;
    let bytes = file_bytes(Path::new(&path))?;
    let format = decode(&bytes)?;
    let hash = digest(format.markdown.as_bytes());
    let doc = &mut self.documents[index];
    doc.bom = format.bom;
    doc.eol = format.eol.into();
    doc.saved_hash = hash.clone();
    doc.content_hash = hash.clone();
    doc.baseline = Some(digest(&bytes));
    doc.conflict = false;
    doc.revision += 1;
    doc.preview = preview(&format.markdown);
    let fields = json!({ "bom": format.bom, "eol": format.eol, "savedHash": hash, "contentHash": hash, "baseline": doc.baseline,
      "conflict": false, "revision": doc.revision, "markdown": format.markdown });
    self.mark(id, fields.as_object().cloned().unwrap_or_default(), false);
    self.try_persist();
    Ok(self.snapshot())
  }

  /// Document path for the image protocol (no other store access from that handler).
  pub fn document_path(&self, id: &str) -> Option<String> { self.get(id).ok().and_then(|doc| doc.path.clone()) }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp(name: &str) -> PathBuf {
    let directory = std::env::temp_dir().join(format!("frowd-lite-{name}-{}", new_id()));
    std::fs::create_dir_all(&directory).unwrap();
    directory
  }

  #[test]
  fn filenames_match_the_electron_rules() {
    assert_eq!(suggested_filename("a/b:c", "md"), "a_b_c.md");
    assert_eq!(suggested_filename("notes.md", "md"), "notes.md");
    assert_eq!(suggested_filename("  ", "md"), "未命名笔记.md");
    assert_eq!(suggested_filename("con", "md"), "_con.md");
    assert_eq!(suggested_filename("COM1.txt", "pdf"), "_COM1.pdf");
    assert_eq!(suggested_filename("title. ", "md"), "title.md");
  }

  #[test]
  fn file_round_trip_keeps_bom_and_crlf() {
    let directory = temp("roundtrip");
    let file = directory.join("note.md");
    std::fs::write(&file, b"\xEF\xBB\xBF# T\r\nline\r\n").unwrap();
    let mut store = DocumentStore::restore(&directory.join("data"));
    store.open_file(&file).unwrap();
    let id = store.documents.last().unwrap().id.clone();
    assert_eq!(store.read(&id).unwrap()["markdown"], "# T\nline\n");
    store.update(&id, "# T\nchanged\n", &json!(1)).unwrap();
    assert_eq!(store.save(&id, None).unwrap()["saved"], true);
    assert_eq!(std::fs::read(&file).unwrap(), b"\xEF\xBB\xBF# T\r\nchanged\r\n");
  }

  #[test]
  fn external_change_on_dirty_document_is_a_conflict() {
    let directory = temp("conflict");
    let file = directory.join("note.md");
    std::fs::write(&file, "one").unwrap();
    let mut store = DocumentStore::restore(&directory.join("data"));
    store.open_file(&file).unwrap();
    let id = store.documents.last().unwrap().id.clone();
    store.update(&id, "mine", &json!(1)).unwrap();
    std::fs::write(&file, "theirs").unwrap();
    assert_eq!(store.save(&id, None).unwrap()["conflict"], true);
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "theirs");
  }

  #[test]
  fn drafts_shelving_and_removal_survive_restart() {
    let directory = temp("restart");
    let data = directory.join("data");
    let (first, second);
    {
      let mut store = DocumentStore::restore(&data);
      first = store.documents[0].id.clone();
      store.update(&first, "draft body", &json!(1)).unwrap();
      store.rename(&first, "named").unwrap();
      store.new_document("", UNTITLED);
      second = store.documents[1].id.clone();
      store.shelve(&first).unwrap();
    }
    let mut store = DocumentStore::restore(&data);
    assert_eq!(store.documents.len(), 2);
    let restored = store.get(&first).unwrap().clone();
    assert!(restored.shelved);
    assert_eq!(restored.title, "named");
    assert_eq!(store.read(&first).unwrap()["markdown"], "draft body");
    assert_eq!(store.snapshot()["activeId"], json!(second));
    store.remove(&first).unwrap();
    assert_eq!(store.documents.len(), 1);
    let snapshot = store.undo_remove().unwrap();
    assert_eq!(snapshot["documents"].as_array().unwrap().len(), 2);
    assert_ne!(store.documents[0].id, first, "undo uses a fresh id");
  }

  #[test]
  fn stale_revision_and_bad_view_state_are_rejected() {
    let directory = temp("stale");
    let mut store = DocumentStore::restore(&directory);
    let id = store.documents[0].id.clone();
    store.update(&id, "a", &json!(2)).unwrap();
    assert_eq!(store.update(&id, "b", &json!(1)).unwrap()["stale"], true);
    assert!(store.update(&id, "c", &json!(2)).is_err());
    assert!(store.set_view_state(&id, &json!({ "mode": "rendered", "scrollTop": -1 })).is_err());
    assert!(store.set_view_state(&id, &json!({ "mode": "source", "scrollTop": 3, "sourceSelection": { "start": 1, "end": 2 } })).is_ok());
  }
}
