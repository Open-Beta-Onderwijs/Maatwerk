// SPDX-License-Identifier: AGPL-3.0-or-later

//! The live compile service of the editor (Step 8a, ADR-0002 5a).
//!
//! [`EditorSession`] keeps one [`MaatwerkWorld`] alive for the whole editing session, so Typst
//! reparses the buffer incrementally and its memoisation (comemo) reuses the unchanged parts;
//! the cache is trimmed after every compile ([`compile_document`]). The buffer lives in memory
//! only: it is never written to the data folder. A compile returns structured diagnostics and
//! **only the pages that changed** (SVG plus hash); while the source has errors, the last good
//! preview stays as it is.
//!
//! [`LiveEditor`] runs a session on its own thread: updates are debounced, and the latest
//! request wins (generation counter): a compile that is overtaken by a newer update is dropped
//! before its pages are rendered, and the newer one is compiled instead. Typst cannot cancel a
//! compile, so a watchdog abandons one that runs past the time limit and continues on a fresh
//! session (ADR-0002 section 12).

use std::collections::BTreeMap;
use std::panic::{self, AssertUnwindSafe};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, SyncSender};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use time::OffsetDateTime;
use typst::foundations::Bytes;
use typst::layout::PagedDocument;
use typst::utils::hash128;

use super::compile::{Compiled, compile_document, local_now};
use super::diagnostics::Diagnostic;
use super::vragen::{Vragen, vragen};
use super::world::{INTERNAL_DIR, MaatwerkWorld};
use crate::error::{Error, Result};
use crate::paths::RelPath;
use crate::snapshots::SETTINGS_FILE;
use crate::storage::Storage;

/// How long [`LiveEditor`] waits after the last update before it compiles. The old editor
/// saved and compiled 600 ms after the last key (`editor-init.js`, `scheduleCompile`); the
/// in-memory compile is cheap enough to go much faster.
pub const DEFAULT_DEBOUNCE: Duration = Duration::from_millis(150);

/// The compile time limit when `instellingen.json` sets none (user, 2026-11-01).
pub const DEFAULT_COMPILE_TIMEOUT: Duration = Duration::from_secs(30);

/// Abandoned compiles that may still be running before the editor waits for one to end, so a
/// document that always times out cannot pile up threads.
const MAX_ABANDONED: usize = 2;

/// How often a waiting coordinator looks at `closed`.
const POLL: Duration = Duration::from_millis(50);

/// The editor part of `instellingen.json` (`editor: { compileTimeoutSeconds }`, admin setting,
/// ADR-0002 section 12). A missing or unusable value counts as the default.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EditorSettings {
    pub compile_timeout: Duration,
}

impl Default for EditorSettings {
    fn default() -> EditorSettings {
        EditorSettings {
            compile_timeout: DEFAULT_COMPILE_TIMEOUT,
        }
    }
}

impl EditorSettings {
    /// Allowed `compileTimeoutSeconds`: whole seconds in this range.
    pub const TIMEOUT_RANGE: (u64, u64) = (2, 300);

    pub fn from_json(instellingen: Option<&Value>) -> EditorSettings {
        let (min, max) = EditorSettings::TIMEOUT_RANGE;
        let seconds = instellingen
            .and_then(|v| v.get("editor"))
            .and_then(|e| e.get("compileTimeoutSeconds"))
            .and_then(Value::as_f64)
            .filter(|n| n.fract() == 0.0 && *n >= min as f64 && *n <= max as f64);
        seconds.map_or_else(EditorSettings::default, |n| EditorSettings {
            compile_timeout: Duration::from_secs(n as u64),
        })
    }

    pub fn read(storage: &Storage) -> EditorSettings {
        let value = RelPath::parse(SETTINGS_FILE)
            .ok()
            .and_then(|rel| storage.read_json(&rel).ok().flatten());
        EditorSettings::from_json(value.as_ref())
    }
}

/// Timing of a [`LiveEditor`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LiveOptions {
    /// Wait this long after the last update before compiling (not for the opening compile).
    pub debounce: Duration,
    /// A compile that runs longer is abandoned (the watchdog).
    pub timeout: Duration,
}

impl Default for LiveOptions {
    fn default() -> LiveOptions {
        LiveOptions {
            debounce: DEFAULT_DEBOUNCE,
            timeout: DEFAULT_COMPILE_TIMEOUT,
        }
    }
}

/// One preview page that differs from what the client has.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PageUpdate {
    /// 0-based page index.
    pub index: usize,
    /// Content hash of the page (hex); equal hashes mean equal pages within one session.
    pub hash: String,
    pub svg: String,
}

/// The result of one compile.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EditorUpdate {
    /// The generation this compile saw (the last update applied before it).
    pub generation: u64,
    /// Whether this compile succeeded. If not, `diagnostics` has the errors and the preview
    /// (`page_count`, the pages the client has) is the last good one.
    pub ok: bool,
    /// Errors first, then warnings (also on success: warnings and boxes for missing glyphs).
    pub diagnostics: Vec<Diagnostic>,
    /// The generation of the preview the client now shows; `None` before the first good one.
    pub preview_generation: Option<u64>,
    /// Pages in that preview; the client drops pages at and after this index.
    pub page_count: usize,
    /// Pages that changed since the last update, in index order.
    pub pages: Vec<PageUpdate>,
    /// The vragen of the document, on a successful compile only.
    pub vragen: Option<Vragen>,
    /// Layout time of this compile.
    pub compile_ms: u64,
    /// Time spent rendering the changed pages to SVG.
    pub render_ms: u64,
}

