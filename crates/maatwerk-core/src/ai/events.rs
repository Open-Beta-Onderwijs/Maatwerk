// SPDX-License-Identifier: AGPL-3.0-or-later

//! Each CLI's output stream, read into one event list for the status line and the transcript
//! (decisions 55, 66), plus what a run leaves behind: the session id, the answer, an error and
//! whether it failed for want of a login (decision 67).
//!
//! The formats are the documented ones (ADR-0009 "CLI research"); fields the docs do not name
//! are looked up under several likely keys and anything unknown becomes a plain output line, so
//! a changed format degrades to a raw transcript instead of failing the run.

use std::collections::VecDeque;

use serde::Serialize;
use serde_json::Value;

use super::provider::{CHECK_COMMAND, StreamFormat};

/// At most this many characters of a step's detail or output.
const MAX_DETAIL: usize = 4000;
/// Lines kept for the CLI-error card (decision 67).
const TAIL_LINES: usize = 20;
/// At most this many characters of a plain-text answer.
const MAX_ANSWER: usize = 64_000;

/// What a step does, for its icon and the status line.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StepKind {
    Thinking,
    Read,
    Edit,
    Command,
    /// The bundled check (`.maatwerk/check`).
    Check,
    Search,
    Fetch,
    Tool,
}

/// One normalised event.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AiEvent {
    /// The CLI's session id (once, early).
    Session { id: String },
    /// A step starts: a tool call, an edit, a command.
    Step {
        step: StepKind,
        /// Short Dutch title for the status line ("Bestand bewerken: opdracht.typ").
        title: String,
        detail: Option<String>,
    },
    /// The output of the latest step.
    StepOutput { text: String, error: bool },
    /// The AI's prose (a whole message or a chunk of one).
    Text { text: String },
    /// A line that is not part of the format (plain-text CLIs, stderr, unknown JSON).
    Output { line: String, stderr: bool },
    /// Something worth a line in the transcript: a denied permission, a retry.
    Notice { message: String },
}

/// What a finished stream tells about the run.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Collected {
    pub session: Option<String>,
    /// The AI's final answer (Dutch prose for the chat).
    pub answer: Option<String>,
    /// The CLI's own error message, if it reported one.
    pub error: Option<String>,
    /// The CLI said it is not logged in (or the format's auth signal came).
    pub auth_failed: bool,
    /// The last output lines (stderr and non-format lines), for the error card.
    pub tail: Vec<String>,
}

/// A stateful reader for one run's stdout and stderr lines.
#[derive(Debug)]
pub struct Parser {
    format: StreamFormat,
    session: Option<String>,
    /// Text of the current assistant message (streamed deltas are joined).
    current: String,
    answer: Option<String>,
    error: Option<String>,
    auth_failed: bool,
    tail: VecDeque<String>,
}

impl Parser {
    pub fn new(format: StreamFormat) -> Parser {
        Parser {
            format,
            session: None,
            current: String::new(),
            answer: None,
            error: None,
            auth_failed: false,
            tail: VecDeque::new(),
        }
    }

    /// The events of one line (without its line break).
    pub fn line(&mut self, line: &str, stderr: bool) -> Vec<AiEvent> {
        let line = line.trim_end_matches(['\r', '\n']);
        if line.trim().is_empty() {
            return Vec::new();
        }
        if stderr || self.format == StreamFormat::Text {
            self.keep_tail(line);
            if !stderr && self.format == StreamFormat::Text && self.current.len() < MAX_ANSWER {
                self.current.push_str(line);
                self.current.push('\n');
            }
            return vec![AiEvent::Output {
                line: clip(line),
                stderr,
            }];
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            self.keep_tail(line);
            return vec![AiEvent::Output {
                line: clip(line),
                stderr: false,
            }];
        };
        let mut out = Vec::new();
        match self.format {
            StreamFormat::ClaudeStreamJson => self.claude(&value, &mut out),
            StreamFormat::CodexJson => self.codex(&value, &mut out),
            StreamFormat::GeminiStreamJson => self.gemini(&value, &mut out),
            StreamFormat::VibeStreaming => self.vibe(&value, &mut out),
            StreamFormat::AntigravityStreamJson | StreamFormat::CopilotJson => {
                self.generic(&value, &mut out)
            }
            StreamFormat::Text => {}
        }
        if out.is_empty()
            && self.session.is_none()
            && let Some(id) = find_session(&value)
        {
            self.set_session(id, &mut out);
        }
        out
    }

    /// What the stream told; `exit_code` lets formats with an auth exit code say so.
    pub fn finish(mut self, exit_code: Option<i32>) -> Collected {
        if self.format == StreamFormat::GeminiStreamJson && exit_code == Some(41) {
            self.auth_failed = true;
        }
        let failed = exit_code != Some(0) || self.error.is_some();
        if failed && !self.auth_failed {
            let mut texts: Vec<&str> = self.tail.iter().map(String::as_str).collect();
            if let Some(e) = &self.error {
                texts.push(e);
            }
            self.auth_failed = texts.iter().any(|t| looks_like_auth(t));
        }
        let answer = self
            .answer
            .take()
            .or_else(|| (!self.current.trim().is_empty()).then(|| self.current.clone()))
            .map(|a| a.trim().to_owned());
        Collected {
            session: self.session,
            answer,
            error: self.error,
            auth_failed: self.auth_failed,
            tail: self.tail.into_iter().collect(),
        }
    }

    fn keep_tail(&mut self, line: &str) {
        if self.tail.len() == TAIL_LINES {
            self.tail.pop_front();
        }
        self.tail.push_back(clip(line));
    }

    fn set_session(&mut self, id: String, out: &mut Vec<AiEvent>) {
        if self.session.as_deref() != Some(id.as_str()) && !id.is_empty() {
            self.session = Some(id.clone());
            out.push(AiEvent::Session { id });
        }
    }

