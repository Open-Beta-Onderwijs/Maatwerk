# Review: Step 10 (Cutover readiness) and the final whole-codebase pass

Reviewer: fresh-context subagent, 2026-11-03. Commit reviewed: `f772cc5ed775711ba8f03ce742fde1fefb0a040b`
(`step/10-cutover-readiness`). Scope: (A) `git diff main...step/10-cutover-readiness` (11 commits,
45 files, +1209/-71); (B) a whole-codebase pass on data safety, security, blocking work and
robustness (Appendix C items 2-4 and 8) over `crates/`, `src-tauri/`, `ui/src`. I checked the
claims against the code and did not trust the commit messages. I ran no commands besides git and
grep. I did not run the gate, Playwright, `cargo audit` or `npm audit`.

## Summary

The robustness work is sound in its main lines. `CoreSlot` cannot deadlock: every waiter is on a
blocking thread (`commands.rs:26`, `scheme.rs:34`, the delete thread in `opdrachten.rs:219`), the
run-event handler only uses `get()`, and a panic while opening still fills the slot. The per-job
`catch_unwind` leaves no shared state poisoned: all typst_svc locks recover from poisoning
(`world.rs:403,415`, `batch.rs:221`), and `OnceLock` and comemo do not cache a panicked
initialiser. After the settle wait the snapshot claim never writes when it has lost, so it cannot
overwrite another PC's claim at that point. `nextQuestionId` fixes the plain B24 sequence.

The whole-codebase pass found no lost-update path. Every UI JSON write goes through CAS
(`store.js:117-139`, `saveVersioned`), and so do opdracht `.typ` saves from the editor and the
single-file restore (`snapshots.rs:503`). Paths go through `RelPath`. The Typst World is
sandboxed, and the new tests cover absolute and drive paths and packages that are not embedded.
The CSP is strict (`script-src 'self'`, no `unsafe-inline`). Two problems matter at the cutover.
First, several Step 10 plan items have no evidence in the repo (M1). Second, the B24 data check
tells an admin to roll back a migration for an issue the runbook says does not block (M2).

## Blockers

None.

## Majors

### M1. Step 10 plan items not done or not recorded (perf, audits, CSP review, manual checks)

- **Where:** `PLAN.md` Step 10 bullets "Performance", "Security", "manual checks", "Final review
  plus /security-review"; `docs/perf.md` (unchanged in the diff); `docs/STATE.md:3,8-21`.
- **Evidence:** No commit runs or records the `school` fixture or a batch of 200 PDFs against the
  budgets in `docs/perf.md`; that file is not in the diff. Nothing records the results of
  `cargo audit`, `cargo deny`, `npm audit` or the CSP review. The `innerHTML` audit appears only
  as a one-line note in `quirks.md` (U8). STATE's "Step 10 so far" lists items 1-5 only (no
  docs, tests or audits), and its header still says `Branch: main`. M-SYNC and M-MIG on real
  data and the runbook rehearsal are still open. They are the user's to do, but STATE should list
  them as the next action.
- **Why major:** The step is "cutover readiness". Without these results the gate (PLAN 2.2) is not
  met, and the cutover verdict below is conditional on them.
- **Fix:** Run the 200-PDF batch and the `school` fixture timings and add a dated Step 10 section
  to `docs/perf.md`. Run `cargo audit`, `cargo deny check`, `npm audit --omit=dev` and
  `/security-review`, and record the results (for example in a "Checklist notes" section here or
  in STATE). Write one paragraph with the CSP review result. Update the STATE header and "Next
  action" with the manual checks the user still has to do.

### M2. The B24 data check is an error that the in-app migration advice says to roll back for

- **Where:** `crates/maatwerk-core/src/validate.rs:467-487` (severity `error`, kind `Shape`);
  `ui/src/screens/migration.ts:60-70`; `ui/src/app.js:1029-1041`;
  `docs/cutover-runbook.md:16-19` vs `:49`; `crates/maatwerk-cli/src/data.rs:49,155`.
