# Review: step 25, Score entry

Reviewer: fresh-context subagent, 2026-11-12. Scope: `git diff 2bdac21..HEAD` on
`step/25-score-entry` (`a4d68cf` F-03 cut, `64ebdfd` decision 29, `938ab9b` R-05 split, `77c23d7`
restyle, `50f31a1` docs, `7a18015` version). Read against PLAN-2 step 25, design spec 4.10, board
13 (`mocks/Scores.dc.html`), decision 29 and `docs/specs/score-grid.md`. The old
`ui/src/screens/scores.js` (1483 lines at `2bdac21`) was compared statement by statement with the
new `ui/src/screens/scores/*.ts`. `npx vitest run` in `ui/`: 46 files, 560 tests pass. No e2e run.

## Summary

The JS-to-TS split (R-05) does not change behaviour. The save queue (`saveCell`, `saveChain`,
`pendingSaves`, `unsavedCells`), undo/redo (including the batched step, now `asOneStep`),
`applyRemoteRecord`, the colleague cursors, the prebuild/`takePrebuilt` logic, presence, the
N-term sync and the reload notices are the same statements, moved into modules. The keyboard
handler (`onKeyDown`: numpad `.`, Enter/`*`, Tab, F-keys, `/`, `-`/`+`, Home/End, 0/1) matches
line for line. The behaviour differences I found are benign or intended:

- `loadScoreGrid` lost its dead fallbacks (`#score-grid-container` lookup, the `!examId` hint, the
  default `year`). Every caller passes all three.
- `rec?.scores` / `rec?.overrides` are now optional. `overrides` and `gradeInfo` are objects keyed
  by row instead of arrays. `goTo` ignores an `undefined` column. `openScoreModal` is synchronous;
  the old async version also returned before `onShow`.
- `setObs` now recomputes and redraws the GEMIDDELDE row (the ticked count). `refreshRow` also
  updates the group's status line. Both are intended by decision 29 and board 13.
- Intended restyle changes: the row status is a bar on `#` (plus a red name) instead of a filled
  `#`/Naam; bonus/diag cells now take the score tints; the SD row's Cijfer is no longer coloured
  by `sdCellColor` (the board has it grey). Part of the spec doc was not updated for these (m5).

F-03 is small and correct. `onCut` reuses `copyText` + `clearRange`, so it skips read-only cells
and checkboxes exactly as Delete does. It only acts when the grid owns focus and no editor is
open, so cutting text inside an open editor stays native. Its listener is removed in `destroy`.
Decision 29 is implemented as written: `classQuestions` (N and invalid count 0, empty left out),
ticked counts, and RTTI means over graded rows with NVT left out. The golden overlay in
`scoregrid.test.ts` is narrow: only the decision-29 cells of the average row are taken from
`actual`, and every other golden cell is still compared. It does leave those cells checked only
by two hand-written cases (m6).

Security holds. Every user string that goes into `innerHTML` (group name, observatie naam and icon,
question RTTI/section/number, exam title, cursor name, menu items) goes through `escHtml`. No
`style="..."` appears in an HTML string; inline looks are set through CSSOM.

The main problem comes from the restyle. The new sticky heading, column headings and `#`/Naam
columns hide the current cell during keyboard navigation, because nothing tells `scrollIntoView`
about them (M1). The other findings are visual regressions of the cross-hair, a wrong help line,
the cost of the summary recompute on large pastes, and stale spec rows.

**Counts: 0 blockers, 1 major, 7 minors, 5 nits.**

## Blockers

None.

## Majors

### M1. Keyboard navigation moves the current cell under the sticky heading, column headings or # / Naam columns

`ui/src/styles/scores.css:147-152, 202-213, 282-285, 360-374`;
`ui/src/components/score-grid/score-grid.ts:265`

`select()` calls `cells[row][col].scrollIntoView({ block: 'nearest', inline: 'nearest' })`. The
scroll container is `#sc-grid-container`, and it has no `scroll-padding`. Sticky elements do not
shrink the scrollport. So when a cell is under the sticky group heading (48 px) plus the sticky
`th` row (~70 px), or under the sticky `#` + Naam columns (262 px), the browser treats it as
visible and does not scroll. Cases this hits in normal use, with a group taller than the modal or
an exam wide enough to scroll horizontally:

