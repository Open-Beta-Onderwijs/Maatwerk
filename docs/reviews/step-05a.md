# Review: Step 5a (Typst World and rapport PDF)

Reviewer: fresh-context subagent, 2026-10-28. Scope: `git diff step-04..HEAD` on `step/05-typst`
(`4f14a72` World + rapport PDF, `cc83cab` docs). I read every new Rust file (`build.rs`,
`assets.rs`, `typst_svc/{mod,world,fonts,diagnostics,compile,rapport}.rs`), the tests
(`tests/typst_rapport.rs`, `tests/support/mod.rs`), the three templates, and the doc changes
(`parity.md`, `quirks.md` T11/T26/T27, `naming-map.md`, `STATE.md`, `backlog.md`, `deny.toml`,
`THIRD_PARTY_LICENSES.md`, `tools/check-spdx.sh`). I compared them with `_reference/main.js:546-602`
(`toTypst` and the rapport wrapper), `typst-contract.md` sections 1, 2 and 9, ADR-0002 section 5,
`ui/src/domain/rapport.ts`, and the Typst 0.14.2 sources (`VirtualPath::new`, `FileError`,
`Tracepoint`).

What I ran (PowerShell unless noted):

- `cargo test -p maatwerk-core --no-fail-fast`: 103 unit tests, `cross_process` and the 9
  `typst_rapport` tests pass. In the first run, the Step 4b watcher test
  `m1_a_failed_own_write_releases_the_file` failed once (see m4).
- `cargo deny check advisories`: ok with the two ignores. `bash tools/check-spdx.sh`: clean.
- `git diff --no-index` of the templates against `_reference/include/templates/`. Only the intended
  changes are there: SPDX header and comments, the input guards, `rgb()` → `_color()`, `eval` →
  `eval(_guard_markup(..))`, `student.vragen` → the guarded `vragen`, and the `lib.typ` marker and
  counter renames. `base_assignment.typ` is unchanged.
- The vendored `cetz 0.3.4`, `unify 0.8.0` and `oxifmt 0.2.1` are byte-identical to the Typst
  package cache on this machine (which the reference CLI used). `zero 0.7.1` is identical to
  `_reference/include/packages`, ignoring CRLF. Every package keeps its `LICENSE`. All `@preview`
  imports in the packages and templates resolve to the four embedded packages. The only
  `oxifmt:0.2.0` hit is in a README, which is not embedded.
- A **temporary probe test** (deleted afterwards, tree clean) built `rapport_world` on a temp data
  folder with a `secret.json` next to `fotos/`, put teacher markup into `uitleg_rtti.R`, and also
  compiled 4 rapports in parallel threads. Results are quoted in the findings and in "Checked and
  found fine".
- The reference CLI (`_reference/bin/typst/win/x_86_64/typst.exe`, 0.14.2) in the scratchpad, to
  check the Typst semantics behind M1 and M2.

Overall, the step is solid. I could not escape the World sandbox: `..`, drive letters, UNC, ADS,
junctions, relative paths and unknown packages all fail with a virtual path in the message. The
two goldens match pixel for pixel. Diagnostics carry no machine paths, and parallel compiles work.
I found two majors, both in the data/template contract rather than in the World. The JSON data
path does not handle `undefined` the way `toTypst` did, so a missing optional field now fails the
whole rapport (M1). The new `$` guard on `uitleg_rtti` breaks text that rendered fine in the
reference (M2).

## Blockers

None.

## Major

### M1. `undefined` fields become missing keys (not `none`), so the rapport fails where the reference rendered

- **Where:** `crates/maatwerk-core/assets/templates/rapport-main.typ:7` (`json("data.json")`);
  `rapport.typ:260` (`[#o.uitleg]`), `:663`/`:665` (`exam_info.subject_display`), `:102`/`:112`
  (`fmt1(q.class_avg)`, `float(q.class_avg)`); `ui/src/domain/rapport.ts:133-135`
  (`subjectDisplayName(undefined)` returns `undefined`), `:339` (`uitleg: o.uitleg`, may be
  undefined); `tests/support/mod.rs:26-55` (`decode` drops `$undefined` keys); `docs/parity.md:62-63`.