- **Evidence:** A duplicate question id in an exam saved by the old app is reported as an error.
  The migration screen answers any error with "Er zijn fouten gevonden. Los ze op voordat
  collega's verder werken ... Lukt dat niet, zet dan de back-up terug". The B24 message itself
  says "Niet zelf aanpassen; vraag de beheerder", and the app has no way to fix it. The runbook
  is inconsistent: step 1 says this error "does not block", step 5 says "No errors expected". After
  the cutover, the admin also gets a persistent "Gegevenscontrole: N fouten" banner at every
  login (`app.js:1041`), and `maatwerk-cli validate` exits 1 for good. The user suspects that real
  data holds such duplicates (STATE item 4, open question). An admin who follows the screen
  instead of the runbook would roll back a cutover that is otherwise fine.
- **Fix:** Before the cutover, either:
  - give the issue its own kind (for example `IssueKind::DuplicateQuestionId`), which the
    migration screen and `needsAttention` treat as "known, see the developer" rather than "roll
    back"; or
  - make it a warning with the strong text and keep the error count for real breakage.

  Align runbook step 5 with step 1. Get the user's decision on repair (the STATE open question)
  before the cutover, not after it. Run `maatwerk-cli validate` on the copy of real data to find
  out whether any duplicates exist.

## Minors

### m1. Watcher restart: a queued event skips the restart wait; no backoff on a persistent panic

- **Where:** `crates/maatwerk-core/src/watcher/mod.rs:212-228`;
  `src-tauri/src/start_error.rs:62-72`.
- **Evidence:** After a panic, `rx.recv_timeout(self.options.restart)` returns at once on any
  `Msg::Paths` or `WatchError` (`Ok(_) => {}`), and the driver restarts immediately. On restart,
  `next_poll = now` (`:251-255`), so a panic in the poll path happens again at once. Each queued
  OneDrive event then means another restart, and the OS watch started by each restart adds
  events. Every panic logs a full `Backtrace::force_capture()`, which is slow on Windows and
  symbol-less with `strip = true` (`Cargo.toml:35`). There is no cap, so a persistent panic logs
  one backtrace every 30 s or faster, for as long as the app runs. The log is capped at 14 files,
  not by size.
- **Fix:** Wait for the full restart interval: loop on `recv_timeout(deadline - now)` and drop
  `Paths` and `WatchError`, so only `Stop` ends the loop. Use exponential backoff (30 s, 1 min,
  ... up to 10 min). Log the backtrace only for the first restart, or for the first N.

### m2. Watcher restart can re-report every file, or miss changes outside the poll scope

- **Where:** `crates/maatwerk-core/src/watcher/mod.rs:213-216,239-242`;
  `crates/maatwerk-core/src/watcher/engine.rs:313-320,378-398`.
- **Evidence:** `first` is set to `false` after any panic. If the panic was inside the initial
  `scan_all` or `apply_snapshot`, the restart skips the snapshot. The immediate poll then treats
  every file in the poll scope as unknown (`known.get(&rel).is_none_or(..)`) and reports all of
  them as `Added`: a burst of `data:changed`. If the panic came later, the OS watch was dropped
  during the 30 s gap. The poll covers only the root and the active year, so changes to other
  year folders in the gap are never reported. The doc comment "the first poll then reports what
  changed meanwhile" is true only for the poll scope. The same applies to batches lost when a
  panic happens in `advance` or `on_changes`.
- **Fix:** Track whether the snapshot was applied (a flag on the engine), not `first`. After a
  restart, do a full `scan_all` compared with `known` instead of `scan_poll`, or document the
  limit.

### m3. A snapshot claim is now held for at least 45 s; closing the app in that time blocks snapshots for 30 min

- **Where:** `crates/maatwerk-core/src/snapshots.rs:31,33,322,345-355`;
  `src-tauri/src/state.rs` `start_snapshot`.
- **Evidence:** The claim is written, then the thread sleeps `CLAIM_SETTLE` (45 s) before
  zipping. The thread is not joined at exit. A teacher who starts the app to look something up
  and closes it within a minute leaves a claim, and every PC then gets `Busy` until
  `CLAIM_STALE` (30 min) has passed. Snapshots run only at start, so in practice the day's
  snapshot may be skipped. Separately, the release step drops whatever claim is in `state.json`
  (`s.remove("claim")`, `:353`), including a later claim from another PC that arrived after the
  settle wait.
