# Review: step 21 (PO a: rubrics and the observatie toetstype)

Scope: `49bb2d7..HEAD` (branch `step/21-rubrics`, commits `a89e910` = 21a data/core, `f540e71` =
21b UI; 49 files, +4296/-44). Reviewer: fresh-context subagent, checklist PLAN.md Appendix C,
2026-11-10. I checked the code against PLAN-2 decisions 16, 20, 21, 23, 25, the step 21 section,
design spec 4.12/4.13 and `docs/reference/data-files-v3.md` "Rubrics and observatie toetstypes". I
did not use STATE or the commit messages as evidence.

How findings were verified: by reading the code paths named in each finding. I did not run cargo,
vitest, e2e or the Tauri app, so no failure scenario below was reproduced at runtime.

## Verdict

Ready to merge once M1 is fixed. The rules match decision 21, the PO grade matches decision 16, the
lock matches decision 20 (with the documented extra lock on adding/removing categories), and the
write guard sits in the one place every JSON write goes through. Escaping in the new HTML is
consistent and there are no inline `style` attributes. The major is about an unbounded category max.

| Severity | Count |
| -------- | ----- |
| Blocker  | 0     |
| Major    | 1     |
| Minor    | 8     |
| Nit      | 9     |

## Majors

### M1. No upper bound on a category's max: the live check can freeze or crash the editor

- **Where:** `crates/maatwerk-grades/src/rubric.rs:82-84` (`whole_max`: any whole number up to
  `u32::MAX`), `:255-257` (`(0..=max).filter(...)` with an intervals scan per score, collected into
  `uncovered: Vec<u32>`), `ui/src/modals/rubric-editor.ts:310-312` (every keystroke in the max field
  calls `checkRubric` through WebAssembly), `ui/src/screens/rubrics.ts:48` (`checkRubric` per card
  on every render).
- **What:** the check walks every score from 0 to the max and returns the uncovered scores as a
  list, which is serialised to JSON for the UI. The max is limited only by `u32::MAX`. The level
  display caps itself at 60 boxes (`rubric-levels.ts:17`), but the rule does not.
- **Scenario:** a teacher holds a key or pastes a number into "max": `4444444444` is rejected
  (> u32), but `400000000` is accepted. With levels 0–4 and 5–8, the check builds a Vec of
  ~4×10^8 u32 (1,6 GB) and a JSON array of it on every keystroke. The WebAssembly module traps on
  allocation (32-bit memory), and after a trap the instance cannot be trusted, so every grade call
  in the session can fail until a restart. A smaller value (10^7) "only" freezes the editor for
  seconds per keystroke. A rubric with a huge but valid max (levels `0–5000000`,
  `5000001–10000000`) is accepted by the core guard and then slows every Rubrics render,
  `validate-data` and `rubric check`.
- **Fix:** give the max a sensible ceiling in the rules (for example 1–100 or 1–1000; this is a
  rule change in `maatwerk-grades`, so ask the user for the number) with a Dutch error, and compute
  `uncovered` with a sweep over the sorted intervals so the cost is O(levels), not O(max). Add a
  unit test with a large max and an e2e or unit test that the editor stays responsive.

## Minors

### m1. `minAppVersion` is raised before the write is committed, and a refused write still raises it

- **Where:** `crates/maatwerk-core/src/rubrics.rs:102-110` (called at
  `crates/maatwerk-core/src/storage/mod.rs:449`, before `commit_bytes`); the mock does the same
  (`ui/src/bridge/mock/mock-api.ts:357,891`).
- **What:** validation and the lock check run first, so an invalid rubric raises nothing (tested,
  `rubrics/tests.rs:145`). But `ensure_min_app_version` runs before the CAS check and before the
  rubric/observatie file is written. A CAS conflict, a commit-lock timeout or an I/O error on the
  rubric still leaves `school.json` raised to 0.12.0. For a PO observatie there is no validation at
  all, so ticking "PO" and then getting a conflict raises it as well. The effect is that colleagues
  on 0.11 become read-only even though nothing of 0.12 was written. This is not data loss, and the
  raise would happen on the retry anyway, but the doc says "raises first", not "raises even if
  refused".
