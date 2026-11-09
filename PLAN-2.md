# Maatwerk: phase 2 plan (steps 12-33)

Phase 2 turns the intake in `ROADMAP.md` section 4 and the design in `docs/phase-2/design/` into
steps that each fit one Claude Code session of at most 5 hours (**M**), or two sessions with a
safe checkpoint in between (**L**, split into a and b). `PLAN.md` (phase 1, steps 0-11) is frozen
history. `ROADMAP.md` keeps the item lists (F, B, V, R, X); this file decides the order.

**Every session:** read this file sections 1-3, `docs/STATE.md`, then only the current step in
section 4. For visual work also read the design spec sections the step names, and the mock files
it lists. Do not read the whole roadmap or design spec.

## 1. Decisions (user, 2026-11-04)

| #   | Decision                                                                                                                                              | Source            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| 1   | Grade, statistics and attempt logic move to `maatwerk-core` (Rust), one implementation for screens, rapport and CLI                                   | ROADMAP 7.1       |
| 2   | Order: foundation first, then teacher-facing fixes, then the visual redesign per area, then the AI assistant                                          | user              |
| 3   | Theme, accent and editor divider position are stored per user in `gebruikers/<id>.json`                                                               | ROADMAP 7.7       |
| 4   | Every step is a 0.x release (next minor); 1.0 when this plan is done                                                                                  | ROADMAP 7.2       |
| 5   | Before the first data-format change, `school.json` gets a minimum app version; older apps refuse to write                                             | ROADMAP 7.4       |
| 6   | Diagnostic test = **D** box next to PTA (they exclude each other, D sets Weging to 0); a PO is its own kind with its own modal (F-20, designed later) | user, design 4.11 |
| 7   | The design spec (`docs/phase-2/design/README.md`) is the source of truth for the look                                                                 | design pass       |

Decided in step 12 (2026-11-04, `docs/adr/0010-phase-2-decisions.md`):

| #   | Decision                                                                                                                                                  | Source       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 8   | Manual test on a copy of real data only for steps that touch data or numbers (15, 18, 19, 20)                                                             | ROADMAP 7.3  |
| 9   | Old goldens stay as regression tests until a step intentionally changes that output; then the new output becomes the golden after the user's visual check | ROADMAP 7.5  |
| 10  | AI assistant in step 32                                                                                                                                   | ROADMAP 7.6  |
| 11  | Data v3 renames `fotos/` -> `afbeeldingen/` and `users/` -> `aanwezigheid/`                                                                               | ROADMAP 7.8  |
| 12  | Trend arrow: best attempt of the most recent counted test minus the weighted year average (as on the rapport); diagnostic tests ignored                   | ROADMAP 7.9  |
| 13  | Existing inhaal/herkansing tests get the original's observaties (copied, locked) in the v3 migration, shown as a before/after list first                  | ROADMAP 7.10 |
| 14  | Exam fields: `kind: "toets" \| "po"` and `diagnostic: true/false`; PTA stays `type: "pta"`                                                                | ROADMAP 7.11 |
| 15  | Active school year per user (F-21, quirk D7), stored with the theme                                                                                       | triage       |

Praktische opdrachten (PO) with rubrics (user, 2026-11-08; ROADMAP F-20, F-22, F-23):

| #   | Decision                                                                                                                                                                                                                                                                                 | Source |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 16  | A PO is graded with a rubric (new tab Rubrics). Grade = 10 × points ÷ max, between 1,0 and 10,0; whole points only; bonus categories count in the points, not in the max; diagnostic categories count in neither; no N-term                                                              | user   |
| 17  | Group and individual bonus/malus lines are in grade points (named, several allowed); student grade = group grade + group lines + own lines, between 1,0 and 10,0                                                                                                                         | user   |
| 18  | Projectgroepen (UI word; "Groepen" stays the classes): students of different classes may be together if they match the PO's vak, schoolsoort and jaarlaag; a student alone is a projectgroep of one; unplaced students get no grade; a member differs only through own bonus/malus lines | user   |
| 19  | Category scores, observaties and comments are the projectgroep's and are copied into every member's score file; a student moved to another projectgroep takes the new group's scores (with a warning), own lines stay                                                                    | user   |
| 20  | Rubrics are shared per vak (like observaties), "Dupliceren" makes a variant; once a PO uses a rubric, the categories' **max and soort** are locked (names, levels and observaties stay editable) and the rubric cannot be deleted                                                        | user   |
| 21  | A category has 2-5 levels (interval, optional title, explanation); intervals may overlap, never share a minimum or a maximum, and together cover 0 to the max without gaps                                                                                                               | user   |
| 22  | PO toevoegen lists rubrics with the same vak, a shared schoolsoort and the PO's jaarlaag; PTA and D as for tests; PO herkansing only (no inhaal): same rubric, projectgroepen copied and editable, best attempt counts                                                                   | user   |
| 23  | Observaties get a field `toetstypes` (`toets`, `po`, or both; existing ones `toets`); test modals list only `toets`, the rubric editor and PO grading only `po`, the Observaties tab gets a filter; opdracht bewerken is not filtered                                                    | user   |
| 24  | The PO score table is read-only, grouped by projectgroep; grading happens in its own modal (sliders, descriptions highlighted, category observaties and comments, overall comment, bonus/malus), saved automatically every 10 s and on closing                                           | user   |
| 25  | The Rubrics tab is for teachers and sectievoorzitters, not the admin; the PO rapport gets its own design round (step 24)                                                                                                                                                                 | user   |

