//! Native update policy uses the embedded bundle identity, never renderer input.
pub const STABLE_IDENTIFIER: &str = "com.frowang.frowd.tauri.v1";

pub fn require_stable_updates(identifier: &str) -> Result<(), String> {
    if identifier == STABLE_IDENTIFIER { Ok(()) }
    else { Err("预览版不支持检查、下载或安装正式更新，请手动获取对应的预览安装包。".into()) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_stable_bundle_can_use_the_official_update_channel() {
        assert!(require_stable_updates(STABLE_IDENTIFIER).is_ok());
        for identity in ["com.frowang.fromd.preview", "", "com.frowang.frowd.tauri.v1.preview"] {
            assert!(require_stable_updates(identity).unwrap_err().contains("预览版"));
        }
    }
}
