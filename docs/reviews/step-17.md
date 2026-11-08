# Review: step 17 (Rapport fixes)

Scope: `a62ea7e..e84579a` (branch `step/17-rapport-fixes`), 4 commits, 40 files (+689/-136;
most of the churn is the blessed golden PNGs). Reviewer: fresh-context subagent, checklist PLAN.md
Appendix C. I read the diff and the code, not the commit messages or STATE as evidence. I ran
`cargo test -p maatwerk-core` (green), `cargo fmt --all --check` (clean), `npm test` (vitest
green, node suite **red**, see M1) and `node tests/reference-harness/typst/regen-typst.mjs
--check` on `e84579a` and on `HEAD`.

Plan items: B-06, B-07, F-13, F-04, T4, T7, T8, T10, T25, plus T6 (same template lines). Not done:
T9 and T23, which ROADMAP 4.6 assigns to step 17 but PLAN-2 does not list (see m3).

**The STOP gate is still open:** PLAN-2 step 17 says the user must see the Typst golden diffs
(PNG) for every changed rapport before merge. The branch is not merged and STATE says the check
is pending. That is correct, and it is not a finding, but the merge must wait for it.

## Summary

| Severity | Count |
| -------- | ----- |
| Blocker  | 0     |
| Major    | 1     |
| Minor    | 5     |
| Nit      | 5     |

Checked and found correct:

- **T4 (no watermark):** `rapport_world` looks the file up with `find_ignoring_case` and passes
  `watermark: bool` in `data.json` (`Payload` flattens `RapportData`, so the template contract
  only gains a field). `rapport-main.typ` defaults to `true` for older payloads. Tests check that
  a page has 0 images without the file, 1 with it, and 1 for `Fotos/School-Watermerk.svg`.
- **T6/T7 `_num`:** rounds to 2 decimals, drops `.0`, uses a comma. It is applied to the score
  column, the max, the dot label and "Je hebt … punten". `str(int(q.score))` is gone.
  The test checks `3,5 / 5` and that `3.5` no longer appears anywhere on the page.
- **T8/F-13 footer and padding:** the total comes from the student's own end marker
  (`<rapport-student-end>`, matched on index), rounded up to even. `pagebreak(to: "odd")` between
  students uses physical page parity, and the counter is reset after it. The last student is
  padded by a `context` that reads its own end marker (it does not use `here()`). There is no
  convergence problem: the padding depends only on the marker's page, and the padding cannot
  move the marker. Tests: `["1/4","2/4","3/4","4/4","1/2","2/2"]` and the last-student case.
- **T10:** `max_score == 0` leaves out the percentage clause. `_scale_max` makes a `range` over
  whole points from 0 to `ceil(global_max)`, at least 1. `buildLeeradviesRows` falls back to the
  default limits when `grenswaarden` (or one category of it) is missing. There are Rust and
  vitest tests for each.
- **B-06 / B-07:** the column is 3 cm. One dot size is used for the whole exam
  (`render`, rapport.typ:695), so students do not differ. The tests measure the line of
  `12,5`/`(63%)` and the dot diameters (8 pt vs 11 pt).
- **T25:** every text item on page 1 has `lang == "nl"` (test).
- **F-04:** `render.rs` passes the warnings through and deduplicates them. Batch warnings are
  labelled with the opdracht and appear once per opdracht (unit test). `renderWarningsHtml`
  escapes every warning text before it goes into `innerHTML`. The panel is collapsed by default.
  Three e2e tests cover it: no panel, a panel with 2 warnings, and the answer-key path. The
  layering is respected: there is no logic in the command handler beyond formatting.
- **Golden change justified:** commit `f26d77f` names the items and PLAN-2 decision 9, and
  `case.json` records `port.blessed`. Page 2 of each student is byte-identical (same SHA), which
  fits the claim that only page 1 changed.

## Major

### M1. The reference-freshness test now fails on the blessed goldens; `npm run golden:typst` would silently revert them

- `tests/golden/typst.test.mjs:83-86` runs `regen-typst.mjs --check` whenever `_reference/` is
  present, which is the case on the developer's machine. The check renders every case with the
  **reference** app and compares the result byte-for-byte with `tests/golden/typst/<id>/`
  (`regen-typst.mjs:239-246`). `rapport-one-student` and `rapport-valid` are now Maatwerk's
  output (`MAATWERK_BLESS`), so the check reports `DIFF rapport-one-student`,
  `DIFF rapport-valid`. I verified this on `e84579a` and on `HEAD`. As a result, `npm test`
  exits 1 locally (node suite: `tests 123, fail 1`). The test is skipped in CI, where
  `_reference/` is absent, so CI stays green and hides the problem. The gate (PLAN 2.2) requires
  `npm test` to pass.
- Worse: the documented regeneration command (`npm run golden:typst`, no `--check`) does
  `fs.rmSync(dir)` and rewrites the folder from the reference render (`regen-typst.mjs:248-251`).
  The next person who regenerates the Typst goldens for an unrelated reason would turn the two
  rapport goldens back into the reference output. `cargo test` would then fail with a pixel diff
  that looks like a regression in the port.
