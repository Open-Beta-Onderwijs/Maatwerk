# ADR-0003: Data format v2 candidates

Status: **open** (Step 1, 2026-10-25). Nothing is picked yet. The user chooses which candidates
Step 7 works out; Step 7 then writes the migration, the backup and the validation for the chosen
ones.

Context: the cutover is one-time and planned after Step 8; old and new app never share a data
folder (ADR-0001). That makes format changes possible, but every change costs a migration, tests
and risk. Facts below are from `docs/reference/data-files.md` and `quirks.md`.

Scale: cost / benefit / risk = low, medium, high.

| ID  | Candidate                                                                      | Cost   | Benefit | Risk   |
| --- | ------------------------------------------------------------------------------ | ------ | ------- | ------ |
| C1  | `schema_version` in `config.json` (folder-level) and optionally per file       | low    | high    | low    |
| C2  | Remove legacy files and the `migrate()` code paths                             | low    | medium  | low    |
| C3  | Drop `.lock` files; rely on CAS + `_meta.rev`                                  | low    | medium  | medium |
| C4  | Stop storing `lib.typ` in the data folder                                      | low    | medium  | low    |
| C5  | Normalise `_meta` (all single-object files, plus array files)                  | medium | medium  | low    |
| C6  | CAS for the blind-written files (`school.json`, `config.json`, RTTI templates) | low    | medium  | low    |
| C7  | Per-teacher `activeYear` instead of the shared `config.json` value             | low    | medium  | low    |
| C8  | Student IDs always strings                                                     | medium | medium  | medium |
| C9  | Explicit score encoding (`N` and invalid input not as `null` / free string)    | high   | medium  | high   |
| C10 | Stable entity IDs independent of titles (exams, groups)                        | high   | medium  | high   |
| C11 | RTTI template files: rename folder/keys, fix the `wis*` key mismatch           | low    | high    | low    |
| C12 | No transient files in the data folder (`_preview_*`, `*.tmp` leftovers)        | low    | low     | low    |
| C13 | Trailing newline and stable key order in JSON                                  | low    | low     | low    |

## Details

### C1. `schema_version`

- **Now:** no version anywhere; the format is inferred (legacy detection by "is this an array").
- **Change:** `config.json` gets `"schema_version": 2`. The new app refuses to write to a folder
  with a lower or higher version (with a Dutch message), and the migration sets it. Per-file
  versions only if a later change needs them.
- **Benefit:** makes the cutover and all later changes safe for the new app.
- **Limit:** an old v1 exe started on a v2 folder ignores the field and still runs `migrate()`
  (harmless once C2 removed the legacy files) and `seedInitialData()` (rewrites `lib.typ` when its
  hash differs, seeds `gebruikers.json` if missing), and it writes v1-shaped data. The cutover
  runbook (Step 7) must therefore remove or block old exes (for example by renaming the folder
  once); `schema_version` alone does not stop them.
- **Risk:** low. Note `config.json` is currently a blind write (C6).

### C2. Remove legacy files and `migrate()`

- **Now:** `students.json`, `groups.json`, `exams.json`, `observaties.json` at the root and
  per-year arrays may still exist as `null`-filled stubs and `*.bak` files; `migrate()` runs on
  every start.
- **Change:** the v2 migration moves them into the backup and deletes them from the folder. The new
  app contains no legacy detection.
- **Risk:** low if C1 exists and the backup is verified. Needs the user's confirmation that no
  folder still holds un-migrated pre-per-year data (architecture review, question 3).

### C3. Drop `.lock` files

- **Now:** a 10 s `.lock` next to every non-score file during a write; not an exclusive create;
  `locked` is never retried; it only lasts one synchronous handler, so it never blocks within one
  process, and across PCs it depends on OneDrive syncing `.lock` files in time (D3, D4).
- **Change:** remove them; CAS on the content hash plus `_meta.rev` already detects lost updates.
- **Benefit:** less OneDrive sync noise (open decision 3), simpler code.
- **Risk:** medium: CAS is per PC; two PCs writing the same file before OneDrive syncs produce a
  OneDrive conflict copy either way. Locks do not prevent that today either, so the risk is that we
  misjudge this; Step 4 concurrency tests should show it.

