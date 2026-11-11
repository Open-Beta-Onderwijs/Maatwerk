// SPDX-License-Identifier: AGPL-3.0-or-later

//! `maatwerk-cli stats`: the numbers of one school year and vak, for checking them by hand against
//! the screens (step 19). Reads the data folder and never writes. Students appear by number only.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use maatwerk_core::grades::attempts::families;
use maatwerk_core::grades::rubric::Rubric;
use maatwerk_core::grades::{
    Exam, HistoryEntry, ScoreRecord, Stats, Trend, best_attempt, exam_results, round1, se_average,
    stats, trend, year_average,
};
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, PartialEq)]
pub struct StatsArgs {
    data: PathBuf,
    year: String,
    vak: String,
    json: bool,
}

impl StatsArgs {
    pub fn parse(args: &[&str]) -> Result<StatsArgs, String> {
        let (mut data, mut year, mut vak, mut json) = (None, None, None, false);
        let mut args = args.iter().copied();
        while let Some(arg) = args.next() {
            match arg {
                "--json" => json = true,
                "--year" => year = Some(args.next().ok_or("--year needs a school year")?),
                "--vak" => vak = Some(args.next().ok_or("--vak needs a vak")?),
                flag if flag.starts_with('-') => return Err(format!("unknown option {flag}")),
                path if data.is_none() => data = Some(PathBuf::from(path)),
                extra => return Err(format!("unexpected argument {extra}")),
            }
        }
        Ok(StatsArgs {
            data: data.ok_or("missing <data-folder>")?,
            year: year.ok_or("missing --year")?.to_owned(),
            vak: vak.ok_or("missing --vak")?.to_owned(),
            json,
        })
    }

    pub fn run(self) -> ExitCode {
        match report(&self.data, &self.year, &self.vak) {
            Ok(report) => {
                if self.json {
                    let text = serde_json::to_string_pretty(&report).expect("plain data");
                    println!("{text}");
                } else {
                    print_report(&report);
                }
                ExitCode::SUCCESS
            }
            Err(message) => {
                eprintln!("error: {message}");
                ExitCode::FAILURE
            }
        }
    }
}

#[derive(Debug, Serialize)]
struct ExamLine {
    id: String,
    /// All students of the year with a grade for this attempt.
    attempt: Option<Stats>,
}

#[derive(Debug, Serialize)]
struct FamilyLine {
    id: String,
    attempts: Vec<ExamLine>,
    /// The best attempt per student; present when the test has resits.
    best: Option<Stats>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StudentLine {
    id: String,
    year_average: Option<f64>,
    se_average: Option<f64>,
    trend: Option<Trend>,
}

#[derive(Debug, Serialize)]
struct Report {
    tests: Vec<FamilyLine>,
    students: Vec<StudentLine>,
}

fn read_json(path: &Path) -> Result<Value, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))
}

/// The `.json` files of `dir`, by name; none when it does not exist.
fn json_files(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Ok(Vec::new());
    };
    let mut files: Vec<PathBuf> = entries
        .map(|e| e.map(|e| e.path()).map_err(|e| e.to_string()))
        .collect::<Result<_, _>>()?;
    files.retain(|p| p.extension().is_some_and(|x| x == "json"));
    files.sort();
    Ok(files)
}

/// The rubric `rubrics/<id>.json`, for grading a PO; `None` when missing or unreadable (the PO then
/// has no grade; `validate-data` names it).
fn read_rubric(data: &Path, id: &str) -> Option<Rubric> {
    if id.is_empty() || id.contains(['/', '\\', '.']) {
        return None;
    }
    serde_json::from_value(read_json(&data.join("rubrics").join(format!("{id}.json"))).ok()?).ok()
}

fn read_exams(data: &Path, year: &str, vak: &str) -> Result<Vec<Exam>, String> {
    let mut exams = Vec::new();
    for file in json_files(&data.join(year).join("exams"))? {
        let value = read_json(&file)?;
        let mut exam: Exam = serde_json::from_value(value.clone())
            .map_err(|e| format!("{}: {e}", file.display()))?;
        // A PO is graded with its rubric (step 22); an exam file never holds one itself.
        exam.rubric = maatwerk_core::rubrics::exam_rubric_id(&value)
            .filter(|_| exam.is_po())
            .and_then(|id| read_rubric(data, id));
        if exam.subject.as_deref() == Some(vak) {
            exam.academic_year = Some(year.to_owned());
            exams.push(exam);
        }
    }
    Ok(exams)
}

fn read_records(
    data: &Path,
    year: &str,
    vak: &str,
) -> Result<BTreeMap<String, ScoreRecord>, String> {
    let mut records = BTreeMap::new();
    for file in json_files(&data.join(year).join("scores").join(vak))? {
        let student = file
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        let record = serde_json::from_value(read_json(&file)?)
            .map_err(|e| format!("{}: {e}", file.display()))?;
        records.insert(student, record);
    }
    Ok(records)
}