- **Fix:** Settle before claiming: read the state, wait, re-read, then CAS-claim. Or remove the
  claim on `shutdown` when it is ours and no zip has started. Release only a claim whose
  `by`/`atMs` are ours.

### m4. B24 can still happen through a stale `hasScores` plus delete-last-then-add

- **Where:** `ui/src/modals/toets-edit.js:296` (`hasScores` read once at modal open), `:591`
  (delete enabled), `:623-628`, `:662-677`; `ui/src/domain/ids.ts:137-147`.
- **Evidence:** `nextQuestionId` looks only at the questions still in the list. Suppose a
  colleague enters scores, including for `q4`, while this teacher has the exam editor open
  (`hasScores` was false at open). The teacher deletes `q4`, then adds a question: it gets `q4`
  again and takes over the colleague's `q4` scores. The exam save is CAS on the exam file only,
  and score files are separate, so nothing detects this. This is rarer than the original quirk,
  but it is the same corruption.
- **Fix:** Have `nextQuestionId` also skip every id the exam had when the editor opened: pass the
  original ids, or keep the highest-ever number in the exam. Check `examHasScores` again when
  saving if any question was deleted, and refuse with a message if scores appeared.

### m5. Student ids can reach the log file through UI error messages

- **Where:** `ui/src/services/problems.ts:17-29,41`; `ui/src/store.js:121,133,136,146,161`
  (`Save failed for ${relPath}`); `store.js:341` (`<year>/scores/<vak>/<studentId>.json`);
  `src-tauri/src/error.rs` (`conflict on <path>`).
- **Evidence:** Every unhandled rejection is logged as `message + stack`, or `code: message` for
  a `CommandError`. Store errors and core errors embed the relative path, and score files are
  named by student id (leerlingnummer). `init_logging` (`lib.rs:164`) and ADR-0002 section 13
  state "No student data goes into log messages". The README tells teachers to send the log to
  the admin or developer.
- **Fix:** In `errorText`, or in `ui_error_line` on the Rust side, redact the file name of paths
  under `scores/` and `fotos/` (for example to `<leerling>.json`). Or keep the code and the path
  "kind" only for `CommandError`s. Add a test.

### m6. Exam delete is a blind delete after a stale check (whole-codebase pass)

- **Where:** `ui/src/modals/toets-edit.js:743-759`; `ui/src/store.js` `deleteExam`
  (`window.maatwerk.deleteFile`, no expected hash); `src-tauri/src/commands.rs:153`.
- **Evidence:** `examHasScores` is checked before the confirm dialog, and the delete itself has
  no CAS. A colleague who edited the exam, or entered the first scores, while the dialog was
  open loses the exam: the scores are orphaned and the colleague's exam edit is gone. This
  probably matches the reference (quirk D26 area), but it is the one remaining write path that
  can silently discard a colleague's change.
- **Fix:** Add an `expectedHash` (or `baseRev`) to `delete_file` and check scores again after the
  confirm. If parity must hold, record it in `quirks.md` and the backlog.

## Nits

- **n1** `src-tauri/src/lib.rs:281-286`, `state.rs:69-86`: if the app exits before the core is
  open, the opener thread runs on. If it finishes between the `Exit` callback and
  `process::exit`, `then` starts the snapshot thread, which can leave a claim (see m3). A
  `closing` flag in `CoreSlot`, checked before `then`, avoids this. Also, if `failed(...)` itself
  panicked, the slot would never fill and every command would wait forever. Wrap it, or fall back
  to a `Core` with both stores `Err`.
- **n2** `ui/src/main.ts:12-17`: an error before `legacy/globals` has loaded makes the handler
  `import('./app.js')` early, so `app.js` runs before the globals it needs (the file's own
  comment says the order matters). Fall back to `console.error` and a plain `alert` until a flag
  set after line 21.
- **n3** `src-tauri/src/problems.rs:60`: `log_ui_error` is a sync command, so its file write runs
  on the main thread, and a message with newlines can fake log lines. Make it `async` and escape
  `\n` (or log the message as a field).
