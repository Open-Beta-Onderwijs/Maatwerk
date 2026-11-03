// SPDX-License-Identifier: AGPL-3.0-or-later

//! Builds the v1 -> v2 plan (`docs/reference/data-files-v2.md`). Reads only; [`super::Op`]s do
//! the writing. Every step accepts v1 and half-migrated input.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};
use time::OffsetDateTime;

use super::Op;
use crate::assets;
use crate::error::{Error, Result};
use crate::integrity;
use crate::jsonfmt::js_number;
use crate::paths::is_year_name;
use crate::storage::iso_utc;

/// The v1 folder of the RTTI explanation and advice files (C11).
pub(crate) const V1_TEMPLATES: &str = "templates/RTTI explanations and advices";
pub(crate) const V2_TEMPLATES: &str = "templates/rtti";

pub(crate) struct Plan {
    pub ops: Vec<Op>,
    pub warnings: Vec<String>,
}

pub(crate) fn build(root: &Path, now: OffsetDateTime) -> Result<Plan> {
    let files = walk_all(root).map_err(|e| Error::io(".", e))?;
    let mut p = Planner {
        root,
        now_iso: iso_utc(now.into()),
        files,
        ops: Vec::new(),
        planned: BTreeSet::new(),
        warnings: Vec::new(),
        blocked: Vec::new(),
    };
    p.legacy();
    p.transient();
    p.gebruikers();
    p.entity_file("school.json");
    p.presence();
    p.each_entity_in("observaties");
    p.opdrachten();
    p.templates();
    for year in p.years() {
        p.year(&year);
    }
    p.rapporten();
    if !p.blocked.is_empty() {
        return Err(Error::MigrationBlocked {
            message: p.blocked.join("\n"),
        });
    }
    p.config(); // last: a folder with schema_version 2 is completely migrated
    Ok(Plan {
        ops: p.ops,
        warnings: p.warnings,
    })
}

/// Empty folders the migration leaves behind, removed bottom-up (best effort).
pub(crate) fn remove_empty_dirs(root: &Path) {
    for rel in ["opdrachten/images", V1_TEMPLATES, "rapporten", "scores"] {
        remove_empty_tree(&root.join(rel));
    }
}

fn remove_empty_tree(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_type().is_ok_and(|t| t.is_dir()) {
            remove_empty_tree(&entry.path());
        }
    }
    let _ = fs::remove_dir(dir); // fails while not empty
}

struct Planner<'a> {
    root: &'a Path,
    now_iso: String,
    /// Every file in the folder (posix, relative, sorted); links are skipped.
    files: Vec<String>,
    ops: Vec<Op>,
    /// Targets of planned writes, so a later step does not plan them again.
    planned: BTreeSet<String>,
    warnings: Vec<String>,
    /// Reasons to refuse (Dutch, for the admin).
    blocked: Vec<String>,
}

