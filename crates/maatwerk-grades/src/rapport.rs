// SPDX-License-Identifier: AGPL-3.0-or-later

//! The rapport's numbers (decisions 4, 5, 15, 16).

use serde::{Deserialize, Serialize};

use crate::model::{Question, QuestionScores, ScoreValue};
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

/// The limits of an advice file, in percent.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct Grenzen {
    pub laag_midden: f64,
    pub midden_hoog: f64,
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
