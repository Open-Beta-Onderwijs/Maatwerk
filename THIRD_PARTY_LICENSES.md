# Third-party licences

Components shipped inside the Maatwerk executable. Rust crates are checked by `cargo deny`
(`deny.toml`), npm packages by `tools/check-npm-licenses.mjs`. This file lists the direct
dependencies and every non-code asset (fonts, Typst packages, images); update it when one is added.

## Rust crates (direct)

| Crate                                   | Licence               |
| --------------------------------------- | --------------------- |
| tauri, tauri-build                      | Apache-2.0 OR MIT     |
| serde, serde_json                       | MIT OR Apache-2.0     |
| sha1                                    | MIT OR Apache-2.0     |
| thiserror                               | MIT OR Apache-2.0     |
| base64                                  | MIT OR Apache-2.0     |
| ryu                                     | Apache-2.0 OR BSL-1.0 |
| notify                                  | CC0-1.0               |
| tracing                                 | MIT                   |
| tracing-subscriber                      | MIT                   |
| specta, specta-typescript, tauri-specta | MIT                   |
| typst, typst-pdf, typst-kit (0.14.2)    | Apache-2.0            |
| time                                    | MIT OR Apache-2.0     |

Test-only (not shipped): proptest (MIT OR Apache-2.0), tempfile (MIT OR Apache-2.0), typst-render
(Apache-2.0), tiny-skia (BSD-3-Clause).

Transitive crates: run `cargo deny list` for the full inventory.

## npm packages bundled in the UI

| Package                                                       | Licence           |
| ------------------------------------------------------------- | ----------------- |
| @tauri-apps/api                                               | Apache-2.0 OR MIT |
| @codemirror/state, view, commands, language; @lezer/highlight | MIT               |
| chart.js                                                      | MIT               |
| chartjs-plugin-annotation                                     | MIT               |
| pdfjs-dist                                                    | Apache-2.0        |

`handsontable` (HandsOnCode Non-Commercial licence), used by the reference app, was removed in
Step 3b (own score grid, ADR-0004); the npm licence check rejects it.

## Assets

| Asset                         | Source                                                          | Licence                                                                     |
| ----------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| App icon (`src-tauri/icons/`) | Generated from `overig/maatwerk_icon.png` in the reference repo | AGPL-3.0-or-later (author of the reference repo is the author of this repo) |

### Fonts

| Font                                                            | Where                                                     | Licence                                                      |
| --------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------ |
| Source Serif 4 (12 static styles)                               | `crates/maatwerk-core/assets/fonts/` (from the reference) | OFL-1.1 (`OFL-SourceSerif4.md`)                              |
| STIX Two Math                                                   | `crates/maatwerk-core/assets/fonts/` (from the reference) | OFL-1.1 (`OFL-STIXTwo.txt`)                                  |
| Libertinus Serif                                                | `typst-assets` 0.14.2 (`fonts` feature, via `typst-kit`)  | OFL-1.1                                                      |
| New Computer Modern 10, New Computer Modern Math                | `typst-assets` 0.14.2                                     | GUST Font License                                            |
| DejaVu Sans Mono                                                | `typst-assets` 0.14.2                                     | Bitstream Vera Fonts licence (DejaVu changes: public domain) |
| Foxit standard PDF fonts (Sans, Serif, Fixed, Symbol, Dingbats) | `typst-assets` 0.14.2 (used by Typst for PDF images)      | BSD-3-Clause (PDFium)                                        |

The Typst-embedded fonts are kept for parity: the reference CLI had them too (raw text uses DejaVu
Sans Mono, the rapport's bold table header uses Libertinus Serif for `●`/`◇`). Emoji come from the
system (Segoe UI Emoji on Windows); nothing is bundled for them (open decision, PLAN section 9).

### Typst packages (embedded, `crates/maatwerk-core/assets/packages/preview/`)

| Package                 | Licence           | Used by                     |
| ----------------------- | ----------------- | --------------------------- |
| `@preview/zero:0.7.1`   | MIT               | `lib.typ` (opdrachten)      |
| `@preview/cetz:0.3.4`   | LGPL-3.0-or-later | `rapport.typ` (charts)      |
| `@preview/oxifmt:0.2.1` | MIT-0             | `cetz`                      |
| `@preview/unify:0.8.0`  | MIT               | `rapport.typ` (`num`/`qty`) |

Each package folder keeps its `LICENSE`. They are source files compiled by Typst at run time; the
complete source is in this repository, which satisfies the LGPL for `cetz`.

### Typst templates

`crates/maatwerk-core/assets/templates/` (`rapport.typ`, `lib.typ`, `base_assignment.typ`) come
from the reference repo (`include/templates/`), same author, AGPL-3.0-or-later.
