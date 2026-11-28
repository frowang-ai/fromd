use tauri::{menu::{Menu, MenuItem, PredefinedMenuItem, Submenu}, Emitter, Manager};

pub fn install(app: &tauri::App) -> tauri::Result<()> {
    let command = |id: &str, text: &str, accelerator: Option<&str>| MenuItem::with_id(app, id, text, true, accelerator);
    let application = Submenu::with_items(app, "fromd", true, &[
        &PredefinedMenuItem::about(app, Some("关于 fromd"), None)?,
        &command("checkUpdates", "检查更新…", None)?,
        &PredefinedMenuItem::separator(app)?,
        &command("reading", "阅读设置…", Some("Cmd+,"))?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::hide(app, Some("隐藏 fromd"))?,
        &PredefinedMenuItem::hide_others(app, Some("隐藏其他"))?,
        &PredefinedMenuItem::show_all(app, Some("显示全部"))?,
        &PredefinedMenuItem::separator(app)?,
        // Native Quit reaches RunEvent::ExitRequested, including Cmd+Q and Dock.
        &PredefinedMenuItem::quit(app, Some("退出 fromd"))?,
    ])?;
    let file = Submenu::with_items(app, "文件", true, &[
        &command("new", "新建页面", Some("Cmd+N"))?,
        &command("open", "打开…", Some("Cmd+O"))?,
        &command("import", "导入 TXT / HTML…", None)?,
        &command("save", "保存", Some("Cmd+S"))?,
        &command("saveAs", "另存为…", Some("Cmd+Shift+S"))?,
        &command("exportPdf", "导出 PDF…", None)?,
        &command("insertImage", "插入图片…", None)?,
        &command("insertAttachment", "插入附件…", None)?,
        &command("remove", "移除当前页面…", None)?,
    ])?;
    let edit = Submenu::with_items(app, "编辑", true, &[
        &PredefinedMenuItem::undo(app, Some("撤销"))?,
        &PredefinedMenuItem::redo(app, Some("重做"))?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::cut(app, Some("剪切"))?,
        &PredefinedMenuItem::copy(app, Some("复制"))?,
        &PredefinedMenuItem::paste(app, Some("粘贴"))?,
        &PredefinedMenuItem::select_all(app, Some("全选"))?,
        &PredefinedMenuItem::separator(app)?,
        &command("find", "查找…", Some("Cmd+F"))?,
        &command("replace", "查找替换…", Some("Cmd+Alt+F"))?,
    ])?;
    let view = Submenu::with_items(app, "视图", true, &[
        &command("rendered", "正文", None)?,
        &command("source", "切换源码", Some("Cmd+/"))?,
        &command("zoomIn", "放大", Some("Cmd+Shift+Equal"))?,
        &command("zoomOut", "缩小", Some("Cmd+Shift+-"))?,
        &command("zoomReset", "实际大小", Some("Cmd+Shift+0"))?,
        &command("sidebar", "显示/隐藏工作栏", None)?,
    ])?;
    let windows = Submenu::with_items(app, "窗口", true, &[
        &PredefinedMenuItem::minimize(app, Some("最小化"))?,
        &PredefinedMenuItem::maximize(app, Some("缩放"))?,
        &PredefinedMenuItem::close_window(app, Some("关闭窗口"))?,
    ])?;
    app.set_menu(Menu::with_items(app, &[&application, &file, &edit, &view, &windows])?)?;
    app.on_menu_event(|app, event| {
        let id = event.id().as_ref();
        if matches!(id, "checkUpdates" | "new" | "open" | "import" | "save" | "saveAs" | "exportPdf" | "insertImage" | "insertAttachment" | "remove" | "find" | "replace" | "reading" | "source" | "rendered" | "zoomIn" | "zoomOut" | "zoomReset" | "sidebar") {
            if let Some(window) = app.get_webview_window("main") { let _ = window.emit("frowd:menu-command", id); }
        }
    });
    Ok(())
}
