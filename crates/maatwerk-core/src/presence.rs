// SPDX-License-Identifier: AGPL-3.0-or-later

//! Presence files `users/<userId>.json`: who is online and where (reference `main.js:398-436`,
//! `presence:update`). Only this app writes the logged-in teacher's file; on logout, a user
//! switch or quit it is marked offline so colleagues see them leave at once.
//!
//! The file is the teacher's own heartbeat, written every 15 s by the UI, so it is written
//! without CAS (no one else writes it). Write errors are logged, not returned, as in the
//! reference: a missed heartbeat must not disturb the teacher.

use std::sync::{Mutex, PoisonError};
use std::time::SystemTime;

use serde_json::{Map, Value};

use crate::error::{Error, Result};
use crate::paths::RelPath;
use crate::storage::{Expect, Storage, iso_utc};

/// What this app last wrote: the user and their state (`None` if the UI sent none).
#[derive(Default)]
pub struct Presence {
    last: Mutex<Option<(String, Option<Value>)>>,
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
        let rel = user_id.map(presence_path).transpose()?;
        let mut last = self.last.lock().unwrap_or_else(PoisonError::into_inner);
        if last
            .as_ref()
            .is_some_and(|(id, _)| Some(id.as_str()) != user_id)
        {
            mark_offline(storage, &mut last, SystemTime::now());
        }
        let (Some(user_id), Some(rel)) = (user_id, rel) else {
            return Ok(());
        };
        if let Some(state) = &state {
            write(storage, &rel, state);
        }
        *last = Some((user_id.to_owned(), state));
        Ok(())
    }

    /// On quit: marks the last user offline (`before-quit`, `window-all-closed`).
    pub fn mark_offline(&self, storage: &Storage) {
        let mut last = self.last.lock().unwrap_or_else(PoisonError::into_inner);
        mark_offline(storage, &mut last, SystemTime::now());
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
    if let Err(e) = storage.write_json(rel, state, Expect::Any) {
        tracing::warn!("presence write failed: {e}");
    }
}

/// `users/<userId>.json`; the id must be one file name (the reference did not check it).
fn presence_path(user_id: &str) -> Result<RelPath> {
    if user_id.contains(['/', '\\']) || user_id == "." || user_id == ".." {
        return Err(Error::InvalidArgument {
            message: format!("not a user id: {user_id:?}"),
        });
    }
    RelPath::parse(&format!("users/{user_id}.json"))
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

    fn read(storage: &Storage, user: &str) -> Option<Value> {
        storage
            .read_json(&RelPath::parse(&format!("users/{user}.json")).unwrap())
            .unwrap()
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
            .read_text(&RelPath::parse("users/jan.json").unwrap())
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
    fn mark_offline_on_quit_runs_once() {
        let (_d, _l, s) = storage();
        let p = Presence::new();
        p.mark_offline(&s); // nobody logged in: nothing written
        assert_eq!(read(&s, "jan"), None);
        p.update(&s, Some("jan"), Some(state("jan"))).unwrap();
        p.mark_offline(&s);
        assert_eq!(read(&s, "jan").unwrap()["online"], false);
        s.write_json(
            &RelPath::parse("users/jan.json").unwrap(),
            &json!({"online": true}),
            Expect::Any,
        )
        .unwrap();
        p.mark_offline(&s);
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
