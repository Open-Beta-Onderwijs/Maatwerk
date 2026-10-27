// SPDX-License-Identifier: AGPL-3.0-or-later

//! JSON and file storage in the shared data folder (reference `main.js` `fs:*` handlers,
//! `sync.js`). Spec: `docs/specs/storage-spec.md` (rows S01-S27, S37, S38).
//!
//! All methods block; callers on an async runtime use `spawn_blocking`.

mod atomic;
mod commit;
mod entity;

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use base64::Engine as _;
use serde_json::Value;
use sha1::{Digest, Sha1};

pub use commit::default_lock_dir;
pub use entity::{iso_utc, stamp_meta};

use crate::error::{Error, Result};
use crate::jsonfmt::to_js_json;
use crate::paths::{DataDir, RelPath, is_year_name};

/// Subject folders created per year (`main.js:141`).
pub const SUBJECTS: [&str; 4] = ["nat", "bio", "schk", "wi"];

/// `schema_version` values in `config.json` this build reads and writes (ADR-0003 C1). A folder
/// without the field is version 1 (the reference format).
pub const SUPPORTED_SCHEMA_VERSIONS: &[u64] = &[1];

/// SHA-1 hex of the bytes (`hashContent`, S07). The CAS token; it is never stored.
pub fn hash_hex(bytes: &[u8]) -> String {
    Sha1::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// What a write expects to find on disk.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Expect<'a> {
    /// No check: overwrite whatever is there.
    Any,
    /// The file must not exist yet (S12: `cas` with `expectedHash` null).
    Missing,
    /// The file's current content must hash to this (S11).
    Hash(&'a str),
}

/// A JSON file read together with the hash of its bytes.
#[derive(Debug, Clone, PartialEq)]
pub struct Versioned {
    pub data: Value,
    pub hash: String,
}

/// Told about every write and delete this process makes, so the watcher does not report them
/// back as external changes (S18).
pub trait WriteObserver: Send + Sync {
    fn note_write(&self, rel: &RelPath, content: &[u8]);
    fn note_delete(&self, rel: &RelPath);
}

/// Handle on one data folder. Cheap to share behind an `Arc`; several handles on the same
/// folder in one process share the commit lock.
pub struct Storage {
    dir: DataDir,
    commit: commit::CommitLock,
    observer: Option<Arc<dyn WriteObserver>>,
    /// Per-file queues for [`Storage::update`] (S25).
    update_locks: Mutex<HashMap<RelPath, Arc<Mutex<()>>>>,
}

impl Storage {
    /// Opens (and creates) the data folder, with the commit lock in [`default_lock_dir`].
    /// Refuses a folder whose `schema_version` this build does not support (C1).
    pub fn open(data_dir: impl AsRef<Path>) -> Result<Storage> {
        Storage::open_with_lock_dir(data_dir, &default_lock_dir())
    }

    pub fn open_with_lock_dir(data_dir: impl AsRef<Path>, lock_dir: &Path) -> Result<Storage> {
        let dir = DataDir::open(data_dir)?;
        let commit = commit::CommitLock::new(dir.root(), lock_dir)?;
        let storage = Storage {
            dir,
            commit,
            observer: None,
            update_locks: Mutex::new(HashMap::new()),
        };
        storage.check_schema()?;
        Ok(storage)
    }

    pub fn set_observer(&mut self, observer: Arc<dyn WriteObserver>) {
        self.observer = Some(observer);
    }

    pub fn data_dir(&self) -> &DataDir {
        &self.dir
    }

    #[cfg(test)]
    pub(crate) fn set_lock_timeout(&mut self, timeout: std::time::Duration) {
        self.commit.timeout = timeout;
    }

    /// C1: an explicit `schema_version` must be one this build knows. A missing or unreadable
    /// `config.json` does not block (an unreadable one may still be syncing).
    pub fn check_schema(&self) -> Result<()> {
        let rel = RelPath::parse("config.json")?;
        let Ok(Some(config)) = self.read_json(&rel) else {
            return Ok(());
        };
        match config.get("schema_version") {
            None | Some(Value::Null) => Ok(()),
            Some(Value::Number(n))
                if n.as_u64()
                    .is_some_and(|v| SUPPORTED_SCHEMA_VERSIONS.contains(&v)) =>
            {
                Ok(())
            }
            Some(other) => Err(Error::UnsupportedSchema {
                found: other.to_string(),
            }),
        }
    }

    // ── Reads ────────────────────────────────────────────────────────────────

    /// Raw bytes, `None` if missing (`readWithHash`, S07).
    fn read_bytes(&self, rel: &RelPath) -> Result<Option<Vec<u8>>> {
        let path = self.dir.resolve(rel)?;
        match fs::read(&path) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(Error::io(rel.as_str(), e)),
        }
    }

    /// Parsed JSON; `None` if missing, [`Error::CorruptJson`] if it does not parse (S08 with
    /// the C-change: missing and corrupt are distinguished).
    pub fn read_json(&self, rel: &RelPath) -> Result<Option<Value>> {
        Ok(self.read_json_versioned(rel)?.map(|v| v.data))
    }

    /// Parsed JSON and the hash of its bytes (S09).
    pub fn read_json_versioned(&self, rel: &RelPath) -> Result<Option<Versioned>> {
        let Some(bytes) = self.read_bytes(rel)? else {
            return Ok(None);
        };
        let data = parse_json(rel, &bytes)?;
        Ok(Some(Versioned {
            data,
            hash: hash_hex(&bytes),
        }))
    }

    /// UTF-8 text, `None` if missing (`fs:readTextFile`). Invalid UTF-8 is replaced, as Node's
    /// `'utf8'` decoding does.
    pub fn read_text(&self, rel: &RelPath) -> Result<Option<String>> {
        Ok(self
            .read_bytes(rel)?
            .map(|b| String::from_utf8_lossy(&b).into_owned()))
    }

    /// Every `*.json` directly in `dir` that parses and is not `null`, in directory order
    /// (`fs:readAllJson`). Unparsable files, folders and links are skipped; a missing folder
    /// gives an empty list.
    pub fn read_all_json(&self, dir: &RelPath) -> Result<Vec<Value>> {
        let path = self.dir.resolve(dir)?;
        let entries = match fs::read_dir(&path) {
            Ok(entries) => entries,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(vec![]),
            Err(e) => return Err(Error::io(dir.as_str(), e)),
        };
        let mut out = vec![];
        for entry in entries {
            let entry = entry.map_err(|e| Error::io(dir.as_str(), e))?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            if !name.ends_with(".json") {
                continue;
            }
            match entry.file_type() {
                Ok(t) if t.is_file() => {}
                _ => continue,
            }
            let Ok(bytes) = fs::read(entry.path()) else {
                continue;
            };
            let Ok(text) = std::str::from_utf8(&bytes) else {
                continue;
            };
            match serde_json::from_str::<Value>(text) {
                Ok(Value::Null) | Err(_) => {}
                Ok(v) => out.push(v),
            }
        }
        Ok(out)
    }

    /// Year folders (`YYYY-YYYY`), newest first; empty on any error (`fs:listYears`).
    pub fn list_years(&self) -> Vec<String> {
        let Ok(entries) = fs::read_dir(self.dir.root()) else {
            return vec![];
        };
        let mut years: Vec<String> = entries
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
            .filter_map(|e| e.file_name().into_string().ok())
            .filter(|n| is_year_name(n))
            .collect();
        years.sort_by(|a, b| b.cmp(a));
        years
    }

    /// `data:<mime>;base64,...`, `None` if missing or unreadable (`fs:readPhotoAsDataUrl`).
    pub fn read_photo_data_url(&self, rel: &RelPath) -> Result<Option<String>> {
        let Ok(Some(bytes)) = self.read_bytes(rel) else {
            return Ok(None);
        };
        let mime = match rel.extension().as_deref() {
            Some("png") => "image/png",
            Some("svg") => "image/svg+xml",
            Some("gif") => "image/gif",
            Some("webp") => "image/webp",
            _ => "image/jpeg",
        };
        let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
        Ok(Some(format!("data:{mime};base64,{b64}")))
    }

    // ── Writes ───────────────────────────────────────────────────────────────

    /// Writes `JSON.stringify(value, null, 2)` atomically if the file matches `expect`; returns
    /// the hash of what was written (S10-S12). The check and the rename run under the commit
    /// lock, so no write from this PC can land in between (S37).
    pub fn write_json(&self, rel: &RelPath, value: &Value, expect: Expect<'_>) -> Result<String> {
        let text = to_js_json(value);
        self.commit_bytes(rel, text.as_bytes(), expect, true)?;
        Ok(hash_hex(text.as_bytes()))
    }

    /// Atomic text write without a check (`fs:writeTextFile`; opdracht `.typ` files).
    pub fn write_text(&self, rel: &RelPath, content: &str) -> Result<()> {
        self.commit_bytes(rel, content.as_bytes(), Expect::Any, true)
    }

    /// Decodes base64 and writes the bytes (`fs:savePhoto`). Atomic, unlike the reference; not
    /// reported to the watcher (`fotos/` is not watched).
    pub fn save_photo(&self, rel: &RelPath, base64_data: &str) -> Result<()> {
        let bytes = decode_base64_lenient(base64_data)?;
        self.commit_bytes(rel, &bytes, Expect::Any, false)
    }

    fn commit_bytes(
        &self,
        rel: &RelPath,
        bytes: &[u8],
        expect: Expect<'_>,
        note: bool,
    ) -> Result<()> {
        let path = self.dir.resolve(rel)?;
        let _guard = self.commit.acquire()?;
        if expect != Expect::Any {
            let current = self.read_bytes(rel)?.map(|b| hash_hex(&b));
            let ok = match expect {
                Expect::Missing => current.is_none(),
                Expect::Hash(h) => current.as_deref() == Some(h),
                Expect::Any => true,
            };
            if !ok {
                return Err(Error::Conflict {
                    path: rel.to_string(),
                    updated_by: None,
                });
            }
        }
        atomic::write_atomic(&path, bytes).map_err(|e| Error::io(rel.as_str(), e))?;
        if note && let Some(observer) = &self.observer {
            observer.note_write(rel, bytes);
        }
        Ok(())
    }

    /// Removes the file; a missing file is fine (S19). Reported to the watcher (S18).
    pub fn delete(&self, rel: &RelPath) -> Result<()> {
        let path = self.dir.resolve(rel)?;
        let _guard = self.commit.acquire()?;
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(Error::io(rel.as_str(), e)),
        }
        if let Some(observer) = &self.observer {
            observer.note_delete(rel);
        }
        Ok(())
    }

    /// `mkdir -p` (`fs:ensureDir`).
    pub fn ensure_dir(&self, rel: &RelPath) -> Result<PathBuf> {
        let path = self.dir.resolve(rel)?;
        fs::create_dir_all(&path).map_err(|e| Error::io(rel.as_str(), e))?;
        Ok(path)
    }

    /// Creates `<year>/exams`, `<year>/groups`, `<year>/scores/<subject>` (`fs:ensureYear`).
    /// Unlike the reference, `year` must look like `2025-2026`.
    pub fn ensure_year(&self, year: &str) -> Result<PathBuf> {
        if !is_year_name(year) {
            return Err(Error::InvalidArgument {
                message: format!("not a school year: {year:?}"),
            });
        }
        let year_rel = RelPath::parse(year)?;
        self.ensure_dir(&year_rel.join("exams")?)?;
        self.ensure_dir(&year_rel.join("groups")?)?;
        for subject in SUBJECTS {
            self.ensure_dir(&year_rel.join(&format!("scores/{subject}"))?)?;
        }
        self.dir.resolve(&year_rel)
    }

    /// First-run setup (`seedInitialData`, `main.js:965-1003`): the admin account if
    /// `gebruikers.json` is missing, and the `fotos/` and `opdrachten/images/` folders. `lib.typ`
    /// is not copied any more (ADR-0002 section 5a: it lives in each opdracht folder).
    pub fn seed_initial_data(&self) -> Result<()> {
        let users = RelPath::parse("gebruikers.json")?;
        let admin = serde_json::json!([{
            "id": "admin",
            "voornaam": "Administrator",
            "tussenvoegsel": "",
            "achternaam": "",
            "afkorting": "ADM",
            "vakken": SUBJECTS,
            "kleur": "#c0392b",
            "foto": null,
            "isAdmin": true,
            "actief": true
        }]);
        match self.write_json(&users, &admin, Expect::Missing) {
            Ok(_) | Err(Error::Conflict { .. }) => {} // already there (maybe from another PC)
            Err(e) => return Err(e),
        }
        self.ensure_dir(&RelPath::parse("fotos")?)?;
        self.ensure_dir(&RelPath::parse("opdrachten/images")?)?;
        Ok(())
    }
}