- **Also:** nothing in the UI tells the teacher that ticking "PO" on an observatie (or saving the
  first rubric) makes every colleague's older app read-only. The plan accepts this (decision 5,
  "minAppVersion raised to this release"), but a one-line notice the first time would avoid
  surprised colleagues.
- **Fix:** accept and document it in `data-files-v3.md`, or move the raise after a pre-check of
  the CAS (`expect`) so the common conflict case raises nothing. Add a test that pins down which
  behaviour you chose (rubric write with `Expect::Missing` on an existing file).

### m2. The guard fails open when the year scan sees nothing

- **Where:** `crates/maatwerk-core/src/rubrics.rs:63-79` (`usage`), `storage/mod.rs:408-421`
  (`list_years`: "empty on any error"), `read_all_json_named` (skips unreadable files).
- **What:** "in use" decides both the lock and the delete refusal. If `read_dir` of the data root
  fails for a moment (OneDrive, antivirus), `list_years` returns `[]` and every rubric looks unused,
  so a locked change or a delete goes through. Likewise, an exam file that is mid-sync or corrupt is
  skipped, so its `rubric_id` does not count. Both are rare, but this guard exists for data safety.
- **Fix:** in the guard, let a failing `read_dir` of the root be an error (refuse the write or
  delete with a "probeer het opnieuw" message), and count an unreadable exam file as "maybe in use"
  for the delete guard at least. A test with an unreadable exam file that names the rubric.

### m3. The guard reads the old rubric and the usage outside the commit lock

- **Where:** `crates/maatwerk-core/src/rubrics.rs:133-141` vs `storage/mod.rs:475-497` and
  `:518-523` (`guard_delete` before `self.commit.acquire()`).
- **What:** `check_rubric_write` reads the current file and scans the exams, then `commit_bytes`
  takes the lock and does the CAS. For the rubric itself the CAS covers it (a newer file fails the
  hash). For usage it does not: a PO that starts to use the rubric (step 22) between the scan and
  the commit, from this PC, is not seen, so a locked change or a delete can land. Across PCs the
  window cannot be closed anyway (OneDrive), so this is a narrow, same-PC race.
- **Fix:** run the guard inside the commit lock (after `acquire`) or accept it and say so in the
  module docs. Step 22 should re-check the rubric on PO save (refuse a PO whose rubric is invalid
  or missing), which closes most of it from the other side.

### m4. Case-variant paths bypass the guard on Windows and macOS

- **Where:** `crates/maatwerk-core/src/rubrics.rs:48-52` (`strip_prefix("rubrics/")`,
  `strip_suffix(".json")`), `:106` (`starts_with("observaties/")`); `RelPath::parse` keeps case
  (`paths.rs:27-45`).
- **What:** `Rubrics/r1.json`, `rubrics/r1.JSON` or `Observaties/o1.json` are valid `RelPath`s and
  name the same file on the case-insensitive file systems the app ships on. They skip the rubric
  check, the lock and the delete guard, and a PO observatie written that way skips the
  `minAppVersion` raise. The UI always writes lower case, so this needs a bug or a crafted call,
  but the guard is the only enforcement of decision 20. `validate.rs:118` already matches the
  images folder case-insensitively for the same reason (review 18 m6).
- **Fix:** compare the first segment and the extension case-insensitively in `rubric_id_of` and
  the observatie check (and in the mock regexes). A unit test with `Rubrics/R1.JSON`.

### m5. One malformed rubric file breaks the whole Rubrics tab

