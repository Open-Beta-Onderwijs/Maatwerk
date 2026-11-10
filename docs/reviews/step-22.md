# Review: step 22 (PO b: PO in Toetsen and projectgroepen)

Scope: `d4299cc..HEAD` (branch `step/22-po`, commits `e858b22` = 22a core/data, `6c202ac` = UI,
`f3e5f39` = e2e fix; 40 files, +2727/-67). Reviewer: fresh-context subagent, checklist PLAN.md
Appendix C, 2026-11-10. I checked the code against PLAN-2 decisions 16-19 and 22, the step 22
section, design spec 4.13 and `docs/reference/data-files-v3.md` "PO exams". I did not use STATE or
the commit messages as evidence.

How findings were verified: by reading the code paths named in each finding. I ran
`cargo test -p maatwerk-grades -p maatwerk-core -p maatwerk-cli` (all green), `npx vitest run`
(44 files, 516 tests green), `npm run typecheck` and `npm run lint` (clean). I did not run
Playwright, the visual tests or the Tauri app, so the UI scenarios below are not reproduced at
runtime.

## Verdict

Not ready to merge until M1 is fixed. M2 needs a decision before step 23 starts.

The core part is solid. The PO grade in `calc_results` matches decision 16: whole points, bonus in
the points but not in the max, diagnostic in neither, no n-term, no RTTI. A PO without its rubric
has no grade. `Exam.rubric` is `Deserialize`-only, and the UI's `forGrading` returns a copy, so a
rubric cannot end up in a saved exam file. The `minAppVersion` guard checks the CAS before it
raises the version (the review 21 m1 fix also covers this path), and it is tested in any path
case. `validate-data` covers the documented checks. The new HTML is escaped consistently.

The gap is in the UI: two of the four grading entry points in `domain/` do not attach the
rubric, so PO grades are missing in the Groepen overview, the herkansing summary card and the
profile's best-attempt choice.

| Severity | Count |
| -------- | ----- |
| Blocker  | 0     |
| Major    | 2     |
| Minor    | 4     |
| Nit      | 6     |

## Majors

### M1. `bestAttempt` and `resolveBestAttempts` grade a PO without its rubric

