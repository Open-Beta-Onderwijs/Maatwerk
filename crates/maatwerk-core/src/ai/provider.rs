// SPDX-License-Identifier: AGPL-3.0-or-later

//! The AI CLIs Maatwerk knows (decisions 49, 76), their command presets (ADR-0009 "CLI
//! research", the "Default args" rows), the teacher's own CLIs (decision 77) and the per-teacher
//! AI settings of this computer (decision 71).
//!
//! Arguments are one string per turn kind (first message, later messages), split like a shell
//! would ([`split_args`]), with placeholders that Maatwerk fills in ([`Placeholders`]). The
//! teacher's free text is never an argument: it goes into the request file, and `{prompt}` is a
//! fixed instruction to read it (ADR-0009 finding 1).

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::jsonfmt::to_js_json;
use crate::storage::atomic::write_atomic;

/// The fixed `{prompt}`: an ASCII instruction, safe on every command line.
pub const PROMPT: &str = "Read .maatwerk/request.md and do what it asks.";

/// The request file in the workspace, relative to it.
pub const REQUEST_FILE: &str = ".maatwerk/request.md";

/// The bundled check command as the CLI calls it from the workspace (a script that runs
/// Maatwerk's own check, see [`super::workspace`]).
pub const CHECK_COMMAND: &str = ".maatwerk/check";

/// The AI CLIs with a built-in preset.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Builtin {
    Claude,
    Codex,
    Gemini,
    Antigravity,
    Vibe,
    Copilot,
}

/// How a CLI's stdout is read ([`super::events`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StreamFormat {
    ClaudeStreamJson,
    CodexJson,
    GeminiStreamJson,
    AntigravityStreamJson,
    VibeStreaming,
    CopilotJson,
    /// Plain text: every line is shown as it comes (custom CLIs).
    Text,
}

/// Where the session id of a conversation comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionMode {
    /// Maatwerk makes a UUID before the first turn (`{session}` in the first arguments too).
    Maatwerk,
    /// The CLI reports its id in the first run's output; `{session}` only in later arguments.
    Reported,
}

mod args;
mod presets;
mod settings;

pub use args::*;
pub use presets::*;
pub use settings::*;

/// A provider: a built-in CLI (`claude`, ...) or a teacher's own (`custom-<slug>`).
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct ProviderKey(String);

impl ProviderKey {
    pub fn builtin(b: Builtin) -> ProviderKey {
        ProviderKey(builtin_key(b).to_owned())
    }

    /// Parses `claude`, `codex`, ... or `custom-<a-z0-9->{1,40}`.
    pub fn parse(s: &str) -> Result<ProviderKey> {
        let custom = s.strip_prefix("custom-").is_some_and(|slug| {
            !slug.is_empty()
                && slug.len() <= 40
                && slug
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        });
        if custom || presets().iter().any(|p| builtin_key(p.builtin) == s) {
            Ok(ProviderKey(s.to_owned()))
        } else {
            Err(invalid(format!("Onbekend AI-programma: {s}")))
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn as_builtin(&self) -> Option<Builtin> {
        presets()
            .iter()
            .map(|p| p.builtin)
            .find(|b| builtin_key(*b) == self.0)
    }
}

impl TryFrom<String> for ProviderKey {
    type Error = Error;
    fn try_from(s: String) -> Result<ProviderKey> {
        ProviderKey::parse(&s)
    }
}

impl From<ProviderKey> for String {
    fn from(k: ProviderKey) -> String {
        k.0
    }
}

impl std::fmt::Display for ProviderKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

pub fn builtin_key(b: Builtin) -> &'static str {
    match b {
        Builtin::Claude => "claude",
        Builtin::Codex => "codex",
        Builtin::Gemini => "gemini",
        Builtin::Antigravity => "antigravity",
        Builtin::Vibe => "vibe",
        Builtin::Copilot => "copilot",
    }
}

fn invalid(message: String) -> Error {
    Error::InvalidArgument { message }
}

#[cfg(test)]
mod tests;
