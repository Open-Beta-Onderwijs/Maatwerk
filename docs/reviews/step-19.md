# Review: step 19 (Domain logic in Rust, WebAssembly for the UI)

Scope: `2542e41..HEAD` (branch `step/19-domain-core`), 6 commits, 75 files (+5204/-756).
Reviewer: fresh-context subagent, checklist PLAN.md Appendix C. Source of truth:
`docs/phase-2/step-19-grade-rules.md` section 6. I read the code, not the commit messages or STATE,
as evidence. Numbers marked "wasm" were run through the real `maatwerk_grades_wasm.wasm` with the
memory protocol of `core.ts` (one-off scripts in my temp folder; nothing in the repo changed).

## The 23 decisions

| #   | Decision (short)         | Verdict | Evidence                                                                                                                                                                                                                  |
| --- | ------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Formula, min/max form    | holds   | `grade.rs:14-27`; the approved table and the reference's sweep (`reference_goldens.rs:54-69`) pass.                                                                                                                       |
| 2   | Rounded grade everywhere | holds   | `Results.grade` is rounded (`grade.rs:171,183`) and is the only input to mean, SD, year and SE average, best attempt, histogram, % onvoldoende. Unrounded year averages only reach `formatGrade`, pills and bar heights.  |
| 3   | Exact half-up everywhere | partly  | `round.rs` is right, but the rapport template rounds its own percentages: 23/40 prints 57%, the core says 58% (**M2**). JS point sums without `clean` (**m4**).                                                           |
| 4   | N and empty              | partly  | Rules right in grade, RTTI, overview, vraaganalyse, class average. But the rapport pie "Verdeling RTTI deze toets" now changes with what the student left empty (**M1**).                                                 |
| 5   | Invalid, bonus, diag     | holds   | `grade.rs:139-165`, `rtti.rs:55-79`, `rapport.rs:21-40`; every approved row checked. `assembleVragen` shows invalid as `N / max` and earns 0.                                                                             |
| 6   | Override; override-only  | holds   | `rapport.ts:316-317,374,377`, template branch `rapport.typ:699-722`; test `decision_6_...`.                                                                                                                               |
| 7   | RTTI pooled, Gem. best   | holds   | `profiel.js:868-873`: bars from `allResults` (every attempt), Gem. from `history` (best attempts) via `pooledRtti`. `se` = `exam.type === 'pta'` over all years. Overview pooled through `pooledRtti`/`rttiByGradeGroup`. |
| 8   | Best attempt             | holds   | `attempts.rs:74-85,136-141`; all screens go through it. Tie: earliest, tested.                                                                                                                                            |
| 9   | Year average             | partly  | Formula right (`averages.rs:25-30`), but the screens give it different exam lists, so one student has two year averages: fixture student 900001, profile 4,6, group 6,5 (**M4**).                                         |
| 10  | SE average, original's w | holds   | `averages.rs:34-48`. Wasm: only the resit, original `weging_se` 3, resit 9, plus 6,0 (w1): 7,5. `getAllExamsSync` is complete after `getStudentHistory` has loaded every year. Corner case same id in two years: **m1**.  |
| 11  | Mean and SD by n         | holds   | `stats.rs:11-41`; grid `scoregrid.ts:214-227` shows `0,0` for one student (test at `scoregrid.test.ts:145`).                                                                                                              |
| 12  | Populations; B4, B16     | partly  | B4 (`scoregrid.ts:185,194`) and B16 (`profiel.js:674-678`) right. Year population per screen: **M4**. Grid and card average different populations of points: **m5**.                                                      |
| 13  | Trend                    | holds   | `trend.rs:36-69`, all approved boundaries tested. Core and CLI only; the arrow is F-08 in step 27 (PLAN-2). Tie on volgnummer: **m7**.                                                                                    |
| 14  | Charts                   | holds   | Bins on rounded grades in integer tenths (`stats.rs:59-65`): half-open, 18 and 10 bins, 10,0 in the last. QUARTILE.INC. `≥8` in Rust and `utils/grades.ts:10`. Rapport's 12 bins are half-open on rounded `grade_num`.    |
| 15  | Rapport numbers          | partly  | Class % from unrounded and bracket from rounded %: right. "An I row when the test has I questions": no row when the student left the I questions empty, pinned by a test, decided by nobody (**M3**).                     |
| 16  | Ranking                  | holds   | `rapport.rs:92-108` gives 2+3 for 25, 3+3 for 30, same formula as the old template. Texts changed. Stale comment left: **n1**.                                                                                            |
| 17  | Group of a student; B14  | holds   | `groups.rs:7-38`; jaarlaag `3` and `"3"` both read as `"3"`. Used by rapport, opdrachten, overview. `evalExam` in overview. Old rule left as dead code: **m3**.                                                           |
| 18  | Unknown RTTI tag         | holds   | `grade.rs:79-87`; warning at `validate.rs:579`.                                                                                                                                                                           |
| 19  | PO                       | holds   | `grade.rs:159-164`, `model.rs:143`. Grade function is step 21a, as decided.                                                                                                                                               |
| 20  | Architecture             | partly  | Crate, wasm, ADR and CSP as decided; the rapport template still does its own arithmetic (**M2**, **m2**).                                                                                                                 |
| 21  | Averages of averages     | holds   | `averages.rs:52-61`; used by group card (`groepen.js:222`), jaarlaag (`profiel.js:670,686`), group footer (`groep-leerlingen.js:192-197`).                                                                                |
| 22  | Bad weging               | partly  | Negative and `weging`-text right. `weging_se: "x"` with `weging: 3` counts as 3, not 1, while Gegevenscontrole says "telt als 1" (**M5**).                                                                                |
| 23  | Unknown question kind    | partly  | Core counts it as normal, but `qKind` passes the unknown kind on and `toetsen.js` leaves it out: card 10p where the grade uses 20 (**M6**).                                                                               |

