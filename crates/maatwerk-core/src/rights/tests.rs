// SPDX-License-Identifier: AGPL-3.0-or-later

use serde_json::{Value, json};

use super::*;
use crate::storage::Expect;

const Y: &str = "2025-2026";

/// Teachers A (`gebr-a`) and B (`gebr-b`) of nat, voorzitter V (`gebr-v`), secretaris S
/// (`gebr-s`), the admin. Groups: 4a (A: students 1, 2), 4b (B: 3, 4), 4c (no teacher: 5).
/// A test `t1` (obs o1, o2) and a PO `p1` with projectgroepen g1 = {1, 3}, g2 = {4}, g3 = {5}.
fn setup() -> (tempfile::TempDir, Storage) {
    let tmp = tempfile::tempdir().unwrap();
    let s =
        Storage::open_with_lock_dir(tmp.path().join("data"), &tmp.path().join("locks")).unwrap();
    let put = |rel: &str, v: Value| {
        s.write_json(&RelPath::parse(rel).unwrap(), &v, Expect::Any)
            .unwrap();
    };
    for (id, admin) in [
        ("admin", true),
        ("gebr-a", false),
        ("gebr-b", false),
        ("gebr-v", false),
        ("gebr-s", false),
    ] {
        put(
            &format!("gebruikers/{id}.json"),
            json!({ "id": id, "isAdmin": admin, "actief": true, "vakken": ["nat"] }),
        );
    }
    put(
        "school.json",
        json!({ "naam": "S", "secties": { "nat": { "voorzitter": "gebr-v", "secretaris": "gebr-s" } } }),
    );
    for (id, docent, students) in [
        ("4a", Some("gebr-a"), vec!["1", "2"]),
        ("4b", Some("gebr-b"), vec!["3", "4"]),
        ("4c", None, vec!["5"]),
    ] {
        put(
            &format!("{Y}/groups/{id}.json"),
            json!({ "id": id, "subject": "nat", "docenten": docent.into_iter().collect::<Vec<_>>(),
                    "student_ids": students }),
        );
    }
    // A group of another vak taught by A that holds student 3: no right for nat.
    put(
        &format!("{Y}/groups/4b-bio.json"),
        json!({ "id": "4b-bio", "subject": "bio", "docenten": ["gebr-a"], "student_ids": ["3"] }),
    );
    put(
        &format!("{Y}/exams/t1.json"),
        json!({ "id": "t1", "kind": "toets", "subject": "nat", "obs_ids": ["o1", "o2"] }),
    );
    put(
        &format!("{Y}/exams/p1.json"),
        json!({ "id": "p1", "kind": "po", "subject": "nat", "projectgroepen": [
            { "id": "g1", "student_ids": ["1", "3"] },
            { "id": "g2", "student_ids": ["4"] },
            { "id": "g3", "student_ids": ["5"] } ] }),
    );
    (tmp, s)
}

fn session(user: &str, role: Role) -> Session {
    Session {
        user_id: user.to_owned(),
        role,
    }
}

fn score_rel(student: &str) -> RelPath {
    RelPath::parse(&format!("{Y}/scores/nat/{student}.json")).unwrap()
}

fn put_scores(s: &Storage, student: &str, v: Value) {
    s.write_json(&score_rel(student), &v, Expect::Any).unwrap();
}

fn check(s: &Storage, who: &Session, student: &str, new: Value) -> Result<()> {
    check_json_write(s, Some(who), &score_rel(student), Some(&new))
}

fn is_forbidden(r: Result<()>) -> bool {
    matches!(r, Err(Error::Forbidden { .. }))
}

#[test]
fn roles_parse_and_print() {
    for raw in ["docent", "beheer", "bestuur:nat"] {
        assert_eq!(Role::parse(raw).unwrap().as_string(), raw);
    }
    for bad in ["", "gast", "bestuur:", "bestuur:../x", "voorzitter:nat"] {
        assert!(Role::parse(bad).is_err(), "{bad}");
    }
}

