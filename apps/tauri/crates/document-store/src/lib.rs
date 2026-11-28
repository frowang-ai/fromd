use rusqlite::{params, types::Type, Connection, OptionalExtension, Row};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    borrow::Cow,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tempfile::NamedTempFile;
use thiserror::Error;
use uuid::Uuid;

const UNTITLED: &str = "未命名笔记";
const MAX_DOCUMENT_BYTES: usize = 64 * 1024 * 1024;
const RESIDENT_BODY_BYTES: usize = 256 * 1024;
pub const MAX_SESSION_BYTES: i64 = 256 * 1024 * 1024;
const LEGACY_RECLAIM_BYTES: i64 = 32 * 1024 * 1024;
const META: &str = "id,title,path,revision,position,shelved,conflict,viewState,contentHash,savedHash,preview,bodyInDb";

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
    pub body_in_db: bool,
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
    body_in_db: bool,
    preview: String,
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
        body_in_db: r.get("bodyInDb")?,
    })
}
fn stored_row(r: &Row<'_>) -> rusqlite::Result<Stored> {
    Ok(Stored {
        id: r.get("id")?,
        title: r.get("title")?,
        path: r.get("path")?,
        markdown: r.get("markdown")?,
        body_in_db: r.get("bodyInDb")?,
        preview: r.get("preview")?,
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
            "会话备份超过容量上限，请保存大文稿或移除部分页面。",
        ));
    }
    Ok(())
}
fn insert(c: &Connection, d: &Stored) -> Result<()> {
    c.execute("INSERT INTO documents(id,title,path,markdown,savedHash,contentHash,baseline,bom,eol,revision,conflict,viewState,position,shelved,bodyInDb,preview) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
 params![d.id,d.title,d.path,d.markdown,d.saved_hash,d.content_hash,d.baseline,d.bom,d.eol,d.revision,d.conflict,serde_json::to_string(&d.view_state)?,d.position,d.shelved,d.body_in_db,if d.body_in_db { preview(&d.markdown) } else { &d.preview }])?;
    Ok(())
}
fn preview(body: &str) -> &str {
    body.char_indices()
        .nth(1200)
        .map_or(body, |(end, _)| &body[..end])
}
fn valid_body(text: &str) -> Result<()> {
    if text.len() > MAX_DOCUMENT_BYTES || text.contains('\0') {
        return Err(invalid("支持 64 MiB 以内的 UTF-8 文本。"));
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
fn is_markdown_file(path: &Path) -> bool {
    path.extension().and_then(|ext| ext.to_str()).is_some_and(|ext| {
        ext.eq_ignore_ascii_case("md") || ext.eq_ignore_ascii_case("markdown")
    })
}
fn file_bytes(path: &Path, limit: usize) -> Result<Vec<u8>> {
    let info = fs::metadata(path)?;
    if !info.is_file() || info.len() > limit as u64 {
        return Err(invalid("文件不可读取或超过文稿容量上限。"));
    }
    assets::bounded_read(path, limit)
}
fn decode_body(bytes: &[u8]) -> Result<(String, bool, String)> {
    let bom = bytes.starts_with(&[239, 187, 191]);
    let slice = if bom { &bytes[3..] } else { &bytes[..] };
    let text = std::str::from_utf8(slice)
        .map_err(|_| invalid("文件不是 UTF-8 编码。请先以 UTF-8 保存再打开。"))?;
    let eol = if text.contains("\r\n") { "\r\n" } else { "\n" }.to_owned();
    let body = if text.contains('\r') {
        text.replace("\r\n", "\n").replace('\r', "\n")
    } else {
        text.to_owned()
    };
    valid_body(&body)?;
    Ok((body, bom, eol))
}
fn file_body(path: &Path) -> Result<(Vec<u8>, String, bool, String)> {
    let bytes = file_bytes(path, MAX_DOCUMENT_BYTES)?;
    let (body, bom, eol) = decode_body(&bytes)?;
    Ok((bytes, body, bom, eol))
}
fn encoded_body(doc: &Stored) -> Result<Cow<'_, [u8]>> {
    let text = &doc.markdown;
    if !doc.bom && doc.eol == "\n" && !text.contains('\r') {
        return Ok(Cow::Borrowed(text.as_bytes()));
    }
    let mut bytes = Vec::new();
    if doc.bom {
        bytes.extend([239, 187, 191]);
    }
    let mut start = 0;
    while let Some(offset) = text[start..].find(['\r', '\n']) {
        let end = start + offset;
        bytes.extend(&text.as_bytes()[start..end]);
        bytes.extend(doc.eol.as_bytes());
        start = end
            + if text.as_bytes()[end..].starts_with(b"\r\n") {
                2
            } else {
                1
            };
        if bytes.len() > MAX_DOCUMENT_BYTES {
            return Err(invalid("保存后文件超过 64 MiB，原文件未修改。"));
        }
    }
    if bytes.len() + text.len() - start > MAX_DOCUMENT_BYTES {
        return Err(invalid("保存后文件超过 64 MiB，原文件未修改。"));
    }
    bytes.extend(&text.as_bytes()[start..]);
    Ok(Cow::Owned(bytes))
}
pub fn check_bound_path(path: &Path) -> Result<()> {
    if path_key(&fs::canonicalize(path)?.to_string_lossy()) != path_key(&path.to_string_lossy()) {
        return Err(invalid("原文件路径已变化。"));
    }
    Ok(())
}
fn same_file_bytes(path: &Path, limit: usize) -> Result<Vec<u8>> {
    check_bound_path(path)?;
    file_bytes(path, limit)
}
fn same_file_hash(path: &Path) -> Result<String> {
    check_bound_path(path)?;
    let file = File::open(path)?;
    let before = file.metadata()?;
    let limit = MAX_DOCUMENT_BYTES as u64;
    if !before.is_file() || before.len() > limit {
        return Err(invalid("文件不可读取或超过文稿容量上限。"));
    }
    let mut hasher = Sha256::new();
    let size = std::io::copy(&mut file.take(limit + 1), &mut hasher)?;
    let after = fs::symlink_metadata(path)?;
    if !after.is_file()
        || size != before.len()
        || after.len() != size
        || before.modified()? != after.modified()?
    {
        return Err(invalid("核对期间原文件已变化。"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if before.dev() != after.dev()
            || before.ino() != after.ino()
            || before.ctime() != after.ctime()
            || before.ctime_nsec() != after.ctime_nsec()
        {
            return Err(invalid("核对期间原文件已替换或修改。"));
        }
    }
    Ok(format!("{:x}", hasher.finalize()))
}
fn atomic_write(path: &Path, bytes: &[u8], expected_hash: Option<&str>) -> Result<bool> {
    let mut temp = NamedTempFile::new_in(path.parent().ok_or_else(|| invalid("文件路径无效。"))?)?;
    temp.write_all(bytes)?;
    #[cfg(unix)]
    match fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => {
            temp.as_file().set_permissions(metadata.permissions())?
        }
        Ok(_) => (),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
        Err(error) => return Err(error.into()),
    }
    temp.as_file().sync_all()?;
    if expected_hash.is_some_and(|expected| same_file_hash(path).ok().as_deref() != Some(expected))
    {
        return Ok(false);
    }
    temp.persist(path).map_err(|e| StoreError::Io(e.error))?;
    Ok(true)
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
        let database = directory.join("drafts.sqlite");
        let new_database = !database.exists();
        let conn = Connection::open(database)?;
        if new_database {
            // SQLite can enable the pointer map before the first table is created.
            conn.pragma_update(None, "auto_vacuum", "FULL")?;
        }
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
            .is_some_and(|v| !["1", "2", "3", "4"].contains(&v))
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
            (
                "bodyInDb",
                "ALTER TABLE documents ADD COLUMN bodyInDb INTEGER NOT NULL DEFAULT 1",
            ),
            (
                "preview",
                "ALTER TABLE documents ADD COLUMN preview TEXT NOT NULL DEFAULT ''",
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
        if version.as_deref() != Some("4") {
            // Retain migrated bodies until the file is actually checked on read.
            tx.execute_batch("DROP TRIGGER IF EXISTS document_insert_size;
DROP TRIGGER IF EXISTS document_update_size;
UPDATE documents SET preview=substr(markdown,1,1200),size=
  length(CAST(markdown AS BLOB))+length(CAST(title AS BLOB))+length(CAST(COALESCE(path,'') AS BLOB))+length(CAST(viewState AS BLOB))+256;
CREATE TRIGGER document_insert_size AFTER INSERT ON documents BEGIN
  UPDATE documents SET size=CASE WHEN NEW.bodyInDb THEN length(CAST(NEW.markdown AS BLOB)) ELSE 0 END
    +length(CAST(NEW.title AS BLOB))+length(CAST(COALESCE(NEW.path,'') AS BLOB))+length(CAST(NEW.viewState AS BLOB))+256 WHERE id=NEW.id;
END;
CREATE TRIGGER document_update_size AFTER UPDATE OF markdown,bodyInDb,title,path,viewState ON documents BEGIN
  UPDATE documents SET size=CASE WHEN NEW.bodyInDb THEN length(CAST(NEW.markdown AS BLOB)) ELSE 0 END
    +length(CAST(NEW.title AS BLOB))+length(CAST(COALESCE(NEW.path,'') AS BLOB))+length(CAST(NEW.viewState AS BLOB))+256 WHERE id=NEW.id;
END;
INSERT INTO settings(key,value) VALUES('version','4') ON CONFLICT(key) DO UPDATE SET value='4';")?;
        }
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
        let doc = self.refresh_file(id)?;
        let sql = format!("SELECT {META} FROM documents WHERE id=?1");
        let metadata = self.conn.query_row(&sql, params![id], meta_row)?;
        Ok(Document {
            metadata,
            markdown: doc.markdown,
        })
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
            body_in_db: true,
            preview: String::new(),
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
        let (current, content_hash): (i64, String) = self
            .conn
            .query_row(
                "SELECT revision,contentHash FROM documents WHERE id=?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?
            .ok_or_else(|| invalid("笔记已经移除。"))?;
        let hash = digest(body);
        if revision < current || revision < 0 {
            return Err(invalid("笔记版本已过期。"));
        }
        if revision == current {
            if hash != content_hash {
                return Err(invalid("笔记版本冲突，请保留当前内容。"));
            }
            return self.snapshot();
        }
        if revision != current + 1 {
            return Err(invalid("笔记版本不连续，请重新读取元数据。"));
        }
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE documents SET markdown=?1,contentHash=?2,revision=?3,bodyInDb=1,preview=?4 WHERE id=?5",
            params![body, hash, revision, preview(body), id],
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
        if decision == "saved" && (doc.path.is_none() || doc.dirty() || doc.conflict) {
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
            if let Some(existing) = self.snapshot()?.documents.into_iter().find(|d| {
                d.path
                    .as_ref()
                    .is_some_and(|p| path_key(p) == path_key(path))
            }) {
                if !doc.body_in_db {
                    let snapshot = self.activate(&existing.id)?;
                    self.last_removed = None;
                    return Ok(Snapshot {
                        undo_removal: None,
                        ..snapshot
                    });
                }
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
        let body_in_db = body.len() <= RESIDENT_BODY_BYTES;
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
            preview: preview(&body).into(),
            markdown: if body_in_db { body } else { String::new() },
            body_in_db,
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
    fn set_conflict(&self, id: &str, conflict: bool) -> Result<()> {
        self.conn.execute(
            "UPDATE documents SET conflict=?1 WHERE id=?2 AND conflict<>?1",
            params![conflict, id],
        )?;
        Ok(())
    }
    fn refresh_file(&self, id: &str) -> Result<Stored> {
        let mut doc = self.read_stored(id)?;
        let Some(path) = doc.path.as_deref().map(Path::new) else {
            return Ok(doc);
        };
        let Ok(bytes) = same_file_bytes(path, MAX_DOCUMENT_BYTES) else {
            self.set_conflict(id, true)?;
            doc.conflict = true;
            return if doc.body_in_db {
                Ok(doc)
            } else {
                Err(invalid("原文件不可用。"))
            };
        };
        let disk_hash = hash_bytes(&bytes);
        let changed = doc.baseline.as_deref() != Some(disk_hash.as_str());
        if doc.dirty() {
            if changed && encoded_body(&doc).is_ok_and(|encoded| encoded.as_ref() == bytes) {
                // The rename reached disk but its SQLite commit did not.
                self.persist_file(&doc, path, None, &disk_hash)?;
                doc.baseline = Some(disk_hash);
                doc.saved_hash = doc.content_hash.clone();
                doc.conflict = false;
            } else {
                self.set_conflict(id, changed)?;
                doc.conflict = changed;
            }
            return Ok(doc);
        }
        if changed || !doc.body_in_db || doc.markdown.len() > RESIDENT_BODY_BYTES {
            let Ok((body, bom, eol)) = decode_body(&bytes) else {
                self.set_conflict(id, true)?;
                doc.conflict = true;
                return if doc.body_in_db {
                    Ok(doc)
                } else {
                    Err(invalid("原文件不可用。"))
                };
            };
            let hash = digest(&body);
            // A migrated SQLite body may have literal CRs; retain it when
            // normalizing the disk copy would change the stored source.
            if !changed && !doc.body_in_db && hash != doc.content_hash {
                self.set_conflict(id, true)?;
                return Err(invalid("原文件不可用。"));
            }
            if changed || hash == doc.content_hash {
                let in_db = body.len() <= RESIDENT_BODY_BYTES;
                if changed || in_db != doc.body_in_db {
                    let tx = self.conn.unchecked_transaction()?;
                    tx.execute("UPDATE documents SET markdown=?1,bodyInDb=?2,preview=?3,contentHash=?4,savedHash=?4,baseline=?5,bom=?6,eol=?7,revision=revision+?8,conflict=0 WHERE id=?9",
                        params![if in_db { &body } else { "" },in_db,preview(&body),hash,disk_hash,bom,eol,changed as i64,id])?;
                    capacity(&tx, self.max_bytes)?;
                    tx.commit()?;
                }
                doc.markdown = body;
                doc.body_in_db = in_db;
                doc.content_hash = hash.clone();
                doc.saved_hash = hash;
                doc.baseline = Some(disk_hash);
                doc.bom = bom;
                doc.eol = eol;
                doc.revision += changed as i64;
            }
        }
        self.set_conflict(id, false)?;
        doc.conflict = false;
        Ok(doc)
    }
    pub fn sync_file(
        &mut self,
        id: &str,
        expected_path: &str,
        expected_revision: i64,
    ) -> Result<Snapshot> {
        let doc = self.read_stored(id)?;
        if doc.path.as_deref() != Some(expected_path) || doc.revision != expected_revision {
            return Err(invalid("文稿路径或版本已变化，本次未同步。"));
        }
        let path = Path::new(expected_path);
        if !is_markdown_file(path) || !doc.dirty() || doc.conflict {
            return self.snapshot();
        }
        let Ok(current_hash) = same_file_hash(path) else {
            self.set_conflict(id, true)?;
            return self.snapshot();
        };
        if doc.baseline.as_deref() != Some(&current_hash) {
            if encoded_body(&doc).is_ok_and(|bytes| hash_bytes(&bytes) == current_hash) {
                self.persist_file(&doc, path, None, &current_hash)?;
            } else {
                self.set_conflict(id, true)?;
            }
        } else {
            let bytes = encoded_body(&doc)?;
            self.materialize_resources(id, &doc, path, assets::ResourceSave::Sync)?;
            self.persist_file(
                &doc,
                path,
                Some((&bytes, Some(&current_hash))),
                &hash_bytes(&bytes),
            )?;
        }
        self.snapshot()
    }
    pub fn save_file(&mut self, id: &str, target: Option<&Path>) -> Result<Snapshot> {
        let doc = self.refresh_file(id)?;
        let chosen = target
            .map(PathBuf::from)
            .or_else(|| doc.path.as_ref().map(PathBuf::from))
            .ok_or_else(|| invalid("请先选择保存位置。"))?;
        let path = canonical(&chosen)?;
        let path_text = path.to_string_lossy().into_owned();
        if target.is_none()
            && doc
                .path
                .as_deref()
                .is_some_and(|p| path_key(p) != path_key(&path_text))
        {
            return Err(invalid("原文件路径已变化，请另存当前内容。"));
        }
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
        if same && !doc.dirty() {
            self.materialize_resources(id, &doc, &path, assets::ResourceSave::SamePath)?;
            return self.snapshot();
        }
        let bytes = encoded_body(&doc)?;
        let resources = if same {
            assets::ResourceSave::SamePath
        } else {
            assets::ResourceSave::SaveAs
        };
        self.materialize_resources(id, &doc, &path, resources)?;
        let expected = if same { doc.baseline.as_deref() } else { None };
        if !self.persist_file(&doc, &path, Some((&bytes, expected)), &hash_bytes(&bytes))? {
            return Err(invalid("磁盘文件已被修改或删除，请另存当前内容。"));
        }
        self.snapshot()
    }
    fn persist_file(
        &self,
        doc: &Stored,
        path: &Path,
        write: Option<(&[u8], Option<&str>)>,
        hash: &str,
    ) -> Result<bool> {
        let in_db = doc.markdown.len() <= RESIDENT_BODY_BYTES
            || doc.markdown.contains('\r')
            || (!doc.bom && doc.markdown.starts_with('\u{feff}'));
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("UPDATE documents SET path=?1,title=?2,baseline=?3,savedHash=contentHash,conflict=0,bodyInDb=?4,markdown=?5 WHERE id=?6",
            params![path.to_string_lossy(),path.file_name().unwrap_or_default().to_string_lossy(),hash,in_db,if in_db { &doc.markdown } else { "" },doc.id])?;
        capacity(&tx, self.max_bytes)?;
        if let Some((bytes, expected)) = write {
            if !atomic_write(path, bytes, expected)? {
                tx.rollback()?;
                self.set_conflict(&doc.id, true)?;
                return Ok(false);
            }
        }
        #[cfg(unix)]
        {
            let parent = path.parent().ok_or_else(|| invalid("文件路径无效。"))?;
            File::open(parent)
                .and_then(|directory| directory.sync_all())
                .map_err(|error| {
                    StoreError::Message(format!(
                        "文件已写入，但目录同步失败，SQLite 正文已保留：{error}"
                    ))
                })?;
        }
        tx.commit().map_err(|e| {
            StoreError::Message(format!(
                "文件已保存至 {}，但草稿关联提交失败；页面继续保留，请重试：{}",
                path.display(),
                e
            ))
        })?;
        Ok(true)
    }
    /// Capture resident matches and file metadata without doing disk I/O.
    pub fn prepare_search(&self, query: &str) -> Result<search::SearchPlan> {
        let query = query.trim();
        if query.chars().count() > 256 {
            return Err(invalid("搜索词最多 256 个字符。"));
        }
        let mut plan = search::SearchPlan::new(query);
        if query.is_empty() {
            return Ok(plan);
        }
        let mut statement = self.conn.prepare(
            "SELECT id,title,markdown,revision,shelved,bodyInDb,path,baseline FROM documents ORDER BY position,id",
        )?;
        let mut rows = statement.query([])?;
        let mut resident_hits = 0;
        while let Some(row) = rows.next()? {
            let (id, title, revision, shelved) =
                (row.get(0)?, row.get(1)?, row.get(3)?, row.get(4)?);
            if row.get::<_, bool>(5)? {
                let markdown: String = row.get(2)?;
                if let Some(hit) = search::hit(id, title, &markdown, revision, shelved, query) {
                    plan.entries.push(search::SearchEntry::Hit(hit));
                    resident_hits += 1;
                }
                if resident_hits == 100 {
                    break;
                }
            } else {
                plan.entries.push(search::SearchEntry::File {
                    id,
                    title,
                    revision,
                    shelved,
                    path: row.get(6)?,
                    baseline: row.get(7)?,
                });
            }
        }
        Ok(plan)
    }
    #[cfg(test)]
    fn search(&self, query: &str) -> Result<Vec<search::SearchHit>> {
        Ok(self.prepare_search(query)?.finish())
    }
    pub fn checkpoint(&self) -> Result<()> {
        let (busy, logged, checkpointed): (i64, i64, i64) =
            self.conn
                .query_row("PRAGMA wal_checkpoint(FULL);", [], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                })?;
        if busy != 0 || logged != checkpointed {
            return Err(invalid("文稿数据库仍被占用，尚未完成落盘，请稍后重试。"));
        }
        // The required checkpoint already succeeded. Maintenance can be retried
        // on the next exit if SQLite cannot get space or a lock this time.
        if let Err(error) = self.reclaim_legacy_pages() {
            eprintln!("Could not reclaim draft database space: {error}");
        }
        let _ = self
            .conn
            .query_row("PRAGMA wal_checkpoint(TRUNCATE);", [], |row| {
                row.get::<_, i64>(0)
            });
        Ok(())
    }
    fn reclaim_legacy_pages(&self) -> Result<()> {
        let (mode, page_size, pages, free): (i64, i64, i64, i64) = self.conn.query_row(
            "SELECT * FROM pragma_auto_vacuum(), pragma_page_size(), pragma_page_count(), pragma_freelist_count()",
            [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )?;
        if free.saturating_mul(page_size) >= LEGACY_RECLAIM_BYTES && free >= pages / 2 {
            match mode {
                0 => self.conn.execute_batch("VACUUM")?,
                2 => self.conn.execute_batch("PRAGMA incremental_vacuum")?,
                _ => (),
            }
        }
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
mod svg;
pub use assets::{
    validate_image, ResourceInfo, ResourceInput, ResourceReference, MAX_ATTACHMENT_BYTES,
    MAX_IMAGE_BYTES, MAX_IMPORT_BYTES,
};

#[path = "file_import.rs"]
pub mod file_import;
