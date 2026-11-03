# Review Step 8a: live compile service

Reviewer: fresh-context subagent, 2026-10-31. Scope: `git diff step-07..HEAD` on
`step/08-editor` (commits `4376cc4..601e5db`), checked against PLAN.md Step 8a, ADR-0002 sections
5, 5a and 12, and Appendix C. I ran `cargo test -p maatwerk-core --lib typst_svc::editor` (12
passed), the parity test `editor_session_patches_equal_the_one_shot_render` (passed, 44 s in
debug), `cargo fmt --all --check`, `cargo clippy -p maatwerk-core --all-targets -- -D warnings`
and `tools/check-spdx.sh`. All were clean. I did not re-run the release `editor_latency` example.
Typst 0.14.2 and comemo 0.5.1 sources were checked for `Source::replace`, `Hash for Source`,
`Lines::byte_to_utf16` and `comemo::evict`.

## Summary

The core mechanism is correct.

- **World:** `MaatwerkWorld` now keeps one slot per file with its origin. `set_file` updates the
  bytes and the parsed `Source` together, using `Source::replace` for an incremental reparse, so
  `file()` and `source()` never disagree. For unchanged files the World returns the same `Source`
  (an Arc clone), which is what comemo expects.
- **Reset:** `reset` re-resolves mounts and drops these slots: missing files, disk files whose
  fingerprint changed, and every disk slot when a mount moved. A dropped slot is reloaded through
  `load_mounted`, so the lexical check, canonicalisation and prefix check apply again after a
  reset. A cached slot always holds bytes that passed the guard when they were read, so the
  sandbox holds.
- **LiveEditor:** the generation and the pending edits are read under the same lock, so a
  compile always includes every edit up to its generation. Results come from a single thread, so
  generations only go up. A compile that is overtaken is followed by a compile of the newest
  generation, so the newest result is always delivered, unless the thread has died (m1).
- **Page diff:** compared against what the client has (`shown`), it handles growing and
  shrinking page counts, `resend_all` while there are errors, and stale compiles (`shown` is left
  alone). The parity test shows that the patched pages equal a fresh one-shot render.
- **Other checks:** the buffer is never written to disk, core does not depend on tauri, new files
  carry SPDX headers, and comments are in English.

There are no blockers and one major. The major is a contract gap: the new service has no answer
for the editor's cursor marker. In 8b, putting the marker into the buffer would shift every
diagnostic position and lose the old "retry without marker" fallback (M1). The minors cover a
sink panic that silently kills the worker, the process-wide comemo eviction, the limits of the
mtime + length fingerprint, perf-doc evidence that is weaker than the claims it supports, and a
timing-dependent live test.

## Findings

### Blockers

None.

### Majors

#### M1. No contract for the cursor marker: diagnostics shift and the "retry without marker" fallback is lost

- **Where:** `crates/maatwerk-core/src/typst_svc/editor.rs:105-110` (`set_file`), `:129-158`
  (`compile`); the old behaviour is in `ui/src/editor-init.js:626-660` (`renderPreview`) and
  `:384-391` (`insertCursorMarker`).
- **Evidence:** the old preview inserts `CURSOR_MARKER` into the text at a safe position. It
  compiles that text, and if the compile fails it compiles again **without** the marker, so a
  marker that breaks the build never shows an error and the preview still updates. It also
  recompiles when only the cursor moves (`scheduleCursorRender`). `EditorSession` only knows
  whole-file texts (`set_file`) and one compile per generation. The perf example and the parity
  test run with `OpdrachtInputs::preview(.., true)` (cursor on) and pass the marked text as the
  buffer. If Step 8b does the same:
  1. `Location.range`, `range_utf16`, `line` and `column` refer to the marked text, not to the
     CodeMirror document. Every diagnostic after the marker, and on the marker's line, is offset
     by the marker length, or by its two extra newlines on a blank line. This undoes the step's
     "structured diagnostics for CodeMirror" deliverable.
  2. A marker-caused error leaves the stale preview in place with an error the teacher did not
     make. The reference showed a correct preview instead (a parity regression).
  3. The fallback compile would need a second generation or a second session.
