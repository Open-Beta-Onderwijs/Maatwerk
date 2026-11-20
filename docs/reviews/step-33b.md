# Review: step 33b, perf hotfix 0.24.1

Reviewer: fresh-context subagent, 2026-11-20. Scope: `git diff 6e6a427..HEAD` on `step/33b-perf`
(5 commits: `c5785e6`, `8d0837c`, `24be8d7`, `1d3ac46`, `0771c08`). Read in full: the hunks in
`crates/maatwerk-grades-wasm/src/lib.rs`, `ui/src/domain/{grades,attempts}.ts`,
`ui/src/screens/{toetsen,groepen}.ts`, `ui/src/screens/cards/{swap-clock,student-grades}.ts`,
`ui/src/styles/cards.css`, `ui/src/utils/idle.ts` and every new or changed test. Checked against
the rules: `maatwerk-grades` `grade.rs` (`exam_scores`, `exam_results`), `attempts.rs`
(`best_attempt`), `model.rs` (`ScoreRecord` with `tolerant_map`, `Override`, `Exam::score_ids`),
and against the old per-student path (`store.js` `examResultsMemo`, `bestAttempt`, `forGrading`,
`recordFor`). Not run in this review: cargo, Vitest, e2e (STATE: gate green, 841 Vitest, Chromium
e2e 396/396).

