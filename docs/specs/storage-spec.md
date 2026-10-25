# Storage and sync spec (reference app)

Executable spec of how the reference app reads, writes, locks and watches the shared `data/`
folder. Each row is one test in `tools/reference-shims/storage.test.mjs`, which runs in CI against
verbatim copies of the reference code in `tools/reference-shims/` (`sync.cjs`: all of
`sync.js`; `main-storage.cjs`: `main.js:31-48, 54-121, 179-205`; `store-cas.cjs`:
`renderer/store.js:60-123`). `tests/reference-harness/shims.test.mjs` checks the copies against
`_reference/` when it is present.

The Rust storage layer (Step 4) must pass the same table, except where a Step 1 decision changes
the behaviour (column "Port"). "Keep" means the port must behave the same. Times are the
reference constants: lock TTL 10 s, debounce 500 ms, flush 100 ms, poll 20 s, parse retry 1 s.

Related: `docs/reference/data-files.md` (Writes and concurrency, Watcher), `quirks.md`.

## Atomic write and hashing (`sync.js`)

| Id  | Behaviour                                                                                                                       | Port                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| S01 | `writeFileAtomic` writes the content; no temp file is left behind.                                                              | Keep                                    |
| S02 | Missing parent folders are created.                                                                                             | Keep                                    |
| S03 | A rename failing with `EPERM`, `EBUSY` or `EACCES` is retried (sleep 30, 60, ... ms).                                           | Keep (Windows sharing violations)       |
| S04 | After 6 failed renames the temp file is removed and the target is written directly.                                            | Keep, or fail loudly: decide in Step 4  |
| S05 | Any other rename error falls back to a direct write immediately.                                                                | As S04                                  |
| S06 | The temp file is `<target>.<pid>.tmp` in the same folder.                                                                       | Same folder required; name may change   |
| S07 | `hashContent` = SHA-1 hex of the bytes. `readWithHash` returns null for a missing file and throws on other errors.               | Keep (CAS hash is not stored anywhere)  |

## IPC handlers (`main.js`)

| Id  | Behaviour                                                                                                                                         | Port                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| S08 | `fs:readJson`: missing -> `null`, corrupt -> `null` (logged), valid -> parsed.                                                                    | Change: distinguish missing from corrupt |
| S09 | `fs:readJsonVersioned`: missing -> `{data: null, hash: null}`, corrupt -> `{error}`, valid -> `{data, hash}`.                                     | Keep                                     |
| S10 | `fs:writeJson` writes `JSON.stringify(data, null, 2)`, no trailing newline, and returns `{ok: true, hash}` of that text.                           | Keep until the v2 format (Step 7)        |
| S11 | CAS: `expectedHash` equal to the current hash writes; otherwise `{ok: false, reason: 'conflict'}` and the file is untouched.                      | Keep                                     |
| S12 | CAS with `expectedHash` null or absent means the file must not exist yet.                                                                         | Keep                                     |
| S13 | A `.lock` younger than 10 s blocks writes and deletes of non-score files: `{ok: false, reason: 'locked'}`; the foreign lock is left in place.      | Change: no `.lock` files (C3)            |
| S14 | A `.lock` whose mtime is 10 s or older is removed and the write goes ahead.                                                                       | Change: no `.lock` files (C3)            |
| S15 | The own lock is released after the write, also after a CAS conflict or a write error (`{ok: false, reason: <message>}`).                          | Change: no `.lock` files (C3)            |
| S16 | Score files (relPath contains `/scores/`) never take or honour a lock.                                                                            | Keep (no lock at all)                    |
| S17 | Quirk: `scores/x.json` at the top level has no leading `/` and is treated as a non-score file.                                                    | Moot without locks                       |
| S18 | Own writes and deletes are reported to the watcher (`noteWrite(rel, text)`, `noteDelete(rel)`), including a delete of a missing file.             | Keep                                     |
| S19 | `fs:deleteFile` removes the file; a missing file still returns `{ok: true}`.                                                                      | Keep                                     |

## Compare-and-swap in the renderer (`store.js` `update`, `saveEntity`)

| Id  | Behaviour                                                                                                                                                                  | Port                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| S20 | `update(rel, mutator, fallback)`: the mutator gets `(onDisk ?? fallback(), onDisk)`; the result is written with `{cas: true, expectedHash}` from the same read.            | Keep (moves to Rust)                          |
| S21 | A conflict re-reads the file and re-applies the mutator, so a concurrent change by another instance is kept.                                                               | Keep                                          |
| S22 | After 5 conflicts: `Error('Save failed for <rel>: conflict')`.                                                                                                             | Keep (typed error)                            |
| S23 | Other failures (e.g. `locked`) are not retried: `Error('Save failed for <rel>: <reason>')`.                                                                                | Keep (typed error)                            |
| S24 | An unreadable file is never overwritten: `Error('Bestand <rel> is onleesbaar: <msg>')`.                                                                                    | Keep                                          |
| S25 | Updates of one file are serialised; a throwing mutator aborts only its own write.                                                                                          | Keep                                          |
| S26 | `saveEntity` stamps `_meta`: rev = disk rev + 1 (legacy file without `_meta` counts as 0); `createdBy/At` kept from disk (null on a legacy file); `updatedBy/At` = now.     | Keep                                          |
| S27 | `saveEntity` with a stale `baseRev` throws `code: 'conflict'` with the other user's `updatedBy`; `force` overwrites; a new file accepts any `baseRev`.                      | Keep; also for `school.json`, config (C6)     |

## Watcher (`sync.js` `createWatcher`)

Driven with mocked timers and a stubbed `fs.watch`, so each notification is explicit.

| Id  | Behaviour                                                                                                                                                                           | Port                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| S28 | An external add is reported 500 ms (debounce) + 100 ms (flush) after the notification, as `{relPath, kind: 'added', meta}` with the file's `_meta`.                                  | Keep (timings may be tuned)            |
| S29 | Changes and deletes are reported; `meta` is null for arrays, for JSON without `_meta` and for `.typ` files.                                                                          | Keep                                   |
| S30 | Own writes (`noteWrite`) and deletes (`noteDelete`) are never reported, also not by the poll.                                                                                       | Keep                                   |
| S31 | Ignored: top-level `fotos/`, `bak/`, `templates/`, `temp/`; files starting with `_preview_`; anything but `.json`/`.typ`. Nested folders with those names are not ignored.           | Keep                                   |
| S32 | The poll (every 20 s) finds changes that `fs.watch` missed, but only outside year folders and in the active year (`config.json`). An `fs.watch` event for another year is reported. | Change: active year per teacher (C7)   |
| S33 | The poll reports deletes of known files in scope only.                                                                                                                              | As S32                                 |
| S34 | Quirk: the first touch of a file with unchanged content is reported as `changed` (no hash known yet); later touches are not.                                                         | Fix allowed (spurious refresh only)    |
| S35 | Unparsable JSON (a file still syncing) is skipped and checked once more after 1 s; if still unparsable, it waits for the next event or poll.                                          | Keep                                   |
| S36 | Notifications within the debounce window give one check per file; checks within 100 ms of the first emit are delivered as one batch.                                                | Keep                                   |
