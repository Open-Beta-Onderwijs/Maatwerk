// SPDX-License-Identifier: AGPL-3.0-or-later

//! Edit locks (step 41, `docs/reference/edit-locks.md`): what may no longer change or go once
//! data depends on it. This module holds the one "has data" rule (decision 14) that the UI and
//! the write guards share; the guards themselves follow in the same module.

use std::collections::BTreeSet;

use serde_json::Value;

use crate::paths::{RelPath, is_year_name};
use crate::storage::Storage;
use crate::{Error, Result};

/// Whether a score record holds anything for `exam` (decision 14): an entry in `scores[exam]`
/// (`"N"`, niet gemaakt, counts: the teacher entered it), an override, a ticked observatie or
/// PO grading.
pub fn has_data(record: &Value, exam: &str) -> bool {
    let entry = |key: &str| record.get(key).and_then(|m| m.get(exam));
    let scores = entry("scores")
        .and_then(Value::as_object)
        .is_some_and(|s| !s.is_empty());
    let override_ = entry("overrides").is_some_and(|o| !o.is_null());
    let observations = entry("observations")
        .and_then(Value::as_array)
        .is_some_and(|a| !a.is_empty());
    let po = entry("po")
        .and_then(Value::as_object)
        .is_some_and(|p| !p.is_empty());
    scores || override_ || observations || po
}

/// Whether a score record holds data for any exam.
pub fn has_any_data(record: &Value) -> bool {
    ["scores", "overrides", "observations", "po"]
        .iter()
        .filter_map(|key| record.get(*key).and_then(Value::as_object))
        .flat_map(|m| m.keys())
        .any(|exam| has_data(record, exam))
}

/// A refusal because a file that could hold data cannot be read: a skipped file could be the
/// one that locks the change (fail closed, as `rubrics::uses_of`).
pub(crate) fn unreadable(what: &str, e: &dyn std::fmt::Display) -> Error {
    Error::EditLocked {
        path: what.to_owned(),
        message: format!(
            "Kan niet nagaan of hier al gegevens bij horen: {what} is onleesbaar ({e}). Herstel \
             het via Gegevenscontrole en probeer het opnieuw."
        ),
    }
}

/// Every score file of one school year and vak, `(student id, record)`; fails closed.
fn score_records(storage: &Storage, year: &str, vak: &str) -> Result<Vec<(String, Value)>> {
    let dir = RelPath::parse(&format!("{year}/scores/{vak}"))?;
    let mut out = Vec::new();
    for name in storage
        .list_dir(&dir, false)
        .map_err(|e| unreadable(dir.as_str(), &e))?
    {
        let Some(id) = name.strip_suffix(".json") else {
            continue;
        };
        let rel = dir.join(&name)?;
        match storage.read_json(&rel) {
            Ok(Some(record)) => out.push((id.to_owned(), record)),
            Ok(None) => {}
            Err(e) => return Err(unreadable(rel.as_str(), &e)),
        }
    }
    Ok(out)
}

/// Whether any student has data for `exam` of `vak` in `year` (one folder read).
pub fn exam_has_data(storage: &Storage, year: &str, vak: &str, exam: &str) -> Result<bool> {
    Ok(score_records(storage, year, vak)?
        .iter()
        .any(|(_, record)| has_data(record, exam)))
}

/// The students with data in `year`, in any vak.
pub fn students_with_data(storage: &Storage, year: &str) -> Result<BTreeSet<String>> {
    if !is_year_name(year) {
        return Err(Error::InvalidArgument {
            message: format!("Geen schooljaar: {year:?}"),
        });
    }
    let dir = RelPath::parse(&format!("{year}/scores"))?;
    let mut out = BTreeSet::new();
    for vak in storage
        .list_dir(&dir, true)
        .map_err(|e| unreadable(dir.as_str(), &e))?
    {
        for (id, record) in score_records(storage, year, &vak)? {
            if has_any_data(&record) {
                out.insert(id);
            }
        }
    }
    Ok(out)
}

// ── Guards ─────────────────────────────────────────────────────────────────────────────────