Accepted, not reported: the swap as a CSS transition on a shared clock (STATE "Choice made without
a spec line"); the batch calls bypassing `Store.examResults`'s memo and the longer
`groepen:stats` wall time (both documented in `docs/perf.md` and backlog "Grade cache").

## Summary

No grade changes. `hasGradeData` (`grades.ts:155`) is a strict superset of what the rules
compute: it answers false only when `overrides[examId]` is `undefined` and `scores[examId]` is
missing, not an object, or an object without enumerable keys. In each of those cases the old
path already sent nothing the rules could use (`recordFor` drops falsy entries; `tolerant_map`
drops non-object score maps), and `exam_results` returns `None` when the filtered scores are
empty and there is no override, regardless of `po` lines. So a PO with only bonus/malus lines,
an override of `null`/`0`/`{}`, a score map that is a string, an array or `{}`, and scores under
removed question ids all answer null on both paths (the last two cases go to the rules in JS and
come back null, as before). `bestAttempt` / `bestAttemptMany` skip only when every attempt is
skipped, and `best_attempt` reads grades only through `exam_results`. The batch entries in the
WASM crate run the same `exam_results` / `best_attempt` per record over the same
`recordFor(rec, attempts)` and `exams.map(forGrading)` (PO rubric included), and `blockNumbers`
reads `results[k][j]` in the order of `attempts`, so the Toetsen numbers, the PO cards and the
Verzamelkaart equal the old `Store.examResults` + `bestAttempt` path. `BestArg` owning its id is
fine.

The swap clock reproduces the old keyframes: 4,5 s per value of which 0,7 s cross-fade (old: 42 %
→ 50 % of 9 s = 0,72 s), "laatste" first, one attribute for every card, reduced motion hides
`-a`/`-b` and shows `-both` (unchanged media block, `display` wins over opacity). No reference to
`syncSwaps` is left; `studentGradesHtml` is only rendered through `fillStudentGrades`, which
starts the clock, so no other screen or modal shows a swap without it. The themes are not
affected (opacity only). Toetsen's `generation`/`current()` guards cover the deferred start, each
fill, the warnings and the placeholder cleanup. Version bump complete (workspace `Cargo.toml`,
`Cargo.lock` x5, `ui/package.json`, `package-lock.json`, `MOCK_APP_VERSION`, `shell.spec.ts`; the
root `package.json` has no version). SPDX headers on every new file; comments and docs English, no
new UI text.

The findings are about fills of an older draw that keep running, a timer-clamping cost in
`yieldSlice`, a timing-dependent e2e test, and test gaps around the short-circuit.

## Blockers

None.

## Majors

None.

## Minors

### m1. Fills of an older Toetsen draw run to completion and now overlap the new one

`ui/src/screens/toetsen.ts:228-229` (`blockNumbers`) and `:84` (`computeExamWarnings`) check
nothing between slices; `current()` is only consulted when a block's promise resolves. Before
0.24.1 a fill ran as one task (cached reads are microtasks), so a redraw could not start until
the previous fill had finished. Now a fill takes ~0.1-1 s of slices (perf table: `toetsen:stats`
140 ms at 1x, 1,1 s at 4x), and the list is redrawn on every `scores`/`exam`/`group` watcher
event and after every score-modal save (`app.js:680`, `exam-menu.ts:169`). Scenario: a colleague
enters scores in a resit on another PC; every save redraws Toetsen; each redraw starts a full fill
for all exams while the older ones keep computing, and all share the one 8 ms budget of
`yieldSlice`, so the current draw's numbers appear later the more saves arrive, and the CPU stays
busy for work whose result is thrown away. Fix: pass `current` into `blockNumbers` and
`computeExamWarnings` and return (or throw a cancel) after each `await yieldSlice()` when it is
false; the `allSettled` cleanup is already guarded.

### m2. Groepen writes a stale group's numbers into the new list

`ui/src/screens/groepen.ts:292-293`: `run !== fillRun` is checked before `groupNumbers`, not after
it. `groupNumbers` now yields per student (`:255`), so a redraw can happen in the middle of a
group; the old run then finishes that group with the students and records it read before the
change and writes them into the new card (`container.querySelector` finds the new slot), before
returning at the next iteration. Usually the new run overwrites it later, but the order is not
guaranteed (both runs interleave in slices), and with a membership change the old run's numbers
are simply wrong for the new group. The window was a single task before this step. Fix: repeat
`if (run !== fillRun) return;` right after `await groupNumbers(g, year)`.

### m3. `yieldSlice` pays the nested-timer clamp on every yield

`ui/src/utils/idle.ts:74` yields with `setTimeout(r, 0)`. The loop continues in the microtask of
that timer's task and schedules the next `setTimeout` from it, so after five levels HTML's timer
nesting rule clamps each yield to >= 4 ms: every 8 ms slice is followed by >= 4 ms of idle, about
a third of the wall time, on top of the work. This likely contributes to `groepen:stats`
324 -> 1240 ms at 1x (perf.md attributes it only to sharing with the Leerlingen fill). In a
minimised or hidden window Chromium also throttles timers (1 s, later once per minute), so a fill
started then crawls until the window is shown. Fix: yield through a `MessageChannel`
(`port.postMessage`, no clamp) or `scheduler.yield()` where it exists (WebView2) with the
`MessageChannel` fallback for WebKit; keep `setTimeout` only as the last fallback. Re-measure
`groepen:stats`.

### m4. The swap e2e test races the real clock

`ui/e2e/cards.spec.ts:104-112`: the real 4,5 s interval keeps running while the test flips
`data-card-swap` by hand. If the clock ticks within ~0,7 s after line 110 (a slow or loaded CI
worker, or a later login path that starts the clock earlier), it flips back to `a` before `-a`
reaches opacity 0; the next `b` comes 4,5 s later plus the 0,7 s fade, beyond the default 5 s
`expect` timeout, and the test fails. The same can hit the `toHaveCSS('opacity', '1')` pair.
Fix: install Playwright's fake clock before `login` (`page.clock.install()`) and advance it by
`SWAP_HALF_MS` instead of writing the attribute, which also tests the real tick; or assert only
the CSS for a fixed attribute on an element outside `:root` control.

### m5. Test gaps around the short-circuit and the batch entries

- `ui/src/domain/grades-batch.test.ts:48-54` asserts that JS answers null without calling the
  rules, but never that the rules would have answered null for those records too. That is the
  property that keeps grades unchanged. Add a table of edge records (override `null`, `0`, `{}`;
  scores `"x"`, `[]`, `{}`; a PO with only `po` lines; scores under removed question ids) and
  assert, for each record where `hasGradeData` is false, that
  `coreCall('examResults', recordFor(rec, [exam]), forGrading(exam))` is null, for a test and for
  a PO with a rubric.
- Neither the Rust batch tests (`lib.rs:325`, `:346`) nor the Vitest batch tests include a PO
  exam (rubric through `forGrading`, category scores, `po` lines). Add one PO to the exam list.
- `examResultsMany` / `bestAttemptMany` are not in `every_function_answers_without_panicking`
  (`lib.rs:364`); add them with an empty and a damaged record list.
- No test that the Toetsen numbers equal the old path end to end (e.g. a Vitest of
  `blockNumbers` against a loop of `examResults` + `bestAttempt` on the tiny fixture); the e2e
  only checks rendered text where it was already checked.

## Nits

- n1. `ui/src/screens/toetsen.ts:369`: the `afterPaint().then(...)` has no `catch`; a synchronous
  throw in `fillNumbers` (e.g. `attemptsOf`) becomes an unhandled rejection and leaves the
  skeletons. Wrap it, or let the cleanup run in a `finally`.
- n2. `toetsen.ts:389-430`: every block and every attempt's warnings start at once and share the
  slice budget, so all cards fill near the end instead of one after the other. Running the blocks
  in sequence (in reading order) would show the first cards sooner for the same total.
- n3. `ui/src/screens/cards/swap-clock.ts:21`: the interval runs for the life of the window once
  Leerlingen was shown (also after logout, also on other screens and under reduced motion). It is
  one attribute write per 4,5 s and cheap; a line in the comment would make the lifetime explicit.
- n4. `swap-clock.ts:23`: a tick skipped while hidden is not caught up; after the window comes
  back the phase is still in step for all cards, so harmless, but the comment "the next tick
  carries on" could say the phase may be shifted.
- n5. `ui/src/utils/idle.ts:64`: `sliceStart` is module state shared by all loops by design; the
  test (`idle.test.ts`) depends on being the only user in its file. Fine; a `resetSlice()` for
  tests would make that explicit if a second test is added.
