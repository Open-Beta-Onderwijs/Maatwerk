// SPDX-License-Identifier: AGPL-3.0-or-later

//! `TypstProject` (ADR-0002 5a): what an opdracht compile can see. Either one opdracht folder on
//! disk (v2 layout, and `maatwerk-cli typst compile`), or a v1 opdracht from the shared
//! `opdrachten/` folder presented as the same virtual project. Nothing else is readable.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use time::OffsetDateTime;
use typst::foundations::{Bytes, Dict};

use super::fonts::FontStore;
use super::world::{MaatwerkWorld, Mount, WorldSpec};
use crate::assets;
use crate::paths::{DataDir, RelPath};
use crate::storage::{Expect, Storage};
use crate::{Error, Result};

/// A root folder (real or virtual), its entry file and the `sys.inputs` for one compile.
#[derive(Debug, Clone)]
pub struct TypstProject {
    main: String,
    files: Vec<(String, Bytes)>,
    mounts: Vec<Mount>,
    inputs: Option<Dict>,
}

impl TypstProject {
    /// The folder `root` is the whole project (`/` = `root`); `entry` is compiled. Links out of
    /// the folder are not followed.
    pub fn folder(root: impl Into<PathBuf>, entry: &RelPath) -> TypstProject {
        TypstProject {
            main: format!("/{}", entry.as_str()),
            files: Vec::new(),
            mounts: vec![Mount::dir("/", root)],
            inputs: None,
        }
    }

    /// A v1 opdracht, `opdrachten/<typ_file>` with its images in `opdrachten/images/<id>/`, as a
    /// virtual project (ADR-0002 5a, "order of work"):
    ///
    /// ```text
    /// /main.typ                  bundled (the old generated wrapper)
    /// /lib.typ                   bundled (the old app overwrote the data copy at every start)
    /// /opdracht.typ              opdrachten/<typ_file>
    /// /images/<id>/...           opdrachten/images/<id>/...
    /// ```
    ///
    /// The source keeps its `images/<id>/x.png` paths, so v1 files compile unchanged. Other
    /// opdrachten, student data and the rest of the data folder are not visible.
    pub fn opdracht_v1(data_dir: &DataDir, typ_file: &str) -> Result<TypstProject> {
        let id = v1_opdracht_id(typ_file)?;
        let opdrachten = data_dir.root().join("opdrachten");
        Ok(TypstProject {
            main: "/main.typ".to_owned(),
            files: vec![
                (
                    "/main.typ".to_owned(),
                    Bytes::from_string(assets::OPDRACHT_MAIN_TYP),
                ),
                ("/lib.typ".to_owned(), Bytes::from_string(assets::LIB_TYP)),
            ],
            mounts: vec![
                Mount::file("/opdracht.typ", &opdrachten, typ_file).within(data_dir.root()),
                Mount::dir(&format!("/images/{id}"), opdrachten.join("images").join(id))
                    .within(data_dir.root()),
            ],
            inputs: None,
        })
    }

    /// Serves `path` from memory instead of from disk, e.g. the editor buffer as `opdracht.typ`
    /// (the old app wrote it to `opdrachten/_preview_<file>` first).
    pub fn with_file(mut self, path: &RelPath, data: impl Into<Vec<u8>>) -> TypstProject {
        let path = format!("/{}", path.as_str());
        self.files.retain(|(p, _)| *p != path);
        self.files.push((path, Bytes::new(data.into())));
        self
    }

    /// `sys.inputs` for the compile.
    pub fn with_inputs(mut self, inputs: Dict) -> TypstProject {
        self.inputs = Some(inputs);
        self
    }

    /// The sandboxed World for one compile.
    pub fn world(self, fonts: Arc<FontStore>, now: OffsetDateTime) -> MaatwerkWorld {
        MaatwerkWorld::new(
            fonts,
            WorldSpec {
                main: self.main,
                files: self.files,
                mounts: self.mounts,
                inputs: self.inputs,
                now,
            },
        )
    }
}

impl TypstProject {
    /// The opdracht folder `opdrachten/<id>/` (C14) with `main.typ` as the entry. Only files in
    /// that folder are readable.
    pub fn opdracht(data_dir: &DataDir, id: &str) -> Result<TypstProject> {
        crate::opdracht_images::check_opdracht_id(id)?;
        let root = data_dir.root().join("opdrachten").join(id);
        Ok(TypstProject {
            main: "/main.typ".to_owned(),
            files: Vec::new(),
            mounts: vec![Mount::dir("/", root).within(data_dir.root())],
            inputs: None,
        })
    }
}

/// The files of a new opdracht folder (`app:createAssignmentTypFile`, C14): the bundled
/// `main.typ` and `lib.typ` and `opdracht.typ` from `base_assignment.typ`. Files that are
/// already there are kept.
pub fn create_opdracht_folder(storage: &Storage, id: &str) -> Result<()> {
    crate::opdracht_images::check_opdracht_id(id)?;
    for (name, text) in [
        ("main.typ", assets::OPDRACHT_MAIN_TYP),
        ("lib.typ", assets::LIB_TYP),
        ("opdracht.typ", assets::BASE_ASSIGNMENT_TYP),
    ] {
        let rel = RelPath::parse(&format!("opdrachten/{id}/{name}"))?;
        match storage.write_text(&rel, text, Expect::Missing) {
            Ok(_) | Err(Error::Conflict { .. }) => {}
            Err(e) => return Err(e),
        }
    }
    Ok(())
}

