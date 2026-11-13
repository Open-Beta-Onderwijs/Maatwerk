// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tauri shell. Command handlers parse arguments, call `maatwerk_core` and map
//! errors; they hold no business logic.

mod auth;
mod commands;
mod data;
mod editor;
mod error;
mod opdrachten;
mod problems;
mod render;
mod scheme;
mod start_error;
mod state;

use std::sync::Arc;

use maatwerk_core::watcher::{Change, ChangeKind};
use serde::Serialize;
use serde_json::Value;
use specta::Type;
use tauri::Manager;
use tauri_specta::{Event, collect_commands, collect_events};

/// Where `npm run bindings` writes the generated TypeScript (relative to `src-tauri/`).
pub const BINDINGS_PATH: &str = "../ui/src/bridge/bindings.ts";

/// `data:changed` item (`ipc-api.md`, "Main -> renderer events").
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DataChange {
    pub rel_path: String,
    pub kind: DataChangeKind,
    pub meta: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum DataChangeKind {
    Added,
    Changed,
    Deleted,
}

/// External changes in the data folder, one batch per event.
#[derive(Debug, Clone, Serialize, Type, Event)]
#[tauri_specta(event_name = "data:changed")]
pub struct DataChanged(pub Vec<DataChange>);

impl From<Change> for DataChange {
    fn from(c: Change) -> DataChange {
        DataChange {
            rel_path: c.rel_path,
            kind: match c.kind {
                ChangeKind::Added => DataChangeKind::Added,
                ChangeKind::Changed => DataChangeKind::Changed,
                ChangeKind::Deleted => DataChangeKind::Deleted,
            },
            meta: c.meta,
        }
    }
}

/// Commands and events, for the invoke handler and the bindings export.
pub fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            commands::read_json,
            commands::read_json_versioned,
            commands::write_json,
            commands::list_years,
            commands::ensure_year,
            commands::read_all_json,
            commands::read_json_dir,
            commands::read_opdrachten,
            commands::delete_file,
            commands::ensure_dir,
            commands::get_data_dir,
            commands::data_folder_status,
            commands::restart_app,
            data::choose_data_folder,
            commands::read_text_file,
            commands::read_text_file_versioned,
            commands::write_text_file,
            commands::update_presence,
            commands::read_local_session,
            commands::write_local_session,
            commands::read_photo_as_data_url,
            commands::save_photo,
            commands::set_watch_year,
            opdrachten::create_opdracht_folder,
            opdrachten::list_opdracht_images,
            opdrachten::save_opdracht_image,
            opdrachten::pick_image_file,
            opdrachten::import_opdracht_image,
            opdrachten::read_clipboard_image,
            opdrachten::copy_opdracht_folder,
            opdrachten::delete_opdracht_folder,
            data::migrate_data_folder,
            data::validate_data_folder,
            data::rubric_usage,
            data::stamp_issues,
            data::accept_stamp,
            auth::verify_pin,
            auth::set_first_pin,
            auth::change_pin,
            auth::reset_pin,
            auth::recover_with_code,
            auth::renew_recovery_codes,
            auth::logout,
            auth::save_text_as,
            auth::list_snapshots,
            auth::snapshot_for_file,
            auth::restore_from_snapshot,
            render::render_rapport_pdf,
            render::render_po_rapport_pdf,
            render::render_assignment_svg,
            render::render_assignment_batch,
            render::open_path,
            render::open_data_folder,
            render::print_pdf,
            editor::editor_open,
            editor::editor_update,
            editor::editor_unset,
            editor::editor_refresh,
            editor::editor_resend,
            editor::editor_close,
            editor::editor_complete,
            editor::editor_hover,
            editor::editor_definition,
            editor::editor_jump_from_click,
            editor::editor_jump_from_cursor,
            editor::project_files_status,
            editor::restore_project_file,
            editor::bundled_project_file,
            problems::problem_info,
            problems::open_log_folder,
            problems::log_ui_error,
        ])
        .events(collect_events![
            DataChanged,
            render::AssignmentProgress,
            editor::EditorUpdateEvent
        ])
        // `serde_json::Value` numbers are i64/u64/f64 in Rust but plain JS numbers on the wire
        // (they came from the UI as such). No command takes or returns another 64-bit integer.
        .dangerously_cast_bigints_to_number()
        // The types only travel Rust -> UI; one shape each is enough.
        .disable_serde_phases()
}

