# Review: Step 2a (fixtures, logic goldens, storage spec)

Reviewer: fresh-context subagent, 2026-10-25. Scope: `git diff step-01..HEAD` on
`step/02-safety-net` (HEAD `9dca97e`). Uncommitted 2b work in the tree (`tests/reference-harness/typst/`,
edits to `main-process.mjs`/`session.mjs`/`golden.mjs`) was not reviewed; it does not change 2a behaviour.

What I ran:

- `npm test` with `_reference/` present: 72/72 pass (all 11 "matches the reference" tests run).
- `MAATWERK_REFERENCE=/nonexistent npm test`: 57 pass, 15 skipped, 0 fail.
- `npm run golden:check`: all 11 suites `ok`.
- `node --test tests/reference-harness/shims.test.mjs`: 2/2 pass (5 verbatim blocks equal the reference).
- `bash tools/check-spdx.sh`: clean. Prettier on HEAD files: clean.
- I re-ran every suite with `fs.readdirSync` reversed (see M2), and checked that Node's `rmSync` does not
  follow junctions (scratch dir: it does not).
- I spot-checked coverage-matrix rows 2, 3, 4, 6, 7, 9, 12, 13, 15, 20, 21, 22, 23, 24, 25, 27, 28, 30, 31,
  33, 34, 35, 36, 41, 43, 44 and 47 against the golden JSON and `_reference/` source. A script confirmed
  that every case id the matrix names exists in the goldens.

Overall: the harness really runs the reference. `main.js` and `preload.js` load with only Electron faked,
`store.js` loads unchanged, and the UI helpers are extracted by AST or by a checked line range, never
retyped. The inputs exercise the branches their rules name. For example, `nterm-lo1/hi1/lo2/hi2` each
reach the intended `calcGrade` branch (I worked out raw against lo1/hi1/lo2/hi2 by hand), and
`only-invalid` gives `R: 0, T1: 0` with a null grade. Three findings are worth fixing before the
`step-02a` tag.

## Blockers

None.

## Major

### M1. `averages` golden field `calcWeightedAvg` is built by suite glue, not by any reference code path

- **Where:** `tests/reference-harness/suites/averages.mjs:137-139`, `:150`. Reference:
  `_reference/renderer/modals/groep-leerlingen.js:196-201` and `:249-255`.
- **Evidence:** the suite builds its own pairs:
  `{ grade: gl.fns.studentGrade(st, e), weging: e.weging_se ?? e.weging }`. That is the original exam's
  grade, without resits, weighted with `weging_se`. The group overview, the only caller of
  `calcWeightedAvg`, does something else:
  `{ grade: bestGradeForFamily(s, f).grade, weging: f.original.weging }`. That is the best attempt,
  weighted with `weging`. For student 1 the golden stores `calcWeightedAvg: 5.778`. The reference
  "Jaar" column would show 6.5718 (the same value as the profile `yearAvg` here). Coverage-matrix row 30
  cites `student-*`, so a port that copies this number would copy behaviour the app does not have.
  Of all the suites, this is the only place where glue logic changes the meaning of a golden value.
- **Fix:** extract the reference pair construction (`groep-leerlingen.js:196-201` as a snippet with `s`,
  `examFamilies` and the `bestGradeForFamily`/`calcWeightedAvg` closures bound), building `examFamilies`
  with the reference code at `:36-48`. Rename the field to `groupYearAvg`. The direct
  `calcWeightedAvg-direct` case can stay. Also drop or rename `ptaAvgRawHistory` (`:148`): the profile
  calls `ptaAvg` only on the resolved history (`profiel.js:58`, `:687`), so the raw-history value is not
  something the app computes.

### M2. Goldens silently depend on directory enumeration order (NTFS)

- **Where:** `_reference/main.js:163-176` (`fs:readAllJson` returns `readdirSync` order unsorted). This
  order feeds `getGroupsSync` and `getExamsSync`. The assumption is missing from the harness
  assumptions in `docs/testing.md`.
