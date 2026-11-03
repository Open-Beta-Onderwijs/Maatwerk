# ADR-0009: AI assistance for writing opdrachten

Status: **accepted 2026-11-03: option D** (see "Decision"). Proposed in Step 9 (2026-11-02). PLAN
section 1 said "AI assistance: not decided. Keep the door open"; PLAN section 9 item 10 is this
decision. This ADR records the seams that exist, the options, the constraints, the user's answers
and the decision. No AI feature is built yet; a later step implements option D.

## Context

Teachers write opdrachten in Typst (`opdracht.typ`, ADR-0002 5a). That is the hardest part of the
app for a teacher who does not program. An assistant could draft an opdracht from a short
description ("drie opgaven over dichtheid, 4 havo, met antwoorden"), fix a compile error, or add
missing answers and points. Step 9 builds the seams that make such an assistant cheap to add later,
whatever form it takes:

- **One folder, nothing else.** An opdracht is a self-contained folder; the Typst World is
  sandboxed to it (ADR-0002 5a, Step 5). Whoever works on an opdracht sees exactly that folder.
- **A check API with structured output.** `maatwerk_core::assignment::check` and
  `maatwerk-cli assignment check --json` (schema `docs/schemas/assignment-check.schema.json`):
  errors and warnings with file, line, column and byte range, page count, vragen with punten and
  answers, and the editor's checks. `render` writes the PDF. Both use main.typ's placeholder
  header, so **no student data is involved**.
- **A context document.** `docs/ai-context/assignment-authoring.md` (~2.5k tokens) plus
  `docs/assignment-examples/` (five examples, checked by a test): the `lib.typ` API, the rules and
  the checks. This is what a model would be given.
- **An export for external editors.** `assignment export-lib` writes the packages and fonts, so
  tools outside Maatwerk (tinymist, the Typst CLI, a coding assistant) compile the same way.

## Options

**(A) In-app assistant.** A panel in the opdracht editor. The teacher types a request; Maatwerk
sends the request, the current `opdracht.typ` and the context document to a model API with the
teacher's (or the school's) own API key, runs the check-fix loop locally, and shows the result as a
diff to accept or reject.

- Key storage: the OS keychain (Windows Credential Manager, macOS Keychain) through a permissive
  crate (e.g. `keyring`, MIT/Apache), never in the shared data folder or in `instellingen.json`.
- Needs: an HTTP client in the app (TLS, proxy settings of school networks), a CSP exception for
  the API host (from Rust only, not the webview), a settings screen, error texts for quota,
  network and refusal, and a provider choice.
- Pros: one place for the teacher; the diff/accept flow fits the editor (undo history, CAS save,
  compile preview). Cons: most code and maintenance; ties the app to a provider's API; cost per
  teacher or per school; needs network.

**(B) External tool on the folder.** Nothing in the app. A teacher (or a colleague who likes
this) uses an AI coding tool of their choice on a copy of an opdracht folder, or on the folder
itself while Maatwerk is closed, with `docs/ai-context/assignment-authoring.md` as context and
`maatwerk-cli assignment check --json` as the feedback loop.

- Pros: no code in the app, no keys, no provider choice; works today. Cons: only for technically
  confident teachers; editing in the shared OneDrive folder bypasses the app's CAS. An outside
  edit while the opdracht is open in the editor shows the editor's conflict bar at the next save;
  with the editor closed nothing notices it (the integrity stamps cover the JSON files only, not
  `.typ`). A copy-and-paste-back workflow is safer.

**(C) B now, A later.** Document B for the few who want it; build A when there is demand and a
decision on provider, cost and privacy. The seams of Step 9 serve both.

## Constraints (any option)

1. **Privacy (AVG/GDPR).** Only the opdracht's own text (`opdracht.typ`, optionally `lib.typ`),
   its parameters (title, vak, jaarlaag, observatie names) and the teacher's request leave the
   machine. **Never** student names, groups, scores, grades, reports, leeradvies texts, the
   gebruikers files or anything else from the data folder. The check API already compiles with
   the placeholder header; an in-app assistant must not read the data folder beyond the one
   opdracht folder, and must not send images unless the teacher chooses to (images could show
   students). The school (as data controller) may need a processing agreement with the provider
   even for this; see the questions.
2. **Human in the loop.** The assistant proposes, the teacher decides: a diff of `opdracht.typ`,
   accept or reject, and the normal undo history afterwards. Nothing is saved, printed or shared
   without the teacher's action.
3. **Compile-check-fix loop.** A proposal is checked with the same `check` API before the
   teacher sees it; errors and checks are fed back to the model for a bounded number of rounds
   (e.g. 3). The teacher sees the remaining diagnostics if it does not converge.
