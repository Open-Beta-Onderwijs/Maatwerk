// SPDX-License-Identifier: AGPL-3.0-or-later

//! The sandboxed Typst `World` (ADR-0002 section 5). It sees three kinds of files:
//!
//! - **virtual files** held in memory (entry point, embedded templates, the data JSON);
//! - **mounts**: a virtual folder backed by a real folder, read through a path guard (lexical
//!   check with [`RelPath`], then canonicalise and prefix-check, so links cannot escape);
//! - **packages**: only the embedded ones (`assets`); nothing is downloaded.
//!
//! Anything else does not exist for Typst. Nothing is written to disk.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};

use time::{OffsetDateTime, UtcOffset};
use typst::diag::{FileError, FileResult, PackageError};
use typst::foundations::{Bytes, Datetime, Dict};
use typst::syntax::package::PackageSpec;
use typst::syntax::{FileId, Source, VirtualPath};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World};

use super::fonts::FontStore;
use crate::assets;
use crate::paths::RelPath;

/// Virtual folder for files the service provides (templates, data). Hidden in diagnostics.
pub(crate) const INTERNAL_DIR: &str = "__maatwerk";

/// A virtual folder backed by a real one, e.g. `/data/fotos` -> `<data dir>/fotos`.
#[derive(Debug, Clone)]
pub struct Mount {
    prefix: Vec<String>,
    dir: PathBuf,
}

impl Mount {
    /// `prefix` is a rooted virtual path such as `/data/fotos`.
    pub fn new(prefix: &str, dir: impl Into<PathBuf>) -> Mount {
        Mount {
            prefix: split_virtual(prefix),
            dir: dir.into(),
        }
    }
}

/// What one compile can see. Built per compile; cheap.
pub struct WorldSpec {
    /// Rooted virtual path of the entry file, e.g. `/__maatwerk/main.typ`.
    pub main: String,
    /// In-memory files by rooted virtual path.
    pub files: Vec<(String, Bytes)>,
    pub mounts: Vec<Mount>,
    /// `sys.inputs` (opdracht runtime data, Step 5b).
    pub inputs: Option<Dict>,
    /// The clock behind `datetime.today()`.
    pub now: OffsetDateTime,
}

pub struct MaatwerkWorld {
    library: LazyHash<Library>,
    fonts: Arc<FontStore>,
    main: FileId,
    files: HashMap<String, Bytes>,
    mounts: Vec<(Mount, Option<PathBuf>)>,
    now: OffsetDateTime,
    bytes: Mutex<HashMap<FileId, FileResult<Bytes>>>,
    sources: Mutex<HashMap<FileId, FileResult<Source>>>,
}

impl MaatwerkWorld {
    pub fn new(fonts: Arc<FontStore>, spec: WorldSpec) -> MaatwerkWorld {
        let mut builder = Library::builder();
        if let Some(inputs) = spec.inputs {
            builder = builder.with_inputs(inputs);
        }
        let files = spec
            .files
            .into_iter()
            .map(|(path, data)| (split_virtual(&path).join("/"), data))
            .collect();
        // Canonicalised once; a missing folder simply has no files.
        let mounts = spec
            .mounts
            .into_iter()
            .map(|m| {
                let real = m.dir.canonicalize().ok();
                (m, real)
            })
            .collect();
        MaatwerkWorld {
            library: LazyHash::new(builder.build()),
            fonts,
            main: FileId::new(None, VirtualPath::new(&spec.main)),
            files,
            mounts,
            now: spec.now,
            bytes: Mutex::new(HashMap::new()),
            sources: Mutex::new(HashMap::new()),
        }
    }

    /// The clock behind `datetime.today()` and the PDF creation date.
    pub fn now(&self) -> OffsetDateTime {
        self.now
    }

    /// How a file is named in diagnostics: package files as `@preview/x:1.0.0/src/a.typ`,
    /// own files relative to the root, internal files by their name only.
    pub fn display_path(&self, id: FileId) -> String {
        let parts = vpath_parts(id.vpath()).unwrap_or_default().join("/");
        match id.package() {
            Some(spec) => format!("{spec}/{parts}"),
            None => parts
                .strip_prefix(&format!("{INTERNAL_DIR}/"))
                .map(str::to_owned)
                .unwrap_or(parts),
        }
    }