#[test]
fn score_paths_are_recognised() {
    assert_eq!(
        score_file("2025-2026/scores/nat/900001.json"),
        Some(("2025-2026", "nat", "900001"))
    );
    assert_eq!(
        score_file("2025-2026/Scores/nat/9.JSON"),
        Some(("2025-2026", "nat", "9"))
    );
    for other in [
        "2025-2026/exams/t1.json",
        "2025-2026/scores/nat.json",
        "2025-2026/scores/nat/a/b.json",
        "school.json",
    ] {
        assert_eq!(score_file(other), None, "{other}");
    }
}

#[test]
fn a_teacher_changes_only_scores_of_own_students() {
    let (_t, s) = setup();
    let a = session("gebr-a", Role::Docent);
    let new = json!({ "student_id": "x", "scores": { "t1": { "q1": 3 } } });
    assert!(check(&s, &a, "1", new.clone()).is_ok());
    assert!(is_forbidden(check(&s, &a, "3", new.clone())));
    assert!(
        is_forbidden(check(&s, &a, "5", new.clone())),
        "a group without teacher"
    );
    let b = session("gebr-b", Role::Docent);
    assert!(check(&s, &b, "3", new.clone()).is_ok());
    assert!(is_forbidden(check(&s, &b, "1", new)));
}

#[test]
fn overrides_observaties_and_other_keys_are_locked_too() {
    let (_t, s) = setup();
    let a = session("gebr-a", Role::Docent);
    for new in [
        json!({ "overrides": { "t1": { "cijfer": 7.0, "berekend": null } } }),
        json!({ "observations": { "t1": ["o1"] } }),
        json!({ "extra": 1 }),
    ] {
        assert!(is_forbidden(check(&s, &a, "3", new.clone())), "{new}");
        assert!(check(&s, &a, "1", new).is_ok());
    }
}

#[test]
fn bookkeeping_and_unchanged_writes_pass() {
    let (_t, s) = setup();
    put_scores(
        &s,
        "3",
        json!({ "student_id": "3", "scores": { "t1": { "q1": 2 } } }),
    );
    let a = session("gebr-a", Role::Docent);
    let same = json!({ "student_id": "3", "scores": { "t1": { "q1": 2 } },
                       "_meta": { "updatedBy": "gebr-a" } });
    assert!(check(&s, &a, "3", same).is_ok());
}

#[test]
fn voorzitter_secretaris_and_admin_change_every_score_of_the_vak() {
    let (_t, s) = setup();
    let new = json!({ "scores": { "t1": { "q1": 1 } } });
    for who in [
        session("gebr-v", Role::Bestuur("nat".into())),
        session("gebr-s", Role::Bestuur("nat".into())),
        session("admin", Role::Beheer),
    ] {
        for student in ["1", "3", "5"] {
            assert!(check(&s, &who, student, new.clone()).is_ok(), "{who:?}");
        }
    }
    // Logged in as a plain teacher, the voorzitter has only their groups (none here).
    let v = session("gebr-v", Role::Docent);
    assert!(is_forbidden(check(&s, &v, "1", new.clone())));
    // Bestuur of another vak gives nothing for nat.
    let other = session("gebr-v", Role::Bestuur("bio".into()));
    assert!(is_forbidden(check(&s, &other, "1", new)));
}

#[test]
fn a_removed_secretaris_loses_the_right_at_once() {
    let (_t, s) = setup();
    let sec = session("gebr-s", Role::Bestuur("nat".into()));
    let new = json!({ "scores": { "t1": { "q1": 1 } } });
    assert!(check(&s, &sec, "3", new.clone()).is_ok());
    s.write_json(
        &RelPath::parse("school.json").unwrap(),
        &json!({ "secties": { "nat": { "voorzitter": "gebr-v" } } }),
        Expect::Any,
    )
    .unwrap();
    assert!(is_forbidden(check(&s, &sec, "3", new)));
    assert_eq!(
        effective_role(&s, &sec).unwrap(),
        Some(Role::Docent),
        "falls back to docent"
    );
}

