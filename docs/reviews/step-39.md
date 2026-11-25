# Review: step 39, v1 removal and Typst 0.15.1

Reviewer: fresh-context subagent, 2026-11-25. Scope: `git diff step-38..HEAD` on
`step/39-v1-removal-typst` (`22101a1`..`b039aa4`, 37 commits). Checked against PLAN-2 step 39,
CLAUDE.md, `docs/backlog.md` and ADR-0002 5a. Mostly read-only. I ran one script (below) to check
the golden conversion; I did not rerun cargo, Vitest or e2e (the local gate was green at
`b039aa4`).

Scope coverage: 39a (v1 migration, `opdracht_v1`/`v1_opdracht_id`/`Mount::file`, harness and
shims) and 39b (Typst 0.15.1, 5a m3, 5a n8, 5b n2, 5b n4, 6a, 8a m2/m6/n2/n5/n6, 8b m5/n1/n6/n8)
all have commits. Plan deviations that STATE records as "tell the user": `render_assignment_svg`
kept, 8b "Jumps after an error" not done, quick-xml ignores still in `deny.toml` (citationberg),
and `maatwerk-lib 3` (M1 below).

What I verified and found sound:

- **Golden conversion is faithful.** I ran the deleted `tools/fixtures/to-current.mjs` (from
  `step-38`, with the step-38 templates) over every old `tests/golden/logic/*.json`. Then I
  compared: (a) `filesToCurrent(old data case)` against the new `data` case; (b) the score-writes
  `sequence` files through the old `filesToV2` path (what `v2File` did in the test) against the
  new outputs; (c) every other case byte for byte. Everything is identical except one deliberate
  difference, which the commit message states: the 10 `opdrachten/op-N/{main,lib}.typ` copies are
  left out of `opdrachten.json` (n6). No output changed. The structure test in
  `tests/golden/logic.test.mjs` guards string ids, `"N"` for null, the students wrapper,
  `schema_version` 3 and the absence of v1 paths. The Store and grade-crate tests compare against
  the same expectations as before, now without a converter in between. I found no test that
  silently tests less, apart from the reference-rerun test, which went with the harness by
  decision 88.
- **Release hashes.** The fixtures `lib-v1/v2.typ` and `main-v1/v2.typ` hash to the **old**
  table values under the old normalisation (BOM + CRLF only): `e340d2…`, `47a3c6…`, `7b59d7…`,
  `46159e…`. `lib-v2.typ` is byte-identical to the step-38 `lib.typ`. So the recomputed rows in
  `assets.rs:55-68` are anchored to the real released texts.
- **`PdfMerger` vs `pdf_merge`.** The loop body is moved without a change in logic. `new_key`
  (previous part's key differs) and the error `index` (= job index, because the merge never
  skips a job) are unchanged. `pdf_merge` is now a wrapper around the merger, and the test
  `n2_merging_as_jobs_finish_gives_the_same_pdf` compares bytes with duplex padding and
  out-of-order completion.
- **Batch merge cursor.** `next` and the merger only change under the `merge` mutex. The PDF is
  `mem::take`n out of its slot before the push, so no job is merged twice. A result that arrives
  while another worker holds the lock (`WouldBlock`) is picked up by the next `advance` or by the
  final `advance` after `thread::scope` (`batch.rs:228-230`), so nothing is left unmerged. Lock
  order is safe: a worker drops its `results[i]` lock before `try_lock`, and `advance` drops the
  slot lock before `push`. A failed or skipped job stops the merge. This matches the old
  behaviour (the batch fails, no PDF needed).
- **Editor `compile` restructure.** In both branches the new `shown`, `document`,
  `preview_generation` and `current` are committed only after `changed_pages` returns `Some`.
  After a stale stop or a render panic (caught in `compile_jobs`), the session still describes
  the old preview. `current` set to false before a stale return in the error branch is correct
  (the sources are the new, failing text). The new tests cover n2/n6, m5, m6 and the
  `abandoned` count.
- **Thread-local eviction flag.** It is set only on batch worker threads, which run
  `render` → `compile_document` on that same thread. A drop guard restores it after a panic
  (tested). The editor thread and other callers keep evicting after each compile.
- **Moved mounts (8a n5).** Slot paths are canonical, and mount roots must be canonical because
  of the `starts_with(root)` check in `load_mounted`. So `path.starts_with(old)` drops exactly
  the moved mount's files.