The priority, size and step of every roadmap item and old quirk are in `ROADMAP.md` section 4.6.

## 2. Working rules

**Unchanged:** `PLAN.md` section 2 (session protocol 2.1, gate 2.2, review 2.3, git 2.4, hard
rules 2.5, stop and ask 2.6) and `ROADMAP.md` section 2 (goldens as regression tests, quirks
closed, `_reference/` is history, one area per step, data safety, a release per step).

**Session budget (5 hours):**

1. A session starts with `git status`, the baseline test run and reading this file and STATE
   (target: under 15 minutes). It ends with the tree green, committed, and STATE updated.
2. Sub-tasks are at most ~45 minutes each and end in a commit. The step lists them in order; if a
   session runs out, the next one resumes at the first unfinished sub-task (STATE "Next action").
3. Reserve the last ~45 minutes of the last session of a step for the gate, the reviewer
   subagent (fresh context, `docs/reviews/step-NN.md`) and the release.
4. If a step turns out bigger than its size, split it at a sub-task boundary (`step-NNa` tag),
   note it here, and stop to report. Never cut tests or the review to fit the budget.
5. Keep context small: subagents for broad reading, file ranges instead of whole files, never
   paste big outputs. The mocks are large: read only the board the step names.

**Per step, always:**

- **JS to TS (R-05):** convert the files the step touches, split files over ~500 lines into
  cohesive modules, and remove the area's compat-layer commands.
- **Visual baselines:** update `npm run test:visual` only after the user has seen the diff; the
  commit names the roadmap items.
- **Numbers:** any change to a grade, average, SD, percentage or rapport output gets a
  before/after table on the fixtures (`tools/fixtures`) and the user's OK before it is merged.
- **Data:** any change to saved data gets a migration or an additive field, a fixture test, the
  minimum-version guard, and a manual check on a copy of real data before the release.

## 3. Status (keep up to date)

| Step | Title                                                            | Size         | Release | Status |
| ---- | ---------------------------------------------------------------- | ------------ | ------- | ------ |
| 12   | Triage and open decisions                                        | S (user)     | -       | done   |
| 13   | Foundation a: tokens, themes, buttons, inputs, formats           | M            | 0.4     | done   |
| 14   | Foundation b: dialog component, placeholders, sticky, form rules | L (14a, 14b) | 0.5     | done   |
| 15   | Shell: tab bar, logo, user menu, theme per user, version guard   | M            | 0.6     | done   |
| 16   | Platforms: macOS and Linux                                       | L (16a, 16b) | 0.7     | done   |
| 17   | Rapport fixes                                                    | M            | 0.8     | done   |
| 18   | Data format v3                                                   | M            | 0.9     | done   |
| 19   | Domain logic in `maatwerk-core`                                  | L (19a, 19b) | 0.10    | todo   |
| 20   | Toetsen: test kinds, attempts, test modals, resits               | L (20a, 20b) | 0.11    | todo   |
| 21   | PO a: Rubrics, observatie toetstype                              | L (21a, 21b) | 0.12    | todo   |
| 22   | PO b: PO in Toetsen, projectgroepen                              | L (22a, 22b) | 0.13    | todo   |
| 23   | PO c: PO beoordelen                                              | L (23a, 23b) | 0.14    | todo   |
| 24   | PO d: PO rapport                                                 | M            | 0.15    | todo   |
| 25   | Score entry                                                      | M            | 0.16    | todo   |
| 26   | Login and splash                                                 | M            | 0.17    | todo   |
| 27   | Leerlingen and Groepen cards                                     | M            | 0.18    | todo   |
| 28   | Beheer screens                                                   | M            | 0.19    | todo   |
| 29   | Overviews and profile                                            | L (29a, 29b) | 0.20    | todo   |
| 30   | Observaties and opdrachten                                       | M            | 0.21    | todo   |
| 31   | Opdrachten-editor                                                | M            | 0.22    | todo   |
| 32   | AI assistant                                                     | L (32a, 32b) | 0.23    | todo   |
| 33   | Hardening, dependencies, 1.0                                     | M            | 1.0     | todo   |

