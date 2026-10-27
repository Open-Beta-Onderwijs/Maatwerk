# Review: Step 3a (UI foundation)

Reviewer: fresh-context subagent, 2026-10-26. Scope: `git diff 7ae8d24..e1163e0` on
`step/03-ui-foundation`, read relative to the verbatim import (`git diff 8c27793..e1163e0`). I compared
the extracted code against `_reference/renderer/store.js`, `modals/rapport.js` and `utils/csv.js`,
and the MockApi against `docs/reference/ipc-api.md`.

What I ran (PowerShell for npm, Git Bash for the rest):

- `npm run lint`, `npm run typecheck`: clean.
- `npm test`: Vitest 184/184 and node 121/121 pass.
- `npm run test:e2e`, twice: 43/43 pass both times, with no retries configured. I saw no flakes.
- `npm run test:visual -w ui`: 37/37 pass at `maxDiffPixels: 0`. The baseline PNGs date from
  23:13, before the inline-style commit `440795b` (23:29), so the "pixel-identical" claim holds for
  these 37 views (tiny fixture, 1280x2000).
- `npm run build:ui`: `ui/dist` has no `MockApi`, fixtures, `__maatwerkMock*` or `Maatwerk-mock`
  strings. The mock is only reached through `import.meta.env.MODE === 'mock'`. `tauri-api` is a
  0.7 kB stub.
- `npm run licenses`: passes, with the documented `handsontable` warning. `bash tools/check-spdx.sh`:
  clean. No `style=` attribute is left in `ui/src` or the HTML (262 in the reference).
- `MAATWERK_FIXTURE=school vite build --mode mock`: builds. The fixture chunk is 5.4 MB (348 kB
  gzip), which is fine for a dev mock. I did not click through it.

Overall: the domain extraction is faithful. `grades.ts`, `attempts.ts`, `ids.ts` and
`opdrachten.ts` match the reference line by line, apart from types and `sameId`. The `awi`/`bwi`
branch that was dropped from `parseGroupName` was a no-op. Store wrappers keep their default
arguments (`_activeSubject`, `_activeUser`). The quirk fixes B22, T26, T27 and B9 do what
`quirks.md` says. Their golden deviations are applied as narrow transforms (`withPortFixes`,
`FIXED`), and every other case of those suites is compared unchanged. The CSP and style-data
approach works under the mock CSP. Three issues should be fixed before tagging `step-03a`:

- the app CSP blocks the app's own iframes under Tauri;
- the U9 fix can lock a teacher inside the editor;
- CI publishes an exe that contains Handsontable.

## Blockers

None.

## Major

### M1. `frame-ancestors 'none'` stops the app from framing its own editor and PDF viewer

- **Where:** `ui/vite/csp.ts:32`, `src-tauri/tauri.conf.json:25`, also
  `docs/adr/0002-target-architecture.md:184`.
- **Evidence:** `index.html` loads `editor.html` (`#editor-frame`) and `pdf-viewer.html`
  (`.rapport-pdf-frame`, opdrachten preview) in iframes. Tauri 2 serves `app.security.csp` with the
  HTML assets it serves. Delivered as a response header, `frame-ancestors 'none'` stops every
  embedding, same-origin included. The editor and every PDF view would then be blank in the real
  app. Nothing tests this:
  - the mock build delivers its CSP as a `<meta>` tag, which ignores `frame-ancestors`
    (`csp.ts:37` says so);
  - `TauriApi` is still a stub, so the app cannot run under Tauri yet.

  The ADR copied the same directive, so this is a design slip, not only a typo.

- **Fix:** use `frame-ancestors 'self'` in `APP_CSP` and in tauri.conf (the `csp.test.ts` equality
  check keeps the two in step), and update ADR-0002 section 7. Add a Step 6 check: open the editor
  and the rapport in `tauri dev`/the exe with zero CSP reports.

### M2. U9 fix: one failed save locks the teacher in the editor for good

- **Where:** `ui/src/editor-init.js:649-697` (`saveNow`, `flushSave`, `closeAfterSave`). The
  behaviour is documented in `docs/reference/quirks.md` U9.
