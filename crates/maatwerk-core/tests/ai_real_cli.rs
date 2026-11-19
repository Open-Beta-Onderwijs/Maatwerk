// SPDX-License-Identifier: AGPL-3.0-or-later

//! The real-CLI check of step 32c (decision 61, ADR-0009 _verify_ rows), opt-in: it runs one
//! real turn and a resumed second turn of an installed CLI on the synthetic base opdracht, with
//! the CLI's preset arguments, and prints the streamed events and the outcome. It sends the
//! base opdracht (no student data) to the vendor through the teacher's own login and uses their
//! subscription, so it never runs by default:
//!
//! ```powershell
//! cargo build -p maatwerk-app            # the bundled check: target/debug/maatwerk(.exe)
//! $env:MAATWERK_REAL_AI = "claude"       # or vibe, codex, gemini, antigravity, copilot
//! cargo test -p maatwerk-core --test ai_real_cli -- --ignored --nocapture
//! ```
//!
//! `MAATWERK_CHECK_PROGRAM` overrides the check program's path.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::time::Duration;

use maatwerk_core::ai::detect::SearchPath;
use maatwerk_core::ai::provider::{AiSettings, ProviderKey};
use maatwerk_core::ai::turn::{Outcome, Turn, TurnResult, run_turn};
use maatwerk_core::ai::workspace::{ContextChoice, Layout, TurnInput};

fn check_program() -> PathBuf {
    if let Ok(p) = std::env::var("MAATWERK_CHECK_PROGRAM") {
        return PathBuf::from(p);
    }
    let exe = if cfg!(windows) {
        "maatwerk.exe"
    } else {
        "maatwerk"
    };
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/debug")
        .join(exe)
}

fn turn(
    layout: &Layout,
    opdracht_dir: &std::path::Path,
    key: &ProviderKey,
    message: &str,
    buffer: &str,
) -> Turn {
    let provider = AiSettings::default().resolve(key).expect("a built-in CLI");
    Turn {
        layout: layout.clone(),
        opdracht: "opd-echt".into(),
        provider,
        search: SearchPath::discover(),
        time_limit: Duration::from_secs(5 * 60),
        input: TurnInput {
            opdracht_dir: opdracht_dir.to_path_buf(),
            buffers: BTreeMap::from([("opdracht.typ".into(), buffer.into())]),
            message: message.into(),
            starter: None,
            context: ContextChoice {
                guide: true,
                diagnostics: true,
                ..ContextChoice::default()
            },
            attachments: Vec::new(),
            past: Vec::new(),
            check_program: check_program(),
        },
    }
}

fn report(label: &str, r: &TurnResult) {
    println!(
        "── {label}: {:?} in {} ms, {} fix rounds",
        r.outcome, r.elapsed_ms, r.fix_rounds
    );
    println!("answer: {}", r.answer.as_deref().unwrap_or("-"));
    if let Some(p) = &r.proposal {
        for f in &p.files {
            println!("file {}: {} hunks", f.path, f.hunks.len());
        }
        println!("skipped: {:?}", p.skipped);
    }
    if let Some(c) = &r.check {
        println!(
            "check after: ok={} diagnostics={}",
            c.ok,
            c.diagnostics.len()
        );
    }
    if !r.tail.is_empty() {
        println!("tail:\n{}", r.tail.join("\n"));
    }
}

#[test]
#[ignore = "runs a real AI CLI on the teacher's account; see the module docs"]
fn real_cli_turn_and_resume() {
    let Ok(name) = std::env::var("MAATWERK_REAL_AI") else {
        eprintln!("MAATWERK_REAL_AI is not set: nothing to do");
        return;
    };
    let key = ProviderKey::parse(&name).expect("a provider key");
    assert!(
        check_program().exists(),
        "build maatwerk-app first: {}",
        check_program().display()
    );

    let dir = tempfile::tempdir().unwrap();
    let opdracht = dir.path().join("data/opdrachten/opd-echt");
    fs::create_dir_all(&opdracht).unwrap();
    for (file, bytes) in maatwerk_core::assignment::export_files() {
        if ["main.typ", "lib.typ", "opdracht.typ"].contains(&file.as_str()) {
            fs::write(opdracht.join(&file), bytes).unwrap();
        }
    }
    let layout = Layout::new(&dir.path().join("local/ai"), "gebr-echt").unwrap();
    let base = maatwerk_core::assets::BASE_ASSIGNMENT_TYP;

    let stop = Arc::new(AtomicBool::new(false));
    let first = run_turn(
        turn(
            &layout,
            &opdracht,
            &key,
            "Voeg één korte opgave toe over de wet van Ohm (R = U / I) met één vraag van 2 punten \
             en een antwoord. Verander verder niets.",
            base,
        ),
        &stop,
        |e| println!("event: {}", serde_json::to_string(&e).unwrap_or_default()),
    )
    .expect("the first turn runs");
    report("turn 1", &first);
    assert!(
        matches!(first.outcome, Outcome::Proposal | Outcome::NoChanges),
        "turn 1 ended {:?}",
        first.outcome
    );

    // The second turn resumes the session (argsNext) on the proposal.
    let current = first
        .proposal
        .as_ref()
        .and_then(|p| p.files.iter().find(|f| f.path == "opdracht.typ"))
        .map_or_else(|| base.to_owned(), |f| f.proposed.clone());
    let second = run_turn(
        turn(
            &layout,
            &opdracht,
            &key,
            "Maak de vraag die je net toevoegde 3 punten in plaats van 2.",
            &current,
        ),
        &stop,
        |e| println!("event: {}", serde_json::to_string(&e).unwrap_or_default()),
    )
    .expect("the second turn runs");
    report("turn 2", &second);
    assert!(
        matches!(second.outcome, Outcome::Proposal | Outcome::NoChanges),
        "turn 2 ended {:?}",
        second.outcome
    );
}
