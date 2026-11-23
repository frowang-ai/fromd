// Harmless native-update fixture, compiled explicitly by the test operator.
// It records the real updater's argument and never installs or removes anything.
fn main() {
    let profile = std::path::PathBuf::from(std::env::var_os("FROWANG_USER_DATA").expect("synthetic profile"));
    assert!(profile.is_absolute() && profile.join(".frowd-update-test").is_file());
    let arguments: Vec<_> = std::env::args().skip(1).collect();
    assert_eq!(arguments, ["/P"]);
    std::fs::write(profile.join("update-installer-started.txt"), arguments.join(" ")).unwrap();
}
