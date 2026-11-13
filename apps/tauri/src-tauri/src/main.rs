// frowd lite: Tauri shell around the shared Vue renderer. Mirrors
// `apps/desktop/src/main/index.js`: fixed commands, serialized document queue,
// native menu that only dispatches renderer commands, close handshake and
// restricted image / print protocols.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod storage;
mod store;
#[cfg(windows)]
mod webview2;

use base64::Engine;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use store::{suggested_filename, DocumentStore};
use tauri::http::{header, Request, Response, StatusCode};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent, Wry};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult};
use tauri_plugin_opener::OpenerExt;

const KATEX_CSS: &str = include_str!(concat!(env!("OUT_DIR"), "/katex-inline.css"));
const MAIN: &str = "main";

#[derive(Default)]
struct Flags { closing: bool, quitting: bool, renderer_ready: bool }

#[derive(Default, Clone)]
struct MenuState { document_id: Option<String>, ready: bool, busy: bool, source_mode: bool, revision: i64 }

struct MenuItems { commands: Vec<(&'static str, MenuItem<Wry>)>, source: CheckMenuItem<Wry> }

struct Print { html: String, ready: Option<tokio::sync::oneshot::Sender<()>> }

struct Shell {
  queue: tokio::sync::Mutex<()>,
  store: Mutex<DocumentStore>,
  flags: Mutex<Flags>,
  menu: Mutex<MenuState>,
  items: MenuItems,
  capturing: AtomicBool,
  prints: Mutex<HashMap<String, Print>>,
  zoom: Mutex<f64>,
  /// WebView2 profile inside FROWANG_USER_DATA when an isolated profile is requested.
  webview_data: Option<PathBuf>,
}

type Outcome<T = Value> = Result<T, String>;

impl Shell {
  fn store<T>(&self, action: impl FnOnce(&mut DocumentStore) -> Outcome<T>) -> Outcome<T> {
    let mut store = self.store.lock().map_err(|_| "草稿存储不可用。".to_string())?;
    action(&mut store)
  }
  fn available(&self, name: &str) -> bool {
    let state = self.menu.lock().unwrap().clone();
    let flags = self.flags.lock().unwrap();
    state.ready && !state.busy && (state.document_id.is_some() || ["new", "open"].contains(&name)) && flags.renderer_ready && !flags.closing
  }
  fn refresh_menu(&self) {
    for (name, item) in &self.items.commands {
      let _ = item.set_enabled(self.available(name));
    }
    let _ = self.items.source.set_enabled(self.available("source"));
    let _ = self.items.source.set_checked(self.menu.lock().unwrap().source_mode);
  }
  fn reset_menu(&self) {
    *self.menu.lock().unwrap() = MenuState { busy: true, ..Default::default() };
    self.refresh_menu();
  }
}

fn main_window(app: &AppHandle) -> Outcome<WebviewWindow> { app.get_webview_window(MAIN).ok_or_else(|| "窗口不可用。".to_string()) }

// ---------- dialogs ----------

fn choose_save(app: &AppHandle, title: &str, default_path: Option<&str>, name: String, filter: (&str, &[&str])) -> Option<PathBuf> {
  let mut dialog = app.dialog().file().set_title(title).add_filter(filter.0, filter.1);
  if let Ok(window) = main_window(app) {
    dialog = dialog.set_parent(&window);
  }
  if let Some(parent) = default_path.and_then(|path| Path::new(path).parent()) {
    dialog = dialog.set_directory(parent);
  }
  dialog.set_file_name(name).blocking_save_file().and_then(|path| path.into_path().ok())
}

fn ask(app: &AppHandle, message: &str, kind: MessageDialogKind, buttons: MessageDialogButtons) -> MessageDialogResult {
  let mut dialog = app.dialog().message(message).title("frowd lite").kind(kind).buttons(buttons);
  if let Ok(window) = main_window(app) {
    dialog = dialog.parent(&window);
  }
  dialog.blocking_show_with_result()
}

fn save_document(app: &AppHandle, shell: &Shell, id: &str, save_as: bool) -> Outcome {
  let (path, title) = shell.store(|store| store.get(id).map(|doc| (doc.path.clone(), doc.title.clone())))?;
  let target = if save_as || path.is_none() {
    let name = path
      .as_deref()
      .and_then(|path| Path::new(path).file_name())
      .map(|name| name.to_string_lossy().into_owned())
      .unwrap_or_else(|| suggested_filename(&title, "md"));
    match choose_save(app, "保存 Markdown", path.as_deref(), name, ("Markdown", &["md", "markdown", "txt"])) {
      Some(target) => Some(target),
      None => return Ok(json!({ "cancelled": true })),
    }
  } else {
    None
  };
  shell.store(|store| store.save(id, target.as_deref()))
}

// ---------- document commands (serialized like the Electron operation queue) ----------

#[tauri::command]
async fn documents_list(shell: tauri::State<'_, Shell>) -> Outcome {
  let _queue = shell.queue.lock().await;
  shell.store(|store| Ok(store.snapshot()))
}

#[tauri::command]
async fn documents_read(shell: tauri::State<'_, Shell>, id: String) -> Outcome {
  let _queue = shell.queue.lock().await;
  shell.store(|store| store.read(&id))
}

#[tauri::command]
async fn documents_rename(shell: tauri::State<'_, Shell>, id: String, title: String) -> Outcome {
  let _queue = shell.queue.lock().await;
  shell.store(|store| store.rename(&id, &title))
}

#[tauri::command]
async fn documents_view_state(shell: tauri::State<'_, Shell>, id: String, state: Value) -> Outcome {
  let _queue = shell.queue.lock().await;
  shell.store(|store| store.set_view_state(&id, &state))
}

#[tauri::command]
async fn documents_new(shell: tauri::State<'_, Shell>) -> Outcome {
  let _queue = shell.queue.lock().await;
  shell.store(|store| Ok(store.new_document("", "未命名笔记")))
}

#[tauri::command]
async fn documents_open(app: AppHandle, shell: tauri::State<'_, Shell>) -> Outcome {
  let _queue = shell.queue.lock().await;
  let mut dialog = app.dialog().file().set_title("打开 Markdown").add_filter("Markdown", &["md", "markdown", "txt"]);
  if let Ok(window) = main_window(&app) {
    dialog = dialog.set_parent(&window);
  }
  let paths = dialog.blocking_pick_files().unwrap_or_default();
  shell.store(|store| {
    let failures: Vec<String> =
      paths.into_iter().filter_map(|path| path.into_path().ok()).filter_map(|path| store.open_file(&path).err()).collect();
    let mut snapshot = store.snapshot();
    if !failures.is_empty() {
      snapshot["warning"] = failures.join("\n").into();
    }
    Ok(snapshot)
  })
}

#[tauri::command]
async fn documents_update(shell: tauri::State<'_, Shell>, id: String, markdown: String, revision: Value) -> Outcome {
  let _queue = shell.queue.lock().await;
  shell.store(|store| store.update(&id, &markdown, &revision))
}

#[tauri::command]
async fn documents_activate(shell: tauri::State<'_, Shell>, id: String) -> Outcome<bool> {
  let _queue = shell.queue.lock().await;
  shell.store(|store| store.activate(&id))
}

#[tauri::command]
async fn documents_shelve(shell: tauri::State<'_, Shell>, id: String) -> Outcome {
  let _queue = shell.queue.lock().await;
  shell.store(|store| store.shelve(&id))
}

#[tauri::command]
async fn documents_undo_remove(shell: tauri::State<'_, Shell>) -> Outcome {
  let _queue = shell.queue.lock().await;
  shell.store(|store| store.undo_remove())
}

#[tauri::command]
async fn documents_save(app: AppHandle, shell: tauri::State<'_, Shell>, id: String, save_as: bool) -> Outcome {
  let _queue = shell.queue.lock().await;
  save_document(&app, &shell, &id, save_as)
}

fn remove(shell: &Shell, id: &str) -> Outcome { Ok(json!({ "closed": true, "snapshot": shell.store(|store| store.remove(id))? })) }

#[tauri::command]
async fn documents_close(app: AppHandle, shell: tauri::State<'_, Shell>, id: String) -> Outcome {
  let _queue = shell.queue.lock().await;
  let (title, needs_confirm) =
    shell.store(|store| store.get(&id).map(|doc| (doc.title.clone(), doc.path.is_some() && DocumentStore::is_dirty(doc))))?;
  if needs_confirm {
    let answer = ask(&app, &format!("保存「{title}」的修改？"), MessageDialogKind::Info,
      MessageDialogButtons::YesNoCancelCustom("保存".into(), "不保存".into(), "取消".into()));
    match answer {
      MessageDialogResult::Yes => {}
      MessageDialogResult::Custom(label) if label == "保存" => {}
      MessageDialogResult::No => return remove(&shell, &id),
      MessageDialogResult::Custom(label) if label == "不保存" => return remove(&shell, &id),
      _ => return Ok(json!({ "cancelled": true })),
    }
    let saved = save_document(&app, &shell, &id, false)?;
    if saved.get("saved") != Some(&Value::Bool(true)) {
      return Ok(saved);
    }
  }
  remove(&shell, &id)
}

#[tauri::command]
async fn documents_reload(app: AppHandle, shell: tauri::State<'_, Shell>, id: String) -> Outcome {
  let _queue = shell.queue.lock().await;
  let title = shell.store(|store| store.get(&id).map(|doc| doc.title.clone()))?;
  let answer = ask(&app, &format!("从磁盘重新读取「{title}」？\n当前标签中的未保存修改将被替换。"), MessageDialogKind::Info,
    MessageDialogButtons::OkCancelCustom("重新读取".into(), "取消".into()));
  let confirmed = matches!(&answer, MessageDialogResult::Ok) || matches!(&answer, MessageDialogResult::Custom(label) if label == "重新读取");
  if !confirmed {
    return Ok(json!({ "cancelled": true }));
  }
  Ok(json!({ "reloaded": true, "snapshot": shell.store(|store| store.reload(&id))? }))
}

#[tauri::command]
async fn documents_pdf(app: AppHandle, shell: tauri::State<'_, Shell>, id: String, html: String) -> Outcome {
  let _queue = shell.queue.lock().await;
  if html.len() > 20 * 1024 * 1024 {
    return Err("导出内容过大。".into());
  }
  let title = shell.store(|store| store.get(&id).map(|doc| doc.title.clone()))?;
  let Some(destination) = choose_save(&app, "导出 PDF", None, suggested_filename(&title, "pdf"), ("PDF", &["pdf"])) else {
    return Ok(json!({ "cancelled": true }));
  };
  export_pdf(&app, &shell, &html, &destination).await?;
  Ok(json!({ "saved": true }))
}

#[cfg(not(windows))]
async fn export_pdf(_: &AppHandle, _: &Shell, _: &str, _: &Path) -> Outcome<()> { Err("PDF 导出仅支持 Windows。".into()) }

#[cfg(windows)]
async fn export_pdf(app: &AppHandle, shell: &Shell, html: &str, destination: &Path) -> Outcome<()> {
  let key = uuid::Uuid::new_v4().simple().to_string();
  let nonce = uuid::Uuid::new_v4().simple().to_string();
  // Fixed print page: renderer HTML is data only (no script, network or files); the
  // single nonce script reports when fonts and images are decoded.
  let page = format!(
    "<!doctype html><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'nonce-{nonce}'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'\"><style>{KATEX_CSS}</style>{html}<script nonce=\"{nonce}\">Promise.all([document.fonts.ready, ...Array.from(document.images, image => image.decode().catch(() => {{}}))]).finally(() => fetch('/ready/{key}'))</script>"
  );
  let (sender, receiver) = tokio::sync::oneshot::channel();
  shell.prints.lock().unwrap().insert(key.clone(), Print { html: page, ready: Some(sender) });
  let result = async {
    let url = Url::parse(&format!("http://print.localhost/{key}")).map_err(|error| error.to_string())?;
    let allowed = url.clone();
    let mut builder = WebviewWindowBuilder::new(app, format!("print-{key}"), WebviewUrl::External(url));
    if let Some(path) = &shell.webview_data {
      builder = builder.data_directory(path.clone());
    }
    let window = builder
      .visible(false)
      .on_navigation(move |target| target == &allowed)
      .on_new_window(|_, _| NewWindowResponse::Deny)
      .build()
      .map_err(|error| error.to_string())?;
    let outcome = async {
      tokio::time::timeout(Duration::from_secs(30), receiver)
        .await
        .map_err(|_| "PDF 准备超时。".to_string())?
        .map_err(|_| "PDF 准备被中断。".to_string())?;
      let directory = destination.parent().ok_or("路径无效。")?;
      let name = destination.file_name().unwrap_or_default().to_string_lossy().into_owned();
      let temporary = directory.join(format!(".{name}.{key}.tmp"));
      let printed = tokio::time::timeout(Duration::from_secs(40), webview2::print_to_pdf(&window, &temporary))
        .await
        .map_err(|_| "PDF 生成超时。".to_string())
        .and_then(|value| value);
      let moved = printed.and_then(|()| std::fs::rename(&temporary, destination).map_err(|error| error.to_string()));
      let _ = std::fs::remove_file(&temporary);
      moved
    }
    .await;
    let _ = window.destroy();
    outcome
  }
  .await;
  shell.prints.lock().unwrap().remove(&key);
  result
}

// ---------- application commands ----------

#[tauri::command]
fn renderer_ready(app: AppHandle, shell: tauri::State<'_, Shell>) -> bool {
  let closing = {
    let mut flags = shell.flags.lock().unwrap();
    flags.renderer_ready = true;
    flags.closing
  };
  shell.refresh_menu();
  if closing {
    let _ = app.emit("application:request-close", ());
  }
  true
}

#[tauri::command]
fn menu_state(shell: tauri::State<'_, Shell>, state: Value) {
  let document_id = match state.get("documentId") {
    Some(Value::Null) => None,
    Some(Value::String(id)) if id.len() <= 200 => Some(id.clone()),
    _ => return,
  };
  let flag = |key: &str| state.get(key).and_then(Value::as_bool);
  let (Some(ready), Some(busy), Some(source_mode), Some(revision)) =
    (flag("ready"), flag("busy"), flag("sourceMode"), state.get("revision").and_then(Value::as_i64))
  else {
    return;
  };
  {
    let mut current = shell.menu.lock().unwrap();
    if revision <= current.revision {
      return;
    }
    *current = MenuState { document_id, ready, busy, source_mode, revision };
  }
  shell.refresh_menu();
}

#[tauri::command]
async fn close_ready(app: AppHandle, shell: tauri::State<'_, Shell>) -> Outcome<bool> {
  let _queue = shell.queue.lock().await;
  if !shell.flags.lock().unwrap().closing {
    return Ok(false);
  }
  let exit_allowed = shell.store(|store| Ok(store.try_persist() || store.can_exit_without_recovery()))?;
  if !exit_allowed {
    shell.flags.lock().unwrap().closing = false;
    return Err("草稿备份不可用，请先保存所有修改再退出；未完成的草稿删除需恢复备份后重试。".into());
  }
  // The renderer has flushed pending edits; committed drafts survive normal exit.
  shell.flags.lock().unwrap().quitting = true;
  main_window(&app)?.destroy().map_err(|error| error.to_string())?;
  Ok(true)
}

#[tauri::command]
fn close_cancel(shell: tauri::State<'_, Shell>) -> bool {
  shell.flags.lock().unwrap().closing = false;
  true
}

#[tauri::command]
async fn capture_page(app: AppHandle, shell: tauri::State<'_, Shell>) -> Outcome<String> {
  let unavailable = || "页面画面暂不可用。".to_string();
  let window = main_window(&app)?;
  {
    let flags = shell.flags.lock().unwrap();
    if !flags.renderer_ready || flags.closing || window.is_minimized().unwrap_or(true) {
      return Err(unavailable());
    }
  }
  if shell.capturing.swap(true, Ordering::SeqCst) {
    return Err(unavailable());
  }
  #[cfg(windows)]
  let captured = tokio::time::timeout(Duration::from_secs(1), webview2::capture_png(&window)).await;
  #[cfg(not(windows))]
  let captured: Result<Result<Vec<u8>, String>, ()> = Ok(Err(String::new()));
  shell.capturing.store(false, Ordering::SeqCst);
  let png = captured.map_err(|_| unavailable())?.map_err(|_| unavailable())?;
  // Bounded like Electron (≤2048×1536, ≤8 MiB); larger frames skip the motion instead of resizing.
  let dimension = |at: usize| png.get(at..at + 4).map(|bytes| u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]));
  match (dimension(16), dimension(20)) {
    (Some(width), Some(height)) if width <= 2048 && height <= 1536 && png.len() <= 8 * 1024 * 1024 => {}
    _ => return Err(unavailable()),
  }
  Ok(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png)))
}

