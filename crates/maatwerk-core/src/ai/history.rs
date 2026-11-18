// SPDX-License-Identifier: AGPL-3.0-or-later

//! One conversation per provider per opdracht (decision 48), kept in local app data
//! ([`super::workspace::Layout::history_file`]), never in the shared folder. It holds the CLI's
//! session id, the messages and per run a transcript summary that stays available after the
//! run (decision 66).

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::events::{AiEvent, StepKind};
use super::provider::ProviderKey;
use super::run::RunEnd;
use super::workspace::{PastMessage, Starter};
use crate::error::{Error, Result};
use crate::storage::atomic::write_atomic;

/// At most this many steps per run are kept.
const MAX_STEPS: usize = 300;

/// A step of the transcript with its output.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptStep {
    pub step: StepKind,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(default)]
    pub error: bool,
}

/// Builds the transcript of a run from its events.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Transcript {
    pub steps: Vec<TranscriptStep>,
    /// Lines that are not part of a step (stderr, notices, plain output).
    pub lines: Vec<String>,
}

impl Transcript {
    pub fn push(&mut self, event: &AiEvent) {
        match event {
            AiEvent::Step {
                step,
                title,
                detail,
            } if self.steps.len() < MAX_STEPS => self.steps.push(TranscriptStep {
                step: *step,
                title: title.clone(),
                detail: detail.clone(),
                output: None,
                error: false,
            }),
            AiEvent::StepOutput { text, error } => {
                if let Some(last) = self.steps.last_mut() {
                    let out = last.output.get_or_insert_with(String::new);
                    if !out.is_empty() {
                        out.push('\n');
                    }
                    out.push_str(text);
                    last.error |= *error;
                }
            }
            AiEvent::Output { line, .. } if self.lines.len() < MAX_STEPS => {
                self.lines.push(line.clone());
            }
            AiEvent::Notice { message } if self.lines.len() < MAX_STEPS => {
                self.lines.push(message.clone());
            }
            _ => {}
        }
    }
}

/// What happened in one run, kept with the AI's message.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSummary {
    pub end: RunEndKind,
    pub elapsed_ms: u64,
    #[serde(default)]
    pub steps: Vec<TranscriptStep>,
    #[serde(default)]
    pub lines: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default)]
    pub auth_failed: bool,
    /// Rounds Maatwerk added to fix remaining errors (ADR-0009 finding 9).
    #[serde(default)]
    pub fix_rounds: u32,
    /// The run left a proposal (a diff card in the chat).
    #[serde(default)]
    pub proposal: bool,
    /// The teacher applied (part of) it.
    #[serde(default)]
    pub applied: bool,
}

/// [`RunEnd`] without its details, for the history.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RunEndKind {
    Finished,
    Failed,
    TimedOut,
    Stopped,
    StartFailed,
}

impl RunEndKind {
    pub fn of(end: &RunEnd, succeeded: bool) -> RunEndKind {
        match end {
            RunEnd::Exited { .. } if succeeded => RunEndKind::Finished,
            RunEnd::Exited { .. } => RunEndKind::Failed,
            RunEnd::TimedOut => RunEndKind::TimedOut,
            RunEnd::Stopped => RunEndKind::Stopped,
            RunEnd::StartFailed { .. } => RunEndKind::StartFailed,
        }
    }
}

/// One message of the chat.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub from_teacher: bool,
    pub text: String,
    /// ISO 8601 UTC.
    pub at: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub starter: Option<Starter>,
    /// The AI's messages: how the run went.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run: Option<RunSummary>,
}

/// A conversation, as stored.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub provider: ProviderKey,
    /// The CLI's session id; `None` until the first run reported or used one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session: Option<String>,
    #[serde(default)]
    pub messages: Vec<Message>,
    #[serde(flatten)]
    pub other: serde_json::Map<String, serde_json::Value>,
}

impl Conversation {
    pub fn new(provider: ProviderKey) -> Conversation {
        Conversation {
            provider,
            session: None,
            messages: Vec::new(),
            other: serde_json::Map::new(),
        }
    }

    /// The stored conversation, or a new one when there is none or it is unreadable.
    pub fn load(path: &Path, provider: &ProviderKey) -> Conversation {
        fs::read(path)
            .ok()
            .and_then(|b| serde_json::from_slice::<Conversation>(&b).ok())
            .filter(|c| &c.provider == provider)
            .unwrap_or_else(|| Conversation::new(provider.clone()))
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        let io = |e| Error::io(path.to_string_lossy(), e);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(io)?;
        }
        let json = serde_json::to_vec_pretty(self).map_err(|e| Error::InvalidArgument {
            message: e.to_string(),
        })?;
        write_atomic(path, &json).map_err(io)
    }

    /// The messages so far, for a CLI that does not resume.
    pub fn past(&self) -> Vec<PastMessage> {
        self.messages
            .iter()
            .filter(|m| !m.text.trim().is_empty())
            .map(|m| PastMessage {
                from_teacher: m.from_teacher,
                text: m.text.clone(),
            })
            .collect()
    }

    /// Marks the last proposal as applied (the diff card's "Toegepast").
    pub fn mark_applied(&mut self) {
        if let Some(run) = self
            .messages
            .iter_mut()
            .rev()
            .find_map(|m| m.run.as_mut().filter(|r| r.proposal))
        {
            run.applied = true;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transcript_attaches_output_to_the_last_step() {
        let mut t = Transcript::default();
        t.push(&AiEvent::StepOutput {
            text: "orphan".into(),
            error: false,
        });
        t.push(&AiEvent::Step {
            step: StepKind::Check,
            title: "Opdracht controleren".into(),
            detail: None,
        });
        t.push(&AiEvent::StepOutput {
            text: "a".into(),
            error: false,
        });
        t.push(&AiEvent::StepOutput {
            text: "b".into(),
            error: true,
        });
        t.push(&AiEvent::Notice {
            message: "retry".into(),
        });
        t.push(&AiEvent::Text { text: "x".into() });
        assert_eq!(t.steps.len(), 1);
        assert_eq!(t.steps[0].output.as_deref(), Some("a\nb"));
        assert!(t.steps[0].error);
        assert_eq!(t.lines, ["retry"]);
    }

    #[test]
    fn conversation_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("h/claude.json");
        let key = ProviderKey::parse("claude").unwrap();
        let mut c = Conversation::load(&path, &key);
        assert!(c.messages.is_empty());
        c.session = Some("s".into());
        c.messages.push(Message {
            from_teacher: true,
            text: "Vraag".into(),
            at: "2026-11-18T10:00:00Z".into(),
            attachments: vec!["foto.png".into()],
            starter: Some(Starter::FixErrors),
            run: None,
        });
        c.messages.push(Message {
            from_teacher: false,
            text: "Antwoord".into(),
            at: "2026-11-18T10:01:00Z".into(),
            attachments: vec![],
            starter: None,
            run: Some(RunSummary {
                end: RunEndKind::Finished,
                elapsed_ms: 1000,
                steps: vec![],
                lines: vec![],
                error: None,
                auth_failed: false,
                fix_rounds: 0,
                proposal: true,
                applied: false,
            }),
        });
        c.mark_applied();
        c.save(&path).unwrap();
        let back = Conversation::load(&path, &key);
        assert_eq!(back, c);
        assert!(back.messages[1].run.as_ref().unwrap().applied);
        assert_eq!(back.past().len(), 2);
        // Another provider's file is not this conversation.
        let other = ProviderKey::parse("codex").unwrap();
        assert!(Conversation::load(&path, &other).messages.is_empty());
    }
}
