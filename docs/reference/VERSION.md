# Reference version

Repository: https://github.com/Liveshort/RTTI_analyse_feedback (cloned into `_reference/`, gitignored)

|               |                                                                                        |
| ------------- | -------------------------------------------------------------------------------------- |
| Commit        | `0e30a70cbe4e9286bd54efa5722fb7532c1be308` (2026-10-20)                                |
| App version   | **0.1.6** (`package.json`); the plan was written against 0.1.4                         |
| Bundled Typst | 0.14.2 (b33de9de), `bin/typst/{win,mac,linux}`                                         |
| Main process  | `main.js` 1025 lines (plan: 997), `sync.js` 270, `preload.js` 123; 32 `ipcMain.handle` |
| Licence       | **None.** No LICENSE file, no `license` field in `package.json`                        |

To re-pin: `git -C _reference checkout 0e30a70`.

## Changes since v0.1.4 (`97513cb..0e30a70`)

59 files, +5356 / -352.

- **0.1.5** (`2a6a7ae`, 2026-10-18): field-test fixes. In-app dialogs (replacing native ones),
  unsaved-changes guard, F-key observation shortcuts, bundled fonts (`include/fonts/`: Source
  Serif 4, STIX Two Math, both OFL).
- **0.1.6** (`0e30a70`, 2026-10-20): grade overrides, "Cijfer onder" opdracht cards, bundled Typst
  package `zero` 0.7.1 (MIT) under `include/packages/preview/`.
- Largest code changes: `renderer/screens/scores.js` (+404/-), `renderer/store.js`, `app.js`,
  `opdrachten-genereren.js`, `main.js` (+62), `include/templates/lib.typ`, `rtti_export.typ`.

Relevant for later steps:

- Step 2/5: goldens must cover grade overrides and the new opdracht cards; the Typst World must
  serve the vendored `zero` package and the bundled fonts.
- Step 3: in-app dialogs and the unsaved-changes guard are UI behaviour to keep.
- Roadmap items **not** implemented yet: praktische opdrachten (PO, rubrics, werkgroepjes) and
  graphs-to-PDF export (`CLAUDE.md` roadmap in the reference).
