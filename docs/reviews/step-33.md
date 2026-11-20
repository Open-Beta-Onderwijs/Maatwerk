# Review: step 33, Toetsen as cards

Reviewer: fresh-context subagent, 2026-11-20. Scope: `git diff step/32-ai..HEAD` on
`step/33-toetsen-cards` (step 32 is not merged yet), without the regenerated
`ui/src/bridge/bindings.ts`. Read against `PLAN-2.md` decisions 41-44 and the step 33 section,
spec 4.7 and 3.10 (histogram), and the mock of board 56 (`ToetsenStapelA3.dc.html`: grid markup,
the tray geometry and the phase logic). Read in full: `ui/src/screens/toetsen.ts`,
`ui/src/screens/toetsen/{cards,card-model,stack,stack-layout}.ts` and their tests, the
`exam-menu.ts` hunks, `ui/src/styles/toetsen.css`, the e2e changes (`toetsen.spec.ts`,
`po.spec.ts`, `helpers.ts`, `views.ts`, `overviews.spec.ts`). Compared with the deleted
`ui/src/screens/exam-cards.ts` (`git show step/32-ai:...`). Checked against `store.js`
(`getStudentScores`, `computeBestGradeMap`), `domain/statistics.ts` (`histogram` goes through
`maatwerk-grades`), `legacy/style-data.ts` and `modals/exam-overview/data.ts` (the verzameloverzicht's
observatie rule). Ran `npx vitest run src/screens/toetsen`: 21/21 pass. e2e were not run in this
review (STATE: Chromium 395/395 at the gate).

Accepted deviations, not reported (STATE "Choices made without a spec line"): one open stack per
row; sort by jaarlaag, periode, volgnummer with "Zonder periode" last; attempt order Origineel then
`attempt`; the attempt card shows the original's title; bonus as "16 punten + 2 bonus"; line 1's
tooltip keeps the old meta line; presence and ⚠ stay in the header; a PO's Verzamelkaart is not
clickable and its "Overzicht openen" is disabled; "0 leerlingen", "—", "nog geen cijfers" without
grades. Ten mini-histogram bins (spec 3.10, step 1) instead of the mock's nine is the spec, not a
deviation. Visual baselines are not updated by design (plan: stop and ask).

## Summary

The step does what decisions 41-44 ask, and the code is in good shape. The grid is one CSS grid
of three columns per jaarlaag; the "Periode N" label row and the divider at `left: -19px` match
the mock exactly, and trays are full-width grid items inserted after each row that has a stack,
so reading order is kept. The card follows spec 4.7: badge, title (grey italic when diagnostic),
kind/label/lock pills, line 1 with `weging rapport` and SE only for `type === 'pta'` (consistent
with `metaLine` and `testKind`), the RTTI line with the names in the tooltip and none for a PO,
the 104 × 46 mini histogram from `maatwerk-grades::histogram(…, 1)` with bin-centre grade colours
and the dashed 5,5 line (50 %, which with 10 bins and 2 px gaps lands exactly on the boundary),
the count, the top three observaties and mean ± SD with % onvoldoende. "Overzicht openen" is in
the ⋮ menu for tests and PO's; a click on the card (not on a button, not on a selection) opens
the overview, the verzameloverzicht for a stack.

The stack logic is a pure geometry module (`stack-layout.ts`) with tests against the mock's
numbers (outline path at 1360 px, tray height 260, junction 238) and a small DOM driver
(`stack.ts`). The phases match the spec (drop with the tray growing in 400 ms, spread 200 ms
later in 380 ms; gather, then slide up after 220 ms), reduced motion switches at once and CSS
drops the transitions. Re-renders (the file watcher re-renders on every score change) are
handled: `initStacks` clears the timers, restores the session state statically under
`tgrid-static`, and replaces the single `ResizeObserver`; the click listener is delegated and
wired once. A list drawn while the screen is hidden is laid out by the observer when it gets a
width, before paint. Closed attempt cards are `inert` and `pointer-events: none`. Computed
styles go through `data-h`/`data-bg`/`data-left` + `applyStyleData` or `el.style`; every
user-controlled string in HTML is escaped (`esc`/`escHtml`), the observatie icons included. All
new files carry the SPDX header. The numbers of a block (all attempts and the Verzamelkaart)
come from one pass over the cached score records, replacing the old one-pass-per-card plus
`computeBestGradeMap`.

The one finding that matters is about what the old cards showed: since stacks are closed by
default now, the score warning ⚠ and the presence badges of every attempt are hidden behind the
Verzamelkaart, and the Verzamelkaart shows neither (M1). The rest are small: a transient wrong
outline when switching stacks in a row mid-animation, stale fills from an earlier render,
screen-reader details of the toggle and the tray, and test gaps.

## Blockers

