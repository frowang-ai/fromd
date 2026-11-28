//! Wry 0.57 restores WebView2's http workaround before calling these routes.
//! Both native webviews therefore enter here with scheme://localhost/path.
use tauri::{http::HeaderMap, Url};

fn route(uri: &str, scheme: &str, path: &str) -> Result<Url, String> {
    if uri.len() > 8192 { return Err("协议地址过长。".into()); }
    let url = Url::parse(uri).map_err(|_| "协议地址无效。")?;
    if url.scheme() != scheme || url.host_str() != Some("localhost") || url.port().is_some()
        || !url.username().is_empty() || url.password().is_some() || url.path() != path || url.fragment().is_some() {
        return Err("协议入口无效。".into());
    }
    Ok(url)
}
pub(super) fn image_route(uri: &str) -> Result<(String, String), String> {
    let url = route(uri, "frowd-resource", "/image")?;
    let (mut id, mut reference) = (None, None);
    for (key, value) in url.query_pairs() {
        let slot = match key.as_ref() { "id" => &mut id, "ref" => &mut reference, _ => return Err("未知资源参数。".into()) };
        if slot.is_some() || value.is_empty() { return Err("重复或空资源参数。".into()); }
        *slot = Some(value.into_owned());
    }
    Ok((id.ok_or("缺少页面归属。")?, reference.ok_or("缺少资源引用。")?))
}
pub(super) fn pdf_route(uri: &str, token: &str) -> bool {
    route(uri, "frowd-pdf", &format!("/{token}")).is_ok_and(|url| url.query().is_none())
}
pub(super) fn pdf_worker_url(token: &str) -> String {
    if cfg!(windows) { format!("http://frowd-pdf.localhost/{token}") }
    else { format!("frowd-pdf://localhost/{token}") }
}
fn trusted_url(value: &str, origin: bool, development: bool) -> bool {
    let Ok(url) = Url::parse(value) else { return false; };
    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() { return false; }
    if origin && (url.path() != "/" && !url.path().is_empty() || url.query().is_some()) { return false; }
    matches!((url.scheme(), url.host_str(), url.port()), ("tauri", Some("localhost"), None) | ("http" | "https", Some("tauri.localhost"), None))
        || development && matches!(url.scheme(), "http" | "https") && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
}
/// A page URL from the app's own frontend, e.g. a WebView2 web message Source.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub(super) fn trusted_page(value: &str, development: bool) -> bool { trusted_url(value, false, development) }
pub(super) fn resource_source(label: &str, headers: &HeaderMap, development: bool) -> bool {
    if label != "main" { return false; }
    for (name, origin) in [("origin", true), ("referer", false)] {
        let mut values = headers.get_all(name).iter();
        if let Some(value) = values.next() {
            if values.next().is_some() || !value.to_str().is_ok_and(|s| trusted_url(s, origin, development)) { return false; }
        }
    }
    // WKWebView image subresources can omit both headers. The native webview
    // identity still binds access to main, and resource_image checks doc ownership.
    true
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn routes_and_duplicate_parameters() {
        assert_eq!(image_route("frowd-resource://localhost/image?id=a&ref=x%2Fy").unwrap(), ("a".into(), "x/y".into()));
        for uri in ["http://frowd-resource.localhost/image?id=a&ref=b", "frowd-resource://evil/image?id=a&ref=b", "frowd-resource://localhost/image?id=a&id=b&ref=c", "frowd-resource://localhost/image?id=a&ref=b&ref=c", "frowd-resource://localhost/image?id=a&%69d=b&ref=c", "frowd-resource://localhost/image?id=a", "frowd-resource://localhost/image?id=&ref=b"] { assert!(image_route(uri).is_err(), "{uri}"); }
        assert!(pdf_route("frowd-pdf://localhost/token", "token"));
        for uri in ["frowd-pdf://token/", "frowd-pdf://localhost/other", "frowd-pdf://localhost/token?x=1"] { assert!(!pdf_route(uri, "token")); }
    }
    #[test]
    fn main_webview_and_optional_wkwebview_headers() {
        let mut headers = HeaderMap::new();
        assert!(resource_source("main", &headers, false));
        assert!(!resource_source("pdf-worker", &headers, false));
        headers.insert("referer", "tauri://localhost/index.html".parse().unwrap());
        assert!(resource_source("main", &headers, false));
        for origin in ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"] {
            headers.insert("origin", origin.parse().unwrap());
            assert!(resource_source("main", &headers, false));
        }
        headers.insert("origin", "http://127.0.0.1:14530".parse().unwrap());
        assert!(resource_source("main", &headers, true));
        assert!(!resource_source("main", &headers, false));
        for bad in ["null", "https://evil.test", "tauri://localhost.evil", "tauri://localhost/path"] {
            headers.insert("origin", bad.parse().unwrap());
            assert!(!resource_source("main", &headers, true));
        }
        headers.remove("origin");
        headers.insert("referer", "https://evil.test/".parse().unwrap());
        assert!(!resource_source("main", &headers, true));
    }
    #[test]
    fn web_message_source_must_be_the_app_page() {
        for page in ["http://tauri.localhost/", "https://tauri.localhost/index.html", "tauri://localhost/index.html?x=1"] {
            assert!(trusted_page(page, false), "{page}");
        }
        assert!(trusted_page("http://127.0.0.1:1420/?testHost=0", true));
        for page in ["http://127.0.0.1:1420/", "https://evil.test/", "http://tauri.localhost.evil/", "http://tauri.localhost:8080/", "about:blank", "http://frowd-pdf.localhost/token"] {
            assert!(!trusted_page(page, false), "{page}");
        }
    }
}
