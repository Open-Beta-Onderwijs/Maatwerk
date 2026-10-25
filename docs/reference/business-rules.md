# Business rules (reference app)

This is a description of the domain logic in the Electron reference app (`_reference/`). It is the
**spec**: it records what the code does, including inconsistencies. It does not say what the code
should do. Every rule cites `file:line`. Paths are relative to `_reference/renderer/` unless they
start with `_reference/`.

Known oddities are marked **(quirk)** here and are listed in full in the separate quirks notes.

Glossary: leerling = student, toets = exam, vraag = question, opgave = exercise, opdracht =
remedial assignment, observatie = reusable observation, leeradvies = study advice, groep = class,
vak = subject, herkansing/inhaal = resit/make-up, cijfer = grade, n-term = normalisation term,
weging = weight, SE = schoolexamen (PTA dossier).

---

## 1. Data model used by the rules

| Item               | Shape                                                                                                                                                                                                        | Source                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Question           | `{ id, section, number, max_points, rtti: 'R'\|'T1'\|'T2'\|'I', kind? }`                                                                                                                                     | `modals/toets-edit.js:268-275`, `store.js:24-26`               |
| Question kind      | `q.kind ?? 'normal'`, one of `normal`, `bonus`, `diag`                                                                                                                                                       | `store.js:24-26`, `modals/toets-edit.js:573-576`               |
| `max_points`       | integer from 0 to 10 (toggle buttons), 2 by default                                                                                                                                                          | `modals/toets-edit.js:565-569`, `:273`                         |
| Exam               | `{ id, title, jaarlaag, schoolsoort[], n_term, weging, weging_se, periode, type: 'pta'\|'regular', questions[], obs_ids[], parent_id?, attempt?, description?, volgnummer, opdrachten?, opdrachtenCijfer? }` | `modals/toets-edit.js:256-277`, `modals/herkansing.js:120-137` |
| Score record       | `{ student_id, scores: {examId: {qId: value}}, observations: {examId: [obsId]}, overrides?: {examId: {cijfer, berekend}} }`                                                                                  | `_reference/CLAUDE.md:82`, `store.js:578-627`, `:803-814`      |
| Stored score value | `number` (valid), `null` (= `N`), `string` (invalid input kept as typed), missing key (= empty)                                                                                                              | `screens/scores.js:672-684`, `:1405-1423`                      |

Question id generation: new exams get `q1..qN` (`modals/toets-edit.js:268-269`). "Add question"
uses `q${questions.length + 1}` (`modals/toets-edit.js:673`), which can repeat an existing id after
a question was deleted **(quirk)**.

---

## 2. Score entry (score grid)

### 2.1 Parsing typed input — `normalizeScore` (`screens/scores.js:677-684`) and `afterChange` (`screens/scores.js:1373-1423`)

```
raw = String(input ?? '').trim()
if raw == ''                 -> cell '',  stored: key deleted (setScore(..., undefined))  store.js:605-611
if raw.toUpperCase() == 'N'  -> cell 'N', stored: null
num = Number(raw.replace(',', '.'))          // parseScoreNum, scores.js:655-657; first comma only
if isNaN(num) || num < 0 || num > q.max_points
                             -> cell raw, stored: raw string (invalid), persistent error toast
                                "Ongeldige score "…" voor vraag <section><number> (max <max>)"  scores.js:1414-1419
else                         -> cell String(num).replace('.', ','), stored: num (a JS number)
```

- Both a decimal comma and a decimal point are accepted. The cell shows a comma (`scoreCellText`,
  `screens/scores.js:658-660`, only the first `.` is replaced).
- `Number()` semantics apply. For example `'0x1'` and `'1e0'` parse as 1, and `' '` was trimmed to
  empty before parsing **(quirk: hex/exponent input accepted)**.
- Any fraction is allowed (no half-point grid). For example `0,3` is valid if `max_points ≥ 0,3`.
- An invalid value is still saved to disk as the typed string.
- When the grid loads, values are shown as follows: `undefined → ''`, `null → 'N'`, anything else →
  `scoreCellText(v)` (`screens/scores.js:464-467`).

### 2.2 Numpad `.` → `N`

- `numpadDotIsN` is `true` by default. It is a module-level flag that lasts for the whole app session.
  It is toggled by the header checkbox ". → N" (`screens/scores.js:51-53`, `:160-164`, `:194-196`).
- While the flag is on, pressing `NumpadDecimal` in a question column cancels any open editor (the
  typed value is discarded) and writes `'N'` into the cell (`screens/scores.js:1462-1470`). Halves
  can then only be typed with the main keyboard's `,` or `.`.

### 2.3 Row validation status — `computeRowStatus` (`screens/scores.js:929-945`)

- `invalid` if any filled cell is not `N` and fails the numeric rule from 2.1.
- `partial` if `0 < filled < questions.length`. This counts every question, so diag and bonus
  questions are required too.
- `ok` otherwise, including a row with nothing filled.

The same rule is duplicated for the ⚠ on the exam card: `computeExamWarnings`
(`screens/toetsen.js:97-118`) gives `ongeldig`/`onvolledig`. It works from stored values
(`null` = N is valid).

### 2.4 N-term input

The N-term spinner has step 0.1, min 0, max 3 and shows a decimal comma
(`screens/scores.js:169-174`; exam editor `modals/toets-edit.js:121-127`, `:448-451`; resit
`modals/herkansing.js:73-77`). Spinner `set()` snaps to the step and clamps:
`v = clamp(round(v/step)*step, min, max)`, then `parseFloat(v.toFixed(dec))`
(`utils/spinners.js:20-25`). A change in the score modal is saved straight away with
`Store.setExamNTerm`, which merges into the file on disk without a conflict check
(`store.js:556-566`), and all rows are recomputed (`screens/scores.js:182-189`). A missing
`n_term` is treated as `1` (`store.js:663`).

---

## 3. Grade calculation

### 3.1 `calcResults(exam, questionScores, override)` — `store.js:662-728`

