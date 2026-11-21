// SPDX-License-Identifier: AGPL-3.0-or-later

//! Roles and rights (step 35; ADR-0006 amendment "Roles and rights", PLAN-2 decisions 78-80).
//!
//! The login session carries a [`Role`], not only the user id. The role is checked against
//! `school.json` again at every guarded write ([`effective_role`]), so an admin who removes a
//! sectievoorzitter or -secretaris takes the rights away at once (backlog 7b n4).
//!
//! **Score lock (decision 78-79).** A teacher changes the score file of a student
//! (`<year>/scores/<vak>/<id>.json`) only when the student is in one of the teacher's groups of
//! that vak (a group of that school year whose `docenten` name the teacher). The voorzitter and
//! the secretaris of the vak (logged in as such) and the admin change every score file. Exams stay
//! open to every teacher of the vak, so the score changes an exam edit brings with it stay allowed
//! for anyone: see [`check_json_write`]. Like the PIN, this guards the shared PC, not the files.

use std::collections::BTreeSet;

use serde_json::{Map, Value};

use crate::error::{Error, Result};
use crate::paths::RelPath;
use crate::storage::Storage;

/// The score file keys that hold per-exam entries.
const EXAM_KEYS: [&str; 4] = ["scores", "overrides", "observations", "po"];
/// Score file keys that never need a right (bookkeeping).
const FREE_KEYS: [&str; 2] = ["_meta", "student_id"];

/// The first login with this app raises `school.json` `minAppVersion` to this: an older app
/// would ignore the score lock, so it opens read-only (step 35).
pub const RIGHTS_MIN_APP_VERSION: &str = "0.26.0";

/// After every login: raise `minAppVersion` (see [`RIGHTS_MIN_APP_VERSION`]). A failure (a
/// read-only folder, a conflict) is logged; the next login tries again.
pub fn after_login(storage: &Storage) {
    if let Err(e) = crate::rubrics::ensure_min_app_version(storage, RIGHTS_MIN_APP_VERSION) {
        tracing::warn!("minAppVersion not raised to {RIGHTS_MIN_APP_VERSION}: {e}");
    }
}

/// How a user logged in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Role {
    /// A teacher: their own groups' scores.
    Docent,
    /// Sectievoorzitter or sectiesecretaris of the vak (decision 80: the same rights).
    Bestuur(String),
    /// The admin.
    Beheer,
}

impl Role {
    /// `docent`, `bestuur:<vak>` or `beheer` (what the UI sends at login).
    pub fn parse(raw: &str) -> Result<Role> {
        match raw.split_once(':') {
            None if raw == "docent" => Ok(Role::Docent),
            None if raw == "beheer" => Ok(Role::Beheer),
            Some(("bestuur", vak)) if is_vak_key(vak) => Ok(Role::Bestuur(vak.to_owned())),
            _ => Err(invalid(&format!("Onbekende rol: {raw}"))),
        }
    }

    pub fn as_string(&self) -> String {
        match self {
            Role::Docent => "docent".to_owned(),
            Role::Bestuur(vak) => format!("bestuur:{vak}"),
            Role::Beheer => "beheer".to_owned(),
        }
    }
}

