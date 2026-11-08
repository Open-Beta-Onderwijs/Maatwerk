# Security review: steps 17 and 18 (Typst warnings, rapport watermark, data format v3)

Scope: `git diff a62ea7e HEAD` on `step/18-data-v3` (step 17 `a62ea7e..e84579a`, step 18
`e84579a..HEAD`), 123 files (+3625/-339; fixtures and golden PNGs not opened). Reviewer:
fresh-context security subagent. I read the code and the diff, not the commit messages or STATE,
and I did not run the suites. Threat model: anyone with write access to the shared OneDrive
folder (a colleague, or malware on any teacher PC) can put arbitrary file content and file names
there. Through OneDrive they cannot create symlinks or junctions on another PC; a local link
needs local access, or a sync client that recreates links (for example `rclone bisync --links`).

## Summary

| Severity | Count |
| -------- | ----- |
| Blocker  | 0     |
| Major    | 1     |
| Minor    | 5     |
| Nit      | 5     |

Checked and found fine:

- **Typst World sandbox (rapport):** the World still mounts one folder,
  `/data/afbeeldingen` -> `<data>/afbeeldingen`, with `.within(data_dir.root())`
  (`typst_svc/rapport.rs:68`). `Mount::resolve` canonicalises it and prefix-checks it, so a
  junctioned `afbeeldingen/` gives an empty mount. `load_mounted` parses the rest with `RelPath`
  (no `..`, not absolute), canonicalises it (or uses `find_ignoring_case`, then canonicalises),
  and checks `real.starts_with(root)`. The new existence probe (`rapport.rs:50`) only produces a
  boolean, and the template only reads the fixed name `/data/afbeeldingen/school-watermerk.svg`.
  The `watermark` field comes from Rust, not the UI: `RapportData` has only `exam_info` and
  `students`, and serde ignores unknown fields, so the UI cannot set it.
  `rapport-main.typ` reads it with `data.at("watermark", default: true)`. No new `eval`, `read`
  or `plugin` in the template. The existing `eval(_guard_markup(...))` calls are unchanged.
- **`find_ignoring_case` on the watermark path:** the parts are the constant
  `["afbeeldingen", "school-watermerk.svg"]`, and every step takes a name from `read_dir`, so it
  cannot leave the root. A symlinked hit is caught later by the mount/canonical check (see m4 for
  what that does to availability).
- **Warnings in the UI:** `render-warnings.ts` escapes `& < > " '` in every warning before it
  goes into `<pre>`. The title is built from a number only. `rapport.js:62` and
  `opdrachten-genereren.js:415` put only that HTML and the existing `encodeURIComponent`'d
  viewer URL into `innerHTML`. The opdracht labels in `job_warning_texts`
  (`src-tauri/src/render.rs:106`) come from data, but they reach the DOM only through `esc`.
  The new stylesheet is a file, so `style-src 'self'` still holds. The CSP in `tauri.conf.json`
  did not change.
- **Migration preview / report in the UI:** `migration.ts` builds every node with
  `el()` -> `textContent`, so exam titles and observatie names in `notes` cannot inject HTML. The
  issue table in `gegevens.ts` also uses `textContent`. The report file is plain text in the local
  backup folder.
- **`migrate_data_folder(dry_run)`:** a dry run skips `backup_dir`, and `migrate()` with
  `backup_dir: None` returns before any write (`migrate/mod.rs:134-144`). `save_report` returns
  `Ok(None)` without a backup, and validation runs only when `applied`. The command still runs
  only when the folder failed with `NeedsMigration`.
- **Migration paths:** every source path comes from `walk_all`, which lists only regular files
  and does not descend into links (`file_type()` does not follow links, and on Windows a junction
  counts as a link, so `is_dir()` is false). The targets are `afbeeldingen/<rest of a real
path>`, so there is no `..` and no absolute path. `move_file` never overwrites a different file
  (it warns), and an identical one only removes the source. `Op::Move` copies, then deletes, so
  a crash leaves two copies, never none. `rename_image_ref` can turn `fotos/../x` into
  `afbeeldingen/../x` inside JSON, but every later read goes through `RelPath::parse`, which
  rejects it.