- **n4** `Cargo.toml:35` `strip = true`: the forced backtraces in the log have no symbols. Keep
  the location (already logged) and drop `force_capture`, or ship a PDB/split debuginfo for
  developers.
- **n5** `validate.rs:470-472`: only string ids are compared, so numeric ids from hand-edited or
  very old files are not checked. Compare `id.to_string()` for numbers too.
- **n6** `README.md:27`: "Printed PDFs go to `rapporten\` next to it". They go to
  `data\rapporten\<schooljaar>\` (`outputs::print_copy` resolves inside the data folder, and
  snapshots skip `rapporten`).
- **n7** `crates/maatwerk-core/src/assignment/tests.rs` (new sandbox test): `!report.ok` passes
  for any failure. Asserting that the secret's content ("x") does not appear, or that the
  diagnostic is "file not found / access denied", would make it a sandbox test and not just a
  "something failed" test.

## Checklist notes

- **Races/deadlocks in CoreSlot:** none found. `wait()` is only called on blocking threads or a
  dedicated thread. The run-event handler uses non-blocking `get()`. `problem_info`,
  `open_log_folder`, `restart_app` and the editor commands do not touch the slot. A hung
  OneDrive open parks one blocking thread per pending command (tokio caps at 512), which is
  acceptable.
- **catch_unwind and shared state:** OK. See the summary. The batch stops starting jobs after
  the first failure (`failed` flag), so a worker that caught a panic does not compile again.
- **Snapshot settle:** a lost claim returns without writing (good). See m3 for the release step.
- **B24 and score keys:** score files key questions by id (`scores[examId][questionId]`), so
  uniqueness at the time of adding is exactly what matters. See m4 for the remaining hole.
  The validate check has no false positives that I could find: resits are separate exam objects,
  and the check skips questions without an id.
- **innerHTML:** the U8 fixes are correct. `escHtml` does not escape `'`, but no template uses
  single-quoted attributes with data (grep `='${`). `confirmDialog` and `persistentError` escape,
  and `toast` uses `textContent`. With the CSP, an unescaped spot breaks layout but cannot run
  script.
- **Paths:** every command that takes a path goes through `RelPath::parse` or `resolve`. `open_path`
  accepts only outputs and `rapporten/` copies, and `write_text_file` only `opdrachten/<id>/*.typ`.
  The new proptest covers Windows prefixes, `..\`, fullwidth dots and NUL.
- **Blocking on the async runtime:** none found outside n3. Command bodies run in `blocking()`,
  and the scheme handler and `open_with_os` use `spawn_blocking`.
- **Corrupt or locked files:** `read_json_versioned` errors on corrupt files and `update()`
  refuses to write, so a corrupt shared array is never overwritten. Folder reads skip unreadable
  files (`storage/mod.rs:305-316`). For score files this only hides scores until the next read;
  writes re-read the file, so no data is lost.

## Architecture drift

The code matches ADR-0002. `maatwerk-core` has no `tauri` dependency. The shell stays thin:
`CoreSlot`, the panic hook and `problems.rs` are shell concerns, and `ui_error_line` is shell
policy, not domain logic. Section 11 (core opened on the main thread) is resolved as section 13
records. The three new commands are listed there, and `open_log_folder` keeps section 7's rule
(the UI cannot open arbitrary paths). Section 13's claim that "the UI's own messages do not" put
data in thrown messages is not quite true for store errors that name score files (m5). The
deferrals to phase 2 (domain consolidation, `u-*` styling, the compat layer in
`tauri-api.ts`) are recorded and change no decision. No undocumented drift.

## Cutover verdict

**Conditionally ready.** I found no blocker and no path that silently overwrites a colleague's
change. CAS, atomic writes, the sandbox and the path checks hold across the codebase. Before
teachers switch:

1. Resolve M2: run `validate` on the copy of real data, fix the guidance or severity, and get the
   user's decision on repairing any duplicates.
2. Close M1: perf and audit results recorded, `/security-review` run, and M-SYNC, M-MIG and the
   runbook rehearsal done by the user.

m1 to m4 are cheap and lower the risk of noisy logs, missed sync events and stale snapshot claims
in the first weeks. Fix them now or put them in the backlog with that reasoning.