## Summary

| Severity | Count |
| -------- | ----- |
| Blocker  | 0     |
| Major    | 8     |
| Minor    | 10    |
| Nit      | 8     |

Gate on this branch: `cargo fmt --check`, `clippy -D warnings`, `cargo test --workspace`,
`npm run lint`, `typecheck`, `npm test`, `npm run test:e2e` (220 passed, Chromium only),
`npm run licenses`, `cargo deny check`, `notices --check`, `check-spdx.sh`: all green. Not run:
WebKit e2e (needs macOS or Linux CI).

Checked and found correct:

- **`round.rs`:** half-up towards +infinity, noise absorbed under 5e-10 (6,2499999995 gives 6,3;
  6,2499999994 gives 6,2), no negative zero (`-0.04` gives 0). `is_fail` on the rounded value.
  Real grades, means and percentages are never that close to a half without being one, so the
  nano step cannot move a real number. Overflow only above 1e29: **n2**.
- **`formatFixed`:** the only caller with other digits passes 0 or 1; the `toFixed` branch is
  unused. `parseGradeInput` goes through `round1`.
- **Histogram arithmetic (`stats.rs:59-65`):** `div_euclid` with clamp, 1,0 in bin 0, 5,4 in bin 8
  and 5,5 in bin 9 (half steps); 1,0 in 0, 5,4 in 4, 5,5 in 5, 10,0 in 9 (whole steps). The UI only
  passes 0,5 or 1 (`toets-overzicht.js:324-325,744`), so `step = 0` (a panic in `div_euclid`) is
  not reachable.
- **WASM ABI:** alloc and dealloc use the same layout (`max(1)`, align 1) for every buffer. Views
  are made after each `alloc`, the reply is read after `call`. 200,000 non-ASCII question ids and
  200 repeated big calls ran fine; memory stays at its high-water mark, no leak. `undefined` and
  `NaN` become `null`; an exam's `n_term: NaN` reads as 1, `max_points: null` as 0.
