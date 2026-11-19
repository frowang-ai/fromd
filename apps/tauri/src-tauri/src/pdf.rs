//! Windows PDF export. Only a main-window command can start a job. Its hidden
//! webview receives one immutable HTML document, no filesystem/network authority.
use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{collections::HashMap, io::{Read, Write}, sync::Arc, time::Duration};
use tauri::{UriSchemeContext, WebviewWindow};

const MAX_HTML: usize = 96 * 1024 * 1024;
const MAX_PDF_IMAGES: usize = 256;
const MAX_PDF_IMAGE_BYTES: usize = 50 * 1024 * 1024;
const MAX_INLINE_ENCODED: usize = frowd_documents::MAX_IMAGE_BYTES.div_ceil(3) * 4;
const CSP: &str = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";

#[derive(Default)]
pub(super) struct PdfState {
    busy: AtomicBool,
    document: Mutex<Option<PrintDocument>>,
}
struct PrintDocument { token: String, label: String, html: String }

fn main_only(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" { return Err("只能从主窗口导出 PDF。".into()); }
    Ok(())
}
fn check_revision(app: &tauri::AppHandle, id: &str, revision: i64) -> Result<(), String> {
    let state = app.state::<AppState>();
    let doc = lock(&state)?.snapshot().map_err(|e| e.to_string())?.documents.into_iter()
        .find(|doc| doc.id == id).ok_or("页面已移除，未导出 PDF。")?;
    if doc.revision != revision { return Err("正文已变化，请重新导出 PDF。".into()); }
    Ok(())
}

fn inline_image(reference: &str) -> Result<(Vec<u8>, String), String> {
    // Bound allocation before base64 decoding. Only four raster MIME headers
    // are accepted; no percent decoding, URL/file fetch, or SVG fallback.
    if reference.len() > MAX_INLINE_ENCODED + 32 { return Err("PDF 内嵌图片最多 10 MiB。".into()); }
    let (header, encoded) = reference.split_once(',').ok_or("PDF 内嵌图片编码无效。")?;
    let declared = match header.to_ascii_lowercase().as_str() {
        "data:image/png;base64" => "image/png",
        "data:image/jpeg;base64" => "image/jpeg",
        "data:image/gif;base64" => "image/gif",
        "data:image/webp;base64" => "image/webp",
        _ => return Err("PDF 内嵌图片只支持 PNG/JPEG/GIF/WebP 的 base64 编码。".into()),
    };
    if encoded.len() > MAX_INLINE_ENCODED { return Err("PDF 内嵌图片最多 10 MiB。".into()); }
    let bytes = STANDARD.decode(encoded).map_err(|_| "PDF 内嵌图片 base64 编码无效。")?;
    let mime = frowd_documents::validate_raster_image(&bytes).map_err(|e| format!("PDF 内嵌图片不可用：{e}"))?;
    if mime != declared { return Err("PDF 内嵌图片声明格式与实际图片不一致。".into()); }
    Ok((bytes, mime))
}

fn image_total(total: usize, next: usize) -> Result<usize, String> {
    total.checked_add(next).filter(|bytes| *bytes <= MAX_PDF_IMAGE_BYTES)
        .ok_or_else(|| "一次 PDF 图片合计最多 50 MiB。".into())
}

fn prepare_images(references: Vec<String>, mut read_file: impl FnMut(&str) -> Result<(Vec<u8>, String), String>) -> Result<HashMap<String, String>, String> {
    if references.len() > MAX_PDF_IMAGES { return Err("一次 PDF 最多包含 256 张不同图片。".into()); }
    let mut images = HashMap::new();
    let mut total = 0usize;
    for reference in references {
        let (bytes, mime) = if reference.get(..5).is_some_and(|prefix| prefix.eq_ignore_ascii_case("data:")) {
            inline_image(&reference)?
        } else {
            read_file(&reference)?
        };
        total = image_total(total, bytes.len())?;
        images.insert(reference, format!("data:{mime};base64,{}", STANDARD.encode(bytes)));
    }
    Ok(images)
}

#[tauri::command]
pub(super) async fn pdf_images(id: String, revision: i64, references: Vec<String>, window: WebviewWindow, app: tauri::AppHandle) -> Result<HashMap<String, String>, String> {
    main_only(&window)?;
    if references.len() > MAX_PDF_IMAGES { return Err("一次 PDF 最多包含 256 张不同图片。".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        check_revision(&app, &id, revision)?;
        let state = app.state::<AppState>();
        let store = lock(&state)?;
        prepare_images(references, |reference| store.resource_image(&id, reference).map_err(|e| format!("PDF 文件图片不可用：{e}")))
    }).await.map_err(|e| e.to_string())?
}