- **Evidence:** when a write fails, `saving` resolves to `false` and `closeAfterSave` posts nothing.
  Because `saveTimer` is `null` by then, each later click on the app title or the badge returns the
  same failed `saving` promise without trying again. The editor overlay has no other way out:
  closing and logging out both go through the iframe. A short OneDrive lock or a missing folder
  therefore keeps the teacher in the editor even after the cause is gone, unless they type again.
  A lasting failure means killing the app, which loses the very text U9 is meant to protect.
  The e2e test (`ui/e2e/quirks.spec.ts:66`) covers only the success path through the title button.
- **Fix:** on close, if the last write failed, retry `saveNow()` once. If it fails again, ask with
  `confirm`/a dialog ("Niet opgeslagen. Toch sluiten?"; or keep the editor open and show the error).
  Add Playwright cases for (a) a failure followed by a successful retry and (b) a failure followed by
  "toch sluiten", using `MockApi.fail('writeTextFile', …)`. Also cover the badge (logout) path.

### M3. CI uploads an exe that bundles Handsontable

- **Where:** `.github/workflows/ci.yml:71-75` (`npm run build:exe` + `actions/upload-artifact`),
  `ui/src/legacy/globals.ts:8` (Handsontable is in `dist/assets/globals-*.js`).
- **Evidence:** PLAN Step 3 says Handsontable "must not be shipped", and THIRD_PARTY_LICENSES says
  "must not ship". The only safeguard is a line in STATE ("CI exe artifacts must not be distributed
  until then"); nothing enforces it. The repo is meant to be public, and artifacts of a public repo
  can be downloaded. So the first push of this branch, or of `main` after the Step 3 merge if 3b
  slips, distributes proprietary code. The licence check skips the package by design, so it gives
  no warning.
- **Fix:** keep the build step (it proves the exe builds) but drop or guard the upload until 3b
  removes the dependency. For example, add `if: false` with a comment pointing to Step 3b, or make
  the upload depend on `handsontable` being absent from `ui/package.json`. Have the 3b checklist
  remove the guard.

## Minor

### m1. Style data is applied after code that measures layout; the comment says otherwise

- **Where:** `ui/src/legacy/style-data.ts:43-47`, `ui/src/app.js:118-131` (`showModal`),
  `ui/src/modals/toets-overzicht.js:192`, `:345`, `:359`, `:365` (`data-h` on chart containers).
- **Evidence:** the comment says "code that measures right after setting innerHTML calls
  applyStyleData itself". Nothing outside `style-data.ts` and `editor-init.js:46` calls it.
  `showModal` sets `innerHTML` and runs `onShow` synchronously, and the overzicht charts are built
  there. Chart.js therefore reads a container with no height yet (the MutationObserver microtask
  runs afterwards), and only the ResizeObserver corrects it. The final frame matches (the visual test
  waits 1.3 s), but the first layout and animation run at the wrong size. Any code that reads
  `offsetHeight` or `getComputedStyle` in the same task gets stale values. A second, latent risk: a
  `data-display` element shown with `el.style.display = …` in the same task, before the microtask,
  would be hidden again. Today `toetsen.js` only does this after an `await`, so the order is
  correct by luck.
- **Fix:** call `applyStyleData(modalContent)` in `showModal` before `onShow`, and in the few
  render functions that measure right away. Correct the comment. A Vitest/jsdom test that
  `showModal` applies `data-h` before `onShow` runs would pin it.

### m2. MockApi CAS is not atomic

- **Where:** `ui/src/bridge/mock/mock-api.ts:248-255`.
- **Evidence:** `await sha1(current)` yields between reading the current bytes and `putFile`. An
  `externalWrite` from a test, which is synchronous, can land in that gap. It is then overwritten
  without a conflict, the very lost update CAS exists to prevent. The reference compares and writes
  synchronously inside one handler. Today only tests trigger this, but the mock is the CAS emulator
  for every Store test and for 3b.
- **Fix:** compute the hash synchronously (keep a hash per file, updated in `putFile`), or re-check
  `this.files.get(relPath) === current` after the await and return `conflict` when it changed. Add a
  test for "externalWrite during a CAS write leads to a conflict and a retry".

### m3. D25 makes image and clipboard calls reject, but nobody catches them

- **Where:** `ui/src/editor-init.js:1283`, `:1295`, `:1359-1370`, `:1390`, `:1405`, `:1711`
  (`postToParent('maatwerk-list-images' | 'save-image' | 'import-image' | 'clipboard-image' |
'pick-image')`).
- **Evidence:** before the fix these calls hung for ever. Now they reject, the error is unhandled
  in the iframe, and the popup or menu simply does nothing (only a console error). Load and preview
  got proper handling (`Fout bij laden`, `.catch` in `renderPreview`); these paths did not.
- **Fix:** catch these calls and show `setStatus('Fout …', err.message)`, or put one helper around
  them. Add a test with `fail('listOpdrachtImages')`.

### m4. C8 (compare ids as strings) has no test and is not documented as a deviation

- **Where:** `ui/src/domain/opdrachten.ts:174`, `ui/src/domain/rapport.ts:331` (`sameId`). The
  reference used `includes(s.id)`.
- **Evidence:** a group whose `student_ids` holds `"123"` while the student id is `123` now matches.
  In the reference that student got group `—` and sorted last. The change is intended (ADR-0003 C8
  prep), but no test pins it. The domain table in `docs/parity.md` does not mention it, and it is
  only one of several places that compare ids: the Store, `scores.js:797` and the screens still mix
  `===` and `String()`.
- **Fix:** add one Vitest case per function with mixed number and string ids. Add a "C8" note to the
  parity rows for opdrachten and rapport.

### m5. U7: `gebruikers.js` still puts `kleur` into an attribute without escaping

- **Where:** `ui/src/screens/gebruikers.js:159`, `value="${user?.kleur ?? '#4a90d9'}"`.
- **Evidence:** quirks.md U7 says "`gebruikers.js` escapes `kleur`". The badge does, but the colour
  input on the same screen does not.
- **Fix:** use `escHtml(...)` there too, and extend the U7 test to open the user dialog.

### m6. Nothing enforces "domain without window/DOM"

- **Where:** `ui/tsconfig.json` (`lib: DOM` for all of `src`), `ui/eslint.config.js`.
- **Evidence:** the modules are clean today (I checked them with grep). The only rule that keeps them
  that way is a comment, but this is an architecture rule (ADR-0002 section 6; PLAN Step 3a) and
  Step 10 builds on it.
- **Fix:** add an ESLint override for `src/domain/**` with `no-restricted-globals` (`window`,
  `document`, `localStorage`, `navigator`) and `no-restricted-imports` (`../bridge`, `../store.js`,
  `../app.js`).

### m7. ADR-0002 section 7 says to clean up the styling during Step 3; 3a defers it

- **Where:** `ui/src/style.css:2979-…` (128 `u-*` utilities, 189 `!important`), `docs/backlog.md`
  ("Styling cleanup (Step 10)").
- **Evidence:** turning each inline declaration into a pixel-identical `!important` utility was the
  right call for a verifiable refactor. But ADR-0002 section 7 says "the inconsistent styling is
  cleaned up while doing so". Moving that to Step 10 is a deviation from the ADR that is recorded
  only in the backlog. `!important` also changes one behaviour of inline styles: a later
  `el.style.x = …` from JS on such an element is silently ignored. The CSS comment says no JS does
  this today, and my spot checks (`f-epta-btn`, `mc-prof-nav`, `op-obs-group`, `toetsen.js` stats)
  agree. Nothing will catch a future case.
- **Fix:** record the deferral in ADR-0002 (or STATE, "deviations") so the user sees it. In the
  backlog item, note the `!important` rule for anyone touching these elements.

### m8. CSP readiness for real PDFs is unverified

- **Where:** `ui/vite/csp.ts:12-33`, `ui/src/pdf-viewer.js:37`.
- **Evidence:** the mock's PDF uses only Helvetica and loads from a `blob:` URL. Two things are
  untested:
  - in the app, pdf.js will fetch from the output scheme planned in ADR-0002 section 9
    (`maatwerk-out://`), and `connect-src` does not list it;
  - `getDocument` runs with `isEvalSupported` at its default, so embedded Typst fonts may try
    `new Function` and log CSP errors.

  Neither shows up in the mock.

- **Fix:** in Step 6, add the output scheme to `APP_CSP`, pass `isEvalSupported: false`, and run the
  CSP walkthrough on a real compiled rapport. Add this to the Step 6 checklist or the parity table
  now.

## Nits

- **n1.** `ui/src/bridge/mock/mock-api.ts:481` reads `examInfo.title`, but the payload field is
  `name` (`domain/rapport.ts:384`), so the canned PDF always shows the exam id.
- **n2.** `ui/src/bridge/mock/pdf.ts:23` (and the xref offsets) count UTF-16 code units, while the
  bytes are UTF-8. A non-ASCII student name produces a slightly broken PDF, which pdf.js repairs. The
  header says "ASCII only", but the callers pass student names.
- **n3.** `SUBJECT_DISPLAY` now exists twice: `ui/src/domain/rapport.ts:126` and `ui/src/store.js:220`.
  Import one from the other, or note it as an intended copy (ADR-0002 section 6).
- **n4.** `ui/vite/csp.ts:46` (`apply: 'build'`): `npm run dev:mock` runs without any CSP, and the
  Tauri `devCsp` allows `'unsafe-inline'` styles. A new `style=""` therefore shows up only in
  `test:e2e`. Say so in `docs/dev-setup.md`, or add the meta tag in dev mode as well (Vite's own
  style injection would need a nonce, so documenting it is probably enough).
- **n5.** `ui/e2e/csp.spec.ts:15` waits a fixed 600 ms for late violations. In
  `ui/e2e/smoke.spec.ts:14-18`, `examMenuItem` retries with `toPass` to work around a re-render race
  in the exam list. Both pass reliably now (2 of 2 runs), but the retry would also hide a real
  regression in that list. Consider waiting for a "list rendered" signal instead.
- **n6.** `ui/playwright.config.ts:31`: `reuseExistingServer` outside CI reuses whatever already
  listens on :4173, for example a preview of an older `dist-mock`.
- **n7.** `ui/src/screens/scores.js:783`: the U3 message tells the teacher to enter the score again.
  The cell still shows the value, so typing the same value may not count as a change. This is fine
  for 3a; carry it into the 3b grid spec (save state per cell).

## Triage (implementer, 2026-10-27)

| Id  | Outcome                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Fixed: `frame-ancestors 'self'` (`ui/vite/csp.ts`, `tauri.conf.json`); ADR-0002 section 7 notes the amendment (user to confirm). |
| M2  | Fixed: close retries a failed save, then asks before discarding; e2e "U9: after a failed save…" (written first, failed first).   |
| M3  | Fixed: CI builds the exe but no longer uploads it until 3b removes Handsontable.                                                 |
| m1  | Fixed: `showModal` applies style data before `onShow`; comment corrected. Covered by the visual and CSP walkthroughs.            |
| m2  | Fixed: the mock re-checks the file after hashing; test "CAS: a write landing while the hash is computed…" (failed first).        |
| m3  | Fixed: `askParent` in `editor-init.js` reports failed figure/clipboard calls; e2e "D25: a failed image call…".                   |
| m4  | Fixed: "C8" tests in `tests/domain/opdrachten.test.ts` and `rapport.test.ts`; parity rows mention C8.                            |
| m5  | Fixed: colour input escaped; e2e "U7: the user dialog keeps the colour attribute intact".                                        |
| m6  | Fixed: ESLint override for `src/domain/**` (restricted globals and imports).                                                     |
| m7  | Recorded as a deviation in ADR-0002 section 7 and in the backlog (`!important` note); for the user to confirm.                   |
| m8  | Backlog: Step 6 CSP checklist.                                                                                                   |
| n1  | Fixed (mock reads `examInfo.name`). n2: fixed (non-ASCII prints as `?`). n3: fixed (one `SUBJECT_DISPLAY`).                      |
| n4  | Documented in `docs/dev-setup.md`. n5: backlog. n6: fixed (`reuseExistingServer: false`). n7: added to G53 in the grid spec.     |