## 4. Steps

### Step 12: Triage and open decisions (S, user with Claude in chat)

Goal: every intake item has a priority and a step; the open decisions are taken.

- Fill in priority, size and area for each row in `ROADMAP.md` section 4, including the rest of
  `docs/phase-2/inventory.md` sections 1 and 3 (quirks: fix, keep or drop).
- Decide ROADMAP 7.3, 7.5, 7.6, 7.8-7.11 (see section 1). Record them in section 1 here and in
  `docs/adr/0010-phase-2-decisions.md`.
- Run `maatwerk-cli validate-data` on a copy of the real data folder and list the leftover
  folders and files for X-07 (no deletions yet).
- **Done when:** ROADMAP section 4 has no empty priority; section 1 here has no open item;
  STATE points to step 13.

### Step 13: Foundation a (M)

Items: R-03 (start), V-01, V-06, F-18 (CSS only), R-01, B8. Design: spec sections 2 and 3.1-3.2;
boards 1 and 4 (`Main.dc.html`, `Knoppen.dc.html`).

1. `ui/src/styles/tokens.css`: neutrals, 21 accents (`html[data-accent]`), light and dark
   (`html[data-theme]`), grade colours, radii, shadows, type scale. Theme and accent switchable
   from a dev-only menu for now.
2. One `formatGrade` / number format module (decimal comma, always one decimal: `7,0`) and one
   grade-colour module; replace the ~10 copies (B8, R-01). Unit tests.
3. Button component (primary, secondary, text, danger, icon; 36/30 px; focus, busy, disabled);
   replace every button style, the PIN buttons included.
4. Inputs, selects, steppers, segmented control, filter chips (active state), test-type badge
   (V-11 component; only toets and SE until step 18).
5. Remove the `u-*` utilities replaced so far; the rest go in later steps.

Tests: unit (formats, colours); visual baselines in light/blue, dark, and yellow (contrast edge
case). Stop and ask: visual diff before updating baselines.

### Step 14: Foundation b (L)

Items: R-02, V-08, V-09, V-10, U12, U14, U15, 8b m6. Design: spec 3.3, 3.4, 3.7-3.9; board 3.

- **14a:** the dialog component (fixed top 64 px, optional fixed height, sticky header slot with
  tabs, scrolling body, footer with the button rule, close guard, Escape, stacking); confirm and
  alert dialogs on it; skeleton helpers (pill, line, block; reduced motion); sticky screen headers
  on all five teacher tabs. Port three modals as the pattern (exam overview, rapport, group edit).
- **14b:** port every other modal; form-row helper for the label-aligned layout (3.7) and tick
  boxes (3.9); remove the old modal code and remaining `u-*` utilities in the touched files.

Tests: e2e: every modal opens at the same top; Escape closes; stacked dialogs keep their close
guard; a lazy modal does not change size while loading.

### Step 15: Shell (M)

Items: V-05, V-12, F-17, F-18 (persistence), F-21, B-04, B-08 (avatar helper), U11, U13, U16, decision 5. Design: spec
3.5, 3.6, 5; boards 1, 8, 12 (tab bar); `docs/phase-2/design/assets/`.

1. **Minimum app version** in `school.json` (`minAppVersion`); an older app opens read-only with a
   clear message. Test on fixtures; document in the runbook.
2. Tab bar: logo assets, tab icons (Lucide paths, ISC, add to `THIRD_PARTY_LICENSES.md`), active
   state; the admin's seven tabs with their icons.
3. User menu dropdown (theme, 21 accent swatches, foto wijzigen placeholder, pincode wijzigen,
   uitloggen).
4. Theme, accent, active school year (F-21) and (later) editor split in `gebruikers/<id>.json`
   (decisions 3 and 15): additive fields;
   check that 0.3.x keeps unknown fields when it saves a user (if not, the version guard covers
   it). Applied at login, before the first paint of the main screen.