```
n          = exam.n_term ?? 1                                   :663
normalMax  = Σ max_points of kind 'normal'                      :664-666
bonusMax   = Σ max_points of kind 'bonus'                       :667-669
examMaxTotal = normalMax + bonusMax                             :670
scored = 0; cats = {R:[0,0], T1:[0,0], T2:[0,0], I:[0,0]}       // [earned, possible]
anyGradeableEntered = false

for q in exam.questions:                                        :676-698
  raw = questionScores[q.id]
  if raw === undefined: continue                 // empty: ignored for RTTI, but see normalMax
  isN = raw === null || String(raw).toUpperCase() == 'N'
  if !isN:
    num = Number(raw)                            // NB: no comma replacement here
    if isNaN(num) || num < 0 || num > q.max_points:   // invalid
      if kind == 'normal': cats[q.rtti].possible += max_points
      continue                                   // does NOT set anyGradeableEntered
    if kind == 'diag': continue
    anyGradeableEntered = true
    scored += num                                // normal AND bonus
    if kind == 'normal': cats[q.rtti] += [num, max_points]
  else (N):
    if kind == 'normal': cats[q.rtti].possible += max_points
    if kind != 'diag': anyGradeableEntered = true

grade = null
if anyGradeableEntered && normalMax > 0:                        :700-703
  grade = scored >= normalMax ? 10 : calcGrade(scored, normalMax, n)

calculatedGrade = grade
overridden = typeof override?.cijfer === 'number'               :706
if overridden: grade = override.cijfer
round1(g) = g == null ? null : Math.round(g*10)/10              :708
pct(cat) = possible > 0 ? Math.round(earned/possible*100) : 'NVT'   :710-711
return { scored, normalMax, bonusMax, examMaxTotal, hasBonus: bonusMax > 0,
         grade, calculatedGrade, overridden,
         overrideStale: overridden && round1(override.berekend) !== round1(calculatedGrade),
         R, T1, T2, I }
```

What follows from this:

- **Denominator.** The grade always divides by `normalMax`, the total of all normal questions
  whether they were entered or not. An empty question therefore counts as 0 points for the grade,
  but it is left out of the RTTI percentages.
- **`N` (shown as "Niet gemaakt" in the UI, `screens/scores.js:162`).** For the grade it scores 0
  points. For RTTI it adds `max_points` to the possible points. It also makes the row gradeable.
- **Invalid value.** For the grade it counts as 0. For a normal question it adds to RTTI possible
  points. It does not make the row gradeable, so a row with only invalid values has
  `grade = null`.
- **Bonus.** Bonus points add to `scored`, so they can make up for lost normal points. They never
  count in RTTI. `scored >= normalMax` gives exactly `10`. An N on a bonus question makes the row
  gradeable.
- **Diag.** A diag question never affects `scored`, the grade or RTTI. On its own it never makes a
  row gradeable.
- **No normal questions** (`normalMax == 0`): `grade` is null unless there is an override.
- **No rounding** happens inside `calcResults` or `calcGrade`. Grades are stored and compared as
  full floats. Rounding only happens on display and in a few listed comparisons (§3.4).
- `cats[q.rtti]` assumes that `rtti` is one of the four tags. Any other value throws a TypeError.

### 3.2 `calcGrade(scored, max, nTerm)` — `store.js:743-754`

Let `S = scored` and `L = max`:

```
raw = 9·S/L + n
lo1 = 1 + 2·9·S/L            // CvTE upper bound for n > 1 ("hooguit 2× de score-lijn")
hi1 = 10 − 0.5·9·(L−S)/L     // CvTE upper bound for n > 1
lo2 = 1 + 0.5·9·S/L          // CvTE lower bound for n < 1
hi2 = 10 − 2·9·(L−S)/L       // CvTE lower bound for n < 1
if raw > lo1: return min(lo1, 10)
if raw > hi1: return min(hi1, 10)
if raw < lo2: return max(lo2, 1)
if raw < hi2: return max(hi2, 1)
return clamp(raw, 1, 10)
```

- The bounds are checked by comparing `raw` with each bound. The code never branches on `n > 1` or
  `n < 1`. For `n = 1` no bound can bite when `0 ≤ S ≤ L`.
- The checks run in order and return at the first match. They do not take the minimum of both
  upper bounds. Algebraically `raw > lo1` needs `S/L < (n−1)/9`, and for `n ≤ 3` that region always
  has `lo1 < hi1`. Within the UI range `n ∈ [0, 3]` the result therefore matches the min/max form
  (worth pinning with a golden test).
- The result is clamped to `[1, 10]`. When `S ≥ L`, `calcResults` returns `10` and never calls
  `calcGrade` (`store.js:702`).

### 3.3 Grade overrides (v0.1.6)

- **Input.** The teacher types into the Cijfer column of the score grid (`screens/scores.js:1365-1368`
  → `gradeTyped`, `:1025-1051`).
  - Empty input removes the override if there is one. Otherwise the cell is restored and the
    calculated grade "can't be removed".
  - `parseGradeInput`: `Number(raw.replace(',', '.'))`. The value is rejected when it is NaN or
    outside `[1, 10]`, otherwise it is rounded with `Math.round(n*10)/10`
    (`screens/scores.js:663-667`). The error toast reads "Ongeldig cijfer … 1,0 tot en met 10,0".
  - Typing the same value again does nothing, unless the override is stale. Re-typing a stale
    override confirms it, and `berekend` is refreshed (`screens/scores.js:1043-1049`).
- **Stored** as `rec.overrides[examId] = { cijfer, berekend }`. `berekend` is the calculated grade
  at that moment, rounded to 1 decimal, or null (`screens/scores.js:993-1001`,
  `store.js:617-627`). `cijfer === null` deletes the entry, and the whole `overrides` object when
  it becomes empty.
- **Effect.** `grade` becomes the override wherever `calcResults` receives it. `calculatedGrade`
  stays the computed value. RTTI percentages, `scored` and the totals still come from the scores
  (`store.js:658-661`).
- **Stale flag.** `overrideStale = round1(berekend) !== round1(calculatedGrade)` (`store.js:721`).
  It is shown as ⚠ / `.grade-override-stale` (`screens/scores.js:1133-1142`).
- **Restore.** Right-click → "Berekend cijfer herstellen" (`screens/scores.js:1054-1075`).
- **Grade without scores.** `examResults` returns a result when there is an override and no scores:
  `grade = cijfer`, `calculatedGrade = null`, every RTTI value `'NVT'`, `scored = 0`
  (`store.js:731-741`). The grid shows the override in the Cijfer cell and leaves the other cells
  empty (`screens/scores.js:565-576`).
- **Undo/redo** applies only when the cell still holds the value the entry left behind
  (`screens/scores.js:1007-1019`).

### 3.4 Rounding and display

