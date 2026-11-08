# Review: step 16 (Platforms: macOS and Linux)

Scope: `main...step/16-platforms`, 20 commits (`c91d467`..`6001f32`), 165 files (+1804/-145;
most of the files are the visual baseline PNGs, which I did not open). Reviewer: fresh-context
subagent, checklist PLAN.md Appendix C. I read the code and the diff, not the commit messages or
STATE. I did not run the suites; the findings below come from reading the code, and each one
cites the lines involved.

## Summary

| Severity | Count |
| -------- | ----- |
| Blocker  | 0     |
| Major    | 3     |
| Minor    | 7     |
| Nit      | 6     |

Checked and found correct:

- **Layering:** `data_location` lives in `maatwerk-core` with no `tauri` import. `choose_data_folder`
  only runs the dialog, then calls `save_choice` -> `data_location::check_chosen` +
  `LocalConfig`. `state::locate_data_dir` only gathers inputs (env, `current_exe`, `$APPIMAGE`,
  local config) for `data_location::locate`. No business logic in the shell.
- **Blocking work:** the folder dialog (`blocking_pick_folder`) and `save_choice` (directory
  listing, atomic write) run in `spawn_blocking`. `machine_name` (spawns `scutil` on macOS) runs
  on the snapshot thread, not the async runtime.
- **`locate` order:** env (empty counts as unset) > dev > chosen > `data/` beside the program,
  and only if that folder exists. `in_app_bundle` needs `<x>.app/Contents` (case-insensitive
  `.app`, exact `Contents`), so `Maatwerk.application/data` does not count as a bundle. Tests
  cover each rung of the order.
- **`check_chosen`:** it rejects relative paths, paths inside a bundle, missing folders and
  non-empty folders that are not data folders. It accepts a data folder, `<picked>/data`, or an
  empty folder (noise files such as `.DS_Store` and `desktop.ini` are ignored). A refused choice
  keeps the earlier one (`a_choice_is_stored_and_a_wrong_folder_is_refused`).
- **`LocalConfig`:** `#[serde(flatten)] other` keeps unknown fields on a rewrite (tested). The
  write is atomic. A corrupt file is ignored with a warning, and the teacher then chooses again.
- **`program_path`:** `$APPIMAGE` is used only on Linux and only when absolute, so a `.deb`
  install (`/usr/bin/maatwerk`) looks for `/usr/bin/data`, which does not exist, and asks.
- **Typst `find_ignoring_case` (security):** the parts come from a validated `RelPath` (no `..`,
  not absolute). Every step takes a name returned by `read_dir`, which never yields `.`/`..` or
  separators. The result is canonicalised, and the existing `real.starts_with(root)` check still
  applies, so a symlink that is found case-insensitively cannot leave the mount. An exact name
  wins; two names that differ only in case give "not found". The same function in `validate.rs`
  gets `img.split('/')` from the `.typ`: `..` or empty parts never match a directory entry, so it
  returns `None`.
- **`replace_ignoring_ascii_case` (byte safety):** `to_ascii_lowercase` changes only ASCII bytes
  and keeps the byte length, so every index from `match_indices` on the lowered copy is valid in
  `text`. The needle starts and ends with ASCII (`i`, `/`), so the slices fall on char
  boundaries even when the text around them has non-ASCII characters. Safe.
- **`default_lock_dir`:** it is per user on every platform. `LOCALAPPDATA` comes first, so
  Windows is unchanged. The logic is factored into `lock_dir_from` with injected env, and the
  test covers every branch.
- **`early_log_dir`:** it matches Tauri 2's `app_log_dir` (macOS `~/Library/Logs/<id>`, Linux
  `$XDG_DATA_HOME|~/.local/share/<id>/logs`).
- **UI:** `choose-folder.ts` and the `startup-error.ts` additions build every node with
  `textContent`, so there is no `innerHTML` with the path or the backend message. "Andere map
  kiezen…" appears only for `chosen`/`besideApp`, never for env/dev. The backend refuses env/dev
  too.
- **Cmd+Z:** `scores.js` accepts `metaKey`, and `score-grid.ts` already passes Ctrl/Meta+Z/Y to
  the owner. There is a new e2e test for Cmd+Z / Cmd+Shift+Z.