5. One avatar helper (photo or initials, ring colour, round or square) used everywhere.

Tests: e2e theme/accent persist across logout and on a second "PC" (second data dir copy);
version guard e2e.

### Step 16: Platforms: macOS and Linux (L)

Items: X-04 (old `PLAN.md` step 11), new: Linux. Placed right after the foundation and the shell,
so every later visual step is checked on WebView2, WebKit (macOS) and WebKitGTK (Linux) through CI.

- **16a macOS:** CI job and universal build (`universal-apple-darwin`); WebKit check of the score
  grid, Chart.js, CodeMirror, pdf.js, the dialog component, sticky headers and the tab bar; a
  **first-run "choose data folder"** stored in the local config (a `.app` cannot reliably keep
  its data beside itself; also useful on Windows); fonts and emoji; signing and notarisation
  decision with the user (Apple Developer account) or documented right-click > Open instructions.
- **16b Linux:** CI job and build (AppImage and/or `.deb`); WebKitGTK check of the same list;
  **case-sensitive paths**: tests for a Windows-made data folder with mixed case (path helpers,
  migration, `validate-data`); document how the shared folder syncs without an official
  OneDrive client (rclone or a third-party client), as a choice for the user.
- From here on, the e2e and visual tests run on all three platforms in CI; visual baselines per
  platform where rendering differs.

Stop and ask: the signing decision; the Linux sync advice before it goes into the README.

### Step 17: Rapport fixes (M)

Items: B-06, B-07, F-13, F-04, T4, T7, T8, T10, T25 (per the step 12 triage). Area: Rapport.

1. Failing tests first for each bug; then the fixes in `rapport.typ` / `domain/rapport.ts`.
2. Duplex: when the leeradvies table reaches page 3, add an empty page 4.
3. Score dots larger only when the exam has half points.
4. Typst warnings shown in the rapport and generate modals.

Stop and ask: the Typst golden diffs (PNG) for every changed rapport.

### Step 18: Data format v3 (M)

Items: X-07, D20, decisions 6, 11, 13, 14, F-12 (data part), F-14 (data part). Data safety rules
apply in full. **Before the step:** the user runs `maatwerk-cli validate-data` on a copy of the real
data folder and shares the list of leftover folders and files (no student data).

1. `fotos/` -> `afbeeldingen/` (rapport mount `/data/afbeeldingen`), `users/` -> `aanwezigheid/`
   test kind and diagnostic fields with defaults (`kind: "toets"`, `diagnostic: false`), the observaties-on-
   resits field (copy at creation, locked), the opdracht link "score on question N below X".
2. Migration v2 -> v3 in `maatwerk-core::migrate`, `validate-data` updated, leftover folders
   listed and removed only after the user confirms. `schema_version` 3; `minAppVersion` raised.
3. Fixtures and the migration fixture updated; the existing migration tests extended.

Stop and ask: before running the migration on the copy of real data; before deleting leftovers.

### Step 19: Domain logic in `maatwerk-core` (L)

Items: R-04, B-02, B-03, B1-B8, B12-B19, B28-B31 (per triage), F-08 (trend helper), decision 7.9,
T9 (moved from step 17, user 2026-11-07).

**The rules are the user's decisions in `docs/phase-2/step-19-grade-rules.md` section 6.**

- **19a:** port attempts (best attempt), grade calculation, averages (weighted, SE), SD,
  percentages, RTTI statistics and the trend helper to a pure crate `maatwerk-grades` (re-exported
  by `maatwerk-core`) with unit tests; WebAssembly for the UI instead of Tauri commands (user,
  ADR-0011); the CLI gets `stats` for checking. The UI still uses its own code.
- **19b:** switch every screen, the rapport and the score grid to the core; delete the four JS
  implementations (B13); fix the B items as decided. T9: the histogram and ranking thresholds
  and texts agree (the ranking moves to the core with the other rapport numbers). Before/after
  tables for every number or text that changes, user approval before the merge.
- **PO (decision 16):** the core's statistics know `kind: "po"` (grade from the rubric points,
  no RTTI, counted with its weging and weging SE like a test); the PO grade function itself comes
  with step 21a.

### Step 20: Toetsen (L)

Items: V-11, F-12, B-05, B-01 (check) (the "+ PO toevoegen" button is step 22),
D5 of the implementation plan. Design: spec 2.5, 4.7, 4.11; boards 11, 14.

