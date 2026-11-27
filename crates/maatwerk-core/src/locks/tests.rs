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

// ── Exams and families (2.3, 2.4, decision 5) ──────────────────────────────────────────────

const Y: &str = "2025-2026";

fn exam(id: &str, parent: Option<&str>) -> serde_json::Value {
    json!({ "id": id, "title": id, "subject": "nat", "kind": "test", "jaarlaag": "3",
            "schoolsoort": ["havo"], "type": "regular", "diagnostic": false, "weging": 1,
            "weging_se": 1, "periode": "1", "parent_id": parent, "obs_ids": ["o1"],
            "questions": [{ "id": "q1" }, { "id": "q2" }] })
}

fn exam_rel(id: &str) -> RelPath {
    rel(&format!("{Y}/exams/{id}.json"))
}

fn put_score(s: &Storage, student: &str, exam: &str) {
    put(
        s,
        &format!("{Y}/scores/nat/{student}.json"),
        json!({ "scores": { exam: { "q1": 1 } } }),
    );
}

/// 2.3, 10 m6: an exam with data or with herkansingen is not deleted; a question with data stays.
#[test]
fn an_exam_with_data_or_attempts_is_not_deleted_and_keeps_its_questions() {
    let (_t, s) = setup();
    put(&s, exam_rel("e1").as_str(), exam("e1", None));
    put(&s, exam_rel("e2").as_str(), exam("e2", None));
    put(&s, exam_rel("e2h").as_str(), exam("e2h", Some("e2")));
    put_score(&s, "101", "e1");
    let msg = locked(s.delete(&exam_rel("e1")));
    assert!(msg.contains("scores"), "{msg}");
    let msg = locked(s.delete(&exam_rel("e2")));
    assert!(msg.contains("herkansing"), "{msg}");
    let mut fewer = exam("e1", None);
    fewer["questions"] = json!([{ "id": "q1" }]);
    let msg = locked(s.write_json(&exam_rel("e1"), &fewer, Expect::Any));
    assert!(msg.contains("vraag"), "{msg}");
    // Adding a question, changing a title: fine.
    let mut more = exam("e1", None);
    more["questions"] = json!([{ "id": "q1" }, { "id": "q2" }, { "id": "q3" }]);
    more["title"] = json!("Toets 1");
    s.write_json(&exam_rel("e1"), &more, Expect::Any).unwrap();
    // Without data the questions are free, and so is deleting.
    let mut none = exam("e3", None);
    put(&s, exam_rel("e3").as_str(), none.clone());
    none["questions"] = json!([]);
    s.write_json(&exam_rel("e3"), &none, Expect::Any).unwrap();
    s.delete(&exam_rel("e3")).unwrap();
}

fn po(id: &str, parent: Option<&str>) -> serde_json::Value {
    let mut e = exam(id, parent);
    e["kind"] = json!("po");
    e["rubric_id"] = json!("r1");
    e["questions"] = json!([]);
    e
}

/// Decision 8: a PO's jaarlaag, schoolsoort, subcategorie and rubric stay once its family has data.
#[test]
fn a_po_with_data_keeps_its_scope_and_rubric() {
    let (_t, s) = setup();
    put(&s, exam_rel("p1").as_str(), po("p1", None));
    put(&s, exam_rel("p1h").as_str(), po("p1h", Some("p1")));
    // Data on the herkansing locks the original too.
    put_score(&s, "101", "p1h");
    for (field, value) in [
        ("jaarlaag", json!("4")),
        ("schoolsoort", json!(["vwo"])),
        ("subcategory", json!("wisb")),
        ("rubric_id", json!("r2")),
    ] {
        let (mut changed, mut changed_h) = (po("p1", None), po("p1h", Some("p1")));
        changed[field] = value.clone();
        changed_h[field] = value;
        let msg = family_save(&s, vec![changed_h, changed]);
        assert!(msg.contains("scores"), "{field}: {msg}");
    }
    // Weging is not locked by data.
    let mut weging = po("p1", None);
    weging["weging"] = json!(2);
    let mut weging_h = po("p1h", Some("p1"));
    weging_h["weging"] = json!(2);
    save_exam_family(
        &s,
        Y,
        &[weging_h, weging],
        None,
        std::time::SystemTime::now(),
    )
    .unwrap();
}

fn family_save(s: &Storage, exams: Vec<serde_json::Value>) -> String {
    locked(save_exam_family(
        s,
        Y,
        &exams,
        None,
        std::time::SystemTime::now(),
    ))
}