    fn text(&mut self, text: &str, delta: bool, out: &mut Vec<AiEvent>) {
        if text.is_empty() {
            return;
        }
        if delta {
            self.current.push_str(text);
        } else {
            self.current = text.to_owned();
        }
        out.push(AiEvent::Text {
            text: text.to_owned(),
        });
    }

    fn step(&mut self, tool: &str, input: Option<&Value>, out: &mut Vec<AiEvent>) {
        // A new step ends the message before it: the answer is the last message.
        out.push(step_event(tool, input));
    }
}

fn str_at<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str)
}

/// `message.content` blocks of a Claude message.
fn content_blocks(v: &Value) -> Vec<&Value> {
    v.pointer("/message/content")
        .and_then(Value::as_array)
        .map(|a| a.iter().collect())
        .unwrap_or_default()
}

/// A text-ish field of a message: `text`, `content` (string or blocks), `message`, `response`.
fn text_of(v: &Value) -> Option<String> {
    for key in ["text", "content", "message", "response", "result"] {
        match v.get(key) {
            Some(Value::String(s)) if !s.is_empty() => return Some(s.clone()),
            Some(c @ Value::Array(_)) => {
                let t = flatten_text(Some(c));
                if !t.is_empty() {
                    return Some(t);
                }
            }
            _ => {}
        }
    }
    None
}

/// Joins the text of a string, an array of strings or of `{text}` blocks.
fn flatten_text(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|i| match i {
                Value::String(s) => Some(s.clone()),
                other => str_at(other, "text").map(str::to_owned),
            })
            .collect::<Vec<_>>()
            .join("\n"),
        Some(other @ Value::Object(_)) => text_of(other).unwrap_or_default(),
        _ => String::new(),
    }
}

/// A session id under a likely key at the top level.
fn find_session(v: &Value) -> Option<String> {
    [
        "session_id",
        "sessionId",
        "conversation_id",
        "conversationId",
        "thread_id",
    ]
    .iter()
    .find_map(|k| str_at(v, k))
    .map(str::to_owned)
}

fn clip(s: &str) -> String {
    if s.chars().count() <= MAX_DETAIL {
        s.to_owned()
    } else {
        let mut out: String = s.chars().take(MAX_DETAIL).collect();
        out.push('…');
        out
    }
}

/// The step of a tool call, with a Dutch title by kind.
fn step_event(tool: &str, input: Option<&Value>) -> AiEvent {
    let lower = tool.to_ascii_lowercase();
    let arg = |keys: &[&str]| -> String {
        input
            .and_then(|i| keys.iter().find_map(|k| i.get(*k).and_then(Value::as_str)))
            .unwrap_or_default()
            .to_owned()
    };
    let file = || {
        short_names(&[arg(&[
            "file_path",
            "path",
            "absolute_path",
            "filePath",
            "file",
            "target",
        ])
        .as_str()])
    };
    if ["bash", "shell", "command", "powershell", "terminal", "exec"]
        .iter()
        .any(|k| lower.contains(k))
    {
        return command_step(&arg(&["command", "cmd", "script"]));
    }
    let (step, title) =
        if lower.contains("search") && (lower.contains("web") || lower.contains("google")) {
            (
                StepKind::Search,
                format!("Zoeken op internet: {}", arg(&["query", "q"])),
            )
        } else if lower.contains("fetch") || lower.contains("url") {
            (
                StepKind::Fetch,
                format!("Pagina lezen: {}", arg(&["url", "prompt"])),
            )
        } else if ["edit", "write", "replace", "patch", "create"]
            .iter()
            .any(|k| lower.contains(k))
        {
            (StepKind::Edit, format!("Bestand bewerken: {}", file()))
        } else if ["read", "grep", "glob", "list", "search", "view", "ls"]
            .iter()
            .any(|k| lower.contains(k))
        {
            (StepKind::Read, format!("Lezen: {}", file()))
        } else if lower.contains("todo") || lower.contains("think") || lower.contains("plan") {
            (StepKind::Thinking, "Plannen".to_owned())
        } else {
            (StepKind::Tool, format!("Hulpmiddel: {tool}"))
        };
    AiEvent::Step {
        step,
        title: title.trim_end_matches([':', ' ']).to_owned(),
        detail: input.map(|i| clip(&i.to_string())),
    }
}

fn command_step(command: &str) -> AiEvent {
    let check = command.contains(CHECK_COMMAND) || command.contains(".maatwerk\\check");
    AiEvent::Step {
        step: if check {
            StepKind::Check
        } else {
            StepKind::Command
        },
        title: if check {
            "Opdracht controleren".to_owned()
        } else {
            format!("Commando: {}", command.lines().next().unwrap_or_default())
        },
        detail: Some(clip(command)),
    }
}

/// File names without folders, joined: "opdracht.typ, plaatje.png".
fn short_names(paths: &[&str]) -> String {
    paths
        .iter()
        .filter(|p| !p.is_empty())
        .map(|p| p.rsplit(['/', '\\']).next().unwrap_or(p))
        .collect::<Vec<_>>()
        .join(", ")
}

/// A message that says the CLI is not logged in (only asked when the run failed).
fn looks_like_auth(text: &str) -> bool {
    let t = text.to_lowercase();
    [
        "not logged in",
        "please log in",
        "please login",
        "/login",
        "log in to",
        "login required",
        "authentication required",
        "authentication failed",
        "not authenticated",
        "unauthorized",
        "401",
        "invalid api key",
        "api key",
        "sign in",
        "please run vibe --setup",
    ]
    .iter()
    .any(|k| t.contains(k))
}

mod formats;

#[cfg(test)]
mod tests;
