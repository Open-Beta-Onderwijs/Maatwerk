# Review: step 23, PO c: PO beoordelen

Reviewer: fresh-context subagent, 2026-11-11. Scope: `git diff 3062568..HEAD` on
`step/23-po-grading` (PLAN-2 decisions 16-25, step 23; spec 4.13 "Scores invoeren (PO)" and
"Projectgroep beoordelen"; board 18; data-files-v3 "PO grading (0.14, step 23)"; grade rules
decision 28). Read-only review: no build or test was run (a gate was running in parallel).

## Summary

The grade rules match decision 28 exactly: the rubric grade is held 1,0..10,0 as before, the lines
are summed with `clean`, added once and the result is rounded and held 1,0..10,0 once at the end;
a line counts only with one decimal, within −9,0..+9,0 and not 0; lines alone give no grade
(`exam_results` still returns `None` without scores); an override replaces the result and its
staleness is judged against the grade with lines. `po` flows into every grade path (`exam_results`,
`HistoryEntry`, `bestAttempt`/`recordFor`, `getStudentHistory`, profiel, rapport, CLI stats). The
0.14.0 guard, `validate-data`, SPDX headers, escaping and CSP (`data-bg`, picked up by the
MutationObserver after `innerHTML`) are in order. The open problems are in the UI's data handling.
The grading dialog never reacts to changes of the PO itself, so it can write a group's grading into
a student who has left the group, or into a deleted PO. Lines stored in a form the UI does not
produce are silently rewritten on the next save, which changes grades. The rest are robustness
gaps around save/close/reload, the 0 score on the slider, and missing tests.
**Counts: 0 blockers, 2 majors, 9 minors, 4 nits.**

## Majors

### M1. The grading dialog ignores changes to the PO (projectgroepen, deletion) and keeps writing

`ui/src/modals/po-beoordelen.ts:93-111, 452-458, 466-496`

Evidence: `openPoGrading` takes `members` from `ctx.exam.projectgroepen` once, at open time. It
subscribes only to `onModalSync('scores')`, never to `'exam'` or `'rubric'`. The score table
underneath does subscribe to `'exam'`, but its handler is held while the grading dialog is on top
(`app.js` `_heldSync`). Scenarios:

- A colleague moves student S from this group to group B and B has no grading. S had no grading
  for this PO either, so `takeNewGroupGrading` returns early (`!source && !studentHasExamData`) and
  S's file is not touched. The conflict pre-check therefore passes (`memberKey` equals `base`).
  The next autosave writes this group's scores, lines and `projectgroep: <old id>` into S's file.
  S now has a grade in the averages for a group S is no longer in, until someone grades group B.
- A student the colleague added to the group gets nothing.
- A colleague deletes the PO: the dialog keeps autosaving every 10 s and on close. Each save
  creates `po[examId]`/`scores[examId]` entries for an exam that no longer exists. `validate-data`
  then reports them as "missing".

Suggested fix: subscribe to `onModalSync('exam', ...)` for this exam id. If the exam is gone, or
this group's `student_ids` changed, set `conflict = true` (stop saving) and show a reload notice
(or close on deletion), like the table does. Also re-read the exam in `save()`'s pre-check and
refuse to write when the membership differs from `members`.

### M2. Saving rewrites stored lines that the UI cannot represent, which silently changes grades

`ui/src/modals/po-beoordelen.ts:55-58, 61-65, 474, 480-492`;
`ui/src/domain/po-grading.ts:41-46, 194-197`

Evidence: the core reads a line value as a number or a numeric string (`opt_number`), and
`validate-data` does the same. In the UI:

- `linesOf` turns a numeric-string value (`"0.3"`, which the core counts) into `null`.
- `draftOf` shows `null` as an empty text, and `validLines` drops it on save.
- `draftOf` formats a stored value with `signedPoints` (`toFixed(1)`). An invalid stored `0.25`
  (counts nothing, `validate-data` warns about it) becomes the draft `"+0,3"`. That is valid, so
  it is saved as `0.3`.
- A stored `0` becomes `''` and is dropped.