- **Where:** `ui/src/domain/attempts.ts:37-53` (`coreCall('bestAttempt', recordFor(rec, attempts),
attempts)`: the exams are passed as they are; `questionScores` is built from `exam.questions`,
  which is empty for a PO), `ui/src/domain/attempts.ts:66-68` (`resolveBestAttempts(history)`:
  the history's exams are passed as they are). Callers: `ui/src/modals/groep-leerlingen.js:70`
  (`bestGradeForFamily`, every exam column of the Groepen overview), `ui/src/store.js:1014`
  (`computeBestGradeMap`, used by `toetsen.ts` `computeBestGradeStats` for a summary card and by
  `openBestGradesOverviewModal`), `ui/src/modals/profiel.js:71` (`Store.resolveBestAttempts(rawHistory)`).
- **What:** `grades.ts` (`calcResults`, `examResults`) and `statistics.ts` (`yearAverage`,
  `seAverage`, `trend`) map exams through `forGrading`, but `attempts.ts` does not. In Rust,
  `best_attempt` and `resolve_best_attempts` call `calc_results`, which returns no grade for a PO
  without `rubric`.
- **Scenario:** a PO with scores (the e2e seed `po-seed.ts` `scores: true` already has them; step
  23 will write them for real):
  1. The Groepen overview (`openGroupStudentsModal`) shows an empty cell in the PO's column for
     every student, while the "Jaar" average next to it includes the PO grade (`yearAverage` does
     attach the rubric). The two numbers do not agree.
  2. A PO with a herkansing: the summary card's statistics (`computeBestGradeStats`) are empty.
  3. In the profile, `resolveBestAttempts` sees no grade in any PO attempt and keeps the earliest
     one. A better herkansing is not the attempt shown, even though `seAverage` (which does attach
     the rubric) counts it, so the profile's list and its SE average disagree.
- **Fix:** attach the rubric in both functions:
  `coreCall('bestAttempt', recordFor(rec, attempts), attempts.map(forGrading))` and
  `coreCall('resolveBestAttempts', history.map((h) => ({ ...h, exam: forGrading(h.exam) })))`.
  For `bestAttempt`'s `questionScores`, read the ids the grade rules read: the rubric's category
  ids for a PO, the same as `Exam::score_ids`. Better still, have the core return them, so that
  `toets-overzicht.js:122-125/213-216` and `rapport.ts` stop rebuilding scores from
  `exam.questions` before step 23/24 open those paths for a PO. Then add one Vitest per entry
  point for a PO family (original 4/10, herkansing 9/10: best is the herkansing with 9,0). A grep
  for `coreCall(` over `ui/src/domain` shows no other call that takes exams.

### M2. "Unplaced students get no grade" is documented, but nothing enforces it

- **Where:** `docs/reference/data-files-v3.md` "PO exams" ("Unplaced students get no grade"),
  decision 18; `crates/maatwerk-grades/src/grade.rs:218-252` (`calc_po_results` grades any
  record that has scores for the PO, whatever the projectgroepen say);
  `ui/src/domain/po.ts:183-195` (`movedStudents` ignores students who are only removed);
  `ui/src/modals/po-groepen.ts:336-345` (the warning is only for moved students).
- **What:** decision 19 copies the group's scores into each member's score file. A student taken
  out of every projectgroep (× or drag back to "Niet ingedeeld") keeps those scores. The grade
  rules do not look at membership, so the student keeps a PO grade in the year and SE averages,
  the Toetsen statistics and the profile. The regroup dialog does not warn about this: a
  removal is not a "move".
- **Scenario (from step 23 on):** a group is graded. The teacher removes one student who turns
  out to have left the class. The student's year average still holds the PO grade, against
  decision 18, and nothing on screen tells the teacher.
- **Fix:** choose where the rule lives and record it before step 23:
  1. In the grade rules: `Exam` deserialises `projectgroepen`, and `calc_po_results` returns no
     calculated grade for a student who is in none. This needs the student id and is a change to
     `maatwerk-grades`, so it needs the user's OK.
  2. In the data: on save, the regroup dialog warns about removed students who have scores, and
     step 23 clears or archives their `scores[examId]`.

  In both cases, extend `movedStudents` (or add `removedStudents`) so the confirm dialog also
  lists removals when the PO has scores, and add a test.

## Minors

### m1. A drop of any dragged text adds it as a student id

- **Where:** `ui/src/modals/po-groepen.ts:277-281` (`setData('text/plain', id)`), `:297-306`
  (`getData('text/plain')` is placed without any check).
- **What:** the drop handler accepts any `text/plain` payload. If the teacher selects text in a
  projectgroep's name field (or in another app) and drags it onto a group, `placeStudent` adds
  that text as a member. The card shows "Leerling <text>", and Opslaan writes it to the exam
  file. `validate-data` later reports "leerling ... bestaat niet".
- **Fix:** use a private MIME type (`application/x-maatwerk-student`) for both `setData` and
  `getData`, and also ignore ids that are neither in `eligible` nor already in a group. Add an
  e2e step or unit test that drops plain text.

### m2. Ineligible members are kept silently after the scope changes

- **Where:** `ui/src/modals/po-groepen.ts:330-332` ("← Gegevens" carries `state.groups` back),
  `ui/src/modals/po-gegevens.ts:241-251` (step 1 and PO bewerken can change schoolsoort and
  jaarlaag), `ui/src/modals/po-groepen.ts:61-70` (`eligible` comes only from the matching
  classes).
- **What:** a teacher places students of jaarlaag 3, goes back with "← Gegevens", switches to
  jaarlaag 4 and returns. The jaarlaag 3 students stay in their groups: their class tag shows
  "—", they are not counted as unplaced, and they are saved. PO bewerken has the same effect
  after the PO is saved. The data doc says the UI offers only matching students. Nothing says
  the groups no longer match.
- **Fix:** when the groups dialog opens, mark members who are not in `eligible` (a warning tag or
  a footer note such as "2 leerlingen passen niet meer bij deze PO") and offer to remove them.
  Or, at least, show a confirm in step 1 when the scope changes while the draft has groups.

### m3. The results memo can keep a PO's "no grade" after the rubric is loaded

- **Where:** `ui/src/store.js:809-819` (`examResultsMemo`, keyed on record and exam identity plus
  `n_term`/`questions`), `ui/src/store.js:1286-1292` (the rubric watcher event clears the rubric
  cache and then awaits `loadRubrics`).
- **What:** `forGrading` looks the rubric up on every call, but the memo key ignores it. A render
  between `invalidateRubricCache()` and the reload, for example from another watcher event or a
  click, computes "no grade" for every PO and stores it in the memo. The Toetsen statistics keep
  that result until the record or the exam object is replaced. While the cache is empty, the PO
  card also shows "Rubric ontbreekt: geen cijfer".
- **Fix:** reload into a new array before dropping the old one: load first, then swap the cache
  entry. Also add the attached rubric (or a rubric cache generation counter) to the memo key, or
  skip the memo for a PO.

### m4. Keyboard use of the Projectgroepen dialog

- **Where:** `ui/src/modals/po-groepen.ts:207-224` (every placement re-renders both lists with
  `innerHTML`), `:151-156` (student button), `:164-171` (members are `div`s).
- **What:** after Enter on a student, or on a member's ×, the focused element is destroyed, so
  focus falls back to the document. A keyboard user has to Tab through the whole dialog again for
  every student. The student button's accessible name is "Naam Klas", which does not say what
  the button does. A member cannot be moved to another group without the mouse; it has to be
  removed and then added again.
- **Fix:** after a render, move focus to the next student in the free list (or to the list),
  and after × to the group's next member or its name field. Give the student button an
  `aria-label`, for example "Sanne de Vries (3H2) toevoegen aan Projectgroep 2".

## Nits

- **n1.** `crates/maatwerk-grades/src/grade.rs`, `model.rs`: CLAUDE.md says this crate changes
  only with the user's OK. The change implements decision 16 (the user's), but STATE does not
  record an explicit OK for touching `calc_results`/`exam_scores`. Mention it in the report.
