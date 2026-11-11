// SPDX-License-Identifier: AGPL-3.0-or-later

//! The grade rules for the UI (ADR-0011). `dispatch` maps a function name and JSON arguments to
//! `maatwerk-grades`; it holds no rules of its own. Only `abi.rs` is wasm-specific, so everything
//! else is tested natively.

#[cfg(target_arch = "wasm32")]
mod abi;

use maatwerk_grades as g;
use maatwerk_grades::rtti::Attempt;
use maatwerk_grades::{
    Exam, Group, HistoryEntry, Override, PoGrading, PoLine, Question, ScoreRecord,
};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// One attempt in a statistic, as the UI sends it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttemptArg {
    exam: Exam,
    #[serde(default)]
    question_scores: g::model::QuestionScores,
    #[serde(default)]
    grade: Option<f64>,
}

fn attempts(args: &[AttemptArg]) -> Vec<Attempt<'_>> {
    args.iter()
        .map(|a| Attempt {
            exam: &a.exam,
            scores: &a.question_scores,
            grade: a.grade,
        })
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BestArg<'a> {
    exam_id: &'a str,
    grade: f64,
}

/// Decodes the JSON argument list into a tuple.
fn parse<T: DeserializeOwned>(args: Value) -> Result<T, String> {
    serde_json::from_value(args).map_err(|e| format!("bad arguments: {e}"))
}

/// Pads an argument list with `null` up to `n`, for trailing optional arguments.
fn pad(mut args: Value, n: usize) -> Value {
    if let Value::Array(items) = &mut args {
        while items.len() < n {
            items.push(Value::Null);
        }
    }
    args
}

fn json<T: Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|e| e.to_string())
}

/// Calls the rule `name` with the JSON array `args`.
pub fn dispatch(name: &str, args: Value) -> Result<Value, String> {
    match name {
        "calcGrade" => {
            let (s, l, n): (f64, f64, f64) = parse(args)?;
            json(g::calc_grade(s, l, n))
        }
        "calcResults" => {
            // The 4th argument, a PO's `po[examId]`, is optional.
            let (exam, scores, over, po): (Exam, Option<_>, Option<Override>, Option<PoGrading>) =
                parse(pad(args, 4))?;
            json(g::calc_results_with(
                &exam,
                &scores.unwrap_or_default(),
                over.as_ref(),
                po.as_ref(),
            ))
        }
        "examResults" => {
            let (rec, exam): (Option<ScoreRecord>, Exam) = parse(args)?;
            json(g::exam_results(&rec.unwrap_or_default(), &exam))
        }
        "bestAttempt" => {
            let (rec, exams): (Option<ScoreRecord>, Vec<Exam>) = parse(args)?;
            let refs: Vec<&Exam> = exams.iter().collect();
            let best = g::best_attempt(&rec.unwrap_or_default(), &refs);
            json(best.map(|b| BestArg {
                exam_id: &b.exam.id,
                grade: b.grade,
            }))
        }
        "resolveBestAttempts" => {
            let (history,): (Vec<HistoryEntry>,) = parse(args)?;
            json(g::resolve_best_attempts(&history))
        }
        "yearAverage" => {
            let (exams, rec): (Vec<Exam>, Option<ScoreRecord>) = parse(args)?;
            json(g::year_average(&exams, &rec.unwrap_or_default()))
        }
        "seAverage" => {
            let (history, exams): (Vec<HistoryEntry>, Vec<Exam>) = parse(args)?;
            json(g::se_average(&history, &exams))
        }
        "stats" => {
            let (grades,): (Vec<f64>,) = parse(args)?;
            json(g::stats(&grades))
        }
        "meanOfAverages" => {
            let (values,): (Vec<f64>,) = parse(args)?;
            json(g::mean_of_averages(&values))
        }
        "statsOfAverages" => {
            let (values,): (Vec<f64>,) = parse(args)?;
            json(g::stats_of_averages(&values))
        }
        "mean" => {
            let (values,): (Vec<f64>,) = parse(args)?;
            json(g::stats::mean(&values))
        }
        "histogram" => {
            let (grades, step): (Vec<f64>, f64) = parse(args)?;
            json(g::histogram(&grades, step))
        }
        "gradeGroup" => {
            let (grade,): (f64,) = parse(args)?;
            json(g::grade_group(grade))
        }
        "boxStats" => {
            let (values,): (Vec<f64>,) = parse(args)?;
            json(g::box_stats(&values))
        }
        "pooledRtti" => {
            let (history,): (Vec<HistoryEntry>,) = parse(args)?;
            json(g::rtti::pooled_rtti(&history))
        }
        "rttiByGradeGroup" => {
            let (list,): (Vec<AttemptArg>,) = parse(args)?;
            json(g::rtti::rtti_by_grade_group(&attempts(&list)))
        }
        "questionStats" => {
            let (list,): (Vec<AttemptArg>,) = parse(args)?;
            json(g::rtti::question_stats(&attempts(&list)))
        }
        "classQuestion" => {
            let (question, all): (Question, Vec<g::model::QuestionScores>) = parse(args)?;
            let refs: Vec<_> = all.iter().collect();
            json(g::rapport::class_question(&question, &refs))
        }
        "classQuestions" => {
            let (questions, all): (Vec<Question>, Vec<g::model::QuestionScores>) = parse(args)?;
            let refs: Vec<_> = all.iter().collect();
            json(g::rapport::class_questions(&questions, &refs))
        }
        "rapportTotals" => {
            let (exam, scores): (Exam, Option<_>) = parse(args)?;
            json(g::rapport::rapport_totals(
                &exam,
                &scores.unwrap_or_default(),
            ))
        }
        "rapportBins" => {
            let (grades,): (Vec<f64>,) = parse(args)?;
            json(g::rapport::rapport_bins(&grades))
        }
        "rapportBin" => {
            let (grade,): (f64,) = parse(args)?;
            json(g::rapport::rapport_bin(grade))
        }
        "adviceBracket" => {
            let (scored, max, limits): (f64, f64, Option<g::rapport::Grenzen>) = parse(args)?;
            json(g::rapport::advice_bracket(
                scored,
                max,
                limits.unwrap_or_default(),
            ))
        }
        "ranking" => {
            let (grade, grades): (f64, Vec<f64>) = parse(args)?;
            json(g::rapport::ranking(grade, &grades))
        }
        "studentGroup" => {
            let (student, exam, groups): (String, Exam, Vec<Group>) = parse(args)?;
            json(g::student_group(&student, &exam, &groups).map(|group| group.id.clone()))
        }
        "trend" => {
            let (exams, rec): (Vec<Exam>, Option<ScoreRecord>) = parse(args)?;
            json(g::trend(&exams, &rec.unwrap_or_default()))
        }
        "checkRubric" => {
            let (rubric,): (g::rubric::Rubric,) = parse(args)?;
            json(g::rubric::check_rubric(&rubric))
        }
        "rubricLockedChanges" => {
            let (before, after): (g::rubric::Rubric, g::rubric::Rubric) = parse(args)?;
            json(g::rubric::locked_changes(&before, &after))
        }
        "poGrade" => {
            let (points, max): (f64, f64) = parse(args)?;
            json(g::rubric::po_grade(points, max))
        }
        "poPoints" => {
            let (rubric, scores): (
                g::rubric::Rubric,
                Option<std::collections::HashMap<String, f64>>,
            ) = parse(args)?;
            json(g::rubric::po_points(&rubric, &scores.unwrap_or_default()))
        }
        "poLineValid" => {
            let (value,): (Value,) = parse(args)?;
            json(value.as_f64().is_some_and(g::rubric::line_valid))
        }
        "poLinesSum" => {
            let (lines,): (Option<Vec<Value>>,) = parse(args)?;
            let lines: Vec<PoLine> = lines
                .unwrap_or_default()
                .into_iter()
                .filter_map(|l| serde_json::from_value(l).ok())
                .collect();
            json(g::rubric::lines_sum(&lines))
        }
        "poWithLines" => {
            let (grade, lines): (f64, f64) = parse(args)?;
            json(g::rubric::with_lines(grade, lines))
        }
        other => Err(format!("unknown function {other}")),
    }
}

