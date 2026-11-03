# Review Step 7c: perceived speed

Reviewer: fresh-context subagent, 2026-10-31. Scope: `git diff step-07b..HEAD` on
`step/07-data-v2` (commits `269a203..3e27990`), against PLAN.md Step 7 "7c", sections 2.2-2.5
and Appendix C. Builds and test suites were not run (the gate had already passed); findings come
from reading the code, the tests and the reference.

## Summary

The step does what the plan asks, and the mechanisms are mostly sound. `Store.generation` is a
Proxy over the cache: it counts replacing or dropping an entry, and every own write path
(`update`, `saveVersioned`, deletes, `cacheUser`, opdracht folder copy and delete) adds an
explicit `changed()`. The view key adds filters, user, role and vak. The score-modal prebuild
cannot write presence: `Presence.setPosition` and `markEdit` do nothing until `setScoreModal`
has run, and only the real modal calls it. Every `await` in `loadScoreGrid` is followed by a
`buildToken` check before it touches module state. `read_json_dir` goes through `rel()` and
`spawn_blocking` and matches the per-file reads for missing and corrupt files.

I found no blockers and three majors. The staged Leerlingen list breaks the scroll position that
a background refresh is meant to keep, a reference behaviour (M1). `generation` also grows on
colleagues' changes in other vakken and on files that are not cached, so in a busy school the
kept screens and the prebuild are thrown away much more often than in the measured, quiet run
(M2). `preloadScores` reads and sends whole score folders over IPC again on every render, even
when every record is cached. The admin's Leerlingen search does this for all years and vakken on
each keystroke (M3).

## Findings

### Blockers

None.

### Majors

#### M1. A background refresh of Leerlingen loses the scroll position (more than 60 students)

- **Where:** `ui/src/app.js:1166-1172` (`runScreenRefresh`), `ui/src/screens/leerlingen.js:221-225`.
- **Evidence:** `runScreenRefresh` saves `pageY`/`screenY`, runs `await cfg.render()` and then
  sets the scroll position back. For Leerlingen, `render` is `renderStudentList()`. That function
  is synchronous, but it now puts only the first 60 cards in the DOM and leaves the rest to
  `inIdleSlices`. When the scroll position is restored, the page is only ~60 cards high, so a
  teacher who scrolled down to card 400 is clamped to near the top, and the later slices do not
  restore it. This happens on every colleague change to students or groups (`types: ['students',
'group']`) while Leerlingen is open, with a real list of 500+. The reference keeps the position
  (`_reference/renderer/app.js:1032-1035`), and so does the comment above `SCREEN_REFRESH`
  ("Filters, the selected year and the scroll position are kept"). No e2e covers this: the
  existing refresh tests use fewer than 60 students.
- **Fix:** have `renderStudentList` return the idle job's `done` promise (or return
  `{ done }`) and let `runScreenRefresh` restore the scroll after it. A simpler option is to
  render all cards at once when the call comes from a refresh (or whenever the saved position
  is past the first batch). Add an e2e: 150+ students, scroll to the last card, `externalWrite`
  the students file, and check that `scrollY` stays the same (allow some tolerance).

#### M2. `generation` grows on every colleague change, even out of scope or uncached

- **Where:** `ui/src/store.js:1192-1193` (`applyExternalChange`: `changed()` for every type
  except presence, opdrachtTyp and other); `ui/src/screens/scores.js:270-288` (`takePrebuilt`
  compares `generation`).
- **Evidence:** the `scores` case does nothing when `cache[relPath] === undefined` (another vak,
  or a student never read), but the final `changed()` still runs. The same holds for an exam or
  group of another vak that `patchCachedArrays` did not touch. The watcher reports the whole
  active year for every vak (`setWatchYear`), so every score save by a bio colleague invalidates
  the nat teacher's six kept screens and any prebuilt grid. On the next tab visit everything
  renders again, as before Step 7c. The Proxy already counts a replaced cache entry, so the
  extra bump is only needed for in-place `patchCachedArrays`/`users[i] =` changes. The
  measurement (`docs/perf.md`) ran on a quiet folder with no colleagues, so it shows the best
  case. The real benefit depends on this.