- **v1 refusal.** Core `migrate` refuses a non-empty v1 folder before it writes a backup, and
  `decision_88_a_v1_folder_is_refused_and_left_alone` checks that nothing changed. The UI routes
  `needs_migration` with `found: "1"` (a string, `src-tauri/src/error.rs:129`) to the startup
  error with the 0.29 advice. An empty folder with `desktop.ini` never reaches `migrate`
  (`check_schema` sees no v1 markers). No code references `opdracht_v1`, `v1_opdracht_id`,
  `Mount::file`, `to-current`, `to-v2`, `reference-harness` or `reference-shims`, apart from docs
  (n2).
- **Sandbox.** Typst 0.15 rejects `..` above the root when it builds the path, and it rejects
  backslashes. `vpath_parts` still refuses `C:`. `load_mounted` still goes through `RelPath` plus
  a canonical `starts_with`. The 5a m3 eval worlds have no mounts.
- Layering: no `tauri` in core. `EditorUpdateEvent.abandoned` is only mapped in the handler.
  The `abandoned` pill text is built from a number, so the spinner's `innerHTML` takes no user
  data.

## Blockers

None.

## Majors

**M1. `maatwerk-lib 3` silently changes the printed output of existing opdrachten, can give
duplicate vraag labels, and was decided without the user.**
`crates/maatwerk-core/assets/templates/lib.typ:160-167, 221`, `project.rs:175-190` (silent
update), STATE "Choices made without the user".

`check_project_files` replaces an unmodified `lib.typ` 2 with lib 3 in the shared folder when
the editor opens the opdracht. With lib 3, a vraag after an opgave has `opgave: 0`. That marker
feeds `_vraag_letter` (the letter printed next to the vraag) and `_antwoorden` (the answer key),
so it changes what gets printed, not only the editor's check. Worked examples from the code:

- `#opgave[#vraag[..]] #vraag[..]`: lib 2 prints "a"/"b" and the key "1a 1b". Lib 3 prints no
  letters and the key "1" and then "0" on its own line.
- Two vragen before the first opgave, `#opgave[#vraag[..]]`, then one vraag after it. The
  `_vraag_ctr` values of the opgave-0 vragen are 1, 2 and 2, because the counter is reset only
  inside an opgave and the vraag after it continues at 1+1. Lib 3 labels them "0a", "0b", "0b":
  a **duplicate** label in the answer key and in the editor's vragen list. Lib 2 gave "0a 0b"
  and "1a 1b", with no duplicates.

So re-printing an existing opdracht gives a different sheet or answer key than the copies
students already have, and the old lib 2 is overwritten in the colleague-shared folder. CLAUDE.md
says to stop and ask for output changes and for anything hard to undo. STATE lists this as a
choice to "tell at the end", which is after the fact. The Typst goldens did not catch it because
no fixture has a vraag outside an opgave.

Fix: ask the user before release. Options: (a) keep lib 2's numbering and flag the case only in
the editor check (a vraag after an opgave is outside it for `vragen.rs`, but lib.typ prints it
as before). This needs a separate marker field, for example `in_opgave: bool`, next to the
unchanged `opgave`. (b) Keep lib 3 but restart `_vraag_ctr` when an opgave ends, so opgave-0
labels cannot collide, and add a golden with vragen before, between and after opgaven. Both
need a lib version bump and the user's OK for the silent update.

## Minors

