// SPDX-License-Identifier: AGPL-3.0-or-later

//! Presence files `aanwezigheid/<userId>.json` (`users/` before format v3): who is online and
//! where (reference `main.js:398-436`, `presence:update`). Only this app writes the logged-in
//! teacher's file; on logout, a user switch or quit it is marked offline so colleagues see them
//! leave at once. Files of teachers who have not been seen for 30 days are removed at start (D20:
//! the reference never deleted one).
//!
//! The file is the teacher's own heartbeat, written every 15 s by the UI, so it is written
//! without CAS (no one else writes it). Write errors are logged, not returned, as in the
//! reference: a missed heartbeat must not disturb the teacher.

use std::sync::{Mutex, PoisonError};
use std::time::SystemTime;

use serde_json::{Map, Value};

use crate::error::{Error, Result};
use crate::paths::RelPath;
use crate::storage::{Expect, PRESENCE_DIR, Storage, iso_utc};

/// What this app last wrote: the user and their state (`None` if the UI sent none).
#[derive(Default)]
pub struct Presence {
    state: Mutex<State>,
}

#[derive(Default)]
struct State {
    last: Option<(String, Option<Value>)>,
    /// Set on quit: a heartbeat still in flight must not mark the teacher online again (Tauri
    /// runs commands concurrently, review 4b m3).
    closed: bool,
}

impl Presence {
    pub fn new() -> Presence {
        Presence::default()
    }

    /// `presence:update`: a different user than last time is first marked offline; `None` or
    /// an empty id means logged out. Fails only for a user id that is not a plain file name.
    pub fn update(
        &self,
        storage: &Storage,
        user_id: Option<&str>,
        state: Option<Value>,
    ) -> Result<()> {
        let user_id = user_id.filter(|id| !id.is_empty());
        let mut guard = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        if guard.closed {
            return Ok(());
        }
        let last = &mut guard.last;
        // The previous user goes offline first, as in the reference, even if the new id is bad.
        if last
            .as_ref()
            .is_some_and(|(id, _)| Some(id.as_str()) != user_id)
        {
            mark_offline(storage, last, SystemTime::now());
        }
        let Some(user_id) = user_id else {
            return Ok(());
        };
        let rel = presence_path(user_id)?;
        if let Some(state) = &state {
            write(storage, &rel, state);
        }
        *last = Some((user_id.to_owned(), state));
        Ok(())
    }

    /// On quit: marks the last user offline (`before-quit`, `window-all-closed`) and ignores
    /// any later update.
    pub fn close(&self, storage: &Storage) {
        let mut guard = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        guard.closed = true;
        mark_offline(storage, &mut guard.last, SystemTime::now());
    }
}

/// `{ ...state, online: false, scoreModal: null, heartbeatAt: now }`.
fn mark_offline(storage: &Storage, last: &mut Option<(String, Option<Value>)>, now: SystemTime) {
    let Some((user_id, state)) = last.take() else {
        return;
    };
    let mut map = match state {
        Some(Value::Object(map)) => map,
        _ => Map::new(),
    };
    map.insert("online".into(), Value::Bool(false));
    map.insert("scoreModal".into(), Value::Null);
    map.insert("heartbeatAt".into(), Value::String(iso_utc(now)));
    if let Ok(rel) = presence_path(&user_id) {
        write(storage, &rel, &Value::Object(map));
    }
}

fn write(storage: &Storage, rel: &RelPath, state: &Value) {
    // A read-only app (newer `minAppVersion`) shows no presence instead of a warning per beat.
    if storage.read_only().is_some() {
        return;
    }
    if let Err(e) = storage.write_json(rel, state, Expect::Any) {
        tracing::warn!("presence write failed: {e}");
    }
}

/// `aanwezigheid/<userId>.json`; the id must be one file name (the reference did not check it).
fn presence_path(user_id: &str) -> Result<RelPath> {
    if user_id.contains(['/', '\\']) || user_id == "." || user_id == ".." {
        return Err(Error::InvalidArgument {
            message: format!("not a user id: {user_id:?}"),
        });
    }
    RelPath::parse(&format!("{PRESENCE_DIR}/{user_id}.json"))
}

