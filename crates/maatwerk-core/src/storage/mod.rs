// SPDX-License-Identifier: AGPL-3.0-or-later

//! JSON and file storage in the shared data folder (reference `main.js` `fs:*` handlers,
//! `sync.js`). Spec: `docs/specs/storage-spec.md` (rows S01-S27, S37, S38).
//!
//! All methods block; callers on an async runtime use `spawn_blocking`.

pub(crate) mod atomic;
mod commit;
mod entity;

use std::collections::{BTreeMap, HashMap};
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
use crate::integrity::{self, StampState};
use crate::jsonfmt::to_js_json;
use crate::paths::{DataDir, RelPath, is_year_name};

/// Subject folders created per year (`main.js:141`).
pub const SUBJECTS: [&str; 4] = ["nat", "bio", "schk", "wi"];

/// `schema_version` values in `config.json` this build reads and writes (ADR-0003 C1). A folder
/// without the field is version 1 (the reference format) and must be migrated first.
pub const SUPPORTED_SCHEMA_VERSIONS: &[u64] = &[crate::migrate::CURRENT_VERSION];

/// Entries that only exist in a v1 folder; with one of these and no `config.json` the folder is
/// v1 (the reference only wrote `config.json` when the year was switched).
const V1_MARKERS: [&str; 4] = [
    "gebruikers.json",
    "school.json",
    "observaties",
    "opdrachten",
];

