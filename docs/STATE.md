# State

Last updated: 2026-11-19 (step 32 done) Branch: `step/32-ai` (from `main` at `941eb5c`)
Last tags: `step-31`, `step-30`, `v0.19.0` (merge `a32e7fc`), `step-28` (`5a832ca`), `step-27`
(`33188e8`), `step-26` (`d8c741c`), `v0.16.0`, `step-25`

## Hotfix 0.19.1 (2026-11-19, on `step/32-ai`, user's call)

Print button on the Opdrachten tab (between Kopiëren and Verwijderen): one copy of the opdracht
without the student block, in the PDF viewer (`modals/opdracht-print.ts`). Decisions with the
user: `maatwerk-main 3` adds `mode: "plain"` (data-format change OK'd; unchanged v2 copies update
silently, also right before a plain print; a teacher-changed old copy gets a warning naming
"Herstel standaardversie"); a "Met antwoorden" checkbox in the dialog header (default off);
"Openen in PDF-viewer" opens the rendered output, no copy in `rapporten/`; version 0.19.1 on this
branch, no separate release branch. Migration goldens: the four `main.typ` copies follow the
template. Open: the tracked CI baselines of `screen-opdrachten` (3 platforms) are stale (the new
button); drop or regenerate them with the user's OK, as for step 32's views. Manual check: print
one opdracht in the real app, with and without answers.

## Current step

**Step 32 (AI assistant, L+, 32a-32c):** decisions taken with the user 2026-11-18 (`PLAN-2.md`
decisions 48-61, ADR-0009 "Amendment (step 32)"); the step section is rewritten as a design round
plus CLI research, then 32a bridge, 32b editor UI, 32c settings/entry points/gate. No code yet.

**Design round done (user OK 2026-11-18):** design round 15, boards 59-63 (mocks `AIChat`,
`AIContext`, `AIDiff`, `AIInstellingen`, `AIStart`), `PLAN-2.md` decisions 62-75 with the answers to its three questions (school switch in `instellingen.json`, syllabus folder fixed next to the app, CLI details from the research), spec 4.8.1 and 4.9 (the school switch is on Beheer › Instellingen).

