# Review: Step 2 (end of step), focus on 2b Typst goldens

Sub-step 2a (logic goldens, storage spec) was reviewed separately in `docs/reviews/step-02a.md`
(tag `step-02a`). This review covers 2b: `git diff step-02a..HEAD` plus the 2b files from commit
`c0a8c94` (`tests/reference-harness/typst/`, `tests/golden/typst/**`, `tests/golden/typst.test.mjs`,
`tools/reference-shims/typst-wrappers.cjs`, `make-shims.mjs`, fixture changes, quirks T26/T27,
Typst section of `docs/testing.md`).

Reviewer: fresh context, checked against code and `_reference/` at 0e30a70. Nothing was changed.

## What I ran

| Command                                                           | Result                                                            |
| ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| `npm run golden:typst -- --check`                                 | 21/21 `ok`, 15 s                                                  |
| `node --test tests/golden/typst.test.mjs` (with `_reference/`)    | 44/44 pass, incl. fresh re-render                                 |
| `MAATWERK_REFERENCE=/nonexistent npm test` (Git Bash)             | 121 tests, 104 pass, 17 skipped, 0 fail                           |
| `npm run golden:check`                                            | all logic suites `ok` (fixture change did not move logic goldens) |
| `node --test tests/reference-harness/shims.test.mjs`              | 2/2 pass (7 verbatim blocks)                                      |
| `bash tools/check-spdx.sh`                                        | exit 0                                                            |
| `npx prettier --check` on the new files                           | clean                                                             |
| `du` of `tests/golden/typst`                                      | 2.7 MB (budget 5 MB)                                              |
| `%TEMP%\maatwerk-ref-*` after runs, `git status` in `_reference/` | none left, clean                                                  |

## Verified as correct

- **Real handlers.** Paths A-D go through the real `ipcMain.handle` bodies of `_reference/main.js`
  (`app:renderRapportPdf` 546-602, `renderAssignmentPdf` 693-721, `renderAssignmentSvg` 737-801,
  `renderAssignmentBatch` 827-917). Rapport cases also run the real `compileRapport`
  (`renderer/modals/rapport.js:174-282`) with the real bridge, and record its single
  `renderRapportPdf` call.
- **PNG re-render.** `renderPngs` (`regen-typst.mjs:62-88`) uses the same argument list as
  `typstCompileArgs()` + `--root appDir` (`main.js:510-516`, 592), with `getFontsDir()` /
  `getPackagesDir()` resolving to `appDir/include/{fonts,packages}` in unpackaged mode
  (`main.js:499-507`, 960-963). The only additions are `--format png --ppi 30` and the output
  pattern. The restored wrapper and `_preview_` copy are the exact strings captured by `onWrite`.
  The PNG is only made for single-job batches, so the job PDF equals the merged PDF (padding needs
  `i > 0`, `main.js:899`).
- **Fake electron sender.** `isDestroyed: () => false` matches Electron for a live window. The
  `fs` passed to `main.js` only adds a write hook and pinned `readdirSync` order. Neither changes
  what the handlers produce (the SVG handler sorts pages numerically itself, `main.js:790`).
- **`prepare` hooks** only set up input data (template texts, a broken `.typ`, the base template
  copy, `lib.typ` like `seedInitialData`). They do not touch reference code. Each one is stated in
  the case `rule`. See m1 for one hook that is too broad.
- **Duplex.** `batch-duplex` pages: Anna 1-3, blank 4, Bram 5-9 (two jobs, same key, no padding
  between them), blank 10, Chloé 11-14 (even, no blank), Daan 15-16. This matches
  `main.js:899-902`.
- **Error texts.** `svg-preview-error` maps `_preview_<file>` back to the real file name
  (`main.js:781`). `batch-error` has the `Fout in opdracht "<label>":\n\n` prefix (`main.js:876`).
- **Quirk T26.** This is correct. `Math.max(0, Number('abc'))` is `NaN` (`rapport.js:48`).
  `scoreDotColor(NaN)` falls through to `lerpHex(..., NaN)`, and `Math.round(NaN).toString(16)`
  gives `#NaNNaNNaN` (`rapport.js:13-37`). That fails at `rgb(q.dot_color)`
  (`rtti_export.typ:133`), as the `rapport-tiny` golden shows. `toTypst(NaN)` gives `0`
  (`main.js:561`).