- **Evidence:** I ran every suite with `fs.readdirSync` patched to return entries in reverse. Three
  goldens change:
  - `opdrachten`: `getOpdrachtAssignments` and `-no-cards`. Student 3 is in `g-10a` and `g-9b`, both
    jaarlaag 3, and `store.js:1337-1339` takes the first match. That is `g-10a` on NTFS and `g-9b` in
    reverse order, which also changes the sort position.
  - `csv`: `group-assignment-csv` `groupsAfter` order.
  - `averages`: `student-1.yearAvg` changes in the last digit (`6.571771428571429` vs
    `6.57177142857143`) because the float summation order follows the exam order.

  On Windows/NTFS the order is stable and sorted, so `golden:check` will not flake there. But a regen on
  ext4 or APFS, or a Rust consumer whose `read_dir` order differs, gets different answers with no hint
  why. That student 3's group depends on file order is itself reference behaviour that nobody has
  written down.

- **Fix:** pin the order in the harness, the same way locale and TZ are pinned. Wrap `fs.readdirSync`
  in `main-process.mjs` to sort the way NTFS does (ordinal, case-insensitive). Add a row to "Harness
  assumptions". Record a quirk ("a student in two groups of the exam's jaarlaag gets the group whose
  file name sorts first", `store.js:1337-1339`, and the same `find` in `rapport.js` `compileRapport`
  and `toets-overzicht.js:46-51`). Add a regression check that runs one suite with reversed readdir
  and expects identical output.

### M3. The storage spec has no rows for the concurrency gaps that the Step 4 "no `.lock` files" decision depends on

- **Where:** `docs/specs/storage-spec.md` (S11-S17, S20-S27) and `tools/reference-shims/storage.test.mjs`.
  PLAN Step 4 (C3): "concurrency tests must confirm CAS suffices, otherwise stop and ask".
- **Evidence:**
  1. **CAS is not atomic across instances.** `fs:writeJson` reads the hash (`main.js:79`, shim
     `main-storage.cjs:79`) and then calls `writeFileAtomic` (`:85`). A write by another instance that
     lands between the two is overwritten without a conflict. For score files nothing closes this
     window today (no lock, S16). For other files the `.lock` closes it on one machine, and C3 removes
     that lock. No row pins this baseline.
  2. **Blind writes.** `Store.save` (`store.js:43-47`) calls `writeJson` without `cas`. It is used for
     `school.json` (`:155`), `config.json` (`:366`), the students list (`:407`) and
     `saveStudentScores` (`:586`). `rapport.js:736` writes RTTI template files the same way. These are
     last-writer-wins. `data-files.md:398` mentions it, but the executable spec has no row, so Step 4
     has no baseline for C6 ("CAS also for school.json, config.json and RTTI templates").

  The S21 race is injected only between the renderer's read and its write, so it never exercises
  window 1.

- **Fix:**
  - S37: hook `fs.renameSync` in `writeFileAtomic` so that it first writes a foreign version to the
    target, then assert that the foreign version is lost and the result is `{ok: true}`. Port: "Change:
    must conflict".
  - S38: `writeJson` without `cas` overwrites a newer foreign version. List the call sites. Port:
    "Change (C6)" for school/config/templates, and say explicitly what happens to students and
    `saveStudentScores`.
  - Optionally, S39: a partial file left by the S04/S05 direct-write fallback is read as `{error}`, so
    `update` refuses to write (ties S04 to S24).

## Minor

### m1. Junctions into `_reference/` can leak in `%TEMP%`

