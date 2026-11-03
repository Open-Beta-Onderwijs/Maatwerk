// SPDX-License-Identifier: AGPL-3.0-or-later

//! `validate-data`: checks a v2 data folder (`docs/reference/data-files-v2.md`) for corrupt or
//! misplaced files, broken stamps (C19), strays such as OneDrive conflict copies, and references
//! that point nowhere. Reads only. Messages are Dutch: the admin sees them.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use serde::Serialize;
use serde_json::Value;

use crate::error::{Error, Result};
use crate::integrity::{self, StampState};
use crate::migrate::{self, CURRENT_VERSION};
use crate::opdracht_images::IMAGE_EXTS;
use crate::paths::is_year_name;
use crate::storage::SUBJECTS;

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ValidationReport {
    pub schema_version: u64,
    pub files_checked: usize,
    pub issues: Vec<Issue>,
}

impl ValidationReport {
    pub fn errors(&self) -> usize {
        self.issues
            .iter()
            .filter(|i| i.severity == Severity::Error)
            .count()
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub severity: Severity,
    pub kind: IssueKind,
    /// Relative to the data folder.
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum Severity {
    Error,
    Warning,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum IssueKind {
    /// The folder is not v2.
    Version,
    /// Unreadable or not JSON.
    Corrupt,
    /// `_meta.hash` missing or wrong: changed outside Maatwerk.
    Stamp,
    /// The content does not have the expected shape.
    Shape,
    /// The id inside does not match the path.
    Placement,
    /// A reference to something that does not exist.
    Reference,
    /// A file Maatwerk does not use (conflict copy, leftover, unknown).
    Stray,
}

/// Validates the data folder `root`.
pub fn validate(root: &Path) -> Result<ValidationReport> {
    let version = migrate::folder_version(root)?;
    let mut found = Found::default();
    if version != CURRENT_VERSION {
        found.error(
            IssueKind::Version,
            "config.json",
            format!(
                "De gegevensmap heeft versie {version}; deze Maatwerk gebruikt versie \
                 {CURRENT_VERSION}. Migreer eerst."
            ),
        );
        return Ok(found.finish(version, 0));
    }
    let files = migrate::walk_all(root).map_err(|e| Error::io(".", e))?;
    let set: BTreeSet<&str> = files.iter().map(String::as_str).collect();
    let mut json = BTreeMap::new();
    for rel in &files {
        if let Some(value) = check_file(root, rel, &set, &mut found) {
            json.insert(rel.as_str(), value);
        }
    }
    check_references(root, &json, &set, &mut found);
    Ok(found.finish(version, files.len()))
}

/// Where a file belongs in the v2 layout.
enum Place<'a> {
    /// A JSON file Maatwerk owns; `id` = (field, expected value) when the path names it.
    Json(Option<(&'static str, &'a str)>),
    /// A file Maatwerk owns that is not JSON.
    Other,
    /// Not checked at all (`fotos/`, `snapshots/`).
    Ignored,
    Stray,
}

fn place(rel: &str) -> Place<'_> {
    let parts: Vec<&str> = rel.split('/').collect();
    match parts.as_slice() {
        ["config.json"] | ["school.json"] | ["instellingen.json"] => Place::Json(None),
        ["fotos", ..] | ["snapshots", ..] => Place::Ignored,
        ["gebruikers", f] | ["observaties", f] => named("id", f),
        ["users", f] => named("userId", f),
        ["opdrachten", id, "opdracht.json"] => Place::Json(Some(("id", id))),
        ["opdrachten", _, f] if f.ends_with(".typ") => Place::Other,
        ["opdrachten", _, "images", f] if is_image(f) => Place::Other,
        ["templates", "rtti", f] if is_template_name(f) => Place::Json(None),
        [year, f] if is_year_name(year) && *f == format!("students-{year}.json") => {
            Place::Json(None)
        }
        [year, "exams" | "groups", f] if is_year_name(year) => named("id", f),
        [year, "scores", subject, f] if is_year_name(year) && SUBJECTS.contains(subject) => {
            named("student_id", f)
        }
        _ => Place::Stray,
    }
}

/// A JSON file named after the id in `field`.
fn named<'a>(field: &'static str, file: &'a str) -> Place<'a> {
    match file.strip_suffix(".json").filter(|s| !s.is_empty()) {
        Some(id) => Place::Json(Some((field, id))),
        None => Place::Stray,
    }
}

fn is_image(name: &str) -> bool {
    name.rsplit_once('.')
        .is_some_and(|(_, ext)| IMAGE_EXTS.contains(&ext.to_ascii_lowercase().as_str()))
}

fn is_template_name(name: &str) -> bool {
    let Some((key, jaar)) = name.strip_suffix(".json").and_then(|s| s.rsplit_once('_')) else {
        return false;
    };
    let keys = ["nat", "bio", "schk", "wi", "wisa", "wisb", "wisc", "wisd"];
    keys.contains(&key) && matches!(jaar, "1" | "2" | "3" | "4" | "5" | "6")
}

/// `naam (2).json` or `naam-PCNAAM.json` next to an existing `naam.json`: OneDrive's copies.
fn conflict_copy_of(rel: &str, files: &BTreeSet<&str>) -> Option<String> {
    let (dir, name) = match rel.rsplit_once('/') {
        Some((d, n)) => (format!("{d}/"), n),
        None => (String::new(), rel),
    };
    let (stem, ext) = name.rsplit_once('.')?;
    if let Some((base, n)) = stem.strip_suffix(')').and_then(|s| s.rsplit_once(" ("))
        && !n.is_empty()
        && n.chars().all(|c| c.is_ascii_digit())
    {
        let original = format!("{dir}{base}.{ext}");
        return files.contains(original.as_str()).then_some(original);
    }
    let mut cut = stem;
    while let Some((base, _)) = cut.rsplit_once('-') {
        let original = format!("{dir}{base}.{ext}");
        if files.contains(original.as_str()) {
            return Some(original);
        }
        cut = base;
    }
    None
}

/// Checks one file on its own; returns the parsed JSON of a file Maatwerk owns.
fn check_file(root: &Path, rel: &str, files: &BTreeSet<&str>, out: &mut Found) -> Option<Value> {
    let id = match place(rel) {
        Place::Ignored | Place::Other => return None,
        Place::Stray => {
            let message = match conflict_copy_of(rel, files) {
                Some(original) => {
                    format!("OneDrive-conflictkopie van {original}; vergelijk en verwijder er één")
                }
                None if rel.ends_with(".lock") || rel.ends_with(".tmp") => {
                    "Overgebleven tijdelijk bestand; mag weg".into()
                }
                None => "Bestand dat Maatwerk niet gebruikt".into(),
            };
            out.warn(IssueKind::Stray, rel, message);
            return None;
        }
        Place::Json(id) => id,
    };
    let bytes = match fs::read(root.join(rel)) {
        Ok(b) => b,
        Err(e) => {
            out.error(IssueKind::Corrupt, rel, format!("Niet leesbaar: {e}"));
            return None;
        }
    };
    let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
        out.error(
            IssueKind::Corrupt,
            rel,
            "Geen geldige JSON (half gesynchroniseerd of beschadigd)".into(),
        );
        return None;
    };
    match integrity::check(&value) {
        StampState::Ok => {}
        StampState::Missing => out.warn(
            IssueKind::Stamp,
            rel,
            "Buiten Maatwerk gemaakt of gewijzigd (geen stempel)".into(),
        ),
        StampState::Mismatch => out.warn(
            IssueKind::Stamp,
            rel,
            "Buiten Maatwerk gewijzigd (stempel klopt niet)".into(),
        ),
    }
    if !value.is_object() {
        out.error(IssueKind::Shape, rel, "Geen JSON-object".into());
        return None;
    }
    if let Some((field, expected)) = id {
        let found = value.get(field).and_then(Value::as_str);
        // OneDrive copies the content, so a copy's id names the original.
        if found != Some(expected)
            && let Some(original) = conflict_copy_of(rel, files)
        {
            out.warn(
                IssueKind::Stray,
                rel,
                format!("OneDrive-conflictkopie van {original}; vergelijk en verwijder er één"),
            );
            return None;
        }
        if found != Some(expected) {
            let found = found.map_or("leeg".to_owned(), |f| format!("{f:?}"));
            out.error(
                IssueKind::Placement,
                rel,
                format!("{field} in het bestand is {found}, de bestandsnaam zegt {expected:?}"),
            );
        }
    }
    Some(value)
}

