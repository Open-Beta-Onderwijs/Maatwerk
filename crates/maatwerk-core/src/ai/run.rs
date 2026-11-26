// SPDX-License-Identifier: AGPL-3.0-or-later

//! Running a CLI: a child process in the workspace with streamed, normalised events, a time
//! limit and Stop (decision 55), killing the whole process tree (ADR-0009 finding 5): on
//! Windows the CLI runs in a job object, on Unix in its own process group. What the CLI leaves
//! running after it exited is ended too (review 32 m6), so nothing writes into the workspace
//! after the run. No window appears on Windows; stdin is closed, so a CLI that would ask a
//! question gets end of input.
//!
//! Everything runs on plain threads; the app calls [`start`] from a blocking task and gets the
//! events through the callback.

use std::ffi::OsString;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{ChildStderr, ChildStdout, Command, ExitStatus, Output, Stdio};
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

/// The running CLI and everything it starts.
struct Proc {
    #[cfg(windows)]
    child: Box<dyn process_wrap::std::ChildWrapper>,
    #[cfg(not(windows))]
    child: std::process::Child,
}

impl Proc {
    #[cfg(windows)]
    fn spawn(cmd: Command) -> std::io::Result<Proc> {
        use process_wrap::std::{CommandWrap, CreationFlags, JobObject};
        // The job object starts the CLI suspended and assigns it before it runs, so no
        // grandchild escapes the job.
        let mut wrap = CommandWrap::from(cmd);
        wrap.wrap(CreationFlags(CREATE_NO_WINDOW)).wrap(JobObject);
        Ok(Proc {
            child: wrap.spawn()?,
        })
    }

    #[cfg(not(windows))]
    fn spawn(mut cmd: Command) -> std::io::Result<Proc> {
        hide_and_group(&mut cmd);
        Ok(Proc {
            child: cmd.spawn()?,
        })
    }

    #[cfg(windows)]
    fn pipes(&mut self) -> (Option<ChildStdout>, Option<ChildStderr>) {
        (self.child.stdout().take(), self.child.stderr().take())
    }

    #[cfg(not(windows))]
    fn pipes(&mut self) -> (Option<ChildStdout>, Option<ChildStderr>) {
        (self.child.stdout.take(), self.child.stderr.take())
    }

    /// The exit status of the CLI itself (not of the processes it started).
    fn leader_status(&mut self) -> Option<ExitStatus> {
        #[cfg(windows)]
        let status = self.child.inner_mut().try_wait();
        #[cfg(not(windows))]
        let status = self.child.try_wait();
        status.ok().flatten()
    }

    /// Stop or time-out: the whole tree. On Unix SIGTERM to the group first (Claude Code and
    /// Vibe keep the session), SIGKILL after [`GRACE`]; on Windows the job is terminated.
    fn kill_tree(&mut self) {
        #[cfg(windows)]
        {
            let _ = self.child.start_kill();
        }
        #[cfg(unix)]
        {
            signal_group(self.child.id(), "-TERM");
            let until = Instant::now() + GRACE;
            while Instant::now() < until {
                if self.leader_status().is_some() {
                    break;
                }
                thread::sleep(TICK);
            }
            self.kill_rest();
            let _ = self.child.kill();
        }
        #[cfg(not(any(windows, unix)))]
        {
            let _ = self.child.kill();
        }
    }

    /// After the CLI exited: whatever it left running (review 32 m6).
    fn kill_rest(&mut self) {
        #[cfg(windows)]
        {
            let _ = self.child.start_kill();
        }
        #[cfg(unix)]
        signal_group(self.child.id(), "-KILL");
    }

    fn wait(&mut self) -> Option<ExitStatus> {
        if let Some(s) = self.leader_status() {
            return Some(s);
        }
        #[cfg(windows)]
        let status = self.child.inner_mut().wait();
        #[cfg(not(windows))]
        let status = self.child.wait();
        status.ok()
    }
}

/// `kill <sig> -- -<pgid>`: the CLI's process group, also after the CLI itself exited.
#[cfg(unix)]
fn signal_group(pid: u32, sig: &str) {
    let _ = Command::new("kill")
        .args([sig, "--", &format!("-{pid}")])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

fn run(spec: RunSpec, stop: &AtomicBool, mut on_event: impl FnMut(AiEvent)) -> RunReport {
    let started = Instant::now();
    let elapsed =
        |started: Instant| u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    let mut child = match Proc::spawn(command(&spec)) {
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
    let (stdout, stderr) = child.pipes();
    let readers = [
        stdout.map(|s| reader(s, tx.clone(), false)),
        stderr.map(|s| reader(s, tx.clone(), true)),
    ];
    drop(tx);
    let mut open = readers.iter().flatten().count();
    let mut parser = Parser::new(spec.format);
    let deadline = started + spec.time_limit;
    let mut ended: Option<RunEnd> = None;
    let mut killed_at: Option<Instant> = None;
    // The CLI exited while something it started still holds the pipes.
    let mut orphaned_at: Option<Instant> = None;
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
            status = child.leader_status();
        }
        if ended.is_none() && status.is_none() {
            if stop.load(Ordering::SeqCst) {
                ended = Some(RunEnd::Stopped);
            } else if Instant::now() >= deadline {
                ended = Some(RunEnd::TimedOut);
            }
            if ended.is_some() {
                child.kill_tree();
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
        if status.is_some() && open > 0 && killed_at.is_none() {
            // Exited, but a grandchild holds the pipes: it gets the grace period to finish its
            // output, then it is killed (review 32 m6).
            let since = *orphaned_at.get_or_insert_with(Instant::now);
            if since.elapsed() > GRACE {
                child.kill_rest();
                killed_at = Some(Instant::now());
            }
        }
    }
    let status = status.or_else(|| child.wait());
    // Nothing the CLI started outlives the run. (On Unix only a group that held the pipes is
    // signalled, above: once reaped, its id may be reused.)
    #[cfg(windows)]
    child.kill_rest();
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
