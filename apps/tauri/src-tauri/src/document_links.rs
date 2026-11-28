use std::path::{Path, PathBuf};
use tauri_plugin_opener::OpenerExt;

#[derive(Clone, Copy)]
enum Platform { Windows, Posix }
#[derive(Debug, PartialEq)]
enum Link { Web(String), Local { path: String, absolute: bool } }

// Pure lexical classification: both platforms are testable on every host. Filesystem
// existence and native opening are deliberately outside this boundary.
fn parse_link(href: &str, platform: Platform) -> Result<Link, String> {
    if href.trim().is_empty() || href.len() > 16384 || href.chars().any(|c| c.is_control()) {
        return Err("链接地址无效。".into());
    }
    let value = href.trim();
    let lower = value.to_ascii_lowercase();
    if lower.starts_with("https://") || lower.starts_with("http://") {
        let url = tauri::Url::parse(value).map_err(|_| "网页地址无效。")?;
        if url.host_str().is_none() || url.as_str().chars().count() > 2081 {
            return Err("网页地址无效或过长。".into());
        }
        return Ok(Link::Web(url.to_string()));
    }
    if value.starts_with('#') { return Err("这是文内锚点链接。".into()); }
    let raw = if lower.starts_with("file:") {
        let url = tauri::Url::parse(value).map_err(|_| "本地文件链接格式无效。")?;
        if url.host_str().is_some_and(|host| !host.is_empty() && host != "localhost") {
            return Err("目前只支持本机文件和文件夹链接。".into());
        }
        url.path().to_owned()
    } else { value.split(['?', '#']).next().unwrap_or("").to_owned() };
    let bytes = raw.as_bytes();
    for (i, c) in bytes.iter().enumerate() {
        if *c == b'%' && (i + 2 >= bytes.len() || !bytes[i + 1].is_ascii_hexdigit() || !bytes[i + 2].is_ascii_hexdigit()) {
            return Err("本地路径编码无效。".into());
        }
    }
    let mut path = percent_encoding::percent_decode_str(&raw).decode_utf8()
        .map_err(|_| "本地路径编码无效。")?.into_owned();
    if matches!(platform, Platform::Windows) && path.starts_with('/') && path.as_bytes().get(2) == Some(&b':') {
        path.remove(0);
    }
    if path.is_empty() || path.chars().any(|c| c.is_control()) || path.starts_with("//") || path.starts_with("\\\\") {
        return Err("目前只支持本机文件和文件夹链接。".into());
    }
    let absolute = match platform {
        Platform::Windows => {
            let bytes = path.as_bytes();
            let drive = bytes.len() > 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && matches!(bytes[2], b'/' | b'\\');
            if (!drive && path.contains(':')) || (drive && path[2..].contains(':')) { return Err("本地路径无效。".into()); }
            if !drive && (path.starts_with('/') || path.starts_with('\\')) { return Err("请使用含盘符的完整路径或相对路径。".into()); }
            drive
        }
        Platform::Posix => {
            // A colon inside an absolute POSIX filename is not a URI scheme.
            // Relative paths such as ./a:b and dir/a:b are paths too.
            if !path.starts_with('/') && path.split('/').next().unwrap_or("").contains(':') {
                return Err("目前只支持网页、本地文件和文件夹链接。".into());
            }
            path.starts_with('/')
        }
    };
    Ok(Link::Local { path, absolute })
}

pub fn open(app: &tauri::AppHandle, href: &str, document_path: Option<&str>) -> Result<(), String> {
    let platform = if cfg!(windows) { Platform::Windows } else { Platform::Posix };
    let (path, absolute) = match parse_link(href, platform)? {
        Link::Web(url) => return app.opener().open_url(url, None::<&str>).map_err(|_| "无法打开网页，请检查默认浏览器设置。".into()),
        Link::Local { path, absolute } => (path, absolute),
    };
    let target = if absolute { PathBuf::from(path) } else {
        let document = document_path.map(Path::new)
            .ok_or("相对链接需要当前笔记的位置，请先保存为 Markdown 文件。")?;
        frowd_documents::check_bound_path(document).map_err(|e| e.to_string())?;
        document.parent().ok_or("文稿目录无效。")?.join(path)
    };
    let path = std::fs::canonicalize(target).map_err(|_| "链接目标不存在或无法访问。")?;
    if path.is_dir() {
        app.opener().open_path(path.to_string_lossy().into_owned(), None::<&str>).map_err(|_| "无法打开文件夹。".into())
    } else if path.is_file() {
        app.opener().reveal_item_in_dir(path).map_err(|_| "无法在文件管理器定位文件。".into())
    } else { Err("链接目标不是普通文件或文件夹。".into()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn posix_colons_are_filenames_not_schemes() {
        for href in ["/Users/u/a:b.txt", "file:///Users/u/a%3Ab.txt"] {
            assert_eq!(parse_link(href, Platform::Posix).unwrap(), Link::Local { path: "/Users/u/a:b.txt".into(), absolute: true });
        }
        for href in ["./a:b.txt", "dir/a:b.txt"] { assert!(parse_link(href, Platform::Posix).is_ok()); }
        for href in ["mailto:a@b", "javascript:alert(1)", "unknown:thing", "C:/file"] { assert!(parse_link(href, Platform::Posix).is_err()); }
    }
    #[test]
    fn windows_drive_and_unc_rules() {
        for href in ["C:/notes/a.txt", "C:\\notes\\a.txt", "/C:/notes/a.txt", "file:///C:/notes/a.txt"] { assert!(matches!(parse_link(href, Platform::Windows), Ok(Link::Local { absolute: true, .. }))); }
        for href in ["C:relative", "C:/file:stream", "//server/share", "\\\\server\\share", "file://server/share", "/root/file", "\\root\\file", "mailto:a@b"] { assert!(parse_link(href, Platform::Windows).is_err(), "{href}"); }
    }
    #[test]
    fn common_link_validation() {
        for platform in [Platform::Windows, Platform::Posix] {
            assert!(matches!(parse_link("https://example.com", platform), Ok(Link::Web(_))));
            assert!(matches!(parse_link("notes/a%20b.md#section", platform), Ok(Link::Local { absolute: false, .. })));
            for href in ["", "#anchor", "x%0a", "x%ZZ", "//server/a", "file://server/a"] { assert!(parse_link(href, platform).is_err(), "{href}"); }
        }
    }
}