#[tauri::command]
fn updates_state(app: AppHandle) -> Value {
  json!({ "status": "disabled", "currentVersion": app.package_info().version.to_string(), "version": null, "progress": 0,
    "message": "轻量原型未接入更新。" })
}

// ---------- protocols ----------

fn respond(status: StatusCode, content_type: &str, body: Vec<u8>, origin: Option<&str>) -> Response<Vec<u8>> {
  let mut builder = Response::builder().status(status).header(header::CONTENT_TYPE, content_type);
  if let Some(origin) = origin {
    builder = builder.header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
  }
  builder.body(body).unwrap()
}

fn allowed_origin(request: &Request<Vec<u8>>) -> Option<String> {
  let origin = request.headers().get(header::ORIGIN)?.to_str().ok()?;
  ["http://tauri.localhost", "http://localhost:5200"].contains(&origin).then(|| origin.to_string())
}

fn document_image(app: &AppHandle, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
  let origin = allowed_origin(request);
  let status = |code: StatusCode| respond(code, "text/plain", vec![], origin.as_deref());
  let path = request.uri().path().trim_start_matches('/');
  let Some((id, source)) = path.split_once('/') else { return status(StatusCode::NOT_FOUND) };
  let decode = |text: &str| percent_encoding::percent_decode_str(text).decode_utf8().map(|text| text.into_owned());
  let (Ok(id), Ok(source)) = (decode(id), decode(source)) else { return status(StatusCode::NOT_FOUND) };
  let Some(document) = app.state::<Shell>().store(|store| Ok(store.document_path(&id))).ok().flatten() else {
    return status(StatusCode::FORBIDDEN);
  };
  let has_scheme = source
    .split_once(':')
    .is_some_and(|(scheme, _)| !scheme.is_empty() && scheme.chars().all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c)));
  if source.is_empty() || Path::new(&source).is_absolute() || source.starts_with(['/', '\\']) || has_scheme {
    return status(StatusCode::FORBIDDEN);
  }
  let resolved = (|| {
    let root = dunce::canonicalize(Path::new(&document).parent()?).ok()?;
    let path = dunce::canonicalize(root.join(&source)).ok()?;
    path.starts_with(&root).then_some(path)
  })();
  let Some(path) = resolved else { return status(StatusCode::FORBIDDEN) };
  let extension = path.extension().map(|ext| ext.to_string_lossy().to_lowercase()).unwrap_or_default();
  let mime = match extension.as_str() {
    "png" => "image/png",
    "jpg" | "jpeg" => "image/jpeg",
    "gif" => "image/gif",
    "webp" => "image/webp",
    _ => return status(StatusCode::FORBIDDEN),
  };
  match std::fs::metadata(&path) {
    Ok(info) if info.len() > 10 * 1024 * 1024 => status(StatusCode::PAYLOAD_TOO_LARGE),
    Ok(_) => match std::fs::read(&path) {
      Ok(bytes) => respond(StatusCode::OK, mime, bytes, origin.as_deref()),
      Err(_) => status(StatusCode::NOT_FOUND),
    },
    Err(_) => status(StatusCode::NOT_FOUND),
  }
}

