# Review: Step 3b (score-grid replacement)

Reviewer: fresh-context subagent, 2026-10-27. Scope: `git diff step-03a..HEAD` on
`step/03-ui-foundation` (10 commits, `1cc1fed`..`cd7447f`). I compared `ui/src/screens/scores.js`
with the Handsontable version in `_reference/renderer/screens/scores.js` and with
`git show step-03a:ui/src/screens/scores.js`, and read the new grid, the domain module, the D34
change, the CI and licence changes and the docs.

What I ran (PowerShell for npm, Git Bash for the rest):

- `npm run lint`, `npm run typecheck`: clean.
- `npm test`: Vitest 213/213 (13 files) and node 121/121 pass.
- `npm run test:e2e`: 81/81 pass.
- `npx playwright test --project=chromium e2e/score-grid.spec.ts --repeat-each=3`: 102/102 pass. I
  saw no flakes.
- `npm run licenses`: passes; `handsontable` is no longer in `package-lock.json`.
  `bash tools/check-spdx.sh`: clean.
- `npx playwright test --project=visual` (local baseline only): 35/37 pass. `modal-scores` differs by
  56 px and `modal-overzicht-resultaten` by 48 px at `maxDiffPixels: 0`. The `modal-scores` baseline
  was refreshed during 3b (13:01), so this is drift since then, not the Handsontable layout. I did not
  look into it further.
- Throwaway Playwright probes (deleted afterwards) for the cases below: the subject switch with
  queued saves, Ctrl+Z with the editor open, two grids in one modal, pasting one value into a range,
  closing the modal with the editor open, and F1/F2 behaviour.

Overall: the grid is small, readable and does what the spec says. The ScoreGrid interface is clean:
the owner keeps the data and the grid only reports edits. Escaping is right in the new code
(headers, D34 overview, cell text through `textContent`). There are no `style=` attributes in
markup: all styling goes through the CSSOM or classes. Listeners on `document` are removed in
`destroy()`. Paste reaches only the focused grid. Handsontable is gone from the lock file, the
bundle globals, ESLint and the CSS. CI uploads the exe only after the licence check. U1, U2, U4 and
U19 are fixed as the user decided. D34 asks first and shows a correct, escaped old-vs-new overview.

One major issue: queued saves resolve the subject when they run, not when the score is typed. After
a quick logout and login to another subject, they land in the wrong subject's file. I reproduced
this.

## Blockers

None.

## Major

### M1. Queued saves write to the subject that is active when they run, not when the score was typed

- **Where:** `ui/src/screens/scores.js:100-124` (`saveCell`, the global `saveChain`),
  `ui/src/store.js:539-540` (`setScore` passes `_activeSubject` to `updateStudentScores` when it is
  called). `setObservation` and `setGradeOverride` work the same way.
- **Evidence:** before 3b, `saveCell` called `write()` at once, so `Store.setScore` read
  `_activeSubject` at typing time. Now `write()` runs later, at the end of a chain that lives at
  module level and outlives the modal. `closeModal` and logout do not wait for it. Probe: open
  "Lege toets" (nat), `slowWrites(1000)`, type `1` Enter `2` Enter `3` Enter, close the modal, click
  the user badge, pick `schk` and the same teacher, then wait 4.5 s. Result: the nat file of student
  900004 has `nat-lege-toets: { q1: 1 }` only. The new file `2025-2026/scores/schk/900004.json`
  holds `{ "nat-lege-toets-2025-2026": { "q2": 2, "q3": 3 } }`. So two scores are lost in nat, and
  junk is written to schk. `stampMeta`/`_activeUser` has the same timing problem if the teacher
  changes. The window is the length of the queue: small on a local disk, but seconds on a slow or
  locked OneDrive folder, which is exactly the case U2 is about.
- **Fix:** pass the subject explicitly and capture it when the save is queued. For example, add a
  `subject` argument to `setScore`, `setObservation` and `setGradeOverride` (Store already has it on
  `updateStudentScores`), and read `Store.getActiveSubject()` in `scoreTyped`, `setObs` and
  `setGradeOverride` at typing time. Also consider letting logout wait for the queue (as
  `reloadScoreModal` does with `waitForPendingSaves`). Write the failing e2e first; the probe above
  works with `MockApi.slowWrites`.

