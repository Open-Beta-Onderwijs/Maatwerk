// SPDX-License-Identifier: AGPL-3.0-or-later

use std::time::{Duration, Instant, SystemTime};

use serde_json::{Value, json};

use super::*;
use crate::storage::Expect;

fn setup() -> (tempfile::TempDir, Storage) {
    let tmp = tempfile::tempdir().unwrap();
    let storage =
        Storage::open_with_lock_dir(tmp.path().join("data"), &tmp.path().join("locks")).unwrap();
    for (id, admin) in [("admin", true), ("gebr-1", false), ("gebr-2", false)] {
        let user = json!({ "id": id, "voornaam": id, "isAdmin": admin, "actief": true,
                           "_meta": { "rev": 1 } });
        storage
            .write_json(&user_path(id).unwrap(), &user, Expect::Any)
            .unwrap();
    }
    (tmp, storage)
}

fn user(s: &Storage, id: &str) -> Value {
    s.read_json(&user_path(id).unwrap()).unwrap().unwrap()
}

#[test]
fn pin_format_is_four_to_eight_digits() {
    for ok in ["1234", "12345", "12345678", "0000"] {
        assert!(check_pin_format(ok).is_ok(), "{ok}");
    }
    for bad in ["123", "123456789", "12a45", " 12345", "１２３４", ""] {
        assert!(check_pin_format(bad).is_err(), "{bad}");
    }
}

#[test]
fn hashes_are_salted_argon2id_and_verify() {
    let a = hash_secret("12345").unwrap();
    let b = hash_secret("12345").unwrap();
    assert!(a.starts_with("$argon2id$"), "{a}");
    assert_ne!(a, b, "a fresh salt each time");
    assert!(verify_secret("12345", &a));
    assert!(!verify_secret("12346", &a));
    assert!(!verify_secret("12345", "not a hash"));
}

#[test]
fn recovery_codes_are_ten_distinct_readable_codes() {
    let codes = new_recovery_codes();
    assert_eq!(codes.len(), RECOVERY_CODES);
    let unique: std::collections::BTreeSet<_> = codes.iter().collect();
    assert_eq!(unique.len(), RECOVERY_CODES);
    for c in &codes {
        assert_eq!(c.len(), 9, "{c}");
        assert_eq!(&c[4..5], "-");
        assert!(
            c.chars()
                .all(|ch| ch == '-' || CODE_ALPHABET.contains(&(ch as u8)))
        );
    }
    assert_eq!(canonical_code(" abcd efgh "), "ABCD-EFGH");
}

#[test]
fn the_delay_grows_per_wrong_attempt_up_to_a_minute() {
    let secs: Vec<u64> = (1..=9).map(|n| delay_after(n).as_secs()).collect();
    assert_eq!(secs, [0, 2, 4, 8, 16, 32, 60, 60, 60]);
}

#[test]
fn first_pin_then_login_and_no_second_first_pin() {
    let (_t, s) = setup();
    let auth = Auth::new();
    let now = Instant::now();
    assert_eq!(
        auth.verify_pin(&s, "gebr-1", "12345", now).unwrap(),
        Check::NoPin
    );
    assert_eq!(auth.session(), None);

    let set = auth
        .set_first_pin(&s, "gebr-1", "12345", SystemTime::now())
        .unwrap();
    assert!(set.recovery_codes.is_none(), "teachers get no codes");
    assert_eq!(auth.session().as_deref(), Some("gebr-1"));
    let mut u = user(&s, "gebr-1");
    u["_meta"].as_object_mut().unwrap().remove("hash"); // stamped on write
    assert_eq!(u, set.user);
    assert_eq!(u["_meta"]["rev"], 2);
    assert_eq!(u["_meta"]["updatedBy"], "gebr-1");
    assert!(u[PIN_FIELD].as_str().unwrap().starts_with("$argon2id$"));
    assert!(!u.to_string().contains("12345"));

    auth.logout();
    let err = auth
        .set_first_pin(&s, "gebr-1", "99999", SystemTime::now())
        .unwrap_err();
    assert!(err.to_string().contains("al een pincode"), "{err}");
    assert_eq!(
        auth.verify_pin(&s, "gebr-1", "12345", now).unwrap(),
        Check::Ok
    );
    assert_eq!(auth.session().as_deref(), Some("gebr-1"));
}