- **Fix:** decide this in 8a, because 8b builds on this API. The cleanest option is to let the
  session own the marker: `set_cursor(path, utf16_offset)` (or `update(path, text, cursor)`)
  inserts the marker in the core. On failure the session compiles once more without it and
  delivers that result, or the original errors if the unmarked text also fails. Diagnostics in
  that file are mapped back to unmarked positions. At minimum, record the decision and the
  mapping rule in ADR-0002 section 12 and in STATE before tagging `step-08a`.

### Minors

#### m1. A panicking sink silently kills the worker; later updates are accepted but never delivered

- **Where:** `editor.rs:372-374` (`sink(update)` is outside any `catch_unwind`), `:296-301`
  (`close` ignores the join result).
- **Evidence:** the compile itself is wrapped in `catch_unwind`, but the sink is not. If the sink
  panics (8b: a Tauri emit or serialisation `expect`), the worker thread unwinds and ends.
  `update`/`refresh`/`resend_all` still return fresh generations, and no compile ever runs again.
  The editor preview freezes with no error, and `close()` discards the `Err` from `join`.
- **Fix:** wrap the `sink` call in `catch_unwind`, log it and keep running. Or set
  `state.closed` and expose an `is_alive()`/error event so 8b can restart the session. Add a test.

#### m2. `comemo::evict(10)` is process-wide: the editor's cache and batch compiles evict each other

- **Where:** `crates/maatwerk-core/src/typst_svc/compile.rs:53`; `docs/perf.md:188-189`.
- **Evidence:** comemo 0.5.1 `evict(max_age)` ages **every** memoised entry in the process and
  also clears all accelerators (`memoize.rs:100-106`, `accelerate.rs:24-33`). While a class batch
  runs (about 30 compiles across 2-4 threads) or the opdracht list compiles previews, each of
  those compiles ages the editor's entries. After about 10 of them the editor's incremental
  layout falls back to a near-cold compile (about 60 ms instead of 4 ms per the table), and each
  editor keystroke ages the batch's entries in turn. This is not a correctness problem, but the
  perf doc's "comemo is evicted after every compile" and the budgets assume the editor is the only
  user.
- **Fix:** note it in `docs/perf.md` and ADR-0002 section 12. Optionally evict less often in the
  editor, for example only when it is idle or every N compiles, and measure the editor during a
  running batch in 8b.

#### m3. The mtime + length fingerprint misses some changes, and there is no way to force a re-read

- **Where:** `crates/maatwerk-core/src/typst_svc/world.rs:128-137` (`Fingerprint`), `:203-217`
  (`reset`); `editor.rs:281-284` (`refresh`, "e.g. after an image was added").
- **Evidence:** a disk file is re-read only when `(modified, len)` changes. These cases are
  missed: a same-length rewrite within one timestamp tick (FAT32 2 s, exFAT 10 ms, SMB shares;
  NTFS keeps 100 ns but the clock behind it often advances in coarser steps); tools or sync
  clients (OneDrive) that restore the original mtime on a same-length file; and a retargeted
  symlink or junction, because the fingerprint is taken on the canonical **target** path, not on
  the path Typst named. `LiveEditor::refresh` runs the same check, so it cannot force a re-read.
  The editor's own "Afbeelding overschrijven" flow (`saveNamedImage(true)`, Step 8b) writes a new
  file at the same path, and the app knows that path.
- **Fix:** add `MaatwerkWorld::invalidate(path)` (and `LiveEditor::refresh_file(path)` or
  `refresh_hard()`), which drops the slot unconditionally, and call it from the app's own image
  and file writes. Record the remaining hole (external same-length edits within one tick) in
  `docs/reference/quirks.md` or ADR-0002 section 12. Optionally add a cheap content hash for small
  `.typ` files.

#### m4. Perf doc: the one-shot column and the memory claim do not match what the example measures

