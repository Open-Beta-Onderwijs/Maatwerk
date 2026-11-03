# Review: Step 9 (AI-ready seams) and pre-cutover fixes

Reviewer: fresh-context subagent, 2026-11-02. Scope: `git diff step-08..step/09-ai-seams` (62
files, +2699/-124): commits 294161a (no compile debounce, delayed errors, `0.3.0-rc.1`; **not
listed in the hand-over, reviewed anyway**), 2b73704 (notices), 9a717f1 (migration report, PIN
4-8), 6da2ddf (headless opdracht API), 58968c6 (format docs, AI context, examples), 7c1a3cd
(ADR-0009). I checked the claims against the code and ran the CLI on scratch folders.

Ran: `cargo test -p maatwerk-core --lib assignment` (10 passed), `--lib migrate` (14), `--lib
auth` (14), `cargo test -p maatwerk-cli` (all pass), `npm test` (0 failures). I did not run
Playwright, clippy or the full gate.

## Summary

Step 9 delivers what the plan asks: `assignment check --json | render | export-lib`, a JSON
schema with a generated sample that a test validates, `docs/assignment-format.md`, a compact AI
context (~200 lines, well under 8k tokens) whose complete example and the five examples are
compile-checked by tests, and ADR-0009 with options A/B/C, the keychain, AVG/GDPR, human in the
loop, the check-fix loop, sandbox, cost, offline and a list of questions. Core has no tauri, the
CLI is a thin wrapper, the World sandbox from Step 5 is reused (an `../` read is denied, verified),
and the migration report reaches the DOM only through `textContent`.

No blockers. Two majors: (M1) the AI context teaches `setup_extra()` for document-wide set rules
and example 05 relies on it, but set rules returned from `setup_extra()` do not apply to anything
(verified by compiling); an AI or teacher following the doc gets silently ignored rules. (M2) the
"sees only one opdracht folder" guarantee is only as strong as the path you pass: a `.typ` file
anywhere makes its parent the sandbox root, including a data folder root or the v1 `opdrachten/`
folder. The minors are about `render` writing into (and able to clobber) the opdracht folder,
ambiguous exit codes, no compile time limit headless, a few inaccurate ADR/doc claims, STATE.md
not updated, and a timing-dependent e2e test.

## Blockers

None.

## Majors

### M1. `setup_extra()` set rules have no effect, but the docs and example 05 teach them

