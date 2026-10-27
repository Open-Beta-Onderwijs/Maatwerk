// SPDX-License-Identifier: AGPL-3.0-or-later

//! Safe paths inside the shared data folder.
//!
//! Every path that comes from the UI is a [`RelPath`]: a `/`-separated relative path that is
//! checked lexically (no `..`, no absolute or drive paths, no reserved Windows names). Turning it
//! into a filesystem path goes through [`DataDir::resolve`], which also rejects symlink and
//! junction escapes. The reference joined paths unchecked (`ipc-api.md`, Conventions).

use std::ffi::OsString;
use std::fmt;
use std::io;
use std::path::{Path, PathBuf};

use crate::error::{Error, Result};

/// Environment variable that overrides the data folder location (tests, manual runs).
pub const DATA_DIR_ENV: &str = "MAATWERK_DATA_DIR";

/// Where the data folder lives: `$MAATWERK_DATA_DIR` if set, else `data/` in the project folder
/// when running from a dev build, else `data/` next to the exe (the reference's `getAppDir`).
pub fn data_dir_location(
    env_override: Option<OsString>,
    exe: &Path,
    dev_project_dir: Option<&Path>,
) -> PathBuf {
    if let Some(dir) = env_override.filter(|d| !d.is_empty()) {
        return PathBuf::from(dir);
    }
    if let Some(project) = dev_project_dir {
        return project.join("data");
    }
    exe.parent().unwrap_or(Path::new(".")).join("data")
}

/// A validated relative path inside the data folder, stored with `/` separators.
#[derive(Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct RelPath(String);

impl RelPath {
    /// Checks `raw` lexically. Rejects empty paths, absolute paths, drive letters, `\`, `.`/`..`
    /// and empty segments, characters Windows does not allow, segments ending in `.` or a space
    /// (Windows strips those, so two names would alias) and reserved device names.
    pub fn parse(raw: &str) -> Result<RelPath> {
        let bad = |reason| Error::InvalidPath {
            path: raw.to_owned(),
            reason,
        };
        if raw.is_empty() {
            return Err(bad("empty path"));
        }
        if raw.starts_with('/') {
            return Err(bad("absolute path"));
        }
        if raw.contains('\\') {
            return Err(bad("backslash in path"));
        }
        for segment in raw.split('/') {
            check_segment(segment).map_err(bad)?;
        }
        Ok(RelPath(raw.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Appends one or more `/`-separated segments, validating them.
    pub fn join(&self, tail: &str) -> Result<RelPath> {
        RelPath::parse(&format!("{}/{}", self.0, tail))
    }

    /// The last segment.
    pub fn file_name(&self) -> &str {
        self.0.rsplit('/').next().unwrap_or(&self.0)
    }

    /// Lower-case extension of the last segment without the dot, if any.
    pub fn extension(&self) -> Option<String> {
        let name = self.file_name();
        name.rfind('.')
            .filter(|&i| i > 0)
            .map(|i| name[i + 1..].to_ascii_lowercase())
    }
}

impl fmt::Debug for RelPath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "RelPath({:?})", self.0)
    }
}

impl fmt::Display for RelPath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

fn check_segment(segment: &str) -> std::result::Result<(), &'static str> {
    if segment.is_empty() {
        return Err("empty segment");
    }
    if segment == "." || segment == ".." {
        return Err("dot segment");
    }
    if segment
        .chars()
        .any(|c| c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*'))
    {
        return Err("character not allowed in a file name");
    }
    if segment.ends_with('.') || segment.ends_with(' ') {
        return Err("segment ends with a dot or space");
    }
    if is_reserved_windows_name(segment) {
        return Err("reserved Windows name");
    }
    Ok(())
}

/// `CON`, `PRN`, `AUX`, `NUL`, `COM0-9`, `LPT0-9` (also with superscript digits), with or
/// without an extension, in any case.
fn is_reserved_windows_name(segment: &str) -> bool {
    let stem = segment
        .split('.')
        .next()
        .unwrap_or(segment)
        .trim_end()
        .to_ascii_uppercase();
    if matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) {
        return true;
    }
    let mut chars = stem.chars();
    let prefix: String = chars.by_ref().take(3).collect();
    let rest: Vec<char> = chars.collect();
    (prefix == "COM" || prefix == "LPT")
        && rest.len() == 1
        && (rest[0].is_ascii_digit() || matches!(rest[0], '¹' | '²' | '³'))
}

/// The data folder. Holds its canonical root so containment checks compare like with like.
#[derive(Debug, Clone)]
pub struct DataDir {
    root: PathBuf,
}