fn print_page(app: &AppHandle, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
  let path = request.uri().path().trim_start_matches('/');
  let shell = app.state::<Shell>();
  let mut prints = shell.prints.lock().unwrap();
  if let Some(key) = path.strip_prefix("ready/") {
    if let Some(sender) = prints.get_mut(key).and_then(|print| print.ready.take()) {
      let _ = sender.send(());
    }
    return respond(StatusCode::NO_CONTENT, "text/plain", vec![], None);
  }
  match prints.get(path) {
    Some(print) => respond(StatusCode::OK, "text/html; charset=utf-8", print.html.clone().into_bytes(), None),
    None => respond(StatusCode::NOT_FOUND, "text/plain", vec![], None),
  }
}

// ---------- window, menu, startup ----------

fn build_menu(app: &AppHandle) -> tauri::Result<(Menu<Wry>, MenuItems)> {
  // Shortcuts are handled by the renderer (IME-aware); the menu only shows them.
  let command = |id: &str, label: &str| MenuItem::with_id(app, format!("document-{id}"), label, false, None::<&str>);
  let commands = vec![
    ("new", command("new", "新建\tCtrl+N")?),
    ("open", command("open", "打开\tCtrl+O")?),
    ("save", command("save", "保存\tCtrl+S")?),
    ("saveAs", command("saveAs", "另存为\tCtrl+Shift+S")?),
    ("pdf", command("pdf", "导出 PDF")?),
  ];
  let source = CheckMenuItem::with_id(app, "document-source", "源码模式", false, false, None::<&str>)?;
  let file = Submenu::with_items(app, "文件", true, &[
    &commands[0].1, &commands[1].1, &commands[2].1, &commands[3].1, &commands[4].1,
    &PredefinedMenuItem::separator(app)?,
    &MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?,
  ])?;
  let edit = Submenu::with_items(app, "编辑", true, &[
    &PredefinedMenuItem::undo(app, Some("撤销"))?, &PredefinedMenuItem::redo(app, Some("重做"))?, &PredefinedMenuItem::separator(app)?,
    &PredefinedMenuItem::cut(app, Some("剪切"))?, &PredefinedMenuItem::copy(app, Some("复制"))?, &PredefinedMenuItem::paste(app, Some("粘贴"))?,
    &PredefinedMenuItem::select_all(app, Some("全选"))?,
  ])?;
  let view = Submenu::with_items(app, "视图", true, &[
    &source, &PredefinedMenuItem::separator(app)?,
    &MenuItem::with_id(app, "zoom-reset", "实际大小", true, None::<&str>)?,
    &MenuItem::with_id(app, "zoom-in", "放大", true, None::<&str>)?,
    &MenuItem::with_id(app, "zoom-out", "缩小", true, None::<&str>)?,
    &MenuItem::with_id(app, "devtools", "开发者工具", true, None::<&str>)?,
  ])?;
  let menu = Menu::with_items(app, &[&file, &edit, &view])?;
  Ok((menu, MenuItems { commands, source }))
}

