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

/// Default folder for the lock files: per user, local, never synced. `%LOCALAPPDATA%` rather
/// than `%TEMP%`, whose value a process can change (review 4a m2). Exclusion covers processes of
/// the same user on this PC; another user on the same PC has their own OneDrive copy anyway.
///
/// Elsewhere also per user (step 16b): a shared `/tmp/maatwerk-locks` made by one user is not
/// writable for the next, whose saves would then fail. Linux: `$XDG_RUNTIME_DIR` (private,
/// cleared at logout), else `~/.cache`; macOS: `~/Library/Caches`.
pub fn default_lock_dir() -> PathBuf {
    lock_dir_from(|name| std::env::var_os(name), std::env::temp_dir)
}

fn lock_dir_from(
    var: impl Fn(&str) -> Option<std::ffi::OsString>,
    temp: impl FnOnce() -> PathBuf,
) -> PathBuf {
    let var = |name: &str| var(name).filter(|v| !v.is_empty()).map(PathBuf::from);
    if let Some(local) = var("LOCALAPPDATA") {
        return local.join("maatwerk").join("locks");
    }
    let home = var("HOME");
    if cfg!(target_os = "macos") {
        if let Some(home) = home {
            return home.join("Library/Caches/maatwerk/locks");
        }
    } else if let Some(run) = var("XDG_RUNTIME_DIR") {
        return run.join("maatwerk-locks");
    } else if let Some(cache) = var("XDG_CACHE_HOME").or_else(|| home.map(|h| h.join(".cache"))) {
        return cache.join("maatwerk").join("locks");
    }
    temp().join("maatwerk-locks")
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

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(vars: &[(&str, &str)]) -> PathBuf {
        let vars: HashMap<String, String> = vars
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        lock_dir_from(|n| vars.get(n).map(Into::into), || PathBuf::from("/tmp"))
    }

    #[test]
    fn the_lock_dir_is_per_user_on_every_platform() {
        let win = dir(&[("LOCALAPPDATA", "C:/Users/a/AppData/Local"), ("HOME", "/h")]);
        assert_eq!(win, Path::new("C:/Users/a/AppData/Local/maatwerk/locks"));
        let run = dir(&[("XDG_RUNTIME_DIR", "/run/user/1000"), ("HOME", "/home/a")]);
        let home = dir(&[("HOME", "/home/a")]);
        if cfg!(target_os = "macos") {
            assert_eq!(run, Path::new("/home/a/Library/Caches/maatwerk/locks"));
            assert_eq!(home, run);
        } else {
            assert_eq!(run, Path::new("/run/user/1000/maatwerk-locks"));
            assert_eq!(home, Path::new("/home/a/.cache/maatwerk/locks"));
            let cache = dir(&[("XDG_CACHE_HOME", "/c"), ("HOME", "/home/a")]);
            assert_eq!(cache, Path::new("/c/maatwerk/locks"));
        }
        assert_eq!(
            dir(&[("HOME", "")]),
            Path::new("/tmp/maatwerk-locks"),
            "last resort"
        );
    }
}
