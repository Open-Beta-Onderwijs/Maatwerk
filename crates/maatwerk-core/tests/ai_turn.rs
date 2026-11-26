// SPDX-License-Identifier: AGPL-3.0-or-later

//! Whole turns against the fake CLI (decision 61): proposal, Maatwerk's fix rounds, resume,
//! not logged in, time-out, not found.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::time::Duration;

use maatwerk_core::ai::detect::SearchPath;
use maatwerk_core::ai::history::Conversation;
use maatwerk_core::ai::provider::{
    AiSettings, Builtin, CustomCli, ProviderKey, ProviderOverride, Resolved,
};
use maatwerk_core::ai::turn::{Outcome, Turn, run_turn};
use maatwerk_core::ai::workspace::{ContextChoice, Layout, TurnInput};
use serde_json::json;

fn fake() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_maatwerk-fake-ai"))
}

const BASE: &str = maatwerk_core::assets::BASE_ASSIGNMENT_TYP;

struct Fixture {
    _dir: tempfile::TempDir,
    root: PathBuf,
    opdracht: PathBuf,
    layout: Layout,
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_path_buf();
    let opdracht = root.join("data/opdrachten/opd-1");
    fs::create_dir_all(&opdracht).unwrap();
    for (name, bytes) in maatwerk_core::assignment::export_files() {
        if ["main.typ", "lib.typ", "opdracht.typ"].contains(&name.as_str()) {
            fs::write(opdracht.join(&name), bytes).unwrap();
        }
    }
    let layout = Layout::new(&root.join("local/ai"), "gebr-1").unwrap();
    Fixture {
        _dir: dir,
        root,
        opdracht,
        layout,
    }
}

impl Fixture {
    fn script(&self, name: &str, steps: serde_json::Value) -> String {
        let path = self.root.join(name);
        fs::write(&path, steps.to_string()).unwrap();
        format!("--fake-script '{}'", path.display())
    }

    fn custom(&self, args: &str, args_next: &str) -> Resolved {
        let settings = AiSettings {
            custom: vec![CustomCli {
                key: ProviderKey::parse("custom-fake").unwrap(),
                name: "Fake".into(),
                command: fake().to_string_lossy().into_owned(),
                args: args.into(),
                args_next: args_next.into(),
            }],
            ..AiSettings::default()
        };
        settings
            .resolve(&ProviderKey::parse("custom-fake").unwrap())
            .unwrap()
    }

    fn turn(&self, provider: Resolved, limit: Duration) -> Turn {
        Turn {
            layout: self.layout.clone(),
            opdracht: "opd-1".into(),
            provider,
            search: SearchPath::new([fake().parent().unwrap().to_path_buf()]),
            time_limit: limit,
            input: TurnInput {
                opdracht_dir: self.opdracht.clone(),
                buffers: BTreeMap::from([("opdracht.typ".into(), BASE.into())]),
                message: "Maak er twee vragen van.".into(),
                starter: None,
                context: ContextChoice::default(),
                attachments: Vec::new(),
                past: Vec::new(),
                check_program: PathBuf::from("maatwerk"),
            },
        }
    }

    fn history(&self, key: &str) -> Conversation {
        let key = ProviderKey::parse(key).unwrap();
        Conversation::load(&self.layout.history_file("opd-1", &key).unwrap(), &key)
    }
}

fn run(turn: Turn) -> maatwerk_core::ai::turn::TurnResult {
    run_turn(turn, &Arc::new(AtomicBool::new(false)), |_| {}).unwrap()
}

fn edited() -> String {
    format!("{BASE}\n// Toegevoegd door de AI.\n")
}

#[test]
fn a_turn_with_a_proposal() {
    let f = fixture();
    let args = f.script(
        "s.json",
        json!([{"write": "opdracht.typ", "content": edited()}, {"out": "Ik heb een vraag toegevoegd."}]),
    );
    let r = run(f.turn(f.custom(&args, ""), Duration::from_secs(60)));
    assert_eq!(r.outcome, Outcome::Proposal, "{:?}", r.answer);
    assert_eq!(r.answer.as_deref(), Some("Ik heb een vraag toegevoegd."));
    let p = r.proposal.unwrap();
    assert_eq!(p.files[0].hunks.len(), 1);
    assert!(r.check.unwrap().ok);
    assert_eq!(r.fix_rounds, 0);
    let h = f.history("custom-fake");
    assert_eq!(h.messages.len(), 2);
    assert!(h.messages[1].run.as_ref().unwrap().proposal);
    assert!(h.session.is_some(), "Maatwerk makes the session id");
    // The saved opdracht is untouched.
    assert_ne!(
        fs::read_to_string(f.opdracht.join("opdracht.typ")).unwrap(),
        edited()
    );
}

#[test]
fn maatwerk_sends_errors_back_at_most_three_times() {
    let f = fixture();
    let args = f.script(
        "s.json",
        json!([{"write": "opdracht.typ", "content": "#let x = ("}]),
    );
    let r = run(f.turn(f.custom(&args, ""), Duration::from_secs(120)));
    assert_eq!(r.fix_rounds, 3);
    assert_eq!(r.outcome, Outcome::Proposal);
    assert!(!r.check.unwrap().ok, "the remaining errors are shown");
}

#[test]
fn a_fix_round_that_works() {
    let f = fixture();
    // First run: broken; the fix round (args_next) repairs it.
    let first = f.script(
        "a.json",
        json!([{"write": "opdracht.typ", "content": "#let x = ("}]),
    );
    let next = f.script(
        "b.json",
        json!([{"write": "opdracht.typ", "content": edited()}, {"out": "Hersteld."}]),
    );
    let r = run(f.turn(f.custom(&first, &next), Duration::from_secs(120)));
    assert_eq!(r.fix_rounds, 1);
    assert!(r.check.unwrap().ok);
    assert_eq!(r.answer.as_deref(), Some("Hersteld."));
}

