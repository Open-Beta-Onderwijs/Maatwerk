// SPDX-License-Identifier: AGPL-3.0-or-later

//! Storage spec rows (`docs/specs/storage-spec.md`). Test names start with the row id.

use std::sync::Mutex;
use std::time::{Duration, UNIX_EPOCH};

use serde_json::json;

use super::*;

fn rel(s: &str) -> RelPath {
    RelPath::parse(s).unwrap()
}

fn setup() -> (tempfile::TempDir, Storage) {
    let tmp = tempfile::tempdir().unwrap();
    let storage =
        Storage::open_with_lock_dir(tmp.path().join("data"), &tmp.path().join("locks")).unwrap();
    (tmp, storage)
}

fn disk(s: &Storage, p: &str) -> Vec<u8> {
    fs::read(s.data_dir().resolve(&rel(p)).unwrap()).unwrap()
}

fn put(s: &Storage, p: &str, bytes: &[u8]) {
    let path = s.data_dir().resolve(&rel(p)).unwrap();
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, bytes).unwrap();
}

#[derive(Default)]
struct Notes(Mutex<Vec<String>>);

impl WriteObserver for Notes {
    fn will_change(&self, rel: &RelPath) {
        self.0.lock().unwrap().push(format!("will {rel}"));
    }
    fn change_failed(&self, rel: &RelPath) {
        self.0.lock().unwrap().push(format!("failed {rel}"));
    }
    fn note_write(&self, rel: &RelPath, content: &[u8]) {
        self.0
            .lock()
            .unwrap()
            .push(format!("write {rel} {}", String::from_utf8_lossy(content)));
    }
    fn note_delete(&self, rel: &RelPath) {
        self.0.lock().unwrap().push(format!("delete {rel}"));
    }
}

#[test]
fn s07_hash_is_sha1_hex_of_the_bytes() {
    assert_eq!(hash_hex(b"abc"), "a9993e364706816aba3e25717850c26c9cd0d89d");
    let (_t, s) = setup();
    assert_eq!(s.read_json_versioned(&rel("missing.json")).unwrap(), None);
    put(&s, "x.json", b"{\"a\": 1}");
    let v = s.read_json_versioned(&rel("x.json")).unwrap().unwrap();
    assert_eq!(v.hash, hash_hex(b"{\"a\": 1}"));
    assert_eq!(v.data, json!({"a": 1}));
}

#[test]
fn s08_read_json_distinguishes_missing_from_corrupt() {
    let (_t, s) = setup();
    assert_eq!(s.read_json(&rel("nope.json")).unwrap(), None);
    put(&s, "bad.json", b"{\"a\":");
    assert_eq!(
        s.read_json(&rel("bad.json")).unwrap_err().code(),
        "corrupt_json"
    );
    put(&s, "bom.json", b"\xEF\xBB\xBF{}");
    assert_eq!(
        s.read_json(&rel("bom.json")).unwrap_err().code(),
        "corrupt_json"
    );
    put(&s, "null.json", b"null");
    assert_eq!(s.read_json(&rel("null.json")).unwrap(), Some(Value::Null));
}

#[test]
fn s09_versioned_read_corrupt_is_an_error() {
    let (_t, s) = setup();
    put(&s, "bad.json", b"nope");
    assert_eq!(
        s.read_json_versioned(&rel("bad.json")).unwrap_err().code(),
        "corrupt_json"
    );
}

#[test]
fn s10_write_json_is_js_stringify_without_newline_and_returns_its_hash() {
    let (_t, s) = setup();
    let value = json!({"b": [1, 2.5], "a": {"x": null}});
    let hash = s.write_json(&rel("a/b.json"), &value, Expect::Any).unwrap();
    let text = "{\n  \"b\": [\n    1,\n    2.5\n  ],\n  \"a\": {\n    \"x\": null\n  }\n}";
    assert_eq!(disk(&s, "a/b.json"), text.as_bytes());
    assert_eq!(hash, hash_hex(text.as_bytes()));
    s.write_json(&rel("n.json"), &Value::Null, Expect::Any)
        .unwrap();
    assert_eq!(disk(&s, "n.json"), b"null");
}

