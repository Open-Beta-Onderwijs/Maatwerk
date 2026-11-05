# Review: step 13 (Foundation a)

Scope: `main...step/13-foundation-a`, commits `286da7e`..`e380850` (8 commits, 52 files,
+1963/-959). Reviewer: fresh-context subagent, checklist PLAN.md Appendix C. Checked against the
code, not the commit messages or STATE.

## Summary

| Severity | Count |
| -------- | ----- |
| Blocker  | 0     |
| Major    | 1     |
| Minor    | 7     |
| Nit      | 9     |

Checked and found correct:

- **Numbers:** I compared every replaced call site in `ui/src` with `git show main:<path>`. Each one
  keeps its rounding path:
  - `formatGrade` is still `Math.round(x*10)/10` followed by `toFixed(1)`.
  - `formatFixed` is `toFixed`, and it replaces each former `x.toFixed(1).replace(...)`.
  - `formatNumber` is `String(x).replace` and replaces `String(...).replace` for weging, n-term
    and scores.
  - `formatCompact` is identical to the old rapport `fmtNum`.
  - `parseDecimal` and `parseDecimalLoose` are identical to the inline `Number(...)` and
    `parseFloat(...)` parses they replace.
  - The `spinners.ts` port keeps `toFixed(dec)`.

  The only output difference is that `formatGrade(NaN)` now gives `—` instead of `NaN`
  (documented in quirks B8). No shown number changes for finite inputs.

- **Rapport:** no `.typ` or Rust files are touched. In `rapport.ts`, only `fmtNum` and `grade` move
  to the shared helpers, with the same behaviour. The rapport golden tests pass.
- **CSP:** no `style=""` attributes were added. New dynamic colours go through `data-color`,
  `data-border-color` and `data-bg` (style-data.ts) or CSSOM (`el.style.x`), and the CSP allows
  both. `color-mix(...)` values work through `style.setProperty`.
- **Removed classes:** nothing in `ui/src`, `ui/index.html` or `ui/e2e` still references
  `btn-primary`, `btn-secondary`, `btn-sm`, `btn-danger`, `btn-link`, `btn-sm-icon`,
  `.volgnummer` or the 9 removed `u-*` utilities. Their CSS is gone.
- **Tokens:** all 21 accents (fill, text light, text dark, on-accent, anti) and all neutrals match
  spec 2.1-2.2. The 7x3 order matches. The soft tints (8%/18%) and the focus ring (20%) match the
  spec's alpha values. `indigo` correctly gets dark `--on-anti` text on yellow.
- **Gate:** vitest passes (31 files, 385 tests), `tsc --noEmit` is clean, and eslint and prettier
  are clean.

## Major

### M1. Dark theme: Chart.js canvases still draw with light-theme colours

- **Where:**
  - `ui/src/modals/profiel.js:336` and `:889`: bar value labels `#333` / `#444`.
  - `ui/src/modals/toets-overzicht.js:438`, `:461`, `:485`, `:507` and `:576`: `#444` / `#555`
    text.
  - Grid lines are hard-coded `rgba(0,0,0,.08)` (`profiel.js:452`).
  - Nothing sets `Chart.defaults.color` or `Chart.defaults.borderColor`.
- **Evidence:** `.chart-wrap` now gets `var(--surface)` (`#1d2128` in dark mode). The local
  baseline `ui/e2e/visual.spec.ts-snapshots/modal-profiel-cijferverloop--dark-visual-win32.png`
  shows:
  - The bar value labels (6,9 / 3,5 / ...) are invisible.
  - The axis ticks and chart titles are low-contrast grey on dark.

  This applies to every chart in the profile and exam overview modals. Dark theme is a
  deliverable of this step (plan item 1, "visual baselines in ... dark"). The user decision only
  covers the score grid staying light.

- **Fix:** do one of the following:
  - Set `Chart.defaults.color`, `Chart.defaults.borderColor` and the label-plugin colours from
    tokens (`cssToken('--muted')`, `cssToken('--line')`), and rebuild open charts on the
    `maatwerk:look` event.
  - Or record this explicitly in STATE and the quirks or roadmap as "charts are light-only until
    step 25", with the user's OK, so step 15 does not expose a broken dark theme.

## Minor

### m1. Profile charts mix the new test-type colours with the old toets blue and PTA red

- **Where:** `ui/src/modals/profiel.js:17` (new `examTypeColor`, used at `:412` and `:516`)
  compared with `:254-261` (legend split icon `#4A90D9`/`#d9534f`), `:308` (year label),
  `:749` (`leerlingColors` blue/red) and `:1097`.
