// SPDX-License-Identifier: AGPL-3.0-or-later

//! `validate-data` and `migrate` (PLAN Step 7a, `docs/reference/data-files-v2.md`), and
//! `admin reset-pin` (Step 7b).

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::ExitCode;

use maatwerk_core::auth;
use maatwerk_core::migrate::{self, Action, MigrationReport};
use maatwerk_core::storage::Storage;
use maatwerk_core::typst_svc::local_now;
use maatwerk_core::validate::{self, Severity, ValidationReport};

#[derive(Debug, PartialEq)]
pub struct ValidateArgs {
    data: PathBuf,
    json: bool,
}

impl ValidateArgs {
    pub fn parse(args: &[&str]) -> Result<ValidateArgs, String> {
        let mut data = None;
        let mut json = false;
        for &arg in args {
            match arg {
                "--json" => json = true,
                flag if flag.starts_with('-') => return Err(format!("unknown option {flag}")),
                path if data.is_none() => data = Some(PathBuf::from(path)),
                extra => return Err(format!("unexpected argument {extra}")),
            }
        }
        Ok(ValidateArgs {
            data: data.ok_or("missing <data-folder>")?,
            json,
        })
    }

    /// Exit code 1 when the folder has errors (warnings alone are fine).
    pub fn run(self) -> ExitCode {
        match validate::validate(&self.data) {
            Ok(report) => {
                if self.json {
                    println!("{}", to_json(&report));
                } else {
                    print_validation(&report);
                }
                if report.errors() == 0 {
                    ExitCode::SUCCESS
                } else {
                    ExitCode::FAILURE
                }
            }
            Err(e) => fail(&e),
        }
    }
}

#[derive(Debug, PartialEq)]
pub struct MigrateArgs {
    data: PathBuf,
    /// `None` = dry run.
    backup_dir: Option<PathBuf>,
    verbose: bool,
    json: bool,
}

impl MigrateArgs {
    pub fn parse(args: &[&str]) -> Result<MigrateArgs, String> {
        let mut data = None;
        let mut mode = None;
        let mut backup_dir = None;
        let mut verbose = false;
        let mut json = false;
        let mut it = args.iter();
        while let Some(&arg) = it.next() {
            match arg {
                "--dry-run" | "--apply" if mode.is_some() => {
                    return Err("give either --dry-run or --apply".into());
                }
                "--dry-run" => mode = Some(false),
                "--apply" => mode = Some(true),
                "--backup-dir" => {
                    backup_dir = Some(PathBuf::from(
                        it.next().ok_or("--backup-dir needs a folder")?,
                    ));
                }
                "--verbose" | "-v" => verbose = true,
                "--json" => json = true,
                flag if flag.starts_with('-') => return Err(format!("unknown option {flag}")),
                path if data.is_none() => data = Some(PathBuf::from(path)),
                extra => return Err(format!("unexpected argument {extra}")),
            }
        }
        let data = data.ok_or("missing <data-folder>")?;
        match (mode, backup_dir) {
            (None, _) => Err("give --dry-run or --apply".into()),
            (Some(false), Some(_)) => Err("--backup-dir is only for --apply".into()),
            (Some(true), None) => {
                Err("--apply needs --backup-dir <folder outside OneDrive>".into())
            }
            (Some(_), backup_dir) => Ok(MigrateArgs {
                data,
                backup_dir,
                verbose,
                json,
            }),
        }
    }

    /// Exit code 1 when the migration is blocked or the result does not validate.
    pub fn run(self) -> ExitCode {
        let now = local_now();
        let report = match migrate::migrate(&self.data, self.backup_dir.as_deref(), now) {
            Ok(report) => report,
            Err(e) => return fail(&e),
        };
        let validation = if report.applied {
            match validate::validate(&self.data) {
                Ok(v) => Some(v),
                Err(e) => return fail(&e),
            }
        } else {
            None
        };
        let data_dir = maatwerk_core::paths::display_path(&self.data);
        let report_file = match migrate::save_report(&report, validation.as_ref(), &data_dir, now) {
            Ok(path) => path.map(|p| maatwerk_core::paths::display_path(&p)),
            Err(e) => {
                eprintln!("warning: migration report not written: {e}");
                None
            }
        };
        if self.json {
            println!(
                "{}",
                serde_json::json!({
                    "migration": report,
                    "validation": validation,
                    "reportFile": report_file,
                })
            );
        } else {
            print_migration(&report, self.verbose);
            if let Some(v) = &validation {
                println!();
                print_validation(v);
            }
            if let Some(f) = &report_file {
                println!("\nVerslag: {f}");
            }
        }
        match validation {
            Some(v) if v.errors() > 0 => ExitCode::FAILURE,
            _ => ExitCode::SUCCESS,
        }
    }
}

fn fail(e: &maatwerk_core::Error) -> ExitCode {
    eprintln!("error ({}): {e}", e.code());
    ExitCode::FAILURE
}

