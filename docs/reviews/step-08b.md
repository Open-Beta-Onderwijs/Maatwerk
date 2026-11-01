# Review: Step 8b (editor UI on the live compile service)

Reviewer: fresh-context subagent, 2026-11-01. Scope: `git diff step-08a..HEAD` on `step/08-editor`
(49 files, +5330/-425). I checked the claims against the code, not the commit messages.
`cargo test -p maatwerk-core --lib typst_svc` passes (50 tests, 4.5 s). I did not run the
Playwright suite or the perf script.

## Summary

The step does what PLAN Step 8b asks: `typst-ide` 0.14.2 autocomplete/hover/definition, jumps both
ways with no cursor marker in the live path, `@codemirror/lint` diagnostics, vragen read through
the introspector (`lib.typ` v2 adds `punten` to the marker, output unchanged), the compile
watchdog with the admin time limit, the `main.typ`/`lib.typ` tabs with the banner, restore and
diff, and the silent update of unchanged older copies with CAS. Backlog items n3, n4, n7 and n8
are dealt with. The architecture is clean: no tauri in core, command handlers are glue, ADR-0005
mirror types, every bridge-taking path goes through `RelPath` or an allowlist, and user text
reaches the DOM only through `textContent`.

There are no blockers. One major finding: after a watchdog restart, the fresh session no longer
knows what preview the client has, so the next failed compile blanks the preview. That breaks the
"last good preview stays" contract right in the situation the watchdog exists for. The minors are
mostly about stale results at the edges, which is the plan's review focus. Help queries change the
session buffer outside the generation ordering, jumps can answer for text that has pending edits,
and the session state is mislabelled after a CAS conflict. A few nits on dead code and docs.

## Blockers

None.

## Majors

### M1. After a watchdog restart, the next failed compile blanks the preview

- `crates/maatwerk-core/src/typst_svc/editor.rs:748-767` (`restart`), `:168-178`
  (`EditorSession::new`), `:279-287` / `:264-276` (`compile` reports `self.preview_generation`
  and `self.shown.len()`).
- `ui/src/editor-live.ts:203` (`patchPages` drops pages from `pageCount` on),
  `ui/src/editor-init.js:657-671` (`applyUpdate`).

**Evidence.** `restart` builds a new `EditorSession` with `preview_generation: None` and an empty
`shown`. The coordinator keeps the client's preview in its local `preview` tuple, but only for the
timeout update itself (`:707`). If the fresh session's first compile **fails**, a normal outcome
because a teacher editing a slow loop often passes through a syntax error, its update has
`preview_generation: None, page_count: 0`. `applyUpdate` then sees
`pageCount !== number of .svg-page`, `patchPages` removes every page, and because
`pageCount > 0` is false the placeholder is not shown again (its text changes, but it stays
hidden). The result is an empty preview pane and `previewGeneration = null`, so jumps stop too.
This breaks ADR-0002 section 12 ("the editor gets an error update ... preview kept") and PLAN 8a
("keeps the last good preview while there are errors"). The tests
`the_watchdog_abandons_*` and `the_fresh_session_after_a_timeout_*` only follow the timeout with a
_good_ compile, so they miss it.

**Fix.** Seed the fresh session with what the client has. The coordinator already sees every
`PageUpdate.hash` and `preview_generation`, so it can track the client's page hashes and give
them to the new session (`EditorSession::assume_client(preview_generation, shown_hashes)`). The
session's `document` stays `None` (no jumps until a good compile), but failed updates report the
right `preview_generation`/`page_count` and a later good compile sends only the changed pages.
The cheaper alternative: while the fresh session has no good compile, the coordinator replaces
`preview_generation`/`page_count` in failed updates with its tracked `preview`. Add a Rust test:
good, then SLOW (timeout), then `#(` gives `preview_generation == Some(0)` and `page_count == 3`.
A Playwright case in `editor.spec.ts`: `#traag`, then `#fout`, should keep `.svg-page` visible.

## Minors

### m1. Help queries change the session buffer outside the generation ordering

- `crates/maatwerk-core/src/typst_svc/ide.rs:224-238` (`source_at` calls `self.set_file`),
  `src-tauri/src/editor.rs:423-425, 453-455, 480-482` (every query passes `Some(text)`),
  `editor.rs:508-519` (queries go straight to the compile thread, past `State.edits`/`buffers`).