/// An opdracht (or any Typst project) open in the editor. Blocking and CPU-heavy: callers on an
/// async runtime use [`LiveEditor`] or `spawn_blocking` (PLAN 2.5).
pub struct EditorSession {
    world: MaatwerkWorld,
    clock: Box<dyn Fn() -> OffsetDateTime + Send>,
    /// The last good document, the preview the client shows.
    document: Option<PagedDocument>,
    preview_generation: Option<u64>,
    /// Hashes of the pages the client has, in order.
    shown: Vec<u128>,
    /// The vragen of `document`.
    vragen: Option<Vragen>,
    /// Whether `document` was compiled from the sources as they are now: spans in it resolve
    /// to the right places only then (review 8a n7).
    current: bool,
}

impl EditorSession {
    /// A session on `world`, e.g. `opdracht_world(fonts, project, &OpdrachtInputs::preview(..))`.
    /// `datetime.today()` follows the local clock.
    pub fn new(world: MaatwerkWorld) -> EditorSession {
        EditorSession {
            world,
            clock: Box::new(local_now),
            document: None,
            preview_generation: None,
            shown: Vec::new(),
            vragen: None,
            current: false,
        }
    }

    /// A fixed or test clock instead of the local time.
    pub fn with_clock(
        mut self,
        clock: impl Fn() -> OffsetDateTime + Send + 'static,
    ) -> EditorSession {
        self.clock = Box::new(clock);
        self
    }

    /// Replaces the text of `path` (relative to the project root, e.g. `opdracht.typ`) in memory.
    /// Nothing is written to disk. The app's internal files cannot be replaced (review 8a n4).
    pub fn set_file(&mut self, path: &RelPath, text: impl Into<String>) -> Result<()> {
        check_editable(path)?;
        let changed = self.world.set_file(
            &format!("/{}", path.as_str()),
            Bytes::from_string(text.into()),
        );
        self.current &= !changed;
        Ok(())
    }

    /// Drops the buffer of `path`: the file is read from the project again (e.g. after
    /// "Herstel standaardversie" wrote the bundled `lib.typ`, review 8a n4).
    pub fn unset_file(&mut self, path: &RelPath) -> Result<()> {
        check_editable(path)?;
        if self.world.unset_file(&format!("/{}", path.as_str())) {
            self.current = false;
        }
        Ok(())
    }

    /// The next update sends every page again (the client lost its preview, e.g. a reload).
    pub fn resend_all(&mut self) {
        self.shown.clear();
    }

    /// The next compile reads every disk file again, also one the fingerprint (modification
    /// time and length) would miss, e.g. an image the app just overwrote with one of the same
    /// size (review 8a m3).
    pub fn reload_disk_files(&mut self) {
        self.world.forget_disk_files();
    }

    /// The last good document (the preview the client shows).
    pub fn document(&self) -> Option<&PagedDocument> {
        self.document.as_ref()
    }

    /// The last good document if it was compiled from the sources as they are now, so its
    /// spans point to the right places (jumps, review 8a n7), with its generation.
    pub fn current_document(&self) -> Option<(&PagedDocument, u64)> {
        let document = self.document.as_ref().filter(|_| self.current)?;
        Some((document, self.preview_generation?))
    }

    pub fn world(&self) -> &MaatwerkWorld {
        &self.world
    }

    /// Compiles the current sources as `generation`. Files read from disk (images, the
    /// project's other files) are checked for changes first. Returns `None` when `stale()` says
    /// a newer generation is waiting once layout is done; the client state is then unchanged.
    pub fn compile(&mut self, generation: u64, stale: &dyn Fn() -> bool) -> Option<EditorUpdate> {
        self.world.set_now((self.clock)());
        self.world.reset();
        let start = Instant::now();
        let result = compile_document(&self.world);
        let compile_ms = millis(start.elapsed());
        if stale() {
            return None;
        }
        let (ok, diagnostics) = match result {
            Ok(Compiled { output, warnings }) => {
                self.vragen = Some(vragen(&output));
                self.document = Some(output);
                self.preview_generation = Some(generation);
                self.current = true;
                (true, warnings)
            }
            Err(e) => {
                self.current = false;
                (false, e.diagnostics)
            }
        };
        let start = Instant::now();
        let pages = self.changed_pages();
        Some(EditorUpdate {
            generation,
            ok,
            diagnostics,
            preview_generation: self.preview_generation,
            page_count: self.shown.len(),
            pages,
            vragen: if ok { self.vragen.clone() } else { None },
            compile_ms,
            render_ms: millis(start.elapsed()),
        })
    }

    /// An update for a compile that did not finish: the preview stays as it is.
    fn failed(&self, generation: u64, message: &str) -> EditorUpdate {
        failed_update(
            generation,
            message,
            self.preview_generation,
            self.shown.len(),
        )
    }

    /// The pages of the last good document that the client does not have; afterwards the
    /// client has them all.
    fn changed_pages(&mut self) -> Vec<PageUpdate> {
        let Some(document) = &self.document else {
            return Vec::new();
        };
        let mut out = Vec::new();
        let mut shown = Vec::with_capacity(document.pages.len());
        for (index, page) in document.pages.iter().enumerate() {
            let hash = hash128(page);
            if self.shown.get(index) != Some(&hash) {
                out.push(PageUpdate {
                    index,
                    hash: format!("{hash:032x}"),
                    svg: typst_svg::svg(page),
                });
            }
            shown.push(hash);
        }
        self.shown = shown;
        out
    }
}

fn failed_update(
    generation: u64,
    message: &str,
    preview_generation: Option<u64>,
    page_count: usize,
) -> EditorUpdate {
    EditorUpdate {
        generation,
        ok: false,
        diagnostics: vec![Diagnostic::error(message)],
        preview_generation,
        page_count,
        pages: Vec::new(),
        vragen: None,
        compile_ms: 0,
        render_ms: 0,
    }
}