impl DataDir {
    /// Creates the folder if needed (the reference's `getDataDir` does the same) and
    /// canonicalises it.
    pub fn open(root: impl AsRef<Path>) -> Result<DataDir> {
        let root = root.as_ref();
        let shown = root.display().to_string();
        std::fs::create_dir_all(root).map_err(|e| Error::io(&shown, e))?;
        let root = root.canonicalize().map_err(|e| Error::io(&shown, e))?;
        Ok(DataDir { root })
    }

    /// Canonical absolute root.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Filesystem path for `rel`. Rejects a path whose deepest existing parent folder (or the
    /// last segment itself, if it is a link) resolves outside the root: a symlink or junction
    /// inside the data folder must not lead out of it.
    pub fn resolve(&self, rel: &RelPath) -> Result<PathBuf> {
        let mut path = self.root.clone();
        path.extend(rel.as_str().split('/'));
        self.check_contained(rel, &path)?;
        Ok(path)
    }

    fn check_contained(&self, rel: &RelPath, path: &Path) -> Result<()> {
        let escape = || Error::InvalidPath {
            path: rel.to_string(),
            reason: "leaves the data folder",
        };
        let inside = |p: &Path| {
            p.canonicalize()
                .is_ok_and(|real| real.starts_with(&self.root))
        };
        // The last segment is only resolved when it is a link (a dangling link counts as an
        // escape: writing through it would create a file elsewhere). A plain file is never
        // canonicalised: one that another process is replacing right now resolves to
        // `\$Extend\$Deleted\...` on NTFS, outside the root.
        if std::fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink())
            && !inside(path)
        {
            return Err(escape());
        }
        // Then the deepest folder above it that exists.
        let mut probe = path.parent().ok_or_else(escape)?;
        loop {
            match std::fs::symlink_metadata(probe) {
                Ok(_) => break,
                Err(e) if e.kind() == io::ErrorKind::NotFound => {
                    probe = probe.parent().ok_or_else(escape)?;
                }
                Err(e) => return Err(Error::io(rel.as_str(), e)),
            }
        }
        let real = probe
            .canonicalize()
            .map_err(|e| Error::io(rel.as_str(), e))?;
        if real.starts_with(&self.root) {
            Ok(())
        } else {
            Err(escape())
        }
    }

    /// Path relative to the root with `/` separators, for paths found by walking the folder.
    pub fn rel_of(&self, abs: &Path) -> Option<String> {
        let rest = abs.strip_prefix(&self.root).ok()?;
        let parts: Option<Vec<&str>> = rest.components().map(|c| c.as_os_str().to_str()).collect();
        Some(parts?.join("/"))
    }
}

/// A path as the UI shows it: without the `\\?\` verbatim prefix that canonicalising adds on
/// Windows.
pub fn display_path(path: &Path) -> String {
    let s = path.display().to_string();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    match s.strip_prefix(r"\\?\") {
        Some(rest) => rest.to_owned(),
        None => s,
    }
}