/// Decision 5: family fields change for the whole family at once, through save_exam_family.
#[test]
fn family_fields_change_only_for_the_whole_family() {
    let (_t, s) = setup();
    put(&s, exam_rel("e1").as_str(), exam("e1", None));
    put(&s, exam_rel("e1h").as_str(), exam("e1h", Some("e1")));
    // A direct write of one member that changes a family field is refused.
    let mut orig = exam("e1", None);
    orig["weging"] = json!(2);
    let msg = locked(s.write_json(&exam_rel("e1"), &orig, Expect::Any));
    assert!(msg.contains("verzamelkaart"), "{msg}");
    let mut att = exam("e1h", Some("e1"));
    att["periode"] = json!("2");
    locked(s.write_json(&exam_rel("e1h"), &att, Expect::Any));
    // The family save needs every member, agreeing.
    let msg = family_save(&s, vec![orig.clone()]);
    assert!(msg.contains("e1h"), "{msg}");
    let msg = family_save(&s, vec![exam("e1h", Some("e1")), orig.clone()]);
    assert!(msg.contains("weging"), "{msg}");
    let mut att2 = exam("e1h", Some("e1"));
    att2["weging"] = json!(2);
    let saved = save_exam_family(
        &s,
        Y,
        &[att2, orig],
        Some("t1"),
        std::time::SystemTime::now(),
    )
    .unwrap();
    assert_eq!(saved.len(), 2);
    for id in ["e1", "e1h"] {
        let disk = s.read_json(&exam_rel(id)).unwrap().unwrap();
        assert_eq!(disk["weging"], json!(2), "{id}");
        assert_eq!(disk["_meta"]["updatedBy"], json!("t1"));
    }
    // Other fields of one member stay free: a title, the n-term, questions.
    let mut title = s.read_json(&exam_rel("e1h")).unwrap().unwrap();
    title["title"] = json!("Herkansing");
    s.write_json(&exam_rel("e1h"), &title, Expect::Any).unwrap();
}

/// Decision 5 (F-12): an attempt keeps every observatie of its original, never gains its own;
/// the original's observaties change through the family save.
#[test]
fn attempts_follow_the_originals_observaties() {
    let (_t, s) = setup();
    put(&s, exam_rel("e1").as_str(), exam("e1", None));
    let mut old_own = exam("e1h", Some("e1"));
    old_own["obs_ids"] = json!(["o1", "eigen"]); // from before format v3: may stay
    unlocked(|| s.write_json(&exam_rel("e1h"), &old_own, Expect::Any)).unwrap();
    let mut gains = old_own.clone();
    gains["obs_ids"] = json!(["o1", "eigen", "o9"]);
    locked(s.write_json(&exam_rel("e1h"), &gains, Expect::Any));
    let mut drops = old_own.clone();
    drops["obs_ids"] = json!(["eigen"]);
    locked(s.write_json(&exam_rel("e1h"), &drops, Expect::Any));
    let mut orig = exam("e1", None);
    orig["obs_ids"] = json!(["o1", "o2"]);
    locked(s.write_json(&exam_rel("e1"), &orig, Expect::Any));
    let mut follows = old_own.clone();
    follows["obs_ids"] = json!(["o1", "eigen", "o2"]);
    save_exam_family(&s, Y, &[follows, orig], None, std::time::SystemTime::now()).unwrap();
    // A new attempt is a copy of its original.
    let mut new_att = exam("e1h2", Some("e1"));
    new_att["obs_ids"] = json!(["o1", "o2"]);
    s.write_json(&exam_rel("e1h2"), &new_att, Expect::Missing)
        .unwrap();
    let mut wrong = exam("e1h3", Some("e1"));
    wrong["weging"] = json!(5);
    wrong["obs_ids"] = json!(["o1", "o2"]);
    locked(s.write_json(&exam_rel("e1h3"), &wrong, Expect::Missing));
}

// ── Observaties (2.6, decisions 12, 13) ───────────────────────────────────────────────────

const OBS: &str = "observaties/o1.json";

fn obs(
    jaarlagen: &[&str],
    schoolsoort: &[&str],
    subjects: &[&str],
    tt: &[&str],
) -> serde_json::Value {
    json!({ "id": "o1", "naam": "Rekenfout", "jaarlagen": jaarlagen, "schoolsoort": schoolsoort,
            "subjects": subjects, "toetstypes": tt })
}

