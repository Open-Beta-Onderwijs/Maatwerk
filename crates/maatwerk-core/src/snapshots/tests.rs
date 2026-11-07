// SPDX-License-Identifier: AGPL-3.0-or-later

use std::fs;
use std::time::SystemTime;

use serde_json::json;
use time::macros::datetime;

use super::*;

fn setup() -> (tempfile::TempDir, Storage) {
    let tmp = tempfile::tempdir().unwrap();
    let storage =
        Storage::open_with_lock_dir(tmp.path().join("data"), &tmp.path().join("locks")).unwrap();
    (tmp, storage)
}

/// Without the settle wait (tests that are not about it).
fn run_if_due(s: &Storage, now: OffsetDateTime, who: &str) -> Result<Outcome> {
    run_if_due_with(s, now, who, &|| {})
}

fn rel(s: &str) -> RelPath {
    RelPath::parse(s).unwrap()
}

fn put(s: &Storage, p: &str, bytes: &[u8]) {
    let path = s.data_dir().root().join(p);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, bytes).unwrap();
}

fn names(s: &Storage) -> Vec<String> {
    list(s).unwrap().into_iter().map(|s| s.name).collect()
}

fn snap(name: &str) -> Snapshot {
    Snapshot {
        name: name.into(),
        time: parse_name(name).unwrap(),
    }
}

#[test]
fn names_parse_and_others_are_not_snapshots() {
    assert_eq!(
        parse_name("2026-10-31 0815.zip"),
        Some(PrimitiveDateTime::new(
            Date::from_calendar_date(2026, time::Month::October, 31).unwrap(),
            Time::from_hms(8, 15, 0).unwrap()
        ))
    );
    assert!(parse_name("2026-10-31 0815 (2).zip").is_some());
    assert!(
        parse_name("2026-10-31 0815-PC-LOKAAL12.zip").is_some(),
        "OneDrive copy"
    );
    for bad in [
        // Review 7b M1: no path parts, no panic on non-ASCII.
        "2026-10-31 0815 (/../../x).zip",
        r"2026-10-31 0815 (..\x).zip",
        "2026-10-31 081é.zip",
        "2026-10-31 0815é.zip",
        "2026-10-31 0815 ().zip",
        "2026-10-31 0815-a/b.zip",
        "2026-10-31 0815.zip.partial",
        "2026-13-31 0815.zip",
        "2026-10-31 2515.zip",
        "2026-10-31 0815x.zip",
        "state.json",
        "x.zip",
    ] {
        assert_eq!(parse_name(bad), None, "{bad}");
    }
}

#[test]
fn settings_fall_back_to_the_defaults() {
    assert_eq!(Settings::from_json(None), Settings::default());
    let s = Settings::from_json(Some(&json!({
        "snapshots": { "intervalHours": 6, "daily": 3, "weekly": "x", "monthly": -1 }
    })));
    assert_eq!(
        s,
        Settings {
            interval_hours: 6,
            daily: 3,
            ..Settings::default()
        }
    );
    let zero = Settings::from_json(Some(&json!({ "snapshots": { "intervalHours": 0 } })));
    assert_eq!(zero.interval_hours, 24);
}

#[test]
fn contents_are_json_typ_and_opdracht_images_only() {
    let (_t, s) = setup();
    for p in [
        "config.json",
        "gebruikers/admin.json",
        "2025-2026/exams/t.json",
        "opdrachten/o1/opdracht.json",
        "opdrachten/o1/opdracht.typ",
        "opdrachten/o1/images/a.png",
        "fotos/admin.jpg",
        "fotos/x.json",
        "snapshots/state.json",
        "rapporten/x.json",
        "a.json.123.tmp",
        "notes.txt",
        "opdrachten/o1/other.png",
    ] {
        put(&s, p, b"{}");
    }
    assert_eq!(
        contents(s.data_dir().root()).unwrap(),
        [
            "2025-2026/exams/t.json",
            "config.json",
            "gebruikers/admin.json",
            "opdrachten/o1/images/a.png",
            "opdrachten/o1/opdracht.json",
            "opdrachten/o1/opdracht.typ",
        ]
    );
}

