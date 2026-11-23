//! Manual release updates. The renderer supplies neither a URL nor an executable path.
use reqwest::{blocking::Client, redirect::Policy, Url};
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs::{self, File}, io::{Read, Write}, path::{Path, PathBuf}, sync::Mutex, time::Duration};
use tauri::{Emitter, Manager};
use tauri_plugin_opener::OpenerExt;
use tempfile::TempDir;

const FEED: &str = "https://api.github.com/repos/frowang-ai/fromd/releases/latest";
const PAGE: &str = "https://github.com/frowang-ai/fromd/releases/latest";
const MAX_INSTALLER: u64 = 64 * 1024 * 1024;
const MAX_METADATA: u64 = 1024 * 1024;
const MAX_SUMS: u64 = 128 * 1024;

#[derive(Clone)]
struct Source { feed: Url, loopback: Option<Url> }
impl Source {
    fn production() -> Self { Self { feed: Url::parse(FEED).unwrap(), loopback: None } }
    fn configured() -> Result<Self, String> {
        #[cfg(debug_assertions)]
        if let Some(feed) = std::env::var_os("FROWD_UPDATE_TEST_FEED") {
            let profile = std::env::var_os("FROWANG_USER_DATA").map(PathBuf::from)
                .filter(|p| p.is_absolute() && p.is_dir())
                .ok_or("测试更新源需要已存在的绝对路径 FROWANG_USER_DATA 隔离目录。")?;
            // Require explicit opt-in inside the synthetic profile, never a default profile.
            if !profile.join(".frowd-update-test").is_file() { return Err("测试资料目录缺少 .frowd-update-test 标记。".into()); }
            let feed = Url::parse(&feed.to_string_lossy()).map_err(|_| "测试更新源无效。")?;
            if feed.scheme() != "http" || feed.host_str() != Some("127.0.0.1") || feed.port().is_none() {
                return Err("测试更新源只允许显式端口的 http://127.0.0.1。".into());
            }
            let source = Self { loopback: Some(feed.clone()), feed };
            source.validate(&source.feed)?;
            return Ok(source);
        }
        Ok(Self::production())
    }
    fn validate(&self, url: &Url) -> Result<(), String> {
        if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
            return Err("更新地址包含不允许的凭据或片段。".into());
        }
        if let Some(origin) = &self.loopback {
            if url.origin() == origin.origin() { return Ok(()); }
            return Err("测试更新源不得离开隔离 loopback 服务。".into());
        }
        if url.scheme() != "https" || url.port_or_known_default() != Some(443) {
            return Err("更新地址必须使用 HTTPS。".into());
        }
        let allowed = match url.host_str() {
            Some("api.github.com") => url.path() == "/repos/frowang-ai/fromd/releases/latest",
            Some("github.com") => url.path().starts_with("/frowang-ai/fromd/releases/"),
            Some("objects.githubusercontent.com" | "release-assets.githubusercontent.com") => true,
            _ => false,
        };
        if allowed { Ok(()) } else { Err("更新地址不在 GitHub 官方下载白名单中。".into()) }
    }
    fn asset_url(&self, value: &str, tag: &str, name: &str) -> Result<Url, String> {
        let url = Url::parse(value).map_err(|_| "更新资产地址无效。")?;
        self.validate(&url)?;
        if self.loopback.is_none() && (url.host_str() != Some("github.com")
            || url.path() != format!("/frowang-ai/fromd/releases/download/{tag}/{name}")
            || url.query().is_some()) {
            return Err("更新资产必须来自同一正式 Release。".into());
        }
        Ok(url)
    }
    fn client(&self) -> Result<Client, String> {
        let source = self.clone();
        Client::builder().user_agent("frowd-manual-update").connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(180)).redirect(Policy::custom(move |attempt| {
                if attempt.previous().len() >= 5 { attempt.error("更新重定向次数过多") }
                else if let Err(error) = source.validate(attempt.url()) { attempt.error(error) }
                else { attempt.follow() }
            })).build().map_err(|e| format!("无法初始化更新连接：{e}"))
    }
}
#[derive(Deserialize)]
struct Asset { name: String, browser_download_url: String, size: u64 }
#[derive(Deserialize)]
struct Release { tag_name: String, draft: bool, prerelease: bool, assets: Vec<Asset> }
#[derive(Clone)]
struct Candidate { version: String, filename: String, installer: Option<Url>, sums: Option<Url>, size: u64 }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult { current_version: String, version: Option<String>, platform: &'static str }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress { downloaded: u64, total: u64 }
struct Prepared { directory: TempDir, path: PathBuf, hash: String }
#[derive(Default)]
struct Session { source: Option<Source>, candidate: Option<Candidate>, prepared: Option<Prepared> }
#[derive(Default)]
pub struct UpdateState(Mutex<Session>);

fn release_version(tag: &str) -> Result<Version, String> {
    let value = tag.strip_prefix("lite-v").or_else(|| tag.strip_prefix('v')).unwrap_or(tag);
    let version = Version::parse(value).map_err(|_| "正式版版本号不是有效的 SemVer。")?;
    if !version.pre.is_empty() || !version.build.is_empty() { return Err("预发布或带构建标记的版本不作为正式更新。".into()); }
    Ok(version)
}
fn select_release(bytes: &[u8], current: &str, source: &Source, windows: bool) -> Result<Option<Candidate>, String> {
    let release: Release = serde_json::from_slice(bytes).map_err(|_| "更新服务器返回的 Release 数据无效。")?;
    if release.draft || release.prerelease { return Err("更新源返回了非正式版本。".into()); }
    let version = release_version(&release.tag_name)?;
    if version <= release_version(current)? { return Ok(None); }
    let mut candidate = Candidate { version: version.to_string(), filename: String::new(), installer: None, sums: None, size: 0 };
    if windows {
        let preferred = format!("fromd_{version}_x64-setup.exe");
        let legacy = format!("frowd_{version}_x64-setup.exe");
        // Prefer the renamed asset. A present but invalid/duplicated new asset
        // must fail closed, never silently downgrade to the legacy filename.
        let filename = if release.assets.iter().any(|asset| asset.name == preferred) { preferred } else { legacy };
        let asset = |name: &str| -> Result<&Asset, String> {
            let matches: Vec<_> = release.assets.iter().filter(|a| a.name == name).collect();
            if matches.len() != 1 { return Err(format!("正式版缺少唯一的 {name} 下载文件。")); }
            Ok(matches[0])
        };
        let exe = asset(&filename)?;
        let sums = asset("SHA256SUMS.txt")?;
        if exe.size < 2 || exe.size > MAX_INSTALLER || sums.size == 0 || sums.size > MAX_SUMS { return Err("更新文件大小不在允许范围内。".into()); }
        candidate.installer = Some(source.asset_url(&exe.browser_download_url, &release.tag_name, &filename)?);
        candidate.sums = Some(source.asset_url(&sums.browser_download_url, &release.tag_name, "SHA256SUMS.txt")?);
        candidate.size = exe.size;
        candidate.filename = filename;
    }
    Ok(Some(candidate))
}
fn fetch(client: &Client, source: &Source, url: &Url, limit: u64, mut write: impl FnMut(&[u8]) -> Result<(), String>) -> Result<u64, String> {
    source.validate(url)?;
    let mut response = client.get(url.clone()).send().and_then(|r| r.error_for_status())
        .map_err(|e| format!("更新网络请求失败，请联网后重试：{e}"))?;
    if response.content_length().is_some_and(|n| n > limit) { return Err("更新下载超过大小限制。".into()); }
    let mut buffer = [0u8; 32 * 1024];
    let mut count = 0;
    loop {
        let read = response.read(&mut buffer).map_err(|e| format!("更新下载中断：{e}"))?;
        if read == 0 { return Ok(count); }
        count += read as u64;
        if count > limit { return Err("更新下载超过大小限制。".into()); }
        write(&buffer[..read])?;
    }
}
fn fetch_bytes(client: &Client, source: &Source, url: &Url, limit: u64) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    fetch(client, source, url, limit, |chunk| { bytes.extend_from_slice(chunk); Ok(()) })?;
    Ok(bytes)
}
fn expected_hash(bytes: &[u8], name: &str) -> Result<String, String> {
    let text = std::str::from_utf8(bytes).map_err(|_| "SHA256SUMS.txt 编码无效。")?;
    let mut found = None;
    for line in text.lines() {
        let Some((hash, file)) = line.split_once("  ") else { continue; };
        if file != name { continue; }
        if found.is_some() || hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("安装包 SHA-256 校验记录无效或重复。".into());
        }
        found = Some(hash.to_ascii_lowercase());
    }
    found.ok_or_else(|| "SHA256SUMS.txt 缺少当前安装包的校验值。".into())
}
fn verify(path: &Path, expected: &str) -> Result<(), String> {
    let mut file = File::open(path).map_err(|e| format!("无法读取更新文件：{e}"))?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    if !(2..=MAX_INSTALLER).contains(&size) { return Err("安装包大小无效。".into()); }
    let mut magic = [0; 2]; file.read_exact(&mut magic).map_err(|e| e.to_string())?;
    if magic != *b"MZ" { return Err("安装包缺少 Windows PE 的 MZ 文件头。".into()); }
    let mut hash = Sha256::new(); hash.update(magic);
    let mut buffer = [0; 32 * 1024];
    loop { let n = file.read(&mut buffer).map_err(|e| e.to_string())?; if n == 0 { break; } hash.update(&buffer[..n]); }
    if format!("{:x}", hash.finalize()) != expected { return Err("安装包 SHA-256 校验失败，请重新下载。".into()); }
    Ok(())
}
fn download(source: &Source, candidate: &Candidate, root: &Path, mut progress: impl FnMut(Progress)) -> Result<Prepared, String> {
    let client = source.client()?;
    let name = &candidate.filename;
    let hash = expected_hash(&fetch_bytes(&client, source, candidate.sums.as_ref().ok_or("当前平台不支持覆盖安装。")?, MAX_SUMS)?, &name)?;
    fs::create_dir_all(root).map_err(|e| format!("无法创建更新暂存目录：{e}"))?;
    let directory = tempfile::Builder::new().prefix("update-").tempdir_in(root).map_err(|e| e.to_string())?;
    let partial = directory.path().join("installer.part");
    let mut file = File::create(&partial).map_err(|e| e.to_string())?;
    let mut downloaded = 0;
    progress(Progress { downloaded, total: candidate.size });
    let received = fetch(&client, source, candidate.installer.as_ref().ok_or("安装包未准备。")?, candidate.size, |bytes| {
        file.write_all(bytes).map_err(|e| format!("更新暂存空间不可写：{e}"))?;
        downloaded += bytes.len() as u64;
        progress(Progress { downloaded, total: candidate.size }); Ok(())
    })?;
    if received != candidate.size { return Err("更新下载不完整，请重试。".into()); }
    file.sync_all().map_err(|e| e.to_string())?; drop(file);
    verify(&partial, &hash)?;
    let path = directory.path().join(name);
    fs::rename(partial, &path).map_err(|e| e.to_string())?;
    Ok(Prepared { directory, path, hash })
}
fn main_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" { Ok(()) } else { Err("只能由主窗口请求应用更新。".into()) }
}
#[tauri::command]
pub async fn check_updates(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<CheckResult, String> {
    main_window(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<UpdateState>();
        let mut session = state.0.try_lock().map_err(|_| "更新任务正在进行，请稍后重试。")?;
        *session = Session::default();
        let source = Source::configured()?;
        let bytes = fetch_bytes(&source.client()?, &source, &source.feed, MAX_METADATA)?;
        let current = app.package_info().version.to_string();
        let candidate = select_release(&bytes, &current, &source, cfg!(windows))?;
        let result = CheckResult { current_version: current, version: candidate.as_ref().map(|c| c.version.clone()), platform: if cfg!(windows) { "windows" } else { "macos" } };
        session.source = Some(source); session.candidate = candidate;
        Ok(result)
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn download_update(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    main_window(&window)?;
    if !cfg!(windows) { return Err("此平台请前往 Release 页面下载更新。".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<UpdateState>();
        let mut session = state.0.try_lock().map_err(|_| "更新任务正在进行。")?;
        session.prepared = None;
        let source = session.source.as_ref().ok_or("请先检查更新。")?;
        let candidate = session.candidate.as_ref().ok_or("请先检查更新。")?;
        let root = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("updates");
        // Debug tests never write to the real app cache.
        #[cfg(debug_assertions)]
        let root = if source.loopback.is_some() { PathBuf::from(std::env::var_os("FROWANG_USER_DATA").ok_or("测试资料目录丢失。")?).join("updates") } else { root };
        let prepared = download(source, candidate, &root, |event| { let _ = window.emit("frowd:update-progress", event); })?;
        session.prepared = Some(prepared);
        Ok(())
    }).await.map_err(|e| e.to_string())?
}
// Ordering is shared by production and tests: no exit permission on checkpoint/spawn failure.
fn handoff(checkpoint: impl FnOnce() -> Result<(), String>, spawn: impl FnOnce() -> Result<(), String>, confirmed: impl FnOnce()) -> Result<(), String> {
    checkpoint()?; spawn()?; confirmed(); Ok(())
}
#[tauri::command]
pub fn install_update(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    main_window(&window)?;
    if !cfg!(windows) { return Err("此平台不支持应用内覆盖安装。".into()); }
    let updates = app.state::<UpdateState>();
    let mut session = updates.0.try_lock().map_err(|_| "更新任务正在进行。")?;
    let prepared = session.prepared.as_ref().ok_or("安装包尚未下载校验，请重试更新。")?;
    verify(&prepared.path, &prepared.hash)?;
    let state = app.state::<super::AppState>();
    let store = super::lock(&state)?;
    let mut close = state.close.lock().map_err(|_| "关闭状态不可用。")?;
    handoff(|| store.checkpoint().map_err(|e| e.to_string()), || {
        // No shell, no renderer arguments, no arbitrary path. /P uses NSIS passive upgrade.
        std::process::Command::new(&prepared.path).arg("/P").spawn()
            .map(|_| ()).map_err(|e| format!("无法启动更新安装程序，文稿仍保留在当前窗口：{e}"))
    }, || { close.apply(super::CloseEvent::UpdateLaunched); })?;
    // The installer needs these files after this process exits. Failed attempts are cleaned by TempDir.
    if let Some(prepared) = session.prepared.take() { let _ = prepared.directory.keep(); }
    drop(close); drop(store); drop(session);
    app.exit(0);
    Ok(())
}
#[tauri::command]
pub fn open_update_page(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    main_window(&window)?;
    app.opener().open_url(PAGE, None::<&str>).map_err(|_| "无法打开下载页面，请检查默认浏览器后重试。".into())
}

#[cfg(test)]
mod tests;
