# Opdracht format

The format of an opdracht (remedial assignment) on disk, and the headless tools that work on it.
Written for Step 9 (PLAN section 6); the compact version for an AI model or a new author is
[`ai-context/assignment-authoring.md`](ai-context/assignment-authoring.md). Decisions: ADR-0002
section 5a (self-contained folders), ADR-0003 C14 (v2 layout), ADR-0009 (AI integration, open).

## 1. The folder

Every opdracht is one Typst project folder inside the shared data folder:

```text
data/opdrachten/<opdrachtId>/
  opdracht.json   metadata: title, vak, jaarlagen, observaties it belongs to, _meta (data-files-v2.md)
  main.typ        entry point: page setup, header, student / answer-key mode
  opdracht.typ    the teacher's text: setup_extra(), render_uitleg(), render_opgaven()
  lib.typ         the folder's own copy of the helper library
  images/         figures, referenced as image("images/<name>")
```

- **Self-contained.** A compile of the folder reads only files inside it (the Typst World is
  sandboxed to the folder; symlinks out of it are not followed). Other opdrachten, student data
  and the rest of the data folder are invisible. Packages are embedded in Maatwerk and never
  downloaded: `@preview/zero:0.7.1`, `@preview/cetz:0.3.4`, `@preview/oxifmt:0.2.1`,
  `@preview/unify:0.8.0`. Any other package is a compile error.
- **`main.typ` and `lib.typ`** start as the bundled versions (`maatwerk-core/assets/templates/`,
  `opdracht-main.typ` and `lib.typ`). Each has a version line (`// maatwerk-main 1`,
  `// maatwerk-lib 2`). An unmodified old copy is updated silently when the editor opens the
  opdracht; a changed copy is never overwritten (the editor offers "Bekijk verschillen" and
  "Herstel standaardversie").
- **`opdracht.typ`** starts as `base_assignment.typ`. It is the teacher's file; Maatwerk never
  rewrites it, apart from removing a leading BOM.
- **`opdracht.json`** is data, not Typst; the headless tools do not read it.
- **Images:** PNG, JPEG, GIF, WebP or SVG, in `images/`, inserted by the editor as a figure with a
  caption and a unique label (section 3).

## 2. Runtime data (`sys.inputs`)

`main.typ` reads a JSON string from `sys.inputs.at("maatwerk-data")`:

| Field             | Values                                                              | Default (placeholder) |
| ----------------- | ------------------------------------------------------------------- | --------------------- |
| `mode`            | `"student"` (the opdracht) or `"answers"` (key)                     | `"student"`           |
| `include_answers` | student mode: answers upside down at the bottom                     | `true`                |
| `cursor`          | live preview: a link at `<__maatwerk_cursor>`                       | `false`               |
| `header`          | `title`, `student`, `group`, `exam`, `observaties` (`icon`, `name`) | placeholder texts     |

When the app prints an opdracht for a student it fills `header` with that student's name, group,
exam and observaties. **The headless tools never do**: they compile with the placeholder header,
so no student data is ever needed to check or render an opdracht.

Answer-key mode lays out `render_uitleg()` and `render_opgaven()` hidden (so the vragen and their
numbers exist) and prints `antwoorden_lijst()`.

## 3. The teacher's file (`opdracht.typ`)

```typst
#import "lib.typ": *

#let setup_extra() = []          // extra set/show rules on top of setup
#let render_uitleg() = [ ... ]   // explanation: theory, examples, formulas
#let render_opgaven() = [ ... ]  // exercises: #opgave[...] blocks with #vraag(...)[...]
```

The three functions must exist (main.typ imports them). The `lib.typ` API, the conventions and
the checks are in [`ai-context/assignment-authoring.md`](ai-context/assignment-authoring.md),
sections 3 to 5; examples that compile cleanly are in
[`assignment-examples/`](assignment-examples/) (a test checks them).