impl Planner<'_> {
    fn path(&self, rel: &str) -> PathBuf {
        self.root.join(rel)
    }

    fn exists(&self, rel: &str) -> bool {
        self.files.binary_search_by(|f| f.as_str().cmp(rel)).is_ok()
    }

    /// Files directly in `dir` (posix) whose name ends with `suffix`.
    fn children(&self, dir: &str, suffix: &str) -> Vec<String> {
        let prefix = format!("{dir}/");
        self.files
            .iter()
            .filter(|f| {
                f.strip_prefix(&prefix)
                    .is_some_and(|n| !n.contains('/') && n.ends_with(suffix))
            })
            .cloned()
            .collect()
    }

    /// Files anywhere below `dir`.
    fn below(&self, dir: &str) -> Vec<String> {
        let prefix = format!("{dir}/");
        self.files
            .iter()
            .filter(|f| f.starts_with(&prefix))
            .cloned()
            .collect()
    }

    /// Parsed JSON; a corrupt file blocks the migration.
    fn read(&mut self, rel: &str) -> Option<Value> {
        let bytes = match fs::read(self.path(rel)) {
            Ok(b) => b,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return None,
            Err(e) => {
                self.blocked
                    .push(format!("{rel}: kan niet gelezen worden ({e})"));
                return None;
            }
        };
        match serde_json::from_slice(&bytes) {
            Ok(v) => Some(v),
            Err(_) => {
                self.blocked.push(format!(
                    "{rel}: is geen geldige JSON; herstel of verwijder het bestand"
                ));
                None
            }
        }
    }

    /// Like [`Self::read`], but anything other than an object blocks too.
    fn read_object(&mut self, rel: &str) -> Option<Map<String, Value>> {
        match self.read(rel)? {
            Value::Object(map) => Some(map),
            _ => {
                self.blocked.push(format!("{rel}: is geen JSON-object"));
                None
            }
        }
    }

    /// Plans writing `value` stamped (C19), formatted with a trailing newline (C13); skipped when
    /// the file already holds exactly that.
    fn write_json(&mut self, rel: &str, value: Value) {
        let (_, text) = integrity::stamped_text(&value);
        self.write_bytes(rel, text.into_bytes());
    }

    fn write_bytes(&mut self, rel: &str, bytes: Vec<u8>) {
        self.planned.insert(rel.to_owned());
        if fs::read(self.path(rel)).is_ok_and(|cur| cur == bytes) {
            return;
        }
        self.ops.push(Op::Write {
            path: self.path(rel),
            bytes,
        });
    }

    fn delete(&mut self, rel: &str) {
        self.ops.push(Op::Delete {
            path: self.path(rel),
        });
    }

    /// Moves a file to `to` (absolute). An identical file there only removes the source; a
    /// different one is left alone with a warning, or gets a ` (2)` name when `rename` is set.
    fn move_file(&mut self, rel: &str, mut to: PathBuf, rename: bool) {
        let from = self.path(rel);
        if to.exists() {
            if fs::read(&from).ok() == fs::read(&to).ok() {
                self.ops.push(Op::Delete { path: from });
                return;
            }
            if !rename {
                self.warnings.push(format!(
                    "{rel}: niet verplaatst, op de nieuwe plek staat al een ander bestand"
                ));
                return;
            }
            to = free_name(&to);
        }
        self.ops.push(Op::Move { from, to });
    }

    /// `_meta` for an entity file that has none (C5): rev 1, creator unknown.
    fn entity(&self, mut map: Map<String, Value>) -> Value {
        if !map.get("_meta").is_some_and(Value::is_object) {
            let mut meta = Map::new();
            meta.insert("rev".into(), Value::from(1));
            meta.insert("createdBy".into(), Value::Null);
            meta.insert("createdAt".into(), Value::Null);
            meta.insert("updatedBy".into(), Value::Null);
            meta.insert("updatedAt".into(), Value::String(self.now_iso.clone()));
            map.insert("_meta".into(), Value::Object(meta));
        }
        Value::Object(map)
    }

    fn entity_file(&mut self, rel: &str) {
        if self.planned.contains(rel) || !self.exists(rel) {
            return;
        }
        if let Some(map) = self.read_object(rel) {
            let v = self.entity(map);
            self.write_json(rel, v);
        }
    }

    fn each_entity_in(&mut self, dir: &str) {
        for rel in self.children(dir, ".json") {
            self.entity_file(&rel);
        }
    }

    // ── Steps ────────────────────────────────────────────────────────────────

    /// C2: legacy files from before the per-year and per-file layout. Already-migrated leftovers
    /// (`null` stubs, `*.bak`) go; anything that still holds unmigrated data blocks.
    fn legacy(&mut self) {
        let root_students = self.read("students.json");
        let phase1_done = root_students.is_none() || root_students == Some(Value::Null);
        if !phase1_done {
            self.blocked.push(
                "students.json: bevat nog leerlingen van vóór de jaarmappen (niet gemigreerd door \
                 de oude app)"
                    .into(),
            );
        }
        if self.exists("students.json") {
            self.delete("students.json");
        }
        for rel in ["groups.json", "exams.json"] {
            if self.exists(rel) {
                // Phase 1 copied them into the year folders and left the originals.
                self.delete(rel);
            }
        }
        if self.exists("observaties.json") {
            if self.read("observaties.json").is_some_and(|v| v.is_array()) {
                self.blocked
                    .push("observaties.json: nog niet omgezet naar observaties/".into());
            }
            self.delete("observaties.json");
        }
        let old_scores = self.below("scores");
        if !old_scores.is_empty() {
            self.warnings.push(format!(
                "scores/ (oude map, {} bestanden) verwijderd; staat in de back-up",
                old_scores.len()
            ));
        }
        for rel in old_scores {
            self.delete(&rel);
        }
        for year in self.years() {
            for name in ["students.json", "groups.json", "exams.json"] {
                let rel = format!("{year}/{name}");
                if !self.exists(&rel) {
                    continue;
                }
                if self.read(&rel).is_some_and(|v| v.is_array()) {
                    self.blocked
                        .push(format!("{rel}: nog niet omgezet naar losse bestanden"));
                }
                self.delete(&rel);
            }
            for rel in self.children(&format!("{year}/scores"), ".json") {
                self.blocked
                    .push(format!("{rel}: score-bestand van vóór de vakmappen"));
            }
        }
        let baks: Vec<String> = self
            .files
            .iter()
            .filter(|f| f.ends_with(".bak"))
            .cloned()
            .collect();
        for rel in baks {
            self.delete(&rel);
        }
    }

    /// C3, C12: lock files, temp files and editor preview copies.
    fn transient(&mut self) {
        let doomed: Vec<String> = self
            .files
            .iter()
            .filter(|f| {
                let name = f.rsplit('/').next().unwrap_or(f);
                name.ends_with(".lock")
                    || is_temp_name(name)
                    || (f.starts_with("opdrachten/") && name.starts_with("_preview_"))
            })
            .cloned()
            .collect();
        for rel in doomed {
            self.delete(&rel);
        }
    }

    /// C16: `gebruikers.json` -> `gebruikers/<id>.json`.
    fn gebruikers(&mut self) {
        if self.exists("gebruikers.json") {
            match self.read("gebruikers.json") {
                Some(Value::Array(users)) => {
                    let mut by_id: BTreeMap<String, Map<String, Value>> = BTreeMap::new();
                    for user in users {
                        let Value::Object(user) = user else { continue };
                        let Some(id) = user.get("id").and_then(Value::as_str) else {
                            self.warnings
                                .push("gebruikers.json: gebruiker zonder id overgeslagen".into());
                            continue;
                        };
                        if !is_file_id(id) {
                            self.blocked
                                .push(format!("gebruikers.json: ongeldige gebruikers-id {id:?}"));
                            continue;
                        }
                        if by_id.insert(id.to_owned(), user.clone()).is_some() {
                            self.warnings.push(format!(
                                "gebruikers.json: gebruiker {id} stond er dubbel in; de laatste is bewaard"
                            ));
                        }
                    }
                    for (id, user) in by_id {
                        let v = self.entity(user);
                        self.write_json(&format!("gebruikers/{id}.json"), v);
                    }
                    self.delete("gebruikers.json");
                }
                Some(_) => self
                    .blocked
                    .push("gebruikers.json: is geen lijst van gebruikers".into()),
                None => {}
            }
        }
        self.each_entity_in("gebruikers");
    }

    fn presence(&mut self) {
        for rel in self.children("users", ".json") {
            if let Some(map) = self.read_object(&rel) {
                self.write_json(&rel, Value::Object(map));
            }
        }
    }

    /// C14: `opdrachten/<id>.json` + `<typFile>` + `images/<id>/` -> `opdrachten/<id>/`.
    fn opdrachten(&mut self) {
        let mut old_files = BTreeSet::new();
        for rel in self.children("opdrachten", ".json") {
            let Some(mut map) = self.read_object(&rel) else {
                continue;
            };
            let Some(id) = map.get("id").and_then(Value::as_str).map(str::to_owned) else {
                self.warnings
                    .push(format!("{rel}: opdracht zonder id; blijft staan"));
                continue;
            };
            if !is_file_id(&id) {
                self.warnings
                    .push(format!("{rel}: ongeldige opdracht-id {id:?}; blijft staan"));
                continue;
            }
            let typ_file = match map.shift_remove("typFile") {
                Some(Value::String(f)) if is_plain_typ_name(&f) => f,
                _ => format!("{id}.typ"),
            };
            let dir = format!("opdrachten/{id}");
            let typ_rel = format!("opdrachten/{typ_file}");
            let source = match fs::read(self.path(&typ_rel)) {
                Ok(bytes) => {
                    old_files.insert(typ_rel);
                    match String::from_utf8(bytes) {
                        Ok(text) => text
                            .replace(&format!("images/{id}/"), "images/")
                            .into_bytes(),
                        Err(e) => {
                            self.warnings.push(format!(
                                "opdrachten/{typ_file}: geen UTF-8; ongewijzigd gekopieerd"
                            ));
                            e.into_bytes()
                        }
                    }
                }
                Err(_) => {
                    self.warnings.push(format!(
                        "{rel}: tekstbestand {typ_file} ontbrak; nieuw gemaakt vanuit het standaardsjabloon"
                    ));
                    assets::BASE_ASSIGNMENT_TYP.as_bytes().to_vec()
                }
            };
            let v = self.entity(map);
            self.write_json(&format!("{dir}/opdracht.json"), v);
            self.write_bytes(&format!("{dir}/opdracht.typ"), source);
            for (name, text) in [
                ("main.typ", assets::OPDRACHT_MAIN_TYP),
                ("lib.typ", assets::LIB_TYP),
            ] {
                let rel = format!("{dir}/{name}");
                if !self.exists(&rel) {
                    self.write_bytes(&rel, text.as_bytes().to_vec());
                }
            }
            let images = format!("opdrachten/images/{id}");
            for img in self.below(&images) {
                let tail = &img[images.len() + 1..];
                let to = self.path(&format!("{dir}/images/{tail}"));
                self.move_file(&img, to, false);
            }
            old_files.insert(rel);
        }
        if self.exists("opdrachten/lib.typ") {
            old_files.insert("opdrachten/lib.typ".into());
        }
        for rel in old_files {
            self.delete(&rel);
        }
        // Folders from an earlier, interrupted run.
        let done: Vec<String> = self
            .files
            .iter()
            .filter_map(|f| f.strip_prefix("opdrachten/"))
            .filter_map(|f| f.strip_suffix("/opdracht.json"))
            .filter(|id| !id.contains('/'))
            .map(|id| format!("opdrachten/{id}/opdracht.json"))
            .collect();
        for rel in done {
            self.entity_file(&rel);
        }
    }

    /// C11: `templates/RTTI explanations and advices/rtti_expl_adv_<key>_<jaar>.json` ->
    /// `templates/rtti/<key>_<jaar>.json`; `wi_<4..6>` fills the missing `wisa`..`wisd`.
    fn templates(&mut self) {
        let mut wi_upper = Vec::new();
        for rel in self.children(V1_TEMPLATES, ".json") {
            let name = &rel[V1_TEMPLATES.len() + 1..];
            let Some((key, jaar)) = v1_template_key(name) else {
                self.warnings
                    .push(format!("{rel}: onbekende bestandsnaam; blijft staan"));
                continue;
            };
            let Some(map) = self.read_object(&rel) else {
                continue;
            };
            if key == "wi" && jaar >= 4 {
                wi_upper.push((jaar, map, rel));
                continue;
            }
            let v = self.entity(map);
            self.write_json(&format!("{V2_TEMPLATES}/{key}_{jaar}.json"), v);
            self.delete(&rel);
        }
        for (jaar, map, rel) in wi_upper {
            for sub in ["wisa", "wisb", "wisc", "wisd"] {
                let target = format!("{V2_TEMPLATES}/{sub}_{jaar}.json");
                let v1 = format!("{V1_TEMPLATES}/rtti_expl_adv_{sub}_{jaar}.json");
                if !self.planned.contains(&target) && !self.exists(&target) && !self.exists(&v1) {
                    let mut copy = map.clone();
                    copy.shift_remove("_meta");
                    let v = self.entity(copy);
                    self.write_json(&target, v);
                }
            }
            self.delete(&rel);
        }
        self.each_entity_in(V2_TEMPLATES);
    }

    fn years(&self) -> Vec<String> {
        let mut years: BTreeSet<String> = BTreeSet::new();
        for f in &self.files {
            if let Some((first, _)) = f.split_once('/')
                && is_year_name(first)
            {
                years.insert(first.to_owned());
            }
        }
        years.into_iter().collect()
    }

    fn year(&mut self, year: &str) {
        let rel = format!("{year}/students-{year}.json");
        if self.exists(&rel) {
            self.students(&rel);
        }
        self.each_entity_in(&format!("{year}/exams"));
        for rel in self.children(&format!("{year}/groups"), ".json") {
            let Some(mut map) = self.read_object(&rel) else {
                continue;
            };
            if let Some(Value::Array(ids)) = map.get("student_ids") {
                let mut seen = BTreeSet::new();
                let ids: Vec<Value> = ids
                    .iter()
                    .map(id_string)
                    .filter(|id| seen.insert(id.to_string()))
                    .collect();
                map.insert("student_ids".into(), Value::Array(ids));
            }
            let v = self.entity(map);
            self.write_json(&rel, v);
        }
        let scores = format!("{year}/scores/");
        let score_files: Vec<String> = self
            .files
            .iter()
            .filter(|f| {
                f.strip_prefix(&scores)
                    .is_some_and(|t| t.split('/').count() == 2 && t.ends_with(".json"))
            })
            .cloned()
            .collect();
        for rel in score_files {
            let Some(mut map) = self.read_object(&rel) else {
                continue;
            };
            if let Some(id) = map.get_mut("student_id") {
                *id = id_string(id);
            }
            if let Some(Value::Object(exams)) = map.get_mut("scores") {
                for qs in exams.values_mut() {
                    if let Value::Object(qs) = qs {
                        for v in qs.values_mut() {
                            if v.is_null() {
                                *v = Value::String("N".into()); // C9
                            }
                        }
                    }
                }
            }
            self.write_json(&rel, Value::Object(map));
        }
    }

    /// C8 + wrapper: `Student[]` -> `{ students, _meta }` with string ids; duplicates that only
    /// differed in the id's type are merged, later fields winning (`mergeStudent`).
    fn students(&mut self, rel: &str) {
        let (list, meta) = match self.read(rel) {
            Some(Value::Array(list)) => (list, None),
            Some(Value::Object(mut map)) => match map.shift_remove("students") {
                Some(Value::Array(list)) => (list, map.shift_remove("_meta")),
                _ => {
                    self.blocked
                        .push(format!("{rel}: geen lijst met leerlingen"));
                    return;
                }
            },
            Some(_) => {
                self.blocked
                    .push(format!("{rel}: geen lijst met leerlingen"));
                return;
            }
            None => return,
        };
        let mut out: Vec<Value> = Vec::with_capacity(list.len());
        let mut index: BTreeMap<String, usize> = BTreeMap::new();
        for student in list {
            let Value::Object(mut s) = student else {
                out.push(student);
                continue;
            };
            let Some(id) = s.get("id").map(id_string) else {
                out.push(Value::Object(s));
                continue;
            };
            s.insert("id".into(), id.clone());
            let key = id.as_str().unwrap_or_default().to_owned();
            match index.get(&key) {
                Some(&i) => {
                    self.warnings.push(format!(
                        "{rel}: leerling {key} stond er dubbel in; samengevoegd"
                    ));
                    if let Value::Object(first) = &mut out[i] {
                        first.extend(s);
                    }
                }
                None => {
                    index.insert(key, out.len());
                    out.push(Value::Object(s));
                }
            }
        }
        let mut map = Map::new();
        map.insert("students".into(), Value::Array(out));
        if let Some(meta @ Value::Object(_)) = meta {
            map.insert("_meta".into(), meta);
        }
        self.write_json(rel, Value::Object(map));
    }

    /// C18: `data/rapporten/**` -> `<parent>/rapporten/**`.
    fn rapporten(&mut self) {
        let files = self.below("rapporten");
        if files.is_empty() {
            return;
        }
        let Some(parent) = self.root.parent().map(Path::to_path_buf) else {
            self.blocked.push(
                "rapporten/: de gegevensmap heeft geen bovenliggende map om de rapporten naast te zetten"
                    .into(),
            );
            return;
        };
        for rel in files {
            let to = parent.join(&rel);
            self.move_file(&rel, to, true);
        }
    }

    /// C1: written last.
    fn config(&mut self) {
        let mut map = match self.read("config.json") {
            Some(Value::Object(map)) => map,
            _ => Map::new(),
        };
        map.shift_remove("_meta");
        map.insert("schema_version".into(), Value::from(super::CURRENT_VERSION));
        self.write_json("config.json", Value::Object(map));
    }
}

