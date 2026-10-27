// SPDX-License-Identifier: AGPL-3.0-or-later

//! The watcher's state machine (reference `sync.js` `createWatcher`), without threads or real
//! timers: the caller passes the current [`Instant`] to every method and calls
//! [`Engine::advance`] when [`Engine::next_deadline`] is due. Tests drive it on a virtual clock
//! against a real temp folder (spec rows S28-S40).

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};

use serde_json::Value;

use super::{Change, ChangeKind};
use crate::paths::{DataDir, RelPath, is_year_name};
use crate::storage::hash_hex;

pub(crate) const DEBOUNCE: Duration = Duration::from_millis(500);
pub(crate) const FLUSH: Duration = Duration::from_millis(100);
pub(crate) const PARSE_RETRY: Duration = Duration::from_millis(1000);

/// Top-level folders that never hold shared app data (`sync.js` `IGNORED_DIRS`), plus the
/// port's `rapporten/` output folder (ADR-0002 section 4).
pub const IGNORED_DIRS: [&str; 5] = ["fotos", "bak", "templates", "temp", "rapporten"];

/// Whether a change to `rel` (posix, relative to the data folder) is reported (S31).
pub fn is_relevant(rel: &str) -> bool {
    let first = rel.split('/').next().unwrap_or("");
    if IGNORED_DIRS.contains(&first) {
        return false;
    }
    let base = rel.rsplit('/').next().unwrap_or("");
    if base.starts_with("_preview_") {
        return false;
    }
    // Node's `path.extname`: a leading dot alone is not an extension.
    match base.rfind('.') {
        Some(i) if i > 0 => {
            let ext = base[i + 1..].to_ascii_lowercase();
            ext == "json" || ext == "typ"
        }
        _ => false,
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Stat {
    mtime: Option<SystemTime>,
    size: u64,
}

#[derive(Debug, Clone)]
struct Known {
    stat: Stat,
    /// Filled in lazily, when the file is first checked or written by us.
    hash: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
enum Timer {
    /// Debounced check (`schedule`).
    Check,
    /// The one re-check of a file that did not parse (`check(rel, true)`).
    Retry,
}

pub(crate) struct Engine {
    dir: DataDir,
    known: HashMap<String, Known>,
    timers: HashMap<(String, Timer), Instant>,
    batch: Vec<Change>,
    flush_at: Option<Instant>,
    /// The year the poll covers. `None`: read `activeYear` from `config.json` as the reference
    /// does; set by the app once the year is per teacher (ADR-0003 C7).
    scope_year: Option<String>,
    /// Files this process is writing or deleting right now (between `will_change` and
    /// `note_write`/`note_delete`/`change_failed`). A check finding one waits: it could see
    /// our new bytes before `note_write` has recorded them (review 4b m1).
    in_flight: HashSet<String>,
}

/// Every relevant file below the root with its stat (a snapshot or poll walk). Runs without
/// the engine lock: it can take seconds on a large OneDrive folder.
pub(crate) type Scan = Vec<(String, Stat)>;

impl Engine {
    pub(crate) fn new(dir: DataDir) -> Engine {
        Engine {
            dir,
            known: HashMap::new(),
            timers: HashMap::new(),
            batch: vec![],
            flush_at: None,
            scope_year: None,
            in_flight: HashSet::new(),
        }
    }

    pub(crate) fn root_path(&self) -> PathBuf {
        self.root().to_path_buf()
    }

    fn root(&self) -> &Path {
        self.dir.root()
    }

    /// Initial snapshot: mtime and size of every relevant file (no hashes, so no file is read).
    #[cfg(test)]
    pub(crate) fn snapshot(&mut self) {
        let scan = scan_all(self.root());
        self.apply_snapshot(scan);
    }

    /// Records a snapshot scan; files our own writes recorded meanwhile keep their hash.
    pub(crate) fn apply_snapshot(&mut self, scan: Scan) {
        for (rel, stat) in scan {
            self.known.entry(rel).or_insert(Known { stat, hash: None });
        }
    }

    pub(crate) fn set_scope_year(&mut self, year: Option<String>) {
        self.scope_year = year;
    }

    /// A notification from the OS watcher for `abs`.
    pub(crate) fn on_event(&mut self, abs: &Path, now: Instant) {
        if let Some(rel) = self.dir.rel_of(abs)
            && is_relevant(&rel)
        {
            self.schedule(rel, now);
        }
    }

    /// Own write or delete about to happen (before the rename).
    pub(crate) fn will_change(&mut self, rel: &str) {
        if is_relevant(rel) {
            self.in_flight.insert(rel.to_owned());
        }
    }

    /// The own write or delete did not happen.
    pub(crate) fn change_failed(&mut self, rel: &str) {
        self.in_flight.remove(rel);
    }

    /// Own write: remember the hash so the change is not reported (S30). Ignored paths are not
    /// tracked: the reference did, so its poll re-checked them and reported a colleague's
    /// change to them despite S31 (review 4b m4, quirks.md).
    pub(crate) fn note_write(&mut self, rel: &str, content: &[u8]) {
        self.in_flight.remove(rel);
        if !is_relevant(rel) {
            return;
        }
        if let Some(stat) = self.stat_of(rel) {
            let hash = Some(hash_hex(content));
            self.known.insert(rel.to_owned(), Known { stat, hash });
        }
    }

    pub(crate) fn note_delete(&mut self, rel: &str) {
        self.in_flight.remove(rel);
        self.known.remove(rel);
    }

    fn schedule(&mut self, rel: String, now: Instant) {
        self.timers.insert((rel, Timer::Check), now + DEBOUNCE);
    }

    /// The earliest moment [`Engine::advance`] has work to do.
    pub(crate) fn next_deadline(&self) -> Option<Instant> {
        self.timers.values().copied().chain(self.flush_at).min()
    }

    /// Runs every timer due by `now` in deadline order (as the reference's `setTimeout`s would
    /// fire) and returns the batches flushed meanwhile.
    pub(crate) fn advance(&mut self, now: Instant) -> Vec<Vec<Change>> {
        let mut out = vec![];
        loop {
            let next_timer = self
                .timers
                .iter()
                .min_by(|a, b| a.1.cmp(b.1).then_with(|| a.0.cmp(b.0)))
                .map(|(k, t)| (k.clone(), *t));
            let flush_first = match (self.flush_at, &next_timer) {
                (Some(f), Some((_, t))) => f <= *t,
                (Some(_), None) => true,
                (None, _) => false,
            };
            if flush_first {
                let at = self.flush_at.expect("checked above");
                if at > now {
                    break;
                }
                self.flush_at = None;
                out.push(std::mem::take(&mut self.batch));
                continue;
            }
            let Some(((rel, kind), at)) = next_timer else {
                break;
            };
            if at > now {
                break;
            }
            self.timers.remove(&(rel.clone(), kind));
            self.check(&rel, kind == Timer::Retry, at);
        }
        out
    }

    fn emit(&mut self, change: Change, now: Instant) {
        self.batch.push(change);
        if self.flush_at.is_none() {
            self.flush_at = Some(now + FLUSH);
        }
    }

    fn check(&mut self, rel: &str, retried: bool, now: Instant) {
        if self.in_flight.contains(rel) {
            // Our own write is landing; look again once it is noted.
            self.schedule(rel.to_owned(), now);
            return;
        }
        let prev = self.known.get(rel).cloned();
        let bytes = match self.read(rel) {
            Ok(Some(bytes)) => bytes,
            Ok(None) => {
                if prev.is_some() {
                    self.known.remove(rel);
                    let change = Change::new(rel, ChangeKind::Deleted, None);
                    self.emit(change, now);
                }
                return;
            }
            // Unreadable right now (locked, S40); the next event or poll retries.
            Err(_) => return,
        };
        let hash = hash_hex(&bytes);
        let stat = self.stat_of(rel);
        if let Some(prev) = &prev {
            let same = match &prev.hash {
                Some(h) => *h == hash,
                None => stat.as_ref() == Some(&prev.stat), // S34
            };
            if same {
                if let Some(stat) = stat {
                    let hash = Some(hash);
                    self.known.insert(rel.to_owned(), Known { stat, hash });
                }
                return;
            }
        }
        let mut meta = None;
        if rel.ends_with(".json") {
            match serde_json::from_str::<Value>(&String::from_utf8_lossy(&bytes)) {
                Ok(Value::Object(mut map)) => {
                    meta = map.remove("_meta").filter(|m| !m.is_null());
                }
                Ok(_) => {}
                Err(_) => {
                    // Probably still being synced (S35): look once more shortly.
                    if !retried {
                        self.timers
                            .insert((rel.to_owned(), Timer::Retry), now + PARSE_RETRY);
                    }
                    return;
                }
            }
        }
        // The reference stores `{...undefined, hash}` when the stat fails here; a missing stat
        // then never equals a later one, which is what `Stat { mtime: None, size: 0 }` gives.
        let stat = stat.unwrap_or(Stat {
            mtime: None,
            size: 0,
        });
        let hash = Some(hash);
        self.known.insert(rel.to_owned(), Known { stat, hash });
        let kind = if prev.is_some() {
            ChangeKind::Changed
        } else {
            ChangeKind::Added
        };
        self.emit(Change::new(rel, kind, meta), now);
    }

    /// The year the poll covers: the override, else `config.json` `activeYear`.
    pub(crate) fn poll_year(&self) -> Option<String> {
        if let Some(year) = &self.scope_year {
            return Some(year.clone());
        }
        let bytes = fs::read(self.root().join("config.json")).ok()?;
        let config: Value = serde_json::from_slice(&bytes).ok()?;
        config.get("activeYear")?.as_str().map(str::to_owned)
    }

    #[cfg(test)]
    pub(crate) fn poll(&mut self, now: Instant) {
        let year = self.poll_year();
        let scan = scan_poll(self.root(), year.as_deref());
        self.apply_poll(year.as_deref(), scan, now);
    }

    /// Schedules a check for whatever the poll scan found changed, and for known files in scope
    /// it did not find (S32, S33).
    pub(crate) fn apply_poll(&mut self, year: Option<&str>, scan: Scan, now: Instant) {
        let in_scope = |rel: &str| match rel.split_once('/') {
            None => true,
            Some((first, _)) => Some(first) == year || !is_year_name(first),
        };
        let mut seen = HashSet::new();
        for (rel, stat) in scan {
            let changed = self.known.get(&rel).is_none_or(|k| k.stat != stat);
            seen.insert(rel.clone());
            if changed {
                self.schedule(rel, now);
            }
        }
        let gone: Vec<String> = self
            .known
            .keys()
            .filter(|rel| in_scope(rel) && !seen.contains(*rel))
            .cloned()
            .collect();
        for rel in gone {
            self.schedule(rel, now);
        }
    }

    /// Through the path guard: a link inside the data folder must not lead the watcher out.
    fn path_of(&self, rel: &str) -> Option<PathBuf> {
        self.dir.resolve(&RelPath::parse(rel).ok()?).ok()
    }

    fn read(&self, rel: &str) -> io::Result<Option<Vec<u8>>> {
        let Some(path) = self.path_of(rel) else {
            return Err(io::Error::other("path outside the data folder"));
        };
        match fs::read(path) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }

    fn stat_of(&self, rel: &str) -> Option<Stat> {
        stat_of(self.root(), rel)
    }
}

/// Without the path guard: the poll stats every file in scope every 20 s, and a stat exposes
/// nothing; only [`Engine::read`] needs the guard.
fn stat_of(root: &Path, rel: &str) -> Option<Stat> {
    let mut path = root.to_path_buf();
    path.extend(rel.split('/'));
    let meta = fs::metadata(path).ok()?;
    Some(Stat {
        mtime: meta.modified().ok(),
        size: meta.len(),
    })
}

/// Every relevant file (the snapshot).
pub(crate) fn scan_all(root: &Path) -> Scan {
    let mut found = vec![];
    walk(root, "", &mut |rel| found.push(rel));
    with_stats(root, found)
}

/// Relevant files outside year folders and in `year` (the poll, S32).
pub(crate) fn scan_poll(root: &Path, year: Option<&str>) -> Scan {
    let Ok(entries) = fs::read_dir(root) else {
        return vec![];
    };
    let mut found = vec![];
    for entry in entries.filter_map(|e| e.ok()) {
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            if IGNORED_DIRS.contains(&name.as_str())
                || (is_year_name(&name) && Some(name.as_str()) != year)
            {
                continue;
            }
            walk(root, &name, &mut |rel| found.push(rel));
        } else if file_type.is_file() && is_relevant(&name) {
            found.push(name);
        }
    }
    with_stats(root, found)
}

fn with_stats(root: &Path, rels: Vec<String>) -> Scan {
    rels.into_iter()
        .filter_map(|rel| stat_of(root, &rel).map(|stat| (rel, stat)))
        .collect()
}

/// Visits every relevant file below `root/rel_dir`, skipping the ignored top-level folders.
/// Links are not followed (Node's `Dirent.isDirectory()` is false for them).
fn walk(root: &Path, rel_dir: &str, visit: &mut dyn FnMut(String)) {
    let dir = if rel_dir.is_empty() {
        root.to_path_buf()
    } else {
        root.join(rel_dir)
    };
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        let rel = if rel_dir.is_empty() {
            name.clone()
        } else {
            format!("{rel_dir}/{name}")
        };
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            if rel_dir.is_empty() && IGNORED_DIRS.contains(&name.as_str()) {
                continue;
            }
            walk(root, &rel, visit);
        } else if file_type.is_file() && is_relevant(&rel) {
            visit(rel);
        }
    }
}
