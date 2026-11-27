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

#[cfg(test)]
mod tests;
