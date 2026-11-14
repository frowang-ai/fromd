use super::*;
use tempfile::tempdir;

#[test]
fn nullable_active_and_schema3_round_trip() {
    let dir = tempdir().unwrap();
    let id;
    {
        let mut store = Store::open(dir.path(), 100_000).unwrap();
        assert!(store.snapshot().unwrap().active_id.is_none());
        id = store.create("正文", "独立名称").unwrap().active_id.unwrap();
        store.shelve(&id).unwrap();
        assert!(store.snapshot().unwrap().active_id.is_none());
    }
    let store = Store::open(dir.path(), 100_000).unwrap();
    let snap = store.snapshot().unwrap();
    assert!(snap.active_id.is_none());
    assert!(snap.documents[0].shelved);
    assert_eq!(store.read_stored(&id).unwrap().markdown, "正文");
    assert_eq!(snap.documents[0].title, "独立名称");
}
#[test]
fn capacity_failure_rolls_back_create_update_name_and_view() {
    let dir = tempdir().unwrap();
    let mut store = Store::open(dir.path(), 700).unwrap();
    let id = store.create("abc", "name").unwrap().active_id.unwrap();
    let before = store.read_stored(&id).unwrap();
    assert!(store.create(&"x".repeat(900), "oversize").is_err());
    assert_eq!(store.snapshot().unwrap().documents.len(), 1);
    assert!(store.update(&id, &"x".repeat(900), 1).is_err());
    assert_eq!(store.read_stored(&id).unwrap().markdown, "abc");
    assert!(store.rename(&id, &"x".repeat(800)).is_err());
    assert_eq!(store.read_stored(&id).unwrap().title, before.title);
    let view =
        serde_json::json!({"mode":"source","scrollTop":10,"sourceSelection":{"start":0,"end":0}});
    store.set_view(&id, view).unwrap();
    store.max_bytes = 1;
    assert!(store
        .set_view(&id, serde_json::json!({"mode":"source","scrollTop":999}))
        .is_err());
    assert_eq!(store.read_stored(&id).unwrap().view_state["scrollTop"], 10);
}
#[test]
fn undo_failure_keeps_record_and_never_activates_a_shelved_page() {
    let dir = tempdir().unwrap();
    let mut store = Store::open(dir.path(), 100_000).unwrap();
    let old = store.create("keep", "A").unwrap().active_id.unwrap();
    store.shelve(&old).unwrap();
    store.remove(&old, "discard").unwrap();
    store.conn.execute_batch("CREATE TRIGGER fail_insert BEFORE INSERT ON documents BEGIN SELECT RAISE(ABORT,'forced failure'); END;").unwrap();
    assert!(store.undo_remove().is_err());
    assert!(store.last_removed.is_some());
    store
        .conn
        .execute_batch("DROP TRIGGER fail_insert")
        .unwrap();
    let restored = store.undo_remove().unwrap();
    assert_ne!(restored.documents[0].id, old);
    assert!(restored.documents[0].shelved);
    assert!(restored.active_id.is_none());
    assert!(store.update(&old, "late write", 99).is_err());
}
#[test]
fn revision_conflicts_and_unchanged_retry_are_distinguished() {
    let dir = tempdir().unwrap();
    let mut store = Store::open(dir.path(), 100_000).unwrap();
    let id = store.create("", "draft").unwrap().active_id.unwrap();
    store.update(&id, "最新输入", 1).unwrap();
    store.update(&id, "最新输入", 1).unwrap();
    assert!(store.update(&id, "stale", 0).is_err());
    assert!(store.update(&id, "same-version overwrite", 1).is_err());
    assert_eq!(store.read_stored(&id).unwrap().markdown, "最新输入");
}
#[test]
fn schema3_fixture_keeps_id_hash_title_order_and_old_view_fields() {
    let dir = tempdir().unwrap();
    let conn = Connection::open(dir.path().join("drafts.sqlite")).unwrap();
    conn.execute_batch("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT); INSERT INTO settings VALUES('version','3'),('activeId','old-id'); CREATE TABLE documents(id TEXT PRIMARY KEY,title TEXT NOT NULL,path TEXT,markdown TEXT NOT NULL,savedHash TEXT NOT NULL,contentHash TEXT NOT NULL,baseline TEXT,bom INTEGER NOT NULL,eol TEXT NOT NULL,revision INTEGER NOT NULL,conflict INTEGER NOT NULL,viewState TEXT NOT NULL,position INTEGER NOT NULL,size INTEGER NOT NULL DEFAULT 0,shelved INTEGER NOT NULL DEFAULT 0);").unwrap();
    conn.execute("INSERT INTO documents VALUES('old-id','同名稿',NULL,'# 原标题',?1,?2,NULL,0,?3,8,0,?4,3,0,0)",params![digest(""),digest("# 原标题"),"\r\n",r#"{"mode":"rendered","scrollTop":321,"selection":{"anchor":12,"head":12},"sourceSelection":{"start":2,"end":2}}"#]).unwrap();
    drop(conn);
    let store = Store::open(dir.path(), 100_000).unwrap();
    let doc = store.read_stored("old-id").unwrap();
    assert_eq!(doc.title, "同名稿");
    assert_eq!(doc.revision, 8);
    assert_eq!(doc.position, 3);
    assert_eq!(doc.view_state["scrollTop"], 321);
    assert_eq!(
        store.snapshot().unwrap().active_id.as_deref(),
        Some("old-id")
    );
}
#[test]
fn removing_a_file_page_preserves_original_and_utf8_bom_crlf() {
    let dir = tempdir().unwrap();
    let file = dir.path().join("original.md");
    fs::write(&file, b"\xef\xbb\xbf# first\r\nline\r\n").unwrap();
    let mut store = Store::open(&dir.path().join("profile"), 100_000).unwrap();
    let id = store.open_file(&file).unwrap().active_id.unwrap();
    assert!(store.rename(&id, "forbidden").is_err());
    store.update(&id, "# 改写\n行\n", 1).unwrap();
    store.save_file(&id, None).unwrap();
    let bytes = fs::read(&file).unwrap();
    assert!(bytes.starts_with(&[239, 187, 191]));
    assert!(String::from_utf8(bytes).unwrap().contains("\r\n"));
    store.remove(&id, "saved").unwrap();
    assert!(file.exists());
    assert_eq!(store.snapshot().unwrap().documents.len(), 0);
}
#[test]
fn external_change_blocks_overwrite_and_undo_recovers_duplicate_path_as_draft() {
    let dir = tempdir().unwrap();
    let file = dir.path().join("file.md");
    fs::write(&file, "disk").unwrap();
    let mut store = Store::open(&dir.path().join("profile"), 100_000).unwrap();
    let id = store.open_file(&file).unwrap().active_id.unwrap();
    store.update(&id, "local", 1).unwrap();
    fs::write(&file, "external").unwrap();
    assert!(store.save_file(&id, None).is_err());
    assert_eq!(fs::read_to_string(&file).unwrap(), "external");
    store.remove(&id, "discard").unwrap();
    store.open_file(&file).unwrap();
    let snap = store.undo_remove().unwrap();
    assert_eq!(snap.documents.len(), 2);
    let recovered = snap.documents.iter().find(|d| d.path.is_none()).unwrap();
    assert_ne!(recovered.id, id);
    assert!(recovered.title.contains("恢复"));
}
#[test]
fn layout_failure_does_not_change_selection_or_shelving() {
    let dir = tempdir().unwrap();
    let mut store = Store::open(dir.path(), 100_000).unwrap();
    let id = store.create("", "A").unwrap().active_id.unwrap();
    store.conn.execute_batch("CREATE TRIGGER fail_layout BEFORE UPDATE OF shelved ON documents BEGIN SELECT RAISE(ABORT,'forced failure'); END;").unwrap();
    assert!(store.shelve(&id).is_err());
    let snap = store.snapshot().unwrap();
    assert!(!snap.documents[0].shelved);
    assert_eq!(snap.active_id.as_deref(), Some(id.as_str()));
}