None.

## Majors

### M1. A closed stack hides its attempts' score warnings and presence badges

`ui/src/screens/toetsen/cards.ts:103-111` puts the ⚠ (`.exam-warning`) and the presence slot
only on `solo` and `attempt` cards (`live = kind !== 'summary'`). In the old design that was fine:
the attempt tree was **open by default** (`exam-cards.ts`, `examBlock(…, open)` with
`closedAttempts` empty at start), so the attempt cards and their badges were on screen. Since
decision 43 a stack is **closed by default**, and the attempt cards lie behind the Verzamelkaart
(`stack-layout.ts:95-96`, 5-15 px peeking, `inert`). `toetsen.ts:371-376` still computes the
warnings for every attempt and un-hides the ⚠, and `fillExamPresence` fills the badges, but nobody
can see or hover them. Concretely: a resit with an invalid or incomplete score ("ongeldige score",
"onvolledige scores") or the original of a stack no longer shows a warning on the Toetsen screen
until the teacher opens that stack; a colleague typing scores into a resit is likewise invisible.
For a test without resits nothing changed, so this hits exactly the tests with resits, where
data entry happens in several attempts. The STATE note "presence badges and ⚠ stay in the card
header" does not mention that they disappear from view for stacks.

Fix: give the Verzamelkaart an aggregate of its attempts: a ⚠ whose tooltip lists the problems
per attempt ("501-H: Naam — ongeldige score"), and the union of the attempts' presence badges
(`Presence.inScoreModal` for each attempt id, deduplicated by user). Both can be filled from the
values already computed (the warnings promise per attempt; the presence loop can take a
`data-presence-exams="id1 id2"` list on the summary). Add an e2e case: a resit with an invalid
score shows the ⚠ on the closed stack.

## Minors

### m1. Opening a stack while another in the same row is still closing draws the outline around the wrong one

`ui/src/screens/toetsen/stack.ts:162-169` closes the other open stacks of the row only when they
are in `openStacks`. A stack that is **closing** (removed from `openStacks` at line 156, still in
phase 1 with a 220 ms timer) is skipped. `layoutTray` then picks
`openId = ids.find((id) => phaseOf(id) > 0)` (line 59), which is the first id in `data-stacks`
order, so for up to 220 ms the tray height, the outline and the title ("Pogingen van …") belong
to the closing stack while the new stack's cards drop into their own column. With stacks of
different sizes the tray also changes height twice. Fix: in the loop, treat every other stack of
the row with `phaseOf(other) > 0` or a pending timer the same way (clear its timer, phase 0), and
let `openId` prefer the stack that is in `openStacks`. A unit test is possible if the phase
bookkeeping is split from the DOM, as `stack-layout.ts` already is for the geometry.

### m2. Fills from an earlier render land in the current list

`renderToetsenList` (`ui/src/screens/toetsen.ts:331-388`) looks cards up in the shared container
by `[data-exam-card][data-kind]` when its async `blockNumbers` resolves. The list is redrawn
often (the file watcher re-renders the screen on every `scores`, `exam` or `group` change,
`app.js:677-681`; the score modal calls `renderToetsenList` after saving), so a fill started by
render N can resolve after render N+1 drew its cards and overwrite them, with numbers read before
the change if a score file was reloaded in between. New in this step: the `allSettled` cleanup
(lines 378-386) of render N also blanks the skeletons (`:has(> .skel)`) of render N+1's cards
that are still loading, so they show an empty foot until their own fill lands. The first part
existed with the old stats slots too; the cleanup is new. Fix: a render generation counter
(`const gen = ++renderGen`) checked before each `fillCard`, `applyWarning` and the cleanup.

### m3. Screen-reader details of the stack

- `cards.ts:204`: the toggle has `aria-expanded` but lost the `aria-controls` the old toggle had
  (`exam-cards.ts`, `aria-controls="attempts-<id>"`). Give each stack's attempt cards a group
  (or the tray an id) and point to it.
- `stack.ts:73`: the text is `"3 pogingen ▾"` / `"Inklappen ▴"`; the triangles are read out
  ("black down-pointing small triangle"). Put them in an `aria-hidden` span.
- `stack.ts:109-114`: after a close the tray title keeps "Pogingen van 501 · de beste poging per
  leerling telt" with `opacity: 0`; a screen reader still reads it in the closed state. Clear it
  or set `aria-hidden` while closed.
- Tab order: the tray follows the whole row in the DOM, so for a stack in column 0 the attempts
  come after the cards in columns 1 and 2. Acceptable, but worth a line in the spec or a
  `aria-label` on the tray ("Pogingen van 501") so the jump is announced.

### m4. Test gaps

