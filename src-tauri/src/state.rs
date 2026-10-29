// SPDX-License-Identifier: AGPL-3.0-or-later

//! What the commands share: storage on the data folder, presence, the local session file, the
//! watcher, the PDF output folder and the image files picked in a dialog. Built once in `setup`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use maatwerk_core::opdracht_images;
use maatwerk_core::outputs::OutputStore;
use maatwerk_core::paths::{DATA_DIR_ENV, data_dir_location, display_path};
use maatwerk_core::presence::Presence;
use maatwerk_core::storage::{LocalSession, Storage};
use maatwerk_core::typst_svc::FontStore;
use maatwerk_core::watcher::{Change, WatchOptions, Watcher};
use serde::Serialize;
use specta::Type;

use crate::error::CommandError;

pub struct Core {
    /// The data folder as configured, for the startup error screen when it cannot be opened.
    data_dir: PathBuf,
    /// `Err` when the data folder cannot be used (e.g. an unsupported `schema_version`, C1):
    /// every storage command then returns this error, so the UI can show it.
    storage: Result<Arc<Storage>, CommandError>,
    pub presence: Presence,
    pub session: LocalSession,
    watcher: Mutex<Option<Watcher>>,
    /// `Err` when the cache folder cannot be created; only the render commands need it.
    outputs: Result<OutputStore, CommandError>,
    picked: Picked,
}

/// What the UI checks first at start (review 4b m5): an unusable folder gets its own screen.
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DataFolderStatus {
    pub data_dir: String,
    /// `null` when the folder opened; else e.g. `unsupported_schema` or `io`.
    pub error: Option<CommandError>,
}

/// Managed Tauri state; cloned into blocking tasks.
pub type Shared = Arc<Core>;

impl Core {
    /// Opens the data folder, seeds it on first run, starts the watcher (which hands each batch
    /// of external changes to `on_changes`) and empties the PDF output folder.
    pub fn open(
        data_dir: PathBuf,
        session_file: PathBuf,
        output_dir: PathBuf,
        on_changes: impl Fn(Vec<Change>) + Send + 'static,
    ) -> Core {
        let mut watcher = None;
        let storage = Storage::open(&data_dir)
            .map(|mut storage| {
                let w = Watcher::start(
                    storage.data_dir().clone(),
                    WatchOptions::default(),
                    on_changes,
                );
                storage.set_observer(w.observer());
                watcher = Some(w);
                if let Err(e) = storage.seed_initial_data() {
                    tracing::warn!("seeding the data folder failed: {e}");
                }
                if let Err(e) = opdracht_images::remove_empty_dirs(&storage) {
                    tracing::warn!("removing empty image folders failed: {e}");
                }
                Arc::new(storage)
            })
            .map_err(|e| {
                tracing::error!("cannot open the data folder {}: {e}", data_dir.display());
                CommandError::from(e)
            });
        let outputs = OutputStore::open(output_dir).map_err(|e| {
            tracing::error!("cannot create the PDF output folder: {e}");
            CommandError::internal(format!("cannot create the PDF output folder: {e}"))
        });
        Core {
            data_dir,
            storage,
            presence: Presence::new(),
            session: LocalSession::new(session_file),
            watcher: Mutex::new(watcher),
            outputs,
            picked: Picked::default(),
        }
    }

    pub fn storage(&self) -> Result<&Storage, CommandError> {
        self.storage.as_deref().map_err(Clone::clone)
    }

    /// The data folder (the opened root when it opened) and why it could not be opened.
    pub fn data_folder_status(&self) -> DataFolderStatus {
        match &self.storage {
            Ok(storage) => DataFolderStatus {
                data_dir: display_path(storage.data_dir().root()),
                error: None,
            },
            Err(e) => DataFolderStatus {
                data_dir: display_path(&self.data_dir),
                error: Some(e.clone()),
            },
        }
    }

    pub fn outputs(&self) -> Result<&OutputStore, CommandError> {
        self.outputs.as_ref().map_err(Clone::clone)
    }

    /// Template fonts plus the system fonts, searched once on first use.
    pub fn fonts(&self) -> Arc<FontStore> {
        FontStore::shared()
    }

    pub fn picked(&self) -> &Picked {
        &self.picked
    }

    /// The year the watcher's poll covers (ADR-0003 C7); `None`: `config.json` `activeYear`.
    pub fn set_watch_year(&self, year: Option<String>) {
        if let Some(watcher) = lock(&self.watcher).as_ref() {
            watcher.set_scope_year(year);
        }
    }

    /// On window close: marks the teacher offline (`window-all-closed`). Later updates are
    /// ignored.
    pub fn mark_offline(&self) {
        if let Ok(storage) = self.storage() {
            self.presence.close(storage);
        }
    }

    /// On quit: marks the teacher offline and stops the watcher.
    pub fn shutdown(&self) {
        self.mark_offline();
        let watcher = lock(&self.watcher).take();
        if let Some(watcher) = watcher {
            watcher.close();
        }
    }
}

/// Files chosen in the image dialog, by token: the absolute path never reaches the UI
/// (`pickedImages`, `main.js:243-245`). Tokens live until imported or the app quits.
#[derive(Default)]
pub struct Picked {
    seq: AtomicU64,
    paths: Mutex<HashMap<String, PathBuf>>,
}

impl Picked {
    pub fn add(&self, path: PathBuf) -> String {
        let token = (self.seq.fetch_add(1, Ordering::SeqCst) + 1).to_string();
        lock(&self.paths).insert(token.clone(), path);
        token
    }

    pub fn get(&self, token: &str) -> Option<PathBuf> {
        lock(&self.paths).get(token).cloned()
    }

    pub fn remove(&self, token: &str) {
        lock(&self.paths).remove(token);
    }
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The data folder: `$MAATWERK_DATA_DIR`, else `data/` in the project folder for a debug
/// build, else `data/` next to the exe.
pub fn data_dir() -> PathBuf {
    let exe = std::env::current_exe().unwrap_or_default();
    let project =
        cfg!(debug_assertions).then(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."));
    data_dir_location(std::env::var_os(DATA_DIR_ENV), &exe, project.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;

    fn open(data_dir: PathBuf, tmp: &std::path::Path) -> Core {
        Core::open(
            data_dir,
            tmp.join("session.json"),
            tmp.join("output"),
            |_| {},
        )
    }

    #[test]
    fn a_usable_data_folder_reports_no_error() {
        let tmp = tempfile::tempdir().unwrap();
        let core = open(tmp.path().join("data"), tmp.path());
        let status = core.data_folder_status();
        assert!(status.error.is_none());
        assert!(status.data_dir.ends_with("data"), "{}", status.data_dir);
        core.shutdown();
    }

    /// Review 4b m5: the UI shows the reason and the folder instead of an empty app.
    #[test]
    fn an_unsupported_schema_reports_the_folder_and_the_code() {
        let tmp = tempfile::tempdir().unwrap();
        let data = tmp.path().join("data");
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(data.join("config.json"), r#"{"schema_version": 99}"#).unwrap();
        let core = open(data.clone(), tmp.path());
        let status = core.data_folder_status();
        let error = status.error.expect("an error");
        assert_eq!(error.code, ErrorCode::UnsupportedSchema);
        assert_eq!(error.details.found.as_deref(), Some("99"));
        assert_eq!(status.data_dir, display_path(&data));
        assert!(core.storage().is_err());
    }
}