- **Where:** `ui/src/store.js:441-447` (`loadRubrics` keeps any object with `id` and `subject`),
  `ui/src/screens/rubrics.ts:35-38` (`r.jaarlagen.length`, `r.schoolsoort.join`), `:43`
  (`c.naam`), `:62` (`r.categories.map`), `:73-75` (`r.schoolsoort.some`, `a.naam.localeCompare`).
- **What:** the editor normalises a file (`rubric-editor.ts:68-87`), the screen does not. A rubric
  without `jaarlagen` or `categories`, with `schoolsoort` as a string, or without `naam` (hand
  edit, a future app, a half-synced file) throws in `renderRubrics`, and the tab stays empty for
  every rubric. The core guard keeps the app's own files well-formed, so this needs an outside
  writer, but every other tab tolerates such files.
- **Fix:** normalise in `loadRubrics` (the editor's `normalise` moved to `domain/rubric.ts`) and add
  a unit test with a rubric that lacks the lists.

### m6. "Toets stays on while a test uses it" sees only the loaded year and vak

- **Where:** `ui/src/screens/observaties.js:298` with `Store.obsIsUsedInAnyExam`
  (`store.js:980-987`, only cached exam lists); `obsUsedInRubric`
  (`observatie-toetstype.ts:34-40`, only the active vak's rubrics), also used for the delete button
  (`observaties.js:189`).
- **What:** the STATE note says the score grid needs no toetstype filter because an observatie used
  in a test keeps Toets. That holds only for exams in the cached year and vak. An observatie used
  by a test of another year, or by a rubric of another vak (observaties can have several
  `subjects`), can lose Toets/PO, and an observatie used only by another vak's rubric can be
  deleted. Saved data is kept (`toets-edit.ts:425-432` keeps ids not on offer, T33), so the effect
  is an inconsistency that `validate-data` reports, not data loss.
- **Fix:** derive "used in a test" and "used in a rubric" from the core (a usage command like
  `rubric_usage` that scans all years and all rubrics), or at least read all rubrics, not only the
  active vak's, for the PO lock and the delete button.

### m7. `maatwerk-grades` changed without a recorded OK

- **Where:** `crates/maatwerk-grades/src/rubric.rs` (new), `crates/maatwerk-grades/src/model.rs:29,69,74,80`
  (helpers made `pub(crate)`), `crates/maatwerk-grades/src/lib.rs`.
- **What:** CLAUDE.md: "`crates/maatwerk-grades`: the grade rules ... Never changed without the
  user's OK." The plan places the rules "in core"; putting them in `maatwerk-grades` is the right
  call (one implementation, WebAssembly), and the existing rules are untouched. But neither STATE
  nor the docs record the user's OK, and the PO grade (decision 16) is a new grade rule.
- **Fix:** list it in the step report for the user's OK (alongside the "choices made without
  asking" in STATE).

### m8. Test gaps

- No test for a large max (M1), for case-variant paths (m4), for an unreadable exam file in the
  usage scan (m2), or for which writes raise `minAppVersion` when the commit is refused (m1).
- No test of `locked_changes` with a category that keeps its name but gets a new id (it reads as
  removed + added, which is right, but not pinned down), nor of a locked rubric whose old file is
  invalid (`rubrics.rs:140` turns an unparseable old file into an empty rubric, so every category
  counts as "toegevoegd" and the rubric can never be saved again; see n6).
- The plan asks for "fixtures with three rubrics and PO observaties". They exist only in the mock
  (`tools/fixtures/to-current.mjs:185-313`); the synthetic Rust fixtures and the `validate-data`
  tests on them have no rubric file, so `validate-data` on fixture data never sees one. Consider a
  rubric and a PO observatie in the v3 migrate fixture or a dedicated validate fixture.
- Visual baselines for `screen-rubrics`, `modal-rubric-edit`, `modal-rubric-new` are still to come
  (the plan says after review); note it in STATE so it is not forgotten.

## Nits

- **n1.** `docs/STATE.md` "Next action (step 21): 21b UI, sub-task 2 below (Store done,
  uncommitted on the branch)" is stale: 21b is committed (`f540e71`). Update it before the gate.
- **n2.** Card chips read "Theorie 8 · bonus" / "… · diag" (`screens/rubrics.ts:42-43`); spec 4.13
  says "Theorie 8" with bonus tinted and diagnostic grey italic. The suffix doubles the colour cue;
  fine for accessibility, but it is a deviation from the board, so confirm or drop it.
- **n3.** Choices beyond the decisions (all sensible, all in STATE for the report): locking
  add/remove of categories when in use, `uitleg` required, at least one `normaal` category, names
  editable when locked (board 16 disables them; decision 20 wins). Make sure the step report lists
  them.
- **n4.** The migration writes `toetstypes: ["toets"]` only when migrating a v2 folder
  (`migrate/v3.rs:260-273`). Folders already on v3 (0.9–0.11) keep the field absent, which every
  reader treats as `["toets"]`. The data doc says this correctly; the plan's wording ("the migration
  step writes it") could suggest otherwise. No action unless the user expects all files to say it.
- **n5.** `Soort` reads an unknown value as `normaal` (`rubric.rs:47-51`). A future soort in an
  in-use rubric changed back to `normaal` is not seen as a locked change. Harmless today.
- **n6.** `rubrics.rs:140`: `serde_json::from_value(old).unwrap_or_default()` silently treats an
  unparseable old rubric as empty; together with the lock it makes an in-use rubric that became
  unparseable impossible to repair from the app. A clearer refusal ("het bestand op schijf is
  onleesbaar; herstel het via Gegevenscontrole") would help.
- **n7.** `store.js:850-859` recognises a core refusal by stripping the `Save failed for <path>: `
  prefix of an error message built twenty lines up. It works, but a `code` on the error thrown by
  `update()` (as `conflictError` does) would be less fragile.
- **n8.** Duplication: `SCHOOLSOORTEN` is now in seven files (`rubric-editor.ts:38` adds one);
  `src-tauri/src/data.rs:184-191` repeats `RubricUse` field by field; the mock guard repeats the
  core's Dutch messages (`mock-api.ts:861-893`), which is the accepted pattern for the mock but will
  drift; `rubric-levels.ts:78-83` and `rubric-editor.ts:269-276` repeat the shared-bound detection
  that the check already does (and mark a bound red on a level the core counts as bad). A
  `sharedMin`/`sharedMax` list in `CategoryCheck` would remove both copies.
- **n9.** `maatwerk-cli rubric check <folder>` aborts with exit 2 on the first rubric file that is
  not an object (`cli/src/rubric.rs:76-79,104`), so one bad file hides the report on the others;
  report it as a line instead. `crates/maatwerk-grades/src/rubric.rs` is 695 lines with tests inline;
  the core keeps tests in a `tests.rs` beside the module, which would bring it under ~400.

## Checked and found correct

- Level rules (decision 21): 2–5 levels, whole bounds, within `0..=max`, overlaps allowed, no shared
  min or max, full cover; touching intervals (0–2, 3–4) pass; error texts match board 16 ("Twee
  niveaus beginnen bij 2 · Niet gedekt: 3"); non-integer and empty input give per-level errors and
  are excluded from the overlap and cover checks; a max of 0, 2,5, -1, "" or null is refused.
- PO grade (decision 16): 10 × points ÷ max clamped to 1,0–10,0, bonus in the points only,
  diagnostic in neither, no N-term, not rounded (rounded where shown, as other grades); `None`
  for max 0 or NaN.
- Lock (decision 20): max, soort and the set of category ids are compared; names, levels, order and
  observaties stay editable; tested in Rust (`rubric.rs:621-658`, `rubrics/tests.rs:204`) and e2e.
  The editor disables the same controls and keeps Opslaan off on a locked change.
- Guard placement: `Storage::write_json` and `Storage::delete`, so the UI, CLI and any other writer
  of JSON go through it; `write_text` is limited to `.typ` paths (`commands.rs:239`), so it cannot
  write a rubric. Validation and the id check run before any raise; a read-only app is refused by
  `commit_bytes` and by the school write. `ensure_min_app_version` only raises (never lowers),
  leaves a missing or unparseable school file alone, uses CAS with retries and `updatedBy: null`.
  The app is 0.12.0, so the raise cannot lock out this app.
- `school.json` writes from the UI go through `update()` (read-modify-write with CAS), so a stale
  school form cannot undo the raise; the raise bumps `_meta.rev`, so an open school form gets a
  conflict instead of an overwrite.
- Migration: `observaties_v3` only adds the field when absent, and `update_entity` writes nothing
  when the body is unchanged, so a rerun is idempotent. The golden change (two observaties: field
  and `_meta`) is explained in the 21a commit message.
- `validate-data`: rubric rules as errors, id = file name via `place`, missing observatie
  (missing), non-PO observatie (warning), bad `toetstypes` (warning), unknown `rubric_id` (missing).
- Security: every user string in the new HTML goes through `esc`/`escHtml` (cards, chips, editor
  inputs as `value="…"`, observatie chips and popover, confirm and toast); no `style=""` attribute,
  geometry goes through the CSSOM (`rubric-levels.ts:60-71`); new paths go through `RelPath`.
- Layering: no `tauri` in core; `rubric_usage` only maps core output; `domain/rubric.ts` imports
  `./core` only, not the bridge; heavy work in commands goes through `blocking`.
- Toets modals: `toets-edit.ts:183` offers only Toets observaties and keeps ids not on offer
  (T33); the observatie form never ends with no toetstype (UI and `readToetstypes`); new
  observaties default to Toets; opdracht bewerken is unfiltered.
- Rubrics tab: between Toetsen and Observaties, hidden for the admin, eigen-toggle hidden; card grid
  `minmax(420px, 1fr)`; editor 1180 px fixed height; e2e uses no fixed sleeps.

## Triage

Implementer, 2026-11-10. Fixed now, tests first where possible:

- **M1 fixed.** `check_category` computes the gaps from the sorted intervals (`gaps: [[from, to]]`
  instead of a list of every uncovered score), so any max costs O(levels); tests
  `a_huge_max_is_checked_without_walking_every_score` (u32::MAX) and the Vitest "huge max" case
  through WebAssembly. The editor draws boxes only up to 60. No cap was added: a cap is a new rule,
  so it goes to the user as a question.
- **m1 fixed (data part).** The guard checks the CAS expectation before it raises `minAppVersion`
  (`Storage::expect_holds`, also used by the commit); a conflicting write raises nothing (test
  `a_refused_write_raises_nothing`); the mock raises after its CAS too. The UI notice when ticking
  PO is in the backlog.
- **m4 fixed.** `rubric_id_of` and the observatie check match the folder and `.json` in any ASCII
  case (test `case_variants_of_the_path_are_guarded_too`); the mock too.
- **m5 fixed.** `normaliseRubric` (domain) makes every list present; the Store normalises on load,
  so a damaged file shows as an invalid rubric (Vitest).
- **m7:** in the step report (the module adds rules decided in PLAN-2 16 and 21; no existing number
  changes).
- **m8:** tests added for M1, m1, m4, m5, n6, n9; the rest in the backlog.
- **n1** STATE updated. **n6 fixed:** an unreadable rubric in use is refused with "onleesbaar ...
  Gegevenscontrole" (test). **n8 partly:** `sharedMin` / `sharedMax` in `CategoryCheck` replace the
  UI's two copies of the shared-bound logic (`boundInvalid`). **n9 fixed:** the CLI reports a file
  that is no rubric as an invalid line (test).
- **n2, n3:** in the step report for the user. **n4, n5:** no action (documented). Backlog: m2, m3,
  m6, rest of m1/n7/n8, n9 file size.
