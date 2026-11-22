// SPDX-License-Identifier: AGPL-3.0-or-later

//! The AI runner against the scripted fake CLI (`src/bin/maatwerk-fake-ai.rs`, decision 61):
//! streaming, time limit, Stop, the process-tree kill and start failures.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use maatwerk_core::ai::events::AiEvent;
use maatwerk_core::ai::provider::StreamFormat;
use maatwerk_core::ai::run::{self, RunEnd, RunSpec};
use serde_json::json;

fn fake() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_maatwerk-fake-ai"))
}

fn spec(dir: &Path, script: serde_json::Value, limit: Duration, format: StreamFormat) -> RunSpec {
    let path = dir.join("script.json");
    std::fs::write(&path, script.to_string()).unwrap();
    RunSpec {
        program: fake(),
        args: vec![
            "--fake-script".into(),
            path.to_string_lossy().into_owned(),
            "x y".into(),
        ],
        cwd: dir.to_path_buf(),
        env_path: std::env::var_os("PATH").unwrap_or_default(),
        time_limit: limit,
        format,
    }
}

fn collect() -> (
    Arc<Mutex<Vec<AiEvent>>>,
    impl FnMut(AiEvent) + Send + 'static,
) {
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();
    (events, move |e| sink.lock().unwrap().push(e))
}

#[test]
fn streams_events_and_reports() {
    let dir = tempfile::tempdir().unwrap();
    let script = json!([
        {"out": r#"{"type":"system","subtype":"init","session_id":"s-7"}"#},
        {"write": "opdracht.typ", "content": "nieuw"},
        {"out": r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"opdracht.typ"}}]}}"#},
        {"err": "a warning"},
        {"out": r#"{"type":"result","subtype":"success","result":"Klaar","is_error":false}"#}
    ]);
    let (events, sink) = collect();
    let report = run::start(
        spec(
            dir.path(),
            script,
            Duration::from_secs(30),
            StreamFormat::ClaudeStreamJson,
        ),
        sink,
    )
    .wait();
    assert_eq!(report.end, RunEnd::Exited { code: Some(0) });
    assert!(report.succeeded());
    assert_eq!(report.collected.session.as_deref(), Some("s-7"));
    assert_eq!(report.collected.answer.as_deref(), Some("Klaar"));
    assert_eq!(report.collected.tail, ["a warning"]);
    let events = events.lock().unwrap();
    // stdout and stderr are two pipes read on their own threads: a stderr line may come first
    // (CI macOS, run 44923939530). The session is the first event from stdout.
    let first_out = events
        .iter()
        .find(|e| !matches!(e, AiEvent::Output { stderr: true, .. }));
    assert_eq!(first_out, Some(&AiEvent::Session { id: "s-7".into() }));
    assert!(events.iter().any(
        |e| matches!(e, AiEvent::Step { title, .. } if title == "Bestand bewerken: opdracht.typ")
    ));
    assert_eq!(
        std::fs::read_to_string(dir.path().join("opdracht.typ")).unwrap(),
        "nieuw"
    );
}

#[test]
fn arguments_arrive_as_given() {
    let dir = tempfile::tempdir().unwrap();
    let (events, sink) = collect();
    let report = run::start(
        spec(
            dir.path(),
            json!([{"out": "{args}"}]),
            Duration::from_secs(30),
            StreamFormat::Text,
        ),
        sink,
    )
    .wait();
    let answer: Vec<String> =
        serde_json::from_str(report.collected.answer.as_deref().unwrap()).unwrap();
    assert_eq!(answer[2], "x y");
    assert_eq!(events.lock().unwrap().len(), 1);
}

#[test]
fn exit_code_and_tail() {
    let dir = tempfile::tempdir().unwrap();
    let script = json!([{"err": "Error: Not logged in. Please run /login"}, {"exit": 1}]);
    let (_, sink) = collect();
    let report = run::start(
        spec(
            dir.path(),
            script,
            Duration::from_secs(30),
            StreamFormat::CopilotJson,
        ),
        sink,
    )
    .wait();
    assert_eq!(report.end, RunEnd::Exited { code: Some(1) });
    assert!(!report.succeeded());
    assert!(report.collected.auth_failed);
}

#[test]
fn time_limit_ends_the_run() {
    let dir = tempfile::tempdir().unwrap();
    let t = Instant::now();
    let (_, sink) = collect();
    let report = run::start(
        spec(
            dir.path(),
            json!([{"sleepMs": 60000}]),
            Duration::from_millis(400),
            StreamFormat::Text,
        ),
        sink,
    )
    .wait();
    assert_eq!(report.end, RunEnd::TimedOut);
    assert!(t.elapsed() < Duration::from_secs(15), "{:?}", t.elapsed());
}

#[test]
fn stop_ends_the_run() {
    let dir = tempfile::tempdir().unwrap();
    let (_, sink) = collect();
    let handle = run::start(
        spec(
            dir.path(),
            json!([{"out": "started"}, {"sleepMs": 60000}]),
            Duration::from_secs(60),
            StreamFormat::Text,
        ),
        sink,
    );
    std::thread::sleep(Duration::from_millis(300));
    let t = Instant::now();
    handle.stop();
    let report = handle.wait();
    assert_eq!(report.end, RunEnd::Stopped);
    assert!(t.elapsed() < Duration::from_secs(15));
}

fn alive(pid: u32) -> bool {
    if cfg!(windows) {
        let out = std::process::Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH"])
            .output()
            .unwrap();
        String::from_utf8_lossy(&out.stdout).contains(&pid.to_string())
    } else {
        std::process::Command::new("kill")
            .args(["-0", &pid.to_string()])
            .status()
            .is_ok_and(|s| s.success())
    }
}

#[test]
fn the_whole_tree_is_killed() {
    let dir = tempfile::tempdir().unwrap();
    let (events, sink) = collect();
    let report = run::start(
        spec(
            dir.path(),
            json!([{"child": 60000}, {"sleepMs": 60000}]),
            Duration::from_millis(800),
            StreamFormat::Text,
        ),
        sink,
    )
    .wait();
    assert_eq!(report.end, RunEnd::TimedOut);
    let child: u32 = events
        .lock()
        .unwrap()
        .iter()
        .find_map(|e| match e {
            AiEvent::Output { line, .. } => line.strip_prefix("child ").map(|p| p.parse().unwrap()),
            _ => None,
        })
        .expect("the fake printed its child");
    let until = Instant::now() + Duration::from_secs(10);
    while alive(child) && Instant::now() < until {
        std::thread::sleep(Duration::from_millis(100));
    }
    assert!(!alive(child), "child {child} survived");
}

#[test]
fn a_grandchild_holding_the_pipes_does_not_hang_the_run() {
    let dir = tempfile::tempdir().unwrap();
    let t = Instant::now();
    let (_, sink) = collect();
    let report = run::start(
        spec(
            dir.path(),
            json!([{"child": 30000}, {"out": "done"}]),
            Duration::from_secs(60),
            StreamFormat::Text,
        ),
        sink,
    )
    .wait();
    assert_eq!(report.end, RunEnd::Exited { code: Some(0) });
    assert!(t.elapsed() < Duration::from_secs(20), "{:?}", t.elapsed());
}

#[test]
fn a_missing_program_fails_to_start() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = spec(
        dir.path(),
        json!([]),
        Duration::from_secs(5),
        StreamFormat::Text,
    );
    s.program = dir.path().join("no-such-cli");
    let (_, sink) = collect();
    let report = run::start(s, sink).wait();
    assert!(matches!(report.end, RunEnd::StartFailed { .. }));
}