- **e2e WebKit adaptations:** the clipboard helpers keep the real clipboard and key path in
  Chromium and only synthesise the `paste`/`copy` events in WebKit. The CSP console filter
  applies to WebKit only, with the exact message, and Chromium still checks the app for inline
  styles. The `ControlOrMeta` changes are equivalent on Windows. The editor error steps now
  append text instead of replacing it, and the expected column moved from `3:9` to `3:17` to
  match. The dialog top check is polled. None of these weakens what Chromium tests, apart from
  n4 below.
- **CI:** the macOS job runs `npm test`, the WebKit e2e, the visual tests, `cargo test`, the
  real-PDF check on WebKit and the universal build (`lipo -archs`, `codesign --verify`, then the
  checksums). The Linux job additionally runs clippy, which covers the cfg(unix) paths, and a
  migrate + validate of the school fixture on a case-sensitive file system. The packaging config
  (`tauri.macos.conf.json`: ad-hoc `signingIdentity: "-"`, macOS 12; `tauri.linux.conf.json`:
  AppImage + deb) matches the user's decisions.
- **README:** the macOS "Toch openen" steps and the Linux sync advice match the user's choices
  (OneDrive Client for Linux recommended, rclone bisync as the alternative, mounts unsuitable).
  M-MAC-1..6 and M-LNX-1..6 are present. Quirk T32 records the case-insensitive lookup.

## Major

### M1. A chosen folder that has disappeared is silently re-created and seeded as a new school

- Where: `crates/maatwerk-core/src/data_location.rs:104-106`,
  `crates/maatwerk-core/src/paths.rs:139`, `src-tauri/src/state.rs:152-163`.
- Evidence: `locate` returns `Source::Chosen` for the stored path without checking that it
  still exists. `beside_app` is filtered with `is_dir()`, but the chosen path is not.
  `Core::open` then calls `Storage::open`, then `DataDir::open`, which runs
  `create_dir_all(root)`, and then `seed_initial_data`. That writes `config.json` and
  `gebruikers/admin.json` and creates `fotos/` and `opdrachten/`.
- Realistic triggers:
  - OneDrive is signed out or relinked. On macOS the folder under `~/Library/CloudStorage/`
    disappears.
  - The shared folder is renamed or unshared.
  - A USB disk or `/Volumes/...` path is not mounted.
  - On Linux, the abraunegg client has not run its first sync yet.
- Result: the teacher gets an empty Maatwerk with a fresh admin account instead of the startup
  error screen (which is where "Andere map kiezen…" lives). When the sync client brings the real
  folder back, it meets a folder with the same name holding a different `config.json` and
  `gebruikers/admin.json`. That produces conflict copies or one side overwriting the other.
  This is the "choosing a wrong data folder" data-safety case, and the new code makes it
  persistent.
- Fix:
  - For `Source::Chosen`, do not create the folder. Open a missing chosen folder as an error
    (e.g. `io` "map niet gevonden"), so the startup error screen with "Opnieuw proberen" and
    "Andere map kiezen…" appears. Either check `is_dir()` in `locate`/`Core::open` or give
    `Storage::open` a "must exist" variant.
  - Only `check_chosen` (an existing empty folder, chosen explicitly) and the env/dev sources
    may create or seed.
  - Add a test: a chosen folder that has been deleted is not re-created.

### M2. A wrong choice cannot be seen or undone from a working app, and it overrides `data/` beside the exe

- Where: `crates/maatwerk-core/src/data_location.rs:104-109`; UI: `chooseDataFolder` is only
  called from `choose-folder.ts` (first run) and `startup-error.ts` (open failed).
- Evidence: once a folder opens, the UI never shows which folder is in use. `get_data_dir` has
  no caller in normal screens, and "Over Maatwerk" does not show it. No screen offers
  "Andere map kiezen…".
- `check_chosen` accepts any empty folder, and the first-run text invites this for a new
  section. Two likely Windows paths:
  - A teacher starts the exe from Downloads, picks an empty folder, and gets a new, separate
    school.
  - A teacher picks the OneDrive shared folder while it is still empty during the first sync,
    and Maatwerk seeds it (see m1).
