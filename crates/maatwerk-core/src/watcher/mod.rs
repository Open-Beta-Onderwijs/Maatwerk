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
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, PoisonError};
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

/// Timings of the driver; the defaults are the reference's constants.
#[derive(Debug, Clone)]
pub struct WatchOptions {
    pub poll: Duration,
    /// Wait before starting OS notifications again after an error (S39).
    pub restart: Duration,
}

impl Default for WatchOptions {
    fn default() -> Self {
        WatchOptions {
            poll: Duration::from_secs(20),
            restart: Duration::from_secs(30),
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

/// A running watcher. Stops when closed or dropped.
pub struct Watcher {
    engine: Arc<Mutex<Engine>>,
    tx: Sender<Msg>,
    thread: Option<JoinHandle<()>>,
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
        let engine = Arc::new(Mutex::new(Engine::new(dir.clone())));
        let (tx, rx) = mpsc::channel();
        let thread_engine = Arc::clone(&engine);
        let thread_tx = tx.clone();
        let thread = std::thread::Builder::new()
            .name("maatwerk-watcher".into())
            .spawn(move || {
                let root = dir.root().to_path_buf();
                lock(&thread_engine).snapshot();
                let mut os_watch = start_os_watch(&root, thread_tx.clone())
                    .inspect_err(|e| {
                        tracing::warn!("OS file notifications unavailable, polling only: {e}")
                    })
                    .ok();
                let mut restart_at: Option<Instant> = None;
                let mut next_poll = Instant::now() + options.poll;
                loop {
                    let now = Instant::now();
                    let wake = [
                        Some(next_poll),
                        restart_at,
                        lock(&thread_engine).next_deadline(),
                    ]
                    .into_iter()
                    .flatten()
                    .min()
                    .expect("next_poll is always set");
                    match rx.recv_timeout(wake.saturating_duration_since(now)) {
                        Ok(Msg::Paths(paths)) => {
                            let now = Instant::now();
                            let mut engine = lock(&thread_engine);
                            for path in &paths {
                                engine.on_event(path, now);
                            }
                        }
                        Ok(Msg::WatchError(e)) => {
                            // S39: close it, keep polling, try again later.
                            tracing::warn!("file notifications failed, polling only: {e}");
                            os_watch = None;
                            restart_at = Some(Instant::now() + options.restart);
                        }
                        Ok(Msg::Stop) | Err(RecvTimeoutError::Disconnected) => break,
                        Err(RecvTimeoutError::Timeout) => {}
                    }
                    let now = Instant::now();
                    if restart_at.is_some_and(|t| t <= now) {
                        restart_at = None;
                        match start_os_watch(&root, thread_tx.clone()) {
                            Ok(w) => os_watch = Some(w),
                            Err(e) => {
                                tracing::warn!("restarting file notifications failed: {e}");
                                restart_at = Some(now + options.restart);
                            }
                        }
                    }
                    if next_poll <= now {
                        lock(&thread_engine).poll(now);
                        next_poll = now + options.poll;
                    }
                    let batches = lock(&thread_engine).advance(now);
                    for batch in batches {
                        on_changes(batch);
                    }
                }
                drop(os_watch);
            })
            .expect("failed to start the watcher thread");
        Watcher {
            engine,
            tx,
            thread: Some(thread),
        }
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

struct Observer {
    engine: Arc<Mutex<Engine>>,
}

impl WriteObserver for Observer {
    fn note_write(&self, rel: &RelPath, content: &[u8]) {
        lock(&self.engine).note_write(rel.as_str(), content);
    }

    fn note_delete(&self, rel: &RelPath) {
        lock(&self.engine).note_delete(rel.as_str());
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