- `crates/maatwerk-core/assets/templates/opdracht-main.typ:46` (`#setup_extra()`)
- `docs/ai-context/assignment-authoring.md:107-108` (rule 11), `docs/assignment-format.md:60`
- `docs/assignment-examples/05-wiskunde.typ:1-7` ("een eigen stijlregel in setup_extra
  (genummerde vergelijkingen)")
- `crates/maatwerk-core/src/assignment/tests.rs:313-350` (only checks that it compiles)

**Evidence.** `main.typ` places `#setup_extra()` as content. A `set` rule inside a content block
is scoped to that block, so it ends where `setup_extra()`'s content ends. Verified with the
built CLI on an exported folder:

```typst
#let setup_extra() = [
  #set text(lang: "de")
]
#let render_uitleg() = [#context assert(text.lang == "de", message: "setup_extra not applied: " + text.lang)]
```

`maatwerk-cli assignment check ex` -> `error: opdracht.typ:5:34: assertion failed: setup_extra not
applied: nl`. So example 05's equations are **not** numbered, and rule 11 ("for document-wide
rules only, e.g. `#set math.equation(numbering: "(1)")`") is wrong. This is the file an AI is
given as ground truth; it will keep putting rules there and they will be silently ignored. The
reference wrapper (`_reference/main.js:652-655`) has the same shape, so this is a reference
quirk, not a Step 9 regression, but it is not in `docs/reference/quirks.md` and the new docs
present it as working.

**Fix.** Record the quirk in `docs/reference/quirks.md`. In the AI context and format doc, say
that `setup_extra()` cannot carry set/show rules (leave it `[]`) and that rules go at the top of
`render_uitleg()` / `render_opgaven()` (each scoped to that function). Remove the rule from
example 05 or move it into `render_uitleg()`, and add a test that proves the effect (for example
a `#context assert(...)` like above, or count numbered equations). Making `setup_extra` work
(e.g. `#show: body => { setup_extra(); body }` does not help either; it needs a show-rule
function) changes the opdracht format, so ask the user first.

### M2. The sandbox root is the parent of any `.typ` file passed, including a data folder

- `crates/maatwerk-core/src/assignment.rs:44-77` (`Assignment::open`)
- `crates/maatwerk-cli/src/main.rs` USAGE ("reads nothing outside it"),
  `docs/assignment-format.md:77-80`, `docs/adr/0009-ai-integration.md:16-17, 60-67`

**Evidence.** For a file, `open` takes `real.parent()` as root with no check of what that folder
is. `maatwerk-cli assignment check <data>/x.typ` (or a v1 `<data>/opdrachten/<id>.typ`) makes the
whole data folder (or every v1 opdracht) readable to that compile, and `#panic(read("2025-2026/
students-2025-2026.json"))` returns the content in `diagnostics[].message`, which option B feeds
straight back to the model. Verified on a synthetic folder: `"message": "panicked with:
\"[{\\\"naam\\\":\\\"Synthetisch Leerling\\\"}]\\n\""`. PLAN Step 9 says the CLI "only sees that folder" and ADR-0009
constraint 1 relies on it ("must not read the data folder beyond the one opdracht folder"). The
sandbox itself is correct (an `../` read gives "failed to load file (access denied)", verified),
and an external tool with file access could read the files anyway, so the hole is in the
guarantee the API advertises, not in the World.

**Fix.** In `Assignment::open`, refuse a root that is not an opdracht folder: require that the
root contains `main.typ` or `opdracht.typ`, refuse a folder that looks like a data folder
(`config.json`, `school.json`, `gebruikers/`, a `YYYY-YYYY` child) or is named `opdrachten`
(with a hint that a v1 opdracht needs the migration). Add tests for both. If the "lone `.typ`
file" case must stay, limit it to folders that pass the same test.

## Minors

### m1. `render` writes into the opdracht folder by default and can overwrite a source file

- `crates/maatwerk-cli/src/assignment.rs:185-192` (default output in `assignment.root()`),
  `:203` (`std::fs::write`)
- `docs/assignment-format.md:79-80` ("nothing is written to the data folder except the output you
  ask for"), `:92-93`

**Evidence.** Without `--pdf`, render writes `opdracht.pdf`/`antwoorden.pdf` into the opdracht
folder. In the shared data folder that file syncs to every colleague and shows up as a `Stray`
warning in Gegevenscontrole (`validate.rs:111-129`: only `.typ`, `opdracht.json` and images are
known in `opdrachten/<id>/`). Also nothing stops `--pdf` naming a source: `assignment render ex
--pdf ex/opdracht.typ` exited 0 and replaced `opdracht.typ` with `%PDF-1.7...` (verified). The
write is not atomic either. An AI agent will make exactly this mistake.

**Fix.** Default to the current directory (or require `--pdf`) when the root is inside a data
folder; refuse an output path that resolves to a file in the root with a `.typ`/`.json`/image
extension (Typst's own CLI refuses output == input); write via `write_atomic`. Correct the doc.

### m2. Exit code 1 means both "does not compile" and "could not open"; `--json` prints no JSON then

- `crates/maatwerk-cli/src/assignment.rs:63-68` (`open` -> `ExitCode::FAILURE`), `:91-116`
- `docs/assignment-format.md:89-90`, `docs/schemas/assignment-check.schema.json:5`

**Evidence.** `maatwerk-cli assignment check nope --json` prints `error (io): ...` on stderr, no
stdout, exit 1, the same code as a compile error. A check-fix loop keyed on the exit code then
tries to parse empty stdout. The docs only list 0/1/2.

**Fix.** Use a separate code (e.g. 3) for "cannot open/read" and document it, or with `--json`
print `{ "schema": ..., "ok": false, "error": {code, message} }` (schema update).

### m3. No compile time limit in headless `check`/`render`; ADR-0009 implies one

- `crates/maatwerk-core/src/assignment.rs:225-277`
- `docs/adr/0009-ai-integration.md:74-76` ("compile time limit of `instellingen.json`")

**Evidence.** The time limit is the editor watchdog only (`typst_svc/editor.rs:50-111`).
`main.typ` with `#for i in range(2000000000) { x += 1 }`: `timeout 20 maatwerk-cli assignment check
loop` was killed at 20 s (exit 124). Model-written Typst in a loop will hang the CLI (option B) or
an in-process call (option A).

**Fix.** Either give `check`/`render_pdf` a deadline (compile on a worker thread, return a
"Te lang bezig" diagnostic; `--timeout <s>` on the CLI) or state in ADR-0009 that the headless API
has no limit yet and an assistant must add one.

### m4. ADR-0009 option B overstates what catches edits outside the app

- `docs/adr/0009-ai-integration.md:51-53`

**Evidence.** "the editor's conflict bar and `validate-data` 'Buiten Maatwerk gewijzigd'
apply". Stamps exist only for JSON (`validate.rs:199-225`; `.typ` files are `Place::Other`,
`validate.rs:120`). An `opdracht.typ` changed by an external tool is not flagged by
Gegevenscontrole; only an editor that has the file open sees the hash change on save.

**Fix.** Correct the sentence: `.typ` files have no stamp; only the editor's CAS save catches a
concurrent change.

### m5. `docs/STATE.md` was not updated for Step 9 or the pre-cutover fixes

- `docs/STATE.md:1-9` ("Last updated: 2026-11-01 (Step 8 done) Branch: `step/08-editor`"),
  `:230` ("Wait for the user. Step 9 ... when asked")

**Evidence.** Five commits on `step/09-ai-seams` and STATE still describes Step 8. CLAUDE.md:
"Update `docs/STATE.md` after every sub-task ... Nothing may live only in context."

**Fix.** Add a Step 9 section (commits, what was built, the pre-cutover fixes, open questions =
ADR-0009 questions), update branch/date/next step.

### m6. `root` in the check JSON leaks the local path; docs show a format it never has

- `crates/maatwerk-core/src/assignment.rs:235`, `docs/assignment-format.md:118`,
  `docs/schemas/samples/assignment-check.sample.json:4`, `assignment/tests.rs:211`

**Evidence.** Real output: `"root": "C:\\Users\\Matthias\\AppData\\Local\\Temp\\...\\ex"`. In option
B this JSON goes verbatim to a model provider, carrying the teacher's Windows user name (often
their real name), which ADR-0009 constraint 1 is careful about. The docs and sample show
`"C:/opdrachten/voorbeeld"` (forward slashes), which the code never produces on Windows; the
test overwrites `root` before comparing.

**Fix.** Drop `root` from the report or make it the folder's base name (the caller knows the
path it passed), or make it opt-in; at least note in ADR-0009 that the JSON contains the local
path, and show a realistic value in the docs.