- Numpad `-` or ArrowUp to the previous student, once the grid has scrolled down: the selected
  row ends up behind the column headings.
- Tab from the last observatie to the next student's first question (`goTo(row + 1, firstQCol)`),
  Home, `/` or Shift+Tab back to the first questions, with the grid scrolled right: column 2 is
  scrolled to the scrollport's left edge, which is under the sticky Naam column.

Before step 25 nothing was sticky, so this breaks the step's "keyboard behaviour unchanged". The new
e2e test scrolls the container by hand (`scrollTo(240, 60)`), so it does not cover this.

Fix: give `#sc-grid-container` a `scroll-padding-top` of the group heading plus the heading row,
and a `scroll-padding-left` of the `#` + Naam width (`72px + 190px - var(--sc-gutter)`). The heading
row height can come from a custom property, or be set from JS after the build. Add an e2e test:
select a cell, scroll so the previous row is at the top, press ArrowUp or numpad `-`, and assert
that the current cell's rect lies below the bottom of `th`. Do the same horizontally with Home.

## Minors

### m1. The cross-hair (G58) is lost on filled Cijfer cells and on empty bonus/diag cells

`ui/src/screens/scores/cells.ts:212-216`; `ui/src/styles/scores.css:425-430, 480-491`

- `gradeRenderer` sets `td.style.background = fill`. The shorthand also sets
  `background-image: initial` inline, and that beats `.sc-cross { background-image: … }`. The old
  code set the colour first and then `backgroundImage`, so the Cijfer column showed the tint.
- `.score-grid-table td.sc-bonus:not(.sc-full, .sc-part, .sc-zero, .sc-n)` has specificity
  (0,3,1), higher than `td.sc-cross` (0,2,1). Its `background:` shorthand removes the cross-hair
  image on empty bonus/diag cells.

Fix: use `td.style.backgroundColor = fill`, and `background-color:` in the bonus/diag/tint rules
(or in all of the tint rules).

### m2. The help popover pairs `/` and `*` with the wrong direction

`ui/src/screens/scores/modal.ts:54`

`['Tab, / en *', 'Volgende / vorige veld']` reads as "`/` = volgende, `*` = vorige". The code does
the opposite: `NumpadDivide` goes to the previous field (`group-grid.ts:442`), and `NumpadMultiply`
confirms and goes to the next one (`group-grid.ts:396`). The old tooltip said "/ of *: Vorige /
volgende veld". Shift+Tab, Home/End, Escape/F2 and Backspace are not listed either.

Fix: for example `['Tab of *', 'Volgende veld']`, `['Shift+Tab of /', 'Vorige veld']`, and add
Home/End and "Delete of Backspace".

### m3. The footer can say "Alles opgeslagen" when a save failed with a conflict; status and help have no tests

`ui/src/screens/scores/session.ts:99, 109-114`; `ui/src/screens/scores/modal.ts:356-365`

A `conflict` error is rethrown without being added to `unsavedCells`. The `finally` block then
calls `onSaveState`, and the footer shows "● Alles opgeslagen" even though the write did not land.
Whatever the global conflict handler then shows, the status line should not claim success. No
test covers the save status (busy → ok, a failed save → "1 score niet opgeslagen", retry → ok) or
the help popover (click to open, Escape and an outside click to close, listeners removed when the
modal closes).

Fix: show a neutral or error state on a conflict, for example with a `conflicted` flag until the
next successful save. Add e2e tests with the mock's failing-save hook (it already exists for G53)
and for the popover.

### m4. Decision 29 makes each change's summary recompute O(rows × questions) with an extra WebAssembly call; pastes and cuts multiply it

`ui/src/domain/scoregrid.ts:228-252`; `ui/src/screens/scores/group-grid.ts:203-209, 259-262, 336-345`

