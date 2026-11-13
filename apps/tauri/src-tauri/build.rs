use base64::Engine;
use std::path::PathBuf;

/// Inline KaTeX's woff2 fonts into its CSS at build time, as the Electron PDF export
/// does at runtime, so the print page needs no file or network access.
fn katex_css() {
  let root = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("../../../node_modules/katex/dist");
  let css_path = root.join("katex.min.css");
  println!("cargo:rerun-if-changed={}", css_path.display());
  let css = std::fs::read_to_string(&css_path).expect("node_modules/katex is required: run npm ci first");
  let mut output = String::with_capacity(css.len() * 4);
  let mut rest = css.as_str();
  while let Some(start) = rest.find("src:") {
    output.push_str(&rest[..start]);
    let tail = &rest[start..];
    let end = tail.find([';', '}']).unwrap_or(tail.len());
    let rule = &tail[..end];
    let font = rule.split("url(").skip(1).filter_map(|part| part.split(')').next()).find(|url| url.ends_with(".woff2"));
    match font {
      Some(font) => {
        let bytes = std::fs::read(root.join(font)).expect("KaTeX font missing");
        output.push_str(&format!(
          "src:url(data:font/woff2;base64,{}) format('woff2')",
          base64::engine::general_purpose::STANDARD.encode(bytes)
        ));
      }
      None => output.push_str(rule),
    }
    rest = &tail[end..];
  }
  output.push_str(rest);
  std::fs::write(PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("katex-inline.css"), output).unwrap();
}

fn main() {
  katex_css();
  tauri_build::build()
}
