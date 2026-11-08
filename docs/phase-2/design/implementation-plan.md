# Implementation plan: phase 2 redesign

How to build the design in [`README.md`](README.md). It slots into the ROADMAP steps (section 6);
it does not replace them. Every sub-step follows the ROADMAP working rules (branch, gate, reviewer,
release, STATE updates). Read the matching section of the design spec and the mock file before
starting a sub-step.

## 0. Ground rules for the redesign

1. **The spec wins over the mocks.** Mocks give exact sizes and states; rebuild with the app's own
   components, never paste mock markup or its `renderVals()` scripts into the app.
2. **Visual baselines change on purpose.** Each sub-step updates `npm run test:visual` baselines
   after the user has seen the diff (ROADMAP 2, rule 1). Name the roadmap items in the commit.
3. **No new numbers without approval.** Trend arrows, SD rows and SE averages show values that are
   not on screen today. Before a sub-step shows them, make a before/after table on the fixtures
   and ask the user (ROADMAP "stop and ask": statistics).
4. **Data-format changes** (theme per user, test kind, observaties on resits) need a migration,
   fixture tests and the old-version check (ROADMAP 2, rule 5). They are marked **(data)** below.
5. **Licences:** Lucide icon paths (ISC) and Archivo Black (OFL, only if set as live text) go into
   `THIRD_PARTY_LICENSES.md`. Provider logos for the AI rail: follow each brand's guidelines and
   record where each file came from.
6. **Accessibility:** contrast ≥ 4.5:1, `prefers-reduced-motion` fallbacks, keyboard access
   (spec section 6). Add an e2e check for reduced motion where an animation carries meaning.

## D1. Foundation (part of ROADMAP P1, with R-02, R-03, V-01)

**Items:** F-18, V-05, V-06, V-08, V-09 (component), V-10, V-12, F-17, V-11 (badge component
only).

1. **Tokens (R-03):** `ui/src/styles/tokens.css` with spec 2.1–2.7 as custom properties; themes
   via `html[data-theme]`, accents via `html[data-accent]` (ten blocks). Replace hard-coded
   colours in `style.css` step by step; remove the `u-*` utilities as components take over.
   Grade colours move into one TS helper (`domain/format.ts` or `ui/colors`) used by every
   screen (B8 cleanup).
2. **Buttons, inputs, chips (V-06):** one `.btn` component with `--primary/--secondary/--text/
--danger/--icon` and `--sm`; replace every button class, the PIN buttons included. Inputs,
   selects, filter chips (active state) per spec 3.1–3.2.
3. **Modal (R-02, V-08, V-10):** one modal/dialog component: fixed top 64 px, optional fixed
   height, sticky header slot (title, badge, subtitle, close, tabs), scrolling body, footer slot
   with the button order rule. Port every modal to it; replaces `window.confirm` use (8b m6),
   fixes U12, U14, U15.
4. **Skeleton (V-09):** `skeleton(el, shape)` helpers (pill, line, block) with the shimmer and the
   reduced-motion rule. Wire them into each modal in its area step (D3–D6); here only the
   component and one use (the exam overview) as the example.
5. **Sticky screen headers (V-10):** the title row and filter bar of all five tabs.
6. **Tab bar (V-05, V-12):** light header, icon + `maatwerk-tabbalk.svg`, tab icons (spec 3.5),
   active underline. Copy `docs/phase-2/design/assets/*.svg` into the UI assets.
7. **User menu (F-17, F-18):** dropdown per spec 3.6 replacing the overlay; theme and accent
   apply live. **(data)** Storage per ROADMAP decision 7.7 (proposal: `gebruikers/<id>.json`
   fields `theme`, `accent`; check old versions keep unknown fields). Until decided, store per PC.
   "Foto wijzigen" opens F-19 when that exists, otherwise hide it.
8. **Test-type badge (V-11):** a `examBadge(exam)` component per spec 2.5, reading type from the
   exam. Until decision 7.11 adds the practical/diagnostic field, it knows only toets and SE-toets
   (`type: 'pta'` or `weging_se > 0`).
9. **Dark theme details:** inverted watermark, dark icon variant, card shade.
10. **Form rules (spec 3.7–3.9):** label-aligned rows, centred narrow controls, steppers in shared
    grid columns, 36 px tick boxes for yes/no fields; one form-row helper used by every modal.
