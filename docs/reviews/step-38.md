# Review: step 38, grade numbers in Rust and Cijfergemiddelden

Reviewer: fresh-context subagent, 2026-11-24. Scope: `git diff 66c6909..HEAD` on
`step/38-grade-numbers` (`97a546d`..`e23475e`, 31 commits). Checked against PLAN-2 step 38,
`docs/phase-2/step-38-numbers.md`, step-19 grade rules "Shown averages", `docs/perf.md` "Grade
numbers in Rust" and CLAUDE.md. Read only: no cargo, Vitest or e2e run (the gate runs them in
parallel).

Scope coverage: every PLAN item has a commit. 38.1 inventory (`ab1553b`) with the user's answers
A-E (`edc0541`); 38.2 `AverageFormat` / `shown_average` with `tests/shown_averages.rs` extended
to all six formats on the generated set (`97a546d`); 38.3 `maatwerk_core::numbers` and the CLI
(`271bac3`, `a9e0632`); 38.4 the setting, the admin guard and the Beheer card (`82d6ec9`,
`f7ee204`, `9db0101`); 38.5 the screens on `vak_numbers` and inventory rows #8-#20 through the
crate (`b7acd51`..`45b31e4`); 38.6 the small wins (`24e10ad`, `bae4004`); 38.7 perf
(`2b159d4`); 38.8 the before/after tables (`e23475e`).

Grade-number rule: I found no JS/TS or core code left that computes a grade number itself. A grep
of `ui/src` for `Math.round`, `toFixed`, `round0/round1` and `reduce` sums finds only layout
(bar heights, axis positions, segment widths, slider ticks), formatting of crate values
(`formatShown`, `formatFixed`), non-grade quantities (opdracht points, file sizes) and the RTTI
GEMIDDELDE rows that answer C keeps. `pctOf`, `rttiPercents`, the rapport percentages, the
question-editor totals, the PO maxima and Categorieën, and the score validity all call the crate
now. `maatwerk_core::numbers::compute` only selects, groups and counts. The Tauri handler
`data::vak_numbers` parses its arguments and calls core under `blocking`. No `tauri` in core.

The crate side is solid. `shown_average` removes the noise in billionths before cutting
(`cut_to`, `round.rs`), so 5,449999… with afkappen 2 shows 5,45, which matches the user's
900594 case. `stats_of_averages` counts fails on the shown value, so afronden 2 makes 5,45 a
fail. The 4186 pairs, 3000 random averages and 200 groups are pinned in all six formats.
Unusable values in `gemiddelden` fall back per average to afronden 1, tested in
`format.rs:87-99`.

## Blockers

None.

## Majors

**M1. Leerlingen can cache card numbers from an older data generation under the newer one, so a
colleague's change (or an own write) does not show on the cards.**
`ui/src/screens/cards/student-grades.ts:81-91`: `vakNumbers(year, subject, Store.generation())`
is awaited. Then every card's HTML is stored with `cached().set(...)`. `cached()` reads the
_current_ generation and the comment says so ("store under the current one"). Before step 38 this
was harmless, because each card read its scores from the Store cache right before it was built.
Now the HTML comes from one native result, fetched at generation G. If the generation moves while
that call or the 8 ms slices run, the result from G is stored as valid for G+1.

Failure scenario: the teacher opens Leerlingen on `school`, and the fill takes 0,3-0,9 s
(`docs/perf.md`). During the fill a colleague's score save arrives through the watcher, and
`applyExternalChange` bumps the generation to G+1. The screen refresh runs 750 ms later
(`app.js` `SCREEN_REFRESH_DELAY_MS`), or later if a modal is open. By then the old fill, not
cancelled yet, has filled the G+1 map with the old averages. The refresh renders, and
`fillStudentGrades` finds every student in `known`, so no new `vakNumbers` call is made. The
cards keep showing the old r/SE until some other data change. A search keystroke or a filter
change shows the same stale values again, because the cache exists for exactly that. The same
happens after an own write made on another screen while a hidden Leerlingen fill is still running.
`vak-numbers.ts` itself is safe (it is keyed by the generation the caller passes in). Only this
HTML cache is affected.

