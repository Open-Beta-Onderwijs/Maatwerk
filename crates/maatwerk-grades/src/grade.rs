// SPDX-License-Identifier: AGPL-3.0-or-later

//! The grade and RTTI of one attempt (decisions 1-6, 18).

use serde::{Serialize, Serializer};

use crate::model::{Exam, Override, QuestionKind, QuestionScores, ScoreRecord, ScoreValue};
use crate::round::{clean, round0, round1};

/// The grade from points with the n-term and the CvTE bounds, unrounded (decision 1).
///
/// `S >= L` is 10 by the formula's upper bound. Multiplying before dividing keeps exact halves
/// such as 8,65 as close as a double can, and `round1` absorbs what is left.
pub fn calc_grade(scored: f64, max: f64, n: f64) -> f64 {
    let lost = max - scored;
    let mut grade = 9.0 * scored / max + n;
    if n > 1.0 {
        grade = grade
            .min(1.0 + 2.0 * 9.0 * scored / max)
            .min(10.0 - 0.5 * 9.0 * lost / max);
    } else if n < 1.0 {
        grade = grade
            .max(1.0 + 0.5 * 9.0 * scored / max)
            .max(10.0 - 2.0 * 9.0 * lost / max);
    }
    grade.clamp(1.0, 10.0)
}

/// An RTTI percentage: a whole number, or `NVT` when the category has nothing to measure.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RttiPct {
    Pct(f64),
    Nvt,
}

impl Serialize for RttiPct {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Pct(p) => s.serialize_f64(*p),
            Self::Nvt => s.serialize_str("NVT"),
        }
    }
}

/// Points scored and possible.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize)]
pub struct Points {
    pub scored: f64,
    pub max: f64,
}

impl Points {
    pub(crate) fn add(&mut self, scored: f64, max: f64) {
        self.scored = clean(self.scored + scored);
        self.max = clean(self.max + max);
    }

    pub fn pct(self) -> RttiPct {
        if self.max > 0.0 {
            RttiPct::Pct(round0(100.0 * self.scored / self.max))
        } else {
            RttiPct::Nvt
        }
    }
}

/// Points per RTTI category.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize)]
#[serde(rename_all = "UPPERCASE")]
pub struct RttiPoints {
    pub r: Points,
    pub t1: Points,
    pub t2: Points,
    pub i: Points,
}

impl RttiPoints {
    /// The category of a tag; `None` for an unknown tag, which counts in no category (decision 18).
    pub(crate) fn category(&mut self, tag: &str) -> Option<&mut Points> {
        match tag {
            "R" => Some(&mut self.r),
            "T1" => Some(&mut self.t1),
            "T2" => Some(&mut self.t2),
            "I" => Some(&mut self.i),
            _ => None,
        }
    }

    pub(crate) fn merge(&mut self, other: &Self) {
        self.r.add(other.r.scored, other.r.max);
        self.t1.add(other.t1.scored, other.t1.max);
        self.t2.add(other.t2.scored, other.t2.max);
        self.i.add(other.i.scored, other.i.max);
    }
}

/// What one attempt comes to. `grade` is rounded to one decimal (decision 2).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Results {
    pub scored: f64,
    pub normal_max: f64,
    pub bonus_max: f64,
    pub exam_max_total: f64,
    pub has_bonus: bool,
    /// The grade that counts: the override if there is one. `None`: nothing gradeable entered.
    pub grade: Option<f64>,
    pub calculated_grade: Option<f64>,
    pub overridden: bool,
    /// The calculated grade moved since the override was set.
    pub override_stale: bool,
    #[serde(rename = "R")]
    pub r: RttiPct,
    #[serde(rename = "T1")]
    pub t1: RttiPct,
    #[serde(rename = "T2")]
    pub t2: RttiPct,
    #[serde(rename = "I")]
    pub i: RttiPct,
    pub rtti_points: RttiPoints,
}