11. **Number format:** one `formatGrade` (decimal comma, always one decimal: `7,0`) used
    everywhere (with R-01, B8).

**Tests:** visual baselines for all screens in light + one accent, plus one dark and one yellow
(contrast edge case); unit tests for the grade-colour and trend helpers; e2e: theme and accent
persist across logout/login; modal opens at the same top for every modal; Escape closes.

## D2. Shell: splash and login (ROADMAP Shell area)

**Items:** F-06, V-04, B-04, F-19 (photo), B-08 (avatar helper).

1. **Splash (F-06):** inline SVG wordmark + CSS progress bar in `index.html` (paints before the
   bundle), removed when the app is ready; keep it until the store has loaded so slow PCs see it
   longer. No white flash: set the window background colour to `--bg` in the Tauri config.
2. **Login (V-04):** rebuild per spec 4.2 and board 5: four states (start, vak chosen, user chosen,
   first login), the flying avatar (FLIP: measure the avatar's rect, render a fixed clone, animate
   to the target), the inline PIN block, reverse on "Andere gebruiker". Keyboard: Tab through
   tiles and users, Enter submits the PIN, Escape goes back one state.
3. **Avatar helper (B-04, B-08):** one `avatar(user, size, shape)` used everywhere (tab bar,
   editor header, login, menus), photo or initials with the ring colour.
4. **Photo crop (F-19):** pick any image, drag/zoom a 1:1 crop in a modal, save; the name is not
   editable. **(data)** only if the photo file name rule changes (D28).

**Tests:** e2e for the login flow (both PIN variants, back), reduced-motion variant, splash
removed after load; visual baselines for the four login states.

## D3. Leerlingen and Groepen (ROADMAP Admin area)

**Items:** F-07, F-08, F-09, F-19 (photo crop in the user modal), admin screens (spec 4.9).

1. **Trend helper (F-08):** in the domain layer, after ROADMAP decision 7.9 ("last" grade and
   year average); unit tests on the five boundaries (0,5 and 1,0 inclusive per spec 2.4).
2. **Student cards (F-07):** spec 4.3; teachers and sectievoorzitters only; admin keeps the list.
   The SE/laatste alternation is CSS only (no timers per card). Filters and search unchanged
   (existing e2e must stay green).
3. **Group cards (F-09):** spec 4.4, variant B for upper-school groups.
4. **Admin screens (spec 4.9):** admin tab bar with seven icons; Gebruikers (card actions in the
   order Pincode resetten, edit, deactivate), Gebruiker bewerken (Afkorting + Kleur swatches,
   photo crop), School, Gegevenscontrole (findings as cards with actions), Instellingen (units,
   snapshot list).

**Stop and ask:** the before/after table for the averages, SE averages and SDs shown on the cards.

## D4. Overviews (ROADMAP "Overzicht and profiel" area)

