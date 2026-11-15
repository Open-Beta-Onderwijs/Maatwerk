# Step 29: the numbers of the overviews (before/after)

PLAN-2 section 2 ("Numbers"): the group overview (step 29a, board 45) shows new numbers: a
STANDAARDDEVIATIE row, RTTI per test over the year and observatie counts "n (p%)". No grade rule
changed: every number comes from the core functions the app already used (`stats`,
`statsOfAverages`, `yearAverage`, `seAverage`, `pooledRtti`; decisions 9, 10, 12, 21 of
`docs/phase-2/step-19-grade-rules.md`). **Needs the user's OK before the merge.**

Fixture: the mock data folder (`tools/fixtures`, fixed seed), school year 2025-2026, nat, logged
in as the nat teacher. Read from the app with Playwright (new group overview: the DOM; old exam
overview: its Chart.js data). Groups: **3a nat** (8 students) and **3 nat cluster** (3 students,
who are also in 3a).

## 1. Resultaten: GEMIDDELDE and STANDAARDDEVIATIE

GEMIDDELDE is unchanged: per test the mean of the grades that count (as the old footer, `mean`);
under gem. and SE the mean of the students' averages as shown (`meanOfAverages`, decision 21).
A unit test checks that the new footer gives exactly the old functions' values
(`ui/src/overview/overview.test.ts`). New is the STANDAARDDEVIATIE row: the population SD (as
the cards and the exam overview), of the grades per test and of the shown averages under gem. and
SE.

| Groep         |      | 301   | 302   | 350 | 351   | 303   | gem.  | SE    |
| ------------- | ---- | ----- | ----- | --- | ----- | ----- | ----- | ----- |
| 3a nat        | gem. | 5,6   | 4,5   | —   | 6,9   | 6,6   | 5,1   | 4,5   |
| 3a nat        | SD   | ± 1,5 | ± 1,8 | —   | ± 0,0 | ± 1,0 | ± 1,3 | ± 1,8 |
| 3 nat cluster | gem. | 6,5   | 5,6   | —   | 6,9   | 6,1   | 6,1   | 5,6   |
| 3 nat cluster | SD   | ± 2,1 | ± 2,4 | —   | ± 0,0 | ± 0,8 | ± 1,6 | ± 2,4 |

The 3a gem. row equals the card of step 27 (5,1 ± 1,3, approved 2026-11-13).

**SE column:** shown when the group is upper school (jaarlaag 4-6, as the cards) or one of its
tests is an SE test. Both fixture groups are jaarlaag 3 with SE test 302, so the column stays;
a lower-school group without an SE test loses it (before: always shown).

## 2. RTTI-analyse: RTTI per test (new)

Before, RTTI per group existed only per test in the exam overview ("RTTI-scores per groep"). The
group overview now shows it for every test of the year (PO's left out, decision 32). Two
differences, both by design:

- **Who:** the group overview counts **every member of the group**; the exam overview puts each
  student in **one** group (`studentGroup`), so students of 3a who are also in the cluster were
  counted only under the cluster there.
- **Which attempt:** the group overview takes the attempt that counts (the best of original and
  resits, as the grade column); the exam overview of the original takes the original only.

| Groep         | Toets | Exam overview (before) R / T1 / T2 / I      | Group overview (after) R / T1 / T2 / I |
| ------------- | ----- | ------------------------------------------- | -------------------------------------- |
| 3a nat        | 301   | 37 / 43 / 55 / 17                           | 37 / 58 / 47 / 27                      |
| 3a nat        | 302   | 44 / 28 / 58 / 54                           | 48 / 30 / 58 / 42                      |
| 3a nat        | 303   | 50 / 51 / 50 / 44                           | 50 / 48 / 53 / 46                      |
| 3a nat        | 351   | (its one student counted under the cluster) | 70 / 30 / 70 / 50                      |
| 3 nat cluster | 301   | 44 / 56 / 46 / 33                           | 44 / 56 / 46 / 33                      |
| 3 nat cluster | 302   | 54 / 33 / 57 / 21                           | 54 / 33 / 57 / 21                      |
| 3 nat cluster | 303   | 50 / 44 / 59 / 48                           | 50 / 44 / 59 / 48                      |
| 3 nat cluster | 351   | 70 / 30 / 70 / 50                           | 70 / 30 / 70 / 50                      |

The cluster's rows are equal (its students are in no other group of these tests and have no
resits). For 3a nat, 302 after equals the exam overview's "Alle" (every student who made 302 is
in 3a); 301 after includes the inhaal and herkansing attempts that count. A test without RTTI
points (350, no grades) is left out of the chart.

## 3. Observaties: "n (p%)" per test (new)

Students of the group with the observatie on the attempt that counts (without a grade: on any
attempt), percentage of the group; Totaal = the sum over the tests ("times given this year").
Before: the exam overview's "Observaties per groep" (one group per student, original only).

