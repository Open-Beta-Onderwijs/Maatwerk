# Review: step 15 (Shell)

Scope: `main...step/15-shell`, commits `f3e72f3`..`22023dc` (8 commits, 59 files, +2675/-908; the
last commit is only the 0.6.0 version bump). Reviewer: fresh-context subagent, checklist PLAN.md
Appendix C. I checked the code, not the commit messages or STATE. `e2e/shell.spec.ts` +
`e2e/quirks.spec.ts`: 31 passed on a fresh `dist-mock`. I confirmed four findings (M1, M2, m4)
with throw-away Playwright probes. I deleted the probes afterwards, and the tree is clean apart
from this file.

## Summary

| Severity | Count |
| -------- | ----- |
| Blocker  | 0     |
| Major    | 2     |
| Minor    | 8     |
| Nit      | 8     |

Checked and found correct:

- **Layering:** `maatwerk-core` has no tauri dependency. In `src-tauri`, `error.rs` only maps
  `Error::ReadOnly` to `read_only` with `details.found`, and `state.rs` only reports
  `appVersion`/`readOnly`. Neither holds business logic.
- **Write guard in core:** `Storage::commit_bytes` (used by `write_json`, `write_text`,
  `write_bytes` and `save_photo`) and `Storage::delete` call `check_writable()` before any temp
  file is written. The following write paths all go through these:
  - PIN writes (`auth`)
  - opdracht images (`opdracht_images::store`/`delete`)
  - `.typ` saves and project files (`typst_svc::project`)
  - the snapshot claim. `run_if_due` fails at the claim, so no zip is written.
  - `seed_initial_data` (it logs a warning)

  `presence::write` returns early when read-only.

- **Version parsing:** numeric compare (`0.10.0 > 0.9.0`), missing parts are 0, and a
  pre-release suffix is ignored. Garbage or an overflowing number counts as "newer", which fails
  safe. Rust and TS give the same results on the test vectors.
- **0.3.x/0.5.x keep `preferences`:** I checked `v0.3.2`. The Gebruikers form builds
  `{ ...(user ?? {}), ... }`, toggle-user mutates the loaded record, and `saveEntity` spreads the
  entity. `domain/v2` `encode`/`decode` leave `gebruikers/` alone. In Rust, PIN writes edit the
  JSON object, and `pin_writes_keep_preferences_and_unknown_fields` covers this.
- **`savePreferences`:** it goes through `update()`, which is a hash CAS with retry and is
  serialised per file. A fast run of look changes therefore lands in click order, and the last
  write wins with the full look. An admin's on-disk change is kept (e2e "admin change ... is
  kept").
- **Untrusted values:**
  - `preferences.theme`/`accent` are validated (`isTheme`/`isAccent`) before they reach
    `data-theme`/`data-accent`.
  - `minAppVersion` reaches the banner only through `textContent`.
  - Avatar user fields are escaped.
  - The ring colour goes through CSSOM (`data-badge-color`, `setProperty`).
  - Photo paths go through `RelPath` (rejects `..`, absolute paths and symlink escapes) before
    `read_photo_data_url`.
- **CSP:** no `style=""` in `index.html`/`editor.html`. Swatch fills and the editor avatar ring
  are set through CSSOM.
- **SPDX:** present on all new files, including the four SVGs; `tools/check-spdx.sh` is clean.
- **Year handling:** a saved active year with no year folder is put at the top of the year
  list, as `config.activeYear` was before. `CustomSelect.setValue` does not fire `onChange`, so
  `chooseYear` cannot loop, and login writes nothing.
- **U11:** all six Alles/Niets buttons now use `onclick`. On `main`, three logins gave three
  `writeLocalSession` writes per schoolsoort click, so the e2e would have failed there. I worked
  this out from the code and did not run it.
- **U13/U16:** the "superseded" notes in `quirks.md` match the code (`domain/v2.ts` turns ids
  into strings; there is no client-side migrate).
- **Tab bar:** the admin's seven tabs, `aria-current`, the 56 px height and the light/dark
  wordmark all match spec 3.5.