- No unit test for `gridHtml` (`cards.ts:163-213`), although it is pure: periode labels only on
  the first card of a periode, the divider only off column 0, one tray per row with a stack,
  two or three stacks in one row (`data-stacks`), "Zonder periode". The e2e divider test only
  checks the fixture as it is.
- No e2e for a click on a Verzamelkaart opening the verzameloverzicht
  (`exam-overview-best`), for a PO Verzamelkaart click doing nothing with its menu item disabled,
  for the one-open-stack-per-row rule, or for a stack with more than three attempts (second
  tray row, `trayRows`).
- `toetsen.spec.ts:251-260` "reduced motion" cannot fail on the JS side: `not.toHaveAttribute
('inert')` auto-waits 5 s, so the animated path (inert removed after 200 ms) passes too. Check
  the state synchronously after the click (`evaluate` that reads `inert` and `style.left` in the
  same task), or assert that the tray height is final on the first frame.
- `blockNumbers` (the Verzamelkaart's observatie rule: those of the attempt that counts, without a
  grade those of all) has no test. It duplicates the rule in `modals/exam-overview/data.ts:121-125`;
  a shared pure helper (`summaryObsIds(rec, attempts, best)`) would let both be tested once.

### m5. The Verzamelkaart counts over the filtered resits, the verzameloverzicht over all

`toetsen.ts:357` takes the resits from the **filtered** exam list, and `blockNumbers` computes the
best attempt over those. The card click opens `openBestGradesOverviewModal`, which uses
`Store.computeBestGradeMap` → `getResitsSync(parentId)`: **all** resits of the year
(`store.js:1056-1068`). The old card used `computeBestGradeMap` too, so the numbers matched by
construction. Resits copy the parent's schoolsoort and jaarlaag (`herkansing.ts:143-155`), so in
practice the sets are equal, but a resit edited or migrated with different fields would make the
card and its overview disagree, and a filtered-out resit would also vanish from the tray. Fix: take
the attempts of a stack from `Store.getResitsSync(e.id, year)` (as the overview does), not from
the filtered list.

## Nits

- n1. `ui/e2e/helpers.ts:110-118`: the new `openStackOf` JSDoc was inserted between
  `examMenuItem`'s JSDoc and its function, so the old comment ("Opens an exam's menu …") now sits
  orphaned above `openStackOf`. Move it back down.
- n2. `ui/e2e/helpers.ts:132-138`: `isVisible()` is true for a closed attempt card (it has a box
  and opacity 0.85; Playwright ignores occlusion), so for a resit id `openStackOf` is not called
  and the click retries against an `inert` element until the outer `toPass` times out. No current
  caller passes a resit id; check `inert` on the `.ttray-card` instead of `isVisible`.
- n3. `toetsen.ts:356-357` filters `exams` per original (O(n²)) while `listHtml` already builds
  `resitsByParent`; `originals` is also computed twice. Share one grouping.
- n4. `toetsen.ts:371-376`: the warnings make a second pass over the students per attempt
  (`computeExamWarnings`), next to the one pass of `blockNumbers`. Cheap with the cache, but they
  could be folded into the same loop.
- n5. `stack.ts:110-112`: an original without `volgnummer` has no badge, and the tray title reads
  "Pogingen van · de beste poging …" (double space). Fall back to the title.
- n6. `card-model.ts:84`: an empty bin is 1 px; spec 3.10 says 2 px for the overview histogram
  and 4.7 does not say. Fine for 46 px high, but write it in the spec.
- n7. `card-model.ts:57-63`: a test whose questions have no RTTI tag shows "R 0p · T1 0p · T2 0p ·
  I 0p". The spec example has all four; the old points line left zero categories out. Decide and
  note it.
- n8. Switching from an open stack to another in the same row snaps the outline from one to the
  other (the path has no transition), while the cards animate. Acceptable; a short fade of the
  outline would hide it.
- n9. `stack-layout.ts:39`: the fourth fade value 0.25 is not in the spec (85/60/40 %). Fine, add
  it to the spec.

## Resolution (implementer, 2026-11-20)

- **M1 fixed:** the Verzamelkaart shows one ⚠ for all its attempts (tooltip lines "Herkansing:
  <naam> — …") and the presence badges of every attempt; e2e in the stack test.
- **m1 fixed:** opening a stack also closes a stack of the row that is still closing.
- **m2 fixed:** a draw generation; fills and the placeholder cleanup of an older draw do nothing.
- **m3 fixed in part:** the toggle has `aria-controls` (the tray), the triangles and the tray
  title are `aria-hidden`. Tab order (attempts after the row) stays: backlog.
- **m5 fixed:** a stack holds every resit of the year (`resitsOf`), as the verzameloverzicht.
- **Backlog (not fixed in this step):** m3 tab order, m4 test gaps, the nits (`docs/backlog.md`
  "From Step 33").
