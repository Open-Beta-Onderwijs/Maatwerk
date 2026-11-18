// SPDX-License-Identifier: AGPL-3.0-or-later

//! One message of the teacher, start to end: prepare the workspace, run the CLI (resuming the
//! conversation when it can), let Maatwerk check the result and send remaining errors back for
//! CLIs that cannot run the check themselves (ADR-0009 finding 9, at most
//! [`MAX_FIX_ROUNDS`]), collect the proposal and update the history.
//!
//! A stopped, timed-out or failed run keeps nothing (decision 67): no proposal, the opdracht
//! unchanged. The time limit covers the whole turn, fix rounds included.

use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde::Serialize;

use super::detect::SearchPath;
use super::diff::{self, Proposal};
use super::events::{AiEvent, StepKind};
use super::history::{Conversation, Message, RunEndKind, RunSummary, Transcript};
use super::provider::{Placeholders, REQUEST_FILE, Resolved, SessionMode};
use super::run::{self, RunEnd, RunReport, RunSpec};
use super::workspace::{self, Layout, TurnInput};
use crate::assignment::{self, Assignment, CheckReport, RenderOptions, with_time_limit};
use crate::error::{Error, Result};
use crate::typst_svc::{FontStore, Severity, local_now};

/// Fix rounds Maatwerk adds at most (ADR-0009 constraint 3).
pub const MAX_FIX_ROUNDS: u32 = 3;
const CHECK_LIMIT: Duration = Duration::from_secs(30);
const POLL: Duration = Duration::from_millis(100);

/// One turn's parameters.
#[derive(Debug, Clone)]
pub struct Turn {
    pub layout: Layout,
    pub opdracht: String,
    pub provider: Resolved,
    pub search: SearchPath,
    pub time_limit: Duration,
    pub input: TurnInput,
}

/// How the turn ended, for the chat (decision 67's cards).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Outcome {
    /// A proposal to look at.
    Proposal,
    /// The AI answered without changing anything.
    NoChanges,
    NotLoggedIn,
    CliError,
    TimedOut,
    Stopped,
    NotFound,
}

/// What a turn leaves.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnResult {
    pub outcome: Outcome,
    /// The AI's answer or the error text.
    pub answer: Option<String>,
    pub proposal: Option<Proposal>,
    /// The check of the proposal (the diagnostics left, decision 68).
    pub check: Option<CheckReport>,
    /// The last lines of output (CLI-error card).
    pub tail: Vec<String>,
    pub fix_rounds: u32,
    pub elapsed_ms: u64,
}

fn now_iso() -> String {
    crate::storage::iso_utc(std::time::SystemTime::now())
}

/// The check of the workspace, `None` if it is no opdracht folder or took too long.
pub fn check_workspace(dir: &std::path::Path) -> Option<CheckReport> {
    let a = Assignment::open(dir).ok()?;
    with_time_limit(CHECK_LIMIT, move || {
        assignment::check(
            &a,
            RenderOptions::default(),
            FontStore::shared(),
            local_now(),
        )
    })
}

