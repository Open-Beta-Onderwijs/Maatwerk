# Review: step 32, AI assistant (32a, 32b, 32c)

Reviewer: fresh-context subagent, 2026-11-19. Scope: `git diff main...step/32-ai` without the
generated `ui/src/bridge/bindings.ts`, `THIRD_PARTY_NOTICES.txt` and the design mocks. Read
against `PLAN-2.md` decisions 48-77 and the step 32 section, ADR-0009 (constraints, "Amendment
(step 32)", "Custom CLI", "Real-CLI check", "Findings for 32a") and spec 4.8.1. Read in full:
`src-tauri/src/ai.rs`, `crates/maatwerk-core/src/ai/{workspace,turn,run,diff,detect,check,school}.rs`,
the presets and placeholders in `provider.rs`, `ui/src/modals/editor-ai.ts`,
`ui/src/editor/ai-protocol.ts`, `ui/src/editor/ai/{client,dom,install}.ts`, the run/apply/undo
part of `ui/src/editor/ai/panel.ts`, `ui/src/modals/{opdracht-ai,opdracht-edit}.ts` (diff),
`ui/src/modals/opdrachten-genereren/{failures,generate}.ts`, the `editor-init.js`, `editor.ts`,
`instellingen.ts` and `user-menu.ts` hunks, and the timing-sensitive tests. `events.rs`,
`history.rs`, `composer.ts`, `cards.ts`, `review.ts` and the settings dialog were only skimmed
(structure, DOM building, image preview). No tests were run in this review.

Accepted deviations, not reported: monograms instead of vendor logos (user, 2026-11-19); no
`minAppVersion` raise for the school switch (`docs/reference/data-files-v3.md`).

## Summary

The overall shape is sound and matches the decisions. The teacher's text never reaches a
command line: every preset passes only the fixed ASCII `{prompt}`, the message goes into
`.maatwerk/request.md` (finding 1). Placeholders are expanded per token after a shell-like split,
the teacher's own arguments are validated against the known placeholders, and session ids and
paths are separate argv entries. Rust's batch-file escaping covers the `.cmd` shims. Every id that
becomes a path segment (gebruiker, opdracht, provider key, other opdrachten) passes a
`[A-Za-z0-9_-]` or `custom-[a-z0-9-]` check before it is joined. Attachment and syllabus names
are cleaned with `clean_image_name` before they are written into the workspace. Proposal images
are looked up by their path in the saved proposal, never taken from the UI as paths. The iframe
names a method from a fixed allowlist; the main window adds the teacher and the opdracht (U10),
checks `evt.source`, and validates provider keys and argument shapes. All new UI builds DOM through
`h()` with text nodes; the one new `innerHTML` escapes its text, and the PDF preview of a proposal
is shown as `<img src=blob:>`, so SVG scripts cannot run. Real images only enter the workspace with
the Afbeeldingen chip; otherwise they are same-size grey placeholders, and the PDF context and the
check use the placeholder header. A stopped, timed-out or failed run keeps no proposal (the run
folder is cleared in `prepare`, `proposal.json` is written only for a proposal). The
process-tree kill, the time limit across fix rounds and the grandchild-holds-the-pipes case have
real-process tests. `maatwerk-core` gains no tauri dependency, and every command does its work
off the async runtime.

The findings that matter are about security and privacy at the edges. The bundled check script
lives inside the folder the CLI may edit, so for Gemini, Vibe and Copilot the "only the check may
run" rule can be bypassed by rewriting the script (M1). "Laat AI dit oplossen" attaches the error
text of a real per-student compile (M2). Closing the editor neither stops a run nor lets the
reopened editor see or stop it (M3). The image apply/undo is business logic in the Tauri shell
with no tests (M4). Smaller points are the syllabus name check on Windows, `check.cmd` with
non-ASCII paths, a race in Toepassen while typing, and file sizes.

## Blockers

None.

## Majors

### M1. The CLI can rewrite the check script it is allowed to run (Gemini, Vibe, Copilot)

`crates/maatwerk-core/src/ai/workspace.rs:633-667` writes `.maatwerk/check` and
`.maatwerk/check.cmd` **inside the workspace**. The permission rules then allow exactly that
command and deny other shell commands:

- Gemini (`workspace.rs:689-697`): `run_shell_command` allowed with `commandPrefix =
".maatwerk/check"`, preset `--approval-mode auto_edit` (`provider.rs:166-169`), so file edits in
  the workspace are auto-approved;
- Vibe (`workspace.rs:672-687`): shell allowlist `.maatwerk/check`, `--agent accept-edits`
  (`provider.rs:115`);
- Copilot (`provider.rs:112-113`): `--allow-tool "write,shell(.maatwerk/check)"`.

A model that writes `.maatwerk/check` (an ordinary file in its working dir) and then runs it gets
an arbitrary shell, which decision 50 and the amendment ("other shell commands stay denied where
the CLI allows it") say it should not have. The trigger does not have to be the teacher: a prompt
injection in a syllabus PDF, an attachment, another opdracht or a web page is enough. That shell
runs on a machine that has the data folder with student data, and the same CLIs may use
`web_fetch`. Claude Code is not affected: its `Edit(...)` rules only allow `opdracht.typ` and
`images/**`. Codex cannot deny shell commands at all (finding 7, accepted residual risk), so this
is about the three CLIs where the denial was supposed to work.

The prefix rule is also loose. `commandPrefix = ".maatwerk/check"` matches `.maatwerk/checkX` and,
depending on how Gemini splits chained commands, `.maatwerk/check; …`. That is not verified here,
but it belongs in the manual check.

Fix: keep the script out of the CLI's writable area. Write it into the run folder (outside the
workspace; Claude's `--restricted`, Vibe's `outside_workdir = "deny"` and Copilot's path check keep
writes in the workdir) and allow it by absolute path. Alternatively, allow the program itself
(`"<maatwerk.exe>" --ai-check .`) instead of a script. At least rewrite and verify the script
before Maatwerk's own check, and make it read-only, although a read-only attribute does not stop
a delete-and-recreate. Add a fake-CLI test that edits `.maatwerk/check` and asserts that the
allowed command is still Maatwerk's.

### M2. "Laat AI dit oplossen" sends the error of a real student's compile

`ui/src/modals/opdrachten-genereren/generate.ts:131-143` attaches `Fout in opdracht
"<label>":\n\n${f.error}` as "Foutmelding genereren.txt". `f.error` is
`CompileError::to_text()` of the **first failed batch job**
(`crates/maatwerk-core/src/typst_svc/batch.rs:83-94`). That job compiled with a real
`OpdrachtHeader` (`student`, `group`, `exam`, the student's observaties; `typst_svc/opdracht.rs:42-53`),
passed to `main.typ` through `sys.inputs`. `diagnostics::to_text` (`diagnostics.rs:183-200`)
prints messages, source snippets, hints and the trace. Typst messages can echo runtime values,
for example `panic(…)` and `assert.eq` texts, "dictionary does not contain key …", and
string-index errors that give lengths. An opdracht whose text uses the header (or a future
`lib.typ` check) can therefore put a student's name, group or toets name into the attachment.
Decision 54 and ADR-0009 constraint 1 say "never" for this data. The teacher sees the
attachment before sending (decision 75), but nothing says it may contain student data, and a
chip with a file name does not invite reading it.

Fix: do not attach the batch text. Recompile the opdracht with the placeholder header, which is
what the editor shows anyway, and attach that report. Or attach nothing and preselect the
"Fouten & waarschuwingen" chip, which already holds the same errors from the placeholder compile
and is what Fouten oplossen needs. Add a unit test: a failure whose text contains a header value
must not reach `AiStart.attachments`.

### M3. Closing the editor leaves the run going, and the reopened editor cannot see or stop it

`closeEditor` (`ui/src/modals/editor.ts`, around 103-118) clears the frame but does not call
`ai.stop`. The backend run continues until it ends or hits the time limit, up to 30 minutes on the
teacher's subscription. When the editor is opened again, `AiPanel.init` reads `conversations()`
and keeps only `open`; `running` is dropped (`ui/src/editor/ai/panel.ts:152-153`). The panel then
shows an idle, enabled composer with no status card and no Stop. Sending gives the backend error
"Er loopt al een AI-opdracht voor deze opdracht." (`src-tauri/src/ai.rs:283-285`), shown as a
CLI-error card. When the orphaned run finishes, its proposal appears only after the conversation
is reloaded. This conflicts with decision 55 (Stop) and decision 63 (while it runs, the controls
are disabled and the run is visible).

Fix: either stop the run when the editor closes (simplest; ask first if the AI is busy), or let
the panel honour `running`: disable the composer, show a status card with Stop that calls
`ai.stop`, and poll `conversations()` until it ends, then reload. Add an e2e case: close during a
run, reopen, Stop works.

### M4. Image apply and undo are business logic in the Tauri shell, untested, and can lose an image

`src-tauri/src/ai.rs:505-625` (`ai_apply`, `ai_undo_images`) decides which images a proposal
replaces, backs them up into `<run>/undo`, writes into the opdracht's image store, deletes on undo
and restores by stem match. `ai_send` (`ai.rs:303-349`) also reads other opdrachten and
`opdracht.json` with `std::fs`, outside `Storage`. CLAUDE.md says command handlers parse, call
core and map errors, with no business logic. None of this has a test (there is no `mod tests` in
`ai.rs`, and the e2e tests use the mock).

Concrete risks in that code:

- `ai_apply` starts with `remove_dir_all(&undo)` (`ai.rs:530`). A second apply of the same
  proposal (Voorstel bekijken after a card apply, or an apply that failed half-way and was retried)
  drops the backups of the first. `ai_undo_images` then deletes the image and has nothing to put
  back, so the teacher's original is gone.
- `workspace::prepare` removes the whole run folder, `undo/` included, at the start of every turn
  (`workspace.rs:284-285`). The UI drops `applied` on a new run (`panel.ts:629`), so this is safe
  today, but it depends on the UI.
- Undo failures are swallowed (`panel.ts:784`, `.catch(() => {})`) while the card turns back to
  "ready".

Fix: move the apply/undo into `maatwerk-core::ai` (say `ai::apply`) over `Storage`, with tests:
new image, replaced image with another extension, undo after replace, apply twice, then undo. Keep
the backup per apply and do not delete it on the next apply of the same proposal. Show an undo
failure instead of swallowing it.

## Minors

### m1. Syllabus name: Windows drive-relative names and non-PDF files pass

`src-tauri/src/ai.rs:303-309` rejects `/`, `\` and a leading `.`, then does
`syllabus_dir.join(name)`. On Windows a name like `C:geheim.pdf` has a prefix and no root, so
`Path::join` **replaces** the base and reads `geheim.pdf` from the process's current directory on
drive C. `workspace.rs:541-548` then copies that file into the workspace for the AI. Any
extension is accepted. The iframe is the only source, so this is defense in depth.

Fix: accept only a name that `ai_syllabus_list` would list: a single `Component::Normal`, a `.pdf`
extension, and present in `read_dir(syllabus_dir)`. Reject symlinks.

### m2. `check.cmd` breaks on non-ASCII paths

`workspace.rs:650-655` writes the batch file as UTF-8 with the program and workspace paths in
it. `cmd.exe` reads batch files in the console code page (OEM, 850 on Dutch Windows), so a
Windows user name such as `Zoë` or `René` (the workspace is under
`%LOCALAPPDATA%`) turns into mojibake and the check fails with "path not found". This hits every
CLI that uses `check.cmd` on Windows (all but Claude Code, which uses the sh script). Maatwerk's
own check after the turn still runs, so the proposal is right, but the CLI's fix loop is blind.

Fix: start the script with `chcp 65001 >nul`, or avoid the batch file (M1's absolute-path
invocation fixes this too). Add a workspace test with a non-ASCII temp dir name on Windows.

### m3. Toepassen can overwrite what the teacher typed during the round trip

`panel.ts:737-751` reads `before = host.buffers()`, awaits `ai.apply(...)` (an IPC round trip
through the main window), then `host.applyText(file, a.text)`. `aiApplyText`
(`editor-init.js`, the new hunk) turns the **current** document into `a.text`, which was computed
from `before`. Keystrokes typed during the await are reverted, inside one undo step. Decision 55
explicitly lets the teacher keep typing.

Fix: after the await, compare the current buffer with `before[file]`. If it differs, ask for the
proposal again, which re-runs the rebase, or apply the hunks on the client from the statuses
instead of replacing the whole text.

### m4. Images are written to the shared folder at Toepassen, before the text is saved

`ai_apply` stores the images in the opdracht right away (`ai.rs:551-558`). The text only goes
into the editor buffer. If the teacher then closes without saving, the opdracht keeps new or
replaced images that its text does not use. Decision 56 says "saving stays the normal flow". This
is not data loss, because the replaced image is backed up until the next apply, but it is
surprising. Fix: say so in the applied footer ("Afbeeldingen zijn al opgeslagen"), or keep the
images pending until the next save.

### m5. A placeholder image the AI touches overwrites the real one

With Afbeeldingen off, `images/` holds grey placeholders (`workspace.rs:367-372`). If the AI
re-saves or edits one, `diff::collect` (`diff.rs:272-284`) proposes it as a changed image
(`new: false`, "gewijzigd"). Toepassen, which takes all images by default (`panel.ts:732`), then
replaces the teacher's real photo with the AI's version of a grey box. The request asks the AI not
to do this (`workspace.rs:753-757`), but nothing enforces it.

Fix: mark proposals whose base was a placeholder (`baseline.placeholders`), leave them out of
"Toepassen" by default, and label them in Voorstel bekijken ("vervangt een afbeelding die de AI
niet heeft gezien").

### m6. A CLI that exits early leaves its grandchildren running

`run.rs:209-214`: when the child exits but a grandchild holds the pipes, the runner only starts
the grace timer and breaks after 6 s. Nothing is killed. The grandchild, for example a node worker,
keeps running and may still write into the workspace after `diff::collect`. Fix: call `kill_tree`
in that branch too. On Windows the tree walk needs the parent still alive, so a job object
(finding 5 names one) is the robust fix.

### m7. Stop and the time limit are not checked during workspace preparation or Maatwerk's checks

`run_turn` polls `stop` only while the CLI runs (`turn.rs:188-203`). `prepare` can spend up to
2 × 30 s on the diagnostics and the PDF chips (`workspace.rs:497-540`), and every fix round
spends up to 30 s on `check_workspace`. During that time Stop does nothing, and the elapsed time
can pass the limit without a time-out. Fix: check `stop` and the deadline before and after each
of those steps, and return `Stopped` or `TimedOut`.

### m8. The login check is wired up but never used

`ai_login_check` (`ai.rs:175-207`) and the protocol method `loginCheck` exist, but the panel never
calls them (`grep loginCheck ui/src/editor` finds only `client.ts`). ADR-0009 finding 6 plans a
login check before a run, and the not-logged-in card currently relies on parsing the output after
a failed run. Either call it before the first run of a conversation (Claude Code, Codex) or
remove it and update the ADR.

### m9. The opdracht metadata comes back from the iframe unchecked

The main window builds `metadata` (`editor-ai.ts:74-80`) and gives it to the iframe. The iframe
sends it back inside `request.context.metadata`, and `handleAiRequest` forwards the whole `send`
request (`editor-ai.ts:116-120`). `ai_send` then writes whatever JSON arrives into
`.maatwerk/context/opdracht.json` (`workspace.rs:488-495`). The privacy guarantee for this chip
therefore depends on the iframe. Fix: in `handleAiRequest`, replace `context.metadata` with
`aiEditorInfo(ctx).metadata` when the chip is on, and drop it otherwise.

### m10. Detection runs `--version` of every CLI on every call

`ai_detect` caches the search path but not the versions. It starts every found CLI with
`--version` (10 s limit each, in parallel) each time an editor opens, Opdracht toevoegen opens, a
batch fails, or the settings open (`detect.rs:209-237`). Node-based CLIs take a second or more, so
the AI card in Opdracht toevoegen and the rail appear late. Fix: cache the `Detected` list next to
the search path, and refresh it on "Opnieuw zoeken" and after a settings save.

### m11. File sizes

Over the ~500-line guideline: `ui/src/styles/editor-ai.css` (1442), `crates/maatwerk-core/src/ai/provider.rs`
(845; presets, keys, args and settings could be three files), `ui/src/editor/ai/panel.ts` (837),
`src-tauri/src/ai.rs` (804; shrinks with M4), `crates/maatwerk-core/src/ai/workspace.rs` (793; the
request text and the provider files could move out), `crates/maatwerk-core/src/ai/events.rs` (658,
one parser per CLI), `ui/src/editor/ai/composer.ts` (627).

### m12. Test gaps

- No test of the Tauri AI commands (see M4), and none of the syllabus name rule (m1).
- No privacy test of the workspace as a whole: build one from a fixture data folder with
  `leerlingen`/`toetsen` files present and assert that the workspace contains only the expected
  paths, and that no header value or student name appears in any file.
- `ui/e2e/ai-panel.spec.ts:146-167`: Stop is clicked after the input is disabled, with
  `stepDelayMs = 800`. If the mock's steps are few, a slow CI runner can finish the run before the
  click. Making the mock wait for `stop()` (or use a long delay) avoids the race.
- `crates/maatwerk-core/tests/ai_fake_cli.rs:216-232` leaves a 30 s grandchild running after the
  test. Harmless, but it shows m6.

## Nits

- n1. `src-tauri/src/state.rs:327-331`: picker tokens are sequential numbers and AI attachment
  tokens are never removed, so any earlier-picked file stays attachable by its number. Use random
  tokens and remove them after `ai_send`.
- n2. `ui/src/editor/ai/review.ts:299` shows `img.source`, the full path of the workspace file in
  local app data. The file name is enough.
- n3. `diff.rs:275-283`: two AI images that differ only in case (`Fig.png`, `fig.png`) clean to
  the same `images/fig.png` and show as two proposals for one path.
- n4. `run.rs:93` `RunHandle::stop_flag` is unused.
- n5. `detect.rs:79-82`: a relative `PATH` entry (`.`) is searched against the app's current
  directory. Skip non-absolute entries.
- n6. The backend does not enforce the first-use notice (`notice_seen`) in `ai_send`; only the
  panel does (`panel.ts:342-345`). That is fine for this UI, but a one-line guard would make
  decision 70 hold for every entry point.
- n7. Decision 53 says 10 attachments "per chat"; `MAX_ATTACHMENTS` is checked per message in the
  backend (`workspace.rs:323-327`). The composer counts per chat, so the UI is right; the backend
  comment should say per message.
- n8. `ai_apply` marks the conversation as applied even when no hunk or image was applied
  (`ai.rs:560-563`).

## Resolution (main session, 2026-11-19)

- **M1 fixed:** Gemini CLI, Mistral Vibe and Copilot CLI no longer run the check themselves
  (`runs_check: false`): Maatwerk runs it after the turn and feeds errors back (up to 3 rounds,
  as for Antigravity and own CLIs). Their shell tools are fully denied (Vibe `permission =
"never"`, Gemini policy without the check rule, Copilot `--allow-tool write`), and the check
  scripts are written only for CLIs that run them (Claude Code, whose edit rules exclude
  `.maatwerk/`; Codex, which cannot deny shell commands anyway, ADR-0009 finding 7). Confirmed
  with a real Vibe 3.0.4 run: no denied commands, check OK, turn 2 17 s instead of 76 s.
- **M2 fixed:** the "Laat AI dit oplossen" attachment has every header value of the failed
  opdracht's jobs (student, group, toets, observaties) replaced by `[…]`
  (`failures.ts` `forAi`, unit test); the card on the teacher's screen keeps the full text.
- **M3 fixed:** closing the editor stops the opdracht's run (`modals/editor.ts`); a reopened
  panel waits up to 10 s for a run that is still stopping. e2e "closing the editor stops its AI
  run".
- **M4 fixed:** image apply and undo moved to `maatwerk_core::ai::apply` with tests; the first
  backup of a name is kept (apply twice, then undo restores the teacher's image); an undo uses
  its backups up; a failed image undo shows an error card instead of being swallowed.
- **m1 fixed:** a syllabus name must be a plain `.pdf` name without `:`.
- **m2 fixed:** `check.cmd` switches to code page 65001 first.
- **Backlog (not fixed in this step):** m3-m12 and the nits (`docs/backlog.md` "From Step 32").
