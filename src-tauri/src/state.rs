// SPDX-License-Identifier: AGPL-3.0-or-later

//! What the commands share: storage on the data folder, presence, the local session file, the
//! watcher, the PDF output folder and the image files picked in a dialog. Built once in `setup`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, PoisonError};

use maatwerk_core::auth::Auth;
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
    /// Who logged in with a PIN on this PC, and the delays after wrong PINs (Step 7b).
    pub auth: Auth,
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
    /// This app's version.
    pub app_version: String,
    /// `minAppVersion` from `school.json` when it is newer than this app: the app may only read
    /// (PLAN-2 decision 5). Checked again on every write.
    pub read_only: Option<String>,
}

/// Managed Tauri state; cloned into blocking tasks. The core is opened on a background thread
/// (review 6 m6: a slow OneDrive folder must not delay the window), so commands wait for it on
/// their blocking thread with [`CoreSlot::wait`].
pub type Shared = Arc<CoreSlot>;

/// The core once it is open.
#[derive(Default)]
pub struct CoreSlot {
    core: Mutex<Option<Arc<Core>>>,
    opened: Condvar,
}

impl CoreSlot {
    /// Opens the core on a thread of its own and fills the slot. A panic while opening still
    /// fills it, with a core whose storage reports an `internal` error (the startup error
    /// screen shows it), so no command waits forever.
    pub fn open_in_background(
        self: &Arc<CoreSlot>,
        open: impl FnOnce() -> Core + Send + 'static,
        failed: impl FnOnce(CommandError) -> Core + Send + 'static,
        then: impl FnOnce(&Arc<Core>) + Send + 'static,
    ) {
        let slot = Arc::clone(self);
        // Failing to start a thread at start is a start error (the panic hook shows it).
        std::thread::Builder::new()
            .name("open-data-folder".into())
            .spawn(move || {
                let started = std::time::Instant::now();
                let core = std::panic::catch_unwind(std::panic::AssertUnwindSafe(open))
                    .unwrap_or_else(|_| {
                        failed(CommandError::internal("opening the data folder panicked"))
                    });
                tracing::info!("data folder opened in {} ms", started.elapsed().as_millis());
                let core = slot.set(core);
                then(&core);
            })
            .expect("cannot start the thread that opens the data folder");
    }

    fn set(&self, core: Core) -> Arc<Core> {
        let core = Arc::new(core);
        *lock(&self.core) = Some(Arc::clone(&core));
        self.opened.notify_all();
        core
    }

    /// The core, waiting until it is open. Blocks: call it on a blocking thread only.
    pub fn wait(&self) -> Arc<Core> {
        let guard = self
            .opened
            .wait_while(lock(&self.core), |core| core.is_none())
            .unwrap_or_else(PoisonError::into_inner);
        Arc::clone(guard.as_ref().expect("filled"))
    }

    /// The core if it is open already.
    pub fn get(&self) -> Option<Arc<Core>> {
        lock(&self.core).clone()
    }
}

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
        Core::with(data_dir, storage, session_file, outputs, watcher)
    }

    /// A core whose data folder could not be opened at all (a panic while opening).
    pub fn failed(
        data_dir: PathBuf,
        session_file: PathBuf,
        output_dir: PathBuf,
        error: CommandError,
    ) -> Core {
        let outputs = OutputStore::open(output_dir).map_err(|e| {
            CommandError::internal(format!("cannot create the PDF output folder: {e}"))
        });
        Core::with(data_dir, Err(error), session_file, outputs, None)
    }

    fn with(
        data_dir: PathBuf,
        storage: Result<Arc<Storage>, CommandError>,
        session_file: PathBuf,
        outputs: Result<OutputStore, CommandError>,
        watcher: Option<Watcher>,
    ) -> Core {
        Core {
            data_dir,
            storage,
            presence: Presence::new(),
            session: LocalSession::new(session_file),
            auth: Auth::new(),
            watcher: Mutex::new(watcher),
            outputs,
            picked: Picked::default(),
        }
    }

    pub fn storage(&self) -> Result<&Storage, CommandError> {
        self.storage.as_deref().map_err(Clone::clone)
    }

    /// The data folder as configured (also when it could not be opened).
    pub fn data_dir(&self) -> &std::path::Path {
        &self.data_dir
    }

    /// The data folder (the opened root when it opened) and why it could not be opened.
    pub fn data_folder_status(&self) -> DataFolderStatus {
        match &self.storage {
            Ok(storage) => DataFolderStatus {
                data_dir: display_path(storage.data_dir().root()),
                error: None,
                app_version: storage.app_version().to_owned(),
                read_only: storage.read_only(),
            },
            Err(e) => DataFolderStatus {
                data_dir: display_path(&self.data_dir),
                error: Some(e.clone()),
                app_version: maatwerk_core::app_version::APP_VERSION.to_owned(),
                read_only: None,
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

    /// At start, on a background thread so it never delays the start: writes a snapshot when
    /// the newest one is older than the interval in `instellingen.json` (Step 7b).
    pub fn start_snapshot(self: &Arc<Core>) {
        let core = Arc::clone(self);
        let spawned = std::thread::Builder::new()
            .name("snapshot".into())
            .spawn(move || {
                let Ok(storage) = core.storage() else { return };
                let who = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "onbekend".into());
                match maatwerk_core::snapshots::run_if_due(
                    storage,
                    maatwerk_core::typst_svc::local_now(),
                    &who,
                ) {
                    Ok(outcome) => tracing::info!("snapshot: {outcome:?}"),
                    Err(e) => tracing::warn!("snapshot failed: {e}"),
                }
            });
        if let Err(e) = spawned {
            tracing::warn!("cannot start the snapshot thread: {e}");
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

    /// Review 6 m6: commands wait for the core opened in the background; a panic while
    /// opening still fills the slot.
    #[test]
    fn m6_commands_wait_for_the_core_and_a_panic_still_fills_the_slot() {
        let tmp = tempfile::tempdir().unwrap();
        let slot = Arc::new(CoreSlot::default());
        assert!(slot.get().is_none());
        let (gate_tx, gate_rx) = std::sync::mpsc::channel::<()>();
        let session = tmp.path().join("session.json");
        let output = tmp.path().join("output");
        let data = tmp.path().join("data");
        let (s2, o2, d2) = (session.clone(), output.clone(), data.clone());
        slot.open_in_background(
            move || {
                gate_rx.recv().unwrap();
                panic!("slow OneDrive, then a bug");
            },
            move |e| Core::failed(d2, s2, o2, e),
            |_| {},
        );
        let waiter = {
            let slot = Arc::clone(&slot);
            std::thread::spawn(move || slot.wait().data_folder_status())
        };
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert!(!waiter.is_finished(), "waits while the folder opens");
        gate_tx.send(()).unwrap();
        let status = waiter.join().unwrap();
        assert_eq!(status.error.unwrap().code, ErrorCode::Internal);
        assert_eq!(status.data_dir, display_path(&data));
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