/// The app's internal files (`__maatwerk/...`) are not the teacher's to replace.
fn check_editable(path: &RelPath) -> Result<()> {
    if path.as_str().split('/').next() == Some(INTERNAL_DIR) {
        return Err(Error::InvalidPath {
            path: path.as_str().to_owned(),
            reason: "internal file",
        });
    }
    Ok(())
}

fn millis(d: Duration) -> u64 {
    u64::try_from(d.as_millis()).unwrap_or(u64::MAX)
}

/// The Dutch message of the watchdog's error update.
pub fn timeout_message(timeout: Duration) -> String {
    format!(
        "Het compileren duurde langer dan {} seconden en is afgebroken. Maak de opdracht \
         kleiner of vraag de beheerder om de tijdslimiet (Instellingen) te verhogen.",
        timeout.as_secs()
    )
}

/// Builds a fresh session for a [`LiveEditor`]: at the start and after the watchdog abandoned
/// a compile. The buffers are applied to it afterwards.
pub type SessionFactory = Box<dyn Fn() -> Result<EditorSession> + Send>;

/// An [`EditorSession`] on its own thread. Updates return at once; compiles run after
/// `debounce` without further updates, and every result goes to `sink`, called on the
/// coordinator thread (it must not block for long and must not call [`LiveEditor::close`]).
/// Dropping the handle stops the threads after the compile in progress (without waiting).
///
/// A coordinator thread waits for work and hands each compile to the compile thread, which owns
/// the session. When a compile runs longer than `timeout`, the coordinator sends an error update,
/// leaves that thread to finish on its own (its result is dropped) and starts a fresh session on
/// a new compile thread with the current buffers.
pub struct LiveEditor {
    shared: Arc<Shared>,
    coordinator: Option<JoinHandle<()>>,
}

struct Shared {
    state: Mutex<State>,
    wake: Condvar,
    /// The latest generation asked for, readable without the lock (stale checks).
    latest: Arc<AtomicU64>,
    /// Jobs for the current compile thread; replaced when the watchdog starts a new one.
    jobs: Mutex<Sender<Job>>,
    /// One clone per running compile thread: the current one and abandoned ones.
    alive: Arc<()>,
}

struct State {
    /// The latest generation asked for; 0 is the opening compile.
    generation: u64,
    /// The generation last compiled (with or without a result).
    done: Option<u64>,
    /// Pending buffer changes, one per file, the latest wins; `None` drops the buffer.
    edits: Vec<(RelPath, Option<String>)>,
    /// Every buffer as it is now, for a fresh session after a timeout.
    buffers: BTreeMap<RelPath, String>,
    resend: bool,
    reload: bool,
    /// The compile waits until `debounce` after this (not for generation 0).
    last_update: Instant,
    closed: bool,
}

/// Work for the compile thread.
enum Job {
    Compile {
        generation: u64,
        edits: Vec<(RelPath, Option<String>)>,
        resend: bool,
        reload: bool,
        result: SyncSender<Option<EditorUpdate>>,
    },
    Query(Box<dyn FnOnce(&mut EditorSession) + Send>),
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn closed(&self) -> bool {
        self.lock().closed
    }

    fn sender(&self) -> Sender<Job> {
        self.jobs.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// Abandoned compile threads that are still running.
    fn abandoned(&self) -> usize {
        // This one, the current thread's.
        Arc::strong_count(&self.alive).saturating_sub(2)
    }
}

impl LiveEditor {
    /// Builds the first session with `factory` and starts the threads; the first compile
    /// (generation 0) runs at once. Fails when the first session cannot be built.
    pub fn start(
        factory: impl Fn() -> Result<EditorSession> + Send + 'static,
        options: LiveOptions,
        sink: impl FnMut(EditorUpdate) + Send + 'static,
    ) -> Result<LiveEditor> {
        let session = factory()?;
        let latest = Arc::new(AtomicU64::new(0));
        let alive = Arc::new(());
        let jobs = spawn_compile_thread(session, Arc::clone(&latest), Arc::clone(&alive));
        let shared = Arc::new(Shared {
            state: Mutex::new(State {
                generation: 0,
                done: None,
                edits: Vec::new(),
                buffers: BTreeMap::new(),
                resend: false,
                reload: false,
                last_update: Instant::now(),
                closed: false,
            }),
            wake: Condvar::new(),
            latest,
            jobs: Mutex::new(jobs),
            alive,
        });
        let coordinator = std::thread::Builder::new()
            .name("maatwerk-editor".into())
            .spawn({
                let shared = Arc::clone(&shared);
                let factory: SessionFactory = Box::new(factory);
                move || coordinate(&shared, &factory, options, sink)
            })
            .expect("spawning the editor thread");
        Ok(LiveEditor {
            shared,
            coordinator: Some(coordinator),
        })
    }

    /// Queues new text for `path`; returns its generation. The result of the compile that
    /// includes it carries this generation or a later one.
    pub fn update(&self, path: RelPath, text: String) -> Result<u64> {
        check_editable(&path)?;
        Ok(self.bump(|state| {
            state.buffers.insert(path.clone(), text.clone());
            queue_edit(state, path, Some(text));
        }))
    }

    /// Drops the buffer of `path` (see [`EditorSession::unset_file`]) and compiles again.
    pub fn unset(&self, path: RelPath) -> Result<u64> {
        check_editable(&path)?;
        Ok(self.bump(|state| {
            state.buffers.remove(&path);
            queue_edit(state, path, None);
        }))
    }

    /// Compiles again and sends every page (the client lost its preview).
    pub fn resend_all(&self) -> u64 {
        self.bump(|state| state.resend = true)
    }

    /// Compiles again with every disk file read again, e.g. after an image was added or
    /// overwritten (otherwise disk files are only checked by fingerprint at each compile).
    pub fn refresh(&self) -> u64 {
        self.bump(|state| state.reload = true)
    }

