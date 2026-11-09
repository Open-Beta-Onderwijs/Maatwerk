// SPDX-License-Identifier: AGPL-3.0-or-later

//! Attempts: an original test with its inhaal and herkansing (decision 8).

use std::cmp::Ordering;
use std::collections::HashSet;

use serde::Deserialize;

use crate::grade::{calc_results, exam_results};
use crate::model::{Exam, Override, QuestionScores, ScoreRecord};

/// A test with its resits, in attempt order. An orphan resit (its original is gone) is a family
/// of its own, without an original.
#[derive(Debug)]
pub struct Family<'a> {
    /// The original, or the first orphan resit: the source of weight and type (decisions 9, 10).
    pub head: &'a Exam,
    /// Every attempt, the head first.
    pub attempts: Vec<&'a Exam>,
}

fn by_attempt(a: &&Exam, b: &&Exam) -> Ordering {
    let number = |e: &Exam| e.attempt.unwrap_or(1.0);
    number(a).partial_cmp(&number(b)).unwrap_or(Ordering::Equal)
}

/// The families of one year's exams; order follows the originals in `exams`, orphans last.
pub fn families(exams: &[Exam]) -> Vec<Family<'_>> {
    let ids: HashSet<&str> = exams.iter().map(|e| e.id.as_str()).collect();
    let resits_of = |parent: &str| {
        let mut resits: Vec<&Exam> = exams
            .iter()
            .filter(|e| e.parent_id.as_deref() == Some(parent))
            .collect();
        resits.sort_by(by_attempt);
        resits
    };
    let mut out: Vec<Family<'_>> = exams
        .iter()
        .filter(|e| e.parent_id.is_none())
        .map(|head| {
            let mut attempts = vec![head];
            attempts.extend(resits_of(&head.id));
            Family { head, attempts }
        })
        .collect();

    let mut seen = HashSet::new();
    for exam in exams {
        let Some(parent) = exam.parent_id.as_deref() else {
            continue;
        };
        if !ids.contains(parent) && seen.insert(parent) {
            let attempts = resits_of(parent);
            out.push(Family {
                head: attempts[0],
                attempts,
            });
        }
    }
    out
}

/// The attempt that counts for one student.
#[derive(Debug, Clone)]
pub struct BestEntry<'a> {
    pub exam: &'a Exam,
    pub grade: f64,
}

/// The highest grade among `attempts` (override included), the earliest on a tie; attempts without
/// a grade are skipped.
pub fn best_attempt<'a>(rec: &ScoreRecord, attempts: &[&'a Exam]) -> Option<BestEntry<'a>> {
    let mut best: Option<BestEntry<'a>> = None;
    for &exam in attempts {
        let Some(grade) = exam_results(rec, exam).and_then(|r| r.grade) else {
            continue;
        };
        if best.as_ref().is_none_or(|b| grade > b.grade) {
            best = Some(BestEntry { exam, grade });
        }
    }
    best
}

/// One attempt in a student's history, over all years.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub exam: Exam,
    #[serde(default)]
    pub question_scores: QuestionScores,
    #[serde(default)]
    pub r#override: Option<Override>,
}

