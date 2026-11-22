# Review: step 37

Scope: the step 37 commits on `step/37-po-completion`
(`git log --first-parent --no-merges 9168c0e..HEAD`, `bdae808`..`0247f18`), without what the
merge `8bb88b5` brought from `main` (steps 35-36, reviewed in `step-35-36.md`) and without the
visual baselines. Checked against PLAN-2 step 37, STATE "Step 37", the backlog entries the step
marks done, and CLAUDE.md. Cargo was not run (the gate runs it). The UI unit tests for the quit
guard, `oneAtATime`, the profile and the PO rapport pass (26 tests).

Scope coverage: every item named in PLAN-2 step 37 has a commit and a backlog entry: F-32
(`0475956`); 21 m2, m3 (`cbe8a84`), m6 (`59e6b68`), n7 (`b5676d0`), n8 (`2bf0f12`), n9
(`1c4ce5c`), m1 closed with a reason; 22 (n5 both parts and PO scores without a projectgroep) and
23 n4 (`fc82e71`); 23 m1, m4, m9, n1, n3 (`340fc97`, `2c970d2`); 24 m3-m8, n1, n3, n5 (`236e1b2`,
`0f98efd`, `27d2f08`, `d74fdb6`); 29c (`7045331`). The two number changes (24 m5, profile count)
have the user's OK in STATE and in the commit messages. The `rubric/tests.rs` move keeps all 19
tests. SPDX check passes. No new `tauri` dependency in core, and the only `src-tauri` change is a
`From` impl and one capability.

## Blockers

None.

## Majors

**M1. Quitting the app closes the window even when the save before it failed, and nobody is told.**
`ui/src/services/quit-guard.ts:25-45` runs the tasks and ignores what they return.
Projectgroep beoordelen's task is `beforeQuit(() => save())` (`ui/src/modals/po-beoordelen.ts:456`).
`save()` returns `false` on a conflict or an error and does not throw. On a conflict it calls
`conflict(...)`, which opens a dialog under the busy overlay. On an error it sets a status line, and
`persistentError` is shown only when `closed` is set, which is not the case on quit. In both cases
`runBeforeQuit` then resolves and Tauri destroys the window. Failure scenario: a teacher grades a
group, the shared folder is locked or full (or a colleague graded one member meanwhile), and she
closes the app. She sees "Gegevens opslaan, dan afsluiten…", the window closes, and the grading is
gone. The overlay text tells her it was saved. This is the data loss that 23 m4 was meant to fix,
now hidden behind a message that says the opposite. Fix: let a task report failure (return
`false`, or throw). If any task fails or times out, keep the window open: call
`event.preventDefault()` in the Tauri handler (pass the `CloseRequestedEvent` through
`listenCloseRequested`), hide the overlay and ask "Niet alles is opgeslagen. Toch afsluiten?"
(Afsluiten / Terug). Add a unit test where a task returns `false` and the close is held back, and
an e2e test with a refused member write followed by `requestClose`.

## Minors

**m1. The 8 s quit limit can cut a group save halfway, so only some members are written.**
`ui/src/services/quit-guard.ts:11` (`QUIT_WAIT_MS = 8000`) races the tasks. `save()` writes the
members one by one (`po-beoordelen.ts:526-543`), and each write is a read-modify-write on the
shared folder. On a slow OneDrive with a group of 5, 8 s can run out after 2 members. The window
is then destroyed and the process exits. Each file is atomic, but the group is not: 2 members
have the new grading and 3 the old one. The next open flags this as "andere groep"/conflict
noise. Fix: do not close on a timeout while a write is in flight. With M1's dialog, show "Opslaan
duurt lang. Toch afsluiten?" instead of closing silently, or raise the limit for a task that
reports progress.

**m2. A read error in one school year now breaks the Observaties screen and the Bewerken
action.** `ui/src/store.js:1079-1091` (`loadObsUsage`) uses `readAllJson`, which throws
(`orThrow`) on an I/O error. `renderObservaties` awaits it in a `Promise.all`
(`ui/src/screens/observaties.ts:108-112`), so the whole screen fails to render. `openObsModal`
(`observaties.ts:26-31`) is `void promise.then(...)` with no `catch`, so clicking a card or
Bewerken does nothing and an unhandled rejection reaches "Probleem melden". Before 37 only the
active year was read. Failure scenario: an old year folder that OneDrive has not downloaded
(access denied) blocks all observatie editing in the current year. Fix: catch per year in
`loadObsUsage` and remember that the usage is incomplete. The delete guard and the Toets/PO lock
should then fail closed ("Kan niet nagaan of deze observatie gebruikt wordt") instead of failing
open or breaking. Add a unit or e2e test with a failing `readAllJson` for one year.

**m3. The profile count changes for tests too, against the commit message.**
`ui/src/modals/profile/data.ts:34`: `for (const id of new Set(given))` now removes duplicates for
a test as well. The old code counted `observations[exam.id]` with duplicates. The commit says "a
test is unchanged". A duplicated id (hand edit, or an older import) used to count 2 and now
counts 1. The effect is small and probably more correct, but it is a number change outside the
before/after the user approved. Fix: either keep the duplicates for tests (dedupe only the PO
union), or add one line to the before/after and to `docs/reference/quirks.md`, plus a test for a
duplicate id.

