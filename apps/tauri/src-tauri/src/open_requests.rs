//! System "open with" and window-drop requests.
//!
//! The renderer never supplies a path. Rust queues only paths it received from
//! the OS itself (Windows argv / second instance, macOS `Opened` URLs, the macOS
//! drag pasteboard, WebView2 `File` objects), validates them, and the document
//! coordinator drains the queue inside its serial command after flushing.
//! Events that arrive before setup (macOS cold start) are only queued; the
//! frontend claims them after boot through `has_pending_open`.
use super::*;
use serde::Deserialize;
use std::{
    collections::VecDeque,
    ffi::{OsStr, OsString},
    sync::Condvar,
    time::Duration,
};
use tauri::{Url, WebviewWindow};

pub(super) const OPEN_EVENT: &str = "frowd:open-requested";
pub(super) const MAX_PENDING: usize = 64;
const OPENABLE: [&str; 3] = ["md", "markdown", "txt"];
const OPENABLE_LABEL: &str = ".md / .markdown / .txt";
const MAX_DROP_FILES: usize = 64;
const MAX_DROP_SLOTS: usize = 8;
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
const DROP_MESSAGE_PREFIX: &str = "frowd-open-drop:";
#[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))]
const DROP_WAIT: Duration = Duration::from_secs(2);

pub(super) fn openable(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|ext| OPENABLE.iter().any(|allowed| ext.eq_ignore_ascii_case(allowed)))
}
fn display_name(path: &Path) -> String {
    path.file_name().unwrap_or(path.as_os_str()).to_string_lossy().into_owned()
}
/// `file://` URLs only; other schemes (none are registered) are ignored.
pub(super) fn url_path(url: &Url) -> Option<PathBuf> {
    (url.scheme() == "file").then(|| url.to_file_path().ok()).flatten()
}
/// A launch argument: `-` options are skipped, `file://` URLs and paths are
/// accepted, and relative paths resolve against the launching directory.
pub(super) fn argument_path(argument: &OsStr, cwd: Option<&Path>) -> Option<PathBuf> {
    let text = argument.to_string_lossy();
    if text.is_empty() || text.starts_with('-') { return None; }
    if text.get(..7).is_some_and(|scheme| scheme.eq_ignore_ascii_case("file://")) {
        return Url::parse(&text).ok().and_then(|url| url_path(&url));
    }
    let path = PathBuf::from(argument);
    Some(match cwd { Some(cwd) if path.is_relative() => cwd.join(path), _ => path })
}
/// Store::open_file's rules (canonical real file; its size/UTF-8 checks still run
/// there) plus the open whitelist on both the given name and the real target, so
/// a symlink cannot turn `notes.md` into an arbitrary non-text file.
pub(super) fn validate(path: &Path) -> Result<PathBuf, String> {
    let name = display_name(path);
    let missing = || format!("「{name}」不存在或无法访问。");
    let canonical = std::fs::canonicalize(path).map_err(|_| missing())?;
    let meta = std::fs::metadata(&canonical).map_err(|_| missing())?;
    if meta.is_dir() { return Err(format!("「{name}」是文件夹，请拖入 {OPENABLE_LABEL} 文件。")); }
    if !meta.is_file() { return Err(format!("「{name}」不是普通文件。")); }
    if !openable(path) || !openable(&canonical) {
        return Err(format!("「{name}」不是 {OPENABLE_LABEL} 文件，未打开。"));
    }
    Ok(canonical)
}

#[derive(Debug, Default)]
pub(super) struct OpenQueue { items: VecDeque<Result<PathBuf, String>>, overflow: usize }
impl OpenQueue {
    pub(super) fn push(&mut self, item: Result<PathBuf, String>) {
        if self.items.len() >= MAX_PENDING { self.overflow += 1; } else { self.items.push_back(item); }
    }
    pub(super) fn is_empty(&self) -> bool { self.items.is_empty() && self.overflow == 0 }
    pub(super) fn drain(&mut self) -> (Vec<Result<PathBuf, String>>, usize) {
        (self.items.drain(..).collect(), std::mem::take(&mut self.overflow))
    }
}

