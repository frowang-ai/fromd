//! SQLite recovery store. Same schema (v3) and semantics as
//! `apps/desktop/src/main/storageWorker.js`, so a database file is interchangeable.
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, ToSql};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub const COLUMNS: [&str; 13] = [
  "title", "path", "markdown", "contentHash", "savedHash", "baseline", "bom", "eol", "revision", "conflict", "viewState",
  "position", "shelved",
];

pub fn digest(bytes: &[u8]) -> String { hex::encode(Sha256::digest(bytes)) }

pub struct Storage {
  db: Connection,
  directory: PathBuf,
  max_session_bytes: i64,
}

pub struct Initial {
  pub documents: Vec<Map<String, Value>>,
  pub active_id: Option<String>,
}

pub enum Change {
  Insert(Map<String, Value>),
  Update { id: String, fields: Map<String, Value> },
}

fn err<E: std::fmt::Display>(error: E) -> String { error.to_string() }

/// Converts one JSON field to its SQLite column value (booleans → 0/1, viewState → JSON text).
fn encode(key: &str, value: &Value) -> Box<dyn ToSql> {
  match key {
    "viewState" => Box::new(serde_json::to_string(value).unwrap_or_else(|_| "null".into())),
    "bom" | "conflict" | "shelved" => Box::new(i64::from(value.as_bool().unwrap_or(false))),
    _ => match value {
      Value::Null => Box::new(Option::<String>::None),
      Value::Bool(flag) => Box::new(i64::from(*flag)),
      Value::Number(number) => match number.as_i64() {
        Some(integer) => Box::new(integer),
        None => Box::new(number.as_f64().unwrap_or(0.0)),
      },
      Value::String(text) => Box::new(text.clone()),
      other => Box::new(other.to_string()),
    },
  }
}

impl Storage {
  fn transaction<T>(&self, action: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
    self.db.execute_batch("BEGIN IMMEDIATE").map_err(err)?;
    match action(&self.db) {
      Ok(value) => {
        self.db.execute_batch("COMMIT").map_err(err)?;
        Ok(value)
      }
      Err(error) => {
        let _ = self.db.execute_batch("ROLLBACK");
        Err(error)
      }
    }
  }

  fn insert(db: &Connection, doc: &Map<String, Value>) -> Result<(), String> {
    let placeholders = vec!["?"; COLUMNS.len() + 1].join(",");
    let sql = format!("INSERT INTO documents (id, {}) VALUES ({placeholders})", COLUMNS.join(","));
    let mut values: Vec<Box<dyn ToSql>> = vec![Box::new(doc.get("id").and_then(Value::as_str).unwrap_or_default().to_string())];
    values.extend(COLUMNS.iter().map(|key| encode(key, doc.get(*key).unwrap_or(&Value::Null))));
    db.execute(&sql, params_from_iter(values.iter().map(|value| value.as_ref()))).map_err(err)?;
    Ok(())
  }

  fn check_capacity(db: &Connection, max: i64) -> Result<(), String> {
    // size is maintained per changed row by triggers; the aggregate never scans bodies.
    let total: i64 = db.query_row("SELECT COALESCE(SUM(size), 0) FROM documents", [], |row| row.get(0)).map_err(err)?;
    if total > max {
      return Err("会话备份超过容量上限，请先保存并从页面列表移除部分笔记（仅收起不会释放容量）。".into());
    }
    Ok(())
  }

  fn has_column(db: &Connection, name: &str) -> Result<bool, String> {
    let mut statement = db.prepare("PRAGMA table_info(documents)").map_err(err)?;
    let names = statement.query_map([], |row| row.get::<_, String>(1)).map_err(err)?;
    for column in names {
      if column.map_err(err)? == name {
        return Ok(true);
      }
    }
    Ok(false)
  }

