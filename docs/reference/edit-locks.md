<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Edit locks: what can change after data depends on it

Analysis of 2026-11-27 (user's request, input for step 41). It lists which changes and deletes
the app refuses once something depends on the record (scores entered, a PO using a rubric, a group
with students, ...), and where the refusal lives: in the **UI** (a disabled control, a toast, a
confirm), in the **core** (the write is refused whatever the UI sends), or both.

Aim (user): every lock is enforced in both layers, and fields that make no sense to change once
data depends on them get locked too.

## 1. How writes reach the disk

The UI writes whole JSON files through generic commands (`write_json`, `delete_file`,
`src-tauri/src/commands.rs:75`, `:157`). The core does not know "a student", "an exam" or "a
group" as entities; it sees paths and JSON. So almost every rule below is UI-only today. The core
guards that do exist:

| Core guard              | Where                                                                        | What it refuses                                                                               |
| ----------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Guest / read-only       | `storage/mod.rs` `refuse_guest`, `read_only`, `check_schema`                 | Every write by a gast account, or when the folder is read-only / too new for this app.        |
| CAS (`_meta.rev`, hash) | `storage/mod.rs` `write_json` with `Expect`                                  | A write over a colleague's newer version (conflict, not a lock).                              |
| Score lock (rights)     | `rights.rs:203` `check_json_write`                                           | A teacher changing a score file of a student outside their groups (step 35).                  |
| Cijfergemiddelden       | `rights.rs` `check_settings_write`                                           | `instellingen.json` `gemiddelden` changed by anyone but the admin (step 38).                  |
| Rubric validity         | `rubrics.rs` `guard_write` -> `check_rubric_valid`                           | An invalid rubric, or an id that does not match the file name.                                |
| Rubric lock             | `rubrics.rs` `guard_under_lock` -> `maatwerk_grades::rubric::locked_changes` | For a rubric used by >= 1 PO: a category removed or added, a category's max or soort changed. |
| Rubric delete           | `rubrics.rs` `guard_delete`                                                  | Deleting a rubric used by >= 1 PO.                                                            |
| `minAppVersion`         | `rubrics.rs`, `rights.rs` `after_login`                                      | Not a lock: raises the version so older apps open read-only.                                  |

"Used by a PO" is computed over every year's `exams/` (`rubrics::uses_of`), fail-closed.

## 2. Per entity

Legend: **UI+core** both enforce; **UI** only the UI; **none** nothing stops it; _confirm_ the UI
asks but allows.

### 2.1 Leerlingen (students, per school year, admin only)

| Action                                       | Condition                                            | Enforced             | Where                                        |
| -------------------------------------------- | ---------------------------------------------------- | -------------------- | -------------------------------------------- |
| Change leerlingnummer                        | existing student                                     | UI (field disabled)  | `modals/leerling-edit.js:55`                 |
| Delete student                               | has scores in any year/vak (`scores` or `overrides`) | UI (button disabled) | `screens/leerlingen.ts:286`, `store.js:1072` |
| Delete student                               | in a group of the shown year                         | UI                   | `screens/leerlingen.ts:292`                  |
| Change jaarlaag, schoolsoort, stamklas, name | has scores / in a group                              | **none**             | `modals/leerling-edit.js`                    |

Notes:

- `studentHasScores` (`store.js:1063`) ignores `observations` and `po` (bonus/malus lines): a
  student with only observaties or only PO lines counts as "no scores" and can be deleted,
  leaving an orphan score file.
- `Store.deleteStudent` (`store.js:636`) has no check itself; the guard is only the disabled
  button.

### 2.2 Groepen (groups, per year; admin, sectievoorzitter for composition and docenten)

| Action                                  | Condition                                  | Enforced                                 | Where                        |
| --------------------------------------- | ------------------------------------------ | ---------------------------------------- | ---------------------------- |
| Change name, jaarlaag, schoolsoort, vak | group has students                         | UI (fields disabled)                     | `modals/groep-edit.js:41-58` |
| Same fields                             | sectievoorzitter (not admin)               | UI                                       | `modals/groep-edit.js:45`    |
| Delete group                            | has students                               | UI (button disabled)                     | `screens/groepen.ts:165`     |
| Remove a student from the group         | student has scores for exams of this group | **none** (scores stay in the score file) | `modals/groep-edit.js`       |

Notes:

- Removing a student from a group changes who may edit their scores (rights depend on group
  membership), but leaves their scores. Probably fine; worth a conscious decision.
- `Store.deleteGroup` (`store.js:673`) has no check itself.

### 2.3 Toetsen (tests)

| Action                                                                             | Condition                             | Enforced                                                     | Where                                                                |
| ---------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| Jaarlaag, schoolsoort, vak, subcategorie                                           | always after creation                 | UI (not in the edit form)                                    | `modals/toets-nieuw.ts` only; `toets-edit.ts:193` shows them as text |
| Diagnostisch, PTA, weging, weging SE, periode                                      | exam has herkansing/inhaal, or is one | UI (locked, edited on the verzamelkaart)                     | `toets-edit.ts:93`, `exam-fields.ts:15`                              |
| Observaties of an attempt                                                          | attempt (`parent_id`)                 | UI (inherited from the original, F-12)                       | `toets-edit.ts:177`                                                  |
| Delete a question                                                                  | exam has scores                       | UI (button disabled)                                         | `toets-edit.ts:140`                                                  |
| Add a question                                                                     | exam has scores                       | _confirm_ ("kan achteraf niet meer worden verwijderd")       | `toets-edit.ts:386`                                                  |
| Add an observatie                                                                  | exam or attempt has scores            | _confirm_                                                    | `toets-edit.ts:373`                                                  |
| Remove an observatie                                                               | exam or attempt has scores            | _confirm_, then removes the indicaties from every score file | `toets-edit.ts:364`, `:446`                                          |
| Change max points, soort (normaal/bonus/diagnostisch), RTTI, section of a question | exam has scores                       | **none**                                                     | `toets-edit.ts:116`                                                  |
| Change n-term, title                                                               | exam has scores                       | none (intended: n-term is the usual correction)              |                                                                      |
| Delete exam                                                                        | has herkansingen                      | UI (toast) + `Store.deleteExam` throws `has_resits`          | `toets-edit.ts:487`, `store.js:757`                                  |
| Delete exam                                                                        | has scores                            | UI (toast, menu item disabled)                               | `toets-edit.ts:491`, `screens/exam-menu.ts:37`                       |

Notes:

- Lowering a question's max below an entered score, or turning a scored question into
  diagnostisch/bonus, silently changes grades. Whether that is wanted (a teacher fixing a typo in
  the max) is a user decision; today nothing warns.
- `examHasScores` (`store.js:1027`) looks at `scores` and `overrides` only, not at
  `observations`: an exam with only observaties ticked counts as unscored and can be deleted.

### 2.4 PO's (`kind: "po"`)

| Action                                                                   | Condition                     | Enforced                            | Where                              |
| ------------------------------------------------------------------------ | ----------------------------- | ----------------------------------- | ---------------------------------- |
| Rubric                                                                   | PO (or its family) has scores | UI (select disabled)                | `modals/po-gegevens.ts:48`, `:373` |
| Name, PTA/diag, schoolsoort, subcategorie, jaarlaag, periode, weging(en) | has herkansing / is one       | UI (edited on the verzamelkaart)    | `po-gegevens.ts:93`                |
| **Jaarlaag, schoolsoort, subcategorie**                                  | PO has scores                 | **none**                            | `po-gegevens.ts:100-125`           |
| Student leaves every projectgroep                                        | student has PO data           | _confirm_, then the data is removed | `modals/po-groepen.ts:391-408`     |
| Delete PO                                                                | has herkansingen / scores     | UI, as tests (2.3)                  |                                    |

Notes:

- **User's finding confirmed:** after scoring, jaarlaag and schoolsoort stay editable. That can
  leave the PO outside its rubric's scope (`domain/po.ts:37` `matchingRubrics`: same vak, shared
  schoolsoort, jaarlaag in the rubric's `jaarlagen`) and outside its students' groups.
- The core does not know a PO's rubric is locked: a PO with scores can be saved with another
  `rubric_id`. The rubric file is guarded, the PO's choice of rubric is not.

### 2.5 Rubrics (per vak, teachers and sectievoorzitters)

| Action                                                  | Condition                        | Enforced              | Where                                                              |
| ------------------------------------------------------- | -------------------------------- | --------------------- | ------------------------------------------------------------------ |
| Add / remove a category, change max or soort            | used by >= 1 PO (any year)       | **UI+core**           | `modals/rubric-editor.ts:102-183`, `rubrics.rs` `guard_under_lock` |
| Delete rubric                                           | used by >= 1 PO                  | **UI+core**           | `screens/rubrics.ts:51`, `rubrics.rs` `guard_delete`               |
| Names, niveaus (level texts), observaties of the rubric | used                             | allowed (decision 20) |                                                                    |
| **Jaarlagen**                                           | used by a PO                     | **none**              | `rubric-editor.ts:138`, `:416`                                     |
| **Schoolsoort** (deselect)                              | used by a PO of that schoolsoort | **none**              | `rubric-editor.ts:130`, `:415`                                     |

Notes:

- **User's finding confirmed:** both fields are free while the rubric is in use. A rubric can lose
  the jaarlaag or schoolsoort of the PO that uses it; the PO then shows a rubric "that no longer
  fits" (`po-gegevens.ts:208` keeps it listed).
- "In use" today means "named by a PO", scores or not. Decision 20 locks on that, not on scores.

### 2.6 Observaties (per vak)

| Action                                        | Condition                   | Enforced                                    | Where                                                 |
| --------------------------------------------- | --------------------------- | ------------------------------------------- | ----------------------------------------------------- |
| Delete                                        | linked to a test (any year) | UI (menu item disabled)                     | `screens/observaties/card.ts:52`, `observaties.ts:69` |
| Delete                                        | in a rubric (any vak)       | UI                                          | same                                                  |
| Toetstype Toets off                           | used by a test              | UI (chip disabled)                          | `screens/observatie-toetstype.ts:48`                  |
| Toetstype PO off                              | used by a rubric            | UI                                          | same                                                  |
| Jaarlagen, schoolsoort, vak, name, icon, text | used by a test / rubric     | **none**                                    | `modals/observatie-edit.ts`                           |
| Delete                                        | linked to opdrachten        | **none** (the opdracht keeps a dangling id) | `observaties/card.ts:52`                              |

Notes:

- Removing a jaarlaag from an observatie used by a test of that jaarlaag is allowed; the test
  editor keeps it (`toets-edit.ts:429`, T33) but would no longer offer it after it is removed.
- Indicaties in score files (`observations[examId]`) are not counted as "use": the test link is.

### 2.7 Opdrachten (Typst assignments, shared)

| Action                                             | Condition | Enforced       | Where                      |
| -------------------------------------------------- | --------- | -------------- | -------------------------- |
| Delete                                             | always    | _confirm_ only | `screens/opdrachten.ts:71` |
| Change observaties, jaarlagen, vakken, schoolsoort | always    | none           | `modals/opdracht-edit.ts`  |

Nothing depends on an opdracht's record after a rapport is made (the rapport copies in
`rapporten/` are standalone), so no lock seems needed. Only the link with observaties (2.6) is
loose.

