use super::*;
use tempfile::tempdir;

fn png() -> Vec<u8> {
    let mut bytes = Cursor::new(Vec::new());
    image::DynamicImage::new_rgba8(2, 2)
        .write_to(&mut bytes, ImageFormat::Png)
        .unwrap();
    bytes.into_inner()
}
fn import(store: &mut Store, id: &str, bytes: &[u8], name: &str, image: bool) -> ResourceInfo {
    store
        .import_resources(
            id,
            &[ResourceInput {
                name: name.into(),
                size: bytes.len(),
                image,
            }],
            bytes,
        )
        .unwrap()
        .remove(0)
}
fn setup() -> (tempfile::TempDir, Store, String) {
    let dir = tempdir().unwrap();
    let mut store = Store::open(&dir.path().join("profile"), MAX_SESSION_BYTES).unwrap();
    let id = store.create("正文", "草稿").unwrap().active_id.unwrap();
    (dir, store, id)
}
fn put(store: &mut Store, id: &str, markup: &str) {
    let revision = store.read_stored(id).unwrap().revision + 1;
    store.update(id, markup, revision).unwrap();
}

const SVG: &[u8] = br##"<?xml version="1.0" encoding="UTF-8"?>
<s:svg xmlns:s="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <s:defs><s:path id="shape" d="M0 0h10v10z"/></s:defs>
  <s:style><![CDATA[ .shape { clip-path: url("#clip"); } ]]></s:style>
  <s:use class="shape" xlink:href="#shape"/>
</s:svg>"##;

#[test]
fn svg_import_display_and_legacy_attachment_upgrade_share_validation() {
    let (dir, mut store, id) = setup();
    let attachment = import(&mut store, &id, SVG, "图.svg", false);
    assert_eq!(attachment.mime, "application/octet-stream");
    let image = import(&mut store, &id, SVG, "图.svg", true);
    assert_eq!(image.reference, attachment.reference);
    assert_eq!(store.bound_resource_mime(&id, &image.id, "svg").unwrap().as_deref(), Some("image/svg+xml"));
    assert_eq!(store.resource_image(&id, &image.reference).unwrap(), (SVG.to_vec(), "image/svg+xml".into()));
    let other = store.create("", "另一页").unwrap().active_id.unwrap();
    assert!(store.resource_image(&other, &image.reference).is_err());
    let file = dir.path().join("note.md");
    fs::write(&file, "").unwrap();
    fs::write(dir.path().join("图.svg"), SVG).unwrap();
    let disk = store.open_file(&file).unwrap().active_id.unwrap();
    assert_eq!(store.resource_image(&disk, "%E5%9B%BE.svg").unwrap().1, "image/svg+xml");
    assert!(store.resource_image(&disk, "../图.svg").is_err());
    assert_eq!(validate_image(SVG).unwrap(), "image/svg+xml");
}

#[test]
fn svg_rejects_malformed_xml_active_content_and_nonlocal_references() {
    let ns = "http://www.w3.org/2000/svg";
    for xml in [
        "<svg/>".into(),
        format!("<svg xmlns='{ns}'><g></svg>"),
        format!("<svg xmlns='{ns}'/><svg xmlns='{ns}'/>"),
        format!("<!DOCTYPE svg><svg xmlns='{ns}'/>"),
        format!("<svg xmlns='{ns}'>&unknown;</svg>"),
        format!("<?xml-stylesheet href='local.css'?><svg xmlns='{ns}'/>"),
        format!("<svg xmlns='{ns}'><script/></svg>"),
        format!("<svg xmlns='{ns}' onload='active'/>"),
        format!("<svg xmlns='{ns}'><foreignObject/></svg>"),
        format!("<svg xmlns='{ns}'><g xmlns='other'/></svg>"),
        format!("<svg xmlns='{ns}'><image href='https://invalid.test/image.png'/></svg>"),
        format!("<svg xmlns='{ns}'><use href='file&#58;image.svg'/></svg>"),
        format!("<svg xmlns='{ns}'><rect fill='url(other.svg#paint)'/></svg>"),
        format!("<svg xmlns='{ns}'><style>@import 'other.css';</style></svg>"),
    ] {
        assert!(validate_image(xml.as_bytes()).is_err(), "{xml}");
    }
}

#[test]
fn svg_depth_is_bounded_before_tree_parsing() {
    let nested = |groups| format!(
        "<svg xmlns='http://www.w3.org/2000/svg'>{}{}</svg>",
        "<g>".repeat(groups),
        "</g>".repeat(groups),
    );
    assert!(validate_image(nested(127).as_bytes()).is_ok());
    assert!(validate_image(nested(128).as_bytes()).is_err());
    assert!(validate_image(nested(50_000).as_bytes()).is_err());
}

#[test]
fn bound_markdown_assets_are_single_copy_and_keep_references_on_save_as() {
    let (dir, mut store, draft) = setup();
    let source = dir.path().join("source");
    let target = dir.path().join("target");
    fs::create_dir(&source).unwrap();
    fs::create_dir(&target).unwrap();
    let note = source.join("合成 #笔记.markdown");
    fs::write(&note, "").unwrap();
    let id = store.open_file(&note).unwrap().active_id.unwrap();
    let image = import(&mut store, &id, SVG, "示意 (A)#%.svg", true);
    let duplicate = import(&mut store, &id, SVG, "示意 (A)#%.svg", true);
    assert_eq!(image.reference, duplicate.reference);
    assert_eq!(image.reference, "%E5%90%88%E6%88%90%20%23%E7%AC%94%E8%AE%B0.assets/%E7%A4%BA%E6%84%8F%20%28A%29%23%25.svg");
    let local = source.join("合成 #笔记.assets").join("示意 (A)#%.svg");
    assert_eq!(fs::read(&local).unwrap(), SVG);
    assert_eq!(store.resource_image(&id, &image.reference).unwrap().0, SVG);
    assert!(store.resource_image(&draft, &image.reference).is_err());
    let first = import(&mut store, &id, b"first", "附件.bin", false);
    let second = import(&mut store, &id, b"second", "附件.bin", false);
    assert_eq!(second.name, format!("附件-{}.bin", &second.id[..8]));
    assert_eq!(import(&mut store, &id, b"second", "附件.bin", false).reference, second.reference);
    assert_eq!(fs::read(store.managed_attachment(&id, &first.reference).unwrap().unwrap()).unwrap(), b"first");
    assert!(!store.profile.join("resources").exists());
    let markup = format!("![图]({})\n\n[附件][id]\n\n[id]: {}\n\n<a href='{}'>HTML</a>\n\n[ordinary](missing.txt)", image.reference, first.reference, second.reference);
    put(&mut store, &id, &markup);
    let path = store.read_stored(&id).unwrap().path.unwrap();
    store.sync_file(&id, &path, 1).unwrap();
    assert_eq!(fs::read_to_string(&note).unwrap(), markup);
    let other_note = target.join("renamed.md");
    store.save_file(&id, Some(&other_note)).unwrap();
    assert_eq!(fs::read_to_string(&other_note).unwrap(), markup);
    assert_eq!(fs::read(target.join("合成 #笔记.assets").join(second.name)).unwrap(), b"second");
    let fresh_id = store.open_file(&note).unwrap().active_id.unwrap();
    assert_eq!(store.resource_image(&fresh_id, &image.reference).unwrap().0, SVG);
    assert_eq!(store.resource_image(&id, &image.reference).unwrap().0, SVG);
    let new = import(&mut store, &id, b"new", "附件.bin", false);
    assert_eq!(new.reference, "renamed.assets/%E9%99%84%E4%BB%B6.bin");
}

