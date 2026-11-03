// SPDX-License-Identifier: AGPL-3.0-or-later

//! Snapshots (Step 7b): at start, when the newest snapshot is older than the interval set in
//! `instellingen.json`, one app zips the data folder's JSON, `.typ` files and opdracht images to
//! `snapshots/<YYYY-MM-DD HHmm>.zip` and thins out old ones (newest per day, week and month).
//! A claim in `snapshots/state.json`, written with compare-and-swap, stops two colleagues who
//! start together from both zipping. Restoring the whole folder is a manual step
//! (`docs/cutover-runbook.md`); one JSON file can be restored from the newest snapshot that
//! holds an intact copy ("Herstellen uit snapshot", C19).

use std::collections::BTreeSet;
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::Path;
use std::time::{Duration, SystemTime};

use serde_json::{Value, json};
use time::{Date, OffsetDateTime, PrimitiveDateTime, Time};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::error::{Error, Result};
use crate::integrity::{self, StampState};
use crate::paths::{RelPath, display_path};
use crate::storage::{Expect, Storage, stamp_meta};

pub const DIR: &str = "snapshots";
pub const STATE_FILE: &str = "snapshots/state.json";
pub const SETTINGS_FILE: &str = "instellingen.json";
/// A claim older than this is from an app that stopped while zipping.
const CLAIM_STALE: Duration = Duration::from_secs(30 * 60);
/// How long a claim waits for OneDrive to bring in a competing one (review 7b m1).
const CLAIM_SETTLE: Duration = Duration::from_secs(45);
/// Top-level folders never zipped: the snapshots themselves, photos (size: measure a real copy
/// first, PLAN Step 7b), and leftovers the app does not use.
const SKIPPED_DIRS: [&str; 5] = [DIR, "fotos", "rapporten", "bak", "temp"];

/// The snapshot part of `instellingen.json` (`snapshots: { intervalHours, daily, weekly,
/// monthly }`). Missing or unusable values fall back to the defaults.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Settings {
    pub interval_hours: u32,
    /// Snapshots kept: the newest of this many days, ISO weeks and months.
    pub daily: u32,
    pub weekly: u32,
    pub monthly: u32,
}

impl Default for Settings {
    fn default() -> Settings {
        Settings {
            interval_hours: 24,
            daily: 7,
            weekly: 4,
            monthly: 12,
        }
    }
}

impl Settings {
    pub fn from_json(instellingen: Option<&Value>) -> Settings {
        let d = Settings::default();
        let s = instellingen.and_then(|v| v.get("snapshots"));
        let num = |key: &str, default: u32, min: u32, max: u32| {
            s.and_then(|s| s.get(key))
                .and_then(Value::as_f64)
                .filter(|n| n.fract() == 0.0 && *n >= f64::from(min) && *n <= f64::from(max))
                .map_or(default, |n| n as u32)
        };
        Settings {
            interval_hours: num("intervalHours", d.interval_hours, 1, 24 * 31),
            daily: num("daily", d.daily, 0, 366),
            weekly: num("weekly", d.weekly, 0, 520),
            monthly: num("monthly", d.monthly, 0, 1200),
        }
    }

    pub fn read(storage: &Storage) -> Settings {
        let value = RelPath::parse(SETTINGS_FILE)
            .ok()
            .and_then(|rel| storage.read_json(&rel).ok().flatten());
        Settings::from_json(value.as_ref())
    }
}

/// A snapshot zip in `snapshots/`, with the local time from its name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Snapshot {
    pub name: String,
    pub time: PrimitiveDateTime,
}

