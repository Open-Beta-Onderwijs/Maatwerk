// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tauri commands for the live editor (Step 8b, ADR-0002 section 12): one `LiveEditor` per
//! open opdracht, compile results as `editor:update` events, editor help from `typst-ide`, and
//! the opdracht's own `main.typ`/`lib.typ` (status, restore, bundled text). The core types are
//! mirrored here so the bindings stay generated (ADR-0005).

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use maatwerk_core::typst_svc::{
    self, ClickTarget, Diagnostic, EditorSession, EditorSettings, EditorUpdate, LiveEditor,
    LiveOptions, OpdrachtInputs, PreviewPoint, ProjectFileState, ProjectFileStatus, Severity,
    TypstProject, local_now,
};
use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, State};
use tauri_specta::Event;

use crate::commands::{Res, blocking, rel};
use crate::error::CommandError;
use crate::state::Shared;

/// How long a help query waits for a compile in progress before it gives up.
const QUERY_WAIT: Duration = Duration::from_secs(2);

/// The open editor sessions, by id. The UI has one editor at a time; opening one closes the
/// others, so a reloaded UI cannot leave sessions behind.
#[derive(Default)]
pub struct Editors {
    next: AtomicU64,
    open: Mutex<HashMap<u64, Arc<LiveEditor>>>,
}

impl Editors {
    fn get(&self, session: u64) -> Res<Arc<LiveEditor>> {
        self.open
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&session)
            .cloned()
            .ok_or_else(|| {
                CommandError::from(maatwerk_core::Error::NotFound {
                    path: format!("editor session {session}"),
                })
            })
    }

    /// Removes every session (they stop when the last handle goes).
    pub fn close_all(&self) {
        let open: Vec<_> = self
            .open
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .drain()
            .collect();
        drop(open);
    }
}

