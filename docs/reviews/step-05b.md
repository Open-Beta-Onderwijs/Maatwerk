# Review: Step 5b (opdracht projects, SVG preview, batch, PDF merge, CLI)

Reviewer: fresh-context subagent, 2026-10-28. Scope: `git diff step-05a..HEAD` on `step/05-typst`
(`0d66b93` … `534a8b4`, 7 commits). I read every changed Rust file (`typst_svc/{project,opdracht,
batch,world,compile,diagnostics,mod,rapport}.rs`, `pdf_merge.rs`, `assets.rs`, `lib.rs`,
`examples/batch_memory.rs`, `maatwerk-cli/src/main.rs`), the templates (`opdracht-main.typ`, the
`lib.typ` header), the tests (`tests/typst_opdracht.rs`, `tests/support/mod.rs`,
`tests/typst_rapport.rs`, `maatwerk-cli/tests/typst_compile.rs`), `ui/src/editor-init.js`,
`tools/fixtures/export-opdrachten.mjs`, `tools/check-spdx.sh`, and the doc changes (`parity.md`,
`quirks.md` T28/T29, `naming-map.md`, `perf.md`, `backlog.md`, `THIRD_PARTY_LICENSES.md`). I
compared them with `_reference/main.js:600-930` (`CURSOR_FOREGROUND`, `typStr`,
`placeholderHeader`, `buildAssignmentWrapper`, the three IPC handlers, `cleanupStalePreviewFiles`),
`_reference/renderer/modals/opdrachten-genereren.js:310-390` (how the jobs are built),
`_reference/renderer/editor-init.js:348-351,579`, ADR-0002 sections 5 and 5a, and the `wrappers` and
`result.error` texts of the Typst goldens.

What I ran (PowerShell unless noted):

- `cargo test -p maatwerk-core -p maatwerk-cli --no-fail-fast`: all green (116 unit tests,
  `typst_opdracht` 24, `typst_rapport` 12, `cross_process`, CLI 1 + 4).
- `cargo clippy -p maatwerk-core -p maatwerk-cli --all-targets -- -D warnings` and
  `cargo fmt --all --check`: clean. `bash tools/check-spdx.sh`: clean. (Git Bash)
  `exportOpdrachten(undefined, { check: true })`: `[]`, so the Rust fixtures are in sync.
- A **temporary probe test** (`crates/maatwerk-core/tests/zz_review_probe.rs`, deleted afterwards)
  that compiled v1 opdrachten with teacher markup reading 20 kinds of paths, made three junctions
  (`images/<id>` out of the data dir, `images/<id>` to another opdracht's images, a junction inside
  `images/<id>` to the data root), compiled a `TypstProject::folder` whose root is a junction, ran
  30 batches of 16 jobs on 4 workers and checked that progress never went down, and deserialised
  `OpdrachtInputs` from reference-shaped JSON. Results are quoted below.

Overall, the step is in good shape. The v1 virtual project is a tight sandbox: I could not read
another opdracht, the data folder or a machine path through `opdracht_v1`. `opdracht-main.typ`
matches the reference wrapper in all three modes, and every opdracht, SVG and batch golden
passes. Only the JPEG photo uses the pixel tolerance. The batch keeps job order with any number of
workers, and `pdf_merge` pads exactly as pdf-lib did. I found no blockers or majors. The minors
are about the public API contract for Step 6/8 (serde defaults that differ from the reference job
semantics, and a `folder` constructor that takes any path), a pixel tolerance that now applies to
every golden, and some parity details that are not recorded yet.

## Blockers

None.

## Major

None.

## Minor

### m1. `OpdrachtInputs` deserialisation does not follow the reference's job semantics

- **Where:** `crates/maatwerk-core/src/typst_svc/opdracht.rs:73-93` (`#[serde(default)]` with
  `Default` = placeholder header), `:20-28` (`Mode`), `:51` (`observaties: Vec<Observatie>`).
