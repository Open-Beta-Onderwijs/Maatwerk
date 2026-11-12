# Review: step 24, PO d: PO rapport

Reviewer: fresh-context subagent, 2026-11-12. Scope: `git diff 62b608d..HEAD` on
`step/24-po-rapport` (`3228af4`, `b72cdd6`, `1519604`, `afdaed1`; PLAN-2 decisions 16-26 and
step 24; spec 4.13 "PO rapport"; boards 19 and 20). Read-only review: no build or test was run (a
gate was running in parallel). The golden PNGs (`tests/golden/typst/rapport-po/p1-p6.png`) were
viewed.

## Summary

The template does what step 24 asks. Page 1 has the title, the subtitle, the sentence, the
projectgroep line (student first, "en" before the last), the Scoretabel with B / D, the lollipop on
one scale up to the largest category max, Gemiddeld (◇), Totaal and a footnote that lists only the
soorten the rubric has. Then come Bonus / malus (red minus, green plus) and the comment, and empty
sections are left out. The category pages use variant A: level cards side by side, overlapping
levels both outlined, the comment, observaties with Leeradvies, and Algemene observaties last.
The numbers on the golden match decisions 16, 17 and 28. Sem has 27 / 36 (25 normal + 2 bonus, the
diagnostic category not counted), so the rubric grade is 10 × 27 ÷ 36 = 7,5, and 7,5 − 0,5 + 0,3 =
7,3. Bas has 6,5 and Fleur 32 / 36 = 8,9. The Totaal row leaves out the diagnostic category,
because `res.scored` skips it.

The refactor of `rapport.typ` moves code without changing it (`section_label`, `zebra_*`,
`student_start`/`student_end` are the same statements). Strings go into Typst as content values
(`#s.name`, `#pg.naam`, `#c.comment`, `#l.label`), never as markup. Only `leeradvies` is
`eval`'d, through `sanitizeTypstMarkup` and `_guard_markup` as on the toets rapport. All
`innerHTML` in `modals/rapport.ts` goes through `esc`.

The conversion of `rapport.js` to `rapport.ts` + `rtti-uitleg.ts` changes no behaviour, with two
benign exceptions: `leeradvies[cat]?.` is now optional, and the error path now checks
`isConnected` first. The command handler is thin, the work runs in `spawn_blocking`, and the
layering holds.

Judgement of the "choices made without asking":

- One PDF of all graded students sorted by class then achternaam: fine. The toets rapport has no
  per-class or per-student mode either.
- Building the data in the UI with numbers from wasm: acceptable, the same split as the toets
  rapport. It does contradict PLAN step 24's "built in core", and the one piece of grade logic
  that was re-implemented in TS diverges from the core (m1).
- The other choices (wording for a group of one, which lines the sentence names, `scoreDotColor`,
  `class_questions` averages, the footnote, grade-only page 1) are reasonable. Two edge cases of
  the sentence and averages are listed below (m2, m5).

The open problems are edge states the rapport prints silently: an override together with lines, a
partly graded group, a grading from another projectgroep, and a long unplaced list on a herkansing.
**Counts: 0 blockers, 0 majors, 8 minors, 5 nits.**

## Blockers

None.

## Majors

None.

## Minors

### m1. `countedScore` re-implements the core's score rule and differs from it

`ui/src/domain/po-rapport.ts:85-89, 107`

Evidence: the core (`calc_po_results`, `ScoreValue::of`, `valid_points`, `whole_max`) counts the
following, but `countedScore` does not:

- a numeric string (`"2"`) counts as 2 in the core, and as 0 here;
- `null` or `"N"` is `NotMade` in the core: 0 points, and it makes the student gradeable. Here
  `null` becomes `—` and is left out of the category average;
- `catMax` accepts any positive integer, but `whole_max` only accepts 1..=100. A category with
  max 150 is 0 in the core and full-size here.

The PO dialog writes only numbers, so this needs a hand-edited or old file. The effect is that the
Jij column, the outlined level and the category averages disagree with Totaal and the grade on the
same page. Decision 1 says there is one implementation for screens and rapport.