  /// One-time import of the 0.1 `session.json`; only runs on a database without a version.
  fn legacy_session(&self) -> Result<(Vec<Map<String, Value>>, Option<String>), String> {
    let path = self.directory.join("session.json");
    let bytes = match std::fs::metadata(&path) {
      Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok((vec![], None)),
      Err(error) => return Err(err(error)),
      Ok(info) if info.len() as i64 > self.max_session_bytes => return Err("Recovery too large".into()),
      Ok(_) => std::fs::read(&path).map_err(err)?,
    };
    let saved: Value = serde_json::from_slice(&bytes).map_err(err)?;
    let invalid = || "Invalid recovery file".to_string();
    if saved.get("version").and_then(Value::as_i64) != Some(1) {
      return Err(invalid());
    }
    let documents = saved.get("documents").and_then(Value::as_array).ok_or_else(invalid)?;
    let mut seen = std::collections::HashSet::new();
    let mut result = vec![];
    for (position, doc) in documents.iter().enumerate() {
      let text = |key: &str| doc.get(key).and_then(Value::as_str);
      let (Some(id), Some(markdown), Some(saved_text), Some(title)) = (text("id"), text("markdown"), text("savedText"), text("title")) else {
        return Err(invalid());
      };
      let revision = doc.get("revision").and_then(Value::as_i64).filter(|value| *value >= 0).ok_or_else(invalid)?;
      let path = doc.get("path").filter(|value| value.is_null() || value.is_string()).ok_or_else(invalid)?;
      let eol = text("eol").filter(|value| *value == "\n" || *value == "\r\n").ok_or_else(invalid)?;
      let bom = doc.get("bom").and_then(Value::as_bool).ok_or_else(invalid)?;
      let baseline = doc.get("baseline").filter(|value| value.is_null() || value.as_str().is_some_and(|hash| hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()))).ok_or_else(invalid)?;
      if !seen.insert(id.to_string()) {
        return Err("Duplicate documents".into());
      }
      let mut row = Map::new();
      row.insert("id".into(), id.into());
      row.insert("title".into(), title.into());
      row.insert("path".into(), path.clone());
      row.insert("markdown".into(), markdown.into());
      row.insert("savedHash".into(), digest(saved_text.as_bytes()).into());
      row.insert("contentHash".into(), digest(markdown.as_bytes()).into());
      row.insert("baseline".into(), baseline.clone());
      row.insert("bom".into(), bom.into());
      row.insert("eol".into(), eol.into());
      row.insert("revision".into(), revision.into());
      row.insert("conflict".into(), doc.get("conflict").and_then(Value::as_bool).unwrap_or(false).into());
      row.insert("viewState".into(), Value::Null);
      row.insert("position".into(), (position as i64).into());
      row.insert("shelved".into(), false.into());
      result.push(row);
    }
    Ok((result, saved.get("activeId").and_then(Value::as_str).map(str::to_string)))
  }

  pub fn open(directory: &Path, max_session_bytes: i64) -> Result<(Self, Initial), String> {
    std::fs::create_dir_all(directory).map_err(err)?;
    let db = Connection::open(directory.join("drafts.sqlite")).map_err(err)?;
    db.execute_batch("PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;").map_err(err)?;
    db.execute_batch(
      "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, path TEXT, markdown TEXT NOT NULL,
        savedHash TEXT NOT NULL, contentHash TEXT NOT NULL DEFAULT '', baseline TEXT, bom INTEGER NOT NULL, eol TEXT NOT NULL,
        revision INTEGER NOT NULL, conflict INTEGER NOT NULL, viewState TEXT NOT NULL,
        position INTEGER NOT NULL, size INTEGER NOT NULL DEFAULT 0, shelved INTEGER NOT NULL DEFAULT 0
      );
      CREATE TRIGGER IF NOT EXISTS document_insert_size AFTER INSERT ON documents BEGIN
        UPDATE documents SET size=length(CAST(NEW.markdown AS BLOB))+length(CAST(NEW.title AS BLOB))+length(CAST(COALESCE(NEW.path,'') AS BLOB))+length(CAST(NEW.viewState AS BLOB))+256 WHERE id=NEW.id;
      END;
      CREATE TRIGGER IF NOT EXISTS document_update_size AFTER UPDATE OF markdown,title,path,viewState ON documents BEGIN
        UPDATE documents SET size=length(CAST(NEW.markdown AS BLOB))+length(CAST(NEW.title AS BLOB))+length(CAST(COALESCE(NEW.path,'') AS BLOB))+length(CAST(NEW.viewState AS BLOB))+256 WHERE id=NEW.id;
      END;",
    )
    .map_err(err)?;
    let storage = Storage { db, directory: directory.to_path_buf(), max_session_bytes };
    let version: Option<String> = storage
      .db
      .query_row("SELECT value FROM settings WHERE key='version'", [], |row| row.get(0))
      .optional()
      .map_err(err)?;
    if let Some(version) = &version {
      if !["1", "2", "3"].contains(&version.as_str()) {
        return Err("Unsupported recovery version".into());
      }
    }
    if version.as_deref() == Some("1") {
      storage.transaction(|db| {
        if !Self::has_column(db, "contentHash")? {
          db.execute_batch("ALTER TABLE documents ADD COLUMN contentHash TEXT NOT NULL DEFAULT ''").map_err(err)?;
        }
        let rows: Vec<(String, String)> = {
          let mut statement = db.prepare("SELECT id, markdown FROM documents").map_err(err)?;
          let mapped = statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?))).map_err(err)?;
          mapped.collect::<Result<_, _>>().map_err(err)?
        };
        for (id, markdown) in rows {
          db.execute("UPDATE documents SET contentHash=? WHERE id=?", params![digest(markdown.as_bytes()), id]).map_err(err)?;
        }
        db.execute("UPDATE settings SET value='2' WHERE key='version'", []).map_err(err)?;
        Ok(())
      })?;
    }
    if version.is_none() {
      let (documents, active_id) = storage.legacy_session()?;
      let max = storage.max_session_bytes;
      storage.transaction(|db| {
        if !Self::has_column(db, "contentHash")? {
          db.execute_batch("ALTER TABLE documents ADD COLUMN contentHash TEXT NOT NULL DEFAULT ''").map_err(err)?;
        }
        for doc in &documents {
          Self::insert(db, doc)?;
        }
        Self::check_capacity(db, max)?;
        db.execute("INSERT INTO settings (key,value) VALUES ('version','2'),('activeId',?)", params![active_id]).map_err(err)?;
        Ok(())
      })?;
    }
    if version.as_deref() != Some("3") {
      storage.transaction(|db| {
        if !Self::has_column(db, "shelved")? {
          db.execute_batch("ALTER TABLE documents ADD COLUMN shelved INTEGER NOT NULL DEFAULT 0").map_err(err)?;
        }
        db.execute("UPDATE settings SET value='3' WHERE key='version'", []).map_err(err)?;
        Ok(())
      })?;
    }
    Self::check_capacity(&storage.db, storage.max_session_bytes)?;
    let documents = {
      let metadata: Vec<&str> = COLUMNS.iter().copied().filter(|key| *key != "markdown").collect();
      let sql = format!("SELECT id, {}, substr(markdown,1,1200) AS preview FROM documents ORDER BY position", metadata.join(","));
      let mut statement = storage.db.prepare(&sql).map_err(err)?;
      let rows = statement
        .query_map([], |row| {
          let mut doc = Map::new();
          doc.insert("id".into(), row.get::<_, String>(0)?.into());
          for (index, key) in metadata.iter().enumerate() {
            let column = index + 1;
            let value: Value = match *key {
              "bom" | "conflict" | "shelved" => (row.get::<_, i64>(column)? != 0).into(),
              "revision" | "position" => row.get::<_, i64>(column)?.into(),
              "viewState" => serde_json::from_str(&row.get::<_, String>(column)?).unwrap_or(Value::Null),
              _ => row.get::<_, Option<String>>(column)?.map(Value::from).unwrap_or(Value::Null),
            };
            doc.insert((*key).into(), value);
          }
          doc.insert("preview".into(), row.get::<_, String>(metadata.len() + 1)?.into());
          Ok(doc)
        })
        .map_err(err)?;
      rows.collect::<Result<Vec<_>, _>>().map_err(err)?
    };
    let active_id = storage
      .db
      .query_row("SELECT value FROM settings WHERE key='activeId'", [], |row| row.get::<_, Option<String>>(0))
      .optional()
      .map_err(err)?
      .flatten();
    Ok((storage, Initial { documents, active_id }))
  }

  pub fn read(&self, id: &str) -> Result<String, String> {
    self
      .db
      .query_row("SELECT markdown FROM documents WHERE id=?", params![id], |row| row.get(0))
      .optional()
      .map_err(err)?
      .ok_or_else(|| "笔记已经关闭。".into())
  }

  pub fn apply(&self, changes: &[Change], deletions: &[String], active_id: Option<&str>) -> Result<(), String> {
    let max = self.max_session_bytes;
    self.transaction(|db| {
      for id in deletions {
        db.execute("DELETE FROM documents WHERE id=?", params![id]).map_err(err)?;
      }
      for change in changes {
        match change {
          Change::Insert(doc) => Self::insert(db, doc)?,
          Change::Update { id, fields } => {
            if fields.is_empty() || fields.keys().any(|key| !COLUMNS.contains(&key.as_str())) {
              return Err("Invalid document update".into());
            }
            let assignments: Vec<String> = fields.keys().map(|key| format!("{key}=?")).collect();
            let sql = format!("UPDATE documents SET {} WHERE id=?", assignments.join(","));
            let mut values: Vec<Box<dyn ToSql>> = fields.iter().map(|(key, value)| encode(key, value)).collect();
            values.push(Box::new(id.clone()));
            let changed = db.execute(&sql, params_from_iter(values.iter().map(|value| value.as_ref()))).map_err(err)?;
            if changed == 0 {
              return Err("笔记已经关闭。".into());
            }
          }
        }
      }
      Self::check_capacity(db, max)?;
      db.execute("UPDATE settings SET value=? WHERE key='activeId'", params![active_id]).map_err(err)?;
      Ok(())
    })
  }
}
