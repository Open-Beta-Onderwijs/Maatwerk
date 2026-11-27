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

fn rel(s: &str) -> RelPath {
    RelPath::parse(s).unwrap()
}

fn locked(r: Result<impl std::fmt::Debug>) -> String {
    match r {
        Err(Error::EditLocked { message, .. }) => message,
        other => panic!("expected edit_locked, got {other:?}"),
    }
}

const STUDENTS: &str = "2025-2026/students-2025-2026.json";

fn students(ids: &[&str]) -> serde_json::Value {
    json!({ "students": ids.iter().map(|id| json!({ "id": id, "voornaam": id })).collect::<Vec<_>>() })
}

/// 2.1: a student with data in the year, or in a group of the year, cannot be removed.
#[test]
fn students_with_data_or_a_group_cannot_be_removed() {
    let (_t, s) = setup();
    put(&s, STUDENTS, students(&["101", "102", "103"]));
    put(
        &s,
        "2025-2026/scores/nat/101.json",
        json!({ "scores": { "e1": { "q1": 1 } } }),
    );
    put(
        &s,
        "2025-2026/groups/g1.json",
        json!({ "id": "g1", "student_ids": ["102"] }),
    );
    let msg = locked(s.write_json(&rel(STUDENTS), &students(&["102", "103"]), Expect::Any));
    assert!(msg.contains("101") && msg.contains("scores"), "{msg}");
    let msg = locked(s.write_json(&rel(STUDENTS), &students(&["101", "103"]), Expect::Any));
    assert!(msg.contains("102") && msg.contains("groep"), "{msg}");
    // Without data and not in a group: fine; editing a name too.
    s.write_json(&rel(STUDENTS), &students(&["101", "102"]), Expect::Any)
        .unwrap();
}

const GROUP: &str = "2025-2026/groups/g1.json";

fn group(name: &str, jaarlaag: &str, ids: &[&str]) -> serde_json::Value {
    json!({ "id": "g1", "name": name, "jaarlaag": jaarlaag, "schoolsoort": ["havo"],
            "subject": "nat", "student_ids": ids, "docenten": [] })
}

/// 2.2: a group with students keeps its name, jaarlaag, schoolsoort and vak, and cannot go.
#[test]
fn a_group_with_students_keeps_its_fields_and_stays() {
    let (_t, s) = setup();
    put(&s, GROUP, group("3a", "3", &["101"]));
    locked(s.write_json(&rel(GROUP), &group("3b", "3", &["101"]), Expect::Any));
    locked(s.write_json(&rel(GROUP), &group("3a", "4", &["101"]), Expect::Any));
    let mut vak = group("3a", "3", &["101"]);
    vak["subject"] = json!("bio");
    locked(s.write_json(&rel(GROUP), &vak, Expect::Any));
    locked(s.delete(&rel(GROUP)));
    // The composition and the teachers may change (the voorzitter's job).
    let mut more = group("3a", "3", &["101", "102"]);
    more["docenten"] = json!(["t1"]);
    s.write_json(&rel(GROUP), &more, Expect::Any).unwrap();
    // Empty again: everything is free.
    s.write_json(&rel(GROUP), &group("3a", "3", &[]), Expect::Any)
        .unwrap();
    s.write_json(&rel(GROUP), &group("3b", "4", &[]), Expect::Any)
        .unwrap();
    s.delete(&rel(GROUP)).unwrap();
}

/// A restore from a snapshot is a repair: the edit locks do not apply.
#[test]
fn a_restore_skips_the_edit_locks() {
    let (_t, s) = setup();
    put(&s, GROUP, group("3a", "3", &["101"]));
    unlocked(|| s.write_json(&rel(GROUP), &group("3b", "3", &["101"]), Expect::Any)).unwrap();
}
