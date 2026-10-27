// SPDX-License-Identifier: AGPL-3.0-or-later

//! Read-modify-write with compare-and-swap (`store.js` `update`, `saveEntity`; S20-S27).

use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Map, Value};

use super::{Expect, Storage};
use crate::error::{Error, Result};
use crate::paths::RelPath;

/// Attempts before an update gives up with a conflict (S22).
const UPDATE_ATTEMPTS: usize = 5;

impl Storage {
    /// Reads `rel`, lets `mutator(current, on_disk)` build the new value and writes it only if
    /// the file did not change in between; on a conflict it starts over with the fresh file
    /// (S20, S21). `current` is the on-disk value or `fallback()` for a missing file; `on_disk`
    /// is `None` for a missing file. An error from the mutator aborts without writing. Updates
    /// of one file through this handle run one after another (S25).
    /// The mutator must not call `update` on the same file (it would wait for itself).
    pub fn update<F>(
        &self,
        rel: &RelPath,
        fallback: impl Fn() -> Value,
        mut mutator: F,
    ) -> Result<Value>
    where
        F: FnMut(Value, Option<&Value>) -> Result<Value>,
    {
        let queue = self.update_queue(rel);
        let _queued = queue.lock().unwrap_or_else(|p| p.into_inner());
        for _ in 0..UPDATE_ATTEMPTS {
            // S24: a corrupt file is an error here, never overwritten.
            let read = self.read_json_versioned(rel)?;
            let (current, on_disk, expect) = match &read {
                Some(v) => (v.data.clone(), Some(&v.data), Expect::Hash(&v.hash)),
                None => (fallback(), None, Expect::Missing),
            };
            let next = mutator(current, on_disk)?;
            match self.write_json(rel, &next, expect) {
                Ok(_) => return Ok(next),
                Err(Error::Conflict { .. }) => continue,
                Err(e) => return Err(e), // S23: not retried
            }
        }
        Err(Error::Conflict {
            path: rel.to_string(),
            updated_by: None,
        })
    }

    fn update_queue(&self, rel: &RelPath) -> Arc<Mutex<()>> {
        let mut queues = self.update_locks.lock().unwrap_or_else(|p| p.into_inner());
        queues.entry(rel.clone()).or_default().clone()
    }

    /// Saves a single-object file with a fresh `_meta` (S26). `base_rev` is the `_meta.rev` the
    /// edit started from (`None` = 0); if the file has moved on, nothing is written and the
    /// conflict names the other user (S27). `force` overwrites regardless.
    pub fn save_entity(
        &self,
        rel: &RelPath,
        entity: &Value,
        base_rev: Option<i64>,
        force: bool,
        user_id: Option<&str>,
        now: SystemTime,
    ) -> Result<Value> {
        let Value::Object(entity) = entity else {
            return Err(Error::InvalidArgument {
                message: "entity must be a JSON object".into(),
            });
        };
        self.update(
            rel,
            || Value::Null,
            |_current, on_disk| {
                if let (false, Some(disk)) = (force, on_disk) {
                    let meta = disk.get("_meta");
                    let disk_rev = match meta.and_then(|m| m.get("rev")) {
                        None | Some(Value::Null) => Some(0.0),
                        Some(v) => v.as_f64(),
                    };
                    if disk_rev != Some(base_rev.unwrap_or(0) as f64) {
                        let updated_by = meta
                            .and_then(|m| m.get("updatedBy"))
                            .and_then(Value::as_str)
                            .map(str::to_owned);
                        return Err(Error::Conflict {
                            path: rel.to_string(),
                            updated_by,
                        });
                    }
                }
                Ok(stamp_meta(entity.clone(), on_disk, user_id, now))
            },
        )
    }
}

/// Sets `_meta` on `obj` (`domain/ids.ts` `stampMeta`): `rev` = disk rev + 1 (missing or
/// non-numeric counts as 0), `createdBy/At` kept from disk (`null` there stays `null`) or set
/// now for a new file, `updatedBy/At` = now. An existing `_meta` key keeps its position.
pub fn stamp_meta(
    mut obj: Map<String, Value>,
    on_disk: Option<&Value>,
    user_id: Option<&str>,
    now: SystemTime,
) -> Value {
    let iso = Value::String(iso_utc(now));
    let user = user_id.map_or(Value::Null, |u| Value::String(u.to_owned()));
    let prev = on_disk.and_then(|d| d.get("_meta"));
    let prev_field = |k: &str| match prev.and_then(|m| m.get(k)) {
        None | Some(Value::Null) => Value::Null,
        Some(v) => v.clone(),
    };
    let rev = prev
        .and_then(|m| m.get("rev"))
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
        + 1.0;
    let rev = if rev.fract() == 0.0 && rev.abs() < 9.0e15 {
        Value::from(rev as i64)
    } else {
        serde_json::Number::from_f64(rev).map_or(Value::Null, Value::Number)
    };
    let mut meta = Map::new();
    meta.insert("rev".into(), rev);
    meta.insert(
        "createdBy".into(),
        if on_disk.is_some() {
            prev_field("createdBy")
        } else {
            user.clone()
        },
    );
    meta.insert(
        "createdAt".into(),
        if on_disk.is_some() {
            prev_field("createdAt")
        } else {
            iso.clone()
        },
    );
    meta.insert("updatedBy".into(), user);
    meta.insert("updatedAt".into(), iso);
    obj.insert("_meta".into(), Value::Object(meta));
    Value::Object(obj)
}

/// `Date.prototype.toISOString()`: `2026-10-27T09:05:03.042Z`.
pub fn iso_utc(t: SystemTime) -> String {
    let ms = match t.duration_since(UNIX_EPOCH) {
        Ok(d) => d.as_millis() as i64,
        Err(e) => -(e.duration().as_millis() as i64),
    };
    let days = ms.div_euclid(86_400_000);
    let rem = ms.rem_euclid(86_400_000);
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3_600_000,
        rem / 60_000 % 60,
        rem / 1000 % 60,
        rem % 1000
    )
}

/// Howard Hinnant's days-to-civil algorithm.
fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
}
