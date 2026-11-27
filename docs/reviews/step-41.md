# Review: step 41, data and storage robustness, `rapporten/` cleanup, edit locks

Reviewer: fresh-context subagent, 2026-11-27. Scope: `git diff step-40..HEAD` on
`step/41-data-robustness` (`7f47012`..`c3cb291`, 33 commits, 113 files). Checked against PLAN-2
step 41, `docs/reference/edit-locks.md` sections 5 and 6, CLAUDE.md and the backlog ids the step
names. Read-only: I ran no builds or tests. The findings below come from reading the code, with a
trace through the code for each one. Nothing was confirmed by running it.

**Counts: 0 blockers, 3 majors, 7 minors, 11 nits.**

The core guard design is sound. The guards run under the commit lock, read the old file once,
scan only when a locked field changed, and fail closed with a Dutch `edit_locked` message. The
weak points are where the UI meets the guards:

- The test editor normalises family fields that legacy exams lack, so the new family rule
  refuses ordinary herkansing work (M1).
- A half-done `save_exam_family` leaves stale revs in the cache (M2).
- Three Store delete functions ignore the core's refusal and report success (M3).

The mock does not mirror the family rule. That is why no e2e test caught M1.

## What I verified and found sound

- **Guard hook.** `Storage::write_json` runs `locks::guard_write` inside
  `commit_bytes_checked`'s closure, after the rubric guard and under the commit lock.
  `Storage::delete` runs `guard_delete` after `acquire`. `write_text` is limited to
  `opdrachten/<id>/*.typ` (`commands.rs:256`) and `write_bytes` to images and PDFs, so no
  guarded JSON path can be written around the guard from the UI. Score files are `Kind::Other`
  (four path segments), so score entry pays nothing.
- **Fail closed.** Every listing and read in `locks.rs` maps errors to `unreadable(...)`. The
  UI's `examHasScores` returns `true` on error (`store.js`). Leerlingen blocks every delete when
  `studentsWithDataAnyYear` fails. `groep-edit.js` asks when `studentsWithData` fails. The PO
  form locks through `examHasScores`.
- **has_data parity.** `locks::has_data` and `domain/has-data.ts` agree: a non-empty
  `scores[exam]` object (`"N"` and in-memory `null` count), a non-null override, a non-empty
  `observations` array, and a non-empty `po` object.
- **`unlocked` for restore.** It is used only by `snapshots::restore_file` (`snapshots.rs:583`).
  It is thread-local and reset by a `Drop` guard. The rubric guard still applies, as before.
- **Migration, copy to sectie, PO herkansing.** Migration writes through its planner, not
  `write_json`. `copy_to_sectie` writes `opdrachten/` (unguarded). `openPoResitModal`
  (`po-groepen.ts:479`) clones the parent, so the family check passes.
- **Rubric scope (decision 9).** `scope_in_use` drops only what no linked PO has. A rubric's
  schoolsoort can never be empty (`maatwerk-grades::rubric` refuses it), so the "empty = all"
  edge does not arise here.
- **Group import (D34).** The CSV import writes groups with `student_ids: []`, which the
  "emptying write is free" rule allows.
- **Storage items.**
  - `read_retrying` retries only sharing errors, with tests.
  - Lock errors name `rel`, not the local lock path.
  - `QueueSlot` removes idle queue entries under the map lock.
  - Lossy UTF-8 is now used for both folder readers.
  - `CorruptJson.hash` lets the RTTI template overwrite replace exactly the unreadable bytes
    after a confirm (`rtti-uitleg.ts`).
- **Snapshots and startup.** The claim is released when the settle wait is stopped (`Stop`
  condvar). `set_closing` covers a quit before the core opens. `Core::broken` is the last-resort
  fill. `list_snapshots` returns the kind from the core.
- **Store 7c.** `load` re-reads a file that changed during the read (up to 3 times).
  `preloadScores` does not cache entries that changed during the folder read. Both have Vitest
  cases.
