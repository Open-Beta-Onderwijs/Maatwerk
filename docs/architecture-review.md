# Architecture review (Step 1)

Date: 2026-10-25. Reference: `_reference/` at `0e30a70` (v0.1.6). Inputs, all in `docs/reference/`:
`ipc-api.md`, `data-files.md`, `business-rules.md`, `typst-contract.md`, `ui-map.md`,
`naming-map.md`, `metrics.md` (raw measurements) and `quirks.md` (106 items, IDs D/B/T/U; a few overlap across areas). This
document draws conclusions; the evidence (with `file:line`) is in those files.

**What the user decides at the end of Step 1:** the keep / change-now / change-later table (section
6), ADR-0002 (target architecture) and which ADR-0003 data-format candidates to pursue in Step 7.

## 1. Summary

- The plan's picture of the reference holds. All 12 preliminary findings of PLAN.md section 8 were
  checked; 10 are confirmed, 2 are partly wrong (section 2).
- The plan underestimated three things:
  1. **Typst is not offline-ready.** The rapport imports `cetz` 0.3.4 (+ `oxifmt` 0.2.1) and
     `unify` 0.8.0, which are **not** vendored. On a fresh PC without internet the rapport fails
     (T1). Emoji come from the system font Segoe UI Emoji and silently become boxes without it (T2).
  2. **The bridge is much broader than "storage".** Generic path-based handlers (`readJson`,
     `writeJson`, `deleteFile`, `writeTextFile`, `openPath`, `typst:compile`) accept any path, with
     no `..` or absolute-path check (D1). The editor iframe reaches them through a second,
     string-typed `postMessage` proxy.
  3. **Domain logic is duplicated and the copies disagree.** Best attempt exists 4 times, RTTI
     percentages 5 times, mean/SD 4 times (business-rules summary, B1-B7). Porting "the" rule means
     choosing which copy is the spec, per screen.
- Nothing found argues against the plan's direction (Tauri 2, Typst crate, JS UI kept, core
  without Tauri). ADR-0002 keeps section 4 and makes it more precise. The main additions are the
  Typst World design, the bridge error/compat layer, the CSP policy and the score-grid replacement
  options.

## 2. Preliminary findings (PLAN.md section 8): verdicts

| #   | Claim                                                                | Verdict                          | Evidence / nuance                                                                                                                                                                                                              |
| --- | -------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Clean process boundary: `contextIsolation`, no Node, one bridge      | **Mostly confirmed**             | `contextIsolation: true`, `nodeIntegration: false`, sandbox default on, one `exposeInMainWorld`. But: editor iframe proxy (10 methods incl. `writeTextFile` with a caller-chosen path) and CDN code with full bridge access    |
| 2   | Atomic writes, hash CAS, `_meta.rev`, watcher + poll, readable JSON  | **Confirmed**                    | Three layers: SHA-1 CAS (5 retries), `_meta.rev` check for exams/groups/observaties/opdrachten, `.lock` files outside `/scores/`. Not everything uses them: `school.json`, `config.json`, RTTI templates are blind writes (D6) |
| 3   | `Sync.on` pub/sub and `data-action` delegation                       | **Partly**                       | Pub/sub confirmed. Delegation mostly **refuted**: screens re-bind `querySelectorAll('[data-action]')` after every render; real delegation only in `opdrachten-genereren.js` and `data-close-modal`                             |
| 4   | `main.js` monolith with Electron types mixed into logic              | **Confirmed**                    | 1,025 lines, 32 handlers; fs, locks, presence, images, Typst, PDF merge, window code together                                                                                                                                  |
| 5   | `store.js` mixes cache, IPC, logic, migration; classic global script | **Confirmed**                    | Global `const Store` IIFE (1,567 lines), 66 bridge calls, grade/RTTI logic, migration, remote-change patching                                                                                                                  |
| 6   | Several renderer files > 1,000 lines; UI built with `innerHTML`      | **Confirmed**                    | 6 JS files + `style.css` + `editor.html`; 81 direct `innerHTML` sites + `showModal(html)` for every modal                                                                                                                      |
| 7   | CDN dependencies                                                     | **Confirmed, worse**             | 11 remote URLs, no SRI, CodeMirror/Lezer pinned to major only (`@6`). The app does not work offline at all (no grid, charts, editor or PDF viewer)                                                                             |
| 8   | Typst data via `toTypst` source strings, wrappers in `temp/`         | **Confirmed**                    | Strings escape only `\` and `"`, object keys raw, `{}` becomes `()` (T5); fixed temp names collide on concurrent compiles; `temp/` sits next to the exe, i.e. in OneDrive for a portable install                               |
| 9   | `lib.typ` copied into the shared data folder on every start          | **Confirmed, with nuance**       | Only when its SHA-1 differs. Teachers on different app versions make it flip back and forth (T-quirks)                                                                                                                         |
| 10  | No tests, no types                                                   | **Confirmed**                    |                                                                                                                                                                                                                                |
| 11  | Unused `docx` dependency                                             | **Confirmed**                    | Never imported                                                                                                                                                                                                                 |
| 12  | Leftover legacy migration code                                       | **Confirmed, and it still runs** | `migrate()` runs on every start (`store.js:318`); `migrateLegacyToPerYear` has complexity 45                                                                                                                                   |

