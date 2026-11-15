# Review: step 29, Overviews and profile

Reviewer: fresh-context subagent, 2026-11-15. Scope: `git diff 455fc90..HEAD` on
`step/29-overviews` (`7f5cb2c` shared parts, `7606a13` RTTI names, `b7ba18f` group overview,
`1a3ab76` exam overview, `de6bf8e` PO overview, `ca1dc5c` profile, `d5b526d` Chart.js removal, and
the docs commits). Read against PLAN-2 decisions 27-40 and step 29, design spec 3.10, 4.5, 4.6,
4.14 and 4.15, and `docs/phase-2/step-29-numbers.md`. The deleted `groep-leerlingen.js`,
`toets-overzicht.js` and `profiel.js` (at `455fc90`) were compared with the new modules. The mock
boards were not opened. `npx vitest run` in `ui/`: 58 files, 695 tests pass. No e2e run.

## Summary

The port keeps the old rules where the step did not mean to change them. The group overview's
columns (originals of the jaarlaag with a volgnummer, resits attached, `bestAttempt`), the year
average (`yearAverage`, the same as `Store.studentYearAverage`) and the SE average
(`seAverage` over the history) are the old statements. The exam overview's loader is
`toets-overzicht.js`'s loop, typed: B14 (the attempt that counts read with its own questions) and
B-05 (the verzameloverzicht's observaties are those of the attempt that counts) hold, as does the
override title on the grade. The profile's B15 (per-year rows and RTTI cards over every graded
attempt) and B16 (SE peers from the student's last year) are the old code paths. The sync handlers
(`scores`, `exam`, `group`, `students`) are the old ones, and the verzameloverzicht still does not
refresh itself.

The intended changes match the decisions. Examples: the SE column only for upper-school or PTA
groups (28), the resit dot with "(poging N)" (28), the PO column with "—" for unplaced students
(28), tooltips (29), core histogram bins (30), RTTI-verloop without PO's and resits (32), and the
Observaties heat table (34). In the exam overview: one table with a footer per group (35), the
three observatie cards (36) and the verzameloverzicht with three tabs disabled (35). The PO
overview has Per klas / Per projectgroep (38), and the profile has bars and the ±1 SD tracks (40).
The choices the author made without asking are listed in STATE. Nothing writes data: the four
modals only read through `Store`, and the grade rules go through `domain/grades` and
`domain/statistics` (core/WASM).

Security holds. Every user string that reaches `innerHTML` or an attribute goes through `esc`:
group and class names, test titles and volgnummers, observatie names and icons, category and
level names, projectgroep names, bonus/malus labels, student names and ids, and the resit's own
word (the U8 e2e test checks the dot's `title`). Dialog `title`, `badge` and `subtitle` are
escaped by `components/dialog.ts`. There is no `style="..."` in any HTML string. Positions and
colours use `data-left/-top/-w/-h/-bg/-color` through `legacy/style-data.ts`. Only the tooltip
sets `style.left/top` through the CSSOM, which the CSP allows. The SVG uses presentation
attributes, not style.

I found no blocker or major. The minors are about denominators and empty-data edge cases, async
paths without an error state, per-student reads that step 7c and review 26-28 already removed
elsewhere, duplication between the four modals, and test gaps.

**Counts: 0 blockers, 0 majors, 7 minors, 7 nits.**

## Blockers

None.

## Majors

None.

## Minors

### m1. Exam overview Observaties: the counts include students without a score, the percentages are "of the students with a score"

`ui/src/modals/exam-overview/data.ts:127-135, 144-157`;
`ui/src/modals/exam-overview/rtti-obs.ts:248-254, 263-266, 299`

`countObs(null)` also counts a student who has the observatie but no scores and no override
(lines 144-157), in `count` and `byGroup`. The denominator is `data.attempts.length`, which is
only the students with a score, and the card header says "percentage van de N leerlingen met een
score". When a student without a score has an observatie (a typical "afwezig"-style one), `n` can
pass `of`. `Math.max(nScored, count)` then quietly raises the denominator for that row only, so
the rows of one card are percentages of different totals, and none of them matches the header.
The same thing happens per group (`Math.max(g.attempts.length, n)`). Also, a group whose only
observaties come from students without a score is not in `data.groups`, so its counts are not
shown.

Fix: pick one population and use it everywhere. Either count only students with a score in the
percentage rows (keep a separate count for the Resultaten footer), or make the denominator
"students with a score or an observatie" and change the header text. Add a unit test with one
student who has an observatie and no score.

### m2. PO overview Per klas: the footer's category means include unplaced students' category scores

`ui/src/modals/po-overview/resultaten.ts:61-66, 98, 117-127`; `ui/src/modals/po-overview/model.ts:141-142`

A "Klas" section holds placed and unplaced rows, and `footHtml(m, s.rows)` gets all of them.
`Punten` and `Cijfer` leave unplaced rows out (`points` and `grade` are null without a group), but
`catScores` reads `r.grading.scores[c.id]` whether or not the row has a group. An unplaced row
shows "—" in every category cell (lines 61-66), but any category score left in its file still
counts in GEMIDDELDE/SD. Normally "Opslaan" in Projectgroepen clears a leaving student's scores
(`po-groepen.ts:387`), so this needs a file that kept them: a concurrent save, or a record edited
outside the app. Spec 4.14.4 says "only placed students count".

Fix: `footHtml(m, s.rows.filter((r) => r.group))`, or let `catScores` skip rows without a group.

### m3. Async paths have no error state: a failed read leaves skeletons or "Laden…" up for good

`ui/src/modals/group-overview/index.ts:433-449`; `ui/src/modals/exam-overview/index.ts:308-317, 381`;
`ui/src/modals/profile/index.ts:321-342, 377-383`

The group and exam overviews now open the modal first and load afterwards. Before, the old code
loaded first and then opened. If `getStudentScores` / `getStudentHistory` / `loadExamOverview`
rejects, the modal stays on its placeholders and the promise rejects unhandled. The RTTI-verloop
(`verloopPoints(...).then(...)`), the profile's `renderTests()` and `yearComparisons(...).then(...)`
have no `catch` either, so their cards keep showing "Laden…" or a skeleton.

Fix: catch at each of these points and show `emptyHtml('Kon de gegevens niet laden.')` (or the
app's usual error text) in the pane or host. An e2e test with the mock's failing-read hook would
cover the group overview.

### m4. Silent refreshes flash placeholders and drop the rendered tabs

`ui/src/modals/group-overview/index.ts:363, 377-378, 433-449`; `ui/src/modals/exam-overview/index.ts:330, 366-368, 381`

`modalRefresher` re-runs the open function. In the new version that function opens the replacement
modal straight away with skeletons and loads afterwards. So every background score save by a
colleague (for any student of the group, or of the whole year for the exam overview) swaps the
visible table for skeletons for the length of the load, and then puts the scroll position back.
`toets-overzicht.js` and `groep-leerlingen.js` loaded first, so the old content stayed until the
new one was ready. The PO overview and the profile still load first and do not have this problem.

Fix: on a refresh, load before calling `openModal` (for example a `prefetched` argument, or split
"load" from "open" as in `loadPoContext`), so that only a first open shows placeholders.

### m5. Per-student reads repeat the pattern steps 7c and 26-28 removed

`ui/src/modals/group-overview/index.ts:435-445`; `ui/src/modals/profile/data.ts:86-94, 108-151`;
`ui/src/modals/profile/index.ts:329-331`

- The group overview and `yearComparisons` read the score files one `await` at a time, with no
  `Store.preloadScores(year, subject, ids)` first. `loadPoContext` does preload. For the active
  year the cache is usually warm. For earlier years (the profile's per-year comparison) it costs
  one IPC call per student, the cost step 7c measured as "seconds".
- The SE peers (`yearComparisons`) and the group overview's SE column call
  `Store.getStudentHistory(id)` without `{ loaded: true }`. Each call then runs `loadYear` (with an
  `ensureYear` IPC call) for every school year and every student. Review 26-28 M2 fixed the same
  thing in the cards.
- `examStats` reads every student of the year for each test, and is run again on every school-year
  toggle in "Ten opzichte van het toetsgemiddelde" (nothing is memoised).

The old `profiel.js` and `groep-leerlingen.js` did the same, so this is not a regression. But this
step rewrote these loops anyway.

Fix: preload the years once (`loadYear` per year, then `preloadScores` per year), pass
`{ loaded: true }`, and memoise `examStats` per `year|exam.id` inside the modal.

### m6. Duplication between the overviews

- `histCard` and `allHistHtml` are identical in `exam-overview/charts.ts:34-58` and
  `po-overview/charts.ts:36-59`. The Stapgrootte click handler is the same in
  `exam-overview/index.ts:352-360` and `po-overview/index.ts:355-363`.
- The heat tint `((24 + k * 190) / 255) * 100` is in `group-overview/observaties.ts:231-235` and
  again inline in `profile/analyse.ts:292-294`.
- The info-icon SVG appears three times (`group-overview/charts.ts:188`,
  `exam-overview/rtti-obs.ts:194`, `profile/analyse.ts:222`).
- `signed` appears twice (`po-overview/resultaten.ts:48`, `profile/cijferverloop.ts:46`).
- The alphabetical observatie sort is written out in five places (`group-overview/model.ts:231`,
  `group-overview/resultaten.ts:51`, `exam-overview/data.ts:105`, `po-overview/model.ts:188`,
  `profile/analyse.ts:274`), while `overview/obs-bars.ts:170` exports `byObsName` and nothing uses
  it.

Fix: move the "Alle leerlingen" histogram card (with its toggle wiring), `heatPct`, the note icon
and `signed` into `ui/src/overview/`, and use `byObsName` everywhere.

### m7. Test gaps

- Exam overview: `exam-overview.test.ts` only covers `verloopPoints` and `groupColor`. Nothing
  tests `resultatenHtml`'s per-group footer: the RTTI mean over graded rows, `NVT` when every
  graded row is override-only, Totaal only over rows with question scores, and the ticked count per
  observatie. Nothing tests `observatiesHtml`'s denominators (m1) or `loadExamOverview`, whose
  B14/B-05 paths could be tested with a mocked `Store`.
- Group overview: `cellTip` (sub lines for PO unplaced / PO resit / diagnostic / resit with
  "origineel") and `resultatenHtml` (no SE column when `showSe` is false, `colspan` of JAAR) have
  no unit test.
- Profile: B15 and B16 are recorded as "checked, kept" in `quirks.md`, but no test pins them.
  `rttiTests(d, 'se')` (resits of PTA tests included) is pure and easy to test.
  `yearComparisons` (peers of the last year only) could be tested with a mocked `Store`.
- No test covers a stale render: switching the profile's school year while `renderTests` is
  pending. The `key === jaar` guard is right, but nothing exercises it.

## Nits

### n1. Stale comments

- `overview/resit-dot.ts:42-43`: "`tipKey` hooks the grade tooltip". There is no `tipKey` parameter.
- `exam-overview/rtti-obs.ts:30`: "`fillVerloop` draws the chart". There is no such function; the
  caller does it in `index.ts`.
- `exam-overview/data.ts:39`: `attempt` is documented as "True when a resit counts" but is
  `Exam | null`.

### n2. Dead exports and orphaned CSS

- `RTTI_TOKENS` and `rttiTitle` (`domain/rtti-names.ts:21, 42`), `sectionHeadHtml`
  (`overview/sections.ts:62`), `byObsName` (see m6) and the re-export `export { testKind }`
  (`overview/common.ts:27`) have no users.
- About 45 utility classes in `ui/src/style.css` lost their last user when the three JS files were
  deleted: `u-bg-highlight`, `u-border-r-light`, `u-border-b-2`, `u-border-l-2`, `u-border-t-2`,
  `u-p-3-4`, `u-p-4-6`, `u-p-panel`, `u-h-200` … `u-h-280`, `u-min-w-90`, `u-min-w-110`, `u-collapse`,
  `u-overflow-x-auto`, `u-text-faint`, `group-name-btn`, and others. (`overview.css` itself has
  none: the only unmatched names are built at runtime, `ov-rtti--*`, `xo-rtti--*`, `ov-kind--se-po`.)

### n3. `styles/overview.css` is 1,399 lines

The ~500-line split rule (R-05) is about sources. Splitting this file into the shared chart parts
plus one file per modal (`group`, `exam`, `po`, `profile`) would follow the module split.

### n4. Tooltip disposers are not registered everywhere

`po-overview/index.ts:338` calls `stopTips()` only on a refresh, and `profile/index.ts:442`
throws the disposer away. `group-overview/index.ts:423` registers it with `onModalCleanup`. It is
harmless today because the tip lives on the dialog's backdrop and `close()` removes it, but use
`onModalCleanup` in all three.

### n5. Tooltips by keyboard differ per modal

The tooltip listens to `focusin`, but group-overview cells have `tabindex="-1"`
(`group-overview/resultaten.ts:86`) and PO cells have no `tabindex` (`po-overview/resultaten.ts:75,
80-85`), so only the profile's bars (`tabindex="0"`) can be reached with Tab. Choose one approach.
Roving focus on the grid would avoid a tab stop per cell.

### n6. Small shortcuts

- `profile/analyse.ts:250-253` adds the "Gemiddeld" accent class with
  `.replace('ov-card ov-rcard', …)`. A `className` option on `rttiCardHtml` would be cleaner.
- `po-overview/index.ts:291-300, 381` builds skeleton panes and replaces them in the same tick,
  because everything is loaded before `openModal`.
- `group-overview/index.ts:326` sorts by `achternaam` without the `'nl'` locale; the other modals
  pass `'nl'`.

### n7. Vorige/Volgende order from the exam and PO overviews differs from the table

`exam-overview/index.ts:348` passes the year's students in Store order, not in the table's order
by section. `po-overview/index.ts:343-345` passes `model.placed` alphabetically across classes,
while the default view is per klas. An unplaced student's name opens a profile without
Vorige/Volgende. Passing the rows in display order (and including unplaced students) would make
the footer follow the table.