**Items:** F-10, F-11, B-05 (after D5's F-12), V-11 in charts.

1. **Group overview (F-10):** spec 4.5, five tabs, lazy-loaded per tab with skeletons, fixed
   height. Reuse the chart code of the exam overview (Chart.js) where it fits; the boxplot and
   RTTI bars may be plain HTML/CSS like the mock.
2. **Exam overview (F-11):** SD row, sticky `tfoot`.
3. **Observaties counts:** "n (p%)" with whole percentages of the group.

**Stop and ask:** the new statistics (SD, year-long RTTI, observatie counts) on the fixtures.

## D5. Toetsen (ROADMAP Toetsen area)

**Items:** V-11, F-12, B-05, test modals (spec 4.11).

1. **(data) Test kind (decision 7.11):** add the field(s) for practical assignment and diagnostic
   to the exam schema, the exam editor (a "Soort" select), the migration (default: toets) and the
   statistics (diagnostic counts for neither rapport nor SE; this changes averages, so the
   before/after table and the user's approval come first).
2. **Exam list:** cards with badges and kind pills, legend, attempts tree open by default, toggle
   per test remembered for the session (spec 4.7).
3. **Test modals (spec 4.11):** Nieuwe toets (steps, PTA and D boxes, aligned grid), Toets
   bewerken (one top row, sticky question heading, solid segmented buttons, RTTI totals with
   percentages), Nieuwe poging (Soort poging cards, Beschrijving filled and locked). Add the
   "+ PO toevoegen" button only when the PO modal is designed.
4. **(data) Observaties on resits (F-12):** copy the original's observaties when an inhaal or
   herkansing is created; lock them in the resit's editor (read-only list with the lock pill);
   decision 7.10 for existing resits. Then fix B-05 in the summary overview.

## D6. Opdrachten-editor (ROADMAP Opdrachten area)

**Items:** V-07, F-16, F-05, B-08, V-03, F-01 (UI part).

1. **Header (V-07):** spec 4.8; "← Terug naar opdrachten" replaces the "Maatwerk" link; avatar via
   the D2 helper (B-08).
2. **Status pill (F-05):** driven by the existing compile events in `editor-init.js`
   (`setStatus`), states compiling / saved / error.
3. **Toolbar:** on top of the left pane, then the file tabs; math, symbols and layout groups move
   into dropdowns. Every existing button keeps working (e2e `editor.spec.ts`).
4. **Divider (F-16):** pointer-capture drag 25–75%, double-click reset, arrow keys, ratio saved
   per user (per PC until 7.7 is decided).
5. **AI rail (F-01 UI):** rail + slide-out panel + diff card with Bekijken/Toepassen, behind a
   setting until the CLI bridge (ADR-0009 option D, Step 9 m3 time limit) is ready. The panel
   never writes `opdracht.typ` without "Toepassen".

## D7. Score entry (ROADMAP Scores area)

**Items:** spec 4.10, F-03 (Ctrl+X).

1. Restyle the score modal and grid with the tokens; content centred; header row with **?**
   first (help popover with the shortcuts), undo/redo, ". → N", Toets bewerken, N-term.
2. Sticky group heading, column headings and the # and Naam columns; GEMIDDELDE and
   STANDAARDDEVIATIE per group; grade cell colours per spec 2.3.
3. The grid's keyboard behaviour and saving stay as they are (e2e `score-grid.spec.ts` green).

## D8. Observaties and opdrachten modals (ROADMAP Opdrachten area, with D6)

**Items:** F-15, spec 4.12.

1. Observatie bewerken with the icon picker (search, six categories, 200+ emoji, the existing
   ones kept).
2. Opdracht bewerken restyled, observaties as emoji chips, "Inhoud bewerken in de editor".

## D9. Praktische opdrachten and rubrics (PLAN-2 steps 21-24)

**Items:** F-20, F-22, F-23, spec 4.12 (toetstype) and 4.13; boards 15-18. The steps, data model
and decisions are in `PLAN-2.md` (steps 21-24, decisions 16-25); this section only points the
design: reuse the dialog, card, chip, segmented, stepper and grade-cell components; the level
display and the slider-with-levels are new components (unit tests for the coverage and
highlight logic).

## Order and sizes

| Sub-step | ROADMAP step    | Size | Depends on                      |
| -------- | --------------- | ---- | ------------------------------- |
| D1       | P1 Foundation   | L    | decision 7.7 (can start before) |
| D2       | Shell area      | M    | D1                              |
| D3       | Admin area      | M    | D1, P2 Domain, decision 7.9     |
| D4       | Overzicht area  | L    | D1, P2 Domain                   |
| D5       | Toetsen area    | M    | D1, decisions 7.10, 7.11        |
| D6       | Opdrachten area | M    | D1, D2 (avatar)                 |
| D7       | Scores area     | M    | D1                              |
| D8       | Opdrachten area | S    | D1                              |
| D9       | PLAN-2 21-24    | 3L+M | D1, step 19, step 20            |

## Prompt for Claude Code

> Read `CLAUDE.md`, `ROADMAP.md` sections 1–3 and `docs/STATE.md`. We are starting sub-step D1
> of `docs/phase-2/design/implementation-plan.md` as part of ROADMAP step P1. Read
> `docs/phase-2/design/README.md` sections 2 and 3 and the mock files it names. Work on a branch
> `step/p1-foundation`, small commits, gate and reviewer at the end, and stop to show me the
> visual diff before updating the baselines.