fn ids_in(json: &BTreeMap<&str, Value>, prefix: &str, suffix: &str) -> BTreeSet<String> {
    json.keys()
        .filter_map(|k| k.strip_prefix(prefix)?.strip_suffix(suffix))
        .filter(|id| !id.contains('/'))
        .map(str::to_owned)
        .collect()
}

/// Per year: student ids and exam ids.
type YearIds = (BTreeSet<String>, BTreeSet<String>);

fn year_ids<'a>(json: &BTreeMap<&'a str, Value>, out: &mut Found) -> BTreeMap<&'a str, YearIds> {
    let mut years: BTreeMap<&str, YearIds> = BTreeMap::new();
    for (&rel, value) in json {
        let Some((year, rest)) = rel.split_once('/') else {
            continue;
        };
        if !is_year_name(year) {
            continue;
        }
        let entry = years.entry(year).or_default();
        if let Some(id) = rest
            .strip_prefix("exams/")
            .and_then(|f| f.strip_suffix(".json"))
        {
            entry.1.insert(id.to_owned());
            continue;
        }
        if rest != format!("students-{year}.json") {
            continue;
        }
        let Some(list) = value.get("students").and_then(Value::as_array) else {
            out.error(IssueKind::Shape, rel, "Geen lijst \"students\"".into());
            continue;
        };
        for s in list {
            match s.get("id") {
                Some(Value::String(id)) if !entry.0.insert(id.clone()) => {
                    out.warn(
                        IssueKind::Shape,
                        rel,
                        format!("Leerling {id} staat er dubbel in"),
                    );
                }
                Some(Value::String(_)) => {}
                other => {
                    let id = other.map_or("(leeg)".into(), Value::to_string);
                    out.warn(
                        IssueKind::Shape,
                        rel,
                        format!("Leerlingnummer {id} is geen tekst"),
                    );
                }
            }
        }
    }
    years
}