#[cfg(any(windows, unix))]
#[test]
fn document_asset_directory_link_cannot_read_write_or_reveal_outside() {
    let (dir, mut store, _) = setup();
    let source = dir.path().join("source");
    let outside = dir.path().join("outside");
    fs::create_dir(&source).unwrap();
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("existing.png"), png()).unwrap();
    let note = source.join("note.md");
    fs::write(&note, "").unwrap();
    directory_link(&source.join("note.assets"), &outside);
    let id = store.open_file(&note).unwrap().active_id.unwrap();
    let input = ResourceInput { name: "new.txt".into(), size: 1, image: false };
    assert!(store.import_resources(&id, &[input], b"x").is_err());
    assert!(!outside.join("new.txt").exists());
    assert!(store.resource_image(&id, "note.assets/existing.png").is_err());
    assert!(store.managed_attachment(&id, "note.assets/existing.png").is_err());
}

#[cfg(any(windows, unix))]
#[test]
fn binding_does_not_follow_a_replaced_document_directory() {
    let (dir, mut store, draft) = setup();
    let source = dir.path().join("source");
    let outside = dir.path().join("outside");
    fs::create_dir(&source).unwrap();
    fs::create_dir_all(outside.join("note.assets")).unwrap();
    let note = source.join("note.md");
    fs::write(&note, "").unwrap();
    fs::write(outside.join("note.md"), "").unwrap();
    fs::write(outside.join("neighbor.png"), png()).unwrap();
    fs::write(outside.join("note.assets").join("other.png"), png()).unwrap();
    let old = import(&mut store, &draft, &png(), "retained.png", true);
    let id = store.open_file(&note).unwrap().active_id.unwrap();
    store.reuse_resources(&id, &[reference(&old, true)]).unwrap();

    fs::rename(&source, dir.path().join("original")).unwrap();
    directory_link(&source, &outside);
    assert!(store.resource_image(&id, "neighbor.png").is_err());
    assert!(store.resource_image(&id, "./note.assets/other.png").is_err());
    assert!(store.managed_attachment(&id, "note%2Eassets/other.png").is_err());
    let input = ResourceInput { name: "new.txt".into(), size: 1, image: false };
    assert!(store.import_resources(&id, &[input], b"x").is_err());
    assert!(!outside.join("note.assets").join("new.txt").exists());
    assert_eq!(store.resource_image(&id, &old.reference).unwrap().0, png());
}

#[test]
fn attachment_path_aliases_are_revealed_and_copied_within_the_bound_directory() {
    let (dir, mut store, _) = setup();
    let source = dir.path().join("source");
    let target = dir.path().join("target");
    fs::create_dir_all(source.join("note.assets")).unwrap();
    fs::create_dir(&target).unwrap();
    let note = source.join("note.md");
    let markdown = "[first](./note.assets/first.txt)\n\n<a href='note%2Eassets/second.txt'>second</a>\n";
    fs::write(&note, markdown).unwrap();
    fs::write(source.join("note.assets/first.txt"), "first").unwrap();
    fs::write(source.join("note.assets/second.txt"), "second").unwrap();
    let id = store.open_file(&note).unwrap().active_id.unwrap();
    for (href, contents) in [
        ("./note.assets/first.txt", "first"),
        ("note%2Eassets/second.txt", "second"),
    ] {
        assert_eq!(fs::read_to_string(store.managed_attachment(&id, href).unwrap().unwrap()).unwrap(), contents);
    }
    assert!(store.managed_attachment(&id, "../source/note%2Eassets/second.txt").is_err());
    let copy = target.join("renamed.md");
    store.save_file(&id, Some(&copy)).unwrap();
    assert_eq!(fs::read_to_string(copy).unwrap(), markdown);
    assert_eq!(fs::read_to_string(target.join("note.assets/first.txt")).unwrap(), "first");
    assert_eq!(fs::read_to_string(target.join("note.assets/second.txt")).unwrap(), "second");
}

#[test]
fn clipboard_copies_scoped_document_images_into_a_bound_file_or_draft() {
    let (dir, mut store, draft) = setup();
    let source = dir.path().join("source");
    let target = dir.path().join("target");
    fs::create_dir(&source).unwrap();
    fs::create_dir(&target).unwrap();
    let source_note = source.join("first.md");
    let target_note = target.join("second.md");
    fs::write(&source_note, "").unwrap();
    fs::write(&target_note, "").unwrap();
    let from = store.open_file(&source_note).unwrap().active_id.unwrap();
    let to = store.open_file(&target_note).unwrap().active_id.unwrap();
    let source_path = store.read_stored(&from).unwrap().path.unwrap();
    let image = import(&mut store, &from, SVG, "my image.svg", true);
    let attachment = import(&mut store, &from, b"not an image", "secret.txt", false);
    for reference in [attachment.reference, "../first.assets/my%20image.svg".into(), "other.svg".into()] {
        assert!(store.copy_document_images(&from, &source_path, &to, &[image.reference.clone(), reference], &[]).is_err());
        assert!(!target.join("second.assets").exists());
    }
    let refs = [image.reference];
    let copied = store.copy_document_images(&from, &source_path, &to, &refs, &[]).unwrap();
    assert_eq!(copied, ["second.assets/my%20image.svg"]);
    assert_eq!(fs::read(target.join("second.assets/my image.svg")).unwrap(), SVG);
    assert_eq!(fs::read(source.join("first.assets/my image.svg")).unwrap(), SVG);
    assert!(!store.profile.join("resources").exists());
    assert_eq!(store.copy_document_images(&from, &source_path, &to, &refs, &[]).unwrap(), copied);
    let copied = store.copy_document_images(&from, &source_path, &draft, &refs, &[]).unwrap();
    assert!(copied[0].starts_with(PREFIX));
    assert_eq!(store.resource_image(&draft, &copied[0]).unwrap().0, SVG);
    assert!(store.resource_image(&to, &copied[0]).is_err());
    assert!(store.copy_document_images(&draft, &source_path, &to, &refs, &[]).is_err());
}

