// SPDX-License-Identifier: AGPL-3.0-or-later

//! Reading what the list screens' numbers need, as the UI's `Store` reads it: a year's exams of
//! one vak (a PO with its rubric attached, as `forGrading`), the score files, the students and
//! the groups. Damaged files are skipped, as the UI does; the numbers never fail on one file.

use std::collections::{HashMap, HashSet};

use serde_json::{Map, Value};

use crate::error::Result;
use crate::grades::{Exam, Group};
use crate::paths::RelPath;
use crate::storage::Storage;

/// One school year of one vak.
#[derive(Debug, Clone, Default)]
pub struct YearData {
    pub year: String,
    /// The vak's exams, `academic_year` set to the folder's year, a PO's rubric attached.
    pub exams: Vec<Exam>,
    /// Student id -> score file, as stored (key order kept: the history order depends on it).
    pub records: HashMap<String, Value>,
    /// Ids of the diagnostic tests (`diagnostic: true`; the crate's `Exam` has no such field).
    pub diagnostic: HashSet<String>,
}

/// A student of the year's list.
#[derive(Debug, Clone, PartialEq)]
pub struct Student {
    pub id: String,
    /// Years 4-6 (`isUpperSchool` of the card: `jaarlaag`, else the stamklas's leading digits).
    pub upper: bool,
}