| Groep         | Observatie             | 301 before → after | 302 before → after | 303 before → after | Totaal |
| ------------- | ---------------------- | ------------------ | ------------------ | ------------------ | ------ |
| 3a nat        | Eenheden vergeten      | 2 → 3 (38%)        | 1 → 1 (13%)        | 2 → 3 (38%)        | 7×     |
| 3a nat        | Formule niet genoteerd | 0 → 2 (25%)        | 1 → 1 (13%)        | 0 → 1 (13%)        | 4×     |
| 3a nat        | Rekenfout              | 0 → 1 (13%)        | 1 → 1 (13%)        | 1 → 2 (25%)        | 4×     |
| 3 nat cluster | Eenheden vergeten      | 2 → 2 (67%)        | 0 → —              | 1 → 1 (33%)        | 3×     |
| 3 nat cluster | Formule niet genoteerd | 2 → 2 (67%)        | 0 → —              | 1 → 1 (33%)        | 3×     |
| 3 nat cluster | Rekenfout              | 1 → 1 (33%)        | 0 → —              | 1 → 1 (33%)        | 2×     |

3a's higher counts are the cluster students (members of both groups) and, for 301, the inhaal
attempt that counts (its "Eenheden vergeten", 1 in the old INHAAL overview).

The exam overview (step 29b) keeps its own rule for "per groep" (one group per student, as the
score grid's sections), so these two views can differ for students in two groups.

## 4. Exam overview (step 29b): GEMIDDELDE and STANDAARDDEVIATIE per group (new)

Before, the Resultaten tab had a table per group without footer; the summary line above it is
unchanged. Each group now gets the score grid's footer (step 25, decision 29 of the grade
rules): Totaal and Cijfer mean ± SD, the number of ticked students per observatie, and per RTTI
category the mean of the graded rows' percentages (whole percent; NVT left out). The sections
are the exam's groups as in the score modal (a student in two groups is in both sections).

| Toets                  | Groep         | Totaal     | Cijfer    | Observaties 📏 ✏️ 🧮 | R / T1 / T2 / I    |
| ---------------------- | ------------- | ---------- | --------- | -------------------- | ------------------ |
| 301 Toets H1           | 3 nat cluster | 7,8 ± 2,2  | 6,5 ± 2,1 | 2 2 1                | 44 / 55 / 46 / 33  |
| 301 Toets H1           | 3a nat        | 7,1 ± 1,8  | 5,4 ± 1,6 | 4 2 1                | 40 / 48 / 52 / 23  |
| 301 HERKANSING         | 3 nat cluster | 8,0 ± 0,0  | 5,5 ± 0,0 | 0 0 0                | 17 / 67 / 38 / 100 |
| 301 HERKANSING         | 3a nat        | 7,5 ± 0,5  | 5,2 ± 0,3 | 0 0 0                | 13 / 84 / 19 / 75  |
| 301 INHAAL             | 3 nat cluster | 5,0 ± 0,0  | 4,8 ± 0,0 | 0 0 0                | 13 / 50 / 50 / 20  |
| 301 INHAAL             | 3a nat        | 3,3 ± 1,8  | 3,8 ± 1,1 | 1 0 0                | 13 / 30 / 25 / 15  |
| 302 Toets H2           | 3 nat cluster | 12,0 ± 1,9 | 5,6 ± 2,4 | 0 0 0                | 54 / 33 / 53 / 21  |
| 302 Toets H2           | 3a nat        | 12,5 ± 2,8 | 4,5 ± 1,8 | 1 1 1                | 49 / 30 / 56 / 42  |
| 303 Toets H3           | 3 nat cluster | 19,3 ± 0,8 | 6,1 ± 0,8 | 1 1 1                | 50 / 44 / 56 / 51  |
| 303 Toets H3           | 3a nat        | 19,9 ± 3,8 | 6,6 ± 1,0 | 3 1 2                | 51 / 48 / 53 / 47  |
| 351 Toets één leerling | both          | 10,5 ± 0,0 | 6,9 ± 0,0 | (none linked)        | 70 / 30 / 70 / 50  |
| 301 verzameloverzicht  | 3 nat cluster | 7,8 ± 2,2  | 6,5 ± 2,1 | 2 2 1                | 44 / 55 / 46 / 33  |
| 301 verzameloverzicht  | 3a nat        | 7,4 ± 1,7  | 5,6 ± 1,5 | 3 2 1                | 38 / 58 / 47 / 27  |

The footer's RTTI is the mean of the students' percentages (as the score grid); the RTTI cards
of the RTTI-analyse tab keep the pooled points (unchanged), so the two can differ.

**RTTI-verloop:** one point per original test of the jaarlaag (the same pooled values as
before for those tests: 301 is 40 / 48 / 52 / 23 as the old chart and the "Alle leerlingen"
card). Before, every resit was a point of its own; resits and PO's are now left out (spec 3.10:
one point per test). The chart "RTTI-scores per cijfergroep" is not on board 46 and is gone.

## 5. PO overview (step 29c, board 43; new)

