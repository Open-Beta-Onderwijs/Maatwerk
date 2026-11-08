// SPDX-License-Identifier: AGPL-3.0-or-later

//! Data format commands (Step 7a): the v1 -> v2 migration offered on the startup screen, the
//! admin's data check (`validate-data`) and the integrity stamps (ADR-0003 C1, C19). Not
//! reference methods.

use std::path::{Path, PathBuf};

use maatwerk_core::data_location::{self, LOCAL_CONFIG_FILE, LocalConfig};
use maatwerk_core::integrity::StampState;
use maatwerk_core::migrate::{self, Action};
use maatwerk_core::paths::display_path;
use maatwerk_core::typst_svc::local_now;
use maatwerk_core::validate::{self, IssueKind, Severity};
use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, Manager, State, Window};
use tauri_plugin_dialog::DialogExt;

use crate::commands::{Res, blocking, rel};
use crate::error::CommandError;
use crate::state::{DataFolderSource, Shared};

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
    /// Dutch: the observaties each inhaal and herkansing gets, before and after (decision 13);
    /// shown before the admin confirms (dry run) and in the report.
    pub notes: Vec<String>,
    /// The check right after the migration.
    pub validation: Option<DataCheck>,
    /// The Dutch report next to the backup zip (`None` when it could not be written).
    pub report_file: Option<String>,
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

/// Migrates the data folder to the current format after zipping it to the local backup folder,
/// then checks it. Only while the folder could not be opened because it needs the migration; the
/// UI restarts the app afterwards. `dry_run`: only what would change, nothing written (the
/// screen shows it before the admin confirms).
#[tauri::command]
#[specta::specta]
pub async fn migrate_data_folder(
    state: State<'_, Shared>,
    app: AppHandle,
    dry_run: Option<bool>,
) -> Res<MigrationResult> {
    let dry_run = dry_run.unwrap_or(false);
    let backups = (!dry_run).then(|| backup_dir(&app)).transpose()?;
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
        let now = local_now();
        let report = migrate::migrate(&data_dir, backups.as_deref(), now)?;
        tracing::info!(
            "migration of {} from v{} (applied {}, backup {:?}, {} changes)",
            display_path(&data_dir),
            report.from_version,
            report.applied,
            report.backup,
            report.changes.len()
        );
        let count = |a: Action| report.changes.iter().filter(|c| c.action == a).count() as u32;
        let check = if report.applied {
            Some(validate::validate(&data_dir)?)
        } else {
            None
        };
        // The migration is done; a report that cannot be written is only logged.
        let report_file =
            match migrate::save_report(&report, check.as_ref(), &display_path(&data_dir), now) {
                Ok(path) => path.map(|p| display_path(&p)),
                Err(e) => {
                    tracing::warn!("migration report not written: {e}");
                    None
                }
            };
        let validation = check.map(data_check);
        Ok(MigrationResult {
            from_version: report.from_version as u32,
            to_version: report.to_version as u32,
            applied: report.applied,
            backup: report.backup.clone(),
            written: count(Action::Write),
            moved: count(Action::Move),
            deleted: count(Action::Delete),
            warnings: report.warnings,
            notes: report.notes,
            validation,
            report_file,
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

/// `local-config.json` in the app's config folder (beside `session.json`), local to this PC.
pub(crate) fn local_config_path(app: &AppHandle) -> Res<PathBuf> {
    // The local (not roaming) folder: the choice is for this PC only (review 16 n6).
    app.path()
        .app_local_data_dir()
        .map(|d| d.join(LOCAL_CONFIG_FILE))
        .map_err(|e| CommandError::internal(format!("no local app folder: {e}")))
}

/// Opens the folder dialog and stores the chosen data folder on this PC (step 16a); `null` if
/// cancelled. The UI restarts the app afterwards. Refused when `$MAATWERK_DATA_DIR` or a dev
/// build fixes the folder.
#[tauri::command]
#[specta::specta]
pub async fn choose_data_folder(
    state: State<'_, Shared>,
    app: AppHandle,
    window: Window,
) -> Res<Option<String>> {
    let source = blocking(state, |c| Ok(c.source())).await?;
    if matches!(source, Some(DataFolderSource::Env | DataFolderSource::Dev)) {
        return Err(maatwerk_core::Error::InvalidArgument {
            message: "De gegevensmap ligt vast (MAATWERK_DATA_DIR of een ontwikkelversie)."
                .to_owned(),
        }
        .into());
    }
    let config = local_config_path(&app)?;
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Gegevensmap van Maatwerk kiezen")
            .set_parent(&window)
            .blocking_pick_folder()
    })
    .await
    .map_err(|e| CommandError::internal(format!("dialog task failed: {e}")))?;
    let Some(picked) = picked.and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    let dir = tauri::async_runtime::spawn_blocking(move || save_choice(&config, &picked))
        .await
        .map_err(|e| CommandError::internal(format!("blocking task failed: {e}")))??;
    Ok(Some(display_path(&dir)))
}

/// Checks the picked folder (`data_location::check_chosen`) and stores the data folder it
/// stands for in the local config.
pub(crate) fn save_choice(config: &Path, picked: &Path) -> Res<PathBuf> {
    let dir = data_location::check_chosen(picked)?;
    let mut local = LocalConfig::load(config);
    local.data_dir = Some(dir.clone());
    local.save(config)?;
    tracing::info!("data folder chosen: {}", dir.display());
    Ok(dir)
}

#[cfg(test)]
mod choose_tests {
    use super::*;
    use crate::error::ErrorCode;

    #[test]
    fn a_choice_is_stored_and_a_wrong_folder_is_refused() {
        let tmp = tempfile::tempdir().unwrap();
        let config = tmp.path().join("cfg").join(LOCAL_CONFIG_FILE);
        let shared = tmp.path().join("gedeeld");
        std::fs::create_dir_all(shared.join("data").join("gebruikers")).unwrap();
        assert_eq!(save_choice(&config, &shared).unwrap(), shared.join("data"));
        assert_eq!(
            LocalConfig::load(&config).data_dir,
            Some(shared.join("data"))
        );

        let other = tmp.path().join("anders");
        std::fs::create_dir_all(&other).unwrap();
        std::fs::write(other.join("brief.txt"), b"").unwrap();
        let err = save_choice(&config, &other).unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidArgument);
        assert_eq!(
            LocalConfig::load(&config).data_dir,
            Some(shared.join("data")),
            "a refused folder keeps the earlier choice"
        );
    }
}