**Evidence.** `editor_complete`, `editor_hover` and `editor_definition` write the editor's text
into the session's world. `LiveEditor` knows nothing of this: `State.buffers` and the generation
counter stay as they were, and no compile follows. A query that reaches the compile thread
_after_ the compile job carrying newer text overwrites the buffer with older text. That can
happen when the query is delayed more than the 150 ms debounce in `spawn_blocking`/IPC, or
during a long compile, because queries queue behind it. The session then compiles that older
text for this file when _another_ file is edited, so the preview and diagnostics go stale until
this file is edited again. It also sets `current = false` without a compile, so jumps return
`None` until the next edit. Nothing is lost on disk (saving uses the CodeMirror text), but this
is the "stale results" case the review focus names.

**Fix.** Do not keep query text in the session. Either set the text, run the IDE call and put the
previous buffer back (and the previous `current`), or route the query text through
`LiveEditor::update` so it gets a generation. Restoring is simplest. Add a test: compile T2,
then a query with T1, then edit another file, then the compile shows T2.

### m2. Jumps answer for text that has pending edits

- `ui/src/editor-init.js:689-698` (`syncPreviewToCursor`), `:707-717` (preview click),
  `crates/maatwerk-core/src/typst_svc/editor.rs:228-233` (`current_document`).

**Evidence.** `current` only goes false when an edit is _applied to the session_, which happens
at compile time after the debounce. During the debounce, or when `applyUpdate` handles an update
older than `lastSent` (it still calls `syncPreviewToCursor` when `u.ok`), the client sends a
cursor offset into its _new_ text while the session maps it against the _old_ source. The client
check `j.generation === previewGeneration` does not catch this, because `previewGeneration` is
also the old generation. The result is a preview mark, or a cursor placed after a preview click,
that is off by the size of the pending edit. A preview click while typing can move the cursor to
the wrong character.

**Fix.** On the client, only jump when `previewGeneration >= lastSent` (and skip
`syncPreviewToCursor` in `applyUpdate` when `u.generation < lastSent`). Or pass the client's
latest generation to the jump commands and let core answer `None` when
`shared.latest != preview_generation`.

### m3. A silent update that loses the CAS race reports `current` with the old version

- `crates/maatwerk-core/src/typst_svc/project.rs:217-223`.

**Evidence.** On `Error::Conflict` the status becomes `ProjectFileState::Current` with `version`
from the copy that was just read (v1) and the hash of whatever is there now. The colleague's
write that won may be a changed copy (or v1 again), so the banner state, the needs-attention mark
and "Bekijk verschillen" are wrong until the next open. The data is safe, because the colleague's
file is not touched.

**Fix.** On a conflict, read the file again and classify it again (loop once through the same
match without writing), or report `Modified` with the new hash. Add a test with a write between
the read and the CAS (or a storage stub).

### m4. A restart that fails leaves the old session with pages the client never got

- `crates/maatwerk-core/src/typst_svc/editor.rs:745-766`, `:610-612`.

**Evidence.** If `factory()` fails after a timeout (opdracht folder renamed or removed, a
OneDrive hiccup), the abandoned thread stays the current one. When its compile ends, its
`changed_pages` has already updated `shown`, but the result was dropped (`drop(rx)` at `:705`).
If the send still succeeded, the thread keeps serving jobs with a `shown` that holds pages the
client does not have. Later updates send only diffs against that, so pages can be missing or
outdated in the preview. (n2 in the backlog is a relative.)

**Fix.** When `restart` fails, queue `resend = true` in `State` so the next compile sends every
page.

### m5. Queued help queries pile up behind a long compile and count against its time limit

- `crates/maatwerk-core/src/typst_svc/editor.rs:505-519`, `:614-618`, `:727-742`.

**Evidence.** A query whose caller gave up after `QUERY_WAIT` (2 s) still runs later.
Autocomplete fires about 150 ms after each keystroke and hover on every mouse rest, each with
the full document text. During a 30 s compile, dozens of jobs queue up, each doing `set_file`
plus a `typst_ide` call (path completion walks the folder through `IdeWorld::files`, up to 500
entries, slow on OneDrive). They all run before the next compile. The watchdog clock starts when
the compile job is _sent_ (`wait_for`), so queued queries ahead of it in the FIFO count toward
the compile's time limit.

**Fix.** Pass a cancel flag (or check `tx` with a `try_send` probe or an `Arc<AtomicBool>` set by
the waiter on timeout) and skip queries whose waiter is gone. Start the watchdog clock when the
compile thread _begins_ the compile, for example with a "started" message.

### m6. "Herstel standaardversie" uses native `window.confirm`

- `ui/src/editor-init.js:506-512`.

**Evidence.** The reference forbids native `alert`/`confirm`/`prompt` (`_reference/CLAUDE.md`,
UI conventions: they look out of place and broke text input in Electron). The reference editor
has none. The Step 8b restore adds a new one. (`closeAfterSave` at `:855` came in earlier; it is
not part of this step.)

