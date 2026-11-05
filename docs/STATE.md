# State

Last updated: 2026-11-05 (step 15 in progress) Branch: `step/15-shell` Last tags: `v0.5.0`, `step-14`, `v0.4.1`,
`step-13`, `v0.4.0` (pushed), `v0.3.2`, `step-10`, `v0.3.1`, `step-09`, `step-08`, `step-07`,
`v0.2.0-parity` (version tags are local only)

## Current step

**Step 15 (Shell, M).** Branch `step/15-shell` (from `main` `2688784`). Baseline green (cargo
test, Vitest). Items V-05, V-12, F-17, F-18 (persistence), F-21, B-04, B-08, U11, U13, U16,
decision 5.

## Step 15 progress

1. **Done:** minimum app version (decision 5). `maatwerk-core::app_version` (parse, compare,
   `required_version`); `Storage::read_only()` reads `school.json` `minAppVersion` on every call
   and every file write or delete is refused with `Error::ReadOnly` (`read_only`; details.found =
   the minimum); presence skips its writes when read-only. `dataFolderStatus` has `appVersion` and
   `readOnly`. UI: `services/read-only.ts` (texts, version compare for the mock),
   `components/read-only-banner.ts` (banner at the top of `#app`), Store throws `{code:
'read_only'}`, app.js shows "Niet opgeslagen: deze versie van Maatwerk is te oud ..." (not the
   "onverwacht" text), PIN dialogs too. Mock backend: `MOCK_APP_VERSION = '0.6.0'`, refuses
   writes like the backend. Tests: 5 storage tests on the v2 fixture, 3 unit, 4 Vitest, 3 e2e
   (`e2e/shell.spec.ts`). Runbook section 8.
