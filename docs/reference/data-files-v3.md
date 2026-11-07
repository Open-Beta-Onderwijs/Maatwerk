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

| Field             | Type              | Default   | Meaning                                                                                                                                                |
| ----------------- | ----------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `kind`            | `"toets" \| "po"` | `"toets"` | A test or a practical assignment (decision 14; the PO modal is F-20)                                                                                   |
| `diagnostic`      | `bool`            | `false`   | Counts for neither rapport nor SE: weging 0, never `type: "pta"` (decision 6)                                                                          |
| `obs_from_parent` | `bool`            | absent    | An inhaal/herkansing (`parent_id`) whose `obs_ids` are the original's, locked (decision 13, F-12)                                                      |
| `opdrachtenVraag` | `VraagCard[]`     | absent    | F-14: `{ id, vraag, onder, opdrachten: [opdrachtId] }`: a student whose score on question `vraag` is a number below `onder` points gets the opdrachten |

- The migration writes `kind` and `diagnostic` into every exam that lacks them; the app writes
  them on every save (`Store.upsertExam`). Readers treat an absent field as the default.
- A resit gets `obs_ids` = the original's, then any of its own that the original does not have
  (kept, with a warning), and `obs_from_parent: true`. The migration lists every resit's
  observaties before and after (`notes`; the start screen and `migrate --dry-run` show them before
  anything changes). The app copies the original's observaties when it creates a resit; locking
  them in the edit screen is step 20.
- `opdrachtenVraag` is defined now (data part of F-14); the screen that sets it is step 26. `"N"`
  and an empty score do not match.
- A changed entity file gets `_meta.rev` + 1, `updatedBy: null`, `updatedAt` = migration time.

## `validate-data`

Checks the above: `kind` value, `diagnostic` a bool and not with PTA (error), a diagnostic test
with a weging (warning), `obs_from_parent` without `parent_id` (warning), `opdrachtenVraag` shape,
question and opdracht references. Leftover v2 folders are strays with their own message. Nothing
is ever removed by `validate-data`.