fn to_json<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_string_pretty(value).expect("serialisable")
}

/// `admin reset-pin <data-folder>`: the last resort when the admin lost both the PIN and the
/// recovery codes (docs/cutover-runbook.md).
#[derive(Debug, PartialEq)]
pub struct ResetPinArgs {
    data: PathBuf,
}

impl ResetPinArgs {
    pub fn parse(args: &[&str]) -> Result<ResetPinArgs, String> {
        match args {
            [path] if !path.starts_with('-') => Ok(ResetPinArgs { data: path.into() }),
            [] => Err("missing <data-folder>".into()),
            _ => Err("admin reset-pin takes only <data-folder>".into()),
        }
    }

    pub fn run(self) -> ExitCode {
        let result = Storage::open(&self.data)
            .and_then(|storage| auth::reset_admin_pins(&storage, std::time::SystemTime::now()));
        match result {
            Ok(ids) if ids.is_empty() => {
                eprintln!("Geen beheerder gevonden in {}.", self.data.display());
                ExitCode::FAILURE
            }
            Ok(ids) => {
                println!("Pincode en herstelcodes gewist voor: {}.", ids.join(", "));
                println!("De beheerder stelt bij de volgende aanmelding een nieuwe pincode in.");
                ExitCode::SUCCESS
            }
            Err(e) => fail(&e),
        }
    }
}

fn print_migration(report: &MigrationReport, verbose: bool) {
    if report.from_version == report.to_version {
        println!(
            "Gegevensmap is al versie {}; niets te doen.",
            report.to_version
        );
        return;
    }
    let what = if report.applied {
        "Gemigreerd"
    } else {
        "Proefrun (er is niets veranderd)"
    };
    println!(
        "{what}: versie {} -> {}",
        report.from_version, report.to_version
    );
    if let Some(backup) = &report.backup {
        println!("Back-up: {backup}");
    }
    let mut counts: BTreeMap<Action, usize> = BTreeMap::new();
    for c in &report.changes {
        *counts.entry(c.action).or_default() += 1;
    }
    for (action, n) in counts {
        let label = match action {
            Action::Write => "geschreven",
            Action::Move => "verplaatst",
            Action::Delete => "verwijderd",
        };
        println!("  {n:>5} bestanden {label}");
    }
    if verbose {
        for c in &report.changes {
            match &c.to {
                Some(to) => println!("  {:?} {} -> {to}", c.action, c.path),
                None => println!("  {:?} {}", c.action, c.path),
            }
        }
    }
    if !report.notes.is_empty() {
        println!("Observaties bij inhaal- en herkansingstoetsen (vóór en na):");
        for n in &report.notes {
            println!("  - {n}");
        }
    }
    if !report.warnings.is_empty() {
        println!("Let op:");
        for w in &report.warnings {
            println!("  - {w}");
        }
    }
}

fn print_validation(report: &ValidationReport) {
    let errors = report.errors();
    let warnings = report.issues.len() - errors;
    println!(
        "Controle: {} bestanden, {errors} fouten, {warnings} waarschuwingen",
        report.files_checked
    );
    for issue in &report.issues {
        let tag = match issue.severity {
            Severity::Error => "FOUT",
            Severity::Warning => "let op",
        };
        println!("  [{tag}] {}: {}", issue.path, issue.message);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_validate_arguments() {
        assert_eq!(
            ValidateArgs::parse(&["data", "--json"]).unwrap(),
            ValidateArgs {
                data: "data".into(),
                json: true
            }
        );
        assert!(ValidateArgs::parse(&[]).is_err());
        assert!(ValidateArgs::parse(&["a", "b"]).is_err());
    }

    #[test]
    fn parses_reset_pin_arguments() {
        assert_eq!(
            ResetPinArgs::parse(&["data"]).unwrap(),
            ResetPinArgs {
                data: "data".into()
            }
        );
        assert!(ResetPinArgs::parse(&[]).is_err());
        assert!(ResetPinArgs::parse(&["data", "x"]).is_err());
        assert!(ResetPinArgs::parse(&["--all"]).is_err());
    }

    #[test]
    fn parses_migrate_arguments() {
        let apply = MigrateArgs::parse(&["data", "--apply", "--backup-dir", "C:/b", "-v"]).unwrap();
        assert_eq!(apply.backup_dir, Some(PathBuf::from("C:/b")));
        assert!(apply.verbose);
        let dry = MigrateArgs::parse(&["--dry-run", "data"]).unwrap();
        assert_eq!(dry.backup_dir, None);
        for bad in [
            &["data"][..],
            &["data", "--apply"],
            &["data", "--dry-run", "--backup-dir", "b"],
            &["data", "--dry-run", "--apply"],
        ] {
            assert!(MigrateArgs::parse(bad).is_err(), "{bad:?}");
        }
    }
}