## Major

### M1. A running app that becomes read-only gives unclear messages: raw `read_only` text and no banner

- **Where:**
  - `ui/src/services/read-only.ts:25` (`new Error(READ_ONLY_CODE)`: the message is `read_only`).
  - `ui/src/screens/scores.js:120-128` (the non-conflict branch prints `err?.message`).
  - `ui/src/app.js:765` (the banner is only shown from `init()`).
  - `docs/cutover-runbook.md` section 8 ("a running older app becomes read-only as soon as the
    field arrives").
- **Evidence:** probe: log in, an external write puts `minAppVersion: "99.0.0"` in
  `school.json`, then type a score.
  - The persistent toast reads: `Score niet opgeslagen (Sem van den Dekker): read_only. Controleer
de gedeelde map en voer de score opnieuw in.`
  - `#read-only-banner` count: 0.

  Score entry is the most common write, and the migration day (step 18) is exactly when apps
  are running. Other catch sites also print `e.message` (`opdrachten.js:148`,
  `opdrachten-genereren.js:319`, `rapport.js:80`, `gebruikers.js:117,189`) and would show
  `read_only` in the same way. The step goal is "a clear message". The data is safe (the write is
  refused).

- **Fix:**
  - Give `readOnlyError()` the message `READ_ONLY_SAVE_TEXT`. Every `e.message` site then reads
    well.
  - In `saveCell`, treat `isReadOnlyError(err)` like a conflict (rethrow to the global handler),
    or use the read-only text.
  - On the first read-only refusal (Store `update`/`saveVersioned`, the two `fsFailure` paths),
    call `showReadOnlyBanner(found, appVersion)`. `dataFolderStatus()` gives `appVersion`, or keep
    it from `init`.
  - Add an e2e test: raise the minimum mid-session, type a score, then expect the read-only text
    and the banner.

### M2. Read-only mode is not a usable "look at everything" mode

- **Where:**
  - `ui/src/app.js:429-436` (`chooseYear` → `Store.savePreferences`).
  - `ui/src/app.js:567-570` (`onLook` → `savePreferences`).
  - `ui/src/store.js:289-300`.
  - `crates/maatwerk-core/src/typst_svc/project.rs:231-235` (the silent update in
    `project_file_status` returns `Err(ReadOnly)`).
  - `src-tauri/src/editor.rs:254`, `:550`.
  - `ui/src/screens/pin.ts:331-343`.
- **Evidence:**
  - **Browsing raises errors.** Probe: read-only, then two accent clicks give a persistent "Niet
    opgeslagen: deze versie van Maatwerk is te oud ..." toast. A year change on Leerlingen,
    Groepen or Toetsen does the same, because `chooseYear` saves `activeYear`. Picking a year
    is a pure read action. It also leaves the kept screens stale, because `Store.generation()`
    is only bumped by a successful write.
  - **The editor fails to open.** `editor_open` and `project_files_status` run
    `check_project_files`. For an opdracht whose `main.typ`/`lib.typ` is an older bundled
    release, the silent update is attempted, and `Err(e) => return Err(e)` turns the refused
    write into a failure. A read-only app then cannot open or preview that opdracht.
  - **A teacher without a PIN cannot log in.** Probe: the "Pincode instellen" dialog opens, and
    submitting it can only fail with the read-only text. That teacher cannot read anything.
    This may be acceptable, but it is not documented.
- **Fix:**
  - Skip `savePreferences` while read-only (the look and year still apply in memory), or
    swallow `read_only` there without a toast. Bump the Store generation (or `changed()`) when
    `_activeUser`'s year changes, so kept screens re-render.
  - In `project_file_status`, map `Err(Error::ReadOnly { .. })` to
    `status(ProjectFileState::Outdated, ...)`, as for a lost race. Add a core test with
    `set_app_version("0.0.1")`.
  - Document the no-PIN case in runbook section 8, or allow a read-only session without a PIN.
    The second option is a security decision, so it needs the user.
  - Add an e2e test: in read-only, change the year and the accent, then expect no toast.

## Minor

### m1. Some writes into the data folder bypass the guard

- **Where:**
  - `crates/maatwerk-core/src/storage/mod.rs:517` (`remove_empty_dir`), `:527` (`ensure_dir`),
    `:535` (`ensure_year`).
  - `src-tauri/src/state.rs:137` (`opdracht_images::remove_empty_dirs` at every start).
- **Evidence:** a read-only app still removes empty `opdrachten/*` folders at start, and creates
  folders through the `ensure_dir`/`ensure_year` commands. These are harmless today. But the
  runbook says the app "refuses every save", and a v3 rename (`fotos/` → `afbeeldingen/`) could
  meet an old app that recreates or prunes folders. `print_copy` (`rapporten/` next to the
  data folder) is outside the data folder, which is probably fine.
- **Fix:** add `check_writable()` to `remove_empty_dir`, `ensure_dir` and `ensure_year` (or
  skip `remove_empty_dirs` when `read_only()` is `Some`), with a test.

### m2. The guard fails open while `school.json` cannot be read

- **Where:**
  - `crates/maatwerk-core/src/storage/mod.rs:183-188`: missing, I/O error and corrupt JSON all
    give `None`.
  - `ui/src/store.js:249-261`: `updateSchool` falls back to `{}` when the file is missing.
- **Evidence:** while OneDrive replaces `school.json` (a placeholder, a lock, a half-synced
  file), an old app writes normally. If the file is missing, `updateSchool` can create a new
  `school.json` without the minimum. The window is small, but this is exactly the moment the
  guard exists for. The runbook also says the minimum is set "in the same write as the
  migration", but a migration writes many files, and no single write covers them all.
- **Fix:**
  - Make the state sticky. Once `read_only()` has returned `Some`, remember it (for example a
    `Mutex<Option<String>>` in `Storage`) and keep refusing until restart. An unreadable file
    then keeps the last known limit.
  - In the runbook (and for step 18), require that the migration raises `minAppVersion`
    **first**, before any migrated file is written.

### m3. The runbook and doc comments do not match the behaviour

- **Where:**
  - `docs/cutover-runbook.md` section 8.
  - `crates/maatwerk-core/src/app_version.rs:47-49`.
  - `storage/mod.rs:208-238` (`check_schema`).
- **Evidence:**
  - A step-18 v3 folder will very likely have `schema_version: 3`. A 0.6 app then stops at
    `UnsupportedSchema` on start (the startup error screen), so it does not "still open and
    show everything". Read-only mode only applies to an app that was already running, or to
    additive changes without a schema bump.
  - The runbook says a number "also makes the app read-only". In fact `json!(3)` is compared as
    `3.0.0`, and `0.5` or `0` set **no** limit. The `"3"` test passes only because 3 > 0.6.
- **Fix:**
  - Correct section 8. Note for step 18 whether `check_schema` should open a newer schema
    read-only when `minAppVersion` is present. That is a user decision.
  - Either refuse non-string values outright (`other => return Some(other.to_string())`) or fix
    the wording. Add a test for `json!(0.5)`.

### m4. User menu: Tab out does not close it, and a dialog over it loses Escape

- **Where:** `ui/src/components/user-menu.ts:131-140`, `:366-370` (z-index 900 in
  `styles/controls.css`).
- **Evidence:**
  - **Tab out:** probe: focus `#acc-logout` and press Tab. The menu is still open, and focus is
    on `body`. The `queueMicrotask` check runs after the listener but **before** the browser
    moves focus, so `activeElement` is still inside the menu. The menu is the last child of
    `body`, so Tab leaves the document.
  - **Escape under a dialog:** probe: open the menu, then a dialog opens (About, triggered
    programmatically; in real use, a reload notice or `alertDialog` from sync). The dialog is
    drawn above the menu (1000+ > 900). Escape then closes the hidden menu instead of the
    dialog, because the capture listener stops propagation.
- **Fix:**
  - Close on `focusout` when `relatedTarget` is outside the menu and the anchor, or use
    `setTimeout(0)` in place of the microtask. Insert the menu right after the anchor (or
    `#topbar`) so the Tab order follows.
  - Close the menu when a dialog opens (`openDialog` → `closeUserMenu()`), or only handle
    Escape when no `.dlg` is open.
  - Add e2e tests for both.

### m5. A teacher's look or year change makes an open admin edit of that user conflict

- **Where:** `ui/src/store.js:286-300` (the `stampMeta` rev bump) against `upsertUser`/`saveEntity`
  (rev check, C16).
- **Evidence:** the admin opens the Gebruikers form for teacher X. X clicks an accent swatch, or
  changes the year on any screen. The admin's save then fails with "Niet opgeslagen: dit is
  intussen door X gewijzigd". The comment "nothing conflicts" holds only for the teacher's side.
  Bumping the rev is right: without it, the admin's stale record would drop the new
  `preferences`. But the result is a confusing conflict for a cosmetic change.
- **Fix:** in `upsertUser`, take `preferences` from `onDisk` (the form never edits them) and
  skip the rev check when the on-disk file differs from the base only in `preferences` and
  `_meta`. If that is too much for now, correct the comment and add a backlog entry.

### m6. Test gaps

- **Where:** `ui/e2e/shell.spec.ts`, `ui/e2e/quirks.spec.ts:377-401`,
  `ui/src/bridge/mock/mock-api.ts:451`, `:538`.
- **Evidence:**
  - Nothing tests a **different** user logging in after logout on the same PC (base look, then
    their own look, year selects and filters reset; checklist item). The persist test logs the
    same teacher back in. `admin` could serve as the second user.
  - The U11 test waits with `waitForTimeout(300)`. A slower extra write could land after the
    check and pass falsely. The admin's `#pop-vak-alles` is not covered.
  - Nothing tests the read-only score, year or editor paths (M1, M2).
  - The mock's `writeTextFile` and `saveOpdrachtImage` do not apply the read-only rule, so e2e
    cannot cover `.typ` and image writes.
- **Fix:**
  - Add a second-user e2e test.
  - In the U11 test, poll the write count for stability (for example `expect.poll` over 500 ms
    that stays at `before + 1`). The vak "Alles" handler does not persist, so assert on its
    re-render count, or note that it is not covered.
  - Guard `writeTextFile` and `saveOpdrachtImage` in the mock as the backend does.

### m7. R-05: the deferral is acceptable, but the numbers in STATE and backlog are wrong

- **Where:** `docs/STATE.md:65-67`, `docs/backlog.md` "From Step 15", `ui/src/app.js` (772 lines),
  `ui/src/shell/filter-bar.js` (527 lines, new JS).
- **Evidence:**
  - STATE says "app.js 1262 -> 709 lines". In fact it went from 1209 on `main` to 772.
  - Both files are still over the ~500-line target, and a new 527-line JS file was added.
  - Moving the filter bar verbatim is a reasonable low-risk step while `Store` is untyped
    (step 19). I accept the deferral.
  - `filter-bar.js` imports `renderScreen` from `app.js`, which imports it back. The cycle is
    safe today, because `renderScreen` is only used inside functions.
- **Fix:** correct the line counts in STATE and the backlog. Name the backlog item's target
  step explicitly: either step 19 or step 22, not "then or with".

### m8. `forgetAvatarPhotos` is never called; a replaced photo shows late

- **Where:** `ui/src/components/avatar.ts:142-145`, `ui/src/screens/gebruikers.js:313-315`.
- **Evidence:** the admin replaces a photo under the same name (`fotos/<id>.<ext>`). The cached
  data URL keeps showing in the list, the top bar and presence for up to 30 s. The function's
  own comment says to call it "after this app saved a new photo".
- **Fix:** call `forgetAvatarPhotos()` after `savePhoto` succeeds, or drop the cache entry for
  that path.

## Nits

- **n1.** `ui/src/screens/pin.ts:88` and `:414-417`: two orphaned JSDoc blocks. "Runs `submit`
  ..." now sits above `errorMessage`, and "The account modal ..." above `changePinFlow`. The
  file header (`:5`) still mentions the account modal.
- **n2.** `ui/src/domain/preferences.ts:35`: the comment says "both parts must be valid", but
  the code accepts either part (and the tests expect that).
- **n3.** `ui/src/style.css:3118`: `.account-actions` is dead CSS (the account modal is gone).
- **n4.** The version compare exists twice (Rust `app_version`, TS `services/read-only.ts`; TS
  is used only by the mock). They differ slightly: Rust strips any number of leading `v`s, TS
  strips one. Share one table of test vectors, or note that the TS copy is mock-only.
- **n5.** Three HTML-escape helpers: `app.js` `escHtml`, `avatar.ts` `escHtml`, and
  `user-menu.ts` `esc` (which does not escape `'`). Move them to one `utils/html.ts` that the
  editor iframe can import as well.
- **n6.** `presence::write` reads `school.json` twice per heartbeat (`read_only()`, then
  `check_writable()`). This is negligible but easy to avoid with an internal
  `write_json_unchecked` or a read-only flag passed in.
- **n7.** `THIRD_PARTY_LICENSES.md` says the tab icons are "drawn in the style of Lucide", and
  their licence AGPL. PLAN-2 step 15 and spec 3.5 say "Lucide paths". If the `user`, `users`,
  `eye` or `puzzle` paths come from Lucide, list them as ISC and carry Lucide's copyright notice
  in `THIRD_PARTY_NOTICES.txt`. Confirm where the paths come from.
- **n8.** `user-menu.ts:146-155`: clicking the swatch that is already selected writes the user
  file again. If a logout happens during the write, `stampMeta` can record the **next** user as
  `updatedBy` (`_activeUser` is read inside the mutator). Skip unchanged looks, and capture the
  user id in `savePreferences`.

## Triage (implementer, 2026-11-05)

- **M1 fixed:** `readOnlyError()` carries the Dutch text; the score grid shows the read-only text
  for a refused cell; the first refused write (Store `update`/`saveVersioned`, the score grid,
  the global rejection handler) calls `noteReadOnly()`, and app.js then shows the banner with the
  versions from `dataFolderStatus()`. e2e "a refused score save shows the read-only text and the
  banner".
- **M2 fixed:** `Store.savePreferences` applies in memory, bumps the Store generation and skips
  the write while read-only (a refusal is swallowed: the banner explains). A read-only app
  reports an old `main.typ`/`lib.typ` as `Outdated` instead of failing (core test
  `a_read_only_app_reports_an_old_copy_as_outdated_and_leaves_it`). The no-PIN case is documented
  in runbook section 8 (a read-only session without a PIN would be a security decision for the
  user) and tested (the PIN dialog shows the read-only text). e2e "a year or accent change while
  read-only applies on screen without errors".
- **m1 partly:** `remove_empty_dir` is guarded; creating folders (`ensure_dir`, `ensure_year`)
  stays allowed (empty folders change no data).
- **m2:** runbook section 8 says the migration writes `school.json` first; backlog for step 18.
- **m3 fixed:** a non-string `minAppVersion` always refuses (Rust and TS, test with `0.5`);
  runbook corrected (schema bump vs. read-only, numbers).
- **m4 fixed:** focusout closes the menu (not towards the avatar, whose click toggles it); Escape
  goes to a dialog that opened over the menu.
- **m5:** backlog. **m6:** mock refuses `writeTextFile`/`saveOpdrachtImage` too; rest backlog.
- **m7 fixed:** numbers in STATE and backlog (app.js 1209 -> 789 lines).
- **m8 fixed:** the Gebruikers save calls `forgetAvatarPhotos()`.
- **n1, n2, n3, n8 fixed** (comments, dead CSS, unchanged look not saved, user id captured).
  **n4-n6:** backlog. **n7:** the tab icons are the design boards' own paths (`Main.dc.html`,
  `Beheer.dc.html`), not copies of Lucide's files (e.g. Lucide `eye` differs); the note stays.
