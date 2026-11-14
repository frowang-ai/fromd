use super::*;
use image::{ImageFormat, ImageReader, Limits};
use pulldown_cmark::{Event, Options, Parser, Tag};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    io::{Cursor, Read},
};

const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_ATTACHMENT_BYTES: usize = 25 * 1024 * 1024;
pub const MAX_IMPORT_BYTES: usize = 50 * 1024 * 1024;
const MAX_OBJECT_BYTES: u64 = 512 * 1024 * 1024;
const MAX_OBJECTS: usize = 2048;
const MAX_EXPORT: usize = 256;
const PREFIX: &str = ".frowd-assets/";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceInput {
    pub name: String,
    pub size: usize,
    pub image: bool,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceInfo {
    pub id: String,
    pub reference: String,
    pub name: String,
    pub mime: String,
    pub size: usize,
    pub image: bool,
}
pub(super) fn schema(c: &Connection) -> Result<()> {
    c.execute_batch("CREATE TABLE IF NOT EXISTS resource_objects(hash TEXT PRIMARY KEY,extension TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS resource_bindings(docId TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(docId,hash));")?;
    for table in ["resource_objects", "resource_bindings"] {
        let real: bool = c.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
            params![table],
            |r| r.get(0),
        )?;
        if !real {
            return Err(invalid("资源登记表结构无效，原数据库已保留。"));
        }
    }
    c.prepare("SELECT hash,extension,mime,size FROM resource_objects LIMIT 0")?;
    c.prepare("SELECT docId,hash FROM resource_bindings LIMIT 0")?;
    Ok(())
}
fn safe_ext(ext: &str) -> bool {
    !ext.is_empty() && ext.len() <= 8 && ext.bytes().all(|c| c.is_ascii_alphanumeric())
}
fn display_name(name: &str) -> String {
    let result: String = name.chars().filter(|c| !c.is_control()).take(120).collect();
    let result = result.trim();
    if result.is_empty() {
        "附件".into()
    } else {
        result.into()
    }
}
fn kind(bytes: &[u8], name: &str, required: bool) -> Result<(String, String)> {
    let format = image::guess_format(bytes).ok();
    let raster = matches!(
        format,
        Some(ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::Gif | ImageFormat::WebP)
    );
    if raster {
        if bytes.len() > MAX_IMAGE_BYTES {
            return Err(invalid("栅格图片最多 10 MiB。"));
        }
        let format = format.unwrap();
        let mut limits = Limits::default();
        limits.max_alloc = Some(96 * 1024 * 1024);
        limits.max_image_width = Some(12000);
        limits.max_image_height = Some(12000);
        let mut dimensions = ImageReader::with_format(Cursor::new(bytes), format);
        dimensions.limits(limits.clone());
        let (w, h) = dimensions
            .into_dimensions()
            .map_err(|_| invalid("图片编码损坏或尺寸超过限制。"))?;
        if w == 0 || h == 0 || u64::from(w) * u64::from(h) > 40_000_000 {
            return Err(invalid("图片尺寸超过 4000 万像素。"));
        }
        let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
        reader.limits(limits);
        reader
            .decode()
            .map_err(|_| invalid("图片无法解码或超过解码内存限制。"))?;
        let (ext, mime) = match format {
            ImageFormat::Png => ("png", "image/png"),
            ImageFormat::Jpeg => ("jpg", "image/jpeg"),
            ImageFormat::Gif => ("gif", "image/gif"),
            _ => ("webp", "image/webp"),
        };
        return Ok((ext.into(), mime.into()));
    }
    if required {
        return Err(invalid(
            "图片只支持真实 PNG/JPEG/GIF/WebP，不支持 SVG 或伪造格式。",
        ));
    }
    let ext = name
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .filter(|e| safe_ext(e))
        .unwrap_or_else(|| "bin".into());
    Ok((ext, "application/octet-stream".into()))
}
fn bounded_read(path: &Path, max: usize) -> Result<Vec<u8>> {
    let info = fs::metadata(path)?;
    if !info.is_file() || info.len() > max as u64 {
        return Err(invalid("资源不是普通文件或超过单文件上限。"));
    }
    let mut bytes = Vec::new();
    File::open(path)?
        .take(max as u64 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > max {
        return Err(invalid("读取期间资源增长超过上限。"));
    }
    Ok(bytes)
}
fn budget(bytes: u64, count: usize) -> Result<()> {
    if bytes > MAX_OBJECT_BYTES || count > MAX_OBJECTS {
        return Err(invalid(
            "资源保留区超过 512 MiB 或 2048 个文件，请使用其他隔离资料目录；未自动删除任何资源。",
        ));
    }
    Ok(())
}
fn relative(reference: &str) -> Result<PathBuf> {
    if reference.len() > 4096 || reference.chars().any(|c| c.is_control()) {
        return Err(invalid("资源引用无效。"));
    }
    let raw = reference.split(['?', '#']).next().unwrap_or("");
    let decoded = percent_encoding::percent_decode_str(raw)
        .decode_utf8()
        .map_err(|_| invalid("资源路径编码无效。"))?;
    if decoded.chars().any(|c| c.is_control()) {
        return Err(invalid("资源路径含控制字符。"));
    }
    let value = decoded.replace('\\', "/");
    if value.is_empty()
        || value.starts_with('/')
        || value.contains(':')
        || value.split('/').any(|p| p == "..")
    {
        return Err(invalid("资源必须是文稿目录内的相对路径。"));
    }
    let result = PathBuf::from(value);
    if result.is_absolute() {
        return Err(invalid("资源不能使用绝对路径。"));
    }
    Ok(result)
}
fn destination(root: &Path, rel: &Path) -> Result<PathBuf> {
    let root = fs::canonicalize(root)?;
    let mut parent = root.clone();
    for component in rel.parent().unwrap_or(Path::new("")).components() {
        if let std::path::Component::Normal(part) = component {
            parent.push(part);
            if !parent.exists() {
                fs::create_dir(&parent)?
            }
            let canonical = fs::canonicalize(&parent)?;
            if !canonical.starts_with(&root) || !canonical.is_dir() {
                return Err(invalid("目标资源目录越界或不是文件夹。"));
            }
        }
    }
    let path = parent.join(rel.file_name().ok_or_else(|| invalid("资源文件名无效。"))?);
    if path.exists() && !fs::canonicalize(&path)?.starts_with(root) {
        return Err(invalid("目标资源文件越界。"));
    }
    Ok(path)
}
/// Create-only copy: reuse identical data, never replace a different destination.
fn write_new(path: &Path, bytes: &[u8]) -> Result<bool> {
    if path.exists() {
        let existing = bounded_read(path, MAX_ATTACHMENT_BYTES)?;
        if existing != bytes {
            return Err(invalid(
                "目标资源已存在且内容不同，Markdown 与原资源未覆盖。",
            ));
        }
        return Ok(false);
    }
    let mut temp = NamedTempFile::new_in(path.parent().ok_or_else(|| invalid("资源目录无效。"))?)?;
    temp.write_all(bytes)?;
    temp.as_file().sync_all()?;
    match temp.persist_noclobber(path) {
        Ok(_) => Ok(true),
        Err(error) => {
            if path.exists() && bounded_read(path, MAX_ATTACHMENT_BYTES)? == bytes {
                Ok(false)
            } else {
                Err(StoreError::Io(error.error))
            }
        }
    }
}
impl Store {
    fn object_root(&self) -> Result<PathBuf> {
        let mut root = self.profile.clone();
        for part in ["resources", "objects"] {
            root.push(part);
            if !root.exists() {
                fs::create_dir(&root)?
            }
            root = fs::canonicalize(&root)?;
            if !root.starts_with(&self.profile) || !root.is_dir() {
                return Err(invalid("受管资源目录越界。"));
            }
        }
        Ok(root)
    }
    fn owned_object(&self, id: &str, reference: &str) -> Result<Option<PathBuf>> {
        self.ensure_exists(id)?;
        let normalized = relative(reference)?.to_string_lossy().replace('\\', "/");
        let Some(file) = normalized.trim_start_matches("./").strip_prefix(PREFIX) else {
            return Ok(None);
        };
        let Some((hash, ext)) = file.rsplit_once('.') else {
            return Ok(None);
        };
        if hash.len() != 64 || !hash.bytes().all(|c| c.is_ascii_hexdigit()) || !safe_ext(ext) {
            return Ok(None);
        }
        let registered:bool=self.conn.query_row("SELECT EXISTS(SELECT 1 FROM resource_objects o JOIN resource_bindings b ON b.hash=o.hash WHERE b.docId=?1 AND o.hash=?2 AND o.extension=?3)",params![id,hash,ext],|r|r.get(0))?;
        if !registered {
            return Ok(None);
        }
        let path = self.object_root()?.join(file);
        if fs::symlink_metadata(&path)?.file_type().is_symlink()
            || !fs::canonicalize(&path)?.starts_with(self.object_root()?)
        {
            return Err(invalid("受管资源文件越界。"));
        }
        let bytes = bounded_read(&path, MAX_ATTACHMENT_BYTES)?;
        if hash_bytes(&bytes) != hash {
            return Err(invalid("受管资源已被修改，未读取或覆盖。"));
        }
        Ok(Some(path))
    }
    pub fn managed_attachment(&self, id: &str, reference: &str) -> Result<Option<PathBuf>> {
        self.owned_object(id, reference)
    }
    pub fn import_resources(
        &mut self,
        id: &str,
        inputs: &[ResourceInput],
        payload: &[u8],
    ) -> Result<Vec<ResourceInfo>> {
        self.ensure_exists(id)?;
        if inputs.is_empty() || inputs.len() > 8 || payload.len() > MAX_IMPORT_BYTES {
            return Err(invalid("每批最多 8 个资源、合计 50 MiB。"));
        }
        let mut offset = 0usize;
        let mut plans = Vec::new();
        let mut proposed = HashMap::<String, (String, String)>::new();
        for input in inputs {
            if input.size > MAX_ATTACHMENT_BYTES {
                return Err(invalid("附件最多 25 MiB。"));
            }
            let end = offset
                .checked_add(input.size)
                .filter(|end| *end <= payload.len())
                .ok_or_else(|| invalid("资源数据长度不一致。"))?;
            let bytes = &payload[offset..end];
            let name = display_name(&input.name);
            let (mut ext, mut mime) = kind(bytes, &name, input.image)?;
            let hash = hash_bytes(bytes);
            let existing: Option<(String, String)> = self
                .conn
                .query_row(
                    "SELECT extension,mime FROM resource_objects WHERE hash=?1",
                    params![hash],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            if let Some((e, m)) = existing.or_else(|| proposed.get(&hash).cloned()) {
                ext = e;
                mime = m
            }
            if !safe_ext(&ext) {
                return Err(invalid("资源登记扩展名无效。"));
            }
            proposed.insert(hash.clone(), (ext.clone(), mime.clone()));
            plans.push((
                ResourceInfo {
                    id: hash.clone(),
                    reference: format!("{}{}.{}", PREFIX, hash, ext),
                    name,
                    mime,
                    size: input.size,
                    image: input.image,
                },
                offset,
                end,
            ));
            offset = end;
        }
        if offset != payload.len() {
            return Err(invalid("资源数据尾部长度不一致。"));
        }
        let root = self.object_root()?;
        let mut used = 0u64;
        let mut count = 0usize;
        for entry in fs::read_dir(&root)? {
            let entry = entry?;
            let meta = entry.metadata()?;
            if !meta.is_file() || entry.file_type()?.is_symlink() {
                return Err(invalid("受管资源目录含有异常项目。"));
            }
            used = used.saturating_add(meta.len());
            count += 1
        }
        let mut new_hashes = HashSet::new();
        for (info, _, _) in &plans {
            let file = info.reference.trim_start_matches(PREFIX);
            if !root.join(file).exists() && new_hashes.insert(info.id.clone()) {
                used = used.saturating_add(info.size as u64);
                count += 1
            }
        }
        budget(used, count)?;
        let mut created = Vec::new();
        let result = (|| -> Result<()> {
            let tx = self.conn.unchecked_transaction()?;
            for (info, start, end) in &plans {
                let file = info.reference.trim_start_matches(PREFIX);
                let path = root.join(file);
                if fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink()) {
                    return Err(invalid("受管资源不能是符号链接。"));
                }
                if write_new(&path, &payload[*start..*end])? {
                    created.push(path)
                }
                let ext = file.rsplit_once('.').unwrap().1;
                tx.execute("INSERT OR IGNORE INTO resource_objects(hash,extension,mime,size) VALUES(?1,?2,?3,?4)",params![info.id,ext,info.mime,info.size as i64])?;
                tx.execute(
                    "INSERT OR IGNORE INTO resource_bindings(docId,hash) VALUES(?1,?2)",
                    params![id, info.id],
                )?;
            }
            tx.commit()?;
            Ok(())
        })();
        if let Err(error) = result {
            let mut retained = false;
            for path in &created {
                if fs::remove_file(path).is_err() {
                    retained = true
                }
            }
            if retained {
                return Err(invalid(&format!(
                    "资源登记失败，部分新文件保留在受管目录；正文未插入：{}",
                    error
                )));
            }
            return Err(error);
        }
        Ok(plans.into_iter().map(|(info, _, _)| info).collect())
    }
    fn source_resource(&self, id: &str, doc: &Stored, reference: &str) -> Result<PathBuf> {
        if let Some(path) = self.owned_object(id, reference)? {
            return Ok(path);
        }
        let rel = relative(reference)?;
        let root =
            fs::canonicalize(
                Path::new(doc.path.as_deref().ok_or_else(|| {
                    invalid("未保存草稿的外部图片没有所属目录，请先通过本页导入。")
                })?)
                .parent()
                .ok_or_else(|| invalid("文稿目录无效。"))?,
            )?;
        let path = fs::canonicalize(root.join(rel))?;
        if !path.starts_with(root) || !path.is_file() {
            return Err(invalid("资源越过文稿所属目录或不是文件。"));
        }
        Ok(path)
    }
    pub fn resource_image(&self, id: &str, reference: &str) -> Result<(Vec<u8>, String)> {
        let doc = self.read_stored(id)?;
        let path = self.source_resource(id, &doc, reference)?;
        let bytes = bounded_read(&path, MAX_IMAGE_BYTES)?;
        let (_, mime) = kind(&bytes, "image", true)?;
        Ok((bytes, mime))
    }
    pub(super) fn materialize_resources(
        &self,
        id: &str,
        doc: &Stored,
        markdown_target: &Path,
        include_external: bool,
    ) -> Result<()> {
        let target = markdown_target
            .parent()
            .ok_or_else(|| invalid("保存目录无效。"))?;
        let mut refs = Vec::new();
        let mut indexes = HashMap::<PathBuf, usize>::new();
        let mut references: Vec<(String, PathBuf, bool)> = Vec::new();
        let mut total = 0u64;
        for event in Parser::new_ext(&doc.markdown, Options::all()) {
            let (reference, image) = match event {
                Event::Start(Tag::Image { dest_url, .. }) => (dest_url.to_string(), true),
                Event::Start(Tag::Link { dest_url, .. })
                    if dest_url.trim_start_matches("./").starts_with(PREFIX) =>
                {
                    (dest_url.to_string(), false)
                }
                _ => continue,
            };
            if reference.starts_with("data:")
                || reference.contains("://")
                || reference.starts_with('#')
            {
                continue;
            }
            let managed = reference.trim_start_matches("./").starts_with(PREFIX);
            if !managed && !include_external {
                continue;
            }
            let rel = relative(&reference)?;
            if let Some(index) = indexes.get(&rel) {
                references[*index].2 |= image;
                continue;
            }
            if references.len() >= MAX_EXPORT {
                return Err(invalid("一次导出最多 256 个不同资源。"));
            }
            indexes.insert(rel.clone(), references.len());
            references.push((reference, rel, image));
        }
        for (reference, rel, image) in references {
            let source = self.source_resource(id, doc, &reference)?;
            let bytes = bounded_read(
                &source,
                if image {
                    MAX_IMAGE_BYTES
                } else {
                    MAX_ATTACHMENT_BYTES
                },
            )?;
            if image {
                kind(&bytes, "image", true)?;
            }
            total = total.saturating_add(bytes.len() as u64);
            if total > MAX_OBJECT_BYTES {
                return Err(invalid("一次导出资源合计最多 512 MiB。"));
            }
            let dest = destination(target, &rel)?;
            if path_key(&dest.to_string_lossy()) == path_key(&markdown_target.to_string_lossy()) {
                return Err(invalid("资源引用与目标 Markdown 文件同名，未写入或覆盖。"));
            }
            // Preflight every destination before any copies/Markdown writes.
            if dest.exists() && bounded_read(&dest, MAX_ATTACHMENT_BYTES)? != bytes {
                return Err(invalid(
                    "目标资源同名但内容不同，Markdown 与现有资源均未覆盖。",
                ));
            }
            refs.push((source, dest, hash_bytes(&bytes)));
        }
        for (source, dest, hash) in refs {
            let bytes = bounded_read(&source, MAX_ATTACHMENT_BYTES)?;
            if hash_bytes(&bytes) != hash {
                return Err(invalid(
                    "复制期间外部资源变化，Markdown 未写入；已复制的新资源可能保留。",
                ));
            }
            write_new(&dest, &bytes).map_err(|e| {
                invalid(&format!(
                    "资源复制失败，Markdown 未写入；已复制的新资源可能保留：{}",
                    e
                ))
            })?;
        }
        Ok(())
    }
}
#[cfg(test)]
#[path = "asset_tests.rs"]
mod tests;