- **Fix:** bump only when the cache changed: in the scores, students and school cases the Proxy
  already does it; for exam and group, call `changed()` when `patchCachedArrays` replaced,
  removed or added an entry (let it return a flag); for gebruikers, when `users` was patched;
  for observatie and opdracht, when a cache was dropped (the Proxy counts that). Add a Vitest
  case: an external score change in another vak, or to an uncached file, leaves `generation`
  unchanged, and a change to a cached record raises it.

#### M3. `preloadScores` reads whole folders again on every render, also when all records are cached

- **Where:** `ui/src/store.js:795-826` (`preloadScores`: "Each call reads the folder again");
  callers `ui/src/screens/leerlingen.js:233-235` (admin, every `renderStudentList`, which also
  runs on each `oninput` of the search box), `ui/src/screens/groepen.js:277-278` (each
  `renderGroepenForYear`, including background refreshes on colleagues' score saves:
  `SCREEN_REFRESH.groepen.types` contains `scores`), `ui/src/screens/toetsen.js:65`.
- **Evidence:** the folder read skips decoding for records already cached, but the backend
  still reads every file and the webview still receives and parses the full JSON of every
  score file in the folder. For the admin that is years x 4 vakken folders per keystroke in
  the search field. Before Step 7c a repeat render cost no IPC at all, because every record was
  cached after the first check. The perf run only measured the first (cold) checks
  (`leerlingen:checks` 575 ms at 4x), so this regression does not show in `docs/perf.md`. The
  stated reason for re-reading ("a file a colleague added since is never missed") does not hold
  after the first read: the read caches absent files as `null`, and `applyExternalChange`
  refreshes a `null` entry (`cache[relPath] === undefined` is false), so the watcher already
  covers new files.
- **Fix:** skip the call when every `ids` entry is already defined in the cache (for example
  `if (ids.every((id) => cache[ypScore(year, subject, id)] !== undefined)) return;`), or remember
  a finished folder read per `dir` until an invalidation. Add a Vitest case: a second
  `preloadScores` after the first makes no `readJsonDir` call. Measure the admin search
  (type 3-4 letters) in `tools/perf/measure.mjs`.

### Minors

#### m1. `docs/perf.md` describes the modal span wrongly and leaves out the cost that moved to the menu

