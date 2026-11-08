# State

Last updated: 2026-11-08 (steps 17 and 18 merged into local `main`, PR open) Branch: `step/18-data-v3`
(from `step/17-rapport-fixes`, which is from `main` `a62ea7e`)
Last tags: `step-16`, `step-16b`, `v0.7.0` (local; step 16 merged into local `main`, not pushed), `step-16a`
(pushed), `v0.6.0`, `step-15`, `v0.5.0`, `step-14`, `v0.4.1`, `step-13`, `v0.4.0` (pushed), `v0.3.2`,
`step-10`, `v0.3.1`, `step-09`, `step-08`, `step-07`, `v0.2.0-parity` (version tags are local only)

## Current step

**Next action:** CI on the PR `release/v0.9.0` -> `main` (steps 16, 17, 18); the user merges it.
Then step 19.

**User (2026-11-08):** the migration ran fine on a copy of the real data (local exe 0.9.0).
Leeradvies score column 3 cm -> 2,5 cm (`16439a2`, goldens re-blessed; scores up to
"99,5 / 99 (100%)" fit). Steps 17 and 18 merged into local `main`, tagged `step-17`,
`v0.8.0`, `step-18`, `v0.9.0` (local); pushed as `release/v0.9.0` with a PR.

**User answers (2026-11-07):** golden check 17 approved (padding page with footer and
watermark is fine). T9 moved to step 19b, T23 to step 30 (PLAN-2, ROADMAP 4.6; renumbered 2026-11-08). F-14:
`opdrachtenVraag` stays on the exam (ADR-0010 item 7); `onder: 2` matches 0, 1 and `N`, not an
empty score (step 30 implements the matching).

**User instruction (2026-11-07):** do steps 17 and 18 in one go, as separate branches and
commits; the gate, code review and security review only once, after step 18. Step 16: CI green
(user), version 0.7.0, merged into local `main`, tagged `step-16b`, `step-16`, `v0.7.0`.

## Step 17 progress (Rapport fixes, 0.8)

Scope as PLAN-2 step 17: B-06, B-07, F-13, F-04, T4, T7, T8, T10, T25; plus T6 (the rapport's
numbers, same lines as T7). T9 (histogram/ranking texts) moved to step 19b and T23 (batch
reports only the first failure) to step 30 (user 2026-11-07; renumbered 2026-11-08).

1. **Done** (`f26d77f`): template fixes, failing tests first (`tests/typst_rapport.rs`, 9 new):
   T4 watermark only when `fotos/school-watermerk.svg` exists (any case; `data.json` field
   `watermark`); T6/T7 `_num` (decimal comma, no truncation); T8 footer total = the student's
   own pages (metadata `<rapport-student-end>`); F-13 `pagebreak(to: "odd")` between students,
   the last student padded via its end marker; T10 zero/fractional maxima, missing
   `grenswaarden` (TS, `buildLeeradviesRows`); T25 `lang: "nl"`; B-06 score column 3 cm (2,5 cm since 2026-11-08); B-07
   dots 5.5 pt when any score or maximum has a fraction. Goldens `rapport-one-student`,
   `rapport-valid` blessed (`MAATWERK_BLESS="<why>" MAATWERK_BLESS_IDS=<ids> cargo test`, new in `tests/support`; case
   field `port.blessed`): page 1 of each student changes, page 2 not. User approved the
   before/after PNGs (2026-11-07).
2. **Done** (`8010810`): F-04 `components/render-warnings.ts`: folded panel above the PDF in the
   rapport and opdrachten dialogs; bridge returns `warnings`; batch warnings name the opdracht,
   once per opdracht; mock `useRenderWarnings`; e2e `e2e/rapport.spec.ts` (3).
3. **Done** (`9ea3bd9`): version 0.8.0.

## Step 18 progress (Data format v3, 0.9)

Branch `step/18-data-v3` on top of `step/17-rapport-fixes` (17 is not merged: its golden check is
pending). Spec: `docs/reference/data-files-v3.md`; runbook section 9.