#[test]
fn s11_cas_writes_on_matching_hash_and_conflicts_otherwise() {
    let (_t, s) = setup();
    let h1 = s
        .write_json(&rel("c.json"), &json!(1), Expect::Missing)
        .unwrap();
    let h2 = s
        .write_json(&rel("c.json"), &json!(2), Expect::Hash(&h1))
        .unwrap();
    let err = s
        .write_json(&rel("c.json"), &json!(3), Expect::Hash(&h1))
        .unwrap_err();
    assert_eq!(err.code(), "conflict");
    assert_eq!(disk(&s, "c.json"), b"2");
    // The temp file written before the check is removed on a conflict.
    let names: Vec<_> = walk(s.data_dir().root())
        .iter()
        .map(|p| s.data_dir().rel_of(p).unwrap())
        .collect();
    assert_eq!(names, vec!["c.json"]);
    assert_eq!(h2, hash_hex(b"2"));
}

#[test]
fn s12_expect_missing_requires_absence() {
    let (_t, s) = setup();
    s.write_json(&rel("m.json"), &json!(1), Expect::Missing)
        .unwrap();
    let err = s
        .write_json(&rel("m.json"), &json!(2), Expect::Missing)
        .unwrap_err();
    assert_eq!(err.code(), "conflict");
    assert_eq!(disk(&s, "m.json"), b"1");
}

#[test]
fn s13_s16_no_lock_files_in_the_data_folder() {
    // C3: no `.lock` next to any file, score or not; a leftover `.lock` from the old app does
    // not block anything.
    let (_t, s) = setup();
    put(&s, "school.json.lock", b"");
    s.write_json(&rel("school.json"), &json!({}), Expect::Any)
        .unwrap();
    s.write_json(&rel("2025-2026/scores/nat/1.json"), &json!({}), Expect::Any)
        .unwrap();
    s.delete(&rel("school.json")).unwrap();
    let mut names = vec![];
    for e in walk(s.data_dir().root()) {
        names.push(s.data_dir().rel_of(&e).unwrap());
    }
    names.sort();
    assert_eq!(
        names,
        vec!["2025-2026/scores/nat/1.json", "school.json.lock"]
    );
}

fn walk(dir: &Path) -> Vec<PathBuf> {
    let mut out = vec![];
    for e in fs::read_dir(dir).unwrap() {
        let p = e.unwrap().path();
        if p.is_dir() {
            out.extend(walk(&p))
        } else {
            out.push(p)
        }
    }
    out
}

#[test]
fn s18_own_writes_and_deletes_are_noted() {
    let (_t, mut s) = setup();
    let notes = Arc::new(Notes::default());
    s.set_observer(notes.clone());
    s.write_json(&rel("a.json"), &json!([1]), Expect::Any)
        .unwrap();
    s.write_text(&rel("opdrachten/x.typ"), "= Hi").unwrap();
    s.delete(&rel("gone.json")).unwrap();
    s.save_photo(&rel("fotos/p.png"), "AAEC").unwrap();
    let _ = s.write_json(&rel("a.json"), &json!(2), Expect::Missing); // conflict: not noted
    assert_eq!(
        *notes.0.lock().unwrap(),
        vec![
            "will a.json",
            "write a.json [\n  1\n]",
            "will opdrachten/x.typ",
            "write opdrachten/x.typ = Hi",
            "will gone.json",
            "delete gone.json"
        ]
    );
}

#[test]
fn s19_delete_missing_is_ok() {
    let (_t, s) = setup();
    s.delete(&rel("never/was.json")).unwrap();
    put(&s, "x.json", b"1");
    s.delete(&rel("x.json")).unwrap();
    assert_eq!(s.read_json(&rel("x.json")).unwrap(), None);
}

