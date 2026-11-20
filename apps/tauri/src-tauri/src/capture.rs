//! One bounded, in-memory PNG of the calling main WebView, never the desktop.
use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{sync::Arc, time::Duration};
use tauri::WebviewWindow;

const MAX_BYTES: usize = 16 * 1024 * 1024;
const MAX_PIXELS: u64 = 16 * 1024 * 1024;
const MAX_EDGE: u32 = 8192;

#[derive(Default)]
pub(super) struct CaptureState { busy: Arc<AtomicBool> }
struct Flight(Arc<AtomicBool>);
impl Drop for Flight {
    fn drop(&mut self) { self.0.store(false, Ordering::SeqCst); }
}
fn dimensions(width: u32, height: u32) -> Result<(), String> {
    if width == 0 || height == 0 || width > MAX_EDGE || height > MAX_EDGE || u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err("当前视口超出动效截图尺寸限制。".into());
    }
    Ok(())
}
fn trusted(label: &str, url: &tauri::Url, dev: Option<&tauri::Url>) -> bool {
    label == "main" && (matches!(url.origin().ascii_serialization().as_str(),
        "tauri://localhost" | "http://tauri.localhost" | "https://tauri.localhost") ||
        cfg!(debug_assertions) && dev.is_some_and(|dev| dev.host_str() == Some("127.0.0.1") && url.origin() == dev.origin()))
}
fn png_dimensions(header: &[u8], expected: (u32, u32)) -> Result<(), String> {
    if header.len() < 24 || &header[..8] != b"\x89PNG\r\n\x1a\n" || &header[12..16] != b"IHDR" {
        return Err("WebView 截图未返回有效 PNG。".into());
    }
    let width = u32::from_be_bytes(header[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(header[20..24].try_into().unwrap());
    dimensions(width, height)?;
    if (width, height) != expected { return Err("截图期间视口尺寸已变化。".into()); }
    Ok(())
}

#[tauri::command]
pub(super) async fn capture_main_viewport(window: WebviewWindow, app: tauri::AppHandle) -> Result<String, String> {
    let url = window.url().map_err(|e| e.to_string())?;
    if !trusted(window.label(), &url, app.config().build.dev_url.as_ref()) {
        return Err("只能捕获主窗口当前视口。".into());
    }
    if !window.is_visible().map_err(|e| e.to_string())? || window.is_minimized().map_err(|e| e.to_string())? {
        return Err("主窗口当前不可见。".into());
    }
    let size = window.inner_size().map_err(|e| e.to_string())?;
    dimensions(size.width, size.height)?;
    let state = app.state::<CaptureState>();
    state.busy.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "上次视口捕获尚未结束。".to_string())?;
    // Both the IPC response/encoding and COM callback retain this guard. A
    // timeout releases neither the native slot nor a callback's resources early.
    let flight = Arc::new(Flight(state.busy.clone()));
    #[cfg(windows)]
    let bytes = windows_capture(window, (size.width, size.height), flight.clone()).await?;
    #[cfg(not(windows))]
    let bytes: Vec<u8> = { drop(flight); return Err("当前平台尚未接入原生收起动效截图。".into()); };
    Ok(format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
}

#[cfg(windows)]
async fn windows_capture(window: WebviewWindow, expected: (u32, u32), flight: Arc<Flight>) -> Result<Vec<u8>, String> {
    use tokio::sync::oneshot;
    use webview2_com::{CapturePreviewCompletedHandler, Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG};
    use windows::Win32::{Foundation::{HGLOBAL, E_ACCESSDENIED}, System::Com::{IStream, STATSTG, STATFLAG_NONAME, STREAM_SEEK_SET, StructuredStorage::CreateStreamOnHGlobal}};
    type Reply = Arc<Mutex<Option<oneshot::Sender<Result<Vec<u8>, String>>>>>;
    fn send(reply: &Reply, result: Result<Vec<u8>, String>) { if let Some(sender) = reply.lock().unwrap().take() { let _ = sender.send(result); } }
    unsafe fn read_png(stream: &IStream, expected: (u32, u32)) -> Result<Vec<u8>, String> {
        let mut stat = STATSTG::default();
        stream.Stat(&mut stat, STATFLAG_NONAME).map_err(|e| e.to_string())?;
        if stat.cbSize < 24 || stat.cbSize > MAX_BYTES as u64 { return Err("视口 PNG 超出16MiB限制。".into()); }
        stream.Seek(0, STREAM_SEEK_SET, None).map_err(|e| e.to_string())?;
        let mut header = [0u8; 24]; let mut count = 0;
        stream.Read(header.as_mut_ptr().cast(), 24, Some(&mut count)).ok().map_err(|e| e.to_string())?;
        if count != 24 { return Err("视口 PNG 头不完整。".into()); }
        png_dimensions(&header, expected)?;
        stream.Seek(0, STREAM_SEEK_SET, None).map_err(|e| e.to_string())?;
        let mut bytes = vec![0u8; stat.cbSize as usize];
        stream.Read(bytes.as_mut_ptr().cast(), bytes.len() as u32, Some(&mut count)).ok().map_err(|e| e.to_string())?;
        if count as usize != bytes.len() { return Err("视口 PNG 不完整。".into()); }
        Ok(bytes)
    }
    let (sender, receiver) = oneshot::channel();
    let reply: Reply = Arc::new(Mutex::new(Some(sender)));
    let caller = window.clone();
    let dev = window.app_handle().config().build.dev_url.clone();
    window.with_webview(move |platform| unsafe {
        let completed = reply.clone();
        let result = (|| -> windows::core::Result<()> {
            // Recheck after dispatching to the STA, before capturing pixels.
            let current = caller.url().map_err(|_| windows::core::Error::from_hresult(E_ACCESSDENIED))?;
            if !trusted(caller.label(), &current, dev.as_ref()) || !caller.is_visible().unwrap_or(false) || caller.is_minimized().unwrap_or(true) {
                return Err(windows::core::Error::from_hresult(E_ACCESSDENIED));
            }
            let core = platform.controller().CoreWebView2()?;
            let stream = CreateStreamOnHGlobal(HGLOBAL::default(), true)?;
            let output = stream.clone();
            let callback = CapturePreviewCompletedHandler::create(Box::new(move |status| {
                // Keep the slot until this COM completion, even when the IPC
                // caller timed out/cancelled. Late PNGs are released, not read.
                let _flight = flight;
                if completed.lock().unwrap().as_ref().is_some_and(|sender| sender.is_closed()) { return Ok(()); }
                send(&completed, status.map_err(|e| e.to_string()).and_then(|_| read_png(&output, expected)));
                Ok(())
            }));
            core.CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, &stream, &callback)
        })();
        if let Err(error) = result { send(&reply, Err(format!("原生视口捕获失败：{error}"))); }
    }).map_err(|e| e.to_string())?;
    tokio::time::timeout(Duration::from_millis(850), receiver).await
        .map_err(|_| "原生视口捕获超时。".to_string())?.map_err(|_| "视口捕获窗口已关闭。".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_main_on_trusted_origin_can_capture() {
        let dev: tauri::Url = "http://127.0.0.1:1420".parse().unwrap();
        let local: tauri::Url = "http://tauri.localhost/".parse().unwrap();
        assert!(trusted("main", &local, Some(&dev)));
        assert!(!trusted("pdf-hidden", &local, Some(&dev)));
        assert!(!trusted("main", &"https://example.com/".parse().unwrap(), Some(&dev)));
        assert!(!trusted("main", &"http://127.0.0.1:1475/".parse().unwrap(), Some(&dev)));
    }
    #[test]
    fn png_size_and_viewport_change_are_bounded() {
        let mut header = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
        header.extend(1280u32.to_be_bytes()); header.extend(820u32.to_be_bytes());
        assert!(png_dimensions(&header, (1280, 820)).is_ok());
        assert!(png_dimensions(&header, (1279, 820)).is_err());
        assert!(png_dimensions(b"not png", (1280, 820)).is_err());
        assert!(dimensions(0, 820).is_err());
        assert!(dimensions(8192, 8192).is_err());
    }
    #[test]
    fn in_flight_slot_lives_until_callback_guard_is_released() {
        let state = CaptureState::default();
        assert!(state.busy.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_ok());
        let flight = Flight(state.busy.clone());
        assert!(state.busy.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err());
        drop(flight);
        assert!(!state.busy.load(Ordering::SeqCst));
    }
}