2. **Done:** tab bar (spec 3.5, V-05, V-12). Header 56 px on `--surface` with a `--border` line
   (`--topbar-h`; the `--header-*` tokens are gone); brand button (`#btn-about`) with icon +
   wordmark from `ui/src/assets/brand/` (copies of the design assets without the C2PA metadata;
   light/dark variants via `.theme-light-only`/`.theme-dark-only`); tab icons are the design
   boards' own paths (Lucide style; THIRD_PARTY_LICENSES.md notes it); active tab: 600, icon in
   `--accent-text`, 3 px underline, `aria-current="page"`. Admin: Leerlingen, Groepen,
   Opdrachten, Gebruikers, School, Gegevenscontrole, Instellingen. Sticky screen headers sit at
   `--topbar-h`. e2e: 2 tab-bar tests; the sticky test measures the bar. **Visual diff pending**
   (every screen's top bar changes).
3. **Done (before 3, the menu needs it):** one avatar helper (B-04, B-08):
   `components/avatar.ts` (`avatarHtml`, `renderAvatar`, `loadAvatarPhotos`, initials = afkorting
   or first letters of first and last name; round, square for admin / sectievoorzitter; ring =
   user colour, accent (top bar 38, editor 30) or none; photo as `<img>` over the initials, read
   through a 30 s cache) + `styles/avatar.css` (also imported by `editor.css`). Used by the
   login badges and Gebruikers (56), the top bar (38, accent ring), presence (30, with photo),
   the "nieuwe toets" notice (30) and the editor (B-08: the editor asks the main window
   `maatwerk-user-avatar` for the user and photo). `utils/badges.js` and the `.badge-initials` /
   `.user-badge-mini` CSS are gone. e2e: 2 avatar tests.
4. **Next:** user menu dropdown. 4. Look + active year per user. 5. Avatar helper. Then U11/U13/U16, the
   e2e for persistence, gate, review, version 0.6.0.

## Step 14a progress

1. **Done** (`5538f85`): `ui/src/components/dialog.ts` + `styles/dialog.css`: one dialog
   component (fixed top 64 px, centred, max height `100vh - 96px`, `fixedHeight`; sticky header
   with title/badge/subtitle/close/tabs; scrolling body; footer: right-aligned, primary last,
   `align: 'start'` for a navigational action; busy state on async buttons; per-dialog close
   guard and cleanups; stacking with one backdrop each; Escape on `window` in the bubble phase,
   skipped when a control inside called `preventDefault()`). `app.js` `showModal`/`closeModal`/
   `guardModalClose`/`onModalSync`/`onModalCleanup`/`modalRefresher`/`pushModalChart` act on the
   current modal (top of the modals opened through `showModal`/`openModal`; confirms do not
   count). `showModal` = legacy form (key `legacy`: replaces a legacy modal, stacks on a
   structured one; keeps ids `modal-box`/`modal-content`/`modal-close`). `confirmDialog`,
   `alertDialog`, `showReloadNotice` on the component. U15 (replaced modal runs its onClose),
   U14 (RTTI uitleg uses the shared guard; its inline confirm bar is gone), U12 (closing a dialog
   destroys its CustomSelects; `host._csel`), n8 (dev menu Escape). New behaviour: **Escape
   closes modals** (through the guard); before, only ✕ and the backdrop did.
2. **Done** (`a77cd39`): exam overview, rapport and group edit on `openModal` (structured header,
   tabs via `onTab`, `fixedHeight`, group edit footer). `openModal({ key })` replaces a modal
   with the same key (refresh in place). Skeleton helpers `components/skeleton.ts` +
   `styles/skeleton.css` (not used yet; areas use them, V-09 "14 + areas"). Sticky `.screen-head`
   (title row + filter row) on the five teacher tabs. `e2e/dialog.spec.ts` (34 tests).
   R-05 call: the three ported modal files stay JS (only their open call changed; their area
   steps 20/23/25 convert them), as with m7 in step 13.
3. **Done:** user OK on the 14a visual diff (2026-11-05); local baselines updated.

## Step 14b progress

1. **Done** (`fa77dd1`): every modal on `openModal` (title/subtitle in the header,
   `footerHtml` keeps the buttons' ids and listeners and arranges them; `onShow` gets the
   whole dialog element). `showModal`, the legacy ids (`modal-box`/`modal-content`/
   `modal-close`) and `dlg--legacy` are gone. Keys: `exam-edit` (new test step 1/2, inhaal ->
   editor), `student-edit`, `group-edit`, `group-overview`, `profile`, `exam-overview`,
   `rapport`, `opdrachten-genereren`. **Behaviour changes:** the profile stacks on the group
   overview (closing returns there; `backFn` removed, Vorige/Volgende in the footer); the
   account modal stays under "Pincode wijzigen"/"Nieuwe herstelcodes" (stacked);
   `modalRefresher` waits while its modal is covered. PIN submit buttons use `setBusy` (n6).
   Rule I applied: a danger/delete action is not in any footer yet (none of the forms has one).
2. **Done** (`6728884`): `components/form.ts` (`field`, `formRow`, `tickBox`, `toggleTick`) +
   `styles/forms.css`; form rows align on labels; PTA tick boxes; m4 (CustomSelect trigger and
   inline selects/textareas on the 3.2 look, now 36 px; question table dense 26 px); m3 (school
   field input on the base). 16 dead u-* removed (103 left: the rest live in the big modal
   files and go with their area steps 20-25, as R-05/m7). Form markup is not rewritten to
   `field()` everywhere: the CSS rule aligns every `.form-row`; the helper is used for the new
   tick-box fields. Steppers lining up across rows (board 14) is step 20.
3. **Done:** gate green (cargo fmt/clippy/test, lint, typecheck, 391 Vitest, licences, cargo
   deny, SPDX, `npm audit --omit=dev` 0); version **0.5.0** (`4797c2d`).
4. **Done:** review `docs/reviews/step-14.md`: 0 blockers, 3 majors (M1 covered modal got the
   wrong reload notice, M2 focus stayed on the opener, M3 tabs not keyboard-reachable), all fixed
   with tests (`914fa57`); m1, m5, m6, n1, n7 fixed; rest in `docs/backlog.md` "From Step 14".
   Every modal now has a `key`. Empty footers hidden (`69cdf07`, seen in the visual diff).
   e2e: 193 tests green.
5. **Done:** user OK on the 14b visual diff (2026-11-05) with two remarks, both fixed: the exam
   badge of Scores invoeren sits before the exam name in the subtitle line (`subtitleHtml` dialog
   option), and an unticked tick box shows a faint tick (`--border`; `--border-strong` on hover).
   Local baselines updated (111 views). Merged into `main`, tagged `step-14` and `v0.5.0`.

E2E: the editor test "a compile over the time limit" flaked once more under the full suite
(backlog).

## Fix 0.4.1 (2026-11-05, user report)

"Openen in PDF-viewer" in Opdrachten genereren / Rapport genereren wrote the PDF but Windows said
it could not find `\\?\...\data\rapporten\...pdf` (user's screenshot, not committed: it shows a local path).
Two causes: `print_pdf` resolved the copy's path against the data folder although the copy is
written next to it since step 7a (C18), and the canonical `\\?\` prefix went to ShellExecute.
`outputs::print_copy` now returns `PrintedCopy { rel, path }` (path in OS form,
`paths::os_path`); `openable_path` and `open_with_os` strip the prefix too. Regression test
`outputs::tests::printed_copy_path_is_the_written_file_in_os_form` (fails without the fix).

## Step 13 result

Phase 2 plan merged into `main` (`90e02a5`, pushed 2026-11-05). Sub-tasks per `PLAN-2.md` step 13:

1. **Done:** tokens (`ui/src/styles/tokens.css`: neutrals light/dark, 21 accents, grade, RTTI,
   type, radii, shadows, control sizes); `ui/src/domain/look.ts` + `ui/src/theme.ts` (dev/mock
   only menu, Ctrl+Alt+T, `localStorage` `maatwerk.dev.look`); `style.css` colours mapped to
   tokens (legacy `--primary`/`--radius`/`--shadow`/`--success` gone); `controls.css`
   (segmented control, accent swatch). Visual spec runs every view in light/blauw, dark and
   geel (`--dark`/`--geel` suffix). Pre-change baselines: 37/37 equal to `main`, copied to the
   session scratchpad.
2. **Done:** `ui/src/domain/format.ts` (`formatGrade`, `formatFixed`, `formatNumber`,
   `formatCompact`, `parseDecimal`, `parseDecimalLoose`) and `ui/src/domain/grade-colors.ts`
   (spec 2.3: text colours as theme-token mixes, bar colours hex, score-grid cell fills) replace
   the copies in ~15 files; `utils/grades.js` -> `utils/grades.ts`; `utils/colors.js` keeps only
   `examTypeColor` until sub-task 4. Rounding paths unchanged (B8 note in `quirks.md`). The
   score grid stays light in dark mode (token island) until step 21.
3. **Done:** `ui/src/styles/buttons.css` (`.btn` + `--primary/--secondary/--text/--danger/
--icon/--icon-danger/--sm`, focus ring, disabled, `aria-busy` spinner) and
   `components/button.ts` `setBusy`. All ~100 buttons converted (PIN dialogs included);
   `.btn-primary/-secondary/-sm/-danger/-link/-sm-icon` CSS removed. Dialog footer order
   (primary last) waits for the dialog component (step 14).
4. **Done:** `controls.css`: inputs/selects/textareas as a zero-specificity (`:where`) base
   (36 px, `--border-strong`, accent focus ring), search field 220 px with magnifier, stepper
   (`.num-spinner`), toggle buttons (`.tog-btn`), filter chips (`.filter-btn`, active state),
   test-type badge (`.test-badge`, `domain/test-type.ts`: toets = accent, SE = anti; PO and
   diagnostic classes ready for step 20). `utils/colors.js` removed; `utils/spinners.js` ->
   `.ts`; `theme.ts` `cssToken` for chart colours. Question-editor table keeps dense controls (26 px).
5. **Done:** 9 unused `u-*` utilities removed (`u-w-32`, `u-h-32`, `u-mr-0`, `u-bg-dark` freed
   by this step; `u-align-bottom`, `u-border-b`, `u-p-3-6`, `u-text-left`, `u-tracking` already
   dead). 119 remain for later steps.
6. **Done:** user OK on the visual diff; local baselines updated (111 views: light/blauw, dark,
   geel). Gate green (cargo fmt/clippy/test, lint, typecheck, 385 Vitest, 124 e2e, 111 visual,
   cargo deny, npm licences, SPDX, `npm audit --omit=dev` 0).
7. Review `docs/reviews/step-13.md`: 0 blockers; M1 (charts in dark) fixed; m1, m2, m5, m6 and
   n1, n2, n4, n7 fixed; m3/m4 partly; rest in `docs/backlog.md` "From Step 13". R-05 rule
   (user-visible decision recorded here): JS files touched only for class renames or imports
   stay JS until their area step.
8. Version 0.4.0.

User decisions (2026-11-05): zwart accent in dark theme keeps the light fill (`#E7EAF0`, dark
text); B8 rounding unification stays in step 19. `editor.css`/`pdf-viewer.css` (own windows)
keep their colours until step 27.

User review of the visual diff (2026-11-05), fixed: groep-edit Schoolsoort on one line; text in
inputs had no left padding (the `* { padding: 0 }` reset beat the zero-specificity base; base is
now element-level); toets-new and herkansing steppers aligned (108 px, no `u-w-90`); verzamelkaart
labels aligned (toggle groups and PTA box 36 px). Then (user): every control in a form row is 36 px (toggles,
jaarlaag/periode/subcategorie squares, schoolsoort/vak/docent toggles); question-editor table
stays dense (26 px toggles and selects). New `modal-md` (760 px) for Nieuwe toets,
verzamelkaart and Leerling bewerken.

## Phase 2 intake (earlier)

**Phase 2 (`PLAN-2.md`).** Cutover done by the user (2026-11). Intake in `ROADMAP.md` section 4;
design pass done (`docs/phase-2/design/`, rounds 1-5); step plan `PLAN-2.md` (steps 12-29).
Step 12 (triage) done 2026-11-04: decisions in `PLAN-2.md` section 1 and ADR-0010, triage in
`ROADMAP.md` 4.6. Step 13 done 2026-11-05. Before step 18 the user runs `validate-data`
on a copy of the real data folder.

Earlier: **Step 10 "Cutover readiness" done**, merged into `main` and tagged `step-10`. Waiting for the
user: the open questions below and the manual checks before the cutover. Phase 2 per
`ROADMAP.md` when the user says so.

## After the Step 10 manual test (2026-11-03, PR #6 merged, `v0.3.2`)

1. The user's results: `docs/reviews/manual-test-step-10.md`, all pass except **M-OPD-9**.
2. **M-OPD-9 fixed:** the editor's questions ("Herstel standaardversie", "Toch sluiten?" after a
   failed save) used `window.confirm`, which `tauri-plugin-dialog` makes async, so they never
   stopped anything. They now use the app's `confirmDialog` through `maatwerk-confirm`; ESLint
   forbids native `alert/confirm/prompt`; e2e tests emulate the async confirm. "Bekijk
   verschillen" shows for every existing `main.typ`/`lib.typ` ("Geen verschillen" when equal).