Suggested fix: take the per-category counted points from the core. Either let `calcResults` (PO)
return `categoryPoints: {id: number | null}`, or expose a small wasm `poCategoryScore(raw, max)`
built on `ScoreValue`. Use `whole_max` for `max`. Add a test with `"2"`, `null` and `"N"`.

### m2. An override with lines prints false arithmetic

`crates/maatwerk-core/assets/templates/rapport-po.typ:52-58`;
`ui/src/domain/po-rapport.ts:191-196`

Evidence: `calc_po_results` keeps `rubric_grade` when an override replaces the result. With lines
present and an override of 6,0, the rapport says: "De beoordeling van het groepswerk is een 7,5.
Met bonus en malus voor de groep wordt je cijfer een **6,0**. Dit cijfer is met de hand
overschreven door de docent." The middle sentence is false, and this goes to a student. A
grade-only student with lines also gets a Bonus / malus table that did not count (lines alone give
no grade).

Suggested fix: when `grade_overridden`, leave out the "Met … wordt je cijfer" clause. Say for
example "De berekende beoordeling is 7,3. De docent heeft je cijfer vastgesteld op **6,0**." Leave
out (or label) the lines table when `grade_only`. Add a Rust text test like
`an_overwritten_grade_without_scores_shows_the_grade_only`.

### m3. A partly graded projectgroep gets a rapport with no warning

`ui/src/domain/po-rapport.ts:154-161`; `ui/src/modals/rapport.ts:70-80`

Evidence: the grade exists as soon as one category is scored (`gradeable`), so a group the teacher
has only half graded gets a full rapport. The missing categories show `—`, the points are low and
the grade is low. The notice names only "nog geen cijfer". The score table already knows the
status (`gradingStatus`, step 23).

Suggested fix: collect the students whose grading is not complete (`gradingStatus(rubric, g)`)
into `skipped.incomplete`, and show them as "nog niet volledig beoordeeld: …" above the PDF.
Whether they should get a rapport at all is the user's call (ask).

### m4. A grading from another projectgroep is printed under the current group

`ui/src/domain/po-rapport.ts:143-161, 183, 197-201`

Evidence: the score table marks a student whose `po[examId].projectgroep` differs from the group
they are now in ("andere groep", `po-scores.ts:137-142`, review 23 m7). The rapport does not check
this. It prints the old group's scores, comment and group lines with "Jullie" and "het
groepswerk", and names the new group's members.

Suggested fix: when `gradedGroupOf(rec, exam.id)` is set and differs from `g.id`, skip the student
and list them as "beoordeeld in een andere projectgroep: …". The alternative is to print the
group they were graded in. Add a test.

### m5. Category averages and the Totaal average treat a missing score differently

`ui/src/domain/po-rapport.ts:165-175`

Evidence: the category averages leave out a student without that category, as in
`class_question`. The Totaal average is `mean(res.scored)`, where the core counts a missing
category as 0. So when a group is partly graded (m3) or a category was added to the rubric after
grading, the Gemiddeld column does not add up to the Totaal average. The footnote "Gemiddeld =
alle leerlingen met deze PO" is then not true for the category rows.

Suggested fix: pick one rule and document it in the footnote. Either count a missing category as 0
in both (pass `null`, which `class_question` counts as N = 0), or average the total over the same
students per category. The first matches how the grade counts.

### m6. On a herkansing the notice can list almost the whole jaarlaag

`ui/src/domain/po-rapport.ts:131-132`; `ui/src/modals/po-scores.ts:70-81`;
`ui/src/modals/rapport.ts:70-80`

Evidence: `records` holds every student of every matching class. Anyone not in a projectgroep is
"niet ingedeeld". A PO herkansing (decision 22) usually has a few groups, so the notice becomes one
paragraph with dozens of names above the PDF frame, which shrinks the frame. The same happens for
an original PO that only one class does.

Suggested fix: show a count, with the names in a `<details>`. Or, for a herkansing, list as
unplaced only the students without a grade on the original attempt.

### m7. A category or the observaties taller than a page overflow it

`crates/maatwerk-core/assets/templates/rapport-po.typ:182, 212`

