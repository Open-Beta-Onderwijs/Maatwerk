// SPDX-License-Identifier: AGPL-3.0-or-later

//! Pins the crate to the reference app's behaviour (`tests/golden/logic`), except where the user
//! decided otherwise (`docs/phase-2/step-19-grade-rules.md` section 6). Every exception names its
//! decision; nothing else may differ.

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;

use maatwerk_grades::attempts::families;
use maatwerk_grades::grade::RttiPct;
use maatwerk_grades::rtti::{Attempt, question_stats};
use maatwerk_grades::{
    Exam, HistoryEntry, Override, ScoreRecord, best_attempt, box_stats, calc_grade, calc_results,
    clean, exam_results, grade_group, histogram, resolve_best_attempts, round1, se_average, stats,
    year_average,
};
use serde_json::Value;

fn golden(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/golden/logic")
        .join(format!("{name}.json"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn cases(g: &Value) -> impl Iterator<Item = (&str, &Value, &Value)> {
    g["cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| (c["id"].as_str().unwrap(), &c["input"], &c["output"]))
}

fn case<'a>(g: &'a Value, id: &str) -> (&'a Value, &'a Value) {
    let (_, input, output) = cases(g).find(|c| c.0 == id).unwrap();
    (input, output)
}

fn defined(v: &Value) -> Option<&Value> {
    (!v.is_null() && v.get("$undefined").is_none()).then_some(v)
}

fn pct_of(v: &Value) -> RttiPct {
    v.as_f64().map_or(RttiPct::Nvt, RttiPct::Pct)
}

fn opt_grade(v: &Value) -> Option<f64> {
    v.as_f64().map(round1)
}

/// Decisions 1 and 3: the same grade to within noise, for every n in the reference's sweep.
#[test]
fn calc_grade_matches_the_sweep() {
    let g = golden("grades");
    let (_, rows) = case(&g, "calcGrade-sweep");
    let rows = rows.as_array().unwrap();
    assert!(rows.len() > 1000);
    for row in rows {
        let n: Vec<f64> = row
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_f64().unwrap())
            .collect();
        let got = calc_grade(n[0], n[1], n[2]);
        assert!((got - n[3]).abs() < 1e-9, "{row}: {got}");
    }
}

#[test]
fn results_match_except_for_the_decisions() {
    let g = golden("grades");
    let mut checked = 0;
    for (id, input, want) in cases(&g) {
        if id == "calcGrade-sweep" {
            continue;
        }
        let exam: Exam = serde_json::from_value(input["exam"].clone()).unwrap();

        let got = if input.get("rec").is_some() {
            let rec: ScoreRecord = match defined(&input["rec"]) {
                Some(v) => serde_json::from_value(v.clone()).unwrap(),
                None => ScoreRecord::default(),
            };
            exam_results(&rec, &exam)
        } else {
            let scores = serde_json::from_value(input["scores"].clone()).unwrap_or_default();
            let over: Option<Override> =
                defined(&input["override"]).map(|v| serde_json::from_value(v.clone()).unwrap());
            Some(calc_results(&exam, &scores, over.as_ref()))
        };

        // Decision 18: the reference crashed on this; the question now counts in the grade only.
        if want.get("$throws").is_some() {
            assert_eq!(id, "unknown-rtti-tag");
            assert!(got.unwrap().grade.is_some());
            continue;
        }
        if want.is_null() {
            assert!(got.is_none(), "{id}");
            continue;
        }
        let got = got.unwrap_or_else(|| panic!("{id}: no results"));
        let num = |key: &str| want[key].as_f64().unwrap();

        // Decision 3: point totals without floating-point noise.
        assert_eq!(got.scored, clean(num("scored")), "{id}: scored");
        assert_eq!(got.normal_max, clean(num("normalMax")), "{id}: normalMax");
        assert_eq!(got.bonus_max, clean(num("bonusMax")), "{id}: bonusMax");
        assert_eq!(
            got.exam_max_total,
            clean(num("examMaxTotal")),
            "{id}: total"
        );
        assert_eq!(
            got.has_bonus,
            want["hasBonus"].as_bool().unwrap(),
            "{id}: hasBonus"
        );

        // Decision 2: the grade rounded to one decimal.
        assert_eq!(got.grade, opt_grade(&want["grade"]), "{id}: grade");
        assert_eq!(
            got.calculated_grade,
            opt_grade(&want["calculatedGrade"]),
            "{id}: calculated"
        );
        assert_eq!(
            got.overridden,
            want["overridden"].as_bool().unwrap(),
            "{id}: overridden"
        );
        assert_eq!(
            got.override_stale,
            want["overrideStale"].as_bool().unwrap(),
            "{id}: stale"
        );

        assert_eq!(got.r, pct_of(&want["R"]), "{id}: R");
        assert_eq!(got.t1, pct_of(&want["T1"]), "{id}: T1");
        assert_eq!(got.t2, pct_of(&want["T2"]), "{id}: T2");
        assert_eq!(got.i, pct_of(&want["I"]), "{id}: I");
        checked += 1;
    }
    assert!(checked > 35, "only {checked} cases");
}

/// The fixture folder of a suite, read as the app reads it.
struct Data {
    exams: BTreeMap<String, Vec<Exam>>,
    records: HashMap<(String, String), ScoreRecord>,
}

fn data(g: &Value) -> Data {
    let (input, _) = case(g, "data");
    let mut out = Data {
        exams: BTreeMap::new(),
        records: HashMap::new(),
    };
    // File names sorted, as NTFS returns them (B31).
    let files: BTreeMap<&String, &Value> = input["files"].as_object().unwrap().iter().collect();
    for (path, text) in files {
        let parts: Vec<&str> = path.split('/').collect();
        let body = text.as_str().unwrap();
        match parts.as_slice() {
            [year, "exams", _] => {
                let mut exam: Exam = serde_json::from_str(body).unwrap();
                exam.academic_year = Some((*year).to_owned());
                out.exams.entry((*year).to_owned()).or_default().push(exam);
            }
            [year, "scores", _, file] => {
                let student = file.trim_end_matches(".json").to_owned();
                let rec = serde_json::from_str(body).unwrap();
                out.records.insert(((*year).to_owned(), student), rec);
            }
            _ => {}
        }
    }
    out
}

impl Data {
    fn record(&self, year: &str, student: &str) -> ScoreRecord {
        self.records
            .get(&(year.to_owned(), student.to_owned()))
            .cloned()
            .unwrap_or_default()
    }

    /// A student's attempts over all years, as `getStudentHistory` lists them.
    fn history(&self, student: &str) -> Vec<HistoryEntry> {
        let mut out = Vec::new();
        for (year, exams) in &self.exams {
            let rec = self.record(year, student);
            for exam in exams {
                let scores = rec.scores.get(&exam.id);
                let over = rec.overrides.get(&exam.id).copied();
                if scores.is_none() && over.is_none() {
                    continue;
                }
                out.push(HistoryEntry {
                    exam: exam.clone(),
                    question_scores: scores.cloned().unwrap_or_default(),
                    r#override: over,
                });
            }
        }
        out
    }

    fn all_exams(&self) -> Vec<Exam> {
        self.exams.values().flatten().cloned().collect()
    }
}

#[test]
fn the_same_attempts_count_as_in_the_reference() {
    let g = golden("attempts");
    let d = data(&g);
    let mut checked = 0;
    for (id, input, want) in cases(&g) {
        if !id.starts_with("student-") {
            continue;
        }
        let student = input["studentId"].to_string();
        let history = d.history(&student);
        let got: Vec<&str> = resolve_best_attempts(&history)
            .into_iter()
            .map(|i| history[i].exam.id.as_str())
            .collect();
        let expect: Vec<&str> = want["resolveBestAttempts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["examId"].as_str().unwrap())
            .collect();
        assert_eq!(got, expect, "{id}");
        checked += 1;
    }
    assert!(checked >= 10);
}

#[test]
fn best_grade_map_matches() {
    let g = golden("attempts");
    let d = data(&g);
    let (input, want) = case(&g, "computeBestGradeMap");
    let year = input["year"].as_str().unwrap();
    let exams = &d.exams[year];
    let parent = input["parentId"].as_str().unwrap();
    let family = families(exams)
        .into_iter()
        .find(|f| f.head.id == parent)
        .unwrap();
    for (student, entry) in want.as_object().unwrap() {
        let best = best_attempt(&d.record(year, student), &family.attempts).unwrap();
        assert_eq!(
            best.exam.id,
            entry["examId"].as_str().unwrap(),
            "student {student}"
        );
        assert_eq!(
            best.grade,
            round1(entry["grade"].as_f64().unwrap()),
            "student {student}"
        );
    }
}

/// Decision 2 moves an average by at most half a tenth: it is now the mean of rounded grades.
const ROUNDED_GRADES: f64 = 0.05 + 1e-9;

fn assert_average(got: Option<f64>, want: &Value, label: &str) {
    match (got, want.as_f64()) {
        (None, None) => {}
        (Some(g), Some(w)) => assert!((g - w).abs() <= ROUNDED_GRADES, "{label}: {g} vs {w}"),
        other => panic!("{label}: {other:?}"),
    }
}

#[test]
fn averages_match_within_the_rounding_decision() {
    let g = golden("averages");
    let d = data(&g);
    let (_, exams) = d.exams.iter().next_back().unwrap();
    let year = "2025-2026";
    let all = d.all_exams();
    let mut checked = 0;
    for (id, input, want) in cases(&g) {
        if !id.starts_with("student-") {
            continue;
        }
        let student = input["studentId"].to_string();
        let rec = d.record(year, &student);
        assert_average(year_average(exams, &rec), &want["profileYearAvg"], id);
        assert_average(year_average(exams, &rec), &want["groupYearAvg"], id);
        assert_average(
            se_average(&d.history(&student), &all),
            &want["profilePtaAvg"],
            id,
        );
        checked += 1;
    }
    assert!(checked >= 7);
}

#[test]
fn exam_statistics_match_within_the_rounding_decision() {
    let g = golden("stats");
    let d = data(&g);
    let (_, want) = case(&g, "computeExamStats");
    let (year, exams) = d.exams.iter().next_back().unwrap();
    let exam = exams.iter().find(|e| e.parent_id.is_none()).unwrap();
    let grades: Vec<f64> = d
        .records
        .iter()
        .filter(|((y, _), _)| y == year)
        .filter_map(|(_, rec)| exam_results(rec, exam)?.grade)
        .collect();
    let s = stats(&grades).unwrap();
    assert_eq!(s.n as f64, want["n"].as_f64().unwrap());
    assert_eq!(s.fails, want["fails"].as_f64().unwrap());
    let shown = |v: &Value| {
        v.as_str()
            .unwrap()
            .replace(',', ".")
            .parse::<f64>()
            .unwrap()
    };
    assert!(
        (s.mean - shown(&want["avgG"])).abs() <= 0.1,
        "{} vs {}",
        s.mean,
        want["avgG"]
    );
    assert!(
        (s.sd - shown(&want["sd"])).abs() <= 0.1,
        "{} vs {}",
        s.sd,
        want["sd"]
    );
}

#[test]
fn grade_groups_match() {
    let g = golden("stats");
    let (input, want) = case(&g, "gradeGroupIdx");
    let grades = input["grades"].as_array().unwrap();
    for (grade, group) in grades.iter().zip(want.as_array().unwrap()) {
        let got = grade_group(grade.as_f64().unwrap());
        assert_eq!(got as u64, group.as_u64().unwrap(), "grade {grade}");
    }
}

/// Decision 14 changes the numbers on purpose; the reference's min and max stay.
#[test]
fn boxplot_keeps_min_and_max_and_differs_only_in_the_quartiles() {
    let g = golden("stats");
    let (input, want) = case(&g, "boxStats");
    for (set, w) in input["sets"]
        .as_array()
        .unwrap()
        .iter()
        .zip(want.as_array().unwrap())
    {
        let values: Vec<f64> = set
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_f64().unwrap())
            .collect();
        match box_stats(&values) {
            None => assert!(w.is_null()),
            Some(b) => {
                assert_eq!(b.min, w["min"].as_f64().unwrap());
                assert_eq!(b.max, w["max"].as_f64().unwrap());
            }
        }
    }
}

/// Decision 2: only a grade that rounds across a bin edge may move. Grades here are all rounded
/// first, so 5,44 stays in `<5,5` and 5,47 moves to the bin right of the pass line.
#[test]
fn histogram_counts_every_grade_once_with_the_same_shape() {
    let g = golden("stats");
    let (input, want) = case(&g, "makeHistBins");
    let grades: Vec<f64> = input["grades"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| round1(v.as_f64().unwrap()))
        .collect();
    for (key, step) in [("step05", 0.5), ("step1", 1.0)] {
        let h = histogram(&grades, step);
        assert_eq!(h.bins.iter().sum::<usize>(), grades.len());
        assert_eq!(h.bins.len(), want[key]["data"].as_array().unwrap().len());
        assert_eq!(
            h.pass_bin as u64,
            want[key]["passBinIndex"].as_u64().unwrap()
        );
    }
}

/// Decisions 4 and 5 change the overview on purpose: N and over-max values are 0 of the maximum,
/// so a question can no longer exceed 100%, and every entry adds to its maximum.
#[test]
fn question_analysis_never_exceeds_the_maximum() {
    let g = golden("stats");
    let d = data(&g);
    let (year, exams) = d.exams.iter().next_back().unwrap();
    let exam = exams.iter().find(|e| e.parent_id.is_none()).unwrap();
    let records: Vec<ScoreRecord> = d
        .records
        .iter()
        .filter(|((y, _), _)| y == year)
        .map(|(_, r)| r.clone())
        .collect();
    let attempts: Vec<Attempt<'_>> = records
        .iter()
        .filter_map(|rec| {
            Some(Attempt {
                exam,
                scores: rec.scores.get(&exam.id)?,
                grade: None,
            })
        })
        .collect();
    let out = question_stats(&attempts);
    assert!(!out.is_empty());
    for stat in out {
        assert!(stat.points.scored <= stat.points.max, "{}", stat.question);
    }
}
