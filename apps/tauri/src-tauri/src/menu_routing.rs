//! Native menu routing policy, independent of AppKit so it is tested on every
//! build host. The macOS shell builds the Format menu from `FORMAT_MENU`.

// Mirrors the editor menu descriptor, checked by the Node menu test.
pub(super) const FORMAT_MENU: &[&[(&str, &str, &str)]] = &[
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

// Renderer commands that keep their existing behavior while the window is hidden.
const APP_COMMANDS: &[&str] = &[
    "checkUpdates", "new", "open", "import", "save", "saveAs", "exportPdf", "insertImage",
    "insertAttachment", "remove", "find", "replace", "reading", "source", "rendered",
    "zoomIn", "zoomOut", "zoomReset", "sidebar",
];

#[derive(Debug, PartialEq, Eq)]
pub(super) enum MenuRoute { CloseWindow, Emit, Ignore }

fn edits_visible_page(id: &str) -> bool {
    id == "collapse" || FORMAT_MENU.iter().any(|group| group.iter().any(|item| item.0 == id))
}

/// `visible` is `None` when the window state cannot be read.
pub(super) fn route(id: &str, visible: Option<bool>) -> MenuRoute {
    if id == "closeWindow" {
        MenuRoute::CloseWindow
    } else if edits_visible_page(id) {
        // A hidden window must not shelve pages or format text the user cannot see.
        if visible == Some(true) { MenuRoute::Emit } else { MenuRoute::Ignore }
    } else if APP_COMMANDS.contains(&id) {
        MenuRoute::Emit
    } else {
        MenuRoute::Ignore
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn format_ids() -> impl Iterator<Item = &'static str> {
        FORMAT_MENU.iter().flat_map(|group| group.iter().map(|item| item.0))
    }

    #[test]
    fn visible_window_emits_collapse_and_every_format_command() {
        assert_eq!(route("collapse", Some(true)), MenuRoute::Emit);
        assert_eq!(format_ids().count(), 22);
        for id in format_ids() { assert_eq!(route(id, Some(true)), MenuRoute::Emit, "{id}"); }
    }

    #[test]
    fn hidden_or_unknown_window_ignores_collapse_and_format_commands() {
        for visible in [Some(false), None] {
            assert_eq!(route("collapse", visible), MenuRoute::Ignore);
            for id in format_ids() { assert_eq!(route(id, visible), MenuRoute::Ignore, "{id}"); }
        }
    }

    #[test]
    fn close_window_and_existing_commands_ignore_visibility() {
        for visible in [Some(true), Some(false), None] {
            assert_eq!(route("closeWindow", visible), MenuRoute::CloseWindow);
            for &id in APP_COMMANDS { assert_eq!(route(id, visible), MenuRoute::Emit, "{id}"); }
        }
    }

    #[test]
    fn unknown_and_predefined_ids_are_not_forwarded() {
        for id in ["", "quit", "formatUnknown", "Collapse", "nextTab"] {
            assert_eq!(route(id, Some(true)), MenuRoute::Ignore, "{id}");
        }
    }
}