/// Grade, points and RTTI of one attempt.
///
/// - Empty question: 0 points for the grade (it stays in the maximum), left out of RTTI.
/// - `N`: 0 of the maximum, also in RTTI; it makes the row gradeable, so all `N` is a 1,0.
/// - Invalid (over the maximum, negative, text): 0 of the maximum, also in RTTI; it does not make
///   the row gradeable, so only invalid values give no grade.
/// - Bonus: in the points, not in the maximum; on its own it gives a grade. Not in RTTI.
/// - Diag: in nothing.
/// - Override: replaces the grade; points and RTTI stay from the scores.
pub fn calc_results(exam: &Exam, scores: &QuestionScores, over: Option<&Override>) -> Results {
    if exam.is_po() {
        return calc_po_results(exam, scores, over);
    }
    let mut normal_max = 0.0;
    let mut bonus_max = 0.0;
    let mut scored = 0.0;
    let mut gradeable = false;
    let mut cats = RttiPoints::default();

    for q in &exam.questions {
        let kind = q.kind();
        match kind {
            QuestionKind::Normal => normal_max = clean(normal_max + q.max_points),
            QuestionKind::Bonus => bonus_max = clean(bonus_max + q.max_points),
            QuestionKind::Diag => {}
        }
        let Some(raw) = scores.get(&q.id) else {
            continue;
        };
        if kind == QuestionKind::Diag {
            continue;
        }
        let value = ScoreValue::of(raw);
        let points = value.valid_points(q.max_points);
        if points.is_some() || value == ScoreValue::NotMade {
            gradeable = true;
        }
        let earned = points.unwrap_or(0.0);
        scored = clean(scored + earned);
        if kind == QuestionKind::Normal
            && !exam.is_po()
            && let Some(cat) = cats.category(&q.rtti)
        {
            cat.add(earned, q.max_points);
        }
    }

    let calculated = (gradeable && normal_max > 0.0).then(|| {
        if scored >= normal_max {
            10.0
        } else {
            round1(calc_grade(scored, normal_max, exam.n()))
        }
    });
    finish(scored, normal_max, bonus_max, calculated, over, cats)
}

/// The results from the totals; the override replaces the grade.
fn finish(
    scored: f64,
    normal_max: f64,
    bonus_max: f64,
    calculated: Option<f64>,
    over: Option<&Override>,
    cats: RttiPoints,
) -> Results {
    let cijfer = over.and_then(|o| o.cijfer);
    let berekend = over.and_then(|o| o.berekend);

    Results {
        scored,
        normal_max,
        bonus_max,
        exam_max_total: clean(normal_max + bonus_max),
        has_bonus: bonus_max > 0.0,
        grade: cijfer.map(round1).or(calculated),
        calculated_grade: calculated,
        overridden: cijfer.is_some(),
        override_stale: cijfer.is_some() && berekend.map(round1) != calculated,
        r: cats.r.pct(),
        t1: cats.t1.pct(),
        t2: cats.t2.pct(),
        i: cats.i.pct(),
        rtti_points: cats,
    }
}

/// A PO (step 22, decision 16): the rubric's categories are its questions, scored in whole points
/// from 0 to the category max. Normal and bonus scores count in the points, only normal maxima in
/// the max, diagnostic categories in neither. Grade = 10 × points ÷ max between 1,0 and 10,0,
/// rounded to one decimal; no n-term, no RTTI.
///
/// Scores read as for a test: `N` is 0 and gradeable, a value out of range, with a fraction or
/// text is 0 and not gradeable. Without an attached rubric there is no max, so no grade.
/// Bonus/malus lines (decision 17) come with grading (step 23).
fn calc_po_results(exam: &Exam, scores: &QuestionScores, over: Option<&Override>) -> Results {
    use crate::rubric::Soort;

    let mut normal_max = 0.0;
    let mut bonus_max = 0.0;
    let mut scored = 0.0;
    let mut gradeable = false;
    for cat in exam.rubric.iter().flat_map(|r| &r.categories) {
        let max = f64::from(cat.whole_max().unwrap_or(0));
        match cat.soort {
            Soort::Normaal => normal_max += max,
            Soort::Bonus => bonus_max += max,
            Soort::Diagnostisch => continue,
        }
        let Some(raw) = scores.get(&cat.id) else {
            continue;
        };
        let value = ScoreValue::of(raw);
        let points = value.valid_points(max).filter(|p| p.fract() == 0.0);
        if points.is_some() || value == ScoreValue::NotMade {
            gradeable = true;
        }
        scored += points.unwrap_or(0.0);
    }
    let calculated = (gradeable && normal_max > 0.0)
        .then(|| crate::rubric::po_grade(scored, normal_max).map(round1))
        .flatten();
    finish(
        scored,
        normal_max,
        bonus_max,
        calculated,
        over,
        RttiPoints::default(),
    )
}