- **Quirk T27.** This is correct. `sanitizeTypstMarkup` (`rapport.js:129-136`) prepends a
  `[$-teken …]` that has one unescaped `$`. The `rapport-markup` payload holds exactly that advies,
  and the error points at `eval(r.advies, mode: "markup")` (`rtti_export.typ:276`).
- **Junctions and temp folders.** `dispose` and `sweepStale` unlink `bin/` and `include/` before
  the recursive delete. The new try/catch in `startMainProcess` removes the folder when setup
  fails. No leftovers were found.
- **CI without the reference** checks something real. The PNG hashes must match `case.json`, and
  every recorded wrapper must equal the verbatim builders applied to the recorded call arguments
  (`typst.test.mjs:50-81`). An edit to a golden wrapper or a shim is caught. `shims.test.mjs`
  checks the 7 verbatim blocks against `main.js` when `_reference/` is present.
- **Licence.** `pdfjs-dist` 6.4.299 is Apache-2.0 and dev-only. Its optional `@napi-rs/canvas*`
  dependencies are MIT. Nothing is shipped, so `THIRD_PARTY_LICENSES.md` correctly does not list
  it, the same as `pdf-lib`.

## Findings

### Blockers

None.

### Majors

**M1. The rapport grade histogram is not covered by any golden.**
`docs/testing.md:176` (matrix row 9) and `docs/reference/typst-contract.md` section 10.9 (12
students, "histogram plus the 👑/🥈 lines").
Evidence: `rtti_export.typ:494-496` returns early when there are fewer than 10 grades
(`if all_grades.len() < 10 { return }`). The rapport goldens have 7 students (`rapport-valid`,
`rapport-tiny`), 6 (`rapport-markup`, which fails) and 1 (`rapport-one-student`, `rapport-no-watermark`).
So `grade_histogram`, the cetz drawing called at `rtti_export.typ:672`, never renders in a golden.
`rapport-valid` has no 👑 or 🥈 in its text. Matrix row 9 still says "Rapport, class" is covered.
Fix: add a rapport case with at least 10 students and spread grades, for example 12 students as in
contract 10.9. Either add students to the tiny fixture's diag exam, or build a synthetic payload
the way `rapport-markup` does. Make sure the PNG shows the histogram and the text shows the
marker lines.

**M2. No rapport that compiles has long names or Typst-special names.**
This is the PLAN 2b bullet "rapport (several students, long names, …)". `cases.mjs:78-127`.
Evidence: the 7 students of `rapport-valid` are Sem van den Dekker, D'Angelo O'Neill, Lars 't Vos,
Marie-Claire 't Hart, Gijs Kok, Olivia ter Østergaard and Bram van Willems. None of them is the long
`Maximiliaan Alexander Constantijn van der Wiel-Brandsma …` or a `# $ " \ @ < >` name
(`generate.mjs:97-107`). The special names appear only in `rapport-markup`, which fails on T27
before any page renders. The long name appears only in opdracht headers (`opdracht-long-odd`). So
nothing shows how the rapport title line, footer and wrapping handle these names.
Fix: put those fixture students in the class rendered by `rapport-valid` (or by the new M1 case).
Alternatively, add a case that reuses the `rapport-markup` payload with the odd-`$` advies replaced
so it compiles. One case with at least 10 students can close M1 and M2 together.

### Minors

**m1. `sanitizeScores` changes more than the invalid scores, and its comment is wrong.**
`cases.mjs:14-24`.
The comment says invalid scores "become N", but the code sets them to `null`. It also replaces
_every_ string, including out-of-range numeric strings such as `String(max + 2)`
(`generate.mjs:470`). Those are valid for `Number()` and do not break the rapport: they render as a
green dot with the over-max score printed. So `rapport-valid` and `rapport-one-student` lose the
"score above max" rendering, and the case rules call it "invalid scores replaced by N". Today this
gives the same output as `'N'`, because `calcResults` and `assembleVragen` treat `null` and `'N'`
alike (`store.js:680`, `rapport.js:47`).
Fix: replace only values where `isNaN(Number(v))` and `v.toUpperCase() !== 'N'`, and correct the
comment and the rule.

