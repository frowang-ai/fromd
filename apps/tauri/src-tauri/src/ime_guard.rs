//! Windows confirms IME text before delivering DOM mouse events. An app-owned,
//! non-activating child consumes command-area presses before they reach WebView2.
use serde::Deserialize;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuardRect {
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
}

#[tauri::command]
pub async fn set_ime_guard(
    window: tauri::WebviewWindow,
    sequence: u64,
    viewport_width: f64,
    regions: Vec<GuardRect>,
) -> Result<(), String> {
    if regions.len() > 2048 || !viewport_width.is_finite() || viewport_width <= 0.0 {
        return Err("输入法保护区域无效，请先完成候选输入。".into());
    }
    #[cfg(windows)]
    {
        let parent = window.hwnd().map_err(|e| e.to_string())?.0 as usize;
        let owner = window.clone();
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        window.run_on_main_thread(move || {
            let result = native::apply(owner, parent, sequence, viewport_width, regions);
            let _ = sender.send(result);
        }).map_err(|e| e.to_string())?;
        tauri::async_runtime::spawn_blocking(move || {
            receiver.recv().unwrap_or_else(|_| Err("输入法保护窗口已关闭。".into()))
        }).await.map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    { let _ = (window, sequence, regions); Ok(()) }
}

pub fn focus_changed(focused: bool) {
    #[cfg(windows)] native::focus_changed(focused);
    #[cfg(not(windows))] let _ = focused;
}

fn pixel_rect(rect: GuardRect, scale: f64, width: i32, height: i32) -> Option<[i32; 4]> {
    if ![rect.left, rect.top, rect.right, rect.bottom].iter().all(|x| x.is_finite()) { return None; }
    let left = (rect.left * scale).floor().clamp(0.0, width as f64) as i32;
    let top = (rect.top * scale).floor().clamp(0.0, height as f64) as i32;
    let right = (rect.right * scale).ceil().clamp(0.0, width as f64) as i32;
    let bottom = (rect.bottom * scale).ceil().clamp(0.0, height as f64) as i32;
    (right > left && bottom > top).then_some([left, top, right, bottom])
}

#[cfg(windows)]
mod native {
    use super::{pixel_rect, GuardRect};
    use std::{cell::RefCell, sync::OnceLock};
    use tauri::Emitter;
    use windows::{core::w, Win32::{
        Foundation::{COLORREF, HWND, LPARAM, LRESULT, RECT, WPARAM},
        Graphics::Gdi::{CombineRgn, CreateRectRgn, DeleteObject, GetStockObject, SetWindowRgn, HBRUSH, HGDIOBJ, RGN_OR, WHITE_BRUSH},
        System::LibraryLoader::GetModuleHandleW,
        UI::WindowsAndMessaging::*,
    }};

    struct GuardState {
        sequence: u64,
        focused: bool,
        hwnd: Option<HWND>,
        owner: Option<tauri::WebviewWindow>,
    }
    thread_local! { static GUARD: RefCell<GuardState> = const { RefCell::new(GuardState {
        sequence: 0, focused: true, hwnd: None, owner: None,
    }) }; }
    static CLASS: OnceLock<Result<u16, String>> = OnceLock::new();

    // No Rust borrow is held across Win32 calls, which may synchronously reenter.
    fn clear() {
        let old = GUARD.with_borrow_mut(|state| { state.owner = None; state.hwnd.take() });
        if let Some(hwnd) = old { unsafe { let _ = ShowWindow(hwnd, SW_HIDE); let _ = DestroyWindow(hwnd); } }
    }
    pub fn focus_changed(focused: bool) {
        GUARD.with_borrow_mut(|state| state.focused = focused);
        if !focused { clear(); }
    }
    unsafe extern "system" fn guard_proc(hwnd: HWND, message: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
        match message {
            WM_NCCREATE => LRESULT(1),
            WM_CREATE => LRESULT(0),
            WM_MOUSEACTIVATE => LRESULT(MA_NOACTIVATEANDEAT as isize),
            WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN | WM_XBUTTONDOWN => {
                let owner = GUARD.with_borrow(|state| state.owner.clone());
                if let Some(window) = owner { let _ = window.emit("frowd:ime-blocked", ()); }
                LRESULT(0)
            },
            WM_LBUTTONUP | WM_RBUTTONUP | WM_MBUTTONUP | WM_XBUTTONUP |
            WM_LBUTTONDBLCLK | WM_RBUTTONDBLCLK | WM_MBUTTONDBLCLK | WM_XBUTTONDBLCLK |
            WM_MOUSEWHEEL | WM_MOUSEHWHEEL => LRESULT(0),
            _ => unsafe { DefWindowProcW(hwnd, message, wp, lp) },
        }
    }

    pub fn apply(owner: tauri::WebviewWindow, parent: usize, sequence: u64, viewport_width: f64, regions: Vec<GuardRect>) -> Result<(), String> {
        let accepted = GUARD.with_borrow_mut(|state| {
            if sequence <= state.sequence { return false; }
            state.sequence = sequence;
            true
        });
        if !accepted { return Ok(()); }
        if regions.is_empty() || !GUARD.with_borrow(|state| state.focused) { clear(); return Ok(()); }
        let result = unsafe { show(owner, HWND(parent as *mut _), viewport_width, regions) };
        if result.is_err() { clear(); }
        result.map_err(|e| format!("输入法保护未能启用，请先完成候选输入：{e}"))
    }

    unsafe fn show(owner: tauri::WebviewWindow, parent: HWND, viewport_width: f64, regions: Vec<GuardRect>) -> Result<(), String> {
        unsafe {
            let mut client = RECT::default();
            GetClientRect(parent, &mut client).map_err(|e| e.to_string())?;
            if client.right <= 0 || client.bottom <= 0 { clear(); return Ok(()); }
            let scale = client.right as f64 / viewport_width;
            let boxes: Vec<_> = regions.into_iter().filter_map(|r| pixel_rect(r, scale, client.right, client.bottom)).collect();
            if boxes.is_empty() { clear(); return Ok(()); }
            let instance = GetModuleHandleW(None).map_err(|e| e.to_string())?.into();
            CLASS.get_or_init(|| {
                let atom = RegisterClassW(&WNDCLASSW {
                    hInstance: instance, lpszClassName: w!("Frowd.ImeInputGuard"), lpfnWndProc: Some(guard_proc),
                    hbrBackground: HBRUSH(GetStockObject(WHITE_BRUSH).0), ..Default::default()
                });
                if atom == 0 { Err(windows::core::Error::from_thread().to_string()) } else { Ok(atom) }
            }).as_ref().map_err(Clone::clone)?;
            let existing = GUARD.with_borrow(|state| state.hwnd);
            let hwnd = match existing {
                Some(hwnd) => hwnd,
                None => {
                    let hwnd = CreateWindowExW(WS_EX_LAYERED | WS_EX_NOACTIVATE | WS_EX_NOPARENTNOTIFY,
                        w!("Frowd.ImeInputGuard"), w!("请先完成输入法候选"), WS_CHILD,
                        0, 0, client.right, client.bottom, Some(parent), None, Some(instance), None).map_err(|e| e.to_string())?;
                    GUARD.with_borrow_mut(|state| state.hwnd = Some(hwnd));
                    // Alpha zero would pass the press through to WebView2.
                    SetLayeredWindowAttributes(hwnd, COLORREF(0), 1, LWA_ALPHA).map_err(|e| e.to_string())?;
                    hwnd
                }
            };
            let region = CreateRectRgn(0, 0, 0, 0);
            if region.0.is_null() { return Err("无法创建输入法保护区域".into()); }
            for [left, top, right, bottom] in boxes {
                let part = CreateRectRgn(left, top, right, bottom);
                if part.0.is_null() { let _ = DeleteObject(HGDIOBJ(region.0)); return Err("无法创建输入法保护区域".into()); }
                let combined = CombineRgn(Some(region), Some(region), Some(part), RGN_OR);
                let _ = DeleteObject(HGDIOBJ(part.0));
                if combined.0 == 0 { let _ = DeleteObject(HGDIOBJ(region.0)); return Err("无法合并输入法保护区域".into()); }
            }
            // A successful SetWindowRgn transfers ownership to Windows.
            if SetWindowRgn(hwnd, Some(region), true) == 0 {
                let _ = DeleteObject(HGDIOBJ(region.0));
                return Err("无法应用输入法保护区域".into());
            }
            GUARD.with_borrow_mut(|state| state.owner = Some(owner));
            SetWindowPos(hwnd, Some(HWND_TOP), 0, 0, client.right, client.bottom, SWP_NOACTIVATE | SWP_SHOWWINDOW).map_err(|e| e.to_string())?;
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scaled_button_edges_stay_inside_the_client() {
        let rect = GuardRect { left: -2.0, top: 10.25, right: 90.5, bottom: 100.0 };
        assert_eq!(pixel_rect(rect, 1.5, 120, 100), Some([0, 15, 120, 100]));
    }
    #[test]
    fn hidden_or_invalid_regions_do_not_cover_the_editor() {
        for rect in [
            GuardRect { left: 200.0, top: 0.0, right: 220.0, bottom: 20.0 },
            GuardRect { left: 0.0, top: 0.0, right: 0.0, bottom: 0.0 },
            GuardRect { left: f64::NAN, top: 0.0, right: 20.0, bottom: 20.0 },
        ] { assert_eq!(pixel_rect(rect, 1.0, 100, 100), None); }
    }
}