**m1. Batch cache eviction every 8 jobs keeps about 80 jobs of memoised entries, not 8.**
`batch.rs:271-273` (comment), `batch.rs:215`, `compile.rs:79`. `comemo::evict(10)` drops
entries unused in the last 10 _evictions_. With one eviction per 8 jobs, a per-student entry
lives about 80 jobs, against about 10 before. The comment ("the cache holds about this many
jobs' entries at most") is wrong, and the peak memory of a class batch can grow roughly 8x.
`evict()` also runs while the `done` lock is held, so the other workers block on their progress
step for the length of an eviction. Fix: measure the peak RSS of a `school`-fixture batch before
and after the change. Consider `comemo::evict(2)` in the batch (or evict every 2-3 jobs), fix
the comment, and call `evict()` after dropping `done`.

**m2. Typst 0.15 rejects backslashes in paths, an undocumented parity change for teacher
sources.** `typst-syntax-0.15.1/src/path.rs:624` ("path contains backslash"). Before, on
Windows, `#image("images\\figuur.png")` compiled (0.14 `VirtualPath` split on `\` there, as the
reference CLI did). It now fails with "path contains backslash". Other 0.15 language changes
can break hand-edited `opdracht.typ`/`lib.typ` copies in the same way. Fix: record this in
`docs/reference/quirks.md` and the 0.30 release notes. Optionally, scan the user's (synthetic)
`school` fixture opdrachten for `\\` in path strings.

**m3. Timing-dependent editor tests.** `editor.rs:1337-1351`
(`review_8b_m5_a_query_given_up_on_does_not_run`) assumes that the slow query is queued within
50 ms. If the spawning thread is late (a loaded CI runner), the quick query runs first, returns
`Some`, and the test fails. `editor.rs:1414` (close within 2 s) is safer but still clock-bound.
Fix: let the slow query signal (a channel or barrier) when it has started, then send the quick
one.

**m4. `docs/specs/storage-spec.md` still describes itself as executable in CI.** Lines 3-8 say
each row is a test in `tools/reference-shims/storage.test.mjs`, which was deleted in `f476689`.
`docs/testing.md:212` notes the removal, but the spec header does not. Fix: mark it as history
(as `parity.md`), or say where the rows are now covered (the Rust storage tests).

## Nits

**n1. The poisoned-lock recovery in the batch worker cannot help.** `batch.rs:207`. The `merge`
mutex is only poisoned by a panic inside `advance` (for example lopdf on a malformed PDF). That
panic is outside `catch_unwind`, so `thread::scope` re-panics `run_batch` anyway, and the
recovered state has its PDF already taken. Either catch the panic around `merger.push` and turn
it into `MergeError`, or drop the poisoned branch and add a comment.

**n2. `PdfMerger::push` mutates before it can fail.** `pdf_merge.rs:83-104`. The duplex blank
page and `last_key` are updated before `Document::load_mem` can fail. That is harmless today
(the batch drops the merger on the first error), but the type is public. Fix: document "after
an error the merger is unusable", or load first.

**n3. The `abandoned` count in the pill can be stale.** `ui/src/editor/status.ts:103`. The
count comes from the last update. When an abandoned compile ends between updates, the next
"Compileren… (1 eerdere compilatie loopt nog)" is wrong until the next update arrives.
Acceptable. Mention it in the comment, or send a small update when the count drops.

**n4. 5a m3 can blame a text that only fails on its own.** `rapport.rs:221, 256`. The eval
world has no `/data/afbeeldingen` mount. A teacher text with `#image("/data/afbeeldingen/…")`
works in the rapport but fails alone. If the rapport fails for another reason, the hint then
names that text. Fix: give `eval_world` the same mounts as `rapport_world`.

**n5. `number()` also accepts `"1e3"` and `" 2 "`.** `vragen.rs` `number`. `str::parse::<f64>`
reads exponents, so `punten: "1e3"` counts as 1000 without a check. Rare. Restrict it to
`^\d+([.,]\d+)?$` if that matters.

**n6. The `opdrachten.json` golden data has opdracht folders without `main.typ`/`lib.typ`.**
This is deliberate (the commit says so) and the domain tests don't need them. But the case is
not a complete current-format folder, so a future test that compiles from it will fail
confusingly. Add one line to the golden's description or to `docs/testing.md`.

**n7. `render_assignment_svg` stays** despite PLAN-2 39a. STATE records why (id-based, used by
the step 34b and AI previews). Make sure the user hears it in the end-of-step report together
with M1, "Jumps after an error" and quick-xml.

## Summary

0 blockers, 1 major, 4 minors, 7 nits. The v1 removal is complete and clean. The golden
conversion is byte-faithful to the old converter (verified by script). The Typst 0.15 port,
`PdfMerger` and the batch merge cursor are correct. The editor restructure keeps the session
consistent. The one major (M1) is a product decision: lib 3 changes printed vraag letters and
answer-key labels of existing opdrachten through the silent update, and can produce duplicate
labels. It needs the user's OK, or a lib 3 that leaves printing alone.

## Triage (implementer)

- **M1 fixed** (`a3b453b`): lib 3 prints as lib 2; the marker keeps lib 2's `opgave` and adds
  `in_opgave`, which only the editor check reads. lib 3 was not released yet, so its release row
  was replaced. Test `review_39_m1_lib_3_prints_what_lib_2_printed` renders both libs to
  identical SVG for vragen before, in and after an opgave, with the answer list.
- **m1 fixed:** the batch evicts every 4 jobs (about 40 jobs' entries; a 30-job batch ages the
  editor 8 steps), comment corrected, eviction outside the `done` lock.
- **m2 fixed:** quirk T34 in `docs/reference/quirks.md`; release notes name it.
- **m3 fixed:** the slow query signals that it started.
- **m4 fixed:** `docs/specs/storage-spec.md` marked history.
- **n4, n5 fixed** (image mount in the check world; punten strings digits and one separator).
- **n6 fixed:** `docs/testing.md` says the converted `data` cases have no `main.typ`/`lib.typ`.
- **n1, n2, n3** to `docs/backlog.md` ("From Step 39"). **n7:** in the end-of-step report.
