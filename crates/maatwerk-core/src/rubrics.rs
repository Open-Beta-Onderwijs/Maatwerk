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

/// The first app version that knows PO exams (`kind: "po"`, `rubric_id`, `projectgroepen`; step
/// 22): an older one would show a PO as a test without questions and could save it as one.
pub const PO_EXAM_MIN_APP_VERSION: &str = "0.13.0";

/// The first app version that grades PO's (`po[examId]` in a score file, step 23): an older one
/// would show PO grades without the bonus/malus lines and regroup without copying the grading.
pub const PO_GRADING_MIN_APP_VERSION: &str = "0.14.0";

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

/// `rel` split as `<dir>/<stem>.json`, the folder and extension in any ASCII case: Windows and
/// macOS find `Rubrics/X.JSON` as `rubrics/X.json` (review 21 m4).
fn json_in<'a>(rel: &'a str, dir: &str) -> Option<&'a str> {
    let (first, file) = rel.split_once('/')?;
    if !first.eq_ignore_ascii_case(dir) || file.contains('/') || file.len() <= 5 {
        return None;
    }
    let (stem, ext) = file.split_at(file.len() - 5);
    ext.eq_ignore_ascii_case(".json").then_some(stem)
}

/// The id of a rubric file path (`rubrics/<id>.json`).
pub fn rubric_id_of(rel: &str) -> Option<&str> {
    json_in(rel, RUBRICS_DIR)
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
                // An exam's name is its `title`.
                naam: text(&exam, "title"),
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
pub(crate) fn guard_write(
    storage: &Storage,
    rel: &RelPath,
    value: &Value,
    expect: Expect<'_>,
) -> Result<()> {
    let raise = if let Some(id) = rubric_id_of(rel.as_str()) {
        check_rubric_write(storage, rel, id, value)?;
        Some(PO_MIN_APP_VERSION)
    } else if json_in(rel.as_str(), "observaties").is_some() && is_po_observatie(value) {
        Some(PO_MIN_APP_VERSION)
    } else if is_exam_path(rel.as_str()) && is_po_exam(value) {
        Some(PO_EXAM_MIN_APP_VERSION)
    } else if is_score_path(rel.as_str()) && has_po_grading(value) {
        Some(PO_GRADING_MIN_APP_VERSION)
    } else {
        None
    };
    if let Some(min) = raise {
        // A write that will fail its CAS raises nothing (review 21 m1); the commit checks again.
        if !storage.expect_holds(rel, expect)? {
            return Err(Error::Conflict {
                path: rel.to_string(),
                updated_by: None,
            });
        }
        ensure_min_app_version(storage, min)?;
    }
    Ok(())
}

/// `<year>/exams/<id>.json`, the folder and extension in any ASCII case.
fn is_exam_path(rel: &str) -> bool {
    rel.split_once('/')
        .is_some_and(|(_, rest)| json_in(rest, "exams").is_some())
}

/// `<year>/scores/<subject>/<id>.json`, the folders and extension in any ASCII case.
fn is_score_path(rel: &str) -> bool {
    let mut parts = rel.splitn(3, '/');
    let (Some(_year), Some(dir), Some(rest)) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    dir.eq_ignore_ascii_case("scores")
        && rest
            .split_once('/')
            .is_some_and(|(subject, _)| !subject.is_empty() && json_in(rest, subject).is_some())
}

/// A score file that holds a PO's grading (a non-empty `po` object, step 23).
pub fn has_po_grading(record: &Value) -> bool {
    record
        .get("po")
        .and_then(Value::as_object)
        .is_some_and(|po| !po.is_empty())
}

/// A practical assignment (`kind: "po"`, step 22).
pub fn is_po_exam(exam: &Value) -> bool {
    exam.get("kind").and_then(Value::as_str) == Some("po")
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
    let old: Rubric = serde_json::from_value(old).map_err(|_| {
        refuse(format!(
            "Rubric niet opgeslagen: de rubric op schijf is onleesbaar en in gebruik bij {n} \
             PO('s). Herstel het bestand via Gegevenscontrole."
        ))
    })?;
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
