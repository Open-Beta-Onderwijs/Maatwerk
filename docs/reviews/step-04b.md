# Review: Step 4b (watcher, presence, Tauri commands, typed errors, bindings)

Reviewer: fresh-context subagent, 2026-10-27. Scope: `git diff step-04a..HEAD` on
`step/04-core-storage` (`9894f77` watcher + presence, `6cb4271` commands/errors/bindings/TauriApi,
plus STATE commits). I read every new or changed Rust and TS file in the diff, ADR-0005 and the
parity/testing changes. I compared them with `_reference/sync.js` (`createWatcher`),
`_reference/main.js` (fs handlers 54-228, presence/session 398-455, lifecycle 1005-1025),
`docs/reference/ipc-api.md` (handlers 1-12, 21-25, events), storage spec rows S28-S40 and ADR-0002
sections 2-4, 7 and 8. I also checked how the legacy UI uses these calls (`ui/src/store.js`
`update`/`applyExternalChange`, `ui/src/sync.js`, `ui/src/presence.js`, `ui/src/editor-init.js`
save chain, `screens/scores.js` sync handlers). Finally I read the Windows backend of the `notify`
crate (`notify-8.2.1/src/windows.rs`) to check the S39 error path.

What I ran (PowerShell):

- `cargo test --workspace`: everything passes (core 85 unit tests including the watcher, app 4,
  plus the integration tests). `cargo clippy --workspace --all-targets -- -D warnings` is clean.
- `cargo deny check licenses bans sources advisories`: ok. `bash tools/check-spdx.sh`: clean.
- `npm test`: Vitest 236/236 and node 121/121 pass. `npm run typecheck` and `npm run lint` are
  clean.
- `cargo tree -i serde_json -e features`: there is one `serde_json` in the graph, with
  `float_roundtrip` and `preserve_order` unified, so IPC arguments are parsed exactly and keep key
  order (review 4a M1 also holds for the Tauri layer).

Overall, the step is in good shape. The watcher engine follows `sync.js` closely, and testing it
on a virtual clock is a good design. Every path-taking command goes through `RelPath`. The command
layer is thin, and the compat layer reproduces the reference result shapes with contract tests.
I found no data-loss path. The CAS + commit-lock design from 4a protects every JSON write, and
the UI's `update()`/editor save chain serialises its own writes, so the concurrency of Tauri
commands cannot reorder them into a lost update. One major issue: on Windows, the target
platform, `notify` never reports its errors, so the S39 restart can never trigger. The minors
are mostly consequences of the move from single-threaded Node to threads: a rare own-write echo,
watcher I/O under the lock that writers wait on, and the reordering of fire-and-forget presence
calls.

## Blockers

None.

## Major

### M1. S39 "restart the OS watch after an error" cannot happen on Windows

- **Where:** `crates/maatwerk-core/src/watcher/mod.rs:142-147` (the only restart trigger is
  `Msg::WatchError`), `:232-246` (`start_notify` maps `Err` results to `WatchError`);
  `notify-8.2.1/src/windows.rs:339-367`; `src-tauri/Cargo.toml:30` (`tracing-subscriber` without
  the `tracing-log` feature).
- **Evidence:** the Windows backend of `notify` 8.2.1 never calls the event handler with an `Err`
  once watching has started. In `handle_event`:
  - an unknown `ReadDirectoryChangesW` error code runs `log::error!(...)`, then
    `request.unwatch()`, then `return`;
  - `ERROR_ACCESS_DENIED` on a folder that no longer exists (data folder deleted, moved or
    re-created by OneDrive) does a silent `unwatch()`;
  - a failed re-arm in `start_read` (`ret == 0`) is also silent;
  - a buffer overflow (a burst of more than 16 KB of notifications, e.g. OneDrive syncing a year
    folder) arrives as a zero-filled buffer, which ends up in the `_ => ()` arm, so those events
    are dropped without a signal.

  So on the one platform this app ships for, `Msg::WatchError` is never sent, `restart_at` is
  never set, and the restart code is dead. After a silent unwatch the app keeps running on the
  20 s poll alone. That poll only covers non-year files and the active year (S32), so changes to
  other years are never seen. The reference does get an `'error'` event from Node's `fs.watch`
  and restarts after 30 s (`sync.js:229-234`). `notify`'s `log::error!` line is also lost: the
  app installs a `tracing` subscriber without a `log` bridge, so nobody would ever know.
  `s39_after_a_notification_error_the_os_watch_is_restarted` passes only because it injects a
  fake `StartOsWatch` that sends `WatchError` itself.