## 3. Measurements (headlines; details in `docs/reference/metrics.md`)

| Metric                                | Value                                                                                                                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Size                                  | 22.6k lines (JS ~17.1k, CSS 2.9k, HTML 1.5k, Typst ~1k)                                                                                                                                                             |
| Functions                             | 1,223; 105 over 50 lines, 47 over 100                                                                                                                                                                               |
| Longest functions                     | `openExamOverviewModal` 1,256 lines (complexity 80), `openProfielModal` 1,109, `createGroupHOT` 849                                                                                                                 |
| Complexity                            | 67 functions above 10, 14 above 20; worst: overview modal 80, grid key handler 50, `cursorMarkerPos` 45, `migrateLegacyToPerYear` 45                                                                                |
| Duplication (jscpd)                   | 2.17% of lines; mostly Chart.js option blocks in `profiel.js` / `toets-overzicht.js` (~250 lines)                                                                                                                   |
| Semantic duplication                  | Much larger than jscpd shows: best attempt x4, RTTI % x5, mean/SD x4, opdracht/observatie fit x2 each, "student's group" x3                                                                                         |
| `innerHTML` with user data, unescaped | 19 interpolations on 17 lines (`metrics.md` section 5). Worst: RTTI-uitleg textareas (also corrupts `&`/`<` on save), login badges. CSP blocks script execution, so the effect is broken markup and data corruption |
| Global state                          | Mixed: `store.js` and `custom-select.js` are classic scripts (global `Store`); `Sync`, `Presence` and the screens are ES modules with module-level state; load order in `ui-map.md`                                 |

**Where the domain logic lives** (business-rules summary): the core maths (`calcResults`,
`calcGrade`, `qKind`, `resolveBestAttempts`, `opdrachtMatchesExam`, `cijferCardReason`,
`currentSchoolYear`, `makeExamId`) is pure but locked inside the `Store` IIFE: easy to lift out and
test. Stats (`computeExamStats`, `computeBestGradeStats`, `computeExamWarnings`) mix loading with
maths. Grid helpers (`normalizeScore`, `parseScoreNum`, `parseGradeInput`) are pure but private;
`recomputeRow`/`recomputeSummaryRow` work on grid cells. Histogram/box stats and the profile
averages are closures inside modals.

## 4. Dependency review (target: AGPL-3.0-or-later)

**The reference itself has no licence file.** The port copies its code and templates verbatim
(Steps 2b, 3a, 5a). The user confirmed on 2026-10-25 that they are the original author of the
reference repository (all 20 commits are by the same account), so relicensing it as
AGPL-3.0-or-later is theirs to do; recorded in `docs/STATE.md`. Contributions by others would
need their consent, but there are none.