/// Decision 13 and 2.6: an observatie a test, a rubric or an opdracht links is not deleted.
#[test]
fn a_linked_observatie_is_not_deleted() {
    let (_t, s) = setup();
    put(&s, OBS, obs(&["3"], &[], &["nat"], &["toets", "po"]));
    s.delete(&rel(OBS)).unwrap();
    for (file, link) in [
        (
            format!("{Y}/exams/e1.json"),
            json!({ "id": "e1", "title": "Toets 1", "subject": "nat",
            "jaarlaag": "3", "schoolsoort": ["havo"], "obs_ids": ["o1"] }),
        ),
        (
            "rubrics/r1.json".to_owned(),
            json!({ "id": "r1", "naam": "Verslag",
            "categories": [{ "id": "c", "obs_ids": ["o1"] }] }),
        ),
        (
            "opdrachten/op1/opdracht.json".to_owned(),
            json!({ "id": "op1", "naam": "Breuken",
            "observaties": ["o1"] }),
        ),
    ] {
        put(&s, OBS, obs(&["3"], &[], &["nat"], &["toets", "po"]));
        // Written raw: a fixture, not a rubric the guard would check.
        let path = s.data_dir().resolve(&rel(&file)).unwrap();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, serde_json::to_vec(&link).unwrap()).unwrap();
        let msg = locked(s.delete(&rel(OBS)));
        let named = ["Toets 1", "Verslag", "Breuken"]
            .iter()
            .any(|n| msg.contains(n));
        assert!(named, "{msg}");
        std::fs::remove_file(&path).unwrap();
    }
}

/// Decision 12: a jaarlaag, schoolsoort or vak a linked test or rubric uses stays; toetstype
/// Toets stays while a test uses it, PO while a rubric does.
#[test]
fn a_linked_observatie_keeps_what_its_tests_and_rubrics_use() {
    let (_t, s) = setup();
    put(
        &s,
        OBS,
        obs(
            &["3", "4"],
            &["havo", "vwo"],
            &["nat", "bio"],
            &["toets", "po"],
        ),
    );
    put(
        &s,
        &format!("{Y}/exams/e1.json"),
        json!({ "id": "e1", "title": "Toets 1",
        "subject": "nat", "jaarlaag": "3", "schoolsoort": ["havo"], "obs_ids": ["o1"] }),
    );
    let write = |v: serde_json::Value| s.write_json(&rel(OBS), &v, Expect::Any);
    locked(write(obs(
        &["4"],
        &["havo", "vwo"],
        &["nat", "bio"],
        &["toets", "po"],
    )));
    locked(write(obs(
        &["3", "4"],
        &["vwo"],
        &["nat", "bio"],
        &["toets", "po"],
    )));
    locked(write(obs(
        &["3", "4"],
        &["havo", "vwo"],
        &["bio"],
        &["toets", "po"],
    )));
    locked(write(obs(
        &["3", "4"],
        &["havo", "vwo"],
        &["nat", "bio"],
        &["po"],
    )));
    // What no link uses is free; so is widening (empty schoolsoort means all).
    write(obs(&["3", "5"], &[], &["nat"], &["toets"])).unwrap();
    // From "all schoolsoorten" to a list without the test's one is a narrowing too.
    locked(write(obs(&["3", "5"], &["vwo"], &["nat"], &["toets"])));
    // No jaarlagen means all of them, as in the Observaties tab's filters.
    write(obs(&[], &[], &["nat"], &["toets"])).unwrap();
    locked(write(obs(&["4"], &[], &["nat"], &["toets"])));
}

/// A wiskunde test (`subject: "wi"`) fits an observatie with any wiskunde variant, as the test
/// editor offers it (`obsMatchesSubject`): one variant may go, not the last one.
#[test]
fn a_wiskunde_test_keeps_one_wiskunde_variant() {
    let (_t, s) = setup();
    put(&s, OBS, obs(&["3"], &[], &["wisob", "wisa"], &["toets"]));
    put(
        &s,
        &format!("{Y}/exams/e1.json"),
        json!({ "id": "e1", "title": "Toets 1",
        "subject": "wi", "jaarlaag": "3", "schoolsoort": ["havo"], "obs_ids": ["o1"] }),
    );
    let write = |v: serde_json::Value| s.write_json(&rel(OBS), &v, Expect::Any);
    write(obs(&["3"], &[], &["wisob"], &["toets"])).unwrap();
    let msg = locked(write(obs(&["3"], &[], &["nat"], &["toets"])));
    assert!(msg.contains("vak wi"), "{msg}");
}
