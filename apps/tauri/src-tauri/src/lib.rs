use frowd_documents::filename::suggested_name;
mod document_links;
use frowd_documents::{Document, Snapshot, Store, MAX_SESSION_BYTES};
use serde::Serialize;
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, MutexGuard,
    },
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

struct AppState {
    store: Mutex<Store>,
    closing: AtomicBool,
    close_confirmed: AtomicBool,
}
fn lock<'a>(state: &'a State<'_, AppState>) -> Result<MutexGuard<'a, Store>, String> {
    state
        .store
        .lock()
        .map_err(|_| "文档服务已停止，请保留当前内容。".into())
}
#[tauri::command]
fn list_metadata(state: State<'_, AppState>) -> Result<Snapshot, String> {
    lock(&state)?.snapshot().map_err(|e| e.to_string())
}
#[tauri::command]
async fn search_documents(
    query: String,
    app: tauri::AppHandle,
) -> Result<Vec<frowd_documents::search::SearchHit>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let result = lock(&state)?.search(&query).map_err(|e| e.to_string());
        result
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn read_document(id: String, state: State<'_, AppState>) -> Result<Document, String> {
    lock(&state)?.read(&id).map_err(|e| e.to_string())
}
#[tauri::command]
fn create_document(
    markdown: Option<String>,
    title: Option<String>,
    state: State<'_, AppState>,
) -> Result<Snapshot, String> {
    lock(&state)?
        .create(
            markdown.as_deref().unwrap_or(""),
            title.as_deref().unwrap_or("未命名笔记"),
        )
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn update_document(
    id: String,
    markdown: String,
    revision: i64,
    state: State<'_, AppState>,
) -> Result<Snapshot, String> {
    lock(&state)?
        .update(&id, &markdown, revision)
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn rename_document(
    id: String,
    title: String,
    state: State<'_, AppState>,
) -> Result<Snapshot, String> {
    lock(&state)?.rename(&id, &title).map_err(|e| e.to_string())
}
#[tauri::command]
fn set_view_state(
    id: String,
    view_state: Value,
    state: State<'_, AppState>,
) -> Result<Snapshot, String> {
    lock(&state)?
        .set_view(&id, view_state)
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn activate_document(id: String, state: State<'_, AppState>) -> Result<Snapshot, String> {
    lock(&state)?.activate(&id).map_err(|e| e.to_string())
}
#[tauri::command]
fn shelve_document(id: String, state: State<'_, AppState>) -> Result<Snapshot, String> {
    lock(&state)?.shelve(&id).map_err(|e| e.to_string())
}
#[tauri::command]
fn expand_all(state: State<'_, AppState>) -> Result<Snapshot, String> {
    lock(&state)?.expand_all().map_err(|e| e.to_string())
}
#[tauri::command]
fn shelve_others(id: String, state: State<'_, AppState>) -> Result<Snapshot, String> {
    lock(&state)?.shelve_others(&id).map_err(|e| e.to_string())
}
#[tauri::command]
fn shelve_all(state: State<'_, AppState>) -> Result<Snapshot, String> {
    lock(&state)?.shelve_all().map_err(|e| e.to_string())
}
#[tauri::command]
fn remove_document(
    id: String,
    decision: String,
    state: State<'_, AppState>,
) -> Result<Snapshot, String> {
    lock(&state)?
        .remove(&id, &decision)
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn undo_remove(state: State<'_, AppState>) -> Result<Snapshot, String> {
    lock(&state)?.undo_remove().map_err(|e| e.to_string())
}
#[tauri::command]
fn reorder_documents(
    ids: Vec<String>,
    layout_revision: i64,
    state: State<'_, AppState>,
) -> Result<Snapshot, String> {
    lock(&state)?
        .reorder_visible(&ids, layout_revision)
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn checkpoint(state: State<'_, AppState>) -> Result<(), String> {
    lock(&state)?.checkpoint().map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct FileResult {
    cancelled: bool,
    snapshot: Option<Snapshot>,
}
#[tauri::command]
async fn open_document(app: tauri::AppHandle) -> Result<FileResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app
            .dialog()
            .file()
            .add_filter("Markdown / 文本", &["md", "markdown", "txt"])
            .blocking_pick_file();
        let Some(selected) = selected else {
            return Ok(FileResult {
                cancelled: true,
                snapshot: None,
            });
        };
        let path = selected.into_path().map_err(|e| e.to_string())?;
        let state = app.state::<AppState>();
        let snapshot = lock(&state)?.open_file(&path).map_err(|e| e.to_string())?;
        Ok(FileResult {
            cancelled: false,
            snapshot: Some(snapshot),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn save_document(
    id: String,
    save_as: bool,
    app: tauri::AppHandle,
) -> Result<FileResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let doc = lock(&state)?
            .snapshot()
            .map_err(|e| e.to_string())?
            .documents
            .into_iter()
            .find(|d| d.id == id)
            .ok_or_else(|| "笔记已经移除。".to_owned())?;
        let target = if save_as || doc.path.is_none() {
            let mut dialog = app
                .dialog()
                .file()
                .add_filter("Markdown", &["md"])
                .set_file_name(suggested_name(&doc.title));
            if let Some(path) = doc.path.as_ref().and_then(|p| Path::new(p).parent()) {
                dialog = dialog.set_directory(path);
            }
            let Some(selected) = dialog.blocking_save_file() else {
                return Ok(FileResult {
                    cancelled: true,
                    snapshot: None,
                });
            };
            Some(selected.into_path().map_err(|e| e.to_string())?)
        } else {
            None
        };
        let snapshot = lock(&state)?
            .save_file(&id, target.as_deref())
            .map_err(|e| e.to_string())?;
        Ok(FileResult {
            cancelled: false,
            snapshot: Some(snapshot),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn open_document_link(
    id: String,
    href: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let doc = lock(&state)?
        .snapshot()
        .map_err(|e| e.to_string())?
        .documents
        .into_iter()
        .find(|d| d.id == id)
        .ok_or_else(|| "页面已经移除。".to_owned())?;
    document_links::open(&app, &href, doc.path.as_deref())
}
#[tauri::command]
fn close_ready(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    // A renderer confirmation is necessary; it is never replaced by a fixed timeout.
    lock(&state)?.checkpoint().map_err(|e| e.to_string())?;
    state.close_confirmed.store(true, Ordering::SeqCst);
    let result = app
        .get_webview_window("main")
        .ok_or_else(|| "应用窗口已关闭。".to_owned())?
        .close()
        .map_err(|e| e.to_string());
    if result.is_err() {
        state.close_confirmed.store(false, Ordering::SeqCst);
        state.closing.store(false, Ordering::SeqCst);
    }
    result
}
#[tauri::command]
fn cancel_close(state: State<'_, AppState>) {
    state.closing.store(false, Ordering::SeqCst);
}
fn profile(app: &tauri::App) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if cfg!(debug_assertions) {
        if let Some(directory) = std::env::var_os("FROWANG_USER_DATA") {
            let path = PathBuf::from(directory);
            if !path.is_absolute() {
                return Err("FROWANG_USER_DATA must be absolute".into());
            }
            return Ok(path);
        }
    }
    Ok(app.path().app_data_dir()?)
}
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let store = Store::open(&profile(app)?, MAX_SESSION_BYTES)?;
            app.manage(AppState {
                store: Mutex::new(store),
                closing: AtomicBool::new(false),
                close_confirmed: AtomicBool::new(false),
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                if !state.close_confirmed.load(Ordering::SeqCst) {
                    api.prevent_close();
                    if !state.closing.swap(true, Ordering::SeqCst) {
                        let _ = window.emit("frowd:close-requested", ());
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_metadata,
            search_documents,
            read_document,
            create_document,
            update_document,
            rename_document,
            set_view_state,
            activate_document,
            shelve_document,
            expand_all,
            shelve_others,
            shelve_all,
            remove_document,
            undo_remove,
            reorder_documents,
            open_document,
            save_document,
            checkpoint,
            close_ready,
            cancel_close,
            open_document_link
        ])
        .run(tauri::generate_context!())
        .expect("frowd startup failed; original profile preserved");
}
