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

## Amendment (step 32, user 2026-11-18)

The user refined option D before step 32 (`PLAN-2.md` decisions 48-61). Changes to the text
above:

- **Answer 1 reversed in part:** besides the per-teacher switch, the admin can turn the assistant
  off for the whole school (an additive field in `instellingen.json`, set on the Beheer ›
  Instellingen tab; user 2026-11-18, after the design round).
- **More context than the opdracht folder,** each switchable by the teacher: opdracht metadata,
  current diagnostics, rendered PDF pages, a syllabus PDF (local `syllabus/` folder), other
  opdrachten the teacher picks, and the teacher's own attachments. Constraint 1 stays: no student,
  toets or score data, not even aggregates.
- **Web search allowed** for the CLI (step 2 of the decision said "no network tools beyond the
  model"); other shell commands stay denied where the CLI allows it.
- **Writable files:** only `opdracht.typ` and `images/`; changes to `main.typ` and `lib.typ` are
  dropped from the diff.
- **Multi-turn:** one conversation per provider per opdracht, the CLI session resumed; the temp
  dir lives as long as the conversation (not one request); history in local app data.
- **Apply:** per file or hunk, rebased onto the current buffer (the teacher may keep typing),
  one undo step.
- **Entry points** besides the editor: Opdracht toevoegen "met AI" and "Laat AI dit oplossen"
  after a failed Opdrachten genereren.
- **Launch CLIs:** Claude Code, OpenAI Codex CLI, Gemini CLI, and Mistral Vibe and GitHub Copilot
  CLI if usable non-interactively; DeepSeek dropped. The invocation research is recorded here in
  step 32. After the research the user added Antigravity CLI and a teacher-defined "Eigen CLI"
  (`PLAN-2.md` decisions 76-77, sections below).

## CLI research (step 32, 2026-11-18)

Sources: the vendors' official documentation as of 2026-11-18 (links per CLI), plus `--help` of
the two CLIs installed on the development machine (Windows 11): **Claude Code 2.1.327**
(`%USERPROFILE%\.local\bin\claude.exe`) and **Mistral Vibe 3.0.4**
(`%APPDATA%\Python\Python313\Scripts\vibe.exe`; tool names from `vibe config schema`). Codex,
Gemini CLI and Copilot CLI are not installed there. Nothing was logged in to and no prompt was
sent; real runs are the manual check of 32c (decision 61). Rows marked _verify_ are not stated by
the docs and must be confirmed in that check (the scripted fake CLI of 32a follows the documented
shapes).

Placeholders in the argument presets: `{prompt}` is a fixed ASCII instruction ("Read
`.maatwerk/request.md` and do what it asks"); the teacher's message, the context list and the
task live in that file, never on the command line (see "Findings for 32a"). `{session}` is the
provider session id, `{check}` the bundled check command, `{image}` an attached image inside the
temp dir, `{run}` a per-run folder outside the temp dir, `{secs}` the time limit.

### Claude Code (Anthropic)

| Topic           | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Non-interactive | `claude -p "<prompt>"` (`--print`); the prompt may also come from stdin (max 10 MB). Exit 0 on success, non-zero on failure; SIGTERM gives 143 and leaves the session resumable                                                                                                                                                                                                                                                                                   |
| Streaming       | `--output-format stream-json --verbose`: NDJSON with `system/init` (`session_id`), `assistant`/`user` messages with `tool_use`/`tool_result` blocks, `system/api_retry`, `permission_denied`, and a final `result` (text, cost, `permission_denials`); `--include-partial-messages` adds token deltas                                                                                                                                                             |
| Resume          | `--session-id <uuid>` on the first run (Maatwerk picks the UUID), then `--resume <uuid>`; the session is found by id from any directory                                                                                                                                                                                                                                                                                                                           |
| Permissions     | `--restricted` removes Bash, PowerShell and WebFetch unless `--tools` names them, confines the file tools to the working dirs and ignores the user/project/local settings files. `--tools` limits the tool set, `--allowedTools` takes rules such as `Bash(<cmd> *)` and path-scoped `Edit(...)`, `--permission-mode dontAsk` denies everything else. OS sandboxing exists on macOS, Linux and WSL 2 only, not on native Windows: there the rules are the barrier |
| Web search      | Built-in `WebSearch` and `WebFetch` tools, allowed by listing them                                                                                                                                                                                                                                                                                                                                                                                                |
| Images          | No image flag for `-p`. The `Read` tool reads PNG/JPEG/GIF/WebP, so attached images are copied into the temp dir and named in the request; `--input-format stream-json` with image blocks is the alternative                                                                                                                                                                                                                                                      |
| Detection       | `claude` (`claude.exe` on Windows; `~/.local/bin/claude` from the native installer; also Homebrew, WinGet, npm). `claude --version` prints `2.1.327 (Claude Code)`                                                                                                                                                                                                                                                                                                |
| Not logged in   | `claude auth status` (JSON by default, `--text`) answers without a prompt. In a run, a failure "such as missing authentication" is printed as the result on stdout with a non-zero exit; `system/api_retry` carries `error: "authentication_failed"`. `--bare` is unusable: it never reads the subscription login                                                                                                                                                 |
| Install         | Windows (PowerShell): `irm https://claude.ai/install.ps1 \| iex`; macOS/Linux: `curl -fsSL https://claude.ai/install.sh \| bash`. Also `winget install Anthropic.ClaudeCode`, `brew install --cask claude-code`, `npm install -g @anthropic-ai/claude-code@latest` (Node 22+). Needs a paid Claude plan                                                                                                                                                           |
| Default args    | `-p {prompt} --output-format stream-json --verbose --session-id {session} --restricted --tools Read,Glob,Grep,Edit,Write,WebSearch,WebFetch,Bash,PowerShell --allowedTools "Edit(./opdracht.typ)" "Edit(./images/**)" WebSearch WebFetch "Bash({check} *)" "PowerShell({check} *)" --permission-mode dontAsk --permission-prompts none --strict-mcp-config`; later turns `--resume {session}` instead of `--session-id`                                           |

Sources: [headless](https://code.claude.com/docs/en/headless),
[CLI reference](https://code.claude.com/docs/en/cli-reference),
[setup](https://code.claude.com/docs/en/setup), local `claude --help`.

### OpenAI Codex CLI

| Topic           | Finding                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Non-interactive | `codex exec "<prompt>"` (`-` reads the prompt from stdin); `--skip-git-repo-check` outside a git repo; `-C <dir>` sets the workspace root                                                                                                                                                                                                                                                                           |
| Streaming       | `--json`: JSON Lines with `thread.started`, `turn.started`, `turn.completed`, `turn.failed`, `item.*` (agent messages, reasoning, command executions, file changes, web searches, plan updates) and `error`                                                                                                                                                                                                         |
| Resume          | `codex exec resume <SESSION_ID> "<prompt>"` (or `--last`); the id comes from `thread.started` (_verify_ the field and that `--json`, `-c`, `-i` are accepted after `resume`)                                                                                                                                                                                                                                        |
| Permissions     | `--sandbox workspace-write` (writes only in the workspace; no network for commands unless `sandbox_workspace_write.network_access`), `-c approval_policy="never"` for non-interactive runs. No per-command allow/deny on the command line: other shell commands run inside the sandbox instead of being denied. Native Windows sandbox: MXC on Windows 11 24H2/25H2 builds, else an elevated or unelevated fallback |
| Web search      | `-c web_search="live"` (values `disabled`, `cached` = default, OpenAI's index without live access, `indexed`, `live`); `--search` is listed for interactive `codex` only                                                                                                                                                                                                                                            |
| Images          | `-i, --image <path>[,<path>]` on `codex exec`, repeatable                                                                                                                                                                                                                                                                                                                                                           |
| Detection       | `codex` (`codex.exe` from the installer, `codex.cmd` from npm); `codex --version` (_verify_ the output)                                                                                                                                                                                                                                                                                                             |
| Not logged in   | `codex login status` exits 0 when credentials are present, non-zero otherwise, without a prompt. In a run: `turn.failed`/`error` events (_verify_ the text)                                                                                                                                                                                                                                                         |
| Install         | Windows: `powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 \| iex"`; macOS/Linux: `curl -fsSL https://chatgpt.com/codex/install.sh \| sh`. Also `npm install -g @openai/codex`, `brew install --cask codex`. ChatGPT plan or API key                                                                                                                                                |
| Default args    | `exec --json --skip-git-repo-check --sandbox workspace-write -c approval_policy="never" -c web_search="live" [-i {image}] {prompt}`; later turns `exec resume {session}` with the same flags                                                                                                                                                                                                                        |

Sources: [non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode),
[CLI reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli),
[config reference](https://learn.chatgpt.com/docs/config-file/config-reference),
[Windows sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox),
[CLI](https://learn.chatgpt.com/docs/codex/cli) (developers.openai.com/codex redirects there).

### Gemini CLI (Google)

| Topic           | Finding                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Non-interactive | `gemini -p "<prompt>"` (appended to stdin input if any); a positional prompt starts interactive mode in a TTY. Exit codes 0, 1, 41 auth, 42 input, 44 sandbox, 52 config, 53 turn limit                                                                                                                                                                                                                                               |
| Streaming       | `--output-format stream-json` (`-o`): JSONL `init` (session id, model), `message`, `tool_use`, `tool_result`, `error`, `result` (stats)                                                                                                                                                                                                                                                                                               |
| Resume          | `--resume <uuid>` (or `latest`, or an index). Sessions are stored per project-directory hash, so **the temp dir path must stay the same** for a conversation (_verify_ `--resume` with `-p`)                                                                                                                                                                                                                                          |
| Permissions     | `--approval-mode auto_edit` (edits approved; `ask_user` counts as deny in non-interactive mode). Shell rules go through the Policy Engine: workspace `.gemini/policies` have no effect and user policies live in `~/.gemini/policies`, so Maatwerk passes its own file with `--admin-policy <file>` (rules on `run_shell_command` with `commandPrefix`). `--allowed-tools` is deprecated. `-s` needs Docker/Podman/Seatbelt: not used |
| Web search      | Built-in `google_web_search` and `web_fetch`                                                                                                                                                                                                                                                                                                                                                                                          |
| Images          | `read_file` reads images and PDF; `@path` references in the prompt (_verify_ in `-p`)                                                                                                                                                                                                                                                                                                                                                 |
| Detection       | `gemini` (`gemini.cmd` from npm on Windows); `gemini --version`                                                                                                                                                                                                                                                                                                                                                                       |
| Not logged in   | Exit code 41 (`FatalAuthenticationError`); headless runs need a cached login or `GEMINI_API_KEY`                                                                                                                                                                                                                                                                                                                                      |
| Install         | `npm install -g @google/gemini-cli` (Node.js 20+; Windows 11 24H2+); `brew install gemini-cli`                                                                                                                                                                                                                                                                                                                                        |
| Default args    | `-p {prompt} --output-format stream-json --approval-mode auto_edit --admin-policy {run}/gemini-policy.toml`; later turns add `--resume {session}`. The policy allows `google_web_search`, `web_fetch` and `run_shell_command` with `commandPrefix = "{check}"`, and denies `run_shell_command` otherwise                                                                                                                              |

**Caveat:** the Gemini CLI docs say that for unpaid-tier and Google One users Gemini CLI "was
replaced by Antigravity CLI on June 18th, 2026", and that it is not optimised for the newest
Gemini model. Gemini CLI still works with a paid Code Assist licence or an API key, but many
teachers with a free Google account cannot use it. The user therefore added Antigravity CLI to
the launch set (decision 76, below).

Sources: [headless](https://geminicli.com/docs/cli/headless/),
[CLI reference](https://geminicli.com/docs/cli/cli-reference/),
[session management](https://geminicli.com/docs/cli/session-management/),
[policy engine](https://geminicli.com/docs/reference/policy-engine/),
[tools](https://geminicli.com/docs/reference/tools/),
[installation](https://geminicli.com/docs/get-started/installation/),
[troubleshooting](https://geminicli.com/docs/resources/troubleshooting/).

### Mistral Vibe

| Topic           | Finding                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Non-interactive | `vibe -p "<prompt>"`, `--prompt-file <path>` or stdin; `--workdir <dir>`; `--time-limit <secs>` stops the run cleanly (exit 3, resumable). Exit codes 0 done, 1 could not start, 2 model API or runtime failed, 3 stopped unfinished                                                                                                                                                                            |
| Streaming       | `--output streaming` (NDJSON, one entry per line; verified 2026-11-26, 3.0.4): `type` `message` (`role` user/assistant, `content[].text`), `reasoning`, and `effect` per tool call (`detail.toolName` such as `file_system.read_file`/`file_system.edit`, `detail.input`, `state.status`, `state.outputText`, `state.display.success`); every entry carries `sessionId`. `json` gives all messages at the end   |
| Resume          | `--resume <SESSION_ID>`; the id is in `export.json`, written by `--output-dir <dir>` (with version, usage, cost, stop reason)                                                                                                                                                                                                                                                                                   |
| Permissions     | In `-p`, every tool call that needs approval is denied unless `--auto-approve`. Default agent `accept-edits` (edits approved, shell asks). Per-tool `permission = always/ask/never` with `allowlist`/`denylist`, and a global `outside_workdir = "deny"`, in `.vibe/config.toml`, read from the working dir only with `--trust` (one run, not saved). Shell tools: `bash`, `powershell`, `git_bash`. No sandbox |
| Web search      | Built-in `web_search` and `web_fetch` (permission `ask` by default, so they are set to `always`)                                                                                                                                                                                                                                                                                                                |
| Images          | Vision models get PNG/JPEG/GIF/WebP through `@` mentions (TUI, since 2.14); `vision_model` describes images for text-only models. In `-p`: _verify_, else name the file and let `read_file` read it                                                                                                                                                                                                             |
| Detection       | `vibe` (`vibe.exe` in the uv/pip scripts folder); `vibe --version` prints `vibe 3.0.4`                                                                                                                                                                                                                                                                                                                          |
| Not logged in   | Verified 2026-11-19 (3.0.4, no key): stderr `Error: Missing MISTRAL_API_KEY environment variable for mistral provider` after "Reading API keys from the system keyring", non-zero exit; Maatwerk reports it as not logged in. Login is a browser sign-in or an API key (OS keyring, `~/.vibe/.env` or `MISTRAL_API_KEY`), set up with `vibe --setup`                                                            |
| Install         | macOS/Linux: `curl -LsSf https://mistral.ai/vibe/install.sh \| bash`; Windows: `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 \| iex"`, then `uv tool install --python 3.14 mistral-vibe` (uv/Python, not Node). Apache-2.0                                                                                                                                                       |
| Default args    | `--prompt-file {workdir}/.maatwerk/request.md --workdir {workdir} --trust --agent accept-edits --output streaming --output-dir {run} --time-limit {secs}`; later turns add `--resume {session}`. Maatwerk rewrites `.vibe/config.toml` before every run: `outside_workdir = "deny"`, `web_search`/`web_fetch` `always`, `bash`/`powershell`/`git_bash` `ask` with `allowlist = ["{check}"]`                     |

Sources: [install](https://docs.mistral.ai/mistral-vibe/introduction),
[safety and permissions](https://docs.mistral.ai/vibe/code/safety-approvals-permissions),
[programmatic mode](https://github.com/mistralai/mistral-vibe/blob/main/docs/programmatic-mode.md),
[README](https://github.com/mistralai/mistral-vibe), local `vibe --help` and `vibe config schema`.

### GitHub Copilot CLI

| Topic           | Finding                                                                                                                                                                                                                                                                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Non-interactive | `copilot -p "<prompt>"` runs and exits (non-zero when interrupted); `--no-ask-user` removes the question tool; `-s` prints only the answer                                                                                                                                                                                                            |
| Streaming       | `--output-format json` (JSONL, one object per line). The event types of a `-p` run are not documented (only `workflow.result` of `copilot workflow run`): _verify_                                                                                                                                                                                    |
| Resume          | `--session-id <uuid>` resumes or creates that session (Maatwerk picks the UUID); also `--resume=<id>` and `--continue`                                                                                                                                                                                                                                |
| Permissions     | `--allow-tool`/`--deny-tool` with kinds `shell(cmd)`, `write(path)`, `read`, `url(domain)`, `memory`; deny wins over allow, so other shell commands are left unallowed (nobody can approve them) instead of denied by a rule; `--available-tools` limits the set; `--add-dir` extends the allowed paths, `--allow-all-paths` turns the path check off |
| Web search      | No search tool, only `web_fetch` (with `url(...)` rules or `--allow-all-urls`)                                                                                                                                                                                                                                                                        |
| Images          | `--attachment <path>` (repeatable; images and documents; non-interactive only)                                                                                                                                                                                                                                                                        |
| Detection       | `copilot` (`copilot.exe` from WinGet, `copilot.cmd` from npm); `copilot --version` (`-v`) or `copilot version`                                                                                                                                                                                                                                        |
| Not logged in   | Interactive runs ask for `/login`; for `-p` not documented (_verify_). Tokens from `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`. Needs a Copilot plan                                                                                                                                                                                           |
| Install         | Windows: `winget install GitHub.Copilot`; macOS/Linux: `curl -fsSL https://gh.io/copilot-install \| bash` or `brew install --cask copilot-cli`; any: `npm install -g @github/copilot` (Node 22+)                                                                                                                                                      |
| Default args    | `-p {prompt} --output-format json --no-ask-user --session-id {session} --allow-tool "write(opdracht.typ)" "write(images/**)" "shell({check})" --allow-all-urls [--attachment {image}]` (_verify_ the `write(...)` glob form)                                                                                                                          |

Sources: [programmatic reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference),
[command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference),
[using Copilot CLI](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-copilot-cli),
[installing](https://docs.github.com/en/copilot/how-tos/set-up/install-copilot-cli).

### Antigravity CLI (Google)

Added by the user on 2026-11-18 (decision 76), after the research showed that Gemini CLI is gone
for free Google accounts.

| Topic           | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Non-interactive | `agy -p "<prompt>"` (`--print`, `--prompt`); diagnostics on stderr; `--print-timeout` exists. Exit 0 on success, non-zero with the reason on stderr; permission soft-denials still exit 0. Community reports of `-p` hanging or dropping stdout when not run in a TTY (GitHub issue #76): _verify_ on the current version, since Maatwerk always pipes                                                                                                                                                                                                                                                                                        |
| Streaming       | `--output-format stream-json`: NDJSON `init`, `step_update` (step types `user_input`, `agent_response`, `tool` with `tool_info`, `checkpoint`), `result` with a status (`SUCCESS`, `ERROR`, `CANCELED`, `INTERRUPTED`, ...)                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Resume          | `--conversation <id>` (runs are stateless by default), `-c` for the latest; the id from `init` (_verify_)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Permissions     | Rules `action(target)` with actions `read_file`, `write_file`, `read_url`, `execute_url`, `command`, `mcp` in lists deny > ask > allow, but **only in the user's global** `~/.gemini/antigravity-cli/settings.json` (no per-run settings flag or project file documented). Reads and writes inside the project dir are allowed, outside it they ask; in headless mode anything that asks is soft-denied (stderr notice, run goes on). So shell commands, the check included, are denied unless the teacher allowed them globally. `--sandbox` (OS containment, macOS/Linux, Windows from 1.4.4). `--dangerously-skip-permissions`: never used |
| Web search      | Not documented as a tool; page fetches are `read_url` (asks, so denied headless) (_verify_)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Images          | Not documented; images are copied into the temp dir and named in the request (_verify_)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Detection       | `agy`; installed to `~/.local/bin/agy` (macOS/Linux) and `%LOCALAPPDATA%\agy\bin` (Windows); `agy --version`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Not logged in   | Headless runs need cached credentials from one interactive `agy` session; without them the run "exits with an `authentication required` error instead of hanging". Personal Google account (Free, Pro, Ultra), Gemini Enterprise, or an API key with `modelProvider` set in the settings file. **Google Workspace accounts (most school accounts) do not include Antigravity**                                                                                                                                                                                                                                                                |
| Install         | Windows (PowerShell): `irm https://antigravity.google/cli/install.ps1 \| iex`; macOS/Linux: `curl -fsSL https://antigravity.google/cli/install.sh \| bash`. No Node needed                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Default args    | `-p {prompt} --output-format stream-json`; later turns add `--conversation {session}`. The check runs on Maatwerk's side after the turn (finding 9)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Sources: [headless](https://antigravity.google/docs/cli/headless),
[CLI reference](https://antigravity.google/docs/cli/reference),
[permissions](https://antigravity.google/docs/permissions?tab=cli),
[install and auth](https://antigravity.google/docs/install?tab=cli),
[getting started](https://antigravity.google/docs/getting-started),
[issue #76](https://github.com/google-antigravity/antigravity-cli/issues/76) (community report).

### Custom CLI (decision 77)

The user asked for a "Eigen CLI" option: a teacher adds an AI CLI that is not in the list by
entering its command and arguments. Maatwerk cannot know its output format or permission flags,
so a custom CLI gets the lowest common denominator:

- **Fields** (per teacher, local settings, like the preset overrides; several allowed): name
  (shown on the rail as a monogram, never a vendor logo), command (a name on PATH or an absolute
  path), arguments for the first turn, and optionally arguments for later turns. The placeholders
  of the presets are available (`{prompt}`, `{workdir}`, `{session}`, `{check}`, `{image}`,
  `{run}`, `{secs}`), with `{session}` a UUID that Maatwerk makes per conversation.
- **Output:** plain text. stdout and stderr lines go into the transcript as they come; the last
  stdout block is the answer. No events, no step names in the status line ("Bezig…").
- **Conversation:** without "later turns" arguments every turn is a fresh run, and
  `.maatwerk/request.md` carries the earlier messages of the conversation.
- **Result:** the same as for the presets: Maatwerk diffs `opdracht.typ` and `images/` in the
  temp dir, runs the check itself (finding 9), and shows the diff card.
- **Safety:** Maatwerk cannot pass permission flags it does not know; the settings card says that
  the teacher is responsible for the CLI's own restrictions, and the privacy notice applies as for
  the presets. Constraint 1 holds anyway: only the temp dir's content is offered.
- **Errors:** no login detection; a non-zero exit gives the CLI-error card with the last output
  lines.
- **Detection:** shown on the rail when the command resolves (PATH or absolute path), else listed
  as "Niet gevonden" in the settings.

### Decision 49: do Mistral Vibe and Copilot CLI qualify?

- **Mistral Vibe: yes.** Documented headless mode with streamed NDJSON, resume by session id, a
  built-in time limit, web search, and permission rules that keep the file tools in the working
  dir and allow only the check command (project config plus `--trust`). Weak points: the stream
  fields and the not-logged-in signal are undocumented, image input in `-p` is unconfirmed, and
  it installs through uv/Python.
- **GitHub Copilot CLI: yes.** Documented `-p` with JSONL output, resume by a session id that
  Maatwerk chooses, path and per-command permission rules, and image attachments. Weak points: no
  web search (fetch only), and the `-p` event types and not-logged-in behaviour are undocumented.

Both stay in the launch set. The _verify_ rows are part of the 32c manual check; the presets stay
editable (answer 8), so a wrong guess is a settings change, not a release.

### Real-CLI check (step 32c, 2026-11-19)

`crates/maatwerk-core/tests/ai_real_cli.rs` (opt-in) on the development machine, Windows 11:

- **Claude Code 2.1.328** (logged in, Pro): two turns on the base opdracht, the second resumed
  with `--resume {session}`. Both gave a proposal of one hunk in `opdracht.typ`, the check passed,
  answers in Dutch, 19 s and 13 s. Finding: on Windows it first tried its PowerShell tool on
  `.maatwerk\check.cmd`, which `--allowedTools` denies (adding a `PowerShell(...check.cmd)` rule
  did not match either); the request now tells Claude Code to run `.maatwerk/check` with Bash,
  and the check runs on the first try.
- **Mistral Vibe 3.0.4** (not logged in): the not-logged-in text above.

### Real-CLI check (step 40, 2026-11-26)

Same test, after the step 40 fixes (job object, guard, login check), Windows 11:

- **Claude Code 2.1.328** (logged in, Pro): the login status (`auth status --json`) passed
  before the first turn; two turns, the second resumed; one hunk each, its own check passed
  (`.maatwerk/check` via Bash), 33 s and 21 s. Still verified.
- **Mistral Vibe 3.0.4** (logged in, free account): two turns, the second resumed with the
  session id; one hunk each, Maatwerk's check passed with 0 fix rounds, answers in Dutch, 45 s
  and 20 s. The streaming fields (row above) are now parsed: reads and edits show as steps in
  the transcript. **Verified** (`provider::VERIFIED`, no "bèta" tag). Image input in `-p` stays
  _verify_ (the test sends no image).
- Codex, Gemini CLI, Antigravity and Copilot CLI are not installed here: their _verify_ rows stay
  open for a machine that has them.

### Findings for 32a

1. **Prompt via a file, not the command line.** On Windows the npm installs are `.cmd` shims run
   through `cmd.exe`, where free text in arguments is a quoting and injection hazard (Rust's
   `Command` refuses some arguments to `.bat`/`.cmd`). Every preset passes only the fixed
   `{prompt}`; the teacher's text goes into `.maatwerk/request.md` in the temp dir.
2. **PATH on macOS/Linux.** An app started from Finder or a desktop launcher does not get the
   login shell's PATH, so `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin` and the npm/nvm
   folders are missing. This is a known, solved problem (editors such as VS Code do the same):
   Maatwerk reads the login shell's PATH once at startup (`$SHELL -l -i -c` printing `$PATH`
   between markers, with a time limit), merges the installers' default folders
   (`~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `~/.npm-global/bin`, the active nvm
   version), and uses that PATH both to find the CLI and **as the child's environment**, because
   npm-installed CLIs start with `#!/usr/bin/env node` and fail without Node on PATH. A command
   preset may also hold an absolute path, as a last resort. On Windows: user and system PATH plus
   `PATHEXT` (`.exe`, `.cmd`).
3. **Stable temp dir per conversation.** Gemini keys sessions by the project path, so a
   conversation's temp dir keeps its path (also across an app restart) until "Nieuw gesprek".
4. **Session ids:** Claude Code and Copilot take a UUID from Maatwerk; Codex, Gemini and Vibe
   report theirs (`thread.started`, `init`, `export.json`), which Maatwerk stores with the
   history.
5. **Time limit and Stop:** kill the whole process tree (Windows job object, process group on
   Unix). Claude Code and Vibe keep the session resumable after a stop; Vibe's own
   `--time-limit` is a second guard.
6. **Login check before a run:** `claude auth status` and `codex login status` answer without a
   prompt; Gemini's exit code 41 marks it, Antigravity's `authentication required` error on
   stderr; Vibe and Copilot are recognised from their error output once the manual check has
   shown it.
7. **Residual risk ("edits only in the working dir"):** Claude Code (`--restricted`), Vibe
   (`outside_workdir = "deny"`) and Copilot (path check) keep their file tools in the temp dir;
   Codex relies on its sandbox for writes and cannot deny other shell commands; on native
   Windows none of them stops reads outside the folder at the OS level. Maatwerk only takes
   `opdracht.typ` and `images/` back (decision 50).
8. **Node.js** is needed only for Gemini CLI (and the npm routes of the others); the install help
   (decision 72) says so per CLI instead of one general Node.js note.
9. **Check on Maatwerk's side too.** Antigravity (no per-run permission rules) and custom CLIs
   cannot be relied on to run the bundled check. After every turn Maatwerk runs the check on the
   temp dir itself (it does so for the diff card anyway, decision 68); for these CLIs, when
   errors remain, it resumes the conversation with the diagnostics, bounded to 3 rounds
   (constraint 3), and shows what is left. The presets that can run `{check}` keep doing so.
