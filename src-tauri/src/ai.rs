// SPDX-License-Identifier: AGPL-3.0-or-later

//! AI assistant commands (step 32a): thin wrappers over `maatwerk_core::ai`. Payloads are JSON
//! with the shapes of the core types (typed in `ui/src/bridge/ai-types.ts`); a turn streams its
//! events through a channel. Everything AI lives in local app data (`ai/<gebruiker>/`), never in
//! the shared data folder; the one exception is applying images, which goes through the normal
//! opdracht image store.

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use maatwerk_core::ai::apply;
use maatwerk_core::ai::detect::{self, SearchPath};
use maatwerk_core::ai::diff::{self, Proposal};
use maatwerk_core::ai::history::Conversation;
use maatwerk_core::ai::provider::{AiSettings, ProviderKey, is_beta, preset, presets};
use maatwerk_core::ai::school::school_allows_in;
use maatwerk_core::ai::turn::{self, Turn};
use maatwerk_core::ai::workspace::{
    self, Attachment, ContextChoice, Layout, OtherOpdracht, Starter, TurnInput,
};
use maatwerk_core::opdracht_images::{self, extension_of};
use maatwerk_core::storage::decode_base64_lenient;
use serde::Deserialize;
use serde_json::{Value, json};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

use crate::commands::{Res, blocking};
use crate::error::CommandError;
use crate::render::open_with_os;
use crate::state::Shared;

mod proposal;
mod send;

pub use proposal::*;
pub use send::*;

/// Runs in progress (decision 63: one per opdracht) and the cached search path.
#[derive(Default)]
pub struct AiState {
    search: Mutex<Option<SearchPath>>,
    /// `--version` per program (review 32 m10), cleared with the search path.
    versions: Mutex<detect::Versions>,
    running: Mutex<HashMap<String, (ProviderKey, Arc<AtomicBool>)>>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

fn bad(message: impl Into<String>) -> CommandError {
    CommandError::from(maatwerk_core::Error::InvalidArgument {
        message: message.into(),
    })
}

fn io_err(what: impl std::fmt::Display, e: std::io::Error) -> CommandError {
    CommandError::internal(format!("{what}: {e}"))
}

fn to_value<T: serde::Serialize>(v: &T) -> Res<Value> {
    serde_json::to_value(v).map_err(|e| CommandError::internal(e.to_string()))
}

fn from_value<T: serde::de::DeserializeOwned>(v: Value, what: &str) -> Res<T> {
    serde_json::from_value(v).map_err(|e| bad(format!("{what}: {e}")))
}

fn layout(app: &AppHandle, gebruiker: &str) -> Res<Layout> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| CommandError::internal(format!("no local app data folder: {e}")))?;
    Ok(Layout::new(&dir.join("ai"), gebruiker)?)
}

fn key(provider: &str) -> Res<ProviderKey> {
    Ok(ProviderKey::parse(provider)?)
}

async fn off_thread<T: Send + 'static>(f: impl FnOnce() -> Res<T> + Send + 'static) -> Res<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| CommandError::internal(format!("AI task failed: {e}")))?
}

/// The search path, found once (it may ask the login shell) or again on "Opnieuw zoeken".
fn search_path(ai: &AiState, refresh: bool) -> SearchPath {
    let mut cached = lock(&ai.search);
    if refresh || cached.is_none() {
        *cached = Some(SearchPath::discover());
    }
    cached.clone().unwrap_or_default()
}

/// The syllabus folder (decision 52, answer 2): `syllabus/` next to the program on Windows, in
/// the app's local data folder on macOS and Linux.
fn syllabus_dir(app: &AppHandle) -> Res<PathBuf> {
    if cfg!(windows) {
        let exe = std::env::current_exe()
            .map_err(|e| CommandError::internal(format!("no program path: {e}")))?;
        Ok(exe
            .parent()
            .map(|p| p.join("syllabus"))
            .unwrap_or_else(|| PathBuf::from("syllabus")))
    } else {
        Ok(app
            .path()
            .app_local_data_dir()
            .map_err(|e| CommandError::internal(e.to_string()))?
            .join("syllabus"))
    }
}

