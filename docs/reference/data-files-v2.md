# Shared `data/` folder, format v2

The format Maatwerk writes from Step 7a on (ADR-0003). Only the differences from v1
([data-files.md](data-files.md)) are listed; everything not mentioned here is unchanged. The
migration (`maatwerk-core::migrate`, `maatwerk-cli migrate`) turns a v1 folder into this format;
`maatwerk-cli validate-data` checks it.

## Layout

```
<shared folder>/
├── maatwerk.exe
├── rapporten/<YYYY-YYYY>/*.pdf                printed copies (C18; was data/rapporten/)
└── data/
    ├── config.json                            { schema_version: 2, activeYear?, _meta }
    ├── school.json                            School + _meta (C16), secties? (7b)
    ├── instellingen.json                      admin settings + _meta (Step 7b)
    ├── snapshots/<YYYY-MM-DD HHmm>.zip        snapshots (Step 7b); state.json: claim
    ├── gebruikers/<userId>.json               User + _meta (C16; was gebruikers.json)
    ├── users/<userId>.json                    Presence + _meta
    ├── fotos/                                 unchanged
    ├── observaties/<obsId>.json               unchanged + _meta.hash
    ├── opdrachten/<opdrachtId>/               one Typst project per opdracht (C14)
    │   ├── opdracht.json                      Opdracht + _meta (no `typFile`)
    │   ├── main.typ                           entry point (bundled opdracht-main.typ)
    │   ├── opdracht.typ                       the teacher's text
    │   ├── lib.typ                            the opdracht's own copy of lib.typ
    │   └── images/<name>.<ext>                figures, image("images/<name>.<ext>")
    ├── templates/rtti/<fileKey>_<jaar>.json   RttiTemplate + _meta (C11)
    └── <YYYY-YYYY>/
        ├── students-<YYYY-YYYY>.json          { students: Student[], _meta }
        ├── exams/<examId>.json                unchanged + _meta.hash
        ├── groups/<groupId>.json              unchanged + _meta.hash
        └── scores/<subject>/<studentId>.json  ScoreRecord + _meta
```

Gone: `gebruikers.json`, `opdrachten/lib.typ`, `opdrachten/<id>.json|.typ`,
`opdrachten/images/<id>/`, `templates/RTTI explanations and advices/`, `*.lock` (C3),
`_preview_*` and `*.tmp` (C12), all legacy files (C2).

## `config.json`

`schema_version` (int) is **2**. A folder without it is v1; the app offers the migration. A
higher value is refused ("nieuwere versie van Maatwerk"). The migration writes `schema_version`
last, so a folder that has it is completely migrated.

## `_meta`

- **Entity files** (exams, groups, observaties, opdrachten, gebruikers, `school.json`, RTTI
  templates): `{ rev, createdBy, createdAt, updatedBy, updatedAt, hash }` as in v1, plus `hash`.
  The migration gives files without `_meta` `rev: 1`, `createdBy/At: null`,
  `updatedBy: null`, `updatedAt: <migration time>`.
- **Other JSON files** (`config.json`, students, scores, presence): `_meta` holds at least `hash`;
  writers may add other fields.
- A new `_meta` is appended as the last key; a new `hash` as the last key of `_meta`.

### `_meta.hash` (C19)

SHA-256, lower-case hex, of the **canonical JSON** of the file's value with `_meta.hash`
removed (an `_meta` that becomes empty stays as `{}`). Canonical JSON = `serde_json` compact
serialisation with object keys sorted by byte order, numbers as `serde_json` prints the parsed
value. Only `maatwerk-core` computes it (on write, `storage::write_json`; on read and in
`validate-data`), always from a parsed value, so the file's own formatting does not matter.

A file whose `hash` is missing or wrong was changed outside Maatwerk: it is logged and listed for
the admin, never refused. "Accepteren" re-stamps the file as it is.

### Formatting (C13)

`JSON.stringify(x, null, 2)` style as before, plus a trailing newline.

## Students (C8)