Fix: capture `const gen = Store.generation()` before `vakNumbers(year, subject, gen)`. Write to
the cache only while `Store.generation() === gen`, and otherwise keep the HTML only in the local
`html` map, or stop and leave it to the refresh. Add a unit test: bump the generation while the
mocked `vakNumbers` is pending, then check that a second `fillStudentGrades` asks again.

**M2. Rust/MockApi parity, and the shape of `VakNumbers`, are only checked by a manual tool.
Everything automated runs against the mirror, so a Rust-side drift would ship unnoticed.**
`ui/tests/numbers-parity.test.ts:94` is `describe.skipIf(!manifestPath)`. It runs only from
`node tools/numbers-parity.mjs`, which needs cargo and is run by hand. The command returns an
untyped `serde_json::Value` (`src-tauri/src/data.rs:225-235`), and the UI casts it
(`ui/src/bridge/tauri-api.ts:397`, `as unknown as VakNumbers`). So specta does not check the
`camelCase` field names, `Stats` / `Histogram` / `Trend` shapes or `null`s either. The e2e
(426 tests) and visual suites all use `MockApi` → `mock-numbers.ts`. The only tests on the Rust
compute path are three unit tests in `compute.rs`. A later change to `compute.rs` or `load.rs`
(or to a serde attribute) can break the real app while every gate stays green. m2 lists drifts
that exist today and that the generated fixtures do not exercise.

Fix: commit a small golden. Use `maatwerk-cli numbers` output for `tiny` at two formats (for
example a1/a1 and k0/a2) and, if they are not generated deterministically, the input files.
Then add a `cargo test` in core that compares `vak_numbers` with it, and a Vitest test (always
on) that compares `mock-numbers.ts` with the same file. Regenerating it goes through a tool, as
the other goldens do. Then CI keeps the two in step without cargo in the UI job.

## Minors

**m1. A colleague's change of the Cijfergemiddelden, or of another year's scores, does not
reach the list numbers; the Profiel can mix two formats.** `ui/src/store.js:1312-1324`:
`instellingen.json` matches no `EXTERNAL_PATTERNS` entry, so it is type `other`. The
generation does not move and `vak-numbers.ts` keeps the results in the old format until an
unrelated change. A score file of another school year is not in the UI cache any more (the cards
no longer preload every year), so its change does not move the generation either, although the
SE depends on it. Before step 38 those years were cached for upper school. The watcher polls
only the active year (`set_watch_year`), so in part this is older. In the Profiel,
`yearComparisons` (`ui/src/modals/profile/data.ts:140-163`) asks one year at a time. A year
already cached shows the old format, and a year fetched after the admin's change shows the new
one, side by side. PLAN 38.5 asks for invalidation on "a changed setting too". Fix: add
`['settings', /^instellingen\.json$/]` and have it drop `cache['instellingen.json']`, which
counts as a change. Note the other-year SE limit in `docs/reference/quirks.md` or the backlog.

**m2. Rust and the TS mirror/UI disagree on inputs the fixtures do not contain.**

- Numeric `stamklas`: `crates/maatwerk-core/src/numbers/load.rs:148-151` takes `as_str()`, so
  `"stamklas": 4` gives jaarlaag `""` (not upper school, no SE). The old card path
  (`ids.ts:24` `String(stamklas)`) and `mock-numbers.ts:167` give `"4"` (upper, SE shown). This
  is a parity break with the 0.28 behaviour on such files. Fix: treat a number as its text, as
  `id_text` does.
- `decimalen` as a float: `round.rs` `RawFormat.decimalen: u8` rejects `2.0` (serde: invalid
  type), so it becomes afronden 1. `ui/src/domain/numbers.ts:85` accepts it (`2.0 === 2`). The
  Beheer card then shows "2" while every number is shown at 1 decimal. Fix: accept whole floats
  in Rust (deserialize as `f64`, require `fract() == 0`), or reject them in `readFormat` as well.
- Settings guard: Rust compares `Option<&Value>`, so a missing `gemiddelden` differs from
  `null`, key order is ignored, and no session means refused. The mock (`mock-api.ts:1081-1102`)
  compares `JSON.stringify(x ?? null)`, so it treats missing and `null` as equal, counts key
  order as a change, and lets a write without a login through. The last point is documented,
  the first two are not.
