# Typst contract (reference app)

This file describes how the reference Electron app (`_reference/`) uses Typst. It is the spec for the Rust port, which embeds the `typst` crates (0.14.x) as a library and must produce the same output. It records what the app **does**, including its bugs. Those bugs are collected separately in the quirks list. Citations are `file:line` relative to `_reference/`.

The reference bundles the CLI `bin/typst/win/x_86_64/typst.exe`, **typst 0.14.2 (b33de9de)**, and only that binary is packaged (`package.json` `build.extraResources`). Every claim marked _(verified)_ was checked by running that binary on synthetic copies in a scratch directory.

---

## 1. Overview

| #   | Path                                           | IPC channel                 | Caller                                                                                        | Output                                                         |
| --- | ---------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| A   | Rapport (whole class)                          | `app:renderRapportPdf`      | `renderer/modals/rapport.js:281` (from Toetsen menu, `screens/toetsen.js:517`)                | one PDF, `temp/rapport_preview.pdf`                            |
| B   | Opdracht PDF (single)                          | `app:renderAssignmentPdf`   | proxied in `renderer/modals/editor.js:68-69`; **no sender exists** in `editor-init.js` (dead) | `temp/assignment_preview.pdf`                                  |
| C   | Editor live preview                            | `app:renderAssignmentSvg`   | `renderer/editor-init.js:587-593` via `modals/editor.js:71-72`                                | SVG strings, one per page                                      |
| D   | Opdrachten genereren / Antwoordsleutel (batch) | `app:renderAssignmentBatch` | `renderer/modals/opdrachten-genereren.js:382`                                                 | merged PDF `temp/opdrachten.pdf` or `temp/antwoordsleutel.pdf` |
| E   | Raw compile                                    | `typst:compile`             | exposed in `preload.js:61`, **no caller** (dead)                                              | PDF at caller-given path                                       |
| F   | Version smoke test                             | `typst:version`             | exposed in `preload.js:57`, no caller found                                                   | `{ success, version }`                                         |

The app has **no single-student rapport**. Path A always renders every student with scores in one document. The app has no PNG export, does not use `--input`/`sys.inputs`, `--ppi`, `--format` or `--pages`, and never calls `typst query`. All data reaches Typst as **source-code literals in a generated wrapper file**.

### Binary location and common arguments

- Binary (`main.js:488-496`): packaged `process.resourcesPath/typst/typst.exe`; dev `bin/typst/<win|mac|linux>/<aarch64|x_86_64>/typst[.exe]`.
- `getTemplatesDir()` (`main.js:960-963`): `<dirname(execPath) | __dirname>/include/templates`. Fonts are `include/fonts` and packages `include/packages` (siblings, `main.js:499-507`).
- Common prefix (`main.js:510-516`):
  ```
  compile --font-path <include/fonts> --package-path <include/packages>
  ```
- Paths A–D then add `--root <appDir> <wrapper.typ> <output>`. `appDir` = dev: `__dirname`, packaged: `PORTABLE_EXECUTABLE_DIR || dirname(execPath)` (`main.js:17-20`). `data/` and `temp/` both live directly under `appDir` (`main.js:23`, `549`), so **the Typst root is the app folder, which contains `data/`, `temp/` and the exe**.
- The output format comes from the extension: `.pdf`, or `.svg` with a `{p}` page pattern. System fonts are **not** disabled (`--ignore-system-fonts` is not passed). The package cache is left at its default.
- Every call is `child_process.execFile` (no shell). Paths C and D set `maxBuffer: 10 MiB` (`main.js:775`, `821`); A and B use the 1 MiB default. stdout is ignored. On failure (non-zero exit), `stderr || err.message` is the error text. **Warnings on success are dropped.**

### Diagnostics format

The UI receives Typst's human-readable stderr verbatim. It has no ANSI colours, because stderr is not a TTY _(verified)_, and absolute Windows paths with a `\\?\` prefix _(verified)_:

```
error: file not found (searched at \\?\C:\…\app\data\fotos\school-watermerk.svg)
   ┌─ \\?\C:\…\app\temp\rtti_export.typ:32:15
   │
32 │         #image("/data/fotos/school-watermerk.svg", …)
   │                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
```

Package frames show up as `@preview/zero:0.7.1\src\quan.typ:15:25`, with backslashes. Trace frames (`help: error occurred in this call of function …`) are included. The port must produce text of comparable shape. The UI only shows it as plain text, so exact byte parity is not required. Section 9 covers this.

---

## 2. Path A: rapport (`app:renderRapportPdf`, `main.js:546-602`)

**Inputs**: `(_examId (unused), students, examInfo)` from `compileRapport()` (`renderer/modals/rapport.js:174-282`).

**Steps**

1. `mkdir -p <appDir>/temp` (`main.js:549-550`).
2. Copy `include/templates/rtti_export.typ` to `<appDir>/temp/rtti_export.typ`, overwriting it each time. It is **never deleted** (`main.js:552-555`).
3. Write wrapper `<appDir>/temp/_rapport_run.typ` (UTF-8, LF, no BOM) (`main.js:578-587`):
   ```typst
   #import "rtti_export.typ": setup, render

   #let exam_info = <toTypst(examInfo ?? {})>
   #let student_data = <toTypst(students ?? [])>

   #show: setup
   #render(exam_info, student_data)
   ```
   The import is **relative** to the wrapper, so it resolves to `temp/rtti_export.typ`.
