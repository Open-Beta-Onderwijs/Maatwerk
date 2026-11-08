// SPDX-License-Identifier: AGPL-3.0-or-later

//! The migration report: a Dutch text file next to the backup zip, so the admin can read the
//! warnings and the check result again after the app restarted (the migration screen is gone by
//! then). The app shows the same facts on screen.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use time::OffsetDateTime;

use super::{Action, MigrationReport};
use crate::error::{Error, Result};
use crate::storage::atomic::write_atomic;
use crate::validate::{Severity, ValidationReport};

/// The report file for a backup zip: `<backup name> verslag.txt` in the same folder.
fn report_path(backup_zip: &Path) -> PathBuf {
    let stem = backup_zip
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| super::BACKUP_PREFIX.to_owned());
    backup_zip.with_file_name(format!("{stem} verslag.txt"))
}

fn plural(n: usize, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

/// The report as Dutch text (CRLF line ends are left to the reader: plain `\n`).
pub fn report_text(
    report: &MigrationReport,
    check: Option<&ValidationReport>,
    data_dir: &str,
    now: OffsetDateTime,
) -> String {
    let count = |a: Action| report.changes.iter().filter(|c| c.action == a).count();
    let mut out = String::new();
    let _ = writeln!(out, "Maatwerk: verslag van het omzetten van de gegevensmap");
    let _ = writeln!(
        out,
        "Datum: {:04}-{:02}-{:02} {:02}:{:02}",
        now.year(),
        u8::from(now.month()),
        now.day(),
        now.hour(),
        now.minute()
    );
    let _ = writeln!(out, "Map: {data_dir}");
    let _ = writeln!(
        out,
        "Versie {} -> {}{}",
        report.from_version,
        report.to_version,
        if report.applied {
            ""
        } else {
            " (niet uitgevoerd)"
        }
    );
    if let Some(backup) = &report.backup {
        let _ = writeln!(out, "Back-up: {backup}");
    }
    let _ = writeln!(
        out,
        "{} bijgewerkt, {} verplaatst, {} verwijderd.",
        plural(count(Action::Write), "bestand", "bestanden"),
        count(Action::Move),
        count(Action::Delete)
    );

    if !report.notes.is_empty() {
        let _ = writeln!(
            out,
            "\nObservaties bij inhaal- en herkansingstoetsen ({}):",
            report.notes.len()
        );
        for n in &report.notes {
            let _ = writeln!(out, "  - {n}");
        }
    }

    let _ = writeln!(
        out,
        "\nMeldingen bij het omzetten ({}):",
        report.warnings.len()
    );
    if report.warnings.is_empty() {
        let _ = writeln!(out, "  geen");
    }
    for w in &report.warnings {
        let _ = writeln!(out, "  - {w}");
    }

    if let Some(check) = check {
        let errors = check.errors();
        let _ = writeln!(
            out,
            "\nControle na het omzetten: {} gecontroleerd, {}, {}.",
            plural(check.files_checked, "bestand", "bestanden"),
            plural(errors, "fout", "fouten"),
            plural(
                check.issues.len() - errors,
                "waarschuwing",
                "waarschuwingen"
            )
        );
        let mut issues: Vec<_> = check.issues.iter().collect();
        issues.sort_by_key(|i| i.severity);
        for i in issues {
            let sev = match i.severity {
                Severity::Error => "FOUT",
                Severity::Warning => "Let op",
            };
            let _ = writeln!(out, "  - [{sev}] {}: {}", i.path, i.message);
        }
    }

    if !report.changes.is_empty() {
        let _ = writeln!(out, "\nWijzigingen:");
        for c in &report.changes {
            let what = match c.action {
                Action::Write => "bijgewerkt",
                Action::Move => "verplaatst",
                Action::Delete => "verwijderd",
            };
            match &c.to {
                Some(to) => {
                    let _ = writeln!(out, "  {what}: {} -> {to}", c.path);
                }
                None => {
                    let _ = writeln!(out, "  {what}: {}", c.path);
                }
            }
        }
    }
    out
}

/// Writes the report next to the backup zip and returns its path; `None` without a backup.
pub fn save_report(
    report: &MigrationReport,
    check: Option<&ValidationReport>,
    data_dir: &str,
    now: OffsetDateTime,
) -> Result<Option<PathBuf>> {
    let Some(backup) = &report.backup else {
        return Ok(None);
    };
    let path = report_path(Path::new(backup));
    let text = report_text(report, check, data_dir, now);
    write_atomic(&path, text.as_bytes()).map_err(|e| Error::io(path.display().to_string(), e))?;
    Ok(Some(path))
}
