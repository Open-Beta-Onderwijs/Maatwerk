// SPDX-License-Identifier: AGPL-3.0-or-later

//! Toepassen and Ongedaan maken for a proposal's images (decisions 53, 68; review 32 M4). The
//! text goes back to the editor, which records it as one undo step; Toepassen only checks the
//! chosen images ([`chosen_images`]). The editor stores them with its next save of the text
//! (review 32 m4): they are written into the opdracht's `images/` here, and every image they
//! replace is kept in an undo folder of the run (local app data) so Ongedaan maken can put it
//! back.
//!
//! The first backup of a name wins: applying the same proposal twice, then undoing, restores
//! the teacher's original, not the AI's first copy. An undo removes the backups it used.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{Error, Result};
use crate::opdracht_images::{self, Stored, extension_of, stem_of};
use crate::storage::Storage;

use super::diff::{self, ImageProposal, Proposal};

/// An image written by [`apply_images`]: `images/<file>`, and whether it was new.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppliedImage {
    pub path: String,
    pub new: bool,
}

fn io(what: &Path) -> impl Fn(std::io::Error) -> Error + '_ {
    move |e| Error::io(what.display().to_string(), e)
}

fn invalid(message: String) -> Error {
    Error::InvalidArgument { message }
}

/// The backups in `undo` whose name (without extension) is `stem`, in any case.
fn backups_of(undo: &Path, stem: &str) -> Vec<PathBuf> {
    fs::read_dir(undo)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| stem_of(n).eq_ignore_ascii_case(stem))
        })
        .collect()
}

/// Toepassen's texts and images, nothing written (decision 68).
#[derive(Debug)]
pub struct ProposalApplied<'a> {
    /// File -> the chosen hunks on its current text.
    pub files: BTreeMap<String, diff::Applied>,
    pub images: Vec<&'a ImageProposal>,
}

impl ProposalApplied<'_> {
    /// Only a proposal of which something was taken counts as applied (review 32 n8).
    pub fn takes_something(&self) -> bool {
        !self.images.is_empty() || self.files.values().any(|a| !a.applied.is_empty())
    }
}

/// The chosen `hunks` (per file) onto `current` (the editor's buffers; a missing file is its
/// base) and the chosen `images`, checked.
pub fn apply_proposal<'a>(
    proposal: &'a Proposal,
    current: &BTreeMap<String, String>,
    hunks: &BTreeMap<String, Vec<u32>>,
    images: &[String],
) -> Result<ProposalApplied<'a>> {
    let mut files = BTreeMap::new();
    for f in &proposal.files {
        let Some(chosen) = hunks.get(&f.path) else {
            continue;
        };
        let chosen: Vec<usize> = chosen.iter().map(|&h| h as usize).collect();
        let cur = current.get(&f.path).map_or(f.base.as_str(), String::as_str);
        files.insert(f.path.clone(), diff::apply(f, cur, &chosen));
    }
    Ok(ProposalApplied {
        files,
        images: chosen_images(proposal, images)?,
    })
}

/// The chosen images of `proposal` (paths as in [`Proposal::images`]), checked, without
/// writing anything; an unknown path is refused.
pub fn chosen_images<'a>(
    proposal: &'a Proposal,
    images: &[String],
) -> Result<Vec<&'a ImageProposal>> {
    images
        .iter()
        .map(|path| {
            proposal
                .images
                .iter()
                .find(|i| &i.path == path)
                .ok_or_else(|| invalid(format!("{path} hoort niet bij het voorstel.")))
        })
        .collect()
}

/// Writes the chosen images of `proposal` (paths as in [`Proposal::images`]) into the opdracht,
/// keeping what they replace in `undo` (only the first time per name).
pub fn apply_images(
    storage: &Storage,
    opdracht_id: &str,
    proposal: &Proposal,
    images: &[String],
    undo: &Path,
) -> Result<Vec<AppliedImage>> {
    let mut saved = Vec::new();
    for path in images {
        let Some(img) = proposal.images.iter().find(|i| &i.path == path) else {
            return Err(invalid(format!("{path} hoort niet bij het voorstel.")));
        };
        let file = path.trim_start_matches("images/");
        let (name, ext) = (stem_of(file), extension_of(file));
        let existing: Vec<_> = opdracht_images::list(storage, opdracht_id)?
            .into_iter()
            .filter(|i| i.name.eq_ignore_ascii_case(name))
            .collect();
        if backups_of(undo, name).is_empty() {
            for old in &existing {
                let rel = opdracht_images::folder(opdracht_id)?.join(&old.file)?;
                if let Some(bytes) = storage.read_bytes(&rel)? {
                    fs::create_dir_all(undo).map_err(io(undo))?;
                    let target = undo.join(old.file.trim_start_matches("images/"));
                    fs::write(&target, bytes).map_err(io(&target))?;
                }
            }
        }
        let bytes = fs::read(&img.source).map_err(io(&img.source))?;
        match opdracht_images::store(storage, opdracht_id, name, &ext, &bytes, true)? {
            Stored::Saved { file, .. } => saved.push(AppliedImage {
                path: file,
                new: existing.is_empty(),
            }),
            Stored::Exists { .. } => {}
            Stored::Rejected { message } => return Err(invalid(message)),
        }
    }
    Ok(saved)
}