/// Every file below `root` as a sorted posix relative path; links are not followed.
pub(crate) fn walk_all(root: &Path) -> io::Result<Vec<String>> {
    fn rec(dir: &Path, prefix: &str, out: &mut Vec<String>) -> io::Result<()> {
        let entries = match fs::read_dir(dir) {
            Ok(e) => e,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(e),
        };
        for entry in entries {
            let entry = entry?;
            let Ok(name) = entry.file_name().into_string() else {
                continue;
            };
            let rel = if prefix.is_empty() {
                name
            } else {
                format!("{prefix}/{name}")
            };
            let t = entry.file_type()?;
            if t.is_dir() {
                rec(&entry.path(), &rel, out)?;
            } else if t.is_file() {
                out.push(rel);
            }
        }
        Ok(())
    }
    let mut out = Vec::new();
    rec(root, "", &mut out)?;
    out.sort();
    Ok(out)
}

/// `x.json.1234.tmp` (reference) or `x.json.1234-5.tmp` (this app's atomic writes).
pub(crate) fn is_temp_name(name: &str) -> bool {
    let Some(stem) = name.strip_suffix(".tmp") else {
        return false;
    };
    let Some((_, tag)) = stem.rsplit_once('.') else {
        return false;
    };
    !tag.is_empty() && tag.chars().all(|c| c.is_ascii_digit() || c == '-')
}

