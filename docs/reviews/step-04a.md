# Review: Step 4a (paths and storage in `maatwerk-core`)

Reviewer: fresh-context subagent, 2026-10-27. Scope: `git diff step-03..HEAD` on
`step/04-core-storage`. The two Step 4a commits are `1b93ae7` (core) and `1220fd0` (UI CAS). The
range also contains the merged `fix/score-grid-alignment` branch (`style.css` only), which I did not
review. I read every new Rust file, the UI changes and the doc changes. I compared them with
`_reference/main.js` (fs handlers, presence/session/photos, seed), `_reference/sync.js:1-84`,
`ui/src/domain/ids.ts` `stampMeta`, the storage spec, ADR-0002 sections 1-3 and ADR-0003 C1/C3/C6/C7.

What I ran (PowerShell):

- `cargo test -p maatwerk-core`: 55 unit and 2 integration tests pass. `cargo clippy --workspace
--all-targets -- -D warnings` and `cargo fmt --all --check` are clean. `cargo deny check licenses
bans sources` is ok, and `bash tools/check-spdx.sh` is clean.
- `npm test`: Vitest 220/220 and node 121/121 pass. Playwright `quirks.spec.ts -g U6` (RTTI uitleg
  modal) passes.
- **Flakiness:** I ran the concurrency tests (`s25`, `s37`, `s38`, `reads_during_…`,
  `three_processes_…`) 25 times in a row, then 15 times in each of 6 parallel jobs with
  `--test-threads=8`. That is 115 runs under load with 0 failures.
- **Control experiments:** I used a scratch copy of the crate; the repo was not touched. (a) With
  the guard dropped right after `acquire()` (no commit lock), `s37_*` and `s38_*` failed in 5/5
  runs. (b) With only the OS file lock disabled (process mutex kept),
  `three_processes_lose_no_update` failed (`n` = 64 instead of 180). So both lock layers are
  needed, and the tests do detect it.
- **`jsonfmt` against Node 24:** I built a scratch binary on `maatwerk_core::jsonfmt` and fed it
  500 k random doubles plus 300 k grade-like values (averages and weighted sums of one-decimal
  scores). For each value I compared the output with `JSON.stringify`. Formatting an `f64` given
  as bits: **0 mismatches**. Parsing the JS text with `serde_json` first and then formatting:
  **17,656 of 300 k grade-like values differ**, see M1. With serde_json's `float_roundtrip`
  feature both sets give 0 mismatches.

Overall, this is a solid, small and readable storage layer that follows the user's S37/S38
decision. The commit lock really makes check + rename atomic on one PC: every write and delete
goes through `commit_bytes`/`delete` under the lock, and the tests prove that each lock layer
matters. Paths are validated lexically and against junction escapes, with a regression test for
the NTFS `$Extend\$Deleted` case. The UI no longer has a blind JSON write. One major issue:
reading JSON with `serde_json`'s default float parser silently changes about 6 % of
17-significant-digit numbers when a file is read and written back.

## Blockers

None.

## Major

### M1. `serde_json` without `float_roundtrip` changes numbers on read-modify-write

- **Where:** `crates/maatwerk-core/Cargo.toml:14` (`serde_json` features: only `preserve_order`).
  This affects `Storage::read_json_versioned` → `update()` → `write_json`, and from 4b on also
  every Tauri command argument, because the IPC payload is parsed by `serde_json` too.
