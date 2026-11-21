// SPDX-License-Identifier: AGPL-3.0-or-later

//! Step 36: the gast session (read-only storage, presence excepted) and "Kopieer naar…".

use std::time::{Duration, Instant, SystemTime};

use serde_json::{Value, json};

use super::*;
use crate::rights::{Session, gast_id};

fn setup() -> (tempfile::TempDir, Storage) {
    let tmp = tempfile::tempdir().unwrap();
    let s =
        Storage::open_with_lock_dir(tmp.path().join("data"), &tmp.path().join("locks")).unwrap();
    let put = |rel: &str, v: Value| {
        s.write_json(&RelPath::parse(rel).unwrap(), &v, Expect::Any)
            .unwrap();
    };
    put(
        "school.json",
        json!({ "naam": "S", "secties": { "nat": { "gast": true }, "bio": {} } }),
    );
    put(
        "gebruikers/gebr-bio.json",
        json!({ "id": "gebr-bio", "actief": true, "vakken": ["bio"] }),
    );
    put(
        "gebruikers/gebr-nat.json",
        json!({ "id": "gebr-nat", "actief": true, "vakken": ["nat"] }),
    );
    crate::typst_svc::create_opdracht_folder(&s, "opd-1").unwrap();
    s.write_text(
        &RelPath::parse("opdrachten/opd-1/opdracht.typ").unwrap(),
        "= Vallen\n",
        Expect::Any,
    )
    .unwrap();
    put(
        "opdrachten/opd-1/opdracht.json",
        json!({ "id": "opd-1", "naam": "Vallen", "vakken": ["nat"], "jaarlagen": ["3"],
                "observaties": ["obs-1", "obs-2"], "_meta": { "rev": 3, "createdBy": "gebr-nat" } }),
    );
    let auth = Auth::new();
    auth.set_first_pin(&s, "gebr-bio", "24680", SystemTime::now())
        .unwrap();
    auth.logout_from(Some(&s));
    (tmp, s)
}

fn gast(s: &Storage) -> Auth {
    let auth = Auth::new();
    auth.login_gast(s, "nat").unwrap();
    auth
}

#[test]
fn a_gast_logs_in_only_where_the_admin_switched_it_on() {
    let (_t, s) = setup();
    let auth = Auth::new();
    let session = auth.login_gast(&s, "nat").unwrap();
    assert_eq!(
        session,
        Session {
            user_id: gast_id("nat"),
            role: Role::Gast("nat".into())
        }
    );
    assert!(s.is_guest());
    assert!(auth.login_gast(&s, "bio").is_err());
    auth.logout_from(Some(&s));
    assert!(!s.is_guest());
    assert_eq!(Role::parse("gast:nat").unwrap(), Role::Gast("nat".into()));
}

#[test]
fn a_gast_writes_nothing_but_presence() {
    let (_t, s) = setup();
    let _auth = gast(&s);
    let rel = |p: &str| RelPath::parse(p).unwrap();
    let refused = |r: Result<()>| matches!(r, Err(Error::GuestReadOnly));
    assert!(refused(
        s.write_json(&rel("2025-2026/exams/t.json"), &json!({}), Expect::Any)
            .map(|_| ())
    ));
    assert!(refused(
        s.write_text(&rel("opdrachten/opd-1/opdracht.typ"), "x", Expect::Any)
            .map(|_| ())
    ));
    assert!(refused(s.write_bytes(
        &rel("opdrachten/opd-1/images/a.png"),
        b"x",
        Expect::Any
    )));
    assert!(refused(s.save_photo(&rel("afbeeldingen/a.jpg"), "eA==")));
    assert!(refused(s.delete(&rel("opdrachten/opd-1/opdracht.json"))));
    assert!(refused(
        s.remove_empty_dir(&rel("opdrachten/opd-1/images"))
            .map(|_| ())
    ));
    assert!(refused(opdracht_images::copy(&s, "opd-1", "opd-2")));
    assert!(refused(crate::rubrics::ensure_min_app_version(&s, "9.0.0")));
    assert_eq!(Error::GuestReadOnly.code(), "read_only");
    // Presence is not data: colleagues see "Gast (nat)".
    s.write_json(
        &rel("aanwezigheid/gast-nat.json"),
        &json!({ "online": true }),
        Expect::Any,
    )
    .unwrap();
    // A score write is refused by the rights check too.
    let session = Session {
        user_id: gast_id("nat"),
        role: Role::Gast("nat".into()),
    };
    assert!(refused(crate::rights::check_json_write(
        &s,
        Some(&session),
        &rel("2025-2026/scores/nat/1.json"),
        Some(&json!({ "scores": {} }))
    )));
}

