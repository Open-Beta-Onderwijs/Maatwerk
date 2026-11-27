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
    /// Set while [`save_exam_family`] writes the members it checked together.
    static FAMILY: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
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
    Group,
    Exam { year: &'a str, id: &'a str },
    Observatie { id: &'a str },
    Other,
}

fn kind(rel: &str) -> Kind<'_> {
    let parts: Vec<&str> = rel.split('/').collect();
    match parts.as_slice() {
        [year, file] if is_year_name(year) && *file == format!("students-{year}.json") => {
            Kind::Students { year }
        }
        [year, "groups", file] if is_year_name(year) && file.ends_with(".json") => Kind::Group,
        [year, "exams", file] if is_year_name(year) => match file.strip_suffix(".json") {
            Some(id) if !id.is_empty() => Kind::Exam { year, id },
            _ => Kind::Other,
        },
        ["observaties", file] => match file.strip_suffix(".json") {
            Some(id) if !id.is_empty() => Kind::Observatie { id },
            _ => Kind::Other,
        },
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
        Kind::Group => guard_group(storage, rel, Some(new)),
        Kind::Exam { year, id } => guard_exam(storage, rel, year, id, new),
        Kind::Observatie { id } => guard_obs(storage, rel, id, new),
        Kind::Other => Ok(()),
    }
}

/// Runs under the commit lock, before a delete (`Storage::delete`).
pub(crate) fn guard_delete(storage: &Storage, rel: &RelPath) -> Result<()> {
    if UNLOCKED.with(std::cell::Cell::get) {
        return Ok(());
    }
    match kind(rel.as_str()) {
        Kind::Group => guard_group(storage, rel, None),
        Kind::Exam { year, id } => guard_exam_delete(storage, rel, year, id),
        Kind::Observatie { id } => guard_obs_delete(storage, rel, id),
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
    // A write that empties the group may change its fields too (the CSV import that replaces a
    // group, D34): no student's scores stay with it.
    if group_students(new).is_empty() {
        return Ok(());
    }
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

// ── Exams and herkansing families ─────────────────────────────────────────────────────────

/// The fields every member of a herkansing family shares (decision 5): changed for all at once
/// (the verzamelkaart) or not at all. The Dutch name is for the message.
const FAMILY_FIELDS: [(&str, &str); 11] = [
    ("type", "PTA"),
    ("diagnostic", "diagnostisch"),
    ("weging", "weging"),
    ("weging_se", "weging SE"),
    ("periode", "periode"),
    ("jaarlaag", "jaarlaag"),
    ("schoolsoort", "schoolsoort"),
    ("subject", "vak"),
    ("subcategory", "subcategorie"),
    ("kind", "soort toets"),
    ("rubric_id", "rubric"),
];

/// The PO fields that stay once its family has data (decision 8).
const PO_SCOPE_FIELDS: [(&str, &str); 4] = [
    ("jaarlaag", "jaarlaag"),
    ("schoolsoort", "schoolsoort"),
    ("subcategory", "subcategorie"),
    ("rubric_id", "rubric"),
];

fn text_of<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str).filter(|s| !s.is_empty())
}

fn parent_of(exam: &Value) -> Option<&str> {
    text_of(exam, "parent_id")
}

fn ids_of(v: &Value, key: &str) -> BTreeSet<String> {
    v.get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(id_text)
        .collect()
}

