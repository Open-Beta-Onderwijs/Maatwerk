// SPDX-License-Identifier: AGPL-3.0-or-later

//! `maatwerk-cli stats` end to end, on a small synthetic data folder.

use std::path::Path;
use std::process::{Command, Output};

use serde_json::{Value, json};

fn write(path: &Path, value: &Value) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, value.to_string()).unwrap();
}

fn exam(id: &str, extra: Value) -> Value {
    let mut v = json!({
        "id": id, "subject": "nat", "n_term": 1,
        "questions": [{"id": "q1", "max_points": 10, "rtti": "R"}]
    });
    v.as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    v
}

/// Year 2024-2025: a PTA. Year 2025-2026: toets 1 with a herkansing, a PTA, a test of another vak.
fn data_folder(root: &Path) {
    let old = root.join("2024-2025");
    let new = root.join("2025-2026");
    write(
        &old.join("exams/p0.json"),
        &exam(
            "p0",
            json!({"type": "pta", "weging_se": 1, "volgnummer": 401}),
        ),
    );
    write(
        &old.join("scores/nat/1.json"),
        &json!({"overrides": {"p0": {"cijfer": 6.0}}}),
    );
    write(
        &new.join("exams/t1.json"),
        &exam("t1", json!({"weging": 1, "volgnummer": 501})),
    );
    write(
        &new.join("exams/t1h.json"),
        &exam(
            "t1h",
            json!({"parent_id": "t1", "attempt": 2, "weging": 1, "volgnummer": 501}),
        ),
    );
    write(
        &new.join("exams/p1.json"),
        &exam(
            "p1",
            json!({"type": "pta", "weging": 2, "weging_se": 3, "volgnummer": 502}),
        ),
    );
    let mut bio = exam("b1", json!({}));
    bio["subject"] = json!("bio");
    write(&new.join("exams/b1.json"), &bio);
    write(
        &new.join("scores/nat/1.json"),
        &json!({
            "scores": {"t1": {"q1": 4}, "t1h": {"q1": 6}},
            "overrides": {"p1": {"cijfer": 7.0}}
        }),
    );
    write(
        &new.join("scores/nat/2.json"),
        &json!({"scores": {"t1": {"q1": 10}}}),
    );
}

fn run(args: &[&str], data: &Path) -> Output {
    Command::new(env!("CARGO_BIN_EXE_maatwerk-cli"))
        .arg("stats")
        .arg(data)
        .args(args)
        .output()
        .unwrap()
}

#[test]
fn json_report_has_the_right_numbers() {
    let dir = tempfile::tempdir().unwrap();
    data_folder(dir.path());
    let out = run(
        &["--year", "2025-2026", "--vak", "nat", "--json"],
        dir.path(),
    );
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let report: Value = serde_json::from_slice(&out.stdout).unwrap();

    let tests = report["tests"].as_array().unwrap();
    assert_eq!(tests.len(), 2, "the bio test is left out");
    let t1 = tests.iter().find(|t| t["id"] == "t1").unwrap();
    // Student 1: original 4/10 = 4,6, herkansing 6/10 = 6,4. Student 2: 10/10 = 10,0.
    assert_eq!(t1["attempts"][0]["attempt"]["mean"], json!(7.3));
    assert_eq!(t1["best"]["n"], json!(2));
    assert_eq!(t1["best"]["mean"], json!(8.2));

    let s1 = &report["students"][0];
    assert_eq!(s1["id"], json!("1"));
    // Year: (1 x 6,4 + 2 x 7,0) / 3 = 6,8. SE over both years: (1 x 6,0 + 3 x 7,0) / 4 = 6,75.
    assert!((s1["yearAverage"].as_f64().unwrap() - 6.8).abs() < 1e-9);
    assert_eq!(s1["seAverage"], json!(6.75));
    // Most recent is p1: 7,0 - 6,8 = +0,2.
    assert_eq!(s1["trend"]["level"], json!("level"));
}

#[test]
fn text_report_uses_decimal_commas_and_student_numbers_only() {
    let dir = tempfile::tempdir().unwrap();
    data_folder(dir.path());
    let out = run(&["--year", "2025-2026", "--vak", "nat"], dir.path());
    assert!(out.status.success());
    let text = String::from_utf8(out.stdout).unwrap();
    assert!(text.contains("mean 7,3"), "{text}");
    assert!(text.contains("1: year 6,8 se 6,8"), "{text}");
}

#[test]
fn an_unknown_year_fails() {
    let dir = tempfile::tempdir().unwrap();
    data_folder(dir.path());
    let out = run(&["--year", "1999-2000", "--vak", "nat"], dir.path());
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("1999-2000"));
}

#[test]
fn it_writes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    data_folder(dir.path());
    let listing = |p: &Path| -> Vec<(String, u64)> {
        let mut all = Vec::new();
        let mut stack = vec![p.to_path_buf()];
        while let Some(d) = stack.pop() {
            for e in std::fs::read_dir(d).unwrap().map(Result::unwrap) {
                if e.path().is_dir() {
                    stack.push(e.path());
                } else {
                    all.push((e.path().display().to_string(), e.metadata().unwrap().len()));
                }
            }
        }
        all.sort();
        all
    };
    let before = listing(dir.path());
    run(&["--year", "2025-2026", "--vak", "nat"], dir.path());
    assert_eq!(listing(dir.path()), before);
}