**CLI research done (2026-11-18):** ADR-0009 "CLI research": a table per CLI (non-interactive,
streaming, resume, permissions, web search, images, detection, not logged in, install, default
args) with sources. Installed here: Claude Code 2.1.327, Mistral Vibe 3.0.4 (Codex, Gemini,
Copilot not installed; nothing logged in, no prompt sent). Answer 3 settled: presets and install
commands from the ADR replace board 62's. Vibe and Copilot qualify (decision 49). Notable: Gemini
CLI was replaced by Antigravity CLI for free/Google One users (2026-06-18), Antigravity not in the
launch set (user's call); prompts go via `.maatwerk/request.md`, not argv (`.cmd` shims); macOS/
Linux detection must read the login shell PATH; Gemini needs a stable temp dir path per
conversation. _verify_ rows go into the 32c manual check.

**After the report (user 2026-11-18):** decision 76 adds Antigravity CLI (researched, ADR table;
check on Maatwerk's side because it has no per-run permission rules), decision 77 adds "Eigen
CLI" (teacher-defined command and arguments, plain-text output; board 62 gets its card in 32c).
ADR finding 2 now spells out the macOS/Linux PATH handling (login-shell PATH, default folders,
also passed to the child).

**Next action:** step 32 is done (gate, review, fixes); waiting for the user: visual check of the 12 diffs, M-AI manual checks, merge. Releases 0.20-0.23 wait for the user.

## Step 32c progress (settings, switches, entry points, gate)

Plan: (1) school switch: `ai.enabled` in `instellingen.json` (core reader, `ai_detect` and
`ai_send` honour it, validate-data, mock), "AI-assistent" card on Beheer › Instellingen;
(2) AI-instellingen dialog in the main window (show switch, CLI cards, Eigen CLI, time limit,
syllabus folder, install help), from the editor gear and the user menu ("Uitgeschakeld door je
school"); (3) first-use notice (decision 70) and the "?" install help panel in the editor;
(4) Opdracht toevoegen "met AI" (board 63); (5) "Laat AI dit oplossen" after a failed
Opdrachten genereren; (6) provider logos (brand rules); (7) real-CLI manual check (Claude Code,
Vibe are installed here); (8) gate, review, report.

Baseline 2026-11-19 on `7a223b9`: cargo test all ok (the doctest run raced an edit; rerun ok).

1. **Done (`8980ec6`):** school switch `ai.enabled` (`maatwerk_core::ai::school`, `ai_detect`
   reports `school`, `ai_send` refuses, mock, no rail), Beheer › Instellingen "AI-assistent"
   card, `components/switch.ts`, data-files-v3 section. No `minAppVersion` raise and no
   validate-data check (no older app has an AI; instellingen fields were never validated).
2. and 3. **Done (`552a1b2`):** `modals/ai-settings/` (model tested; dialog per board 62: show
   switch, CLI accordion cards with Opdracht/Argumenten/Vervolgbericht, Standaard herstellen,
   Eigen CLI cards, Installatiehulp, Opnieuw zoeken, time limit, syllabus folder read-only),
   `modals/ai-notice.ts` (decision 70, before the first conversation; Escape = no chat),
   `editor/ai/install.ts` + `styles/ai-install.css` (install help shared with the editor), the
   editor's "?" panel (board 62: Opnieuw zoeken, AI-assistent verbergen), the gear and the
   time-out card's button, user menu "AI-instellingen…" ("Uitgeschakeld door je school",
   aria-disabled). Protocol methods `openSettings`, `notice`, `hideAssistant`.
3. and 5. **Done (`3952ef2`):** editor start request (`AiStart` in `info`, `openEditor(o,
start)`, `Composer.prefill`, `AiPanel.begin`). Opdracht toevoegen "met AI"
   (`modals/opdracht-ai.ts`, board 63, sent at once). A failed Opdrachten genereren shows one
   card per opdracht (`opdrachten-genereren/failures.ts` parses T23's text against the jobs;
   student count only) with "Laat AI dit oplossen" (filled, error attached as `Foutmelding
genereren.txt`, not sent), "Openen in editor", "Melding kopiëren". Mock `batchFailures`.
   e2e `ai-settings.spec.ts` (9). 783 Vitest, Chromium e2e 385/385.

4. **Logos (user 2026-11-19): monograms stay.** OpenAI, Anthropic, Google need written
   permission, GitHub Brand Studio approval; noted in `THIRD_PARTY_LICENSES.md` (`703f716`).
5. **Real-CLI check (user OK to use the accounts, 2026-11-19):** `tests/ai_real_cli.rs`
   (opt-in), manual checks M-AI-1..12 (`559644d`). Claude Code 2.1.328: proposal + resume +
   check OK; fix `d82e08e` (request tells Claude Code to run the check with Bash; it tried a
   denied PowerShell call first on Windows). Vibe 3.0.4 is not logged in here: its
   not-logged-in text verified (ADR-0009 "Real-CLI check"); a logged-in Vibe run is M-AI-6.
6. **Gate (2026-11-19):** cargo fmt, clippy, test, deny, SPDX, npm licences green; notices
   regenerated (`4afc8b8`); 783 Vitest; Chromium e2e 385/385. Visual: 12 diffs in 4 views × 3
   looks, all intended: `editor` (the AI rail of 32b; the baseline predates it),
   `admin-instellingen` (AI-assistent card), `user-menu-teacher`, `user-menu-admin`
   ("AI-instellingen…"). Baselines not updated (user's check first).
7. **Review** `docs/reviews/step-32.md`: 0 blockers, 4 majors (all fixed), 12 minors (m1, m2
   fixed; m3-m12 in `docs/backlog.md` "From Step 32"), 8 nits. M1: Gemini, Vibe, Copilot no
   longer run the check (shell denied, Maatwerk checks; `maatwerk_core::ai::apply` etc.); M2:
   header values scrubbed from the "Laat AI dit oplossen" attachment; M3: closing the editor
   stops its run; M4: image apply/undo in core with tests, first backup kept. Vibe (user logged
   in 2026-11-19): real turns OK before and after M1 (17 s instead of 76 s for turn 2). Gate
   rerun green: fmt, clippy, cargo test, 784 Vitest, Chromium e2e 386/386.

**32c done; step 32 done except the user's part:** visual check of the 12 diffs (then
baselines, CI), manual checks M-AI-1..12, merge and tags, releases 0.20-0.23.

Chrome extension was not connected this session: the visual checks used Playwright
screenshots (`AI_SHOTS=<dir>` on `ai-settings.spec.ts` and `ai-panel.spec.ts`).

## Step 32b progress (editor UI)

Baseline 2026-11-18 on `fd327f1`: cargo test all ok.

Plan: (1) iframe <-> main window AI protocol, (2) pure UI helpers (chips, attachments, status,
diff summary), (3) rail + panel + conversation + starters (board 59), (4) composer: chips,
syllabus listbox, Andere opdrachten popover, attachments (board 60), (5) running: status line,
transcript, Stop, editor bar, pill, error cards, (6) diff card, Toepassen as one undo step,
Ongedaan maken, (7) Voorstel bekijken dialog with PDF preview (board 61).

1. **Done (`1b65eda`):** `editor/ai-protocol.ts` (`maatwerk-ai` requests with a method
   allowlist, events as `maatwerk-ai-event` per run id), `modals/editor-ai.ts` (main window adds
   teacher and opdracht, `info` = opdrachtgegevens + other opdrachten, `preview` via
   `renderAssignmentSvg`), `editor/ai/client.ts` (iframe client). New command
   `ai_pick_attachments` + `ai.pickAttachments()`.

2. **Done (`4968beb`):** `editor/ai/model.ts` (pure, tested): chips and what is remembered,
   syllabus preselection, attachment limits, transcript from events, status/summary/diff texts,
   starters, `applyHunks` (the dialog's preview).
3. **Done (`a80295a`, sub-tasks 3-7 in one commit):** `editor/ai/panel.ts` (rail, panel,
   conversation, run flow, apply/undo), `composer.ts` (chips, syllabus listbox, Andere
   opdrachten, attachments: paperclip/drop/paste), `cards.ts` (status card, transcript, summary
   row, end-state cards, diff card), `review.ts` (Voorstel bekijken), `dom.ts`,
   `styles/editor-ai.css`; wired in `editor-init.js` (`initAi`: buffers, minimal-diff apply as
   one undo step, copy bar, `setAiBusy` pill). `no-file-drop` lets `[data-file-drop]` take
   drops. e2e `ai-panel.spec.ts` (4 tests); editor/CSP/quirks e2e still pass (97).

**32b done.** Checks: lint, typecheck, 763 Vitest, cargo clippy/fmt, bindings test.
Known gaps (for 32c or later, tell the user):

- Gear (AI-instellingen) and the timed-out card's "AI-instellingen" button only appear once
  32c passes `openSettings`; the "?" button shows a short text, not board 63's install help.
- First-use notice (decision 70) and the school/teacher switches are 32c.
- Voorstel bekijken's preview renders `opdracht.typ` only: new images from the proposal are
  not in it until applied (the note says so), and new parts are not outlined (board 61).
- Skipped `main.typ`/`lib.typ` are listed struck through without "Toon voorstel" (the
  proposal does not carry their text).
- Ongedaan maken refuses after the teacher typed since Toepassen (points to Ctrl+Z).
- `editor-init.js` (~2.050 lines, JS) is not converted or split (R-05); the AI code is new TS
  modules next to it.
- Real-CLI manual check not done (32c).

## Step 32a progress (bridge, no UI)

Baseline 2026-11-18 on `64d5b54`: cargo test all ok.

1. **Done (`f9e4411`):** `maatwerk_core::ai`: `provider` (six presets per ADR-0009, custom
   CLIs, per-teacher `AiSettings` in local app data, `split_args`, placeholders `{prompt}`
   `{request}` `{workdir}` `{session}` `{check}` `{images}` `{run}` `{secs}`; two argument
   strings per CLI: first message and later messages), `detect` (PATH + login-shell PATH +
   installer folders, `--version`), `events` (per-format parsers into `AiEvent`, `Collected`
   with session, answer, error, auth failure), `run` (thread runner, time limit, Stop, tree
   kill via `taskkill /T` or process group). Fake CLI `src/bin/maatwerk-fake-ai.rs`, tests in
   `tests/ai_fake_cli.rs`.
2. **Done (`88ed2b7`):** bundled check: `maatwerk --ai-check <dir>` (app `main.rs`,
   `ai::check`), JSON report, exit 0/1/2/3, editor time limit; `assignment::with_time_limit`;
   `maatwerk-cli assignment check|render --timeout` (default 30 s, exit 3) closes Step 9 m3.
3. **Done (`601a94d`):** `ai::workspace`: `Layout` (`<local app data>/ai/<gebruiker>/`:
   `settings.json`, `opdrachten/<id>/<provider>.json` history, `context.json` chips,
   `work/<id>/<provider>/` workspace with a stable path, `<provider>.run/` per turn), `prepare`
   (buffers or saved files, grey same-size placeholder images unless the Afbeeldingen chip,
   context per chip, attachments with limits, `.maatwerk/check` + `check.cmd`, Vibe
   `.vibe/config.toml`, Gemini policy, `request.md` in English with the Dutch-answer rule),
   `Baseline` for the diff.
4. **Done (`6feea68`):** `ai::history` (conversation per provider per opdracht, transcript per
   run), `ai::diff` (proposal restricted to `opdracht.typ` + `images/`, `main.typ`/`lib.typ`
   skipped, hunks via `similar`, `rebase` onto the current buffer with conflicts, `apply` of
   selected hunks), `ai::turn` (`run_turn`: prepare, run with resume, Maatwerk-side check with
   up to 3 fix rounds for CLIs that cannot run it, outcomes Proposal/NoChanges/NotLoggedIn/
   CliError/TimedOut/Stopped/NotFound, nothing kept on stop/time-out/failure, history saved,
   `proposal.json` in the run folder). Tests `tests/ai_turn.rs`. New crates `similar`
   (Apache-2.0) and `uuid` in `THIRD_PARTY_LICENSES.md`; `npm run notices` still to run at the
   gate.
5. **Done (`78904ed`):** app `src-tauri/src/ai.rs` (17 `ai_*` commands: detect, settings, login
   check, send with events over a `Channel` and one run per opdracht, stop, conversations,
   new conversation, proposal with rebased statuses, apply with image backups and undo,
   proposal image, context chips without Afbeeldingen, syllabus list and folder (`syllabus/`
   next to the exe on Windows, local app data elsewhere), presets). JSON payloads typed in
   `ui/src/bridge/ai-api.ts` (`window.maatwerk.ai`), Tauri impl in `tauri-api.ts`, scripted
   `mock/mock-ai.ts` with a test. Checks: clippy, cargo test (25 suites), typecheck, lint, 733
   Vitest.

**32a done.** Left for 32c: the real-CLI manual check (ADR-0009 _verify_ rows), the entry
points, settings dialog and school switch.

## Previous step (30-31)

**Steps 30 and 31 in one go (user, 2026-11-17):** step 30 (Observaties and opdrachten, 0.21) on
`step/30-observaties`, then step 31 (Opdrachten-editor, 0.22) on `step/31-editor`; one gate and
one review at the end of step 31.

Baseline 2026-11-17 on `e89ad1d`: cargo test all ok, `npm test` ok.

## Step 30 progress

1. **Done (`eac10c3`):** T23: the batch goes on after a failure, skips the failed opdracht's
   other jobs (counted in the progress) and reports every failed opdracht once
   (`BatchError::Failed`, `BatchJob.opdracht`).
2. **Done (`0462e91`):** F-14: question cards in Opdrachten genereren (`opdrachtenVraag`);
   domain `vraagScoreMatches`, `opdrachtVraagCards`, `vraagCardReason`; R-05: the modal in TS
   (`modals/opdrachten-genereren/`). e2e `rapport.spec` +1.
3. **Done (`a122f3d`):** Observatie bewerken (spec 4.12, board 15) with the icon picker (F-15:
   224 emoji, `domain/obs-icons.ts`, Dutch search words) and Opdracht bewerken (emoji chips,
   "Inhoud bewerken in de editor"); `modals/observatie-edit.ts`, `modals/opdracht-edit.ts`,
   shared `modals/obs-opd-fields.ts`, `styles/obs-opd.css`. e2e `obs-opd.spec` (4). Visual:
   `modal-observatie-new`, `modal-opdracht-edit`, `modal-opdrachten-genereren` differ (× 3
   looks), expected; baselines wait for the user's check.
4. Step 30 complete except the gate (shared with step 31). Version not bumped: 0.20 (step 29)
   is not released yet either ("release when the user asks").

## Step 31 progress (Opdrachten-editor, 0.22; branch `step/31-editor` from step 30)

1. **Done (`56dfb56`):** spec 4.8, board 10: header (V-07: "Terug naar opdrachten", title,
   subtitle `domain/editor-header.ts`), status pill (F-05, `editor/status.ts`), toolbar on top of
   the editor pane with Wiskunde/Symbolen/Opmaak menus and block swatches, file tabs below it,
   divider (F-16, `editor/divider.ts`, saved as `preferences.editorSplit`), smooth preview
   sync (V-03), U10 (typed proxy `modals/editor.ts`, `editor/protocol.ts`; files not paths).
   e2e `editor-shell.spec` (5); mock `MockEditor.compileDelayMs`. Visual: `editor` (× 3
   looks) differs, expected.
2. **Gate (2026-11-17):** cargo fmt, clippy, test, deny, SPDX, npm licences green; 725 Vitest;
   Chromium e2e 369/369. Visual: `editor`, `modal-observatie-new`, `modal-opdracht-edit`,
   `modal-opdrachten-genereren` differ (× 3 looks), all intended; baselines not updated.
3. **Review** `docs/reviews/step-30-31.md`: 0 blockers, 1 major (M1, fixed), 8 minors (m1, m2
   fixed, m6 partly; the rest in the review's backlog list), 12 nits.

**Emoji font in the window (user 2026-11-17, branch `fix/ui-emoji-font` on `step/31-editor`):** the
window draws emoji with the embedded Noto Color Emoji, the one copy in the binary served by the
`maatwerk-out` scheme (`EMOJI_FONT_PATH`), registered by `utils/emoji-font.ts` for emoji code
points only and only where the webview draws COLRv1 (WebView2); macOS keeps Apple's emoji. The
mock build copies the font (`ui/vite/emoji-font.ts`). The picker stays at Emoji 12.0 (user: it
must work on macOS 12). Checks: clippy, cargo scheme tests, 726 Vitest, Chromium e2e 371/371.
Visual: 69 diffs in 23 views (the step 30/31 views plus every view with an emoji), all emoji
glyphs or the intended step 30/31 changes.

**Visual baselines and merge (user approved the diffs 2026-11-17):** local `visual` baselines
updated (177/177). CI baselines of 23 views dropped (`e296fcb` and before) and pushed on
`step/31-editor` (which now includes `fix/ui-emoji-font`). The first run found a WebKit bug: the
editor dropped every answer (U10 checked `event.source`); fixed by an origin check (`e296fcb`).
Run 44158096575: Windows and Linux wrote their 23 files (no real diffs), checked and committed
(`5cd76c1`). macOS: no hosted runner on 2026-11-17. 2026-11-18 rerun: macOS WebKit failed
`emoji-font.spec.ts` (no COLRv1 there, so no font registered, as designed; the test now follows
`CSS.supports`, `baf706b`) and skipped the visual step. Run 44265647594 wrote the 23 macOS
files (checked, committed). **Run 44273623560: green on all targets.**

**Merged (2026-11-18, user OK):** `step/30-observaties` and `step/31-editor` into `main` (merge
commits), tags `step-30`, `step-31`, pushed.

**Next action:** releases 0.20-0.22 when the user asks. Then step 32.

**Choices made without asking (step 31):** "Opmaak ▾" holds the formula formatting (Formaat,
Lettertypevarianten, Tekstoperator), "Wiskunde ▾" the structures (Breuk, Wortel, …), "Symbolen ▾"
the four symbol panels (a panel opens under the Symbolen button); the ⋯ text options stay; the
spinner appears only after 200 ms (no flicker); "Opgeslagen" and an empty message both show
"Opgeslagen · PDF bijgewerkt"; while a render error shows, typing keeps it (not "Niet
opgeslagen…") until the next good compile; the divider saves 0,5 s after the last key press;
Home/End jump to 25%/75%; the editor stays in the light look (it has no theme yet, as before).

**Not done in step 31 (for the report):** R-05 for `editor-init.js` (1950 lines, JS): the new
parts are TS modules (`editor/`), the rest stays for step 35 ("the remaining R-05 files"). The AI
rail is step 32. T19/T20 kept (ROADMAP 4.6).

**Not done in step 30 (for the report):** R-05 for `screens/observaties.js` and
`screens/opdrachten.js`: only their modals moved to TS; the lists become cards in step 34, which
converts them (PLAN-2 step 34). T19/T20 stay (ROADMAP 4.6: keep).

**Choices made without asking (for the report):** a vraag card's default is the first question,
below half its points rounded up (at least 1); the limit may be fractional (two decimals); the
reason icon is 🔢; a PO has no question cards (no questions); a score kept as typed that is not
a number never matches. T23: the failed opdracht's other jobs are skipped (they would fail the
same way); several failures are separated by a line under "N opdrachten bevatten een fout.".
F-15: icons only up to Emoji 12.0 and no ZWJ sequences (the window uses the system emoji font,
Windows 10 too); an observatie whose icon is not in the list shows it in a "Huidig" group;
category filters are pressed buttons, not tabs; Vakken keeps the eight vak codes (wiskunde
variants), so it gets its own row. Opdracht bewerken: "Inhoud bewerken in de editor" saves
first (a new opdracht needs its folder), a missing field keeps the modal open; observaties
hidden by the chosen fields are dropped on save (as before).

## Step 29 (done)

**Step 29 (Overviews and profile, 0.20):** 29a and 29b done (user OK on the visual check and the
numbers table, 2026-11-15); 29c (PO overview, profile) on `step/29-overviews`, then the step-29
gate, review and release 0.20.

Still open from steps 26-28 (merged, PR #17): the GitHub release 0.19.0 (`docs/release.md`
section 4) when the user asks.

Baseline 2026-11-14 on `455fc90`: cargo test all ok, 629 Vitest.

## Step 29 progress

1. **Done (`7f5cb2c`):** shared overview parts in `ui/src/overview/` (spec 3.10): histogram
   (core bins, counts, 5,5 line, Stapgrootte toggle), boxplot with dots, RTTI-verloop (labels
   14 px apart), RTTI card, observatie bars, grade tooltip, resit dot, section rows with mean and
   SD; `styles/overview.css`; style data `data-left`/`data-top`; `--foot` token. Tested.
2. **Done (`7606a13`):** RTTI names (`domain/rtti-names.ts`, decision 33): "Toepassen 1/2" in
   the RTTI uitleg placeholders replaced; names as tooltips on the RTTI buttons.
3. **Done (`b7ba18f`):** group overview (spec 4.5, board 45) in TS:
   `modals/group-overview/` (model, resultaten, charts, observaties, index); R-05
   `groep-leerlingen.js` removed. e2e `overviews.spec.ts` (4); `cards.spec` and `quirks.spec`
   U8 follow the new header gap and the dot title.
4. **Done (`40ffc6d`, tag `step-29a`):** numbers table `docs/phase-2/step-29-numbers.md`
   sections 1-3 (**STOP: the user's OK before the merge**). Gate run: 669 Vitest, Chromium e2e
   331/331.
5. **Done (`1a3ab76`):** exam overview (spec 4.6, board 46) in TS: `modals/exam-overview/`
   (data = the old loader typed, resultaten, charts, rtti-obs, index); R-05
   `toets-overzicht.js` removed (no Chart.js there any more). e2e `overviews.spec.ts` +4.
   Numbers: section 4 of the numbers doc (`eb243f9`). B-05 checked: the verzameloverzicht reads
   the observaties of the attempt that counts (`toetsen.spec` B-05 tests green).
6. Checks on `eb243f9`: 676 Vitest, Chromium e2e 334/335 (G53 in `score-grid.spec` failed once
   under load, 3/3 alone; not touched), lint, typecheck, SPDX green. Visual baselines not
   updated (the user's check first).
7. **User OK (2026-11-15):** visual check and numbers table of 29a/29b.
8. **Done (`de6bf8e`):** PO overview (spec 4.14, board 43): `modals/po-overview/` (model,
   resultaten, charts, index); "Overzicht openen" and the title on a PO card open it (each attempt
   its own; the PO verzamelkaart's button stays disabled: backlog). e2e `overviews.spec` +2.
9. **Done (`ca1dc5c`):** profile (spec 4.15, board 44) in TS: `modals/profile/` (data,
   cijferverloop, analyse, index); R-05 `profiel.js` removed. B15/B16 checked, kept
   (`quirks.md`). e2e `overviews.spec` +2; views `modal-po-overzicht-*` (6) added.
10. **Done (`d5b526d`):** Chart.js and its annotation plugin removed (no canvas chart left);
    licences and notices updated.
11. Numbers doc sections 5 (PO overview) and 6 (profile). Checks: 695 Vitest, lint, typecheck;
    Chromium e2e overviews/dialog/cards/po 100% green.

12. **Gate (2026-11-15):** cargo fmt, clippy, test, deny, SPDX green; 696 Vitest; Chromium e2e
    356/357 (topbar narrow test raced a resize: now polled, `f3486a4`, 32/32). Visual: 51 diffs,
    all expected (8 approved 29a/29b views, 6 new PO overview views, 2 profile views,
    `screen-toetsen-po` with the enabled button; × 3 looks). Review `docs/reviews/step-29.md`: 0
    blockers, 0 majors; m2, m3 fixed (`d65c7c0`), the rest in the backlog.

13. **User (2026-11-15):** numbers OK (sections 5-6); m1: count only students with a score.
    Visual feedback on 29a-c, done: RTTI per cijfergroep back (exam overview, layout of the
    observaties per cijfergroep, 2×2 cards); group Observaties drop the percentages when the table
    does not fit, then scroll sideways; a grade with observaties gets a triangle in the pill's
    corner instead of the dotted line; RTTI-verloop has room left and right; the profile's
    comparison text without the SD and with space before the difference; the PO table has no
    category columns (scores in the tooltips of Punten, Bonus / malus and Cijfer, also in the
    profile's PO bar tooltip); an overwritten grade in the exam overview is a blue pill with a
    thicker border, blue text and the triangle; the resit dot is centred on the pill.
    Second round (same day): the exam overview's and PO overview's tables are as wide as their
    contents (not the window), more room after the name, between Cijfer and the observaties and
    between the observaties and R; RTTI per cijfergroep as four cards on one line (two below
    900 px). The group Observaties' compact view keeps the PO's (the earlier shots used the
    seed without a PO). Third round: the observatie triangle sits inside the pill's square
    corner (flush, no overhang; 9px with the border after the fourth round); more column
    padding (10px) in both tables; fourth round: the name column at least 360px (as the group
    overview's); in a narrower pane `overview/fit-name.ts` gives it the room left beside the
    other columns (never below the names), so the table fills the pane (e2e test at 1280/800;
    the exam table at 900, Linux WebKit's fonts need it).

14. **User (2026-11-15): baselines and merge.** Local `visual` baselines updated (13 views × 3
    looks, all intended: overviews, profile, RTTI names F-26). CI baselines of those views
    dropped and rewritten by CI (runs 43738672588: Windows, macOS; 43740662685: Linux), 17
    files per platform (with the four new PO overview views), reviewed and committed. Merged
    into `main`, tagged `step-29`.

**Design rounds 12-14 (2026-11-17, branch `design/toetsen-cards`):** Toetsen as cards, decisions
41-45 in `PLAN-2.md`, spec 4.7 rewritten, mocks of boards 47-56 (final: 55, 56); new step 33
(Toetsen as cards) and step 34 (Observaties and Opdrachten as cards, design pending, boards
57-58); hardening and 1.0 move to step 35. ROADMAP F-27, F-28. Round 14 (same branch):
Observaties and Opdrachten as cards with the preview panel, decisions 46-47, spec 4.16 and 4.17,
mocks of boards 57-58; step 34 written out (34a, 34b).

**Next action (then):** release 0.20 when the user asks; `design/toetsen-cards` is merged through step 30; step 30 done (see above).

**Choices made without asking (for the report):** SE column when the group is upper school
(jaarlaag 4-6, as the cards) or any column test is PTA; the resit dot's tooltip says "<Inhaal |
Herkansing | own word> (poging N)" and the cell tooltip adds ", origineel X,X"; RTTI per test in
the group overview pools the attempts that count; the Observaties rows are the observaties linked
to a column (a PO: the rubric's too) or given in one; tests without a periode go under "GEEN
PERIODE"; the tooltip is fixed on the modal backdrop (it may leave the dialog box). 29b: the
exam overview's names open the profile (board 46 shows them as links); the per-group charts keep
one group per student (`studentGroup`) while the Resultaten sections are the exam's groups (as
before); the "Observaties, alle leerlingen" percentage is of the students with a score; the
RTTI-verloop has the originals of the jaarlaag only (no resits, no PO's); the chart "RTTI per
cijfergroep" is gone (not on board 46); a resit's overview highlights its original in the
verloop; group colours are accent shades (board 46) instead of the old 8-colour palette. 29c:
the PO overview's klas is the first matching class (as the PO score table), so a student in two
classes is in one section; category means are over the students with a score in
that category; observaties rows are the linked and the given ones; a cell's dotted underline only
when it has observaties; the profile's "Ten opzichte van het toetsgemiddelde" lists every graded
attempt of the year (as the old chart), the bars only the attempts that count; the year rows add
an "Examendossier (SE)" row (the old chart's SE bar); the profile header shows "<id> · jaarlaag N ·
schoolsoort · vak"; Chart.js removed.

## Step 28 progress (Beheer screens, 0.19)

1. **Done (`c4d838d`):** Gebruikers (52 px avatars, amber pill, action order, sectievoorzitters
   card) and Gebruiker bewerken (`modals/gebruiker-edit.ts`: 12 swatches as a radio group, the
   crop of step 26, D28); School (logo panel, watermark text and buttons; D29); Gegevenscontrole
   (`issueCards`, clean card, "Map openen" via `openPath`); Instellingen (unit fields, Opslaan top
   right, `snapshotKinds`, "Map openen"); F-02 (`utils/csv-example.ts` in the three CSV imports).
   R-05: `gebruikers.js` -> TS. e2e `beheer.spec.ts` (5), two in `photo.spec.ts`; views
   `admin-gegevens` (fixed clock), `admin-instellingen`.
2. **Done:** version 0.19.0; D28 and D29 closed in `quirks.md`; manual checks M-CARD-1..2 and
   M-BEH-1..4.

**Not done (for the report):** X-06 (`rapporten/` retention) has no decision, so it is not in this
step. "Vergelijken" (a OneDrive conflict copy) and "Toets openen" (a broken reference) of board 12
have no feature behind them yet; those findings get "Map openen". R-05 for `screens/school.js`
(touched for the logo panel, the watermark and D29) is left as JS.

**Choices made without asking (for the report):** a user colour that is none of the 12 swatches
stays as an extra first swatch "Huidige kleur"; the new-user default colour is the first swatch
(blauw, was `#4a90d9`); the sectievoorzitter rows follow the login order (nat, bio, schk, wi);
the snapshot kinds are computed in the UI with the core's keep rule (display only); the check
time says "vandaag om HH:MM" (it is always today: the check runs when the screen opens).

## Step 27 progress (Leerlingen and Groepen cards, 0.18)

1. **Done (`b406765`):** `domain/cards.ts` (card numbers from the core's `yearAverage`,
   `seAverage`, `trend`, `statsOfAverages`; tested), `screens/cards/card-html.ts` (markup, trend
   arrow; tested), `screens/cards/student-grades.ts` (fills the grades after the cards, batched,
   swaps in sync via `startTime = 0`), `screens/leerlingen.ts` and `screens/groepen.ts` (R-05,
   from JS), `styles/cards.css`. V-02: separators in the group overview header (quirk U18
   closed). e2e `cards.spec.ts` (4). Before/after on the fixture:
   `docs/phase-2/step-27-card-numbers.md` (**STOP: the user's OK before the merge**).
2. **Done:** version 0.18.0.

**Choices made without asking (for the report):** a bar per test is its best attempt, in
volgnummer order, a diagnostic test as a grey bar; "Nog geen cijfers" when there is no counted
grade (also when only a diagnostic test has one); the onvoldoende line of an upper-school group
counts the year averages (board 1 variant B); a group without a docent says "Geen docent";
the admin also gets group cards with numbers (spec 4.9: only the students are a plain list); the
student card shows the number, not the gender any more; cards are 66 px high (fixed, so the grades
filling in later never move the list); the swap runs on all cards from time 0 (in sync).

## Step 26 progress (Login and splash, 0.17)

Baseline 2026-11-13 on `95ac545`: cargo test all ok, 567 Vitest, 127 node.

1. **Done (`aff852f`):** splash (F-06, spec 4.1): inline SVG in `index.html`, CSS in
   `styles/splash.css` (part of the stylesheet in `<head>`, CSP stays strict), status line,
   version via a Vite `transformIndexHtml`, `shell/splash.ts` removes it once the first screen is
   there; window `backgroundColor` in `tauri.conf.json`. Login (V-04, spec 4.2):
   `screens/login/login.ts` (stages start/vak/user, FLIP flight with the Web Animations API and its
   reverse, stagger, keyboard, reduced motion = fades), `screens/login/pin-panel.ts` (inline PIN,
   one or two fields, 168 px reserved), `domain/login.ts` (tiles, groups; tested). `pin.ts` keeps
   only the dialogs (recovery, codes, change, renew); the recovery button is `#pin-recover-ok`.
   R-05: `startup.js` removed. e2e `login.spec.ts` (6) and `chooseVak` helper; visual views
   `splash`, `login-start`, `login-pin`.
2. **Done (`c5acc2e`):** F-19: `components/photo-crop.ts` (board 12 field, shared with step 28),
   `domain/crop.ts` (tested), `modals/foto-wijzigen.ts`, `Store.saveOwnPhoto` (merge, no rev);
   "Foto wijzigen" in the user menu enabled; e2e `photo.spec.ts` (3); view `modal-foto-wijzigen`.
3. **Done:** version 0.17.0; manual checks M-LOG-1..4 in `docs/manual-test.md`.

**Choices made without asking (for the report):** the role line says "Beheerder" (board 5 says
"Administrator"; spec 4.9 and the user menu say Beheerder); a vak tile is disabled only when it
has no teachers while another vak has some (a fresh install keeps every tile, so the admin gets
in); the remembered vak opens already chosen without animation; clicking a chosen tile goes back
(spec), so the e2e helpers choose a vak only when it is not chosen; the splash fades out in
0.25 s; the photo is saved as a square JPEG of at most 512 px named `<user id>.jpg` (an old
`.png` stays as an unused file); `--brand` (light ink in the dark theme) is the accent on the
login screen; splash and login use the light look before login as before (dev menu aside).

**Step 25 done and merged (2026-11-12):** user OK on the visual check (after the observatie
count fix `b958b00`); PR #16 merged into `main` (`d066a6d`), PR CI `43225418533` green on all
three OSes. CI baselines of `modal-scores`: macOS and Linux from run `43217796315`, Windows from
`43220392381`. Local visual baselines updated. Tags `step-25` (`0e76028`), `v0.16.0` (merge
commit, as `docs/release.md`), pushed.

**Release 0.16.0:** GitHub release "Maatwerk 0.16.0" (tag `v0.16.0`) with Dutch notes covering
everything since 0.3.2 (user). Published 2026-11-13.

**Release files (2026-11-12):** tag CI run `43233388996`: Windows and Linux green, macOS got no
runner (rerun started; the user: leave it for now). Attached to the draft after checking
checksums: `maatwerk.exe` (SHA-256 `7fc476df…2159`, in the notes), `maatwerk.exe.sha256`,
`LICENSE`, `THIRD_PARTY_NOTICES.txt`, the AppImage, the `.deb` and `SHA256SUMS-linux.txt`
(renamed: macOS has its own `SHA256SUMS.txt`).

**macOS files (2026-11-13):** the tag run's macOS job stayed cancelled; per the user, taken from
the green `main` run `43240489678` (`fe88ea0`, differs from the tag only in STATE/PLAN-2).
Checksums verified, attached: `Maatwerk-macos-universal.dmg` (SHA-256 `71b551a6…4c40`), the
`.zip` (`728458ff…7761`) and `SHA256SUMS-macos.txt`. The draft is complete (10 files).

**Published (2026-11-13):** 0.16.0 is public and marked Latest (user).

Manual checks M-POR-1..4 (0.15) are still the user's.

## Step 25 progress (Score entry, 0.16)

Baseline 2026-11-12 on `2bdac21`: cargo test all ok, 127 node; Vitest 558 and Chromium e2e 296
after sub-task 3.

**User decisions (2026-11-12):** GEMIDDELDE row as board 13: per question the rapport's class
average, per observatie the ticked count, per RTTI the mean percentage (decision 29 in
`step-19-grade-rules.md`, with the fixture example); merge PR #15 when green (done).

1. **Done (`a4d68cf`):** F-03 Ctrl+X: copy, then empty as Delete (one undo step); Chromium and
   WebKit fire `cut` on the grid's focus. e2e `F-03 Ctrl+X ...`.
2. **Done (`64ebdfd`):** decision 29 in `domain/scoregrid.ts` `recomputeSummaryRow`; tests
   "score grid decision 29"; golden cases overlay only the new cells.
3. **Done (`938ab9b`):** R-05: `screens/scores.js` -> `screens/scores/` (session, roster, build,
   group-grid, cells, cell-menu, modal), behaviour unchanged.
4. **Done (`77c23d7`):** restyle after board 13: one header row (title + badge + name; ?,
   undo, redo, . → N, Toets bewerken, N-term), the ? popover (hover, focus, click), sticky group
   heading with "<n> leerlingen · <status>" (`groupStatus`), sticky column headings and # / Naam,
   tints, row bars, summary rows, footer legend + save status. `styles/scores.css` (modal) and
   `styles/score-grid.css` (grid); old score CSS removed from `style.css`. Grid stays light in
   the dark theme, as the PO table.
5. **Done:** version 0.16.0 (`7a18015`). Gate green on `7a18015`: fmt, clippy, cargo test, 560
   Vitest, 127 node, 298 Chromium e2e, licences, cargo deny, SPDX; WebKit score-grid/shell/dialog
   137/138 (one PO dialog flake, passed on rerun). Review `docs/reviews/step-25.md` (0/1/7/5);
   fixes `bb3a907` (M1, m1, m2, m4, m5, m7, parts of m3, m6, nits; rest in `docs/backlog.md`
   "From Step 25"). After the fixes: 567 Vitest, 299 Chromium e2e, WebKit score-grid 43/43;
   local visual: only `modal-scores` (3 looks) differs, 138 unchanged.

**Choices made without asking (for the report):** the grid stays light in the dark theme (as
the PO score table); row status is a bar before the number instead of coloured # / Naam cells
(an invalid row's name red); the SD row is grey (no colour scale) as on the board, with "±";
bonus/diag cells are tinted by score too, italic; the status line counts "nog niet compleet"
and "met een ongeldige score"; N-term stays the app's stepper; Naam is bold, not a link; cut
leaves observaties as Delete does.

## Step 24 progress (PO d: PO rapport, 0.15)

Baseline 2026-11-12 on `step/24-po-rapport` `62b608d`: cargo test all ok, 537 Vitest, 125 node
(`npm ci` was needed first).

1. **Done (24a, `3228af4`):** `rapport-po.typ` + `rapport-po-main.typ` (variant A, boards 19 and
   20). Shared helpers factored out of `rapport.typ` (`section_label`, `zebra_stroke`/`_fill`,
   `student_start`/`student_end`); toets goldens pixel-exact. Core `po_rapport_world`,
   `render_po_rapport_pdf`, `PoRapportData` (shared private `world()`). UI
   `domain/po-rapport.ts` (`buildPoRapportData`; numbers via wasm `calcResults`,
   `classQuestions`, `mean`). Fixture `ui/tests/domain/po-rapport.fixture.ts` (Valtoren of 3 over
   5A/5B with group −0,5 and own +0,3/−0,5 lines, a projectgroep of one, a placed ungraded and an
   unplaced student; rubric with bonus, diagnostic, overlapping levels, 5 levels, no titles, two
   category pages). Golden `tests/golden/typst/rapport-po` (Sem + Fleur, 6 pages, 50 ppi),
   **blessed as a draft: needs the user's visual check (STOP)**; `po-rapport.test.ts` keeps its
   data equal to the builder's (`MAATWERK_WRITE_PO_CASE=1` rewrites it). Rust
   `tests/typst_po_rapport.rs` (7 + ignored `preview` writing 110-ppi PNGs to
   `target/tmp/po-preview/`). `typst.test.mjs`/`regen-typst.mjs` accept Maatwerk-only goldens.
2. **Done (24b, `b72cdd6`):** command `render_po_rapport_pdf`, bridge `renderPoRapportPdf`
   (Tauri, mock; not in `PORTED_METHODS`), `services/rapport.ts` `compilePoRapport`; ⋮ Rapport
   genereren enabled on a PO attempt. R-05: `modals/rapport.js` -> `modals/rapport.ts` +
   `modals/rtti-uitleg.ts`. e2e `po-rapport.spec.ts` (2). Docs: manual checks M-POR-1..4,
   typst-contract note.
3. **Done:** version 0.15.0 (`afdaed1`; `bindings.ts` back to the generator's output after a
   stray Prettier run). Gate green: fmt, clippy, cargo test, lint, typecheck, 550 Vitest, 127
   node, 295 Chromium e2e, visual 141 unchanged, licences, cargo deny, SPDX. Review
   `docs/reviews/step-24.md` (0/0/8/5): m1 (category scores and maxima now from the core) and m2
   (no lines on an overwritten grade) fixed; the rest in `docs/backlog.md` "From Step 24".
4. **User (2026-11-12):** wording of the sentence (vs board 19) and >100% with bonus are OK.
   Changes asked: no Totaal row in the Scoretabel (data field `total` removed too), more space
   between categories (14pt -> 24pt; spacing inside a block unchanged). Then: 5pt instead of 2pt
   between a category title and its line (Fleur's rapport now 3 pages + 1 empty, 8 in all). Done, golden reblessed
   ("visual check OK by the user"); the user confirms the new pages before the push.
5. **Was STOP (user):** check the golden PNGs `tests/golden/typst/rapport-po/p1..p6.png` (50 ppi) or
   the 110-ppi preview (`cargo test -p maatwerk-core --test typst_po_rapport -- --ignored` writes
   `target/tmp/po-preview/`), and a real PDF from the exe. On OK: change the golden's
   `port.blessed` text (rebless), push, CI, merge, tags `step-24`, `v0.15.0`, manual M-POR-1..4.

**Choices made without asking (for the report):** "per student, per class, batch, as for a test"
read as the toets rapport does it: one PDF of all graded students of the PO (attempt), sorted by
class then achternaam; the data is built in the UI like the toets rapport's (numbers from
`maatwerk-grades` via wasm), not by a new Rust loader; a projectgroep of one has no projectgroep
line and "Je hebt …" wording; the sentence names group and/or personal bonus/malus as present;
dots coloured as on the toets rapport (`scoreDotColor`); category averages over the graded
students who have that category scored (as `class_questions`: empty left out); an invalid
category score counts 0; positive lines green, negative red; the B / D footnote lists only what
the rubric has; an overwritten grade without scores gets page 1 with the grade only.

**Step 23 (PO c: PO beoordelen, 0.14), started 2026-11-11.** Steps 20-22 and the top bar are
merged (user, 2026-11-11: macOS CI rerun green): PR #12 (`bf1821a`) and PR #13 (`3062568`, steps
21, 22 and `fix/topbar` in one merge); push CI on `main` green (run `42962807480`). Tags on the
remote: `step-20`/`v0.11.0` `bf1821a`, `step-21`/`v0.12.0` `472cbf2`, `step-22`/`v0.13.0`
`81e9c63`. Merged local branches deleted.

**User (2026-11-11):** visual diff of `modal-po-scores` and `modal-po-grade` OK (local images
are the baselines); local exe 0.14.0 built for the test on real data.

**User (2026-11-11):** before/after table OK ("works like I expect"); go on to CI and the merge.

Then: pushed for CI, CI baselines, merged, tagged (see above).

## Step 23 progress (PO c: PO beoordelen, 0.14)

Baseline 2026-11-11 on `main` `3062568`: cargo test all ok, 520 Vitest, 125 node.

**User decisions (2026-11-11, grade rules, `step-19-grade-rules.md` decision 28):** student grade
= R + group lines + own lines, held 1,0..10,0 once at the end; lines one decimal, −9,0..+9,0, not
0; a PO is gradeable as a test (one scored category; lines alone give no grade).

Plan: (1) core: decision 17/28 in `maatwerk-grades` (lines from `po[examId]` of the score
record), wasm, `validate-data` for `po`, guard `minAppVersion` 0.14.0 on the first score file with
a `po` entry, docs, version 0.14.0; (2) 23a UI: PO score table (`modals/po-scores.ts`), ⋮ Scores
enabled for a PO; (3) 23b UI: grading modal, autosave (10 s, on close; CAS per member file),
Vorige/Volgende; (4) 23b: regrouping copies the new group's data (decision 19), PO grades on
cards/overviews checked, opdrachten genereren with category observaties; (5) before/after table
of averages (STOP: user), gate, review, report.

1. **Done**, core: `maatwerk_grades` `PoGrading`/`PoLine` (`ScoreRecord.po`, tolerant),
   `calc_results_with(exam, scores, over, po)`, `exam_results` passes `rec.po[examId]`,
   `HistoryEntry.po`, `Results.rubricGrade` (PO only), `rubric::{line_valid, lines_sum,
with_lines}`; wasm `calcResults` takes an optional 4th arg, new `poLineValid`, `poLinesSum`,
   `poWithLines`. Core guard `PO_GRADING_MIN_APP_VERSION` 0.14.0 (score file with non-empty `po`;
   mock too). `validate-data` checks `po`. UI: types `PoGrading`/`PoLine`, `recordFor` carries
   `po`, history/best attempt/profile pass it. Docs `data-files-v3.md` "PO grading". Version
   0.14.0. Tests: 6 grade, 1 wasm, 2 core, 1 Vitest.
2. and 3. **Done** (one commit; they share `loadPoContext`): `domain/po-grading.ts` (group
   grading in a record: read, write keeping own lines, clear, status, `groupSource` with a
   fallback for unstamped scores, line parse/format); dialog option `headerActionsHtml`;
   `modals/po-scores.ts` (table, sticky `thead` + group headings, unplaced last, header ?,
   Projectgroepen, PO bewerken, refresh on focus back / sync); `modals/po-beoordelen.ts`
   (levels highlighted, slider + Wissen, category obs + comment, overall comment, group and own
   lines with validation, general obs, live grades, Vorige/Volgende, autosave 10 s + on close,
   every member file checked fresh before any write: a conflict writes nothing and offers a
   reload); ⋮ Scores invoeren enabled for a PO; `styles/po-scores.css`, `po-grade.css`.
   Store exports `updateStudentScores`. Fix (step 22 bug, found by the e2e): Projectgroepen
   counted a group stored in another order than by achternaam as a change (Escape asked).
   `e2e/po-grading.spec.ts` (5), seed option `grading`; visual views `modal-po-scores`,
   `modal-po-grade` (local images written, not yet seen by the user).
3. **Done:** regrouping (decision 19, `po-groepen.ts` `takeNewGroupGrading`): a moved student
   takes the grading of a member who stayed in the new group (else the group fields are
   cleared), own lines kept; opdrachten genereren for a PO (`opdrachten.ts` `examObsIds`: the
   rubric's general + category observaties; a student's general + category ones), ⋮ item
   enabled when there are any; rapport.ts passes `po` (PO rapport is step 24). Cards, overviews,
   profile already go through `examResults`/averages (with `po` since sub-task 1). Manual checks
   M-POB-1..6. e2e 7 in `po-grading.spec.ts`.

4. **Done:** gate green: fmt, clippy, cargo test, lint, typecheck, 537 Vitest, 125 node, 293
   Chromium e2e, local visual 141 (6 new PO images written, not yet seen by the user; the other
   135 unchanged), licences, cargo deny, `npm audit --omit=dev` 0, SPDX. WebKit (po-grading, po,
   shell, dialog): all pass except the 3 drag-and-drop tests, which fail on local Windows WebKit
   also on `main` (backlog; CI runs WebKit on Linux/macOS). Review `docs/reviews/step-23.md`
   (0/2/9/4), triage at its end: M1, M2, m2, m3, m5-m8, n2 fixed; m1, m4, m9 in part; rest in
   `docs/backlog.md` "From Step 23". New files `po-grade-view.ts`, `po-regroup.ts`.

**Choices made without asking (for the report):** status Beoordeeld = every normal category
scored (bonus/diagnostic may stay empty); an unscored category shows "—" until its slider is
used, "Wissen" empties it; lines without a valid value stay in the dialog only (marked red);
general observaties offered = the rubric's + the PO's own; a member graded in another group is
tagged "andere groep" in the table; the first grading raises `minAppVersion` to 0.14.0; the
`?` in the table header opens a short explanation.

**Before/after (STOP, for the user):** the synthetic v3 fixture plus a PO (weging 2, PTA, Valtoren
1001 + 1002, 15/17 = 8,8; group line −0,5, own line +0,3 for 1002), CLI `stats` (script
`po-before-after.mjs` in the session scratchpad): PO mean 8,8 -> 8,5 (sd 0,0 -> 0,2); 1001 year
8,4 -> 8,0, SE 8,8 -> 8,3; 1002 year 6,9 -> 6,8, SE 8,8 -> 8,6; the test unchanged. No change on
the fixtures without a PO, nor on data without `po` entries (no app wrote them before 0.14).

## Step 22 and the merge (history)

**User (2026-11-10):** M2 option b (a student who leaves every projectgroep loses the PO's
scores, after a confirm) and a wiskunde PO gets A/B/C/D from jaarlaag 4: both done. Local exe
0.13.0 built for the user's test on real data.

**User (2026-11-10, later):** visual diff OK, local baselines updated (139 images). Manual test
`docs/reviews/manual-test-step-22.md`: M-PO-1, 2, 4 pass; M-PO-3 partial: an empty projectgroep
needs a delete button, and members sorted by achternaam: both done (the unplaced list too).
`modal-po-groepen` changes again (the trash button on the empty group): show the user.
Top bar fixes on `fix/topbar` (from `step/22-po`): `body` `min-height` instead of `height` (the
sticky bar scrolled away after one window of a long list); `shell/topbar-fit.ts` hides the
wordmark when the tabs do not fit (measured). Probe: teacher fits at 900 px without wordmark;
admin needs 874 px of tabs and overflows below ~1010 px even then.

**User (2026-11-10, evening):** `modal-po-groepen` OK (local baselines updated); icon-only step
approved and done on `fix/topbar`: when the tabs still overflow without the wordmark,
`topbar--icons` shows inactive tabs as icon only (name visually hidden, so still the accessible
name, and a `title` tooltip); the active tab keeps its name. `e2e/topbar.spec.ts` (4). Chromium
e2e 278, WebKit topbar+shell 19, 520 Vitest, local visual unchanged.

**Was the next action (done 2026-11-11):** push for CI and merge in order 20 -> 21 -> 22 -> `fix/topbar` (user: "start CI
and merging"), CI baselines of changed views from CI's own run, tags. Started 2026-11-10 17:32:
rerun of step 20's failed PR job (run `42796057189`); `step/21-rubrics` pushed (run
`42866062460`, expected to fail visual on the changed views: take their baselines from it).
Result: step 20 macOS got no runner (capacity); step 21 Linux visual 6 views (baselines committed,
`f21427e`, with Prettier on `manual-test-step-21.md`, which failed Windows lint); run
`42868926174`. **User (2026-11-10 evening):** macOS gets no runner now; go on with Windows and
Linux for steps 21, 22, `fix/topbar`; the user reruns macOS tomorrow morning. Merges into `main`
wait for macOS green (main stays green). **User decision:** merge step 20 (PR #12) alone; then
21, 22 and the top bar in **one** merge of `fix/topbar` into `main`. macOS baselines of all their
views from one macOS run on `fix/topbar` (it stops at the visual step), then a second macOS run to
confirm. Tags `step-21`/`v0.12.0` on the head of `step/21-rubrics`, `step-22`/`v0.13.0` on the
head of `step/22-po`. Step 22 run `42872007833`; step 21 Windows baselines `472cbf2` (run
`42871975947`).
**Done 2026-11-10 evening:** Windows + Linux green on `step/21-rubrics` (`472cbf2`, run
`42871975947`), `step/22-po` (`81e9c63`, 3 new PO views' baselines, run `42876302305`) and PR #13
(`fix/topbar` -> `main`, run `42880268851`; push CI runs only for `main`/`step/**`, so the PR
runs it). Exe and CLI 0.13.0 rebuilt from `fix/topbar`. **Tomorrow:** user reruns macOS of PR #12
(`gh run rerun 42796057189 --failed`), merges it, tag `step-20`/`v0.11.0`; then a macOS run on PR
#13 (rerun its macOS job), commit the macOS baselines of the failed views from its
`visual-macos` artifact on `fix/topbar`, push, confirm green, merge, tags. Visual
views get an optional `seed` (`ui/e2e/views.ts`, `e2e/po-seed.ts`): the shared mock fixture has
no PO, because the step 21 rubric e2e tests count rubric uses.

## Step 22 progress (PO b: PO in Toetsen and projectgroepen, 0.13)

Plan: (1) 22a core/data; (2) 22a UI: PO toevoegen step 1, PO card, PO bewerken, menu; (3) 22b UI:
Projectgroepen step (click/drag, Willekeurig indelen, empty groups dropped), regrouping warning,
PO herkansing; (4) gate, review, report.

1. **Done**, 22a core/data: `maatwerk_grades` `Exam.rubric` (attached by the caller, never in
   a file) and `calc_results` for a PO (categories as questions, whole points, decision 16,
   round1, no RTTI/N-term; no rubric: no grade); `exam_scores` reads category ids. Tests incl.
   year average and PO herkansing. CLI `stats` attaches `rubrics/<id>.json`. Core guard: the
   first `kind: "po"` exam raises `minAppVersion` to **0.13.0** (`PO_EXAM_MIN_APP_VERSION`);
   `usage` names exams by `title` (was `naam`, which exams lack). `validate-data`: PO without
   rubric / with questions (warn), `projectgroepen` shape, a student in two groups (error),
   unknown members. Docs `data-files-v3.md` "PO exams". UI: `domain/po.ts` (matching rubrics
   and classes, unplaced, random groups, save/copy/moved, `forGrading` + `setRubricLookup`
   registered by Store; used by `grades.ts`, `statistics.ts`), mock guard 0.13.0, version
   0.13.0. (`e858b22`)
2. 22a UI (with 3 in one go, written): "+ PO toevoegen" (`modals/po-gegevens.ts`: step 1 and PO
   bewerken; rubric list follows schoolsoort + jaarlaag, preview chips + formula; rubric locked
   once the PO or its family has scores; a family's fields locked as for tests), PO card
   (`exam-cards.ts`: rubric line, "n projectgroepen", no N-term; title and Overzicht openen not
   clickable for a PO), ⋮ menu (`exam-menu.ts`: Scores/Rapport/Opdrachten disabled with a
   reason, Herkansing toevoegen, Projectgroepen, PO bewerken, PO verwijderen), `styles/po.css`.
3. 22b UI (written): `modals/po-groepen.ts`: Projectgroepen (new step 2, the PO's own dialog,
   herkansing): unplaced students of the matching classes with class filter and class tag,
   click adds to the active group, drag and drop both ways, × removes, names, "+ Projectgroep",
   "Willekeurig indelen…" (size n, over the visible unplaced, as even as possible), empty
   groups dropped on save, "← Gegevens" keeps everything; regrouping a student of a PO with
   scores asks first (decision 19; the score copy itself comes with grading, step 23). PO
   herkansing: same rubric, groups copied with new ids, editable before saving. (`6c202ac`)
4. Gate green: fmt, clippy, cargo test, lint, typecheck, 517 Vitest, 125 node, 273 Chromium e2e,
   WebKit (po/rubrics/shell 34), licences, cargo deny, `npm audit --omit=dev` 0, SPDX. Review
   `docs/reviews/step-22.md` (0/2/4/6), triage at its end: M1 (best attempt of a PO family
   ungraded) fixed with a failing test first; m1-m4, n2-n4, n6 fixed; n5 backlog; **M2 for the
   user**. Local visual: the 30 step 21 images still differ (local baselines predate step 21)
   plus the 9 new PO images.

Choices made without asking (for the report): a PO's title and "Overzicht openen" are not
clickable until a PO overview exists; Scores/Rapport/Opdrachten in a PO's menu are disabled with
a reason; "Projectgroepen" is its own ⋮ item (the score table gets it in step 23); PO bewerken
locks the rubric once the PO or its herkansing has scores, and a family's fields as for tests;
the class tag is the student's matching Groep name (first by name); random groups go over the
visible (filtered) unplaced students, as even as possible; no wiskunde subcategory for a PO;
the grade of a PO is round1(10 × punten ÷ max) like a test's.

Step 21 (for the record): the user's manual test passed (`docs/reviews/manual-test-step-21.md`,
M-OBS-2, M-RUB-1..5). Still to do there: push for CI, CI baselines, merge, tags.

## Step 21 (waiting for CI and merge)

Next there: push `step/21-rubrics` for CI (after step 20's macOS rerun ends, or the push cancels
it), replace the CI baselines of the changed views from CI's own run, local baselines, merge, tag
`step-21`, `v0.12.0`.

## Step 21 progress (PO a: rubrics, observatie toetstype, 0.12)

1. **Done** (`a89e910`), 21a data and core: `maatwerk-grades::rubric` (rules, totals, lock,
   PO grade; wasm), `maatwerk-core::rubrics` (usage over all years; guard in `write_json` /
   `delete`; `minAppVersion` 0.12.0 on the first rubric or PO observatie), migration writes
   `toetstypes`, `validate-data`, CLI `rubric check`, command `rubric_usage`, mock guard, mock
   fixture (3 rubrics, 4 PO observaties in `to-current.mjs` only), docs
   `data-files-v3.md`. Version 0.12.0 already (the guard raises to 0.12.0). Chromium e2e 240.
2. **Done** (`f540e71`), 21b UI: Rubrics tab + cards, rubric editor (`modals/rubric-editor.ts`,
   `rubric-levels.ts`), Dupliceren, delete guard; Observatie toetstype field + filter chip
   (`screens/observatie-toetstype.ts`, `components/choice-chip.ts`); toets-edit offers only
   `toets` observaties. `e2e/rubrics.spec.ts` (13); Chromium e2e 261. New views
   `screen-rubrics`, `modal-rubric-edit`, `modal-rubric-new` (local images written, not yet
   seen by the user).
3. Gate + review: local visual: 30 images differ (10 views × 3 looks): every teacher page
   (`screen-leerlingen/groepen/toetsen/observaties/opdrachten`, `exam-menu`, `user-menu-teacher`:
   the Rubrics tab), `modal-observatie-edit/new` (Toetstype), `modal-opdracht-edit` (lists the 4
   new PO observaties of the mock fixture). CI baselines of those views and of the 3 new ones
   must be replaced from CI's own run, as in step 20. Gate green: fmt, clippy, cargo test,
   lint, typecheck, 498 Vitest, 125 node, 261 Chromium e2e, WebKit (rubrics/shell/dialog 102),
   licences, cargo deny, `npm audit --omit=dev` 0, SPDX.
4. **Done:** review `docs/reviews/step-21.md` (0/1/8/9), triage at its end: M1 (gaps from the
   intervals; a huge max no longer freezes the editor), m1 (CAS checked before raising
   `minAppVersion`), m4, m5, n6, n8 partly, n9 fixed with tests; m2, m3, m6 and the rest in
   `docs/backlog.md` "From Step 21". Manual checks M-OBS-2, M-RUB-1..5.

Choices made without asking (for the report): a locked rubric also locks adding/removing
categories (they change the max); category names stay editable when locked (decision 20; board
16 disables them); `uitleg` of a level is required; a rubric needs one `normaal` category; an
observatie used in a test keeps toetstype Toets (so the score grid needs no filter).

**User confirmed (2026-11-10)** the choices made without asking: a rubric in use also locks
adding/removing categories, names stay editable (decision 20 over board 16); every level needs an
uitleg; a rubric needs one Normaal category; an observatie a test uses keeps Toets, one a rubric
uses keeps PO; the editor's vak is the active vak; the rubric module in `maatwerk-grades`.

**User decisions (2026-11-10):** a category's max is 1 to 100 (`MAX_POINTS`; the display numbers
every fifth score above 40 boxes); the card chips keep "· bonus" / "· diag". macOS baselines of
step 20 committed (`0ddc7c8`, from run `42636690859`) and pushed; CI run `42796049482`; merged into
this branch. A local exe 0.12.0 was built for the user's manual test on real data.

**Step 20 (waiting):** PR #12 (`step/20-toetsen`), head `0ddc7c8` (macOS baselines). Push run
`42796049482` fully green, visual included on all three OSes. PR run `42796057189`: macOS failed
one WebKit test (`quirks.spec.ts:141` D34, `Target crashed` at its first click: the browser died,
the same test passed in the push run). The user reruns it later: `gh run rerun 42796057189
--failed`. Then the user merges; sync `main`, tag `step-20`, `v0.11.0`.

**CI retry (user 2026-11-10):** `ui/playwright.config.ts` has `retries: process.env.CI ? 1 : 0`
on this branch, so one browser crash no longer fails a run (a pass on retry is reported flaky).

## Step 20 progress (Toetsen, 0.11)

Both parts in one session, so no `step-20a` tag.

1. **Done** (`caa9d63`): pure functions and tests: `domain/test-type.ts` (diagnostic, PO), `domain/exam-info.ts`, `domain/question-structure.ts`.
2. **Done** (`9d30b69`): 20a list (`screens/toetsen.ts`, `exam-cards.ts`, `exam-menu.ts`), Nieuwe toets (`modals/toets-nieuw.ts`), Toets bewerken (`modals/toets-edit.ts`), shared `modals/exam-fields.ts`, `styles/toetsen.css`, dialog option `leadHtml`. 20b Nieuwe poging and Verzamelkaart with D (`modals/herkansing.ts`), locked observaties, propagation to attempts, B-05 (`toets-overzicht.js`). `e2e/toetsen.spec.ts` (16). Quirk T33.
3. **Done:** version 0.11.0; gate green on Chromium.
4. **Done:** review `docs/reviews/step-20.md` (0/2/6/10), triage at its end. M1 (validator warned about `weging_se` on every diagnostic test) and M2 (a refused save had already removed indications) fixed, failing tests first; also m1, m3, n1, n2, n4-n7. m5 and the rest of m6 in the backlog.

5. **Done, user (2026-11-09):** visual diff OK with one text change (lock block: "Observaties worden overgenomen van het origineel."); tested on a copy of the real data: everything works; review m4: diagnostic tests leave the profile's year RTTI Gem. (decision 27, `rttiGemHistory`; grade crate unchanged). Local baselines updated.

Choices made without asking, for the report: an attempt keeps observaties only it has (`resitObsIds`); percentages in the footer are of the normal points, bonus shown apart (the mock's example counted a bonus question in its total); the D note shows a `D` badge (the test has no number yet); summary overview columns are the union of all attempts' observaties.

**Not touched:** grade rules, data format. Local visual baselines: 18 images differ (6 views × 3 looks: `screen-toetsen`, `exam-menu`, `modal-toets-new`, `modal-toets-edit`, `modal-herkansing`, `modal-verzamelkaart`); not updated, the user first.

## Step 19 progress (Domain logic, 0.10)

User instruction (2026-11-08): run everything about grades, averages and scores by the user, with
formulae, examples and a recommendation, as a multiple-choice question; assume nothing. The 23
decisions: `docs/phase-2/step-19-grade-rules.md` section 6. **Never change a number or rule in step
19 without asking.**

1. **Done** (`8427148`): analysis, the user's decisions, ADR-0011 (WebAssembly instead of Tauri
   commands: synchronous, and one implementation also in the mock).
2. **Done** (`202c84e`): `crates/maatwerk-grades`: 71 tests from the approved tables, 10 against the
   reference goldens (every difference names its decision).
3. **Done:** `maatwerk_core::grades`, CLI `stats` (read-only; student numbers only);
   `crates/maatwerk-grades-wasm` (JSON `dispatch`, tiny `abi.rs`, no new dependencies);
   `ui/vite/grades-wasm.ts` (cargo build once per Vite run, inlined as a base64 module);
   `ui/src/domain/core.ts` (top-level await, then synchronous `coreCall`, `round1`, ...); CSP
   `'wasm-unsafe-eval'`; wasm target in `rust-toolchain.toml`. Run npm from PowerShell: Vite now
   runs cargo (Git Bash's `link` breaks build scripts).

4. **Done** (`7e4241d` and later): every screen, the score grid and the rapport on the core; the JS copies are gone. Gegevenscontrole warns about values the rules read past (decisions 18, 22, 23). D4, D16, D17 checked, unchanged (`quirks.md`). Grid speed: 0,07 ms per 40-question row, no batch call needed. Version 0.10.0. Golden `rapport-valid` p12, p14 re-blessed, pending the user's check.
5. **Done:** review `docs/reviews/step-19.md` (0/8/10/8), triage at its end: all majors fixed. Two were the user's call: decisions 24 and 25.

6. **Done:** user OK (2026-11-09) after testing the local exe 0.10.0 on the real data. Local visual baselines updated (30 images: 10 views, 3 looks; not committed). CI baselines of those 10 views replaced on all three platforms from CI's own run; the other 29 views passed unchanged.

**Pending, needs the user:** merge.

**User (2026-11-08):** the migration ran fine on a copy of the real data (local exe 0.9.0).
Leeradvies score column 3 cm -> 2,5 cm (`16439a2`, goldens re-blessed; scores up to
"99,5 / 99 (100%)" fit). Steps 17 and 18 merged into local `main`, tagged `step-17`,
`v0.8.0`, `step-18`, `v0.9.0` (local); pushed as `release/v0.9.0` with a PR.

**User answers (2026-11-07):** golden check 17 approved (padding page with footer and
watermark is fine). T9 moved to step 19b, T23 to step 30 (PLAN-2, ROADMAP 4.6; renumbered 2026-11-08). F-14:
`opdrachtenVraag` stays on the exam (ADR-0010 item 7); `onder: 2` matches 0, 1 and `N`, not an
empty score (step 30 implements the matching).

**User instruction (2026-11-07):** do steps 17 and 18 in one go, as separate branches and
commits; the gate, code review and security review only once, after step 18. Step 16: CI green
(user), version 0.7.0, merged into local `main`, tagged `step-16b`, `step-16`, `v0.7.0`.

## Step 17 progress (Rapport fixes, 0.8)

Scope as PLAN-2 step 17: B-06, B-07, F-13, F-04, T4, T7, T8, T10, T25; plus T6 (the rapport's
numbers, same lines as T7). T9 (histogram/ranking texts) moved to step 19b and T23 (batch
reports only the first failure) to step 30 (user 2026-11-07; renumbered 2026-11-08).

1. **Done** (`f26d77f`): template fixes, failing tests first (`tests/typst_rapport.rs`, 9 new):
   T4 watermark only when `fotos/school-watermerk.svg` exists (any case; `data.json` field
   `watermark`); T6/T7 `_num` (decimal comma, no truncation); T8 footer total = the student's
   own pages (metadata `<rapport-student-end>`); F-13 `pagebreak(to: "odd")` between students,
   the last student padded via its end marker; T10 zero/fractional maxima, missing
   `grenswaarden` (TS, `buildLeeradviesRows`); T25 `lang: "nl"`; B-06 score column 3 cm (2,5 cm since 2026-11-08); B-07
   dots 5.5 pt when any score or maximum has a fraction. Goldens `rapport-one-student`,
   `rapport-valid` blessed (`MAATWERK_BLESS="<why>" MAATWERK_BLESS_IDS=<ids> cargo test`, new in `tests/support`; case
   field `port.blessed`): page 1 of each student changes, page 2 not. User approved the
   before/after PNGs (2026-11-07).
2. **Done** (`8010810`): F-04 `components/render-warnings.ts`: folded panel above the PDF in the
   rapport and opdrachten dialogs; bridge returns `warnings`; batch warnings name the opdracht,
   once per opdracht; mock `useRenderWarnings`; e2e `e2e/rapport.spec.ts` (3).
3. **Done** (`9ea3bd9`): version 0.8.0.

## Step 18 progress (Data format v3, 0.9)

Branch `step/18-data-v3` on top of `step/17-rapport-fixes` (17 is not merged: its golden check is
pending). Spec: `docs/reference/data-files-v3.md`; runbook section 9.

1. **Done:** core. `migrate::v3` (new): `school.json` first (`minAppVersion` 0.9.0 when absent or
   lower; logo/watermerk paths), `fotos/` -> `afbeeldingen/` (any case), `users/` removed (stale
   presence), `gebruikers` foto paths, every exam `kind: "toets"`/`diagnostic: false` when
   absent, resits `obs_ids` = original's + own (warning) and `obs_from_parent: true`, with a
   before/after `notes` line per resit (decision 13). Changed entities: rev + 1, `updatedBy`
   null. `migrate` chains v1 -> v2 -> v3 after one backup (`migrate_to` for tests; a v1 dry run
   lists v2 only and says v3 follows). `CURRENT_VERSION` 3; v2 is `needs_migration`. Storage
   `IMAGES_DIR`/`PRESENCE_DIR`; rapport mount `/data/afbeeldingen`; watcher/snapshots skip
   `afbeeldingen/`. D20: `presence::prune_stale` (30 days) at every start. `validate-data`:
   v3 exam fields, `opdrachtenVraag` (F-14 data part), leftover `fotos/`/`users/` named.
   Fixtures: v1 fixture got two resits; `tests/fixtures/migrate/v2` regenerated (only those two
   added); new golden `v3`. 11 new Rust tests.
2. **Done:** app + UI. `migrate_data_folder(dryRun)`, `MigrationResult.notes`; the start screen
   shows the resit list before the confirm; CLI prints it. UI paths (`afbeeldingen/`,
   `aanwezigheid/`), `withExamDefaults` in `Store.upsertExam`, new resits copy the original's
   observaties (F-12 data part; locking in the edit screen is step 20). `tools/fixtures/to-v2.mjs`
   -> `to-current.mjs` (`filesToV3`, mock only; Store goldens stay on v2). Mock app version 0.9.0.
   Version 0.9.0.
3. **Done:** gate after step 18 (user: one gate for 17 and 18): fmt, clippy, all Rust tests,
   420 Vitest, 123 node tests (incl. the Typst reference-freshness check), 220 Chromium e2e,
   117 local visual views unchanged, lint, typecheck, SPDX, licences, cargo deny,
   `npm audit --omit=dev` 0. Reviews (fresh context): `docs/reviews/step-17.md` (0/1/5/5),
   `step-18.md` (0/1/8/6), `step-17-18-security.md` (0/1/5/5); both majors and most minors
   fixed (`ee4b0ea` on step 17, merged into 18; `1b522c4`), rest in `docs/backlog.md`. Nothing
   pushed; WebKit e2e and macOS/Linux CI not run for 17/18.
4. **Not done, needs the user (STOP gates):** the `validate-data` list from a copy of the real
   data (PLAN-2 "before the step"); running the migration on that copy; deleting leftovers. No
   automatic leftover removal was built: the list decides (runbook section 9).

## Step 16 (done, tags `step-16b`, `step-16`)

Plan: (1) CI job `linux` + packages; (2) case-sensitive path tests (Windows-made data folder in
mixed case: path helpers, migration, `validate-data`); (3) backlog: lock dir, snapshot `who`,
early log dir; (4) README Linux section + sync advice (STOP); (5) visual tests per platform in
CI; (6) gate, review of step 16, report.

1. **Done** (`7540d21`), CI result pending: `src-tauri/tauri.linux.conf.json` (appimage + deb, Education), `npm run
build:linux`, CI job `linux` on ubuntu-24.04 (glibc 2.39+): npm test, WebKit e2e, clippy
   (the only lint of `cfg(not(windows))` code), cargo test, fixture migrate + validate,
   real-pdf, AppImage + .deb artifact `maatwerk-linux-x86_64`. `data_location::program_path`:
   `$APPIMAGE` counts as the program, so `data/` beside the AppImage works like beside the exe.

2. **Done** (local, not pushed while CI run `42213080719` runs): case-sensitive paths (quirk
   T32). Typst World: a missing mounted file is looked up ignoring case
   (`world::find_ignoring_case`; ambiguous -> not found). Migration rewrites `images/<id>/` in
   any ASCII case. `validate-data`: a case-only mismatch is a warning with the real name. The
   whole workspace suite also passes with `TMP` in a case-sensitive folder on Windows (`fsutil
file setCaseSensitiveInfo`). Login lists `gebruikers/` (ids keep their case); image import
   already refuses case-only clashes.

3. **Done** (local): the 16a backlog. `default_lock_dir` is per user everywhere (a shared
   `/tmp/maatwerk-locks` made by one Linux user blocked the next user's saves): Linux
   `$XDG_RUNTIME_DIR`, else `~/.cache`; macOS `~/Library/Caches`. Snapshot `who`:
   `machine_name()` (COMPUTERNAME / `scutil --get ComputerName` / `/proc/sys/kernel/hostname`).
   `early_log_dir` mirrors Tauri's `app_log_dir` on macOS and Linux too.

4. **Done** (local): README "Linux (from 0.7)" (`.deb`, AppImage + `libfuse2t64`, `data/` beside
   the AppImage) and "Linux: the shared folder". **User decision (2026-11-06, STOP gate):**
   OneDrive Client for Linux (abraunegg, `--monitor`) recommended, rclone bisync on a timer as
   the alternative; `rclone mount` and GNOME Files' OneDrive marked unsuitable. validate test:
   the clients' conflict copies are listed. `docs/release.md` Linux artifact, manual checks
   M-LNX-1..6.

5. **Done** (local), baselines pending: visual tests in CI. **User decision (2026-11-06):** the
   light look only, baselines per CI platform committed (`ui/e2e/visual-baselines/<project>-
<platform>/`, ~2.5 MB each; local WebKit run: 39 views, ~50 s, stable). Projects
   `visual-ci-chromium` (Windows job) and `visual-ci-webkit` (macOS, Linux), tolerance
   `maxDiffPixelRatio: 0.002`. A platform without a folder writes its baselines (warning) and
   uploads artifact `visual-<os>`; next: commit those from the first run (docs/testing.md
   "Visual baselines in CI").
6. Run `42225808814` (`3056ce4`): Linux and macOS green and wrote their baselines (39 each;
   3.6 MB Linux, 4.6 MB macOS; checked by eye: DejaVu on Linux, SF on macOS, charts fine),
   committed. Windows failed twice on Chromium e2e flakes, each a different test: csp
   screen-groepen (`ERR_CONNECTION_REFUSED` once), accounts `#traag` (30 s timeout), dialog
   "opens at the fixed top" (measured mid-animation; now polled). Watch the first two; no CI
   retries added.
7. Run `42230950159`: all green; macOS and Linux compared against the
   committed baselines; Windows wrote its 39 (2.7 MB, Segoe UI; checked by eye), committed.
   Run `42235274073`: Windows and Linux compared against the committed baselines (no new ones);
   macOS got no runner ("not acquired", GitHub capacity), reruns with the next push.
8. Review `docs/reviews/step-16.md` (fresh context): 0 blockers, 3 majors, 7 minors, 6 nits;
   triage at its end. **M1** a missing chosen folder no longer becomes a new school
   (`state::open_located`); **M2** (user decision 2026-11-06: keep the order) "Over Maatwerk"
   shows the data folder with "Andere map kiezen…"; **M3** the dialog trap leaves a handled Tab
   and `tabindex=-1` alone (G45 extended). Also m5 (lock folder `~/.cache` only), m6, n1-n3, n6
   (`local-config.json` in the local, not roaming, app folder). Backlog: m1-m3, m7. Local: all
   Rust tests, 434 e2e (Chromium + WebKit), lint, typecheck.

9. Run `42242653611` failed on Linux: the n3 fix had written a literal backslash-n into the apt line
   (fixed, `ci: real line continuations…`). Run `42246523588`: Windows and Linux green, visual
   39/39 on both; macOS had no runner for the third time (GitHub capacity), only the macOS job
   rerun. **Paused here (2026-11-06, user).** Resume: `gh run view 42246523588` (macOS job:
   e2e, first comparison against the committed macOS baselines). Green: tag `step-16b`, stop and
   report (merge to `main` and the 0.7 release only with the user). This STATE commit is local
   (a push would cancel the rerun); push it with the tag.

## Step 16a (done, tag `step-16a`)

**Step 16a** (Platforms: macOS; L, 16a/16b). Item X-04. User decisions (2026-11-06): **unsigned
macOS build + "Open anyway" instructions** (no Apple Developer account; ad-hoc signed for Apple
Silicon); pushing `step/16-platforms` for CI runs is fine (no tags, no merge without the user).

1. **Done** (`c91d467`): first-run "choose data folder". `maatwerk-core::data_location`
   (`locate`: env > dev > chosen in `local-config.json` > `data/` beside the program if it
   exists, never inside a `.app`; `check_chosen`: data folder, `<picked>/data`, or empty, else
   refused in Dutch; `LocalConfig` keeps unknown fields). `paths::data_dir_location` removed.
   App: `ErrorCode::NoDataFolder`, `DataFolderStatus.source`, command `choose_data_folder`
   (folder dialog, `save_choice`, UI restarts). UI: `screens/choose-folder.ts` ("Kies de
   gegevensmap"), "Andere map kiezen…" on the startup error screen for `chosen`/`besideApp`.
   Tests: 4 core, 1 app, 4 Vitest, 3 e2e (`e2e/platforms.spec.ts`); manual M-START-8/9.
   Behaviour change: a Windows exe without `data/` beside it asks instead of creating one.
2. **Done** (`f1a62f2`): font stacks fall back to system fonts (`system-ui`, `ui-monospace`,
   Menlo, DejaVu Sans Mono); Windows keeps Segoe UI/Consolas first (no visual change). Emoji in
   the UI: the OS font (Apple Color Emoji); Typst uses the bundled Noto as before.
3. **Done** (`9a6a6e1`): Playwright project `webkit` (`npm run test:e2e:webkit`, runs on
   Windows too after `npx playwright install webkit`): 215/215 locally (one timing flake per
   full parallel run, a different test each time; editor preview tests under load). WebKit
   findings, all test-side: native `<select>` -> CSP `style-src-attr` report (ignored on WebKit
   in `watchErrors`), no clipboard permissions (`pasteText`/`copySelection`), Chromium-only
   `shadowRoot.getSelection`, per-glyph SVG hit test, Playwright scroll vs `content-visibility`,
   aborted module import on a second navigation. App fix: Cmd+Z / Cmd+Shift+Z / Cmd+Y undo.
4. **Done** (`e800328`): CI job `macos` and `src-tauri/tauri.macos.conf.json` (app + dmg, ad-hoc
   `-`, macOS 12+), `npm run build:mac`; README "macOS" ("Toch openen"), release.md. Branch
   pushed; **CI result pending** (first run).
5. Local gate green on `56f13f2`+ (fmt, clippy, cargo test, 412 Vitest, 122 node tests, deny,
   licences, SPDX; e2e 215 Chromium, 215 WebKit). Also `docs/testing.md` "WebKit (step 16a)",
   manual checks M-MAC-1..6.
6. First CI run with the macOS job (`42193879918`): 10 WebKit e2e failures on the macOS runner,
   none on Windows. Two causes: the specs pressed `Control+A` / `Control+End` / Ctrl+click, which
   are other actions on a Mac (now `ControlOrMeta`); and a real bug: WebKit on macOS skips
   buttons on Tab, so the dialog focus trap never saw its last button focused and focus left the
   dialog. The trap now moves focus itself (`ui/src/components/dialog.ts`).
7. Second run (`42205393394`): 2 editor e2e failures on macOS. setText's Delete + insert are two
   edits and the slower runner compiled the empty text in between, so "the preview stays on
   errors" kept an empty preview. Those steps now add ` #fout` / ` #traag` at the end (one edit).
8. **Done.** Third run `42209047813` on `6d65139`: all three jobs green; macOS 214 WebKit e2e,
   cargo test, real-pdf; `Maatwerk.app` universal (`lipo`: x86_64 arm64), `codesign --verify`
   ok; artifact `maatwerk-macos-universal` (.zip + .dmg, ~114 MB). Tagged `step-16a` (local).
   Next: step 16b (Linux). The step 16 review and the 0.7 release come after 16b.

Backlog candidates (done in 16b item 3): the snapshot's `who` uses `COMPUTERNAME` (unset on macOS ->
"onbekend"); `default_lock_dir` falls back to `temp_dir()` off Windows (per user on macOS,
shared `/tmp` on Linux: 16b); `early_log_dir` is Windows-only.

## Step 15 progress

1. **Done:** minimum app version (decision 5). `maatwerk-core::app_version` (parse, compare,
   `required_version`); `Storage::read_only()` reads `school.json` `minAppVersion` on every call
   and every file write or delete is refused with `Error::ReadOnly` (`read_only`; details.found =
   the minimum); presence skips its writes when read-only. `dataFolderStatus` has `appVersion` and
   `readOnly`. UI: `services/read-only.ts` (texts, version compare for the mock),
   `components/read-only-banner.ts` (banner at the top of `#app`), Store throws `{code:
'read_only'}`, app.js shows "Niet opgeslagen: deze versie van Maatwerk is te oud ..." (not the
   "onverwacht" text), PIN dialogs too. Mock backend: `MOCK_APP_VERSION = '0.6.0'`, refuses
   writes like the backend. Tests: 5 storage tests on the v2 fixture, 3 unit, 4 Vitest, 3 e2e
   (`e2e/shell.spec.ts`). Runbook section 8.
2. **Done:** tab bar (spec 3.5, V-05, V-12). Header 56 px on `--surface` with a `--border` line
   (`--topbar-h`; the `--header-*` tokens are gone); brand button (`#btn-about`) with icon +
   wordmark from `ui/src/assets/brand/` (copies of the design assets without the C2PA metadata;
   light/dark variants via `.theme-light-only`/`.theme-dark-only`); tab icons are the design
   boards' own paths (Lucide style; THIRD_PARTY_LICENSES.md notes it); active tab: 600, icon in
   `--accent-text`, 3 px underline, `aria-current="page"`. Admin: Leerlingen, Groepen,
   Opdrachten, Gebruikers, School, Gegevenscontrole, Instellingen. Sticky screen headers sit at
   `--topbar-h`. e2e: 2 tab-bar tests; the sticky test measures the bar. **Visual diff pending**
   (every screen's top bar changes).
3. **Done (before 3, the menu needs it):** one avatar helper (B-04, B-08):
   `components/avatar.ts` (`avatarHtml`, `renderAvatar`, `loadAvatarPhotos`, initials = afkorting
   or first letters of first and last name; round, square for admin / sectievoorzitter; ring =
   user colour, accent (top bar 38, editor 30) or none; photo as `<img>` over the initials, read
   through a 30 s cache) + `styles/avatar.css` (also imported by `editor.css`). Used by the
   login badges and Gebruikers (56), the top bar (38, accent ring), presence (30, with photo),
   the "nieuwe toets" notice (30) and the editor (B-08: the editor asks the main window
   `maatwerk-user-avatar` for the user and photo). `utils/badges.js` and the `.badge-initials` /
   `.user-badge-mini` CSS are gone. e2e: 2 avatar tests.
4. **Done** (`0b1d334`): user menu (F-17, spec 3.6), `components/user-menu.ts`: dropdown (280
   px, not a dialog) under the avatar; name + "Docent · <vak>" / "Sectievoorzitter <vak>" /
   "Beheerder"; Thema Licht/Donker; 21 accent swatches (7x3); Foto wijzigen (disabled, F-19
   later); Pincode wijzigen; Nieuwe herstelcodes (admin); Uitloggen (danger). Escape, a click
   outside or Tab out close it; focus back to the avatar. The account modal is gone (`pin.ts`
   `changePinFlow`, `renewCodesFlow`); ids `#acc-pin`, `#acc-codes`, `#acc-logout` kept. Visual
   views `user-menu-teacher`, `user-menu-admin`.
5. **Done** (`0b1d334`): look and active year per user (decisions 3 and 15, F-18, F-21, D7).
   Additive field `preferences: { theme, accent, activeYear }` in `gebruikers/<id>.json`
   (`domain/preferences.ts`); `Store.savePreferences` merges into the latest file (no rev check,
   so no conflict with an admin edit); `getConfigSync().activeYear` is the logged-in user's year,
   else config.json's, else the current school year; choosing a year on any screen sets all
   three selects and saves it; logout clears the selects and returns to the base look. The look
   is applied at login before `initSubject` and the main screen (`theme.ts` `applyUserLook`;
   `baseLook` = default, or the dev menu's choice in dev/mock builds). `Store.setActiveYear`
   (shared config.json, never called) removed. 0.3.x keeps unknown user fields (the Gebruikers
   form spreads the record, PIN commands edit the JSON object): Rust test
   `pin_writes_keep_preferences_and_unknown_fields`. Tests: Vitest preferences + store merge; 5
   e2e (menu, persist across logout, second PC with a seeded user file incl. active year, admin
   edit kept, admin menu).
6. **Done:** U11 fixed (`onclick` per Alles/Niets button; e2e fails without the fix), U13 and U16
   checked: superseded (quirks.md).
7. **Done:** R-05 for the shell, partly: the filter bar (~470 lines) moved verbatim from `app.js`
   to `shell/filter-bar.js` (app.js 1209 lines on `main` -> 789); app.js re-exports its getters. Both stay
   JS until Store is typed (backlog "From Step 15").
8. **Done:** version 0.6.0 (`22023dc`); gate green (`npm audit` with dev: the known
   eslint -> minimatch advisory, dev-only, `--omit=dev` 0; see `docs/testing.md`).
9. **Done:** review (`docs/reviews/step-15.md`): 0 blockers, 2 majors (read-only messages and
   banner while running; read-only browsing), both fixed with tests; most minors and nits fixed,
   rest in `docs/backlog.md` "From Step 15".
10. **Done:** user decisions (2026-11-05): no login without a PIN on a read-only app (fine, rare);
    a newer schema stops older apps at the start screen (fine, rare); tab icons are our own
    drawings (checked against Lucide, THIRD_PARTY_LICENSES.md updated). Visual diff OK; local
    baselines updated (117 views). Merged into `main`, tagged `step-15` and `v0.6.0`.

## Step 14a progress

1. **Done** (`5538f85`): `ui/src/components/dialog.ts` + `styles/dialog.css`: one dialog
   component (fixed top 64 px, centred, max height `100vh - 96px`, `fixedHeight`; sticky header
   with title/badge/subtitle/close/tabs; scrolling body; footer: right-aligned, primary last,
   `align: 'start'` for a navigational action; busy state on async buttons; per-dialog close
   guard and cleanups; stacking with one backdrop each; Escape on `window` in the bubble phase,
   skipped when a control inside called `preventDefault()`). `app.js` `showModal`/`closeModal`/
   `guardModalClose`/`onModalSync`/`onModalCleanup`/`modalRefresher`/`pushModalChart` act on the
   current modal (top of the modals opened through `showModal`/`openModal`; confirms do not
   count). `showModal` = legacy form (key `legacy`: replaces a legacy modal, stacks on a
   structured one; keeps ids `modal-box`/`modal-content`/`modal-close`). `confirmDialog`,
   `alertDialog`, `showReloadNotice` on the component. U15 (replaced modal runs its onClose),
   U14 (RTTI uitleg uses the shared guard; its inline confirm bar is gone), U12 (closing a dialog
   destroys its CustomSelects; `host._csel`), n8 (dev menu Escape). New behaviour: **Escape
   closes modals** (through the guard); before, only ✕ and the backdrop did.
2. **Done** (`a77cd39`): exam overview, rapport and group edit on `openModal` (structured header,
   tabs via `onTab`, `fixedHeight`, group edit footer). `openModal({ key })` replaces a modal
   with the same key (refresh in place). Skeleton helpers `components/skeleton.ts` +
   `styles/skeleton.css` (not used yet; areas use them, V-09 "14 + areas"). Sticky `.screen-head`
   (title row + filter row) on the five teacher tabs. `e2e/dialog.spec.ts` (34 tests).
   R-05 call: the three ported modal files stay JS (only their open call changed; their area
   steps 20/23/25 convert them), as with m7 in step 13.
3. **Done:** user OK on the 14a visual diff (2026-11-05); local baselines updated.

## Step 14b progress

1. **Done** (`fa77dd1`): every modal on `openModal` (title/subtitle in the header,
   `footerHtml` keeps the buttons' ids and listeners and arranges them; `onShow` gets the
   whole dialog element). `showModal`, the legacy ids (`modal-box`/`modal-content`/
   `modal-close`) and `dlg--legacy` are gone. Keys: `exam-edit` (new test step 1/2, inhaal ->
   editor), `student-edit`, `group-edit`, `group-overview`, `profile`, `exam-overview`,
   `rapport`, `opdrachten-genereren`. **Behaviour changes:** the profile stacks on the group
   overview (closing returns there; `backFn` removed, Vorige/Volgende in the footer); the
   account modal stays under "Pincode wijzigen"/"Nieuwe herstelcodes" (stacked);
   `modalRefresher` waits while its modal is covered. PIN submit buttons use `setBusy` (n6).
   Rule I applied: a danger/delete action is not in any footer yet (none of the forms has one).
2. **Done** (`6728884`): `components/form.ts` (`field`, `formRow`, `tickBox`, `toggleTick`) +
   `styles/forms.css`; form rows align on labels; PTA tick boxes; m4 (CustomSelect trigger and
   inline selects/textareas on the 3.2 look, now 36 px; question table dense 26 px); m3 (school
   field input on the base). 16 dead u-* removed (103 left: the rest live in the big modal
   files and go with their area steps 20-25, as R-05/m7). Form markup is not rewritten to
   `field()` everywhere: the CSS rule aligns every `.form-row`; the helper is used for the new
   tick-box fields. Steppers lining up across rows (board 14) is step 20.
3. **Done:** gate green (cargo fmt/clippy/test, lint, typecheck, 391 Vitest, licences, cargo
   deny, SPDX, `npm audit --omit=dev` 0); version **0.5.0** (`4797c2d`).
4. **Done:** review `docs/reviews/step-14.md`: 0 blockers, 3 majors (M1 covered modal got the
   wrong reload notice, M2 focus stayed on the opener, M3 tabs not keyboard-reachable), all fixed
   with tests (`914fa57`); m1, m5, m6, n1, n7 fixed; rest in `docs/backlog.md` "From Step 14".
   Every modal now has a `key`. Empty footers hidden (`69cdf07`, seen in the visual diff).
   e2e: 193 tests green.
5. **Done:** user OK on the 14b visual diff (2026-11-05) with two remarks, both fixed: the exam
   badge of Scores invoeren sits before the exam name in the subtitle line (`subtitleHtml` dialog
   option), and an unticked tick box shows a faint tick (`--border`; `--border-strong` on hover).
   Local baselines updated (111 views). Merged into `main`, tagged `step-14` and `v0.5.0`.

E2E: the editor test "a compile over the time limit" flaked once more under the full suite
(backlog).

## Fix 0.4.1 (2026-11-05, user report)

"Openen in PDF-viewer" in Opdrachten genereren / Rapport genereren wrote the PDF but Windows said
it could not find `\\?\...\data\rapporten\...pdf` (user's screenshot, not committed: it shows a local path).
Two causes: `print_pdf` resolved the copy's path against the data folder although the copy is
written next to it since step 7a (C18), and the canonical `\\?\` prefix went to ShellExecute.
`outputs::print_copy` now returns `PrintedCopy { rel, path }` (path in OS form,
`paths::os_path`); `openable_path` and `open_with_os` strip the prefix too. Regression test
`outputs::tests::printed_copy_path_is_the_written_file_in_os_form` (fails without the fix).

## Step 13 result

Phase 2 plan merged into `main` (`90e02a5`, pushed 2026-11-05). Sub-tasks per `PLAN-2.md` step 13:

1. **Done:** tokens (`ui/src/styles/tokens.css`: neutrals light/dark, 21 accents, grade, RTTI,
   type, radii, shadows, control sizes); `ui/src/domain/look.ts` + `ui/src/theme.ts` (dev/mock
   only menu, Ctrl+Alt+T, `localStorage` `maatwerk.dev.look`); `style.css` colours mapped to
   tokens (legacy `--primary`/`--radius`/`--shadow`/`--success` gone); `controls.css`
   (segmented control, accent swatch). Visual spec runs every view in light/blauw, dark and
   geel (`--dark`/`--geel` suffix). Pre-change baselines: 37/37 equal to `main`, copied to the
   session scratchpad.
2. **Done:** `ui/src/domain/format.ts` (`formatGrade`, `formatFixed`, `formatNumber`,
   `formatCompact`, `parseDecimal`, `parseDecimalLoose`) and `ui/src/domain/grade-colors.ts`
   (spec 2.3: text colours as theme-token mixes, bar colours hex, score-grid cell fills) replace
   the copies in ~15 files; `utils/grades.js` -> `utils/grades.ts`; `utils/colors.js` keeps only
   `examTypeColor` until sub-task 4. Rounding paths unchanged (B8 note in `quirks.md`). The
   score grid stays light in dark mode (token island) until step 25 (renumbered 2026-11-08).
3. **Done:** `ui/src/styles/buttons.css` (`.btn` + `--primary/--secondary/--text/--danger/
--icon/--icon-danger/--sm`, focus ring, disabled, `aria-busy` spinner) and
   `components/button.ts` `setBusy`. All ~100 buttons converted (PIN dialogs included);
   `.btn-primary/-secondary/-sm/-danger/-link/-sm-icon` CSS removed. Dialog footer order
   (primary last) waits for the dialog component (step 14).
4. **Done:** `controls.css`: inputs/selects/textareas as a zero-specificity (`:where`) base
   (36 px, `--border-strong`, accent focus ring), search field 220 px with magnifier, stepper
   (`.num-spinner`), toggle buttons (`.tog-btn`), filter chips (`.filter-btn`, active state),
   test-type badge (`.test-badge`, `domain/test-type.ts`: toets = accent, SE = anti; PO and
   diagnostic classes ready for step 20). `utils/colors.js` removed; `utils/spinners.js` ->
   `.ts`; `theme.ts` `cssToken` for chart colours. Question-editor table keeps dense controls (26 px).
5. **Done:** 9 unused `u-*` utilities removed (`u-w-32`, `u-h-32`, `u-mr-0`, `u-bg-dark` freed
   by this step; `u-align-bottom`, `u-border-b`, `u-p-3-6`, `u-text-left`, `u-tracking` already
   dead). 119 remain for later steps.
6. **Done:** user OK on the visual diff; local baselines updated (111 views: light/blauw, dark,
   geel). Gate green (cargo fmt/clippy/test, lint, typecheck, 385 Vitest, 124 e2e, 111 visual,
   cargo deny, npm licences, SPDX, `npm audit --omit=dev` 0).
7. Review `docs/reviews/step-13.md`: 0 blockers; M1 (charts in dark) fixed; m1, m2, m5, m6 and
   n1, n2, n4, n7 fixed; m3/m4 partly; rest in `docs/backlog.md` "From Step 13". R-05 rule
   (user-visible decision recorded here): JS files touched only for class renames or imports
   stay JS until their area step.
8. Version 0.4.0.

User decisions (2026-11-05): zwart accent in dark theme keeps the light fill (`#E7EAF0`, dark
text); B8 rounding unification stays in step 19. `editor.css`/`pdf-viewer.css` (own windows)
keep their colours until step 31 (renumbered 2026-11-08).

User review of the visual diff (2026-11-05), fixed: groep-edit Schoolsoort on one line; text in
inputs had no left padding (the `* { padding: 0 }` reset beat the zero-specificity base; base is
now element-level); toets-new and herkansing steppers aligned (108 px, no `u-w-90`); verzamelkaart
labels aligned (toggle groups and PTA box 36 px). Then (user): every control in a form row is 36 px (toggles,
jaarlaag/periode/subcategorie squares, schoolsoort/vak/docent toggles); question-editor table
stays dense (26 px toggles and selects). New `modal-md` (760 px) for Nieuwe toets,
verzamelkaart and Leerling bewerken.

## Phase 2 intake (earlier)

**Phase 2 (`PLAN-2.md`).** Cutover done by the user (2026-11). Intake in `ROADMAP.md` section 4;
design pass done (`docs/phase-2/design/`, rounds 1-5); step plan `PLAN-2.md` (steps 12-33).
Step 12 (triage) done 2026-11-04: decisions in `PLAN-2.md` section 1 and ADR-0010, triage in
`ROADMAP.md` 4.6. Step 13 done 2026-11-05. Before step 18 the user runs `validate-data`
on a copy of the real data folder.

Earlier: **Step 10 "Cutover readiness" done**, merged into `main` and tagged `step-10`. Waiting for the
user: the open questions below and the manual checks before the cutover. Phase 2 per
`ROADMAP.md` when the user says so.

## After the Step 10 manual test (2026-11-03, PR #6 merged, `v0.3.2`)

1. The user's results: `docs/reviews/manual-test-step-10.md`, all pass except **M-OPD-9**.
2. **M-OPD-9 fixed:** the editor's questions ("Herstel standaardversie", "Toch sluiten?" after a
   failed save) used `window.confirm`, which `tauri-plugin-dialog` makes async, so they never
   stopped anything. They now use the app's `confirmDialog` through `maatwerk-confirm`; ESLint
   forbids native `alert/confirm/prompt`; e2e tests emulate the async confirm. "Bekijk
   verschillen" shows for every existing `main.typ`/`lib.typ` ("Geen verschillen" when equal).
3. Remarks: new ROADMAP items F-05 (compile indicator), V-03 (smooth preview scroll), B-04
   (photo re-check). The M-LEER-3/M-GRP-3/M-TOE-6/M-ADM-1 comments repeat Step 6 (F-02, C18 done
   in 7a, photos in 7b): re-check M-TOE-6 and M-ADM-1 against the current checklist.
4. **No school year selected after a restart** (user, after retesting): `config.json` written
   by the migration/first-run setup has no `activeYear`; the reference's fallback to the current
   school year only covered a missing file. `Store.getConfigSync/getConfig` now fill it in
   (`ui/tests/store/active-year.test.ts`, e2e in `quirks.spec.ts`). No data change.
5. Version **0.3.2**. Gate green (cargo fmt/clippy/test, lint, typecheck, Vitest, 124 e2e,
   `cargo deny`, licences, SPDX, `npm audit`).

## Step 10 result

1. Robustness: watcher panic restarts with backoff, close waits at most 2 s (4b n6); batch job
   panic -> `BatchError::Panic` (5b n1); core opened off the main thread via `CoreSlot` (6b m6);
   snapshot claim re-checked after a 45 s settle, only our own claim released (7b m1).
2. Quirk B24: `nextQuestionId` (never reuses an id the exam had when the editor opened);
   Gegevenscontrole reports repeated question ids as a **warning**; saved exams not repaired.
3. Unexpected failures: panic hook (thread, location; backtrace with RUST_BACKTRACE), `internal`
   errors logged, UI errors logged (student file names redacted, one line each), Over Maatwerk >
   Probleem melden (log folder + open).
4. Security: U8 fixed and `innerHTML` audit; path fuzzing; Typst sandbox tests; `cargo deny` ok;
   `npm audit --omit=dev` 0; CSP unchanged; `/security-review` no findings
   (`docs/testing.md`).
5. Perf (`docs/perf.md`): 200-PDF batch 1.9 s / 171 MiB; `school` fixture 1x within budget, **4x
   2-3x slower than Step 7c** (unexplained, backlog).
6. Docs: README, `docs/architecture.md`, `docs/release.md`; CI uploads `maatwerk.exe.sha256` and
   builds on `v*` tags; runbook B24 note; ADR-0002 section 13 (drift check).
7. Review `docs/reviews/step-10.md`: 0 blockers; M1 (evidence) recorded, M2 fixed; m1-m5, n3-n5
   fixed; m3 rest, m6, n1, n2, n7 in `docs/backlog.md` "From Step 10"; n6 rejected.

## After Step 9 (user decisions 2026-11-03, PR #4 merged 2026-11-03)

1. **Published 0.3.1 as its own PR** (#4, `release/v0.3.1` -> `main`; CI green on `097cf31`).
2. **Quirk T31 fixed:** `main.typ` 2 applies `setup_extra(body)` as a show rule; the old
   `setup_extra()` form keeps its old behaviour (detected by a regex on `opdracht.typ`, files are
   not rewritten). New starter template, examples and AI context use `setup_extra(body) = body`.
   Unmodified `main.typ` 1 copies update silently (ProjectFile release row 2). Migration fixture
   `tests/fixtures/migrate/v2` updated (it holds the bundled main.typ and starter file).
   `main.typ` 2 also drops the leftover cursor-marker code (review 8b n4, user 2026-11-03):
   no `cursor` in `OpdrachtInputs`; `svg-preview-many-pages` golden tolerance 1 grey level.
3. **ADR-0009 accepted: option D**, an in-app assistant that runs the teacher's own AI CLI
   (Claude Code, Codex, Gemini, ...; detected on PATH, presets plus per-teacher override) in a
   temp copy of the opdracht folder, diff/accept in the editor. Every teacher, provider of their
   choice, no API keys, all four tasks, images per request with a warning. To be implemented in a
   later step (not scheduled yet).

## Before Step 9 (user requests 2026-11-02, on `release/v0.3.0-rc.1`, pushed to PR #3)

1. CI fix: `THIRD_PARTY_NOTICES.txt` lacked `@codemirror/autocomplete` and `@codemirror/lint`
   (Step 8b). PR #3 CI is green since.
2. Migration report: the migration screen lists every migration warning and every check issue
   (read-only Gegevenscontrole table, errors first), and `<backup> verslag.txt` next to the backup
   zip holds the same plus every change (`migrate::save_report`; app and `maatwerk-cli migrate
--apply`). Before, only the counts were shown (user's dry run: "0 fouten, 3 waarschuwingen").
3. PIN 4-8 digits (was 5-8).

## Step 9 result

Commits 6da2ddf..HEAD on `step/09-ai-seams`, gate green:

1. `maatwerk-core::assignment` (`Assignment::open` only on an opdracht folder, `check`,
   `render_pdf`, `export_lib`); `maatwerk-cli assignment check [--json] | render --pdf |
export-lib`. JSON schema `docs/schemas/assignment-check.schema.json` (+ generated sample).
2. `docs/assignment-format.md`, `docs/ai-context/assignment-authoring.md` (~2.5k tokens),
   `docs/assignment-examples/01..05` (a test checks they compile clean, plus the inline example).
3. `docs/adr/0009-ai-integration.md`: options A/B/C, constraints, seven questions. Nothing decided.
4. Review `docs/reviews/step-09.md`: 0 blockers; M1 (quirk T31, docs fixed), M2 (sandbox root),
   m1, m2, m4, m5, m6, m8 and most nits fixed; m3, m7, n6, n9 in `docs/backlog.md`.
5. Version 0.3.1 (Cargo workspace, `ui/package.json`).

## After Step 8 (user decisions 2026-11-01)

- Version `0.3.0-rc.1` (PLAN section 9 item 9: SemVer below 1.0 with release candidates, `0.3.0` at
  the cutover). Branch `release/v0.3.0-rc.1` with a PR into `main` for Steps 7 and 8 (CI).
- No compile debounce; new errors after 500 ms without typing; a save no longer hides a compile
  error. Keystroke -> preview 61 ms median (`docs/perf.md`).

## Step 8b result

Commits b98ac1d..HEAD on `step/08-editor`, gate green (291 cargo tests, 321 Vitest, 117 e2e,
cargo deny, npm licences, SPDX):

1. Core `LiveEditor`: coordinator + compile thread, **watchdog** (time limit from
   `instellingen.json` `editor.compileTimeoutSeconds`, 2-300 s, default 30; at most two abandoned
   compiles; the fresh session keeps the client's preview), `query`, `unset_file`,
   `current_document` (n7), `__maatwerk/` not editable (n4).
2. `typst-ide` 0.14.2: autocomplete, hover, definition, jumps from click/cursor (UTF-16), query
   text never stays in the buffer.
3. `lib.typ` v2 (`punten` in the vraag marker, output unchanged; migrate golden regenerated);
   `typst_svc::vragen`; `check_project_files` (silent update of unchanged old copies, CAS) and
   `restore_project_file`.
4. App: `src-tauri/src/editor.rs` (14 commands, `editor:update` event, one session at a time).
   Bridge + `MockEditor`.
5. UI: editor on the session (lint, autocomplete, hover, Ctrl+click/F12, preview <-> source,
   page patches, vragen panel, tabs `main.typ`/`lib.typ` with banner, Bekijk verschillen,
   Herstel standaardversie, BOM strip n8). Deps `@codemirror/autocomplete`, `@codemirror/lint`.
6. Instellingen: compile time limit.
7. `ui/e2e/editor.spec.ts` (7) + Instellingen e2e; `tools/perf/editor.mjs` on the release exe
   (182 ms keystroke -> preview median, compile 1-2 ms, memory flat over 300 edits;
   `docs/perf.md`); runbook rehearsal on the `school` fixture (log in the runbook).
8. Review `docs/reviews/step-08b.md`: 0 blockers; M1, m1-m4, m7, n2, n3, n5, n7 fixed; m5, m6,
   n1, n4, n6, n8 in `docs/backlog.md` "From Step 8b"; n9 not changed (reason in the review).

## Step 8a so far

1. `typst_svc::EditorSession` (commit 4376cc4): one long-lived `MaatwerkWorld` per open
   opdracht; `set_file` (buffer in memory, incremental reparse via `Source::replace`), `reset`
   before each compile (mount folders re-resolved, disk files re-checked by mtime + length,
   missing files looked up again); `compile(generation, stale)` returns `EditorUpdate`
   (`ok`, diagnostics, `preview_generation`, `page_count`, only changed `pages` as SVG + hash,
   `compile_ms`, `render_ms`); last good document kept; `resend_all`. `LiveEditor`: worker
   thread, debounce (`DEFAULT_DEBOUNCE` 150 ms, generation 0 at once), latest generation wins
   (stale result dropped before the SVG render), panics reported as an error update, drop stops
   the thread. `Location.range_utf16` for CodeMirror. Tests: 15 in `editor::tests`, parity test
   `editor_session_patches_equal_the_one_shot_render`.
2. `examples/editor_latency.rs`, `docs/perf.md` section, parity section, ADR-0002 section 12
   (cancellation deviation: open question).
3. Review `docs/reviews/step-08a.md`: 0 blockers; M1 (cursor marker) decided in ADR-0002
   section 12 (no marker in the live session; 8b uses typst-ide jumps); m1 (sink panic), m3
   (`refresh` / `reload_disk_files`), m4, m5, m6 partly, n1 fixed; m2, m6 rest, n2-n8 in
   `docs/backlog.md` "From Step 8a".

## Step 7a result

User decisions (2026-10-30): C10 = opaque ids for _new_ exams/groups only, existing ids kept;
C9 = `"N"` instead of `null`, invalid input stays the typed string. Format spec:
`docs/reference/data-files-v2.md`; ADR-0003 has C16-C19.

Done on the branch (`step/07-data-v2`, one commit each):

1. ADR-0003 C16-C19 + C9/C10 shapes; `docs/reference/data-files-v2.md`.
2. `maatwerk-core::integrity` (C19 stamp: SHA-256 of canonical JSON without `_meta.hash`).
3. `maatwerk-core::migrate` (plan -> verified backup zip outside shared/OneDrive folder -> apply
   -> `schema_version: 2` last; resumable; blocks on unmigrated legacy data / corrupt JSON).
   Golden fixture `crates/maatwerk-core/tests/fixtures/migrate/{v1,v2}`
   (`MAATWERK_UPDATE_GOLDEN=1` regenerates v2). Error codes `needs_migration`,
   `migration_blocked`. zip 9.1.3 + sha2 0.11 (cargo deny ok, notices regenerated).
4. `maatwerk-core::validate` (validate-data: version, corrupt, stamps, placement, conflict
   copies/strays, references, images, opdracht folders; Dutch messages).
5. CLI `validate-data`, `migrate --dry-run | --apply --backup-dir`; CI migrates the generated
   `school` fixture and validates it.
6. Storage/app on v2: v1 -> `needs_migration`; stamp on write, check on read (`stamp_issues`,
   `accept_stamp`); trailing newline; v2 seed; opdracht folders (`TypstProject::opdracht`,
   create/copy/delete folder, `read_opdrachten`); text CAS (C17); `rapporten/` next to `data/`
   (C18); commands `migrate_data_folder`, `validate_data_folder`.
7. UI on v2: `domain/v2.ts` codec at the Store boundary (in memory still `null` = N and a plain
   student array, so grades/reports unchanged); users per file + school rev check (C16); opaque
   ids (C10) with CSV group match by name; editor conflict bar (C17); migration screen at start;
   admin tab Gegevenscontrole + check at admin login. `tools/fixtures/to-v2.mjs` converts the
   mock fixture and the golden scenarios. All golden differences were format-only.
8. e2e updated (94 pass); `docs/cutover-runbook.md`; manual tests M-MIG-1..5, M-SYNC-5/6,
   M-START-3, M-TOE-6, M-OPD-1 updated; quirks B9/B21/B25/B26; parity rows.

## Step 6b summary

- Startup error screen (4b m5): commands `data_folder_status`, `restart_app`; UI
  `screens/startup-error.ts` (Dutch reason, folder, "Opnieuw proberen" = restart); quirks.spec.
- Start failure (no WebView2): main-thread panic hook + `build()` error -> Dutch `rfd` message
  box (`src-tauri/src/start_error.rs`); checked by hand with `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER`
  set to a missing folder (Tauri panics "Could not find the webview runtime" in the event loop).
- School logo input: six image types, Dutch toast otherwise (6a M1).
- `ui/e2e/real-pdf.spec.ts`: real rapport PDF (written by `typst_rapport`) in pdf.js under the
  CSP; CI step after `cargo test`.
- CI already built and uploaded the portable exe (since Step 0); new CI checks: no MockApi in the
  app bundle, real-PDF spec after `cargo test`.
- Docs: `docs/manual-test.md` (click-through, ids `M-…`), `docs/parity.md` complete (all 32
  handlers; manual ids linked), backlog "From Step 6b" (compat layer stays until Step 10).
- Review `docs/reviews/step-06.md`: 0 blockers, M1 (Tauri's English WebView2 box came first in
  release builds -> `wry::webview_version()` pre-check before Tauri, logging before Tauri) and
  m1-m5, n1-n9 fixed; m6, n10 in the backlog; drift notes in ADR-0002 section 11.
  `/security-review`: no findings. Release exe checked without WebView2: one Dutch box.

## Step 6a so far

- Core: `opdracht_images` (list with 48 px PNG thumbs, store/overwrite, copy, delete with
  background folder retry, empty-folder cleanup at start, clipboard RGBA -> PNG; quirk T30) and
  `outputs` (`OutputStore` in the OS cache dir under output IDs `<n>-<name>.pdf`, emptied at
  start; `print_copy` to `rapporten/<schooljaar>/<YYYY-MM-DD HHmm> <soort> <vak> <groep>
<toets>.pdf` with ` (2)` on a clash). `create_v1_opdracht_file`, `storage.write_bytes/list_dir`.
- App: commands `create_assignment_typ_file`, 7 image commands, `render_rapport_pdf`,
  `render_assignment_svg`, `render_assignment_batch` (+ `assignment:progress` event),
  `open_path` (output ID or data-relative path), `print_pdf`, `set_watch_year` (C7). Plugins
  dialog/clipboard/opener used from Rust only (no capability grants). URI scheme `maatwerk-out`
  (`scheme.rs`, CORS for the app origins). Error code `typst`. Presence offline on window
  destroy.
- UI: TauriApi complete (no stubs); `printPdf` + `setWatchYear` added to the bridge (mock too);
  print listeners use `printOutput` with `domain/print.ts` names; CSP `connect-src` has the
  scheme; pdf.js `isEvalSupported: false`; `setWatchYear` at `initSubject` and year selectors.
- Kept the current app icon (already the Maatwerk icon from the reference, step 0) instead of
  the older `_reference/build/icon.ico`; window config was already right; no splash.

## Fix between steps: bundled emoji font (`fix/emoji-font`)

- First CI run on `main` failed: `rapport_valid_matches_the_golden` p14, 1 pixel in 🥈 (the
  runner's Segoe UI Emoji differs from this machine's). User decided: bundle Noto Color Emoji now
  (PLAN section 9 decision 2) and regenerate the goldens with it.
- `assets::FONTS` + `NotoColorEmoji-COLRv1.ttf` (5 MB, OFL, `THIRD_PARTY_LICENSES.md`).
  `FontStore` drops its code points from system fonts' fallback coverage (`without_emoji`), since
  Typst's fallback preferred "Segoe UI Emoji" (shorter name). Checked: PDF (Type3 colour glyphs,
  Poppler render), SVG facts, PNG goldens with and without system fonts.
- Harness: temp `include/fonts` is a copy + Noto (junctions for the rest), PNGs with
  `--ignore-system-fonts`. Goldens regenerated: only PNG hashes/bytes changed. Tests use
  `support::fonts()` (no system fonts); tofu test uses a Tibetan icon (U+0F00).

## Step 5b summary

- `TypstProject` (`folder` for the CLI, `opdracht_v1` = virtual project: bundled `main.typ` and
  `lib.typ`, `opdracht.typ`, own `images/<id>/` only); `opdracht-main.typ` replaces the generated
  wrapper, data via `sys.inputs` `maatwerk-data` (`OpdrachtInputs`; placeholder only for preview).
- `render_assignment_pdf`, `render_assignment_svg_pages` (in memory), `render_assignment_batch`
  (workers `max(2, min(4, cpus-1))`, monotonic progress, first failure stops), `pdf_merge`
  (lopdf 0.46, duplex padding), tofu warning, `maatwerk-cli typst compile`, version lines +
  released hashes (`assets::ProjectFile`), cursor marker `__maatwerk_cursor`/`maatwerk-cursor:`.
- Parity: all opdracht/SVG/batch goldens (`tests/typst_opdracht.rs`, 24 tests); JPEG within 3
  levels; quirks T28 (1-based columns) and T29 (sandbox, v1 details). `docs/perf.md`: 30-student
  batch ~118 MiB. **Step 6 must** map Tauri args to `OpdrachtInputs`/`BatchJob` (label fallback
  `label ?? typFile`), run them in `spawn_blocking`, and call `normaliseForTypst` for the rapport.

## Step 5a summary

- `maatwerk-core::assets`: embedded `rapport.typ` (= `rtti_export.typ`, SPDX header, input
  guards), `rapport-main.typ` (entry, reads `data.json`), `lib.typ` (markers `__maatwerk_*`,
  counters `maatwerk-vraag*`), `base_assignment.typ` (unchanged); fonts Source Serif 4 (12) +
  STIX Two Math; packages zero/cetz/oxifmt/unify embedded by `build.rs` (`PACKAGE_FILES`).
- `maatwerk-core::typst_svc`: `MaatwerkWorld` (virtual files + `Mount`s behind
  canonicalise/prefix check, embedded packages only, injectable clock for `today()` and the PDF
  date), `FontStore` (template fonts, system fonts searched once via `FontStore::shared()`, then
  Typst's), `Diagnostic`/`Location`/`TraceFrame` + `to_text` (CLI-like, virtual paths only),
  `compile_document`, `compile_pdf`, `render_rapport_pdf(fonts, &RapportData, &DataDir, now)`.
- Parity: `tests/typst_rapport.rs` (12 tests) matches `rapport-one-student` and `rapport-valid`
  **pixel for pixel** (30 ppi) plus page count/sizes/text; no-watermark gives the same error.
- Quirks fixed template side: T26 (non-colour colours, non-number scores), T11/T27 (`$` guard on
  `uitleg_rtti` and leeradvies; only unescaped `$` count, review M2, also in the UI's
  `sanitizeTypstMarkup`). `rapport-markup` and `rapport-tiny` data now compile.
- Review M1: `normaliseForTypst` (UI) restores the `toTypst` values (`undefined` -> `null`,
  non-finite -> `0`) for the JSON payload. **Step 6 must call it** in `TauriApi.renderRapportPdf`.
- `deny.toml`: RUSTSEC-2026-0194/0195 (quick-xml via typst 0.14.2) ignored with reason; backlog.
- Watcher test `m1_a_failed_own_write_releases_the_file` was flaky (same-size content); test fixed,
  product edge case in the backlog.

## In progress

Nothing.

## Step 7c result

Commits 269a203..88b299f, gate green (109 e2e, 309 Vitest, cargo, deny, licences, SPDX):

1. `mw:*` spans (`ui/src/utils/perf.ts`), `tools/perf/measure.mjs` (release exe over the WebView2
   DevTools port, `--cpu 4`, `--admin 1`), baseline and results in `docs/perf.md`.
2. Kept list screens: `Store.generation()` + view key in `navigateTo`; score-modal close redraws
   the exam list only after a save.
3. Leerlingen: 60 cards at once, rest via `utils/idle.ts`, delegated clicks, delete checks
   admin-only, `content-visibility: auto` on cards.
4. `read_json_dir` command: `Store.preloadScores` reads a score folder in one call.
5. Memoised `Store.examResults`.
6. Score modal: first group at once, rest in idle; prebuild of the first group when the exam
   menu opens (no presence before the modal opens).
7. Docs: parity "Perceived speed", manual `M-PERF-1/2`, backlog "From Step 7c".

Result (4x CPU, school fixture): modal 209 -> 48 ms median, tabs within budget at the median,
first visit after login still above 100 ms p90 (backlog). 1x: everything < 25 ms.

Review `docs/reviews/step-07c.md`: 0 blockers; M1 (scroll on refresh), M2 (generation on every
colleague change), M3 (folder re-reads), m1-m4, n1, n3, n4, n6 fixed; m4/m5 rest, n2, n5 in
`docs/backlog.md` "From Step 7c".

## Step 7b result

- Nothing. **Step 7b done** and tagged `step-07b` on `step/07-data-v2` (not merged: the step branch
  merges into `main` at the end of Step 7). Review `docs/reviews/step-07b.md`: 0 blockers; M1
  (snapshot names), M2 (restore as CAS with fresh `_meta`), m2-m5, m6 (tests), n1-n3, n6, n7 fixed;
  m1 partly, n4, n5 in `docs/backlog.md`. Gate green (102 e2e). What 7b contains (ADR-0006):

- core `auth` (Argon2id `pinHash`, admin `recoveryCodeHashes`, throttle, login session in Rust),
  core `snapshots` (`instellingen.json`, CAS claim on `snapshots/state.json`, retention,
  single-file restore), CLI `admin reset-pin`, app commands + bridge (Tauri + mock), background
  snapshot at start.
- UI: PIN dialogs (`screens/pin.ts`, texts in `domain/accounts.ts`), account modal on the
  top-bar badge, Gebruikers (photos, "Pincode resetten", sectievoorzitters), sectievoorzitter
  badge and group rights, tab Instellingen, Gegevenscontrole "Herstellen uit snapshot", badge
  photos everywhere (`utils/badges.js`).
- Tests: Rust `auth::tests` (13), `snapshots::tests` (8), validate, CLI; Vitest; e2e
  `accounts.spec.ts` (8), all 102 e2e pass. Local visual baselines updated (badge photo,
  Gebruikers).
- Docs: data-files-v2, runbook sections 6-7, manual tests M-PIN/M-VZ/M-SNAP, parity, ADR-0006.

## Phase 2 planning (2026-11-03, PR #5 merged into `main`)

- `ROADMAP.md`: draft skeleton for after the cutover (rules without parity, intake list with
  F/B/V/R/X IDs, areas, step proposal, open decisions). `docs/phase-2/inventory.md`: quirks
  without a recorded fix, open backlog by theme, UI size and duplication.
- `PLAN.md` Step 10 rescoped to "Cutover readiness"; Step 11 (macOS) moved to the roadmap (X-04).
- Next: the user's triage session (ROADMAP P0) with their feature and visual lists.

## Next action (concrete, resumable)

0. Done: 0.3.2 merged (PR #6) and tagged locally; M-OPD-9 and the school-year fix re-checked by
   the user. Open: push `v0.3.2` (CI builds the release exe on the tag); re-check M-TOE-6 and
   M-ADM-1 with the current checklist wording.
1. User: the manual checks before the cutover: `docs/manual-test.md` M-OPD-2..11 in the real
   app, M-MIG-1..5, M-PIN/M-VZ/M-SNAP and M-PERF-1/2 on a copy of real data, M-SYNC-1..4 on two
   machines, and the runbook rehearsal on a copy of real data. Run `maatwerk-cli validate-data`
   on the migrated copy to see whether B24 duplicates exist.
2. User: decide the open questions below; then a release (`docs/release.md`) and the cutover
   (`docs/cutover-runbook.md`) when the user says so.
3. Phase 2 triage session (`ROADMAP.md` P0) in parallel.

## Open questions for the user

- When to schedule the ADR-0009 option D step (AI CLI assistant), relative to Step 10 and the
  cutover.
- Snapshot contents: photos (`fotos/`) are left out until M-SNAP-4 is measured on a real copy.
- Tag `v0.3.0-rc.1` (PR #3 merged 2026-11-01; not tagged yet).
- Push version tags (`v0.2.0-parity`, `v0.3.1`) to GitHub? So far only `step-*` tags are there.
- None blocking. Section 9 items still open: versioning policy (9), domain logic location
  (Step 10), macOS.
- **B24 repair (Step 10):** the user expects no duplicates in the real data (2026-11-03); no
  repair planned.
- **Perf at 4x (Step 10):** investigated 2026-11-03: the `step-07c` exe is as slow as `step-10`
  on battery, so likely the power state, not the code (`docs/perf.md`). User to decide after an
  optional re-run on mains power; then bump to `0.3.2` (user, 2026-11-03).
- **Release version:** `0.3.2` merged and tagged `v0.3.2` on `9c856d7` (local; pushing the tag
  waits for the user).

## How to resume

Perf measurement: `node tools/fixtures/generate.mjs school <dir>/shared/data`,
`target/debug/maatwerk-cli.exe migrate --apply --backup-dir <dir>/backups <dir>/shared/data`,
`npm run build:exe`, then `node tools/perf/measure.mjs --data <dir>/shared/data --cpu 4`.
Commit messages: from Git Bash (`git commit -F - <<'EOF'`); PowerShell `Out-File` adds a BOM.

After the folder move, release builds also needed `cargo clean --release -p maatwerk-core -p
maatwerk-app -p maatwerk-cli` (stale build-script path). PowerShell for npm/cargo (Git Bash's
`link` shadows MSVC's), but edit files with the editor or
Python, never `Get-Content`/`Set-Content` (they re-encode UTF-8). In PowerShell 5.1, commit with
`git commit -F <file>` (inline messages with quotes get split into pathspecs). `npm ci; npm run
build:ui`, then the gate commands in `CLAUDE.md`, plus `npm run test:e2e` (needs `npx playwright
install chromium` in `ui/`). Rapport parity: `cargo test -p maatwerk-core --test typst_rapport` / `--test typst_opdracht`
(machine-independent, no system fonts; failing pages are written to
`target/tmp/golden/<case>/`). Goldens: `npm run golden:check` (needs `_reference/` at `0e30a70` and
the Typst packages in `%LOCALAPPDATA%\typst\packages`). `cargo-deny` 0.20.2 and cargo-about 0.9.3 (`--features cli`) are installed.