/// `2026-10-31 0815.zip`, `2026-10-31 0815 (2).zip` and OneDrive's conflict copy
/// `2026-10-31 0815-PCNAAM.zip` (so retention removes it); anything else is not a snapshot.
/// Only ASCII letters, digits, `-`, `_`, spaces and the brackets of ` (n)`: a name that passes
/// is a plain file name (review 7b M1).
fn parse_name(name: &str) -> Option<PrimitiveDateTime> {
    let stem = name.strip_suffix(".zip")?;
    let b = stem.as_bytes();
    if !stem.is_ascii() || b.len() < 15 || b[4] != b'-' || b[7] != b'-' || b[10] != b' ' {
        return None;
    }
    let rest = &stem[15..];
    let clash = rest
        .strip_prefix(" (")
        .and_then(|r| r.strip_suffix(')'))
        .is_some_and(|n| !n.is_empty() && n.bytes().all(|c| c.is_ascii_digit()));
    let conflict = rest.strip_prefix('-').is_some_and(|r| {
        !r.is_empty()
            && r.bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    });
    if !(rest.is_empty() || clash || conflict) {
        return None;
    }
    let n = |r: std::ops::Range<usize>| stem.get(r)?.parse::<u16>().ok();
    let date = Date::from_calendar_date(
        i32::from(n(0..4)?),
        time::Month::try_from(n(5..7)? as u8).ok()?,
        n(8..10)? as u8,
    )
    .ok()?;
    let time = Time::from_hms(n(11..13)? as u8, n(13..15)? as u8, 0).ok()?;
    Some(PrimitiveDateTime::new(date, time))
}

fn base_name(t: PrimitiveDateTime) -> String {
    format!(
        "{:04}-{:02}-{:02} {:02}{:02}",
        t.year(),
        u8::from(t.month()),
        t.day(),
        t.hour(),
        t.minute()
    )
}

fn local(t: OffsetDateTime) -> PrimitiveDateTime {
    PrimitiveDateTime::new(t.date(), t.time())
}

fn io_err(p: &Path, e: io::Error) -> Error {
    Error::io(display_path(p), e)
}

/// All snapshots, newest first.
pub fn list(storage: &Storage) -> Result<Vec<Snapshot>> {
    let dir = storage.data_dir().root().join(DIR);
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(io_err(&dir, e)),
    };
    let mut out: Vec<Snapshot> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|e| {
            let name = e.file_name().into_string().ok()?;
            Some(Snapshot {
                time: parse_name(&name)?,
                name,
            })
        })
        .collect();
    out.sort_by(|a, b| b.time.cmp(&a.time).then(b.name.cmp(&a.name)));
    Ok(out)
}

/// The data-relative files a snapshot holds: JSON and `.typ` files and opdracht images, not
/// the skipped folders or temp files. Sorted.
pub fn contents(root: &Path) -> Result<Vec<String>> {
    let all = crate::migrate::walk_all(root).map_err(|e| io_err(root, e))?;
    Ok(all
        .into_iter()
        .filter(|rel| {
            let parts: Vec<&str> = rel.split('/').collect();
            if SKIPPED_DIRS.contains(&parts[0]) {
                return false;
            }
            let base = parts[parts.len() - 1];
            if base.ends_with(".tmp") || base.ends_with(".partial") {
                return false;
            }
            let opdracht_image =
                parts.len() == 4 && parts[0] == "opdrachten" && parts[2] == "images";
            opdracht_image || base.ends_with(".json") || base.ends_with(".typ")
        })
        .collect())
}

/// Which snapshots to keep (`list` order, newest first): the newest one, and the newest of
/// each of the last `daily` days, `weekly` ISO weeks and `monthly` months that have one.
pub fn keep(snapshots: &[Snapshot], settings: Settings) -> BTreeSet<String> {
    fn newest_per<K: Ord>(
        snapshots: &[Snapshot],
        count: u32,
        key: impl Fn(&PrimitiveDateTime) -> K,
        keep: &mut BTreeSet<String>,
    ) {
        let mut seen = BTreeSet::new();
        for s in snapshots {
            if seen.len() >= count as usize {
                break;
            }
            if seen.insert(key(&s.time)) {
                keep.insert(s.name.clone());
            }
        }
    }
    let mut out = BTreeSet::new();
    if let Some(first) = snapshots.first() {
        out.insert(first.name.clone());
    }
    newest_per(snapshots, settings.daily, |t| t.date(), &mut out);
    newest_per(
        snapshots,
        settings.weekly,
        |t| {
            let (y, w, _) = t.date().to_iso_week_date();
            (y, w)
        },
        &mut out,
    );
    newest_per(
        snapshots,
        settings.monthly,
        |t| (t.year(), u8::from(t.month())),
        &mut out,
    );
    out
}