fn is_vak_key(vak: &str) -> bool {
    !vak.is_empty()
        && vak
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Who is logged in on this machine, and how.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Session {
    pub user_id: String,
    pub role: Role,
}

fn invalid(message: &str) -> Error {
    Error::InvalidArgument {
        message: message.to_owned(),
    }
}

fn forbidden(message: impl Into<String>) -> Error {
    Error::Forbidden {
        message: message.into(),
    }
}

fn read_school(storage: &Storage) -> Result<Option<Value>> {
    // An unreadable school.json (still syncing) counts as "no secties".
    Ok(storage
        .read_json(&RelPath::parse("school.json")?)
        .ok()
        .flatten())
}

fn read_user(storage: &Storage, user_id: &str) -> Option<Map<String, Value>> {
    let rel = crate::auth::user_path(user_id).ok()?;
    match storage.read_json(&rel).ok()?? {
        Value::Object(user) => Some(user),
        _ => None,
    }
}

fn is_active(user: &Map<String, Value>) -> bool {
    user.get("actief") != Some(&Value::Bool(false))
}

/// The voorzitter and the secretaris of `vak` in `school.json` (`secties.<vak>`).
pub fn bestuur_of(school: &Value, vak: &str) -> Vec<String> {
    let Some(sectie) = school.pointer(&format!("/secties/{vak}")) else {
        return vec![];
    };
    ["voorzitter", "secretaris"]
        .iter()
        .filter_map(|k| sectie.get(*k).and_then(Value::as_str))
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
        .collect()
}

/// Whether `user_id` may log in with `role` now: a bestuur role needs `school.json` to name the
/// user for that vak, beheer needs an active admin. Every role needs an active user.
pub fn role_allowed(storage: &Storage, user_id: &str, role: &Role) -> Result<bool> {
    let Some(user) = read_user(storage, user_id) else {
        return Ok(false);
    };
    if !is_active(&user) {
        return Ok(false);
    }
    Ok(match role {
        Role::Docent => true,
        Role::Beheer => user.get("isAdmin") == Some(&Value::Bool(true)),
        Role::Bestuur(vak) => read_school(storage)?
            .is_some_and(|school| bestuur_of(&school, vak).iter().any(|id| id == user_id)),
    })
}

/// The role as it holds now: a bestuur or beheer role the user lost since the login falls back
/// to docent (7b n4). A deactivated user keeps no rights at all (`None`).
pub fn effective_role(storage: &Storage, session: &Session) -> Result<Option<Role>> {
    if role_allowed(storage, &session.user_id, &session.role)? {
        return Ok(Some(session.role.clone()));
    }
    if role_allowed(storage, &session.user_id, &Role::Docent)? {
        return Ok(Some(Role::Docent));
    }
    Ok(None)
}

/// `(year, vak, student id)` of `<year>/scores/<vak>/<id>.json` (folders and extension in any
/// ASCII case, as the rubric guard).
pub fn score_file(rel: &str) -> Option<(&str, &str, &str)> {
    let mut parts = rel.split('/');
    let (Some(year), Some(dir), Some(vak), Some(file), None) = (
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
        parts.next(),
    ) else {
        return None;
    };
    if !dir.eq_ignore_ascii_case("scores") || vak.is_empty() || file.len() <= 5 {
        return None;
    }
    let (stem, ext) = file.split_at(file.len() - 5);
    ext.eq_ignore_ascii_case(".json")
        .then_some((year, vak, stem))
}

/// Checks a JSON write from the UI against the session's rights. Only score files are guarded
/// (step 35); `new` = `None` is a delete.
pub fn check_json_write(
    storage: &Storage,
    session: Option<&Session>,
    rel: &RelPath,
    new: Option<&Value>,
) -> Result<()> {
    let Some((year, vak, student)) = score_file(rel.as_str()) else {
        return Ok(());
    };
    let session = session.ok_or_else(|| forbidden("Niet ingelogd."))?;
    let role = effective_role(storage, session)?
        .ok_or_else(|| forbidden("Deze gebruiker is gedeactiveerd."))?;
    match role {
        Role::Beheer => return Ok(()),
        Role::Bestuur(ref v) if v.eq_ignore_ascii_case(vak) => return Ok(()),
        _ => {}
    }
    let old = storage.read_json(rel).ok().flatten().unwrap_or(Value::Null);
    let empty = Value::Null;
    let new = new.unwrap_or(&empty);
    let changed = changed_entries(&old, new);
    if changed.is_empty() {
        return Ok(());
    }
    let year_ctx = YearGroups::read(storage, year, vak, &session.user_id)?;
    if year_ctx.teaches(student) {
        return Ok(());
    }
    for entry in &changed {
        let ok = match entry {
            Changed::Other => false,
            Changed::Exam(exam_id) => {
                exam_change_allowed(storage, (year, vak), &year_ctx, student, exam_id, &old, new)?
            }
        };
        if !ok {
            return Err(forbidden(format!(
                "Je mag de scores van leerling {student} niet wijzigen: die leerling zit niet in \
                 een van je groepen. De docent van de leerling, de sectievoorzitter of de \
                 sectiesecretaris kan dat wel."
            )));
        }
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Changed {
    Exam(String),
    /// A key outside the per-exam ones.
    Other,
}

fn obj(v: &Value) -> Option<&Map<String, Value>> {
    v.as_object()
}

/// The entry of `key` for `exam` (absent = `None`).
fn entry<'a>(rec: &'a Value, key: &str, exam: &str) -> Option<&'a Value> {
    rec.get(key).and_then(|m| m.get(exam))
}

/// What differs between two score records, per exam.
fn changed_entries(old: &Value, new: &Value) -> BTreeSet<Changed> {
    let mut out = BTreeSet::new();
    let empty = Map::new();
    let (o, n) = (obj(old).unwrap_or(&empty), obj(new).unwrap_or(&empty));
    let keys: BTreeSet<&String> = o.keys().chain(n.keys()).collect();
    for key in keys {
        if FREE_KEYS.contains(&key.as_str()) {
            continue;
        }
        let (a, b) = (o.get(key.as_str()), n.get(key.as_str()));
        if !EXAM_KEYS.contains(&key.as_str()) {
            if a != b {
                out.insert(Changed::Other);
            }
            continue;
        }
        let (am, bm) = (
            a.and_then(obj).unwrap_or(&empty),
            b.and_then(obj).unwrap_or(&empty),
        );
        if a.is_some_and(|v| !v.is_object()) || b.is_some_and(|v| !v.is_object()) {
            if a != b {
                out.insert(Changed::Other);
            }
            continue;
        }
        for exam in am.keys().chain(bm.keys()) {
            if am.get(exam) != bm.get(exam) {
                out.insert(Changed::Exam(exam.clone()));
            }
        }
    }
    out
}

/// True when `new` holds nothing for the exam: everything was removed.
fn nothing_for(rec: &Value, exam: &str) -> bool {
    EXAM_KEYS.iter().all(|k| entry(rec, k, exam).is_none())
}

fn own_lines<'a>(rec: &'a Value, exam: &str) -> Option<&'a Value> {
    entry(rec, "po", exam).and_then(|p| p.get("ownLines"))
}

