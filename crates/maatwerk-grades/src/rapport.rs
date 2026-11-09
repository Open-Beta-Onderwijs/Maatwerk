// SPDX-License-Identifier: AGPL-3.0-or-later

//! The rapport's numbers (decisions 4, 5, 15, 16).

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

use crate::grade::{Points, RttiPoints};
use crate::model::{Exam, Question, QuestionKind, QuestionScores, ScoreValue};
use crate::round::{round0, round1};

/// The class's result on one question.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassQuestion {
    /// The average points, rounded to one decimal for the rapport.
    pub class_avg: f64,
    /// Whole percent, from the unrounded average (B12).
    pub class_pct: f64,
}

/// The class average on `q` over everyone with an entry: `N` and invalid are 0, empty is left out.
pub fn class_question(q: &Question, all: &[&QuestionScores]) -> ClassQuestion {
    let earned: Vec<f64> = all
        .iter()
        .filter_map(|scores| scores.get(&q.id))
        .map(|raw| {
            ScoreValue::of(raw)
                .valid_points(q.max_points)
                .unwrap_or(0.0)
        })
        .collect();
    let avg = crate::stats::mean(&earned).unwrap_or(0.0);
    ClassQuestion {
        class_avg: round1(avg),
        class_pct: if q.max_points > 0.0 {
            round0(100.0 * avg / q.max_points)
        } else {
            0.0
        },
    }
}

/// The class's result per question, in the exam's order: one call for the whole rapport.
pub fn class_questions(questions: &[Question], all: &[&QuestionScores]) -> Vec<ClassQuestion> {
    questions.iter().map(|q| class_question(q, all)).collect()
}

/// One RTTI category on the rapport.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize)]
pub struct RapportCategory {
    pub scored: f64,
    pub max: f64,
    /// Whole percent of the category's maximum; `None` when the test has none of it.
    pub pct: Option<f64>,
    /// Whole percent of the test that is this category, for the pie.
    pub share: Option<f64>,
}

/// The rapport's RTTI numbers of one student.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "UPPERCASE")]
pub struct RapportTotals {
    pub r: RapportCategory,
    pub t1: RapportCategory,
    pub t2: RapportCategory,
    pub i: RapportCategory,
}

/// The advice table, bars and pie of one student. Unlike the grid, an empty question counts as 0
/// of its maximum here, as it does for the grade on the same page (decision 24).
pub fn rapport_totals(exam: &Exam, scores: &QuestionScores) -> RapportTotals {
    let mut points = RttiPoints::default();
    if !exam.is_po() {
        for q in &exam.questions {
            if q.kind() != QuestionKind::Normal {
                continue;
            }
            let earned = scores
                .get(&q.id)
                .and_then(|raw| ScoreValue::of(raw).valid_points(q.max_points))
                .unwrap_or(0.0);
            if let Some(cat) = points.category(&q.rtti) {
                cat.add(earned, q.max_points);
            }
        }
    }
    let total = points.r.max + points.t1.max + points.t2.max + points.i.max;
    let category = |p: Points| RapportCategory {
        scored: p.scored,
        max: p.max,
        pct: (p.max > 0.0).then(|| round0(100.0 * p.scored / p.max)),
        share: (total > 0.0 && p.max > 0.0).then(|| round0(100.0 * p.max / total)),
    };
    RapportTotals {
        r: category(points.r),
        t1: category(points.t1),
        t2: category(points.t2),
        i: category(points.i),
    }
}

fn limit<'de, D: Deserializer<'de>>(d: D) -> Result<Option<f64>, D::Error> {
    Ok(Value::deserialize(d)?.as_f64())
}

/// The limits of an advice file, in percent. A missing or bad limit uses the default (T10).
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(from = "RawGrenzen")]
pub struct Grenzen {
    pub laag_midden: f64,
    pub midden_hoog: f64,
}

#[derive(Deserialize)]
struct RawGrenzen {
    #[serde(default, deserialize_with = "limit")]
    laag_midden: Option<f64>,
    #[serde(default, deserialize_with = "limit")]
    midden_hoog: Option<f64>,
}

impl From<RawGrenzen> for Grenzen {
    fn from(raw: RawGrenzen) -> Self {
        let d = Self::default();
        Self {
            laag_midden: raw.laag_midden.unwrap_or(d.laag_midden),
            midden_hoog: raw.midden_hoog.unwrap_or(d.midden_hoog),
        }
    }
}