    fn load(&self, id: FileId) -> FileResult<Bytes> {
        let parts = vpath_parts(id.vpath()).ok_or(FileError::AccessDenied)?;
        // The virtual path with `/`, never a machine path (T14).
        let shown = || PathBuf::from(format!("/{}", parts.join("/")));
        if let Some(spec) = id.package() {
            return load_package(spec, &parts, shown());
        }
        if let Some(data) = self.files.get(&parts.join("/")) {
            return Ok(data.clone());
        }
        for (mount, real) in &self.mounts {
            let n = mount.prefix.len();
            if parts.len() > n && parts[..n] == mount.prefix[..] {
                let Some(root) = real else {
                    return Err(FileError::NotFound(shown()));
                };
                return load_mounted(root, &parts[n..], &shown());
            }
        }
        Err(FileError::NotFound(shown()))
    }
}

/// Reads `<root>/<rest>` if it really lies inside `root` (`root` is canonical).
fn load_mounted(root: &Path, rest: &[String], shown: &Path) -> FileResult<Bytes> {
    let rel = RelPath::parse(&rest.join("/")).map_err(|_| FileError::AccessDenied)?;
    let mut path = root.to_path_buf();
    path.extend(rel.as_str().split('/'));
    let real = path
        .canonicalize()
        .map_err(|e| FileError::from_io(e, shown))?;
    if !real.starts_with(root) {
        return Err(FileError::AccessDenied);
    }
    if real.is_dir() {
        return Err(FileError::IsDirectory);
    }
    std::fs::read(&real)
        .map(Bytes::new)
        .map_err(|e| FileError::from_io(e, shown))
}

fn load_package(spec: &PackageSpec, parts: &[String], shown: PathBuf) -> FileResult<Bytes> {
    let (namespace, name, version) = (
        spec.namespace.as_str(),
        spec.name.as_str(),
        spec.version.to_string(),
    );
    let key = format!("{namespace}/{name}/{version}/{}", parts.join("/"));
    if let Some(data) = assets::package_file(&key) {
        return Ok(Bytes::new(data));
    }
    if !assets::has_package(namespace, name, &version) {
        return Err(FileError::Package(PackageError::NotFound(spec.clone())));
    }
    Err(FileError::NotFound(shown))
}

/// Normal components of a virtual path (`VirtualPath` already resolved `.` and `..`).
fn vpath_parts(vpath: &VirtualPath) -> Option<Vec<String>> {
    vpath
        .as_rooted_path()
        .components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_str().map(str::to_owned)),
            _ => None,
        })
        .collect()
}

fn split_virtual(path: &str) -> Vec<String> {
    path.split('/')
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .collect()
}

/// UTF-8 with an optional BOM, as the Typst CLI accepts it.
fn decode_utf8(data: &[u8]) -> FileResult<&str> {
    let data = data.strip_prefix(b"\xef\xbb\xbf").unwrap_or(data);
    std::str::from_utf8(data).map_err(|_| FileError::InvalidUtf8)
}

impl World for MaatwerkWorld {
    fn library(&self) -> &LazyHash<Library> {
        &self.library
    }

    fn book(&self) -> &LazyHash<FontBook> {
        self.fonts.book()
    }

    fn main(&self) -> FileId {
        self.main
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        let mut sources = self.sources.lock().unwrap_or_else(|e| e.into_inner());
        sources
            .entry(id)
            .or_insert_with(|| {
                let data = self.file(id)?;
                Ok(Source::new(id, decode_utf8(&data)?.to_owned()))
            })
            .clone()
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        let mut bytes = self.bytes.lock().unwrap_or_else(|e| e.into_inner());
        bytes.entry(id).or_insert_with(|| self.load(id)).clone()
    }

    fn font(&self, index: usize) -> Option<Font> {
        self.fonts.font(index)
    }

