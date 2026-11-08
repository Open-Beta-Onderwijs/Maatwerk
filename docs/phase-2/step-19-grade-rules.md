# Step 19: grade rules, analysis and decisions

Status: **decided by the user (2026-11-08), source of truth for step 19.** Sections 1-5 describe
the app before step 19; the "Decisions" section at the end says what it must do. Examples were
computed by running the app's real `ui/src/domain/grades.ts` (at `2542e41`).

Notation: `S` = points scored, `L` = maximum (normal questions), `n` = n-term.

## 1. What goes into the core

| Logic                                            | Where it lives now (copies)                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Grade of one attempt, RTTI of one attempt        | `domain/grades.ts` `calcGrade`, `calcResults`, `examResults`                                                        |
| Best attempt                                     | **5:** `domain/attempts.ts` `bestAttempt`, `resolveBestAttempts`; `groep-leerlingen.js`, `groepen.js`, `profiel.js` |
| Weighted year average                            | **3:** `profiel.js` `yearAvg`, `groep-leerlingen.js` `calcWeightedAvg`, `groepen.js`                                |
| SE average                                       | **2:** `profiel.js` `ptaAvg`, `groep-leerlingen.js`                                                                 |
| Mean, SD, % onvoldoende                          | **5:** `toetsen.js` (2x), `toets-overzicht.js`, `groepen.js`, `domain/scoregrid.ts`                                 |
| Rounding, pass/fail                              | `domain/format.ts`, `domain/grade-colors.ts` `isFail`, scattered `Math.round`/`toFixed`                             |
| Score grid totals and summary rows               | `domain/scoregrid.ts` (parses the displayed text back)                                                              |
| Histogram, grade groups, boxplot                 | `toets-overzicht.js`, `utils/grades.ts`, histogram again in `rapport.typ`                                           |
| RTTI statistics, question analysis               | `toets-overzicht.js` (3x), `profiel.js`                                                                             |
| Jaarlaag averages                                | `profiel.js`                                                                                                        |
| Rapport numbers (class average, advice brackets) | `domain/rapport.ts`; ranking in `rapport.typ`                                                                       |
| "The student's group"                            | **3 rules:** `store.js`, `domain/rapport.ts`, `toets-overzicht.js`                                                  |
| Trend arrow                                      | new                                                                                                                 |