#[test]
fn clipboard_rejects_source_save_as_before_importing_or_binding_assets() {
    let (dir, mut store, draft) = setup();
    let source = dir.path().join("first.md");
    let moved = dir.path().join("moved");
    let target = dir.path().join("target");
    fs::create_dir_all(moved.join("first.assets")).unwrap();
    fs::create_dir(&target).unwrap();
    let destination = target.join("second.md");
    fs::write(&source, "").unwrap();
    fs::write(&destination, "").unwrap();
    let from = store.open_file(&source).unwrap().active_id.unwrap();
    let to = store.open_file(&destination).unwrap().active_id.unwrap();
    let source_path = store.read_stored(&from).unwrap().path.unwrap();
    let original = br#"<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" fill="green"/></svg>"#;
    let replacement = br#"<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" fill="blue"/></svg>"#;
    let image = import(&mut store, &from, original, "color.svg", true);
    let legacy = import(&mut store, &draft, &png(), "retained.png", true);
    fs::write(moved.join(&image.reference), replacement).unwrap();
    store.save_file(&from, Some(&moved.join("first.md"))).unwrap();
    assert_eq!(store.resource_image(&from, &image.reference).unwrap().0, replacement);
    let error = store
        .copy_document_images(&from, &source_path, &to, &[image.reference], &[reference(&legacy, true)])
        .unwrap_err();
    assert!(error.to_string().contains("请重新复制"));
    assert!(!target.join("second.assets").exists());
    assert!(store.managed_attachment(&to, &legacy.reference).unwrap().is_none());
    assert_eq!(fs::read_to_string(destination).unwrap(), "");
}