/// What [`run_if_due`] did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// The newest snapshot is recent enough.
    NotDue,
    /// Another app is writing one now.
    Busy,
    Written {
        name: String,
        files: usize,
        bytes: u64,
        removed: Vec<String>,
    },
}

fn ms(t: OffsetDateTime) -> i64 {
    (t.unix_timestamp_nanos() / 1_000_000) as i64
}

/// Writes a snapshot when the newest is older than the interval (or there is none), claiming
/// the job first; then removes the snapshots [`keep`] does not keep. `who` names this machine
/// in the claim. Blocking: run it on a background thread.
///
/// The claim in `state.json` lives in each PC's own OneDrive replica, so two PCs that start in
/// the same minute could both claim (review 7b m1). After claiming, this waits [`CLAIM_SETTLE`]
/// for OneDrive to sync and re-reads the state: if another PC's claim or a fresh snapshot came
/// in meanwhile, it gives up. When OneDrive is slower than that, both PCs still write one; that
/// only costs space (a same-name copy becomes an OneDrive conflict copy, which [`prune`]
/// removes).
pub fn run_if_due(storage: &Storage, now: OffsetDateTime, who: &str) -> Result<Outcome> {
    run_if_due_with(storage, now, who, &|| std::thread::sleep(CLAIM_SETTLE))
}

/// [`run_if_due`] with the settle wait passed in (tests run it at once, or let another "PC"
/// write meanwhile).
pub(crate) fn run_if_due_with(
    storage: &Storage,
    now: OffsetDateTime,
    who: &str,
    settle: &dyn Fn(),
) -> Result<Outcome> {
    let settings = Settings::read(storage);
    let interval = time::Duration::hours(i64::from(settings.interval_hours));
    // A snapshot dated more than a day ahead (a PC with a wrong clock) does not count, or it
    // would block snapshots everywhere until then (review 7b m5).
    let ahead = time::Duration::days(1);
    let newest = list(storage)?
        .into_iter()
        .map(|s| s.time)
        .find(|t| *t - local(now) < ahead);
    if newest.is_some_and(|t| local(now) - t < interval) {
        return Ok(Outcome::NotDue);
    }

    // Claim, unless someone holds a fresh claim or wrote one since the listing (it may not
    // have synced as a zip yet, but state.json is small).
    let state_rel = RelPath::parse(STATE_FILE)?;
    let read = storage.read_json_versioned(&state_rel)?;
    let state = read.as_ref().map_or(json!({}), |r| r.data.clone());
    let now_ms = ms(now);
    let field = |k: &str| state.get(k).and_then(Value::as_i64);
    let ahead_ms = ahead.whole_milliseconds() as i64;
    if field("lastAtMs")
        .is_some_and(|t| now_ms - t < interval.whole_milliseconds() as i64 && t - now_ms < ahead_ms)
    {
        return Ok(Outcome::NotDue);
    }
    let claimed = state
        .get("claim")
        .and_then(|c| c.get("atMs"))
        .and_then(Value::as_i64);
    if claimed.is_some_and(|t| now_ms - t < CLAIM_STALE.as_millis() as i64) {
        return Ok(Outcome::Busy);
    }
    let mut next = match state {
        Value::Object(m) => m,
        _ => Default::default(),
    };
    next.insert("claim".into(), json!({ "by": who, "atMs": now_ms }));
    let expect = match &read {
        Some(r) => Expect::Hash(&r.hash),
        None => Expect::Missing,
    };
    match storage.write_json(&state_rel, &Value::Object(next), expect) {
        Ok(_) => {}
        Err(Error::Conflict { .. }) => return Ok(Outcome::Busy),
        Err(e) => return Err(e),
    }

    settle();
    let state = storage.read_json(&state_rel)?.unwrap_or(json!({}));
    let ours = state.get("claim").is_some_and(|c| {
        c.get("by").and_then(Value::as_str) == Some(who)
            && c.get("atMs").and_then(Value::as_i64) == Some(now_ms)
    });
    if !ours {
        let fresh = state.get("lastAtMs").and_then(Value::as_i64).is_some_and(|t| {
            now_ms - t < interval.whole_milliseconds() as i64 && t - now_ms < ahead_ms
        });
        tracing::info!("snapshot claim lost to another PC while settling");
        return Ok(if fresh { Outcome::NotDue } else { Outcome::Busy });
    }

    let written = write_zip(storage, local(now));
    // Release the claim and, if it worked, note the snapshot.
    storage.update(
        &state_rel,
        || json!({}),
        |current, _| {
            let mut s = match current {
                Value::Object(m) => m,
                _ => Default::default(),
            };
            s.remove("claim");
            if let Ok((name, _, _)) = &written {
                s.insert("last".into(), Value::String(name.clone()));
                s.insert("lastAtMs".into(), Value::from(now_ms));
                s.insert("lastBy".into(), Value::String(who.to_owned()));
            }
            Ok(Value::Object(s))
        },
    )?;
    let (name, files, bytes) = written?;
    let removed = prune(storage, settings)?;
    Ok(Outcome::Written {
        name,
        files,
        bytes,
        removed,
    })
}

