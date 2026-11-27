// SPDX-License-Identifier: AGPL-3.0-or-later

//! The printed copies in `rapporten/<schooljaar>/` next to the data folder (C18, X-06, PLAN-2
//! decision 85): how much room they take, per school year, and "Opruimen", which deletes the
//! copies of the school years before a chosen one. Nothing happens automatically.
//!
//! Only what [`crate::outputs::print_copy`] makes is counted or deleted: `*.pdf` files directly
//! in a folder named like a school year (`2025-2026`). Other files and folders, and links of any
//! kind, are left alone: the shared folder is the school's, not only the app's.

use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::outputs::shared_dir;
use crate::paths::{RelPath, is_year_name};
use crate::storage::Storage;
use crate::{Error, Result};

/// The folder of the printed copies, in the shared folder.
pub const DIR: &str = "rapporten";

/// The printed copies of one school year.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YearCopies {
    /// `2025-2026`.
    pub schooljaar: String,
    pub files: u64,
    pub bytes: u64,
}

/// Every school year's copies, oldest first.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub years: Vec<YearCopies>,
}

/// What [`cleanup`] did.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cleanup {
    pub files: u64,
    pub bytes: u64,
    /// `rapporten/<jaar>/<name>.pdf` of the copies that could not be deleted (open in a viewer,
    /// held by OneDrive): the rest is deleted anyway.
    pub failed: Vec<String>,
}

/// A printed copy: a regular file (not a link) named `*.pdf`.
fn is_copy(path: &Path, name: &str) -> Option<u64> {
    let meta = fs::symlink_metadata(path).ok()?;
    let pdf = name.len() > 4 && name[name.len() - 4..].eq_ignore_ascii_case(".pdf");
    (meta.file_type().is_file() && pdf).then_some(meta.len())
}

/// The school-year folders under `rapporten/` (real folders, not links), oldest first.
fn year_dirs(storage: &Storage) -> Result<Vec<(String, std::path::PathBuf)>> {
    let shared = shared_dir(storage)?;
    let dir = shared.resolve(&RelPath::parse(DIR)?)?;
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(Error::io(DIR, e)),
    };
    let mut out = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| Error::io(DIR, e))?;
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        let real_dir = fs::symlink_metadata(entry.path()).is_ok_and(|m| m.file_type().is_dir());
        if real_dir && is_year_name(&name) {
            out.push((name, entry.path()));
        }
    }
    out.sort();
    Ok(out)
}

/// The copies in one school-year folder: `(name, path, size)`, sorted by name.
fn copies_in(year: &str, dir: &Path) -> Result<Vec<(String, std::path::PathBuf, u64)>> {
    let rel = format!("{DIR}/{year}");
    let mut out = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| Error::io(&rel, e))? {
        let entry = entry.map_err(|e| Error::io(&rel, e))?;
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        if let Some(size) = is_copy(&entry.path(), &name) {
            out.push((name, entry.path(), size));
        }
    }
    out.sort();
    Ok(out)
}

/// How many copies each school year has and how big they are. No `rapporten/` folder: none.
pub fn usage(storage: &Storage) -> Result<Usage> {
    let mut years = Vec::new();
    for (schooljaar, dir) in year_dirs(storage)? {
        let copies = copies_in(&schooljaar, &dir)?;
        years.push(YearCopies {
            schooljaar,
            files: copies.len() as u64,
            bytes: copies.iter().map(|c| c.2).sum(),
        });
    }
    Ok(Usage { years })
}