**Vraag markers.** Every `#vraag` leaves `metadata((opgave, nr, antwoord, punten)) <__maatwerk_vraag>`
(`punten` since `maatwerk-lib 2`). Maatwerk reads these from the compiled document for the
editor's vragen panel and the checks, and for `assignment check`. Labels follow the answer key:
the opgave number, plus a letter (`a`, `b`, ...) when the opgave has more than one vraag.

## 4. Headless tools (`maatwerk-cli assignment`)

All three take an opdracht folder, or a `.typ` file whose folder is the project
(`opdracht.typ` means the `main.typ` next to it). They run anywhere: on an opdracht folder in the
data folder, a copy of one, or a folder made with `export-lib`. Nobody needs to be logged in and
nothing is written to the data folder except the output you ask for.

```text
maatwerk-cli assignment check <opdracht> [--json] [--answers] [--ignore-system-fonts]
maatwerk-cli assignment render <opdracht> [--pdf <file.pdf>] [--answers | --no-answers] [--ignore-system-fonts]
maatwerk-cli assignment export-lib <dir> [--overwrite]
```

- **check** compiles and reports: errors and warnings with `file:line:column`, the page count,
  the vragen (label, punten, answer, page), total punten, and the editor's checks. Exit code 0 when
  it compiles (warnings and checks do not fail it), 1 when not, 2 for wrong arguments. `--json`
  prints a `CheckReport` (below). `--answers` checks the answer key instead.
- **render** writes the PDF; default `opdracht.pdf` (or `antwoorden.pdf` with `--answers`) in the
  opdracht folder. `--no-answers` leaves out the upside-down answers.
- **export-lib** writes `lib.typ`, `main.typ`, a starting `opdracht.typ`, `packages/` (Typst's
  `--package-path` layout), `fonts/` and `LEESMIJ.txt` into `<dir>`. With those, the plain Typst
  CLI or tinymist (VS Code) compiles an opdracht the same way Maatwerk does:
  `typst compile --font-path <dir>/fonts --package-path <dir>/packages main.typ`; for tinymist set
  `tinymist.fontPaths` and `tinymist.typstExtraArgs: ["--package-path", "<dir>/packages"]`. A file
  that exists with other content stops the export unless `--overwrite`.
- **`--ignore-system-fonts`** uses only the embedded fonts: the result is the same on every
  machine (tests, CI). Without it, system fonts are a fallback, as in the app.

The same API is `maatwerk_core::assignment` (`Assignment::open`, `check`, `render_pdf`,
`export_lib`), so the app or a later assistant can call it in process.

### `check --json`

Schema: [`schemas/assignment-check.schema.json`](schemas/assignment-check.schema.json)
(`"schema": "maatwerk-assignment-check/1"`; the number changes on an incompatible change).
Sample: [`schemas/samples/assignment-check.sample.json`](schemas/samples/assignment-check.sample.json).

For an `opdracht.typ` whose line 3 is `#let render_uitleg() = [#onbekend]`:

```json
{
  "schema": "maatwerk-assignment-check/1",
  "ok": false,
  "root": "C:/opdrachten/voorbeeld",
  "entry": "main.typ",
  "mode": "student",
  "pageCount": null,
  "diagnostics": [
    {
      "severity": "error",
      "message": "unknown variable: onbekend",
      "hints": [],
      "location": { "file": "opdracht.typ", "line": 3, "column": 26, "range": [70, 78] },
      "trace": [
        {
          "message": "error occurred in this call of function `render_uitleg`",
          "location": { "file": "main.typ", "line": 63, "column": 4, "range": [2093, 2108] }
        }
      ]
    }
  ],
  "vragen": [],
  "totalPunten": 0,
  "checks": []
}
```

- `location.file` is relative to the folder; `line`/`column` are 1-based (column in Unicode
  scalar values); `range` is the UTF-8 byte range, end exclusive. `location` is `null` for an
  error without a place (e.g. from the PDF exporter).
- `trace` lists where an error came through (e.g. the call in `opdracht.typ` of a function in
  `lib.typ`).
- Diagnostic messages are Typst's (English); `checks` are Maatwerk's (Dutch), the same texts the
  editor's vragen panel shows.
