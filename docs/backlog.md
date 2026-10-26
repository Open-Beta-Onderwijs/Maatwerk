# Backlog

Minor review findings and deferred work (PLAN.md 2.3). Newest first.

## From Step 3a

- **Styling cleanup (Step 10):** the 268 inline styles became pixel-identical CSS (Step 3a): about
  130 one-declaration `u-*` utilities (`!important`, mirroring inline precedence) plus a few
  component classes (`grade-pill`, `gl-*`, `obs-icon-btn`). Consolidate them into semantic
  component classes and fix the inconsistencies they preserve (e.g. grade pills 34 vs 36 px, two
  panel paddings `10px` vs `10px 12px 14px`, `#aaa` vs `#9aa0ab` greys). Each visible change needs
  the user's eye; `npm run test:visual` shows the diff.
- **U18:** the period separators in the group students modal never rendered; add them if wanted.
- **Dependency updates after parity (Step 10):** pdfjs-dist 4.9.155, chart.js 4.4.2 and
  chartjs-plugin-annotation 3.0.1 are pinned to the reference versions.

## From the Step 2 review (`docs/reviews/step-02.md`)

- **m3/m4 (Step 5):** Typst error goldens: normalise canonical and 8.3 temp paths too, and compare
  diagnostics separator-neutrally (`\` vs `/`).
- **m6 (Step 5/6):** store an explicit merged-page map for batch goldens (job, page, blank) and
  PNGs for multi-job batches if pixel parity of the merge matters.
- **m7 (Step 6):** record `assignment:progress` events in the batch goldens.

## From the Step 2a review (`docs/reviews/step-02a.md`)

- **n4:** `attempts` golden: store the grade `resolveBestAttempts` compared
  (`Store.calcResults(...).grade`) next to each history entry, so the case explains itself.

## From the Step 0 review (`docs/reviews/step-00.md`)

- **m6 (Step 6):** full third-party notices for the ~300 bundled crates (e.g. `cargo about`) and an
  "Over Maatwerk" screen with licence text and a source link, before the exe is distributed (AGPL
  section 13 / GPL section 6).
- ~~**n1 (Step 3):** CSP~~: done in Step 3a (classes + CSSOM style data, `ui/vite/csp.ts`,
  `ui/e2e/csp.spec.ts`).
- **n3:** `LICENSE` is the SPDX reflowed AGPL-3.0 text; replace with the verbatim gnu.org text when
  gnu.org is reachable.
- **n5:** `src-tauri/tauri.conf.json` `version` duplicates the Cargo workspace version; drop it
  (Tauri falls back to the Cargo version) or check it in CI.
- **n6:** SPDX check skips toml/yml; decide whether config files need headers and whether to add a
  copyright line convention.
- **n9:** CI hygiene: pin actions by SHA (Dependabot), avoid double runs on push + PR, avoid
  installing the Windows target on Linux runners.
- **n2:** keep the two licence allowlists (`deny.toml`, `tools/check-npm-licenses.mjs`) in sync;
  consider generating one from the other.

## Other

- **`rapporten/` retention** (Step 1 decision, ADR-0002 section 9): printed copies accumulate in the
  shared folder; decide a cleanup or archive policy with the user (after cutover).
- **Upgrade to Tauri 3 once 3.0 is stable** (decided 2026-10-25, Step 0). On 2026-10-25 Tauri was
  at `3.0.0-alpha.5` (needs Rust 1.95), plugins at alpha, `tauri-specta` without Tauri 3 support.
  Revisit around Step 10; the thin `src-tauri` layer keeps the upgrade small.