- **What throws but cannot be reached:** `stats([NaN])`, `boxStats(undefined)`, `histogram(x,
undefined)` all throw, but every caller filters nulls, and `computeBestGradeMap` only holds
  non-null grades, so the removed `.filter` at `toetsen.js:127` is safe. `questionScores: null`
  throws but `getStudentHistory` guards it with `?? {}`.
- **Top-level await:** no `DOMContentLoaded` listener anywhere that could fire before the module
  body runs. Build target es2022. The module is one chunk (`format-*.js`, 455 kB) shared by the main
  window and the editor; the pdf viewer does not load it. e2e boots both on Chromium.
- **CI and build:** every job that runs Vite runs `rustup toolchain install` first, which installs
  `wasm32-unknown-unknown` from `rust-toolchain.toml`; `build:mac` adds its targets on top. Separate
  `target/grades-wasm` avoids a deadlock with tauri's cargo. `--locked` matches the updated
  `Cargo.lock`. No new third-party crate. CSP test tightened, not weakened.
- **B14 and `qStatsOf`:** a resit's `q1` is another question with the same id (`herkansing.js:141`),
  and `questionStats` pools by id. But Vraaganalyse and RTTI-analyse are disabled for the summary
  (`toets-overzicht.js:295`), so such a pool never shows. Grade, Resultaten and histogram read each
  attempt with its own `evalExam`.
- **Goldens:** `rapport-valid` changes only p12 and p14, only the ranking text and its hash.
  Justified by decision 16; the commit says the visual check is still the user's.
- **Data safety:** no write path changed except `berekend`, which is the same rounded value as
  before. `validate` only adds warnings and repairs nothing. **Security:** `innerHTML` additions
  are numbers from the core; no new untrusted string reaches HTML. CSP adds only
  `'wasm-unsafe-eval'` (**n7**).

## Major

### M1. The rapport's "Verdeling RTTI deze toets" pie now depends on what the student left empty

`crates/maatwerk-core/assets/templates/rapport.typ:373-384,387-440,716-721`,
`ui/src/domain/rapport.ts:376`.

The template replaced its own totals with `student.rtti_points`. That is right for the bar chart
("Jouw RTTI-scores"), but the pie describes **the test**, and `rtti_points.max` leaves out empty
questions (decision 4).

Failure, from the approved table: 4 questions of 10, R T1 T2 I, scores 8, 6, empty, empty. Wasm
gives `R {8, 10}`, `T1 {6, 10}`, `T2 {0, 0}`, `I {0, 0}`. The pie reads **R 50%, T1 50%** for a test
that is 25% each, and two students in one class get different "verdeling deze toets". Before this
step the pie used every normal question's maximum.

The test cannot catch it: `with_core_fields` (`tests/typst_rapport.rs:36-69`) rebuilds `rtti_points`
from `vragen` and counts a missing score as `N`, 0 of its max, so empty never occurs in any golden.

Fix: give the template the test's maxima separately (from `calcResults(exam, {})`-like data in
`exam_info`, e.g. `rtti_max`) and draw the pie from those. Add a golden or text test with an empty
question.

### M2. The rapport template still calculates percentages, and they differ from the core (decisions 3, 20)

`rapport.typ:699` (`calc.round(student.score / student.max_score * 100)`), `:485` (bars), `:433`
(pie).

`23 / 40 * 100` is `57.49999999999999` in a double, so Typst rounds to 57. `round0` in the core says
58, and so do the score grid, the overview and the advice row on the same rapport.

Failure: a student with 23/40 reads "en had dus **57%** goed", and a category with 23/40 shows a bar
of **57%** while its advice row says "23 / 40 (**58%**)". Exact-half percentages that differ, half points,
max up to 200 (16 cases): 11,5/20, 23/40, 34,5/60, 46/80, 14,5/100, 28,5/100, 56,5/100, 57,5/100,
... This is exactly the bug of decision 3's finding 2.