#[test]
fn clipboard_reuses_nine_same_directory_images_without_importing() {
    let (dir, mut store, draft) = setup();
    let source = dir.path().join("first.md");
    let sibling = dir.path().join("second.md");
    fs::write(&source, "").unwrap();
    fs::write(&sibling, "").unwrap();
    let from = store.open_file(&source).unwrap().active_id.unwrap();
    let to = store.open_file(&sibling).unwrap().active_id.unwrap();
    let source_path = store.read_stored(&from).unwrap().path.unwrap();
    let bytes = png();
    let refs: Vec<_> = (1..=9).map(|i| import(&mut store, &from, &bytes, &format!("{i}.png"), true).reference).collect();
    assert_eq!(store.copy_document_images(&from, &source_path, &to, &refs, &[]).unwrap(), refs);
    let error = store.copy_document_images(&from, &source_path, &draft, &refs, &[]).unwrap_err();
    assert!(error.to_string().contains("8 张"));
    assert!(!dir.path().join("second.assets").exists());
    assert!(!store.profile.join("resources").exists());
}
#[test]
fn durable_image_ownership_reopen_title_shelf_and_undo_new_id() {
    let (dir, mut store, id) = setup();
    let bytes = png();
    let image = import(&mut store, &id, &bytes, "假扩展名.jpg", true);
    assert_eq!(image.mime, "image/png");
    assert!(image.reference.ends_with(".png"));
    assert!(!image.reference.contains(&id));
    assert!(!image.reference.contains("草稿"));
    let markup = format!("![合成图]({})", image.reference);
    put(&mut store, &id, &markup);
    let other = store.create("other", "B").unwrap().active_id.unwrap();
    assert!(store.resource_image(&other, &image.reference).is_err());
    store.rename(&id, "新名字").unwrap();
    store.shelve(&id).unwrap();
    let path = store
        .managed_attachment(&id, &image.reference)
        .unwrap()
        .unwrap();
    drop(store);
    let mut store = Store::open(&dir.path().join("profile"), MAX_SESSION_BYTES).unwrap();
    assert_eq!(
        store.resource_image(&id, &image.reference).unwrap().0,
        bytes
    );
    assert_eq!(store.read_stored(&id).unwrap().markdown, markup);
    store.remove(&id, "discard").unwrap();
    assert!(path.exists());
    store.conn.execute_batch("CREATE TRIGGER fail_restore BEFORE INSERT ON documents BEGIN SELECT RAISE(ABORT,'undo failed');END;").unwrap();
    assert!(store.undo_remove().is_err());
    assert!(store.last_removed.is_some());
    store
        .conn
        .execute_batch("DROP TRIGGER fail_restore")
        .unwrap();
    let snapshot = store.undo_remove().unwrap();
    let restored = snapshot
        .documents
        .iter()
        .find(|d| d.title == "新名字")
        .unwrap();
    assert_ne!(restored.id, id);
    assert!(restored.shelved);
    assert_eq!(snapshot.active_id.as_deref(), Some(other.as_str()));
    assert_eq!(
        store
            .resource_image(&restored.id, &image.reference)
            .unwrap()
            .0,
        bytes
    );
}
#[test]
fn batch_validation_and_registration_rollback_never_insert_or_leave_partial_bindings() {
    let (_dir, mut store, id) = setup();
    let bytes = png();
    let mut payload = bytes.clone();
    payload.extend(b"<svg/>");
    let input = vec![
        ResourceInput {
            name: "ok.png".into(),
            size: bytes.len(),
            image: true,
        },
        ResourceInput {
            name: "bad.png".into(),
            size: 6,
            image: true,
        },
    ];
    assert!(store.import_resources(&id, &input, &payload).is_err());
    assert_eq!(
        store
            .conn
            .query_row::<i64, _, _>("SELECT count(*) FROM resource_objects", [], |r| r.get(0))
            .unwrap(),
        0
    );
    store.conn.execute_batch("CREATE TRIGGER fail_bind BEFORE INSERT ON resource_bindings BEGIN SELECT RAISE(ABORT,'registration failed');END;").unwrap();
    assert!(store.import_resources(&id, &input[..1], &bytes).is_err());
    assert_eq!(
        fs::read_dir(store.object_root().unwrap()).unwrap().count(),
        0
    );
    assert_eq!(store.read_stored(&id).unwrap().markdown, "正文");
    store.conn.execute_batch("DROP TRIGGER fail_bind").unwrap();
    let item = import(&mut store, &id, &bytes, "valid.png", true);
    let again = import(&mut store, &id, &bytes, "same.png", true);
    assert_eq!(again.reference, item.reference);
    assert_eq!(
        fs::read_dir(store.object_root().unwrap()).unwrap().count(),
        1
    );
}
#[test]
fn resource_commit_failure_rolls_back_registry_and_removes_only_new_objects() {
    let (_dir, mut store, id) = setup();
    let retained = import(&mut store, &id, b"keep", "keep.txt", false);
    let path = store
        .managed_attachment(&id, &retained.reference)
        .unwrap()
        .unwrap();
    store.conn.execute_batch("PRAGMA foreign_keys=ON;CREATE TABLE parent(id INTEGER PRIMARY KEY);CREATE TABLE deferred_guard(id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED);CREATE TRIGGER fail_resource_commit AFTER INSERT ON resource_bindings BEGIN INSERT INTO deferred_guard VALUES(42);END;").unwrap();
    let bytes = png();
    assert!(store
        .import_resources(
            &id,
            &[ResourceInput {
                name: "new.png".into(),
                size: bytes.len(),
                image: true
            }],
            &bytes
        )
        .is_err());
    assert!(path.exists());
    assert_eq!(
        fs::read_dir(store.object_root().unwrap()).unwrap().count(),
        1
    );
    assert_eq!(
        store
            .conn
            .query_row::<i64, _, _>("SELECT count(*) FROM resource_objects", [], |r| r.get(0))
            .unwrap(),
        1
    );
}
#[test]
fn actual_formats_lengths_and_resource_quota_are_checked_separately_from_document_capacity() {
    let (_dir, mut store, id) = setup();
    for bytes in [
        &b"<svg xmlns='x'/>"[..],
        &b"\x89PNG\r\n\x1a\nbad"[..],
        &b"not an image"[..],
    ] {
        assert!(store
            .import_resources(
                &id,
                &[ResourceInput {
                    name: "fake.png".into(),
                    size: bytes.len(),
                    image: true
                }],
                bytes
            )
            .is_err());
    }
    let bytes = png();
    assert!(store
        .import_resources(
            &id,
            &[ResourceInput {
                name: "x.png".into(),
                size: bytes.len() + 1,
                image: true
            }],
            &bytes
        )
        .is_err());
    assert!(store
        .import_resources(
            &id,
            &vec![
                ResourceInput {
                    name: "x".into(),
                    size: 0,
                    image: false
                };
                9
            ],
            &[]
        )
        .is_err());
    assert!(budget(MAX_OBJECT_BYTES + 1, 1).is_err());
    assert!(budget(1, MAX_OBJECTS + 1).is_err());
    let root = store.object_root().unwrap();
    // Retained/orphan objects count too; only empty temporary files here.
    for n in 0..MAX_OBJECTS {
        File::create(root.join(format!("retained-{}", n))).unwrap();
    }
    assert!(store
        .import_resources(
            &id,
            &[ResourceInput {
                name: "one.txt".into(),
                size: 1,
                image: false
            }],
            b"x"
        )
        .is_err());
    assert_eq!(store.read_stored(&id).unwrap().markdown, "正文");
}
#[test]
fn save_as_materializes_resources_without_markdown_rewrite_and_reuses_identical_files() {
    let (dir, mut store, id) = setup();
    let bytes = png();
    let image = import(&mut store, &id, &bytes, "img.png", true);
    let attachment = import(&mut store, &id, b"synthetic attachment", "doc.txt", false);
    let markup = format!(
        "# 原标题\n\n![图]({})\n\n[附件]({})\n",
        image.reference, attachment.reference
    );
    put(&mut store, &id, &markup);
    let revision = store.read_stored(&id).unwrap().revision;
    let out = dir.path().join("export");
    fs::create_dir(&out).unwrap();
    let target = out.join("note.md");
    store.save_file(&id, Some(&target)).unwrap();
    assert_eq!(fs::read_to_string(&target).unwrap(), markup);
    assert_eq!(fs::read(out.join(&image.reference)).unwrap(), bytes);
    assert_eq!(
        fs::read(out.join(&attachment.reference)).unwrap(),
        b"synthetic attachment"
    );
    assert_eq!(store.read_stored(&id).unwrap().revision, revision);
    store.save_file(&id, Some(&target)).unwrap();
    // Reopened export can render its relative image without any profile binding.
    drop(store);
    let mut other = Store::open(&dir.path().join("other-profile"), MAX_SESSION_BYTES).unwrap();
    let reopened = other.open_file(&target).unwrap().active_id.unwrap();
    assert_eq!(
        other.resource_image(&reopened, &image.reference).unwrap().0,
        bytes
    );
}
#[test]
fn save_as_conflict_or_resource_directory_failure_preserves_existing_files_and_draft() {
    let (dir, mut store, id) = setup();
    let bytes = png();
    let image = import(&mut store, &id, &bytes, "x.png", true);
    let markup = format!("![图]({})", image.reference);
    put(&mut store, &id, &markup);
    let out = dir.path().join("export");
    fs::create_dir(&out).unwrap();
    let target = out.join("note.md");
    fs::write(&target, "ORIGINAL").unwrap();
    fs::create_dir(out.join(".frowd-assets")).unwrap();
    let asset = out.join(&image.reference);
    fs::write(&asset, b"different data").unwrap();
    assert!(store.save_file(&id, Some(&target)).is_err());
    assert_eq!(fs::read_to_string(&target).unwrap(), "ORIGINAL");
    assert_eq!(fs::read(&asset).unwrap(), b"different data");
    assert!(store.read_stored(&id).unwrap().path.is_none());
    assert_eq!(store.read_stored(&id).unwrap().markdown, markup);
    let blocked = dir.path().join("blocked");
    fs::create_dir(&blocked).unwrap();
    fs::write(blocked.join(".frowd-assets"), "not a directory").unwrap();
    assert!(store.save_file(&id, Some(&blocked.join("new.md"))).is_err());
    assert!(!blocked.join("new.md").exists());
    assert!(store.read_stored(&id).unwrap().path.is_none());
}
#[test]
fn markdown_write_and_postwrite_commit_failures_have_distinct_truthful_outcomes() {
    let (dir, mut store, id) = setup();
    let image = import(&mut store, &id, &png(), "x.png", true);
    let markup = format!("![图]({})", image.reference);
    put(&mut store, &id, &markup);
    let out = dir.path().join("export");
    fs::create_dir(&out).unwrap();
    // persist to an existing nonempty directory must fail, never replace it.
    let blocked = out.join("blocked.md");
    fs::create_dir(&blocked).unwrap();
    fs::write(blocked.join("sentinel"), "keep").unwrap();
    assert!(store.save_file(&id, Some(&blocked)).is_err());
    assert_eq!(
        fs::read_to_string(blocked.join("sentinel")).unwrap(),
        "keep"
    );
    assert!(store.read_stored(&id).unwrap().path.is_none());
    store.conn.execute_batch("PRAGMA foreign_keys=ON;CREATE TABLE parent(id INTEGER PRIMARY KEY);CREATE TABLE deferred_guard(id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED);CREATE TRIGGER fail_save_commit AFTER UPDATE OF path ON documents BEGIN INSERT INTO deferred_guard VALUES(42);END;").unwrap();
    let target = out.join("written.md");
    let error = store.save_file(&id, Some(&target)).unwrap_err().to_string();
    assert!(
        error.contains("文件已保存至") && error.contains("关联提交失败"),
        "{}",
        error
    );
    assert_eq!(fs::read_to_string(&target).unwrap(), markup);
    assert!(store.read_stored(&id).unwrap().path.is_none());
    assert!(store.read_stored(&id).unwrap().dirty());
    assert!(out.join(&image.reference).is_file());
}
#[test]
fn auto_sync_copies_owned_images_for_a_standalone_file_and_preserves_existing_copies() {
    let (dir, mut store, original) = setup();
    let image = import(&mut store, &original, &png(), "x.png", true);
    let unused = import(&mut store, &original, b"other", "unused.txt", false);
    let target = dir.path().join("note.md");
    fs::write(&target, "original").unwrap();
    let id = store.open_file(&target).unwrap().active_id.unwrap();
    let path = store.read_stored(&id).unwrap().path.unwrap();
    store.reuse_resources(&id, &[reference(&image, true), reference(&unused, false)]).unwrap();
    let markup = format!("![图]({})", image.reference);
    put(&mut store, &id, &markup);
    store.sync_file(&id, &path, 1).unwrap();
    let out = dir.path().join(&image.reference);
    assert_eq!(fs::read(&out).unwrap(), png());
    assert!(!dir.path().join(&unused.reference).exists());
    assert_eq!(store.resource_image(&id, &image.reference).unwrap().0, png());
    fs::write(&out, "externally replaced").unwrap();
    put(&mut store, &id, &format!("{markup}\n\nsecond edit"));
    assert!(store.sync_file(&id, &path, 2).is_err());
    assert_eq!(fs::read_to_string(&target).unwrap(), markup);
    assert_eq!(fs::read_to_string(&out).unwrap(), "externally replaced");
}