4. `typst compile --font-path … --package-path … --root <appDir> temp/_rapport_run.typ temp/rapport_preview.pdf` (`main.js:590-593`).
5. On exit, the wrapper is unlinked whatever the result (`main.js:594-596`). The PDF is kept and overwritten by the next run.
6. Return `{ success: true, pdfPath }` or `{ success: false, error: stderr || err.message }`.

**UI** (`rapport.js:288-321`): on failure, `<pre class="hint rapport-error">` with HTML-escaped error text plus toast "Compilatiefout bij het genereren van het rapport.". On success, an iframe `pdf-viewer.html?file=<encodeURIComponent('file:///' + path with / )>` with **no cache-buster**. "Afdrukken" posts `print-pdf` and the parent calls `shell.openPath(pdfPath)` (`rapport.js:314-318`, `pdf-viewer.js:277-282`).

### 2.1 Data built for the rapport (`rapport.js`)

`examInfo` (`rapport.js:268-279`):

| key                 | value                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `name`              | `exam.title ?? ''`                                                                                                                       |
| `subject_display`   | `WI_SUB_DISPLAY[subject] ?? Store.SUBJECT_DISPLAY[subject] ?? subject`                                                                   |
| `global_max_points` | `Math.max(...questions.map(q => q.max_points))` (bonus/diag included), `1` if there are no questions                                     |
| `n_term`            | `exam.n_term ?? 1` (JS number)                                                                                                           |
| `uitleg_rtti`       | `{R, T1, T2, I}` strings from `templates/RTTI explanations and advices/rtti_expl_adv_<subject>_<jaarlaag>.json` → `uitleg`, default `''` |

`students[]`, one per student in the exam's jaarlaag with at least one non-null score. Sorted by group name, then `achternaam`, both with `localeCompare(…, 'nl')` (`rapport.js:194-266`):

