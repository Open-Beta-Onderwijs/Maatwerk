# State

Last updated: 2026-10-27 (Step 4 done) Branch: `main` Last tag: `step-04`

## Current step

Step 4 is done (4a `step-04a`, 4b `step-04b`, merged into `main`, tag `step-04`). Waiting for the
user before Step 5 (Typst service).

## Step 4b summary

- Core `watcher` (spec S28-S40): engine on a virtual clock + thread driver on `notify` 8.2.1
  (CC0-1.0); 20 s poll, 500 ms debounce, 100 ms batches, parse retry, restart after errors and
  every 60 s (review M1: Windows `notify` stops silently). Own writes: `WriteObserver`
  `will_change`/`note_write`/`note_delete`/`change_failed`. `rapporten/` ignored. Quirk D36 fixed
  (own writes to ignored paths), D35/S34 kept.
- Core `presence`: `users/<id>.json`, previous user offline on switch, `close` on quit.
- App: 16 commands (storage, presence, session) on `spawn_blocking`, `CommandError {code,
message, details}`, event `data:changed`. Bindings by `tauri-specta` rc.26 (ADR-0005),
  `ui/src/bridge/bindings.ts`, stale check in `cargo test`, `npm run bindings`. `build.rs` links
  the Common Controls manifest into test binaries (else `STATUS_ENTRYPOINT_NOT_FOUND`).
- UI: `TauriApi` compat layer (`tauri-api.ts`) with contract tests; presence calls queued.
- `npm run data:dev` + `npm run dev`: real app on synthetic data (smoke run: subject picker).
- Review `docs/reviews/step-04b.md`: M1, m1-m4, m6 fixed; m5 partly; rest in `docs/backlog.md`.
- `/security-review` could not run (needs `origin/HEAD`; no remote). The reviewer's checklist
  covered security.
- Not wired yet: `Watcher::set_scope_year` (C7, Step 6a); opdracht images, Typst, `openPath`
  still throw "nog niet beschikbaar" (Steps 5-6).

## In progress

- Nothing.

## Next action (concrete, resumable)

1. When the user says go: Step 5 (PLAN.md section 6, Step 5). Run `/security-review` once a
   remote exists.

## Open questions for the user

- Remote repo still to create (`gh` not installed), so CI has not run on 3b/4a; PLAN section 9
  items (emoji font Step 5, domain logic location Step 10, versioning, macOS).

## How to resume

PowerShell for npm/cargo (Git Bash's `link` shadows MSVC's), but edit files with the editor or
Python, never `Get-Content`/`Set-Content` (they re-encode UTF-8). `npm ci; npm run build:ui`, then
the gate commands in `CLAUDE.md`, plus `npm run test:e2e` (needs `npx playwright install chromium`
in `ui/`). `npm run test:visual -w ui` needs a local baseline (`-- --update-snapshots` before a
change). Goldens: `npm run golden:check` (needs `_reference/` at `0e30a70` and the Typst packages
cetz/unify/oxifmt in `%LOCALAPPDATA%\typst\packages`). `cargo-deny` 0.20.2 is installed.
