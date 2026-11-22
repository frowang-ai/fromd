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

#[test]
fn search_all_drafts_shelves_unicode_and_reopen_without_disk_or_layout_changes() {
    let dir = tempdir().unwrap();
    let a;
    {
        let mut store = Store::open(dir.path(), 100_000).unwrap();
        a = store
            .create("第一行\n😀中文AbC内容", "草稿")
            .unwrap()
            .active_id
            .unwrap();
        let b = store
            .create("收起正文", "中文名称")
            .unwrap()
            .active_id
            .unwrap();
        store.shelve(&b).unwrap();
        let before = store.snapshot().unwrap();
        let hits = store.search("中文").unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].id, a);
        let loc = hits[0].location.as_ref().unwrap();
        assert_eq!((loc.line, loc.column, loc.length), (2, 1, 2));
        assert!(hits[1].shelved);
        assert!(hits[1].location.is_none());
        assert_eq!(store.search("abc").unwrap().len(), 1);
        assert!(store.search("%_' OR 1=1").unwrap().is_empty());
        assert!(store.search(&"a".repeat(257)).is_err());
        assert_eq!(
            store.snapshot().unwrap().layout_revision,
            before.layout_revision
        );
        assert_eq!(store.snapshot().unwrap().active_id, before.active_id);
    }
    let store = Store::open(dir.path(), 100_000).unwrap();
    assert_eq!(store.search("AbC").unwrap()[0].id, a);
}
#[test]
fn search_caps_pages_and_does_not_read_associated_disk_files() {
    let dir = tempdir().unwrap();
    let mut store = Store::open(dir.path(), 1_000_000).unwrap();
    for _ in 0..103 {
        store.create("needle", "title").unwrap();
    }
    assert_eq!(store.search("needle").unwrap().len(), 100);
    let id = store.snapshot().unwrap().documents[0].id.clone();
    store
        .conn
        .execute(
            "UPDATE documents SET path=?1 WHERE id=?2",
            params![dir.path().join("missing.md").to_string_lossy(), id],
        )
        .unwrap();
    assert_eq!(store.search("needle").unwrap().len(), 100);
}

#[test]
fn visible_reorder_keeps_shelf_slots_active_and_persists_on_reopen() {
    let dir = tempdir().unwrap();
    let expected;
    let active;
    {
        let mut store = Store::open(dir.path(), 100_000).unwrap();
        let a = store.create("A", "A").unwrap().active_id.unwrap();
        let x = store.create("X", "X").unwrap().active_id.unwrap();
        let b = store.create("B", "B").unwrap().active_id.unwrap();
        let c = store.create("C", "C").unwrap().active_id.unwrap();
        store.shelve(&x).unwrap();
        store.activate(&b).unwrap();
        active = b.clone();
        let revision = store.snapshot().unwrap().layout_revision;
        let before = store.snapshot().unwrap();
        assert!(store
            .reorder_visible(&[c.clone(), a.clone(), a.clone()], revision)
            .is_err());
        assert_eq!(store.snapshot().unwrap().layout_revision, revision);
        let snap = store
            .reorder_visible(&[c.clone(), a.clone(), b.clone()], revision)
            .unwrap();
        expected = vec![c, x, a, b];
        assert_eq!(
            snap.documents
                .iter()
                .map(|d| d.id.clone())
                .collect::<Vec<_>>(),
            expected
        );
        assert!(snap.documents[1].shelved);
        assert_eq!(snap.active_id, before.active_id);
        assert!(store
            .reorder_visible(
                &[
                    expected[2].clone(),
                    expected[3].clone(),
                    expected[0].clone()
                ],
                revision
            )
            .is_err());
        assert_eq!(
            store.snapshot().unwrap().layout_revision,
            snap.layout_revision
        );
    }
    let store = Store::open(dir.path(), 100_000).unwrap();
    let snap = store.snapshot().unwrap();
    assert_eq!(
        snap.documents
            .iter()
            .map(|d| d.id.clone())
            .collect::<Vec<_>>(),
        expected
    );
    assert_eq!(snap.active_id, Some(active));
}
#[test]
fn failed_reorder_transaction_rolls_back_every_position_and_layout_revision() {
    let dir = tempdir().unwrap();
    let mut store = Store::open(dir.path(), 100_000).unwrap();
    let a = store.create("A", "A").unwrap().active_id.unwrap();
    let b = store.create("B", "B").unwrap().active_id.unwrap();
    let before = store.snapshot().unwrap();
    store.conn.execute_batch("CREATE TRIGGER fail_reorder BEFORE UPDATE OF position ON documents WHEN OLD.title='B' BEGIN SELECT RAISE(ABORT,'forced failure'); END;").unwrap();
    assert!(store
        .reorder_visible(&[b, a], before.layout_revision)
        .is_err());
    assert_eq!(
        serde_json::to_value(store.snapshot().unwrap()).unwrap(),
        serde_json::to_value(before).unwrap()
    );
}