#[test]
fn a_deactivated_user_and_no_session_write_no_scores() {
    let (_t, s) = setup();
    let new = json!({ "scores": { "t1": { "q1": 1 } } });
    assert!(is_forbidden(check_json_write(
        &s,
        None,
        &score_rel("1"),
        Some(&new)
    )));
    s.write_json(
        &RelPath::parse("gebruikers/gebr-a.json").unwrap(),
        &json!({ "id": "gebr-a", "actief": false }),
        Expect::Any,
    )
    .unwrap();
    assert!(is_forbidden(check(
        &s,
        &session("gebr-a", Role::Docent),
        "1",
        new
    )));
}

#[test]
fn other_files_are_not_guarded() {
    let (_t, s) = setup();
    let rel = RelPath::parse(&format!("{Y}/exams/t1.json")).unwrap();
    assert!(check_json_write(&s, None, &rel, Some(&json!({}))).is_ok());
}

#[test]
fn deleting_a_score_file_needs_the_right() {
    let (_t, s) = setup();
    put_scores(&s, "3", json!({ "scores": { "t1": { "q1": 2 } } }));
    let a = session("gebr-a", Role::Docent);
    assert!(is_forbidden(check_json_write(
        &s,
        Some(&a),
        &score_rel("3"),
        None
    )));
    let b = session("gebr-b", Role::Docent);
    assert!(check_json_write(&s, Some(&b), &score_rel("3"), None).is_ok());
}

#[test]
fn removing_observaties_the_exam_dropped_is_an_exam_edit() {
    let (_t, s) = setup();
    put_scores(&s, "3", json!({ "observations": { "t1": ["o1", "o9"] } }));
    let a = session("gebr-a", Role::Docent);
    // o9 is no longer on the exam: anyone editing the exam may drop it.
    assert!(check(&s, &a, "3", json!({ "observations": { "t1": ["o1"] } })).is_ok());
    // o1 is still on the exam: unticking it is a score change.
    assert!(is_forbidden(check(
        &s,
        &a,
        "3",
        json!({ "observations": { "t1": ["o9"] } })
    )));
    assert!(is_forbidden(check(
        &s,
        &a,
        "3",
        json!({ "observations": { "t1": ["o1", "o9", "o2"] } })
    )));
}

#[test]
fn entries_of_a_deleted_exam_may_only_be_removed() {
    let (_t, s) = setup();
    put_scores(&s, "3", json!({ "scores": { "gone": { "q1": 2 } } }));
    let a = session("gebr-a", Role::Docent);
    assert!(check(&s, &a, "3", json!({ "scores": {} })).is_ok());
    assert!(is_forbidden(check(
        &s,
        &a,
        "3",
        json!({ "scores": { "gone": { "q1": 3 } } })
    )));
}

#[test]
fn a_projectgroep_with_an_own_student_may_be_graded() {
    let (_t, s) = setup();
    let a = session("gebr-a", Role::Docent);
    // Student 3 (B's) shares g1 with student 1 (A's).
    // `ownLines: []` where the file had none is no change of own lines.
    let graded = json!({ "scores": { "p1": { "c1": 4 } },
                         "po": { "p1": { "projectgroep": "g1", "comment": "goed", "ownLines": [] } } });
    assert!(check(&s, &a, "3", graded).is_ok());
    // g2 holds only B's student 4.
    let g2 = json!({ "scores": { "p1": { "c1": 4 } }, "po": { "p1": { "projectgroep": "g2" } } });
    assert!(is_forbidden(check(&s, &a, "4", g2)));
}