/// SHA-1 hex of the bytes (`hashContent`, S07). The CAS token; it is never stored.
pub fn hash_hex(bytes: &[u8]) -> String {
    Sha1::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// `opdrachten/<id>/<name>.typ`: the only text files the UI writes (`fs:writeTextFile`; backlog
/// n8; C14 opdracht folders). Keeps text writes away from the JSON files.
pub fn check_opdracht_typ_path(rel: &RelPath) -> Result<()> {
    let ok = rel
        .as_str()
        .strip_prefix("opdrachten/")
        .and_then(|rest| rest.split_once('/'))
        .is_some_and(|(id, name)| {
            crate::opdracht_images::check_opdracht_id(id).is_ok()
                && id != "images" // the v1 image folder
                && !name.contains('/')
                && rel.extension().as_deref() == Some("typ")
        });
    require(ok, rel, "expected opdrachten/<id>/<name>.typ")
}

/// `fotos/<name>.<image ext>`: where the UI saves photos and logos (`fs:savePhoto`; backlog n8).
/// Image types only, so the shared folder never receives a file that runs when opened (review
/// 6a M1).
pub fn check_photo_path(rel: &RelPath) -> Result<()> {
    let image = rel
        .extension()
        .is_some_and(|ext| crate::opdracht_images::IMAGE_EXTS.contains(&ext.as_str()));
    let ok = image
        && rel
            .as_str()
            .strip_prefix("fotos/")
            .is_some_and(|name| !name.contains('/'));
    require(ok, rel, "expected fotos/<name> with an image extension")
}

fn require(ok: bool, rel: &RelPath, reason: &'static str) -> Result<()> {
    if ok {
        Ok(())
    } else {
        Err(Error::InvalidPath {
            path: rel.to_string(),
            reason,
        })
    }
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
/// back as external changes (S18). All calls happen under the commit lock: an observer must not
/// call back into the [`Storage`].
pub trait WriteObserver: Send + Sync {
    /// Just before the rename or removal; followed by exactly one of the other three calls.
    fn will_change(&self, _rel: &RelPath) {}
    fn note_write(&self, rel: &RelPath, content: &[u8]);
    fn note_delete(&self, rel: &RelPath);
    /// The announced write or delete failed.
    fn change_failed(&self, _rel: &RelPath) {}
}

/// Handle on one data folder. Cheap to share behind an `Arc`; several handles on the same
/// folder in one process share the commit lock.
pub struct Storage {
    dir: DataDir,
    commit: commit::CommitLock,
    observer: Option<Arc<dyn WriteObserver>>,
    /// Per-file queues for [`Storage::update`] (S25).
    update_locks: Mutex<HashMap<RelPath, Arc<Mutex<()>>>>,
    /// JSON files read with a missing or wrong `_meta.hash` (C19), until written again.
    stamps: Mutex<BTreeMap<String, StampState>>,
    /// Compared with `minAppVersion` in `school.json` ([`Storage::read_only`]).
    app_version: String,
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
            stamps: Mutex::new(BTreeMap::new()),
            app_version: crate::app_version::APP_VERSION.to_owned(),
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

    /// The version compared with `minAppVersion` (tests pretend to be an older or newer app).
    pub fn set_app_version(&mut self, version: impl Into<String>) {
        self.app_version = version.into();
    }

    pub fn app_version(&self) -> &str {
        &self.app_version
    }

    /// `Some(minAppVersion)` when `school.json` asks for a newer app than this one (PLAN-2
    /// decision 5): every write is then refused with [`Error::ReadOnly`]. Read on each call, so a
    /// colleague's newer app raising the minimum takes effect without a restart. A missing,
    /// unreadable or corrupt `school.json` sets no limit (it may still be syncing).
    pub fn read_only(&self) -> Option<String> {
        let rel = RelPath::parse("school.json").ok()?;
        let bytes = self.read_bytes(&rel).ok()??;
        let school: Value = serde_json::from_slice(&bytes).ok()?;
        crate::app_version::required_version(&school, &self.app_version)
    }

    fn check_writable(&self) -> Result<()> {
        match self.read_only() {
            Some(min_version) => Err(Error::ReadOnly {
                min_version,
                app_version: self.app_version.clone(),
            }),
            None => Ok(()),
        }
    }

    #[cfg(test)]
    pub(crate) fn set_lock_timeout(&mut self, timeout: std::time::Duration) {
        self.commit.timeout = timeout;
    }

    /// C1: the folder must be v2. A v1 folder (no `schema_version`, or no `config.json` but v1
    /// files) needs the migration; a newer version is refused. An unreadable `config.json` does
    /// not block (it may still be syncing); a folder with nothing of v1 in it is new.
    pub fn check_schema(&self) -> Result<()> {
        let rel = RelPath::parse("config.json")?;
        let config = match self.read_json(&rel) {
            Ok(Some(config)) => config,
            Ok(None) => {
                let root = self.dir.root();
                let v1 = V1_MARKERS.iter().any(|m| root.join(m).exists())
                    || !self.list_years().is_empty();
                // `gebruikers/` is v2: its `config.json` has not synced yet.
                return if v1 && !root.join("gebruikers").is_dir() {
                    Err(Error::NeedsMigration { found: 1 })
                } else {
                    Ok(())
                };
            }
            Err(_) => return Ok(()),
        };
        match config.get("schema_version") {
            None | Some(Value::Null) => Err(Error::NeedsMigration { found: 1 }),
            Some(Value::Number(n)) => match n.as_u64() {
                Some(v) if SUPPORTED_SCHEMA_VERSIONS.contains(&v) => Ok(()),
                Some(v @ 0..=1) => Err(Error::NeedsMigration { found: v.max(1) }),
                _ => Err(Error::UnsupportedSchema {
                    found: n.to_string(),
                }),
            },
            Some(other) => Err(Error::UnsupportedSchema {
                found: other.to_string(),
            }),
        }
    }

    /// C19: remembers a JSON file whose stamp is missing or wrong (logged once), forgets it when
    /// the stamp is good.
    fn note_stamp(&self, rel: &str, value: &Value) {
        let state = integrity::check(value);
        let mut stamps = self.stamps.lock().unwrap_or_else(|p| p.into_inner());
        if state == StampState::Ok {
            stamps.remove(rel);
        } else if stamps.insert(rel.to_owned(), state) != Some(state) {
            tracing::warn!(path = rel, ?state, "changed outside Maatwerk");
        }
    }

    /// JSON files read with a missing or wrong stamp since start (C19), sorted by path.
    pub fn stamp_issues(&self) -> Vec<(String, StampState)> {
        let stamps = self.stamps.lock().unwrap_or_else(|p| p.into_inner());
        stamps.iter().map(|(k, v)| (k.clone(), *v)).collect()
    }

    /// "Accepteren": re-stamps the file as it is now (C19). A missing file is fine.
    pub fn accept_stamp(&self, rel: &RelPath) -> Result<()> {
        let Some(current) = self.read_json_versioned(rel)? else {
            let mut stamps = self.stamps.lock().unwrap_or_else(|p| p.into_inner());
            stamps.remove(rel.as_str());
            return Ok(());
        };
        self.write_json(rel, &current.data, Expect::Hash(&current.hash))?;
        Ok(())
    }

    // ── Reads ────────────────────────────────────────────────────────────────

    /// Raw bytes, `None` if missing (`readWithHash`, S07).
    pub fn read_bytes(&self, rel: &RelPath) -> Result<Option<Vec<u8>>> {
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
        self.note_stamp(rel.as_str(), &data);
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
        Ok(self
            .json_files(dir, false)?
            .into_iter()
            .map(|(_, v)| v)
            .collect())
    }

    /// The files [`Self::read_json`] would give one by one, with their names: one call for a
    /// folder of records (score files, Step 7c). Unlike [`Self::read_all_json`], invalid UTF-8
    /// is decoded with replacement characters, as `read_json` does (review 7c m3).
    pub fn read_all_json_named(&self, dir: &RelPath) -> Result<Vec<(String, Value)>> {
        self.json_files(dir, true)
    }

    fn json_files(&self, dir: &RelPath, lossy: bool) -> Result<Vec<(String, Value)>> {
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
            let text = if lossy {
                String::from_utf8_lossy(&bytes)
            } else {
                match std::str::from_utf8(&bytes) {
                    Ok(t) => t.into(),
                    Err(_) => continue,
                }
            };
            match serde_json::from_str::<Value>(&text) {
                Ok(Value::Null) | Err(_) => {}
                Ok(v) => {
                    self.note_stamp(&format!("{}/{name}", dir.as_str()), &v);
                    out.push((name.to_owned(), v));
                }
            }
        }
        Ok(out)
    }

    /// Names of the entries directly in `dir` that are files (`dirs: false`) or folders
    /// (`dirs: true`), in directory order. Links and non-UTF-8 names are skipped; a missing
    /// folder gives an empty list.
    pub fn list_dir(&self, dir: &RelPath, dirs: bool) -> Result<Vec<String>> {
        let path = self.dir.resolve(dir)?;
        let entries = match fs::read_dir(&path) {
            Ok(entries) => entries,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(vec![]),
            Err(e) => return Err(Error::io(dir.as_str(), e)),
        };
        let mut out = vec![];
        for entry in entries {
            let entry = entry.map_err(|e| Error::io(dir.as_str(), e))?;
            let wanted = entry
                .file_type()
                .is_ok_and(|t| if dirs { t.is_dir() } else { t.is_file() });
            if let (true, Ok(name)) = (wanted, entry.file_name().into_string()) {
                out.push(name);
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

    /// Writes `JSON.stringify(value, null, 2)` plus a newline (C13) atomically if the file
    /// matches `expect`; returns the hash of what was written (S10-S12). An object gets a fresh
    /// `_meta.hash` (C19). The check and the rename run under the commit lock, so no write from
    /// this PC can land in between (S37).
    pub fn write_json(&self, rel: &RelPath, value: &Value, expect: Expect<'_>) -> Result<String> {
        let (value, text) = integrity::stamped_text(value);
        self.commit_bytes(rel, text.as_bytes(), expect, true)?;
        self.note_stamp(rel.as_str(), &value);
        Ok(hash_hex(text.as_bytes()))
    }

    /// Atomic text write if the file matches `expect` (opdracht `.typ` files; C17 passes the
    /// hash the editor loaded). Returns the hash of what was written.
    pub fn write_text(&self, rel: &RelPath, content: &str, expect: Expect<'_>) -> Result<String> {
        self.commit_bytes(rel, content.as_bytes(), expect, true)?;
        Ok(hash_hex(content.as_bytes()))
    }

    /// Writes bytes atomically if the file matches `expect` (opdracht images, printed PDFs).
    pub fn write_bytes(&self, rel: &RelPath, bytes: &[u8], expect: Expect<'_>) -> Result<()> {
        self.commit_bytes(rel, bytes, expect, true)
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
        self.check_writable()?;
        // The temp file is written before the commit lock, so the lock covers only the check
        // and the rename (plus its retries and fallback, which are part of the rename).
        let tmp = atomic::TempFile::write(&path, bytes).map_err(|e| Error::io(rel.as_str(), e))?;
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
        let observer = self.observer.as_ref().filter(|_| note);
        if let Some(observer) = observer {
            observer.will_change(rel);
        }
        let result = tmp.commit(&path, bytes);
        if let Some(observer) = observer {
            match &result {
                Ok(()) => observer.note_write(rel, bytes),
                Err(_) => observer.change_failed(rel),
            }
        }
        result.map_err(|e| Error::io(rel.as_str(), e))
    }

    /// Removes the file; a missing file is fine (S19). Reported to the watcher (S18).
    pub fn delete(&self, rel: &RelPath) -> Result<()> {
        let path = self.dir.resolve(rel)?;
        self.check_writable()?;
        let _guard = self.commit.acquire()?;
        if let Some(observer) = &self.observer {
            observer.will_change(rel);
        }
        let result = match fs::remove_file(&path) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        };
        if let Some(observer) = &self.observer {
            match &result {
                Ok(()) => observer.note_delete(rel),
                Err(_) => observer.change_failed(rel),
            }
        }
        result.map_err(|e| Error::io(rel.as_str(), e))
    }

    /// Removes the folder if it is empty. `Ok(false)` if it is missing; an error if it is not
    /// empty or locked.
    pub fn remove_empty_dir(&self, rel: &RelPath) -> Result<bool> {
        let path = self.dir.resolve(rel)?;
        self.check_writable()?;
        match fs::remove_dir(&path) {
            Ok(()) => Ok(true),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(false),
            Err(e) => Err(Error::io(rel.as_str(), e)),
        }
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

    /// First-run setup (`seedInitialData`, `main.js:965-1003`) in the v2 format: `config.json`
    /// with `schema_version` and the admin account if there are no users yet, plus the `fotos/`
    /// and `opdrachten/` folders. `lib.typ` lives in each opdracht folder (C14).
    pub fn seed_initial_data(&self) -> Result<()> {
        let config = RelPath::parse("config.json")?;
        let version = serde_json::json!({ "schema_version": crate::migrate::CURRENT_VERSION });
        match self.write_json(&config, &version, Expect::Missing) {
            Ok(_) | Err(Error::Conflict { .. }) => {}
            Err(e) => return Err(e),
        }
        let has_users = self
            .list_dir(&RelPath::parse("gebruikers")?, false)?
            .iter()
            .any(|f| f.ends_with(".json"));
        if !has_users {
            self.seed_admin()?;
        }
        self.ensure_dir(&RelPath::parse("fotos")?)?;
        self.ensure_dir(&RelPath::parse("opdrachten")?)?;
        Ok(())
    }

    fn seed_admin(&self) -> Result<()> {
        let users = RelPath::parse("gebruikers/admin.json")?;
        let admin = serde_json::json!({
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
        });
        let Value::Object(admin) = admin else {
            unreachable!()
        };
        let admin = stamp_meta(admin, None, None, std::time::SystemTime::now());
        match self.write_json(&users, &admin, Expect::Missing) {
            Ok(_) | Err(Error::Conflict { .. }) => Ok(()), // already there (maybe another PC)
            Err(e) => Err(e),
        }
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
pub fn decode_base64_lenient(s: &str) -> Result<Vec<u8>> {
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

    /// Atomic (the reference wrote in place). Errors name only the file: the full path holds
    /// the Windows user name and travels to the UI.
    pub fn write(&self, value: &Value) -> Result<()> {
        atomic::write_atomic(&self.path, to_js_json(value).as_bytes())
            .map_err(|e| Error::io("session.json", e))
    }
}

#[cfg(test)]
mod tests;