## Minor

### m1. F1…Fn no longer toggle an observatie while a score is being typed

- **Where:** `ui/src/screens/scores.js:1196` (`if (editing) return false;`) comes before the F-key
  branch at `:1241-1249`.
- **Evidence:** the reference handles F-keys in its capture listener with no `isEditing` check. Its
  comment says "without moving the selection or closing an open editor"
  (`_reference/renderer/screens/scores.js`, F-key block). Probe: select q1, type `3`, press F1: the
  checkbox does not change and the editor stays open. Neither the spec (G32) nor `quirks.md` records
  this change. The browser default of F1 is also no longer prevented while typing.
- **Fix:** move the F-key branch above `if (editing) return false`, as in the reference. Add an e2e
  case "G32 while typing".

### m2. F2 cannot edit a cell in an exam with two or more observaties (G61 vs G32)

- **Where:** `ui/src/screens/scores.js:1243-1248` runs before the grid's F2 handling
  (`score-grid.ts:458`).
- **Evidence:** probe on Toets H2 (3 observaties): F2 on q2 toggles observatie 2 and opens no editor.
  G61 says "F2 or a double-click edits the cell". Only a double-click works there.
- **Fix:** document it in G61 ("F2 edits only when the exam has fewer than two observaties;
  double-click always works"). Or ask the user whether another key should edit.

### m3. Ctrl+Z while typing undoes a different, already saved cell

- **Where:** `ui/src/components/score-grid/score-grid.ts:419` lets Ctrl+Z through even while the
  editor is open. `ui/src/screens/scores.js:264-274` then runs `undoLast()` and calls
  `preventDefault()`.
- **Evidence:** probe: type `4` in q1 + Enter (saved), then type `2` in q2 and press Ctrl+Z. Result:
  q1 is reverted and saved as empty, the editor on q2 stays open with `2`, and Enter saves q2 = 2.
  In a spreadsheet (and in the reference, where the editor was a native textarea), Ctrl+Z while
  typing undoes the typing. G46 does not define this case.
- **Fix:** while an editor is open, first cancel the edit, or let the native text undo run (skip the
  app undo when `gridInstances.some((g) => g.isEditing())`). Record the choice in G46.

### m4. Two grids in one modal both show a "current" cell

- **Where:** `ui/src/components/score-grid/score-grid.ts:212-229`, `ui/src/style.css:1881`.
- **Evidence:** probe on H2 (2 groups): select [0,2] in grid 0, then [0,2] in grid 1. Both tables
  keep `td.current` with the same blue outline (the cross-hair stays too). Keys go only to grid 1,
  so the teacher cannot see which grid gets the input. Handsontable dropped the selection border on
  an outside click (`outsideClickDeselects`).
- **Fix:** style `.score-grid:focus-within td.current` strongly and dim `td.current` otherwise. Or
  clear the selection of the other grids in `onSelect`.

### m5. Pasting one value into a selected range fills only the top-left cell

- **Where:** `ui/src/components/score-grid/score-grid.ts:359-387`.
- **Evidence:** probe: copy `2`, select q1..q2 over two students, Ctrl+V. Only student 0's q1 is
  saved. As far as I know, Handsontable's CopyPaste repeats the clipboard block to fill a larger
  selection (`populateValues`). I could not run Handsontable any more to confirm. The spec (G54,
  G60) does not say which one applies.
- **Fix:** check what Handsontable 14 did. Then implement the fill, or record "no fill" in the spec
  next to the missing fill handle. Cut (Ctrl+X), which Handsontable also had, is missing from the
  spec's "Not reproduced" list too.

### m6. Ctrl+A + Delete clears the whole group; undo reaches back only 50 cells

- **Where:** `score-grid.ts:464-468` (Ctrl+A, new in G60), `:331-342` (`clearRange`);
  `scores.js:57`, `:143-146` (one history entry per cell, `MAX_HISTORY = 50`).
- **Evidence:** a range clear or paste creates one undo entry per cell. With 35 rows x 40 questions,
  Ctrl+A + Delete removes ~1,400 scores and every override of the group, and queues ~1,400 saves.
  Undo can bring back only the last 50 cells. Handsontable behaved the same, but G59/G60 now
  advertise both keys.
- **Fix:** group the changes of one `onChange` call into one history entry (undo/redo apply the
  batch). Or ask for confirmation when a clear touches more than one row.

### m7. Reopening the modal while saves are queued shows old values

- **Where:** `ui/src/screens/scores.js:126-131` (`waitForPendingSaves`, 5 s), `:463-468`
  (`reloadScoreModal`); the "Toets bewerken" path (`:278-284`) does not wait at all.
- **Evidence:** `Store.getStudentScores` reads the cache, and `update()` refreshes the cache only
  after each write. If the queue is longer than the wait (slow OneDrive), the new grid loads the old
  values. When the queued writes then finish, nothing redraws the grid, because own writes do not
  come back through Sync. The teacher sees their scores "gone" and may type them again. The data on
  disk is correct.
- **Fix:** when the modal opens, wait for `saveChain`, not for a 5 s poll. Or show a short
  "Opslaan…" state until the chain is empty.

### m8. The npm licence ban only covers production dependencies

- **Where:** `tools/check-npm-licenses.mjs:39-44` (`npm ls --omit=dev`).
- **Evidence:** Vite bundles whatever is imported, dev dependencies included. A `handsontable` added
  as a devDependency and imported would pass `npm run licenses` and ship in the exe uploaded by CI.
  This gap dates from 3a, but 3b relies on it ("CI uploads the exe only after the check").
- **Fix:** also scan the full tree for `BANNED` names (without `--omit=dev`). Or grep `ui/dist` for
  `handsontable` / `non-commercial-and-evaluation` in the CI job before the upload.

### m9. U1 test was not failing first; G63 has no test

- **Where:** commit `4000e36` ("Passes on Handsontable as well"); `ui/e2e/score-grid.spec.ts:307`;
  `docs/specs/score-grid.md:101` (G63 manual).
- **Evidence:** on Handsontable the undo buttons were never disabled (U1), so
  `#sc-redo toBeEnabled` passed for the wrong reason. The test does guard the fix now. But the bug
  that U1 describes (buttons never disabled, listener removed) has no direct test.
- **Fix:** add `await expect(page.locator('#sc-undo')).toBeDisabled()` right after opening the grid,
  and `#sc-redo` disabled after a new edit. That makes G63 an e2e rule.

## Nits

- **n1.** `docs/reference/quirks.md` U2 says "one chain per modal". The chain is module-wide and
  outlives the modal (`scores.js:81`), which is what makes M1 possible. Fix the wording with M1.
- **n2.** ADR-0004 "Outcome" and the spec header say the Playwright tests pass "unchanged except
  for the grid driver". In fact `test.fail` became `test` (U2/U4/U19), the G46 `fixme` became a
  test, G33 gained clipboard permissions, and G53/G59/G62 are new. All of these are fine; the claim
  should just say so.
- **n3.** `scores.js:767` and `:775` put `q.number` (and `q.max_points`) into header HTML without
  `escHtml`. This is the same as the reference, and the CSP blocks inline handlers. But
  `Column.header` is now documented as "the owner escapes any text in it".
- **n4.** A remote update can overwrite a cell whose last save failed (`scores.js:679-686` skips only
  in-flight saves). The cell then shows the colleague's value but keeps the `cell-unsaved` mark. Clear
  the mark when a remote value replaces the cell.
- **n5.** Focusing the grid with Tab before any click gives a grid without a current cell. Arrows and
  typing then do nothing (`score-grid.ts:417`). Select [0, first question] on the first focus.
- **n6.** Local `node_modules/@handsontable/` is left over from 3a (not in the lock file). `npm ci`
  removes it. It only matters for local greps.
- **n7.** The 56/48 px visual drift (see the header) should be re-baselined or explained before
  the next visual review.

## Checked and found fine

- **Parity of keys:** Enter/NumpadEnter/Numpad `*`, Numpad `/ - +`, Home/End, `0`/`1` on
  observaties, numpad `.` → N (also while typing), Tab order including the last-student stop, and
  Cijfer Enter all match the reference capture listener. The exceptions are m1 and m2.
- **Value handling:** `normalizeScore`/`gradeTyped` match the reference. A retyped unchanged value
  is skipped unless the cell is unsaved (G53). Re-entering a stale override confirms it, as before.
- **Domain move:** `ui/src/domain/scoregrid.ts` is a faithful move (U5 `parseInt` kept and
  commented). It is tested against `scoregrid.json`.
- **Saving:** U2 is fixed. Saves run in order, `pendingSaves` is counted per student+column and
  shared across cluster groups, and remote updates skip cells with a queued or in-flight save and the
  cell being edited. Undo/redo entries enqueue normally and check the cell value first. Score writes
  never throw `code: 'conflict'` (`update()` merges), and the rethrow still reaches the global
  handler for entity saves.
- **Editor lifecycle:** blur commits (also when clicking the close button: probe saved `q1: 3`).
  Escape cancels and does not bubble. `destroy()` closes the editor without a stale blur commit.
- **Checkbox:** one click toggles even when the cell was not selected, because the box element is
  reused across renders.
- **Incremental render:** each cell is fully reset (`cssText`, `className`, `title`) before its
  renderer runs. The cross-hair redraws the old and new row and column. Flash expiry has its own
  delayed row render. N-term changes and failed saves redraw everything. I found no stale-class path.
- **CSP:** all styling is CSSOM or classes; no `style=` in markup. `innerHTML` uses only escaped
  text (headers, D34 overview, cursor flags).
- **D34:** compares by id (ids come from name + year). Ids compare as strings. New and identical
  groups are left out. Cancel leaves both files untouched (e2e). Red/green rows and field changes are
  escaped.
- **Licences/CI:** `handsontable` is removed from `ui/package.json`, the lock file, `globals.ts` and
  ESLint globals, and is banned in the check. `THIRD_PARTY_LICENSES.md` is updated. The exe upload
  comes after `npm run licenses`.
- **Rules:** SPDX headers are present on all new files. UI text is Dutch with a decimal comma. No
  real student data (synthetic 9000xx ids).

## Triage (implementer, 2026-10-27)

| Id  | Decision                                                                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Fixed, test first (score-grid.spec "queued saves stay in the subject they were typed in"): `setScore`/`setObservation`/`setGradeOverride` take the subject captured by the grid; login waits for the queue. |
| m1  | Fixed: F-keys are handled before the "not while typing" keys, as in the reference (test "G32 F-keys also work while typing").                                                                               |
| m2  | Kept (reference behaviour wins): G61 now says F2 edits only when the exam has fewer than two observaties.                                                                                                   |
| m3  | Fixed: inside the cell editor Ctrl+Z is the native text undo (G62).                                                                                                                                         |
| m4  | Fixed: only the focused grid shows a strong cursor; the others are dimmed.                                                                                                                                  |
| m5  | Fill fixed (a selection that is a multiple of the block is filled, test "G54 one value pasted into a range"); Cut is in `docs/backlog.md`.                                                                  |
| m6  | Fixed: one paste or Delete is one undo step (same test).                                                                                                                                                    |
| m7  | Fixed: `loadScoreGrid` waits for the save queue before reading the files.                                                                                                                                   |
| m8  | Backlog.                                                                                                                                                                                                    |
| m9  | G63 test added. U1: the plain test documents G46; the U1 bug itself (listener removed) was found with a probe and fixed in the same commit.                                                                 |
| n1  | Fixed (quirks U2 wording).                                                                                                                                                                                  |
| n2  | Fixed (spec and ADR wording).                                                                                                                                                                               |
| n3  | Fixed: the question number is escaped.                                                                                                                                                                      |
| n4  | Backlog.                                                                                                                                                                                                    |
| n5  | Fixed: focusing a grid with no selection selects its first cell.                                                                                                                                            |
| n6  | Local only (stale folder, not in the lock file); no action.                                                                                                                                                 |
| n7  | Real: PowerShell edits had re-encoded `style.css` and two e2e specs (mojibake + BOM, e.g. the ⚠ marker). Repaired; visual test 37/37 against the post-grid baseline.                                        |
