# Review Step 7b: accounts, roles, snapshots

Reviewer: fresh-context subagent, 2026-10-31. Scope: `git diff step-07a..HEAD` on
`step/07-data-v2` (commits `9286255..e498a59`), against PLAN.md Step 7b, decision 13, ADR-0006
and `docs/reference/data-files-v2.md`.

## Summary

The step is in good shape. PIN hashing is done right: Argon2id with a random salt from the OS
RNG, PHC strings, codes from rejection sampling over an unambiguous alphabet, hashed in a
canonical form; plain PINs and codes never reach the disk or a log. All PIN commands run through
`blocking` (`spawn_blocking`). The first PIN and the use of a recovery code are decided inside the
CAS update, so two PCs cannot both set a first PIN or both spend one code. The session that gates
`reset_pin` and `restore_from_snapshot` lives in Rust and is re-read from disk. The snapshot
writer zips to `.partial`, reads the zip back and renames, runs on its own thread, and the
watcher and `validate-data` ignore `snapshots/`. The sectievoorzitter role is narrow in the group
modal (name, jaarlaag, schoolsoort, vak locked; no create or delete) and `_meta.updatedBy` is the
teacher (checked by e2e).

I found no blockers. Two majors: the snapshot name taken from the UI is not a safe file name
(it may contain `/`, `\` and `..`, and a non-ASCII name panics the parser) (M1); and "Herstellen
uit snapshot" writes the old file back blind, with its old `_meta`, so `rev` goes backwards and
the rev-equality CAS of every colleague can be fooled (M2).

### Verified and found fine

- **Tests:** `cargo test -p maatwerk-core --lib -- auth snapshots` passes (21 tests). The rest of
  the suites and Playwright were not run by me.
- **Secrets:** no `tracing` call in `auth.rs`, `src-tauri/src/auth.rs` or `snapshots.rs` gets a PIN
  or code; the mock's `record()` logs only user ids for the PIN methods; the codes are shown once
  (`showRecoveryCodes`), written only on "Opslaan als" to a place the admin picks, and printed via
  a `textContent` sheet. `hash_secret` errors carry the argon2 error, not the secret.
- **Throttle** (`auth.rs:113-121, 219-252`): per user id, separate keys for PIN and recovery code,
  in memory only (a stranger cannot lock a teacher out on every PC). `NoPin` is returned before
  the throttle, which is fine because nothing is checked. Time is passed in (`Instant`), so the
  tests are deterministic.
- **Admin checks in Rust:** `Auth::require_admin` re-reads the session user and requires
  `isAdmin && actief`; `reset_pin` refuses the admin's own id. The UI's `writeJson` stays ungated,
  as ADR-0006 states ("the PIN guards the shared PC, not the files").
- **User form vs PIN writes:** `openUserModal` now spreads the opened record (`gebruikers.js:329`),
  so `pinHash`/`recoveryCodeHashes` survive; `upsertUser` checks `_meta.rev`, so a PIN set on
  another PC in between makes the form conflict instead of erasing it (e2e "the user form keeps
  the PIN fields"). PIN commands use `storage.update` with a fresh `_meta` (rev + 1), and
  `Store.cacheUser` updates this PC's cache because own writes are not echoed.
- **`school.json` secties:** written via `Store.updateSchool` (CAS read-modify-write);
  `validate-data` warns on an unknown voorzitter id.
- **Paths:** `user_path` allows only `[A-Za-z0-9_-]+`; `snapshot_for_file`/`restore_from_snapshot`
  take the JSON path through `rel()`; `restore_file` refuses non-JSON and `snapshots/`. (The
  snapshot name itself: see M1.)
- **Snapshot start:** `Storage::open` fails on a v1 folder (`check_schema`), so no snapshot is
  written into an unmigrated folder. Contents match the plan (JSON, `.typ`, opdracht images; not
  `fotos/`, `rapporten/`, `snapshots/`, `bak/`, `temp/`, `.tmp`/`.partial`).
- **innerHTML:** all user data in the new templates (`startup.js` voorzitter badge,
  `gebruikers.js` cards and selects, `pin.ts` names, codes and role labels) goes through
  `escHtml`; `instellingen.ts` and `gegevens.ts` use `textContent`.
- **Architecture:** `maatwerk-core` gains `argon2`/`password-hash` (MIT/Apache) and no `tauri`;
  logic sits in `auth.rs`/`snapshots.rs` (one exception, m3).
- **Photos:** `utils/badges.js` is used on the login screen (incl. the voorzitter badge), the top
  bar and Gebruikers. Group cards show docent names as text, as in the reference
  (`_reference/renderer/screens/groepen.js:136-148`), so there is no photo to match there.
- **Parity:** the only deliberate change is the badge click opening the account modal instead of
  logging out, recorded in `docs/parity.md`. The logout itself (`app.js` `logOut`) does what the
  old click handler did, plus `api.logout()`; the login keeps `scoreSavesDone()` before
  `setActiveUser` (review 3b M1).

## Findings

### Blockers

None.

### Majors

#### M1. The snapshot name from the UI is not checked as a file name; `parse_name` also panics on non-ASCII names

- **Where:** `crates/maatwerk-core/src/snapshots.rs:92-111` (`parse_name`), `:392-398`
  (`read_entry` joins the name to `snapshots/`), reached from `restore_from_snapshot`
  (`src-tauri/src/auth.rs:237-251`, `snapshot: String` straight from the UI) and from `list()`.
- **Evidence:** `parse_name` checks the first 15 bytes and then only that the rest is empty or
  starts with `" ("` and ends with `")"`. So `2026-10-31 0815 (/../../../../Users/x/y).zip` is
  accepted, and `root.join("snapshots").join(name)` points outside the data folder (Windows
  normalises `..` lexically, so the non-existent `2026-10-31 0815 (` component does not stop it).
  `restore_file` then reads a JSON entry from a zip outside the folder and writes it into the data
  folder. Impact is limited (admin only, the file must end in `).zip`), but it breaks the CLAUDE.md
  rule "Paths from the UI: reject `..`, absolute paths and symlink escapes". Second defect in the
  same function: `&stem[15..]` (line 98) slices by byte before the digits are checked, so a name
  like `2026-10-31 081é.zip` (the `é` straddles byte 15) panics. In `list()` that panic comes from
  a file in the shared folder: the snapshot thread dies at every start on every PC, and
  `list_snapshots`/`snapshot_for_file` fail with "blocking task failed", until the file is removed.
- **Fix:** in `parse_name`, require `stem.is_ascii()` (or use `stem.get(15..)?`) and that the
  suffix is ` (<digits>)`; in `read_entry`/`restore_file`, also require that the name is one of
  `list()`'s names (or contains no `/`, `\`, `..`). Tests: `parse_name` rejects
  `"… (../x).zip"`, `"… (a/b).zip"` and does not panic on `"2026-10-31 081é.zip"`;
  `restore_file` with such a name returns `InvalidArgument` and writes nothing.

#### M2. "Herstellen uit snapshot" writes blind and keeps the old `_meta`: `rev` goes backwards

- **Where:** `crates/maatwerk-core/src/snapshots.rs:434-446` (`restore_file`,
  `storage.write_json(rel, &value, Expect::Any)`), `ui/src/screens/gegevens.ts:152-175`.
- **Evidence:**
  1. The restored value keeps the snapshot's `_meta` (rev, `updatedBy`, `updatedAt`). Entity CAS
     in this app is rev **equality** (`store.js:152-158` `saveEntity`, core `save_entity`). After a
     restore from rev 3 over rev 7, an edit started from rev 3 (an app that was left open since
     the snapshot, or a modal opened from a stale cache) passes the check and silently overwrites
     the restored file; conversely the colleagues' conflict dialogs name the old author. For
     `gebruikers/<admin>.json` it also brings back recovery code hashes that were used up (and an
     old `pinHash`), and `_meta.updatedBy` does not show that the admin restored it.
  2. `Expect::Any`: the admin decides from a Gegevenscontrole table that may be minutes old. If a
     colleague has saved the file through Maatwerk in the meantime (which re-stamps it, so the
     issue is gone), the restore throws that work away without any conflict.
  3. Own writes are not echoed, and the screen does not invalidate the Store, so this PC keeps
     the pre-restore content in its cache until reload (a later save then conflicts, at least).
- **Fix:** do the restore as a CAS update in core: take the hash the check saw (or re-read and
  require that the current file's stamp is still `Mismatch`/`Missing`, else refuse with "het
  bestand is intussen gewijzigd"), and for entity files (`_meta` present on disk or in the copy)
  write the restored content through `stamp_meta(…, on_disk, Some(admin), now)`, so rev is
  on-disk rev + 1 and `updatedBy` is the admin. Have `restoreFromSnapshot` return the written value
  (or emit a change) so the Store refreshes. Consider refusing or warning for
  `gebruikers/*.json` with `recoveryCodeHashes`, or dropping that field on restore. Tests: restore
  over a higher rev gives rev = on-disk + 1; restore after a concurrent good write is refused.

### Minors

#### m1. Snapshot claim does not stop two PCs on OneDrive; conflict copies are never pruned

- **Where:** `snapshots.rs:249-279` (claim), `:92-111` (`parse_name`), ADR-0006 "claim
  `snapshots/state.json` with compare-and-swap".
- **Evidence:** the CAS only protects writers on the same replica. Two colleagues who start
  within the OneDrive sync delay both see no claim on their local copy, both claim, both zip to the
  same name (`<date> <HHmm>.zip`, same minute). OneDrive keeps one and renames the other to
  `… 0815-PCNAAM.zip` (and `state-PCNAAM.json`). `parse_name` rejects that name, so `list()`,
  retention and Instellingen never see it: it stays forever and syncs to every PC. That is exactly
  the case the plan names ("two colleagues who start together").
- **Fix:** after claiming, wait (e.g. 20-60 s on the background thread), re-read `state.json`, and
  go on only if the claim is still ours (tie-break on `by`); put the machine name in the zip name
  (`2026-10-31 0815 PC-1.zip`) so two copies never collide; let `prune` also remove
  `<valid stem>-<anything>.zip` conflict copies. Say in ADR-0006 that the claim narrows, not
  closes, the race on OneDrive.

#### m2. Throttle: parallel calls and restarts bypass the delay

- **Where:** `auth.rs:240-252` (`must_wait` and `record` take the lock separately, the Argon2
  check runs between them), `src-tauri/src/commands.rs:21-29` (`blocking` runs calls in parallel).
- **Evidence:** N `verify_pin` calls fired together all pass `must_wait` before any failure is
  recorded. The UI disables the button, so this needs devtools or a script, but the point of
  checking in Rust is not to trust the UI. A restart also clears the counter (documented): with
  2 free tries per restart (~3 s), a 5-digit PIN falls in a few days of scripted restarts rather
  than ~70 days at the 60 s cap.
- **Fix:** reserve the attempt under the lock (increment `count`/`last` before checking, undo on
  success), or serialise checks per key. Optionally persist the failure count in the local session
  file (machine-local, so it still cannot lock anyone out on other PCs).

#### m3. Duplicate, weaker admin check in the command layer; `recover` ignores `actief`

- **Where:** `src-tauri/src/auth.rs:253-267` (`require_admin`), `crates/maatwerk-core/src/auth.rs:347-355`
  (`Auth::require_admin`, private), `:371-384` (`recover`).
- **Evidence:** the Tauri helper re-implements the check without `is_active`, so a deactivated
  admin who is still logged in can restore files but not reset PINs. It is also logic in a command
  handler (ADR-0002). `recover` checks `isAdmin` but not `actief`, so a deactivated admin can log
  in with a recovery code although `verify_pin` and `set_first_pin` refuse deactivated users.
- **Fix:** make `Auth::require_admin` public (or add `Auth::restore_file` in core that calls it)
  and use it from the command; add the `is_active` check to `recover`. Tests for both.

#### m4. Recovery codes can be dismissed without the "Ik heb de codes bewaard" gate

- **Where:** `ui/src/screens/pin.ts:228-266`.
- **Evidence:** the modal is a normal `showModal`; Escape, the cross or a click outside close it
  (`onClose` resolves) even while "Verder" is still disabled. The hashes are already written, so
  the codes are gone. The admin can make new ones via the account modal, but only if they notice;
  the plan says "shown once", so an accidental close at the cutover is the realistic failure.
- **Fix:** open this modal without the close paths (or ask "Codes niet bewaard? Ze worden niet
  meer getoond." before closing). Add an e2e step that Escape does not close it.

#### m5. A snapshot dated in the future stops all snapshots

- **Where:** `snapshots.rs:244-246`, `:255-258`.
- **Evidence:** `local(now) - newest < interval` is negative for a zip named in the future (one PC
  with a wrong clock or time zone, or a hand-copied zip), so every PC returns `NotDue` until that
  time has passed; the same holds for a future `lastAtMs` in `state.json`. Nothing tells the admin.
- **Fix:** ignore snapshots and `lastAtMs` more than, say, a day in the future when deciding
  whether one is due (and log a warning).

#### m6. Tests missing for the risky paths

- **Where:** `snapshots/tests.rs`, `auth/tests.rs`.
- **Evidence:** no test for `restore_file` input checks (non-JSON, `snapshots/`, bad snapshot
  name, M1), for `_meta` after a restore (M2), for the claim CAS losing to a concurrent writer
  (only a pre-existing fresh claim is tested), for `recover` of a deactivated admin, or for a
  zip that is corrupt/partial being skipped by `find_intact_copy`.
- **Fix:** add these with the fixes above.

### Nits

- **n1.** `crates/maatwerk-cli/src/data.rs:180`: the success message is a string literal broken
  over two lines without `\`, so it prints `volgende` followed by ~22 spaces and `aanmelding`. Use
  `\` at the line end or two `println!` lines; assert the text in `tests/admin.rs`.
- **n2.** `ui/src/screens/instellingen.ts:110-113`: "in de map snapshots **naast** de gegevens"; the
  folder is `data\snapshots\`, inside the data folder (runbook section 7 says so correctly).
- **n3.** `ui/src/screens/pin.ts:297-304`: every `setFirstPin` error (deactivated user, I/O,
  corrupt file) is treated as "set on another PC meanwhile" and switches to the login dialog.
  Switch only on that specific refusal (an error code), show the rest in the dialog.
- **n4.** The sectievoorzitter role is checked against `school.json` only at login
  (`store.js` `_activeRole`); if the admin removes the assignment, the session keeps the rights
  until logout. Check `Store.voorzitterOf(vak) === activeUser.id` in `isVoorzitterActive`.
- **n5.** The Rust session survives a webview reload (`init()` navigates to `startup` without
  `api.logout()`), so `write_user`'s `updatedBy` for the next first PIN names the previous user
  and the admin session stays live behind the login screen. Call `logout()` in `init()` (or on the
  startup render).
- **n6.** `ui/src/utils/badges.js:14-28`: a photo read that resolves after the top-bar badge was
  reused for another user (`isConnected` is still true) paints the old user's photo. Compare a
  token or `relPath` stored on the element before applying.
- **n7.** ADR-0006 "Consequences" could say plainly that `pinHash` is readable by everyone with
  folder access and a 5-digit PIN is brute-forced offline in about an hour on one core (Argon2
  m=19 MiB, t=2). Consistent with "the PIN guards the PC", but worth stating so nobody reuses a
  bank PIN; consider a hint in the first-PIN dialog.

## Triage (implementer, 2026-10-31)

| Id     | Decision                                                                                                                                                                                                                                                                                                                                                                                                          | Where                                                              |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| M1     | Fixed: `parse_name` requires ASCII and allows only ` (<digits>)` or `-<letters, digits, -, _>` after the time, so a name that passes is a plain file name; no byte slicing on non-ASCII. Tests in `names_parse_and_others_are_not_snapshots`.                                                                                                                                                                     | `snapshots.rs`                                                     |
| M2     | Fixed: the restore is a CAS update that only goes ahead while the file's stamp is still missing or wrong (else `conflict`, shown as "intussen via Maatwerk opgeslagen"); entity files get `stamp_meta` (rev = disk + 1, `updatedBy` = the admin); user files keep `pinHash`/`recoveryCodeHashes` from disk; the UI forgets the cached file. Tests `a_restore_bumps_the_rev_*`, `a_file_saved_through_maatwerk_*`. | `snapshots.rs`, `src-tauri/src/auth.rs`, `gegevens.ts`, `store.js` |
| m1     | Partly fixed: OneDrive conflict copies (`... 0815-PCNAAM.zip`) are now snapshots, so retention removes them (test). The cross-PC race itself stays (the CAS cannot see another replica): at worst two zips in one interval, thinned by retention. Documented in ADR-0006; backlog.                                                                                                                                | `snapshots.rs`, ADR-0006, backlog                                  |
| m2     | Fixed: one lock across the wait check, the check and the record (parallel calls cannot skip the wait). A restart clearing the waits is the documented design (ADR-0006).                                                                                                                                                                                                                                          | `auth.rs`                                                          |
| m3     | Fixed: the command uses `Auth::require_admin` (also checks `actief`); `recover` refuses a deactivated admin. Test `a_deactivated_admin_cannot_use_a_recovery_code`.                                                                                                                                                                                                                                               | `auth.rs`, `src-tauri/src/auth.rs`                                 |
| m4     | Fixed: closing the codes modal with the cross, Escape or a click next to it asks first while the box is unticked (`guardModalClose` with its own text).                                                                                                                                                                                                                                                           | `pin.ts`, `app.js`                                                 |
| m5     | Fixed: a snapshot or `lastAtMs` more than a day ahead does not count. Test `a_snapshot_dated_far_ahead_*`.                                                                                                                                                                                                                                                                                                        | `snapshots.rs`                                                     |
| m6     | Fixed by the tests above (restore input and `_meta`, deactivated admin). Losing the claim to a concurrent writer: backlog (needs a hook between read and CAS).                                                                                                                                                                                                                                                    | tests, backlog                                                     |
| n1, n2 | Fixed (two `println!`; "in de gegevensmap").                                                                                                                                                                                                                                                                                                                                                                      |                                                                    |
| n3     | Fixed: only "al een pincode" switches to the login dialog; other errors end the login.                                                                                                                                                                                                                                                                                                                            | `pin.ts`                                                           |
| n6     | Fixed: the top-bar badge only takes the photo of the user it still shows.                                                                                                                                                                                                                                                                                                                                         | `app.js`, `badges.js`                                              |
| n7     | Fixed: ADR-0006 states that `pinHash` is readable and a 5-digit PIN can be brute-forced offline.                                                                                                                                                                                                                                                                                                                  | ADR-0006                                                           |
| n4, n5 | Backlog.                                                                                                                                                                                                                                                                                                                                                                                                          | backlog                                                            |
