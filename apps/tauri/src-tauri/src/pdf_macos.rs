//! AppKit's paginated print operation (not WKWebView's one-rectangle createPDF).
//! All Objective-C objects live on the main thread. Tokio only waits for replies.
use super::*;
use block2::RcBlock;
use objc2::{define_class, msg_send, sel, DefinedClass, MainThreadOnly, MainThreadMarker, AnyThread, Message, rc::Retained, runtime::{AnyObject, ProtocolObject}};
use objc2_foundation::{NSObject, NSObjectProtocol, NSString, NSError, NSSize, NSURL};
use objc2_app_kit::{NSPrintInfo, NSPrintOperation, NSPrintSaveJob, NSPrintJobSavingURL, NSPrintingPaginationMode, NSPaperOrientation, NSWindow};
use objc2_web_kit::WKWebView;
use std::{cell::RefCell, ffi::c_void};
use tokio::sync::oneshot;

type Reply = Arc<Mutex<Option<oneshot::Sender<Result<(), String>>>>>;
struct DelegateState { label: String, reply: Reply }
define_class!(
    #[unsafe(super = NSObject)]
    #[thread_kind = MainThreadOnly]
    #[ivars = DelegateState]
    struct PrintDelegate;
    unsafe impl NSObjectProtocol for PrintDelegate {}
    impl PrintDelegate {
        // NSPrintOperation's documented delegate ABI: operation, BOOL, context.
        #[unsafe(method(printOperationDidRun:success:contextInfo:))]
        fn completed(&self, operation: &NSPrintOperation, success: bool, _context: *mut c_void) {
            // Retain both callback arguments until this invocation returns, even
            // after removing the job's owned objects from the main-thread registry.
            let _keep_alive = self.retain();
            let _keep_operation = operation.retain();
            let state = self.ivars();
            if let Some(sender) = state.reply.lock().unwrap().take() {
                let _ = sender.send(if success { Ok(()) } else { Err("macOS 未能完成 PDF 打印。".into()) });
            }
            PRINT_JOBS.with(|jobs| { jobs.borrow_mut().remove(&state.label); });
        }
    }
);
impl PrintDelegate {
    fn new(mtm: MainThreadMarker, state: DelegateState) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(state);
        unsafe { msg_send![super(this), init] }
    }
}
// AppKit may finish after a timeout or an IPC future is dropped. Keep the delegate,
// print operation, window, view AND isolated temp directory until its callback.
// It can only write the unique temp PDF; atomic replacement remains in pdf.rs.
struct PrintJob {
    _delegate: Retained<PrintDelegate>, _operation: Retained<NSPrintOperation>,
    _view: Retained<WKWebView>, _window: Retained<NSWindow>, _temporary: Arc<tempfile::TempDir>,
}
thread_local! { static PRINT_JOBS: RefCell<HashMap<String, PrintJob>> = RefCell::new(HashMap::new()); }
struct CancelOnDrop(Arc<AtomicBool>);
impl Drop for CancelOnDrop { fn drop(&mut self) { self.0.store(true, Ordering::SeqCst); } }

async fn script(worker: &WebviewWindow) -> Result<String, String> {
    let (sender, receiver) = oneshot::channel();
    let reply = Arc::new(Mutex::new(Some(sender)));
    worker.with_webview(move |platform| unsafe {
        let _mtm = MainThreadMarker::new().expect("with_webview must run on main thread");
        let view = &*platform.inner().cast::<WKWebView>();
        let callback = RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
            let result = if !error.is_null() { Err("PDF 就绪探测失败。".to_owned()) }
                else { value.as_ref().and_then(|v| v.downcast_ref::<NSString>()).map(|v| v.to_string()).ok_or_else(|| "PDF 就绪探测返回无效值。".to_owned()) };
            if let Some(sender) = reply.lock().unwrap().take() { let _ = sender.send(result); }
        });
        view.evaluateJavaScript_completionHandler(&NSString::from_str(READINESS), Some(&callback));
    }).map_err(|e| e.to_string())?;
    tokio::time::timeout(Duration::from_secs(5), receiver).await
        .map_err(|_| "PDF 渲染响应超时。")?.map_err(|_| "PDF 渲染窗口已关闭。")?
}

