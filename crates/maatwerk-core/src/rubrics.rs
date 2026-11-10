// SPDX-License-Identifier: AGPL-3.0-or-later

//! Rubrics (step 21, PLAN-2 decisions 16, 20, 21, 23): `rubrics/<id>.json`, shared per vak like
//! observaties, saved by the UI through the ordinary CAS write. This module is the core's side:
//!
//! - [`usage`]: which exams (PO's) use each rubric, over every school year ("in gebruik").
//! - [`guard_write`] runs inside `Storage::write_json` before the commit: a rubric must pass
//!   `check_rubric`, its id must match the file name, and a rubric in use may not change what
//!   decision 20 locks. The first rubric, or the first observatie of toetstype PO, raises
//!   `school.json` `minAppVersion` to [`PO_MIN_APP_VERSION`] first (an additive change within v3:
//!   an older app would list PO observaties in its test screens and know nothing of rubrics).
//! - [`guard_delete`]: a rubric in use cannot be deleted.
//!
//! The rules themselves are in `maatwerk_grades::rubric` (also compiled for the UI).

use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::time::SystemTime;

use maatwerk_grades::rubric::{self, Rubric};
use serde::Serialize;
use serde_json::Value;

use crate::app_version::{self, MIN_APP_VERSION_FIELD};
use crate::paths::RelPath;
use crate::storage::{Expect, Storage, stamp_meta};
use crate::{Error, Result};

/// The folder of the rubric files.
pub const RUBRICS_DIR: &str = "rubrics";

/// The first app version that knows rubrics and observatie toetstypes.
pub const PO_MIN_APP_VERSION: &str = "0.12.0";

/// The observatie field that says where an observatie is offered (decision 23).
pub const TOETSTYPES_FIELD: &str = "toetstypes";

/// One exam that uses a rubric.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RubricUse {
    pub year: String,
    pub exam_id: String,
    pub naam: String,
}

/// The id of a rubric file path (`rubrics/<id>.json`).
pub fn rubric_id_of(rel: &str) -> Option<&str> {
    rel.strip_prefix("rubrics/")?
        .strip_suffix(".json")
        .filter(|id| !id.is_empty() && !id.contains('/'))
}