Every save writes `own(m)` for every member, not only for the member being edited. Example: the
teacher changes only the overall comment. A classmate's own line `"0.3"` (string) disappears
(−0,3 on that student's grade), and another classmate's invalid `0.25` becomes a valid `+0,3`
(+0,3). Neither change shows in the dialog. The table has the same mismatch: `poLinesSum` over
`linesOf` shows no "Groep ±" or "Eigen ±" for a string line that the core does count in "Cijfer".

Suggested fix: make `linesOf` read values exactly as the core does: number or numeric string,
otherwise keep the raw value. Build the draft text from the raw value without rounding
(`String(v).replace('.', ',')`), so an invalid value stays visible with `aria-invalid`. Leave lines
of members the user did not edit untouched (write `ownLines` only for members whose drafts
changed), or keep invalid lines as stored instead of dropping them. Add a unit test for the round
trip.

## Minors

### m1. A conflict found during the write loop leaves the group split, and the reload can pick either version

`ui/src/modals/po-beoordelen.ts:483-496, 501-510`; `ui/src/domain/po-grading.ts:211-224`

The comment says "Every file first, so a conflict leaves the whole group as it was". That holds
only for conflicts seen by the pre-check. A colleague's write that lands between the pre-check and
`updateStudentScores(m)` throws `ConflictError` inside the second loop, after earlier members were
already written. The same happens for any non-conflict error (an unreadable file, 5 CAS retries,
read-only): a partial write. After the reload, `groupSource` takes the first member (by name)
whose `projectgroep` matches. That may be the user's own version, although the notice says the
colleague's version is loaded. The next edit then writes it to every member, and the colleague's
change is lost. The window is small (OneDrive arrival during a few local writes), but this is the
lost-update case the conflict design exists for.
Fix: on a conflict in the second loop, say so in the notice ("deels opgeslagen"). After the reload,
prefer the member whose file changed most recently (`_meta.updatedAt`), or the conflicting member's
version. At minimum, correct the comment and add a test.

### m2. Score 0 cannot be given directly to an unscored category

`ui/src/modals/po-beoordelen.ts:171, 330-336`

An unscored category renders `<input type=range value="0">`, and only the `input` event is
handled. Clicking the thumb at 0, or pressing Home or Left at 0, does not change the value, so no
event fires and the category stays "—". To score 0 the teacher must move to 1 and back. Until then
the group stays "Bezig" (`gradingStatus` needs every normal category scored). Fix: also handle
`pointerdown`/`click` and `keydown` on an empty category's slider to set the current value, or add
a small "0" button. Add an e2e step.

### m3. The sync-reload marker silently drops edits

`ui/src/modals/po-beoordelen.ts:452-458, 470`

When a member file changes and nothing is pending, `saved = '\u0000'` is set and `reload()` is
scheduled through `modalRefresher` (500 ms, then `loadPoContext` for every student). From then on
`save()` returns `true` without writing, while `changed()` shows "Wijzigingen worden automatisch
opgeslagen". Anything typed in that window is lost. If `loadPoContext` returns `null` (the PO was
deleted), the dialog stays open and every later edit is discarded for as long as it is open.
Use an explicit `reloading` flag that also blocks input or shows "Wordt opnieuw geladen…", and
close the dialog with a notice when the reload finds no PO.

### m4. Save failures on close are invisible, and quitting the app loses up to 10 s of work

`ui/src/modals/po-beoordelen.ts:265-268, 511-514`

`onClose` runs `save()` after the dialog is gone. A non-conflict error writes its message to
`statusRef`, an element that has been removed, so the teacher never learns that the last changes
were not saved. The dialog also registers no close guard, and the app has no window-close
handling, so quitting within 10 s of an edit loses it. Fix: after a failed save on close, show a
toast or `alertDialog`. Consider a `guardModalClose` that awaits `save()`, or a shorter autosave on
blur.

### m5. Vorige/Volgende reuse the table's context, which may be stale

`ui/src/modals/po-beoordelen.ts:429-433`

`go()` opens the next group with the `ctx` loaded when the table opened. Only this group's members
were refreshed (`ctx.records.set`). If a colleague changed the next group's files meanwhile (the
table's sync is held while grading is on top), the next dialog shows old data and old `base` keys.
Its first save is then a conflict notice that throws away the teacher's new work in that group.
The exam and rubric in `ctx` are also as of table open. Fix: `loadPoContext` again in `go()`
(cheap: the Store cache is warm).

### m6. Regrouping: no error handling after the exam is saved, and the warning depends on scores only

`ui/src/modals/po-groepen.ts:379, 406-409, 425-441`

`takeNewGroupGrading` runs after `upsertExam`, with no try/catch. If one `updateStudentScores`
throws (read-only, CAS retries, unreadable file), the rejection is unhandled, the modal stays
open, the exam is already saved, and some moved students keep their old group's grading (stale).
Retrying Opslaan re-runs `upsertExam` with the old `_meta`. The decision-19 warning is shown only
when `poHasScores`. A group graded only with observaties, comments or lines is replaced or cleared
without a warning. Fix: wrap the copy and report which students were not updated (they then show
as stale, see m7). Base the warning on `studentHasExamData` or `po` entries as well.

### m7. The score table shows stale members' old grading as if it were the group's

`ui/src/modals/po-scores.ts:118-146`

