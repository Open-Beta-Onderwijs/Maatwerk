# Review: step 40, AI assistant follow-ups

Reviewer: fresh-context subagent, 2026-11-26. Scope: `git diff 57fa6d0..HEAD` on
`step/40-ai-followups` (`92c7094`..`f6240ce`, 15 commits). Checked against PLAN-2 step 40,
review 32 m3-m12 and its nits, CLAUDE.md and ADR-0009. Read-only. I ran
`cargo test -p maatwerk-core --test ai_fake_cli --test ai_turn` (8 + 9 passed) and
`cargo test -p maatwerk-core --lib ai::` (51 passed) on Windows. I did not run clippy, Vitest or
e2e, and I could not compile the Unix paths of `run.rs` (read only, see below).

Scope coverage: every item of review 32 m3-m12 and n1-n8 has a commit, decision 89 (the "bèta"
tag from `provider::VERIFIED`), the Vibe tool steps, the letter buttons and the ADR-0009 rows for
Claude Code and Vibe too. Deviations that the docs record: n1 tokens are random but are not
removed after `ai_send` (kept for "Opnieuw proberen", `state.rs` comment); `panel.ts` (816),
`editor-ai.css` and `composer.ts` are still over the ~500-line guideline (backlog). Also
`workspace.rs` is 568 lines, which the backlog does not mention (n6).

What I verified and found sound:

- **Job object (m6, Windows).** `process-wrap` 11 `JobObject` adds `CREATE_SUSPENDED`, assigns
  the process to the job and then resumes it (`windows.rs` `job_creation_flags`,
  `resume_threads`). No grandchild can start outside the job. `CreationFlags(CREATE_NO_WINDOW)`
  is kept. `leader_status` uses `inner_mut().try_wait()`, the plain child, so the exit is seen
  when the CLI itself exits. `JobObjectChild::try_wait` would wait for the whole job, and the
  orphan branch would then never fire. `start_kill` is `TerminateJobObject`. The
  `kill_rest()` after every run (`run.rs:329`) ends whatever stayed behind, also when the pipes
  were already closed. The extended `a_grandchild_holding_the_pipes_does_not_hang_the_run` test
  shows the grandchild dies. Licence row and `Cargo.lock` entry present; the dependency is
  Windows-only.
- **Grace logic.** Stop and time-out still kill at once (Windows) or TERM, then KILL after
  `GRACE` (Unix). The loop breaks `GRACE * 2` after a kill. The orphan branch now kills after
  `GRACE` instead of only waiting, and `killed_at` makes it fire once. I found no regression for
  Stop or time-out. `RunHandle::stop_flag` (n4) is gone with no callers left.
- **Unix paths (read, not compiled).** `#[cfg]` on statements (`run.rs:233`, `:329`) is stable.
  `Proc` uses `std::process::Child` fields (`stdout.take()`), `try_wait` caches the status after
  the reap, so the repeated `leader_status()` after `kill_tree` returns the cached status.
  `hide_and_group` is still used on Windows (`quick_output`), so there is no dead-code warning.
  I found no compile error.
- **Guard (m7).** Every early end keeps nothing and records the history. Stop before the CLI
  starts is caught at the top of the loop (`turn.rs:222`). Stop during a fix-round check
  replaces the report (`:301-304`). Stop during the last check gives `Stopped`/`TimedOut`
  without a proposal and without `proposal.json` (`:338-347`). In every case the code reaches
  `conv.save` with a `RunSummary` (`:380-397`). `stop_before_the_cli_starts_keeps_nothing`
  checks the workspace text and the two history messages. Guarded work only computes: the
  diagnostics and PDF are written by the caller after `wait` returns `Some`.
- **Metadata (m9).** `withOwnMetadata` (`editor-ai.ts:99-108`) always replaces
  `context.metadata` with `aiEditorInfo(ctx).metadata`, or sets it to `null` when the iframe sent
  none, so the iframe only switches it on or off. The Vitest case covers a forged value and the
  off case.
- **Notice guard (n6), syllabus names, tokens (n1).** `ai_send` refuses before
  `notice_seen`, after the school and enabled checks. The syllabus rule matches the step 32 fix
  and now has a test. Picker tokens are `Uuid::new_v4().simple()`.