fn question_ids(exam: &Value) -> BTreeSet<String> {
    exam.get("questions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|q| q.get("id").and_then(id_text))
        .collect()
}

fn exam_path(year: &str, id: &str) -> Result<RelPath> {
    RelPath::parse(&format!("{year}/exams/{id}.json"))
}

fn read_exam(storage: &Storage, year: &str, id: &str) -> Result<Option<Value>> {
    let rel = exam_path(year, id)?;
    storage
        .read_json(&rel)
        .map_err(|e| unreadable(rel.as_str(), &e))
}

/// The ids of the exams of `year` whose `parent_id` is `root` (its herkansingen and inhaal).
fn attempts_of(storage: &Storage, year: &str, root: &str) -> Result<Vec<String>> {
    let dir = RelPath::parse(&format!("{year}/exams"))?;
    let mut out = Vec::new();
    for name in storage
        .list_dir(&dir, false)
        .map_err(|e| unreadable(dir.as_str(), &e))?
    {
        let Some(id) = name.strip_suffix(".json") else {
            continue;
        };
        if let Some(exam) = read_exam(storage, year, id)?
            && parent_of(&exam) == Some(root)
        {
            out.push(id.to_owned());
        }
    }
    Ok(out)
}

fn vak_of<'a>(old: Option<&'a Value>, new: &'a Value) -> &'a str {
    text_of(new, "subject")
        .or_else(|| old.and_then(|o| text_of(o, "subject")))
        .unwrap_or("")
}

/// Whether any member of the family of `root` has data.
fn family_has_data(storage: &Storage, year: &str, vak: &str, root: &str) -> Result<bool> {
    if exam_has_data(storage, year, vak, root)? {
        return Ok(true);
    }
    for id in attempts_of(storage, year, root)? {
        if exam_has_data(storage, year, vak, &id)? {
            return Ok(true);
        }
    }
    Ok(false)
}

fn labels_changed(fields: &[(&str, &str)], old: &Value, new: &Value) -> Vec<String> {
    fields
        .iter()
        .filter(|(key, _)| !same(old.get(*key), new.get(*key)))
        .map(|(_, label)| (*label).to_owned())
        .collect()
}

/// 2.3, 2.4 and the family rule for one exam write.
fn guard_exam(storage: &Storage, rel: &RelPath, year: &str, id: &str, new: &Value) -> Result<()> {
    let old = storage
        .read_json(rel)
        .map_err(|e| unreadable(rel.as_str(), &e))?;
    let vak = vak_of(old.as_ref(), new);
    if let Some(old) = &old {
        // 2.3: a question of an exam with data stays.
        let kept = question_ids(new);
        let removed = question_ids(old).into_iter().any(|q| !kept.contains(&q));
        if removed && exam_has_data(storage, year, vak, id)? {
            return Err(refuse(
                rel,
                "Er zijn scores ingevoerd voor deze toets: een bestaande vraag kan niet meer \
                 worden verwijderd."
                    .into(),
            ));
        }
        // Decision 8: a PO's scope and rubric stay once its family has data.
        if text_of(new, "kind") == Some("po") || text_of(old, "kind") == Some("po") {
            let changed = labels_changed(&PO_SCOPE_FIELDS, old, new);
            let root = parent_of(new).or(parent_of(old)).unwrap_or(id);
            if !changed.is_empty() && family_has_data(storage, year, vak, root)? {
                return Err(refuse(
                    rel,
                    format!(
                        "Er zijn al scores voor deze PO: {} ligt vast.",
                        changed.join(", ")
                    ),
                ));
            }
        }
    }
    if FAMILY.with(std::cell::Cell::get) {
        return Ok(());
    }
    guard_family_member(storage, rel, year, id, old.as_ref(), new)
}

/// Decision 5 for a write of one member on its own.
fn guard_family_member(
    storage: &Storage,
    rel: &RelPath,
    year: &str,
    id: &str,
    old: Option<&Value>,
    new: &Value,
) -> Result<()> {
    if let Some(root_id) = parent_of(new) {
        // An attempt: what it changes must agree with its original.
        let Some(root) = read_exam(storage, year, root_id)? else {
            return Ok(()); // an orphan: Gegevenscontrole reports it
        };
        let changed: Vec<String> = FAMILY_FIELDS
            .iter()
            .filter(|(key, _)| {
                let was = old.and_then(|o| o.get(*key));
                (old.is_none() || !same(was, new.get(*key))) && !same(new.get(*key), root.get(*key))
            })
            .map(|(_, label)| (*label).to_owned())
            .collect();
        if !changed.is_empty() {
            return Err(refuse(
                rel,
                format!(
                    "{} hoort bij de verzamelkaart: pas het daar aan, voor alle pogingen tegelijk.",
                    changed.join(", ")
                ),
            ));
        }
        let (root_obs, new_obs) = (ids_of(&root, "obs_ids"), ids_of(new, "obs_ids"));
        let had = old.map(|o| ids_of(o, "obs_ids")).unwrap_or_default();
        let dropped = root_obs.iter().any(|o| !new_obs.contains(o));
        let gained = new_obs
            .iter()
            .any(|o| !root_obs.contains(o) && !had.contains(o));
        if (old.is_none() || had != new_obs) && (dropped || gained) {
            return Err(refuse(
                rel,
                "De observaties van een herkansing of inhaaltoets zijn die van het origineel: pas \
                 ze aan bij het origineel."
                    .into(),
            ));
        }
        return Ok(());
    }
    // An original: family fields and observaties go through save_exam_family once it has
    // attempts.
    let Some(old) = old else { return Ok(()) };
    let mut changed = labels_changed(&FAMILY_FIELDS, old, new);
    if ids_of(old, "obs_ids") != ids_of(new, "obs_ids") {
        changed.push("observaties".into());
    }
    if changed.is_empty() || attempts_of(storage, year, id)?.is_empty() {
        return Ok(());
    }
    Err(refuse(
        rel,
        format!(
            "Deze toets heeft herkansingen: {} pas je aan via de verzamelkaart, voor alle \
             pogingen tegelijk.",
            changed.join(", ")
        ),
    ))
}

/// 2.3, 10 m6: an exam with data or with attempts is not deleted.
fn guard_exam_delete(storage: &Storage, rel: &RelPath, year: &str, id: &str) -> Result<()> {
    let Some(old) = storage
        .read_json(rel)
        .map_err(|e| unreadable(rel.as_str(), &e))?
    else {
        return Ok(());
    };
    if !attempts_of(storage, year, id)?.is_empty() {
        return Err(refuse(
            rel,
            "Er zijn herkansingen gekoppeld aan deze toets. Verwijder die eerst.".into(),
        ));
    }
    if exam_has_data(storage, year, vak_of(Some(&old), &old), id)? {
        return Err(refuse(
            rel,
            "Er zijn scores ingevoerd voor deze toets, de toets kan dus niet worden verwijderd."
                .into(),
        ));
    }
    Ok(())
}

/// Saves a whole herkansing family at once (decision 5): the original and every attempt, as
/// the verzamelkaart and the test editor change them. Checks that the members agree on the
/// family fields and that every attempt keeps the original's observaties, then saves the
/// attempts and the original last (a failure halfway leaves the original as it was, so saving
/// again repeats it), each with its own `_meta.rev` check (`Storage::save_entity`). The other
/// locks still apply to each member.
pub fn save_exam_family(
    storage: &Storage,
    year: &str,
    exams: &[Value],
    user_id: Option<&str>,
    now: std::time::SystemTime,
) -> Result<Vec<Value>> {
    let bad = |message: String| Error::InvalidArgument { message };
    if !is_year_name(year) {
        return Err(bad(format!("Geen schooljaar: {year:?}")));
    }
    let roots: Vec<&Value> = exams.iter().filter(|e| parent_of(e).is_none()).collect();
    let [root] = roots.as_slice() else {
        return Err(bad("Een toetsfamilie heeft precies één origineel.".into()));
    };
    let root_id = text_of(root, "id").ok_or_else(|| bad("Toets zonder id.".into()))?;
    let root_rel = exam_path(year, root_id)?;
    let mut given = BTreeSet::new();
    for e in exams {
        let id = text_of(e, "id").ok_or_else(|| bad("Toets zonder id.".into()))?;
        if e != *root && parent_of(e) != Some(root_id) {
            return Err(bad(format!("{id} hoort niet bij {root_id}.")));
        }
        given.insert(id.to_owned());
    }
    // Every attempt on disk must be in it, or it would no longer agree.
    if let Some(missing) = attempts_of(storage, year, root_id)?
        .into_iter()
        .find(|id| !given.contains(id))
    {
        return Err(refuse(
            &root_rel,
            format!("Niet opgeslagen: poging {missing} ontbreekt. Open de verzamelkaart opnieuw."),
        ));
    }
    let root_obs = ids_of(root, "obs_ids");
    for e in exams.iter().filter(|e| parent_of(e).is_some()) {
        let changed = labels_changed(&FAMILY_FIELDS, root, e);
        if !changed.is_empty() {
            return Err(refuse(
                &root_rel,
                format!(
                    "Niet opgeslagen: de pogingen verschillen in {}.",
                    changed.join(", ")
                ),
            ));
        }
        if root_obs.iter().any(|o| !ids_of(e, "obs_ids").contains(o)) {
            return Err(refuse(
                &root_rel,
                "Niet opgeslagen: een poging mist een observatie van het origineel.".into(),
            ));
        }
    }
    struct Reset(bool);
    impl Drop for Reset {
        fn drop(&mut self) {
            FAMILY.with(|c| c.set(self.0));
        }
    }
    let _reset = Reset(FAMILY.with(|c| c.replace(true)));
    let mut saved = Vec::new();
    for e in exams
        .iter()
        .filter(|e| parent_of(e).is_some())
        .chain(std::iter::once(*root))
    {
        let id = text_of(e, "id").unwrap_or_default();
        let base_rev = e
            .get("_meta")
            .and_then(|m| m.get("rev"))
            .and_then(Value::as_i64);
        saved.push(storage.save_entity(&exam_path(year, id)?, e, base_rev, false, user_id, now)?);
    }
    Ok(saved)
}

// ── Observaties ───────────────────────────────────────────────────────────────────────────

/// What links an observatie: tests (any year), rubrics and opdrachten.
#[derive(Default)]
struct ObsLinks {
    /// `(title, jaarlaag, schoolsoorten, vak)` of each linked test.
    tests: Vec<(String, String, Vec<String>, String)>,
    /// `(naam, jaarlagen, schoolsoorten, vak)` of each linked rubric.
    rubrics: Vec<(String, Vec<String>, Vec<String>, String)>,
    opdrachten: Vec<String>,
}

fn texts(v: &Value, key: &str) -> Vec<String> {
    v.get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(id_text)
        .collect()
}

fn links_of(storage: &Storage, id: &str) -> Result<ObsLinks> {
    let mut out = ObsLinks::default();
    let label = |v: &Value, key: &str| text_of(v, key).unwrap_or("?").to_owned();
    for year in storage
        .try_list_years()
        .map_err(|e| unreadable("de gedeelde map", &e))?
    {
        let dir = RelPath::parse(&format!("{year}/exams"))?;
        for name in storage
            .list_dir(&dir, false)
            .map_err(|e| unreadable(dir.as_str(), &e))?
        {
            let Some(exam_id) = name.strip_suffix(".json") else {
                continue;
            };
            let Some(exam) = read_exam(storage, &year, exam_id)? else {
                continue;
            };
            if ids_of(&exam, "obs_ids").contains(id) {
                out.tests.push((
                    format!("{} ({year})", label(&exam, "title")),
                    exam.get("jaarlaag").and_then(id_text).unwrap_or_default(),
                    texts(&exam, "schoolsoort"),
                    label(&exam, "subject"),
                ));
            }
        }
    }
    let dir = RelPath::parse(crate::rubrics::RUBRICS_DIR)?;
    for name in storage
        .list_dir(&dir, false)
        .map_err(|e| unreadable(dir.as_str(), &e))?
    {
        if !name.ends_with(".json") {
            continue;
        }
        let file = dir.join(&name)?;
        let Some(rubric) = storage
            .read_json(&file)
            .map_err(|e| unreadable(file.as_str(), &e))?
        else {
            continue;
        };
        let in_categories = rubric
            .get("categories")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .any(|c| ids_of(c, "obs_ids").contains(id));
        if ids_of(&rubric, "obs_ids").contains(id) || in_categories {
            out.rubrics.push((
                label(&rubric, "naam"),
                texts(&rubric, "jaarlagen"),
                texts(&rubric, "schoolsoort"),
                label(&rubric, "subject"),
            ));
        }
    }
    for opdracht in crate::opdracht_images::read_all(storage)? {
        if ids_of(&opdracht, "observaties").contains(id) {
            out.opdrachten.push(label(&opdracht, "naam"));
        }
    }
    Ok(out)
}

/// Decision 13, 2.6: a linked observatie is not deleted; the message names what links it.
fn guard_obs_delete(storage: &Storage, rel: &RelPath, id: &str) -> Result<()> {
    let links = links_of(storage, id)?;
    let mut names: Vec<String> = Vec::new();
    names.extend(links.tests.iter().map(|t| format!("toets {}", t.0)));
    names.extend(links.rubrics.iter().map(|r| format!("rubric {}", r.0)));
    names.extend(links.opdrachten.iter().map(|o| format!("opdracht {o}")));
    if names.is_empty() {
        return Ok(());
    }
    Err(refuse(
        rel,
        format!(
            "Deze observatie is gekoppeld en kan dus niet worden verwijderd: {}.",
            names.join(", ")
        ),
    ))
}

/// The vakken of an observatie: `subjects`, or the older single `subject`.
fn obs_vakken(obs: &Value) -> Vec<String> {
    let list = texts(obs, "subjects");
    if list.is_empty() {
        text_of(obs, "subject")
            .map(str::to_owned)
            .into_iter()
            .collect()
    } else {
        list
    }
}

/// Toetstypes, absent meaning `toets` (decision 23).
fn toetstypes(obs: &Value) -> Vec<String> {
    match obs.get(crate::rubrics::TOETSTYPES_FIELD) {
        Some(Value::Array(_)) => texts(obs, crate::rubrics::TOETSTYPES_FIELD),
        _ => vec!["toets".to_owned()],
    }
}

/// Whether `value` is allowed by `list`, where an empty list allows everything (an observatie
/// without jaarlagen or schoolsoort passes the Observaties tab's filters too).
fn allows(list: &[String], value: &str) -> bool {
    list.is_empty() || list.iter().any(|v| v == value)
}

/// The wiskunde variants an observatie names; a test or rubric of vak `wi` fits any of them (the
/// UI's `obsMatchesSubject`, `WI_VARIANTS`).
const WI_VARIANTS: [&str; 5] = ["wisob", "wisa", "wisb", "wisc", "wisd"];

/// Whether an observatie with vakken `vak` fits a test or rubric of `subject`.
fn fits_vak(vak: &[String], subject: &str) -> bool {
    if subject == "wi" {
        vak.iter().any(|v| WI_VARIANTS.contains(&v.as_str()))
    } else {
        vak.iter().any(|v| v == subject)
    }
}

/// A vak as the refusal names it.
fn vak_label(subject: &str) -> &str {
    if subject == "wi" { "wiskunde" } else { subject }
}

/// What one linked test (`jaarlaag`, `schoolsoort`, `subject`) uses that `obs` does not allow.
fn test_misfits(obs: &Value, jaarlaag: &str, schoolsoort: &[String], subject: &str) -> Vec<String> {
    let (jl, ss, vak) = (
        texts(obs, "jaarlagen"),
        texts(obs, "schoolsoort"),
        obs_vakken(obs),
    );
    let mut out = Vec::new();
    if !allows(&jl, jaarlaag) {
        out.push(format!("jaarlaag {jaarlaag}"));
    }
    out.extend(schoolsoort.iter().filter(|s| !allows(&ss, s)).cloned());
    if !fits_vak(&vak, subject) {
        out.push(format!("vak {}", vak_label(subject)));
    }
    out
}

/// What one linked rubric uses that `obs` does not allow.
fn rubric_misfits(
    obs: &Value,
    jaarlagen: &[String],
    schoolsoort: &[String],
    subject: &str,
) -> Vec<String> {
    let (jl, ss, vak) = (
        texts(obs, "jaarlagen"),
        texts(obs, "schoolsoort"),
        obs_vakken(obs),
    );
    let mut out: Vec<String> = jaarlagen
        .iter()
        .filter(|j| !allows(&jl, j))
        .map(|j| format!("jaarlaag {j}"))
        .collect();
    out.extend(schoolsoort.iter().filter(|s| !allows(&ss, s)).cloned());
    if !fits_vak(&vak, subject) {
        out.push(format!("vak {}", vak_label(subject)));
    }
    out
}

/// Whether two schoolsoort lists share one; an empty list stands for all of them.
fn shares(a: &[String], b: &[String]) -> bool {
    a.is_empty() || b.is_empty() || a.iter().any(|s| b.contains(s))
}

/// Gegevenscontrole (other PCs, edit-locks.md section 5): why the test `exam` should not have the
/// observatie `obs`, by the rule the test editor offers observaties with (`toets-edit.ts`:
/// toetstype Toets, the jaarlaag, a shared schoolsoort, the vak). A link that rule never makes
/// came from elsewhere. Empty when it fits. The write guard is stricter (decision 12: no value
/// in use is removed), so the app cannot make what this reports.
pub(crate) fn obs_misfits_test(obs: &Value, exam: &Value) -> Vec<String> {
    let jaarlaag = exam.get("jaarlaag").and_then(id_text).unwrap_or_default();
    let (ss, mine) = (texts(exam, "schoolsoort"), texts(obs, "schoolsoort"));
    let subject = text_of(exam, "subject").unwrap_or("?");
    let mut out = Vec::new();
    if !allows(&texts(obs, "jaarlagen"), &jaarlaag) {
        out.push(format!("jaarlaag {jaarlaag}"));
    }
    if !shares(&ss, &mine) {
        out.push(ss.join("/"));
    }
    if !fits_vak(&obs_vakken(obs), subject) {
        out.push(format!("vak {}", vak_label(subject)));
    }
    if !toetstypes(obs).iter().any(|t| t == "toets") {
        out.push("toetstype Toets".into());
    }
    out
}

/// Gegevenscontrole: why PO `po` should not have its rubric, by the rule the PO form offers
/// rubrics with (`matchingRubrics`: the vak, a shared schoolsoort, the jaarlaag). Empty when it
/// fits. The rubric's write guard is stricter (decision 9).
pub(crate) fn po_misfits_rubric(po: &Value, rubric: &Value) -> Vec<String> {
    let (ss, theirs) = (texts(po, "schoolsoort"), texts(rubric, "schoolsoort"));
    let mut out = Vec::new();
    if let Some(j) = po.get("jaarlaag").and_then(id_text)
        && !texts(rubric, "jaarlagen").contains(&j)
    {
        out.push(format!("jaarlaag {j}"));
    }
    if !shares(&ss, &theirs) {
        out.push(ss.join("/"));
    }
    if let (Some(m), Some(t)) = (text_of(po, "subject"), text_of(rubric, "subject"))
        && m != t
    {
        out.push(format!("vak {m}"));
    }
    out
}

/// What a linked test or rubric uses that `obs` does not allow.
fn misfits(links: &ObsLinks, obs: &Value) -> Vec<String> {
    let tt = toetstypes(obs);
    let mut out = Vec::new();
    for (naam, jaarlaag, schoolsoort, subject) in &links.tests {
        for m in test_misfits(obs, jaarlaag, schoolsoort, subject) {
            out.push(format!("{m} (toets {naam})"));
        }
    }
    if !links.tests.is_empty() && !tt.iter().any(|t| t == "toets") {
        out.push("toetstype Toets".into());
    }
    for (naam, jaarlagen, schoolsoort, subject) in &links.rubrics {
        for m in rubric_misfits(obs, jaarlagen, schoolsoort, subject) {
            out.push(format!("{m} (rubric {naam})"));
        }
    }
    if !links.rubrics.is_empty() && !tt.iter().any(|t| t == "po") {
        out.push("toetstype PO".into());
    }
    out
}

/// Decision 12 and the toetstype rule (2.6): what a linked test or rubric uses stays. Only what
/// this write takes away counts: a link that already did not fit is Gegevenscontrole's.
fn guard_obs(storage: &Storage, rel: &RelPath, id: &str, new: &Value) -> Result<()> {
    let Some(old) = storage
        .read_json(rel)
        .map_err(|e| unreadable(rel.as_str(), &e))?
    else {
        return Ok(());
    };
    let fields = ["jaarlagen", "schoolsoort", "subjects", "subject"];
    let narrowed =
        fields.iter().any(|f| old.get(*f) != new.get(*f)) || toetstypes(&old) != toetstypes(new);
    if !narrowed {
        return Ok(());
    }
    let links = links_of(storage, id)?;
    let before = misfits(&links, &old);
    let mut taken: Vec<String> = misfits(&links, new)
        .into_iter()
        .filter(|m| !before.contains(m))
        .collect();
    taken.sort();
    taken.dedup();
    if taken.is_empty() {
        return Ok(());
    }
    Err(refuse(
        rel,
        format!(
            "Deze observatie is gekoppeld, dus dit blijft erin: {}.",
            taken.join("; ")
        ),
    ))
}

#[cfg(test)]
mod tests;