- In both cases the choice then also wins over `data/` beside the exe (chosen > besideApp).
  Starting the correct exe in the shared folder later still opens the wrong folder, silently.
  The only way out is deleting `%APPDATA%\nl.openbetaonderwijs.maatwerk\local-config.json` by
  hand.
- Fix (choose one, or both):
  - (a) Show the data folder and an "Andere gegevensmap kiezen…" action in a normal screen, for
    example "Over Maatwerk" or the admin's Gegevens check.
  - (b) Let an existing `data/` beside the program win over a stored choice, or ask once when
    both exist and differ. That keeps the Windows portable-exe behaviour the cutover runbook
    relies on.
- Also confirm the order with the user: it is a behaviour change on Windows, not only on macOS.

### M3. The new focus trap moves focus on every Tab, ignores handlers that already acted, and visits `tabindex="-1"` controls

- Where: `ui/src/components/dialog.ts:280-308`.
- Evidence: the listener now calls `preventDefault()` and `.focus()` on **every** Tab inside the
  top dialog. It does not check `e.defaultPrevented`. Its selector is `button, [href], input,
select, textarea, [tabindex]:not([tabindex="-1"])`, and the `:not` applies only to the last
  alternative, so `<button tabindex="-1">` and `<input tabindex="-1">` are included. Before this
  change that did not matter, because the browser chose the order and the trap acted only at
  the first and last element. Now the list _is_ the Tab order. Effects:
  1. **Inactive dialog tabs** are `<button role="tab">` with `tabIndex = -1` (roving tabindex,
     `dialog.ts:371-376`). Tab now walks through every inactive tab instead of skipping to the
     panel.
  2. **Score grid observatie checkboxes** are `input[type=checkbox]` with `tabIndex = -1`
     (`score-grid.ts:193`). They become Tab stops; a modal with 30 students × 3 observaties
     gets about 90 extra stops.
  3. **Score grid Tab:** `score-grid.ts:449-452` and `468-470` handle Tab with only
     `preventDefault()`, with no `stopPropagation()`. In the score modal, `scores.js` stops
     propagation only for question and observatie columns. On any other selected column (name,
     total, cijfer), the grid moves the selection, the event bubbles on to the backdrop, and
     the dialog then moves DOM focus out of the grid. The next arrow key no longer reaches the
     grid. G45 checks only the selection, not where focus is, so it does not catch this.
- This is a regression on all three platforms, including Windows, in the core score-entry
  modal.
- Fix:
  - Return early when `e.defaultPrevented`.
  - Filter with `x.tabIndex >= 0` (or `:not([tabindex^="-"])` on every alternative).
  - Optionally collapse each radio group to its checked radio.
- Add an e2e test that Tab on a non-question cell keeps focus in `.score-grid`, and a dialog
  unit test that inactive tabs are skipped.

## Minor

### m1. An empty folder is accepted without confirmation, including a shared folder that is still syncing

- Where: `crates/maatwerk-core/src/data_location.rs:164-171`, `ui/src/screens/choose-folder.ts:18`.
- Evidence: an empty folder is accepted and then seeded. During OneDrive's first download, or
  with the abraunegg client before its first sync, the real shared folder looks empty or holds
  only noise files. Seeding it creates `config.json` and `gebruikers/admin.json`, which then
  collide with the colleagues' files.
