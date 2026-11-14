use serde::Serialize;
#[derive(Debug, Clone, Serialize)]
pub struct SearchLocation {
    pub line: usize,
    pub column: usize,
    pub length: usize,
    pub needle: String,
}
#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    pub id: String,
    pub title: String,
    pub shelved: bool,
    pub revision: i64,
    pub snippet: String,
    pub location: Option<SearchLocation>,
}
// ASCII-insensitive literal search preserves UTF-8 byte boundaries and Chinese text.
pub fn hit(
    id: String,
    title: String,
    markdown: &str,
    revision: i64,
    shelved: bool,
    query: &str,
) -> Option<SearchHit> {
    let found = markdown
        .to_ascii_lowercase()
        .find(&query.to_ascii_lowercase());
    if found.is_none()
        && !title
            .to_ascii_lowercase()
            .contains(&query.to_ascii_lowercase())
    {
        return None;
    }
    let (snippet, location) = match found {
        Some(index) => {
            let prefix = &markdown[..index];
            let line = prefix.bytes().filter(|b| *b == b'\n').count() + 1;
            let column = prefix.rsplit('\n').next().unwrap_or("").chars().count();
            let before: String = prefix
                .chars()
                .rev()
                .take(60)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            let after: String = markdown[index..].chars().take(180).collect();
            (
                format!("{}{}", before, after).replace('\n', " "),
                Some(SearchLocation {
                    line,
                    column,
                    length: query.chars().count(),
                    needle: query.to_owned(),
                }),
            )
        }
        None => (title.chars().take(240).collect(), None),
    };
    Some(SearchHit {
        id,
        title,
        shelved,
        revision,
        snippet,
        location,
    })
}
