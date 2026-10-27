// SPDX-License-Identifier: AGPL-3.0-or-later

//! Watcher spec rows S28-S40 (`docs/specs/storage-spec.md`). The engine runs on a virtual
//! clock against a real temp folder; the driver tests use real threads.

use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde_json::json;

use super::engine::{DEBOUNCE, Engine, FLUSH};
use super::*;
use crate::storage::{Expect, Storage};

struct Rig {
    _tmp: tempfile::TempDir,
    root: PathBuf,
    engine: Engine,
    t0: Instant,
}

impl Rig {
    fn new() -> Rig {
        Rig::with_files(&[])
    }

    /// Files present before the watcher starts (the initial snapshot sees them).
    fn with_files(files: &[(&str, &str)]) -> Rig {
        let tmp = tempfile::tempdir().unwrap();
        let dir = DataDir::open(tmp.path()).unwrap();
        let root = dir.root().to_path_buf();
        for (rel, content) in files {
            write_file(&root, rel, content);
        }
        let mut engine = Engine::new(dir);
        engine.snapshot();
        Rig {
            _tmp: tmp,
            root,
            engine,
            t0: Instant::now(),
        }
    }

    fn write(&self, rel: &str, content: &str) {
        write_file(&self.root, rel, content);
    }

    fn remove(&self, rel: &str) {
        std::fs::remove_file(self.path(rel)).unwrap();
    }

    fn path(&self, rel: &str) -> PathBuf {
        let mut p = self.root.clone();
        p.extend(rel.split('/'));
        p
    }

    fn at(&self, ms: u64) -> Instant {
        self.t0 + Duration::from_millis(ms)
    }

    /// An OS notification for `rel` at `ms`.
    fn event(&mut self, rel: &str, ms: u64) {
        let path = self.path(rel);
        let now = self.at(ms);
        self.engine.on_event(&path, now);
    }

    fn poll(&mut self, ms: u64) {
        let now = self.at(ms);
        self.engine.poll(now);
    }

    /// Batches flushed up to and including `ms`.
    fn run_to(&mut self, ms: u64) -> Vec<Vec<Change>> {
        let now = self.at(ms);
        self.engine.advance(now)
    }

    /// Every change flushed up to `ms`, flattened.
    fn changes_to(&mut self, ms: u64) -> Vec<Change> {
        self.run_to(ms).into_iter().flatten().collect()
    }
}

fn write_file(root: &std::path::Path, rel: &str, content: &str) {
    let mut p = root.to_path_buf();
    p.extend(rel.split('/'));
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, content).unwrap();
}

fn change(rel: &str, kind: ChangeKind, meta: Option<Value>) -> Change {
    Change::new(rel, kind, meta)
}

const SETTLE: u64 = 600; // debounce + flush