| key                 | value                                                                                                                                                                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`              | `Store.fullName(student)`                                                                                                                                                                                                                                                                                                                        |
| `student_nr`        | `String(student.id)`                                                                                                                                                                                                                                                                                                                             |
| `group`             | group name or `'—'` (U+2014)                                                                                                                                                                                                                                                                                                                     |
| `score`             | `scored` from `Store.calcResults` (JS number, may be fractional)                                                                                                                                                                                                                                                                                 |
| `max_score`         | `normalMax`                                                                                                                                                                                                                                                                                                                                      |
| `grade`             | `(round1(grade)).toFixed(1).replace('.', ',')` such as `"6,4"`, or `'—'`                                                                                                                                                                                                                                                                         |
| `grade_num`         | `round1(grade)` or `null`                                                                                                                                                                                                                                                                                                                        |
| `grade_overridden`  | boolean                                                                                                                                                                                                                                                                                                                                          |
| `vragen[]`          | `{label, rtti, kind, rtti_color, score, max, class_avg, class_pct, dot_color}` (`rapport.js:44-79`). `score` is `null` when not entered or `'N'`, else `max(0, Number(raw))`. `class_avg` = `parseFloat(avg.toFixed(1))`. `label` = `section + number`.                                                                                          |
| `observaties[]`     | `{icon, naam, uitleg, leeradvies}` (plain strings)                                                                                                                                                                                                                                                                                               |
| `leeradvies_rows[]` | `{cat, score_str, advies}`. One row per R/T1/T2 with `max > 0` (I is never included), then one per observatie with `cat = obs.icon` and `score_str = ''`. `advies` is **Typst markup** run through `sanitizeTypstMarkup` (`rapport.js:129-136`): an odd number of `$` gets every `$` escaped and a red warning prefix. Empty text becomes `'—'`. |

### 2.2 `toTypst` serialisation (`main.js:558-574`)

Only path A uses this. Grammar:

```
toTypst(null | undefined)  = "none"
toTypst(boolean)           = "true" | "false"
toTypst(number)            = isFinite(n) ? String(n) : "0"      // JS Number→string
toTypst(string)            = '"' + s.replace(/\\/g,'\\\\').replace(/"/g,'\\"') + '"'
toTypst([])                = "()"
toTypst([a, …])            = "(" + items.join(", ") + ",)"      // trailing comma always
toTypst(object)            = "(" + entries.map(k + ": " + toTypst(v)).join(", ") + ")"
                             // key emitted raw, unquoted; {} → "()" (an ARRAY, not (:))
toTypst(other)             = '"' + String(v) + '"'              // unescaped
```

Consequences _(verified with the real function)_:

```
{a: 1.5, b: -0, c: 1e21, d: NaN, e: null, f: undefined, g: [], h: [1], i: {}, j: "tab\there\nnl", "k-k": true, l: [{x: 1}], m: 5e-7}
→ (a: 1.5, b: 0, c: 1e+21, d: 0, e: none, f: none, g: (), h: (1,), i: (), j: "tab<TAB>here<LF>nl", k-k: true, l: ((x: 1),), m: 5e-7)
```

- **Numbers keep a decimal point, never a comma.** JS numbers that are integers become Typst `int` (`6.0` → `6`), others become `float`. Fractional sums can show float noise such as `7.300000000000001`. The rapport prints `#student.score` raw, giving "Je hebt 7.5 / 12 punten" _(verified)_. The templates convert to commas only in specific places (section 2.3).
- Strings escape only `\` and `"`. Raw newlines, tabs and control characters go inside the literal unchanged. Typst accepts raw newlines in strings _(verified)_. Strings become **text, not markup** (`#`, `$`, `*` show literally). The exceptions are the fields the template `eval`s: `leeradvies_rows[].advies` and `exam_info.uitleg_rtti.*`.
- No dates are passed.

### 2.3 `rtti_export.typ`: structure

Imports (`rtti_export.typ:17-18`): `@preview/cetz:0.3.4` (`canvas`, `draw`) and `@preview/unify:0.8.0` (`num`, `unit`, `qty`). **Neither is vendored** (section 7.2).

`setup(body)` (`:24-69`):

- `page`: A4 by default, `margin: 2cm`. The **background** is a 3.5×3.5 cm box at bottom-right (`dx: -0.5cm, dy: -0.5cm`) with `image("/data/fotos/school-watermerk.svg", fit: "contain")` under a white 20%-transparent rect. **The file is required**: if it is missing, the compile fails _(verified)_.
- **footer**: italic 8pt `gray.darken(20%)`. Left: `"#pg / 2"`, where the total `2` is **hard-coded**. Centre: `_footer_text` state = `subject_display + " " + name + " — " + student.name`. No footer appears while the state is `""`.
- `text(font: "Source Serif 4", size: 10.5pt)`. **No `lang`** is set, so the default is `en`. Math uses `STIX Two Math`.
- Headings: level 1 is 13pt bold `#1a5276` with `below: 4pt`. Level 2 is 11pt regular `#1a5276` with `above 2pt, below 6pt`.
- In math, regex `[0-9]+[.,][0-9]+` is rewritten to use a comma with `h(0pt)` (no math comma spacing).

`render(exam_info, student_data)` (`:638-675`). For each student:

1. `counter(page).update(1)`, then set the footer state.
2. `= Toetsanalyse <subject_display> <name>` / `== <group> — <name> (<student_nr>)`.
3. Sentence: `Je hebt <score> / <max_score> punten behaald en had dus <calc.round(score/max_score*100)>% goed. De N-term is N=<str(n_term) with "."→",">. Je cijfer is een *<grade>*.` If `grade_overridden` is true, it adds "Dit cijfer is met de hand overschreven door de docent."
4. **Scoretabel** (`lollipop_chart`, `:171-219`): 9pt table with columns `1.4cm ×4, 9cm, 2.4cm`, header row `Vraag | RTTI | B / D | Jij (●) | <scale_track> | Gemiddeld (◇)`, and zebra fill `#EDEEF0` on odd rows. Score text is `"N / max"` when score is none, else `str(int(score)) + " / " + str(max)` (truncates fractional scores). Average text is `fmt1(class_avg) + " / " + max + " (" + class_pct + "%)"`. `kind` `bonus`/`diag` rows are muted italic `#9aa0ab`, with B/D label "Bonus"/"Diag.". The track is a cetz canvas 8 cm × 0.5 cm: dashed line 0→max, solid line 0→score in `dot_color`, student dot r = 0.141 cm with the score in white 7pt, and a class-average diamond with white fill and gray stroke. The scale track has ticks at `range(0, global_max + 1)`.
5. **Observaties** (`:222-246`): no observations gives the sentence "De docent heeft bij jou geen observaties genoteerd voor deze toets.". Otherwise a table `Afk. | Observatie | Korte uitleg` with the icon at 12pt.
6. **Leeradvies** (`:256-279`): table `Cat. | Score | Leeradvies`. `cat` is 9pt for R/T1/T2, else 12pt (emoji icons). `advies` goes through `eval(…, mode: "markup", scope: (num: unify num with thousandsep " ", unit: per "fraction-short", qty: …))`.
7. `pagebreak()`.
8. **Uitleg RTTI-categorieën** (`:455-485`): rows R Reproductie / T1 Training / T2 Transfer / I Inzicht. Empty text gives `—`, otherwise `eval` markup with the same scope.
9. Grid of two columns: **pie** "Verdeling RTTI deze toets" (share of max points per category, `kind == "normal"` only, start angle 90°, clockwise, legend with `pct%`) and **bar** "Jouw RTTI-scores" (score % per category; a category without points shows a gray bar labelled `NVT`). Fills are `tiling` hatches: R solid `#5cb85c`, T1 cyan with horizontal stripes, T2 orange with diagonal stripes, I red with a crosshatch.
10. **Histogram** "Verdeling toetscijfers" (`:494-635`), only when **≥ 10** students have `grade_num`. It has 12 bins (`<4,5 … ≤10`), and the student's bin is blue-crosshatched when grade ≥ 5.5. A ranking line `Gefeliciteerd! … beste 33% … 👑` appears when `idx < n/10 - 0.99`, or `… beste 67% … 🥈` when `idx < 2n/10 - 0.99`.
11. `pagebreak()` between students (not after the last one).

Fonts actually embedded in a rapport PDF _(verified)_: SourceSerif4 Regular/Bold/It, STIXTwoMath, **LibertinusSerif-Bold** (Typst's embedded font, used as fallback for `●`/`◇` in the bold table header), and **SegoeUIEmoji** (system, for observatie icons and 👑/🥈).

---

## 3. Opdracht wrapper (`buildAssignmentWrapper`, `main.js:644-687`)

`typStr(s)` (`main.js:614-619`) = `'"' + String(s ?? '').replace(/\\/g,'\\\\').replace(/"/g,'\\"') + '"'`. It follows the same string rules as `toTypst`, and `null`/`undefined` become `""`.

`importPath` = `/data/opdrachten/<typFile>` is interpolated **raw** (unescaped) into a string literal.

Common prefix:

```typst
#import "/data/opdrachten/lib.typ": setup, opdracht_header, antwoorden_header, antwoorden_lijst, antwoorden_omgekeerd
#import "<importPath>": setup_extra, render_uitleg, render_opgaven

#show: setup
<CURSOR_FOREGROUND if cursorMarker>
#setup_extra()

```

`mode: 'student'` (default):

```typst
#opdracht_header(
  title: <typStr>,
  student: <typStr>,
  group: <typStr>,
  exam_prefix: "N.a.v.",
  exam: <typStr>,
  observaties: (<(icon: <typStr>, name: <typStr>),> joined by " ">),
)

#render_uitleg()

#pagebreak()

#render_opgaven()
#antwoorden_omgekeerd()        ← only when includeAnswers (default true)
```

With no observaties this emits `observaties: ()`, an empty array, **not** `none`. The header cell is then empty (only the empty `emph` prefix), and the `❌ Geen observatie` default is not used _(verified)_.

`mode: 'answers'`:

```typst
#antwoorden_header(title: <typStr>)

#place(hide[#render_uitleg() #render_opgaven()])
#antwoorden_lijst()
```

`CURSOR_FOREGROUND` (`main.js:606-612`), inserted only for the SVG preview:

```typst
#set page(foreground: context {
  for m in query(<__rtti_cursor>).filter(m => m.location().page() == here().page()) {
    let p = m.location().position()
    place(top + left, dx: p.x, dy: p.y, link("rtti-cursor:")[#box(width: 1pt, height: 1em)])
  }
})
```

In SVG this becomes `<a href="rtti-cursor:" xlink:href="rtti-cursor:">` _(verified)_. The editor looks it up with `a[href="rtti-cursor:"]` and scrolls it to 1/3 of the viewport if it is off-screen (`editor-init.js:578-585`).

`placeholderHeader(title)` (`main.js:623-636`) is used by paths B and C:
`student: 'Leerling Voornaam Achternaam'`, `group: 'Klas Z vak W'`, `exam: 'Voorbeeldtoets Toetsweek X'`, `observaties: [{icon: '❌', name: 'Een voorbeeldobservatie met een behoorlijk lange naam, zodat deze twee regels beslaat in het voorbeeld'}]`.

---

## 4. Paths B, C and D

### 4.1 Path B: `app:renderAssignmentPdf(typFile, title)` (`main.js:693-721`)

1. Wrapper = student mode, `placeholderHeader(title)`, `includeAnswers` true, written to `temp/_assignment_run.typ`. `typFile` is **not validated**.
2. Compile to `temp/assignment_preview.pdf` with `--root appDir`, then unlink the wrapper.
3. Returns `{success, pdfPath}` or `{success:false, error}`. The editor never sends `rtti-render-assignment`, so this path is unused in the UI.

### 4.2 Path C: live preview SVG (`app:renderAssignmentSvg(typFile, title, previewContent)`, `main.js:737-801`)

Renderer side (`editor-init.js`):

- After an edit, a 600 ms debounce saves `opdrachten/<typFile>` through `fs:writeTextFile` and then renders. A cursor move without edits triggers a render after 400 ms, but only when the marker position changes (`:649-662`). The first render happens on init (`:706`).
- One render runs at a time. Requests that arrive during a render coalesce into one rerun (`:597-631`).
- `cursorMarkerPos(doc, head)` (`:379-488`) is a hand-written scanner. It finds the last offset ≤ cursor that is inside markup `[…]`, right after whitespace or `[`, outside comments, strings, raw and math, and not before `- + = / <`. `insertCursorMarker` (`:355-362`) inserts `#metadata(none)<__rtti_cursor>`, padded with `\n` on blank lines.
- The content is first compiled **with** the marker. If that fails, or no position was found, it is compiled again with the plain document (`:611-615`). Success replaces page `innerHTML` in place (`:559-575`). Failure shows the status button "Fout bij renderen", whose popover shows the error text (`setStatus`, `:323-344`).

Main side:

1. Reject `typFile` that is not a bare basename (`:738-740`).
2. `temp/svg_preview/` is created and kept. **Every file in it is deleted** before each render (`:747-750`). `runPrefix = r<seq>-`.
3. Write the editor text to **`data/opdrachten/_preview_<typFile>`** (inside the synced data folder, next to the real file, so relative `lib.typ` and `images/…` resolve) (`:752-756`).
4. Wrapper (student, placeholder header, `cursorMarker: true`, includeAnswers true) goes to `temp/_assignment_svg_run.typ`.
5. Compile to the pattern `temp/svg_preview/r<seq>-p{p}.svg`. `{p}` is **not zero-padded**, giving `p1 … p10 …` _(verified)_.
6. Unlink the wrapper and the preview copy. On error, every occurrence of `_preview_<typFile>` in the error text is replaced by `<typFile>` (`:781`).
7. Read the files matching `^r<seq>-p(\d+)\.svg$`, sort them numerically, read them as UTF-8 strings, unlink them, and return `{success, pages: [svg…]}`.

Startup removes `data/opdrachten/_preview_*.typ` files older than 1 h (`main.js:920-931`). The data watcher ignores `_preview_` files (`sync.js:76`).

The SVG is Typst's standard output: root `<svg class="typst-doc" viewBox="0 0 595.2755905511812 841.8897637795276" width="595.2755905511812pt" …>`. The editor reads `viewBox.width` for zoom (`editor-init.js:503-506`). CSP for the editor iframe is `img-src data: blob:`, so embedded images in SVG must be data URIs (Typst SVG embeds them as base64).

### 4.3 Path D: batch (`app:renderAssignmentBatch(jobs, opts)`, `main.js:813-917`)

**Jobs** (`opdrachten-genereren.js:316-349`):

- Students (`kind 'student'`): for each included student (order from `Store.getOpdrachtAssignments`: students without a group last, then group name, achternaam, voornaam and fullName with `localeCompare('nl', {numeric:true})`, `store.js:1343-1351`), for each of their opdrachten in the order their reasons were collected (exam obs order, then grade cards), one job: `{key: String(student.id), typFile, label: opdracht.naam, mode: 'student', header: {title: opdracht.naam, student: fullName, group: group?.name ?? '', exam: exam.title, observaties: reasons.map(o => ({icon: o.icon, name: o.naam}))}}`. A grade-card reason is `{icon: '5️⃣' (5 U+FE0F U+20E3), naam: 'Cijfer onder 5,5'}` (`store.js:1256-1261`).
- Answer key (`kind 'key'`): one job per distinct opdracht, sorted by `naam` (`nl`): `{key: opdracht.id, typFile, label, mode: 'answers', header: {title: naam}}`.
- Options: `includeAnswers` = checkbox (default `true`), `duplex = kind !== 'key'`, `outputName = 'antwoordsleutel.pdf' | 'opdrachten.pdf'`.

**Main**:

1. Validate that every `job.typFile` and `outputName` is a bare basename. An empty job list gives "Er is niets om te genereren.".
2. `runDir = temp/opdrachten_run/` (kept). `prefix = b<seq>-`.
3. Run `BATCH_PARALLEL = max(2, min(4, cpus-1))` workers. Each takes the next index `i`, writes `runDir/<prefix><i>.typ` = `buildAssignmentWrapper('/data/opdrachten/'+typFile, job.header ?? {}, {includeAnswers, mode})`, compiles it to `runDir/<prefix><i>.pdf`, unlinks the wrapper, and sends progress `assignment:progress {done, total}` (also sent once at start with `done: 0`).
4. The first failure stops new jobs. Running jobs finish. The error is `Fout in opdracht "<label ?? typFile>":\n\n<stderr>`.
5. **Merge with pdf-lib** (`:896-907`):
   ```js
   merged = PDFDocument.create()
   for i in jobs (in job order, not completion order):
     if duplex && i > 0 && jobs[i].key !== prevKey && merged.pageCount % 2 === 1:
       merged.addPage([lastPage.width, lastPage.height])   // blank page, same size as previous page
     prevKey = jobs[i].key
     copyPages(all pages of pdf i) → addPage each
   ```
   Each **key** (student) therefore starts on an odd page (1-based). Jobs with the same key are concatenated without padding between them. Nothing is padded after the last key, and the key-change check only compares neighbouring jobs (callers keep same-key jobs together).
6. Write `temp/<outputName>` (overwritten each run). Return `{success, pdfPath, pages: merged.getPageCount()}`.
7. `finally`: unlink every `runDir` file starting with `prefix`.

**Merged PDF metadata**: produced by `PDFDocument.create()` + `save()` with defaults, so Producer/Creator are pdf-lib's and CreationDate/ModDate are the merge time. Typst's own metadata (`Creator: Typst 0.14.2`, …), document outline and named destinations do not carry over. Page annotations (links) are copied with the pages.

**UI**: on error, `<pre class="hint rapport-error">` with the escaped error text plus toast `Fout bij het genereren van de <opdrachten|antwoordsleutel>.`. On success, the viewer iframe gets `?t=<Date.now()>` as a cache-buster, plus toast `<What> gegenereerd (<n> pagina's).` (`opdrachten-genereren.js:397-407`).

---

## 5. `lib.typ` API (`include/templates/lib.typ`)

Imports `@preview/zero:0.7.1`: `quan`, `num`, `set-num` (`:6`). Because the opdracht files use `#import "lib.typ": *`, these names, plus everything not shadowed, are in scope for teachers. `_`-prefixed names are also exported, because Typst has no privacy.

| Name                                                                            | Parameters / defaults                                                                                                                                                                                       | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setup(body)` (`:36-63`)                                                        | —                                                                                                                                                                                                           | `page(margin: 1.5cm)` (A4 default); `text(font: "Source Serif 4", size: 10.5pt, lang: "nl")`; math in `STIX Two Math`; `figure.caption` 9.5pt; table-kind figures have the caption at **top**; `par(justify: true)`; `heading(numbering: none)`; h1 is a block 14pt bold black with above/below 10pt, h2 is 12pt semibold with 10/10; show rules for figure kinds `voorbeeld` (`#C7D6EE`/title `#1a3e72` "Voorbeeld"), `formule` (`#FFF0AE`/`#7a5200`), `context` (`#D6FDCF`/`#1a5c14`), `opgave` (`luma(240)`/`luma(80)`, **breakable**); `set-num(decimal-separator: ",")`. `lang: "nl"` makes captions and references say **"Figuur"**, "Tabel" and so on, and turns on Dutch hyphenation. |
| `_render_block(bg, title_color, title_str, it)`                                 | —                                                                                                                                                                                                           | Block width 100%, radius 6pt, inset 0.75em, title `"<title_str> <n>"` or `"<title_str> <n> (<caption>)"` in bold, then the body. Spacing 0.65em inside.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `opdracht_header(...)` (`:68-98`)                                               | `title: "Titel"`, `student: "Sandra Jansen"`, `group: "4A"`, `exam_prefix: "N.a.v."`, `exam: "TW1 H1 Vaardigheden"`, `obs_prefix: ""`, `obs_icon: "❌"`, `obs_name: "Geen observatie"`, `observaties: none` | Title 18pt bold, then a gray (`luma(232)`) rounded box with grid `(2fr, 3fr)`: **student** bold / _exam_prefix_ exam (right), group / `[_obs_prefix_ icon name, icon name…]` (right). `observaties: none` uses the single `obs_icon`/`obs_name` pair. Strings are inserted as text.                                                                                                                                                                                                                                                                                                                                                                                                           |
| `antwoorden_header(title: "Titel")` (`:101-111`)                                | —                                                                                                                                                                                                           | Title 18pt plus a gray box "**Antwoordsleutel**".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `voorbeeld_blok(name: none, body)`, `formule_blok`, `context_blok` (`:126-128`) | —                                                                                                                                                                                                           | Bare `figure(kind, supplement, numbering: "1", caption: name)`, so it can be labelled (`<x>` / `@x` → "Voorbeeld 1").                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `belangrijk_blok(body)` (`:130-143`)                                            | —                                                                                                                                                                                                           | Red box `#ffb4b4` with a 1.5pt red stroke and title "Belangrijk!" in `#ac0000`. Not numbered.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `opgave(titel: none, body)` (`:158`)                                            | —                                                                                                                                                                                                           | Figure kind `opgave`, supplement "Opgave". Resets counter `rtti-vraag` at the start of the body. It can be labelled.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `vraag(punten: none, antwoord: none, body)` (`:204-227`)                        | —                                                                                                                                                                                                           | Steps `rtti-vraag` and `rtti-vraag-id`. Emits `metadata((opgave: <opgave nr>, nr: <vraag nr>, antwoord: …)) <__rtti_vraag>`, then a block (above 0.65em, below 0.65em if directly followed by another vraag, else 1.2em) containing `metadata(id) <__rtti_vraag_boven>`, grid `(1.6em, 1fr, auto)` = bold letter (`a`, `b`… or empty when it is the only vraag of its opgave) / body / points (`"1,5p"`, italic 0.9em `luma(100)`, `.` → `,`), and `metadata(id) <__rtti_vraag_onder>`.                                                                                                                                                                                                       |
| `_direct_gevolgd(id)` (`:189-202`)                                              | —                                                                                                                                                                                                           | Queries the bottom marker of `id` and the top marker of `id+1`. True when they are on the same page, at the same x (±0.5pt), and 0 ≤ dy < 1.2em + 0.3em. Needs several layout iterations to converge.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `antwoorden_lijst()` (`:239-252`)                                               | —                                                                                                                                                                                                           | `context`: collects `query(<__rtti_vraag>)`, skips `antwoord == none`, and labels each entry `"<opgave><letter>"`. One line per opgave (`stack(spacing: 0.8em)`), with items joined by `h(0.8em)`. If there are none: `_Er zijn geen antwoorden ingevuld._`.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `antwoorden_omgekeerd()` (`:256-269`)                                           | —                                                                                                                                                                                                           | If there are answers: `place(bottom, float: true, clearance: 2em, rotate(180deg, reflow: true, block(stroke bottom 0.5pt luma(170))[gray luma(120) 0.9em "**Antwoorden**" + antwoorden_lijst()]))`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `num`, `quan`, `set-num` (zero 0.7.1)                                           | —                                                                                                                                                                                                           | Number formatting with a decimal comma (`#num[1234.5]` → `1234,5`, `#quan("3.5 m/s")` → `3,5 m s⁻¹`) _(verified)_.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

The **opdracht file contract** (teacher-authored, from `base_assignment.typ`) is:

```typst
#import "lib.typ": *
#let setup_extra() = []          // content placed right after #show: setup
#let render_uitleg() = [ … ]
#let render_opgaven() = [ #opgave(titel: "…")[ … #vraag(punten: 2, antwoord: […])[…] … ] … ]
```

All three names must exist, or the wrapper import fails.

**Markers and who reads them**

| Label                                           | Written by                                        | Read by                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `<__rtti_vraag>`                                | `vraag`                                           | `_vragen()` (letters, answers) inside Typst                                                                         |
| `<__rtti_vraag_boven>` / `<__rtti_vraag_onder>` | `vraag`                                           | `_direct_gevolgd` inside Typst                                                                                      |
| `<__rtti_cursor>`                               | editor (`editor-init.js:351`) in the preview copy | `CURSOR_FOREGROUND` inside Typst. It surfaces in SVG as `<a href="rtti-cursor:">`. Nothing in JS runs `typst query` |

The editor `@` popup lists labels by regex over the **source text** (`/<([\p{L}\p{N}_][\p{L}\p{N}_:.-]*)>/gu`, excluding `__…`), not through Typst (`editor-init.js:899-903`).

Editor-inserted snippets that should keep compiling: opgave/vraag snippets (`editor-init.js:1134-1146`), figure `#figure(\n  image("images/<id>/<file>", width: 80%),\n  caption: [Onderschrift hier],\n) <label>` (`:1194-1203`), and table figures (`:1490`).

---

## 6. Root and path rules

- **Root = appDir.** All absolute Typst paths (`/…`) resolve under it:
  - `/data/opdrachten/lib.typ`, `/data/opdrachten/<typFile>` (wrapper imports),
  - `/data/fotos/school-watermerk.svg` (rapport background),
  - `rtti_export.typ` is imported **relative** from `temp/_rapport_run.typ`, which means `/temp/rtti_export.typ`.
- Wrappers live in `/temp/…` (A, B, C) or `/temp/opdrachten_run/…` (D). Opdracht files are imported by absolute path, so **relative paths inside an opdracht resolve against `/data/opdrachten/`**:
  - `#import "lib.typ": *` → `/data/opdrachten/lib.typ` (the same file the wrapper imports, so one module),
  - images `image("images/<opdrachtId>/<name>.<ext>")` → `/data/opdrachten/images/<id>/…`. Supported extensions are png, jpg, jpeg, gif, svg and webp (`main.js:243`). Names are cleaned to `[A-Za-z0-9_-]`, max 60 characters (`main.js:255-262`).
  - Copying an opdracht rewrites the string `images/<oldId>/` to `images/<newId>/` in the source text (`store.js:1186-1189`).
- Teacher code may read **any** file under appDir (`read()`, `json()`, `image()`): all of `data/` (scores, users) plus `temp/` and the app folder. Paths outside root are rejected by Typst.
- **`lib.typ` deployment** (`main.js:965-974`): at every start, `include/templates/lib.typ` is compared by SHA-1 with `data/opdrachten/lib.typ` (`sync.js:24-42`) and written atomically (`writeFileAtomic`: temp `<file>.<pid>.tmp`, then rename with retries) **only when the hashes differ**. Compiles read the **data copy**, not the bundled one. The header comment "always overwritten" (`lib.typ:2`) is accurate in effect, because any difference is overwritten.
- New opdracht files are copies of `base_assignment.typ` (`main.js:231-236`).

---

## 7. Packages and fonts

### 7.1 Fonts

- `--font-path include/fonts`: Source Serif 4 static OTFs (ExtraLight, Light, Regular, Semibold, Bold, Black, each with italic: 12 files) and `STIXTwoMath-Regular.otf`. There is no ExtraBold, so weight 800 resolves to Black.
- Typst's **embedded fonts** (typst-assets): Libertinus Serif, New Computer Modern (+Math) and DejaVu Sans Mono are available too (`typst fonts --ignore-system-fonts` lists them _(verified)_). The rapport really embeds **Libertinus Serif Bold** for `●`/`◇` in the bold scoretabel header _(verified)_.
- **System fonts are enabled.** On Windows, emoji (observatie icons ❌, 5️⃣, any teacher icon, 👑/🥈 in the rapport) come from **Segoe UI Emoji** _(verified)_. With `--ignore-system-fonts` the compile **still succeeds silently** (exit 0, no warning) and the emoji render as tofu boxes. A keycap `5️⃣` turns into three boxes _(verified, compare `inject.png` vs `inject_nosys.png`)_.
- Teachers may name any installed font in opdracht files (`set text(font: "…")`). That only works with system fonts.

### 7.2 Packages

- `--package-path include/packages` replaces Typst's **data** directory (`%APPDATA%\typst\packages`). Typst still consults the **cache** directory (`%LOCALAPPDATA%\typst\packages`) and **downloads from packages.typst.org** when a package is missing from both.
- Vendored: `@preview/zero:0.7.1` (no dependencies, `compiler = "0.12.0"`).
- **Not vendored, used by the rapport**: `@preview/cetz:0.3.4` (depends on `@preview/oxifmt:0.2.1`) and `@preview/unify:0.8.0`. With an empty `--package-cache-path` the CLI downloads all three _(verified)_. On the developer machine they sit in `%LOCALAPPDATA%\typst\packages\preview\` (which also contains unify 0.7.1, zero 0.7.1 and others). On a fresh offline machine **the rapport cannot compile**.

---

## 8. Requirements for a sandboxed Rust `World`

Minimum file system view, mapped as virtual paths under root `/`:

| Virtual path                                                                                                                             | Source                                       | Needed by                |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------ |
| main source (wrapper, any id, e.g. `/temp/_rapport_run.typ`)                                                                             | generated in memory                          | all                      |
| `/temp/rtti_export.typ` (or wherever the wrapper's relative import points)                                                               | bundled template                             | A                        |
| `/data/fotos/school-watermerk.svg`                                                                                                       | data dir; **compile error if absent** (spec) | A                        |
| `/data/opdrachten/lib.typ`                                                                                                               | data dir (the hashed copy)                   | B, C, D                  |
| `/data/opdrachten/<typFile>` and `/data/opdrachten/_preview_<typFile>` (C; the port may serve the editor buffer in memory under this id) | data dir / editor buffer                     | B, C, D                  |
| `/data/opdrachten/images/<id>/*`                                                                                                         | data dir                                     | B, C, D (any `image()`)  |
| any other path under appDir that teacher code names                                                                                      | data dir/app dir                             | B, C, D (spec allows it) |

Packages: `@preview/zero:0.7.1`, `@preview/cetz:0.3.4`, `@preview/oxifmt:0.2.1` and `@preview/unify:0.8.0`. A sandbox without network must ship all four. Package paths in diagnostics look like `@preview/zero:0.7.1\src\quan.typ`.

Fonts: `include/fonts/*` + typst-assets embedded fonts (Libertinus Serif at least, for `●`/`◇`) + an emoji font. For pixel parity on Windows that means **Segoe UI Emoji**, i.e. system fonts, or the same font file loaded explicitly. The library build does not include system font discovery by default. It has to be added (e.g. `typst-kit` `FontSearcher` with system fonts) or emoji silently disappear.

Other World hooks:

- `today()`: not used by any template. Teacher files could call `datetime.today()`, which the CLI answers with the local date.
- PDF creation timestamp: the CLI writes the current time unless told otherwise. Pin it for golden tests (the CLI has `--creation-timestamp`).
- Layout iterations: `_direct_gevolgd` and the answer queries rely on Typst's default introspection loop (max 5 iterations).
- No `sys.inputs`. The data is source text.

Export settings to reproduce: PDF with default options (Typst 0.14 standard PDF, no PDF/A) and SVG per page (`typst_svg::svg(page)`), with default page size A4 from templates.

---

## 9. Error and diagnostic flow to the UI

| Path | Error object                                                              | UI                                                                                              |
| ---- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| A    | `{success:false, error: stderr \|\| err.message}`                         | `<pre>` in the modal + toast "Compilatiefout bij het genereren van het rapport."                |
| C    | same, with `_preview_<f>` → `<f>`                                         | status button "Fout bij renderen" + popover (textContent); the retry without marker comes first |
| D    | `Fout in opdracht "<label>":\n\n<stderr>`, or `e.message` from pdf-lib/fs | `<pre>` + toast                                                                                 |
| B, E | `{success:false, error}`                                                  | no UI caller                                                                                    |

Only the first error per batch is reported. Warnings never reach the UI. JS exceptions from fs writes before compile (C) return `e.message`.

---

## 10. Parity test candidates (synthetic data only)

Set the PDF timestamp to a fixed value. Compare page count, extracted text (`pdftotext -layout`) and per-page PNG at 110–144 ppi with a small tolerance.

1. **Opdracht, student mode, `base_assignment.typ` unchanged, `placeholderHeader("Remweg")`**: 2 pages. Page 1 shows the header with the two-line observatie and ❌ (emoji). Page 2 has Opgave 1 (a/b/c with `2p`/`1p`/`1p`, the gap rule between a and b) and Opgave 2 (grid with the "Figuur" rect), plus the upside-down "Antwoorden" float at the bottom _(verified 2 pages)_.
2. **Same in answers mode**: 1 page, "Antwoordsleutel", lines `1a … 1b … 1c …` / `2 Het antwoord.` _(verified)_.
3. **Header injection**: `student: 'x#y $z$ *b*'`, `title` with `"` and `\`, group with a trailing newline, observaties `[5️⃣ Cijfer onder 5,5, ❌ Rekenfout]`. Literal text plus the emoji _(verified)_.
4. **Empty observaties** (`observaties: ()`): empty right cell.
5. **Opdracht with lib features**: `voorbeeld_blok(name:)`, `formule_blok`, `belangrijk_blok`, a labelled opgave with `@ref` ("Opgave 1"), `#figure(table(…), caption:)` (caption on top, "Tabel 1"), an image figure (`images/<id>/x.png` + `.svg`), `#num[1234.5]` → `1234,5`, `#quan("3.5 m/s")`, a vraag with `punten: 1.5` → `1,5p`, a single-vraag opgave (no letter), a vraag outside any opgave (label `0…`), and an opgave spanning a page break.
6. **SVG preview with cursor marker** inside an opgave: page count, a `<a href="rtti-cursor:">` on the right page, and the page file order for ≥ 10 pages.
7. **Batch duplex**: three students with page counts 2, 1+2 (two opdrachten, same key) and 3. Expected merged page sequence: S1 p1–2, S2 p3–5, blank p6 sized like p5, S3 p7–9 = 9 pages. Plus a run where an opdracht fails, checking the error text prefix.
8. **Rapport, 1 student**: 2 pages, footer `1 / 2`, watermark, no histogram _(verified)_.
9. **Rapport, 12 students** with spread grades, one `grade_overridden`, scores `null`, a `bonus` question, observaties with emoji, leeradvies markup with `*bold*`, `#num[…]`, `$…$`, an odd-`$` sanitised advies, and an empty `uitleg_rtti.T1` (`—`): 24 pages, histogram plus the 👑/🥈 lines _(verified)_.
10. **Rapport edge cases**: a fractional `score` (7.5 printed with a dot), a fractional question score (`str(int())` truncation), a student with a 3-page first section (footer still "/ 2"), and a missing watermark (expected compile error text).
11. **Diagnostics**: an unclosed delimiter in an opdracht file. The error text must mention the opdracht's file name (not `_preview_…`) with line and column.

Golden inputs must be synthetic (fake names such as "Leerling 0", ids `100000+`). Scratch generators used for verification are `scripts/gen.js` and `scripts/gen_rapport.js` in the session scratchpad. They extract the real `toTypst`/`buildAssignmentWrapper` code from `main.js`.
