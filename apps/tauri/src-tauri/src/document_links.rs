use std::path::{Path, PathBuf};
use tauri_plugin_opener::OpenerExt;

pub fn open(app: &tauri::AppHandle, href: &str, document_path: Option<&str>) -> Result<(), String> {
    if href.trim().is_empty() || href.len() > 16384 || href.chars().any(|c| c.is_control()) {
        return Err("链接地址无效。".into());
    }
    let value = href.trim();
    if value.to_ascii_lowercase().starts_with("https://")
        || value.to_ascii_lowercase().starts_with("http://")
    {
        let url = tauri::Url::parse(value).map_err(|_| "网页地址无效。".to_owned())?;
        if url.host_str().is_none() || url.as_str().chars().count() > 2081 {
            return Err("网页地址无效或过长。".into());
        }
        return app
            .opener()
            .open_url(url.as_str(), None::<&str>)
            .map_err(|_| "无法打开网页，请检查默认浏览器设置。".into());
    }
    if value.starts_with('#') {
        return Err("这是文内锚点链接。".into());
    }
    let target = if value.to_ascii_lowercase().starts_with("file:") {
        tauri::Url::parse(value)
            .map_err(|_| "本地文件链接格式无效。".to_owned())?
            .to_file_path()
            .map_err(|_| "本地文件链接格式无效。".to_owned())?
    } else {
        let raw = value.split(['?', '#']).next().unwrap_or("");
        let bytes = raw.as_bytes();
        for (i, c) in bytes.iter().enumerate() {
            if *c == b'%'
                && (i + 2 >= bytes.len()
                    || !bytes[i + 1].is_ascii_hexdigit()
                    || !bytes[i + 2].is_ascii_hexdigit())
            {
                return Err("本地路径编码无效。".into());
            }
        }
        let decoded = percent_encoding::percent_decode_str(raw)
            .decode_utf8()
            .map_err(|_| "本地路径编码无效。".to_owned())?
            .into_owned();
        let normalized = if cfg!(windows)
            && decoded.starts_with('/')
            && decoded.as_bytes().get(2) == Some(&b':')
        {
            decoded[1..].to_owned()
        } else {
            decoded
        };
        PathBuf::from(normalized)
    };
    let raw = target.to_string_lossy();
    if raw.is_empty()
        || raw.chars().any(|c| c.is_control())
        || raw.starts_with("//")
        || raw.starts_with("\\\\")
    {
        return Err("目前只支持本机文件和文件夹链接。".into());
    }
    if cfg!(windows) {
        let bytes = raw.as_bytes();
        let drive = bytes.len() > 2
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && (bytes[2] == b'/' || bytes[2] == b'\\');
        if (!drive && raw.contains(':')) || (drive && raw[2..].contains(':')) {
            return Err("本地路径无效。".into());
        }
        if !drive && (raw.starts_with('/') || raw.starts_with('\\')) {
            return Err("请使用含盘符的完整路径或相对路径。".into());
        }
    } else if raw.contains(':') {
        return Err("目前只支持网页、本地文件和文件夹链接。".into());
    }
    let target = if target.is_absolute() {
        target
    } else {
        let parent = document_path
            .and_then(|p| Path::new(p).parent())
            .ok_or_else(|| "相对链接需要当前笔记的位置，请先保存为 Markdown 文件。".to_owned())?;
        parent.join(target)
    };
    let path =
        std::fs::canonicalize(target).map_err(|_| "链接目标不存在或无法访问。".to_owned())?;
    if path.is_dir() {
        app.opener()
            .open_path(path.to_string_lossy().into_owned(), None::<&str>)
            .map_err(|_| "无法打开文件夹。".into())
    } else if path.is_file() {
        app.opener()
            .reveal_item_in_dir(path)
            .map_err(|_| "无法在资源管理器定位文件。".into())
    } else {
        Err("链接目标不是普通文件或文件夹。".into())
    }
}
