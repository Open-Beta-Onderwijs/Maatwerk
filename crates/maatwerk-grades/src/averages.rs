// SPDX-License-Identifier: AGPL-3.0-or-later

//! The weighted year average and the SE average of one student (decisions 9, 10).

use crate::attempts::{HistoryEntry, best_attempt, families, resolve_best_attempts};
use crate::model::{Exam, ScoreRecord};
use crate::round::round1;
use crate::stats::{Stats, mean, stats};

/// `sum(weight x grade) / sum(weight)`; a weight of 0 or less falls out; `None` when nothing counts.
fn weighted(pairs: impl IntoIterator<Item = (f64, f64)>) -> Option<f64> {
    let (mut weights, mut total) = (0.0, 0.0);
    for (weight, grade) in pairs {
        if weight > 0.0 {
            weights += weight;
            total += weight * grade;
        }
    }
    (weights > 0.0).then(|| total / weights)
}

/// The year average: over the tests of one year and vak, best attempt per test, weight of the
/// original. Tests without a grade are skipped, not counted as 0. Not rounded: the caller shows it
/// through `round1`.
pub fn year_average(exams: &[Exam], rec: &ScoreRecord) -> Option<f64> {
    weighted(families(exams).iter().filter_map(|family| {
        let best = best_attempt(rec, &family.attempts)?;
        Some((family.head.weight(), best.grade))
    }))
}

/// The SE average: PTA tests over all years, best attempt per test, weight of the original
/// (`exams`: the student's tests of all years; a resit without its original there uses its own).
pub fn se_average(history: &[HistoryEntry], exams: &[Exam]) -> Option<f64> {
    weighted(resolve_best_attempts(history).into_iter().filter_map(|i| {
        let entry = &history[i];
        // The parent in the same school year: an id can occur in two years.
        let original = entry
            .exam
            .parent_id
            .as_deref()
            .and_then(|parent| {
                let mut parents = exams.iter().filter(|e| e.id == parent);
                let first = parents.next()?;
                let year = &entry.exam.academic_year;
                Some(
                    std::iter::once(first)
                        .chain(parents)
                        .find(|e| &e.academic_year == year)
                        .unwrap_or(first),
                )
            })
            .unwrap_or(&entry.exam);
        original
            .is_pta()
            .then(|| entry.grade().map(|g| (original.weight_se(), g)))
            .flatten()
    }))
}

/// The mean of students' averages as shown, rounded to one decimal (decision 21): the jaarlaag
/// average, and the group overview's footer.
pub fn mean_of_averages(averages: &[f64]) -> Option<f64> {
    let shown: Vec<f64> = averages.iter().map(|a| round1(*a)).collect();
    mean(&shown)
}

