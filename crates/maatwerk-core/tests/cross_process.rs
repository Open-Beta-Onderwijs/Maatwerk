// SPDX-License-Identifier: AGPL-3.0-or-later

//! S37 across processes: two app instances (or the app and the CLI) on one PC share the data
//! folder. The test binary starts itself twice as a worker; together with the parent, three
//! processes increment one counter through `Storage::update`. No increment may be lost.

use std::path::Path;
use std::process::Command;

use maatwerk_core::paths::RelPath;
use maatwerk_core::storage::Storage;
use serde_json::json;

const DIR_ENV: &str = "MAATWERK_TEST_WORKER_DIR";
const ROUNDS: i64 = 60;

fn increment(dir: &Path) {
    let storage = Storage::open_with_lock_dir(dir.join("data"), &dir.join("locks")).unwrap();
    let counter = RelPath::parse("2025-2026/scores/nat/1.json").unwrap();
    for _ in 0..ROUNDS {
        loop {
            let r = storage.update(
                &counter,
                || json!({"n": 0}),
                |mut cur, _| {
                    cur["n"] = json!(cur["n"].as_i64().unwrap() + 1);
                    Ok(cur)
                },
            );
            match r {
                Ok(_) => break,
                Err(e) => assert_eq!(e.code(), "conflict", "{e}"),
            }
        }
    }
}

/// Does nothing unless started by `three_processes_lose_no_update`.
#[test]
fn worker() {
    if let Some(dir) = std::env::var_os(DIR_ENV) {
        increment(Path::new(&dir));
    }
}

#[test]
fn three_processes_lose_no_update() {
    let tmp = tempfile::tempdir().unwrap();
    let exe = std::env::current_exe().unwrap();
    let children: Vec<_> = (0..2)
        .map(|_| {
            Command::new(&exe)
                .args(["--exact", "worker", "--test-threads=1"])
                .env(DIR_ENV, tmp.path())
                .spawn()
                .unwrap()
        })
        .collect();
    increment(tmp.path());
    for mut child in children {
        assert!(child.wait().unwrap().success());
    }
    let storage =
        Storage::open_with_lock_dir(tmp.path().join("data"), &tmp.path().join("locks")).unwrap();
    let value = storage.read_json(&RelPath::parse("2025-2026/scores/nat/1.json").unwrap());
    assert_eq!(value.unwrap(), Some(json!({"n": 3 * ROUNDS})));
}