#[test]
fn auto_sync_retains_missing_unbound_references_without_resolving_or_copying_them() {
    let (dir, mut store, other) = setup();
    let image = import(&mut store, &other, &png(), "other.png", true);
    let note = dir.path().join("note.md");
    let original = format!("![旧图]({})\n", image.reference);
    fs::write(&note, &original).unwrap();
    let id = store.open_file(&note).unwrap().active_id.unwrap();
    let path = store.read_stored(&id).unwrap().path.unwrap();
    let edited = format!("{original}\n普通文字编辑");
    store.update(&id, &edited, 1).unwrap();

    let snapshot = store.sync_file(&id, &path, 1).unwrap();
    let confirmed = snapshot.documents.iter().find(|doc| doc.id == id).unwrap();
    assert!(!confirmed.dirty && !confirmed.conflict);
    assert_eq!(fs::read_to_string(&note).unwrap(), edited);
    assert!(!dir.path().join(&image.reference).exists());
    assert!(store.managed_attachment(&id, &image.reference).unwrap().is_none());

    assert!(store.save_file(&id, None).is_err());
    let export = dir.path().join("export.md");
    assert!(store.save_file(&id, Some(&export)).is_err());
    assert!(!export.exists());
}
#[test]
fn save_as_copies_only_referenced_owned_directory_rasters_and_preserves_bom_eol() {
    let (dir, mut store, _) = setup();
    let source = dir.path().join("source");
    fs::create_dir(&source).unwrap();
    let bytes = png();
    fs::write(source.join("image.png"), &bytes).unwrap();
    fs::write(source.join("secret.txt"), "not copied").unwrap();
    let markdown = "![图](image.png)\n\n[普通文件](secret.txt)\n";
    let target = source.join("input.md");
    let encoded = format!("\u{feff}{}", markdown.replace('\n', "\r\n"));
    fs::write(&target, encoded.as_bytes()).unwrap();
    let id = store.open_file(&target).unwrap().active_id.unwrap();
    let out = dir.path().join("out");
    fs::create_dir(&out).unwrap();
    let exported = out.join("copy.md");
    store.save_file(&id, Some(&exported)).unwrap();
    assert_eq!(fs::read(&exported).unwrap(), encoded.as_bytes());
    assert_eq!(fs::read(out.join("image.png")).unwrap(), bytes);
    assert!(!out.join("secret.txt").exists());
}

