// SPDX-License-Identifier: AGPL-3.0-or-later

//! RTTI and question statistics over several students or tests (decisions 4, 5, 7, 17).
//!
//! Every figure is pooled: sum of points / sum of maxima, so a big test weighs more. Each attempt
//! is read with its own questions (B14).

use serde::Serialize;

use crate::attempts::HistoryEntry;
use crate::grade::{Points, RttiPoints, calc_results};
use crate::model::{Exam, QuestionScores, ScoreValue};
use crate::stats::grade_group;

/// One attempt of one student in a statistic.
#[derive(Debug, Clone, Copy)]
pub struct Attempt<'a> {
    pub exam: &'a Exam,
    pub scores: &'a QuestionScores,
    /// The grade that counts, override included.
    pub grade: Option<f64>,
}

/// Pooled RTTI points over `entries` (best attempts, decision 7).
pub fn pooled_rtti<'a>(entries: impl IntoIterator<Item = &'a HistoryEntry>) -> RttiPoints {
    let mut total = RttiPoints::default();
    for e in entries {
        total.merge(&calc_results(&e.exam, &e.question_scores, e.r#override.as_ref()).rtti_points);
    }
    total
}

/// Pooled RTTI points per grade group (`<4` .. `≥8`); attempts without a grade are left out.
pub fn rtti_by_grade_group(attempts: &[Attempt<'_>]) -> [RttiPoints; 6] {
    let mut groups = [RttiPoints::default(); 6];
    for a in attempts {
        if let Some(grade) = a.grade {
            let points = calc_results(a.exam, a.scores, None).rtti_points;
            groups[grade_group(grade)].merge(&points);
        }
    }
    groups
}

/// The pooled result of one question over the class (vraaganalyse).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct QuestionStat {
    pub question: String,
    pub points: Points,
}

/// Per question, in first-seen order: the sum of points and maxima over everyone with an entry.
/// `N` and invalid values are 0 of the maximum, empty is left out. Bonus and diagnostic questions
/// are shown too; the analysis is about the question, not the grade.
pub fn question_stats(attempts: &[Attempt<'_>]) -> Vec<QuestionStat> {
    let mut out: Vec<QuestionStat> = Vec::new();
    for a in attempts {
        for q in &a.exam.questions {
            let Some(raw) = a.scores.get(&q.id) else {
                continue;
            };
            let earned = ScoreValue::of(raw)
                .valid_points(q.max_points)
                .unwrap_or(0.0);
            match out.iter_mut().find(|s| s.question == q.id) {
                Some(stat) => stat.points.add(earned, q.max_points),
                None => {
                    let mut points = Points::default();
                    points.add(earned, q.max_points);
                    out.push(QuestionStat {
                        question: q.id.clone(),
                        points,
                    });
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::grade::RttiPct;
    use crate::grade::tests::{exam_of, scores_of};

    fn test_a() -> Exam {
        exam_of(json!({"id": "a", "questions": [{"id": "q1", "max_points": 10, "rtti": "R"}]}))
    }

    fn test_b() -> Exam {
        exam_of(json!({"id": "b", "questions": [{"id": "q1", "max_points": 40, "rtti": "R"}]}))
    }

    #[test]
    fn the_approved_pooled_rtti() {
        // Test A 8/10 = 80%, test B 10/40 = 25%: pooled 18/50 = 36%, not the mean 53%.
        let history = [
            HistoryEntry {
                exam: test_a(),
                question_scores: scores_of(json!({"q1": 8})),
                r#override: None,
                po: None,
            },
            HistoryEntry {
                exam: test_b(),
                question_scores: scores_of(json!({"q1": 10})),
                r#override: None,
                po: None,
            },
        ];
        let pooled = pooled_rtti(&history);
        assert_eq!(
            pooled.r,
            Points {
                scored: 18.0,
                max: 50.0
            }
        );
        assert_eq!(pooled.r.pct(), RttiPct::Pct(36.0));
        assert_eq!(pooled.t1.pct(), RttiPct::Nvt);
    }

    #[test]
    fn overview_rtti_counts_normal_questions_and_never_exceeds_100() {
        // B2: a bonus, a diag and an over-max value used to count here.
        let exam = exam_of(json!({"id": "e", "questions": [
            {"id": "q1", "max_points": 10, "rtti": "R"},
            {"id": "q2", "max_points": 10, "rtti": "R"},
            {"id": "b", "max_points": 5, "rtti": "R", "kind": "bonus"},
            {"id": "d", "max_points": 5, "rtti": "R", "kind": "diag"}
        ]}));
        let scores = scores_of(json!({"q1": 12, "q2": 10, "b": 5, "d": 5}));
        let groups = rtti_by_grade_group(&[Attempt {
            exam: &exam,
            scores: &scores,
            grade: Some(9.0),
        }]);
        assert_eq!(
            groups[5].r,
            Points {
                scored: 10.0,
                max: 20.0
            }
        );
    }

    #[test]
    fn overview_rtti_counts_n_as_zero() {
        // Decision 4 (B1: the overview skipped N).
        let exam = exam_of(json!({"id": "e", "questions": [
            {"id": "q1", "max_points": 10, "rtti": "R"},
            {"id": "q2", "max_points": 10, "rtti": "R"},
            {"id": "q3", "max_points": 10, "rtti": "R"}
        ]}));
        let scores = scores_of(json!({"q1": 8, "q2": "N"}));
        let groups = rtti_by_grade_group(&[Attempt {
            exam: &exam,
            scores: &scores,
            grade: Some(3.0),
        }]);
        assert_eq!(
            groups[0].r,
            Points {
                scored: 8.0,
                max: 20.0
            }
        );
    }

    #[test]
    fn a_student_without_a_grade_is_not_in_a_grade_group() {
        let exam = test_a();
        let scores = scores_of(json!({"q1": 8}));
        let groups = rtti_by_grade_group(&[Attempt {
            exam: &exam,
            scores: &scores,
            grade: None,
        }]);
        assert!(groups.iter().all(|g| *g == RttiPoints::default()));
    }

    #[test]
    fn question_analysis_follows_the_rules() {
        let exam = exam_of(json!({"id": "e", "questions": [
            {"id": "q1", "max_points": 10, "rtti": "R"},
            {"id": "b", "max_points": 5, "rtti": "R", "kind": "bonus"}
        ]}));
        let s1 = scores_of(json!({"q1": 8, "b": 2}));
        let s2 = scores_of(json!({"q1": "N"}));
        let s3 = scores_of(json!({"q1": 12}));
        let s4 = scores_of(json!({}));
        let attempts: Vec<Attempt<'_>> = [&s1, &s2, &s3, &s4]
            .into_iter()
            .map(|scores| Attempt {
                exam: &exam,
                scores,
                grade: None,
            })
            .collect();
        let stats = question_stats(&attempts);
        assert_eq!(stats[0].question, "q1");
        assert_eq!(
            stats[0].points,
            Points {
                scored: 8.0,
                max: 30.0
            }
        );
        assert_eq!(
            stats[1].points,
            Points {
                scored: 2.0,
                max: 5.0
            }
        );
    }

    #[test]
    fn a_resit_is_read_with_its_own_questions() {
        // B14: the summary read a resit with the original's maxima.
        let original =
            exam_of(json!({"id": "o", "questions": [{"id": "q1", "max_points": 10, "rtti": "R"}]}));
        let resit = exam_of(
            json!({"id": "h", "questions": [{"id": "q1", "max_points": 20, "rtti": "T1"}]}),
        );
        let (s1, s2) = (scores_of(json!({"q1": 5})), scores_of(json!({"q1": 15})));
        let attempts = [
            Attempt {
                exam: &original,
                scores: &s1,
                grade: Some(5.0),
            },
            Attempt {
                exam: &resit,
                scores: &s2,
                grade: Some(5.0),
            },
        ];
        let group = rtti_by_grade_group(&attempts)[2];
        assert_eq!(
            group.r,
            Points {
                scored: 5.0,
                max: 10.0
            }
        );
        assert_eq!(
            group.t1,
            Points {
                scored: 15.0,
                max: 20.0
            }
        );
        assert_eq!(
            question_stats(&attempts)[0].points,
            Points {
                scored: 20.0,
                max: 30.0
            }
        );
    }
}