/// WebView2 deliveries keyed by the renderer's one-time token. Bounded: a lost
/// claim cannot grow memory, and a token is consumed by its single claim.
#[derive(Debug, Default)]
pub(super) struct DropSlots { slots: VecDeque<(String, Vec<PathBuf>)> }
impl DropSlots {
    pub(super) fn deliver(&mut self, token: String, paths: Vec<PathBuf>) {
        self.slots.retain(|(existing, _)| existing != &token);
        if self.slots.len() >= MAX_DROP_SLOTS { self.slots.pop_front(); }
        self.slots.push_back((token, paths));
    }
    pub(super) fn contains(&self, token: &str) -> bool { self.slots.iter().any(|(existing, _)| existing == token) }
    pub(super) fn take(&mut self, token: &str) -> Option<Vec<PathBuf>> {
        let index = self.slots.iter().position(|(existing, _)| existing == token)?;
        self.slots.remove(index).map(|(_, paths)| paths)
    }
}

#[derive(Default)]
pub(super) struct OpenState {
    queue: Mutex<OpenQueue>,
    started: AtomicBool,
    drops: (Mutex<DropSlots>, Condvar),
}
impl OpenState {
    fn queue(&self) -> Result<MutexGuard<'_, OpenQueue>, String> {
        self.queue.lock().map_err(|_| "打开请求队列不可用，请改用 文件 → 打开…".into())
    }
    fn push(&self, item: Result<PathBuf, String>) { if let Ok(mut queue) = self.queue() { queue.push(item); } }
    /// Setup finished: the main window exists and AppState is managed.
    pub(super) fn mark_started(&self) { self.started.store(true, Ordering::SeqCst); }
    fn started(&self) -> bool { self.started.load(Ordering::SeqCst) }
    #[cfg_attr(not(any(windows, test)), allow(dead_code))]
    pub(super) fn deliver_drop(&self, token: String, paths: Vec<PathBuf>) {
        let (slots, ready) = &self.drops;
        if let Ok(mut slots) = slots.lock() { slots.deliver(token, paths); ready.notify_all(); }
    }
    #[cfg_attr(not(any(windows, test)), allow(dead_code))]
    pub(super) fn wait_drop(&self, token: &str, timeout: Duration) -> Option<Vec<PathBuf>> {
        let (slots, ready) = &self.drops;
        let guard = slots.lock().ok()?;
        let (mut guard, _) = ready.wait_timeout_while(guard, timeout, |slots| !slots.contains(token)).ok()?;
        guard.take(token)
    }
}

