// SPDX-License-Identifier: AGPL-3.0-or-later

//! Builds the v2 -> v3 plan (`docs/reference/data-files-v3.md`, step 18). Reads only; like v2,
//! every step accepts v2 and half-migrated input, so a second run continues or does nothing.
//!
//! - `fotos/` -> `afbeeldingen/`, and the paths to it in `school.json` and `gebruikers/` (X-07b);
//! - `users/` (presence, rewritten every 15 s by a running app) is dropped; the app writes
//!   `aanwezigheid/` from now on (X-07c, D20);
//! - every exam gets `kind` and `diagnostic` (decision 14);
//! - an inhaal or herkansing gets the original's observaties, locked (decision 13, F-12);
//! - `school.json` gets `minAppVersion` 0.9.0 (decision 5).

use std::collections::BTreeMap;

use serde_json::{Map, Value};

use super::plan::Planner;
use crate::app_version;
use crate::storage::IMAGES_DIR;

/// The v2 names of the renamed folders.
pub(crate) const V2_IMAGES: &str = "fotos";
pub(crate) const V2_PRESENCE: &str = "users";

/// The first app version that reads format v3 (`school.json` `minAppVersion`).
pub const V3_MIN_APP_VERSION: &str = "0.9.0";

impl Planner<'_> {
    /// The top-level folders named `name` in any ASCII case (a Windows-made folder may say
    /// `Fotos`, quirk T32), as they are spelled on disk.
    fn top_dirs_like(&self, name: &str) -> Vec<String> {
        let mut dirs: Vec<String> = self
            .files
            .iter()
            .filter_map(|f| f.split_once('/').map(|(d, _)| d))
            .filter(|d| d.eq_ignore_ascii_case(name))
            .map(str::to_owned)
            .collect();
        dirs.dedup();
        dirs
    }

    /// `fotos/` -> `afbeeldingen/`, every file below it with its relative path.
    pub(super) fn images_v3(&mut self) {
        for dir in self.top_dirs_like(V2_IMAGES) {
            for rel in self.below(&dir) {
                let rest = &rel[dir.len() + 1..];
                let to = self.path(&format!("{IMAGES_DIR}/{rest}"));
                self.move_file(&rel, to, false);
            }
        }
    }

    /// The presence files are only who is online now; with every app closed they are stale.
    pub(super) fn presence_v3(&mut self) {
        for dir in self.top_dirs_like(V2_PRESENCE) {
            for rel in self.below(&dir) {
                self.delete(&rel);
            }
        }
    }

    /// Plans `rel` when `change` changed it: `_meta.rev` + 1, `updatedBy` null (the migration,
    /// as in v2) and `updatedAt` now, `_meta` kept last. An unchanged file is not written, so a second run does nothing.
    fn update_entity(&mut self, rel: &str, change: impl FnOnce(&mut Map<String, Value>)) {
        let Some(old) = self.read_object(rel) else {
            return;
        };
        let mut map = old.clone();
        let meta = map.shift_remove("_meta");
        change(&mut map);
        let mut old_body = old;
        old_body.shift_remove("_meta");
        if map == old_body {
            return;
        }
        let mut meta = match meta {
            Some(Value::Object(m)) => m,
            _ => Map::new(),
        };
        let rev = meta.get("rev").and_then(Value::as_u64).unwrap_or(0);
        meta.insert("rev".into(), Value::from(rev + 1));
        meta.insert("updatedBy".into(), Value::Null);
        meta.insert("updatedAt".into(), Value::String(self.now_iso.clone()));
        meta.shift_remove("hash");
        map.insert("_meta".into(), Value::Object(meta));
        self.write_json(rel, Value::Object(map));
    }

    /// `school.json`: logo and watermark paths, and the minimum app version.
    pub(super) fn school_v3(&mut self) {
        if !self.exists("school.json") {
            return;
        }
        self.update_entity("school.json", |school| {
            for key in ["logo", "watermerk"] {
                rename_image_ref(school, key);
            }
            let current = school.get("minAppVersion").and_then(Value::as_str);
            let lower = current.is_none_or(|v| {
                app_version::compare(v, V3_MIN_APP_VERSION)
                    .is_none_or(|o| o == std::cmp::Ordering::Less)
            });
            if lower {
                school.insert("minAppVersion".into(), V3_MIN_APP_VERSION.into());
            }
        });
    }

    /// `gebruikers/<id>.json`: the photo path.
    pub(super) fn gebruikers_v3(&mut self) {
        for rel in self.children("gebruikers", ".json") {
            self.update_entity(&rel, |user| rename_image_ref(user, "foto"));
        }
    }

    /// The exams of one year: the new fields, and the observaties of resits.
    pub(super) fn exams_v3(&mut self, year: &str, obs_names: &BTreeMap<String, String>) {
        let dir = format!("{year}/exams");
        let mut exams: BTreeMap<String, Map<String, Value>> = BTreeMap::new();
        for rel in self.children(&dir, ".json") {
            if let Some(map) = self.read_object(&rel) {
                exams.insert(rel, map);
            }
        }
        let by_id: BTreeMap<String, &Map<String, Value>> = exams
            .values()
            .filter_map(|e| Some((e.get("id")?.as_str()?.to_owned(), e)))
            .collect();
        let mut resit_obs: BTreeMap<String, Vec<Value>> = BTreeMap::new();
        for (rel, exam) in &exams {
            let Some(parent_id) = exam.get("parent_id").and_then(Value::as_str) else {
                continue;
            };
            let title = |e: &Map<String, Value>| {
                e.get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("(zonder titel)")
                    .to_owned()
            };
            let Some(parent) = by_id.get(parent_id) else {
                self.warnings.push(format!(
                    "{rel}: de oorspronkelijke toets {parent_id} bestaat niet; observaties niet \
                     overgenomen"
                ));
                continue;
            };
            let ids = |e: &Map<String, Value>| -> Vec<Value> {
                e.get("obs_ids")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default()
            };
            let (before, from_parent) = (ids(exam), ids(parent));
            let mut after = from_parent.clone();
            let own: Vec<&Value> = before.iter().filter(|o| !after.contains(o)).collect();
            if !own.is_empty() {
                self.warnings.push(format!(
                    "{year} {}: had eigen observaties ({}); die blijven erbij",
                    title(exam),
                    names(own.iter().copied(), obs_names)
                ));
            }
            after.extend(own.into_iter().cloned());
            if exam.get("obs_from_parent") != Some(&Value::Bool(true)) || before != after {
                self.notes.push(format!(
                    "{year} {} (van {}): observaties vóór: {}; na: {}",
                    title(exam),
                    title(parent),
                    names(before.iter(), obs_names),
                    names(after.iter(), obs_names),
                ));
            }
            resit_obs.insert(rel.clone(), after);
        }
        for rel in exams.into_keys() {
            let obs = resit_obs.remove(&rel);
            self.update_entity(&rel, |exam| {
                if !exam.contains_key("kind") {
                    exam.insert("kind".into(), "toets".into());
                }
                if !exam.contains_key("diagnostic") {
                    exam.insert("diagnostic".into(), false.into());
                }
                if let Some(obs) = obs {
                    exam.insert("obs_ids".into(), Value::Array(obs));
                    exam.insert("obs_from_parent".into(), true.into());
                }
            });
        }
    }

    /// `observaties/<id>.json` id -> naam, for the notes.
    pub(super) fn observatie_names(&mut self) -> BTreeMap<String, String> {
        let mut out = BTreeMap::new();
        for rel in self.children("observaties", ".json") {
            let Some(obs) = self.read_object(&rel) else {
                continue;
            };
            if let (Some(id), Some(naam)) = (
                obs.get("id").and_then(Value::as_str),
                obs.get("naam").and_then(Value::as_str),
            ) {
                out.insert(id.to_owned(), naam.to_owned());
            }
        }
        out
    }
}