**m4. The rubric guard scans every year's exams while it holds the commit lock.**
`crates/maatwerk-core/src/rubrics.rs:242-274` (only when a locked field changes) and `:277`
(`guard_delete`, always) call `uses_of`, which reads every exam JSON of every year. The commit
lock is held during the scan (`storage/mod.rs`, `commit_bytes_checked` and `delete`). On a large
shared folder over OneDrive this stalls every other write from this PC meanwhile: score cells,
presence and PO saves queue behind a rubric delete. Correctness is fine (fail closed, m3 race
closed). Fix: acceptable for now, but note it in the backlog. A cheaper path is to scan outside
the lock, then re-check under the lock only the exam files whose mtime or hash changed since the
scan.

**m5. The real close path is still untested.** The quit guard depends on Tauri's
`onCloseRequested` → `destroy()` (checked in `@tauri-apps/api` 2.12.4: it awaits the handler, then
destroys) and on the new `core:window:allow-destroy` capability. The e2e uses the mock's
`requestClose` only. STATE lists the real-exe check as open. Until it is done, a missing
permission or a reload that drops the listener would show up only as a window that will not
close, or one that closes without saving. Fix: do the exe check before the merge, as planned, and
record the result in STATE. Consider a `tauri-api` unit test with a fake backend for the
`listenCloseRequested` wiring (`ui/src/bridge/tauri-api.ts:441-444`).

## Nits

**n1.** `ui/src/modals/po-beoordelen.ts:502`: a bare `{ ... }` block is left over from the
`saving = (async () => { ... })()` refactor. Remove the braces and dedent.

**n2.** `ui/src/bridge/tauri-api.ts:441-444`: `subscribe<void>` types its callback as
`(payload) => void`, so the close callback's promise is awaited only because
`async () => f()` returns it. A later "cleanup" to `() => { f(); }` would silently stop the wait.
Give `listenCloseRequested` its own wiring instead of `subscribe`, or type the callback as
returning `Promise<void>`.

**n3.** `crates/maatwerk-core/src/storage/mod.rs:472`: `Error::io("", e)` gives the refusal text
"de gedeelde map is onleesbaar (<io error with an empty path>)". The `{e}` in `uses_of`
(`rubrics.rs:107-112`) also puts an English OS message into the Dutch sentence. Pass the root's
display name, or leave the raw error out of the user text and log it instead.

**n4.** `crates/maatwerk-core/assets/templates/rapport-po.typ:183-188`: `_keep` hard-codes the
2 cm margins (`page.height - 4cm`, `page.width - 4cm`). If setup's margins change, blocks that fit
will break, or tall ones will overflow again. Read the margins from one shared constant in the
template, or compare against `page.height - page.margin` if the margin is set as a length.

**n5.** `crates/maatwerk-core/src/validate.rs` (`check_po_scores`, `check_exam_rubric_refs`): the
new warnings are filed as `IssueKind::Shape`, but "scores that never count" and "another rubric
than the original" are reference or consistency issues, not shape issues. Use the kind the other
reference checks in `check_references` use, so that Gegevenscontrole groups them correctly.

**n6.** `ui/src/store.js:1082-1084`: `loadObsUsage` calls `loadRubrics(s)` for each of the four
vakken, and each call reads the whole `rubrics` folder, so the folder is read four times on the
first open. Read it once and fill the four keys. Per PLAN-2's rule (typed modules beside the JS
they touch), the usage logic (`loadObsUsage`, `obsIsUsedInAnyRubric`) could live in a small TS
module that `store.js` calls, rather than adding more untyped code to `store.js`.

**n7.** `2c970d2` (a throwing close handler never keeps the window open) has no test. The catch
sits in the non-injectable `tauriBackend`. Moving the try/catch into `createTauriApi`'s
`onCloseRequested` would make it testable with a fake backend.

## Fixes (implementer, 2026-11-22)

- M1: a quit task reports failure (throws or resolves `false`); a task still running at the 8 s
  limit counts as failed. Then the app asks "Toch afsluiten?" ("Niet alles is opgeslagen…",
  buttons Terug naar de app / Toch afsluiten); Terug keeps the window open (`preventDefault` on
  Tauri's `CloseRequestedEvent`). The score grid's task reports failed or conflicting saves since
  it was registered; Projectgroep beoordelen's returns `save()`'s result (a reload with nothing
  pending is no failure). Unit tests (quit guard) and an e2e (`po-grading.spec.ts`).
- m1: in part with M1 (a timeout no longer closes silently; the teacher is asked).
- m3: a test counts its list as before, a duplicated id included; only a PO's union is deduped
  (test).
- n2: `onCloseRequested` no longer goes through `subscribe<void>`; the callback's result is typed.
- Backlog ("From Step 37"): m2, m4, m5 (the real-exe check), n1, n3-n7.