- **`check_photo_path`:** `strip_prefix("afbeeldingen").strip_prefix('/')` plus "no further
  `/`" plus the image-extension check. `afbeeldingenX/a.png` and `afbeeldingen/sub/a.png` are
  rejected. `save_photo` still calls it.
- **Presence pruning (`presence.rs:125`):** it skips read-only folders. Names come from
  `list_dir` (regular files only) and go through `presence_path` (no separators, no `.`/`..`) and
  then `RelPath` and `Storage::delete`, which runs `DataDir::resolve`'s link-escape check and
  `check_writable`. A corrupt or half-synced file is kept. The worst a hostile writer or a wrong
  clock can do is delete presence files, and running apps rewrite those every 15 s. It runs
  during `Core::open`, which runs off the main thread.
- **`minAppVersion`:** `school_v3` is the first op of the v3 plan. An older app (0.8.0 already
  has `app_version.rs`, which arrived before step 15) becomes read-only on its next write, and it
  refuses `schema_version: 3` at open.
- **Validation (`validate.rs`):** the new checks only read the parsed JSON. Messages that embed
  `{card}` use `serde_json` `Display`, which escapes control characters.
- **Logs:** the new `tracing` lines log only counts, the data folder path (as before) and
  presence relative paths. They log no exam content and no student data. `redact()` now also
  covers `afbeeldingen/`.

## Major

### M1. A v2 folder whose `config.json` is missing is stamped as v3 without being migrated

- Where: `crates/maatwerk-core/src/storage/mod.rs:224-234` (`check_schema`, `Ok(None)` branch),
  `storage/mod.rs:568-574` (`seed_initial_data`), called from `src-tauri/src/state.rs:161`.
- Evidence:
  - With no `config.json`, `check_schema` returns `NeedsMigration` only for v1 markers without
    `gebruikers/`. The comment says "`gebruikers/` is v2: its `config.json` has not synced yet",
    and the result is `Ok(())`.
  - `Core::open` then calls `seed_initial_data`, which writes
    `{"schema_version": CURRENT_VERSION}`, now **3**, with `Expect::Missing`.
  - Before step 18 this wrote 2 on a v2 folder, which was harmless. Now it marks a v2 folder as
    fully migrated.
- Attack / realistic trigger: during the cutover window the folder is still v2. Two ways in:
  - A teacher installs 0.9.0 on a PC where OneDrive has synced `gebruikers/` but not yet
    `config.json`. This is the exact case the comment describes.
  - A hostile colleague deletes `config.json`.
- What follows when that app starts:
  - It writes `schema_version: 3` and takes no backup.
  - `fotos/` is not moved, so the watermark and logos are gone from the v3 paths. `users/`
    stays.
  - Resits do not get the original's observaties (decision 13), and `minAppVersion` is never
    set.
  - Every 0.9 app now treats the folder as current, so the migration (and its backup zip) can
    no longer be started from the app.
  - When the real v2 `config.json` arrives, OneDrive either makes a conflict copy or one version
    wins. Either way the school's folder is in a mixed state that only manual work fixes.