- **Evidence:** in the snapshot above, the "Leerling" legend icon is blue/red while the bars it
  describes are accent/anti (blue/orange). The third chart still uses blue and red for year and
  SE. Before this step the colours were consistent: everything used the old blue/red.
- **Fix:** derive the split icon, `leerlingColors` and the year label from
  `testKindToken('toets'|'se')` via `cssToken`, or keep the old colours in both places until the
  profile redesign (step 25).

### m2. `zwart` + dark: accent is invisible inside the light score-grid island

- **Where:** `ui/src/styles/tokens.css:12-13` (island) and `:202-205` (dark zwart override).
  The grid uses `var(--accent)` in `style.css` around lines 1603-1627: selection outline,
  current cell, `.score-grid-editor` border.
- **Evidence:** the island resets the neutrals to light values but inherits
  `--accent: #e7eaf0`. The cell cursor, selection tint and editor border become near-white on
  white or pastel cells.
- **Fix:** add `html[data-theme='dark'][data-accent='zwart'] .score-grid { --accent: #111418;
--on-accent: #ffffff; }`, or reset `--accent` from a light-fill variable in the island rule.

### m3. Element-level input base now styles every input in the app

- **Where:** `ui/src/styles/controls.css:86-125`.
- **Evidence:** on `main`, only `.form-group input/select` had a base style. Now every text-like
  `input`, `select` and `textarea` gets 36 px height, padding `0 12px`, radius 8 and a
  `--border-strong` border, unless a class rule overrides each property. Examples:
  - `.score-grid-editor` (`style.css:1621`) sets position and size inline but not
    `border-radius`, so the in-cell editor gets 8 px rounded corners inside a small cell.
  - `.og-cijfer-input` (`style.css:1211`) and `.school-field-input` (`:602`) set padding but not
    height, so they now take 36 px.

  The visual baselines do not cover the cell-editing state or every inline input.

- **Fix:** scope the base, e.g. `.form-group :is(input, select, textarea)`, the screen header and
  a `.field` class. Alternatively, give the grid editor and the inline inputs explicit
  `border-radius` and `height`, and add one visual or e2e check of the grid editor.

### m4. Inputs and selects not yet on the 3.2 component, and a lost focus ring

- **Where:**
  - CustomSelect trigger `style.css:1718` (30 px, `--border`, radius 4). These are the year and
    filter selects in every screen header.
  - `.toolbar select` `:181`.
  - `.voorzitter-row select` `:3445`.
  - `.form-group textarea` `:1988`, and `:2000` `outline: none` (specificity 0,2,1 beats the
    `:where` focus ring, 0,0,1).
  - `.rtti-uitleg-table textarea` `:2523`/`:2536`.
  - `.questions-table input[type='text'|'number']` `:823`: this has the same specificity as
    `controls.css:143` and comes later. Inputs in the question table therefore get radius 4,
    `--border` and padding `4px 6px`, while selects next to them get radius 6.
- **Evidence:** spec 3.2 says inputs and selects are 36 px, `--border-strong`, radius 8, with an
  accent focus border and a 3 px ring. Plan item 4 covers inputs and selects.
- **Fix:** move these rules onto the tokens and sizes, or list them in STATE as deferred (which
  step). Drop `outline: none` from the two textarea focus rules.

### m5. `.btn--text:disabled` never applies

- **Where:** `ui/src/styles/buttons.css:124` compared with `:115-121`.
- **Evidence:** `.btn:disabled:not([aria-busy='true'])` has specificity (0,3,0) and
  `.btn--text:disabled` has (0,2,0). A disabled text button therefore gets the `--surface-2`
  fill and border, which the rule intends to prevent.
- **Fix:** `.btn--text:disabled:not([aria-busy='true'])` (or wrap the generic disabled rule in
  `:where()`).

### m6. Two sources of truth for grade colours, and duplicate pill builders

- **Where:**
  - `tokens.css:50-52` (`--grade-fail-bar`, `--grade-pass-lo-bar`, `--grade-pass-hi-bar`) are not
    used anywhere. `GRADE_BAR` in `domain/grade-colors.ts:52` duplicates them.
  - `modals/groep-leerlingen.js:168-185` and `:223-231` still build grade pills inline
    (label, bar, text, `fw`), and `gradePill()` at `:26` is a one-line wrapper around
    `gradePillHtml`.
- **Evidence:** R-01 asks for one implementation, and both copies can drift.
- **Fix:** drop the unused bar tokens, or add a test that compares them with `GRADE_BAR` as
  `theme.test.ts` does for accents. Use `gradePillHtml(g, 'grade-pill--wide')` in
  groep-leerlingen.