- **Evidence:** by default, `serde_json` parses floats with a fast algorithm that is not
  correctly rounded. It can be off by one ULP for 17-digit inputs. `js_f64` itself is exact (0 of
  500 k mismatches on raw bits). But a value read from text first is often a different double.
  From the grade-like set: `1.8699999999999999` → `1.87`, `3.6999999999999997` → `3.7`,
  `7.4799999999999995` → `7.48`. From the random set: `123456789012345680000` →
  `123456789012345670000` and `3.4204047935314616e-13` → `3.420404793531462e-13`. That is 17,656
  of 300 k grade-like values and about 85 k of 500 k random doubles. `update()` rewrites the whole
  file, so one score save silently changes unrelated numbers elsewhere in the same file. It also
  gives the watcher and OneDrive a "change" that nobody made. This breaks PLAN 4a ("no gratuitous
  reformatting") and ADR-0002 §3 ("formatting matches for normal data"). Such values occur in the
  logic goldens (`tests/golden/logic/grades.json` has 661 long decimals). The only test,
  `jsonfmt::tests::parsed_floats_reprint_like_js`, uses short literals only, so it cannot catch
  this.
- **Fix:** enable `serde_json/float_roundtrip` (in the workspace dependency, so `src-tauri` gets
  it too). Write the failing test first: parse `1.8699999999999999` and
  `123456789012345680000` with `serde_json::from_str`, then `to_js_json` must return the same
  text. A small property test also helps: random `f64` → `js_f64` → `from_str` → `to_js_json` is
  the identity.

## Minor

### m1. The commit lock is held for much more than "the check and the rename"

- **Where:** `crates/maatwerk-core/src/storage/mod.rs:268-288` (`commit_bytes`) and
  `storage/atomic.rs:33-54`.
- **Evidence:** the user's decision (storage-spec.md, S37) says the lock is "held only for the
  check and the rename". In the code, the lock is taken before `write_atomic`, so it also covers
  `create_dir_all`, writing the whole temp file, up to 450 ms of retry sleeps
  (30+60+90+120+150) and the direct-write fallback. The lock is per data folder, not per file, so
  one slow OneDrive write blocks every other write of the app, the second instance and the CLI.
  This includes `save_photo` writing a multi-MB logo. A blocked process waits up to 10 s per
  attempt. A thread queued on the process mutex can wait for the mutex and then another 10 s for
  the file lock, so waits add up.
- **Fix:** split `write_atomic` into prepare (mkdir, write temp) and commit (rename with retries,
  fallback, temp cleanup on error). Write the temp file before `acquire()`, and take the lock
  only for check + rename. Removing the backoff from inside the lock is harder (the rename must
  stay inside it), so document the 450 ms worst case.

### m2. Lock folder is `%TEMP%`: per user and environment-dependent

- **Where:** `crates/maatwerk-core/src/storage/commit.rs:25-27` (`default_lock_dir`).
- **Evidence:** `std::env::temp_dir()` depends on `TMP`/`TEMP`. Two processes with a different
  `TEMP` lock different files and get no mutual exclusion. Examples: the app and a CLI started
  from a shell or task with another `TEMP`, or two Windows users on one terminal server with the
  data folder on a network share. Then S37 is silently not fixed for them. Cleanup tools also
  empty `%TEMP%`. That is harmless on Windows while the file is open, but it shows the folder was
  not chosen for this purpose. The spec says "one PC"; in practice it is one user with one
  `TEMP`.
- **Fix:** use a fixed per-user local app folder (`%LOCALAPPDATA%\maatwerk\locks`, the same base
  as the session file in 4b) and document "one Windows user session" as the scope in the spec.
  Optionally log the lock path at startup so a mismatch can be diagnosed.

### m3. `updateSchool` for `schoolsoort` still overwrites a colleague's toggle

- **Where:** `ui/src/screens/school.js:121-131`.
- **Evidence:** the patch is the whole array, built from the DOM state loaded when the screen
  opened (`{ schoolsoort: [...selected] }`). Teacher A sees `[havo]`. Teacher B adds `vwo` (disk
  is now `[havo, vwo]`). A clicks `mavo`, and `update()` writes `[havo, mavo]`: `vwo` is lost
  silently, although the write is a CAS. Text fields are last-writer-wins per field, which is
  acceptable. An array toggle is not.
- **Fix:** let the mutator toggle the one value on the current disk array, for example
  `update('school.json', cur => { const s = new Set(cur.schoolsoort ?? []); on ? s.add(v) :
s.delete(v); cur.schoolsoort = [...s]; return cur; })`. Then re-render from the result. Add a
  test next to "updateSchool keeps a field another teacher changed meanwhile".

### m4. RTTI modal: spurious conflicts, misleading message, no way out

- **Where:** `ui/src/modals/rapport.js:252-268` and `:453-478`.
- **Evidence:** (a) Every tab is still written, including untouched ones (quirks D6 says so). If a
  colleague changed an untouched tab, or created a missing one, that tab conflicts. The other tabs
  are saved (`allSettled`). Yet the toast says "je wijzigingen zijn niet opgeslagen", which is
  wrong for the saved tabs. (b) After a conflict the stale hash stays, so every new "Opslaan"
  fails again. The only way out is to close and reopen, which discards the edits in the
  conflicting tab. (c) An unreadable file gets the sentinel hash `'onleesbaar'`, so that tab
  conflicts on every save and the suggested "close and reopen" never helps. (d) None of this is
  tested: `cas-writes.test.ts` covers `saveVersioned`, not the modal.
- **Fix:** keep the loaded JSON per tab and save only tabs whose data changed. That also fixes
  most of D6. Report which tabs were saved and which conflicted. For an unreadable file, show a
  specific message and disable that tab's save. Add a Vitest or e2e case for "one tab changed
  remotely".

### m5. Spec/parity do not record how S27 and S38 were actually resolved

- **Where:** `docs/specs/storage-spec.md:65` (S38 port column still says "students and
  `saveStudentScores` to be decided in Step 4") and `:79` (S27: "Keep; also for school.json,
  config and RTTI templates (C6)"). Also `docs/parity.md`, rows S20-S27/S38.
- **Evidence:** S27 asks for the `_meta.rev` stale-write check on school/config/templates. The
  implementation does something else: a field-merge `update()` for school/config with no rev
  check, and a whole-file hash CAS for templates. That is a reasonable choice, but it is a
  deviation from the table, and neither parity.md nor quirks.md records it as one. The decision
  block above the table covers S38, but the table row contradicts it.
- **Fix:** update both port cells ("done: …") and add a parity note: "S27 for C6 files: field
  merge (school, config) / hash CAS (templates) instead of `_meta.rev`".

### m6. A read racing a replace can fail with `io`, and `update()` does not retry it

- **Where:** `crates/maatwerk-core/src/storage/entity.rs:36` and `mod.rs:136-143`. The test
  `storage/tests.rs:507-532` documents the behaviour.
- **Evidence:** the regression test says "Windows may refuse a read for a moment while the file
  is replaced" and accepts `io`. In `update()` that `io` error is returned as is (S23, not
  retried), so the UI shows "Opslaan mislukt" for a normal collision between two windows or the
  CLI on the same file. The reference has the same weakness (`readJsonVersioned` → "onleesbaar"),
  but the port now promises atomicity on one PC. I did not hit it in 115 stress runs, so it is
  rare.
- **Fix:** in `read_bytes` (or only in `update()`), retry a sharing or access-denied read error
  with the same 30-150 ms backoff as the rename, outside the commit lock.

## Nits

- **n1.** `docs/STATE.md` is stale. "Next action 1" (UI side of S38) and "2" (docs) are done in
  `1220fd0`, and "Done since last tag" does not mention the UI commit.
- **n2.** The seed omits the reference's `removeEmptyImageDirs()` (`_reference/main.js:1002`)
  without a note. Record it as Step 6 (opdracht images) in quirks or parity.
- **n3.** `WriteObserver::note_write`/`note_delete` run while the commit lock is held
  (`mod.rs:285-287`, `:300-302`). An observer that calls back into `Storage` deadlocks, because
  the std `Mutex` is not re-entrant. A mutator that calls `update()` on the same file deadlocks on
  the update queue (`entity.rs:32-33`). Document both on the trait and on `update`.
- **n4.** `Error::Locked { path }` carries the local lock-file path (`commit.rs:84`), not the data
  file that was being written. The UI message would show `…\Temp\maatwerk-locks\data-….lock`.
  Pass the `RelPath` in.
- **n5.** Dead or unused public API: `Error::NotFound` (`error.rs:19`) is never built, and
  `RelPath::is_score_file` (`paths.rs:87`) is moot without locks. `data_dir_location`/`rel_of` are
  for 4b, which is fine. Remove the first two or mark them for a later step.
- **n6.** `update_locks` (`mod.rs:76`) gets one entry per file ever updated and never shrinks.
  This is bounded by the file count, so harmless. Prune entries whose `Arc` count is 1, or leave
  a comment.
- **n7.** `read_all_json` skips files that are not valid UTF-8 (`mod.rs:196`). `parse_json`
  decodes lossily, as Node does. Use the same rule for both.
- **n8.** `save_photo` rejects base64 that Node accepts: non-alphabet characters, which Node
  skips, and non-zero trailing bits (`mod.rs:369-388`). Browser data URLs are canonical, so this
  is harmless. Note it in quirks (D10 entry) since the test pins `invalid_argument` for `"!!!"`.
- **n9.** `check_schema` runs only in `open` (`mod.rs:114-131`). A `config.json` that arrives
  later with `schema_version: 2` (another PC upgraded) is not noticed while the app runs. Recheck
  on a watcher event for `config.json` in 4b.
- **n10.** `write_json(…, Expect::Any)` keeps blind writes possible in the core API. S38 says
  "every JSON write uses CAS". In 4b, consider making the `writeJson` command refuse non-CAS
  writes (the UI has none left), or log them.
- **n11.** JSON edge cases outside UI data: integers above 2^53 that are not JS-formatted
  reprint exactly where JS would round them. A JS-written lone surrogate (`"\ud800"`) makes
  `serde_json` reject the whole file as `corrupt_json`. Note both in `jsonfmt` docs.
- **n12.** Tests: no on-disk round trip for a non-ASCII name (`fotos/zoë.jpg` is only parsed) and
  no path longer than 260 characters. Both work by construction (the root is a `\\?\` canonical
  path), but a test would pin it.
- **n13.** TOCTOU: `resolve` checks for junctions before the lock is taken and before the write.
  A junction created in between could redirect the temp write or the direct-write fallback. This
  needs write access to the shared folder, and OneDrive does not sync junctions, so the risk is
  low. A comment on `resolve` is enough.

## Checked and found fine

- **Atomic CAS on one PC (S37):** every write (`write_json`, `write_text`, `save_photo`, seed)
  and `delete` goes through the commit lock. The hash check reads the file under the lock. The
  guard drops the file (OS unlock) before the process mutex. The lock order is always update
  queue → process mutex → OS lock, and nothing takes them in reverse. A poisoned mutex is
  recovered. Writing `File::lock` to the local folder leaves nothing in the data folder (test).
- **Spec rows:** S01-S07 (backoff 30..150 ms and 6 renames, the same as `sync.js`), S09-S12,
  S18, S19 and S20-S27 match the reference shims. `stamp_meta` matches `ids.ts` (key position of
  an existing `_meta` is kept; legacy `createdBy/At` become `null`). The rev comparison matches
  `(onDisk._meta?.rev ?? 0) !== (baseRev ?? 0)`, including `_meta: null`. `iso_utc` matches
  `toISOString` (including before 1970).
- **C3:** there are no `.lock` files. A leftover old `.lock` does not block (test).
- **C1:** an unknown, newer, string or float `schema_version` is refused, and a missing or
  corrupt `config.json` does not block.
- **Paths:** `..`, absolute, drive, UNC, ADS (`:`), control characters, a trailing dot or space,
  and reserved device names (including superscript digits) are rejected. Junction escape is
  tested on Windows and symlink escape on Unix. A dangling link counts as an escape. The root is
  canonical (`\\?\`), so case and long paths compare correctly. Proptests cover lexical safety.
- **jsonfmt:** the layout, key order, escapes (including DEL and U+2028 literal) and `js_f64` are
  exact against Node for 800 k doubles (see M1 for parsing).
- **Reference deviations recorded:** D1, D2, D3, D6, D9 and D10 are marked "Done (4a)" in
  quirks.md. The `ensure_year` year check, the seed not copying `lib.typ`, and the atomic
  photo/session/seed writes are documented.
- **UI:** `saveSchool`, `saveStudents` and `saveStudentScores` are gone (test). `setActiveYear`
  and the text and image fields of `updateSchool` merge onto the latest disk version. No
  `writeJson` without `cas` is left in `ui/src` (only the mock seeding hook). An unreadable
  school or config file is refused instead of overwritten (S24).
- **Architecture:** core has no `tauri`. The new deps (sha1, thiserror, base64, ryu; proptest
  and tempfile for dev) have allowed licences and are listed in `THIRD_PARTY_LICENSES.md`. SPDX
  headers are present.

## Triage (implementer, 2026-10-27)

| Id         | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1         | Fixed, test first (`jsonfmt::tests::parsed_floats_round_trip_exactly` failed with `1.87`): `float_roundtrip` enabled on `serde_json` in `maatwerk-core`.                                                                                                                                                                                                                                                                                                                                     |
| m1         | Fixed: `atomic::TempFile` is written before the commit lock; the lock covers the check and the rename (its retries and direct-write fallback are part of the rename). A conflict removes the temp file (asserted in `s11`).                                                                                                                                                                                                                                                                  |
| m2         | Fixed: lock folder `%LOCALAPPDATA%\maatwerk\locks` (fallback `%TEMP%`); scope (same user, same PC) documented in `commit.rs`.                                                                                                                                                                                                                                                                                                                                                                |
| m3         | Fixed: `Store.updateSchool` also takes a function; the schoolsoort toggle flips one entry in the list on disk (button order kept). Test "updateSchool with a function edits the latest version".                                                                                                                                                                                                                                                                                             |
| m4         | Fixed: unchanged tabs whose file exists are skipped (missing files are still written: the rapport falls back from a missing variant file to the subject file, so skipping would change output); the toast names the tabs that were not saved and says the others were. A tab that conflicts keeps conflicting until the modal is reopened, by design (the message says so). No DOM test; covered by e2e quirks U6 for the happy path. Remaining case (unreadable file) in `docs/backlog.md`. |
| m5         | Fixed: S27/S38 rows in `docs/specs/storage-spec.md` and `docs/parity.md` updated.                                                                                                                                                                                                                                                                                                                                                                                                            |
| m6         | Backlog: needs a deterministic fault-injection test for reads; only a spurious error, never a lost update.                                                                                                                                                                                                                                                                                                                                                                                   |
| n1         | Fixed (STATE updated).                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| n2         | Fixed: noted in quirks D10 (image-folder cleanup moves with the opdracht image handlers, Step 6).                                                                                                                                                                                                                                                                                                                                                                                            |
| n3         | Fixed: documented on `update()` and at the observer call.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| n5         | `RelPath::is_score_file` removed; `Error::NotFound` kept for the 4b commands.                                                                                                                                                                                                                                                                                                                                                                                                                |
| n4, n6-n13 | Backlog.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
