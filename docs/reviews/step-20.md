# Review: step 20 (Toetsen: test kinds, attempts, test modals, resits)

Scope: `4bd1528...HEAD` (branch `step/20-toetsen`, commits `caa9d63`, `9d30b69`; 28 files, +3280/-1754)
plus the uncommitted docs and version bump. Reviewer: fresh-context subagent, checklist PLAN.md
Appendix C. I compared the code with the old versions (`git show 4bd1528:<path>`) and did not use
STATE or the commit messages as evidence.

How findings were verified: by reading the code paths named in each finding, unless it says
otherwise. `npx vitest run` on `exam-info.test.ts` and `question-structure.test.ts`: 21 passed. I did
not run e2e or cargo (a gate run was in parallel), nor the real Tauri app, so no failure scenario
below was reproduced at runtime.

## Verdict

Not ready to merge until M1 and M2 are fixed. The conversion is faithful: I found no lost behaviour
and no changed number. The two majors concern saved data.

| Severity | Count |
| -------- | ----- |
| Blocker  | 0     |
| Major    | 2     |
| Minor    | 6     |
| Nit      | 10    |

## Majors

### M1. Every diagnostic test saved by the UI gets a warning in Gegevenscontrole

- **Where:** `ui/src/modals/toets-nieuw.ts:221`, `ui/src/modals/toets-edit.ts:413,418`,
  `ui/src/modals/herkansing.ts:227` against `crates/maatwerk-core/src/validate.rs:479-491`.
- **What:** the three save paths keep `weging_se` on a diagnostic test (deliberately, see the comment
  at `exam-fields.ts:110-112`). The validator warns when `weging` **or** `weging_se` is non-zero on
  a diagnostic test. The spinner's default is 1, so the UI's own output always trips it.
- **Scenario:** Nieuwe toets, tick D, Verder, Opslaan. Saved: `diagnostic: true, weging: 0,
type: 'regular', weging_se: 1`. Gegevenscontrole then reports "Een diagnostische toets telt niet
  mee, maar heeft een weging". The same happens with D on the Verzamelkaart of a PTA test with
  `weging_se: 20`, on the original and on every attempt. The number is harmless (`se_average` needs
  `is_pta`, `averages.rs:54-57`), but teachers get a false warning for correct data.
- **Not caught because:** `ui/e2e/toetsen.spec.ts:202` does not assert `weging_se`; the validator test
  (`validate/tests.rs:337`) only sets `weging`.
- **Fix:** check only `weging` in the validator, because keeping `weging_se` lets unticking D restore
  it. Add a validator test with `weging: 0, weging_se: 1` that expects no warning, and assert
  `weging_se` in the e2e test. If the user prefers `weging_se: 0` on saving, change `kindFields`
  instead and accept that unticking D later shows 0.

### M2. A refused save has already deleted observatie indications, and says "Niet opgeslagen"

- **Where:** `ui/src/modals/toets-edit.ts:432-455`; the message is at `ui/src/app.js:611-620`.
- **What:** the order is (1) remove indications from the score files of the original and all attempts,
  (2) write the attempts, (3) write the original. If (3) is refused (conflict, or a locked file;
  `locked` is not retried, quirk D4), the handler rejects and the teacher reads "Niet opgeslagen: dit
  is intussen gewijzigd. Sluit het venster en open het opnieuw." By then the indications are gone from
  every attempt's score files, and that cannot be undone. The old code also removed before writing,
  but only for one exam; F-12 widens the damage to all attempts.
- **Scenario:** teacher A opens 501 (with 501-H, both with scores) and removes observatie X, confirming
  the dialog. Colleague B saves 501 just before A clicks Opslaan, before A's sync notice arrives. A
  gets "Niet opgeslagen" and reopens: 501 still lists X, but all ticks for X are gone from 501 and
  501-H, and 501-H no longer lists X.
- **Fix:** remove the indications last, after all exam writes. A failure then leaves only orphan ticks,
  which every reader ignores (`toets-overzicht.js:110,146` skip ids not on the exam). Add a test: a
  refused save of the original leaves `observations` untouched.

## Minors

### m1. Removing a just-added observatie deletes an attempt's own indications while it stays listed