#[test]
fn s20_update_gets_current_or_fallback_and_writes_with_cas() {
    let (_t, s) = setup();
    let seen = Mutex::new(vec![]);
    let out = s
        .update(
            &rel("u.json"),
            || json!([]),
            |mut cur, on_disk| {
                seen.lock().unwrap().push((cur.clone(), on_disk.cloned()));
                cur.as_array_mut().unwrap().push(json!(1));
                Ok(cur)
            },
        )
        .unwrap();
    assert_eq!(out, json!([1]));
    s.update(
        &rel("u.json"),
        || json!([]),
        |mut cur, on_disk| {
            seen.lock().unwrap().push((cur.clone(), on_disk.cloned()));
            cur.as_array_mut().unwrap().push(json!(2));
            Ok(cur)
        },
    )
    .unwrap();
    assert_eq!(
        *seen.lock().unwrap(),
        vec![(json!([]), None), (json!([1]), Some(json!([1])))]
    );
    assert_eq!(s.read_json(&rel("u.json")).unwrap(), Some(json!([1, 2])));
}

#[test]
fn s21_update_reapplies_after_a_concurrent_write() {
    let (_t, s) = setup();
    s.write_json(&rel("l.json"), &json!(["a"]), Expect::Any)
        .unwrap();
    let mut first = true;
    s.update(
        &rel("l.json"),
        || json!([]),
        |mut cur, _| {
            if first {
                first = false;
                // Another writer lands between our read and our write.
                s.write_json(&rel("l.json"), &json!(["a", "other"]), Expect::Any)
                    .unwrap();
            }
            cur.as_array_mut().unwrap().push(json!("mine"));
            Ok(cur)
        },
    )
    .unwrap();
    assert_eq!(
        s.read_json(&rel("l.json")).unwrap(),
        Some(json!(["a", "other", "mine"]))
    );
}

#[test]
fn s22_update_gives_up_after_five_conflicts() {
    let (_t, s) = setup();
    s.write_json(&rel("k.json"), &json!(0), Expect::Any)
        .unwrap();
    let mut calls = 0;
    let err = s
        .update(
            &rel("k.json"),
            || json!(0),
            |cur, _| {
                calls += 1;
                s.write_json(&rel("k.json"), &json!(100 + calls), Expect::Any)
                    .unwrap();
                Ok(cur)
            },
        )
        .unwrap_err();
    assert_eq!(err.code(), "conflict");
    assert_eq!(calls, 5);
}

#[test]
fn s23_update_does_not_retry_other_errors() {
    let (_t, s) = setup();
    let mut calls = 0;
    let err = s
        .update(
            &rel("e.json"),
            || json!(0),
            |_, _| {
                calls += 1;
                Err(Error::InvalidArgument {
                    message: "nope".into(),
                })
            },
        )
        .unwrap_err();
    assert_eq!(err.code(), "invalid_argument");
    assert_eq!(calls, 1);
    assert_eq!(s.read_json(&rel("e.json")).unwrap(), None);
}

#[test]
fn s24_update_never_overwrites_an_unreadable_file() {
    let (_t, s) = setup();
    put(&s, "p.json", b"{\"half");
    let err = s
        .update(&rel("p.json"), || json!({}), |c, _| Ok(c))
        .unwrap_err();
    assert_eq!(err.code(), "corrupt_json");
    assert_eq!(disk(&s, "p.json"), b"{\"half");
}

#[test]
fn s25_updates_of_one_file_are_serialised_and_a_failing_mutator_only_aborts_itself() {
    let (_t, s) = setup();
    std::thread::scope(|scope| {
        for i in 0..8 {
            let s = &s;
            scope.spawn(move || {
                let r = s.update(
                    &rel("q.json"),
                    || json!([]),
                    |mut cur, _| {
                        if i == 3 {
                            return Err(Error::InvalidArgument {
                                message: "boom".into(),
                            });
                        }
                        cur.as_array_mut().unwrap().push(json!(i));
                        Ok(cur)
                    },
                );
                assert_eq!(r.is_err(), i == 3);
            });
        }
    });
    let mut got: Vec<i64> = s
        .read_json(&rel("q.json"))
        .unwrap()
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_i64().unwrap())
        .collect();
    got.sort();
    assert_eq!(got, vec![0, 1, 2, 4, 5, 6, 7]);
}