/// Removes the images [`apply_images`] wrote and puts back the ones they replaced.
pub fn undo_images(
    storage: &Storage,
    opdracht_id: &str,
    images: &[String],
    undo: &Path,
) -> Result<()> {
    let folder = opdracht_images::folder(opdracht_id)?.join("images")?;
    for path in images {
        let file = path.trim_start_matches("images/");
        if file.is_empty() || file.contains(['/', '\\']) {
            return Err(invalid("Ongeldige afbeelding.".into()));
        }
        storage.delete(&folder.join(file)?)?;
        for b in backups_of(undo, stem_of(file)) {
            let name = b
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default()
                .to_owned();
            let bytes = fs::read(&b).map_err(io(&b))?;
            match opdracht_images::store(
                storage,
                opdracht_id,
                stem_of(&name),
                &extension_of(&name),
                &bytes,
                true,
            )? {
                Stored::Rejected { message } => return Err(invalid(message)),
                _ => fs::remove_file(&b).map_err(io(&b))?,
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::RelPath;

    fn storage() -> (tempfile::TempDir, Storage) {
        let tmp = tempfile::tempdir().unwrap();
        let locks = tmp.path().join("locks");
        let storage = Storage::open_with_lock_dir(tmp.path().join("data"), &locks).unwrap();
        (tmp, storage)
    }

    fn svg(fill: &str) -> Vec<u8> {
        format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"4\" height=\"4\"><rect width=\"4\" height=\"4\" fill=\"{fill}\"/></svg>"
        )
        .into_bytes()
    }

    fn read(storage: &Storage, file: &str) -> Option<Vec<u8>> {
        storage
            .read_bytes(&RelPath::parse(&format!("opdrachten/opd-1/images/{file}")).unwrap())
            .unwrap()
    }

    fn proposal(tmp: &Path, fill: &str) -> Proposal {
        let source = tmp.join(format!("ai-{fill}.svg"));
        fs::write(&source, svg(fill)).unwrap();
        Proposal {
            files: Vec::new(),
            images: vec![ImageProposal {
                path: "images/kring.svg".into(),
                new: false,
                source,
                placeholder: false,
            }],
            skipped: Vec::new(),
        }
    }

    #[test]
    fn apply_twice_then_undo_restores_the_teachers_image() {
        let (tmp, s) = storage();
        let id = "opd-1";
        opdracht_images::store(&s, id, "kring", "svg", &svg("blue"), true).unwrap();
        let undo = tmp.path().join("run/undo");
        let chosen = ["images/kring.svg".to_owned()];
        let first = apply_images(&s, id, &proposal(tmp.path(), "red"), &chosen, &undo).unwrap();
        assert_eq!(
            first,
            [AppliedImage {
                path: "images/kring.svg".into(),
                new: false
            }]
        );
        apply_images(&s, id, &proposal(tmp.path(), "green"), &chosen, &undo).unwrap();
        assert_eq!(read(&s, "kring.svg").unwrap(), svg("green"));
        undo_images(&s, id, &chosen, &undo).unwrap();
        assert_eq!(read(&s, "kring.svg").unwrap(), svg("blue"));
        // The backup is used up: a second undo removes the image, it does not restore again.
        assert!(backups_of(&undo, "kring").is_empty());
    }

    #[test]
    fn a_new_image_is_removed_by_undo() {
        let (tmp, s) = storage();
        let undo = tmp.path().join("run/undo");
        let chosen = ["images/kring.svg".to_owned()];
        let applied =
            apply_images(&s, "opd-1", &proposal(tmp.path(), "red"), &chosen, &undo).unwrap();
        assert!(applied[0].new);
        undo_images(&s, "opd-1", &chosen, &undo).unwrap();
        assert!(read(&s, "kring.svg").is_none());
    }

    /// Review 32 n8 (review 40 n8: in core): only a proposal of which something was taken
    /// counts as applied; a hunk that no longer fits is a conflict.
    #[test]
    fn apply_proposal_counts_what_was_taken() {
        let tmp = tempfile::tempdir().unwrap();
        let mut p = proposal(tmp.path(), "red");
        p.files.push(diff::FileProposal {
            path: "opdracht.typ".into(),
            base: "a\nb\n".into(),
            proposed: "a\nB\n".into(),
            hunks: diff::hunks("a\nb\n", "a\nB\n"),
        });
        let none = BTreeMap::new();
        let all = BTreeMap::from([("opdracht.typ".to_owned(), vec![0u32])]);
        let current = BTreeMap::from([("opdracht.typ".to_owned(), "a\nb\n".to_owned())]);
        assert!(
            !apply_proposal(&p, &current, &none, &[])
                .unwrap()
                .takes_something()
        );
        let done = apply_proposal(&p, &current, &all, &[]).unwrap();
        assert!(done.takes_something());
        assert_eq!(done.files["opdracht.typ"].text, "a\nB\n");
        let typed = BTreeMap::from([("opdracht.typ".to_owned(), "a\nX\n".to_owned())]);
        let conflict = apply_proposal(&p, &typed, &all, &[]).unwrap();
        assert!(!conflict.takes_something());
        assert_eq!(conflict.files["opdracht.typ"].conflicts, [0]);
        let img = apply_proposal(&p, &current, &none, &["images/kring.svg".into()]).unwrap();
        assert!(img.takes_something());
    }

    #[test]
    fn refuses_images_outside_the_proposal_and_bad_names() {
        let (tmp, s) = storage();
        let undo = tmp.path().join("run/undo");
        let p = proposal(tmp.path(), "red");
        assert!(chosen_images(&p, &["images/other.svg".into()]).is_err());
        let chosen = chosen_images(&p, &["images/kring.svg".into()]).unwrap();
        assert_eq!(chosen[0].path, "images/kring.svg");
        // Checking writes nothing (review 32 m4).
        assert!(read(&s, "kring.svg").is_none());
        assert!(apply_images(&s, "opd-1", &p, &["images/other.svg".into()], &undo).is_err());
        assert!(undo_images(&s, "opd-1", &["images/../x.svg".into()], &undo).is_err());
        assert!(undo_images(&s, "../x", &["images/x.svg".into()], &undo).is_err());
    }
}