- **Security.** New user-visible text goes through `esc`/`escHtml`: `confirmDialog` escapes its
  message, and `persistentError` escapes. The rapporten card uses `replaceChildren`. CLI output
  goes through `plain()`. The image import has a size cap before reading and decode limits.
- **Grade numbers.** I found no new grade formula. `highestEntered` is a raw maximum of entered
  points, and `formatSize` and `kb` are file sizes.
- **SPDX.** `check-spdx.sh` now covers `*.toml`, `*.yml` and `*.yaml`. The workspace and crate
  manifests, `deny.toml`, `rustfmt.toml`, `rust-toolchain.toml` and `ci.yml` have the header.

## Blockers

None.

## Majors

**M1. The test editor writes family fields that legacy exams lack, and the new family rule then
refuses herkansing creation and editing.**

- Where: `ui/src/modals/toets-edit.ts:211-212`, `:447-452`, `:468-487`;
  `crates/maatwerk-core/src/locks.rs:288-295`, `:495-516`, `:619-629`.
- `showExamEditor` with `lockTopFields` builds the top fields from fallbacks:
  `weging = exam.weging ?? 1` and `wegingSe = exam.weging_se ?? exam.weging ?? 1`. It also uses
  `kindFields(...)`, which always sets `type` (`'regular'`) and sets `weging` to 0 for a
  diagnostic exam. The editor writes these back. `weging_se` is optional in the data: the
  `school` fixture leaves it out on purpose for every second exam
  (`tools/fixtures/generate.mjs:500`, a PTA exam), and `migrate/v3.rs` adds only `kind` and
  `diagnostic`. `locks::same` treats `Some(1)` vs absent as different (`_ => a == b`).
- The consequences, for an original without `weging_se`:
  1. **Nieuwe poging** (`herkansing.ts:143-162` -> editor -> `upsertExam`). The new attempt has
     `weging_se: <weging>` and the root has none. `guard_family_member` (old = `None`) refuses
     with "weging SE hoort bij de verzamelkaart: pas het daar aan". The teacher changed nothing
     there.
  2. **Editing an existing attempt** (questions, n-term). `weging_se` goes from absent to set,
     differs from the root, and is refused the same way.
  3. **Editing the original's questions or observaties while it has attempts**
     (`saveExamFamily`). The original gets `weging_se` but the attempts are passed without
     `top`. `save_exam_family` refuses with "Niet opgeslagen: de pogingen verschillen in
     weging SE."
- The same happens for an exam without `weging` or `type`, and for a diagnostic exam with a
  stored non-zero `weging`.
- The workaround is to save the verzamelkaart once (it writes `shared` on every member), but
  nothing tells the teacher that. The mock does not run the family rule for single writes
  (`mock-locks.ts:5-7`), and the core tests always set `weging_se` on both sides
  (`locks/tests.rs:180`), so nothing caught it.
- Fix (any of these):
  - With `lockTopFields`, copy the family fields from the exam unchanged (absent stays absent)
    instead of rebuilding them from `kindFields` and the fallbacks, and pass the same fields to
    the attempts in the family save.
  - Or make the family comparison treat an absent `weging_se` as `weging` (the reading rule),
    and an absent `type` as `'regular'`.
  - Add a core test with a root that lacks `weging_se`, plus an e2e case on the fixture's PTA
    exam.

**M2. A family save that fails partway leaves the attempts written and the cache on the old
revs, so every later save of that family conflicts.**

- Where: `crates/maatwerk-core/src/locks.rs:577-658`, `ui/src/store.js:766-790`.
- `save_exam_family` writes the attempts one by one and the original last. Each write has its
  own `_meta.rev` check, and nothing checks all revs, or runs the per-member guards, before the
  first write.
- When the original's write fails (a colleague changed it: `Conflict`; or an `edit_locked`
  refusal on the original only, such as a removed question with data), the attempts are already
  on disk with the new fields and revs. `Store.saveExamFamily` caches nothing on error
  (`saved` is only set on success), and the watcher does not echo own writes. The cached
  attempts therefore keep their old `rev`.