Every rounding in the app uses `Math.round(x*10)/10` (one decimal) or `Math.round(x)` for
percentages. JS `Math.round` rounds `.5` toward +∞, which is half-up for positive values. Floats are
not corrected, so a value such as `x.x5` stored as `x.x4999…` rounds down. Some displays use
`toFixed(1)` directly instead, and `toFixed` rounds from the binary value, which is not always the
same as `Math.round` **(quirk)**.

| Where                              | Operation                                                                         | Decimals | Ref                                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| `formatGrade(g)` (all grade cells) | `null/undefined → '—'`, else `(Math.round(g*10)/10).toFixed(1).replace('.', ',')` | 1        | `app.js:363-366`                                                                                               |
| Pass/fail `isFail(g)`              | `Math.round(g*10)/10 < 5.5`                                                       | 1        | `utils/colors.js:38-40`                                                                                        |
| RTTI %                             | `Math.round(earned/possible*100)`                                                 | 0        | `store.js:710-711`                                                                                             |
| Override input                     | `Math.round(n*10)/10`                                                             | 1        | `screens/scores.js:666`                                                                                        |
| `berekend`                         | `Math.round(calc*10)/10`                                                          | 1        | `screens/scores.js:1001`                                                                                       |
| Grade card threshold compare       | `Math.round(grade*10)/10 < onder`                                                 | 1        | `store.js:1329-1330`                                                                                           |
| Card threshold input               | `Math.round(n*10)/10`                                                             | 1        | `modals/opdrachten-genereren.js:451`                                                                           |
| Means/SD (grid, cards, overview)   | `mean.toFixed(1).replace('.', ',')` (no `Math.round`)                             | 1        | `screens/scores.js:637-651`, `screens/toetsen.js:89-91`, `modals/toets-overzicht.js:179`, `utils/grades.js:53` |
| Rapport grade                      | `(Math.round(g*10)/10).toFixed(1)`, plus `grade_num`                              | 1        | `modals/rapport.js:262-264`                                                                                    |
| Rapport class avg per question     | `parseFloat((sum/count).toFixed(1))`                                              | 1        | `modals/rapport.js:61-62`                                                                                      |
| Profile bar values                 | `Math.round(grade*10)/10`                                                         | 1        | `modals/profiel.js:403-405`, `:507-509`                                                                        |
| `cijferCardReason` label           | `Number(onder).toFixed(1).replace('.', ',')`                                      | 1        | `store.js:1256-1261`                                                                                           |

Everywhere else, means, medians, best-attempt comparisons, histogram binning and grade groups use
the **unrounded** grade (see §6).

Decimal comma: user-facing numbers are formatted with `.replace('.', ',')`, which replaces only the
first `.`. Exceptions **(quirk)**:

- The score grid **Totaal** cell uses `${res.scored} / ${res.normalMax}` and so shows a decimal
  point, e.g. `12.5 / 20`, with ` (+)` appended when bonus took `scored` above `normalMax`
  (`screens/scores.js:582-585`).
- The overview Resultaten tab uses a comma (`modals/toets-overzicht.js:203`, `:229-231`).

---

## 4. RTTI per-tag results

| Context                                                       | Earned                    | Possible                                             | Kinds included                                  | N       | Invalid / > max               | Result                                       | Ref                                             |
| ------------------------------------------------------------- | ------------------------- | ---------------------------------------------------- | ----------------------------------------------- | ------- | ----------------------------- | -------------------------------------------- | ----------------------------------------------- |
| `calcResults` (grid, Resultaten tab, profile)                 | valid normal scores       | max of entered normal questions (valid, N, invalid)  | normal only                                     | 0 / max | 0 / max                       | `round(%)` or `'NVT'`                        | `store.js:676-711`                              |
| Overview "RTTI per cijfergroep"                               | Σ `Number(v)`             | Σ max                                                | **all kinds** (filter is `q.rtti === cat` only) | skipped | included if `≥ 0` and numeric | `round(%)`, `null` → no bar                  | `modals/toets-overzicht.js:105-119`, `:894-905` |
| Overview "RTTI per groep" (via `qStats`)                      | same                      | same                                                 | all kinds                                       | skipped | included                      | `round(%)`; `null` drawn as 50 in grey (NVT) | `modals/toets-overzicht.js:121-149`, `:940-958` |
| Overview "RTTI vergelijking" (exams of same jaarlaag in year) | same                      | same                                                 | all kinds                                       | skipped | included                      | same                                         | `modals/toets-overzicht.js:1014-1042`           |
| Rapport leeradvies rows                                       | `score ?? 0` per question | max                                                  | normal only, **R/T1/T2 only (no I)**            | 0 / max | NaN/over-max taken as is      | `round(%)`, bracket on the unrounded %       | `modals/rapport.js:101-121`, `:141-158`         |
| Profile RTTI tab, "Gem." bar                                  | —                         | —                                                    | —                                               | —       | —                             | `round(mean of per-exam %s, NVT excluded)`   | `modals/profiel.js:909-924`                     |
| Exam card summary line                                        | —                         | Σ max of normal questions per tag (`R: 12p · T1: …`) | normal                                          | —       | —                             | —                                            | `screens/toetsen.js:236-247`                    |

Overview RTTI per grade group includes only students whose grade is not null, bucketed by
`gradeGroupIdx(grade)` (`modals/toets-overzicht.js:105-107`).

Rapport leeradvies bracket (`modals/rapport.js:116-121`), with `pct = scored/max*100` unrounded:

```
pct < laag_midden            -> 'laag'
pct < midden_hoog            -> 'midden'
else                         -> 'hoog'
```

The default boundaries are `40/70` for every tag (`modals/rapport.js:416-421`). They are edited with
sliders in steps of 5, for R/T1/T2 only (`modals/rapport.js:463-475`). The advice text is taken from
`adviesData.leeradvies[cat][bracket]`, or `'—'` when it is empty. After the tag rows, each checked
observatie adds a row with `obs.leeradvies` (`modals/rapport.js:160-172`).

---

## 5. Resits (herkansing / inhaal) and best attempt

### 5.1 Structure

- A resit is a separate exam created as `{...parent, id: makeExamId("<parent title> — <desc>"),
title, description, attempt: resits.length + 2, parent_id: parent.id, n_term, structureMode,
obs_ids: [], questions: fresh q1..qN}` (`modals/herkansing.js:12`, `:119-137`). Because of the
  spread it inherits `volgnummer`, `weging`, `weging_se`, `type`, `periode`, `jaarlaag`,
  `schoolsoort`, and also `opdrachten` / `opdrachtenCijfer` / `_meta` **(quirk)**.