**m2. The Typst package cache is used without a check, and Typst can silently download.**
`regen-typst.mjs:6-8`, `docs/testing.md:161-164`.
`rtti_export.typ:17-18` imports `@preview/cetz:0.3.4` and `@preview/unify:0.8.0`, but only `zero`
is vendored (`_reference/include/packages/preview/`). If they are missing from
`%LOCALAPPDATA%\typst\packages`, Typst downloads them. That breaks the "no network" rule in
PLAN section 5. Offline, every rapport case turns into an error golden and `--check` reports DIFF
with no hint of the cause.
Fix: before running, check that the cache has `cetz/0.3.4`, `unify/0.8.0` and the `oxifmt`
version they need, and abort with a clear message. Name the exact `oxifmt` version in
`docs/testing.md`.

**m3. Path normalisation misses canonical and 8.3 forms. The leak test only matches `X:\Users`.**
`regen-typst.mjs:45-52`, `typst.test.mjs:46`.
`appDir` comes from `os.tmpdir()`. On machines with long user names, `TEMP` is often an 8.3 path
(`C:\Users\LONGNA~1\…`), while Typst prints canonicalised paths. Those paths are not replaced by
`<app>`. They would then put the user name into goldens and make `--check` fail on that machine.
The CI guard misses non-`C:\Users` temp roots such as `D:\tmp` or `/tmp`.
Fix: also normalise `fs.realpathSync.native(appDir)` and its `\\?\` form. In the test, reject any
`maatwerk-ref-` substring or any drive-letter or POSIX absolute path.

**m4. Error goldens contain Windows separators.**
For example `<app>\temp\rtti_export.typ:276:11`, `<app>\data\opdrachten\kapot.typ:3:23`
(`batch-error`, `rapport-*`, `svg-preview-error` `case.json`).
The Step 5 Rust comparison will produce different location text (World-relative paths, `/`).
Fix: normalise `\` to `/` after `<app>`, or state in `docs/testing.md` which parts of an error text
are parity (message, file name, line:col) and which are not (full path, snippet frame).

**m5. 30 ppi differs from the contract's 110-144 ppi, and no decision records it.**
`regen-typst.mjs:28`, `typst-contract.md` section 10.
At 30 ppi an A4 page is about 248×351 px and body text is about 4 px high. A pixel diff in Step 5
will catch layout shifts, but not glyph or colour detail such as score dots or `rgb()` colours.
This may be the right size trade-off (2.7 MB now), but it is undocumented.
Fix: record the decision in `docs/testing.md`. Consider a second, higher-ppi PNG for a few key
pages (rapport page 1, base template pages 1-2) within the 5 MB budget.

**m6. Batch page structure is only implicit, and multi-job batches have no PNGs.**
`regen-typst.mjs:176-179`. PLAN 2b asks for "batch page structure".
In `batch-duplex` a blank page can only be seen as `text: ""` (pages 4 and 10). An image-only page
would look the same. Nothing records which job each page came from. All page sizes are A4, so the
rule "blank page sized like the previous one" (contract 10.7) cannot be told apart.
Fix: store an explicit `structure` (for example `[{job:0,pages:3},{blank:true},…]`). Per-job page
counts can be found by compiling each recorded job wrapper once, or by counting the merged PDF's
pages per `/Contents` stream (blank pages have none). Optionally store PNGs of `batch-duplex`
pages 3-5 and 9-11.

**m7. `assignment:progress` events are not recorded.**
`regen-typst.mjs:155-164`, `main-process.mjs` (`sent`).
The batch handler reports `{done, total}` before and after each job (`main.js:853-857`, 881, 892),
which is part of the contract the UI depends on. The harness collects these in `mp.sent` but
drops them.
Fix: add `json.progress = mp.sent.filter(e => e.ch === 'assignment:progress').map(e => e.payload)`.
The counts are monotonic, so this stays deterministic even with parallel workers.

**m8. `npm run golden:regen` and `golden:check` do not include Typst.**
`package.json:18-20`, PLAN 2b ("`npm run golden:regen` regenerates").
A developer who follows the PLAN never regenerates or checks the Typst goldens.
Fix: chain `golden:typst` into both scripts, or update PLAN and `docs/testing.md`.

**m9. The coverage matrix overstates rapport edge cases.**
`docs/testing.md:176-177`.
Contract 10.10 lists a fractional question score (`str(int())` truncation) and a student with a
3-page first section (footer still "/ 2"). No case covers either. M1 also affects row 9.
Fix: add these to the M1/M2 case, or list them under "Not covered yet".

### Nits

- n1. `docs/testing.md:162` contains a literal TAB: `%LOCALAPPDATA%<TAB>ypst\packages`. The `\t`
  was interpreted as an escape.
- n2. `docs/testing.md:189` still lists "Opdracht images … Step 2b" under "Not covered yet". Images
  are covered now (`opdracht-images-student`). Only the `.typ`/image file IPC is left for Step 4.
- n3. `regen-typst.mjs:172`: `cursorLinks` counts `href="rtti-cursor:"` substrings. Page 2 of
  `svg-preview-cursor` reports `2` for one marker, probably `href` and `xlink:href` on the same
  `<a>`. Count `<a ` elements, or rename the field to what it counts.
- n4. `regen-typst.mjs:204-215`: `--check` ignores golden folders that no case produces any more.
  A removed case leaves an orphan folder that still passes the CI self-consistency test. List the
  folders in `TYPST_DIR` and fail on extras.
- n5. Contract 10.5 `#num[1234.5]` → `1234,5` is only covered in the rapport (eval scope), not in an
  opdracht (`lib.typ` `set-num`). Add it to the `lib` fixture opdracht.

