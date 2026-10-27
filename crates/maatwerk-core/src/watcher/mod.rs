// SPDX-License-Identifier: AGPL-3.0-or-later

//! Reports files that someone else changed in the data folder (reference `sync.js`
//! `createWatcher`; spec rows S28-S40, ADR-0002 section 4).
//!
//! OS notifications (`notify`) give fast updates; a poll every 20 s catches what OneDrive
//! swallows. Own writes reach the watcher through [`WriteObserver`] and are never reported.
//! All work runs on the watcher's own thread; the callback is called there, never while the
//! watcher's state is locked.

mod engine;

use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;

pub use engine::{IGNORED_DIRS, is_relevant};

use crate::paths::{DataDir, RelPath};
use crate::storage::WriteObserver;
use engine::Engine;

/// One reported change (`data:changed` payload item).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    /// Posix path relative to the data folder.
    pub rel_path: String,
    pub kind: ChangeKind,
    /// The file's `_meta` for a JSON object, else `None` (S29).
    pub meta: Option<Value>,
}

impl Change {
    fn new(rel: &str, kind: ChangeKind, meta: Option<Value>) -> Change {
        Change {
            rel_path: rel.to_owned(),
            kind,
            meta,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeKind {
    Added,
    Changed,
    Deleted,
}

/// Timings of the driver; the defaults are the reference's constants plus `refresh`.
#[derive(Debug, Clone)]
pub struct WatchOptions {
    /// Must be longer than the 500 ms debounce, or each poll postpones the checks it scheduled.
    pub poll: Duration,
    /// Wait before starting OS notifications again after an error (S39).
    pub restart: Duration,
    /// OS notifications are also started afresh this often. On Windows `notify` stops a watch
    /// on an unknown `ReadDirectoryChangesW` error without telling anyone (review 4b M1), and
    /// the poll covers only the active year.
    pub refresh: Duration,
}

impl Default for WatchOptions {
    fn default() -> Self {
        WatchOptions {
            poll: Duration::from_secs(20),
            restart: Duration::from_secs(30),
            refresh: Duration::from_secs(60),
        }
    }
}

enum Msg {
    Paths(Vec<PathBuf>),
    WatchError(String),
    Stop,
}

/// Starts OS notifications for a folder and sends them to the driver; the returned value
/// keeps them running until dropped.
type StartOsWatch = dyn Fn(&Path, Sender<Msg>) -> Result<Box<dyn Send>, String> + Send;

/// Set once the initial snapshot is taken and OS notifications are started.
type Ready = Arc<(Mutex<bool>, Condvar)>;

/// A running watcher. Stops when closed or dropped.
pub struct Watcher {
    engine: Arc<Mutex<Engine>>,
    tx: Sender<Msg>,
    thread: Option<JoinHandle<()>>,
    #[cfg_attr(not(test), allow(dead_code))]
    ready: Ready,
}

impl Watcher {
    /// Starts watching `dir`; `on_changes` receives each batch of external changes.
    pub fn start(
        dir: DataDir,
        options: WatchOptions,
        on_changes: impl Fn(Vec<Change>) + Send + 'static,
    ) -> Watcher {
        Watcher::start_with(dir, options, Box::new(start_notify), on_changes)
    }

    fn start_with(
        dir: DataDir,
        options: WatchOptions,
        start_os_watch: Box<StartOsWatch>,
        on_changes: impl Fn(Vec<Change>) + Send + 'static,
    ) -> Watcher {
        assert!(
            options.poll > engine::DEBOUNCE,
            "the poll interval must exceed the debounce"
        );
        let engine = Arc::new(Mutex::new(Engine::new(dir)));
        let (tx, rx) = mpsc::channel();
        let ready: Ready = Arc::new((Mutex::new(false), Condvar::new()));
        let driver = Driver {
            engine: Arc::clone(&engine),
            tx: tx.clone(),
            options,
            start_os_watch,
        };
        let thread_ready = Arc::clone(&ready);
        let thread = std::thread::Builder::new()
            .name("maatwerk-watcher".into())
            .spawn(move || driver.run(&rx, &thread_ready, &on_changes))
            .expect("failed to start the watcher thread");
        Watcher {
            engine,
            tx,
            thread: Some(thread),
            ready,
        }
    }

    /// Waits until the snapshot is taken and notifications run (tests).
    #[cfg(test)]
    fn wait_ready(&self) {
        let (flag, cv) = &*self.ready;
        let guard = flag.lock().unwrap_or_else(PoisonError::into_inner);
        let _ready = cv
            .wait_timeout_while(guard, Duration::from_secs(10), |ready| !*ready)
            .unwrap_or_else(PoisonError::into_inner);
    }

    /// The observer to install on the [`crate::storage::Storage`] of the same folder (S30).
    pub fn observer(&self) -> Arc<dyn WriteObserver> {
        Arc::new(Observer {
            engine: Arc::clone(&self.engine),
        })
    }

    /// Restricts the poll to this year's folder; `None` goes back to `config.json`
    /// `activeYear` (S32, ADR-0003 C7).
    pub fn set_scope_year(&self, year: Option<String>) {
        lock(&self.engine).set_scope_year(year);
    }

    /// Stops the thread and waits for it.
    pub fn close(mut self) {
        self.stop();
    }

    fn stop(&mut self) {
        let _ = self.tx.send(Msg::Stop);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for Watcher {
    fn drop(&mut self) {
        self.stop();
    }
}

/// The watcher thread. Directory walks run without the engine lock (review 4b m2): the
/// storage's observer takes that lock while holding the commit lock.
struct Driver {
    engine: Arc<Mutex<Engine>>,
    tx: Sender<Msg>,
    options: WatchOptions,
    start_os_watch: Box<StartOsWatch>,
}

impl Driver {
    fn run(self, rx: &Receiver<Msg>, ready: &Ready, on_changes: &dyn Fn(Vec<Change>)) {
        let root = lock(&self.engine).root_path();
        let scan = engine::scan_all(&root);
        lock(&self.engine).apply_snapshot(scan);
        let mut os_watch = None;
        let mut next_start = Instant::now();
        self.start_os_watch(&root, &mut os_watch, &mut next_start);
        {
            let (flag, cv) = &**ready;
            *flag.lock().unwrap_or_else(PoisonError::into_inner) = true;
            cv.notify_all();
        }
        let mut next_poll = Instant::now() + self.options.poll;
        loop {
            let now = Instant::now();
            let wake = [
                Some(next_poll),
                Some(next_start),
                lock(&self.engine).next_deadline(),
            ]
            .into_iter()
            .flatten()
            .min()
            .expect("always set");
            match rx.recv_timeout(wake.saturating_duration_since(now)) {
                Ok(Msg::Paths(paths)) => {
                    let now = Instant::now();
                    let mut engine = lock(&self.engine);
                    for path in &paths {
                        engine.on_event(path, now);
                    }
                }
                Ok(Msg::WatchError(e)) => {
                    // S39: close it, keep polling, try again later.
                    tracing::warn!("file notifications failed, polling only: {e}");
                    os_watch = None;
                    next_start = Instant::now() + self.options.restart;
                }
                Ok(Msg::Stop) | Err(RecvTimeoutError::Disconnected) => break,
                Err(RecvTimeoutError::Timeout) => {}
            }
            if next_start <= Instant::now() {
                self.start_os_watch(&root, &mut os_watch, &mut next_start);
            }
            if next_poll <= Instant::now() {
                let year = lock(&self.engine).poll_year();
                let scan = engine::scan_poll(&root, year.as_deref());
                lock(&self.engine).apply_poll(year.as_deref(), scan, Instant::now());
                next_poll = Instant::now() + self.options.poll;
            }
            let batches = lock(&self.engine).advance(Instant::now());
            for batch in batches {
                on_changes(batch);
            }
        }
    }

    /// Starts a new OS watch; the old one is dropped only after the new one runs, so no event
    /// falls in between (a few may arrive twice, which only re-schedules a check).
    fn start_os_watch(
        &self,
        root: &Path,
        os_watch: &mut Option<Box<dyn Send>>,
        next_start: &mut Instant,
    ) {
        match (self.start_os_watch)(root, self.tx.clone()) {
            Ok(w) => {
                *os_watch = Some(w);
                *next_start = Instant::now() + self.options.refresh;
            }
            Err(e) => {
                tracing::warn!("file notifications unavailable, polling only: {e}");
                *next_start = Instant::now() + self.options.restart;
            }
        }
    }
}

struct Observer {
    engine: Arc<Mutex<Engine>>,
}

impl WriteObserver for Observer {
    fn will_change(&self, rel: &RelPath) {
        lock(&self.engine).will_change(rel.as_str());
    }

    fn note_write(&self, rel: &RelPath, content: &[u8]) {
        lock(&self.engine).note_write(rel.as_str(), content);
    }

    fn note_delete(&self, rel: &RelPath) {
        lock(&self.engine).note_delete(rel.as_str());
    }

    fn change_failed(&self, rel: &RelPath) {
        lock(&self.engine).change_failed(rel.as_str());
    }
}

/// The engine holds no invariant a panic could break halfway, so a poisoned lock is used as is.
fn lock(engine: &Mutex<Engine>) -> std::sync::MutexGuard<'_, Engine> {
    engine.lock().unwrap_or_else(PoisonError::into_inner)
}

fn start_notify(root: &Path, tx: Sender<Msg>) -> Result<Box<dyn Send>, String> {
    use notify::{RecursiveMode, Watcher as _};
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let msg = match res {
            Ok(event) => Msg::Paths(event.paths),
            Err(e) => Msg::WatchError(e.to_string()),
        };
        let _ = tx.send(msg);
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watch(root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    Ok(Box::new(watcher))
}

#[cfg(test)]
mod tests;
