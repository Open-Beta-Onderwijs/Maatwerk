// SPDX-License-Identifier: AGPL-3.0-or-later

use std::fs;

use serde_json::json;

use super::*;
use crate::error::Error;

fn rel(s: &str) -> RelPath {
    RelPath::parse(s).unwrap()
}

fn setup() -> (tempfile::TempDir, Storage) {
    let tmp = tempfile::tempdir().unwrap();
    let mut storage =
        Storage::open_with_lock_dir(tmp.path().join("data"), &tmp.path().join("locks")).unwrap();
    storage.set_app_version(PO_MIN_APP_VERSION);
    storage
        .write_json(
            &rel("school.json"),
            &json!({"naam": "School", "minAppVersion": "0.9.0", "_meta": {"rev": 3}}),
            Expect::Any,
        )
        .unwrap();
    (tmp, storage)
}

fn rubric(id: &str) -> Value {
    json!({
        "id": id, "naam": "Onderzoeksverslag", "subject": "nat",
        "schoolsoort": ["Havo"], "jaarlagen": ["4"], "obs_ids": [],
        "categories": [
            {"id": "a", "naam": "Theorie", "max": 4, "soort": "normaal", "obs_ids": [],
             "niveaus": [{"min": 0, "max": 2, "uitleg": "x"}, {"min": 3, "max": 4, "uitleg": "y"}]},
            {"id": "b", "naam": "Extra", "max": 2, "soort": "bonus", "obs_ids": [],
             "niveaus": [{"min": 0, "max": 0, "uitleg": "x"}, {"min": 1, "max": 2, "uitleg": "y"}]}
        ]
    })
}

fn po_exam(year: &str, id: &str, rubric_id: &str) -> (RelPath, Value) {
    (
        rel(&format!("{year}/exams/{id}.json")),
        json!({"id": id, "naam": format!("PO {id}"), "subject": "nat", "kind": "po",
               "rubric_id": rubric_id}),
    )
}