fn check_references(
    root: &Path,
    json: &BTreeMap<&str, Value>,
    files: &BTreeSet<&str>,
    out: &mut Found,
) {
    let users = ids_in(json, "gebruikers/", ".json");
    let observaties = ids_in(json, "observaties/", ".json");
    let opdrachten = ids_in(json, "opdrachten/", "/opdracht.json");
    let years = year_ids(json, out);
    let empty = YearIds::default();

    for (&rel, value) in json {
        let (year, rest) = rel.split_once('/').unwrap_or(("", rel));
        let (students, exams) = years.get(year).unwrap_or(&empty);
        let list = |key: &str| -> Vec<&str> {
            value
                .get(key)
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(Value::as_str).collect())
                .unwrap_or_default()
        };
        let absent_file = |key: &str| {
            value
                .get(key)
                .and_then(Value::as_str)
                .filter(|f| !f.is_empty() && !files.contains(f))
        };
        if rel.starts_with("gebruikers/") {
            if let Some(f) = absent_file("foto") {
                out.missing(rel, format!("Foto {f} ontbreekt"));
            }
        } else if rel == "school.json" {
            for key in ["logo", "watermerk"] {
                if let Some(f) = absent_file(key) {
                    out.missing(rel, format!("{key} {f} ontbreekt"));
                }
            }
            // Step 7b: `secties: { <vak>: { voorzitter: <userId> } }`.
            let secties = value.get("secties").and_then(Value::as_object);
            for (vak, sectie) in secties.into_iter().flatten() {
                let voorzitter = sectie.get("voorzitter").and_then(Value::as_str);
                if let Some(u) = voorzitter.filter(|u| !users.contains(*u)) {
                    out.missing(
                        rel,
                        format!("Sectievoorzitter {vak}: gebruiker {u} bestaat niet"),
                    );
                }
            }
        } else if let Some(id) = rel
            .strip_prefix("opdrachten/")
            .and_then(|r| r.strip_suffix("/opdracht.json"))
        {
            for obs in list("observaties") {
                if !observaties.contains(obs) {
                    out.missing(rel, format!("Observatie {obs} bestaat niet"));
                }
            }
            for name in ["main.typ", "opdracht.typ", "lib.typ"] {
                if !files.contains(format!("opdrachten/{id}/{name}").as_str()) {
                    out.error(IssueKind::Reference, rel, format!("{name} ontbreekt"));
                }
            }
            let typ_rel = format!("opdrachten/{id}/opdracht.typ");
            let typ = fs::read_to_string(root.join(&typ_rel)).unwrap_or_default();
            for img in image_refs(&typ) {
                if !files.contains(format!("opdrachten/{id}/{img}").as_str()) {
                    out.missing(&typ_rel, format!("Afbeelding {img} ontbreekt"));
                }
            }
        } else if rest.starts_with("groups/") {
            for s in list("student_ids") {
                if !students.contains(s) {
                    out.missing(rel, format!("Leerling {s} bestaat niet in {year}"));
                }
            }
            if let Some(ids) = value.get("student_ids").and_then(Value::as_array)
                && ids.iter().any(|i| !i.is_string())
            {
                out.warn(
                    IssueKind::Shape,
                    rel,
                    "Leerlingnummers zijn geen tekst".into(),
                );
            }
            for d in list("docenten") {
                if !users.contains(d) {
                    out.missing(rel, format!("Docent {d} bestaat niet"));
                }
            }
        } else if rest.starts_with("exams/") {
            check_exam(rel, value, exams, &observaties, &opdrachten, out);
        } else if rest.starts_with("scores/") {
            check_scores(rel, year, value, students, exams, out);
        }
    }
}