- Fix: when the chosen folder is empty, ask a Dutch confirmation ("Deze map is leeg. Nieuwe
  gegevens voor de sectie beginnen?"), and say that a shared folder that is still syncing must
  finish first.

### m2. `is_data_folder` treats any `config.json` as Maatwerk data

- Where: `crates/maatwerk-core/src/data_location.rs:179-181`.
- Evidence: a project or tool folder with a `config.json` (common) is accepted as a data
  folder. Maatwerk then adds `gebruikers/admin.json`, `fotos/` and `opdrachten/` to it (or
  `check_schema` refuses it, depending on its content).
- Fix: require `config.json` with a `schema_version` key, or `gebruikers/`, or `school.json`;
  read the JSON (it is small).

### m3. Case-insensitive lookup covers opdracht images only; photos, logo and watermark are not

- Where: `crates/maatwerk-core/src/validate.rs:337-352`; photo reads in `Storage`.
- Evidence: the plan asks for case tests over "path helpers, migration, validate-data". The
  World fallback helps Typst mounts, which covers the rapport logo through `/data/...`. Two gaps
  remain:
  - `gebruikers/*.json` `foto` and `school.json` `logo`/`watermerk` are still checked with an
    exact `files.contains`, so a case-only mismatch is "ontbreekt" (an error), even on Windows,
    where the app finds the file.
  - The UI photo read (`read_photo_data_url` -> `RelPath` -> `Storage`) has no fallback, so on
    Linux the avatar or logo is missing while Windows colleagues see it.
  - No `paths.rs` test was added for a mixed-case data folder.
- Fix:
  - Use the same `find_ignoring_case` warning for these keys in `validate`.
  - Either add the fallback to the photo read, or record in T32 that photo, logo and watermark
    paths need exact case on Linux.
  - Add a `paths`/storage test for the decision.

### m4. A visual baseline folder that goes missing makes CI pass

- Where: `.github/workflows/ci.yml:80-88`, `166-174`, `238-246`; `docs/testing.md:126-130`.
- Evidence: when `visual-baselines/<project>-<platform>/` is absent, the step runs
  `--update-snapshots=all` and **passes** with a warning. The documented way to accept a visual
  change ("delete the affected folders and push") also turns off the comparison for every view
  on that platform in that push. A regression in any other view on the same branch then becomes
  the new baseline without being noticed. A rename of the project or of Playwright's
  `{platform}` value would do the same silently.
- Fix:
  - After writing new baselines, end the step with `exit 1` (or require a
    `workflow_dispatch` input / commit trailer such as `[update-visual]`), so a run without a
    comparison is never green.
  - Delete individual files rather than folders: with the default `updateSnapshots: 'missing'`,
    Playwright writes the missing image and fails, which is the desired behaviour.

### m5. The lock folder on Linux depends on `$XDG_RUNTIME_DIR`, so two processes of the same user can use different locks

- Where: `crates/maatwerk-core/src/storage/commit.rs:41-53`.
- Evidence: with `XDG_RUNTIME_DIR` set, the lock is in `/run/user/<uid>/maatwerk-locks`;
  without it, in `~/.cache/maatwerk/locks`. These two kinds of process can therefore run on the
  same data folder without excluding each other, which removes the commit lock's guarantee for
  the CAS-and-rename window:
  - a desktop session versus `sudo -u`, a cron job or a systemd service running
    `maatwerk-cli` (migrate, validate, snapshot);
  - an `env -i` start.
- Fix: one rule that does not depend on session variables, e.g. always `$XDG_CACHE_HOME` or
  `~/.cache/maatwerk/locks`. A stale lock is harmless, because the lock is advisory and per
  file. Alternatively, document that the CLI must run in the same session.

### m6. README: the local config path contains a literal newline

- Where: `README.md:92-93`.
- Evidence: `` (`%APPDATA%`` / ``l.openbetaonderwijs.maatwerk\local-config.json`)``: the `\n` of
  `\nl.openbetaonderwijs…` was turned into a line break, so the path is broken in the rendered
  README (the code span is split).
- Fix: restore `` `%APPDATA%\nl.openbetaonderwijs.maatwerk\local-config.json` ``. Also add the
  macOS and Linux locations (`~/Library/Application Support/nl.openbetaonderwijs.maatwerk/`,
  `~/.config/nl.openbetaonderwijs.maatwerk/`): the README now covers those platforms, and
  removing this file is the only way to reset the choice (M2).

### m7. The snapshot claim uses the hostname, which is often not unique on Linux

- Where: `src-tauri/src/state.rs:343-358`, `crates/maatwerk-core/src/snapshots.rs:311,325,355`.
- Evidence: the claim counts as "mine" when `by == who`. Linux installs often keep the default
  hostname (`ubuntu`, `debian`, `linuxmint`). Macs may share a model-based `ComputerName`
  ("MacBook Air"). Two such machines both think they hold the claim and both write the zip.
  No data is lost, but there are duplicate snapshots and the protection the claim gives is
  gone.
- Fix: put a per-install random id in the claim, stored in `local-config.json`, e.g.
  `"<name> (<8 hex>)"`. Keep the readable name for "lastBy".

## Nit

- **n1** `src-tauri/src/state.rs:217-219`: the doc comment "The data folder as configured (also
  when it could not be opened)." now sits above `located()`. Its target, `data_dir()`, has
  lost its doc. Move the line back above `data_dir()`.
