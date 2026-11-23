use super::*;
use std::{cell::RefCell, net::TcpListener, thread};
fn release(version: &str, source: &Source) -> Vec<u8> {
    let name = format!("frowd_{version}_x64-setup.exe");
    let url = |name: &str| if source.loopback.is_some() { source.feed.join(name).unwrap().to_string() }
        else { format!("https://github.com/frowang-ai/fromd/releases/download/v{version}/{name}") };
    serde_json::to_vec(&serde_json::json!({"tag_name":format!("v{version}"),"draft":false,"prerelease":false,"assets":[
        {"name":name,"browser_download_url":url(&name),"size":8},
        {"name":"SHA256SUMS.txt","browser_download_url":url("SHA256SUMS.txt"),"size":100}
    ]})).unwrap()
}
#[test]
fn renamed_asset_is_preferred_and_legacy_is_only_an_absent_name_fallback() {
    let source = Source::production();
    let mut value: serde_json::Value = serde_json::from_slice(&release("0.6.0", &source)).unwrap();
    let legacy = select_release(&serde_json::to_vec(&value).unwrap(), "0.5.2", &source, true).unwrap().unwrap();
    assert_eq!(legacy.filename, "frowd_0.6.0_x64-setup.exe");
    let renamed = serde_json::json!({"name":"fromd_0.6.0_x64-setup.exe", "size":8,
        "browser_download_url":"https://github.com/frowang-ai/fromd/releases/download/v0.6.0/fromd_0.6.0_x64-setup.exe"});
    value["assets"].as_array_mut().unwrap().push(renamed.clone());
    let selected = select_release(&serde_json::to_vec(&value).unwrap(), "0.5.2", &source, true).unwrap().unwrap();
    assert_eq!(selected.filename, "fromd_0.6.0_x64-setup.exe");
    assert!(selected.installer.unwrap().path().ends_with("/fromd_0.6.0_x64-setup.exe"));
    value["assets"].as_array_mut().unwrap().push(renamed);
    assert!(select_release(&serde_json::to_vec(&value).unwrap(), "0.5.2", &source, true).is_err());
    value["assets"].as_array_mut().unwrap().pop();
    value["assets"][2]["browser_download_url"] = "https://github.com/frowang-ai/frowd-releases/releases/download/v0.6.0/fromd_0.6.0_x64-setup.exe".into();
    assert!(select_release(&serde_json::to_vec(&value).unwrap(), "0.5.2", &source, true).is_err());
}
#[test]
fn strict_semver_and_no_downgrades() {
    let source = Source::production();
    for bad in ["01.2.3", "1.2", "v1.2.3-alpha.1", "lite-v0.4.0-alpha.1", "1.2.3+build", "v1.2.3/../../"] { assert!(release_version(bad).is_err(), "{bad}"); }
    assert_eq!(release_version("lite-v1.2.3").unwrap(), Version::new(1,2,3));
    for version in ["0.5.1", "0.5.2"] { assert!(select_release(&release(version, &source), "0.5.2", &source, true).unwrap().is_none()); }
    assert_eq!(select_release(&release("0.10.0", &source), "0.9.0", &source, true).unwrap().unwrap().version, "0.10.0");
}
#[test]
fn urls_reject_credentials_unknown_hosts_and_other_repositories() {
    let source = Source::production();
    for url in [FEED, PAGE, "https://objects.githubusercontent.com/test", "https://release-assets.githubusercontent.com/test"] { assert!(source.validate(&Url::parse(url).unwrap()).is_ok()); }
    for url in ["http://github.com/frowang-ai/fromd/releases/latest", "https://user:pw@github.com/frowang-ai/fromd/releases/latest", "https://github.com:444/frowang-ai/fromd/releases/latest", "https://evil.com/", "https://github.com.evil.com/", "https://github.com/other/repo/releases/latest", "file:///tmp/installer.exe", "https://api.github.com/other", "https://github.com/frowang-ai/fromd/releases/latest#x"] { assert!(source.validate(&Url::parse(url).unwrap()).is_err(), "{url}"); }
    assert!(source.asset_url("https://objects.githubusercontent.com/test", "v1.0.0", "setup.exe").is_err());
}
#[test]
fn rejects_missing_duplicate_wrong_release_assets_and_preview() {
    let source = Source::production();
    for change in [0,1,2,3,4,5] {
        let mut value: serde_json::Value = serde_json::from_slice(&release("0.6.0", &source)).unwrap();
        match change {
            0 => value["assets"] = serde_json::json!([]),
            1 => { let extra = value["assets"][0].clone(); value["assets"].as_array_mut().unwrap().push(extra); },
            2 => value["assets"][0]["browser_download_url"] = serde_json::json!("https://github.com/frowang-ai/fromd/releases/download/v0.5.2/frowd_0.6.0_x64-setup.exe"),
            3 => value["prerelease"] = true.into(),
            4 => value["draft"] = true.into(),
            _ => value["assets"][0]["size"] = (MAX_INSTALLER+1).into(),
        }
        assert!(select_release(&serde_json::to_vec(&value).unwrap(), "0.5.2", &source, true).is_err());
    }
}
#[test]
fn hashes_require_exact_filename_unique_full_digest_and_mz() {
    let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("test.part");
    let bytes = b"MZsample"; let hash = format!("{:x}", Sha256::digest(bytes));
    let line = format!("{hash}  frowd_0.6.0_x64-setup.exe\n");
    assert_eq!(expected_hash(line.as_bytes(), "frowd_0.6.0_x64-setup.exe").unwrap(), hash);
    assert!(expected_hash(line.repeat(2).as_bytes(), "frowd_0.6.0_x64-setup.exe").is_err());
    assert!(expected_hash(line.as_bytes(), "other.exe").is_err());
    fs::write(&path, bytes).unwrap(); verify(&path, &hash).unwrap();
    assert!(verify(&path, &"0".repeat(64)).is_err());
    fs::write(&path, b"NOT-PE").unwrap(); assert!(verify(&path, &format!("{:x}", Sha256::digest(b"NOT-PE"))).is_err());
}
fn server(responses: Vec<String>) -> (Source, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let feed = Url::parse(&format!("http://{}/latest", listener.local_addr().unwrap())).unwrap();
    let task = thread::spawn(move || {
        for response in responses { let (mut stream, _) = listener.accept().unwrap(); let mut request = [0;4096]; let _ = stream.read(&mut request); stream.write_all(response.as_bytes()).unwrap(); }
    });
    (Source { feed: feed.clone(), loopback: Some(feed) }, task)
}
fn response(body: &str) -> String { format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()) }
#[test]
fn download_streams_progress_verifies_before_exe_and_cleans_failed_attempts() {
    let bytes = "MZsample"; let hash = format!("{:x}", Sha256::digest(bytes.as_bytes()));
    for valid in [true,false] {
        let sums = format!("{}  frowd_0.6.0_x64-setup.exe\n", if valid { hash.clone() } else { "0".repeat(64) });
        let (source, task) = server(vec![response(&sums), response(bytes)]);
        let candidate = select_release(&release("0.6.0", &source), "0.5.2", &source, true).unwrap().unwrap();
        let root = tempfile::tempdir().unwrap(); let mut progress = Vec::new();
        let result = download(&source, &candidate, root.path(), |p| progress.push(p.downloaded)); task.join().unwrap();
        assert_eq!(progress, [0,8]);
        if valid { let prepared = result.unwrap(); assert_eq!(prepared.path.extension().unwrap(), "exe"); assert_eq!(fs::read(&prepared.path).unwrap(), bytes.as_bytes()); drop(prepared); }
        else { assert!(result.is_err()); }
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 0);
    }
}
#[test]
fn network_rejects_cross_origin_redirect_and_oversized_body() {
    for raw in ["HTTP/1.1 302 Found\r\nLocation: https://example.com/evil\r\nContent-Length: 0\r\n\r\n".to_string(), response("oversized")] {
        let (source, task) = server(vec![raw]);
        assert!(fetch_bytes(&source.client().unwrap(), &source, &source.feed, 2).is_err()); task.join().unwrap();
    }
}
#[test]
fn save_then_spawn_then_exit_only_on_success() {
    for fail in ["save", "spawn", "none"] {
        let calls = RefCell::new(Vec::new());
        let result = handoff(|| { calls.borrow_mut().push("save"); if fail=="save" { Err("disk full".into()) } else { Ok(()) } },
            || { calls.borrow_mut().push("spawn"); if fail=="spawn" { Err("cannot spawn".into()) } else { Ok(()) } },
            || { calls.borrow_mut().push("exit"); });
        assert_eq!(result.is_ok(), fail=="none");
        assert_eq!(*calls.borrow(), match fail { "save"=>vec!["save"], "spawn"=>vec!["save","spawn"], _=>vec!["save","spawn","exit"] });
    }
}