impl Default for Grenzen {
    fn default() -> Self {
        Self {
            laag_midden: 40.0,
            midden_hoog: 70.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Bracket {
    Laag,
    Midden,
    Hoog,
}

/// The advice level from the whole percentage the student reads, so 39,6% shown as 40% is `midden`.
pub fn advice_bracket(scored: f64, max: f64, grenzen: Grenzen) -> Bracket {
    let pct = round0(100.0 * scored / max);
    if pct < grenzen.laag_midden {
        Bracket::Laag
    } else if pct < grenzen.midden_hoog {
        Bracket::Midden
    } else {
        Bracket::Hoog
    }
}

/// The rapport shows the histogram and the ranking line from this many grades on.
pub const MIN_GRADES_FOR_HISTOGRAM: usize = 10;

/// The rapport histogram's bin of a rounded grade: below 4,5, then half-open steps of 0,5, and
/// 9,5 and up in the last.
pub fn rapport_bin(grade: f64) -> usize {
    let tenths = (grade * 10.0).round() as i64;
    ((tenths - 40).div_euclid(5)).clamp(0, 11) as usize
}

/// The rapport histogram's 12 counts; `None` below `MIN_GRADES_FOR_HISTOGRAM`.
pub fn rapport_bins(grades: &[f64]) -> Option<[usize; 12]> {
    if grades.len() < MIN_GRADES_FOR_HISTOGRAM {
        return None;
    }
    let mut bins = [0; 12];
    for g in grades {
        bins[rapport_bin(*g)] += 1;
    }
    Some(bins)
}

/// The ranking line of one student.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Ranking {
    /// "beste 10%".
    Top10,
    /// "beste 20%".
    Top20,
}

/// The line for `grade` among all `grades`. Students who tie share the rank of the first of them.
pub fn ranking(grade: f64, grades: &[f64]) -> Option<Ranking> {
    let n = grades.len();
    if n < MIN_GRADES_FOR_HISTOGRAM {
        return None;
    }
    let mut sorted = grades.to_vec();
    sorted.sort_by(|a, b| b.total_cmp(a));
    let index = sorted.iter().position(|g| *g == grade)? as f64;
    let n = n as f64;
    if index < n / 10.0 - 0.99 {
        Some(Ranking::Top10)
    } else if index < n * 2.0 / 10.0 - 0.99 {
        Some(Ranking::Top20)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::grade::tests::scores_of;

    fn question(max: f64) -> Question {
        serde_json::from_value(json!({"id": "q1", "max_points": max, "rtti": "R"})).unwrap()
    }

    #[test]
    fn the_approved_class_average() {
        // Decision 15: max 8, average 6,25 shows 6,3; 78,1% gives 78, not 79 from 6,3.
        let scores: Vec<QuestionScores> = [7, 6, 6, 6]
            .iter()
            .map(|s| scores_of(json!({"q1": s})))
            .collect();
        let refs: Vec<&QuestionScores> = scores.iter().collect();
        let c = class_question(&question(8.0), &refs);
        assert_eq!(c.class_avg, 6.3);
        assert_eq!(c.class_pct, 78.0);
    }

    #[test]
    fn class_average_counts_n_and_invalid_as_zero_and_skips_empty() {
        let (a, b, c, d) = (
            scores_of(json!({"q1": 8})),
            scores_of(json!({"q1": "N"})),
            scores_of(json!({"q1": 12})),
            scores_of(json!({})),
        );
        let got = class_question(&question(10.0), &[&a, &b, &c, &d]);
        assert_eq!(got.class_avg, 2.7); // 8 / 3
        assert_eq!(got.class_pct, 27.0);
    }

    fn exam_of(v: Value) -> Exam {
        serde_json::from_value(v).unwrap()
    }

    #[test]
    fn the_approved_empty_on_the_rapport() {
        // Decision 24: 8, empty, empty of 10 each is 8 / 30 (27%).
        let exam = exam_of(json!({"id": "e", "questions": [
            {"id": "a", "max_points": 10, "rtti": "T1"},
            {"id": "b", "max_points": 10, "rtti": "T1"},
            {"id": "c", "max_points": 10, "rtti": "T1"},
            {"id": "d", "max_points": 30, "rtti": "I"},
            {"id": "x", "max_points": 5, "rtti": "R", "kind": "bonus"},
            {"id": "y", "max_points": 5, "rtti": "R", "kind": "diag"}
        ]}));
        let t = rapport_totals(&exam, &scores_of(json!({"a": 8, "x": 5, "y": 5})));
        assert_eq!((t.t1.scored, t.t1.max, t.t1.pct), (8.0, 30.0, Some(27.0)));
        assert_eq!((t.i.scored, t.i.max, t.i.pct), (0.0, 30.0, Some(0.0)));
        assert_eq!(
            advice_bracket(t.t1.scored, t.t1.max, Grenzen::default()),
            Bracket::Laag
        );
        // Not in this test: no percentage, no slice.
        assert_eq!((t.r.pct, t.r.share), (None, None));
    }

    #[test]
    fn the_pie_is_about_the_test_not_about_what_the_student_entered() {
        // Review M1: a test that is 25% each stays 25% each.
        let exam = exam_of(json!({"id": "e", "questions": [
            {"id": "a", "max_points": 10, "rtti": "R"},
            {"id": "b", "max_points": 10, "rtti": "T1"},
            {"id": "c", "max_points": 10, "rtti": "T2"},
            {"id": "d", "max_points": 10, "rtti": "I"}
        ]}));
        let t = rapport_totals(&exam, &scores_of(json!({"a": 8, "b": 6})));
        for cat in [t.r, t.t1, t.t2, t.i] {
            assert_eq!(cat.share, Some(25.0));
        }
    }

    #[test]
    fn percentages_are_exact_half_up() {
        // Review M2: 23 / 40 is 57,5, which Typst showed as 57.
        let exam =
            exam_of(json!({"id": "e", "questions": [{"id": "a", "max_points": 40, "rtti": "R"}]}));
        assert_eq!(
            rapport_totals(&exam, &scores_of(json!({"a": 23}))).r.pct,
            Some(58.0)
        );
    }

    #[test]
    fn bad_limits_use_the_defaults() {
        // Review M8.
        let g: Grenzen = serde_json::from_value(json!({"laag_midden": 30})).unwrap();
        assert_eq!((g.laag_midden, g.midden_hoog), (30.0, 70.0));
        let g: Grenzen = serde_json::from_value(json!({"laag_midden": "x"})).unwrap();
        assert_eq!((g.laag_midden, g.midden_hoog), (40.0, 70.0));
    }

    #[test]
    fn the_rapport_histogram_bins_are_half_open() {
        for (grade, bin) in [
            (1.0, 0),
            (4.4, 0),
            (4.5, 1),
            (5.4, 2),
            (5.5, 3),
            (9.4, 10),
            (9.5, 11),
            (10.0, 11),
        ] {
            assert_eq!(rapport_bin(grade), bin, "{grade}");
        }
        assert_eq!(rapport_bins(&[5.0; 9]), None);
        let bins = rapport_bins(&[5.5; 10]).unwrap();
        assert_eq!(bins[3], 10);
    }

    #[test]
    fn class_questions_answer_per_question() {
        let (a, b) = (question(8.0), question(10.0));
        let s = scores_of(json!({"q1": 4}));
        let got = class_questions(&[a, b], &[&s]);
        assert_eq!((got[0].class_pct, got[1].class_pct), (50.0, 40.0));
    }

    #[test]
    fn nobody_entered_gives_zero() {
        let got = class_question(&question(10.0), &[]);
        assert_eq!((got.class_avg, got.class_pct), (0.0, 0.0));
    }

    #[test]
    fn the_approved_advice_levels() {
        let g = Grenzen::default();
        assert_eq!(advice_bracket(39.0, 100.0, g), Bracket::Laag);
        assert_eq!(advice_bracket(39.6, 100.0, g), Bracket::Midden); // shown as 40%
        assert_eq!(advice_bracket(69.0, 100.0, g), Bracket::Midden);
        assert_eq!(advice_bracket(70.0, 100.0, g), Bracket::Hoog);
        assert_eq!(advice_bracket(12.0, 20.0, g), Bracket::Midden); // I: 12/20
    }

    /// The ranking of ranks 1..=n in a class of n different grades.
    fn lines(n: usize) -> Vec<Option<Ranking>> {
        let grades: Vec<f64> = (0..n).map(|i| 10.0 - i as f64 / 10.0).collect();
        grades.iter().map(|g| ranking(*g, &grades)).collect()
    }

    fn count(lines: &[Option<Ranking>], want: Ranking) -> usize {
        lines.iter().filter(|l| **l == Some(want)).count()
    }

    #[test]
    fn the_approved_ranking_table() {
        for (n, top10, top20) in [(10, 1, 1), (19, 1, 2), (25, 2, 3), (30, 3, 3)] {
            let l = lines(n);
            assert_eq!(count(&l, Ranking::Top10), top10, "class of {n}");
            assert_eq!(count(&l, Ranking::Top20), top20, "class of {n}");
            assert_eq!(l[0], Some(Ranking::Top10));
        }
    }

    #[test]
    fn fewer_than_ten_grades_have_no_ranking() {
        assert!(lines(9).iter().all(Option::is_none));
    }

    #[test]
    fn ties_share_the_first_rank() {
        let grades = [9.0, 9.0, 9.0, 8.0, 8.0, 7.0, 7.0, 7.0, 7.0, 7.0];
        assert_eq!(ranking(9.0, &grades), Some(Ranking::Top10));
        assert_eq!(ranking(8.0, &grades), None);
    }
}
