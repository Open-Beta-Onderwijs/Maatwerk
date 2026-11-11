# Shared `data/` folder, format v3

The format Maatwerk writes from 0.9 on (step 18; PLAN-2 decisions 5, 11, 13, 14; ADR-0010 item
7). Only the differences from v2 ([data-files-v2.md](data-files-v2.md)) are listed. The migration
(`maatwerk-core::migrate::v3`, `maatwerk-cli migrate`, the app's start screen) turns a v2 folder
into v3, and a v1 folder through v2 into v3 after one backup.

## Layout

```
data/
├── config.json                 { schema_version: 3, ... }
├── school.json                 + minAppVersion "0.9.0" (or higher)
├── afbeeldingen/               was fotos/: photos, school logo, watermark
├── aanwezigheid/<userId>.json  was users/: presence
├── rubrics/<id>.json           from 0.12 (see "Rubrics" below)
└── ...                         everything else as in v2
```

- **`afbeeldingen/`** (X-07b): the paths in `school.json` (`logo`, `watermerk`) and in
  `gebruikers/<id>.json` (`foto`) say `afbeeldingen/<name>`. The rapport mounts it as
  `/data/afbeeldingen`. The migration moves every file below `fotos/` (any case, quirk T32)
  with its relative path; a different file already at the new place is left alone with a
  warning.
- **`aanwezigheid/`** (X-07c, D20): the presence files. The migration does not move the v2 files
  (with every app closed they are stale) but removes them. Every app removes the files whose
  `heartbeatAt` is more than 30 days old, or missing, when it starts.
- A `fotos/` or `users/` folder in a v3 folder is a leftover: `validate-data` names it.

## `config.json`, `school.json`

`schema_version` is **3**. Apps up to 0.8 refuse the folder at start (`unsupported_schema`, "een
nieuwere versie van Maatwerk"). The migration raises `school.json` `minAppVersion` to `0.9.0`
when it is absent or lower (decision 5), so later additive changes can use the read-only guard.

## Exams

| Field             | Type              | Default   | Meaning                                                                                                                                                  |
| ----------------- | ----------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`            | `"toets" \| "po"` | `"toets"` | A test or a practical assignment (decision 14; the PO modal is F-20)                                                                                     |
| `diagnostic`      | `bool`            | `false`   | Counts for neither rapport nor SE: weging 0, never `type: "pta"` (decision 6)                                                                            |
| `obs_from_parent` | `bool`            | absent    | An inhaal/herkansing (`parent_id`) whose `obs_ids` are the original's, locked (decision 13, F-12)                                                        |
| `opdrachtenVraag` | `VraagCard[]`     | absent    | F-14: `{ id, vraag, onder, opdrachten: [opdrachtId] }`: a student whose score on question `vraag` is below `onder` points, or `"N"`, gets the opdrachten |

- The migration writes `kind` and `diagnostic` into every exam that lacks them; the app writes
  them on every save (`Store.upsertExam`). Readers treat an absent field as the default.
- A resit gets `obs_ids` = the original's, then any of its own that the original does not have
  (kept, with a warning), and `obs_from_parent: true`. The migration lists every resit's
  observaties before and after (`notes`; the start screen and `migrate --dry-run` show them before
  anything changes). The app copies the original's observaties when it creates a resit; locking
  them in the edit screen is step 20.
- `opdrachtenVraag` is defined now (data part of F-14); the screen that sets it is step 26.
  Matching (user 2026-11-07): `onder: 2` matches 0, 1 and `"N"` (not attempted); an empty
  score (not entered) never matches. The link is on the exam, not in `opdracht.json` (the
  ROADMAP F-14 text): the question exists only in that exam, it sits next to `opdrachten` and
  `opdrachtenCijfer`, and linking never rewrites a colleague's shared opdracht file.
- A changed entity file gets `_meta.rev` + 1, `updatedBy: null`, `updatedAt` = migration time.

## Rubrics and observatie toetstypes (0.12, step 21)

An additive change within v3 (PLAN-2 decisions 16, 20, 21, 23); `schema_version` stays 3.

```
data/
├── rubrics/<id>.json           new: one rubric, shared per vak like observaties
└── observaties/<id>.json       + toetstypes
```

**`rubrics/<id>.json`** (CAS + `_meta` like every entity; new ids are opaque, as observaties):

```
{ id, naam, beschrijving?, subject, schoolsoort: [..], jaarlagen: ["4", ..], obs_ids: [obsId],
  categories: [{ id, naam, max, soort: "normaal" | "bonus" | "diagnostisch", obs_ids: [obsId],
                 niveaus: [{ min, max, titel?, uitleg }] }],
  _meta }
```

- Rules (`maatwerk_grades::rubric`, one implementation for the UI, the core and the CLI): a
  category has 2-5 niveaus; `max` and the bounds are whole points (`max` from 1 to 100, user 2026-11-10); a niveau
  lies within `0..max`; niveaus may overlap but no two share a `min` or a `max`; together they
  cover every score from 0 to `max`. `naam` (rubric, category) and `uitleg` are required, `titel`
  is not. A rubric needs a vak, a schoolsoort, a jaarlaag and at least one `normaal` category.
- PO grade (decision 16): 10 × points ÷ max, between 1,0 and 10,0, where points = normal + bonus
  category scores and max = the sum of the normal maxima; diagnostic categories count in
  neither. Whole points only, no N-term.
- **In use** = an exam in any school year names it (`rubric_id`, written from step 22). Then the
  categories (their ids), every `max` and every `soort` are locked, and the file cannot be
  deleted (decision 20); names, niveaus and observaties stay editable.
- `obs_ids` (rubric and category) name observaties of toetstype `po`.

**Observatie `toetstypes`**: `["toets"]`, `["po"]` or both, never empty. Absent means
`["toets"]`; the v2 -> v3 migration writes it, and the observatie form always does. Test screens
list `toets` observaties, PO screens (rubric editor, PO grading) `po`; opdracht bewerken lists all.

**Guards in the core** (`maatwerk_core::rubrics`, inside `Storage::write_json` and `delete`): a
rubric write is refused (`invalid_argument`, Dutch message) when it breaks the rules, when its `id`
is not its file name, or when it is in use and changes what is locked; deleting a rubric in use is
refused. The first rubric, or the first observatie with `po` in `toetstypes`, raises `school.json`
`minAppVersion` to **0.12.0** first, so an older app becomes read-only before it can list PO
observaties in a test or overwrite what it does not know. Without a `school.json` (not synced
yet) nothing is raised.

## PO exams (0.13, step 22)

Additive within v3 (PLAN-2 decisions 16-18, 22). A PO is an exam file with `kind: "po"`:

```
{ id, title, kind: "po", rubric_id, projectgroepen: [{ id, naam?, student_ids: [..] }],
  subject, jaarlaag, schoolsoort, periode, weging, weging_se, type, diagnostic,
  questions: [], obs_ids, parent_id?, attempt?, description?, _meta }
```

- No questions and no N-term (`n_term` is not written; a stray one is ignored). PTA and D work
  as for a test. A herkansing (`parent_id`, `description: "HERKANSING"`) keeps the original's
  `rubric_id` and starts with a copy of its projectgroepen (new ids, editable); there is no
  inhaal for a PO.
- `rubric_id` names a rubric of the same vak with a shared schoolsoort and the PO's jaarlaag
  (the UI offers only those; it is not re-checked later). PO bewerken changes it only while no
  student has a score for the PO (or a herkansing of it).
- `projectgroepen`: a student is in at most one; students of different classes may be together
  (the UI offers the students of the classes with the PO's vak, a shared schoolsoort and its
  jaarlaag); a student alone is a group of one; `naam` is optional ("Projectgroep n" is shown).
  Unplaced students get no grade. Empty groups are dropped on save. A student who leaves every
  projectgroep loses everything their score file holds for the PO (`scores`, `overrides`,
  `observations`, `po` under its id), after a confirm (user 2026-11-10, review 22 M2).
- Wiskunde: `subcategory` as for a test (`onderbouw` up to jaarlaag 3; `wisa`..`wisd` required
  from jaarlaag 4; user 2026-11-10).
- Scores (graded from step 23): `scores[examId][categoryId]`, whole points `0..max`. The grade is
  `maatwerk_grades` `calc_results` with the rubric **attached by the caller** (`exam.rubric`; an
  exam file never holds it): decision 16, rounded to one decimal; no RTTI. A PO without its
  rubric has no grade. The PO's grade counts in the year and SE averages like a test's.
- Guard: the first exam with `kind: "po"` raises `school.json` `minAppVersion` to **0.13.0**
  (`maatwerk_core::rubrics`), as for rubrics.

## PO grading (0.14, step 23)

Additive within v3 (PLAN-2 decisions 17, 19, 24; grade rules decision 28). A student's score file
(`<year>/scores/<vak>/<id>.json`) gets, per graded PO:

```
scores: { <examId>: { <categoryId>: 0..max } }        as in step 22
observations: { <examId>: [obsId] }                    general observaties, as for tests
po: { <examId>: { projectgroep, categoryObs: { <categoryId>: [obsId] },
                  categoryComments: { <categoryId>: "..." }, comment,
                  groupLines: [{ label, value }], ownLines: [{ label, value }] } }
```

- The category scores, `observations`, `categoryObs`, `categoryComments`, `comment` and
  `groupLines` are the projectgroep's: grading writes the same values into every member's file
  (CAS per file; decision 19). `projectgroep` names the group they were copied from. `ownLines`
  are the student's own and are kept when the student moves to another projectgroep; everything
  else is replaced by the new group's (after a warning).
- A line is grade points: at most one decimal, from −9,0 to +9,0, not 0; any other value counts
  nothing (`validate-data` warns). Grade = rubric grade + group lines + own lines, held between
  1,0 and 10,0 once, at the end (`maatwerk_grades` `exam_results`; decision 28). Lines alone give
  no grade.
- Guard: the first score file with a non-empty `po` raises `school.json` `minAppVersion` to
  **0.14.0** (`maatwerk_core::rubrics`): an older app would show PO grades without the lines.

## `validate-data`

Step 23 adds: `po` under an exam id that does not exist (missing), a `po` entry that is not an
object, `groupLines`/`ownLines` that are not lists, and lines that do not count (warnings).

Step 22 adds: a PO without `rubric_id` or with questions (warnings), `projectgroepen` shape
(errors), a student in two projectgroepen (error), a member who is not a student of the year
(missing), and `projectgroepen` on a test (warning).

Step 21 adds: rubric files (the rules above, errors; id = file name), their observaties (missing:
warning; not of toetstype PO: warning), `toetstypes` values (warning) and an exam's `rubric_id`
that names no rubric (warning).

Checks the above: `kind` value, `diagnostic` a bool and not with PTA (error), a diagnostic test
with a `weging` above 0 (warning; `weging_se` may stay, it applies only with PTA), `obs_from_parent` without `parent_id` (warning), `opdrachtenVraag` shape,
question and opdracht references. Leftover v2 folders are strays with their own message. Nothing
is ever removed by `validate-data`.