- **Where:** `docs/perf.md:170-189`; `crates/maatwerk-core/examples/editor_latency.rs:83-94`.
- **Evidence:** the example renders only `edits.min(50)` one-shot compiles, but the table lists
  "Edits 200/2000" on rows that include the one-shot total, and the setup text says it "renders
  the same edits". The memory claim ("2000 edits peak no higher than 200") rests on the peak
  working set of the **whole** process run, one-shot phase included. That phase builds 50 fresh
  Worlds and full SVG sets and can dominate the peak, which hides slow growth in the session
  phase. The numbers are also noisy (80 MiB at 200 edits, 57 MiB at 2000). The only automated
  check (`a_long_session_holds_no_more_files`) counts World slots, not comemo or document
  memory.
- **Fix:** state "one-shot: first 50 edits" in the table. Print the process working set (or
  allocator stats) right after the session phase, ideally at 200, 1000 and 2000 edits, before the
  one-shot phase starts. Then base the "flat memory" budget on those numbers.

#### m5. `live_updates_within_the_debounce_give_one_compile_of_the_latest_text` depends on timing

- **Where:** `editor.rs:592-613`.
- **Evidence:** the test assumes that five `update` calls finish within the 300 ms debounce
  (asserting `generation == 5` exactly) and that nothing else arrives within 600 ms. `cargo test`
  runs the heavy debug Typst tests in parallel (the parity test alone takes 44 s), so a starved
  test thread can let an intermediate compile through, for example generation 3. The test would
  then fail on generation 3, or later on the "one compile" check. `live_results_never_go_back…`
  and `dropping_the_handle…` are robust.
- **Fix:** make coalescing deterministic. Use a sink that blocks on a channel or barrier while
  delivering generation 0, queue the five updates while the worker is blocked, then release it
  and assert one compile of generation 5. Or loop until generation 5 and assert only that the
  last update carries the latest text.

#### m6. Untested paths: compiler panic, close during a compile, resend overtaken by a newer update

- **Where:** `editor.rs:361-365` (panic → `failed`), `:366-370` (close after compile), `:357-359`
  with `:135-137`.
- **Evidence:** no test drives the panic branch. That branch should prove that the preview is
  kept, the thread keeps running and the next update compiles. No test covers `close()` while a
  compile runs, and none covers `resend_all` followed by an update that makes that compile stale
  (by reading the code, the next delivered update still sends every page, which is correct, but
  nothing pins it).
- **Fix:** add a test-only hook to force a panic (for example a `cfg(test)` closure in the
  session, or a World file that triggers a known Typst panic, if one exists). Add a LiveEditor
  test with `resend_all()` immediately followed by `update()`.

### Nits

#### n1. STATE says 13 editor tests; there are 12

- **Where:** `docs/STATE.md:20`. `cargo test … typst_svc::editor` runs 12.

#### n2. After a panic in the SVG render, `failed()` reports a `preview_generation` the client never received

- **Where:** `editor.rs:138-147`, `:161-172`. `document` and `preview_generation` are set before
  `changed_pages`. If `typst_svg::svg` panics, `failed()` reports the new `preview_generation`
  while `shown` and the client still have the old pages. Later compiles still diff correctly
  against `shown`. Fix: set both fields after the render succeeds, or restore them in the panic
  branch.

#### n3. `close()` can hang on a blocking sink and deadlocks if called from inside the sink

- **Where:** `editor.rs:295-301`. `close` joins the worker. If the sink blocks (a full bounded
  channel in 8b) `close` hangs, and if the sink calls `close` itself the thread joins itself.
  Fix: document "the sink must not block or call close", or join with a timeout and detach.

#### n4. `set_file` can shadow internal files and has no way back to the disk version

- **Where:** `editor.rs:105-110`, `world.rs:182-197`. Any `RelPath` is accepted, including
  `__maatwerk/…` (the generated wrapper and data). That is harmless today because it only affects
  this preview. There is also no `unset_file`: once `lib.typ`/`main.typ` are buffered (ADR-0002
  5a lets teachers edit them), "Herstel standaardversie" on disk stays shadowed for the rest of
  the session. Fix: reject the `INTERNAL_DIR` prefix in `EditorSession::set_file`, and add
  `unset_file` for 8b.