fn at(ms: u64) -> std::time::SystemTime {
    UNIX_EPOCH + Duration::from_millis(ms)
}

#[test]
fn s26_save_entity_stamps_meta() {
    let (_t, s) = setup();
    let e = rel("exams/x.json");
    // New file: rev 1, created = updated = now/user.
    let v1 = s
        .save_entity(
            &e,
            &json!({"title": "T"}),
            None,
            false,
            Some("jan"),
            at(1_700_000_000_000),
        )
        .unwrap();
    assert_eq!(
        v1,
        json!({"title": "T", "_meta": {"rev": 1, "createdBy": "jan", "createdAt": "2023-11-14T22:13:20.000Z", "updatedBy": "jan", "updatedAt": "2023-11-14T22:13:20.000Z"}})
    );
    // Update: rev 2, created* kept, an incoming _meta keeps its key position.
    let v2 = s
        .save_entity(
            &e,
            &json!({"_meta": {"rev": 1}, "title": "U"}),
            Some(1),
            false,
            Some("piet"),
            at(1_700_000_000_123),
        )
        .unwrap();
    assert_eq!(
        to_js_json(&v2),
        to_js_json(
            &json!({"_meta": {"rev": 2, "createdBy": "jan", "createdAt": "2023-11-14T22:13:20.000Z", "updatedBy": "piet", "updatedAt": "2023-11-14T22:13:20.123Z"}, "title": "U"})
        )
    );
    // Legacy file without _meta counts as rev 0; created* become null.
    put(&s, "groups/g.json", b"{\"name\": \"G\"}");
    let v3 = s
        .save_entity(
            &rel("groups/g.json"),
            &json!({"name": "H"}),
            None,
            false,
            None,
            at(0),
        )
        .unwrap();
    assert_eq!(
        v3["_meta"],
        json!({"rev": 1, "createdBy": null, "createdAt": null, "updatedBy": null, "updatedAt": "1970-01-01T00:00:00.000Z"})
    );
}

#[test]
fn s27_save_entity_stale_base_rev_conflicts_with_updated_by_and_force_overwrites() {
    let (_t, s) = setup();
    let e = rel("observaties/o.json");
    s.save_entity(&e, &json!({"t": 1}), None, false, Some("jan"), at(0))
        .unwrap();
    s.save_entity(&e, &json!({"t": 2}), Some(1), false, Some("jan"), at(1))
        .unwrap();
    let err = s
        .save_entity(&e, &json!({"t": 3}), Some(1), false, Some("piet"), at(2))
        .unwrap_err();
    match err {
        Error::Conflict { updated_by, .. } => assert_eq!(updated_by.as_deref(), Some("jan")),
        other => panic!("{other:?}"),
    }
    assert_eq!(s.read_json(&e).unwrap().unwrap()["t"], json!(2));
    let forced = s
        .save_entity(&e, &json!({"t": 3}), Some(1), true, Some("piet"), at(3))
        .unwrap();
    assert_eq!(forced["_meta"]["rev"], json!(3));
    // A new file accepts any base rev.
    s.save_entity(
        &rel("observaties/new.json"),
        &json!({}),
        Some(7),
        false,
        None,
        at(0),
    )
    .unwrap();
}