#[test]
fn own_lines_only_by_the_students_teacher() {
    let (_t, s) = setup();
    put_scores(
        &s,
        "3",
        json!({ "po": { "p1": { "projectgroep": "g1", "ownLines": [] } } }),
    );
    let line = json!({ "po": { "p1": { "projectgroep": "g1",
                                       "ownLines": [{ "label": "x", "value": 1 }] } } });
    assert!(is_forbidden(check(
        &s,
        &session("gebr-a", Role::Docent),
        "3",
        line.clone()
    )));
    assert!(check(&s, &session("gebr-b", Role::Docent), "3", line.clone()).is_ok());
    assert!(
        check(
            &s,
            &session("gebr-s", Role::Bestuur("nat".into())),
            "3",
            line
        )
        .is_ok()
    );
}

/// p2: projectgroep h1 = {3, 4} (both B's), already graded through student 3.
fn with_p2(s: &Storage) {
    s.write_json(
        &RelPath::parse(&format!("{Y}/exams/p2.json")).unwrap(),
        &json!({ "id": "p2", "kind": "po", "subject": "nat",
                 "projectgroepen": [{ "id": "h1", "student_ids": ["3", "4"] }] }),
        Expect::Any,
    )
    .unwrap();
    put_scores(
        s,
        "3",
        json!({ "scores": { "p2": { "c1": 2 } },
                "po": { "p2": { "projectgroep": "h1", "comment": "ok", "categoryObs": {} } } }),
    );
}

#[test]
fn moving_into_a_projectgroep_takes_its_grading() {
    let (_t, s) = setup();
    with_p2(&s);
    // Student 4 (B's) was in another group; a PO edit by A moved them into h1 (no own student).
    let lines = json!([{ "label": "x", "value": 1 }]);
    put_scores(
        &s,
        "4",
        json!({ "po": { "p2": { "projectgroep": "old", "ownLines": lines } } }),
    );
    let a = session("gebr-a", Role::Docent);
    let moved = json!({ "scores": { "p2": { "c1": 2 } },
                        "po": { "p2": { "projectgroep": "h1", "comment": "ok", "ownLines": lines } } });
    assert!(check(&s, &a, "4", moved.clone()).is_ok());
    // Not the group's grading: refused.
    let other = json!({ "scores": { "p2": { "c1": 5 } },
                        "po": { "p2": { "projectgroep": "h1", "comment": "ok", "ownLines": lines } } });
    assert!(is_forbidden(check(&s, &a, "4", other)));
    // Clearing (the new group has no grading) is a move too.
    assert!(
        check(
            &s,
            &a,
            "4",
            json!({ "po": { "p2": { "projectgroep": "h1", "ownLines": lines } } })
        )
        .is_ok()
    );
    // Once in h1, grading it again is not a move.
    put_scores(&s, "4", moved);
    let regrade = json!({ "scores": { "p2": { "c1": 3 } },
                          "po": { "p2": { "projectgroep": "h1", "comment": "ok", "ownLines": lines } } });
    assert!(is_forbidden(check(&s, &a, "4", regrade)));
}

#[test]
fn a_first_grading_of_a_foreign_projectgroep_is_no_move() {
    let (_t, s) = setup();
    // g2 = {4}, B's only; student 4 has nothing for p1 yet.
    let a = session("gebr-a", Role::Docent);
    let first =
        json!({ "scores": { "p1": { "c1": 4 } }, "po": { "p1": { "projectgroep": "g2" } } });
    assert!(is_forbidden(check(&s, &a, "4", first)));
}

#[test]
fn a_student_outside_every_projectgroep_may_only_lose_the_po() {
    let (_t, s) = setup();
    // Student 2 is A's but take B: student 2 is in no projectgroep of p1.
    put_scores(
        &s,
        "2",
        json!({ "scores": { "p1": { "c1": 2 } }, "po": { "p1": { "projectgroep": "g9" } } }),
    );
    let b = session("gebr-b", Role::Docent);
    assert!(check(&s, &b, "2", json!({ "scores": {}, "po": {} })).is_ok());
    assert!(is_forbidden(check(
        &s,
        &b,
        "2",
        json!({ "scores": { "p1": { "c1": 3 } } })
    )));
}

