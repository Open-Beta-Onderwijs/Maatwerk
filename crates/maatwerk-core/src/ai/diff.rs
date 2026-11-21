// SPDX-License-Identifier: AGPL-3.0-or-later

//! What a run proposes (decisions 50, 56, 68, 69): the changes the CLI left in the workspace,
//! restricted to `opdracht.typ` and `images/`, as hunks the teacher can pick, rebased onto the
//! editor's current buffer (decision 55: the teacher may keep typing while the AI works).
//!
//! A hunk applies cleanly when the base lines it replaces are unchanged in the current buffer
//! (and, for a pure insertion, the lines around it are still neighbours); otherwise it is a
//! conflict and is skipped. Changes to `main.typ` and `lib.typ` are listed as skipped.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use similar::{DiffOp, TextDiff};

use super::workspace::{Baseline, IMAGES_DIR, OPDRACHT_FILES, WRITABLE_FILE, sha256_hex};
use crate::error::{Error, Result};
use crate::opdracht_images::{IMAGE_EXTS, clean_image_name, extension_of, stem_of};

/// One change: `base_lines` (from `base_start`) become `new_lines`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hunk {
    pub id: usize,
    /// 0-based line in the base text.
    pub base_start: usize,
    pub base_lines: Vec<String>,
    pub new_lines: Vec<String>,
}

/// The proposed text of one file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileProposal {
    pub path: String,
    pub base: String,
    pub proposed: String,
    pub hunks: Vec<Hunk>,
}

/// A new or changed image.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageProposal {
    /// `images/<name>.<ext>` (a clean name).
    pub path: String,
    /// True: there was no image with this name.
    pub new: bool,
    /// The file in the workspace.
    pub source: PathBuf,
}

/// Everything a run proposes.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Proposal {
    pub files: Vec<FileProposal>,
    pub images: Vec<ImageProposal>,
    /// Changed files that are not taken over (`main.typ`, `lib.typ`), and removed images.
    pub skipped: Vec<String>,
}

impl Proposal {
    pub fn is_empty(&self) -> bool {
        self.files.is_empty() && self.images.is_empty()
    }
}

/// Lines with their line breaks.
fn lines(text: &str) -> Vec<&str> {
    text.split_inclusive('\n').collect()
}

/// The hunks that turn `base` into `proposed`.
pub fn hunks(base: &str, proposed: &str) -> Vec<Hunk> {
    let diff = TextDiff::from_lines(base, proposed);
    let (old, new) = (lines(base), lines(proposed));
    let mut out: Vec<Hunk> = Vec::new();
    let mut open: Option<(usize, usize, usize, usize)> = None; // old start/end, new start/end
    let close = |open: &mut Option<(usize, usize, usize, usize)>, out: &mut Vec<Hunk>| {
        if let Some((os, oe, ns, ne)) = open.take() {
            out.push(Hunk {
                id: out.len(),
                base_start: os,
                base_lines: old[os..oe].iter().map(|s| (*s).to_owned()).collect(),
                new_lines: new[ns..ne].iter().map(|s| (*s).to_owned()).collect(),
            });
        }
    };
    for op in diff.ops() {
        match *op {
            DiffOp::Equal { .. } => close(&mut open, &mut out),
            _ => {
                let (o, n) = (op.old_range(), op.new_range());
                open = Some(match open {
                    Some((os, _, ns, _)) => (os, o.end, ns, n.end),
                    None => (o.start, o.end, n.start, n.end),
                });
            }
        }
    }
    close(&mut open, &mut out);
    out
}

/// Where a hunk lands in the current text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HunkStatus {
    /// Applies at this 0-based line of the current text.
    Clean { at: usize },
    /// The teacher changed these lines meanwhile.
    Conflict,
}

/// Base line -> current line, for the lines the teacher did not change.
fn line_map(base: &str, current: &str) -> (Vec<Option<usize>>, usize) {
    let diff = TextDiff::from_lines(base, current);
    let mut map = vec![None; lines(base).len()];
    for op in diff.ops() {
        if let DiffOp::Equal {
            old_index,
            new_index,
            len,
        } = *op
        {
            for k in 0..len {
                map[old_index + k] = Some(new_index + k);
            }
        }
    }
    (map, lines(current).len())
}

/// The status of each hunk against `current`.
pub fn rebase(hunks: &[Hunk], base: &str, current: &str) -> Vec<HunkStatus> {
    let (map, current_len) = line_map(base, current);
    hunks
        .iter()
        .map(|h| {
            place(h, &map, current_len).map_or(HunkStatus::Conflict, |at| HunkStatus::Clean { at })
        })
        .collect()
}

