# Review: Step 1 (reference study and architecture review)

Reviewer: fresh-context subagent, 2026-10-25. Scope: `git diff step-00..HEAD` on
`step/01-reference-study` (docs only, 5 commits `3d732bf..09ce1bc`), checked against `_reference/`
at `0e30a70` and PLAN.md sections 1, 2, 4, 6 (Step 1), 7-9. The authors' summaries were not
trusted; every claim below was checked in the reference source.

**Verdict:** a thorough, mostly accurate study. Every Step 1 deliverable exists, and 58 of the 66
sampled claims are correct. There are no blockers. Four majors should be fixed before the user
approval gate: one missing data-loss quirk, two design gaps in ADR-0002 and one licence question
that nobody asked. The minors are wrong citations, one wrong golden expectation and small
inconsistencies between the documents.

## Blockers

None.

## Majors

### M1. ADR-0002 does not say how output PDFs reach the viewer and the OS (conflicts with "no temp files")

- **Where:** `docs/adr/0002-target-architecture.md:83-90` (virtual FS, "nothing written to
  disk"), `:131` ("`shell:openPath` takes a data-relative path or a known output ID");
  `docs/architecture-review.md:117-118`; PLAN section 4 ("No temp files in the app or data
  folder").
- **Evidence:** the reference writes every result to disk and hands the path around:
  `temp/rapport_preview.pdf` (`_reference/main.js:586`, `:598`), `temp/<outputName>`
  (`main.js:909-911`). The viewer iframe loads it by `file:///` URL
  (`renderer/modals/rapport.js:310`, `docs/reference/ui-map.md:51`). "Afdrukken" calls
  `openPath(pdfPath)` so Acrobat/Edge prints it (`rapport.js:314-318`). With in-memory compiles
  something still has to hold the bytes, because pdf.js needs a URL or an ArrayBuffer and an
  external viewer needs a real file. Two questions have no answer anywhere: where an "output ID"
  points to, and how a batch PDF of tens of MB (200 students) gets to the UI.
- **Fix:** add a decision to ADR-0002 section 5/7. For example: outputs are written to the OS
  temp or app-cache dir (never `data/` or the exe folder), served to pdf.js as bytes or a `blob:`
  URL (or through Tauri's asset protocol with a narrow scope), and `openPath` accepts only IDs of
  those outputs. Also state the IPC transfer for large PDFs (binary response, not JSON/base64).
  Then add this to the user questions, or record it as a deliberate deviation from PLAN 4.

### M2. The Typst sandbox scope is looser than PLAN Step 5a, and the ADR does not say so

- **Where:** `docs/adr/0002-target-architecture.md:88-89` ("`/data/...` -> files in the data
  folder via the path guard"); `docs/architecture-review.md:135-138` ("(b) files under the data
  folder through the path guard"); `docs/reference/typst-contract.md:345`, `:380` ("any other path
  under appDir that teacher code names ... spec allows it").
- **Evidence:** PLAN Step 5a says "**Sandbox:** only `opdrachten/**` and `fotos/**` of the data dir
  plus embedded assets are readable". The reference runs with `--root <appDir>`
  (`main.js:592`, `:774`, `:820`), so today a teacher's opdracht can `read()`/`json()` every score
  and student file. ADR-0002 is supposed to replace PLAN section 4, and it keeps the reference's
  wide view without saying so. This is a security boundary (PLAN names it as the basis for later
  AI content), so it should not be left ambiguous.
- **Fix:** state in ADR-0002 section 5 that the World serves only `opdrachten/**` and `fotos/**`
  (plus the embedded files) as PLAN 5a says. Record it as a deliberate deviation from the
  reference: a teacher file that reads scores or students would stop compiling. Add it to the
  user questions, or at least to the "changes behaviour" list.

### M3. The reference app has no licence, but its code goes verbatim into a public AGPL repo; nobody asked about this

- **Where:** `docs/architecture-review.md:69-85` (dependency review); `docs/reference/VERSION.md:11`
  ("Licence: **None.**"). No user question covers it (`architecture-review.md:162-174`).
- **Evidence:** later steps copy reference code into the repo and into the exe: Step 2b copies
  `toTypst`, `buildAssignmentWrapper`, `placeholderHeader` and `typStr` into
  `tools/reference-shims/`, Step 3a imports `_reference/renderer` verbatim, and Step 5a embeds
  `lib.typ`, `rtti_export.typ` and `base_assignment.typ` into the exe. Code without a licence is
  all rights reserved. PLAN Step 1 asks for "licences of **every** dependency", and the reference
  is the biggest one. All 20 reference commits and this repo's commits share the author
  `Liveshort`, so the user is probably the copyright holder and one confirmation settles it.
- **Fix:** add a row to the dependency table and a user question: "Confirm that you hold the
  copyright of RTTI_analyse_feedback (all commits) and relicense it as AGPL-3.0-or-later for
  Maatwerk." Record the answer in ADR-0001 and `THIRD_PARTY_LICENSES.md`/README.

### M4. Missing data-loss quirk: re-importing a groups CSV wipes the members of existing groups

- **Where:** not in `docs/reference/quirks.md`. Only mentioned neutrally in
  `docs/reference/data-files.md:273` and `docs/reference/business-rules.md:568-570`.
- **Evidence:** the import builds each group with `student_ids: []` and `docenten` from the CSV
  (`_reference/renderer/modals/groep-edit.js:535-543`). Nothing checks for an existing group with
  the same name (`:483-545`). `Store.upsertGroups` saves with `force: true`
  (`renderer/store.js:478-482`), and `saveEntity` replaces the whole file with the new object
  (`store.js:116-122`). Re-importing a CSV that contains an existing group name (same
  `makeGroupId`) therefore silently removes all its students and its other teachers, and resets
  `subcategory` and `_meta`. There is no confirmation step.
- **Fix:** add it as a B or D item (e.g. "B31 · Group CSV import overwrites existing groups,
  dropping `student_ids`"). Add a golden candidate to `business-rules.md` section 11, and add it to
  user question 5 (fix during the port vs. keep for parity).

## Minors

### m1. Golden candidate 21 has the wrong expected value

- **Where:** `docs/reference/business-rules.md:646` ("typed `'10,04'` is stored as 10.0").
- **Evidence:** `parseGradeInput` rejects the value before rounding:
  `if (isNaN(n) || n < 1 || n > 10) return NaN;` (`_reference/renderer/screens/scores.js:663-667`).
  10.04 > 10, so it is rejected with the error toast.
- **Fix:** "`'10,04'` is rejected (checked before rounding); `'9,96'` is stored as 10".

### m2. Wrong `file:line` citations

- `docs/reference/business-rules.md:219`, `:641`, `:642` and `docs/reference/quirks.md:219` cite
  `utils/colors.js:202-206` / `:204-206`. That file has 58 lines; `isFail` is at
  `renderer/utils/colors.js:38-40`.
- `docs/reference/business-rules.md:408` cites `store.js:50-60` for the observatie subject match.
  It is `renderer/store.js:216-224` (`obsMatchesSubject`), which `data-files.md:137` cites
  correctly.
- **Fix:** correct them. Step 2 tests trace back to these citations.

### m3. The `opdrachtMatchesExam` pseudo-code describes a substring match

- **Where:** `docs/reference/business-rules.md:423`
  (`String(jaarlagen) contains String(exam.jaarlaag)`).
- **Evidence:** the code compares element by element: `jl.map(String).includes(String(exam.jaarlaag))`
  (`renderer/store.js:1221`). Read literally, the pseudo-code is a substring test on the joined
  list: `String(["12"])` = `"12"` "contains" `"1"`, so jaarlaag 1 would fit an opdracht for
  jaarlaag 12. That is a different rule.
- **Fix:** `jlOk = jaarlagen empty || !exam.jaarlaag || jaarlagen.map(String).includes(String(exam.jaarlaag))`.

### m4. typst-contract contradicts itself on `maxBuffer`

- **Where:** `docs/reference/typst-contract.md:32` ("Paths B, C and D set `maxBuffer: 10 MiB` ...;
  A and B use the 1 MiB default").
- **Evidence:** B (`app:renderAssignmentPdf`) has no options object (`_reference/main.js:709-712`).
  Only C (`:775`) and D (`:821`) set it.
- **Fix:** "Paths C and D set ...; A and B use the default."

### m5. The architecture review describes global state wrongly

- **Where:** `docs/architecture-review.md:59` ("Classic scripts sharing `window`-level globals
  (`Store`, `Sync`, `Presence`, `App` helpers)"). ADR-0002 section 6 (`:111`) builds on this.
- **Evidence:** only `store.js` and `custom-select.js` are classic scripts
  (`renderer/index.html:312-314`). `app.js` is `type="module"`, and `renderer/sync.js` /
  `presence.js` are ES modules with `export` and `import` (`sync.js:22`, `presence.js:17`).
  `Store` and `CustomSelect` are lexical globals, **not** `window` properties. `ui-map.md:29-31`
  states this correctly, so the two documents contradict each other.
- **Fix:** use `ui-map.md` section 1 wording in the review (two classic scripts that define
  `Store`/`qKind`/`CustomSelect`; everything else is already an ES module with an import cycle
  through `app.js`). The Step 3a Vite work is smaller than the review implies.

### m6. The licences of Typst's embedded fonts were not reviewed

- **Where:** `docs/architecture-review.md:83` (only Libertinus listed);
  `docs/adr/0002-target-architecture.md:98` ("Typst's default assets (Libertinus etc.)");
  `docs/reference/typst-contract.md:356`, which lists New Computer Modern (+Math) and DejaVu Sans
  Mono as available.
- **Evidence:** `typst-assets` fonts include New Computer Modern (GUST Font Licence) and DejaVu
  Sans Mono (Bitstream Vera licence). Neither is on the PLAN 2.5 list or in the `deny.toml`
  allowlist. `cargo deny` checks only the crate licence (Apache-2.0), not the font data inside it.
- **Fix:** either embed only the fonts that are needed (Libertinus Serif, plus Source Serif 4 and
  STIX Two Math from `include/fonts`) and say so in ADR-0002, or evaluate GFL and Bitstream Vera
  and add them to the policy. Either way, list the fonts by name in the dependency table.

### m7. The user questions miss several decisions

- **Where:** `docs/architecture-review.md:162-174`.
- **Missing:**
  - Q5 lists only some of the data-loss quirks. U9 (editor loses the last edits on close),
    U3 (save errors invisible) and D25 (iframe promise hangs) also count as "crash/data-loss"
    under the review's own rule (`:160`), and so does M4.
  - ADR-0003 C6 and C11 say "could also be done in the port (ask)" (`0003:85-86`, `:128-129`),
    but no question asks it.
  - Deviations from PLAN that the user should approve explicitly: 28 instead of 29 bridge
    methods (`0002:34-37` vs PLAN Step 3a "the 29 methods"); `checkJs` off for untouched legacy
    files (`0002:121`) vs PLAN 3a "`allowJs` + `checkJs` (lenient)"; the atomic-write temp file
    next to the target vs PLAN 4 "no temp files in the app or data folder" (`0002:60-62`; that one
    is well argued, but still a deviation).
  - M1, M2 and M3 above.
- **Fix:** add them to section 7 or to a short "deviations from PLAN" list in ADR-0002.

### m8. ADR-0002 keeps a new `rtti` path in the virtual file system

- **Where:** `docs/adr/0002-target-architecture.md:84-85` (`/temp/rtti_export.typ` -> embedded
  `rapport.typ`, "path kept virtual for parity of relative imports").
- **Evidence:** PLAN 2.5 says new identifiers never use `rtti`, and `naming-map.md:19` maps the
  template copy `temp/rtti_export.typ` to `rapport.typ`. The wrapper is generated in memory, so
  its import can point anywhere. The old path would also appear in diagnostics.
- **Fix:** serve it as e.g. `/__maatwerk/rapport.typ` and generate the wrapper import
  accordingly.

### m9. Smaller gaps and risks in ADR-0002

- `:50`: `data:changed` gets an "own-write flag". The reference never emits own writes, and
  section 4 (`:76`) still suppresses them. Clarify whether own writes are now emitted (a behaviour
  change for `Store.applyExternalChange`) or whether the flag is internal only.
- `:57-59`: "byte-identical for unchanged content" does not hold for every number. JS writes
  `1e+21`, serde_json/ryu writes `1e21`, and an f64 that Rust computes as integral prints as
  `6.0`. Today the values only pass through, so the risk is small, but a Step 4 test should pin
  the formatting.
- `:129`: the capabilities list (dialog, opener) has no clipboard image source for
  `readClipboardImage` (`main.js:338-341`). Name the plugin, or say it is read in Rust.
- `:135-136`: Tauri's log dir on Windows is under `%LOCALAPPDATA%` (non-roaming), not `%APPDATA%`.
  Check this, because roaming profiles on school PCs would sync logs.
- The risks miss in-process Typst memory and cache growth across a 200-job batch and many live
  previews (comemo eviction). Add it to the Step 5 and Step 8 notes.

### m10. ADR-0003 C1 ignores what an old app does on a v2 folder

- **Where:** `docs/adr/0003-data-format-v2-candidates.md:33-40`.
- **Evidence:** a v1 app started on the cutover folder runs `migrate()` (`store.js:318-319`) and
  `seedInitialData()`. That rewrites `opdrachten/lib.typ` when the hash differs and seeds
  `gebruikers.json` if it is missing (`main.js:965-1003`). A `schema_version` field does not stop
  any of this.
- **Fix:** add this to C1's risk. Consider a tripwire that makes v1 refuse the folder, or the
  cutover runbook rule "remove the old exe first" (Step 7).

### m11. STATE and the plan status are stale

- **Where:** `docs/STATE.md:9-11` ("Done since last tag: (nothing yet)"), `:26` (four reader
  subagents "in progress"); `PLAN.md:96` (Step 1 still `todo`).
- **Fix:** update both before the stop. PLAN 2.1 and 2.2 require this.

## Nits

- **n1.** `docs/reference/metrics.md:340` says "see quirk Q1". There are no Q IDs; it means U1.
- **n2.** `docs/reference/quirks.md:54` says "after 5 failed renames". It is 6 renames
  (attempts 0-5, 5 retries, `sync.js:49-57`). `docs/architecture-review.md:36` says "SHA-1 CAS
  (5 retries)". It is 5 attempts, i.e. 4 retries (`store.js:71`).
- **n3.** `docs/reference/data-files.md:287-288`: `calcResults` accepts `'N'` case-insensitively
  (`String(raw).toUpperCase() === 'N'`, `store.js:680`), so `'n'` counts too.
- **n4.** Quirks are cited by class instead of ID: `architecture-review.md:43` ("T-quirks" ->
  T18), `:171-172` ("B: CSV BOM" -> B22, "B: `wis*`" -> B9), `0003:76` ("D-quirks" -> D15/D16),
  `0003:100` ("B-quirks" -> B21/U16), `0003:126` ("B-quirk" -> B9).
- **n5.** `docs/schemas/samples/exam-resit.sample.json:23` has `volgnummer: 302`. A resit spreads
  the parent (`renderer/modals/herkansing.js:120-121`) and `upsertExam` keeps an existing
  `volgnummer` (`store.js:531-533`), so it should be the parent's `301`. By B25 it would also
  inherit the parent sample's `opdrachtenCijfer`. Samples will seed `tools/fixtures`, so make them
  realistic.
- **n6.** "105 items" (`architecture-review.md:5`) counts duplicates: D21/T12, D22/T13, D23/T5,
  D24/T22, U5/B4+B5. Cross-reference them so they are not triaged twice.
- **n7.** `docs/reference/business-rules.md:568-569`: group import writes
  `subcategory: parsed.subcategory ?? undefined`, so a missing subcategory is **omitted**, not
  `null` (`groep-edit.js:541`). The group schema is right.
- **n8.** `docs/adr/0002-target-architecture.md:138-139` says session state is "not migrated",
  while `docs/reference/naming-map.md:20` proposes an optional one-time import. Pick one.
- **n9.** PLAN asks for schemas "checked against generated synthetic samples". The samples are
  hand-written, which is fine until `tools/fixtures` exists. The schemas also do not cover
  literal-`null` legacy stub files (D12); `validate-data` (Step 7) must know about them.

## Completeness against PLAN Step 1

| Deliverable                                                                                 | Status                                                                                      |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `ipc-api.md`: 32 handlers + preload, args, results, errors, side effects, callers           | done                                                                                        |
| `data-files.md`: file types, fields, IDs/slugs, `_meta`, writers, concurrency               | done                                                                                        |
| Draft JSON Schemas + synthetic samples                                                      | done (12 schemas, 13 samples, all valid; n5, n9)                                            |
| `business-rules.md`: grade, n-term, CvTE, tags, kinds, score values, best attempt, coupling | done (m1-m3)                                                                                |
| `typst-contract.md`: data, `lib.typ` API, markers, wrapper, root/path rules                 | done (m4)                                                                                   |
| `ui-map.md`                                                                                 | done                                                                                        |
| `quirks.md`                                                                                 | done, one data-loss item missing (M4)                                                       |
| `naming-map.md`                                                                             | done; a grep for `rtti` identifiers in the reference found nothing unmapped                 |
| Review: verify PLAN section 8                                                               | done (12 claims)                                                                            |
| Measurements: sizes, functions, complexity, duplication, global state, `innerHTML` + escape | done (m5 on global state)                                                                   |
| Dependency review: licences of every dependency, unused deps, CDN                           | mostly; reference itself (M3) and embedded fonts (m6) missing                               |
| Handsontable features for Step 3b                                                           | done (29 items, `metrics.md` section 8)                                                     |
| Security notes: CSP, path handling, Typst sandbox                                           | done; sandbox scope ambiguous (M2)                                                          |
| Keep / change now / change later table                                                      | done; consistent with ADR-0002                                                              |
| ADR-0002                                                                                    | done (M1, M2, m8, m9)                                                                       |
| ADR-0003: cost/benefit/risk per candidate, pick nothing                                     | done: status "open", all 13 candidates rated, PLAN's examples covered (C1-C5, C8/C10) (m10) |

## Consistency checks

- Handler and method counts agree across documents. There are 32 handlers and 34 bridge members
  (32 invoke wrappers + 2 event subscriptions). 29 handlers have a call site; 28 remain after
  dropping `renderAssignmentPdf`. The naming map's "31 called" is the 29 plus the 2 event
  subscriptions. PLAN's "29 bridge methods used" matches.
- Every quirk ID cited in the review and the ADRs exists: D1-D6, T1, T2, T5, T6, U2, U4, U6, U7,
  D3, D4. The class-only citations are n4. `metrics.md` cites a non-existent Q1 (n1).
- ADR-0002 matches the review's change-now table: storage, bridge errors, tauri-specta, packages,
  `lopdf`, CSP, editor allowlist, domain lift-out without merging. The only gap: M1 and M2 are
  missing from both.
- ADR-0002 vs ADR-0001: no contradiction (Tauri 2, Typst crate, Windows first, JS UI kept, no AI).
  ADR-0002 vs PLAN 2.5: path rule, `spawn_blocking`, naming and licences are respected, except m8
  (`rtti` path) and m6 (font licences not on the allowlist).
- `naming-map.md` vs PLAN 2.5: the bridge, `rapport.typ`, the `<__maatwerk_*>` markers and the
  identifier all match; `lib.typ` imports stay unchanged; framework names stay. Correct.

## Hard rules

- No real student data: the samples use "Leerling Een/Twee", "Docent van Voorbeeld",
  "Voorbeeldschool" and ids `9000xx`. The only names in the docs are the reference's own
  placeholder strings (`lib.typ` default "Sandra Jansen", `placeholderHeader`).
- `_reference/` is untouched: `git -C _reference status --porcelain` is empty, HEAD is `0e30a70`,
  and no `_reference` path appears in the diff.
- All docs are in English. Dutch appears only in quoted UI strings and domain terms.

## Verified

### Claims checked: 66; correct: 58

Wrong or misleading (8): business-rules golden 21 (m1); the two `colors.js` / `store.js:50-60`
citation sets (m2, counted as 2); the jaarlagen pseudo-code (m3); typst-contract `maxBuffer` (m4);
the review's global-state claim (m5); metrics "Q1" (n1); quirks D9 rename count (n2).

Correct (58), each checked at the cited `_reference/` lines:

- **IPC:**
  - 32 `ipcMain.handle`
  - `readJson` returns null for missing and for corrupt files
  - `readJsonVersioned` `{data,hash}` / `{error}`
  - `writeJson` CAS rule (`expectedHash ?? null`)
  - lock only for non-`/scores/` paths, mkdir before the lock, `acquireLock` outside the try
    (rejects)
  - `listYears` regex, descending sort, `[]` on error
  - `deleteFile` without mkdir rejects
  - `writeTextFile` has no lock and no CAS
  - `listImages`: 48 px thumbs, null for SVG, `nl` sort
  - `cleanImageName` rules
  - `presence:update` marks the previous user offline
  - `readPhotoAsDataUrl` mime map
  - SVG render: basename check, `_preview_` copy, `svg_preview` wipe
  - batch: validation, `BATCH_PARALLEL`, first failure stops, initial `done: 0`
  - duplex padding rule and blank-page size
  - editor proxy: 10 types; the parent checks `evt.source`, the iframe accepts any sender
- **Storage and watcher:**
  - `writeFileAtomic`: 30/60/90/120/150 ms `Atomics.wait`, then the direct-write fallback
  - ignore list (`fotos bak templates temp`, top-level only), `_preview_`, `.json`/`.typ`
  - timings 500/100/20000/30000 ms; one retry after 1 s on unparsable JSON
  - poll scope = active year from `config.json`
  - `noteWrite`/`noteDelete`
  - `lib.typ` copied only on a SHA-1 difference, no noteWrite
  - `stampMeta` fields
  - `saveEntity` rev check and `force`
  - `makeExamId`/`makeGroupId` slug
  - opdracht id `^[\w-]+$`
  - `Store.update`: 5 attempts, no delay
  - `upsertGroups` uses `force`
- **Business rules:**
  - `calcResults` handling of N, invalid, bonus and diag
  - `calcGrade` formula and branch order (the algebra in section 3.2 also checks out)
  - `round1` and `overrideStale`
  - `computeBestGradeMap`: strict `>`, `-Infinity`, nulls skipped
  - `resolveBestAttempts`: `?? -1`, original kept
  - grade card: strict `<` on `round1`
  - threshold `n <= 1` rejected
  - `currentSchoolYear`: `getMonth() >= 7`
  - `computeRowStatus` counts every question
  - resit `attempt = resits.length + 2`
  - `wis*` advice-key mismatch (B9)
- **Typst:**
  - `toTypst` grammar
  - wrapper text (`buildAssignmentWrapper`, `CURSOR_FOREGROUND`)
  - cetz 0.3.4 / unify 0.8.0 imported but not vendored; zero 0.7.1 vendored; licences
    LGPL-3.0-or-later / MIT / MIT-0 match the `typst.toml` files in `%LOCALAPPDATA%\typst\packages`;
    cetz depends on oxifmt 0.2.1
  - footer `#pg / 2` hard-coded; rapport has no `lang`, `lib.typ` sets `lang: "nl"`
  - `--root appDir` and the relative import
- **Review and metrics:**
  - 81 `innerHTML` assignments in 19 files
  - unescaped `rapport.js:446,455-457`, `startup.js:26-34`, `groep-leerlingen.js:182`
  - `escHtml` does not escape `'`
  - 11 CDN URLs, no SRI, CodeMirror `@6`
  - `Store` IIFE 1,567 lines with 66 bridge calls
  - file sizes and the 22.6k total; 6 JS files over 1,000 lines
  - `docx` never imported
  - `contextIsolation`/`nodeIntegration` and the current CSP
  - Handsontable: `MAX_HISTORY` 50, `REMOTE_FLASH_MS` 2000, licence key, `enterMoves`,
    NumpadMultiply/Divide, no frozen rows or columns
- **Quirks and UI:**
  - U1: undo listener removed by `destroyHotInstances`
  - U2: `guard.processing` drops changes
  - D14: lock decided by substring
  - presence timings 15/5/60/120/5 s
  - editor autosave 600 ms, cursor render 400 ms

### Schemas

- Ran the README command with ajv 8 / ajv-cli 5 from the scratchpad install (`--spec=draft2020
-c ajv-formats --strict=true --allow-union-types --all-errors`): all 13 samples `valid`, all 12
  schemas compile.
- Spot-checked three schemas against the reference:
  - `scores.schema.json`: value union `number|null|string` (`scores.js:677-684`), overrides
    `{cijfer 1..10, berekend}` (`scores.js:663-667`, `store.js:617-627`), observations arrays.
    Correct.
  - `presence.schema.json`: the shape matches `presence.js:38-49` and `:84-96` and
    `markPresenceOffline` (`main.js:416-425`), and the closed shape fits.
  - `exam.schema.json`: fields match `toets-edit.js:257-276` and `:711-725`, and
    `herkansing.js:120-137`. `periode` is a string or null (`toets-edit.js:231`). The resit
    sample is unrealistic (n5).
  - Also looked at `group.schema.json` and `students.schema.json`: correct (`subcategory` is never
    null for groups, n7).

### Commands run

- `git status`, `git diff step-00..HEAD --stat`, `git log step-00..HEAD`
- `git -C _reference status --porcelain` (empty), `git -C _reference rev-parse HEAD`
- `git -C _reference log --format=%an` (only `Liveshort`)
- `grep -c ipcMain.handle main.js` (32)
- `grep -rn "innerHTML\s*=" renderer` (81 in 19 files)
- `grep` for CDN URLs, `isFail`, `obsMatchesSubject`, `MAX_HISTORY`, `REMOTE_FLASH_MS`,
  `licenseKey`, `fixedRows`/`fixedColumns` (absent), `rtti` identifiers (naming-map completeness)
- `wc -l` on the reference sources
- `grep license/version` on the `cetz`/`unify`/`oxifmt` `typst.toml` in the local Typst cache
- the ajv loop above
- `sed -n` reads of `main.js`, `sync.js`, `store.js`, `screens/scores.js`, `presence.js`,
  `modals/{rapport,herkansing,toets-edit,groep-edit,opdrachten-genereren,editor}.js`,
  `editor-init.js`, `include/templates/{rtti_export,lib}.typ`, `index.html`, `package.json`,
  `.github/workflows` (core-has-no-tauri check present) and `deny.toml`

## Triage (implementer, 2026-10-25)

| Finding                | Decision                                                                                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1                     | Fixed: ADR-0002 section 9 (output PDFs in memory, custom URI scheme for the viewer, cache folder outside OneDrive for print/open); asked as question 6 in the architecture review.  |
| M2                     | Fixed: Typst readable scope is `opdrachten/**` and `fotos/**` (PLAN 5a) in ADR-0002 section 5 and the review's security notes, recorded as a deliberate narrowing of the reference. |
| M3                     | Resolved by the user on 2026-10-25: they are the original author of the reference repo. Recorded in the review's section 4.                                                         |
| M4                     | Fixed: quirk D34 added; included in question 5.                                                                                                                                     |
| m1-m4                  | Fixed (golden 21, citations, `opdrachtMatchesExam` pseudo-code, `maxBuffer`).                                                                                                       |
| m5                     | Fixed (global state row).                                                                                                                                                           |
| m6                     | Fixed: font licences added to the dependency table; decision in Step 5.                                                                                                             |
| m7                     | Fixed: questions 5-7 extended/added, "Deviations from the plan" list.                                                                                                               |
| m8                     | Fixed: virtual path `/__maatwerk/rapport.typ`.                                                                                                                                      |
| m9                     | Fixed: own-write wording, JSON number-format caveat, clipboard plugin, `%LOCALAPPDATA%` log dir, batch memory.                                                                      |
| m10                    | Fixed: ADR-0003 C1 limit (old exes still run `migrate()`/`seedInitialData()`; runbook must block them).                                                                             |
| m11                    | Fixed: STATE.md and PLAN.md section 3.                                                                                                                                              |
| n1, n4, n5             | Fixed.                                                                                                                                                                              |
| n2, n3, n6, n7, n8, n9 | Accepted as-is for Step 1 drafts; revisit when Step 2/4 tests pin the behaviour.                                                                                                    |