#[test]
fn s37_cas_is_atomic_across_handles() {
    // Two handles on one folder (as two windows or instances would have), many threads doing
    // read-increment-CAS. Every successful CAS must be counted: no update is lost.
    let tmp = tempfile::tempdir().unwrap();
    let locks = tmp.path().join("locks");
    let a = Storage::open_with_lock_dir(tmp.path().join("d"), &locks).unwrap();
    let b = Storage::open_with_lock_dir(tmp.path().join("d"), &locks).unwrap();
    let counter = rel("2025-2026/scores/nat/1.json");
    a.write_json(&counter, &json!({"n": 0}), Expect::Any)
        .unwrap();
    let successes = std::sync::atomic::AtomicUsize::new(0);
    std::thread::scope(|scope| {
        for t in 0..8 {
            let s = if t % 2 == 0 { &a } else { &b };
            let (successes, counter) = (&successes, &counter);
            scope.spawn(move || {
                for _ in 0..40 {
                    let v = s.read_json_versioned(counter).unwrap().unwrap();
                    let n = v.data["n"].as_i64().unwrap();
                    match s.write_json(counter, &json!({"n": n + 1}), Expect::Hash(&v.hash)) {
                        Ok(_) => {
                            successes.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        }
                        Err(e) => assert_eq!(e.code(), "conflict"),
                    }
                }
            });
        }
    });
    let n = a.read_json(&counter).unwrap().unwrap()["n"]
        .as_i64()
        .unwrap();
    assert_eq!(n as usize, successes.into_inner());
}

#[test]
fn s38_updates_from_two_handles_lose_nothing() {
    let tmp = tempfile::tempdir().unwrap();
    let locks = tmp.path().join("locks");
    let a = Storage::open_with_lock_dir(tmp.path().join("d"), &locks).unwrap();
    let b = Storage::open_with_lock_dir(tmp.path().join("d"), &locks).unwrap();
    let file = rel("school.json");
    std::thread::scope(|scope| {
        for t in 0..6 {
            let s = if t % 2 == 0 { &a } else { &b };
            let file = &file;
            scope.spawn(move || {
                for _ in 0..20 {
                    // update() retries 5 times; under this much contention that can run out,
                    // which is a clean error, never a lost update.
                    loop {
                        let r = s.update(
                            file,
                            || json!({"n": 0}),
                            |mut cur, _| {
                                cur["n"] = json!(cur["n"].as_i64().unwrap() + 1);
                                Ok(cur)
                            },
                        );
                        match r {
                            Ok(_) => break,
                            Err(e) => assert_eq!(e.code(), "conflict"),
                        }
                    }
                }
            });
        }
    });
    assert_eq!(a.read_json(&file).unwrap(), Some(json!({"n": 120})));
}

#[test]
fn reads_during_concurrent_replaces_never_look_like_an_escape() {
    // Regression: `resolve` canonicalised the file itself; a file being replaced resolves to
    // `\$Extend\$Deleted\...` on NTFS, which looked like a path outside the data folder.
    let (_t, s) = setup();
    let file = rel("2025-2026/scores/nat/1.json");
    s.write_json(&file, &json!(0), Expect::Any).unwrap();
    let done = std::sync::atomic::AtomicBool::new(false);
    std::thread::scope(|scope| {
        for _ in 0..4 {
            scope.spawn(|| {
                while !done.load(std::sync::atomic::Ordering::Relaxed) {
                    match s.read_json(&file) {
                        Ok(_) => {}
                        // Windows may refuse a read for a moment while the file is replaced.
                        Err(e) => assert_eq!(e.code(), "io", "{e}"),
                    }
                }
            });
        }
        for i in 0..400 {
            s.write_json(&file, &json!(i), Expect::Any).unwrap();
        }
        done.store(true, std::sync::atomic::Ordering::Relaxed);
    });
}