- Fix: make the harness aware of `port.blessed`. Either skip blessed cases in `--check` and in
  regeneration (they no longer track the reference), or compare and write only the reference
  fields (`reference`, `call`, `wrappers`, `result`) and keep `pdf`/`png` from disk. Add a node
  test that a blessed case survives a regeneration.

## Minor

### m1. `MAATWERK_BLESS` blesses every golden that a test run touches, and the run passes without checking anything

- `tests/support/mod.rs:98-101`: when the variable is set, `assert_matches_golden` rewrites the
  case and returns, for **every** case, and stamps them all with the same `why`. The doc comment
  (`:158`) suggests `MAATWERK_BLESS="…" cargo test`. Without a test filter, that also rewrites
  every opdracht/batch/svg golden that goes through `assert_matches_golden`, which turns
  reference-derived goldens into port output with no visual check. If the variable is ever left
  set in a shell or CI environment, every golden test passes without asserting anything.
- Fix: take the list of case ids to bless (`MAATWERK_BLESS_CASES=rapport-valid,…`) and compare
  every other case as usual. Fail (or at least `eprintln!`) after blessing, so a blessing run is
  never mistaken for a green one.

### m2. The blessed `case.json` drops the reference's page text

- `bless` (`tests/support/mod.rs:161-197`) replaces `pdf.pages[].text` (pdf.js text of the
  reference PDF, including the `schema` watermark lines) with Typst frame text. The case still
  says `reference: {…}` and keeps the reference `result`, so a reader cannot tell which fields are
  the reference's evidence and which are the port's. The old values exist only in git history.
- Fix: keep the reference output under `reference.pdf` (or similar) and write the port output
  under `port.pdf`/`port.png`. The same split also fixes M1.

### m3. T9 and T23 are not done although ROADMAP 4.6 assigns them to step 17

- ROADMAP 4.6: "T8 (footer "/ 2"), T9 (histogram texts), T25 (lang) | Fix | 17" and "T23
  (batch reports only the first failure) | Fix | 17". PLAN-2 step 17 lists neither. STATE says the
  user was asked. Fix: record the answer in ROADMAP 4.6 (and move the items to a step) before the
  merge, so they do not fall between the two documents.

### m4. A missing grenswaarde for a category the defaults do not know still crashes

- `ui/src/domain/rapport.ts:251`: `defaultTabData().grenswaarden[cat]!` is `undefined` for a
  category outside the default set. `getScoreBracket` (`:163-171`) then reads
  `grenzen.laag_midden` from `undefined`. That is the T10 failure mode for the one case the
  fallback does not cover. It is unlikely with the fixed RTTI categories, but the `!` hides it.
  Fix: fall back to a literal `{ laag_midden: 40, midden_hoog: 70 }`.

### m5. T6 is fixed only in the lines that T7 touches

- `rapport.typ:711` still prints `N=#str(exam_info.n_term).replace(".", ",")`, and other
  numbers go through `fmt1`/`str`. A computed n-term such as `0.1 + 0.2` would print float
  noise. The quirk note says "numbers on the rapport use a decimal comma, at most two decimals",
  which is broader than what the code does. Fix: use `_num` for `n_term` too, or narrow the note.

## Nits

- n1. The padding page that F-13 adds has the footer ("4 / 4") and the watermark. The spec says
  "an empty fourth page". This is probably fine, but show it to the user in the visual check.
- n2. `rapport.typ:5` still documents `global_max_points: int`; since T10 it may be a float.
- n3. `typst_svc/rapport.rs:6`: the module doc line is over 100 characters (rustfmt does not wrap
  comments).
- n4. `find_ignoring_case(...).is_some_and(|p| p.is_file())` follows symlinks. A watermark that
  is a link out of the data folder gives `watermark: true`, and the World then refuses it, so the
  compile fails as before T4. Use `symlink_metadata` or the World's own lookup.
- n5. `components/render-warnings.ts` has no vitest unit test (singular/plural and escaping are
  covered only through e2e).

## Triage (implementer, 2026-11-07)

- **M1 fixed:** `regen-typst.mjs` skips a case with `port.blessed` (neither checked nor
  overwritten); `node --test tests/golden/typst.test.mjs` passes again with `_reference/`.
- **m1 fixed:** blessing needs `MAATWERK_BLESS_IDS=<case>,<case>`; every other case is compared.
- **m2 backlog:** the reference's page text of the two blessed cases is in git history (before
  `f26d77f`); a `reference.pdf` / `port.pdf` split is in `docs/backlog.md` "From Step 17".
- **m3 resolved (user 2026-11-07):** T9 moved to step 19b (rapport numbers in the core), T23 to
  step 26 (opdrachten-genereren rework); PLAN-2 and ROADMAP 4.6 updated.
- **m4, m5, n2, n3, n4, n5 fixed** (literal 40/70 fallback; `_num` for the n-term, output
  unchanged; doc lines; no symlinked watermark; `render-warnings.test.ts`).
- **n1** shown to the user with the golden check; the user approved the goldens, padding page
  included (2026-11-07).