- **Evidence:** Electron IPC uses structured clone, so the reference's `toTypst` saw `undefined`
  and `NaN`. It wrote `none` for `undefined` and `0` for `NaN`/`Infinity`
  (`main.js:559-561`). The port sends the data as JSON, where `JSON.stringify` drops `undefined`
  object keys and turns `NaN` into `null`. In Typst, `none + " Toets"` is `" Toets"` and `[#none]`
  is empty, so the reference rendered these cases. A missing key is a hard error. Probe results:
  - observatie without `uitleg` (the reference's observatie editor treats it as optional:
    `opdrachten-genereren.js:211` `obs.uitleg ?? ''`): `dictionary does not contain key "uitleg"` at
    `rapport.typ:260`, and the whole class rapport fails;
  - exam without `subject`: `dictionary does not contain key "subject_display"` at
    `rapport.typ:663`;
  - `class_avg: null` (what `NaN` becomes): `expected integer, float, or decimal, found none` in
    `fmt1`. The reference printed `0,0`.

  `parity.md` documents only the `NaN` case ("no golden depends on that"). It does not mention the
  dropped keys. The test harness copies the JSON behaviour (`decode` removes `$undefined`), so the
  tests cannot catch it. ADR-0002 section 5 says "where the two encodings differ … any visible
  diff goes to the user". This one has not gone to the user.

- **Fix:** restore the `toTypst` value semantics at the boundary, not in the template:
  - In `TauriApi.renderRapportPdf` (Step 6), serialise with a replacer that maps
    `undefined → null` and non-finite numbers → `0`, as `toTypst` did. A
    `JSON.stringify(v, (k, x) => …)` replacer is called for `undefined` members, and returning
    `null` keeps the key.
  - Alternatively, normalise in Rust. That cannot bring back dropped keys, though, so the JS side
    is needed anyway.
  - Change `support::decode` to map `$undefined` → `null` (keep the key) and `NaN` → `0`, so the
    harness models the reference.
  - Add tests: an observatie without `uitleg` and an exam without `subject` compile.
  - Record the encoding rule in `typst-contract.md` 2.2 / `parity.md`.

### M2. The `$` guard breaks `uitleg_rtti` text with an escaped `\$`, which the reference rendered

- **Where:** `crates/maatwerk-core/assets/templates/rapport.typ:34-36` (`_guard_markup`), used at
  `:294` and `:498`. The same counting is in `ui/src/domain/rapport.ts:183-190`
  (`sanitizeTypstMarkup`).
- **Evidence:** the guard counts every `$`, including escaped ones, and then replaces every `$`
  with `\$`. A teacher who writes `Kost \$5 per stuk.` (one escaped dollar, valid Typst) gets an
  odd count. The text becomes `… Kost \\$5 …`, where `\\` is an escaped backslash, so the `$` now
  opens math. The result is `error: unclosed delimiter` at `rapport.typ:498`, and the **whole
  rapport fails**. I reproduced this with the reference CLI and through `rapport_world`
  (probe `escaped-dollar`). The reference did not guard `uitleg_rtti` (T11), so this text rendered
  there. That makes it a regression introduced by this step. The quirks entry says the guard
  changes nothing for valid text, which is not true for this input. Leeradvies texts go through the
  same counting in `sanitizeTypstMarkup`. With an escaped `$` they also fail, as they did in the
  reference via T27, so the T27 fix is incomplete there too. `$` inside raw text (`` `$` ``) or a
  string (`#"$"`) has the same problem.
- **Fix:** count and escape only **unescaped** `$`. In Typst:
  `let toks = s.matches(regex("\\\\.|\\$")).filter(m => m.text == "$")` for the count, and
  `s.replace(regex("\\\\.|\\$"), m => if m.text == "$" { "\\$" } else { m.text })` for the
  escaping. Make the same change in `sanitizeTypstMarkup`, with a TS test. Add failing tests first:
  `Kost \$5` in `uitleg_rtti` renders "Kost $5", and an odd count of unescaped `$` next to an
  escaped one still shows the warning. Update T11/T27 in `quirks.md`.

