use rusqlite::{params, types::Type, Connection, OptionalExtension, Row};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};
use tempfile::NamedTempFile;
use thiserror::Error;
use uuid::Uuid;

const UNTITLED: &str = "未命名笔记";
const MAX_DOCUMENT_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_SESSION_BYTES: i64 = 100 * 1024 * 1024;
const META:&str="id,title,path,revision,position,shelved,conflict,viewState,contentHash,savedHash,substr(markdown,1,1200) AS preview";

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Sql(#[from] rusqlite::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}
type Result<T> = std::result::Result<T, StoreError>;
fn invalid(text: &str) -> StoreError {
    StoreError::Message(text.into())
}
pub fn digest(text: &str) -> String {
    hash_bytes(text.as_bytes())
}
fn hash_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Metadata {
    pub id: String,
    pub title: String,
    pub path: Option<String>,
    pub revision: i64,
    pub position: i64,
    pub shelved: bool,
    pub dirty: bool,
    pub conflict: bool,
    pub view_state: Value,
    pub preview: String,
}
#[derive(Debug, Clone, Serialize)]
pub struct Document {
    #[serde(flatten)]
    pub metadata: Metadata,
    pub markdown: String,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub documents: Vec<Metadata>,
    pub active_id: Option<String>,
    pub undo_removal: Option<String>,
    pub layout_revision: i64,
    pub warning: String,
}
#[derive(Debug, Clone)]
struct Stored {
    id: String,
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
    view_state: Value,
    position: i64,
    shelved: bool,
}
impl Stored {
    fn dirty(&self) -> bool {
        self.saved_hash != self.content_hash
    }
}
#[derive(Clone)]
struct Removed {
    doc: Stored,
    index: usize,
    was_active: bool,
}
/// One SQLite authority. A profile lock rejects concurrent processes.
pub struct Store {
    conn: Connection,
    max_bytes: i64,
    last_removed: Option<Removed>,
    _profile_lock: File,
    profile: PathBuf,
}

fn json_column(row: &Row<'_>, name: &str) -> rusqlite::Result<Value> {
    let raw: String = row.get(name)?;
    serde_json::from_str(&raw)
        .map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, Type::Text, Box::new(e)))
}
fn meta_row(r: &Row<'_>) -> rusqlite::Result<Metadata> {
    let content: String = r.get("contentHash")?;
    let saved: String = r.get("savedHash")?;
    Ok(Metadata {
        id: r.get("id")?,
        title: r.get("title")?,
        path: r.get("path")?,
        revision: r.get("revision")?,
        position: r.get("position")?,
        shelved: r.get("shelved")?,
        conflict: r.get("conflict")?,
        dirty: content != saved,
        view_state: json_column(r, "viewState")?,
        preview: r.get("preview")?,
    })
}
fn stored_row(r: &Row<'_>) -> rusqlite::Result<Stored> {
    Ok(Stored {
        id: r.get("id")?,
        title: r.get("title")?,
        path: r.get("path")?,
        markdown: r.get("markdown")?,
        saved_hash: r.get("savedHash")?,
        content_hash: r.get("contentHash")?,
        baseline: r.get("baseline")?,
        bom: r.get("bom")?,
        eol: r.get("eol")?,
        revision: r.get("revision")?,
        conflict: r.get("conflict")?,
        view_state: json_column(r, "viewState")?,
        position: r.get("position")?,
        shelved: r.get("shelved")?,
    })
}
fn active(c: &Connection) -> Result<Option<String>> {
    // Missing row and SQL NULL are separate cases.
    Ok(
        c.query_row("SELECT value FROM settings WHERE key='activeId'", [], |r| {
            r.get::<_, Option<String>>(0)
        })
        .optional()?
        .flatten(),
    )
}
fn set_active(c: &Connection, id: Option<&str>) -> Result<()> {
    c.execute(
        "UPDATE settings SET value=?1 WHERE key='activeId'",
        params![id],
    )?;
    Ok(())
}
fn ordered(c: &Connection) -> Result<Vec<String>> {
    Ok(c.prepare("SELECT id FROM documents ORDER BY position,id")?
        .query_map([], |r| r.get(0))?
        .collect::<std::result::Result<_, _>>()?)
}
fn bump(c: &Connection) -> Result<()> {
    c.execute("UPDATE settings SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT) WHERE key='layoutRevision'",[])?;
    Ok(())
}
fn capacity(c: &Connection, limit: i64) -> Result<()> {
    let total: i64 = c.query_row("SELECT COALESCE(SUM(size),0) FROM documents", [], |r| {
        r.get(0)
    })?;
    if total > limit {
        return Err(invalid(
            "会话备份超过容量上限，请保存并移除部分页面（仅收起不会释放容量）。",
        ));
    }
    Ok(())
}
fn insert(c: &Connection, d: &Stored) -> Result<()> {
    c.execute("INSERT INTO documents(id,title,path,markdown,savedHash,contentHash,baseline,bom,eol,revision,conflict,viewState,position,shelved) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
 params![d.id,d.title,d.path,d.markdown,d.saved_hash,d.content_hash,d.baseline,d.bom,d.eol,d.revision,d.conflict,serde_json::to_string(&d.view_state)?,d.position,d.shelved])?;
    Ok(())
}
fn valid_body(text: &str) -> Result<()> {
    if text.len() > MAX_DOCUMENT_BYTES || text.contains('\0') {
        return Err(invalid("首版支持 10 MB 以内的 UTF-8 文本。"));
    }
    Ok(())
}
fn valid_title(text: &str) -> Result<String> {
    if text.len() > 1024 {
        return Err(invalid("笔记名称无效或过长。"));
    }
    Ok(if text.trim().is_empty() {
        UNTITLED.into()
    } else {
        text.trim().into()
    })
}
fn valid_view(v: &Value) -> Result<()> {
    let o = v.as_object().ok_or_else(|| invalid("阅读状态无效。"))?;
    if o.keys().any(|k| {
        ![
            "mode",
            "scrollTop",
            "selection",
            "sourceSelection",
            "sourceScrollTop",
        ]
        .contains(&k.as_str())
    }) || !["rendered", "source"].contains(&o.get("mode").and_then(Value::as_str).unwrap_or(""))
    {
        return Err(invalid("阅读状态无效。"));
    }
    for key in ["scrollTop", "sourceScrollTop"] {
        match o.get(key) {
            Some(n)
                if n.as_f64().is_some_and(|x| {
                    x.is_finite() && (0.0..=9_007_199_254_740_991.0).contains(&x)
                }) =>
            {
                ()
            }
            None if key == "sourceScrollTop" => (),
            _ => return Err(invalid("阅读状态无效。")),
        }
    }
    for (key, names) in [
        ("selection", ["anchor", "head"]),
        ("sourceSelection", ["start", "end"]),
    ] {
        if let Some(s) = o.get(key) {
            let fields = s.as_object().ok_or_else(|| invalid("阅读状态无效。"))?;
            if fields.len() != 2
                || names.iter().any(|n| {
                    !fields
                        .get(*n)
                        .and_then(Value::as_u64)
                        .is_some_and(|x| x <= 9_007_199_254_740_991)
                })
            {
                return Err(invalid("阅读状态无效。"));
            }
        }
    }
    Ok(())
}
fn canonical(path: &Path) -> Result<PathBuf> {
    if path.exists() {
        return Ok(fs::canonicalize(path)?);
    }
    Ok(
        fs::canonicalize(path.parent().ok_or_else(|| invalid("文件路径无效。"))?)?
            .join(path.file_name().ok_or_else(|| invalid("文件路径无效。"))?),
    )
}
fn path_key(path: &str) -> String {
    if cfg!(windows) {
        path.to_lowercase()
    } else {
        path.into()
    }
}
fn file_body(path: &Path) -> Result<(Vec<u8>, String, bool, String)> {
    let info = fs::metadata(path)?;
    if !info.is_file() || info.len() > MAX_DOCUMENT_BYTES as u64 {
        return Err(invalid("首版支持 10 MB 以内的文本文件。"));
    }
    let bytes = fs::read(path)?;
    if bytes.len() > MAX_DOCUMENT_BYTES {
        return Err(invalid("文件超过 10 MB。"));
    }
    let bom = bytes.starts_with(&[239, 187, 191]);
    let slice = if bom { &bytes[3..] } else { &bytes[..] };
    let text = std::str::from_utf8(slice)
        .map_err(|_| invalid("文件不是 UTF-8 编码。请先以 UTF-8 保存再打开。"))?;
    let eol = if text.contains("\r\n") { "\r\n" } else { "\n" }.to_owned();
    let body = text.replace("\r\n", "\n").replace('\r', "\n");
    valid_body(&body)?;
    Ok((bytes, body, bom, eol))
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut temp = NamedTempFile::new_in(path.parent().ok_or_else(|| invalid("文件路径无效。"))?)?;
    temp.write_all(bytes)?;
    temp.as_file().sync_all()?;
    temp.persist(path).map_err(|e| StoreError::Io(e.error))?;
    Ok(())
}
impl Store {
    pub fn open(directory: &Path, max_bytes: i64) -> Result<Self> {
        fs::create_dir_all(directory)?;
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(directory.join("profile.lock"))?;
        lock.try_lock()
            .map_err(|_| invalid("此数据目录已由另一个应用实例打开。"))?;
        let conn = Connection::open(directory.join("drafts.sqlite"))?;
        conn.execute_batch(
            "PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",
        )?;
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch("CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);
CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,title TEXT NOT NULL,path TEXT,markdown TEXT NOT NULL,savedHash TEXT NOT NULL,contentHash TEXT NOT NULL DEFAULT '',baseline TEXT,bom INTEGER NOT NULL,eol TEXT NOT NULL,revision INTEGER NOT NULL,conflict INTEGER NOT NULL,viewState TEXT NOT NULL,position INTEGER NOT NULL,size INTEGER NOT NULL DEFAULT 0,shelved INTEGER NOT NULL DEFAULT 0);")?;
        let version: Option<String> = tx
            .query_row("SELECT value FROM settings WHERE key='version'", [], |r| {
                r.get::<_, Option<String>>(0)
            })
            .optional()?
            .flatten();
        if version
            .as_deref()
            .is_some_and(|v| !["1", "2", "3"].contains(&v))
        {
            return Err(invalid("备份版本超出当前支持范围，原数据库已保留。"));
        }
        let columns = tx
            .prepare("PRAGMA table_info(documents)")?
            .query_map([], |r| r.get::<_, String>(1))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        for (name, sql) in [
            (
                "contentHash",
                "ALTER TABLE documents ADD COLUMN contentHash TEXT NOT NULL DEFAULT ''",
            ),
            (
                "shelved",
                "ALTER TABLE documents ADD COLUMN shelved INTEGER NOT NULL DEFAULT 0",
            ),
            (
                "size",
                "ALTER TABLE documents ADD COLUMN size INTEGER NOT NULL DEFAULT 0",
            ),
        ] {
            if !columns.iter().any(|c| c == name) {
                tx.execute_batch(sql)?;
            }
        }
        let missing = tx
            .prepare("SELECT id,markdown FROM documents WHERE contentHash=''")?
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        for (id, body) in missing {
            tx.execute(
                "UPDATE documents SET contentHash=?1 WHERE id=?2",
                params![digest(&body), id],
            )?;
        }
        tx.execute_batch("CREATE TRIGGER IF NOT EXISTS document_insert_size AFTER INSERT ON documents BEGIN UPDATE documents SET size=length(CAST(NEW.markdown AS BLOB))+length(CAST(NEW.title AS BLOB))+length(CAST(COALESCE(NEW.path,'') AS BLOB))+length(CAST(NEW.viewState AS BLOB))+256 WHERE id=NEW.id; END;
CREATE TRIGGER IF NOT EXISTS document_update_size AFTER UPDATE OF markdown,title,path,viewState ON documents BEGIN UPDATE documents SET size=length(CAST(NEW.markdown AS BLOB))+length(CAST(NEW.title AS BLOB))+length(CAST(COALESCE(NEW.path,'') AS BLOB))+length(CAST(NEW.viewState AS BLOB))+256 WHERE id=NEW.id; END;")?;
        tx.execute("UPDATE documents SET size=length(CAST(markdown AS BLOB))+length(CAST(title AS BLOB))+length(CAST(COALESCE(path,'') AS BLOB))+length(CAST(viewState AS BLOB))+256",[])?;
        tx.execute("INSERT INTO settings(key,value) VALUES('version','3') ON CONFLICT(key) DO UPDATE SET value='3'",[])?;
        tx.execute("INSERT OR IGNORE INTO settings(key,value) VALUES('activeId',NULL),('layoutRevision','0')",[])?;
        if let Some(id) = active(&tx)? {
            let valid: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM documents WHERE id=?1 AND shelved=0)",
                params![id],
                |r| r.get(0),
            )?;
            if !valid {
                let first: Option<String> = tx
                    .query_row(
                        "SELECT id FROM documents WHERE shelved=0 ORDER BY position,id LIMIT 1",
                        [],
                        |r| r.get(0),
                    )
                    .optional()?;
                set_active(&tx, first.as_deref())?;
            }
        }
        assets::schema(&tx)?;
        capacity(&tx, max_bytes)?;
        tx.commit()?;
        Ok(Self {
            conn,
            max_bytes,
            last_removed: None,
            _profile_lock: lock,
            profile: fs::canonicalize(directory)?,
        })
    }
    fn ensure_exists(&self, id: &str) -> Result<()> {
        let found: bool = self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM documents WHERE id=?1)",
            params![id],
            |r| r.get(0),
        )?;
        if !found {
            return Err(invalid("笔记已经移除。"));
        }
        Ok(())
    }
    fn read_stored(&self, id: &str) -> Result<Stored> {
        self.conn
            .query_row(
                "SELECT * FROM documents WHERE id=?1",
                params![id],
                stored_row,
            )
            .optional()?
            .ok_or_else(|| invalid("笔记已经移除。"))
    }
    pub fn snapshot(&self) -> Result<Snapshot> {
        let sql = format!("SELECT {} FROM documents ORDER BY position,id", META);
        let documents = self
            .conn
            .prepare(&sql)?
            .query_map([], meta_row)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let layout_revision = self.conn.query_row(
            "SELECT CAST(value AS INTEGER) FROM settings WHERE key='layoutRevision'",
            [],
            |r| r.get(0),
        )?;
        Ok(Snapshot {
            documents,
            active_id: active(&self.conn)?,
            undo_removal: self.last_removed.as_ref().map(|r| r.doc.title.clone()),
            layout_revision,
            warning: String::new(),
        })
    }
    pub fn read(&mut self, id: &str) -> Result<Document> {
        self.check_external(id)?;
        let sql = format!("SELECT {},markdown FROM documents WHERE id=?1", META);
        Ok(self.conn.query_row(&sql, params![id], |r| {
            Ok(Document {
                metadata: meta_row(r)?,
                markdown: r.get("markdown")?,
            })
        })?)
    }
    pub fn create(&mut self, body: &str, name: &str) -> Result<Snapshot> {
        valid_body(body)?;
        let position = self.conn.query_row(
            "SELECT COALESCE(MAX(position),-1)+1 FROM documents",
            [],
            |r| r.get(0),
        )?;
        let doc = Stored {
            id: Uuid::new_v4().to_string(),
            title: valid_title(name)?,
            path: None,
            markdown: body.into(),
            saved_hash: digest(""),
            content_hash: digest(body),
            baseline: None,
            bom: false,
            eol: "\n".into(),
            revision: 0,
            conflict: false,
            view_state: Value::Null,
            position,
            shelved: false,
        };
        let tx = self.conn.unchecked_transaction()?;
        insert(&tx, &doc)?;
        set_active(&tx, Some(&doc.id))?;
        bump(&tx)?;
        capacity(&tx, self.max_bytes)?;
        tx.commit()?;
        self.snapshot()
    }
    pub fn update(&mut self, id: &str, body: &str, revision: i64) -> Result<Snapshot> {
        valid_body(body)?;
        let doc = self.read_stored(id)?;
        let hash = digest(body);
        if revision < doc.revision || revision < 0 {
            return Err(invalid("笔记版本已过期。"));
        }
        if revision == doc.revision {
            if hash != doc.content_hash {
                return Err(invalid("笔记版本冲突，请保留当前内容。"));
            }
            return self.snapshot();
        }
        if revision != doc.revision + 1 {
            return Err(invalid("笔记版本不连续，请重新读取元数据。"));
        }
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE documents SET markdown=?1,contentHash=?2,revision=?3 WHERE id=?4",
            params![body, hash, revision, id],
        )?;
        capacity(&tx, self.max_bytes)?;
        tx.commit()?;
        self.snapshot()
    }
    pub fn rename(&mut self, id: &str, name: &str) -> Result<Snapshot> {
        if self
            .conn
            .query_row("SELECT path FROM documents WHERE id=?1", params![id], |r| {
                r.get::<_, Option<String>>(0)
            })
            .optional()?
            .ok_or_else(|| invalid("笔记已经移除。"))?
            .is_some()
        {
            return Err(invalid("只能命名未关联文件的草稿。"));
        }
        let name = valid_title(name)?;
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE documents SET title=?1 WHERE id=?2",
            params![name, id],
        )?;
        capacity(&tx, self.max_bytes)?;
        tx.commit()?;
        self.snapshot()
    }
    pub fn set_view(&mut self, id: &str, view: Value) -> Result<Snapshot> {
        valid_view(&view)?;
        let tx = self.conn.unchecked_transaction()?;
        if tx.execute(
            "UPDATE documents SET viewState=?1 WHERE id=?2",
            params![serde_json::to_string(&view)?, id],
        )? == 0
        {
            return Err(invalid("笔记已经移除。"));
        }
        capacity(&tx, self.max_bytes)?;
        tx.commit()?;
        self.snapshot()
    }
    pub fn activate(&mut self, id: &str) -> Result<Snapshot> {
        self.ensure_exists(id)?;
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("UPDATE documents SET shelved=0 WHERE id=?1", params![id])?;
        set_active(&tx, Some(id))?;
        bump(&tx)?;
        tx.commit()?;
        self.snapshot()
    }
    pub fn shelve(&mut self, id: &str) -> Result<Snapshot> {
        let position: i64 = self
            .conn
            .query_row(
                "SELECT position FROM documents WHERE id=?1",
                params![id],
                |r| r.get(0),
            )
            .optional()?
            .ok_or_else(|| invalid("笔记已经移除。"))?;
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("UPDATE documents SET shelved=1 WHERE id=?1", params![id])?;
        if active(&tx)?.as_deref() == Some(id) {
            let next:Option<String>=tx.query_row("SELECT id FROM documents WHERE shelved=0 AND position>?1 ORDER BY position,id LIMIT 1",params![position],|r|r.get(0)).optional()?;
            let fallback: Option<String> = tx
                .query_row(
                    "SELECT id FROM documents WHERE shelved=0 ORDER BY position DESC,id LIMIT 1",
                    [],
                    |r| r.get(0),
                )
                .optional()?;
            set_active(&tx, next.or(fallback).as_deref())?;
        }
        bump(&tx)?;
        tx.commit()?;
        self.snapshot()
    }
    pub fn expand_all(&mut self) -> Result<Snapshot> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("UPDATE documents SET shelved=0", [])?;
        if active(&tx)?.is_none() {
            let first: Option<String> = tx
                .query_row(
                    "SELECT id FROM documents ORDER BY position,id LIMIT 1",
                    [],
                    |r| r.get(0),
                )
                .optional()?;
            set_active(&tx, first.as_deref())?;
        }
        bump(&tx)?;
        tx.commit()?;
        self.snapshot()
    }
    pub fn shelve_others(&mut self, id: &str) -> Result<Snapshot> {
        self.ensure_exists(id)?;
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("UPDATE documents SET shelved=(id<>?1)", params![id])?;
        set_active(&tx, Some(id))?;
        bump(&tx)?;
        tx.commit()?;
        self.snapshot()
    }
    pub fn shelve_all(&mut self) -> Result<Snapshot> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("UPDATE documents SET shelved=1", [])?;
        set_active(&tx, None)?;
        bump(&tx)?;
        tx.commit()?;
        self.snapshot()
    }
    pub fn reorder_visible(&mut self, ids: &[String], expected: i64) -> Result<Snapshot> {
        let snap = self.snapshot()?;
        let visible: Vec<_> = snap
            .documents
            .iter()
            .filter(|d| !d.shelved)
            .map(|d| d.id.clone())
            .collect();
        let mut seen = std::collections::HashSet::new();
        if expected != snap.layout_revision
            || ids.len() != visible.len()
            || ids
                .iter()
                .any(|id| !visible.contains(id) || !seen.insert(id))
        {
            return Err(invalid("页面布局已变化，请刷新后再排序。"));
        }
        let tx = self.conn.unchecked_transaction()?;
        let mut next = ids.iter();
        for (position, doc) in snap.documents.iter().enumerate() {
            let id = if doc.shelved {
                &doc.id
            } else {
                next.next().ok_or_else(|| invalid("页面顺序无效。"))?
            };
            tx.execute(
                "UPDATE documents SET position=?1 WHERE id=?2",
                params![position as i64, id],
            )?;
        }
        bump(&tx)?;
        tx.commit()?;
        self.snapshot()
    }
    pub fn remove(&mut self, id: &str, decision: &str) -> Result<Snapshot> {
        if decision == "cancel" {
            return self.snapshot();
        }
        let doc = self.read_stored(id)?;
        if !["discard", "saved"].contains(&decision) {
            return Err(invalid("请选择保存、删除或取消。"));
        }
        if decision == "saved" && (doc.path.is_none() || doc.dirty()) {
            return Err(invalid("保存尚未完成，页面继续保留。"));
        }
        let ids = ordered(&self.conn)?;
        let index = ids
            .iter()
            .position(|x| x == id)
            .ok_or_else(|| invalid("笔记已经移除。"))?;
        let was_active = active(&self.conn)?.as_deref() == Some(id);
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("DELETE FROM documents WHERE id=?1", params![id])?;
        if was_active {
            let next:Option<String>=tx.query_row("SELECT id FROM documents WHERE shelved=0 AND position>=?1 ORDER BY position,id LIMIT 1",params![doc.position],|r|r.get(0)).optional()?;
            let fallback: Option<String> = tx
                .query_row(
                    "SELECT id FROM documents WHERE shelved=0 ORDER BY position DESC,id LIMIT 1",
                    [],
                    |r| r.get(0),
                )
                .optional()?;
            set_active(&tx, next.or(fallback).as_deref())?;
        }
        bump(&tx)?;
        tx.commit()?;
        self.last_removed = Some(Removed {
            doc,
            index,
            was_active,
        });
        self.snapshot()
    }
    pub fn undo_remove(&mut self) -> Result<Snapshot> {
        // A rejected transaction must leave the undo record available.
        let Some(removed) = self.last_removed.clone() else {
            return self.snapshot();
        };
        let old_id = removed.doc.id.clone();
        let mut doc = removed.doc;
        doc.id = Uuid::new_v4().to_string();
        if let Some(path) = doc.path.as_ref() {
            if self.snapshot()?.documents.iter().any(|d| {
                d.path
                    .as_ref()
                    .is_some_and(|p| path_key(p) == path_key(path))
            }) {
                doc.path = None;
                doc.title = format!("{}（恢复的草稿）", doc.title);
                doc.saved_hash = digest("");
                doc.baseline = None;
                doc.conflict = false;
            }
        }
        let mut ids = ordered(&self.conn)?;
        ids.insert(removed.index.min(ids.len()), doc.id.clone());
        let tx = self.conn.unchecked_transaction()?;
        insert(&tx, &doc)?;
        tx.execute("INSERT OR IGNORE INTO resource_bindings(docId,hash) SELECT ?1,hash FROM resource_bindings WHERE docId=?2",params![doc.id,old_id])?;
        for (position, id) in ids.iter().enumerate() {
            tx.execute(
                "UPDATE documents SET position=?1 WHERE id=?2",
                params![position as i64, id],
            )?;
        }
        if !doc.shelved && (removed.was_active || active(&tx)?.is_none()) {
            set_active(&tx, Some(&doc.id))?;
        }
        bump(&tx)?;
        capacity(&tx, self.max_bytes)?;
        tx.commit()?;
        self.last_removed = None;
        self.snapshot()
    }
    pub fn open_file(&mut self, path: &Path) -> Result<Snapshot> {
        let path = canonical(path)?;
        let text = path.to_string_lossy().into_owned();
        if let Some(id) = self
            .snapshot()?
            .documents
            .iter()
            .find(|d| {
                d.path
                    .as_ref()
                    .is_some_and(|p| path_key(p) == path_key(&text))
            })
            .map(|d| d.id.clone())
        {
            return self.activate(&id);
        }
        let (bytes, body, bom, eol) = file_body(&path)?;
        let hash = digest(&body);
        let position = self.conn.query_row(
            "SELECT COALESCE(MAX(position),-1)+1 FROM documents",
            [],
            |r| r.get(0),
        )?;
        let doc = Stored {
            id: Uuid::new_v4().to_string(),
            title: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            path: Some(text),
            markdown: body,
            saved_hash: hash.clone(),
            content_hash: hash,
            baseline: Some(hash_bytes(&bytes)),
            bom,
            eol,
            revision: 0,
            conflict: false,
            view_state: Value::Null,
            position,
            shelved: false,
        };
        let tx = self.conn.unchecked_transaction()?;
        insert(&tx, &doc)?;
        set_active(&tx, Some(&doc.id))?;
        bump(&tx)?;
        capacity(&tx, self.max_bytes)?;
        tx.commit()?;
        self.snapshot()
    }
    fn check_external(&mut self, id: &str) -> Result<()> {
        let doc = self.read_stored(id)?;
        let Some(path) = doc.path.as_ref() else {
            return Ok(());
        };
        match file_body(Path::new(path)) {
            Ok((bytes, body, bom, eol))
                if doc.baseline.as_deref() != Some(&hash_bytes(&bytes)) && !doc.dirty() =>
            {
                let hash = digest(&body);
                let tx = self.conn.unchecked_transaction()?;
                tx.execute("UPDATE documents SET markdown=?1,contentHash=?2,savedHash=?2,baseline=?3,bom=?4,eol=?5,revision=revision+1,conflict=0 WHERE id=?6",params![body,hash,hash_bytes(&bytes),bom,eol,id])?;
                capacity(&tx, self.max_bytes)?;
                tx.commit()?;
            }
            Ok((bytes, _, _, _)) => {
                let conflict = doc.baseline.as_deref() != Some(&hash_bytes(&bytes));
                self.conn.execute(
                    "UPDATE documents SET conflict=?1 WHERE id=?2",
                    params![conflict, id],
                )?;
            }
            Err(_) => {
                self.conn
                    .execute("UPDATE documents SET conflict=1 WHERE id=?1", params![id])?;
            }
        }
        Ok(())
    }
    pub fn save_file(&mut self, id: &str, target: Option<&Path>) -> Result<Snapshot> {
        self.check_external(id)?;
        let doc = self.read_stored(id)?;
        let chosen = target
            .map(PathBuf::from)
            .or_else(|| doc.path.as_ref().map(PathBuf::from))
            .ok_or_else(|| invalid("请先选择保存位置。"))?;
        let path = canonical(&chosen)?;
        let path_text = path.to_string_lossy().into_owned();
        if self.snapshot()?.documents.iter().any(|d| {
            d.id != id
                && d.path
                    .as_ref()
                    .is_some_and(|p| path_key(p) == path_key(&path_text))
        }) {
            return Err(invalid("该文件已在另一个页面打开。"));
        }
        let same = doc
            .path
            .as_ref()
            .is_some_and(|p| path_key(p) == path_key(&path_text));
        if same && doc.conflict {
            return Err(invalid("磁盘文件已被修改或删除，请另存当前内容。"));
        }
        self.materialize_resources(id, &doc, &path, !same)?;
        if same && !doc.dirty() {
            return self.snapshot();
        }
        let body = doc
            .markdown
            .replace("\r\n", "\n")
            .replace('\r', "\n")
            .replace('\n', &doc.eol);
        let mut bytes = Vec::new();
        if doc.bom {
            bytes.extend([239, 187, 191]);
        }
        bytes.extend(body.as_bytes());
        if bytes.len() > MAX_DOCUMENT_BYTES {
            return Err(invalid("保存后文件超过 10 MB，原文件未修改。"));
        }
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("UPDATE documents SET path=?1,title=?2,baseline=?3,savedHash=contentHash,conflict=0 WHERE id=?4",params![path_text,path.file_name().unwrap_or_default().to_string_lossy(),hash_bytes(&bytes),id])?;
        capacity(&tx, self.max_bytes)?;
        atomic_write(&path, &bytes)?;
        tx.commit().map_err(|e| {
            StoreError::Message(format!(
                "文件已保存至 {}，但草稿关联提交失败；页面继续保留，请重试：{}",
                path.display(),
                e
            ))
        })?;
        self.snapshot()
    }
    /// Search the SQLite drafts, never disk or activated editor sessions.
    /// At most 100 matching pages; one first-body occurrence or a title-only hit per page.
    pub fn search(&self, query: &str) -> Result<Vec<search::SearchHit>> {
        let query = query.trim();
        if query.chars().count() > 256 {
            return Err(invalid("搜索词最多 256 个字符。"));
        }
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let mut statement = self.conn.prepare(
            "SELECT id,title,markdown,revision,shelved FROM documents ORDER BY position,id",
        )?;
        let rows = statement.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, bool>(4)?,
            ))
        })?;
        let mut results = Vec::new();
        for row in rows {
            let (id, title, markdown, revision, shelved) = row?;
            if let Some(hit) = search::hit(id, title, &markdown, revision, shelved, query) {
                results.push(hit);
                if results.len() == 100 {
                    break;
                }
            }
        }
        Ok(results)
    }
    pub fn checkpoint(&self) -> Result<()> {
        self.conn.execute_batch("PRAGMA wal_checkpoint(FULL);")?;
        Ok(())
    }
}
#[cfg(test)]
#[path = "document_tests.rs"]
mod tests;

#[path = "filename.rs"]
pub mod filename;

#[path = "search.rs"]
pub mod search;

#[path = "assets.rs"]
mod assets;
pub use assets::{
    ResourceInfo, ResourceInput, ResourceReference, MAX_ATTACHMENT_BYTES, MAX_IMPORT_BYTES,
};