/// Writes the TypeScript bindings to `path`.
pub fn export_bindings(path: &std::path::Path) -> Result<(), String> {
    let header = "// SPDX-License-Identifier: AGPL-3.0-or-later\n\
                  // Generated by tauri-specta from src-tauri (`npm run bindings`). Do not edit.\n";
    specta_builder()
        .export(
            specta_typescript::Typescript::default().header(header),
            path,
        )
        .map_err(|e| e.to_string())
}

/// Log lines to stderr and to a daily file in the app's log folder (ADR-0002 section 8; on
/// Windows `%LOCALAPPDATA%\nl.openbetaonderwijs.maatwerk\logs`), never in the shared data folder.
/// The last 14 files are kept. No student data goes into log messages.
fn init_logging(log_dir: Option<std::path::PathBuf>) {
    use tracing_appender::rolling::{Builder, Rotation};
    use tracing_subscriber::fmt::writer::MakeWriterExt;

    let file = log_dir.and_then(|dir| {
        // The appender lists the folder to prune old files, before it would create it.
        if let Err(e) = std::fs::create_dir_all(&dir) {
            eprintln!("no log folder: {e}");
        }
        Builder::new()
            .rotation(Rotation::DAILY)
            .filename_prefix("maatwerk")
            .filename_suffix("log")
            .max_log_files(14)
            .build(dir)
            .map_err(|e| eprintln!("no log file: {e}"))
            .ok()
    });
    let subscriber = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .with_ansi(false);
    let result = match file {
        Some(file) => subscriber.with_writer(std::io::stderr.and(file)).try_init(),
        None => subscriber.with_writer(std::io::stderr).try_init(),
    };
    if let Err(e) = result {
        eprintln!("logging is already set up: {e}");
    }
}

/// The log folder Tauri's `app_log_dir` resolves to, known before the app is built so that
/// start failures are logged too (review 6 M1). Elsewhere logging starts in `setup`.
fn early_log_dir(identifier: &str) -> Option<std::path::PathBuf> {
    use std::path::PathBuf;
    let var = |name: &str| {
        std::env::var_os(name)
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
    };
    // The folders Tauri's `app_log_dir` uses (step 16b: also off Windows).
    if cfg!(windows) {
        var("LOCALAPPDATA").map(|dir| dir.join(identifier).join("logs"))
    } else if cfg!(target_os = "macos") {
        var("HOME").map(|home| home.join("Library/Logs").join(identifier))
    } else {
        var("XDG_DATA_HOME")
            .or_else(|| var("HOME").map(|home| home.join(".local/share")))
            .map(|dir| dir.join(identifier).join("logs"))
    }
}

