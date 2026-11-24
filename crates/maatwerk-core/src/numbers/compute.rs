// SPDX-License-Identifier: AGPL-3.0-or-later

//! The numbers of one year and vak (step 38.3): per student the results, card bars, year and SE
//! average (shown under the school's format) and trend; per exam and attempt the card numbers,
//! per test with resits the Verzamelkaart; per group the card statistics. Every number comes
//! from `maatwerk-grades`; this file only selects, groups and counts.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::Serialize;
use serde_json::Value;

use super::format::Formats;
use super::load::{Student, YearData, is_upper};
use crate::grades::attempts::families;
use crate::grades::{
    AverageFormat, Exam, Group, HistoryEntry, Override, PoGrading, ScoreRecord, Stats, Trend,
    best_attempt, exam_results, histogram, is_fail_shown, se_average, shown_average, stats,
    stats_of_averages, trend, year_average,
};

/// One bar of a student card: a test's best attempt, in volgnummer order.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bar {
    /// The original's id.
    pub exam_id: String,
    pub grade: f64,
    /// Grey, counts for nothing (decision 6).
    pub diagnostic: bool,
}

/// A student average as the screens show it (decisions 91-93).
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Shown {
    /// Unrounded, from the crate.
    pub raw: f64,
    /// Under the school's format.
    pub shown: f64,
    /// The shown value below 5,5.
    pub fails: bool,
}