#[test]
fn role_allowed_checks_school_json_and_the_user() {
    let (_t, s) = setup();
    assert!(role_allowed(&s, "gebr-v", &Role::Bestuur("nat".into())).unwrap());
    assert!(role_allowed(&s, "gebr-s", &Role::Bestuur("nat".into())).unwrap());
    assert!(!role_allowed(&s, "gebr-a", &Role::Bestuur("nat".into())).unwrap());
    assert!(!role_allowed(&s, "gebr-v", &Role::Bestuur("bio".into())).unwrap());
    assert!(role_allowed(&s, "admin", &Role::Beheer).unwrap());
    assert!(!role_allowed(&s, "gebr-a", &Role::Beheer).unwrap());
    assert!(!role_allowed(&s, "nobody", &Role::Docent).unwrap());
}

#[test]
fn review_m3_a_grading_without_projectgroep_is_not_cleared_by_another_teacher() {
    let (_t, s) = setup();
    // Student 4 (B's, alone in g2) has PO scores but no `po.projectgroep`.
    put_scores(&s, "4", json!({ "scores": { "p1": { "c1": 3 } } }));
    let a = session("gebr-a", Role::Docent);
    assert!(is_forbidden(check(&s, &a, "4", json!({ "scores": {} }))));
    // Nothing there yet: an empty write is no change of grading.
    put_scores(
        &s,
        "4",
        json!({ "po": { "p1": { "projectgroep": "old" } } }),
    );
    assert!(
        check(
            &s,
            &a,
            "4",
            json!({ "po": { "p1": { "projectgroep": "g2" } } })
        )
        .is_ok()
    );
}

#[test]
fn only_the_admin_changes_the_cijfergemiddelden() {
    let (_t, s) = setup();
    let rel = RelPath::parse("instellingen.json").unwrap();
    s.write_json(&rel, &json!({ "editor": { "timeout": 30 } }), Expect::Any)
        .unwrap();
    let k0 = json!({ "editor": { "timeout": 30 },
                     "gemiddelden": { "r": { "methode": "afkappen", "decimalen": 0 } } });
    let admin = session("admin", Role::Beheer);
    let teacher = session("gebr-a", Role::Docent);
    let voorzitter = session("gebr-v", Role::Bestuur("nat".into()));
    assert!(check_json_write(&s, Some(&admin), &rel, Some(&k0)).is_ok());
    assert!(is_forbidden(check_json_write(
        &s,
        Some(&teacher),
        &rel,
        Some(&k0)
    )));
    assert!(is_forbidden(check_json_write(
        &s,
        Some(&voorzitter),
        &rel,
        Some(&k0)
    )));
    assert!(is_forbidden(check_json_write(&s, None, &rel, Some(&k0))));
    // A non-admin claiming the role is refused too.
    let fake = session("gebr-a", Role::Beheer);
    assert!(is_forbidden(check_json_write(
        &s,
        Some(&fake),
        &rel,
        Some(&k0)
    )));
    // Other settings stay open, as before; so does a write that keeps the field.
    let other = json!({ "editor": { "timeout": 60 } });
    assert!(check_json_write(&s, Some(&teacher), &rel, Some(&other)).is_ok());
    s.write_json(&rel, &k0, Expect::Any).unwrap();
    let mut kept = k0.clone();
    kept["editor"]["timeout"] = json!(60);
    assert!(check_json_write(&s, Some(&teacher), &rel, Some(&kept)).is_ok());
    // Dropping the field, or deleting the file, is a change.
    assert!(is_forbidden(check_json_write(
        &s,
        Some(&teacher),
        &rel,
        Some(&other)
    )));
    assert!(is_forbidden(check_json_write(
        &s,
        Some(&teacher),
        &rel,
        None
    )));
    assert!(check_json_write(&s, Some(&admin), &rel, None).is_ok());
}