## 3. Summary of gaps

UI-only locks that the core does not enforce (a second UI path, an import, the mock, a bug or a
stale form can break them):

1. Student delete with scores / in a group (2.1).
2. Group fields and delete with students (2.2).
3. Exam delete with scores (2.3; with herkansingen it is a Store check, still UI-side).
4. Question delete with scores (2.3).
5. Attempt top fields and observaties (2.3, F-12).
6. PO rubric with scores (2.4).
7. Observatie delete and toetstype when used (2.6).

Missing locks (user's findings and similar):

8. PO jaarlaag, schoolsoort, subcategorie after scores (2.4). **User: lock.**
9. Rubric jaarlagen while used by a PO; rubric schoolsoort deselect while used by a PO of that
   schoolsoort (2.5). **User: lock; adding a schoolsoort, or removing one no linked PO has,
   stays allowed.** Likely the same for jaarlagen: remove only one no linked PO has.
10. Student jaarlaag / schoolsoort with scores (2.1): candidate.
11. Question max / soort after scores (2.3): candidate, maybe a confirm instead of a lock.
12. Observatie jaarlagen / schoolsoort / vak while used (2.6): candidate, same rule as 9 (only
    values no linked test or rubric uses may be removed).
13. Observatie delete while opdrachten link it (2.6): candidate (or remove the link on delete).

Inaccurate "has data" checks:

14. `examHasScores` and `studentHasScores` ignore `observations` and `po` (2.1, 2.3).

## 4. Shape of a fix (proposal, for step 41)

- A core module (`maatwerk-core::locks`, next to `rubrics.rs`) called from `Storage::write_json`
  and `delete` under the commit lock, like the rubric guard. Per path kind it reads the old file,
  computes what changed, and only then scans what depends on it (scores of the exam's year/vak,
  exams using the rubric, ...), fail-closed like `rubrics::uses_of`.
- One "has data" definition (`scores`, `overrides`, `observations`, `po`) in core, exposed to the
  UI through a command, so the UI disables controls with the same rule the core refuses with
  (the pattern of `rubricLockedChanges`). The UI keeps its disabled controls and messages; the
  core error is the backstop and carries the same Dutch text.
- Tests first: one core test per lock (refused and allowed case), one UI test per disabled
  control, the mock backend following the core.

## 5. User's decisions (2026-11-27)

| #          | Decision                                                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1-7        | Every UI-only lock is enforced in core too.                                                                                                                                                                                                       |
| 8          | PO jaarlaag, schoolsoort and subcategorie (Wiskunde A/B/C/D) are locked once the PO (or its family) has scores. No escape hatch, also not for the admin: remove the scores or make a new PO.                                                      |
| 9          | A rubric is "in use" when a PO names it (decision 20, scores or not). In use: a jaarlaag or schoolsoort that a linked PO has cannot be removed; adding, and removing values no linked PO has, stays allowed.                                      |
| 10         | Student jaarlaag / schoolsoort: **no lock** (as today).                                                                                                                                                                                           |
| 11         | Question max points / soort after scores: **confirm, then allow** (the dialog says grades change). A max below an entered score for that question is refused. Not a core lock.                                                                    |
| 12         | Observatie jaarlagen / schoolsoort / vak: a value a linked test or rubric uses cannot be removed; others stay free (the rule of 9).                                                                                                               |
| 13         | Deleting an observatie that opdrachten link to is **blocked** (like a test or rubric link); the reason names the opdrachten.                                                                                                                      |
| 2.2        | Removing a student with scores from a group: **confirm** (scores stay; edit rights follow the group). Not a lock.                                                                                                                                 |
| 14         | One "has data" rule: `scores`, `overrides`, `observations`, `po`.                                                                                                                                                                                 |
| 5 (family) | Herkansing family locks in core through a new command `save_exam_family`: it checks the whole family, then writes every file. A direct write that makes an attempt's top fields or observaties deviate from its original is refused.              |
| Other PCs  | Gegevenscontrole (`validate.rs`) reports lock violations that arrive through sync (PO outside its rubric's scope, scores for a removed question, an observatie used outside its scope, a link to a deleted observatie). Report only, no auto-fix. |

## 6. Implementation plan (step 41 sub-task 5)

Order of commits (each with its tests first, mock following the core):

1. **`maatwerk_core::locks::has_data`** (decision 14): a score record has data for an exam when
   `scores[exam]` has any entry (`"N"` counts: the teacher entered it), `overrides[exam]` is not
   null, `observations[exam]` is not empty or `po[exam]` is a non-empty object. Helpers:
   `exam_has_data(storage, year, vak, exam)` (one folder read), `students_with_data(storage,
year)`. Commands `exam_has_data`, `students_with_data`; the UI's `examHasScores`,
   `studentHasAnyScores` and `studentHasExamData` use them (the Leerlingen screen keeps checking
   every year, as now).
2. **Guard hook**: `locks::guard_write` / `guard_delete` run in `Storage::write_json` /
   `delete` under the commit lock, next to the rubric guard. They read the old file once and
   scan other files only when a locked field changed; fail closed like `rubrics::uses_of`.
   Refusals: a new `Error::EditLocked { path, message }` (code `edit_locked`), Dutch message.
3. **Students and groups** (2.1, 2.2): removing a student from `students-<year>.json` while they
   have data in that year or are in a group of that year; a group's name, jaarlaag, schoolsoort or
   vak changed while it has students; deleting a group with students. A write that empties the
   group may change its fields too (found in step 41: the CSV import that replaces a group, D34,
   asks first and was refused; no student's scores stay with an emptied group).
4. **Exams** (2.3, 2.4, 10 m6): deleting an exam with data or with herkansingen; removing a
   question id while the exam has data; a PO's jaarlaag, schoolsoort, subcategorie or `rubric_id`
   changed while its family has data.
5. **Families** (decision 5): family fields are `type`, `diagnostic`, `weging`, `weging_se`,
   `periode`, `jaarlaag`, `schoolsoort`, `subject`, `subcategory`, `kind`, `rubric_id`; an
   attempt keeps every observatie of its original and may keep its own older ones, never gain
   new ones (`resitObsIds`). A direct write that changes a family field of a family member, or an
   original's `obs_ids` while it has attempts, is refused; `save_exam_family(year, exams)` checks
   that the whole family agrees, then writes the attempts and the original last (as today) with
   the family check lifted for that call only. The verzamelkaart, the test editor (observaties)
   and the PO form use it.
6. **Rubrics** (2.5, decision 9): `uses_of` returns each PO's scope; a jaarlaag or schoolsoort
   that a linked PO has may not be removed from the rubric. The UI disables those chips.
7. **Observaties** (2.6, decisions 12, 13): delete refused while a test (any year), a rubric or
   an opdracht links it (the message names them); toetstype Toets/PO kept while used; a
   jaarlaag, schoolsoort or vak a linked test or rubric uses may not be removed. UI chips follow.
8. **UI**: PO form locks jaarlaag/schoolsoort/subcategorie after scores (decision 8); question
   max/soort change after scores asks first, a max below an entered score is refused (11);
   removing a student with scores from a group asks first (2.2).
9. **Gegevenscontrole** (other PCs): PO outside its rubric's scope; scores for a question the
   exam no longer has; an observatie on a test outside the observatie's jaarlagen/schoolsoort; a
   link to an observatie that does not exist (opdrachten too).

   Done (step 41): "outside" is what the app would never offer, so normal use reports nothing:
   a test gets the observaties of its jaarlaag, a shared schoolsoort and its vak (toetstype
   Toets), as `toets-edit.ts` offers them; a PO gets rubrics of its vak and jaarlaag with a shared
   schoolsoort (`matchingRubrics`). The write guards are stricter (a value in use is never
   removed). Rubrics are not checked against their observaties' scope: the rubric editor offers
   every PO observatie. An empty jaarlagen or schoolsoort list on an observatie allows all (as
   the Observaties tab's filters); the guard follows that too. Missing observaties were already
   reported for tests, rubrics and opdrachten. The `school` fixture gets 64 warnings (its
   generator links observaties across jaarlagen); `tiny` none.