/// An id as the UI compares it (`String(id)`).
pub fn id_text(v: &Value) -> Option<String> {
    match v {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

/// `Number(x)` of the UI for a jaarlaag: a number, or a trimmed numeric string; empty is 0.
fn js_number(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) if s.trim().is_empty() => Some(0.0),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

/// Years 4-6 (`isUpperSchool`).
pub fn is_upper(jaarlaag: Option<&Value>) -> bool {
    jaarlaag
        .and_then(js_number)
        .is_some_and(|n| (4.0..=6.0).contains(&n))
}

/// The leading digits of a stamklas (`jaarlaagFromStamklas`): "4h2" is "4"; a number counts as
/// its text, as the UI's `String(stamklas)`.
fn jaarlaag_from_stamklas(stamklas: Option<&Value>) -> Value {
    let text = stamklas.and_then(id_text).unwrap_or_default();
    Value::String(text.chars().take_while(char::is_ascii_digit).collect())
}

fn rel(path: &str) -> Result<RelPath> {
    RelPath::parse(path)
}

/// Every rubric file, as stored.
pub fn load_rubrics(storage: &Storage) -> Result<Vec<Value>> {
    storage.read_all_json(&rel("rubrics")?)
}

/// The rubric a PO is graded with: same id and the exam's vak (`rubricOf`), else none.
fn attach_rubric(exam: &mut Map<String, Value>, rubrics: &[Value]) {
    if exam.get("kind").and_then(Value::as_str) != Some("po") {
        return;
    }
    let subject = exam.get("subject").cloned();
    let rubric = exam
        .get("rubric_id")
        .and_then(Value::as_str)
        .and_then(|id| {
            rubrics.iter().find(|r| {
                r.get("id").and_then(Value::as_str) == Some(id)
                    && r.get("subject") == subject.as_ref()
            })
        })
        .cloned()
        .unwrap_or(Value::Null);
    exam.insert("rubric".into(), rubric);
}

/// One year of one vak.
pub fn load_year(storage: &Storage, year: &str, vak: &str, rubrics: &[Value]) -> Result<YearData> {
    let mut diagnostic = HashSet::new();
    let exams = storage
        .read_all_json(&rel(&format!("{year}/exams"))?)?
        .into_iter()
        .filter(|e| e.get("subject").and_then(Value::as_str) == Some(vak))
        .filter_map(|e| {
            if e.get("diagnostic") == Some(&Value::Bool(true))
                && let Some(id) = e.get("id").and_then(id_text)
            {
                diagnostic.insert(id);
            }
            let Value::Object(mut map) = e else {
                return None;
            };
            map.insert("academic_year".into(), Value::String(year.into()));
            attach_rubric(&mut map, rubrics);
            serde_json::from_value::<Exam>(Value::Object(map)).ok()
        })
        .collect();
    let records = storage
        .read_all_json_named(&rel(&format!("{year}/scores/{vak}"))?)?
        .into_iter()
        .filter_map(|(name, v)| {
            let id = name.strip_suffix(".json")?;
            (v.is_object() && !id.is_empty()).then(|| (id.to_owned(), v))
        })
        .collect();
    Ok(YearData {
        year: year.into(),
        exams,
        records,
        diagnostic,
    })
}

/// The year's students (`students-<year>.json`), in file order.
pub fn load_students(storage: &Storage, year: &str) -> Result<Vec<Student>> {
    let list = storage.read_json(&rel(&format!("{year}/students-{year}.json"))?)?;
    // v2/v3: `{ "students": [...] }`; a bare array as v1 wrote it.
    let items = match &list {
        Some(Value::Array(items)) => items,
        Some(v) => match v.get("students") {
            Some(Value::Array(items)) => items,
            _ => return Ok(vec![]),
        },
        None => return Ok(vec![]),
    };
    Ok(items
        .iter()
        .filter_map(|s| {
            let id = id_text(s.get("id")?)?;
            // `s.jaarlaag ?? jaarlaagOf(s)`: only a missing or null jaarlaag falls back.
            let upper = match s.get("jaarlaag") {
                None | Some(Value::Null) => {
                    is_upper(Some(&jaarlaag_from_stamklas(s.get("stamklas"))))
                }
                some => is_upper(some),
            };
            Some(Student { id, upper })
        })
        .collect())
}

/// The vak's groups of the year (`subject` = `vak`) that have students.
pub fn load_groups(storage: &Storage, year: &str, vak: &str) -> Result<Vec<Group>> {
    Ok(storage
        .read_all_json(&rel(&format!("{year}/groups"))?)?
        .into_iter()
        .filter_map(|g| serde_json::from_value::<Group>(g).ok())
        .filter(|g| g.subject.as_deref() == Some(vak) && !g.student_ids.is_empty())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn upper_school_as_the_cards() {
        assert!(is_upper(Some(&json!("4"))));
        assert!(is_upper(Some(&json!(6))));
        assert!(is_upper(Some(&json!(" 5 "))));
        assert!(!is_upper(Some(&json!("3"))));
        assert!(!is_upper(Some(&json!(""))));
        assert!(!is_upper(Some(&json!("4a"))));
        assert!(!is_upper(None));
        assert_eq!(jaarlaag_from_stamklas(Some(&json!("4h2"))), json!("4"));
        assert_eq!(jaarlaag_from_stamklas(Some(&json!("h4"))), json!(""));
        // `String(stamklas)` of the UI: a number counts as its text (review 38 m2).
        assert_eq!(jaarlaag_from_stamklas(Some(&json!(4))), json!("4"));
        assert_eq!(jaarlaag_from_stamklas(Some(&json!(null))), json!(""));
    }

    #[test]
    fn ids_as_the_ui_compares_them() {
        assert_eq!(id_text(&json!(900001)).as_deref(), Some("900001"));
        assert_eq!(id_text(&json!("s1")).as_deref(), Some("s1"));
        assert_eq!(id_text(&json!("")), None);
        assert_eq!(id_text(&json!(null)), None);
    }

    #[test]
    fn a_po_gets_the_rubric_of_its_vak_only() {
        let rubrics = vec![
            json!({"id": "r1", "subject": "bio", "categories": []}),
            json!({"id": "r1", "subject": "nat", "categories": [{"id": "c"}]}),
        ];
        let mut po = json!({"kind": "po", "subject": "nat", "rubric_id": "r1"});
        attach_rubric(po.as_object_mut().unwrap(), &rubrics);
        assert_eq!(po["rubric"]["categories"][0]["id"], "c");
        let mut other = json!({"kind": "po", "subject": "wi", "rubric_id": "r1"});
        attach_rubric(other.as_object_mut().unwrap(), &rubrics);
        assert_eq!(other["rubric"], Value::Null);
        let mut toets = json!({"subject": "nat", "rubric_id": "r1"});
        attach_rubric(toets.as_object_mut().unwrap(), &rubrics);
        assert!(toets.get("rubric").is_none());
    }
}