- **Evidence:** the reference builds the wrapper with `job.header ?? {}` and `typStr(s ?? '')`.
  It treats any `mode` other than `'answers'` as student, and it uses
  `header.observaties ?? []` (`main.js:640-687`, `:867`). The probe deserialised reference-shaped
  JSON:
  - `{"mode":"student"}` (no header): `Ok`, with student `"Leerling Voornaam Achternaam"`. The
    reference printed empty fields. A real student's sheet would carry the editor's placeholder
    name.
  - `{"mode":null,"header":{}}`: `Err("expected value")`.
  - `{"header":{"observaties":null}}`: `Err("invalid type: null, expected a sequence")`.

  The reference UI always sends `header` and `mode` (`opdrachten-genereren.js:320-348`), so no
  current flow breaks. However, review 5a M1 introduced `normaliseForTypst`, which turns
  `undefined` into `null`. If Step 6 reuses it for the batch payload, an observatie list or a mode
  that is `undefined` fails the whole batch, where the reference rendered it.

- **Fix:** make the IPC contract explicit before Step 6. Either keep `Deserialize` off
  `OpdrachtInputs` and build it in the command handler from a `BatchJobDto` that mirrors the
  reference (`header: Option<OpdrachtHeader>` → empty when missing, `mode` via a lenient
  deserialiser: `"answers"` → `Answers`, anything else → `Student`, `observaties` null → empty), or
  make `OpdrachtInputs::default()` use an empty header and keep the placeholder for `preview()`
  only. Add unit tests for the three inputs above.

### m2. `TypstProject::folder` accepts any path and does not check links on its root

- **Where:** `crates/maatwerk-core/src/typst_svc/project.rs:29-37`.
- **Evidence:** the probe made `data/opdrachten/p` a junction to a folder outside the data dir and
  compiled `TypstProject::folder(data/opdrachten/p, "main.typ")`. Result: `Ok`, and the file
  outside the data dir was read. `opdracht_v1` and `rapport_world` use `.within(data_dir.root())`
  (review 5a n2), but `folder` does not. It also takes `impl Into<PathBuf>`, not a `DataDir` and a
  `RelPath`, so the CLAUDE.md rule "paths from the UI: reject `..`, absolute paths and symlink
  escapes (`maatwerk-core::paths`)" depends on whoever calls it in Step 8. For the CLI, an
  arbitrary folder is intended.
- **Fix:** split the constructor. Add `TypstProject::opdracht(data_dir: &DataDir, folder: &RelPath)`
  for the app (resolve through `DataDir::resolve`, mount with `.within(data_dir.root())`). Keep an
  explicitly named `TypstProject::cli_folder(root)` (or `pub(crate)` plus a CLI-only feature) for
  `maatwerk-cli`. Add a junction test like `review_n2_a_mount_outside_its_boundary_is_empty`.

### m3. The pixel tolerance of 3 levels now applies to every golden, not only to the JPEG photo

- **Where:** `crates/maatwerk-core/tests/support/mod.rs:117`, `:131-143` (`close`,
  `PIXEL_TOLERANCE`).