- Resits are listed in `attempt` ascending order (`store.js:1035-1039`). An exam that has resits
  cannot be deleted (`store.js:568-572`, `modals/toets-edit.js:742-747`).
- The top fields (PTA, periode, weging, weging_se) are locked on every attempt and are edited on
  the "verzamelkaart", which writes them to the parent and to all resits. The resit title is
  rebuilt as `"<naam> — <description>"` (`modals/toets-edit.js:295-298`,
  `modals/herkansing.js:240-266`).

### 5.2 Which attempt counts

Every implementation compares `grade` as returned by `calcResults` / `examResults`, with the
override included and the value unrounded. Each attempt is scored against **its own** question
structure and n-term.

| Function                                                               | Candidates & order                                    | Comparison                                                    | Tie                      | No grade at all                                   | Ref                                |
| ---------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------- | ------------------------ | ------------------------------------------------- | ---------------------------------- |
| `computeBestGradeMap(parentId)` (summary card stats, summary overview) | `[parent, ...resits by attempt]`                      | `res.grade > best` (strict), start `-Infinity`, nulls skipped | first = earliest attempt | student omitted from map                          | `store.js:1045-1077`               |
| `resolveBestAttempts(history)` (profile, group overview SE avg)        | `[original entry, ...resit entries in history order]` | `(grade ?? -1) > (best.grade ?? -1)`                          | first (original)         | the original entry is kept even with a null grade | `store.js:1083-1134`               |
| ″ resits whose parent has no history entry                             | the resit group in history order                      | same                                                          | first                    | first resit kept                                  | `store.js:1110-1125`               |
| `bestGradeForFamily` (group overview)                                  | `[original, ...resits by attempt]` with grade ≠ null  | `b.grade > a.grade`                                           | earliest                 | `{grade: null}`                                   | `modals/groep-leerlingen.js:77-84` |
| Profile `yearAvg`                                                      | `[e, ...resitsByParent]`                              | `res.grade > bestGrade`                                       | earliest                 | exam skipped                                      | `modals/profiel.js:637-662`        |

Where the best attempt is used:

- **Summary card (verzamelkaart) stats:** `computeBestGradeStats` (`screens/toetsen.js:120-133`).
- **Summary overview:** `openBestGradesOverviewModal` passes `bestMap` as `scoreOverride`, so each
  student's best attempt gives the grade. The Resultaten tab shows a badge with the first letter of
  the resit description (`modals/toets-overzicht.js:233-243`). The Vraaganalyse, RTTI and
  Observaties tabs are disabled (`modals/toets-overzicht.js:309-311`). The grade histogram and
  boxplot use the best grades.
- **Profile:** "Cijferverloop (onder/bovenbouw)" uses the resolved history
  (`modals/profiel.js:58`, `:73-77`). "Cijferverloop per schooljaar" and the RTTI tab use **all
  attempts with a grade** (`allResults`, `modals/profiel.js:79-85`, `:496`, `:913-915`). Resit
  bars get the label `<volgnummer>-<first letter of description>` (`modals/profiel.js:86-91`).
- **Group overview (`groep-leerlingen`):** per-exam cells use the best of the family. The year
  average uses `f.original.weging` and the SE average uses the resolved history
  (`modals/groep-leerlingen.js:56-71`, `:196-201`).
- **Not used:** the rapport (one exam only, `modals/rapport.js:197-211`) and opdrachten "Cijfer
  onder" cards (this exam's grade only, `store.js:1327`).

---

## 6. Statistics

### 6.1 Formulas used everywhere

```
mean(xs) = Σx / n
sd(xs)   = sqrt(Σ(x − mean)² / n)        // POPULATION sd (divides by n)
fails%   = Math.round(count(isFail(g)) / n * 100)
```

| Place                                                      | Population                                                                                            | Grades                               | sd when n < 2        | Ref                                             |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------- | ----------------------------------------------- |
| Score grid avg/SD rows                                     | rows of all groups' grids, parsed back from the **displayed** (1-dec) Cijfer cell, overrides included | rounded                              | `''` (null)          | `screens/scores.js:595-652`                     |
| Score grid avg Totaal                                      | `parseInt` of the Totaal cell text, shown as `mean / Σ max_points of ALL questions`                   | **truncated** to integer **(quirk)** | `''`                 | `screens/scores.js:597`, `:604-607`, `:634-637` |
| Exam card stats `computeExamStats`                         | all students of the year with grade ≠ null; `avgPts` only over students who have scores               | unrounded                            | 0                    | `screens/toetsen.js:65-95`                      |
| Summary card `computeBestGradeStats`                       | best grade per student                                                                                | unrounded                            | 0 (formula with n=1) | `screens/toetsen.js:120-133`                    |
| Overview header ("N leerlingen · μ ± sd · x% onvoldoende") | every student in the year with grade ≠ null                                                           | unrounded                            | 0                    | `modals/toets-overzicht.js:169-180`             |
| Group overview footer                                      | per exam family: mean of best grades; mean of student weighted avgs                                   | unrounded                            | —                    | `modals/groep-leerlingen.js:227-257`            |

Display: `μ ± sd` with `toFixed(1)` and a comma, and a coloured dot (`isFail(mean)` → red, else a
gradient from yellow to green) (`utils/grades.js:48-56`, `screens/toetsen.js:395-405`).

### 6.2 Overview (toets-overzicht) charts

- **Grade histogram** `makeHistBins(step, grades)` (`modals/toets-overzicht.js:528-544`).
  - Step 0.5: start 1.0, 18 bins.
  - Step 1: start 0.5, 10 bins.
  - `i = floor((g − start)/step)`, and `g ≥ 10` goes to the last bin; the index is clamped.
  - Labels: `<upper` for each bin, `≤10,0` for the last.
  - The pass line sits before bin `round((5.5 − start)/step)`.
  - Grades are unrounded, so a 5.47 (a pass by `isFail`) lands in the `<5,5` bin **(quirk)**.
  - The 0,5 step is the default (`modals/toets-overzicht.js:328-329`). Per-group histograms always
    use step 1 (`:779`).