- **Where:** `tests/reference-harness/main-process.mjs:91-99` (startMainProcess), `:110-114` (dispose).
- **Evidence:** `%TEMP%` holds two leftovers, `maatwerk-ref-EExW35` and `maatwerk-ref-ZBEpQf` (from
  16:01-16:02, before this review). Each has `app\bin` and `app\include` junctions into `_reference/`.
  - Leak paths: `mkdtemp`, `mkdir` and `symlinkSync` run before any `try`; a killed or timed-out suite
    process never reaches `dispose`.
  - Current cleanup is safe: Node 24 `rmSync`, recursive or not, unlinks a junction without following
    it (I verified this in a scratch dir), and `dispose` unlinks the junctions first.
  - The risk is third-party cleaners or a manual Explorer delete of the leftovers.
  - None of the 2a suites needs `bin/` or `include/`.
- **Fix:** link `bin/` and `include/` only on request (`startMainProcess({ typst: true })`, for 2b).
  Wrap the setup in `try`. Sweep stale `maatwerk-ref-*` folders at harness start, unlinking junctions
  before `rmSync`.

### m2. Watcher failure paths are not in the spec

- **Where:** `_reference/sync.js:133-140` (a read error during `check` returns silently with no retry),
  `:222-238` (on an `fs.watch` `error` the watcher closes, restarts after `RESTART_WATCH_MS` = 30 s and
  relies on polling meanwhile; if `fs.watch` is unavailable it polls only), `:246-252` (a poll
  exception is logged and swallowed).
- **Evidence:** PLAN Step 4b lists "restart watch after errors", but S28-S36 cover none of these paths.
  Restarts are where events get lost and where feedback loops appear.
- **Fix:** add rows using the existing `startWatcher` stub. Make `on('error')` fire, `tick(30_000)`
  and assert that `fs.watch` was called again. Make `readFileSync` throw `EBUSY` once and assert that
  no event arrives until the next notification or poll.

### m3. Port column vs PLAN Step 4

- **Where:** `docs/specs/storage-spec.md` S04/S05, S27, S13-S15.
- **Evidence and fixes:**
  - S04 says "Keep, or fail loudly: decide in Step 4", but PLAN 4a already says "last-resort direct
    write". Align the text, or flag it as an open question in STATE.
  - S27 cites C6 for `school.json` and config but leaves out the RTTI templates that C6 also names.
  - The S13-S15 "no `.lock` (C3)" entries are correct. However, the PLAN 4a body still lists "`.lock`
    files with 10 s TTL". Note in the spec that the ADR overrides PLAN 4a, so the Step 4 implementer is
    not confused.

### m4. Small glue deviations from what the app does

- **`stats.mjs:145-146`:** the `shown` string in the `summary` epilogue retypes the template from
  `toets-overzicht.js:177`, so a change there would go unnoticed. Extract it, or drop `shown`.
- **`scoregrid.mjs:211`:** the fake `sp.dataset` stores `val` as a number; a DOM `dataset` stores a
  string. The golden shows `"val": 1.3`, where the app holds `"1.3"`. Use a string-coercing proxy, or
  note it in the case.
- **`score-writes.mjs:108`:** `result: r ?? null` turns `undefined` into `null`, which loses the
  tagged-undefined distinction that the format otherwise keeps. Use `r` (encode tags it).

### m5. `data` cases hold the scenario spec, not the folder the reference read

- **Where:** `tests/reference-harness/scenario.mjs:76-93` (`buildData`). Consumers: every suite's
  `data` case.
- **Evidence:** when it writes the folder, `buildData` adds `student_id` to every score record, writes
  a default `config.json`, and drops `undefined` fields (`weging_se: undefined` in averages). The rapport
  suite also writes a template file into `templates/...`. A Vitest or Rust consumer must reimplement
  `scenario.mjs` to rebuild the input. That defeats "the golden is the spec".
- **Fix:** have `buildData` return the written tree (`{relPath: text}`) and store that in the `data`
  case. It is small, because these scenarios are hand-built.

### m6. "Every best-attempt implementation" is only tie-tested for the Store functions

