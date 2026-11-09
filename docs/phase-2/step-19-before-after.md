# Step 19: before and after

The old code (`2542e41`) against the new core on the synthetic `school` fixture (`tools/fixtures`,
fixed seed), both run by a one-off script. Real data can differ: run `maatwerk-cli stats` on a copy.

## Summary

| Number                               | Compared | Shown differently | Pass/fail changed | Why                                                      |
| ------------------------------------ | -------- | ----------------- | ----------------- | -------------------------------------------------------- |
| Grade of one attempt                 | 18339    | 40                | 0                 | Decision 3: exact halves that were computed just too low |
| Exam card: mean                      | 38       | 2                 | not compared      | Decisions 2, 3                                           |
| Exam card: SD                        | 38       | 0                 | not applicable    | Decision 2                                               |
| Exam card: % onvoldoende             | 38       | 0                 | not applicable    | No change here                                           |
| Year average                         | 4800     | 729               | 0                 | Decision 2: mean of rounded grades                       |
| SE average                           | 2396     | 518               | not compared      | Decision 2                                               |
| Group card (mean, SD, % onvoldoende) | 196      | 23                | not compared      | Decisions 2, 21                                          |
| Attempt that counts                  | 1200     | 0                 | not applicable    | Decision 8: no change                                    |

## Examples

Grades on this fixture are low because it is synthetic.

### Grade

| Points   | n   | Before | After |
| -------- | --- | ------ | ----- |
| 1,5 / 10 | 1   | 2,3    | 2,4   |
| 9,5 / 10 | 1   | 9,5    | 9,6   |

### Exam card

| Test                                   | Students | Mean before | Mean after | SD before | SD after | Fail before | Fail after |
| -------------------------------------- | -------- | ----------- | ---------- | --------- | -------- | ----------- | ---------- |
| bio-toets-h1-krachten-nergie-2025-2026 | 569      | 4,7         | 4,8        | 1,7       | 1,7      | 66%         | 66%        |
| wi-toets-h2-2025-2026                  | 576      | 3,0         | 3,1        | 1,5       | 1,5      | 93%         | 93%        |

### Year average

| Year and vak  | Student | Before | After |
| ------------- | ------- | ------ | ----- |
| 2024-2025 bio | 900003  | 3,4    | 3,3   |
| 2024-2025 bio | 900006  | 3,2    | 3,1   |
| 2024-2025 bio | 900007  | 3,0    | 3,1   |
| 2024-2025 bio | 900010  | 3,0    | 3,1   |
| 2024-2025 bio | 900011  | 2,9    | 2,8   |
| 2024-2025 bio | 900027  | 3,0    | 3,1   |

### SE average

| Vak | Student | Before | After |
| --- | ------- | ------ | ----- |
| bio | 900005  | 2,3    | 2,4   |
| bio | 900007  | 3,2    | 3,3   |
| bio | 900008  | 2,4    | 2,5   |
| bio | 900009  | 3,1    | 3,2   |
| bio | 900010  | 2,4    | 2,5   |
| bio | 900033  | 3,7    | 3,8   |

### Group card

| Group             | Before          | After           |
| ----------------- | --------------- | --------------- |
| 2024-2025 3b biol | 4,0 ± 0,9 · 92% | 4,0 ± 1,0 · 92% |
| 2024-2025 4c biol | 4,1 ± 0,9 · 92% | 4,0 ± 0,9 · 92% |
| 2024-2025 1b nat  | 3,5 ± 1,4 · 88% | 3,5 ± 1,5 · 88% |
| 2024-2025 2a nat  | 3,8 ± 1,4 · 88% | 3,8 ± 1,3 · 88% |
| 2024-2025 5b nat  | 3,6 ± 1,3 · 88% | 3,6 ± 1,4 · 88% |
| 2024-2025 2a schk | 4,0 ± 1,5 · 88% | 3,9 ± 1,5 · 88% |

## Changes this fixture does not show

These have their own tests: N counted as 0 in the overview and vraaganalyse (decision 4), RTTI over
normal questions only (decision 5), pooled Gem. in the profile (decision 7), the grid's average
Totaal (decision 12), Excel quartiles and the label `≥8` (decision 14), rapport class percentages,
advice levels and the I row (decision 15).

## Rapport pages

The reference goldens change on two pages only, both the ranking line: `rapport-valid` p12 ("beste
33%" becomes "beste 10%") and p14 ("beste 67%" becomes "beste 20%").

## Also after the review

- **Year average (decision 25):** the group card and group overview now count all of a student's
  tests of the year, as the profile did. This fixture exaggerates it (students have scores on tests
  of other jaarlagen): 500 of 634 students per vak differed between those screens before. In real
  data it needs a grade outside the group's jaarlaag or a test without a volgnummer.
- **Rapport (decision 24):** an empty question is 0 of its max in the advice table and bars again,
  as in the old app; the pie shows the test, not what the student entered.
- **An override set on an exact half:** a saved `berekend` of 8,6 where the calculation now gives 8,7
  shows the "changed since" warning. True, and rare.
