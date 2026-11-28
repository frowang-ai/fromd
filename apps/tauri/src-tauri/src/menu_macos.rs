use tauri::{menu::{Menu, MenuItem, PredefinedMenuItem, Submenu}, Emitter, Manager};

// Mirrors the editor menu descriptor, checked by the Node menu test.
const FORMAT_MENU: &[&[(&str, &str, &str)]] = &[
    &[
        ("formatHeading0", "段落", "Cmd+0"),
        ("formatHeading1", "标题 1", "Cmd+1"),
        ("formatHeading2", "标题 2", "Cmd+2"),
        ("formatHeading3", "标题 3", "Cmd+3"),
        ("formatHeading4", "标题 4", "Cmd+4"),
        ("formatHeading5", "标题 5", "Cmd+5"),
        ("formatHeading6", "标题 6", "Cmd+6"),
        ("formatRaiseHeading", "提升标题级别", "Cmd+Equal"),
        ("formatLowerHeading", "降低标题级别", "Cmd+Minus"),
    ],
    &[
        ("formatBold", "加粗", "Cmd+B"),
        ("formatItalic", "斜体", "Cmd+I"),
        ("formatUnderline", "下划线", "Cmd+U"),
        ("formatStrike", "删除线", "Ctrl+Shift+Backquote"),
        ("formatInlineCode", "行内代码", "Ctrl+Backquote"),
        ("formatLink", "链接", "Cmd+K"),
        ("formatClear", "清除格式", "Cmd+Backslash"),
    ],
    &[
        ("formatQuote", "引用", "Cmd+Alt+Q"),
        ("formatOrderedList", "有序列表", "Cmd+Alt+O"),
        ("formatBulletList", "无序列表", "Cmd+Alt+U"),
        ("formatCodeBlock", "代码块", "Cmd+Alt+C"),
        ("formatMathBlock", "公式块", "Cmd+Alt+B"),
        ("formatTable", "表格", "Cmd+Alt+T"),
    ],
];

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
        &command("insertImage", "插入图片…", Some("Ctrl+Cmd+I"))?,
        &command("insertAttachment", "插入附件…", None)?,
        &command("collapse", "收起当前页面", Some("Cmd+W"))?,
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
    let format = Submenu::new(app, "格式", true)?;
    for (index, group) in FORMAT_MENU.iter().enumerate() {
        if index > 0 {
            format.append(&PredefinedMenuItem::separator(app)?)?;
        }
        for &(id, label, accelerator) in *group {
            format.append(&command(id, label, Some(accelerator))?)?;
        }
    }
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
        &command("closeWindow", "关闭窗口", Some("Cmd+Shift+W"))?,
    ])?;
    app.set_menu(Menu::with_items(app, &[&application, &file, &edit, &format, &view, &windows])?)?;
    app.on_menu_event(|app, event| {
        let id = event.id().as_ref();
        let Some(window) = app.get_webview_window("main") else { return };
        if id == "closeWindow" {
            // Follow the same CloseRequested handshake as the system close button.
            let _ = window.close();
        } else if FORMAT_MENU.iter().any(|group| group.iter().any(|item| item.0 == id))
            || matches!(id, "checkUpdates" | "new" | "open" | "import" | "save" | "saveAs" | "exportPdf" | "insertImage" | "insertAttachment" | "collapse" | "remove" | "find" | "replace" | "reading" | "source" | "rendered" | "zoomIn" | "zoomOut" | "zoomReset" | "sidebar") {
            let _ = window.emit("frowd:menu-command", id);
        }
    });
    Ok(())
}
