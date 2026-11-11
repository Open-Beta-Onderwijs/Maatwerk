// SPDX-License-Identifier: AGPL-3.0-or-later

//! The data the rules read: exam, score record and group files (`docs/reference/data-files-v3.md`).
//!
//! Reading is tolerant, because the files can be old or edited by hand: a number may be a numeric
//! string, a bad value falls back to the default, and unknown fields are ignored. Nothing here
//! writes data.

use std::collections::HashMap;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Deserializer};
use serde_json::Value;

use crate::rubric::Rubric;

/// A number, a numeric string, or `None` for anything else.
fn number_of(value: &Value) -> Option<f64> {
    match value {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => parse_number(s),
        _ => None,
    }
}

/// A plain decimal number. Rejects the empty string and `inf`/`NaN`, which Rust would parse.
fn parse_number(s: &str) -> Option<f64> {
    s.trim().parse::<f64>().ok().filter(|n| n.is_finite())
}

pub(crate) fn opt_number<'de, D: Deserializer<'de>>(d: D) -> Result<Option<f64>, D::Error> {
    Ok(number_of(&Value::deserialize(d)?))
}

/// A weging: absent or `null` is `None`; present but not a number counts as 1 (decision 22).
fn opt_weight<'de, D: Deserializer<'de>>(d: D) -> Result<Option<f64>, D::Error> {
    let value = Value::deserialize(d)?;
    Ok((!value.is_null()).then(|| number_of(&value).unwrap_or(1.0)))
}

/// A parent id; an empty one is no parent, as in the UI's `!e.parent_id`.
fn opt_id<'de, D: Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    Ok(opt_text(d)?.filter(|id| !id.is_empty()))
}

/// A map whose values may be damaged: those entries are skipped, the rest still counts.
fn tolerant_map<'de, D: Deserializer<'de>, T: DeserializeOwned>(
    d: D,
) -> Result<HashMap<String, T>, D::Error> {
    let Value::Object(map) = Value::deserialize(d)? else {
        return Ok(HashMap::new());
    };
    Ok(map
        .into_iter()
        .filter_map(|(k, v)| Some((k, serde_json::from_value(v).ok()?)))
        .collect())
}

fn number<'de, D: Deserializer<'de>>(d: D) -> Result<f64, D::Error> {
    Ok(number_of(&Value::deserialize(d)?).unwrap_or(0.0))
}

fn opt_text<'de, D: Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    Ok(match Value::deserialize(d)? {
        Value::String(s) => Some(s),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    })
}

pub(crate) fn text<'de, D: Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    Ok(opt_text(d)?.unwrap_or_default())
}

/// A map or list that may be `null` or missing in old files.
pub(crate) fn nullable<'de, D: Deserializer<'de>, T: Default + Deserialize<'de>>(
    d: D,
) -> Result<T, D::Error> {
    Ok(Option::<T>::deserialize(d)?.unwrap_or_default())
}