## Minor

### m1. Trace frames say "error occurred error occurred in this call of function …"

- **Where:** `crates/maatwerk-core/src/typst_svc/diagnostics.rs:370-373` (`trace_message`).
- **Evidence:** `Tracepoint`'s `Display` already starts with "error occurred …"
  (`typst-library-0.14.2/src/diag.rs:276-292`). Every trace frame in the probe output reads
  `help: error occurred error occurred in this call of function \`rtti_uitleg_section\``. The
structured `TraceFrame.message` has the same duplication. No test asserts a trace line.
- **Fix:** `point.to_string()`. Add an assertion on a trace line to
  `rapport_without_watermark_fails_on_the_missing_file`.

### m2. Diagnostic positions use units the UI cannot use directly

- **Where:** `diagnostics.rs:305-316`, `:375-392`; `world.rs:358-362` (`decode_utf8` strips a BOM).
- **Evidence:** `range` is a byte range in the BOM-stripped text, and `column` counts Unicode
  scalar values. The consumers are JS (CodeMirror in the Step 8 editor, the rapport error `<pre>`),
  which work in UTF-16 code units. The two differ for any non-ASCII text before the error (é, —,
  emoji), and by 3 when the file has a BOM. PLAN listed flat fields
  (`file, line, column, range`); the nested `location` is fine, but the units are not documented
  anywhere a UI author would look.
- **Fix:** document the units on `Location`. Either add UTF-16 offsets now, or decide this
  before 5b/8 consume `range`. Add one test with a non-ASCII line.

### m3. Errors in teacher markup point at the internal template, not at the teacher's text

- **Where:** `rapport.typ:294`, `:498`; `diagnostics.rs:375` (spans inside `eval` are detached).
- **Evidence:** every eval error is located at `rapport.typ:498:14` (uitleg) or `:294`
  (leeradvies), with a trace into `rtti_uitleg_section`/`render`. The teacher cannot tell which of
  the four uitleg texts or which advice row is broken, or where in it. ADR-0002 5a asks for
  diagnostics "mapped to the user's file, not a hidden wrapper". For the rapport, the "user's
  file" is the field text.
- **Fix (Step 6 at the latest):** before compiling, parse each eval'd field in Rust
  (`typst::syntax::parse` in markup mode) and report syntax errors as
  `Diagnostic { file: "uitleg R" / "leeradvies T1 (laag)", line, column }` in Dutch. Or add a hint
  that names the field. Record the decision in STATE.

### m4. Flaky Step 4b watcher test (out of 5a scope, seen during the gate)

- **Where:** `crates/maatwerk-core/src/watcher/tests.rs:598-609`
  (`m1_a_failed_own_write_releases_the_file`).
- **Evidence:** it failed once (`left == right`, no change reported) in the first full
  `cargo test -p maatwerk-core` run. It passed in the next full run and in 5 isolated runs. My
  hypothesis, not verified: `{"v":1}` and `{"v":3}` have the same length, so with a coarse mtime
  the stat comparison can see "unchanged".
- **Fix:** make the test independent of mtime resolution (different length content, or an
  explicit mtime bump), and check the engine's stat shortcut for the same blind spot in
  production. If the cause is real, it is a missed external change.

## Nits

- **n1.** `world.rs:340-349` `vpath_parts` drops `..` components that `VirtualPath` keeps above
  the root. So `/../../../../Windows/win.ini` is looked up as `/Windows/win.ini`. In the same way,
  `/data/fotos/C:/Windows/win.ini` and `C:/Windows/win.ini` both end up as `/Windows/win.ini`
  (probe), because `VirtualPath::new` uses Windows path parsing. These are not escapes, since
  only visible files can be reached. Still, return `AccessDenied` when a `ParentDir` component is
  left, so the lookup does not silently remap.
