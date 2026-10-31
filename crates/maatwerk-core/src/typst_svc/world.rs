// SPDX-License-Identifier: AGPL-3.0-or-later

//! The sandboxed Typst `World` (ADR-0002 section 5). It sees three kinds of files:
//!
//! - **virtual files** held in memory (entry point, embedded templates, the data JSON);
//! - **mounts**: a virtual folder backed by a real folder, read through a path guard (lexical
//!   check with [`RelPath`], then canonicalise and prefix-check, so links cannot escape);
//! - **packages**: only the embedded ones (`assets`); nothing is downloaded.
//!
//! Anything else does not exist for Typst. Nothing is written to disk.
//!
//! A World is usually built per compile. The editor (Step 8a) keeps one alive across compiles:
//! [`MaatwerkWorld::set_file`] replaces an in-memory file (incremental reparse), and
//! [`MaatwerkWorld::reset`] re-checks the files read from disk before the next compile.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

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

/// A virtual folder backed by a real one, e.g. `/data/fotos` -> `<data dir>/fotos`, or a single
/// virtual file backed by a real file. Built by the per-kind constructors ([`TypstProject`],
/// `rapport_world`), never by callers (review 5a n6).
///
/// [`TypstProject`]: super::TypstProject
#[derive(Debug, Clone)]
pub(crate) struct Mount {
    prefix: Vec<String>,
    dir: PathBuf,
    /// `Some(name)`: the mount is the one file `<dir>/<name>`, seen at `prefix`.
    file: Option<String>,
    /// The canonical `dir` must lie inside this folder (the data dir), or the mount is empty
    /// (review 5a n2: `fotos` itself could be a junction).
    within: Option<PathBuf>,
}

impl Mount {
    /// `prefix` is a rooted virtual path such as `/data/fotos`; `/` mounts a whole folder.
    pub(crate) fn dir(prefix: &str, dir: impl Into<PathBuf>) -> Mount {
        Mount {
            prefix: split_virtual(prefix),
            dir: dir.into(),
            file: None,
            within: None,
        }
    }

    /// The single file `<dir>/<name>` at the virtual path `path`. `name` is a checked basename.
    pub(crate) fn file(path: &str, dir: impl Into<PathBuf>, name: &str) -> Mount {
        Mount {
            file: Some(name.to_owned()),
            ..Mount::dir(path, dir)
        }
    }

    /// Restricts the mount to folders inside `root`.
    pub(crate) fn within(mut self, root: &Path) -> Mount {
        self.within = Some(root.to_path_buf());
        self
    }

    /// The canonical folder behind the mount, if it exists and lies inside `within`.
    fn resolve(&self) -> Option<PathBuf> {
        let real = self.dir.canonicalize().ok()?;
        match &self.within {
            Some(root) if !real.starts_with(root.canonicalize().ok()?) => None,
            _ => Some(real),
        }
    }
}

/// What one compile can see. Built per compile; cheap.
pub(crate) struct WorldSpec {
    /// Rooted virtual path of the entry file, e.g. `/__maatwerk/main.typ`.
    pub main: String,
    /// In-memory files by rooted virtual path; they shadow mounts.
    pub files: Vec<(String, Bytes)>,
    pub mounts: Vec<Mount>,
    /// `sys.inputs` (opdracht runtime data).
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
    slots: Mutex<HashMap<FileId, FileSlot>>,
}

/// A file Typst asked for: its bytes, its parsed source once asked for, and where it came from.
struct FileSlot {
    origin: Origin,
    bytes: FileResult<Bytes>,
    source: Option<FileResult<Source>>,
}

/// Where a file's bytes came from, for [`MaatwerkWorld::reset`].
enum Origin {
    /// In memory or an embedded package: changes only through [`MaatwerkWorld::set_file`].
    Fixed,
    /// A mounted file; changed on disk when the fingerprint differs.
    Disk(PathBuf, Fingerprint),
    /// Not found or unreadable on disk: looked up again after a reset.
    Missing,
}

/// Modification time and length: enough to notice a file replaced on disk without reading it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Fingerprint(Option<SystemTime>, u64);

impl Fingerprint {
    fn of(path: &Path) -> Option<Fingerprint> {
        let meta = std::fs::metadata(path).ok()?;
        Some(Fingerprint(meta.modified().ok(), meta.len()))
    }
}