4. **Sandbox.** The model's output is only ever Typst source compiled in the sandboxed World
   (one folder, embedded packages only, no network, no file access outside the folder, compile
   time limit of `instellingen.json`; the headless `check`/`render` of Step 9 have no time limit
   yet, so an in-app assistant must run them under the editor's watchdog or add one). Model output is never run as anything else.
5. **Cost.** Per-request cost on the teacher's or school's key; show nothing that implies it is
   free. A monthly cap or a confirmation for long requests may be needed (option A).
6. **Offline.** Maatwerk works fully without network; the assistant is the only part that needs
   it and fails with a clear Dutch message. No feature depends on it.
7. **Licences.** Any new crate or npm package must be AGPL-compatible (PLAN 2.5). Model output is
   the teacher's content; the context document and examples are AGPL (they are in this repo).

## Questions for the user

1. Is AI assistance wanted at all, and for whom: every teacher, or a few who opt in?
2. Option A, B or C?
3. Provider: which model provider(s) are acceptable to the school (data location EU, retention,
   training on submitted data off)? Does the school need a processing agreement (verwerkers-
   overeenkomst) even when no personal data is sent?
4. Whose API key and who pays: each teacher, or one school key (then where is it stored, and who
   may use it)?
5. What should it do first: draft a new opdracht from a description, fix compile errors, add
   missing answers/punten, rewrite for another level, or all of these?
6. May an opdracht's images be sent (e.g. for "describe this figure"), with a warning?
7. For option B: is editing opdracht files outside the app acceptable, or only on copies?

## Answers (user, 2026-11-03)

1. **Wanted, for every teacher.** The assistant is available to every teacher (no school-level
   switch); it appears when an AI CLI is found on the machine.
2. **Option A, but through the AI vendors' command-line tools, not their APIs** (option D below).
3. **Provider: the teacher's choice.** Maatwerk is provider-neutral; whatever CLI the teacher has
   installed and logged in to is acceptable. (Any processing agreement is between the teacher or
   school and that vendor, not Maatwerk's concern.)
4. **No API key, nobody pays through Maatwerk.** The teacher installs the CLI and logs in to their
   own subscription outside Maatwerk. Maatwerk stores no credentials.
5. **First tasks: all four**: draft a new opdracht from a description, fix compile errors, add
   missing answers/punten, rewrite for another level.
6. **Images: yes, per request, with a warning.** Off by default; the teacher ticks it for one
   request and sees a warning that images could show students.
7. **Workspace: a temporary copy.** The CLI never works in the shared data folder. Maatwerk copies
   the opdracht folder to a temp dir, runs the CLI there, and shows the result as a diff to accept
   in the editor.
8. **CLI commands: built-in presets plus an override.** Maatwerk ships a preset per known CLI
   (detected on `PATH`); a settings screen lets the teacher edit the command and arguments per CLI,
   with "standaard herstellen", so a vendor's syntax change does not need a new Maatwerk release.

## Decision

**(D) In-app assistant on the teacher's own AI CLI.** A panel in the opdracht editor. Maatwerk
detects which supported AI CLIs are installed (e.g. Claude Code, OpenAI Codex CLI, Gemini CLI;
the list and the exact non-interactive invocation of each are researched in the implementing
step), the teacher picks one, types a request, and Maatwerk:

1. copies the opdracht folder (`opdracht.typ`, `lib.typ`, `main.typ`, and `images/` only when the
   teacher ticked it) plus the context document to a fresh temp dir outside the data folder;
2. runs the CLI non-interactively in that dir with the request, the task (one of the four above)
   and the instruction to use `maatwerk-cli assignment check --json` (or a bundled equivalent) as
   the feedback loop, under a time limit, with the CLI's own restrictions (no network tools beyond
   the model, edits only in the working dir) where the CLI offers them;
3. checks the result itself with `check` (constraint 3), and shows `opdracht.typ` as a diff with
   the remaining diagnostics; accept puts it in the editor buffer (undo history, CAS save as
   usual), reject discards it. The temp dir is deleted afterwards.

Command presets live in the app (code) with per-teacher overrides in the local settings (not in
the shared data folder). Constraints 1-7 above still apply, with these changes: no API keys, no
HTTP client and no CSP exception in Maatwerk (the CLI does the network); cost is the teacher's
subscription; an agentic CLI can in principle read files outside its working dir, so Maatwerk
passes the CLI's sandbox/permission flags where they exist and documents the residual risk.

## Consequences

- Step 9 adds no AI code and no new dependency; the seams (check/render/export-lib, the JSON
  schema, the context document and examples) are useful without AI too (CI, tinymist, reviews).
- The check JSON is versioned (`maatwerk-assignment-check/1`); a consumer can rely on it.
- A later step implements option D against these constraints: CLI detection and presets, the
  settings screen, spawning a child process from Rust (`spawn_blocking`/async process, time limit,
  cancel), the temp-copy workspace, the diff/accept panel and Dutch error texts (CLI missing, not
  logged in, time-out, no change). Options A (API) and B (external only) are not pursued; B stays
  possible for anyone with `export-lib` and the CLI.