- **Boxplot** `boxStats(vals)` (`modals/toets-overzicht.js:596-607`) on the sorted values:
  `min = s[0]`, `q1 = s[floor(n·0.25)]`, `median = s[floor(n·0.5)]`, `q3 = s[floor(n·0.75)]`,
  `max = s[n−1]`. There is no interpolation, so for an even n the median is the upper middle value.
- **Grade groups** `gradeGroupIdx` (`utils/grades.js:6-16`): `<4`, `4–5`, `5–6`, `6–7`, `7–8`,
  `>8`. The boundaries are half-open (`g < 4 → 0`, …, `g ≥ 8 → 5`) on the unrounded grade.
  Midpoints `[2.5, 4.5, 5.5, 6.5, 7.5, 9.0]` are used only for colour.
- **Vraaganalyse (p-value-like "% correct")** per question:
  `round(Σ score / Σ max_points * 100)` over students with a numeric, non-N score ≥ 0
  (`modals/toets-overzicht.js:121-129`, `:798-802`). Over-max values are included, so the result
  can exceed 100 **(quirk)**. N is excluded, while `calcResults` counts N as 0 **(quirk)**. The
  same is done per group (`:131-149`, `:818`).
- **Group of a student** in the overview: the first group in the year whose `student_ids` contains
  the student, with no jaarlaag/subject filter (`modals/toets-overzicht.js:50-56`). The Resultaten
  tab instead lists students per `examGroups(exam)`: groups with the same jaarlaag and an
  overlapping schoolsoort (`screens/scores.js:366-375`).
- **Observaties tab:** count of students per observatie, plus counts by group and by grade group
  (`modals/toets-overzicht.js:61-65`, `:83-89`, `:151-157`, `:1114-1215`). Students with only
  observations and no scores are counted but have no grade group.

### 6.3 Profile (`modals/profiel.js`)

- **Weighted year average** `yearAvg` (`:637-662`): for each original exam of the year, take the
  best attempt grade with weight `Number(e.weging ?? 1)` and compute `Σ w·g / Σ w`. The result is
  null when `Σ w = 0`.
- **SE / PTA average** `ptaAvg` (`:665-677`): over the resolved history (all years), PTA exams
  only, with weight `Number(weging_se ?? weging ?? 1)`. The same formula is duplicated in
  `modals/groep-leerlingen.js:56-71`.
- **Jaarlaag average per year** (`:689-718`): the mean of `yearAvg` over the students of that year
  whose `jaarlaagFromStamklas(stamklas)` equals the jaarlaag of the profiled student's exams in that
  year.
- **Jaarlaag SE average** (`:720-737`): the mean of `ptaAvg` over the students of the
  **currently selected** year whose stamklas jaarlaag equals the jaarlaag of the student's last
  history year.
- **Toetsgemiddelde bars** (`:495-516`): `computeExamStats(year, exam)` per attempt. The formatted
  1-decimal string is parsed back with `parseFloat(avgG.replace(',', '.'))`. The SD is drawn as an
  error band clamped to `[1, 10]` (`:345-366`).
- **Observaties per year** (`:111-127`): the number of exams on which each observatie was checked,
  counting only observaties that are in that exam's `obs_ids`.
- **Onderbouw / bovenbouw split**: exam jaarlaag 1–3 or 4–6. The default comes from the student's
  stamklas: `≥ 4` → bovenbouw (`:106-107`, `:391-395`).

---

## 7. Observaties → opdrachten

### 7.1 Observaties

- Shape: `{ id: 'obs-<ts>', naam, icon, uitleg, leeradvies, jaarlagen[], subjects[], schoolsoort[] }`
  (`screens/observaties.js:199-210`). Saving requires at least one schoolsoort, one vak and one
  jaarlaag (`screens/observaties.js:349-364`).
- Subject match: `obs.subjects` (or the legacy `obs.subject`) contains the subject. For `wi`, any
  of `wisob, wisa, wisb, wisc, wisd` matches (`store.js:216-224`).
