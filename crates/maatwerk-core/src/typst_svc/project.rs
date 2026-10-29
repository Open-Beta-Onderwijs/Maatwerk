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
use crate::storage::Storage;
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

/// Writes the base template to `opdrachten/<typ_file>`, replacing what is there
/// (`app:createAssignmentTypFile`). Unlike the reference, `typ_file` must be a bare `.typ` name.
pub fn create_v1_opdracht_file(storage: &Storage, typ_file: &str) -> Result<()> {
    v1_opdracht_id(typ_file)?;
    let rel = RelPath::parse(&format!("opdrachten/{typ_file}"))?;
    storage.write_text(&rel, assets::BASE_ASSIGNMENT_TYP)
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
    fn create_writes_the_base_template_and_checks_the_name() {
        let tmp = tempfile::tempdir().unwrap();
        let storage =
            Storage::open_with_lock_dir(tmp.path().join("data"), &tmp.path().join("locks"))
                .unwrap();
        create_v1_opdracht_file(&storage, "opdracht_1.typ").unwrap();
        let rel = RelPath::parse("opdrachten/opdracht_1.typ").unwrap();
        assert_eq!(
            storage.read_text(&rel).unwrap().unwrap(),
            assets::BASE_ASSIGNMENT_TYP
        );
        for bad in ["../x.typ", "images/x.typ", "x.json"] {
            assert!(create_v1_opdracht_file(&storage, bad).is_err(), "{bad}");
        }
    }
}
