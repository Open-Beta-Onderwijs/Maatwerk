// SPDX-License-Identifier: AGPL-3.0-or-later

//! The backup zip written before a migration changes anything. It holds every file of the data
//! folder under `data/` and must live outside the shared (OneDrive) folder.

use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use time::OffsetDateTime;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::error::{Error, Result};
use crate::paths::display_path;

pub const BACKUP_PREFIX: &str = "maatwerk-backup";

/// Environment variables Windows sets to the OneDrive folders.
const ONEDRIVE_VARS: [&str; 3] = ["OneDrive", "OneDriveCommercial", "OneDriveConsumer"];

/// Refuses a backup folder inside the data folder, inside the folder that holds it (the shared
/// folder, C18) or inside a OneDrive folder: a backup there syncs, and goes when the folder goes.
pub fn check_backup_dir(root: &Path, dir: &Path) -> Result<PathBuf> {
    let dir = canonical_lenient(dir)?;
    let root = canonical(root)?;
    let mut forbidden = vec![(root.clone(), "de gegevensmap")];
    // The shared folder, unless the data folder sits directly in a drive root (`C:\data`):
    // then the whole drive would be forbidden (review 7a m5).
    if let Some(parent) = root.parent().filter(|p| p.parent().is_some()) {
        forbidden.push((parent.to_path_buf(), "de gedeelde map"));
    }
    for var in ONEDRIVE_VARS {
        if let Some(p) = std::env::var_os(var).filter(|p| !p.is_empty())
            && let Ok(p) = fs::canonicalize(p)
        {
            forbidden.push((p, "een OneDrive-map"));
        }
    }
    for (place, what) in forbidden {
        if dir.starts_with(&place) {
            return Err(Error::MigrationBlocked {
                message: format!(
                    "De back-upmap {} ligt in {what}; kies een map buiten OneDrive en buiten de gegevensmap",
                    display_path(&dir)
                ),
            });
        }
    }
    fs::create_dir_all(&dir).map_err(|e| Error::io(display_path(&dir), e))?;
    Ok(dir)
}

/// Canonical form of a path that may not exist yet: its nearest existing ancestor resolved, the
/// rest appended. Nothing is created before the checks.
fn canonical_lenient(p: &Path) -> Result<PathBuf> {
    let abs = std::path::absolute(p).map_err(|e| Error::io(display_path(p), e))?;
    let mut existing = abs.as_path();
    let mut tail = Vec::new();
    while !existing.exists() {
        match (existing.file_name(), existing.parent()) {
            (Some(name), Some(parent)) => {
                tail.push(name.to_owned());
                existing = parent;
            }
            _ => break,
        }
    }
    let mut out = canonical(existing)?;
    out.extend(tail.iter().rev());
    Ok(out)
}

fn canonical(p: &Path) -> Result<PathBuf> {
    fs::canonicalize(p).map_err(|e| Error::io(display_path(p), e))
}

/// Zips `root` into `dir` (checked with [`check_backup_dir`]) and reads the zip back before
/// returning its path. The name says the version and the local time:
/// `maatwerk-backup-v1 2026-10-30 1405.zip`.
pub(crate) fn write(root: &Path, dir: &Path, version: u64, now: OffsetDateTime) -> Result<PathBuf> {
    let dir = check_backup_dir(root, dir)?;
    let stamp = format!(
        "{:04}-{:02}-{:02} {:02}{:02}",
        now.year(),
        u8::from(now.month()),
        now.day(),
        now.hour(),
        now.minute()
    );
    let base = format!("{BACKUP_PREFIX}-v{version} {stamp}");
    let target = (1..)
        .map(|n| match n {
            1 => dir.join(format!("{base}.zip")),
            n => dir.join(format!("{base} ({n}).zip")),
        })
        .find(|p| !p.exists())
        .expect("some free name");
    let partial = target.with_extension("zip.partial");
    let io_err = |p: &Path, e: io::Error| Error::io(display_path(p), e);

    let files = super::plan::walk_all(root).map_err(|e| io_err(root, e))?;
    {
        let file = File::create(&partial).map_err(|e| io_err(&partial, e))?;
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .large_file(true);
        for rel in &files {
            let bytes = fs::read(root.join(rel)).map_err(|e| io_err(&root.join(rel), e))?;
            zip.start_file(format!("data/{rel}"), options)
                .map_err(|e| io_err(&partial, io::Error::other(e)))?;
            zip.write_all(&bytes).map_err(|e| io_err(&partial, e))?;
        }
        let file = zip
            .finish()
            .map_err(|e| io_err(&partial, io::Error::other(e)))?;
        file.sync_all().map_err(|e| io_err(&partial, e))?;
    }
    verify(&partial, root, &files).map_err(|e| io_err(&partial, e))?;
    fs::rename(&partial, &target).map_err(|e| io_err(&target, e))?;
    Ok(target)
}

/// Every entry is there, decompresses with a good CRC and has the original's size.
fn verify(zip_path: &Path, root: &Path, files: &[String]) -> io::Result<()> {
    let mut zip = ZipArchive::new(File::open(zip_path)?).map_err(io::Error::other)?;
    if zip.len() != files.len() {
        return Err(io::Error::other("backup is incomplete"));
    }
    for rel in files {
        let mut entry = zip
            .by_name(&format!("data/{rel}"))
            .map_err(io::Error::other)?;
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf)?; // checks the CRC
        if buf.len() as u64 != fs::metadata(root.join(rel))?.len() {
            return Err(io::Error::other(format!("backup of {rel} differs")));
        }
    }
    Ok(())
}