/// `fotos/x.png` (any case of `fotos`) -> `afbeeldingen/x.png` in `map[key]`.
fn rename_image_ref(map: &mut Map<String, Value>, key: &str) {
    let Some(Value::String(path)) = map.get(key) else {
        return;
    };
    let Some((dir, rest)) = path.split_once('/') else {
        return;
    };
    if dir.eq_ignore_ascii_case(V2_IMAGES) {
        let new = format!("{IMAGES_DIR}/{rest}");
        map.insert(key.into(), Value::String(new));
    }
}

/// "Rekenfout, Eenheden" (an unknown id as itself), or "geen".
fn names<'a>(ids: impl Iterator<Item = &'a Value>, obs_names: &BTreeMap<String, String>) -> String {
    let list: Vec<String> = ids
        .map(|v| {
            let id = v.as_str().map_or_else(|| v.to_string(), str::to_owned);
            obs_names.get(&id).cloned().unwrap_or(id)
        })
        .collect();
    if list.is_empty() {
        "geen".into()
    } else {
        list.join(", ")
    }
}

/// The v2 -> v3 plan of the folder `root`.
pub(crate) fn build(
    root: &std::path::Path,
    now: time::OffsetDateTime,
) -> crate::error::Result<super::plan::Plan> {
    let mut p = Planner::new(root, now)?;
    // `minAppVersion` first (runbook section 8): an older app that is still open somewhere
    // becomes read-only before any other file changes.
    p.school_v3();
    p.images_v3();
    p.presence_v3();
    p.gebruikers_v3();
    let obs_names = p.observatie_names();
    for year in p.years() {
        p.exams_v3(&year, &obs_names);
    }
    p.finish(3)
}

/// The renamed v2 folders, removed when the migration left them empty.
pub(crate) fn remove_empty_dirs(root: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.eq_ignore_ascii_case(V2_IMAGES) || name.eq_ignore_ascii_case(V2_PRESENCE) {
            super::plan::remove_empty_tree(&entry.path());
        }
    }
}