fn check_exam(
    rel: &str,
    exam: &Value,
    exams: &BTreeSet<String>,
    observaties: &BTreeSet<String>,
    opdrachten: &BTreeSet<String>,
    out: &mut Found,
) {
    if let Some(parent) = exam.get("parent_id").and_then(Value::as_str)
        && !exams.contains(parent)
    {
        out.missing(rel, format!("Oorspronkelijke toets {parent} bestaat niet"));
    }
    let obs_ids = exam.get("obs_ids").and_then(Value::as_array);
    for obs in obs_ids.into_iter().flatten().filter_map(Value::as_str) {
        if !observaties.contains(obs) {
            out.missing(rel, format!("Observatie {obs} bestaat niet"));
        }
    }
    if let Some(Value::Object(coupling)) = exam.get("opdrachten") {
        for (obs, ops) in coupling {
            for op in ops
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
            {
                if !opdrachten.contains(op) {
                    out.missing(rel, format!("Opdracht {op} (bij {obs}) bestaat niet"));
                }
            }
        }
    }
    check_question_ids(rel, exam, out);
    let jaarlaag: u32 = exam
        .get("jaarlaag")
        .and_then(Value::as_str)
        .and_then(|j| j.parse().ok())
        .unwrap_or(0);
    let sub = exam.get("subcategory").and_then(Value::as_str);
    if exam.get("subject").and_then(Value::as_str) == Some("wi")
        && jaarlaag >= 4
        && !matches!(sub, Some("wisa" | "wisb" | "wisc" | "wisd"))
    {
        out.warn(
            IssueKind::Shape,
            rel,
            "Wiskunde bovenbouw zonder subcategorie: het rapport vindt geen leeradvies".into(),
        );
    }
}