- **20a:** exam list (cards, badges, kind pills, legend, attempts tree open by default, lock pill);
  Nieuwe toets (steps, PTA and D boxes, aligned grid) and Toets bewerken (one top row, sticky
  question heading, solid segmented buttons, RTTI totals with percentages).
- **20b:** Nieuwe poging modal (Soort poging cards, Beschrijving filled and locked; observaties
  copied and locked); the summary overview shows observaties of resits (B-05).

### Step 21: PO a: Rubrics and the observatie toetstype (L)

Items: F-22 (rubrics), F-23 (toetstype), decisions 16, 20, 21, 23, 25. Design: spec 4.13 (Rubrics),
4.12 (toetstype field); boards 15, 16. Data safety rules apply (additive change within v3,
`minAppVersion` raised to this release).

- **21a, data and core:** `rubrics/<id>.json` (schema, `_meta`, CAS + rev like observaties):
  `{ id, naam, beschrijving?, subject, schoolsoort[], jaarlagen[], obs_ids[], categories: [{ id,
naam, max, soort: normaal|bonus|diagnostisch, obs_ids[], niveaus: [{ min, max, titel?, uitleg }]
}] }`. Core: level validation (2-5 levels, integer bounds, no shared min or max, cover 0..max
  without gaps), "in use" = referenced by any exam in any year, PO grade function (decision 16).
  Observatie field `toetstypes`; the migration step writes `["toets"]` where it is absent.
  `validate-data` knows both. Fixtures with three rubrics and PO observaties. Bindings, CLI
  `rubric check`.
- **21b, UI:** Rubrics tab (icon, for teachers and sectievoorzitters), rubric cards (categories as
  chips, totals, "In gebruik bij n PO's"), rubric editor (fixed-height dialog; per category name,
  max, soort, levels with the number-row display and live validation, category observaties of
  type PO; general observaties; Opslaan blocked while invalid; lock per decision 20), Dupliceren,
  delete guard. Observatie bewerken gets Toetstype; the test modals and the score grid list only
  `toets` observaties; the Observaties tab gets a toetstype filter chip.

Tests: unit (validation edge cases: touching intervals, overlaps, shared bounds, gaps, max change
on a locked rubric), e2e (create, edit, lock, duplicate), visual baselines after review.

### Step 22: PO b: PO in Toetsen and projectgroepen (L)

Items: F-20, F-22 (PO part), decisions 17, 18, 22. Design: spec 4.13; board 17.

- **22a:** exam `kind: "po"` with `rubric_id` and `projectgroepen: [{ id, naam?, student_ids[] }]`
  (no questions, no N-term); "+ PO toevoegen" next to "+ Toets toevoegen"; step 1 like Nieuwe
  toets with the filtered rubric dropdown, its category preview and the grade formula; PO card
  (striped badge, SE anti colour, the rubric line instead of RTTI, mean ± SD), the same ⋮ menu
  as a test; PO bewerken.
- **22b:** step 2 projectgroepen: unplaced students of all matching classes (class filter), groups
  with optional names, "lln"/"ll" counts, add by click or drag, "+ Projectgroep", "Willekeurig
  indelen…" (group size n, from the unplaced students), empty groups removed on save; regrouping
  later (decision 19, warning); PO herkansing (same rubric, groups copied and editable).