### m7. R-05: the touched JS files were not converted to TS

- **Where:** 19 `.js` files in `ui/src` were touched, and only `utils/grades` and
  `utils/spinners` moved to TS. Small, mostly mechanical candidates are still JS:
  `utils/csv.js` (75 lines), `screens/leerlingen.js` (259), `modals/leerling-edit.js` (265),
  `modals/herkansing.js` (278), `screens/groepen.js` (286) and `screens/school.js` (321).
- **Evidence:** PLAN-2 section 2: "convert the files the step touches".
- **Fix:** convert at least the small files, or record in STATE that class-rename-only touches do
  not trigger R-05, so later steps know.

## Nits

- **n1.** Leftover re-exports `export { formatGrade }` remain in `ui/src/app.js:445` and
  `ui/src/domain/scoregrid.ts:108`, and `screens/scores.js:19` still imports `formatGrade` from
  `app.js`. Import from `domain/format` and drop the re-exports.
- **n2.** In `ui/src/screens/scores.js:8-11`, `const cellNumber` sits between import statements.
  Move it below the imports.
- **n3.** `formatGrade(NaN)` → `—` also reaches the rapport data (`rapport.ts:395`, `grade`). It is
  degenerate input only and is documented in B8, but the rapport golden does not pin it. A
  one-line unit test would.
- **n4.** `profiel.js:17` calls `getComputedStyle` once per bar via `cssToken`. Read the two
  tokens once per render. The `maatwerk:look` event (`theme.ts:23`) has no listener yet.
- **n5.** Component CSS still contains raw colours: `controls.css:31` `#3a404b` (dark pressed
  segment) and `buttons.css:83` `#ffffff`. `.grade-pill` (`style.css:2772`) is not yet spec 2.3
  (min-width 44, padding 2px 6px, radius 6, 1.5 px). Either is fine if a later step owns it, but
  say which.
- **n6.** `setBusy` (`components/button.ts:14`, `:19`) replaces `textContent`, so an icon inside
  the button is lost after busy. Only `rapport.js` uses it. `pin.ts`, `instellingen.ts`,
  `gegevens.ts`, `migration.ts` and others still toggle `disabled` and the text by hand.
- **n7.** Stale text:
  - `docs/STATE.md:34` says "Question-editor table keeps 30 px controls". `:49` says
    "30 px selects", but `e380850` made them 26 px.
  - `style.css:2785` refers to `utils/grades.js`.
  - The comment in `tests/domain/format.test.ts:23-24` says 5.45 differs between the paths,
    but `formatFixed(5.45)` is also `5,5` (`:43`).
- **n8.** Dev menu (`theme.ts:117-125`): the global Escape handler also fires while a modal is
  open, and Ctrl+Alt+T is AltGr+T on some keyboard layouts. This affects dev only.
- **n9.** `tests/theme.test.ts` does not cover the dark `zwart` override (`#e7eaf0` on
  `#111418`) or the neutrals against the spec table. The rule for the default `:root` relies on
  the first `:root {` match, which is the second block.

## Triage (implementer, 2026-11-05)

- **M1 fixed:** `legacy/globals.ts` sets `Chart.defaults.color`/`borderColor` from the tokens and
  again on `maatwerk:look`; labels and grid lines drawn by hand use `theme.ts` `chartInk()`.
  The 7 dark chart baselines were updated (and 2 yellow profile ones, see m1).
- **m1 fixed:** profile legend icon, year label and `leerlingColors` use the test-kind tokens.
- **m2 fixed:** zwart keeps `#111418` inside the light score-grid island.
- **m3 partly fixed:** `.score-grid-editor` radius 0, `.og-cijfer-input` 30 px. Scoping the base
  to form contexts is backlog (step 14 form rules).
- **m4 partly fixed:** both textarea focus rules show the accent ring. The CustomSelect trigger,
  toolbar/voorzitter selects and question-table inputs move to the 3.2 look in step 14 (form
  rules); backlog.
- **m5 fixed.** **m6 fixed:** unused `--grade-*-bar` tokens removed (`GRADE_BAR` is the one
  source); groep-leerlingen uses `gradePillHtml`.
- **m7 backlog:** files touched only for class renames or import paths are not converted; the
  area steps (20-27) convert them with their screens. Recorded in STATE.
- **n1, n2, n4, n7 fixed** (`cssToken` caches per look). **n3:** `formatGrade(NaN)` is pinned in
  `format.test.ts`; the rapport path uses the same function. **n5, n6, n8, n9:** backlog.