Arithmetic evidence: I ran the same double expressions and `round0` from the wasm; I did not compile
a Typst page for it.

Fix: pass `score_pct` and per-category percentages from the core in `data.json`, and print those.
Section 1 of the rules lists the rapport's numbers as going into the core.

### M3. A student who leaves a category empty loses its advice row, and the level can flip (decisions 4, 15)

`ui/src/domain/rapport.ts:209-210`, pinned by `ui/tests/domain/rapport.test.ts` ("decision 4: an
empty question is left out of the advice totals").

Decision 15 says "an I row when the test has I questions". The code gives a row only when the
student entered an I question. Decision 4 says empty is left out of RTTI. Both decisions touch this
case and they do not agree; the implementer chose without asking, and STATE says "never change a
number or rule in step 19 without asking".

Failure: T1 questions of 10, 10, 10, a student scores 8 and leaves two empty.

| Before step 19                        | Now                                   |
| ------------------------------------- | ------------------------------------- |
| `8 / 30 (27%)`, advice level **laag** | `8 / 10 (80%)`, advice level **hoog** |

A student who leaves all T2 empty goes from `0 / 10 (0%)` with the "laag" advice to no row at all.
`docs/phase-2/step-19-before-after.md` does not mention this.

Fix: **ask the user** (this is a teacher's choice: leave out as now, or show the row and count empty
as 0 in the advice table). Then write the answer into section 6.

### M4. One student, one school year, two year averages: each screen passes its own exam list (decisions 9, 12)

`ui/src/modals/profiel.js:638-640,657,667` (every exam of the year), against
`ui/src/modals/groep-leerlingen.js:34-36,156,193` and `ui/src/screens/groepen.js:207-210,223`
(jaarlaag of the group, with a volgnummer). `maatwerk-cli stats` uses the profile's list.

The rules say "over the year's tests with a grade". Moving the formula to Rust kept this difference;
the before/after table compares each screen with its own old self, so it cannot show it.

Failure, fixture `school`, 2025-2026, wasm, shown year average per student and group:

| Vak         | Same | Different | Example                                   |
| ----------- | ---- | --------- | ----------------------------------------- |
| nat         | 134  | 500       | 900001 in 1a nat: profile 4,6, group 6,5  |
| bio         | 134  | 500       | 900001 in 1a biol: profile 3,2, group `—` |
| schk and wi | 134  | 500       | as bio                                    |

The fixture exaggerates (synthetic: students have scores on tests of other jaarlagen). In real data
it needs a grade on a test outside the filter: a student with 6,0 on a jaarlaag 3 test and 8,0 on a
jaarlaag 4 test (a vervroegd vak) has 7,0 on the profile and 6,0 in the group overview; a test without
a volgnummer has the same effect. The jaarlaag average bar on the profile uses the wide list and
the group card the narrow one, so they differ as well. Pass/fail can change.

Not new in step 19: the reference has the same split. But this is the step that promises one number
per screen, and the trend arrow (F-08) has to pick a list too.

Fix: **ask the user** which list is "the year's tests", then one helper (in the domain layer or
core) for all screens and the CLI, with a test that a student's profile and group numbers agree.

### M5. Decision 22: `weging_se` that is not a number falls back to `weging`, not to 1

`crates/maatwerk-grades/src/model.rs:156-159` (with `:118-119`); `validate.rs:550`.

`opt_number` turns text into `None`, so `weging_se: "x"` looks like absent and takes `weging`.
Decision 22: "not a number counts as 1". Gegevenscontrole tells the teacher "`weging_se "x"` is geen
getal: telt als 1". The test `a_bad_weging_follows_decision_22` only covers `weging`.

Failure, wasm: PTA 6,0 with `weging: 3, weging_se: "x"`, PTA 8,0 with weight 1: SE average **6,5**;
by the decision and the warning **7,0**.

Fix: keep "absent or null" apart from "present but not a number" for `weging_se` (and return 1 for
the second), with a test.

### M6. Decision 23: an unknown question kind is normal in the core, but not on the toets card

`ui/src/domain/grades.ts:10-12` (`qKind` returns the raw kind), `ui/src/screens/toetsen.js:75,237,248,251`,
`ui/src/screens/scores.js:929,951`.

Failure, wasm: normal 10 and `kind: "raar"` 10, scores 8 and 6. Core: 14 / 20, grade 7,3. Card:
`normalMax` **10**, "10p", no R/T1 line for it, while the same card's stats average 14 points. The
grid header styles the column as a special question. The score is real, and the number the teacher
sees next to it is wrong.

Fix: `qKind` returns `'normal'` for anything but `bonus` and `diag`, as `Question::kind` does; better,
take `normalMax` and `bonusMax` from the core so there is no second sum (see **m4**).

### M7. Rapport generation blocks the UI for seconds: quadratic JSON calls

`ui/src/domain/rapport.ts:89` inside `assembleVragen`, called per student at `:363`.

`classQuestion(q, allQuestionScores)` runs per student per question, and each call serialises every
student's scores. It runs synchronously on the UI thread, before Typst. Timed through the real wasm
on the `school` fixture (questions inflated to 28; an exam there has 7):

| Students in jaarlaag | Questions | Calls  | Time   |
| -------------------- | --------- | ------ | ------ |
| 30                   | 28        | 840    | 0,18 s |
| 100                  | 28        | 2 800  | 2,0 s  |
| 200                  | 28        | 5 600  | 7,9 s  |
| 572                  | 28        | 16 016 | 66,8 s |
| 572                  | 7         | 4 004  | 3,5 s  |

The old loop did the same 200 x 28 x 200 in plain JS in milliseconds. A jaarlaag of 200 is normal,
and the spinner set just before cannot paint while this runs.

Fix: one line of structure: compute `classQuestion` once per question before the student loop and
pass the results into `assembleVragen`. The class figure is the same for every student. Add a
timing or call-count test.

### M8. Files that used to read now make a screen throw

`crates/maatwerk-grades/src/model.rs:5-7` promises tolerant reading, and `validate` reports these
files, but each now takes down the screen instead of that one value. Wasm results:

| Input                                                           | Before                | Now                                                |
| --------------------------------------------------------------- | --------------------- | -------------------------------------------------- |
| Question without `id` (`model.rs:80-81`)                        | question has no score | `missing field id`                                 |
| `scores: {e: 5}` (`model.rs:212`)                               | no scores             | `invalid type: integer, expected a map`            |
| `overrides: {e: 6.5}` (`model.rs:214`)                          | no override           | `invalid type: float, expected struct`             |
| Advice file `{laag_midden: 40}` or strings (`rapport.rs:43-47`) | bracket `hoog`        | `missing field midden_hoog`, no rapport for anyone |

Effect: that exam's card shows no statistics (`toetsen.js:410`, the rejection is swallowed by
`allSettled` at `:460`); `fillGroupGradeStats` stops at that group, so the later group cards stay
empty (`groepen.js:232-233`); the profile's charts stop, and the rapport shows an error for the whole
class. The app itself never writes such files, so this needs a hand-edited or damaged file: run
`validate-data` on the copy of the real data to see whether it matters today.