- **Where:** `ui/src/modals/toets-edit.ts:358-365,432-436`, `ui/src/domain/exam-info.ts:113`.
- **Scenario:** original `[a]`, migrated resit `[a, x]` with ticks for x. In the original's editor,
  click x on (confirm), then off again (confirm). `deselectedObs` now holds x, so the ticks are removed
  from the resit, but `resitObsIds` sees x outside `before` and keeps it on the resit. The resit lists
  x with its ticks gone.
- **Fix:** remove only ids that were in `obsBefore`:
  `[...deselectedObs].filter((id) => obsBefore.includes(id))`.

### m2. After a halfway failure a gained observatie stays on the attempt for good

- **Where:** `ui/src/modals/toets-edit.ts:437-444`, `ui/src/domain/exam-info.ts:108-115`.
- **What:** the comment says a failed save can be repeated. That holds only in the same open editor,
  and the conflict message tells the teacher to close it. If x was added and the attempts were written
  before the original was refused, the attempt has x and the original does not. From then on x counts
  as "only the resit has it": `resitObsIds(['a','x'],['a'],['a'])` keeps it, and it is locked in the
  resit's editor, so no screen can remove it. A lost observatie heals on the next save of the
  original; a gained one does not.
- **Fix:** adding x to the original and removing it again does clear it, so document that route in the
  comment, or check the original's revision before writing the attempts. The user can also accept
  this; it needs a conflict at exactly this moment.

### m3. B-05 is still open for a student with no grade in any attempt

- **Where:** `ui/src/modals/toets-overzicht.js:97,105`; `bestAttempt` returns null without a grade
  (`ui/src/domain/attempts.ts:46-47`).
- **Scenario:** a student has only observaties ticked on 501-H and no scores. There is no best-map
  entry, so the summary reads `observations[501]` and the row is empty. The code keeps the comment
  "Track observations even if no scores", and the single-test overview does show this student's ticks.
- **Fix:** in the summary without an entry, read the union of the observations of all attempts. Add it
  to the B-05 e2e test.

### m4. A diagnostic test counts in the profile's RTTI "Gem." (needs a decision)

- **Where:** `ui/src/modals/profiel.js:860-864`, `crates/maatwerk-grades/src/rtti.rs:25`.
- **What:** the year view pools every test, weging 0 or not; the UI says a diagnostic test "telt niet
  mee voor rapport of SE". Decisions 6, 12 and 14 name rapport, SE, year average and trend, and the
  grade rules document does not cover pooled RTTI for diagnostic tests. The SE view is correct: it
  filters on `pta`. D could not be set in the UI before this step, so this now becomes reachable.
- **Scenario:** a student with 10/40 on a diagnostic test and 8/10 on a normal test sees a year Gem.
  based on 18/50, not 8/10.
- **Fix:** ask the user. If diagnostic tests must leave the Gem., filter `counting`, with a
  before/after table (PLAN-2 "Numbers"). Otherwise record the decision.

### m5. Selected state of most toggles is not exposed to assistive technology

- **Where:** `ui/src/modals/toets-nieuw.ts:65,75-78`, `ui/src/modals/exam-fields.ts:63`,
  `ui/src/modals/toets-edit.ts:119,125,133`.
- **What:** Schoolsoort chips, Jaarlaag, Periode, Subcategorie, and the Opgave, Max punten and RTTI
  buttons carry their state only in a class. The mock has `aria-pressed` on the Schoolsoort, Jaarlaag
  and Periode buttons, and the observatie chips here have it too (`toets-edit.ts:216`). The old code
  lacked it as well, so this is a spec gap and not a regression.
- **Fix:** set `aria-pressed` in `segmented` and in the row buttons, and update it where `selected`
  toggles. A group label (`role="group"`, `aria-labelledby`) would complete it.

### m6. Test gaps around the data paths

`ui/e2e/toetsen.spec.ts`, 16 tests. What they assert holds, and the B-05 test would fail on the old
code. Missing:

- Indications removed from an attempt's score file: the path that deletes data has no test. The test at
  `:364` stops at `obs_ids`, and nothing in `ui/e2e` or the unit tests checks it (grep).