#[test]
fn wrong_pins_are_throttled_per_user() {
    let (_t, s) = setup();
    let auth = Auth::new();
    auth.set_first_pin(&s, "gebr-1", "12345", SystemTime::now())
        .unwrap();
    auth.set_first_pin(&s, "gebr-2", "54321", SystemTime::now())
        .unwrap();
    auth.logout();
    let t0 = Instant::now();
    assert_eq!(
        auth.verify_pin(&s, "gebr-1", "00000", t0).unwrap(),
        Check::Wrong {
            retry_after: Duration::ZERO
        }
    );
    assert_eq!(
        auth.verify_pin(&s, "gebr-1", "00000", t0).unwrap(),
        Check::Wrong {
            retry_after: Duration::from_secs(2)
        }
    );
    // Too soon: not even checked, also with the right PIN.
    assert_eq!(
        auth.verify_pin(&s, "gebr-1", "12345", t0 + Duration::from_secs(1))
            .unwrap(),
        Check::Wait {
            retry_after: Duration::from_secs(1)
        }
    );
    assert_eq!(auth.session(), None);
    // Another user is not delayed.
    assert_eq!(
        auth.verify_pin(&s, "gebr-2", "54321", t0).unwrap(),
        Check::Ok
    );
    // After the wait the right PIN works and clears the count.
    let t1 = t0 + Duration::from_secs(2);
    assert_eq!(
        auth.verify_pin(&s, "gebr-1", "12345", t1).unwrap(),
        Check::Ok
    );
    assert_eq!(
        auth.verify_pin(&s, "gebr-1", "00000", t1).unwrap(),
        Check::Wrong {
            retry_after: Duration::ZERO
        }
    );
}

#[test]
fn deactivated_users_cannot_log_in() {
    let (_t, s) = setup();
    let mut u = user(&s, "gebr-1");
    u["actief"] = json!(false);
    s.write_json(&user_path("gebr-1").unwrap(), &u, Expect::Any)
        .unwrap();
    let auth = Auth::new();
    assert!(
        auth.verify_pin(&s, "gebr-1", "12345", Instant::now())
            .is_err()
    );
    assert!(
        auth.set_first_pin(&s, "gebr-1", "12345", SystemTime::now())
            .is_err()
    );
}

#[test]
fn change_pin_needs_the_current_pin() {
    let (_t, s) = setup();
    let auth = Auth::new();
    let now = Instant::now();
    assert!(
        auth.change_pin(&s, "12345", "54321", now, SystemTime::now())
            .is_err()
    );
    auth.set_first_pin(&s, "gebr-1", "12345", SystemTime::now())
        .unwrap();
    let (check, written) = auth
        .change_pin(&s, "11111", "54321", now, SystemTime::now())
        .unwrap();
    assert!(matches!(check, Check::Wrong { .. }));
    assert!(written.is_none());
    let later = now + Duration::from_secs(5);
    let (check, written) = auth
        .change_pin(&s, "12345", "54321", later, SystemTime::now())
        .unwrap();
    assert_eq!(check, Check::Ok);
    assert_eq!(written.unwrap()["_meta"]["rev"], 3);
    assert_eq!(
        auth.verify_pin(&s, "gebr-1", "54321", later).unwrap(),
        Check::Ok
    );
}

#[test]
fn only_the_logged_in_admin_resets_a_teachers_pin() {
    let (_t, s) = setup();
    let auth = Auth::new();
    auth.set_first_pin(&s, "gebr-1", "12345", SystemTime::now())
        .unwrap();
    // A teacher cannot reset.
    let err = auth.reset_pin(&s, "gebr-2", SystemTime::now()).unwrap_err();
    assert!(err.to_string().contains("beheerder"), "{err}");
    auth.logout();
    assert!(auth.reset_pin(&s, "gebr-1", SystemTime::now()).is_err());

    let admin = auth
        .set_first_pin(&s, "admin", "99999", SystemTime::now())
        .unwrap();
    assert_eq!(admin.recovery_codes.as_ref().unwrap().len(), RECOVERY_CODES);
    assert!(
        auth.reset_pin(&s, "admin", SystemTime::now()).is_err(),
        "not self"
    );
    let u = auth.reset_pin(&s, "gebr-1", SystemTime::now()).unwrap();
    assert!(u.get(PIN_FIELD).is_none());
    assert_eq!(u["_meta"]["updatedBy"], "admin");
    assert_eq!(
        auth.verify_pin(&s, "gebr-1", "12345", Instant::now())
            .unwrap(),
        Check::NoPin
    );
}

