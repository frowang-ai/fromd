use super::*;
use tempfile::tempdir;
fn setup() -> (tempfile::TempDir, Store, String) {
    let dir = tempdir().unwrap();
    let mut store = Store::open(&dir.path().join("profile"), MAX_SESSION_BYTES).unwrap();
    let id = store.create("原正文", "原页").unwrap().active_id.unwrap();
    (dir, store, id)
}
#[test]
fn import_text_strict_utf8_flags_pathless_draft_and_save_as() {
    let (dir, mut store, old) = setup();
    let path = dir.path().join("报告.txt");
    let bytes = b"\xef\xbb\xbfA\r\nB\r\n";
    fs::write(&path, bytes).unwrap();
    let mut pending = FileImport::read(&path).unwrap();
    assert_eq!(pending.source.content, "A\nB\n");
    assert!(pending.source.bom);
    assert_eq!(pending.source.eol, "\r\n");
    pending.stage(&store, &[]).unwrap();
    let body = pending.source.content.clone();
    let id = pending
        .commit(&mut store, &body)
        .unwrap()
        .active_id
        .unwrap();
    let imported = store.read_stored(&id).unwrap();
    assert_eq!(imported.path, None);
    assert_eq!(imported.title, "报告");
    assert!(imported.bom);
    assert_eq!(imported.eol, "\r\n");
    assert_eq!(store.read_stored(&old).unwrap().markdown, "原正文");
    let target = dir.path().join("export.md");
    store.save_file(&id, Some(&target)).unwrap();
    assert_eq!(fs::read(&target).unwrap(), bytes);
    assert_eq!(fs::read(&path).unwrap(), bytes);
}
#[test]
fn import_invalid_utf8_size_kind_and_tokens_preserve_store() {
    let (dir, store, id) = setup();
    let path = dir.path().join("bad.txt");
    fs::write(&path, [0xff, 0xfe]).unwrap();
    assert!(FileImport::read(&path).is_err());
    fs::write(&path, vec![b'a'; MAX_DOCUMENT_BYTES + 1]).unwrap();
    assert!(FileImport::read(&path).is_err());
    let wrong = dir.path().join("wrong.pdf");
    fs::write(&wrong, b"ok").unwrap();
    assert!(FileImport::read(&wrong).is_err());
    fs::write(&path, b"ok").unwrap();
    let mut pending = FileImport::read(&path).unwrap();
    assert!(pending.verify("foreign").is_err());
    pending.created = Instant::now() - std::time::Duration::from_secs(301);
    assert!(pending.verify(&pending.source.token).is_err());
    assert_eq!(store.snapshot().unwrap().active_id, Some(id));
    assert_eq!(store.snapshot().unwrap().documents.len(), 1);
}
fn png() -> Vec<u8> {
    use std::io::Cursor;
    let mut data = Cursor::new(Vec::new());
    image::DynamicImage::new_rgba8(2, 2)
        .write_to(&mut data, image::ImageFormat::Png)
        .unwrap();
    data.into_inner()
}
#[test]
fn import_html_resources_survive_source_removal_title_restart_and_export() {
    let (dir, mut store, old) = setup();
    let root = dir.path().join("source");
    fs::create_dir(&root).unwrap();
    let path = root.join("网页.html");
    fs::write(&path, "<p>synthetic</p>").unwrap();
    fs::write(root.join("图.png"), png()).unwrap();
    fs::write(root.join("file.txt"), b"attachment").unwrap();
    let mut pending = FileImport::read(&path).unwrap();
    let resources = pending
        .stage(
            &store,
            &[
                ImportReference {
                    reference: "图.png".into(),
                    image: true,
                },
                ImportReference {
                    reference: "file.txt#part".into(),
                    image: false,
                },
            ],
        )
        .unwrap();
    assert_eq!(store.snapshot().unwrap().documents.len(), 1);
    let body = format!(
        "# 网页\n\n![图]({})\n\n[附件]({}#part)\n",
        resources[0].reference, resources[1].reference
    );
    let id = pending
        .commit(&mut store, &body)
        .unwrap()
        .active_id
        .unwrap();
    assert_eq!(store.read_stored(&id).unwrap().path, None);
    assert_eq!(store.read_stored(&old).unwrap().markdown, "原正文");
    fs::remove_file(root.join("图.png")).unwrap();
    fs::remove_file(root.join("file.txt")).unwrap();
    store.rename(&id, "新标题").unwrap();
    store.shelve(&id).unwrap();
    drop(store);
    let mut store = Store::open(&dir.path().join("profile"), MAX_SESSION_BYTES).unwrap();
    assert_eq!(
        store
            .resource_image(&id, &resources[0].reference)
            .unwrap()
            .0,
        png()
    );
    let output = dir.path().join("export");
    fs::create_dir(&output).unwrap();
    store.save_file(&id, Some(&output.join("out.md"))).unwrap();
    assert!(output.join(&resources[0].reference).exists());
    assert!(output.join(&resources[1].reference).exists());
    assert!(fs::read_to_string(&path).unwrap().contains("synthetic"));
}
#[test]
fn import_missing_escape_corrupt_image_and_failed_stage_create_no_page() {
    let (dir, store, id) = setup();
    let path = dir.path().join("source.html");
    fs::write(&path, b"<p>ok</p>").unwrap();
    fs::write(dir.path().join("fake.png"), b"fake image").unwrap();
    let mut pending = FileImport::read(&path).unwrap();
    for reference in [
        "missing.png",
        "../outside.png",
        "/absolute.png",
        "https://remote.test/a.png",
        "fake.png",
    ] {
        assert!(pending
            .stage(
                &store,
                &[ImportReference {
                    reference: reference.into(),
                    image: true
                }]
            )
            .is_err());
        assert!(!pending.staged);
    }
    assert_eq!(store.snapshot().unwrap().documents.len(), 1);
    assert_eq!(store.snapshot().unwrap().active_id, Some(id));
}
#[test]
fn import_commit_failure_rolls_back_document_bindings_layout_and_new_files() {
    let (dir, mut store, id) = setup();
    let path = dir.path().join("source.html");
    fs::write(&path, b"<p>ok</p>").unwrap();
    fs::write(dir.path().join("image.png"), png()).unwrap();
    let mut pending = FileImport::read(&path).unwrap();
    let resources = pending
        .stage(
            &store,
            &[ImportReference {
                reference: "image.png".into(),
                image: true,
            }],
        )
        .unwrap();
    let revision = store.snapshot().unwrap().layout_revision;
    store.conn.execute_batch("CREATE TRIGGER import_fail BEFORE INSERT ON resource_bindings BEGIN SELECT RAISE(ABORT,'synthetic binding failure');END;").unwrap();
    assert!(pending
        .commit(&mut store, &format!("![image]({})", resources[0].reference))
        .is_err());
    assert_eq!(store.snapshot().unwrap().documents.len(), 1);
    assert_eq!(store.snapshot().unwrap().active_id, Some(id));
    assert_eq!(store.snapshot().unwrap().layout_revision, revision);
    assert_eq!(
        store
            .conn
            .query_row("SELECT COUNT(*) FROM resource_objects", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        fs::read_dir(dir.path().join("profile/resources/objects"))
            .unwrap()
            .count(),
        0
    );
}
#[test]
fn import_unregistered_final_reference_and_capacity_fail_atomically() {
    let (dir, mut store, id) = setup();
    let path = dir.path().join("source.html");
    fs::write(&path, b"<p>ok</p>").unwrap();
    let mut pending = FileImport::read(&path).unwrap();
    pending.stage(&store, &[]).unwrap();
    assert!(pending
        .commit(&mut store, "![missing](missing.png)")
        .is_err());
    let mut pending = FileImport::read(&path).unwrap();
    pending.stage(&store, &[]).unwrap();
    store.max_bytes = 1;
    assert!(pending.commit(&mut store, "import body").is_err());
    assert_eq!(store.snapshot().unwrap().documents.len(), 1);
    assert_eq!(store.snapshot().unwrap().active_id, Some(id));
}

#[test]
fn import_final_confirmation_is_idempotent_across_reopen() {
    let (dir, mut store, _) = setup();
    let source = dir.path().join("source.html");
    fs::write(&source, b"<p>body</p>").unwrap();
    let mut pending = FileImport::read(&source).unwrap();
    let id = pending.source.token.clone();
    pending.stage(&store, &[]).unwrap();
    pending.commit(&mut store, "body\n").unwrap();
    let revision = store.snapshot().unwrap().layout_revision;
    assert_eq!(
        store
            .confirm_import(&id, "body\n")
            .unwrap()
            .unwrap()
            .documents
            .len(),
        2
    );
    assert!(store.confirm_import(&id, "other").is_err());
    assert_eq!(store.snapshot().unwrap().layout_revision, revision);
    drop(store);
    let store = Store::open(&dir.path().join("profile"), MAX_SESSION_BYTES).unwrap();
    assert_eq!(
        store
            .confirm_import(&id, "body\n")
            .unwrap()
            .unwrap()
            .documents
            .len(),
        2
    );
}

#[test]
fn html_protocol_relative_final_markdown_is_https_and_has_no_resource_binding(){
 let (dir,mut store,_)=setup();let source=dir.path().join('source.html');fs::write(&source,b"<a href=\"//example.com/help?q=x#part\">help</a>").unwrap();
 let mut pending=FileImport::read(&source).unwrap();pending.stage(&store,&[]).unwrap();let id=pending.source.token.clone();
 let snapshot=pending.commit(&mut store,"[help](https://example.com/help?q=x#part)").unwrap();
 let doc=store.read_stored(&id).unwrap();assert_eq!(doc.path,None);assert_eq!(doc.markdown,"[help](https://example.com/help?q=x#part)");assert!(snapshot.documents.iter().all(|d|d.id!=id||!d.dirty));assert_eq!(store.conn.query_row("SELECT COUNT(*) FROM resource_bindings WHERE docId=?1",params![id],|r|r.get::<_,i64>(0)).unwrap(),0);
}
