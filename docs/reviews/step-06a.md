# Review: Step 6a (remaining commands and plugins)

Reviewer: fresh-context subagent, 2026-10-29. Scope: `git diff main..HEAD` on `step/06-tauri`
(`98a621f` … `fdb4916`, 7 commits; the emoji-font commits already on `main` are excluded). I read
every changed Rust file (`maatwerk-core/src/{opdracht_images,outputs}.rs`, the `storage/mod.rs`
and `typst_svc/project.rs` changes, `src-tauri/src/{lib,state,commands,opdrachten,render,scheme,
error}.rs`), `tauri.conf.json`, `capabilities/default.json`, the UI changes (`bridge/{api,
tauri-api,tauri-api.test,mock/mock-api}.ts`, `domain/print.ts`, `modals/{rapport,
opdrachten-genereren}.js`, `pdf-viewer.js`, `store.js`, `app.js`, `vite/csp.ts`,
`tests/csp.test.ts`, `tests/domain/print.test.ts`) and the doc changes (`parity.md`, `backlog.md`,
ADR-0002 sections 7-9, `quirks.md` T30, `THIRD_PARTY_LICENSES.md`, `STATE.md`). I compared them
with `_reference/main.js:237-395` (images), `:546-935` (render handlers, `shell:openPath`),
`:955-1025` (lifecycle), `presence.rs`, the watcher's ignore list and the sources of
`tauri-plugin-opener` 2.7.2.

What I ran (PowerShell):

- `cargo test --workspace`: all green (core 133 unit tests, `typst_opdracht` 24, `typst_rapport`
  12, app 8, CLI). `cargo clippy --workspace --all-targets -- -D warnings`: clean.
- `npm run typecheck`: clean. `npm test`: Vitest 247/247, node tests 122/122.
- `npm run lint`: **fails** (exit 1), see M2.
- `cargo deny check licenses bans sources advisories`: ok. `npm run licenses`: ok.
  `bash tools/check-spdx.sh`: clean.

Overall the step is solid. The plugins are called from Rust only and `capabilities/default.json`
still grants just `core:default`. Picked-file paths stay in Rust behind a token. Output IDs are
strictly validated (`parse_id` requires a clean `<n>-<name>.pdf`), so the URI scheme cannot be
walked out of the cache folder. The scheme sends CORS headers only for the app's own origins.
The Step 5 handover items (label fallback, `spawn_blocking`, `normaliseForTypst`) are all done.
Image behaviour matches the reference, and T30 is a real improvement. I found no blockers. Two
majors: `open_path` is much wider than any caller needs (it can launch any file in the shared
folder), and the lint gate is red.

## Blockers

None.

## Major

### M1. `open_path` launches any existing file or folder in the shared data folder

- `src-tauri/src/render.rs:256-273`: after the output-ID lookup, any `RelPath` that exists under
  the data folder is passed to `open::that_detached` (ShellExecuteW). That includes
  `fotos/x.bat`, `opdrachten/x.lnk`, `.url`, `.ps1` and `.exe` files, and folders.
- The data folder is shared through OneDrive, so a colleague's machine (or anything that syncs
  into it) can place such a file. On top of that, `save_photo` accepts any extension
  (`storage/mod.rs:54-60`, `fotos/<name>` only), so the webview alone has a write-then-execute
  primitive: `savePhoto('fotos/a.bat', …)` followed by `openPath('fotos/a.bat')`. The reference
  was worse (any absolute path). But ADR-0002 section 7 is meant to narrow this, and nothing
  needs the wide form: since 6a, `openPath` has **no UI caller** (`rapport.js` and
  `opdrachten-genereren.js` moved to `printPdf`).
- The resolution logic also lives in the command handler and has no Rust test (absolute path,
  `..`, ID versus relative path, missing file). That breaks the "handlers parse, call core, map
  errors" rule.
- Fix: move the target resolution to core (e.g. `outputs::open_target(storage, outputs, target)`)
  and allow only output IDs and `rapporten/<schooljaar>/*.pdf` (or `.pdf` files at most). Test
  the rejected cases there. Restrict `save_photo` to the image extensions the UI writes
  (png/jpg/jpeg/gif/svg/webp).

### M2. The lint gate is red