#[test]
fn retention_keeps_the_newest_per_day_week_and_month() {
    // Newest first, as `list` returns them.
    let all: Vec<Snapshot> = [
        "2026-10-31 1600.zip",
        "2026-10-31 0800.zip", // same day: only the newest counts
        "2026-10-30 0800.zip",
        "2026-10-29 0800.zip",
        "2026-10-20 0800.zip", // ISO week 43
        "2026-10-12 0800.zip", // ISO week 42
        "2026-09-15 0800.zip",
        "2026-08-15 0800.zip",
        "2025-12-01 0800.zip",
    ]
    .iter()
    .map(|n| snap(n))
    .collect();
    let kept = keep(
        &all,
        Settings {
            interval_hours: 24,
            daily: 2,
            weekly: 3,
            monthly: 3,
        },
    );
    let kept: Vec<&str> = kept.iter().map(String::as_str).collect();
    assert_eq!(
        kept,
        [
            "2026-08-15 0800.zip", // monthly (third month)
            "2026-09-15 0800.zip", // monthly
            "2026-10-12 0800.zip", // weekly (week 42)
            "2026-10-20 0800.zip", // weekly (week 43)
            "2026-10-30 0800.zip", // daily
            "2026-10-31 1600.zip", // newest: daily, weekly, monthly
        ]
    );
    let none = keep(
        &all,
        Settings {
            interval_hours: 24,
            daily: 0,
            weekly: 0,
            monthly: 0,
        },
    );
    assert_eq!(none.len(), 1, "the newest always stays");
}