`students-<year>.json` is `{ "students": [...], "_meta": {...} }`. `Student.id`,
`Group.student_ids[]` and `ScoreRecord.student_id` are **strings**. The migration converts
numbers with their JSON text (`12345` -> `"12345"`); two entries that become the same id are
merged (later fields win, as `mergeStudent`) and reported.

## Scores (C9)

`scores[examId][questionId]` is a number (points), the string `"N"` (niet gemaakt; was `null`)
or any other string (invalid input kept as typed). An absent key is still "not filled".

## IDs (C10)

New exams: `toets-<t>-<r>`, new groups: `groep-<t>-<r>` (`t` = ms epoch in base 36, `r` = six
random base-36 characters). Existing ids are kept. Every id used in a file name matches
`^[A-Za-z0-9_-]+$` (students: `^[^/\\:*?"<>|]+$`, as in v1).

## Opdrachten (C14)

- `opdracht.json` is the v1 `<id>.json` without `typFile`; its `id` equals the folder name.
- `opdracht.typ` is the v1 `<typFile>` with every `images/<id>/` replaced by `images/`.
- `main.typ` and `lib.typ` are the bundled versions at migration time (their first line names
  the version, ADR-0002 section 5a).
- An opdracht whose `.typ` was missing gets the bundled `base_assignment.typ` (reported).
- `.typ` files and image folders that belong to no opdracht are left where they are and listed as
  strays by `validate-data`.

## RTTI templates (C11)

`templates/rtti/<fileKey>_<jaar>.json`, same content plus `_meta`. `fileKey` is `nat`, `bio`,
`schk`, `wi` (jaar 1-3) or `wisa`..`wisd` (jaar 4-6). A v1 `wi_<4..6>` file (never written by the
editor, only read by the reference rapport) is copied to each `wisa`..`wisd` file of that jaar
that does not exist yet, then dropped.

## Accounts, roles and snapshots (Step 7b)

Additive: an absent field means "no PIN yet", "no role", "default settings"; no
`schema_version` change.

- **`gebruikers/<id>.json`**: `pinHash` (string, PHC `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>`)
  when the user has a PIN; the admin also has `recoveryCodeHashes` (array of the same, one per
  unused recovery code). Written only by `maatwerk-core::auth` (first PIN, change, reset, recovery,
  `maatwerk-cli admin reset-pin`), with a normal `_meta` (rev + 1). Other writers keep both fields.
  Codes are `ABCD-EFGH` (alphabet `23456789ABCDEFGHJKMNPQRSTUVWXYZ`), hashed in that form.
- **`school.json`**: `secties: { <vak>: { voorzitter: <userId> } }`, the sectievoorzitter per vak
  (decision 13). `validate-data` warns about an unknown user id.
- **`instellingen.json`** (entity file, `_meta`): `snapshots: { intervalHours (1-744, default 24),
daily (0-366, 7), weekly (0-520, 4), monthly (0-1200, 12) }` and (Step 8b, additive)
  `editor: { compileTimeoutSeconds (whole seconds 2-300, default 30) }`, the editor's compile
  time limit (ADR-0002 section 12). Unusable values count as the default.
- **`snapshots/`**: zips named `YYYY-MM-DD HHmm.zip` (local time; ` (2)` on a clash), holding
  every `*.json` and `*.typ` and `opdrachten/<id>/images/*` under their data-relative paths;
  not `fotos/`, `rapporten/`, `snapshots/`, temp files. `state.json`:
  `{ last, lastAtMs, lastBy, claim?: { by, atMs } }` (stamped). A claim younger than 30 minutes
  means another app is zipping. Retention: the newest snapshot, plus the newest per day, ISO week
  and month for the last `daily`/`weekly`/`monthly` of each that have one. Ignored by the watcher
  and by `validate-data`.

## Strays and placement (C19)

`validate-data` lists as strays: OneDrive conflict copies (`naam-PCNAAM.json`,
`naam (1).json`), files whose id does not match their path (`groups/<id>.json` with another
`id`), JSON in places Maatwerk does not use, and leftovers from v1. Ignored: `fotos/`,
`snapshots/`, images inside an opdracht folder.