impl Shown {
    fn of(raw: Option<f64>, fmt: AverageFormat) -> Option<Shown> {
        raw.map(|raw| {
            let shown = shown_average(raw, fmt);
            Shown {
                raw,
                shown,
                fails: is_fail_shown(shown),
            }
        })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudentNumbers {
    /// Years 4-6: the cards show the SE.
    pub upper: bool,
    /// Grade per attempt id, for every attempt with one.
    pub results: BTreeMap<String, f64>,
    pub bars: Vec<Bar>,
    /// The year average (r).
    pub average: Option<Shown>,
    pub trend: Option<Trend>,
    /// The SE average over all years; only for upper-school students, members of an
    /// upper-school group, and every student of a year with a PTA test (the group overview's SE
    /// column).
    pub se: Option<Shown>,
}

/// The numbers of one exam card (an attempt, or a Verzamelkaart).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExamNumbers {
    /// The grades that count, in student order.
    pub grades: Vec<f64>,
    pub stats: Option<Stats>,
    /// The mini histogram's bins (step 1).
    pub histogram: crate::grades::stats::Histogram,
    /// Observatie id -> number of students.
    pub obs: BTreeMap<String, usize>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupNumbers {
    pub upper: bool,
    /// Mean, SD, % onvoldoende of the members' shown year averages (decisions 21, 92).
    pub year: Option<Stats>,
    /// The same of the SE averages (upper school only).
    pub se: Option<Stats>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VakNumbers {
    pub year: String,
    pub vak: String,
    pub formats: Formats,
    pub students: BTreeMap<String, StudentNumbers>,
    /// Per attempt id.
    pub exams: BTreeMap<String, ExamNumbers>,
    /// The Verzamelkaart per original that has resits.
    pub summaries: BTreeMap<String, ExamNumbers>,
    pub groups: BTreeMap<String, GroupNumbers>,
}

fn record_of(v: Option<&Value>) -> ScoreRecord {
    v.and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default()
}

fn strings(v: Option<&Value>) -> impl Iterator<Item = String> + '_ {
    v.and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|s| s.as_str().map(str::to_owned))
}

/// A student's observaties of one attempt: a test's list, or a PO's general and category ones
/// (`obsOf`, `poStudentObs`); each once.
fn obs_of(rec: Option<&Value>, exam: &Exam) -> Vec<String> {
    let Some(rec) = rec else { return vec![] };
    let mut out: Vec<String> = strings(rec.pointer_get(&["observations", &exam.id])).collect();
    if exam.is_po()
        && let Some(cats) = rec
            .pointer_get(&["po", &exam.id, "categoryObs"])
            .and_then(Value::as_object)
    {
        out.extend(cats.values().flat_map(|v| strings(Some(v))));
    }
    let mut seen = HashSet::new();
    out.retain(|id| seen.insert(id.clone()));
    out
}

trait PointerGet {
    fn pointer_get(&self, keys: &[&str]) -> Option<&Value>;
}

impl PointerGet for Value {
    fn pointer_get(&self, keys: &[&str]) -> Option<&Value> {
        keys.iter().try_fold(self, |v, k| v.get(*k))
    }
}

/// A student's attempts of the vak over all years, as `Store.getStudentHistory`: per year the
/// exams in the score file's `scores`, then `overrides`; sorted by school year, then volgnummer
/// (stable).
fn history(id: &str, years: &[YearData]) -> Vec<HistoryEntry> {
    let mut out = vec![];
    for y in years {
        let Some(rec) = y.records.get(id) else {
            continue;
        };
        let keys = |field: &str| {
            rec.get(field)
                .and_then(Value::as_object)
                .map(|m| m.keys().cloned().collect::<Vec<_>>())
                .unwrap_or_default()
        };
        let mut ids = keys("scores");
        ids.extend(keys("overrides"));
        let mut seen = HashSet::new();
        ids.retain(|k| seen.insert(k.clone()));
        for exam_id in ids {
            let Some(exam) = y.exams.iter().find(|e| e.id == exam_id) else {
                continue;
            };
            let question_scores = rec
                .pointer_get(&["scores", &exam_id])
                .and_then(Value::as_object)
                .map(|m| m.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
                .unwrap_or_default();
            let ov = rec
                .pointer_get(&["overrides", &exam_id])
                .and_then(|v| serde_json::from_value::<Override>(v.clone()).ok());
            let po = rec
                .pointer_get(&["po", &exam_id])
                .and_then(|v| serde_json::from_value::<PoGrading>(v.clone()).ok());
            out.push(HistoryEntry {
                exam: exam.clone(),
                question_scores,
                r#override: ov,
                po,
            });
        }
    }
    out.sort_by(|a, b| {
        let year = |e: &HistoryEntry| e.exam.academic_year.clone().unwrap_or_default();
        let nr = |e: &HistoryEntry| e.exam.volgnummer.unwrap_or(0.0);
        year(a).cmp(&year(b)).then(
            nr(a)
                .partial_cmp(&nr(b))
                .unwrap_or(std::cmp::Ordering::Equal),
        )
    });
    out
}

#[derive(Default)]
struct Card {
    grades: Vec<f64>,
    obs: BTreeMap<String, usize>,
}

impl Card {
    fn count(&mut self, ids: Vec<String>) {
        for id in ids {
            *self.obs.entry(id).or_default() += 1;
        }
    }

    fn finish(self) -> ExamNumbers {
        ExamNumbers {
            stats: stats(&self.grades),
            histogram: histogram(&self.grades, 1.0),
            grades: self.grades,
            obs: self.obs,
        }
    }
}

/// The numbers of `current` (one year and vak). `all_years`: every year of the vak (the current
/// one included) for the SE averages; may be empty when no student or group is upper school.
pub fn compute(
    vak: &str,
    current: &YearData,
    all_years: &[YearData],
    students: &[Student],
    groups: &[Group],
    formats: Formats,
) -> VakNumbers {
    let exams = &current.exams;
    let fams = families(exams);
    // Originals in card order: volgnummer, then id.
    let mut originals: Vec<_> = fams.iter().filter(|f| f.head.parent_id.is_none()).collect();
    originals.sort_by(|a, b| {
        let nr = |e: &Exam| e.volgnummer.unwrap_or(0.0);
        nr(a.head)
            .partial_cmp(&nr(b.head))
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.head.id.cmp(&b.head.id))
    });

    let upper_groups: Vec<&Group> = groups
        .iter()
        .filter(|g| {
            is_upper(
                g.jaarlaag
                    .as_ref()
                    .map(|j| Value::String(j.clone()))
                    .as_ref(),
            )
        })
        .collect();
    let in_upper_group: HashSet<&str> = upper_groups
        .iter()
        .flat_map(|g| g.student_ids.iter().map(String::as_str))
        .collect();
    let all_exams: Vec<Exam> = all_years.iter().flat_map(|y| y.exams.clone()).collect();
    let any_pta = exams.iter().any(Exam::is_pta);

    let mut cards: HashMap<&str, Card> = exams
        .iter()
        .map(|e| (e.id.as_str(), Card::default()))
        .collect();
    let mut summaries: BTreeMap<String, Card> = BTreeMap::new();
    let mut out_students = BTreeMap::new();

    for s in students {
        let raw = current.records.get(&s.id);
        let rec = record_of(raw);
        let mut results = BTreeMap::new();
        for exam in exams {
            let grade = exam_results(&rec, exam).and_then(|r| r.grade);
            let card = cards
                .get_mut(exam.id.as_str())
                .expect("every exam has a card");
            if let Some(g) = grade {
                results.insert(exam.id.clone(), g);
                card.grades.push(g);
            }
            card.count(obs_of(raw, exam));
        }
        let mut bars = vec![];
        for fam in &originals {
            let best = best_attempt(&rec, &fam.attempts);
            if let Some(b) = &best {
                bars.push(Bar {
                    exam_id: fam.head.id.clone(),
                    grade: b.grade,
                    diagnostic: current.diagnostic.contains(&fam.head.id),
                });
            }
            if fam.attempts.len() > 1 {
                let card = summaries.entry(fam.head.id.clone()).or_default();
                match &best {
                    Some(b) => {
                        card.grades.push(b.grade);
                        card.count(obs_of(raw, b.exam));
                    }
                    None => {
                        // Without a grade: the observaties of every attempt, each once.
                        let mut ids: Vec<String> =
                            fam.attempts.iter().flat_map(|a| obs_of(raw, a)).collect();
                        let mut seen = HashSet::new();
                        ids.retain(|id| seen.insert(id.clone()));
                        card.count(ids);
                    }
                }
            }
        }
        let needs_se = s.upper || any_pta || in_upper_group.contains(s.id.as_str());
        let se_raw = if needs_se {
            se_average(&history(&s.id, all_years), &all_exams)
        } else {
            None
        };
        out_students.insert(
            s.id.clone(),
            StudentNumbers {
                upper: s.upper,
                results,
                bars,
                average: Shown::of(year_average(exams, &rec), formats.r),
                trend: trend(exams, &rec),
                se: Shown::of(se_raw, formats.se),
            },
        );
    }

    let mut out_groups = BTreeMap::new();
    for g in groups {
        let members: HashSet<&str> = g.student_ids.iter().map(String::as_str).collect();
        let of = |pick: &dyn Fn(&StudentNumbers) -> Option<f64>, fmt: AverageFormat| {
            let raws: Vec<f64> = students
                .iter()
                .filter(|s| members.contains(s.id.as_str()))
                .filter_map(|s| out_students.get(&s.id).and_then(pick))
                .collect();
            stats_of_averages(&raws, fmt)
        };
        let upper = upper_groups.iter().any(|u| u.id == g.id);
        out_groups.insert(
            g.id.clone(),
            GroupNumbers {
                upper,
                year: of(&|n| n.average.map(|a| a.raw), formats.r),
                se: if upper {
                    of(&|n| n.se.map(|a| a.raw), formats.se)
                } else {
                    None
                },
            },
        );
    }

    VakNumbers {
        year: current.year.clone(),
        vak: vak.into(),
        formats,
        students: out_students,
        exams: cards
            .into_iter()
            .map(|(id, c)| (id.to_owned(), c.finish()))
            .collect(),
        summaries: summaries
            .into_iter()
            .map(|(id, c)| (id, c.finish()))
            .collect(),
        groups: out_groups,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grades::Method;
    use serde_json::json;

    fn exam(v: Value) -> Exam {
        serde_json::from_value(v).unwrap()
    }

    fn year(exams: Vec<Value>, records: Vec<(&str, Value)>) -> YearData {
        let diagnostic = exams
            .iter()
            .filter(|e| e["diagnostic"] == json!(true))
            .map(|e| e["id"].as_str().unwrap().to_owned())
            .collect();
        YearData {
            year: "2026-2027".into(),
            exams: exams.into_iter().map(exam).collect(),
            records: records
                .into_iter()
                .map(|(id, v)| (id.to_owned(), v))
                .collect(),
            diagnostic,
        }
    }

    fn student(id: &str, upper: bool) -> Student {
        Student {
            id: id.into(),
            upper,
        }
    }

    fn q(points: u32) -> Value {
        json!([{"id": "q1", "max_points": points, "rtti": "R"}])
    }

    fn rubric() -> Value {
        json!({"id": "r", "subject": "nat", "categories": [
            {"id": "c1", "naam": "Inhoud", "max": 10, "soort": "normaal", "niveaus": []}
        ]})
    }

    #[test]
    fn cards_bars_verzamelkaart_and_formats() {
        let data = year(
            vec![
                json!({"id": "t1", "volgnummer": 1, "n_term": 1, "questions": q(10)}),
                json!({"id": "h1", "parent_id": "t1", "attempt": 2, "n_term": 1, "questions": q(10)}),
                json!({"id": "d", "volgnummer": 2, "diagnostic": true, "weging": 0, "n_term": 1, "questions": q(10)}),
            ],
            vec![
                // t1 4,6, resit 6,4: the resit counts.
                (
                    "a",
                    json!({"scores": {"t1": {"q1": 4}, "h1": {"q1": 6}, "d": {"q1": 9}},
                             "observations": {"t1": ["o1", "o1", 3], "h1": ["o2"]}}),
                ),
                // No grade anywhere: the Verzamelkaart counts the observaties of every attempt.
                (
                    "b",
                    json!({"observations": {"t1": ["o1"], "h1": ["o1", "o3"]}}),
                ),
            ],
        );
        let k0 = Formats {
            r: AverageFormat::new(Method::Afkappen, 0).unwrap(),
            ..Formats::default()
        };
        let n = compute(
            "nat",
            &data,
            &[],
            &[student("a", false), student("b", false)],
            &[],
            k0,
        );
        let a = &n.students["a"];
        assert_eq!(a.results["t1"], 4.6);
        assert_eq!(a.results["h1"], 6.4);
        assert_eq!(
            a.bars,
            vec![
                Bar {
                    exam_id: "t1".into(),
                    grade: 6.4,
                    diagnostic: false
                },
                Bar {
                    exam_id: "d".into(),
                    grade: 9.1,
                    diagnostic: true
                },
            ]
        );
        // Year average 6,4 (d has weging 0); afkappen 0 shows 6.
        let avg = a.average.unwrap();
        assert_eq!((avg.raw, avg.shown, avg.fails), (6.4, 6.0, false));
        assert!(n.students["b"].average.is_none());
        assert_eq!(n.exams["t1"].grades, vec![4.6]);
        assert_eq!(n.exams["t1"].obs, BTreeMap::from([("o1".into(), 2)]));
        let v = &n.summaries["t1"];
        assert_eq!(v.grades, vec![6.4]);
        assert_eq!(
            v.obs,
            BTreeMap::from([("o2".into(), 1), ("o1".into(), 1), ("o3".into(), 1)])
        );
        assert!(!n.summaries.contains_key("d"));
        assert_eq!(n.exams["t1"].stats.unwrap().n, 1);
        assert_eq!(n.exams["t1"].histogram.bins.iter().sum::<usize>(), 1);
    }

    #[test]
    fn a_po_is_graded_with_its_rubric_and_counts_category_observaties() {
        let mut po = json!({"id": "p", "kind": "po", "subject": "nat", "rubric_id": "r"});
        po["rubric"] = rubric();
        let data = year(
            vec![po],
            vec![(
                "a",
                json!({"scores": {"p": {"c1": 7}}, "observations": {"p": ["o1"]},
                       "po": {"p": {"categoryObs": {"c1": ["o1", "o2"]}}}}),
            )],
        );
        let n = compute(
            "nat",
            &data,
            &[],
            &[student("a", false)],
            &[],
            Formats::default(),
        );
        assert_eq!(n.students["a"].results["p"], 7.0);
        assert_eq!(
            n.exams["p"].obs,
            BTreeMap::from([("o1".into(), 1), ("o2".into(), 1)])
        );
    }

    #[test]
    fn group_numbers_use_the_shown_values_and_the_se_of_all_years() {
        let pta = |id: &str, nr: u32| json!({"id": id, "volgnummer": nr, "type": "pta", "n_term": 1, "questions": q(10)});
        let mut old = year(
            vec![pta("x", 1)],
            vec![("a", json!({"scores": {"x": {"q1": 2}}}))],
        );
        old.year = "2025-2026".into();
        for e in &mut old.exams {
            e.academic_year = Some("2025-2026".into());
        }
        let mut now = year(
            vec![pta("t", 1)],
            vec![
                ("a", json!({"scores": {"t": {"q1": 5}}})),
                ("b", json!({"scores": {"t": {"q1": 6}}})),
            ],
        );
        for e in &mut now.exams {
            e.academic_year = Some("2026-2027".into());
        }
        let group: Group = serde_json::from_value(
            json!({"id": "g", "subject": "nat", "jaarlaag": "4", "student_ids": ["a", "b"]}),
        )
        .unwrap();
        let k0 = Formats {
            r: AverageFormat::new(Method::Afkappen, 0).unwrap(),
            se: AverageFormat::new(Method::Afkappen, 0).unwrap(),
        };
        let all = [now.clone(), old];
        let students = [student("a", false), student("b", false)];
        let n = compute("nat", &now, &all, &students, &[group], k0);
        // a: r 5,5 -> 5 (fail); b: 6,4 -> 6. SE of a over both years: (2,8 + 5,5) / 2 = 4,15 -> 4.
        let g = &n.groups["g"];
        assert!(g.upper);
        let year = g.year.unwrap();
        assert_eq!((year.mean, year.fails), (5.5, 50.0));
        assert_eq!(n.students["a"].se.unwrap().shown, 4.0);
        assert_eq!(g.se.unwrap().mean, 5.0);
    }
}