impl MaatwerkWorld {
    pub(crate) fn new(fonts: Arc<FontStore>, spec: WorldSpec) -> MaatwerkWorld {
        let mut builder = Library::builder();
        if let Some(inputs) = spec.inputs {
            builder = builder.with_inputs(inputs);
        }
        let files = spec
            .files
            .into_iter()
            .map(|(path, data)| (virtual_key(&path), data))
            .collect();
        // Canonicalised once; a missing folder simply has no files.
        let mounts = spec
            .mounts
            .into_iter()
            .map(|m| {
                let real = m.resolve();
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
            slots: Mutex::new(HashMap::new()),
        }
    }

    /// The clock behind `datetime.today()` and the PDF creation date.
    pub fn now(&self) -> OffsetDateTime {
        self.now
    }

    pub(crate) fn set_now(&mut self, now: OffsetDateTime) {
        self.now = now;
    }

    /// Serves `path` (rooted virtual path) from memory from now on, shadowing a mount. A source
    /// Typst already parsed is updated in place: `Source::replace` reparses incrementally and
    /// keeps the spans of the unchanged parts.
    pub(crate) fn set_file(&mut self, path: &str, data: Bytes) {
        let key = virtual_key(path);
        let id = FileId::new(None, VirtualPath::new(format!("/{key}")));
        if let Some(slot) = self.slots_mut().get_mut(&id) {
            slot.source = match (slot.source.take(), decode_utf8(&data)) {
                (Some(Ok(mut source)), Ok(text)) => {
                    source.replace(text);
                    Some(Ok(source))
                }
                _ => None,
            };
            slot.origin = Origin::Fixed;
            slot.bytes = Ok(data.clone());
        }
        self.files.insert(key, data);
    }

    /// Before the next compile of a long-lived World: mount folders are resolved again (a folder
    /// created since, such as a first image folder, becomes visible), files that changed on disk
    /// and files that were missing are read again on their next use. Unchanged files keep their
    /// bytes and sources, so Typst's caches stay valid for them.
    pub(crate) fn reset(&mut self) {
        let mut moved = false;
        for (mount, real) in &mut self.mounts {
            let resolved = mount.resolve();
            moved |= resolved != *real;
            *real = resolved;
        }
        self.slots_mut().retain(|_, slot| match &slot.origin {
            Origin::Fixed => true,
            Origin::Missing => false,
            Origin::Disk(..) if moved => false,
            Origin::Disk(path, print) => Fingerprint::of(path) == Some(*print),
        });
    }

    /// Drops every file read from disk, so the next compile reads it again.
    pub(crate) fn forget_disk_files(&mut self) {
        self.slots_mut()
            .retain(|_, slot| matches!(slot.origin, Origin::Fixed));
    }

    /// The number of files the World holds (tests: a long session must not grow).
    #[cfg(test)]
    pub(crate) fn cached_files(&mut self) -> usize {
        self.slots_mut().len()
    }

    fn slots_mut(&mut self) -> &mut HashMap<FileId, FileSlot> {
        self.slots.get_mut().unwrap_or_else(|e| e.into_inner())
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

    fn load(&self, id: FileId) -> FileSlot {
        let (origin, bytes) = match self.read(id) {
            Ok((data, Some((path, print)))) => (Origin::Disk(path, print), Ok(data)),
            Ok((data, None)) => (Origin::Fixed, Ok(data)),
            Err(e) if id.package().is_some() => (Origin::Fixed, Err(e)),
            Err(e) => (Origin::Missing, Err(e)),
        };
        FileSlot {
            origin,
            bytes,
            source: None,
        }
    }

    /// The bytes of `id` and, for a file on disk, its real path and fingerprint.
    fn read(&self, id: FileId) -> FileResult<(Bytes, Option<(PathBuf, Fingerprint)>)> {
        let parts = vpath_parts(id.vpath()).ok_or(FileError::AccessDenied)?;
        // The virtual path with `/`, never a machine path (T14).
        let shown = || PathBuf::from(format!("/{}", parts.join("/")));
        if let Some(spec) = id.package() {
            return load_package(spec, &parts, shown()).map(|data| (data, None));
        }
        if let Some(data) = self.files.get(&parts.join("/")) {
            return Ok((data.clone(), None));
        }
        for (mount, real) in &self.mounts {
            let n = mount.prefix.len();
            let rest = match &mount.file {
                Some(name) if parts == mount.prefix => vec![name.clone()],
                None if parts.len() > n && parts[..n] == mount.prefix[..] => parts[n..].to_vec(),
                _ => continue,
            };
            let Some(root) = real else {
                return Err(FileError::NotFound(shown()));
            };
            return load_mounted(root, &rest, &shown())
                .map(|(data, real, print)| (data, Some((real, print))));
        }
        Err(FileError::NotFound(shown()))
    }
}

/// Reads `<root>/<rest>` if it really lies inside `root` (`root` is canonical). Also returns the
/// real path and its fingerprint, taken before the read (a write during the read then shows as
/// a change at the next reset).
fn load_mounted(
    root: &Path,
    rest: &[String],
    shown: &Path,
) -> FileResult<(Bytes, PathBuf, Fingerprint)> {
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
    let print = Fingerprint::of(&real).ok_or_else(|| FileError::NotFound(shown.into()))?;
    let data = std::fs::read(&real).map_err(|e| FileError::from_io(e, shown))?;
    Ok((Bytes::new(data), real, print))
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

/// Normal components of a virtual path. `VirtualPath` resolves `.` and inner `..`; a `..` left
/// above the root or a drive prefix (`C:`) makes the path invalid instead of being dropped
/// silently (review 5a n1).
fn vpath_parts(vpath: &VirtualPath) -> Option<Vec<String>> {
    vpath
        .as_rooted_path()
        .components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_str().map(str::to_owned)),
            Component::RootDir | Component::CurDir => None,
            Component::ParentDir | Component::Prefix(_) => Some(None),
        })
        .collect()
}