/// The scores in `rec` for this exam's current questions (a PO: its rubric's categories).
pub fn exam_scores(rec: &ScoreRecord, exam: &Exam) -> QuestionScores {
    let Some(all) = rec.scores.get(&exam.id) else {
        return QuestionScores::new();
    };
    exam.score_ids()
        .into_iter()
        .filter_map(|id| all.get(id).map(|v| (id.to_owned(), v.clone())))
        .collect()
}

/// One student's results for `exam`; `None` with neither scores nor an override for it.
pub fn exam_results(rec: &ScoreRecord, exam: &Exam) -> Option<Results> {
    let scores = exam_scores(rec, exam);
    let over = rec.overrides.get(&exam.id);
    if scores.is_empty() && over.is_none() {
        return None;
    }
    Some(calc_results(exam, &scores, over))
}

#[cfg(test)]
pub(crate) mod tests {
    use serde_json::{Value, json};

    use super::*;

    pub fn exam_of(v: Value) -> Exam {
        serde_json::from_value(v).unwrap()
    }

    pub fn scores_of(v: Value) -> QuestionScores {
        serde_json::from_value(v).unwrap()
    }

    /// 4 questions of 10 points, R T1 T2 I, n = 1.
    fn four() -> Exam {
        exam_of(json!({"id": "e", "n_term": 1, "questions": [
            {"id": "q1", "max_points": 10, "rtti": "R"},
            {"id": "q2", "max_points": 10, "rtti": "T1"},
            {"id": "q3", "max_points": 10, "rtti": "T2"},
            {"id": "q4", "max_points": 10, "rtti": "I"}
        ]}))
    }

    /// Normal 10 + 10, bonus 5, diag 5, n = 1.
    fn mixed() -> Exam {
        exam_of(json!({"id": "e", "n_term": 1, "questions": [
            {"id": "q1", "max_points": 10, "rtti": "R"},
            {"id": "q2", "max_points": 10, "rtti": "T1"},
            {"id": "b", "max_points": 5, "rtti": "T1", "kind": "bonus"},
            {"id": "d", "max_points": 5, "rtti": "I", "kind": "diag"}
        ]}))
    }

    fn pct(p: f64) -> RttiPct {
        RttiPct::Pct(p)
    }

    /// The design's PO (spec 4.13): normal 3 + 8 + 6, bonus 4, diagnostic 5; max 17.
    fn po() -> Exam {
        exam_of(
            json!({"id": "p", "kind": "po", "n_term": 3, "questions": [],
            "rubric": {"categories": [
                {"id": "intro", "max": 3, "soort": "normaal"},
                {"id": "theorie", "max": 8, "soort": "normaal"},
                {"id": "figuren", "max": 6, "soort": "normaal"},
                {"id": "orig", "max": 4, "soort": "bonus"},
                {"id": "diag", "max": 5, "soort": "diagnostisch"}
            ]}}),
        )
    }

    #[test]
    fn a_po_grade_is_ten_times_points_over_max_without_n_term() {
        // 14/17 -> 8,235... -> 8,2; the n-term 3 in the file is ignored (decision 16).
        let r = calc_results(
            &po(),
            &scores_of(json!({"intro": 2, "theorie": 7, "figuren": 5, "diag": 5})),
            None,
        );
        assert_eq!((r.scored, r.normal_max, r.bonus_max), (14.0, 17.0, 4.0));
        assert_eq!(r.grade, Some(8.2));
        assert!(r.has_bonus);
        // No RTTI for a PO.
        assert_eq!([r.r, r.t1, r.t2, r.i], [RttiPct::Nvt; 4]);
    }

    #[test]
    fn a_po_bonus_counts_in_the_points_and_the_grade_stops_at_ten() {
        let r = calc_results(
            &po(),
            &scores_of(json!({"intro": 3, "theorie": 8, "figuren": 4, "orig": 4})),
            None,
        );
        assert_eq!(r.scored, 19.0);
        assert_eq!(r.grade, Some(10.0));
        // Nothing earned is 1,0, not 0.
        let zero = calc_results(&po(), &scores_of(json!({"intro": 0})), None);
        assert_eq!(zero.grade, Some(1.0));
    }