/// The current line where `h` goes: its base lines and the lines right before and after them
/// must be unchanged and still neighbours. A file that was empty takes a hunk only while it is
/// still empty.
fn place(h: &Hunk, map: &[Option<usize>], current_len: usize) -> Option<usize> {
    let (s, e) = (h.base_start, h.base_start + h.base_lines.len());
    let mut start = None;
    if s > 0 {
        start = Some((*map.get(s - 1)?)? + 1);
    }
    for (k, i) in (s..e).enumerate() {
        let c = (*map.get(i)?)?;
        match start {
            Some(a) if a + k != c => return None,
            None => start = Some(c - k),
            _ => {}
        }
    }
    if e < map.len() {
        let c = map[e]?;
        match start {
            Some(a) if a + (e - s) != c => return None,
            None => start = Some(c - (e - s)),
            _ => {}
        }
    }
    match start {
        Some(a) => Some(a),
        // No anchor at all: the base was empty.
        None => (current_len == 0).then_some(0),
    }
}

/// The result of applying hunks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Applied {
    pub text: String,
    pub applied: Vec<usize>,
    /// Selected hunks that did not fit.
    pub conflicts: Vec<usize>,
}

/// Applies the `selected` hunks of `file` to `current` (the editor buffer); conflicts are
/// skipped and listed.
pub fn apply(file: &FileProposal, current: &str, selected: &[usize]) -> Applied {
    let statuses = rebase(&file.hunks, &file.base, current);
    let mut cur: Vec<String> = lines(current).iter().map(|s| (*s).to_owned()).collect();
    let mut todo: Vec<(usize, &Hunk)> = Vec::new();
    let mut conflicts = Vec::new();
    for h in file.hunks.iter().filter(|h| selected.contains(&h.id)) {
        match statuses[h.id] {
            HunkStatus::Clean { at } => todo.push((at, h)),
            HunkStatus::Conflict => conflicts.push(h.id),
        }
    }
    // From the bottom up, so earlier positions stay valid.
    todo.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.id.cmp(&a.1.id)));
    let mut applied = Vec::new();
    for (at, h) in todo {
        let end = (at + h.base_lines.len()).min(cur.len());
        // A last line without a line break that gets lines after it needs one.
        if end == cur.len()
            && h.base_lines.is_empty()
            && cur.last().is_some_and(|l| !l.ends_with('\n'))
            && !h.new_lines.is_empty()
            && let Some(last) = cur.last_mut()
        {
            last.push('\n');
        }
        cur.splice(at..end, h.new_lines.iter().cloned());
        applied.push(h.id);
    }
    applied.sort_unstable();
    Applied {
        text: cur.concat(),
        applied,
        conflicts,
    }
}

/// Compares the workspace with its baseline after a run.
pub fn collect(workdir: &Path, baseline: &Baseline) -> Result<Proposal> {
    let mut p = Proposal::default();
    for name in OPDRACHT_FILES {
        let path = workdir.join(name);
        let now = fs::read_to_string(&path).unwrap_or_default();
        let base = baseline.files.get(name).cloned().unwrap_or_default();
        if now == base {
            continue;
        }
        if name == WRITABLE_FILE {
            if now.trim().is_empty() {
                p.skipped.push(format!("{name} (leeg)"));
                continue;
            }
            p.files.push(FileProposal {
                path: name.to_owned(),
                hunks: hunks(&base, &now),
                base,
                proposed: now,
            });
        } else {
            p.skipped.push(name.to_owned());
        }
    }
    let dir = workdir.join(IMAGES_DIR);
    let mut present: BTreeMap<String, ()> = BTreeMap::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        let mut names: Vec<String> = entries
            .flatten()
            .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
            .filter_map(|e| e.file_name().to_str().map(str::to_owned))
            .collect();
        names.sort();
        for name in names {
            let key = format!("{IMAGES_DIR}/{name}");
            present.insert(key.clone(), ());
            let ext = extension_of(&name);
            if !IMAGE_EXTS.contains(&ext.as_str()) {
                continue;
            }
            let source = dir.join(&name);
            let bytes = fs::read(&source).map_err(|e| Error::io(source.to_string_lossy(), e))?;
            let hash = sha256_hex(&bytes);
            match baseline.images.get(&key) {
                Some(h) if *h == hash => {}
                old => {
                    let clean = clean_image_name(stem_of(&name));
                    if clean.is_empty() {
                        continue;
                    }
                    p.images.push(ImageProposal {
                        path: format!("{IMAGES_DIR}/{clean}.{ext}"),
                        new: old.is_none(),
                        source,
                    });
                }
            }
        }
    }
    for key in baseline.images.keys() {
        if !present.contains_key(key) {
            p.skipped.push(format!("{key} (verwijderd)"));
        }
    }
    Ok(p)
}

#[cfg(test)]
mod tests;
