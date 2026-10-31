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
}