/// One compile result for the session `session` (`editor:update`).
#[derive(Debug, Clone, Serialize, Type, Event)]
#[serde(rename_all = "camelCase")]
#[tauri_specta(event_name = "editor:update")]
pub struct EditorUpdateEvent {
    pub session: u64,
    /// The generation this compile saw.
    pub generation: u64,
    pub ok: bool,
    /// Errors first, then warnings.
    pub diagnostics: Vec<EditorDiagnostic>,
    /// The generation of the preview now shown; `null` before the first good compile.
    pub preview_generation: Option<u64>,
    /// Pages in that preview; the client drops pages at and after this index.
    pub page_count: u32,
    /// Only the pages that changed.
    pub pages: Vec<EditorPage>,
    /// On a successful compile only.
    pub vragen: Option<EditorVragen>,
    pub compile_ms: u64,
    pub render_ms: u64,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EditorDiagnostic {
    /// `error` or `warning`.
    pub severity: String,
    pub message: String,
    pub hints: Vec<String>,
    pub location: Option<EditorLocation>,
}

/// A place in a project file: 1-based line and column, and the UTF-16 range CodeMirror uses.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EditorLocation {
    pub file: String,
    pub line: u32,
    pub column: u32,
    pub from: u32,
    pub to: u32,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct EditorPage {
    pub index: u32,
    pub hash: String,
    pub svg: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EditorVragen {
    pub items: Vec<EditorVraag>,
    pub total_punten: f64,
    /// Dutch messages ("De opdracht heeft geen vragen.").
    pub checks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Type)]
pub struct EditorVraag {
    pub opgave: u32,
    pub label: String,
    pub punten: Option<f64>,
    pub antwoord: Option<String>,
    pub page: u32,
    pub y: f64,
}

fn u32_of(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

fn diagnostic(d: Diagnostic) -> EditorDiagnostic {
    EditorDiagnostic {
        severity: match d.severity {
            Severity::Error => "error",
            Severity::Warning => "warning",
        }
        .to_owned(),
        message: d.message,
        hints: d.hints,
        location: d.location.map(|l| EditorLocation {
            file: l.file,
            line: u32_of(l.line),
            column: u32_of(l.column),
            from: u32_of(l.range_utf16.0),
            to: u32_of(l.range_utf16.1),
        }),
    }
}

impl EditorUpdateEvent {
    fn new(session: u64, u: EditorUpdate) -> EditorUpdateEvent {
        EditorUpdateEvent {
            session,
            generation: u.generation,
            ok: u.ok,
            diagnostics: u.diagnostics.into_iter().map(diagnostic).collect(),
            preview_generation: u.preview_generation,
            page_count: u32_of(u.page_count),
            pages: u
                .pages
                .into_iter()
                .map(|p| EditorPage {
                    index: u32_of(p.index),
                    hash: p.hash,
                    svg: p.svg,
                })
                .collect(),
            vragen: u.vragen.map(|v| EditorVragen {
                items: v
                    .items
                    .into_iter()
                    .map(|v| EditorVraag {
                        opgave: u32::try_from(v.opgave).unwrap_or(u32::MAX),
                        label: v.label,
                        punten: v.punten,
                        antwoord: v.antwoord,
                        page: u32_of(v.page),
                        y: v.y,
                    })
                    .collect(),
                total_punten: v.total_punten,
                checks: v.checks,
            }),
            compile_ms: u.compile_ms,
            render_ms: u.render_ms,
        }
    }
}

/// `main.typ` or `lib.typ` of the opdracht (ADR-0002 5a).
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFileInfo {
    pub file: String,
    /// `current`, `updated` (an unchanged older version, just replaced), `modified`,
    /// `outdated` (changed, and a newer bundled version exists) or `missing`.
    pub state: String,
    pub version: Option<u32>,
    pub bundled_version: u32,
    /// For `restore_project_file` (`null` when missing).
    pub hash: Option<String>,
}

fn project_file(s: ProjectFileStatus) -> ProjectFileInfo {
    ProjectFileInfo {
        file: s.file.to_owned(),
        state: match s.state {
            ProjectFileState::Current => "current",
            ProjectFileState::Updated => "updated",
            ProjectFileState::Modified => "modified",
            ProjectFileState::Outdated => "outdated",
            ProjectFileState::Missing => "missing",
        }
        .to_owned(),
        version: s.version,
        bundled_version: s.bundled_version,
        hash: s.hash,
    }
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EditorOpened {
    pub session: u64,
    /// `main.typ` and `lib.typ` after the silent update of unchanged old copies.
    pub files: Vec<ProjectFileInfo>,
    /// The compile time limit in seconds (admin setting).
    pub timeout_seconds: u32,
}

/// Opens a live session on `opdrachten/<opdrachtId>/` with the placeholder header (the editor
/// preview); its first compile (generation 0, the files on disk) starts at once. Closes any
/// other session.
#[tauri::command]
#[specta::specta]
pub async fn editor_open(
    state: State<'_, Shared>,
    editors: State<'_, Editors>,
    app: AppHandle,
    opdracht_id: String,
    title: String,
) -> Res<EditorOpened> {
    editors.close_all();
    let session = editors.next.fetch_add(1, Ordering::SeqCst) + 1;
    let (live, files, timeout) = blocking(state, move |c| {
        let storage = c.storage()?;
        let files = typst_svc::check_project_files(storage, &opdracht_id)?;
        let settings = EditorSettings::read(storage);
        let fonts = c.fonts();
        let data_dir = storage.data_dir().clone();
        let inputs = OpdrachtInputs::preview(title);
        let factory = move || {
            let project = TypstProject::opdracht(&data_dir, &opdracht_id)?;
            let world = typst_svc::opdracht_world(fonts.clone(), project, &inputs, local_now());
            Ok(EditorSession::new(world))
        };
        let options = LiveOptions {
            timeout: settings.compile_timeout,
            ..LiveOptions::default()
        };
        // Emitting only queues the message for the webview: it never blocks the editor thread
        // (review 8a n3).
        let live = LiveEditor::start(factory, options, move |update| {
            if let Err(e) = EditorUpdateEvent::new(session, update).emit(&app) {
                tracing::warn!("emitting editor:update failed: {e}");
            }
        })?;
        Ok((live, files, settings.compile_timeout))
    })
    .await?;
    {
        let mut open = editors.open.lock().unwrap_or_else(PoisonError::into_inner);
        // Another editor_open that finished meanwhile loses: one session at a time (review 8b m7).
        open.clear();
        open.insert(session, Arc::new(live));
    }
    Ok(EditorOpened {
        session,
        files: files.into_iter().map(project_file).collect(),
        timeout_seconds: u32::try_from(timeout.as_secs()).unwrap_or(u32::MAX),
    })
}

/// New buffer text for `path` (e.g. `opdracht.typ`); returns its generation.
#[tauri::command]
#[specta::specta]
pub fn editor_update(
    editors: State<'_, Editors>,
    session: u64,
    path: String,
    text: String,
) -> Res<u64> {
    Ok(editors.get(session)?.update(rel(&path)?, text)?)
}

/// Drops the buffer of `path`: the file on disk counts again.
#[tauri::command]
#[specta::specta]
pub fn editor_unset(editors: State<'_, Editors>, session: u64, path: String) -> Res<u64> {
    Ok(editors.get(session)?.unset(rel(&path)?)?)
}

/// Compiles again with every disk file read again (after an image was saved).
#[tauri::command]
#[specta::specta]
pub fn editor_refresh(editors: State<'_, Editors>, session: u64) -> Res<u64> {
    Ok(editors.get(session)?.refresh())
}

/// Compiles again and sends every page (the preview was lost).
#[tauri::command]
#[specta::specta]
pub fn editor_resend(editors: State<'_, Editors>, session: u64) -> Res<u64> {
    Ok(editors.get(session)?.resend_all())
}

/// Ends the session. Unknown sessions are fine (already closed).
#[tauri::command]
#[specta::specta]
pub fn editor_close(editors: State<'_, Editors>, session: u64) {
    let live = editors
        .open
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .remove(&session);
    drop(live);
}

#[derive(Debug, Serialize, Type)]
pub struct EditorCompletions {
    /// Where the completed text starts (UTF-16); it runs to the cursor.
    pub from: u32,
    pub items: Vec<EditorCompletion>,
}

#[derive(Debug, Serialize, Type)]
pub struct EditorCompletion {
    pub kind: String,
    pub label: String,
    /// Snippet syntax with `${name}` placeholders; the label when `null`.
    pub apply: Option<String>,
    pub detail: Option<String>,
}

#[derive(Debug, Serialize, Type)]
pub struct EditorHover {
    /// `text` or `code` (Typst).
    pub kind: String,
    pub text: String,
}

#[derive(Debug, Serialize, Type)]
pub struct EditorRange {
    pub file: String,
    pub from: u32,
    pub to: u32,
}

#[derive(Debug, Clone, Copy, Serialize, Type)]
pub struct EditorPoint {
    /// 0-based page.
    pub page: u32,
    /// Points from the top left of the page.
    pub x: f64,
    pub y: f64,
}

fn point(p: PreviewPoint) -> EditorPoint {
    EditorPoint {
        page: u32_of(p.page),
        x: p.x,
        y: p.y,
    }
}

/// Where a click in the preview leads: a source position, or another preview point.
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EditorClickJump {
    /// The preview generation the answer belongs to.
    pub generation: u64,
    pub file: Option<String>,
    pub offset: Option<u32>,
    pub point: Option<EditorPoint>,
}

#[derive(Debug, Serialize, Type)]
pub struct EditorCursorJump {
    pub generation: u64,
    pub points: Vec<EditorPoint>,
}

/// Runs a help query on the session off the async runtime; `None` when it timed out.
async fn query<R: Send + 'static>(
    editors: &Editors,
    session: u64,
    f: impl FnOnce(&mut EditorSession) -> R + Send + 'static,
) -> Res<Option<R>> {
    let live = editors.get(session)?;
    tauri::async_runtime::spawn_blocking(move || live.query(QUERY_WAIT, f))
        .await
        .map_err(|e| CommandError::internal(format!("editor query failed: {e}")))
}

/// Autocomplete at `offset` (UTF-16) in `path`, with the editor's current `text`.
#[tauri::command]
#[specta::specta]
pub async fn editor_complete(
    editors: State<'_, Editors>,
    session: u64,
    path: String,
    text: String,
    offset: u32,
    explicit: bool,
) -> Res<Option<EditorCompletions>> {
    let path = rel(&path)?;
    let answer = query(&editors, session, move |s| {
        s.complete(&path, Some(text), offset as usize, explicit)
    })
    .await?;
    Ok(answer.transpose()?.flatten().map(|c| EditorCompletions {
        from: u32_of(c.from),
        items: c
            .items
            .into_iter()
            .map(|i| EditorCompletion {
                kind: i.kind.to_owned(),
                label: i.label,
                apply: i.apply,
                detail: i.detail,
            })
            .collect(),
    }))
}

/// Hover text for the item at `offset` in `path`.
#[tauri::command]
#[specta::specta]
pub async fn editor_hover(
    editors: State<'_, Editors>,
    session: u64,
    path: String,
    text: String,
    offset: u32,
) -> Res<Option<EditorHover>> {
    let path = rel(&path)?;
    let answer = query(&editors, session, move |s| {
        s.hover(&path, Some(text), offset as usize)
    })
    .await?;
    Ok(answer.transpose()?.flatten().map(|h| match h {
        typst_svc::HoverText::Text(text) => EditorHover {
            kind: "text".into(),
            text,
        },
        typst_svc::HoverText::Code(text) => EditorHover {
            kind: "code".into(),
            text,
        },
    }))
}

/// Where the item at `offset` in `path` is defined (project files only).
#[tauri::command]
#[specta::specta]
pub async fn editor_definition(
    editors: State<'_, Editors>,
    session: u64,
    path: String,
    text: String,
    offset: u32,
) -> Res<Option<EditorRange>> {
    let path = rel(&path)?;
    let answer = query(&editors, session, move |s| {
        s.definition(&path, Some(text), offset as usize)
    })
    .await?;
    Ok(answer.transpose()?.flatten().map(|r| EditorRange {
        file: r.file,
        from: u32_of(r.from),
        to: u32_of(r.to),
    }))
}

/// The source behind a click at (`x`, `y`) pt on preview page `page` (0-based).
#[tauri::command]
#[specta::specta]
pub async fn editor_jump_from_click(
    editors: State<'_, Editors>,
    session: u64,
    page: u32,
    x: f64,
    y: f64,
) -> Res<Option<EditorClickJump>> {
    let answer = query(&editors, session, move |s| {
        s.jump_from_click(page as usize, x, y)
    })
    .await?;
    Ok(answer.flatten().map(|j| match j.target {
        ClickTarget::Source { file, offset } => EditorClickJump {
            generation: j.generation,
            file: Some(file),
            offset: Some(u32_of(offset)),
            point: None,
        },
        ClickTarget::Preview { point: p } => EditorClickJump {
            generation: j.generation,
            file: None,
            offset: None,
            point: Some(point(p)),
        },
    }))
}

/// The preview positions of `offset` in `path` (the cursor), for the last compiled text.
#[tauri::command]
#[specta::specta]
pub async fn editor_jump_from_cursor(
    editors: State<'_, Editors>,
    session: u64,
    path: String,
    offset: u32,
) -> Res<Option<EditorCursorJump>> {
    let path = rel(&path)?;
    let answer = query(&editors, session, move |s| {
        s.jump_from_cursor(&path, offset as usize)
    })
    .await?;
    Ok(answer.flatten().map(|j| EditorCursorJump {
        generation: j.generation,
        points: j.target.into_iter().map(point).collect(),
    }))
}

/// `main.typ` and `lib.typ` of the opdracht; unchanged old copies are updated silently.
#[tauri::command]
#[specta::specta]
pub async fn project_files_status(
    state: State<'_, Shared>,
    opdracht_id: String,
) -> Res<Vec<ProjectFileInfo>> {
    blocking(state, move |c| {
        let files = typst_svc::check_project_files(c.storage()?, &opdracht_id)?;
        Ok(files.into_iter().map(project_file).collect())
    })
    .await
}

/// "Herstel standaardversie": the bundled `main.typ`/`lib.typ`, if the file still has
/// `expectedHash` (`null`: it must be missing). Returns the new hash.
#[tauri::command]
#[specta::specta]
pub async fn restore_project_file(
    state: State<'_, Shared>,
    opdracht_id: String,
    file: String,
    expected_hash: Option<String>,
) -> Res<String> {
    blocking(state, move |c| {
        Ok(typst_svc::restore_project_file(
            c.storage()?,
            &opdracht_id,
            &file,
            expected_hash.as_deref(),
        )?)
    })
    .await
}

/// The bundled text of `main.typ` or `lib.typ` ("Bekijk verschillen").
#[tauri::command]
#[specta::specta]
pub fn bundled_project_file(file: String) -> Res<String> {
    typst_svc::bundled_project_file(&file)
        .map(str::to_owned)
        .ok_or_else(|| {
            CommandError::from(maatwerk_core::Error::InvalidArgument {
                message: format!("not a bundled project file: {file}"),
            })
        })
}