    fn today(&self, offset: Option<i64>) -> Option<Datetime> {
        let now = match offset {
            None => self.now,
            Some(hours) => {
                let hours = i8::try_from(hours).ok()?;
                self.now.to_offset(UtcOffset::from_hms(hours, 0, 0).ok()?)
            }
        };
        Datetime::from_ymd(now.year(), now.month().into(), now.day())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn world(mounts: Vec<Mount>) -> MaatwerkWorld {
        MaatwerkWorld::new(
            Arc::new(FontStore::new(false)),
            WorldSpec {
                main: "/__maatwerk/main.typ".into(),
                files: vec![("/__maatwerk/main.typ".into(), Bytes::new(b"hi".to_vec()))],
                mounts,
                inputs: None,
                now: OffsetDateTime::UNIX_EPOCH,
            },
        )
    }

    fn id(path: &str) -> FileId {
        FileId::new(None, VirtualPath::new(path))
    }

    #[test]
    fn serves_virtual_files_and_hides_the_internal_folder_in_names() {
        let w = world(vec![]);
        assert_eq!(w.file(w.main()).unwrap().as_slice(), b"hi");
        assert_eq!(w.display_path(w.main()), "main.typ");
        assert!(matches!(
            w.file(id("/elsewhere.typ")),
            Err(FileError::NotFound(_))
        ));
    }

    #[test]
    fn mounts_read_inside_and_reject_dot_dot() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("fotos")).unwrap();
        std::fs::write(dir.path().join("fotos/a.svg"), "<svg/>").unwrap();
        std::fs::write(dir.path().join("secret.json"), "{}").unwrap();
        let w = world(vec![Mount::new("/data/fotos", dir.path().join("fotos"))]);
        assert_eq!(
            w.file(id("/data/fotos/a.svg")).unwrap().as_slice(),
            b"<svg/>"
        );
        // `..` is resolved lexically by VirtualPath, so this asks for /data/secret.json, which
        // is not mounted.
        assert!(w.file(id("/data/fotos/../secret.json")).is_err());
        assert!(w.file(id("/data/secret.json")).is_err());
        assert!(matches!(
            w.file(id("/data/fotos")),
            Err(FileError::NotFound(_))
        ));
    }

    #[test]
    fn a_missing_mount_folder_has_no_files() {
        let dir = tempfile::tempdir().unwrap();
        let w = world(vec![Mount::new("/data/fotos", dir.path().join("nope"))]);
        let err = w.file(id("/data/fotos/a.svg")).unwrap_err();
        assert_eq!(
            err.to_string(),
            "file not found (searched at /data/fotos/a.svg)"
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_junction_out_of_a_mount_is_denied() {
        let dir = tempfile::tempdir().unwrap();
        let outside = dir.path().join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("x.svg"), "<svg/>").unwrap();
        std::fs::create_dir_all(dir.path().join("fotos")).unwrap();
        let link = dir.path().join("fotos").join("link");
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(&outside)
            .output()
            .unwrap();
        assert!(status.status.success());
        let w = world(vec![Mount::new("/data/fotos", dir.path().join("fotos"))]);
        assert!(matches!(
            w.file(id("/data/fotos/link/x.svg")),
            Err(FileError::AccessDenied)
        ));
    }

    #[test]
    fn packages_come_only_from_the_embedded_set() {
        let w = world(vec![]);
        let spec: PackageSpec = "@preview/zero:0.7.1".parse().unwrap();
        let zero = FileId::new(Some(spec.clone()), VirtualPath::new("/src/zero.typ"));
        assert!(w.source(zero).is_ok());
        assert_eq!(w.display_path(zero), "@preview/zero:0.7.1/src/zero.typ");
        let missing = FileId::new(Some(spec), VirtualPath::new("/nope.typ"));
        assert!(matches!(w.file(missing), Err(FileError::NotFound(_))));
        let other: PackageSpec = "@preview/zero:0.7.0".parse().unwrap();
        let other = FileId::new(Some(other), VirtualPath::new("/typst.toml"));
        assert!(matches!(
            w.file(other),
            Err(FileError::Package(PackageError::NotFound(_)))
        ));
    }

    #[test]
    fn today_uses_the_injected_clock() {
        let w = world(vec![]);
        let today = w.today(None).unwrap();
        assert_eq!(
            (today.year(), today.month(), today.day()),
            (Some(1970), Some(1), Some(1))
        );
        let behind = w.today(Some(-1)).unwrap();
        assert_eq!(behind.day(), Some(31));
    }
}