- The next save of the family, from the same editor, after "Sluit het venster en open het
  opnieuw", or from the verzamelkaart, conflicts on the first attempt. That lasts until the
  year is reloaded.
- The doc comment's "a failure halfway leaves the original as it was, so saving again repeats
  it" does not hold for the UI. The step 40 code it replaced cached each attempt after its own
  save, so a retry did work.
- Meanwhile the family disagrees on disk: the attempts have the new weging or periode, and the
  original has the old values.
- Fix:
  1. In the core, read every member first and refuse the whole family before writing anything
     when a rev is stale. Ideally also run the member guards in a dry pass.
  2. In the Store, on any error from `saveExamFamily`, invalidate
     `${year}/exams/${subject}` (or re-read the family's files) so a retry starts from disk.
- Add a test: a conflict on the original after the attempts are written, then a second save
  succeeds.

**M3. A delete that the core refuses is shown as done: `Store.deleteExam`, `deleteGroup` and
`deleteObservation` ignore the `FsResult`.**

- Where: `ui/src/store.js:700-713`, `:812-820`, `:977-982`; callers
  `ui/src/screens/observaties.ts:50-56`, `ui/src/modals/toets-edit.ts:526-528`,
  `ui/src/modals/groep-edit.js:461-467`.
- `window.maatwerk.deleteFile` does not throw: Tauri maps errors to
  `{ ok: false, reason }` (`tauri-api.ts:253-256`, `fsFailure`), and the mock does the same
  (`mock-api.ts:509-525`). All three Store functions `await` it and carry on. They call
  `changed()`, drop the item from the cache, and the caller toasts "Observatie verwijderd." /
  "Toets verwijderd." / "Groep verwijderd.".
- The core backstop exists for exactly the cases the UI cannot see:
  - an observatie linked by a test in a year that is not loaded, or by an opdracht or rubric a
    colleague added since the list rendered (the UI check is cache-based:
    `obsIsUsedInAnyExam`);
  - a score a colleague entered between `examHasScores` and the confirm;
  - an unreadable file (fail closed).
- In each case nothing is deleted, but the item disappears from the screen until the next
  reload, and the teacher believes it is gone. `deleteRubric` (`store.js:1013`) does check the
  result.
- Fix: throw `saveFailed(relPath, r.reason)` when `!r.ok`, as `deleteRubric` does, so the
  `unhandledrejection` handler shows the core's text. Add one e2e test per delete with the mock
  refusing.

## Minors

**m1. Observatie bewerken and the mock lock less than the core when the saved scope list is
empty.**

- Where: `ui/src/domain/obs-locks.ts:66-70`, `ui/src/bridge/mock/mock-locks.ts:205-213`,
  `crates/maatwerk-core/src/locks.rs:789-791`, `:930-961`.
- An empty `jaarlagen` or `schoolsoort` means "all" in the core (`allows`). Narrowing `[]` to
  `["4"]` while a linked rubric has `jaarlagen: ["3"]` produces a new misfit, and the core
  refuses it. `obsLockedValues` filters `initial.jaarlagen` (empty), so no chip is locked. The
  teacher can make the change and only then gets "Niet opgeslagen: ...". The mock uses the same
  function, so it allows what the core refuses. This is drift (a).
- Fix: when `initial` is empty and a link uses values, either lock "nothing selected" (refuse
  the first selection that leaves out a used value) or pre-select the used values. Use the same
  rule in `mock-locks.ts`, and add a parity case to `obs-locks.test.ts` and
  `locks/tests.rs`.

**m2. The mock's lock copy has more drift than its header admits.**

- Where: `ui/src/bridge/mock/mock-locks.ts`.
- The header lists only the family rule and fail-closed paths as not mirrored. Also missing:
  - the toetstype rule (core `misfits` adds "toetstype Toets" / "toetstype PO";
    `guardObs` has no toetstype check);
  - deleting `students-<year>.json` (the core always refuses, `locks.rs:184-187`; the mock
    returns `null` for `next === null`, `:229`);
  - `studentsWithData` (`:42`) only walks `nat`, `bio`, `schk` and `wi`, while the core lists
    every folder under `scores/`;
  - `saveExamFamily` without the family checks (`mock-api.ts:990`).
- Because of these gaps, M1 and the family refusals cannot be shown in e2e.
- Fix: mirror the family rule (single write and `saveExamFamily`), the toetstype rule and the
  students delete, list the vak folders, and update the header.

**m3. The exam guard reads the new `subject` for its has-data checks, and a scored exam's vak
is not locked.**

- Where: `crates/maatwerk-core/src/locks.rs:420-424`, `:452-478`, `:567`.
- `vak_of` prefers `new.subject`. A write that moves an exam to another vak and removes a
  question checks `scores/<new vak>` (empty) and passes. The PO scope check reads the wrong
  folder the same way. Moving a scored test to another vak is not guarded at all, and doing so
  orphans every score file (scores live under `scores/<vak>/`). Edit-locks 2.3 calls the vak a
  UI-only lock ("not in the edit form"), which decisions 1-7 say the core must enforce too.
- Fix: use the old file's `subject` for the data checks, and refuse a `subject` change of an
  exam with data. Add a test.

**m4. `save_exam_family` lets an attempt gain observaties, and checks the family outside the
commit lock.**

- Where: `crates/maatwerk-core/src/locks.rs:609-636`.
- Decision 5 and plan item 5 say an attempt "may keep its own older ones, never gain new ones".
  The family save only checks that each attempt contains the original's observaties. With
  `FAMILY` set, `guard_family_member` is skipped, so nothing refuses an attempt whose `obs_ids`
  gains an id that neither the original nor the attempt's file had.
- `attempts_of` and the agreement check also run before any commit lock is taken. Two writers
  on this PC can interleave: for example, a new attempt created by another command between the
  check and the writes. That window is small, but worth a comment.
- Fix: also check "gained" against each attempt's file on disk, as `guard_family_member` does,
  and note the TOCTOU window in the doc comment.

**m5. Opruimen panics on some non-ASCII file names.**

- Where: `crates/maatwerk-core/src/rapporten.rs:55`.
- `name[name.len() - 4..]` slices bytes. For a name whose fourth-last byte falls inside a
  multi-byte character (for example `a€€`, 7 bytes, slice at 3), this panics inside the
  blocking command, and both `usage` and `cleanup` fail for the whole folder. Teachers do save
  files with non-ASCII names next to the copies.
- Fix: `Path::new(name).extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf"))`, with a
  test on a non-ASCII name.

**m6. `listed_thumbnails_are_cached_by_content` is flaky under parallel tests.**

- Where: `crates/maatwerk-core/src/opdracht_images.rs:46`, `:385`, `:647-660`.
- `THUMB_DECODES` is a process-global counter. Cargo runs tests on parallel threads, and other
  tests in the module (`thumbnails_refuse_images_over_the_decode_limits`, the earlier thumbnail
  test, any `list` call) decode meanwhile. The "no new decode" assertion can then fail at
  random. `THUMB_CACHE` is shared across tests too.
- Fix: count decodes per key (for example `thumb.is_some()` plus a cache-hit counter keyed by
  the test's own bytes), or make the cache an injected value for the test.

**m7. The watcher's same-tick rule uses the wall clock, not the engine's injected time.**

- Where: `crates/maatwerk-core/src/watcher/engine.rs:70-74`, `:267`; test
  `m4_same_size_write_within_one_mtime_tick_is_reported`.
- The engine is otherwise driven by the rig's millisecond clock (`rig.event(path, ms)`), but
  `recent(SystemTime::now())` reads real time. The m4 test passes only if less than 3 s of real
  time passes between creating the file and the event. That is time-dependent (g), and on a
  loaded CI runner it can fail.
- Fix: pass the engine's "now" (or a wall-clock source the rig can set) into `recent`, and
  set the file's mtime relative to it in the test.

## Nits

**n1. The prefix "Niet opgeslagen:" is doubled.** `locks.rs:615`, `:625`, `:633` put "Niet
opgeslagen: ..." inside `EditLocked`, and `app.js` adds `Niet opgeslagen: ${reason}` again.
Drop the prefix in the core messages.

**n2. `SCOPE_LOCKED` does not match the core's text.** `po-gegevens.ts:49-51` says "the core
refuses the same change with this reason", but the core's text is "Er zijn al scores voor deze
PO: jaarlaag ligt vast." (per changed field). Fix the comment or align the texts.

**n3. `maxRefusal` formats the decimal comma by hand.** It uses `String(top).replace('.', ',')`
(`question-locks.ts:29`). Use `formatNumber` from `domain/format.ts`.

**n4. A doc comment runs past 100 columns.** `presence.rs:122` (rustfmt does not wrap
comments).

**n5. `changedAt` in `store.js` never shrinks.** It grows by one entry per path changed
externally during a session. That is bounded by the number of files, but a prune when no read
is in flight would be easy.

**n6. The new command arguments are not validated as names.** `exam_has_data`
(`src-tauri/src/data.rs:213`) does not check `is_year_name(year)` (`students_with_data`
does). `save_exam_family` takes `id` from the UI into `{year}/exams/{id}.json`, and an id with
`/` lands in a nested path that `locks::kind` classifies as `Other`, so it bypasses the guards.
Validate both as plain file names.

**n7. The refusal names a student id, not a name.** "Leerling 101 niet verwijderd: ..."
(`locks.rs:230`, `:242`). The student file has the name; use it, or let the UI map the id.

**n8. Quit during open: the core can be shut down twice, or `then` can run after shutdown.**
`state.rs:146-153`: between `slot.set(core)` and `slot.is_closing()`, the Exit handler can set
`closing` and call `shutdown` on the core. The thread then calls `shutdown` again, or (when it
checked first) runs `then` after shutdown. This is harmless at exit, but a `swap`-style
"closing or started" flag would make it exact.

**n9. `saveExamFamily` loses `updatedBy` on a conflict.** It uses `conflictError(null)`
(`store.js:778`), so the "door <naam>" in the conflict toast is lost. The core's `Conflict`
carries it in `details`.

**n10. `highestEnteredScores` reads only listed students.** It reads the score files of
students in `students-<year>.json` (`store.js`). A score file of a student no longer listed
can hold a higher score, which decision 11's UI refusal then misses. Iterate the cached score
folder instead.

**n11. Guard cost.**

- Every guarded write reads the old file twice under the lock: once in `expect_holds` and once
  in the guard. The bytes could be shared.
- Opening and saving a legacy observatie that has only `subject` always writes `subjects`
  (`observatie-edit.ts:104-105`). That counts as "narrowed" and triggers a scan of every year's
  exams, all rubrics and all opdrachten (`links_of`). Comparing `obs_vakken(old)` and
  `obs_vakken(new)` instead of the raw keys avoids it.

## Summary

There are no blockers, 3 majors, 7 minors and 11 nits. The core locks, the storage and watcher
fixes, the snapshot and startup work and the `rapporten/` cleanup are careful and well tested.

The majors are all at the UI/core seam:

- **M1:** the test editor rebuilds family fields, so ordinary herkansing work on exams without
  `weging_se` is refused.
- **M2:** a family save that fails halfway leaves stale revs and conflicts until reload.
- **M3:** three deletes report success when the core refused.

Most minors are drift between the core and the UI or mock copies (m1, m2), small gaps in the
guards (m3, m4), one panic (m5) and two time- or parallelism-dependent tests (m6, m7).