/// Zips [`contents`] to `snapshots/<time>.zip` (via `.zip.partial`, read back before the
/// rename). Returns the name, the number of files and the zip's size.
fn write_zip(storage: &Storage, at: PrimitiveDateTime) -> Result<(String, usize, u64)> {
    let root = storage.data_dir().root();
    let dir = root.join(DIR);
    fs::create_dir_all(&dir).map_err(|e| io_err(&dir, e))?;
    let base = base_name(at);
    let name = (1..)
        .map(|n| match n {
            1 => format!("{base}.zip"),
            n => format!("{base} ({n}).zip"),
        })
        .find(|n| !dir.join(n).exists())
        .expect("some free name");
    let target = dir.join(&name);
    let partial = dir.join(format!("{name}.partial"));
    let files = contents(root)?;
    let result = (|| {
        let file = File::create(&partial).map_err(|e| io_err(&partial, e))?;
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .large_file(true);
        let mut stored = 0;
        for rel in &files {
            // A file deleted since the listing (a colleague's change) is skipped.
            let bytes = match fs::read(root.join(rel)) {
                Ok(b) => b,
                Err(e) if e.kind() == io::ErrorKind::NotFound => continue,
                Err(e) => return Err(io_err(&root.join(rel), e)),
            };
            zip.start_file(rel.as_str(), options)
                .map_err(|e| io_err(&partial, io::Error::other(e)))?;
            zip.write_all(&bytes).map_err(|e| io_err(&partial, e))?;
            stored += 1;
        }
        let file = zip
            .finish()
            .map_err(|e| io_err(&partial, io::Error::other(e)))?;
        file.sync_all().map_err(|e| io_err(&partial, e))?;
        drop(file);
        check_zip(&partial, stored).map_err(|e| io_err(&partial, e))?;
        fs::rename(&partial, &target).map_err(|e| io_err(&target, e))?;
        let bytes = fs::metadata(&target).map_err(|e| io_err(&target, e))?.len();
        Ok((name.clone(), stored, bytes))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&partial);
    }
    result
}

/// Every entry decompresses with a good CRC.
fn check_zip(path: &Path, entries: usize) -> io::Result<()> {
    let mut zip = ZipArchive::new(File::open(path)?).map_err(io::Error::other)?;
    if zip.len() != entries {
        return Err(io::Error::other("snapshot is incomplete"));
    }
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(io::Error::other)?;
        io::copy(&mut entry, &mut io::sink())?;
    }
    Ok(())
}

/// Removes the snapshots [`keep`] does not keep; returns their names.
pub fn prune(storage: &Storage, settings: Settings) -> Result<Vec<String>> {
    let all = list(storage)?;
    let kept = keep(&all, settings);
    let dir = storage.data_dir().root().join(DIR);
    let mut removed = Vec::new();
    for s in all.into_iter().filter(|s| !kept.contains(&s.name)) {
        match fs::remove_file(dir.join(&s.name)) {
            Ok(()) => removed.push(s.name),
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => tracing::warn!("removing snapshot {} failed: {e}", s.name),
        }
    }
    Ok(removed)
}