3. Remarks: new ROADMAP items F-05 (compile indicator), V-03 (smooth preview scroll), B-04
   (photo re-check). The M-LEER-3/M-GRP-3/M-TOE-6/M-ADM-1 comments repeat Step 6 (F-02, C18 done
   in 7a, photos in 7b): re-check M-TOE-6 and M-ADM-1 against the current checklist.
4. **No school year selected after a restart** (user, after retesting): `config.json` written
   by the migration/first-run setup has no `activeYear`; the reference's fallback to the current
   school year only covered a missing file. `Store.getConfigSync/getConfig` now fill it in
   (`ui/tests/store/active-year.test.ts`, e2e in `quirks.spec.ts`). No data change.
5. Version **0.3.2**. Gate green (cargo fmt/clippy/test, lint, typecheck, Vitest, 124 e2e,
   `cargo deny`, licences, SPDX, `npm audit`).

## Step 10 result

1. Robustness: watcher panic restarts with backoff, close waits at most 2 s (4b n6); batch job
   panic -> `BatchError::Panic` (5b n1); core opened off the main thread via `CoreSlot` (6b m6);
   snapshot claim re-checked after a 45 s settle, only our own claim released (7b m1).
2. Quirk B24: `nextQuestionId` (never reuses an id the exam had when the editor opened);
   Gegevenscontrole reports repeated question ids as a **warning**; saved exams not repaired.
