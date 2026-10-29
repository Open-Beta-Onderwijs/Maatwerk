// SPDX-License-Identifier: AGPL-3.0-or-later

//! Compiled PDFs (ADR-0002 section 9). They live in a local cache folder under an output ID, which
//! the UI gets instead of a path; the viewer loads them through the app's URI scheme. Printing
//! copies one into `rapporten/<schooljaar>/` in the data folder under a descriptive name (C15).

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use time::OffsetDateTime;

use crate::paths::{RelPath, is_year_name};
use crate::storage::{Expect, Storage};
use crate::{Error, Result};

/// Longest output name and name part, in characters.
const MAX_PART: usize = 60;

/// Longest printed file name without ` (n).pdf`, in characters.
const MAX_STEM: usize = 120;

/// Folders of other runs older than this are removed at start; younger ones may belong to a
/// second instance that is still running (review 6a m1).
const STALE_RUN: Duration = Duration::from_secs(24 * 60 * 60);

/// The cache folder of one app run, `<base>/<process id>`: started empty.
pub struct OutputStore {
    dir: PathBuf,
    seq: AtomicU64,
}

impl OutputStore {
    /// Creates this process's folder under `base`, empty, and removes what old runs left there.
    pub fn open(base: impl Into<PathBuf>) -> io::Result<OutputStore> {
        let base = base.into();
        let dir = base.join(std::process::id().to_string());
        clear_stale(&base, &dir);
        match fs::remove_dir_all(&dir) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => {
                tracing::warn!("could not clear the output folder: {e}");
            }
            _ => {}
        }
        fs::create_dir_all(&dir)?;
        Ok(OutputStore {
            dir,
            seq: AtomicU64::new(0),
        })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Stores a PDF as `<n>-<name>` and returns that ID. Earlier outputs with the same name are
    /// removed: the reference overwrote `temp/<name>` too, and a new ID gives the viewer a fresh
    /// URL.
    pub fn put(&self, name: &str, pdf: &[u8]) -> Result<String> {
        let name = output_name(name)?;
        let n = self.seq.fetch_add(1, Ordering::SeqCst) + 1;
        let id = format!("{n}-{name}");
        let path = self.dir.join(&id);
        fs::write(&path, pdf).map_err(|e| Error::io(&id, e))?;
        if let Ok(entries) = fs::read_dir(&self.dir) {
            for entry in entries.flatten() {
                let other = entry.file_name();
                let Some(other) = other.to_str() else {
                    continue;
                };
                if other != id && parse_id(other).is_some_and(|(_, n)| n == name) {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
        Ok(id)
    }

    /// The file of an output ID; [`Error::NotFound`] for an unknown or malformed ID.
    pub fn path(&self, id: &str) -> Result<PathBuf> {
        let not_found = || Error::NotFound {
            path: id.to_owned(),
        };
        parse_id(id).ok_or_else(not_found)?;
        let path = self.dir.join(id);
        if path.is_file() {
            Ok(path)
        } else {
            Err(not_found())
        }
    }

    pub fn read(&self, id: &str) -> Result<Vec<u8>> {
        let path = self.path(id)?;
        fs::read(&path).map_err(|e| Error::io(id, e))
    }
}

/// Removes loose files in `base` and run folders other than `own` not touched for a day.
fn clear_stale(base: &Path, own: &Path) {
    let Ok(entries) = fs::read_dir(base) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_file() {
            let _ = fs::remove_file(&path);
        } else if meta.is_dir() && path != own {
            let old = meta
                .modified()
                .ok()
                .and_then(|m| m.elapsed().ok())
                .is_some_and(|age| age > STALE_RUN);
            if old {
                let _ = fs::remove_dir_all(&path);
            }
        }
    }
}

/// What `open_path` may open with the OS (review 6a M1): an output ID, or a printed copy
/// `rapporten/<schooljaar>/<name>.pdf` that exists. Nothing else in the shared folder, which
/// could hold files that run when opened.
pub fn openable_path(storage: &Storage, outputs: &OutputStore, target: &str) -> Result<PathBuf> {
    if let Ok(path) = outputs.path(target) {
        return Ok(path);
    }
    let rel = RelPath::parse(target)?;
    let parts: Vec<&str> = rel.as_str().split('/').collect();
    let printed = matches!(parts.as_slice(), ["rapporten", year, _] if is_year_name(year))
        && rel.extension().as_deref() == Some("pdf");
    if !printed {
        return Err(Error::InvalidPath {
            path: target.to_owned(),
            reason: "only render outputs and printed PDFs can be opened",
        });
    }
    let path = storage.data_dir().resolve(&rel)?;
    if path.is_file() {
        Ok(path)
    } else {
        Err(Error::NotFound {
            path: target.to_owned(),
        })
    }
}

/// `<n>-<name>` with a valid name; returns both.
fn parse_id(id: &str) -> Option<(u64, &str)> {
    let (n, name) = id.split_once('-')?;
    let n = n
        .parse()
        .ok()
        .filter(|_| n.bytes().all(|b| b.is_ascii_digit()))?;
    output_name(name).ok().filter(|clean| clean == name)?;
    Some((n, name))
}

/// Checks an output name before any work is done (`Ongeldige bestandsnaam: <name>`).
pub fn check_output_name(name: &str) -> Result<()> {
    output_name(name).map(drop)
}

/// A bare `.pdf` file name of `[A-Za-z0-9_.-]`, as the UI passes (`opdrachten.pdf`).
fn output_name(name: &str) -> Result<String> {
    let valid = name.len() <= MAX_PART
        && name.ends_with(".pdf")
        && name.len() > 4
        && !name.starts_with('.')
        && !name.contains("..")
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b));
    if valid {
        Ok(name.to_owned())
    } else {
        Err(Error::InvalidArgument {
            message: format!("Ongeldige bestandsnaam: {name}"),
        })
    }
}