fn on_menu(app: &AppHandle, id: &str) {
  let shell = app.state::<Shell>();
  let Ok(window) = main_window(app) else { return };
  if let Some(name) = id.strip_prefix("document-") {
    // muda toggles checkboxes itself; restore the acknowledged state first.
    shell.refresh_menu();
    if shell.available(name) {
      let state = shell.menu.lock().unwrap().clone();
      let _ = app.emit("application:command", json!({ "name": name, "documentId": state.document_id, "revision": state.revision }));
    }
    return;
  }
  let zoom = |next: fn(f64) -> f64| {
    let mut zoom = shell.zoom.lock().unwrap();
    *zoom = next(*zoom).clamp(0.5, 3.0);
    let _ = window.set_zoom(*zoom);
  };
  match id {
    "quit" => {
      let _ = window.close();
    }
    "zoom-reset" => zoom(|_| 1.0),
    "zoom-in" => zoom(|value| value + 0.1),
    "zoom-out" => zoom(|value| value - 0.1),
    "devtools" => {
      if window.is_devtools_open() {
        window.close_devtools()
      } else {
        window.open_devtools()
      }
    }
    _ => {}
  }
}

fn is_app_url(url: &Url) -> bool {
  matches!(
    (url.scheme(), url.host_str(), url.port()),
    ("http", Some("tauri.localhost"), None) | ("tauri", Some("localhost"), None) | ("http", Some("localhost"), Some(5200))
  )
}