### m7. The new delayed-error e2e test depends on wall-clock timing

- `ui/e2e/editor.spec.ts:66-75`

**Evidence.** Line 71 asserts "no error underline yet" right after `expect.poll` sees the failed
update; it only holds if the poll plus that assertion finish within the 500 ms `ERROR_DELAY_MS`
window. Line 74 gives the clearing 300 ms. On a loaded CI runner either can flake.

**Fix.** Use Playwright's `page.clock` to control `setTimeout`/`performance.now`, or expose the
delay through a test hook and assert ordering rather than absolute timing.

### m8. PIN of 4 digits: the trade-off is not recorded

- `crates/maatwerk-core/src/auth.rs:26`, `docs/adr/0006-accounts-and-snapshots.md:17`

**Evidence.** The change is the user's decision (fine), but the ADR does not say what it costs:
10 000 PINs, Argon2id hashes in the shared folder (an offline guess of all 4-digit PINs at
~20-50 ms each takes minutes), and the in-memory throttle resets on app restart. The admin PIN
gates `resetPin` and `restoreFromSnapshot`. The ADR line also says "before 0.3.1" while the
workspace is `0.3.0-rc.1`, and exceeds the 100-column wrap.

**Fix.** Add one sentence to ADR-0006 on the strength (the PIN guards the shared PC, not the
files; 4 digits accepted by the user on 2026-11-0x) and correct the version.

## Nits

- **n1.** `crates/maatwerk-cli/src/data.rs:150-154`: `println!` with a literal newline inside the
  string literal; use `println!("\nVerslag: {f}")`.
- **n2.** `ui/src/screens/migration.ts:34`: "`${filesChecked} bestanden gecontroleerd`" says
  "1 bestanden"; the core text uses `plural()`.
- **n3.** `crates/maatwerk-core/src/assignment.rs` / `typst_svc/vragen.rs:112`: `punten:
float.nan` or a negative number gives `totalPunten` `null` (serde_json writes NaN as null) or
  < 0, both violating the schema (`type: number`, `minimum: 0`). Filter non-finite values, or relax
  the schema.
- **n4.** `docs/ai-context/assignment-authoring.md:132-150`: the JSON example omits the required
  `schema` and `root` fields; mark it as abridged so nobody writes a parser from it.
- **n5.** In `--answers` mode every vraag's `page` is 1 (verified): the vragen are laid out in a
  hidden `place` on page 1. The schema/doc say "1-based page the vraag is on". Document it, or
  emit `null` in answers mode.
- **n6.** `crates/maatwerk-core/src/assignment.rs:316-321, 333-344` (`export_lib`): an unreadable
  or locked existing file counts as "no clash" (`Err(_) => false`), and the writes are not atomic,
  so a failure part-way leaves a partial export. A junction at `<dir>/fonts` is followed. Low
  risk (the user picks the folder); at least mention it in the doc comment.
- **n7.** `crates/maatwerk-cli/src/assignment.rs:204` uses `out.display()`, `:207`
  `display_path(&out)`; use one.