#[test]
fn commit_lock_held_by_another_process_gives_locked() {
    let tmp = tempfile::tempdir().unwrap();
    let locks = tmp.path().join("locks");
    let mut s = Storage::open_with_lock_dir(tmp.path().join("d"), &locks).unwrap();
    s.set_lock_timeout(Duration::from_millis(50));
    // Simulate another process: hold the OS lock on the lock file from a separate handle.
    let lock_file = fs::read_dir(&locks)
        .unwrap()
        .next()
        .map(|e| e.unwrap().path());
    let lock_file = match lock_file {
        Some(p) => p,
        None => {
            s.write_json(&rel("x.json"), &json!(1), Expect::Any)
                .unwrap();
            fs::read_dir(&locks)
                .unwrap()
                .next()
                .unwrap()
                .unwrap()
                .path()
        }
    };
    let other = fs::OpenOptions::new().write(true).open(&lock_file).unwrap();
    other.lock().unwrap();
    let err = s
        .write_json(&rel("x.json"), &json!(2), Expect::Any)
        .unwrap_err();
    assert_eq!(err.code(), "locked");
    drop(other);
    s.write_json(&rel("x.json"), &json!(3), Expect::Any)
        .unwrap();
    // The lock lives in the local lock folder, never in the data folder.
    assert!(
        walk(s.data_dir().root())
            .iter()
            .all(|p| p.extension().is_none_or(|e| e != "lock"))
    );
}

#[test]
fn paths_from_the_ui_are_checked_by_every_method() {
    let (_t, s) = setup();
    for bad in ["../x.json", "C:/x.json", "/x.json", "a/../../x"] {
        assert!(RelPath::parse(bad).is_err());
    }
    assert_eq!(
        s.ensure_year("../../evil").unwrap_err().code(),
        "invalid_argument"
    );
}

#[test]
fn list_years_newest_first_dirs_only() {
    let (_t, s) = setup();
    for y in ["2023-2024", "2025-2026", "2024-2025"] {
        s.ensure_year(y).unwrap();
    }
    put(&s, "2026-2027", b"not a dir");
    fs::create_dir_all(s.data_dir().root().join("fotos")).unwrap();
    fs::create_dir_all(s.data_dir().root().join("2025-26")).unwrap();
    assert_eq!(s.list_years(), vec!["2025-2026", "2024-2025", "2023-2024"]);
}

#[test]
fn ensure_year_creates_the_subfolders() {
    let (_t, s) = setup();
    let dir = s.ensure_year("2025-2026").unwrap();
    for sub in [
        "exams",
        "groups",
        "scores/nat",
        "scores/bio",
        "scores/schk",
        "scores/wi",
    ] {
        assert!(dir.join(sub).is_dir(), "{sub}");
    }
}

#[test]
fn read_all_json_skips_folders_nulls_and_garbage() {
    let (_t, s) = setup();
    assert_eq!(s.read_all_json(&rel("exams")).unwrap(), Vec::<Value>::new());
    put(&s, "exams/a.json", b"{\"id\": \"a\"}");
    put(&s, "exams/b.json", b"null");
    put(&s, "exams/c.json", b"{oops");
    put(&s, "exams/d.txt", b"{}");
    put(&s, "exams/e.json/inner.json", b"{}");
    put(&s, "exams/f.json", b"[1]");
    let mut got: Vec<String> = s
        .read_all_json(&rel("exams"))
        .unwrap()
        .iter()
        .map(|v| v.to_string())
        .collect();
    got.sort();
    assert_eq!(got, vec!["[1]", "{\"id\":\"a\"}"]);
}

#[test]
fn text_files_round_trip() {
    let (_t, s) = setup();
    assert_eq!(s.read_text(&rel("opdrachten/a.typ")).unwrap(), None);
    s.write_text(&rel("opdrachten/a.typ"), "= Opgave 1\n")
        .unwrap();
    assert_eq!(
        s.read_text(&rel("opdrachten/a.typ")).unwrap().as_deref(),
        Some("= Opgave 1\n")
    );
}