/// `opdracht_<n>.typ` -> `opdracht_<n>`. The reference accepted any bare basename
/// (`main.js:738-740`, `:820-826`); the image folder is named after the file stem.
pub fn v1_opdracht_id(typ_file: &str) -> Result<&str> {
    let invalid = |reason| Error::InvalidPath {
        path: typ_file.to_owned(),
        reason,
    };
    let rel = RelPath::parse(typ_file)?;
    if rel.as_str().contains('/') {
        return Err(invalid("expected a file name without folders"));
    }
    match Path::new(typ_file).extension().and_then(|e| e.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("typ") => {}
        _ => return Err(invalid("expected a .typ file")),
    }
    Ok(&typ_file[..typ_file.len() - 4])
}

/// What the editor knows about an opdracht's own copy of a bundled file (ADR-0002 5a).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFileStatus {
    /// `lib.typ` or `main.typ`.
    pub file: &'static str,
    pub state: ProjectFileState,
    /// The version line of the copy, if any.
    pub version: Option<u32>,
    pub bundled_version: u32,
    /// Hash of the copy as it is now (after a silent update), for a later restore (C17).
    pub hash: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProjectFileState {
    /// The current bundled version, unchanged.
    Current,
    /// An unchanged older version that was just replaced by the current one.
    Updated,
    /// Changed by the teacher; no newer bundled version than the one it started from.
    Modified,
    /// Changed by the teacher, and a newer bundled version exists ("Bekijk verschillen").
    Outdated,
    /// Not there: the opdracht does not compile until it is restored.
    Missing,
}

const PROJECT_FILES: [(&str, assets::ProjectFile); 2] = [
    ("main.typ", assets::ProjectFile::Main),
    ("lib.typ", assets::ProjectFile::Lib),
];

/// The state of `main.typ` and `lib.typ` in `opdrachten/<id>/`. An unchanged copy of an older
/// released version is replaced by the current one here, silently (ADR-0002 5a); a changed copy
/// is never touched. A colleague writing the folder at the same moment wins (C17).
pub fn check_project_files(storage: &Storage, id: &str) -> Result<Vec<ProjectFileStatus>> {
    crate::opdracht_images::check_opdracht_id(id)?;
    let mut out = Vec::new();
    for (name, file) in PROJECT_FILES {
        let rel = RelPath::parse(&format!("opdrachten/{id}/{name}"))?;
        let bundled_version = file.current_version();
        let status = |state, version, hash| ProjectFileStatus {
            file: name,
            state,
            version,
            bundled_version,
            hash,
        };
        let Some(bytes) = storage.read_bytes(&rel)? else {
            out.push(status(ProjectFileState::Missing, None, None));
            continue;
        };
        let hash = crate::storage::hash_hex(&bytes);
        let text = String::from_utf8_lossy(&bytes);
        let version = file.version_line(&text);
        out.push(match file.released_version(&text) {
            Some(v) if v == bundled_version => {
                status(ProjectFileState::Current, version, Some(hash))
            }
            Some(_) => match storage.write_text(&rel, file.bundled(), Expect::Hash(&hash)) {
                Ok(new) => status(ProjectFileState::Updated, Some(bundled_version), Some(new)),
                Err(Error::Conflict { .. }) => {
                    let now = storage
                        .read_bytes(&rel)?
                        .map(|b| crate::storage::hash_hex(&b));
                    status(ProjectFileState::Current, version, now)
                }
                Err(e) => return Err(e),
            },
            None if version.is_some_and(|v| v < bundled_version) => {
                status(ProjectFileState::Outdated, version, Some(hash))
            }
            None => status(ProjectFileState::Modified, version, Some(hash)),
        });
    }
    Ok(out)
}

/// "Herstel standaardversie": writes the bundled `main.typ` or `lib.typ` into
/// `opdrachten/<id>/` if the file still has `expected_hash` (`None`: it must be missing).
/// Returns the new hash.
pub fn restore_project_file(
    storage: &Storage,
    id: &str,
    name: &str,
    expected_hash: Option<&str>,
) -> Result<String> {
    crate::opdracht_images::check_opdracht_id(id)?;
    let (name, file) = PROJECT_FILES
        .into_iter()
        .find(|(n, _)| *n == name)
        .ok_or_else(|| Error::InvalidArgument {
            message: format!("not a bundled project file: {name}"),
        })?;
    let rel = RelPath::parse(&format!("opdrachten/{id}/{name}"))?;
    let expect = expected_hash.map_or(Expect::Missing, Expect::Hash);
    storage.write_text(&rel, file.bundled(), expect)
}