Fix: `#[serde(default)]` on `id`; a tolerant map for `scores` and `overrides` that skips non-objects;
`Grenzen` per field with the default 40/70; tests in `crates/maatwerk-grades-wasm`.
`questions: [null]` and `questions: "x"` threw before too: not a regression.

## Minor

### m1. Family key and parent lookup ignore the school year

`crates/maatwerk-grades/src/attempts.rs:116-121`, `averages.rs:41`. An exam id that occurs in two
years becomes one family. Wasm: `x` in 2024-2025 (4,6) and `x` in 2025-2026 (8,2), both PTA: only
one counts, SE **8,2**. The old code passed both through: 6,4. Ids carry the year or are opaque, so
this needs a hand-made file; but it is a regression. Fix: key on `(academic_year, id)`, and look up
the parent in the same year first.

### m2. The rapport histogram is still a copy in Typst

`rapport.typ:546-577`. Section 1 lists it to go into the core. It is correct today (half-open on
rounded `grade_num`), so this is duplication, not a wrong number. Fix with **M2**: pass bins from
the core. The UI's 18 bins and the rapport's 12 stay different by design.

### m3. Dead code of the old rules

`Store.getStudentGroup` (`store.js:620-623,1321`) is the old "first group that holds the student"
rule of decision 17, with no caller left. Also unused: `Store.calcGrade` (`store.js:1332`), dispatch
`gradeGroupLabels` (`maatwerk-grades-wasm/src/lib.rs:118`; `utils/grades.ts:10` keeps its own copy of
the labels). Delete them; the first is what STATE's "delete the JS copies" means.

