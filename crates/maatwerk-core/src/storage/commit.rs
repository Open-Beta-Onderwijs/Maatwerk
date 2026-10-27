// SPDX-License-Identifier: AGPL-3.0-or-later

//! The commit lock that makes "check the hash, then rename" atomic on one PC (S37 decision,
//! `docs/specs/storage-spec.md`).
//!
//! Two layers: a process-wide mutex per data folder (threads and several `Storage` handles), and
//! an OS file lock on a file in a **local** folder (other processes: a second app instance, the
//! CLI). Nothing is written to the shared data folder, so there is nothing for OneDrive to sync
//! and nothing left behind; the OS drops the lock when a process dies. Across PCs no lock can
//! help; CAS then detects what it can and OneDrive makes conflict copies.

use std::collections::HashMap;
use std::fs::{self, File, OpenOptions, TryLockError};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

use crate::error::{Error, Result};

/// How long a writer waits for another process before giving up with `locked`. Commits take
/// milliseconds; only a hung process holds the lock this long.
pub(crate) const DEFAULT_TIMEOUT: Duration = Duration::from_secs(10);

/// Default folder for the lock files: per user, local, never synced.
pub fn default_lock_dir() -> PathBuf {
    std::env::temp_dir().join("maatwerk-locks")
}

pub(crate) struct CommitLock {
    mutex: Arc<Mutex<()>>,
    file: PathBuf,
    pub(crate) timeout: Duration,
}

pub(crate) struct CommitGuard<'a> {
    _file: File,
    _mutex: MutexGuard<'a, ()>,
}

impl CommitLock {
    /// One lock per canonical data folder root.
    pub(crate) fn new(root: &Path, lock_dir: &Path) -> Result<CommitLock> {
        static MUTEXES: OnceLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> = OnceLock::new();
        let mutex = MUTEXES
            .get_or_init(Default::default)
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .entry(root.to_path_buf())
            .or_default()
            .clone();
        fs::create_dir_all(lock_dir).map_err(|e| Error::io(lock_dir.display().to_string(), e))?;
        let key = super::hash_hex(root.as_os_str().as_encoded_bytes());
        let file = lock_dir.join(format!("data-{}.lock", &key[..16]));
        Ok(CommitLock {
            mutex,
            file,
            timeout: DEFAULT_TIMEOUT,
        })
    }

    pub(crate) fn acquire(&self) -> Result<CommitGuard<'_>> {
        // A panic while holding the mutex leaves no broken state behind (the guarded data is
        // the filesystem), so a poisoned mutex is still usable.
        let guard = self.mutex.lock().unwrap_or_else(|p| p.into_inner());
        let shown = || self.file.display().to_string();
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(&self.file)
            .map_err(|e| Error::io(shown(), e))?;
        let start = Instant::now();
        loop {
            match file.try_lock() {
                Ok(()) => {
                    return Ok(CommitGuard {
                        _file: file,
                        _mutex: guard,
                    });
                }
                Err(TryLockError::WouldBlock) if start.elapsed() < self.timeout => {
                    std::thread::sleep(Duration::from_millis(5));
                }
                Err(TryLockError::WouldBlock) => return Err(Error::Locked { path: shown() }),
                Err(TryLockError::Error(e)) => return Err(Error::io(shown(), e)),
            }
        }
    }
}
