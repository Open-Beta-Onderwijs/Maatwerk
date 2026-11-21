// SPDX-License-Identifier: AGPL-3.0-or-later

//! Running a CLI: a child process in the workspace with streamed, normalised events, a time
//! limit and Stop (decision 55), killing the whole process tree (ADR-0009 finding 5). No window
//! appears on Windows; stdin is closed, so a CLI that would ask a question gets end of input.
//!
//! Everything runs on plain threads; the app calls [`start`] from a blocking task and gets the
//! events through the callback.

use std::ffi::OsString;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Child, Command, ExitStatus, Output, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde::Serialize;

use super::events::{AiEvent, Collected, Parser};
use super::provider::StreamFormat;

/// How often the runner looks at Stop and the clock.
const TICK: Duration = Duration::from_millis(100);
/// After a stop or time-out: how long the tree gets for a clean exit (Claude Code and Vibe
/// keep the session on SIGTERM) and how long the pipes may stay open after the kill.
const GRACE: Duration = Duration::from_secs(3);
/// A line longer than this is cut (a CLI that prints a whole file on one line).
const MAX_LINE: usize = 4 * 1024 * 1024;

/// Windows `CREATE_NO_WINDOW`: console CLIs started from the GUI app get no console window.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// What to run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    /// `PATH` for the child ([`super::detect::SearchPath::env_value`]).
    pub env_path: OsString,
    pub time_limit: Duration,
    pub format: StreamFormat,
}

/// How a run ended.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RunEnd {
    /// The process exited by itself.
    Exited {
        code: Option<i32>,
    },
    TimedOut,
    Stopped,
    /// It could not start (missing program, no permission).
    StartFailed {
        message: String,
    },
}

/// The result of a run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunReport {
    pub end: RunEnd,
    pub collected: Collected,
    pub elapsed_ms: u64,
}

impl RunReport {
    pub fn succeeded(&self) -> bool {
        self.end == RunEnd::Exited { code: Some(0) } && self.collected.error.is_none()
    }
}

/// A running CLI.
pub struct RunHandle {
    stop: Arc<AtomicBool>,
    thread: JoinHandle<RunReport>,
}

impl RunHandle {
    /// Asks the run to stop; [`RunHandle::wait`] then returns [`RunEnd::Stopped`].
    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }

    /// A handle that [`RunHandle::stop`] sets, for code that does not own the handle.
    pub fn stop_flag(&self) -> Arc<AtomicBool> {
        self.stop.clone()
    }

    pub fn is_finished(&self) -> bool {
        self.thread.is_finished()
    }

    pub fn wait(self) -> RunReport {
        self.thread.join().unwrap_or_else(|_| RunReport {
            end: RunEnd::StartFailed {
                message: "De uitvoering is onverwacht gestopt.".into(),
            },
            collected: Collected::default(),
            elapsed_ms: 0,
        })
    }
}

enum Line {
    Out(String),
    Err(String),
    Closed,
}

/// Starts `spec`; `on_event` gets every event on the runner thread, in order.
pub fn start(spec: RunSpec, on_event: impl FnMut(AiEvent) + Send + 'static) -> RunHandle {
    let stop = Arc::new(AtomicBool::new(false));
    let flag = stop.clone();
    let thread = thread::spawn(move || run(spec, &flag, on_event));
    RunHandle { stop, thread }
}