/// A presence file older than this is a teacher who left (or an account that is gone).
const STALE_AFTER: std::time::Duration = std::time::Duration::from_secs(30 * 24 * 3600);

/// D20: removes the presence files whose `heartbeatAt` is more than 30 days before `now`, or that
/// have none. Every app does this at start; a file another app removed first is fine. Returns how
/// many it removed.
pub fn prune_stale(storage: &Storage, now: SystemTime) -> usize {
    if storage.read_only().is_some() {
        return 0;
    }
    let Ok(dir) = RelPath::parse(PRESENCE_DIR) else {
        return 0;
    };
    let cutoff = iso_utc(now - STALE_AFTER);
    let mut removed = 0;
    for name in storage.list_dir(&dir, false).unwrap_or_default() {
        let Some(rel) = name
            .strip_suffix(".json")
            .and_then(|id| presence_path(id).ok())
        else {
            continue;
        };
        // `iso_utc` strings of the same shape compare like the times they stand for.
        let stale = match storage.read_json(&rel) {
            Ok(Some(v)) => v
                .get("heartbeatAt")
                .and_then(Value::as_str)
                .is_none_or(|at| at < cutoff.as_str()),
            Ok(None) => false,
            Err(_) => false, // half synced: leave it
        };
        if stale {
            match storage.delete(&rel) {
                Ok(()) => removed += 1,
                Err(e) => tracing::warn!("removing stale presence {rel} failed: {e}"),
            }
        }
    }
    removed
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn storage() -> (tempfile::TempDir, tempfile::TempDir, Storage) {
        let data = tempfile::tempdir().unwrap();
        let locks = tempfile::tempdir().unwrap();
        let storage = Storage::open_with_lock_dir(data.path(), locks.path()).unwrap();
        (data, locks, storage)
    }

    /// The file without its integrity stamp (C19).
    fn read(storage: &Storage, user: &str) -> Option<Value> {
        let mut v = storage
            .read_json(&RelPath::parse(&format!("aanwezigheid/{user}.json")).unwrap())
            .unwrap()?;
        v.as_object_mut()?.shift_remove("_meta");
        Some(v)
    }

    fn state(user: &str) -> Value {
        json!({"userId": user, "online": true, "heartbeatAt": "2026-10-27T08:00:00.000Z",
               "scoreModal": {"examId": "t1"}})
    }

    #[test]
    fn writes_the_state_as_is() {
        let (_d, _l, s) = storage();
        let p = Presence::new();
        p.update(&s, Some("jan"), Some(state("jan"))).unwrap();
        assert_eq!(read(&s, "jan"), Some(state("jan")));
        let text = s
            .read_text(&RelPath::parse("aanwezigheid/jan.json").unwrap())
            .unwrap()
            .unwrap();
        assert!(
            text.starts_with("{\n  \"userId\": \"jan\""),
            "JSON.stringify layout"
        );
    }

    #[test]
    fn logout_marks_the_user_offline_keeping_other_fields() {
        let (_d, _l, s) = storage();
        let p = Presence::new();
        p.update(&s, Some("jan"), Some(state("jan"))).unwrap();
        p.update(&s, None, None).unwrap();
        let file = read(&s, "jan").unwrap();
        assert_eq!(file["userId"], "jan");
        assert_eq!(file["online"], false);
        assert_eq!(file["scoreModal"], Value::Null);
        assert_ne!(file["heartbeatAt"], "2026-10-27T08:00:00.000Z");
        // Key order: the state's keys keep their place.
        let keys: Vec<&String> = file.as_object().unwrap().keys().collect();
        assert_eq!(keys, ["userId", "online", "heartbeatAt", "scoreModal"]);
    }

    #[test]
    fn a_user_switch_marks_the_previous_user_offline() {
        let (_d, _l, s) = storage();
        let p = Presence::new();
        p.update(&s, Some("jan"), Some(state("jan"))).unwrap();
        p.update(&s, Some("piet"), Some(state("piet"))).unwrap();
        assert_eq!(read(&s, "jan").unwrap()["online"], false);
        assert_eq!(read(&s, "piet").unwrap()["online"], true);
    }

    #[test]
    fn the_same_user_again_is_not_marked_offline_in_between() {
        let (_d, _l, s) = storage();
        let p = Presence::new();
        p.update(&s, Some("jan"), Some(state("jan"))).unwrap();
        p.update(&s, Some("jan"), Some(state("jan"))).unwrap();
        assert_eq!(read(&s, "jan").unwrap()["online"], true);
    }

    #[test]
    fn after_quit_a_late_heartbeat_is_ignored() {
        let (_d, _l, s) = storage();
        let p = Presence::new();
        p.update(&s, Some("jan"), Some(state("jan"))).unwrap();
        p.close(&s);
        p.update(&s, Some("jan"), Some(state("jan"))).unwrap();
        assert_eq!(read(&s, "jan").unwrap()["online"], false);
    }

    #[test]
    fn an_invalid_new_id_still_marks_the_previous_user_offline() {
        let (_d, _l, s) = storage();
        let p = Presence::new();
        p.update(&s, Some("jan"), Some(state("jan"))).unwrap();
        assert!(p.update(&s, Some("a/b"), Some(json!({}))).is_err());
        assert_eq!(read(&s, "jan").unwrap()["online"], false);
    }

    #[test]
    fn quit_without_a_user_writes_nothing() {
        let (_d, _l, s) = storage();
        Presence::new().close(&s);
        assert!(
            s.read_all_json(&RelPath::parse("aanwezigheid").unwrap())
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn mark_offline_on_quit_runs_once() {
        let (_d, _l, s) = storage();
        let p = Presence::new();
        p.update(&s, Some("jan"), Some(state("jan"))).unwrap();
        p.close(&s);
        assert_eq!(read(&s, "jan").unwrap()["online"], false);
        s.write_json(
            &RelPath::parse("aanwezigheid/jan.json").unwrap(),
            &json!({"online": true}),
            Expect::Any,
        )
        .unwrap();
        p.close(&s);
        assert_eq!(read(&s, "jan").unwrap()["online"], true, "already marked");
    }

    #[test]
    fn without_state_nothing_is_written_but_logout_still_marks_offline() {
        let (_d, _l, s) = storage();
        let p = Presence::new();
        p.update(&s, Some("jan"), None).unwrap();
        assert_eq!(read(&s, "jan"), None);
        p.update(&s, Some(""), None).unwrap();
        let file = read(&s, "jan").unwrap();
        assert_eq!(file["online"], false);
    }

    #[test]
    fn d20_stale_presence_files_are_removed_at_start() {
        let (_d, _l, s) = storage();
        let now = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_793_369_100);
        let day = std::time::Duration::from_secs(24 * 3600);
        let put = |user: &str, v: Value| {
            s.write_json(&presence_path(user).unwrap(), &v, Expect::Any)
                .unwrap();
        };
        put("vers", json!({ "heartbeatAt": iso_utc(now - day) }));
        put("grens", json!({ "heartbeatAt": iso_utc(now - 29 * day) }));
        put("oud", json!({ "heartbeatAt": iso_utc(now - 31 * day) }));
        put("leeg", json!({ "userId": "leeg" }));
        assert_eq!(prune_stale(&s, now), 2);
        assert!(read(&s, "vers").is_some());
        assert!(read(&s, "grens").is_some());
        assert_eq!(read(&s, "oud"), None);
        assert_eq!(read(&s, "leeg"), None);
        assert_eq!(prune_stale(&s, now), 0, "a second app finds nothing left");
    }

    #[test]
    fn rejects_user_ids_that_are_not_a_file_name() {
        let (_d, _l, s) = storage();
        let p = Presence::new();
        for id in ["../x", "a/b", "a\\b", "..", "con"] {
            let err = p.update(&s, Some(id), Some(json!({}))).unwrap_err();
            assert!(
                matches!(
                    err,
                    Error::InvalidArgument { .. } | Error::InvalidPath { .. }
                ),
                "{id}: {err}"
            );
        }
    }
}