1. **Done:** core. `migrate::v3` (new): `school.json` first (`minAppVersion` 0.9.0 when absent or
   lower; logo/watermerk paths), `fotos/` -> `afbeeldingen/` (any case), `users/` removed (stale
   presence), `gebruikers` foto paths, every exam `kind: "toets"`/`diagnostic: false` when
   absent, resits `obs_ids` = original's + own (warning) and `obs_from_parent: true`, with a
   before/after `notes` line per resit (decision 13). Changed entities: rev + 1, `updatedBy`
   null. `migrate` chains v1 -> v2 -> v3 after one backup (`migrate_to` for tests; a v1 dry run
   lists v2 only and says v3 follows). `CURRENT_VERSION` 3; v2 is `needs_migration`. Storage
   `IMAGES_DIR`/`PRESENCE_DIR`; rapport mount `/data/afbeeldingen`; watcher/snapshots skip
   `afbeeldingen/`. D20: `presence::prune_stale` (30 days) at every start. `validate-data`:
   v3 exam fields, `opdrachtenVraag` (F-14 data part), leftover `fotos/`/`users/` named.
   Fixtures: v1 fixture got two resits; `tests/fixtures/migrate/v2` regenerated (only those two
   added); new golden `v3`. 11 new Rust tests.
2. **Done:** app + UI. `migrate_data_folder(dryRun)`, `MigrationResult.notes`; the start screen
   shows the resit list before the confirm; CLI prints it. UI paths (`afbeeldingen/`,
   `aanwezigheid/`), `withExamDefaults` in `Store.upsertExam`, new resits copy the original's
   observaties (F-12 data part; locking in the edit screen is step 20). `tools/fixtures/to-v2.mjs`
   -> `to-current.mjs` (`filesToV3`, mock only; Store goldens stay on v2). Mock app version 0.9.0.
   Version 0.9.0.
3. **Done:** gate after step 18 (user: one gate for 17 and 18): fmt, clippy, all Rust tests,
   420 Vitest, 123 node tests (incl. the Typst reference-freshness check), 220 Chromium e2e,
   117 local visual views unchanged, lint, typecheck, SPDX, licences, cargo deny,
   `npm audit --omit=dev` 0. Reviews (fresh context): `docs/reviews/step-17.md` (0/1/5/5),
   `step-18.md` (0/1/8/6), `step-17-18-security.md` (0/1/5/5); both majors and most minors
   fixed (`ee4b0ea` on step 17, merged into 18; `1b522c4`), rest in `docs/backlog.md`. Nothing
   pushed; WebKit e2e and macOS/Linux CI not run for 17/18.
4. **Not done, needs the user (STOP gates):** the `validate-data` list from a copy of the real
   data (PLAN-2 "before the step"); running the migration on that copy; deleting leftovers. No
   automatic leftover removal was built: the list decides (runbook section 9).

## Step 16 (done, tags `step-16b`, `step-16`)

Plan: (1) CI job `linux` + packages; (2) case-sensitive path tests (Windows-made data folder in
mixed case: path helpers, migration, `validate-data`); (3) backlog: lock dir, snapshot `who`,
early log dir; (4) README Linux section + sync advice (STOP); (5) visual tests per platform in
CI; (6) gate, review of step 16, report.

1. **Done** (`7540d21`), CI result pending: `src-tauri/tauri.linux.conf.json` (appimage + deb, Education), `npm run
build:linux`, CI job `linux` on ubuntu-24.04 (glibc 2.39+): npm test, WebKit e2e, clippy
   (the only lint of `cfg(not(windows))` code), cargo test, fixture migrate + validate,
   real-pdf, AppImage + .deb artifact `maatwerk-linux-x86_64`. `data_location::program_path`:
   `$APPIMAGE` counts as the program, so `data/` beside the AppImage works like beside the exe.

2. **Done** (local, not pushed while CI run `42213080719` runs): case-sensitive paths (quirk
   T32). Typst World: a missing mounted file is looked up ignoring case
   (`world::find_ignoring_case`; ambiguous -> not found). Migration rewrites `images/<id>/` in
   any ASCII case. `validate-data`: a case-only mismatch is a warning with the real name. The
   whole workspace suite also passes with `TMP` in a case-sensitive folder on Windows (`fsutil
file setCaseSensitiveInfo`). Login lists `gebruikers/` (ids keep their case); image import
   already refuses case-only clashes.