- **n2.** `ui/src/modals/po-groepen.ts:322-323` against `:375`: "Willekeurig indelen" removes
  every empty group, including one the teacher already named, while the dialog says "Bestaande
  groepen blijven zoals ze zijn". Keep named empty groups, or say that empty groups are removed.
- **n3.** `ui/src/modals/toets-edit.ts:482-495`: `deleteExam` is shared, so a PO gets "Toets
  verwijderen?" and "Toets verwijderd." (the menu's disabled reason is already rewritten to
  "PO"). Pass a noun.
- **n4.** `ui/src/domain/po.ts:165-172`: `groupsToSave` does not remove a student who appears
  twice in one group (possible in a hand-edited file; `validate-data` reports it). Deduplicate
  with a `Set` per group.
- **n5.** `crates/maatwerk-core/src/validate.rs:466-555`: two cases are not reported:
  - a PO herkansing whose `rubric_id` differs from its original's, or whose original is not a
    PO (decision 22: same rubric);
  - an exam file that holds a `rubric` field (it must never be saved, see `model.rs:163`).

  Both are cheap warnings.

- **n6.** `ui/src/modals/po-groepen.ts:106`: `#po-free-note` changes on every placement but has no
  `aria-live="polite"`. `ui/src/screens/exam-menu.ts:105`: the tooltip "kan vanaf Maatwerk 0.14"
  promises a version number in UI text. "in een volgende versie" ages better.

## Triage

By the author, 2026-11-10.

- **M1 fixed**, failing test first (`po.test.ts` "the best attempt of a PO family…"):
  `bestAttempt` grades with `forGrading` and reads a PO's scores by category id;
  `resolveBestAttempts` grades its history with `forGrading`.
- **M2: the user's call** (asked in the step report). Options: the grade rules return no grade
  for a student outside the projectgroepen (changes `maatwerk-grades`), or step 23 removes a
  student's PO scores when the student leaves every group (a data change with a confirm). Until
  then nobody has PO scores (grading is step 23), so nothing is graded wrongly today.
- **m1 fixed:** drag data has its own type (`application/x-maatwerk-student`); dropped text is
  ignored.
- **m2 fixed (notice):** the footer note counts placed students in no matching class; they are
  tagged "—". Not removed automatically: the teacher decides.
- **m3 fixed:** the results memo also compares the rubric object.
- **m4 fixed:** student buttons have an aria-label; focus goes to the next student after an
  add, to the group name after a remove.
- **n1:** in the report (the grade crate implements decision 16 only; no rule changed).
- **n2 fixed:** a named empty group stays when randomising.
- **n3 fixed:** "PO verwijderen?" / "PO verwijderd."
- **n4 fixed:** a student once per group on save.
- **n5:** backlog.
- **n6 fixed:** `aria-live` on the note; the tooltip says "de volgende versie".