- **Fix:** do not rely on `notify` reporting errors. Two options:
  - restart the OS watch periodically (for example every 5 minutes, or on every poll when no OS
    event arrived since the last poll);
  - better: restart it when the poll finds an in-scope change that no OS event had scheduled.
    That is direct evidence that the watch is dead or overflowed.

  Also re-check `root.exists()` on each poll and log when the watch is restarted. Enable
  `tracing-subscriber`'s `tracing-log` feature (or `tracing_log::LogTracer::init()`) so `notify`'s
  `log` records reach the log. Record in `quirks.md`/storage spec that the Windows backend hides
  errors and overflows. Add an engine-level or driver test for the chosen restart trigger.

## Minor

### m1. Race: an own write can still be reported as external (S30 "never")

- **Where:** `crates/maatwerk-core/src/storage/mod.rs:287-292` (rename, then `note_write`);
  `crates/maatwerk-core/src/watcher/engine.rs:184-245` (`check` reads the file under the engine
  lock).
- **Evidence:** a debounced `check` for file X can run on the watcher thread between the commit
  thread's `tmp.commit()` and its `observer.note_write()`. The check then reads the new bytes,
  finds a hash that differs from the previous `known` hash, and emits `changed` with our own
  content. `note_write` runs after that, too late. In the reference this cannot happen, because
  `writeFileAtomic` and `noteWrite` run in one synchronous turn of the single-threaded main
  process (`main.js:98-99`). The window is small, but score entry produces exactly the pattern
  that hits it: one student's file written every ~0.5 s while each write's OS event re-arms a
  500 ms check. The effect is a spurious `data:changed`, so the UI re-reads, refreshes rows and
  possibly shows reload notices. There is no lost data. No test covers this interleaving.
- **Fix:** register the write before the rename. For example, the observer gets
  `note_pending(rel, hash)` before `commit()` (under the commit lock), and the engine treats a
  read whose hash equals a pending or known own hash as "same". `note_write` then only refreshes
  the stat. Add a deterministic engine test that interleaves rename, check and note.

### m2. Watcher file I/O holds the engine mutex, which every commit waits on

- **Where:** `watcher/mod.rs:115` (`snapshot` of the whole tree under the lock), `:163` (`poll`),
  `:166` (`advance` → `check` → `fs::read`); `storage/mod.rs:289-292` (`note_write` is called
  while the commit lock is held).
- **Evidence:** there is no deadlock: the watcher thread never takes the commit lock, and
  `on_changes` is called outside the engine lock (`mod.rs:166-169`). The locks do nest, though:
  commit lock, then engine mutex. While the watcher walks and stats the tree (the startup
  snapshot covers _all_ year folders, i.e. the 5000-file case) or reads a changed file, every
  write in this process waits behind it while holding the commit lock. On OneDrive with Files
  On-Demand, reading a colleague's freshly synced placeholder downloads it, which can take
  seconds. A second process on the same PC would get `locked` after 10 s (`commit.rs:22`). The
  reference blocked its whole main process here too, so this matches the reference, but the port
  can easily do better. In particular, ADR-0002 §3 promises that the commit lock covers only the
  check and the rename.
- **Fix:** do the I/O without the lock. Walk/stat/read first, then take the lock only to compare
  and update `known`/`timers`. Combined with m1's pending hash, a `note_write` that lands in
  between is handled correctly.

### m3. Tauri runs commands concurrently, so un-awaited presence calls can reorder

- **Where:** `ui/src/presence.js:62-81` (`start()` calls `stop()` → `updatePresence(null)`, then
  `write()` → `updatePresence(me, …)`, neither awaited); `ui/src/bridge/tauri-api.ts:120-123`;
  `src-tauri/src/commands.rs:169-179`; `src-tauri/src/lib.rs:124-131`.