- **Evidence:** the justification is one case (`opdracht-images-student`, `foto.jpg`, zune-jpeg vs
  the reference CLI's decoder). The doc comment says "Everything Typst draws itself matches
  exactly", but nothing enforces that. The rapport goldens and the other ten opdracht/SVG goldens,
  which 5a and 5b found pixel-identical, are now also compared with ±3. A small regression in
  anti-aliasing, a light colour (for example a `#f5f5f5` box that becomes `#f2f2f2`) or a
  font-hinting change would pass unnoticed.
- **Fix:** pass the tolerance per case, `0` by default and `3` only for
  `opdracht-images-student`, or apply it only to pixels inside the image's bounding box.
  Alternatively, report the number of pixels that differ but lie within the tolerance, and require
  it to be 0 for the cases without JPEG. Keep `parity.md` in line ("pixel-identical" is stated for
  most rows).

### m4. Progress events can arrive out of order, and failed jobs count as done

- **Where:** `crates/maatwerk-core/src/typst_svc/batch.rs:124-128`;
  `tests/typst_opdracht.rs:484-486` (`progress.last().unwrap().done == total`).
- **Evidence:** `done.fetch_add` and the `progress(...)` call are two steps without a lock. Thread
  A can take `done = 2`, thread B takes `3` and reports first, and then A reports `2`. The UI bar
  then goes back, and the last event is not `total`, which `assert_batch_golden` asserts. That is a
  latent flaky test. The probe did not reproduce it in 30 × 16 jobs on 4 workers, because the
  window is nanoseconds against a compile of milliseconds, but nothing prevents it. The
  reference was single-threaded JS and its `done` was monotonic. It also counted only successful
  jobs (`done++` after `if (error) return`). The port reports a failed job as done too, and then
  the batch fails anyway.
- **Fix:** call `progress` while holding a small `Mutex<usize>` (increment and report under the
  lock), or use `fetch_max` on a "reported" counter and skip stale values. Increment only on
  success to match the reference. The test can then also assert that the values are strictly
  increasing.

### m5. Parity details of the v1 virtual project are not recorded

- **Where:** `crates/maatwerk-core/src/typst_svc/project.rs:52-71`, `world.rs:166-178`;
  `docs/reference/quirks.md` T28/T29; `docs/parity.md:86`.
- **Evidence:**
  1. **File name in errors.** The reference named the real file: `kapot.typ:3:23` (batch-error
     golden), and `opdracht_1756713600205.typ:9:27` after mapping `_preview_` back. The port
     names every v1 opdracht `opdracht.typ` (`batch_error_reports_…`: `┌─ opdracht.typ:3:24`).
     T28 covers only the column. The parity row mentions `opdracht.typ` in passing but does not
     call it a change. In a batch the label says which opdracht failed, and in the editor there is
     only one file, so it is acceptable, but it is a visible change to the error text.
  2. **Case sensitivity.** Mount prefixes are compared case-sensitively. Probe:
     `#read("Images/x/a.txt")` and `images/X/a.txt` give "file not found". The reference, on
     NTFS through the Typst CLI, found them. `images/x/A.TXT` works, because that part goes to the
     filesystem. The editor always wrote `images/<id>/` in lower case (`main.js:280`), so this is
     unlikely, but hand-typed paths in older opdrachten could break.
  3. **ADR wording.** ADR-0002 5a says "`images/<id>/` mapped to `images/`". The code mounts
     `images/<id>/` at `/images/<id>/`, which is correct for unmodified v1 sources (the
     `project.rs` doc explains this), but the ADR text now disagrees.
- **Fix:** add a quirk (or extend T28) for the file name. Either compare mount prefixes without
  regard to ASCII case on Windows, or record the difference in T29. Change the ADR sentence to
  "`images/<id>/` visible at the same path".

## Nits

- **n1.** `batch.rs:109-132`: a panic in one compile (a Typst bug on odd input) is not caught. The
  other workers do not see `failed`, so they compile all remaining jobs, and only then does
  `thread::scope` re-raise the panic. Wrap each `render_assignment_pdf` in `catch_unwind` and turn
  a panic into `BatchError::Compile` with an "interne fout" diagnostic. Otherwise, set `failed` in
  a drop guard.
- **n2.** Memory (`docs/perf.md`): every job's PDF is kept until the merge, whatever the number of
  workers, so capping parallelism would not help. With real photos (say 3 MB per opdracht, 60
  jobs) that is about 180 MB of PDFs, plus the lopdf documents and the merged output. Merging in
  job order as results arrive (a reorder buffer) would bound it. At least add this to the
  "not measured yet" line.
- **n3.** Tofu warnings are per job (`compile.rs:55`), so a class batch with a missing emoji gives
  30 identical warnings. Deduplicate them by message in `render_assignment_batch`, or in the UI.
- **n4.** `assets.rs:83-89` normalises only the BOM and CRLF. An editor that adds or strips a final
  newline, or trailing spaces, turns an unmodified `lib.typ` into a "changed" copy, which then
  never updates and keeps the "nieuwere versie" banner. Also strip trailing whitespace per line
  and at the end before hashing. Changing the normalisation later changes all released hashes, so
  decide this before the first release.
- **n5.** The `within` boundary is the data dir, not the opdracht's own `images/<id>`. Probe: if
  `images/k` is a junction to `images/other`, it reads the other opdracht's images. This needs
  local junction creation, so it is low risk. Use `.within(opdrachten/images)` for the image mount
  and `.within(opdrachten)` for the file mount.
- **n6.** `maatwerk-cli/src/main.rs:22`: `std::env::args()` panics on a non-UTF-8 argument. Use
  `args_os` and print a usage error. `std::fs::write(&out, …)` (`:121`) leaves a truncated PDF
  when writing fails partway. Use `storage`'s atomic write, or accept this for a headless tool.
- **n7.** The reference removed stale `_preview_*.typ` copies at start-up
  (`cleanupStalePreviewFiles`, `main.js:919-930`). The port no longer writes them, but colleagues
  still on the old app will leave some in the shared folder during the transition. Make sure the
  Step 7 migration (or the opdracht list) ignores or removes them. ADR-0003 C12 mentions them, but
  no step owns the cleanup.
- **n8.** `tools/check-spdx.sh` now exempts all of `crates/maatwerk-core/tests/fixtures/*`. That is
  fine for the generated `.typ`/images today, but it would also hide a future `.rs` helper placed
  there. Narrow it to `tests/fixtures/opdrachten/*`.

## Checked and found fine

- **Wrapper parity (`opdracht-main.typ` vs `buildAssignmentWrapper`):** same imports (bundled
  `lib.typ` instead of the shared, always-overwritten `data/opdrachten/lib.typ`), same order
  `show: setup` → cursor foreground → `setup_extra()`. The cursor show rule
  (`body => { set page(foreground: …); body }`) is equivalent to the top-level `#set page`. Answers
  mode is identical. Student mode passes the same arguments, including `exam_prefix: "N.a.v."`,
  and adds the answers only when `include_answers` is set. Header strings arrive as JSON strings,
  so quotes, backslashes, newlines, `#` and `$` (goldens `opdracht-grid-no-answers`,
  `-lib-features`) render as text. That matches `typStr`, which also left newlines raw. An empty
  observatie list is `()` in both. Without inputs, `main.typ` falls back to the placeholder header
  and student mode, with the same placeholder text as `placeholderHeader`
  (`main_typ_without_inputs_…`).
- **Paths B/C/D:** `OpdrachtInputs::preview` (placeholder, student, answers on) matches
  `renderAssignmentPdf` and `renderAssignmentSvg`. The SVG preview keeps the editor buffer in
  memory (`with_file`), with no `_preview_` copy and no `svg_preview/` folder, and returns one
  `typst_svg::svg` string per page, the same as `--format svg`. Images are data URIs. The cursor
  marker is renamed consistently in `editor-init.js` (marker, `a[href]`, label filter on `__`), in
  `opdracht-main.typ` and in the naming map. No `rtti-cursor`/`__rtti_` is left in `ui/src` or the
  templates.
- **Sandbox (probe and tests):** for a v1 opdracht, `images/<own id>` works.
  `images/<other id>`, `images/x/../other/…`, `/data/…`, `../…`, `/opdrachten/…`, `C:/…`,
  `//?/C:/…`, `\\?\C:\…`, a folder (`images`, `images/x`), an ADS suffix (`::$DATA`) and a
  trailing dot all fail with a virtual path and without the `--root` hint. A junction from
  `images/<id>` out of the data dir gives an empty mount, and a junction inside `images/<id>` is
  access denied. `opdracht_v1` rejects `../x.typ`, folders, `C:/x.typ`, `CON.typ`, `x.typ:s` and
  names without `.typ`. A non-ASCII name (`é ü.typ`) and `x.TYP` work. `sys.inputs` carries only
  serde-typed data, and `lib.typ` uses header strings as content, never `eval`. The
  `..`-above-root and drive-prefix denial (5a n1) is in `vpath_parts`, with a test.
- **Batch:** order is job order with 1 or 3 workers (test). Workers are
  `clamp(cpus - 1, 2, 4)`, the same as `max(2, min(4, cpus - 1))`, and never more than the job
  count. The first failure stops new jobs, and the lowest failed index is reported (T23
  documented). The error text has the reference's `Fout in opdracht "<label>":\n\n` prefix, and the
  empty-batch message is the same. Each job is its own World. The `FontStore` (an `Arc`, immutable,
  lazy `OnceLock` slots) and the embedded packages are shared, and the memo cache is global, with
  `comemo::evict(10)` per compile from several threads. That is safe; it only shortens cache
  lifetime. Mutex poisoning is handled.
- **`pdf_merge`:** padding rule identical to pdf-lib: only between neighbouring different keys,
  only on an odd count, never after the last key, blank page with the previous page's MediaBox.
  Inherited `MediaBox`/`Resources`/`CropBox`/`Rotate` are copied onto the page. Old catalogs,
  structure trees and metadata are pruned (T24 parity). Unreadable input names the part. The
  `batch-duplex` and `batch-answer-key` goldens match on page count, sizes, blank pages and text.
  `lopdf` 0.46 is MIT, with default features off.
- **CLI:** `typst compile` uses the file's folder as the root, so `../geheim.txt` is denied
  (test). Exit codes are 0, 1 and 2. Diagnostics go to stderr with relative names, and no PDF is
  written on error. `--input` splits on the first `=`.
- **Versioning:** `// maatwerk-lib 1` / `// maatwerk-main 1` lines, SHA-1 of the normalised text
  per released version, and a test that fails when the bundled file changes without a new row.
  5a n7 is resolved: the `lib.typ` header comment now matches ADR 5a.
- **Tofu:** glyph id 0 after layout gives one warning per distinct character, with location and
  hint (test without system fonts). With system fonts, the emoji header (📏, 👩‍🔬, 5️⃣) is
  pixel-identical to the golden, which covers the PLAN's emoji check.
- **Review 5a nits:** n1, n2 (rapport and v1 mounts), n3, n4 (`comemo::evict(0)` between the two
  compiles), n5 (text assertion), n6 (`Mount`/`WorldSpec`/`MaatwerkWorld::new` are `pub(crate)`)
  and n9 are done. n8 is in the backlog.
- **Architecture/maintainability:** no `tauri` in core. `typst-svg` and `lopdf` are added to
  `THIRD_PARTY_LICENSES.md`. Every new source file has an SPDX header. Files are a reasonable
  size: `typst_opdracht.rs` is the largest at 607 lines, and it is a test. No TODOs or dead code,
  except `#![allow(dead_code)]` in the shared test support, which is justified. The fixture export
  has a Node test that keeps the Rust copies in sync.

## Triage (implementer, 2026-10-28)

No blockers or majors.

- **m1 fixed:** `OpdrachtInputs` defaults to an empty header (the placeholder only through
  `OpdrachtInputs::preview`); `null` for `mode`, `include_answers`, `cursor`, `header` and
  `observaties` takes the reference default. Test `review_m1_missing_or_null_fields_*`.
- **m2 backlog** (Step 6/7): `folder` is CLI-only today; app constructor with `.within` when the app
  opens v2 folders.
- **m3 fixed:** tolerance 3 only for `opdracht-images-student`, 0 for every other golden.
- **m4 fixed:** progress is counted and reported under one lock, so `done` is monotonic. Failed
  jobs still count as finished; the batch stops at the first failure anyway and the UI then shows
  the error instead of the progress.
- **m5 recorded** in quirk T29 (file name in diagnostics, `images/<id>` path, case sensitivity).
- **n8 fixed** (SPDX exemption narrowed to `tests/fixtures/opdrachten/*`).
- **n1-n7:** `docs/backlog.md` ("From Step 5b").
