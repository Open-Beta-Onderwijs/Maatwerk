// SPDX-License-Identifier: AGPL-3.0-or-later
//! The list-screen numbers against the committed golden (review 38 M2). The MockApi mirror is
//! checked against the same files by `ui/tests/numbers-golden.test.ts`, so Rust and the mirror
//! cannot drift apart unnoticed. Regenerate with `node tools/numbers-golden.mjs`.

use std::fs;
use std::path::{Path, PathBuf};

use maatwerk_core::numbers::vak_numbers;
use maatwerk_core::storage::Storage;
use serde_json::{Value, json};

fn golden() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/numbers")
}

fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

fn format(code: &str) -> Value {
    let methode = if code.starts_with('a') {
        "afronden"
    } else {
        "afkappen"
    };
    json!({ "methode": methode, "decimalen": code[1..].parse::<u8>().unwrap() })
}

/// The JSON pointers where `actual` differs from `expected`, with both values: a failure on one
/// CI platform must say what differs, not only that something does.
fn diff(path: &str, expected: &Value, actual: &Value, out: &mut Vec<String>) {
    match (expected, actual) {
        (Value::Object(e), Value::Object(a)) => {
            let mut keys: Vec<&String> = e.keys().chain(a.keys()).collect();
            keys.sort();
            keys.dedup();
            for k in keys {
                let (ev, av) = (
                    e.get(k).unwrap_or(&Value::Null),
                    a.get(k).unwrap_or(&Value::Null),
                );
                diff(&format!("{path}/{k}"), ev, av, out);
            }
        }
        (Value::Array(e), Value::Array(a)) if e.len() == a.len() => {
            for (i, (ev, av)) in e.iter().zip(a).enumerate() {
                diff(&format!("{path}/{i}"), ev, av, out);
            }
        }
        _ if expected != actual => out.push(format!("  {path}: expected {expected}, got {actual}")),
        _ => {}
    }
}

#[test]
fn numbers_match_the_golden_at_every_format() {
    let mut checked = 0;
    for case in fs::read_dir(golden().join("expected")).unwrap() {
        let case = case.unwrap().path();
        let name = case.file_name().unwrap().to_string_lossy().into_owned();
        let (r, se) = name.split_once('-').unwrap();

        let tmp = tempfile::tempdir().unwrap();
        let data = tmp.path().join("data");
        copy_dir(&golden().join("data"), &data);
        let settings = data.join("instellingen.json");
        let mut inst: Value =
            serde_json::from_str(&fs::read_to_string(&settings).unwrap()).unwrap();
        inst["gemiddelden"] = json!({ "r": format(r), "se": format(se) });
        fs::write(&settings, inst.to_string()).unwrap();
        let storage = Storage::open_with_lock_dir(&data, &tmp.path().join("locks")).unwrap();

        for file in fs::read_dir(&case).unwrap() {
            let file = file.unwrap().path();
            let stem = file.file_stem().unwrap().to_string_lossy().into_owned();
            // `<yyyy>-<yyyy>-<vak>`
            let (year, vak) = stem.split_at(9);
            let vak = &vak[1..];
            let expected: Value =
                serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
            let actual = serde_json::to_value(vak_numbers(&storage, year, vak).unwrap()).unwrap();
            if actual != expected {
                let mut diffs = vec![];
                diff("", &expected, &actual, &mut diffs);
                panic!(
                    "{name} {stem} differs from the golden ({} places):\n{}",
                    diffs.len(),
                    diffs
                        .iter()
                        .take(40)
                        .cloned()
                        .collect::<Vec<_>>()
                        .join("\n")
                );
            }
            checked += 1;
        }
    }
    assert!(checked >= 2, "golden cases missing");
}