### m4. JS point totals: no noise removal, no comma (decision 3, B5)

`toetsen.js:75-76,236-239,247-252`: `reduce` over `max_points`, printed raw. `toets-overzicht.js:216`:
`${res.normalMax}`. A maximum of 39,5 shows as `39.5` here and `39,5` in the grid; max values of
0,1 and 0,2 would show `0.30000000000000004p`. Fix: use `normalMax`/`bonusMax` from the core and
`formatNumber`.

### m5. Grid and card average the points over different students

`scoregrid.ts:190-195` takes every row with a Totaal, `toetsen.js:82-85` only students with a grade.
A row with only invalid values, or only a diag score, has Totaal `0 / 40` and no grade. Rows 20 and
such a row: grid 10,0 / 40, card 20,0. Fix: skip rows without a grade in the grid, or ask.

### m6. The other screens: whole exams through JSON on every call

Timed as M7, 28 questions: Toetsen list 269 ms (old-style loop 5 ms), 100 profile peers `yearAverage`
86 ms and `seAverage` 123 ms, group overview 44 ms. Acceptable today, but `Store.getAllExamsSync()`
copies every exam of every year per student (`groep-leerlingen.js:63`, `profiel.js:683`), and each
call sends question `section`, `number`, `title` and more that the rules never read, on the UI
thread. The STATE item "measure the grid ... a batch call if needed" has no result written down.
Fix: send only the fields the rules use, compute `allExams` once.

### m7. Trend: a tie on volgnummer is decided by file order

`trend.rs:59`: `max_by` takes the last of equals. Wasm: two tests with volgnummer 1, 9,0 and 5,0:
`strongUp` or `strongDown` depending on the file order. Volgnummer is unique per jaarlaag only, so a
tie comes as soon as the list spans two jaarlagen (see M4). Fix: a stable tie-break, e.g. the id or
the later attempt; ask if it matters.

### m8. No message when WebAssembly cannot start

`core.ts:26`. A failed `instantiate` rejects the module, so `main.ts` never runs: an empty window on
every platform, with no text for the teacher. `'wasm-unsafe-eval'` needs a recent engine (older
WKWebView on old macOS; `tauri.conf.json` sets no `minimumSystemVersion`). Fix: a minimum macOS
version, or a static fallback text in `index.html` that the app removes on start.

### m9. Tests do not cover the screens' wiring

The rules are tested well, but only `shell.spec.ts` (version) changed in e2e. Nothing fails if
`profiel.js:868` uses `allResults` instead of `history`, if the group footer averages unrounded
numbers, or if B16's `lastYear` is lost. `reference_goldens.rs` is weak in places while its header
says "nothing else may differ":

- `:272`: averages within 0,05, and `:296-297` compare both `profileYearAvg` and `groupYearAvg`
  with one list, so M4 passes;
- `:332-342`: mean and SD within 0,1, so a rule change of a tenth passes;
- `:386-404`: only total count and shape of the histogram;
- `:409-435`: only "not above the max".

