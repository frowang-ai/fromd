use super::*;
use frowd_documents::{ResourceInfo, ResourceInput, ResourceReference, MAX_ATTACHMENT_BYTES, MAX_IMPORT_BYTES};
use std::{fs::File, io::Read};
use tauri_plugin_opener::OpenerExt;

#[derive(Serialize)]
pub(super) struct ImportResult {
    cancelled: bool,
    resources: Vec<ResourceInfo>,
}

fn header(request: &tauri::ipc::Request<'_>, key: &str, max: usize) -> Result<String, String> {
    let value = request
        .headers()
        .get(key)
        .and_then(|h| h.to_str().ok())
        .ok_or("缺少资源请求头。")?;
    if value.len() > max {
        return Err("资源请求头过长。".into());
    }
    percent_encoding::percent_decode_str(value)
        .decode_utf8()
        .map(|s| s.into_owned())
        .map_err(|_| "资源请求头编码无效。".into())
}
#[tauri::command]
pub(super) async fn import_resources(
    request: tauri::ipc::Request<'_>,
    app: tauri::AppHandle,
) -> Result<ImportResult, String> {
    let id = header(&request, "x-frowd-doc-id", 512)?;
    let metadata = header(&request, "x-frowd-resources", 16384)?;
    let inputs: Vec<ResourceInput> =
        serde_json::from_str(&metadata).map_err(|_| "资源描述无效。")?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("资源请求必须使用二进制正文。".into());
    };
    if bytes.len() > MAX_IMPORT_BYTES {
        return Err("每批资源最多 50 MiB。".into());
    }
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let resources = lock(&state)?
            .import_resources(&id, &inputs, &bytes)
            .map_err(|e| e.to_string())?;
        Ok(ImportResult {
            cancelled: false,
            resources,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub(super) async fn reuse_resources(
    id: String,
    references: Vec<ResourceReference>,
    purpose: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    // This is an explicit paste operation, not a general path/asset grant.
    if purpose != "clipboard-paste" {
        return Err("资源复用仅允许显式粘贴，请重新导入。".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let result = lock(&state)?
            .reuse_resources(&id, &references)
            .map_err(|e| e.to_string());
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(super) async fn copy_document_images(
    id: String,
    source_id: String,
    source_path: String,
    images: Vec<String>,
    legacy_references: Vec<ResourceReference>,
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Vec<String>, String> {
    if window.label() != "main" {
        return Err("只能在主窗口粘贴文稿图片。".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let result = lock(&state)?.copy_document_images(&source_id, &source_path, &id, &images, &legacy_references)
            .map_err(|e| e.to_string());
        result
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub(super) async fn choose_resources(
    id: String,
    kind: String,
    app: tauri::AppHandle,
) -> Result<ImportResult, String> {
    if !matches!(kind.as_str(), "auto" | "image" | "attachment") {
        return Err("未知资源类型。".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        // Validate ownership before showing a dialog; never accept renderer paths.
        {
            let state = app.state::<AppState>();
            if !lock(&state)?
                .snapshot()
                .map_err(|e| e.to_string())?
                .documents
                .iter()
                .any(|d| d.id == id)
            {
                return Err("页面已经移除。".into());
            }
        }
        let mut picker = app.dialog().file();
        if kind == "image" {
            picker = picker.add_filter(
                "PNG / JPEG / GIF / WebP / SVG",
                &["png", "jpg", "jpeg", "gif", "webp", "svg"],
            )
        }
        let Some(selected) = picker.blocking_pick_files() else {
            return Ok(ImportResult {
                cancelled: true,
                resources: vec![],
            });
        };
        if selected.len() > 8 {
            return Err("每批最多 8 个资源。".into());
        }
        let mut inputs = Vec::new();
        let mut payload = Vec::new();
        for selected in selected {
            let path = selected.into_path().map_err(|e| e.to_string())?;
            let mut file = File::open(&path).map_err(|e| e.to_string())?;
            let meta = file.metadata().map_err(|e| e.to_string())?;
            if !meta.is_file() || meta.len() > MAX_ATTACHMENT_BYTES as u64 {
                return Err("附件不是普通文件或超过 25 MiB。".into());
            }
            if payload.len() as u64 + meta.len() > MAX_IMPORT_BYTES as u64 {
                return Err("每批资源合计最多 50 MiB。".into());
            }
            let mut bytes = Vec::new();
            (&mut file)
                .take(MAX_ATTACHMENT_BYTES as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            if bytes.len() > MAX_ATTACHMENT_BYTES || payload.len() + bytes.len() > MAX_IMPORT_BYTES
            {
                return Err("读取期间资源增长超过上限。".into());
            }
            let name = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            let image = kind == "image"
                || kind == "auto"
                    && path.extension().is_some_and(|e| {
                        matches!(
                            e.to_string_lossy().to_ascii_lowercase().as_str(),
                            "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg"
                        )
                    });
            inputs.push(ResourceInput {
                name,
                size: bytes.len(),
                image,
            });
            payload.extend(bytes);
        }
        let state = app.state::<AppState>();
        let resources = lock(&state)?
            .import_resources(&id, &inputs, &payload)
            .map_err(|e| e.to_string())?;
        Ok(ImportResult {
            cancelled: false,
            resources,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
pub(super) fn image_response(
    app: &tauri::AppHandle,
    request: tauri::http::Request<Vec<u8>>,
    webview_label: &str,
) -> tauri::http::Response<Vec<u8>> {
    let origin = request
        .headers()
        .get("origin")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let allowed = protocol_urls::resource_source(webview_label, request.headers(), cfg!(debug_assertions));
    let response = tauri::http::Response::builder()
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff");
    let response = if allowed && !origin.is_empty() {
        response
            .header("Access-Control-Allow-Origin", origin)
            .header("Vary", "Origin")
    } else {
        response
    };
    let result = (|| -> Result<(Vec<u8>, String), String> {
        if !allowed {
            return Err("资源来源不允许。".into());
        }
        if request.method() != tauri::http::Method::GET {
            return Err("资源只支持 GET。".into());
        }
        if request.uri().to_string().len() > 8192 {
            return Err("资源地址过长。".into());
        }
        let (id, reference) = protocol_urls::image_route(&request.uri().to_string())?;
        let state = app.state::<AppState>();
        let result = lock(&state)?
            .resource_image(&id, &reference)
            .map_err(|e| e.to_string());
        result
    })();
    match result {
        Ok((bytes, mime)) if mime == "image/svg+xml" => response
            .header("Content-Type", "image/svg+xml")
            .header("Content-Security-Policy", "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:")
            .body(bytes)
            .unwrap(),
        Ok((bytes, mime)) => response.header("Content-Type", mime).body(bytes).unwrap(),
        Err(_) => response
            .status(403)
            .header("Content-Type", "text/plain; charset=utf-8")
            .body(b"Resource unavailable for this document".to_vec())
            .unwrap(),
    }
}
pub(super) fn reveal_managed(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
    id: &str,
    href: &str,
) -> Result<bool, String> {
    let path = lock(state)?
        .managed_attachment(id, href)
        .map_err(|e| e.to_string())?;
    if let Some(path) = path {
        app.opener()
            .reveal_item_in_dir(path)
            .map_err(|e| e.to_string())?;
        return Ok(true);
    }
    // An exported document opened in a new profile resolves relative files via
    // document_links; an unsaved draft still cannot acquire arbitrary paths.
    Ok(false)
}