## Verdict

**Pass with changes.** The harness really captures reference behaviour. All four IPC paths run
through the real `main.js` handlers, wrappers and the reference CLI. The PNG re-render uses the
reference arguments. The goldens are reproducible (`--check` passes). The CI fallback checks
something real, and T26/T27 are correct. Before tagging `step-02`, fix M1 (no histogram) and M2 (no
long or special names in a rapport that compiles), because the Step 5 rapport parity relies on them.
Fixing m1-m3 at the same time is cheap. The other minors and the nits can go into STATE as
follow-ups.

## Triage (implementer, 2026-10-26)

| Finding | Decision  | Change                                                                                                                                                                                  |
| ------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1, M2  | Fixed     | `rapport-valid` adds four synthetic students (long name, `# $ " \ @ < > * _`, diacritics): 11 students with scores, 22 pages, histogram with 👑/🥈, every special name in the PDF text. |
| m1      | Fixed     | `sanitizeScores` replaces only non-numeric strings; comment corrected.                                                                                                                  |
| m2      | Fixed     | `regen-typst.mjs` stops when cetz 0.3.4, unify 0.8.0 or oxifmt is not in a local package directory.                                                                                     |
| m3, m4  | Backlog   | Path normalisation forms and separator-neutral error text: relevant when Step 5 compares diagnostics (shape only, typst-contract.md 9).                                                 |
| m5      | Fixed     | Decision recorded in `docs/testing.md`: 30 ppi to stay in the size budget; Step 5 renders at the same ppi.                                                                              |
| m6, m7  | Backlog   | Explicit batch page map and `assignment:progress` events: add when Step 5/6 implements the batch.                                                                                       |
| m8      | Fixed     | `npm run golden:check` runs the logic and the Typst check.                                                                                                                              |
| m9      | Fixed     | Fractional question scores are in `rapport-valid` (73 values); the 3-page first section is listed under "Not covered yet" (Step 5).                                                     |
| n1-n4   | Fixed     | TAB removed; "Not covered yet" updated; `cursorLinks` counts `<a>` elements; `--check` fails on orphan case folders.                                                                    |
| n5      | No change | Already covered: `opdracht-grid-answers` renders `#num[1234.5]` as `1234,5` through `lib.typ`.                                                                                          |