/// Quirk B24: two questions with the same id share one score slot. Reported only; a repair
/// would change saved exams and scores. A warning, not an error (review 10 M2): the app cannot
/// fix it, and an error would make the migration screen advise rolling back the cutover.
fn check_question_ids(rel: &str, exam: &Value, out: &mut Found) {
    let mut seen: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    let questions = exam.get("questions").and_then(Value::as_array);
    for (i, q) in questions.into_iter().flatten().enumerate() {
        // Numeric ids in hand-edited or very old files count too (review 10 n5).
        let id = match q.get("id") {
            Some(Value::String(s)) => s.clone(),
            Some(Value::Number(n)) => n.to_string(),
            _ => continue,
        };
        seen.entry(id).or_default().push(i + 1);
    }
    for (id, rows) in seen.into_iter().filter(|(_, rows)| rows.len() > 1) {
        let rows: Vec<String> = rows.iter().map(ToString::to_string).collect();
        out.warn(
            IssueKind::Shape,
            rel,
            format!(
                "Vraag-id {id} komt {} keer voor (vraag {} in de lijst): de scores van deze                  vragen vallen samen, dus de cijfers van deze toets kunnen niet kloppen. Niet zelf                  aanpassen; meld het bij de ontwikkelaar.",
                rows.len(),
                rows.join(", ")
            ),
        );
    }
}

fn check_scores(
    rel: &str,
    year: &str,
    record: &Value,
    students: &BTreeSet<String>,
    exams: &BTreeSet<String>,
    out: &mut Found,
) {
    match record.get("student_id") {
        Some(Value::String(sid)) if !students.contains(sid) => {
            out.missing(rel, format!("Leerling {sid} bestaat niet in {year}"));
        }
        Some(Value::String(_)) => {}
        _ => out.warn(IssueKind::Shape, rel, "student_id is geen tekst".into()),
    }
    let mut orphans = BTreeSet::new();
    for key in ["scores", "observations", "overrides"] {
        if let Some(Value::Object(map)) = record.get(key) {
            orphans.extend(map.keys().filter(|e| !exams.contains(*e)).cloned());
        }
    }
    for e in orphans {
        out.missing(rel, format!("Scores voor toets {e}, die niet bestaat"));
    }
    if let Some(Value::Object(map)) = record.get("scores") {
        let odd = map
            .values()
            .filter_map(Value::as_object)
            .flat_map(|qs| qs.values())
            .any(|v| !(v.is_number() || v.is_string()));
        if odd {
            out.warn(
                IssueKind::Shape,
                rel,
                "Score die geen getal of tekst is (null uit v1?)".into(),
            );
        }
    }
}

/// Paths in `image("...")` calls of an opdracht's Typst text (relative to its folder).
fn image_refs(typ: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = typ;
    while let Some(i) = rest.find("image(") {
        rest = &rest[i + "image(".len()..];
        if let Some(lit) = rest.trim_start().strip_prefix('"')
            && let Some(end) = lit.find('"')
        {
            let path = &lit[..end];
            if !path.contains("://") && !path.starts_with('/') {
                out.push(path.to_owned());
            }
        }
    }
    out
}

#[derive(Default)]
struct Found(Vec<Issue>);

impl Found {
    fn push(&mut self, severity: Severity, kind: IssueKind, path: &str, message: String) {
        self.0.push(Issue {
            severity,
            kind,
            path: path.to_owned(),
            message,
        });
    }

    fn error(&mut self, kind: IssueKind, path: &str, message: String) {
        self.push(Severity::Error, kind, path, message);
    }

    fn warn(&mut self, kind: IssueKind, path: &str, message: String) {
        self.push(Severity::Warning, kind, path, message);
    }

    fn missing(&mut self, path: &str, message: String) {
        self.warn(IssueKind::Reference, path, message);
    }

    fn finish(mut self, version: u64, files: usize) -> ValidationReport {
        self.0
            .sort_by(|a, b| (a.severity, &a.path, a.kind).cmp(&(b.severity, &b.path, b.kind)));
        ValidationReport {
            schema_version: version,
            files_checked: files,
            issues: self.0,
        }
    }
}

#[cfg(test)]
mod tests;