    #[test]
    fn a_po_score_must_be_whole_and_in_range() {
        // Whole points only (decision 16): 2,5 and 9 (over 8) earn 0 and make nothing gradeable.
        let bad = calc_results(&po(), &scores_of(json!({"intro": 2.5, "theorie": 9})), None);
        assert_eq!((bad.scored, bad.grade), (0.0, None));
        let r = calc_results(&po(), &scores_of(json!({"intro": 2.5, "theorie": 8})), None);
        assert_eq!(r.scored, 8.0);
        assert_eq!(r.grade, Some(round1(80.0 / 17.0)));
        // Only a diagnostic category scored: no grade.
        let diag = calc_results(&po(), &scores_of(json!({"diag": 3})), None);
        assert_eq!(diag.grade, None);
    }

    #[test]
    fn a_po_without_its_rubric_has_no_grade_but_keeps_an_override() {
        let mut exam = po();
        exam.rubric = None;
        let r = calc_results(&exam, &scores_of(json!({"intro": 3})), None);
        assert_eq!((r.normal_max, r.grade), (0.0, None));
        let over = Override {
            cijfer: Some(7.0),
            berekend: None,
        };
        assert_eq!(
            calc_results(&exam, &QuestionScores::new(), Some(&over)).grade,
            Some(7.0)
        );
    }

    #[test]
    fn a_pos_scores_are_its_categories_not_questions() {
        let mut exam = po();
        exam.questions =
            vec![serde_json::from_value(json!({"id": "q1", "max_points": 10})).unwrap()];
        let rec: ScoreRecord =
            serde_json::from_value(json!({"scores": {"p": {"intro": 3, "q1": 10, "gone": 1}}}))
                .unwrap();
        let scores = exam_scores(&rec, &exam);
        assert_eq!(scores.len(), 1);
        assert_eq!(exam_results(&rec, &exam).unwrap().scored, 3.0);
    }

    #[test]
    fn the_approved_grade_table() {
        // Decision 1: (S, L, n, exact grade).
        for (s, l, n, want) in [
            (20.0, 40.0, 1.0, 5.5),
            (30.0, 40.0, 1.0, 7.75),
            (20.0, 40.0, 1.5, 6.0),
            (4.0, 40.0, 2.0, 2.8),
            (38.0, 40.0, 3.0, 9.775),
            (4.0, 40.0, 0.5, 1.45),
            (38.0, 40.0, 0.5, 9.1),
            (39.0, 40.0, 0.0, 9.55),
            (0.0, 40.0, 3.0, 1.0),
            (0.0, 40.0, 0.0, 1.0),
            (40.0, 40.0, 1.0, 10.0),
        ] {
            let got = calc_grade(s, l, n);
            assert!(
                (got - want).abs() < 1e-9,
                "{s}/{l} n={n}: {got}, want {want}"
            );
        }
    }

    #[test]
    fn exact_halves_round_up_for_every_score() {
        // Decision 3: every exact x,x5 up to L = 120 with half points and n in tenths.
        let mut checked = 0;
        for n10 in 0..=30_i64 {
            for l in 1..=120_i64 {
                for s2 in 1..(2 * l) {
                    let (tenths, den) = (90 * s2 + 2 * l * n10, 2 * l);
                    let is_half = tenths % den != 0 && (2 * tenths) % den == 0;
                    let (s, l_f, n) = (s2 as f64 / 2.0, l as f64, n10 as f64 / 10.0);
                    let exact = 9.0 * s / l_f + n;
                    if !is_half || (calc_grade(s, l_f, n) - exact).abs() > 1e-9 {
                        continue;
                    }
                    checked += 1;
                    let want = (tenths / den + 1) as f64 / 10.0;
                    assert_eq!(round1(calc_grade(s, l_f, n)), want, "{s}/{l} n={n}");
                }
            }
        }
        assert!(checked > 10_000, "only {checked} cases");
    }

    #[test]
    fn the_approved_rounding_examples() {
        let grade = |s: f64, l: f64, n: f64| round1(calc_grade(s, l, n));
        assert_eq!(grade(8.5, 10.0, 1.0), 8.7);
        assert_eq!(grade(1.5, 10.0, 1.0), 2.4);
        assert_eq!(grade(9.5, 10.0, 1.0), 9.6);
        assert_eq!(grade(54.5, 90.0, 0.0), 5.5);
    }