#[test]
fn a_recovery_code_works_once_and_sets_a_new_pin() {
    let (_t, s) = setup();
    let auth = Auth::new();
    let set = auth
        .set_first_pin(&s, "admin", "99999", SystemTime::now())
        .unwrap();
    let codes = set.recovery_codes.unwrap();
    let stored = user(&s, "admin")[RECOVERY_FIELD]
        .as_array()
        .unwrap()
        .clone();
    assert_eq!(stored.len(), RECOVERY_CODES);
    assert!(
        !stored
            .iter()
            .any(|h| codes.contains(&h.as_str().unwrap().to_owned()))
    );
    auth.logout();

    let now = Instant::now();
    let (check, _) = auth
        .recover(&s, "admin", "AAAA-AAAA", "11111", now, SystemTime::now())
        .unwrap();
    assert!(matches!(check, Check::Wrong { .. }));
    // Typed in lower case without the dash.
    let typed = codes[3].replace('-', "").to_lowercase();
    let (check, written) = auth
        .recover(&s, "admin", &typed, "11111", now, SystemTime::now())
        .unwrap();
    assert_eq!(check, Check::Ok);
    assert_eq!(
        written.unwrap()[RECOVERY_FIELD].as_array().unwrap().len(),
        9
    );
    assert_eq!(auth.session().as_deref(), Some("admin"));
    assert_eq!(
        auth.verify_pin(&s, "admin", "11111", now + Duration::from_secs(9))
            .unwrap(),
        Check::Ok
    );
    let (check, _) = auth
        .recover(
            &s,
            "admin",
            &codes[3],
            "22222",
            now + Duration::from_secs(9),
            SystemTime::now(),
        )
        .unwrap();
    assert!(matches!(check, Check::Wrong { .. }), "used up");
    // Teachers have no codes.
    assert!(
        auth.recover(&s, "gebr-1", &codes[4], "22222", now, SystemTime::now())
            .is_err()
    );
}

#[test]
fn renewing_codes_replaces_them_all() {
    let (_t, s) = setup();
    let auth = Auth::new();
    let old = auth
        .set_first_pin(&s, "admin", "99999", SystemTime::now())
        .unwrap()
        .recovery_codes
        .unwrap();
    let now = Instant::now();
    let (check, set) = auth
        .renew_recovery_codes(&s, "99999", now, SystemTime::now())
        .unwrap();
    assert_eq!(check, Check::Ok);
    let new = set.unwrap().recovery_codes.unwrap();
    assert_eq!(new.len(), RECOVERY_CODES);
    auth.logout();
    let (check, _) = auth
        .recover(&s, "admin", &old[0], "11111", now, SystemTime::now())
        .unwrap();
    assert!(matches!(check, Check::Wrong { .. }));
    let (check, _) = auth
        .recover(&s, "admin", &new[0], "11111", now, SystemTime::now())
        .unwrap();
    assert_eq!(check, Check::Ok);
}

#[test]
fn the_cli_reset_clears_admin_pins_and_codes_only() {
    let (_t, s) = setup();
    let auth = Auth::new();
    auth.set_first_pin(&s, "admin", "99999", SystemTime::now())
        .unwrap();
    auth.set_first_pin(&s, "gebr-1", "12345", SystemTime::now())
        .unwrap();
    assert_eq!(reset_admin_pins(&s, SystemTime::now()).unwrap(), ["admin"]);
    let a = user(&s, "admin");
    assert!(a.get(PIN_FIELD).is_none() && a.get(RECOVERY_FIELD).is_none());
    assert_eq!(a["_meta"]["updatedBy"], Value::Null);
    assert!(user(&s, "gebr-1").get(PIN_FIELD).is_some());
}

#[test]
fn user_ids_must_be_plain_file_ids() {
    for bad in ["", "../x", "a/b", "a.b", "a b"] {
        assert!(user_path(bad).is_err(), "{bad}");
    }
}

#[test]
fn a_deactivated_admin_cannot_use_a_recovery_code() {
    let (_t, s) = setup();
    let auth = Auth::new();
    let codes = auth
        .set_first_pin(&s, "admin", "99999", SystemTime::now())
        .unwrap()
        .recovery_codes
        .unwrap();
    auth.logout();
    let mut u = user(&s, "admin");
    u["actief"] = json!(false);
    s.write_json(&user_path("admin").unwrap(), &u, Expect::Any)
        .unwrap();
    assert!(
        auth.recover(
            &s,
            "admin",
            &codes[0],
            "11111",
            Instant::now(),
            SystemTime::now()
        )
        .is_err()
    );
    assert!(auth.require_admin(&s).is_err());
}
