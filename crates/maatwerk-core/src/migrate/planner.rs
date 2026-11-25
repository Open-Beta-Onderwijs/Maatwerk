// SPDX-License-Identifier: AGPL-3.0-or-later

//! The planner the migration steps share: what is on disk, the planned [`super::Op`]s, warnings
//! and reasons to refuse. Reads only; the ops do the writing. (The v1 -> v2 step that it was
//! written for went at 1.0, PLAN-2 decision 88.)

use std::collections::BTreeSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};
use time::OffsetDateTime;

use super::Op;
use crate::error::{Error, Result};
use crate::integrity;
use crate::paths::is_year_name;
use crate::storage::iso_utc;

pub(crate) struct Plan {
    pub ops: Vec<Op>,
    pub warnings: Vec<String>,
    /// What the admin should see before the migration runs (decision 13: the observaties
    /// resits get, before and after).
    pub notes: Vec<String>,
}

pub(super) fn remove_empty_tree(dir: &Path) {
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

pub(super) struct Planner<'a> {
    pub(super) root: &'a Path,
    pub(super) now_iso: String,
    /// Every file in the folder (posix, relative, sorted); links are skipped.
    pub(super) files: Vec<String>,
    pub(super) ops: Vec<Op>,
    /// Targets of planned writes, so a later step does not plan them again.
    planned: BTreeSet<String>,
    pub(super) warnings: Vec<String>,
    pub(super) notes: Vec<String>,
    /// Reasons to refuse (Dutch, for the admin).
    pub(super) blocked: Vec<String>,
}

impl<'a> Planner<'a> {
    pub(super) fn new(root: &'a Path, now: OffsetDateTime) -> Result<Planner<'a>> {
        Ok(Planner {
            root,
            now_iso: iso_utc(now.into()),
            files: walk_all(root).map_err(|e| Error::io(".", e))?,
            ops: Vec::new(),
            planned: BTreeSet::new(),
            warnings: Vec::new(),
            notes: Vec::new(),
            blocked: Vec::new(),
        })
    }

    /// Refuses when a step found a reason to; else plans `config.json` with `version` (last, so
    /// a folder with that version is completely migrated) and hands out the plan.
    pub(super) fn finish(mut self, version: u64) -> Result<Plan> {
        if !self.blocked.is_empty() {
            return Err(Error::MigrationBlocked {
                message: self.blocked.join("\n"),
            });
        }
        self.config(version);
        Ok(Plan {
            ops: self.ops,
            warnings: self.warnings,
            notes: self.notes,
        })
    }

    pub(super) fn path(&self, rel: &str) -> PathBuf {
        self.root.join(rel)
    }

    pub(super) fn exists(&self, rel: &str) -> bool {
        self.files.binary_search_by(|f| f.as_str().cmp(rel)).is_ok()
    }

    /// Files directly in `dir` (posix) whose name ends with `suffix`.
    pub(super) fn children(&self, dir: &str, suffix: &str) -> Vec<String> {
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
    pub(super) fn below(&self, dir: &str) -> Vec<String> {
        let prefix = format!("{dir}/");
        self.files
            .iter()
            .filter(|f| f.starts_with(&prefix))
            .cloned()
            .collect()
    }

    /// Parsed JSON; a corrupt file blocks the migration.
    pub(super) fn read(&mut self, rel: &str) -> Option<Value> {
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
    pub(super) fn read_object(&mut self, rel: &str) -> Option<Map<String, Value>> {
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
    pub(super) fn write_json(&mut self, rel: &str, value: Value) {
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

    pub(super) fn delete(&mut self, rel: &str) {
        self.ops.push(Op::Delete {
            path: self.path(rel),
        });
    }

    /// Moves a file to `to` (absolute). An identical file there only removes the source; a
    /// different one is left alone with a warning, or gets a ` (2)` name when `rename` is set.
    pub(super) fn move_file(&mut self, rel: &str, mut to: PathBuf, rename: bool) {
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

    pub(super) fn years(&self) -> Vec<String> {
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

    /// C1: written last.
    fn config(&mut self, version: u64) {
        let mut map = match self.read("config.json") {
            Some(Value::Object(map)) => map,
            _ => Map::new(),
        };
        map.shift_remove("_meta");
        map.insert("schema_version".into(), Value::from(version));
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