**Fix.** Use the app's confirm dialog through the parent (`maatwerk-confirm` postMessage to
`confirmDialog` with `danger: true`, okLabel "Herstellen"), or an in-iframe dialog like
`#diff-modal`.

### m7. A session opened while the editor closes is never closed

- `ui/src/modals/editor.js` (`closeEditor` / the `maatwerk-editor` handler setting `_session`).

**Evidence.** `_session` is set only when the `editorOpen` answer arrives. If the editor closes
first (quick close, or a load error), `closeEditor` sees `_session === null` and skips
`editorClose`. The answer then sets `_session` after the close. The `LiveEditor` (two threads, a
World holding the project's files and the last document) stays alive until the next
`editor_open` calls `close_all`. Two `editor_open` calls running at the same time (an iframe
reload) can also both pass `close_all` and leave two sessions (`src-tauri/src/editor.rs:250,
278-282`).

**Fix.** In the `editorOpen` answer, close the session right away if the overlay is already gone.
In `editor_open`, call `close_all` again under the `open` lock just before the insert (or
remove all other ids there).

## Nits

- **n1. Vragen edge cases.** `crates/maatwerk-core/src/typst_svc/vragen.rs:79,113-118`:
  - `punten: "2"` (a string; `lib.typ` `_punten` shows it as "2p") counts as "geen punten".
  - An answer that is only an image or figure has an empty `plain_text`, so the check says
    "heeft geen antwoord".
  - `_opgave_nr()` outside an opgave is the _last_ opgave's number, so "staat niet in een
    #opgave" only fires before the first opgave. This matches `lib.typ`'s own labels, but the
    check promises more than it delivers.

  Record these in `docs/reference/quirks.md` or tighten the wording.

- **n2. Float noise in punten.** `ui/src/editor-live.ts:259`: `String(1.1 + 2.2)` gives
  "3,3000000000000003". Round `totalPunten` (for example `Math.round(n * 100) / 100`) before
  formatting.
- **n3. Dead code.** `ui/src/domain/textdiff.ts:54` `textsDiffer` is used only by its test.
- **n4. Leftover cursor marker in the bundled `main.typ`.**
  `crates/maatwerk-core/assets/templates/opdracht-main.typ:15-16,37` still draws
  `<__maatwerk_cursor>` links (`cursor: false` in every live path). This is understandable,
  because changing it means a `main.typ` release, but say in ADR-0002 section 12 or the backlog
  when it goes (together with `render_assignment_svg`'s marker).
- **n5. Cold restart.** After a restart the fresh session's first compile is cold (World
  reparse, images read again), so a document near the limit is more likely to time out again.
  Worth one sentence in ADR-0002 section 12 or the manual test `M-OPD-*`.
- **n6. `MAX_ABANDONED` wait has no feedback.** `editor.rs:675-680`: while two abandoned
  compiles still run, the coordinator waits without sending an update; the client shows the
  previous timeout message only. Fine, but document it, or send a "wacht op vorige compile"
  update.
- **n7. Pinning of editor methods.** `ui/src/modals/editor.js`: the `maatwerk-editor` allowlist
  forwards any `opdrachtId` from the iframe (`editorOpen`, `restoreProjectFile`,
  `projectFilesStatus`). Core validates the id, so this is not a traversal, but pinning it to the
  `opdracht` the modal opened (as for title/naam) is cheap defence in depth. The update forward
  uses `postMessage(..., '*')`; the frame is same-origin, so `location.origin` is stricter.
- **n8. Diff view memory.** `ui/src/domain/textdiff.ts:24-32`: the full LCS table is O(n·m)
  arrays. Fine for `lib.typ`, but a pasted multi-thousand-line copy makes a large table. Cap it,
  or fall back to "too many differences" above a size.
- **n9. Watchdog tests run the 50M-iteration loop to the end** in the background (debug build:
  many seconds of one core each) while other tests run. They are not flaky with the 400 ms limit
  and the 5 s assertion, but a smaller loop that still takes over 2 s in release would make the
  suite lighter.

## Checklist notes

1. **Parity.** The reference compiled a saved copy with a cursor marker and scrolled to the
   `rtti-cursor:` link (`_reference/renderer/editor-init.js:345-361, 578-585`). The port replaces
   this with typst-ide jumps and adds click to source; both are documented in `docs/parity.md`.
   Autosave stays at 600 ms, as in the reference. The vragen labels match `lib.typ`
   `_vraag_letter`. The `lib.typ` v2 change only adds a dict key, and the commit message justifies
   the migrate golden update.
2. **Correctness.** The UTF-16/byte conversion goes through `Lines` everywhere. The BOM is
   stripped in the editor (n8 of 8a). Diagnostics are clamped. Generation ordering is correct
   inside `LiveEditor`. The open issues are in M1, m1, m2 and m4.
3. **Data safety.** Restore and silent update are both CAS. Saves keep per-file `baseHash`; a
   colleague's write gives the conflict bar, and a pending save is flushed before tab switch and
   restore. Undo after restore saves with the new hash (covered by e2e). I found no lost-update
   path. m3 is only a mislabel.
4. **Security.**
   - `editor_update`/`editor_unset`/help paths go through `rel()` (RelPath) and
     `check_editable` (no `__maatwerk/`).
   - `restore_project_file`/`bundled_project_file` take only `main.typ`/`lib.typ`.
   - The opdracht id is validated.
   - The World sandbox is unchanged. `list_files` skips symlinks and hidden entries and is capped.
   - Hover, vragen and diff use `textContent`. The SVG `innerHTML` is Typst output under a
     strict CSP (no inline script), and links are blocked on click.
   - The postMessage allowlist is a fixed set, with arguments as an array.
5. **Architecture.** OK. Core has no tauri; handlers map types only.
6. **Tests.** The Rust coverage is good. Missing:
   - timeout followed by an error (M1);
   - a query racing a compile (m1);
   - a CAS conflict on silent update (m3);
   - Playwright for a save conflict on `lib.typ`.
7. **Maintainability.** `editor-init.js` is now 1.9k lines (the Step 10 split is planned).
   `editor.rs` is well commented. For dead code see n3 and n4.
8. **Performance.**
   - No blocking calls on the async runtime: queries go through `spawn_blocking`, and the sync
     commands only touch a mutex briefly.
   - Thread growth is capped at two abandoned compiles. See m5 for the query pile-up.
   - `docs/perf.md` shows about 182 ms keystroke to preview, almost all of it debounce plus IPC,
     and a flat working set over 300 edits.

## Triage (implementer, 2026-11-01)

| Finding | Decision                                                                                                                                                                                                                                                                                                                            |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1      | Fixed: the coordinator tracks the client's preview (`ClientPreview`) and seeds the fresh session with its generation and page count; test `after_a_timeout_an_error_keeps_the_preview_and_a_fix_sends_every_page`. Page hashes do not carry over between sessions (tried: they differ), so the first good compile sends every page. |
| m1      | Fixed: `EditorSession::with_restored_buffer` puts the buffer back after complete/hover/definition; test `a_query_leaves_the_session_buffer_as_it_was`.                                                                                                                                                                              |
| m2      | Fixed in the client: a jump answer is used only when no edit was sent since the question and the preview is of the newest generation (`jumpFits`).                                                                                                                                                                                  |
| m3      | Fixed: a lost CAS race re-reads and judges the file again (`project_file_status`, two attempts).                                                                                                                                                                                                                                    |
| m4      | Fixed: a failed restart sets `resend`.                                                                                                                                                                                                                                                                                              |
| m5      | Backlog: cancel abandoned queries; measured queries take milliseconds, so the effect needs a long compile.                                                                                                                                                                                                                          |
| m6      | Not now: the editor iframe has used `window.confirm` since Step 3a (`closeAfterSave`, review 3a M2); both move to the app's own dialog together in Step 10 (backlog).                                                                                                                                                               |
| m7      | Fixed: `editor_open` clears other sessions under the lock when it inserts; the parent closes a session whose editor was closed while it opened.                                                                                                                                                                                     |
| n1      | Backlog.                                                                                                                                                                                                                                                                                                                            |
| n2      | Fixed (points rounded to hundredths in the panel).                                                                                                                                                                                                                                                                                  |
| n3      | Fixed (`textsDiffer` removed).                                                                                                                                                                                                                                                                                                      |
| n4      | Backlog (remove the cursor marker from `main.typ` with a `maatwerk-main 2`, together with the marker of `render_assignment_svg`, Step 10).                                                                                                                                                                                          |
| n5      | Fixed: sentence in ADR-0002 section 12.                                                                                                                                                                                                                                                                                             |
| n6      | Backlog.                                                                                                                                                                                                                                                                                                                            |
| n7      | Fixed: the opdracht methods are only allowed for the modal's opdracht id. `postMessage(..., '*')` to the iframe stays as in the rest of the proxy (the target window is the frame itself).                                                                                                                                          |
| n8      | Backlog.                                                                                                                                                                                                                                                                                                                            |
| n9      | Not changed: the loop must outlast the limit on fast machines; the abandoned threads end with the test process.                                                                                                                                                                                                                     |
