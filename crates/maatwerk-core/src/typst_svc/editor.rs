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
//! before its pages are rendered, and the newer one is compiled instead.

use std::panic::{self, AssertUnwindSafe};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde::Serialize;
use time::OffsetDateTime;
use typst::foundations::Bytes;
use typst::layout::PagedDocument;
use typst::utils::hash128;

use super::compile::{Compiled, compile_document, local_now};
use super::diagnostics::Diagnostic;
use super::world::MaatwerkWorld;
use crate::paths::RelPath;

/// How long [`LiveEditor`] waits after the last update before it compiles. The old editor
/// saved and compiled 600 ms after the last key (`editor-init.js`, `scheduleCompile`); the
/// in-memory compile is cheap enough to go much faster.
pub const DEFAULT_DEBOUNCE: Duration = Duration::from_millis(150);

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
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
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
    /// Nothing is written to disk.
    pub fn set_file(&mut self, path: &RelPath, text: impl Into<String>) {
        self.world.set_file(
            &format!("/{}", path.as_str()),
            Bytes::from_string(text.into()),
        );
    }

    /// The next update sends every page again (the client lost its preview, e.g. a reload).
    pub fn resend_all(&mut self) {
        self.shown.clear();
    }

    /// The last good document (for jumps between source and preview, Step 8b).
    pub fn document(&self) -> Option<&PagedDocument> {
        self.document.as_ref()
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
                self.document = Some(output);
                self.preview_generation = Some(generation);
                (true, warnings)
            }
            Err(e) => (false, e.diagnostics),
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
            compile_ms,
            render_ms: millis(start.elapsed()),
        })
    }

    /// An update for a compile that did not finish: the preview stays as it is.
    fn failed(&self, generation: u64, message: &str) -> EditorUpdate {
        EditorUpdate {
            generation,
            ok: false,
            diagnostics: vec![Diagnostic::error(message)],
            preview_generation: self.preview_generation,
            page_count: self.shown.len(),
            pages: Vec::new(),
            compile_ms: 0,
            render_ms: 0,
        }
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

fn millis(d: Duration) -> u64 {
    u64::try_from(d.as_millis()).unwrap_or(u64::MAX)
}

/// An [`EditorSession`] on its own thread. Updates return at once; compiles run after
/// `debounce` without further updates, and every result goes to `sink` on that thread. Dropping
/// the handle stops the thread after the compile in progress (without waiting for it).
pub struct LiveEditor {
    shared: Arc<Shared>,
    worker: Option<JoinHandle<()>>,
}

struct Shared {
    state: Mutex<State>,
    wake: Condvar,
}

struct State {
    /// The latest generation asked for; 0 is the opening compile.
    generation: u64,
    /// The generation last compiled (with or without a result).
    done: Option<u64>,
    /// Pending buffer changes, one per file, the latest text wins.
    edits: Vec<(RelPath, String)>,
    resend: bool,
    /// The compile waits until `debounce` after this (not for generation 0).
    last_update: Instant,
    closed: bool,
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }
}

impl LiveEditor {
    /// Starts the thread; the first compile (generation 0) runs at once.
    pub fn start(
        session: EditorSession,
        debounce: Duration,
        sink: impl FnMut(EditorUpdate) + Send + 'static,
    ) -> LiveEditor {
        let shared = Arc::new(Shared {
            state: Mutex::new(State {
                generation: 0,
                done: None,
                edits: Vec::new(),
                resend: false,
                last_update: Instant::now(),
                closed: false,
            }),
            wake: Condvar::new(),
        });
        let worker = std::thread::Builder::new()
            .name("maatwerk-editor".into())
            .spawn({
                let shared = Arc::clone(&shared);
                move || run(&shared, session, debounce, sink)
            })
            .expect("spawning the editor thread");
        LiveEditor {
            shared,
            worker: Some(worker),
        }
    }

    /// Queues new text for `path`; returns its generation. The result of the compile that
    /// includes it carries this generation or a later one.
    pub fn update(&self, path: RelPath, text: String) -> u64 {
        self.bump(
            |state| match state.edits.iter_mut().find(|(p, _)| *p == path) {
                Some(edit) => edit.1 = text,
                None => state.edits.push((path, text)),
            },
        )
    }

    /// Compiles again and sends every page (the client lost its preview).
    pub fn resend_all(&self) -> u64 {
        self.bump(|state| state.resend = true)
    }

    /// Compiles again, e.g. after an image was added (disk files are checked at each compile).
    pub fn refresh(&self) -> u64 {
        self.bump(|_| {})
    }