#[test]
fn html_images_and_reference_images_export_with_entities_without_rewriting_markdown() {
    let (dir, mut store, _) = setup();
    let source = dir.path().join("html-source");
    let out = dir.path().join("html-export");
    fs::create_dir(&source).unwrap();
    fs::create_dir(&out).unwrap();
    let bytes = png();
    for name in ["a & b.png", "中文.png", "reference.png", "plain.png"] {
        fs::write(source.join(name), &bytes).unwrap();
    }
    let markdown = "# HTML images\n\n<div><IMG alt='quoted > value' SRC=\"a%20&amp;%20b.png?size=1#preview\"><img src='&#x4e2d;&#25991;.png'><img src=plain.png></div>\n\n![reference][asset]\n\n[asset]: reference.png\n\n<img src='https://example.invalid/remote.png'>\n<img src='//example.invalid/remote.png'>\n<img src='DATA:image/png;base64,AAAA'>\n<a href='missing.pdf'>ordinary link</a>\n";
    let original = source.join("original.md");
    fs::write(&original, markdown).unwrap();
    let id = store.open_file(&original).unwrap().active_id.unwrap();
    let target = out.join("copy.md");
    store.save_file(&id, Some(&target)).unwrap();
    assert_eq!(fs::read_to_string(target).unwrap(), markdown);
    for name in ["a & b.png", "中文.png", "reference.png", "plain.png"] {
        assert_eq!(fs::read(out.join(name)).unwrap(), bytes);
    }
    let mut reopened = Store::open(&dir.path().join("fresh-profile"), MAX_SESSION_BYTES).unwrap();
    let reopened_id = reopened
        .open_file(&out.join("copy.md"))
        .unwrap()
        .active_id
        .unwrap();
    assert_eq!(
        reopened
            .resource_image(&reopened_id, "a%20&%20b.png")
            .unwrap()
            .0,
        bytes
    );
}

#[test]
fn resource_parser_ignores_code_comments_raw_text_and_fake_tags_in_attributes() {
    let markdown = r#"`<img src="inline.png">`

```html
<img src="fenced.png">
![fenced](fenced-md.png)
```

    <img src="indented.png">

<!-- <img src="comment.png"> -->
<div title='<img src="attribute.png">'>text</div>
<script>
<img src="script.png">

![inside script](script-md.png)
</script>

<style><img src="style.png"></style>
<textarea><img src="textarea.png"></textarea>
<title><img src="title.png"></title>
<xmp><img src="xmp.png"></xmp>
<iframe><img src="iframe.png"></iframe>
<noembed><img src="noembed.png"></noembed>
<noframes><img src="noframes.png"></noframes>
<noscript><img src="noscript.png"></noscript>
<img src="actual.png">
<plaintext><img src="plaintext.png">
"#;
    assert_eq!(
        markdown_resources(markdown),
        vec![("actual.png".into(), true)]
    );
}

#[test]
fn managed_html_resources_survive_restart_and_html_conflicts_preserve_draft() {
    let (dir, mut store, id) = setup();
    let bytes = png();
    let image = import(&mut store, &id, &bytes, "html.png", true);
    let attachment = import(&mut store, &id, b"attachment", "notes.txt", false);
    let markup = format!(
        "<img src='{}'>\n<a href='{}'>attachment</a>\n",
        image.reference, attachment.reference
    );
    put(&mut store, &id, &markup);
    drop(store);
    let mut store = Store::open(&dir.path().join("profile"), MAX_SESSION_BYTES).unwrap();
    let out = dir.path().join("html-managed");
    fs::create_dir(&out).unwrap();
    fs::create_dir(out.join(".frowd-assets")).unwrap();
    let asset = out.join(&image.reference);
    fs::write(&asset, b"conflicting image").unwrap();
    let target = out.join("copy.md");
    fs::write(&target, "keep existing markdown").unwrap();
    assert!(store.save_file(&id, Some(&target)).is_err());
    assert!(store.read_stored(&id).unwrap().path.is_none());
    assert_eq!(store.read_stored(&id).unwrap().markdown, markup);
    assert_eq!(
        fs::read_to_string(&target).unwrap(),
        "keep existing markdown"
    );
    assert_eq!(fs::read(&asset).unwrap(), b"conflicting image");
    fs::remove_file(&asset).unwrap();
    store.save_file(&id, Some(&target)).unwrap();
    assert_eq!(fs::read(asset).unwrap(), bytes);
    assert_eq!(
        fs::read(out.join(&attachment.reference)).unwrap(),
        b"attachment"
    );
}

#[test]
fn html_image_encoded_escape_stays_within_document_directory() {
    let (dir, mut store, id) = setup();
    let out = dir.path().join("html-escape");
    fs::create_dir(&out).unwrap();
    let target = out.join("copy.md");
    for reference in [
        "&#46;&#46;/outside.png",
        "%2e%2e/outside.png",
        "C:&#92;outside.png",
    ] {
        let markup = format!("<img src='{reference}'>");
        put(&mut store, &id, &markup);
        assert!(store.save_file(&id, Some(&target)).is_err(), "{reference}");
        assert!(!target.exists());
        assert!(store.read_stored(&id).unwrap().path.is_none());
        assert_eq!(store.read_stored(&id).unwrap().markdown, markup);
    }
}
#[test]
fn escaping_missing_and_modified_resources_are_rejected_without_document_write() {
    let (dir, mut store, id) = setup();
    for reference in [
        "../escape.png",
        "%2e%2e/escape.png",
        "/abs.png",
        "C:/abs.png",
        "x%00.png",
        "https://example.test/a.png",
    ] {
        assert!(
            store.resource_image(&id, reference).is_err(),
            "{}",
            reference
        );
    }
    put(&mut store, &id, "![missing](relative.png)");
    let out = dir.path().join("out");
    fs::create_dir(&out).unwrap();
    assert!(store.save_file(&id, Some(&out.join("note.md"))).is_err());
    put(&mut store, &id, "<img src='relative.png'>");
    assert!(store.save_file(&id, Some(&out.join("note.md"))).is_err());
    assert!(!out.join("note.md").exists());
    let item = import(&mut store, &id, &png(), "x.png", true);
    let path = store
        .managed_attachment(&id, &item.reference)
        .unwrap()
        .unwrap();
    fs::write(path, "corrupt").unwrap();
    assert!(store.resource_image(&id, &item.reference).is_err());
}
#[test]
fn additive_resource_schema_keeps_schema3_rows_and_failed_migration_rolls_back() {
    let (dir, store, id) = setup();
    drop(store);
    let database = dir.path().join("profile").join("drafts.sqlite");
    let conn = Connection::open(&database).unwrap();
    conn.execute_batch("DROP TABLE resource_bindings;DROP TABLE resource_objects;CREATE VIEW resource_bindings AS SELECT id AS docId FROM documents;").unwrap();
    drop(conn);
    assert!(Store::open(&dir.path().join("profile"), MAX_SESSION_BYTES).is_err());
    let conn = Connection::open(&database).unwrap();
    assert_eq!(
        conn.query_row::<String, _, _>(
            "SELECT markdown FROM documents WHERE id=?1",
            params![id],
            |r| r.get(0)
        )
        .unwrap(),
        "正文"
    );
    assert_eq!(
        conn.query_row::<i64, _, _>(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='resource_objects'",
            [],
            |r| r.get(0)
        )
        .unwrap(),
        0
    );
    conn.execute_batch("DROP VIEW resource_bindings;").unwrap();
    drop(conn);
    let store = Store::open(&dir.path().join("profile"), MAX_SESSION_BYTES).unwrap();
    assert_eq!(store.read_stored(&id).unwrap().markdown, "正文");
    assert_eq!(
        store
            .conn
            .query_row::<String, _, _>("SELECT value FROM settings WHERE key='version'", [], |r| r
                .get(0))
            .unwrap(),
        "4"
    );
}