/// `YYYY-YYYY` year folder name (`main.js:126`).
pub fn is_year_name(name: &str) -> bool {
    let b = name.as_bytes();
    b.len() == 9
        && b[4] == b'-'
        && b[..4].iter().all(u8::is_ascii_digit)
        && b[5..].iter().all(u8::is_ascii_digit)
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn display_path_drops_the_verbatim_prefix() {
        assert_eq!(display_path(Path::new(r"\\?\C:\a\data")), r"C:\a\data");
        assert_eq!(
            display_path(Path::new(r"\\?\UNC\srv\share\data")),
            r"\\srv\share\data"
        );
        assert_eq!(display_path(Path::new("/home/a/data")), "/home/a/data");
    }

    #[test]
    fn accepts_normal_paths() {
        for ok in [
            "config.json",
            "2025-2026/scores/nat/105455.json",
            "opdrachten/images/abc/plaatje 1.png",
            "templates/RTTI explanations and advices/rtti_expl_adv_nat_3.json",
            "fotos/zoë.jpg",
            ".hidden",
            "con-tact.json",
            "COM10.txt",
        ] {
            assert!(RelPath::parse(ok).is_ok(), "{ok}");
        }
    }

    #[test]
    fn rejects_unsafe_paths() {
        for bad in [
            "",
            "/etc/passwd",
            "..",
            "../x.json",
            "a/../../x.json",
            "a/./b.json",
            "a//b.json",
            "a/",
            "C:/Windows/x",
            "C:x",
            "a\\..\\b",
            "\\\\server\\share",
            "file.json:stream",
            "a/b?.json",
            "a/b*.json",
            "a/b\u{0}.json",
            "trailing.",
            "trailing ",
            "CON",
            "con.json",
            "a/nul.txt",
            "Aux",
            "LPT1.json",
            "com9",
            "COM¹.txt",
        ] {
            assert!(RelPath::parse(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn extension_and_file_name() {
        let p = RelPath::parse("fotos/Logo.PNG").unwrap();
        assert_eq!(p.file_name(), "Logo.PNG");
        assert_eq!(p.extension().as_deref(), Some("png"));
        assert_eq!(RelPath::parse(".hidden").unwrap().extension(), None);
    }

    #[test]
    fn data_dir_location_order() {
        let exe = Path::new("/apps/maatwerk/maatwerk.exe");
        assert_eq!(
            data_dir_location(Some("/tmp/d".into()), exe, Some(Path::new("/proj"))),
            PathBuf::from("/tmp/d")
        );
        assert_eq!(
            data_dir_location(Some("".into()), exe, Some(Path::new("/proj"))),
            Path::new("/proj").join("data")
        );
        assert_eq!(
            data_dir_location(None, exe, None),
            Path::new("/apps/maatwerk").join("data")
        );
    }

    #[test]
    fn year_names() {
        assert!(is_year_name("2025-2026"));
        assert!(!is_year_name("2025-26"));
        assert!(!is_year_name("2025_2026"));
        assert!(!is_year_name("２０２５-2026"));
    }

    #[test]
    fn resolve_stays_inside_and_maps_missing_paths() {
        let tmp = tempfile::tempdir().unwrap();
        let dd = DataDir::open(tmp.path().join("data")).unwrap();
        let rel = RelPath::parse("2025-2026/scores/nat/1.json").unwrap();
        let abs = dd.resolve(&rel).unwrap();
        assert!(abs.starts_with(dd.root()));
        assert_eq!(
            dd.rel_of(&abs).as_deref(),
            Some("2025-2026/scores/nat/1.json")
        );
    }

    #[cfg(unix)]
    #[test]
    fn resolve_rejects_symlink_escape() {
        let tmp = tempfile::tempdir().unwrap();
        let outside = tmp.path().join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        let dd = DataDir::open(tmp.path().join("data")).unwrap();
        std::os::unix::fs::symlink(&outside, dd.root().join("link")).unwrap();
        std::fs::write(outside.join("secret.json"), "{}").unwrap();
        std::os::unix::fs::symlink(outside.join("secret.json"), dd.root().join("file.json"))
            .unwrap();
        for p in ["link/x.json", "link/new/deeper.json", "file.json"] {
            let err = dd.resolve(&RelPath::parse(p).unwrap()).unwrap_err();
            assert_eq!(err.code(), "invalid_path", "{p}");
        }
    }

    // Junctions need no privileges on Windows, unlike symlinks, so they are the realistic escape.
    #[cfg(windows)]
    #[test]
    fn resolve_rejects_junction_escape() {
        let tmp = tempfile::tempdir().unwrap();
        let outside = tmp.path().join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        let dd = DataDir::open(tmp.path().join("data")).unwrap();
        let link = dd.root().join("link");
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(&outside)
            .output()
            .unwrap();
        assert!(status.status.success(), "mklink /J failed: {status:?}");
        for p in ["link", "link/x.json", "link/new/deeper.json"] {
            let err = dd.resolve(&RelPath::parse(p).unwrap()).unwrap_err();
            assert_eq!(err.code(), "invalid_path", "{p}");
        }
    }

    proptest! {
        // Whatever the input, an accepted path never climbs out lexically and never looks
        // absolute or drive-relative.
        #[test]
        fn parsed_paths_are_lexically_safe(raw in "[a-zA-Z0-9 ._:/\\\\-]{0,24}") {
            if let Ok(p) = RelPath::parse(&raw) {
                let s = p.as_str();
                prop_assert!(!s.starts_with('/'));
                prop_assert!(!s.contains('\\') && !s.contains(':'));
                prop_assert!(s.split('/').all(|seg| !seg.is_empty() && seg != "." && seg != ".."));
            }
        }

        #[test]
        fn dotdot_anywhere_is_rejected(prefix in "[a-z]{1,5}(/[a-z]{1,5}){0,3}", suffix in "(/[a-z]{1,5}){0,3}") {
            let raw = format!("{prefix}/..{suffix}");
            prop_assert!(RelPath::parse(&raw).is_err());
        }

        #[test]
        fn resolved_paths_stay_under_root(segs in proptest::collection::vec("[a-zA-Z0-9_-]{1,8}", 1..5)) {
            let tmp = tempfile::tempdir().unwrap();
            let dd = DataDir::open(tmp.path()).unwrap();
            let rel = RelPath::parse(&segs.join("/")).unwrap();
            prop_assert!(dd.resolve(&rel).unwrap().starts_with(dd.root()));
        }
    }
}