pub(crate) fn string_list<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<String>, D::Error> {
    Ok(match Value::deserialize(d)? {
        Value::Array(items) => items
            .into_iter()
            .filter_map(|v| match v {
                Value::String(s) => Some(s),
                Value::Number(n) => Some(n.to_string()),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    })
}

/// How a question counts (decision 5).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QuestionKind {
    /// In the points and the maximum, and in RTTI.
    Normal,
    /// In the points, not in the maximum, not in RTTI.
    Bonus,
    /// In nothing: diagnostic only.
    Diag,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Question {
    #[serde(default, deserialize_with = "text")]
    pub id: String,
    #[serde(default, deserialize_with = "number")]
    pub max_points: f64,
    /// `R`, `T1`, `T2` or `I`; anything else counts in no RTTI category (decision 18).
    #[serde(default, deserialize_with = "text")]
    pub rtti: String,
    #[serde(default, deserialize_with = "opt_text")]
    pub kind: Option<String>,
}

impl Question {
    /// An unknown kind counts as normal (decision 23).
    pub fn kind(&self) -> QuestionKind {
        match self.kind.as_deref() {
            Some("bonus") => QuestionKind::Bonus,
            Some("diag") => QuestionKind::Diag,
            _ => QuestionKind::Normal,
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Exam {
    #[serde(default, deserialize_with = "text")]
    pub id: String,
    #[serde(default, deserialize_with = "opt_number")]
    pub n_term: Option<f64>,
    #[serde(default, deserialize_with = "nullable")]
    pub questions: Vec<Question>,
    #[serde(default, deserialize_with = "opt_id")]
    pub parent_id: Option<String>,
    #[serde(default, deserialize_with = "opt_number")]
    pub attempt: Option<f64>,
    #[serde(default, deserialize_with = "opt_number")]
    pub volgnummer: Option<f64>,
    #[serde(default, deserialize_with = "opt_weight")]
    pub weging: Option<f64>,
    #[serde(default, deserialize_with = "opt_weight")]
    pub weging_se: Option<f64>,
    /// `pta` or `regular`.
    #[serde(default, rename = "type", deserialize_with = "opt_text")]
    pub exam_type: Option<String>,
    /// `toets` or `po`; absent means `toets`.
    #[serde(default, deserialize_with = "opt_text")]
    pub kind: Option<String>,
    #[serde(default, deserialize_with = "opt_text")]
    pub subject: Option<String>,
    #[serde(default, deserialize_with = "opt_text")]
    pub jaarlaag: Option<String>,
    #[serde(default, deserialize_with = "string_list")]
    pub schoolsoort: Vec<String>,
    #[serde(default, deserialize_with = "opt_text")]
    pub academic_year: Option<String>,
    /// A PO's rubric (`rubric_id`, step 22), **attached by the caller** before grading: the exam
    /// file names the rubric, it never holds it. A PO without one has no grade.
    #[serde(default, deserialize_with = "opt_rubric")]
    pub rubric: Option<Rubric>,
}

/// An attached rubric; anything that is not one reads as none.
fn opt_rubric<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Rubric>, D::Error> {
    Ok(serde_json::from_value(Value::deserialize(d)?).ok())
}

impl Exam {
    /// The ids a score record holds for this exam: a PO's rubric categories (step 22), else the
    /// questions.
    pub fn score_ids(&self) -> Vec<&str> {
        if self.is_po() {
            self.rubric
                .iter()
                .flat_map(|r| &r.categories)
                .map(|c| c.id.as_str())
                .collect()
        } else {
            self.questions.iter().map(|q| q.id.as_str()).collect()
        }
    }

    /// The n-term; 1 when absent.
    pub fn n(&self) -> f64 {
        self.n_term.unwrap_or(1.0)
    }

    /// A practical assignment: no RTTI (decision 19).
    pub fn is_po(&self) -> bool {
        self.kind.as_deref() == Some("po")
    }

    pub fn is_pta(&self) -> bool {
        self.exam_type.as_deref() == Some("pta")
    }

    /// The year-average weight: 1 when absent.
    pub fn weight(&self) -> f64 {
        self.weging.unwrap_or(1.0)
    }

    /// The SE-average weight: `weging_se`, else `weging`, else 1.
    pub fn weight_se(&self) -> f64 {
        self.weging_se.or(self.weging).unwrap_or(1.0)
    }
}

/// What a teacher entered for one question. An empty question has no entry at all.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ScoreValue {
    /// `N`, stored as `"N"` or `null`: not made, 0 points (decision 4).
    NotMade,
    /// A number; it may still be out of range for the question.
    Points(f64),
    /// Anything else: kept as typed so it can be corrected.
    Invalid,
}

impl ScoreValue {
    pub fn of(value: &Value) -> Self {
        match value {
            Value::Null => Self::NotMade,
            Value::String(s) if s.trim().eq_ignore_ascii_case("n") => Self::NotMade,
            other => number_of(other).map_or(Self::Invalid, Self::Points),
        }
    }

    /// The points when this is a valid score for a question of `max` points; `None` for `N` and
    /// invalid values (over the maximum, negative, text), which all earn 0 (decisions 4, 5).
    pub fn valid_points(self, max: f64) -> Option<f64> {
        match self {
            Self::Points(p) if (0.0..=max).contains(&p) => Some(p),
            _ => None,
        }
    }
}

/// `question id -> entry`, as stored.
pub type QuestionScores = HashMap<String, Value>;

/// Only a real number: `"6"` is not an overwritten grade, as in the reference.
fn opt_json_number<'de, D: Deserializer<'de>>(d: D) -> Result<Option<f64>, D::Error> {
    Ok(Value::deserialize(d)?.as_f64())
}

#[derive(Debug, Clone, Copy, Default, Deserialize)]
pub struct Override {
    #[serde(default, deserialize_with = "opt_json_number")]
    pub cijfer: Option<f64>,
    #[serde(default, deserialize_with = "opt_number")]
    pub berekend: Option<f64>,
}

/// One student's score file for one vak and year.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ScoreRecord {
    #[serde(default, deserialize_with = "tolerant_map")]
    pub scores: HashMap<String, QuestionScores>,
    #[serde(default, deserialize_with = "tolerant_map")]
    pub overrides: HashMap<String, Override>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Group {
    #[serde(default, deserialize_with = "text")]
    pub id: String,
    #[serde(default, deserialize_with = "text")]
    pub name: String,
    #[serde(default, deserialize_with = "opt_text")]
    pub subject: Option<String>,
    #[serde(default, deserialize_with = "opt_text")]
    pub jaarlaag: Option<String>,
    #[serde(default, deserialize_with = "string_list")]
    pub schoolsoort: Vec<String>,
    #[serde(default, deserialize_with = "string_list")]
    pub student_ids: Vec<String>,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn score_values_read_as_stored() {
        assert_eq!(ScoreValue::of(&json!(null)), ScoreValue::NotMade);
        assert_eq!(ScoreValue::of(&json!("N")), ScoreValue::NotMade);
        assert_eq!(ScoreValue::of(&json!("n")), ScoreValue::NotMade);
        assert_eq!(ScoreValue::of(&json!(7.5)), ScoreValue::Points(7.5));
        assert_eq!(ScoreValue::of(&json!("7.5")), ScoreValue::Points(7.5));
        assert_eq!(ScoreValue::of(&json!("abc")), ScoreValue::Invalid);
        assert_eq!(ScoreValue::of(&json!("")), ScoreValue::Invalid);
        assert_eq!(ScoreValue::of(&json!("inf")), ScoreValue::Invalid);
        assert_eq!(ScoreValue::of(&json!(true)), ScoreValue::Invalid);
    }

    #[test]
    fn valid_points_checks_the_range() {
        assert_eq!(ScoreValue::Points(10.0).valid_points(10.0), Some(10.0));
        assert_eq!(ScoreValue::Points(0.0).valid_points(10.0), Some(0.0));
        assert_eq!(ScoreValue::Points(12.0).valid_points(10.0), None);
        assert_eq!(ScoreValue::Points(-1.0).valid_points(10.0), None);
        assert_eq!(ScoreValue::NotMade.valid_points(10.0), None);
    }

    #[test]
    fn weights_fall_back_in_order() {
        let exam = |v| serde_json::from_value::<Exam>(v).unwrap();
        assert_eq!(exam(json!({})).weight(), 1.0);
        assert_eq!(exam(json!({})).weight_se(), 1.0);
        assert_eq!(exam(json!({"weging": 2})).weight_se(), 2.0);
        assert_eq!(exam(json!({"weging": 2, "weging_se": 3})).weight_se(), 3.0);
        assert_eq!(exam(json!({"weging": 2, "weging_se": 0})).weight_se(), 0.0);
    }

    #[test]
    fn a_bad_weight_counts_as_one_not_as_the_other_weight() {
        // Decision 22 (review M5).
        let exam = |v| serde_json::from_value::<Exam>(v).unwrap();
        assert_eq!(
            exam(json!({"weging": 3, "weging_se": "x"})).weight_se(),
            1.0
        );
        assert_eq!(exam(json!({"weging": "x"})).weight(), 1.0);
        assert_eq!(
            exam(json!({"weging": 3, "weging_se": null})).weight_se(),
            3.0
        );
    }

    #[test]
    fn damaged_entries_are_skipped_not_fatal() {
        // Review M8: these used to read, and one value must not take down a screen.
        let rec: ScoreRecord = serde_json::from_value(json!({
            "scores": {"bad": 5, "good": {"q1": 2}},
            "overrides": {"bad": 6.5, "good": {"cijfer": 7.0}}
        }))
        .unwrap();
        assert!(!rec.scores.contains_key("bad"));
        assert!(rec.scores.contains_key("good"));
        assert!(!rec.overrides.contains_key("bad"));
        assert_eq!(rec.overrides["good"].cijfer, Some(7.0));
        let q: Question = serde_json::from_value(json!({"max_points": 2, "rtti": "R"})).unwrap();
        assert_eq!(q.id, "");
    }

    #[test]
    fn an_empty_parent_id_is_no_parent() {
        let exam: Exam = serde_json::from_value(json!({"parent_id": ""})).unwrap();
        assert_eq!(exam.parent_id, None);
    }

    #[test]
    fn a_real_exam_file_reads() {
        let exam: Exam = serde_json::from_value(json!({
            "id": "t", "jaarlaag": 3, "n_term": "1.5", "weging": 1, "type": "pta", "kind": "toets",
            "schoolsoort": ["Havo"], "attempt": 2, "parent_id": "p", "periode": null,
            "questions": [{"id": "q1", "max_points": 2, "rtti": "T1", "kind": "bonus", "section": "I"}],
            "_meta": {"rev": 2}
        }))
        .unwrap();
        assert_eq!(exam.jaarlaag.as_deref(), Some("3"));
        assert_eq!(exam.n(), 1.5);
        assert!(exam.is_pta());
        assert_eq!(exam.questions[0].kind(), QuestionKind::Bonus);
    }
}