- The confirm dialog when only an attempt has scores (`attemptsHaveScores` with `hasScores` false), and
  adding an observatie reaching an attempt end to end.
- Locked top fields: saving an attempt and an original with attempts leaves `type`, `periode`, `weging`
  and `weging_se` unchanged.
- Verzamelkaart: `obs_ids`, `description` and the resit's title after saving; only D is tested (`:387`).
- `weging_se` of a diagnostic test (M1).
- B-05 negative case: best attempt is the original, the resit has another observatie, and the row shows
  only the original's. Also m3.
- Wiskunde: no e2e touches `.sub-btn`, so the jaarlaag/subcategory interlock moved to
  `toets-nieuw.ts:131-170` is untested (it is identical to the old code by reading).
- Nieuwe poging keyboard: only one ArrowRight wrap; not `tabindex` or that focus stays on the card
  after arrowing to Anders.
- Unit: `questionSummary` with a `diag` question and a half percentage (12,5%), an unknown `kind` in
  `pointTotals` (decision 23), `secIndexOf`, and a boundary round trip in `alpha` mode.

## Nits

- **n1.** `ui/src/styles/toetsen.css:72-81`: grey italic applies only under `.exam-card--diagnostic`.
  Attempt cards of a diagnostic test get a grey badge, but their mean is in normal text.
- **n2.** `ui/index.html:306`: `aria-label` on a `div` without a role is ignored; use `role="group"`.
- **n3.** `ui/src/modals/toets-edit.ts:231-232`, `toets-nieuw.ts:47-48`, `herkansing.ts:65-66`: spec 4.11
  and the mock have Annuleren before the primary button; the code has it after. This matches every other
  modal in the app, so change it everywhere or note it in the spec.
- **n4.** `ui/src/modals/exam-fields.ts:36`: `data-val="${o.value}"` is not escaped, and the value comes
  from the exam JSON (`n_term`, `weging`), which the core reads leniently, so it can be a string. Old
  code too, CSP limits it. Use `esc(o.value)`. Every other text in the new HTML is escaped; there are no
  inline `style=` attributes.
- **n5.** `ui/src/screens/toetsen.ts:316-326`: a rejected stats promise leaves the skeleton on the card for
  good (`allSettled` hides it). The old span stayed hidden. Remove the slot on rejection.
- **n6.** `ui/src/screens/exam-cards.ts:95`, `exam-fields.ts:175`: an exam without `volgnummer` reads
  "Observaties van " and "overgenomen van ". Fall back to "het origineel".
- **n7.** `ui/src/domain/exam-info.ts:24`: `s + q.max_points` concatenates a string `max_points`, which the
  core accepts (`model.rs:107`). The old total came from `calcResults`, so card and grade can now disagree
  on such data. `validate.rs` does not check `max_points`. Coerce with `Number()`.
- **n8.** `ui/src/modals/toets-overzicht.js`: spec 2.5 asks for the type badge in overview modals; it has
  none. Probably step 29 (F-11), not checked further.
- **n9.** `ui/src/store.js:880-890`: `examHasScores` ignores `observations`, so an attempt with only ticks
  gets no confirm and the ticks stay behind as orphans. Harmless, as before.
- **n10.** `ui/src/modals/exam-fields.ts:114-139`: old data with `diagnostic: true, type: 'pta'` opens with
  both boxes ticked, against "exclude each other". Saving normalises it to `regular`, also through locked
  fields. The validator reports such data as an error already.

## Checked and found correct

- **Conversion:** filter logic, sort, wiskunde subcategory badge and interlock, ⋮ menu items and block
  reasons, presence badges, warning icons (same slots as before), close guards (Nieuwe toets, editor;
  Nieuwe poging and Verzamelkaart had none), sync notices, spinners, question editor handlers, delete
  guard. The old re-exports from `screens/toetsen.js` have no remaining importers.
- **Saved fields:** Nieuwe toets, editor, Nieuwe poging and Verzamelkaart write the same fields as before
  plus `diagnostic`; `kind` comes from `withExamDefaults` in `upsertExam`. D gives `diagnostic: true,
weging: 0, type: 'regular'` through `kindFields`. `weging_se` keeps its value and its fallback. Locked
  saves read from the exam, not the form. An attempt inherits D from `...parent`.
