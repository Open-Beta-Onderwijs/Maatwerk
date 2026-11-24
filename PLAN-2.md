# Maatwerk: phase 2 plan (steps 12-45)

Phase 2 turns the intake in `ROADMAP.md` section 4 and the design in `docs/phase-2/design/` into
steps that each fit one Claude Code session of at most 5 hours (**M**), or two sessions with a
safe checkpoint in between (**L**, split into a and b). `PLAN.md` (phase 1, steps 0-11) is frozen
history. `ROADMAP.md` keeps the item lists (F, B, V, R, X); this file decides the order.

**Every session:** read this file sections 1-3, `docs/STATE.md`, then only the current step in
section 4. For visual work also read the design spec sections the step names, and the mock files
it lists. Do not read the whole roadmap or design spec.

## 1. Decisions (user, 2026-11-04)

| #   | Decision                                                                                                                                              | Source            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| 1   | Grade, statistics and attempt logic move to `maatwerk-core` (Rust), one implementation for screens, rapport and CLI                                   | ROADMAP 7.1       |
| 2   | Order: foundation first, then teacher-facing fixes, then the visual redesign per area, then the AI assistant                                          | user              |
| 3   | Theme, accent and editor divider position are stored per user in `gebruikers/<id>.json`                                                               | ROADMAP 7.7       |
| 4   | Every step is a 0.x release (next minor); 1.0 when this plan is done                                                                                  | ROADMAP 7.2       |
| 5   | Before the first data-format change, `school.json` gets a minimum app version; older apps refuse to write                                             | ROADMAP 7.4       |
| 6   | Diagnostic test = **D** box next to PTA (they exclude each other, D sets Weging to 0); a PO is its own kind with its own modal (F-20, designed later) | user, design 4.11 |
| 7   | The design spec (`docs/phase-2/design/README.md`) is the source of truth for the look                                                                 | design pass       |

Decided in step 12 (2026-11-04, `docs/adr/0010-phase-2-decisions.md`):

| #   | Decision                                                                                                                                                  | Source       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 8   | Manual test on a copy of real data only for steps that touch data or numbers (15, 18, 19, 20)                                                             | ROADMAP 7.3  |
| 9   | Old goldens stay as regression tests until a step intentionally changes that output; then the new output becomes the golden after the user's visual check | ROADMAP 7.5  |
| 10  | AI assistant in step 32                                                                                                                                   | ROADMAP 7.6  |
| 11  | Data v3 renames `fotos/` -> `afbeeldingen/` and `users/` -> `aanwezigheid/`                                                                               | ROADMAP 7.8  |
| 12  | Trend arrow: best attempt of the most recent counted test minus the weighted year average (as on the rapport); diagnostic tests ignored                   | ROADMAP 7.9  |
| 13  | Existing inhaal/herkansing tests get the original's observaties (copied, locked) in the v3 migration, shown as a before/after list first                  | ROADMAP 7.10 |
| 14  | Exam fields: `kind: "toets" \| "po"` and `diagnostic: true/false`; PTA stays `type: "pta"`                                                                | ROADMAP 7.11 |
| 15  | Active school year per user (F-21, quirk D7), stored with the theme                                                                                       | triage       |

Praktische opdrachten (PO) with rubrics (user, 2026-11-08; ROADMAP F-20, F-22, F-23):

| #   | Decision                                                                                                                                                                                                                                                                                 | Source |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 16  | A PO is graded with a rubric (new tab Rubrics). Grade = 10 × points ÷ max, between 1,0 and 10,0; whole points only; bonus categories count in the points, not in the max; diagnostic categories count in neither; no N-term                                                              | user   |
| 17  | Group and individual bonus/malus lines are in grade points (named, several allowed); student grade = group grade + group lines + own lines, between 1,0 and 10,0                                                                                                                         | user   |
| 18  | Projectgroepen (UI word; "Groepen" stays the classes): students of different classes may be together if they match the PO's vak, schoolsoort and jaarlaag; a student alone is a projectgroep of one; unplaced students get no grade; a member differs only through own bonus/malus lines | user   |
| 19  | Category scores, observaties and comments are the projectgroep's and are copied into every member's score file; a student moved to another projectgroep takes the new group's scores (with a warning), own lines stay                                                                    | user   |
| 20  | Rubrics are shared per vak (like observaties), "Dupliceren" makes a variant; once a PO uses a rubric, the categories' **max and soort** are locked (names, levels and observaties stay editable) and the rubric cannot be deleted                                                        | user   |
| 21  | A category has 2-5 levels (interval, optional title, explanation); intervals may overlap, never share a minimum or a maximum, and together cover 0 to the max without gaps                                                                                                               | user   |
| 22  | PO toevoegen lists rubrics with the same vak, a shared schoolsoort and the PO's jaarlaag; PTA and D as for tests; PO herkansing only (no inhaal): same rubric, projectgroepen copied and editable, best attempt counts                                                                   | user   |
| 23  | Observaties get a field `toetstypes` (`toets`, `po`, or both; existing ones `toets`); test modals list only `toets`, the rubric editor and PO grading only `po`, the Observaties tab gets a filter; opdracht bewerken is not filtered                                                    | user   |
| 24  | The PO score table is read-only, grouped by projectgroep; grading happens in its own modal (sliders, descriptions highlighted, category observaties and comments, overall comment, bonus/malus), saved automatically every 10 s and on closing                                           | user   |
| 25  | The Rubrics tab is for teachers and sectievoorzitters, not the admin; the PO rapport gets its own design round (step 24)                                                                                                                                                                 | user   |
| 26  | PO rapport (2026-11-12): an overview page, then the categories as level cards (variant A); no RTTI, no grade histogram; layout in step 24                                                                                                                                                | user   |

Overviews and profile (user, 2026-11-14; design rounds 8-11, boards 43-46; spec 3.10, 4.5, 4.6,
4.14, 4.15):