#[test]
fn s28_external_add_is_reported_after_debounce_and_flush() {
    let mut rig = Rig::new();
    rig.write("gebruikers.json", r#"{"_meta":{"rev":1},"x":1}"#);
    rig.event("gebruikers.json", 0);
    assert!(rig.changes_to(SETTLE - 1).is_empty());
    assert_eq!(
        rig.changes_to(SETTLE),
        [change(
            "gebruikers.json",
            ChangeKind::Added,
            Some(json!({"rev": 1}))
        )]
    );
    assert_eq!(
        (DEBOUNCE + FLUSH).as_millis(),
        u128::from(SETTLE),
        "reference timings"
    );
}

#[test]
fn s29_changes_and_deletes_are_reported_and_meta_is_null_without_object_meta() {
    let mut rig = Rig::with_files(&[
        ("a.json", "[1]"),
        ("b.json", r#"{"x":1}"#),
        ("opdrachten/o.typ", "= Titel"),
        ("c.json", r#"{"_meta":{"rev":1}}"#),
    ]);
    rig.write("a.json", "[1, 2]");
    rig.write("b.json", r#"{"x":2}"#);
    rig.write("opdrachten/o.typ", "= Andere titel");
    rig.remove("c.json");
    for rel in ["a.json", "b.json", "opdrachten/o.typ", "c.json"] {
        rig.event(rel, 0);
    }
    let mut got = rig.changes_to(SETTLE);
    got.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    assert_eq!(
        got,
        [
            change("a.json", ChangeKind::Changed, None),
            change("b.json", ChangeKind::Changed, None),
            change("c.json", ChangeKind::Deleted, None),
            change("opdrachten/o.typ", ChangeKind::Changed, None),
        ]
    );
}

#[test]
fn s29_meta_null_is_reported_as_none() {
    let mut rig = Rig::new();
    rig.write("a.json", r#"{"_meta":null}"#);
    rig.event("a.json", 0);
    assert_eq!(
        rig.changes_to(SETTLE),
        [change("a.json", ChangeKind::Added, None)]
    );
}

#[test]
fn s30_own_writes_and_deletes_are_never_reported() {
    let mut rig = Rig::with_files(&[("b.json", "{}")]);
    rig.write("a.json", r#"{"own":1}"#);
    rig.engine.note_write("a.json", br#"{"own":1}"#);
    rig.remove("b.json");
    rig.engine.note_delete("b.json");
    rig.event("a.json", 0);
    rig.event("b.json", 0);
    assert!(rig.changes_to(5_000).is_empty());
    // Nor by the poll.
    rig.poll(10_000);
    assert!(rig.changes_to(20_000).is_empty());
}

#[test]
fn s30_a_later_external_change_to_an_own_file_is_reported() {
    let mut rig = Rig::new();
    rig.write("a.json", r#"{"own":1}"#);
    rig.engine.note_write("a.json", br#"{"own":1}"#);
    rig.write("a.json", r#"{"theirs":1}"#);
    rig.event("a.json", 0);
    assert_eq!(
        rig.changes_to(SETTLE),
        [change("a.json", ChangeKind::Changed, None)]
    );
}

#[test]
fn s31_relevance() {
    for rel in [
        "config.json",
        "2025-2026/exams/t1.json",
        "opdrachten/o.typ",
        "opdrachten/O.TYP",
        "users/u.JSON",
        "x/fotos/a.json",
        "x/temp/a.json",
        "x/rapporten/a.json",
    ] {
        assert!(is_relevant(rel), "{rel} should be watched");
    }
    for rel in [
        "fotos/a.json",
        "bak/a.json",
        "templates/a.typ",
        "temp/a.json",
        "rapporten/a.json",
        "opdrachten/_preview_x.typ",
        "_preview_x.json",
        "a.txt",
        "a.json.1234.tmp",
        "opdrachten/images/i/a.png",
        ".json",
        "json",
    ] {
        assert!(!is_relevant(rel), "{rel} should be ignored");
    }
}

#[test]
fn s31_events_for_ignored_files_are_dropped() {
    let mut rig = Rig::new();
    rig.write("fotos/a.json", "{}");
    rig.write("a.txt", "x");
    rig.event("fotos/a.json", 0);
    rig.event("a.txt", 0);
    assert!(rig.changes_to(5_000).is_empty());
    assert_eq!(rig.engine.next_deadline(), None);
}

#[test]
fn s32_poll_finds_missed_changes_outside_years_and_in_the_active_year_only() {
    let mut rig = Rig::with_files(&[(
        "config.json",
        r#"{"activeYear":"2025-2026","schoolName":"x"}"#,
    )]);
    rig.write("gebruikers.json", "[]");
    rig.write("2025-2026/exams/t1.json", "{}");
    rig.write("2024-2025/exams/t0.json", "{}");
    rig.write("fotos/f.json", "{}");
    rig.poll(0);
    let mut got: Vec<String> = rig
        .changes_to(SETTLE)
        .into_iter()
        .map(|c| c.rel_path)
        .collect();
    got.sort();
    assert_eq!(got, ["2025-2026/exams/t1.json", "gebruikers.json"]);
}

#[test]
fn s32_an_event_for_another_year_is_reported() {
    let mut rig = Rig::with_files(&[("config.json", r#"{"activeYear":"2025-2026"}"#)]);
    rig.write("2024-2025/exams/t0.json", "{}");
    rig.event("2024-2025/exams/t0.json", 0);
    assert_eq!(
        rig.changes_to(SETTLE),
        [change("2024-2025/exams/t0.json", ChangeKind::Added, None)]
    );
}

#[test]
fn s32_scope_year_overrides_config() {
    let mut rig = Rig::with_files(&[("config.json", r#"{"activeYear":"2025-2026"}"#)]);
    rig.engine.set_scope_year(Some("2024-2025".into()));
    rig.write("2025-2026/exams/t1.json", "{}");
    rig.write("2024-2025/exams/t0.json", "{}");
    rig.poll(0);
    let got: Vec<String> = rig
        .changes_to(SETTLE)
        .into_iter()
        .map(|c| c.rel_path)
        .collect();
    assert_eq!(got, ["2024-2025/exams/t0.json"]);
}

#[test]
fn s32_without_an_active_year_the_poll_skips_all_year_folders() {
    let mut rig = Rig::new();
    rig.write("2025-2026/exams/t1.json", "{}");
    rig.write("opdrachten.json", "[]");
    rig.poll(0);
    let got: Vec<String> = rig
        .changes_to(SETTLE)
        .into_iter()
        .map(|c| c.rel_path)
        .collect();
    assert_eq!(got, ["opdrachten.json"]);
}

#[test]
fn s33_poll_reports_deletes_of_known_files_in_scope_only() {
    let mut rig = Rig::with_files(&[
        ("config.json", r#"{"activeYear":"2025-2026"}"#),
        ("gebruikers.json", "[]"),
        ("2025-2026/exams/t1.json", "{}"),
        ("2024-2025/exams/t0.json", "{}"),
    ]);
    rig.remove("gebruikers.json");
    rig.remove("2025-2026/exams/t1.json");
    rig.remove("2024-2025/exams/t0.json");
    rig.poll(0);
    let mut got: Vec<(String, ChangeKind)> = rig
        .changes_to(SETTLE)
        .into_iter()
        .map(|c| (c.rel_path, c.kind))
        .collect();
    got.sort_by(|a, b| a.0.cmp(&b.0));
    assert_eq!(
        got,
        [
            ("2025-2026/exams/t1.json".into(), ChangeKind::Deleted),
            ("gebruikers.json".into(), ChangeKind::Deleted),
        ]
    );
}

#[test]
fn s34_quirk_first_touch_with_same_content_is_reported_later_touches_not() {
    let mut rig = Rig::with_files(&[("a.json", "{}")]);
    let touch = |rig: &Rig| {
        // A new mtime with the same bytes.
        let file = std::fs::File::options()
            .write(true)
            .open(rig.path("a.json"))
            .unwrap();
        let later = std::time::SystemTime::now() + Duration::from_secs(5);
        file.set_modified(later).unwrap();
    };
    touch(&rig);
    rig.event("a.json", 0);
    assert_eq!(
        rig.changes_to(SETTLE),
        [change("a.json", ChangeKind::Changed, None)]
    );
    touch(&rig);
    rig.event("a.json", 1_000);
    assert!(rig.changes_to(1_000 + SETTLE).is_empty());
}

#[test]
fn s35_unparsable_json_is_checked_once_more_after_a_second() {
    let mut rig = Rig::new();
    rig.write("a.json", r#"{"half":"#);
    rig.event("a.json", 0);
    assert!(rig.changes_to(1_000).is_empty());
    rig.write("a.json", r#"{"half":1}"#);
    // Check at 500 failed; retry at 1500; flush at 1600.
    assert!(rig.changes_to(1_599).is_empty());
    assert_eq!(
        rig.changes_to(1_600),
        [change("a.json", ChangeKind::Added, None)]
    );
}

#[test]
fn s35_still_unparsable_after_the_retry_waits_for_the_next_event() {
    let mut rig = Rig::new();
    rig.write("a.json", "{");
    rig.event("a.json", 0);
    assert!(rig.changes_to(10_000).is_empty());
    assert_eq!(rig.engine.next_deadline(), None, "no further retries");
    rig.write("a.json", "{}");
    rig.event("a.json", 20_000);
    assert_eq!(
        rig.changes_to(20_000 + SETTLE),
        [change("a.json", ChangeKind::Added, None)]
    );
}

#[test]
fn s36_events_within_the_debounce_give_one_check() {
    let mut rig = Rig::new();
    rig.write("a.json", "{}");
    rig.event("a.json", 0);
    rig.event("a.json", 300);
    rig.event("a.json", 700);
    assert!(
        rig.changes_to(1_000).is_empty(),
        "debounce restarted at 700"
    );
    let batches = rig.run_to(1_300);
    assert_eq!(batches, [vec![change("a.json", ChangeKind::Added, None)]]);
}

#[test]
fn s36_checks_within_100ms_of_the_first_emit_form_one_batch() {
    let mut rig = Rig::new();
    for rel in ["a.json", "b.json", "c.json"] {
        rig.write(rel, "{}");
    }
    rig.event("a.json", 0);
    rig.event("b.json", 99); // emitted at 599, inside a's flush window (500-600)
    rig.event("c.json", 150); // emitted at 650, after the flush at 600
    let batches = rig.run_to(10_000);
    let names: Vec<Vec<&str>> = batches
        .iter()
        .map(|b| b.iter().map(|c| c.rel_path.as_str()).collect())
        .collect();
    assert_eq!(names, [vec!["a.json", "b.json"], vec!["c.json"]]);
}

#[cfg(windows)]
#[test]
fn s40_an_unreadable_file_is_skipped_without_a_retry() {
    use std::os::windows::fs::OpenOptionsExt;
    let mut rig = Rig::new();
    rig.write("a.json", "{}");
    let exclusive = std::fs::File::options()
        .read(true)
        .share_mode(0)
        .open(rig.path("a.json"))
        .unwrap();
    rig.event("a.json", 0);
    assert!(rig.changes_to(10_000).is_empty());
    assert_eq!(rig.engine.next_deadline(), None);
    drop(exclusive);
    rig.event("a.json", 20_000);
    assert_eq!(
        rig.changes_to(20_000 + SETTLE),
        [change("a.json", ChangeKind::Added, None)]
    );
}

#[test]
fn a_link_out_of_the_data_folder_is_not_read() {
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(outside.path().join("x.json"), r#"{"_meta":{"secret":1}}"#).unwrap();
    let mut rig = Rig::new();
    let link = rig.path("lnk");
    #[cfg(windows)]
    let made = std::os::windows::fs::symlink_dir(outside.path(), &link)
        .or_else(|_| junction(outside.path(), &link));
    #[cfg(unix)]
    let made = std::os::unix::fs::symlink(outside.path(), &link);
    if made.is_err() {
        eprintln!("skipped: cannot create a link here");
        return;
    }
    rig.event("lnk/x.json", 0);
    assert!(rig.changes_to(10_000).is_empty());
}

#[cfg(windows)]
fn junction(target: &std::path::Path, link: &std::path::Path) -> std::io::Result<()> {
    let status = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(link)
        .arg(target)
        .output()?
        .status;
    if status.success() {
        Ok(())
    } else {
        Err(std::io::Error::other("mklink failed"))
    }
}

// ── Driver ───────────────────────────────────────────────────────────────────

fn recv_changes(rx: &mpsc::Receiver<Vec<Change>>, within: Duration) -> Vec<Change> {
    let deadline = Instant::now() + within;
    let mut out = vec![];
    while let Some(left) = deadline.checked_duration_since(Instant::now()) {
        match rx.recv_timeout(left) {
            Ok(batch) => out.extend(batch),
            Err(_) => break,
        }
    }
    out
}

#[test]
fn s39_after_a_notification_error_the_os_watch_is_restarted() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = DataDir::open(tmp.path()).unwrap();
    let starts = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&starts);
    let start: Box<StartOsWatch> = Box::new(move |_root, tx| {
        if counted.fetch_add(1, Ordering::SeqCst) == 0 {
            let _ = tx.send(Msg::WatchError("boom".into()));
        }
        Ok(Box::new(()))
    });
    let options = WatchOptions {
        poll: Duration::from_secs(60),
        restart: Duration::from_millis(200),
        refresh: Duration::from_secs(60),
    };
    let watcher = Watcher::start_with(dir, options, start, |_| {});
    let deadline = Instant::now() + Duration::from_secs(5);
    while starts.load(Ordering::SeqCst) < 2 && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(20));
    }
    watcher.close();
    assert_eq!(starts.load(Ordering::SeqCst), 2);
}

#[test]
fn s39_polling_continues_without_os_notifications() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = DataDir::open(tmp.path()).unwrap();
    let start: Box<StartOsWatch> = Box::new(|_, _| Err("unavailable".into()));
    let options = WatchOptions {
        poll: Duration::from_millis(700),
        restart: Duration::from_secs(60),
        refresh: Duration::from_secs(60),
    };
    let (tx, rx) = mpsc::channel();
    let watcher = Watcher::start_with(dir.clone(), options, start, move |b| {
        let _ = tx.send(b);
    });
    watcher.wait_ready();
    write_file(dir.root(), "a.json", "{}");
    let got = recv_changes(&rx, Duration::from_secs(3));
    watcher.close();
    assert_eq!(got, [change("a.json", ChangeKind::Added, None)]);
}

#[test]
fn driver_reports_external_writes_but_not_own_writes() {
    let tmp = tempfile::tempdir().unwrap();
    let locks = tempfile::tempdir().unwrap();
    let mut storage = Storage::open_with_lock_dir(tmp.path(), locks.path()).unwrap();
    let (tx, rx) = mpsc::channel();
    let watcher = Watcher::start(
        storage.data_dir().clone(),
        WatchOptions::default(),
        move |b| {
            let _ = tx.send(b);
        },
    );
    storage.set_observer(watcher.observer());
    watcher.wait_ready();
    let own = RelPath::parse("eigen.json").unwrap();
    storage
        .write_json(&own, &json!({"a": 1}), Expect::Any)
        .unwrap();
    write_file(storage.data_dir().root(), "extern.json", "{}");
    let got = recv_changes(&rx, Duration::from_secs(3));
    watcher.close();
    assert_eq!(got, [change("extern.json", ChangeKind::Added, None)]);
}

// ── Review 4b ────────────────────────────────────────────────────────────────

#[test]
fn m1_review_os_notifications_are_started_afresh_periodically() {
    // The Windows backend of notify stops silently on errors, so S39 alone is not enough.
    let tmp = tempfile::tempdir().unwrap();
    let dir = DataDir::open(tmp.path()).unwrap();
    let starts = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&starts);
    let start: Box<StartOsWatch> = Box::new(move |_root, _tx| {
        counted.fetch_add(1, Ordering::SeqCst);
        Ok(Box::new(()))
    });
    let options = WatchOptions {
        poll: Duration::from_secs(60),
        restart: Duration::from_secs(60),
        refresh: Duration::from_millis(100),
    };
    let watcher = Watcher::start_with(dir, options, start, |_| {});
    let deadline = Instant::now() + Duration::from_secs(5);
    while starts.load(Ordering::SeqCst) < 3 && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(20));
    }
    watcher.close();
    assert!(starts.load(Ordering::SeqCst) >= 3);
}

#[test]
#[should_panic(expected = "poll interval")]
fn n7_a_poll_shorter_than_the_debounce_is_refused() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = DataDir::open(tmp.path()).unwrap();
    let options = WatchOptions {
        poll: Duration::from_millis(100),
        ..WatchOptions::default()
    };
    let _ = Watcher::start(dir, options, |_| {});
}

#[test]
fn m1_a_check_during_an_own_write_waits_until_the_write_is_noted() {
    let mut rig = Rig::with_files(&[("a.json", r#"{"v":1}"#)]);
    // Storage: will_change, rename ... (the check runs here) ... note_write.
    rig.engine.will_change("a.json");
    rig.write("a.json", r#"{"v":2}"#);
    rig.event("a.json", 0);
    assert!(rig.changes_to(5_000).is_empty(), "not reported mid-write");
    rig.engine.note_write("a.json", br#"{"v":2}"#);
    assert!(rig.changes_to(20_000).is_empty(), "nor after it");
}

#[test]
fn m1_a_failed_own_write_releases_the_file() {
    let mut rig = Rig::with_files(&[("a.json", r#"{"v":1}"#)]);
    rig.engine.will_change("a.json");
    rig.engine.change_failed("a.json");
    rig.write("a.json", r#"{"v":3}"#); // a colleague's write
    rig.event("a.json", 0);
    assert_eq!(
        rig.changes_to(SETTLE),
        [change("a.json", ChangeKind::Changed, None)]
    );
}

#[test]
fn m4_own_writes_to_ignored_paths_are_not_tracked() {
    let mut rig = Rig::new();
    rig.write("templates/t.json", "{}");
    rig.engine.note_write("templates/t.json", b"{}");
    rig.write("templates/t.json", r#"{"colleague":1}"#);
    rig.poll(0);
    assert!(
        rig.changes_to(10_000).is_empty(),
        "S31: templates/ is ignored"
    );
}