3. **Done** (local): the 16a backlog. `default_lock_dir` is per user everywhere (a shared
   `/tmp/maatwerk-locks` made by one Linux user blocked the next user's saves): Linux
   `$XDG_RUNTIME_DIR`, else `~/.cache`; macOS `~/Library/Caches`. Snapshot `who`:
   `machine_name()` (COMPUTERNAME / `scutil --get ComputerName` / `/proc/sys/kernel/hostname`).
   `early_log_dir` mirrors Tauri's `app_log_dir` on macOS and Linux too.

4. **Done** (local): README "Linux (from 0.7)" (`.deb`, AppImage + `libfuse2t64`, `data/` beside
   the AppImage) and "Linux: the shared folder". **User decision (2026-11-06, STOP gate):**
   OneDrive Client for Linux (abraunegg, `--monitor`) recommended, rclone bisync on a timer as
   the alternative; `rclone mount` and GNOME Files' OneDrive marked unsuitable. validate test:
   the clients' conflict copies are listed. `docs/release.md` Linux artifact, manual checks
   M-LNX-1..6.

5. **Done** (local), baselines pending: visual tests in CI. **User decision (2026-11-06):** the
   light look only, baselines per CI platform committed (`ui/e2e/visual-baselines/<project>-
<platform>/`, ~2.5 MB each; local WebKit run: 39 views, ~50 s, stable). Projects
   `visual-ci-chromium` (Windows job) and `visual-ci-webkit` (macOS, Linux), tolerance
   `maxDiffPixelRatio: 0.002`. A platform without a folder writes its baselines (warning) and
   uploads artifact `visual-<os>`; next: commit those from the first run (docs/testing.md
   "Visual baselines in CI").
6. Run `42225808814` (`3056ce4`): Linux and macOS green and wrote their baselines (39 each;
   3.6 MB Linux, 4.6 MB macOS; checked by eye: DejaVu on Linux, SF on macOS, charts fine),
   committed. Windows failed twice on Chromium e2e flakes, each a different test: csp
   screen-groepen (`ERR_CONNECTION_REFUSED` once), accounts `#traag` (30 s timeout), dialog
   "opens at the fixed top" (measured mid-animation; now polled). Watch the first two; no CI
   retries added.
7. Run `42230950159`: all green; macOS and Linux compared against the
   committed baselines; Windows wrote its 39 (2.7 MB, Segoe UI; checked by eye), committed.
   Run `42235274073`: Windows and Linux compared against the committed baselines (no new ones);
   macOS got no runner ("not acquired", GitHub capacity), reruns with the next push.
8. Review `docs/reviews/step-16.md` (fresh context): 0 blockers, 3 majors, 7 minors, 6 nits;
   triage at its end. **M1** a missing chosen folder no longer becomes a new school
   (`state::open_located`); **M2** (user decision 2026-11-06: keep the order) "Over Maatwerk"
   shows the data folder with "Andere map kiezen…"; **M3** the dialog trap leaves a handled Tab
   and `tabindex=-1` alone (G45 extended). Also m5 (lock folder `~/.cache` only), m6, n1-n3, n6
   (`local-config.json` in the local, not roaming, app folder). Backlog: m1-m3, m7. Local: all
   Rust tests, 434 e2e (Chromium + WebKit), lint, typecheck.

9. Run `42242653611` failed on Linux: the n3 fix had written a literal backslash-n into the apt line
   (fixed, `ci: real line continuations…`). Run `42246523588`: Windows and Linux green, visual
   39/39 on both; macOS had no runner for the third time (GitHub capacity), only the macOS job
   rerun. **Paused here (2026-11-06, user).** Resume: `gh run view 42246523588` (macOS job:
   e2e, first comparison against the committed macOS baselines). Green: tag `step-16b`, stop and
   report (merge to `main` and the 0.7 release only with the user). This STATE commit is local
   (a push would cancel the rerun); push it with the tag.

## Step 16a (done, tag `step-16a`)

**Step 16a** (Platforms: macOS; L, 16a/16b). Item X-04. User decisions (2026-11-06): **unsigned
macOS build + "Open anyway" instructions** (no Apple Developer account; ad-hoc signed for Apple
Silicon); pushing `step/16-platforms` for CI runs is fine (no tags, no merge without the user).

1. **Done** (`c91d467`): first-run "choose data folder". `maatwerk-core::data_location`
   (`locate`: env > dev > chosen in `local-config.json` > `data/` beside the program if it
   exists, never inside a `.app`; `check_chosen`: data folder, `<picked>/data`, or empty, else
   refused in Dutch; `LocalConfig` keeps unknown fields). `paths::data_dir_location` removed.
   App: `ErrorCode::NoDataFolder`, `DataFolderStatus.source`, command `choose_data_folder`
   (folder dialog, `save_choice`, UI restarts). UI: `screens/choose-folder.ts` ("Kies de
   gegevensmap"), "Andere map kiezen…" on the startup error screen for `chosen`/`besideApp`.
   Tests: 4 core, 1 app, 4 Vitest, 3 e2e (`e2e/platforms.spec.ts`); manual M-START-8/9.
   Behaviour change: a Windows exe without `data/` beside it asks instead of creating one.
2. **Done** (`f1a62f2`): font stacks fall back to system fonts (`system-ui`, `ui-monospace`,
   Menlo, DejaVu Sans Mono); Windows keeps Segoe UI/Consolas first (no visual change). Emoji in
   the UI: the OS font (Apple Color Emoji); Typst uses the bundled Noto as before.
3. **Done** (`9a6a6e1`): Playwright project `webkit` (`npm run test:e2e:webkit`, runs on
   Windows too after `npx playwright install webkit`): 215/215 locally (one timing flake per
   full parallel run, a different test each time; editor preview tests under load). WebKit
   findings, all test-side: native `<select>` -> CSP `style-src-attr` report (ignored on WebKit
   in `watchErrors`), no clipboard permissions (`pasteText`/`copySelection`), Chromium-only
   `shadowRoot.getSelection`, per-glyph SVG hit test, Playwright scroll vs `content-visibility`,
   aborted module import on a second navigation. App fix: Cmd+Z / Cmd+Shift+Z / Cmd+Y undo.
4. **Done** (`e800328`): CI job `macos` and `src-tauri/tauri.macos.conf.json` (app + dmg, ad-hoc
   `-`, macOS 12+), `npm run build:mac`; README "macOS" ("Toch openen"), release.md. Branch
   pushed; **CI result pending** (first run).
5. Local gate green on `56f13f2`+ (fmt, clippy, cargo test, 412 Vitest, 122 node tests, deny,
   licences, SPDX; e2e 215 Chromium, 215 WebKit). Also `docs/testing.md` "WebKit (step 16a)",
   manual checks M-MAC-1..6.
6. First CI run with the macOS job (`42193879918`): 10 WebKit e2e failures on the macOS runner,
   none on Windows. Two causes: the specs pressed `Control+A` / `Control+End` / Ctrl+click, which
   are other actions on a Mac (now `ControlOrMeta`); and a real bug: WebKit on macOS skips
   buttons on Tab, so the dialog focus trap never saw its last button focused and focus left the
   dialog. The trap now moves focus itself (`ui/src/components/dialog.ts`).
7. Second run (`42205393394`): 2 editor e2e failures on macOS. setText's Delete + insert are two
   edits and the slower runner compiled the empty text in between, so "the preview stays on
   errors" kept an empty preview. Those steps now add ` #fout` / ` #traag` at the end (one edit).
8. **Done.** Third run `42209047813` on `6d65139`: all three jobs green; macOS 214 WebKit e2e,
   cargo test, real-pdf; `Maatwerk.app` universal (`lipo`: x86_64 arm64), `codesign --verify`
   ok; artifact `maatwerk-macos-universal` (.zip + .dmg, ~114 MB). Tagged `step-16a` (local).
   Next: step 16b (Linux). The step 16 review and the 0.7 release come after 16b.

Backlog candidates (done in 16b item 3): the snapshot's `who` uses `COMPUTERNAME` (unset on macOS ->
"onbekend"); `default_lock_dir` falls back to `temp_dir()` off Windows (per user on macOS,
shared `/tmp` on Linux: 16b); `early_log_dir` is Windows-only.

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
4. **Done** (`0b1d334`): user menu (F-17, spec 3.6), `components/user-menu.ts`: dropdown (280
   px, not a dialog) under the avatar; name + "Docent · <vak>" / "Sectievoorzitter <vak>" /
   "Beheerder"; Thema Licht/Donker; 21 accent swatches (7x3); Foto wijzigen (disabled, F-19
   later); Pincode wijzigen; Nieuwe herstelcodes (admin); Uitloggen (danger). Escape, a click
   outside or Tab out close it; focus back to the avatar. The account modal is gone (`pin.ts`
   `changePinFlow`, `renewCodesFlow`); ids `#acc-pin`, `#acc-codes`, `#acc-logout` kept. Visual
   views `user-menu-teacher`, `user-menu-admin`.
5. **Done** (`0b1d334`): look and active year per user (decisions 3 and 15, F-18, F-21, D7).
   Additive field `preferences: { theme, accent, activeYear }` in `gebruikers/<id>.json`
   (`domain/preferences.ts`); `Store.savePreferences` merges into the latest file (no rev check,
   so no conflict with an admin edit); `getConfigSync().activeYear` is the logged-in user's year,
   else config.json's, else the current school year; choosing a year on any screen sets all
   three selects and saves it; logout clears the selects and returns to the base look. The look
   is applied at login before `initSubject` and the main screen (`theme.ts` `applyUserLook`;
   `baseLook` = default, or the dev menu's choice in dev/mock builds). `Store.setActiveYear`
   (shared config.json, never called) removed. 0.3.x keeps unknown user fields (the Gebruikers
   form spreads the record, PIN commands edit the JSON object): Rust test
   `pin_writes_keep_preferences_and_unknown_fields`. Tests: Vitest preferences + store merge; 5
   e2e (menu, persist across logout, second PC with a seeded user file incl. active year, admin
   edit kept, admin menu).
6. **Done:** U11 fixed (`onclick` per Alles/Niets button; e2e fails without the fix), U13 and U16
   checked: superseded (quirks.md).
7. **Done:** R-05 for the shell, partly: the filter bar (~470 lines) moved verbatim from `app.js`
   to `shell/filter-bar.js` (app.js 1209 lines on `main` -> 789); app.js re-exports its getters. Both stay
   JS until Store is typed (backlog "From Step 15").
8. **Done:** version 0.6.0 (`22023dc`); gate green (`npm audit` with dev: the known
   eslint -> minimatch advisory, dev-only, `--omit=dev` 0; see `docs/testing.md`).
9. **Done:** review (`docs/reviews/step-15.md`): 0 blockers, 2 majors (read-only messages and
   banner while running; read-only browsing), both fixed with tests; most minors and nits fixed,
   rest in `docs/backlog.md` "From Step 15".
10. **Done:** user decisions (2026-11-05): no login without a PIN on a read-only app (fine, rare);
    a newer schema stops older apps at the start screen (fine, rare); tab icons are our own
    drawings (checked against Lucide, THIRD_PARTY_LICENSES.md updated). Visual diff OK; local
    baselines updated (117 views). Merged into `main`, tagged `step-15` and `v0.6.0`.

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
   score grid stays light in dark mode (token island) until step 25 (renumbered 2026-11-08).
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
keep their colours until step 31 (renumbered 2026-11-08).

User review of the visual diff (2026-11-05), fixed: groep-edit Schoolsoort on one line; text in
inputs had no left padding (the `* { padding: 0 }` reset beat the zero-specificity base; base is
now element-level); toets-new and herkansing steppers aligned (108 px, no `u-w-90`); verzamelkaart
labels aligned (toggle groups and PTA box 36 px). Then (user): every control in a form row is 36 px (toggles,
jaarlaag/periode/subcategorie squares, schoolsoort/vak/docent toggles); question-editor table
stays dense (26 px toggles and selects). New `modal-md` (760 px) for Nieuwe toets,
verzamelkaart and Leerling bewerken.

## Phase 2 intake (earlier)

**Phase 2 (`PLAN-2.md`).** Cutover done by the user (2026-11). Intake in `ROADMAP.md` section 4;
design pass done (`docs/phase-2/design/`, rounds 1-5); step plan `PLAN-2.md` (steps 12-33).
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