pub(super) fn document_response(ctx: UriSchemeContext<'_, tauri::Wry>, request: tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    let state = ctx.app_handle().state::<PdfState>();
    let document = state.document.lock().unwrap();
    let html = document.as_ref().filter(|doc| ctx.webview_label() == doc.label && request.uri().path() == format!("/{}", doc.token));
    match html {
        Some(doc) => tauri::http::Response::builder().header("Content-Type", "text/html; charset=utf-8")
            .header("Content-Security-Policy", CSP).header("Cache-Control", "no-store")
            .body(doc.html.as_bytes().to_vec()).unwrap(),
        None => tauri::http::Response::builder().status(403).body(Vec::new()).unwrap(),
    }
}

#[derive(Serialize)]
pub(super) struct ExportResult { cancelled: bool }

// This guard revokes HTML access and destroys the worker on every return path,
// including an IPC future dropped during application shutdown.
struct JobGuard { app: tauri::AppHandle, label: String }
impl Drop for JobGuard {
    fn drop(&mut self) {
        let state = self.app.state::<PdfState>();
        state.document.lock().unwrap().take();
        if let Some(window) = self.app.get_webview_window(&self.label) { let _ = window.destroy(); }
        state.busy.store(false, Ordering::SeqCst);
    }
}

#[tauri::command]
pub(super) async fn export_pdf(id: String, revision: i64, html: String, window: WebviewWindow, app: tauri::AppHandle) -> Result<ExportResult, String> {
    main_only(&window)?;
    if html.len() > MAX_HTML || !html.starts_with("<!doctype html>") { return Err("PDF 文档过大或格式无效。".into()); }
    check_revision(&app, &id, revision)?;
    let state = app.state::<PdfState>();
    if state.busy.swap(true, Ordering::SeqCst) { return Err("已有 PDF 正在导出，请稍候。".into()); }
    let token = uuid::Uuid::new_v4().to_string();
    let label = format!("pdf-{token}");
    let _guard = JobGuard { app: app.clone(), label: label.clone() };
    let picker_app = app.clone();
    let picker_id = id.clone();
    let target = tauri::async_runtime::spawn_blocking(move || {
        let state = picker_app.state::<AppState>();
        let doc = lock(&state)?.snapshot().map_err(|e| e.to_string())?.documents.into_iter()
            .find(|doc| doc.id == picker_id).ok_or("页面已移除。")?;
        // Native automation skips only the picker, never the print implementation.
        // This override is absent in release and confined to an isolated debug
        // profile supplied by the launching test process, not renderer arguments.
        #[cfg(debug_assertions)]
        if let Some(target) = std::env::var_os("FROWD_PDF_TEST_TARGET") {
            let target = PathBuf::from(target);
            let profile = std::env::var_os("FROWANG_USER_DATA").ok_or("PDF 测试缺少隔离 profile。")?;
            let profile = std::fs::canonicalize(profile).map_err(|e| e.to_string())?;
            let parent = target.parent().ok_or("PDF 测试目标无效。")?;
            if !target.is_absolute() || !std::fs::canonicalize(parent).map_err(|e| e.to_string())?.starts_with(profile) {
                return Err("PDF 测试目标必须在隔离 profile 内。".into());
            }
            return Ok::<_, String>(Some(target));
        }
        let filename = PathBuf::from(suggested_name(&doc.title)).with_extension("pdf");
        let mut dialog = picker_app.dialog().file().add_filter("PDF", &["pdf"]).set_file_name(filename.to_string_lossy());
        if let Some(directory) = doc.path.as_ref().and_then(|p| Path::new(p).parent()) { dialog = dialog.set_directory(directory); }
        dialog.blocking_save_file().map(|selected| selected.into_path().map_err(|e| e.to_string())).transpose()
    }).await.map_err(|e| e.to_string())??;
    let Some(target) = target else { return Ok(ExportResult { cancelled: true }); };
    check_revision(&app, &id, revision)?;
    export_to_path(&app, &token, &label, html, &target).await?;
    Ok(ExportResult { cancelled: false })
}

async fn export_to_path(app: &tauri::AppHandle, token: &str, label: &str, html: String, target: &Path) -> Result<(), String> {
    let parent = target.parent().filter(|p| p.is_absolute()).ok_or("PDF 保存位置无效。")?;
    // A directory on the same volume lets persist perform an atomic replacement.
    let temporary = tempfile::Builder::new().prefix(".frowd-pdf-").tempdir_in(parent).map_err(|e| e.to_string())?;
    let printed = temporary.path().join("document.pdf");
    app.state::<PdfState>().document.lock().unwrap().replace(PrintDocument { token: token.into(), label: label.into(), html });
    let result = windows_print(app, label, token, &printed).await;
    // Revoke content before destroying the window; never leave a reusable URL.
    app.state::<PdfState>().document.lock().unwrap().take();
    let cleanup = destroy_worker(app, label).await;
    result?;
    cleanup?;
    atomic_replace_pdf(&printed, target)?;
    Ok(())
}