/// What a printed copy is called: `<YYYY-MM-DD HHmm> <soort> <vak> <groep> <toets>.pdf`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PrintName {
    /// `2025-2026`; the folder under `rapporten/`.
    pub schooljaar: String,
    /// `Rapport`, `Opdrachten`, `Antwoordsleutel`.
    pub soort: String,
    pub vak: String,
    pub groep: String,
    pub toets: String,
}

/// One part of a file name typed by teachers: path separators, characters Windows forbids and
/// control characters become `-`, whitespace runs one space, leading/trailing spaces and dots
/// go, at most 60 characters.
pub fn clean_name_part(part: &str) -> String {
    let mut out = String::new();
    for c in part.chars() {
        if c.is_whitespace() {
            if !out.ends_with(' ') {
                out.push(' ');
            }
        } else if c.is_control() || r#"<>:"/\|?*"#.contains(c) {
            out.push('-');
        } else {
            out.push(c);
        }
    }
    let trimmed = out.trim_matches(|c: char| c == ' ' || c == '.');
    let cut: String = trimmed.chars().take(MAX_PART).collect();
    cut.trim_end_matches([' ', '.']).to_owned()
}

/// Copies an output into `rapporten/<schooljaar>/` and returns the copy's data-relative path. A
/// name already taken gets ` (2)`, ` (3)`, ... Written atomically; the watcher ignores the folder.
pub fn print_copy(
    storage: &Storage,
    pdf: &[u8],
    name: &PrintName,
    now: OffsetDateTime,
) -> Result<RelPath> {
    if !is_year_name(&name.schooljaar) {
        return Err(Error::InvalidArgument {
            message: format!("not a school year: {:?}", name.schooljaar),
        });
    }
    let stamp = format!(
        "{:04}-{:02}-{:02} {:02}{:02}",
        now.year(),
        u8::from(now.month()),
        now.day(),
        now.hour(),
        now.minute()
    );
    // The stamp starts the name, so no part can make it a reserved name (`CON`, `NUL.pdf`).
    let stem = [&name.soort, &name.vak, &name.groep, &name.toets]
        .into_iter()
        .map(|p| clean_name_part(p))
        .filter(|p| !p.is_empty())
        .fold(stamp, |acc, p| format!("{acc} {p}"));
    // Keeps the full path well under Windows' 260 characters on a deep OneDrive folder
    // (review 6a m2); ` (n).pdf` comes on top.
    let stem: String = stem.chars().take(MAX_STEM).collect();
    let stem = stem.trim_end_matches([' ', '.']).to_owned();
    let dir = RelPath::parse(&format!("rapporten/{}", name.schooljaar))?;
    storage.ensure_dir(&dir)?;
    for n in 1u32.. {
        let file = match n {
            1 => format!("{stem}.pdf"),
            n => format!("{stem} ({n}).pdf"),
        };
        let rel = dir.join(&file)?;
        match storage.write_bytes(&rel, pdf, Expect::Missing) {
            Ok(()) => return Ok(rel),
            Err(Error::Conflict { .. }) if n < 1000 => continue,
            Err(e) => return Err(e),
        }
    }
    unreachable!("the loop returns")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_fresh_and_replace_the_same_name() {
        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir_all(tmp.path().join("out")).unwrap();
        fs::write(tmp.path().join("out/old.pdf"), b"x").unwrap();
        let store = OutputStore::open(tmp.path().join("out")).unwrap();
        assert!(!tmp.path().join("out/old.pdf").exists(), "cleared at open");
        // A recent folder of another running instance is kept.
        fs::create_dir_all(tmp.path().join("out/1")).unwrap();
        fs::write(tmp.path().join("out/1/1-opdrachten.pdf"), b"x").unwrap();
        let _again = OutputStore::open(tmp.path().join("out")).unwrap();
        assert!(tmp.path().join("out/1/1-opdrachten.pdf").exists());

        let a = store.put("opdrachten.pdf", b"one").unwrap();
        let k = store.put("antwoordsleutel.pdf", b"key").unwrap();
        let b = store.put("opdrachten.pdf", b"two").unwrap();
        assert_ne!(a, b);
        assert_eq!(store.read(&b).unwrap(), b"two");
        assert_eq!(store.read(&k).unwrap(), b"key");
        assert!(
            matches!(store.read(&a), Err(Error::NotFound { .. })),
            "replaced"
        );
    }

    #[test]
    fn ids_and_names_are_checked() {
        let tmp = tempfile::tempdir().unwrap();
        let store = OutputStore::open(tmp.path()).unwrap();
        for bad in [
            "../x.pdf", "a/b.pdf", "x.typ", ".pdf", "a b.pdf", "C:x.pdf", "..pdf",
        ] {
            let err = store.put(bad, b"").unwrap_err();
            assert_eq!(
                err.to_string(),
                format!("invalid argument: Ongeldige bestandsnaam: {bad}")
            );
        }
        let id = store.put("rapport_preview.pdf", b"%PDF").unwrap();
        let own = tmp.path().join(std::process::id().to_string());
        assert_eq!(store.path(&id).unwrap(), own.join(&id));
        for bad in [
            "",
            "1-../x.pdf",
            "x-a.pdf",
            "-a.pdf",
            "99-a.pdf",
            "1-a.pdf/..",
            "+1-a.pdf",
        ] {
            assert!(
                matches!(store.path(bad), Err(Error::NotFound { .. })),
                "{bad}"
            );
        }
    }

    #[test]
    fn name_parts_are_safe_file_names() {
        assert_eq!(clean_name_part("3a/3b"), "3a-3b");
        assert_eq!(clean_name_part(" Toets:  H1?\t"), "Toets- H1-");
        assert_eq!(clean_name_part("..verborgen.."), "verborgen");
        assert_eq!(clean_name_part("élève"), "élève");
        assert_eq!(clean_name_part(&"x".repeat(80)).chars().count(), 60);
        assert_eq!(clean_name_part("a\u{0}b"), "a-b");
    }

    #[test]
    fn print_copies_get_a_descriptive_unique_name() {
        let tmp = tempfile::tempdir().unwrap();
        let storage =
            Storage::open_with_lock_dir(tmp.path().join("data"), &tmp.path().join("locks"))
                .unwrap();
        let name = PrintName {
            schooljaar: "2025-2026".into(),
            soort: "Rapport".into(),
            vak: "nat".into(),
            groep: "3a".into(),
            toets: "Voorbeeldtoets 1".into(),
        };
        let now = time::Date::from_calendar_date(2026, time::Month::October, 25)
            .unwrap()
            .with_hms(14, 32, 9)
            .unwrap()
            .assume_offset(time::UtcOffset::from_hms(1, 0, 0).unwrap());
        let first = print_copy(&storage, b"%PDF-1", &name, now).unwrap();
        assert_eq!(
            first.as_str(),
            "rapporten/2025-2026/2026-10-25 1432 Rapport nat 3a Voorbeeldtoets 1.pdf"
        );
        let second = print_copy(&storage, b"%PDF-2", &name, now).unwrap();
        assert_eq!(
            second.as_str(),
            "rapporten/2025-2026/2026-10-25 1432 Rapport nat 3a Voorbeeldtoets 1 (2).pdf"
        );
        assert_eq!(storage.read_bytes(&first).unwrap().unwrap(), b"%PDF-1");

        let no_group = PrintName {
            groep: " ".into(),
            toets: "a/b".into(),
            ..name.clone()
        };
        let rel = print_copy(&storage, b"%PDF", &no_group, now).unwrap();
        assert_eq!(
            rel.as_str(),
            "rapporten/2025-2026/2026-10-25 1432 Rapport nat a-b.pdf"
        );

        let bad_year = PrintName {
            schooljaar: "../x".into(),
            ..name
        };
        assert!(print_copy(&storage, b"%PDF", &bad_year, now).is_err());
    }

    #[test]
    fn m2_long_print_names_are_capped() {
        let tmp = tempfile::tempdir().unwrap();
        let storage =
            Storage::open_with_lock_dir(tmp.path().join("data"), &tmp.path().join("locks"))
                .unwrap();
        let name = PrintName {
            schooljaar: "2025-2026".into(),
            soort: "Opdrachten".into(),
            vak: "nat".into(),
            groep: "x".repeat(60),
            toets: "y".repeat(60),
        };
        let rel = print_copy(&storage, b"%PDF", &name, OffsetDateTime::UNIX_EPOCH).unwrap();
        assert_eq!(rel.file_name().chars().count(), MAX_STEM + ".pdf".len());
    }

    #[test]
    fn m1_open_accepts_outputs_and_printed_pdfs_only() {
        let tmp = tempfile::tempdir().unwrap();
        let storage =
            Storage::open_with_lock_dir(tmp.path().join("data"), &tmp.path().join("locks"))
                .unwrap();
        let outputs = OutputStore::open(tmp.path().join("out")).unwrap();
        let id = outputs.put("rapport_preview.pdf", b"%PDF").unwrap();
        assert!(openable_path(&storage, &outputs, &id).is_ok());
        let name = PrintName {
            schooljaar: "2025-2026".into(),
            soort: "Rapport".into(),
            ..PrintName::default()
        };
        let rel = print_copy(&storage, b"%PDF", &name, OffsetDateTime::UNIX_EPOCH).unwrap();
        assert!(openable_path(&storage, &outputs, rel.as_str()).is_ok());
        for (file, bytes) in [
            ("fotos/x.bat", &b"echo"[..]),
            ("rapporten/2025-2026/x.lnk", b""),
        ] {
            let rel = RelPath::parse(file).unwrap();
            storage.write_bytes(&rel, bytes, Expect::Any).unwrap();
        }
        for bad in [
            "fotos/x.bat",
            "rapporten/2025-2026/x.lnk",
            "rapporten/2025-2026/missing.pdf",
            "rapporten/x/a.pdf",
            "rapporten",
            "gebruikers.json",
            "../x.pdf",
            "C:/Windows/notepad.exe",
        ] {
            assert!(openable_path(&storage, &outputs, bad).is_err(), "{bad}");
        }
    }
}