fn command(spec: &RunSpec) -> Command {
    let mut cmd = Command::new(&spec.program);
    cmd.args(&spec.args)
        .current_dir(&spec.cwd)
        .env("PATH", &spec.env_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_and_group(&mut cmd);
    cmd
}

/// No console window (Windows); an own process group, so the tree can be killed (Unix).
fn hide_and_group(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
}

fn run(spec: RunSpec, stop: &AtomicBool, mut on_event: impl FnMut(AiEvent)) -> RunReport {
    let started = Instant::now();
    let elapsed =
        |started: Instant| u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    let mut child = match command(&spec).spawn() {
        Ok(c) => c,
        Err(e) => {
            return RunReport {
                end: RunEnd::StartFailed {
                    message: format!("{} kon niet starten: {e}", spec.program.display()),
                },
                collected: Collected::default(),
                elapsed_ms: elapsed(started),
            };
        }
    };
    let (tx, rx) = mpsc::channel();
    let readers = [
        child.stdout.take().map(|s| reader(s, tx.clone(), false)),
        child.stderr.take().map(|s| reader(s, tx.clone(), true)),
    ];
    drop(tx);
    let mut open = readers.iter().flatten().count();
    let mut parser = Parser::new(spec.format);
    let deadline = started + spec.time_limit;
    let mut ended: Option<RunEnd> = None;
    let mut killed_at: Option<Instant> = None;
    let mut status: Option<ExitStatus> = None;
    loop {
        match rx.recv_timeout(TICK) {
            Ok(Line::Out(l)) => parser.line(&l, false).into_iter().for_each(&mut on_event),
            Ok(Line::Err(l)) => parser.line(&l, true).into_iter().for_each(&mut on_event),
            Ok(Line::Closed) => open -= 1,
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => open = 0,
        }
        if status.is_none() {
            status = child.try_wait().ok().flatten();
        }
        if ended.is_none() && status.is_none() {
            if stop.load(Ordering::SeqCst) {
                ended = Some(RunEnd::Stopped);
            } else if Instant::now() >= deadline {
                ended = Some(RunEnd::TimedOut);
            }
            if ended.is_some() {
                kill_tree(&mut child);
                killed_at = Some(Instant::now());
            }
        }
        if open == 0 && status.is_some() {
            break;
        }
        // A grandchild that keeps the pipes open must not keep the run alive.
        if killed_at.is_some_and(|t| t.elapsed() > GRACE * 2) {
            break;
        }
        if status.is_some() && open > 0 && ended.is_none() {
            // Exited, but a detached grandchild holds the pipes: give it the grace period.
            if killed_at.is_none() {
                killed_at = Some(Instant::now());
            }
        }
    }
    let status = status.or_else(|| child.wait().ok());
    let code = status.and_then(|s| s.code());
    let end = ended.unwrap_or(RunEnd::Exited { code });
    let exit_code = match end {
        RunEnd::Exited { code } => code,
        _ => None,
    };
    RunReport {
        end,
        collected: parser.finish(exit_code),
        elapsed_ms: elapsed(started),
    }
}

fn reader(
    stream: impl Read + Send + 'static,
    tx: mpsc::Sender<Line>,
    stderr: bool,
) -> JoinHandle<()> {
    thread::spawn(move || {
        let mut reader = BufReader::new(stream);
        let mut buf = Vec::new();
        loop {
            buf.clear();
            match (&mut reader)
                .take(MAX_LINE as u64)
                .read_until(b'\n', &mut buf)
            {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    if buf.len() >= MAX_LINE && buf.last() != Some(&b'\n') {
                        // Skip the rest of an over-long line.
                        let mut rest = Vec::new();
                        let _ = reader.read_until(b'\n', &mut rest);
                    }
                    let line = String::from_utf8_lossy(&buf).into_owned();
                    let msg = if stderr {
                        Line::Err(line)
                    } else {
                        Line::Out(line)
                    };
                    if tx.send(msg).is_err() {
                        break;
                    }
                }
            }
        }
        let _ = tx.send(Line::Closed);
    })
}

/// Ends the child and everything it started: `taskkill /T /F` on Windows; on Unix SIGTERM to
/// the process group, SIGKILL after [`GRACE`].
fn kill_tree(child: &mut Child) {
    let pid = child.id().to_string();
    #[cfg(windows)]
    {
        let mut cmd = Command::new("taskkill");
        cmd.args(["/PID", &pid, "/T", "/F"]);
        hide_and_group(&mut cmd);
        if quick_output(cmd, GRACE).is_none() {
            let _ = child.kill();
        }
    }
    #[cfg(unix)]
    {
        let group = format!("-{pid}");
        let signal = |sig: &str| {
            let _ = Command::new("kill")
                .args([sig, "--", &group])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        };
        signal("-TERM");
        let until = Instant::now() + GRACE;
        while Instant::now() < until {
            if child.try_wait().ok().flatten().is_some() {
                return;
            }
            thread::sleep(TICK);
        }
        signal("-KILL");
        let _ = child.kill();
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = pid;
        let _ = child.kill();
    }
}

/// Runs a short command (a version or login probe) with stdin closed and no window; `None` if
/// it did not start or did not end within `timeout` (it is killed then).
pub fn quick_output(mut cmd: Command, timeout: Duration) -> Option<Output> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_and_group(&mut cmd);
    let mut child = cmd.spawn().ok()?;
    let out = child.stdout.take().map(collect);
    let err = child.stderr.take().map(collect);
    let until = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) if Instant::now() < until => thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    };
    let join = |h: Option<JoinHandle<Vec<u8>>>| h.and_then(|h| h.join().ok()).unwrap_or_default();
    Some(Output {
        status,
        stdout: join(out),
        stderr: join(err),
    })
}

fn collect(mut stream: impl Read + Send + 'static) -> JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stream.read_to_end(&mut buf);
        buf
    })
}

// Tests with a real child process: `tests/ai_fake_cli.rs` (they need the fake CLI binary).