fn str_list(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array)
        .map(|a| a.iter().filter_map(id_string).collect())
        .unwrap_or_default()
}

/// A student or user id as a string (old files may hold numbers).
fn id_string(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

/// A change to one exam's entries of a student the user does not teach. Allowed only as the
/// consequence of an exam edit (any teacher of the vak may edit exams) or, for a PO, through a
/// projectgroep the user has a student in (decision 79):
///
/// - the exam is gone, or the student is in no projectgroep of the PO: only removing everything;
/// - a test: only removing observaties the exam no longer lists (`obs_ids`);
/// - a PO: a projectgroep with one of the user's students may be graded (not the student's own
///   lines); any other projectgroep only by the move of the student into it (taking the new
///   group's grading, decision 19), own lines unchanged.
fn exam_change_allowed(
    storage: &Storage,
    (year, vak): (&str, &str),
    groups: &YearGroups,
    student: &str,
    exam_id: &str,
    old: &Value,
    new: &Value,
) -> Result<bool> {
    let exam = RelPath::parse(&format!("{year}/exams/{exam_id}.json"))
        .ok()
        .and_then(|rel| storage.read_json(&rel).ok().flatten());
    let Some(exam) = exam else {
        return Ok(nothing_for(new, exam_id));
    };
    if exam.get("kind").and_then(Value::as_str) != Some("po") {
        let same = |k| entry(old, k, exam_id) == entry(new, k, exam_id);
        if !(same("scores") && same("overrides") && same("po")) {
            return Ok(false);
        }
        let before = str_list(entry(old, "observations", exam_id));
        let after = str_list(entry(new, "observations", exam_id));
        let listed = str_list(exam.get("obs_ids"));
        return Ok(after.iter().all(|o| before.contains(o))
            && before
                .iter()
                .filter(|o| !after.contains(o))
                .all(|o| !listed.contains(o)));
    }
    let group = exam
        .get("projectgroepen")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find(|g| str_list(g.get("student_ids")).iter().any(|s| s == student));
    let Some(group) = group else {
        return Ok(nothing_for(new, exam_id));
    };
    if own_lines(old, exam_id) != own_lines(new, exam_id) {
        return Ok(false);
    }
    if str_list(group.get("student_ids"))
        .iter()
        .any(|m| groups.teaches(m))
    {
        return Ok(true);
    }
    // The move (`takeNewGroupGrading`): from another projectgroep (or none) into this one, taking
    // a staying member's grading, or none when the group has no grading yet.
    let Some(group_id) = group.get("id").and_then(Value::as_str) else {
        return Ok(false);
    };
    let pg = |rec: &Value| {
        entry(rec, "po", exam_id)
            .and_then(|p| p.get("projectgroep"))
            .and_then(Value::as_str)
            .map(str::to_owned)
    };
    if pg(old).as_deref() == Some(group_id) {
        return Ok(false);
    }
    let grading = group_grading(new, exam_id);
    if grading.is_empty() {
        return Ok(true);
    }
    if pg(new).as_deref() != Some(group_id) {
        return Ok(false);
    }
    for member in str_list(group.get("student_ids")) {
        if member == student {
            continue;
        }
        let Ok(rel) = RelPath::parse(&format!("{year}/scores/{vak}/{member}.json")) else {
            continue;
        };
        if let Some(rec) = storage.read_json(&rel).ok().flatten()
            && group_grading(&rec, exam_id) == grading
        {
            return Ok(true);
        }
    }
    Ok(false)
}

/// The projectgroep's part of a student's PO entries (decision 19: the same in every member's
/// file), with empty values left out so that equal gradings compare equal: the category scores,
/// the general observaties, and `po` without `projectgroep` and `ownLines`.
fn group_grading(rec: &Value, exam: &str) -> Map<String, Value> {
    let mut out = Map::new();
    let keep = |v: &Value| match v {
        Value::Null => false,
        Value::String(s) => !s.trim().is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
        _ => true,
    };
    let clean = |v: &Value| -> Value {
        match v {
            Value::Object(o) => Value::Object(
                o.iter()
                    .filter(|(_, v)| keep(v))
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect(),
            ),
            other => other.clone(),
        }
    };
    if let Some(scores) = entry(rec, "scores", exam).map(clean).filter(keep) {
        out.insert("scores".into(), scores);
    }
    if let Some(obs) = entry(rec, "observations", exam).filter(|v| keep(v)) {
        out.insert("observations".into(), obs.clone());
    }
    if let Some(Value::Object(po)) = entry(rec, "po", exam) {
        for (k, v) in po {
            if k != "projectgroep" && k != "ownLines" && keep(v) {
                out.insert(format!("po.{k}"), clean(v));
            }
        }
    }
    out.retain(|_, v| keep(v));
    out
}

/// The students of the user's groups of one vak in one school year.
struct YearGroups {
    students: BTreeSet<String>,
}

impl YearGroups {
    fn read(storage: &Storage, year: &str, vak: &str, user_id: &str) -> Result<YearGroups> {
        let dir = RelPath::parse(&format!("{year}/groups"))?;
        let mut students = BTreeSet::new();
        for group in storage.read_all_json(&dir)? {
            let subject = group.get("subject").and_then(Value::as_str);
            if !subject.is_some_and(|s| s.eq_ignore_ascii_case(vak)) {
                continue;
            }
            if !str_list(group.get("docenten")).iter().any(|d| d == user_id) {
                continue;
            }
            students.extend(str_list(group.get("student_ids")));
        }
        Ok(YearGroups { students })
    }

    fn teaches(&self, student: &str) -> bool {
        self.students.contains(student)
    }
}

#[cfg(test)]
mod tests;