### C4. `lib.typ` not in the data folder

- **Now:** copied to `data/opdrachten/lib.typ` whenever its SHA-1 differs; teachers on different
  app versions overwrite each other's copy, which shows up as a change for everyone.
- **Change:** the Typst World serves the embedded `lib.typ` at that path (ADR-0002 5); nothing is
  written. Teacher files keep `#import "lib.typ": ...` unchanged.
- **Risk:** low. A teacher who opens an opdracht file in another Typst tool would no longer find
  `lib.typ` next to it; optional "export lib.typ" button if anyone needs that.

### C5. Normalise `_meta`

- **Now:** `_meta` only on exams, groups, observaties, opdrachten; legacy objects count as rev 0;
  field-merge writers bump `rev` without checking it; a legacy file without `_meta` can be silently
  overwritten on create (D-quirks).
- **Change:** every single-object file gets `_meta` on migration (rev 1, `createdBy` unknown);
  consider `_meta` for `students-<year>.json` and score files.
- **Risk:** low; changes many files at cutover (one big OneDrive sync).

### C6. CAS for blind writes

- **Now:** `school.json`, `config.json` and the RTTI template files are written without a check;
  last writer wins silently.
- **Change:** use the same CAS as other files. This is a behaviour change more than a format
  change; it could also be done in the port (ask).
- **Risk:** low.

### C7. Per-teacher `activeYear`

- **Now:** `config.json.activeYear` is shared: one teacher switching the year switches it for
  everyone on their next start.
- **Change:** keep a default in `config.json`, store each teacher's choice locally (session state)
  or under `users/<id>.json`.
- **Risk:** low. Needs the user's view on whether the shared year is intended.

### C8. Student IDs always strings

- **Now:** student numbers stored as JSON numbers in new data, strings in paths and presence; CSV
  re-import can duplicate students whose id is a string (B21).
- **Change:** strings everywhere, migrated once.
- **Risk:** medium: every comparison in the UI must be checked; leading zeros may already have
  been lost in existing data.

### C9. Explicit score encoding

- **Now:** missing key = empty, `null` = N (niet gemaakt), number = points, any other string =
  invalid input kept as typed. Easy to misread (the reference's own CLAUDE.md gets it wrong).
- **Change:** e.g. `{ "q1": 2.5, "q2": "N" }` with invalid input stored separately or not at all.
- **Risk:** high: touches the grade logic, every score file and the goldens. Probably not worth it
  before parity; consider for after cutover.

### C10. Stable entity IDs

- **Now:** exam ID = `<subject>-<slug(title)>-<year>`, group ID = `<slug(name)>-<year>`; the slug
  drops non-ASCII letters (`é` -> `-`), so two titles can collide; older exams have no subject
  prefix.
- **Change:** opaque IDs (e.g. ULID) with the title only as data.
- **Risk:** high: IDs are referenced from score files, groups, opdracht couplings and file names.
  Probably keep the scheme and only make collisions an explicit error.

### C11. RTTI template files

- **Now:** `templates/RTTI explanations and advices/rtti_expl_adv_<fileKey>_<jaar>.json` (spaces in
  the folder name); the rapport reads `wi`, the editor writes `wisa`..`wisd`, so bovenbouw
  wiskunde reports have no advice (B9).
- **Change:** a folder name without spaces and one key scheme; the migration merges the files.
- **Benefit:** high (fixes visible missing advice). **Changes report output**: needs the user's
  OK, and could also be fixed in the port.

### C12. No transient files in the data folder

- **Now:** `_preview_<file>.typ` copies and occasional `*.<pid>.tmp` leftovers in the synced
  folder.
- **Change:** previews are in memory (ADR-0002); the migration deletes leftovers.
- **Risk:** low.

### C13. Trailing newline, stable key order

- **Now:** `JSON.stringify(x, null, 2)`, no trailing newline, insertion order.
- **Change:** trailing newline, keep insertion order.
- **Benefit:** low (nicer diffs). Risk: every file changes once at cutover. Probably skip.

## Not candidates

- Splitting score files further, a database, or a different folder layout: no evidence that the
  current layout is a problem; it is readable and merges well on OneDrive.
