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

/// Where a file belongs in the v3 layout.
enum Place<'a> {
    /// A JSON file Maatwerk owns; `id` = (field, expected value) when the path names it.
    Json(Option<(&'static str, &'a str)>),
    /// A file Maatwerk owns that is not JSON.
    Other,
    /// Not checked at all (`afbeeldingen/`, `snapshots/`).
    Ignored,
    Stray,
}

fn place(rel: &str) -> Place<'_> {
    let parts: Vec<&str> = rel.split('/').collect();
    match parts.as_slice() {
        ["config.json"] | ["school.json"] | ["instellingen.json"] => Place::Json(None),
        ["snapshots", ..] => Place::Ignored,
        // Any case: a Windows-made folder is in use (T32, review 18 m6).
        [dir, ..] if dir.eq_ignore_ascii_case(crate::storage::IMAGES_DIR) => Place::Ignored,
        ["gebruikers", f] | ["observaties", f] | ["rubrics", f] => named("id", f),
        ["aanwezigheid", f] => named("userId", f),
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

/// A file in `fotos/` or `users/` (any case): the v2 names of `afbeeldingen/` and
/// `aanwezigheid/`. An old app on the folder would write there again.
fn v2_leftover(rel: &str) -> bool {
    let first = rel.split('/').next().unwrap_or("");
    rel.contains('/')
        && (first.eq_ignore_ascii_case(migrate::V2_IMAGES)
            || first.eq_ignore_ascii_case(migrate::V2_PRESENCE))
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

/// `a/b/naam.json` -> `naam`.
fn file_stem(rel: &str) -> &str {
    let name = rel.rsplit_once('/').map_or(rel, |(_, n)| n);
    name.rsplit_once('.').map_or(name, |(stem, _)| stem)
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
                None if v2_leftover(rel) => {
                    "Overgebleven uit gegevensversie 2 (fotos/ heet nu afbeeldingen/, users/ \
                     heet nu aanwezigheid/); mag weg na controle"
                        .into()
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
        // OneDrive copies the content, so a copy's id names the original; another id is a
        // misplaced file, not a copy (review 7a n4).
        if found != Some(expected)
            && let Some(original) = conflict_copy_of(rel, files)
            && found == Some(file_stem(&original))
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
    let rubrics = ids_in(json, "rubrics/", ".json");
    let po_observaties: BTreeSet<String> = json
        .iter()
        .filter(|(rel, v)| rel.starts_with("observaties/") && crate::rubrics::is_po_observatie(v))
        .filter_map(|(_, v)| v.get("id").and_then(Value::as_str).map(str::to_owned))
        .collect();
    let years = year_ids(json, out);
    let empty = YearIds::default();
    let exam_by = exams_by_id(json);

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
        } else if rel.starts_with("observaties/") {
            check_toetstypes(rel, value, out);
        } else if rel.starts_with("rubrics/") {
            check_rubric_file(rel, value, &observaties, &po_observaties, out);
        } else if rel == "school.json" {
            for key in ["logo", "watermerk"] {
                if let Some(f) = absent_file(key) {
                    out.missing(rel, format!("{key} {f} ontbreekt"));
                }
            }
            // Step 7b: `secties: { <vak>: { voorzitter: <userId> } }`; step 35 adds
            // `secretaris`: an active teacher of the vak, not the voorzitter.
            let secties = value.get("secties").and_then(Value::as_object);
            for (vak, sectie) in secties.into_iter().flatten() {
                let voorzitter = sectie.get("voorzitter").and_then(Value::as_str);
                if let Some(u) = voorzitter.filter(|u| !users.contains(*u)) {
                    out.missing(
                        rel,
                        format!("Sectievoorzitter {vak}: gebruiker {u} bestaat niet"),
                    );
                }
                let Some(sec) = sectie
                    .get("secretaris")
                    .and_then(Value::as_str)
                    .filter(|u| !u.is_empty())
                else {
                    continue;
                };
                if !users.contains(sec) {
                    out.missing(
                        rel,
                        format!("Sectiesecretaris {vak}: gebruiker {sec} bestaat niet"),
                    );
                    continue;
                }
                if voorzitter == Some(sec) {
                    out.warn(
                        IssueKind::Shape,
                        rel,
                        format!("Sectiesecretaris {vak}: {sec} is ook de sectievoorzitter"),
                    );
                }
                let user = json.get(format!("gebruikers/{sec}.json").as_str());
                let teaches = user.is_some_and(|u| {
                    u.get("actief") != Some(&Value::Bool(false))
                        && u.get("vakken")
                            .and_then(Value::as_array)
                            .is_some_and(|v| v.iter().any(|x| x.as_str() == Some(vak.as_str())))
                });
                if !teaches {
                    out.warn(
                        IssueKind::Reference,
                        rel,
                        format!("Sectiesecretaris {vak}: {sec} is geen actieve docent van dit vak"),
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
                if files.contains(format!("opdrachten/{id}/{img}").as_str()) {
                    continue;
                }
                let dir = root.join("opdrachten").join(id);
                match crate::typst_svc::world::find_ignoring_case(&dir, img.split('/')) {
                    // Maatwerk finds it on every platform (step 16b); other tools on Linux not.
                    Some(real) => out.warn(
                        IssueKind::Reference,
                        &typ_rel,
                        format!(
                            "Afbeelding {img} heet anders gespeld: {}",
                            real.strip_prefix(&dir)
                                .unwrap_or(&real)
                                .iter()
                                .map(|p| p.to_string_lossy())
                                .collect::<Vec<_>>()
                                .join("/")
                        ),
                    ),
                    None => out.missing(&typ_rel, format!("Afbeelding {img} ontbreekt")),
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
            if let Some(r) = crate::rubrics::exam_rubric_id(value)
                && !rubrics.contains(r)
            {
                out.missing(rel, format!("Rubric {r} bestaat niet"));
            }
            check_po_exam(rel, value, students, out);
            check_exam_rubric_refs(rel, year, value, &exam_by, out);
            check_exam_lock_fits(rel, value, json, out);
        } else if rest.starts_with("scores/") {
            check_scores(rel, year, value, students, exams, out);
            check_po_scores(rel, year, value, &exam_by, out);
            check_removed_questions(rel, year, value, &exam_by, out);
        }
    }
}

// ── Edit locks broken on another PC (step 41, edit-locks.md section 5) ──────────────────────
// A PC with an older Maatwerk, or two PCs at once through sync, can write around a lock. These
// checks only report it (warnings); nothing is rewritten.

/// The ids in `obs_ids` of `v`, in order, once.
fn obs_ids_of(v: &Value) -> Vec<&str> {
    let mut out: Vec<&str> = Vec::new();
    for id in v
        .get("obs_ids")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
    {
        if !out.contains(&id) {
            out.push(id);
        }
    }
    out
}

/// A PO outside its rubric's scope (decisions 8, 9) and an observatie the test uses outside the
/// observatie's scope (decision 12). Not for rubrics: the rubric editor offers every PO
/// observatie, so a rubric outside an observatie's scope is normal use there.
fn check_exam_lock_fits(rel: &str, exam: &Value, json: &BTreeMap<&str, Value>, out: &mut Found) {
    if crate::rubrics::is_po_exam(exam)
        && let Some(rid) = crate::rubrics::exam_rubric_id(exam)
        && let Some(rubric) = json.get(format!("rubrics/{rid}.json").as_str())
    {
        let misfits = crate::locks::po_misfits_rubric(exam, rubric);
        if !misfits.is_empty() {
            out.warn(
                IssueKind::Reference,
                rel,
                format!(
                    "De PO past niet bij de rubric {rid}: {} (de rubric heeft dat niet)",
                    misfits.join(", ")
                ),
            );
        }
    }
    if crate::rubrics::is_po_exam(exam) {
        return; // a PO's observaties come from its rubric
    }
    for obs in obs_ids_of(exam) {
        let Some(o) = json.get(format!("observaties/{obs}.json").as_str()) else {
            continue; // "bestaat niet" is reported with the references
        };
        let misfits = crate::locks::obs_misfits_test(o, exam);
        if !misfits.is_empty() {
            out.warn(
                IssueKind::Reference,
                rel,
                format!(
                    "Observatie {obs} past niet bij deze toets: {} (de observatie heeft dat niet)",
                    misfits.join(", ")
                ),
            );
        }
    }
}

/// Scores for a question the test no longer has (a question removed while there were scores).
fn check_removed_questions(
    rel: &str,
    year: &str,
    record: &Value,
    exam_by: &ExamsById<'_>,
    out: &mut Found,
) {
    let Some(Value::Object(scores)) = record.get("scores") else {
        return;
    };
    for (exam_id, qs) in scores {
        let (Some(exam), Some(qs)) = (exam_by.get(&(year, exam_id.as_str())), qs.as_object())
        else {
            continue; // a missing test is reported with the references
        };
        if crate::rubrics::is_po_exam(exam) {
            continue;
        }
        let ids: BTreeSet<String> = exam
            .get("questions")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|q| match q.get("id") {
                Some(Value::String(s)) => Some(s.clone()),
                Some(Value::Number(n)) => Some(n.to_string()),
                _ => None,
            })
            .collect();
        let gone: Vec<&str> = qs
            .keys()
            .filter(|q| !ids.contains(*q))
            .map(String::as_str)
            .collect();
        if !gone.is_empty() {
            let what = if gone.len() == 1 { "vraag" } else { "vragen" };
            out.warn(
                IssueKind::Reference,
                rel,
                format!(
                    "Scores voor {what} {} van toets {exam_id}, die de toets niet meer heeft",
                    gone.join(", ")
                ),
            );
        }
    }
}

/// Every exam by (year, id), for checks across exam and score files.
type ExamsById<'a> = BTreeMap<(&'a str, &'a str), &'a Value>;

fn exams_by_id<'a>(json: &'a BTreeMap<&'a str, Value>) -> ExamsById<'a> {
    json.iter()
        .filter_map(|(rel, v)| {
            let (year, rest) = rel.split_once('/')?;
            rest.strip_prefix("exams/")?;
            Some(((year, v.get("id")?.as_str()?), v))
        })
        .collect()
}

/// An exam's rubric references (step 37, review 22 n5): a `rubric` field is never read (the rubric
/// lives in `rubrics/`), and a PO herkansing uses its original's rubric (decision 22).
fn check_exam_rubric_refs(
    rel: &str,
    year: &str,
    exam: &Value,
    exam_by: &ExamsById<'_>,
    out: &mut Found,
) {
    if exam.get("rubric").is_some() {
        out.warn(
            IssueKind::Shape,
            rel,
            "Bevat een veld rubric, dat nooit gelezen wordt: de rubric staat in rubrics/".into(),
        );
    }
    let Some(parent) = exam.get("parent_id").and_then(Value::as_str) else {
        return;
    };
    let Some(original) = exam_by.get(&(year, parent)) else {
        return;
    };
    let (mine, theirs) = (
        crate::rubrics::exam_rubric_id(exam),
        crate::rubrics::exam_rubric_id(original),
    );
    if crate::rubrics::is_po_exam(exam) && mine != theirs {
        out.warn(
            IssueKind::Shape,
            rel,
            format!(
                "Andere rubric ({}) dan het origineel {parent} ({})",
                mine.unwrap_or("geen"),
                theirs.unwrap_or("geen")
            ),
        );
    }
}

/// A score file's PO parts (step 37): a `po` grading under a test's id (review 23 n4), and PO
/// scores of a student in no projectgroep of that PO (review 22: they never count).
fn check_po_scores(
    rel: &str,
    year: &str,
    record: &Value,
    exam_by: &ExamsById<'_>,
    out: &mut Found,
) {
    let exam = |id: &str| exam_by.get(&(year, id)).copied();
    if let Some(Value::Object(po)) = record.get("po") {
        for id in po.keys() {
            if exam(id).is_some_and(|e| !crate::rubrics::is_po_exam(e)) {
                out.warn(
                    IssueKind::Shape,
                    rel,
                    format!("PO-beoordeling bij toets {id}: die telt niet mee"),
                );
            }
        }
    }
    let (Some(student), Some(Value::Object(scores))) = (
        record.get("student_id").and_then(Value::as_str),
        record.get("scores"),
    ) else {
        return;
    };
    for (id, s) in scores {
        let Some(e) = exam(id).filter(|e| crate::rubrics::is_po_exam(e)) else {
            continue;
        };
        if s.as_object().is_none_or(|m| m.is_empty()) {
            continue;
        }
        let placed = e
            .get("projectgroepen")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|g| g.get("student_ids").and_then(Value::as_array))
            .flatten()
            .any(|m| m.as_str() == Some(student));
        if !placed {
            out.warn(
                IssueKind::Shape,
                rel,
                format!(
                    "Scores voor PO {id}, maar de leerling zit in geen projectgroep: ze tellen \
                     niet mee"
                ),
            );
        }
    }
}

/// A PO exam (step 22, decisions 18 and 22): a rubric, no questions, and `projectgroepen`
/// `[{ id, naam?, student_ids }]` of students of this year, each in at most one projectgroep. A
/// test has no projectgroepen.
fn check_po_exam(rel: &str, exam: &Value, students: &BTreeSet<String>, out: &mut Found) {
    let po = crate::rubrics::is_po_exam(exam);
    let groups = exam.get("projectgroepen");
    if !po {
        if groups.is_some() {
            out.warn(
                IssueKind::Shape,
                rel,
                "Projectgroepen bij een toets: ze tellen niet mee".into(),
            );
        }
        return;
    }
    if crate::rubrics::exam_rubric_id(exam).is_none() {
        out.warn(
            IssueKind::Shape,
            rel,
            "PO zonder rubric: er wordt geen cijfer berekend".into(),
        );
    }
    if exam
        .get("questions")
        .and_then(Value::as_array)
        .is_some_and(|q| !q.is_empty())
    {
        out.warn(
            IssueKind::Shape,
            rel,
            "PO met vragen: die tellen niet mee, het cijfer komt uit de rubric".into(),
        );
    }
    let Some(groups) = groups else {
        return;
    };
    let Some(groups) = groups.as_array() else {
        out.error(IssueKind::Shape, rel, "projectgroepen is geen lijst".into());
        return;
    };
    let mut group_ids = BTreeSet::new();
    let mut placed: BTreeMap<&str, &str> = BTreeMap::new();
    for g in groups {
        let Some(id) = g
            .get("id")
            .and_then(Value::as_str)
            .filter(|i| !i.is_empty())
        else {
            out.error(
                IssueKind::Shape,
                rel,
                format!("Projectgroep zonder id: {g}"),
            );
            continue;
        };
        if !group_ids.insert(id) {
            out.error(
                IssueKind::Shape,
                rel,
                format!("Projectgroep {id} staat er twee keer in"),
            );
        }
        let Some(members) = g.get("student_ids").and_then(Value::as_array) else {
            out.error(
                IssueKind::Shape,
                rel,
                format!("Projectgroep {id}: student_ids is geen lijst"),
            );
            continue;
        };
        for s in members {
            let Some(s) = s.as_str() else {
                out.warn(
                    IssueKind::Shape,
                    rel,
                    format!("Projectgroep {id}: leerlingnummer {s} is geen tekst"),
                );
                continue;
            };
            if !students.contains(s) {
                out.missing(rel, format!("Projectgroep {id}: leerling {s} bestaat niet"));
            }
            if let Some(first) = placed.insert(s, id) {
                out.error(
                    IssueKind::Shape,
                    rel,
                    format!("Leerling {s} zit in twee projectgroepen ({first} en {id})"),
                );
            }
        }
    }
}

/// A value as a message names it (review 18 n4: whole objects made long, unreadable messages):
/// an object by its `id`, anything else as JSON cut off after [`BRIEF_CHARS`] characters.
fn brief(value: &Value) -> String {
    if let Some(id) = value.get("id").and_then(Value::as_str) {
        return format!("(id {id})");
    }
    let text = value.to_string();
    if text.chars().count() <= BRIEF_CHARS {
        text
    } else {
        let cut: String = text.chars().take(BRIEF_CHARS).collect();
        format!("{cut}…")
    }
}

const BRIEF_CHARS: usize = 60;

/// Observatie `toetstypes` (step 21): absent means `toets`; present it lists `toets`, `po` or
/// both, never none.
fn check_toetstypes(rel: &str, obs: &Value, out: &mut Found) {
    let Some(v) = obs.get(crate::rubrics::TOETSTYPES_FIELD) else {
        return;
    };
    let ok = v.as_array().is_some_and(|a| {
        !a.is_empty() && a.iter().all(|t| matches!(t.as_str(), Some("toets" | "po")))
    });
    if !ok {
        out.warn(
            IssueKind::Shape,
            rel,
            format!(
                "Toetstype {} onbekend: verwacht \"toets\", \"po\" of beide",
                brief(v)
            ),
        );
    }
}

/// A rubric (step 21): the level rules, and observaties that exist and are of toetstype PO.
fn check_rubric_file(
    rel: &str,
    value: &Value,
    observaties: &BTreeSet<String>,
    po_observaties: &BTreeSet<String>,
    out: &mut Found,
) {
    use crate::grades::rubric::{Rubric, check_rubric};
    let rubric: Rubric = match serde_json::from_value(value.clone()) {
        Ok(r) => r,
        Err(e) => {
            out.error(IssueKind::Shape, rel, format!("Geen rubric: {e}"));
            return;
        }
    };
    let check = check_rubric(&rubric);
    for e in check.errors {
        out.error(IssueKind::Shape, rel, e);
    }
    for (cat, c) in rubric.categories.iter().zip(check.categories) {
        if !c.errors.is_empty() {
            out.error(
                IssueKind::Shape,
                rel,
                format!("{}: {}", cat.naam, c.errors.join(" · ")),
            );
        }
    }
    let ids = |v: &Value| -> Vec<String> {
        v.get("obs_ids")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default()
    };
    let mut all = ids(value);
    for cat in value
        .get("categories")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        all.extend(ids(cat));
    }
    for obs in all {
        if !observaties.contains(&obs) {
            out.missing(rel, format!("Observatie {obs} bestaat niet"));
        } else if !po_observaties.contains(&obs) {
            out.warn(
                IssueKind::Reference,
                rel,
                format!("Observatie {obs} is geen PO-observatie (toetstype)"),
            );
        }
    }
}

/// Format v3 (step 18): `kind`, `diagnostic`, `obs_from_parent` and the question link of
/// opdrachten (`opdrachtenVraag`, F-14).
fn check_exam_v3(rel: &str, exam: &Value, out: &mut Found) {
    check_grade_inputs(rel, exam, out);
    match exam.get("kind") {
        None => {}
        Some(Value::String(k)) if k == "toets" || k == "po" => {}
        Some(other) => out.error(
            IssueKind::Shape,
            rel,
            format!("Soort toets {other} is niet \"toets\" of \"po\""),
        ),
    }
    let diagnostic = match exam.get("diagnostic") {
        None => false,
        Some(Value::Bool(d)) => *d,
        Some(other) => {
            out.error(
                IssueKind::Shape,
                rel,
                format!("diagnostic is {other}, geen true of false"),
            );
            false
        }
    };
    if diagnostic && exam.get("type").and_then(Value::as_str) == Some("pta") {
        out.error(
            IssueKind::Shape,
            rel,
            "Een diagnostische toets kan geen PTA-toets zijn".into(),
        );
    }
    // Only `weging`: `weging_se` applies with PTA alone, and the app keeps it for unticking D.
    if diagnostic
        && exam
            .get("weging")
            .and_then(Value::as_f64)
            .is_some_and(|w| w != 0.0)
    {
        out.warn(
            IssueKind::Shape,
            rel,
            "Een diagnostische toets telt niet mee, maar heeft een weging".into(),
        );
    }
    if exam.get("obs_from_parent") == Some(&Value::Bool(true)) && exam.get("parent_id").is_none() {
        out.warn(
            IssueKind::Shape,
            rel,
            "Observaties van de oorspronkelijke toets, maar dit is geen inhaal of herkansing"
                .into(),
        );
    }
    let Some(cards) = exam.get("opdrachtenVraag") else {
        return;
    };
    let questions: BTreeSet<&str> = exam
        .get("questions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|q| q.get("id")?.as_str())
        .collect();
    let Some(cards) = cards.as_array() else {
        out.error(
            IssueKind::Shape,
            rel,
            "opdrachtenVraag is geen lijst".into(),
        );
        return;
    };
    for card in cards {
        let vraag = card.get("vraag").and_then(Value::as_str);
        let onder = card.get("onder").and_then(Value::as_f64);
        let ops = card.get("opdrachten").map(Value::is_array);
        if card.get("id").and_then(Value::as_str).is_none() || onder.is_none() || ops == Some(false)
        {
            out.error(
                IssueKind::Shape,
                rel,
                format!("opdrachtenVraag: onvolledige koppeling {}", brief(card)),
            );
        }
        match vraag {
            Some(v) if questions.contains(v) => {}
            Some(v) => out.missing(rel, format!("opdrachtenVraag: vraag {v} bestaat niet")),
            None => out.error(
                IssueKind::Shape,
                rel,
                format!("opdrachtenVraag: koppeling zonder vraag {}", brief(card)),
            ),
        }
    }
}

/// Values the grade rules read past (`docs/phase-2/step-19-grade-rules.md`, decisions 18, 22, 23):
/// a grade is still calculated, so these are warnings. Nothing is repaired.
fn check_grade_inputs(rel: &str, exam: &Value, out: &mut Found) {
    for key in ["weging", "weging_se"] {
        match exam.get(key) {
            None | Some(Value::Null) => {}
            Some(value) => match value
                .as_f64()
                .or_else(|| value.as_str().and_then(|s| s.trim().parse().ok()))
            {
                Some(w) if w < 0.0 => out.warn(
                    IssueKind::Shape,
                    rel,
                    format!("Negatieve {key} {w}: de toets telt niet mee"),
                ),
                Some(_) => {}
                None => out.warn(
                    IssueKind::Shape,
                    rel,
                    format!("{key} {} is geen getal: telt als 1", brief(value)),
                ),
            },
        }
    }
    for q in exam
        .get("questions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let id = q.get("id").and_then(Value::as_str).unwrap_or("?");
        match q.get("rtti").and_then(Value::as_str) {
            Some("R" | "T1" | "T2" | "I") => {}
            other => out.warn(
                IssueKind::Shape,
                rel,
                format!(
                    "Vraag {id}: onbekende RTTI-categorie {}: telt wel mee voor het cijfer, niet voor RTTI",
                    other.unwrap_or("(leeg)")
                ),
            ),
        }
        match q.get("kind") {
            None | Some(Value::Null) => {}
            Some(Value::String(k)) if matches!(k.as_str(), "normal" | "bonus" | "diag") => {}
            Some(other) => out.warn(
                IssueKind::Shape,
                rel,
                format!("Vraag {id}: onbekend soort vraag {other}: telt als gewone vraag"),
            ),
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
    let vraag_cards = exam.get("opdrachtenVraag").and_then(Value::as_array);
    for card in vraag_cards.into_iter().flatten() {
        let ops = card.get("opdrachten").and_then(Value::as_array);
        for op in ops.into_iter().flatten().filter_map(Value::as_str) {
            if !opdrachten.contains(op) {
                out.missing(rel, format!("Opdracht {op} (bij een vraag) bestaat niet"));
            }
        }
    }
    check_exam_v3(rel, exam, out);
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
    for key in ["scores", "observations", "overrides", "po"] {
        if let Some(Value::Object(map)) = record.get(key) {
            orphans.extend(map.keys().filter(|e| !exams.contains(*e)).cloned());
        }
    }
    for e in orphans {
        out.missing(rel, format!("Scores voor toets {e}, die niet bestaat"));
    }
    if let Some(Value::Object(po)) = record.get("po") {
        for (exam_id, grading) in po {
            check_po_grading(rel, exam_id, grading, out);
        }
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

/// A PO's grading in a score file (`po[examId]`, step 23): an object whose `groupLines` and
/// `ownLines` are lists of lines that count (decision 28). A line that does not count is a warning:
/// the grade leaves it out, nothing is rewritten.
fn check_po_grading(rel: &str, exam_id: &str, grading: &Value, out: &mut Found) {
    let Value::Object(grading) = grading else {
        out.warn(
            IssueKind::Shape,
            rel,
            format!("PO-beoordeling van {exam_id} is geen object"),
        );
        return;
    };
    for key in ["groupLines", "ownLines"] {
        let lines = match grading.get(key) {
            None | Some(Value::Null) => continue,
            Some(Value::Array(lines)) => lines,
            Some(_) => {
                out.warn(
                    IssueKind::Shape,
                    rel,
                    format!("PO-beoordeling van {exam_id}: {key} is geen lijst"),
                );
                continue;
            }
        };
        for line in lines {
            let Some(obj) = line.as_object() else {
                out.warn(
                    IssueKind::Shape,
                    rel,
                    format!("PO-beoordeling van {exam_id}: bonus/malus {line} is geen regel"),
                );
                continue;
            };
            // As the grade rules read it: a number or a numeric string.
            let value = obj.get("value").and_then(|v| {
                v.as_f64()
                    .or_else(|| v.as_str().and_then(|s| s.trim().parse().ok()))
            });
            if !value.is_some_and(maatwerk_grades::rubric::line_valid) {
                let label = obj.get("label").and_then(Value::as_str).unwrap_or("");
                out.warn(
                    IssueKind::Shape,
                    rel,
                    format!(
                        "PO-beoordeling van {exam_id}: bonus/malus \"{label}\" telt niet mee \
                         (één decimaal, van −9,0 tot +9,0, niet 0)"
                    ),
                );
            }
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