| #   | Decision                                                                                                                                                                                                                                                                                                                                     | Source |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 27  | Group overview: tabs Resultaten, Cijferverdeling, Boxplot, RTTI-analyse, Observaties (no Vraaganalyse); board 45 replaces the content of board 3                                                                                                                                                                                             | user   |
| 28  | Group overview Resultaten: JAAR "gem." is the weighted year average (decision 12, as card and rapport); an SE column only for groups whose tests count for an examendossier; one column per original test with the attempt that counts and the I/H resit dot right of the pill (pills stay aligned); a student without projectgroep gets "—" | user   |
| 29  | Grade tooltip on hover (group and PO overview): the student's observaties for that cell, plus attempt, projectgroep or category level; cells with observaties get a dotted underline                                                                                                                                                         | user   |
| 30  | Histograms everywhere use the program's bins (step 1 from 0,5; step 0,5 from 1,0), a count above every bar and a dashed line at 5,5; the 0,5 / 1 toggle only on "Alle leerlingen"; per-test cards in the group overview three per row                                                                                                        | user   |
| 31  | Boxplots: type colour, every student a dot, dashed 5,5 line                                                                                                                                                                                                                                                                                  | user   |
| 32  | RTTI charts skip PO's (with a note). RTTI-verloop: badges on the x-axis, y-axis in %, dashed lines, percentage at every point (labels kept 14 px apart), legend                                                                                                                                                                              | user   |
| 33  | RTTI names everywhere in the UI: reproductie, training, transfer, inzicht (R, T1, T2, I), as the rapport (F-26)                                                                                                                                                                                                                              | user   |
| 34  | Group overview Observaties: observaties alphabetically × test/PO badges, "n (p%)" with a heat tint, Totaal = times given this year; PO observaties count every member                                                                                                                                                                        | user   |
| 35  | Exam overview Resultaten: one table with a heading row per group and GEMIDDELDE/STANDAARDDEVIATIE under each group; icon and R/T1/T2/I columns stay; verzameloverzicht: I/H dot right of the grade, the last three tabs disabled as today                                                                                                    | user   |
| 36  | Exam overview: Cijferverdeling and Boxplot as decisions 30-31; Vraaganalyse restyled only; RTTI cards (all, per group) and the year verloop with this test highlighted; Observaties as three cards: all students, per group, per grade group (a vertical histogram card per observatie)                                                      | user   |
| 37  | PO overview (F-24): "Overzicht openen" on PO cards works; tabs Resultaten, Cijferverdeling, Boxplot, Categorieën, Observaties                                                                                                                                                                                                                | user   |
| 38  | PO overview Resultaten: one table "Per klas" (default, alphabetical) with a "Per projectgroep" toggle; columns per category, Punten, Bonus/malus, Cijfer; tooltip with level, observaties and grade build-up; average and SD per section                                                                                                     | user   |
| 39  | PO overview: distributions of the final grade only; Categorieën as a table with a stacked bar of students per level (overlapping levels count twice); Observaties as bars per category                                                                                                                                                       | user   |
| 40  | Student profile (F-25): restyle, same content. Cijferverloop as a bar chart without toetsgemiddelde (PO tooltip with categories); test and year comparisons as dot vs average with a ±1 SD band; Analyse with RTTI cards per test (PO's left out) and an observaties table per school year                                                   | user   |

Cards for Toetsen, Observaties and Opdrachten (user, 2026-11-17; design rounds 12-14, boards
55-58; spec 4.7, 4.16, 4.17):

| #   | Decision                                                                                                                                                                                                                                            | Source |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 41  | Toetsen becomes a card grid (F-27): per jaarlaag, three per row (column gap 36 px), the periodes continue in reading order with a "Periode N" label and a divider in the gap; a click on a card opens the overview, "Overzicht openen" moves into ⋮ | user   |
| 42  | Exam card: line 1 points, weging rapport and SE; line 2 points per RTTI category (none for a PO); mini histogram right; "n leerlingen" with the top observaties bottom left; average ± SD with % onvoldoende bottom right                           | user   |
| 43  | A test with resits is a stack: the Verzamelkaart on top, the attempt cards behind it (5 px steps right and down, fading), closed by default, remembered per session                                                                                 | user   |
| 44  | Opening a stack: a tray row under it, one rounded outline around Verzamelkaart and tray; the attempts slide down from under the Verzamelkaart, then spread (200 ms overlap); the tray is centred under the stack; only content below moves          | user   |
| 45  | Observaties and Opdrachten become cards too; Opdrachten opens a preview (PDF/SVG) on the right half while the cards move aside (F-28; design pending, boards 57-58)                                                                                 | user   |
| 46  | Observaties as cards (board 57): icon tile, toetstype pills, description, schoolsoort, jaarlagen boxes, use in tests and opdrachten; a click opens Observatie bewerken                                                                              | user   |
| 47  | Opdrachten as cards (board 58); a click opens the rendered PDF on the right half while the cards move to the left half in two columns; the selected card is outlined; Kopiëren and Openen in editor in the panel                                    | user   |

AI assistant (user, 2026-11-18; amends ADR-0009, see its "Amendment (step 32)"):

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                          | Source |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 48  | Multi-turn chat, one conversation per provider per opdracht (the CLI session is resumed); history kept per opdracht in local app data (never the shared folder), "Nieuw gesprek" clears it                                                                                                                                                                                                                        | user   |
| 49  | The rail shows only CLIs found on `PATH` (none: one "?" button with install help). Launch set: Claude Code, OpenAI Codex CLI (ChatGPT logo), Gemini CLI, and Mistral Vibe and GitHub Copilot CLI if research shows a usable non-interactive mode; DeepSeek dropped (no official CLI). Model: the CLI's own default (override via the command preset)                                                              | user   |
| 50  | The CLI works agentically in the temp copy: edits files, runs the bundled check, may use web search; other shell commands are denied where the CLI allows it. It may change only `opdracht.typ` and `images/`; changes to `main.typ`/`lib.typ` are dropped from the diff with a note                                                                                                                              | user   |
| 51  | Context, each a chip the teacher switches on or off, remembered per user per opdracht (defaults for a new opdracht): authoring guide and examples, opdracht metadata (title, vak, schoolsoort, jaarlagen, linked observaties), current diagnostics, rendered PDF pages, syllabus, other opdrachten (teacher picks 1-3, off by default), opdracht images (off; per request with the ADR warning, never remembered) | user   |
| 52  | Syllabus: PDFs in `syllabus/` next to the exe on Windows, in the app's local data dir on macOS/Linux ("Map openen" in the settings); preselected by vak and schoolsoort from the file name, changeable in a dropdown; the whole PDF goes into the temp folder                                                                                                                                                     | user   |
| 53  | Own attachments (paperclip, drag-and-drop, paste of images or text): max 25 MB per file, 10 per chat; an attached image the AI uses may be copied into `images/` on Toepassen (shown in the diff)                                                                                                                                                                                                                 | user   |
| 54  | No toets or score data as context, not even aggregates (ADR-0009 constraint 1 stays)                                                                                                                                                                                                                                                                                                                              | user   |
| 55  | While running: a compact status line, expandable to the full streamed transcript; Stop button; time limit 5 min by default (setting). The teacher may keep typing; Toepassen rebases the hunks on the current buffer and marks hunks that no longer fit as conflicts                                                                                                                                              | user   |
| 56  | Diff card: Bekijken (side-by-side diff with a PDF preview of the proposal), Toepassen per file or hunk, one undo step; saving stays the normal flow                                                                                                                                                                                                                                                               | user   |
| 57  | Empty chat shows starter buttons: Fouten oplossen (only with errors), Antwoorden en punten aanvullen, Herschrijven voor ander niveau, Nieuwe opgave toevoegen. Answers in Dutch; opdracht content in the opdracht's own language                                                                                                                                                                                  | user   |
| 58  | Entry points: the editor rail; Opdracht toevoegen "met AI" (creates the opdracht, opens the editor with the description as the first message); "Laat AI dit oplossen" after a failed Opdrachten genereren (opens the editor with a prefilled chat; the batch is rerun by hand)                                                                                                                                    | user   |
| 59  | Off switch per teacher, plus an admin switch for the whole school (additive `instellingen.json` field, see the answers under decision 75; reverses ADR-0009 answer 1). Settings via a gear in the chat panel: command and arguments per CLI (Standaard herstellen), time limit, syllabus folder                                                                                                                   | user   |
| 60  | Privacy and cost: a one-time notice per user on first use plus a permanent footer line under the input                                                                                                                                                                                                                                                                                                            | user   |
| 61  | Step 32 starts with a design round (context chips, attachments, status/transcript, diff view with hunk choice, settings, notices); tests use a scripted fake CLI, plus a manual check of each real CLI the user has before the release                                                                                                                                                                            | user   |

AI assistant design round (user, 2026-11-18; design round 15, boards 59-63; spec 4.8.1):

| #   | Decision                                                                                                                                                                                                                                                                                              | Source |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 62  | Rail and panel per board 59: monograms until the real logos; panel header with "Nieuw gesprek", the gear (AI-instellingen) and close; a dot on a rail button marks a provider with an open conversation (accent while it runs)                                                                        | user   |
| 63  | One AI run per opdracht at a time. While it runs, input, send and chips are disabled, the other conversations stay readable, and the editor stays editable with a bar saying the AI works on a copy                                                                                                   | user   |
| 64  | Chip names: Opdrachtinstructies AI, Opdrachtgegevens, Fouten & waarschuwingen, PDF-output, Syllabus: <naam> ▾, Andere opdrachten (n) ▾, Afbeeldingen. Afbeeldingen is never remembered: off by default, switched off again after each message, amber warning while on                                 | user   |
| 65  | Paste: an image becomes an attachment; text goes into the input and becomes a "Geplakte tekst" attachment from 2.000 characters. Unsupported types and files over 25 MB are refused with an inline error per file; at 10 attachments the paperclip is disabled with a message                         | user   |
| 66  | Status line: spinner, current step, elapsed / limit, a progress bar of the limit, transcript chevron, Stop. The transcript has collapsible steps (tool calls, edits, check output in monospace) and stays available after the run via a summary row                                                   | user   |
| 67  | A stopped or timed-out run keeps nothing (no partial proposal); the opdracht is unchanged. Error cards for not logged in, CLI error (last output lines), time-out (link to AI-instellingen), stopped, and no changes (the AI's answer plus a neutral note)                                            | user   |
| 68  | Diff card: Toepassen applies every non-conflicting hunk and the new images as one undo step, then shows "Toegepast …" with Ongedaan maken; skipped `main.typ`/`lib.typ` are listed struck through; the diagnostics left after the proposal are shown                                                  | user   |
| 69  | Voorstel bekijken (board 61): full dialog with a file list (tri-state checkbox per file, the image with its own checkbox), side-by-side hunks with a checkbox each, conflicts amber and skipped, Alles/Niets, "Toepassen (n)", and a PDF preview (Voorstel / Huidige versie) that follows the choice  | user   |
| 70  | First-use notice: a modal, once per teacher, with "Wordt verstuurd" / "Wordt nooit verstuurd", the own-subscription text, the image warning (also for the PDF-output) and "Begrepen"                                                                                                                  | user   |
| 71  | AI-instellingen are per teacher on this computer: show switch, one accordion card per CLI found (command, arguments, standaard/aangepast, Standaard herstellen), "Niet gevonden … · Installatiehulp", time limit 1-30 minutes, syllabus folder; conversations stay on this computer with the opdracht | user   |
| 72  | No CLI found: a dashed "?" rail button opens install help with all five CLIs and their install commands (Kopiëren), a Node.js note, Opnieuw zoeken and AI-assistent verbergen                                                                                                                         | user   |
| 73  | The school switch is in Beheer › Instellingen (an "AI-assistent" card below Editor), not on the School tab. Off: no rail, no AI option in Opdracht toevoegen, no "Laat AI dit oplossen"; the user menu item "AI-instellingen… · Uitgeschakeld door je school" is the only explanation                 | user   |
| 74  | Opdracht toevoegen: a switch card "Eerste versie laten maken met AI" with the description and the AI-programma select (installed CLIs only); the button becomes "Opslaan en AI starten"; the message is sent at once and the opdracht holds the empty template until a proposal is applied            | user   |
| 75  | "Laat AI dit oplossen": one card per failed opdracht with a student count only (never names); it opens the editor with the Fouten oplossen text and the error as an attachment, not sent until the teacher sends it                                                                                   | user   |

After the CLI research (user, 2026-11-18; ADR-0009 "CLI research"):

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                   | Source |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 76  | Antigravity CLI (`agy`) joins the launch set (six CLIs; the install help of decision 72 lists six). It cannot get per-run permission rules, so the check runs on Maatwerk's side with up to 3 fix rounds (ADR finding 9)                                                                                                                                                   | user   |
| 77  | "Eigen CLI": a teacher can add CLIs that are not in the list (name, command, arguments for the first and optionally later turns, the preset placeholders); plain-text output, Maatwerk-side check, no login detection, monogram on the rail; stored per teacher in local settings. Its card in AI-instellingen and the "Eigen CLI toevoegen" button extend board 62 in 32c | user   |

Open questions of the design round, answered (user, 2026-11-18):

1. **School switch storage:** an additive field in `instellingen.json` (the file behind the
   Instellingen tab), not `school.json`; this replaces that part of decision 59.
2. **Syllabus folder:** fixed, as decision 52 (`syllabus/` next to the app); the settings show
   the path read-only with "Map openen". The "Wijzigen…" button and the editable path in board 62
   are not built.
3. **CLI details:** the default arguments and install commands in board 62 are placeholders; the
   research sub-task confirms or replaces them. **Settled (research 2026-11-18):** the presets
   and install commands are the "Default args" and "Install" rows of ADR-0009 "CLI research"
   (they replace board 62's); Mistral Vibe and Copilot CLI qualify under decision 49; rows marked
   _verify_ are confirmed in the 32c manual check.

Road to 1.0 (user, 2026-11-21; new steps 35-45, ROADMAP F-29..F-32, X-09..X-11):

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                   | Source |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 78  | Score lock (F-29): a teacher changes scores only of students in groups whose `docenten` include them; other groups of the same exam are shown, locked. Only the scores are locked: every teacher of the vak still adds, edits and deletes exams as today                                                                                                                                                                                   | user   |
| 79  | Logged in as Sectievoorzitter or Sectiesecretaris, a teacher changes every score of that vak. A PO projectgroep may be graded by the teacher of any of its members; a student's own bonus/malus lines only by that student's teacher (or the voorzitter/secretaris)                                                                                                                                                                        | user   |
| 80  | Sectiesecretaris (F-30): a second role per sectie with exactly the voorzitter's rights; a dropdown next to Sectievoorzitter on the Gebruikers tab; a login group of its own                                                                                                                                                                                                                                                                | user   |
| 81  | Gastaccount (F-31): a checkbox per sectie on the Gebruikers tab, next to the two dropdowns. Checked, the login screen shows a Gast for that sectie that logs in without a PIN and reads **everything** of that sectie (student data included; the admin switches it on knowingly). It never writes, creates or deletes                                                                                                                     | user   |
| 82  | A Gast copies an Opdracht to another sectie with "Kopieer naar…": pick the target sectie, pick yourself as a teacher there, enter your PIN; the copy is made under that teacher's name; linked observaties (of the source vak) are dropped, with a note                                                                                                                                                                                    | user   |
| 83  | Grade numbers of the list screens are computed in Rust (backlog "Grade cache", part 1), then measured; a disk cache only if the measurement asks for it (where it lives is then decided with the user)                                                                                                                                                                                                                                     | user   |
| 84  | Typst is upgraded before 1.0 (X-01) in its own step, after the v1 code and goldens are gone; 1.0 ships without ignored advisories                                                                                                                                                                                                                                                                                                          | user   |
| 85  | `rapporten/` (X-06): Beheer › Instellingen shows its size and an "Opruimen" button that deletes printed copies older than a chosen school year, after a confirm. Nothing automatic                                                                                                                                                                                                                                                         | user   |
| 86  | PO verzameloverzicht (F-32) before 1.0: the PO overview with the attempt that counts per student and the I/H dot (as decision 35), after a short design check with the user                                                                                                                                                                                                                                                                | user   |
| 87  | 1.0 ships portable, as now (plus the step 16 bundles), but signing-ready: at the start of step 45 the user gets a to-do list for Windows and macOS signing, and the build is prepared so that signing later is only certificates and secrets, not a code change                                                                                                                                                                            | user   |
| 88  | The v1 (Electron) paths go at 1.0: v1 import and migration, v1 helpers, the compat layer, v1-only goldens and parity checks. v2 -> v3 migration stays                                                                                                                                                                                                                                                                                      | user   |
| 89  | AI CLIs not yet checked against the real program get a "bèta" tag in the rail and AI-instellingen until their manual check passes; 1.0 does not wait for them                                                                                                                                                                                                                                                                              | user   |
| 90  | (2026-11-23, replaces "no rule changes" in 83) The grades crate is the single source of truth for every grade number (CLAUDE.md rule). Where step 38's Rust numbers differ from today's UI (JS/WASM) numbers, Rust wins; every difference goes in a before/after table with its cause, shown to the user at the end of the step, without stopping the work                                                                                 | user   |
| 91  | Cijfergemiddelden (admin Instellingen, school-wide): per average, r (jaargemiddelde) and SE independently, a method (Afronden / Afkappen) and decimals (0 / 1 / 2). Default afronden 1 (today). Only student r/SE averages follow it; exam numbers stay afronden 1                                                                                                                                                                         | user   |
| 92  | Where the setting applies: Leerlingen cards (r, SE), Groepsoverzicht Resultaten (r, SE columns, both views), Profiel (r per school year, SE). Group numbers (Groepen card mean/SD/% onv., group overview footer, jaarlaag average, profile peers) use the student averages **as shown** under the setting (decision 21) and are shown at afronden 1. Pass/fail colour and % onvoldoende use the shown value (afkappen 0: 5,9 shows 5, red) | user   |
| 93  | Every affected student r/SE has a hover text with the setting ("Afgerond op 1 decimaal", "Afgekapt op 0 decimalen"), also at the default; group means get "Gemiddelde van de getoonde cijfers, afgerond op 1 decimaal". An existing tooltip gets the line added. The settings section is a table (rows Methode, Decimalen, Voorbeelden; columns r, SE) with 3-4 live examples per column                                                   | user   |

Choices made without the user (2026-11-21, tell the user if they bite): the rights of decisions
78-82 are enforced in the UI **and** in `maatwerk-core` (the session carries the role; the core
refuses a write the role does not allow), as the PIN already guards the shared PC this way; step
35 raises `minAppVersion` so an older app (which would ignore the lock) opens read-only; a Gast
saves no preferences (look and year come from the defaults); step 44 (TypeScript) comes after the
backlog steps because step 38 moves the grade numbers out of `store.js` first (steps 35-43 add
typed modules beside the JS files they touch, as before, instead of converting them).

The priority, size and step of every roadmap item and old quirk are in `ROADMAP.md` section 4.6.

## 2. Working rules

**Unchanged:** `PLAN.md` section 2 (session protocol 2.1, gate 2.2, review 2.3, git 2.4, hard
rules 2.5, stop and ask 2.6) and `ROADMAP.md` section 2 (goldens as regression tests, quirks
closed, `_reference/` is history, one area per step, data safety, a release per step).

**Session budget (5 hours):**

1. A session starts with `git status`, the baseline test run and reading this file and STATE
   (target: under 15 minutes). It ends with the tree green, committed, and STATE updated.
2. Sub-tasks are at most ~45 minutes each and end in a commit. The step lists them in order; if a
   session runs out, the next one resumes at the first unfinished sub-task (STATE "Next action").
3. Reserve the last ~45 minutes of the last session of a step for the gate, the reviewer
   subagent (fresh context, `docs/reviews/step-NN.md`) and the release.
4. If a step turns out bigger than its size, split it at a sub-task boundary (`step-NNa` tag),
   note it here, and stop to report. Never cut tests or the review to fit the budget.
5. Keep context small: subagents for broad reading, file ranges instead of whole files, never
   paste big outputs. The mocks are large: read only the board the step names.

**Per step, always:**

- **JS to TS (R-05):** convert the files the step touches, split files over ~500 lines into
  cohesive modules, and remove the area's compat-layer commands.
- **Visual baselines:** update `npm run test:visual` only after the user has seen the diff; the
  commit names the roadmap items.
- **Numbers:** any change to a grade, average, SD, percentage or rapport output gets a
  before/after table on the fixtures (`tools/fixtures`) and the user's OK before it is merged.
- **Data:** any change to saved data gets a migration or an additive field, a fixture test, the
  minimum-version guard, and a manual check on a copy of real data before the release.

## 3. Status (keep up to date)

| Step | Title                                                            | Size         | Release | Status |
| ---- | ---------------------------------------------------------------- | ------------ | ------- | ------ |
| 12   | Triage and open decisions                                        | S (user)     | -       | done   |
| 13   | Foundation a: tokens, themes, buttons, inputs, formats           | M            | 0.4     | done   |
| 14   | Foundation b: dialog component, placeholders, sticky, form rules | L (14a, 14b) | 0.5     | done   |
| 15   | Shell: tab bar, logo, user menu, theme per user, version guard   | M            | 0.6     | done   |
| 16   | Platforms: macOS and Linux                                       | L (16a, 16b) | 0.7     | done   |
| 17   | Rapport fixes                                                    | M            | 0.8     | done   |
| 18   | Data format v3                                                   | M            | 0.9     | done   |
| 19   | Domain logic in `maatwerk-core`                                  | L (19a, 19b) | 0.10    | done   |
| 20   | Toetsen: test kinds, attempts, test modals, resits               | L (20a, 20b) | 0.11    | done   |
| 21   | PO a: Rubrics, observatie toetstype                              | L (21a, 21b) | 0.12    | done   |
| 22   | PO b: PO in Toetsen, projectgroepen                              | L (22a, 22b) | 0.13    | done   |
| 23   | PO c: PO beoordelen                                              | L (23a, 23b) | 0.14    | done   |
| 24   | PO d: PO rapport                                                 | L (24a, 24b) | 0.15    | done   |
| 25   | Score entry                                                      | M            | 0.16    | done   |
| 26   | Login and splash                                                 | M            | 0.17    | done   |
| 27   | Leerlingen and Groepen cards                                     | M            | 0.18    | done   |
| 28   | Beheer screens                                                   | M            | 0.19    | done   |
| 29   | Overviews and profile                                            | L+ (29a-29c) | 0.20    | done   |
| 30   | Observaties and opdrachten                                       | M            | 0.21    | gate   |
| 31   | Opdrachten-editor                                                | M            | 0.22    | gate   |
| 32   | AI assistant                                                     | L+ (32a-32c) | 0.23    | gate   |
| 33   | Toetsen as cards                                                 | M            | 0.24    | gate   |
| 33b  | Perf hotfix: first tab visits, card swap clock, batch grades     | S            | 0.24.1  | gate   |
| 34   | Observaties and Opdrachten as cards, preview panel               | L (34a, 34b) | 0.25    | gate   |
| 35   | Rights a: own groups only, Sectiesecretaris                      | M            | 0.26    | done   |
| 36   | Rights b: Gastaccount, Kopieer naar…                             | M            | 0.27    | done   |
| 37   | PO completion: verzameloverzicht, PO backlog                     | M            | 0.28    | gate   |
| 38   | Grade numbers in Rust, Cijfergemiddelden                         | L            | 0.29    | gate   |
| 39   | v1 removal and Typst upgrade                                     | L (39a, 39b) | 0.30    | todo   |
| 40   | AI assistant follow-ups                                          | M            | 0.31    | todo   |
| 41   | Data and storage robustness, `rapporten/` cleanup                | M            | 0.32    | todo   |
| 41b  | Encrypted storage (ADR-0012)                                     | L (41b-a, b) | 0.33    | todo   |
| 42   | Tests and CI hygiene                                             | M            | 0.34    | todo   |
| 43   | Remaining backlog                                                | M            | 0.35    | todo   |
| 44   | TypeScript complete, compat layer removed                        | L (44a, 44b) | 0.36    | todo   |
| 45   | Signing-ready, dependencies, reviews, 1.0                        | L (45a, 45b) | 1.0     | todo   |

## 4. Steps

### Step 12: Triage and open decisions (S, user with Claude in chat)

Goal: every intake item has a priority and a step; the open decisions are taken.

- Fill in priority, size and area for each row in `ROADMAP.md` section 4, including the rest of
  `docs/phase-2/inventory.md` sections 1 and 3 (quirks: fix, keep or drop).
- Decide ROADMAP 7.3, 7.5, 7.6, 7.8-7.11 (see section 1). Record them in section 1 here and in
  `docs/adr/0010-phase-2-decisions.md`.
- Run `maatwerk-cli validate-data` on a copy of the real data folder and list the leftover
  folders and files for X-07 (no deletions yet).
- **Done when:** ROADMAP section 4 has no empty priority; section 1 here has no open item;
  STATE points to step 13.

### Step 13: Foundation a (M)

Items: R-03 (start), V-01, V-06, F-18 (CSS only), R-01, B8. Design: spec sections 2 and 3.1-3.2;
boards 1 and 4 (`Main.dc.html`, `Knoppen.dc.html`).

1. `ui/src/styles/tokens.css`: neutrals, 21 accents (`html[data-accent]`), light and dark
   (`html[data-theme]`), grade colours, radii, shadows, type scale. Theme and accent switchable
   from a dev-only menu for now.
2. One `formatGrade` / number format module (decimal comma, always one decimal: `7,0`) and one
   grade-colour module; replace the ~10 copies (B8, R-01). Unit tests.
3. Button component (primary, secondary, text, danger, icon; 36/30 px; focus, busy, disabled);
   replace every button style, the PIN buttons included.
4. Inputs, selects, steppers, segmented control, filter chips (active state), test-type badge
   (V-11 component; only toets and SE until step 18).
5. Remove the `u-*` utilities replaced so far; the rest go in later steps.

Tests: unit (formats, colours); visual baselines in light/blue, dark, and yellow (contrast edge
case). Stop and ask: visual diff before updating baselines.

### Step 14: Foundation b (L)

Items: R-02, V-08, V-09, V-10, U12, U14, U15, 8b m6. Design: spec 3.3, 3.4, 3.7-3.9; board 3.

- **14a:** the dialog component (fixed top 64 px, optional fixed height, sticky header slot with
  tabs, scrolling body, footer with the button rule, close guard, Escape, stacking); confirm and
  alert dialogs on it; skeleton helpers (pill, line, block; reduced motion); sticky screen headers
  on all five teacher tabs. Port three modals as the pattern (exam overview, rapport, group edit).
- **14b:** port every other modal; form-row helper for the label-aligned layout (3.7) and tick
  boxes (3.9); remove the old modal code and remaining `u-*` utilities in the touched files.

Tests: e2e: every modal opens at the same top; Escape closes; stacked dialogs keep their close
guard; a lazy modal does not change size while loading.

### Step 15: Shell (M)

Items: V-05, V-12, F-17, F-18 (persistence), F-21, B-04, B-08 (avatar helper), U11, U13, U16, decision 5. Design: spec
3.5, 3.6, 5; boards 1, 8, 12 (tab bar); `docs/phase-2/design/assets/`.

1. **Minimum app version** in `school.json` (`minAppVersion`); an older app opens read-only with a
   clear message. Test on fixtures; document in the runbook.
2. Tab bar: logo assets, tab icons (Lucide paths, ISC, add to `THIRD_PARTY_LICENSES.md`), active
   state; the admin's seven tabs with their icons.
3. User menu dropdown (theme, 21 accent swatches, foto wijzigen placeholder, pincode wijzigen,
   uitloggen).
4. Theme, accent, active school year (F-21) and (later) editor split in `gebruikers/<id>.json`
   (decisions 3 and 15): additive fields;
   check that 0.3.x keeps unknown fields when it saves a user (if not, the version guard covers
   it). Applied at login, before the first paint of the main screen.
5. One avatar helper (photo or initials, ring colour, round or square) used everywhere.

Tests: e2e theme/accent persist across logout and on a second "PC" (second data dir copy);
version guard e2e.

### Step 16: Platforms: macOS and Linux (L)

Items: X-04 (old `PLAN.md` step 11), new: Linux. Placed right after the foundation and the shell,
so every later visual step is checked on WebView2, WebKit (macOS) and WebKitGTK (Linux) through CI.

- **16a macOS:** CI job and universal build (`universal-apple-darwin`); WebKit check of the score
  grid, Chart.js, CodeMirror, pdf.js, the dialog component, sticky headers and the tab bar; a
  **first-run "choose data folder"** stored in the local config (a `.app` cannot reliably keep
  its data beside itself; also useful on Windows); fonts and emoji; signing and notarisation
  decision with the user (Apple Developer account) or documented right-click > Open instructions.
- **16b Linux:** CI job and build (AppImage and/or `.deb`); WebKitGTK check of the same list;
  **case-sensitive paths**: tests for a Windows-made data folder with mixed case (path helpers,
  migration, `validate-data`); document how the shared folder syncs without an official
  OneDrive client (rclone or a third-party client), as a choice for the user.
- From here on, the e2e and visual tests run on all three platforms in CI; visual baselines per
  platform where rendering differs.

Stop and ask: the signing decision; the Linux sync advice before it goes into the README.

### Step 17: Rapport fixes (M)

Items: B-06, B-07, F-13, F-04, T4, T7, T8, T10, T25 (per the step 12 triage). Area: Rapport.

1. Failing tests first for each bug; then the fixes in `rapport.typ` / `domain/rapport.ts`.
2. Duplex: when the leeradvies table reaches page 3, add an empty page 4.
3. Score dots larger only when the exam has half points.
4. Typst warnings shown in the rapport and generate modals.

Stop and ask: the Typst golden diffs (PNG) for every changed rapport.

### Step 18: Data format v3 (M)

Items: X-07, D20, decisions 6, 11, 13, 14, F-12 (data part), F-14 (data part). Data safety rules
apply in full. **Before the step:** the user runs `maatwerk-cli validate-data` on a copy of the real
data folder and shares the list of leftover folders and files (no student data).

1. `fotos/` -> `afbeeldingen/` (rapport mount `/data/afbeeldingen`), `users/` -> `aanwezigheid/`
   test kind and diagnostic fields with defaults (`kind: "toets"`, `diagnostic: false`), the observaties-on-
   resits field (copy at creation, locked), the opdracht link "score on question N below X".
2. Migration v2 -> v3 in `maatwerk-core::migrate`, `validate-data` updated, leftover folders
   listed and removed only after the user confirms. `schema_version` 3; `minAppVersion` raised.
3. Fixtures and the migration fixture updated; the existing migration tests extended.

Stop and ask: before running the migration on the copy of real data; before deleting leftovers.

### Step 19: Domain logic in `maatwerk-core` (L)

Items: R-04, B-02, B-03, B1-B8, B12-B19, B28-B31 (per triage), F-08 (trend helper), decision 7.9,
T9 (moved from step 17, user 2026-11-07).

**The rules are the user's decisions in `docs/phase-2/step-19-grade-rules.md` section 6.**

- **19a:** port attempts (best attempt), grade calculation, averages (weighted, SE), SD,
  percentages, RTTI statistics and the trend helper to a pure crate `maatwerk-grades` (re-exported
  by `maatwerk-core`) with unit tests; WebAssembly for the UI instead of Tauri commands (user,
  ADR-0011); the CLI gets `stats` for checking. The UI still uses its own code.
- **19b:** switch every screen, the rapport and the score grid to the core; delete the four JS
  implementations (B13); fix the B items as decided. T9: the histogram and ranking thresholds
  and texts agree (the ranking moves to the core with the other rapport numbers). Before/after
  tables for every number or text that changes, user approval before the merge.
- **PO (decision 16):** the core's statistics know `kind: "po"` (grade from the rubric points,
  no RTTI, counted with its weging and weging SE like a test); the PO grade function itself comes
  with step 21a.

### Step 20: Toetsen (L)

Items: V-11, F-12, B-05, B-01 (check) (the "+ PO toevoegen" button is step 22),
D5 of the implementation plan. Design: spec 2.5, 4.7, 4.11; boards 11, 14.

- **20a:** exam list (cards, badges, kind pills, legend, attempts tree open by default, lock pill);
  Nieuwe toets (steps, PTA and D boxes, aligned grid) and Toets bewerken (one top row, sticky
  question heading, solid segmented buttons, RTTI totals with percentages).
- **20b:** Nieuwe poging modal (Soort poging cards, Beschrijving filled and locked; observaties
  copied and locked); the summary overview shows observaties of resits (B-05).

### Step 21: PO a: Rubrics and the observatie toetstype (L)

Items: F-22 (rubrics), F-23 (toetstype), decisions 16, 20, 21, 23, 25. Design: spec 4.13 (Rubrics),
4.12 (toetstype field); boards 15, 16. Data safety rules apply (additive change within v3,
`minAppVersion` raised to this release).

- **21a, data and core:** `rubrics/<id>.json` (schema, `_meta`, CAS + rev like observaties):
  `{ id, naam, beschrijving?, subject, schoolsoort[], jaarlagen[], obs_ids[], categories: [{ id,
naam, max, soort: normaal|bonus|diagnostisch, obs_ids[], niveaus: [{ min, max, titel?, uitleg }]
}] }`. Core: level validation (2-5 levels, integer bounds, no shared min or max, cover 0..max
  without gaps), "in use" = referenced by any exam in any year, PO grade function (decision 16).
  Observatie field `toetstypes`; the migration step writes `["toets"]` where it is absent.
  `validate-data` knows both. Fixtures with three rubrics and PO observaties. Bindings, CLI
  `rubric check`.
- **21b, UI:** Rubrics tab (icon, for teachers and sectievoorzitters), rubric cards (categories as
  chips, totals, "In gebruik bij n PO's"), rubric editor (fixed-height dialog; per category name,
  max, soort, levels with the number-row display and live validation, category observaties of
  type PO; general observaties; Opslaan blocked while invalid; lock per decision 20), Dupliceren,
  delete guard. Observatie bewerken gets Toetstype; the test modals and the score grid list only
  `toets` observaties; the Observaties tab gets a toetstype filter chip.

Tests: unit (validation edge cases: touching intervals, overlaps, shared bounds, gaps, max change
on a locked rubric), e2e (create, edit, lock, duplicate), visual baselines after review.

### Step 22: PO b: PO in Toetsen and projectgroepen (L)

Items: F-20, F-22 (PO part), decisions 17, 18, 22. Design: spec 4.13; board 17.

- **22a:** exam `kind: "po"` with `rubric_id` and `projectgroepen: [{ id, naam?, student_ids[] }]`
  (no questions, no N-term); "+ PO toevoegen" next to "+ Toets toevoegen"; step 1 like Nieuwe
  toets with the filtered rubric dropdown, its category preview and the grade formula; PO card
  (striped badge, SE anti colour, the rubric line instead of RTTI, mean ± SD), the same ⋮ menu
  as a test; PO bewerken.
- **22b:** step 2 projectgroepen: unplaced students of all matching classes (class filter), groups
  with optional names, "lln"/"ll" counts, add by click or drag, "+ Projectgroep", "Willekeurig
  indelen…" (group size n, from the unplaced students), empty groups removed on save; regrouping
  later (decision 19, warning); PO herkansing (same rubric, groups copied and editable).

Tests: e2e for both steps including students of two classes in one projectgroep; core tests for
the PO grade in averages (with step 19's statistics: no RTTI for a PO).

### Step 23: PO c: PO beoordelen (L)

Items: F-22 (grading), decisions 17, 19, 24. Design: spec 4.13; board 18.

- **23a, score table:** read-only table grouped by projectgroep (sticky group headings with
  "Beoordelen" and status), categories as slanted headings with their max, Punten, Groep ±,
  Eigen ±, Cijfer; double-click a row opens the grading modal; "Projectgroepen" and
  "PO bewerken" in the header; unplaced students listed without a grade.
- **23b, grading modal:** per category the level cards (all levels whose interval contains the
  value are highlighted), slider, category observaties (type PO) and a comment; overall comment;
  group and individual bonus/malus lines; general observaties and live grades in the footer;
  Vorige/Volgende; autosave every 10 s and on closing (CAS per member file; conflict message).
  Score file: `scores[examId][categoryId]`, general observaties as for tests, and
  `po[examId] = { projectgroep, categoryObs, categoryComments, comment, groupLines, ownLines }`.
  PO grades in the averages, student and group cards, overviews; opdrachten genereren for a PO
  uses the general and category observaties.

Stop and ask: the before/after table for averages that now include PO grades.

### Step 24: PO d: PO rapport (M)

Items: F-22 (rapport), decision 26. Design: spec 4.13 ("PO rapport"); boards 19 and 20
(`PORapport1.dc.html`, `PORapportA.dc.html`). Boards 21-24 are the variants B-E that were not
chosen (history). The mocks use a stand-in serif and a "logo" placeholder: the template keeps the
fonts, colours and unicorn logo of `rapport.typ`.

- **24a, data and template:** `rapport-po.typ` beside `rapport.typ`, sharing its page setup,
  header, footer (page number, title, logo), section labels (9pt italic grey), zebra tables and
  the lollipop `scale_track`; no RTTI parts, no histogram. `data.json` for a PO built in core
  (the step 19 logic): student, projectgroep (name, members with class), points, max, group
  grade, group and own bonus/malus lines, final grade, per category (name, soort, max, score,
  PO average, levels, comment, observaties with name, short description and leeradvies), general
  observaties, overall comment.
  - **Page 1, overview:** title "Beoordeling <vak> <PO-naam>", subtitle "<klas> — <naam>
    (<leerlingnummer>)"; one sentence with points, percentage, group grade and the final grade in
    bold; "Projectgroep <naam>" as one line of names with classes ("Sem Dijkstra (5A), Emma Kok
    (5A) en Bas Vos (5B)", the student first); Scoretabel with one row per category: Categorie,
    B / D, Jij (●), the lollipop on one scale up to the largest category max (colour by
    percentage, dashed to the category max, ◇ at the average), Gemiddeld (◇) over all students
    of the PO; no Totaal row (user, 2026-11-12) and the footnote; "Bonus / malus"
    (Voor: Projectgroep / Persoonlijk, Omschrijving, Cijfer); "Opmerking van de docent". A
    section without content is left out.
  - **Category pages (variant A):** "Beoordeling per categorie"; per category a heading (name,
    "bonus" or "diagnostisch", score / max) and the level cards side by side (range, optional
    title, explanation), every level whose interval contains the score outlined in blue; then
    "Opmerking:" and per observatie the icon, **name** — short description, with "Leeradvies:"
    and the advice on the next line. Last "Algemene observaties" in the same form. The
    categories flow over as many pages as needed; a category block is never split.
  - **Duplex:** as the toets rapport, every student starts on an odd page.
- **24b, flow and goldens:** "Rapport genereren" for a PO (per student, per class, batch, as for
  a test); unplaced students get no grade, so no rapport (named in the result). Fixture PO
  (projectgroep of 3 with group and own lines, a group of 1, a bonus and a diagnostic category,
  overlapping levels, a category with 5 levels, a category without comment or observaties, a
  rubric long enough for two category pages) and golden PNGs. Stop and ask: the golden PNGs.

### Step 25: Score entry (M)

Items: F-03, B4, B5, U5 (if not done in 19b), spec 4.10; board 13. Restyle, centred content,
header row with **?** first, sticky group heading, column headings and # / Naam columns, grade
cell colours, GEMIDDELDE and SD per group. Keyboard behaviour and saving unchanged
(`score-grid.spec.ts` stays green).

### Step 26: Login and splash (M)

Items: V-04, F-06, F-19 (crop modal shared with step 28). Design: spec 4.1, 4.2; boards 5, 6.
Splash inline in `index.html` (window background set in the Tauri config, no white flash); login
states with the FLIP avatar animation, inline PIN (one or two fields), reverse on "Andere
gebruiker", keyboard flow, reduced-motion fallback.

### Step 27: Leerlingen and Groepen cards (M)

Items: F-07, F-08 (UI), F-09, V-02. Design: spec 4.3, 4.4; board 1. Student cards (variant C, SE /
laatste swap in CSS), group cards (variant B), admin keeps the list. Stop and ask: the numbers on
the cards (before/after on fixtures).

### Step 28: Beheer screens (M)

Items: spec 4.9, F-02 (CSV example), F-19 (photo crop), D28, X-06 (if decided). Board 12.
Gebruikers (card actions order, Gebruiker bewerken with Afkorting + Kleur swatches and the crop),
School, Gegevenscontrole (findings as cards with actions), Instellingen (units, snapshot list),
CSV import example.

### Step 29: Overviews and profile (L+, three sessions)

Items: F-10, F-11, F-24 (PO overview), F-25 (profile restyle), F-26 (RTTI names), V-11 in charts;
checks only: B-05 (fixed in step 20b), B15 and B16 (fixed in step 19, `quirks.md`). Decisions
27-40. Design: spec 2.6, 3.10, 4.5, 4.6, 4.14, 4.15; boards 43-46 (`POOverzicht.dc.html`,
`Profiel.dc.html`, `Groepsoverzicht2.dc.html`, `Toetsoverzicht.dc.html`). Boards 25-42 are
history: do not read them. R-05: `toets-overzicht.js` (1232 lines), `groep-leerlingen.js` and
`profiel.js` (1091 lines) to TS, split into cohesive modules.

The split changed (2026-11-14): the four modals share the chart parts of spec 3.10, so those come
first; the PO overview is new. Each part is one session and ends in a `step-29a/b/c` tag; one
release 0.20 at the end.

- **29a, shared parts and the group overview**
  1. Overview components per spec 3.10 (e.g. `ui/src/overview/`): histogram card (bins from
     `maatwerk-grades` `histogram` via WASM; counts; 5,5 line; Stapgrootte toggle), boxplot with
     dots, RTTI-verloop (badges on the axis, % axis, dashed lines, labels kept apart, legend),
     RTTI card, observatie bars, grade tooltip, resit dot, group-section rows with average and
     SD. Unit tests: bins and labels, label spacing, section stats.
  2. RTTI names (decision 33): one constant module; replace "toepassen bekend/nieuw" in the UI.
  3. Group overview modal (spec 4.5), `groep-leerlingen.js` to TS: five tabs, lazy with
     skeletons, SE column rule, PO column, Observaties with toetstype fit.
  4. Stop and ask: a before/after table on the fixtures for the new numbers (SD row, SE average
     column, RTTI over the year, observatie counts "n (p%)").
- **29b, exam overview** (spec 4.6): `toets-overzicht.js` onto the 29a components and split
  (R-05); one table with group sections and a footer per group; Vraaganalyse restyle; RTTI cards
  and verloop; the three observatie cards (per grade group with `grade_group`); verzameloverzicht
  (resit dot, disabled tabs). Check B-05.
- **29c, PO overview and profile:** the PO overview modal (spec 4.14) and "Overzicht openen" on
  PO cards (remove `PO_OVERVIEW_LATER`); a PO herkansing opens the same overview for its own
  attempt (a PO verzameloverzicht is not designed: backlog). The profile restyle (spec 4.15),
  `profiel.js` to TS; check B15 and B16 against the step-19 rules.
- **End of step:** gate, review, stop and ask for the visual check before updating the
  baselines, release 0.20.

**Done when:** the four modals match boards 43-46 in both themes; e2e covers tab switching, Per
klas / Per projectgroep, the Stapgrootte toggle, the tooltips and the verzameloverzicht; the user
approved the numbers table.

### Step 30: Observaties and opdrachten (M)

Items: F-14 (UI), F-15, T23 (moved from step 17, user 2026-11-07), spec 4.12; board 15. Observatie bewerken with the icon picker (200+ emoji,
categories, search); opdracht bewerken; opdrachten genereren with the new link type (`opdrachtenVraag`: a score
below X or `N` matches, an empty score not; data-files-v3); the batch
reports every failed opdracht, not only the first (T23).

### Step 31: Opdrachten-editor (M)

Items: V-07, F-05, F-16, V-03, T19/T20 (if kept), U10. Design: spec 4.8; board 10. Header and back
button, toolbar on top with dropdown groups, file tabs below it, status pill, draggable divider
(saved per user), smooth preview sync.

### Step 32: AI assistant (L+, three sessions)

Items: F-01, Step 9 m3 (time limit on the headless check/render), ADR-0009 option D as amended,
decisions 48-77. Design: spec 4.8.1, 4.9; boards 59-63.

- **Design round (done, user OK 2026-11-18):** design round 15, boards 59-63
  (`AIChat`, `AIContext`, `AIDiff`, `AIInstellingen`, `AIStart` in `docs/phase-2/design/mocks/`),
  decisions 62-75 and the answers under them; spec 4.8.1 and 4.9 updated. Read only the
  board a sub-task needs: 59 and 60 for 32b, 61 for the diff view, 62 and 63 for 32c.
- **Research:** the non-interactive invocation, streaming output, session resume, permission and
  web-search flags and image input of each launch CLI (decision 49); record in ADR-0009.
- **32a (bridge, no UI):** CLI detection and presets with per-user overrides (local settings),
  temp workspace (copy, context assembly per chip, syllabus, attachments, bundled check command),
  async process with streamed events, time limit and cancel (also for headless check/render),
  per-provider session and local history, result as a diff restricted to `opdracht.typ` and
  `images/`, hunk rebase onto the current buffer with conflicts. Scripted fake CLI for tests.
- **32b (editor UI):** rail and chat panel (spec 4.8), context chips remembered per user per
  opdracht, attachments (picker, drop, paste, limits), status line with expandable transcript,
  Stop, starter buttons, diff card with Bekijken (diff + PDF preview) and Toepassen per file or
  hunk as one undo step.
- **32c (rest):** AI settings dialog (gear), teacher and admin off switches (admin switch on
  Beheer › Instellingen, additive `instellingen.json` field, version guard, fixture test), first-use notice and footer, Opdracht toevoegen
  "met AI", "Laat AI dit oplossen" after a failed batch, provider logos per their brand rules in
  `THIRD_PARTY_LICENSES.md`, manual check with real CLIs, gate and review.

### Step 33: Toetsen as cards (M)

Items: F-27. Decisions 41-44. Design: spec 4.7 (and 3.10 for the histogram bins); boards 56 (card
and a stack with three attempts) and 55 (two attempts). Boards 47-54 are history.

1. Card component for a test, PO and attempt (spec 4.7): the two lines, the mini histogram (bins
   from `maatwerk-grades`), observaties, average block; "Overzicht openen" into the ⋮ menu; a
   click on the card opens the overview (the verzameloverzicht for a stack).
2. Grid per jaarlaag with periodes in reading order, labels and dividers.
3. Stack: attempts behind the Verzamelkaart, the toggle pill, open state per session; the tray row
   with the outline (one SVG path with rounded inner corners, recomputed on resize), the two-step
   animation and the reduced-motion fallback.
4. e2e: open and close a stack, click a card, the ⋮ actions; visual baselines after the user's
   check (stop and ask).

### Step 34: Observaties and Opdrachten as cards (L)

Items: F-28. Decisions 45-47. Design: spec 4.16, 4.17; boards 57 (`ObservatiesKaarten.dc.html`)
and 58 (`OpdrachtenVoorbeeld.dc.html`). Builds on step 30 (the edit modals) and step 31 (the
opdracht render used by the editor preview). R-05: `screens/observaties.js` and
`screens/opdrachten.js` to TS.

- **34a, the two card grids:** a shared card grid (the Toetsen grid of step 33: three per row,
  gaps 16/36); the Observaties card (spec 4.16) with the use counts (tests of the active year,
  linked opdrachten) and the delete rule of today; the Opdrachten card (spec 4.17); the filter
  chips and counts. e2e: filters, ⋮ actions, a click opens the edit modal (Observaties).
- **34b, the preview panel:** the two-column layout on the left with the animated move, the
  panel on the right (sticky), Kopiëren, Openen in editor, ✕ and Escape, switching between
  opdrachten; the render on demand with a cache per opdracht and a placeholder; reduced motion.
  e2e: open, switch, close; visual baselines after the user's check (stop and ask).

Steps 35-45 replace the old step 35 ("Hardening, dependencies, 1.0"). Backlog references are
`docs/backlog.md` sections ("7b n4" = "From Step 7b", item n4); the table at the top of the
backlog maps every section to its step. An item a step finds already done is struck through
there with the commit, not silently dropped.

### Step 35: Rights a: own groups only, Sectiesecretaris (M)

Items: F-29, F-30; backlog 7b n4 (role checked only at login), 3b "queued saves stamp the user",
26-28 m2 (photo before user record), 15 m5 (Gebruikers save conflict, only if the new dropdowns
make it worse). Decisions 78-80. Touches data (`school.json`): manual check on a copy of real
data before the release (decision 8).

1. **Rights table (ADR-0006 amendment "Roles and rights"):** per role (docent, sectievoorzitter,
   sectiesecretaris, beheer, and the gast of step 36) what it reads and writes. The Rust session
   (`maatwerk-core::auth`) carries the role, not only the user id (`docent`, `bestuur:<vak>`);
   the role is checked against `school.json` again at every guarded write, so an admin's removal
   takes effect at once (closes 7b n4).
2. **Data:** `secties.<vak>.secretaris` (additive; school schema; `validate-data`: an active
   teacher of the vak, not the voorzitter). `minAppVersion` raised to 0.26.0 (an older app would
   ignore the lock; it now opens read-only). Fixture test; `tiny` and `school` get a secretaris
   and groups with different `docenten`.
3. **Gebruikers and login:** the Sectiesecretaris dropdown next to Sectievoorzitter
   (`screens/gebruikers.ts`, same row style); 26-28 m2 while in that dialog. Login: a
   SECTIESECRETARIS group (`domain/login.ts`), role label "Sectiesecretaris". Every
   `isVoorzitterActive` caller (Rubrics, groep-edit, user menu, …) moves to one
   `isSectiebestuurActive(vak)`.
4. **Core check, failing tests first:** a score write (scores, overrides, observaties in the
   score file, PO grading writes into members' files) is refused with a new `forbidden` code and a
   Dutch message when a changed entry belongs to a student outside the user's groups, unless the
   session is bestuur of that vak. PO: allowed when a member of the projectgroep is in the user's
   groups; own bonus/malus lines only for own students (decision 79). The stamp of a queued save
   is the session at enqueue time (3b).
5. **UI:** the score grid shows other teachers' groups read-only (locked rows, a lock in the group
   heading with a tooltip naming who may change them); paste, cut and Delete skip locked cells;
   Projectgroep beoordelen is read-only for a projectgroep without own members, per-student lines
   locked. The lock look is new: show the user before the visual baselines (stop and ask).
6. e2e: teachers A and B, voorzitter, secretaris on one exam with three groups; a PO with a mixed
   projectgroep. Gate, review, release 0.26.
7. **Added by the user (2026-11-21):** the app starts on the vak tiles; the last vak is
   highlighted (and focused), not chosen.

The user asked for steps 35 and 36 in one go with one gate at the end of 36 (2026-11-21).

### Step 36: Rights b: Gastaccount, Kopieer naar… (M)

Items: F-31; backlog 15 n6 (presence reads `school.json` twice). Decisions 81-82. Touches data
(additive `school.json` field): manual check on a copy of real data.

1. **Data and admin:** `secties.<vak>.gast: true` (additive; an older 0.26 app ignores it and
   shows no Gast, so no `minAppVersion` raise). A "Gastaccount" checkbox per sectie on the
   Gebruikers tab, next to the two dropdowns.
2. **Core:** a gast session (`gast:<vak>`, no user id, no PIN) in which every write command is
   refused (`read_only`, the version guard's path); a Rust test walks the command list and checks
   each writing command refuses a gast. Presence shows "Gast (<vak>)". No per-user preferences
   are read or written; AI assistant off; the editor opens read-only.
3. **Login and UI:** a GAST group in that sectie's login list, no PIN block. One `canWrite()` per
   screen hides or disables every create, edit, delete, import and save control (the step lists
   them per tab); an "Alleen lezen (gast)" pill in the top bar. **Ask the user at the start:** may
   a Gast print a rapport or opdracht (printing writes a copy into `rapporten/`), or only preview?
4. **Kopieer naar…** on the Opdrachten cards and the preview panel (step 34): a dialog with the
   target sectie, then that sectie's teachers, then the PIN (the login throttle of `auth`). The
   core command checks the PIN and writes the copy as that teacher for this one write only:
   `vakken` = the target, linked observaties dropped (the dialog says so).
5. e2e: gast login, a sweep over every tab that nothing is writable, Kopieer naar with a wrong
   and a right PIN, the copy's owner and links. Gate, review, release 0.27.

### Step 37: PO completion: verzameloverzicht, PO backlog (M)

Items: F-32; backlog 21 m1-m3, m6, n7-n9; 22 (all three); 23 m1, m4, m9, n1, n3, n4; 24 m3-m8,
n1, n3, n5; 29c "Profile observaties". Decision 86. Numbers: 24 m5 and the profile count change
numbers, so a before/after table and the user's OK.

1. **Design check (stop and ask):** the PO verzameloverzicht as the PO overview (F-24) with the
   attempt that counts per student and the I/H dot right of the grade (decision 35); a small mock
   for the user. Then build it and enable the PO Verzamelkaart's "Overzicht openen".
2. **PO rapport:** 24 m3 (warning for a partly graded projectgroep), m4, m5 (averages that add
   up), m6, m7 (break inside a tall block), m8 tests, n1, n3, n5.
3. **PO grading:** 23 m4 (save on quitting the app), n1, n3 (live footer status), tests m1/m9.
4. **Rubric guards and validation:** 21 m1 (one-time notice when `minAppVersion` rises), m2 (the
   "in use" scan fails closed), m3, m6, n7 (an error `code` instead of a message prefix), n8, n9;
   `validate-data` warnings of 22 n5, 22 (PO scores without projectgroep) and 23 n4.
5. **Profile observaties:** include a PO's rubric and category observaties (29c).
6. Gate, review, release 0.28.

### Step 38: Grade numbers in Rust, Cijfergemiddelden (L, two sessions)

Items: X-09; backlog 33b "Grade cache" part 1 and its "smaller wins", 7c "First tab visit", 7c m4
rest, 7c n2, 7c n5, 19 m6, 29 m4, 29 m5; 10 "Perf at 4x" (closed: re-measured in 0.24.1); new
feature Cijfergemiddelden. Decisions 83, 90-93. Spec of the new rule:
`docs/phase-2/step-19-grade-rules.md` section 3 "Shown averages".

1. **Inventory (no code):** every place in `ui/src` and `maatwerk-core` that computes a grade
   number itself instead of calling the crate (formulas in JS/TS: averages, sums, rounding,
   `toFixed`, % onvoldoende). Write it to `docs/phase-2/step-38-numbers.md` (place, what it
   computes, crate function that replaces it). A number with no crate function: **stop and ask**
   (CLAUDE.md rule), with a proposal and worked examples.
2. **Rule in the crate (test first, user's OK on the spec is given in decisions 91-92):**
   `round.rs` gets `AverageFormat { method: Afronden | Afkappen, decimals: 0..=2 }` and
   `shown_average(x, fmt)`: noise removed in billionths first (as `round_to`), then half-up or
   towards zero. `mean_of_averages` / `stats_of_averages` take the format (shown values in, mean
   at `round1`); pass/fail on the shown value. **Tests: the test set exists already**
   (2026-11-23): `crates/maatwerk-grades/tests/data/shown_averages.json` (35 named edge cases,
   all 4186 grade pairs, 3000 random weighted averages, 200 groups; expected values for all six
   formats from exact integer arithmetic), generated by `tools/fixtures/shown-averages.mjs`
   (checked by `shown-averages.test.mjs`). `crates/maatwerk-grades/tests/shown_averages.rs`
   pins only `a1` today: extend it to `a0`..`k2` through `shown_average` and the formatted
   group stats; no case may differ. Never edit the JSON by hand. WASM binding,
   `npm run bindings`.
3. **`maatwerk-core::numbers`:** per (year, vak) everything the list screens show: results per
   exam and attempt, year average, SE over the years (upper school), per exam the card numbers
   (Verzamelkaart included), per group the card numbers, observatie counts; computed with
   `maatwerk-grades`, shown under the school's format. Test: compare with the WASM/JS path for
   every number on `tiny` and `school` at the default format; every difference goes in the
   before/after table with its cause (decision 90: Rust wins), shown to the user at the end.
4. **Setting:** additive field in the school settings (`gemiddelden: { r: {methode, decimalen},
se: {...} }`, missing = afronden 1), fixture test, minimum-version guard if an older app would
   misread it; only the admin edits. Beheer › Instellingen section "Cijfergemiddelden" (decision
   93): table, segmented toggles, 3-4 live examples per column (5,45; 5,3 + 5,7 = 5,5; 5,9;
   6,95), note "Geldt voor leerlinggemiddelden. Toetsgemiddelden blijven afgerond op 1 decimaal."
   Show the user a mock before building (board in `docs/design/`).
5. **Command and screens:** a Tauri command under `spawn_blocking`; Leerlingen, Groepen and
   Toetsen cards, Groepsoverzicht and Profiel use it; the shown r/SE follow the format with the
   hover text (decision 93), the group numbers decision 92. The WASM rules stay for the live
   score grid and the modals, but compute nothing of their own. Invalidation per data generation
   (own writes and a changed setting too).
6. **Small wins** of the backlog item (WASM parse once, `getStudentHistory` map, `yieldSlice` in
   `cards/student-grades.ts`, `topbar-fit.ts` layout, fills after login), 29 m4/m5, 7c m4/n2/n5.
7. **Measure** with `tools/perf/measure.mjs` at 1x and 4x, and on the user's real copy
   (M-PERF-1); `docs/perf.md`. **Ask the user:** is a disk cache still needed? If yes, it becomes
   an "After 1.0" item with the location question of the backlog, unless the user wants it now.
8. Gate (before/after tables: 3 at default format, 2 per non-default format on `school`), review,
   release 0.29.

### Step 39: v1 removal and Typst upgrade (L, two sessions)

Items: X-01, X-10; backlog 2 m3/m4/m6/m7, 2a n4, 5a m3, 5a n8, 5b n2, 5b n4, 5b n5, 5b n7, 6a
"Typst warnings", 7a m6, 7a n1, 8a m2, m6, n2, n5, n6, 8b m5, n1, n4, n6, n8 and "Jumps after an
error", 9 m3 (if step 32 left any), 17 m2, Step 6 manual M-START-3. Decisions 84, 88.

- **39a, v1 removal:** the v1 import and v1 -> v2 migration in `maatwerk-cli` and core (v2 -> v3
  stays), `TypstProject::opdracht_v1`/`v1_opdracht_id`, `tools/fixtures/to-v2.mjs` and the 7a m6
  parity check, v1-only goldens and the harness that calls `_reference/`, the
  `render_assignment_svg` command, 5b n5 (images mount to `opdrachten/images/<id>`), 5b n7.
  Close 2/2a items that concern only removed goldens; fix the rest. `docs/parity.md` and
  `docs/cutover-runbook.md` marked history. `_reference/` stays gitignored, read-only.
- **39b, Typst:** `typst`, `typst-pdf`, `typst-svg`, `typst-kit` (and `typst-render` in tests)
  together; the bundled packages' `compiler` versions; Noto Color Emoji with it (COLRv1 check);
  the quick-xml ignores out of `deny.toml`; every golden regenerated and shown to the user as a
  visual diff (stop and ask; the old goldens become the new output, decision 9; 17 m2 then
  closes). With it: 5a m3 (name the field of a failing eval'd text), 5a n8 (system fonts in the
  app), 5b n4 (**ask the user**: hash normalisation of `main.typ`/`lib.typ`), 6a (Typst warnings
  shown in the editor and the generate/rapport modals), 5b n2, and the `LiveEditor` items of 8a
  and 8b. `typst-ide` checked for the editor. Gate, review, release 0.30.

### Step 40: AI assistant follow-ups (M)

Items: backlog 32 m3-m12, "Real CLIs", "Logos"; ADR-0009 _verify_ rows. Decision 89.

1. Apply and images: 32 m3 (apply reverts typing), m4 (images written before the text is saved),
   m5 (placeholder overwrites a real image). Failing tests first.
2. Process: m6 (kill the process tree on exit), m7 (Stop and the time limit during preparation
   and Maatwerk's own checks), m8-m10 (login check, iframe metadata, `--version` once per
   detection).
3. "bèta" tag for CLIs without a passed manual check (decision 89; the verified set is a
   constant with the ADR rows); Vibe's tool steps in the transcript; logos only with permission
   (`THIRD_PARTY_LICENSES.md`), monograms otherwise.
4. m11: split `panel.ts`, `ai.rs`, `provider.rs`, `workspace.rs`, `events.rs` (~500-line rule);
   m12 tests; the nits. Manual check of each CLI the user has; ADR-0009 rows updated.
5. Gate, review, release 0.31.

### Step 41: Data and storage robustness, `rapporten/` cleanup (M)

Items: X-06; backlog 3b n4, 4a m4, m6, n4, n6, n7, n9-n12, 4b n4, 5a m4, 5b n6, 6a m4, n7, 6b n9,
n10, 7a n3-n6, n8, 7b "Herstellen uit snapshot", 7c "Read vs. colleague change", 9 n6, 10 m3, m6,
n1, n2, 15 m2 (verify, probably done in 18), 18 security m4, n1, n4, n5, 26-28 m6. Decision 85.
Bugs: failing test first.

1. **`rapporten/` (X-06):** Beheer › Instellingen shows the folder's size and "Opruimen" (copies
   older than a chosen school year, a confirm with the count); core function with a test. The
   copy layout decides how "school year" is read; check it first.
2. **Storage and watcher:** 4a m6 (retry an `io` read), 5a m4 (content hash on a same-size change),
   7c read vs. colleague change, 3b n4, 4a n4/n6/n7/n9-n12, 4b n4, 10 m6 (CAS delete of an exam).
3. **Snapshots and startup:** 10 m3 (claim removed on shutdown), 10 n1/n2, 7b (reload after
   Herstellen uit snapshot), 26-28 m6 (`listSnapshots` returns the kind).
4. **Input limits and messages:** 6b n10 and 6a m4 (image read cap, thumbnail cache, decode
   limits), 18 m4 (watermark cap), 18 n1/n4/n5, 6a n7, 6b n9, 5b n6, 9 n6, 7a n3-n6/n8, 4a m4.
5. Gate, review, release 0.32.

### Step 41b: Encrypted storage (L: 41b-a, 41b-b)

Design: `docs/adr/0012-encrypted-storage.md` (proposed 2026-11-22, the user's answers). A
data-format change: STOP gates at sub-tasks 1 and 5. After step 41 because it touches the same
Storage, watcher and snapshot code.

**41b-a: layout, crypto, keys**

1. **Storage layout report (user, STOP):** `docs/phase-2/step-41b-storage-layout.md`, written
   _before_ any code, from the real layout in `maatwerk-core` (not from memory):
   - a before/after tree of every top-level folder, sub-folder and file kind, each marked
     **encrypted name / plain name** and **encrypted content / plain content**, with example names;
   - what stays plain and why (`rapporten/`, opdrachten Typst sources, images and photos, the
     `school.json` version stub) and where the real school settings move to;
   - the key file (name, place, the second copy), snapshots, presence and claim files, OneDrive
     conflict copies;
   - the file extension (none or a neutral one), the path length budget (deepest real path,
     before and after), compression yes/no.

   The user approves it; then ADR-0012 becomes accepted.

2. **Crypto core:** `maatwerk-core::vault` (file format `MWK1`, XChaCha20-Poly1305 with the
   logical path as associated data, AES-SIV names in lowercase base32, HKDF subkeys, a wrapped DEK
   per school with key ids). Tests: round trip, known-answer vectors, tamper, swap, truncation,
   wrong key id, conflict-copy names, the test key refused by a release build. Licences and
   `deny.toml` for the new crates.
3. **Build key:** `MAATWERK_MASTER_KEY` read at build time; `.env` in `.gitignore`, `.env.example`
   (placeholder) committed; a release build without the key fails; debug and test builds use the
   public test key; CI reads a repository secret (the user adds it; fork PRs build with the test
   key and do not package a release). The key backup outside GitHub is in place (user).

**41b-b: storage, migration, tools**

4. **Storage integration:** a logical/physical path mapping under `Storage` (write, read, list,
   delete, CAS, watcher, snapshots, presence); writes are skipped when the plain content is
   unchanged; the UI, bridge and TS mock keep logical paths (the e2e suite does not change).
5. **Migration (STOP before the first real run):** automatic on the first start when the stub
   has no format marker: claim file, `minAppVersion` raised, convert, verify that every file
   decrypts, marker flipped last, resumable. Plain snapshots are converted or removed. Checked
   with the 0.27 exe against migrated data (read-only, no crash). The user runs it on an offline
   copy and replaces the online folder in one go.
6. **Tamper and tools:** "gewijzigd buiten Maatwerk" message, the item read-only, restore from a
   snapshot (Beheer); `maatwerk-cli decrypt` / `encrypt` with the key from `.env` (never shipped).
   The docs say "afgeschermd", not "beveiligd"; what is not prevented (rollback, delete) is stated.
7. Gate, review with a security focus (Appendix C plus the crypto checklist: nonces, associated
   data, key handling, failure paths), manual check on a copy of real data, release 0.33.

### Step 42: Tests and CI hygiene (M)

Items: X-05; backlog 0 n2, n3, n6, n9, 3a n5, 3b m8, 6a/6b "Command-level tests", 6b m3 rest, 7c
m5 rest, 7c `examMenuItem` retries, 9 m7, 13 "Possibly flaky Rust test", "Flaky e2e on CI", 13 n9,
10 n7, 14 m4, 15 m6, 19 m9, 20 m6, 25 m3/m6, 26-28 m8, 29 m7, 33 m4, 23 "Local WebKit".

1. **Flaky and timed tests:** fixed waits and retries out (9 m7 with `page.clock`, 3a n5, 7c, 15
   m6); the two flaky suspects run 20x with kept logs and get fixed or a recorded cause.
2. **Command-level tests:** `tauri::test` mock-runtime tests for the render, print, image and
   rights commands (the gast and forbidden paths of steps 35-36); the real-PDF test through the
   `maatwerk-out` scheme (6b m3).
3. **Test gaps** of the reviews listed above (Vitest and e2e).
4. **CI and policy:** actions pinned by SHA with Dependabot, no double runs, no Windows target on
   Linux (0 n9); a bundle licence check (3b m8); one source for the two licence allowlists (0
   n2); SPDX decision for toml/yml (0 n6); the verbatim `LICENSE` (0 n3).
5. Gate, review, release 0.34.

### Step 43: Remaining backlog (M)

Items: backlog 29 m1, m6, n1-n7 (unused utility classes); 3a "Styling cleanup", m7, U18; 13 m3/m4,
n5, n8, raw RTTI colours; 14 m2, n2, n4, n5, n6; 15 n4, n5; 9 n9; 19 m8; 20 (attempt numbering,
`_meta` copy: record as quirks, keep behaviour), 20 m5; 21 n8 (if 37 left it); 22 "Toetsen list
re-renders" (check with the cards); 25 n2; 33 m3; 8b m6 and "CSP report" (check). **Ask the user
at the start:** 29 m1 (which students the exam overview's Observaties percentage counts) and U18
(period separators in the group students modal: wanted?).

1. Dialog and async: 14 m2 (pass the `Dialog` to the helpers), 14 n2, 19 m8 (message when
   WebAssembly cannot start), 33 m3 (tab order into an open stack), 20 m5 (`aria-pressed`).
2. Shared helpers: one `utils/html.ts` escape (15 n5), `el()` (9 n9), `SCHOOLSOORTEN` (21 n8),
   the version compare (15 n4), 29 m6 duplication, 25 n2 (keyboard handler module).
3. Styling: raw colours to tokens (13 n5, 14 n4, RTTI colours), the 3a utility consolidation and
   unused classes (29 n-items). Visible changes: show the diff, baselines after the user's OK.
4. Gate, review, release 0.35.

### Step 44: TypeScript complete, compat layer removed (L, two sessions)

Items: R-05 (the rest), backlog 6b "Compat layer", 15 "R-05 (shell)", 14 n3, 13 m7, 26-28 R-05,
14 "u-\* utilities" (what is left in these files). No behaviour change: e2e and visual baselines
unchanged is the gate (zero visual diffs). The JS left after step 34 (2026-11-21 count, ~7.100
lines): `store.js` 1.522, `editor-init.js` 2.087, `app.js` 827, `modals/groep-edit.js` 752,
`shell/filter-bar.js` 527, `screens/school.js` 328, `pdf-viewer.js` 291, `modals/leerling-edit.js`
267, `custom-select.js` 208, `presence.js` 196, `utils/csv.js` 65, `sync.js` 61,
`utils/icons.js` 42.

- **44a, data side:** `store.js` to typed `store/` modules (each under ~500 lines: cache and
  generation, scores, exams and attempts, groups, users and roles, watcher changes), then
  `sync.js`, `presence.js`, `utils/csv.js`, `utils/icons.js`, `custom-select.js`.
- **44b, screens and editor:** `app.js` (modal helpers, sync notices, navigation into `shell/`),
  `shell/filter-bar.js`, `modals/groep-edit.js`, `modals/leerling-edit.js`, `screens/school.js`,
  `pdf-viewer.js`, `editor-init.js` (split: toolbar, file tabs, preview sync, dialogs, keyboard).
  Then the compat layer: the reference result shapes in `bridge/tauri-api.ts` and `bridge/api.ts`
  and the compat mapping in `src-tauri/src/error.rs` go; callers use the typed `{ code, message }`
  errors. `allowJs` off and a CI check for `.js` under `ui/src`. Gate, review, release 0.36.

### Step 45: Signing-ready, dependencies, reviews, 1.0 (L, two sessions)

Items: X-02, X-11; the rest of the backlog (fixed or moved to "After 1.0" with a reason);
`/security-review` and a whole-codebase review; Step 6 manual M-SYNC-1..4; the Step 6 and 10
manual re-checks; README and screenshots. Decisions 87-89.

- **45a, preparation and reviews:**
  1. **First, the user's signing to-do list** (decision 87; Apple enrolment takes days, so it
     comes first): what to buy or apply for and what to hand over, for Windows (certificate
     options such as Azure Trusted Signing or an OV certificate, `signtool`, Tauri's
     `signCommand`, SmartScreen reputation) and macOS (Apple Developer Program, Developer ID
     Application certificate, notarisation with `notarytool` and an API key, hardened runtime
     and entitlements, stapling); written to `docs/release.md` "Code signing". Then prepare the
     build: signing settings read from environment/CI secrets, CI steps that sign and notarise
     only when the secrets exist, the entitlements file, verify commands. Without secrets the
     build is as today.
  2. **Dependencies:** X-02 (pdf.js, Chart.js, annotation plugin; visual diff for the user), a
     full `cargo update` / npm update pass, the Rust toolchain, `cargo deny` with no ignores,
     licence files and `THIRD_PARTY_NOTICES.txt` regenerated.
  3. **Security review of the whole codebase** (`/security-review`, not a diff): ADR-0006 and the
     rights of steps 35-36, the gast path, path handling, the AI CLI sandbox, the custom scheme,
     CSP, input limits. `docs/reviews/security-1.0.md`; blockers and majors fixed.
  4. **Whole-codebase review** by a fresh reviewer (Appendix C, extended: layering, the core
     never depends on `tauri`, dead code, files over ~500 lines, duplication, docs drift, test
     coverage per area). `docs/reviews/review-1.0.md`; blockers and majors fixed; the backlog
     triaged to zero open items outside "After 1.0".
- **45b, release:**
  1. Remaining fixes from 45a.
  2. Docs: README (what Maatwerk is, install, screenshots from the fixtures, never real data),
     `docs/manual-test.md` pass, `docs/release.md` 1.0 checklist, ROADMAP and this plan closed,
     the "After 1.0" list (X-03 Tauri 3, disk grade cache if not built, installer and updater,
     signing itself, 4b overflow, 26-28 m7).
  3. The user's full manual test on a copy of real data: every M-\* check, M-SYNC-1..4 on two
     machines, M-PERF-1, the re-checks of manual tests 6 and 10, each AI CLI the user has.
  4. Version 1.0.0, release notes (changes since 0.1, known limits: unsigned, bèta CLIs),
     checksums, tag `v1.0.0`. Stop and report.

## 5. Prompts for the user to paste

**Start of phase 2 (after step 12)**

> Read CLAUDE.md, PLAN-2.md sections 1-3 and docs/STATE.md, then do step 13. Stop before
> updating the visual baselines and show me the diff.

**Every later session**

> Read PLAN-2.md sections 1-3 and docs/STATE.md, then continue with the next action. Stop at the
> end of the step and report.
