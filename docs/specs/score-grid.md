# Score grid: behaviour spec (Step 3b)

What the score grid does, written as testable rules. Written in Step 3b against Handsontable 14
(the reference `renderer/screens/scores.js`); since Step 3b the grid is our own
(`ui/src/components/score-grid/`, ADR-0004) driven by `ui/src/screens/scores.js`, with the logic in
`ui/src/domain/scoregrid.ts`. Source list: `docs/reference/metrics.md` section 8 (29 features);
quirks U1-U5 in `docs/reference/quirks.md`. Line numbers in the quirks refer to the reference.

Each rule has an id (`G..`) and how it is tested: **e2e** = `ui/e2e/score-grid.spec.ts`, run first
against Handsontable and then against the own grid (the grid driver `ui/e2e/grid-driver.ts` changed, one header locator moved into it, and the U-quirk pins became normal tests);
**unit** = Vitest on `ui/src/domain/scoregrid.ts` (`ui/tests/domain/scoregrid.test.ts`, golden
`scoregrid.json`); **manual** = checked by hand (listed in the 3b report).

## Context and size

- One grid per group of the exam's jaarlaag, each under an `<h3>` with the group name, all inside
  the score modal; only the grids' area scrolls, the modal header stays (`loadScoreGrid`).
- Expected size: one class of about 30 students x up to 40 questions plus up to ~10 observaties;
  several groups (cluster groups repeat a student) per modal. A replacement must stay responsive at
  4 groups x 35 rows x 60 columns. Measured in Step 3b (mock build, Chromium, 6 grids / 11,410
  cells): typing a score plus Enter takes about 14 ms; the modal opens in about 1.7 s, mostly
  loading 140 score files. Only the changed row, the summary rows and the cross-hair are redrawn.

## Layout

| Id  | Rule                                                                                                                                                                                                          | Test   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| G01 | Columns: `#` (leerlingnummer), Naam, one per question, spacer, one checkbox per observatie of the exam + spacer (only if there are observaties), Totaal, Cijfer, spacer, R%, T1%, T2%, I%.                    | e2e    |
| G02 | Fixed column widths (72 / 150 / 32 / 20 / 28 / 72 / 52 / 44 px); no row headers; height grows with the rows (no inner scrollbar).                                                                             | manual |
| G03 | Question header stacks RTTI tag, points (`2p`), section and number; bonus and diag headers are grey italic with a tooltip ("Bonusvraag", "Diagnostische vraag"); observatie header = icon, title "naam (Fn)". | e2e    |
| G04 | Two summary rows at the bottom: "Gemiddelde" and "Standaarddeviatie" of Totaal, Cijfer and the RTTI columns; read-only, grey.                                                                                 | e2e    |
| G05 | No frozen rows or columns; the grid is centred and as wide as its table when narrower than the modal.                                                                                                         | manual |

## Entering scores

| Id  | Rule                                                                                                                                                                              | Test     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| G10 | Typing a number 0…max in a question cell saves it (number in the score file); the cell shows it with a decimal comma (`1,5`); `,` and `.` are both accepted as decimal separator. | e2e      |
| G11 | Empty input removes the score (key absent in the file; "not entered"), which is different from `0`.                                                                               | e2e      |
| G12 | `N` or `n` saves `null` ("niet gemaakt") and shows `N`.                                                                                                                           | e2e      |
| G13 | Numpad `.` writes `N` directly when the ". → N" checkbox is on (default), also while typing (the typed text is discarded). With the checkbox off it types a separator.            | e2e      |
| G14 | Anything else (text, negative, above max) is saved as typed, shown red, and raises a persistent error naming the question and the max.                                            | e2e      |
| G15 | After each change the row's Totaal (`scored / max`), Cijfer and RTTI % and both summary rows are recomputed (golden `scoregrid.json`: `recomputeRow`, `recomputeSummaryRow`).     | e2e+unit |
| G16 | Row status colours the `#` and Naam cells: invalid entry red, partly entered yellow, overwritten grade blue (`computeRowStatus`).                                                 | e2e      |
| G17 | Score colours: 0 light red, max light green, between light yellow, `N` grey bold; bonus columns blue italic, diag grey italic.                                                    | manual   |
| G18 | Cijfer, RTTI % and the std-dev row have background scales (`gradeColor`, `rttiPctColor`, `stdDevGradeColor`).                                                                     | manual   |

## Grade override (Cijfer column)

| Id  | Rule                                                                                                                                                                                           | Test |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| G20 | Typing a grade 1,0–10,0 (comma or point) overrides the calculated grade, rounded to one decimal, saved as `overrides[exam] = { cijfer, berekend }`; the cell gets a blue border and a tooltip. | e2e  |
| G21 | Empty input removes the override; invalid input shows an error toast and keeps the old value.                                                                                                  | e2e  |
| G22 | When the calculated grade changes after an override, the cell is marked stale (warning); right-click offers "Berekend cijfer herstellen" and "Waarschuwing negeren".                           | e2e  |