#[test]
fn all_supported_raster_formats_decode_and_incorrect_extension_is_not_trusted() {
    for (format, mime) in [
        (ImageFormat::Png, "image/png"),
        (ImageFormat::Jpeg, "image/jpeg"),
        (ImageFormat::Gif, "image/gif"),
        (ImageFormat::WebP, "image/webp"),
    ] {
        let mut buffer = Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(3, 2)
            .write_to(&mut buffer, format)
            .unwrap();
        assert_eq!(kind(buffer.get_ref(), "spoof.txt", true).unwrap().1, mime);
        assert_eq!(validate_image(buffer.get_ref()).unwrap(), mime);
    }
}
#[test]
fn transient_raster_validation_reuses_dimension_and_pixel_limits() {
    for (width, height, reason) in [(12001u32, 1u32, "尺寸超过限制"), (8000, 6000, "4000 万像素")] {
        let mut bytes = png();
        // A small PNG with a valid IHDR CRC advertising oversized dimensions.
        // No enormous pixel buffer is allocated to create this hostile fixture.
        bytes[16..20].copy_from_slice(&width.to_be_bytes());
        bytes[20..24].copy_from_slice(&height.to_be_bytes());
        let mut crc = !0u32;
        for byte in &bytes[12..29] {
            crc ^= u32::from(*byte);
            for _ in 0..8 { crc = (crc >> 1) ^ (0xedb88320 & 0u32.wrapping_sub(crc & 1)); }
        }
        bytes[29..33].copy_from_slice(&(!crc).to_be_bytes());
        let error = validate_image(&bytes).unwrap_err().to_string();
        assert!(error.contains(reason), "{error}");
    }
}
#[cfg(windows)]
fn directory_link(link: &Path, target: &Path) {
    let result = std::process::Command::new("cmd.exe")
        .args(["/D", "/C", "mklink", "/J"])
        .arg(link)
        .arg(target)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "Temporary junction setup failed: {}",
        String::from_utf8_lossy(&result.stderr)
    );
}
#[cfg(unix)]
fn directory_link(link: &Path, target: &Path) {
    std::os::unix::fs::symlink(target, link).unwrap();
}
#[cfg(any(windows, unix))]
#[test]
fn canonical_boundaries_reject_profile_target_and_external_image_directory_links() {
    let (dir, mut store, id) = setup();
    let outside = dir.path().join("outside");
    fs::create_dir(&outside).unwrap();
    // No object directory may be created outside profile before validation.
    directory_link(&store.profile.join("resources"), &outside);
    assert!(store.object_root().is_err());
    assert!(!outside.join("objects").exists());
    #[cfg(windows)]
    fs::remove_dir(store.profile.join("resources")).unwrap();
    #[cfg(unix)]
    fs::remove_file(store.profile.join("resources")).unwrap();
    let image = import(&mut store, &id, &png(), "ok.png", true);
    put(&mut store, &id, &format!("![图]({})", image.reference));
    let out = dir.path().join("export");
    fs::create_dir(&out).unwrap();
    directory_link(&out.join(".frowd-assets"), &outside);
    assert!(store.save_file(&id, Some(&out.join("note.md"))).is_err());
    put(&mut store, &id, &format!("<img src='{}'>", image.reference));
    assert!(store.save_file(&id, Some(&out.join("note.md"))).is_err());
    assert!(!out.join("note.md").exists());
    assert_eq!(fs::read_dir(&outside).unwrap().count(), 0);
    let source = dir.path().join("source");
    fs::create_dir(&source).unwrap();
    fs::write(outside.join("external.png"), png()).unwrap();
    directory_link(&source.join("link"), &outside);
    fs::write(source.join("input.md"), "![escape](link/external.png)").unwrap();
    let file = store
        .open_file(&source.join("input.md"))
        .unwrap()
        .active_id
        .unwrap();
    assert!(store.resource_image(&file, "link/external.png").is_err());
    put(&mut store, &file, "<img src='link/external.png'>");
    assert!(store.save_file(&file, Some(&out.join("html.md"))).is_err());
    assert!(!out.join("html.md").exists());
    // Remove the temporary links explicitly before TempDir cleanup.
    #[cfg(windows)]
    {
        fs::remove_dir(source.join("link")).unwrap();
        fs::remove_dir(out.join(".frowd-assets")).unwrap();
    }
    #[cfg(unix)]
    {
        fs::remove_file(source.join("link")).unwrap();
        fs::remove_file(out.join(".frowd-assets")).unwrap();
    }
}

#[test]
fn export_resource_may_not_alias_the_target_markdown_file() {
    let (dir, mut store, _) = setup();
    let input = dir.path().join("input");
    fs::create_dir(&input).unwrap();
    fs::write(input.join("copy.md"), png()).unwrap();
    fs::write(input.join("note.md"), "![图](copy.md)").unwrap();
    let id = store
        .open_file(&input.join("note.md"))
        .unwrap()
        .active_id
        .unwrap();
    let out = dir.path().join("out");
    fs::create_dir(&out).unwrap();
    let error = store
        .save_file(&id, Some(&out.join("copy.md")))
        .unwrap_err();
    assert!(error.to_string().contains("目标 Markdown"));
    assert!(!out.join("copy.md").exists());
}

#[test]
fn repeated_attachment_and_image_destination_still_validates_the_image_use() {
    let (dir, mut store, id) = setup();
    let item = import(&mut store, &id, b"ordinary bytes", "data.txt", false);
    let markup = format!("[attachment]({0})\n\n![invalid image]({0})", item.reference);
    put(&mut store, &id, &markup);
    let out = dir.path().join("export");
    fs::create_dir(&out).unwrap();
    assert!(store.save_file(&id, Some(&out.join("note.md"))).is_err());
    assert!(!out.join("note.md").exists());
}