/// The JSON value of `rel` in one snapshot; `None` when it does not hold the file.
fn read_entry(storage: &Storage, snapshot: &str, rel: &RelPath) -> Result<Option<Value>> {
    if parse_name(snapshot).is_none() {
        return Err(Error::InvalidArgument {
            message: format!("Geen snapshot: {snapshot}"),
        });
    }
    let path = storage.data_dir().root().join(DIR).join(snapshot);
    let file = match File::open(&path) {
        Ok(f) => f,
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            return Err(Error::NotFound {
                path: format!("{DIR}/{snapshot}"),
            });
        }
        Err(e) => return Err(io_err(&path, e)),
    };
    let mut zip = ZipArchive::new(file).map_err(|e| io_err(&path, io::Error::other(e)))?;
    let mut entry = match zip.by_name(rel.as_str()) {
        Ok(e) => e,
        Err(zip::result::ZipError::FileNotFound) => return Ok(None),
        Err(e) => return Err(io_err(&path, io::Error::other(e))),
    };
    let mut buf = Vec::new();
    entry.read_to_end(&mut buf).map_err(|e| io_err(&path, e))?;
    Ok(serde_json::from_slice(&buf).ok())
}

/// The newest snapshot holding an intact copy of the JSON file `rel` (good stamp).
pub fn find_intact_copy(storage: &Storage, rel: &RelPath) -> Result<Option<Snapshot>> {
    for s in list(storage)? {
        // An unreadable zip (still syncing) is skipped.
        if let Ok(Some(v)) = read_entry(storage, &s.name, rel)
            && integrity::check(&v) == StampState::Ok
        {
            return Ok(Some(s));
        }
    }
    Ok(None)
}

/// Fields of a user file that are never taken from a snapshot: a restore must not bring back
/// used recovery codes or an old PIN (review 7b M2).
const KEPT_USER_FIELDS: [&str; 2] = [crate::auth::PIN_FIELD, crate::auth::RECOVERY_FIELD];

/// "Herstellen uit snapshot": writes the snapshot's copy of the JSON file `rel` back, as a
/// compare-and-swap update that only goes ahead while the file on disk still has a missing or
/// wrong stamp (a save through Maatwerk since the check is kept: error `conflict`). An entity
/// file gets a fresh `_meta` (rev = disk + 1, `updatedBy` = `user_id`), so edits started from
/// the old version are conflicts; user files keep their PIN fields from disk.
pub fn restore_file(
    storage: &Storage,
    snapshot: &str,
    rel: &RelPath,
    user_id: Option<&str>,
    at: SystemTime,
) -> Result<()> {
    if rel.extension().as_deref() != Some("json") || rel.as_str().starts_with("snapshots/") {
        return Err(Error::InvalidPath {
            path: rel.to_string(),
            reason: "only data JSON files are restored",
        });
    }
    let value = read_entry(storage, snapshot, rel)?.ok_or_else(|| Error::NotFound {
        path: rel.to_string(),
    })?;
    let is_user = rel.as_str().starts_with("gebruikers/");
    storage.update(
        rel,
        || Value::Null,
        |_current, on_disk| {
            if let Some(disk) = on_disk
                && integrity::check(disk) == StampState::Ok
            {
                return Err(Error::Conflict {
                    path: rel.to_string(),
                    updated_by: disk
                        .get("_meta")
                        .and_then(|m| m.get("updatedBy"))
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                });
            }
            let Value::Object(mut obj) = value.clone() else {
                return Ok(value.clone());
            };
            if is_user {
                for key in KEPT_USER_FIELDS {
                    match on_disk.and_then(|d| d.get(key)) {
                        Some(v) => obj.insert(key.into(), v.clone()),
                        None => obj.remove(key),
                    };
                }
            }
            let entity = obj.get("_meta").and_then(|m| m.get("rev")).is_some();
            Ok(if entity {
                stamp_meta(obj, on_disk, user_id, at)
            } else {
                Value::Object(obj)
            })
        },
    )?;
    Ok(())
}

#[cfg(test)]
mod tests;