The unit tests carry the rules, so this is not a wrong number today. Fix: move decision-level
checks of the screens into pure helpers, and compare goldens with expected values for the
documented differences.

### m10. Documents out of date

`docs/STATE.md` still says "(step 19a)", "19b, to do" and "No screen uses the rules yet", although
19b is committed (CLAUDE.md: update after every sub-task). `typst-contract.md` section 2.1 does not
list `grade_only`, `ranking` and `rtti_points`, and the template requires `rtti_points`.
`business-rules.md` describes the reference, correctly, but `rapport.ts:3-7` and others still point
there for rules that have changed: add one line at its top pointing to the decisions.

## Nits

- **n1.** `rapport.typ:538-539` still says "top-third or top-two-thirds"; `:371` says "from the
  vragen array". Decision 16 asked for the comment to be right.
- **n2.** `round.rs:13,23`: at or above about 1.7e29 `to_nanos` saturates and `+ unit / 2` wraps:
  wasm `round1(1e30)` is **-1.7e29**; a debug build panics. Only `max_points: 1e30` in a file can do
  this. Fix: return `x` for `|x| > 1e15`.
- **n3.** A stored `""` is invalid, so 0 of max in RTTI, where decision 4 says empty is left out. An
  only-`""` student had 1,0 and now has no grade. The app never stores `""`
  (`scoregrid.ts:77`). `assembleVragen` (`rapport.ts:85`) uses `Number(raw)`: `""` and `true` show as
  points where the core gives 0; `"0x10"` shows 16.
- **n4.** `parent_id: ""` is a resit for the core and an original for the UI's `!e.parent_id`
  (`attempts.rs:41,51`). Wasm: two such exams become one family. Filter empty strings in `opt_text`.
- **n5.** `core.ts:44`: `packed >> 32n` is signed, so a pointer above 2 GiB reads negative; use
  `BigInt.asUintN(64, packed)`. `abi.rs:52-54` and `write` do not check a null from `alloc`. Neither
  is reachable at real sizes.
- **n6.** `validate.rs:550`: `"inf"` parses, so no warning, while the model reads it as 1. `:572` prints
  `?` for a numeric question id. `:579` says "telt wel mee voor het cijfer" also for a diag question.
- **n7.** `'wasm-unsafe-eval'` also allows pdf.js's own wasm in the worker (`pdf.worker` has a module
  inside). Harmless, but ADR-0011 says the CSP change is for the rules only. `ui/vite/csp.ts:3` has
  an overlong comment line.
- **n8.** After the upgrade an override saved with `berekend: 8.6` on an exact half (now 8,7) shows the
  stale warning. True, and rare (exact halves only), but not in the before/after document.

## Suggested order

1. Ask the user about **M3** and **M4**: both are rule choices.
2. **M1**, **M2** and **m2** together: the template gets its numbers from the core.
3. **M5**, **M6**: small, with failing tests first.
4. **M7**: one structural change, the largest effect for a teacher.
5. **M8** before any release on real data, depending on `validate-data`.

## Triage (implementer, after the review)

- **M1, M2, m2:** the template draws numbers from the core (`rtti_points` with `pct` and `share`, `score_pct`, `grade_bins`, `grade_bin`); the pie comes from the test's maxima. Goldens unchanged.
- **M3:** the user chose decision 24: empty is 0 of its max on the rapport.
- **M4:** the user chose decision 25: all the student's tests; `Store.studentYearAverage`.
- **M5:** a non-number weging counts as 1. **M6:** `qKind` treats unknown as normal; card totals from the core. **M7:** `classQuestions`, one call per rapport. **M8:** damaged entries are skipped, limits per field.
- **Fixed:** m1, m3, m4, m7, m10, n1, n2, n4, n5. n8 is in the before/after document.
- **Open question for the user:** m5.
- **Backlog:** m6 (fields sent per call), m8 (message when WebAssembly cannot start), m9 (tests of the screens' wiring), n3, n6, n7.