fn parse_json(rel: &RelPath, bytes: &[u8]) -> Result<Value> {
    // Node decodes with replacement characters, then JSON.parse; a BOM is a parse error there
    // as it is here.
    let text = String::from_utf8_lossy(bytes);
    serde_json::from_str(&text).map_err(|e| Error::CorruptJson {
        path: rel.to_string(),
        message: e.to_string(),
    })
}

/// Node's `Buffer.from(s, 'base64')` is lenient: whitespace and missing padding are fine, and
/// the URL-safe alphabet is accepted.
fn decode_base64_lenient(s: &str) -> Result<Vec<u8>> {
    use base64::engine::{DecodePaddingMode, GeneralPurpose, GeneralPurposeConfig};
    let cleaned: String = s
        .chars()
        .filter(|c| !c.is_whitespace())
        .map(|c| match c {
            '-' => '+',
            '_' => '/',
            c => c,
        })
        .collect();
    let cleaned = cleaned.trim_end_matches('=');
    let engine = GeneralPurpose::new(
        &base64::alphabet::STANDARD,
        GeneralPurposeConfig::new().with_decode_padding_mode(DecodePaddingMode::RequireNone),
    );
    engine.decode(cleaned).map_err(|e| Error::InvalidArgument {
        message: format!("invalid base64: {e}"),
    })
}

/// The local session file (`<app config dir>/session.json`, `fs:readLocalSession` /
/// `fs:writeLocalSession`): per PC and teacher, outside the shared folder.
pub struct LocalSession {
    path: PathBuf,
}

impl LocalSession {
    pub fn new(path: impl Into<PathBuf>) -> LocalSession {
        LocalSession { path: path.into() }
    }

    /// `None` if missing or unparsable, as the reference.
    pub fn read(&self) -> Option<Value> {
        let bytes = fs::read(&self.path).ok()?;
        serde_json::from_slice(&bytes).ok()
    }

    /// Atomic (the reference wrote in place).
    pub fn write(&self, value: &Value) -> Result<()> {
        atomic::write_atomic(&self.path, to_js_json(value).as_bytes())
            .map_err(|e| Error::io(self.path.display().to_string(), e))
    }
}

#[cfg(test)]
mod tests;