**Stays in the UI:** decimal-comma formatting, colours, charts, score input parsing (B23: step 25),
"Cijfer onder" rules (B17, B18: step 30; they call the core's grade). **D4, D16, D17** are about
writing data, not numbers: checked separately in 19b.

## 2. One attempt

### Grade (`calcGrade`)

```
raw = 9 x S / L + n
n > 1: grade <= 1 + 2 x 9 x S / L     and  grade <= 10 - 0.5 x 9 x (L - S) / L
n < 1: grade >= 1 + 0.5 x 9 x S / L   and  grade >= 10 - 2 x 9 x (L - S) / L
then between 1 and 10; S >= L gives 10
```

My understanding: this is the CvTE rule. The code checks bounds in sequence instead of min/max
(quirk B29). **Tested: identical on 453,840 combinations** (n 0..3, L 1..120, half points). They
differ only for n above 4, which the UI does not allow.

| S / L | n   | raw   | grade (shown) | Why         |
| ----- | --- | ----- | ------------- | ----------- |
| 20/40 | 1   | 5,50  | 5,50 (5,5)    |             |
| 30/40 | 1   | 7,75  | 7,75 (7,8)    |             |
| 20/40 | 1,5 | 6,00  | 6,00 (6,0)    |             |
| 4/40  | 2   | 2,90  | 2,80 (2,8)    | upper bound |
| 38/40 | 3   | 11,55 | 9,775 (9,8)   | upper bound |
| 4/40  | 0,5 | 1,40  | 1,45 (1,5)    | lower bound |
| 38/40 | 0,5 | 9,05  | 9,10 (9,1)    | lower bound |
| 39/40 | 0   | 8,775 | 9,55 (9,6)    | lower bound |
| 0/40  | 3   | 3,00  | 1,00 (1,0)    | upper bound |

### Rounding: two findings

1. **The stored grade is not rounded; screens disagree on what they average.** The score grid
   averages the rounded grades, the cards and overview the unrounded ones (B6). Grades 6,46 6,46
   6,46 6,34: card **6,4**, grid **6,5**. Grades 5,44 5,44 5,54: unrounded mean 5,47 shows **5,5**,
   rounded mean 5,43 shows **5,4**, a pass/fail difference.
2. **A bug nobody listed: floating point rounds some exact halves down.** `(S / L) * 9` loses a
   tiny bit. 8,5/10 at n = 1 is exactly 8,65, but is computed as 8,649999... and **shows 8,6
   instead of 8,7**; 1,5/10 shows 2,3 instead of 2,4. At n = 1: 40 of 480 exact halves (L up to
   120). At the pass line only with n = 0 or 0,1: 54,5/90 at n = 0 is exactly 5,45, shows 5,4, a
   fail. Also `toFixed` versus `Math.round` (B8): mean 6,35 shows 6,3 on a card, 6,4 on a pill.

### Questions, N, empty, invalid

| Input (4 questions of 10 points, n = 1) | Points | Grade | R / T1 / T2 / I     |
| --------------------------------------- | ------ | ----- | ------------------- |
| 8, 6, 4, 2                              | 20/40  | 5,5   | 80 / 60 / 40 / 20   |
| 8, 6, empty, empty                      | 14/40  | 4,2   | 80 / 60 / NVT / NVT |
| 8, 6, N, N                              | 14/40  | 4,2   | 80 / 60 / 0 / 0     |
| N, N, N, N                              | 0/40   | 1,0   | 0 / 0 / 0 / 0       |
| all empty                               | 0/40   | none  | NVT                 |
| 12 (invalid), 6, 4, 2                   | 12/40  | 3,7   | 0 / 60 / 40 / 20    |
| only 12 (invalid)                       | 0/40   | none  | 0 / NVT / NVT / NVT |

The overview and vraaganalyse skip N (B1) and count over-max values (B2), unlike the above.

Bonus and diagnostic questions (normal 10 + 10, bonus 5, diag 5):

| Input          | Points | Grade | Note                     |
| -------------- | ------ | ----- | ------------------------ |
| 7, 7           | 14/20  | 7,3   |                          |
| 7, 7, bonus 3  | 17/20  | 8,7   | bonus in S, not in L     |
| 10, 6, bonus 5 | 21/20  | 10,0  | S >= L gives 10          |
| only bonus 3   | 3/20   | 2,4   | a grade from bonus alone |
| only diag 3    | 0/20   | none  | diag never counts        |
| 7, 7, diag 5   | 14/20  | 7,3   |                          |

### Override

`cijfer` replaces the grade in every statistic; points and RTTI still come from the scores;
"stale" warning when the calculated grade moved since. Calculated 4,6, override 6,0: grade 6,0.

## 3. Attempts and averages

- **Best attempt:** highest grade over original and resits (override included); the earliest wins
  a tie; attempts without a grade are skipped. Original 4,8, herkansing 6,2: 6,2 counts. Herkansing
  3,5: 4,8 counts.
- **Year average:** `sum(weging x best grade) / sum(weging)` over the year's tests with a grade;
  missing tests are not 0; `weging` of the original, default 1; PTA tests included; weging 0 falls
  out. Grades 6,0 (w1), 8,0 (w2), diagnostic 3,0 (w0): **7,3**.
- **SE average:** same, PTA only, over **all years**, weight `weging_se`, else `weging`, else 1.
  6,0 (w1), 7,0 (w3): **6,8** (6,75).
- **Class statistics:** mean; SD with `/ n` (population); % onvoldoende = students below 5,5.
  [5, 6, 7, 8]: mean 6,5, SD 1,1 (with `/ (n-1)` it would be 1,3). One student: grid empty, elsewhere 0,0.
- **Group card:** mean, SD and % onvoldoende of the students' year averages.
- **Jaarlaag average (profile):** mean of the year averages of students in that jaarlaag. The SE
  version uses the _currently selected_ year's students (B16).

## 4. Charts and rapport

- **Histogram:** bins on the unrounded grade: 5,47 passes yet falls in `<5,5` (B7).
- **Grade groups:** `<4, 4-5, 5-6, 6-7, 7-8, >8`; the label `>8` includes 8,0.
- **Boxplot:** no interpolation. [5, 6, 7, 8]: Q1 6, median 7, Q3 8; Excel gives 5,75 / 6,5 / 7,25.
- **Rapport class average per question:** rounded first, percentage from the rounded value (B12).
- **Rapport advice:** % below 40 = laag, below 70 = midden, else hoog (per file). No I row (B11).
- **Rapport exclusions:** a student with only N or only an override gets no rapport (B10).
- **Ranking (T9):** the text says "beste 33%" but is about the top 10%; "beste 67%" is about the
  next 10%. 25 grades: 2 and 3 students. 30 grades: 3 and 3. Shown from 10 grades (the comment says 3).
- **Trend (decision 12, spec 2.4):** best attempt of the most recent counted test minus the
  weighted year average; `|d| < 0,5` level, `0,5..1,0` slight, above 1,0 strong.

## 5. Architecture

Today every grade is computed synchronously in the UI (29 call sites, the grid on every keystroke),
and the e2e tests run on a mock backend without Rust. The plan says Tauri commands.

## 6. Decisions

Filled in as the user answers (2026-11-08).

1. **Formula:** correct; the core writes it in the CvTE min/max form (no number changes for n 0-3).
2. **Which grade:** the grade rounded to 1 decimal everywhere (mean, SD, year and SE average, best
   attempt, histogram, % onvoldoende).
3. **Rounding:** exact half-up everywhere; floating-point noise removed first, also in point totals.
4. **N and empty:** N = 0 points of the max everywhere (grade, RTTI, overview, vraaganalyse,
   rapport); all N stays 1,0 and gets a rapport (B10). Empty = 0 for the grade, left out of RTTI.
5. **Invalid, bonus, diag:** the grade rules as listed, applied everywhere. RTTI over normal
   questions only; invalid = 0 of max; only invalid = no grade. Bonus in S, not in L; bonus alone
   gives a grade. Diag never counts. Vraaganalyse shows every question separately.
6. **Override:** rules unchanged; an override-only student now also gets a rapport (grade and "met
   de hand overschreven", no question table).
7. **RTTI averages:** pooled points (sum of points / sum of max) everywhere; Gem. and SE use the
   best attempt per test; the bars keep showing every attempt.
8. **Best attempt:** highest grade for inhaal and herkansing alike, the earliest on a tie.
9. **Year average:** formula as in section 3; tests without a grade are skipped; a resit without
   an original counts with its own weging.
10. **SE average:** formula as in section 3, over all years; the weight always comes from the
    original test. (Correction: the code took it from the counting attempt.)
11. **Mean and SD:** divide by n; one student gives SD 0,0 on every screen, including the grid.
12. **Populations:** as in section 3. Grid average Totaal uses real half points and the max of the
    normal questions (B4); jaarlaag SE peers come from the student's own last year (B16).
13. **Trend:** most recent = highest volgnummer in the selected year among the student's tests
    with a grade and weging above 0; d = the two rounded numbers on screen; levels from spec 2.4
    (+0,4 level, +0,5 and +1,0 slight, +1,1 strong). One test: level. No grade: no arrow.
14. **Charts:** rounded grades; half-open bins; boxplot as Excel QUARTILE.INC; last grade-group
    label becomes `≥8`.
15. **Rapport numbers:** class % from the unrounded average (B12); advice level from the rounded %
    the student reads; an I row when the test has I questions (B11).
16. **Ranking (T9):** the same students, text "beste 10%" and "beste 20%"; comment corrected to 10.
17. **Group of a student (B19, B31):** among groups with the exam's vak, jaarlaag and an overlapping
    schoolsoort, the first by name; if none, the first of all groups by name. **Summary (B14):**
    every attempt is read with its own questions.
18. **Unknown RTTI tag (B28):** the question counts in the grade, in no RTTI category; a warning in
    Gegevenscontrole; the data is not rewritten.
19. **PO:** as in decisions 16, 17 and 22 of `PLAN-2.md`; grade rounded once, at the end; no RTTI;
    counted with weging and weging SE; best attempt counts. The grade function comes in step 21a.
20. **Architecture:** a pure Rust crate, native for core, CLI and rapport, WebAssembly for the UI
    and the mock (`docs/adr/0011-grades-in-webassembly.md`).

21. **Averages of averages (group card, jaarlaag average):** of the students' year averages as
    shown, rounded to 1 decimal; SD and % onvoldoende too.
22. **A bad weging in a file:** negative counts like 0 (the test falls out); not a number counts as
    1; Gegevenscontrole lists it; the data is not rewritten.
23. **An unknown question `kind` in a file:** counts as a normal question; Gegevenscontrole lists
    it; the data is not rewritten.
24. **Empty on the rapport (found in review, M3):** the advice table and RTTI bars count an empty
    question as 0 of its max, as the grade on that page does: `8, empty, empty` of 10 each is
    `8 / 30 (27%)`, laag; an all-empty category is `0 / 30 (0%)`, laag. Grid and overview keep
    leaving empty out (decision 4); the class average still skips it (decision 15).
25. **The year's tests (found in review, M4):** every screen and the CLI use all tests of that vak
    and school year that the student has a grade for, so one student has one year average. The
    group overview's columns still show only the group's jaarlaag.