- Offered on an exam (exam editor) when the observatie's `jaarlagen` contains the exam's jaarlaag
  **and** (`obs.schoolsoort` is empty, or it overlaps the exam's schoolsoort)
  (`modals/toets-edit.js:379-386`). An empty `jaarlagen` means "never offered". Compare
  `opdrachtMatchesExam`, where empty lists always fit **(quirk)**.
- Per student: `rec.observations[examId]` holds the checked obsIds. An entry is removed when it
  becomes empty (`store.js:803-814`). Deselecting an observatie on the exam removes it from every
  student's record (`store.js:1136-1150`, `modals/toets-edit.js:704-706`). An observatie that is
  used in any cached exam cannot be deleted (`store.js:1025-1032`,
  `screens/observaties.js:174`).

### 7.2 Opdracht ↔ exam fit — `opdrachtMatchesExam` (`store.js:1215-1226`)

```
vakOk = vakken empty || any(v == subject)   (subject 'wi': v ∈ WI_VARIANTS)
jlOk  = jaarlagen empty || !exam.jaarlaag || jaarlagen.map(String).includes(String(exam.jaarlaag))   // element-wise, store.js:1221
ssOk  = schoolsoort empty || exam.schoolsoort empty || overlap
fit   = vakOk && jlOk && ssOk
```

The Opdrachten screen filter duplicates this with `v.startsWith('wis')` for `wi`
(`screens/opdrachten.js:47-70`).

### 7.3 Coupling — `getOpdrachtCoupling(exam)` (`store.js:1229-1244`)

For each `obsId` in `exam.obs_ids`:

- If `exam.opdrachten[obsId]` exists (even `[]`), the coupling is that saved list, filtered to
  opdrachten that still exist.
- Otherwise the default is every opdracht whose `observaties[]` includes `obsId` **and** that fits
  the exam (§7.2).

The coupling is saved only on Generate and on close, and only if it changed
(`modals/opdrachten-genereren.js:86`, `:96`, `:297-312`, `:363`). It is written with
`setExamOpdrachten`, which merges into the file on disk; `opdrachtenCijfer` is deleted when there
are no cards (`store.js:1265-1282`).

### 7.4 "Cijfer onder X" cards (v0.1.6)

- Stored as `exam.opdrachtenCijfer = [{ id: 'cijfer-<ts>', onder, opdrachten: [opdrachtId] }]`.
  `getOpdrachtCijferCards` drops opdrachten that no longer exist (`store.js:1247-1253`). A new
  card defaults to `onder: 5.5` (`modals/opdrachten-genereren.js:468-471`).
- Threshold input: `Number(t.replace(',', '.'))`. It is rejected when empty, NaN, `n <= 1` or
  `n > 10`, so `1,0` is rejected although the message says "tussen 1,0 en 10,0" **(quirk)**.
  Otherwise it is stored as `Math.round(n*10)/10` (`modals/opdrachten-genereren.js:442-455`).
- Rule: the student's grade on **this exam** (`examResults(rec, exam).grade`, override included)
  is computed only if there is at least one card. When it is not null, `rounded = round1(grade)`,
  and the student is assigned the card when `rounded < card.onder` (strict)
  (`store.js:1327-1335`).
- Reason chip: icon `5️⃣` (`'5️⃣'`), name `Cijfer onder <onder with 1 decimal comma>`
  (`store.js:1256-1261`).

### 7.5 `getOpdrachtAssignments(exam, year, coupling, cijferCards)` — `store.js:1295-1353`

```
for s in getStudentsSync(year):                 // all students of the year
  own = set(rec.observations[exam.id])
  items = ordered map opdrachtId -> {opdracht, obs: [reasons]}
  give(opIds, reason): for each existing opdracht id, add reason (opdracht listed once)
  for obsId in exam.obs_ids (in order):
     if obsId in own: obsStudents[obsId] += s   // counted even if obs deleted
                       if observatie exists: give(coupling[obsId], observatie)
  if cards: grade rule of §7.4 -> cijferStudents[card.id] += s; give(card.opdrachten, reason)
  if items empty: skip student
  group = first own group with jaarlaag == exam.jaarlaag, else first own group, else null
sort: students with a group first; group name; achternaam; voornaam; fullName
      (localeCompare 'nl', numeric)
```

Each (student, opdracht) pair becomes one PDF document with a header that lists every reason
(`modals/opdrachten-genereren.js:316-332`). Students can be unticked for one run
(`state.excluded`, `:262-266`). The answer key is one document per distinct opdracht, sorted by
naam (`:335-349`). The student batch is duplex, so each student starts on an odd page; the answer
key is not (`:384`, `_reference/CLAUDE.md:61`).

---

## 8. Rapport (exam report) data rules — `modals/rapport.js:179-282`

- **Students:** all students of the year whose `jaarlaagFromStamklas(stamklas)` equals
  `exam.jaarlaag` (all students when the exam has no jaarlaag) (`:193-195`). A student is only
  included if `rec.scores[examId]` has at least one value that is neither null nor undefined
  (`:202-205`). Students with only `N`s, or with only an override, are **excluded**.
- **Grade:** `calcResults(exam, questionScores, override)`, giving `grade` (override included) and
  the `overridden` flag. It is formatted with 1 decimal and a comma, `'—'` when null. The PDF says
  "Dit cijfer is met de hand overschreven door de docent." when the grade was overridden
  (`_reference/CLAUDE.md:113`).
- **Per question** (`assembleVragen`, `:44-81`):
  - `score = null` if the value is undefined, null or 'N', else `Math.max(0, Number(raw))` (NaN and
    over-max values are taken as they are).
  - The class average is over all included students with a non-N value that is not NaN. Every kind
    of question is included, and so are over-max values. It is rounded to 1 decimal, and `0` when
    there is no data.
  - `class_pct = round(classAvg/max*100)`, computed from the **already rounded** average
    **(quirk)**; `0` when max is 0.
  - Dot colour: grey when null, red at `≤ 0`, green at `≥ max`, else a red→yellow→green gradient on
    `score/max` (`:29-37`).
  - Label `section+number`, or `number` alone when there is no section.
- **Sort:** group name, then achternaam (`localeCompare 'nl'`). The group is the **first** group of
  the subject that contains the student (`:207`, `:236-241`).
- `global_max_points = max(max_points)` over all questions, `1` if there are none (`:245-247`).
- **Advice file:** `templates/RTTI explanations and advices/rtti_expl_adv_<exam.subject>_<jaarlaag>.json`
  (`:250-251`, `:403-405`), falling back to `defaultTabData()` (`:407-423`). The editor saves
  bovenbouw wiskunde as `wisa/wisb/wisc/wisd` (`:380-400`), but the rapport reads `wi_<jl>`
  **(quirk)**.
- `fmtNum`: an integer is printed as is, anything else with `toFixed(1)` and a comma (`:123-125`).
  A Typst string with an odd number of `$` gets its `$` escaped and a red warning prepended
  (`:133-139`).

---

## 9. CSV import

There is **no CSV export** in the reference app. Import is done in three modals. Each first asks
for the school year with `askSchoolYear` (`utils/csv.js:107-166`): the choices are the active year
plus the existing years, sorted newest first, and a typed value wins over the selection.

### 9.1 Parser — `parseCSV(text)` (`utils/csv.js:59-97`)

- `text.trim().split(/\r?\n/)`. Fewer than 2 lines gives `{headers: [], rows: []}`.
- **Delimiter:** count the `;` and `,` in the header line; `;` wins ties (`semi >= comma`).
- **Quotes:** each `"` toggles quote mode and is dropped. There is no escaped-quote (`""`) support,
  so `""` becomes empty, and a newline inside quotes is not supported (the split by lines happens
  first).
- Fields are trimmed. Leading/trailing `"` are stripped again from headers and values.
- Empty lines are skipped. A missing field becomes `''`, and extra fields are ignored.
- **Encoding:** the file is read with `File.text()`, which is always UTF-8
  (`modals/leerling-edit.js:223`, `modals/groep-edit.js:480`, `:603`). A UTF-8 BOM is not stripped,
  so it stays on the first header name, and ANSI/Windows-1252 files are decoded as UTF-8
  **(quirk)**.
- Header names are case-sensitive keys.

### 9.2 Students — `modals/leerling-edit.js:195-278`

| Column                                                            | Fallback key     | Mapping                                                                                    |
| ----------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------ |
| `Leerlingnummer`                                                  | `leerlingnummer` | `id: Number(...)` (a **number**, while CLAUDE.md says ids are numeric strings) **(quirk)** |
| `Voornaam`, `Tussenvoegsel`, `Achternaam`, `Geslacht`, `Stamklas` | lowercase        | string, `''` default                                                                       |
| `Jaarlaag`                                                        | `jaarlaag`       | trimmed string                                                                             |
| `Schoolsoort`                                                     | `schoolsoort`    | split on `,`, trimmed, empties removed (only works with a `;`-delimited file)              |

- A row is kept only if `id` is truthy (not 0/NaN) **and** `achternaam` is non-empty.
- `upsertStudents` → `mergeStudent` matches on `s.id === flat.id` with strict equality
  (`store.js:420-434`). An existing string id `"101010"` does not match an imported `101010`, so a
  duplicate is added **(quirk)**. A matched student is overwritten field by field, with `''` / `[]`
  for absent fields. The list is sorted by jaarlaag (numeric), stamklas, achternaam
  (`store.js:387-398`).

### 9.3 Groups — `modals/groep-edit.js:448-559`

- Columns: `Naam`, `Schoolsoort`, `Vak`, `Leerjaar`, `Docent`. Each invalid row is skipped with its
  own error toast.
- `Naam` is required.
- `Schoolsoort` must match one of `Vmbo-bb, Vmbo-kb, Vmbo-gl, Vmbo-tl, Havo, Vwo, Gymnasium`
  (case-insensitive) (`:428-436`).
- `Vak` is looked up case-insensitively in `{bio, biologie, nat, natuurkunde, schk, scheikunde, wi,
wiskunde}` (`:437-446`).
- `Leerjaar` must be one of `'1'..'6'` (`:447`).
- `Docent` matches a user's full name (`voornaam tussenvoegsel achternaam`, case-insensitive). If
  nothing matches it becomes `null`, with no error.
- Result: `{ id: makeGroupId(naam, year), name, jaarlaag, subject, schoolsoort: [ss], subcategory:
parseGroupName(...).subcategory, docenten, student_ids: [] }`. Wiskunde subcategory: `wisd/c/b/a`
  is found by substring, otherwise jaarlaag ≤ 3 gives `onderbouw` (`store.js:246-268`).

### 9.4 Group assignment — `modals/groep-edit.js:574-660`

- Columns: `Naam`, `Leerlingnummer`.
- The group is matched on its exact `name`, and the student on `String(s.id) === Leerlingnummer`.
  Each miss gives an error toast and the row is skipped.
- The student ids are added to the group's existing `student_ids` (union). Nobody is ever removed.
- Ids are pushed as the student's stored id type.

---

## 10. Date / time dependence

| Rule                                                                                                                                                            | Ref                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `currentSchoolYear()`: local time; `getMonth() >= 7` (August or later) → `"Y-(Y+1)"`, else `"(Y-1)-Y"`. The school year turns over on **1 August**, local time. | `store.js:369-373`                                                                                                           |
| `activeYear` = `config.json.activeYear`, falling back to `currentSchoolYear()` when there is no config. It is not advanced automatically.                       | `store.js:338-340`, `:359-366`, `:326-327`                                                                                   |
| Year folders are `^\d{4}-\d{4}$`, listed newest first.                                                                                                          | `_reference/main.js:124-134`                                                                                                 |
| Year screens add `activeYear` to the year list even when its folder does not exist yet.                                                                         | `screens/toetsen.js:53`, `screens/groepen.js:38`, `screens/leerlingen.js:38`                                                 |
| History is sorted by `academic_year` (string), then `volgnummer`.                                                                                               | `store.js:651-655`, `:1127-1131`                                                                                             |
| `volgnummer` of a new exam = `jaarlaag·100 + max(volgnummer % 100 of exams with the same jaarlaag) + 1`. Resits copy it from the parent.                        | `store.js:533-544`                                                                                                           |
| `_meta.createdAt/updatedAt` = `new Date().toISOString()`.                                                                                                       | `store.js:90-102`                                                                                                            |
| Ids from `Date.now()`: `obs-<ts>`, `opdracht_<ts>`, `cijfer-<ts>`, `gebr-<ts>`.                                                                                 | `screens/observaties.js:201`, `screens/opdrachten.js:358`, `modals/opdrachten-genereren.js:469`, `screens/gebruikers.js:220` |
| Exam id = `<subject>-<slug(title)>-<year>`, where the slug maps runs of non-`[a-z0-9]` characters (after lowercasing) to `-`, so accented letters are dropped.  | `store.js:757-763`                                                                                                           |

---

## 11. Golden test candidates

Each case names the logic it exercises. The expected outputs should be **captured by running the
reference code** in Step 2, not worked out by hand.

1. **Plain linear grade, n = 1.** 20 normal points, S = 0, 10, 20, 13.5: `calcGrade` /
   `calcResults` (`store.js:743-754`, `:700-703`).
2. **n-term upper bound (lo1).** n = 3, low S/L (S = 1 of 20): `raw > lo1` branch
   (`store.js:749`).
3. **n-term upper bound (hi1).** n = 3, high S/L (S = 18 of 20): `raw > hi1` branch
   (`store.js:750`).
4. **n-term lower bounds.** n = 0 with S/L small (`lo2`) and S/L large (`hi2`)
   (`store.js:751-752`).
5. **n = 0.1 steps and float n.** n = 1.3 from the spinner (`parseFloat(toFixed(1))`), to check
   that no float drift appears in the grade (`utils/spinners.js:20-25`).
6. **Full marks via bonus.** normalMax 20, bonus 5, scored 18 normal + 3 bonus = 21 gives exactly
   10 through the `scored >= normalMax` shortcut. Also check the Totaal text `21 / 20 (+)`
   (`store.js:702`, `screens/scores.js:582-585`).
7. **Bonus partially compensating.** Scored 15 normal + 2 bonus of 20: the grade uses 17/20, and
   RTTI excludes the bonus question.
8. **Empty exam / no entries.** `questionScores = {}`: `grade` is null and every RTTI value is
   `'NVT'` (`store.js:700`).
9. **All N.** Every normal question `null`: the row is gradeable with scored 0 (the grade is the
   `calcGrade(0, L, n)` value), and RTTI is `0` for every tag that has questions
   (`store.js:693-696`).
10. **Only a bonus question entered as N.** The row is gradeable and the grade is computed from
    0 points (`store.js:695`).
11. **Only a diag question entered.** `anyGradeableEntered` stays false, so the grade is null
    (`store.js:687`).
12. **Only invalid values** (e.g. `'abc'`, or `12` on a max-10 question): the grade is null, but
    the RTTI possible points include those questions, giving 0 % (`store.js:683-686`).
13. **Partial entry.** 3 of 10 normal questions entered at full marks: the grade uses
    normalMax = all 10 questions, while RTTI uses only the entered ones (it can show 100 %).
14. **Exam with only bonus/diag questions** (`normalMax = 0`): the grade is null, and with an
    override the grade is the override.
15. **Question with `max_points = 0`.** A 0 score is valid and 0.5 is invalid. The RTTI tag with
    only that question gives `possible 0 → 'NVT'`.
16. **Decimal comma input.** `'1,5'`, `'1.5'`, `' 2 '`, `'1,5,0'`, `'0x1'`, `'1e0'`, `'-0'`,
    `'n'`: `normalizeScore` (`screens/scores.js:677-684`).
17. **Float accumulation.** Scores 0.1 + 0.2 on 0.3-point questions: the `scored >= normalMax`
    comparison and the Totaal text (`store.js:689`, `:702`).
18. **Rounding boundaries.** Grades whose exact value is x.x5 (e.g. built to 5.45, 5.449999,
    5.55): `formatGrade`, `isFail`, the histogram bin and `toFixed(1)` in the means
    (`app.js:363-366`, `utils/colors.js:204-206`).
19. **isFail at 5.45 / 5.46 / 5.5.** `utils/colors.js:204-206`, compared with
    `gradeGroupIdx`/histogram (unrounded).
20. **RTTI rounding.** 1 of 3 points gives 33 and 2 of 3 gives 67 with `Math.round`; x.5 % cases
    such as 1 of 8 = 12.5 % (`store.js:710-711`).
21. **Override basics.** Typed `'6,25'` is stored as 6.3. Typed `'10,04'` is **rejected** (the 1-10 range check runs before rounding, `screens/scores.js:663-667`).
    `'0,9'` and `'10,1'` are rejected (`screens/scores.js:663-667`).
22. **Override stale flag.** Set the override while calc = 5.43 (berekend 5.4), then change scores
    so calc = 5.44 (not stale) and then 5.46 (stale) (`store.js:721`).
23. **Override without scores.** `examResults` returns the override grade with
    `calculatedGrade: null` and RTTI `'NVT'` (`store.js:731-741`).
24. **Resit worse than original.** Original 7.2, resit 5.0: every best-attempt function returns
    the original (`store.js:1045-1134`, `modals/groep-leerlingen.js:77-84`).
25. **Resit tie.** Equal grades: the earliest attempt wins in all implementations.
26. **Resit better only after override.** The original's calculated grade is 4.0 with an override
    of 6.0, and the resit is 5.5: the override decides.
27. **Only the resit taken.** No history entry for the parent: `resolveBestAttempts` uses its
    second loop (`store.js:1110-1125`).
28. **Original present with a null grade, resit with a grade.** `resolveBestAttempts` uses
    `?? -1`, while `computeBestGradeMap` skips nulls.
29. **Resit with a different structure/n-term.** The best grade is computed against the resit's own
    questions (`computeBestGradeMap`). In the summary overview, `qStats`/`rttiAccum` are taken
    against the parent's question ids (`modals/toets-overzicht.js:105-129`).
30. **Weighted year/SE average.** Weights 1, 2, 0.5, a weight of 0, and `weging_se` missing (falls
    back to `weging`) (`modals/profiel.js:637-677`, `modals/groep-leerlingen.js:56-97`).
31. **Score-grid summary rows.** Totals with halves (`parseInt` truncation), mean over the rounded
    grades vs overview mean over unrounded grades, n = 1 → SD empty vs 0
    (`screens/scores.js:595-652`, `screens/toetsen.js:65-95`).
32. **Histogram binning.** Grades 1.0, 1.49, 5.47, 5.5, 9.99, 10.0 with steps 0.5 and 1
    (`modals/toets-overzicht.js:528-544`).
33. **Boxplot quartiles.** n = 1, 2, 4, 5 (`modals/toets-overzicht.js:596-607`).
34. **Vraaganalyse with N and over-max.** N is excluded; an over-max value such as 12 of 10 is
    included (`modals/toets-overzicht.js:121-129`).
35. **"Cijfer onder" threshold.** Grade 5.45 → rounded 5.5 → not `< 5.5`; grade 5.44 → 5.4 → gets
    the card; an override replaces the grade; a student without a grade gets nothing
    (`store.js:1327-1335`).
36. **Card threshold input.** `'1'`, `'1,0'`, `'1,05'`, `'10'`, `'10,04'`, `''`, `'abc'`
    (`modals/opdrachten-genereren.js:442-455`).
37. **Coupling default vs saved.** An observatie with no saved entry (default: linked and fitting
    opdrachten), with a saved `[]` (nothing), and with a saved list that includes a deleted
    opdracht (`store.js:1229-1244`).
38. **Same opdracht from two reasons.** It is listed once with two reasons, in obs_ids order and
    then card order (`store.js:1315-1335`).
39. **Assignment sorting.** A student without a group sorts last; names compared with numeric
    collation (`store.js:1344-1351`).
40. **`opdrachtMatchesExam` matrix.** Empty lists; `wi` with the `wisb` vak; an exam without a
    jaarlaag (`store.js:1215-1226`).
41. **Rapport inclusion.** A student with only `N`s, or with only an override, is excluded; a
    student in the jaarlaag by stamklas but not in any group is included with group `'—'`
    (`modals/rapport.js:193-213`).
42. **Rapport leeradvies bracket.** pct exactly 40 and 70 (`<` comparisons) and the I tag (no row)
    (`modals/rapport.js:101-121`).
43. **Rapport class average.** Built so that rounding the average first changes `class_pct`
    (`modals/rapport.js:61-63`).
44. **CSV parser.** `;` vs `,` tie, quoted field with a delimiter, `""` inside quotes, BOM header,
    CRLF, trailing empty line, short row (`utils/csv.js:59-97`).
45. **Student CSV.** `Leerlingnummer` `'00123'` → `123`; a missing achternaam row is dropped;
    `Schoolsoort` `'Havo,Vwo'` in a `;` file (`modals/leerling-edit.js:250-269`).
46. **`currentSchoolYear`.** 31 July vs 1 August, local time (`store.js:369-373`).
47. **`makeExamId` / `volgnummer`.** A title with accents and a slash in the year; the third exam in
    jaarlaag 4 → 403 (`store.js:533-544`, `:757-763`).
48. **Unknown `rtti` tag.** A question with `rtti: undefined` makes `calcResults` throw
    (`store.js:684`, `:691`, `:694`).
