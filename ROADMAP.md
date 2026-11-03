# Maatwerk: phase 2 roadmap (after the cutover)

**Status: draft skeleton (2026-11-03).** Filled in after the user's triage session. Phase 1
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

| Step         | Title                         | State       |
| ------------ | ----------------------------- | ----------- |
| 10 (phase 1) | Cutover readiness (`PLAN.md`) | not started |
| -            | Cutover                       | not started |
| P0           | Triage session (user)         | not started |

## 4. Intake list

One table per type. The triage session fills in priority, size and area for each item. Items
from the inventory keep their old ID in "Source".

- **IDs:** `F-nn` feature, `B-nn` bug or quirk, `V-nn` visual change, `R-nn` refactor, `X-nn`
  cross-cutting (dependencies, CI, platforms). Never reuse an ID.
- **Priority:** P1 (soon: teachers hit it), P2 (planned), P3 (some day), Won't.
- **Size:** S (under a session), M (a few sessions), L (a step on its own).
- **Area:** see section 5. **User?** yes when it needs the user's decision or eye.

### 4.1 Features (F)

| ID   | What                                                           | Area                 | Pri | Size | User? | Source                    |
| ---- | -------------------------------------------------------------- | -------------------- | --- | ---- | ----- | ------------------------- |
| F-01 | AI assistant on the teacher's own AI CLI                       | Opdrachten           |     | L    |       | ADR-0009 option D         |
| F-02 | CSV import: example CSV shown and downloadable                 | Admin                |     | S    |       | backlog M-LEER-3, M-GRP-3 |
| F-03 | Ctrl+X in the score grid                                       | Scores               |     | S    |       | backlog 3b m5             |
| F-04 | Show Typst warnings in the editor, generate and rapport modals | Opdrachten / Rapport |     | S    |       | backlog 6a                |
|      | _user's list_                                                  |                      |     |      |       |                           |

### 4.2 Bugs and quirks (B)

| ID   | What                                                         | Area    | Pri              | Size | User? | Source                     |
| ---- | ------------------------------------------------------------ | ------- | ---------------- | ---- | ----- | -------------------------- |
| B-01 | Adding a question after a deletion can repeat a question id  | Toetsen | Moved to Step 10 | S    |       | quirk B24                  |
| B-02 | Best-attempt logic in four places, with different edge cases | Domain  |                  | M    | yes   | quirk B13, B15, B18        |
| B-03 | Grade and statistics differences between screens             | Domain  |                  | M    | yes   | quirks B1-B8, B12, B14, U5 |
|      | _rest of inventory section 1, after triage_                  |         |                  |      |       |                            |
|      | _user's list_                                                |         |                  |      |       |                            |

### 4.3 Visual changes (V)

| ID   | What                                                              | Area       | Pri | Size | User? | Source     |
| ---- | ----------------------------------------------------------------- | ---------- | --- | ---- | ----- | ---------- |
| V-01 | Consistent grade pills, paddings and greys (from the CSS cleanup) | Foundation |     | M    | yes   | backlog 3a |
| V-02 | Period separators in the group students modal                     | Admin      |     | S    | yes   | quirk U18  |
|      | _user's list_                                                     |            |     |      |       |            |

### 4.4 Refactors (R)

| ID   | What                                                                              | Area       | Pri | Size | User? | Source                    |
| ---- | --------------------------------------------------------------------------------- | ---------- | --- | ---- | ----- | ------------------------- |
| R-01 | Shared helpers: number/grade formatting, `el()`, `studentVersions`                | Foundation |     | S    |       | inventory section 3       |
| R-02 | One modal/dialog component (stacking, close guard, replaces `window.confirm`)     | Foundation |     | M    |       | U12, U14, U15, 8b m6      |
| R-03 | `style.css`: design tokens and component classes instead of `u-*` utilities       | Foundation |     | L    | yes   | backlog 3a                |
| R-04 | Domain logic: statistics and attempts in one place (JS domain or `maatwerk-core`) | Domain     |     | L    | yes   | PLAN section 9 decision 4 |
| R-05 | JS to TS, per area, removing the compat layer for that area                       | each area  |     |      |       | backlog 6b                |
|      | _rest of inventory section 3_                                                     |            |     |      |       |                           |

### 4.5 Cross-cutting (X)

| ID   | What                                                                   | Pri | Size | User?             | Source       |
| ---- | ---------------------------------------------------------------------- | --- | ---- | ----------------- | ------------ |
| X-01 | Upgrade Typst from 0.14.2 (with Noto, quick-xml advisories, goldens)   |     | M    | yes (visual diff) | backlog      |
| X-02 | pdf.js, Chart.js and the annotation plugin past the reference versions |     | S    |                   | backlog 3a   |
| X-03 | Tauri 3 when stable                                                    |     | M    |                   | backlog      |
| X-04 | macOS (old `PLAN.md` Step 11)                                          |     | M    | yes               | PLAN Step 11 |
| X-05 | CI and test hygiene (inventory section 2, "Tests and CI")              |     | M    |                   | backlog      |
| X-06 | `rapporten/` retention policy                                          |     | S    | yes               | backlog      |

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

## 6. Steps (proposal, to be confirmed after triage)

Order: foundation first, because every area step builds on it; then the domain, because the
grade fixes must be made once before the screens that show them are reworked; then the areas by
the user's priorities. The AI assistant and macOS slot in wherever the user wants them.

### Step 10 (phase 1): Cutover readiness

In `PLAN.md`. Only what has to be done before teachers switch: error handling and the log, the
security audits, a performance check, the README and the release process, and the robustness
items in inventory section 2 "Needed before the cutover".

### P0: Triage session (user, with Claude)

Go through the inventory and the user's lists. For each item: priority, area, keep or fix
(quirks), "needs user". Decide the open questions in section 7. Result: section 4 filled in,
section 6 confirmed.

### P1: Foundation (L)

R-01, R-02, R-03 and V-01: shared helpers, the dialog component, design tokens and component CSS,
the typed error display. The visual baselines change once, with the user's review. Possibly X-01
(Typst upgrade) as a separate sub-step, because it changes the Typst goldens.

### P2: Domain (L)

R-04 and the B items about grades, statistics and attempts. Decide first where the logic lives.
Every number that changes gets a before/after table on the fixtures for the user to approve.

### P3..Pn: Area steps (M or L each)

One per area, in the user's priority order. Each one covers:

1. JS to TS for the area's files, splitting files over ~500 lines into cohesive modules, and
   removing the compat layer for the area's commands.
2. The area's B, F and V items.
3. Tests: unit tests for the domain parts, e2e for the flows, and visual baselines updated after
   the user's review.
4. Gate, review and a release.

### Separate steps

- **F-01 AI assistant (L):** needs the Opdrachten area step first (or together), plus Step 9 m3
  (time limit on the headless check).
- **X-04 macOS (M):** when needed.

## 7. Open decisions (for the triage session)

1. **Domain logic location** (`PLAN.md` section 9, decision 4): keep the domain in TS, or move
   statistics and attempts to `maatwerk-core`. Decides how P2 is built.
2. **Versioning after the cutover:** 0.x minor per step, or 1.0 at the cutover.
3. **Release cadence and testing on real data:** a manual test on a copy of real data for every
   release, or only for steps that touch data.
4. **Colleagues on old versions:** is a minimum app version needed (for example a field in
   `school.json`), so a data change is not written by an outdated app?
5. **Goldens of the old app:** keep them as regression tests where they still apply, or replace
   them with goldens of the new output step by step.
6. **When the AI assistant comes** relative to the area steps.
