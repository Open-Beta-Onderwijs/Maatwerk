// SPDX-License-Identifier: AGPL-3.0-or-later

//! What the commands share: storage on the data folder, presence, the local session file and the
//! watcher. Built once in `setup`.

use std::path::PathBuf;
use std::sync::{Arc, Mutex, PoisonError};

use maatwerk_core::paths::{DATA_DIR_ENV, data_dir_location};
use maatwerk_core::presence::Presence;
use maatwerk_core::storage::{LocalSession, Storage};
use maatwerk_core::watcher::{Change, WatchOptions, Watcher};

use crate::error::CommandError;

pub struct Core {
    /// `Err` when the data folder cannot be used (e.g. an unsupported `schema_version`, C1):
    /// every storage command then returns this error, so the UI can show it.
    storage: Result<Arc<Storage>, CommandError>,
    pub presence: Presence,
    pub session: LocalSession,
    watcher: Mutex<Option<Watcher>>,
}

/// Managed Tauri state; cloned into blocking tasks.
pub type Shared = Arc<Core>;

impl Core {
    /// Opens the data folder, seeds it on first run and starts the watcher, which hands each
    /// batch of external changes to `on_changes`.
    pub fn open(
        data_dir: PathBuf,
        session_file: PathBuf,
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
                Arc::new(storage)
            })
            .map_err(|e| {
                tracing::error!("cannot open the data folder {}: {e}", data_dir.display());
                CommandError::from(e)
            });
        Core {
            storage,
            presence: Presence::new(),
            session: LocalSession::new(session_file),
            watcher: Mutex::new(watcher),
        }
    }

    pub fn storage(&self) -> Result<&Storage, CommandError> {
        self.storage.as_deref().map_err(Clone::clone)
    }

    /// On quit: marks the teacher offline and stops the watcher.
    pub fn shutdown(&self) {
        if let Ok(storage) = self.storage() {
            self.presence.close(storage);
        }
        let watcher = self
            .watcher
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        if let Some(watcher) = watcher {
            watcher.close();
        }
    }
}

/// The data folder: `$MAATWERK_DATA_DIR`, else `data/` in the project folder for a debug
/// build, else `data/` next to the exe.
pub fn data_dir() -> PathBuf {
    let exe = std::env::current_exe().unwrap_or_default();
    let project =
        cfg!(debug_assertions).then(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."));
    data_dir_location(std::env::var_os(DATA_DIR_ENV), &exe, project.as_deref())
}