- **n2.** `world.rs:243-250` canonicalises the mount root but does not check that it lies inside
  the canonical data dir. If `fotos` itself is a junction, the rapport (and eval'd markup) can read
  wherever it points. OneDrive does not sync junctions, so the risk is low. Add the check in
  `rapport_world`, or make `Mount::new` take a `DataDir` plus `RelPath`.
- **n3.** `AccessDenied` diagnostics carry Typst's CLI hints "cannot read file outside of project
  root" / "you can adjust the project root with the --root argument" (probe `ads`). These are
  meaningless in the app. Filter or replace them in `diagnostics::convert`.
- **n4.** `the_pdf_is_deterministic_with_a_fixed_clock` (`tests/typst_rapport.rs:159-169`)
  compiles twice in one process, where comemo can return cached results. That does not show
  determinism across runs. Compare against a stored SHA-256 of the PDF, or at least clear the
  cache (`comemo::evict(0)`) between the two compiles.
- **n5.** `t26_a_score_colour_that_is_not_a_colour_does_not_break_the_rapport` only checks the
  page count. Also assert the "N / 5" text, or sample a grey pixel at the dot.
- **n6.** Public API: `WorldSpec`/`Mount`/`MaatwerkWorld::new` are `pub`, so any caller (shell,
  CLI) can mount arbitrary folders. The sandbox policy then lives in `rapport.rs` by convention.
  Consider `pub(crate)` for those, and expose only the `rapport_world` constructor (and the
  opdracht constructor in 5b). `Diagnostic::error` and `local_now` have no callers yet.
- **n7.** `assets/templates/lib.typ:2-3` still says "Copied to data/opdrachten/lib.typ on startup
  (always overwritten)". That contradicts ADR-0002 5a (per-opdracht copies that are never
  overwritten once modified), and the ADR's `// maatwerk-lib N` version line is missing. This is
  for 5b, but the comment is wrong already.
- **n8.** Machine dependence of the pixel goldens goes beyond the emoji font that the backlog
  tracks. `typst-kit` lists system fonts **before** its embedded ones. A user-installed Libertinus
  Serif, DejaVu Sans Mono or New Computer Modern would therefore replace Typst's copy in
  `FontStore::shared()`, both in the tests and in production. This matches the reference CLI's
  order, so it is parity, but extend the backlog note. Optionally run the parity tests with a
  store of embedded fonts plus only Segoe UI Emoji.
- **n9.** ADR-0002 section 5 promises a warning when a glyph falls back to tofu. STATE lists an
  "emoji check" for 5b. Make sure that item covers the general tofu warning, not only emoji.

## Checked and found fine

- **Sandbox (probe, all via teacher markup in `uitleg_rtti`):**
  - `read("/__maatwerk/data.json")` and `read("/__maatwerk/rapport.typ")` are readable. That is
    by design: the request's own data and the template.
  - `/data/fotos/../secret.json`, `/../../…/Windows/win.ini`, `C:/Windows/win.ini` and
    `//localhost/C$/…` are `file not found` with a virtual path.
  - `school-watermerk.svg::$DATA` is `access denied` (`RelPath` rejects `:`).
  - A relative path resolves to `/__maatwerk/x.typ` (not found), `@local/x:1.0.0` is "package
    not found", and the junction test denies a link out of `fotos`.
  - `RelPath` also rejects device names, trailing dots and spaces, and control characters.
  - Canonicalise-then-read leaves a TOCTOU window and does not detect hard links. Both need
    local write access to the data folder, so I accept them.
  - Nothing is written to disk.
- **Diagnostics:** no machine paths. Errors from the watermark, mounts and packages show virtual
  paths (`/data/fotos/…`, `@preview/zero:0.7.1/src/zero.typ`, `rapport.typ`), and io error
  messages on Windows carry no path.
- **Thread safety / memory:** `MaatwerkWorld` caches per compile behind two mutexes with a fixed
  lock order (`sources` → `bytes`; `file` never takes `sources`). Holding the map lock while
  loading matches the Typst CLI's `SystemWorld`. `FontStore` is immutable after construction,
  and `FontSlot` loads lazily through a `OnceLock`. Four parallel rapport compiles produced
  identical output. `comemo::evict(10)` after each compile bounds the cache, as the CLI's watch
  mode does.
