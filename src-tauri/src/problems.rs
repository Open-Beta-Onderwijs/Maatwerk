// SPDX-License-Identifier: AGPL-3.0-or-later

//! Unexpected failures (PLAN Step 10): panics and `internal` errors go to the log file (see
//! `init_logging`), errors the UI did not expect are logged through [`log_ui_error`], and "Over
//! Maatwerk > Probleem melden" shows where the log files are and opens that folder.

use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, State};

use crate::commands::Res;
use crate::error::CommandError;

/// The folder with the daily log files; `None` when the OS has no app-data folder.
pub struct LogDir(pub Option<PathBuf>);

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProblemInfo {
    /// Absolute path of the log folder (local to this PC, never the shared data folder).
    pub log_dir: Option<String>,
    pub version: String,
}

/// What "Probleem melden" shows.
#[tauri::command]
#[specta::specta]
pub fn problem_info(log: State<'_, LogDir>, app: AppHandle) -> ProblemInfo {
    ProblemInfo {
        log_dir: log.0.as_deref().map(maatwerk_core::paths::display_path),
        version: app.package_info().version.to_string(),
    }
}

/// Opens the log folder in the file manager.
#[tauri::command]
#[specta::specta]
pub async fn open_log_folder(log: State<'_, LogDir>, app: AppHandle) -> Res<()> {
    let dir = log
        .0
        .clone()
        .ok_or_else(|| CommandError::internal("there is no log folder on this PC"))?;
    crate::render::open_with_os(app, dir).await
}

/// At most this many UI errors are logged per run, so a loop cannot fill the disk.
const MAX_UI_ERRORS: usize = 200;
/// Longer messages (stack traces) are cut to this many characters.
const MAX_UI_ERROR_CHARS: usize = 4000;

static UI_ERRORS: AtomicUsize = AtomicUsize::new(0);

/// Logs an error the UI did not handle (`window.onerror`, an unhandled rejection). The UI
/// sends the error text and stack only, no data.
#[tauri::command]
#[specta::specta]
pub async fn log_ui_error(message: String) {
    if let Some(line) = ui_error_line(&message, UI_ERRORS.fetch_add(1, Ordering::Relaxed)) {
        tracing::error!(target: "maatwerk::ui", "{line}");
    }
}

/// The line to log for the `count`-th UI error (0-based), or `None` past the limit.
fn ui_error_line(message: &str, count: usize) -> Option<String> {
    match count {
        n if n < MAX_UI_ERRORS => {
            let mut line: String = message.chars().take(MAX_UI_ERROR_CHARS).collect();
            if line.len() < message.len() {
                line.push_str(" [...]");
            }
            // One log line per error: a stack's newlines cannot fake other lines (review 10 n3).
            let line = line.replace('\r', "").replace('\n', " | ");
            Some(line)
        }
        n if n == MAX_UI_ERRORS => Some(format!(
            "more than {MAX_UI_ERRORS} UI errors; no more are logged in this run"
        )),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ui_errors_are_cut_and_capped() {
        assert_eq!(ui_error_line("boom", 0).as_deref(), Some("boom"));
        assert_eq!(
            ui_error_line("a\r\n  at f", 0).as_deref(),
            Some("a |   at f")
        );
        let long = "é".repeat(MAX_UI_ERROR_CHARS + 10);
        let line = ui_error_line(&long, 1).unwrap();
        assert!(line.ends_with(" [...]"));
        assert_eq!(line.chars().count(), MAX_UI_ERROR_CHARS + 6);
        assert!(
            ui_error_line("x", MAX_UI_ERRORS)
                .unwrap()
                .contains("no more")
        );
        assert_eq!(ui_error_line("x", MAX_UI_ERRORS + 1), None);
    }
}