- `check_args` limits the vak to 64 _bytes_ (`numbers.rs:54`). The mock limits it to 64
  _characters_ (`mock-api.ts:928`).

Each needs a test case in the golden of M2.

**m3. The CI visual baselines of three views were deleted on all three platforms, so the next
CI run fails by design.** `143e0de` removes `admin-instellingen`,
`modal-po-overzicht-categorieen` and `modal-profiel-cijferverloop` from
`visual-ci-chromium-win32`, `visual-ci-webkit-darwin` and `visual-ci-webkit-linux`. Per
`docs/testing.md` "Visual baselines in CI", that run writes the files but fails, and the files
must be checked and committed from the artifacts before the merge (main is always green). Not
listed in STATE's "Next action". Fix: add it there and commit the three per-platform files after
looking at them.

**m4. Opening a Profiel costs one full `vak_numbers` per school year of the student, each of
which reads every year.** `ui/src/modals/profile/data.ts:140-163` calls `vakNumbers(yr, …)` for
every year in `d.years`. For a year with any upper-school student, PTA test or upper group,
`numbers::vak_numbers` (`numbers.rs:31-40`) loads all years of the vak again. A 6th-year
student's profile on a cold cache therefore makes about 4-6 calls of ~240 ms native time (perf
doc) plus 4-6 × ~690 KB of JSON to parse. Before, the profile read each student once from the
Store cache. `docs/perf.md` does not measure `modal:profiel`. Fix: measure it at 4x. If it is
over the 0.24.1 budget, give core one call that returns several years from a single load of the
years, or an `all_years` reuse across calls in one generation.

**m5. The Groepsoverzicht takes its cells and its r/SE from different vakken.**
`ui/src/modals/group-overview/index.ts:85-92`: `yearExams` and the scores come from
`Store.getExamsSync(year)` and `getStudentScores(s.id, year)`, so from the _active_ subject. The
numbers come from `group.subject ?? active`. For an admin (no active subject) the cells are
empty, but the r and SE columns are filled. For a group of another vak, the r column belongs
to a different set of tests than the cells next to it. Fix: use one subject for both (the
group's), or keep the old rule and pass the active subject to `vakNumbers`.

## Nits

**n1.** The module doc of `crates/maatwerk-core/src/numbers/load.rs:3-5` says "the numbers never
fail on one file". A corrupt `students-<year>.json` fails the whole call (`load.rs:221`,
`read_json` → `corrupt_json`), and so does one unreadable directory entry. Either skip a corrupt
list as empty (with a log line), or change the sentence.

**n2.** Dead code after 38.5: `Store.studentYearAverage` and `Store.getAllExamsSync`
(`ui/src/store.js:854-863`, exported at `:1567-1568`) have no callers left in `ui/src` or the
tests.

**n3.** `ui/src/services/vak-numbers.ts:22` resets the cache whenever the generation passed in
_differs_. A slow caller that passes an older generation (captured before an await) drops the
newer results, and the next caller then resets again. Reset only when `generation >
cache.generation`, and do not cache a result for an older one.

**n4.** The Toetsen cards compute `stats` and `histogram` again in WASM from `grades`
(`ui/src/screens/toetsen/card-model.ts:80, 139`), although `ExamNumbers` already carries both
from Rust. That still follows the rule, because it is the crate either way, but it is twice the
work and two sources for the same number. Pass `stats` / `histogram` through `CardNumbers`.

**n5.** `vak_numbers` serializes twice (`serde_json::to_value` in `data.rs:231`, then the IPC
layer), for ~690 KB per call. Returning `tauri::ipc::Response` with the JSON text, or a typed
struct in `src-tauri` (which would also give specta the shape for M2), avoids the intermediate
`Value` tree.

**n6.** `ovShownPillHtml` (`ui/src/overview/common.ts:55`) puts `formatHint(fmt)` into `title`
without `esc`. Its input is the validated format, so it is safe today. Escape it anyway, as
`card-html.ts` `shownB` does.

**n7.** The parity runs in `step-38-numbers.md` cover r at a0/a1/k0/k1 and SE at a1/a2/k2/k0. r is never run at a2/k2 and SE never at a0/k1. The crate test covers all six, so
the risk is small. A run at a2/k1 closes the gap.
