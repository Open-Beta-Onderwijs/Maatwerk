// SPDX-License-Identifier: AGPL-3.0-or-later

//! Atomic file write: temp file next to the target, then rename over it (`sync.js:44-67`).

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

/// Renames tried before the last-resort direct write (S03, S04).
const RENAME_ATTEMPTS: u32 = 6;

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Writes `bytes` to `path` so readers never see a half-written file (S01, S02).
pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    write_atomic_with(
        path,
        bytes,
        &|from, to| fs::rename(from, to),
        &std::thread::sleep,
    )
}

/// [`write_atomic`] with the rename and sleep injected, for failure tests.
pub(crate) fn write_atomic_with(
    path: &Path,
    bytes: &[u8],
    rename: &dyn Fn(&Path, &Path) -> io::Result<()>,
    sleep: &dyn Fn(Duration),
) -> io::Result<()> {
    let tmp = TempFile::write(path, bytes)?;
    tmp.commit_with(path, bytes, rename, sleep)
}

/// A temp file written next to its target, not yet renamed over it. Writing it is the slow
/// part, so storage does it before taking the commit lock; dropping it without a commit removes
/// it.
pub(crate) struct TempFile {
    path: Option<PathBuf>,
}

impl TempFile {
    /// Creates missing parent folders and writes `bytes` to a fresh temp file.
    pub(crate) fn write(target: &Path, bytes: &[u8]) -> io::Result<TempFile> {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        let path = temp_path(target);
        let tmp = TempFile { path: Some(path) };
        fs::write(tmp.path.as_ref().unwrap(), bytes)?;
        Ok(tmp)
    }

    /// Renames the temp file over `target` (with retries and the direct-write fallback).
    pub(crate) fn commit(self, target: &Path, bytes: &[u8]) -> io::Result<()> {
        self.commit_with(
            target,
            bytes,
            &|from, to| fs::rename(from, to),
            &std::thread::sleep,
        )
    }

    fn commit_with(
        mut self,
        target: &Path,
        bytes: &[u8],
        rename: &dyn Fn(&Path, &Path) -> io::Result<()>,
        sleep: &dyn Fn(Duration),
    ) -> io::Result<()> {
        let tmp = self.path.take().expect("temp file committed twice");
        rename_or_write(&tmp, target, bytes, rename, sleep)
    }
}

impl Drop for TempFile {
    fn drop(&mut self) {
        if let Some(path) = self.path.take() {
            let _ = fs::remove_file(path);
        }
    }
}

fn rename_or_write(
    tmp: &Path,
    path: &Path,
    bytes: &[u8],
    rename: &dyn Fn(&Path, &Path) -> io::Result<()>,
    sleep: &dyn Fn(Duration),
) -> io::Result<()> {
    // OneDrive or a virus scanner can briefly hold the target open; retry the rename.
    let mut attempt = 0;
    loop {
        match rename(tmp, path) {
            Ok(()) => return Ok(()),
            Err(e) if attempt + 1 < RENAME_ATTEMPTS && is_sharing_error(&e) => {
                attempt += 1;
                sleep(Duration::from_millis(30 * u64::from(attempt)));
            }
            Err(_) => {
                // Last resort (S04, S05): a direct write is better than losing the change. A
                // crash here can leave a partial file; readers then refuse it (S24).
                let _ = fs::remove_file(tmp);
                return fs::write(path, bytes);
            }
        }
    }
}

/// `<target>.<pid>-<n>.tmp` in the target's folder (S06: same folder; a counter added because
/// the port writes from several threads).
fn temp_path(path: &Path) -> PathBuf {
    let n = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(format!(".{}-{n}.tmp", std::process::id()));
    path.with_file_name(name)
}

/// `EPERM`, `EBUSY`, `EACCES`, and on Windows access denied, sharing and lock violations.
fn is_sharing_error(e: &io::Error) -> bool {
    if matches!(
        e.kind(),
        io::ErrorKind::PermissionDenied | io::ErrorKind::ResourceBusy
    ) {
        return true;
    }
    let code = e.raw_os_error();
    if cfg!(windows) {
        matches!(code, Some(5 | 32 | 33))
    } else {
        matches!(code, Some(1 | 13 | 16))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    fn names_in(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        v.sort();
        v
    }

    #[test]
    fn s01_s02_writes_content_creates_parents_leaves_no_temp() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("a/b/c.json");
        write_atomic(&target, b"{}").unwrap();
        write_atomic(&target, b"[1]").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"[1]");
        assert_eq!(names_in(&tmp.path().join("a/b")), vec!["c.json"]);
    }

    #[test]
    fn s03_retries_sharing_errors_with_backoff() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("x.json");
        let calls = Cell::new(0);
        let sleeps = RefCell::new(vec![]);
        let rename = |a: &Path, b: &Path| {
            calls.set(calls.get() + 1);
            if calls.get() <= 3 {
                Err(io::Error::from(io::ErrorKind::PermissionDenied))
            } else {
                fs::rename(a, b)
            }
        };
        write_atomic_with(&target, b"ok", &rename, &|d| {
            sleeps.borrow_mut().push(d.as_millis())
        })
        .unwrap();
        assert_eq!(calls.get(), 4);
        assert_eq!(*sleeps.borrow(), vec![30, 60, 90]);
        assert_eq!(fs::read(&target).unwrap(), b"ok");
        assert_eq!(names_in(tmp.path()), vec!["x.json"]);
    }

    #[test]
    fn s04_after_six_failed_renames_removes_temp_and_writes_directly() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("x.json");
        let calls = Cell::new(0);
        let sleeps = RefCell::new(vec![]);
        let rename = |_: &Path, _: &Path| {
            calls.set(calls.get() + 1);
            Err(io::Error::from_raw_os_error(if cfg!(windows) {
                32
            } else {
                16
            }))
        };
        write_atomic_with(&target, b"direct", &rename, &|d| {
            sleeps.borrow_mut().push(d.as_millis())
        })
        .unwrap();
        assert_eq!(calls.get(), 6);
        assert_eq!(*sleeps.borrow(), vec![30, 60, 90, 120, 150]);
        assert_eq!(fs::read(&target).unwrap(), b"direct");
        assert_eq!(names_in(tmp.path()), vec!["x.json"]);
    }

    #[test]
    fn s05_other_rename_errors_write_directly_at_once() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("x.json");
        let calls = Cell::new(0);
        let rename = |_: &Path, _: &Path| {
            calls.set(calls.get() + 1);
            Err(io::Error::other("cross-device"))
        };
        write_atomic_with(&target, b"d", &rename, &|_| panic!("no sleep expected")).unwrap();
        assert_eq!(calls.get(), 1);
        assert_eq!(fs::read(&target).unwrap(), b"d");
        assert_eq!(names_in(tmp.path()), vec!["x.json"]);
    }

    #[test]
    fn s06_temp_file_sits_next_to_the_target() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("sub/x.json");
        let seen = RefCell::new(None);
        let rename = |a: &Path, b: &Path| {
            *seen.borrow_mut() = Some(a.to_path_buf());
            fs::rename(a, b)
        };
        write_atomic_with(&target, b"1", &rename, &|_| {}).unwrap();
        let tmp_path = seen.into_inner().unwrap();
        assert_eq!(tmp_path.parent(), target.parent());
        let name = tmp_path.file_name().unwrap().to_str().unwrap().to_owned();
        assert!(
            name.starts_with(&format!("x.json.{}-", std::process::id())),
            "{name}"
        );
        assert!(name.ends_with(".tmp"));
    }
}