- **Evidence:** Electron's `ipcMain.handle` ran these one after another in arrival order. Here,
  each `async` command becomes its own `spawn_blocking` task, and `Presence`'s mutex serialises
  them in whatever order the threads reach it. On a user switch, if `update(new)` runs before
  `update(null)`, then `null` marks the **new** user offline: `last` = new ≠ `None`. A heartbeat
  that is in flight while the user logs out can land after the logout write. On quit,
  `RunEvent::Exit` runs `mark_offline`, but a heartbeat already on a blocking thread can still
  run `update()` after that, find `last == None` and write `online: true`. Colleagues then see a
  "ghost" until their 60 s timeout. This only affects presence (store writes are serialised in JS
  and CAS-checked), so it is minor.
- **Fix:** chain `updatePresence` calls in `TauriApi` (a promise queue, as the store does per
  file). In core, give `Presence` a `closed` flag that `mark_offline` on quit sets and `update`
  respects. Add a contract test that issues `stop()`+`start()` without awaiting.

### m4. Own writes outside the watched set are re-read by every poll and can be reported

- **Where:** `watcher/engine.rs:121-130` (`note_write`/`note_delete` accept any path),
  `:298-306` (the poll's "gone" pass).
- **Evidence:** `write_json` notes every path, including ignored ones. The RTTI template files
  `templates/RTTI explanations and advices/*.json` (`saveVersioned`) are an example. The poll's
  `in_scope` only filters year folders, and `walk` skips `templates/`, so each such path is
  "gone" on every poll. It gets a check every 20 s that reads the file again, for the rest of the
  session. If a colleague changes or deletes one of those files, it **is** reported (`changed` /
  `deleted`), despite S31. The reference does exactly the same (`sync.js:217-219`, `:256-261`),
  so this is a parity quirk, but it is not recorded in `quirks.md` or the spec.
- **Fix:** ignore `!is_relevant(rel)` in `note_write`/`note_delete` (or filter the gone list by
  `is_relevant`). Record the quirk and the fix. Add a test: own write to `templates/x.json`, then
  an external change, then no report and no repeated checks.

### m5. An unusable data folder shows as an empty app, without a message or retry

- **Where:** `src-tauri/src/state.rs:17-19`, `:36-54`; `ui/src/bridge/tauri-api.ts:83`, `:97`,
  `:129` (`orElse` → `null`/`[]`).
- **Evidence:** when `Storage::open` fails, every storage command returns that error. Causes
  include an unsupported `schema_version` (C1), the lock folder not being creatable, or the data
  folder being temporarily unavailable. The compat layer then maps `readJson`, `listYears` and
  `readPhotoAsDataUrl` to `null`/`[]`, as the reference shapes require. So the teacher sees an app
  with no users and no years, and nothing explains why. The comment "so the UI can show it" is
  not true yet: no UI code looks at `unsupported_schema`. The failure is also permanent until
  restart, even when it was transient. No data is at risk, because writes fail too.
- **Fix:** add a startup check (for example a `storage_status` command, or let `getDataDir` /
  `listYears` reject), and have `main.ts` show a blocking Dutch dialog for `unsupported_schema` /
  `io`. Retry `Storage::open` on that check if the failure was I/O. If this is deferred to
  Step 6, record it in STATE as open.

### m6. The driver tests depend on timing (startup race with the watcher thread)

- **Where:** `watcher/tests.rs:514` (`sleep(100ms)` "let the snapshot run first"), `:535`
  (`sleep(200ms)`).
- **Evidence:** `Watcher::start` returns before the thread has taken its snapshot and started the
  OS watch. Two failure modes:
  - in `s39_polling_continues_without_os_notifications`, if `a.json` is written before the
    snapshot runs, it lands in `known` and is never reported;
  - in `driver_reports_external_writes_but_not_own_writes`, if `extern.json` lands after the
    snapshot but before `notify` is armed, the next poll is 20 s away, while the receive window
    is 3 s.

  Both pass on an idle machine and are flaky under CI load. The same gap exists in the product:
  external changes made in that window are folded into the snapshot. That is harmless at
  startup, but it is the reason the tests need sleeps.

- **Fix:** make `start` (or a `ready()` method) wait until the snapshot is done and the OS watch
  is started, for example with a one-shot channel. Then remove the sleeps.

## Nits

- **n1.** ADR-0002 §2 says `data:changed` carries an "own-write flag", but §4 and the code
  suppress own writes instead. Fix the §2 wording. §2 also calls `tauri-specta` "build-time
  only", but it is a runtime dependency (`invoke_handler`, `mount_events`). The exact `=` pins
  keep the risk acceptable; correct the sentence (ADR-0005 can carry it).
- **n2.** `presence.rs:39-47`: an invalid new user id returns `InvalidArgument` _before_ the
  previous user is marked offline. The reference marks them offline first (`main.js:429`). Check
  the id after the `mark_offline` branch.
- **n3.** `Watcher::set_scope_year` has no caller in the shell. That is fine while `activeYear`
  still lives in `config.json`, but C7 (Step 6a) must wire it. Add a line to STATE/backlog so
  this does not get lost.
- **n4.** `LocalSession::write` errors put an absolute local path (including the Windows user
  name) into `details.path`, which `error.rs:30` documents as "data-relative". The same holds for
  `Error::Locked` with the lock-file path (`commit.rs:89`). Either document it or shorten those
  paths.
- **n5.** `tools/bindings.mjs` spawns `cargo`. From Git Bash this hits the MSVC `link.exe`
  shadowing that CLAUDE.md warns about. Mention "run from PowerShell" in `docs/testing.md`.
- **n6.** If `on_changes` panics or the engine panics, the watcher thread dies silently and the
  app stops reporting changes for the rest of the session. Wrap the loop body in `catch_unwind`
  and log it, or at least log the panic. Relatedly, `Core::shutdown` joins the watcher on the
  main thread, so a check that is reading a dehydrated OneDrive file delays exit.
- **n7.** Like the reference, an unparsable or locked file that never becomes readable is
  re-scheduled by every poll and re-read every 20 s. A `WatchOptions.poll` shorter than the
  500 ms debounce starves checks completely (the test comment at `tests.rs:505` hints at this).
  Assert `poll > DEBOUNCE` in `start`.
- **n8.** Hardening, matching the reference: `save_photo` and `write_text_file` accept any data
  path, so they can overwrite a JSON file without CAS (and `save_photo` without `note_write`).
  The only callers write `fotos/…` and `opdrachten/*.typ`. Restricting them would make the C6
  "every JSON write is CAS" guarantee hold at the command boundary.

## Checked and found fine

- **Path traversal:** every command that takes a path goes through `RelPath::parse`. These are
  `read_json`, `read_json_versioned`, `write_json`, `read_all_json`, `delete_file`, `ensure_dir`,
  `read_text_file`, `write_text_file`, `read_photo_as_data_url` and `save_photo`. `ensure_year`
  checks `is_year_name`, and `update_presence` rejects `/`, `\`, `.`, `..`, then `RelPath`
  rejects device names (`con`). The watcher reads only through `DataDir::resolve`; `stat_of` is
  unguarded but only stats paths found by a walk that follows no links. The junction test covers
  the escape.
- **Feedback loops:** own writes (`write_json`, `write_text`, presence) are noted; `save_photo`
  writes to `fotos/`, which is ignored. No `Sync` handler in the UI writes in response to an
  event, so even the m1 echo cannot loop.
- **Deadlock:** the lock order is always commit lock, then engine mutex. The watcher never takes
  the commit lock, and the callback runs unlocked. `Watcher::close`/`Drop` sends `Stop` on an
  unbounded channel and joins, and the thread wakes from `recv_timeout`.
- **Architecture:** core depends on `notify` and `tracing` only (no `tauri`, no `specta`). The
  command handlers parse arguments, call core and map errors. All file work runs in
  `spawn_blocking`. Mapping `CommandError` from core `Error` is exhaustive, and a test ties the
  codes to `Error::code()`.
- **Compat shapes:** `TauriApi` matches the reference result shapes:
  - `readJson`: `null` on missing or corrupt;
  - `readJsonVersioned`: `{data:null,hash:null}` / `{error}`;
  - `writeJson`: `{ok,hash}` / `{ok:false,reason:'conflict'|'locked'|message}`, with CAS
    `null` meaning "must be missing", as in `main.js:93`;
  - `deleteFile`: `{ok}` / `{ok:false,reason}`;
  - `writeTextFile`: `{ok:true}`, errors reject;
  - `listYears`: `[]`; `readPhotoAsDataUrl` / `readLocalSession`: `null`;
  - `updatePresence`: never throws.

  `onDataChanged` handles an unsubscribe that comes before `listen` resolves. The payload
  `{relPath, kind, meta}` is what `ui/src/sync.js` and `Store.applyExternalChange` read.

- **Watcher parity:** relevance (including Node `extname` edge cases), debounce/flush ordering on
  the virtual clock, the S34 quirk kept, the S35 single retry, S40 skipped without a retry, poll
  scope (S32/S33), and the snapshot without hashes all match `sync.js`. `rapporten/` is ignored
  per ADR-0002 §4/§9.
- **Presence:** the `{...state, online:false, scoreModal:null, heartbeatAt}` shape, key order
  preserved, written once on quit via `RunEvent::Exit` (which Tauri emits after the last window
  closes). One gap: an OS logoff/shutdown may not reach `Exit`; the reference has the same gap.
- **Bindings:** the stale check normalises CRLF, and `.gitattributes` forces LF anyway. The file
  is excluded from Prettier/ESLint and carries the SPDX header. The MSVC manifest workaround in
  `build.rs` is documented in ADR-0005. Pinning the `rc` versions exactly is acceptable as
  ADR-0002 §2 allows it, see n1 for the wording.

## Triage (implementer, 2026-10-27)

| Id  | Decision                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Fixed: the driver starts OS notifications afresh every 60 s (`WatchOptions::refresh`; the new watch starts before the old one is dropped), besides the restart after a reported error. `tracing-subscriber` has `tracing-log`, so `notify`'s `log::error!` reaches the log. Test `m1_review_os_notifications_are_started_afresh_periodically`. ReadDirectoryChangesW overflow stays a backlog note. |
| m1  | Fixed, test first (`m1_a_check_during_an_own_write_waits_until_the_write_is_noted` failed): `WriteObserver::will_change` before the rename/removal and `change_failed` on error; the engine re-schedules a check on an in-flight file. S18 test extended.                                                                                                                                           |
| m2  | Fixed: snapshot and poll walk without the engine lock (`scan_all`/`scan_poll`, then `apply_snapshot`/`apply_poll` under the lock). A single check still reads one file under the lock (needed for m1).                                                                                                                                                                                              |
| m3  | Fixed: `TauriApi.updatePresence` queues calls in call order (test "presence calls reach the backend in call order"); `Presence::close` on quit ignores later updates (test `after_quit_a_late_heartbeat_is_ignored`).                                                                                                                                                                               |
| m4  | Fixed, test first (`m4_own_writes_to_ignored_paths_are_not_tracked` failed): own writes to ignored paths are not tracked. Recorded as quirk D36.                                                                                                                                                                                                                                                    |
| m5  | Partly fixed: `unsupported_schema` now throws from the null/`[]` fallback methods (test m5). A proper startup error screen with retry: backlog (Step 6).                                                                                                                                                                                                                                            |
| m6  | Fixed: `Watcher::wait_ready` (snapshot taken, notifications started) replaces the sleeps.                                                                                                                                                                                                                                                                                                           |
| n1  | Fixed in ADR-0002 section 2.                                                                                                                                                                                                                                                                                                                                                                        |
| n2  | Fixed: the previous user goes offline before the new id is validated (test).                                                                                                                                                                                                                                                                                                                        |
| n3  | Backlog (C7, Step 6a).                                                                                                                                                                                                                                                                                                                                                                              |
| n4  | Session file: fixed (`session.json` only). Lock folder path: backlog.                                                                                                                                                                                                                                                                                                                               |
| n5  | Fixed in `docs/testing.md`.                                                                                                                                                                                                                                                                                                                                                                         |
| n6  | Backlog.                                                                                                                                                                                                                                                                                                                                                                                            |
| n7  | Fixed: `Watcher::start` asserts `poll > debounce` (test `n7_*`); unreadable files re-read per poll accepted (same as the reference, S40).                                                                                                                                                                                                                                                           |
| n8  | Backlog (Step 6 hardening).                                                                                                                                                                                                                                                                                                                                                                         |
