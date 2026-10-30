// SPDX-License-Identifier: AGPL-3.0-or-later

//! Data format commands (Step 7a): the v1 -> v2 migration offered on the startup screen, the
//! admin's data check (`validate-data`) and the integrity stamps (ADR-0003 C1, C19). Not
//! reference methods.

use std::path::PathBuf;

use maatwerk_core::integrity::StampState;
use maatwerk_core::migrate::{self, Action};
use maatwerk_core::paths::display_path;
use maatwerk_core::typst_svc::local_now;
use maatwerk_core::validate::{self, IssueKind, Severity};
use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, Manager, State};

use crate::commands::{Res, blocking, rel};
use crate::error::CommandError;
use crate::state::Shared;

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MigrationResult {
    pub from_version: u32,
    pub to_version: u32,
    pub applied: bool,
    /// The backup zip.
    pub backup: Option<String>,
    pub written: u32,
    pub moved: u32,
    pub deleted: u32,
    /// Dutch, for the admin.
    pub warnings: Vec<String>,
    /// The check right after the migration.
    pub validation: Option<DataCheck>,
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DataCheck {
    pub files_checked: u32,
    pub issues: Vec<DataIssue>,
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DataIssue {
    /// `error` or `warning`.
    pub severity: String,
    /// `version`, `corrupt`, `stamp`, `shape`, `placement`, `reference`, `stray`.
    pub kind: String,
    pub path: String,
    /// Dutch.
    pub message: String,
}

/// A JSON file read with a missing or wrong stamp since start (C19).
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct StampIssue {
    pub path: String,
    /// `missing` or `mismatch`.
    pub state: String,
}

fn camel<T: Serialize>(v: T) -> String {
    serde_json::to_value(v)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_default()
}

fn data_check(report: validate::ValidationReport) -> DataCheck {
    DataCheck {
        files_checked: report.files_checked as u32,
        issues: report
            .issues
            .into_iter()
            .map(|i| DataIssue {
                severity: camel::<Severity>(i.severity),
                kind: camel::<IssueKind>(i.kind),
                path: i.path,
                message: i.message,
            })
            .collect(),
    }
}

/// Where the app puts migration backups: `%LOCALAPPDATA%\<app id>\backups`, outside OneDrive.
fn backup_dir(app: &AppHandle) -> Res<PathBuf> {
    app.path()
        .app_local_data_dir()
        .map(|d| d.join("backups"))
        .map_err(|e| CommandError::internal(format!("no local app data folder: {e}")))
}

/// Migrates the data folder to v2 after zipping it to the local backup folder, then checks it.
/// Only while the folder could not be opened because it needs the migration; the UI restarts
/// the app afterwards.
#[tauri::command]
#[specta::specta]
pub async fn migrate_data_folder(state: State<'_, Shared>, app: AppHandle) -> Res<MigrationResult> {
    let backups = backup_dir(&app)?;
    blocking(state, move |c| {
        // Only a folder that could not be opened because it is v1 (review 7a m5).
        match c.storage() {
            Err(e) if e.code == crate::error::ErrorCode::NeedsMigration => {}
            _ => {
                return Err(maatwerk_core::Error::InvalidArgument {
                    message: "Deze gegevensmap hoeft niet omgezet te worden.".into(),
                }
                .into());
            }
        }
        let data_dir = c.data_dir().to_path_buf();
        let report = migrate::migrate(&data_dir, Some(&backups), local_now())?;
        tracing::info!(
            "migrated {} from v{} (backup {:?}, {} changes)",
            display_path(&data_dir),
            report.from_version,
            report.backup,
            report.changes.len()
        );
        let count = |a: Action| report.changes.iter().filter(|c| c.action == a).count() as u32;
        let validation = if report.applied {
            Some(data_check(validate::validate(&data_dir)?))
        } else {
            None
        };
        Ok(MigrationResult {
            from_version: report.from_version as u32,
            to_version: report.to_version as u32,
            applied: report.applied,
            backup: report.backup.clone(),
            written: count(Action::Write),
            moved: count(Action::Move),
            deleted: count(Action::Delete),
            warnings: report.warnings,
            validation,
        })
    })
    .await
}

/// `validate-data` on the open data folder (admin screen).
#[tauri::command]
#[specta::specta]
pub async fn validate_data_folder(state: State<'_, Shared>) -> Res<DataCheck> {
    blocking(state, move |c| {
        let root = c.storage()?.data_dir().root().to_path_buf();
        Ok(data_check(validate::validate(&root)?))
    })
    .await
}

/// Files read with a missing or wrong stamp since start ("Buiten Maatwerk gewijzigd").
#[tauri::command]
#[specta::specta]
pub async fn stamp_issues(state: State<'_, Shared>) -> Res<Vec<StampIssue>> {
    blocking(state, move |c| {
        Ok(c.storage()?
            .stamp_issues()
            .into_iter()
            .map(|(path, s)| StampIssue {
                path,
                state: camel::<StampState>(s),
            })
            .collect())
    })
    .await
}

/// "Accepteren": re-stamps the file as it is now.
#[tauri::command]
#[specta::specta]
pub async fn accept_stamp(state: State<'_, Shared>, rel_path: String) -> Res<()> {
    blocking(state, move |c| {
        let rel = rel(&rel_path)?;
        if rel.extension().as_deref() != Some("json") {
            return Err(maatwerk_core::Error::InvalidPath {
                path: rel_path,
                reason: "only JSON files carry a stamp",
            }
            .into());
        }
        Ok(c.storage()?.accept_stamp(&rel)?)
    })
    .await
}