#[test]
fn a_due_snapshot_is_written_once_and_holds_the_files() {
    let (_t, s) = setup();
    put(&s, "config.json", br#"{"schema_version":3}"#);
    put(&s, "opdrachten/o1/opdracht.typ", b"= Hallo");
    let now = datetime!(2026-10-31 08:15 UTC);
    let out = run_if_due(&s, now, "PC-1").unwrap();
    let Outcome::Written { name, files, .. } = out else {
        panic!("{out:?}")
    };
    assert_eq!(name, "2026-10-31 0815.zip");
    assert_eq!(files, 2);
    let state = s.read_json(&rel(STATE_FILE)).unwrap().unwrap();
    assert_eq!(state["last"], "2026-10-31 0815.zip");
    assert_eq!(state["lastBy"], "PC-1");
    assert!(state.get("claim").is_none());
    assert_eq!(integrity::check(&state), StampState::Ok);

    // Not due again within the interval, also on another PC.
    let later = datetime!(2026-10-31 20:00 UTC);
    assert_eq!(run_if_due(&s, later, "PC-2").unwrap(), Outcome::NotDue);
    // Due a day later.
    let next = datetime!(2026-11-01 08:16 UTC);
    assert!(matches!(
        run_if_due(&s, next, "PC-2").unwrap(),
        Outcome::Written { .. }
    ));
    assert_eq!(names(&s), ["2026-11-01 0816.zip", "2026-10-31 0815.zip"]);

    let zip =
        ZipArchive::new(File::open(s.data_dir().root().join(DIR).join(&name)).unwrap()).unwrap();
    let mut entries: Vec<String> = zip.file_names().map(|n| n.unwrap().into_owned()).collect();
    entries.sort();
    assert_eq!(entries, ["config.json", "opdrachten/o1/opdracht.typ"]);
}

#[test]
fn a_fresh_claim_by_another_app_means_busy_and_a_stale_one_is_taken_over() {
    let (_t, s) = setup();
    put(&s, "config.json", b"{}");
    let now = datetime!(2026-10-31 08:15 UTC);
    s.write_json(
        &rel(STATE_FILE),
        &json!({ "claim": { "by": "PC-2", "atMs": ms(now) - 60_000 } }),
        Expect::Any,
    )
    .unwrap();
    assert_eq!(run_if_due(&s, now, "PC-1").unwrap(), Outcome::Busy);
    assert!(names(&s).is_empty());
    let much_later = now + time::Duration::hours(1);
    assert!(matches!(
        run_if_due(&s, much_later, "PC-1").unwrap(),
        Outcome::Written { .. }
    ));
}

#[test]
fn old_snapshots_are_pruned_after_writing() {
    let (_t, s) = setup();
    put(&s, "config.json", b"{}");
    for n in [
        "2026-10-01 0800.zip",
        "2026-10-02 0800.zip",
        "2026-10-02 0700.zip",
    ] {
        put(&s, &format!("snapshots/{n}"), b"old");
    }
    put(&s, "snapshots/notes.txt", b"not mine");
    s.write_json(
        &rel(SETTINGS_FILE),
        &json!({ "snapshots": { "daily": 2, "weekly": 0, "monthly": 0 } }),
        Expect::Any,
    )
    .unwrap();
    let out = run_if_due(&s, datetime!(2026-10-31 08:15 UTC), "PC-1").unwrap();
    let Outcome::Written { removed, .. } = out else {
        panic!("{out:?}")
    };
    assert_eq!(removed, ["2026-10-02 0700.zip", "2026-10-01 0800.zip"]);
    assert_eq!(names(&s), ["2026-10-31 0815.zip", "2026-10-02 0800.zip"]);
    assert!(s.data_dir().root().join("snapshots/notes.txt").exists());
}

#[test]
fn a_file_is_restored_from_the_newest_intact_copy() {
    let (_t, s) = setup();
    let g = rel("gebruikers/gebr-1.json");
    s.write_json(
        &g,
        &json!({ "id": "gebr-1", "voornaam": "Eerste" }),
        Expect::Any,
    )
    .unwrap();
    run_if_due(&s, datetime!(2026-10-30 08:00 UTC), "PC-1").unwrap();
    // Changed outside Maatwerk before the next snapshot: that copy has a bad stamp.
    put(
        &s,
        "gebruikers/gebr-1.json",
        br#"{"id":"gebr-1","voornaam":"Hand","_meta":{"hash":"0"}}"#,
    );
    run_if_due(&s, datetime!(2026-10-31 09:00 UTC), "PC-1").unwrap();

    let found = find_intact_copy(&s, &g).unwrap().unwrap();
    assert_eq!(found.name, "2026-10-30 0800.zip");
    restore_file(&s, &found.name, &g, Some("admin"), SystemTime::now()).unwrap();
    let back = s.read_json(&g).unwrap().unwrap();
    assert_eq!(back["voornaam"], "Eerste");
    assert_eq!(integrity::check(&back), StampState::Ok);

    assert_eq!(find_intact_copy(&s, &rel("school.json")).unwrap(), None);
    assert!(
        restore_file(
            &s,
            &found.name,
            &rel("school.json"),
            None,
            SystemTime::now()
        )
        .is_err()
    );
    assert!(restore_file(&s, "x.zip", &g, None, SystemTime::now()).is_err());
    assert!(
        restore_file(
            &s,
            &found.name,
            &rel("opdrachten/o1/opdracht.typ"),
            None,
            SystemTime::now()
        )
        .is_err()
    );
}

#[test]
fn a_restore_bumps_the_rev_names_the_admin_and_keeps_pin_fields() {
    let (_t, s) = setup();
    let g = rel("gebruikers/admin.json");
    s.write_json(
        &g,
        &json!({ "id": "admin", "voornaam": "Oud", "recoveryCodeHashes": ["a", "b"],
                 "_meta": { "rev": 3, "updatedBy": "admin" } }),
        Expect::Any,
    )
    .unwrap();
    run_if_due(&s, datetime!(2026-10-30 08:00 UTC), "PC-1").unwrap();
    // Codes used and a hand edit since.
    put(
        &s,
        "gebruikers/admin.json",
        br#"{"id":"admin","voornaam":"Hand","pinHash":"p","recoveryCodeHashes":["b"],"_meta":{"rev":5}}"#,
    );
    restore_file(
        &s,
        "2026-10-30 0800.zip",
        &g,
        Some("beheer"),
        SystemTime::now(),
    )
    .unwrap();
    let back = s.read_json(&g).unwrap().unwrap();
    assert_eq!(back["voornaam"], "Oud");
    assert_eq!(back["_meta"]["rev"], 6, "on-disk rev + 1");
    assert_eq!(back["_meta"]["updatedBy"], "beheer");
    assert_eq!(
        back["recoveryCodeHashes"],
        json!(["b"]),
        "used codes stay used"
    );
    assert_eq!(back["pinHash"], "p");
    assert_eq!(integrity::check(&back), StampState::Ok);
}

#[test]
fn a_file_saved_through_maatwerk_since_the_check_is_not_restored() {
    let (_t, s) = setup();
    let g = rel("school.json");
    s.write_json(&g, &json!({ "naam": "Oud" }), Expect::Any)
        .unwrap();
    run_if_due(&s, datetime!(2026-10-30 08:00 UTC), "PC-1").unwrap();
    // A colleague saved it properly (good stamp): the restore must not throw that away.
    s.write_json(&g, &json!({ "naam": "Nieuw" }), Expect::Any)
        .unwrap();
    let err = restore_file(
        &s,
        "2026-10-30 0800.zip",
        &g,
        Some("admin"),
        SystemTime::now(),
    )
    .unwrap_err();
    assert_eq!(err.code(), "conflict");
    assert_eq!(s.read_json(&g).unwrap().unwrap()["naam"], "Nieuw");
}

#[test]
fn a_snapshot_dated_far_ahead_does_not_block_new_ones() {
    let (_t, s) = setup();
    put(&s, "config.json", b"{}");
    put(&s, "snapshots/2027-06-01 0800.zip", b"wrong clock");
    assert!(matches!(
        run_if_due(&s, datetime!(2026-10-31 08:15 UTC), "PC-1").unwrap(),
        Outcome::Written { .. }
    ));
}

#[test]
fn a_onedrive_conflict_copy_of_a_snapshot_is_pruned() {
    let (_t, s) = setup();
    put(&s, "config.json", b"{}");
    put(&s, "snapshots/2026-10-01 0800.zip", b"a");
    put(&s, "snapshots/2026-10-01 0800-PC2.zip", b"b");
    s.write_json(
        &rel(SETTINGS_FILE),
        &json!({ "snapshots": { "daily": 2, "weekly": 0, "monthly": 0 } }),
        Expect::Any,
    )
    .unwrap();
    run_if_due(&s, datetime!(2026-10-31 08:15 UTC), "PC-1").unwrap();
    assert_eq!(names(&s), ["2026-10-31 0815.zip", "2026-10-01 0800.zip"]);
}

/// Review 7b m1 (and m6): two PCs that start in the same minute both claim, each in its own
/// OneDrive replica. After the settle wait the claim that synced wins; the other PC gives up
/// and leaves that claim alone.
#[test]
fn m1_a_claim_overwritten_while_settling_means_busy() {
    let (_t, s) = setup();
    put(&s, "config.json", b"{}");
    let now = datetime!(2026-10-31 08:15 UTC);
    let other = json!({ "claim": { "by": "PC-2", "atMs": ms(now) + 5_000 } });
    let out = run_if_due_with(&s, now, "PC-1", &|| {
        // OneDrive brings in PC-2's state.json.
        s.write_json(&rel(STATE_FILE), &other, Expect::Any).unwrap();
    })
    .unwrap();
    assert_eq!(out, Outcome::Busy);
    assert!(names(&s).is_empty());
    let state = s.read_json(&rel(STATE_FILE)).unwrap().unwrap();
    assert_eq!(state["claim"]["by"], "PC-2", "{state}");
}

#[test]
fn m1_a_snapshot_written_elsewhere_while_settling_means_not_due() {
    let (_t, s) = setup();
    put(&s, "config.json", b"{}");
    let now = datetime!(2026-10-31 08:15 UTC);
    let out = run_if_due_with(&s, now, "PC-1", &|| {
        let done = json!({ "last": "2026-10-31 0815.zip", "lastAtMs": ms(now), "lastBy": "PC-2" });
        s.write_json(&rel(STATE_FILE), &done, Expect::Any).unwrap();
    })
    .unwrap();
    assert_eq!(out, Outcome::NotDue);
    assert!(names(&s).is_empty());
}

#[test]
fn m1_an_undisturbed_claim_is_kept_after_settling() {
    let (_t, s) = setup();
    put(&s, "config.json", b"{}");
    let now = datetime!(2026-10-31 08:15 UTC);
    let seen = std::cell::Cell::new(false);
    let out = run_if_due_with(&s, now, "PC-1", &|| {
        let state = s.read_json(&rel(STATE_FILE)).unwrap().unwrap();
        assert_eq!(state["claim"]["by"], "PC-1");
        seen.set(true);
    })
    .unwrap();
    assert!(seen.get());
    assert!(matches!(out, Outcome::Written { .. }), "{out:?}");
}
