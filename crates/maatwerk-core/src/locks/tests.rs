// SPDX-License-Identifier: AGPL-3.0-or-later

use serde_json::json;

use super::*;
use crate::storage::Expect;

pub(super) fn setup() -> (tempfile::TempDir, Storage) {
    let tmp = tempfile::tempdir().unwrap();
    let storage =
        Storage::open_with_lock_dir(tmp.path().join("data"), &tmp.path().join("locks")).unwrap();
    (tmp, storage)
}

pub(super) fn put(s: &Storage, rel: &str, value: serde_json::Value) {
    s.write_json(&RelPath::parse(rel).unwrap(), &value, Expect::Any)
        .unwrap();
}

#[test]
fn has_data_counts_scores_n_overrides_observaties_and_po() {
    let e = "e1";
    assert!(!has_data(&json!({}), e));
    assert!(!has_data(&json!({ "scores": { "e1": {} } }), e));
    assert!(!has_data(&json!({ "scores": { "e2": { "q1": 1 } } }), e));
    assert!(has_data(&json!({ "scores": { "e1": { "q1": 0 } } }), e));
    // "N" (niet gemaakt) is something the teacher entered.
    assert!(has_data(&json!({ "scores": { "e1": { "q1": "N" } } }), e));
    assert!(!has_data(&json!({ "overrides": { "e1": null } }), e));
    assert!(has_data(
        &json!({ "overrides": { "e1": { "cijfer": 6 } } }),
        e
    ));
    assert!(!has_data(&json!({ "observations": { "e1": [] } }), e));
    assert!(has_data(&json!({ "observations": { "e1": ["o1"] } }), e));
    assert!(!has_data(&json!({ "po": { "e1": {} } }), e));
    assert!(has_data(&json!({ "po": { "e1": { "ownLines": [] } } }), e));
    assert!(has_any_data(&json!({ "po": { "e9": { "x": 1 } } })));
    assert!(!has_any_data(
        &json!({ "scores": { "e9": {} }, "student_id": "1" })
    ));
}

#[test]
fn exam_and_student_data_come_from_the_score_folder() {
    let (_t, s) = setup();
    put(
        &s,
        "2025-2026/scores/nat/101.json",
        json!({ "scores": { "e1": { "q1": 2 } } }),
    );
    put(
        &s,
        "2025-2026/scores/nat/102.json",
        json!({ "scores": { "e1": {} } }),
    );
    put(
        &s,
        "2025-2026/scores/bio/103.json",
        json!({ "observations": { "b1": ["o"] } }),
    );
    assert!(exam_has_data(&s, "2025-2026", "nat", "e1").unwrap());
    assert!(!exam_has_data(&s, "2025-2026", "nat", "e2").unwrap());
    assert!(
        !exam_has_data(&s, "2026-2027", "nat", "e1").unwrap(),
        "no folder: no data"
    );
    let ids: Vec<String> = students_with_data(&s, "2025-2026")
        .unwrap()
        .into_iter()
        .collect();
    assert_eq!(ids, ["101", "103"]);
}

#[test]
fn an_unreadable_score_file_refuses_instead_of_counting_as_empty() {
    let (_t, s) = setup();
    let path = s
        .data_dir()
        .resolve(&RelPath::parse("2025-2026/scores/nat/101.json").unwrap())
        .unwrap();
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, b"{ half").unwrap();
    let err = exam_has_data(&s, "2025-2026", "nat", "e1").unwrap_err();
    assert_eq!(err.code(), "edit_locked");
    assert!(err.to_string().contains("onleesbaar"), "{err}");
}
