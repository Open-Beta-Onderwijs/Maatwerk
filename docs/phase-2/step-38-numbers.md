# Step 38.1: grade numbers outside the grades crate

Inventory (2026-11-24, at `82d6ec9`) of every place in `ui/src` and `maatwerk-core` that computes
a grade number itself instead of calling `maatwerk-grades` (CLAUDE.md rule "grade numbers: one
source of truth"). Calls through the WASM wrappers (`domain/core.ts`, `grades.ts`,
`statistics.ts`, `attempts.ts`, `rubric.ts`) are fine. Paths are below `ui/src/` unless stated.

Kinds: **formula** (own arithmetic, must go), **missing fmt** (crate call without the step 38
format), **shown avg** (a student average shown or coloured through `round1`/`isFail`, must follow
the format), **format only** / **layout** / **threshold** (allowed, listed so they can be checked).

## Must change

| #   | Place                                                                                                                                          | What it computes                                                                   | Kind        | Replacement                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------- |
| 1   | `domain/cards.ts:77, 80`                                                                                                                       | `round1` of the year and SE average on the Leerlingen card                         | shown avg   | `shownAverage(avg, fmt.r / fmt.se)`                                                   |
| 2   | `screens/cards/card-html.ts:55, 86`                                                                                                            | colour of the average and SE (`isFail`, round1)                                    | shown avg   | `isFailShown` (export to WASM)                                                        |
| 3   | `domain/cards.ts:96` (Groepen cards)                                                                                                           | `statsOfAverages(xs)`                                                              | missing fmt | `statsOfAverages(xs, fmt)`                                                            |
| 4   | `modals/group-overview/resultaten.ts:90-91`                                                                                                    | year/SE pills: `formatGrade` + `isFail` on unrounded averages                      | shown avg   | `shownAverage` + `isFailShown`                                                        |
| 5   | `group-overview/resultaten.ts:101, 107` → `overview/sections.ts:26`                                                                            | footer GEMIDDELDE/SD                                                               | missing fmt | `statsOfAverages(avgs, fmt)`                                                          |
| 6   | `modals/profile/data.ts:154, 168`                                                                                                              | peers of the year and SE rows                                                      | missing fmt | `statsOfAverages(avgs, fmt)`                                                          |
| 7   | `modals/profile/cijferverloop.ts:157, 164, 170-172`                                                                                            | year/SE rows show an unrounded average through `formatGrade`                       | shown avg   | `shownAverage(fmt)`                                                                   |
| 8   | `domain/exam-info.ts:23-37` (Toetsen card points line)                                                                                         | sums of `max_points` (normal, bonus, per RTTI)                                     | formula     | `calcResults(exam, {}).normalMax / bonusMax`, `rapportTotals` max                     |
| 9   | `domain/exam-info.ts:59`                                                                                                                       | RTTI share % of the normal points                                                  | formula     | `rapportTotals(exam, {})[cat].share`                                                  |
| 10  | `domain/statistics.ts:160-164` `rttiPercents` (group overview :201, exam overview `rtti-obs.ts:33, 95, 137`, profile `analyse.ts:40`)          | `round0(100 * scored / max)` per RTTI category                                     | formula     | `Points::pct` (exists, export to WASM)                                                |
| 11  | `modals/exam-overview/charts.ts:99`                                                                                                            | % per question from `questionStats` points                                         | formula     | `Points::pct`                                                                         |
| 12  | `domain/rapport.ts:221`                                                                                                                        | advice-row % `round0(scored / max * 100)`                                          | formula     | `rapportTotals(...)[cat].pct`                                                         |
| 13  | `domain/rapport.ts:393`, `domain/po-rapport.ts:251`                                                                                            | `score_pct` = `round0(scored / normalMax * 100)`                                   | formula     | `Points::pct`                                                                         |
| 14  | `modals/po-overview/model.ts:89-90, 153-154`                                                                                                   | PO max / bonus max = sum of `c.max`                                                | formula     | `checkRubric(rubric).totals` (invalid max counts 0 there)                             |
| 15  | `modals/po-overview/model.ts:165`                                                                                                              | `poLinesSum(group) + poLinesSum(own)` without `clean`                              | formula     | `poLinesSum([...group, ...own])`                                                      |
| 16  | `modals/po-beoordelen.ts:152`                                                                                                                  | normal max = sum of normal `c.max`                                                 | formula     | `res.normalMax` (already computed at :269)                                            |
| 17  | `modals/po-overview/charts.ts:106-107, 115-116, 141-142` (Categorieën)                                                                         | category mean ÷ max, pseudo-grade `1 + 9p` for the colour, `Math.round(p * 100)` % | formula     | `classQuestions` (as `po-rapport.ts:222`) + `calcGrade(mean, max, 1)`; see question E |
| 18  | `overview/common.ts:60-62` `pctOf` (group-overview `observaties.ts:40`, exam-overview `rtti-obs.ts:166-183`, po-overview `charts.ts:154, 167`) | `Math.round(100 * n / of)`, 0 when `of` is 0                                       | formula     | none: question A                                                                      |
| 19  | `modals/profile/cijferverloop.ts:160-161, 173`                                                                                                 | delta student vs average, `Math.round(diff * 10) / 10`                             | formula     | none: question B                                                                      |
| 20  | `domain/scoregrid.ts:80, 103`, `domain/rapport.ts:97`                                                                                          | a score is valid when `0 ≤ n ≤ max_points` (duplicates `ScoreValue::valid_points`) | threshold   | none exported: question D                                                             |