/// "Opruimen": deletes the copies of every school year before `before` (`2025-2026` deletes
/// `2024-2025` and older, never `2025-2026` itself), then each year folder left empty. A copy
/// that cannot be deleted is listed in [`Cleanup::failed`]. Refused for a gast and when the
/// folder is read-only for this app; the caller checks that the admin is logged in.
pub fn cleanup(storage: &Storage, before: &str) -> Result<Cleanup> {
    storage.refuse_guest()?;
    if let Some(min_version) = storage.read_only() {
        return Err(Error::ReadOnly {
            min_version,
            app_version: storage.app_version().to_owned(),
        });
    }
    if !is_year_name(before) {
        return Err(Error::InvalidArgument {
            message: format!("Geen schooljaar: {before:?}"),
        });
    }
    let mut done = Cleanup::default();
    for (year, dir) in year_dirs(storage)? {
        if year.as_str() >= before {
            continue;
        }
        for (name, path, size) in copies_in(&year, &dir)? {
            match fs::remove_file(&path) {
                Ok(()) => {
                    done.files += 1;
                    done.bytes += size;
                }
                Err(e) => {
                    tracing::warn!("rapporten: {year}/{name} not deleted: {e}");
                    done.failed.push(format!("{DIR}/{year}/{name}"));
                }
            }
        }
        // Only an empty folder goes: anything else in it stays, and so does the folder.
        let _ = fs::remove_dir(&dir);
    }
    Ok(done)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, Storage) {
        let tmp = tempfile::tempdir().unwrap();
        let storage = Storage::open(tmp.path().join("data")).unwrap();
        (tmp, storage)
    }

    fn put(tmp: &tempfile::TempDir, rel: &str, bytes: &[u8]) {
        let path = tmp.path().join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    #[test]
    fn no_folder_is_no_copies() {
        let (_tmp, storage) = setup();
        assert_eq!(usage(&storage).unwrap(), Usage::default());
        assert_eq!(cleanup(&storage, "2025-2026").unwrap(), Cleanup::default());
    }

    #[test]
    fn usage_counts_pdfs_per_year_oldest_first() {
        let (tmp, storage) = setup();
        put(&tmp, "rapporten/2025-2026/a.pdf", b"12345");
        put(&tmp, "rapporten/2024-2025/b.pdf", b"123");
        put(&tmp, "rapporten/2024-2025/C.PDF", b"12");
        put(&tmp, "rapporten/2024-2025/notes.txt", b"not a copy");
        put(&tmp, "rapporten/2024-2025/sub/d.pdf", b"nested: not a copy");
        put(&tmp, "rapporten/oud/e.pdf", b"not a year folder");
        put(&tmp, "rapporten/f.pdf", b"not in a year folder");
        let got = usage(&storage).unwrap();
        assert_eq!(
            got.years,
            vec![
                YearCopies {
                    schooljaar: "2024-2025".into(),
                    files: 2,
                    bytes: 5
                },
                YearCopies {
                    schooljaar: "2025-2026".into(),
                    files: 1,
                    bytes: 5
                },
            ]
        );
    }

    #[test]
    fn cleanup_deletes_only_older_years_copies() {
        let (tmp, storage) = setup();
        put(&tmp, "rapporten/2023-2024/a.pdf", b"1");
        put(&tmp, "rapporten/2024-2025/b.pdf", b"12");
        put(&tmp, "rapporten/2024-2025/keep.txt", b"x");
        put(&tmp, "rapporten/2025-2026/c.pdf", b"123");
        let done = cleanup(&storage, "2025-2026").unwrap();
        assert_eq!((done.files, done.bytes), (2, 3));
        assert!(done.failed.is_empty());
        let r = tmp.path().join("rapporten");
        assert!(!r.join("2023-2024").exists(), "an emptied folder goes");
        assert!(!r.join("2024-2025/b.pdf").exists());
        assert!(r.join("2024-2025/keep.txt").exists(), "other files stay");
        assert!(r.join("2025-2026/c.pdf").exists(), "the chosen year stays");
    }

    #[test]
    fn cleanup_refuses_a_bad_year_and_a_gast() {
        let (tmp, storage) = setup();
        put(&tmp, "rapporten/2023-2024/a.pdf", b"1");
        assert!(matches!(
            cleanup(&storage, "../x"),
            Err(Error::InvalidArgument { .. })
        ));
        storage.set_guest(true);
        assert!(matches!(
            cleanup(&storage, "2025-2026"),
            Err(Error::GuestReadOnly)
        ));
        assert!(tmp.path().join("rapporten/2023-2024/a.pdf").exists());
    }

    #[test]
    fn cleanup_refuses_a_read_only_folder() {
        let (tmp, mut storage) = setup();
        storage.set_app_version("0.1.0");
        put(&tmp, "data/school.json", br#"{"minAppVersion":"9.0.0"}"#);
        put(&tmp, "rapporten/2023-2024/a.pdf", b"1");
        assert!(matches!(
            cleanup(&storage, "2025-2026"),
            Err(Error::ReadOnly { .. })
        ));
        assert!(tmp.path().join("rapporten/2023-2024/a.pdf").exists());
    }

    #[cfg(unix)]
    #[test]
    fn links_are_not_followed() {
        let (tmp, storage) = setup();
        put(&tmp, "elsewhere/x.pdf", b"outside");
        fs::create_dir_all(tmp.path().join("rapporten")).unwrap();
        std::os::unix::fs::symlink(
            tmp.path().join("elsewhere"),
            tmp.path().join("rapporten/2020-2021"),
        )
        .unwrap();
        assert!(usage(&storage).unwrap().years.is_empty());
        cleanup(&storage, "2025-2026").unwrap();
        assert!(tmp.path().join("elsewhere/x.pdf").exists());
    }
}