- `npm run lint` exits 1: `prettier --check .` reports `docs/STATE.md` (commit `fdb4916`, "STATE
  before the step 6a review"). Two continuation lines are indented by two spaces (lines 16 and 84
  in prettier's diff). `main` passes. Merging this would make `main` red.
- Fix: `npx prettier --write docs/STATE.md`, commit.

## Minor

### m1. Two running instances share and clear one output folder, and their IDs collide

- `src-tauri/src/lib.rs` (`app_cache_dir()/output`) and `outputs.rs:28-54`: every start runs
  `remove_dir_all` on the same folder, and every instance numbers IDs from 1. A second instance
  (the portable exe started twice, or two copies with different data folders) deletes the first
  instance's PDFs. It then writes `1-rapport_preview.pdf` over the first instance's ID. Then
  "Afdrukken" in the first window copies the **other** instance's PDF into `rapporten/` under this
  window's toets/groep name. The viewer can also show the wrong document.
- Fix: one subfolder per process (e.g. `output/<pid>-<start time>`), and at start remove only
  subfolders whose process is gone or which are older than a day. Or add a random component to
  the IDs. A single-instance plugin is the alternative.

### m2. Printed-copy names have no overall length cap

- `outputs.rs:172-185`: each of four parts may be 60 characters, so the stem can reach about 260
  characters before `rapporten/<jaar>/` and the OneDrive data path. Rust's `std` writes long paths
  (verbatim prefix), but ShellExecute, Acrobat and Explorer often fail beyond `MAX_PATH`. Then the
  copy exists but cannot be opened or found. Real values (a 60-character toets title, three long
  group names, a deep OneDrive path) get close.
- Fix: cap the whole stem (e.g. 120 characters, shortening `toets`/`groep` first). Add a test with
  four 60-character parts.

### m3. `delete_all` stops at the first locked image, with no retry

- `opdracht_images.rs:196-205`: `storage.delete` fails at once on a file that OneDrive or a
  viewer holds. The rest of the images stay, and the command rejects after the UI has already
  deleted the opdracht JSON. The reference used `fs.rmSync(…, { maxRetries: 5 })` per entry.
  Folders inside are also left alone (the reference removed them recursively), and that is not
  recorded in `parity.md`/`quirks.md`.
- Fix: retry the per-file delete with a short backoff (as `atomic` does for renames), or hand
  leftovers to the background retry. Record the folders-inside deviation.

### m4. Every image listing decodes every image in full

- `opdracht_images.rs:108-131`, `:244-259`: `list` reads each file, runs `load_from_memory` and
  `resize_exact(…, Triangle)` on the full image, on every popup open. A 12 MP phone photo is about
  48 MB RGBA and is slow to filter (much worse in debug builds). Ten of them make the 🖼️ popup lag
  for seconds. The default `image` limit (512 MiB per allocation) allows very large decodes.
- Fix: use `DynamicImage::thumbnail` (fast, integer downsampling), and a `ImageReader` with
  explicit `Limits` (e.g. max 64 MP). Optionally cache thumbnails by content hash in memory.

### m5. Opener calls block a runtime worker, and a failed open hides a saved copy

- `render.rs:272, 300, 304-308`: `open_with_os` runs on the async runtime. `open::that_detached`
  calls ShellExecuteW synchronously, which can take seconds when the file association is slow (the
  first Acrobat start). If opening fails after `print_copy` succeeded, `print_pdf` returns an
  error. The UI then toasts "Afdrukken mislukt", although the copy is in `rapporten/`.
- Fix: open inside `spawn_blocking`. When the copy exists but opening fails, return the path
  with a separate flag or error code so the toast says the copy was saved.

## Nits

- **n1.** `docs/reference/quirks.md:700-702`: inserting T30 moved the last paragraph of T29 ("The
  `images/<id>` prefix is matched case-sensitively …") to the end of T30. Move it back above
  `### T30`.
- **n2.** `src-tauri/src/lib.rs` (`tauri_plugin_opener::init()`): by default the plugin injects an
  init script that catches clicks on `<a target="_blank">` links and invokes
  `plugin:opener|open_url`. The capabilities deny that, so it fails silently. Use
  `tauri_plugin_opener::Builder::new().open_js_links_on_click(false).build()` so that "Rust
  only" holds literally.
- **n3.** `render.rs:113-116`: `opdracht_project` maps every error to `Ongeldige bestandsnaam`,
  including an unavailable data folder (`c.storage()?` sits inside the mapped expression). Map
  only the name check.
- **n4.** `storage/mod.rs:46-52`: `check_opdracht_typ_path` allows `opdrachten/lib.typ`, which is
  app-managed and would reach every colleague until the next start re-seeds it. Exclude `lib.typ`
  (and `_preview_*`).
- **n5.** `lib.rs` run loop: `WindowEvent::Destroyed` of **any** window marks the teacher offline.
  Filter on label `main` before a splash window is added. The presence write runs on the event-loop
  thread (as in the reference; acceptable).
- **n6.** `scheme.rs:242-246`: `http://localhost:1420` is an allowed CORS origin in release
  builds too. Gate it with `cfg(debug_assertions)`.
- **n7.** `opdrachten.rs:137-143, 165-169`: a picked file whose name is not valid UTF-16 gives
  name `""` and ext `""`, so import says "Bestandstype . wordt niet ondersteund.". Use
  `to_string_lossy` for the extension.

## Checked and found fine

- **Image parity:** `clean_image_name` matches the reference regexes (only U+0300-U+036F
  stripped, runs to `-`, trim, 60 chars). The order of checks (name, type, then the id) and the
  Dutch texts (`Geef de afbeelding een naam.`, `Bestandstype .x wordt niet ondersteund.`,
  `Ongeldige opdracht.`, `Kies de afbeelding opnieuw.`) match. So do the `{ok, file, name}` /
  `{ok:false, exists, name}` / `{ok:false, error}` shapes through `imageResult`, and the token
  being kept until a successful import. Thumbnails are 48 px high PNG data URLs, `null` for SVG.
  `copy` from a missing folder is ok.
- **Data safety:** the background folder retry only removes an **empty** folder (the reference's
  `rmSync(recursive)` retry could delete an image a colleague added in the meantime). T30
  case-insensitive clash detection. `print_copy` uses `Expect::Missing` under the commit lock, with
  ` (n)` suffixes. `rapporten/`, `fotos/` and `opdrachten/images/` are ignored by the watcher.
  Image writes are atomic and noted.
- **Security:** output IDs (`parse_id` with an exact `output_name` round trip, digits-only
  sequence). `outputName` and `typFile` are checked before any work. `schooljaar` goes through
  `is_year_name`. Name parts are cleaned of separators, reserved characters and controls, and the
  timestamp prefix rules out reserved device names. Scheme: GET only, `nosniff`, `no-store`, CORS
  only for the app origins. CSP `connect-src` covers both spellings of the scheme and
  `isEvalSupported: false` is set. No plugin permissions are granted to the webview. Log lines
  contain no student data, and the log goes to the local app dir.
- **Blocking work:** dialog and clipboard in `spawn_blocking`. Every file command and render
  command goes through `blocking`. The scheme reads on a blocking thread.
- **Step 5 handover:** `label ?? typFile`, `includeAnswers` default true, `duplex` default false,
  `outputName` default `opdrachten.pdf`, the empty-batch text, `normaliseForTypst` on both rapport
  arguments, and `assignment:progress` emitted per job.
- **Lifecycle and config:** offline on window destroy and on exit (`Presence::close` is
  idempotent). `set_watch_year` is wired at `initSubject` and on the three year selectors. Window
  title, size and minimum size match, with no menu. The output folder is cleared at start. Daily
  log files, 14 kept.
- **Docs:** parity rows 12-20 and 28-32, plus the new `printPdf`/`setWatchYear`/`pdfUrl` rows,
  match the code. Backlog n3, n8 and the 3a m8 CSP items are struck correctly. The licences table
  and `cargo deny` agree.

## Verdict

No blockers. Fix **M1** (narrow `open_path`, move its resolution into core with tests, restrict
`save_photo` extensions) and **M2** (prettier on `STATE.md`) before merging. m1-m5 can be fixed now
or go to the backlog. m1 is the one I would not defer, because it can put the wrong PDF in
`rapporten/` under a misleading name.

## Triage (implementer, 2026-10-29)

| Id  | Decision                                                                                                                                        | Where                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| M1  | Fixed: `outputs::openable_path` (output IDs and existing `rapporten/<jaar>/*.pdf` only, tested); `check_photo_path` requires an image extension | `outputs.rs`, `storage/mod.rs`, `render.rs` |
| M2  | Fixed: docs formatted with prettier                                                                                                             | `docs/STATE.md`                             |
| m1  | Fixed: per-process output folder `output/<pid>/`; other run folders removed after 24 h                                                          | `outputs.rs`                                |
| m2  | Fixed: printed name capped at 120 characters before ` (n).pdf`                                                                                  | `outputs.rs`                                |
| m3  | Fixed: each image delete retried 5 times; folder handling recorded under T30                                                                    | `opdracht_images.rs`, `quirks.md`           |
| m4  | Backlog (thumbnail cache, decode limits)                                                                                                        | `docs/backlog.md`                           |
| m5  | Fixed: opening runs on a blocking thread; a failed open after printing names the saved copy                                                     | `render.rs`                                 |
| n1  | Fixed                                                                                                                                           | `quirks.md`                                 |
| n2  | Fixed: `open_js_links_on_click(false)`                                                                                                          | `lib.rs`                                    |
| n3  | Fixed: only `invalid_path` becomes "Ongeldige bestandsnaam"                                                                                     | `render.rs`                                 |
| n4  | Fixed: `opdrachten/lib.typ` refused                                                                                                             | `storage/mod.rs`                            |
| n5  | Fixed: only the `main` window                                                                                                                   | `lib.rs`                                    |
| n6  | Fixed: dev origin allowed in debug builds only                                                                                                  | `scheme.rs`                                 |
| n7  | Backlog                                                                                                                                         | `docs/backlog.md`                           |