/// Mean, SD and % onvoldoende of students' averages as shown (decision 21): the group card.
pub fn stats_of_averages(averages: &[f64]) -> Option<Stats> {
    let shown: Vec<f64> = averages.iter().map(|a| round1(*a)).collect();
    stats(&shown)
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;
    use crate::grade::tests::exam_of;

    fn exam(id: &str, extra: Value) -> Exam {
        let mut v = json!({"id": id, "n_term": 1, "questions": [{"id": "q1", "max_points": 10, "rtti": "R"}]});
        v.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        exam_of(v)
    }

    fn record(grades: &[(&str, f64)]) -> ScoreRecord {
        let overrides: serde_json::Map<String, Value> = grades
            .iter()
            .map(|(id, g)| ((*id).to_owned(), json!({"cijfer": g})))
            .collect();
        serde_json::from_value(json!({"overrides": overrides})).unwrap()
    }

    fn approved_exams() -> Vec<Exam> {
        vec![
            exam("t1", json!({"weging": 1})),
            exam("t2", json!({"weging": 2})),
            exam("t3", json!({"weging": 1})),
            exam("d", json!({"weging": 0, "diagnostic": true})),
        ]
    }

    #[test]
    fn the_approved_year_average() {
        // 6,0 (w1), 8,0 (w2), toets 3 without grade, diagnostic 3,0 (w0): 22/3 = 7,33.
        let rec = record(&[("t1", 6.0), ("t2", 8.0), ("d", 3.0)]);
        assert_eq!(round1(year_average(&approved_exams(), &rec).unwrap()), 7.3);
    }

    #[test]
    fn a_better_resit_replaces_the_grade_with_the_originals_weight() {
        let mut exams = approved_exams();
        exams.push(exam(
            "t1-h",
            json!({"parent_id": "t1", "attempt": 2, "weging": 5}),
        ));
        let rec = record(&[("t1", 6.0), ("t2", 8.0), ("t1-h", 6.8)]);
        // (1 x 6,8 + 2 x 8,0) / 3 = 7,6: weight 1 of the original, not 5 of the resit.
        assert_eq!(round1(year_average(&exams, &rec).unwrap()), 7.6);
    }

    #[test]
    fn nothing_graded_gives_no_average() {
        assert_eq!(year_average(&approved_exams(), &record(&[])), None);
        assert_eq!(
            year_average(&approved_exams(), &record(&[("d", 3.0)])),
            None
        );
    }

    #[test]
    fn a_missing_weging_is_one() {
        let exams = vec![exam("a", json!({})), exam("b", json!({"weging": 3}))];
        let rec = record(&[("a", 4.0), ("b", 8.0)]);
        assert_eq!(year_average(&exams, &rec), Some(7.0));
    }

    #[test]
    fn an_orphan_resit_counts_with_its_own_weging() {
        let exams = vec![
            exam("a", json!({"weging": 1})),
            exam("h", json!({"parent_id": "gone", "weging": 3})),
        ];
        let rec = record(&[("a", 4.0), ("h", 8.0)]);
        assert_eq!(year_average(&exams, &rec), Some(7.0));
    }

    #[test]
    fn a_bad_weging_follows_decision_22() {
        let negative = vec![
            exam("a", json!({"weging": 1})),
            exam("b", json!({"weging": -1})),
        ];
        let rec = record(&[("a", 6.0), ("b", 8.0)]);
        assert_eq!(year_average(&negative, &rec), Some(6.0));
        let text = vec![
            exam("a", json!({"weging": 1})),
            exam("b", json!({"weging": "x"})),
        ];
        assert_eq!(year_average(&text, &rec), Some(7.0));
    }

    #[test]
    fn averages_of_averages_use_the_numbers_shown() {
        // Decision 21: 6,44 6,44 6,54 show as 6,4 6,4 6,5; mean 6,43 shows 6,4 (exact would be 6,5).
        let averages = [6.44, 6.44, 6.54];
        assert_eq!(round1(mean_of_averages(&averages).unwrap()), 6.4);
        assert_eq!(round1(stats_of_averages(&averages).unwrap().mean), 6.4);
        assert_eq!(stats_of_averages(&[5.45, 5.44]).unwrap().fails, 50.0);
        assert_eq!(mean_of_averages(&[]), None);
    }

    fn entry(exam: Exam, grade: f64) -> HistoryEntry {
        HistoryEntry {
            exam,
            question_scores: Default::default(),
            r#override: serde_json::from_value(json!({"cijfer": grade})).unwrap(),
        }
    }

    #[test]
    fn the_approved_se_average() {
        // Year 4 PTA 6,0 (w1), year 5 PTA 7,0 (w3), a toets 9,0 does not count: 6,75 shows 6,8.
        let pta1 = exam(
            "p1",
            json!({"type": "pta", "weging_se": 1, "academic_year": "2024-2025"}),
        );
        let pta2 = exam(
            "p2",
            json!({"type": "pta", "weging_se": 3, "academic_year": "2025-2026"}),
        );
        let toets = exam(
            "t",
            json!({"type": "regular", "academic_year": "2025-2026"}),
        );
        let history = vec![entry(pta1, 6.0), entry(pta2, 7.0), entry(toets, 9.0)];
        let avg = se_average(&history, &[]).unwrap();
        assert_eq!(avg, 6.75);
        assert_eq!(round1(avg), 6.8);
    }

    #[test]
    fn se_weight_comes_from_the_original_and_zero_falls_out() {
        let original = exam("p", json!({"type": "pta", "weging_se": 1}));
        let resit = exam(
            "p-h",
            json!({"type": "pta", "weging_se": 9, "parent_id": "p", "attempt": 2}),
        );
        let other = exam("q", json!({"type": "pta", "weging_se": 1}));
        let none = exam("z", json!({"type": "pta", "weging_se": 0}));
        let exams = vec![original.clone(), resit.clone(), other.clone(), none.clone()];
        let history = vec![
            entry(original, 4.0),
            entry(resit, 8.0),
            entry(other, 6.0),
            entry(none, 1.0),
        ];
        // Resit 8,0 with the original's weight 1, plus 6,0: 7,0; with weight 9 it would be 7,8.
        assert_eq!(se_average(&history, &exams), Some(7.0));
    }
}