There was no PO overview before ("Overzicht openen" was disabled), so every number here is new.
Seed: the e2e PO (`ui/e2e/po-seed.ts`, `grading: true`): PO 309 on rubric Onderzoeksverslag (17
points, bonus 4), Valtoren (D'Angelo O'Neill, Noor Bakker) 15 points = 8,8 with a group line
−0,5 and Noor +0,3; Projectgroep 2 (Marie-Claire 't Hart, Olivia ter Østergaard) Theorie 4 = 2,4;
the other students of the classes are not placed. Grades are the grade rules' (`examResults`,
decision 28); means and SD with `stats` (population SD, as everywhere).

| Section (Resultaten)          | Theorie   | Uitvoering | Extra (B) | Samenwerken (D) | Punten     | Cijfer    |
| ----------------------------- | --------- | ---------- | --------- | --------------- | ---------- | --------- |
| Klas 3 nat cluster (1 graded) | 6,0 ± 0,0 | 7,0 ± 0,0  | 2,0 ± 0,0 | 3,0 ± 0,0       | 15,0 ± 0,0 | 8,3 ± 0,0 |
| Klas 3a nat (2 graded)        | 4,0 ± 0,0 | —          | —         | —               | 4,0 ± 0,0  | 2,4 ± 0,0 |
| Klas 3b nat (1 graded)        | 6,0 ± 0,0 | 7,0 ± 0,0  | 2,0 ± 0,0 | 3,0 ± 0,0       | 15,0 ± 0,0 | 8,6 ± 0,0 |
| Valtoren                      | 6,0 ± 0,0 | 7,0 ± 0,0  | 2,0 ± 0,0 | 3,0 ± 0,0       | 15,0 ± 0,0 | 8,5 ± 0,2 |
| Projectgroep 2                | 4,0 ± 0,0 | —          | —         | —               | 4,0 ± 0,0  | 2,4 ± 0,0 |

A student's klas is the first matching class by name (as the PO score table's Klas column), so
D'Angelo, who is in 3a nat and 3 nat cluster, is under 3 nat cluster only. A category mean is
over the students with a score for it; "Niet ingedeeld" has no footer.

- **Cijferverdeling:** Alle leerlingen 4, gem. 5,4 ± 3,0, 50% onvoldoende (the same as the PO
  card's stats line); per klas 8,3 / 2,4 / 8,6.
- **Categorieën** (the 4 placed students): Theorie 5,0 / 8 (63%), levels 0 / 2 / 2; Uitvoering
  7,0 / 9 (78%); Extra onderzoek 2,0 / 4 (50%); Samenwerken 3,0 / 3 (100%, diagnostic); TOTAAL
  PUNTEN 9,5 / 17 = 56% (incl. bonus, excl. diagnostisch). A category's mean counts only the
  students with a score in it, the total counts every graded student.
- **Observaties:** Bronnen ontbreken (Theorie) 2 (50%), 1 van 2 groepen; Netjes gewerkt 2 (50%),
  1 van 2 groepen; Goed samengewerkt and Planning niet gehaald 0.

## 6. Student profile (step 29c, board 44)

D'Angelo O'Neill (900001), with the seed of section 5. The averages are the same functions as
before, so only the SD (and the PO bar) is new.

| Row                              | Student | Before: average | After: average ± SD |
| -------------------------------- | ------- | --------------- | ------------------- |
| 301 Toets H1                     | 6,9     | 5,4             | 5,4 ± 1,6           |
| 301-H Herkansing                 | 5,5     | 5,2             | 5,2 ± 0,3           |
| 301-I Inhaal                     | 4,8     | 3,8             | 3,8 ± 1,1           |
| 302 Toets H2                     | 3,5     | 4,5             | 4,5 ± 1,8           |
| 303 Toets H3                     | 6,7     | 6,6             | 6,6 ± 1,0           |
| 309 PO Onderzoek valbeweging     | 8,3     | 5,4             | 5,4 ± 3,0           |
| 351 Toets één leerling           | 6,9     | 6,9             | 6,9 ± 0,0           |
| 2025-2026 jaarlaag 3 (year avg.) | 6,3     | 5,4             | 5,4 ± 1,8           |
| Examendossier (SE)               | 7,5     | 5,2             | 5,2 ± 2,4           |

"Before" for a test is `computeExamStats` (the old chart's toetsgemiddelde, also the Toetsen
card's stats line); for the year and SE rows `meanOfAverages`, now `statsOfAverages` (decision
21: the same mean). The SD band was drawn for the tests before (an error band) without a number;
the year and SE rows had no SD. B15 (decision 7) and B16 (decision 12) are kept: per-year rows
and RTTI cards use every graded attempt, RTTI "Gemiddeld" the pooled attempts that count, the SE
peers come from the student's last school year. The Cijferverloop bars are the attempts that
count, as before; the grey toetsgemiddelde and jaarlaag bars are now the ◇ on a track (spec
4.15).