- **Packages/licences:** correct versions, `LICENSE` files present, README excluded from
  embedding, sorted table with a test, unknown versions give `PackageError::NotFound`. The
  `typst-kit` `packages` feature is off, so nothing is downloaded. `THIRD_PARTY_LICENSES.md`
  lists packages, fonts and the Typst-embedded fonts. The LGPL note for `cetz` (source in repo)
  is adequate.
- **`deny.toml` ignore:** RUSTSEC-2026-0194/0195 are quick-xml DoS advisories (quadratic attribute
  check, unbounded namespace allocation). `cargo tree` shows quick-xml 0.38.4 only via
  `citationberg ← hayagriva ← typst-library`, i.e. CSL style parsing. The inputs are local files
  (an opdracht's own CSL, or `/data/fotos` for the rapport), so "local DoS only" is accurate. The
  ignore is acceptable with the backlog entry.
- **Parity:** `rapport-one-student` and `rapport-valid` are pixel-identical at 30 ppi on this
  machine. `rapport-no-watermark` gives the same message with a virtual path. `rapport-markup`
  still fails with "unclosed delimiter", as the old guard output should. Int/float and key order
  survive the JSON route (`preserve_order`, `float_roundtrip`, integers stay `int` in Typst's
  `json`). The exceptions are the encodings in M1.
- **T26/T11 fixes:** `_color` accepts exactly the hex forms `rgb()` accepts and falls back to the
  not-entered grey. `_guard_vraag` covers both users of `vragen` (`lollipop_chart`,
  `rtti_summary`). The "failing test first" claim is plausible: `rapport-tiny` and an odd `$` in
  `uitleg_rtti` both fail against the unmodified reference template. Apart from M2, the T11
  treatment is what the user decided.
- **Architecture:** core gains `typst`/`typst-kit`/`typst-pdf` (exact `=0.14.2` pins), but no
  `tauri`. No command is wired yet (Step 6, recorded in STATE). `today()` and the PDF timestamp
  come from the injected clock. `build.rs` reruns per package directory.
- **SPDX:** all new sources have the header. The exemptions (vendored packages,
  `base_assignment.typ` as teacher starting content) are justified.

## Triage (implementer, 2026-10-28)

| Id                     | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1                     | Fixed: `normaliseForTypst` (`ui/src/domain/rapport.ts`) gives the `toTypst` values through JSON (`undefined` -> `null` with the key kept, non-finite -> `0`); test "review 5a M1". The Rust test decoder (`tests/support::decode`) now models it, and `review_m1_optional_fields_sent_as_null_compile_as_in_the_reference` covers a `null` observatie `uitleg`. The Tauri call itself is wired in Step 6 and must pass the payload through `normaliseForTypst` (STATE, parity row 28).                                                                                                                            |
| M2                     | Fixed, test first (`review_m2_an_escaped_dollar_is_not_counted_by_the_guard` failed with "unclosed delimiter"): `_guard_markup` and `sanitizeTypstMarkup` match an escape (`\` + any char) before `$` and count and escape only unescaped `$`. Side effects: the `rapport-markup` golden data (the reference guard's own unescaped `$`) now compiles with the warning (test `t27_rapport_markup_with_the_old_guard_output_now_compiles`), and the logic golden input `\$ ontsnapt $` is now guarded (the reference left it and the rapport failed); both are T27 outcomes, recorded in the tests and `quirks.md`. |
| m1                     | Fixed: trace frames use Typst's `Tracepoint` text unchanged; test `other_invalid_teacher_markup_still_fails_with_a_call_trace`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| m2                     | Fixed in the docs: `Location` states the units (columns in Unicode scalar values, byte range after a BOM). Conversion to UTF-16 belongs to the editor (5b/8).                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| m3                     | Backlog: name the broken teacher field in eval errors (pre-parse each field).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| m4                     | Test fixed (Step 4b scope): the colleague's content has a different size; 8/8 runs pass. The product edge case (same size within one mtime tick) is in the backlog.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| n1, n2, n3, n6, n8, n9 | Backlog (5b sandbox for opdracht folders, emoji/tofu check, API surface).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| n4, n5                 | Backlog (test hardening).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| n7                     | Fixed: stale `lib.typ` header comments; the version line comes with lib.typ versioning (5b).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