| Dependency                                                         | Use                        | Licence                                                                                                         | Verdict                                                                                                                                                                         |
| ------------------------------------------------------------------ | -------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Handsontable 14.3.0** (CDN)                                      | score grid                 | **Proprietary** (key `non-commercial-and-evaluation`)                                                           | **Blocker: cannot ship.** Replace in Step 3b (section 4.1)                                                                                                                      |
| Chart.js 4.4.2 + annotation 3.0.1 (CDN)                            | charts                     | MIT                                                                                                             | Keep; vendor via npm, pin                                                                                                                                                       |
| CodeMirror 6 / Lezer (esm.sh, `@6`)                                | Typst editor               | MIT                                                                                                             | Keep; vendor via npm, pin exact versions                                                                                                                                        |
| pdfjs-dist 4.9.155 (CDN)                                           | PDF viewer                 | Apache-2.0                                                                                                      | Keep; vendor via npm (Apache-2.0 is AGPLv3-compatible)                                                                                                                          |
| pdf-lib 1.17.1                                                     | PDF merge (main)           | MIT                                                                                                             | Replaced by a Rust merge (`lopdf`, MIT) in core                                                                                                                                 |
| docx 8.5.0                                                         | nothing                    | MIT                                                                                                             | Drop                                                                                                                                                                            |
| Typst CLI 0.14.2 (binary)                                          | compile                    | Apache-2.0                                                                                                      | Replaced by the `typst` crates 0.14.x (Apache-2.0)                                                                                                                              |
| Typst `zero` 0.7.1 (vendored)                                      | number formatting          | MIT                                                                                                             | Keep, embed                                                                                                                                                                     |
| Typst `cetz` 0.3.4, `oxifmt` 0.2.1, `unify` 0.8.0                  | rapport charts/units       | LGPL-3.0-or-later (cetz), MIT-0 (oxifmt), MIT (unify), per each package's `typst.toml` in the local Typst cache | All AGPL-compatible. **Not vendored today.** Vendor and embed in Step 5                                                                                                         |
| Fonts: Source Serif 4, STIX Two Math                               | Typst output               | OFL-1.1                                                                                                         | Keep, embed, ship OFL texts                                                                                                                                                     |
| Libertinus Serif (Typst embedded)                                  | ●/◇ glyphs in rapport      | OFL-1.1                                                                                                         | Comes with `typst-assets`; keep                                                                                                                                                 |
| New Computer Modern, DejaVu Sans Mono (other `typst-assets` fonts) | Typst defaults (math, raw) | GUST Font License; Bitstream Vera licence                                                                       | Both free and redistributable, but not on our allowlists and invisible to `cargo deny`. Step 5: embed only the fonts the templates use, or record these two licences explicitly |
| Segoe UI Emoji (system)                                            | observatie icons           | Microsoft, not redistributable                                                                                  | Use the system font on Windows, or bundle an OFL/CC-BY emoji font: **open decision 2** (Step 5)                                                                                 |
| electron, electron-builder, husky, lint-staged, prettier           | build                      | MIT                                                                                                             | Go away (Prettier kept in the new repo)                                                                                                                                         |

### 4.1 Score grid: what a replacement must preserve (input for Step 3b)

Full list with `file:line` in `metrics.md` section 8 (29 items). In short:

- **Layout:** one grid per group in the score modal; columns #, Naam, questions, observatie
  checkboxes, Totaal, Cijfer, R%/T1%/T2%/I%; fixed widths; two summary rows (Gemiddelde,
  Standaarddeviatie); stacked HTML headers (tag/points/section/number), bonus/diag styling. **No
  frozen rows or columns.** Grids are small (one class: ~30 rows x ~10-40 columns).