/// The bundled text of `main.typ` or `lib.typ` (for "Bekijk verschillen").
pub fn bundled_project_file(name: &str) -> Option<&'static str> {
    PROJECT_FILES
        .into_iter()
        .find(|(n, _)| *n == name)
        .map(|(_, f)| f.bundled())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn v1_ids_are_bare_typ_basenames() {
        assert_eq!(
            v1_opdracht_id("opdracht_1756713600200.typ").unwrap(),
            "opdracht_1756713600200"
        );
        for bad in [
            "../x.typ",
            "images/x.typ",
            "x.json",
            "C:/x.typ",
            "",
            ".typ/..",
        ] {
            assert!(v1_opdracht_id(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn create_fills_a_new_folder_keeps_existing_files_and_checks_the_id() {
        let tmp = tempfile::tempdir().unwrap();
        let storage =
            Storage::open_with_lock_dir(tmp.path().join("data"), &tmp.path().join("locks"))
                .unwrap();
        let typ = RelPath::parse("opdrachten/opdracht_1/opdracht.typ").unwrap();
        storage
            .write_text(&typ, "// mine", crate::storage::Expect::Any)
            .unwrap();
        create_opdracht_folder(&storage, "opdracht_1").unwrap();
        let read = |name: &str| {
            let rel = RelPath::parse(&format!("opdrachten/opdracht_1/{name}")).unwrap();
            storage.read_text(&rel).unwrap().unwrap()
        };
        assert_eq!(read("opdracht.typ"), "// mine");
        assert_eq!(read("main.typ"), assets::OPDRACHT_MAIN_TYP);
        assert_eq!(read("lib.typ"), assets::LIB_TYP);
        for bad in ["../x", "a/b", "", "x.typ"] {
            assert!(create_opdracht_folder(&storage, bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn project_files_old_unchanged_copies_update_silently_changed_ones_never() {
        let tmp = tempfile::tempdir().unwrap();
        let storage =
            Storage::open_with_lock_dir(tmp.path().join("data"), &tmp.path().join("locks"))
                .unwrap();
        create_opdracht_folder(&storage, "opdracht_1").unwrap();
        let rel = |name: &str| RelPath::parse(&format!("opdrachten/opdracht_1/{name}")).unwrap();
        let lib_v1 = include_str!("../../tests/fixtures/project-files/lib-v1.typ");

        let states = |storage: &Storage| {
            check_project_files(storage, "opdracht_1")
                .unwrap()
                .into_iter()
                .map(|s| (s.file, s.state))
                .collect::<Vec<_>>()
        };
        assert_eq!(
            states(&storage),
            [
                ("main.typ", ProjectFileState::Current),
                ("lib.typ", ProjectFileState::Current)
            ]
        );

        // An unchanged v1 copy (CRLF, as OneDrive or an editor may leave it) is updated.
        storage
            .write_text(&rel("lib.typ"), &lib_v1.replace('\n', "\r\n"), Expect::Any)
            .unwrap();
        let status = check_project_files(&storage, "opdracht_1").unwrap();
        assert_eq!(status[1].state, ProjectFileState::Updated);
        assert_eq!(status[1].version, Some(2));
        assert_eq!(
            storage.read_text(&rel("lib.typ")).unwrap().unwrap(),
            assets::LIB_TYP
        );
        assert_eq!(states(&storage)[1].1, ProjectFileState::Current);

        // A changed v1 copy is outdated and kept; a changed current copy is modified.
        let changed_v1 = lib_v1.replace("size: 10.5pt", "size: 11pt");
        storage
            .write_text(&rel("lib.typ"), &changed_v1, Expect::Any)
            .unwrap();
        assert_eq!(states(&storage)[1].1, ProjectFileState::Outdated);
        assert_eq!(
            storage.read_text(&rel("lib.typ")).unwrap().unwrap(),
            changed_v1
        );
        storage
            .write_text(&rel("main.typ"), "// mijn main", Expect::Any)
            .unwrap();
        assert_eq!(states(&storage)[0].1, ProjectFileState::Modified);

        // Restore needs the hash the editor saw; a missing file needs `None`.
        let status = check_project_files(&storage, "opdracht_1").unwrap();
        assert!(matches!(
            restore_project_file(&storage, "opdracht_1", "lib.typ", Some("stale")),
            Err(Error::Conflict { .. })
        ));
        restore_project_file(&storage, "opdracht_1", "lib.typ", status[1].hash.as_deref()).unwrap();
        assert_eq!(states(&storage)[1].1, ProjectFileState::Current);
        std::fs::remove_file(tmp.path().join("data/opdrachten/opdracht_1/main.typ")).unwrap();
        assert_eq!(states(&storage)[0].1, ProjectFileState::Missing);
        restore_project_file(&storage, "opdracht_1", "main.typ", None).unwrap();
        assert_eq!(states(&storage)[0].1, ProjectFileState::Current);

        assert!(restore_project_file(&storage, "opdracht_1", "opdracht.typ", None).is_err());
        assert!(check_project_files(&storage, "../x").is_err());
        assert_eq!(bundled_project_file("lib.typ"), Some(assets::LIB_TYP));
        assert_eq!(bundled_project_file("opdracht.typ"), None);
    }
}