thread_local! {
    /// Set while [`unlocked`] runs on this thread.
    static UNLOCKED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Runs `f` with the edit locks lifted on this thread: "Herstellen uit snapshot" is a repair
/// (it puts back a version that existed), not an edit. Nothing else may call it.
pub fn unlocked<T>(f: impl FnOnce() -> Result<T>) -> Result<T> {
    struct Reset(bool);
    impl Drop for Reset {
        fn drop(&mut self) {
            UNLOCKED.with(|c| c.set(self.0));
        }
    }
    let _reset = Reset(UNLOCKED.with(|c| c.replace(true)));
    f()
}

fn refuse(rel: &RelPath, message: String) -> Error {
    Error::EditLocked {
        path: rel.to_string(),
        message,
    }
}

/// What kind of file a path is, for the guards.
enum Kind<'a> {
    Students { year: &'a str },
    Group { year: &'a str },
    Other,
}

fn kind(rel: &str) -> Kind<'_> {
    let parts: Vec<&str> = rel.split('/').collect();
    match parts.as_slice() {
        [year, file] if is_year_name(year) && *file == format!("students-{year}.json") => {
            Kind::Students { year }
        }
        [year, "groups", file] if is_year_name(year) && file.ends_with(".json") => {
            Kind::Group { year }
        }
        _ => Kind::Other,
    }
}

/// Runs under the commit lock, before a JSON write (`Storage::write_json`).
pub(crate) fn guard_write(storage: &Storage, rel: &RelPath, new: &Value) -> Result<()> {
    if UNLOCKED.with(std::cell::Cell::get) {
        return Ok(());
    }
    match kind(rel.as_str()) {
        Kind::Students { year } => guard_students(storage, rel, year, new),
        Kind::Group { .. } => guard_group(storage, rel, Some(new)),
        Kind::Other => Ok(()),
    }
}

/// Runs under the commit lock, before a delete (`Storage::delete`).
pub(crate) fn guard_delete(storage: &Storage, rel: &RelPath) -> Result<()> {
    if UNLOCKED.with(std::cell::Cell::get) {
        return Ok(());
    }
    match kind(rel.as_str()) {
        Kind::Group { .. } => guard_group(storage, rel, None),
        Kind::Students { .. } => Err(refuse(
            rel,
            "Het leerlingenbestand van een schooljaar wordt niet verwijderd.".into(),
        )),
        Kind::Other => Ok(()),
    }
}

/// An id as text: student ids are strings since v3 (C8), numbers in older files.
fn id_text(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn student_ids(file: &Value) -> BTreeSet<String> {
    file.get("students")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|s| s.get("id").and_then(id_text))
        .collect()
}

/// 2.1: a student removed from a year's list must have no data in that year and be in none of
/// its groups.
fn guard_students(storage: &Storage, rel: &RelPath, year: &str, new: &Value) -> Result<()> {
    let old = storage
        .read_json(rel)
        .map_err(|e| unreadable(rel.as_str(), &e))?
        .unwrap_or(Value::Null);
    let kept = student_ids(new);
    let removed: Vec<String> = student_ids(&old)
        .into_iter()
        .filter(|id| !kept.contains(id))
        .collect();
    if removed.is_empty() {
        return Ok(());
    }
    let with_data = students_with_data(storage, year)?;
    if let Some(id) = removed.iter().find(|id| with_data.contains(*id)) {
        return Err(refuse(
            rel,
            format!(
                "Leerling {id} niet verwijderd: er zijn scores ingevoerd voor deze leerling in \
                 {year}."
            ),
        ));
    }
    let in_group = groups_of(storage, year)?
        .into_iter()
        .flat_map(|g| group_students(&g))
        .collect::<BTreeSet<_>>();
    if let Some(id) = removed.iter().find(|id| in_group.contains(*id)) {
        return Err(refuse(
            rel,
            format!("Leerling {id} niet verwijderd: de leerling zit in een groep van {year}."),
        ));
    }
    Ok(())
}

/// Every group file of a year; fails closed.
fn groups_of(storage: &Storage, year: &str) -> Result<Vec<Value>> {
    let dir = RelPath::parse(&format!("{year}/groups"))?;
    let mut out = Vec::new();
    for name in storage
        .list_dir(&dir, false)
        .map_err(|e| unreadable(dir.as_str(), &e))?
    {
        if !name.ends_with(".json") {
            continue;
        }
        let file = dir.join(&name)?;
        match storage.read_json(&file) {
            Ok(Some(g)) => out.push(g),
            Ok(None) => {}
            Err(e) => return Err(unreadable(file.as_str(), &e)),
        }
    }
    Ok(out)
}

fn group_students(group: &Value) -> Vec<String> {
    group
        .get("student_ids")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(id_text)
        .collect()
}

/// The group fields that stay while a group has students (2.2).
const GROUP_FIELDS: [(&str, &str); 4] = [
    ("name", "naam"),
    ("jaarlaag", "jaarlaag"),
    ("schoolsoort", "schoolsoort"),
    ("subject", "vak"),
];

/// A value compared as the UI writes it: `"3"` and `3` are the same jaarlaag.
fn same(a: Option<&Value>, b: Option<&Value>) -> bool {
    match (a, b) {
        (Some(Value::Number(n)), Some(Value::String(s)))
        | (Some(Value::String(s)), Some(Value::Number(n))) => n.to_string() == *s,
        (None | Some(Value::Null), None | Some(Value::Null)) => true,
        _ => a == b,
    }
}

/// 2.2: a group with students keeps its name, jaarlaag, schoolsoort and vak, and is not deleted.
fn guard_group(storage: &Storage, rel: &RelPath, new: Option<&Value>) -> Result<()> {
    let Some(old) = storage
        .read_json(rel)
        .map_err(|e| unreadable(rel.as_str(), &e))?
    else {
        return Ok(());
    };
    let members = group_students(&old).len();
    if members == 0 {
        return Ok(());
    }
    let Some(new) = new else {
        return Err(refuse(
            rel,
            format!("Deze groep heeft {members} leerling(en) en kan dus niet worden verwijderd."),
        ));
    };
    let changed: Vec<&str> = GROUP_FIELDS
        .iter()
        .filter(|(key, _)| !same(old.get(*key), new.get(*key)))
        .map(|(_, label)| *label)
        .collect();
    if changed.is_empty() {
        return Ok(());
    }
    Err(refuse(
        rel,
        format!(
            "Deze groep heeft leerlingen: {} ligt vast. Haal eerst de leerlingen uit de groep.",
            changed.join(", ")
        ),
    ))
}

#[cfg(test)]
mod tests;
