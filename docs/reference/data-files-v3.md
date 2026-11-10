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
  category has 2-5 niveaus; `max` and the bounds are whole points (`max` at least 1); a niveau
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

## `validate-data`

Step 21 adds: rubric files (the rules above, errors; id = file name), their observaties (missing:
warning; not of toetstype PO: warning), `toetstypes` values (warning) and an exam's `rubric_id`
that names no rubric (warning).

Checks the above: `kind` value, `diagnostic` a bool and not with PTA (error), a diagnostic test
with a `weging` above 0 (warning; `weging_se` may stay, it applies only with PTA), `obs_from_parent` without `parent_id` (warning), `opdrachtenVraag` shape,
question and opdracht references. Leftover v2 folders are strays with their own message. Nothing
is ever removed by `validate-data`.
