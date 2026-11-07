# ADR-0010: Phase 2 decisions

- **Status:** accepted, 2026-11-04 (user, `PLAN-2.md` step 12)
- **Context:** the cutover is done; phase 2 (`PLAN-2.md`, `ROADMAP.md`) adds features, fixes and
  a redesign without the parity constraint. Several choices shape the order of the steps and the
  data format.

## Decisions

1. **Domain logic in Rust.** Grades, averages, SD, percentages, attempts (best attempt), RTTI
   statistics and the trend helper move to `maatwerk-core`, used by the screens, the rapport and
   the CLI (step 19). The four JS best-attempt implementations are removed.
2. **Order:** foundation (13-15), platforms (16), teacher-facing fixes (17-21), redesign per area
   (22-27), AI assistant (28), hardening and 1.0 (29).
3. **Releases:** each step is a 0.x minor release; 1.0 after step 29. A manual test on a copy of
   real data only for steps that touch data or numbers (15, 18, 19, 20).
4. **Minimum app version** (`minAppVersion` in `school.json`) before the first data change; an
   older app opens read-only.
5. **Goldens:** the old app's goldens stay as regression tests until a step intentionally changes
   that output; then the new output becomes the golden after the user's visual check.
6. **Per-user settings** in `gebruikers/<id>.json`: theme, accent, editor divider position and the
   active school year (quirk D7 fixed).
7. **Data format v3** (step 18): `fotos/` -> `afbeeldingen/`, `users/` -> `aanwezigheid/`; exam
   fields `kind: "toets" | "po"` and `diagnostic: bool` (PTA stays `type: "pta"`; diagnostic and
   PTA exclude each other; a diagnostic test has weging 0 and counts for neither rapport nor SE);
   observaties copied to resits and locked, also for existing resits; the opdracht link "score on
   question N below X" (`opdrachtenVraag` on the exam, not in `opdracht.json`; a score below X
   or `N` matches, an empty score does not; user 2026-11-07). Leftover folders are removed only
   after the user confirms.
8. **Trend arrow:** best attempt of the most recent counted test minus the weighted year average
   (as on the rapport), diagnostic tests ignored; thresholds in the design spec 2.4.
9. **AI assistant** in step 28, after the editor redesign.

## Consequences

- Step 19 changes numbers on screens and in the rapport: every change gets a before/after table on
  the fixtures and the user's approval.
- Colleagues on 0.3.x must update before step 18 is released; the version guard makes an outdated
  app read-only instead of writing the old format.