#### n5. One moved mount drops the disk slots of every mount

- **Where:** `world.rs:203-217` (`moved` is a single flag). Creating the `images/` folder also
  drops `opdracht.typ`/`lib.typ` slots from other mounts. Only performance is affected. Fix: track
  `moved` per mount and drop only the slots under that mount's root.

#### n6. The stale check runs only before the SVG render, the dominant cost

- **Where:** `editor.rs:135`, `:176-195`. SVG is about 14 of 20 ms per edit, and much more for
  pages with photos. Checking `stale()` between pages in `changed_pages` would drop overtaken
  work sooner. This must leave `shown` consistent (update it only for the pages rendered, or
  abort without changing it).

#### n7. `document()` spans can point into newer sources after failed compiles

- **Where:** `editor.rs:117-120` ("for jumps between source and preview, Step 8b"). After an
  error, the kept document's spans belong to an older `Source`. `Source::replace` keeps spans
  outside the reparsed range, but inside it an old span can resolve to a different node or to
  none. 8b should only jump when `preview_generation == generation`, or keep the `Source` that
  goes with the document.

#### n8. `range_utf16` is relative to the BOM-stripped text

- **Where:** `diagnostics.rs:23-33`. If 8b loads a file that starts with a BOM into CodeMirror
  as is (U+FEFF kept), every offset is one unit off. Note in the doc comment that the editor
  must strip the BOM, or add the BOM length when it is present.

## Checklist (Appendix C)

- **Parity:** SVG pages equal path C, and patches equal a fresh render. The cursor-marker
  fallback has no equivalent yet (M1).
- **Correctness:** World reset/set_file, generation accounting and the page diff are correct.
  Gaps are the sink panic (m1) and the fingerprint limits (m3).
- **Data safety:** the buffer is never written, and only reads happen.
- **Security:** path guards apply again on every reload after a reset. Cached slots hold only
  bytes that passed the guard. `set_file` takes a `RelPath`.
- **Architecture:** core stays tauri-free, and work runs on its own thread, not the async
  runtime. The missing compile timeout and cancellation (ADR section 5) is openly recorded as a
  deviation for the user in section 12.
- **Tests:** good coverage of the session. One live test is timing-dependent (m5), and the panic
  and close paths are untested (m6).
- **Maintainability:** clear and small, with accurate doc comments apart from n1 and n7.
- **Performance:** the numbers are plausible and the latency budgets are met. The memory
  evidence is weak (m4), and other compiles in the process can undo the comemo reuse (m2).

## Triage (implementer, 2026-10-31)

| Id    | Decision                                                                                                                                                                                           | Where                   |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| M1    | Decided and recorded: the live session compiles the buffer as typed, no cursor marker (diagnostic positions match CodeMirror); source <-> preview sync via `typst-ide` jumps in 8b (PLAN Step 8b). | ADR-0002 section 12     |
| m1    | Fixed: the sink runs under `catch_unwind`; `close()` logs a join error. Test `a_panicking_sink_does_not_stop_the_thread`.                                                                          | `editor.rs`             |
| m2    | Documented in `docs/perf.md`; fix after measuring in the app.                                                                                                                                      | perf, backlog           |
| m3    | Fixed: `LiveEditor::refresh` / `EditorSession::reload_disk_files` drop every disk file. Test `reload_reads_a_disk_file_the_fingerprint_misses`.                                                    | `editor.rs`, `world.rs` |
| m4    | Fixed: the perf text says the one-shot column covers 50 edits and what the peak covers.                                                                                                            | `docs/perf.md`          |
| m5    | Fixed: 2 s debounce in that test.                                                                                                                                                                  | `editor.rs`             |
| m6    | Partly: `a_resend_overtaken_by_a_newer_update_still_sends_every_page`, sink panic; compiler panic and close during a compile: backlog.                                                             | `editor.rs`, backlog    |
| n1    | Fixed (15 tests now).                                                                                                                                                                              | `docs/STATE.md`         |
| n2-n8 | Backlog (n4, n7, n8 belong to Step 8b).                                                                                                                                                            | backlog                 |