- **Where:** coverage-matrix rows 24-25 vs `business-rules.md` 5.2 (five implementations).
- **Evidence:** `student-2` (tie) runs only `resolveBestAttempts` and `computeBestGradeMap`. Neither
  `bestGradeForFamily` (group overview) nor the profile `yearAvg` sees a tie or a worse resit. The
  averages suite has one family, and student 1's resit is better.
- **Fix:** in `averages`, add students with a tie and with a worse resit on the `nat-w1` family.

### m7. Row 35 ("cijfer onder", grade 5.45) does not hit the binary x.x5 edge

- **Where:** `tests/reference-harness/suites/opdrachten.mjs:54-66`.
- **Evidence:** students 1 and 2 give grades 5.4496 and 5.4505, which are clearly below and above the
  boundary. Neither is a computed grade that is exactly 5.45 or 5.4499999… in floating point, where
  `Math.round(g * 10) / 10` (`store.js:1329`) is the interesting step. For example, 44.5 of 90 points
  with n = 1 is computed as 1 + 44.5/90·9.
- **Fix:** add a student whose `calcGrade` result lands on the float edge, and record its exact value.

## Nits

- **n1.** `tests/reference-harness/golden.mjs:2` points to `tests/golden/README.md`, which does not
  exist. Point it to `docs/testing.md` instead.
- **n2.** `docs/testing.md` "Golden format" leaves out the `$map` / `$set` tags that `encode` can emit
  (`golden.mjs:28-29`). No golden uses them yet.
- **n3.** In `scoregrid.mjs:196-200`, `grid-one-row` uses 12 columns, but the layout for N = 1 is
  N + 10 = 11. It is harmless, but it is not the reference shape.
- **n4.** `slimEntry` in `attempts.mjs:86-93` drops the grade that `resolveBestAttempts` compared,
  because history entries carry none. Storing `Store.calcResults(...).grade` next to each entry would
  make the case self-explanatory.
- **n5.** `.gitattributes` relies on auto-detection for `tools/fixtures/assets/foto.jpg`. Add `*.jpg
binary` for symmetry with `*.png`.
- **n6.** The fixture names promise odd and even page counts (`long-odd` 9 vragen, `long-even` 4,
  `generate.mjs:364-367`), but nothing checks the counts until 2b. Make sure 2b asserts them.

## Answers to the focus questions

1. **Reference behaviour:** yes, except M1, which is suite glue that changes meaning, and the small
   glue items in m4. No case I checked was vacuous for its rule.
2. **Snippet ranges and free variables:** all of the following match the reference and are bound the
   way the app binds them:
   - `toets-overzicht.js` 39-158, 171-176, 800-802
   - `groep-leerlingen.js` 57-71
   - `leerling-edit.js` 250-269
   - `groep-edit.js` 483-545, 605-629, 641-653
   - `opdrachten-genereren.js` 443-454
   - `computeRowStatus` (gridData/exam), the spinner `set` (step 0.1, min 0, max 3, as in
     `toets-edit.js:122`), and `compileRapport` (real `readJson`, captured `renderRapportPdf`).

   The exception is the `calcWeightedAvg` pairs (M1).

3. **Determinism:** the clock, TZ and default collation are pinned and every suite runs in its own
   process. Directory order is not pinned (M2). Line endings are safe: `_reference` is checked out with
   CRLF, the extractor and shim generator split on `\r?\n`, and the goldens are LF through
   `.gitattributes`. The storage tests use mocked timers and size-changing writes, so they are not
   sensitive to mtime granularity. I found no flakes in two full runs. Junction cleanup cannot delete
   reference files through Node, but leaks happen (m1).
4. **Storage spec:** S01-S36 match `sync.js`, `main.js` and `store.js` as written, and the shims are
   verbatim. Missing: the cross-instance CAS window and blind writes (M3), and the watcher error and
   restart paths (m2). The Port column is consistent with the ADR decisions, with the small mismatches
   in m3.
