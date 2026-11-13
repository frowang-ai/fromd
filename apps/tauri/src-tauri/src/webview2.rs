//! WebView2-only features that Tauri does not wrap: PDF printing and the
//! own-window capture used by the page motion. Both run on the UI thread via
//! `with_webview` and report back through a one-shot channel.
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::WebviewWindow;
use tokio::sync::oneshot;
use webview2_com::Microsoft::Web::WebView2::Win32::{
  ICoreWebView2Environment6, ICoreWebView2_7, COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
};
use webview2_com::{CapturePreviewCompletedHandler, PrintToPdfCompletedHandler};
use windows::core::{Interface, HSTRING, PCWSTR};
use windows::Win32::System::Com::{IStream, STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET};
use windows::Win32::UI::Shell::SHCreateMemStream;

type Reply<T> = Arc<Mutex<Option<oneshot::Sender<Result<T, String>>>>>;
fn reply<T>(slot: &Reply<T>, value: Result<T, String>) {
  if let Some(sender) = slot.lock().ok().and_then(|mut slot| slot.take()) {
    let _ = sender.send(value);
  }
}

pub async fn print_to_pdf(window: &WebviewWindow, path: &Path) -> Result<(), String> {
  let (sender, receiver) = oneshot::channel();
  let slot: Reply<()> = Arc::new(Mutex::new(Some(sender)));
  let target = HSTRING::from(path.as_os_str());
  let inner = slot.clone();
  window
    .with_webview(move |webview| {
      let started = (|| -> windows::core::Result<()> {
        unsafe {
          let core: ICoreWebView2_7 = webview.controller().CoreWebView2()?.cast()?;
          let environment: ICoreWebView2Environment6 = webview.environment().cast()?;
          let settings = environment.CreatePrintSettings()?;
          // A4, backgrounds on; WebView2 has no header/footer templates, so keep only page numbers.
          settings.SetPageWidth(8.27)?;
          settings.SetPageHeight(11.69)?;
          settings.SetShouldPrintBackgrounds(true.into())?;
          settings.SetShouldPrintHeaderAndFooter(true.into())?;
          let empty = HSTRING::new();
          settings.SetHeaderTitle(PCWSTR(empty.as_ptr()))?;
          settings.SetFooterUri(PCWSTR(empty.as_ptr()))?;
          let done = inner.clone();
          let handler = PrintToPdfCompletedHandler::create(Box::new(move |result, success| {
            reply(&done, match result {
              Ok(()) if success => Ok(()),
              Ok(()) => Err("PDF 生成失败。".into()),
              Err(error) => Err(error.message()),
            });
            Ok(())
          }));
          core.PrintToPdf(PCWSTR(target.as_ptr()), &settings, &handler)
        }
      })();
      if let Err(error) = started {
        reply(&inner, Err(error.message()));
      }
    })
    .map_err(|error| error.to_string())?;
  receiver.await.map_err(|_| "PDF 生成被中断。".to_string())?
}

/// PNG of this window's own rendered content only (no window id, region or desktop input).
pub async fn capture_png(window: &WebviewWindow) -> Result<Vec<u8>, String> {
  let (sender, receiver) = oneshot::channel();
  let slot: Reply<Vec<u8>> = Arc::new(Mutex::new(Some(sender)));
  let inner = slot.clone();
  window
    .with_webview(move |webview| {
      let started = (|| -> windows::core::Result<()> {
        unsafe {
          let core = webview.controller().CoreWebView2()?;
          let stream: IStream = SHCreateMemStream(None).ok_or_else(|| windows::core::Error::from_hresult(windows::Win32::Foundation::E_OUTOFMEMORY))?;
          let done = inner.clone();
          let output = stream.clone();
          let handler = CapturePreviewCompletedHandler::create(Box::new(move |result| {
            reply(&done, result.map_err(|error| error.message()).and_then(|()| read_stream(&output).map_err(|error| error.message())));
            Ok(())
          }));
          core.CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, &stream, &handler)
        }
      })();
      if let Err(error) = started {
        reply(&inner, Err(error.message()));
      }
    })
    .map_err(|error| error.to_string())?;
  receiver.await.map_err(|_| "Capture interrupted".to_string())?
}

unsafe fn read_stream(stream: &IStream) -> windows::core::Result<Vec<u8>> {
  let mut stat = STATSTG::default();
  stream.Stat(&mut stat, STATFLAG_NONAME)?;
  let size = stat.cbSize as usize;
  if size == 0 || size > 8 * 1024 * 1024 {
    return Err(windows::core::Error::from_hresult(windows::Win32::Foundation::E_FAIL));
  }
  stream.Seek(0, STREAM_SEEK_SET, None)?;
  let mut bytes = vec![0u8; size];
  let mut read = 0u32;
  stream.Read(bytes.as_mut_ptr().cast(), size as u32, Some(&mut read)).ok()?;
  bytes.truncate(read as usize);
  Ok(bytes)
}
