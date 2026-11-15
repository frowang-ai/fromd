use super::*;
use serde::Deserialize;
use std::time::Instant;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSource {
    pub token: String,
    pub title: String,
    pub kind: String,
    pub content: String,
    pub bom: bool,
    pub eol: String,
}
pub struct FileImport {
    pub source: ImportSource,
    path: PathBuf,
    created: Instant,
    inputs: Vec<ResourceInput>,
    payload: Vec<u8>,
    planned: Vec<ResourceInfo>,
    staged: bool,
}
#[derive(Deserialize, Clone)]
pub struct ImportReference {
    pub reference: String,
    pub image: bool,
}
impl FileImport {
    pub fn read(path: &Path) -> Result<Self> {
        let path = fs::canonicalize(path)?;
        let ext = path
            .extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_ascii_lowercase();
        let kind = match ext.as_str() {
            "txt" => "text",
            "html" | "htm" => "html",
            _ => return Err(invalid("导入只支持 UTF-8 TXT / HTML 文件。")),
        };
        let (_, content, bom, eol) = file_body(&path)?;
        let title = valid_title(&path.file_stem().unwrap_or_default().to_string_lossy())?;
        Ok(Self {
            source: ImportSource {
                token: Uuid::new_v4().to_string(),
                title,
                kind: kind.into(),
                content,
                bom,
                eol,
            },
            path,
            created: Instant::now(),
            inputs: vec![],
            payload: vec![],
            planned: vec![],
            staged: false,
        })
    }
    pub fn verify(&self, token: &str) -> Result<()> {
        if token != self.source.token || self.created.elapsed().as_secs() > 300 {
            return Err(invalid("导入来源已过期，请重新选择文件。"));
        }
        Ok(())
    }
    pub fn stage(&mut self, store: &Store, refs: &[ImportReference]) -> Result<Vec<ResourceInfo>> {
        self.staged = false;
        self.inputs.clear();
        self.payload.clear();
        self.planned.clear();
        if refs.len() > 8 || self.source.kind == "text" && !refs.is_empty() {
            return Err(invalid(
                "HTML 最多导入 8 个本地资源；TXT 资源请通过插入图片/附件添加。",
            ));
        }
        let root = fs::canonicalize(
            self.path
                .parent()
                .ok_or_else(|| invalid("导入文件目录无效。"))?,
        )?;
        let mut inputs = vec![];
        let mut payload = vec![];
        let mut seen = std::collections::HashSet::new();
        for reference in refs {
            if !seen.insert(reference.reference.clone()) {
                return Err(invalid("资源引用重复。"));
            }
            let path = fs::canonicalize(root.join(assets::relative(&reference.reference)?))?;
            if !path.starts_with(&root) || !path.is_file() {
                return Err(invalid("导入资源越过源文件所属目录或不是文件。"));
            }
            let bytes = assets::bounded_read(&path, MAX_ATTACHMENT_BYTES)?;
            if payload.len() + bytes.len() > MAX_IMPORT_BYTES {
                return Err(invalid("导入资源合计最多 50 MiB。"));
            }
            inputs.push(ResourceInput {
                name: path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
                size: bytes.len(),
                image: reference.image,
            });
            payload.extend(bytes);
        }
        let planned = store.planned_resources(&inputs, &payload)?;
        self.inputs = inputs;
        self.payload = payload;
        self.planned = planned.clone();
        self.staged = true;
        Ok(planned)
    }
    pub fn commit(self, store: &mut Store, markdown: &str) -> Result<Snapshot> {
        valid_body(markdown)?;
        if let Some(snapshot) = store.confirm_import(&self.source.token, markdown)? {
            return Ok(snapshot);
        }
        if !self.staged {
            return Err(invalid("请先完成导入内容与资源校验。"));
        }
        let current = store.planned_resources(&self.inputs, &self.payload)?;
        if current
            .iter()
            .map(|p| &p.reference)
            .ne(self.planned.iter().map(|p| &p.reference))
        {
            return Err(invalid("资源登记已变化，请重新导入。"));
        }
        // The renderer can supply only finalized Markdown, never paths to read here.
        for event in pulldown_cmark::Parser::new_ext(markdown, pulldown_cmark::Options::all()) {
            let (url, image) = match event {
                pulldown_cmark::Event::Start(pulldown_cmark::Tag::Image { dest_url, .. }) => {
                    (dest_url.to_string(), true)
                }
                pulldown_cmark::Event::Start(pulldown_cmark::Tag::Link { dest_url, .. }) => {
                    (dest_url.to_string(), false)
                }
                _ => continue,
            };
            if (!image
                && (url.starts_with('#')
                    || ["https:", "http:", "mailto:", "tel:"]
                        .iter()
                        .any(|prefix| url.to_ascii_lowercase().starts_with(prefix))))
                || url.is_empty()
            {
                continue;
            }
            if !current.iter().any(|r| {
                r.reference == url.split(['?', '#']).next().unwrap_or("") && (!image || r.image)
            }) {
                return Err(invalid(
                    "导入包含未登记/不支持的资源引用；请使用本地栅格图片或附件重新导入。",
                ));
            }
        }
        if self.source.kind == "text" && markdown != self.source.content {
            return Err(invalid("TXT 导入内容与已读取原文不一致。"));
        }
        let doc = Stored {
            id: self.source.token,
            title: self.source.title,
            path: None,
            markdown: markdown.into(),
            saved_hash: digest(""),
            content_hash: digest(markdown),
            baseline: None,
            bom: self.source.bom,
            eol: self.source.eol,
            revision: 0,
            conflict: false,
            view_state: Value::Null,
            position: store.conn.query_row(
                "SELECT COALESCE(MAX(position),-1)+1 FROM documents",
                [],
                |r| r.get(0),
            )?,
            shelved: false,
        };
        store.import_resource_batch(&doc.id, &self.inputs, &self.payload, Some(&doc))?;
        store.snapshot()
    }
}
impl Store {
    pub fn confirm_import(&self, token: &str, markdown: &str) -> Result<Option<Snapshot>> {
        let exists: bool = self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM documents WHERE id=?1)",
            params![token],
            |r| r.get(0),
        )?;
        if !exists {
            return Ok(None);
        }
        let doc = self.read_stored(token)?;
        if doc.path.is_some() || doc.markdown != markdown {
            return Err(invalid(
                "导入页面已存在但内容不一致，请查看页面列表，勿重复创建。",
            ));
        }
        Ok(Some(self.snapshot()?))
    }
}
#[cfg(test)]
#[path = "file_import_tests.rs"]
mod tests;