    /// Runs `f` on the session, after the compile in progress; `None` when that does not happen
    /// within `wait` (a long compile, a closed editor) or `f` panics. Queries see the sources
    /// of the last compile plus whatever `f` sets itself.
    pub fn query<R: Send + 'static>(
        &self,
        wait: Duration,
        f: impl FnOnce(&mut EditorSession) -> R + Send + 'static,
    ) -> Option<R> {
        let (tx, rx) = mpsc::sync_channel(1);
        let job = Job::Query(Box::new(move |session| {
            let _ = tx.send(f(session));
        }));
        self.shared.sender().send(job).ok()?;
        rx.recv_timeout(wait).ok()
    }

    fn bump(&self, change: impl FnOnce(&mut State)) -> u64 {
        let mut state = self.shared.lock();
        change(&mut state);
        state.generation += 1;
        state.last_update = Instant::now();
        self.shared.latest.store(state.generation, Ordering::SeqCst);
        self.shared.wake.notify_all();
        state.generation
    }

    /// Stops the threads; waits for the coordinator, not for a compile in progress.
    pub fn close(mut self) {
        self.stop();
        if let Some(coordinator) = self.coordinator.take()
            && coordinator.join().is_err()
        {
            tracing::error!("the editor thread ended with a panic");
        }
    }

    fn stop(&self) {
        self.shared.lock().closed = true;
        self.shared.wake.notify_all();
    }
}

impl Drop for LiveEditor {
    fn drop(&mut self) {
        self.stop();
    }
}

fn queue_edit(state: &mut State, path: RelPath, text: Option<String>) {
    match state.edits.iter_mut().find(|(p, _)| *p == path) {
        Some(edit) => edit.1 = text,
        None => state.edits.push((path, text)),
    }
}

/// Starts a compile thread that owns `session`. It ends when its job sender is dropped, or
/// right after a compile whose result nobody waits for any more (it was abandoned).
fn spawn_compile_thread(
    session: EditorSession,
    latest: Arc<AtomicU64>,
    alive: Arc<()>,
) -> Sender<Job> {
    let (tx, rx) = mpsc::channel();
    std::thread::Builder::new()
        .name("maatwerk-editor-compile".into())
        .spawn(move || {
            compile_jobs(session, &rx, &latest);
            drop(alive);
        })
        .expect("spawning the editor compile thread");
    tx
}

fn compile_jobs(mut session: EditorSession, jobs: &Receiver<Job>, latest: &AtomicU64) {
    while let Ok(job) = jobs.recv() {
        match job {
            Job::Compile {
                generation,
                edits,
                resend,
                reload,
                result,
            } => {
                for (path, text) in edits {
                    let applied = match text {
                        Some(text) => session.set_file(&path, text),
                        None => session.unset_file(&path),
                    };
                    if let Err(e) = applied {
                        tracing::warn!("editor buffer not applied: {e}");
                    }
                }
                if resend {
                    session.resend_all();
                }
                if reload {
                    session.reload_disk_files();
                }
                let stale = || latest.load(Ordering::SeqCst) != generation;
                let update =
                    panic::catch_unwind(AssertUnwindSafe(|| session.compile(generation, &stale)))
                        .unwrap_or_else(|_| {
                            tracing::error!("the Typst compiler panicked in the editor session");
                            Some(session.failed(generation, "internal error in the Typst compiler"))
                        });
                if result.send(update).is_err() {
                    return;
                }
            }
            Job::Query(f) => {
                if panic::catch_unwind(AssertUnwindSafe(|| f(&mut session))).is_err() {
                    tracing::error!("an editor query panicked");
                }
            }
        }
    }
}

/// How a compile handed to the compile thread ended.
enum Outcome {
    Done(Option<EditorUpdate>),
    TimedOut,
    /// The compile thread is gone (it cannot panic past `catch_unwind`, but be safe).
    Lost,
    Closed,
}

fn coordinate(
    shared: &Shared,
    factory: &SessionFactory,
    options: LiveOptions,
    mut sink: impl FnMut(EditorUpdate),
) {
    // What the client shows, for the error update after a timeout.
    let mut preview: (Option<u64>, usize) = (None, 0);
    loop {
        let (generation, edits, resend, reload) = {
            let mut state = shared.lock();
            // Wait for work, then for `debounce` after the last update.
            loop {
                if state.closed {
                    return;
                }
                if state.done == Some(state.generation) {
                    state = shared.wake.wait(state).unwrap_or_else(|e| e.into_inner());
                    continue;
                }
                let due = if state.generation == 0 {
                    state.last_update
                } else {
                    state.last_update + options.debounce
                };
                let now = Instant::now();
                if now >= due {
                    break;
                }
                state = shared
                    .wake
                    .wait_timeout(state, due - now)
                    .unwrap_or_else(|e| e.into_inner())
                    .0;
            }
            (
                state.generation,
                std::mem::take(&mut state.edits),
                std::mem::take(&mut state.resend),
                std::mem::take(&mut state.reload),
            )
        };
        // Too many abandoned compiles still running: wait for one to end first.
        while shared.abandoned() >= MAX_ABANDONED {
            if shared.closed() {
                return;
            }
            std::thread::sleep(POLL);
        }
        let (tx, rx) = mpsc::sync_channel(1);
        let job = Job::Compile {
            generation,
            edits,
            resend,
            reload,
            result: tx,
        };
        let outcome = if shared.sender().send(job).is_err() {
            Outcome::Lost
        } else {
            wait_for(shared, &rx, options.timeout)
        };
        let update = match outcome {
            Outcome::Closed => return,
            Outcome::Done(update) => update,
            Outcome::TimedOut | Outcome::Lost => {
                let message = if matches!(outcome, Outcome::TimedOut) {
                    tracing::warn!("editor compile abandoned after {:?}", options.timeout);
                    timeout_message(options.timeout)
                } else {
                    tracing::error!("the editor compile thread is gone");
                    "internal error in the Typst compiler".to_owned()
                };
                drop(rx);
                restart(shared, factory);
                Some(failed_update(generation, &message, preview.0, preview.1))
            }
        };
        let mut state = shared.lock();
        state.done = Some(generation);
        if state.closed {
            return;
        }
        drop(state);
        if let Some(update) = update {
            preview = (update.preview_generation, update.page_count);
            // A panicking sink must not end the thread: later updates would never be compiled
            // (review 8a m1).
            if panic::catch_unwind(AssertUnwindSafe(|| sink(update))).is_err() {
                tracing::error!("the editor update sink panicked");
            }
        }
    }
}