## Observaties

| Id  | Rule                                                                                                                                                           | Test                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| G30 | Observatie cells are checkboxes; one click toggles, even when the cell was not selected; saved per student.                                                    | e2e                   |
| G31 | On a selected observatie cell `1` checks and `0` unchecks; other printable keys do nothing (today they open the text editor, U19).                             | e2e (U19 fixed in 3b) |
| G32 | `F1`…`Fn` toggle the n-th observatie of the current student from any cell of the row, without moving, also while a score is being typed (the edit stays open). | e2e                   |
| G33 | Pasting into observatie cells saves them (`1`/`true`/`x` check, `0`/`false`/empty uncheck; fix U4).                                                            | e2e                   |

## Keyboard

| Id  | Rule                                                                                                                                                                                              | Test |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| G40 | Arrow keys move the selection; typing starts editing the selected cell; Escape cancels an edit.                                                                                                   | e2e  |
| G41 | Enter / NumpadEnter / Numpad `*`: commit and move to the next editable cell (questions, then observaties); after the row's last one, to the next student's first empty question (or same column). | e2e  |
| G42 | In the Cijfer column Enter commits and moves to the next student's grade.                                                                                                                         | e2e  |
| G43 | Numpad `/`: previous editable cell. Numpad `-` / `+`: previous / next student, at the first empty question (or same column).                                                                      | e2e  |
| G44 | Home / End: first / last question; from the first/last question to the observatie block and back.                                                                                                 | e2e  |
| G45 | Tab: next question, then observaties, then the next student's first question; stops after the last student. Shift+Tab: previous one (new).                                                        | e2e  |
| G46 | Ctrl+Z / Ctrl+Y (and Ctrl+Shift+Z) undo / redo the app's history (see G50). Fixes U1 (user decided 2026-10-27: app history).                                                                      | e2e  |

## Undo, saving, colleagues

| Id  | Rule                                                                                                                                                                                                                                                                                                                                  | Test   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| G50 | The ↶/↷ buttons undo/redo scores, observaties and grade overrides (50 steps); an entry whose cell a colleague changed in the meantime is skipped with a toast.                                                                                                                                                                        | e2e    |
| G51 | Every change is saved per cell right away (CAS write of the student's score file); scores another teacher saved in the meantime are kept.                                                                                                                                                                                             | e2e    |
| G52 | Fast entry never loses a value: changes made while an earlier save is in flight are queued and saved in order (fix U2).                                                                                                                                                                                                               | e2e    |
| G53 | A failed save shows a persistent error (U3, fixed in 3a). The new grid marks the cell as not saved and retries it when it is typed again, even with the same value (review 3a n7).                                                                                                                                                    | e2e    |
| G54 | Copy (Ctrl+C) copies the selected range as tab-separated text with the displayed values; paste (Ctrl+V) of a rectangular range fills cells from the selection and saves each like typing; a selection that is a whole multiple of the block is filled by repeating it (one value into a range). One paste or Delete is one undo step. | e2e    |
| G55 | A colleague's change to a shown student updates the row in place (not the cell being edited or one with a save in flight) and flashes the changed cells for 2 s in the colleague's colour.                                                                                                                                            | e2e    |
| G56 | Colleagues' cursors are drawn over their cell with a coloured border and name flag; their badges appear in the modal header.                                                                                                                                                                                                          | manual |
| G57 | A colleague's N-term change updates the spinner and all rows in place; other exam/group/student changes show a blocking reload notice.                                                                                                                                                                                                | e2e    |
| G58 | The selected row and column are highlighted (cross-hair).                                                                                                                                                                                                                                                                             | manual |

## Own grid (Step 3b)

Behaviour the own grid adds or defines where Handsontable had its own defaults.

| Id  | Rule                                                                                                                                                                                                                                       | Test   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| G59 | Delete / Backspace clear the selected question and Cijfer cells (as Handsontable did); observaties stay as they are.                                                                                                                       | e2e    |
| G60 | A range is selected with Shift+click, Shift+arrows or by dragging; Ctrl+A selects the whole grid. Paste selects the pasted block. Reaching a grid with Tab selects its first cell; only the focused grid shows a strong cursor.            | e2e    |
| G61 | F2 (when the exam has fewer than two observaties; otherwise F2 toggles observatie 2, G32) or a double-click edits the cell's current value; typing replaces it. While typing, arrows commit and move; after F2, Left/Right move the caret. | manual |
| G62 | Clicking outside the grid commits an open edit; Escape cancels it and stays inside the score modal. Ctrl+Z inside an open edit undoes the typing, not the app history.                                                                     | e2e    |
| G63 | The ↶/↷ buttons are disabled while their history is empty (U1).                                                                                                                                                                            | manual |

Not reproduced (Handsontable details): fill handle, column resizing, context menu except G22,
Handsontable's own undo, the `aria-hidden` workaround on its textarea. A fill handle would be new
behaviour.