`refreshRow` now runs `rowQuestionScores` over every row, serialises all rows' scores to JSON for
`classQuestions`, makes four more `stats` calls, and runs `groupStatus` over all rows. One typed
value costs a few hundred microseconds, which is fine. But `onGridChange` calls `scoreTyped` →
`refreshRow` once per changed cell. A paste or cut of a 30 × 40 block therefore does 1,200 full
summary recomputes, each serialising the 1,200-cell group: quadratic, well over 100 ms. `setObs`
also recomputes the whole summary row (including `classQuestions`) just to update one ticked
count. A paste of 30 × 40 renders 1,200 × 3 rows as well, but that was already the case before.

Fix: inside `asOneStep`/`onGridChange`, recompute and redraw only the changed rows, then run
`recomputeSummaryRow`, render the summary rows once and call `updateInfo` once at the end. A
"defer summary" flag in the group grid would do it.

### m5. `docs/specs/score-grid.md` still describes the old look in several rows

`docs/specs/score-grid.md:29, 32, 45, 46`

- G02: widths "72 / 150 / 32 / 20 / 28 / 72 / 52 / 44" and "no inner scrollbar". They are now
  72 / 190 / 38 / 10 / 32 / 76 / 60 / 52, and the grids scroll inside `#sc-grid-container`.
- G05: "No frozen rows or columns". The group heading, column headings and `#`/Naam are now
  sticky.
- G17: "bonus columns blue italic, diag grey italic". They now take the full/partial/zero/N tints,
  with a pale fill only when empty.
- G18: "the std-dev row has background scales (`stdDevGradeColor`)". The SD row is plain grey now
  (as on the board).
- Missing: the footer legend and save status, the ? popover, the group status line (only G16
  mentions `groupStatus`).

Fix: update these rows and add ids for the footer, help and sticky behaviour, with their tests.

### m6. Test gaps for decision 29, F-03 and the new pure helpers

`ui/tests/domain/scoregrid.test.ts:110-188`; `ui/e2e/score-grid.spec.ts:546-559`

- Decision 29: the golden cases now take the decision-29 cells from `actual`, so these cases are
  only checked by the two hand-written tests. Not covered: the O = 0 layout (the RTTI indices
  shift); rows with an override but no scores (graded, no percentages, so RTTI shows `NVT`); an
  invalid score in a question average (counts 0); no graded rows at all (RTTI `''`); the
  decision's own tiny-fixture example (1,2 / 0,9 / …; R 40 %, T1 48 %, T2 52 %, I 23 %).
- F-03: only question cells are tested. Not covered: a cut range that includes observatie
  checkboxes (copied as 0/1, left as they are), the Cijfer column (an override is removed, a
  calculated grade stays), and read-only Totaal/% cells. `score-grid.test.ts` has no unit test for
  `cut`.
- `cells.ts` exports the pure functions `scoreTint`, `pctTint` and `gridLayout`, and none of them
  has a unit test. The e2e tint test checks four colours only.

Fix: add these cases. The tiny-fixture example is cheap and pins the decision's wording.

### m7. Colleagues' cursors paint over the sticky parts; the group heading text scrolls away horizontally

`ui/src/style.css:1010-1016`; `ui/src/styles/scores.css:202-206`

- `.remote-cursor` has `z-index: 150` and lives in the scrolling section. A colleague's cell that
  has scrolled under the sticky heading or the Naam column is drawn on top of them, flag
  included. The editor (`z-index: 10`) behaves the same way.
- `.sc-group-head { position: sticky; left: 0 }` is a full-width flex block inside a section as
  wide as the table. `left: 0` cannot move it, so with the grid scrolled right, "3a · 28 leerlingen
  · …" scrolls out of view. The e2e test only checks `head.top`.