/// Every provider with its detection, defaults and install help, and the teacher's settings
/// (AI-instellingen, the rail, the install help: decisions 49, 71, 72, 77).
#[tauri::command]
#[specta::specta]
pub async fn ai_detect(
    app: AppHandle,
    state: State<'_, Shared>,
    ai: State<'_, Arc<AiState>>,
    gebruiker: String,
    refresh: bool,
) -> Res<Value> {
    let layout = layout(&app, &gebruiker)?;
    let ai = Arc::clone(ai.inner());
    blocking(state, move |c| {
        // The school's switch (decision 73); without a data folder there is none, so on.
        let school = c.storage().map_or(true, school_allows_in);
        let settings = AiSettings::load(&layout.settings_file());
        let search = search_path(&ai, refresh);
        let found = {
            let mut versions = lock(&ai.versions);
            if refresh {
                versions.clear();
            }
            detect::detect_cached(&settings, &search, &mut versions)
        };
        let resolved = settings.resolved();
        let providers: Vec<Value> = found
            .iter()
            .zip(resolved.iter())
            .map(|(d, r)| {
                let defaults = r.builtin.map(|b| {
                    let p = preset(b);
                    json!({ "command": p.command, "args": p.args, "argsNext": p.args_next })
                });
                let install = r.builtin.map(|b| preset(b).install);
                json!({
                    "key": d.key,
                    "name": d.name,
                    "builtin": r.builtin,
                    "command": r.command,
                    "args": r.args,
                    "argsNext": r.args_next,
                    "path": d.path,
                    "version": d.version,
                    "found": d.path.is_some(),
                    "beta": r.builtin.is_some_and(is_beta),
                    "defaults": defaults,
                    "install": install,
                })
            })
            .collect();
        Ok(json!({ "providers": providers, "settings": to_value(&settings)?, "school": school }))
    })
    .await
}

/// Saves the teacher's AI settings (validated); returns them as stored.
#[tauri::command]
#[specta::specta]
pub async fn ai_save_settings(app: AppHandle, gebruiker: String, settings: Value) -> Res<Value> {
    let layout = layout(&app, &gebruiker)?;
    let settings: AiSettings = from_value(settings, "AI-instellingen")?;
    off_thread(move || {
        settings.save(&layout.settings_file())?;
        to_value(&settings)
    })
    .await
}

/// Stops the run of the opdracht, if any (decision 55).
#[tauri::command]
#[specta::specta]
pub fn ai_stop(ai: State<'_, Arc<AiState>>, opdracht_id: String) {
    if let Some((_, stop)) = lock(&ai.running).get(&opdracht_id) {
        stop.store(true, Ordering::SeqCst);
    }
}

/// The providers with a conversation about the opdracht (the rail's dots, decision 62) and the
/// one that runs now.
#[tauri::command]
#[specta::specta]
pub async fn ai_conversations(
    app: AppHandle,
    ai: State<'_, Arc<AiState>>,
    gebruiker: String,
    opdracht_id: String,
) -> Res<Value> {
    let layout = layout(&app, &gebruiker)?;
    let running = lock(&ai.running)
        .get(&opdracht_id)
        .map(|(k, _)| k.to_string());
    off_thread(move || {
        let settings = AiSettings::load(&layout.settings_file());
        let mut open = Vec::new();
        for r in settings.resolved() {
            let c = Conversation::load(&layout.history_file(&opdracht_id, &r.key)?, &r.key);
            if !c.messages.is_empty() {
                open.push(r.key.to_string());
            }
        }
        Ok(json!({ "open": open, "running": running }))
    })
    .await
}

/// The conversation with one provider about the opdracht (`history::Conversation`).
#[tauri::command]
#[specta::specta]
pub async fn ai_conversation(
    app: AppHandle,
    gebruiker: String,
    opdracht_id: String,
    provider: String,
) -> Res<Value> {
    let layout = layout(&app, &gebruiker)?;
    let key = key(&provider)?;
    off_thread(move || {
        let c = Conversation::load(&layout.history_file(&opdracht_id, &key)?, &key);
        to_value(&c)
    })
    .await
}

/// "Nieuw gesprek": forgets the conversation and its workspace.
#[tauri::command]
#[specta::specta]
pub async fn ai_new_conversation(
    app: AppHandle,
    ai: State<'_, Arc<AiState>>,
    gebruiker: String,
    opdracht_id: String,
    provider: String,
) -> Res<()> {
    let layout = layout(&app, &gebruiker)?;
    let key = key(&provider)?;
    if lock(&ai.running)
        .get(&opdracht_id)
        .is_some_and(|(k, _)| *k == key)
    {
        return Err(bad("Stop de AI eerst."));
    }
    off_thread(move || Ok(layout.forget(&opdracht_id, &key)?)).await
}

