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
use maatwerk_core::ai::provider::{AiSettings, ProviderKey, preset, presets};
use maatwerk_core::ai::run::quick_output;
use maatwerk_core::ai::school::school_allows_in;
use maatwerk_core::ai::turn::{self, Turn};
use maatwerk_core::ai::workspace::{
    Attachment, ContextChoice, Layout, OtherOpdracht, Starter, TurnInput,
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

/// Runs in progress (decision 63: one per opdracht) and the cached search path.
#[derive(Default)]
pub struct AiState {
    search: Mutex<Option<SearchPath>>,
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
        let found = detect::detect(&settings, &search);
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

/// Whether the CLI is logged in, for CLIs that can tell without a prompt (Claude Code, Codex);
/// `null` when unknown.
#[tauri::command]
#[specta::specta]
pub async fn ai_login_check(
    app: AppHandle,
    ai: State<'_, Arc<AiState>>,
    gebruiker: String,
    provider: String,
) -> Res<Option<bool>> {
    let layout = layout(&app, &gebruiker)?;
    let key = key(&provider)?;
    let ai = Arc::clone(ai.inner());
    off_thread(move || {
        let settings = AiSettings::load(&layout.settings_file());
        let r = settings.resolve(&key)?;
        let Some(probe) = r.builtin.and_then(|b| preset(b).login_probe) else {
            return Ok(None);
        };
        let search = search_path(&ai, false);
        let Some(program) = search.find(&r.command) else {
            return Ok(None);
        };
        let mut cmd = std::process::Command::new(program);
        cmd.args(probe).env("PATH", search.env_value());
        let out = quick_output(cmd, std::time::Duration::from_secs(15));
        Ok(out.map(|o| {
            let text = String::from_utf8_lossy(&o.stdout).to_lowercase();
            o.status.success()
                && !text.contains("\"loggedin\": false")
                && !text.contains("\"loggedin\":false")
        }))
    })
    .await
}

/// What the UI sends with a message.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendRequest {
    #[serde(default)]
    message: String,
    #[serde(default)]
    starter: Option<Starter>,
    #[serde(default)]
    context: ContextRequest,
    #[serde(default)]
    attachments: Vec<AttachmentRequest>,
    /// Editor text by file name (`opdracht.typ`, ...).
    #[serde(default)]
    buffers: BTreeMap<String, String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContextRequest {
    #[serde(default)]
    guide: bool,
    #[serde(default)]
    metadata: Option<Value>,
    #[serde(default)]
    diagnostics: bool,
    #[serde(default)]
    pdf: bool,
    /// A file name in the syllabus folder.
    #[serde(default)]
    syllabus: Option<String>,
    /// Opdracht ids (at most 3).
    #[serde(default)]
    others: Vec<String>,
    #[serde(default)]
    images: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentRequest {
    name: String,
    /// A file chosen with a picker (the token of `Picked`).
    #[serde(default)]
    token: Option<String>,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    data_base64: Option<String>,
}

/// Sends a message to `provider` about the opdracht and waits for the turn's result
/// (`turn::TurnResult`); events stream through `on_event` (`AiEvent`). One run per opdracht.
#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn ai_send(
    app: AppHandle,
    state: State<'_, Shared>,
    ai: State<'_, Arc<AiState>>,
    gebruiker: String,
    opdracht_id: String,
    provider: String,
    request: Value,
    on_event: Channel<Value>,
) -> Res<Value> {
    // A gast has no AI assistant (step 36); the UI shows none.
    if state
        .get()
        .is_some_and(|c| c.storage().is_ok_and(|s| s.is_guest()))
    {
        return Err(bad("Een gast kan de AI-assistent niet gebruiken."));
    }
    let layout = layout(&app, &gebruiker)?;
    let key = key(&provider)?;
    opdracht_images::check_opdracht_id(&opdracht_id)?;
    let request: SendRequest = from_value(request, "bericht")?;
    let syllabus_dir = syllabus_dir(&app)?;
    let stop = Arc::new(AtomicBool::new(false));
    {
        let mut running = lock(&ai.running);
        if running.contains_key(&opdracht_id) {
            return Err(bad("Er loopt al een AI-opdracht voor deze opdracht."));
        }
        running.insert(opdracht_id.clone(), (key.clone(), stop.clone()));
    }
    let ai_state = Arc::clone(ai.inner());
    let id = opdracht_id.clone();
    let result = blocking(state, move |c| {
        let storage = c.storage()?;
        let data_root = storage.data_dir().root().to_path_buf();
        let opdracht_dir = data_root.join("opdrachten").join(&id);
        if !school_allows_in(storage) {
            return Err(bad("De AI-assistent is uitgeschakeld door je school."));
        }
        let settings = AiSettings::load(&layout.settings_file());
        if !settings.enabled {
            return Err(bad("De AI-assistent staat uit in je AI-instellingen."));
        }
        let provider = settings.resolve(&key)?;
        let ctx = request.context;
        let syllabus = match ctx.syllabus {
            Some(name) => {
                // A plain PDF name in the folder: no separators, no drive (`C:x.pdf` would make
                // `join` leave the folder on Windows; review 32 m1).
                if name.contains(['/', '\\', ':'])
                    || name.starts_with('.')
                    || !name.to_ascii_lowercase().ends_with(".pdf")
                {
                    return Err(bad("Ongeldige syllabus."));
                }
                Some(syllabus_dir.join(name))
            }
            None => None,
        };
        let mut others = Vec::new();
        for other in ctx.others.iter().take(3) {
            opdracht_images::check_opdracht_id(other)?;
            let dir = data_root.join("opdrachten").join(other);
            let text = std::fs::read_to_string(dir.join("opdracht.typ"))
                .map_err(|e| io_err(format!("opdrachten/{other}/opdracht.typ"), e))?;
            let title = std::fs::read(dir.join("opdracht.json"))
                .ok()
                .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
                .and_then(|v| v.get("titel").and_then(Value::as_str).map(str::to_owned))
                .unwrap_or_default();
            others.push(OtherOpdracht {
                id: other.clone(),
                title,
                text,
            });
        }
        let mut attachments = Vec::new();
        for a in request.attachments {
            let mut att = Attachment {
                name: a.name,
                path: None,
                text: a.text,
                bytes: None,
            };
            if let Some(token) = a.token {
                att.path = Some(
                    c.picked()
                        .get(&token)
                        .ok_or_else(|| bad("De gekozen bijlage is niet meer beschikbaar."))?,
                );
            }
            if let Some(b64) = a.data_base64 {
                att.bytes =
                    Some(decode_base64_lenient(&b64).map_err(|_| bad("Ongeldige bijlage."))?);
            }
            attachments.push(att);
        }
        let check_program = std::env::current_exe()
            .map_err(|e| CommandError::internal(format!("no program path: {e}")))?;
        let turn = Turn {
            layout,
            opdracht: id,
            provider,
            search: search_path(&ai_state, false),
            time_limit: settings.time_limit(),
            input: TurnInput {
                opdracht_dir,
                buffers: request.buffers,
                message: request.message,
                starter: request.starter,
                context: ContextChoice {
                    guide: ctx.guide,
                    metadata: ctx.metadata,
                    diagnostics: ctx.diagnostics,
                    pdf: ctx.pdf,
                    syllabus,
                    others,
                    images: ctx.images,
                },
                attachments,
                past: Vec::new(),
                check_program,
            },
        };
        let result = turn::run_turn(turn, &stop, |event| {
            if let Ok(v) = serde_json::to_value(&event)
                && let Err(e) = on_event.send(v)
            {
                tracing::warn!("sending an AI event failed: {e}");
            }
        })?;
        to_value(&result)
    })
    .await;
    lock(&ai.running).remove(&opdracht_id);
    result
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

fn proposal_of(layout: &Layout, opdracht: &str, key: &ProviderKey) -> Res<Proposal> {
    turn::saved_proposal(layout, opdracht, key).ok_or_else(|| bad("Er is geen voorstel (meer)."))
}

/// The last proposal with every hunk's status against the editor's current text
/// (`{ proposal, statuses: { [file]: HunkStatus[] } }`).
#[tauri::command]
#[specta::specta]
pub async fn ai_proposal(
    app: AppHandle,
    gebruiker: String,
    opdracht_id: String,
    provider: String,
    current: BTreeMap<String, String>,
) -> Res<Value> {
    let layout = layout(&app, &gebruiker)?;
    let key = key(&provider)?;
    off_thread(move || {
        let p = proposal_of(&layout, &opdracht_id, &key)?;
        let statuses: BTreeMap<&str, Vec<diff::HunkStatus>> = p
            .files
            .iter()
            .map(|f| {
                let cur = current.get(&f.path).map_or(f.base.as_str(), String::as_str);
                (f.path.as_str(), diff::rebase(&f.hunks, &f.base, cur))
            })
            .collect();
        Ok(json!({ "proposal": to_value(&p)?, "statuses": to_value(&statuses)? }))
    })
    .await
}

/// "Toepassen" (decisions 56, 68): the chosen hunks onto the current text (returned for the
/// editor, which records one undo step) and the chosen images into the opdracht's images; the
/// images they replace are kept for [`ai_undo_images`].
#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn ai_apply(
    app: AppHandle,
    state: State<'_, Shared>,
    gebruiker: String,
    opdracht_id: String,
    provider: String,
    current: BTreeMap<String, String>,
    hunks: BTreeMap<String, Vec<u32>>,
    images: Vec<String>,
) -> Res<Value> {
    let layout = layout(&app, &gebruiker)?;
    let key = key(&provider)?;
    blocking(state, move |c| {
        let p = proposal_of(&layout, &opdracht_id, &key)?;
        let mut files = BTreeMap::new();
        for f in &p.files {
            let Some(chosen) = hunks.get(&f.path) else {
                continue;
            };
            let chosen: Vec<usize> = chosen.iter().map(|&h| h as usize).collect();
            let cur = current.get(&f.path).map_or(f.base.as_str(), String::as_str);
            files.insert(f.path.clone(), to_value(&diff::apply(f, cur, &chosen))?);
        }
        let storage = c.storage()?;
        let undo = layout.run_dir(&opdracht_id, &key)?.join("undo");
        let saved: Vec<Value> = apply::apply_images(storage, &opdracht_id, &p, &images, &undo)?
            .into_iter()
            .map(|a| json!({ "path": a.path, "new": a.new }))
            .collect();
        let history = layout.history_file(&opdracht_id, &key)?;
        let mut conv = Conversation::load(&history, &key);
        conv.set_applied(true);
        conv.save(&history)?;
        Ok(json!({ "files": files, "images": saved }))
    })
    .await
}

/// "Ongedaan maken": removes the images [`ai_apply`] added and puts back the ones it replaced
/// (none: only the history), and marks the proposal as not applied again. (The text goes back
/// through the editor's undo.)
#[tauri::command]
#[specta::specta]
pub async fn ai_undo_images(
    app: AppHandle,
    state: State<'_, Shared>,
    gebruiker: String,
    opdracht_id: String,
    provider: String,
    images: Vec<String>,
) -> Res<()> {
    let layout = layout(&app, &gebruiker)?;
    let key = key(&provider)?;
    blocking(state, move |c| {
        let undo = layout.run_dir(&opdracht_id, &key)?.join("undo");
        apply::undo_images(c.storage()?, &opdracht_id, &images, &undo)?;
        let history = layout.history_file(&opdracht_id, &key)?;
        let mut conv = Conversation::load(&history, &key);
        conv.set_applied(false);
        conv.save(&history)?;
        Ok(())
    })
    .await
}

/// An image of the proposal as a data URL (Voorstel bekijken).
#[tauri::command]
#[specta::specta]
pub async fn ai_proposal_image(
    app: AppHandle,
    gebruiker: String,
    opdracht_id: String,
    provider: String,
    path: String,
) -> Res<String> {
    let layout = layout(&app, &gebruiker)?;
    let key = key(&provider)?;
    off_thread(move || {
        let p = proposal_of(&layout, &opdracht_id, &key)?;
        let img = p
            .images
            .iter()
            .find(|i| i.path == path)
            .ok_or_else(|| bad("Onbekende afbeelding."))?;
        let bytes = std::fs::read(&img.source).map_err(|e| io_err(path.clone(), e))?;
        let mime = match extension_of(&path).as_str() {
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "svg" => "image/svg+xml",
            "webp" => "image/webp",
            _ => "image/png",
        };
        Ok(format!(
            "data:{mime};base64,{}",
            maatwerk_core::storage::encode_base64(&bytes)
        ))
    })
    .await
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