- **n8.** `crates/maatwerk-core/src/migrate/mod.rs:27`: `report_path` is `pub` but only used inside
  `report.rs` and its tests; `pub(crate)` keeps the API small.
- **n9.** `ui/src/screens/migration.ts:15` and `gegevens.ts:32` each define the same `el` helper;
  now that migration imports from gegevens, share one.

## Checklist notes

1. **Parity.** Step 9 is new behaviour. The migration report and PIN 4-8 deviate on purpose
   (user); runbook, manual test, mock and ADR-0006 follow. The `setup_extra` scoping is reference
   behaviour (M1: record it, do not change silently).
2. **Correctness.** `Assignment::open` canonicalises (non-ASCII and `\\?\` paths handled;
   `display_path` strips the prefix). Missing folder/`main.typ` -> clear error. `opdracht.typ`
   -> `main.typ` mapping tested. Exit codes: m2. No time limit: m3.
3. **Data safety.** `export_lib` refuses to overwrite changed files unless `--overwrite`
   (tested, also end to end). `render` can clobber a source (m1). The migration report is
   written atomically next to the backup; a failure to write it only logs (app and CLI).
4. **Security.** World sandbox reused; `../` read denied (test + manual). The root choice is the
   gap (M2). No student data in headless compiles (placeholder header; `RenderOptions` carries
   only mode/answers). The migration report contains file paths, student IDs and Dutch messages
   only, in the local backup folder next to a zip that holds all data anyway: no new exposure.
   Migration UI uses `textContent` only. `root` path in JSON: m6.
5. **Architecture.** No tauri in core; CLI and command handler are glue; `migrate_data_folder`
   stays in `blocking`. `assets::FONTS` gained names cleanly. Public API small (n8).
6. **Tests.** Good coverage: schema validation of the real output, the sample as a golden, all
   docs examples and the AI-context example compile-checked in both modes, CLI end to end.
   Missing: an assertion that a documented feature has its effect (M1), root refusal (M2),
   render output guard (m1). Timing-dependent e2e: m7.
7. **Maintainability.** Docs are clear and cross-linked; STATE is stale (m5).
8. **Performance.** CLI is synchronous by nature; the app path is unchanged. The zero debounce
   (294161a) is measured in `docs/perf.md` and recorded in ADR-0002; the merge-while-compiling
   claim rests on the Step 8b coordinator.

**Doc accuracy checked against code:** check messages (all five match `vragen.rs:89-109`), CLI
flags and USAGE match the parser, exit 0/1/2 match (plus the gap in m2), JSON field names match
`CheckReport` (`camelCase`), `lib.typ` API table (signatures, 14/12 pt headings, 1.5 cm margin,
Source Serif 4 10.5 pt, `lang: "nl"`, STIX Two Math, table captions on top, `set-num` decimal
comma, packages and versions, Noto Color Emoji embedded), the `check --json` example positions
(column 26, range [70, 78], `main.typ:63`) are correct. Wrong: `setup_extra` (M1), stamps for
`.typ` (m4), `root` format (m6), "nothing is written to the data folder" (m1), answers-mode
`page` (n5). ADR-0009 covers every item PLAN Step 9 lists (A/B/C, keychain, only assignment text
and parameters leave the machine, human in the loop, check-fix loop, sandbox, cost, offline,
questions, nothing decided).

## Triage (implementer, 2026-11-02)

- **M1 fixed in docs, behaviour unchanged:** recorded as quirk T31 (the reference does the same,
  `main.js:655`); `assignment-authoring.md` rule 11, `assignment-format.md` and example 05 now put
  set rules at the top of `render_uitleg()`/`render_opgaven()`. Changing `main.typ` is a format
  change: question for the user (backlog "From Step 9").
- **M2 fixed:** `Assignment::open` only accepts a folder with `main.typ` and `opdracht.typ` and
  without `config.json` (`is_opdracht_folder`); test `only_an_opdracht_folder_can_be_the_sandbox`.
- **m1 fixed:** `render` needs `--pdf`, which must end in `.pdf`. Atomic write not added (output
  file chosen by the user).
- **m2 fixed:** exit code 2 when the opdracht cannot be opened; documented (no JSON then).
- **m3 backlog** (and noted in ADR-0009 constraint 4 and the format doc). **m4 fixed** (ADR-0009
  option B text). **m5 fixed** (STATE). **m6 fixed:** `root` removed from the check JSON (schema,
  sample, docs). **m7 backlog** (from commit 294161a). **m8 fixed** (ADR-0006 note; the version
  is 0.3.1 after this step).
- **Nits:** n1, n2, n3 (non-finite punten become null; `totalPunten` has no minimum), n4, n5
  (`page` is null in answers mode), n7, n8 fixed; n6, n9 backlog.
