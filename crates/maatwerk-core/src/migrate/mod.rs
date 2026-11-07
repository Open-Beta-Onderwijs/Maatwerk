// SPDX-License-Identifier: AGPL-3.0-or-later

//! Data format v1 -> v2 (ADR-0003, `docs/reference/data-files-v2.md`) and v2 -> v3 (step 18,
//! `docs/reference/data-files-v3.md`).
//!
//! The migration first builds a plan from what is on disk, then (unless it is a dry run) zips the
//! whole folder to a backup outside it, carries out the plan and writes the new `schema_version`
//! to `config.json` **last**. Every step turns whatever it finds (the old format, or half-migrated
//! after a crash) into the new one, so running it again continues where it stopped; on a current
//! folder it does nothing. A v1 folder goes through v2 to v3 after one backup.
//!
//! The folder must not be in use: old and new app never run on it at the same time (cutover
//! runbook), so the migration writes without CAS.

mod backup;
mod plan;
mod report;
mod v3;

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use time::OffsetDateTime;

pub use backup::{BACKUP_PREFIX, check_backup_dir};
pub(crate) use plan::walk_all;
pub use report::{report_text, save_report};
pub use v3::V3_MIN_APP_VERSION;
pub(crate) use v3::{V2_IMAGES, V2_PRESENCE};

use crate::error::{Error, Result};
use crate::storage::atomic::write_atomic;

/// The format this build writes.
pub const CURRENT_VERSION: u64 = 3;

/// What a migration did (or, in a dry run, would do).
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MigrationReport {
    pub from_version: u64,
    pub to_version: u64,
    /// False for a dry run and for a folder that was already current.
    pub applied: bool,
    /// The backup zip, when one was written.
    pub backup: Option<String>,
    pub changes: Vec<Change>,
    /// Things the admin should look at; none of them stopped the migration.
    pub warnings: Vec<String>,
    /// What changes in the content, for the admin to read before (dry run) and after: the
    /// observaties each inhaal and herkansing gets (decision 13).
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub action: Action,
    /// Relative to the data folder; `../rapporten/...` for printed copies (C18).
    pub path: String,
    /// The new place of a moved file.
    pub to: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    Write,
    Move,
    Delete,
}

/// `schema_version` of the folder: 1 when `config.json` or the field is missing, except 2 for a
/// folder without `config.json` that has `gebruikers/` (v2 or later; its `config.json` has not
/// synced yet, review 18 M1: the v3 step then also writes it).
pub fn folder_version(root: &Path) -> Result<u64> {
    let path = root.join("config.json");
    let bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            let v2 = root.join("gebruikers").is_dir() && !root.join("gebruikers.json").exists();
            return Ok(if v2 { 2 } else { 1 });
        }
        Err(e) => return Err(Error::io("config.json", e)),
    };
    let config: Value = serde_json::from_slice(&bytes).map_err(|e| Error::CorruptJson {
        path: "config.json".into(),
        message: e.to_string(),
    })?;
    match config.get("schema_version") {
        None | Some(Value::Null) => Ok(1),
        Some(v) => v.as_u64().ok_or_else(|| Error::UnsupportedSchema {
            found: v.to_string(),
        }),
    }
}

/// Plans the migration of the data folder `root` and, with `backup_dir`, carries it out after
/// writing a backup zip there. `now` stamps `_meta.updatedAt` of files that had no `_meta` and
/// names the backup.
pub fn migrate(
    root: &Path,
    backup_dir: Option<&Path>,
    now: OffsetDateTime,
) -> Result<MigrationReport> {
    migrate_to(root, backup_dir, now, CURRENT_VERSION)
}