/// The school years in the data folder: `2025-2026`-like folders, oldest first.
fn school_years(data: &Path) -> Result<Vec<String>, String> {
    let entries = std::fs::read_dir(data).map_err(|e| format!("{}: {e}", data.display()))?;
    let mut years: Vec<String> = entries
        .filter_map(Result::ok)
        .filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|name| {
            let (a, b) = name.split_once('-').unwrap_or(("", ""));
            a.len() == 4 && b.len() == 4 && a.chars().chain(b.chars()).all(|c| c.is_ascii_digit())
        })
        .collect();
    years.sort();
    Ok(years)
}

fn report(data: &Path, year: &str, vak: &str) -> Result<Report, String> {
    let years = school_years(data)?;
    if !years.iter().any(|y| y == year) {
        return Err(format!("no school year {year} in {}", data.display()));
    }
    let exams = read_exams(data, year, vak)?;
    let records = read_records(data, year, vak)?;

    let tests = families(&exams)
        .iter()
        .map(|family| {
            let grades_of = |exam: &Exam| -> Vec<f64> {
                records
                    .values()
                    .filter_map(|r| exam_results(r, exam)?.grade)
                    .collect()
            };
            let best: Vec<f64> = records
                .values()
                .filter_map(|r| Some(best_attempt(r, &family.attempts)?.grade))
                .collect();
            FamilyLine {
                id: family.head.id.clone(),
                attempts: family
                    .attempts
                    .iter()
                    .map(|e| ExamLine {
                        id: e.id.clone(),
                        attempt: stats(&grades_of(e)),
                    })
                    .collect(),
                best: (family.attempts.len() > 1).then(|| stats(&best)).flatten(),
            }
        })
        .collect();

    // Every year's tests and records, for the SE average.
    let mut all_exams = Vec::new();
    let mut all_records = Vec::new();
    for y in &years {
        all_exams.extend(read_exams(data, y, vak)?);
        all_records.push((y.clone(), read_records(data, y, vak)?));
    }
    let students = records
        .iter()
        .map(|(id, rec)| StudentLine {
            id: id.clone(),
            year_average: year_average(&exams, rec),
            se_average: se_average(&history(id, &all_exams, &all_records), &all_exams),
            trend: trend(&exams, rec),
        })
        .collect();
    Ok(Report { tests, students })
}

/// A student's attempts over all years.
fn history(
    student: &str,
    exams: &[Exam],
    records: &[(String, BTreeMap<String, ScoreRecord>)],
) -> Vec<HistoryEntry> {
    let mut out = Vec::new();
    for (year, year_records) in records {
        let Some(rec) = year_records.get(student) else {
            continue;
        };
        for exam in exams
            .iter()
            .filter(|e| e.academic_year.as_deref() == Some(year))
        {
            let scores = rec.scores.get(&exam.id);
            let over = rec.overrides.get(&exam.id).copied();
            if scores.is_some() || over.is_some() {
                out.push(HistoryEntry {
                    exam: exam.clone(),
                    question_scores: scores.cloned().unwrap_or_default(),
                    r#override: over,
                    po: rec.po.get(&exam.id).cloned(),
                });
            }
        }
    }
    out
}

fn comma(x: f64) -> String {
    format!("{:.1}", round1(x)).replace('.', ",")
}

fn stats_text(s: Option<Stats>) -> String {
    s.map_or("no grades".to_owned(), |s| {
        format!(
            "n={} mean {} sd {} fail {}%",
            s.n,
            comma(s.mean),
            comma(s.sd),
            s.fails
        )
    })
}

fn print_report(report: &Report) {
    println!("Tests");
    for test in &report.tests {
        println!("  {}", test.id);
        for attempt in &test.attempts {
            println!("    {}: {}", attempt.id, stats_text(attempt.attempt));
        }
        if test.best.is_some() {
            println!("    best attempt: {}", stats_text(test.best));
        }
    }
    println!("Students");
    for s in &report.students {
        let shown = |v: Option<f64>| v.map_or("-".to_owned(), comma);
        let arrow = s.trend.map_or("-".to_owned(), |t| {
            format!("{:?} ({})", t.level, comma(t.d))
        });
        println!(
            "  {}: year {} se {} trend {}",
            s.id,
            shown(s.year_average),
            shown(s.se_average),
            arrow
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_arguments() {
        let args =
            StatsArgs::parse(&["data", "--year", "2025-2026", "--vak", "nat", "--json"]).unwrap();
        assert_eq!(args.data, PathBuf::from("data"));
        assert_eq!(
            (args.year.as_str(), args.vak.as_str(), args.json),
            ("2025-2026", "nat", true)
        );
    }

    #[test]
    fn refuses_incomplete_arguments() {
        assert!(StatsArgs::parse(&["data", "--vak", "nat"]).is_err());
        assert!(StatsArgs::parse(&["data", "--year", "2025-2026"]).is_err());
        assert!(StatsArgs::parse(&["--year", "2025-2026", "--vak", "nat"]).is_err());
        assert!(StatsArgs::parse(&["data", "--year"]).is_err());
        assert!(StatsArgs::parse(&["data", "--nope"]).is_err());
    }

    #[test]
    fn comma_shows_one_decimal() {
        assert_eq!(comma(6.75), "6,8");
        assert_eq!(comma(7.0), "7,0");
    }
}
