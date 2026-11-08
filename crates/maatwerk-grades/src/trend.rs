// SPDX-License-Identifier: AGPL-3.0-or-later

//! The trend arrow (F-08, decisions 12 of `PLAN-2.md` and 13 here, design spec 2.4).

use std::cmp::Ordering;

use serde::Serialize;

use crate::attempts::{best_attempt, families};
use crate::averages::year_average;
use crate::model::{Exam, ScoreRecord};
use crate::round::round1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TrendLevel {
    StrongUp,
    SlightUp,
    Level,
    SlightDown,
    StrongDown,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Trend {
    /// The rounded grade of the most recent counted test.
    pub last: f64,
    /// The rounded year average.
    pub average: f64,
    /// `last - average`.
    pub d: f64,
    pub level: TrendLevel,
}

/// The level of `d`; `|d| < 0,5` is level, up to and including 1,0 is slight.
fn level_of(d: f64) -> TrendLevel {
    // Whole tenths: `8,0 - 7,5` must be exactly 0,5 here, not 0,4999...
    let tenths = (d * 10.0).round() as i64;
    match tenths {
        t if t > 10 => TrendLevel::StrongUp,
        t if t >= 5 => TrendLevel::SlightUp,
        t if t > -5 => TrendLevel::Level,
        t if t >= -10 => TrendLevel::SlightDown,
        _ => TrendLevel::StrongDown,
    }
}

/// The arrow of one student in one year. Most recent = the highest volgnummer among the tests this
/// student has a grade for, with a weging above 0; `d` uses the two rounded numbers on screen.
/// `None` without such a test.
pub fn trend(exams: &[Exam], rec: &ScoreRecord) -> Option<Trend> {
    let last = families(exams)
        .into_iter()
        .filter(|family| family.head.weight() > 0.0)
        .filter_map(|family| {
            let grade = best_attempt(rec, &family.attempts)?.grade;
            Some((family.head.volgnummer.unwrap_or(0.0), grade))
        })
        .max_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(Ordering::Equal))?
        .1;
    let average = round1(year_average(exams, rec)?);
    let d = round1(last - average);
    Some(Trend {
        last,
        average,
        d,
        level: level_of(d),
    })
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;

    fn exam(id: &str, nr: u32, weging: f64) -> Exam {
        serde_json::from_value(json!({
            "id": id, "volgnummer": nr, "weging": weging, "questions": []
        }))
        .unwrap()
    }

    fn record(grades: &[(&str, f64)]) -> ScoreRecord {
        let overrides: serde_json::Map<String, Value> = grades
            .iter()
            .map(|(id, g)| ((*id).to_owned(), json!({"cijfer": g})))
            .collect();
        serde_json::from_value(json!({"overrides": overrides})).unwrap()
    }

    #[test]
    fn the_approved_example() {
        // 6,0 (w1), 7,0 (w1), 8,0 (w2): average 7,25 shows 7,3; d = 8,0 - 7,3 = +0,7.
        let exams = [
            exam("a", 101, 1.0),
            exam("b", 102, 1.0),
            exam("c", 103, 2.0),
        ];
        let t = trend(&exams, &record(&[("a", 6.0), ("b", 7.0), ("c", 8.0)])).unwrap();
        assert_eq!((t.last, t.average, t.d), (8.0, 7.3, 0.7));
        assert_eq!(t.level, TrendLevel::SlightUp);
    }

    #[test]
    fn the_approved_boundaries() {
        for (d, level) in [
            (0.0, TrendLevel::Level),
            (0.4, TrendLevel::Level),
            (-0.4, TrendLevel::Level),
            (0.5, TrendLevel::SlightUp),
            (1.0, TrendLevel::SlightUp),
            (1.1, TrendLevel::StrongUp),
            (-0.5, TrendLevel::SlightDown),
            (-1.0, TrendLevel::SlightDown),
            (-1.1, TrendLevel::StrongDown),
            (8.0 - 7.5, TrendLevel::SlightUp),
        ] {
            assert_eq!(level_of(d), level, "d = {d}");
        }
    }

    #[test]
    fn a_diagnostic_last_test_is_ignored() {
        let exams = [
            exam("a", 101, 1.0),
            exam("b", 102, 1.0),
            exam("d", 103, 0.0),
        ];
        let t = trend(&exams, &record(&[("a", 6.0), ("b", 8.0), ("d", 2.0)])).unwrap();
        assert_eq!((t.last, t.average), (8.0, 7.0));
    }

    #[test]
    fn the_last_test_is_the_last_the_student_has_a_grade_for() {
        let exams = [
            exam("a", 101, 1.0),
            exam("b", 102, 1.0),
            exam("c", 103, 1.0),
        ];
        let t = trend(&exams, &record(&[("a", 6.0), ("b", 8.0)])).unwrap();
        assert_eq!(t.last, 8.0);
    }

    #[test]
    fn one_test_is_level_and_no_grade_is_no_arrow() {
        let exams = [exam("a", 101, 1.0)];
        assert_eq!(
            trend(&exams, &record(&[("a", 6.0)])).unwrap().level,
            TrendLevel::Level
        );
        assert_eq!(trend(&exams, &record(&[])), None);
    }

    #[test]
    fn a_resit_counts_as_the_test_it_belongs_to() {
        let mut resit = exam("a-h", 101, 1.0);
        resit.parent_id = Some("a".to_owned());
        let exams = [exam("a", 101, 1.0), resit, exam("b", 102, 1.0)];
        let t = trend(&exams, &record(&[("a", 4.0), ("a-h", 6.0), ("b", 8.0)])).unwrap();
        assert_eq!((t.last, t.average), (8.0, 7.0));
    }
}