- **Where:** `docs/perf.md:44` ("`modal:scores` from 'Scores invoeren' to the first paint with
  all grids"), `:121-133`, `:144-148`; `ui/src/screens/scores.js:455-468`;
  `tools/perf/measure.mjs` (`--menu-ms`, default 300).
- **Evidence:** after the change, `endOpen` runs on the first paint after the **first** group
  (`shown`; the second call at the end is a no-op because `perfSpan` ends once). The baseline
  209 ms was four grids built and painted; the 48 ms after is one prebuilt grid moved into the
  modal. The script waits 300 ms between opening the menu and clicking, so the prebuild (read,
  compute, `createGroupGrid`, the forced layout of `offsetWidth`) runs before the span starts.
  That work runs synchronously while the menu opens, but `menu:exam` only covers
  `buildMenuItems`, and the "After" table does not list it. The user-visible result may well be
  better, but the comparison uses different end points, and nobody measured the menu's own
  latency (and the modal span with `--menu-ms 0`, a quick clicker). Also `tab:toetsen` p90 at 4x
  got worse (101 to 113); the text only calls it "first visit after login".
- **Fix:** correct the "How it is measured" line (end = first group painted; add a
  `modal:scores:all` span at the end of the build if the full time matters); measure
  menu-click-to-menu-paint, including the prebuild, and the modal with `--menu-ms 0`, and put
  both in the "After" table; say in the budget paragraph that p90 of `tab:toetsen` regressed.

#### m2. "Opdrachten genereren" can now fail on a folder read error

- **Where:** `ui/src/store.js:1017-1023` (`getOpdrachtAssignments`: `preloadScores` inside
  `Promise.all`, no `catch`).
- **Evidence:** before Step 7c `preloadScores` was per-file `readJson` calls, and
  `tauri-api.ts` `orElse` maps their errors to `null`, so it never rejected. Now an I/O error on
  `read_dir` (not NotFound: access denied, a OneDrive glitch, no storage open) rejects
  `readJsonDir` (`orThrow`), and so the whole assignment computation fails, although the
  per-record `getStudentScores` right after it would have worked. All other callers add
  `.catch(() => {})`.
- **Fix:** `preloadScores(year, subject).catch(() => {})` there too (or catch inside
  `preloadScores` and fall back to the single reads it already supports).

#### m3. The folder read and the single read disagree on invalid UTF-8

- **Where:** `crates/maatwerk-core/src/storage/mod.rs:310-312` (`read_all_json_named`:
  `std::str::from_utf8` fails, so the file is skipped) vs `:552-556` (`parse_json`:
  `String::from_utf8_lossy`).
- **Evidence:** a score file with a stray Latin-1 byte (for example after a hand edit) used to
  load via `readJson` with a replacement character; now `preloadScores` skips it and caches it
  as `null`, so Toetsen, Groepen and the score modal show the student without scores. A later
  save still reads the file fresh (`update`), so no data is lost. This was latent in
  `read_all_json` before, but score files now go through it.
- **Fix:** use the same decoding (`parse_json`, ignoring its error) in `read_all_json_named`,
  and add a Rust test with a non-UTF-8 file that both functions read the same way.

#### m4. Data loaded after an invalidation does not count, so a render in that gap stays stale

- **Where:** `ui/src/store.js:66-83` (Proxy: "filling an empty one from disk does not"),
  `:759-779` (`upsertObservation`/`deleteObservation`: `invalidateObsCache()` then `await
loadObservaties`), `:934-962` (opdrachten), `:294-296` (`loadInstellingen`).
- **Evidence:** the bump happens when the entry is dropped; the reload (an IPC call later) only
  fills it. If a kept screen renders inside that window (a `runScreenRefresh` timer or a tab
  click), `_renderedAs` stores the new key and the screen shows an empty list; when the reload
  finishes nothing bumps, so the screen stays empty until the next change. The window is short
  and usually covered by the modal, so this is unlikely. In the other direction,
  `loadInstellingen` and `school.js` `invalidateSchool` bump on every visit of those screens, so
  all kept screens render again for nothing.
- **Fix:** count a fill of a key that was dropped earlier (keep a `Set` of dropped keys in the
  Proxy; a fill of such a key calls `changed()`), or call `changed()` after the reloads in those
  functions. Use `load`-without-invalidate for Instellingen (`readJsonVersioned` already gives the
  rev).

#### m5. Tests do not reach the staged paths

- **Where:** `ui/e2e/perceived-speed.spec.ts:107-144`, `ui/tests/store/generation.test.ts`.
- **Evidence:** "later groups ... get colleague changes" sends the change only after the second
  grid is visible, so it tests `rowUpdaters` on built grids, not a group that is still waiting
  for idle time (the case the "read right before building" comment is for). Nothing tests
  closing the modal while groups are pending (token check after `nextIdle`), the 15 s TTL, a
  second menu replacing a prebuild, or that the prebuild is actually used. The `.sc-prebuild`
  count is 0 after both take and discard, so a regression to "always discard" would pass every
  test. No test covers M1-M3.
- **Fix:** add e2e cases: (a) hold idle time (stub `requestIdleCallback` through
  `page.addInitScript`), write a colleague's score for a student of group 2, then release and
  check the cell; (b) close the modal while group 2 is pending, then open another exam: no
  errors and no extra grid; (c) mark the prebuilt table (`data-pre="1"`) and check that the
  modal's first table still has the mark. Vitest for M2/M3 as above.

### Nits

- **n1.** `ui/src/screens/scores.js:270-288`: `takePrebuilt` checks exam, year, token and
  generation, but not the user or the vak. A logout and login within 15 s
  (`PREBUILD_TTL_MS`) could reuse grids built under the previous session (the same scores, so
  low impact). Discard the prebuild in `logOut` (or add the user id to the check).
- **n2.** `ui/src/screens/scores.js:480-482`: the close callback calls `renderToetsenList`
  directly but leaves `_renderedAs.toetsen` old, so the next visit to Toetsen renders and
  computes the statistics again. Export a "mark rendered" hook or go through `renderScreen`.
- **n3.** `ui/src/utils/perf.ts`: `performance.measure` entries are never cleared. In release
  builds a whole school day of tab switches and score modals (four spans per group) accumulates
  in the timeline. Clear `mw:*` measures every N entries, or only record them when a flag
  (`localStorage`, DevTools) is set.
- **n4.** `ui/src/app.js:70-73`: `tab:groepen` and `tab:toetsen` end after the paint following
  `renderGroepen()`/`renderToetsen()`, which do not return their inner promise
  (`renderGroepenForYear` awaits `loadUsers`). On a visit where users are not cached yet, the
  span ends before the list is in the DOM. Return the inner promises.
- **n5.** `ui/src/style.css:266-270`: `contain-intrinsic-size: auto 40px` is a guess. Cards that
  were never shown count as 40 px, so the scrollbar length and any restored scroll position
  (see M1) are off until the user has scrolled past them. Measure a real card height.
- **n6.** `ui/src/store.js:802-826`: for the admin, `_activeSubject` is `null`, so
  `renderToetsen` preloads `<year>/scores/null`. That read is harmless (an empty folder),
  but it caches `null` entries for every student under that key. Skip `preloadScores` when
  there is no subject.

## Checked and found fine

- **Presence before open:** `Presence.setScoreModal` is called only in the modal's `onShow`
  (`scores.js:391`); `setPosition`/`markEdit` return early while `own.scoreModal` is null, so
  neither the prebuild nor a grid selected in it can write presence. The hidden host
  (`visibility: hidden`, `aria-hidden`) cannot take focus, and the grid's document
  `copy`/`paste` listeners check `ownsFocus()`.
- **Prebuild races:** `loadScoreGrid` takes its token synchronously and checks it after
  `await saveChain`, after `nextIdle()` and after the score reads, before it writes
  `activeExam`, `activeObs`, `gridInstances` or the DOM. `discardPrebuilt` destroys only grids
  that are still current (`token === buildToken`) and releases `held`, so a held build stops.
  `takePrebuilt` clears the TTL timer; `prebuildScoreModal` does nothing while a modal is open;
  closing or replacing the modal runs `resetScoreModal` (token++) through `clearModalSubs`. The
  `onModalSync` handlers are registered in the same task as `takePrebuilt` (`showModal` calls
  `onShow` synchronously), so no event can fall between them. `recomputeAllRows` covers the
  built groups, and later groups use `activeExam` with the current N-term.
  The e2e "a change while the exam menu is open" does test the generation discard: the mock
  emits synchronously, and without the discard the modal would show the old value.
- **Grid layout off-screen:** no grid CSS depends on a `#modal-box` ancestor except the heading
  size, so the `offsetWidth` measured in `.sc-prebuild` gives the same `maxWidth` result.
- **Folder read vs. single reads:** a missing folder gives `[]`; corrupt, `null` and unreadable
  files are skipped by the folder read and are `null` via `readJson`'s `orElse`, so both cache
  "no file". `note_stamp` (C19) runs for each file in both. Cached entries are never
  overwritten; the in-flight read is shared and removed in `finally` with its rejection handled;
  `getStudentScores` waits for it and falls back to a single read when the file was not in it.
  The `null` fill runs before `getStudentScores`' continuation (Vitest "reads the folder once").
- **examResults memo:** callers (`toetsen.js`, `groepen.js`, `groep-leerlingen.js`,
  `profiel.js`) only read the result. Score records are never edited in place (every write
  replaces the cache entry with `update`'s fresh object), and exams are edited on copies
  (`toets-edit.js:284` deep copy, `activeExam = { ...exam }`). The memo also compares `n_term` and
  the `questions` identity, which is all `examResults` reads besides `id`.
- **Kept screens, other inputs:** filter changes go through `rerenderActive`
  (`_filterGeneration`); year selectors render their screen directly; login, role and vak are
  in the key; `forgetFile`, `cacheUser`, `invalidateSchool` and the opdracht folder operations
  bump. Bridge writes outside the Store (photos, PIN reset) are followed by `upsertUser` or
  `cacheUser`. Toetsen presence badges update through `Presence.onChange` on the kept DOM;
  Opdrachten shows nothing derived from `.typ` files, so excluding `opdrachtTyp` is right.
  None of the kept screens shows times or local state outside the key.
- **Leerlingen:** the delegated handler checks `closest('button[data-action]')`, `disabled` and
  containment; clicks on the SVG icons inside the buttons reach their button; the cards contain
  no other `data-action` elements. `_listJob.cancel()` runs before every re-render, including
  the empty-list path. Late checks write to their own render's button map (detached buttons are
  harmless). The removed teacher checks had no visible effect: before 7c the teacher's cards
  had no `del-student` button, so the `querySelector` returned null and the callback returned.
  Their only side effect was warming the score cache.
- **Security/CSP:** the new HTML is escaped (`escHtml` for names, headings and group names); the
  prebuild and staging use DOM APIs and CSSOM styles only, no inline handlers. `read_json_dir`
  validates through `rel()` (rejects `..` and absolute paths), `Storage::resolve` handles symlink
  escapes, and symlinked entries are skipped (`file_type().is_file()`).
- **Architecture:** `maatwerk-core` gains `read_all_json_named` with no `tauri`; the command
  only maps tuples to `NamedJson` and runs in `spawn_blocking`; the bindings, `MaatwerkApi`, the
  mock and `TauriApi` are updated together. SPDX headers are present on all new files.
- **Tests:** `idle.test.ts` (order, slicing, cancel, empty) and `perf.test.ts` (end once, sync
  and async, throw and reject) are not vacuous; the Rust test covers garbage, `null` and a
  missing folder. The "keeps its DOM" e2e uses a DOM mark, so it really detects a re-render.
- **Disk cache:** none was added, as the measurements justify; nothing is written to the shared
  folder.

## Triage (implementer, 2026-10-31)

| Id     | Decision                                                                                                                                                                                                                                    | Where                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| M1     | Fixed: a background refresh renders the whole list at once (`renderStudentList({ staged: false })`), so the scroll position is restored over the full list. e2e "review 7c M1" (fails without the fix: 2151 instead of 3000).               | `leerlingen.js`, `app.js`                                |
| M2     | Fixed: `applyExternalChange` no longer bumps on every change; only a changed cache entry counts (Proxy set/delete, plus `patchCachedArrays` and the user list when they change an array). Vitest "M2" (another vak's file, an unread exam). | `store.js`                                               |
| M3     | Fixed: `preloadScores` makes no call when every requested record is cached (absent files are cached and refreshed by the watcher). Vitest "M3".                                                                                             | `store.js`                                               |
| m1     | Fixed in `docs/perf.md`: what `modal:scores` measures before and after, the 300 ms menu pause, the Toetsen p90 going from 101 to 113 ms.                                                                                                    | `docs/perf.md`                                           |
| m2     | Fixed: `getOpdrachtAssignments` catches a failed folder read and falls back to the single reads.                                                                                                                                            | `store.js`                                               |
| m3     | Fixed: `read_all_json_named` decodes invalid UTF-8 with replacement characters, as `read_json` does; `read_all_json` keeps skipping such files (reference). Test `read_all_json_named_decodes_invalid_utf8_like_read_json`.                 | `storage/mod.rs`                                         |
| m4     | Fixed for the stale case: observatie and opdracht changes count again after the reload. The extra re-renders after `loadInstellingen` / `invalidateSchool`: backlog (harmless).                                                             | `store.js`, backlog                                      |
| m5     | Partly: the prebuild test now checks that the modal shows the prebuilt table (`data-pre`), and M1-M3 have tests. Held idle time, closing with groups pending, the TTL: backlog.                                                             | `perceived-speed.spec.ts`, `generation.test.ts`, backlog |
| n1     | Fixed: the prebuild records user and vak and is used only for the same login.                                                                                                                                                               | `scores.js`                                              |
| n3     | Fixed: the span buffer is cleared every 5000 spans.                                                                                                                                                                                         | `perf.ts`                                                |
| n4     | Fixed: `renderGroepen` and `renderToetsen` return their inner render promise.                                                                                                                                                               | `groepen.js`, `toetsen.js`                               |
| n6     | Fixed: `preloadScores` does nothing without a vak. Vitest "n6".                                                                                                                                                                             | `store.js`                                               |
| n2, n5 | Backlog.                                                                                                                                                                                                                                    | backlog                                                  |