pub(super) async fn macos_print(app: &tauri::AppHandle, label: &str, token: &str, destination: &Path, temporary: Arc<tempfile::TempDir>) -> Result<(), String> {
    let url = protocol_urls::pdf_worker_url(token);
    let navigation_url = url.clone();
    let worker = tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::External("about:blank".parse().unwrap()))
        .title("frowd PDF").visible(false).focused(false).skip_taskbar(true)
        .inner_size(794.0, 1123.0).disable_drag_drop_handler()
        .on_navigation(move |target| target.as_str() == "about:blank" || target.as_str() == navigation_url)
        .build().map_err(|e| e.to_string())?;
    // The CSP disables document scripts, external images/fonts, frames and fetch.
    // There are no worker capabilities; native evaluateJavaScript remains usable.
    let (sender, receiver) = oneshot::channel();
    worker.with_webview(move |platform| unsafe {
        let view = &*platform.inner().cast::<WKWebView>();
        #[allow(deprecated)]
        view.configuration().preferences().setJavaScriptEnabled(false);
        let _ = sender.send(());
    }).map_err(|e| e.to_string())?;
    tokio::time::timeout(Duration::from_secs(5), receiver).await.map_err(|_| "PDF 窗口启动超时。")?.map_err(|_| "PDF 窗口已关闭。")?;
    worker.navigate(url.parse().map_err(|_| "PDF 地址无效。")?).map_err(|e| e.to_string())?;
    tokio::time::timeout(Duration::from_secs(30), async {
        let mut ready = false;
        loop {
            match script(&worker).await?.as_str() {
                "ready" if ready => return Ok::<_, String>(()),
                "ready" => ready = true,
                "failed" => return Err("PDF 图片或字体加载失败，未保存。".into()),
                _ => ready = false,
            }
            tokio::time::sleep(Duration::from_millis(80)).await;
        }
    }).await.map_err(|_| "PDF 字体或图片准备超时，未保存。")??;

    let path = destination.to_owned();
    let label = label.to_owned();
    let (sender, receiver) = oneshot::channel();
    let reply = Arc::new(Mutex::new(Some(sender)));
    let cancelled = Arc::new(AtomicBool::new(false));
    let _cancel = CancelOnDrop(cancelled.clone());
    worker.with_webview(move |platform| unsafe {
        if cancelled.load(Ordering::SeqCst) { return; }
        // A timed-out AppKit operation must finish before another can start.
        if PRINT_JOBS.with(|jobs| !jobs.borrow().is_empty()) {
            if let Some(sender) = reply.lock().unwrap().take() { let _ = sender.send(Err("上一项 macOS 打印仍在清理，请稍后重试。".into())); }
            return;
        }
        let mtm = MainThreadMarker::new().expect("with_webview must run on main thread");
        let view = Retained::retain(platform.inner().cast::<WKWebView>()).expect("live WKWebView");
        let window = Retained::retain(platform.ns_window().cast::<NSWindow>()).expect("live NSWindow");
        // A fresh print info avoids inheriting a user's last printer/paper settings.
        let info = NSPrintInfo::init(NSPrintInfo::alloc());
        info.setPaperSize(NSSize::new(595.28, 841.89));
        info.setOrientation(NSPaperOrientation::Portrait);
        let margin = 18.0 * 72.0 / 25.4;
        info.setTopMargin(margin); info.setBottomMargin(margin);
        info.setLeftMargin(margin); info.setRightMargin(margin);
        info.setHorizontallyCentered(false); info.setVerticallyCentered(false);
        info.setHorizontalPagination(NSPrintingPaginationMode::Fit);
        info.setVerticalPagination(NSPrintingPaginationMode::Automatic);
        info.setJobDisposition(NSPrintSaveJob);
        let Some(destination_url) = NSURL::from_file_path(&path) else {
            if let Some(sender) = reply.lock().unwrap().take() { let _ = sender.send(Err("PDF 保存位置无效。".into())); }
            return;
        };
        info.dictionary().setObject_forKey(&destination_url, ProtocolObject::from_ref(NSPrintJobSavingURL));
        let operation = view.printOperationWithPrintInfo(&info);
        operation.setShowsPrintPanel(false);
        operation.setShowsProgressPanel(false);
        // Match Wry 0.57: AppKit must not block the main thread waiting for WebKit.
        operation.setCanSpawnSeparateThread(true);
        let delegate = PrintDelegate::new(mtm, DelegateState { label: label.clone(), reply });
        PRINT_JOBS.with(|jobs| { jobs.borrow_mut().insert(label, PrintJob {
            _delegate: delegate.clone(), _operation: operation.clone(), _view: view, _window: window.clone(), _temporary: temporary,
        }); });
        // Asynchronous sheet API returns to AppKit's run loop. Never call blocking
        // runOperation from the main thread while WebKit needs it to render pages.
        operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
            &window, Some(&delegate), Some(sel!(printOperationDidRun:success:contextInfo:)), std::ptr::null_mut());
    }).map_err(|e| e.to_string())?;
    tokio::time::timeout(Duration::from_secs(60), receiver).await
        .map_err(|_| "PDF 打印超时，原文件未改动。")?.map_err(|_| "PDF 打印窗口意外关闭。")?
}