fn reference(item: &ResourceInfo, image: bool) -> ResourceReference {
    ResourceReference {
        reference: item.reference.clone(),
        image,
    }
}
#[test]
fn clipboard_reuse_keeps_objects_without_copy_and_survives_source_removal_export_and_fresh_undo() {
    let (dir, mut store, a) = setup();
    let bytes = png();
    let image = import(&mut store, &a, &bytes, "a.png", true);
    let attachment = import(&mut store, &a, b"attachment", "a.txt", false);
    let b = store.create("B", "target").unwrap().active_id.unwrap();
    store
        .reuse_resources(
            &b,
            &[reference(&image, true), reference(&attachment, false)],
        )
        .unwrap();
    assert_eq!(
        fs::read_dir(store.object_root().unwrap()).unwrap().count(),
        2
    );
    assert_eq!(store.read_stored(&b).unwrap().revision, 0);
    put(
        &mut store,
        &b,
        &format!(
            "![image]({})\n\n[attachment]({})",
            image.reference, attachment.reference
        ),
    );
    store.remove(&a, "discard").unwrap();
    assert_eq!(store.resource_image(&b, &image.reference).unwrap().0, bytes);
    let out = dir.path().join("export");
    fs::create_dir(&out).unwrap();
    store.save_file(&b, Some(&out.join("target.md"))).unwrap();
    assert_eq!(fs::read(out.join(&image.reference)).unwrap(), bytes);
    assert_eq!(
        fs::read(out.join(&attachment.reference)).unwrap(),
        b"attachment"
    );
    store.remove(&b, "discard").unwrap();
    let restored = store.undo_remove().unwrap().active_id.unwrap();
    assert_ne!(restored, b);
    assert_eq!(
        store.resource_image(&restored, &image.reference).unwrap().0,
        bytes
    );
    drop(store);
    let store = Store::open(&dir.path().join("profile"), MAX_SESSION_BYTES).unwrap();
    assert_eq!(
        store.resource_image(&restored, &image.reference).unwrap().0,
        bytes
    );
}
#[test]
fn clipboard_reuse_batch_rejects_missing_wrong_extension_tamper_and_unqualified_objects_atomically()
{
    for scenario in ["unknown", "extension", "missing", "tamper", "unbound"] {
        let (_dir, mut store, a) = setup();
        let good = import(&mut store, &a, b"good", "good.txt", false);
        let bad = import(&mut store, &a, &png(), "bad.png", true);
        let b = store.create("B text", "target").unwrap().active_id.unwrap();
        let mut requested = reference(&bad, true);
        match scenario {
            "unknown" => requested.reference = format!("{}{}.png", PREFIX, "b".repeat(64)),
            "extension" => requested.reference = requested.reference.replace(".png", ".jpg"),
            "missing" => fs::remove_file(
                store
                    .managed_attachment(&a, &bad.reference)
                    .unwrap()
                    .unwrap(),
            )
            .unwrap(),
            "tamper" => fs::write(
                store
                    .managed_attachment(&a, &bad.reference)
                    .unwrap()
                    .unwrap(),
                "tampered",
            )
            .unwrap(),
            "unbound" => {
                store
                    .conn
                    .execute(
                        "DELETE FROM resource_bindings WHERE hash=?1",
                        params![bad.id],
                    )
                    .unwrap();
            }
            _ => unreachable!(),
        }
        assert!(
            store
                .reuse_resources(&b, &[reference(&good, false), requested])
                .is_err(),
            "{}",
            scenario
        );
        let count: i64 = store
            .conn
            .query_row(
                "SELECT count(*) FROM resource_bindings WHERE docId=?1",
                params![b],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
        assert_eq!(store.read_stored(&b).unwrap().markdown, "B text");
        assert_eq!(store.read_stored(&b).unwrap().revision, 0);
    }
}
#[test]
fn clipboard_reuse_commit_failure_rolls_back_all_new_bindings() {
    let (_dir, mut store, a) = setup();
    let one = import(&mut store, &a, b"one", "one.txt", false);
    let two = import(&mut store, &a, b"two", "two.txt", false);
    let b = store.create("B", "target").unwrap().active_id.unwrap();
    store.conn.execute_batch("PRAGMA foreign_keys=ON;CREATE TABLE reuse_parent(id INTEGER PRIMARY KEY);CREATE TABLE reuse_deferred(id INTEGER REFERENCES reuse_parent(id) DEFERRABLE INITIALLY DEFERRED);CREATE TRIGGER fail_reuse_commit AFTER INSERT ON resource_bindings BEGIN INSERT INTO reuse_deferred VALUES(42);END;").unwrap();
    assert!(store
        .reuse_resources(&b, &[reference(&one, false), reference(&two, false)])
        .is_err());
    assert_eq!(
        store
            .conn
            .query_row::<i64, _, _>(
                "SELECT count(*) FROM resource_bindings WHERE docId=?1",
                params![b],
                |r| r.get(0)
            )
            .unwrap(),
        0
    );
    assert!(store
        .managed_attachment(&a, &one.reference)
        .unwrap()
        .is_some());
    assert!(store
        .managed_attachment(&a, &two.reference)
        .unwrap()
        .is_some());
}
#[test]
fn clipboard_reuse_rejects_paths_and_svg_image_intent_without_silent_attachment_downgrade() {
    let (_dir, mut store, a) = setup();
    let svg = import(&mut store, &a, b"<svg/>", "shape.svg", false);
    let b = store.create("B", "target").unwrap().active_id.unwrap();
    store
        .reuse_resources(&b, &[reference(&svg, false)])
        .unwrap();
    let error = store
        .reuse_resources(&b, &[reference(&svg, true)])
        .unwrap_err()
        .to_string();
    assert!(error.contains("安全的 SVG"));
    for path in [
        "../private.png",
        "C:/private.png",
        "blob:temporary",
        ".frowd-assets/../../private",
    ] {
        assert!(store
            .reuse_resources(
                &b,
                &[ResourceReference {
                    reference: path.into(),
                    image: false
                }]
            )
            .is_err());
    }
    // File presence without registry/ownership never qualifies a foreign profile object.
    let unregistered = format!("{}{}.txt", PREFIX, "c".repeat(64));
    fs::write(
        store
            .object_root()
            .unwrap()
            .join(unregistered.trim_start_matches(PREFIX)),
        "unregistered",
    )
    .unwrap();
    assert!(store
        .reuse_resources(
            &b,
            &[ResourceReference {
                reference: unregistered,
                image: false
            }]
        )
        .is_err());
}