- **Placeholders (m5), duplicate names (n3), relative PATH entries (n5), version cache (m10).**
  `diff::collect` marks the placeholder by stem and case, `applyAll` and the review dialog leave
  it out of the default choice and label it ("niet gezien"), and the full workspace path is no
  longer shown (n2). The version cache is keyed by program path, cleared on "Opnieuw zoeken", and
  the lock around `detect_cached` makes two parallel detections reuse one set of probes.
- **Layering.** No `tauri` in `maatwerk-core`, no `unsafe` in our code (`unsafe_code = "forbid"`;
  the `unsafe` is inside `process-wrap`), heavy work on `spawn_blocking`/`blocking`. The split
  files only moved code, apart from the Vibe parser and the new commands.

## Blockers

None.

## Majors

**M1. A false "not logged in" from the login probe locks the CLI out for good.**
`turn.rs:195-204, 114-138`, `provider/settings.rs:100-108, 186-188`. Until a conversation has a
`Finished` run, every turn first runs the preset's `login_probe`. When the probe exits non-zero,
or prints JSON without `loggedIn: true`, the turn ends with `NotLoggedIn` and the CLI never runs.
So the conversation can never get its first `Finished` run, and every later turn is refused
too. There is no way out but changing settings. Cases where the probe is wrong while a run
would work:

- A builtin with an overridden `command` (AI-instellingen allow it,
  `settings.rs:179`) still gets the preset's probe (`auth status --json`, `login status`). A
  wrapper script or another build that does not know that subcommand exits non-zero, so it is
  refused.
- Authentication the status command does not report but the run accepts (API-key or cloud
  provider environment variables). I could not check this here. For Codex (bèta, unverified)
  the rule rests only on the exit code.
- An older CLI version without the subcommand.

Before step 40 these runs worked. Review 32 m8 asked for a check that shows the card sooner, not
a gate that can be wrong.

Fix: refuse only on an explicit answer. For Claude Code that is parseable JSON with
`loggedIn: false`. For Codex it is a non-zero exit together with its known "Not logged in"
text. Treat anything else (non-zero exit without that answer, unparseable output, a timeout)
as "unknown" and run the CLI, whose own output still produces the not-logged-in card. Skip the
probe when `command` is overridden. Add a test with a probe that exits 1 with no output: the turn
must run.

**M2. Pending images outlive the text they belong to.** `applier.ts:101, 113, 128`,
`editor-init.js:858-861, 902-912`. The user's choice for m4 was that images reach the opdracht
together with the text that uses them. The pending list is tied to the provider, though, not to
the text. A save that returns `false` keeps the images pending (`saveNow` returns early in a
conflict, before `saveWithImages`), and nothing drops them when the text they belong to goes
away:

1. Toepassen with a "gewijzigd" image, and the save hits a conflict (a colleague saved
   `opdracht.typ`). The images stay pending.
2. The teacher clicks "Hun versie laden" (`loadTheirs`): the editor now holds the colleague's
   text, without the AI's hunks.