5. **Shims:** verbatim. `shims.test.mjs` passes and checks 5 blocks byte for byte.
6. **Fixtures:** deterministic (mulberry32 with a fixed seed, `Date.UTC` base, sorted tree hash, and a
   manifest checked in `npm test`) and synthetic. Every PLAN 2a edge case is present.
7. **CI:** `npm test` passes without `_reference/` (15 skips) and with it (72 pass).

## Verdict

Good foundation. The harness runs the real code, the goldens match the reference byte for byte, and
the storage spec is executable and verbatim. Fix M1 (one misleading golden field), M2 (pin and document
readdir order) and M3 (add the CAS-race and blind-write rows that Step 4 needs), then tag `step-02a`.
The minors can be done in 2b or tracked in STATE.

## Triage (implementer, 2026-10-26)

| Finding | Decision | Change                                                                                                                                                                                                                                                                                       |
| ------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1      | Fixed    | `averages` now runs the reference families (`groep-leerlingen.js:31-47`) and "Jaar" column (`:197-201`) as `groupYearAvg`; `ptaAvgRawHistory` and the glue-built pairs are gone; fields renamed `profileYearAvg`/`profilePtaAvg`; new `examFamilies` case.                                   |
| M2      | Fixed    | `main.js` sees `readdirSync` in NTFS order (`main-process.mjs` `ntfsOrder`); harness assumption row; quirk B31; `harness.test.mjs` re-runs opdrachten, csv and averages with `MAATWERK_READDIR_REVERSE=1` and expects identical goldens. Goldens unchanged by the pin itself.                |
| M3      | Fixed    | Rows S37 (cross-instance CAS window, scores and non-scores) and S38 (writes without `cas`, call sites listed). S39 as proposed was folded into S24's wording (a partial file from S04/S05 is "unreadable"). The reviewer's `main.js:79/:85` are shim lines; the spec cites `main.js:92/:98`. |
| m1      | Fixed    | Junctions only with `startMainProcess({ typst: true })` (2b); setup inside `try`; stale `maatwerk-ref-*` folders older than a day are swept (junctions first). The two leftovers were removed by hand.                                                                                       |
| m2      | Fixed    | Rows S39 (`fs.watch` error: close, poll, restart after 30 s) and S40 (`EBUSY` during a check: no event, no retry timer).                                                                                                                                                                     |
| m3      | Fixed    | S04 "Keep (PLAN 4a)", S27 names the RTTI templates, the spec says ADR-0002/C3 overrides the `.lock` text in PLAN 4a.                                                                                                                                                                         |
| m4      | Fixed    | `shown` dropped from the overview summary; spinner `dataset` stores strings; `score-writes` keeps `undefined` results.                                                                                                                                                                       |
| m5      | Fixed    | `data` cases hold `{ files: { relPath: text } }` read back from the folder the reference used (`scenario.mjs` `readTree`).                                                                                                                                                                   |
| m6      | Fixed    | `averages` students 6 (tie) and 7 (worse resit) on the `nat-w1` family.                                                                                                                                                                                                                      |
| m7      | Fixed    | `opdrachten` `getOpdrachtAssignments-exact-boundary`: 44,5 of 90 gives exactly 5,45, which rounds to 5,5 and gets no card.                                                                                                                                                                   |
| n1-n3   | Fixed    | Comment points to `docs/testing.md`; `$map`/`$set` documented; `grid-one-row` uses the N + 10 = 11 columns.                                                                                                                                                                                  |
| n4      | Backlog  | `docs/backlog.md`.                                                                                                                                                                                                                                                                           |
| n5      | Fixed    | `*.jpg`/`*.jpeg binary` in `.gitattributes`.                                                                                                                                                                                                                                                 |
| n6      | Fixed    | 2b goldens pin the page counts (`opdracht-long-odd` 3 pages; `batch-duplex` 16 pages with blanks at 4 and 10).                                                                                                                                                                               |

Gate after the fixes: `npm test` 121/121, `npm run golden:check` and `npm run golden:typst -- --check` clean.