pub fn run() {
    let context = tauri::generate_context!();
    let early_logs = early_log_dir(&context.config().identifier);
    if early_logs.is_some() {
        init_logging(early_logs);
    }
    start_error::install_panic_hook();
    // Before Tauri: without WebView2 a release build would first show Tauri's English box.
    if let Err(e) = start_error::check_webview() {
        tracing::error!("cannot start: {e}");
        start_error::explain_start_error(&e);
        std::process::exit(1);
    }
    let builder = specta_builder();
    let app = tauri::Builder::default()
        // Used from Rust only (image dialog, clipboard image, opening PDFs): the capabilities
        // grant the UI none of their commands (ADR-0002 section 7).
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        // No click handler for `target=_blank` links in the webview (review 6a n2).
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .register_asynchronous_uri_scheme_protocol(scheme::SCHEME, scheme::handle)
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            let log_dir = app.path().app_log_dir().ok();
            if cfg!(not(windows)) {
                init_logging(log_dir.clone());
            }
            app.manage(problems::LogDir(log_dir));
            builder.mount_events(app);
            let session_file = app.path().app_config_dir()?.join("session.json");
            // `%LOCALAPPDATA%\nl.openbetaonderwijs.maatwerk\output\<pid>`; old runs' folders go after a day.
            let output_dir = app.path().app_cache_dir()?.join("output");
            let handle = app.handle().clone();
            let slot = Arc::new(state::CoreSlot::default());
            // Where `data::local_config_path` looks: local, not roaming (review 16 n6).
            let location = state::locate_data_dir(
                &app.path()
                    .app_local_data_dir()?
                    .join(maatwerk_core::data_location::LOCAL_CONFIG_FILE),
            );
            let source = location.as_ref().map(|l| l.source);
            let failed_dir = location.as_ref().map(|l| l.dir.clone()).unwrap_or_default();
            let (failed_session, failed_output) = (session_file.clone(), output_dir.clone());
            // Off the main thread (review 6 m6): commands wait for it on their blocking thread.
            slot.open_in_background(
                move || {
                    state::open_located(location, session_file, output_dir, move |batch| {
                        let batch = batch.into_iter().map(DataChange::from).collect();
                        if let Err(e) = DataChanged(batch).emit(&handle) {
                            tracing::warn!("emitting data:changed failed: {e}");
                        }
                    })
                },
                move |e| {
                    state::Core::failed(failed_dir, failed_session, failed_output, e)
                        .located(source)
                },
                |core| core.start_snapshot(),
            );
            app.manage::<state::Shared>(slot);
            app.manage(editor::Editors::default());
            Ok(())
        })
        .build(context);
    let app = match app {
        Ok(app) => app,
        Err(e) => {
            // E.g. no WebView2 runtime: say so in Dutch instead of exiting silently.
            let error = e.to_string();
            tracing::error!("cannot start: {error}");
            start_error::explain_start_error(&error);
            std::process::exit(1);
        }
    };
    app.run(|handle, event| {
        if let tauri::RunEvent::Ready = event {
            start_error::mark_started();
        }
        // Not open yet: nothing to mark offline or stop.
        let Some(core) = handle
            .try_state::<state::Shared>()
            .and_then(|slot| slot.get())
        else {
            return;
        };
        match event {
            // `window-all-closed` in the reference: offline as soon as the window goes, even
            // if the process takes a moment to exit.
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::Destroyed,
                ..
            } if label == "main" => core.mark_offline(),
            // `before-quit`.
            tauri::RunEvent::Exit => {
                if let Some(editors) = handle.try_state::<editor::Editors>() {
                    editors.close_all();
                }
                core.shutdown();
            }
            _ => {}
        }
    });
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    /// CI fails on stale bindings (ADR-0005). `npm run bindings` regenerates them.
    #[test]
    fn bindings_are_up_to_date() {
        let committed = Path::new(env!("CARGO_MANIFEST_DIR")).join(BINDINGS_PATH);
        if std::env::var_os("MAATWERK_UPDATE_BINDINGS").is_some() {
            export_bindings(&committed).unwrap();
            return;
        }
        let tmp = tempfile::tempdir().unwrap();
        let fresh = tmp.path().join("bindings.ts");
        export_bindings(&fresh).unwrap();
        let normalise = |s: String| s.replace("\r\n", "\n");
        let fresh = normalise(std::fs::read_to_string(fresh).unwrap());
        let committed = normalise(std::fs::read_to_string(&committed).unwrap_or_default());
        assert!(
            fresh == committed,
            "ui/src/bridge/bindings.ts is stale: run `npm run bindings`"
        );
    }

    #[test]
    fn data_change_matches_the_reference_payload() {
        let change = Change {
            rel_path: "2025-2026/exams/t1.json".into(),
            kind: ChangeKind::Changed,
            meta: Some(serde_json::json!({"rev": 2})),
        };
        assert_eq!(
            serde_json::to_value(DataChange::from(change)).unwrap(),
            serde_json::json!({
                "relPath": "2025-2026/exams/t1.json",
                "kind": "changed",
                "meta": {"rev": 2},
            })
        );
    }
}