- **Editing:** decimal comma in and out; `N` by typing or numpad `.` toggle; invalid input kept and
  flagged; grade override with a context menu ("Berekend cijfer herstellen", "Waarschuwing
  negeren"); checkbox cells with one-click toggle, `0`/`1`, `F1..Fn`.
- **Keyboard:** Enter / NumpadEnter / `*` next cell then next student's first empty question;
  `/` previous; `-`/`+` previous/next student; Home/End within blocks; custom Tab order.
- **Look:** score colours (0 red, max green, between yellow, N grey), row status colours,
  crosshair highlight, grade/RTTI background scales.
- **Behaviour:** app-owned undo/redo (50 steps, skips cells a colleague changed), autosave per
  cell with in-flight tracking, live updates from colleagues with a 2 s flash, colleague cursor
  overlay, reload notices. Copy/paste and fill handle are Handsontable defaults (paste into
  observatie columns is currently not saved, U4).

Almost all behaviour is already app code on top of Handsontable's hooks; what Handsontable really
provides is the cell editor, selection model, rendering loop and copy/paste. **Recommendation for
Step 3b: a small custom grid on a plain `<table>`** (owned code, no licence risk, fits the keyboard
scheme exactly), with MIT grids (e.g. RevoGrid, Tabulator, Jspreadsheet CE) as fallbacks if the
custom grid turns out too costly. Decide in Step 3b (open decision 1).

## 5. Security notes

- **Path handling (D1):** every command that takes a path must go through `maatwerk-core::paths`
  (reject `..`, absolute paths, drive letters, UNC/`\\?\`, symlink/junction escapes, reserved
  Windows names). `shell:openPath` and `typst:compile` become commands that take an ID or a
  data-relative path, never an absolute path. Unused handlers (`listScoreFiles`, `typstVersion`,
  `compileTypst`, `renderAssignmentPdf`) are not ported unless a screen needs them.
- **Bridge surface:** keep the path-based JSON API for parity (PLAN section 4), but confined to
  the data folder and limited to the file types the UI really uses. Typed per-entity commands are
  a "change later" item.
- **Editor iframe:** in Tauri a same-origin iframe could reach IPC directly. Keep the iframe only
  with an explicit allowlist of methods in the parent proxy and a checked message origin in both
  directions (today the iframe accepts responses from any sender). The editor is rebuilt in Step 8
  anyway.
- **CSP:** no remote origins at all once dependencies are vendored. The reference has ~262 inline
  `style=` attributes; proposal: `style-src 'self'` plus `style-src-attr 'unsafe-inline'` (style
  attributes cannot run script; `<style>` elements and remote CSS stay blocked). Add
  `object-src 'none'; base-uri 'self'; frame-ancestors 'none'`. Typst SVG previews are inserted as
  markup today (`pageEl.innerHTML = svg`); render them as `<img src="blob:...">` or sanitise.
- **`innerHTML`:** fix the 19 unescaped interpolations when the screens are touched in Step 3 (each
  one is also a data-corruption bug: U6, U7). New code builds DOM with `textContent`/elements or a
  tagged-template helper that escapes by default; ESLint can flag new raw `innerHTML`.
- **Typst sandbox:** the World serves only (a) embedded templates, `lib.typ`, packages and fonts,
  and (b) `opdrachten/**` and `fotos/**` of the data folder through the path guard (PLAN Step 5a).
  This is **narrower than the reference**, whose Typst root is the app folder, so a teacher file
  can read any data file today (including student JSON). No template needs more than those two
  folders (`typst-contract.md`). No network, no package downloads,
  no system paths. Teacher markup (`uitleg_rtti`, opdracht files) is evaluated by Typst; that is by
  design, and Typst has no file-write or network access, so the World is the security boundary.
  Compile time and memory limits for live preview (a teacher's infinite loop must not hang the
  app): Step 5/8.
- **Secrets:** none in the reference. Logs (Step 4+) must not contain student data beyond IDs.

## 6. Keep / change now (during the port) / change later (after parity)

"Change now" items are cheap now and expensive later (PLAN 1.3). Anything that changes **output or
data** is marked and needs the user's approval before it happens.

| Area                    | Keep                                                                                                       | Change now (during port)                                                                                                                                                                                                                                                   | Change later (after parity)                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Data folder             | JSON layout, file names, IDs, `_meta.rev`, CAS by content hash, watcher + 20 s poll, own-write suppression | Retry/backoff on EPERM/EBUSY/EACCES without blocking a thread; distinguish "missing" vs "corrupt" on read; exclusive-create for `.lock` (if locks stay)                                                                                                                    | Data format v2 (ADR-0003, Step 7)                                                                                 |
| Bridge                  | Method names and result shapes (compat layer in `ui/src/bridge`)                                           | One typed error `{ code, message, details }` from Rust; compat layer maps to the 4 old shapes per method; path guard on everything; generated TS types (tauri-specta)                                                                                                      | Typed per-entity commands; screens use the new error shape                                                        |
| Storage engine          | Semantics of `Store.update` (CAS loop, 5 attempts), per-path write queue                                   | Implemented in Rust core with tests from Step 2 specs; heavy work on `spawn_blocking`                                                                                                                                                                                      | Revisit retry delays and `locked` handling (D4/D5)                                                                |
| Typst                   | Templates and `lib.typ` API, page layout, output order, duplex padding                                     | Crate-based World: embedded templates, `lib.typ`, packages (incl. **cetz, oxifmt, unify**), fonts; no temp files; data via a virtual JSON file instead of generated source (**output-affecting only where T5/T6 apply: verify with goldens, ask before accepting a diff**) | Editor pipeline on the crate (Step 8): incremental compile, diagnostics with spans                                |
| PDF merge               | Order, grouping by key, duplex rule, blank page size                                                       | Rust merge (`lopdf`); metadata will differ (pdf-lib overwrote Typst's anyway)                                                                                                                                                                                              |                                                                                                                   |
| UI structure            | Screens, modals, Dutch texts, keyboard schemes, in-app dialogs, unsaved-changes guard                      | Vite modules instead of classic scripts; vendored deps; bridge rename `window.rtti` -> `window.maatwerk` (codemod); pure domain functions lifted out of `Store` into `ui/src/domain` with tests                                                                            | Split the 1,000+ line files; real event delegation; TypeScript per module                                         |
| Score grid              | All 29 preserved features                                                                                  | Replace Handsontable (Step 3b, **blocker**)                                                                                                                                                                                                                                |                                                                                                                   |
| Domain logic duplicates | Each screen's current behaviour (pinned by goldens)                                                        | Nothing, unless two copies are proven identical                                                                                                                                                                                                                            | Consolidate best attempt / RTTI % / stats into one implementation (**changes output** where copies disagree: ask) |
| Security                | `contextIsolation`-style boundary                                                                          | CSP without remote origins; path guard; editor proxy allowlist; SVG preview not via `innerHTML`; escape the 19 unescaped interpolations (fixes U6/U7 data corruption: **changes data written**, ask)                                                                       | Lint rule against raw `innerHTML`                                                                                 |
| Legacy                  | Reading legacy files during the port is not needed (no live legacy data expected)                          | Do not port `migrate()` phases 1-2 into the new app; the Step 7 migration handles v1 -> v2 only                                                                                                                                                                            | Remove `.bak`/`null` legacy files in the Step 7 migration (ADR-0003)                                              |
| Quirks                  | Default: keep and pin with a test                                                                          | Only fix a quirk now if it is a crash/data-loss bug and the user agrees                                                                                                                                                                                                    | The rest: per-item decision after parity (backlog)                                                                |

## 7. Questions for the user (Step 1 gate)

1. Approve ADR-0002 as written, or name the parts to change.
2. **Typst data as a virtual JSON file** instead of generated Typst source (section 6): accept,
   provided the goldens show no unexplained diff?
3. **Legacy migration (`migrate()` phases 1-2):** confirm that no live data folder still contains
   pre-per-year or pre-per-subject files, so the new app does not need to port that code.
4. **CSP inline styles:** accept `style-src-attr 'unsafe-inline'` for the port, with a
   change-later item to move inline styles to classes?
5. **Quirks that lose or corrupt data today:** U2/U4 (score saves dropped), U3 (save errors
   invisible), U9 (editor loses last edits on close), D25 (editor request hangs), D34 (groups CSV
   re-import empties groups), U6/U7 (escaping corrupts teacher text), B22 (CSV with BOM imports
   nothing), B9 (`wis*` advice key mismatch, changes report output). Fix during the port (each
   with a failing test first), or keep for strict parity and fix after cutover?
6. **Output files** (ADR-0002 section 9): generated PDFs in memory, shown via a custom protocol,
   and written to a cache folder outside OneDrive only for printing / opening externally. OK?
7. **Blind writes and advice keys now or in v2:** ADR-0003 C6 (CAS for `school.json`,
   `config.json`, RTTI templates) and C11 (`wis*` keys) could be done during the port. Now, or in
   Step 7?
8. ADR-0003: which candidates should Step 7 work out in detail?

### Deviations from the plan (for information)

- 28 bridge methods are ported, not 29 (one is unreachable; ADR-0002 section 2).
- `checkJs` stays off for untouched legacy JS files (ADR-0002 section 6).
- The atomic-write temp file next to the target is the one file the app writes besides real data
  (ADR-0002 section 3); PLAN 4 says "no temp files", which we read as "no Typst/output temp
  files".
- Typst sandbox narrower than the reference (section 5).