fn wait_for(shared: &Shared, rx: &Receiver<Option<EditorUpdate>>, timeout: Duration) -> Outcome {
    let start = Instant::now();
    loop {
        match rx.recv_timeout(POLL.min(timeout)) {
            Ok(update) => return Outcome::Done(update),
            Err(RecvTimeoutError::Disconnected) => return Outcome::Lost,
            Err(RecvTimeoutError::Timeout) => {
                if shared.closed() {
                    return Outcome::Closed;
                }
                if start.elapsed() >= timeout {
                    return Outcome::TimedOut;
                }
            }
        }
    }
}

/// A fresh session with the current buffers on a new compile thread. The old thread's sender is
/// dropped here, so it ends after its compile. If no session can be built, the old thread stays
/// (the next compile waits for it again).
fn restart(shared: &Shared, factory: &SessionFactory) {
    let session = factory().and_then(|mut session| {
        let buffers = shared.lock().buffers.clone();
        for (path, text) in buffers {
            session.set_file(&path, text)?;
        }
        Ok(session)
    });
    match session {
        Ok(session) => {
            let jobs = spawn_compile_thread(
                session,
                Arc::clone(&shared.latest),
                Arc::clone(&shared.alive),
            );
            *shared.jobs.lock().unwrap_or_else(|e| e.into_inner()) = jobs;
        }
        Err(e) => tracing::error!("no fresh editor session after a timeout: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::sync::OnceLock;
    use std::sync::mpsc;

    use super::*;
    use crate::typst_svc::{FontStore, Severity, TypstProject};

    fn fonts() -> Arc<FontStore> {
        static FONTS: OnceLock<Arc<FontStore>> = OnceLock::new();
        FONTS
            .get_or_init(|| Arc::new(FontStore::new(false)))
            .clone()
    }

    fn fixed_now() -> OffsetDateTime {
        OffsetDateTime::from_unix_timestamp(1_767_225_600).unwrap()
    }

    fn main_typ() -> RelPath {
        RelPath::parse("main.typ").unwrap()
    }

    /// Three small pages with `a`, `b` and `c` on them.
    fn pages(a: &str, b: &str, c: &str) -> String {
        format!("#set page(width: 6cm, height: 4cm)\n{a}\n#pagebreak()\n{b}\n#pagebreak()\n{c}\n")
    }

    /// A project folder whose `main.typ` on disk says "op schijf"; the session's buffer has
    /// `text`.
    fn session(dir: &Path, text: &str) -> EditorSession {
        std::fs::write(dir.join("main.typ"), "op schijf").unwrap();
        let world = TypstProject::folder(dir, &main_typ()).world(fonts(), fixed_now());
        let mut session = EditorSession::new(world).with_clock(fixed_now);
        session.set_file(&main_typ(), text).unwrap();
        session
    }

    /// Fresh sessions like [`session`] (the first one writes `main.typ`).
    fn factory(dir: &Path, text: &str) -> impl Fn() -> Result<EditorSession> + Send + 'static {
        let (dir, text) = (dir.to_owned(), text.to_owned());
        move || Ok(session(&dir, &text))
    }

    impl LiveEditor {
        fn update_ok(&self, path: RelPath, text: String) -> u64 {
            self.update(path, text).unwrap()
        }
    }

    fn compile(session: &mut EditorSession, generation: u64) -> EditorUpdate {
        session.compile(generation, &|| false).unwrap()
    }

    fn indices(update: &EditorUpdate) -> Vec<usize> {
        update.pages.iter().map(|p| p.index).collect()
    }

    #[test]
    fn the_first_compile_sends_every_page_then_only_changed_ones() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = session(tmp.path(), &pages("A", "B", "C"));
        let first = compile(&mut s, 0);
        assert!(first.ok, "{:?}", first.diagnostics);
        assert_eq!((first.page_count, indices(&first)), (3, vec![0, 1, 2]));
        assert_eq!(first.preview_generation, Some(0));
        assert!(first.pages[0].svg.starts_with("<svg"));

        s.set_file(&main_typ(), pages("A", "B", "C anders"))
            .unwrap();
        let second = compile(&mut s, 1);
        assert_eq!((second.page_count, indices(&second)), (3, vec![2]));
        assert_ne!(second.pages[0].hash, first.pages[2].hash);

        // The same text again: nothing to send.
        let third = compile(&mut s, 2);
        assert!(third.ok && third.pages.is_empty());
        assert_eq!(third.preview_generation, Some(2));
    }

    #[test]
    fn errors_keep_the_last_good_preview_with_located_diagnostics() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = session(tmp.path(), &pages("A", "B", "C"));
        compile(&mut s, 0);
        // An emoji before the error: byte and UTF-16 positions differ.
        s.set_file(&main_typ(), pages("A", "😀 #nope", "C"))
            .unwrap();
        let failed = compile(&mut s, 1);
        assert!(!failed.ok);
        assert_eq!(failed.preview_generation, Some(0));
        assert_eq!(failed.page_count, 3);
        assert!(failed.pages.is_empty());
        let error = &failed.diagnostics[0];
        assert_eq!(error.severity, Severity::Error);
        assert_eq!(error.message, "unknown variable: nope");
        let loc = error.location.as_ref().unwrap();
        assert_eq!(
            (loc.file.as_str(), loc.line, loc.column),
            ("main.typ", 4, 4)
        );
        // Line 4 starts after "#set ...\nA\n#pagebreak()\n".
        let start = pages("A", "", "").find("\n\n").unwrap() + 1;
        assert_eq!(loc.range, (start + 6, start + 10));
        assert_eq!(loc.range_utf16, (start + 4, start + 8));

        // Fixed, with a change on page 2 only: compared with the last good preview.
        s.set_file(&main_typ(), pages("A", "😀 nope", "C")).unwrap();
        let fixed = compile(&mut s, 2);
        assert!(fixed.ok);
        assert_eq!(
            (fixed.preview_generation, indices(&fixed)),
            (Some(2), vec![1])
        );
    }

    #[test]
    fn fewer_pages_shrink_the_preview() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = session(tmp.path(), &pages("A", "B", "C"));
        compile(&mut s, 0);
        s.set_file(&main_typ(), "#set page(width: 6cm, height: 4cm)\nA\n")
            .unwrap();
        let update = compile(&mut s, 1);
        assert_eq!((update.page_count, indices(&update)), (1, vec![]));
    }

    #[test]
    fn a_stale_compile_changes_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = session(tmp.path(), &pages("A", "B", "C"));
        compile(&mut s, 0);
        s.set_file(&main_typ(), pages("A2", "B", "C")).unwrap();
        assert_eq!(s.compile(1, &|| true), None);
        s.set_file(&main_typ(), pages("A2", "B", "C2")).unwrap();
        let update = compile(&mut s, 2);
        assert_eq!(indices(&update), vec![0, 2], "compared with generation 0");
    }

    #[test]
    fn resend_all_sends_the_last_good_pages_even_while_there_are_errors() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = session(tmp.path(), &pages("A", "B", "C"));
        compile(&mut s, 0);
        s.set_file(&main_typ(), "#(").unwrap();
        s.resend_all();
        let update = compile(&mut s, 1);
        assert!(!update.ok);
        assert_eq!((update.page_count, indices(&update)), (3, vec![0, 1, 2]));
        assert_eq!(update.preview_generation, Some(0));
    }

    #[test]
    fn a_resend_overtaken_by_a_newer_update_still_sends_every_page() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = session(tmp.path(), &pages("A", "B", "C"));
        compile(&mut s, 0);
        s.resend_all();
        assert_eq!(s.compile(1, &|| true), None);
        assert_eq!(indices(&compile(&mut s, 2)), vec![0, 1, 2]);
    }

    #[test]
    fn reload_reads_a_disk_file_the_fingerprint_misses() {
        let tmp = tempfile::tempdir().unwrap();
        let deel = tmp.path().join("deel.typ");
        std::fs::write(&deel, "Deel een").unwrap();
        let mut s = session(
            tmp.path(),
            "#set page(width: 6cm, height: 4cm)
#include \"deel.typ\"
",
        );
        compile(&mut s, 0);
        // Same length, modification time put back: the fingerprint sees no change.
        let mtime = std::fs::metadata(&deel).unwrap().modified().unwrap();
        std::fs::write(&deel, "Deel twe").unwrap();
        std::fs::File::options()
            .write(true)
            .open(&deel)
            .unwrap()
            .set_modified(mtime)
            .unwrap();
        assert!(compile(&mut s, 1).pages.is_empty());
        s.reload_disk_files();
        assert_eq!(indices(&compile(&mut s, 2)), vec![0]);
    }

    #[test]
    fn files_on_disk_are_checked_before_each_compile() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = session(
            tmp.path(),
            "#set page(width: 6cm, height: 4cm)\n#include \"deel.typ\"\n",
        );
        let missing = compile(&mut s, 0);
        assert!(!missing.ok);
        assert!(missing.diagnostics[0].message.starts_with("file not found"));

        std::fs::write(tmp.path().join("deel.typ"), "Deel een").unwrap();
        let found = compile(&mut s, 1);
        assert!(found.ok, "{:?}", found.diagnostics);
        assert_eq!(indices(&found), vec![0]);

        // Same bytes: nothing new. A changed file (other length) is read again.
        assert!(compile(&mut s, 2).pages.is_empty());
        std::fs::write(tmp.path().join("deel.typ"), "Deel twee, langer").unwrap();
        assert_eq!(indices(&compile(&mut s, 3)), vec![0]);
    }

    #[test]
    fn a_folder_created_during_the_session_becomes_visible() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("sub");
        let world = TypstProject::folder(&root, &main_typ()).world(fonts(), fixed_now());
        let mut s = EditorSession::new(world).with_clock(fixed_now);
        assert!(!compile(&mut s, 0).ok, "no folder yet");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("main.typ"), "Hallo").unwrap();
        assert!(compile(&mut s, 1).ok);
    }

    #[test]
    fn the_buffer_is_never_written_to_disk() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = session(tmp.path(), &pages("A", "B", "C"));
        compile(&mut s, 0);
        assert_eq!(
            std::fs::read_to_string(tmp.path().join("main.typ")).unwrap(),
            "op schijf"
        );
        assert_eq!(std::fs::read_dir(tmp.path()).unwrap().count(), 1);
    }

    #[test]
    fn a_long_session_holds_no_more_files() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = session(tmp.path(), &pages("A", "B", "C"));
        compile(&mut s, 0);
        let files = s.world.cached_files();
        for n in 1..200u64 {
            s.set_file(&main_typ(), pages("A", &format!("B {n}"), "C"))
                .unwrap();
            let update = compile(&mut s, n);
            assert_eq!(indices(&update), vec![1], "edit {n}");
        }
        assert_eq!(s.world.cached_files(), files);
        assert_eq!(s.shown.len(), 3);
    }

    fn live(
        text: &str,
        debounce: Duration,
    ) -> (tempfile::TempDir, LiveEditor, mpsc::Receiver<EditorUpdate>) {
        let tmp = tempfile::tempdir().unwrap();
        let (tx, rx) = mpsc::channel();
        let editor = LiveEditor::start(
            factory(tmp.path(), text),
            LiveOptions {
                debounce,
                ..LiveOptions::default()
            },
            move |u| {
                let _ = tx.send(u);
            },
        )
        .unwrap();
        (tmp, editor, rx)
    }

    const WAIT: Duration = Duration::from_secs(20);

    #[test]
    fn live_updates_within_the_debounce_give_one_compile_of_the_latest_text() {
        // A long debounce, so the five updates fall inside it even on a busy machine (review
        // 8a m5).
        let (_tmp, editor, rx) = live(&pages("A", "B", "C"), Duration::from_secs(2));
        let first = rx.recv_timeout(WAIT).unwrap();
        assert_eq!((first.generation, first.pages.len()), (0, 3));

        let mut last = 0;
        for n in 1..=5 {
            last = editor.update_ok(main_typ(), pages("A", "B", &format!("C {n}")));
        }
        assert_eq!(last, 5);
        let update = rx.recv_timeout(WAIT).unwrap();
        assert_eq!((update.generation, indices(&update)), (5, vec![2]));
        assert!(
            rx.recv_timeout(Duration::from_millis(300)).is_err(),
            "one compile"
        );

        assert_eq!(editor.resend_all(), 6);
        assert_eq!(rx.recv_timeout(WAIT).unwrap().pages.len(), 3);
        editor.close();
    }

    #[test]
    fn a_panicking_sink_does_not_stop_the_thread() {
        let tmp = tempfile::tempdir().unwrap();
        let (tx, rx) = mpsc::channel();
        let mut calls = 0;
        let options = LiveOptions {
            debounce: Duration::ZERO,
            ..LiveOptions::default()
        };
        let sink = move |u: EditorUpdate| {
            calls += 1;
            assert!(calls > 1, "the first update panics");
            let _ = tx.send(u);
        };
        let editor =
            LiveEditor::start(factory(tmp.path(), &pages("A", "B", "C")), options, sink).unwrap();
        // Whichever compile reaches the sink first panics; a later update still arrives.
        let mut received = None;
        for n in 0..20 {
            editor.update_ok(main_typ(), pages("A", "B", &format!("D {n}")));
            if let Ok(update) = rx.recv_timeout(Duration::from_secs(1)) {
                received = Some(update);
                break;
            }
        }
        assert!(received.is_some_and(|u| u.ok));
        editor.close();
    }

    #[test]
    fn live_results_never_go_back_in_generation_and_end_at_the_latest() {
        let (_tmp, editor, rx) = live(&pages("A", "B", "C"), Duration::ZERO);
        let mut last = 0;
        for n in 1..=30u64 {
            last = editor.update_ok(main_typ(), pages("A", &format!("B {n}"), "C"));
            std::thread::sleep(Duration::from_millis(n % 4));
        }
        let mut seen = Vec::new();
        loop {
            let update = rx.recv_timeout(WAIT).unwrap();
            assert!(update.ok);
            seen.push(update.generation);
            if update.generation == last {
                break;
            }
        }
        assert!(seen.windows(2).all(|w| w[0] < w[1]), "{seen:?}");
        editor.close();
        assert!(rx.try_recv().is_err(), "nothing after the latest");
    }

    #[test]
    fn dropping_the_handle_stops_the_thread() {
        let (_tmp, editor, rx) = live(&pages("A", "B", "C"), Duration::from_millis(50));
        rx.recv_timeout(WAIT).unwrap();
        editor.update_ok(main_typ(), pages("A", "B", "D"));
        drop(editor);
        // The sink (and its sender) goes when the thread ends: the channel disconnects.
        loop {
            match rx.recv_timeout(WAIT) {
                Ok(_) => continue,
                Err(e) => {
                    assert_eq!(e, mpsc::RecvTimeoutError::Disconnected);
                    break;
                }
            }
        }
    }

    #[test]
    fn unset_file_serves_the_disk_version_again() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = session(tmp.path(), &pages("A", "B", "C"));
        assert_eq!(compile(&mut s, 0).page_count, 3);
        s.unset_file(&main_typ()).unwrap();
        let update = compile(&mut s, 1);
        assert!(update.ok);
        // "op schijf" on one default page.
        assert_eq!(update.page_count, 1);
    }

    #[test]
    fn internal_files_cannot_be_replaced() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = session(tmp.path(), "A");
        let internal = RelPath::parse("__maatwerk/rapport.typ").unwrap();
        assert!(s.set_file(&internal, "x").is_err());
        assert!(s.unset_file(&internal).is_err());
    }

    #[test]
    fn the_current_document_is_only_the_one_of_the_current_sources() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = session(tmp.path(), &pages("A", "B", "C"));
        assert!(s.current_document().is_none(), "nothing compiled yet");
        compile(&mut s, 0);
        assert_eq!(s.current_document().map(|(_, g)| g), Some(0));
        // The same text again changes nothing.
        s.set_file(&main_typ(), pages("A", "B", "C")).unwrap();
        assert!(s.current_document().is_some());
        s.set_file(&main_typ(), pages("A", "B", "C2")).unwrap();
        assert!(s.current_document().is_none(), "edited since");
        s.set_file(&main_typ(), "#(").unwrap();
        compile(&mut s, 1);
        assert!(s.current_document().is_none(), "the last compile failed");
        assert!(s.document().is_some(), "the preview stays");
        s.set_file(&main_typ(), pages("A", "B", "D")).unwrap();
        compile(&mut s, 2);
        assert_eq!(s.current_document().map(|(_, g)| g), Some(2));
    }

    #[test]
    fn editor_settings_take_whole_seconds_in_range_else_the_default() {
        let parse = |v: serde_json::Value| EditorSettings::from_json(Some(&v)).compile_timeout;
        let default = DEFAULT_COMPILE_TIMEOUT;
        assert_eq!(EditorSettings::from_json(None).compile_timeout, default);
        let json =
            |n: serde_json::Value| serde_json::json!({ "editor": { "compileTimeoutSeconds": n } });
        assert_eq!(parse(json(5.into())), Duration::from_secs(5));
        assert_eq!(parse(json(2.into())), Duration::from_secs(2));
        assert_eq!(parse(json(300.into())), Duration::from_secs(300));
        for bad in [
            serde_json::json!(1),
            serde_json::json!(301),
            serde_json::json!(2.5),
            serde_json::json!("10"),
            serde_json::json!(null),
        ] {
            assert_eq!(parse(json(bad.clone())), default, "{bad}");
        }
        assert_eq!(parse(serde_json::json!({ "editor": 3 })), default);
    }

    #[test]
    fn live_editor_rejects_internal_files() {
        let (_tmp, editor, _rx) = live("A", Duration::ZERO);
        let internal = RelPath::parse("__maatwerk/lib.typ").unwrap();
        assert!(editor.update(internal.clone(), "x".into()).is_err());
        assert!(editor.unset(internal).is_err());
        editor.close();
    }

    #[test]
    fn queries_run_on_the_session_after_the_compile() {
        let (_tmp, editor, rx) = live(&pages("A", "B", "C"), Duration::ZERO);
        rx.recv_timeout(WAIT).unwrap();
        let pages = editor.query(WAIT, |s| s.document().map(|d| d.pages.len()));
        assert_eq!(pages, Some(Some(3)));
        // A panicking query gives `None` and leaves the editor working.
        assert_eq!(editor.query(WAIT, |_| -> u8 { panic!("boom") }), None);
        editor.update_ok(main_typ(), pages_text("A", "B"));
        assert!(rx.recv_timeout(WAIT).unwrap().ok);
        editor.close();
    }

    fn pages_text(a: &str, b: &str) -> String {
        format!("#set page(width: 6cm, height: 4cm)\n{a}\n#pagebreak()\n{b}\n")
    }

    /// A document that takes far longer than the short test time limit: Typst bounds `while`
    /// loops, not `for` loops (ADR-0002 section 12).
    const SLOW: &str = "#let n = 0\n#for i in range(50000000) { n += 1 }\n#n";

    #[test]
    fn the_watchdog_abandons_a_long_compile_and_continues_on_a_fresh_session() {
        let tmp = tempfile::tempdir().unwrap();
        let (tx, rx) = mpsc::channel();
        let options = LiveOptions {
            debounce: Duration::ZERO,
            timeout: Duration::from_millis(400),
        };
        let editor = LiveEditor::start(
            factory(tmp.path(), &pages("A", "B", "C")),
            options,
            move |u| {
                let _ = tx.send(u);
            },
        )
        .unwrap();
        let first = rx.recv_timeout(WAIT).unwrap();
        assert_eq!((first.ok, first.page_count), (true, 3));

        let started = Instant::now();
        let slow = editor.update_ok(main_typ(), SLOW.to_owned());
        let timed_out = rx.recv_timeout(WAIT).unwrap();
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "{:?}",
            started.elapsed()
        );
        assert_eq!(timed_out.generation, slow);
        assert!(!timed_out.ok);
        assert!(timed_out.pages.is_empty());
        assert_eq!(
            (timed_out.preview_generation, timed_out.page_count),
            (Some(0), 3),
            "the preview stays"
        );
        assert_eq!(
            timed_out.diagnostics[0].message,
            timeout_message(options.timeout)
        );

        // The fresh session has the buffer (the next edit) and sends every page again.
        let fixed = editor.update_ok(main_typ(), pages_text("A", "B"));
        let update = rx.recv_timeout(WAIT).unwrap();
        assert_eq!(update.generation, fixed);
        assert!(update.ok, "{:?}", update.diagnostics);
        assert_eq!((update.page_count, update.pages.len()), (2, 2));
        editor.close();
    }

    #[test]
    fn the_fresh_session_after_a_timeout_keeps_every_buffer() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("deel.typ"), "deel op schijf").unwrap();
        let (tx, rx) = mpsc::channel();
        let options = LiveOptions {
            debounce: Duration::ZERO,
            timeout: Duration::from_millis(400),
        };
        let editor = LiveEditor::start(
            factory(tmp.path(), "#include \"deel.typ\""),
            options,
            move |u| {
                let _ = tx.send(u);
            },
        )
        .unwrap();
        rx.recv_timeout(WAIT).unwrap();
        let deel = RelPath::parse("deel.typ").unwrap();
        editor.update_ok(
            deel,
            "#set page(width: 6cm, height: 4cm)\nA\n#pagebreak()\nB".into(),
        );
        assert_eq!(rx.recv_timeout(WAIT).unwrap().page_count, 2);
        editor.update_ok(main_typ(), SLOW.to_owned());
        assert!(!rx.recv_timeout(WAIT).unwrap().ok);
        editor.update_ok(main_typ(), "#include \"deel.typ\"".into());
        let update = rx.recv_timeout(WAIT).unwrap();
        assert!(update.ok, "{:?}", update.diagnostics);
        assert_eq!(
            update.page_count, 2,
            "deel.typ's buffer, not the disk version"
        );
        editor.close();
    }
}