#[test]
fn kopieer_naar_writes_the_copy_as_the_teacher_after_the_pin() {
    let (_t, s) = setup();
    let auth = gast(&s);
    let at = SystemTime::UNIX_EPOCH + Duration::from_millis(1_764_000_000_000);
    let now = Instant::now();
    let wrong =
        copy_opdracht_to_sectie(&s, &auth, "opd-1", "bio", "gebr-bio", "11111", now, at).unwrap();
    assert!(matches!(wrong.check, Check::Wrong { .. }));
    assert!(wrong.opdracht.is_none());
    let later = now + Duration::from_secs(5);
    let done =
        copy_opdracht_to_sectie(&s, &auth, "opd-1", "bio", "gebr-bio", "24680", later, at).unwrap();
    assert_eq!(done.check, Check::Ok);
    assert_eq!(done.dropped_observaties, 2);
    let copy = done.opdracht.unwrap();
    let id = copy["id"].as_str().unwrap().to_owned();
    assert_eq!(id, "opdracht_1764000000000");
    let on_disk = s
        .read_json(&RelPath::parse(&format!("opdrachten/{id}/opdracht.json")).unwrap())
        .unwrap()
        .unwrap();
    assert_eq!(on_disk["vakken"], json!(["bio"]));
    assert_eq!(on_disk["observaties"], json!([]));
    assert_eq!(on_disk["naam"], "Vallen");
    assert_eq!(on_disk["_meta"]["createdBy"], "gebr-bio");
    assert_eq!(on_disk["_meta"]["rev"], 1);
    let typ = s
        .read_text(&RelPath::parse(&format!("opdrachten/{id}/opdracht.typ")).unwrap())
        .unwrap();
    assert_eq!(typ.as_deref(), Some("= Vallen\n"));
    // The guard is back on afterwards, and the gast is still a gast.
    assert!(s.is_guest());
    assert!(matches!(
        s.write_json(&RelPath::parse("x.json").unwrap(), &json!({}), Expect::Any),
        Err(Error::GuestReadOnly)
    ));
    assert_eq!(auth.current().unwrap().role, Role::Gast("nat".into()));
}

#[test]
fn kopieer_naar_needs_a_gast_and_a_teacher_of_the_target_vak() {
    let (_t, s) = setup();
    let at = SystemTime::now();
    let now = Instant::now();
    let teacher = Auth::new();
    assert!(
        copy_opdracht_to_sectie(&s, &teacher, "opd-1", "bio", "gebr-bio", "24680", now, at)
            .is_err(),
        "not logged in as gast"
    );
    let auth = gast(&s);
    assert!(
        copy_opdracht_to_sectie(&s, &auth, "opd-1", "bio", "gebr-nat", "24680", now, at).is_err(),
        "gebr-nat does not teach bio"
    );
    assert!(
        copy_opdracht_to_sectie(&s, &auth, "opd-1", "../x", "gebr-bio", "24680", now, at).is_err()
    );
    assert!(
        copy_opdracht_to_sectie(&s, &auth, "nope", "bio", "gebr-bio", "24680", now, at).is_err()
    );
}