async fn destroy_worker(app: &tauri::AppHandle, label: &str) -> Result<(), String> {
    if let Some(worker) = app.get_webview_window(label) {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let sender = Arc::new(Mutex::new(Some(sender)));
        worker.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if let Some(sender) = sender.lock().unwrap().take() { let _ = sender.send(()); }
            }
        });
        worker.destroy().map_err(|e| e.to_string())?;
        // Do not remove the print directory while WebView2 may still be writing.
        tokio::time::timeout(Duration::from_secs(5), receiver).await
            .map_err(|_| "PDF 窗口清理超时。")?.map_err(|_| "PDF 窗口清理失败。")?;
    }
    Ok(())
}

fn atomic_replace_pdf(source: &Path, target: &Path) -> Result<(), String> {
    let mut file = std::fs::File::open(source).map_err(|e| e.to_string())?;
    let mut magic = [0u8; 5];
    file.read_exact(&mut magic).map_err(|_| "PDF 打印结果不完整。")?;
    if &magic != b"%PDF-" { return Err("PDF 打印结果无效。".into()); }
    let mut output = tempfile::Builder::new().prefix(".frowd-pdf-save-").tempfile_in(target.parent().unwrap()).map_err(|e| e.to_string())?;
    output.write_all(&magic).map_err(|e| e.to_string())?;
    std::io::copy(&mut file, &mut output).map_err(|e| e.to_string())?;
    output.as_file().sync_all().map_err(|e| e.to_string())?;
    output.persist(target).map_err(|e| format!("PDF 保存失败，原文件已保留：{}", e.error))?;
    Ok(())
}

#[cfg(not(windows))]
async fn windows_print(_: &tauri::AppHandle, _: &str, _: &str, _: &Path) -> Result<(), String> { Err("当前平台暂不支持 PDF 导出。".into()) }

#[cfg(windows)]
#[path = "pdf_windows.rs"]
mod native;
#[cfg(windows)]
use native::windows_print;

#[cfg(test)]
mod tests {
    use super::*;
    const PNG: &[u8] = include_bytes!("../../tests/fixtures/synthetic-resource.png");
    #[test]
    fn inline_raster_is_validated_without_file_access_and_shares_the_image_budget() {
        let data = format!("data:image/png;base64,{}", STANDARD.encode(PNG));
        let mut files = Vec::new();
        let images = prepare_images(vec![data.clone(), "relative.png".into()], |reference| {
            files.push(reference.to_owned()); Ok((PNG.to_vec(), "image/png".into()))
        }).unwrap();
        assert_eq!(files, ["relative.png"]);
        assert_eq!(images[&data], data);
        assert_eq!(images["relative.png"], data);
        assert!(prepare_images(vec![data; 257], |_| panic!("count must be bounded before file access")).is_err());
        let total = image_total(MAX_PDF_IMAGE_BYTES - PNG.len(), PNG.len()).unwrap();
        assert_eq!(total, MAX_PDF_IMAGE_BYTES);
        assert!(image_total(total, 1).is_err());
    }
    #[test]
    fn inline_raster_rejects_bad_encoding_mime_svg_and_oversize_without_echoing_data() {
        for data in [
            "data:image/png;base64,not-base64-SECRET".to_owned(),
            format!("data:image/jpeg;base64,{}", STANDARD.encode(PNG)),
            "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=".to_owned(),
            format!("data:image/png;base64,{}", STANDARD.encode(b"<svg>SECRET</svg>")),
            format!("data:image/png;base64,{}", STANDARD.encode(&PNG[..32])),
            format!("data:image/png;base64,{}", "A".repeat(MAX_INLINE_ENCODED + 4)),
        ] {
            let error = inline_image(&data).unwrap_err();
            assert!(!error.contains("SECRET"));assert!(!error.contains("data:"));assert!(error.len() < 256);
        }
        let mut oversized = PNG.to_vec();oversized.resize(frowd_documents::MAX_IMAGE_BYTES + 1, 0);
        assert!(inline_image(&format!("data:image/png;base64,{}", STANDARD.encode(oversized))).unwrap_err().contains("10 MiB"));
    }
    #[test]
    fn atomic_pdf_replaces_only_a_successful_result() {
        let dir = tempfile::tempdir().unwrap();
        let old = dir.path().join("旧文件.pdf");
        let printed = dir.path().join("printed.pdf");
        std::fs::write(&old, b"previous").unwrap();
        std::fs::write(&printed, b"broken").unwrap();
        assert!(atomic_replace_pdf(&printed, &old).is_err());
        assert_eq!(std::fs::read(&old).unwrap(), b"previous");
        std::fs::write(&printed, b"%PDF-1.7\nnew export").unwrap();
        atomic_replace_pdf(&printed, &old).unwrap();
        assert_eq!(std::fs::read(&old).unwrap(), b"%PDF-1.7\nnew export");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);
    }
}