fn min_version(s: &Storage) -> String {
    s.read_json(&rel("school.json")).unwrap().unwrap()["minAppVersion"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn message(e: Error) -> String {
    match e {
        Error::InvalidArgument { message } => message,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[test]
fn a_refused_write_raises_nothing() {
    // Review 21 m1: a CAS that will fail leaves minAppVersion alone.
    let (_t, s) = setup();
    let err = s
        .write_json(&rel("rubrics/r1.json"), &rubric("r1"), Expect::Hash("nope"))
        .unwrap_err();
    assert!(matches!(err, Error::Conflict { .. }), "{err:?}");
    let obs = json!({"id": "o1", "toetstypes": ["po"]});
    s.write_json(
        &rel("observaties/o1.json"),
        &json!({"id": "o1"}),
        Expect::Any,
    )
    .unwrap();
    let err = s
        .write_json(&rel("observaties/o1.json"), &obs, Expect::Missing)
        .unwrap_err();
    assert!(matches!(err, Error::Conflict { .. }), "{err:?}");
    assert_eq!(min_version(&s), "0.9.0");
}

#[test]
fn case_variants_of_the_path_are_guarded_too() {
    // Review 21 m4: Windows and macOS open Rubrics/X.JSON as rubrics/X.json.
    assert_eq!(rubric_id_of("Rubrics/r1.JSON"), Some("r1"));
    let (_t, s) = setup();
    let mut bad = rubric("r1");
    bad["categories"] = json!([]);
    let err = s
        .write_json(&rel("RUBRICS/r1.Json"), &bad, Expect::Missing)
        .unwrap_err();
    assert!(message(err).starts_with("Rubric niet opgeslagen"));
    s.write_json(
        &rel("Observaties/o1.json"),
        &json!({"id": "o1", "toetstypes": ["po"]}),
        Expect::Missing,
    )
    .unwrap();
    assert_eq!(min_version(&s), PO_MIN_APP_VERSION);
}

#[test]
fn an_unreadable_rubric_in_use_is_refused_clearly() {
    let (_t, s) = setup();
    let path = rel("rubrics/r1.json");
    s.write_json(
        &path,
        &json!({"id": "r1", "categories": "kapot"}),
        Expect::Any,
    )
    .unwrap_err(); // the guard refuses writing it ...
    fs::create_dir_all(s.data_dir().resolve(&rel("rubrics")).unwrap()).unwrap();
    fs::write(
        s.data_dir().resolve(&path).unwrap(),
        r#"{"id":"r1","categories":[{"id":"a","max":"x","soort":5,"niveaus":7}]}"#,
    )
    .unwrap(); // ... so it is written by hand
    let (exam_path, exam) = po_exam("2025-2026", "p1", "r1");
    s.write_json(&exam_path, &exam, Expect::Any).unwrap();
    let err = s.write_json(&path, &rubric("r1"), Expect::Any).unwrap_err();
    assert!(message(err).contains("onleesbaar"));
}

#[test]
fn rubric_path_and_exam_reference() {
    assert_eq!(rubric_id_of("rubrics/r1.json"), Some("r1"));
    assert_eq!(rubric_id_of("rubrics/.json"), None);
    assert_eq!(rubric_id_of("rubrics/a/b.json"), None);
    assert_eq!(rubric_id_of("observaties/r1.json"), None);
    assert_eq!(exam_rubric_id(&json!({"rubric_id": "r"})), Some("r"));
    assert_eq!(exam_rubric_id(&json!({"rubric_id": ""})), None);
    assert_eq!(exam_rubric_id(&json!({})), None);
}

#[test]
fn the_first_rubric_raises_the_minimum_app_version() {
    let (_t, s) = setup();
    s.write_json(&rel("rubrics/r1.json"), &rubric("r1"), Expect::Missing)
        .unwrap();
    assert_eq!(min_version(&s), PO_MIN_APP_VERSION);
    let school = s.read_json(&rel("school.json")).unwrap().unwrap();
    assert_eq!(school["_meta"]["rev"], json!(4));
    assert_eq!(school["_meta"]["updatedBy"], Value::Null);
    assert_eq!(school["naam"], json!("School"), "the rest is kept");
}

#[test]
fn a_higher_minimum_is_kept() {
    let (_t, mut s) = setup();
    s.set_app_version("0.20.0");
    s.write_json(
        &rel("school.json"),
        &json!({"minAppVersion": "0.15.0"}),
        Expect::Any,
    )
    .unwrap();
    s.write_json(&rel("rubrics/r1.json"), &rubric("r1"), Expect::Missing)
        .unwrap();
    assert_eq!(min_version(&s), "0.15.0");
}

#[test]
fn only_po_observaties_raise_the_minimum() {
    let (_t, s) = setup();
    let obs = |t: Value| json!({"id": "o1", "naam": "x", "toetstypes": t});
    s.write_json(
        &rel("observaties/o1.json"),
        &obs(json!(["toets"])),
        Expect::Any,
    )
    .unwrap();
    s.write_json(
        &rel("observaties/o1.json"),
        &json!({"id": "o1"}),
        Expect::Any,
    )
    .unwrap();
    assert_eq!(min_version(&s), "0.9.0");
    s.write_json(
        &rel("observaties/o1.json"),
        &obs(json!(["toets", "po"])),
        Expect::Any,
    )
    .unwrap();
    assert_eq!(min_version(&s), PO_MIN_APP_VERSION);
}

#[test]
fn an_older_app_cannot_write_after_the_raise() {
    let (_t, mut s) = setup();
    s.write_json(&rel("rubrics/r1.json"), &rubric("r1"), Expect::Missing)
        .unwrap();
    s.set_app_version("0.11.0");
    let err = s
        .write_json(
            &rel("observaties/o1.json"),
            &json!({"id": "o1"}),
            Expect::Any,
        )
        .unwrap_err();
    assert!(matches!(err, Error::ReadOnly { .. }), "{err:?}");
}

#[test]
fn an_invalid_rubric_is_refused_and_nothing_changes() {
    let (_t, s) = setup();
    let mut bad = rubric("r1");
    bad["naam"] = json!("");
    bad["categories"][0]["niveaus"][1]["min"] = json!(0);
    bad["categories"][1]["niveaus"][1]["min"] = json!(2);
    let err = s
        .write_json(&rel("rubrics/r1.json"), &bad, Expect::Missing)
        .unwrap_err();
    assert_eq!(
        message(err),
        "Rubric niet opgeslagen: Geef de rubric een naam; Theorie: Twee niveaus beginnen bij 0; \
         Extra: Niet gedekt: 1"
    );
    assert!(s.read_json(&rel("rubrics/r1.json")).unwrap().is_none());
    assert_eq!(min_version(&s), "0.9.0", "a refused rubric raises nothing");
}

#[test]
fn the_id_must_match_the_file() {
    let (_t, s) = setup();
    let err = s
        .write_json(&rel("rubrics/r2.json"), &rubric("r1"), Expect::Missing)
        .unwrap_err();
    assert_eq!(
        message(err),
        "Rubric niet opgeslagen: het id hoort r2 te zijn"
    );
}

#[test]
fn usage_counts_exams_in_every_year() {
    let (_t, s) = setup();
    for (year, id, r) in [
        ("2024-2025", "p1", "r1"),
        ("2025-2026", "p2", "r1"),
        ("2025-2026", "p3", "r2"),
    ] {
        let (path, exam) = po_exam(year, id, r);
        s.write_json(&path, &exam, Expect::Any).unwrap();
    }
    let (path, _) = po_exam("2025-2026", "t1", "");
    s.write_json(&path, &json!({"id": "t1", "kind": "toets"}), Expect::Any)
        .unwrap();
    let u = usage(&s).unwrap();
    assert_eq!(u.len(), 2);
    assert_eq!(
        u["r1"]
            .iter()
            .map(|x| x.exam_id.as_str())
            .collect::<Vec<_>>(),
        ["p2", "p1"],
        "newest year first"
    );
    assert_eq!(u["r1"][0].naam, "PO p2");
    assert_eq!(u["r2"][0].year, "2025-2026");
}

#[test]
fn a_rubric_in_use_keeps_max_and_soort_but_names_and_levels_change() {
    let (_t, s) = setup();
    let path = rel("rubrics/r1.json");
    s.write_json(&path, &rubric("r1"), Expect::Missing).unwrap();
    let (exam_path, exam) = po_exam("2025-2026", "p1", "r1");
    s.write_json(&exam_path, &exam, Expect::Any).unwrap();

    let mut ok = rubric("r1");
    ok["naam"] = json!("Verslag");
    ok["categories"][0]["naam"] = json!("Kennis");
    ok["categories"][0]["niveaus"][0]["titel"] = json!("Onvoldoende");
    s.write_json(&path, &ok, Expect::Any).unwrap();

    let mut locked = ok.clone();
    locked["categories"][0]["max"] = json!(5);
    locked["categories"][0]["niveaus"][1]["max"] = json!(5);
    locked["categories"][1]["soort"] = json!("diagnostisch");
    let err = s.write_json(&path, &locked, Expect::Any).unwrap_err();
    assert_eq!(
        message(err),
        "Rubric niet opgeslagen: in gebruik bij 1 PO, dus maxima en soort liggen vast. \
         Het maximum van \"Kennis\" is gewijzigd (4 → 5); \
         De soort van \"Extra\" is gewijzigd (Bonus → Diagnostisch)"
    );
    assert_eq!(
        s.read_json(&path).unwrap().unwrap()["naam"],
        json!("Verslag")
    );

    // Not in use any more: free again.
    s.delete(&exam_path).unwrap();
    s.write_json(&path, &locked, Expect::Any).unwrap();
}

#[test]
fn a_rubric_in_use_cannot_be_deleted() {
    let (_t, s) = setup();
    let path = rel("rubrics/r1.json");
    s.write_json(&path, &rubric("r1"), Expect::Missing).unwrap();
    for id in ["p1", "p2"] {
        let (exam_path, exam) = po_exam("2025-2026", id, "r1");
        s.write_json(&exam_path, &exam, Expect::Any).unwrap();
    }
    let err = s.delete(&path).unwrap_err();
    assert_eq!(
        message(err),
        "Deze rubric is in gebruik bij 2 PO's en kan niet verwijderd worden"
    );
    assert!(s.read_json(&path).unwrap().is_some());
    for id in ["p1", "p2"] {
        s.delete(&po_exam("2025-2026", id, "r1").0).unwrap();
    }
    s.delete(&path).unwrap();
    assert!(s.read_json(&path).unwrap().is_none());
}

#[test]
fn without_school_json_a_rubric_is_still_saved() {
    let tmp = tempfile::tempdir().unwrap();
    let mut s =
        Storage::open_with_lock_dir(tmp.path().join("data"), &tmp.path().join("locks")).unwrap();
    s.set_app_version(PO_MIN_APP_VERSION);
    s.write_json(&rel("rubrics/r1.json"), &rubric("r1"), Expect::Missing)
        .unwrap();
    assert!(!tmp.path().join("data").join("school.json").exists());
    assert!(fs::metadata(tmp.path().join("data/rubrics/r1.json")).is_ok());
}