/// `dispatch` on text: `{"ok": value}` or `{"error": message}`. Never panics on bad input.
pub fn call(name: &str, args: &str) -> String {
    let result = serde_json::from_str(args)
        .map_err(|e| format!("bad JSON: {e}"))
        .and_then(|args| dispatch(name, args));
    let reply = match result {
        Ok(value) => serde_json::json!({ "ok": value }),
        Err(message) => serde_json::json!({ "error": message }),
    };
    reply.to_string()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn exam() -> Value {
        json!({"id": "e", "n_term": 1, "_meta": {"rev": 1}, "questions": [
            {"id": "q1", "max_points": 10, "rtti": "R"},
            {"id": "q2", "max_points": 10, "rtti": "T1"}
        ]})
    }

    fn ok(reply: &str) -> Value {
        let v: Value = serde_json::from_str(reply).unwrap();
        assert!(v.get("error").is_none(), "{reply}");
        v["ok"].clone()
    }

    fn run(name: &str, args: Value) -> Value {
        ok(&call(name, &args.to_string()))
    }

    #[test]
    fn calc_results_takes_nulls_from_the_ui() {
        let v = run("calcResults", json!([exam(), {"q1": 8, "q2": "N"}, null]));
        assert_eq!(v["grade"], json!(4.6));
        assert_eq!(v["R"], json!(80.0));
        assert_eq!(v["T1"], json!(0.0));
        let v = run("calcResults", json!([exam(), null, {"cijfer": 7.5}]));
        assert_eq!(v["grade"], json!(7.5));
    }

    #[test]
    fn exam_results_is_null_without_anything() {
        assert_eq!(run("examResults", json!([null, exam()])), Value::Null);
        assert_eq!(
            run("examResults", json!([{"scores": null}, exam()])),
            Value::Null
        );
    }

    #[test]
    fn best_attempt_reports_the_id() {
        let mut resit = exam();
        resit["id"] = json!("h");
        let rec = json!({"overrides": {"e": {"cijfer": 5.0}, "h": {"cijfer": 6.0}}});
        let v = run("bestAttempt", json!([rec, [exam(), resit]]));
        assert_eq!(v, json!({"examId": "h", "grade": 6.0}));
    }

    #[test]
    fn every_function_answers_without_panicking() {
        let history = json!([{"exam": exam(), "questionScores": {"q1": 8}}]);
        let attempt = json!([{"exam": exam(), "questionScores": {"q1": 8}, "grade": 5.0}]);
        let question = json!({"id": "q1", "max_points": 10, "rtti": "R"});
        for (name, args) in [
            ("calcGrade", json!([5, 10, 1])),
            ("resolveBestAttempts", json!([history])),
            ("yearAverage", json!([[exam()], null])),
            ("seAverage", json!([history, [exam()]])),
            ("stats", json!([[5.0, 6.0]])),
            ("mean", json!([[5.0, 6.0]])),
            ("meanOfAverages", json!([[5.0, 6.0]])),
            ("statsOfAverages", json!([[5.0, 6.0]])),
            ("histogram", json!([[5.0], 0.5])),
            ("gradeGroup", json!([5.0])),
            ("boxStats", json!([[5.0]])),
            ("pooledRtti", json!([history])),
            ("rttiByGradeGroup", json!([attempt])),
            ("questionStats", json!([attempt])),
            ("classQuestion", json!([question.clone(), [{"q1": 8}]])),
            ("adviceBracket", json!([5, 10, null])),
            ("adviceBracket", json!([5, 10, {"laag_midden": "x"}])),
            ("classQuestions", json!([[question], [{"q1": 8}]])),
            ("rapportTotals", json!([exam(), {"q1": 8}])),
            ("rapportBins", json!([[5.0]])),
            ("rapportBin", json!([5.0])),
            ("ranking", json!([5.0, [5.0]])),
            ("studentGroup", json!(["1", exam(), []])),
            ("trend", json!([[exam()], null])),
            ("checkRubric", json!([{}])),
            (
                "checkRubric",
                json!([{"categories": [{"max": "x", "niveaus": null}]}]),
            ),
            (
                "rubricLockedChanges",
                json!([{}, {"categories": [{"id": "a"}]}]),
            ),
            ("poGrade", json!([5, 10])),
            ("poPoints", json!([{}, null])),
            ("poLineValid", json!(["x"])),
            ("poLinesSum", json!([null])),
            ("poLinesSum", json!([[5, {"value": "x"}]])),
            ("poWithLines", json!([5, -0.5])),
        ] {
            run(name, args);
        }
    }

    #[test]
    fn po_lines_reach_the_ui() {
        // Decision 28 through the UI's calls.
        let po = json!({"id": "p", "kind": "po", "rubric": {"categories": [
            {"id": "c", "max": 50, "soort": "normaal"}
        ]}});
        let lines = json!({"groupLines": [{"label": "Te laat", "value": -0.5}], "ownLines": []});
        let v = run("calcResults", json!([po.clone(), {"c": 35}, null, lines]));
        assert_eq!(
            (v["rubricGrade"].clone(), v["grade"].clone()),
            (json!(7.0), json!(6.5))
        );
        let rec = json!({"scores": {"p": {"c": 35}}, "po": {"p": lines}});
        assert_eq!(run("examResults", json!([rec, po]))["grade"], json!(6.5));
        assert_eq!(run("poLineValid", json!([0.5])), json!(true));
        assert_eq!(run("poLineValid", json!([0.25])), json!(false));
        assert_eq!(
            run("poLinesSum", json!([[{"value": 0.1}, {"value": 0.2}]])),
            json!(0.3)
        );
        assert_eq!(run("poWithLines", json!([9.8, 0.5])), json!(10.0));
    }

    #[test]
    fn damaged_records_still_answer() {
        // Review M8: these read in the reference, so one value must not stop a screen.
        let rec = json!({"scores": {"e": 5}, "overrides": {"e": 6.5}});
        assert_eq!(run("examResults", json!([rec, exam()])), Value::Null);
        let no_id = json!({"id": "e", "questions": [{"max_points": 2, "rtti": "R"}]});
        assert_eq!(
            run("calcResults", json!([no_id, {}, null]))["normalMax"],
            json!(2.0)
        );
    }

    #[test]
    fn bad_input_is_an_error_not_a_panic() {
        let bad = |reply: String| {
            let v: Value = serde_json::from_str(&reply).unwrap();
            assert!(v["error"].is_string(), "{reply}");
        };
        bad(call("nope", "[]"));
        bad(call("calcGrade", "not json"));
        bad(call("calcGrade", "[1]"));
    }

    #[test]
    fn numbers_survive_the_round_trip_exactly() {
        let v = run("calcGrade", json!([1, 3, 1]));
        assert_eq!(v.as_f64().unwrap(), g::calc_grade(1.0, 3.0, 1.0));
    }
}