impl HistoryEntry {
    pub fn grade(&self) -> Option<f64> {
        calc_results(&self.exam, &self.question_scores, self.r#override.as_ref()).grade
    }
}

fn compare_history(a: &HistoryEntry, b: &HistoryEntry) -> Ordering {
    let year = |e: &HistoryEntry| e.exam.academic_year.clone().unwrap_or_default();
    let number = |e: &HistoryEntry| e.exam.volgnummer.unwrap_or(0.0);
    year(a)
        .cmp(&year(b))
        .then(number(a).partial_cmp(&number(b)).unwrap_or(Ordering::Equal))
}

/// Indexes into `history` of the attempt that counts per family, in history order (school year,
/// then volgnummer). A family in which nothing has a grade keeps its earliest attempt, so the
/// test stays visible in the student's list.
pub fn resolve_best_attempts(history: &[HistoryEntry]) -> Vec<usize> {
    // The school year too: an id can occur in two years, and those are different tests.
    let family_key = |e: &HistoryEntry| {
        let id = e.exam.parent_id.as_deref().unwrap_or(&e.exam.id);
        format!("{}/{id}", e.exam.academic_year.as_deref().unwrap_or(""))
    };
    let mut keys: Vec<String> = Vec::new();
    for entry in history {
        let key = family_key(entry);
        if !keys.contains(&key) {
            keys.push(key);
        }
    }
    let mut chosen: Vec<usize> = keys
        .iter()
        .map(|key| {
            let mut members: Vec<usize> = (0..history.len())
                .filter(|&i| family_key(&history[i]) == *key)
                .collect();
            members.sort_by(|&a, &b| by_attempt(&&history[a].exam, &&history[b].exam));
            let mut best = members[0];
            for &i in &members {
                if history[i].grade().unwrap_or(-1.0) > history[best].grade().unwrap_or(-1.0) {
                    best = i;
                }
            }
            best
        })
        .collect();
    chosen.sort_by(|&a, &b| compare_history(&history[a], &history[b]));
    chosen
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;
    use crate::grade::tests::{exam_of, scores_of};

    fn test_exam(id: &str, parent: Option<&str>, attempt: u32) -> Exam {
        exam_of(
            json!({"id": id, "parent_id": parent, "attempt": attempt, "n_term": 1, "questions": [
                {"id": "q1", "max_points": 10, "rtti": "R"}
            ]}),
        )
    }

    /// A record giving each exam the grade `g` by override.
    fn record(grades: &[(&str, f64)]) -> ScoreRecord {
        let overrides: serde_json::Map<String, Value> = grades
            .iter()
            .map(|(id, g)| ((*id).to_owned(), json!({"cijfer": g})))
            .collect();
        serde_json::from_value(json!({"overrides": overrides})).unwrap()
    }

    #[test]
    fn the_approved_best_attempt_table() {
        let original = test_exam("o", None, 1);
        let resit = test_exam("h", Some("o"), 2);
        let attempts = [&original, &resit];
        type Case<'a> = (&'a [(&'a str, f64)], Option<(&'a str, f64)>);
        let cases: [Case; 6] = [
            (&[("o", 4.8), ("h", 6.2)], Some(("h", 6.2))),
            (&[("o", 4.8), ("h", 3.5)], Some(("o", 4.8))),
            (&[("o", 6.2), ("h", 6.2)], Some(("o", 6.2))),
            (&[("h", 6.2)], Some(("h", 6.2))),
            (&[("o", 4.8)], Some(("o", 4.8))),
            (&[], None),
        ];
        for (grades, want) in cases {
            let got = best_attempt(&record(grades), &attempts);
            assert_eq!(
                got.map(|b| (b.exam.id.as_str(), b.grade)),
                want,
                "{grades:?}"
            );
        }
    }

    #[test]
    fn an_override_counts_in_the_comparison() {
        let original = test_exam("o", None, 1);
        let resit = test_exam("h", Some("o"), 2);
        let rec: ScoreRecord = serde_json::from_value(json!({
            "scores": {"o": {"q1": 4}, "h": {"q1": 5}},
            "overrides": {"o": {"cijfer": 9.0}}
        }))
        .unwrap();
        let best = best_attempt(&rec, &[&original, &resit]).unwrap();
        assert_eq!((best.exam.id.as_str(), best.grade), ("o", 9.0));
    }

    #[test]
    fn families_order_attempts_and_keep_orphans() {
        let exams = vec![
            test_exam("h2", Some("o"), 3),
            test_exam("o", None, 1),
            test_exam("h1", Some("o"), 2),
            test_exam("orphan", Some("gone"), 2),
        ];
        let fams = families(&exams);
        assert_eq!(fams.len(), 2);
        let ids: Vec<&str> = fams[0].attempts.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, ["o", "h1", "h2"]);
        assert_eq!(fams[1].head.id, "orphan");
    }

    fn entry(
        id: &str,
        parent: Option<&str>,
        attempt: u32,
        year: &str,
        nr: u32,
        score: Option<f64>,
    ) -> HistoryEntry {
        let mut exam = test_exam(id, parent, attempt);
        exam.academic_year = Some(year.to_owned());
        exam.volgnummer = Some(f64::from(nr));
        let question_scores = match score {
            Some(s) => scores_of(json!({"q1": s})),
            None => QuestionScores::new(),
        };
        HistoryEntry {
            exam,
            question_scores,
            r#override: None,
        }
    }

    #[test]
    fn history_keeps_one_attempt_per_family_in_order() {
        let history = vec![
            entry("b", None, 1, "2025-2026", 2, Some(7.0)),
            entry("a", None, 1, "2024-2025", 5, Some(4.0)),
            entry("a-h", Some("a"), 2, "2024-2025", 5, Some(6.0)),
            entry("c-h", Some("gone"), 2, "2025-2026", 1, Some(5.0)),
        ];
        let ids: Vec<&str> = resolve_best_attempts(&history)
            .into_iter()
            .map(|i| history[i].exam.id.as_str())
            .collect();
        assert_eq!(ids, ["a-h", "c-h", "b"]);
    }

    #[test]
    fn the_same_id_in_two_years_is_two_tests() {
        let history = vec![
            entry("x", None, 1, "2024-2025", 1, Some(4.0)),
            entry("x", None, 1, "2025-2026", 1, Some(8.0)),
        ];
        assert_eq!(resolve_best_attempts(&history), vec![0, 1]);
    }

    #[test]
    fn a_family_without_a_grade_stays_visible() {
        let history = vec![
            entry("a", None, 1, "2025-2026", 1, None),
            entry("a-h", Some("a"), 2, "2025-2026", 1, None),
        ];
        assert_eq!(resolve_best_attempts(&history), vec![0]);
    }

    #[test]
    fn a_tie_in_history_keeps_the_earliest_attempt() {
        let history = vec![
            entry("a-h", Some("a"), 2, "2025-2026", 1, Some(6.0)),
            entry("a", None, 1, "2025-2026", 1, Some(6.0)),
        ];
        assert_eq!(resolve_best_attempts(&history), vec![1]);
    }
}