/// The chips remembered for the opdracht (decision 51); `null` for none yet. The Afbeeldingen
/// chip is never remembered (decision 64).
#[tauri::command]
#[specta::specta]
pub async fn ai_context(
    app: AppHandle,
    gebruiker: String,
    opdracht_id: String,
) -> Res<Option<Value>> {
    let layout = layout(&app, &gebruiker)?;
    off_thread(move || {
        let path = layout.context_file(&opdracht_id)?;
        Ok(std::fs::read(path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok()))
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn ai_save_context(
    app: AppHandle,
    gebruiker: String,
    opdracht_id: String,
    context: Value,
) -> Res<()> {
    let layout = layout(&app, &gebruiker)?;
    let mut context = context;
    if let Some(m) = context.as_object_mut() {
        m.remove("images");
    }
    off_thread(move || {
        let path = layout.context_file(&opdracht_id)?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| io_err("context", e))?;
        }
        let json = serde_json::to_vec_pretty(&context)
            .map_err(|e| CommandError::internal(e.to_string()))?;
        std::fs::write(&path, json).map_err(|e| io_err("context", e))?;
        Ok(())
    })
    .await
}

/// The syllabus PDFs (decision 52): `{ folder, files }`, file names sorted.
#[tauri::command]
#[specta::specta]
pub async fn ai_syllabus_list(app: AppHandle) -> Res<Value> {
    let dir = syllabus_dir(&app)?;
    off_thread(move || {
        let mut files: Vec<String> = std::fs::read_dir(&dir)
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|e| e.file_name().to_str().map(str::to_owned))
            .filter(|n| extension_of(n) == "pdf")
            .collect();
        files.sort_by(|a, b| opdracht_images::nl_compare(a, b));
        Ok(json!({ "folder": dir, "files": files }))
    })
    .await
}

/// "Map openen" for the syllabus folder (made when missing).
#[tauri::command]
#[specta::specta]
pub async fn ai_open_syllabus_folder(app: AppHandle) -> Res<()> {
    let dir = syllabus_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| io_err("syllabus", e))?;
    open_with_os(app, dir).await
}

/// The preset defaults and install help without detection (install help when nothing is
/// found, decision 72).
#[tauri::command]
#[specta::specta]
pub fn ai_presets() -> Value {
    Value::Array(
        presets()
            .iter()
            .map(|p| {
                json!({
                    "builtin": p.builtin,
                    "name": p.name,
                    "command": p.command,
                    "args": p.args,
                    "argsNext": p.args_next,
                    "install": p.install,
                })
            })
            .collect(),
    )
}

/// File types the paperclip offers (spec 4.8.1): the opdracht image types, PDFs and plain text.
pub const ATTACHMENT_EXTS: [&str; 12] = [
    "png", "jpg", "jpeg", "gif", "svg", "webp", "pdf", "txt", "md", "typ", "csv", "json",
];

/// The paperclip (decision 53): picks one or more files; per file a token for `ai_send`, the
/// name and the size in bytes (the UI refuses files over 25 MB before sending).
#[tauri::command]
#[specta::specta]
pub async fn ai_pick_attachments(
    state: State<'_, Shared>,
    app: AppHandle,
    window: tauri::Window,
) -> Res<Value> {
    use tauri_plugin_dialog::DialogExt;
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Bijlage kiezen")
            .add_filter("Afbeeldingen, PDF en tekst", &ATTACHMENT_EXTS)
            .set_parent(&window)
            .blocking_pick_files()
    })
    .await
    .map_err(|e| CommandError::internal(format!("dialog task failed: {e}")))?;
    let paths: Vec<PathBuf> = picked
        .unwrap_or_default()
        .into_iter()
        .filter_map(|p| p.into_path().ok())
        .collect();
    blocking(state, move |c| {
        let files = paths
            .into_iter()
            .map(|path| {
                let name = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or_default()
                    .to_owned();
                let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                let token = c.picked().add(path);
                json!({ "token": token, "name": name, "size": size })
            })
            .collect();
        Ok(Value::Array(files))
    })
    .await
}