/// [`migrate`] up to `target` (2 or 3); tests pin the v1 -> v2 result on its own.
pub(crate) fn migrate_to(
    root: &Path,
    backup_dir: Option<&Path>,
    now: OffsetDateTime,
    target: u64,
) -> Result<MigrationReport> {
    let from_version = folder_version(root)?;
    if from_version > CURRENT_VERSION {
        return Err(Error::UnsupportedSchema {
            found: from_version.to_string(),
        });
    }
    let mut report = MigrationReport {
        from_version,
        to_version: target.max(from_version),
        ..MigrationReport::default()
    };
    if from_version >= target {
        return Ok(report);
    }
    let first = if from_version < 2 {
        plan::build(root, now)?
    } else {
        v3::build(root, now)?
    };
    report.add(root, &first);
    let to_v3_later = from_version < 2 && target >= 3;
    let Some(backup_dir) = backup_dir else {
        if to_v3_later {
            // The v3 step plans on the v2 result, which does not exist yet.
            report.warnings.push(
                "Daarna wordt de map omgezet naar versie 3 (fotos/ wordt afbeeldingen/, \
                 toetsvelden, observaties bij herkansingen); die stap staat nog niet in deze lijst."
                    .into(),
            );
        }
        return Ok(report);
    };
    let zip = backup::write(root, backup_dir, from_version, now)?;
    report.backup = Some(crate::paths::display_path(&zip));
    apply(root, &first)?;
    if from_version < 2 {
        plan::remove_empty_dirs(root);
    }
    if to_v3_later {
        let second = v3::build(root, now)?;
        report.add(root, &second);
        apply(root, &second)?;
    }
    if target >= 3 {
        v3::remove_empty_dirs(root);
    }
    report.applied = true;
    Ok(report)
}

impl MigrationReport {
    fn add(&mut self, root: &Path, plan: &plan::Plan) {
        self.warnings.extend(plan.warnings.iter().cloned());
        self.notes.extend(plan.notes.iter().cloned());
        self.changes
            .extend(plan.ops.iter().map(|op| op.change(root)));
    }
}

fn apply(root: &Path, plan: &plan::Plan) -> Result<()> {
    for op in &plan.ops {
        op.apply(root)?;
    }
    Ok(())
}

/// One step of the plan. Paths are absolute; [`Op::change`] makes them relative for the report.
#[derive(Debug)]
pub(crate) enum Op {
    Write { path: PathBuf, bytes: Vec<u8> },
    Move { from: PathBuf, to: PathBuf },
    Delete { path: PathBuf },
}

impl Op {
    fn change(&self, root: &Path) -> Change {
        match self {
            Op::Write { path, .. } => Change {
                action: Action::Write,
                path: rel_display(root, path),
                to: None,
            },
            Op::Move { from, to } => Change {
                action: Action::Move,
                path: rel_display(root, from),
                to: Some(rel_display(root, to)),
            },
            Op::Delete { path } => Change {
                action: Action::Delete,
                path: rel_display(root, path),
                to: None,
            },
        }
    }

    fn apply(&self, root: &Path) -> Result<()> {
        let err = |path: &Path, e: io::Error| Error::io(rel_display(root, path), e);
        match self {
            Op::Write { path, bytes } => write_atomic(path, bytes).map_err(|e| err(path, e)),
            Op::Move { from, to } => {
                if let Some(parent) = to.parent() {
                    fs::create_dir_all(parent).map_err(|e| err(parent, e))?;
                }
                // Copy, then delete: a rename across the OneDrive folder boundary (C18) may not
                // be atomic anyway, and a crash in between leaves both copies, never none.
                let bytes = fs::read(from).map_err(|e| err(from, e))?;
                write_atomic(to, &bytes).map_err(|e| err(to, e))?;
                remove_file(from).map_err(|e| err(from, e))
            }
            Op::Delete { path } => remove_file(path).map_err(|e| err(path, e)),
        }
    }
}

fn remove_file(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        other => other,
    }
}

/// `a/b.json` for paths in `root`, `../rapporten/...` next to it, else the full path.
fn rel_display(root: &Path, path: &Path) -> String {
    if let Ok(rel) = path.strip_prefix(root) {
        return posix(rel);
    }
    if let Some(parent) = root.parent()
        && let Ok(rel) = path.strip_prefix(parent)
    {
        return format!("../{}", posix(rel));
    }
    crate::paths::display_path(path)
}

fn posix(rel: &Path) -> String {
    rel.components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests;