3. Unexpected failures: panic hook (thread, location; backtrace with RUST_BACKTRACE), `internal`
   errors logged, UI errors logged (student file names redacted, one line each), Over Maatwerk >
   Probleem melden (log folder + open).
4. Security: U8 fixed and `innerHTML` audit; path fuzzing; Typst sandbox tests; `cargo deny` ok;
   `npm audit --omit=dev` 0; CSP unchanged; `/security-review` no findings
   (`docs/testing.md`).
5. Perf (`docs/perf.md`): 200-PDF batch 1.9 s / 171 MiB; `school` fixture 1x within budget, **4x
   2-3x slower than Step 7c** (unexplained, backlog).
6. Docs: README, `docs/architecture.md`, `docs/release.md`; CI uploads `maatwerk.exe.sha256` and
   builds on `v*` tags; runbook B24 note; ADR-0002 section 13 (drift check).
7. Review `docs/reviews/step-10.md`: 0 blockers; M1 (evidence) recorded, M2 fixed; m1-m5, n3-n5
   fixed; m3 rest, m6, n1, n2, n7 in `docs/backlog.md` "From Step 10"; n6 rejected.

## After Step 9 (user decisions 2026-11-03, PR #4 merged 2026-11-03)

1. **Published 0.3.1 as its own PR** (#4, `release/v0.3.1` -> `main`; CI green on `097cf31`).
2. **Quirk T31 fixed:** `main.typ` 2 applies `setup_extra(body)` as a show rule; the old
   `setup_extra()` form keeps its old behaviour (detected by a regex on `opdracht.typ`, files are
   not rewritten). New starter template, examples and AI context use `setup_extra(body) = body`.
   Unmodified `main.typ` 1 copies update silently (ProjectFile release row 2). Migration fixture
   `tests/fixtures/migrate/v2` updated (it holds the bundled main.typ and starter file).
   `main.typ` 2 also drops the leftover cursor-marker code (review 8b n4, user 2026-11-03):
   no `cursor` in `OpdrachtInputs`; `svg-preview-many-pages` golden tolerance 1 grey level.
3. **ADR-0009 accepted: option D**, an in-app assistant that runs the teacher's own AI CLI
   (Claude Code, Codex, Gemini, ...; detected on PATH, presets plus per-teacher override) in a
   temp copy of the opdracht folder, diff/accept in the editor. Every teacher, provider of their
   choice, no API keys, all four tasks, images per request with a warning. To be implemented in a
   later step (not scheduled yet).

## Before Step 9 (user requests 2026-11-02, on `release/v0.3.0-rc.1`, pushed to PR #3)

1. CI fix: `THIRD_PARTY_NOTICES.txt` lacked `@codemirror/autocomplete` and `@codemirror/lint`
   (Step 8b). PR #3 CI is green since.
2. Migration report: the migration screen lists every migration warning and every check issue
   (read-only Gegevenscontrole table, errors first), and `<backup> verslag.txt` next to the backup
   zip holds the same plus every change (`migrate::save_report`; app and `maatwerk-cli migrate
--apply`). Before, only the counts were shown (user's dry run: "0 fouten, 3 waarschuwingen").
3. PIN 4-8 digits (was 5-8).

## Step 9 result

Commits 6da2ddf..HEAD on `step/09-ai-seams`, gate green:

1. `maatwerk-core::assignment` (`Assignment::open` only on an opdracht folder, `check`,
   `render_pdf`, `export_lib`); `maatwerk-cli assignment check [--json] | render --pdf |
export-lib`. JSON schema `docs/schemas/assignment-check.schema.json` (+ generated sample).
2. `docs/assignment-format.md`, `docs/ai-context/assignment-authoring.md` (~2.5k tokens),
   `docs/assignment-examples/01..05` (a test checks they compile clean, plus the inline example).
3. `docs/adr/0009-ai-integration.md`: options A/B/C, constraints, seven questions. Nothing decided.
4. Review `docs/reviews/step-09.md`: 0 blockers; M1 (quirk T31, docs fixed), M2 (sandbox root),
   m1, m2, m4, m5, m6, m8 and most nits fixed; m3, m7, n6, n9 in `docs/backlog.md`.
5. Version 0.3.1 (Cargo workspace, `ui/package.json`).

## After Step 8 (user decisions 2026-11-01)

- Version `0.3.0-rc.1` (PLAN section 9 item 9: SemVer below 1.0 with release candidates, `0.3.0` at
  the cutover). Branch `release/v0.3.0-rc.1` with a PR into `main` for Steps 7 and 8 (CI).
- No compile debounce; new errors after 500 ms without typing; a save no longer hides a compile
  error. Keystroke -> preview 61 ms median (`docs/perf.md`).

## Step 8b result

Commits b98ac1d..HEAD on `step/08-editor`, gate green (291 cargo tests, 321 Vitest, 117 e2e,
cargo deny, npm licences, SPDX):

1. Core `LiveEditor`: coordinator + compile thread, **watchdog** (time limit from
   `instellingen.json` `editor.compileTimeoutSeconds`, 2-300 s, default 30; at most two abandoned
   compiles; the fresh session keeps the client's preview), `query`, `unset_file`,
   `current_document` (n7), `__maatwerk/` not editable (n4).
2. `typst-ide` 0.14.2: autocomplete, hover, definition, jumps from click/cursor (UTF-16), query
   text never stays in the buffer.
3. `lib.typ` v2 (`punten` in the vraag marker, output unchanged; migrate golden regenerated);
   `typst_svc::vragen`; `check_project_files` (silent update of unchanged old copies, CAS) and
   `restore_project_file`.
4. App: `src-tauri/src/editor.rs` (14 commands, `editor:update` event, one session at a time).
   Bridge + `MockEditor`.
5. UI: editor on the session (lint, autocomplete, hover, Ctrl+click/F12, preview <-> source,
   page patches, vragen panel, tabs `main.typ`/`lib.typ` with banner, Bekijk verschillen,
   Herstel standaardversie, BOM strip n8). Deps `@codemirror/autocomplete`, `@codemirror/lint`.
6. Instellingen: compile time limit.
7. `ui/e2e/editor.spec.ts` (7) + Instellingen e2e; `tools/perf/editor.mjs` on the release exe
   (182 ms keystroke -> preview median, compile 1-2 ms, memory flat over 300 edits;
   `docs/perf.md`); runbook rehearsal on the `school` fixture (log in the runbook).
8. Review `docs/reviews/step-08b.md`: 0 blockers; M1, m1-m4, m7, n2, n3, n5, n7 fixed; m5, m6,
   n1, n4, n6, n8 in `docs/backlog.md` "From Step 8b"; n9 not changed (reason in the review).

## Step 8a so far

1. `typst_svc::EditorSession` (commit 4376cc4): one long-lived `MaatwerkWorld` per open
   opdracht; `set_file` (buffer in memory, incremental reparse via `Source::replace`), `reset`
   before each compile (mount folders re-resolved, disk files re-checked by mtime + length,
   missing files looked up again); `compile(generation, stale)` returns `EditorUpdate`
   (`ok`, diagnostics, `preview_generation`, `page_count`, only changed `pages` as SVG + hash,
   `compile_ms`, `render_ms`); last good document kept; `resend_all`. `LiveEditor`: worker
   thread, debounce (`DEFAULT_DEBOUNCE` 150 ms, generation 0 at once), latest generation wins
   (stale result dropped before the SVG render), panics reported as an error update, drop stops
   the thread. `Location.range_utf16` for CodeMirror. Tests: 15 in `editor::tests`, parity test
   `editor_session_patches_equal_the_one_shot_render`.
2. `examples/editor_latency.rs`, `docs/perf.md` section, parity section, ADR-0002 section 12
   (cancellation deviation: open question).
3. Review `docs/reviews/step-08a.md`: 0 blockers; M1 (cursor marker) decided in ADR-0002
   section 12 (no marker in the live session; 8b uses typst-ide jumps); m1 (sink panic), m3
   (`refresh` / `reload_disk_files`), m4, m5, m6 partly, n1 fixed; m2, m6 rest, n2-n8 in
   `docs/backlog.md` "From Step 8a".

## Step 7a result

User decisions (2026-10-30): C10 = opaque ids for _new_ exams/groups only, existing ids kept;
C9 = `"N"` instead of `null`, invalid input stays the typed string. Format spec:
`docs/reference/data-files-v2.md`; ADR-0003 has C16-C19.

Done on the branch (`step/07-data-v2`, one commit each):

1. ADR-0003 C16-C19 + C9/C10 shapes; `docs/reference/data-files-v2.md`.
2. `maatwerk-core::integrity` (C19 stamp: SHA-256 of canonical JSON without `_meta.hash`).
3. `maatwerk-core::migrate` (plan -> verified backup zip outside shared/OneDrive folder -> apply
   -> `schema_version: 2` last; resumable; blocks on unmigrated legacy data / corrupt JSON).
   Golden fixture `crates/maatwerk-core/tests/fixtures/migrate/{v1,v2}`
   (`MAATWERK_UPDATE_GOLDEN=1` regenerates v2). Error codes `needs_migration`,
   `migration_blocked`. zip 9.1.3 + sha2 0.11 (cargo deny ok, notices regenerated).
4. `maatwerk-core::validate` (validate-data: version, corrupt, stamps, placement, conflict
   copies/strays, references, images, opdracht folders; Dutch messages).
5. CLI `validate-data`, `migrate --dry-run | --apply --backup-dir`; CI migrates the generated
   `school` fixture and validates it.
6. Storage/app on v2: v1 -> `needs_migration`; stamp on write, check on read (`stamp_issues`,
   `accept_stamp`); trailing newline; v2 seed; opdracht folders (`TypstProject::opdracht`,
   create/copy/delete folder, `read_opdrachten`); text CAS (C17); `rapporten/` next to `data/`
   (C18); commands `migrate_data_folder`, `validate_data_folder`.
7. UI on v2: `domain/v2.ts` codec at the Store boundary (in memory still `null` = N and a plain
   student array, so grades/reports unchanged); users per file + school rev check (C16); opaque
   ids (C10) with CSV group match by name; editor conflict bar (C17); migration screen at start;
   admin tab Gegevenscontrole + check at admin login. `tools/fixtures/to-v2.mjs` converts the
   mock fixture and the golden scenarios. All golden differences were format-only.
8. e2e updated (94 pass); `docs/cutover-runbook.md`; manual tests M-MIG-1..5, M-SYNC-5/6,
   M-START-3, M-TOE-6, M-OPD-1 updated; quirks B9/B21/B25/B26; parity rows.

## Step 6b summary

- Startup error screen (4b m5): commands `data_folder_status`, `restart_app`; UI
  `screens/startup-error.ts` (Dutch reason, folder, "Opnieuw proberen" = restart); quirks.spec.
- Start failure (no WebView2): main-thread panic hook + `build()` error -> Dutch `rfd` message
  box (`src-tauri/src/start_error.rs`); checked by hand with `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER`
  set to a missing folder (Tauri panics "Could not find the webview runtime" in the event loop).
- School logo input: six image types, Dutch toast otherwise (6a M1).
- `ui/e2e/real-pdf.spec.ts`: real rapport PDF (written by `typst_rapport`) in pdf.js under the
  CSP; CI step after `cargo test`.
- CI already built and uploaded the portable exe (since Step 0); new CI checks: no MockApi in the
  app bundle, real-PDF spec after `cargo test`.
- Docs: `docs/manual-test.md` (click-through, ids `M-…`), `docs/parity.md` complete (all 32
  handlers; manual ids linked), backlog "From Step 6b" (compat layer stays until Step 10).
- Review `docs/reviews/step-06.md`: 0 blockers, M1 (Tauri's English WebView2 box came first in
  release builds -> `wry::webview_version()` pre-check before Tauri, logging before Tauri) and
  m1-m5, n1-n9 fixed; m6, n10 in the backlog; drift notes in ADR-0002 section 11.
  `/security-review`: no findings. Release exe checked without WebView2: one Dutch box.

## Step 6a so far

- Core: `opdracht_images` (list with 48 px PNG thumbs, store/overwrite, copy, delete with
  background folder retry, empty-folder cleanup at start, clipboard RGBA -> PNG; quirk T30) and
  `outputs` (`OutputStore` in the OS cache dir under output IDs `<n>-<name>.pdf`, emptied at
  start; `print_copy` to `rapporten/<schooljaar>/<YYYY-MM-DD HHmm> <soort> <vak> <groep>
<toets>.pdf` with ` (2)` on a clash). `create_v1_opdracht_file`, `storage.write_bytes/list_dir`.
- App: commands `create_assignment_typ_file`, 7 image commands, `render_rapport_pdf`,
  `render_assignment_svg`, `render_assignment_batch` (+ `assignment:progress` event),
  `open_path` (output ID or data-relative path), `print_pdf`, `set_watch_year` (C7). Plugins
  dialog/clipboard/opener used from Rust only (no capability grants). URI scheme `maatwerk-out`
  (`scheme.rs`, CORS for the app origins). Error code `typst`. Presence offline on window
  destroy.
- UI: TauriApi complete (no stubs); `printPdf` + `setWatchYear` added to the bridge (mock too);
  print listeners use `printOutput` with `domain/print.ts` names; CSP `connect-src` has the
  scheme; pdf.js `isEvalSupported: false`; `setWatchYear` at `initSubject` and year selectors.
- Kept the current app icon (already the Maatwerk icon from the reference, step 0) instead of
  the older `_reference/build/icon.ico`; window config was already right; no splash.

## Fix between steps: bundled emoji font (`fix/emoji-font`)

- First CI run on `main` failed: `rapport_valid_matches_the_golden` p14, 1 pixel in 🥈 (the
  runner's Segoe UI Emoji differs from this machine's). User decided: bundle Noto Color Emoji now
  (PLAN section 9 decision 2) and regenerate the goldens with it.
- `assets::FONTS` + `NotoColorEmoji-COLRv1.ttf` (5 MB, OFL, `THIRD_PARTY_LICENSES.md`).
  `FontStore` drops its code points from system fonts' fallback coverage (`without_emoji`), since
  Typst's fallback preferred "Segoe UI Emoji" (shorter name). Checked: PDF (Type3 colour glyphs,
  Poppler render), SVG facts, PNG goldens with and without system fonts.
- Harness: temp `include/fonts` is a copy + Noto (junctions for the rest), PNGs with
  `--ignore-system-fonts`. Goldens regenerated: only PNG hashes/bytes changed. Tests use
  `support::fonts()` (no system fonts); tofu test uses a Tibetan icon (U+0F00).

## Step 5b summary

- `TypstProject` (`folder` for the CLI, `opdracht_v1` = virtual project: bundled `main.typ` and
  `lib.typ`, `opdracht.typ`, own `images/<id>/` only); `opdracht-main.typ` replaces the generated
  wrapper, data via `sys.inputs` `maatwerk-data` (`OpdrachtInputs`; placeholder only for preview).
- `render_assignment_pdf`, `render_assignment_svg_pages` (in memory), `render_assignment_batch`
  (workers `max(2, min(4, cpus-1))`, monotonic progress, first failure stops), `pdf_merge`
  (lopdf 0.46, duplex padding), tofu warning, `maatwerk-cli typst compile`, version lines +
  released hashes (`assets::ProjectFile`), cursor marker `__maatwerk_cursor`/`maatwerk-cursor:`.
- Parity: all opdracht/SVG/batch goldens (`tests/typst_opdracht.rs`, 24 tests); JPEG within 3
  levels; quirks T28 (1-based columns) and T29 (sandbox, v1 details). `docs/perf.md`: 30-student
  batch ~118 MiB. **Step 6 must** map Tauri args to `OpdrachtInputs`/`BatchJob` (label fallback
  `label ?? typFile`), run them in `spawn_blocking`, and call `normaliseForTypst` for the rapport.

## Step 5a summary

- `maatwerk-core::assets`: embedded `rapport.typ` (= `rtti_export.typ`, SPDX header, input
  guards), `rapport-main.typ` (entry, reads `data.json`), `lib.typ` (markers `__maatwerk_*`,
  counters `maatwerk-vraag*`), `base_assignment.typ` (unchanged); fonts Source Serif 4 (12) +
  STIX Two Math; packages zero/cetz/oxifmt/unify embedded by `build.rs` (`PACKAGE_FILES`).
- `maatwerk-core::typst_svc`: `MaatwerkWorld` (virtual files + `Mount`s behind
  canonicalise/prefix check, embedded packages only, injectable clock for `today()` and the PDF
  date), `FontStore` (template fonts, system fonts searched once via `FontStore::shared()`, then
  Typst's), `Diagnostic`/`Location`/`TraceFrame` + `to_text` (CLI-like, virtual paths only),
  `compile_document`, `compile_pdf`, `render_rapport_pdf(fonts, &RapportData, &DataDir, now)`.
- Parity: `tests/typst_rapport.rs` (12 tests) matches `rapport-one-student` and `rapport-valid`
  **pixel for pixel** (30 ppi) plus page count/sizes/text; no-watermark gives the same error.
- Quirks fixed template side: T26 (non-colour colours, non-number scores), T11/T27 (`$` guard on
  `uitleg_rtti` and leeradvies; only unescaped `$` count, review M2, also in the UI's
  `sanitizeTypstMarkup`). `rapport-markup` and `rapport-tiny` data now compile.
- Review M1: `normaliseForTypst` (UI) restores the `toTypst` values (`undefined` -> `null`,
  non-finite -> `0`) for the JSON payload. **Step 6 must call it** in `TauriApi.renderRapportPdf`.
- `deny.toml`: RUSTSEC-2026-0194/0195 (quick-xml via typst 0.14.2) ignored with reason; backlog.
- Watcher test `m1_a_failed_own_write_releases_the_file` was flaky (same-size content); test fixed,
  product edge case in the backlog.

## In progress

Nothing.

## Step 7c result

Commits 269a203..88b299f, gate green (109 e2e, 309 Vitest, cargo, deny, licences, SPDX):

1. `mw:*` spans (`ui/src/utils/perf.ts`), `tools/perf/measure.mjs` (release exe over the WebView2
   DevTools port, `--cpu 4`, `--admin 1`), baseline and results in `docs/perf.md`.
2. Kept list screens: `Store.generation()` + view key in `navigateTo`; score-modal close redraws
   the exam list only after a save.
3. Leerlingen: 60 cards at once, rest via `utils/idle.ts`, delegated clicks, delete checks
   admin-only, `content-visibility: auto` on cards.
4. `read_json_dir` command: `Store.preloadScores` reads a score folder in one call.
5. Memoised `Store.examResults`.
6. Score modal: first group at once, rest in idle; prebuild of the first group when the exam
   menu opens (no presence before the modal opens).
7. Docs: parity "Perceived speed", manual `M-PERF-1/2`, backlog "From Step 7c".

Result (4x CPU, school fixture): modal 209 -> 48 ms median, tabs within budget at the median,
first visit after login still above 100 ms p90 (backlog). 1x: everything < 25 ms.

Review `docs/reviews/step-07c.md`: 0 blockers; M1 (scroll on refresh), M2 (generation on every
colleague change), M3 (folder re-reads), m1-m4, n1, n3, n4, n6 fixed; m4/m5 rest, n2, n5 in
`docs/backlog.md` "From Step 7c".

## Step 7b result

- Nothing. **Step 7b done** and tagged `step-07b` on `step/07-data-v2` (not merged: the step branch
  merges into `main` at the end of Step 7). Review `docs/reviews/step-07b.md`: 0 blockers; M1
  (snapshot names), M2 (restore as CAS with fresh `_meta`), m2-m5, m6 (tests), n1-n3, n6, n7 fixed;
  m1 partly, n4, n5 in `docs/backlog.md`. Gate green (102 e2e). What 7b contains (ADR-0006):

- core `auth` (Argon2id `pinHash`, admin `recoveryCodeHashes`, throttle, login session in Rust),
  core `snapshots` (`instellingen.json`, CAS claim on `snapshots/state.json`, retention,
  single-file restore), CLI `admin reset-pin`, app commands + bridge (Tauri + mock), background
  snapshot at start.
- UI: PIN dialogs (`screens/pin.ts`, texts in `domain/accounts.ts`), account modal on the
  top-bar badge, Gebruikers (photos, "Pincode resetten", sectievoorzitters), sectievoorzitter
  badge and group rights, tab Instellingen, Gegevenscontrole "Herstellen uit snapshot", badge
  photos everywhere (`utils/badges.js`).
- Tests: Rust `auth::tests` (13), `snapshots::tests` (8), validate, CLI; Vitest; e2e
  `accounts.spec.ts` (8), all 102 e2e pass. Local visual baselines updated (badge photo,
  Gebruikers).
- Docs: data-files-v2, runbook sections 6-7, manual tests M-PIN/M-VZ/M-SNAP, parity, ADR-0006.

## Phase 2 planning (2026-11-03, PR #5 merged into `main`)

- `ROADMAP.md`: draft skeleton for after the cutover (rules without parity, intake list with
  F/B/V/R/X IDs, areas, step proposal, open decisions). `docs/phase-2/inventory.md`: quirks
  without a recorded fix, open backlog by theme, UI size and duplication.
- `PLAN.md` Step 10 rescoped to "Cutover readiness"; Step 11 (macOS) moved to the roadmap (X-04).
- Next: the user's triage session (ROADMAP P0) with their feature and visual lists.

## Next action (concrete, resumable)

0. Done: 0.3.2 merged (PR #6) and tagged locally; M-OPD-9 and the school-year fix re-checked by
   the user. Open: push `v0.3.2` (CI builds the release exe on the tag); re-check M-TOE-6 and
   M-ADM-1 with the current checklist wording.
1. User: the manual checks before the cutover: `docs/manual-test.md` M-OPD-2..11 in the real
   app, M-MIG-1..5, M-PIN/M-VZ/M-SNAP and M-PERF-1/2 on a copy of real data, M-SYNC-1..4 on two
   machines, and the runbook rehearsal on a copy of real data. Run `maatwerk-cli validate-data`
   on the migrated copy to see whether B24 duplicates exist.
2. User: decide the open questions below; then a release (`docs/release.md`) and the cutover
   (`docs/cutover-runbook.md`) when the user says so.
3. Phase 2 triage session (`ROADMAP.md` P0) in parallel.

## Open questions for the user

- When to schedule the ADR-0009 option D step (AI CLI assistant), relative to Step 10 and the
  cutover.
- Snapshot contents: photos (`fotos/`) are left out until M-SNAP-4 is measured on a real copy.
- Tag `v0.3.0-rc.1` (PR #3 merged 2026-11-01; not tagged yet).
- Push version tags (`v0.2.0-parity`, `v0.3.1`) to GitHub? So far only `step-*` tags are there.
- None blocking. Section 9 items still open: versioning policy (9), domain logic location
  (Step 10), macOS.
- **B24 repair (Step 10):** the user expects no duplicates in the real data (2026-11-03); no
  repair planned.
- **Perf at 4x (Step 10):** investigated 2026-11-03: the `step-07c` exe is as slow as `step-10`
  on battery, so likely the power state, not the code (`docs/perf.md`). User to decide after an
  optional re-run on mains power; then bump to `0.3.2` (user, 2026-11-03).
- **Release version:** `0.3.2` merged and tagged `v0.3.2` on `9c856d7` (local; pushing the tag
  waits for the user).

## How to resume

Perf measurement: `node tools/fixtures/generate.mjs school <dir>/shared/data`,
`target/debug/maatwerk-cli.exe migrate --apply --backup-dir <dir>/backups <dir>/shared/data`,
`npm run build:exe`, then `node tools/perf/measure.mjs --data <dir>/shared/data --cpu 4`.
Commit messages: from Git Bash (`git commit -F - <<'EOF'`); PowerShell `Out-File` adds a BOM.

After the folder move, release builds also needed `cargo clean --release -p maatwerk-core -p
maatwerk-app -p maatwerk-cli` (stale build-script path). PowerShell for npm/cargo (Git Bash's
`link` shadows MSVC's), but edit files with the editor or
Python, never `Get-Content`/`Set-Content` (they re-encode UTF-8). In PowerShell 5.1, commit with
`git commit -F <file>` (inline messages with quotes get split into pathspecs). `npm ci; npm run
build:ui`, then the gate commands in `CLAUDE.md`, plus `npm run test:e2e` (needs `npx playwright
install chromium` in `ui/`). Rapport parity: `cargo test -p maatwerk-core --test typst_rapport` / `--test typst_opdracht`
(machine-independent, no system fonts; failing pages are written to
`target/tmp/golden/<case>/`). Goldens: `npm run golden:check` (needs `_reference/` at `0e30a70` and
the Typst packages in `%LOCALAPPDATA%\typst\packages`). `cargo-deny` 0.20.2 and cargo-about 0.9.3 (`--features cli`) are installed.
