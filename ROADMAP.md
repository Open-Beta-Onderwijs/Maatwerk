# Maatwerk: phase 2 roadmap (after the cutover)

**Status: intake filled in (2026-11-04).** The user's feature and bug list of 2026-11-04 is in
section 4; priorities, sizes and the step order follow in the triage session. Phase 1
(`PLAN.md`, Steps 0-10) is the port of the Electron app with parity to the old output. It ends
with the cutover to real data. Phase 2 is this file: new features, bug fixes, visual changes and
the refactor, with no parity constraint.

Once phase 2 starts, `PLAN.md` is frozen as history and `CLAUDE.md` points sessions here instead
(read sections 1-3 of this file and `docs/STATE.md`, then the current step only).

## 1. Context

- The app and its architecture are as built in phase 1: `PLAN.md` section 1 (decisions) and
  section 4, ADR-0002 (target architecture) and the ADRs after it.
- **Parity no longer binds.** The old app is out of use after the cutover. The Typst and domain
  goldens remain regression tests, but they can be updated on purpose. Quirks become ordinary
  bugs, fixed or kept by decision.
- **Real data exists.** Teachers use the app daily on a shared OneDrive folder. Anything that
  changes saved data, the data format or what teachers see (grades, statistics, rapport output)
  needs the user's decision, and a migration where the format changes.
- Inputs for the plan: `docs/phase-2/inventory.md` (quirks, backlog, UI duplication) plus the
  user's lists of features and visual changes.
- **Design:** `docs/phase-2/design/README.md` (spec, tokens, screens) and
  `docs/phase-2/design/implementation-plan.md` (sub-steps D1-D6 inside the steps below). Every
  visual item follows the spec.

## 2. Working rules

**Unchanged from `PLAN.md` section 2:** the session protocol, the gate, the reviewer subagent at
the end of every step, git (branch per step, merge commit, tags, `main` always green),
conventional commits, the licence and SPDX rules, no real student data, the path rules,
`spawn_blocking` for heavy work, failing test first for bugs, and STATE updates.

**Changed for phase 2:**

1. **Goldens are regression tests, not the reference's record.** A change to a golden is allowed
   when it is the intended result of an item in this roadmap. The commit says which item, and the
   user has seen the visual diff (`npm run test:visual`, the Typst PNGs).