    #[test]
    fn the_approved_entry_table() {
        // Decision 4 and 5: (scores, points, grade, R, T1, T2, I).
        let n = RttiPct::Nvt;
        let cases = [
            (
                json!({"q1": 8, "q2": 6, "q3": 4, "q4": 2}),
                20.0,
                Some(5.5),
                pct(80.0),
                pct(60.0),
                pct(40.0),
                pct(20.0),
            ),
            (
                json!({"q1": 8, "q2": 6}),
                14.0,
                Some(4.2),
                pct(80.0),
                pct(60.0),
                n,
                n,
            ),
            (
                json!({"q1": 8, "q2": 6, "q3": "N", "q4": null}),
                14.0,
                Some(4.2),
                pct(80.0),
                pct(60.0),
                pct(0.0),
                pct(0.0),
            ),
            (
                json!({"q1": "N", "q2": "N", "q3": "N", "q4": "N"}),
                0.0,
                Some(1.0),
                pct(0.0),
                pct(0.0),
                pct(0.0),
                pct(0.0),
            ),
            (json!({}), 0.0, None, n, n, n, n),
            (
                json!({"q1": 12, "q2": 6, "q3": 4, "q4": 2}),
                12.0,
                Some(3.7),
                pct(0.0),
                pct(60.0),
                pct(40.0),
                pct(20.0),
            ),
            (
                json!({"q1": "abc", "q2": 6, "q3": 4, "q4": 2}),
                12.0,
                Some(3.7),
                pct(0.0),
                pct(60.0),
                pct(40.0),
                pct(20.0),
            ),
            (json!({"q1": 12}), 0.0, None, pct(0.0), n, n, n),
        ];
        for (input, points, grade, r, t1, t2, i) in cases {
            let res = calc_results(&four(), &scores_of(input.clone()), None);
            assert_eq!(res.scored, points, "{input}");
            assert_eq!(res.normal_max, 40.0, "{input}");
            assert_eq!(res.grade, grade, "{input}");
            assert_eq!((res.r, res.t1, res.t2, res.i), (r, t1, t2, i), "{input}");
        }
    }

    #[test]
    fn the_approved_bonus_and_diag_table() {
        for (input, points, grade) in [
            (json!({"q1": 7, "q2": 7}), 14.0, Some(7.3)),
            (json!({"q1": 7, "q2": 7, "b": 3}), 17.0, Some(8.7)),
            (json!({"q1": 10, "q2": 6, "b": 5}), 21.0, Some(10.0)),
            (json!({"b": 3}), 3.0, Some(2.4)),
            (json!({"d": 3}), 0.0, None),
            (json!({"q1": 7, "q2": 7, "d": 5}), 14.0, Some(7.3)),
        ] {
            let res = calc_results(&mixed(), &scores_of(input.clone()), None);
            assert_eq!(res.scored, points, "{input}");
            assert_eq!(res.normal_max, 20.0, "{input}");
            assert_eq!(res.grade, grade, "{input}");
        }
    }

    #[test]
    fn bonus_and_diag_stay_out_of_rtti() {
        let res = calc_results(&mixed(), &scores_of(json!({"q1": 7, "b": 5, "d": 5})), None);
        assert_eq!(res.r, pct(70.0));
        assert_eq!(res.t1, RttiPct::Nvt);
        assert_eq!(res.i, RttiPct::Nvt);
    }

    #[test]
    fn the_approved_override_examples() {
        let exam = four();
        let over = Override {
            cijfer: Some(6.0),
            berekend: Some(4.6),
        };
        let res = calc_results(
            &exam,
            &scores_of(json!({"q1": 8, "q2": 6, "q3": 2, "q4": 0})),
            Some(&over),
        );
        assert_eq!(res.grade, Some(6.0));
        assert_eq!(res.calculated_grade, Some(4.6));
        assert_eq!(res.scored, 16.0);
        assert_eq!(
            (res.r, res.t1, res.t2, res.i),
            (pct(80.0), pct(60.0), pct(20.0), pct(0.0))
        );
        assert!(res.overridden && !res.override_stale);

        let later = calc_results(
            &exam,
            &scores_of(json!({"q1": 9, "q2": 6, "q3": 2, "q4": 0})),
            Some(&over),
        );
        assert_eq!(later.grade, Some(6.0));
        assert_eq!(later.calculated_grade, Some(4.8));
        assert!(later.override_stale);

        let only = Override {
            cijfer: Some(7.5),
            berekend: None,
        };
        let res = calc_results(&exam, &QuestionScores::new(), Some(&only));
        assert_eq!(res.grade, Some(7.5));
        assert_eq!(res.calculated_grade, None);
        assert_eq!(res.r, RttiPct::Nvt);
        assert!(!res.override_stale);
    }