## Derived from crate functions (allowed)

- RTTI GEMIDDELDE rows: `stats(pcts).mean` then `round0` (`exam-overview/resultaten.ts:67-72`,
  `domain/scoregrid.ts:245-251`; decision 29). Built from crate functions only, so it stays
  (question C: a crate function is optional).
- `domain/scoregrid.ts:200-205`: totals and grades read back from the crate-rounded cells, then
  `stats`.
- `domain/po-rapport.ts:226-228`: an empty normal or bonus category becomes 0 before
  `classQuestions` (rule B of step 37, the user's): input preparation, kept.

## Allowed: format only, layout, thresholds

- Format only: `card-html.ts:100-101`, `card-model.ts:145-147`, `exam-overview/resultaten.ts:79-82`,
  `index.ts:42-43`, `charts.ts:41-44`, `po-overview/charts.ts:37, 148, 153`,
  `po-overview/resultaten.ts:76-84`, `cijferverloop.ts:46, 58-66`, `scoregrid.ts:224-259`.
  `domain/format.ts:22-25` `formatFixed` uses `toFixed` for 2 or more decimals: afronden/afkappen
  2 must format the crate's `shownAverage` value (already exact), never round there.
- Layout and colour: histogram bin centres and `passPct` (`card-model.ts:85, 88`,
  `histogram.ts:45, 49`), heat tint (`observaties.ts:14-18`), segment widths
  (`po-overview/charts.ts:128`), SD band (`cijferverloop.ts:158-163`), chart scales
  (`rapport.ts:369-371`, `po-rapport.ts:296`), dot colours (`rapport.ts:56-65`), `PASS = 5.5`
  and gradient stops (`grade-colors.ts`), `GRADE_GROUP_LABELS` (`utils/grades.ts`).
- Thresholds: % onvoldoende alarm `>= 20` (`cards.ts:104`), typed grade 1..10 (`scoregrid.ts:54`),
  opdrachten limits (`domain/opdrachten.ts`, `opdrachten-genereren/index.ts`).
- Out of scope: opdracht vraag points (`editor-live.ts:269`, core `assignment.rs:282`,
  `typst_svc/vragen.rs:112`).

## `maatwerk-core`

No grade formula of its own (`validate.rs:888` only warns on weging < 0).

## Answers (user, 2026-11-24)

- **A** percentage of a count (#18): a crate function `pct(part, whole)` = `round0(100 * part /
whole)`; `whole <= 0` gives 0, as today. 1 of 8 -> 13; 2 of 8 -> 25; 17,25 of 20 -> 86.
- **B** profile delta (#19): the difference of the shown values, `round1(shown(own) -
shown(mean))`. Own 6,84 and peers 6,75 (both shown 6,8) -> 0,0; 7,0 vs 6,45 (shown 6,5) -> +0,5.
- **C** RTTI GEMIDDELDE rows: stay as they are (built from crate functions).
- **D** score validity (#20): export the crate's check (`scoreValid(raw, max)`) and use it in the
  grid and the rapport; behaviour unchanged.
- **E** PO Categorieën (#17): follows rule B of the rapport (an empty normal or bonus category of
  a graded student is 0), through the rapport's crate path. Max 10, scores 8, 6, empty: 7,0 (70%)
  becomes 4,7 (47%); goes in the before/after table.

## Before/after (decision 90: Rust wins; shown to the user at the end of the step)

Parity (`node tools/numbers-parity.mjs`): Rust = the old screen path on `tiny` and `school` at
the default format, Rust = the MockApi mirror at a1/a1, k0/a2, a0/k2, k1/k0: 0 differences.
Visible changes come from the user's answers, not from the move to Rust:

| Where                                                     | Before                                          | After                                   | Cause    |
| --------------------------------------------------------- | ----------------------------------------------- | --------------------------------------- | -------- |
| Profiel › Cijferverloop, year row 2025-2026 (900001, e2e) | `5,4 vs 5,1 +0,2`, dot at the unrounded average | `5,4 vs 5,1 +0,3`, dot at the shown 5,4 | answer B |

Visual baselines `modal-profiel-cijferverloop` (light, dark, geel; 63-71 px) wait for the user's
OK.