    fn bump(&self, change: impl FnOnce(&mut State)) -> u64 {
        let mut state = self.shared.lock();
        change(&mut state);
        state.generation += 1;
        state.last_update = Instant::now();
        self.shared.wake.notify_all();
        state.generation
    }

    /// Stops the thread and waits for the compile in progress.
    pub fn close(mut self) {
        self.stop();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
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

fn run(
    shared: &Shared,
    mut session: EditorSession,
    debounce: Duration,
    mut sink: impl FnMut(EditorUpdate),
) {
    loop {
        let (generation, edits, resend) = {
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
                    state.last_update + debounce
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
            )
        };
        for (path, text) in edits {
            session.set_file(&path, text);
        }
        if resend {
            session.resend_all();
        }
        let stale = || shared.lock().generation != generation;
        let update = panic::catch_unwind(AssertUnwindSafe(|| session.compile(generation, &stale)))
            .unwrap_or_else(|_| {
                tracing::error!("the Typst compiler panicked in the editor session");
                Some(session.failed(generation, "internal error in the Typst compiler"))
            });
        let mut state = shared.lock();
        state.done = Some(generation);
        if state.closed {
            return;
        }
        drop(state);
        if let Some(update) = update {
            sink(update);
        }
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
        session.set_file(&main_typ(), text);
        session
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

        s.set_file(&main_typ(), pages("A", "B", "C anders"));
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
        s.set_file(&main_typ(), pages("A", "😀 #nope", "C"));
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
        s.set_file(&main_typ(), pages("A", "😀 nope", "C"));
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
        s.set_file(&main_typ(), "#set page(width: 6cm, height: 4cm)\nA\n");
        let update = compile(&mut s, 1);
        assert_eq!((update.page_count, indices(&update)), (1, vec![]));
    }

    #[test]
    fn a_stale_compile_changes_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = session(tmp.path(), &pages("A", "B", "C"));
        compile(&mut s, 0);
        s.set_file(&main_typ(), pages("A2", "B", "C"));
        assert_eq!(s.compile(1, &|| true), None);
        s.set_file(&main_typ(), pages("A2", "B", "C2"));
        let update = compile(&mut s, 2);
        assert_eq!(indices(&update), vec![0, 2], "compared with generation 0");
    }

    #[test]
    fn resend_all_sends_the_last_good_pages_even_while_there_are_errors() {
        let tmp = tempfile::tempdir().unwrap();
        let mut s = session(tmp.path(), &pages("A", "B", "C"));
        compile(&mut s, 0);
        s.set_file(&main_typ(), "#(");
        s.resend_all();
        let update = compile(&mut s, 1);
        assert!(!update.ok);
        assert_eq!((update.page_count, indices(&update)), (3, vec![0, 1, 2]));
        assert_eq!(update.preview_generation, Some(0));
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
            s.set_file(&main_typ(), pages("A", &format!("B {n}"), "C"));
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
        let s = session(tmp.path(), text);
        let (tx, rx) = mpsc::channel();
        let editor = LiveEditor::start(s, debounce, move |u| {
            let _ = tx.send(u);
        });
        (tmp, editor, rx)
    }

    const WAIT: Duration = Duration::from_secs(20);

    #[test]
    fn live_updates_within_the_debounce_give_one_compile_of_the_latest_text() {
        let (_tmp, editor, rx) = live(&pages("A", "B", "C"), Duration::from_millis(300));
        let first = rx.recv_timeout(WAIT).unwrap();
        assert_eq!((first.generation, first.pages.len()), (0, 3));

        let mut last = 0;
        for n in 1..=5 {
            last = editor.update(main_typ(), pages("A", "B", &format!("C {n}")));
        }
        assert_eq!(last, 5);
        let update = rx.recv_timeout(WAIT).unwrap();
        assert_eq!((update.generation, indices(&update)), (5, vec![2]));
        assert!(
            rx.recv_timeout(Duration::from_millis(600)).is_err(),
            "one compile"
        );

        assert_eq!(editor.resend_all(), 6);
        assert_eq!(rx.recv_timeout(WAIT).unwrap().pages.len(), 3);
        editor.close();
    }

    #[test]
    fn live_results_never_go_back_in_generation_and_end_at_the_latest() {
        let (_tmp, editor, rx) = live(&pages("A", "B", "C"), Duration::ZERO);
        let mut last = 0;
        for n in 1..=30u64 {
            last = editor.update(main_typ(), pages("A", &format!("B {n}"), "C"));
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
        editor.update(main_typ(), pages("A", "B", "D"));
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
}
