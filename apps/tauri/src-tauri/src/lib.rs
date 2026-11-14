use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::{Value};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, fs, path::PathBuf, sync::Mutex};
use tauri::{Manager, State};
use thiserror::Error;
use uuid::Uuid;

const DEFAULT_TITLE: &str = "未命名笔记";
const MAX_DOCUMENT_BYTES: usize = 10 * 1024 * 1024;
const MAX_SESSION_BYTES: i64 = 100 * 1024 * 1024;

#[derive(Debug, Error)]
enum StoreError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Sql(#[from] rusqlite::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}
impl StoreError { fn message(message: impl Into<String>) -> Self { Self::Message(message.into()) } }
type StoreResult<T> = Result<T, StoreError>;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ViewState {
    mode: String,
    scroll_top: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_scroll_top: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    selection: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_selection: Option<Value>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentMetadata {
    id: String,
    title: String,
    path: Option<String>,
    revision: i64,
    position: i64,
    shelved: bool,
    dirty: bool,
    conflict: bool,
    preview: String,
    view_state: Option<ViewState>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentRead {
    #[serde(flatten)]
    metadata: DocumentMetadata,
    markdown: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    documents: Vec<DocumentMetadata>,
    active_id: Option<String>,
    undo_removal: Option<String>,
    warning: String,
}
#[derive(Clone, Debug)]
struct RemovedDocument {
    title: String,
    path: Option<String>,
    markdown: String,
    saved_hash: String,
    content_hash: String,
    baseline: Option<String>,
    bom: bool,
    eol: String,
    revision: i64,
    conflict: bool,
    view_state: Option<String>,
    position: i64,
    shelved: bool,
    was_active: bool,
}
struct Store { conn: Connection, last_removed: Option<RemovedDocument> }
struct AppState { store: Mutex<Store> }

fn digest(text: &str) -> String {
    let mut hash = Sha256::new(); hash.update(text.as_bytes()); format!("{:x}", hash.finalize())
}
fn validate_markdown(markdown: &str) -> StoreResult<()> {
    if markdown.as_bytes().len() > MAX_DOCUMENT_BYTES { return Err(StoreError::message("首版支持 10 MB 以内的文本内容。")); }
    Ok(())
}
fn validate_title(title: &str) -> StoreResult<String> {
    if title.as_bytes().len() > 1024 { return Err(StoreError::message("笔记名称无效或过长。")); }
    let title = title.trim(); Ok(if title.is_empty() { DEFAULT_TITLE.into() } else { title.into() })
}
fn parse_view_state(raw: Option<String>) -> StoreResult<Option<ViewState>> {
    let Some(raw) = raw else { return Ok(None) };
    if raw == "null" || raw.is_empty() { return Ok(None); }
    Ok(Some(serde_json::from_str(&raw)?))
}
fn view_state_json(value: Value) -> StoreResult<String> {
    let object = value.as_object().ok_or_else(|| StoreError::message("阅读状态无效。"))?;
    if object.keys().any(|key| !["mode","scrollTop","selection","sourceSelection","sourceScrollTop"].contains(&key.as_str())) { return Err(StoreError::message("阅读状态无效。")); }
    let mode = object.get("mode").and_then(Value::as_str).unwrap_or_default();
    let scroll_top = object.get("scrollTop").and_then(Value::as_f64).unwrap_or(-1.0);
    if !["rendered","source"].contains(&mode) || !scroll_top.is_finite() || scroll_top < 0.0 { return Err(StoreError::message("阅读状态无效。")); }
    Ok(serde_json::to_string(&value)?)
}
fn row_metadata(row: &Row<'_>) -> StoreResult<DocumentMetadata> {
    let content_hash: String = row.get("contentHash")?;
    let saved_hash: String = row.get("savedHash")?;
    Ok(DocumentMetadata {
        id: row.get("id")?, title: row.get("title")?, path: row.get("path")?,
        revision: row.get("revision")?, position: row.get("position")?,
        shelved: row.get::<_, i64>("shelved")? != 0,
        dirty: content_hash != saved_hash, conflict: row.get::<_, i64>("conflict")? != 0,
        preview: row.get::<_, Option<String>>("preview")?.unwrap_or_default(),
        view_state: parse_view_state(row.get("viewState")?)?,
    })
}
impl Store {
    fn open(directory: PathBuf) -> StoreResult<Self> {
        fs::create_dir_all(&directory)?;
        let conn = Connection::open(directory.join("drafts.sqlite"))?;
        conn.pragma_update(None, "busy_timeout", 3000i64)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "FULL")?;
        Self::initialize(&conn)?;
        Ok(Self { conn, last_removed: None })
    }
    fn initialize(conn: &Connection) -> StoreResult<()> {
        conn.execute_batch("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS documents (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, path TEXT, markdown TEXT NOT NULL,
 savedHash TEXT NOT NULL, contentHash TEXT NOT NULL DEFAULT '', baseline TEXT,
 bom INTEGER NOT NULL DEFAULT 0, eol TEXT NOT NULL DEFAULT '\n',
 revision INTEGER NOT NULL DEFAULT 0, conflict INTEGER NOT NULL DEFAULT 0,
 viewState TEXT NOT NULL DEFAULT 'null', position INTEGER NOT NULL,
 size INTEGER NOT NULL DEFAULT 0, shelved INTEGER NOT NULL DEFAULT 0
);")?;
        let columns: HashSet<String> = conn.prepare("PRAGMA table_info(documents)")?.query_map([], |row| row.get::<_, String>(1))?.collect::<Result<_, _>>()?;
        if !columns.contains("contentHash") { conn.execute("ALTER TABLE documents ADD COLUMN contentHash TEXT NOT NULL DEFAULT ''", [])?; }
        if !columns.contains("shelved") { conn.execute("ALTER TABLE documents ADD COLUMN shelved INTEGER NOT NULL DEFAULT 0", [])?; }
        if !columns.contains("size") { conn.execute("ALTER TABLE documents ADD COLUMN size INTEGER NOT NULL DEFAULT 0", [])?; }
        if !columns.contains("viewState") { conn.execute("ALTER TABLE documents ADD COLUMN viewState TEXT NOT NULL DEFAULT 'null'", [])?; }
        let mut statement = conn.prepare("SELECT id, markdown FROM documents WHERE contentHash=''")?;
        let rows = statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?.collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        for (id, markdown) in rows { conn.execute("UPDATE documents SET contentHash=?1 WHERE id=?2", params![digest(&markdown), id])?; }
        conn.execute("INSERT OR IGNORE INTO settings(key,value) VALUES ('version','3')", [])?;
        conn.execute("INSERT OR IGNORE INTO settings(key,value) VALUES ('activeId',NULL)", [])?;
        Ok(())
    }
    fn active_id(&self) -> StoreResult<Option<String>> {
        Ok(self.conn.query_row("SELECT value FROM settings WHERE key='activeId'", [], |row| row.get(0)).optional()?)
    }
    fn check_capacity(&self) -> StoreResult<()> {
        let total: i64 = self.conn.query_row("SELECT COALESCE(SUM(length(CAST(markdown AS BLOB))+length(CAST(title AS BLOB))+length(CAST(COALESCE(path,'') AS BLOB))+length(CAST(viewState AS BLOB))+256),0) FROM documents", [], |row| row.get(0))?;
        if total > MAX_SESSION_BYTES { return Err(StoreError::message("会话备份超过容量上限，请先保存并从页面列表移除部分笔记。")); }
        Ok(())
    }
    fn snapshot(&self) -> StoreResult<Snapshot> {
        let mut statement = self.conn.prepare("SELECT id,title,path,contentHash,savedHash,revision,conflict,viewState,position,shelved,substr(markdown,1,1200) AS preview FROM documents ORDER BY position,id")?;
        let documents = statement.query_map([], row_metadata)?.collect::<Result<Vec<_>, _>>()?;
        Ok(Snapshot { documents, active_id: self.active_id()?, undo_removal: self.last_removed.as_ref().map(|doc| doc.title.clone()), warning: String::new() })
    }
    fn read(&self, id: &str) -> StoreResult<DocumentRead> {
        self.conn.query_row("SELECT id,title,path,contentHash,savedHash,revision,conflict,viewState,position,shelved,substr(markdown,1,1200) AS preview,markdown FROM documents WHERE id=?1", params![id], |row| {
            Ok(DocumentRead { metadata: row_metadata(row)?, markdown: row.get("markdown")? })
        }).optional()?.ok_or_else(|| StoreError::message("笔记已经关闭。"))
    }
    fn create(&mut self, markdown: String, title: Option<String>) -> StoreResult<Snapshot> {
        validate_markdown(&markdown)?;
        let title = validate_title(title.as_deref().unwrap_or(DEFAULT_TITLE))?;
        let position: i64 = self.conn.query_row("SELECT COALESCE(MAX(position),-1)+1 FROM documents", [], |row| row.get(0))?;
        let id = Uuid::new_v4().to_string(); let hash = digest(&markdown);
        let active_id = self.active_id()?;
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("INSERT INTO documents(id,title,path,markdown,savedHash,contentHash,baseline,bom,eol,revision,conflict,viewState,position,size,shelved) VALUES (?1,?2,NULL,?3,?4,?4,NULL,0,'\n',0,0,'null',?5,0,0)", params![id,title,markdown,hash,position])?;
        tx.execute("UPDATE settings SET value=?1 WHERE key='activeId'", params![id])?; tx.commit()?; self.check_capacity()?; self.snapshot()
    }
    fn update(&mut self, id: &str, markdown: String, revision: i64) -> StoreResult<Snapshot> {
        validate_markdown(&markdown)?;
        let current: (i64,String) = self.conn.query_row("SELECT revision,contentHash FROM documents WHERE id=?1", params![id], |row| Ok((row.get(0)?,row.get(1)?))).optional()?.ok_or_else(|| StoreError::message("笔记已经关闭。"))?;
        if revision < current.0 { return self.snapshot(); }
        let hash = digest(&markdown);
        if revision == current.0 && hash != current.1 { return Err(StoreError::message("笔记版本冲突，请先重新读取当前内容。")); }
        let tx = self.conn.unchecked_transaction()?; tx.execute("UPDATE documents SET markdown=?1,contentHash=?2,revision=?3 WHERE id=?4", params![markdown,hash,revision,id])?; tx.commit()?; self.check_capacity()?; self.snapshot()
    }
    fn rename(&mut self, id: &str, title: String) -> StoreResult<Snapshot> {
        let title = validate_title(&title)?;
        let path: Option<String> = self.conn.query_row("SELECT path FROM documents WHERE id=?1", params![id], |row| row.get(0)).optional()?.flatten();
        if path.is_some() { return Err(StoreError::message("只能命名未关联文件的草稿。")); }
        if self.conn.execute("UPDATE documents SET title=?1 WHERE id=?2", params![title,id])? == 0 { return Err(StoreError::message("笔记已经关闭。")); }
        self.check_capacity()?; self.snapshot()
    }
    fn set_view_state(&mut self, id: &str, state: Value) -> StoreResult<Snapshot> {
        let encoded = view_state_json(state)?;
        if self.conn.execute("UPDATE documents SET viewState=?1 WHERE id=?2", params![encoded,id])? == 0 { return Err(StoreError::message("笔记已经关闭。")); }
        self.check_capacity()?; self.snapshot()
    }
    fn activate(&mut self, id: &str) -> StoreResult<Snapshot> {
        let tx = self.conn.unchecked_transaction()?;
        let shelved: Option<i64> = tx.query_row("SELECT shelved FROM documents WHERE id=?1", params![id], |row| row.get(0)).optional()?;
        let Some(shelved) = shelved else { return Err(StoreError::message("笔记已经关闭。")); };
        if shelved != 0 { tx.execute("UPDATE documents SET shelved=0 WHERE id=?1", params![id])?; }
        tx.execute("UPDATE settings SET value=?1 WHERE key='activeId'", params![id])?; tx.commit()?; self.snapshot()
    }
    fn shelve(&mut self, id: &str) -> StoreResult<Snapshot> {
        let active_id = self.active_id()?;
        let tx = self.conn.unchecked_transaction()?;
        let position: Option<i64> = tx.query_row("SELECT position FROM documents WHERE id=?1", params![id], |row| row.get(0)).optional()?;
        let Some(position) = position else { return Err(StoreError::message("笔记已经关闭。")); };
        tx.execute("UPDATE documents SET shelved=1 WHERE id=?1", params![id])?;
        if active_id.as_deref() == Some(id) {
            let next: Option<String> = tx.query_row("SELECT id FROM documents WHERE shelved=0 AND position>?1 ORDER BY position LIMIT 1", params![position], |row| row.get(0)).optional()?.or_else(|| tx.query_row("SELECT id FROM documents WHERE shelved=0 ORDER BY position DESC LIMIT 1", [], |row| row.get(0)).optional().ok().flatten());
            tx.execute("UPDATE settings SET value=?1 WHERE key='activeId'", params![next])?;
        }
        tx.commit()?; self.snapshot()
    }
    fn expand_all(&mut self) -> StoreResult<Snapshot> {
        let active_id = self.active_id()?;
        let tx = self.conn.unchecked_transaction()?; tx.execute("UPDATE documents SET shelved=0", [])?;
        if active_id.is_none() {
            let first: Option<String> = tx.query_row("SELECT id FROM documents ORDER BY position LIMIT 1", [], |row| row.get(0)).optional()?;
            tx.execute("UPDATE settings SET value=?1 WHERE key='activeId'", params![first])?;
        }
        tx.commit()?; self.snapshot()
    }
    fn remove(&mut self, id: &str) -> StoreResult<Snapshot> {
        let mut removed: RemovedDocument = self.conn.query_row("SELECT title,path,markdown,savedHash,contentHash,baseline,bom,eol,revision,conflict,viewState,position,shelved FROM documents WHERE id=?1", params![id], |row| Ok(RemovedDocument {
            title: row.get(0)?, path: row.get(1)?, markdown: row.get(2)?, saved_hash: row.get(3)?, content_hash: row.get(4)?, baseline: row.get(5)?, bom: row.get::<_,i64>(6)? != 0, eol: row.get(7)?, revision: row.get(8)?, conflict: row.get::<_,i64>(9)? != 0, view_state: row.get(10)?, position: row.get(11)?, shelved: row.get::<_,i64>(12)? != 0, was_active: false
        })).optional()?.ok_or_else(|| StoreError::message("笔记已经关闭。"))?;
        let active_id = self.active_id()?;
        removed.was_active = active_id.as_deref() == Some(id);
        let tx = self.conn.unchecked_transaction()?; tx.execute("DELETE FROM documents WHERE id=?1", params![id])?;
        if removed.was_active {
            let next: Option<String> = tx.query_row("SELECT id FROM documents WHERE shelved=0 AND position>=?1 ORDER BY position LIMIT 1", params![removed.position], |row| row.get(0)).optional()?.or_else(|| tx.query_row("SELECT id FROM documents WHERE shelved=0 ORDER BY position DESC LIMIT 1", [], |row| row.get(0)).optional().ok().flatten());
            tx.execute("UPDATE settings SET value=?1 WHERE key='activeId'", params![next])?;
        }
        tx.commit()?; self.last_removed = Some(removed); self.snapshot()
    }
    fn undo_remove(&mut self) -> StoreResult<Snapshot> {
        let Some(removed) = self.last_removed.take() else { return self.snapshot(); };
        let reopened = removed.path.as_ref().is_some_and(|path| self.conn.query_row("SELECT 1 FROM documents WHERE path=?1 LIMIT 1", params![path], |row| row.get::<_,i64>(0)).optional().ok().flatten().is_some());
        let id = Uuid::new_v4().to_string();
        let (title,path,baseline,saved_hash) = if reopened { (format!("{}（恢复的草稿）",removed.title),None,None,digest("")) } else { (removed.title.clone(),removed.path.clone(),removed.baseline.clone(),removed.saved_hash.clone()) };
        let active_id = self.active_id()?;
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("INSERT INTO documents(id,title,path,markdown,savedHash,contentHash,baseline,bom,eol,revision,conflict,viewState,position,size,shelved) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,0,?14)", params![id,title,path,removed.markdown,saved_hash,removed.content_hash,baseline,removed.bom as i64,removed.eol,removed.revision,removed.conflict as i64,removed.view_state.unwrap_or_else(||"null".into()),removed.position,removed.shelved as i64])?;
        if removed.was_active || active_id.is_none() { tx.execute("UPDATE settings SET value=?1 WHERE key='activeId'", params![id])?; }
        tx.commit()?; self.check_capacity()?; self.snapshot()
    }
    fn reorder(&mut self, ids: Vec<String>) -> StoreResult<Snapshot> {
        let existing: Vec<String> = self.conn.prepare("SELECT id FROM documents ORDER BY position")?.query_map([], |row| row.get(0))?.collect::<Result<_,_>>()?;
        if existing.len()!=ids.len() || existing.iter().any(|id| !ids.contains(id)) { return Err(StoreError::message("页面顺序已变化，请刷新后再排序。")); }
        let tx = self.conn.unchecked_transaction()?; for (position,id) in ids.iter().enumerate() { tx.execute("UPDATE documents SET position=?1 WHERE id=?2", params![position as i64,id])?; } tx.commit()?; self.snapshot()
    }
}
fn lock_store(state: &State<'_,AppState>) -> Result<std::sync::MutexGuard<'_,Store>,String> { state.store.lock().map_err(|_|"文档服务已停止。".into()) }
#[tauri::command] fn list_metadata(state: State<'_,AppState>) -> Result<Snapshot,String> { lock_store(&state)?.snapshot().map_err(|e|e.to_string()) }
#[tauri::command] fn read_document(id:String,state:State<'_,AppState>) -> Result<DocumentRead,String> { lock_store(&state)?.read(&id).map_err(|e|e.to_string()) }
#[tauri::command] fn create_document(markdown:Option<String>,title:Option<String>,state:State<'_,AppState>) -> Result<Snapshot,String> { lock_store(&state)?.create(markdown.unwrap_or_default(),title).map_err(|e|e.to_string()) }
#[tauri::command] fn update_document(id:String,markdown:String,revision:i64,state:State<'_,AppState>) -> Result<Snapshot,String> { lock_store(&state)?.update(&id,markdown,revision).map_err(|e|e.to_string()) }
#[tauri::command] fn rename_document(id:String,title:String,state:State<'_,AppState>) -> Result<Snapshot,String> { lock_store(&state)?.rename(&id,title).map_err(|e|e.to_string()) }
#[tauri::command] fn set_view_state(id:String,view_state:Value,state:State<'_,AppState>) -> Result<Snapshot,String> { lock_store(&state)?.set_view_state(&id,view_state).map_err(|e|e.to_string()) }
#[tauri::command] fn activate_document(id:String,state:State<'_,AppState>) -> Result<Snapshot,String> { lock_store(&state)?.activate(&id).map_err(|e|e.to_string()) }
#[tauri::command] fn shelve_document(id:String,state:State<'_,AppState>) -> Result<Snapshot,String> { lock_store(&state)?.shelve(&id).map_err(|e|e.to_string()) }
#[tauri::command] fn expand_all(state:State<'_,AppState>) -> Result<Snapshot,String> { lock_store(&state)?.expand_all().map_err(|e|e.to_string()) }
#[tauri::command] fn remove_document(id:String,state:State<'_,AppState>) -> Result<Snapshot,String> { lock_store(&state)?.remove(&id).map_err(|e|e.to_string()) }
#[tauri::command] fn undo_remove(state:State<'_,AppState>) -> Result<Snapshot,String> { lock_store(&state)?.undo_remove().map_err(|e|e.to_string()) }
#[tauri::command] fn reorder_documents(ids:Vec<String>,state:State<'_,AppState>) -> Result<Snapshot,String> { lock_store(&state)?.reorder(ids).map_err(|e|e.to_string()) }

pub fn run() {
    tauri::Builder::default().setup(|app| {
        let data_dir = app.path().app_data_dir().map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
        let store = Store::open(data_dir).map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
        app.manage(AppState { store: Mutex::new(store) }); Ok(())
    }).invoke_handler(tauri::generate_handler![list_metadata,read_document,create_document,update_document,rename_document,set_view_state,activate_document,shelve_document,expand_all,remove_document,undo_remove,reorder_documents]).run(tauri::generate_context!()).expect("error while running frowd");
}
