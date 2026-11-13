# Step 27: the numbers on the cards (before/after)

PLAN-2 section 2 ("Numbers"): the student and group cards (F-07, F-08, F-09) show numbers on new
places. No rule changed: every number comes from the core functions the app already used
(`yearAverage`, `seAverage`, `trend`, `statsOfAverages`; decisions 9, 10, 12, 13, 21 of
`docs/phase-2/step-19-grade-rules.md`). **Needs the user's OK before the merge.**

Fixture: the mock data folder (`tools/fixtures`, fixed seed), school year 2025-2026, logged in as
the nat teacher. "Before" is what the app showed until now: the per-student averages in the group
overview (Jaar and SE columns, unchanged) and the group line of the old Groepen list, which was
the same `statsOfAverages` of the year averages.

What a card shows:

- **Student card:** the year average (rounded, as in the Jaar column), the trend arrow (decision
  13: the most recent counted test's best attempt minus the shown year average), "laatste" (that
  test's grade) and, in years 4-6 only, the SE average (as in the SE column). One bar per test:
  its best attempt; a diagnostic test is a grey bar and counts for nothing.
- **Group card:** mean ± SD and % onvoldoende of the students' year averages (the old line);
  years 4-6 also "SE mean ± SD" of the SE averages (variant B). The onvoldoende line counts the
  year averages.

The fixture has only year 3 for nat and no schk grades, so the SE parts are covered by unit tests
(`ui/src/domain/cards.test.ts`, `ui/src/screens/cards/card-html.test.ts`), not by this table.

### nat

| Leerling              | Jaar (groepsoverzicht, voor) | SE (voor) | Kaart: gemiddelde | Kaart: trend | Kaart: laatste / SE |
| --------------------- | ---------------------------- | --------- | ----------------- | ------------ | ------------------- |
| D'Angelo O'Neill      | 5,4                          | 3,5       | 5,4               | sterk omhoog | laatste 6,9         |
| Marie-Claire 't Hart  | 4,2                          | 3,0       | 4,2               | sterk omhoog | laatste 8,5         |
| Olivia ter Østergaard | 5,0                          | 4,1       | 5,0               | sterk omhoog | laatste 6,2         |
| Sem van den Dekker    | 8,3                          | 8,9       | 8,3               | sterk omlaag | laatste 5,0         |
| Mila de Meijer        | 5,2                          | 5,4       | 5,2               | gelijk       | laatste 5,4         |
| Gijs Kok              | 3,8                          | 2,7       | 3,8               | sterk omhoog | laatste 7,3         |
| Lars 't Vos           | 4,5                          | 4,4       | 4,5               | sterk omhoog | laatste 6,6         |
| Bram van Willems      | 4,6                          | 4,1       | 4,6               | sterk omhoog | laatste 5,7         |

| Groep         | Kaart                       |
| ------------- | --------------------------- |
| 3 nat cluster | 6,1 ± 1,6 · 67% onvoldoende |
| 3a nat        | 5,1 ± 1,3 · 88% onvoldoende |

The old Groepen line computed these with the same call (`statsOfAverages` of
`Store.studentYearAverage` per student) and the same format (`gradeStatHtml`), so it read
`6,1 ± 1,6 · 67% onvoldoende` and `5,1 ± 1,3 · 88% onvoldoende` as well. Checked by hand: 3 nat
cluster = D'Angelo 5,4, Lars 4,5, Sem 8,3 (mean 6,1; two of three below 5,5).

schk: no grades in the fixture; every card says "Nog geen cijfers" and the group cards show no
numbers (as the old list showed no line).
