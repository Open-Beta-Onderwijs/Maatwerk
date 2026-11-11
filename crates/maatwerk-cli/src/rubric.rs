// SPDX-License-Identifier: AGPL-3.0-or-later

//! `maatwerk-cli rubric check`: the rubric rules (PLAN-2 decision 21) on one rubric file or on
//! every rubric of a data folder, with how many PO's use each (decision 20). Reads only.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use maatwerk_core::grades::rubric::{Rubric, RubricCheck, check_rubric};
use maatwerk_core::paths::RelPath;
use maatwerk_core::rubrics::{RUBRICS_DIR, usage};
use maatwerk_core::storage::Storage;
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, PartialEq)]
pub struct CheckArgs {
    target: PathBuf,
    json: bool,
}

impl CheckArgs {
    pub fn parse(args: &[&str]) -> Result<CheckArgs, String> {
        let (mut target, mut json) = (None, false);
        for &arg in args {
            match arg {
                "--json" => json = true,
                flag if flag.starts_with('-') => return Err(format!("unknown option {flag}")),
                path if target.is_none() => target = Some(PathBuf::from(path)),
                extra => return Err(format!("unexpected argument {extra}")),
            }
        }
        Ok(CheckArgs {
            target: target.ok_or("missing <rubric.json | data-folder>")?,
            json,
        })
    }

    pub fn run(self) -> ExitCode {
        let lines = match check(&self.target) {
            Ok(lines) => lines,
            Err(message) => {
                eprintln!("error: {message}");
                return ExitCode::from(2);
            }
        };
        if self.json {
            println!(
                "{}",
                serde_json::to_string_pretty(&lines).expect("plain data")
            );
        } else {
            for line in &lines {
                print_line(line);
            }
        }
        if lines.iter().all(|l| l.check.valid) {
            ExitCode::SUCCESS
        } else {
            ExitCode::FAILURE
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Line {
    file: String,
    id: String,
    naam: String,
    /// PO's that use it; `None` for a single file outside a data folder.
    used_by: Option<usize>,
    check: RubricCheck,
}

/// A file that is no rubric at all is an invalid line, so it does not hide the others (review
/// 21 n9).
fn line(file: String, value: Value, used_by: Option<usize>) -> Line {
    match serde_json::from_value::<Rubric>(value) {
        Ok(rubric) => Line {
            file,
            id: rubric.id.clone(),
            naam: rubric.naam.clone(),
            used_by,
            check: check_rubric(&rubric),
        },
        Err(e) => Line {
            file,
            id: String::new(),
            naam: "(geen rubric)".into(),
            used_by,
            check: RubricCheck {
                valid: false,
                errors: vec![format!("Geen rubric: {e}")],
                ..RubricCheck::default()
            },
        },
    }
}

fn check(target: &Path) -> Result<Vec<Line>, String> {
    if target.is_file() {
        let text = std::fs::read_to_string(target).map_err(|e| e.to_string())?;
        let value: Value = serde_json::from_str(&text).map_err(|e| format!("not JSON: {e}"))?;
        return Ok(vec![line(target.display().to_string(), value, None)]);
    }
    let storage = Storage::open(target).map_err(|e| e.to_string())?;
    let used = usage(&storage).map_err(|e| e.to_string())?;
    let dir = RelPath::parse(RUBRICS_DIR).map_err(|e| e.to_string())?;
    let mut lines = Vec::new();
    for (name, value) in storage
        .read_all_json_named(&dir)
        .map_err(|e| e.to_string())?
    {
        let id = value.get("id").and_then(Value::as_str).unwrap_or("");
        let n = used.get(id).map_or(0, Vec::len);
        lines.push(line(format!("{RUBRICS_DIR}/{name}"), value, Some(n)));
    }
    lines.sort_by(|a, b| a.file.cmp(&b.file));
    Ok(lines)
}

fn print_line(l: &Line) {
    let t = &l.check.totals;
    let mut head = format!(
        "{} ({}): {} categorieën, {} punten",
        l.naam, l.file, t.categories, t.normal
    );
    if t.bonus > 0.0 {
        head.push_str(&format!(" + {} bonus", t.bonus));
    }
    if t.diagnostic > 0.0 {
        head.push_str(&format!(", {} diagnostisch", t.diagnostic));
    }
    if let Some(n) = l.used_by {
        head.push_str(&format!(", in gebruik bij {n} PO('s)"));
    }
    println!("{head}");
    if l.check.valid {
        println!("  ok");
    }
    for e in &l.check.errors {
        println!("  fout: {e}");
    }
    for c in &l.check.categories {
        if !c.errors.is_empty() {
            println!("  fout in categorie {}: {}", c.id, c.errors.join(" · "));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_target_and_json() {
        assert_eq!(
            CheckArgs::parse(&["data", "--json"]).unwrap(),
            CheckArgs {
                target: "data".into(),
                json: true
            }
        );
        assert!(CheckArgs::parse(&[]).is_err());
        assert!(CheckArgs::parse(&["a", "b"]).is_err());
        assert!(CheckArgs::parse(&["--x"]).is_err());
    }

    #[test]
    fn a_folder_lists_every_rubric_with_its_use() {
        let tmp = tempfile::tempdir().unwrap();
        let data = tmp.path();
        std::fs::create_dir_all(data.join("rubrics")).unwrap();
        std::fs::create_dir_all(data.join("2025-2026/exams")).unwrap();
        std::fs::write(data.join("config.json"), r#"{"schema_version":3}"#).unwrap();
        let rubric = |id: &str, max: u32| {
            serde_json::json!({"id": id, "naam": id, "subject": "nat", "schoolsoort": ["Havo"],
                "jaarlagen": ["4"], "categories": [{"id": "a", "naam": "A", "max": max,
                "niveaus": [{"min": 0, "max": 1, "uitleg": "x"}, {"min": 2, "max": 3, "uitleg": "y"}]}]})
        };
        std::fs::write(data.join("rubrics/r1.json"), rubric("r1", 3).to_string()).unwrap();
        std::fs::write(data.join("rubrics/r2.json"), rubric("r2", 4).to_string()).unwrap();
        // Not a rubric at all: one invalid line, the others still listed (review 21 n9).
        std::fs::write(data.join("rubrics/r3.json"), r#"{"categories": "x"}"#).unwrap();
        std::fs::write(
            data.join("2025-2026/exams/p.json"),
            r#"{"id":"p","kind":"po","rubric_id":"r1"}"#,
        )
        .unwrap();
        let lines = check(data).unwrap();
        assert_eq!(lines.len(), 3);
        assert!(lines[0].check.valid);
        assert_eq!(lines[0].used_by, Some(1));
        assert!(!lines[1].check.valid);
        assert_eq!(lines[1].used_by, Some(0));
        assert!(!lines[2].check.valid);
        assert!(lines[2].check.errors[0].starts_with("Geen rubric"));
        let one = check(&data.join("rubrics/r2.json")).unwrap();
        assert_eq!(one[0].used_by, None);
        assert_eq!(one[0].check.categories[0].gaps, vec![(4, 4)]);
    }
}