3. The next save of `opdracht.typ` (the next keystroke's autosave) runs `saveWithImages`, which
   commits the pending images. The AI's version replaces the real image in the shared folder,
   although no saved text has the AI's change. It may also replace an image the colleague just
   changed. The backup in the run's `undo/` folder disappears with the next turn's `prepare`
   (`remove_dir(run_dir)`).

This is the m4 problem again (images without their text) in a worse form, because it overwrites.

Fix: drop the pending images (and say so on the card) whenever the text of `opdracht.typ` is
replaced from outside: `loadTheirs`, "Mijn versie bewaren als kopie", and every
`replaceDoc`/reload. Simpler and stricter: keep pending only while `after[file]` is still in the
buffer, and in `saveWithImages` commit only when the text being written still contains the
applied text (`content === a.after['opdracht.typ']`, or the image names occur in it). Add an e2e
test: apply with an image, conflict, "Hun versie laden", type: no `commitImages` call.

## Minors

**m1. Ongedaan maken after a retried Toepassen reverts the typing m3 kept.**
`applier.ts:75, 98, 173`. `before` is the buffer from before the *first* round trip. When the
loop retries because the teacher typed, the hunks land on `base` (the later buffer), but
`Applied.before` stays the first snapshot. Undo then puts back `a.before[file]`, which drops
the typing of the first round trip. That is exactly what m3 protects against, now on the undo
path. The e2e test for m3 does not undo. Fix: store `before: base` from the successful try
(`base` is complete, it is `host.buffers()`), and extend the e2e test with Ongedaan maken.

**m2. A Toepassen that gives up still marks the history as applied, and a half-applied
multi-file proposal has no undo.** `applier.ts:80-93`, `proposal.rs:75-80`. Every `ai.apply`
try sets `applied: true` in the history file when a hunk or image fits. If all three tries see
typing, or `applyText` returns `false` for the second file after the first file was already
changed, the card shows an error, but the history says applied (after a reopen: "eerder
toegepast"), and the first file's change is in the buffer with no `Applied` entry, so
Ongedaan maken is not offered. Fix: let `ai_apply` only compute, and set the flag from the panel
once the texts are in (the existing `markApplied` path plus a small `ai_mark_applied`, or the
commit). On a partial failure, put back the files already changed, or record them in `Applied`
so undo works.

**m3. Only the first provider's pending images are stored per save, and a close can lose the
rest.** `applier.ts:128`. `saveWithImages` takes `find(...)`, so with two providers pending
(the first one's save failed, then the second applied), one save stores only the first
provider's images. The text that uses the second provider's images is already saved by the same
write. `closeAfterSave` → `flushSave` saves again only when a timer is pending or the last save
failed, so if the second save succeeded, the remaining images are never stored and the saved
text points at images that are not there. Fix: commit every entry with `pending.length`
(one `commitImages` per provider, all rolled back on a failed write), or block Toepassen of a
second provider while another has pending images.

**m4. A new run silently drops pending images; a failed image commit blocks saving the
text.** `panel.ts:672`, `applier.ts:132-138`. `run()` calls `forget(key)`, which deletes the
`Applied` entry with its pending list. The text that uses those images stays in the buffer and
is autosaved without them, with no message. The other way round: when `commitImages` throws
(proposal or workspace image gone, an I/O error), `saveWithImages` throws, so `saveNow`
reports "Fout bij opslaan" on every autosave, and the teacher can only close with "Toch
sluiten", which loses the text. Fix: before a new run with pending images, save (or ask). When
the commit fails, save the text anyway and show a card ("De afbeeldingen zijn niet
opgeslagen: ..."), so the text is never held back by its images.

**m5. The login probe runs before `prepare` and cannot be stopped.** `turn.rs:200-217`. The
probe (up to `LOGIN_LIMIT`, 15 s, with `quick_output`) runs before the guard is consulted, and
when it refuses, `workspace::prepare` still runs in full (with diagnostics and PDF, up to 2 ×
30 s) before the loop breaks with the not-logged-in report. That is the slow path m8 wanted to
avoid, and Stop does nothing during the probe. Fix: return the refusal right after the probe
(record the history as now, skip `prepare`), and run the probe through `guard.wait(LOGIN_LIMIT,
...)`.

**m6. A finished proposal is discarded when the time limit passes during Maatwerk's last
check.** `turn.rs:336-347`. When the CLI finishes just before the limit, the last
`check_workspace` (up to 30 s) is cut off by the deadline, and the turn becomes `TimedOut`
without a proposal. The teacher waited the whole limit, and the AI's work is lost because of
Maatwerk's own check, not because the CLI was too slow. m7 asked that Stop and the limit are
honoured; for the last check, Stop is enough. Fix: in the final check, interrupt on Stop only
(or give it its own `CHECK_LIMIT` past the deadline) and keep the proposal with `check: None`
when the check did not finish. If the current rule is intended, record it in ADR-0009 and the
time-out card text.

**m7. Unix: what the CLI leaves running without holding the pipes is not ended (m6 partly).**
`run.rs:308-330`. On Windows `kill_rest()` runs after every run. On Unix the group is signalled
only on Stop or time-out, or when a grandchild keeps the pipes open. A grandchild that closed
or redirected its stdio (a detached worker, a daemonised helper) survives a normal exit and can
still write into the workspace after `diff::collect`, which is what m6 was about. The comment
names the pid-reuse risk. The group id cannot be reused while any member is alive, so the risk
exists only when the group is already empty, and then the signal is harmless unless that pid
was handed out again within those milliseconds. Fix: send `-KILL` to the group once, right
when `leader_status()` first returns `Some` (the shortest window), or note the limit in
ADR-0009 if macOS/Linux builds are not a target for step 40.

**m8. The job is not killed when Maatwerk itself ends.** `Cargo.toml` (core, `process-wrap`
features), `run.rs:161-164`. Without the `kill-on-drop` feature/`KillOnDrop` wrapper the job
has no `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. If the app is closed through the main window, or
crashes, during a run, the CLI tree keeps running (and keeps spending the teacher's quota), as
before step 40. With the limit, Windows ends the tree when the last job handle closes, also on
a crash. Fix: enable the `kill-on-drop` feature and add `.wrap(KillOnDrop)`; the explicit
`start_kill` calls stay.

**m9. Test gaps.**

- No test for a failed write after `commitImages` (the rollback through `undoImages`), for a
  commit that throws, for the conflict path in M2, or for two providers with pending images
  (m3). The e2e image test covers only the happy path and undo before any save problem.
- No test for M1's "probe fails without an answer" case, or for a builtin with an overridden
  command.
- No `ai_fake_cli` case for a grandchild that closes its pipes and keeps running (the Windows
  `kill_rest` after the run, and m7 on Unix).
- `a_workspace_holds_no_school_data` walks only the workdir. The run folder (`gemini-policy.toml`,
  `baseline.json`, Vibe's output dir) is passed to some CLIs and is not checked. The PDF chip is
  compressed, so the name search in it proves nothing; that is acceptable only because the
  fixture opdracht has no student data to leak. Say so in the test comment, or render with the
  real placeholder header and check the decompressed text.

## Nits

**n1. The history's `applied` flag flips to false on a rolled-back save.** `applier.ts:143,
147` → `proposal.rs:142`. `undoImages` after a failed write sets `applied: false` while the
hunks stay applied in the buffer. The next successful commit sets it again, but in between a
reopen shows the proposal as not applied. A rollback could use an `undo_images` variant that
leaves the history alone.

**n2. A stopped final check keeps the CLI's answer as the message text.** `turn.rs:340-347,
354-362`. `collected` is cloned before the report is replaced, so a `Stopped`/`TimedOut` turn
shows the AI's reply ("Ik heb ... aangepast") next to a card that says nothing was kept. Use
the interrupted report's empty `collected` for the answer too.

**n3. A failed `--version` (`None`) is cached until "Opnieuw zoeken".** `detect.rs:254-258`. A
cold start of a Node CLI that passes the 10 s limit once shows no version for the rest of the
session. Cache only `Some`, or retry `None` after a while.

**n4. `Guard::wait` duplicates `assignment::with_time_limit`, and given-up work keeps running.**
`guard.rs:44-70`. Both spawn a thread per call, and a stopped or timed-out check keeps compiling
for up to its limit while the next turn already starts. That is fine for now; one helper with an
optional cancel predicate would keep one implementation.

**n5. `kill_rest` after every run also ends a self-updater the CLI started.** `run.rs:329`.
If Claude Code (or another CLI) starts its auto-updater in the background during a run,
`TerminateJobObject` may cut it off mid-install. Consider `DISABLE_AUTOUPDATER=1` (Claude Code)
in the run's environment, or note it in ADR-0009.

**n6. `workspace.rs` is still 568 lines** after the m11 split, and the backlog lists only
`panel.ts`, `editor-ai.css` and `composer.ts` as left. Add it, or move `write_context`
(~110 lines) into `workspace/`.

**n7. The mock's `beta` list duplicates `VERIFIED`.** `mock-ai.ts:122`. A comment points at
the constant. A one-line Rust test that pins `VERIFIED` to `[Claude, Vibe]` next to the ADR rows
would catch drift on the Rust side.

**n8. `ai_apply` keeps the "counts as applied" rule (n8 of review 32) in the command handler.**
`proposal.rs:62-80`. The hunk loop and the rule are domain logic. A
`maatwerk_core::ai::apply::apply_proposal(&p, current, hunks, images) -> (files, chosen, any)`
would keep the handler thin, as CLAUDE.md asks, and make the rule unit-testable.

## Summary

0 blockers, 2 majors, 9 minors, 8 nits. The process work (job object, guard, version cache) and
the privacy fixes (m9, n1, n6) are sound and tested. The majors are the login probe, which can
lock a CLI out with no way back (M1), and the pending-image lifecycle, where images can still
reach the shared folder without the text that uses them, through the conflict / "Hun versie
laden" path (M2). The minors are mostly edges of the same Applier flow (undo after a retry,
two providers, a new run, a failed commit) and the m6/m7 edges (Unix orphans, the last check at
the deadline, the job on app exit).