Fix: give the sticky cells and the heading a z-index above the cursor layer, or clip the cursor
layer to the area below and right of the sticky parts. Make the heading's text a `width:
max-content` element with its own sticky `left`, as the board does with its inner div.

## Nits

### n1. Dead code after the restyle

`ui/src/domain/grade-colors.ts:97` (`sdCellColor`, now used only by its test);
`ui/src/screens/scores/cells.ts:27, 46` (`GridLayout.totalCol`, never read). Remove them or use
them.

### n2. File sizes and duplicated widths

`group-grid.ts` has 510 lines and `scores.css` 526, just over the ~500 guideline. The Naam
column's sticky offset hard-codes `72px` (`scores.css:372`) next to `COL_WIDTH.nr` in `cells.ts`.
A `--sc-nr-w` custom property set from `COL_WIDTH` would keep them in step.

### n3. Numbers from data files go unescaped into HTML (carried over)

`cells.ts:127` (`${q.max_points}p`) and `modal.ts:122, 124` (`data-val="${exam.n_term ?? 1}"`,
`value="${formatNumber(...)}"`). These come from shared exam files. The old code did the same, but
`escHtml(String(...))` costs nothing.

### n4. Help, legend and status wording details

- The help says the override bar is "blauw", but it is `var(--accent)` and follows the user's
  accent colour.
- Escape while the popover is shown only by hover is not caught, so it closes the modal.
- `#sc-saved` has `role="status"`, so a screen reader announces "Opslaan…" / "Alles opgeslagen"
  on every keystroke-commit. `aria-live="polite"` that only announces errors would be quieter.

### n5. Two semantics worth recording

- Ctrl+X copies checkboxes and the calculated Cijfer but leaves them in place, so cut + paste
  duplicates observaties instead of moving them. This is consistent with Delete and documented in
  G54, but the help line "knippen" may suggest otherwise.
- An invalid score counts 0 in the question average (`class_question`), although the cell is red.
  Decision 29 says "N counts 0, empty is left out" but does not mention invalid scores. Add it to
  the decision text.

## Triage

<!-- For the implementer: per finding, fixed (commit) / deferred (where) / rejected (why). -->

- **M1 fixed:** `#sc-grid-container` has `scroll-padding-top` (group heading + measured column
  heading height, `--sc-thead-h` set in `modal.ts`) and `scroll-padding-left` (# + Naam). e2e
  "a cell reached with the keyboard is not hidden under a sticky part" fails without it.
- **m1 fixed:** grade cells set `backgroundColor`; tints and the bonus/diag fills use
  `background-color`, so the cross-hair image stays.
- **m2 fixed:** help rows: Tab/Shift+Tab, `*` / `/` in the right order, Home/End,
  Delete/Backspace; "accentkleur" instead of "blauw" (n4 in part).
- **m3 in part:** spec rows G64 (footer, save status) and G65 (help) added. A conflict keeps
  "Alles opgeslagen": the conflict is reported by the app's reload notice and nothing was
  written, so the footer is right that nothing is pending; no change. No e2e for the
  popover/status yet: backlog.
- **m4 fixed:** one paste, cut or Delete recomputes the summary rows and the status line once
  (`refreshSummary` batches inside `onGridChange`).
- **m5 fixed:** G02, G05, G17, G18 rewritten for the new look; G64, G65 new.
- **m6 in part:** `tests/screens/score-cells.test.ts` (`scoreTint`, `pctTint`, `gridLayout`);
  decision 29 without observaties and with an invalid score (counts 0, as the rapport). Cutting
  checkboxes / Cijfer: behaviour = Delete (G54), backlog for an e2e.
- **m7 fixed:** `.remote-cursor` z-index 1 (under the sticky heading and column headings); the
  group name and status sit in a sticky-left `.sc-group-title`.
- **n1 fixed:** `sdCellColor` and `GridLayout.totalCol` removed.
- **n2 in part:** `scores.css` split into `scores.css` (modal) and `score-grid.css` (grid);
  `group-grid.ts` stays at ~525 lines (the keyboard handler could move out later: backlog);
  the 72 px / 262 px widths are commented next to `COL_WIDTH`.
- **n3 fixed:** `max_points` and `n_term` escaped.
- **n4 rest, n5:** kept. Escape on a hover-shown popover closes the modal as before (the popover
  is not "open"); cut leaves observaties as Delete does (G54); decision 29 follows the rapport's
  `class_questions` (an invalid score counts 0), now stated in the decision.
