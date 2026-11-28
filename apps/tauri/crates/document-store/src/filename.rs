pub(super) fn portable_component(value: &str) -> String {
    value
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect::<String>()
        .trim()
        .trim_end_matches(['.', ' '])
        .to_owned()
}

pub fn suggested_name(title: &str) -> String {
    let mut name = portable_component(title);
    for suffix in [".markdown", ".txt", ".md"] {
        if name.to_ascii_lowercase().ends_with(suffix) {
            name.truncate(name.len() - suffix.len());
            break;
        }
    }
    name = name
        .chars()
        .take(120)
        .collect::<String>()
        .trim_end_matches(['.', ' '])
        .to_owned();
    if name.is_empty() {
        name = "未命名笔记".into();
    }
    mark_reserved_name(&mut name);
    name.push_str(".md");
    name
}

pub(super) fn mark_reserved_name(name: &mut String) {
    let stem = name.split('.').next().unwrap_or("").trim_end().to_ascii_uppercase();
    if [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9", "COM¹",
        "COM²", "COM³", "LPT¹", "LPT²", "LPT³",
    ]
    .contains(&stem.as_str())
    {
        name.insert(0, '_');
    }
}

#[cfg(test)]
mod tests {
    use super::suggested_name;
    #[test]
    fn strip_known_suffix_before_adding_md() {
        for input in [
            "报告.md",
            "报告.markdown",
            "报告.txt",
            "报告.MARKDOWN",
            "报告.TxT",
        ] {
            assert_eq!(suggested_name(input), "报告.md");
        }
        assert_eq!(suggested_name("CON.txt"), "_CON.md");
        assert_eq!(suggested_name("非法:/名.txt"), "非法__名.md");
        assert_eq!(suggested_name(" .txt "), "未命名笔记.md");
        assert_eq!(
            suggested_name(&format!("{}.txt", "长".repeat(130))),
            format!("{}.md", "长".repeat(120))
        );
    }
}
