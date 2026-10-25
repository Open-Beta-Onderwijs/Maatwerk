# Backlog

Minor review findings and deferred work (PLAN.md 2.3). Newest first.

## From the Step 0 review (`docs/reviews/step-00.md`)

- **m6 (Step 6):** full third-party notices for the ~300 bundled crates (e.g. `cargo about`) and an
  "Over Maatwerk" screen with licence text and a source link, before the exe is distributed (AGPL
  section 13 / GPL section 6).
- **n1 (Step 3):** CSP. The reference UI has ~262 inline `style=` attributes, which
  `style-src 'self'` blocks. Decide in Step 3 (move to classes vs. a nonce/hash); do not add
  `'unsafe-inline'` silently. Also add `object-src 'none'; base-uri 'self'; frame-ancestors 'none'`.
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
