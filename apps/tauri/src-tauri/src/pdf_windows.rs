use super::*;
use tokio::sync::oneshot;
use webview2_com::{ExecuteScriptCompletedHandler, PrintToPdfCompletedHandler, WebResourceRequestedEventHandler, NewWindowRequestedEventHandler};
use webview2_com::Microsoft::Web::WebView2::Win32::*;
use windows::core::{Interface, HSTRING, PWSTR};

type Reply<T> = Arc<Mutex<Option<oneshot::Sender<Result<T, String>>>>>;
fn send<T>(reply: &Reply<T>, result: Result<T, String>) { if let Some(sender) = reply.lock().unwrap().take() { let _ = sender.send(result); } }

// COM objects and callbacks stay on Tauri's STA thread. Waiting happens only on
// the async runtime, so the UI event loop remains available to deliver callbacks.
async fn script(worker: &WebviewWindow, javascript: String) -> Result<String, String> {
    let (sender, receiver) = oneshot::channel();
    let reply = Arc::new(Mutex::new(Some(sender)));
    worker.with_webview(move |platform| unsafe {
        let callback_reply = reply.clone();
        let result = (|| -> windows::core::Result<()> {
            let core = platform.controller().CoreWebView2()?;
            let callback = ExecuteScriptCompletedHandler::create(Box::new(move |status, value| {
                send(&callback_reply, status.map(|_| value).map_err(|e| e.to_string()));
                Ok(())
            }));
            core.ExecuteScript(&HSTRING::from(javascript), &callback)
        })();
        if let Err(error) = result { send(&reply, Err(error.to_string())); }
    }).map_err(|e| e.to_string())?;
    tokio::time::timeout(Duration::from_secs(5), receiver).await
        .map_err(|_| "PDF 渲染响应超时。")?.map_err(|_| "PDF 渲染窗口已关闭。")?
}

pub(super) async fn windows_print(app: &tauri::AppHandle, label: &str, token: &str, destination: &Path, _temporary: Arc<tempfile::TempDir>) -> Result<(), String> {
    let url = protocol_urls::pdf_worker_url(token);
    let navigation_url = url.clone();
    let worker = tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::External("about:blank".parse().unwrap()))
        .title("frowd PDF").visible(false).focused(false).skip_taskbar(true)
        .inner_size(794.0, 1123.0).drag_and_drop(false)
        .on_navigation(move |target| target.as_str() == "about:blank" || target.as_str() == navigation_url)
        .build().map_err(|e| e.to_string())?;
    let (sender, receiver) = oneshot::channel();
    let reply = Arc::new(Mutex::new(Some(sender)));
    worker.with_webview(move |platform| unsafe {
        let result = (|| -> windows::core::Result<()> {
            let core = platform.controller().CoreWebView2()?;
            let environment = platform.environment();
            let allowed = url.clone();
            // Defense in depth beside the document CSP. Even malformed markup
            // or an SVG reference cannot turn the worker into a local/HTTP client.
            let resources = WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
                if let Some(args) = args {
                    let request = args.Request()?;
                    let mut uri = PWSTR::null();
                    request.Uri(&mut uri)?;
                    let uri_string = uri.to_string()?;
                    windows::Win32::System::Com::CoTaskMemFree(Some(uri.0.cast()));
                    if uri_string != allowed && !uri_string.starts_with("data:") {
                        let response = environment.CreateWebResourceResponse(None, 403, &HSTRING::from("Forbidden"), &HSTRING::from("Content-Type: text/plain"))?;
                        args.SetResponse(&response)?;
                    }
                }
                Ok(())
            }));
            let mut event_token = 0;
            core.AddWebResourceRequestedFilter(&HSTRING::from("*"), COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL)?;
            core.add_WebResourceRequested(&resources, &mut event_token)?;
            let popup = NewWindowRequestedEventHandler::create(Box::new(|_, args| {
                if let Some(args) = args { args.SetHandled(true)?; }
                Ok(())
            }));
            core.add_NewWindowRequested(&popup, &mut event_token)?;
            let settings = core.Settings()?;
            settings.SetIsScriptEnabled(false)?;
            settings.SetAreHostObjectsAllowed(false)?;
            settings.SetIsWebMessageEnabled(false)?;
            settings.SetAreDefaultContextMenusEnabled(false)?;
            settings.SetAreDevToolsEnabled(false)?;
            core.Navigate(&HSTRING::from(url))
        })().map_err(|e| e.to_string());
        send(&reply, result);
    }).map_err(|e| e.to_string())?;
    tokio::time::timeout(Duration::from_secs(10), receiver).await.map_err(|_| "PDF 窗口启动超时。")?.map_err(|_| "PDF 窗口已关闭。")??;

    // With page scripts disabled, an injected script executes but page timers /
    // promise continuations need not advance. Poll synchronously from the host;
    // forcing layout starts the fonts actually used by this complete document.
    tokio::time::timeout(Duration::from_secs(30), async {
        let mut ready = false;
        loop {
            match script(&worker, READINESS.into()).await?.as_str() {
                "\"ready\"" if ready => return Ok::<_, String>(()),
                "\"ready\"" => ready = true,
                "\"failed\"" => return Err("PDF 图片或字体加载失败，未保存。".into()),
                _ => ready = false,
            }
            tokio::time::sleep(Duration::from_millis(80)).await;
        }
    }).await.map_err(|_| "PDF 字体或图片准备超时，未保存。")??;

    let path = destination.to_string_lossy().into_owned();
    let (sender, receiver) = oneshot::channel();
    let reply = Arc::new(Mutex::new(Some(sender)));
    worker.with_webview(move |platform| unsafe {
        let callback_reply = reply.clone();
        let result = (|| -> windows::core::Result<()> {
            let core: ICoreWebView2_7 = platform.controller().CoreWebView2()?.cast()?;
            let environment: ICoreWebView2Environment6 = platform.environment().cast()?;
            let settings = environment.CreatePrintSettings()?;
            settings.SetPageWidth(210.0 / 25.4)?;
            settings.SetPageHeight(297.0 / 25.4)?;
            settings.SetMarginTop(18.0 / 25.4)?;
            settings.SetMarginBottom(18.0 / 25.4)?;
            settings.SetMarginLeft(18.0 / 25.4)?;
            settings.SetMarginRight(18.0 / 25.4)?;
            settings.SetShouldPrintBackgrounds(true)?;
            settings.SetShouldPrintHeaderAndFooter(false)?;
            let callback = PrintToPdfCompletedHandler::create(Box::new(move |status, successful| {
                send(&callback_reply, status.map_err(|e| e.to_string()).and_then(|_| {
                    if successful { Ok(()) } else { Err("WebView2 未能完成 PDF 打印。".into()) }
                }));
                Ok(())
            }));
            core.PrintToPdf(&HSTRING::from(path), &settings, &callback)
        })();
        if let Err(error) = result { send(&reply, Err(format!("WebView2 PDF 功能不可用：{error}"))); }
    }).map_err(|e| e.to_string())?;
    tokio::time::timeout(Duration::from_secs(60), receiver).await.map_err(|_| "PDF 打印超时，原文件未改动。")?.map_err(|_| "PDF 打印窗口意外关闭。")?
}