    #[test]
    fn an_override_is_rounded_like_any_grade() {
        let over = Override {
            cijfer: Some(6.25),
            berekend: None,
        };
        assert_eq!(
            calc_results(&four(), &QuestionScores::new(), Some(&over)).grade,
            Some(6.3)
        );
    }

    #[test]
    fn an_unknown_rtti_tag_counts_in_the_grade_only() {
        // Decision 18. The reference crashed on this (B28).
        let exam = exam_of(json!({"id": "e", "n_term": 1, "questions": [
            {"id": "q1", "max_points": 10, "rtti": "R"},
            {"id": "q2", "max_points": 10, "rtti": "X"}
        ]}));
        let res = calc_results(&exam, &scores_of(json!({"q1": 8, "q2": 6})), None);
        assert_eq!(
            (res.scored, res.normal_max, res.grade),
            (14.0, 20.0, Some(7.3))
        );
        assert_eq!(res.r, pct(80.0));
        assert_eq!(
            (res.t1, res.t2, res.i),
            (RttiPct::Nvt, RttiPct::Nvt, RttiPct::Nvt)
        );
    }

    #[test]
    fn an_unknown_question_kind_counts_as_normal() {
        // Decision 23.
        let exam = exam_of(json!({"id": "e", "n_term": 1, "questions": [
            {"id": "q1", "max_points": 10, "rtti": "R"},
            {"id": "q2", "max_points": 10, "rtti": "T1", "kind": "x"}
        ]}));
        let res = calc_results(&exam, &scores_of(json!({"q1": 8, "q2": 6})), None);
        assert_eq!(
            (res.scored, res.normal_max, res.grade),
            (14.0, 20.0, Some(7.3))
        );
        assert_eq!(res.t1, pct(60.0));
    }

    #[test]
    fn a_po_has_no_rtti() {
        // Decision 19.
        let exam = exam_of(json!({"id": "e", "kind": "po", "questions": [
            {"id": "q1", "max_points": 10, "rtti": "R"}
        ]}));
        assert_eq!(
            calc_results(&exam, &scores_of(json!({"q1": 8})), None).r,
            RttiPct::Nvt
        );
    }

    #[test]
    fn point_totals_have_no_floating_point_noise() {
        let exam = exam_of(json!({"id": "e", "questions": [
            {"id": "a", "max_points": 1, "rtti": "R"},
            {"id": "b", "max_points": 1, "rtti": "R"}
        ]}));
        assert_eq!(
            calc_results(&exam, &scores_of(json!({"a": 0.1, "b": 0.2})), None).scored,
            0.3
        );
    }

    #[test]
    fn exam_without_a_maximum_has_no_grade() {
        let exam = exam_of(json!({"id": "e", "questions": [
            {"id": "b", "max_points": 5, "rtti": "R", "kind": "bonus"}
        ]}));
        assert_eq!(
            calc_results(&exam, &scores_of(json!({"b": 3})), None).grade,
            None
        );
    }

    #[test]
    fn exam_results_ignores_scores_of_removed_questions() {
        let rec: ScoreRecord = serde_json::from_value(json!({
            "scores": {"e": {"gone": 5}, "other": {"q1": 5}}
        }))
        .unwrap();
        assert_eq!(exam_results(&rec, &four()), None);
    }

    #[test]
    fn results_serialize_as_the_ui_expects() {
        let res = calc_results(&four(), &scores_of(json!({"q1": 8})), None);
        let v = serde_json::to_value(res).unwrap();
        assert_eq!(v["normalMax"], json!(40.0));
        assert_eq!(v["R"], json!(80.0));
        assert_eq!(v["T1"], json!("NVT"));
        assert_eq!(v["rttiPoints"]["R"]["scored"], json!(8.0));
    }
}