Each row is computed from the member's own file. A member whose `po[examId].projectgroep` names
another group (a failed or skipped copy, see m6 and M1) shows that group's scores, lines and grade
under this group's heading. The status and the grading dialog use `groupSource` and ignore that
file. Nothing marks the row. Mark such rows (for example "Nog van <andere groep>", or a warning
icon) or show "—", so the teacher knows that saving the group will replace it.

### m8. `po-beoordelen.ts` is over the size limit, with one ~430-line closure

`ui/src/modals/po-beoordelen.ts` (530 lines; `openPoGrading` spans lines 93-524)

This is above the ~500-line rule (PLAN section 2). The single closure mixes rendering, event
wiring, totals, the sync and reload logic and the CAS save, which makes M1, m1 and m3 hard to
reason about. Move the HTML builders (`catHtml`, `levelsHtml`, `lineRow`, `linesHtml`) to a
`po-beoordelen-view.ts`, and the save and pre-check (a pure `planGroupSave(records, base, g, own)`
plus the loop) to a module with unit tests. `po-groepen.ts` is also over the limit, at 512 lines.

### m9. Missing tests for the risky paths

`ui/e2e/po-grading.spec.ts`, `ui/src/domain/po-grading.test.ts`

Covered: the pre-check conflict, autosave with `page.clock`, Vorige/Volgende, regrouping into a
graded group and into an unstamped group. Not covered:

- a conflict or error inside the write loop (m1);
- conflict and save on close with ✕ or Escape (only Klaar is tested);
- giving a score of 0 (m2);
- moving a student into a group without any grading (the clear branch);
- a member whose file is missing;
- the line round trip of damaged or string values (M2);
- a PO whose rubric is missing (only "no projectgroepen" is tested);
- `writeGrading` when only own lines remain.

## Nits

### n1. `save()` waiters can run concurrently

`ui/src/modals/po-beoordelen.ts:467-471`

`if (saving) await saving;` does not loop. Two callers waiting on the same save (timer plus close
plus Volgende) both resume and both start a save. The writes are the same and serialised per file,
so this is harmless today. A `while (saving) await saving;` makes it obviously safe.

### n2. Orphaned doc comment in `types.ts`

`ui/src/domain/types.ts:82-83`

"One student's score file for one subject and year." now sits above `PoLine`, and `ScoreRecord`
has no doc. Move it back above `ScoreRecord`.

### n3. Static save status in the table footer

`ui/src/modals/po-scores.ts:234`

"● Alles opgeslagen" is static. The table never saves, so either drop it or show the last grading
save time, as the spec's "save status" suggests.

### n4. `validate-data` does not flag `po` entries under a test

`crates/maatwerk-core/src/validate.rs:893-905`

A `po[examId]` whose exam exists but is not `kind: "po"` is not flagged. The grade ignores it
(tested), so a one-line warning would be enough.

## Triage (implementer, 2026-11-11)

- **M1 fixed:** the grading dialog listens to its PO (`onModalSync('exam')`): deleted, or this
  group's members changed, stops saving with a notice (reload or close); `save()` also reads the
  PO from disk first and writes nothing when the group's members differ. e2e "a colleague who
  changes the group while grading stops the saving".
- **M2 fixed:** `linesOf` reads a numeric string as the grade rules do; a stored value is shown
  unrounded (`lineText`: `+0,25` stays `+0,25`, marked invalid); a member's own lines are written
  only when edited in the dialog, otherwise kept exactly as stored (`writeGrading`). Vitest and
  e2e "stored lines survive an edit elsewhere".
- **m1 fixed in part:** the module comment now says what is and is not atomic; after a conflict
  inside the write loop the reload starts from the conflicting member's file (`prefer`), so the
  colleague's version is shown. A test for a write between check and write: backlog.
- **m2 fixed:** a click or Left/Down/Home/PageDown/0 on an empty slider scores its value (0 too);
  e2e.
- **m3 fixed:** a pending reload stops saving and says "Gewijzigd door een collega: opnieuw
  laden…".
- **m4 fixed in part:** an error or conflict after the dialog closed is a persistent error
  message. Quitting the app within 10 s of an edit: backlog.
- **m5 fixed:** Vorige/Volgende load fresh files for the next group.
- **m6 fixed:** the regroup copy is in `po-regroup.ts`, errors after the groups were saved are a
  persistent message; the warning shows when the PO has any grading (`poHasGrading`).
- **m7 fixed:** a member graded in another projectgroep gets an "andere groep" tag in the table.
- **m8 fixed:** markup and line drafts moved to `po-grade-view.ts` (`po-beoordelen.ts` 499 lines);
  the regroup code to `po-regroup.ts` (`po-groepen.ts` 494 lines).
- **m9 in part:** added e2e for M1, M2, a score of 0 and Escape saving; the mid-loop conflict and
  a missing member file: backlog.
- **n2 fixed.** n1, n3, n4: backlog.