/// The key of an in-memory file: the normal components of its virtual path joined by `/`.
fn virtual_key(path: &str) -> String {
    split_virtual(path).join("/")
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
        let mut slots = self.slots.lock().unwrap_or_else(|e| e.into_inner());
        let slot = slots.entry(id).or_insert_with(|| self.load(id));
        let bytes = &slot.bytes;
        slot.source
            .get_or_insert_with(|| {
                let data = bytes.as_ref().map_err(Clone::clone)?;
                Ok(Source::new(id, decode_utf8(data)?.to_owned()))
            })
            .clone()
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        let mut slots = self.slots.lock().unwrap_or_else(|e| e.into_inner());
        slots
            .entry(id)
            .or_insert_with(|| self.load(id))
            .bytes
            .clone()
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
        let w = world(vec![Mount::dir("/data/fotos", dir.path().join("fotos"))]);
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
        let w = world(vec![Mount::dir("/data/fotos", dir.path().join("nope"))]);
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
        let w = world(vec![Mount::dir("/data/fotos", dir.path().join("fotos"))]);
        assert!(matches!(
            w.file(id("/data/fotos/link/x.svg")),
            Err(FileError::AccessDenied)
        ));
    }

    #[test]
    fn review_n1_dot_dot_above_the_root_and_drive_prefixes_are_denied() {
        let w = world(vec![]);
        for path in ["/../../Windows/win.ini", "/data/../../x.typ"] {
            assert!(
                matches!(w.file(id(path)), Err(FileError::AccessDenied)),
                "{path}"
            );
        }
    }

    #[test]
    fn a_file_mount_serves_exactly_one_file() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("opdracht_1.typ"), "een").unwrap();
        std::fs::write(dir.path().join("opdracht_2.typ"), "twee").unwrap();
        let w = world(vec![Mount::file(
            "/opdracht.typ",
            dir.path(),
            "opdracht_1.typ",
        )]);
        assert_eq!(w.file(id("/opdracht.typ")).unwrap().as_slice(), b"een");
        assert!(w.file(id("/opdracht_2.typ")).is_err());
        assert!(w.file(id("/opdracht.typ/x")).is_err());
    }

    #[test]
    fn review_n2_a_mount_outside_its_boundary_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        let outside = dir.path().join("outside");
        std::fs::create_dir_all(&data).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("a.svg"), "<svg/>").unwrap();
        let w = world(vec![Mount::dir("/data/fotos", &outside).within(&data)]);
        assert!(matches!(
            w.file(id("/data/fotos/a.svg")),
            Err(FileError::NotFound(_))
        ));
        let w = world(vec![Mount::dir("/data/fotos", &outside).within(dir.path())]);
        assert!(w.file(id("/data/fotos/a.svg")).is_ok());
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