/// Ids used as file or folder names: `^[A-Za-z0-9_-]+$`.
pub(crate) fn is_file_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn is_plain_typ_name(name: &str) -> bool {
    name.ends_with(".typ")
        && !name.contains(['/', '\\'])
        && name != "lib.typ"
        && !name.starts_with('.')
}

/// `rtti_expl_adv_<key>_<jaar>.json` -> (`key`, `jaar`).
pub(crate) fn v1_template_key(name: &str) -> Option<(&str, u32)> {
    let stem = name.strip_prefix("rtti_expl_adv_")?.strip_suffix(".json")?;
    let (key, jaar) = stem.rsplit_once('_')?;
    let jaar: u32 = jaar.parse().ok()?;
    is_file_id(key).then_some((key, jaar))
}

/// C8: a student id as a string; numbers keep their JS text (`12345` -> `"12345"`).
pub(crate) fn id_string(v: &Value) -> Value {
    match v {
        Value::Number(n) => Value::String(js_number(n)),
        other => other.clone(),
    }
}

/// `name (2).ext`, `name (3).ext`, ... : the first that does not exist.
fn free_name(path: &Path) -> PathBuf {
    let stem = path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let ext = path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    (2..)
        .map(|n| path.with_file_name(format!("{stem} ({n}){ext}")))
        .find(|p| !p.exists())
        .expect("some free name")
}