- **Numbers:** `computeExamStats`, `computeExamWarnings` and `computeBestGradeStats` are unchanged code.
  `pointTotals` agrees with decision 5 and `qKind` (bonus outside the maximum, diag in nothing, unknown
  kind normal). No `||` on a weging anywhere in `ui/src`: the only JS reads use `??` in the modals and
  `exam-info.ts`; everything else goes through the rules. Rust: `weight()` treats 0 as 0, `weighted` drops
  it, the trend needs weging above 0, the rapport reads no other tests.
- **F-12:** attempt editor saves `obsBefore`, offers no chips; Verzamelkaart spreads `...parent` and
  `...resit` and sets no `obs_ids`; propagation is limited to an edited original and writes only changed
  attempts; the confirm dialogs follow `attemptsHaveScores`; T33 keeps ids not on offer, documented in quirks.
- **B-05:** non-summary overviews take the unchanged path (`scoreOverride` null, `isSummary` false; only
  caller with an override is `herkansing.ts:174`). `obsAccum` skips unknown ids, counts the attempt that
  counts. Tabs from Vraaganalyse on, including Observaties, are disabled in the summary, so the visible
  effect is the Resultaten columns.
- **CSP and escaping:** all new strings through `esc`/`escHtml`, except n4; styles through `data-*` and
  CSSOM (`skelLine` uses `data-w`, `applyStyleData` runs on the list and on modals).
- **Accessibility:** closed tree has `inert`, `visibility: hidden` and `aria-expanded`/`aria-controls`;
  radiogroup has roving `tabindex` and arrows with wrap, the focus trap skips `tabindex=-1`; disabled steps
  are real disabled tabs and stay out of the arrow keys; reduced motion covers tree and chevron; every new
  token exists, `--tree-line` in both themes.
- **Spec and mocks:** header order, legend, card, tree (28 + 22 px, line lengths), lock pill text and tooltip,
  Nieuwe toets grid, D note, Toets bewerken top row and sticky heading, Nieuwe poging texts. Deviations noted
  by the implementer: footer percentages of normal points (the mock counts a bonus question), and a `D`
  badge in the note (no number yet). Both are sensible.
- **Project rules:** SPDX on all new files, Dutch UI text with decimal comma, English code, largest new file
  488 lines. `toets-overzicht.js` stays JS (1231 lines) although logic changed; it is in the backlog for step
  29, its area step. B-01 still holds (`openedIds` in `nextQuestionId`). Version 0.11.0 in `Cargo.toml`,
  `Cargo.lock`, `ui/package.json`, `package-lock.json` and the mock.

**Not checked:** visual result and dark theme on screen (the user's visual diff), WebKit, the real backend's
handling of `...parent` copying `_meta` on a new resit (backlog), and PLAN-2's "remove the area's compat-layer
commands".

## Triage (implementer, 2026-11-09)

Each fix below that changes behaviour has a test that failed first, except n1, n2, n4, n5 and n6.

| Finding | Outcome                                                                                                     |
| ------- | ----------------------------------------------------------------------------------------------------------- |
| M1      | Fixed: the validator checks `weging` only; `weging_se` stays, it applies only with PTA                      |
| M2      | Fixed: indications are removed last, after every exam write                                                 |
| m1      | Fixed: only observaties the exam had when the editor opened lose their indications                          |
| m2      | Accepted, documented in the code: needs a conflict at this exact moment; adding and removing clears it      |
| m3      | Fixed: a student without a grade shows the observaties of all attempts                                      |
| m4      | Fixed, user decision 2026-11-09 (decision 27): diagnostic tests are out of the year's Gem.                  |
| m5      | Backlog: old gap, not a regression                                                                          |
| m6      | Partly: indications on an attempt's score file, refused save, `weging_se`; the rest in the backlog          |
| n1, n2  | Fixed                                                                                                       |
| n3      | Unchanged: the app's footer order is the same everywhere (design spec 3.1: primary last, rendered that way) |
| n4-n7   | Fixed                                                                                                       |
| n8      | Step 29 (F-11)                                                                                              |
| n9, n10 | Unchanged: harmless as before; the validator reports n10's data as an error                                 |