/// Queue platform paths; once running, bring the main window forward and ask
/// the frontend to drain. Before setup the frontend claims them after boot.
pub(super) fn deliver(app: &tauri::AppHandle, paths: Vec<PathBuf>) {
    let state = app.state::<OpenState>();
    let queued = !paths.is_empty();
    for path in paths { state.push(validate(&path)); }
    if !state.started() { return; }
    reveal(app);
    if queued && app.emit(OPEN_EVENT, ()).is_err() { eprintln!("Cannot notify the open request listener."); }
}
#[cfg(target_os = "macos")]
fn reveal(app: &tauri::AppHandle) {
    // Also recreates a destroyed main window; a red-closed one is only hidden.
    if let Err(error) = reopen_main(app) { eprintln!("Cannot reveal main window: {error}"); }
}
#[cfg(not(target_os = "macos"))]
fn reveal(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
#[cfg_attr(not(windows), allow(dead_code))]
pub(super) fn deliver_arguments(app: &tauri::AppHandle, arguments: impl IntoIterator<Item = OsString>, cwd: Option<PathBuf>) {
    let paths = arguments.into_iter().filter_map(|argument| argument_path(&argument, cwd.as_deref())).collect();
    deliver(app, paths);
}
#[cfg(target_os = "macos")]
pub(super) fn deliver_urls(app: &tauri::AppHandle, urls: &[Url]) {
    let paths: Vec<_> = urls.iter().filter_map(url_path).collect();
    if !paths.is_empty() { deliver(app, paths); }
}

fn main_only(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" { return Err("只能由主窗口打开文档。".into()); }
    Ok(())
}
#[tauri::command]
pub(super) fn has_pending_open(window: WebviewWindow, open: State<'_, OpenState>) -> Result<bool, String> {
    main_only(&window)?;
    Ok(!open.queue()?.is_empty())
}
#[derive(Default, Serialize)]
pub(super) struct OpenBatch { snapshot: Option<Snapshot>, opened: usize, errors: Vec<String> }
/// Drained by the coordinator after its flush. Each path is revalidated right
/// before Store::open_file, which dedupes by canonical path and activates it.
#[tauri::command]
pub(super) async fn open_pending_documents(window: WebviewWindow, app: tauri::AppHandle) -> Result<OpenBatch, String> {
    main_only(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (items, overflow) = app.state::<OpenState>().queue()?.drain();
        let state = app.state::<AppState>();
        let mut batch = OpenBatch::default();
        for item in items {
            match item.and_then(|path| validate(&path)) {
                Ok(path) => match lock(&state)?.open_file(&path) {
                    Ok(snapshot) => { batch.snapshot = Some(snapshot); batch.opened += 1; }
                    Err(error) => batch.errors.push(format!("「{}」无法打开：{error}", display_name(&path))),
                },
                Err(message) => batch.errors.push(message),
            }
        }
        if overflow > 0 { batch.errors.push(format!("一次最多打开 {MAX_PENDING} 个文件，另有 {overflow} 个未打开。")); }
        Ok(batch)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// What the renderer may report about a dropped `File`: its name and size only.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct DroppedFile { name: String, size: u64 }
#[derive(Debug, Default, Serialize)]
pub(super) struct DropClaim { unavailable: bool, accepted: usize, errors: Vec<String> }
impl DropClaim { fn unavailable() -> Self { Self { unavailable: true, ..Self::default() } } }

pub(super) fn valid_token(token: &str) -> bool {
    token.len() == 32 && token.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub(super) fn drop_message_token(message: &str) -> Option<&str> {
    message.strip_prefix(DROP_MESSAGE_PREFIX).filter(|token| valid_token(token))
}
fn check_descriptors(token: &str, files: &[DroppedFile]) -> Result<(), String> {
    if !valid_token(token) { return Err("拖入请求无效。".into()); }
    if files.is_empty() || files.len() > MAX_DROP_FILES { return Err(format!("每次最多拖入 {MAX_DROP_FILES} 个文档。")); }
    for file in files {
        let plain = !file.name.is_empty() && file.name.len() <= 1024
            && !file.name.contains(['/', '\\', '\0']) && file.name != "." && file.name != "..";
        if !plain || !openable(Path::new(&file.name)) { return Err("拖入文档描述无效。".into()); }
    }
    Ok(())
}
fn same_name(path: &Path, name: &str) -> bool {
    // macOS names may be NFD on disk but NFC in WebKit's File.name (or vice versa).
    let nfc = icu_normalizer::ComposingNormalizerBorrowed::new_nfc();
    path.file_name().and_then(OsStr::to_str).is_some_and(|real| real == name || nfc.normalize(real) == nfc.normalize(name))
}
/// Pair every reported (name, size) with a distinct platform path whose real
/// file name and size are identical. Any mismatch rejects the whole drop, which
/// is then reported as "file location unavailable"; nothing is guessed.
pub(super) fn match_dropped(files: &[DroppedFile], paths: Vec<PathBuf>, size_of: impl Fn(&Path) -> Option<u64>) -> Option<Vec<PathBuf>> {
    let mut available: Vec<Option<PathBuf>> = paths.into_iter().map(Some).collect();
    let mut matched = Vec::with_capacity(files.len());
    for file in files {
        let index = available.iter().position(|slot| {
            slot.as_deref().is_some_and(|path| same_name(path, &file.name) && size_of(path) == Some(file.size))
        })?;
        matched.push(available[index].take()?);
    }
    Some(matched)
}
/// Called from the drop event before any coordinator work, while the platform
/// drag data is fresh. Accepted paths join the open queue; the renderer then
/// drains it through the coordinator (busy/source/IME waits are honored).
#[tauri::command]
pub(super) async fn claim_dropped_documents(token: String, files: Vec<DroppedFile>, window: WebviewWindow, app: tauri::AppHandle) -> Result<DropClaim, String> {
    main_only(&window)?;
    check_descriptors(&token, &files)?;
    let Some(paths) = platform_drop_paths(&app, &token).await else { return Ok(DropClaim::unavailable()); };
    let Some(matched) = match_dropped(&files, paths, |path| std::fs::metadata(path).ok().map(|meta| meta.len())) else {
        return Ok(DropClaim::unavailable());
    };
    let state = app.state::<OpenState>();
    let mut claim = DropClaim::default();
    for path in matched {
        match validate(&path) {
            Ok(path) => { state.push(Ok(path)); claim.accepted += 1; }
            Err(message) => claim.errors.push(message),
        }
    }
    Ok(claim)
}

#[cfg(target_os = "macos")]
async fn platform_drop_paths(app: &tauri::AppHandle, _token: &str) -> Option<Vec<PathBuf>> {
    // WebKit's drop reads the same drag pasteboard; AppKit is used on its thread.
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || { let _ = sender.send(pasteboard::drag_file_paths()); }).ok()?;
    tokio::time::timeout(DROP_WAIT, receiver).await.ok()?.ok()
}
#[cfg(windows)]
async fn platform_drop_paths(app: &tauri::AppHandle, token: &str) -> Option<Vec<PathBuf>> {
    // The web message and this invoke travel separately; wait for the former.
    let (app, token) = (app.clone(), token.to_owned());
    tauri::async_runtime::spawn_blocking(move || app.state::<OpenState>().wait_drop(&token, DROP_WAIT)).await.ok().flatten()
}
#[cfg(not(any(windows, target_os = "macos")))]
async fn platform_drop_paths(_app: &tauri::AppHandle, _token: &str) -> Option<Vec<PathBuf>> { None }

#[cfg(target_os = "macos")]
mod pasteboard {
    use super::*;
    use objc2_app_kit::{NSPasteboard, NSPasteboardNameDrag, NSPasteboardTypeFileURL};
    use objc2_foundation::NSURL;
    /// File URLs on the drag pasteboard (NSPasteboardNameDrag). Only file URLs
    /// are read; file-reference URLs resolve to their current path.
    pub(super) fn drag_file_paths() -> Vec<PathBuf> {
        file_paths(&NSPasteboard::pasteboardWithName(unsafe { NSPasteboardNameDrag }))
    }
    pub(super) fn file_paths(pasteboard: &NSPasteboard) -> Vec<PathBuf> {
        let Some(items) = pasteboard.pasteboardItems() else { return Vec::new(); };
        let mut paths = Vec::new();
        for item in items.iter().take(MAX_DROP_FILES * 2) {
            let Some(text) = item.stringForType(unsafe { NSPasteboardTypeFileURL }) else { continue; };
            let Some(url) = NSURL::URLWithString(&text) else { continue; };
            if !url.isFileURL() { continue; }
            if let Some(path) = url.filePathURL().and_then(|url| url.to_file_path()) { paths.push(path); }
        }
        paths
    }
}

/// Registers an extra WebMessageReceived handler on the main WebView2. Messages
/// are the string `frowd-open-drop:<token>` with the dropped File objects as
/// additional objects. wry 0.57 also forwards every string message to Tauri's
/// postMessage IPC fallback, which only logs a console error for a non-invoke
/// string; it never dispatches a command. Source must be the app's own page.
#[cfg(windows)]
pub(super) fn install_drop_receiver(app: &tauri::App) {
    let Some(window) = app.get_webview_window("main") else { return; };
    let handle = app.handle().clone();
    let result = window.with_webview(move |platform| unsafe {
        if let Err(error) = webview2::register(&platform, handle) { eprintln!("WebView2 drop receiver unavailable: {error}"); }
    });
    if let Err(error) = result { eprintln!("WebView2 drop receiver unavailable: {error}"); }
}
#[cfg(windows)]
mod webview2 {
    use super::*;
    use std::os::windows::ffi::OsStringExt;
    use webview2_com::{Microsoft::Web::WebView2::Win32::*, WebMessageReceivedEventHandler};
    use windows::core::{Interface, PWSTR};
    unsafe fn take(value: PWSTR) -> OsString {
        if value.is_null() { return OsString::new(); }
        let text = OsString::from_wide(value.as_wide());
        windows::Win32::System::Com::CoTaskMemFree(Some(value.0.cast()));
        text
    }
    // Requires WebView2 runtime 1.0.1774.30+; older runtimes deliver no paths.
    unsafe fn dropped_paths(args: &ICoreWebView2WebMessageReceivedEventArgs) -> windows::core::Result<Vec<PathBuf>> {
        let args: ICoreWebView2WebMessageReceivedEventArgs2 = args.cast()?;
        let objects = args.AdditionalObjects()?;
        let mut count = 0u32;
        objects.Count(&mut count)?;
        let mut paths = Vec::new();
        for index in 0..count.min(MAX_DROP_FILES as u32) {
            let file: ICoreWebView2File = objects.GetValueAtIndex(index)?.cast()?;
            let mut path = PWSTR::null();
            file.Path(&mut path)?;
            paths.push(PathBuf::from(take(path)));
        }
        Ok(paths)
    }
    pub(super) unsafe fn register(platform: &tauri::webview::PlatformWebview, app: tauri::AppHandle) -> windows::core::Result<()> {
        let core = platform.controller().CoreWebView2()?;
        let handler = WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()); };
            let mut source = PWSTR::null();
            if args.Source(&mut source).is_err() { return Ok(()); }
            let source = take(source);
            if !source.to_str().is_some_and(|source| protocol_urls::trusted_page(source, cfg!(debug_assertions))) { return Ok(()); }
            // Never fail: other handlers (wry/Tauri IPC) must keep receiving messages.
            let mut message = PWSTR::null();
            if args.TryGetWebMessageAsString(&mut message).is_err() { return Ok(()); }
            let message = take(message);
            let Some(token) = message.to_str().and_then(drop_message_token) else { return Ok(()); };
            let paths = dropped_paths(&args).unwrap_or_default();
            app.state::<OpenState>().deliver_drop(token.to_owned(), paths);
            Ok(())
        }));
        let mut registration = 0;
        core.add_WebMessageReceived(&handler, &mut registration)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, sync::Arc, thread};
    fn descriptor(name: &str, size: u64) -> DroppedFile { DroppedFile { name: name.into(), size } }

    #[test]
    fn whitelist_is_case_insensitive_and_extension_only() {
        for name in ["a.md", "B.MD", "notes.Markdown", "x.txt", "中文.TXT", "v1.2.md"] { assert!(openable(Path::new(name)), "{name}"); }
        for name in ["a.png", "md", "a.md.exe", "a.mdx", "a.text", ".md", "folder/"] { assert!(!openable(Path::new(name)), "{name}"); }
    }
    #[test]
    fn launch_arguments_skip_options_and_accept_file_urls_and_relative_paths() {
        let cwd = Path::new(if cfg!(windows) { r"C:\work" } else { "/work" });
        assert_eq!(argument_path(OsStr::new("--flag"), Some(cwd)), None);
        assert_eq!(argument_path(OsStr::new("-psn_0_123"), None), None);
        assert_eq!(argument_path(OsStr::new(""), None), None);
        assert_eq!(argument_path(OsStr::new("notes.md"), Some(cwd)), Some(cwd.join("notes.md")));
        assert_eq!(argument_path(OsStr::new("notes.md"), None), Some(PathBuf::from("notes.md")));
        let absolute = if cfg!(windows) { r"D:\docs\a b.md" } else { "/docs/a b.md" };
        assert_eq!(argument_path(OsStr::new(absolute), Some(cwd)), Some(PathBuf::from(absolute)));
        let url = if cfg!(windows) { "FILE:///D:/docs/a%20b.md" } else { "FILE:///docs/a%20b.md" };
        assert_eq!(argument_path(OsStr::new(url), Some(cwd)), Some(PathBuf::from(absolute)));
        // A multibyte argument must not be sliced inside a character.
        assert_eq!(argument_path(OsStr::new("文稿.md"), Some(cwd)), Some(cwd.join("文稿.md")));
        assert_eq!(url_path(&Url::parse("https://example.com/a.md").unwrap()), None);
    }
    #[test]
    fn validation_requires_a_real_regular_openable_file() {
        let dir = tempfile::tempdir().unwrap();
        let note = dir.path().join("note.md");
        fs::write(&note, "# 合成").unwrap();
        assert_eq!(validate(&note).unwrap(), fs::canonicalize(&note).unwrap());
        fs::create_dir(dir.path().join("folder.md")).unwrap();
        assert!(validate(&dir.path().join("folder.md")).unwrap_err().contains("文件夹"));
        assert!(validate(&dir.path().join("missing.md")).unwrap_err().contains("不存在"));
        fs::write(dir.path().join("image.png"), [137, 80, 78, 71]).unwrap();
        assert!(validate(&dir.path().join("image.png")).unwrap_err().contains(OPENABLE_LABEL));
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(dir.path().join("image.png"), dir.path().join("disguised.md")).unwrap();
            assert!(validate(&dir.path().join("disguised.md")).is_err());
            std::os::unix::fs::symlink(&note, dir.path().join("alias.txt")).unwrap();
            assert_eq!(validate(&dir.path().join("alias.txt")).unwrap(), fs::canonicalize(&note).unwrap());
        }
    }
    #[test]
    fn queue_keeps_order_rejections_and_bounds_overflow() {
        let mut queue = OpenQueue::default();
        assert!(queue.is_empty());
        queue.push(Ok(PathBuf::from("a.md")));
        queue.push(Err("「b.png」不是".into()));
        assert!(!queue.is_empty());
        for index in 0..MAX_PENDING { queue.push(Ok(PathBuf::from(format!("{index}.md")))); }
        let (items, overflow) = queue.drain();
        assert_eq!(items.len(), MAX_PENDING);
        assert_eq!(overflow, 2);
        assert_eq!(items[0], Ok(PathBuf::from("a.md")));
        assert!(items[1].is_err());
        assert!(queue.is_empty());
    }
    #[test]
    fn cold_start_requests_wait_until_claimed_after_setup() {
        let state = OpenState::default();
        assert!(!state.started());
        state.push(Ok(PathBuf::from("/early.md")));
        assert!(!state.queue().unwrap().is_empty());
        state.mark_started();
        assert!(state.started());
        let (items, _) = state.queue().unwrap().drain();
        assert_eq!(items, vec![Ok(PathBuf::from("/early.md"))]);
        assert!(state.queue().unwrap().is_empty());
    }
    #[test]
    fn renderer_reports_only_plain_names_and_sizes_never_paths() {
        let parsed: Result<Vec<DroppedFile>, _> = serde_json::from_str(r#"[{"name":"a.md","size":3,"path":"/etc/passwd"}]"#);
        assert!(parsed.is_err());
        let token = "0123456789abcdef0123456789abcdef";
        assert!(check_descriptors(token, &[descriptor("a.md", 3)]).is_ok());
        for name in ["../a.md", "dir/a.md", r"dir\a.md", "a.png", "", "a\0.md"] {
            assert!(check_descriptors(token, &[descriptor(name, 1)]).is_err(), "{name:?}");
        }
        assert!(check_descriptors("not-a-token", &[descriptor("a.md", 3)]).is_err());
        assert!(check_descriptors(token, &[]).is_err());
        let many: Vec<_> = (0..=MAX_DROP_FILES).map(|i| descriptor(&format!("{i}.md"), 1)).collect();
        assert!(check_descriptors(token, &many).is_err());
        assert_eq!(drop_message_token(&format!("frowd-open-drop:{token}")), Some(token));
        for message in ["frowd-open-drop:", "frowd-open-drop:ABCDEF0123456789ABCDEF0123456789", r#"{"cmd":"x"}"#, token] {
            assert_eq!(drop_message_token(message), None, "{message}");
        }
    }
    #[test]
    fn dropped_files_match_platform_paths_by_real_name_and_size() {
        let sizes = |path: &Path| Some(match path.file_name()?.to_str()? { "a.md" => 3, "b.txt" => 5, "photo.png" => 9, _ => 7 });
        let paths = || vec![PathBuf::from("/x/photo.png"), PathBuf::from("/x/b.txt"), PathBuf::from("/x/a.md")];
        // The drag pasteboard may also hold skipped files; only reported ones match.
        assert_eq!(match_dropped(&[descriptor("a.md", 3), descriptor("b.txt", 5)], paths(), sizes),
            Some(vec![PathBuf::from("/x/a.md"), PathBuf::from("/x/b.txt")]));
        assert_eq!(match_dropped(&[descriptor("a.md", 4)], paths(), sizes), None);
        assert_eq!(match_dropped(&[descriptor("c.md", 3)], paths(), sizes), None);
        assert_eq!(match_dropped(&[descriptor("a.md", 3), descriptor("a.md", 3)], paths(), sizes), None);
        assert_eq!(match_dropped(&[descriptor("a.md", 3)], Vec::new(), sizes), None);
        // Same-named files from two folders pair one-to-one.
        let twins = vec![PathBuf::from("/one/n.md"), PathBuf::from("/two/n.md")];
        assert_eq!(match_dropped(&[descriptor("n.md", 7), descriptor("n.md", 7)], twins.clone(), sizes), Some(twins));
        // NFD on disk vs NFC in File.name (e.g. Japanese dakuten, accents).
        let nfd = PathBuf::from("/x/\u{304b}\u{3099}.md");
        assert_eq!(match_dropped(&[descriptor("\u{304c}.md", 7)], vec![nfd.clone()], sizes), Some(vec![nfd]));
    }
    #[test]
    fn web_message_delivery_and_claim_are_order_independent_and_bounded() {
        let state = Arc::new(OpenState::default());
        let token = "0123456789abcdef0123456789abcdef".to_owned();
        state.deliver_drop(token.clone(), vec![PathBuf::from("/early.md")]);
        assert_eq!(state.wait_drop(&token, Duration::from_millis(10)), Some(vec![PathBuf::from("/early.md")]));
        assert_eq!(state.wait_drop(&token, Duration::from_millis(10)), None);
        let later = Arc::clone(&state);
        let late_token = token.clone();
        let sender = thread::spawn(move || {
            thread::sleep(Duration::from_millis(30));
            later.deliver_drop(late_token, vec![PathBuf::from("/late.md")]);
        });
        assert_eq!(state.wait_drop(&token, Duration::from_secs(2)), Some(vec![PathBuf::from("/late.md")]));
        sender.join().unwrap();
        let mut slots = DropSlots::default();
        for index in 0..MAX_DROP_SLOTS + 2 { slots.deliver(format!("{index}"), Vec::new()); }
        assert!(!slots.contains("0") && !slots.contains("1") && slots.contains("2"));
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn macos_pasteboard_resolves_file_and_reference_urls_only() {
        use objc2_app_kit::{NSPasteboard, NSPasteboardTypeFileURL};
        use objc2_foundation::{NSString, NSURL};
        let dir = tempfile::tempdir().unwrap();
        let note = dir.path().join("中文 笔记.md");
        fs::write(&note, "# mac").unwrap();
        let canonical = fs::canonicalize(&note).unwrap();
        let pb = NSPasteboard::pasteboardWithUniqueName();
        let file_url = NSURL::from_file_path(&note).unwrap();
        pb.clearContents();
        assert!(pb.setString_forType(&file_url.absoluteString().unwrap(), unsafe { NSPasteboardTypeFileURL }));
        assert_eq!(pasteboard::file_paths(&pb), vec![note.clone()]);
        if let Some(reference) = file_url.fileReferenceURL().and_then(|url| url.absoluteString()) {
            pb.clearContents();
            assert!(pb.setString_forType(&reference, unsafe { NSPasteboardTypeFileURL }));
            assert_eq!(pasteboard::file_paths(&pb), vec![canonical]);
        }
        pb.clearContents();
        assert!(pb.setString_forType(&NSString::from_str("https://example.com/a.md"), unsafe { NSPasteboardTypeFileURL }));
        assert!(pasteboard::file_paths(&pb).is_empty());
        pb.clearContents();
    }
}