#[test]
fn a_reported_session_is_resumed() {
    let f = fixture();
    let first = f.script(
        "a.json",
        json!([
            {"out": r#"{"type":"system","subtype":"init","session_id":"claude-77"}"#},
            {"out": r#"{"type":"result","subtype":"success","result":"Eerste","is_error":false}"#}
        ]),
    );
    let next = f.script(
        "b.json",
        json!([
            {"out": r#"{"type":"result","subtype":"success","result":"Vervolg","is_error":false}"#}
        ]),
    );
    let settings = AiSettings {
        overrides: [(
            Builtin::Claude,
            ProviderOverride {
                command: Some(fake().to_string_lossy().into_owned()),
                args: Some(first),
                args_next: Some(format!("{next} --resume {{session}}")),
            },
        )]
        .into(),
        ..AiSettings::default()
    };
    let mut claude = settings
        .resolve(&ProviderKey::parse("claude").unwrap())
        .unwrap();
    // The fake has no `auth status` (the_login_check_comes_first).
    claude.login_probe = None;
    let r = run(f.turn(claude.clone(), Duration::from_secs(60)));
    assert_eq!(r.outcome, Outcome::NoChanges);
    assert_eq!(r.answer.as_deref(), Some("Eerste"));
    assert_eq!(f.history("claude").session.as_deref(), Some("claude-77"));
    let r = run(f.turn(claude, Duration::from_secs(60)));
    assert_eq!(r.answer.as_deref(), Some("Vervolg"));
    assert_eq!(f.history("claude").messages.len(), 4);
}

#[test]
fn not_logged_in_keeps_nothing() {
    let f = fixture();
    let args = f.script(
        "s.json",
        json!([{"write": "opdracht.typ", "content": edited()}, {"err": "Error: not logged in"}, {"exit": 1}]),
    );
    let r = run(f.turn(f.custom(&args, ""), Duration::from_secs(60)));
    assert_eq!(r.outcome, Outcome::NotLoggedIn);
    assert!(r.proposal.is_none());
    assert_eq!(r.tail, ["Error: not logged in"]);
}

#[test]
fn a_time_out_keeps_nothing() {
    let f = fixture();
    let args = f.script(
        "s.json",
        json!([{"write": "opdracht.typ", "content": edited()}, {"sleepMs": 60000}]),
    );
    let r = run(f.turn(f.custom(&args, ""), Duration::from_millis(1500)));
    assert_eq!(r.outcome, Outcome::TimedOut);
    assert!(r.proposal.is_none());
}

#[test]
fn a_missing_cli() {
    let f = fixture();
    let mut provider = f.custom("", "");
    provider.command = "no-such-ai-cli".into();
    let r = run(f.turn(provider, Duration::from_secs(5)));
    assert_eq!(r.outcome, Outcome::NotFound);
}

/// Review 32 m7: Stop during the preparation ends the turn there; the CLI never starts.
#[test]
fn stop_before_the_cli_starts_keeps_nothing() {
    let f = fixture();
    let args = f.script(
        "s.json",
        json!([{"write": "opdracht.typ", "content": edited()}, {"out": "klaar"}]),
    );
    let mut turn = f.turn(f.custom(&args, ""), Duration::from_secs(60));
    turn.input.context.diagnostics = true;
    let stop = Arc::new(AtomicBool::new(true));
    let mut events = 0;
    let r = run_turn(turn, &stop, |_| events += 1).unwrap();
    assert_eq!(r.outcome, Outcome::Stopped);
    assert!(r.proposal.is_none());
    assert_eq!(events, 0, "the CLI did not run");
    let key = ProviderKey::parse("custom-fake").unwrap();
    let work = f.layout.workdir("opd-1", &key).unwrap();
    assert_eq!(fs::read_to_string(work.join("opdracht.typ")).unwrap(), BASE);
    let h = f.history("custom-fake");
    assert_eq!(h.messages.len(), 2, "the stop is in the history");
}

/// Review 32 m8: before the first run that worked, the CLI's login status command; "not logged
/// in" ends the turn with that card, without running the CLI.
#[test]
fn the_login_check_comes_first() {
    let f = fixture();
    let args = f.script(
        "s.json",
        json!([{"write": "opdracht.typ", "content": edited()}, {"out": "klaar"}]),
    );
    let probe = f.script("login.json", json!([{"out": "{\"loggedIn\": false}"}]));
    let mut provider = f.custom(&args, "");
    provider.login_probe = Some(maatwerk_core::ai::provider::split_args(&probe).unwrap());
    let mut events = 0;
    let r = run_turn(
        f.turn(provider.clone(), Duration::from_secs(60)),
        &Arc::new(AtomicBool::new(false)),
        |_| events += 1,
    )
    .unwrap();
    assert_eq!(r.outcome, Outcome::NotLoggedIn);
    assert_eq!(events, 0, "the CLI did not run");
    let h = f.history("custom-fake");
    assert!(h.messages[1].run.as_ref().unwrap().auth_failed);

    // Logged in: the turn runs.
    let probe = f.script("login.json", json!([{"out": "{\"loggedIn\": true}"}]));
    provider.login_probe = Some(maatwerk_core::ai::provider::split_args(&probe).unwrap());
    let r = run(f.turn(provider, Duration::from_secs(60)));
    assert_eq!(r.outcome, Outcome::Proposal, "{:?}", r.answer);
}
