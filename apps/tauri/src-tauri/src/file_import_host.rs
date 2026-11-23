use super::*;
use frowd_documents::file_import::{FileImport, ImportReference, ImportSource};
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SourceResult {
    cancelled: bool,
    source: Option<ImportSource>,
}
#[tauri::command]
pub(super) async fn choose_document_import(app: tauri::AppHandle) -> Result<SourceResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        *app.state::<AppState>()
            .file_import
            .lock()
            .map_err(|_| "导入服务不可用。")? = None;
        let Some(selected) = app
            .dialog()
            .file()
            .add_filter("UTF-8 TXT / HTML", &["txt", "html", "htm"])
            .blocking_pick_file()
        else {
            return Ok(SourceResult {
                cancelled: true,
                source: None,
            });
        };
        let pending = FileImport::read(&selected.into_path().map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        let source = pending.source.clone();
        *app.state::<AppState>()
            .file_import
            .lock()
            .map_err(|_| "导入服务不可用。")? = Some(pending);
        Ok(SourceResult {
            cancelled: false,
            source: Some(source),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub(super) async fn prepare_document_import_resources(
    token: String,
    references: Vec<ImportReference>,
    app: tauri::AppHandle,
) -> Result<Vec<frowd_documents::ResourceInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let mut pending = state.file_import.lock().map_err(|_| "导入服务不可用。")?;
        let pending = pending.as_mut().ok_or("导入来源已关闭，请重新选择。")?;
        pending.verify(&token).map_err(|e| e.to_string())?;
        let store = lock(&state)?;
        let result = pending
            .stage(&store, &references)
            .map_err(|e| e.to_string());
        result
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub(super) async fn commit_document_import(
    token: String,
    markdown: String,
    app: tauri::AppHandle,
) -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let mut slot = state.file_import.lock().map_err(|_| "导入服务不可用。")?;
        let mut store = lock(&state)?;
        if let Some(snapshot) = store
            .confirm_import(&token, &markdown)
            .map_err(|e| e.to_string())?
        {
            return Ok(snapshot);
        }
        slot.as_ref()
            .ok_or("导入来源已关闭，请重新选择。")?
            .verify(&token)
            .map_err(|e| e.to_string())?;
        let pending = slot.take().unwrap();
        let result = pending
            .commit(&mut store, &markdown)
            .map_err(|e| e.to_string());
        result
    })
    .await
    .map_err(|e| e.to_string())?
}