fn startup_files() -> Vec<PathBuf> {
  std::env::args()
    .skip(1)
    .filter(|arg| !arg.starts_with('-'))
    .filter(|arg| {
      let lower = arg.to_lowercase();
      [".md", ".markdown", ".txt"].iter().any(|ext| lower.ends_with(ext))
    })
    .filter_map(|arg| std::path::absolute(arg).ok())
    .collect()
}

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .register_uri_scheme_protocol("document-image", |context, request| document_image(context.app_handle(), &request))
    .register_uri_scheme_protocol("print", |context, request| print_page(context.app_handle(), &request))
    .setup(|app| {
      let handle = app.handle().clone();
      // Explicit test/developer profile only; never points tests at a user's recovery.
      let isolated = std::env::var_os("FROWANG_USER_DATA").map(|path| std::path::absolute(PathBuf::from(path))).transpose()?;
      let directory = match &isolated {
        Some(path) => path.clone(),
        None => app.path().app_data_dir()?,
      };
      let webview_data = isolated.map(|path| path.join("EBWebView"));
      let mut store = DocumentStore::restore(&directory);
      let failures: Vec<String> = startup_files().iter().filter_map(|path| store.open_file(path).err()).collect();
      let (menu, items) = build_menu(&handle).map_err(|error| format!("菜单创建失败：{error}"))?;
      app.set_menu(menu).map_err(|error| format!("菜单设置失败：{error}"))?;
      app.on_menu_event(|app, event| on_menu(app, event.id().as_ref()));
      app.manage(Shell {
        queue: tokio::sync::Mutex::new(()),
        store: Mutex::new(store),
        flags: Mutex::new(Flags::default()),
        menu: Mutex::new(MenuState { busy: true, ..Default::default() }),
        items,
        capturing: AtomicBool::new(false),
        prints: Mutex::new(HashMap::new()),
        zoom: Mutex::new(1.0),
        webview_data: webview_data.clone(),
      });
      let navigation = handle.clone();
      let popups = handle.clone();
      let mut builder = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()));
      if let Some(path) = webview_data {
        builder = builder.data_directory(path);
      }
      let window = builder
        .title("frowd lite")
        .inner_size(1160.0, 850.0)
        .min_inner_size(520.0, 400.0)
        .on_navigation(move |url| {
          if is_app_url(url) {
            return true;
          }
          if matches!(url.scheme(), "http" | "https") {
            let _ = navigation.opener().open_url(url.as_str(), None::<&str>);
          }
          false
        })
        .on_new_window(move |url, _| {
          if matches!(url.scheme(), "http" | "https") {
            let _ = popups.opener().open_url(url.as_str(), None::<&str>);
          }
          NewWindowResponse::Deny
        })
        .on_page_load(|window, payload| {
          if payload.event() == PageLoadEvent::Started {
            let shell = window.state::<Shell>();
            shell.flags.lock().unwrap().renderer_ready = false;
            shell.reset_menu();
          }
        })
        .build()
        .map_err(|error| format!("窗口创建失败：{error}"))?;
      let events = handle.clone();
      window.on_window_event(move |event| {
        let WindowEvent::CloseRequested { api, .. } = event else { return };
        let shell = events.state::<Shell>();
        let mut flags = shell.flags.lock().unwrap();
        if flags.quitting {
          return;
        }
        api.prevent_close();
        if !flags.renderer_ready {
          flags.closing = true;
          return;
        }
        if !flags.closing {
          flags.closing = true;
          drop(flags);
          shell.refresh_menu();
          let _ = events.emit("application:request-close", ());
        }
      });
      if !failures.is_empty() {
        handle.dialog().message(failures.join("\n")).title("打开失败").kind(MessageDialogKind::Error).show(|_| {});
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      documents_list,
      documents_read,
      documents_rename,
      documents_view_state,
      documents_new,
      documents_open,
      documents_update,
      documents_activate,
      documents_shelve,
      documents_undo_remove,
      documents_save,
      documents_close,
      documents_reload,
      documents_pdf,
      renderer_ready,
      menu_state,
      close_ready,
      close_cancel,
      capture_page,
      updates_state
    ])
    .run(tauri::generate_context!())
    .expect("frowd lite failed to start");
}