Evidence: `_category` and the Algemene observaties block are `breakable: false`. Typst cannot
split such a block, so one taller than the page body runs past the bottom margin into the footer
and logo. Examples: 5 levels with long explanations plus a long comment and several observaties,
or many general observaties with long advice. The fixture has no such case.

Suggested fix: keep categories unbreakable, but make Algemene observaties breakable, with the
heading kept with the first item (a `block(sticky: true)` heading, or a breakable block with an
unbreakable first row). Add a Rust test with an oversized category and assert that no text lies
below the footer line. If a single category can really exceed a page, fall back to breakable
when it does not fit.

### m8. Test gaps around the edge states

`ui/tests/domain/po-rapport.test.ts`; `ui/e2e/po-rapport.spec.ts`;
`crates/maatwerk-core/tests/typst_po_rapport.rs`

Evidence: there are no tests for:

- `skippedHtml` (escaping, the one-name and many-name joins) or `compilePoRapport`;
- the "geen rubric" message;
- a herkansing PO;
- a category added to the rubric after grading (score `—`, nothing outlined, average 0);
- a category with a null max;
- an override together with lines (m2);
- the stale-group case (m4).

Suggested fix: add unit tests for the builder cases and `skippedHtml`, and one e2e for the
no-rubric message.

## Nits

### n1. The notice reads awkwardly in Dutch

`ui/src/modals/rapport.ts:70-80`

"Geen rapport voor niet ingedeeld in een projectgroep: Lotte Bakker; nog geen cijfer: Daan
Jansen." Suggested: "Geen rapport voor Lotte Bakker (niet ingedeeld in een projectgroep) en Daan
Jansen (nog geen cijfer)." Or a short list with "Niet ingedeeld:" and "Nog geen cijfer:".

### n2. Bonus points can give more than 100 %

`ui/src/domain/po-rapport.ts:195`

A student with full normal and bonus points reads "en had dus 111% goed", while the grade is held
at 10,0. Consider capping the shown percentage at 100. The alternative is to leave the percentage
out when bonus points make it go over.

### n3. An unscored category shows `—` but its dot says 0

`crates/maatwerk-core/assets/templates/rapport.typ:175, 218` (shared `lollipop_track`)

On Fleur's page 1 the bonus and diagnostic rows read "— / 4" while the grey dot at 0 shows "0".
On the toets rapport an empty question counts 0 (decision 24), but on a PO it does not. Consider
leaving out the dot, or its label, when `score == none` (a flag on `lollipop_track`).

### n4. The sentence wording differs from board 19

`crates/maatwerk-core/assets/templates/rapport-po.typ:54`

The board says "…voor de groep en individuele bonus en malus wordt je cijfer een". The template
says "…voor de groep en je persoonlijke bonus en malus…". This reads better and matches the
"Persoonlijk" column, but mention it at the golden STOP so the user sees it.

### n5. A placed student outside the matching classes gets klas "—"

`ui/src/domain/po-rapport.ts:189`; `ui/src/modals/po-scores.ts:92`

`classTag` only knows the matching classes. A student who changed class, or a member of an
unrelated class, gets the subtitle "— — Naam (nr)" and is sorted under "—". Consider falling back
to the student's class from all groups of the year, and leaving the "klas —" part out of the
subtitle when it is unknown.

## Triage (after the review, 2026-11-12)

- **m1 fixed:** `countedScore`/`catMax` are gone. Each category's max and counted points come from
  the core (`calcResults` on the rubric with only that category, as a normal one), so `"2"`,
  `null`, `N`, fractions and a max over 100 read exactly as for the grade. Vitest for `"2"`/`null`/
  `N` and a max of 150.
- **m2 fixed:** an overwritten grade gets no bonus/malus lines (they did not count), so the page
  says "Je cijfer is een **6,0**. Dit cijfer is met de hand overschreven door de docent." as the
  toets rapport; no lines table. Vitest.
- m3-m8, n1-n5: `docs/backlog.md` "From Step 24". n4 (wording vs board 19) and n2 go to the user
  with the golden check.