/// The rubric an exam uses, if any (`rubric_id`, step 22).
pub fn exam_rubric_id(exam: &Value) -> Option<&str> {
    exam.get("rubric_id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
}

/// Every exam in every year that names a rubric, per rubric id. Unreadable exam files are skipped
/// (they show up in Gegevenscontrole).
pub fn usage(storage: &Storage) -> Result<BTreeMap<String, Vec<RubricUse>>> {
    let mut out: BTreeMap<String, Vec<RubricUse>> = BTreeMap::new();
    for year in storage.list_years() {
        let dir = RelPath::parse(&format!("{year}/exams"))?;
        for (_, exam) in storage.read_all_json_named(&dir)? {
            let Some(id) = exam_rubric_id(&exam) else {
                continue;
            };
            out.entry(id.to_owned()).or_default().push(RubricUse {
                year: year.clone(),
                exam_id: text(&exam, "id"),
                naam: text(&exam, "naam"),
            });
        }
    }
    Ok(out)
}

fn text(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or("").to_owned()
}

fn uses_of(storage: &Storage, id: &str) -> Result<usize> {
    Ok(usage(storage)?.get(id).map_or(0, Vec::len))
}

fn refuse(message: String) -> Error {
    Error::InvalidArgument { message }
}

/// Whether an observatie is offered for PO's (`toetstypes` contains `po`).
pub fn is_po_observatie(obs: &Value) -> bool {
    obs.get(TOETSTYPES_FIELD)
        .and_then(Value::as_array)
        .is_some_and(|a| a.iter().any(|t| t.as_str() == Some("po")))
}

/// Checks a JSON write before it is committed (see the module docs). Called by
/// `Storage::write_json`; `school.json` itself is never guarded.
pub(crate) fn guard_write(storage: &Storage, rel: &RelPath, value: &Value) -> Result<()> {
    if let Some(id) = rubric_id_of(rel.as_str()) {
        check_rubric_write(storage, rel, id, value)?;
        ensure_min_app_version(storage, PO_MIN_APP_VERSION)?;
    } else if rel.as_str().starts_with("observaties/") && is_po_observatie(value) {
        ensure_min_app_version(storage, PO_MIN_APP_VERSION)?;
    }
    Ok(())
}

fn check_rubric_write(storage: &Storage, rel: &RelPath, id: &str, value: &Value) -> Result<()> {
    if value.get("id").and_then(Value::as_str) != Some(id) {
        return Err(refuse(format!(
            "Rubric niet opgeslagen: het id hoort {id} te zijn"
        )));
    }
    let new: Rubric = serde_json::from_value(value.clone())
        .map_err(|e| refuse(format!("Rubric niet opgeslagen: {e}")))?;
    let check = rubric::check_rubric(&new);
    if !check.valid {
        let mut problems = check.errors;
        for (cat, c) in new.categories.iter().zip(&check.categories) {
            if !c.errors.is_empty() {
                problems.push(format!("{}: {}", cat.naam, c.errors.join(" · ")));
            }
        }
        return Err(refuse(format!(
            "Rubric niet opgeslagen: {}",
            problems.join("; ")
        )));
    }
    let Some(old) = storage.read_json(rel)? else {
        return Ok(());
    };
    let n = uses_of(storage, id)?;
    if n == 0 {
        return Ok(());
    }
    let old: Rubric = serde_json::from_value(old).unwrap_or_default();
    let locked = rubric::locked_changes(&old, &new);
    if locked.is_empty() {
        Ok(())
    } else {
        Err(refuse(format!(
            "Rubric niet opgeslagen: in gebruik bij {n} {}, dus maxima en soort liggen vast. {}",
            if n == 1 { "PO" } else { "PO's" },
            locked.join("; ")
        )))
    }
}

/// Refuses deleting a rubric that a PO uses (decision 20).
pub(crate) fn guard_delete(storage: &Storage, rel: &RelPath) -> Result<()> {
    let Some(id) = rubric_id_of(rel.as_str()) else {
        return Ok(());
    };
    match uses_of(storage, id)? {
        0 => Ok(()),
        n => Err(refuse(format!(
            "Deze rubric is in gebruik bij {n} {} en kan niet verwijderd worden",
            if n == 1 { "PO" } else { "PO's" }
        ))),
    }
}

/// Raises `school.json` `minAppVersion` to `min` when it is absent, empty or lower. A missing
/// `school.json` (not synced yet) is left alone. Retries on a concurrent write.
pub fn ensure_min_app_version(storage: &Storage, min: &str) -> Result<()> {
    let rel = RelPath::parse("school.json")?;
    for _ in 0..5 {
        let Some(read) = storage.read_json_versioned(&rel)? else {
            tracing::warn!("school.json missing: minAppVersion not raised to {min}");
            return Ok(());
        };
        let Value::Object(mut school) = read.data.clone() else {
            return Ok(());
        };
        let lower = match school.get(MIN_APP_VERSION_FIELD) {
            Some(Value::String(v)) if !v.trim().is_empty() => {
                app_version::compare(v.trim(), min) == Some(Ordering::Less)
            }
            _ => true,
        };
        if !lower {
            return Ok(());
        }
        school.insert(MIN_APP_VERSION_FIELD.into(), min.into());
        // `updatedBy` null: the app did this, not a teacher (as the migration).
        let school = stamp_meta(school, Some(&read.data), None, SystemTime::now());
        match storage.write_json(&rel, &school, Expect::Hash(&read.hash)) {
            Ok(_) => {
                tracing::info!("school.json minAppVersion raised to {min}");
                return Ok(());
            }
            Err(Error::Conflict { .. }) => continue,
            Err(e) => return Err(e),
        }
    }
    Err(Error::Conflict {
        path: rel.to_string(),
        updated_by: None,
    })
}

#[cfg(test)]
mod tests;