#[test]
fn photos_as_data_urls() {
    let (_t, s) = setup();
    assert_eq!(s.read_photo_data_url(&rel("fotos/none.png")).unwrap(), None);
    s.save_photo(&rel("fotos/a.png"), "iVBO\nRw0K").unwrap();
    assert_eq!(
        disk(&s, "fotos/a.png"),
        [0x89, b'P', b'N', b'G', 0x0d, 0x0a]
    );
    assert_eq!(
        s.read_photo_data_url(&rel("fotos/a.png")).unwrap().unwrap(),
        "data:image/png;base64,iVBORw0K"
    );
    s.save_photo(&rel("fotos/b.SVG"), "PHN2Zy8-").unwrap(); // url-safe, no padding
    assert_eq!(disk(&s, "fotos/b.SVG"), b"<svg/>");
    assert!(
        s.read_photo_data_url(&rel("fotos/b.SVG"))
            .unwrap()
            .unwrap()
            .starts_with("data:image/svg+xml;base64,")
    );
    s.save_photo(&rel("fotos/c.bmp"), "AA==").unwrap();
    assert!(
        s.read_photo_data_url(&rel("fotos/c.bmp"))
            .unwrap()
            .unwrap()
            .starts_with("data:image/jpeg;")
    );
    assert_eq!(
        s.save_photo(&rel("fotos/d.png"), "!!!").unwrap_err().code(),
        "invalid_argument"
    );
}

#[test]
fn seed_creates_admin_once_and_folders() {
    let (_t, s) = setup();
    s.seed_initial_data().unwrap();
    let users = s.read_json(&rel("gebruikers.json")).unwrap().unwrap();
    assert_eq!(users[0]["id"], json!("admin"));
    assert_eq!(users[0]["vakken"], json!(["nat", "bio", "schk", "wi"]));
    assert!(s.data_dir().root().join("fotos").is_dir());
    assert!(s.data_dir().root().join("opdrachten/images").is_dir());
    s.write_json(&rel("gebruikers.json"), &json!([{"id": "x"}]), Expect::Any)
        .unwrap();
    s.seed_initial_data().unwrap();
    assert_eq!(
        s.read_json(&rel("gebruikers.json")).unwrap(),
        Some(json!([{"id": "x"}]))
    );
}

#[test]
fn schema_version_c1() {
    let tmp = tempfile::tempdir().unwrap();
    let locks = tmp.path().join("locks");
    let data = tmp.path().join("d");
    let open = || Storage::open_with_lock_dir(&data, &locks);
    open().unwrap(); // no config.json
    fs::write(data.join("config.json"), "{\"activeYear\": \"2025-2026\"}").unwrap();
    open().unwrap(); // reference format, no version
    fs::write(data.join("config.json"), "{\"schema_version\": 1}").unwrap();
    open().unwrap();
    fs::write(data.join("config.json"), "{\"half").unwrap();
    open().unwrap(); // unreadable (still syncing?) does not block
    for v in ["2", "99", "\"1\"", "1.5"] {
        fs::write(
            data.join("config.json"),
            format!("{{\"schema_version\": {v}}}"),
        )
        .unwrap();
        assert_eq!(
            open().err().map(|e| e.code()),
            Some("unsupported_schema"),
            "{v}"
        );
    }
}

#[test]
fn local_session_round_trip() {
    let tmp = tempfile::tempdir().unwrap();
    let session = LocalSession::new(tmp.path().join("cfg/session.json"));
    assert_eq!(session.read(), None);
    session
        .write(&json!({"userId": "jan", "activeYear": "2025-2026"}))
        .unwrap();
    assert_eq!(
        session.read(),
        Some(json!({"userId": "jan", "activeYear": "2025-2026"}))
    );
    fs::write(tmp.path().join("cfg/session.json"), "{").unwrap();
    assert_eq!(session.read(), None);
}

#[test]
fn iso_utc_matches_to_iso_string() {
    assert_eq!(iso_utc(at(0)), "1970-01-01T00:00:00.000Z");
    assert_eq!(iso_utc(at(951_782_400_000)), "2000-02-29T00:00:00.000Z");
    assert_eq!(iso_utc(at(1_793_000_000_042)), "2026-10-26T07:33:20.042Z");
    assert_eq!(
        iso_utc(UNIX_EPOCH - Duration::from_millis(1)),
        "1969-12-31T23:59:59.999Z"
    );
}