- Fix:
  - Do not seed `config.json` into a folder that already has content. `seed_initial_data` should
    write `config.json` only when the folder is empty, or only when `check_schema` found a
    truly new folder.
  - For a folder with `gebruikers/` (or any v2 marker: `fotos/`, `users/` in any case) and no
    `config.json`, open it without writing. Either show the startup error ("config.json
    ontbreekt; wacht tot OneDrive klaar is") or return `NeedsMigration { found: 2 }` when
    v2 markers are present.
  - Add a test: a v2-shaped folder without `config.json` is not stamped v3.

## Minor

### m1. The migration does not use the data folder's link-escape checks; a linked `afbeeldingen/` or `users/` reaches outside

- Where: `migrate/mod.rs:209-224` (`Op::apply`: `create_dir_all` + `write_atomic` on
  `root.join(...)`), `migrate/v3.rs:48` (target `afbeeldingen/<rest>`), `migrate/v3.rs:260-269`
  (`remove_empty_dirs` passes every root entry named `fotos`/`users` in any case to
  `remove_empty_tree`, without a file-type check), `migrate/plan.rs:57-67`.
- Evidence:
  - `Storage` resolves every path through `DataDir::resolve` (link-escape check). The migration
    writes raw `root.join` paths.
  - If `afbeeldingen` is a junction or symlink to an outside folder, every `fotos/**` file is
    written there under its own name and subfolders. Different existing files are not
    overwritten (`move_file` warns), but new ones are created.
  - If `users` (or `fotos`) is itself a junction, `remove_empty_tree` lists the target's
    contents, recurses into the real subfolders there and `remove_dir`s every empty one, so empty
    folders outside the data folder get deleted.
- Scenario: someone with local access (or a teacher who syncs with `rclone bisync --links`, where
  a `.rclonelink` file from the cloud becomes a real symlink) plants
  `afbeeldingen -> %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup` and
  `fotos/x.bat`. The admin migrates, and `x.bat` lands in Startup. That requires a link on the
  admin's disk, which OneDrive does not sync, hence minor.
- Fix:
  - Before planning, refuse (`blocked`) when any top-level folder the plan writes to or deletes
    from (`afbeeldingen`, `fotos*`, `users*`, `aanwezigheid`, year folders, …) is a link or
    resolves outside `root`. Or run every op path through `DataDir::resolve`.
  - In `remove_empty_dirs` and `remove_empty_tree`, skip entries whose `symlink_metadata` says
    link.

### m2. Two case variants of `fotos/` on a case-sensitive file system overwrite each other silently

- Where: `migrate/v3.rs:31-52` together with `migrate/plan.rs:201-218`.
- Evidence: on Linux, `top_dirs_like` returns both `Fotos` and `fotos`. `Fotos/a.png` and
  `fotos/a.png` both map to `afbeeldingen/a.png`. `move_file` checks `to.exists()` at plan
  time, when the target does not exist yet for either one, so both moves are planned. The second
  `write_atomic` replaces the first, and both sources are deleted. No warning is given.
- Scenario: the Linux migration of a folder where a Windows PC created `Fotos/` and a Linux PC
  created `fotos/`. Or a hostile writer adds `Fotos/school-logo.png` to replace the logo during
  the migration (they could also just overwrite it, so the real cost is the silent loss). The
  backup zip still has both.
- Fix: track the planned targets (the existing `planned` set) in `move_file`, and treat a
  planned target like an existing different file (warn and leave it, or use `free_name`).

### m3. The migration lowers a stricter `minAppVersion` and ignores the read-only guard

- Where: `migrate/v3.rs:99-106`; `migrate/mod.rs:107-123` (no `read_only` check);
  `app_version.rs` `required_version`.
- Evidence:
  - `required_version` deliberately treats a non-string or unparseable `minAppVersion` as
    "newer, refuse writes".
  - `school_v3` does `as_str()` -> `None` (number or object) or `compare` -> `None` (`"1.x"`),
    and both count as "lower", so it overwrites the value with `"0.9.0"`.
  - Neither `migrate` nor `migrate_data_folder` checks whether this app is read-only for the
    folder before writing.
- Scenario: a future app (or a cautious admin) sets a value that this build cannot parse, to keep
  old apps off. 0.9.0 still migrates the folder and downgrades the guard, so other 0.9 apps start
  writing again. Unlikely on a v2 folder, but the guard should not be removable by the code it
  guards.
- Fix: in `migrate_to`, refuse (`MigrationBlocked`) when `required_version(school,
APP_VERSION)` is `Some`. In `school_v3`, only replace a missing, empty or parseable lower
  value, and leave anything else alone with a warning.

### m4. One file from any writer makes every rapport fail, and a huge one stalls or crashes app start

- Where: `typst_svc/rapport.rs:50-51` (watermark flag from `is_file()`), the template background
  on every page (`rapport.typ:59-70`); `storage/mod.rs:420-432` (`read_photo_data_url`, no size
  limit) via `ui/src/app.js:602-604` at startup; `migrate/mod.rs:219` and `plan.rs:205`
  (`fs::read` of whole files).
- Evidence:
  - `watermark` is true for any file at `afbeeldingen/school-watermerk.svg`, including a
    malformed SVG, an SVG bomb, a symlink out of the folder (then `load_mounted` returns
    `AccessDenied`) or a multi-GB file. Typst then fails, or spends unbounded time and memory, on
    every rapport of the school.
  - The same file is read whole, base64'd and sent over IPC by every app at start
    (`applyWatermerk`).
  - The migration also reads every moved image whole into memory, and `move_file` reads both
    files when it compares them.
- Scenario: a hostile colleague drops a 3 GB `school-watermerk.svg` (OneDrive syncs it to
  everyone). Every app stalls or runs out of memory at start, and no rapport can be made until an
  admin deletes it. The step-17 change made the watermark optional, but it did not make it
  fail-safe.
- Fix:
  - Cap image reads (for example 10 MB) in `read_photo_data_url` and treat a larger file as
    absent.
  - In `rapport_world`, set `watermark` only for a regular, non-link file under the cap. Better:
    if the compile fails on the watermark, retry once without it and add a warning (the new
    F-04 panel can show it).
  - In the migration, stream the copy (`io::copy`) and compare sizes before contents.

### m5. The migration deletes every file below `users/`, and the confirmation preview never lists deletions or moves

- Where: `migrate/v3.rs:55-61`; `ui/src/screens/migration.ts:111-125`.
- Evidence:
  - `presence_v3` deletes every regular file below any-case `users/`: `.docx`, PDFs, subfolders,
    not only `<id>.json`.
  - The dry-run panel the admin confirms against shows only `notes` (the observaties). It does
    not show `deleted` or `moved` counts, the warnings, or what `users/` held.
- Scenario: someone kept files in `Users/` inside the shared folder, or a hostile writer hides a
  colleague's document there. The admin confirms without seeing it, and the file is gone from
  OneDrive for everyone. The local backup zip on the admin's PC is the only copy.
- Fix:
  - Delete only `users/*.json` (what presence wrote). Leave other files in place with a
    warning; `validate` already flags them as v2 leftovers.
  - Show the dry run's counts and warnings in the preview, not only the notes.

## Nit

### n1. `maatwerk-cli migrate` prints data-derived text raw to the terminal

`crates/maatwerk-cli/src/data.rs:247` (and the warnings at `:253`) print exam titles and
observatie names from the shared folder with `println!`. A title that contains ESC sequences
can inject terminal control codes (title changes, OSC 52 clipboard writes on some terminals) into
the admin's console. Fix: replace control characters (`char::is_control`) before printing, in the
CLI or once in `report_text`.

### n2. On Linux an `Afbeeldingen/` folder turns "no watermark" into "no rapport"

The probe `find_ignoring_case` (`rapport.rs:50`) finds `Afbeeldingen/school-watermerk.svg`, but
the mount is the exact name `data_dir.root().join("afbeeldingen")` (`rapport.rs:68`), whose
`canonicalize()` fails on a case-sensitive file system. The template is told to draw the
watermark, the read returns `NotFound`, and the compile fails. This is availability, not an
escape. Fix: resolve the mount folder with `find_ignoring_case` too, or probe exactly as the
mount resolves.

### n3. Stale doc comment on `save_photo`

`src-tauri/src/commands.rs:303` still says "Only `fotos/<name>`". The check now enforces
`afbeeldingen/<name>`.

### n4. Validation messages embed whole JSON objects

`validate.rs:524` and `:533` format the whole `opdrachtenVraag` card (`{card}`) into the message.
A crafted multi-MB card produces a multi-MB issue text in the admin screen and the report. Fix:
truncate (for example to 200 characters) or name only the `id`.

### n5. `prune_stale` reads every presence file whole at every start

`presence.rs:140` parses each `aanwezigheid/*.json` completely just for `heartbeatAt`. Thousands
of files or a huge file slow every app's start. This is harmless at real sizes; a size cap (skip,
do not delete, files over for example 64 KB) would bound it.

## Triage (implementer, 2026-11-07)

- **M1 fixed** (same as review 18 M1).
- **m1 fixed:** the v3 migration refuses when `fotos/`, `users/` or `afbeeldingen/` (any case)
  is a link or junction; removing empty v2 folders never follows a link (unix test).
- **m2 fixed** (review 18 m5). **m3 fixed** (review 18 m2: the migration also refuses on a
  read-only folder).
- **m4 partly:** the rapport leaves out a watermark over 5 MB. The UI's `applyWatermerk` reading
  the whole file, and the migration reading each moved file whole: backlog.
- **m5 partly:** the preview now shows how many files are moved and deleted and every warning;
  all files under `users/` are still removed (it holds only presence files; they are in the
  backup).
- **n2, n3 fixed.** n1, n4, n5: backlog.