Tests: e2e for both steps including students of two classes in one projectgroep; core tests for
the PO grade in averages (with step 19's statistics: no RTTI for a PO).

### Step 23: PO c: PO beoordelen (L)

Items: F-22 (grading), decisions 17, 19, 24. Design: spec 4.13; board 18.

- **23a, score table:** read-only table grouped by projectgroep (sticky group headings with
  "Beoordelen" and status), categories as slanted headings with their max, Punten, Groep ±,
  Eigen ±, Cijfer; double-click a row opens the grading modal; "Projectgroepen" and
  "PO bewerken" in the header; unplaced students listed without a grade.
- **23b, grading modal:** per category the level cards (all levels whose interval contains the
  value are highlighted), slider, category observaties (type PO) and a comment; overall comment;
  group and individual bonus/malus lines; general observaties and live grades in the footer;
  Vorige/Volgende; autosave every 10 s and on closing (CAS per member file; conflict message).
  Score file: `scores[examId][categoryId]`, general observaties as for tests, and
  `po[examId] = { projectgroep, categoryObs, categoryComments, comment, groupLines, ownLines }`.
  PO grades in the averages, student and group cards, overviews; opdrachten genereren for a PO
  uses the general and category observaties.

Stop and ask: the before/after table for averages that now include PO grades.

### Step 24: PO d: PO rapport (M)

Items: F-22 (rapport). First a design round with the user in chat (layout of categories, level
descriptions, comments, bonus/malus, grade; one or two pages, duplex rule of step 17), then the
Typst template, `data.json` for a PO, goldens, and "Rapport genereren" for a PO. Stop and ask:
the design before building, and the golden PNGs.

### Step 25: Score entry (M)

Items: F-03, B4, B5, U5 (if not done in 19b), spec 4.10; board 13. Restyle, centred content,
header row with **?** first, sticky group heading, column headings and # / Naam columns, grade
cell colours, GEMIDDELDE and SD per group. Keyboard behaviour and saving unchanged
(`score-grid.spec.ts` stays green).

### Step 26: Login and splash (M)

Items: V-04, F-06, F-19 (crop modal shared with step 28). Design: spec 4.1, 4.2; boards 5, 6.
Splash inline in `index.html` (window background set in the Tauri config, no white flash); login
states with the FLIP avatar animation, inline PIN (one or two fields), reverse on "Andere
gebruiker", keyboard flow, reduced-motion fallback.

### Step 27: Leerlingen and Groepen cards (M)

Items: F-07, F-08 (UI), F-09, V-02. Design: spec 4.3, 4.4; board 1. Student cards (variant C, SE /
laatste swap in CSS), group cards (variant B), admin keeps the list. Stop and ask: the numbers on
the cards (before/after on fixtures).

### Step 28: Beheer screens (M)

Items: spec 4.9, F-02 (CSV example), F-19 (photo crop), D28, X-06 (if decided). Board 12.
Gebruikers (card actions order, Gebruiker bewerken with Afkorting + Kleur swatches and the crop),
School, Gegevenscontrole (findings as cards with actions), Instellingen (units, snapshot list),
CSV import example.

### Step 29: Overviews and profile (L)

Items: F-10, F-11, B-05 (check), profile restyle, B15/B16 (if not done in 19b). Design: spec 4.5,
4.6; board 3.

- **29a:** group overview modal: five tabs over the year, lazy with skeletons, 30 px rows, sticky
  `tfoot`, observaties "n (p%)".
- **29b:** exam overview (SD row, sticky footer, type colours in charts) and the student profile
  restyled on the dialog component.
- **PO:** the RTTI tabs and RTTI charts skip PO's; the results, distribution and boxplot include
  them (striped type colour); the profile shows a PO's categories instead of RTTI.

### Step 30: Observaties and opdrachten (M)

Items: F-14 (UI), F-15, T23 (moved from step 17, user 2026-11-07), spec 4.12; board 15. Observatie bewerken with the icon picker (200+ emoji,
categories, search); opdracht bewerken; opdrachten genereren with the new link type (`opdrachtenVraag`: a score
below X or `N` matches, an empty score not; data-files-v3); the batch
reports every failed opdracht, not only the first (T23).

### Step 31: Opdrachten-editor (M)

Items: V-07, F-05, F-16, V-03, T19/T20 (if kept), U10. Design: spec 4.8; board 10. Header and back
button, toolbar on top with dropdown groups, file tabs below it, status pill, draggable divider
(saved per user), smooth preview sync.

### Step 32: AI assistant (L)

Items: F-01, Step 9 m3 (time limit on the headless check/render), ADR-0009 option D.

- **32a:** the CLI bridge: detect installed CLIs, run them with the opdracht as context in a
  sandboxed temp folder, time limit, cancel; the result is a diff, never a direct write.
- **32b:** the rail and chat panel (spec 4.8), Bekijken/Toepassen on the diff card, a setting to
  turn it off; provider logos per their brand rules, recorded in `THIRD_PARTY_LICENSES.md`.

### Step 33: Hardening, dependencies, 1.0 (M)

Items: X-01 (Typst upgrade, golden diff with the user), X-02, X-05, the remaining R-05 files and
compat layer, backlog cleanup, `/security-review`, whole-codebase review by a fresh reviewer,
README and screenshots, release 1.0.

## 5. Prompts for the user to paste

**Start of phase 2 (after step 12)**

> Read CLAUDE.md, PLAN-2.md sections 1-3 and docs/STATE.md, then do step 13. Stop before
> updating the visual baselines and show me the diff.

**Every later session**

> Read PLAN-2.md sections 1-3 and docs/STATE.md, then continue with the next action. Stop at the
> end of the step and report.