2. **Quirks.** `docs/reference/quirks.md` is closed for new entries. New findings go into the
   intake list (section 4) as B items. Fixing an old quirk updates its entry ("Fixed in phase 2,
   step X").
3. **`_reference/` is history.** It may still be read to understand intent. It is no longer the
   source of truth, and the harness that regenerates reference goldens is not run any more.
4. **Every step touches one area completely** (section 5): its refactor, bug fixes, features and
   visual changes together, so each module is opened, tested and reviewed once.
5. **Data safety first.** A step that changes saved data or the data format writes a migration,
   a test on the fixtures, and a manual check on a copy of real data before release. Old app
   versions on colleagues' PCs: say what happens when a colleague has not updated yet.
6. **Releases.** Every step ends in a release the user can install (version bump, tag, CI exe).
   Versioning policy: to decide (section 7).

**Stop and ask the user (in addition to `PLAN.md` 2.6):** any change to grades, statistics or
rapport output; any visible change not in the user's lists; data-format changes; dropping a
feature.

## 3. Status

| Step         | Title                         | State                         |
| ------------ | ----------------------------- | ----------------------------- |
| 10 (phase 1) | Cutover readiness (`PLAN.md`) | done (`step-10`, `v0.3.2`)    |
| -            | Cutover                       | done (user, 2026-11)          |
| P0           | Triage session (user)         | done (`PLAN-2.md` step 12)    |
| PD           | Design pass (user + Claude)   | done (`docs/phase-2/design/`) |

## 4. Intake list

One table per type. The triage session fills in priority, size and area for each item. Items
from the inventory keep their old ID in "Source".

- **IDs:** `F-nn` feature, `B-nn` bug or quirk, `V-nn` visual change, `R-nn` refactor, `X-nn`
  cross-cutting (dependencies, CI, platforms). Never reuse an ID.
- **Priority:** P1 (soon: teachers hit it), P2 (planned), P3 (some day), Won't.
- **Size:** S (under a session), M (a few sessions), L (a step on its own).
- **Area:** see section 5. **User?** yes when it needs the user's decision or eye.

### 4.1 Features (F)

| ID   | What                                                                                                                                                                                                                                                                                                                                                                                                   | Area                 | Pri | Size | User?              | Source                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- | --- | ---- | ------------------ | ---------------------------------- |
| F-01 | AI assistant on the teacher's own AI CLI. UI: a vertical rail of provider logos on the right of the editor (Claude, ChatGPT, Mistral, Gemini, DeepSeek, Copilot); clicking one slides open a chat panel for that CLI. The plumbing partly exists, the visual layer does not. Check each provider's logo usage terms                                                                                    | Opdrachten           | P2  | L    | yes (design)       | ADR-0009 option D; user 2026-11-04 |
| F-02 | CSV import: example CSV shown and downloadable                                                                                                                                                                                                                                                                                                                                                         | Admin                | P2  | S    |                    | backlog M-LEER-3, M-GRP-3          |
| F-03 | Ctrl+X in the score grid                                                                                                                                                                                                                                                                                                                                                                               | Scores               | P2  | S    |                    | backlog 3b m5                      |
| F-04 | Show Typst warnings in the editor, generate and rapport modals                                                                                                                                                                                                                                                                                                                                         | Opdrachten / Rapport | P2  | S    |                    | backlog 6a                         |
| F-05 | Editor: show that a compile is still running (spinner or similar)                                                                                                                                                                                                                                                                                                                                      | Opdrachten           | P2  | S    | yes                | manual test 10 M-OPD-11            |
| F-06 | Splash screen with the Maatwerk logo instead of the short white screen at start; visible only while loading (longer on slow PCs)                                                                                                                                                                                                                                                                       | Shell                | P2  | S    | yes (design)       | user 2026-11-04                    |
| F-07 | Leerlingen tab: student cards in a grid (left to right, top to bottom) instead of list rows. Left: name and student number. Right: last grade, year average (coloured), trend arrow (F-08), sparkline of the grades. SE average only in years 4-6. Only for teachers and sectievoorzitters; the admin keeps the plain list (not tied to a vak, so no grades). Existing filters and search keep working | Admin                | P2  | M    | yes (design)       | user 2026-11-04                    |
| F-08 | Trend arrow, one shared helper: last grade minus year average. > +1,0 strongly up (saturated green); +0,5..+1,0 slightly up; -0,5..+0,5 level (right); -1,0..-0,5 slightly down; < -1,0 strongly down (saturated red). Used by F-07 and F-10. Decide which grade is "last" (best attempt?) and which average (weighted?) together with B-02/B-03                                                       | Domain               | P2  | S    | yes                | user 2026-11-04                    |
| F-09 | Groepen tab: group cards side by side instead of rows. Card: group name, teacher(s), schoolsoort, student names; right: mean ± SD and % onvoldoende (today's line, moved). SE average only for upper-school groups (4-6). No trend per group                                                                                                                                                           | Admin                | P2  | M    | yes (design)       | user 2026-11-04                    |
| F-10 | Group overview modal: an SD row under the average; trend arrows (F-08) after the student names; five tabs from the exam overview, over the whole year: Resultaten (today's table), Cijferverdeling (one chart per exam, stacked), Boxplot (one per exam, each its own colour), RTTI-analyse (course through the year), Observaties (course through the year). No vraaganalyse                          | Overzicht            | P2  | L    | yes (design)       | user 2026-11-04                    |
| F-11 | Exam overview modal, Resultaten: average at the bottom plus an SD row. Other tabs unchanged                                                                                                                                                                                                                                                                                                            | Overzicht            | P2  | S    |                    | user 2026-11-04                    |
| F-12 | Inhaal and herkansing exams get the original's observaties when created; locked, not editable separately. Fixes B-05. Decide what happens to existing resits (backfill or not)                                                                                                                                                                                                                         | Toetsen              | P1  | M    | yes (data)         | user 2026-11-04                    |
| F-13 | Rapport, duplex-safe: when the leeradvies table lands on a third page, add an empty fourth page, so each student is always two full A4 sheets                                                                                                                                                                                                                                                          | Rapport              | P1  | S    | yes (output)       | user 2026-11-04                    |
| F-14 | Opdrachten genereren: link an opdracht to a score below a threshold on one specific question (for example question 7, max 4 points, the student scores 0 or 1). Linking by observatie and by grade threshold work and stay. New link type on the exam (`opdrachtenVraag`; was "in `opdracht.json`", user 2026-11-07); `N` matches, an empty score does not                                             | Opdrachten           | P2  | M    | yes (data)         | user 2026-11-04                    |
| F-15 | Observaties: emoji list from ~30-40 to at least 200, adding emoji for the science subjects and for learning and school in general, on top of the current ones                                                                                                                                                                                                                                          | Observaties          | P2  | S    | yes                | user 2026-11-04                    |
| F-16 | Editor: draggable divider between the editor and the PDF viewer                                                                                                                                                                                                                                                                                                                                        | Opdrachten           | P2  | S    |                    | user 2026-11-04                    |
| F-17 | User menu top right as a small dropdown instead of the overlay modal: Uitloggen, Pincode wijzigen, Thema (F-18), Foto wijzigen (F-19)                                                                                                                                                                                                                                                                  | Shell                | P2  | S    | yes (design)       | user 2026-11-04                    |
| F-18 | Themes: light/dark toggle (default light) and 21 accent colours (the 7 rainbow colours plus two rows grouped under them, including black; design spec 2.2); titles, buttons and tabs follow the accent. Dark: dark background, inverted watermark, cards a slightly different shade. A new colour scheme for both (part of R-03). Remembered per user                                                  | Foundation           | P2  | M    | yes (design, data) | user 2026-11-04                    |
| F-19 | Change your own photo (not the name): non-square images allowed, the user drags/selects the 1:1 crop, saved and shown from then on. With B-04 and D28                                                                                                                                                                                                                                                  | Shell                | P2  | M    | yes (design)       | user 2026-11-04                    |
| F-20 | Praktische opdracht (PO) as its own test kind: a separate "+ PO toevoegen" button on the Toetsen tab and its own modal (design still to do). Badge per V-11                                                                                                                                                                                                                                            | Toetsen              | P3  | M    | yes (design, data) | user 2026-11-04                    |
| F-21 | Active school year per user (quirk D7): stored with the user like the theme; default the current school year                                                                                                                                                                                                                                                                                           | Shell                | P2  | S    |                    | triage 2026-11-04                  |

### 4.2 Bugs and quirks (B)

| ID   | What                                                                                                                              | Area       | Pri  | Size | User?        | Source                       |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---- | ---- | ------------ | ---------------------------- |
| B-01 | Adding a question after a deletion can repeat a question id                                                                       | Toetsen    | Done | S    |              | quirk B24                    |
| B-02 | Best-attempt logic in four places, with different edge cases                                                                      | Domain     | P1   | M    | yes          | quirk B13, B15, B18          |
| B-03 | Grade and statistics differences between screens                                                                                  | Domain     | P1   | M    | yes          | quirks B1-B8, B12, B14, U5   |
| B-04 | User photos look inconsistent across the app (re-check after 7b)                                                                  | Shell      | P2   | S    | yes          | manual test 6 and 10 M-ADM-1 |
| B-05 | Summary overview shows no observaties for students who took an inhaal or herkansing (fixed by F-12; the overview then shows them) | Overzicht  | P1   | S    |              | user 2026-11-04              |
| B-06 | Rapport leeradvies table: the "score" column is a few characters too narrow and wraps over several lines                          | Rapport    | P1   | S    | yes (output) | user 2026-11-04              |
| B-07 | Rapport score dots: half points (1,5 / 2,5) do not fit. Make the dots larger, only when the exam has half points                  | Rapport    | P1   | S    | yes (output) | user 2026-11-04              |
| B-08 | Editor window: the user button top right has no photo or initials (it does elsewhere). With B-04                                  | Opdrachten | P2   | S    |              | user 2026-11-04              |
|      | _rest of inventory section 1, after triage_                                                                                       |            |      |      |              |                              |

### 4.3 Visual changes (V)

| ID   | What                                                                                                                                                                                                                                                                  | Area                   | Pri | Size | User?        | Source                 |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | --- | ---- | ------------ | ---------------------- |
| V-01 | Consistent grade pills, paddings and greys (from the CSS cleanup)                                                                                                                                                                                                     | Foundation             | P2  | M    | yes          | backlog 3a             |
| V-02 | Period separators in the group students modal                                                                                                                                                                                                                         | Admin                  | P3  | S    | yes          | quirk U18              |
| V-03 | Editor preview sync scrolls smoothly instead of jumping                                                                                                                                                                                                               | Opdrachten             | P2  | S    | yes          | manual test 10 M-OPD-8 |
| V-04 | Login screen redesign: much larger vak tiles; selecting a vak animates (slide) and reveals its users; the split teachers / sectievoorzitters / administrators stays; PIN entry unchanged                                                                              | Shell                  | P2  | M    | yes (design) | user 2026-11-04        |
| V-05 | Tab bar with icons: Leerlingen one person, Groepen several people, Toetsen exam sheet with a grade, Observaties eye or magnifier, Opdrachten puzzle piece                                                                                                             | Shell                  | P2  | S    | yes (design) | user 2026-11-04        |
| V-06 | One button style for the whole app; remove duplicate and deviating styles (also the PIN buttons). With R-03                                                                                                                                                           | Foundation             | P2  | M    | yes          | user 2026-11-04        |
| V-07 | Editor header redesign: the large top bar is not used well. Back button "← Terug naar opdrachten" replaces the "Maatwerk" link to the main menu                                                                                                                       | Opdrachten             | P2  | S    | yes (design) | user 2026-11-04        |
| V-08 | All modals open at the same height (fixed top), not vertically centred, so the top edge stays in one place. With R-02                                                                                                                                                 | Foundation             | P2  | S    | yes          | user 2026-11-04        |
| V-09 | Placeholders (skeletons) while data lazy-loads, replaced by the real data, so modals and screens do not change size or jump                                                                                                                                           | Foundation + each area | P2  | M    | yes          | user 2026-11-04        |
| V-10 | Sticky headers: the header of every modal and tab stays visible, only the content scrolls                                                                                                                                                                             | Foundation             | P2  | S    | yes          | user 2026-11-04        |
| V-11 | Test-type colours on every test badge: toets = accent, praktische opdracht = accent striped, SE-toets = the accent's opposite colour, SE praktische opdracht = opposite striped, diagnostisch = grey outline (counts for neither rapport nor SE). Needs decision 7.11 | Foundation + Toetsen   | P2  | M    | yes (data)   | design pass 2026-11-04 |
| V-12 | New wordmark and tab-bar logo (icon unchanged): `docs/phase-2/design/assets/`                                                                                                                                                                                         | Foundation + Shell     | P2  | S    |              | design pass 2026-11-04 |

### 4.4 Refactors (R)

| ID   | What                                                                              | Area       | Pri | Size | User? | Source                    |
| ---- | --------------------------------------------------------------------------------- | ---------- | --- | ---- | ----- | ------------------------- |
| R-01 | Shared helpers: number/grade formatting, `el()`, `studentVersions`                | Foundation | P1  | S    |       | inventory section 3       |
| R-02 | One modal/dialog component (stacking, close guard, replaces `window.confirm`)     | Foundation | P1  | M    |       | U12, U14, U15, 8b m6      |
| R-03 | `style.css`: design tokens and component classes instead of `u-*` utilities       | Foundation | P1  | L    | yes   | backlog 3a                |
| R-04 | Domain logic: statistics and attempts in one place (JS domain or `maatwerk-core`) | Domain     | P1  | L    | yes   | PLAN section 9 decision 4 |
| R-05 | JS to TS, per area, removing the compat layer for that area                       | each area  | P2  | -    |       | backlog 6b                |
|      | _rest of inventory section 3_                                                     |            |     |      |       |                           |

### 4.5 Cross-cutting (X)

| ID   | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Pri | Size | User?             | Source          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- | ---- | ----------------- | --------------- |
| X-01 | Upgrade Typst from 0.14.2 (with Noto, quick-xml advisories, goldens)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | P2  | M    | yes (visual diff) | backlog         |
| X-02 | pdf.js, Chart.js and the annotation plugin past the reference versions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | P3  | S    |                   | backlog 3a      |
| X-03 | Tauri 3 when stable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | P3  | M    |                   | backlog         |
| X-04 | macOS and Linux (old `PLAN.md` Step 11): `PLAN-2.md` step 16                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | P2  | L    | yes               | PLAN Step 11    |
| X-05 | CI and test hygiene (inventory section 2, "Tests and CI")                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | P2  | M    |                   | backlog         |
| X-06 | `rapporten/` retention policy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | P3  | S    | yes               | backlog         |
| X-07 | Data folder cleanup and renames: (a) list leftover folders and files in the real `data/` that v2 does not use (`validate-data` reports unknown entries; cleanup only after the user confirms); (b) rename `fotos/` to `afbeeldingen/` (it also holds the school logo and watermark; the rapport mount `/data/fotos` moves with it); (c) `users/` is **not** unused: it holds the presence files (who is online), `gebruikers/` holds the accounts. Proposal: rename `users/` to `aanwezigheid/` for clarity. (b) and (c) change the data format: v3 migration, and see decision 7.4 (old app versions would recreate `fotos/` and not see each other online) | P2  | M    | yes (data)        | user 2026-11-04 |
| X-08 | Synthetic fixtures with more observaties on exams, so the exam overview's Observaties tab and F-10 can be checked                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | P2  | S    |                   | user 2026-11-04 |

### 4.6 Triage (step 12, 2026-11-04)

Every item has a priority (P1 soon, P2 planned, P3 some day, Won't) and the `PLAN-2.md` step that
does it.

| ID   | Pri  | Step             |
| ---- | ---- | ---------------- |
| F-01 | P2   | 28               |
| F-02 | P2   | 24               |
| F-03 | P2   | 21               |
| F-04 | P2   | 17               |
| F-05 | P2   | 27               |
| F-06 | P2   | 22               |
| F-07 | P2   | 23               |
| F-08 | P2   | 19, 23           |
| F-09 | P2   | 23               |
| F-10 | P2   | 25               |
| F-11 | P2   | 25               |
| F-12 | P1   | 18, 20           |
| F-13 | P1   | 17               |
| F-14 | P2   | 18, 26           |
| F-15 | P2   | 26               |
| F-16 | P2   | 27               |
| F-17 | P2   | 15               |
| F-18 | P2   | 13, 15           |
| F-19 | P2   | 24               |
| F-20 | P3   | after its design |
| F-21 | P2   | 15               |
| B-01 | Done | 10               |
| B-02 | P1   | 19               |
| B-03 | P1   | 19               |
| B-04 | P2   | 15               |
| B-05 | P1   | 20               |
| B-06 | P1   | 17               |
| B-07 | P1   | 17               |
| B-08 | P2   | 15               |
| V-01 | P2   | 13               |
| V-02 | P3   | 23               |
| V-03 | P2   | 27               |
| V-04 | P2   | 22               |
| V-05 | P2   | 15               |
| V-06 | P2   | 13               |
| V-07 | P2   | 27               |
| V-08 | P2   | 14               |
| V-09 | P2   | 14 + areas       |
| V-10 | P2   | 14               |
| V-11 | P2   | 13, 20           |
| V-12 | P2   | 15               |
| R-01 | P1   | 13               |
| R-02 | P1   | 14               |
| R-03 | P1   | 13, 14           |
| R-04 | P1   | 19               |
| R-05 | P2   | every step       |
| X-01 | P2   | 29               |
| X-02 | P3   | 29               |
| X-03 | P3   | after 1.0        |
| X-04 | P2   | 16               |
| X-05 | P2   | 29 + ongoing     |
| X-06 | P3   | 24               |
| X-07 | P2   | 18               |
| X-08 | P2   | 19               |

**Old quirks** (`docs/phase-2/inventory.md` section 1):

| Quirk                                                      | Decision                                                                   | Step |
| ---------------------------------------------------------- | -------------------------------------------------------------------------- | ---- |
| B1-B8, B12-B16, B19, B28, B31                              | Fix in the core; every changed number in a before/after table for the user | 19   |
| B3 (empty question: 0 for the grade, left out of RTTI)     | Verify; probably intended, ask the user with an example                    | 19   |
| B10, B11, B12 (rapport numbers)                            | Fix when the rapport switches to the core                                  | 19b  |
| B17, B18 (Cijfer onder)                                    | Fix with the opdrachten-genereren rework                                   | 26   |
| B20 (empty lists: availability vs fit)                     | Fix                                                                        | 26   |
| B23 (hex/exponent score input)                             | Fix                                                                        | 21   |
| B27 (volgnummer > 99)                                      | Won't (unlikely)                                                           | -    |
| B29 (calcGrade bounds)                                     | Verify, fix if not equivalent                                              | 19   |
| B30 (partial warning)                                      | Fix                                                                        | 21   |
| T4, T10 (rapport crashes on edge data)                     | Verify, fix                                                                | 17   |
| T5, T6 (Typst values, float noise)                         | Fix (T6 visible); T5 keep unless it bites                                  | 17   |
| T7 (fractional scores truncated in the scoretabel)         | Fix (visible wrong data)                                                   | 17   |
| T8 (footer "/ 2"), T25 (lang)                              | Fix                                                                        | 17   |
| T9 (histogram texts)                                       | Fix with the rapport numbers in the core (user 2026-11-07)                 | 19b  |
| T19, T20                                                   | Keep (rare; editor warns)                                                  | -    |
| T23 (batch reports only the first failure)                 | Fix with the opdrachten-genereren rework (user 2026-11-07)                 | 26   |
| T24 (merge drops PDF metadata)                             | Won't                                                                      | -    |
| D4, D16, D17                                               | Verify                                                                     | 19   |
| D7 (active year shared)                                    | Fix: per user (F-21)                                                       | 15   |
| D11 (image changes not watched)                            | P3                                                                         | -    |
| D20 (presence race, files never deleted)                   | Fix with the `aanwezigheid/` rename                                        | 18   |
| D24 (dead store handlers), D26 (deleteFile result ignored) | Fix                                                                        | 19   |
| D27 (image copy without subfolders)                        | Verify                                                                     | 26   |
| D28 (photo name vs user id), D29 (watermark always SVG)    | Fix                                                                        | 24   |
| U5                                                         | Fix                                                                        | 21   |
| U10                                                        | Refactor                                                                   | 27   |
| U11 (filter listeners pile up)                             | Fix                                                                        | 15   |
| U12, U14, U15                                              | Fixed by the dialog component                                              | 14   |
| U13, U16                                                   | Verify superseded, remove dead code                                        | 15   |
| U17 (smaller observations)                                 | Ask the user what is meant                                                 | 26   |
| U18                                                        | = V-02                                                                     | 23   |
| Backlog robustness, Typst, tests (inventory section 2)     | Into step 29 unless a step above names them                                | 29   |

## 5. Areas

Steps are cut along these areas. The files listed are the current main ones.

| Area                  | Main files                                                                                                | Inventory items                       |
| --------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Foundation            | `style.css`, modal and dialog code, shared utils, `bridge/`                                               | R-01..03, V-01                        |
| Domain                | `store.js`, `domain/`, possibly `maatwerk-core`                                                           | B1-B31 (most), R-04                   |
| Scores                | `screens/scores.js`, `components/score-grid/`, `domain/scoregrid.ts`                                      | B4, B5, U5, 3b items                  |
| Toetsen               | `screens/toetsen.js`, `modals/toets-edit.js`, `modals/herkansing.js`                                      | B23, B24, U8                          |
| Overzicht and profiel | `modals/toets-overzicht.js`, `modals/profiel.js`                                                          | B2, B6, B7, B14-B16                   |
| Rapport               | `modals/rapport.js`, `domain/rapport.ts`, `rapport.typ`                                                   | B10-B12, T4-T10, T25                  |
| Opdrachten and editor | `screens/opdrachten.js`, `modals/opdrachten-genereren.js`, `editor-init.js`, `editor-live.ts`             | T19, T20, T23, U10, 8a/8b items, F-01 |
| Admin                 | `screens/leerlingen.js`, `groepen.js`, `gebruikers.js`, `school.js`, `modals/groep-*`, `leerling-edit.js` | D28, D29, U18, CSV                    |
| Shell                 | `app.js`, login, filters, startup, navigation                                                             | U11, U13                              |

## 6. Steps

The steps are in `PLAN-2.md` (steps 12-29, each one or two 5-hour sessions). This file keeps the
item lists; `PLAN-2.md` decides the order and the scope per session.

## 7. Decisions

All decided (2026-11-04); details in `PLAN-2.md` section 1 and
`docs/adr/0010-phase-2-decisions.md`: 1 Rust core; 2 0.x per step, 1.0 at the end; 3 real-data
test only for steps that touch data; 4 minimum app version in `school.json`; 5 old goldens
replaced step by step; 6 AI assistant in step 28; 7 theme, accent, divider and active year per
user in `gebruikers/<id>.json`; 8 data v3 renames `fotos/` and `users/`; 9 trend arrow = best
attempt of the latest counted test minus the weighted year average; 10 existing resits get the
original's observaties in the v3 migration; 11 exam fields `kind: "toets" | "po"` and
`diagnostic: bool`.
