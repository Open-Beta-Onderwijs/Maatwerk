# Third-party licences

Components shipped inside the Maatwerk executable. Rust crates are checked by `cargo deny`
(`deny.toml`), npm packages by `tools/check-npm-licenses.mjs`. This file lists the direct
dependencies and every non-code asset (fonts, Typst packages, images); update it when one is added.

## Rust crates (direct)

| Crate              | Licence           |
| ------------------ | ----------------- |
| tauri, tauri-build | Apache-2.0 OR MIT |
| serde, serde_json  | MIT OR Apache-2.0 |

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

Fonts (Source Serif 4, STIX Two Math; OFL-1.1) and the Typst package `zero` 0.7.1 (MIT) are added
in Step 5 and will be listed here then.