- **n2** `crates/maatwerk-core/src/data_location.rs:56`:
  `serde_json::to_value(self).expect(...)` panics on a non-UTF-8 `PathBuf`, which is possible
  on Linux. Inside `spawn_blocking` that surfaces as "blocking task failed". Map the error to
  `InvalidArgument` ("Kies een map met een gewone naam"), or refuse non-UTF-8 paths in
  `check_chosen`.
- **n3** `.github/workflows/ci.yml:219`: the apt line has long runs of spaces where line
  continuations were lost. It still works, but restore the `\` continuations for readability.
- **n4** `ui/e2e/editor.spec.ts:139`: `click({ force: true })` also applies in Chromium, where
  it skips the actionability checks it used to have. Apply `force` only in WebKit.
- **n5** `ui/e2e/helpers.ts:14-26`: the WebKit CSP filter matches the generic style-src message,
  so in WebKit it would also hide a real inline-style violation from app code. Chromium still
  catches those, so record the limitation in `docs/testing.md` "WebKit".
- **n6** `local-config.json` lives in `app_config_dir`, which on Windows is the Roaming
  `%APPDATA%`. With roaming profiles the choice follows the teacher to other PCs. That is
  probably what teachers want (same OneDrive path), but it contradicts the UI text "Deze keuze
  geldt alleen voor deze computer". Either use `app_local_data_dir` or soften the text.

## Triage (implementer, 2026-11-06)

- **M1 fixed:** `state::open_located` (setup now calls it): a folder chosen on this PC that is
  missing opens as `not_found` with nothing created; the error screen offers "Opnieuw
  proberen" and "Andere map kiezen…". `$MAATWERK_DATA_DIR` and `data\` beside the program are
  created as before. Test `a_missing_chosen_folder_is_an_error_and_is_not_created`; manual
  M-START-10.
- **M2 fixed (user decision 2026-11-06: keep the order, show and change in the app):** "Over
  Maatwerk" has a section "Gegevensmap": the folder, where it comes from (`SOURCE_TEXT`) and
  "Andere map kiezen…" when the error screen would offer it (chosen, beside the program).
  e2e `platforms.spec` "Over Maatwerk: the data folder" (2 tests); README.
- **M3 fixed:** the trap returns on `e.defaultPrevented` and leaves out `tabIndex < 0`. G45 now
  checks that a Tab on Totaal keeps focus on the grid and the next arrow moves (failed before
  the fix: focus went to a `tabindex=-1` observatie box).
- **m1, m2:** backlog (an empty-folder confirmation, a stricter data-folder check need UI text
  and a decision on what counts; `check_chosen` already refuses folders with other files).
- **m3:** backlog. T32 is about opdracht `.typ` references, which only a teacher types; photo,
  logo and watermark names are written by the app together with their references.
- **m4:** as designed and documented (docs/testing.md "Visual baselines in CI"): a missing
  folder means "write", announced by a CI warning; the next run compares again once the
  baselines are committed.
- **m5 fixed:** Linux uses `~/.cache` (`$XDG_CACHE_HOME`) only, not `$XDG_RUNTIME_DIR`; the
  test checks that a desktop session and a cron run get the same folder.
- **m6 fixed:** the README and M-START-8 paths (a `\n` had become a line break); README lists
  the macOS and Linux locations.
- **m7:** backlog. The claim is compare-and-swap on `snapshots/state.json`; two PCs with the
  same name at the same minute at worst both write a zip, which retention removes.
- **n1, n3 fixed.** **n2 fixed:** `check_chosen` refuses a non-UTF-8 folder name (Linux test)
  and `LocalConfig::save` returns an error instead of panicking. **n6 fixed:**
  `local-config.json` moved to the local app folder (`app_local_data_dir`; not released yet, so
  nothing to move). **n4, n5:** kept; the editor preview click needs `force` for WebKit's
  per-glyph SVG hit test and Chromium still checks the same jump; the WebKit CSP filter matches
  only WebKit's own `<select>` report and Chromium still fails on any inline style.