fn errors_text(r: &CheckReport) -> String {
    r.diagnostics
        .iter()
        .filter(|d| d.severity == Severity::Error)
        .map(|d| match &d.location {
            Some(l) => format!("- {}:{}:{}: {}", l.file, l.line, l.column, d.message),
            None => format!("- {}", d.message),
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Runs one turn; `stop` ends it early (decision 55), `on_event` gets the stream.
pub fn run_turn(
    turn: Turn,
    stop: &Arc<AtomicBool>,
    mut on_event: impl FnMut(AiEvent),
) -> Result<TurnResult> {
    let started = Instant::now();
    let Turn {
        layout,
        opdracht,
        provider,
        search,
        time_limit,
        mut input,
    } = turn;
    let history_path = layout.history_file(&opdracht, &provider.key)?;
    let mut conv = Conversation::load(&history_path, &provider.key);
    conv.messages.push(Message {
        from_teacher: true,
        text: input.message.clone(),
        at: now_iso(),
        attachments: input.attachments.iter().map(|a| a.name.clone()).collect(),
        starter: input.starter,
        run: None,
    });
    let Some(program) = search.find(&provider.command) else {
        conv.save(&history_path)?;
        return Ok(TurnResult {
            outcome: Outcome::NotFound,
            answer: Some(format!("{} is niet gevonden.", provider.command)),
            proposal: None,
            check: None,
            tail: Vec::new(),
            fix_rounds: 0,
            elapsed_ms: 0,
        });
    };
    let can_resume = !provider.args_next.trim().is_empty();
    let resumes = can_resume && conv.session.is_some();
    if !can_resume {
        // The request carries the conversation (the new message is added separately).
        input.past = conv.past();
        input.past.pop();
    }
    if conv.session.is_none() && provider.session == SessionMode::Maatwerk {
        conv.session = Some(uuid::Uuid::new_v4().to_string());
    }
    let workdir = layout.workdir(&opdracht, &provider.key)?;
    let run_dir = layout.run_dir(&opdracht, &provider.key)?;
    let prepared = workspace::prepare(&workdir, &run_dir, &provider, resumes, &input)?;
    // Shared between the runner's callback (moved to its thread) and this function.
    let transcript = Arc::new(std::sync::Mutex::new(Transcript::default()));
    let mut fix_rounds = 0;
    let mut use_next = resumes;
    let mut report: RunReport;
    loop {
        let remaining = time_limit.saturating_sub(started.elapsed());
        let placeholders = Placeholders {
            workdir: workdir.clone(),
            run: run_dir.clone(),
            session: conv.session.clone(),
            images: prepared.image_args.clone(),
            image_flag: provider.image_flag.clone(),
            time_limit: remaining,
        };
        let args = placeholders.expand(if use_next {
            &provider.args_next
        } else {
            &provider.args
        })?;
        let spec = RunSpec {
            program: program.clone(),
            args,
            cwd: workdir.clone(),
            env_path: search.env_value(),
            time_limit: remaining,
            format: provider.format,
        };
        let (tx, rx) = std::sync::mpsc::channel::<AiEvent>();
        let handle = run::start(spec, move |e| {
            let _ = tx.send(e);
        });
        loop {
            while let Ok(e) = rx.try_recv() {
                transcript
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .push(&e);
                on_event(e);
            }
            if handle.is_finished() {
                break;
            }
            if stop.load(Ordering::SeqCst) {
                handle.stop();
            }
            std::thread::sleep(POLL);
        }
        report = handle.wait();
        for e in rx.try_iter() {
            transcript
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .push(&e);
            on_event(e);
        }
        if let Some(s) = report.collected.session.clone() {
            conv.session = Some(s);
        } else if let Some(s) = vibe_session(&run_dir) {
            conv.session = Some(s);
        }
        if !report.succeeded() || provider.runs_check || fix_rounds >= MAX_FIX_ROUNDS {
            break;
        }
        // Maatwerk checks for CLIs that cannot (finding 9).
        let check_event = AiEvent::Step {
            step: StepKind::Check,
            title: "Maatwerk controleert de opdracht".into(),
            detail: None,
        };
        transcript
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .push(&check_event);
        on_event(check_event);
        let Some(check) = check_workspace(&workdir) else {
            break;
        };
        if check.ok
            || diff::collect(&workdir, &prepared.baseline)?
                .files
                .is_empty()
        {
            break;
        }
        fix_rounds += 1;
        let request = format!(
            "# Request from Maatwerk\n\nYour last change to `opdracht.typ` does not compile. Fix these errors, changing as little as possible, and reply in Dutch in one or two sentences:\n\n{}\n",
            errors_text(&check)
        );
        let path = workdir.join(REQUEST_FILE);
        fs::write(&path, request).map_err(|e| Error::io(path.to_string_lossy(), e))?;
        use_next = can_resume && conv.session.is_some();
    }
    let collected = report.collected.clone();
    let outcome = match &report.end {
        RunEnd::TimedOut => Outcome::TimedOut,
        RunEnd::Stopped => Outcome::Stopped,
        RunEnd::StartFailed { .. } => Outcome::CliError,
        RunEnd::Exited { .. } if collected.auth_failed => Outcome::NotLoggedIn,
        RunEnd::Exited { .. } if !report.succeeded() => Outcome::CliError,
        RunEnd::Exited { .. } => Outcome::NoChanges,
    };
    let (proposal, check, outcome) = if outcome == Outcome::NoChanges {
        let p = diff::collect(&workdir, &prepared.baseline)?;
        if p.is_empty() {
            (None, None, Outcome::NoChanges)
        } else {
            let check = check_workspace(&workdir);
            let json = serde_json::to_vec(&p).unwrap_or_default();
            let _ = fs::write(run_dir.join("proposal.json"), json);
            (Some(p), check, Outcome::Proposal)
        }
    } else {
        (None, None, outcome)
    };
    let answer = match (&report.end, &collected.answer, &collected.error) {
        (RunEnd::StartFailed { message }, _, _) => Some(message.clone()),
        (_, _, Some(e)) if outcome != Outcome::NoChanges && outcome != Outcome::Proposal => {
            Some(e.clone())
        }
        (_, Some(a), _) => Some(a.clone()),
        (_, None, Some(e)) => Some(e.clone()),
        _ => None,
    };
    let elapsed_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    let transcript = std::mem::take(&mut *transcript.lock().unwrap_or_else(|p| p.into_inner()));
    conv.messages.push(Message {
        from_teacher: false,
        text: answer.clone().unwrap_or_default(),
        at: now_iso(),
        attachments: Vec::new(),
        starter: None,
        run: Some(RunSummary {
            end: RunEndKind::of(&report.end, report.succeeded()),
            elapsed_ms,
            steps: transcript.steps,
            lines: transcript.lines,
            error: collected.error.clone(),
            auth_failed: collected.auth_failed,
            fix_rounds,
            proposal: proposal.is_some(),
            applied: false,
        }),
    });
    conv.save(&history_path)?;
    Ok(TurnResult {
        outcome,
        answer,
        proposal,
        check,
        tail: collected.tail,
        fix_rounds,
        elapsed_ms,
    })
}

/// Vibe writes its session id into `export.json` in `--output-dir` (ADR-0009, Vibe table).
fn vibe_session(run_dir: &std::path::Path) -> Option<String> {
    let bytes = fs::read(run_dir.join("export.json")).ok()?;
    let v: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    find_key(&v, "session_id")
}

fn find_key(v: &serde_json::Value, key: &str) -> Option<String> {
    match v {
        serde_json::Value::Object(m) => m
            .get(key)
            .and_then(|s| s.as_str().map(str::to_owned))
            .or_else(|| m.values().find_map(|x| find_key(x, key))),
        serde_json::Value::Array(a) => a.iter().find_map(|x| find_key(x, key)),
        _ => None,
    }
}

/// The proposal of the last turn, as saved in the run folder.
pub fn saved_proposal(
    layout: &Layout,
    opdracht: &str,
    key: &super::ProviderKey,
) -> Option<Proposal> {
    let dir: PathBuf = layout.run_dir(opdracht, key).ok()?;
    let bytes = fs::read(dir.join("proposal.json")).ok()?;
    serde_json::from_slice(&bytes).ok()
}
